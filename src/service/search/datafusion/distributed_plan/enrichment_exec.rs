// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{any::Any, sync::Arc};

use arrow::array::RecordBatch;
use config::{PARQUET_BATCH_SIZE, utils::record_batch_ext::convert_vrl_to_record_batch};
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics, internal_err},
    error::DataFusionError,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
        metrics::{self, ExecutionPlanMetricsSet, MetricBuilder, MetricsSet},
        stream::RecordBatchStreamAdapter,
    },
};
use futures::TryStreamExt;
use rayon::prelude::*;

use crate::common::infra::config::ENRICHMENT_TABLES;

#[derive(Debug, Clone)]
pub struct EnrichmentExec {
    trace_id: String,
    org_id: String,
    stream_name: String,
    schema: SchemaRef,
    cache: PlanProperties,
    metrics: ExecutionPlanMetricsSet,
}

impl EnrichmentExec {
    pub fn new(trace_id: String, org_id: String, stream_name: String, schema: SchemaRef) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema), 1);
        EnrichmentExec {
            trace_id,
            org_id,
            stream_name,
            schema,
            cache,
            metrics: ExecutionPlanMetricsSet::new(),
        }
    }

    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> PlanProperties {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Partitioning::UnknownPartitioning(n_partitions);
        PlanProperties::new(
            eq_properties,
            output_partitioning,
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn org_id(&self) -> &str {
        &self.org_id
    }

    pub fn stream_name(&self) -> &str {
        &self.stream_name
    }

    pub fn schema(&self) -> &SchemaRef {
        &self.schema
    }
}

impl DisplayAs for EnrichmentExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "EnrichmentExec: stream_name={}", self.stream_name)
    }
}

#[derive(Debug, Clone)]
pub struct EnrichmentMetrics {
    /// Time in nanos to get enrichment data from in-memory store
    pub fetch_data_time: metrics::Time,
    /// Time in nanos to convert VRL directly to RecordBatch
    pub vrl_to_record_batch_time: metrics::Time,
    /// output rows
    pub output_rows: metrics::Count,
}

impl EnrichmentMetrics {
    pub fn new(input_partition: usize, metrics: &ExecutionPlanMetricsSet) -> Self {
        // Time in nanos to get enrichment data from in-memory store
        let fetch_data_time =
            MetricBuilder::new(metrics).subset_time("fetch_data_time", input_partition);

        // Time in nanos to convert VRL directly to RecordBatch
        let vrl_to_record_batch_time =
            MetricBuilder::new(metrics).subset_time("vrl_to_record_batch_time", input_partition);

        // Output rows
        let output_rows = MetricBuilder::new(metrics).output_rows(input_partition);

        Self {
            fetch_data_time,
            vrl_to_record_batch_time,
            output_rows,
        }
    }

    pub fn record_output(&self, n: usize) {
        self.output_rows.add(n);
    }
}

impl ExecutionPlan for EnrichmentExec {
    fn name(&self) -> &'static str {
        "EnrichmentExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        _: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if partition != 0 {
            return internal_err!(
                "EnrichmentExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let metrics = EnrichmentMetrics::new(partition, &self.metrics);
        let target_partition = context.session_config().target_partitions();
        let data = fetch_data(
            self.trace_id.clone(),
            self.org_id.clone(),
            self.stream_name.clone(),
            Arc::clone(&self.schema),
            target_partition,
            metrics,
        );
        let stream = futures::stream::once(data).try_flatten();
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema.clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }
}

async fn fetch_data(
    trace_id: String,
    org_id: String,
    stream_name: String,
    schema: SchemaRef,
    target_partition: usize,
    metrics: EnrichmentMetrics,
) -> Result<SendableRecordBatchStream> {
    let key = format!("{org_id}/enrichment_tables/{stream_name}");

    let fetch_data_timer = metrics.fetch_data_time.timer();
    let enrichment_data = match ENRICHMENT_TABLES.get(&key) {
        Some(stream_table) => {
            log::info!(
                "[trace_id {trace_id}] EnrichmentExec found enrichment table data for key: {key}, data length: {}",
                stream_table.data.len()
            );
            stream_table.data.clone()
        }
        None => {
            log::warn!(
                "[trace_id {trace_id}] EnrichmentExec no enrichment table data found for key: {key}"
            );
            Arc::new(vec![])
        }
    };
    fetch_data_timer.done();
    log::info!(
        "[trace_id {trace_id}] Fetched enrichment data in {} ms, target_partition: {target_partition} total records: {}",
        std::time::Duration::from_nanos(metrics.fetch_data_time.value() as u64).as_millis(),
        enrichment_data.len()
    );

    if enrichment_data.is_empty() {
        let batches = vec![RecordBatch::new_empty(schema.clone())];
        return Ok(Box::pin(MemoryStream::try_new(
            batches,
            Arc::clone(&schema),
            None,
        )?));
    }

    let batches_result: Result<Vec<_>, DataFusionError> = if target_partition > 1 {
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(target_partition)
            .build()
            .map_err(|e| {
                DataFusionError::Execution(format!("Failed to create thread pool: {e}"))
            })?;

        pool.install(|| {
            let vrl_to_record_batch_timer = metrics.vrl_to_record_batch_time.timer();
            let chunks: Vec<&[vrl::value::Value]> = enrichment_data
                .as_ref()
                .chunks(PARQUET_BATCH_SIZE)
                .collect();

            let result = chunks
                .into_par_iter()
                .map(|chunk| {
                    let record_batch = convert_vrl_to_record_batch(&schema, chunk)
                        .map_err(|e| DataFusionError::ArrowError(Box::new(e), None))?;
                    let num_rows = record_batch.num_rows();
                    Ok((record_batch, num_rows))
                })
                .collect();
            vrl_to_record_batch_timer.done();
            result
        })
    } else {
        let vrl_to_record_batch_timer = metrics.vrl_to_record_batch_time.timer();
        let chunks: Vec<&[vrl::value::Value]> = enrichment_data
            .as_ref()
            .chunks(PARQUET_BATCH_SIZE)
            .collect();

        let result = chunks
            .into_iter()
            .map(|chunk| {
                let record_batch = convert_vrl_to_record_batch(&schema, chunk)
                    .map_err(|e| DataFusionError::ArrowError(Box::new(e), None))?;
                let num_rows = record_batch.num_rows();
                Ok((record_batch, num_rows))
            })
            .collect();
        vrl_to_record_batch_timer.done();
        result
    };

    let batch_data = batches_result?;
    let total_rows: usize = batch_data.iter().map(|(_, rows)| rows).sum();
    let batches: Vec<RecordBatch> = batch_data.into_iter().map(|(batch, _)| batch).collect();
    log::info!(
        "[trace_id {trace_id}] VRL to RecordBatch conversion completed in {} ms, processed {} batches with {total_rows} total rows",
        std::time::Duration::from_nanos(metrics.vrl_to_record_batch_time.value() as u64)
            .as_millis(),
        batches.len(),
    );
    metrics.record_output(total_rows);

    Ok(Box::pin(MemoryStream::try_new(
        batches,
        Arc::clone(&schema),
        None,
    )?))
}

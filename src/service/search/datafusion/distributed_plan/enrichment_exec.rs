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
use config::utils::record_batch_ext::convert_json_to_record_batch;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics, internal_err},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
        stream::RecordBatchStreamAdapter,
    },
};
use futures::TryStreamExt;

use crate::{
    common::infra::config::ENRICHMENT_TABLES, service::db::enrichment_table::convert_from_vrl,
};

#[derive(Debug, Clone)]
pub struct EnrichmentExec {
    trace_id: String,
    org_id: String,
    stream_name: String,
    schema: SchemaRef,
    cache: PlanProperties,
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
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if partition != 0 {
            return internal_err!(
                "EnrichmentExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let data = fetch_data(
            self.trace_id.clone(),
            self.org_id.clone(),
            self.stream_name.clone(),
            Arc::clone(&self.schema),
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
}

async fn fetch_data(
    trace_id: String,
    org_id: String,
    stream_name: String,
    schema: SchemaRef,
) -> Result<SendableRecordBatchStream> {
    let key = format!("{org_id}/enrichment_tables/{stream_name}");

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
            vec![]
        }
    };

    if enrichment_data.is_empty() {
        let batches = vec![RecordBatch::new_empty(schema.clone())];
        return Ok(Box::pin(MemoryStream::try_new(
            batches,
            Arc::clone(&schema),
            None,
        )?));
    }

    let json_values: Vec<Arc<serde_json::Value>> = enrichment_data
        .into_iter()
        .map(|vrl_value| {
            let json_value = convert_from_vrl(&vrl_value);
            Arc::new(json_value)
        })
        .collect();

    let record_batch = convert_json_to_record_batch(&schema, &json_values)
        .map_err(|e| datafusion::common::DataFusionError::ArrowError(Box::new(e), None))?;

    let batches = vec![record_batch];
    Ok(Box::pin(MemoryStream::try_new(
        batches,
        Arc::clone(&schema),
        None,
    )?))
}

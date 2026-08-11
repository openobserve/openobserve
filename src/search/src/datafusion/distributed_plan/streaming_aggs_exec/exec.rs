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

use std::{fmt::Debug, sync::Arc};

use arrow::datatypes::SchemaRef;
use datafusion::{
    common::Result,
    error::DataFusionError,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::EquivalenceProperties,
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, Partitioning,
        PlanProperties,
        aggregates::AggregateExec,
        execution_plan::{Boundedness, EmissionType},
    },
};
use parking_lot::Mutex;

use crate::datafusion::distributed_plan::{
    cache_buf::{CacheBuf, CacheStream},
    streaming_aggs_exec::{cached_file_stream::CachedFileStream, monitor_stream::MonitorStream},
};

#[derive(Debug)]
pub struct StreamingAggsExec {
    id: String,
    start_time: i64,
    end_time: i64,
    input: Arc<dyn ExecutionPlan>,
    /// Cache holding plan properties like equivalences, output partitioning etc.
    cache: Arc<PlanProperties>,
    cached_files: Vec<Arc<String>>,
    cached_partition_num: usize,
    target_partitions: usize,
    is_complete_cache_hit: bool,
    aggregate_plan: Arc<AggregateExec>,
    cache_buf: Arc<Mutex<CacheBuf>>,
    overwrite_cache: bool,
}

impl StreamingAggsExec {
    /// Create a new StreamingAggsExec with explicit cache strategy
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        cached_files: Vec<Arc<String>>,
        input: Arc<dyn ExecutionPlan>,
        target_partitions: usize,
        is_complete_cache_hit: bool,
        aggregate_plan: Arc<AggregateExec>,
        overwrite_cache: bool,
    ) -> Self {
        let cached_partition_num = if cached_files.is_empty() { 0 } else { 1 };
        let total_partition_num = if is_complete_cache_hit {
            cached_partition_num
        } else {
            // Partial or no cache: cached partitions + input partitions
            let input_partitions = input.output_partitioning().partition_count();
            input_partitions + cached_partition_num
        };

        let cache = Self::compute_properties(Arc::clone(&input.schema()), total_partition_num);

        let cached_buf = CacheStream::new(
            !aggregate_plan.group_expr().is_empty(),
            target_partitions,
            aggregate_plan.clone(),
        );

        Self {
            id,
            start_time,
            end_time,
            input,
            cache,
            cached_files,
            cached_partition_num,
            target_partitions,
            is_complete_cache_hit,
            aggregate_plan,
            cache_buf: Arc::new(Mutex::new(CacheBuf {
                total_partition_num,
                cached_partition_num,
                cached_buf,
            })),
            overwrite_cache,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn start_time(&self) -> i64 {
        self.start_time
    }

    pub fn end_time(&self) -> i64 {
        self.end_time
    }

    pub fn target_partitions(&self) -> usize {
        self.target_partitions
    }

    pub fn is_complete_cache_hit(&self) -> bool {
        self.is_complete_cache_hit
    }

    pub fn cached_files(&self) -> &[Arc<String>] {
        &self.cached_files
    }

    pub fn aggregate_plan(&self) -> &Arc<AggregateExec> {
        &self.aggregate_plan
    }

    pub fn overwrite_cache(&self) -> bool {
        self.overwrite_cache
    }

    pub(crate) fn output_partitioning_helper(n_partitions: usize) -> Partitioning {
        Partitioning::UnknownPartitioning(n_partitions)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    pub(crate) fn compute_properties(
        schema: SchemaRef,
        n_partitions: usize,
    ) -> Arc<PlanProperties> {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Self::output_partitioning_helper(n_partitions);
        Arc::new(PlanProperties::new(
            eq_properties,
            // Output Partitioning
            output_partitioning,
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        ))
    }
}

impl DisplayAs for StreamingAggsExec {
    fn fmt_as(&self, t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match t {
            DisplayFormatType::Default | DisplayFormatType::Verbose => {
                let strategy = if self.is_complete_cache_hit {
                    "complete_hit"
                } else {
                    "miss"
                };
                write!(
                    f,
                    "StreamingAggsExec: streaming_id={}, cache_strategy={strategy}, cached_partitions={}, total_partitions={}",
                    self.id,
                    self.cached_partition_num,
                    self.properties().output_partitioning().partition_count()
                )
            }
            DisplayFormatType::TreeRender => {
                let strategy = if self.is_complete_cache_hit {
                    "complete_hit"
                } else {
                    "miss"
                };
                _ = writeln!(f, "streaming_id={}", self.id);
                _ = writeln!(f, "cache_strategy={strategy}",);
                _ = writeln!(f, "cached_partitions={}", self.cached_partition_num);
                _ = writeln!(
                    f,
                    "total_partitions={}",
                    self.properties().output_partitioning().partition_count()
                );
                Ok(())
            }
        }
    }
}

impl ExecutionPlan for StreamingAggsExec {
    // NOTE(df55-test): DataFusion 55 made `apply_expressions` a required
    // ExecutionPlan method. Reported as "no expressions" for the upgrade test;
    // nodes that embed PhysicalExprs should enumerate them via
    // `apply_expression_roots` before this ships.
    fn apply_expressions(
        &self,
        _f: &mut dyn FnMut(
            &std::sync::Arc<dyn datafusion::physical_expr::PhysicalExpr>,
        ) -> datafusion::error::Result<
            datafusion::common::tree_node::TreeNodeRecursion,
        >,
    ) -> datafusion::error::Result<datafusion::common::tree_node::TreeNodeRecursion> {
        Ok(datafusion::common::tree_node::TreeNodeRecursion::Continue)
    }
    fn name(&self) -> &'static str {
        "StreamingAggsExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(Arc::new(StreamingAggsExec::new(
            self.id.clone(),
            self.start_time,
            self.end_time,
            self.cached_files.clone(),
            children[0].clone(),
            self.target_partitions,
            self.is_complete_cache_hit,
            self.aggregate_plan.clone(),
            self.overwrite_cache,
        )))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        // Complete cache hit: only return cached data, never execute input
        if self.is_complete_cache_hit {
            log::debug!(
                "[StreamingAggs streaming_id: {}] Complete cache hit: returning cached data for partition {}/{}",
                self.id,
                partition,
                self.cached_partition_num
            );
            if partition < self.cached_partition_num {
                log::debug!(
                    "[StreamingAggs streaming_id: {}] EXECUTING with cached files for partition {} (complete cache hit), time_range=[{}, {}], files: {:?}",
                    self.id,
                    partition,
                    self.start_time,
                    self.end_time,
                    self.cached_files
                );
                // Create a lazy stream that will read cached files on demand
                return Ok(Box::pin(CachedFileStream::new(
                    self.id.clone(),
                    self.cached_files.clone(),
                    self.input.schema(),
                )));
            } else {
                // This should never happen with complete cache hit
                return Err(DataFusionError::Internal(format!(
                    "StreamingAggsExec: Invalid partition {} for complete cache hit with {} cached partitions",
                    partition, self.cached_partition_num
                )));
            }
        }

        log::debug!(
            "[StreamingAggs streaming_id: {}] Partial cache hit: partition={}, cached_partitions={}, executing input for new data",
            self.id,
            partition,
            self.cached_partition_num
        );

        // Partial or no cache: handle both cached and input partitions
        if partition < self.cached_partition_num {
            log::debug!(
                "[StreamingAggs streaming_id: {}] EXECUTING with cached files for partition {} (partial cache hit), time_range=[{}, {}], files: {:?}",
                self.id,
                partition,
                self.start_time,
                self.end_time,
                self.cached_files
            );
            return Ok(Box::pin(CachedFileStream::new(
                self.id.clone(),
                self.cached_files.clone(),
                self.input.schema(),
            )));
        }

        // Execute input for missing data
        Ok(Box::pin(MonitorStream::new(
            self.id.clone(),
            self.start_time,
            self.end_time,
            self.input.schema(),
            self.cache_buf.clone(),
            self.input
                .execute(partition - self.cached_partition_num, context)?,
            self.overwrite_cache,
        )))
    }

    fn benefits_from_input_partitioning(&self) -> Vec<bool> {
        vec![false; self.children().len()]
    }
}

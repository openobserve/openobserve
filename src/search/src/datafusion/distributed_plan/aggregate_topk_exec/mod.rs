// Copyright 2026 OpenObserve Inc.
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
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::EquivalenceProperties,
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, Partitioning,
        PlanProperties,
        execution_plan::{Boundedness, EmissionType},
    },
};

pub mod heap;
pub mod sort;

#[derive(Debug)]
pub struct AggregateTopkExec {
    input: Arc<dyn ExecutionPlan>,
    /// Cache holding plan properties like equivalences, output partitioning etc.
    cache: Arc<PlanProperties>,
    target_partitions: usize,
    sort_field: String,
    descending: bool,
    limit: u64,
}

impl AggregateTopkExec {
    /// Create a new AggregateMergeExec with explicit cache strategy
    pub fn new(
        input: Arc<dyn ExecutionPlan>,
        sort_field: &str,
        descending: bool,
        limit: u64,
    ) -> Self {
        // Partial or no cache: cached partitions + input partitions
        let target_partitions = input.output_partitioning().partition_count();
        let cache = Self::compute_properties(Arc::clone(&input.schema()), target_partitions);
        let sort_field = input
            .schema()
            .fields()
            .iter()
            .find(|f| {
                // field name like count(*)[count]
                f.name() == sort_field
                    || f.name().split('[').next().is_some_and(|v| v == sort_field)
            })
            .unwrap()
            .name()
            .to_string();

        Self {
            input,
            cache,
            target_partitions,
            sort_field,
            descending,
            limit,
        }
    }

    fn output_partitioning_helper(n_partitions: usize) -> Partitioning {
        Partitioning::UnknownPartitioning(n_partitions)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> Arc<PlanProperties> {
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

    pub fn sort_field(&self) -> &str {
        &self.sort_field
    }

    pub fn descending(&self) -> bool {
        self.descending
    }

    pub fn limit(&self) -> u64 {
        self.limit
    }
}

impl DisplayAs for AggregateTopkExec {
    fn fmt_as(&self, t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match t {
            DisplayFormatType::Default | DisplayFormatType::Verbose => {
                write!(
                    f,
                    "AggregateTopkExec: target_partitions={}, limit={}, descending={}",
                    self.target_partitions, self.limit, self.descending
                )
            }
            DisplayFormatType::TreeRender => {
                _ = writeln!(f, "target_partitions={}", self.target_partitions);
                _ = writeln!(f, "limit={}", self.limit);
                _ = writeln!(f, "descending={}", self.descending);
                Ok(())
            }
        }
    }
}

impl ExecutionPlan for AggregateTopkExec {
    fn name(&self) -> &'static str {
        "AggregateTopkExec"
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
        if children.is_empty() {
            return Ok(self);
        }
        Ok(Arc::new(Self::new(
            children[0].clone(),
            &self.sort_field,
            self.descending,
            self.limit,
        )))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        let cfg = config::get_config();

        // We need to dynamically choose operator to use based on K (limit) because
        // heap is more memory effecient and performant when the K <= 200 range, but as the range
        // increases the performance takes a hit. In such cases, giving up on memory and
        // prioritizing performance make more sense.
        let can_use_top_k_heap =
            cfg.common.use_agg_topk_heap && self.limit <= cfg.common.agg_topk_heap_max_limit;

        let pinned_stream: SendableRecordBatchStream = if can_use_top_k_heap {
            // we use inflated limit here to calculate topK values on partial aggregation results
            // such that we mimize the risk of losing counts. Having a large limit ensures we take
            // more keys into consideration when sending out the final record batch to leader.
            let inflated_limit = (self.limit * 4).max(1000) as usize;
            Box::pin(heap::TopKHeapStream::new(
                self.input.schema(),
                self.input.execute(partition, Arc::clone(&context))?,
                self.sort_field.clone(),
                self.descending,
                inflated_limit,
            ))
        } else {
            Box::pin(sort::TopKSortStream::new(
                self.input.schema(),
                self.input.execute(partition, context)?,
                self.sort_field.clone(),
                self.descending,
                self.limit,
            ))
        };
        Ok(pinned_stream)
    }

    fn benefits_from_input_partitioning(&self) -> Vec<bool> {
        vec![false; self.children().len()]
    }

    fn supports_limit_pushdown(&self) -> bool {
        true
    }
}

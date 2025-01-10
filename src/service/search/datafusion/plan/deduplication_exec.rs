// Copyright 2024 OpenObserve Inc.
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

use arrow_schema::SortOptions;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{internal_err, Result, Statistics},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, LexRequirement, Partitioning, PhysicalSortRequirement},
    physical_plan::{
        expressions::Column, stream::RecordBatchStreamAdapter, DisplayAs, DisplayFormatType,
        Distribution, ExecutionMode, ExecutionPlan, PlanProperties,
    },
};
use itertools::Itertools;

#[derive(Debug)]
pub struct DeduplicationExec {
    input: Arc<dyn ExecutionPlan>,
    deduplication_columns: Vec<Column>,
    max_rows: usize,
    cache: PlanProperties,
}

impl DeduplicationExec {
    /// Create a new DeduplicationExec
    pub fn new(
        input: Arc<dyn ExecutionPlan>,
        deduplication_columns: Vec<Column>,
        max_rows: usize,
    ) -> Self {
        let cache = Self::compute_properties(input.schema());
        DeduplicationExec {
            input,
            deduplication_columns,
            max_rows,
            cache,
        }
    }

    fn compute_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            // TODO: add the order by properties
            EquivalenceProperties::new(schema.clone()),
            // Output Partitioning
            Partitioning::UnknownPartitioning(1),
            // Execution Mode
            ExecutionMode::Bounded,
        )
    }
}

impl DisplayAs for DeduplicationExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "DeduplicationExec: columns: {:?}",
            self.deduplication_columns
        )
    }
}

impl ExecutionPlan for DeduplicationExec {
    fn name(&self) -> &'static str {
        "DeduplicationExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        assert!(children.len() == 1);
        Ok(Arc::new(DeduplicationExec::new(
            children.into_iter().next().unwrap(),
            self.deduplication_columns.clone(),
            self.max_rows,
        )))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        if partition != 0 {
            return internal_err!(
                "DeduplicationExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let input_stream = self.input.execute(partition, context)?;
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema(),
            input_stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        self.input.statistics()
    }

    // if don't have this, the optimizer will not merge the SortExec
    // and get wrong result
    fn required_input_ordering(&self) -> Vec<Option<LexRequirement>> {
        let cfg = config::get_config();
        let mut sort_requirment = self
            .deduplication_columns
            .iter()
            .map(|column| {
                PhysicalSortRequirement::new(
                    Arc::new(column.clone()) as _,
                    Some(SortOptions::new(true, false)),
                )
            })
            .collect_vec();
        if let Some((index, _)) = self.schema().column_with_name(&cfg.common.column_timestamp) {
            sort_requirment.push(PhysicalSortRequirement::new(
                Arc::new(Column::new(&cfg.common.column_timestamp, index)) as _,
                Some(SortOptions::new(true, false)),
            ));
        }
        vec![Some(LexRequirement::new(sort_requirment))]
    }

    fn required_input_distribution(&self) -> Vec<Distribution> {
        vec![Distribution::SinglePartition; self.children().len()]
    }
}

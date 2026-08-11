// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::Arc;

use arrow::array::{ArrayRef, Int64Array, RecordBatch, UInt64Array};
use datafusion::{
    arrow::datatypes::{DataType, SchemaRef},
    common::{Result, internal_err},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
    },
};

#[derive(Debug)]
pub struct MetadataCountExec {
    schema: SchemaRef,
    records: i64,
    files: usize,
    cache: Arc<PlanProperties>,
}

impl MetadataCountExec {
    pub fn new(schema: SchemaRef, records: i64, files: usize) -> Self {
        let cache = Arc::new(PlanProperties::new(
            EquivalenceProperties::new(schema.clone()),
            Partitioning::UnknownPartitioning(1),
            EmissionType::Final,
            Boundedness::Bounded,
        ));
        Self {
            schema,
            records,
            files,
            cache,
        }
    }

    fn data(&self) -> Result<Vec<RecordBatch>> {
        if self.schema.fields().len() != 1 {
            return internal_err!(
                "MetadataCountExec expected one count field, got {}",
                self.schema.fields().len()
            );
        }

        let records = self.records.max(0);
        let array: ArrayRef = match self.schema.field(0).data_type() {
            DataType::Int64 => Arc::new(Int64Array::from(vec![records])),
            DataType::UInt64 => Arc::new(UInt64Array::from(vec![records as u64])),
            other => {
                return internal_err!("MetadataCountExec unsupported count type: {other:?}");
            }
        };

        RecordBatch::try_new(self.schema.clone(), vec![array])
            .map(|batch| vec![batch])
            .map_err(|e| datafusion::error::DataFusionError::Internal(e.to_string()))
    }
}

impl DisplayAs for MetadataCountExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "MetadataCountExec: files: {}, records: {}",
            self.files, self.records
        )
    }
}

impl ExecutionPlan for MetadataCountExec {
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
        "MetadataCountExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
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
        if partition >= 1 {
            return internal_err!(
                "MetadataCountExec invalid partition {partition} (expected partition: 0)"
            );
        }

        Ok(Box::pin(MemoryStream::try_new(
            self.data()?,
            self.schema.clone(),
            None,
        )?))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        physical_plan::ExecutionPlan,
    };

    use super::*;

    #[test]
    fn test_metadata_count_exec_creates_single_count_row() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "count",
            DataType::Int64,
            false,
        )]));
        let exec = MetadataCountExec::new(schema, 42, 3);
        let batches = exec.data().unwrap();

        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
        let values = batches[0]
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(values.value(0), 42);
    }

    #[test]
    fn test_metadata_count_exec_plan_name() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "count",
            DataType::UInt64,
            false,
        )]));
        let exec = MetadataCountExec::new(schema, 7, 2);

        assert_eq!(ExecutionPlan::name(&exec), "MetadataCountExec");
    }

    #[test]
    fn test_metadata_count_exec_display_includes_files_and_records() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "count",
            DataType::UInt64,
            false,
        )]));
        let exec = Arc::new(MetadataCountExec::new(schema, 7, 2));

        let display = format!(
            "{}",
            datafusion::physical_plan::displayable(exec.as_ref()).indent(false)
        );
        assert!(display.contains("MetadataCountExec: files: 2, records: 7"));
    }
}

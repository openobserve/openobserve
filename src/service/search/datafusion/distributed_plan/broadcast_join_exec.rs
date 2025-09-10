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

use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
    },
};

#[derive(Debug)]
pub struct BroadcastJoinExec {
    left: Arc<dyn ExecutionPlan>,
    hash_join: Arc<dyn ExecutionPlan>,
    schema: SchemaRef,
    cluster: String,
    path: String,
    cache: PlanProperties,
}

impl BroadcastJoinExec {
    pub fn new(
        left: Arc<dyn ExecutionPlan>,
        hash_join: Arc<dyn ExecutionPlan>,
        cluster: String,
        path: String,
    ) -> Self {
        let schema = hash_join.schema();
        let partition = hash_join.output_partitioning().partition_count();
        let cache = Self::compute_properties(Arc::clone(&schema), partition);
        BroadcastJoinExec {
            left,
            hash_join,
            schema,
            cache,
            cluster,
            path,
        }
    }

    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> PlanProperties {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Partitioning::UnknownPartitioning(n_partitions);
        PlanProperties::new(
            eq_properties,
            // Output Partitioning
            output_partitioning,
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for BroadcastJoinExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "BroadcastJoinExec: cluster={}, path={}",
            self.cluster, self.path
        )
    }
}

impl ExecutionPlan for BroadcastJoinExec {
    fn name(&self) -> &'static str {
        "BroadcastJoinExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.left, &self.hash_join]
    }

    fn with_new_children(
        self: Arc<Self>,
        _: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        _partition: usize,
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        Ok(Box::pin(MemoryStream::try_new(
            vec![],
            Arc::clone(&self.schema),
            None,
        )?))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }
}

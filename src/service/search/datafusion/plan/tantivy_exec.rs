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

use config::{get_config, meta::stream::FileKey};
use datafusion::{
    arrow::{array::RecordBatch, datatypes::SchemaRef},
    common::{internal_err, Result, Statistics},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, LexOrdering, Partitioning, PhysicalSortExpr},
    physical_plan::{
        common, expressions::Column, memory::MemoryStream, DisplayAs, DisplayFormatType,
        ExecutionMode, ExecutionPlan, PlanProperties,
    },
    prelude::Expr,
};

use crate::service::search::{grpc::QueryParams, index::IndexCondition};

#[derive(Debug)]
pub struct TantivyExec {
    query: Arc<QueryParams>,
    schema: SchemaRef,               // The schema for the produced row
    file_list: Vec<FileKey>,         // The list of files to read
    index_condition: IndexCondition, // The condition to filter the rows
    cache: PlanProperties,           // Cached properties of this plan
}

impl TantivyExec {
    /// Create a new TantivyExec
    pub fn new(
        query: Arc<QueryParams>,
        schema: SchemaRef,
        file_list: Vec<FileKey>,
        index_condition: IndexCondition,
    ) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema));
        TantivyExec {
            query,
            schema,
            file_list,
            index_condition,
            cache,
        }
    }

    fn compute_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            EquivalenceProperties::new(schema.clone()),
            // Output Partitioning
            Partitioning::UnknownPartitioning(1),
            // Execution Mode
            ExecutionMode::Bounded,
        )
    }
}

impl DisplayAs for TantivyExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "TantivyExec")
    }
}

impl ExecutionPlan for TantivyExec {
    fn name(&self) -> &'static str {
        "TantivyExec"
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
        if partition >= 1 {
            return internal_err!(
                "TantivyExec invalid partition {partition} (expected partition: 0)"
            );
        }

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

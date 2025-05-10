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

use arrow::array::{Array, Int64Array};
use config::meta::{inverted_index::InvertedIndexOptimizeMode, stream::FileKey};
use datafusion::{
    arrow::{array::RecordBatch, datatypes::SchemaRef},
    common::{Result, Statistics, internal_err},
    error::DataFusionError,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        stream::RecordBatchStreamAdapter,
    },
};

use crate::service::search::{
    grpc::{QueryParams, storage::filter_file_list_by_tantivy_index},
    index::IndexCondition,
};

#[derive(Debug)]
pub struct TantivyOptimizeExec {
    query: Arc<QueryParams>,
    schema: SchemaRef,               // The schema for the produced row
    file_list: Vec<FileKey>,         // The list of files to read
    index_condition: IndexCondition, // The condition to filter the rows
    cache: PlanProperties,           // Cached properties of this plan
    index_optimize_mode: Option<InvertedIndexOptimizeMode>, // Type of query the ttv index optimizes
}

impl TantivyOptimizeExec {
    /// Create a new TantivyOptimizeExec
    pub fn new(
        query: Arc<QueryParams>,
        schema: SchemaRef,
        file_list: Vec<FileKey>,
        index_condition: IndexCondition,
        index_optimize_mode: Option<InvertedIndexOptimizeMode>,
    ) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema));
        TantivyOptimizeExec {
            query,
            schema,
            file_list,
            index_condition,
            cache,
            index_optimize_mode,
        }
    }

    fn compute_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            EquivalenceProperties::new(schema.clone()),
            // Output Partitioning
            Partitioning::UnknownPartitioning(1),
            // Execution Mode
            EmissionType::Final,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for TantivyOptimizeExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        // display up to 5 file keys,
        let file_keys = self
            .file_list
            .iter()
            .take(5)
            .map(|file_key| file_key.key.clone())
            .collect::<Vec<String>>()
            .join(", ");
        write!(
            f,
            "TantivyOptimizeExec: files: {}, file_list: [{file_keys}]",
            self.file_list.len()
        )
    }
}

impl ExecutionPlan for TantivyOptimizeExec {
    fn name(&self) -> &'static str {
        "TantivyOptimizeExec"
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
                "TantivyOptimizeExec invalid partition {partition} (expected partition: 0)"
            );
        }

        let fut = adapt_tantivy_result(
            self.query.clone(),
            self.file_list.clone(),
            Some(self.index_condition.clone()),
            self.schema.clone(),
            self.index_optimize_mode.clone(),
        );
        let stream = futures::stream::once(fut);
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema.clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }
}

async fn adapt_tantivy_result(
    query: Arc<QueryParams>,
    mut file_list: Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    schema: SchemaRef,
    idx_optimize_mode: Option<InvertedIndexOptimizeMode>,
) -> Result<RecordBatch> {
    let (idx_took, error, total_hits) = filter_file_list_by_tantivy_index(
        query.clone(),
        &mut file_list,
        index_condition,
        idx_optimize_mode,
    )
    .await
    .map_err(|e| DataFusionError::External(Box::new(e)))?;

    if error {
        return internal_err!("Error while filtering file list by Tantivy index");
    }

    log::info!(
        "[trace_id {}] search->storage: stream {}/{}/{}, TantivyOptimizeExec execution time {} ms",
        query.trace_id,
        query.org_id,
        query.stream_type,
        query.stream_name,
        idx_took
    );

    let array = vec![Arc::new(Int64Array::from(vec![total_hits as i64])) as Arc<dyn Array>];

    RecordBatch::try_new(schema, array).map_err(|e| {
        DataFusionError::Internal(format!(
            "TantivyOptimizeExec create record batch error: {e}",
        ))
    })
}

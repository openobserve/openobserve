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

use std::{any::Any, io::Cursor, sync::Arc};

use arrow::ipc::reader::FileReader;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics},
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
use infra::storage;

#[derive(Debug)]
pub struct TmpExec {
    cluster: String,
    path: String,
    schema: SchemaRef,
    cache: PlanProperties,
}

impl TmpExec {
    pub fn new(cluster: String, path: String, schema: SchemaRef) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema), 1);
        TmpExec {
            cluster,
            path,
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

    pub fn cluster(&self) -> &str {
        &self.cluster
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn schema(&self) -> &SchemaRef {
        &self.schema
    }
}

impl DisplayAs for TmpExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "TmpExec: cluster={}, path={}", self.cluster, self.path)
    }
}

impl ExecutionPlan for TmpExec {
    fn name(&self) -> &'static str {
        "TmpExec"
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
        _partition: usize,
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        let data = fetch_data(
            self.cluster.clone(),
            self.path.clone(),
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
    cluster: String,
    path: String,
    schema: SchemaRef,
) -> Result<SendableRecordBatchStream> {
    let buf = storage::get_bytes(&cluster, &path).await?;

    let reader = unsafe { FileReader::try_new(Cursor::new(buf), None)?.with_skip_validation(true) };
    let mut batches = Vec::new();
    for batch in reader {
        batches.push(batch?);
    }

    Ok(Box::pin(MemoryStream::try_new(
        batches,
        Arc::clone(&schema),
        None,
    )?))
}

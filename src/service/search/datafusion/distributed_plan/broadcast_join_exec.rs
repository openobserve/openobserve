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

use std::{any::Any, io::Cursor, pin::Pin, sync::Arc, task::Poll};

use arrow::{array::RecordBatch, ipc::writer::FileWriter};
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, Statistics, internal_err},
    execution::{RecordBatchStream, SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, PlanProperties,
        execute_stream,
        execution_plan::{Boundedness, EmissionType},
    },
};
use futures::{Stream, StreamExt};
use futures_util::ready;

use crate::service::search::datafusion::distributed_plan::utils::{OnceAsync, OnceFut};

#[derive(Debug)]
pub struct BroadcastJoinExec {
    left: Arc<dyn ExecutionPlan>,
    hash_join: Arc<dyn ExecutionPlan>,
    schema: SchemaRef,
    cache: PlanProperties,
    // left table result store path in s3
    cluster: String,
    path: String,
    left_data: OnceAsync<()>,
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
            left_data: OnceAsync::default(),
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
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if children.len() != 2 {
            return internal_err!("BroadcastJoinExec should have 2 children");
        }
        let left = children[0].clone();
        let hash_join = children[1].clone();
        Ok(Arc::new(BroadcastJoinExec::new(
            left,
            hash_join,
            self.cluster.clone(),
            self.path.clone(),
        )))
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        let schema = self.left.schema().clone();
        let path = self.path.clone();
        let left_data = self.left_data.try_once(|| {
            let left_stream = execute_stream(self.left.clone(), context.clone())?;
            Ok(collect_left_data(left_stream, schema, path))
        })?;

        Ok(Box::pin(BroadcastJoinStream::new(
            self.left.schema().clone(),
            left_data,
            // create the right stream, but not actually execute it
            self.hash_join.execute(partition, context)?,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema))
    }
}

async fn collect_left_data(
    mut stream: SendableRecordBatchStream,
    schema: SchemaRef,
    path: String,
) -> Result<()> {
    let mut batches = Vec::new();
    while let Some(batch) = stream.next().await.transpose()? {
        batches.push(batch);
    }

    let mut buffer = Cursor::new(Vec::new());
    let mut writer = FileWriter::try_new(&mut buffer, &schema)?;
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.finish()?;
    let buf = buffer.into_inner();

    infra::storage::put("", &path, buf.into()).await?;

    Ok(())
}

#[derive(Debug, Clone)]
pub(super) enum BroadcastJoinStreamState {
    WaitBuildSide,
    ProcessProbeBatch,
    Completed,
}

struct BroadcastJoinStream {
    schema: SchemaRef,
    left_data: OnceFut<()>,
    right_stream: SendableRecordBatchStream,
    state: BroadcastJoinStreamState,
}

impl BroadcastJoinStream {
    pub fn new(
        schema: SchemaRef,
        left_data: OnceFut<()>,
        right_stream: SendableRecordBatchStream,
    ) -> Self {
        Self {
            schema,
            left_data,
            right_stream,
            state: BroadcastJoinStreamState::WaitBuildSide,
        }
    }

    fn poll_next_inner(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        match &mut self.state {
            BroadcastJoinStreamState::WaitBuildSide => self.handle_wait_build_side(cx),
            BroadcastJoinStreamState::ProcessProbeBatch => self.handle_process_probe_batch(cx),
            BroadcastJoinStreamState::Completed => Poll::Ready(None),
        }
    }

    fn handle_wait_build_side(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        let _left_data = ready!(self.left_data.get_shared(cx))?;

        self.state = BroadcastJoinStreamState::ProcessProbeBatch;

        Poll::Ready(Some(Ok(RecordBatch::new_empty(self.schema.clone()))))
    }

    fn handle_process_probe_batch(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        let res = ready!(self.right_stream.poll_next_unpin(cx));
        match res {
            Some(Ok(batch)) => Poll::Ready(Some(Ok(batch))),
            Some(Err(e)) => Poll::Ready(Some(Err(e))),
            None => {
                self.state = BroadcastJoinStreamState::Completed;
                Poll::Ready(None)
            }
        }
    }
}

impl Stream for BroadcastJoinStream {
    type Item = Result<RecordBatch>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        self.poll_next_inner(cx)
    }
}

impl RecordBatchStream for BroadcastJoinStream {
    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }
}

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

use std::{io::Cursor, pin::Pin, sync::Arc, task::Poll};

use arrow::{array::RecordBatch, ipc::writer::FileWriter};
use config::get_config;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{
        Result, internal_err,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    execution::{RecordBatchStream, SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, PlanProperties,
        execute_stream,
        execution_plan::{Boundedness, EmissionType},
        metrics::{BaselineMetrics, ExecutionPlanMetricsSet, MetricBuilder, MetricsSet},
    },
};
use futures::{Stream, StreamExt};
use futures_util::ready;

use crate::datafusion::distributed_plan::{
    once_async::{OnceAsync, OnceFut},
    tmp_exec::TmpExec,
};

#[derive(Debug)]
pub struct BroadcastJoinExec {
    trace_id: String,
    left: Arc<dyn ExecutionPlan>,
    hash_join: Arc<dyn ExecutionPlan>,
    cache: Arc<PlanProperties>,
    metrics: ExecutionPlanMetricsSet,
    // left table result store path in s3
    cluster: String,
    path: String,
    // if left table is not large, directly send to follower node
    left_data: OnceAsync<Option<Vec<u8>>>,
}

impl BroadcastJoinExec {
    pub fn new(
        trace_id: String,
        left: Arc<dyn ExecutionPlan>,
        hash_join: Arc<dyn ExecutionPlan>,
        cluster: String,
        path: String,
    ) -> Self {
        let schema = hash_join.schema();
        let partition = hash_join.output_partitioning().partition_count();
        let cache = Self::compute_properties(Arc::clone(&schema), partition);
        BroadcastJoinExec {
            trace_id,
            left,
            hash_join,
            cache,
            metrics: ExecutionPlanMetricsSet::new(),
            cluster,
            path,
            left_data: OnceAsync::default(),
        }
    }

    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> Arc<PlanProperties> {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Partitioning::UnknownPartitioning(n_partitions);
        Arc::new(PlanProperties::new(
            eq_properties,
            output_partitioning,
            EmissionType::Incremental,
            Boundedness::Bounded,
        ))
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
        "BroadcastJoinExec"
    }

    fn properties(&self) -> &Arc<PlanProperties> {
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
            self.trace_id.clone(),
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
        let trace_id = self.trace_id.clone();
        let left_schema = self.left.schema().clone();
        let path = self.path.clone();
        let metrics = self.metrics.clone();
        let left_data = self.left_data.try_once(|| {
            let left_stream = execute_stream(self.left.clone(), context.clone())?;
            Ok(collect_left_data(
                trace_id,
                left_stream,
                left_schema,
                path,
                metrics,
            ))
        })?;

        let metrics = BaselineMetrics::new(&self.metrics, partition);
        Ok(Box::pin(BroadcastJoinStream::new(
            self.hash_join.schema().clone(),
            left_data,
            self.hash_join.clone(),
            partition,
            context,
            metrics,
        )))
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }
}

async fn collect_left_data(
    trace_id: String,
    mut stream: SendableRecordBatchStream,
    schema: SchemaRef,
    path: String,
    metrics: ExecutionPlanMetricsSet,
) -> Result<Option<Vec<u8>>> {
    // 1. collect all left data
    let collect_left_time = MetricBuilder::new(&metrics).subset_time("collect_left_time", 0);
    let timer = collect_left_time.timer();
    let mut batches = Vec::new();
    while let Some(batch) = stream.next().await.transpose()? {
        batches.push(batch);
    }
    timer.done();
    log::info!(
        "[trace_id {trace_id}] BroadcastJoinExec: collect left data took: {} ms",
        std::time::Duration::from_nanos(collect_left_time.value() as u64).as_millis()
    );

    // 2. convert record batch to bytes
    let convert_time = MetricBuilder::new(&metrics).subset_time("convert_time", 0);
    let timer = convert_time.timer();
    let mut buffer = Cursor::new(Vec::new());
    let mut writer = FileWriter::try_new(&mut buffer, &schema)?;
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.finish()?;
    let buf = buffer.into_inner();
    timer.done();
    log::info!(
        "[trace_id {trace_id}] BroadcastJoinExec: convert record batch to bytes took: {} ms",
        std::time::Duration::from_nanos(convert_time.value() as u64).as_millis()
    );

    // 3. if left data is too large, save to s3, otherwise return bytes
    if buf.len()
        > get_config()
            .search
            .feature_broadcast_join_left_side_max_size
            * 1024
            * 1024
    {
        log::info!(
            "[trace_id {trace_id}] BroadcastJoinExec: left data is too large, save to s3, size: {} MB",
            buf.len() as f64 / 1024.0 / 1024.0
        );
        infra::storage::put("", &path, buf.into()).await?;
        Ok(None)
    } else {
        log::info!(
            "[trace_id {trace_id}] BroadcastJoinExec: left data is not large, save to memory, size: {} MB",
            buf.len() as f64 / 1024.0 / 1024.0
        );
        Ok(Some(buf))
    }
}

impl Drop for BroadcastJoinExec {
    fn drop(&mut self) {
        let path = self.path.clone();
        tokio::task::spawn(async move {
            if let Err(e) = infra::storage::del(vec![("", &path)]).await {
                log::error!("[BroadcastJoinExec] Failed to delete left data, path: {path}: {e}");
            }
        });
    }
}

#[derive(Debug, Clone)]
pub(super) enum BroadcastJoinStreamState {
    WaitBuildSide,
    ProcessProbeBatch,
    Completed,
}

struct BroadcastJoinStream {
    schema: SchemaRef,
    left_data: OnceFut<Option<Vec<u8>>>,
    hash_join: Arc<dyn ExecutionPlan>,
    partition: usize,
    context: Arc<TaskContext>,
    right_stream: Option<SendableRecordBatchStream>,
    state: BroadcastJoinStreamState,
    metrics: BaselineMetrics,
}

impl BroadcastJoinStream {
    pub fn new(
        schema: SchemaRef,
        left_data: OnceFut<Option<Vec<u8>>>,
        hash_join: Arc<dyn ExecutionPlan>,
        partition: usize,
        context: Arc<TaskContext>,
        metrics: BaselineMetrics,
    ) -> Self {
        Self {
            schema,
            left_data,
            hash_join,
            partition,
            context,
            right_stream: None,
            state: BroadcastJoinStreamState::WaitBuildSide,
            metrics,
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
        let left_data = ready!(self.left_data.get_shared(cx))?;

        let hash_join = if let Some(left_data) = left_data.as_ref().clone() {
            let hash_join = self.hash_join.clone();
            let mut rewriter = TmpExecRewriter::new(left_data);
            hash_join.rewrite(&mut rewriter)?.data
        } else {
            self.hash_join.clone()
        };

        match hash_join.execute(self.partition, self.context.clone()) {
            Ok(right_stream) => {
                self.right_stream = Some(right_stream);
                self.state = BroadcastJoinStreamState::ProcessProbeBatch;
                Poll::Ready(Some(Ok(RecordBatch::new_empty(self.schema.clone()))))
            }
            Err(e) => Poll::Ready(Some(Err(e))),
        }
    }

    fn handle_process_probe_batch(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        if let Some(ref mut right_stream) = self.right_stream {
            let res = ready!(Pin::new(right_stream).poll_next(cx));
            match res {
                Some(Ok(batch)) => {
                    self.metrics.record_output(batch.num_rows());
                    Poll::Ready(Some(Ok(batch)))
                }
                Some(Err(e)) => Poll::Ready(Some(Err(e))),
                None => {
                    self.state = BroadcastJoinStreamState::Completed;
                    Poll::Ready(None)
                }
            }
        } else {
            // This should not happen as we set right_stream in handle_wait_build_side
            Poll::Ready(Some(Err(datafusion::common::DataFusionError::Internal(
                "Right stream not initialized".to_string(),
            ))))
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

#[derive(Debug)]
struct TmpExecRewriter {
    data: Vec<u8>,
}

impl TmpExecRewriter {
    fn new(data: Vec<u8>) -> Self {
        TmpExecRewriter { data }
    }
}

impl TreeNodeRewriter for TmpExecRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if let Some(tmp_exec) = node.downcast_ref::<TmpExec>() {
            let tmp =
                Arc::new(tmp_exec.clone().set_data(self.data.clone())) as Arc<dyn ExecutionPlan>;
            return Ok(Transformed::new(tmp, true, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

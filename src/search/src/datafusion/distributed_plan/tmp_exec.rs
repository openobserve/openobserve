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

use std::{io::Cursor, sync::Arc};

use arrow::ipc::reader::FileReader;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{Result, internal_err},
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
#[cfg(feature = "enterprise")]
use infra::client::grpc::make_grpc_search_client;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config, super_cluster::search::get_cluster_node_by_name,
};

#[derive(Debug, Clone)]
pub struct TmpExec {
    trace_id: String,
    cluster: String,
    path: String,
    data: Option<Vec<u8>>,
    schema: SchemaRef,
    cache: Arc<PlanProperties>,
}

impl TmpExec {
    pub fn new(
        trace_id: String,
        cluster: String,
        path: String,
        data: Option<Vec<u8>>,
        schema: SchemaRef,
    ) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema), 1);
        TmpExec {
            trace_id,
            cluster,
            path,
            data,
            schema,
            cache,
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

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn cluster(&self) -> &str {
        &self.cluster
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn data(&self) -> &Option<Vec<u8>> {
        &self.data
    }

    pub fn schema(&self) -> &SchemaRef {
        &self.schema
    }

    pub fn set_data(mut self, data: Vec<u8>) -> Self {
        self.data = Some(data);
        self
    }
}

impl DisplayAs for TmpExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "TmpExec: cluster={}, path={}", self.cluster, self.path)
    }
}

impl ExecutionPlan for TmpExec {
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
        "TmpExec"
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
        if partition != 0 {
            return internal_err!("TmpExec invalid partition {partition} (expected partition: 0)");
        }

        if let Some(data) = self.data.clone() {
            let reader =
                unsafe { FileReader::try_new(Cursor::new(data), None)?.with_skip_validation(true) };
            let mut batches = Vec::new();
            for batch in reader {
                batches.push(batch?);
            }
            Ok(Box::pin(MemoryStream::try_new(
                batches,
                self.schema.clone(),
                None,
            )?))
        } else {
            let data = fetch_data(
                self.trace_id.clone(),
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
    }
}

async fn fetch_data(
    trace_id: String,
    cluster: String,
    path: String,
    schema: SchemaRef,
) -> Result<SendableRecordBatchStream> {
    let data = if cluster == config::get_cluster_name() {
        infra::storage::get_bytes("", &path).await?
    } else {
        #[cfg(feature = "enterprise")]
        {
            if !get_o2_config().super_cluster.enabled {
                return internal_err!(
                    "cluster: {cluster}'s left data result is in other cluster: {}",
                    config::get_cluster_name()
                );
            }
            let node = match get_cluster_node_by_name(&cluster).await {
                Ok(node) => node,
                Err(e) => return internal_err!("Failed to get cluster node: {e:?}"),
            };
            let grpc_addr = node.get_grpc_addr();
            let path = path.to_string();
            let task = tokio::task::spawn(async move {
                let mut request = tonic::Request::new(proto::cluster_rpc::GetTableRequest { path });
                match make_grpc_search_client(&trace_id, &mut request, &node, 0).await {
                    Ok(mut client) => match client.get_table(request).await {
                        Ok(res) => Ok(res.into_inner()),
                        Err(err) => {
                            log::error!("search->grpc: node: {grpc_addr}, search err: {err:?}",);
                            Err(format!("{err:?}"))
                        }
                    },
                    Err(e) => Err(format!("{e:?}")),
                }
            });

            let response = match task.await {
                Ok(Ok(response)) => response,
                Ok(Err(e)) => return internal_err!("GRPC call failed: {e}"),
                Err(e) => return internal_err!("Task join failed: {e:?}"),
            };
            response.data.into()
        }
        #[cfg(not(feature = "enterprise"))]
        {
            let _ = trace_id;
            return internal_err!(
                "cluster: {cluster}'s left data result is in other cluster: {}",
                config::get_cluster_name()
            );
        }
    };

    let buf = data;
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

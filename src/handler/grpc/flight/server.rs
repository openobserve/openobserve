// Copyright 2024 Zinc Labs Inc.
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

use std::{convert::TryInto, io::Cursor, sync::Arc};

use arrow::{
    array::RecordBatch,
    ipc::{writer::IpcWriteOptions, CompressionType},
};
use arrow_flight::{
    encode::FlightDataEncoderBuilder, error::FlightError, flight_service_server::FlightService,
    Action, ActionType, Criteria, Empty, FlightData, FlightDescriptor, FlightInfo,
    HandshakeRequest, HandshakeResponse, PollInfo, PutResult, SchemaResult, Ticket,
};
use datafusion::{
    common::{
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
        DataFusionError, Result,
    },
    datasource::{
        file_format::parquet::ParquetFormat,
        listing::{ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl},
        TableProvider,
    },
    physical_plan::{collect, displayable, ExecutionPlan},
    prelude::SessionContext,
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use futures::{stream::BoxStream, TryStreamExt};
use prost::Message;
use tokio::{
    sync::mpsc::{channel, error::SendError, Sender},
    task,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, Streaming};

use super::utils::generate_context_with_empty_table_scan;
use crate::service::search::datafusion::distributed_plan::{
    codec::{ComposedPhysicalExtensionCodec, EmptyExecPhysicalExtensionCodec},
    empty_exec::NewEmptyExec,
    remote_exec::RemoteExecNode,
};

#[derive(Default)]
pub struct FlightServiceImpl;

#[tonic::async_trait]
impl FlightService for FlightServiceImpl {
    type HandshakeStream = BoxStream<'static, Result<HandshakeResponse, Status>>;
    type ListFlightsStream = BoxStream<'static, Result<FlightInfo, Status>>;
    type DoGetStream = BoxStream<'static, Result<FlightData, Status>>;
    type DoPutStream = BoxStream<'static, Result<PutResult, Status>>;
    type DoActionStream = BoxStream<'static, Result<arrow_flight::Result, Status>>;
    type ListActionsStream = BoxStream<'static, Result<ActionType, Status>>;
    type DoExchangeStream = BoxStream<'static, Result<FlightData, Status>>;

    async fn do_get(
        &self,
        request: Request<Ticket>,
    ) -> Result<Response<Self::DoGetStream>, Status> {
        let partitions = 2;

        // 1. decnode ticket to RemoteExecNode
        let ticket = request.into_inner();
        let mut buf = Cursor::new(ticket.ticket);
        let remote_node: RemoteExecNode = proto::cluster_rpc::RemoteExecNode::decode(&mut buf)
            .map_err(|e| DataFusionError::Internal(format!("{e:?}")))
            .and_then(|node| node.try_into())
            .map_err(|e| Status::internal(e.to_string()))?;

        // 2. generate context and register table
        let ctx = generate_context_with_empty_table_scan(remote_node.get_path(), partitions)
            .await
            .map_err(|e| Status::internal(e.to_string()))?;
        let file_format = ParquetFormat::default().with_enable_pruning(true);
        let list_options = ListingOptions::new(Arc::new(file_format))
            .with_file_extension(".parquet")
            .with_target_partitions(partitions)
            .with_collect_stat(true);
        let list_url = match ListingTableUrl::parse(remote_node.get_path()) {
            Ok(url) => url,
            Err(e) => {
                return Err(DataFusionError::Execution(format!(
                    "ListingTableUrl error: {e}"
                )))
                .map_err(|e| Status::internal(e.to_string()));
            }
        };
        let list_config = ListingTableConfig::new(list_url)
            .with_listing_options(list_options)
            .infer_schema(&ctx.state())
            .await
            .map_err(|e| Status::internal(e.to_string()))?;
        let table = ListingTable::try_new(list_config.clone())
            .map_err(|e| Status::internal(e.to_string()))?;

        // 3. generate physical plan from bytes
        let proto = ComposedPhysicalExtensionCodec {
            codecs: vec![Arc::new(EmptyExecPhysicalExtensionCodec {})],
        };
        let mut physical_plan =
            physical_plan_from_bytes_with_extension_codec(remote_node.get_plan(), &ctx, &proto)
                .map_err(|e| Status::internal(e.to_string()))?;
        let schema = physical_plan.schema();

        // 4. replace empty to parquetexec
        let mut visitor = NewEmptyExecVisitor { data: None };
        if physical_plan.visit(&mut visitor).is_ok() && visitor.data.is_some() {
            let empty_exec = visitor
                .data
                .as_ref()
                .unwrap()
                .as_any()
                .downcast_ref::<NewEmptyExec>()
                .unwrap();
            let parquet_exec = table
                .scan(
                    &ctx.state(),
                    empty_exec.projection(),
                    empty_exec.filters(),
                    empty_exec.limit(),
                )
                .await
                .map_err(|e| Status::internal(e.to_string()))?;
            let mut rewriter = ChangeTableScanExec::new(parquet_exec);
            physical_plan = physical_plan
                .rewrite(&mut rewriter)
                .map_err(|e| Status::internal(e.to_string()))?
                .data;
        }

        let plan = displayable(physical_plan.as_ref())
            .set_show_schema(false)
            .indent(true)
            .to_string();
        println!("follow plan\n{}", plan);

        // 5. send record batch to client
        let (tx, rx) = channel(2);
        task::spawn(async {
            if let Err(e) = read_partition(physical_plan, ctx, tx).await {
                println!("Error reading partition: {:?}", e);
            }
        });

        let write_options: IpcWriteOptions = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|e| Status::internal(e.to_string()))?;
        let flight_data_stream = FlightDataEncoderBuilder::new()
            .with_schema(schema)
            .with_options(write_options)
            .build(ReceiverStream::new(rx))
            .map_err(|err| Status::from_error(Box::new(err)));

        Ok(Response::new(
            Box::pin(flight_data_stream) as Self::DoGetStream
        ))
    }

    async fn handshake(
        &self,
        _request: Request<Streaming<HandshakeRequest>>,
    ) -> Result<Response<Self::HandshakeStream>, Status> {
        Err(Status::unimplemented("Implement handshake"))
    }

    async fn list_flights(
        &self,
        _request: Request<Criteria>,
    ) -> Result<Response<Self::ListFlightsStream>, Status> {
        Err(Status::unimplemented("Implement list_flights"))
    }

    async fn get_flight_info(
        &self,
        _request: Request<FlightDescriptor>,
    ) -> Result<Response<FlightInfo>, Status> {
        Err(Status::unimplemented("Implement get_flight_info"))
    }

    async fn poll_flight_info(
        &self,
        _request: Request<FlightDescriptor>,
    ) -> Result<Response<PollInfo>, Status> {
        Err(Status::unimplemented("Implement poll_flight_info"))
    }

    async fn get_schema(
        &self,
        _request: Request<FlightDescriptor>,
    ) -> Result<Response<SchemaResult>, Status> {
        Err(Status::unimplemented("Implement get_schema"))
    }

    async fn do_put(
        &self,
        _request: Request<Streaming<FlightData>>,
    ) -> Result<Response<Self::DoPutStream>, Status> {
        Err(Status::unimplemented("Implement do_put"))
    }

    async fn do_action(
        &self,
        _request: Request<Action>,
    ) -> Result<Response<Self::DoActionStream>, Status> {
        Err(Status::unimplemented("Implement do_action"))
    }

    async fn list_actions(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<Self::ListActionsStream>, Status> {
        Err(Status::unimplemented("Implement list_actions"))
    }

    async fn do_exchange(
        &self,
        _request: Request<Streaming<FlightData>>,
    ) -> Result<Response<Self::DoExchangeStream>, Status> {
        Err(Status::unimplemented("Implement do_exchange"))
    }
}

async fn read_partition(
    plan: Arc<dyn ExecutionPlan>,
    ctx: SessionContext,
    tx: Sender<Result<RecordBatch, FlightError>>,
) -> Result<(), FlightError> {
    if tx.is_closed() {
        return Err(FlightError::Tonic(Status::internal(
            "Can't send a batch, channel is closed",
        )));
    }

    let data = collect(plan, ctx.task_ctx())
        .await
        .map_err(|e| FlightError::Tonic(Status::internal(e.to_string())))?;

    for batch in data {
        tx.send(Ok(batch)).await.map_err(|err| {
            if let SendError(Err(err)) = err {
                err
            } else {
                FlightError::Tonic(Status::internal("Can't send a batch, something went wrong"))
            }
        })?
    }

    Ok(())
}

struct NewEmptyExecVisitor {
    data: Option<Arc<dyn ExecutionPlan>>,
}

impl<'n> TreeNodeVisitor<'n> for NewEmptyExecVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "NewEmptyExec" {
            self.data = Some(node.clone());
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

#[allow(dead_code)]
struct ChangeTableScanExec {
    input: Arc<dyn ExecutionPlan>,
}

impl ChangeTableScanExec {
    #[allow(dead_code)]
    fn new(input: Arc<dyn ExecutionPlan>) -> Self {
        Self { input }
    }
}

impl TreeNodeRewriter for ChangeTableScanExec {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Self::Node) -> Result<Transformed<Self::Node>> {
        let name = node.name().to_string();
        let mut transformed = if name == "NewEmptyExec" {
            Transformed::yes(self.input.clone())
        } else {
            Transformed::no(node)
        };
        if name == "NewEmptyExec" {
            transformed.tnr = TreeNodeRecursion::Stop;
        } else {
            transformed.tnr = TreeNodeRecursion::Continue;
        }
        Ok(transformed)
    }
}

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

use std::{
    io::Cursor,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{
    array::RecordBatch,
    ipc::{writer::IpcWriteOptions, CompressionType},
};
use arrow_flight::{
    encode::FlightDataEncoderBuilder, error::FlightError, flight_service_server::FlightService,
    Action, ActionType, Criteria, Empty, FlightData, FlightDescriptor, FlightInfo,
    HandshakeRequest, HandshakeResponse, PollInfo, PutResult, SchemaResult, Ticket,
};
use arrow_schema::Schema;
use config::meta::search::ScanStats;
use datafusion::{
    common::{DataFusionError, Result},
    execution::SendableRecordBatchStream,
    physical_plan::{displayable, execute_stream},
};
use futures::{stream::BoxStream, Stream, StreamExt, TryStreamExt};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::TaskStatus;
use prost::Message;
use proto::cluster_rpc::FlightSearchRequest;
use tonic::{Request, Response, Status, Streaming};

#[cfg(feature = "enterprise")]
use crate::service::search::SEARCH_SERVER;
use crate::service::search::{grpc::flight as grpcFlight, utlis::AsyncDefer};

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
        let _start = std::time::Instant::now();
        let cfg = config::get_config();

        // 1. decode ticket to RemoteExecNode
        let ticket = request.into_inner();
        let mut buf = Cursor::new(ticket.ticket);
        let req = proto::cluster_rpc::FlightSearchRequest::decode(&mut buf)
            .map_err(|e| DataFusionError::Internal(format!("{e:?}")))
            .map_err(|e| Status::internal(e.to_string()))?;

        log::info!("[trace_id {}] flight->search: do_get", req.trace_id);

        #[cfg(feature = "enterprise")]
        if req.is_super_cluster {
            SEARCH_SERVER
                .insert(
                    req.trace_id.clone(),
                    TaskStatus::new_follower(vec![], false),
                )
                .await;
        }

        #[cfg(feature = "enterprise")]
        let result = get_ctx_and_physical_plan(&req).await;
        #[cfg(not(feature = "enterprise"))]
        let result = get_ctx_and_physical_plan(&req).await;

        #[cfg(feature = "enterprise")]
        if req.is_super_cluster {
            SEARCH_SERVER.remove(&req.trace_id, false).await;
        }

        // 2. prepare dataufion context
        let (ctx, physical_plan, defer, scan_stats) = match result {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                crate::service::search::datafusion::storage::file_list::clear(&req.trace_id);
                // release wal lock files
                crate::common::infra::wal::release_request(&req.trace_id);
                log::error!(
                    "[trace_id {}] flight->search: do_get physical plan generate error: {e:?}",
                    req.trace_id,
                );
                return Err(Status::internal(e.to_string()));
            }
        };

        log::info!(
            "[trace_id {}] flight->search: executing stream, is super cluster: {}",
            req.trace_id,
            req.is_super_cluster
        );

        let mut schema = physical_plan.schema();

        if cfg.common.print_key_sql {
            let plan = displayable(physical_plan.as_ref())
                .set_show_schema(false)
                .indent(true)
                .to_string();
            println!("+---------------------------+--------------------------+");
            println!(
                "follow physical plan, is_super_cluster_follower_leader: {}",
                req.is_super_cluster
            );
            println!("+---------------------------+--------------------------+");
            println!("{}", plan);
        }

        schema = add_scan_stats_to_schema(schema, scan_stats);

        let write_options: IpcWriteOptions = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::LZ4_FRAME))
            .map_err(|e| Status::internal(e.to_string()))?;
        let flight_data_stream = FlightDataEncoderBuilder::new()
            .with_schema(schema)
            .with_options(write_options)
            .build(FlightSenderStream::new(
                req.trace_id.to_string(),
                execute_stream(physical_plan, ctx.task_ctx().clone()).map_err(|e| {
                    log::error!(
                        "[trace_id {}] flight->search: do_get physical plan execution error: {e:?}",
                        req.trace_id,
                    );
                    Status::internal(e.to_string())
                })?,
                defer,
            ))
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

struct FlightSenderStream {
    trace_id: String,
    stream: SendableRecordBatchStream,
    defer: Option<AsyncDefer>,
}

impl FlightSenderStream {
    fn new(trace_id: String, stream: SendableRecordBatchStream, defer: Option<AsyncDefer>) -> Self {
        Self {
            trace_id,
            stream,
            defer,
        }
    }
}

impl Stream for FlightSenderStream {
    type Item = Result<RecordBatch, FlightError>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(batch))) => Poll::Ready(Some(Ok(batch))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(FlightError::Tonic(
                Status::internal(e.to_string()),
            )))),
        }
    }
}

impl Drop for FlightSenderStream {
    fn drop(&mut self) {
        if let Some(defer) = self.defer.take() {
            drop(defer);
        } else {
            log::info!(
                "[trace_id {}] flight->search: drop FlightSenderStream",
                self.trace_id
            );
            // clear session data
            crate::service::search::datafusion::storage::file_list::clear(&self.trace_id);
            // release wal lock files
            crate::common::infra::wal::release_request(&self.trace_id);
        }
    }
}

#[cfg(feature = "enterprise")]
async fn get_ctx_and_physical_plan(
    req: &FlightSearchRequest,
) -> Result<
    (
        datafusion::prelude::SessionContext,
        Arc<dyn datafusion::physical_plan::ExecutionPlan>,
        Option<AsyncDefer>,
        ScanStats,
    ),
    infra::errors::Error,
> {
    if req.is_super_cluster {
        let (ctx, physical_plan, defer, scan_stats) =
            crate::service::search::super_cluster::follower::search(req).await?;
        Ok((ctx, physical_plan, Some(defer), scan_stats))
    } else {
        let (ctx, physical_plan, scan_stats) = grpcFlight::search(req).await?;
        Ok((ctx, physical_plan, None, scan_stats))
    }
}

#[cfg(not(feature = "enterprise"))]
async fn get_ctx_and_physical_plan(
    req: &FlightSearchRequest,
) -> Result<
    (
        datafusion::prelude::SessionContext,
        Arc<dyn datafusion::physical_plan::ExecutionPlan>,
        Option<AsyncDefer>,
        ScanStats,
    ),
    infra::errors::Error,
> {
    let (ctx, physical_plan, scan_stats) = grpcFlight::search(req).await?;
    Ok((ctx, physical_plan, None, scan_stats))
}

fn add_scan_stats_to_schema(schema: Arc<Schema>, scan_stats: ScanStats) -> Arc<Schema> {
    let mut metadata = schema.metadata().clone();
    let stats_string = serde_json::to_string(&scan_stats).unwrap_or_default();
    metadata.insert("scan_stats".to_string(), stats_string);
    Arc::new(schema.as_ref().clone().with_metadata(metadata))
}

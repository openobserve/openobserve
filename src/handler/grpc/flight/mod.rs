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

use std::{io::Cursor, sync::Arc};

use arrow::ipc::{CompressionType, writer::IpcWriteOptions};
use arrow_flight::{
    Action, ActionType, Criteria, Empty, FlightData, FlightDescriptor, FlightInfo,
    HandshakeRequest, HandshakeResponse, PollInfo, PutResult, SchemaResult, Ticket,
    flight_service_server::FlightService,
};
use config::{cluster::LOCAL_NODE, meta::search::ScanStats};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::execute_stream,
};
use flight::common::PreCustomMessage;
use futures::{StreamExt, stream::BoxStream};
use futures_util::pin_mut;
use prost::Message;
use tonic::{Request, Response, Status, Streaming};
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {crate::service::search::SEARCH_SERVER, o2_enterprise::enterprise::search::TaskStatus};

use crate::{
    handler::grpc::{
        MetadataMap,
        flight::{stream::FlightEncoderStreamBuilder, visitor::get_scan_stats},
    },
    service::search::{
        grpc::flight as grpcFlight,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
        request::FlightSearchRequest,
        utils::AsyncDefer,
    },
};

mod stream;
mod visitor;

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

    #[tracing::instrument(name = "grpc:search:flight:do_get", skip_all)]
    async fn do_get(
        &self,
        request: Request<Ticket>,
    ) -> Result<Response<Self::DoGetStream>, Status> {
        let _start = std::time::Instant::now();
        let cfg = config::get_config();

        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&MetadataMap(request.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx.clone());

        // 1. decode ticket to RemoteExecNode
        let ticket = request.into_inner();
        let mut buf = Cursor::new(ticket.ticket);
        let req = proto::cluster_rpc::FlightSearchRequest::decode(&mut buf)
            .map_err(|e| DataFusionError::Internal(format!("{e:?}")))
            .map_err(|e| Status::internal(e.to_string()))?;

        let req: FlightSearchRequest = req.into();
        let trace_id = format!(
            "{}-{}",
            req.query_identifier.trace_id, req.query_identifier.job_id
        );
        let is_super_cluster = req.super_cluster_info.is_super_cluster;
        let timeout = req.search_info.timeout as u64;
        log::info!("[trace_id {trace_id}] flight->search: do_get, timeout: {timeout}s",);

        #[cfg(feature = "enterprise")]
        if is_super_cluster && !SEARCH_SERVER.contain_key(&trace_id).await {
            SEARCH_SERVER
                .insert(trace_id.clone(), TaskStatus::new_follower(vec![], false))
                .await;
        }

        let result = get_ctx_and_physical_plan(&trace_id, &req).await;
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->do_get: get_ctx_and_physical_plan took: {} ms",
                    _start.elapsed().as_millis(),
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight::do_get get_ctx_and_physical_plan".to_string())
                    .search_role("follower".to_string())
                    .duration(_start.elapsed().as_millis() as usize)
                    .build()
            )
        );

        #[cfg(feature = "enterprise")]
        if is_super_cluster && !SEARCH_SERVER.is_leader(&trace_id).await {
            SEARCH_SERVER.remove(&trace_id, false).await;
        }

        // 2. prepare dataufion context
        let (ctx, physical_plan, defer, scan_stats) = match result {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                clear_session_data(&trace_id);
                log::error!(
                    "[trace_id {trace_id}] flight->search: do_get physical plan generate error: {e:?}",
                );
                return Err(Status::internal(e.to_string()));
            }
        };

        log::info!(
            "[trace_id {trace_id}] flight->search: executing stream, is super cluster: {is_super_cluster}"
        );

        if cfg.common.print_key_sql {
            log::info!(
                "[trace_id {trace_id}] follow physical plan, is_super_cluster_follower_leader: {is_super_cluster}"
            );
            log::info!(
                "{}",
                config::meta::plan::generate_plan_string(&trace_id, physical_plan.as_ref())
            );
        }

        let start = std::time::Instant::now();
        let write_options: IpcWriteOptions = IpcWriteOptions::default()
            .try_with_compression(Some(CompressionType::ZSTD))
            .map_err(|e| {
                // clear session data
                clear_session_data(&trace_id);
                log::error!(
                    "[trace_id {trace_id}] flight->search: do_get create IPC write options error: {e:?}",
                );
                Status::internal(e.to_string())
            })?;

        // used for super cluster follower leader to get scan stats
        let scan_stats_ref = get_scan_stats(physical_plan.clone());

        let stream = execute_stream(physical_plan, ctx.task_ctx().clone()).map_err(|e| {
            // clear session data
            clear_session_data(&trace_id);
            log::error!(
                "[trace_id {trace_id}] flight->search: do_get physical plan execution error: {e:?}",
            );
            Status::internal(e.to_string())
        })?;

        let mut stream = FlightEncoderStreamBuilder::new(write_options, 33554432)
            .with_trace_id(trace_id.to_string())
            .with_defer(defer)
            .with_start(start)
            .with_custom_message(PreCustomMessage::ScanStats(scan_stats))
            .with_custom_message(PreCustomMessage::ScanStatsRef(scan_stats_ref))
            .build(stream);

        let stream = async_stream::stream! {
            let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(timeout));
            pin_mut!(timeout);
            loop {
                tokio::select! {
                    batch = stream.next() => {
                        if let Some(batch) = batch {
                            yield batch
                        } else {
                            break;
                        }
                    }
                    _ = &mut timeout => {
                        log::info!("[trace_id {trace_id}] flight->search: timeout");
                        break;
                    }
                }
            }
        };

        Ok(Response::new(Box::pin(stream) as Self::DoGetStream))
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

type PlanResult = (
    datafusion::prelude::SessionContext,
    Arc<dyn datafusion::physical_plan::ExecutionPlan>,
    Option<AsyncDefer>,
    ScanStats,
);

#[cfg(feature = "enterprise")]
#[tracing::instrument(name = "service:search:grpc:flight::enter", skip_all)]
async fn get_ctx_and_physical_plan(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<PlanResult, infra::errors::Error> {
    if req.super_cluster_info.is_super_cluster {
        let (ctx, physical_plan, defer, scan_stats) =
            crate::service::search::super_cluster::follower::search(trace_id, req).await?;
        Ok((ctx, physical_plan, Some(defer), scan_stats))
    } else {
        let (ctx, physical_plan, scan_stats) = grpcFlight::search(trace_id, req).await?;
        Ok((ctx, physical_plan, None, scan_stats))
    }
}

#[cfg(not(feature = "enterprise"))]
#[tracing::instrument(name = "service:search:grpc:flight::enter", skip_all)]
async fn get_ctx_and_physical_plan(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<PlanResult, infra::errors::Error> {
    let (ctx, physical_plan, scan_stats) = grpcFlight::search(trace_id, req).await?;
    Ok((ctx, physical_plan, None, scan_stats))
}

fn clear_session_data(trace_id: &str) {
    // clear session data
    crate::service::search::datafusion::storage::file_list::clear(trace_id);
    // release wal lock files
    crate::common::infra::wal::release_request(trace_id);
}

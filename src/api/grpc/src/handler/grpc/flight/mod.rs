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

use arrow_flight::{
    Action, ActionType, Criteria, Empty, FlightData, FlightDescriptor, FlightInfo,
    HandshakeRequest, HandshakeResponse, PollInfo, PutResult, SchemaResult, Ticket,
    flight_service_server::FlightService,
};
use config::{
    cluster::LOCAL_NODE, datafusion::request::FlightSearchRequest, meta::search::ScanStats,
};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::execute_stream_partitioned,
};
use flight::common::{MetricsInfo, NodeMessages};
use futures::{StreamExt, stream::BoxStream};
use futures_util::pin_mut;
use prost::Message;
use search::{
    datafusion::distributed_plan::profile,
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};
use search_service::{grpc::flight as grpcFlight, work_group::DeferredLock};
use tonic::{Request, Response, Status, Streaming};
use tracing::Instrument;
#[cfg(feature = "enterprise")]
use {
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
    search_service::SEARCH_SERVER,
};

use crate::handler::grpc::{
    MetadataMap,
    flight::{
        stream::FlightEncoderStreamBuilder,
        visitor::{get_peak_memory_from_ctx, node_role},
    },
};

mod partition_encoder;
mod stream;
pub mod visitor;

#[derive(Default)]
pub struct FlightServiceImpl;

/// Releases the wal locks and datafusion file list registered under this trace id on drop, so
/// a request cancelled before it can produce a response stream cannot leave them pinned.
pub(crate) struct SessionGuard {
    trace_id: String,
}

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

        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&MetadataMap(request.metadata()))
        });
        let span = tracing::info_span!("grpc:search:flight:do_get");

        // decode ticket to RemoteExecNode
        let ticket = request.into_inner();
        let mut buf = Cursor::new(ticket.ticket);
        let req = proto::cluster_rpc::FlightSearchRequest::decode(&mut buf)
            .map_err(|e| DataFusionError::Internal(format!("{e:?}")))
            .map_err(|e| Status::internal(e.to_string()))?;

        let req: FlightSearchRequest = req.into();
        common::meta::grpc::set_parent_or_trace_id(
            &span,
            parent_cx,
            &req.query_identifier.trace_id,
        );
        let trace_id = format!(
            "{}-{}",
            req.query_identifier.trace_id, req.query_identifier.job_id
        );
        let session_guard = SessionGuard::new(trace_id.clone());
        let is_super_cluster = req.super_cluster_info.is_super_cluster;
        let timeout = req.search_info.timeout as u64;
        log::info!("[trace_id {trace_id}] flight->search: do_get, timeout: {timeout}s",);

        // Note: all async should in this place, otherwise it will break tracing
        // https://docs.rs/tracing/latest/tracing/span/struct.Span.html#in-asynchronous-code
        let req_move = req.clone();
        let trace_id_move = trace_id.clone();
        let result = async move { get_ctx_and_physical_plan(&trace_id_move, &req_move).await }
            .instrument(span.clone())
            .await;

        // runs after the instrumented future: without in_scope the event has no current span
        span.in_scope(|| {
            log::info!(
                "{}",
                search_inspector_fields(
                    format!(
                        "[trace_id {trace_id}] flight->do_get: get_ctx_and_physical_plan took: {} ms",
                        _start.elapsed().as_millis(),
                    ),
                    SearchInspectorFieldsBuilder::new()
                        .trace_id(trace_id.to_string())
                        .node_name(LOCAL_NODE.name.clone())
                        .component("flight::do_get get_ctx_and_physical_plan".to_string())
                        .search_role("follower".to_string())
                        .duration(_start.elapsed().as_millis() as usize)
                        .build()
                )
            );
        });

        // prepare dataufion context
        let (ctx, plan, lock, scan_stats) = match result {
            Ok(v) => v,
            Err(e) => {
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
                config::meta::plan::generate_plan_string(&trace_id, plan.as_ref())
            );
        }

        let start = std::time::Instant::now();
        let node_messages = NodeMessages {
            scan_stats,
            peak_memory: get_peak_memory_from_ctx(&ctx),
            profile: req.search_info.is_analyze.then(|| MetricsInfo {
                plan: plan.clone(),
                build_profile: profile::build_profile,
            }),
            role: node_role(&plan),
        };

        // One stream per output partition so they encode in parallel
        let streams = execute_stream_partitioned(plan, ctx.task_ctx()).map_err(|e| {
            log::error!(
                "[trace_id {trace_id}] flight->search: do_get physical plan execution error: {e:?}",
            );
            Status::internal(e.to_string())
        })?;

        let mut stream = FlightEncoderStreamBuilder::new(session_guard, node_messages)
            .with_trace_id(trace_id.to_string())
            .with_is_super(is_super_cluster)
            .with_defer_lock(lock)
            .with_start(start)
            .build(streams, span);

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

impl SessionGuard {
    fn new(trace_id: String) -> Self {
        Self { trace_id }
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        clear_session_data(&self.trace_id);

        #[cfg(feature = "enterprise")]
        if get_o2_config().work_group.max_nodes_per_query > 0 {
            o2_enterprise::enterprise::search::admission::ledger::release(&self.trace_id);
            log::info!(
                "[trace_id {}] flight->search: releasing slot",
                self.trace_id
            );
        }
    }
}

type PlanResult = (
    datafusion::prelude::SessionContext,
    Arc<dyn datafusion::physical_plan::ExecutionPlan>,
    Option<DeferredLock>,
    ScanStats,
);

#[cfg(feature = "enterprise")]
#[tracing::instrument(name = "service:search:grpc:flight::enter", skip_all)]
async fn get_ctx_and_physical_plan(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<PlanResult, infra::errors::Error> {
    if req.super_cluster_info.is_super_cluster {
        // registered only while the plan is built: that is where this node waits in its work group
        let registration = SEARCH_SERVER.register_follower(&req.query_identifier.org_id, trace_id);
        let (ctx, physical_plan, lock, scan_stats) =
            search_service::super_cluster::follower::search(registration.tracker(), req).await?;
        Ok((ctx, physical_plan, Some(lock), scan_stats))
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
    search::datafusion::storage::file_list::clear(trace_id);
    // release wal lock files
    common::infra::wal::release_request(trace_id);
    log::info!("Cleared session for trace_id: {trace_id}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flight_service_impl_default() {
        let _impl = FlightServiceImpl;
    }
}

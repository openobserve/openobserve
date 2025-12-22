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
use config::{
    PARQUET_BATCH_SIZE, cluster::LOCAL_NODE, datafusion::request::FlightSearchRequest,
    meta::search::ScanStats,
};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::{ExecutionPlan, coalesce_batches::CoalesceBatchesExec, execute_stream},
};
use flight::common::{MetricsInfo, PreCustomMessage};
use futures::{StreamExt, stream::BoxStream};
use futures_util::pin_mut;
use prost::Message;
use tonic::{Request, Response, Status, Streaming};
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::SEARCH_SERVER,
    o2_enterprise::enterprise::{common::config::get_config as get_o2_config, search::TaskStatus},
};

use crate::{
    handler::grpc::{
        MetadataMap,
        flight::{
            stream::FlightEncoderStreamBuilder,
            visitor::{
                get_cluster_metrics, get_peak_memory, get_peak_memory_from_ctx, get_scan_stats,
            },
        },
    },
    service::search::{
        grpc::flight as grpcFlight,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
        work_group::DeferredLock,
    },
};

mod stream;
pub mod visitor;

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

        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&MetadataMap(request.metadata()))
        });
        let span = tracing::info_span!("grpc:search:flight:do_get");
        let _ = span.set_parent(parent_cx);

        // decode ticket to RemoteExecNode
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

        // Note: all async should in this place, otherwise it will break tracing
        // https://docs.rs/tracing/latest/tracing/span/struct.Span.html#in-asynchronous-code
        let req_move = req.clone();
        let trace_id_move = trace_id.clone();
        let result = async move {
            #[cfg(feature = "enterprise")]
            if is_super_cluster && !SEARCH_SERVER.contain_key(&trace_id_move).await {
                // this is for work_group check in super cluster follower leader
                SEARCH_SERVER
                    .insert(
                        trace_id_move.clone(),
                        TaskStatus::new_follower(vec![], false),
                    )
                    .await;
            }

            let result = get_ctx_and_physical_plan(&trace_id_move, &req_move).await;

            #[cfg(feature = "enterprise")]
            if is_super_cluster && !SEARCH_SERVER.is_leader(&trace_id_move).await {
                // this is for work_group check in super cluster follower leader
                SEARCH_SERVER.remove(&trace_id_move, false).await;
            }

            result
        }
        .instrument(span.clone())
        .await;

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

        // prepare dataufion context
        let (ctx, physical_plan, lock, scan_stats) = match result {
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
        // https://github.com/openobserve/openobserve/issues/8280
        // https://github.com/apache/datafusion/pull/11587
        // add coalesce batches exec to trigger StringView gc to reduce memory usage
        let physical_plan: Arc<dyn ExecutionPlan> =
            Arc::new(CoalesceBatchesExec::new(physical_plan, PARQUET_BATCH_SIZE));

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

        // used for EXPLAIN ANALYZE to collect metrics after stream is done
        let metrics = req.search_info.is_analyze.then_some(MetricsInfo {
            plan: physical_plan.clone(),
            is_super_cluster,
            func: Box::new(super_cluster_enabled),
        });

        // Get the peak memory usage from the memory pool
        // Note: We get peak memory after stream execution, so we pass it via a shared reference
        let peak_memory = get_peak_memory_from_ctx(&ctx);

        // used for super cluster follower leader to get information from follower node
        let scan_stats_ref = get_scan_stats(&physical_plan);
        let metrics_ref = get_cluster_metrics(&physical_plan);
        let peak_memory_ref = get_peak_memory(&physical_plan);

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
            .with_is_super(is_super_cluster)
            .with_defer_lock(lock)
            .with_start(start)
            .with_custom_message(PreCustomMessage::ScanStats(scan_stats))
            .with_custom_message(PreCustomMessage::ScanStatsRef(scan_stats_ref))
            .with_custom_message(PreCustomMessage::Metrics(metrics))
            .with_custom_message(PreCustomMessage::MetricsRef(metrics_ref))
            .with_custom_message(PreCustomMessage::PeakMemoryRef(Some(peak_memory)))
            .with_custom_message(PreCustomMessage::PeakMemoryRef(peak_memory_ref))
            .build(stream, span);

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
        let (ctx, physical_plan, lock, scan_stats) =
            crate::service::search::super_cluster::follower::search(trace_id, req).await?;
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
    crate::service::search::datafusion::storage::file_list::clear(trace_id);
    // release wal lock files
    crate::common::infra::wal::release_request(trace_id);
    log::info!("Cleared session for trace_id: {trace_id}");
}

fn super_cluster_enabled() -> bool {
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        return true;
    }
    false
}

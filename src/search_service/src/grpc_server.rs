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

use common::meta::grpc::MetadataMap;
use config::{
    meta::{search, stream::StreamType},
    utils::json,
};
use proto::cluster_rpc::{
    CancelQueryRequest, CancelQueryResponse, DeleteResultRequest, DeleteResultResponse,
    GetLicenseUsageRequest, GetLicenseUsageResponse, GetResultRequest, GetResultResponse,
    GetSourcemapFileRequest, GetSourcemapFileResponse, GetTableRequest, GetTableResponse,
    GetWorkflowInputsRequest, GetWorkflowInputsResponse, QueryStatusRequest, QueryStatusResponse,
    SearchPartitionRequest, SearchPartitionResponse, SearchRequest, SearchResponse,
    search_server::Search,
};
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {
    config::metrics,
    o2_enterprise::enterprise::search::{WorkGroup, admission::ledger::NODE_LEDGER},
    proto::cluster_rpc::{
        ReleaseQueryRequest, ReleaseQueryResponse, StartQueryRequest, StartQueryResponse,
        TryAcquireRequest, TryAcquireResponse, UsageResult,
    },
    std::str::FromStr,
};

use crate as SearchService;
pub use crate::Searcher;

#[tonic::async_trait]
impl Search for Searcher {
    #[tracing::instrument(name = "grpc:search:search", skip_all)]
    async fn search(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&MetadataMap(req.metadata()))
        });
        let _ = tracing::Span::current().set_parent(parent_cx.clone());

        let start = std::time::Instant::now();
        let req = req.into_inner();
        let request = json::from_slice::<search::Request>(&req.request)
            .map_err(|e| Status::internal(format!("failed to parse search request: {e}")))?;
        let stream_type = StreamType::from(req.stream_type.as_str());
        let ret = SearchService::cache::search(
            &req.trace_id,
            &req.org_id,
            stream_type,
            req.user_id.clone(),
            &request,
            "".to_string(),
            false,
            None,
            false,
        )
        .await;

        match ret {
            Ok(mut ret) => {
                ret.set_took(start.elapsed().as_millis() as usize);
                let response = json::to_vec(&ret).map_err(|e| {
                    Status::internal(format!("failed to serialize search response: {e}"))
                })?;
                Ok(Response::new(SearchResponse {
                    trace_id: req.trace_id,
                    response,
                }))
            }
            Err(e) => Err(Status::internal(format!("search failed: {e}"))),
        }
    }

    #[tracing::instrument(name = "grpc:search:search_multi", skip_all)]
    async fn search_multi(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&MetadataMap(req.metadata()))
        });
        let _ = tracing::Span::current().set_parent(parent_cx.clone());

        let req = req.into_inner();
        let request =
            json::from_slice::<search::MultiStreamRequest>(&req.request).map_err(|e| {
                Status::internal(format!("failed to parse multi-stream search request: {e}"))
            })?;
        let stream_type = StreamType::from(req.stream_type.as_str());
        let ret =
            SearchService::search_multi(&req.trace_id, &req.org_id, stream_type, None, &request)
                .await;

        match ret {
            Ok(ret) => {
                let response = json::to_vec(&ret).map_err(|e| {
                    Status::internal(format!("failed to serialize search response: {e}"))
                })?;
                Ok(Response::new(SearchResponse {
                    trace_id: req.trace_id,
                    response,
                }))
            }
            Err(e) => Err(Status::internal(format!("search failed: {e}"))),
        }
    }

    async fn search_partition(
        &self,
        req: Request<SearchPartitionRequest>,
    ) -> Result<Response<SearchPartitionResponse>, Status> {
        let req = req.into_inner();
        let request =
            json::from_slice::<search::SearchPartitionRequest>(&req.request).map_err(|e| {
                Status::internal(format!("failed to parse search partition request: {e}"))
            })?;
        let stream_type = StreamType::from(req.stream_type.as_str());
        let ret = SearchService::search_partition(
            &req.trace_id,
            &req.org_id,
            req.max_query_range,
            stream_type,
            &request,
            req.skip_max_query_range,
            true, // allow streamings aggs cache for grpc search partition
        )
        .await;

        match ret {
            Ok(ret) => {
                let response = json::to_vec(&ret).map_err(|e| {
                    Status::internal(format!(
                        "failed to serialize search partition response: {e}"
                    ))
                })?;
                Ok(Response::new(SearchPartitionResponse {
                    trace_id: req.trace_id,
                    response,
                }))
            }
            Err(e) => Err(Status::internal(format!("search partition failed: {e}"))),
        }
    }

    async fn get_table(
        &self,
        req: Request<GetTableRequest>,
    ) -> Result<Response<GetTableResponse>, Status> {
        let path = req.into_inner().path;
        let res = infra::storage::get_bytes("", &path)
            .await
            .map_err(|e| Status::internal(format!("failed to get table: {e}")))?;
        Ok(Response::new(GetTableResponse { data: res.to_vec() }))
    }

    #[cfg(feature = "enterprise")]
    async fn get_result(
        &self,
        req: Request<GetResultRequest>,
    ) -> Result<Response<GetResultResponse>, Status> {
        let path = req.into_inner().path;
        let res = infra::storage::get_bytes("", &path)
            .await
            .map_err(|e| Status::internal(format!("failed to get result: {e}")))?;
        Ok(Response::new(GetResultResponse {
            response: res.to_vec(),
        }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn get_result(
        &self,
        _req: Request<GetResultRequest>,
    ) -> Result<Response<GetResultResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn delete_result(
        &self,
        req: Request<DeleteResultRequest>,
    ) -> Result<Response<DeleteResultResponse>, Status> {
        let paths = req.into_inner().paths;
        let paths = paths
            .iter()
            .map(|path| ("", path.as_str()))
            .collect::<Vec<_>>();
        let _ = infra::storage::del(paths)
            .await
            .map_err(|e| Status::internal(format!("failed to delete result: {e}")))?;
        Ok(Response::new(DeleteResultResponse {}))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn delete_result(
        &self,
        _req: Request<DeleteResultRequest>,
    ) -> Result<Response<DeleteResultResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn query_status(
        &self,
        _req: Request<QueryStatusRequest>,
    ) -> Result<Response<QueryStatusResponse>, Status> {
        let status = self.get_task_status().await;
        Ok(Response::new(QueryStatusResponse { status }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn query_status(
        &self,
        _req: Request<QueryStatusRequest>,
    ) -> Result<Response<QueryStatusResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn cancel_query(
        &self,
        req: Request<CancelQueryRequest>,
    ) -> Result<Response<CancelQueryResponse>, Status> {
        let trace_id = req.into_inner().trace_id;
        if let Some(cancelled) = self.remove(&trace_id, true).await {
            for (_, senders) in cancelled {
                for sender in senders.abort_senders.into_iter().rev() {
                    let _ = sender.send(());
                }
                metrics::QUERY_CANCELED_NUMS
                    .with_label_values(&[&senders.org_id.unwrap_or_default()])
                    .inc();
            }
        }
        Ok(Response::new(CancelQueryResponse { is_success: true }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn cancel_query(
        &self,
        _req: Request<CancelQueryRequest>,
    ) -> Result<Response<CancelQueryResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn cluster_cancel_query(
        &self,
        req: Request<CancelQueryRequest>,
    ) -> Result<Response<CancelQueryResponse>, Status> {
        use crate as SearchService;

        let trace_id = req.into_inner().trace_id;
        if let Err(e) = SearchService::cancel_query("", &trace_id).await {
            log::error!("failed to cancel query: {e}");
        }
        Ok(Response::new(CancelQueryResponse { is_success: true }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn cluster_cancel_query(
        &self,
        _req: Request<CancelQueryRequest>,
    ) -> Result<Response<CancelQueryResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    async fn get_sourcemap_file(
        &self,
        req: Request<GetSourcemapFileRequest>,
    ) -> Result<Response<GetSourcemapFileResponse>, Status> {
        let req = req.into_inner();
        log::info!(
            "got get request for sourcemap file : {}/{} at {}",
            req.org_id,
            req.original_name,
            req.path
        );

        let res = infra::storage::get_bytes("", &req.path)
            .await
            .map_err(|e| {
                Status::internal(format!(
                    "failed to get sourcemap for {}/{} at path {}: {e}",
                    req.org_id, req.original_name, req.path
                ))
            })?;
        Ok(Response::new(GetSourcemapFileResponse {
            file_data: res.to_vec(),
        }))
    }
    async fn get_license_usage_info(
        &self,
        _: Request<GetLicenseUsageRequest>,
    ) -> Result<Response<GetLicenseUsageResponse>, Status> {
        #[cfg(not(feature = "enterprise"))]
        let res = GetLicenseUsageResponse {
            search_allowed: true,
            ingestion_used: 0.0,
            ingestion_limit_exceeded_count: 0,
            last_reporting_successful: true,
            last_reporting_timestamp: chrono::Utc::now().timestamp_micros(),
            days_since_last_report: 0,
            last_usage_response: "".into(),
            ingestion_history: Vec::new(),
        };

        #[cfg(feature = "enterprise")]
        let res = {
            let ingestion_history =
                o2_enterprise::enterprise::license::get_ingestion_history().await;
            let ingestion_history = ingestion_history
                .into_iter()
                .map(|v| UsageResult {
                    ts: v.ts,
                    value: v.value,
                })
                .collect();
            GetLicenseUsageResponse {
                search_allowed: o2_enterprise::enterprise::license::search_allowed(),
                ingestion_used: o2_enterprise::enterprise::license::ingestion_used(),
                ingestion_limit_exceeded_count:
                    o2_enterprise::enterprise::license::ingestion_limit_exceeded_count() as u32,
                last_reporting_successful:
                    o2_enterprise::enterprise::license::last_reporting_successful().await,
                last_reporting_timestamp:
                    o2_enterprise::enterprise::license::last_reported_timestamp().await,
                days_since_last_report: o2_enterprise::enterprise::license::days_since_last_report()
                    .await as u32,
                last_usage_response: o2_enterprise::enterprise::license::get_usage_resp_string()
                    .await,
                ingestion_history,
            }
        };
        Ok(Response::new(res))
    }
    // --- Slot-based admission RPCs ---

    #[cfg(feature = "enterprise")]
    async fn try_acquire(
        &self,
        req: Request<TryAcquireRequest>,
    ) -> Result<Response<TryAcquireResponse>, Status> {
        let r = req.into_inner();
        let wg = WorkGroup::from_str(&r.work_group).unwrap_or(WorkGroup::Short);
        match NODE_LEDGER.try_acquire(&r.trace_id, &wg, r.ttl_ms) {
            Ok(()) => Ok(Response::new(TryAcquireResponse {
                success: true,
                reason: String::new(),
            })),
            Err(reason) => Ok(Response::new(TryAcquireResponse {
                success: false,
                reason,
            })),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    async fn try_acquire(
        &self,
        _req: Request<proto::cluster_rpc::TryAcquireRequest>,
    ) -> Result<Response<proto::cluster_rpc::TryAcquireResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn start_query(
        &self,
        req: Request<StartQueryRequest>,
    ) -> Result<Response<StartQueryResponse>, Status> {
        let trace_id = req.into_inner().trace_id;
        match NODE_LEDGER.start(&trace_id) {
            Ok(()) => Ok(Response::new(StartQueryResponse {
                success: true,
                reason: String::new(),
            })),
            Err(reason) => Ok(Response::new(StartQueryResponse {
                success: false,
                reason,
            })),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    async fn start_query(
        &self,
        _req: Request<proto::cluster_rpc::StartQueryRequest>,
    ) -> Result<Response<proto::cluster_rpc::StartQueryResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn release_query(
        &self,
        req: Request<ReleaseQueryRequest>,
    ) -> Result<Response<ReleaseQueryResponse>, Status> {
        let trace_id = req.into_inner().trace_id;
        NODE_LEDGER.release(&trace_id);
        Ok(Response::new(ReleaseQueryResponse { success: true }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn release_query(
        &self,
        _req: Request<proto::cluster_rpc::ReleaseQueryRequest>,
    ) -> Result<Response<proto::cluster_rpc::ReleaseQueryResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn get_workflow_inputs(
        &self,
        req: Request<GetWorkflowInputsRequest>,
    ) -> Result<Response<GetWorkflowInputsResponse>, Status> {
        let req = req.into_inner();

        let org_id = req.org_id;
        let w_id = req.workflow_id;
        let r_id = req.run_id;
        let is_errors = req.is_error_data;

        log::info!(
            "got get request for inputs data for {org_id}/{w_id}/{r_id} error data {is_errors}"
        );

        let data = if is_errors {
            let err = infra::table::workflows::get_errors_for_run(&org_id, &w_id, &r_id)
                .await
                .map_err(|e| {
                    log::error!("error getting workflow errors for {org_id}/{w_id}/{r_id} : {e}");
                    Status::internal(format!("error getting workflow error : {e}"))
                })?;
            match err {
                Some(v) => {
                    if let Some(v) = v.input_data {
                        v
                    } else {
                        log::error!(
                            "workflow errors input data for {org_id}/{w_id}/{r_id} not present in the cluster"
                        );
                        return Err(Status::internal(
                            "workflow error data not stored".to_string(),
                        ));
                    }
                }
                None => {
                    log::error!("workflow errors for {org_id}/{w_id}/{r_id} not found");
                    return Err(Status::internal("workflow error not found".to_string()));
                }
            }
        } else {
            let err = infra::table::workflows::get_run_data(&org_id, &w_id, &r_id)
                .await
                .map_err(|e| {
                    log::error!("error getting workflow rn data for {org_id}/{w_id}/{r_id} : {e}");
                    Status::internal(format!("error getting workflow run data : {e}"))
                })?;
            match err {
                Some(v) => v,
                None => {
                    log::error!("workflow run data for {org_id}/{w_id}/{r_id} not found");
                    return Err(Status::internal("workflow run data not found".to_string()));
                }
            }
        };

        Ok(Response::new(GetWorkflowInputsResponse { data }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn get_workflow_inputs(
        &self,
        _req: Request<GetWorkflowInputsRequest>,
    ) -> Result<Response<GetWorkflowInputsResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }
}

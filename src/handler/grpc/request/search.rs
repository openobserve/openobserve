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

use config::metrics;
use infra::errors;
use proto::cluster_rpc::{
    search_server::Search, CancelJobRequest, CancelJobResponse, JobStatusRequest,
    JobStatusResponse, SearchRequest, SearchResponse,
};
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::service::search as SearchService;

#[derive(Clone, Debug)]
#[cfg(feature = "enterprise")]
pub struct Searcher {
    pub task_manager: std::sync::Arc<o2_enterprise::enterprise::search::TaskManager>,
}

#[cfg(feature = "enterprise")]
impl Searcher {
    pub fn new() -> Self {
        Self {
            task_manager: std::sync::Arc::new(o2_enterprise::enterprise::search::TaskManager::new()),
        }
    }

    // check is the trace_id in the task_manager
    pub async fn contain_key(&self, trace_id: &str) -> bool {
        self.task_manager.contain_key(trace_id).await
    }

    // insert the trace_id and task_status into the task_manager
    pub async fn insert(
        &self,
        trace_id: String,
        task_status: o2_enterprise::enterprise::search::TaskStatus,
    ) {
        self.task_manager.insert(trace_id, task_status).await;
    }

    // remove the trace_id from the task_manager
    pub async fn remove(
        &self,
        trace_id: &str,
    ) -> Option<(String, o2_enterprise::enterprise::search::TaskStatus)> {
        self.task_manager.remove(trace_id).await
    }

    // check is the trace_id in the task_manager and is_leader
    pub async fn is_leader(&self, trace_id: &str) -> bool {
        self.task_manager.is_leader(trace_id).await
    }

    // insert the sender into the task_manager by trace_id
    pub async fn insert_sender(
        &self,
        trace_id: &str,
        sender: tokio::sync::oneshot::Sender<()>,
    ) -> Result<(), infra::errors::Error> {
        self.task_manager.insert_sender(trace_id, sender).await
    }

    // get all task status that is leader
    pub async fn get_task_status(&self) -> Vec<proto::cluster_rpc::JobStatus> {
        self.task_manager.get_task_status().await
    }

    // add file stats
    pub async fn add_file_stats(
        &self,
        trace_id: &str,
        files: i64,
        records: i64,
        original_size: i64,
        compressed_size: i64,
    ) {
        self.task_manager
            .add_file_stats(trace_id, files, records, original_size, compressed_size)
            .await;
    }
}

#[derive(Clone, Debug)]
#[cfg(not(feature = "enterprise"))]
pub struct Searcher;

#[cfg(not(feature = "enterprise"))]
impl Searcher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new()
    }
}

#[tonic::async_trait]
impl Search for Searcher {
    #[tracing::instrument(name = "grpc:search:enter", skip_all, fields(trace_id=req.get_ref().job.as_ref().unwrap().trace_id, org_id = req.get_ref().org_id))]
    async fn search(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref().to_owned();
        let org_id = req.org_id.clone();
        let stream_type = req.stream_type.clone();

        // set search task
        #[cfg(feature = "enterprise")]
        let trace_id = req.job.as_ref().unwrap().trace_id.to_string();
        #[cfg(feature = "enterprise")]
        if !self.contain_key(&trace_id).await {
            self.insert(
                trace_id.clone(),
                o2_enterprise::enterprise::search::TaskStatus::new(
                    vec![],
                    false,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            )
            .await;
        }

        let result = SearchService::grpc::search(&req).await;

        // remove task
        #[cfg(feature = "enterprise")]
        if !self.is_leader(&trace_id).await {
            self.remove(&trace_id).await;
        }

        match result {
            Ok(res) => {
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
                    .inc();

                Ok(Response::new(res))
            }
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                    .inc();
                let message = if let errors::Error::ErrorCode(code) = err {
                    code.to_json()
                } else {
                    err.to_string()
                };
                Err(Status::internal(message))
            }
        }
    }

    #[tracing::instrument(name = "grpc:cluster_search:enter", skip_all, fields(trace_id=req.get_ref().job.as_ref().unwrap().trace_id, org_id = req.get_ref().org_id))]
    async fn cluster_search(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = opentelemetry::global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref().to_owned();
        let org_id = req.org_id.clone();
        let stream_type = req.stream_type.clone();

        // set search task
        #[cfg(feature = "enterprise")]
        let trace_id = req.job.as_ref().unwrap().trace_id.to_string();
        #[cfg(feature = "enterprise")]
        if !self.contain_key(&trace_id).await {
            self.insert(
                trace_id.clone(),
                o2_enterprise::enterprise::search::TaskStatus::new(
                    vec![],
                    false,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            )
            .await;
        }

        let result = SearchService::cluster::grpc::search(req).await;

        // remove task
        #[cfg(feature = "enterprise")]
        if !self.is_leader(&trace_id).await {
            self.remove(&trace_id).await;
        }

        match result {
            Ok(res) => {
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
                    .inc();

                Ok(Response::new(res))
            }
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                    .inc();
                let message = if let errors::Error::ErrorCode(code) = err {
                    code.to_json()
                } else {
                    err.to_string()
                };
                Err(Status::internal(message))
            }
        }
    }

    #[cfg(feature = "enterprise")]
    async fn job_status(
        &self,
        _req: Request<JobStatusRequest>,
    ) -> Result<Response<JobStatusResponse>, Status> {
        let status = self.get_task_status().await;
        Ok(Response::new(JobStatusResponse { status }))
    }

    #[cfg(not(feature = "enterprise"))]
    async fn job_status(
        &self,
        _req: Request<JobStatusRequest>,
    ) -> Result<Response<JobStatusResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }

    #[cfg(feature = "enterprise")]
    async fn cancel_job(
        &self,
        req: Request<CancelJobRequest>,
    ) -> Result<Response<CancelJobResponse>, Status> {
        let trace_id = req.into_inner().trace_id;
        match self.remove(&trace_id).await {
            Some((_, senders)) => {
                for sender in senders.abort_senders.into_iter().rev() {
                    let _ = sender.send(());
                }
                Ok(Response::new(CancelJobResponse { is_success: true }))
            }
            None => Ok(Response::new(CancelJobResponse { is_success: false })),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    async fn cancel_job(
        &self,
        _req: Request<CancelJobRequest>,
    ) -> Result<Response<CancelJobResponse>, Status> {
        Err(Status::unimplemented("Not Supported"))
    }
}

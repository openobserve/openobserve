// Copyright 2023 Zinc Labs Inc.
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

use std::sync::Arc;

use config::metrics;
use dashmap::DashMap;
use infra::errors;
use tokio::sync::oneshot::Sender;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    handler::grpc::cluster_rpc::{
        search_server::Search, CancelJobRequest, CancelJobResponse, JobStatus, JobStatusRequest,
        JobStatusResponse, SearchRequest, SearchResponse,
    },
    service::search as SearchService,
};

#[derive(Clone, Debug)]
pub struct Searcher {
    pub task_manager: Arc<DashMap<String, TaskStatus>>,
}

impl Searcher {
    pub fn new() -> Self {
        Self {
            task_manager: Arc::new(DashMap::new()),
        }
    }
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new()
    }
}
#[derive(Debug)]
pub struct TaskStatus {
    // handle cancel query task
    pub abort_senders: Vec<Sender<()>>,
    // start time of the query task
    pub time: std::time::Instant,
    // is leader
    pub is_leader: bool,
    // is query in queue
    pub is_queue: bool,
    // the sql the task query
    pub sql: Option<String>,
    // time range of the task query
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    // the user of the query task
    pub user: Option<String>,
}

impl TaskStatus {
    pub fn new(
        is_leader: bool,
        abort_senders: Vec<Sender<()>>,
        sql: Option<String>,
        start_time: Option<i64>,
        end_time: Option<i64>,
        user: Option<String>,
    ) -> Self {
        Self {
            abort_senders,
            time: std::time::Instant::now(),
            is_leader,
            is_queue: true,
            sql,
            start_time,
            end_time,
            user,
        }
    }

    pub fn push(&mut self, sender: Sender<()>) {
        if self.is_queue {
            self.is_queue = false;
        }
        self.abort_senders.push(sender);
    }

    pub fn is_leader(&self) -> bool {
        self.is_leader
    }

    pub fn elapsed_time(&self) -> i64 {
        self.time.elapsed().as_secs_f64() as i64
    }
}

#[tonic::async_trait]
impl Search for Searcher {
    #[tracing::instrument(name = "grpc:search:enter", skip_all, fields(session_id=req.get_ref().job.as_ref().unwrap().session_id, org_id = req.get_ref().org_id))]
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
        let session_id = req.job.as_ref().unwrap().session_id.to_string();

        // set search task
        if !self.task_manager.contains_key(&session_id) {
            self.task_manager.insert(
                session_id.clone(),
                TaskStatus::new(false, vec![], None, None, None, None),
            );
        }

        let result = SearchService::grpc::search(&req).await;

        // remove task
        if self.task_manager.get(&session_id).is_some()
            && !self.task_manager.get(&session_id).unwrap().is_leader()
        {
            self.task_manager.remove(&session_id);
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

    async fn job_status(
        &self,
        _req: Request<JobStatusRequest>,
    ) -> Result<Response<JobStatusResponse>, Status> {
        let mut status = vec![];
        for pair in self.task_manager.iter() {
            if !pair.value().is_leader() {
                continue;
            }
            let session_id = pair.key();
            let value = pair.value();
            status.push(JobStatus {
                session_id: session_id.clone(),
                running_time: value.elapsed_time(),
                is_queue: value.is_queue,
                sql: value.sql.clone(),
                start_time: value.start_time,
                end_time: value.end_time,
                user: value.user.clone(),
            });
        }
        Ok(Response::new(JobStatusResponse { status }))
    }

    async fn cancel_job(
        &self,
        req: Request<CancelJobRequest>,
    ) -> Result<Response<CancelJobResponse>, Status> {
        let session_id = req.into_inner().session_id;
        match self.task_manager.remove(&session_id) {
            Some((_, senders)) => {
                for sender in senders.abort_senders.into_iter().rev() {
                    let _ = sender.send(());
                }
                Ok(Response::new(CancelJobResponse { success: true }))
            }
            None => Ok(Response::new(CancelJobResponse { success: false })),
        }
    }
}

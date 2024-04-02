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

use std::{collections::HashMap, sync::Arc};

use config::metrics;
use infra::errors;
use tokio::sync::{oneshot::Sender, RwLock};
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
    pub task_manager: Arc<TaskManager>,
}

#[derive(Debug)]
pub struct TaskManager {
    pub task_manager: Arc<RwLock<HashMap<String, TaskStatus>>>,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            task_manager: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    // check is the session_id in the task_manager
    pub async fn contain_key(&self, session_id: &str) -> bool {
        let read_guard = self.task_manager.read().await;
        read_guard.contains_key(session_id)
    }

    // insert the session_id and task_status into the task_manager
    pub async fn insert(&self, session_id: String, task_status: TaskStatus) {
        let mut write_guard = self.task_manager.write().await;
        write_guard.insert(session_id, task_status);
    }

    // remove the session_id from the task_manager
    pub async fn remove(&self, session_id: &str) -> Option<(String, TaskStatus)> {
        let mut write_guard = self.task_manager.write().await;
        write_guard.remove_entry(session_id)
    }

    // check is the session_id in the task_manager and is_leader
    pub async fn is_leader(&self, session_id: &str) -> bool {
        let read_guard = self.task_manager.read().await;
        if let Some(task_status) = read_guard.get(session_id) {
            task_status.is_leader()
        } else {
            false
        }
    }

    // insert the sender into the task_manager by session_id
    pub async fn insert_sender(&self, session_id: &str, sender: Sender<()>) {
        let mut write_guard = self.task_manager.write().await;
        if let Some(task_status) = write_guard.get_mut(session_id) {
            task_status.push(sender);
        }
    }

    // get all task status that is leader
    pub async fn get_task_status(&self) -> Vec<JobStatus> {
        let mut status = vec![];
        let read_guard = self.task_manager.read().await;
        for (session_id, value) in read_guard.iter() {
            if !value.is_leader() {
                continue;
            }
            status.push(JobStatus {
                session_id: session_id.clone(),
                query_start_time: value.query_start_time,
                is_queue: value.is_queue,
                user_id: value.user_id.clone(),
                org_id: value.org_id.clone(),
                stream_type: value.stream_type.clone(),
                sql: value.sql.clone(),
                start_time: value.start_time,
                end_time: value.end_time,
            });
        }
        status
    }
}

impl Searcher {
    pub fn new() -> Self {
        Self {
            task_manager: Arc::new(TaskManager::new()),
        }
    }

    // check is the session_id in the task_manager
    pub async fn contain_key(&self, session_id: &str) -> bool {
        self.task_manager.contain_key(session_id).await
    }

    // insert the session_id and task_status into the task_manager
    pub async fn insert(&self, session_id: String, task_status: TaskStatus) {
        self.task_manager.insert(session_id, task_status).await;
    }

    // remove the session_id from the task_manager
    pub async fn remove(&self, session_id: &str) -> Option<(String, TaskStatus)> {
        self.task_manager.remove(session_id).await
    }

    // check is the session_id in the task_manager and is_leader
    pub async fn is_leader(&self, session_id: &str) -> bool {
        self.task_manager.is_leader(session_id).await
    }

    // insert the sender into the task_manager by session_id
    pub async fn insert_sender(&self, session_id: &str, sender: Sender<()>) {
        self.task_manager.insert_sender(session_id, sender).await;
    }

    // get all task status that is leader
    pub async fn get_task_status(&self) -> Vec<JobStatus> {
        self.task_manager.get_task_status().await
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
    pub query_start_time: i64,
    // is leader
    pub is_leader: bool,
    // is query in queue
    pub is_queue: bool,
    // the user of the query task
    pub user_id: Option<String>,
    // the org id of the query task
    pub org_id: Option<String>,
    // the stream type of the query task
    pub stream_type: Option<String>,
    // the sql the task query
    pub sql: Option<String>,
    // time range of the query task in sql
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

impl TaskStatus {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        abort_senders: Vec<Sender<()>>,
        is_leader: bool,
        user_id: Option<String>,
        org_id: Option<String>,
        stream_type: Option<String>,
        sql: Option<String>,
        start_time: Option<i64>,
        end_time: Option<i64>,
    ) -> Self {
        Self {
            abort_senders,
            query_start_time: 0,
            is_leader,
            is_queue: true,
            user_id,
            org_id,
            stream_type,
            sql,
            start_time,
            end_time,
        }
    }

    pub fn push(&mut self, sender: Sender<()>) {
        if self.is_queue {
            self.is_queue = false;
            self.query_start_time = chrono::Utc::now().timestamp_micros();
        }
        self.abort_senders.push(sender);
    }

    pub fn is_leader(&self) -> bool {
        self.is_leader
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
        if !self.contain_key(&session_id).await {
            self.insert(
                session_id.clone(),
                TaskStatus::new(vec![], false, None, None, None, None, None, None),
            )
            .await;
        }

        let result = SearchService::grpc::search(&req).await;

        // remove task
        if !self.is_leader(&session_id).await {
            self.remove(&session_id).await;
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
        let status = self.get_task_status().await;
        Ok(Response::new(JobStatusResponse { status }))
    }

    async fn cancel_job(
        &self,
        req: Request<CancelJobRequest>,
    ) -> Result<Response<CancelJobResponse>, Status> {
        let session_id = req.into_inner().session_id;
        match self.remove(&session_id).await {
            Some((_, senders)) => {
                for sender in senders.abort_senders.into_iter().rev() {
                    let _ = sender.send(());
                }
                Ok(Response::new(CancelJobResponse { is_success: true }))
            }
            None => Ok(Response::new(CancelJobResponse { is_success: false })),
        }
    }
}

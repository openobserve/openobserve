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

#[cfg(feature = "enterprise")]
use {
    config::meta::search::ScanStats,
    o2_enterprise::enterprise::search::{QueryManager, TaskStatus, WorkGroup},
};

#[derive(Clone, Debug)]
#[cfg(feature = "enterprise")]
pub struct Searcher {
    pub query_manager: std::sync::Arc<QueryManager>,
}

#[cfg(feature = "enterprise")]
impl Searcher {
    pub fn new() -> Self {
        Self {
            query_manager: std::sync::Arc::new(QueryManager::new()),
        }
    }

    // check is the trace_id in the query_manager
    pub async fn contain_key(&self, trace_id: &str) -> bool {
        self.query_manager.contain_key(trace_id).await
    }

    // insert the trace_id and task_status into the query_manager
    pub async fn insert(&self, trace_id: String, task_status: TaskStatus) {
        self.query_manager.insert(trace_id, task_status).await;
    }

    // remove the trace_id from the query_manager
    pub async fn remove(
        &self,
        trace_id: &str,
        query_cancelled: bool,
    ) -> Option<Vec<(String, TaskStatus)>> {
        self.query_manager.remove(trace_id, query_cancelled).await
    }

    // check is the trace_id in the query_manager and is_leader
    pub async fn is_leader(&self, trace_id: &str) -> bool {
        self.query_manager.is_leader(trace_id).await
    }

    // insert the sender into the query_manager by trace_id
    pub async fn insert_sender(
        &self,
        trace_id: &str,
        sender: tokio::sync::oneshot::Sender<()>,
        query_start: bool,
    ) -> Result<(), infra::errors::Error> {
        self.query_manager
            .insert_sender(trace_id, sender, query_start)
            .await
    }

    // get all task status that is leader
    pub async fn get_task_status(&self) -> Vec<proto::cluster_rpc::QueryStatus> {
        let mut status = self.query_manager.get_task_status().await;
        if let Ok(runtime) = crate::grpc_runtime() {
            runtime.enrich_query_status(&mut status).await;
        }
        status
    }

    // add file stats
    pub async fn add_file_stats(&self, trace_id: &str, scan_stats: &ScanStats) {
        self.query_manager
            .add_file_stats(trace_id, scan_stats)
            .await;
    }

    // add work group
    pub async fn add_work_group(&self, trace_id: &str, work_group: Option<WorkGroup>) {
        self.query_manager
            .add_work_group(trace_id, work_group)
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

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "enterprise"))]
    use super::*;

    #[test]
    #[cfg(not(feature = "enterprise"))]
    fn test_searcher_new_unit_struct() {
        let _ = Searcher::new();
    }

    #[test]
    #[cfg(not(feature = "enterprise"))]
    #[allow(clippy::default_constructed_unit_structs)]
    fn test_searcher_default_calls_new() {
        let _ = Searcher::default();
    }
}

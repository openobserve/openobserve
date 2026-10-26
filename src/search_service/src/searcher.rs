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

use config::meta::search::SearchEventContext;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::{QueryManager, TaskStatus};
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::search::{QueryPhase, QueryRegistration, QueryTracker};

/// What query status shows for a leader query.
pub struct LeaderInfo<'a> {
    pub user_id: Option<&'a str>,
    pub stream_type: &'a str,
    pub sql: &'a str,
    pub start_time: i64,
    pub end_time: i64,
    pub search_type: Option<String>,
    pub search_event_context: Option<&'a SearchEventContext>,
}

#[derive(Clone, Debug)]
#[cfg(feature = "enterprise")]
pub struct Searcher {
    pub query_manager: QueryManager,
}

#[cfg(feature = "enterprise")]
impl Searcher {
    pub fn new() -> Self {
        Self {
            query_manager: QueryManager::new(),
        }
    }

    pub fn register_leader(
        &self,
        org_id: &str,
        trace_id: &str,
        info: LeaderInfo<'_>,
    ) -> QueryRegistration {
        let status = TaskStatus::new_leader(
            vec![],
            true,
            info.user_id.map(str::to_string),
            Some(org_id.to_string()),
            Some(info.stream_type.to_string()),
            Some(info.sql.to_string()),
            Some(info.start_time),
            Some(info.end_time),
            info.search_type,
            info.search_event_context.cloned(),
        );
        self.query_manager.register(org_id, trace_id, status)
    }

    pub fn register_follower(&self, org_id: &str, trace_id: &str) -> QueryRegistration {
        let status = TaskStatus::new_follower(vec![], false);
        self.query_manager.register(org_id, trace_id, status)
    }

    /// Cancels `id` and its `{id}-` sub-queries in `org_id`, returning how many were cancelled.
    pub fn cancel(&self, org_id: &str, id: &str) -> usize {
        self.query_manager.cancel(org_id, id)
    }

    // get all task status that is leader
    pub async fn get_task_status(&self) -> Vec<proto::cluster_rpc::QueryStatus> {
        let mut status = self.query_manager.get_task_status();

        // Enrich dashboard searches submitted without names so query management can display the
        // dashboard and folder instead of only their IDs.
        for query_status in &mut status {
            if let Some(ref mut ctx) = query_status.search_event_context
                && matches!(query_status.search_type.as_deref(), Some("dashboards"))
                && let Some(dashboard_id) = &ctx.dashboard_id
                && ctx.dashboard_name.is_none()
                && let Some(org_id) = &query_status.org_id
                && let Ok(Some((folder, dashboard))) =
                    infra::table::dashboards::get_by_id(org_id, dashboard_id).await
            {
                ctx.dashboard_name = Some(dashboard.title().unwrap_or("").to_string());
                ctx.dashboard_folder_name = Some(folder.name);
                ctx.dashboard_folder_id = Some(folder.folder_id);
            }
        }

        status
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

    pub fn register_leader(
        &self,
        org_id: &str,
        trace_id: &str,
        _info: LeaderInfo<'_>,
    ) -> QueryRegistration {
        self.register_follower(org_id, trace_id)
    }

    pub fn register_follower(&self, _org_id: &str, trace_id: &str) -> QueryRegistration {
        QueryRegistration(QueryTracker {
            trace_id: trace_id.to_string(),
            query_id: config::ider::generate_query_id(trace_id),
        })
    }
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Without enterprise there is no query manager, so a query only carries its ids.
#[derive(Debug)]
#[cfg(not(feature = "enterprise"))]
#[must_use = "dropping the registration removes the query at once"]
pub struct QueryRegistration(QueryTracker);

#[cfg(not(feature = "enterprise"))]
impl QueryRegistration {
    pub fn tracker(&self) -> &QueryTracker {
        &self.0
    }

    pub fn finish(self) -> Option<String> {
        None
    }
}

#[derive(Clone, Debug)]
#[cfg(not(feature = "enterprise"))]
pub struct QueryTracker {
    trace_id: String,
    query_id: String,
}

#[cfg(not(feature = "enterprise"))]
impl QueryTracker {
    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn query_id(&self) -> &str {
        &self.query_id
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

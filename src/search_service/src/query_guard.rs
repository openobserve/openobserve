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
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

/// A leader query's registration: `finish` removes only that entry, an unfinished drop cancels it.
pub struct QueryGuard {
    org_id: String,
    query_id: String,
    finished: bool,
}

impl QueryGuard {
    pub fn new(org_id: &str, query_id: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            query_id: query_id.to_string(),
            finished: false,
        }
    }

    /// Removes the registration and returns the work group the query ran in, if known.
    pub async fn finish(mut self) -> Option<String> {
        self.finished = true;
        #[cfg(feature = "enterprise")]
        {
            let (_, stat) = crate::SEARCH_SERVER
                .remove(&self.org_id, &self.query_id)
                .await?;
            stat.work_group.as_ref().map(|wg| wg.to_string())
        }
        #[cfg(not(feature = "enterprise"))]
        None
    }
}

impl Drop for QueryGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let org_id = std::mem::take(&mut self.org_id);
        let query_id = std::mem::take(&mut self.query_id);
        log::info!("[trace_id {query_id}] query dropped before it finished, cancelling it");
        tokio::spawn(async move { cancel_query(&org_id, &query_id).await });
    }
}

/// Aborts a spawned task when dropped, so the task cannot outlive the request that owns it.
pub struct AbortOnDrop(pub tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(feature = "enterprise")]
async fn cancel_query(org_id: &str, query_id: &str) {
    if get_o2_config().super_cluster.enabled {
        if let Err(e) =
            o2_enterprise::enterprise::super_cluster::search::cancel_query(Some(org_id), query_id)
                .await
        {
            log::error!("[trace_id {query_id}] failed to cancel dropped query: {e}");
        }
    } else if let Err(e) = crate::cancel_query(Some(org_id), query_id).await {
        log::error!("[trace_id {query_id}] failed to cancel dropped query: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn cancel_query(_org_id: &str, _query_id: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_abort_on_drop_aborts_task() {
        let task = tokio::spawn(std::future::pending::<()>());
        drop(AbortOnDrop(task.abort_handle()));
        assert!(task.await.unwrap_err().is_cancelled());
    }
}

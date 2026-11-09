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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::Duration,
};

use flight::profile::{NodeReport, NodeStatus};
use parking_lot::Mutex;
use tokio::sync::watch;

/// The shortest a node keeps a finished run's report for its caller to fetch.
const REPORT_TTL: Duration = Duration::from_secs(60);

pub(super) static REPORTS: LazyLock<ReportRegistry> =
    LazyLock::new(|| ReportRegistry::new(REPORT_TTL));

type ReportSender = Arc<watch::Sender<Option<NodeReport>>>;
type Entries = Arc<Mutex<HashMap<String, ReportSender>>>;

/// Reports of this node's EXPLAIN ANALYZE runs, keyed by job trace id, kept until fetched.
pub(super) struct ReportRegistry {
    entries: Entries,
    ttl: Duration,
}

impl ReportRegistry {
    pub(super) fn new(ttl: Duration) -> Self {
        Self {
            entries: Entries::default(),
            ttl,
        }
    }

    #[cfg(test)]
    pub(super) fn open(&self, key: &str) -> ReportSlot {
        self.open_for(key, Duration::ZERO)
    }

    /// The slot a run reports into, kept until fetched or the longer of `ttl` and `keep` after it.
    pub(super) fn open_for(&self, key: &str, keep: Duration) -> ReportSlot {
        let report = Arc::new(watch::channel(None).0);
        self.entries
            .lock()
            .insert(key.to_string(), Arc::clone(&report));
        ReportSlot {
            entries: Arc::clone(&self.entries),
            key: key.to_string(),
            ttl: keep.max(self.ttl),
            report: Some(report),
        }
    }

    /// Waits for the run's report and removes it; `None` if no run with this key is held.
    pub(super) async fn fetch(&self, key: &str) -> Option<NodeReport> {
        let mut rx = self.entries.lock().get(key)?.subscribe();
        let report = rx.wait_for(Option::is_some).await.ok()?.clone();
        self.entries.lock().remove(key);
        report
    }
}

/// Where one run delivers its report; a run that ends without one leaves it unavailable.
pub(crate) struct ReportSlot {
    entries: Entries,
    key: String,
    ttl: Duration,
    report: Option<ReportSender>,
}

impl ReportSlot {
    pub(crate) fn complete(mut self, report: NodeReport) {
        self.deliver(report);
    }

    fn deliver(&mut self, report: NodeReport) {
        let Some(sender) = self.report.take() else {
            return;
        };
        sender.send_replace(Some(report));
        let entries = Arc::clone(&self.entries);
        let key = std::mem::take(&mut self.key);
        let ttl = self.ttl;
        tokio::spawn(async move {
            tokio::time::sleep(ttl).await;
            entries.lock().remove(&key);
        });
    }
}

impl Drop for ReportSlot {
    fn drop(&mut self) {
        self.deliver(NodeReport {
            status: NodeStatus::Unavailable,
            plan: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(status: NodeStatus) -> NodeReport {
        NodeReport { status, plan: None }
    }

    #[tokio::test]
    async fn test_fetch_waits_for_a_run_still_finishing() {
        let registry = Arc::new(ReportRegistry::new(REPORT_TTL));
        let slot = registry.open("t-1");
        let fetch = tokio::spawn({
            let registry = Arc::clone(&registry);
            async move { registry.fetch("t-1").await }
        });
        tokio::task::yield_now().await;
        slot.complete(report(NodeStatus::Failed));
        assert_eq!(fetch.await.unwrap().unwrap().status, NodeStatus::Failed);
    }

    #[tokio::test]
    async fn test_dropped_slot_reports_unavailable() {
        let registry = ReportRegistry::new(REPORT_TTL);
        drop(registry.open("t-1"));
        let fetched = registry.fetch("t-1").await.unwrap();
        assert_eq!(fetched.status, NodeStatus::Unavailable);
    }

    #[tokio::test]
    async fn test_reports_expire_only_after_their_run_ends() {
        let ttl = Duration::from_millis(20);
        let registry = ReportRegistry::new(ttl);
        let running = registry.open("running");
        registry
            .open("done")
            .complete(report(NodeStatus::Completed));
        tokio::time::sleep(ttl * 3).await;
        assert!(registry.fetch("done").await.is_none());
        running.complete(report(NodeStatus::Completed));
        assert!(registry.fetch("running").await.is_some());
        registry
            .open_for("slow-caller", ttl * 100)
            .complete(report(NodeStatus::Completed));
        tokio::time::sleep(ttl * 3).await;
        assert!(registry.fetch("slow-caller").await.is_some());
    }
}

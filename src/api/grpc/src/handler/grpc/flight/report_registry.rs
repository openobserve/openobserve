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

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

//! Ends alert leases at their time and deletes temporary alerts after their grace.

use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};
use openobserve_core::alerts::leases::{self, SweepCount};

/// A lease ends within a minute of its time; 100 rows a pass covers far more than leases start.
const INTERVAL_SECS: u64 = 60;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        return;
    }
    spawn_pausable_job!("alert_lease_sweep", INTERVAL_SECS, {
        if holds_job_cluster_claim().await {
            sweep_once().await;
        }
    });
}

/// Every scheduler node of the claiming region sweeps; the claim's row lock splits the leases.
async fn holds_job_cluster_claim() -> bool {
    #[cfg(feature = "enterprise")]
    {
        super::anomaly_holds_job_cluster_claim().await
    }
    #[cfg(not(feature = "enterprise"))]
    {
        true
    }
}

async fn sweep_once() {
    match leases::sweep(now_micros()).await {
        Ok(count) if count != SweepCount::default() => log::info!(
            "[ALERT LEASE] sweep: {} ended, {} removed, {} left to a person's edit, {} unfinished undone, {} failed",
            count.ended,
            count.removed,
            count.superseded,
            count.undone,
            count.failed
        ),
        Ok(_) => {}
        Err(e) => log::error!("[ALERT LEASE] sweep failed: {e}"),
    }
}

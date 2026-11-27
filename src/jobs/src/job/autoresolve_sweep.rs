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

// Lapse AutoResolve plans nobody decided on and end runs whose turn or step went silent.

use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};
use openobserve_core::autoresolve::sweep::sweep;

const SWEEP_INTERVAL_SECS: u64 = 30;

// Runs are region-local and every move is conditional, so each region's scheduler nodes all
// sweep without a job-cluster claim. The gate is not checked: a closed gate must not strand runs.
pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[AUTORESOLVE_SWEEP] not a scheduler node, skipping");
        return;
    }
    spawn_pausable_job!("autoresolve_sweep", SWEEP_INTERVAL_SECS, {
        let counts = sweep(now_micros()).await;
        if !counts.is_empty() {
            log::info!(
                "[AUTORESOLVE_SWEEP] lapsed {}, failed {}, outcome unknown {}, check retried {}",
                counts.lapsed,
                counts.failed,
                counts.outcome_unknown,
                counts.check_retried
            );
        }
    });
}

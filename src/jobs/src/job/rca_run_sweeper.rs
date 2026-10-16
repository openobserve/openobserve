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

// Finalizes RCA runs whose turn ended on a lost node, and ends runs that stopped
// writing before a turn started as `failed`/`stale` (TH28, RR-40).

use config::{cluster::LOCAL_NODE, spawn_pausable_job};

const SWEEP_INTERVAL_SECS: u64 = 60;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[RCA_RUN_SWEEPER] not a scheduler node, skipping");
        return;
    }
    spawn_pausable_job!("rca_run_sweeper", SWEEP_INTERVAL_SECS, {
        match openobserve_core::alerts::rca_turn::sweep_rca_runs().await {
            Ok(0) => {}
            Ok(ended) => log::info!("[RCA_RUN_SWEEPER] ended {ended} runs"),
            Err(e) => log::error!("[RCA_RUN_SWEEPER] sweep failed: {e}"),
        }
    });
}

// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use openobserve_core::traces::agent_signals;

/// Not gated by `O2_SERVICE_GRAPH_ENABLED`: agent signals have no enable flag of their own.
pub async fn run() -> Result<(), anyhow::Error> {
    if !LOCAL_NODE.is_scheduler() {
        log::info!(
            "[AGENT_SIGNALS::JOB] Agent signals processor disabled on non-scheduler node (role: {:?})",
            LOCAL_NODE.role
        );
        return Ok(());
    }

    // seed before the macro's first sleep, which v1's first tick on this binary may outrun
    if let Err(e) = db::agent_signals::seed_offset_from_v1().await {
        log::warn!(
            "[AGENT_SIGNALS::JOB] Seeding the offset from v1 failed, the first tick retries: {e}"
        );
    }
    log::info!("[AGENT_SIGNALS::JOB] Agent signals processor is enabled");

    spawn_pausable_job!(
        "agent_signals",
        get_o2_config().agent_signals.processing_interval_secs,
        {
            log::debug!("[AGENT_SIGNALS::JOB] Running agent signals processing");
            if let Err(e) = agent_signals::process_agent_signals().await {
                log::error!("[AGENT_SIGNALS::JOB] Processing failed: {e}");
            }
        }
    );

    Ok(())
}

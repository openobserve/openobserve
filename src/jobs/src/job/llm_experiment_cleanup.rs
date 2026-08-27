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

//! Finishes the cleanup that early Experiment deletion starts.
//!
//! Deletion marks the Experiment unavailable in one transaction and leaves the
//! rest to this sweep, because no single commit spans PostgreSQL and the
//! streams (A2.6). The marker is the retry token: a failed or missed pass
//! changes nothing a user can see, and the next pass repeats exactly the same
//! work.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};

const CLEANUP_INTERVAL_SECS: u64 = 5 * 60;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[LLM_EXPERIMENT_CLEANUP] not a scheduler node, skipping");
        return;
    }
    if !o2_enterprise::enterprise::common::config::get_config()
        .llm_eval_config
        .enabled
    {
        log::debug!("[LLM_EXPERIMENT_CLEANUP] LLM evaluations disabled, skipping");
        return;
    }

    spawn_pausable_job!("llm_experiment_cleanup", CLEANUP_INTERVAL_SECS, {
        let now = chrono::Utc::now().timestamp_millis();
        match o2_enterprise::enterprise::llm_evaluations::experiment_deletion::purge_marked(now)
            .await
        {
            Ok(0) => log::debug!("[LLM_EXPERIMENT_CLEANUP] nothing marked for cleanup"),
            Ok(removed) => {
                log::info!("[LLM_EXPERIMENT_CLEANUP] removed {removed} deleted Experiment(s)")
            }
            Err(error) => {
                log::error!("[LLM_EXPERIMENT_CLEANUP] cleanup pass failed: {error}")
            }
        }
    });
}

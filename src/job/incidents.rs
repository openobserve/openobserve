// Copyright 2025 OpenObserve Inc.
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

//! Incident Management Background Jobs
//!
//! Handles periodic tasks for incident lifecycle management:
//! - Auto-resolution of stale incidents

use config::spawn_pausable_job;
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

pub async fn run() -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        let config = get_o2_config();
        if !config.incidents.enabled {
            log::info!("[INCIDENTS::JOB] Incident correlation is disabled");
            return Ok(());
        }

        if config.incidents.auto_resolve_after_minutes < 0 {
            log::info!(
                "[INCIDENTS::JOB] Auto-resolve is disabled (auto_resolve_after_minutes=-1), only manual resolution allowed"
            );
            return Ok(());
        }

        log::info!(
            "[INCIDENTS::JOB] Incident auto-resolve job enabled (interval: {}s, threshold: {}m)",
            config.incidents.cleanup_interval_secs,
            config.incidents.auto_resolve_after_minutes
        );

        spawn_pausable_job!(
            "incidents_auto_resolve",
            config.incidents.cleanup_interval_secs,
            {
                log::debug!("[INCIDENTS::JOB] Running incident auto-resolve");
                if let Err(e) = auto_resolve_stale_incidents().await {
                    log::error!("[INCIDENTS::JOB] Auto-resolve failed: {e}");
                }
            },
            sleep_after
        );
    }

    #[cfg(not(feature = "enterprise"))]
    {
        log::debug!("[INCIDENTS::JOB] Incident correlation is an enterprise feature");
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
async fn auto_resolve_stale_incidents() -> Result<(), anyhow::Error> {
    let config = get_o2_config();
    let threshold_minutes = config.incidents.auto_resolve_after_minutes;

    // Convert minutes to microseconds
    let threshold_micros = (threshold_minutes as i64) * 60 * 1_000_000;

    let resolved_count =
        infra::table::alert_incidents::auto_resolve_stale(threshold_micros).await?;

    if resolved_count > 0 {
        log::info!(
            "[INCIDENTS::JOB] Auto-resolved {} stale incidents (threshold: {} minutes)",
            resolved_count,
            threshold_minutes
        );
    } else {
        log::debug!("[INCIDENTS::JOB] No stale incidents to auto-resolve");
    }

    Ok(())
}

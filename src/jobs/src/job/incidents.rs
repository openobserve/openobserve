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

//! Incident Management Background Jobs
//!
//! Handles periodic tasks for incident lifecycle management:
//! - Auto-resolution of stale incidents
//! - Retention of ended and cancelled downtimes

use config::spawn_pausable_job;
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

const DOWNTIMES_SWEEP_INTERVAL_SECS: u64 = 24 * 3600;
const MICROS_PER_DAY: i64 = 86_400 * 1_000_000;

pub async fn run() -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        let config = get_o2_config();
        if config.downtimes.enabled {
            spawn_pausable_job!(
                "downtimes_retention",
                DOWNTIMES_SWEEP_INTERVAL_SECS,
                {
                    if let Err(e) = sweep_ended_downtimes().await {
                        log::error!("[DOWNTIMES::JOB] Retention sweep failed: {e}");
                    }
                },
                sleep_after
            );
        }

        if !config.incidents.enabled {
            log::info!("[INCIDENTS::JOB] Incident correlation is disabled");
            return Ok(());
        }

        if config.incidents.auto_resolve_after_minutes <= 0 {
            log::info!(
                "[INCIDENTS::JOB] Auto-resolve is disabled (auto_resolve_after_minutes=0), only manual resolution allowed"
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

    let (resolved_count, resolved_ids) =
        infra::table::alert_incidents::auto_resolve_stale(threshold_micros).await?;

    if resolved_count > 0 {
        log::info!(
            "[INCIDENTS::JOB] Auto-resolved {} stale incidents (threshold: {} minutes)",
            resolved_count,
            threshold_minutes
        );

        // Emit Resolved events for each auto-resolved incident
        for (org_id, incident_id) in &resolved_ids {
            if let Err(e) =
                openobserve_core::alerts::incidents::record_auto_resolved(org_id, incident_id).await
            {
                log::warn!(
                    "[INCIDENTS::JOB] Failed to record auto-resolve event for {}: {e}",
                    incident_id
                );
            }
        }
    } else {
        log::debug!("[INCIDENTS::JOB] No stale incidents to auto-resolve");
    }

    Ok(())
}

/// Each region sweeps its own table, so nothing is sent to other regions.
#[cfg(feature = "enterprise")]
async fn sweep_ended_downtimes() -> Result<(), anyhow::Error> {
    let cutoff = retention_cutoff(
        config::utils::time::now_micros(),
        get_o2_config().downtimes.retention_days,
    );
    let removed = db::downtimes::delete_ended_before(cutoff).await?;
    if removed > 0 {
        log::info!("[DOWNTIMES::JOB] Removed {removed} ended or cancelled downtimes");
    }
    Ok(())
}

fn retention_cutoff(now: i64, retention_days: i64) -> i64 {
    now.saturating_sub(retention_days.saturating_mul(MICROS_PER_DAY))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cutoff_is_retention_days_before_now() {
        assert_eq!(
            retention_cutoff(100 * MICROS_PER_DAY, 90),
            10 * MICROS_PER_DAY
        );
        assert_eq!(retention_cutoff(0, i64::MAX), -i64::MAX);
    }
}

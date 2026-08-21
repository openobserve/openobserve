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

//! Database Monitoring rollup job (design `db-monitoring/dbm-design-doc.md` §5).
//!
//! A dedicated windowed job — structurally the service-graph job
//! (scheduler-role-only, `spawn_pausable_job!`) but with NO enterprise cfg and
//! paced on the rollup's configured cadence
//! (`openobserve_core::db_monitoring::rollup::rollup_interval_secs`,
//! `ZO_DB_MONITORING_ROLLUP_INTERVAL_SECS`, default 900 s, clamped to
//! [60, 3600]). The cadence is read once when the job is spawned, so a changed
//! interval takes effect on restart.
//!
//! Deliberately not enterprise-gated: parts of DBM's read surface are
//! enterprise-only (deadlocks, blocked queries, table health), but this job
//! rolls up the `o2_db_*` columns on ordinary database spans — data every build
//! ingests — into `_o2_db_stats`, which backs the endpoints that stay OSS.

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job};

pub async fn run() -> Result<(), anyhow::Error> {
    // Only scheduler nodes run the DBM rollup job.
    if !LOCAL_NODE.is_scheduler() {
        log::info!(
            "[DB_MONITORING::JOB] rollup disabled on non-scheduler node (role: {:?})",
            LOCAL_NODE.role
        );
        return Ok(());
    }

    log::info!("[DB_MONITORING::JOB] Database Monitoring rollup job is enabled");

    spawn_pausable_job!(
        "db_monitoring_rollup",
        openobserve_core::db_monitoring::rollup::rollup_interval_secs(),
        {
            log::debug!("[DB_MONITORING::JOB] Running db stats rollup");
            if let Err(e) =
                openobserve_core::db_monitoring::rollup::process_db_monitoring().await
            {
                log::error!("[DB_MONITORING::JOB] Processing failed: {e}");
            }
        },
        sleep_after,
        pause_if: !get_config().db_monitoring.enabled
    );

    Ok(())
}

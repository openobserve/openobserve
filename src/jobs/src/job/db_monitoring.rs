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

//! Database Monitoring rollup job (design `docs/___databsepages/dbm-design-doc.md` §5).
//!
//! A dedicated, plain-OSS windowed job — structurally the service-graph job
//! (scheduler-role-only, `spawn_pausable_job!`) but with NO enterprise cfg:
//! DBM ships in all builds and paces on its own interval
//! (`ZO_DB_MONITORING_INTERVAL_SECS`, default 900 s).

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job};

pub async fn run() -> Result<(), anyhow::Error> {
    // Only scheduler nodes run the DBM rollup job.
    // (Ingester/querier/compactor/router nodes exit here.)
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
        get_config().db_monitoring.interval_secs,
        {
            log::debug!("[DB_MONITORING::JOB] Running db stats rollup");
            if let Err(e) =
                openobserve_core::traces::db_monitoring::rollup::process_db_monitoring().await
            {
                log::error!("[DB_MONITORING::JOB] Processing failed: {e}");
            }
        },
        sleep_after,
        pause_if: !get_config().db_monitoring.enabled
    );

    Ok(())
}

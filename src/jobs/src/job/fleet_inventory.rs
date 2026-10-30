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

//! Fleet inventory: every node's report flush; leader-only retention and rollout re-arming.

use std::collections::HashSet;

use common::infra::config::ORGANIZATIONS;
use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};
use o2_enterprise::enterprise::fleet::{
    inventory::{self, FLEET_CALLBACKS},
    rollouts,
};

const FLUSH_INTERVAL_SECS: u64 = 10;

/// Hourly, so a restart never postpones a deletion by a whole day.
const RETENTION_INTERVAL_SECS: u64 = 60 * 60;
const REARM_INTERVAL_SECS: u64 = 60;

pub fn run() {
    if !openobserve_core::fleet::enabled() {
        return;
    }

    spawn_pausable_job!("fleet_inventory_flush", FLUSH_INTERVAL_SECS, {
        flush().await;
    });

    if !LOCAL_NODE.is_scheduler() {
        return;
    }
    spawn_pausable_job!("fleet_collector_retention", RETENTION_INTERVAL_SECS, {
        if !crate::job::leader::is_alert_manager_leader().await {
            log::debug!("[FLEET_RETENTION] not leader, skipping this pass");
            continue;
        }
        match inventory::delete_stale(now_micros()).await {
            Ok(0) => {}
            Ok(n) => log::info!("[FLEET_RETENTION] deleted {n} stale collectors"),
            Err(e) => log::error!("[FLEET_RETENTION] sweep failed: {e}"),
        }
    });
    // Recovers a rollout job whose push was lost after its POST or rollback committed.
    spawn_pausable_job!("fleet_rollout_rearm", REARM_INTERVAL_SECS, {
        if !crate::job::leader::is_alert_manager_leader().await {
            continue;
        }
        match rollouts::rearm_missing_jobs(now_micros()).await {
            Ok(0) => {}
            Ok(n) => log::info!("[FLEET_ROLLOUT] re-armed {n} rollout jobs"),
            Err(e) => log::error!("[FLEET_ROLLOUT] re-arm sweep failed: {e}"),
        }
    });
}

/// The org cache is loaded at startup and kept current by the org watcher, so it needs no query.
async fn flush() {
    let orgs: HashSet<String> = ORGANIZATIONS.read().await.keys().cloned().collect();
    let conn = infra::db::get_orm_client_rw().await;
    if let Err(e) = FLEET_CALLBACKS
        .flush_with(conn, |org| orgs.contains(org))
        .await
    {
        log::error!("[FLEET] inventory flush failed, retrying next tick: {e}");
    }
}

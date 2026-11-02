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

// Retry failed and queued notification deliveries; once a day, retention and orphan episodes.

use std::sync::atomic::{AtomicU64, Ordering};

use config::{cluster::LOCAL_NODE, spawn_pausable_job};
use openobserve_core::alerts::notifications::delivery;

const SWEEP_INTERVAL_SECS: u64 = 60;
const DAILY_TICKS: u64 = 24 * 60;

static TICKS: AtomicU64 = AtomicU64::new(0);

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[NOTIFICATION_RETRY] not a scheduler node, skipping");
        return;
    }
    spawn_pausable_job!("notification_retry", SWEEP_INTERVAL_SECS, {
        match delivery::retry_tick().await {
            Ok(0) => {}
            Ok(sent) => log::info!("[NOTIFICATION_RETRY] resent {sent} deliveries"),
            Err(e) => log::error!("[NOTIFICATION_RETRY] pass failed: {e}"),
        }
        if TICKS
            .fetch_add(1, Ordering::Relaxed)
            .is_multiple_of(DAILY_TICKS)
        {
            daily().await;
        }
    });
}

async fn daily() {
    match delivery::retention_tick().await {
        Ok(0) => {}
        Ok(deleted) => log::info!("[NOTIFICATION_RETRY] deleted {deleted} expired deliveries"),
        Err(e) => log::error!("[NOTIFICATION_RETRY] retention failed: {e}"),
    }
    match delivery::close_orphan_episodes().await {
        Ok(0) => {}
        Ok(closed) => log::info!("[NOTIFICATION_RETRY] closed {closed} orphan episodes"),
        Err(e) => log::error!("[NOTIFICATION_RETRY] orphan check failed: {e}"),
    }
}

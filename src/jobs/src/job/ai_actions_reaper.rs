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

//! Clears ledger snapshots after their undo window, rows past retention, and expired turn marks.

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};

const SWEEP_INTERVAL_SECS: u64 = 3600;
const MICROS_PER_DAY: i64 = 86_400 * 1_000_000;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        return;
    }
    spawn_pausable_job!("ai_actions_reaper", SWEEP_INTERVAL_SECS, {
        if !is_sweeper().await {
            continue;
        }
        let now = now_micros();
        match infra::table::ai_actions::drop_expired_snapshots(now).await {
            Ok(0) => {}
            Ok(n) => log::info!("[AI_ACTIONS_REAPER] cleared the snapshots of {n} row(s)"),
            Err(e) => log::error!("[AI_ACTIONS_REAPER] snapshot sweep failed: {e}"),
        }
        match infra::table::ai_turn_marks::delete_expired(now).await {
            Ok(0) => {}
            Ok(n) => log::info!("[AI_ACTIONS_REAPER] removed {n} expired turn mark(s)"),
            Err(e) => log::error!("[AI_ACTIONS_REAPER] turn mark sweep failed: {e}"),
        }
        let Some(cutoff) = cutoff(now, get_config().limit.ai_actions_retention_days) else {
            continue;
        };
        match infra::table::ai_actions::delete_before(cutoff).await {
            Ok(0) => {}
            Ok(n) => log::info!("[AI_ACTIONS_REAPER] deleted {n} row(s) past retention"),
            Err(e) => log::error!("[AI_ACTIONS_REAPER] retention sweep failed: {e}"),
        }
    });
}

/// One scheduler node sweeps: the online one with the lowest uuid.
async fn is_sweeper() -> bool {
    match infra::cluster::get_cached_nodes(|node| {
        node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
    })
    .await
    {
        Some(mut nodes) if !nodes.is_empty() => {
            nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
            nodes[0].uuid == LOCAL_NODE.uuid
        }
        _ => true,
    }
}

/// `None` when retention is off (0 or less).
fn cutoff(now: i64, retention_days: i64) -> Option<i64> {
    (retention_days > 0).then(|| now.saturating_sub(retention_days.saturating_mul(MICROS_PER_DAY)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_are_kept_for_the_retention_and_zero_keeps_them_all() {
        assert_eq!(cutoff(100 * MICROS_PER_DAY, 90), Some(10 * MICROS_PER_DAY));
        assert_eq!(cutoff(100 * MICROS_PER_DAY, 0), None);
        assert_eq!(cutoff(100 * MICROS_PER_DAY, -1), None);
        assert_eq!(cutoff(0, i64::MAX), Some(-i64::MAX));
    }
}

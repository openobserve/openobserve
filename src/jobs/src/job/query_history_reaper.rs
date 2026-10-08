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

//! Deletes unstarred query history entries older than the retention.

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};

const SWEEP_INTERVAL_SECS: u64 = 3600;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        return;
    }

    spawn_pausable_job!(
        "query_history_reaper",
        SWEEP_INTERVAL_SECS,
        {
            let is_leader = match infra::cluster::get_cached_nodes(|node| {
                node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
            })
            .await
            {
                Some(mut nodes) if !nodes.is_empty() => {
                    nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                    nodes[0].uuid == LOCAL_NODE.uuid
                }
                _ => true,
            };
            if !is_leader {
                continue;
            }

            let Some(cutoff) = retention_cutoff_us(
                now_micros(),
                get_config().limit.query_history_retention_days,
            ) else {
                continue;
            };

            match infra::table::query_history::delete_unstarred_before(cutoff).await {
                Ok(0) => {}
                Ok(n) => log::info!("[QUERY_HISTORY_REAPER] deleted {n} expired entries"),
                Err(e) => log::error!("[QUERY_HISTORY_REAPER] sweep failed: {e}"),
            }
        },
        pause_if: get_config().limit.query_history_retention_days <= 0
    );
}

/// `None` when retention is disabled.
fn retention_cutoff_us(now_us: i64, retention_days: i64) -> Option<i64> {
    if retention_days <= 0 {
        return None;
    }
    let span_us = retention_days
        .saturating_mul(86_400)
        .saturating_mul(1_000_000);
    Some(now_us.saturating_sub(span_us))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_US: i64 = 86_400 * 1_000_000;
    const NOW: i64 = 1_750_000_000_000_000;

    #[test]
    fn the_cutoff_is_that_many_days_back() {
        assert_eq!(retention_cutoff_us(NOW, 14), Some(NOW - 14 * DAY_US));
        let backdated = NOW - 15 * DAY_US;
        assert!(backdated < retention_cutoff_us(NOW, 14).unwrap());
    }

    #[test]
    fn a_non_positive_retention_disables_the_sweep() {
        assert_eq!(retention_cutoff_us(NOW, 0), None);
        assert_eq!(retention_cutoff_us(NOW, -1), None);
    }

    #[test]
    fn the_default_retention_is_14_days() {
        if std::env::var("ZO_QUERY_HISTORY_RETENTION_DAYS").is_ok() {
            return;
        }
        assert_eq!(get_config().limit.query_history_retention_days, 14);
    }
}

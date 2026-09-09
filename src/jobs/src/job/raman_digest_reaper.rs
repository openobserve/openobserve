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

//! Retention for the raman digest rows, which no stream retention governs (spec 8.1).

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};
use infra::db::get_orm_client_rw;

/// Retention is measured in days, so an hourly pass needs no knob of its own.
const SWEEP_INTERVAL_SECS: u64 = 3600;

/// Not job-cluster gated: digests never replicate, so each region reaps the copy it holds.
pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[RAMAN_DIGEST_REAPER] not a scheduler node, skipping");
        return;
    }

    let retention_days = get_config().raman.retention_days;
    log::info!("[RAMAN_DIGEST_REAPER] initialized with retention: {retention_days}d");

    spawn_pausable_job!(
        "raman_digest_reaper",
        SWEEP_INTERVAL_SECS,
        {
            // Elect among scheduler nodes: the digest writer runs there, so its reaper does too.
            let uuids = infra::cluster::get_cached_nodes(|node| {
                node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
            })
            .await
            .map(|nodes| nodes.into_iter().map(|node| node.uuid).collect());
            if !is_sweep_leader(uuids, &LOCAL_NODE.uuid) {
                log::debug!("[RAMAN_DIGEST_REAPER] not leader, skipping this pass");
                continue;
            }

            let Some(cutoff) = retention_cutoff_us(now_micros(), get_config().raman.retention_days)
            else {
                continue;
            };

            let conn = get_orm_client_rw().await;
            match infra::table::raman::delete_digests_before(conn, cutoff).await {
                Ok(0) => {}
                Ok(n) => log::info!("[RAMAN_DIGEST_REAPER] deleted {n} expired digests"),
                Err(e) => log::error!("[RAMAN_DIGEST_REAPER] sweep failed: {e}"),
            }
        },
        pause_if: sweep_paused(get_config().raman.retention_days)
    );
}

/// Split out from the sweep because an off-by-1000 here empties the table in one pass.
fn retention_cutoff_us(now_us: i64, retention_days: i64) -> Option<i64> {
    if retention_days <= 0 {
        return None;
    }
    // Saturating: an absurd env var that wrapped negative would put the cutoff in the future.
    let span_us = retention_days
        .saturating_mul(86_400)
        .saturating_mul(1_000_000);
    Some(now_us.saturating_sub(span_us))
}

/// Takes retention alone, so no edit can quietly gate storage hygiene on ZO_RAMAN_ENABLED.
fn sweep_paused(retention_days: i64) -> bool {
    retention_days <= 0
}

/// One node per region sweeps; no cluster view means a single node, which must do the work.
fn is_sweep_leader(scheduler_uuids: Option<Vec<String>>, local_uuid: &str) -> bool {
    match scheduler_uuids {
        Some(mut uuids) if !uuids.is_empty() => {
            uuids.sort();
            uuids[0] == local_uuid
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_US: i64 = 86_400 * 1_000_000;
    const NOW: i64 = 1_757_000_000_000_000;

    #[test]
    fn the_cutoff_is_exactly_that_many_days_of_microseconds_back() {
        assert_eq!(retention_cutoff_us(NOW, 1), Some(NOW - DAY_US));
        assert_eq!(retention_cutoff_us(NOW, 365), Some(NOW - 365 * DAY_US));
    }

    /// A non-positive retention must not compute a cutoff: it lands at or after `now`.
    #[test]
    fn a_non_positive_retention_keeps_everything_instead_of_deleting_it() {
        assert_eq!(retention_cutoff_us(NOW, 0), None);
        assert_eq!(retention_cutoff_us(NOW, -1), None);
    }

    /// A wrapped span puts the cutoff in the future and empties the table in one pass.
    #[test]
    fn an_absurd_retention_moves_the_cutoff_backwards_not_forwards() {
        let cutoff = retention_cutoff_us(NOW, i64::MAX).unwrap();
        assert!(cutoff < NOW - 365 * DAY_US, "the span wrapped: {cutoff}");
    }

    #[test]
    fn the_sweep_is_paused_only_by_a_non_positive_retention() {
        assert!(sweep_paused(0));
        assert!(sweep_paused(-1));
        assert!(!sweep_paused(1));
        assert!(!sweep_paused(365));
    }

    #[test]
    fn the_lowest_uuid_among_the_online_scheduler_nodes_sweeps() {
        let nodes = Some(vec!["c".to_string(), "a".to_string(), "b".to_string()]);
        assert!(is_sweep_leader(nodes.clone(), "a"));
        assert!(!is_sweep_leader(nodes.clone(), "b"));
        assert!(!is_sweep_leader(nodes, "c"));
    }

    /// A node absent from the cluster view has no claim to a sweep another node holds.
    #[test]
    fn a_node_missing_from_the_cluster_view_does_not_sweep() {
        let nodes = Some(vec!["a".to_string(), "b".to_string()]);
        assert!(!is_sweep_leader(nodes, "z"));
    }

    /// No cluster view is a single-node deployment, not a reason to never reap.
    #[test]
    fn a_node_with_no_cluster_view_sweeps_on_its_own() {
        assert!(is_sweep_leader(None, "a"));
        assert!(is_sweep_leader(Some(Vec::new()), "a"));
    }

    /// A digest covers a 30-day window on a daily cadence, so a year is ~365 rows per org.
    #[test]
    fn the_default_retention_keeps_a_year_of_hygiene_history() {
        // `env_config` cannot be asked for a declared default, so an override is skipped.
        if std::env::var("ZO_RAMAN_RETENTION_DAYS").is_ok() {
            return;
        }
        assert_eq!(
            get_config().raman.retention_days,
            365,
            "ZO_RAMAN_RETENTION_DAYS must keep a year of digests by default"
        );
    }

    /// Gating on the deployment switch would freeze the table wherever raman is off.
    #[test]
    fn the_sweep_never_reads_the_deployment_switch() {
        // Spelled in two pieces so this assertion is not itself the thing it forbids.
        let switch = format!("{}.{}", "raman", "enabled");
        assert!(
            !include_str!("raman_digest_reaper.rs").contains(&switch),
            "retention is storage hygiene over rows already written, not part of the feature"
        );
    }
}

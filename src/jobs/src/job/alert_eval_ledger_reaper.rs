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

//! Retention for the alert availability ledger (S-16), mirroring
//! `alert_states::delete_transitions_before`.
//!
//! Unlike the group reaper next door this is **not** gated to the elected job
//! cluster. Retention deletes are not replicated — each region reaps the copy
//! it holds — so gating would leave every non-job cluster's ledger growing
//! without bound, and after a failover the new job cluster would inherit years
//! of it.
//!
//! Deleting is the only unsafe direction here: the ledger is what every alert
//! SLO measures against, and a row removed early reads as unmeasured time,
//! which lowers coverage and can freeze the SLO. That is why the default
//! retention exceeds the longest SLO window by a week rather than matching it.

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};

/// How often the sweep runs. Retention is measured in months, so this needs no
/// knob of its own — hourly keeps each pass small without letting a restart
/// loop skip a day's worth of expiry.
const SWEEP_INTERVAL_SECS: u64 = 3600;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[ALERT_EVAL_LEDGER_REAPER] not a scheduler node, skipping");
        return;
    }

    let retention_days = get_config().limit.alert_eval_ledger_retention_days;
    log::info!("[ALERT_EVAL_LEDGER_REAPER] initialized with retention: {retention_days}d");

    spawn_pausable_job!(
        "alert_eval_ledger_reaper",
        SWEEP_INTERVAL_SECS,
        {
            // Elect among scheduler nodes, the role this job runs on — the same
            // set the group reaper elects from, for the same reason: a dedicated
            // scheduler deployment does not overlap the querier set.
            let is_leader = match infra::cluster::get_cached_nodes(|node| {
                node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
            })
            .await
            {
                Some(mut nodes) if !nodes.is_empty() => {
                    nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                    nodes[0].uuid == LOCAL_NODE.uuid
                }
                // Same deliberate fallback as the other sweeps: with no cluster
                // view, assume single node and do the work.
                _ => true,
            };
            if !is_leader {
                log::debug!("[ALERT_EVAL_LEDGER_REAPER] not leader, skipping this pass");
                continue;
            }

            let Some(cutoff) = retention_cutoff_us(
                now_micros(),
                get_config().limit.alert_eval_ledger_retention_days,
            ) else {
                continue;
            };

            match infra::table::alert_eval_intervals::delete_before(cutoff).await {
                Ok(0) => {}
                Ok(n) => log::info!("[ALERT_EVAL_LEDGER_REAPER] deleted {n} expired intervals"),
                Err(e) => log::error!("[ALERT_EVAL_LEDGER_REAPER] sweep failed: {e}"),
            }
        },
        pause_if: get_config().limit.alert_eval_ledger_retention_days <= 0
    );
}

/// The instant before which intervals may be dropped, or `None` when retention
/// is disabled.
///
/// Split out from the sweep so the arithmetic is testable: an off-by-1000 here
/// deletes three months of history in one pass and the only symptom is SLOs
/// quietly freezing.
fn retention_cutoff_us(now_us: i64, retention_days: i64) -> Option<i64> {
    if retention_days <= 0 {
        return None;
    }
    // Saturating, not wrapping: `retention_days` is an unvalidated env var, and
    // an absurd one that wrapped to a negative span would put the cutoff far in
    // the *future* and empty the ledger in a single pass. Saturating sends the
    // same input the other way — keep everything.
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
    fn the_cutoff_is_exactly_that_many_days_of_microseconds_back() {
        assert_eq!(retention_cutoff_us(NOW, 1), Some(NOW - DAY_US));
        assert_eq!(retention_cutoff_us(NOW, 97), Some(NOW - 97 * DAY_US));
    }

    /// A non-positive retention means "keep everything". Computing a cutoff
    /// from it would put the cutoff at or after `now` and delete the entire
    /// ledger on the next pass.
    #[test]
    fn a_non_positive_retention_disables_the_sweep() {
        assert_eq!(retention_cutoff_us(NOW, 0), None);
        assert_eq!(retention_cutoff_us(NOW, -1), None);
    }

    /// An absurd retention must not wrap the span negative — that would put the
    /// cutoff after `now` and delete the entire ledger.
    #[test]
    fn an_absurd_retention_keeps_everything_rather_than_wrapping() {
        let cutoff = retention_cutoff_us(NOW, i64::MAX).unwrap();
        assert!(
            cutoff < NOW - 97 * DAY_US,
            "a saturating span must move the cutoff backwards, not forwards"
        );
    }

    /// The default must outlast the longest SLO window (90 days) with backfill
    /// headroom, or every 90-day alert SLO starts losing the history it
    /// measures against.
    ///
    /// Reads the effective config, since there is no way to ask `env_config`
    /// for a declared default — so an explicit override is skipped rather than
    /// failed. Setting one is the operator's business (and the help text says
    /// what it costs); shipping a default below the window would be ours.
    #[test]
    fn the_default_retention_covers_the_longest_slo_window() {
        if std::env::var("ZO_ALERT_EVAL_LEDGER_RETENTION_DAYS").is_ok() {
            return;
        }
        assert!(
            get_config().limit.alert_eval_ledger_retention_days >= 97,
            "ZO_ALERT_EVAL_LEDGER_RETENTION_DAYS must cover a 90d window plus headroom"
        );
    }
}

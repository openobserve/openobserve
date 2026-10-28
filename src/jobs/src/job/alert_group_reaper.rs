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

//! Multi-alert group lifecycle sweep — M-7 of `alerts_2.md`.
//!
//! Per-group state rows are written by the evaluation path, but nothing there
//! can retire them: a group that stops being returned produces no observation,
//! so its row would sit at `Critical` forever. This job is the other half —
//! it ages unobserved groups out on elapsed time, writes their final recovery
//! transition, and deletes the row once the grace period expires.
//!
//! **Absence is only trusted when it was proven.** The sweep refuses to age an
//! alert's groups unless that alert's last evaluation both succeeded and came
//! back complete enough for absence to mean anything (`may_age_groups`). Pure
//! elapsed time would turn a K-interval query outage into a wave of `Ok`
//! resolutions for groups that never recovered, followed by a wave of re-fires
//! when the query recovered — an alert storm manufactured out of an outage.

use std::collections::HashMap;

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::alerts::{
        alert::Alert,
        grouping::{
            GroupFate, GroupPageCompleteness, GroupPlan, SweepPlan, group_fate, may_age_groups,
            opt_out_evictions, plan_sweep,
        },
        recovery::ClosedGroupEpisode,
        state::{AlertState, ROLLUP_GROUP_KEY},
    },
    spawn_pausable_job,
    utils::time::now_micros,
};
use infra::table::alert_states::{GroupPlanWrite, PlanApply};
use openobserve_core::alerts::lifecycle::{self, ClearKind};

/// What a sweep's writes committed before they stopped; `error` is the write that stopped them.
#[derive(Debug, Default)]
struct SweepWrite<'a> {
    resolved: Vec<&'a GroupPlan>,
    reaped: usize,
    closed: Vec<ClosedGroupEpisode>,
    error: Option<anyhow::Error>,
}

/// Start the sweep. Alert-manager nodes only, one leader at a time — the work
/// is a whole-table scan of group state, and running it on every node would
/// multiply the writes and race resolutions against each other.
pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[ALERT_GROUP_REAPER] not a scheduler node, skipping");
        return;
    }

    let cfg = get_config();
    log::info!(
        "[ALERT_GROUP_REAPER] initialized with interval: {}s",
        cfg.limit.alert_group_sweep_interval
    );

    spawn_pausable_job!(
        "alert_group_reaper",
        cfg.limit.alert_group_sweep_interval,
        {
            // Elect among scheduler nodes, the role this job runs on: a
            // dedicated scheduler deployment does not overlap the
            // querier/ingester set, so electing from that set leaves the
            // sweep with no leader at all.
            let is_leader = match infra::cluster::get_cached_nodes(|node| {
                node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
            })
            .await
            {
                Some(mut nodes) if !nodes.is_empty() => {
                    nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                    nodes[0].uuid == LOCAL_NODE.uuid
                }
                // Same deliberate fallback as the other sweeps: if the cluster
                // view is unavailable, assume single node and do the work
                // rather than stalling group lifecycle indefinitely.
                _ => true,
            };
            if !is_leader {
                log::debug!("[ALERT_GROUP_REAPER] not leader, skipping this pass");
                continue;
            }

            // Before the job-cluster gate: ack retention deletes are not replicated, so each
            // region sweeps its own copy.
            sweep_ended_acks().await;

            // Within-cluster election is not enough once state rows replicate
            // across a super cluster: every region's leader would then sweep
            // the same rows. Only the elected job cluster may — its evaluator
            // is the one writing the fresh `last_seen` this sweep's decisions
            // rest on, and a reap-delete from anywhere else fans back out and
            // destroys the job cluster's live rows.
            #[cfg(feature = "enterprise")]
            if !is_job_cluster().await {
                continue;
            }

            if let Err(e) = sweep().await {
                log::error!("[ALERT_GROUP_REAPER] sweep failed: {e}");
            }
        }
    );
}

/// Whether this cluster holds the super-cluster scheduler claim, checked once
/// per pass. A KV read that fails skips the pass: a missed sweep costs one
/// interval, where sweeping without the gate costs live rows in another region.
#[cfg(feature = "enterprise")]
async fn is_job_cluster() -> bool {
    use o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config, super_cluster::kv,
    };

    if !get_o2_config().super_cluster.enabled {
        return true;
    }

    let job_cluster = match kv::scheduler::get_job_cluster().await {
        Ok(name) => name,
        Err(e) => {
            log::error!("[ALERT_GROUP_REAPER] could not read the job cluster, skipping pass: {e}");
            return false;
        }
    };
    let local = config::get_cluster_name();
    if job_cluster.is_empty() || job_cluster == local {
        return true;
    }

    // Same shape as the scheduling loop's check: defer only to a claimant that
    // is still there.
    let live = match kv::cluster::list_by_role_group(None).await {
        Ok(clusters) => clusters.into_iter().map(|c| c.name).collect::<Vec<_>>(),
        Err(e) => {
            log::error!("[ALERT_GROUP_REAPER] could not list clusters, skipping pass: {e}");
            return false;
        }
    };
    let run = may_sweep(&job_cluster, &local, &live);
    if !run {
        log::debug!("[ALERT_GROUP_REAPER] job cluster is {job_cluster}, skipping this pass");
    }
    run
}

/// The gate's decision, split out from the I/O that feeds it.
///
/// This follows the scheduler's election; it does not hold one of its own — the
/// reaper must never claim the job cluster, only obey it. So the two degenerate
/// states, an unclaimed key and a claim whose holder has departed, open the gate
/// for everyone rather than picking a winner. That is the deliberate direction:
/// refusing instead would freeze group lifecycle in every region until some
/// scheduler node restarts and re-registers, and in both of those states no
/// cluster is running the scheduling loop either, so there is no evaluator whose
/// writes a concurrent sweep could race. Resolutions written concurrently do
/// carry per-cluster `at` stamps and so replicate as separate transitions, but
/// `resolve_group_update` is a no-op against an already-resolved row — the
/// window closes after one replication lag.
#[cfg(feature = "enterprise")]
fn may_sweep(job_cluster: &str, local_cluster: &str, live_clusters: &[String]) -> bool {
    // The "is someone else holding this" half is shared with the synthetics
    // start gate, which asks the same question of the same key; only what each
    // does with an *unclaimed* key differs, and that difference is the reason
    // this stays a named function rather than an inlined call.
    !o2_enterprise::enterprise::super_cluster::kv::scheduler::claim_is_held_elsewhere(
        job_cluster,
        local_cluster,
        live_clusters,
    )
}

/// One pass over every alert that currently has per-group state rows.
async fn sweep() -> Result<(), anyhow::Error> {
    let alert_ids = infra::table::alert_states::list_alert_ids_with_groups().await?;
    if alert_ids.is_empty() {
        return Ok(());
    }

    let alerts = cached_alerts_by_id().await;
    let cfg = get_config();
    let grace = cfg
        .limit
        .alert_group_reap_grace_secs
        .saturating_mul(1_000_000);
    let k = cfg.limit.alert_group_disappearance_k;

    let (mut resolved, mut reaped, mut evicted) = (0usize, 0usize, 0usize);

    for alert_id in alert_ids {
        match sweep_alert(&alert_id, alerts.get(&alert_id), k, grace).await {
            Ok(counts) => {
                resolved += counts.0;
                reaped += counts.1;
                evicted += counts.2;
            }
            // One bad alert must not abort the pass — the rest still need
            // their groups retired.
            Err(e) => log::error!("[ALERT_GROUP_REAPER] alert {alert_id}: {e}"),
        }
    }

    if resolved > 0 || reaped > 0 || evicted > 0 {
        log::info!("[ALERT_GROUP_REAPER] resolved={resolved} reaped={reaped} evicted={evicted}");
    }
    Ok(())
}

/// Returns `(resolved, reaped, evicted)`.
async fn sweep_alert(
    alert_id: &str,
    alert: Option<&Alert>,
    k: i64,
    grace: i64,
) -> Result<(usize, usize, usize), anyhow::Error> {
    let groups = infra::table::alert_states::list_groups(alert_id).await?;
    if groups.is_empty() {
        return Ok((0, 0, 0));
    }

    // A disabled alert's state freezes where it was (alerts.md Part IV):
    // aging its groups to Ok would fabricate recoveries nothing observed.
    // Pausing is not opting out, so eviction waits too.
    if let Some(a) = alert
        && !a.enabled
    {
        return Ok((0, 0, 0));
    }

    // An alert that is gone, or no longer opted in, keeps no group rows. Both
    // are configuration, not recovery: deleting outright is the honest write,
    // where aging them through M-7 would fabricate recoveries for groups that
    // simply stopped being evaluated (D26). This is the backstop for the
    // cleanup that the save path performs directly.
    if !still_multi(alert) {
        log_orphaned_episodes(alert_id, &groups);
        let tracked: HashMap<String, AlertState> = groups
            .into_iter()
            .map(|s| (s.group_key.clone(), s))
            .collect();
        let stale = opt_out_evictions(&tracked);
        let n = stale.len();
        let firing: Vec<(String, i64)> = stale
            .iter()
            .filter_map(|key| Some((key.clone(), tracked.get(key)?.firing_started_at?)))
            .collect();
        db::alerts::alert_states::delete_groups(alert_id, &stale).await?;
        // A deleted alert already reported its clears when it was deleted.
        if let Some(a) = alert {
            let cleared =
                lifecycle::deleted_clears(&firing, now_micros(), ClearKind::GroupUntracked);
            lifecycle::on_all_cleared(&a.org_id, alert_id, &cleared).await;
        }
        return Ok((0, 0, n));
    }
    let alert = alert.expect("still_multi implies the alert is cached");

    // ── The completeness gate (M-7) ─────────────────────────────────────────
    // Read off the rollup row, which is written by the same evaluation that
    // produced the group rows. `groups_firing_is_lower_bound` IS the truncation
    // marker: it is set exactly when the fetch page filled without reaching a
    // healthy group, which is the case where a missing group may simply be
    // firing below the cutoff.
    let rollup = infra::table::alert_states::get(alert_id, ROLLUP_GROUP_KEY).await?;
    let page = match rollup.as_ref().and_then(|r| r.groups_firing_is_lower_bound) {
        Some(true) => GroupPageCompleteness::Truncated,
        _ => GroupPageCompleteness::Complete,
    };
    if !may_age_groups(rollup.as_ref().and_then(|r| r.last_outcome.as_ref()), page) {
        log::debug!(
            "[ALERT_GROUP_REAPER] alert {alert_id}: last evaluation does not prove absence, \
             freezing group state this pass"
        );
        return Ok((0, 0, 0));
    }

    let now = now_micros();
    let rule_mode = alert.query_condition.promql_rule_mode;
    let plan = plan_sweep(alert_id, &groups, now, rule_mode, |state| {
        // Per row, not per alert: on a cron schedule each group's deadline
        // depends on where its own `last_seen` falls in the schedule.
        let resolve_after = alert
            .trigger_condition
            .group_resolve_threshold_micros(state.last_seen.unwrap_or(now), k);
        fate_for_alert(alert, state, now, resolve_after, grace)
    });

    // No ledger write: a sweep measures nothing.
    let write = apply_sweep(&plan, |group_plan, mode| async move {
        db::alerts::alert_states::persist_group_plan(group_plan, alert_id, mode)
            .await
            .map_err(anyhow::Error::from)
    })
    .await;
    let recoveries = write
        .closed
        .iter()
        .map(|close| close.recovery_event(&alert.org_id, alert_id, now))
        .collect();
    // Their episodes are already cleared, so a later write's error must not drop them.
    openobserve_core::alerts::recovery::dispatch_group_recoveries(alert, recoveries).await;
    let cleared = resolve_clears(&groups, &write.resolved, now);
    lifecycle::on_all_cleared(&alert.org_id, alert_id, &cleared).await;
    if let Some(e) = write.error {
        return Err(e);
    }
    Ok((write.resolved.len(), write.reaped, 0))
}

/// Commits a sweep's plans in order and stops at the first error, keeping what already committed.
async fn apply_sweep<'a, F, Fut>(plan: &'a SweepPlan, mut persist: F) -> SweepWrite<'a>
where
    F: FnMut(&'a GroupPlan, PlanApply) -> Fut,
    Fut: std::future::Future<Output = Result<GroupPlanWrite, anyhow::Error>>,
{
    // One plan per resolve: a close whose row was observed since abandons only that row's resolve.
    let rest = (!plan.rest.closed_episodes.is_empty() || !plan.rest.reaped.is_empty())
        .then_some((&plan.rest, PlanApply::Evaluation));
    let writes = plan
        .resolves
        .iter()
        .map(|resolve| (resolve, PlanApply::Sweep))
        .chain(rest);

    let mut out = SweepWrite::default();
    for (group_plan, mode) in writes {
        match persist(group_plan, mode).await {
            Ok(write) => {
                if mode == PlanApply::Sweep && write.written {
                    out.resolved.push(group_plan);
                }
                out.reaped += write.reaped.len();
                out.closed.extend(write.closed);
            }
            Err(e) => {
                out.error = Some(e);
                break;
            }
        }
    }
    out
}

/// The firing cycles the committed M-7 resolves ended, as reaper clears.
fn resolve_clears(
    groups: &[AlertState],
    resolved: &[&GroupPlan],
    now: i64,
) -> Vec<lifecycle::ClearedFiring> {
    let prev: HashMap<&str, &AlertState> =
        groups.iter().map(|s| (s.group_key.as_str(), s)).collect();
    resolved
        .iter()
        .flat_map(|plan| &plan.updates)
        .filter_map(|update| {
            let key = update.state.as_ref()?.group_key.as_str();
            lifecycle::update_clear(
                prev.get(key).copied(),
                update,
                now,
                ClearKind::ReaperResolved,
            )
        })
        .collect()
}

/// Rows deleted without an emit take their open episode's ticket with them (D11).
fn log_orphaned_episodes(alert_id: &str, groups: &[AlertState]) {
    for state in groups {
        if let Some(episode_id) = state.episode_id.as_deref() {
            log::warn!(
                "[ALERT_GROUP_REAPER] alert {alert_id} group {} ({}) deleted with open episode \
                 {episode_id}; its recovery will not be sent",
                state.group_key,
                state.group_labels.as_deref().unwrap_or_default()
            );
        }
    }
}

/// Deletes the acks of firings that are no longer current, once the reap grace has passed.
async fn sweep_ended_acks() {
    let grace_secs = get_config().limit.alert_group_reap_grace_secs;
    let cutoff = ended_ack_cutoff(now_micros(), grace_secs);
    match infra::table::alert_acks::delete_ended_before(cutoff).await {
        Ok(0) => {}
        Ok(n) => log::info!("[ALERT_GROUP_REAPER] deleted {n} acks of ended firings"),
        Err(e) => log::error!("[ALERT_GROUP_REAPER] ack sweep failed: {e}"),
    }
}

/// The instant before which an ack of an ended firing may go: the reap grace before `now`. [pure]
fn ended_ack_cutoff(now: i64, grace_secs: i64) -> i64 {
    now.saturating_sub(grace_secs.saturating_mul(1_000_000))
}

/// PromQL series grouping also keeps per-group state rows alive.
fn still_multi(alert: Option<&Alert>) -> bool {
    alert.is_some_and(|a| a.query_condition.multi_alert_enabled())
}

fn fate_for_alert(
    alert: &Alert,
    state: &AlertState,
    now: i64,
    resolve_after: i64,
    grace: i64,
) -> GroupFate {
    match group_fate(state, now, resolve_after, grace) {
        GroupFate::Resolve if alert.query_condition.promql_rule_mode => GroupFate::Keep,
        fate => fate,
    }
}

/// `alert_id -> Alert` from the in-memory cache.
///
/// Built once per pass. `alert_states` rows are keyed by alert id alone while
/// the cache is keyed by `org/alert_id`, so the alternative is a database read
/// per alert per sweep.
async fn cached_alerts_by_id() -> HashMap<String, Alert> {
    common::infra::config::ALERTS
        .read()
        .await
        .values()
        .filter_map(|(_, alert)| alert.id.map(|id| (id.to_string(), alert.clone())))
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::{alerts::QueryType, self_reporting::usage::RunOutcome};

    use super::*;

    // The aggregation arm of `multi_alert_enabled()` is pinned in the config
    // crate; what this file must never regress on is the PromQL arm — the
    // original bug read only `aggregation.multi_alert` and wiped a per-series
    // alert's state rows every sweep.
    #[test]
    fn a_promql_per_series_alert_is_still_multi() {
        let mut alert = Alert::default();
        alert.query_condition.query_type = QueryType::PromQL;
        alert.query_condition.promql_multi_alert = true;
        assert!(still_multi(Some(&alert)));
    }

    #[test]
    fn an_ended_firings_ack_goes_once_the_reap_grace_has_passed() {
        let now = 1_750_000_000_000_000;
        assert_eq!(ended_ack_cutoff(now, 3600), now - 3600 * 1_000_000);
        assert_eq!(
            ended_ack_cutoff(now, i64::MAX),
            now.saturating_sub(i64::MAX)
        );
    }

    #[test]
    fn a_simple_or_missing_alert_is_not_multi() {
        assert!(!still_multi(None));
        assert!(!still_multi(Some(&Alert::default())));
    }

    // ── The job-cluster gate (PR 0) ─────────────────────────────────────────
    // Once state rows replicate across a super cluster, every cluster's reaper
    // leader sees them. Only the elected job cluster may act: its evaluator is
    // the one writing `last_seen`, and a reap-delete from anywhere else fans
    // back out and destroys the job cluster's live rows.

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_unclaimed_job_cluster_lets_the_sweep_run() {
        // Nothing has registered yet — refusing here would mean the sweep never
        // runs on a single-cluster deployment that has not elected.
        assert!(may_sweep("", "us-west", &["us-west".to_string()]));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_elected_job_cluster_sweeps() {
        assert!(may_sweep(
            "us-west",
            "us-west",
            &["us-west".to_string(), "eu-central".to_string()]
        ));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_cluster_that_lost_the_election_does_not_sweep() {
        assert!(!may_sweep(
            "us-west",
            "eu-central",
            &["us-west".to_string(), "eu-central".to_string()]
        ));
    }

    /// The claim outlives the cluster that made it — it is a KV key kept alive
    /// by a live scheduler. Deferring to a name that is no longer in the
    /// cluster list would freeze group lifecycle everywhere, permanently.
    #[cfg(feature = "enterprise")]
    #[test]
    fn a_stale_claim_by_a_departed_cluster_does_not_block_the_sweep() {
        assert!(may_sweep(
            "us-west",
            "eu-central",
            &["eu-central".to_string()]
        ));
    }
    #[test]
    fn rule_mode_cannot_time_resolve_a_series_during_query_gaps() {
        let mut alert = Alert::default();
        let state = config::meta::alerts::state::apply_outcome(
            "rule",
            "host=a",
            None,
            RunOutcome::Firing,
            Some(config::meta::alerts::level::AlertLevel::Critical),
            0,
        )
        .state
        .unwrap();
        assert_eq!(
            fate_for_alert(&alert, &state, 600_000_000, 300_000_000, 60_000_000),
            GroupFate::Resolve
        );
        alert.query_condition.promql_rule_mode = true;
        assert_eq!(
            fate_for_alert(&alert, &state, 600_000_000, 300_000_000, 60_000_000),
            GroupFate::Keep
        );
    }

    fn close_of(group_key: &str) -> ClosedGroupEpisode {
        ClosedGroupEpisode {
            group_key: group_key.to_string(),
            episode_id: format!("ep-{group_key}"),
            prev_level_at: Some(1),
            incident_id: None,
            opened_at: 0,
            recovered_at: 1,
            reason: Default::default(),
            value: None,
            labels: Default::default(),
            group_labels: None,
            last_notified_level: None,
        }
    }

    fn closing(group_key: &str) -> GroupPlan {
        GroupPlan {
            closed_episodes: vec![close_of(group_key)],
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn a_failed_write_keeps_the_recoveries_earlier_writes_committed() {
        let plan = SweepPlan {
            resolves: vec![closing("host=a"), closing("host=b"), closing("host=c")],
            rest: closing("host=d"),
        };
        let mut calls = 0usize;
        let write = apply_sweep(&plan, |group_plan, _mode| {
            calls += 1;
            let fail = calls == 2;
            async move {
                if fail {
                    anyhow::bail!("database is gone");
                }
                Ok(GroupPlanWrite {
                    written: true,
                    closed: group_plan.closed_episodes.clone(),
                    ..Default::default()
                })
            }
        })
        .await;

        assert_eq!(calls, 2, "the sweep stops at the failed write");
        assert_eq!(write.resolved.len(), 1);
        assert_eq!(write.closed, vec![close_of("host=a")]);
        assert!(write.error.is_some());
    }

    #[tokio::test]
    async fn the_rest_plan_runs_last_and_only_when_it_has_work() {
        let mut plan = SweepPlan {
            resolves: vec![closing("host=a")],
            rest: closing("host=d"),
        };
        let mut modes = Vec::new();
        let echo = |group_plan: &GroupPlan| GroupPlanWrite {
            written: true,
            closed: group_plan.closed_episodes.clone(),
            ..Default::default()
        };
        let write = apply_sweep(&plan, |group_plan, mode| {
            modes.push(mode);
            std::future::ready(Ok(echo(group_plan)))
        })
        .await;
        assert_eq!(modes, [PlanApply::Sweep, PlanApply::Evaluation]);
        assert_eq!((write.resolved.len(), write.closed.len()), (1, 2));

        plan.rest = GroupPlan::default();
        modes.clear();
        apply_sweep(&plan, |group_plan, mode| {
            modes.push(mode);
            std::future::ready(Ok(echo(group_plan)))
        })
        .await;
        assert_eq!(modes, [PlanApply::Sweep]);
    }
}

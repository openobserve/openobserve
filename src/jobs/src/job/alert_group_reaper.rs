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
            GroupFate, GroupPageCompleteness, group_fate, may_age_groups, opt_out_evictions,
            resolve_group_update,
        },
        state::{AlertState, ROLLUP_GROUP_KEY},
    },
    spawn_pausable_job,
    utils::time::now_micros,
};

/// Start the sweep. Alert-manager nodes only, one leader at a time — the work
/// is a whole-table scan of group state, and running it on every node would
/// multiply the writes and race resolutions against each other.
pub fn run() {
    if !LOCAL_NODE.is_alert_manager() {
        log::debug!("[ALERT_GROUP_REAPER] not an alert_manager node, skipping");
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
            let is_leader = match infra::cluster::get_cached_online_query_nodes(None).await {
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

            if let Err(e) = sweep().await {
                log::error!("[ALERT_GROUP_REAPER] sweep failed: {e}");
            }
        }
    );
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

    // An alert that is gone, or no longer opted in, keeps no group rows. Both
    // are configuration, not recovery: deleting outright is the honest write,
    // where aging them through M-7 would fabricate recoveries for groups that
    // simply stopped being evaluated (D26). This is the backstop for the
    // cleanup that the save path performs directly.
    if !still_multi(alert) {
        let tracked: HashMap<String, AlertState> = groups
            .into_iter()
            .map(|s| (s.group_key.clone(), s))
            .collect();
        let stale = opt_out_evictions(&tracked);
        let n = stale.len();
        infra::table::alert_states::delete_groups(alert_id, &stale).await?;
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
    let mut resolved = 0usize;
    let mut to_reap = Vec::new();

    for state in &groups {
        // Per row, not per alert: on a cron schedule each group's deadline
        // depends on where its own `last_seen` falls in the schedule.
        let resolve_after = alert
            .trigger_condition
            .group_resolve_threshold_micros(state.last_seen.unwrap_or(now), k);

        match group_fate(state, now, resolve_after, grace) {
            GroupFate::Keep => {}
            GroupFate::Resolve => {
                let update = resolve_group_update(alert_id, &state.group_key, state, now);
                // `resolve_group_update` is a full noop for an already-resolved
                // row; writing anyway would push the reap clock out by one
                // interval every pass and the row would never be deleted.
                if !update.is_noop() {
                    infra::table::alert_states::persist(&update).await?;
                    resolved += 1;
                }
            }
            GroupFate::Reap => to_reap.push(state.group_key.clone()),
        }
    }

    let reaped = to_reap.len();
    if reaped > 0 {
        infra::table::alert_states::delete_groups(alert_id, &to_reap).await?;
    }
    Ok((resolved, reaped, 0))
}

/// Whether the alert still evaluates per group. Must agree with every other
/// layer — `multi_alert_enabled()` covers both the aggregation opt-in and the
/// PromQL per-series opt-in; checking only `aggregation.multi_alert` here
/// would make this sweep wipe a per-series alert's state rows every pass.
fn still_multi(alert: Option<&Alert>) -> bool {
    alert.is_some_and(|a| a.query_condition.multi_alert_enabled())
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
    use config::meta::alerts::QueryType;

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
    fn a_simple_or_missing_alert_is_not_multi() {
        assert!(!still_multi(None));
        assert!(!still_multi(Some(&Alert::default())));
    }

    // ── sweep_alert against the real schema ─────────────────────────────────
    // The sweep's decision helpers (group_fate, may_age_groups,
    // opt_out_evictions) are pinned in the config crate; what these cover is
    // the orchestration this file owns — which rows each verdict actually
    // touches in the database.

    use std::collections::BTreeMap;

    use config::meta::alerts::{
        AggFunction, Aggregation, Condition, Operator,
        grouping::{
            ClassifiedGroup, FetchPage, GroupCapOutcome, GroupClassification, plan_group_updates,
        },
        level::AlertLevel,
        state::ROLLUP_GROUP_KEY,
    };
    use infra::table::test_harness::{
        init_global_orm, seed_alert, seed_promql_alert, test_db, unique_alert_id,
    };

    const MINUTE: i64 = 60 * 1_000_000;

    /// Write one critical group (host=a) plus the rollup row through the
    /// production write path, stamped `at`.
    async fn write_one_critical_group(alert_id: &str, at: i64, page: FetchPage) {
        let labels: BTreeMap<String, String> = [("host".to_string(), "a".to_string())]
            .into_iter()
            .collect();
        let classification = GroupClassification {
            groups: vec![ClassifiedGroup {
                labels,
                actual_value: 42.0,
                level: Some(AlertLevel::Critical),
            }],
            rollup: Some(AlertLevel::Critical),
            cap: GroupCapOutcome::WithinCap,
            firing_observed: 1,
            page,
            dropped: vec![],
        };
        let plan = plan_group_updates(alert_id, &classification, &HashMap::new(), at);
        infra::table::alert_states::persist_group_plan(&plan, alert_id)
            .await
            .expect("persist the group plan");
    }

    /// An alert whose aggregation opted in to per-group evaluation.
    fn aggregation_multi_alert() -> Alert {
        let mut alert = Alert::default();
        alert.query_condition.aggregation = Some(Aggregation {
            group_by: Some(vec!["host".to_string()]),
            function: AggFunction::Avg,
            having: Condition {
                column: "v".to_string(),
                operator: Operator::GreaterThanEquals,
                value: serde_json::json!(1),
                ignore_case: false,
            },
            warning_value: None,
            multi_alert: true,
        });
        alert
    }

    #[tokio::test]
    async fn an_alert_missing_from_the_cache_gets_evicted_but_keeps_its_rollup() {
        init_global_orm().await;
        let db = test_db().await;
        let id = unique_alert_id("reaper-optout");
        seed_alert(db, &id, true).await;
        write_one_critical_group(&id, now_micros(), FetchPage::default()).await;
        assert_eq!(
            infra::table::alert_states::list_groups(&id)
                .await
                .unwrap()
                .len(),
            1
        );

        // `None` = the alert is gone from the cache; grace must be irrelevant.
        let (resolved, reaped, evicted) = sweep_alert(&id, None, 3, i64::MAX).await.unwrap();

        assert_eq!((resolved, reaped, evicted), (0, 0, 1));
        assert!(
            infra::table::alert_states::list_groups(&id)
                .await
                .unwrap()
                .is_empty()
        );
        // The rollup row is the alert's own state, not a group's — an opt-out
        // eviction must leave it alone.
        assert!(
            infra::table::alert_states::get(&id, ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_some(),
            "eviction deleted the rollup row"
        );
    }

    /// Regression for the launch bug: the sweep read only
    /// `aggregation.multi_alert`, so a PromQL per-series alert looked opted
    /// out and had all its state rows deleted on every pass.
    #[tokio::test]
    async fn a_promql_per_series_alert_keeps_its_rows_across_a_sweep() {
        init_global_orm().await;
        let db = test_db().await;
        let id = unique_alert_id("reaper-promql");
        seed_promql_alert(db, &id, true).await;
        write_one_critical_group(&id, now_micros(), FetchPage::default()).await;

        let mut alert = Alert::default();
        alert.query_condition.query_type = config::meta::alerts::QueryType::PromQL;
        alert.query_condition.promql_multi_alert = true;

        let (resolved, reaped, evicted) =
            sweep_alert(&id, Some(&alert), 3, i64::MAX).await.unwrap();

        assert_eq!((resolved, reaped, evicted), (0, 0, 0));
        assert_eq!(
            infra::table::alert_states::list_groups(&id)
                .await
                .unwrap()
                .len(),
            1,
            "the sweep treated a per-series alert as opted out"
        );
    }

    /// A truncated fetch page must freeze the sweep: absence from a page that
    /// never reached a healthy group proves nothing, however old the row is.
    #[tokio::test]
    async fn a_truncated_page_freezes_aging() {
        init_global_orm().await;
        let db = test_db().await;
        let id = unique_alert_id("reaper-truncated");
        seed_alert(db, &id, true).await;
        // Old enough to resolve (default frequency floors resolve_after at
        // 60s), but written from a page that filled while still firing.
        write_one_critical_group(
            &id,
            now_micros() - 10 * MINUTE,
            FetchPage {
                filled: true,
                reached_healthy: false,
            },
        )
        .await;

        let alert = aggregation_multi_alert();
        let (resolved, reaped, evicted) =
            sweep_alert(&id, Some(&alert), 3, i64::MAX).await.unwrap();

        assert_eq!((resolved, reaped, evicted), (0, 0, 0));
        let groups = infra::table::alert_states::list_groups(&id).await.unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(
            groups[0].level,
            Some(AlertLevel::Critical),
            "a frozen row must keep its level, not be resolved"
        );
    }

    /// The full lifecycle: a vanished group resolves first (final Ok
    /// transition), and only an already-resolved row is reaped once the grace
    /// period passes.
    #[tokio::test]
    async fn a_vanished_group_resolves_then_reaps() {
        init_global_orm().await;
        let db = test_db().await;
        let id = unique_alert_id("reaper-lifecycle");
        seed_alert(db, &id, true).await;
        write_one_critical_group(&id, now_micros() - 10 * MINUTE, FetchPage::default()).await;

        let alert = aggregation_multi_alert();

        // Pass 1, generous grace: resolve, never reap.
        let (resolved, reaped, evicted) =
            sweep_alert(&id, Some(&alert), 3, i64::MAX).await.unwrap();
        assert_eq!((resolved, reaped, evicted), (1, 0, 0));
        let groups = infra::table::alert_states::list_groups(&id).await.unwrap();
        assert_eq!(groups.len(), 1, "resolution keeps the row for the UI");
        let row = &groups[0];
        assert_eq!(row.level, Some(AlertLevel::Ok));
        assert!(
            row.last_outcome_at > row.last_seen,
            "resolution must advance last_outcome_at past last_seen — that gap \
             is what marks the row resolved"
        );

        // Pass 2, zero grace: the resolved row reaps; nothing double-resolves.
        let (resolved, reaped, evicted) = sweep_alert(&id, Some(&alert), 3, 0).await.unwrap();
        assert_eq!((resolved, reaped, evicted), (0, 1, 0));
        assert!(
            infra::table::alert_states::list_groups(&id)
                .await
                .unwrap()
                .is_empty()
        );

        // The durable history survives the reap: the firing and the recovery
        // are both still on record (M-8).
        let transitions = infra::table::alert_states::list_transitions(&id, 100)
            .await
            .expect("list transitions");
        assert!(
            transitions.len() >= 2,
            "expected the firing and the resolution to both be recorded, got {}",
            transitions.len()
        );
    }
}

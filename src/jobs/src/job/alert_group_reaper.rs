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
    let still_multi = alert.is_some_and(|a| {
        a.query_condition
            .aggregation
            .as_ref()
            .is_some_and(|agg| agg.multi_alert)
    });
    if !still_multi {
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

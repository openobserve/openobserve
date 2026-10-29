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

//! Firing-cycle hooks (§5.7, §6.4): clears, view changes and enable flips mark the Slack outbox.

#[cfg(test)]
pub(crate) mod recorder {
    use std::cell::RefCell;

    use super::ClearKind;

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub(crate) enum Hook {
        Cleared {
            alert_id: String,
            group_key: String,
            firing_started_at: i64,
            cleared_at: i64,
            kind: ClearKind,
        },
        ViewChanged {
            alert_id: String,
            group_key: Option<String>,
        },
        EnabledChanged {
            alert_id: String,
            enabled: bool,
        },
    }

    thread_local! {
        static HOOKS: RefCell<Vec<Hook>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn record(hook: Hook) {
        HOOKS.with(|h| h.borrow_mut().push(hook));
    }

    pub(crate) fn take() -> Vec<Hook> {
        HOOKS.with(|h| std::mem::take(&mut *h.borrow_mut()))
    }
}

use std::collections::HashMap;

use config::meta::alerts::{
    grouping::GroupPlan,
    level::AlertLevel,
    recovery::{FiringCycleClose, closes_firing_cycle},
    state::{AlertState, ROLLUP_GROUP_KEY, StateUpdate},
};
use infra::table::alert_states::GroupPlanWrite;

/// Why a firing cycle ended; the cleared message's wording follows it (§6.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClearKind {
    Recovered,
    ReaperResolved,
    GroupUntracked,
    GroupLimit,
    AlertDeleted,
}

/// One firing cycle of one row that a write ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClearedFiring {
    pub group_key: String,
    pub firing_started_at: i64,
    pub cleared_at: i64,
    pub kind: ClearKind,
}

/// A firing cycle ended: re-render its Slack messages as cleared.
pub async fn on_cleared(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    cleared_at: i64,
    kind: ClearKind,
) {
    log::debug!(
        "[ALERT_LIFECYCLE] {org_id}/{alert_id} group {group_key:?} firing {firing_started_at} \
         cleared at {cleared_at} ({kind:?})"
    );
    #[cfg(test)]
    {
        recorder::record(recorder::Hook::Cleared {
            alert_id: alert_id.to_string(),
            group_key: group_key.to_string(),
            firing_started_at,
            cleared_at,
            kind,
        });
    }
    #[cfg(all(not(test), feature = "enterprise"))]
    crate::alerts::mute::end_on_clear(org_id, alert_id, group_key, cleared_at).await;
    #[cfg(not(test))]
    mark_firing(alert_id, group_key, firing_started_at, AlertLevel::Ok).await;
}

/// Marks a single-row clear once more after its state commit, for a render that raced the hook.
pub async fn mark_committed_clear(alert_id: &str, firing_started_at: i64) {
    #[cfg(test)]
    let _ = (alert_id, firing_started_at);
    #[cfg(not(test))]
    mark_firing(
        alert_id,
        ROLLUP_GROUP_KEY,
        firing_started_at,
        AlertLevel::Ok,
    )
    .await;
}

/// [`on_cleared`] for each row in `cleared`.
pub async fn on_all_cleared(org_id: &str, alert_id: &str, cleared: &[ClearedFiring]) {
    for c in cleared {
        on_cleared(
            org_id,
            alert_id,
            &c.group_key,
            c.firing_started_at,
            c.cleared_at,
            c.kind,
        )
        .await;
    }
}

/// What the message of a live firing shows changed (ack, mute); `None` = every group.
pub async fn on_view_changed(org_id: &str, alert_id: &str, group_key: Option<&str>) {
    log::debug!("[ALERT_LIFECYCLE] {org_id}/{alert_id} view changed for {group_key:?}");
    #[cfg(test)]
    {
        recorder::record(recorder::Hook::ViewChanged {
            alert_id: alert_id.to_string(),
            group_key: group_key.map(str::to_string),
        });
    }
    #[cfg(not(test))]
    mark_live_firings(alert_id, group_key).await;
}

/// Disabling is not a clear (R-120): the firing stays and its message turns grey.
pub async fn on_alert_enabled_changed(org_id: &str, alert_id: &str, by: &str, enabled: bool) {
    log::info!("[ALERT_LIFECYCLE] {org_id}/{alert_id} enabled={enabled} by {by}");
    #[cfg(test)]
    {
        recorder::record(recorder::Hook::EnabledChanged {
            alert_id: alert_id.to_string(),
            enabled,
        });
    }
    #[cfg(not(test))]
    mark_live_firings(alert_id, None).await;
}

/// The firing cycles one persisted group plan ended: set → null rows, then evicted firing groups.
pub fn group_plan_clears(
    prev: &HashMap<String, AlertState>,
    plan: &GroupPlan,
    write: &GroupPlanWrite,
    at: i64,
) -> Vec<ClearedFiring> {
    if !write.written {
        return vec![];
    }
    let mut cleared: Vec<ClearedFiring> = plan
        .updates
        .iter()
        .filter_map(|update| {
            let state = update.state.as_ref()?;
            let close = closes_firing_cycle(prev.get(&state.group_key), Some(state), at)?;
            Some(cleared_firing(
                &state.group_key,
                close,
                ClearKind::Recovered,
            ))
        })
        .collect();
    cleared.extend(
        write
            .evicted_firing
            .iter()
            .map(|(group_key, started)| ClearedFiring {
                group_key: group_key.clone(),
                firing_started_at: *started,
                cleared_at: at,
                kind: ClearKind::GroupLimit,
            }),
    );
    cleared
}

/// The firing cycle one state write ended, if any.
pub fn update_clear(
    prev: Option<&AlertState>,
    update: &StateUpdate,
    at: i64,
    kind: ClearKind,
) -> Option<ClearedFiring> {
    let state = update.state.as_ref()?;
    let close = closes_firing_cycle(prev, Some(state), at)?;
    Some(cleared_firing(&state.group_key, close, kind))
}

/// Rows a delete removed mid-firing, as clears of `kind` at `at`.
pub fn deleted_clears(firing: &[(String, i64)], at: i64, kind: ClearKind) -> Vec<ClearedFiring> {
    firing
        .iter()
        .map(|(group_key, started)| ClearedFiring {
            group_key: group_key.clone(),
            firing_started_at: *started,
            cleared_at: at,
            kind,
        })
        .collect()
}

/// Every row of the alert mid-firing, the rollup included; empty on a read error.
pub async fn firing_rows(alert_id: &str) -> Vec<(String, i64)> {
    let mut rows = match infra::table::alert_states::firing_groups(alert_id, None).await {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[ALERT_LIFECYCLE] could not list firing groups of {alert_id}: {e}");
            vec![]
        }
    };
    match infra::table::alert_states::get(alert_id, ROLLUP_GROUP_KEY).await {
        Ok(Some(rollup)) => {
            if let Some(started) = rollup.firing_started_at {
                rows.insert(0, (ROLLUP_GROUP_KEY.to_string(), started));
            }
        }
        Ok(None) => {}
        Err(e) => log::warn!("[ALERT_LIFECYCLE] could not read the rollup of {alert_id}: {e}"),
    }
    rows
}

/// The `Refresh` for one message row; the consumer re-reads the truth, so only the key matters.
pub fn refresh_event(
    row: &config::meta::slack::SlackAlertMessage,
    level: AlertLevel,
    at: i64,
) -> config::meta::slack::AlertSlackEvent {
    config::meta::slack::AlertSlackEvent {
        v: config::meta::slack::ALERT_SLACK_EVENT_VERSION,
        kind: config::meta::slack::AlertSlackEventKind::Refresh,
        destination_id: row.destination_id.clone(),
        org_id: row.org_id.clone(),
        alert_id: row.alert_id.clone(),
        group_key: row.group_key.clone(),
        firing_started_at: row.firing_started_at,
        seq: u64::try_from(row.wanted_seq).unwrap_or_default(),
        rendered: None,
        chart_png_b64: None,
        level,
        at,
    }
}

fn cleared_firing(group_key: &str, close: FiringCycleClose, kind: ClearKind) -> ClearedFiring {
    ClearedFiring {
        group_key: group_key.to_string(),
        firing_started_at: close.firing_started_at,
        cleared_at: close.cleared_at,
        kind,
    }
}

#[cfg_attr(test, allow(dead_code))]
async fn mark_live_firings(alert_id: &str, group_key: Option<&str>) {
    let rows = match group_key {
        Some(key) => match infra::table::alert_states::get(alert_id, key).await {
            Ok(state) => state
                .and_then(|s| {
                    s.firing_started_at
                        .map(|started| (s.group_key, started, s.level))
                })
                .into_iter()
                .collect(),
            Err(e) => {
                log::warn!("[ALERT_LIFECYCLE] could not read {alert_id}/{key:?}: {e}");
                vec![]
            }
        },
        None => firing_rows(alert_id)
            .await
            .into_iter()
            .map(|(key, started)| (key, started, None))
            .collect::<Vec<_>>(),
    };
    for (key, started, level) in rows {
        mark_firing(
            alert_id,
            &key,
            started,
            level.unwrap_or(AlertLevel::Critical),
        )
        .await;
    }
}

/// Bumps the outbox of the firing's messages in one statement, then publishes their `Refresh`.
#[cfg_attr(test, allow(dead_code))]
async fn mark_firing(alert_id: &str, group_key: &str, firing_started_at: i64, level: AlertLevel) {
    match infra::table::slack_alert_messages::bump_wanted(alert_id, group_key, firing_started_at)
        .await
    {
        Ok(0) => {}
        Ok(_) => publish_refreshes(alert_id, group_key, firing_started_at, level).await,
        Err(e) => log::error!(
            "[ALERT_LIFECYCLE] could not mark the Slack messages of {alert_id}/{group_key:?} \
             firing {firing_started_at}: {e}"
        ),
    }
}

#[cfg(feature = "enterprise")]
#[cfg_attr(test, allow(dead_code))]
async fn publish_refreshes(
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    level: AlertLevel,
) {
    let rows = match infra::table::slack_alert_messages::list_by_firing(
        alert_id,
        group_key,
        firing_started_at,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[ALERT_LIFECYCLE] could not list the messages of {alert_id}: {e}");
            return;
        }
    };
    let at = config::utils::time::now_micros();
    for row in rows {
        if crate::alerts::slack_publish::unavailable_reason(&row.org_id).is_some() {
            continue;
        }
        let event = refresh_event(&row, level, at);
        // A lost publish is not lost work: the pending sweep republishes wanted > rendered rows.
        if let Err(e) = crate::alerts::slack_publish::publish_unchecked(
            &crate::alerts::slack_publish::QueueSink,
            &event,
        )
        .await
        {
            log::warn!("[ALERT_LIFECYCLE] could not publish a Refresh for {alert_id}: {e}");
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[cfg_attr(test, allow(dead_code))]
async fn publish_refreshes(
    _alert_id: &str,
    _group_key: &str,
    _firing_started_at: i64,
    _level: AlertLevel,
) {
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{
            Operator, TriggerCondition,
            grouping::{GroupObservation, classify_groups, group_key, plan_group_updates},
        },
        self_reporting::usage::RunOutcome,
    };

    use super::{recorder::Hook, *};

    fn host(name: &str) -> std::collections::BTreeMap<String, String> {
        std::collections::BTreeMap::from([("host".to_string(), name.to_string())])
    }

    fn evaluate(prev: &HashMap<String, AlertState>, values: &[(&str, f64)], at: i64) -> GroupPlan {
        let tc = TriggerCondition {
            operator: Operator::GreaterThan,
            threshold: 100,
            ..Default::default()
        };
        let observations = values
            .iter()
            .map(|(name, v)| GroupObservation::new(host(name), *v))
            .collect();
        plan_group_updates(
            "alert-1",
            &classify_groups(observations, &tc, 500),
            prev,
            at,
            0,
        )
    }

    fn apply(prev: &mut HashMap<String, AlertState>, plan: &GroupPlan) {
        for update in &plan.updates {
            let state = update.state.clone().unwrap();
            prev.insert(state.group_key.clone(), state);
        }
    }

    fn written(evicted_firing: Vec<(String, i64)>) -> GroupPlanWrite {
        GroupPlanWrite {
            written: true,
            evicted_firing,
        }
    }

    #[tokio::test]
    async fn a_group_plan_reports_each_recovered_and_evicted_firing_once() {
        let mut prev = HashMap::new();
        let first = evaluate(&prev, &[("a", 150.0), ("b", 150.0)], 100);
        assert!(group_plan_clears(&prev, &first, &written(vec![]), 100).is_empty());
        apply(&mut prev, &first);

        let second = evaluate(&prev, &[("a", 10.0), ("b", 150.0)], 200);
        let evicted = vec![(group_key(&host("c")), 50)];
        let cleared = group_plan_clears(&prev, &second, &written(evicted), 200);
        on_all_cleared("org", "alert-1", &cleared).await;

        assert_eq!(
            recorder::take(),
            vec![
                Hook::Cleared {
                    alert_id: "alert-1".into(),
                    group_key: group_key(&host("a")),
                    firing_started_at: 100,
                    cleared_at: 200,
                    kind: ClearKind::Recovered,
                },
                Hook::Cleared {
                    alert_id: "alert-1".into(),
                    group_key: group_key(&host("c")),
                    firing_started_at: 50,
                    cleared_at: 200,
                    kind: ClearKind::GroupLimit,
                },
            ],
            "b still fires and the rollup still fires, so neither is a clear"
        );
    }

    #[test]
    fn a_plan_the_opt_out_gate_dropped_clears_nothing() {
        let mut prev = HashMap::new();
        let first = evaluate(&prev, &[("a", 150.0)], 100);
        apply(&mut prev, &first);
        let second = evaluate(&prev, &[("a", 10.0)], 200);
        assert!(group_plan_clears(&prev, &second, &GroupPlanWrite::default(), 200).is_empty());
    }

    #[test]
    fn a_reaper_resolve_is_a_clear_and_the_later_reap_of_that_row_is_not() {
        let mut prev = HashMap::new();
        let first = evaluate(&prev, &[("a", 150.0)], 100);
        apply(&mut prev, &first);
        let row = prev[&group_key(&host("a"))].clone();

        let resolve = config::meta::alerts::grouping::resolve_group_update(
            "alert-1",
            &row.group_key,
            &row,
            300,
        );
        let clear = update_clear(Some(&row), &resolve, 300, ClearKind::ReaperResolved).unwrap();
        assert_eq!(
            (clear.firing_started_at, clear.cleared_at, clear.kind),
            (100, 300, ClearKind::ReaperResolved)
        );

        let resolved = resolve.state.unwrap();
        assert_eq!(resolved.last_outcome, Some(RunOutcome::Normal));
        assert_eq!(
            resolved.firing_started_at, None,
            "a reaped row was resolved first, so its delete has no firing left to clear"
        );
    }

    #[tokio::test]
    async fn disabling_an_alert_marks_its_view_and_clears_nothing() {
        on_alert_enabled_changed("org", "alert-1", "root@example.com", false).await;
        assert_eq!(
            recorder::take(),
            vec![Hook::EnabledChanged {
                alert_id: "alert-1".into(),
                enabled: false,
            }]
        );
    }

    #[test]
    fn deletes_clear_every_firing_row_with_their_own_start() {
        let rows = vec![("".to_string(), 10), ("k".to_string(), 20)];
        let cleared = deleted_clears(&rows, 99, ClearKind::AlertDeleted);
        assert_eq!(cleared.len(), 2);
        assert!(
            cleared
                .iter()
                .all(|c| c.cleared_at == 99 && c.kind == ClearKind::AlertDeleted)
        );
        assert_eq!(cleared[1].firing_started_at, 20);
    }

    #[test]
    fn a_refresh_carries_the_message_key_and_its_wanted_seq() {
        let row = config::meta::slack::SlackAlertMessage {
            destination_id: "d1".into(),
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: "k".into(),
            firing_started_at: 10,
            wanted_seq: 4,
            ..Default::default()
        };
        let event = refresh_event(&row, AlertLevel::Ok, 11);
        assert_eq!(
            event.kind,
            config::meta::slack::AlertSlackEventKind::Refresh
        );
        assert_eq!(
            (
                event.destination_id.as_str(),
                event.org_id.as_str(),
                event.group_key.as_str()
            ),
            ("d1", "acme", "k")
        );
        assert_eq!((event.firing_started_at, event.seq, event.at), (10, 4, 11));
        assert!(event.rendered.is_none());
    }
}

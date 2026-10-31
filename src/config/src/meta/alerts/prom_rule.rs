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

use std::collections::{HashMap, HashSet};

use super::{
    grouping::{
        GroupClassification, GroupPageCompleteness, GroupPlan, group_key, render_labels,
        resolve_group_update, step_group_episode,
    },
    level::AlertLevel,
    state::{AlertState, ROLLUP_GROUP_KEY, StateUpdate, apply_outcome},
};
use crate::meta::self_reporting::usage::RunOutcome;

/// Only complete evaluations can reset per-series pending or resolve absent series.
pub fn plan_rule_updates(
    alert_id: &str,
    classification: &GroupClassification,
    previous: &HashMap<String, AlertState>,
    at: i64,
    pending_sec: i64,
    keep_firing_for_secs: i64,
) -> GroupPlan {
    if classification.page.completeness() != GroupPageCompleteness::Complete {
        return GroupPlan::default();
    }
    let interrupted = previous
        .get(ROLLUP_GROUP_KEY)
        .is_some_and(|s| matches!(s.last_outcome, Some(RunOutcome::Error)));
    let mut updates = Vec::new();
    let mut closed_episodes = Vec::new();
    let mut retained = HashSet::new();
    let mut firing = 0usize;
    for group in &classification.groups {
        let key = group_key(&group.labels);
        retained.insert(key.clone());
        let prev = previous.get(&key);
        let resumed = prev
            .filter(|p| interrupted && p.last_outcome == Some(RunOutcome::Pending))
            .map(|p| {
                let mut state = p.clone();
                state.since = state.since.map(|since| {
                    since.saturating_add(at.saturating_sub(state.last_seen.unwrap_or(at)))
                });
                state
            });
        let prev = resumed.as_ref().or(prev);
        let outcome = rule_outcome(prev, at, pending_sec);
        firing += usize::from(outcome == RunOutcome::Firing);
        let mut update = apply_outcome(
            alert_id,
            &key,
            prev,
            outcome,
            Some(AlertLevel::Critical),
            at,
        );
        if let Some(s) = update.state.as_mut() {
            s.group_labels = Some(render_labels(&group.labels));
            s.group_label_set = Some(group.labels.clone());
            // A returned series ends any hold, so a later absence starts a fresh one.
            step_group_episode(s, prev, true, keep_firing_for_secs, at, None);
        }
        if let Some(t) = update.transition.as_mut() {
            t.group_labels = Some(render_labels(&group.labels));
            t.rule_value = group.rule_value.clone();
        }
        updates.push(update);
    }
    let mut absent: Vec<_> = previous
        .iter()
        .filter(|(key, _)| key.as_str() != ROLLUP_GROUP_KEY && !retained.contains(*key))
        .collect();
    absent.sort_by_key(|(key, _)| *key);
    for (key, prev) in absent {
        let mut update = resolve_group_update(alert_id, key, prev, at);
        // A resolved row is never resolved again, so its hold is re-checked on every evaluation.
        if prev.episode_id.is_some() {
            let mut state = update.state.clone().unwrap_or_else(|| prev.clone());
            closed_episodes.extend(step_group_episode(
                &mut state,
                Some(prev),
                false,
                keep_firing_for_secs,
                at,
                None,
            ));
            if update.state.is_some() || state != *prev {
                update.state = Some(state);
            }
        }
        updates.push(update);
    }
    let outcome = if classification.groups.is_empty() {
        RunOutcome::Normal
    } else if firing > 0 {
        RunOutcome::Firing
    } else {
        RunOutcome::Pending
    };
    let level = if classification.groups.is_empty() {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut rollup = apply_outcome(
        alert_id,
        ROLLUP_GROUP_KEY,
        previous.get(ROLLUP_GROUP_KEY),
        outcome,
        Some(level),
        at,
    );
    if let Some(s) = rollup.state.as_mut() {
        close_cycle_on_pending(s);
        s.groups_observed = Some(classification.groups.len());
        s.groups_firing = Some(firing);
        s.groups_observed_is_lower_bound = Some(false);
        s.groups_firing_is_lower_bound = Some(false);
    }
    updates.push(rollup);
    GroupPlan {
        updates,
        closed_episodes,
        ..Default::default()
    }
}

/// Preserve severity on errors and retain PromQL sample text on rollup transitions.
pub fn apply_rule_rollup_outcome(
    alert_id: &str,
    previous: Option<&AlertState>,
    outcome: RunOutcome,
    level: Option<AlertLevel>,
    at: i64,
    value: Option<&str>,
) -> StateUpdate {
    let mut update = apply_outcome(alert_id, ROLLUP_GROUP_KEY, previous, outcome, level, at);
    if let Some(state) = update.state.as_mut() {
        close_cycle_on_pending(state);
    }
    if let Some(transition) = update.transition.as_mut() {
        transition.rule_value = value.map(str::to_string);
    }
    update
}

/// Firing → Pending without passing Normal still ends the firing cycle (R-116).
fn close_cycle_on_pending(rollup: &mut AlertState) {
    if rollup.last_outcome == Some(RunOutcome::Pending) {
        rollup.firing_started_at = None;
    }
}

fn rule_outcome(previous: Option<&AlertState>, at: i64, pending_sec: i64) -> RunOutcome {
    if pending_sec <= 0 {
        return RunOutcome::Firing;
    }
    match previous {
        Some(p) if p.last_outcome == Some(RunOutcome::Pending) => {
            if p.since.is_some_and(|since| {
                at.saturating_sub(since) >= pending_sec.saturating_mul(1_000_000)
            }) {
                RunOutcome::Firing
            } else {
                RunOutcome::Pending
            }
        }
        Some(p)
            if p.level.is_some_and(|l| l.is_firing())
                && p.last_outcome != Some(RunOutcome::Normal) =>
        {
            RunOutcome::Firing
        }
        _ => RunOutcome::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::alerts::grouping::{FetchPage, GroupObservation, classify_groups_by};

    fn classification(hosts: &[&str]) -> GroupClassification {
        let mut c = classify_groups_by(
            hosts
                .iter()
                .map(|host| {
                    GroupObservation::new(
                        std::collections::BTreeMap::from([("host".into(), (*host).into())]),
                        0.0,
                    )
                })
                .collect(),
            |_| Some(AlertLevel::Critical),
            0,
        );
        for g in &mut c.groups {
            g.rule_value = Some("+Inf".into());
        }
        c
    }

    fn run(
        previous: &mut HashMap<String, AlertState>,
        hosts: &[&str],
        sec: i64,
        pending: i64,
    ) -> GroupPlan {
        let plan = plan_rule_updates(
            "rule",
            &classification(hosts),
            previous,
            sec * 1_000_000,
            pending,
            0,
        );
        for u in &plan.updates {
            if let Some(s) = &u.state {
                previous.insert(s.group_key.clone(), s.clone());
            }
        }
        plan
    }

    fn state<'a>(previous: &'a HashMap<String, AlertState>, host: &str) -> &'a AlertState {
        &previous[&group_key(&std::collections::BTreeMap::from([(
            "host".into(),
            host.into(),
        )]))]
    }

    #[test]
    fn pending_is_per_series_and_requires_continuous_matches() {
        let mut previous = HashMap::new();
        run(&mut previous, &["a"], 0, 240);
        assert_eq!(previous[ROLLUP_GROUP_KEY].groups_firing, Some(0));
        assert_eq!(
            state(&previous, "a").last_outcome,
            Some(RunOutcome::Pending)
        );
        run(&mut previous, &["a", "b"], 180, 240);
        assert_eq!(previous[ROLLUP_GROUP_KEY].groups_firing, Some(0));
        run(&mut previous, &["a", "b"], 240, 240);
        assert_eq!(previous[ROLLUP_GROUP_KEY].groups_firing, Some(1));
        assert_eq!(state(&previous, "a").last_outcome, Some(RunOutcome::Firing));
        assert_eq!(
            state(&previous, "b").last_outcome,
            Some(RunOutcome::Pending)
        );
        let absent = run(&mut previous, &[], 300, 240);
        assert_eq!(previous[ROLLUP_GROUP_KEY].groups_firing, Some(0));
        assert_eq!(state(&previous, "a").level, Some(AlertLevel::Ok));
        assert_eq!(state(&previous, "b").last_outcome, Some(RunOutcome::Normal));
        assert!(
            absent
                .updates
                .iter()
                .filter_map(|u| u.transition.as_ref())
                .all(|t| t.rule_value.is_none())
        );
        run(&mut previous, &["a"], 360, 240);
        assert_eq!(
            state(&previous, "a").last_outcome,
            Some(RunOutcome::Pending)
        );
        assert_eq!(state(&previous, "a").since, Some(360_000_000));
    }

    #[test]
    fn query_errors_freeze_pending_and_do_not_bypass_it() {
        let mut previous = HashMap::new();
        run(&mut previous, &["a"], 0, 240);
        run(&mut previous, &["a"], 120, 240);
        previous.get_mut(ROLLUP_GROUP_KEY).unwrap().last_outcome = Some(RunOutcome::Error);
        let before = state(&previous, "a").clone();
        assert_eq!(state(&previous, "a"), &before);
        run(&mut previous, &["a"], 600, 240);
        assert_eq!(
            state(&previous, "a").last_outcome,
            Some(RunOutcome::Pending)
        );
        run(&mut previous, &["a"], 720, 240);
        assert_eq!(state(&previous, "a").last_outcome, Some(RunOutcome::Firing));
    }

    #[test]
    fn incomplete_evaluations_never_reset_or_resolve() {
        let mut previous = HashMap::new();
        run(&mut previous, &["a"], 0, 0);
        let mut incomplete = classification(&[]);
        incomplete.page = FetchPage {
            filled: true,
            reached_healthy: false,
        };
        let plan = plan_rule_updates("rule", &incomplete, &previous, 600_000_000, 0, 0);
        assert!(plan.updates.is_empty());
        assert_eq!(state(&previous, "a").last_outcome, Some(RunOutcome::Firing));
    }

    #[test]
    fn raw_strings_survive_transition_wire_format() {
        let mut previous = HashMap::new();
        let plan = run(&mut previous, &["a"], 0, 0);
        let bytes = serde_json::to_vec(&plan).unwrap();
        let back: GroupPlan = serde_json::from_slice(&bytes).unwrap();
        let t = back
            .updates
            .iter()
            .find_map(|u| u.transition.as_ref().filter(|t| !t.group_key.is_empty()))
            .unwrap();
        assert_eq!(t.rule_value.as_deref(), Some("+Inf"));
        assert_eq!(t.value, None);
    }

    /// AC-P2.1.4
    #[test]
    fn a_rollup_that_falls_back_to_pending_closes_its_firing_cycle() {
        let mut previous = HashMap::new();
        run(&mut previous, &["a"], 0, 240);
        run(&mut previous, &["a"], 240, 240);
        let fired = Some(240_000_000);
        assert_eq!(previous[ROLLUP_GROUP_KEY].firing_started_at, fired);
        assert_eq!(state(&previous, "a").firing_started_at, fired);

        // "a" vanished and "b" is still pending: groups exist, none fires.
        run(&mut previous, &["b"], 300, 240);
        assert_eq!(
            previous[ROLLUP_GROUP_KEY].last_outcome,
            Some(RunOutcome::Pending)
        );
        assert_eq!(previous[ROLLUP_GROUP_KEY].firing_started_at, None);
        assert_eq!(state(&previous, "a").firing_started_at, None);
        assert_eq!(state(&previous, "b").firing_started_at, None);
    }

    #[test]
    fn the_single_row_rule_rollup_also_closes_on_pending() {
        let fired = apply_rule_rollup_outcome(
            "rule",
            None,
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            100,
            None,
        )
        .state
        .unwrap();
        assert_eq!(fired.firing_started_at, Some(100));
        let pending = apply_rule_rollup_outcome(
            "rule",
            Some(&fired),
            RunOutcome::Pending,
            Some(AlertLevel::Critical),
            200,
            None,
        )
        .state
        .unwrap();
        assert_eq!(pending.firing_started_at, None);
    }

    fn run_held(previous: &mut HashMap<String, AlertState>, hosts: &[&str], sec: i64) -> GroupPlan {
        let plan = plan_rule_updates(
            "rule",
            &classification(hosts),
            previous,
            sec * 1_000_000,
            0,
            60,
        );
        for close in &plan.closed_episodes {
            let row = previous.get_mut(&close.group_key).unwrap();
            row.episode_id = None;
            row.recovering_since = None;
        }
        for u in &plan.updates {
            if let Some(s) = &u.state {
                let episode = previous
                    .get(&s.group_key)
                    .and_then(|p| p.episode_id.clone());
                let mut next = s.clone();
                if s.group_key != ROLLUP_GROUP_KEY {
                    next.episode_id = episode;
                }
                previous.insert(s.group_key.clone(), next);
            }
        }
        plan
    }

    #[test]
    fn a_returned_series_ends_the_hold_and_the_next_absence_starts_a_fresh_one() {
        let mut previous = HashMap::new();
        run_held(&mut previous, &["a"], 0);
        let k = group_key(&std::collections::BTreeMap::from([(
            "host".into(),
            "a".into(),
        )]));
        previous.get_mut(&k).unwrap().episode_id = Some("ep".into());

        assert!(run_held(&mut previous, &[], 10).closed_episodes.is_empty());
        assert_eq!(state(&previous, "a").recovering_since, Some(10_000_000));
        run_held(&mut previous, &["a"], 40);
        assert!(state(&previous, "a").recovering_since.is_none());
        assert_eq!(state(&previous, "a").episode_id.as_deref(), Some("ep"));

        for sec in [80, 100, 139] {
            assert!(run_held(&mut previous, &[], sec).closed_episodes.is_empty());
        }
        let plan = run_held(&mut previous, &[], 140);
        assert_eq!(plan.closed_episodes.len(), 1);
        let close = &plan.closed_episodes[0];
        assert_eq!(close.recovered_at, 80_000_000);
        assert_eq!(
            close.reason,
            crate::meta::alerts::recovery::RecoveryReason::Cleared
        );
        assert_eq!(close.labels.get("host").map(String::as_str), Some("a"));
        assert!(run_held(&mut previous, &[], 200).closed_episodes.is_empty());
    }

    #[test]
    fn a_truncated_page_closes_nothing() {
        let mut previous = HashMap::new();
        run(&mut previous, &["a"], 0, 0);
        for s in previous.values_mut() {
            s.episode_id = Some("ep".into());
        }
        let mut incomplete = classification(&[]);
        incomplete.page = FetchPage {
            filled: true,
            reached_healthy: false,
        };
        let plan = plan_rule_updates("rule", &incomplete, &previous, 600_000_000, 0, 0);
        assert!(plan.closed_episodes.is_empty());
    }
}

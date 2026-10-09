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
        resolve_group_update,
    },
    level::AlertLevel,
    state::{AlertState, ROLLUP_GROUP_KEY, apply_outcome},
};
use crate::meta::self_reporting::usage::RunOutcome;

pub fn plan_rule_updates(
    alert_id: &str,
    classification: &GroupClassification,
    previous: &HashMap<String, AlertState>,
    at: i64,
    pending_sec: i64,
) -> GroupPlan {
    if classification.page.completeness() != GroupPageCompleteness::Complete {
        return GroupPlan {
            updates: vec![],
            evicted: vec![],
        };
    }
    let interrupted = previous
        .get(ROLLUP_GROUP_KEY)
        .is_some_and(|s| matches!(s.last_outcome, Some(RunOutcome::Error)));
    let mut updates = Vec::new();
    let mut retained = HashSet::new();
    let mut firing = false;
    for group in &classification.groups {
        let key = group_key(&group.labels);
        retained.insert(key.clone());
        let mut prev = previous.get(&key).cloned();
        if interrupted
            && let Some(p) = prev.as_mut()
            && p.last_outcome == Some(RunOutcome::Pending)
        {
            p.since = p
                .since
                .map(|since| since.saturating_add(at.saturating_sub(p.last_seen.unwrap_or(at))));
        }
        let outcome = rule_outcome(prev.as_ref(), at, pending_sec);
        firing |= outcome == RunOutcome::Firing;
        let mut update = apply_outcome(
            alert_id,
            &key,
            prev.as_ref(),
            outcome,
            Some(AlertLevel::Critical),
            at,
        );
        if let Some(s) = update.state.as_mut() {
            s.group_labels = Some(render_labels(&group.labels));
        }
        if let Some(t) = update.transition.as_mut() {
            t.group_labels = Some(render_labels(&group.labels));
            t.rule_value = group.rule_value.clone();
        }
        updates.push(update);
    }
    for (key, prev) in previous {
        if key != ROLLUP_GROUP_KEY && !retained.contains(key) {
            updates.push(resolve_group_update(alert_id, key, prev, at));
        }
    }
    let outcome = if classification.groups.is_empty() {
        RunOutcome::Normal
    } else if firing {
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
        s.groups_observed = Some(classification.groups.len());
        s.groups_firing = Some(classification.groups.len());
        s.groups_observed_is_lower_bound = Some(false);
        s.groups_firing_is_lower_bound = Some(false);
    }
    updates.push(rollup);
    GroupPlan {
        updates,
        evicted: vec![],
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
        assert_eq!(
            state(&previous, "a").last_outcome,
            Some(RunOutcome::Pending)
        );
        run(&mut previous, &["a", "b"], 180, 240);
        run(&mut previous, &["a", "b"], 240, 240);
        assert_eq!(state(&previous, "a").last_outcome, Some(RunOutcome::Firing));
        assert_eq!(
            state(&previous, "b").last_outcome,
            Some(RunOutcome::Pending)
        );
        let absent = run(&mut previous, &[], 300, 240);
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
        let plan = plan_rule_updates("rule", &incomplete, &previous, 600_000_000, 0);
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
}

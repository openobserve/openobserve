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

//! Multi-alerts: per-group evaluation — Feature 3 of `alerts_2.md`.
//!
//! Pure logic only: group identity, per-group classification, rollup severity
//! (M-2), the cardinality cap (M-6) and disappearance detection (M-7).
//! Persistence lives in `infra::table::alert_states`.

use std::collections::BTreeMap;

use super::{
    TriggerCondition,
    level::{AlertLevel, evaluate_level},
};

/// One group's observed value for a single evaluation.
#[derive(Clone, Debug, PartialEq)]
pub struct GroupObservation {
    pub labels: BTreeMap<String, String>,
    pub actual_value: f64,
}

impl GroupObservation {
    pub fn new(labels: BTreeMap<String, String>, actual_value: f64) -> Self {
        Self {
            labels,
            actual_value,
        }
    }
}

/// A group after threshold classification.
#[derive(Clone, Debug, PartialEq)]
pub struct ClassifiedGroup {
    pub labels: BTreeMap<String, String>,
    pub actual_value: f64,
    /// `None` = matched no threshold (healthy).
    pub level: Option<AlertLevel>,
}

impl ClassifiedGroup {
    fn rank(&self) -> u8 {
        self.level.map(|l| l.severity_rank()).unwrap_or(0)
    }
}

/// Whether the cardinality cap truncated this evaluation (M-6).
///
/// Overflow must be *reported*, never silent: a 900-group alert that renders as
/// a 500-group one is indistinguishable from a correct result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupCapOutcome {
    WithinCap,
    Exceeded { observed: usize, cap: usize },
}

/// Result of classifying one evaluation's groups.
#[derive(Clone, Debug, PartialEq)]
pub struct GroupClassification {
    /// Retained groups, most severe first.
    pub groups: Vec<ClassifiedGroup>,
    /// Rollup row level (M-2) — `None` only when no groups were observed.
    pub rollup: Option<AlertLevel>,
    pub cap: GroupCapOutcome,
}

impl GroupClassification {
    /// The group that produced the worst level — the one whose value goes on
    /// the single per-evaluation trigger record (D8).
    pub fn worst_group(&self) -> Option<&ClassifiedGroup> {
        self.groups
            .iter()
            .filter(|g| g.level.is_some())
            .max_by_key(|g| g.rank())
    }
}

/// Stable, collision-resistant identity for a label set.
///
/// Length-prefixed encoding before hashing: a naive `k=v` join lets a label
/// *value* impersonate an extra label (`{extra:"b,host=a"}` would collide with
/// `{extra:"b", host:"a"}`), which would let user-controlled data corrupt
/// another group's state row.
///
/// Hashed rather than joined because `alert_states.group_key` is
/// `VARCHAR(256)`; a raw join overflows it for realistic k8s label sets.
pub fn group_key(labels: &BTreeMap<String, String>) -> String {
    let mut buf = String::new();
    // BTreeMap iterates sorted, so the encoding is order-insensitive.
    for (k, v) in labels {
        buf.push_str(&format!("{}:{}:{}:{};", k.len(), k, v.len(), v));
    }
    // 64 hex chars — comfortably inside the column, and never the empty string,
    // so an ungrouped result can never be mistaken for the rollup row.
    sha256::digest(buf)
}

/// Rollup level across a set of per-group levels (M-2).
///
/// A group matching no threshold contributes `Ok` — it is healthy, not
/// "no opinion". An empty set returns `None`: no groups at all is a distinct
/// state from "all groups fine" (the `NoData` hook, §7.3).
pub fn rollup_level(levels: &[Option<AlertLevel>]) -> Option<AlertLevel> {
    if levels.is_empty() {
        return None;
    }
    AlertLevel::most_severe(levels.iter().map(|l| l.unwrap_or(AlertLevel::Ok)))
}

/// Classify every observed group, applying the cardinality cap.
///
/// Admission is `(severity desc, group_key asc)`: severity always wins, so a
/// Critical group can never be evicted to keep an `Ok` one, and the tiebreak is
/// deterministic so an unchanged observation set retains an unchanged row set
/// (no churn from re-selection). `cap == 0` means unlimited.
pub fn classify_groups(
    observations: Vec<GroupObservation>,
    tc: &TriggerCondition,
    cap: usize,
) -> GroupClassification {
    let observed = observations.len();

    let mut groups: Vec<ClassifiedGroup> = observations
        .into_iter()
        .map(|o| {
            let level = evaluate_level(o.actual_value, tc);
            ClassifiedGroup {
                labels: o.labels,
                actual_value: o.actual_value,
                level,
            }
        })
        .collect();

    groups.sort_by(|a, b| {
        b.rank()
            .cmp(&a.rank())
            .then_with(|| group_key(&a.labels).cmp(&group_key(&b.labels)))
    });

    let cap_outcome = if cap > 0 && observed > cap {
        groups.truncate(cap);
        GroupCapOutcome::Exceeded { observed, cap }
    } else {
        GroupCapOutcome::WithinCap
    };

    // Computed from retained groups; since admission is severity-first, the
    // most severe group is always retained, so this equals the true rollup.
    let levels: Vec<Option<AlertLevel>> = groups.iter().map(|g| g.level).collect();

    GroupClassification {
        rollup: rollup_level(&levels),
        groups,
        cap: cap_outcome,
    }
}

/// Group keys present in the previous evaluation but absent from this one
/// (M-7). Callers age these out on elapsed time rather than resolving them
/// immediately — a single missing evaluation is not a disappearance.
pub fn vanished_groups(previous: &[String], current: &[String]) -> Vec<String> {
    previous
        .iter()
        .filter(|k| !current.contains(k))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::meta::alerts::{
        Operator, TriggerCondition,
        grouping::{GroupCapOutcome, GroupObservation, classify_groups, group_key, rollup_level},
        level::AlertLevel,
    };

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn tc(op: Operator, critical: i64, warning: Option<i64>) -> TriggerCondition {
        TriggerCondition {
            operator: op,
            threshold: critical,
            warning_threshold: warning,
            ..Default::default()
        }
    }

    // ── group_key: deterministic identity ───────────────────────────────────
    // The key is the primary key of `alert_states`, so it must be stable
    // across processes and insensitive to label ordering.

    #[test]
    fn test_group_key_is_stable_for_same_labels() {
        let a = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        let b = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        assert_eq!(a, b);
    }

    #[test]
    fn test_group_key_is_order_insensitive() {
        // BTreeMap already sorts, but the contract must hold regardless of the
        // order the query returned the columns in.
        let a = group_key(&labels(&[("env", "prod"), ("host", "a")]));
        let b = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        assert_eq!(a, b);
    }

    #[test]
    fn test_group_key_differs_per_group() {
        let a = group_key(&labels(&[("host", "a")]));
        let b = group_key(&labels(&[("host", "b")]));
        assert_ne!(a, b);
    }

    #[test]
    fn test_group_key_resists_delimiter_injection() {
        // A naive `sorted k=v joined by ","` encoding collides here: BOTH of
        // these render as `extra=b,host=a`. A label value chosen by a user
        // (a hostname, a k8s label) could therefore be made to impersonate a
        // different group and corrupt its state row.
        //
        // An earlier version of this test compared {host:"a,b"} against
        // {host:"a", extra:"b"} — those differ under the naive encoding too,
        // so it passed against a vulnerable implementation.
        let two_labels = group_key(&labels(&[("extra", "b"), ("host", "a")]));
        let one_label = group_key(&labels(&[("extra", "b,host=a")]));
        assert_ne!(
            two_labels, one_label,
            "delimiter injection must not let one label impersonate two"
        );
    }

    #[test]
    fn test_group_key_is_bounded_in_length() {
        // `alert_states.group_key` is VARCHAR(256) (alerts.md Part IV). A raw
        // label join would overflow it for realistic k8s label sets and the
        // insert would fail — or silently truncate and merge distinct groups.
        let long = labels(&[
            ("k8s_namespace", &"n".repeat(200)),
            ("k8s_pod_name", &"p".repeat(200)),
            ("k8s_container", &"c".repeat(200)),
        ]);
        let key = group_key(&long);
        assert!(
            key.len() <= 256,
            "group_key must fit the column; got {} chars",
            key.len()
        );
    }

    #[test]
    fn test_empty_labels_never_collide_with_rollup_key() {
        use crate::meta::alerts::state::ROLLUP_GROUP_KEY;
        // An ungrouped result must not be written as if it were the rollup row.
        assert_ne!(group_key(&BTreeMap::new()), ROLLUP_GROUP_KEY);
    }

    // ── M-1: each group classified independently ────────────────────────────

    #[test]
    fn test_each_group_gets_its_own_level() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let obs = vec![
            GroupObservation::new(labels(&[("host", "a")]), 150.0),
            GroupObservation::new(labels(&[("host", "b")]), 75.0),
            GroupObservation::new(labels(&[("host", "c")]), 10.0),
        ];

        let result = classify_groups(obs, &c, 500);
        let by_host = |h: &str| {
            result
                .groups
                .iter()
                .find(|g| g.labels.get("host").map(String::as_str) == Some(h))
                .unwrap()
                .level
        };

        assert_eq!(by_host("a"), Some(AlertLevel::Critical));
        assert_eq!(by_host("b"), Some(AlertLevel::Warning));
        assert_eq!(by_host("c"), None, "below both thresholds");
    }

    #[test]
    fn test_group_observation_carries_actual_value_for_t9() {
        // T-9: the actual value must survive classification so it can be
        // written to the triggers stream.
        let c = tc(Operator::GreaterThan, 100, None);
        let result = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 137.5)],
            &c,
            500,
        );
        assert_eq!(result.groups[0].actual_value, 137.5);
    }

    // ── M-2: rollup = most severe across groups ─────────────────────────────

    #[test]
    fn test_rollup_is_most_severe_group() {
        assert_eq!(
            rollup_level(&[
                Some(AlertLevel::Ok),
                Some(AlertLevel::Warning),
                Some(AlertLevel::Critical)
            ]),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            rollup_level(&[Some(AlertLevel::Ok), Some(AlertLevel::Warning)]),
            Some(AlertLevel::Warning)
        );
    }

    #[test]
    fn test_rollup_of_all_ok_is_ok() {
        assert_eq!(
            rollup_level(&[Some(AlertLevel::Ok), Some(AlertLevel::Ok)]),
            Some(AlertLevel::Ok)
        );
    }

    #[test]
    fn test_rollup_ignores_unmatched_groups() {
        // A group below every threshold contributes Ok, not "no opinion".
        assert_eq!(
            rollup_level(&[None, Some(AlertLevel::Warning)]),
            Some(AlertLevel::Warning)
        );
        assert_eq!(rollup_level(&[None, None]), Some(AlertLevel::Ok));
    }

    #[test]
    fn test_rollup_of_no_groups_is_none() {
        // No rows at all is NOT "everything is fine" — it is a distinct state
        // that the NoData policy (§7.3) will own.
        assert_eq!(rollup_level(&[]), None);
    }

    #[test]
    fn test_classify_sets_rollup_on_result() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let result = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 10.0),
                GroupObservation::new(labels(&[("host", "b")]), 150.0),
            ],
            &c,
            500,
        );
        assert_eq!(result.rollup, Some(AlertLevel::Critical));
    }

    // ── M-6: cardinality cap — must WARN, never silently truncate ───────────

    #[test]
    fn test_under_cap_reports_no_overflow() {
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 500);
        assert_eq!(result.groups.len(), 10);
        assert_eq!(result.cap, GroupCapOutcome::WithinCap);
    }

    #[test]
    fn test_over_cap_truncates_but_reports_the_true_total() {
        // Silent truncation would make a 900-group alert look like a 500-group
        // one. The overflow count must be recoverable.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..900)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 500);

        assert_eq!(result.groups.len(), 500, "state rows are capped");
        assert_eq!(
            result.cap,
            GroupCapOutcome::Exceeded {
                observed: 900,
                cap: 500
            },
            "the true group count must be reported so the UI can warn"
        );
    }

    #[test]
    fn test_over_cap_retains_the_most_severe_groups() {
        // If we must drop groups, dropping the Critical ones would be the
        // worst possible choice.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let mut obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 10.0))
            .collect();
        obs.push(GroupObservation::new(labels(&[("host", "bad")]), 500.0));

        let result = classify_groups(obs, &c, 3);
        assert_eq!(result.groups.len(), 3);
        assert!(
            result
                .groups
                .iter()
                .any(|g| g.labels.get("host").map(String::as_str) == Some("bad")),
            "the Critical group must survive truncation"
        );
        assert_eq!(result.rollup, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_truncation_is_deterministic_across_evaluations() {
        // If the surviving set varied between runs, every evaluation would
        // insert some state rows and orphan others — unbounded churn on the
        // hottest write path, and group history that flickers.
        let c = tc(Operator::GreaterThan, 100, None);
        let build = || {
            (0..50)
                .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i:02}"))]), 150.0))
                .collect::<Vec<_>>()
        };

        let first = classify_groups(build(), &c, 10);
        let second = classify_groups(build(), &c, 10);

        let keys = |r: &_| -> Vec<String> { classify_keys(r) };
        assert_eq!(
            keys(&first),
            keys(&second),
            "the same observations must keep the same groups every time"
        );
    }

    /// Helper: the group keys retained by a classification, in order.
    fn classify_keys(r: &crate::meta::alerts::grouping::GroupClassification) -> Vec<String> {
        r.groups.iter().map(|g| group_key(&g.labels)).collect()
    }

    #[test]
    fn test_cap_of_zero_is_treated_as_unlimited() {
        // Guard against a misconfigured cap silently disabling all grouping.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..20)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 0);
        assert_eq!(result.groups.len(), 20);
        assert_eq!(result.cap, GroupCapOutcome::WithinCap);
    }

    // ── M-7: group disappearance ────────────────────────────────────────────

    #[test]
    fn test_vanished_groups_are_reported_for_resolution() {
        use crate::meta::alerts::grouping::vanished_groups;

        let previous = vec![
            group_key(&labels(&[("host", "a")])),
            group_key(&labels(&[("host", "b")])),
        ];
        let current = vec![group_key(&labels(&[("host", "a")]))];

        let gone = vanished_groups(&previous, &current);
        assert_eq!(gone, vec![group_key(&labels(&[("host", "b")]))]);
    }

    #[test]
    fn test_no_vanished_groups_when_all_present() {
        use crate::meta::alerts::grouping::vanished_groups;
        let keys = vec![group_key(&labels(&[("host", "a")]))];
        assert!(vanished_groups(&keys, &keys).is_empty());
    }

    #[test]
    fn test_new_groups_are_not_reported_as_vanished() {
        use crate::meta::alerts::grouping::vanished_groups;
        let previous = vec![group_key(&labels(&[("host", "a")]))];
        let current = vec![
            group_key(&labels(&[("host", "a")])),
            group_key(&labels(&[("host", "new")])),
        ];
        assert!(vanished_groups(&previous, &current).is_empty());
    }

    // ── D8: one trigger record per evaluation, worst group ──────────────────

    #[test]
    fn test_worst_group_is_identifiable_for_the_trigger_record() {
        // §7.5 records ONE TriggerData per evaluation carrying the most severe
        // group's value and label. If this flips to per-group (D8), this test
        // is the one to change.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let result = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 60.0),
                GroupObservation::new(labels(&[("host", "b")]), 500.0),
                GroupObservation::new(labels(&[("host", "c")]), 10.0),
            ],
            &c,
            500,
        );

        let worst = result.worst_group().expect("a firing group exists");
        assert_eq!(worst.level, Some(AlertLevel::Critical));
        assert_eq!(worst.actual_value, 500.0);
        assert_eq!(worst.labels.get("host").map(String::as_str), Some("b"));
    }

    #[test]
    fn test_worst_group_is_none_when_nothing_fires() {
        let c = tc(Operator::GreaterThan, 100, None);
        let result = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 1.0)],
            &c,
            500,
        );
        assert!(result.worst_group().is_none());
    }
}

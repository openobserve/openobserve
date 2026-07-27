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

//! Per-group notification dispatch — `alerts_2.md` §5.5 (MN-1..MN-11).
//!
//! Pure decision logic only. The loop that *sends* lives in the scheduler
//! (OSS tail) and the batching worker (enterprise tail); everything here
//! decides **who gets notified, with what identity, and what gets written
//! back afterwards** — so all of it is unit-testable without a database or a
//! destination.
//!
//! The one-writer rule this module enforces: evaluation writes observation
//! state, these callbacks write delivery state (`silenced_until`,
//! `last_notified_level`), and neither touches the other's columns. MN-6
//! falls out of that split — a failed send advances nothing, so the group
//! re-qualifies at its next evaluation with no retry machinery at all.

use std::collections::{BTreeMap, HashMap};

use super::{
    TriggerCondition,
    grouping::{GroupClassification, group_key},
    level::{AlertLevel, DeliveryDecision, delivery_decision},
    state::{AlertState, StateTransition, StateUpdate},
};
use crate::meta::self_reporting::usage::RunOutcome;
use crate::utils::json::{Map, Value};

/// The version a delayed delivery carries — the group's **level-episode** at
/// enqueue time (§5.5 round-6): `level_since` advances only when the level
/// changes, so it is stable across same-level evaluations.
///
/// `level_at` (the freshness clock) is disqualified by construction: it
/// advances on *every* successful evaluation, so any batch that waited
/// through one evaluation cycle would fail its own version check, skip both
/// success and failure accounting, and page the steadily-firing group again
/// every window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeliveryEpisode {
    pub level: AlertLevel,
    pub level_since: i64,
    /// Delivery state as it stood when this attempt was enqueued.
    ///
    /// The episode pair alone identifies a level-episode, **not an attempt**:
    /// while a group keeps qualifying (nothing has advanced yet), successive
    /// evaluations can enqueue several deliveries inside one episode, and an
    /// older failure arriving after a newer success would pass a
    /// level-only guard and write `NotifyFailed` over a delivered group.
    ///
    /// A successful delivery is precisely what changes these two fields, so
    /// carrying them turns "has any attempt in this episode already
    /// succeeded?" into a comparison — no attempt counter, no new column.
    pub notified_at_enqueue: (Option<AlertLevel>, Option<i64>),
}

/// One group the dispatch loop should send for.
#[derive(Clone, Debug, PartialEq)]
pub struct DispatchItem {
    pub group_key: String,
    pub labels: BTreeMap<String, String>,
    pub level: AlertLevel,
    pub actual_value: f64,
    /// True when `delivery_decision` returned `DeliverEscalation` — the
    /// delivery that overrides an active silence window.
    pub escalation: bool,
    /// Carried through async delivery for the conditional callback writes.
    pub episode: DeliveryEpisode,
    /// This group's **original** result row (MN-3) — the notification payload.
    ///
    /// Carried on the item rather than looked up later so the send path cannot
    /// silently fall back to a synthesized row: templates and alert-time
    /// calculation read `zo_sql_min_time`/`zo_sql_max_time` and any other
    /// column the query returned.
    pub row: Map<String, Value>,
}

/// What one evaluation should deliver, in order.
#[derive(Clone, Debug, PartialEq)]
pub struct DispatchPlan {
    /// Qualifying sends, **worst-first** (severity desc, `group_key` asc) and
    /// already truncated by the MN-8 knob.
    pub items: Vec<DispatchItem>,
    /// Groups `delivery_decision` suppressed (silence / warning policy).
    pub suppressed: usize,
    /// Qualifying groups dropped by the MN-8 knob — reported so the caller
    /// can log them; silent truncation is not acceptable here either.
    pub dropped_by_knob: Vec<String>,
    /// Retained firing groups with **no state row** after the plan committed,
    /// and duplicate group keys within one evaluation. Both are consistency
    /// failures rather than routine outcomes: reported for logging, and
    /// deliberately NOT dispatched — see [`plan_dispatch`].
    pub inconsistent: Vec<String>,
}

/// Decide which groups this evaluation notifies (MN-1, MN-8).
///
/// * Candidates are **only** `classification.groups` — the post-cap retained
///   set. `dropped` keys have no state rows to hold delivery state, and the
///   pre-cap observation set would bypass the M-6 bound entirely.
/// * Per group, §7.1's `delivery_decision` runs against the group's own
///   delivery state (`last_notified_level`, `silenced_until`) from `states` —
///   which the caller reads back *after* `persist_group_plan`, so the level
///   axis is this evaluation's. One rule covers first-fire, escalation,
///   re-notify after silence expiry, and re-delivery after a failed send
///   (whose state never advanced, MN-6).
/// * A retained group with **no state row** is a consistency failure, not a
///   routine case: `persist_group_plan` committed a row for every retained
///   group before dispatch runs. It is reported in `inconsistent` and **not
///   dispatched**. Paging anyway would be unbounded rather than merely
///   duplicated — with no row, a successful delivery has nothing to record
///   itself on, so the group would re-page every evaluation forever.
///   Skipping costs at most one cycle, and the next evaluation has the row.
/// * **Duplicate group keys** are likewise refused (`inconsistent`): a
///   classification carrying one key twice would otherwise notify the group
///   twice and consume two slots of the MN-8 budget.
/// * `max_sends` is the MN-8 knob: `0` = unlimited; otherwise it counts
///   **qualifying** sends (applied after `delivery_decision`), worst-first.
pub fn plan_dispatch(
    classification: &GroupClassification,
    states: &HashMap<String, AlertState>,
    rows: &HashMap<String, Map<String, Value>>,
    tc: &TriggerCondition,
    now: i64,
    max_sends: usize,
) -> DispatchPlan {
    let mut items = Vec::new();
    let mut suppressed = 0usize;
    let mut dropped_by_knob = Vec::new();
    let mut inconsistent = Vec::new();

    // A key appearing twice in one classification is an invariant violation
    // (validation rejects the known source, MN-12). Counting first means both
    // copies are refused, rather than the first winning by accident.
    let mut occurrences: HashMap<&str, usize> = HashMap::new();
    let keys: Vec<String> = classification
        .groups
        .iter()
        .map(|g| group_key(&g.labels))
        .collect();
    for key in &keys {
        *occurrences.entry(key.as_str()).or_default() += 1;
    }

    // `classification.groups` is already `(severity desc, group_key asc)`, so
    // iterating it IS worst-first — the knob therefore always keeps the most
    // severe groups, and ties break deterministically.
    for (group, key) in classification.groups.iter().zip(&keys) {
        if occurrences[key.as_str()] > 1 {
            if !inconsistent.contains(key) {
                inconsistent.push(key.clone());
            }
            continue;
        }

        // Healthy groups are not candidates, and are not "suppressed" either —
        // nothing was withheld from them.
        let Some(level) = group.level.filter(|l| l.is_firing()) else {
            continue;
        };

        // Both of these are consistency failures, not routine outcomes: the
        // plan committed a row for every retained group before dispatch ran,
        // and MN-3 forbids synthesizing a payload.
        let (Some(state), Some(row)) = (states.get(key), rows.get(key)) else {
            inconsistent.push(key.clone());
            continue;
        };
        let Some(episode) = DeliveryEpisode::of(state) else {
            inconsistent.push(key.clone());
            continue;
        };

        let decision = delivery_decision(
            level,
            state.last_notified_level,
            state.silenced_until,
            now,
            tc.notify_on_warning,
        );
        match decision {
            DeliveryDecision::Deliver | DeliveryDecision::DeliverEscalation => {
                // The knob counts QUALIFYING sends, so a silenced group never
                // spends budget a deliverable one could have used.
                if max_sends > 0 && items.len() >= max_sends {
                    dropped_by_knob.push(key.clone());
                    continue;
                }
                items.push(DispatchItem {
                    group_key: key.clone(),
                    labels: group.labels.clone(),
                    level,
                    actual_value: group.actual_value,
                    escalation: decision == DeliveryDecision::DeliverEscalation,
                    episode,
                    row: row.clone(),
                });
            }
            DeliveryDecision::SuppressedBySilence
            | DeliveryDecision::SuppressedByWarningPolicy => suppressed += 1,
            DeliveryDecision::NotFiring => {}
        }
    }

    DispatchPlan {
        items,
        suppressed,
        dropped_by_knob,
        inconsistent,
    }
}

/// The write that records one group's **successful** delivery (MN-6).
///
/// Returns the full replacement row, or `None` when the carried **level-episode
/// pair** (`level`, `level_since`) no longer matches `current`.
///
/// **Checks the episode pair only — deliberately NOT `notified_at_enqueue`.**
/// The guards are asymmetric, and the asymmetry is the whole design:
/// * a *success* is a fact about the world (the page went out), so recording
///   it is always correct — at worst it refreshes a window that a sibling
///   attempt already set;
/// * a *failure* is an assertion that nothing was delivered, which a newer
///   success in the same episode falsifies — so [`delivery_failure_update`]
///   checks the anchor as well.
///
/// Checking the anchor here too would break the legitimate case in
/// `test_no_monotonicity_a_new_warning_episode_resets_the_baseline`: a new
/// episode's first delivery carries an anchor of `(None, None)` while the row
/// still holds the *previous* incident's `last_notified_level`, so an
/// anchor-checking success would refuse to reset the baseline — and the next
/// escalation inside that window would then be suppressed.
///
/// Sets exactly two fields: `last_notified_level` to the
/// delivered level (no monotonicity — a later legitimate Warning delivery
/// must establish the Warning baseline, §5.5 round-6) and `silenced_until` to
/// `delivered_at + silence`, or `None` when `silence_minutes <= 0` (silence
/// zero means "page every evaluation", the pre-Feature-1 cadence).
pub fn delivery_success_update(
    current: &AlertState,
    episode: DeliveryEpisode,
    silence_minutes: i64,
    delivered_at: i64,
) -> Option<AlertState> {
    if current.level != Some(episode.level) || current.level_since != Some(episode.level_since) {
        return None;
    }

    let candidate = (silence_minutes > 0)
        .then(|| delivered_at.saturating_add(silence_minutes.saturating_mul(60 * 1_000_000)));

    let mut next = current.clone();
    next.last_notified_level = Some(episode.level);
    // Never move the window BACKWARDS. Success ignores the attempt anchor, so
    // two callbacks in one episode both reach here; if the one computing the
    // earlier window commits second, an unconditional assignment would shorten
    // a live silence and let the group page early. Taking the later of the two
    // makes commit order irrelevant — and `None` (silence = 0) is the earliest
    // window, not the newest, so it cannot wipe a live one.
    next.silenced_until = match (current.silenced_until, candidate) {
        (Some(existing), Some(new)) => Some(existing.max(new)),
        (Some(existing), None) => Some(existing),
        (None, new) => new,
    };
    Some(next)
}

/// The write that records one group's **failed** delivery (MN-7).
///
/// Returns the replacement row, or `None` when the episode is stale — which
/// now covers **two** races: a queued Warning delivery failing after the
/// group's recovery committed (level-episode moved), and an older attempt
/// failing after a newer attempt *in the same episode* already succeeded
/// (`notified_at_enqueue` no longer matches). Flips the outcome axis to
/// `NotifyFailed` (still a firing state) and advances `last_outcome_at`;
/// touches **nothing else**: not the delivery state (the group must
/// re-qualify, MN-6), not the level axis, and not `last_seen` — a delivery
/// failure is not an observation, and advancing the M-7 clock here would
/// postpone a genuine disappearance.
/// Returns a full [`StateUpdate`], not a bare row, because a delivery failure
/// moves the **outcome axis** and that axis has invariants the rest of the
/// state model already enforces (`state::apply_outcome`):
/// * `since` records when `last_outcome` last *changed*, so a first
///   `Firing → NotifyFailed` must move it — leaving it at the Firing start
///   would make "notify-failed for 20 minutes" read as the firing duration;
/// * an outcome change is a **transition**, and per-group history lives in
///   `alert_state_transitions` (MN-9/M-8), so the recovery pairing and the
///   history drawer both depend on it being written;
/// * a *repeated* failure changes nothing on either axis, so it must preserve
///   `since` and emit no duplicate transition — the same
///   transition-bounded-writes rule the evaluation path follows.
pub fn delivery_failure_update(
    current: &AlertState,
    episode: DeliveryEpisode,
    failed_at: i64,
) -> Option<super::state::StateUpdate> {
    if current.level != Some(episode.level) || current.level_since != Some(episode.level_since) {
        return None;
    }
    // The attempt anchor: a newer success in this episode has already moved
    // delivery state, so this failure is describing a send that has been
    // overtaken.
    if (current.last_notified_level, current.silenced_until) != episode.notified_at_enqueue {
        return None;
    }

    let outcome_changed = current.last_outcome != Some(RunOutcome::NotifyFailed);

    let mut state = current.clone();
    state.last_outcome = Some(RunOutcome::NotifyFailed);
    state.last_outcome_at = Some(failed_at);
    if outcome_changed {
        // `since` records when the outcome last CHANGED; a repeated failure
        // must leave it, so "delivery has been failing since X" stays true.
        state.since = Some(failed_at);
    }

    let transition = outcome_changed.then(|| StateTransition {
        alert_id: current.alert_id.clone(),
        group_key: current.group_key.clone(),
        from_outcome: current.last_outcome.clone(),
        to_outcome: RunOutcome::NotifyFailed,
        // Delivery does not touch the level axis, so the transition records no
        // level change either.
        from_level: current.level,
        to_level: current.level,
        at: failed_at,
        // A delivery failure is not an observation.
        value: None,
        group_labels: current.group_labels.clone(),
    });

    Some(StateUpdate {
        state: Some(state),
        transition,
    })
}

/// Whether an alert keeps evaluating while silenced (MN-10 / §7.1).
///
/// §7.1: a warning-configured alert evaluates through silence. A multi-alert
/// does so **unconditionally** — silence state is per group, so pausing the
/// trigger after host-a pages would leave host-b unevaluated and unpaged for
/// the whole window, and would freeze every group's `last_seen` besides.
pub fn evaluates_through_silence(multi_alert: bool, has_warning: bool) -> bool {
    multi_alert || has_warning
}

/// `group_key -> original result row`, verbatim (MN-3).
///
/// The dispatch item's notification payload must be the group's real row —
/// `zo_sql_min_time`, `zo_sql_max_time` and every other column the query
/// returned — because row templates and alert-time calculation consume them;
/// a row synthesized from labels + value silently changes their output.
/// Labels are extracted exactly as the evaluation's observation builder does
/// (same rendering for non-string values), so the keys here are identical to
/// the keys `classify_groups` produced. First row wins on a duplicate key.
pub fn rows_by_group_key(
    records: &[Map<String, Value>],
    group_by: &[String],
) -> HashMap<String, Map<String, Value>> {
    let mut out = HashMap::with_capacity(records.len());
    for row in records {
        let key = super::grouping::group_key(&row_group_labels(row, group_by));
        // First row wins: deterministic, and a `GROUP BY` result should not
        // repeat a key anyway (dispatch reports it if one does).
        out.entry(key).or_insert_with(|| row.clone());
    }
    out
}

/// Extract a row's group labels the same way the evaluation does — shared so
/// [`rows_by_group_key`] and the fan-out cannot drift apart on rendering.
pub fn row_group_labels(
    row: &Map<String, Value>,
    group_by: &[String],
) -> BTreeMap<String, String> {
    group_by
        .iter()
        .filter_map(|col| {
            row.get(col).map(|v| {
                let rendered = match v.as_str() {
                    Some(s) => s.to_string(),
                    // A non-string group value (numeric pod ordinal, bool
                    // flag) is still an identity — render it rather than drop
                    // the group entirely.
                    None => v.to_string(),
                };
                (col.clone(), rendered)
            })
        })
        // A column absent from the row is skipped rather than defaulted: the
        // group's identity is whatever the query actually returned.
        .collect()
}

// Re-exported so callers building episodes from a state row cannot get the
// pairing wrong.
impl DeliveryEpisode {
    /// The episode a state row is currently in, if it has a classified level,
    /// snapshotting its delivery state as the attempt anchor.
    pub fn of(state: &AlertState) -> Option<Self> {
        Some(Self {
            level: state.level?,
            // A classified row always has `level_since` (`apply_outcome` sets
            // them together). Defaulting a missing one to 0 would mint an
            // episode the guarded UPDATE can never match — the delivery would
            // never be recorded and the group would re-page every cycle — so a
            // row that cannot name its episode gets none.
            level_since: state.level_since?,
            notified_at_enqueue: (state.last_notified_level, state.silenced_until),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;
    use crate::meta::{
        alerts::{
            Operator, TriggerCondition,
            grouping::{GroupObservation, classify_groups, group_key},
            level::AlertLevel,
            state::ROLLUP_GROUP_KEY,
        },
        self_reporting::usage::RunOutcome,
    };

    const SEC: i64 = 1_000_000;
    const MIN: i64 = 60 * SEC;

    fn row(pairs: &[(&str, serde_json::Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn tc(notify_on_warning: Option<bool>) -> TriggerCondition {
        TriggerCondition {
            operator: Operator::GreaterThanEquals,
            threshold: 1,
            notify_on_warning,
            ..Default::default()
        }
    }

    /// Classify a set of `(host, value)` observations with critical > 100,
    /// warning > 50 — the fixture classification most tests share.
    fn classified(obs: &[(&str, f64)], cap: usize) -> GroupClassification {
        let c = TriggerCondition {
            operator: Operator::GreaterThan,
            threshold: 100,
            warning_threshold: Some(50),
            ..Default::default()
        };
        classify_groups(
            obs.iter()
                .map(|(h, v)| GroupObservation::new(labels(&[("host", h)]), *v))
                .collect(),
            &c,
            cap,
        )
    }

    /// A group state row as it looks right after this evaluation's plan
    /// persisted: level axis current, delivery state as given.
    fn state(
        key: &str,
        level: AlertLevel,
        level_since: i64,
        last_notified: Option<AlertLevel>,
        silenced_until: Option<i64>,
    ) -> AlertState {
        AlertState {
            alert_id: "alert-1".to_string(),
            group_key: key.to_string(),
            last_outcome: Some(if level.is_firing() {
                RunOutcome::Firing
            } else {
                RunOutcome::Normal
            }),
            last_outcome_at: Some(level_since),
            since: Some(level_since),
            level: Some(level),
            level_since: Some(level_since),
            level_at: Some(level_since),
            last_seen: Some(level_since),
            group_labels: Some(format!("host={key}")),
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until,
            last_notified_level: last_notified,
        }
    }

    /// Original result rows keyed by group key — what MN-3 requires the
    /// dispatch item to carry.
    fn rows_for(classification: &GroupClassification) -> HashMap<String, Map<String, Value>> {
        classification
            .groups
            .iter()
            .map(|g| {
                let host = g.labels.get("host").cloned().unwrap_or_default();
                (
                    group_key(&g.labels),
                    row(&[
                        ("host", json!(host)),
                        ("alert_agg_value", json!(g.actual_value)),
                        ("zo_sql_min_time", json!(1_000)),
                        ("zo_sql_max_time", json!(2_000)),
                    ]),
                )
            })
            .collect()
    }

    fn key_of(host: &str) -> String {
        group_key(&labels(&[("host", host)]))
    }

    /// States map for every retained group in a classification, with the
    /// given delivery state applied to all of them.
    fn states_for(
        classification: &GroupClassification,
        now: i64,
        last_notified: Option<AlertLevel>,
        silenced_until: Option<i64>,
    ) -> HashMap<String, AlertState> {
        classification
            .groups
            .iter()
            .map(|g| {
                let key = group_key(&g.labels);
                let level = g.level.unwrap_or(AlertLevel::Ok);
                (
                    key.clone(),
                    state(&key, level, now, last_notified, silenced_until),
                )
            })
            .collect()
    }

    // ═════════════════════════════════════════════════════════════════════
    // plan_dispatch — MN-1: one decision rule for every delivery case
    // ═════════════════════════════════════════════════════════════════════

    #[test]
    fn test_first_fire_delivers_every_firing_group() {
        // The baseline multi-alert story: two hosts breach, both page,
        // independently. The healthy host does not.
        let c = classified(&[("a", 150.0), ("b", 75.0), ("c", 10.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), 1_000 * SEC, 0);

        assert_eq!(plan.items.len(), 2, "critical + warning fire; healthy does not");
        assert!(plan.items.iter().any(|i| i.group_key == key_of("a")));
        assert!(plan.items.iter().any(|i| i.group_key == key_of("b")));
        assert!(!plan.items.iter().any(|i| i.group_key == key_of("c")));
        assert!(plan.dropped_by_knob.is_empty());
    }

    #[test]
    fn test_healthy_groups_are_neither_dispatched_nor_counted_as_suppressed() {
        // `suppressed` means "wanted to page, wasn't allowed to" — it drives an
        // operator-facing log line. A healthy group never wanted to page, so
        // counting it would report an alert as heavily silenced when nothing
        // was withheld at all. Only `test_first_fire...` covers the dispatch
        // half; nothing pinned the counter until now.
        let now = 1_000 * SEC;
        let c = classified(&[("crit", 150.0), ("ok1", 1.0), ("ok2", 2.0)], 500);
        let states = states_for(&c, now, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(plan.items.len(), 1);
        assert_eq!(
            plan.suppressed, 0,
            "two healthy groups are not two suppressed notifications"
        );
        assert!(plan.inconsistent.is_empty());
    }

    #[test]
    fn test_a_first_fire_is_marked_as_an_escalation() {
        // `delivery_decision` treats "never notified" as an escalation, which
        // is what lets a first page cut through a silence window inherited
        // from a previous episode. The flag is carried to the notification, so
        // pin the semantics rather than leaving them to inference.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert!(
            plan.items[0].escalation,
            "a group that has never been notified is escalating into its first page"
        );
    }

    #[test]
    fn test_items_carry_the_groups_own_identity_not_the_worst() {
        // MN-3's identity half: each item is about ITS group. The warning
        // host's item must say 75 and Warning, not inherit the critical
        // sibling's 150.
        let c = classified(&[("a", 150.0), ("b", 75.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), 1_000 * SEC, 0);
        let b = plan
            .items
            .iter()
            .find(|i| i.group_key == key_of("b"))
            .expect("warning group dispatches");

        assert_eq!(b.level, AlertLevel::Warning);
        assert_eq!(b.actual_value, 75.0);
        assert_eq!(b.labels, labels(&[("host", "b")]));
    }

    #[test]
    fn test_dispatch_is_worst_first_with_deterministic_ties() {
        let c = classified(&[("warn", 75.0), ("crit2", 150.0), ("crit1", 150.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), 1_000 * SEC, 0);
        let keys: Vec<_> = plan.items.iter().map(|i| i.group_key.clone()).collect();

        assert_eq!(plan.items[0].level, AlertLevel::Critical);
        assert_eq!(plan.items[1].level, AlertLevel::Critical);
        assert_eq!(plan.items[2].level, AlertLevel::Warning);
        // Same severity ties break on group_key asc — the admission
        // contract's tiebreak, so the order is stable across evaluations.
        let (c1, c2) = (key_of("crit1"), key_of("crit2"));
        let expected_first = c1.clone().min(c2.clone());
        assert_eq!(keys[0], expected_first);
    }

    #[test]
    fn test_steady_group_inside_its_silence_window_is_suppressed() {
        // Delivered at Critical, silenced for 10 more minutes, still
        // Critical: no page. This is the per-group silence M-5 promises.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, Some(AlertLevel::Critical), Some(now + 10 * MIN));

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert!(plan.items.is_empty());
        assert_eq!(plan.suppressed, 1);
    }

    #[test]
    fn test_silence_expiry_redelivers_a_still_firing_group() {
        // §7.1: silence is the paging cadence, not a one-shot. The window
        // ended; the group is still Critical; it pages again.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, Some(AlertLevel::Critical), Some(now - 1));

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(plan.items.len(), 1);
        assert!(!plan.items[0].escalation, "same level again is not an escalation");
    }

    #[test]
    fn test_escalation_overrides_an_active_silence_window() {
        // D2 per group: Warning delivered and silenced, group goes Critical
        // mid-window — the page goes out anyway, marked as escalation.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, Some(AlertLevel::Warning), Some(now + 10 * MIN));

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(plan.items.len(), 1);
        assert!(plan.items[0].escalation);
    }

    #[test]
    fn test_failed_delivery_requalifies_next_evaluation() {
        // THE MN-6 composition test. Last cycle's send failed, so nothing
        // advanced: `last_notified_level` is still None and no silence window
        // exists. The steadily-firing group must page again — with
        // transition-driven dispatch it never would, because the level did
        // not change and no new transition exists.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let key = key_of("a");

        // A real post-failure row, not a pristine one. `level_since` in the
        // past (the group has been Critical for a while) AND — the part that
        // makes this test discriminating — `last_outcome = NotifyFailed`,
        // which is exactly what `delivery_failure_update` wrote last cycle.
        //
        // Without that outcome the fixture is byte-identical to a first fire,
        // so the test duplicates `test_first_fire_...` and cannot catch the
        // most tempting implementation mistake: filtering candidates to
        // `last_outcome == Firing`, which would skip precisely the groups
        // whose delivery failed and needs retrying.
        let mut row = state(&key, AlertLevel::Critical, now - 5 * MIN, None, None);
        row.last_outcome = Some(RunOutcome::NotifyFailed);
        row.last_outcome_at = Some(now - MIN);
        assert!(row.is_firing(), "NotifyFailed is still a firing state");

        let states = HashMap::from([(key.clone(), row)]);
        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(
            plan.items.len(),
            1,
            "a group whose last delivery failed must page again"
        );
        assert_eq!(plan.items[0].group_key, key);
    }

    #[test]
    fn test_notify_on_warning_false_suppresses_warning_groups_only() {
        // D11 per group: the flag mutes the warning band, not the alert.
        let c = classified(&[("crit", 150.0), ("warn", 75.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(Some(false)), 1_000 * SEC, 0);

        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.items[0].group_key, key_of("crit"));
        assert_eq!(plan.suppressed, 1, "the warning group was suppressed, not dropped");
    }

    #[test]
    fn test_candidates_come_only_from_the_retained_set() {
        // MN-8's bound: candidates come from the post-cap RETAINED set, never
        // the pre-cap observations.
        //
        // The dropped group is deliberately given both a state row and a
        // payload row — a leftover from before the cap displaced it. Without
        // them this test proves nothing: an implementation iterating the
        // pre-cap set would find no state, route the group to `inconsistent`,
        // and still leave `items.len() == 2`. Supplying both means the ONLY
        // thing that can keep it out of `items` is the retained-set rule.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0), ("b", 150.0), ("z", 150.0)], 2);
        assert_eq!(c.dropped.len(), 1, "fixture must actually drop a group");
        let dropped_key = c.dropped[0].clone();

        let mut states = states_for(&c, now, None, None);
        states.insert(
            dropped_key.clone(),
            state(&dropped_key, AlertLevel::Critical, now, None, None),
        );
        let mut rows = rows_for(&c);
        rows.insert(
            dropped_key.clone(),
            row(&[
                ("host", json!("dropped")),
                ("alert_agg_value", json!(150.0)),
            ]),
        );

        let plan = plan_dispatch(&c, &states, &rows, &tc(None), now, 0);

        assert_eq!(plan.items.len(), 2, "only retained groups dispatch");
        assert!(
            !plan.items.iter().any(|i| i.group_key == dropped_key),
            "a cap-dropped group must never be dispatched, even with state and a row to hand"
        );
        assert!(
            !plan.inconsistent.contains(&dropped_key),
            "and it is not an inconsistency — the cap dropping it is normal"
        );
    }

    #[test]
    fn test_the_rollup_row_is_never_dispatched() {
        // Production hands `plan_dispatch` the state map from
        // `load_tracked_group_states`, which deliberately INCLUDES the rollup
        // row — the planner needs it. Every other fixture here omits it, so
        // an implementation that iterated `states` instead of
        // `classification.groups` would page the rollup (a notification with
        // no group identity, and the alert-level duplicate that MN-1's
        // "dispatch replaces the alert-level send" exists to prevent) while
        // the whole suite stayed green.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let mut states = states_for(&c, now, None, None);
        states.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state(ROLLUP_GROUP_KEY, AlertLevel::Critical, now, None, None),
        );

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(plan.items.len(), 1, "one group fired, so one page");
        assert_eq!(plan.items[0].group_key, key_of("a"));
        assert!(
            !plan.items.iter().any(|i| i.group_key == ROLLUP_GROUP_KEY),
            "the rollup row is the alert's own state, never a dispatch candidate"
        );
        assert!(
            !plan.inconsistent.contains(&ROLLUP_GROUP_KEY.to_string()),
            "and its presence is expected, not an inconsistency"
        );
    }

    #[test]
    fn test_vanished_groups_are_not_dispatch_candidates() {
        // A state row with no matching observation this evaluation belongs to
        // M-7, not to dispatch — recoveries and disappearances never notify
        // (D15), and neither does a row that simply was not observed.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let mut states = states_for(&c, now, None, None);
        let gone = key_of("gone");
        states.insert(
            gone.clone(),
            state(&gone, AlertLevel::Critical, now - 5 * MIN, None, None),
        );

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert!(!plan.items.iter().any(|i| i.group_key == gone));
    }

    #[test]
    fn test_missing_state_row_is_refused_not_paged() {
        // `persist_group_plan` commits a row for every retained group before
        // dispatch runs, so an absent row is a consistency failure. Paging
        // anyway is not "one duplicate": with no row, a successful delivery
        // has nothing to record itself on, so the group would re-page every
        // evaluation FOREVER. Skipping costs at most one cycle.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);

        let plan = plan_dispatch(&c, &HashMap::new(), &rows_for(&c), &tc(None), now, 0);

        assert!(plan.items.is_empty(), "no durable row, no page");
        assert_eq!(
            plan.inconsistent,
            vec![key_of("a")],
            "and it must be reported, not silently dropped"
        );
    }

    #[test]
    fn test_missing_payload_row_is_refused_not_synthesized() {
        // MN-3 forbids a synthesized payload. If the row map somehow lacks the
        // group, refusing is the only option that cannot silently change what
        // a notification says.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, None, None);

        let plan = plan_dispatch(&c, &states, &HashMap::new(), &tc(None), now, 0);

        assert!(plan.items.is_empty());
        assert_eq!(plan.inconsistent, vec![key_of("a")]);
    }

    #[test]
    fn test_duplicate_group_keys_are_refused_outright() {
        // One coherent policy, because there is no safe alternative. The
        // classification is severity-sorted while `rows_by_group_key` keeps
        // the FIRST raw row, so for a duplicated key the winning level and the
        // winning payload can come from different observations — a Critical
        // item carrying a Warning row. Sending "once" would page a real
        // severity against a mismatched measurement, which is worse than not
        // paging: on-call would act on a number that never went with that
        // level.
        //
        // Validation already rejects the known duplicate source
        // (`multi_alert` + multi-window), so any duplicate reaching here is a
        // genuine invariant violation. Refusing and reporting matches how the
        // missing-state and missing-row cases are handled, and the next
        // evaluation recovers.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0), ("a", 150.0), ("b", 120.0)], 500);
        assert_eq!(c.groups.len(), 3, "fixture: `a` is observed twice");

        let states = states_for(&c, now, None, None);
        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert!(
            !plan.items.iter().any(|i| i.group_key == key_of("a")),
            "a duplicated key must not page at all"
        );
        assert_eq!(
            plan.items.len(),
            1,
            "only the unambiguous group pages; `b` is unaffected by `a`'s problem"
        );
        assert_eq!(plan.items[0].group_key, key_of("b"));
        assert!(plan.inconsistent.contains(&key_of("a")));
        assert!(!plan.inconsistent.contains(&key_of("b")));
    }

    #[test]
    fn test_conflicting_duplicate_values_never_produce_a_mismatched_page() {
        // The case the identical-value fixture cannot detect, and the reason
        // the policy is "refuse" rather than "coalesce". Here the same key is
        // observed at Warning and at Critical: severity-first ordering makes
        // the classification winner Critical, while the row map keeps
        // whichever row came first. Any implementation that paged once could
        // emit a Critical item carrying the 75.0 Warning row.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 75.0), ("a", 150.0), ("b", 120.0)], 500);
        assert_eq!(c.groups.len(), 3, "fixture: `a` observed at two levels");

        let states = states_for(&c, now, None, None);
        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        for item in &plan.items {
            assert_ne!(
                item.group_key,
                key_of("a"),
                "an ambiguous group must never page, at either level"
            );
            // Whatever does page must be internally consistent: its payload
            // row has to be the row its own value came from.
            assert_eq!(
                item.row.get("alert_agg_value").and_then(|v| v.as_f64()),
                Some(item.actual_value),
                "an item's level, value and row must all describe one observation"
            );
        }
        assert!(plan.inconsistent.contains(&key_of("a")));
    }

    #[test]
    fn test_a_duplicated_group_consumes_no_budget_slot() {
        // A refused group is not a send, so it must not spend a slot of the
        // MN-8 budget and starve a group that could have paged.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0), ("a", 150.0), ("b", 120.0), ("c", 110.0)], 500);
        let states = states_for(&c, now, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 2);

        assert_eq!(plan.items.len(), 2, "`b` and `c` both page");
        assert!(plan.dropped_by_knob.is_empty());
    }

    #[test]
    fn test_items_carry_their_groups_original_row() {
        // MN-3: the payload is the real row, with every column the query
        // returned. Row templates and alert-time calculation read these.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0)], 500);
        let states = states_for(&c, now, None, None);
        let rows = rows_for(&c);

        let plan = plan_dispatch(&c, &states, &rows, &tc(None), now, 0);

        assert_eq!(
            &plan.items[0].row,
            rows.get(&key_of("a")).unwrap(),
            "the item carries the original row verbatim, not a synthesis"
        );
        assert!(plan.items[0].row.contains_key("zo_sql_min_time"));
        assert!(plan.items[0].row.contains_key("zo_sql_max_time"));
    }

    #[test]
    fn test_item_episode_is_the_rows_level_episode() {
        // The callback's version must come from the state row (level,
        // level_since) — NOT level_at, which advances every evaluation and
        // would orphan any batch that waited through one (round 6).
        let now = 1_000 * SEC;
        let since = now - 7 * MIN;
        let c = classified(&[("a", 150.0)], 500);
        let key = key_of("a");
        let mut row = state(&key, AlertLevel::Critical, since, None, None);
        row.level_at = Some(now); // freshness advanced by a later same-level run
        let states = HashMap::from([(key.clone(), row)]);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 0);

        assert_eq!(
            plan.items[0].episode,
            DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: since,
                notified_at_enqueue: (None, None),
            }
        );
    }

    // ── MN-8: the volume knob ───────────────────────────────────────────────

    #[test]
    fn test_knob_zero_is_unlimited() {
        let c = classified(&[("a", 150.0), ("b", 150.0), ("c", 150.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);
        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), 1_000 * SEC, 0);
        assert_eq!(plan.items.len(), 3);
        assert!(plan.dropped_by_knob.is_empty());
    }

    #[test]
    fn test_knob_keeps_the_worst_and_reports_the_dropped() {
        // Worst-first + the knob = the most severe groups always page, and
        // the casualties are named so the caller can log them.
        let c = classified(&[("crit", 150.0), ("warn1", 75.0), ("warn2", 75.0)], 500);
        let states = states_for(&c, 1_000 * SEC, None, None);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), 1_000 * SEC, 2);

        assert_eq!(plan.items.len(), 2);
        assert_eq!(plan.items[0].group_key, key_of("crit"), "critical survives any cap");

        // Exact, not "either one". Accepting whichever group happened to be
        // dropped would let a non-deterministic implementation pass, and then
        // the SAME incident would page a different subset of hosts on every
        // evaluation — worse than a consistent cap, because on-call cannot
        // tell which hosts are actually silent.
        let (w1, w2) = (key_of("warn1"), key_of("warn2"));
        let (kept_warn, dropped_warn) =
            if w1 < w2 { (w1, w2) } else { (w2, w1) };
        assert_eq!(
            plan.items[1].group_key, kept_warn,
            "within a severity band the lower group_key is admitted first"
        );
        assert_eq!(plan.dropped_by_knob, vec![dropped_warn]);
    }

    #[test]
    fn test_the_knob_drops_the_same_groups_on_every_evaluation() {
        // The stability claim above, asserted directly: identical inputs must
        // produce an identical cap decision, or on-call sees the firing set
        // shuffle every cycle.
        let now = 1_000 * SEC;
        let build = || classified(&[("h1", 150.0), ("h2", 150.0), ("h3", 150.0)], 500);
        let c = build();
        let states = states_for(&c, now, None, None);

        let first = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 2);
        let second = plan_dispatch(&build(), &states, &rows_for(&c), &tc(None), now, 2);

        assert_eq!(first.items, second.items);
        assert_eq!(first.dropped_by_knob, second.dropped_by_knob);
    }

    #[test]
    fn test_knob_counts_qualifying_sends_not_candidates() {
        // A silenced group must not consume the budget: 2 firing groups, one
        // silenced, knob 1 — the unsilenced one still pages.
        let now = 1_000 * SEC;
        let c = classified(&[("a", 150.0), ("b", 150.0)], 500);
        let key_a = key_of("a");
        let key_b = key_of("b");
        let states = HashMap::from([
            (
                key_a.clone(),
                // Already delivered and mid-window: suppressed.
                state(
                    &key_a,
                    AlertLevel::Critical,
                    now,
                    Some(AlertLevel::Critical),
                    Some(now + 10 * MIN),
                ),
            ),
            (key_b.clone(), state(&key_b, AlertLevel::Critical, now, None, None)),
        ]);

        let plan = plan_dispatch(&c, &states, &rows_for(&c), &tc(None), now, 1);

        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.items[0].group_key, key_b);
        assert_eq!(plan.suppressed, 1);
        assert!(
            plan.dropped_by_knob.is_empty(),
            "the suppressed group must not count against the knob"
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // delivery_success_update — MN-6
    // ═════════════════════════════════════════════════════════════════════

    /// An episode with a never-delivered attempt anchor (the common case).
    fn episode(level: AlertLevel, since: i64) -> DeliveryEpisode {
        DeliveryEpisode {
            level,
            level_since: since,
            notified_at_enqueue: (None, None),
        }
    }

    /// An episode whose attempt was enqueued when delivery state already held
    /// the given values.
    fn episode_after(
        level: AlertLevel,
        since: i64,
        notified: Option<AlertLevel>,
        silenced: Option<i64>,
    ) -> DeliveryEpisode {
        DeliveryEpisode {
            level,
            level_since: since,
            notified_at_enqueue: (notified, silenced),
        }
    }

    #[test]
    fn test_success_sets_exactly_the_two_delivery_fields() {
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        let delivered_at = since + 30 * SEC;

        let updated = delivery_success_update(
            &row,
            episode(AlertLevel::Critical, since),
            10, // silence minutes
            delivered_at,
        )
        .expect("current episode applies");

        assert_eq!(updated.last_notified_level, Some(AlertLevel::Critical));
        assert_eq!(updated.silenced_until, Some(delivered_at + 10 * MIN));
        // Everything else byte-identical — delivery must not touch
        // observation state.
        let mut expected = row.clone();
        expected.last_notified_level = Some(AlertLevel::Critical);
        expected.silenced_until = Some(delivered_at + 10 * MIN);
        assert_eq!(updated, expected);
    }

    #[test]
    fn test_zero_silence_sets_no_window() {
        // silence = 0 → page every evaluation (the pre-Feature-1 cadence).
        // Writing Some(delivered_at) instead would still suppress the
        // evaluation that lands in the same microsecond.
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);

        let updated =
            delivery_success_update(&row, episode(AlertLevel::Critical, since), 0, since + SEC)
                .expect("applies");
        assert_eq!(updated.silenced_until, None);
        assert_eq!(updated.last_notified_level, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_stale_episode_by_level_since_is_dropped() {
        // The batch was enqueued in a previous episode (the group recovered
        // and re-fired while it waited). Its success must not be recorded
        // against the new episode.
        let row = state(&key_of("a"), AlertLevel::Critical, 2_000 * SEC, None, None);
        assert_eq!(
            delivery_success_update(
                &row,
                episode(AlertLevel::Critical, 1_000 * SEC), // older episode
                10,
                2_100 * SEC,
            ),
            None
        );
    }

    #[test]
    fn test_stale_episode_by_level_is_dropped() {
        let row = state(&key_of("a"), AlertLevel::Critical, 1_000 * SEC, None, None);
        assert_eq!(
            delivery_success_update(
                &row,
                episode(AlertLevel::Warning, 1_000 * SEC), // group has since escalated
                10,
                1_100 * SEC,
            ),
            None
        );
    }

    #[test]
    fn test_level_at_advancing_does_not_stale_a_delivery() {
        // THE round-6 regression test. The batch waited through one
        // evaluation cycle; the group stayed Critical, so only the freshness
        // clock moved. The callback must still apply — versioning on
        // level_at would skip it, leave delivery unconfirmed, and re-page
        // the group every window.
        let since = 1_000 * SEC;
        let mut row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        row.level_at = Some(since + 5 * MIN); // a later same-level evaluation

        let updated =
            delivery_success_update(&row, episode(AlertLevel::Critical, since), 10, since + 6 * MIN);
        assert!(
            updated.is_some(),
            "a same-level evaluation must not orphan an in-flight delivery"
        );
    }

    #[test]
    fn test_a_success_does_not_clear_a_previous_notify_failed_outcome() {
        // Reachable ordering: attempt #1 fails and writes `NotifyFailed`, then
        // attempt #2 in the same episode succeeds. The row is now
        // simultaneously "delivered" and "NotifyFailed".
        //
        // That is deliberate, and this test exists so it stays deliberate.
        // Delivery owns two columns; the outcome axis belongs to evaluation,
        // which overwrites it on the very next run. Letting a delivery
        // callback clear it instead would have the callback writing
        // observation state — the one-writer rule (MN-2) breaking in the
        // opposite direction from the upsert bug, and just as invisible.
        //
        // The cost is a transient `NotifyFailed` on a group that did deliver;
        // the alternative is a delivery callback racing evaluation over the
        // outcome column. If this ever becomes user-visible enough to matter,
        // the fix is for evaluation to reconcile it, not for delivery to.
        let since = 1_000 * SEC;
        let mut row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        row.last_outcome = Some(RunOutcome::NotifyFailed);
        row.last_outcome_at = Some(since + MIN);

        let updated = delivery_success_update(
            &row,
            episode(AlertLevel::Critical, since),
            10,
            since + 2 * MIN,
        )
        .expect("the episode matches, so the delivery is recorded");

        assert_eq!(
            updated.last_notified_level,
            Some(AlertLevel::Critical),
            "the delivery IS recorded"
        );
        assert_eq!(
            updated.last_outcome,
            Some(RunOutcome::NotifyFailed),
            "but the outcome axis is evaluation's to write, not delivery's"
        );
        assert_eq!(updated.last_outcome_at, Some(since + MIN));
    }

    #[test]
    fn test_success_ignores_the_attempt_anchor_by_design() {
        // The asymmetry, stated directly so an implementer cannot "tidy it up"
        // by making both guards identical. This anchor is stale — a sibling
        // attempt has already delivered — yet the write must still apply,
        // because a delivery that happened is a fact, and recording it can
        // only make suppression more accurate.
        //
        // Its mirror image is
        // `test_an_older_failure_cannot_overwrite_a_newer_success_in_the_same_episode`,
        // where the identical anchor mismatch MUST cause a drop.
        let since = 1_000 * SEC;
        let row = state(
            &key_of("a"),
            AlertLevel::Critical,
            since,
            Some(AlertLevel::Critical),
            Some(since + 10 * MIN),
        );

        assert!(
            delivery_success_update(
                &row,
                episode_after(AlertLevel::Critical, since, None, None),
                10,
                since + MIN,
            )
            .is_some(),
            "a success must not be refused merely because a sibling attempt landed first"
        );
    }

    #[test]
    fn test_no_monotonicity_a_new_warning_episode_resets_the_baseline() {
        // Round 6: after Critical delivered and the group recovered, a NEW
        // incident fires Warning. Its delivery must set the Warning baseline
        // — keeping the old Critical would suppress the next Warning→Critical
        // escalation inside the silence window as "not above Critical".
        let new_since = 5_000 * SEC;
        let row = state(
            &key_of("a"),
            AlertLevel::Warning,
            new_since,
            Some(AlertLevel::Critical), // stale baseline from the old incident
            None,
        );

        let updated = delivery_success_update(
            &row,
            episode(AlertLevel::Warning, new_since),
            10,
            new_since + SEC,
        )
        .expect("current episode applies");

        assert_eq!(
            updated.last_notified_level,
            Some(AlertLevel::Warning),
            "the delivered level IS the new baseline; severity never rewinds it"
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // delivery_failure_update — MN-7
    // ═════════════════════════════════════════════════════════════════════

    /// The state row a failure update produced, for the common assertions.
    fn failed_state(
        current: &AlertState,
        episode: DeliveryEpisode,
        at: i64,
    ) -> super::super::state::StateUpdate {
        delivery_failure_update(current, episode, at).expect("the attempt is current")
    }

    #[test]
    fn test_failure_marks_the_group_notify_failed_and_still_firing() {
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        let failed_at = since + 30 * SEC;

        let update = failed_state(&row, episode(AlertLevel::Critical, since), failed_at);
        let st = update.state.as_ref().expect("a failure writes state");

        assert_eq!(st.last_outcome, Some(RunOutcome::NotifyFailed));
        assert_eq!(st.last_outcome_at, Some(failed_at));
        assert!(
            st.is_firing(),
            "a delivery failure is still a firing state — the incident is not over"
        );
    }

    #[test]
    fn test_first_failure_moves_since_and_writes_a_transition() {
        // The outcome axis has invariants the evaluation path already
        // enforces, and a delivery callback writing that axis must honour
        // them: `since` is when the outcome last CHANGED, and an outcome
        // change is a transition. Leaving `since` at the Firing start would
        // make "notify-failed for 20 minutes" render as the firing duration,
        // and omitting the transition would break the per-group history MN-9
        // says lives in `alert_state_transitions`.
        let since = 1_000 * SEC;
        let failed_at = since + 30 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        assert_eq!(row.last_outcome, Some(RunOutcome::Firing), "fixture: firing");

        let update = failed_state(&row, episode(AlertLevel::Critical, since), failed_at);
        let st = update.state.as_ref().unwrap();
        assert_eq!(
            st.since,
            Some(failed_at),
            "the outcome changed, so `since` must move with it"
        );

        let t = update
            .transition
            .as_ref()
            .expect("Firing -> NotifyFailed is an outcome change, so a transition");
        assert_eq!(t.from_outcome, Some(RunOutcome::Firing));
        assert_eq!(t.to_outcome, RunOutcome::NotifyFailed);
        assert_eq!(t.at, failed_at);
        assert_eq!(t.group_key, key_of("a"));
        assert_eq!(
            t.from_level, t.to_level,
            "delivery does not touch the level axis, so neither does its transition"
        );
    }

    #[test]
    fn test_a_repeated_failure_preserves_since_and_writes_no_transition() {
        // Two evaluations in a row whose delivery fails. The outcome did not
        // change the second time, so the row must stay transition-bounded —
        // otherwise every failing cycle appends a duplicate history entry and
        // `since` walks forward, hiding how long delivery has been broken.
        let since = 1_000 * SEC;
        let first_failure = since + 30 * SEC;
        let mut row = state(&key_of("a"), AlertLevel::Critical, since, None, None);
        row.last_outcome = Some(RunOutcome::NotifyFailed);
        row.last_outcome_at = Some(first_failure);
        row.since = Some(first_failure);

        let update = failed_state(
            &row,
            episode(AlertLevel::Critical, since),
            first_failure + 60 * SEC,
        );
        let st = update.state.as_ref().unwrap();

        assert_eq!(
            st.since,
            Some(first_failure),
            "`since` marks when delivery STARTED failing, not the latest attempt"
        );
        assert_eq!(
            st.last_outcome_at,
            Some(first_failure + 60 * SEC),
            "freshness still advances"
        );
        assert!(
            update.transition.is_none(),
            "an unchanged outcome must not append a duplicate history entry"
        );
    }

    #[test]
    fn test_failure_advances_no_delivery_state() {
        // The whole point of MN-6: nothing advances, so the group
        // re-qualifies at its next evaluation with no retry machinery.
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);

        let update = failed_state(&row, episode(AlertLevel::Critical, since), since + SEC);
        let st = update.state.as_ref().unwrap();

        assert_eq!(st.last_notified_level, None);
        assert_eq!(st.silenced_until, None);
    }

    #[test]
    fn test_failure_does_not_touch_the_disappearance_clock() {
        // A delivery failure is not an observation. Advancing `last_seen`
        // here would postpone M-7 for a group that may genuinely be gone.
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);

        let update = failed_state(&row, episode(AlertLevel::Critical, since), since + MIN);
        let st = update.state.as_ref().unwrap();

        assert_eq!(st.last_seen, row.last_seen);
        assert_eq!(st.level, row.level, "the level axis is not delivery's to touch");
        assert_eq!(st.level_since, row.level_since);
        assert_eq!(st.level_at, row.level_at);
    }

    #[test]
    fn test_an_older_failure_cannot_overwrite_a_newer_success_in_the_same_episode() {
        // Episode ≠ attempt. While a group keeps qualifying (nothing has
        // advanced yet), successive evaluations can enqueue several deliveries
        // inside ONE level-episode. If attempt #1 fails after attempt #2
        // succeeds, a level-only guard would pass and write NotifyFailed over
        // a group that was just delivered — re-paging it next cycle.
        //
        // The anchor carried at enqueue is what distinguishes them: a
        // successful delivery is precisely what changes those fields.
        let since = 1_000 * SEC;
        let delivered_at = since + 30 * SEC;

        // Attempt #1 enqueued when nothing had been delivered.
        let attempt_one = episode_after(AlertLevel::Critical, since, None, None);
        // Attempt #2 has since succeeded, so the row now shows delivery state.
        let after_success = state(
            &key_of("a"),
            AlertLevel::Critical,
            since,
            Some(AlertLevel::Critical),
            Some(delivered_at + 10 * MIN),
        );

        assert!(
            delivery_failure_update(&after_success, attempt_one, delivered_at + MIN).is_none(),
            "the older attempt's failure must not overwrite the newer success"
        );
    }

    #[test]
    fn test_a_failure_still_applies_when_no_attempt_has_succeeded() {
        // The complement: with delivery state unchanged since enqueue, this IS
        // the outstanding attempt and its failure must be recorded — otherwise
        // the anchor check would swallow every genuine failure.
        let since = 1_000 * SEC;
        let row = state(&key_of("a"), AlertLevel::Critical, since, None, None);

        assert!(
            delivery_failure_update(
                &row,
                episode_after(AlertLevel::Critical, since, None, None),
                since + MIN,
            )
            .is_some()
        );
    }

    #[test]
    fn test_a_success_callback_is_idempotent_against_its_own_write() {
        // Two attempts in one episode both succeed (a duplicate send, or a
        // worker retry). The second must not be treated as stale just because
        // the first advanced the state — it delivered, so recording it is
        // correct and simply refreshes the window.
        let since = 1_000 * SEC;
        let first_at = since + 30 * SEC;
        let row = state(
            &key_of("a"),
            AlertLevel::Critical,
            since,
            Some(AlertLevel::Critical),
            Some(first_at + 10 * MIN),
        );

        let updated = delivery_success_update(
            &row,
            episode_after(
                AlertLevel::Critical,
                since,
                Some(AlertLevel::Critical),
                Some(first_at + 10 * MIN),
            ),
            10,
            first_at + MIN,
        )
        .expect("a delivery that happened is always worth recording");
        assert_eq!(updated.silenced_until, Some(first_at + MIN + 10 * MIN));
    }

    #[test]
    fn test_stale_failure_cannot_resurrect_a_recovered_group() {
        // THE round-5 race: a queued Warning delivery fails AFTER the
        // group's recovery committed. Writing NotifyFailed now would flip a
        // healthy row back to firing.
        let recovered = state(
            &key_of("a"),
            AlertLevel::Ok,
            5_000 * SEC, // the recovery started a new episode
            Some(AlertLevel::Warning),
            None,
        );

        assert!(
            delivery_failure_update(
                &recovered,
                episode(AlertLevel::Warning, 1_000 * SEC), // the old episode
                5_100 * SEC,
            )
            .is_none(),
            "a stale callback must be dropped, not applied to the new episode"
        );
        assert!(!recovered.is_firing(), "and the row stays healthy");
    }

    // ═════════════════════════════════════════════════════════════════════
    // evaluates_through_silence — MN-10
    // ═════════════════════════════════════════════════════════════════════

    #[test]
    fn test_multi_alerts_always_evaluate_through_silence() {
        // Critical-only multi-alerts are the case that breaks otherwise:
        // host-a pages, the trigger pauses, and host-b goes unevaluated and
        // unpaged for the whole window.
        assert!(evaluates_through_silence(true, false));
        assert!(evaluates_through_silence(true, true));
    }

    #[test]
    fn test_non_multi_alerts_keep_the_warning_gated_rule() {
        // §7.1 unchanged for everything that did not opt in.
        assert!(evaluates_through_silence(false, true));
        assert!(!evaluates_through_silence(false, false));
    }

    // ═════════════════════════════════════════════════════════════════════
    // rows_by_group_key — MN-3
    // ═════════════════════════════════════════════════════════════════════

    #[test]
    fn test_rows_are_carried_verbatim_with_every_column() {
        // The payload row must keep zo_sql_min_time/max_time and anything
        // else the query returned — templates and alert-time math read them.
        let rows = vec![row(&[
            ("host", json!("a")),
            ("alert_agg_value", json!(150.0)),
            ("zo_sql_min_time", json!(1_000)),
            ("zo_sql_max_time", json!(2_000)),
        ])];

        let map = rows_by_group_key(&rows, &["host".to_string()]);
        let got = map.get(&key_of("a")).expect("keyed by group identity");

        assert_eq!(got, &rows[0], "the row is the original, not a synthesis");
    }

    #[test]
    fn test_row_keys_match_the_observation_keys_for_non_string_labels() {
        // The evaluation renders non-string group values (numeric pod
        // ordinals, bools) via to_string. The row map must render them the
        // SAME way, or the dispatch item can never find its row.
        let rows = vec![row(&[("replica", json!(3)), ("alert_agg_value", json!(150.0))])];

        let map = rows_by_group_key(&rows, &["replica".to_string()]);

        let expected_key = group_key(&labels(&[("replica", "3")]));
        assert!(
            map.contains_key(&expected_key),
            "numeric labels must render identically to GroupObservation building"
        );
        assert_eq!(
            row_group_labels(&rows[0], &["replica".to_string()]),
            labels(&[("replica", "3")])
        );
    }

    #[test]
    fn test_first_row_wins_on_duplicate_group_keys() {
        let rows = vec![
            row(&[("host", json!("a")), ("alert_agg_value", json!(150.0))]),
            row(&[("host", json!("a")), ("alert_agg_value", json!(999.0))]),
        ];
        let map = rows_by_group_key(&rows, &["host".to_string()]);
        assert_eq!(
            map.get(&key_of("a")).unwrap().get("alert_agg_value"),
            Some(&json!(150.0)),
            "deterministic: the first row for a key is kept"
        );
    }

    #[test]
    fn test_rows_missing_a_group_column_still_key_consistently() {
        // The evaluation's observation builder skips absent columns rather
        // than dropping the row; the row map must key the same way, or those
        // groups dispatch with no payload.
        let rows = vec![row(&[("alert_agg_value", json!(150.0))])];
        let map = rows_by_group_key(&rows, &["host".to_string()]);
        let expected_key = group_key(&BTreeMap::new());
        assert!(map.contains_key(&expected_key));
    }

    // ═════════════════════════════════════════════════════════════════════
    // DeliveryEpisode::of
    // ═════════════════════════════════════════════════════════════════════

    #[test]
    fn test_episode_of_reads_level_and_level_since() {
        let row = state(&key_of("a"), AlertLevel::Warning, 1_234 * SEC, None, None);
        assert_eq!(
            DeliveryEpisode::of(&row),
            Some(DeliveryEpisode {
                level: AlertLevel::Warning,
                level_since: 1_234 * SEC,
                notified_at_enqueue: (None, None),
            })
        );
    }

    #[test]
    fn test_episode_of_snapshots_the_delivery_state_as_the_attempt_anchor() {
        // The anchor half of `of()`. Without it every attempt in an episode
        // would carry `(None, None)` and the failure guard could never tell
        // them apart — the round-7 race would be back.
        let row = state(
            &key_of("a"),
            AlertLevel::Critical,
            1_000 * SEC,
            Some(AlertLevel::Warning),
            Some(9_999),
        );
        assert_eq!(
            DeliveryEpisode::of(&row),
            Some(DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: 1_000 * SEC,
                notified_at_enqueue: (Some(AlertLevel::Warning), Some(9_999)),
            })
        );
    }

    #[test]
    fn test_a_success_never_shortens_a_live_silence_window() {
        // Two successes in one episode: the one computing the EARLIER window
        // commits second. The active window must survive, or the group pages
        // early — a duplicate at exactly the moment on-call is already busy.
        let since = 1_000 * SEC;
        let row = state(
            &key_of("a"),
            AlertLevel::Critical,
            since,
            Some(AlertLevel::Critical),
            Some(since + 30 * MIN),
        );

        let updated =
            delivery_success_update(&row, episode(AlertLevel::Critical, since), 1, since + MIN)
                .expect("a delivery that happened is still recorded");

        assert_eq!(
            updated.silenced_until,
            Some(since + 30 * MIN),
            "the later window wins regardless of commit order"
        );
        assert_eq!(updated.last_notified_level, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_a_zero_silence_success_does_not_wipe_a_live_window() {
        // `silence = 0` writes NULL, which is the EARLIEST window rather than
        // the newest. Arriving late it must not clear one a sibling set.
        let since = 1_000 * SEC;
        let row = state(
            &key_of("a"),
            AlertLevel::Critical,
            since,
            Some(AlertLevel::Critical),
            Some(since + 30 * MIN),
        );

        let updated =
            delivery_success_update(&row, episode(AlertLevel::Critical, since), 0, since + MIN)
                .expect("still recorded");
        assert_eq!(updated.silenced_until, Some(since + 30 * MIN));
    }

    #[test]
    fn test_a_row_without_a_level_episode_yields_no_episode() {
        // `level` set but `level_since` missing (a legacy or corrupt row):
        // defaulting to 0 would mint an episode the guarded UPDATE can never
        // match, so every delivery for that group would go unrecorded and it
        // would re-page forever.
        let mut row = state(&key_of("a"), AlertLevel::Critical, 1_000 * SEC, None, None);
        row.level_since = None;
        assert_eq!(DeliveryEpisode::of(&row), None);
    }

    #[test]
    fn test_episode_of_an_unclassified_row_is_none() {
        // No level = no episode = nothing to version a delivery against.
        let mut row = state(&key_of("a"), AlertLevel::Ok, 1_000 * SEC, None, None);
        row.level = None;
        assert_eq!(DeliveryEpisode::of(&row), None);
    }
}

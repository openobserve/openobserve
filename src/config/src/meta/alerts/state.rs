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

//! Durable per-alert run state — Part IV of `alerts.md`.
//!
//! This module holds the *pure* decision logic that governs the `alert_states`
//! and `alert_state_transitions` tables. The tables themselves live in
//! `infra::table::alert_states`; everything that decides **whether** and **what**
//! to write lives here so it is unit-testable without a database.

use serde::{Deserialize, Serialize};

use super::{FrequencyType, TriggerCondition};
use crate::meta::{alerts::level::AlertLevel, self_reporting::usage::RunOutcome};

/// `group_key` of the per-alert rollup row. Grouped monitors additionally get
/// one row per label set; the rollup row is what list views read.
pub const ROLLUP_GROUP_KEY: &str = "";

/// Current run state for one `(alert_id, group_key)` pair.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AlertState {
    pub alert_id: String,
    pub group_key: String,
    /// `None` = never evaluated. Distinct from any real outcome.
    pub last_outcome: Option<RunOutcome>,
    pub last_outcome_at: Option<i64>,
    /// When `last_outcome` last *changed*. Stable across repeated same-outcome runs.
    pub since: Option<i64>,
    // ── Level axis (alerts_2.md §7.2) ───────────────────────────────────────
    // Independent of the outcome axis above: `firing -> notify_failed` moves
    // `since` while the level (and `level_since`) stay put.
    /// Severity of the last successful classification. `None` = no level
    /// (single-level legacy alert, or never classified).
    pub level: Option<AlertLevel>,
    /// When `level` last *changed* — powers "critical for 20 minutes".
    pub level_since: Option<i64>,
    /// When `level` was last *computed* from a successful evaluation.
    /// Freshness, not change-time: composite staleness (§6.4) runs on this, so
    /// an alert erroring every minute cannot look fresh while its level rots.
    pub level_at: Option<i64>,
    /// Last evaluation that actually *included* this group (M-7).
    ///
    /// A separate clock from `last_outcome_at` on purpose. Resolving a vanished
    /// group records a real outcome at the resolution time, so `last_outcome_at`
    /// must advance — but the group was not seen then, so `last_seen` must not.
    /// Overloading one field for both would either make the recovery row claim
    /// a timestamp at which the group was still firing, or reset the
    /// disappearance clock so the row could never be reaped.
    pub last_seen: Option<i64>,
    /// Rendered labels for UI and templates (M-4). `None` on the rollup row.
    pub group_labels: Option<String>,
    /// **Rollup row only**: the true number of groups the last evaluation
    /// observed, before the M-6 cap truncated them. `None` on group rows.
    ///
    /// Persisted rather than recomputed because the cap-overflow warning has to
    /// render from the stored row on list and detail views, long after the
    /// evaluation that produced it. The retained row count cannot substitute —
    /// it is post-cap, so an overflowing alert would report "500 of 500" and be
    /// indistinguishable from one that never overflowed.
    pub groups_observed: Option<usize>,
    /// **Rollup row only**: how many of `groups_observed` were firing
    /// (warning-or-worse), before the M-6 cap. `None` on group rows.
    ///
    /// Counted pre-cap for the same reason as `groups_observed`, and stored
    /// separately from it because the "N of M groups firing" chip cannot be
    /// derived from the retained rows: past the cap those are truncated, so
    /// counting them under-reports exactly when the number matters most.
    pub groups_firing: Option<usize>,
    /// Whether `groups_observed` is a `≥` lower bound rather than exact — the
    /// bounded fetch page came back full, so more groups may exist below it
    /// (§5.3). `None` = written before this was tracked.
    ///
    /// Persisted rather than recomputed: exactness cannot be recovered later
    /// from the count and a cap that is mutable config.
    pub groups_observed_is_lower_bound: Option<bool>,
    /// Whether `groups_firing` is a `≥` lower bound.
    ///
    /// Tracked separately from `groups_observed_is_lower_bound` because the two
    /// genuinely diverge: a full page that reached healthy groups has seen
    /// *every* firing group (the fetch is severity-ordered), so the firing
    /// count is exact while the observed count is not.
    pub groups_firing_is_lower_bound: Option<bool>,
    // ── Per-group delivery state (alerts_2.md §5.5 MN-2) ────────────────────
    // §7.1's `delivery_decision` fed per group. Deliberately NOT named
    // `delivery_silenced_until`: that is the ScheduledTriggerData field
    // non-multi alerts keep using — the state row is the per-group home.
    //
    // Written ONLY by the delivery callbacks (`dispatch::delivery_success_update`),
    // never by evaluation: `apply_outcome` carries both forward untouched. That
    // one-writer rule is what makes MN-6 hold — a failed send leaves them
    // unadvanced, so the group re-qualifies on the next evaluation.
    /// Per-group silence window: suppress same-level re-delivery until this
    /// instant (micros). `None` = not silenced.
    pub silenced_until: Option<i64>,
    /// The level of this group's last *successful* delivery — what
    /// `delivery_decision` measures escalation against.
    pub last_notified_level: Option<AlertLevel>,
}

impl AlertState {
    /// A row that has never been evaluated.
    pub fn empty(alert_id: &str, group_key: &str) -> Self {
        Self {
            alert_id: alert_id.to_string(),
            group_key: group_key.to_string(),
            last_outcome: None,
            last_outcome_at: None,
            since: None,
            level: None,
            level_since: None,
            level_at: None,
            last_seen: None,
            group_labels: None,
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until: None,
            last_notified_level: None,
        }
    }

    /// True when the last recorded outcome was a firing one. `None` (never
    /// evaluated) is not firing.
    pub fn is_firing(&self) -> bool {
        self.last_outcome.as_ref().is_some_and(|o| o.is_firing())
    }
}

/// An append-only state change, written to `alert_state_transitions`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateTransition {
    pub alert_id: String,
    pub group_key: String,
    /// `None` on the first evaluation of an alert.
    pub from_outcome: Option<RunOutcome>,
    pub to_outcome: RunOutcome,
    /// Level before/after. `None` when the alert has no level axis, or when
    /// this transition was driven purely by an outcome change.
    pub from_level: Option<AlertLevel>,
    pub to_level: Option<AlertLevel>,
    pub at: i64,
    /// Observed value at transition time — the source for per-group history
    /// (M-8, §7.2). `None` where no value was observed, which includes the
    /// disappearance transition: a group that stopped being returned has no
    /// value, and recording 0 would render as a real measurement.
    pub value: Option<f64>,
    /// Rendered labels, duplicated from the state row on purpose: the state row
    /// is reaped after the grace period (M-7) while transitions are retained,
    /// and `group_key` is a hash. Without this, history outlives the only thing
    /// that could say which host it was about.
    pub group_labels: Option<String>,
}

/// What `apply_outcome` decided to do about an observed evaluation result.
///
/// Serializable because it is also the payload of the super-cluster state-sync
/// message: the job cluster publishes the decision it just persisted, and every
/// other region applies the same one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateUpdate {
    /// The row to persist. `None` means "write nothing" — the observation is
    /// not allowed to overwrite existing state.
    pub state: Option<AlertState>,
    /// Emitted only when the outcome actually changed.
    pub transition: Option<StateTransition>,
}

impl StateUpdate {
    /// A decision to persist nothing at all.
    pub fn noop() -> Self {
        Self {
            state: None,
            transition: None,
        }
    }

    pub fn is_noop(&self) -> bool {
        self.state.is_none() && self.transition.is_none()
    }
}

/// Whether an observed outcome is allowed to overwrite stored state.
///
/// `Skipped` means the alert was never evaluated (silenced, paused, org
/// deleting). Letting it overwrite would erase a real firing state, so skipped
/// runs are dropped entirely.
pub fn should_persist(outcome: &RunOutcome) -> bool {
    !matches!(outcome, RunOutcome::Skipped)
}

/// Slack added to `max_gap` for scheduler lateness the alert's own
/// `tolerance_in_secs` does not describe — queue wait, evaluation duration, a
/// node restart mid-cycle.
///
/// Deliberately well **under** the smallest practical cadence. `max_gap` must
/// stay below `2 x frequency_secs` (S-16 §3.3) or a fully *missed* evaluation
/// would be merged into the running interval and its period claimed as measured
/// at the last-known level — fabricated coverage, which is exactly what D34
/// forbids. Erring small costs at most one extra row per late run.
pub const SCHEDULER_JITTER_ALLOWANCE_SECS: i64 = 30;

/// One measured evaluation's contribution to the availability ledger (S-16).
///
/// Rides the state-persist call and its super-cluster message rather than
/// travelling on its own: the ledger row is written inside the state
/// transaction, so the two must not be able to disagree about whether an
/// evaluation happened.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvalLedgerWrite {
    pub org: String,
    pub alert_id: String,
    /// The level this evaluation computed. Only `Ok` is uptime; `Warning` and
    /// `Critical` are downtime and `NoData` is a gap (§5.2) — but that is the
    /// *reader's* rule, so every computed level is recorded here.
    pub level: AlertLevel,
    /// `trigger_condition.frequency` as it stands for this evaluation, stamped
    /// onto the row so a later cadence edit cannot rewrite historical coverage
    /// (§5.3).
    pub frequency_secs: i64,
    /// `trigger_condition.tolerance_in_secs` — the alert's own deliberate
    /// schedule jitter, which widens the gap the next run may legitimately
    /// arrive after.
    pub tolerance_secs: i64,
    /// Persist-time wall clock (`now_micros`), not the evaluated data window's
    /// end: the SLI measures whether the alert was doing its job (§5.3).
    pub at: i64,
}

impl EvalLedgerWrite {
    /// How late the next evaluation may be and still count as *this* run
    /// continuing, in seconds.
    ///
    /// `frequency_secs + tolerance_in_secs + jitter allowance` — "the next
    /// expected evaluation, merely late". Deliberately **not**
    /// `2 x frequency_secs`: that spans a whole missed evaluation, and since an
    /// interval already covers forward one period past `to_us` (§5.3), merging
    /// across the miss would claim the missed period as measured at the
    /// last-known level.
    ///
    /// The two halves of that sentence can conflict, and when they do the
    /// invariant wins over the formula. A run is legitimately late by at most
    /// `frequency + tolerance` (`get_next_trigger_time` schedules the next one
    /// at `now + frequency + rand(0, tolerance)`), while a *missed* run puts
    /// the next arrival at `2 x frequency` or later. Those two ranges only stay
    /// separable while `tolerance + jitter < frequency`; nothing validates
    /// `tolerance_in_secs` against `frequency`, so the total slack is capped
    /// here. Past the cap the interval closes — a gap, which is the safe
    /// direction, where merging would fabricate coverage.
    pub fn max_gap_secs(&self) -> i64 {
        let slack = self
            .tolerance_secs
            .max(0)
            .saturating_add(SCHEDULER_JITTER_ALLOWANCE_SECS)
            .min(self.frequency_secs.saturating_sub(1).max(0));
        self.frequency_secs.saturating_add(slack)
    }
}

/// Whether this evaluation is one the ledger records, and with what.
///
/// `None` means write nothing — the gap forms on its own, which is the safe
/// direction under D34. Four reasons to decline:
///
/// - the outcome is not a measurement (`coverage::evaluation_is_measured`);
/// - the alert maintains per-group state, so it cannot say *which* groups were measured (D65). That
///   is `group_by` non-empty **or** `multi_alert_enabled()`, not the column list alone: a PromQL
///   multi-alert has no `group_by` list at all, and a column-list-only test would let one save
///   cleanly as an SLI source and measure nothing forever (§2);
/// - no level was computed. A frozen SLO-alert evaluation completes without classifying (`level:
///   None`), and a row with no level would have to invent one;
/// - the alert has no single cadence to stamp. Both halves — cron and a non-positive `frequency` —
///   describe sources §5.1 refuses as SLI sources anyway, so this is the same "ineligible sources
///   are skipped at the write site" rule the grouping check applies. It also protects the
///   run-length encoding: with no meaningful cadence `max_gap` collapses to the jitter allowance,
///   so a cron alert running every five minutes would open a fresh interval on every single run and
///   turn O(state changes) into O(evaluations) fleet-wide.
pub fn ledger_write_for_evaluation(
    org: &str,
    alert_id: &str,
    outcome: &RunOutcome,
    level: Option<AlertLevel>,
    is_grouped: bool,
    trigger: &TriggerCondition,
    at: i64,
) -> Option<EvalLedgerWrite> {
    if is_grouped
        || trigger.frequency_type == FrequencyType::Cron
        || trigger.frequency <= 0
        || !crate::meta::slo::coverage::evaluation_is_measured(outcome)
    {
        return None;
    }
    Some(EvalLedgerWrite {
        org: org.to_string(),
        alert_id: alert_id.to_string(),
        level: level?,
        frequency_secs: trigger.frequency,
        tolerance_secs: trigger.tolerance_in_secs.unwrap_or(0),
        at,
    })
}

/// Fold an observed outcome into the previous state.
///
/// `alert_id` and `group_key` are always supplied by the caller — they must not
/// be recovered from `prev`, which is `None` on an alert's first ever
/// evaluation. Deriving them would write identity-less rows that can never be
/// joined back to their alert.
///
/// - `Skipped` observations are dropped (see [`should_persist`]).
/// - A changed outcome moves `since` and emits a transition.
/// - A repeated outcome refreshes `last_outcome_at` but leaves `since` alone and emits no
///   transition — this is what keeps writes transition-bounded.
pub fn apply_outcome(
    alert_id: &str,
    group_key: &str,
    prev: Option<&AlertState>,
    outcome: RunOutcome,
    level: Option<AlertLevel>,
    at: i64,
) -> StateUpdate {
    if !should_persist(&outcome) {
        return StateUpdate::noop();
    }

    debug_assert!(
        !alert_id.is_empty(),
        "apply_outcome requires a non-empty alert_id"
    );

    let alert_id = alert_id.to_string();
    let group_key = group_key.to_string();

    // ── Outcome axis ────────────────────────────────────────────────────────
    let previous_outcome = prev.and_then(|p| p.last_outcome.clone());
    let outcome_changed = previous_outcome.as_ref() != Some(&outcome);
    let since = if outcome_changed {
        Some(at)
    } else {
        prev.and_then(|p| p.since).or(Some(at))
    };

    // ── Level axis (independent of the above) ───────────────────────────────
    let previous_level = prev.and_then(|p| p.level);
    let (level, level_since, level_at, level_changed) = match level {
        // No level computed this run — e.g. a query error. Carry the whole
        // level axis forward untouched, including freshness: an evaluation
        // that observed nothing must not make the level look fresh.
        None => (
            previous_level,
            prev.and_then(|p| p.level_since),
            prev.and_then(|p| p.level_at),
            false,
        ),
        Some(new_level) => {
            let changed = previous_level != Some(new_level);
            let level_since = if changed {
                Some(at)
            } else {
                prev.and_then(|p| p.level_since).or(Some(at))
            };
            // Freshness always advances on a successful classification.
            (Some(new_level), level_since, Some(at), changed)
        }
    };

    let state = AlertState {
        alert_id: alert_id.clone(),
        group_key: group_key.clone(),
        last_outcome: Some(outcome.clone()),
        last_outcome_at: Some(at),
        since,
        level,
        level_since,
        level_at,
        // An observation, by definition, saw the group.
        last_seen: Some(at),
        group_labels: prev.and_then(|p| p.group_labels.clone()),
        // Set by the per-group planner on the rollup row only.
        groups_observed: prev.and_then(|p| p.groups_observed),
        groups_firing: prev.and_then(|p| p.groups_firing),
        groups_observed_is_lower_bound: prev.and_then(|p| p.groups_observed_is_lower_bound),
        groups_firing_is_lower_bound: prev.and_then(|p| p.groups_firing_is_lower_bound),
        // Delivery state is the callbacks' to write; evaluation only carries it.
        silenced_until: prev.and_then(|p| p.silenced_until),
        last_notified_level: prev.and_then(|p| p.last_notified_level),
    };

    // A change on EITHER axis is a transition — an escalation while still
    // `firing` must be recorded, as must a delivery failure at a steady level.
    let transition = (outcome_changed || level_changed).then_some(StateTransition {
        alert_id,
        group_key,
        from_outcome: previous_outcome,
        to_outcome: outcome,
        from_level: previous_level,
        to_level: level,
        at,
        // Filled by the per-group planner, which is the only caller that has
        // an observed value and a label set.
        value: None,
        group_labels: None,
    });

    StateUpdate {
        state: Some(state),
        transition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prev(outcome: RunOutcome, at: i64, since: i64) -> AlertState {
        AlertState {
            alert_id: "alert-1".to_string(),
            group_key: ROLLUP_GROUP_KEY.to_string(),
            last_outcome: Some(outcome),
            last_outcome_at: Some(at),
            since: Some(since),
            level: None,
            level_since: None,
            level_at: None,
            last_seen: Some(at),
            group_labels: None,
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until: None,
            last_notified_level: None,
        }
    }

    #[test]
    fn test_rollup_group_key_is_empty_string() {
        assert_eq!(ROLLUP_GROUP_KEY, "");
    }

    #[test]
    fn test_empty_state_is_never_evaluated() {
        let s = AlertState::empty("alert-1", ROLLUP_GROUP_KEY);
        assert_eq!(s.last_outcome, None);
        assert_eq!(s.last_outcome_at, None);
        assert_eq!(s.since, None);
        assert!(!s.is_firing());
    }

    #[test]
    fn test_is_firing_tracks_run_outcome() {
        assert!(prev(RunOutcome::Firing, 10, 10).is_firing());
        // notify_failed still fired — see RunOutcome::is_firing.
        assert!(prev(RunOutcome::NotifyFailed, 10, 10).is_firing());
        assert!(!prev(RunOutcome::Normal, 10, 10).is_firing());
        assert!(!prev(RunOutcome::Error, 10, 10).is_firing());
    }

    // ── should_persist ──────────────────────────────────────────────────────

    #[test]
    fn test_should_persist_rejects_only_skipped() {
        assert!(!should_persist(&RunOutcome::Skipped));

        assert!(should_persist(&RunOutcome::Firing));
        assert!(should_persist(&RunOutcome::Normal));
        assert!(should_persist(&RunOutcome::Succeeded));
        assert!(should_persist(&RunOutcome::Error));
        assert!(should_persist(&RunOutcome::NotifyFailed));
    }

    // ── apply_outcome ───────────────────────────────────────────────────────

    #[test]
    fn test_skipped_never_overwrites_existing_state() {
        let existing = prev(RunOutcome::Firing, 100, 100);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::Skipped,
            None,
            200,
        );

        assert!(
            update.is_noop(),
            "a silenced run must not erase a firing state"
        );
    }

    #[test]
    fn test_skipped_on_fresh_alert_writes_nothing() {
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            None,
            RunOutcome::Skipped,
            None,
            100,
        );
        assert!(update.is_noop());
    }

    #[test]
    fn test_first_evaluation_creates_state_and_transition() {
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            None,
            RunOutcome::Firing,
            None,
            100,
        );

        let state = update.state.expect("first evaluation must persist state");
        assert_eq!(state.last_outcome, Some(RunOutcome::Firing));
        assert_eq!(state.last_outcome_at, Some(100));
        assert_eq!(state.since, Some(100));
        assert_eq!(state.group_key, ROLLUP_GROUP_KEY);
        // Identity must come from the caller, not from `prev` (which is None
        // here). An empty alert_id would orphan the row permanently.
        assert_eq!(
            state.alert_id, "alert-1",
            "first-evaluation rows must carry their alert_id"
        );

        let t = update
            .transition
            .expect("first evaluation is a transition from nothing");
        assert_eq!(t.from_outcome, None);
        assert_eq!(t.to_outcome, RunOutcome::Firing);
        assert_eq!(t.at, 100);
        assert_eq!(t.alert_id, "alert-1");
    }

    #[test]
    fn test_repeated_same_outcome_emits_no_transition() {
        let existing = prev(RunOutcome::Normal, 100, 100);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::Normal,
            None,
            200,
        );

        let state = update.state.expect("state should still refresh");
        assert_eq!(
            state.last_outcome_at,
            Some(200),
            "last_outcome_at tracks the latest run"
        );
        assert_eq!(
            state.since,
            Some(100),
            "since must NOT move when the outcome is unchanged"
        );
        assert!(
            update.transition.is_none(),
            "unchanged outcome must not write a transition row"
        );
    }

    #[test]
    fn test_outcome_change_moves_since_and_emits_transition() {
        let existing = prev(RunOutcome::Normal, 100, 50);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::Firing,
            None,
            200,
        );

        let state = update.state.unwrap();
        assert_eq!(state.last_outcome, Some(RunOutcome::Firing));
        assert_eq!(state.since, Some(200), "since moves on a real change");

        let t = update.transition.expect("changed outcome must transition");
        assert_eq!(t.from_outcome, Some(RunOutcome::Normal));
        assert_eq!(t.to_outcome, RunOutcome::Firing);
        assert_eq!(t.at, 200);
    }

    #[test]
    fn test_recovery_transition_is_recorded() {
        let existing = prev(RunOutcome::Firing, 100, 100);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::Normal,
            None,
            300,
        );

        let t = update
            .transition
            .expect("firing -> normal is the recovery event");
        assert_eq!(t.from_outcome, Some(RunOutcome::Firing));
        assert_eq!(t.to_outcome, RunOutcome::Normal);
        assert!(!update.state.unwrap().is_firing());
    }

    /// `firing` -> `notify_failed` is a change in outcome even though both are
    /// firing states, so it transitions.
    #[test]
    fn test_firing_to_notify_failed_transitions() {
        let existing = prev(RunOutcome::Firing, 100, 100);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::NotifyFailed,
            None,
            200,
        );

        let state = update.state.unwrap();
        assert!(state.is_firing(), "notify_failed is still a firing state");
        assert_eq!(state.since, Some(200));
        assert!(update.transition.is_some());
    }

    #[test]
    fn test_state_preserves_identity_from_previous_row() {
        let existing = prev(RunOutcome::Normal, 100, 100);
        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&existing),
            RunOutcome::Firing,
            None,
            200,
        );

        let state = update.state.unwrap();
        assert_eq!(state.alert_id, "alert-1");
        assert_eq!(state.group_key, ROLLUP_GROUP_KEY);

        let t = update.transition.unwrap();
        assert_eq!(t.alert_id, "alert-1");
        assert_eq!(t.group_key, ROLLUP_GROUP_KEY);
    }

    #[test]
    fn test_evaluation_carries_delivery_state_forward_untouched() {
        // §5.5 MN-2/MN-6: delivery state has ONE writer — the delivery
        // callbacks. If `apply_outcome` reset these on every evaluation, each
        // run would erase the silence window and the alert would page every
        // cycle regardless of silence; if it defaulted them on a fresh clone,
        // same result.
        let mut previous = prev(RunOutcome::Firing, 100, 100);
        previous.silenced_until = Some(9_999);
        previous.last_notified_level = Some(AlertLevel::Critical);

        let update = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&previous),
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            200,
        );
        let state = update.state.expect("an observed run writes state");

        assert_eq!(state.silenced_until, Some(9_999));
        assert_eq!(state.last_notified_level, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_per_group_state_is_keyed_independently() {
        let pod_a = AlertState {
            alert_id: "alert-1".to_string(),
            group_key: "pod=a".to_string(),
            last_outcome: Some(RunOutcome::Firing),
            last_outcome_at: Some(100),
            since: Some(100),
            level: None,
            level_since: None,
            level_at: None,
            last_seen: Some(100),
            group_labels: None,
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until: None,
            last_notified_level: None,
        };
        let update = apply_outcome(
            "alert-1",
            "pod=a",
            Some(&pod_a),
            RunOutcome::Normal,
            None,
            200,
        );
        let state = update.state.unwrap();

        assert_eq!(
            state.group_key, "pod=a",
            "per-group rows must keep their own key"
        );
        assert_eq!(update.transition.unwrap().group_key, "pod=a");
    }

    // ── Super-cluster replication (PR 0) ────────────────────────────────────
    // A `StateUpdate` crosses the super-cluster queue as JSON. A field that
    // does not survive that trip is silently wrong on every other cluster —
    // the write succeeds there, it just describes a state that never existed.

    /// Every field distinct and non-default, so a dropped one changes the value.
    fn replicable_update() -> StateUpdate {
        StateUpdate {
            state: Some(AlertState {
                alert_id: "alert-1".to_string(),
                group_key: "host=web-1".to_string(),
                last_outcome: Some(RunOutcome::NotifyFailed),
                last_outcome_at: Some(1_750_000_000_000_001),
                since: Some(1_749_000_000_000_002),
                level: Some(AlertLevel::Critical),
                level_since: Some(1_749_000_000_000_003),
                level_at: Some(1_750_000_000_000_004),
                last_seen: Some(1_750_000_000_000_005),
                group_labels: Some("host=web-1,env=prod".to_string()),
                groups_observed: Some(901),
                groups_firing: Some(121),
                groups_observed_is_lower_bound: Some(true),
                groups_firing_is_lower_bound: Some(false),
                silenced_until: Some(1_750_000_600_000_006),
                last_notified_level: Some(AlertLevel::Warning),
            }),
            transition: Some(StateTransition {
                alert_id: "alert-1".to_string(),
                group_key: "host=web-1".to_string(),
                from_outcome: Some(RunOutcome::Normal),
                to_outcome: RunOutcome::Firing,
                from_level: Some(AlertLevel::Ok),
                to_level: Some(AlertLevel::Critical),
                at: 1_750_000_000_000_007,
                value: Some(42.5),
                group_labels: Some("host=web-1,env=prod".to_string()),
            }),
        }
    }

    #[test]
    fn a_state_update_survives_the_super_cluster_round_trip() {
        let update = replicable_update();
        let bytes = crate::utils::json::to_vec(&update).unwrap();
        let back: StateUpdate = crate::utils::json::from_slice(&bytes).unwrap();
        assert_eq!(back, update);
    }

    /// The common shape: a repeated outcome refreshes the row and emits no
    /// transition. `None` must stay `None` — a transition conjured out of the
    /// wire format would append a change that never happened.
    #[test]
    fn a_state_update_with_no_transition_round_trips_without_gaining_one() {
        let mut update = replicable_update();
        update.transition = None;
        let bytes = crate::utils::json::to_vec(&update).unwrap();
        let back: StateUpdate = crate::utils::json::from_slice(&bytes).unwrap();
        assert_eq!(back, update);
        assert!(back.transition.is_none());
    }

    /// Two distinct `None`s that a lossy encoding could collapse: a level axis
    /// that was never classified, and delivery state that was never advanced.
    /// Both read back as "unknown", and reading them as real values would
    /// resolve or re-page the group on the receiving cluster.
    #[test]
    fn absent_optional_fields_stay_absent_across_the_round_trip() {
        let update = StateUpdate {
            state: Some(AlertState::empty("alert-1", "host=web-1")),
            transition: None,
        };
        let bytes = crate::utils::json::to_vec(&update).unwrap();
        let back: StateUpdate = crate::utils::json::from_slice(&bytes).unwrap();
        assert_eq!(back, update);
        let state = back.state.unwrap();
        assert_eq!(state.level, None);
        assert_eq!(state.last_seen, None);
        assert_eq!(state.silenced_until, None);
        assert_eq!(state.last_notified_level, None);
    }

    // ── Availability ledger classification (S-16, PR 1) ─────────────────────
    // Which evaluations contribute a ledger row, and how wide a gap still
    // counts as the same run continuing. Pure, so both are pinned here rather
    // than against a database.

    /// A scheduled alert on a one-minute cadence — the shape the ledger is
    /// built for.
    fn trigger(frequency: i64) -> TriggerCondition {
        TriggerCondition {
            frequency,
            frequency_type: FrequencyType::Minutes,
            ..Default::default()
        }
    }

    /// The full argument list once, so each test below varies exactly the one
    /// thing it is about.
    fn ledger_write(
        outcome: &RunOutcome,
        level: Option<AlertLevel>,
        is_grouped: bool,
    ) -> Option<EvalLedgerWrite> {
        ledger_write_for_evaluation(
            "myorg",
            "alert-1",
            outcome,
            level,
            is_grouped,
            &trigger(60),
            1_750_000_000_000_000,
        )
    }

    #[test]
    fn every_measured_outcome_contributes_a_ledger_row() {
        for outcome in [
            RunOutcome::Firing,
            RunOutcome::Normal,
            RunOutcome::NotifyFailed,
        ] {
            assert!(
                ledger_write(&outcome, Some(AlertLevel::Ok), false).is_some(),
                "{outcome:?} computed a level, so it is a measurement"
            );
        }
    }

    /// The gap is the point: an evaluation that observed nothing must leave no
    /// trace, so unmeasured time is a hole rather than uptime at the last level.
    #[test]
    fn an_unmeasured_outcome_writes_nothing() {
        for outcome in [
            RunOutcome::Error,
            RunOutcome::Skipped,
            RunOutcome::Succeeded,
        ] {
            assert_eq!(
                ledger_write(&outcome, Some(AlertLevel::Ok), false),
                None,
                "{outcome:?} observed nothing and must not be recorded as coverage"
            );
        }
    }

    /// The classification must be exactly `coverage::evaluation_is_measured`,
    /// not a second list that can drift from it.
    #[test]
    fn the_measured_set_matches_the_coverage_rule() {
        for outcome in [
            RunOutcome::Firing,
            RunOutcome::Normal,
            RunOutcome::NotifyFailed,
            RunOutcome::Error,
            RunOutcome::Skipped,
            RunOutcome::Succeeded,
        ] {
            assert_eq!(
                ledger_write(&outcome, Some(AlertLevel::Ok), false).is_some(),
                crate::meta::slo::coverage::evaluation_is_measured(&outcome),
                "{outcome:?} disagrees with coverage::evaluation_is_measured"
            );
        }
    }

    /// D65: a grouped source cannot say *which* of its groups were measured, so
    /// it is ineligible as an SLI source and writes no ledger history at all.
    #[test]
    fn an_alert_that_maintains_per_group_state_is_skipped() {
        assert_eq!(
            ledger_write(&RunOutcome::Firing, Some(AlertLevel::Critical), true),
            None,
            "a grouped alert must never write a single-row ledger interval"
        );
    }

    /// A frozen SLO-alert evaluation completes without classifying: the outcome
    /// is measured but there is no level. Recording it would have to invent one.
    #[test]
    fn a_measured_evaluation_that_computed_no_level_writes_nothing() {
        assert_eq!(
            ledger_write(&RunOutcome::Normal, None, false),
            None,
            "a completed-but-unclassified evaluation has no level to record"
        );
    }

    /// Cadence is not a single number for a cron alert (§5.1.2 refuses such
    /// sources outright), and with none to stamp `max_gap` collapses to the
    /// jitter allowance — every run would open a fresh interval and the
    /// run-length encoding would degrade to one row per evaluation.
    #[test]
    fn a_cron_scheduled_alert_writes_nothing() {
        let mut cron = trigger(60);
        cron.frequency_type = FrequencyType::Cron;
        cron.cron = "*/5 * * * *".to_string();

        assert_eq!(
            ledger_write_for_evaluation(
                "myorg",
                "alert-1",
                &RunOutcome::Firing,
                Some(AlertLevel::Critical),
                false,
                &cron,
                1_750_000_000_000_000,
            ),
            None
        );
    }

    /// §5.1.1: a non-positive cadence makes the §5.3 forward extension
    /// zero-width, so such a row could never contribute coverage anyway.
    #[test]
    fn a_non_positive_cadence_writes_nothing() {
        for frequency in [0, -60] {
            assert_eq!(
                ledger_write_for_evaluation(
                    "myorg",
                    "alert-1",
                    &RunOutcome::Firing,
                    Some(AlertLevel::Critical),
                    false,
                    &trigger(frequency),
                    1_750_000_000_000_000,
                ),
                None,
                "a cadence of {frequency}s describes no schedule to measure against"
            );
        }
    }

    #[test]
    fn the_row_carries_the_cadence_and_instant_it_was_stamped_with() {
        let mut tc = trigger(300);
        tc.tolerance_in_secs = Some(45);
        let w = ledger_write_for_evaluation(
            "myorg",
            "alert-1",
            &RunOutcome::Firing,
            Some(AlertLevel::Warning),
            false,
            &tc,
            1_750_000_000_000_000,
        )
        .expect("a measured, ungrouped, classified evaluation is recorded");

        assert_eq!(w.org, "myorg");
        assert_eq!(w.alert_id, "alert-1");
        assert_eq!(w.level, AlertLevel::Warning);
        assert_eq!(w.frequency_secs, 300);
        assert_eq!(w.tolerance_secs, 45);
        assert_eq!(w.at, 1_750_000_000_000_000);
    }

    fn gap_for(frequency_secs: i64, tolerance_secs: i64) -> i64 {
        EvalLedgerWrite {
            org: "myorg".to_string(),
            alert_id: "alert-1".to_string(),
            level: AlertLevel::Ok,
            frequency_secs,
            tolerance_secs,
            at: 1_750_000_000_000_000,
        }
        .max_gap_secs()
    }

    #[test]
    fn max_gap_is_the_cadence_plus_the_alerts_tolerance_plus_the_jitter_allowance() {
        assert_eq!(gap_for(60, 0), 60 + SCHEDULER_JITTER_ALLOWANCE_SECS);
        assert_eq!(gap_for(300, 45), 300 + 45 + SCHEDULER_JITTER_ALLOWANCE_SECS);
    }

    /// The property §3.3 spells out, and the one invariant `max_gap` may never
    /// break: stay under two periods, or a fully missed evaluation is merged in
    /// and its period claimed as measured at the last-known level.
    ///
    /// Swept over cadences down to 1s and tolerances up to many periods,
    /// because both ends are reachable: nothing on the save path raises a small
    /// positive `frequency` carried over from the legacy meta store, and
    /// nothing validates `tolerance_in_secs` against `frequency` at all.
    #[test]
    fn max_gap_never_reaches_two_periods_at_any_cadence_or_tolerance() {
        for frequency in [1, 2, 5, 10, 29, 30, 31, 59, 60, 61, 120, 300, 900, 3600] {
            for tolerance in [0, 1, 29, 30, 31, 60, 120, 3600, i64::MAX] {
                let gap = gap_for(frequency, tolerance);
                assert!(
                    gap < 2 * frequency,
                    "cadence {frequency}s with tolerance {tolerance}s would merge across a \
                     missed evaluation: max_gap {gap} >= {}",
                    2 * frequency
                );
            }
        }
    }

    /// The cap only bites where the formula stops being able to tell a late run
    /// from a missed one. Everywhere else `max_gap` is exactly what §3.3 says.
    #[test]
    fn the_documented_formula_is_used_wherever_it_separates_late_from_missed() {
        for (frequency, tolerance) in [(60, 0), (300, 45), (900, 120), (3600, 600)] {
            assert_eq!(
                gap_for(frequency, tolerance),
                frequency + tolerance + SCHEDULER_JITTER_ALLOWANCE_SECS
            );
        }
    }

    /// The alert's own tolerance is *deliberate* schedule jitter, so it widens
    /// the window a next run may legitimately arrive in. A negative one is
    /// nonsense and must not shrink the window instead.
    #[test]
    fn a_negative_tolerance_cannot_shrink_the_gap() {
        assert_eq!(gap_for(60, -600), 60 + SCHEDULER_JITTER_ALLOWANCE_SECS);
    }

    /// It rides the state-sync message, so it has to survive the wire — and an
    /// absent ledger (the common case: every unmeasured or grouped evaluation)
    /// must stay absent rather than decoding as a row.
    #[test]
    fn a_ledger_write_survives_the_queue_round_trip() {
        let w = Some(EvalLedgerWrite {
            org: "myorg".to_string(),
            alert_id: "alert-1".to_string(),
            level: AlertLevel::Critical,
            frequency_secs: 60,
            tolerance_secs: 10,
            at: 1_750_000_000_000_000,
        });
        let bytes = crate::utils::json::to_vec(&w).unwrap();
        let back: Option<EvalLedgerWrite> = crate::utils::json::from_slice(&bytes).unwrap();
        assert_eq!(back, w);

        let none: Option<EvalLedgerWrite> = None;
        let bytes = crate::utils::json::to_vec(&none).unwrap();
        let back: Option<EvalLedgerWrite> = crate::utils::json::from_slice(&bytes).unwrap();
        assert_eq!(back, None);
    }
}

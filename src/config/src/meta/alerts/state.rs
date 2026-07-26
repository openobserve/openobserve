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
}

/// What `apply_outcome` decided to do about an observed evaluation result.
#[derive(Clone, Debug, PartialEq)]
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
    };

    // A change on EITHER axis is a transition — an escalation while still
    // `firing` must be recorded, as must a delivery failure at a steady level.
    let transition = (outcome_changed || level_changed).then(|| StateTransition {
        alert_id,
        group_key,
        from_outcome: previous_outcome,
        to_outcome: outcome,
        from_level: previous_level,
        to_level: level,
        at,
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
}

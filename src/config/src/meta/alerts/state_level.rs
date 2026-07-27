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

//! Level tracking on alert state — §7.2 of `alerts_2.md`.
//!
//! TDD: tests only. Extends the shipped `alerts::state` module (Part IV of
//! `alerts.md`) with the level axis. `apply_outcome` gains a level parameter
//! and `AlertState` gains `level` + `level_since`.

#[cfg(test)]
mod tests {
    use crate::meta::{
        alerts::{
            level::AlertLevel,
            state::{AlertState, ROLLUP_GROUP_KEY, apply_outcome},
        },
        self_reporting::usage::RunOutcome,
    };

    /// Existing state at a given outcome+level, with independent `since` values.
    fn existing(
        outcome: RunOutcome,
        outcome_since: i64,
        level: AlertLevel,
        level_since: i64,
    ) -> AlertState {
        AlertState {
            alert_id: "alert-1".to_string(),
            group_key: ROLLUP_GROUP_KEY.to_string(),
            last_outcome: Some(outcome),
            last_outcome_at: Some(outcome_since),
            since: Some(outcome_since),
            level: Some(level),
            level_since: Some(level_since),
            // Freshness: when the level was last COMPUTED (§7.6). Starts equal
            // to level_since; diverges as same-level runs refresh it.
            level_at: Some(level_since),
            last_seen: Some(outcome_since),
            group_labels: None,
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
        }
    }

    // ── The two axes must move independently ────────────────────────────────
    // This is the defect caught reviewing alerts_2.md: reusing one `since`
    // column for both outcome and level silently resets "critical for 20
    // minutes" whenever the OUTCOME changes but the level does not.

    #[test]
    fn test_outcome_change_at_same_level_does_not_move_level_since() {
        // firing -> notify_failed: the delivery broke, the severity did not.
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::NotifyFailed,
            Some(AlertLevel::Critical),
            500,
        );

        let s = u.state.expect("outcome change must persist");
        assert_eq!(
            s.since,
            Some(500),
            "outcome `since` moves on outcome change"
        );
        assert_eq!(
            s.level_since,
            Some(100),
            "level_since must NOT move — it has been Critical since 100"
        );
    }

    #[test]
    fn test_level_change_at_same_outcome_moves_only_level_since() {
        // Warning -> Critical while still `firing`: escalation.
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Warning, 200);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            600,
        );

        let s = u.state.expect("level change must persist");
        assert_eq!(
            s.since,
            Some(100),
            "outcome is unchanged (still firing), so its `since` holds"
        );
        assert_eq!(s.level_since, Some(600), "level_since moves on escalation");
        assert_eq!(s.level, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_first_evaluation_sets_both_since_values() {
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            None,
            RunOutcome::Firing,
            Some(AlertLevel::Warning),
            100,
        );
        let s = u.state.unwrap();
        assert_eq!(s.since, Some(100));
        assert_eq!(s.level_since, Some(100));
        assert_eq!(s.level_at, Some(100), "first computation sets freshness");
        assert_eq!(s.level, Some(AlertLevel::Warning));
        assert_eq!(s.alert_id, "alert-1", "identity comes from the caller");
    }

    // ── Transitions carry the level change ──────────────────────────────────

    #[test]
    fn test_escalation_emits_a_transition_with_both_levels() {
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Warning, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            300,
        );

        let t = u
            .transition
            .expect("a level change is a transition even when the outcome is unchanged");
        assert_eq!(t.from_level, Some(AlertLevel::Warning));
        assert_eq!(t.to_level, Some(AlertLevel::Critical));
        assert_eq!(t.at, 300);
    }

    #[test]
    fn test_recovery_to_ok_emits_a_transition() {
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Normal,
            Some(AlertLevel::Ok),
            900,
        );

        let t = u.transition.expect("recovery is a transition");
        assert_eq!(t.from_level, Some(AlertLevel::Critical));
        assert_eq!(t.to_level, Some(AlertLevel::Ok));
        assert_eq!(u.state.unwrap().level_since, Some(900));
    }

    #[test]
    fn test_repeated_same_level_and_outcome_emits_no_transition() {
        // The transition-bounded write property from Part IV must survive the
        // level axis: a steady Critical writes no new transition rows.
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            700,
        );

        assert!(
            u.transition.is_none(),
            "unchanged outcome AND level must not write a transition"
        );
        let s = u.state.expect("state still refreshes");
        assert_eq!(s.last_outcome_at, Some(700), "freshness advances");
        assert_eq!(s.since, Some(100));
        assert_eq!(s.level_since, Some(100));
    }

    // ── skipped still never overwrites (Part IV rule, now with a level) ─────

    #[test]
    fn test_skipped_does_not_erase_level() {
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Skipped,
            None,
            900,
        );
        assert!(
            u.is_noop(),
            "a silenced run must not erase a Critical level any more than it erases a firing outcome"
        );
    }

    // ── Level is optional: single-level alerts pre-Feature-1 ────────────────

    #[test]
    fn test_none_level_is_accepted_for_alerts_without_levels() {
        // Alerts written before Feature 1, or non-condition modules, have no
        // level. That must not be conflated with Ok.
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            None,
            RunOutcome::Firing,
            None,
            100,
        );
        let s = u.state.unwrap();
        assert_eq!(s.level, None, "no level is distinct from AlertLevel::Ok");
        assert_eq!(s.level_since, None);
    }

    // ── level_at: the freshness clock composites depend on (§7.6) ───────────

    #[test]
    fn test_error_outcome_preserves_level_and_does_not_refresh_level_at() {
        // A query error made no valid observation: the level axis must be
        // completely untouched — value, since, AND freshness. If level_at were
        // refreshed here, a child erroring every minute would look "fresh" to
        // composites while its level rots (the exact bug §6.4 guards against).
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Error,
            None, // the caller has no level to offer — the query failed
            900,
        );

        let s = u.state.expect("the outcome axis still records the error");
        assert_eq!(s.last_outcome, Some(RunOutcome::Error));
        assert_eq!(s.since, Some(900), "outcome changed firing -> error");
        assert_eq!(
            s.level,
            Some(AlertLevel::Critical),
            "error must not erase the last known level"
        );
        assert_eq!(s.level_since, Some(100));
        assert_eq!(
            s.level_at,
            Some(100),
            "freshness must NOT advance on an evaluation that computed nothing"
        );
    }

    #[test]
    fn test_successful_same_level_run_refreshes_level_at_only() {
        // Steady Critical: freshness advances, change-time does not.
        let prev = existing(RunOutcome::Firing, 100, AlertLevel::Critical, 100);
        let u = apply_outcome(
            "alert-1",
            ROLLUP_GROUP_KEY,
            Some(&prev),
            RunOutcome::Firing,
            Some(AlertLevel::Critical),
            700,
        );

        let s = u.state.unwrap();
        assert_eq!(s.level_at, Some(700), "recomputed this run -> fresh");
        assert_eq!(s.level_since, Some(100), "unchanged level -> since holds");
        assert!(u.transition.is_none());
    }

    #[test]
    fn test_is_firing_reads_outcome_not_level() {
        // `AlertState::is_firing` predates levels and must keep answering the
        // OUTCOME question, so existing callers do not silently change meaning.
        let s = existing(RunOutcome::Firing, 100, AlertLevel::Warning, 100);
        assert!(s.is_firing());

        let s = existing(RunOutcome::Normal, 100, AlertLevel::Ok, 100);
        assert!(!s.is_firing());
    }
}

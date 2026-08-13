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

//! Whether a completed run should notify, and with what.
//!
//! `alert_if_fails` and `cooldown_mins` are both validated on save, stored, and
//! delivered to the probe — and were read by nothing. Every completed run with
//! a destination notified, so `alert_if_fails: 3` alerted on the first failure
//! and a check failing every minute under `cooldown_mins: 30` sent thirty
//! notifications inside that window.
//!
//! Pure decision logic, separated from the ack path so it is testable without a
//! database: state in, state and an outcome out.

use infra::table::synthetics_checks::AlertState;

/// What a completed run is, before any suppression is applied.
///
/// The distinction that matters is between an OUTAGE and a DEGRADATION. An
/// outage accumulates — three failures in a row is worse than one — so it drives
/// the `alert_if_fails` streak. A degradation does not: a certificate two days
/// from expiry is not "more expired" on the twentieth check, and no number of
/// retries changes it. Counting degradation toward the streak would eventually
/// page a soon-to-expire certificate as an outage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunClass {
    /// `passed` — nothing wrong.
    Healthy,
    /// `failed` or `error`. Advances the streak.
    Failing,
    /// `warning` reached by retrying: it failed, then it passed.
    Flaky,
    /// `warning` from a checker: reachable but degrading — a certificate inside
    /// its warning window, an SFTP probe failing on a host that authenticated.
    Degraded,
    /// The check was never executed, and the reason is ours.
    ///
    /// Today this is the stale drop: a job that sat behind other jobs' retry
    /// chains until it passed its own `valid_until`, which the probe acks as
    /// `error` with "stale job dropped". That is our scheduling lag, not the
    /// customer's outage, and it must not page them.
    NotMeasured,
}

/// Classify a completed run.
///
/// `warning` is produced by exactly three places: the retry loop (any check
/// type), the TLS checker's expiry window, and the SSH checker's SFTP probe. The
/// retry loop needs more than one attempt by definition, and A6 breaks the loop
/// the moment a checker returns a degraded warning — so `attempts` separates the
/// two without needing `status_reason` on the ack wire:
///
/// - `warning` with `attempts > 1`  → it retried, so it recovered → **flaky**
/// - `warning` with `attempts <= 1` → no retry happened → **degraded**
///
/// `error` is `Failing`, not a class of its own. It means the probe could not
/// measure the target — dead agent, broken Lambda, revoked token, exhausted
/// journey budget. Treating "we could not look" as grounds for silence makes the
/// system quieter the more completely it is broken, and silence reads as health.
/// That is the one failure mode a monitoring product must not have; the
/// notification wording already distinguishes it.
///
/// Anything unrecognised is `Failing` for the same reason: leaning toward a
/// notification on an unknown status is recoverable, leaning toward silence is
/// not.
pub fn classify(
    run_status: Option<&str>,
    attempts: i32,
    error_source: &str,
    status_reason: Option<&str>,
) -> RunClass {
    // Our own fault, checked before anything else: a queue-dropped job never ran,
    // so it is evidence about our scheduling and nothing at all about the target.
    if error_source == ERROR_SOURCE_QUEUE {
        return RunClass::NotMeasured;
    }
    match run_status {
        Some("passed") => RunClass::Healthy,
        Some("warning") => match status_reason {
            // The probe said why. Believe it.
            Some(REASON_FLAKY) => RunClass::Flaky,
            Some(r) if !r.is_empty() => RunClass::Degraded,
            // Nothing said, so fall back to the old proxy: the retry loop breaks on
            // a degraded verdict, so more than one attempt implies it recovered by
            // retrying. Kept only for probes too old to send a reason — it is what
            // reported an expiring certificate as "passed only after retries", and
            // it will do so again for any probe that retries a degradation.
            _ if attempts > 1 => RunClass::Flaky,
            _ => RunClass::Degraded,
        },
        _ => RunClass::Failing,
    }
}

/// `status_reason` for a run that failed and then passed on a later attempt.
///
/// The only reason that means "already fixed itself"; every other reason is a
/// degradation the target will not recover from on its own.
pub const REASON_FLAKY: &str = "flaky";

/// `error_source` marking an `error` the control plane caused, not the target.
///
/// Set by the probe when the TTL guard drops a job that waited past its own
/// `valid_until`. Distinct from `dispatch` (the probe was never invoked),
/// `probe` (the probe ran and crashed) and [`ERROR_SOURCE_ORPHAN`] (no job was
/// ever created), because those first two are real signals about the check and
/// this one is a signal about us.
pub const ERROR_SOURCE_QUEUE: &str = "queue";

/// `error_source` for a check nothing scheduled at all.
///
/// The only value in the vocabulary that describes the *absence* of a job
/// rather than the fate of one: `dispatch`, `probe` and `queue` all presuppose
/// a job existed. Alert rules need it separable because the response differs —
/// the other three point at the probe fleet, this one points at the scheduler.
pub const ERROR_SOURCE_ORPHAN: &str = "orphan";

/// What a completed run should send, if anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertOutcome {
    /// Say nothing.
    Silent,
    /// The failure threshold was crossed and the cooldown has elapsed.
    Firing,
    /// The check passed after having alerted.
    ///
    /// Mandatory once a cooldown exists: with one, silence no longer means
    /// "recovered", it means "possibly still broken and inside the window". A
    /// recovery message is the only thing that closes an incident.
    Recovered,
    /// The run recovered by retrying. Informational — not an incident, so it
    /// neither advances the streak nor opens an alerting state.
    Flaky,
    /// The target is reachable but degrading. Sent on entry into the state and
    /// then at most once per reminder interval, because the condition persists
    /// for as long as the certificate takes to expire.
    Degraded,
}

/// One minute in microseconds — the unit `cooldown_mins` is expressed in.
const MICROS_PER_MINUTE: i64 = 60 * 1_000_000;

/// How often to re-state an unchanged degradation.
///
/// A certificate inside a 30-day warning window is `warning` on every run for
/// thirty days. Notifying per run is unusable, and notifying only on entry risks
/// one message lost in a busy channel weeks before the expiry — so it is
/// restated daily. A longer `cooldown_mins` wins, on the principle that an
/// explicit setting beats a built-in default.
const DEGRADED_REMINDER_US: i64 = 24 * 60 * MICROS_PER_MINUTE;

/// Decides the outcome for one completed run and returns the state to persist.
///
/// `alert_if_fails` is clamped to at least 1 — a threshold of 0 would fire before
/// anything had failed. Validation already enforces 1..=100; the clamp is for
/// rows written before it did.
pub fn decide(
    prior: AlertState,
    class: RunClass,
    alert_if_fails: i32,
    cooldown_mins: i32,
    now_us: i64,
) -> (AlertOutcome, AlertState) {
    let cooldown_us = i64::from(cooldown_mins.max(0)) * MICROS_PER_MINUTE;

    match class {
        // ── We never looked, and it is our fault ────────────────────────────
        //
        // State is left completely untouched: not advanced, and NOT reset. A
        // check that was already failing keeps its streak, so the next genuine
        // failure still fires — the page is delayed by one run, never lost.
        //
        // Resetting would be worse than advancing: a saturated location would
        // hold a check's streak at zero indefinitely and suppress a real outage
        // for as long as the queue stayed backed up.
        RunClass::NotMeasured => (AlertOutcome::Silent, prior),

        // ── A run that ultimately succeeded ─────────────────────────────────
        //
        // Flaky is grouped with healthy for STATE purposes: the check is up, so
        // the streak resets and any alerting state closes. Only the message
        // differs.
        RunClass::Healthy | RunClass::Flaky => {
            let next = AlertState {
                consecutive_failures: 0,
                // Deliberately NOT stamped on recovery: otherwise the next real
                // failure lands inside a cooldown it never earned and is
                // silenced.
                last_alert_at: prior.last_alert_at,
                alerting: false,
                // The target is up, so any degradation has cleared too.
                degraded_notified_at: 0,
            };

            // Closing an incident takes precedence over reporting flakiness. The
            // recovery is the message someone is waiting for, and the next flaky
            // run will report itself.
            if prior.alerting {
                return (AlertOutcome::Recovered, next);
            }
            if class == RunClass::Flaky {
                // Throttled by `cooldown_mins`, which is what stops a check that
                // flakes every run from sending a message every run. Stamped so
                // the throttle advances, but `alerting` stays false so this can
                // never suppress a real outage alert.
                if prior.last_alert_at > 0 && now_us - prior.last_alert_at < cooldown_us {
                    return (AlertOutcome::Silent, next);
                }
                return (
                    AlertOutcome::Flaky,
                    AlertState {
                        last_alert_at: now_us,
                        ..next
                    },
                );
            }
            (AlertOutcome::Silent, next)
        }

        // ── Reachable but degrading ─────────────────────────────────────────
        RunClass::Degraded => {
            // Never advances the streak, and never opens the alerting state — so
            // a degradation cannot produce a "RECOVERED" message, which would be
            // nonsense for a certificate that was simply renewed.
            let unchanged = AlertState {
                consecutive_failures: prior.consecutive_failures,
                last_alert_at: prior.last_alert_at,
                alerting: prior.alerting,
                degraded_notified_at: prior.degraded_notified_at,
            };
            let reminder = cooldown_us.max(DEGRADED_REMINDER_US);
            let first_time = prior.degraded_notified_at == 0;
            let due = !first_time && now_us - prior.degraded_notified_at >= reminder;
            if first_time || due {
                return (
                    AlertOutcome::Degraded,
                    AlertState {
                        degraded_notified_at: now_us,
                        ..unchanged
                    },
                );
            }
            (AlertOutcome::Silent, unchanged)
        }

        // ── Down, or unmeasurable ───────────────────────────────────────────
        RunClass::Failing => {
            let consecutive_failures = prior.consecutive_failures.saturating_add(1);
            let threshold = alert_if_fails.max(1);
            let mut next = AlertState {
                consecutive_failures,
                last_alert_at: prior.last_alert_at,
                alerting: prior.alerting,
                // An outage supersedes a degradation: the certificate is no
                // longer the headline, and re-entering the degraded state later
                // is worth saying again.
                degraded_notified_at: 0,
            };

            if consecutive_failures < threshold {
                // Below the threshold the check is failing but not yet alerting,
                // which is exactly what `alert_if_fails` is for: one failed run
                // out of a required three is not an incident.
                return (AlertOutcome::Silent, next);
            }

            // `last_alert_at == 0` means "never alerted", which must not be
            // treated as "alerted at the epoch and therefore inside no window".
            let within_cooldown = prior.alerting
                && prior.last_alert_at > 0
                && now_us - prior.last_alert_at < cooldown_us;
            if within_cooldown {
                return (AlertOutcome::Silent, next);
            }

            next.alerting = true;
            next.last_alert_at = now_us;
            (AlertOutcome::Firing, next)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = MICROS_PER_MINUTE;
    const DAY: i64 = 24 * 60 * MIN;

    fn state(failures: i32, last_alert_at: i64, alerting: bool) -> AlertState {
        AlertState {
            consecutive_failures: failures,
            last_alert_at,
            alerting,
            degraded_notified_at: 0,
        }
    }

    // ── classification ──────────────────────────────────────────────────────

    #[test]
    fn a_degradation_is_never_flaky_however_many_attempts_it_took() {
        // The reported bug. A TLS check inside its warn window was retried by an
        // older probe, attempts climbed, and the run was announced as "passed only
        // after retries (flaky)" — telling the reader it had fixed itself, when a
        // certificate running out will do no such thing.
        //
        // With the reason on the wire the attempt count stops mattering.
        for attempts in [0, 1, 2, 5] {
            assert_eq!(
                classify(Some("warning"), attempts, "", Some("cert_expiring")),
                RunClass::Degraded,
                "cert_expiring with attempts={attempts}"
            );
            assert_eq!(
                classify(Some("warning"), attempts, "", Some("sftp_degraded")),
                RunClass::Degraded,
                "sftp_degraded with attempts={attempts}"
            );
        }
    }

    #[test]
    fn a_flaky_run_is_still_flaky_even_on_one_attempt() {
        // The fix must not collapse the two — only stop confusing one for the
        // other. An explicit "flaky" wins regardless of the count.
        assert_eq!(
            classify(Some("warning"), 1, "", Some(REASON_FLAKY)),
            RunClass::Flaky
        );
        assert_eq!(
            classify(Some("warning"), 2, "", Some(REASON_FLAKY)),
            RunClass::Flaky
        );
    }

    #[test]
    fn an_unknown_reason_is_treated_as_a_degradation() {
        // A probe newer than this server sends a reason we have never heard of.
        // Everything except "flaky" is something the target will not recover from,
        // so the safe reading is degraded: it under-reports urgency at worst,
        // where guessing flaky would tell someone to ignore a real problem.
        assert_eq!(
            classify(Some("warning"), 3, "", Some("some_future_reason")),
            RunClass::Degraded
        );
    }

    #[test]
    fn an_old_probe_still_falls_back_to_the_attempt_count() {
        // No reason on the wire — the pre-existing behaviour, kept so a probe that
        // has not been upgraded is no worse off than before.
        assert_eq!(classify(Some("warning"), 2, "", None), RunClass::Flaky);
        assert_eq!(classify(Some("warning"), 1, "", None), RunClass::Degraded);
        // An empty string is "not sent", not a reason.
        assert_eq!(classify(Some("warning"), 2, "", Some("")), RunClass::Flaky);
    }

    #[test]
    fn attempts_separates_flaky_from_degraded() {
        // The retry loop needs more than one attempt by definition, and A6 breaks
        // the loop on a degraded warning — so `attempts` is the discriminator and
        // `status_reason` does not need to be on the ack wire.
        assert_eq!(classify(Some("warning"), 2, "", None), RunClass::Flaky);
        assert_eq!(classify(Some("warning"), 3, "", None), RunClass::Flaky);
        assert_eq!(classify(Some("warning"), 1, "", None), RunClass::Degraded);
        // A probe that never reported attempts must not be read as flaky.
        assert_eq!(classify(Some("warning"), 0, "", None), RunClass::Degraded);
    }

    #[test]
    fn a_queue_dropped_job_is_not_the_customers_problem() {
        // The stale drop acks as `error`, and `error` advances the streak — so
        // before this, three jobs delayed behind other jobs' retry chains paged
        // the customer for OUR scheduling lag and opened an incident that then
        // owed a recovery.
        assert_eq!(
            classify(Some("error"), 1, ERROR_SOURCE_QUEUE, None),
            RunClass::NotMeasured
        );
        // The other two error sources are real signals and stay Failing.
        assert_eq!(
            classify(Some("error"), 1, "dispatch", None),
            RunClass::Failing
        );
        assert_eq!(classify(Some("error"), 1, "probe", None), RunClass::Failing);
    }

    #[test]
    fn a_queue_drop_leaves_the_streak_exactly_where_it_was() {
        // Not advanced, and NOT reset. A check already at 2 failures keeps them,
        // so the next genuine failure still reaches a threshold of 3 — the page is
        // delayed by one run, never lost.
        let before = state(2, 1000 * MIN, false);
        let (outcome, after) = decide(before, RunClass::NotMeasured, 3, 0, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(after, before);

        let (outcome, _) = decide(after, RunClass::Failing, 3, 0, 1020 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn a_queue_drop_does_not_close_an_open_incident() {
        // Resetting would let a saturated location hold the streak at zero and
        // suppress a real outage for as long as the queue stayed backed up.
        let alerting = state(5, 1000 * MIN, true);
        let (outcome, after) = decide(alerting, RunClass::NotMeasured, 1, 30, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert!(after.alerting, "the incident stays open");
        assert_eq!(after.consecutive_failures, 5);
    }

    #[test]
    fn error_is_failing_not_a_class_of_its_own() {
        // Regression guard for a P0: `error` used to return early and notify
        // nothing, so a dead agent produced silence indefinitely.
        assert_eq!(classify(Some("error"), 1, "", None), RunClass::Failing);
        assert_eq!(classify(Some("failed"), 1, "", None), RunClass::Failing);
        assert_eq!(classify(Some("passed"), 1, "", None), RunClass::Healthy);
        // Unknown leans toward notifying, never toward silence.
        assert_eq!(classify(None, 1, "", None), RunClass::Failing);
        assert_eq!(
            classify(Some("something-new"), 1, "", None),
            RunClass::Failing
        );
    }

    // ── outage path ─────────────────────────────────────────────────────────

    #[test]
    fn silent_below_the_failure_threshold() {
        // alert_if_fails = 3: one failed run out of a required three is not an
        // incident. This fired on the first failure before C6.
        let (outcome, next) = decide(AlertState::default(), RunClass::Failing, 3, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(next.consecutive_failures, 1);
        assert!(!next.alerting);

        let (outcome, next) = decide(next, RunClass::Failing, 3, 0, 1001 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(next.consecutive_failures, 2);
    }

    #[test]
    fn fires_exactly_on_the_threshold_run() {
        let mut st = AlertState::default();
        for _ in 0..2 {
            let (outcome, next) = decide(st, RunClass::Failing, 3, 0, 1000 * MIN);
            assert_eq!(outcome, AlertOutcome::Silent);
            st = next;
        }
        let (outcome, next) = decide(st, RunClass::Failing, 3, 30, 1002 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        assert!(next.alerting);
        assert_eq!(next.last_alert_at, 1002 * MIN);
    }

    #[test]
    fn a_check_that_cannot_run_still_reaches_the_threshold() {
        // Three consecutive `error` runs with alert_if_fails=3 must fire, exactly
        // as three `failed` runs would. The message differs; the gating does not.
        let mut st = AlertState::default();
        for _ in 0..2 {
            let (outcome, next) =
                decide(st, classify(Some("error"), 1, "", None), 3, 0, 1000 * MIN);
            assert_eq!(outcome, AlertOutcome::Silent);
            st = next;
        }
        let (outcome, _) = decide(st, classify(Some("error"), 1, "", None), 3, 0, 1002 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn cooldown_suppresses_repeats_and_then_releases() {
        let alerting = state(3, 1000 * MIN, true);

        // 29 minutes into a 30-minute cooldown: silent, but the failure still
        // counts — the streak is what a later notification reports.
        let (outcome, next) = decide(alerting, RunClass::Failing, 1, 30, 1029 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(next.consecutive_failures, 4);
        assert_eq!(next.last_alert_at, 1000 * MIN, "cooldown must not restart");

        // 30 minutes exactly: the window has elapsed.
        let (outcome, next) = decide(alerting, RunClass::Failing, 1, 30, 1030 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        assert_eq!(next.last_alert_at, 1030 * MIN);
    }

    #[test]
    fn a_never_alerted_check_is_not_treated_as_inside_a_window() {
        // last_alert_at = 0 means "never", not "alerted at the epoch".
        let (outcome, _) = decide(state(0, 0, true), RunClass::Failing, 1, 1440, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn a_zero_threshold_still_needs_one_failure() {
        // Rows written before validation enforced 1..=100 can hold 0, which would
        // otherwise fire before anything had failed.
        let (outcome, _) = decide(AlertState::default(), RunClass::Failing, 0, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        let (outcome, _) = decide(AlertState::default(), RunClass::Healthy, 0, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
    }

    // ── recovery ────────────────────────────────────────────────────────────

    #[test]
    fn recovery_is_sent_once_and_only_to_someone_who_was_alerted() {
        let (outcome, next) = decide(
            state(5, 1000 * MIN, true),
            RunClass::Healthy,
            1,
            30,
            1010 * MIN,
        );
        assert_eq!(outcome, AlertOutcome::Recovered);
        assert_eq!(next.consecutive_failures, 0);
        assert!(!next.alerting);

        // A second pass says nothing — the incident is already closed.
        let (outcome, _) = decide(next, RunClass::Healthy, 1, 30, 1011 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
    }

    #[test]
    fn a_check_that_never_alerted_does_not_announce_recovery() {
        let (outcome, _) = decide(AlertState::default(), RunClass::Healthy, 1, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
    }

    #[test]
    fn recovery_does_not_start_a_cooldown() {
        // Stamping last_alert_at on recovery would put the NEXT real failure
        // inside a window it never earned, silencing it.
        let (_, recovered) = decide(
            state(5, 1000 * MIN, true),
            RunClass::Healthy,
            1,
            30,
            1010 * MIN,
        );
        let (outcome, _) = decide(recovered, RunClass::Failing, 1, 30, 1011 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    // ── flaky ───────────────────────────────────────────────────────────────

    #[test]
    fn a_flaky_run_notifies_without_opening_an_incident() {
        let (outcome, next) = decide(AlertState::default(), RunClass::Flaky, 3, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Flaky);
        // Not an incident: no streak, no alerting state, so no recovery is owed.
        assert_eq!(next.consecutive_failures, 0);
        assert!(!next.alerting);
    }

    #[test]
    fn flaky_is_throttled_by_the_cooldown() {
        // A check that flakes on every run would otherwise send a message on
        // every run, which is how a channel gets muted.
        let (_, first) = decide(AlertState::default(), RunClass::Flaky, 1, 30, 1000 * MIN);
        let (outcome, _) = decide(first, RunClass::Flaky, 1, 30, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        let (outcome, _) = decide(first, RunClass::Flaky, 1, 30, 1030 * MIN);
        assert_eq!(outcome, AlertOutcome::Flaky);
    }

    #[test]
    fn flaky_never_suppresses_a_real_outage_alert() {
        // A flaky run stamps last_alert_at to throttle itself, but leaves
        // `alerting` false — and the outage cooldown only applies while alerting.
        let (_, after_flaky) = decide(AlertState::default(), RunClass::Flaky, 1, 60, 1000 * MIN);
        let (outcome, _) = decide(after_flaky, RunClass::Failing, 1, 60, 1001 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn recovery_wins_over_flaky() {
        // The run passed, so it closes the incident. Reporting flakiness instead
        // would leave the incident open with no further message coming.
        let (outcome, _) = decide(
            state(3, 1000 * MIN, true),
            RunClass::Flaky,
            1,
            0,
            1010 * MIN,
        );
        assert_eq!(outcome, AlertOutcome::Recovered);
    }

    // ── degraded ────────────────────────────────────────────────────────────

    #[test]
    fn degraded_notifies_on_entry_then_stays_quiet() {
        // The case this exists for: a certificate inside a 30-day warning window
        // is `warning` on EVERY run. Notifying per run is unusable; treating
        // `warning` as healthy meant it never notified at all until the
        // certificate actually expired — after the outage.
        let (outcome, next) = decide(AlertState::default(), RunClass::Degraded, 3, 0, 1000 * MIN);
        assert_eq!(outcome, AlertOutcome::Degraded);
        assert_eq!(next.degraded_notified_at, 1000 * MIN);

        let (outcome, _) = decide(next, RunClass::Degraded, 3, 0, 1001 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
    }

    #[test]
    fn degraded_is_restated_daily() {
        let (_, first) = decide(AlertState::default(), RunClass::Degraded, 1, 0, 1000 * MIN);
        let (outcome, _) = decide(first, RunClass::Degraded, 1, 0, 1000 * MIN + DAY - MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        let (outcome, next) = decide(first, RunClass::Degraded, 1, 0, 1000 * MIN + DAY);
        assert_eq!(outcome, AlertOutcome::Degraded);
        assert_eq!(next.degraded_notified_at, 1000 * MIN + DAY);
    }

    #[test]
    fn an_explicit_cooldown_longer_than_a_day_wins() {
        // A setting beats a built-in default.
        let two_days = 2 * 24 * 60;
        let (_, first) = decide(
            AlertState::default(),
            RunClass::Degraded,
            1,
            two_days,
            1000 * MIN,
        );
        let (outcome, _) = decide(first, RunClass::Degraded, 1, two_days, 1000 * MIN + DAY);
        assert_eq!(outcome, AlertOutcome::Silent);
        let (outcome, _) = decide(first, RunClass::Degraded, 1, two_days, 1000 * MIN + 2 * DAY);
        assert_eq!(outcome, AlertOutcome::Degraded);
    }

    #[test]
    fn degradation_never_advances_the_failure_streak() {
        // Otherwise a certificate two days from expiry eventually pages as an
        // outage, having never actually failed.
        let mut st = AlertState::default();
        for i in 0..10 {
            let (_, next) = decide(st, RunClass::Degraded, 3, 0, (1000 + i) * MIN);
            st = next;
        }
        assert_eq!(st.consecutive_failures, 0);
        assert!(!st.alerting);
    }

    #[test]
    fn degradation_does_not_owe_a_recovery() {
        // `alerting` stays false through a degradation, so a renewed certificate
        // does not produce a "RECOVERED" message for an incident nobody opened.
        let (_, degraded) = decide(AlertState::default(), RunClass::Degraded, 1, 0, 1000 * MIN);
        let (outcome, next) = decide(degraded, RunClass::Healthy, 1, 0, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(next.degraded_notified_at, 0, "degradation cleared");
    }

    #[test]
    fn an_outage_supersedes_a_degradation_and_re_notifies_afterwards() {
        let (_, degraded) = decide(AlertState::default(), RunClass::Degraded, 1, 0, 1000 * MIN);
        // The check goes down: the certificate is no longer the headline.
        let (outcome, failing) = decide(degraded, RunClass::Failing, 1, 0, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        assert_eq!(failing.degraded_notified_at, 0);
        // It comes back, still degraded — that is worth saying again.
        let (outcome, _) = decide(failing, RunClass::Degraded, 1, 0, 1020 * MIN);
        assert_eq!(outcome, AlertOutcome::Degraded);
    }
}

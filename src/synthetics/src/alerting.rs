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

use std::{future::Future, pin::Pin, sync::OnceLock};

use infra::table::synthetics_checks::AlertState;

/// The same shape as `futures::future::BoxFuture`, which this crate does not depend on.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The id of the downtime muting a check; the server registers it, as this crate cannot.
pub type MuteCheck = fn(
    org: &str,
    check_id: &str,
    folder_id: &str,
    tags: &[String],
) -> BoxFuture<'static, Option<String>>;

static MUTE_CHECK: OnceLock<MuteCheck> = OnceLock::new();

/// Whether an org can have a muted check now, answered from memory; the server registers it.
pub type MayMute = fn(org: &str) -> bool;

static MAY_MUTE: OnceLock<MayMute> = OnceLock::new();

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
    // Our own fault, checked before anything else: a queue-dropped, undispatched or
    // orphaned job never ran, so it is evidence about our scheduling and nothing at
    // all about the target.
    if matches!(
        error_source,
        ERROR_SOURCE_QUEUE
            | ERROR_SOURCE_CONTROL_PLANE
            | ERROR_SOURCE_DISPATCH
            | ERROR_SOURCE_ORPHAN
    ) {
        return RunClass::NotMeasured;
    }
    // A child still replicating to this region is lag of ours, like a queue drop.
    if error_source == ERROR_SOURCE_CONFIG
        && status_reason == Some(crate::job_api::REASON_CONFIG_REFERENCE_PENDING)
    {
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
/// ever created). `probe` is a real signal about the check; `queue`, `dispatch`
/// and `orphan` are signals about us, so all three are Not measured.
pub const ERROR_SOURCE_QUEUE: &str = "queue";

/// `error_source` for a probe that could not reach the job API, so it never checked the target.
pub const ERROR_SOURCE_CONTROL_PLANE: &str = "control_plane";

/// `error_source` for a check nothing scheduled at all.
///
/// The only value in the vocabulary that describes the *absence* of a job
/// rather than the fate of one: `dispatch`, `probe` and `queue` all presuppose
/// a job existed. Alert rules need it separable because the response differs —
/// the other three point at the probe fleet, this one points at the scheduler.
pub const ERROR_SOURCE_ORPHAN: &str = "orphan";

/// `error_source` for a job no probe ever ran — the reaper's dead letter.
///
/// Both halves of that dead letter (`synthetics_results` and `triggers`) carry
/// it: the three failure paths share one stream and one `status`, so a rule can
/// only tell them apart by this value.
pub const ERROR_SOURCE_DISPATCH: &str = "dispatch";

/// `error_source` for a run whose journey could not be assembled (§5.11): unbilled, but alerts.
pub const ERROR_SOURCE_CONFIG: &str = "config";

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

pub fn register_mute_check(f: MuteCheck, may_mute: MayMute) {
    let _ = MUTE_CHECK.set(f);
    let _ = MAY_MUTE.set(may_mute);
}

/// False when nothing is registered, as in OSS or with downtimes off, so no row is loaded for it.
pub fn may_mute(org: &str) -> bool {
    MAY_MUTE.get().is_some_and(|f| f(org))
}

/// `None` when nothing is registered, so an OSS build never mutes.
pub async fn muted_by(
    org: &str,
    check_id: &str,
    folder_id: &str,
    tags: &[String],
) -> Option<String> {
    let check = MUTE_CHECK.get()?;
    check(org, check_id, folder_id, tags).await
}

/// A muted run may close `alerting` but never open it, so a muted recovery is dropped.
pub fn suppressed_state(prior: AlertState, next: AlertState) -> AlertState {
    AlertState {
        last_alert_at: prior.last_alert_at,
        alerting: prior.alerting && next.alerting,
        degraded_notified_at: prior.degraded_notified_at,
        // A muted gap notice is not sent, so no resumed notice may follow it either.
        gap_since: if next.gap_resumed_at > 0 {
            0
        } else {
            next.gap_since
        },
        gap_runs: if next.gap_resumed_at > 0 {
            0
        } else {
            next.gap_runs
        },
        gap_notified_at: if next.gap_since == 0 || next.gap_resumed_at > 0 {
            0
        } else {
            prior.gap_notified_at
        },
        gap_resumed_at: 0,
        ..next
    }
}

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
                ..prior
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
                ..prior
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
                ..prior
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

// ── Run coverage and the Not measured gap (spec S7) ─────────────────────────

/// Not measured runs in a row that send the "Monitoring gap" notice.
pub const GAP_NOTICE_RUNS: i32 = 3;

/// A gap at least this old sends its notice on the next Not measured run, whatever the count.
pub const GAP_NOTICE_AFTER_US: i64 = 15 * MICROS_PER_MINUTE;

/// The reaper retries a "Monitoring resumed" notice this long after the run that closed the gap,
/// so it does not race the first send.
pub const GAP_RESUMED_RETRY_AFTER_US: i64 = MICROS_PER_MINUTE;

/// The reaper stops retrying a "Monitoring resumed" notice after this long and closes the gap, so
/// a destination that stays broken does not hold the state forever.
pub const GAP_RESUMED_GIVE_UP_US: i64 = 60 * MICROS_PER_MINUTE;

/// The alert class of a finalized run, from its stored run class where that is sure.
///
/// The stored class comes from every job of the run, while `acked` reads one ack: a run that no
/// location tested is Not measured whatever the last ack said, and a run that a location tested is
/// measured even when the last ack was our own error. A partial run fires only when the check
/// alerts on any location; under "down only" it counts as up.
pub fn class_for_run(
    stored: config::meta::synthetics::RunClass,
    alerts_on_partial: bool,
    acked: RunClass,
) -> RunClass {
    use config::meta::synthetics::RunClass as Stored;
    match stored {
        Stored::Unknown => acked,
        Stored::NotMeasured => RunClass::NotMeasured,
        Stored::Partial if !alerts_on_partial => RunClass::Healthy,
        // No location failed. The aggregate is `error` when one location was Not measured, and
        // the last ack can be a pass with no error source, which reads as a failure.
        Stored::Up if matches!(acked, RunClass::NotMeasured | RunClass::Failing) => {
            RunClass::Healthy
        }
        Stored::Partial | Stored::Down | Stored::Misconfigured
            if acked == RunClass::NotMeasured =>
        {
            RunClass::Failing
        }
        Stored::Up | Stored::Partial | Stored::Down | Stored::Misconfigured => acked,
    }
}

/// "Failing in 1 of 2 locations (aws-us-east-1)" for a partial run, "Failing in 2 of 2
/// locations" for a down one. `None` for any other class, or when nothing is known to count.
pub fn coverage_line(
    stored: config::meta::synthetics::RunClass,
    failed_locations: &[String],
    voters: i32,
) -> Option<String> {
    use config::meta::synthetics::RunClass as Stored;
    let failed = failed_locations.len();
    if failed == 0 || voters <= 0 {
        return None;
    }
    let total = (voters as usize).max(failed);
    let noun = if total == 1 { "location" } else { "locations" };
    match stored {
        Stored::Partial => Some(format!(
            "Failing in {failed} of {total} {noun} ({})",
            failed_locations.join(", ")
        )),
        Stored::Down => Some(format!("Failing in {failed} of {total} {noun}")),
        _ => None,
    }
}

/// A notice about our own ability to test the site, separate from the check result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GapNotice {
    /// "Monitoring gap": no run tested the site since `since` (microseconds).
    Opened { since: i64 },
    /// "Monitoring resumed": a run tested the site again after a gap that sent its notice.
    Resumed { since: i64, until: i64 },
}

/// Moves the gap state for one finalized run and says which notice it owes, if any.
///
/// Each gap sends one notice pair: "Monitoring gap" after [`GAP_NOTICE_RUNS`] Not measured runs
/// in a row or [`GAP_NOTICE_AFTER_US`], and "Monitoring resumed" on the next run that is not Not
/// measured, only if the gap notice went out. The state lives on the check row, so a restart or
/// another node continues the same gap.
///
/// This never sets `gap_notified_at`: the sender sets it after a delivery succeeds
/// (`synthetics_checks::mark_gap_notified`), so a failed send is owed again on the next run or
/// reaper sweep. A closed gap whose notice went out keeps its state with `gap_resumed_at` set until
/// the "Monitoring resumed" notice is delivered (`synthetics_checks::clear_resumed_gap`). The
/// reaper retries that send. A Not measured run before then reopens the same gap, as no reader saw
/// it close.
pub fn decide_gap(
    prior: AlertState,
    not_measured: bool,
    now_us: i64,
) -> (Option<GapNotice>, AlertState) {
    if !not_measured {
        // The reaper retries a resumed notice that is already owed.
        if prior.gap_resumed_at > 0 {
            return (None, prior);
        }
        if prior.gap_since > 0 && prior.gap_notified_at > 0 {
            let next = AlertState {
                gap_runs: 0,
                gap_resumed_at: now_us,
                ..prior
            };
            let notice = GapNotice::Resumed {
                since: prior.gap_since,
                until: now_us,
            };
            return (Some(notice), next);
        }
        let next = AlertState {
            gap_since: 0,
            gap_runs: 0,
            gap_notified_at: 0,
            ..prior
        };
        return (None, next);
    }
    let since = if prior.gap_since > 0 {
        prior.gap_since
    } else {
        now_us
    };
    let next = AlertState {
        gap_since: since,
        gap_runs: prior.gap_runs.saturating_add(1),
        gap_resumed_at: 0,
        ..prior
    };
    let due = next.gap_runs >= GAP_NOTICE_RUNS || now_us - since >= GAP_NOTICE_AFTER_US;
    if prior.gap_notified_at == 0 && due {
        return (Some(GapNotice::Opened { since }), next);
    }
    (None, next)
}

/// "10:36 UTC", the clock time a notice names.
pub fn utc_clock(micros: i64) -> String {
    chrono::DateTime::from_timestamp_micros(micros)
        .map(|dt| dt.format("%H:%M UTC").to_string())
        .unwrap_or_else(|| micros.to_string())
}

/// "23 minutes", "2 hours 5 minutes", "less than a minute".
pub fn gap_length(micros: i64) -> String {
    let mins = micros.max(0) / MICROS_PER_MINUTE;
    let plural = |n: i64, unit: &str| {
        if n == 1 {
            format!("1 {unit}")
        } else {
            format!("{n} {unit}s")
        }
    };
    match (mins / 60, mins % 60) {
        (0, 0) => "less than a minute".to_string(),
        (0, m) => plural(m, "minute"),
        (h, 0) => plural(h, "hour"),
        (h, m) => format!("{} {}", plural(h, "hour"), plural(m, "minute")),
    }
}

/// The subject and body of a gap notice, in the spec S7 wording.
pub fn gap_notice_text(notice: GapNotice, check_name: &str, target: &str) -> (String, String) {
    match notice {
        GapNotice::Opened { since } => (
            format!("[OpenObserve Synthetics] Monitoring gap: {check_name}"),
            format!(
                "We could not test {target} from {}. This is a problem on our side. Your site was not tested.",
                utc_clock(since)
            ),
        ),
        GapNotice::Resumed { since, until } => (
            format!("[OpenObserve Synthetics] Monitoring resumed: {check_name}"),
            format!(
                "We test {target} again. The monitoring gap lasted {}, from {} to {}.",
                gap_length(until - since),
                utc_clock(since),
                utc_clock(until)
            ),
        ),
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
            ..Default::default()
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
    fn a_probe_that_cannot_reach_the_job_api_is_not_measured() {
        assert_eq!(
            classify(Some("error"), 1, ERROR_SOURCE_CONTROL_PLANE, None),
            RunClass::NotMeasured
        );
        let before = state(2, 0, false);
        let (outcome, after) = decide(before, RunClass::NotMeasured, 3, 0, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(
            after.consecutive_failures, 2,
            "the failure streak must not move"
        );
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
        // A crashed probe is a real signal and stays Failing.
        assert_eq!(classify(Some("error"), 1, "probe", None), RunClass::Failing);
    }

    #[test]
    fn dispatch_and_orphan_errors_are_not_measured() {
        for source in [ERROR_SOURCE_DISPATCH, ERROR_SOURCE_ORPHAN] {
            assert_eq!(
                classify(Some("error"), 1, source, None),
                RunClass::NotMeasured,
                "{source}"
            );
        }
        let before = state(2, 0, false);
        let (outcome, after) = decide(before, RunClass::NotMeasured, 3, 0, 1010 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        assert_eq!(after.consecutive_failures, 2);
    }

    #[test]
    fn a_config_error_is_failing_not_not_measured() {
        // A config error is our fault but not lag: the check cannot run until fixed, so it pages.
        assert_eq!(
            classify(
                Some("error"),
                1,
                ERROR_SOURCE_CONFIG,
                Some("config_steps_exceeded")
            ),
            RunClass::Failing
        );
    }

    #[test]
    fn a_pending_replication_is_not_measured() {
        assert_eq!(
            classify(
                Some("error"),
                1,
                ERROR_SOURCE_CONFIG,
                Some(crate::job_api::REASON_CONFIG_REFERENCE_PENDING)
            ),
            RunClass::NotMeasured
        );
        assert_eq!(
            classify(
                Some("error"),
                1,
                ERROR_SOURCE_CONFIG,
                Some(crate::job_api::REASON_CONFIG_REFERENCE_MISSING)
            ),
            RunClass::Failing
        );
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

    #[test]
    fn a_muted_failure_keeps_the_streak_and_leaves_last_alert_at_alone() {
        let prior = state(2, 0, false);
        let (outcome, next) = decide(prior, RunClass::Failing, 3, 30, 10 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        let muted = suppressed_state(prior, next);
        assert_eq!(muted.consecutive_failures, 3);
        assert!(
            !muted.alerting,
            "nobody was told, so no RECOVERED may follow"
        );
        assert_eq!(muted.last_alert_at, 0);
    }

    #[test]
    fn a_muted_failure_of_an_announced_outage_keeps_alerting() {
        let prior = state(4, MIN, true);
        let (outcome, next) = decide(prior, RunClass::Failing, 3, 30, 40 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
        let muted = suppressed_state(prior, next);
        assert!(muted.alerting);
        assert_eq!(muted.last_alert_at, MIN);
    }

    #[test]
    fn a_recovery_inside_the_window_sends_nothing_on_the_first_pass_after_it() {
        let paged = state(3, MIN, true);
        let (outcome, next) = decide(paged, RunClass::Healthy, 3, 30, 45 * MIN);
        assert_eq!(outcome, AlertOutcome::Recovered);
        let muted = suppressed_state(paged, next);
        assert!(!muted.alerting, "the recovery is dropped, not owed");
        assert_eq!(muted.consecutive_failures, 0);
        let (outcome, after) = decide(muted, RunClass::Healthy, 3, 30, 61 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        // The next outage after the window notifies.
        let (_, one) = decide(after, RunClass::Failing, 3, 30, 62 * MIN);
        let (_, two) = decide(one, RunClass::Failing, 3, 30, 63 * MIN);
        let (outcome, _) = decide(two, RunClass::Failing, 3, 30, 64 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn an_outage_muted_from_start_to_recovery_sends_nothing_after_the_window() {
        let prior = state(2, 0, false);
        let (_, next) = decide(prior, RunClass::Failing, 3, 30, 10 * MIN);
        let muted = suppressed_state(prior, next);
        let (outcome, next) = decide(muted, RunClass::Healthy, 3, 30, 20 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
        let (outcome, _) = decide(next, RunClass::Healthy, 3, 30, 61 * MIN);
        assert_eq!(outcome, AlertOutcome::Silent);
    }

    #[test]
    fn the_first_failure_after_the_window_notifies_without_cooldown() {
        let prior = state(2, 0, false);
        let (_, next) = decide(prior, RunClass::Failing, 3, 30, 10 * MIN);
        let muted = suppressed_state(prior, next);
        let (outcome, _) = decide(muted, RunClass::Failing, 3, 30, 11 * MIN);
        assert_eq!(outcome, AlertOutcome::Firing);
    }

    #[test]
    fn a_muted_degradation_is_restated_after_the_window() {
        let prior = state(0, 0, false);
        let (outcome, next) = decide(prior, RunClass::Degraded, 3, 30, MIN);
        assert_eq!(outcome, AlertOutcome::Degraded);
        let muted = suppressed_state(prior, next);
        let (outcome, _) = decide(muted, RunClass::Degraded, 3, 30, 2 * MIN);
        assert_eq!(outcome, AlertOutcome::Degraded);
    }

    #[tokio::test]
    async fn nothing_registered_mutes_nothing() {
        assert_eq!(muted_by("default", "c1", "default", &[]).await, None);
    }

    #[test]
    fn nothing_registered_means_no_org_can_mute() {
        assert!(!may_mute("org"));
    }
    // ── S7: coverage, the any-location rule, gap notices ─────────────────────

    use config::meta::synthetics::RunClass as Stored;

    fn locs(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn a_failure_alert_states_its_coverage() {
        assert_eq!(
            coverage_line(Stored::Partial, &locs(&["aws-us-east-1"]), 2).as_deref(),
            Some("Failing in 1 of 2 locations (aws-us-east-1)")
        );
        assert_eq!(
            coverage_line(Stored::Down, &locs(&["aws-us-east-1", "aws-us-west-1"]), 2).as_deref(),
            Some("Failing in 2 of 2 locations")
        );
        assert_eq!(
            coverage_line(Stored::Down, &locs(&["aws-us-east-1"]), 1).as_deref(),
            Some("Failing in 1 of 1 location")
        );
        // Nothing failed, nothing counted, or a class with no coverage: no line.
        assert_eq!(coverage_line(Stored::Partial, &[], 2), None);
        assert_eq!(coverage_line(Stored::Down, &locs(&["a"]), 0), None);
        assert_eq!(coverage_line(Stored::Up, &locs(&["a"]), 2), None);
        assert_eq!(coverage_line(Stored::Misconfigured, &locs(&["a"]), 2), None);
    }

    #[test]
    fn a_partial_run_fires_only_under_the_any_location_rule() {
        assert_eq!(
            class_for_run(Stored::Partial, true, RunClass::Failing),
            RunClass::Failing
        );
        assert_eq!(
            class_for_run(Stored::Partial, false, RunClass::Failing),
            RunClass::Healthy,
            "down only: a failure below quorum is up"
        );
        for any in [true, false] {
            assert_eq!(
                class_for_run(Stored::Down, any, RunClass::Failing),
                RunClass::Failing
            );
        }
        // Under "down only" a partial run closes an incident a down run opened.
        let (outcome, _) = decide(
            state(1, 10 * MIN, true),
            class_for_run(Stored::Partial, false, RunClass::Failing),
            1,
            0,
            20 * MIN,
        );
        assert_eq!(outcome, AlertOutcome::Recovered);
    }

    #[test]
    fn the_stored_class_corrects_what_one_ack_cannot_know() {
        // No location tested the site, whatever the last ack said.
        assert_eq!(
            class_for_run(Stored::NotMeasured, true, RunClass::Failing),
            RunClass::NotMeasured
        );
        // The last ack was our own error, but another location tested the site.
        assert_eq!(
            class_for_run(Stored::Up, true, RunClass::NotMeasured),
            RunClass::Healthy
        );
        // The last ack passed, beside a location that was Not measured: the aggregate says
        // `error` with no error source, which alone reads as a failure.
        assert_eq!(
            class_for_run(Stored::Up, true, classify(Some("error"), 1, "", None)),
            RunClass::Healthy
        );
        assert_eq!(
            class_for_run(Stored::Down, false, RunClass::NotMeasured),
            RunClass::Failing
        );
        // No stored class: the ack decides, as before.
        assert_eq!(
            class_for_run(Stored::Unknown, false, RunClass::Degraded),
            RunClass::Degraded
        );
    }

    #[test]
    fn existing_rules_keep_any_location_and_new_rules_are_down_only() {
        use config::meta::synthetics::{AlertOn, SyntheticSettings};
        // A settings row saved before the rule existed.
        let legacy: SyntheticSettings =
            serde_json::from_value(serde_json::json!({"retries": 1, "alert_if_fails": 2})).unwrap();
        assert_eq!(legacy.alert_on, None);
        let mut check = config::meta::synthetics::Synthetic {
            alert_on: legacy.alert_on,
            ..Default::default()
        };
        assert!(check.alerts_on_partial());
        check.alert_on = Some(AlertOn::Down);
        assert!(!check.alerts_on_partial());
        check.alert_on = Some(AlertOn::AnyLocation);
        assert!(check.alerts_on_partial());
        assert_eq!(
            serde_json::to_value(AlertOn::AnyLocation).unwrap(),
            serde_json::json!("any_location")
        );
    }

    /// Runs `classes` (true = Not measured) through the gap state from `state`, one per minute
    /// from `start`, and returns the notices with the final state. Each gap notice is delivered,
    /// so the sender marks it as `mark_gap_notified` does.
    fn run_gap(
        mut state: AlertState,
        start: i64,
        classes: &[bool],
    ) -> (Vec<GapNotice>, AlertState) {
        let mut notices = Vec::new();
        for (i, not_measured) in classes.iter().enumerate() {
            let now = start + i as i64 * MIN;
            let (notice, mut next) = decide_gap(state, *not_measured, now);
            match notice {
                Some(GapNotice::Opened { .. }) => next.gap_notified_at = now,
                Some(GapNotice::Resumed { .. }) => {
                    next.gap_since = 0;
                    next.gap_runs = 0;
                    next.gap_notified_at = 0;
                    next.gap_resumed_at = 0;
                }
                None => {}
            }
            notices.extend(notice);
            state = next;
        }
        (notices, state)
    }

    #[test]
    fn a_gap_notice_that_was_not_delivered_is_owed_again() {
        let t0 = 10 * MIN;
        let (_, state) = run_gap(AlertState::default(), t0, &[true, true]);
        let (first, undelivered) = decide_gap(state, true, t0 + 2 * MIN);
        assert_eq!(first, Some(GapNotice::Opened { since: t0 }));
        assert_eq!(undelivered.gap_notified_at, 0, "only a delivery marks it");
        let (again, _) = decide_gap(undelivered, true, t0 + 3 * MIN);
        assert_eq!(again, Some(GapNotice::Opened { since: t0 }));
    }

    #[test]
    fn a_resumed_notice_that_was_not_delivered_stays_owed() {
        let t0 = 10 * MIN;
        let (_, open) = run_gap(AlertState::default(), t0, &[true, true, true]);
        let until = t0 + 3 * MIN;
        let (first, owed) = decide_gap(open, false, until);
        assert_eq!(first, Some(GapNotice::Resumed { since: t0, until }));
        assert_eq!(owed.gap_since, t0, "only a delivery closes the gap");
        assert_eq!(owed.gap_resumed_at, until);
        // The next good run does not send it again: the reaper retries it.
        assert_eq!(decide_gap(owed, false, until + MIN), (None, owed));
        // Not measured before delivery: the same gap goes on, and no second gap notice goes out.
        let (notice, reopened) = decide_gap(owed, true, until + MIN);
        assert_eq!(notice, None);
        assert_eq!(reopened.gap_since, t0);
        assert_eq!(reopened.gap_resumed_at, 0);
        assert!(reopened.gap_notified_at > 0);
    }

    #[test]
    fn a_muted_recovery_closes_the_gap_with_no_resumed_notice() {
        let t0 = 10 * MIN;
        let (_, open) = run_gap(AlertState::default(), t0, &[true, true, true]);
        let (_, owed) = decide_gap(open, false, t0 + 3 * MIN);
        let muted = suppressed_state(open, owed);
        assert_eq!(
            (
                muted.gap_since,
                muted.gap_runs,
                muted.gap_notified_at,
                muted.gap_resumed_at
            ),
            (0, 0, 0, 0)
        );
    }

    #[test]
    fn a_gap_sends_one_notice_pair() {
        let t0 = 600 * MIN;
        let (notices, state) = run_gap(
            AlertState::default(),
            t0,
            &[true, true, true, true, true, false, false],
        );
        assert_eq!(
            notices,
            vec![
                GapNotice::Opened { since: t0 },
                GapNotice::Resumed {
                    since: t0,
                    until: t0 + 5 * MIN
                },
            ]
        );
        assert_eq!(
            (state.gap_since, state.gap_runs, state.gap_notified_at),
            (0, 0, 0)
        );
    }

    #[test]
    fn a_short_gap_sends_nothing() {
        let (notices, state) = run_gap(AlertState::default(), 0, &[true, true, false]);
        assert!(notices.is_empty(), "{notices:?}");
        assert_eq!(state, AlertState::default());
    }

    #[test]
    fn a_long_interval_gap_notices_after_fifteen_minutes() {
        let t0 = 60 * MIN;
        let first = decide_gap(AlertState::default(), true, t0);
        assert_eq!(first.0, None);
        let (notice, _) = decide_gap(first.1, true, t0 + 15 * MIN);
        assert_eq!(notice, Some(GapNotice::Opened { since: t0 }));
    }

    #[test]
    fn the_gap_pair_survives_a_restart() {
        // The state is written to the check row after each run; a restart or another node
        // reads it back and carries on with the same gap.
        let t0 = 100 * MIN;
        let (before, persisted) = run_gap(AlertState::default(), t0, &[true, true, true]);
        assert_eq!(before, vec![GapNotice::Opened { since: t0 }]);
        let (after, _) = run_gap(persisted, t0 + 3 * MIN, &[true, true, false]);
        assert_eq!(
            after,
            vec![GapNotice::Resumed {
                since: t0,
                until: t0 + 5 * MIN
            }],
            "no second gap notice, one resumed notice"
        );
    }

    #[test]
    fn the_gap_state_leaves_the_alert_state_alone() {
        let prior = state(2, 5 * MIN, true);
        let (_, during) = decide_gap(prior, true, 10 * MIN);
        let (_, after) = decide_gap(during, false, 11 * MIN);
        assert_eq!(after, prior);
    }

    #[test]
    fn a_muted_gap_notice_sends_no_resumed_notice() {
        let (notice, next) = run_gap(AlertState::default(), 0, &[true, true, true]);
        assert_eq!(notice.len(), 1);
        let before_last = run_gap(AlertState::default(), 0, &[true, true]).1;
        let muted = suppressed_state(before_last, next);
        assert_eq!(muted.gap_notified_at, 0);
        assert_eq!(muted.gap_runs, 3);
        let (resumed, _) = decide_gap(muted, false, 4 * MIN);
        assert_eq!(resumed, None);
    }

    #[test]
    fn gap_notices_use_the_spec_wording() {
        let since = 1_785_000_000_000_000 - (1_785_000_000_000_000 % (60 * MIN)) + 36 * MIN;
        let (subject, body) =
            gap_notice_text(GapNotice::Opened { since }, "Checkout", "example.com");
        assert_eq!(subject, "[OpenObserve Synthetics] Monitoring gap: Checkout");
        assert_eq!(
            body,
            format!(
                "We could not test example.com from {}. This is a problem on our side. Your site was not tested.",
                utc_clock(since)
            )
        );
        assert!(
            utc_clock(since).ends_with(":36 UTC"),
            "{}",
            utc_clock(since)
        );
        let (subject, body) = gap_notice_text(
            GapNotice::Resumed {
                since,
                until: since + 23 * MIN,
            },
            "Checkout",
            "example.com",
        );
        assert_eq!(
            subject,
            "[OpenObserve Synthetics] Monitoring resumed: Checkout"
        );
        assert!(
            body.starts_with("We test example.com again. The monitoring gap lasted 23 minutes"),
            "{body}"
        );
    }

    #[test]
    fn gap_length_reads_naturally() {
        assert_eq!(gap_length(30 * 1_000_000), "less than a minute");
        assert_eq!(gap_length(MIN), "1 minute");
        assert_eq!(gap_length(23 * MIN), "23 minutes");
        assert_eq!(gap_length(60 * MIN), "1 hour");
        assert_eq!(gap_length(125 * MIN), "2 hours 5 minutes");
    }
}

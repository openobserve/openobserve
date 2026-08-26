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

//! Synthetics reaper — handles expired leases and stale pending checks.
//!
//! Runs every 30 seconds on scheduler nodes:
//!
//! - `requeue_expired`: resets expired leases back to Pending when the check has dispatch attempts
//!   left *and* is still inside its validity window.
//! - `dead_letter_expired`: marks every check that can no longer produce a probe result as Dead,
//!   **completes its run**, updates synthetic status to Failed, and writes failure records to
//!   synthetics_results and the triggers stream.
//! - `prune_stale`: backstop only — `dead_letter_expired` should have claimed these already.
//!
//! The invariant this module owes the rest of the system: **every job it terminates has its run
//! completed exactly once.** A run only completes when `jobs_done` reaches `job_count`, and the
//! only callers that move that counter are the probe ack, the dispatcher's failed invoke, and this
//! module. So a job the reaper terminates without accounting for is a run that stays open forever —
//! never completed, never notified, never removed.
//!
//! [`orphan`] lives here as a sibling because it answers the same question from the other side —
//! checks that produced no job at all — but it runs in its OWN task, spawned by `synthetics::init`.
//! Its scan does up to a thousand rows of outbound HTTP, and the invariant above cannot be left
//! waiting behind that.

pub mod orphan;

use std::time::Duration;

use infra::{
    db::get_orm_client_rw,
    table::{org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_runs},
};

use crate::MAX_DISPATCH_ATTEMPTS as MAX_ATTEMPTS;
const TICK: Duration = Duration::from_secs(30);

/// "Internal" meta org that OO uses for platform-level self-reporting streams.
const META_ORG: &str = "_meta";

pub async fn run() {
    tracing::info!("[synthetics reaper] started");

    loop {
        tokio::time::sleep(TICK).await;

        let db = get_orm_client_rw().await;

        let now_us = config::utils::time::now_micros();

        publish_backlog_metrics(db, now_us).await;

        match synthetics_jobs::requeue_expired(db, now_us, MAX_ATTEMPTS).await {
            Ok(n) if n > 0 => {
                tracing::info!("[synthetics reaper] requeued {n} expired checks")
            }
            Err(e) => tracing::error!("[synthetics reaper] requeue_expired: {e}"),
            _ => {}
        }

        match synthetics_jobs::dead_letter_expired(db, now_us, MAX_ATTEMPTS).await {
            Ok(rows) if !rows.is_empty() => {
                tracing::warn!(
                    "[synthetics reaper] dead-lettered {} checks that can no longer report",
                    rows.len()
                );
                for row in &rows {
                    handle_dead_letter(db, row).await;
                }
            }
            Err(e) => tracing::error!("[synthetics reaper] dead_letter_expired: {e}"),
            _ => {}
        }

        match synthetics_jobs::prune_stale(db, now_us).await {
            // Warn, not info: `dead_letter_expired` above should have claimed and
            // accounted for every one of these. Anything this deletes is a run
            // that will never complete.
            Ok(n) if n > 0 => {
                tracing::warn!(
                    "[synthetics reaper] pruned {n} stale pending checks that dead-lettering missed \
                     — their runs will not complete"
                )
            }
            Err(e) => tracing::error!("[synthetics reaper] prune_stale: {e}"),
            _ => {}
        }
    }
}

/// Publishes the pending-queue gauges.
///
/// Runs on the reaper's tick because this is already the loop that looks at the
/// queue as a whole, on the same nodes, at a cadence (30s) fine enough to see a
/// backlog build.
///
/// Gauges are RESET first. Prometheus gauges are sticky: a label set that stops
/// being reported keeps its last value forever, so a location that drains to zero
/// — or is deleted — would otherwise be alerted on indefinitely at whatever depth
/// it last had.
async fn publish_backlog_metrics(db: &sea_orm::DatabaseConnection, now_us: i64) {
    let rows = match synthetics_jobs::pending_backlog(db, now_us).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("[synthetics reaper] pending_backlog: {e}");
            return;
        }
    };

    config::metrics::SYNTHETICS_PENDING_JOBS.reset();
    config::metrics::SYNTHETICS_OLDEST_PENDING_AGE_SECONDS.reset();

    for row in &rows {
        let labels = [row.location.as_str(), row.pool.as_str()];
        config::metrics::SYNTHETICS_PENDING_JOBS
            .with_label_values(&labels)
            .set(row.pending);
        // `max(0)` because a check scheduled for the near future is queued ahead
        // of time by design; that is not negative lag.
        let age_secs = ((now_us - row.oldest_scheduled_ts) / 1_000_000).max(0);
        config::metrics::SYNTHETICS_OLDEST_PENDING_AGE_SECONDS
            .with_label_values(&labels)
            .set(age_secs);
    }
}

/// Called for each job the reaper terminated. Completes the job's run, updates
/// synthetic status, and writes to synthetics_results and triggers streams.
async fn handle_dead_letter(
    db: &sea_orm::DatabaseConnection,
    row: &synthetics_jobs::DeadLetteredRow,
) {
    let now_us = config::utils::time::now_micros();

    // Run accounting first, before anything that can bail out early.
    //
    // `increment_jobs_done` is the only thing that can bring `jobs_done` up to
    // `job_count`, and until it does, the run is never complete: it keeps no
    // `completed_at`, the UI shows it running forever, and — since the alerting
    // work — `resolve_alert` never evaluates, so the check's failure streak does
    // not move and no notification can fire. That made this the reaper's most
    // expensive omission: the dead-letter path is the one that exists to report
    // "we gave up", and it reported into a run that stayed open.
    //
    // Ordering is deliberate. The ingest-token lookup below returns early when
    // an org has no enabled token, so leaving the increment after it would let a
    // token problem — nothing to do with this job — orphan the run.
    //
    // 4 = Error on the SyntheticStatus scale that `increment_jobs_done` takes
    // (1=Passed, 2=Warning, 3=Failed, 4=Error), matching what the dispatcher
    // reports for a failed invoke. Note this is a *different* scale from
    // `synthetics_jobs.status`, where 4 means Failed.
    //
    // Exactly-once is the caller's guarantee: `dead_letter_expired` only returns
    // rows whose compare-and-swap it won, so one node accounts for one job.
    if let Err(e) = synthetics_runs::increment_jobs_done(db, &row.run_id, 4, now_us).await {
        tracing::error!(
            synthetics_id = %row.synthetics_id,
            run_id = %row.run_id,
            job_id = %row.id,
            "[synthetics reaper] increment_jobs_done: {e}"
        );
    }

    // The free-pool refund — SPEC §6.3, E10, item 2.3.
    //
    // Here for the same reason `increment_jobs_done` is here: everything below
    // this point can return early, and this job's reservation has nowhere else
    // to go. §6.3 reserves `configured x combos` at enqueue and reconciles it on
    // the ACK; a job the reaper terminates never acks, so without this the
    // reservation is held against a ONE-TIME grant (§6.1) forever — E10 states
    // it directly: *"Reaper requeues before the run | no ack => no bill; enqueue
    // deduct refunded."*
    //
    // Only `dead_letter_expired`'s rows reach here, and that is the whole set of
    // terminal paths this loop owns: `requeue_expired` puts a job BACK to
    // Pending, so it can still ack (or be dead-lettered later) and refunding it
    // would give the grant back under a job that then runs anyway.
    #[cfg(feature = "cloud")]
    refund_dead_letter(row).await;

    // Mark synthetic as Failed so the UI reflects the infra problem.
    //
    // "The UI" is every region's, not just this one's: the column is written
    // only where the check ran, so a dead-letter here left the other regions'
    // LIST showing the check as whatever they last saw, or "Unknown". The write
    // reports whether it changed anything, and only a change is published — a
    // check that is already in Error dead-letters silently, which is the common
    // case when a private agent has gone away and every run of every check it
    // served is expiring.
    match synthetics_checks::update_last_check_status(db, &row.synthetics_id, 4).await {
        Ok(true) => {
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
                && let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::synthetics_check_last_status(
                        &row.org_id,
                        &row.synthetics_id,
                        4,
                    )
                    .await
            {
                // This function returns nothing and its remaining work — the
                // results and triggers stream writes — is what actually reports
                // the dead letter. A failed publish must not stop it.
                tracing::warn!(
                    synthetics_id = %row.synthetics_id,
                    "[synthetics reaper] super-cluster last_check_status publish: {e}"
                );
            }
        }
        // Unchanged — the steady state, and deliberately silent.
        Ok(false) => {}
        Err(e) => {
            tracing::error!(
                synthetics_id = %row.synthetics_id,
                "[synthetics reaper] update_last_check_status: {e}"
            );
        }
    }

    // Fetch ingest token — needed for both stream writes.
    let ingest_token = match org_ingestion_tokens::find_default_enabled(&row.org_id).await {
        Ok(found) => match found {
            Some(t) => t.token,
            None => {
                tracing::warn!(
                    org_id = %row.org_id,
                    "[synthetics reaper] no enabled ingest token — skipping stream writes"
                );
                return;
            }
        },
        Err(e) => {
            tracing::error!(
                org_id = %row.org_id,
                "[synthetics reaper] ingest token lookup failed: {e}"
            );
            return;
        }
    };

    let api_endpoint = config::meta::synthetics::api_endpoint();
    // Say which of the three failures this was. "No probe ever claimed the job"
    // points at a dead agent or a location nothing polls; the other two point at
    // a probe that took the job and stopped talking. They need different
    // responses, so they should not read identically in the record.
    let error_msg = match row.reason {
        synthetics_jobs::DeadLetterReason::AttemptsExhausted => format!(
            "probe did not respond after {} dispatch attempts",
            row.dispatch_attempts
        ),
        synthetics_jobs::DeadLetterReason::Expired => format!(
            "probe held the check but did not respond before its schedule window closed \
             (after {} dispatch attempt(s)); the next scheduled run will retry",
            row.dispatch_attempts
        ),
        synthetics_jobs::DeadLetterReason::NeverDispatched => {
            "no probe claimed the check for this location before its schedule window closed"
                .to_string()
        }
    };

    write_results_stream(row, &ingest_token, &api_endpoint, now_us, &error_msg).await;
    write_triggers_stream(row, &ingest_token, &api_endpoint, now_us, &error_msg).await;
}

/// What one dead letter did to the org's one-time free step grant — SPEC §6.3,
/// E10.
#[cfg(feature = "cloud")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeadLetterRefund {
    /// The enqueue took nothing, so there is nothing to give back: this node
    /// does not meter, the location is a private agent (§7.1 gate 2, E13), the
    /// org is on an external contract (§7.3, E18), or the grant was already
    /// spent and the run went out as metered overage (E16).
    NothingReserved,
    /// The location registry could not say whose hardware ran this job, so
    /// whether anything was reserved is unknowable. Declining is the safe
    /// direction — see [`ReservationVerdict::VenueUnknown`].
    VenueUnknown,
    /// The reservation went back to the grant.
    Refunded(u64),
    /// This dead letter's key had already been applied. Not a failure: the
    /// grant already has the steps back.
    AlreadyRefunded(u64),
}

/// Whether the ENQUEUE took anything out of the grant for a job that has now
/// been dead-lettered, and how much — SPEC §7.1 gate 2 / §7.3, as pure
/// arithmetic.
///
/// This mirrors `scheduler::reserve_for_slot`, which is the only place a
/// synthetics job is ever enqueued, and it must keep mirroring it: the number
/// refunded here has to be the number reserved there, computed the same way,
/// or the grant drifts in whichever direction the two disagree.
///
/// One input it CANNOT mirror is whether `try_deduct` actually succeeded — no
/// column records it (SPEC §5 adds none), which is the same gap the ack has and
/// answers the same way: by the pool's state now. `remaining == 0` is exactly
/// the ack's [`crate::job_api::StepPoolView::Spent`], and reading it the same
/// way is what keeps the two paths in agreement. A job either acks or is
/// reaped; it must not be treated as funded by one and unfunded by the other.
#[cfg(feature = "cloud")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReservationVerdict {
    /// `configured x combos` came out of the grant and must go back.
    Reserved(u32),
    /// Nothing came out of it.
    Nothing,
    /// The registry could not answer. A lookup failure there is FLEET-WIDE
    /// (see `job_api::billing::resolve_venue`), so refunding on it would hand
    /// every free org steps back during a database outage. Declining instead
    /// loses at most one run's reservation per dead letter — and under a
    /// one-time grant that loss is PERMANENT (§11 **F8**), which is why the
    /// caller logs it at `error` (§9B.2 **A5**).
    VenueUnknown,
}

#[cfg(feature = "cloud")]
fn dead_letter_reservation(
    policy: crate::scheduler::PoolExhaustionPolicy,
    venue: crate::job_api::billing::Venue,
    remaining: u64,
    steps_configured: i32,
    combos: Option<u32>,
) -> ReservationVerdict {
    use crate::job_api::billing::Venue;

    // §7.3 first, and neither of these depends on the venue: an external
    // contract org is *"never pool-gated"* so its slots never even attempt a
    // reservation (E18/T36), and a spent grant means the enqueue's `try_deduct`
    // failed and the run went out holding nothing (E16/T31). Checking them
    // ahead of the registry also keeps an unreadable registry from being
    // reported as a lost refund for an org that had nothing to lose.
    if !crate::scheduler::pool_reserves(policy) || remaining == 0 {
        return ReservationVerdict::Nothing;
    }
    match venue {
        // §6.3's `configured x combos`, from the columns FROZEN on this job's
        // row — never from the live check, which may have been edited since
        // (E5). The same call `reserve_for_slot` made at enqueue.
        Venue::Public => ReservationVerdict::Reserved(crate::job_api::enqueue_reservation(
            steps_configured,
            combos,
        )),
        // §7.1 gate 2, E13/T17 — the customer's own hardware: no gate, no
        // deduct, no bill, and so nothing to give back.
        Venue::Private => ReservationVerdict::Nothing,
        Venue::Unresolved => ReservationVerdict::VenueUnknown,
    }
}

/// The refund for one dead letter, with every read already done — SPEC §6.3,
/// E10, item **2.3**.
///
/// Split from [`refund_dead_letter`] so the decision and the pool call are
/// testable without a database, a registry or an enterprise config.
///
/// ## Why a concurrent ack cannot cause a second refund
///
/// `dead_letter_expired` returns ONLY the rows whose per-row compare-and-swap
/// it won — `UPDATE ... SET status = 2 WHERE id = $1 AND status = $2`, where
/// `$2` is the status the SELECT saw. `ack_complete` is the same shape from the
/// other side: `UPDATE ... WHERE id = $1 AND status = 1`, returning `None` when
/// it matches nothing. Both are single-row updates guarded on the same column,
/// so the row lock serialises them:
///
///   * the reaper's CAS lands first => status is 2, the ack's UPDATE matches no row, `ack_complete`
///     returns `None`, and `ack` takes its stale-lease return with `pool_adjustment: None`. Only
///     the reaper moves the grant.
///   * the ack lands first => status is 3 or 4, the reaper's CAS requires the 0 or 1 it observed
///     and matches no row, so the row is never pushed onto `dead` and this function is never called
///     for it. Only the ack moves the grant.
///
/// That is the same guarantee that already makes `increment_jobs_done`
/// exactly-once here, and the refund rides it rather than inventing a second
/// one.
///
/// The idempotency key is the BACKSTOP behind it, not the primary guard: both
/// paths build it with [`crate::job_api::adjustment_key`] from the same four
/// columns of the same job row, so a refund and an ack reconcile for one job
/// collide on one key. The ledger behind that key is per-process
/// (`trial_quota::ADJUSTMENTS`) and the ack runs on API nodes while this runs on
/// scheduler nodes, so it cannot arbitrate BETWEEN them — the CAS above is what
/// does that. What the key does buy is that re-processing the same dead letter
/// in this process is free.
#[cfg(feature = "cloud")]
fn refund_dead_letter_with(
    gate: Option<(
        crate::pool::StepPoolHooks,
        crate::scheduler::PoolExhaustionPolicy,
    )>,
    venue: crate::job_api::billing::Venue,
    remaining: u64,
    row: &synthetics_jobs::DeadLetteredRow,
) -> DeadLetterRefund {
    // No pool on this node: an OSS build, `O2_SYNTHETICS_BILLING_ENABLED` off,
    // or a failed billing read. Nothing was reserved, so nothing is owed —
    // the same fail-open the enqueue takes.
    let Some((hooks, policy)) = gate else {
        return DeadLetterRefund::NothingReserved;
    };

    let steps = match dead_letter_reservation(
        policy,
        venue,
        remaining,
        row.steps_configured,
        crate::job_api::billing::frozen_combos(row.browser_devices.as_deref()),
    ) {
        ReservationVerdict::Reserved(steps) => u64::from(steps),
        ReservationVerdict::Nothing => return DeadLetterRefund::NothingReserved,
        ReservationVerdict::VenueUnknown => return DeadLetterRefund::VenueUnknown,
    };

    // SPEC §6.3's MUST, and the SAME key the ack would have built for this job:
    // all four values are columns of this one `synthetics_jobs` row, read here
    // off `DeadLetteredRow` and there off `LeasedRow`. Rebuilding
    // `scheduled_ts` from the schedule instead of reading the column is what
    // would break that — the slot is stamped once, at enqueue.
    let key = crate::job_api::adjustment_key(
        &row.synthetics_id,
        &row.location,
        row.scheduled_ts,
        &row.id,
    );
    if (hooks.dead_letter_refund)(&row.org_id, steps, &key) {
        DeadLetterRefund::Refunded(steps)
    } else {
        DeadLetterRefund::AlreadyRefunded(steps)
    }
}

/// Give back the reservation of a job that will never ack — SPEC §6.3, E10.
///
/// Returns nothing and can fail nothing: a refund that cannot be worked out
/// must not cost this job its dead letter, its run accounting or the rest of
/// the batch. See [`refund_dead_letter_with`] for the decision and for why a
/// concurrent ack cannot double-refund.
#[cfg(feature = "cloud")]
async fn refund_dead_letter(row: &synthetics_jobs::DeadLetteredRow) {
    // Resolved before the registry read so an unmetered node — the default,
    // since `O2_SYNTHETICS_BILLING_ENABLED` ships off — does no extra work per
    // dead letter.
    let gate = crate::scheduler::resolve_pool_gate(&row.org_id).await;
    let Some((hooks, _)) = gate else {
        return;
    };
    let venue = crate::job_api::billing::resolve_venue(&row.location).await;
    let remaining = (hooks.remaining)(&row.org_id);

    match refund_dead_letter_with(gate, venue, remaining, row) {
        // The steady state for every paid, contract and private-venue job.
        DeadLetterRefund::NothingReserved => {}
        DeadLetterRefund::VenueUnknown => {
            // §9B.2 **A5** — a pool adjustment that could not be applied is an
            // ERROR, because under a one-time grant (§6.1) the loss is
            // permanent and invisible to the customer until they run short.
            tracing::error!(
                synthetics_id = %row.synthetics_id,
                org_id = %row.org_id,
                job_id = %row.id,
                location = %row.location,
                "[synthetics reaper] dead letter: location is not in the registry, so its \
                 free-pool reservation cannot be refunded — the grant keeps it permanently"
            );
        }
        DeadLetterRefund::Refunded(steps) => {
            tracing::info!(
                synthetics_id = %row.synthetics_id,
                org_id = %row.org_id,
                job_id = %row.id,
                steps = steps,
                "[synthetics reaper] dead letter will never ack — refunding its free-pool \
                 reservation"
            );
        }
        DeadLetterRefund::AlreadyRefunded(steps) => {
            tracing::debug!(
                synthetics_id = %row.synthetics_id,
                job_id = %row.id,
                steps = steps,
                "[synthetics reaper] dead letter already refunded under its idempotency key"
            );
        }
    }
}

async fn write_results_stream(
    row: &synthetics_jobs::DeadLetteredRow,
    ingest_token: &str,
    api_endpoint: &str,
    now_us: i64,
    error_msg: &str,
) {
    let meta: infra::table::synthetics_jobs::JobMetadata =
        serde_json::from_str(&row.metadata).unwrap_or_default();
    let tags = serde_json::json!(meta.tags);
    let payload = serde_json::json!([{
        "_timestamp": now_us,
        "job_id": row.id,
        "run_id": row.run_id,
        // execution_id == job_id for reaped jobs (same fallback as job_api
        // resolve) so the UI can open the run-detail drawer for this row.
        "execution_id": row.id,
        "synthetics_id": row.synthetics_id,
        "synthetics_name": row.synthetics_name,
        "tags": tags,
        "org_id": row.org_id,
        "location": row.location,
        "status": "error",
        // A7: the job was dead-lettered without a probe ever running it.
        "error_source": "dispatch",
        "error": error_msg,
        "response_time_ms": 0,
        "dispatch_attempt": row.dispatch_attempts
    }]);
    let url = format!(
        "{}/api/{}/synthetics_results/_json",
        api_endpoint, row.org_id
    );
    let client = reqwest::Client::new();
    if let Err(e) = client
        .post(&url)
        .basic_auth("ingest", Some(ingest_token))
        .json(&payload)
        .send()
        .await
    {
        tracing::error!(
            synthetics_id = %row.synthetics_id,
            "[synthetics reaper] synthetics_results write failed: {e}"
        );
    }
}

/// Writes to both the org's triggers stream and the _meta org triggers stream.
async fn write_triggers_stream(
    row: &synthetics_jobs::DeadLetteredRow,
    ingest_token: &str,
    api_endpoint: &str,
    now_us: i64,
    error_msg: &str,
) {
    let trigger_record = serde_json::json!([{
        "_timestamp": now_us,
        "org": row.org_id,
        "module": "synthetics",
        "key": format!("{}/{}", row.synthetics_name, row.synthetics_id),
        "next_run_at": 0,
        "is_realtime": false,
        "is_silenced": false,
        "status": "failed",
        "start_time": now_us,
        "end_time": now_us,
        "dispatch_attempts": row.dispatch_attempts,
        "error": error_msg
    }]);

    let client = reqwest::Client::new();
    for org in [row.org_id.as_str(), META_ORG] {
        let url = format!("{}/api/{}/triggers/_json", api_endpoint, org);
        if let Err(e) = client
            .post(&url)
            .basic_auth("ingest", Some(ingest_token))
            .json(&trigger_record)
            .send()
            .await
        {
            tracing::error!(
                synthetics_id = %row.synthetics_id,
                org = %org,
                "[synthetics reaper] triggers stream write failed: {e}"
            );
        }
    }
}

// ── SPEC §6.3 / E10 — the free-pool refund, item 2.3 ─────────────────────────
//
// `cloud` only: the venue registry read, the exhaustion policy and the pool
// itself all live behind that feature (§8.1), so on an OSS or self-hosted
// Enterprise build there is nothing here to test.
#[cfg(all(test, feature = "cloud"))]
mod pool_refund_tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    };

    use infra::table::synthetics_jobs::{DeadLetterReason, DeadLetteredRow};

    use super::{
        DeadLetterRefund, ReservationVerdict, dead_letter_reservation, refund_dead_letter_with,
    };
    use crate::{
        job_api::billing::Venue,
        pool::StepPoolHooks,
        scheduler::{PoolExhaustionPolicy, PoolGate, reserve_for_slot},
    };

    // ── the fake pool ────────────────────────────────────────────────────────
    //
    // Process-global, because a `fn` pointer cannot capture. Same shape as
    // `scheduler`'s, plus a one-key ledger so the idempotency contract is
    // exercised rather than assumed.
    static FAKE_LOCK: Mutex<()> = Mutex::new(());
    static REFUNDED: AtomicU64 = AtomicU64::new(0);
    static REFUND_CALLS: AtomicU64 = AtomicU64::new(0);
    static LAST_KEY: Mutex<String> = Mutex::new(String::new());
    static LAST_ORG: Mutex<String> = Mutex::new(String::new());
    static SEEN_KEYS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    static POOL_ACCEPTS: AtomicBool = AtomicBool::new(true);

    fn fake_try_deduct(_org_id: &str, _steps: u64) -> bool {
        true
    }

    fn fake_refund(_org_id: &str, _steps: u64) {}

    fn fake_remaining(_org_id: &str) -> u64 {
        unreachable!("the pure decision takes `remaining` as data; the hook is only wiring")
    }

    /// The real `trial_quota::synthetics_steps_dead_letter_refund` contract:
    /// apply at most once per key, and report whether the grant moved.
    fn fake_dead_letter_refund(org_id: &str, steps: u64, idempotency_key: &str) -> bool {
        REFUND_CALLS.fetch_add(1, Ordering::Relaxed);
        *LAST_KEY.lock().unwrap_or_else(|e| e.into_inner()) = idempotency_key.to_string();
        *LAST_ORG.lock().unwrap_or_else(|e| e.into_inner()) = org_id.to_string();
        if !POOL_ACCEPTS.load(Ordering::Relaxed) {
            return false;
        }
        let mut seen = SEEN_KEYS.lock().unwrap_or_else(|e| e.into_inner());
        if seen.iter().any(|k| k == idempotency_key) {
            return false;
        }
        seen.push(idempotency_key.to_string());
        REFUNDED.fetch_add(steps, Ordering::Relaxed);
        true
    }

    const FAKE: StepPoolHooks = StepPoolHooks {
        try_deduct: fake_try_deduct,
        refund: fake_refund,
        remaining: fake_remaining,
        dead_letter_refund: fake_dead_letter_refund,
    };

    fn fake_pool() -> std::sync::MutexGuard<'static, ()> {
        let guard = FAKE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        REFUNDED.store(0, Ordering::Relaxed);
        REFUND_CALLS.store(0, Ordering::Relaxed);
        POOL_ACCEPTS.store(true, Ordering::Relaxed);
        LAST_KEY.lock().unwrap_or_else(|e| e.into_inner()).clear();
        LAST_ORG.lock().unwrap_or_else(|e| e.into_inner()).clear();
        SEEN_KEYS.lock().unwrap_or_else(|e| e.into_inner()).clear();
        guard
    }

    fn gate(policy: PoolExhaustionPolicy) -> Option<(StepPoolHooks, PoolExhaustionPolicy)> {
        Some((FAKE, policy))
    }

    fn last_key() -> String {
        LAST_KEY.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Two engine+device combinations, exactly as the scheduler freezes them.
    const TWO_COMBOS: &str = r#"[{"execution_id":"e1","engine":"chromium","device":"desktop"},{"execution_id":"e2","engine":"chromium","device":"mobile"}]"#;

    const SLOT_TS: i64 = 1_787_665_631_000_000;

    /// A dead letter for a browser check: 14 steps configured, 2 combos, so the
    /// enqueue reserved 28.
    fn dead_row(reason: DeadLetterReason) -> DeadLetteredRow {
        DeadLetteredRow {
            id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
            synthetics_id: "chk_1".to_string(),
            synthetics_name: "checkout journey".to_string(),
            org_id: "acme".to_string(),
            location: "aws-us-east-1".to_string(),
            scheduled_ts: SLOT_TS,
            steps_configured: 14,
            browser_devices: Some(TWO_COMBOS.to_string()),
            dispatch_attempts: 3,
            run_id: "3Fzn001XXXXXXXXXXXXXXXX".to_string(),
            metadata: "{}".to_string(),
            reason,
        }
    }

    /// Every way `dead_letter_expired` can terminate a job.
    ///
    /// The inner match is exhaustive and has no other purpose: a fourth
    /// `DeadLetterReason` stops COMPILING here, which is the only mechanism
    /// that reliably makes someone extend the list below. A bare array would
    /// go on compiling and the new terminal path would silently never be
    /// tested — and a terminal path nobody tests is a reservation nobody
    /// refunds.
    fn every_terminal_reason() -> [DeadLetterReason; 3] {
        fn exhaustive(reason: DeadLetterReason) {
            match reason {
                DeadLetterReason::AttemptsExhausted => {}
                DeadLetterReason::Expired => {}
                DeadLetterReason::NeverDispatched => {}
            }
        }
        let reasons = [
            DeadLetterReason::AttemptsExhausted,
            DeadLetterReason::Expired,
            DeadLetterReason::NeverDispatched,
        ];
        for reason in reasons {
            exhaustive(reason);
        }
        reasons
    }

    // ── the reservation, as pure arithmetic ──────────────────────────────────

    /// **E10.** A funded public slot reserved `configured x combos` at enqueue,
    /// and that is exactly what comes back.
    #[test]
    fn a_reaped_job_gives_back_configured_times_combos() {
        assert_eq!(
            dead_letter_reservation(
                PoolExhaustionPolicy::SubscriptionRequired,
                Venue::Public,
                10_000,
                14,
                Some(2),
            ),
            ReservationVerdict::Reserved(28),
        );
    }

    /// **The refunded amount IS the reserved amount, computed the same way.**
    ///
    /// Not "28 == 28" written twice: the enqueue's own `reserve_for_slot` is
    /// run over the same inputs and the two numbers are compared. A change to
    /// either formula that is not made to the other fails here, which is the
    /// only thing that keeps a refund from silently becoming a partial credit
    /// or a second charge.
    #[test]
    fn the_refund_is_the_same_number_the_enqueue_reserved() {
        let _guard = fake_pool();
        for (steps_configured, combos) in [
            (14, Some(2)),
            (14, Some(1)),
            (1, None),
            (50, None),
            (7, Some(12)),
        ] {
            let (verdict, reserved) = reserve_for_slot(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                "acme",
                steps_configured,
                combos,
                false,
            );
            assert_eq!(verdict, PoolGate::Run);
            assert_eq!(
                dead_letter_reservation(
                    PoolExhaustionPolicy::SubscriptionRequired,
                    Venue::Public,
                    10_000,
                    steps_configured,
                    combos,
                ),
                ReservationVerdict::Reserved(reserved),
                "the reaper must give back exactly what gate 3 took for \
                 ({steps_configured}, {combos:?})",
            );
        }
    }

    /// **T17 / E13.** A private agent is the customer's own hardware: §7.1 gate
    /// 2 gave it *"no gate, no deduct, no bill"*, so there is nothing to give
    /// back. Refunding here would credit a grant the org never spent.
    #[test]
    fn t17_a_private_venue_job_reserved_nothing_and_is_not_refunded() {
        assert_eq!(
            dead_letter_reservation(
                PoolExhaustionPolicy::SubscriptionRequired,
                Venue::Private,
                10_000,
                14,
                Some(2),
            ),
            ReservationVerdict::Nothing,
        );
    }

    /// **T36 / E18.** *"Never pool-gate"* — a contract org's enqueue never even
    /// attempted a reservation, whatever its grant looked like.
    #[test]
    fn t36_a_contract_org_job_reserved_nothing_and_is_not_refunded() {
        assert_eq!(
            dead_letter_reservation(
                PoolExhaustionPolicy::AdditionalCreditsRequired,
                Venue::Public,
                10_000,
                14,
                Some(2),
            ),
            ReservationVerdict::Nothing,
        );
    }

    /// **T31 / E16.** A spent grant means the enqueue's `try_deduct` failed and
    /// the run went out as metered overage holding nothing. The ack reads that
    /// same state as `StepPoolView::Spent` and does not reconcile; the reaper
    /// must not refund it either, or a paid org's grant grows every time an
    /// agent dies.
    #[test]
    fn t31_an_overage_run_reserved_nothing_and_is_not_refunded() {
        assert_eq!(
            dead_letter_reservation(
                PoolExhaustionPolicy::MeteredOverage,
                Venue::Public,
                0,
                14,
                Some(2),
            ),
            ReservationVerdict::Nothing,
        );
    }

    /// A registry that cannot answer is NOT a refund. A lookup failure there is
    /// fleet-wide, so refunding on it would hand every free org steps back at
    /// once, during the outage least likely to be noticed.
    #[test]
    fn an_unresolved_venue_is_not_refunded_and_is_reported() {
        assert_eq!(
            dead_letter_reservation(
                PoolExhaustionPolicy::SubscriptionRequired,
                Venue::Unresolved,
                10_000,
                14,
                Some(2),
            ),
            ReservationVerdict::VenueUnknown,
        );
    }

    /// …but an org that reserved nothing anyway is not reported as a lost
    /// refund just because the registry was down. §9B.2 **A5** pages on
    /// `VenueUnknown`, and a contract org has nothing to lose.
    #[test]
    fn an_unresolved_venue_for_an_org_that_never_reserves_is_silent() {
        for (policy, remaining) in [
            (PoolExhaustionPolicy::AdditionalCreditsRequired, 10_000),
            (PoolExhaustionPolicy::MeteredOverage, 0),
        ] {
            assert_eq!(
                dead_letter_reservation(policy, Venue::Unresolved, remaining, 14, Some(2)),
                ReservationVerdict::Nothing,
            );
        }
    }

    // ── the refund itself ────────────────────────────────────────────────────

    /// **E10 — every terminal reaper path refunds exactly the reservation.**
    ///
    /// All three reasons `dead_letter_expired` can return. They differ only in
    /// the message the reaper writes to the results stream; not one of them
    /// produces an ack, so every one of them owes the grant its steps back.
    #[test]
    fn e10_every_terminal_dead_letter_reason_refunds_the_reservation() {
        for reason in every_terminal_reason() {
            let _guard = fake_pool();
            let row = dead_row(reason);
            assert_eq!(
                refund_dead_letter_with(
                    gate(PoolExhaustionPolicy::SubscriptionRequired),
                    Venue::Public,
                    10_000,
                    &row,
                ),
                DeadLetterRefund::Refunded(28),
                "{reason:?} terminates the job without an ack and must refund",
            );
            assert_eq!(REFUNDED.load(Ordering::Relaxed), 28);
            assert_eq!(
                LAST_ORG.lock().unwrap_or_else(|e| e.into_inner()).as_str(),
                "acme",
            );
        }
    }

    /// **SPEC §6.3's MUST — the key is the ACK-SIDE key, byte for byte.**
    ///
    /// `job_api::ack` builds it as `adjustment_key(row.synthetics_id,
    /// check.location, check.scheduled_ts, row.id)` from a `LeasedRow`; this
    /// builds it from a `DeadLetteredRow`. Both are the same four columns of
    /// the same `synthetics_jobs` row, so the two keys must be equal — a key
    /// that differed would let one job be refunded by the reaper AND
    /// reconciled by a late ack.
    #[test]
    fn the_refund_key_is_the_key_the_ack_would_have_used() {
        let _guard = fake_pool();
        let row = dead_row(DeadLetterReason::Expired);
        refund_dead_letter_with(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            Venue::Public,
            10_000,
            &row,
        );
        assert_eq!(
            last_key(),
            crate::job_api::adjustment_key("chk_1", "aws-us-east-1", SLOT_TS, &row.id),
        );
        // And the slot really is the frozen column, not the wall clock (E25):
        // a row scheduled for a different slot keys differently.
        let mut other = dead_row(DeadLetterReason::Expired);
        other.scheduled_ts = SLOT_TS + 300_000_000;
        refund_dead_letter_with(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            Venue::Public,
            10_000,
            &other,
        );
        assert_ne!(
            last_key(),
            crate::job_api::adjustment_key("chk_1", "aws-us-east-1", SLOT_TS, &row.id)
        );
    }

    /// **T27 — the same dead letter processed twice refunds once.**
    ///
    /// The reaper is a periodic scan and its work is re-entrant by
    /// construction. The key is what makes a second pass free.
    #[test]
    fn t27_the_same_dead_letter_processed_twice_refunds_once() {
        let _guard = fake_pool();
        let row = dead_row(DeadLetterReason::AttemptsExhausted);
        let g = gate(PoolExhaustionPolicy::SubscriptionRequired);
        assert_eq!(
            refund_dead_letter_with(g, Venue::Public, 10_000, &row),
            DeadLetterRefund::Refunded(28),
        );
        assert_eq!(
            refund_dead_letter_with(g, Venue::Public, 10_000, &row),
            DeadLetterRefund::AlreadyRefunded(28),
        );
        assert_eq!(
            refund_dead_letter_with(g, Venue::Public, 10_000, &row),
            DeadLetterRefund::AlreadyRefunded(28),
        );
        assert_eq!(
            REFUNDED.load(Ordering::Relaxed),
            28,
            "the grant moved once, however many times the dead letter was seen",
        );

        // A DIFFERENT job of the same check and slot is a different key and
        // still refunds — a key that swallowed everything would pass the
        // assertion above while silently dropping every other refund.
        let mut sibling = dead_row(DeadLetterReason::AttemptsExhausted);
        sibling.id = "2MNfNTxePfZ1pnY5gKVLkwsVRXw".to_string();
        sibling.location = "aws-eu-west-1".to_string();
        assert_eq!(
            refund_dead_letter_with(g, Venue::Public, 10_000, &sibling),
            DeadLetterRefund::Refunded(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 56);
    }

    /// A job whose enqueue reserved nothing never reaches the pool AT ALL — the
    /// hook is not called, so it cannot burn an idempotency key either.
    #[test]
    fn a_job_that_reserved_nothing_never_touches_the_pool() {
        for (policy, venue, remaining) in [
            (
                PoolExhaustionPolicy::SubscriptionRequired,
                Venue::Private,
                10_000,
            ),
            (
                PoolExhaustionPolicy::AdditionalCreditsRequired,
                Venue::Public,
                10_000,
            ),
            (PoolExhaustionPolicy::MeteredOverage, Venue::Public, 0),
        ] {
            let _guard = fake_pool();
            let row = dead_row(DeadLetterReason::Expired);
            assert_eq!(
                refund_dead_letter_with(gate(policy), venue, remaining, &row),
                DeadLetterRefund::NothingReserved,
            );
            assert_eq!(REFUND_CALLS.load(Ordering::Relaxed), 0);
            assert_eq!(REFUNDED.load(Ordering::Relaxed), 0);
        }
    }

    /// An unresolved venue is reported, and still touches nothing.
    #[test]
    fn an_unresolved_venue_reports_without_touching_the_pool() {
        let _guard = fake_pool();
        let row = dead_row(DeadLetterReason::NeverDispatched);
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Unresolved,
                10_000,
                &row,
            ),
            DeadLetterRefund::VenueUnknown,
        );
        assert_eq!(REFUND_CALLS.load(Ordering::Relaxed), 0);
    }

    /// FAIL OPEN. No pool resolved — an OSS build, the master switch off, or a
    /// failed billing read — refunds nothing and reports nothing.
    #[test]
    fn no_pool_means_no_refund() {
        let _guard = fake_pool();
        let row = dead_row(DeadLetterReason::Expired);
        assert_eq!(
            refund_dead_letter_with(None, Venue::Public, 10_000, &row),
            DeadLetterRefund::NothingReserved,
        );
        assert_eq!(REFUND_CALLS.load(Ordering::Relaxed), 0);
    }

    /// A protocol job froze no `browser_devices`, so its reservation was one
    /// step. Refunding `configured x combos` with an invented combo count would
    /// over-credit every protocol check that ever dies.
    #[test]
    fn a_protocol_dead_letter_refunds_one_step() {
        let _guard = fake_pool();
        let mut row = dead_row(DeadLetterReason::Expired);
        row.browser_devices = None;
        row.steps_configured = 1;
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Public,
                10_000,
                &row,
            ),
            DeadLetterRefund::Refunded(1),
        );
    }

    /// **A pool that says no does not stop the reaper.**
    ///
    /// `false` from the hook is the only "no" the pool can give — the key is
    /// already in the ledger. `refund_dead_letter_with` still RETURNS, with a
    /// value, and the batch's remaining rows are refunded normally. It cannot
    /// panic and it cannot propagate: it has no error type to propagate one
    /// through, which is the property that keeps a billing decision from
    /// costing a job its dead letter.
    #[test]
    fn a_pool_that_declines_the_refund_does_not_stop_the_batch() {
        let _guard = fake_pool();
        POOL_ACCEPTS.store(false, Ordering::Relaxed);
        let row = dead_row(DeadLetterReason::Expired);
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Public,
                10_000,
                &row,
            ),
            DeadLetterRefund::AlreadyRefunded(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 0);

        // The next row of the same batch is unaffected.
        POOL_ACCEPTS.store(true, Ordering::Relaxed);
        let mut next = dead_row(DeadLetterReason::Expired);
        next.id = "2MNfNTxePfZ1pnY5gKVLkwsVRXx".to_string();
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Public,
                10_000,
                &next,
            ),
            DeadLetterRefund::Refunded(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 28);
    }

    /// **A refund that cannot be worked out does not stop the reaper either.**
    ///
    /// The registry read is the one input that can fail outright, and it fails
    /// FLEET-WIDE. The row is still terminated, still accounted for, and the
    /// next row of the same batch still gets its steps back — a database
    /// outage must not turn one lost refund into a batch of them.
    #[test]
    fn a_refund_that_cannot_be_worked_out_does_not_stop_the_batch() {
        let _guard = fake_pool();
        let unknown = dead_row(DeadLetterReason::Expired);
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Unresolved,
                10_000,
                &unknown,
            ),
            DeadLetterRefund::VenueUnknown,
        );

        let mut next = dead_row(DeadLetterReason::Expired);
        next.id = "2MNfNTxePfZ1pnY5gKVLkwsVRXy".to_string();
        assert_eq!(
            refund_dead_letter_with(
                gate(PoolExhaustionPolicy::SubscriptionRequired),
                Venue::Public,
                10_000,
                &next,
            ),
            DeadLetterRefund::Refunded(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 28);
    }

    // ── call sites ───────────────────────────────────────────────────────────

    /// **The refund is a CALL SITE, and losing it is silent.**
    ///
    /// Every function above still returns the right answer with the call
    /// deleted; what breaks is invisible until a free org runs short of a grant
    /// it never spent. So the site is counted, and its POSITION is pinned:
    /// everything after the ingest-token lookup in `handle_dead_letter` can
    /// return early, and a refund below that point is lost for every org that
    /// has no enabled token.
    #[test]
    fn the_refund_runs_before_anything_that_can_return_early() {
        let whole = include_str!("mod.rs");
        let src = &whole[..whole
            .find("\n#[cfg(all(test,")
            .expect("reaper/mod.rs must still end in its test module")];

        assert_eq!(
            src.matches(&["refund_dead", "_letter(row)"].concat())
                .count(),
            1,
            "`handle_dead_letter` must refund, exactly once per terminated job",
        );

        let body = &src[src
            .find("async fn handle_dead_letter(")
            .expect("handle_dead_letter moved")..];
        let refund = body
            .find(&["refund_dead", "_letter(row)"].concat())
            .expect("the refund must be inside handle_dead_letter");
        let bail = body
            .find("org_ingestion_tokens::find_default_enabled(")
            .expect("the token lookup moved");
        assert!(
            refund < bail,
            "the refund must precede the ingest-token lookup, which returns early",
        );
        let increment = body
            .find("synthetics_runs::increment_jobs_done(")
            .expect("the run accounting moved");
        assert!(
            increment < refund,
            "run accounting stays first — it is this module's stated invariant",
        );
    }

    /// **The reaper's key and the ack's key are the SAME key.**
    ///
    /// Both call [`crate::job_api::adjustment_key`], and both must feed it the
    /// same four columns of the same `synthetics_jobs` row — the reaper off
    /// `DeadLetteredRow`, the ack off `LeasedRow`. Two keys that differed would
    /// leave the §6.3 ledger unable to see that one job had already been paid
    /// back, and the ledger is the backstop behind the database
    /// compare-and-swap that normally keeps the two paths apart.
    ///
    /// Read across the two files because there is no runtime moment at which
    /// both keys exist: a job that acks is never dead-lettered, and a job that
    /// is dead-lettered never acks — which is the whole point.
    #[test]
    fn the_ack_and_the_reaper_key_on_the_same_four_columns() {
        let ack = include_str!("../job_api.rs");
        let at = ack
            .find("idempotency_key: adjustment_key(")
            .expect("the ack's key construction moved");
        let call = &ack[at..(at + 250).min(ack.len())];
        for arg in [
            "inputs.synthetics_id",
            "check.location",
            "check.scheduled_ts",
            "inputs.job_id",
        ] {
            assert!(call.contains(arg), "the ack's key must still carry {arg}");
        }
        // `inputs` is built by `inputs_from` FROM THE JOB ROW, so those two
        // arguments are the row's own columns and not the live check's — the
        // same source the reaper reads.
        assert!(ack.contains("synthetics_id: &row.synthetics_id,"));
        assert!(ack.contains("job_id: &row.id,"));
        assert_eq!(
            ack.matches("idempotency_key: adjustment_key(").count(),
            1,
            "one ack, one key",
        );

        // And the constructor itself still joins all four, in that order, on a
        // separator no location name can contain.
        assert_eq!(
            crate::job_api::adjustment_key("chk_1", "aws-us-east-1", SLOT_TS, "job-a"),
            format!("chk_1\u{1f}aws-us-east-1\u{1f}{SLOT_TS}\u{1f}job-a"),
        );
    }

    /// The refund reaches only the dead-letter arm of the reaper's loop.
    ///
    /// `handle_dead_letter` is where the refund lives, and it must be called
    /// for the rows `dead_letter_expired` returned and for nothing else — those
    /// are the rows whose compare-and-swap this node won, which is what makes
    /// one job's refund one node's business.
    #[test]
    fn the_refund_reaches_only_the_dead_letter_arm() {
        let whole = include_str!("mod.rs");
        let src = &whole[..whole.find("\n#[cfg(all(test,").unwrap()];
        assert_eq!(
            src.matches(&["handle_dead", "_letter("].concat()).count(),
            2,
            "one definition and one call site",
        );
        let at = src
            .find("synthetics_jobs::dead_letter_expired(")
            .expect("the dead-letter scan moved");
        let arm = &src[at..(at + 700).min(src.len())];
        assert!(
            arm.contains(&["handle_dead", "_letter(db, row).await"].concat()),
            "the refund must hang off the rows this node's CAS actually claimed",
        );
    }

    /// **`requeue_expired` must NOT refund.**
    ///
    /// It is the one reaper path that is not terminal: the job goes back to
    /// Pending and can still be leased, acked and billed. A refund there would
    /// give the grant back for a run that then happens anyway — the pool would
    /// pay for it twice over.
    #[test]
    fn a_requeue_is_not_a_terminal_path_and_does_not_refund() {
        let whole = include_str!("mod.rs");
        let src = &whole[..whole.find("\n#[cfg(all(test,").unwrap()];
        let at = src
            .find("synthetics_jobs::requeue_expired(")
            .expect("the requeue moved");
        let arm = &src[at..(at + 400).min(src.len())];
        assert!(
            !arm.contains("refund"),
            "a requeued job can still ack; refunding it would double-credit the grant",
        );
    }

    /// The pool is reached exactly one way from this module. A second call site
    /// would be a second refund for one job.
    #[test]
    fn the_pool_is_reached_through_exactly_one_call() {
        let whole = include_str!("mod.rs");
        let src = &whole[..whole.find("\n#[cfg(all(test,").unwrap()];
        assert_eq!(src.matches("(hooks.dead_letter_refund)(").count(), 1);
        assert_eq!(src.matches("(hooks.remaining)(").count(), 1);
        // And the key is built once, from the row's own four columns.
        assert_eq!(src.matches("adjustment_key(").count(), 1);
        for field in [
            "&row.synthetics_id,",
            "&row.location,",
            "row.scheduled_ts,",
            "&row.id,",
        ] {
            assert!(
                src.contains(field),
                "the idempotency key must be built from the job row's own {field}",
            );
        }
    }
}

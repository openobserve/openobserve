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

use config::META_ORG_ID;
use infra::{
    db::get_orm_client_rw,
    table::{org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_runs},
};

use crate::MAX_DISPATCH_ATTEMPTS as MAX_ATTEMPTS;
const TICK: Duration = Duration::from_secs(30);

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

    // The free-pool refund — SPEC §6.3, E10, item 2.3. Above the early returns
    // below, like `increment_jobs_done`: a job the reaper terminates never acks,
    // so without this its reservation is held against a ONE-TIME grant (§6.1)
    // forever. Only `dead_letter_expired`'s rows reach here; `requeue_expired`
    // puts a job BACK to Pending, and refunding it would double-credit the grant.
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
    /// The enqueue took nothing: unmetered node, private agent (§7.1 gate 2,
    /// E13), external contract (§7.3, E18), or a grant already spent (E16).
    NothingReserved,
    /// The registry could not say whose hardware ran this job, so whether
    /// anything was reserved is unknowable — see [`ReservationVerdict`].
    VenueUnknown,
    Refunded(u64),
    /// This key had already been applied — not a failure, the grant has it back.
    AlreadyRefunded(u64),
}

/// Whether the ENQUEUE took anything out of the grant for a job that has now
/// been dead-lettered, and how much — SPEC §7.1 gate 2 / §7.3, as pure
/// arithmetic.
///
/// Mirrors `scheduler::reserve_for_slot`, the only place a job is enqueued, and
/// must keep mirroring it: the number refunded here has to be the number
/// reserved there, computed the same way, or the grant drifts. The one input it
/// cannot mirror is whether `try_deduct` succeeded — no column records it — so
/// it reads the pool's state now, exactly as the ack does: `remaining == 0` is
/// the ack's [`crate::job_api::StepPoolView::Spent`]. A job must not be treated
/// as funded by one path and unfunded by the other.
#[cfg(feature = "cloud")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReservationVerdict {
    /// `configured x combos` came out of the grant and must go back.
    Reserved(u32),
    Nothing,
    /// The registry could not answer. That failure is FLEET-WIDE, so refunding
    /// on it would hand every free org steps back at once. Declining loses one
    /// run's reservation, permanently under a one-time grant (§11 **F8**) —
    /// hence the caller's `error` log (§9B.2 A5).
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

    // §7.3 first, venue-independent: a contract org never attempts a reservation
    // (E18/T36) and a spent grant means `try_deduct` failed at enqueue (E16/T31).
    // Ahead of the registry, so an unreadable one is not a reported lost refund.
    if !crate::scheduler::pool_reserves(policy) || remaining == 0 {
        return ReservationVerdict::Nothing;
    }
    match venue {
        // §6.3's `configured x combos`, from the columns FROZEN on this job's
        // row — never the live check, which may have been edited since (E5).
        Venue::Public => ReservationVerdict::Reserved(crate::job_api::enqueue_reservation(
            steps_configured,
            combos,
        )),
        // §7.1 gate 2, E13/T17 — customer hardware: no deduct, so nothing back.
        Venue::Private => ReservationVerdict::Nothing,
        Venue::Unresolved => ReservationVerdict::VenueUnknown,
    }
}

/// The refund for one dead letter, with every read already done — SPEC §6.3,
/// E10, item **2.3**. Split from [`refund_dead_letter`] so the decision and the
/// pool call are testable without a database, a registry or a config.
///
/// **A job settles exactly once — by ack or by dead letter, never both.** Both
/// paths are single-row compare-and-swaps on `status`, so the row lock
/// serialises them: `dead_letter_expired` returns only rows whose CAS it won, so
/// a later `ack_complete` matches nothing and returns `pool_adjustment: None`;
/// if the ack lands first this is never called for that row.
///
/// The idempotency key is the BACKSTOP, not the primary guard: its ledger is
/// per-process and the two paths run on different node types, so it cannot
/// arbitrate between them — it only makes re-processing here free.
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
    // or a failed billing read. Nothing reserved, nothing owed — fail open.
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

    // SPEC §6.3's MUST, and the SAME key the ack would have built: all four
    // values are columns of this one `synthetics_jobs` row. Rebuilding
    // `scheduled_ts` from the schedule instead of reading it would break that.
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
/// Returns nothing and can fail nothing: a refund that cannot be worked out must
/// not cost this job its dead letter, its run accounting or the rest of the
/// batch. See [`refund_dead_letter_with`] for the decision.
#[cfg(feature = "cloud")]
async fn refund_dead_letter(row: &synthetics_jobs::DeadLetteredRow) {
    // Before the registry read, so an unmetered node — the default, since
    // `O2_SYNTHETICS_BILLING_ENABLED` ships off — does no extra work here.
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
            // §9B.2 **A5** — an unappliable adjustment is an ERROR: under a
            // one-time grant (§6.1) the loss is permanent and invisible.
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
    for org in [row.org_id.as_str(), META_ORG_ID] {
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

// `cloud` only: registry, policy and pool all live behind that feature (§8.1).
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

    // Process-global, because a `fn` pointer cannot capture. The one-key ledger
    // is what exercises the idempotency contract rather than assuming it.
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

    /// The real contract: apply at most once per key, report whether it moved.
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
    /// The inner match exists only to be exhaustive: a fourth `DeadLetterReason`
    /// stops COMPILING here, where a bare array would go on compiling with the
    /// new terminal path untested — a reservation nobody refunds.
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

    /// **E10.** What a funded public slot reserved is what comes back.
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

    /// Not "28 == 28" twice: the enqueue's own `reserve_for_slot` runs over the
    /// same inputs, so changing one formula and not the other fails here rather
    /// than becoming a silent partial credit.
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

    /// **T17 / E13.** §7.1 gate 2 gives a private agent no deduct, so a refund
    /// here would credit a grant the org never spent.
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

    /// **T36 / E18.** A contract org is never pool-gated, so its enqueue never
    /// reserved, whatever its grant looked like.
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

    /// **T31 / E16.** A spent grant means `try_deduct` failed and the run went
    /// out as metered overage holding nothing. The ack reads that state as
    /// `StepPoolView::Spent` and does not reconcile; nor may the reaper refund.
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

    /// A registry that cannot answer is NOT a refund: the failure is fleet-wide,
    /// so refunding on it would hand every free org steps back at once.
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

    /// …but §9B.2 **A5** pages on `VenueUnknown`, so an org that reserved
    /// nothing anyway must not be reported as a lost refund.
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

    /// All three reasons differ only in the message written to the results
    /// stream; none produces an ack, so each owes the grant its steps (E10).
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

    /// **SPEC §6.3's MUST — the key is the ACK-SIDE key, byte for byte.** The
    /// ack builds it from a `LeasedRow`, this from a `DeadLetteredRow`, both the
    /// same four columns of one `synthetics_jobs` row; a key that differed would
    /// let one job be refunded here AND reconciled by a late ack.
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

    /// **T27.** The reaper is a periodic scan; the key is what makes a second
    /// pass over the same dead letter free.
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

        // A DIFFERENT job of the same check and slot keys differently and still
        // refunds — an over-broad key would pass the assertion above anyway.
        let mut sibling = dead_row(DeadLetterReason::AttemptsExhausted);
        sibling.id = "2MNfNTxePfZ1pnY5gKVLkwsVRXw".to_string();
        sibling.location = "aws-eu-west-1".to_string();
        assert_eq!(
            refund_dead_letter_with(g, Venue::Public, 10_000, &sibling),
            DeadLetterRefund::Refunded(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 56);
    }

    /// The hook is not called at all, so it cannot burn an idempotency key.
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

    /// A protocol job froze no `browser_devices`, so its reservation was 1 step.
    /// An invented combo count would over-credit every protocol check that dies.
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

    /// `false` from the hook is the only "no" the pool can give, and there is no
    /// error type to propagate: a billing decision cannot cost a job its dead
    /// letter.
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

    /// The registry read is the one input that can fail outright, and it fails
    /// FLEET-WIDE: a database outage must not turn one lost refund into a batch.
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

    /// Losing the call site is silent — every function above still returns the
    /// right answer. Its POSITION is pinned too: everything after the
    /// ingest-token lookup can return early, so a refund below that point is
    /// lost for every org with no enabled token.
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

    /// Both sides must feed [`crate::job_api::adjustment_key`] the same four
    /// columns of the same `synthetics_jobs` row, or the §6.3 ledger cannot see
    /// that one job was already paid back. Read across the two files because no
    /// runtime moment has both keys: a job that acks is never dead-lettered.
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
        // arguments are the row's own columns, not the live check's.
        assert!(ack.contains("synthetics_id: &row.synthetics_id,"));
        assert!(ack.contains("job_id: &row.id,"));
        assert_eq!(
            ack.matches("idempotency_key: adjustment_key(").count(),
            1,
            "one ack, one key",
        );

        // Still all four, in order, on a separator no location name can contain.
        assert_eq!(
            crate::job_api::adjustment_key("chk_1", "aws-us-east-1", SLOT_TS, "job-a"),
            format!("chk_1\u{1f}aws-us-east-1\u{1f}{SLOT_TS}\u{1f}job-a"),
        );
    }

    /// `handle_dead_letter` holds the refund and must be called for the rows
    /// `dead_letter_expired` returned and nothing else — the rows whose CAS this
    /// node won.
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

    /// **`requeue_expired` must NOT refund.** It is the one non-terminal reaper
    /// path — the job goes back to Pending and can still ack, so a refund there
    /// double-credits the grant.
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

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
//! Its scan is a thousand-row table read, and the invariant above cannot be left waiting behind
//! that.

pub mod orphan;

use std::time::Duration;

use config::meta::self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType};
use infra::{
    db::get_orm_client_rw,
    table::{org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_runs},
};

use crate::{MAX_DISPATCH_ATTEMPTS as MAX_ATTEMPTS, alerting::ERROR_SOURCE_DISPATCH};
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

    // Above the token lookup, which returns early: the triggers half needs no token.
    usage_reporting::publish_triggers_usage(dead_letter_trigger(row, now_us, &error_msg));

    let ingest_token = match org_ingestion_tokens::find_default_enabled(&row.org_id).await {
        Ok(found) => match found {
            Some(t) => t.token,
            None => {
                tracing::warn!(
                    org_id = %row.org_id,
                    "[synthetics reaper] no enabled ingest token — the dead letter's result \
                     row was not recorded"
                );
                return;
            }
        },
        Err(e) => {
            tracing::error!(
                org_id = %row.org_id,
                "[synthetics reaper] ingest token lookup failed, the dead letter's result row \
                 was not recorded: {e}"
            );
            return;
        }
    };

    let api_endpoint = config::meta::synthetics::api_endpoint();

    write_results_stream(row, &ingest_token, &api_endpoint, now_us, &error_msg).await;
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
        "error_source": ERROR_SOURCE_DISPATCH,
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

/// The `triggers` row one dead letter leaves — the half an alert rule reads.
///
/// `retries` is where `dispatch_attempts` survives the translation: `TriggerData`
/// has no field of that name.
fn dead_letter_trigger(
    row: &synthetics_jobs::DeadLetteredRow,
    now_us: i64,
    error: &str,
) -> TriggerData {
    TriggerData {
        _timestamp: now_us,
        org: row.org_id.clone(),
        module: TriggerDataType::Synthetics,
        key: format!("{}/{}", row.synthetics_name, row.synthetics_id),
        status: RunOutcome::Error,
        start_time: now_us,
        end_time: now_us,
        retries: row.dispatch_attempts,
        error: Some(error.to_string()),
        // `orphan`, `dispatch`, `quota` and `trial` share this stream and this `status`.
        error_source: Some(ERROR_SOURCE_DISPATCH.to_string()),
        location: Some(row.location.clone()),
        ..TriggerData::default()
    }
}

#[cfg(test)]
mod tests {
    use config::meta::self_reporting::usage::{RunOutcome, TriggerDataType};
    use infra::table::synthetics_jobs::{DeadLetterReason, DeadLetteredRow};

    use super::dead_letter_trigger;
    use crate::{
        alerting::ERROR_SOURCE_DISPATCH,
        test_source::{block_from, code_only, production},
    };

    fn dead_lettered_row() -> DeadLetteredRow {
        DeadLetteredRow {
            id: "job_1".to_string(),
            synthetics_id: "chk_1".to_string(),
            synthetics_name: "checkout journey".to_string(),
            org_id: "acme".to_string(),
            location: "us-east-1".to_string(),
            scheduled_ts: 1_787_665_631_000_000,
            steps_configured: 14,
            browser_devices: None,
            dispatch_attempts: 3,
            run_id: "run_1".to_string(),
            metadata: String::new(),
            reason: DeadLetterReason::AttemptsExhausted,
        }
    }

    /// Byte range of the brace-balanced block opened after `needle`.
    fn block_after(src: &str, needle: &str) -> (usize, usize) {
        let at = src
            .find(needle)
            .unwrap_or_else(|| panic!("`{needle}` moved"));
        block_from(src, at)
    }

    /// `dead_letter_expired` returns only the rows this node's CAS won.
    #[test]
    fn the_dead_letter_runs_only_for_rows_this_node_claimed() {
        // Assembled at runtime so this test's own text cannot satisfy the scan.
        let handler = ["handle_dead", "_letter("].concat();
        let src = code_only(production(include_str!("mod.rs")));
        assert_eq!(
            src.matches(handler.as_str()).count(),
            2,
            "one definition and one call site — a second writes a duplicate dead letter for a \
             job another node owns",
        );

        let (open, end) = block_after(&src, "synthetics_jobs::dead_letter_expired(");
        assert!(
            src.match_indices(handler.as_str())
                .any(|(at, _)| at > open && at < end),
            "the call moved off the CAS-claimed rows, so this node dead-letters a job it does \
             not own",
        );
    }

    /// The ingest-token lookup returns early for an org with no enabled token.
    #[test]
    fn run_accounting_precedes_anything_that_can_return_early() {
        let src = production(include_str!("mod.rs"));
        let (open, end) = block_after(src, &["async fn handle_dead", "_letter("].concat());
        let body = &src[open..end];
        let increment = body
            .find("synthetics_runs::increment_jobs_done(")
            .expect("the run accounting left handle_dead_letter");
        let bail = body
            .find("org_ingestion_tokens::find_default_enabled(")
            .expect("the ingest-token lookup left handle_dead_letter");
        assert!(
            increment < bail,
            "an org with no enabled token returns before the increment, so `jobs_done` never \
             reaches `job_count` and the run stays open forever",
        );
        let publish = body
            .find(&["publish_triggers", "_usage("].concat())
            .expect("the triggers half left handle_dead_letter");
        assert!(
            publish < bail,
            "the triggers half needs no ingest token, so an org that has none must still get it",
        );
    }

    /// §11.3: all three failure paths share one stream and one status, separable only by source.
    #[test]
    fn the_dispatch_dead_letter_keeps_every_field_its_json_carried() {
        let row = dead_lettered_row();
        let trigger = dead_letter_trigger(&row, 42, "no dispatch attempts left");

        assert_eq!(trigger.error_source.as_deref(), Some(ERROR_SOURCE_DISPATCH));
        assert_eq!(
            trigger.retries, row.dispatch_attempts,
            "`TriggerData` has no field named `dispatch_attempts`, so the count survives the \
             translation only as `retries`",
        );
        assert_eq!(trigger.module, TriggerDataType::Synthetics);
        assert_eq!(trigger.status, RunOutcome::Error);
        assert_eq!(trigger.org, "acme");
        assert_eq!(trigger.key, "checkout journey/chk_1");
        assert_eq!(trigger.error.as_deref(), Some("no dispatch attempts left"));
        assert_eq!(trigger._timestamp, 42);
        assert_eq!(trigger.start_time, 42);
        assert_eq!(trigger.end_time, 42);

        let wire = serde_json::to_value(&trigger).expect("the dead-letter row must serialize");
        assert_eq!(
            wire["status"], "error",
            "an alert rule matches the SERIALIZED value, and this row writes `failed` today",
        );
    }

    /// The `synthetics_results` row and the `triggers` row of one dead letter, one source value.
    #[test]
    fn the_dead_letters_two_rows_carry_the_same_error_source() {
        let src = code_only(production(include_str!("mod.rs")));
        // Assembled at runtime so this test's own text cannot satisfy the scan.
        let literal = ["\"dis", "patch\""].concat();
        assert!(
            !src.contains(literal.as_str()),
            "a bare {literal} in either row drifts from the other the moment one is edited, and \
             §11.3's three paths share one stream and one status — `error_source` is all that \
             separates them",
        );
        let constant = ["ERROR_SOURCE", "_DISPATCH"].concat();
        for producer in ["fn write_results_stream", "fn dead_letter_trigger"] {
            let (open, end) = block_after(&src, producer);
            assert!(
                src[open..end].contains(constant.as_str()),
                "`{producer}` must name {constant}: U-12's alert rule filters on the value, so a \
                 row carrying a different one is invisible to it",
            );
        }
    }
}

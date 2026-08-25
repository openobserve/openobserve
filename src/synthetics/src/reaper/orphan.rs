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

//! Orphan detection — "the scheduler is up and is not claiming these".
//!
//! An enabled check whose slot is further in the past than several of its own
//! intervals is one nobody took. That produces no error, no job and no result
//! record, so it is invisible to every other failure path in this module: those
//! all start from a job that exists.
//!
//! ## What this catches
//!
//! A scheduler task that is alive in this process but has stopped claiming
//! work. Most concretely a poison row: `claim_due` maps its batch through the
//! fallible `DueCheck::try_from` and `collect::<Result<..>>()?`
//! (`synthetics_checks.rs`), so ONE row with an unparseable `synthetics_type`
//! fails the claim for the entire fleet, silently, every tick. Nothing else
//! reports that. `OrphanCandidate::from` is infallible for exactly this reason
//! — the detector has to survive the row that broke the scheduler.
//!
//! Also: a wedged or panicked scheduler task, a `next_run_at` that some path
//! left in the past, and a claim that keeps failing against the database.
//!
//! ## What this CANNOT catch, and why
//!
//! It shares fate with what it watches, and in a super cluster it shares it
//! twice over. `synthetics::init()` is gated on `LOCAL_NODE.is_scheduler()`, so
//! this task only exists next to a scheduler, and `fetch_overdue` reads only the
//! local region's database. A region with no scheduler therefore has no detector
//! either: every check in it is orphaned and nobody is scanning. The same holds
//! for a scheduler region that died, a half-completed scheduler move, and a
//! deployment that never had one.
//!
//! The second gate is the job-cluster claim (`synthetics::should_start`): with a
//! super cluster, `init` starts these workers only in the cluster that holds it.
//! That is the same fate-sharing and it is deliberate — the deferring region
//! never schedules, so every replicated check there is *by construction* past
//! its slot, and a detector running in it would report the entire fleet as
//! orphaned every pass. Exactly one region scans, which is also exactly the
//! number that can say anything true about whether a check was claimed. The cost
//! is that a region falling behind on replication is invisible to the detector,
//! and that a job cluster which cannot read the claim at all (fail-closed, see
//! `synthetics::holds_job_cluster_claim`) starts no detector anywhere.
//!
//! Those are real failure modes and this module does not see them. The signal
//! for them is `SYNTHETICS_ORPHAN_SCANS_TOTAL`, incremented once per scan and
//! scraped from outside the region: `rate(...) == 0` is the only statement
//! about a dead region that a record written *by* that region structurally
//! cannot make — and it is what makes the fail-closed case above observable
//! rather than silent.
//!
//! ## Known limitation: duplicate reports without a cluster view
//!
//! Every sibling write path in the reaper is arbitrated in SQL. This one cannot
//! be — there is no row to claim — so it uses leader election over the online
//! scheduler nodes, the same election `alert_group_reaper` and
//! `alert_eval_ledger_reaper` use. That election falls back to "assume single
//! node and do the work" when the cluster view is unavailable, so during a
//! coordinator outage every replica reports and the same check lands in the
//! triggers stream N times, each replica holding its own cooldown map.
//! Deliberate: a duplicate report is recoverable, a missed one is the defect
//! this exists to prevent. `SYNTHETICS_ORPHANED_CHECKS` is per-node and so is
//! correct on whichever node published it.
//!
//! That election is *within* one cluster and cannot arbitrate across regions —
//! the cluster view it reads is region-local. The job-cluster gate above sits
//! upstream of it and is what bounds the duplicate to N nodes rather than N
//! nodes x N regions.
//!
//! ## Why `next_run_at = 0` is not simply skipped
//!
//! `synthetics_checks::create` stores `next_run_at = start.unwrap_or(0)`, and
//! `start` is optional, so an ordinary create leaves 0 — which means "fire
//! immediately". A live scheduler drains that within one tick; a wedged one
//! leaves it at 0 forever. Skipping those rows outright would blind this module
//! to the failure it is best placed to see. The grace window is anchored on the
//! newest evidence that anything touched the check ([`anchor_us`]) instead, so
//! a just-created check stays quiet and one that has sat at 0 for several
//! intervals does not.

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use config::{cluster::LOCAL_NODE, meta::synthetics::SyntheticFrequency};
use infra::{
    db::get_orm_client_ro,
    table::{org_ingestion_tokens, synthetics_checks, synthetics_checks::OrphanCandidate},
};

use super::META_ORG;
use crate::alerting::ERROR_SOURCE_ORPHAN;

/// How many of a check's OWN intervals may elapse past its anchor before we call
/// it orphaned. 3 tolerates one missed slot plus jitter without alerting on noise.
const ORPHAN_INTERVALS: i64 = 3;

/// Absolute floor on the grace window, whatever the check's interval says.
///
/// `MIN_INTERVAL_SECS` is 1, so a `Seconds x 1` check is creatable and three of
/// its intervals is 3 seconds — shorter than the scheduler's own 5s `TICK`,
/// never mind the fan-out that follows it or this detector's 5-minute cadence.
/// A perfectly healthy check of that shape therefore sits above the threshold
/// for most of every cycle and alerts once an hour forever.
///
/// A floor is needed at all because the threshold is expressed in the check's
/// units while the machinery serving it runs on the deployment's. Below that
/// floor the ratio inverts and the measure stops describing the system.
const MIN_GRACE_US: i64 = 300 * 1_000_000; // 5 min

/// Most this scan will pull in one pass.
const SCAN_LIMIT: u64 = 1_000;

/// Most reports one pass will write. Beyond this the remainder is logged and
/// left for a later pass — the cooldown map only records what was delivered, so
/// nothing carries over as silence, and a fleet-wide failure cannot turn one
/// pass into a thousand sequential HTTP round trips.
const MAX_REPORTS_PER_PASS: usize = 200;

/// Wall-clock ceiling on the reporting phase.
///
/// [`MAX_REPORTS_PER_PASS`] alone bounds the pass at 200 x 2 writes x
/// [`HTTP_TIMEOUT`], which is over an hour if the ingest endpoint is accepting
/// connections and never answering. Passes cannot overlap, so that is an hour
/// with no scan — the detector would be down in exactly the way it is supposed
/// to make visible. Which orgs get served under either limit is arbitrary; the
/// deferred ones keep no cooldown, so the next pass picks them up.
const REPORT_BUDGET: Duration = Duration::from_secs(60);

/// Minimum gap between two reports for the same check.
const RENOTIFY_AFTER_US: i64 = 3_600 * 1_000_000; // 1h

/// How often the scan runs. Deliberately NOT the reaper's 30s tick: the
/// threshold is measured in multiples of a check's own interval and floored at
/// [`MIN_GRACE_US`], so a finer cadence buys no earlier detection and costs a
/// full table scan every 30 seconds.
const ORPHAN_TICK: Duration = Duration::from_secs(300);

/// Ceiling on one stream write. `reqwest`'s default is no timeout at all, which
/// is what made running this inline on the reaper's tick unsafe.
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether orphan detection should run, read fresh on every pass.
pub fn orphan_detection_enabled() -> bool {
    config::get_config().synthetics.orphan_detection_enabled
}

/// The instant this check is measured against: the newest evidence that
/// anything touched it.
///
/// All three anchors, not just `next_run_at`. Validation accepts a `start` up
/// to 15 minutes in the past and `create` writes `next_run_at = start`, so a
/// brand-new healthy check can be born already outside its own grace window;
/// taking the max keeps `updated_at` as the floor for that case. `next_run_at`
/// still wins for a scheduled check, since it is the newest of the three.
///
/// `None` when nothing is set: all-zero anchors would make the check look ~56
/// years overdue and alert unconditionally.
fn anchor_us(c: &OrphanCandidate) -> Option<i64> {
    let anchor = c.next_run_at.max(c.last_triggered_at).max(c.updated_at);
    (anchor > 0).then_some(anchor)
}

/// The instant past which the check counts as orphaned.
///
/// Interval frequencies are `anchor + N x interval`. Cron walks N SUCCESSIVE
/// slots instead of multiplying the first gap, because a clustered schedule
/// like `0 0,1 * * * *` has a 60-second first gap and an hour-long second one —
/// multiplying would fire after a single missed slot, violating the tolerance
/// [`ORPHAN_INTERVALS`] claims to provide.
///
/// The other direction is inherent to a threshold stated in a check's own
/// intervals and is not worth fixing: a `MON-FRI 09:00` cron yields a window of
/// roughly nine days, `Feb 29` yields years. A sparse schedule genuinely has
/// nothing to be late against on a shorter horizon, and inventing a wall-clock
/// deadline for it would alert every weekend.
///
/// `None` when no deadline can be computed. An undeterminable interval must NOT
/// produce an alert: there is no threshold to be late against, and inventing
/// one is how a detector earns a mute.
fn grace_deadline_us(freq: &SyntheticFrequency, tz_offset: i32, anchor_us: i64) -> Option<i64> {
    // `interval_secs()` clamps each unit with `.max(1)`, so a 0 or negative
    // stored interval yields one of that UNIT — one second for `Seconds`, sixty
    // for `Minutes` — never a zero window. [`MIN_GRACE_US`] then dominates all
    // of those anyway; the clamp only guarantees the arithmetic stays positive.
    let secs = freq.interval_secs();
    let deadline = if secs > 0 {
        anchor_us.checked_add(secs.checked_mul(ORPHAN_INTERVALS)?.checked_mul(1_000_000)?)?
    } else {
        let mut slot = anchor_us;
        for _ in 0..ORPHAN_INTERVALS {
            let next = freq.next_run_at(slot, tz_offset).ok()?;
            if next <= slot {
                return None;
            }
            slot = next;
        }
        slot
    };
    Some(deadline.max(anchor_us.checked_add(MIN_GRACE_US)?))
}

/// How long the check has been unscheduled, or `None` if it is not orphaned.
///
/// The comparison is strictly-greater: a check landing exactly on its deadline
/// is still inside the window, because falling one whole slot behind under
/// backlog is normal and alerting on it is how this gets muted.
fn overdue_by_us(c: &OrphanCandidate, now_us: i64) -> Option<i64> {
    let anchor = anchor_us(c)?;
    let deadline = grace_deadline_us(&c.frequency, c.tz_offset, anchor)?;
    (now_us > deadline).then_some(now_us - anchor)
}

/// Prunes the cooldown map and groups what is still due for a report by org.
///
/// Pure — no I/O, no clock, no metrics — because it holds the only state in the
/// module and every interesting case (recovery, re-orphaning inside the hour, a
/// shuffled batch) is a sequence of calls rather than a single one.
///
/// `seen` is every id the query returned, orphaned or not. The distinction is
/// load-bearing: an id in this batch that is no longer orphaned has recovered
/// and its cooldown should be dropped, but an id ABSENT from the batch says
/// nothing at all. The scan is truncated at [`SCAN_LIMIT`] ordered by
/// `next_run_at`, and in the target scenario a thousand rows tie at 0 with no
/// stable tie-break in Postgres — so batch membership shuffles between passes,
/// and pruning on absence would re-report the same check minutes apart against
/// a one-hour cooldown.
///
/// Entries also expire once they are older than [`RENOTIFY_AFTER_US`]: they can
/// no longer suppress anything, and dropping them is what bounds the map.
fn plan_reports<'a>(
    orphans: &'a [(OrphanCandidate, i64)],
    seen: &HashSet<String>,
    last_reported: &mut HashMap<String, i64>,
    now_us: i64,
) -> HashMap<&'a str, Vec<&'a (OrphanCandidate, i64)>> {
    let currently_orphaned: HashSet<&str> = orphans.iter().map(|(c, _)| c.id.as_str()).collect();

    // Prune before filtering, not after: pruning is what lets a check that
    // recovered and re-orphaned within the hour be reported again.
    last_reported.retain(|id, ts| {
        now_us - *ts < RENOTIFY_AFTER_US
            && (!seen.contains(id) || currently_orphaned.contains(id.as_str()))
    });

    // Group by org so the ingest token is looked up once per org rather than
    // once per check: the failures this detects orphan every check in an org at
    // once.
    let mut by_org: HashMap<&str, Vec<&(OrphanCandidate, i64)>> = HashMap::new();
    for entry in orphans {
        // Mere presence suppresses: the retain above has already dropped every
        // entry that fell out of the renotify window.
        if last_reported.contains_key(entry.0.id.as_str()) {
            continue;
        }
        by_org
            .entry(entry.0.org_id.as_str())
            .or_default()
            .push(entry);
    }
    by_org
}

/// Whether this node owns the scan this pass.
///
/// Same election as `alert_group_reaper` / `alert_eval_ledger_reaper`, over the
/// same role set: schedulers are the only nodes this task runs on, so electing
/// from any other set would leave a dedicated scheduler deployment with no
/// leader. Same deliberate fallback too — with no cluster view, assume single
/// node and scan, because a silent detector is the failure being guarded
/// against.
async fn is_scan_leader() -> bool {
    match infra::cluster::get_cached_nodes(|node| {
        node.status == config::meta::cluster::NodeStatus::Online && node.is_scheduler()
    })
    .await
    {
        Some(mut nodes) if !nodes.is_empty() => {
            nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
            nodes[0].uuid == LOCAL_NODE.uuid
        }
        _ => true,
    }
}

/// Own loop rather than a step on the reaper's tick, which is where spec §10
/// put it.
///
/// The reaper owes the system "every job it terminates has its run completed
/// exactly once". This scan is up to [`SCAN_LIMIT`] rows x two HTTP writes
/// each; sharing a task with `requeue_expired` / `dead_letter_expired` /
/// `prune_stale` means a slow ingest endpoint stalls run accounting, and runs
/// that never complete never notify. A separate loop cannot do that, and it is
/// free to run at a cadence that suits the threshold instead of the lease
/// timers.
pub async fn run() {
    tracing::info!("[synthetics orphan] started");
    if !orphan_detection_enabled() {
        tracing::info!(
            "[synthetics orphan] currently off via ZO_SYNTHETICS_ORPHAN_DETECTION_ENABLED — the \
             loop still runs, so a config reload turns it back on without a restart"
        );
    }

    let client = match reqwest::Client::builder().timeout(HTTP_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[synthetics orphan] http client build failed, not starting: {e}");
            return;
        }
    };

    // Renotify cooldown, keyed by check id. Lives outside the loop because the
    // whole point is to remember across passes; `plan_reports` prunes it.
    let mut last_reported: HashMap<String, i64> = HashMap::new();

    loop {
        tokio::time::sleep(ORPHAN_TICK).await;

        // Read per pass, not captured here: the operator turning this off is
        // reacting to something happening now.
        if !orphan_detection_enabled() {
            config::metrics::SYNTHETICS_ORPHANED_CHECKS.reset();
            continue;
        }

        if !is_scan_leader().await {
            // A node that has just lost the election still holds whatever label
            // set it published as leader, and a Prometheus gauge keeps its last
            // value forever. Clearing it here is what stops a demoted node from
            // alerting on a count it no longer measures.
            config::metrics::SYNTHETICS_ORPHANED_CHECKS.reset();
            continue;
        }

        let db = get_orm_client_ro().await;
        detect(
            db,
            &client,
            config::utils::time::now_micros(),
            &mut last_reported,
        )
        .await;
    }
}

/// One pass: scan, decide, publish, report. Metrics go out before the writes so
/// an unreachable ingest endpoint cannot take the observability with it.
async fn detect(
    db: &sea_orm::DatabaseConnection,
    client: &reqwest::Client,
    now_us: i64,
    last_reported: &mut HashMap<String, i64>,
) {
    let candidates = match synthetics_checks::fetch_overdue(db, now_us, SCAN_LIMIT).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("[synthetics orphan] fetch_overdue: {e}");
            return;
        }
    };

    if candidates.len() as u64 == SCAN_LIMIT {
        tracing::warn!(
            scan_limit = SCAN_LIMIT,
            "[synthetics orphan] scan hit its limit — this pass reports the {SCAN_LIMIT} most \
             overdue checks and nothing else; the gauge below undercounts"
        );
    }

    let seen: HashSet<String> = candidates.iter().map(|c| c.id.clone()).collect();

    // `fetch_overdue` only bounds on `next_run_at <= now`, which every run-now
    // check matches; the per-check interval test is what actually decides.
    let orphans: Vec<(OrphanCandidate, i64)> = candidates
        .into_iter()
        .filter_map(|c| overdue_by_us(&c, now_us).map(|overdue_us| (c, overdue_us)))
        .collect();

    publish_orphan_gauge(&orphans);

    // Unconditional, and BEFORE the writes. This counts "the detector read its
    // region and reached a verdict" — including the verdict "nothing is wrong",
    // without which a healthy region is indistinguishable from a dead one. It
    // is deliberately not gated on the writes landing: an unresponsive ingest
    // endpoint can stretch the reporting phase to [`REPORT_BUDGET`], and a
    // liveness signal that a second subsystem can silence is not one.
    config::metrics::SYNTHETICS_ORPHAN_SCANS_TOTAL.inc();

    let by_org = plan_reports(&orphans, &seen, last_reported, now_us);

    if !by_org.is_empty() {
        // One lookup per pass. The `_meta` half of every report authenticates as
        // `_meta`, not as the reporting org: ingest auth resolves the token
        // against the URL's org (`find_enabled_token(org_id, token)`), so org1's
        // token posted to `/api/_meta/...` matches no row and the write 401s.
        let meta_token = match org_ingestion_tokens::find_default_enabled(META_ORG).await {
            Ok(Some(t)) => Some(t.token),
            Ok(None) => {
                tracing::warn!(
                    "[synthetics orphan] no enabled ingest token for {META_ORG} — reporting to \
                     each org only"
                );
                None
            }
            Err(e) => {
                tracing::error!("[synthetics orphan] {META_ORG} ingest token lookup failed: {e}");
                None
            }
        };
        report(client, by_org, meta_token.as_deref(), now_us, last_reported).await;
    }
}

/// Publishes the per-org orphan count.
///
/// Reset first. Prometheus gauges are sticky: an org whose checks recover — or
/// whose last check is deleted — would otherwise be alerted on indefinitely at
/// whatever count it last had. Same reasoning as `publish_backlog_metrics`.
///
/// Counts every orphan, not every report: the cooldown governs how often we
/// speak, and folding it into a state gauge would make an unresolved incident
/// read as resolved for 59 minutes out of every 60.
fn publish_orphan_gauge(orphans: &[(OrphanCandidate, i64)]) {
    let mut per_org: HashMap<&str, i64> = HashMap::new();
    for (c, _) in orphans {
        *per_org.entry(c.org_id.as_str()).or_default() += 1;
    }

    config::metrics::SYNTHETICS_ORPHANED_CHECKS.reset();
    for (org_id, count) in per_org {
        config::metrics::SYNTHETICS_ORPHANED_CHECKS
            .with_label_values(&[org_id])
            .set(count);
    }
}

/// Writes the planned reports and records the cooldown for the ones that landed.
async fn report(
    client: &reqwest::Client,
    by_org: HashMap<&str, Vec<&(OrphanCandidate, i64)>>,
    meta_token: Option<&str>,
    now_us: i64,
    last_reported: &mut HashMap<String, i64>,
) {
    let api_endpoint = config::meta::synthetics::api_endpoint();
    let started = tokio::time::Instant::now();
    let mut budget = MAX_REPORTS_PER_PASS;
    let mut deferred = 0usize;
    let exhausted = |budget: usize| budget == 0 || started.elapsed() >= REPORT_BUDGET;

    for (org_id, rows) in by_org {
        if exhausted(budget) {
            deferred += rows.len();
            continue;
        }

        // One org without a usable token must not cost the other orgs their
        // reports, so this skips rather than returns — the difference from
        // `handle_dead_letter`, which only ever handles one org's row.
        let ingest_token = match org_ingestion_tokens::find_default_enabled(org_id).await {
            Ok(Some(t)) => t.token,
            Ok(None) => {
                tracing::warn!(
                    org_id = %org_id,
                    "[synthetics orphan] no enabled ingest token — skipping orphan reports"
                );
                continue;
            }
            Err(e) => {
                tracing::error!(
                    org_id = %org_id,
                    "[synthetics orphan] ingest token lookup failed: {e}"
                );
                continue;
            }
        };

        for (c, overdue_us) in rows {
            if exhausted(budget) {
                deferred += 1;
                continue;
            }
            budget -= 1;

            let overdue_secs = overdue_us / 1_000_000;
            tracing::warn!(
                synthetics_id = %c.id,
                org_id = %org_id,
                overdue_secs,
                "[synthetics orphan] enabled check has not been claimed by any scheduler"
            );

            let delivered = write_orphan_trigger(
                client,
                &api_endpoint,
                &ingest_token,
                meta_token,
                c,
                now_us,
                overdue_secs,
            )
            .await;

            // The cooldown starts on DELIVERY, never on the attempt. A stale
            // token or a down ingest endpoint would otherwise convert a dropped
            // write into an hour of enforced silence — the exact failure this
            // module exists to prevent, caused by the module itself.
            if delivered {
                last_reported.insert(c.id.clone(), now_us);
            }
        }
    }

    if deferred > 0 {
        tracing::warn!(
            deferred,
            "[synthetics orphan] this pass spent its report count or time budget; the rest carry \
             over to a later pass"
        );
    }
}

/// Writes one orphan report to the org's triggers stream and to `_meta`.
///
/// Returns whether the ORG write was accepted. The `_meta` copy is a
/// platform-operator convenience; the org's own stream is the record the
/// customer's alert rules read, so only that one may start a cooldown.
///
/// Deliberately the same shape and transport as the dead-letter report
/// (`write_triggers_stream`), so this needs no new stream, schema or plumbing.
async fn write_orphan_trigger(
    client: &reqwest::Client,
    api_endpoint: &str,
    ingest_token: &str,
    meta_token: Option<&str>,
    c: &OrphanCandidate,
    now_us: i64,
    overdue_secs: i64,
) -> bool {
    let trigger_record = serde_json::json!([{
        "_timestamp": now_us,
        "org": c.org_id,
        "module": "synthetics",
        "key": format!("{}/{}", c.name, c.id),
        "next_run_at": c.next_run_at,
        "is_realtime": false,
        "is_silenced": false,
        "status": "failed",
        "start_time": now_us,
        "end_time": now_us,
        // The stable field an alert rule filters on. The dead-letter path writes
        // this same stream with the same `status` and no `error_source` at all,
        // so without this the two are separable only by a substring match on the
        // free-text `error` — and they need different responses. "Nobody
        // scheduled this" points at the control plane; "a probe took it and went
        // quiet" points at the probe fleet.
        "error_source": ERROR_SOURCE_ORPHAN,
        "error": format!(
            "no scheduler claimed this enabled check for {overdue_secs}s — more than \
             {ORPHAN_INTERVALS} of its own intervals. A scheduler is running in this region (it \
             produced this report), so it is up and not claiming: check for an unparseable check \
             row failing the whole claim, or for scheduler errors in the log."
        ),
    }]);

    let org_url = format!("{api_endpoint}/api/{}/triggers/_json", c.org_id);
    let delivered = post_trigger(client, &org_url, ingest_token, &trigger_record, c).await;

    if let Some(meta_token) = meta_token {
        let meta_url = format!("{api_endpoint}/api/{META_ORG}/triggers/_json");
        post_trigger(client, &meta_url, meta_token, &trigger_record, c).await;
    }

    delivered
}

/// Posts one record and says whether ingest actually took it.
///
/// A non-2xx is checked explicitly because `send()` resolves to `Ok` for a 401
/// as readily as for a 200 — treating the transport error as the only failure
/// meant a mis-scoped token dropped every report and logged nothing.
async fn post_trigger(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &serde_json::Value,
    c: &OrphanCandidate,
) -> bool {
    match client
        .post(url)
        .basic_auth("ingest", Some(token))
        .json(body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(
                synthetics_id = %c.id,
                url = %url,
                %status,
                "[synthetics orphan] triggers stream write rejected: {}",
                body.chars().take(512).collect::<String>()
            );
            false
        }
        Err(e) => {
            tracing::error!(
                synthetics_id = %c.id,
                url = %url,
                "[synthetics orphan] triggers stream write failed: {e}"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {

    /// Moved from the enterprise config module with the code it pins: the kill
    /// switch for a new always-on alert source. Captured at boot it would need a
    /// scheduler restart to silence, which is exactly what an operator cannot do
    /// while triaging the storm it is causing.
    #[test]
    fn orphan_detection_enabled_is_read_per_pass_not_captured_at_boot() {
        let _guard = crate::CONFIG_SWAP_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let saved = config::CONFIG.load_full();

        let install = |on: bool| {
            let mut cfg = config::Config::init().unwrap();
            cfg.synthetics.orphan_detection_enabled = on;
            config::CONFIG.store(std::sync::Arc::new(cfg));
        };

        install(true);
        assert!(super::orphan_detection_enabled());

        // Second read, no restart in between.
        install(false);
        assert!(!super::orphan_detection_enabled());

        config::CONFIG.store(saved);
    }
    use config::meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType};
    use infra::table::synthetics_checks::OrphanCandidate;

    use super::{
        HashMap, HashSet, MIN_GRACE_US, ORPHAN_INTERVALS, RENOTIFY_AFTER_US, anchor_us,
        grace_deadline_us, overdue_by_us, plan_reports,
    };

    /// Minute-aligned, so the cron tests get exact slot boundaries out of
    /// `schedule.after()` instead of a partial first interval.
    const NOW: i64 = 1_750_000_020_000_000;
    const FIVE_MIN_US: i64 = 300 * 1_000_000;
    const ONE_MIN_US: i64 = 60 * 1_000_000;
    const ONE_HOUR_US: i64 = 3_600 * 1_000_000;

    fn freq(t: SyntheticFrequencyType, interval: i64, cron: &str) -> SyntheticFrequency {
        SyntheticFrequency {
            frequency_type: t,
            interval,
            cron: cron.to_string(),
            timezone: None,
        }
    }

    /// A 5-minute interval check. Every test below varies one anchor of it.
    fn candidate(next_run_at: i64, last_triggered_at: i64, updated_at: i64) -> OrphanCandidate {
        OrphanCandidate {
            id: "chk-1".to_string(),
            org_id: "org1".to_string(),
            name: "Login Flow".to_string(),
            frequency: freq(SyntheticFrequencyType::Minutes, 5, ""),
            tz_offset: 0,
            next_run_at,
            last_triggered_at,
            updated_at,
        }
    }

    fn cron_candidate(next_run_at: i64, cron: &str) -> OrphanCandidate {
        let mut c = candidate(next_run_at, 0, 0);
        c.frequency = freq(SyntheticFrequencyType::Cron, 0, cron);
        c
    }

    /// 0 — tests 2 and 3 build their fixtures from the constant, so they stay
    /// green if it changes. Halving the grace window must be a deliberate edit.
    #[test]
    fn thresholds_are_pinned() {
        assert_eq!(ORPHAN_INTERVALS, 3);
        assert_eq!(MIN_GRACE_US, 300 * 1_000_000);
    }

    /// 1 — spec §13 test 13. Four of the check's own intervals have gone by with
    /// nothing claiming it: that is the alert this module exists to raise.
    #[test]
    fn overdue_by_four_intervals_is_orphaned() {
        let c = candidate(NOW - 4 * FIVE_MIN_US, 0, 0);
        assert_eq!(overdue_by_us(&c, NOW), Some(4 * FIVE_MIN_US));
    }

    /// 2 — the boundary is strictly-greater, so landing exactly on N intervals is
    /// still inside the grace window. A scheduler one full slot behind is normal
    /// under backlog; alerting there is how this feature gets muted.
    #[test]
    fn overdue_by_exactly_three_intervals_is_not_orphaned() {
        let c = candidate(NOW - ORPHAN_INTERVALS * FIVE_MIN_US, 0, 0);
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 3 — one microsecond past the boundary flips it, which is what makes the
    /// comparison above a real boundary rather than an approximate one.
    #[test]
    fn overdue_by_just_over_three_intervals_is_orphaned() {
        let c = candidate(NOW - ORPHAN_INTERVALS * FIVE_MIN_US - 1, 0, 0);
        assert_eq!(
            overdue_by_us(&c, NOW),
            Some(ORPHAN_INTERVALS * FIVE_MIN_US + 1)
        );
    }

    /// 4 — spec §13 test 15.
    #[test]
    fn healthy_check_scheduled_in_the_future_is_not_orphaned() {
        let c = candidate(NOW + FIVE_MIN_US, 0, 0);
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 5 — supersedes spec §13 test 14, which asks for a literal
    /// "`next_run_at = 0` → never alert" guard. Such a guard would blind the
    /// module to the bug it exists to catch (see the module header and test 7),
    /// so the anchor fallback carries the intent instead: a check created
    /// seconds ago has `next_run_at = 0` and a fresh `updated_at`, and the grace
    /// window starts there.
    #[test]
    fn freshly_created_never_run_check_is_not_orphaned() {
        let c = candidate(0, 0, NOW);
        assert_eq!(anchor_us(&c), Some(NOW));
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 6 — run-now bumps NOTHING. `run_synthetic_now` passes the existing
    /// `last_triggered_at` straight back through `advance_schedule`, which does
    /// not touch `updated_at` either; the only write is `next_run_at = 0`. So a
    /// just-run-now check is protected by whichever anchor it already had, and
    /// one that ran a moment ago is safe on `last_triggered_at`.
    #[test]
    fn run_now_on_a_recently_run_check_is_not_orphaned() {
        let c = candidate(0, NOW - 30 * 1_000_000, NOW - 10 * FIVE_MIN_US);
        assert_eq!(anchor_us(&c), Some(NOW - 30 * 1_000_000));
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 7 — the live bug: a check sitting at `next_run_at = 0` that nothing has
    /// drained for four intervals. It must alert; a literal
    /// "`next_run_at == 0` → never report" guard would miss it.
    #[test]
    fn never_drained_run_now_check_is_orphaned() {
        let stale = NOW - 4 * FIVE_MIN_US;
        let c = candidate(0, stale, stale);
        assert_eq!(anchor_us(&c), Some(stale));
        assert_eq!(overdue_by_us(&c, NOW), Some(4 * FIVE_MIN_US));
    }

    /// 8 — a backdated `start`. Validation accepts one up to 15 minutes in the
    /// past and `create` writes it straight into `next_run_at`, so a healthy
    /// one-minute check can be born past its own grace window. Anchoring on the
    /// newest of the three fields — here `updated_at` — is what keeps it quiet
    /// until the scheduler has had a chance to drain it.
    #[test]
    fn backdated_start_on_a_fresh_check_is_not_orphaned() {
        let mut c = candidate(NOW - 15 * ONE_MIN_US, 0, NOW);
        c.frequency = freq(SyntheticFrequencyType::Minutes, 1, "");
        assert_eq!(anchor_us(&c), Some(NOW));
        assert_eq!(overdue_by_us(&c, NOW), None);

        // Once `updated_at` itself ages past the window, it does alert — the max
        // must not be a permanent amnesty.
        c.updated_at = NOW - 10 * ONE_MIN_US;
        c.next_run_at = NOW - 15 * ONE_MIN_US;
        assert_eq!(overdue_by_us(&c, NOW), Some(10 * ONE_MIN_US));
    }

    /// 9 — every anchor at zero. Taken literally that is 1970, which would make
    /// the check ~56 years overdue and alert unconditionally on a row that
    /// simply carries no evidence either way.
    #[test]
    fn a_check_with_no_anchor_at_all_never_alerts() {
        let c = candidate(0, 0, 0);
        assert_eq!(anchor_us(&c), None);
        assert_eq!(overdue_by_us(&c, NOW), None);

        let negative = candidate(-1, -5, 0);
        assert_eq!(anchor_us(&negative), None);
        assert_eq!(overdue_by_us(&negative, NOW), None);
    }

    /// 10 — the grace floor. A `Seconds x 1` check is creatable
    /// (`MIN_INTERVAL_SECS == 1`) and three of its intervals is three seconds,
    /// less than one scheduler tick. Without the floor a perfectly healthy check
    /// of that shape alerts once an hour forever.
    #[test]
    fn a_one_second_check_gets_the_absolute_floor_not_three_seconds() {
        let mut c = candidate(NOW - 10 * 1_000_000, 0, 0);
        c.frequency = freq(SyntheticFrequencyType::Seconds, 1, "");

        assert_eq!(
            grace_deadline_us(&c.frequency, 0, NOW),
            Some(NOW + MIN_GRACE_US),
            "3s of interval must not beat the floor"
        );
        assert_eq!(
            overdue_by_us(&c, NOW),
            None,
            "10s late on a 1s check is one scheduler tick's worth of lag"
        );

        // Past the floor it does alert, so the floor is a window and not a mute.
        let long_gone = candidate(NOW - MIN_GRACE_US - 1, 0, 0);
        let mut long_gone = long_gone;
        long_gone.frequency = freq(SyntheticFrequencyType::Seconds, 1, "");
        assert_eq!(overdue_by_us(&long_gone, NOW), Some(MIN_GRACE_US + 1));
    }

    /// 11 — cron reports `interval_secs() == 0`, so its deadline has to come
    /// from the schedule itself or every cron check would be undetectable.
    #[test]
    fn cron_deadline_is_derived_from_the_schedule() {
        // "every minute, on the second" — one field per sec/min/hour/dom/mon/dow.
        // Three slots is 3 minutes, under the floor, so the floor wins.
        let every_minute = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        assert_eq!(
            grace_deadline_us(&every_minute, 0, NOW),
            Some(NOW + MIN_GRACE_US)
        );

        let overdue = cron_candidate(NOW - 6 * ONE_MIN_US, "0 * * * * *");
        assert_eq!(overdue_by_us(&overdue, NOW), Some(6 * ONE_MIN_US));

        let healthy = cron_candidate(NOW + ONE_MIN_US, "0 * * * * *");
        assert_eq!(overdue_by_us(&healthy, NOW), None);

        // Hourly: three slots is three hours, well clear of the floor, so the
        // walk itself is what is being measured here.
        let hourly = freq(SyntheticFrequencyType::Cron, 0, "0 0 * * * *");
        let hour_start = NOW - NOW.rem_euclid(ONE_HOUR_US);
        assert_eq!(
            grace_deadline_us(&hourly, 0, hour_start),
            Some(hour_start + 3 * ONE_HOUR_US)
        );
    }

    /// 12 — a clustered cron. `0 0,1 * * * *` fires at :00 and :01 of every
    /// hour, so the gap from a :00 anchor to the next slot is 60 seconds and the
    /// one after it is an hour. Multiplying the FIRST gap by `ORPHAN_INTERVALS`
    /// gives a 3-minute window and alerts after a single missed slot — the
    /// opposite of the tolerance the constant promises. Walking N successive
    /// slots is what makes the promise true.
    #[test]
    fn a_clustered_cron_tolerates_one_missed_slot() {
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 0,1 * * * *");
        let hour_start = NOW - NOW.rem_euclid(ONE_HOUR_US);
        assert_eq!(
            hour_start + 7 * ONE_MIN_US,
            NOW,
            "the fixture assumes NOW sits at :07"
        );

        // :01, then the next hour's :00, then its :01.
        assert_eq!(
            grace_deadline_us(&f, 0, hour_start),
            Some(hour_start + ONE_HOUR_US + ONE_MIN_US)
        );

        // Ten minutes after the anchor the :01 slot has been missed. Under the
        // old first-gap arithmetic (3 x 60s) this alerted.
        let mut c = cron_candidate(hour_start, "0 0,1 * * * *");
        c.frequency = f;
        assert_eq!(overdue_by_us(&c, hour_start + 10 * ONE_MIN_US), None);

        // Two hours out, two whole clusters have been missed, and it does alert.
        assert_eq!(
            overdue_by_us(&c, hour_start + 2 * ONE_HOUR_US),
            Some(2 * ONE_HOUR_US)
        );
    }

    /// 13 — an empty cron has no schedule, so there is nothing to measure
    /// against. Silence beats a fabricated threshold.
    #[test]
    fn empty_cron_yields_no_deadline_and_no_alert() {
        let empty = freq(SyntheticFrequencyType::Cron, 0, "");
        assert_eq!(grace_deadline_us(&empty, 0, NOW), None);

        let c = cron_candidate(NOW - 100 * ONE_MIN_US, "");
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 14 — same for a cron the parser rejects.
    #[test]
    fn invalid_cron_yields_no_deadline_and_no_alert() {
        let bad = freq(SyntheticFrequencyType::Cron, 0, "not a cron expression");
        assert_eq!(grace_deadline_us(&bad, 0, NOW), None);

        let c = cron_candidate(NOW - 100 * ONE_MIN_US, "not a cron expression");
        assert_eq!(overdue_by_us(&c, NOW), None);
    }

    /// 15 — every interval unit, so a new one cannot be added without either
    /// updating this table or failing here. Each deadline is N intervals or the
    /// floor, whichever is longer.
    #[test]
    fn every_interval_unit_produces_a_deadline() {
        let cases = [
            (SyntheticFrequencyType::Seconds, 30i64, 30i64),
            (SyntheticFrequencyType::Minutes, 5, 300),
            (SyntheticFrequencyType::Hours, 2, 7_200),
            (SyntheticFrequencyType::Days, 1, 86_400),
            (SyntheticFrequencyType::Weeks, 1, 604_800),
            (SyntheticFrequencyType::Months, 1, 2_592_000),
        ];
        for (unit, interval, secs) in cases {
            let f = freq(unit.clone(), interval, "");
            let expect = (secs * ORPHAN_INTERVALS * 1_000_000).max(MIN_GRACE_US);
            assert_eq!(
                grace_deadline_us(&f, 0, NOW),
                Some(NOW + expect),
                "{unit:?} x{interval}"
            );
        }
    }

    /// 16 — a zero or negative stored interval must not divide the world into
    /// "everything is orphaned". `interval_secs()` clamps with `.max(1)` — to
    /// one second for `Seconds`, sixty for `Minutes` — and the floor then
    /// dominates both, so the degenerate window cannot reach the comparison.
    #[test]
    fn zero_or_negative_interval_does_not_produce_a_bogus_alert() {
        for unit in [
            SyntheticFrequencyType::Seconds,
            SyntheticFrequencyType::Minutes,
        ] {
            for interval in [0i64, -5] {
                let f = freq(unit.clone(), interval, "");
                assert_eq!(
                    grace_deadline_us(&f, 0, NOW),
                    Some(NOW + MIN_GRACE_US),
                    "{unit:?} x{interval} must floor, never yield a zero window"
                );

                // One second inside the floor and one second outside it: the
                // clamp has to leave a real window on both sides.
                let mut inside = candidate(NOW - MIN_GRACE_US + 1_000_000, 0, 0);
                inside.frequency = f.clone();
                assert_eq!(overdue_by_us(&inside, NOW), None);

                let mut outside = candidate(NOW - MIN_GRACE_US - 1_000_000, 0, 0);
                outside.frequency = f;
                assert_eq!(overdue_by_us(&outside, NOW), Some(MIN_GRACE_US + 1_000_000));
            }
        }
    }

    // ── plan_reports ─────────────────────────────────────────────────────────

    fn orphan(id: &str, org: &str) -> (OrphanCandidate, i64) {
        let mut c = candidate(NOW - 4 * FIVE_MIN_US, 0, 0);
        c.id = id.to_string();
        c.org_id = org.to_string();
        (c, 4 * FIVE_MIN_US)
    }

    fn seen_of(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    /// 17 — the cooldown. Reporting a persistent orphan every pass would put
    /// twelve records an hour into the customer's triggers stream.
    #[test]
    fn a_reported_check_is_suppressed_for_the_renotify_window() {
        let orphans = [orphan("chk-1", "org1")];
        let seen = seen_of(&["chk-1"]);
        let mut last = HashMap::from([("chk-1".to_string(), NOW)]);

        let inside = plan_reports(&orphans, &seen, &mut last, NOW + RENOTIFY_AFTER_US - 1);
        assert!(inside.is_empty(), "still inside the hour");

        let outside = plan_reports(&orphans, &seen, &mut last, NOW + RENOTIFY_AFTER_US);
        assert_eq!(outside["org1"].len(), 1, "the window has elapsed");
    }

    /// 18 — a check that recovered loses its cooldown slot, so re-orphaning
    /// inside the hour reports again. Without the prune the second failure would
    /// be silent for up to an hour, which is the interval the customer would
    /// have been told about it.
    #[test]
    fn a_recovered_then_re_orphaned_check_reports_again_inside_the_hour() {
        let seen = seen_of(&["chk-1"]);
        let mut last = HashMap::from([("chk-1".to_string(), NOW)]);

        // Pass 2: still in the batch, no longer orphaned.
        let recovered = plan_reports(&[], &seen, &mut last, NOW + ONE_MIN_US);
        assert!(recovered.is_empty());
        assert!(
            last.is_empty(),
            "a recovered check must not keep a cooldown slot"
        );

        // Pass 3: orphaned again, well inside the renotify window.
        let orphans = [orphan("chk-1", "org1")];
        let again = plan_reports(&orphans, &seen, &mut last, NOW + 2 * ONE_MIN_US);
        assert_eq!(again["org1"].len(), 1);
    }

    /// 19 — the truncation case. The scan is capped at `SCAN_LIMIT` ordered by
    /// `next_run_at`, and the rows this module targets all tie at 0 with no
    /// stable tie-break, so batch membership shuffles between passes. Pruning on
    /// absence would drop the cooldown of a check that is still orphaned and
    /// re-report it minutes later.
    #[test]
    fn a_check_missing_from_a_truncated_batch_keeps_its_cooldown() {
        let mut last = HashMap::from([("chk-1".to_string(), NOW)]);

        // This pass's batch did not include chk-1 at all.
        let orphans = [orphan("chk-2", "org1")];
        let seen = seen_of(&["chk-2"]);
        let planned = plan_reports(&orphans, &seen, &mut last, NOW + ONE_MIN_US);

        assert!(
            last.contains_key("chk-1"),
            "absence from a truncated batch is not evidence of recovery"
        );
        assert_eq!(planned["org1"].len(), 1, "chk-2 is new and reports");
    }

    /// 20 — the expiry that bounds the map. A cooldown older than the renotify
    /// window can no longer suppress anything, so keeping it only grows the map
    /// for the life of the process.
    #[test]
    fn cooldown_entries_expire_even_when_never_seen_again() {
        let mut last = HashMap::from([
            ("gone-forever".to_string(), NOW),
            ("recent".to_string(), NOW + RENOTIFY_AFTER_US),
        ]);

        plan_reports(&[], &seen_of(&[]), &mut last, NOW + RENOTIFY_AFTER_US);

        assert_eq!(last.len(), 1);
        assert!(last.contains_key("recent"));
    }

    /// 21 — one group per org, because the ingest token is looked up per org and
    /// these failures orphan every check in an org at once.
    #[test]
    fn orphans_are_grouped_by_org() {
        let orphans = [
            orphan("chk-1", "org1"),
            orphan("chk-2", "org2"),
            orphan("chk-3", "org1"),
        ];
        let seen = seen_of(&["chk-1", "chk-2", "chk-3"]);
        let mut last = HashMap::new();

        let planned = plan_reports(&orphans, &seen, &mut last, NOW);

        assert_eq!(planned.len(), 2);
        assert_eq!(planned["org1"].len(), 2);
        assert_eq!(planned["org2"].len(), 1);
        assert!(
            last.is_empty(),
            "planning must not record a cooldown — only delivery may"
        );
    }
}

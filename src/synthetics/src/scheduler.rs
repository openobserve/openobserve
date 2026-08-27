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

//! Synthetics scheduler — queries `synthetics_checks` directly for due synthetics
//! and fans each one out into `synthetics_jobs`.
//!
//! Runs every 5 seconds on scheduler nodes. For each synthetic whose
//! `next_run_at <= now AND enabled = true` the scheduler:
//!   1. Generates a KSUID `run_id` and inserts a `synthetics_runs` row.
//!   2. Inserts one `synthetics_jobs` row per location (not per device). For browser synthetics,
//!      all engine+device combos are packed as JSON in `browser_devices`, each with a pre-generated
//!      KSUID `execution_id`.
//!   3. Advances `next_run_at` on the synthetic.

use std::time::Duration;

use config::{
    meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType, SyntheticType},
    utils::hash::{Sum64, fnv},
};
use infra::{
    db::get_orm_client_rw,
    table::{
        org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_locations,
        synthetics_runs,
    },
};
use serde::Serialize;
use svix_ksuid::KsuidLike as _;

/// The org every dead letter is copied to, so operators see them all.
const META_ORG: &str = "_meta";

const TICK: Duration = Duration::from_secs(5);
/// Max synthetics to pull per tick.
const FETCH_LIMIT: u64 = 500;

/// Minimum gap between two identical trial-gate log lines for one check.
///
/// The verdict is stable — a lapsed trial does not un-lapse — so one line per
/// denied check per tick floods forever. Same value as
/// `reaper::orphan::RENOTIFY_AFTER_US`. `test` is in the cfg below so the
/// throttle stays testable in a build with no `cloud` feature.
#[cfg(any(test, feature = "cloud"))]
const TRIAL_GATE_LOG_COOLDOWN_US: i64 = 3_600 * 1_000_000; // 1h

/// Wire format for one engine+device combo inside `browser_devices` JSON.
#[derive(Serialize)]
struct BrowserDeviceEntry<'a> {
    execution_id: String,
    engine: &'a str,
    device: &'a str,
}

/// Whether the org holds a `customer_billings` row, and what kind.
///
/// Three states, not two: core's `is_org_in_free_trial_period` short-circuits
/// the dates only for a *paid* row — "no row" and "a free row" both fall
/// through to them. Re-derived locally; the DB reads stay in the caller so the
/// decision below is pure and testable without a database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BillingSubscription {
    /// No `customer_billings` row for the org at all.
    Absent,
    /// A row whose `subscription_type.is_free_sub()` is true.
    Free,
    /// A row on a paid plan — Rate, Enterprise or ExternalContract.
    Paid,
}

/// The trial gate's verdict for one due check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrialGate {
    /// Fan the check out over its locations.
    Run,
    /// Skip the WHOLE check: no `synthetics_runs` row, no jobs, no Lambda. One
    /// throttled `warn!` and **nothing is persisted**, so the denied slot leaves
    /// no row a user, a saved query or an alert rule can see.
    Skip { error_source: &'static str },
}

/// Throttles a repeating log line to one per `(key, reason)` per window.
/// [`LogCooldown::allow`] expires entries itself; that, not the insert, is what
/// bounds the map when a throttled check is deleted.
#[cfg(any(test, feature = "cloud"))]
struct LogCooldown {
    last: dashmap::DashMap<(String, &'static str), i64>,
    window_us: i64,
}

/// `error_source` for a trial-denied slot: in `crate::alerting`'s vocabulary,
/// the only value meaning the customer's account state stopped the check.
pub const ERROR_SOURCE_TRIAL: &str = "trial";

/// `error_source` for a slot the free step pool denied — SPEC §7.3.
/// Separable from `trial` because the response differs: a lapsed trial does not
/// un-lapse, an exhausted grant re-opens on subscribe or a raised limit (E17).
pub const ERROR_SOURCE_QUOTA: &str = "quota";

/// SPEC §7.3's exhaustion policy, re-derived locally.
///
/// The authority is `ai_credits::resolve_ai_credit_exhaustion_policy`, whose
/// `(subscription_type, provider)` table is §7.3's arm for arm; reusing it is
/// what keeps the two pools from drifting apart. Mirrored into a local enum so
/// the decision below stays pure and testable in every build shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolExhaustionPolicy {
    /// Rate or Enterprise on Stripe or Azure — run it and bill the overage.
    MeteredOverage,
    /// Free — and, today, Rate/Enterprise on AWS Marketplace. Skip the slot.
    /// ⚠️ SPEC §7.3 marks the AWS half **MUST fix**: `metering/aws.rs` has no
    /// synthetics dimension arm, so an AWS Marketplace org that could be charged
    /// is blocked instead (SPEC item **1.8**, in o2-enterprise).
    SubscriptionRequired,
    /// ExternalContract — *"notify, never block, never pool-gate"* (E18/T36).
    AdditionalCreditsRequired,
}

/// Gate 3 of §7.1 — what happens to ONE location slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolGate {
    /// Enqueue it — the grant paid for it, or no grant was consulted (a private
    /// venue, or a node that does not meter). Only a non-zero reserve refunds.
    Run,
    /// The grant is spent and the org can be charged for the overage. Enqueue
    /// with NO reservation, so the ack meters it as `SyntheticsSteps` (E16/T31).
    RunAsOverage,
    /// An ExternalContract org: no reservation, notify, **never** block (E18/T36).
    RunAndNotify,
    /// Skip THIS SLOT: dead-letter it and write a result row carrying
    /// [`ERROR_SOURCE_QUOTA`]. **The check stays ENABLED** — §7.3, because
    /// skipping is reversible the moment they subscribe and disabling is not.
    /// `the_quota_gate_never_disables_a_check` pins it.
    Skip,
}

/// Whether this org's plan lets the free pool be consulted for a slot at all.
/// False for **ExternalContract** only: §7.4 needs their acks to carry BILLABLE
/// `SyntheticsSteps`, so reserving would emit `SyntheticsFreeSteps` instead and
/// silently shorten the true-up by up to a whole grant (E18/T36).
pub fn pool_reserves(policy: PoolExhaustionPolicy) -> bool {
    !matches!(policy, PoolExhaustionPolicy::AdditionalCreditsRequired)
}

/// Gate 3 of §7.1 plus §7.3's exhaustion table, as one pure decision.
///
/// `reserved` is whether the caller's deduct SUCCEEDED; `false` whenever
/// [`pool_reserves`] said not to try. Total over both inputs on purpose: an
/// unreachable branch on a billing path is one no test can pin.
pub fn pool_gate_decision(policy: PoolExhaustionPolicy, reserved: bool) -> PoolGate {
    match (policy, reserved) {
        (PoolExhaustionPolicy::AdditionalCreditsRequired, _) => PoolGate::RunAndNotify,
        (_, true) => PoolGate::Run,
        (PoolExhaustionPolicy::MeteredOverage, false) => PoolGate::RunAsOverage,
        (PoolExhaustionPolicy::SubscriptionRequired, false) => PoolGate::Skip,
    }
}

/// The pool gate's log throttle: an exhausted free org denies every slot, every
/// tick, until it subscribes.
#[cfg(feature = "cloud")]
static POOL_GATE_LOG: std::sync::LazyLock<LogCooldown> =
    std::sync::LazyLock::new(|| LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US));

/// The trial gate's own log throttle. Process-wide, like the flood it bounds.
#[cfg(feature = "cloud")]
static TRIAL_GATE_LOG: std::sync::LazyLock<LogCooldown> =
    std::sync::LazyLock::new(|| LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US));

#[cfg(any(test, feature = "cloud"))]
impl LogCooldown {
    fn new(window_us: i64) -> Self {
        Self {
            last: dashmap::DashMap::new(),
            window_us,
        }
    }

    /// May this line be emitted now? Takes `now_us`, not a clock, to stay testable.
    fn allow(&self, key: &str, reason: &'static str, now_us: i64) -> bool {
        let entry = (key.to_string(), reason);
        // Copied out rather than held: DashMap would deadlock on the insert
        // below if the read guard were still alive on the same shard.
        let last = self.last.get(&entry).map(|v| *v);
        if last.is_some_and(|t| now_us.saturating_sub(t) < self.window_us) {
            return false;
        }
        self.last.insert(entry, now_us);
        // A check deleted while it is being throttled never comes back to
        // refresh its entry, so expiry is the only thing bounding this map.
        self.last
            .retain(|_, t| now_us.saturating_sub(*t) < self.window_us);
        true
    }
}

/// Whether the trial gate needs its two database reads for this check.
///
/// Asked BEFORE either read. `O2_CLOUD_TRIAL_PERIOD_ENABLED` defaults to
/// **false**, so without this every due check cost a `customer_billings` plus an
/// `organizations` read per 5s tick before answering `Run` anyway: the kill
/// switch has to switch off the WORK, not merely the verdict. `_meta` is exempt.
/// Core skips the `organizations` read for a paid org; deciding `Paid => Run`
/// here instead would move that out of the pure function and leave its arm 3
/// unreachable from production.
pub fn trial_gate_reads_needed(trial_period_enabled: bool, org_id: &str) -> bool {
    trial_period_enabled && org_id != config::META_ORG_ID
}

/// Gate 1 of §7.1 — may this check run at all?
///
/// **Evaluated ONCE PER DUE CHECK, hoisted ABOVE the location loop.** Per
/// location it would issue N identical billing reads per tick and could deduct
/// from the one-time free pool for a check the gate has already denied.
///
/// Mirrors `is_org_in_free_trial_period` arm for arm:
///   1. `trial_period_enabled` off      => `Run` (checking disabled fleet-wide)
///   2. `org_id == config::META_ORG_ID` => `Run` (the meta org is never gated)
///   3. [`BillingSubscription::Paid`]   => `Run` (the dates are irrelevant)
///   4. `Absent` or `Free`              => `Run` iff `now_us <= trial_ends_at`
///
/// Pure, which is E20: a trial expiring between enqueue and ack cannot
/// un-enqueue a job. Not cfg'd — the caller is (§8.1) — so it stays testable.
pub fn trial_gate_decision(
    trial_period_enabled: bool,
    org_id: &str,
    subscription: BillingSubscription,
    trial_ends_at: i64,
    now_us: i64,
) -> TrialGate {
    if !trial_period_enabled {
        return TrialGate::Run;
    }

    if org_id == config::META_ORG_ID {
        return TrialGate::Run;
    }

    match subscription {
        BillingSubscription::Paid => TrialGate::Run,
        BillingSubscription::Absent | BillingSubscription::Free => {
            // Core denies on `now > trial_ends_at`, so the boundary instant is
            // still INSIDE the trial. A `>=` moves it by one microsecond.
            if now_us <= trial_ends_at {
                TrialGate::Run
            } else {
                TrialGate::Skip {
                    error_source: ERROR_SOURCE_TRIAL,
                }
            }
        }
    }
}

pub async fn run() {
    tracing::info!("[synthetics scheduler] started");

    loop {
        tokio::time::sleep(TICK).await;

        let db = get_orm_client_rw().await;

        let now_us = config::utils::time::now_micros();

        // Read per tick, so the kill switch takes effect on a config reload
        // rather than at the next restart.
        let jitter_enabled = config::get_config().synthetics.scheduler_jitter_enabled;

        // Claim and advance in ONE locked pass, then fan out below.
        //
        // `claim_due` locks each due row with FOR UPDATE SKIP LOCKED and
        // advances its schedule inside the same transaction, so a second
        // scheduler node skips the rows this one holds and picks up *different*
        // due checks instead — the replicas self-shard, which is what
        // `designs/synthetics/01-server-architecture.md` §4.2 specifies. Every
        // check returned here is already ours; nothing below needs to re-check.
        let synthetics = match synthetics_checks::claim_due(db, now_us, FETCH_LIMIT, |c| {
            compute_next_run_at(
                &c.frequency,
                c.next_run_at,
                now_us,
                c.tz_offset,
                &c.id,
                jitter_enabled,
            )
        })
        .await
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("[synthetics scheduler] claim_due: {e}");
                continue;
            }
        };

        for synthetic in synthetics {
            // ---- Gate 1 of §7.1 — the TRIAL gate ----------------------------
            //
            // ONCE per check, hoisted ABOVE the location fan-out and before the
            // run row: no interleaving with the per-location deduct that is gate
            // 3 (§7.1 makes burning a one-time grant for a denied check a MUST
            // NOT), and a denied check creates no run row, no job, no Lambda.
            // §7.2's live bug is that we pay for the Lambda, the journey and the
            // S3 write for a trial-expired org whose result ingest rejects with
            // a 429 — and under step billing the steps arrive on the ack, not an
            // ingest route, so the org would be BILLED for data it never gets.
            //
            // `cfg(cloud)`, NOT `cfg(enterprise)` (§8.1): a self-hosted
            // Enterprise cluster has no trials and no `customer_billings` rows.
            #[cfg(feature = "cloud")]
            {
                use o2_enterprise::enterprise::{
                    cloud::billings, common::config::get_config as get_o2_config,
                };

                // Read per tick, so a config reload flips the kill switch.
                let trial_period_enabled = get_o2_config().cloud.trial_period_enabled;

                // With the flag off — the DEFAULT — this block reads nothing.
                if trial_gate_reads_needed(trial_period_enabled, &synthetic.org_id) {
                    // FAIL OPEN. Both reads feed a decision that can only ever
                    // STOP a customer's monitoring, so on a read error we log
                    // and run the check anyway; an unreadable row treated as
                    // "expired" turns one flaky query into silently dark
                    // monitoring, invisible because a skipped check looks like a
                    // check that was never due. Every `warn!` below is throttled.
                    let gate_inputs = match billings::get_billing_by_org_id(&synthetic.org_id).await
                    {
                        Ok(billing) => {
                            let subscription = match billing {
                                None => BillingSubscription::Absent,
                                Some(b) if b.subscription_type.is_free_sub() => {
                                    BillingSubscription::Free
                                }
                                Some(_) => BillingSubscription::Paid,
                            };
                            match infra::table::organizations::get(&synthetic.org_id).await {
                                Ok(org) => Some((subscription, org.trial_ends_at)),
                                Err(e) => {
                                    if TRIAL_GATE_LOG.allow(&synthetic.id, "org_read", now_us) {
                                        tracing::warn!(
                                            synthetics_id = %synthetic.id,
                                            org_id = %synthetic.org_id,
                                            "[synthetics scheduler] trial gate: \
                                             organizations::get failed, running the check \
                                             anyway (logged at most hourly per check): {e}"
                                        );
                                    }
                                    None
                                }
                            }
                        }
                        Err(e) => {
                            if TRIAL_GATE_LOG.allow(&synthetic.id, "billing_read", now_us) {
                                tracing::warn!(
                                    synthetics_id = %synthetic.id,
                                    org_id = %synthetic.org_id,
                                    "[synthetics scheduler] trial gate: get_billing_by_org_id \
                                     failed, running the check anyway (logged at most hourly \
                                     per check): {e}"
                                );
                            }
                            None
                        }
                    };

                    if let Some((subscription, trial_ends_at)) = gate_inputs {
                        let verdict = trial_gate_decision(
                            trial_period_enabled,
                            &synthetic.org_id,
                            subscription,
                            trial_ends_at,
                            now_us,
                        );
                        if let TrialGate::Skip { error_source } = verdict {
                            if TRIAL_GATE_LOG.allow(&synthetic.id, ERROR_SOURCE_TRIAL, now_us) {
                                tracing::warn!(
                                    synthetics_id = %synthetic.id,
                                    org_id = %synthetic.org_id,
                                    error_source = %error_source,
                                    "[synthetics scheduler] trial period over — skipping check, \
                                     no run row, no jobs, no Lambda (logged at most hourly per \
                                     check; a lapsed trial does not un-lapse)"
                                );
                            }
                            continue;
                        }
                    }
                }
            }

            // The SLOT that made this check due — not the tick that noticed it.
            //
            // `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)`
            // plus `ON CONFLICT DO NOTHING` exist to make enqueue idempotent, as
            // the design specifies. Stamping `now_us` defeated them completely:
            // every scheduler has its own wall clock at its own tick, so two
            // nodes wrote two different `scheduled_ts` values, never collided,
            // and the constraint never fired. The slot is byte-identical on
            // every node, which is what makes the index a real backstop behind
            // the claim in `claim_due`.
            //
            // It is also the more honest number: queue delay is
            // `started_ts - scheduled_ts`, and against `now_us` that silently
            // excluded up to a full TICK of scheduler lag.
            //
            // `claim_due` maps its rows BEFORE advancing the schedule, so this
            // is the pre-advance value — the slot, not the next one.
            //
            // Falls back to `now_us` when there is no slot: `run_synthetic_now`
            // and re-enable both set `next_run_at = 0` to make a check due
            // immediately (`service.rs:519`, `:389`), and stamping 0 would date
            // the run to the epoch and report a ~56-year queue delay. Dedup does
            // not suffer — `claim_due` has already granted this slot to exactly
            // one node, so the unique index is only a backstop here.
            let scheduled_ts = dedup_slot(synthetic.next_run_at, now_us);

            // `valid_until` stays anchored to NOW, deliberately. Anchoring it to
            // the slot would make a catch-up run after scheduler downtime expire
            // the instant it was created — the TTL is "how long this job stays
            // worth running from the moment it was queued", not "how late it is".
            let valid_until = now_us + synthetic.frequency.interval_secs() * 1_000_000;

            // One job per location; browser_devices JSON carries per-device execution_ids.
            if synthetic.locations.is_empty() {
                tracing::warn!(
                    synthetics_id = %synthetic.id,
                    "[synthetics scheduler] synthetic has no locations — skipping"
                );
                continue;
            }

            // ---- Gate 3 of §7.1 — the FREE STEP POOL ------------------------
            //
            // Resolved ONCE per due check and hoisted above the location loop
            // like the trial gate. The DEDUCT stays per location — §7.1 puts it
            // after the venue check, and a private agent must never deduct (E13).
            //
            // `None` means DO NOT GATE, and every route there is a deliberate
            // fail-open: no `cloud`; `O2_SYNTHETICS_BILLING_ENABLED` off, the
            // default and the whole of §9D's runtime rollback; no pool installed
            // by `init`; a billing read that failed.
            #[cfg(feature = "cloud")]
            let pool_gate = resolve_pool_gate(&synthetic.org_id).await;
            #[cfg(not(feature = "cloud"))]
            let pool_gate: Option<(crate::pool::StepPoolHooks, PoolExhaustionPolicy)> = None;

            // ---- Pass 1: venue, then gate, then plan -------------------------
            //
            // Two passes because `insert_run` stamps `job_count` and a run is
            // complete when that many jobs have acked. A denied slot never acks,
            // so counting it would leave the run permanently short — never
            // complete, never alerted on. `job_count` is knowable only after the
            // gate has run.
            let mut planned: Vec<PlannedSlot> = Vec::with_capacity(synthetic.locations.len());
            let mut denied: Vec<String> = Vec::new();

            for location in &synthetic.locations {
                // ---- Gate 2 of §7.1 — the VENUE -----------------------------
                //
                // One registry read per location, already needed to pick the
                // agent pool. A `KIND_PRIVATE` row is the customer's own
                // hardware, which §7.1 gives "no gate, no deduct, no bill". The
                // match fails CLOSED: an unreadable row counts as public and
                // stays gated, so a registry blip cannot hand out free runs.
                let venue = synthetics_locations::get(location).await;
                let is_private = matches!(
                    &venue,
                    Ok(Some(l)) if l.kind == synthetics_locations::KIND_PRIVATE
                );

                let (pool, browser_devices_json) = if synthetic.check_type == SyntheticType::Browser
                {
                    let entries: Vec<BrowserDeviceEntry> = synthetic
                        .browser_devices
                        .iter()
                        .map(|bd| BrowserDeviceEntry {
                            execution_id: svix_ksuid::Ksuid::new(None, None).to_string(),
                            engine: &bd.browser,
                            device: &bd.device,
                        })
                        .collect();
                    let json = match serde_json::to_string(&entries) {
                        Ok(j) => j,
                        Err(e) => {
                            tracing::error!(
                                synthetics_id = %synthetic.id,
                                location = %location,
                                "[synthetics scheduler] browser_devices serialize: {e}"
                            );
                            continue;
                        }
                    };
                    // Private browser locations are served by a self-hosted
                    // browser agent leasing their own private-* pool; public
                    // browser locations use the aws-browser Lambda venue.
                    let pool = match venue {
                        Ok(Some(l)) if l.kind == synthetics_locations::KIND_PRIVATE => l.pool,
                        _ => "aws-browser".to_string(),
                    };
                    (pool, Some(json))
                } else {
                    // Protocol types route to the location's pool from the
                    // registry (net-<region> for public rows, private-* for
                    // private locations); "aws" is the legacy fallback for
                    // locations not yet in the table.
                    let pool = match venue {
                        Ok(Some(l)) => l.pool,
                        _ => "aws".to_string(),
                    };
                    (pool, None)
                };

                let combos = (synthetic.check_type == SyntheticType::Browser)
                    .then(|| synthetic.browser_devices.len().max(1) as u32);
                let (verdict, reserved) = reserve_for_slot(
                    pool_gate,
                    &synthetic.org_id,
                    synthetic.steps_configured,
                    combos,
                    is_private,
                );
                #[cfg(feature = "cloud")]
                log_pool_gate(&synthetic.id, &synthetic.org_id, location, verdict, now_us);
                if verdict == PoolGate::Skip {
                    denied.push(location.clone());
                    continue;
                }

                planned.push(PlannedSlot {
                    location: location.clone(),
                    pool,
                    browser_devices: browser_devices_json,
                    reserved,
                });
            }

            // Every slot denied: no run row, no jobs, no Lambda.
            if planned.is_empty() {
                report_quota_skips(&synthetic, &denied, scheduled_ts, now_us).await;
                continue;
            }

            let job_count = planned.len() as i32;
            let run_id = svix_ksuid::Ksuid::new(None, None).to_string();
            tracing::info!(
                synthetics_id = %synthetic.id,
                run_id = %run_id,
                job_count = job_count,
                "[synthetics scheduler] firing synthetic"
            );

            if let Err(e) = synthetics_runs::insert_run(
                db,
                synthetics_runs::InsertRunParams {
                    id: &run_id,
                    synthetics_id: &synthetic.id,
                    org_id: &synthetic.org_id,
                    scheduled_ts,
                    trigger_type: "schedule",
                    job_count,
                    created_at: now_us,
                },
            )
            .await
            {
                tracing::error!(
                    synthetics_id = %synthetic.id,
                    run_id = %run_id,
                    "[synthetics scheduler] insert_run: {e}"
                );
                // These reservations are for jobs that will never exist (E10/E11).
                refund_planned(pool_gate, &synthetic.org_id, &planned);
                continue;
            }

            let metadata_json = serde_json::to_string(&synthetics_jobs::JobMetadata {
                tags: synthetic.tags.clone(),
                synthetic_type: serde_json::to_value(&synthetic.check_type)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_default(),
            })
            .unwrap_or_else(|_| "{}".to_string());

            // ---- Pass 2: gate 4 of §7.1 — ENQUEUE ---------------------------
            for slot in &planned {
                let p = synthetics_jobs::EnqueueParams {
                    synthetics_id: &synthetic.id,
                    synthetics_name: &synthetic.name,
                    org_id: &synthetic.org_id,
                    location: &slot.location,
                    pool: &slot.pool,
                    scheduled_ts,
                    valid_until,
                    run_id: &run_id,
                    browser_devices: slot.browser_devices.as_deref(),
                    // Frozen here, not read at ack time: the ack's clamp ceiling
                    // is `steps_configured x (retries + 1)`, and a journey edited
                    // mid-flight must not reprice dispatched work (§4.4.1, E5).
                    steps_configured: synthetic.steps_configured,
                    metadata: &metadata_json,
                };
                match synthetics_jobs::enqueue(db, p).await {
                    Ok(job_id) if !job_id.is_empty() => {
                        tracing::info!(
                            synthetics_id = %synthetic.id,
                            run_id = %run_id,
                            job_id = %job_id,
                            location = %slot.location,
                            "[synthetics scheduler] job enqueued"
                        );
                    }
                    // `ON CONFLICT DO NOTHING` — another node holds this slot.
                    // §7.1 gate 4, E10/T29: THE DEDUCT MUST BE REFUNDED. The
                    // unique index `(synthetics_id, location, scheduled_ts)` is
                    // what makes the enqueue idempotent; without the refund the
                    // losing node holds a reservation no ack will reconcile.
                    Ok(_) => refund_slot(pool_gate, &synthetic.org_id, slot),
                    Err(e) => {
                        tracing::error!(
                            synthetics_id = %synthetic.id,
                            run_id = %run_id,
                            location = %slot.location,
                            "[synthetics scheduler] enqueue: {e}"
                        );
                        refund_slot(pool_gate, &synthetic.org_id, slot);
                    }
                }
            }

            // The denied slots of a check that partly ran still get their record.
            report_quota_skips(&synthetic, &denied, scheduled_ts, now_us).await;
        }
    }
}

/// One location slot that survived gates 2 and 3 and is about to be enqueued.
struct PlannedSlot {
    location: String,
    pool: String,
    /// Frozen `browser_devices` JSON, `None` for a protocol check.
    browser_devices: Option<String>,
    /// What gate 3 took out of the free grant. 0 when nothing was taken — a
    /// private venue, an unmetered build, an exhausted paid org, or a contract
    /// org — so this is also all the refund path needs to look at.
    reserved: u32,
}

/// Gate 3 of §7.1 for ONE location slot: consult the pool, and say what happens.
///
/// Returns the verdict and how many steps came out of the grant — 0 whenever
/// nothing did. Order is §7.1's, and each skip has its own reason:
///
/// ```text
///   no gate resolved   run, unmetered (see the call site's four cases)
///   a PRIVATE venue    run, no gate, no deduct, no bill (§8.2, E13/T17)
///   an ExternalContract  run, no deduct, notify (§7.3, E18/T36)
///   otherwise          reserve `configured x combos`; §7.3 decides what an
///                      exhausted grant means for this org
/// ```
pub(crate) fn reserve_for_slot(
    gate: Option<(crate::pool::StepPoolHooks, PoolExhaustionPolicy)>,
    org_id: &str,
    steps_configured: i32,
    combos: Option<u32>,
    is_private: bool,
) -> (PoolGate, u32) {
    // Not metered on this node, or the customer's own hardware ran it. A private
    // venue is NOT "funded", it is "not billed at all" — calling it funded would
    // make the ack emit `SyntheticsFreeSteps` for work we never paid for.
    let Some((hooks, policy)) = gate.filter(|_| !is_private) else {
        return (PoolGate::Run, 0);
    };

    let want = crate::job_api::enqueue_reservation(steps_configured, combos);
    // §7.3: an ExternalContract org is never pool-gated, so `&&` short-circuits.
    let took = pool_reserves(policy) && (hooks.try_deduct)(org_id, u64::from(want));
    let verdict = pool_gate_decision(policy, took);
    // Only a funded slot holds anything, so only it has anything to refund.
    let reserved = if verdict == PoolGate::Run { want } else { 0 };
    (verdict, reserved)
}

/// One throttled line per gate-3 verdict that is not the happy path.
#[cfg(feature = "cloud")]
fn log_pool_gate(
    synthetics_id: &str,
    org_id: &str,
    location: &str,
    verdict: PoolGate,
    now_us: i64,
) {
    match verdict {
        PoolGate::Run => {}
        PoolGate::RunAsOverage => {
            if POOL_GATE_LOG.allow(synthetics_id, "overage", now_us) {
                tracing::info!(
                    synthetics_id = %synthetics_id,
                    org_id = %org_id,
                    "[synthetics scheduler] free step pool exhausted — running and metering as \
                     overage (logged at most hourly per check)"
                );
            }
        }
        PoolGate::RunAndNotify => {
            if POOL_GATE_LOG.allow(synthetics_id, "contract", now_us) {
                tracing::warn!(
                    synthetics_id = %synthetics_id,
                    org_id = %org_id,
                    "[synthetics scheduler] contract org: synthetics steps are never pool-gated \
                     — running, and this is the notification §7.3 asks for (logged at most \
                     hourly per check)"
                );
            }
        }
        PoolGate::Skip => {
            if POOL_GATE_LOG.allow(synthetics_id, ERROR_SOURCE_QUOTA, now_us) {
                tracing::warn!(
                    synthetics_id = %synthetics_id,
                    org_id = %org_id,
                    location = %location,
                    error_source = %ERROR_SOURCE_QUOTA,
                    "[synthetics scheduler] free step pool exhausted — skipping this slot; the \
                     check STAYS ENABLED and resumes the moment the org subscribes or the limit \
                     is raised (logged at most hourly per check)"
                );
            }
        }
    }
}

/// Give one slot's reservation back — SPEC §7.1 gate 4, E10/E11, T29. Takes the
/// resolved gate, so a build or node with no pool cannot refund into one.
fn refund_slot(
    gate: Option<(crate::pool::StepPoolHooks, PoolExhaustionPolicy)>,
    org_id: &str,
    slot: &PlannedSlot,
) {
    if slot.reserved == 0 {
        return;
    }
    let Some((hooks, _)) = gate else {
        return;
    };
    tracing::info!(
        org_id = %org_id,
        location = %slot.location,
        steps = slot.reserved,
        "[synthetics scheduler] enqueue did not land — refunding the free-pool reservation"
    );
    (hooks.refund)(org_id, u64::from(slot.reserved));
}

/// Give back every reservation, for a run row that could not be written at all.
fn refund_planned(
    gate: Option<(crate::pool::StepPoolHooks, PoolExhaustionPolicy)>,
    org_id: &str,
    planned: &[PlannedSlot],
) {
    for slot in planned {
        refund_slot(gate, org_id, slot);
    }
}

/// Resolve gate 3 for one due check: the installed pool, and the org's §7.3
/// exhaustion policy.
///
/// `None` means DO NOT GATE — see the call site for the four ways there; the
/// billing read FAILS OPEN, since this can only ever stop monitoring.
/// `pub(crate)` because the REAPER resolves the same gate (a job it terminates
/// never acks, E10) and a parallel resolution would be free to drift.
#[cfg(feature = "cloud")]
pub(crate) async fn resolve_pool_gate(
    org_id: &str,
) -> Option<(crate::pool::StepPoolHooks, PoolExhaustionPolicy)> {
    // §9A / §9D: the master switch gates ENFORCEMENT as it gates the ack's emit.
    // Off — the default — means no read, no deduct, no gate.
    if !o2_enterprise::enterprise::common::config::get_config()
        .cloud
        .synthetics_billing_enabled
    {
        return None;
    }
    // No pool here. Fail open: an unmetered fleet beats dark monitoring.
    let hooks = crate::pool::hooks()?;

    let policy =
        o2_enterprise::enterprise::cloud::ai_credits::resolve_ai_credit_exhaustion_policy(org_id)
            .await;
    let policy = match policy {
        o2_enterprise::enterprise::cloud::ai_credits::AiCreditExhaustionPolicy::MeteredOverage => {
            PoolExhaustionPolicy::MeteredOverage
        }
        o2_enterprise::enterprise::cloud::ai_credits::AiCreditExhaustionPolicy::AdditionalCreditsRequired => {
            PoolExhaustionPolicy::AdditionalCreditsRequired
        }
        o2_enterprise::enterprise::cloud::ai_credits::AiCreditExhaustionPolicy::SubscriptionRequired => {
            PoolExhaustionPolicy::SubscriptionRequired
        }
    };
    Some((hooks, policy))
}

/// SPEC §7.3's dead letter for a quota-denied slot.
///
/// *"skip slot, dead-letter, result row `error_source="quota"`"*, and **MUST
/// NOT disable the check**. Same shape and transport as the reaper's dead letter:
/// a row in the org's `synthetics_results` stream plus one in the org's and
/// `_meta`'s `triggers` stream. No new stream, no new schema.
async fn report_quota_skips(
    synthetic: &synthetics_checks::DueCheck,
    denied: &[String],
    scheduled_ts: i64,
    now_us: i64,
) {
    if denied.is_empty() {
        return;
    }
    // One token lookup per denied CHECK, not per denied slot.
    let ingest_token = match org_ingestion_tokens::find_default_enabled(&synthetic.org_id).await {
        Ok(Some(t)) => t.token,
        Ok(None) => {
            tracing::warn!(
                org_id = %synthetic.org_id,
                "[synthetics scheduler] no enabled ingest token — quota skip not recorded"
            );
            return;
        }
        Err(e) => {
            tracing::error!(
                org_id = %synthetic.org_id,
                "[synthetics scheduler] ingest token lookup failed, quota skip not recorded: {e}"
            );
            return;
        }
    };
    // The `_meta` copy authenticates as `_meta`: ingest resolves a token against
    // the URL's org, so the org's own token posted to `/api/_meta/...` 401s.
    let meta_token = match org_ingestion_tokens::find_default_enabled(META_ORG).await {
        Ok(Some(t)) => Some(t.token),
        Ok(None) | Err(_) => None,
    };

    let api_endpoint = config::meta::synthetics::api_endpoint();
    let client = reqwest::Client::new();
    for location in denied {
        let result = quota_result_record(synthetic, location, scheduled_ts, now_us);
        post_json(
            &client,
            &format!(
                "{api_endpoint}/api/{}/synthetics_results/_json",
                synthetic.org_id
            ),
            &ingest_token,
            &result,
            &synthetic.id,
        )
        .await;

        let trigger = quota_trigger_record(synthetic, location, now_us);
        post_json(
            &client,
            &format!("{api_endpoint}/api/{}/triggers/_json", synthetic.org_id),
            &ingest_token,
            &trigger,
            &synthetic.id,
        )
        .await;
        if let Some(meta_token) = meta_token.as_deref() {
            post_json(
                &client,
                &format!("{api_endpoint}/api/{META_ORG}/triggers/_json"),
                meta_token,
                &trigger,
                &synthetic.id,
            )
            .await;
        }
    }
}

/// The `synthetics_results` row a quota-denied slot leaves behind.
///
/// Pure, so §7.3's hard requirements are assertable without an ingest endpoint:
/// it carries `error_source = "quota"` and says nothing about the check's
/// `enabled` state. `execution_id == job_id == ""` because there IS no job.
fn quota_result_record(
    synthetic: &synthetics_checks::DueCheck,
    location: &str,
    scheduled_ts: i64,
    now_us: i64,
) -> serde_json::Value {
    serde_json::json!([{
        "_timestamp": now_us,
        "job_id": "",
        "run_id": "",
        "execution_id": "",
        "synthetics_id": synthetic.id,
        "synthetics_name": synthetic.name,
        "tags": synthetic.tags,
        "org_id": synthetic.org_id,
        "location": location,
        "scheduled_ts": scheduled_ts,
        "status": "error",
        "error_source": ERROR_SOURCE_QUOTA,
        "error": "the organization's included synthetics steps are exhausted, so this run was \
                  skipped. The check is still enabled and resumes automatically once the \
                  organization subscribes or its step limit is raised.",
        "response_time_ms": 0,
        "dispatch_attempt": 0
    }])
}

/// The `triggers` row a quota-denied slot leaves — the half an alert rule reads.
fn quota_trigger_record(
    synthetic: &synthetics_checks::DueCheck,
    location: &str,
    now_us: i64,
) -> serde_json::Value {
    serde_json::json!([{
        "_timestamp": now_us,
        "org": synthetic.org_id,
        "module": "synthetics",
        "key": format!("{}/{}", synthetic.name, synthetic.id),
        "next_run_at": synthetic.next_run_at,
        "is_realtime": false,
        "is_silenced": false,
        "status": "failed",
        "start_time": now_us,
        "end_time": now_us,
        "location": location,
        // The stable field an alert rule filters on: `orphan`, `dispatch` and
        // `quota` share this stream and `status` but need different responses.
        "error_source": ERROR_SOURCE_QUOTA,
        "error": "synthetics step quota exhausted — runs skipped until the organization \
                  subscribes or its step limit is raised"
    }])
}

/// Posts one record and logs what ingest said.
/// A non-2xx is checked explicitly: `send()` resolves to `Ok` for a 401 as
/// readily as for a 200, so treating the transport error as the only failure
/// drops every record from a mis-scoped token and logs nothing.
async fn post_json(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &serde_json::Value,
    synthetics_id: &str,
) {
    match client
        .post(url)
        .basic_auth("ingest", Some(token))
        .json(body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(
                synthetics_id = %synthetics_id,
                url = %url,
                %status,
                "[synthetics scheduler] quota dead-letter write rejected: {}",
                body.chars().take(512).collect::<String>()
            );
        }
        Err(e) => {
            tracing::error!(
                synthetics_id = %synthetics_id,
                url = %url,
                "[synthetics scheduler] quota dead-letter write failed: {e}"
            );
        }
    }
}

/// Compute a check's next run time, anchored to its SCHEDULED time (`anchor`,
/// i.e. the `next_run_at` that made it due) rather than the tick time (`now_us`).
///
/// Anchoring to `now_us` would re-add the scheduler's tick + fetch lag on every
/// cycle, so the effective interval became `configured + lag` and run times
/// drifted ever later with irregular gaps (fixed-delay). Anchoring to the
/// scheduled time keeps the cadence fixed-rate (12:00, 12:01, 12:02, …) ± the
/// tick granularity, with no accumulating drift.
///
/// If the anchored slot is already in the past — the scheduler fell behind
/// (paused / backlog), or a cron slot after the anchor already passed — skip the
/// missed slots forward to the next slot strictly after `now_us`, so the check
/// fires once and re-anchors instead of firing a catch-up burst. Falls back to a
/// `now`-anchored slot if the frequency can't compute (e.g. invalid cron, which
/// is prevented by create/update validation).
/// The `scheduled_ts` stamped on a run and its jobs: the slot that made the
/// check due, falling back to `now_us` when there is no slot.
///
/// Every node must derive the SAME value for a given slot — that is what makes
/// `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)` a real
/// backstop rather than a constraint that never fires.
fn dedup_slot(next_run_at: i64, now_us: i64) -> i64 {
    if next_run_at > 0 { next_run_at } else { now_us }
}

/// Deterministic sub-interval offset for a check, in microseconds.
///
/// Keyed off the check id alone, so every node and restart computes the same
/// value. Load-bearing: the result lands in `next_run_at`, which becomes the
/// `scheduled_ts` feeding `synthetics_jobs_dedup_uq`. A random or per-node
/// offset would make two nodes write different slots for one check, so they
/// would never collide and the duplicate-enqueue backstop would be gone.
///
/// FNV-1a, not `DefaultHasher` (unstable across Rust versions), not `ahash`
/// (randomly seeded per process), not `config::utils::hash::sum64` (gxhash,
/// which falls back to `DefaultHasher` when the feature is off). Changing the
/// hash re-spreads every existing check once; the golden test pins it.
fn jitter_offset_us(synthetics_id: &str, interval_secs: i64) -> i64 {
    if interval_secs <= 0 {
        return 0;
    }
    // A malformed frequency could overflow the microsecond conversion, which
    // panics in debug. This runs inside the claim transaction, so one bad row
    // must not take the scheduler down: treat it as "no jitter".
    let Some(window_us) = interval_secs.checked_mul(1_000_000) else {
        return 0;
    };
    let h = fnv::new().sum64(synthetics_id);
    (h % (window_us as u64)) as i64
}

fn compute_next_run_at(
    freq: &SyntheticFrequency,
    anchor: i64,
    now_us: i64,
    tz_offset: i32,
    synthetics_id: &str,
    jitter_enabled: bool,
) -> i64 {
    let raw = match freq.next_run_at(anchor, tz_offset) {
        // Anchored slot is still in the future — use it as-is (no drift).
        Ok(t) if t > now_us => t,
        // Behind, or cron slot after the anchor already passed — skip forward to
        // the next slot strictly after now (fire once, re-anchor).
        Ok(_) => freq
            .next_run_at(now_us, tz_offset)
            .unwrap_or_else(|_| now_us + freq.interval_secs().max(5) * 1_000_000),
        Err(_) => now_us + freq.interval_secs().max(5) * 1_000_000,
    };

    if !jitter_enabled {
        return raw;
    }
    // A cron slot is a user-stated wall-clock instant: `0 * * * * *` means "on
    // the minute", and shifting it by a hash would break that promise. It is
    // also the divide-by-zero trap — `interval_secs()` is 0 for cron.
    if freq.frequency_type == SyntheticFrequencyType::Cron {
        return raw;
    }
    let interval_secs = freq.interval_secs();
    if interval_secs <= 0 {
        return raw;
    }
    let Some(interval_us) = interval_secs.checked_mul(1_000_000) else {
        return raw;
    };
    let offset = jitter_offset_us(synthetics_id, interval_secs);

    // Snap onto the check's absolute grid (`k * interval + offset`) rather than
    // returning `raw + offset` — that is the difference between jitter and
    // drift. `raw` is `anchor + interval` where `anchor` is the stored
    // `next_run_at`, so adding the offset would bake it into the next cycle's
    // anchor and re-add it every cycle.
    //
    // Snapping is idempotent (on-grid maps to itself, so the steady state is a
    // pure `+ interval`) and self-healing for the writers that bypass this
    // function and store an un-jittered value: `update_synthetic` and `create`
    // with an explicit `start`.
    let mut next = (raw - offset).div_euclid(interval_us) * interval_us + offset;
    // Snapping rounds down, so it can land at or before now; bounded by
    // `offset < interval`, so one interval is always enough.
    if next <= now_us {
        next += interval_us;
    }
    next
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use config::meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType};

    use super::{compute_next_run_at, dedup_slot, jitter_offset_us};

    fn freq(t: SyntheticFrequencyType, interval: i64, cron: &str) -> SyntheticFrequency {
        SyntheticFrequency {
            frequency_type: t,
            interval,
            cron: cron.to_string(),
            timezone: None,
        }
    }

    /// A KSUID-shaped check id, used wherever a test needs *an* id but does not
    /// care which one. Real `synthetics_checks.id` values are 27-char base62
    /// KSUIDs, so tests exercise the hash over the shape it sees in production.
    const ID: &str = "2iRXmH4pQ7bLtVzKcN9sYdFgWjE";

    /// Deterministic KSUID-shaped id generator — an LCG, not an RNG, so the
    /// whole suite is reproducible byte-for-byte on every run and every machine.
    /// Jitter tests must never depend on randomness: the property under test IS
    /// determinism.
    fn ksuid_like(i: u64) -> String {
        const A: u64 = 6364136223846793005;
        const C: u64 = 1442695040888963407;
        const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let mut x = i.wrapping_mul(A).wrapping_add(C);
        let mut s = String::with_capacity(27);
        for _ in 0..27 {
            x = x.wrapping_mul(A).wrapping_add(C);
            s.push(ALPHABET[((x >> 33) % 62) as usize] as char);
        }
        s
    }

    #[test]
    fn compute_interval_seconds() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Seconds, 30, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 30_000_000);
    }

    #[test]
    fn compute_interval_minutes() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Minutes, 5, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 300_000_000);
    }

    #[test]
    fn compute_interval_hours() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Hours, 1, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 3_600_000_000);
    }

    #[test]
    fn compute_cron_empty_errors() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Cron, 0, "");
        assert!(f.next_run_at(now, 0).is_err());
    }

    #[test]
    fn compute_cron_valid() {
        let now_us = 1_000_000_000_000_000i64; // 2001-09-08T21:46:40Z
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *"); // every minute
        let next = f.next_run_at(now_us, 0).unwrap();
        assert!(next > now_us, "next_run_at must be in the future");
        assert!(
            next - now_us <= 120_000_000,
            "next should be within 2 minutes"
        );
    }

    // ── compute_next_run_at: anchoring + skip-missed (the trigger-drift fix) ──

    const MIN_US: i64 = 60_000_000;

    /// On-time cycle: the check fired a little late (now = anchor + 3s tick lag),
    /// but the next run must be anchored to the SCHEDULED time (anchor + 60s),
    /// NOT to now (which would be anchor + 63s → drift).
    #[test]
    fn anchors_to_scheduled_time_not_tick_time() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64; // scheduled due time
        let now = anchor + 3_000_000; // picked up 3s late
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert_eq!(next, anchor + MIN_US, "must anchor to scheduled time");
        assert_ne!(next, now + MIN_US, "must NOT anchor to tick time (drift)");
    }

    /// Repeated cycles never drift: feed each computed next back as the anchor,
    /// with a fresh (varying) tick lag each time — the schedule stays exactly on
    /// the original 1-minute grid.
    #[test]
    fn no_cumulative_drift_across_cycles() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let start = 1_000_000_000_000i64;
        let mut anchor = start;
        for i in 1..=20 {
            let lag = (i % 5) * 1_000_000; // 0..4s of jitter, varies per cycle
            let now = anchor + lag;
            anchor = compute_next_run_at(&f, anchor, now, 0, ID, false);
            assert_eq!(
                anchor,
                start + i * MIN_US,
                "cycle {i} must stay on the fixed grid, no drift"
            );
        }
    }

    /// Skip-missed: scheduler was down long enough that the anchored slot is in
    /// the past — must jump to a single future slot (fire once, re-anchor), NOT
    /// return anchor+interval (still in the past → would burst).
    #[test]
    fn skips_missed_slots_when_behind() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64;
        let now = anchor + 5 * MIN_US + 12_000_000; // ~5 missed minutes + 12s
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now, "must be in the future (fire once, not a burst)");
        assert_ne!(
            next,
            anchor + MIN_US,
            "must skip missed slots, not anchor+1"
        );
    }

    /// Cron on-time: anchored slot is in the future → returned as-is.
    #[test]
    fn cron_anchors_forward() {
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *"); // every minute
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 2_000_000; // 2s late
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now);
        assert!(next - anchor <= 120_000_000);
    }

    /// Cron behind: the slot after the anchor already passed → skip to the next
    /// slot strictly after now.
    #[test]
    fn cron_skips_missed_when_behind() {
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 10 * MIN_US; // 10 minutes behind
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now, "must be after now");
        assert!(
            next - now <= 120_000_000,
            "next slot within ~a minute of now"
        );
    }

    /// Invalid frequency (empty cron) → defensive fallback to a future slot.
    #[test]
    fn invalid_cron_falls_back_to_future() {
        let f = freq(SyntheticFrequencyType::Cron, 0, ""); // errors in next_run_at
        let now = 1_000_000_000_000i64;
        let next = compute_next_run_at(&f, now, now, 0, ID, false);
        assert!(next > now, "fallback must still be in the future");
    }

    /// The dedup key must be the SLOT, so every node computes the same value.
    ///
    /// `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)` +
    /// `ON CONFLICT DO NOTHING` are the design's idempotent enqueue. Stamping
    /// each node's own tick clock meant two schedulers never collided and the
    /// constraint never fired — present in the schema, inert in practice.
    #[test]
    fn scheduled_ts_is_the_slot_not_the_tick() {
        let slot = 1_750_000_000_000_000i64;
        // Two nodes notice the same slot 4s apart. Both must derive the SAME key.
        for tick_lag in [0i64, 1_000_000, 4_000_000] {
            let now_us = slot + tick_lag;
            let scheduled_ts = dedup_slot(slot, now_us);
            assert_eq!(
                scheduled_ts, slot,
                "tick lag {tick_lag} must not change the dedup key"
            );
        }
    }

    /// `run_synthetic_now` and re-enable set `next_run_at = 0` to fire at once.
    /// Using that verbatim would date the run to the epoch and report a ~56-year
    /// queue delay, since queue delay is `started_ts - scheduled_ts`.
    #[test]
    fn scheduled_ts_falls_back_to_now_when_there_is_no_slot() {
        let now_us = 1_750_000_000_000_000i64;
        let no_slot = 0i64;
        let scheduled_ts = dedup_slot(no_slot, now_us);
        assert_eq!(
            scheduled_ts, now_us,
            "a manual run is scheduled for now, not 1970"
        );
    }

    // ── jitter_offset_us: deterministic per-check spread (P1-2) ──────────────
    //
    // Without jitter every check of a given frequency becomes due in the same
    // tick, so a thousand 1-minute checks fan out into a thousand simultaneous
    // Lambda invocations, every minute. The offset spreads them across the
    // interval — but it MUST stay a pure function of the check id, because
    // `scheduled_ts` feeds `synthetics_jobs_dedup_uq` and a per-node or random
    // offset would make two nodes write different slots for the same check.

    /// The offset is a pure function of (id, interval): no clock, no RNG, no
    /// per-process seed. Everything else in this feature rests on this — a value
    /// that varies between calls varies between scheduler nodes, and then
    /// `synthetics_jobs_dedup_uq` never fires.
    #[test]
    fn jitter_offset_is_deterministic_across_calls() {
        let sixty = jitter_offset_us(ID, 60);
        let three_hundred = jitter_offset_us(ID, 300);
        for i in 0..1000 {
            assert_eq!(
                jitter_offset_us(ID, 60),
                sixty,
                "call {i} must return the same offset"
            );
            assert_eq!(
                jitter_offset_us(ID, 300),
                three_hundred,
                "call {i} must return the same offset"
            );
        }
    }

    /// Spec §3.3: the offset lives in `[0, interval)`. An offset that reached
    /// `interval` would push the check past its *next* slot — i.e. silently skip
    /// a run — and a negative one would schedule it in the past.
    #[test]
    fn jitter_offset_is_within_the_interval_window() {
        for interval_secs in [1i64, 30, 60, 300, 3_600, 86_400] {
            let window_us = interval_secs * 1_000_000;
            for i in 0..500u64 {
                let id = ksuid_like(i);
                let offset = jitter_offset_us(&id, interval_secs);
                assert!(
                    offset >= 0,
                    "offset must never be negative: id={id} interval={interval_secs}s offset={offset}"
                );
                assert!(
                    offset < window_us,
                    "offset must stay inside the window: id={id} interval={interval_secs}s offset={offset}"
                );
            }
        }
    }

    /// The test that proves the feature actually works: 10 000 checks on a
    /// 1-minute frequency must land roughly evenly across the 60 seconds of the
    /// minute, not pile up in a few buckets. A uniform hash gives ~1.67% per
    /// bucket; anything over ~4% means the spread is lumpy and the thundering
    /// herd is only partly broken. Every bucket must also be used — an unused
    /// second is a second of capacity the spread never reaches.
    #[test]
    fn jitter_offset_spreads_evenly_across_the_window() {
        const N: usize = 10_000;
        const BUCKETS: usize = 60;
        let mut hist = [0usize; BUCKETS];
        for i in 0..N as u64 {
            let offset = jitter_offset_us(&ksuid_like(i), 60);
            hist[(offset / 1_000_000) as usize] += 1;
        }
        let cap = N * 4 / 100; // ~4% ceiling; uniform is ~1.67%
        for (second, &count) in hist.iter().enumerate() {
            assert!(
                count > 0,
                "second {second} of the minute got no checks — spread has holes"
            );
            assert!(
                count <= cap,
                "second {second} holds {count} of {N} checks (> {cap}) — spread is lumpy"
            );
        }
    }

    /// GOLDEN TEST — do not "fix" this by updating the numbers.
    ///
    /// Pins the exact hash. Swapping it silently re-spreads every existing
    /// check, and mid-deploy two nodes on different builds would disagree about
    /// `scheduled_ts`, so the dedup index stops firing. A deliberate change here
    /// means a one-time re-spread of the whole fleet — say so in the PR.
    #[test]
    fn jitter_offset_golden_values_pin_the_hash() {
        // FNV-1a("2iRXmH4pQ7bLtVzKcN9sYdFgWjE") = 634995206104941817
        assert_eq!(
            jitter_offset_us("2iRXmH4pQ7bLtVzKcN9sYdFgWjE", 60),
            4_941_817
        );
        assert_eq!(
            jitter_offset_us("2iRXmH4pQ7bLtVzKcN9sYdFgWjE", 300),
            4_941_817
        );

        // FNV-1a("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA") = 9980322736069499633
        assert_eq!(
            jitter_offset_us("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA", 60),
            49_499_633
        );
        assert_eq!(
            jitter_offset_us("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA", 300),
            169_499_633
        );

        // FNV-1a("1hVqB6xTnR4mKdW9zPsLcYfJgE2") = 13330849846794661402
        assert_eq!(
            jitter_offset_us("1hVqB6xTnR4mKdW9zPsLcYfJgE2", 60),
            54_661_402
        );
        assert_eq!(
            jitter_offset_us("1hVqB6xTnR4mKdW9zPsLcYfJgE2", 300),
            294_661_402
        );
    }

    /// `interval_secs()` returns 0 for cron and could be non-positive for a
    /// malformed frequency. The offset is `hash % (interval_secs * 1_000_000)`,
    /// so an unguarded 0 is a divide-by-zero panic inside the scheduler's claim
    /// transaction — one bad row would take the whole scheduler down.
    #[test]
    fn jitter_offset_is_zero_for_non_positive_interval() {
        assert_eq!(
            jitter_offset_us(ID, 0),
            0,
            "cron yields interval_secs() == 0"
        );
        assert_eq!(jitter_offset_us(ID, -1), 0);
        assert_eq!(jitter_offset_us("", 0), 0);
    }

    // ── compute_next_run_at with jitter ──────────────────────────────────────

    /// The jittered run lands on the check's OWN grid — `k * interval + offset`
    /// — and never further than one interval away from now. `next % interval ==
    /// offset` is exactly "inside `[slot, slot + interval)`" with the slot being
    /// the grid cell the run falls in.
    #[test]
    fn jittered_run_lands_on_the_checks_own_grid_slot() {
        let f = freq(SyntheticFrequencyType::Minutes, 5, "");
        let interval_us = 300 * 1_000_000i64;
        let anchor = 1_750_000_000_000_000i64;
        let now = anchor + 3_000_000; // 3s tick lag, the check is due
        let offset = jitter_offset_us(ID, 300);

        let next = compute_next_run_at(&f, anchor, now, 0, ID, true);

        assert_eq!(
            next.rem_euclid(interval_us),
            offset,
            "run must sit exactly `offset` into its grid slot"
        );
        assert!(next > now, "next run must be strictly in the future");
        assert!(
            next - now <= interval_us,
            "jitter must never delay a run by more than one interval"
        );
    }

    /// Cron is a user-stated wall-clock instant: `0 * * * * *` means "on the
    /// minute", and shifting it by a hash would break that promise (spec §3.3).
    /// It is also the divide-by-zero trap — `interval_secs()` is 0 for cron, so
    /// any `% (interval_secs * 1_000_000)` reached by a cron frequency panics.
    #[test]
    fn cron_is_never_jittered() {
        // Valid cron: interval_secs() == 0, so this also proves no divide-by-zero.
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        assert_eq!(
            f.interval_secs(),
            0,
            "cron has no interval to jitter within"
        );
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 2_000_000;
        let jittered = compute_next_run_at(&f, anchor, now, 0, ID, true);
        let plain = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert_eq!(
            jittered, plain,
            "cron must be byte-identical with jitter on and off"
        );
        assert_eq!(
            jittered % 60_000_000,
            0,
            "`0 * * * * *` must still fire exactly on the minute"
        );

        // Invalid cron: next_run_at errors, interval_secs() is still 0 — the
        // fallback path must not reach a modulo either.
        let bad = freq(SyntheticFrequencyType::Cron, 0, "");
        let now = 1_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&bad, now, now, 0, ID, true),
            compute_next_run_at(&bad, now, now, 0, ID, false),
            "the invalid-cron fallback must not be jittered (and must not panic)"
        );
    }

    /// The kill switch (`ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED=false`) must
    /// restore today's behaviour exactly — not approximately. These literals are
    /// the values the pre-jitter tests above assert, repeated here so the switch
    /// is pinned independently of them.
    #[test]
    fn jitter_disabled_is_byte_identical_to_today() {
        // Interval, on time: anchored to the scheduled time, not the tick.
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&f, anchor, anchor + 3_000_000, 0, ID, false),
            1_000_060_000_000,
        );

        // Interval, behind: skip the missed slots, re-anchor on now.
        let behind = anchor + 5 * MIN_US + 12_000_000;
        assert_eq!(
            compute_next_run_at(&f, anchor, behind, 0, ID, false),
            behind + MIN_US,
        );

        // Cron, on time: the next stated wall-clock instant.
        let c = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        let cron_anchor = 1_000_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&c, cron_anchor, cron_anchor + 2_000_000, 0, ID, false),
            1_000_000_020_000_000,
        );

        // Invalid cron: defensive `now + 5s` fallback.
        let bad = freq(SyntheticFrequencyType::Cron, 0, "");
        assert_eq!(
            compute_next_run_at(&bad, anchor, anchor, 0, ID, false),
            1_000_005_000_000,
        );
    }

    /// `run_synthetic_now` and re-enable set `next_run_at = 0` so the check is
    /// due on the very next tick (`service.rs:519`, `:389`). Jitter must not
    /// turn "run it now" into "run it up to a whole interval from now" — a user
    /// pressing Run would sit watching nothing happen for a minute.
    #[test]
    fn run_now_anchor_zero_still_fires_promptly() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let now = 1_750_000_000_000_000i64;
        let next = compute_next_run_at(&f, 0, now, 0, ID, true);
        assert!(next > now, "must be strictly in the future");
        assert!(
            next - now <= MIN_US,
            "an explicitly-triggered run must not be pushed out a whole interval"
        );
        assert_eq!(
            next.rem_euclid(MIN_US),
            jitter_offset_us(ID, 60),
            "and it must still land on the check's grid"
        );
    }

    /// THE dedup guarantee. Two nodes see the same check at the same slot but on
    /// their own clocks, up to a TICK apart, and must compute a byte-identical
    /// next slot — that value becomes `scheduled_ts`, and
    /// `synthetics_jobs_dedup_uq` + `ON CONFLICT DO NOTHING` is the last
    /// backstop against duplicate dispatch. If this regresses the two nodes
    /// never collide and that backstop is silently gone.
    #[test]
    fn two_scheduler_nodes_compute_the_same_next_slot() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        // Steady state: the stored slot is already on this check's grid.
        let seed = 1_750_000_000_000_000i64;
        let slot = compute_next_run_at(&f, seed, seed, 0, ID, true);

        let node_a = compute_next_run_at(&f, slot, slot, 0, ID, true);
        let node_b = compute_next_run_at(&f, slot, slot + 1_000_000, 0, ID, true);
        let node_c = compute_next_run_at(&f, slot, slot + 4_000_000, 0, ID, true);

        assert_eq!(node_a, node_b, "1s of tick lag must not change the slot");
        assert_eq!(node_a, node_c, "4s of tick lag must not change the slot");
        assert_eq!(node_a, slot + MIN_US, "and the slot is the next grid point");
    }

    /// Jitter changes the VALUE of `next_run_at`, never the SHAPE of the dedup
    /// key: `dedup_slot` still hands back the stored slot verbatim, so the tuple
    /// `(synthetics_id, location, scheduled_ts)` is the same tuple it was, and
    /// the unique index still suppresses a second enqueue for the same slot.
    /// Modelled with a set rather than a database so the test stays pure.
    #[test]
    fn jitter_does_not_change_the_shape_of_the_dedup_key() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let seed = 1_750_000_000_000_000i64;
        let jittered_slot = compute_next_run_at(&f, seed, seed, 0, ID, true);
        assert_ne!(
            jittered_slot.rem_euclid(MIN_US),
            0,
            "precondition: this check's slot really is off the round minute"
        );

        // A jittered slot flows through `dedup_slot` unchanged, whatever the tick.
        for tick_lag in [0i64, 1_000_000, 4_000_000] {
            assert_eq!(
                dedup_slot(jittered_slot, jittered_slot + tick_lag),
                jittered_slot,
                "the jittered slot IS the dedup key"
            );
        }

        // `ON CONFLICT DO NOTHING`: the second insert of the same tuple is a no-op.
        let mut index: HashSet<(&str, &str, i64)> = HashSet::new();
        let key = (ID, "us-east-1", dedup_slot(jittered_slot, jittered_slot));
        assert!(index.insert(key), "first enqueue wins");
        assert!(
            !index.insert(key),
            "second enqueue for the same slot is dropped"
        );
        // A different location is a different job, not a duplicate.
        assert!(index.insert((ID, "eu-west-1", key.2)));
    }

    /// The acceptance criterion: 100 checks on the same 1-minute frequency must
    /// no longer fire in the same second. Before jitter the answer here was 1 —
    /// every check due at `:00`, one spike per minute into the dispatcher.
    #[test]
    fn distinct_checks_spread_across_the_minute() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_750_000_000_000_000i64;
        let now = anchor + 3_000_000;

        let seconds: HashSet<i64> = (0..100u64)
            .map(|i| {
                let id = ksuid_like(i);
                let next = compute_next_run_at(&f, anchor, now, 0, &id, true);
                (next / 1_000_000) % 60
            })
            .collect();

        assert!(
            seconds.len() > 45,
            "100 same-frequency checks must span > 45 distinct seconds, got {}",
            seconds.len()
        );
    }

    // ── jitter must not become drift ─────────────────────────────────────────

    /// The failure mode this feature is one line away from: returning
    /// `anchor + interval + offset` bakes the offset into the next cycle's
    /// anchor and re-adds it every cycle, so the check slides later forever.
    /// Snapping onto the absolute grid is idempotent, so the gap stays exactly
    /// the interval.
    #[test]
    fn no_cumulative_drift_across_cycles_with_jitter() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);
        let mut anchor = 1_000_000_000_000i64;
        let mut grid_start = 0i64;
        let mut prev = 0i64;

        for i in 1..=20 {
            let lag = (i % 5) * 1_000_000; // 0..4s of tick lag, varies per cycle
            let now = anchor + lag;
            let next = compute_next_run_at(&f, anchor, now, 0, ID, true);

            assert_eq!(
                next.rem_euclid(MIN_US),
                offset,
                "cycle {i} must stay on the check's jittered grid"
            );
            if i == 1 {
                grid_start = next;
            } else {
                assert_eq!(
                    next - prev,
                    MIN_US,
                    "cycle {i}: gap must be exactly the interval — jitter is not re-added"
                );
                assert_eq!(
                    next,
                    grid_start + (i - 1) * MIN_US,
                    "cycle {i} must stay on the fixed grid, no accumulated drift"
                );
            }
            prev = next;
            anchor = next;
        }
    }

    /// Idempotence, stated directly: an anchor that is already on the grid
    /// advances by exactly one interval and by nothing else. This is what makes
    /// the steady state drift-free.
    #[test]
    fn jitter_is_idempotent_on_an_on_grid_anchor() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);
        let anchor = 29_166_666 * MIN_US + offset; // on-grid by construction
        let now = anchor + 3_000_000;
        assert_eq!(
            compute_next_run_at(&f, anchor, now, 0, ID, true),
            anchor + MIN_US,
            "an on-grid anchor must advance by exactly one interval"
        );
    }

    /// Self-healing. Two writers bypass `compute_next_run_at` entirely and store
    /// an un-jittered `next_run_at`: `update_synthetic` writes a raw
    /// `frequency.next_run_at(now)` (`service.rs:236-242`) and `create` writes
    /// `check.start` (`synthetics_checks.rs:312`). Both land off the check's
    /// grid; the next scheduler pass must pull them back onto it, so an edited
    /// check does not stay unspread forever.
    #[test]
    fn off_grid_anchor_is_pulled_onto_the_grid_in_one_pass() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);

        // What `update_synthetic` stores: now + interval, no jitter.
        let edited_at = 1_000_000_000_000i64;
        let anchor = f.next_run_at(edited_at, 0).unwrap();
        assert_ne!(
            anchor.rem_euclid(MIN_US),
            offset,
            "precondition: the stored anchor really is off the grid"
        );

        // The check comes due at that anchor and the scheduler picks it up 2s late.
        let now = anchor + 2_000_000;
        let next = compute_next_run_at(&f, anchor, now, 0, ID, true);
        assert_eq!(
            next.rem_euclid(MIN_US),
            offset,
            "one pass must snap the check onto its grid"
        );
        assert!(next > now, "and still be in the future");
        assert!(
            next - now <= MIN_US,
            "without skipping more than one interval"
        );

        // And it stays there.
        assert_eq!(
            compute_next_run_at(&f, next, next + 1_000_000, 0, ID, true),
            next + MIN_US,
            "subsequent passes are pure fixed-rate advances"
        );
    }
}

/// The trial gate — §7.1 gate order, §7.2's live bug, E19/E20, T34. Every case
/// here is a pure call: no database, no config, no clock.
#[cfg(test)]
mod trial_gate_tests {
    use super::{
        BillingSubscription, ERROR_SOURCE_TRIAL, LogCooldown, TRIAL_GATE_LOG_COOLDOWN_US,
        TrialGate, trial_gate_decision, trial_gate_reads_needed,
    };

    const ON: bool = true;
    const OFF: bool = false;

    /// A trial that ended at this instant, rounded so the boundary case is exact.
    const TRIAL_ENDS: i64 = 1_800_000_000_000_000;
    const AN_HOUR: i64 = 3_600_000_000;

    const ORG: &str = "cust_7f2a";

    /// A KSUID-shaped check id — the throttle is keyed by `synthetics_checks.id`.
    const A_CHECK: &str = "2iRXmH4pQ7bLtVzKcN9sYdFgWjE";

    fn run(expected: TrialGate, actual: TrialGate, why: &str) {
        assert_eq!(expected, actual, "{why}");
    }

    fn skip() -> TrialGate {
        TrialGate::Skip {
            error_source: ERROR_SOURCE_TRIAL,
        }
    }

    /// This file minus the test modules, so an assertion cannot match its own text.
    fn source_above_the_tests() -> String {
        let whole = include_str!("scheduler.rs");
        let tests_start = whole
            .find("\n#[cfg(test)]")
            .expect("scheduler.rs must still end in test modules");
        whole[..tests_start].to_string()
    }

    /// Byte range of the block opened by the first non-definition call to `needle`.
    fn guarded_block(src: &str, needle: &str) -> (usize, usize) {
        let def_ident_at = src
            .find(&["fn ", needle].concat())
            .expect("the guard must be defined in this file")
            + 3;
        let call_at = src
            .match_indices(needle)
            .map(|(i, _)| i)
            .find(|i| *i != def_ident_at)
            .expect("the guard must be called from the scheduler");
        let open = call_at
            + src[call_at..]
                .find('{')
                .expect("a block must follow the guard");
        let mut depth = 0usize;
        for (i, c) in src[open..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return (open, open + i);
                    }
                }
                _ => {}
            }
        }
        panic!("the guard's block is not brace-balanced");
    }

    /// The vocabulary value, pinned. Nothing WRITES it yet — the denied slot is
    /// logged, not persisted — but §7.2 and the cooldown key need this spelling.
    #[test]
    fn the_error_source_is_trial() {
        assert_eq!(ERROR_SOURCE_TRIAL, "trial");
    }

    /// **T34 — the live bug of §7.2.** A trial-expired org costs us a Lambda
    /// invocation, a browser journey and an S3 write, and then has its result
    /// rejected at ingest with a 429. Under step billing the steps arrive on the
    /// *ack*, not an ingest route, so the org would be BILLED for data it never
    /// receives. The gate must deny before anything is enqueued.
    #[test]
    fn t34_trial_expired_org_is_skipped() {
        run(
            skip(),
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Absent,
                TRIAL_ENDS,
                TRIAL_ENDS + 1,
            ),
            "a trial-expired org with no billing row must not be scheduled at all",
        );
    }

    #[test]
    fn an_org_still_inside_its_trial_runs() {
        run(
            TrialGate::Run,
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Absent,
                TRIAL_ENDS,
                TRIAL_ENDS - AN_HOUR,
            ),
            "a live trial is the normal case and must not be gated",
        );
    }

    /// Arm 1. The fleet-wide kill switch, and the escape hatch if the gate ever
    /// misfires; it must win over every date, which is why it is the first arm.
    #[test]
    fn trial_checking_disabled_runs_regardless_of_dates() {
        for subscription in [
            BillingSubscription::Absent,
            BillingSubscription::Free,
            BillingSubscription::Paid,
        ] {
            run(
                TrialGate::Run,
                trial_gate_decision(
                    OFF,
                    ORG,
                    subscription,
                    TRIAL_ENDS,
                    TRIAL_ENDS + 365 * 24 * AN_HOUR,
                ),
                "with trial checking off, nothing is gated — not even a year past expiry",
            );
        }
    }

    /// Arm 2. Gating `_meta` would silently stop the platform's own checks.
    #[test]
    fn the_meta_org_always_runs() {
        run(
            TrialGate::Run,
            trial_gate_decision(
                ON,
                config::META_ORG_ID,
                BillingSubscription::Absent,
                TRIAL_ENDS,
                TRIAL_ENDS + 365 * 24 * AN_HOUR,
            ),
            "the meta org is exempt in `is_org_in_free_trial_period` and must stay exempt here",
        );
        assert_eq!(
            config::META_ORG_ID,
            "_meta",
            "the exemption is keyed on this literal in core's copy of the rule"
        );
    }

    /// Arm 3. Reading the dates for a paying customer would stop its checks the
    /// moment the original trial lapsed. `Paid` covers ExternalContract too.
    #[test]
    fn a_paid_subscription_runs_past_trial_end() {
        run(
            TrialGate::Run,
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Paid,
                TRIAL_ENDS,
                TRIAL_ENDS + 365 * 24 * AN_HOUR,
            ),
            "a paid subscription short-circuits the date check entirely",
        );
    }

    /// Arm 4, easy to get wrong: a `customer_billings` row EXISTS, so a naive
    /// `is_some()` would run it. `is_free_sub()` falls through to the dates.
    #[test]
    fn a_free_subscription_past_trial_end_is_skipped() {
        run(
            skip(),
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Free,
                TRIAL_ENDS,
                TRIAL_ENDS + 1,
            ),
            "a free-plan row is not a subscription for this purpose — the dates still decide",
        );
    }

    #[test]
    fn a_free_subscription_inside_the_window_runs() {
        run(
            TrialGate::Run,
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Free,
                TRIAL_ENDS,
                TRIAL_ENDS - 1,
            ),
            "free plan, trial not yet over",
        );
    }

    /// **The boundary, pinned deliberately.** Core denies on
    /// `now > org.trial_ends_at`, so `trial_ends_at` itself is still inside the
    /// trial; a refactor to `>=` moves the boundary by one microsecond,
    /// invisible in every other test here. Two adjacent instants are asserted so
    /// the direction of the comparison is unambiguous.
    #[test]
    fn the_boundary_instant_still_runs() {
        run(
            TrialGate::Run,
            trial_gate_decision(ON, ORG, BillingSubscription::Absent, TRIAL_ENDS, TRIAL_ENDS),
            "now == trial_ends_at is INSIDE the trial — core uses `now > trial_ends_at` to deny",
        );
        run(
            skip(),
            trial_gate_decision(
                ON,
                ORG,
                BillingSubscription::Absent,
                TRIAL_ENDS,
                TRIAL_ENDS + 1,
            ),
            "one microsecond later is outside it",
        );
    }

    /// **E19 — a contract that expires.** Expiry deletes the org's
    /// `customer_billings` row, turning `Paid` into `Absent` with no other state
    /// changing; the gate falls through to the long-past dates and skips the
    /// SLOT — the check stays enabled, so re-signing resumes it.
    #[test]
    fn e19_contract_expiry_flips_the_verdict_by_the_row_alone() {
        let (org, ends, now) = (ORG, TRIAL_ENDS, TRIAL_ENDS + 365 * 24 * AN_HOUR);
        run(
            TrialGate::Run,
            trial_gate_decision(ON, org, BillingSubscription::Paid, ends, now),
            "while the contract row exists the org runs",
        );
        run(
            skip(),
            trial_gate_decision(ON, org, BillingSubscription::Absent, ends, now),
            "the row is deleted at contract end — same org, same dates, opposite verdict",
        );
    }

    /// **E20 — a trial that expires between enqueue and ack.** The gate has no
    /// memory and no side effects: its verdict is a function of THIS tick's
    /// inputs, so it cannot un-enqueue a job. That is what makes "in-flight acks
    /// still bill; the next enqueue blocks" a property of the gate, not the ack.
    #[test]
    fn e20_expiry_mid_flight_only_affects_the_next_tick() {
        let before = TRIAL_ENDS - AN_HOUR;
        let after = TRIAL_ENDS + AN_HOUR;

        let at_enqueue =
            trial_gate_decision(ON, ORG, BillingSubscription::Absent, TRIAL_ENDS, before);
        run(
            TrialGate::Run,
            at_enqueue,
            "the enqueueing tick was inside the trial",
        );

        run(
            skip(),
            trial_gate_decision(ON, ORG, BillingSubscription::Absent, TRIAL_ENDS, after),
            "a later tick, past expiry, blocks the NEXT enqueue",
        );

        // Unchangeable: no memo, no interior mutability, no clock read of its own.
        for _ in 0..3 {
            run(
                at_enqueue,
                trial_gate_decision(ON, ORG, BillingSubscription::Absent, TRIAL_ENDS, before),
                "the gate is pure — the already-enqueued job is never reconsidered",
            );
        }
    }

    /// **§7.1 — the gate is HOISTED OUT of the location loop.**
    ///
    /// Structural, because a call in the wrong place still returns the right
    /// answer. Inside the loop it would cost N billing + organizations reads per
    /// due check per tick, and could burn a one-time grant on a check the gate
    /// had already denied — §7.1's MUST NOT. The definition site is excluded, so
    /// the assertion is "exactly one CALL".
    #[test]
    fn trial_gate_is_hoisted_out_of_the_location_loop() {
        // Assembled at runtime so nothing here can match this test's own text.
        let gate = ["trial_gate", "_decision("].concat();
        let loop_head = ["for location in &synthetic", ".locations {"].concat();

        let whole = include_str!("scheduler.rs");
        let tests_start = whole
            .find("\n#[cfg(test)]")
            .expect("scheduler.rs must still end in test modules");
        let src = &whole[..tests_start];

        let loop_at = src
            .find(&loop_head)
            .expect("the per-location fan-out loop must still exist in scheduler::run");

        let def_at = src
            .find(&["fn ", &gate].concat())
            .expect("trial_gate_decision must be defined in this file");
        let def_ident_at = def_at + 3;

        let calls: Vec<usize> = src
            .match_indices(&gate)
            .map(|(i, _)| i)
            .filter(|i| *i != def_ident_at)
            .collect();

        assert_eq!(
            calls.len(),
            1,
            "the trial gate must be called exactly once per due check — {} call site(s) found. \
             One per location would multiply the billing reads by the location count and, from \
             Phase 2, could deduct from the free pool for a check the gate denies (§7.1).",
            calls.len()
        );
        assert!(
            calls[0] < loop_at,
            "the trial gate call is at byte {} and the location loop opens at byte {} — the gate \
             MUST be hoisted ABOVE the loop (§7.1)",
            calls[0],
            loop_at
        );
    }

    /// **The gate must PREVENT the work, not merely precede the fan-out.**
    ///
    /// The hoisting test pins the call above the location loop, but the run row
    /// is written *before* that loop — a call satisfying it could still leave a
    /// denied check with a zero-job run row in the UI forever. §7.2's stronger
    /// guarantee: on `Skip` there is no run row, no job, no Lambda invocation.
    #[test]
    fn a_denied_check_cannot_reach_insert_run_or_enqueue() {
        let gate = ["trial_gate", "_decision("].concat();
        let insert_run = ["synthetics_runs::", "insert_run("].concat();
        let enqueue = ["synthetics_jobs::", "enqueue("].concat();

        let whole = include_str!("scheduler.rs");
        let tests_start = whole
            .find("\n#[cfg(test)]")
            .expect("scheduler.rs must still end in test modules");
        let src = &whole[..tests_start];

        let def_ident_at = src
            .find(&["fn ", &gate].concat())
            .expect("trial_gate_decision must be defined in this file")
            + 3;
        let call_at = src
            .match_indices(&gate)
            .map(|(i, _)| i)
            .find(|i| *i != def_ident_at)
            .expect("the trial gate must be called from the scheduler");

        let insert_at = src
            .find(&insert_run)
            .expect("the scheduler must still write the run row");
        let enqueue_at = src
            .find(&enqueue)
            .expect("the scheduler must still enqueue jobs");

        assert!(
            call_at < insert_at,
            "the trial gate is called at byte {call_at} but the run row is written at byte \
             {insert_at} — a denied check would still leave a run row behind (§7.2)"
        );
        assert!(
            call_at < enqueue_at,
            "the trial gate is called at byte {call_at} but jobs are enqueued at byte \
             {enqueue_at} — a denied check must never reach the queue, which is what stops the \
             Lambda invocation we pay for (§7.2, T34)"
        );

        // The verdict must be ACTED ON, not merely computed, and "a `continue`
        // below the call" is too weak — the per-check body has another early exit
        // above the run row. So require the exit INSIDE the `Skip` arm's block.
        let arm_kw = "= verdict {";
        let brace_at = call_at
            + src[call_at..]
                .find(arm_kw)
                .expect("the gate's verdict must be matched against `TrialGate::Skip`")
            + arm_kw.len()
            - 1;
        let mut depth = 0usize;
        let mut arm_end = None;
        for (i, c) in src[brace_at..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        arm_end = Some(brace_at + i);
                        break;
                    }
                }
                _ => {}
            }
        }
        let arm_end = arm_end.expect("the Skip arm's block must be brace-balanced");
        assert!(
            src[brace_at..arm_end].contains("continue;"),
            "the trial gate's `Skip` arm does not leave the per-check body, so a denied check \
             falls straight through to `insert_run` and the enqueue below it (§7.2, T34)"
        );
    }

    // ── the fleet-wide kill switch must also switch off the COST ────────────

    /// The flag defaults to **false**, the shape almost every build runs in;
    /// before the short-circuit it disabled the decision, not its two reads.
    #[test]
    fn the_kill_switch_skips_the_reads_entirely() {
        assert!(
            !trial_gate_reads_needed(OFF, ORG),
            "with trial checking off there is no date to consult, so there is nothing to read"
        );
        assert!(
            trial_gate_reads_needed(ON, ORG),
            "with it on the gate genuinely needs a subscription and a trial end date"
        );
    }

    /// Arm 2 at the caller: core returns for `_meta` before either of its reads.
    #[test]
    fn the_meta_org_needs_no_reads_either() {
        assert!(!trial_gate_reads_needed(ON, config::META_ORG_ID));
    }

    /// The short-circuit removes only reads the pure function was going to
    /// ignore: where the caller skips them, the verdict is `Run` regardless.
    #[test]
    fn skipping_the_reads_never_changes_the_verdict() {
        for (enabled, org) in [
            (OFF, ORG),
            (OFF, config::META_ORG_ID),
            (ON, config::META_ORG_ID),
        ] {
            assert!(!trial_gate_reads_needed(enabled, org));
            for subscription in [
                BillingSubscription::Absent,
                BillingSubscription::Free,
                BillingSubscription::Paid,
            ] {
                for now in [
                    TRIAL_ENDS - AN_HOUR,
                    TRIAL_ENDS,
                    TRIAL_ENDS + 365 * 24 * AN_HOUR,
                ] {
                    run(
                        TrialGate::Run,
                        trial_gate_decision(enabled, org, subscription, TRIAL_ENDS, now),
                        "the caller only skips the reads where the verdict is `Run` regardless",
                    );
                }
            }
        }
    }

    /// **The reads must sit BEHIND the short-circuit, not merely after it.** A
    /// read hoisted above the guard still answers right, it just costs two
    /// queries per check per tick again.
    #[test]
    fn the_gates_reads_sit_inside_the_short_circuit() {
        let guard = ["trial_gate", "_reads_needed("].concat();
        let billing_read = ["get_billing_by", "_org_id("].concat();
        let org_read = ["infra::table::organizations", "::get("].concat();

        let src = source_above_the_tests();
        let (open, end) = guarded_block(&src, &guard);

        for read in [&billing_read, &org_read] {
            let sites: Vec<usize> = src.match_indices(read.as_str()).map(|(i, _)| i).collect();
            assert_eq!(
                sites.len(),
                1,
                "the trial gate must issue `{read}` exactly once per due check, found {}",
                sites.len()
            );
            assert!(
                sites[0] > open && sites[0] < end,
                "`{read}` is at byte {} but the short-circuit's block is bytes {open}..{end} — \
                 the read must not be issued before the gate has decided it needs it",
                sites[0]
            );
        }
    }

    // ── the warn flood ──────────────────────────────────────────────────────

    #[test]
    fn a_repeated_line_is_emitted_once_per_window() {
        let log = LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US);
        let t0 = TRIAL_ENDS;
        assert!(
            log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0),
            "the first line always gets through — the throttle must not hide the problem"
        );
        assert!(
            !log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0),
            "the same tick must not log the same thing twice"
        );
        assert!(
            !log.allow(
                A_CHECK,
                ERROR_SOURCE_TRIAL,
                t0 + TRIAL_GATE_LOG_COOLDOWN_US - 1
            ),
            "one microsecond short of the window is still inside it"
        );
        assert!(
            log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0 + TRIAL_GATE_LOG_COOLDOWN_US),
            "the window expiring must re-enable the line"
        );
        assert!(
            !log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0 + TRIAL_GATE_LOG_COOLDOWN_US),
            "and start a fresh window rather than staying open"
        );
    }

    /// The flood at its real cadence: one lapsed org with twenty 1-minute checks
    /// over half an hour of 5s ticks — unthrottled, 20 x 360 = 7 200 warnings.
    #[test]
    fn a_lapsed_org_does_not_re_log_every_tick() {
        let log = LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US);
        let ids: Vec<String> = (0..20).map(|i| format!("check_{i}")).collect();
        let mut lines = 0usize;
        for tick in 0..360i64 {
            let now = TRIAL_ENDS + tick * 5_000_000; // TICK is 5s
            for id in &ids {
                if log.allow(id, ERROR_SOURCE_TRIAL, now) {
                    lines += 1;
                }
            }
        }
        assert_eq!(
            lines,
            ids.len(),
            "half an hour of ticks must cost one line per check, not one per check per tick"
        );
    }

    /// The reasons are independent: a failing billing query must not silence the
    /// trial-expiry line for the same check, nor one check silence another.
    #[test]
    fn the_cooldown_is_keyed_by_check_and_reason() {
        let log = LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US);
        let t0 = TRIAL_ENDS;
        assert!(log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0));
        assert!(
            log.allow(A_CHECK, "billing_read", t0),
            "a different reason for the same check is a different line"
        );
        assert!(
            log.allow("another_check", ERROR_SOURCE_TRIAL, t0),
            "a different check is a different line"
        );
        assert!(!log.allow(A_CHECK, ERROR_SOURCE_TRIAL, t0));
    }

    /// Expiry is what BOUNDS the map: a check deleted while throttled never
    /// comes back to refresh its entry, so nothing else would remove it.
    #[test]
    fn expired_entries_are_dropped_so_the_map_stays_bounded() {
        let log = LogCooldown::new(TRIAL_GATE_LOG_COOLDOWN_US);
        for i in 0..100u32 {
            log.allow(&format!("deleted_{i}"), ERROR_SOURCE_TRIAL, TRIAL_ENDS);
        }
        assert_eq!(log.last.len(), 100, "precondition: all hundred are tracked");
        log.allow(
            A_CHECK,
            ERROR_SOURCE_TRIAL,
            TRIAL_ENDS + TRIAL_GATE_LOG_COOLDOWN_US,
        );
        assert_eq!(
            log.last.len(),
            1,
            "entries older than the window can no longer suppress anything and must be dropped"
        );
    }

    /// **Every trial-gate `warn!` must go through the throttle.** The tests above
    /// prove the throttle works; this proves the gate uses it.
    #[test]
    fn every_trial_gate_warning_is_throttled() {
        let guard = ["trial_gate", "_reads_needed("].concat();
        let src = source_above_the_tests();
        let (open, end) = guarded_block(&src, &guard);
        let block = &src[open..end];

        let warns = block.matches("tracing::warn!").count();
        assert_eq!(
            warns, 3,
            "the trial gate has three log lines — two fail-open reads and the deny — found {warns}"
        );
        assert_eq!(
            block
                .matches(&["TRIAL_GATE_LOG", ".allow("].concat())
                .count(),
            warns,
            "every one of the gate's {warns} warnings must be guarded by the cooldown, or a \
             lapsed org logs once per check per 5s tick forever"
        );
    }
}

/// SPEC §6 / §7.3 — the free step pool gate, items **2.3** and **2.4**.
#[cfg(test)]
mod pool_gate_tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    };

    use config::meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType};
    use infra::table::synthetics_checks::DueCheck;

    use super::{
        ERROR_SOURCE_QUOTA, PlannedSlot, PoolExhaustionPolicy, PoolGate, pool_gate_decision,
        pool_reserves, quota_result_record, quota_trigger_record, refund_planned, refund_slot,
        reserve_for_slot,
    };
    use crate::pool::StepPoolHooks;

    /// Process-global, because a `fn` pointer cannot capture; every test using
    /// the fake takes this first. Poisoning is ignored.
    static FAKE_LOCK: Mutex<()> = Mutex::new(());
    static DEDUCTED: AtomicU64 = AtomicU64::new(0);
    static REFUNDED: AtomicU64 = AtomicU64::new(0);
    static GRANT_HAS_ROOM: AtomicBool = AtomicBool::new(true);

    fn fake_try_deduct(_org_id: &str, steps: u64) -> bool {
        if !GRANT_HAS_ROOM.load(Ordering::Relaxed) {
            return false;
        }
        DEDUCTED.fetch_add(steps, Ordering::Relaxed);
        true
    }

    fn fake_refund(_org_id: &str, steps: u64) {
        REFUNDED.fetch_add(steps, Ordering::Relaxed);
    }

    /// The enqueue path never reads these — they are the REAPER's (§6.3 / E10).
    /// Unreachable, so a new dependency on them fails loudly, not quietly.
    fn fake_remaining(_org_id: &str) -> u64 {
        unreachable!("gate 3 asks `try_deduct`, never the balance")
    }

    fn fake_dead_letter_refund(_org_id: &str, _steps: u64, _key: &str) -> bool {
        unreachable!("the keyed refund belongs to the reaper, not to the enqueue")
    }

    const FAKE: StepPoolHooks = StepPoolHooks {
        try_deduct: fake_try_deduct,
        refund: fake_refund,
        remaining: fake_remaining,
        dead_letter_refund: fake_dead_letter_refund,
    };

    fn fake_pool(has_room: bool) -> std::sync::MutexGuard<'static, ()> {
        let guard = FAKE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        DEDUCTED.store(0, Ordering::Relaxed);
        REFUNDED.store(0, Ordering::Relaxed);
        GRANT_HAS_ROOM.store(has_room, Ordering::Relaxed);
        guard
    }

    fn gate(policy: PoolExhaustionPolicy) -> Option<(StepPoolHooks, PoolExhaustionPolicy)> {
        Some((FAKE, policy))
    }

    fn slot(reserved: u32) -> PlannedSlot {
        PlannedSlot {
            location: "us-east-1".to_string(),
            pool: "aws-browser".to_string(),
            browser_devices: None,
            reserved,
        }
    }

    fn due_check() -> DueCheck {
        DueCheck {
            id: "chk_1".to_string(),
            name: "checkout journey".to_string(),
            org_id: "acme".to_string(),
            check_type: config::meta::synthetics::SyntheticType::Browser,
            locations: vec!["us-east-1".to_string()],
            frequency: SyntheticFrequency {
                frequency_type: SyntheticFrequencyType::Minutes,
                interval: 5,
                cron: String::new(),
                timezone: None,
            },
            tz_offset: 0,
            next_run_at: 1_787_665_631_000_000,
            browser_devices: Vec::new(),
            steps_configured: 14,
            tags: vec!["checkout".to_string()],
        }
    }

    // ── §7.3's table, as a pure decision ────────────────────────────────────

    /// **T30/E15, T31/E16, T36/E18** — §7.3 arm for arm, both values of
    /// `reserved`; every arm reachable, which is why the match is over a pair.
    #[test]
    fn the_exhaustion_table_is_spec_7_3() {
        use PoolExhaustionPolicy::*;
        assert_eq!(pool_gate_decision(MeteredOverage, true), PoolGate::Run);
        assert_eq!(
            pool_gate_decision(SubscriptionRequired, true),
            PoolGate::Run
        );
        assert_eq!(
            pool_gate_decision(MeteredOverage, false),
            PoolGate::RunAsOverage,
            "T31/E16: Rate or Enterprise on Stripe or Azure runs and bills the overage",
        );
        assert_eq!(
            pool_gate_decision(SubscriptionRequired, false),
            PoolGate::Skip,
            "T30/E15: a Free org's slot is skipped",
        );
        assert_eq!(
            pool_gate_decision(AdditionalCreditsRequired, false),
            PoolGate::RunAndNotify,
        );
        assert_eq!(
            pool_gate_decision(AdditionalCreditsRequired, true),
            PoolGate::RunAndNotify,
        );
    }

    /// **T36 / E18** — *"never pool-gate"* is about the DEDUCT, not the verdict.
    #[test]
    fn only_a_contract_org_declines_to_reserve() {
        assert!(!pool_reserves(
            PoolExhaustionPolicy::AdditionalCreditsRequired
        ));
        assert!(pool_reserves(PoolExhaustionPolicy::MeteredOverage));
        assert!(pool_reserves(PoolExhaustionPolicy::SubscriptionRequired));
    }

    // ── gate 3 for one slot ─────────────────────────────────────────────────

    /// The reservation is `configured x combos`, taken once, before the enqueue.
    #[test]
    fn a_funded_slot_reserves_configured_times_combos() {
        let _guard = fake_pool(true);
        let (verdict, reserved) = reserve_for_slot(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            14,
            Some(2),
            false,
        );
        assert_eq!(verdict, PoolGate::Run);
        assert_eq!(reserved, 28);
        assert_eq!(DEDUCTED.load(Ordering::Relaxed), 28);
    }

    /// **T30 / E15.** A Free org whose grant is spent: slot skipped, NOTHING
    /// taken. Deducting and then skipping spends the grant on runs never made.
    #[test]
    fn t30_a_free_org_with_a_spent_grant_has_its_slot_skipped() {
        let _guard = fake_pool(false);
        let (verdict, reserved) = reserve_for_slot(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            14,
            Some(1),
            false,
        );
        assert_eq!(verdict, PoolGate::Skip);
        assert_eq!(reserved, 0);
        assert_eq!(DEDUCTED.load(Ordering::Relaxed), 0);
    }

    /// **T31 / E16.** A Rate org with a spent grant runs holding nothing, so the
    /// ack meters its steps as billable overage.
    #[test]
    fn t31_a_rate_org_with_a_spent_grant_runs_as_overage() {
        let _guard = fake_pool(false);
        let (verdict, reserved) = reserve_for_slot(
            gate(PoolExhaustionPolicy::MeteredOverage),
            "acme",
            14,
            Some(1),
            false,
        );
        assert_eq!(verdict, PoolGate::RunAsOverage);
        assert_eq!(
            reserved, 0,
            "an overage run holds nothing against the grant"
        );
    }

    /// **T36 / E18.** A contract org with a grant that WOULD have covered the
    /// run: still not touched — `pool_reserves` short-circuits before the deduct.
    #[test]
    fn t36_a_contract_org_never_attempts_a_reservation() {
        let _guard = fake_pool(true);
        let (verdict, reserved) = reserve_for_slot(
            gate(PoolExhaustionPolicy::AdditionalCreditsRequired),
            "acme",
            14,
            Some(1),
            false,
        );
        assert_eq!(verdict, PoolGate::RunAndNotify);
        assert_eq!(reserved, 0);
        assert_eq!(
            DEDUCTED.load(Ordering::Relaxed),
            0,
            "E18: a contract org's grant is never touched, even when it has room",
        );
    }

    /// **T17 / E13.** §7.1 gate 2: the customer's own hardware gets no gate, no
    /// deduct, no bill — and the check still runs.
    #[test]
    fn a_private_venue_runs_without_touching_the_grant() {
        let _guard = fake_pool(true);
        let (verdict, reserved) = reserve_for_slot(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            14,
            Some(2),
            true,
        );
        assert_eq!(verdict, PoolGate::Run);
        assert_eq!(reserved, 0);
        assert_eq!(DEDUCTED.load(Ordering::Relaxed), 0);
    }

    /// FAIL OPEN. No pool resolved — OSS build, master switch off, missing
    /// installation, failed billing read — must never stop monitoring.
    #[test]
    fn no_pool_means_no_gate() {
        let _guard = fake_pool(false);
        let (verdict, reserved) = reserve_for_slot(None, "acme", 14, Some(2), false);
        assert_eq!(verdict, PoolGate::Run);
        assert_eq!(reserved, 0);
        assert_eq!(DEDUCTED.load(Ordering::Relaxed), 0);
    }

    // ── gate 4 — the refund ─────────────────────────────────────────────────

    /// **T29 / E10.** `enqueue` returned `Ok("")` — another node holds this slot
    /// — so the FULL reservation goes back, or it is held against a grant for
    /// work never done, with no ack ever arriving to reconcile it.
    #[test]
    fn t29_a_slot_whose_enqueue_did_not_land_is_refunded_in_full() {
        let _guard = fake_pool(true);
        refund_slot(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            &slot(28),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 28);
    }

    /// A slot that reserved nothing has nothing to give back: refunding a private
    /// venue, an overage run or a contract org credits an unspent grant.
    #[test]
    fn an_unreserved_slot_refunds_nothing() {
        let _guard = fake_pool(true);
        refund_slot(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            &slot(0),
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a_refund_without_a_pool_is_a_no_op() {
        let _guard = fake_pool(true);
        refund_slot(None, "acme", &slot(28));
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 0);
    }

    /// The run row could not be written, so every reservation goes back.
    #[test]
    fn every_reservation_of_a_failed_run_is_refunded() {
        let _guard = fake_pool(true);
        refund_planned(
            gate(PoolExhaustionPolicy::SubscriptionRequired),
            "acme",
            &[slot(28), slot(28), slot(0)],
        );
        assert_eq!(REFUNDED.load(Ordering::Relaxed), 56);
    }

    // ── 2.4 — the dead letter ───────────────────────────────────────────────

    /// **T30 / E15 / §7.3.** Without this record a check just stops, with no row
    /// a user, a query or an alert rule can find.
    #[test]
    fn the_quota_dead_letter_carries_the_quota_error_source() {
        let record = quota_result_record(&due_check(), "us-east-1", 1_787_665_631_000_000, 42);
        let row = &record[0];
        assert_eq!(row["error_source"], ERROR_SOURCE_QUOTA);
        assert_eq!(row["status"], "error");
        assert_eq!(row["synthetics_id"], "chk_1");
        assert_eq!(row["location"], "us-east-1");
        assert_eq!(row["org_id"], "acme");
        assert_eq!(row["_timestamp"], 42);
        // There IS no job; an invented id gives the run-detail drawer a dead row.
        assert_eq!(row["job_id"], "");
        assert_eq!(row["run_id"], "");
        assert_eq!(row["execution_id"], "");
    }

    /// The alert-rule half, in the reaper's and the orphan report's own stream.
    #[test]
    fn the_quota_trigger_row_is_separable_from_the_other_error_sources() {
        let record = quota_trigger_record(&due_check(), "us-east-1", 42);
        let row = &record[0];
        assert_eq!(row["error_source"], ERROR_SOURCE_QUOTA);
        assert_eq!(row["module"], "synthetics");
        assert_eq!(row["status"], "failed");
        assert_eq!(row["key"], "checkout journey/chk_1");
        assert_eq!(row["org"], "acme");
        assert_ne!(row["error_source"], super::ERROR_SOURCE_TRIAL);
    }

    /// **T30 / E15 — the hard requirement.** *"MUST NOT disable the check. A
    /// billing system making destructive changes to customer config is
    /// unacceptable."* Asserted over the source: the property is the ABSENCE of
    /// a call, which no test of a return value can prove.
    #[test]
    fn the_quota_gate_never_disables_a_check() {
        // Assembled at runtime so this test cannot match its own text.
        let disable = ["set", "enabled("].join("_");
        let source = include_str!("scheduler.rs");
        assert!(
            !source.contains(&disable),
            "SPEC §7.3: skipping is reversible the moment the org subscribes — disabling is not",
        );
    }

    /// **§7.1's order: trial -> venue -> deduct -> enqueue.**
    ///
    /// Structural, and each link holds for its own reason: an expired org must
    /// not burn a one-time grant it can never use; a private agent must never
    /// deduct (§8.2/E13); and the reservation must exist before the job row, or
    /// a job runs that the grant never paid for.
    #[test]
    fn the_deduct_sits_between_the_venue_check_and_the_enqueue() {
        let trial = ["trial_gate", "_decision("].concat();
        let venue = ["let venue = synthetics_locations", "::get(location)"].concat();
        let deduct = ["let (verdict, reserved) = reserve", "_for_slot("].concat();
        let enqueue = ["match synthetics_jobs", "::enqueue(db, p)"].concat();

        let whole = include_str!("scheduler.rs");
        let src = &whole[..whole
            .find("\n#[cfg(test)]")
            .expect("scheduler.rs must still end in test modules")];
        // From the START OF `run`: each name also appears at its definition site,
        // and only the ORDER OF THE CALLS is §7.1.
        let src = &src[src
            .find("pub async fn run() {")
            .expect("the scheduler loop must still be `run`")..];

        let at = |needle: &str| {
            src.find(needle)
                .unwrap_or_else(|| panic!("§7.1's gate order needs this to exist: {needle}"))
        };
        assert!(at(&trial) < at(&venue), "trial must precede the venue read");
        assert!(
            at(&venue) < at(&deduct),
            "the venue read must precede the deduct"
        );
        assert!(
            at(&deduct) < at(&enqueue),
            "the deduct must precede the enqueue"
        );
    }

    /// **T29 / E10 — every enqueue that does not land refunds its reservation.**
    ///
    /// The refund is a CALL SITE, and a deleted one leaves every unit test above
    /// passing while the losing node of a dedup race holds a reservation against
    /// a one-time grant for work it will never do. So the sites are counted:
    /// `ON CONFLICT DO NOTHING`, an enqueue error, and an unwritable run row.
    #[test]
    fn every_enqueue_that_does_not_land_refunds_its_reservation() {
        let whole = include_str!("scheduler.rs");
        let src = &whole[..whole
            .find("\n#[cfg(test)]")
            .expect("scheduler.rs must still end in test modules")];

        assert_eq!(
            src.matches(&["refund", "_slot("].concat()).count(),
            4,
            "one definition and three call sites: the ON CONFLICT arm, the enqueue error arm, \
             and `refund_planned`'s loop",
        );
        assert_eq!(
            src.matches(&["refund", "_planned("].concat()).count(),
            2,
            "one definition and one call site: the run row that could not be written",
        );
        // A second deduct site double-charges; a lost refund site holds a grant.
        assert_eq!(src.matches("(hooks.try_deduct)(").count(), 1);
        assert_eq!(src.matches("(hooks.refund)(").count(), 1);
        // Gate 3 resolves once per due check: a `customer_billings` read that
        // would go to N per tick if it moved inside the fan-out.
        assert_eq!(
            src.matches(&["resolve_pool", "_gate("].concat()).count(),
            2,
            "one definition and exactly one call site — deleting the call is an ungated fleet",
        );
    }

    /// **T30 / E15 — a denied slot is RECORDED and never enqueued.** Drop the
    /// `continue` and it is enqueued unfunded; drop the dead letter and
    /// monitoring goes dark with no row saying why.
    #[test]
    fn a_denied_slot_is_recorded_and_never_enqueued() {
        let whole = include_str!("scheduler.rs");
        let src = &whole[..whole.find("\n#[cfg(test)]").unwrap()];

        let skip_guard = ["if verdict == PoolGate", "::Skip {"].concat();
        let at = src
            .find(&skip_guard)
            .expect("the denied slot must be skipped at the call site, not merely logged");
        let arm = &src[at..(at + 400).min(src.len())];
        assert!(
            arm.contains("denied.push("),
            "a denied slot must be recorded so `report_quota_skips` can dead-letter it",
        );
        assert!(
            arm.contains("continue;"),
            "a denied slot must not fall through into the enqueue",
        );

        assert_eq!(
            src.matches(&["report_quota", "_skips("].concat()).count(),
            3,
            "one definition and two call sites: the all-denied check, and the partly-denied one",
        );
    }

    /// `job_count` is what a run must reach before it is complete, so it MUST be
    /// the number of slots actually enqueued. Counting configured locations
    /// leaves every partly-denied run permanently incomplete: never finished,
    /// never alerted on, never recovered.
    #[test]
    fn the_run_row_counts_planned_slots_and_not_configured_locations() {
        let whole = include_str!("scheduler.rs");
        let src = &whole[..whole.find("\n#[cfg(test)]").unwrap()];
        assert!(
            src.contains(&["let job_count = planned", ".len() as i32;"].concat()),
            "job_count must come from the slots that survived gates 2 and 3",
        );
        assert!(
            !src.contains(&["let job_count = synthetic", ".locations.len() as i32;"].concat()),
            "counting configured locations orphans the run row for every denied slot",
        );
    }
}

#[cfg(test)]
mod cloud_feature_tests {
    /// `BUILT_WITH_CLOUD` must reflect the compiling crate's own feature set: if
    /// it disagrees with `cfg!`, downstream compile-time assertions go tautologous.
    #[test]
    fn built_with_cloud_reflects_this_crates_feature() {
        assert_eq!(crate::BUILT_WITH_CLOUD, cfg!(feature = "cloud"));
    }

    /// `cloud` implies `enterprise` in every sibling crate (§8.1), and the emit
    /// needs `o2_enterprise` at all. A `cloud` not pulling `enterprise` compiles
    /// happily and emits nothing — hence a compile-time check, not a `cfg!` one.
    #[cfg(feature = "cloud")]
    const _: () = assert!(
        cfg!(feature = "enterprise"),
        "`cloud` must be defined as `[\"enterprise\", \"o2_enterprise/cloud\"]` — the shape \
         every sibling crate already uses (§8.1)"
    );
}

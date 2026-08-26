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

//! Synthetics job API — called by probe agents via `o2syn_` token auth.
//!
//! Routes (all `bypass: true` in RBAC — authenticated via `o2syn_` token):
//!   POST /api/synthetics/jobs/resolve
//!   POST /api/synthetics/jobs/lease
//!   POST /api/synthetics/jobs/ack

// ── Step billing — SPEC §4.1 step 3 d–g, §4.4, §9 items 1.4 / 1.9 / 1.10 ─────
//
// `ack` COMPUTES the usage events and RETURNS them on [`AckResponse`]; it never
// sends them. `openobserve-synthetics` does not depend on `usage_reporting`,
// and the ack is served by `openobserve-api-management` — which depends on both
// — so the fire-and-forget `usage_reporting::report_usage(..)` happens in the
// `job_ack` handler over there.
//
// The obvious alternative — a `OnceCell` callback installed from
// `openobserve_synthetics::init()`, copying o2-enterprise's `GET_USAGE_FN`
// idiom — is SPEC §11 **F6** in a new disguise. `init()` runs only under
// `if LOCAL_NODE.is_scheduler()` (`src/jobs/src/job/mod.rs:1000`, the call at
// :1008), while the ack is routed to `openobserve-api-management::job_ack`
// (`src/api/http/src/handler/http/router/mod.rs:1335`) on **API** nodes, where
// the cell would be unset. The emit would compile, link, run, and meter
// nothing, silently. Returning data cannot fail that way, and it makes every
// guard below a pure function testable without a queue, a database or a global.
#[cfg(feature = "cloud")]
pub(crate) mod billing {
    use chrono::{Datelike, Timelike};
    use config::meta::{
        self_reporting::usage::{UsageData, UsageEvent},
        stream::StreamType,
    };
    use infra::table::{
        synthetics_jobs::LeasedRow,
        synthetics_locations::{self, KIND_PRIVATE},
    };

    use super::AckRequest;

    /// Where the execution physically ran — SPEC §8.2's *venue* axis, which is
    /// orthogonal to the `cloud`/`enterprise` *deployment* axis. A Cloud org
    /// running a private agent is a `cloud` build that MUST NOT bill, and
    /// neither gate substitutes for the other.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Venue {
        /// An o2-operated location. We paid AWS for the compute, so we bill it.
        Public,
        /// A private agent: the customer's own hardware (§8.2, E13, T17).
        Private,
        /// The location registry could not answer — see [`resolve_venue`].
        Unresolved,
    }

    /// The two SPEC §9A switches, read once per ack and threaded in as data so
    /// that both positions of both flags are testable without touching the
    /// process environment or the config `LazyLock`.
    #[derive(Debug, Clone, Copy)]
    pub(crate) struct BillingFlags {
        /// `O2_SYNTHETICS_BILLING_ENABLED`, default **false**.
        ///
        /// SPEC §9D: *"the emit MUST be independently disable-able at runtime —
        /// add `O2_SYNTHETICS_BILLING_ENABLED` to the emit path itself, not
        /// only to enforcement. Otherwise the only rollback for a mis-metering
        /// incident is a redeploy."* §11 **F2** says the same from the other
        /// side: its stated mitigation is to *"keep `O2_SYNTHETICS_BILLING_
        /// ENABLED` off until the fleet is uniform"*, which only keeps the new
        /// `UsageEvent` strings out of `_usage` — the thing that halts metering
        /// fleet-wide on an un-upgraded scheduler — if this flag gates the
        /// WRITE. So: false ⇒ zero events, full stop.
        pub billing_enabled: bool,
        /// `O2_SYNTHETICS_STEP_CLAMP_ENABLED`, default **true** — SPEC §9A,
        /// *"allows disabling the §4.4.1 clamp in an incident without a
        /// deploy"*. False bills the probe's raw count. The `warn` still fires
        /// and says the clamp was off, because with it off the over-report is
        /// no longer visible in the numbers themselves.
        pub clamp_enabled: bool,
    }

    /// Everything the emit needs from one ack. Built by [`inputs_from`].
    ///
    /// Grouped rather than passed loose because the asymmetry between two of
    /// these fields is load-bearing and only legible side by side:
    /// `steps_configured` and `combos` are **frozen** onto the job row at
    /// enqueue (so a mid-flight journey edit cannot reprice work already
    /// dispatched — §4.4.1, E5, T13) while `retries` is read from the **live**
    /// check, exactly as §4.4.1's snippet does. That is deliberate.
    pub(crate) struct BillingInputs<'a> {
        pub org_id: &'a str,
        pub job_id: &'a str,
        pub synthetics_id: &'a str,
        /// SPEC §4.1 step 3d.
        pub venue: Venue,
        /// SPEC §4.1 step 3f: `"queue"` means the job never ran.
        pub error_source: &'a str,
        /// Probe-reported, never trusted — clamped at §4.4.1's ceiling.
        pub steps_executed: u32,
        /// Probe-reported. Never billed, so never clamped.
        pub steps_defined: u32,
        pub browser_ms: u64,
        /// FROZEN at enqueue. Per combo: the scheduler freezes
        /// `steps.len().max(1)` (`DueCheck::try_from`), not the fan-out product.
        pub steps_configured: i32,
        /// FROZEN at enqueue — the engine+device combinations this one job runs
        /// sequentially. `None` for a protocol check.
        pub combos: Option<u32>,
        /// LIVE, from the current check definition (§4.4.1's `check.retries`).
        pub retries: i32,
        /// The ack instant, in microseconds. One value for every row of the ack
        /// so they cannot straddle an hour boundary.
        pub now_us: i64,
        /// SPEC §9 item 1.11 — see the call site in [`super::ack`].
        pub region: Option<String>,
        /// The org's one-time free step grant as it stood when this ack
        /// arrived — SPEC §6.1, item **2.3**. Decides §4.2's free/billable
        /// split and whether §6.3's reconcile touches the pool at all.
        pub pool: super::StepPoolView,
    }

    /// What one ack bills, and which of the two §4.4 guards fired.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct BillableSteps {
        /// `size` of the `SyntheticsSteps` row.
        pub billable: u32,
        /// `size` of the `_SyntheticsStepsDefined` row.
        pub defined: u32,
        /// §4.4.1: the probe reported above the ceiling.
        pub clamped: bool,
        /// §4.4.2: the probe reported zero.
        pub zero_fallback: bool,
        /// What the clamp compared against — carried for the log line.
        pub ceiling: u32,
    }

    /// The fields every synthetics usage row shares, resolved once per ack.
    ///
    /// ## What may and may not carry a number — SPEC §4.2's hard rule
    ///
    /// `ingest_usages` (openobserve-core `self_reporting::ingestion`) buckets
    /// rows by `GroupKey` and, on a collision, touches **three** fields: `size`
    /// and `num_records` **sum**, while `response_time` is summed and then
    /// divided by the count — it is an **average**. Every other field,
    /// **`request_body` included**, is taken from the FIRST row of the bucket
    /// and the rest are discarded.
    ///
    /// So `size` is the only channel a summable quantity may travel in, which
    /// is why each of the four counts is its own `UsageEvent` rather than a
    /// field on one. `request_body` is left EMPTY on purpose (T20): a per-run
    /// count put there would be the hour's first ack's count, reported as if it
    /// were the hour's.
    struct RowTemplate {
        timestamp: i64,
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        event_time_hour: String,
        org_id: String,
        region: Option<String>,
    }

    impl BillingInputs<'_> {
        /// A browser check is exactly one whose job row froze a
        /// `browser_devices` list. That column is written by the scheduler if
        /// and only if `check_type == Browser`, and unlike the LIVE check's
        /// `check_type` it cannot change under an in-flight job.
        fn is_browser(&self) -> bool {
            self.combos.is_some()
        }

        /// Steps ONE full pass of the frozen definition executes, across every
        /// combo — SPEC §4.2's `configured × combos`.
        ///
        /// `steps_configured` is `NOT NULL` and floored at 1 at both sources
        /// (`DueCheck::try_from` for new rows, a `DEFAULT 50` backfill for rows
        /// that predate the column), so `.max(1)` never fires in practice. It
        /// is here so that a corrupt or negative value can only ever produce a
        /// ceiling of at least one step. A ZERO ceiling would clamp real
        /// executed work down to nothing, which is precisely the outcome
        /// §4.4.2 forbids.
        pub(crate) fn frozen_definition(&self) -> u32 {
            super::enqueue_reservation(self.steps_configured, self.combos)
        }

        /// SPEC §4.2 / §6.1 — is this ack's work paid for by the org's one-time
        /// free grant, or is it billable?
        ///
        /// Exactly one of `SyntheticsSteps` and `SyntheticsFreeSteps` per ack,
        /// and this is the predicate that chooses.
        fn pool_funded(&self) -> bool {
            self.pool == super::StepPoolView::Funded
        }
    }

    /// SPEC §6.3's reconcile, as pure arithmetic.
    ///
    /// ```text
    ///   executed < reserved   (failed partway)   ->  REFUND the difference
    ///   executed > reserved   (retries fired)    ->  TOP UP the difference
    ///   executed = reserved   (the common case)  ->  nothing
    /// ```
    ///
    /// `None` for the equal case rather than a zero-valued adjustment: a zero
    /// movement still burns an idempotency key and still costs a flush record,
    /// and the common case is exactly this one.
    pub(crate) fn reconcile(reserved: u32, billed: u32) -> Option<super::PoolMovement> {
        use std::cmp::Ordering;
        match billed.cmp(&reserved) {
            Ordering::Less => Some(super::PoolMovement {
                direction: super::StepPoolDirection::Refund,
                steps: u64::from(reserved - billed),
            }),
            Ordering::Greater => Some(super::PoolMovement {
                direction: super::StepPoolDirection::TopUp,
                steps: u64::from(billed - reserved),
            }),
            Ordering::Equal => None,
        }
    }

    impl RowTemplate {
        fn new(i: &BillingInputs<'_>) -> Self {
            let now = chrono::DateTime::from_timestamp_micros(i.now_us)
                .unwrap_or_else(chrono::Utc::now)
                .naive_utc();
            Self {
                timestamp: i.now_us,
                year: now.year(),
                month: now.month(),
                day: now.day(),
                hour: now.hour(),
                event_time_hour: format!(
                    "{:04}{:02}{:02}{:02}",
                    now.year(),
                    now.month(),
                    now.day(),
                    now.hour()
                ),
                org_id: i.org_id.to_string(),
                region: i.region.clone(),
            }
        }

        fn build(&self, event: UsageEvent, size: f64, unit: &str) -> UsageData {
            UsageData {
                _timestamp: self.timestamp,
                event,
                year: self.year,
                month: self.month,
                day: self.day,
                hour: self.hour,
                event_time_hour: self.event_time_hour.clone(),
                org_id: self.org_id.clone(),
                // §4.2, T20 — see the type doc above.
                request_body: String::new(),
                // The one field that survives aggregation as a SUM.
                size,
                // Mirrors o2-enterprise's `MeteringEventName::unit()` for the
                // same event, so a human reading `_usage` and a human reading
                // the metering log see the same word. Nothing bills on this
                // field — `azure::meter_quantity` branches on `unit()`, not on
                // this string — but a disagreement between the two would be
                // read as a bug by whoever found it.
                unit: unit.to_string(),
                // No user acked this; a probe did. Empty rather than a
                // synthetic address, because `user_email` is part of `GroupKey`
                // and a per-probe value would shard the hour's bucket by probe.
                user_email: String::new(),
                // MUST stay 0.0. `ingest_usages` AVERAGES this field, so it can
                // never carry a summable quantity (see the type doc).
                response_time: 0.0,
                stream_type: StreamType::Logs,
                // Sums to "acks this org made this hour" — §4.1 step 5's
                // `60 acks × 14 steps ⇒ size = 840, num_records = 60`.
                num_records: 1,
                dropped_records: 0,
                // `_usage` is the destination; there is no source stream behind
                // a synthetics step.
                stream_name: String::new(),
                trace_id: None,
                cached_ratio: None,
                scan_files: None,
                compressed_size: None,
                min_ts: None,
                max_ts: None,
                search_type: None,
                search_event_context: None,
                took_wait_in_queue: None,
                result_cache_ratio: None,
                function: None,
                is_partial: false,
                work_group: None,
                node_name: None,
                region: self.region.clone(),
                dashboard_info: None,
                peak_memory_usage: None,
            }
        }
    }

    /// SPEC §4.1 step 3d — item **1.4**. Reads the location registry (a
    /// whole-table cache with a 30 s TTL) and classifies the venue.
    ///
    /// # Which way a failure errs, and why that is the safe way
    ///
    /// Only a row positively resolved as public bills. BOTH a lookup error and
    /// a missing row yield [`Venue::Unresolved`], which emits nothing.
    ///
    /// The two directions are not symmetric. Billing a customer for compute
    /// they own is a wrong invoice: customer-visible, refundable, and a trust
    /// event. Failing to bill work we did pay for is our own revenue, bounded
    /// by the length of the incident, and still reconstructable afterwards from
    /// `synthetics_jobs` / `synthetics_runs`, which are written either way.
    ///
    /// The asymmetry is sharper than "one is worse". `get` is served from a
    /// whole-table cache whose refresh is a single query, so an `Err` means the
    /// database was unreachable — a FLEET-WIDE condition, not a per-org one.
    /// Erring towards "bill it" would over-bill every org at once, private-agent
    /// orgs included, at exactly the moment we are least able to notice. Erring
    /// the other way under-reports for that same window and shows up as a
    /// visible hole in the Phase 1 dark data, which is the signal you want.
    ///
    /// `Ok(None)` is not an error but is treated the same way: the registry is
    /// the only thing that knows whose hardware ran a job, so a location that
    /// is not in it is a location whose venue we do not know. Phase 1 exists to
    /// MEASURE; a missing registry row should surface as missing volume, not
    /// hide inside a plausible-looking bill.
    pub(crate) async fn resolve_venue(location: &str) -> Venue {
        match synthetics_locations::get(location).await {
            Ok(Some(row)) if row.kind == KIND_PRIVATE => Venue::Private,
            Ok(Some(_)) => Venue::Public,
            Ok(None) => {
                tracing::warn!(
                    location = %location,
                    "[synthetics] billing: location is not in the registry — venue unknown, \
                     not billing this ack"
                );
                Venue::Unresolved
            }
            Err(e) => {
                tracing::error!(
                    location = %location,
                    "[synthetics] billing: location lookup failed, not billing this ack: {e}"
                );
                Venue::Unresolved
            }
        }
    }

    /// Number of engine+device combinations frozen onto the job row, or `None`
    /// for a protocol check.
    ///
    /// The scheduler writes this column if and only if the check is a browser
    /// check, so its PRESENCE is the frozen check-type signal — the live
    /// `check_type` could have been edited since the job was dispatched.
    ///
    /// An unreadable or empty list still means "browser", with one combo: the
    /// column exists, so the scheduler put it there. Floored to 1 for the same
    /// reason `frozen_definition` floors `steps_configured` — a zero fan-out is
    /// a zero ceiling, and a zero ceiling bills real work as nothing.
    pub(crate) fn frozen_combos(browser_devices: Option<&str>) -> Option<u32> {
        let raw = browser_devices?;
        let n = serde_json::from_str::<Vec<serde_json::Value>>(raw)
            .ok()
            .and_then(|v| u32::try_from(v.len()).ok())
            .unwrap_or(1);
        Some(n.max(1))
    }

    /// Gathers one ack's billing inputs from the FROZEN job row and the probe's
    /// request.
    ///
    /// This exists as its own function so that the frozen/live split is
    /// testable: `steps_configured` and `combos` can only come from `row`, and
    /// `retries` can only come from the caller's argument — which [`super::ack`]
    /// sources from the LIVE check. T13/E5 is a property of this wiring, not of
    /// the arithmetic downstream of it.
    pub(crate) fn inputs_from<'a>(
        row: &'a LeasedRow,
        req: &'a AckRequest,
        live_retries: i32,
        venue: Venue,
        now_us: i64,
        region: Option<String>,
        pool: super::StepPoolView,
    ) -> BillingInputs<'a> {
        BillingInputs {
            org_id: &row.org_id,
            job_id: &row.id,
            synthetics_id: &row.synthetics_id,
            venue,
            error_source: &req.error_source,
            steps_executed: req.steps_executed,
            steps_defined: req.steps_defined,
            browser_ms: req.browser_ms,
            steps_configured: row.steps_configured,
            combos: frozen_combos(row.browser_devices.as_deref()),
            retries: live_retries,
            now_us,
            region,
            pool,
        }
    }

    /// SPEC §4.4.1 (clamp, item **1.9**) + §4.4.2 (zero fallback), as pure
    /// arithmetic.
    ///
    /// # Overflow and sign
    ///
    /// `LeasedRow::steps_configured` is `i32` while §4.4.1's snippet is `u32`,
    /// so the conversion happens here, at the clamp site. Every operand is a
    /// `u32` and every combining operation is `saturating_*`, so the result is
    /// in `1..=u32::MAX` for every input — `steps_configured = i32::MAX`,
    /// `combos = u32::MAX` and `retries = i32::MAX` together still land on
    /// `u32::MAX` rather than wrapping. The only signed input is `retries`, and
    /// `.max(0)` reads a negative one as "no retries", i.e. one attempt: the
    /// smallest ceiling that still cannot be zero.
    pub(crate) fn resolve_billable(flags: BillingFlags, i: &BillingInputs<'_>) -> BillableSteps {
        let definition = i.frozen_definition();
        let attempts = u32::try_from(i.retries.max(0))
            .unwrap_or(u32::MAX)
            .saturating_add(1);
        let ceiling = definition.saturating_mul(attempts);

        // §4.2: `_SyntheticsStepsDefined` is `configured × combos`. Prefer the
        // probe's own number — it describes the journey that ACTUALLY ran, so
        // after a mid-flight edit it is the honest denominator for §4.3's
        // `executed / defined` ratio — and fall back to the frozen definition
        // only when the probe is too old to send one. Never clamped: nothing
        // bills on it, so a wild value costs a wrong ratio, not a wrong invoice.
        let defined = if i.steps_defined == 0 {
            definition
        } else {
            i.steps_defined
        };

        // §4.4.2 keys on the RAW reported value, not on the clamped one: a 0
        // means "a probe built before items 1.2a/1.2b", and billing zero for
        // real work is worse than billing the definition.
        if i.steps_executed == 0 {
            let billable = if i.is_browser() {
                // Browser ⇒ the frozen definition, across every combo.
                definition
            } else {
                // Protocol ⇒ 1 (§1.1: one request is one step). NOT `attempts`:
                // a probe old enough to omit `steps_executed` also defaults
                // `attempts` to 0, so deriving from it would bill a guess off a
                // guess.
                1
            };
            return BillableSteps {
                billable,
                defined,
                clamped: false,
                zero_fallback: true,
                ceiling,
            };
        }

        let over_ceiling = i.steps_executed > ceiling;
        let billable = if flags.clamp_enabled {
            i.steps_executed.min(ceiling)
        } else {
            i.steps_executed
        };
        BillableSteps {
            billable,
            defined,
            clamped: over_ceiling,
            zero_fallback: false,
            ceiling,
        }
    }

    /// SPEC §4.1 step 3 d–g — items **1.4**, **1.9**, **1.10**: the guards, in
    /// the order the spec states them, and then the emit.
    ///
    /// Returns the rows `job_ack` hands to `usage_reporting::report_usage` —
    /// EMPTY whenever this ack must not be billed.
    ///
    /// Step 3c (`ack_complete` ⇒ `None`) is enforced by [`super::ack`] itself,
    /// which returns [`super::stale_lease_response`] before ever reaching here;
    /// that response carries no events, which is T14/T15.
    ///
    /// Step 3h (pool reconcile) is Phase 2 item 2.3 and is deliberately absent.
    pub(crate) fn events_for_ack(flags: BillingFlags, i: BillingInputs<'_>) -> Vec<UsageData> {
        // ── The §9A / §9D master switch ─────────────────────────────────────
        // Authoritative. `ack` re-checks it before the registry read, purely to
        // avoid that read (and its failure logging) on a node that is not
        // metering at all; the two must agree, and THIS is the one that decides.
        if !flags.billing_enabled {
            return Vec::new();
        }

        // ── d. Venue — item 1.4 (§8.2, E13, T17) ────────────────────────────
        match i.venue {
            Venue::Public => {}
            Venue::Private | Venue::Unresolved => return Vec::new(),
        }

        // ── e. Clamp (§4.4.1) + zero fallback (§4.4.2) — item 1.9 ───────────
        let steps = resolve_billable(flags, &i);

        // ── f. The job never ran (E11, T16) ─────────────────────────────────
        // `"queue"` means it waited behind other jobs until its own
        // `valid_until` passed. That is our scheduling lag, not their work.
        //
        // The two `warn`s from step e are logged BELOW this guard rather than
        // inside `resolve_billable`. The arithmetic order is exactly the spec's
        // (e, then f); only the logging is deferred, because a queue-errored ack
        // always carries `steps_executed = 0` and would otherwise fire the
        // §4.4.2 warning — whose meaning is "an un-upgraded probe is still in
        // the fleet", and which §9B alert A3 pages on — for a job no probe ever
        // touched.
        if i.error_source == "queue" {
            return Vec::new();
        }

        // §4.4.1: MUST log every clamp at `warn` — it means a probe bug or a
        // definition mismatch (§9B alert A2).
        if steps.clamped {
            // §9B.1 row 6. Counted here rather than inside `resolve_billable`
            // for the same reason the `warn` is: the guards above (the master
            // switch, the venue, and `error_source = "queue"`) all mean "this
            // ack is not ours to bill", and an ack we do not bill cannot have
            // over-reported anything we care about.
            //
            // OUTSIDE the `clamp_enabled` branch below, deliberately. A2 asks
            // *"is a probe over-reporting"*, not *"did we clamp"*, and the
            // incident switch that stops the clamping (§9A) is exactly the
            // window in which the over-report stops being visible in the
            // billed numbers.
            config::metrics::SYNTHETICS_STEP_CLAMP_TOTAL.inc();
            if flags.clamp_enabled {
                tracing::warn!(
                    job_id = %i.job_id,
                    synthetics_id = %i.synthetics_id,
                    org_id = %i.org_id,
                    reported = i.steps_executed,
                    ceiling = steps.ceiling,
                    billed = steps.billable,
                    "[synthetics] steps_executed exceeds ceiling — clamped"
                );
            } else {
                tracing::warn!(
                    job_id = %i.job_id,
                    synthetics_id = %i.synthetics_id,
                    org_id = %i.org_id,
                    reported = i.steps_executed,
                    ceiling = steps.ceiling,
                    billed = steps.billable,
                    "[synthetics] steps_executed exceeds ceiling but the clamp is DISABLED \
                     (O2_SYNTHETICS_STEP_CLAMP_ENABLED=false) — billing the reported count"
                );
            }
        }
        // §4.4.2, and §9B alert A3: this firing after the probe rollout has
        // completed means the deploy order was inverted (§11 F9).
        if steps.zero_fallback {
            // §9B.1 row 7. Behind the `error_source = "queue"` guard above and
            // not inside `resolve_billable`, which is the whole point: a
            // queue-errored ack always carries `steps_executed = 0`, so the
            // arithmetic says "fell back" for a job no probe ever touched, and
            // A3 would page on ordinary scheduling lag.
            config::metrics::SYNTHETICS_STEP_ZERO_FALLBACK_TOTAL.inc();
            tracing::warn!(
                job_id = %i.job_id,
                synthetics_id = %i.synthetics_id,
                org_id = %i.org_id,
                browser = i.is_browser(),
                billed = steps.billable,
                "[synthetics] probe reported steps_executed = 0 — falling back to the frozen \
                 definition rather than billing zero"
            );
        }

        // ── g. THE EMIT (§4.2) ──────────────────────────────────────────────
        let row = RowTemplate::new(&i);
        let mut events = Vec::with_capacity(3);

        // ── §4.2's split — item 2.3 ─────────────────────────────────────────
        //
        // Exactly ONE of `SyntheticsSteps` / `SyntheticsFreeSteps` per ack, and
        // this is the branch. `SyntheticsFreeSteps` is non-billable in
        // o2-enterprise's `MeteringEventName::is_billable`, so it burns down the
        // §6.1 grant in the usage stream without reaching an invoice;
        // `SyntheticsSteps` is the billable one.
        //
        // The predicate is the POOL, not the plan. Three states, and each maps
        // to exactly one row (see [`super::StepPoolView`]):
        //
        //   Funded         the grant still had room  ⇒ free
        //   Spent          the grant is gone         ⇒ billable overage (E16/T31)
        //   NotApplicable  no pool is consulted      ⇒ billable
        //
        // `NotApplicable` covers a build or node that does not meter, the master
        // switch being off, and — deliberately — an **ExternalContract** org:
        // §7.3 says those are *"notify, never block, never pool-gate"*, and
        // §7.4 needs their acks to carry `SyntheticsSteps` so the NoOp provider
        // can advance a step-denominated true-up (E18/T36).
        let step_event = if i.pool_funded() {
            UsageEvent::SyntheticsFreeSteps
        } else {
            UsageEvent::SyntheticsSteps
        };
        events.push(row.build(step_event, f64::from(steps.billable), "steps"));

        // ALWAYS, alongside every billable ack — T19. It is half of §4.3's
        // `executed / defined` ratio, and it cannot be reconstructed later: by
        // the time anyone asks, the definition may already have been edited.
        events.push(row.build(
            UsageEvent::_SyntheticsStepsDefined,
            f64::from(steps.defined),
            "steps",
        ));

        // The v2 duration hedge. Skipped at zero: it is a browser-only
        // quantity, and a 0 adds nothing to `SUM(size)` while adding a
        // permanent zero-valued bucket to every protocol org's every hour.
        if i.browser_ms > 0 {
            events.push(row.build(UsageEvent::_SyntheticsBrowserMs, i.browser_ms as f64, "ms"));
        }

        events
    }

    /// SPEC §4.1 step **3h** — the pool reconcile, item **2.3**.
    ///
    /// Returns the movement this ack owes the org's one-time grant, or `None`
    /// when the pool must not be touched. Applied by the caller
    /// (`openobserve-api-management`), for the same reason the usage rows are:
    /// the pool lives in `openobserve-core` and this crate has no edge to it.
    ///
    /// # Why this is a second function and not a field of [`events_for_ack`]
    ///
    /// The two disagree on exactly one input, and that disagreement is the
    /// point. An `error_source = "queue"` ack emits NOTHING (§4.1 step 3f, E11)
    /// **and** refunds the WHOLE reservation (T16) — the job waited behind other
    /// jobs until its own `valid_until` passed, so no step ran and no step may
    /// be held against the grant. A single function returning both would have to
    /// carry that asymmetry as a special case; two functions state it once each.
    ///
    /// # The approximation, stated plainly
    ///
    /// The ack has no record of what the enqueue reserved — SPEC §5 adds no
    /// column to `synthetics_jobs` for one — so "was this run pool-funded?" is
    /// answered by the pool's state NOW rather than at enqueue. Two boundary
    /// cases follow, both bounded by one run and both erring towards leaving the
    /// pool alone:
    ///
    ///   * the enqueue reserved, and other checks spent the last of the grant before this ack
    ///     landed ⇒ [`StepPoolView::Spent`], so an over-deduct is not refunded. The org loses the
    ///     unspent difference of one run.
    ///   * the grant was gone at enqueue (so nothing was reserved) and an operator raised the limit
    ///     mid-run ⇒ [`StepPoolView::Funded`], so this ack reconciles against a reservation that
    ///     never happened.
    ///
    /// §9B.3's reconciliation job is what measures the residue: `SUM(size)` over
    /// the two step events against `trial_quota_usage.usage_count`.
    pub(crate) fn pool_adjustment_for_ack(
        flags: BillingFlags,
        i: &BillingInputs<'_>,
    ) -> Option<super::PoolMovement> {
        // The §9A / §9D master switch, same authority as in `events_for_ack`.
        if !flags.billing_enabled {
            return None;
        }

        // Only a grant that is currently funding this org may be moved.
        // `Spent` and `NotApplicable` both mean the enqueue reserved nothing —
        // an exhausted org runs as overage (E16) and a contract org is never
        // pool-gated at all (E18).
        if !i.pool_funded() {
            return None;
        }

        // The venue gate, read the same way the enqueue read it. A private agent
        // is the customer's own hardware: §7.1 gate 2 is *"no gate, no deduct,
        // no bill"*, so there is nothing to give back. `Unresolved` is treated
        // the same way rather than refunded, because a lookup error is
        // FLEET-WIDE (see `resolve_venue`) and a refund on every ack during a
        // database outage would hand every free org its grant back at once.
        if i.venue != Venue::Public {
            return None;
        }

        let reserved = i.frozen_definition();

        // E11 / T16 — the job never ran, so the whole reservation goes back.
        // Checked BEFORE `resolve_billable` because a queue-errored ack carries
        // `steps_executed = 0`, and §4.4.2's zero fallback would otherwise turn
        // "no steps ran" into "bill the whole definition".
        if i.error_source == "queue" {
            return Some(super::PoolMovement {
                direction: super::StepPoolDirection::Refund,
                steps: u64::from(reserved),
            });
        }

        reconcile(reserved, resolve_billable(flags, i).billable)
    }
}

use std::collections::HashMap;

use config::meta::{
    self_reporting::usage::UsageData,
    synthetics::{Synthetic, SyntheticAuth, for_each_string_at_path},
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_locations,
        synthetics_runs,
    },
};
use serde::{Deserialize, Serialize};

use crate::{RESULTS_STREAM, STEP_RESULTS_STREAM};

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub job_id: String,
}

/// Viewport dimensions delivered to the probe so it doesn't need hardcoded device tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// One engine+device combination with a pre-generated execution_id (from the scheduler).
#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserDeviceEntry {
    pub execution_id: String,
    pub engine: String,
    pub device: String,
    pub viewport: Viewport,
}

#[derive(Debug, Serialize)]
pub struct ResolveResponse {
    pub job_id: String,
    pub run_id: String,
    /// The synthetic definition (terminology rule: never "check" on the wire).
    pub synthetic: Synthetic,
    pub location: String,
    /// Human-readable location label (falls back to the id if the row is gone).
    pub location_label: String,
    pub scheduled_ts: i64,
    pub trigger_type: String,
    /// One entry per engine+device combination — browser checks only. Empty for protocol
    /// checks.
    pub browser_devices: Vec<BrowserDeviceEntry>,
    /// Decrypted credential env vars for this check, sent over TLS.
    /// Keys: `_AUTH_USERNAME`, `_AUTH_PASSWORD` (basic) or `_AUTH_TOKEN` (bearer).
    /// Auth is redacted from `check.auth` — probe reads credentials from here only.
    /// Empty when the synthetic has no auth configured.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub env_inject: HashMap<String, String>,
    /// Check-level metadata from the job row — flattened into stream records by the probe.
    /// Today carries `tags`; future fields added to `JobMetadata` flow automatically.
    pub metadata: serde_json::Value,
    /// Drop-dead time for stale catch-up work (mirrors the job row).
    pub valid_until: i64,
    /// "strict" (public pools) | "relaxed" (private locations — probing the
    /// customer's own network is the point; loopback/metadata still blocked).
    pub ssrf_policy: String,
    /// Result-stream destination + the org's `o2oi_` ingest token, looked up at
    /// resolve time (01 §7.1) so it is never at rest in the queue. Consumed by
    /// agent-mode probes; the Lambda path receives ingest creds in the invoke
    /// payload instead. None when the org has no enabled ingest token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingest: Option<IngestInfo>,
}

/// Ingest destination for probe result records.
#[derive(Debug, Serialize)]
pub struct IngestInfo {
    pub base_url: String,
    pub org: String,
    /// One row per execution. Carries `last_attempt_steps` as a JSON blob.
    pub stream: String,
    /// One row per (execution, step) — the step-grain stream (B10).
    ///
    /// Sent explicitly rather than derived as `{stream}_steps` by convention.
    /// A convention is undocumented coupling: a reader of either side cannot see
    /// it, and renaming the results stream would silently redirect step writes.
    /// Both sides are ours and the feature is dev/introspection-only, so there is
    /// no version-skew argument for guessing.
    ///
    /// Written by the BROWSER probe only. Steps are a browser concept; protocol
    /// checks have no steps and the Go agent never writes here.
    pub step_stream: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct AckRequest {
    pub job_id: String,
    /// The acking probe's agent id — the same value it sent as `claimed_by` on
    /// lease. The server completes the job only if the row is still leased to it.
    ///
    /// `Option` on purpose, and it must stay optional until both probes are
    /// deployed: a probe built before this field existed acks without it, and
    /// rejecting those acks would throw away every result in the meantime. An ack
    /// without it falls back to the status guard alone — exactly the behaviour
    /// before this change, so an old probe is no worse off than it was.
    #[serde(default)]
    pub claimed_by: Option<String>,
    /// Check result status from the probe: "up" | "warning" | "down" | "error"
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub response_time_ms: f64,
    pub error: Option<String>,
    /// "scheduled" | "manual" — populated by the probe, defaults to "scheduled"
    #[serde(default = "default_trigger_type")]
    pub trigger_type: String,
    /// Why a warning is a warning: "flaky", "cert_expiring", "sftp_degraded".
    ///
    /// Authoritative when present — the probe knows, and `classify` believes it.
    /// `None` means the probe is too old to send one, in which case classification
    /// falls back to the `attempts` proxy below. That proxy is what reported an
    /// expiring certificate as "passed only after retries (flaky)", so it is a
    /// compatibility fallback, not the intended path.
    #[serde(default)]
    pub status_reason: Option<String>,
    /// Total attempts this execution took. 1 = passed or failed on the first try.
    ///
    /// Carried so the control plane can tell a FLAKY warning from a DEGRADED one
    /// without putting `status_reason` on this wire. The retry loop needs more
    /// than one attempt by definition, and A6 breaks the loop the moment a
    /// checker returns a degraded warning — so `attempts > 1` means it recovered
    /// by retrying, and `attempts <= 1` means a checker reported a reachable but
    /// degrading target. See `alerting::classify`.
    ///
    /// Defaults to 0, which classifies as degraded: a probe too old to report
    /// attempts must not have its warnings read as flaky.
    #[serde(default)]
    pub attempts: i32,
    /// Why this is an `error`, when it is one: `dispatch` | `probe` | `queue`.
    ///
    /// `queue` is the one that changes the decision — it means the job waited
    /// behind other jobs until it passed its own `valid_until` and was never
    /// executed. That is our scheduling lag, so it must not advance the failure
    /// streak and must not page the customer. See `alerting::classify`.
    #[serde(default)]
    pub error_source: String,
    /// Steps this execution actually EXECUTED, summed across every attempt and
    /// excluding skipped ones. **The billed quantity** (spec §2.1, §4.4).
    ///
    /// It arrives here and nowhere else: 43% of executions are missing from
    /// `synthetics_step_results`, so a count derived from the results stream
    /// would under-bill silently. Never trusted as sent — the ack clamps it at
    /// the ceiling frozen onto the job row at enqueue (§4.4.1).
    ///
    /// `#[serde(default)]` is the rollback story, not a convenience. Two probe
    /// repos gain this field on their own release cadence, so acks without it
    /// are the norm until both ship and again the moment either is rolled back,
    /// and an ack this server rejects is a discarded check result. A 0 is
    /// therefore "an older probe", which is why §4.4.2 falls back to the frozen
    /// count rather than billing zero.
    #[serde(default)]
    pub steps_executed: u32,
    /// Steps the journey DEFINES for this execution. Reported, never billed.
    ///
    /// Carried alongside `steps_executed` because it is the pair that makes a
    /// bill answerable: `executed / defined` under 1.0 means the journey failed
    /// partway, over 1.0 means retries fired (§4.3). Neither number tells that
    /// story alone, and this one cannot be recovered afterwards — by the time
    /// anyone asks, the definition it came from may already have been edited.
    #[serde(default)]
    pub steps_defined: u32,
    /// Browser wall-clock milliseconds for this execution.
    ///
    /// The duration hedge: if per-step pricing turns out to track cost worse
    /// than per-second does, this is the v2 migration path, and it only works
    /// if the history exists BEFORE the decision. Collected from the first day
    /// of metering for that reason; nothing bills on it.
    #[serde(default)]
    pub browser_ms: u64,
}

fn default_trigger_type() -> String {
    "scheduled".to_string()
}

/// Batch form of [`AckRequest`] — one HTTP call acking several jobs, each with
/// its full result ("batch of rich acks"). Cadence is the sender's choice: the
/// browser probe acks per execution (array of one), protocol agents accumulate
/// per lease cycle. Every element runs the same per-job bookkeeping/notification
/// path as a single ack.
#[derive(Debug, Deserialize)]
pub struct AckBatchRequest {
    pub acks: Vec<AckRequest>,
}

fn artifact_key(
    org_id: &str,
    synthetics_id: &str,
    run_id: &str,
    job_id: &str,
    execution_id: Option<&str>,
    attempt: u32,
    name: &str,
) -> String {
    let now = chrono::Utc::now();
    // run_id groups all artifacts of one scheduled slot under one prefix so
    // per-run listing/cleanup is a prefix op.
    // Leaf: execution_id for browser checks (one per engine+device combo),
    // job_id for protocol checks (single execution per job).
    let id = execution_id.unwrap_or(job_id);
    // Every attempt of one execution writes the same file names, so a retried
    // run would silently overwrite the earlier attempt's screenshots. Attempt 0
    // keeps the historical key so nothing already stored moves.
    let name = if attempt == 0 {
        name.to_string()
    } else {
        format!("attempt-{attempt}-{name}")
    };
    format!(
        "synthetics/{}/{}/{}/{}/{}/{}/{}/{}",
        org_id,
        synthetics_id,
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        run_id,
        id,
        name,
    )
}

#[derive(Debug, Deserialize)]
pub struct ArtifactUrlsRequest {
    pub job_id: String,
    /// execution_id for the specific engine+device execution — used as the S3 key namespace.
    /// Required for browser checks; omitted for protocol checks (falls back to job_id).
    pub execution_id: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub trace: bool,
    /// The browser-side evidence bundle (console, page errors, network) as
    /// NDJSON. A third artifact kind riding the same broker as screenshots and
    /// the trace; probes that predate it simply never set it.
    #[serde(default)]
    pub evidence: bool,
    /// Which attempt of this execution these artifacts belong to (0 = first).
    /// Keeps a retry from overwriting the artifacts of the attempt before it.
    #[serde(default)]
    pub attempt: u32,
}

#[derive(Debug, Serialize)]
pub struct ArtifactUploadRef {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_upload_url: Option<String>,
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct ArtifactUrlsResponse {
    pub mode: String,
    pub screenshots: Vec<ArtifactUploadRef>,
    pub trace: Option<ArtifactUploadRef>,
    /// Absent when the probe did not ask for one, so a probe that predates
    /// evidence sees exactly the response it saw before.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<ArtifactUploadRef>,
}

pub async fn artifact_urls(
    req: ArtifactUrlsRequest,
    token_org: &str,
) -> anyhow::Result<ArtifactUrlsResponse> {
    let conn = get_orm_client_ro().await;

    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary — same as resolve/ack.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    let is_local = config::is_local_disk_storage();
    let expires = std::time::Duration::from_secs(30 * 60);

    let exec_id = req.execution_id.as_deref();

    let mut screenshots = Vec::with_capacity(req.screenshots.len());
    for step_id in &req.screenshots {
        let name = format!("screenshot-{step_id}.png");
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            &name,
        );
        if is_local {
            screenshots.push(ArtifactUploadRef {
                step_id: Some(step_id.clone()),
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            });
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign screenshot: {e}"))?;
            screenshots.push(ArtifactUploadRef {
                step_id: Some(step_id.clone()),
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            });
        }
    }

    let trace = if req.trace {
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            "trace.zip",
        );
        // TODO: trace viewing requires design discussion for the end user UI (embedded viewer vs
        // external)
        if is_local {
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            })
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign trace: {e}"))?;
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            })
        }
    } else {
        None
    };

    // Same shape as the trace above: NDJSON rather than a zip, and named so the
    // key is self-describing in object storage.
    let evidence = if req.evidence {
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            "evidence.ndjson",
        );
        if is_local {
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            })
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign evidence: {e}"))?;
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            })
        }
    } else {
        None
    };

    Ok(ArtifactUrlsResponse {
        mode: if is_local {
            "direct".to_string()
        } else {
            "presigned".to_string()
        },
        screenshots,
        trace,
        evidence,
    })
}

// ── Artifact download: presigned URLs for the UI ─────────────────────────────

/// How long presigned download URLs stay valid (seconds).
const PRESIGN_DOWNLOAD_EXPIRES_SECS: u64 = 180;

#[derive(Debug, Deserialize)]
pub struct PresignArtifactsRequest {
    /// Full object-store keys as stored in the stream records
    /// (`screenshot_key`, `trace_key`).
    pub keys: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PresignedArtifact {
    pub key: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct PresignArtifactsResponse {
    /// "presigned" — urls point directly at object storage (S3/MinIO/Azure).
    /// "proxy" — local disk mode; urls are relative API paths that stream bytes.
    pub mode: String,
    pub expires_in: u64,
    pub urls: Vec<PresignedArtifact>,
}

/// Batch-signs download URLs for artifacts of one synthetic.
///
/// Every key must live under `synthetics/{org_id}/{synthetics_id}/` — the org
/// and synthetic come from the authenticated route, so a caller can only sign
/// keys belonging to that synthetic (no cross-org/bucket access).
pub async fn presign_artifacts(
    org_id: &str,
    synthetics_id: &str,
    req: PresignArtifactsRequest,
) -> anyhow::Result<PresignArtifactsResponse> {
    let prefix = format!("synthetics/{org_id}/{synthetics_id}/");
    for key in &req.keys {
        if !key.starts_with(&prefix) || key.contains("..") {
            anyhow::bail!("invalid artifact key: {key}");
        }
    }

    if config::is_local_disk_storage() {
        let urls = req
            .keys
            .into_iter()
            .map(|key| PresignedArtifact {
                url: format!(
                    "/api/{org_id}/synthetics/{synthetics_id}/artifact?key={}",
                    urlencoding::encode(&key)
                ),
                key,
            })
            .collect();
        return Ok(PresignArtifactsResponse {
            mode: "proxy".to_string(),
            expires_in: PRESIGN_DOWNLOAD_EXPIRES_SECS,
            urls,
        });
    }

    let expires = std::time::Duration::from_secs(PRESIGN_DOWNLOAD_EXPIRES_SECS);
    let mut urls = Vec::with_capacity(req.keys.len());
    for key in req.keys {
        let url = infra::storage::presign_url(&key, reqwest::Method::GET, expires)
            .await
            .map_err(|e| anyhow::anyhow!("presign {key}: {e}"))?;
        urls.push(PresignedArtifact {
            key,
            url: url.to_string(),
        });
    }
    Ok(PresignArtifactsResponse {
        mode: "presigned".to_string(),
        expires_in: PRESIGN_DOWNLOAD_EXPIRES_SECS,
        urls,
    })
}

/// SPEC §6.3's **no-retry baseline**: what one enqueue reserves from the
/// free pool, and the same number the ack reconciles against.
///
/// `configured x combos`, deliberately NOT `configured x combos x
/// (retries + 1)`: *"reserving `configured x (retries+1)` would let one
/// flaky check hold 3x the pool it usually needs and exhaust a one-time
/// grant prematurely."* The extra steps a retry actually executes are taken
/// at ack time as a top-up (`billing::reconcile`), where they are known rather than
/// guessed.
///
/// **ONE function, TWO call sites**: [`crate::scheduler`] calls it to decide
/// what to deduct, and `billing::BillingInputs::frozen_definition` calls it to
/// decide what to reconcile against. They MUST agree — the ack has no record
/// of what the enqueue actually took, because SPEC §5's table adds no column
/// to `synthetics_jobs` for one — and the only way to guarantee that is for
/// there to be exactly one implementation.
///
/// Floored at one step for the reason `billing::BillingInputs::frozen_definition`
/// gives: a zero reservation is a zero ceiling, and a zero ceiling clamps
/// real executed work down to nothing.
pub(crate) fn enqueue_reservation(steps_configured: i32, combos: Option<u32>) -> u32 {
    let configured = u32::try_from(steps_configured.max(1)).unwrap_or(u32::MAX);
    configured.saturating_mul(combos.unwrap_or(1).max(1))
}

/// The org's one-time free step grant, as it stood when an ack arrived — SPEC
/// §6.1, item **2.3**.
///
/// Resolved by the ack's caller (`openobserve-api-management`) and passed in,
/// because the pool lives in `openobserve-core` and this crate has no dependency
/// edge to it. Three states, because §7.3 has three answers and collapsing them
/// to a bool loses the one that matters:
///
/// | state | §4.2 event | §6.3 reconcile |
/// |---|---|---|
/// | [`Funded`](Self::Funded) | `SyntheticsFreeSteps` | yes |
/// | [`Spent`](Self::Spent) | `SyntheticsSteps` (overage, E16/T31) | no |
/// | [`NotApplicable`](Self::NotApplicable) | `SyntheticsSteps` | no |
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum StepPoolView {
    /// No pool is consulted for this ack. A build without `cloud`, a node with
    /// `O2_SYNTHETICS_BILLING_ENABLED` off, or an **ExternalContract** org —
    /// §7.3: *"notify, never block, never pool-gate"* (E18/T36), and §7.4 needs
    /// their acks billable so the NoOp provider advances a true-up.
    ///
    /// The default, so a build that never sets it bills rather than silently
    /// consuming a grant it is not tracking.
    #[default]
    NotApplicable,
    /// The org's one-time grant still had room. This ack is free.
    Funded,
    /// The grant is spent. This ack runs as metered overage (§7.3, E16/T31).
    Spent,
}

/// Which way a [`PoolMovement`] moves the grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepPoolDirection {
    /// The run executed FEWER steps than the enqueue reserved — give the
    /// difference back (§6.3, T25).
    Refund,
    /// The run executed MORE (a retry fired) — take the difference (§6.3, T26).
    ///
    /// **Never refused.** §6.3: *"if a top-up would exhaust the pool mid-run,
    /// complete the run and record it"* (E14/T28).
    TopUp,
}

/// How far, and which way, one ack moves the free step pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolMovement {
    pub direction: StepPoolDirection,
    pub steps: u64,
}

/// One ack's pool reconcile, ready to apply — SPEC §6.3, item **2.3**.
///
/// Returned as DATA for the same reason `usage_events` is: the pool is
/// `openobserve_core::trial_quota` and this crate does not depend on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepPoolAdjustment {
    pub org_id: String,
    pub movement: PoolMovement,
    /// SPEC §6.3's MUST — see [`adjustment_key`].
    pub idempotency_key: String,
}

/// SPEC §6.3's idempotency key: **`(synthetics_id, location, scheduled_ts,
/// job_id)`**.
///
/// All four, and each earns its place:
///
///   * `job_id` alone would be enough for the ack path today, but it is a KSUID minted at enqueue
///     and says nothing about which slot it belongs to, so a lost adjustment could not be
///     reconstructed from a run record;
///   * `scheduled_ts` is the SLOT, not the wall clock (E25) — every node derives the same value for
///     a given slot, so the key is stable across nodes and across clock skew;
///   * `synthetics_id` + `location` make it the same tuple as `synthetics_jobs_dedup_uq`, which is
///     what lets §9B.3's reconciliation job join a `_usage` row to the pool movement that should
///     have accompanied it.
///
/// `\u{1f}` (ASCII unit separator) as the separator: a location name is
/// operator-chosen and a printable separator it could contain would let two
/// different tuples produce one key — and a collision here silently DROPS an
/// adjustment, which under a one-time grant is permanent.
pub fn adjustment_key(
    synthetics_id: &str,
    location: &str,
    scheduled_ts: i64,
    job_id: &str,
) -> String {
    format!("{synthetics_id}\u{1f}{location}\u{1f}{scheduled_ts}\u{1f}{job_id}")
}

#[derive(Debug, Serialize)]
pub struct AckResponse {
    pub run_complete: bool,
    /// Aggregate run status string when run_complete = true: "passed"|"warning"|"failed"|"error".
    /// None while the run still has pending jobs.
    pub run_status: Option<String>,
    /// Total number of jobs (locations) in this run — for notification context.
    pub job_count: i32,
    pub org_id: String,
    pub job_id: String,
    pub run_id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub synthetic_type: String,
    pub target: String,
    pub destinations: Vec<String>,
    pub location: String,
    pub pool: String,
    pub trigger_type: String,
    /// Whether this completed run should notify, and with what.
    ///
    /// The caller used to notify on every completed run that had a destination,
    /// which ignored `alert_if_fails` and `cooldown_mins` entirely. The
    /// decision belongs here because it needs the persisted failure streak,
    /// which only the ack path holds.
    pub alert: AlertDecision,
    /// Runs that had failed back to back when `alert` was resolved. 0 unless
    /// firing — a notification that says "failing" is more useful when it also
    /// says for how long.
    /// Why the run was a warning, echoed from the ack so the notification can say
    /// "the certificate is expiring" rather than a generic "degrading".
    pub status_reason: Option<String>,
    pub consecutive_failures: i32,
    /// Locations of this run's jobs that did not pass, worst first.
    ///
    /// Empty unless the run completed and something failed. Without it a
    /// notification for a six-location check could only say "the check is
    /// failing" — the reader had to open the UI to find out where.
    pub failing_locations: Vec<String>,
    /// Locations of this run's jobs that passed, alphabetical.
    ///
    /// Carried alongside the failing set because a recovery notification has no
    /// failing locations to name — that is what "recovered" means — so without
    /// this the message degraded to a bare count. Both sides also make a
    /// partial recovery expressible.
    pub passing_locations: Vec<String>,
    /// The usage rows this ack should meter — SPEC §4.1 step 3g, item 1.10.
    ///
    /// Returned as DATA rather than emitted here. `openobserve-synthetics` does
    /// not depend on `usage_reporting`, so the fire-and-forget
    /// `usage_reporting::report_usage(..)` is performed by the `job_ack` handler
    /// in `openobserve-api-management`, which depends on both. See the `billing`
    /// module doc for why the `OnceCell`-callback alternative is F6 in disguise.
    ///
    /// EMPTY on every path that must not bill: a duplicate or late ack (§4.1
    /// step 3c, T14/T15), a private venue (T17), an `error_source = "queue"`
    /// ack (T16), and any build without the `cloud` feature (§8.1, T40).
    ///
    /// `#[serde(skip)]`, and it MUST stay that way: this struct is the HTTP body
    /// of a single ack, so serializing it would ship an org's billing rows to a
    /// probe agent. Pinned by a test.
    #[serde(skip)]
    pub usage_events: Vec<UsageData>,
    /// The free-pool movement this ack owes — SPEC §4.1 step 3h, §6.3, item
    /// **2.3**. `None` on every path that must not touch the pool.
    ///
    /// Returned as data and applied by `openobserve-api-management`, exactly
    /// like `usage_events` and for the same reason. `#[serde(skip)]` for the
    /// same reason too: this struct is the HTTP body of a single ack, and a
    /// probe agent has no business knowing an org's grant balance.
    #[serde(skip)]
    pub pool_adjustment: Option<StepPoolAdjustment>,
}

/// The notification a completed run should send, resolved against the check's
/// `alert_if_fails` / `cooldown_mins` settings and its persisted alert state.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub enum AlertDecision {
    /// Say nothing: the run is still below the failure threshold, inside the
    /// cooldown window, or healthy and was never alerting.
    #[default]
    Silent,
    /// The check is failing and should be reported.
    Firing,
    /// The check passed after having alerted. Mandatory once a cooldown exists:
    /// with one, silence stops meaning "recovered".
    Recovered,
    /// The run recovered by retrying. Informational, not an incident.
    Flaky,
    /// The target is reachable but degrading — a certificate inside its warning
    /// window, or a failing SFTP probe on a host that authenticated.
    Degraded,
}

// ── Service functions (called by OSS handlers) ────────────────────────────────

/// Returns full synthetic config for a pending check so the probe knows what to execute.
///
/// Credentials stored AES-encrypted at rest are decrypted here with the org DEK
/// and returned as plain `env_inject` key-value pairs. This is safe because:
///   - The job API is only reachable over TLS (required for all O2 deployments).
///   - The `o2syn_` probe token is scoped to this org only.
///
/// `check.auth` is redacted in the response — the probe reads credentials from
/// `env_inject` only so the encrypted blob never leaves the backend.
pub async fn resolve(req: ResolveRequest, token_org: &str) -> anyhow::Result<ResolveResponse> {
    let conn = get_orm_client_rw().await;

    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary: the caller's token org must own the job. `job_id` is a
    // KSUID that leaks into result streams and logs, so without this a valid
    // token from another org could resolve this job's decrypted secrets.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    // Definition only (config/secrets/type) — served from the definition cache.
    let mut synthetic = synthetics_checks::get_cached(conn, &check.org_id, &check.synthetics_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {}", check.synthetics_id))?;

    // Decrypt credentials and variables; build env_inject for the probe.
    // Extracted config secrets live in config_secrets; legacy rows may still
    // carry AESenc: values in-place inside config.
    let mut has_encrypted_config = !synthetic.config_secrets.is_empty();
    for path in synthetic.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut synthetic.config, path, &mut |s: &mut String| {
            if s.starts_with("AESenc:") {
                has_encrypted_config = true;
            }
            Ok::<(), ()>(())
        });
    }
    let needs_dek = synthetic.auth.is_some()
        || !synthetic.variables.is_empty()
        || !synthetic.cookies.is_empty()
        || has_encrypted_config;
    let mut env_inject = HashMap::new();

    if needs_dek {
        let dek = crate::service::synthetics_dek(&check.org_id).await?;

        if let Some(ref auth) = synthetic.auth {
            env_inject.extend(build_env_map(auth, &dek)?);
        }

        // Inject decrypted variable values so the probe can substitute {{ VAR }}.
        // All values are AESenc: at rest regardless of the secure flag.
        for var in &synthetic.variables {
            let value = if var.value.starts_with("AESenc:") {
                crate::service::decrypt_secret(&dek, &var.value)?
            } else {
                var.value.clone()
            };
            env_inject.insert(var.name.clone(), value);
        }

        // Decrypt top-level cookies and serialize as _AUTH_COOKIES JSON for the probe.
        // Probe calls context.addCookies(JSON.parse(envVars._AUTH_COOKIES)) regardless of auth
        // type.
        if !synthetic.cookies.is_empty() {
            let decrypted: Vec<serde_json::Value> = synthetic
                .cookies
                .iter()
                .map(|c| {
                    let value = if c.value.is_empty() {
                        Ok(String::new())
                    } else {
                        crate::service::decrypt_secret(&dek, &c.value)
                    }?;
                    Ok(serde_json::json!({
                        "name":     c.name,
                        "value":    value,
                        "domain":   c.domain,
                        "path":     c.path,
                        "httpOnly": c.http_only,
                        "secure":   c.secure,
                    }))
                })
                .collect::<anyhow::Result<_>>()?;
            env_inject.insert(
                "_AUTH_COOKIES".into(),
                serde_json::to_string(&decrypted)
                    .map_err(|e| anyhow::anyhow!("cookies serialize failed: {e}"))?,
            );
        }

        // Rehydrate config-embedded secrets (SSH password, headers, browser
        // recorded secrets) — the probe reads them from `config` verbatim.
        if has_encrypted_config {
            for (pointer, encrypted) in std::mem::take(&mut synthetic.config_secrets) {
                if let Some(slot) = synthetic.config.pointer_mut(&pointer) {
                    *slot = serde_json::Value::String(crate::service::decrypt_secret(
                        &dek, &encrypted,
                    )?);
                }
            }
            // Legacy rows: AESenc: values still stored in-place inside config.
            for path in synthetic.check_type.secret_config_paths() {
                for_each_string_at_path(&mut synthetic.config, path, &mut |s: &mut String| {
                    if s.starts_with("AESenc:") {
                        *s = crate::service::decrypt_secret(&dek, s)?;
                    }
                    Ok::<(), anyhow::Error>(())
                })?;
            }
        }
    }

    // Redact password/token from auth before sending — probe uses env_inject instead.
    synthetic.auth = synthetic.auth.map(redact_auth);
    // Redact cookie values — probe reads from env_inject._AUTH_COOKIES instead.
    for c in &mut synthetic.cookies {
        c.value = String::new();
    }

    // Deserialise browser_devices from the job row, then enrich each entry with
    // the viewport dimensions from env config so the probe doesn't need a local
    // device table.
    #[derive(Deserialize)]
    struct StoredBrowserDevice {
        execution_id: String,
        engine: String,
        device: String,
    }
    let raw_devices: Vec<StoredBrowserDevice> = check
        .browser_devices
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let browser_devices: Vec<BrowserDeviceEntry> = raw_devices
        .into_iter()
        .map(|bd| {
            let (width, height) =
                config::meta::synthetics::device_viewport(&bd.device).unwrap_or((1440, 900));
            BrowserDeviceEntry {
                execution_id: bd.execution_id,
                engine: bd.engine,
                device: bd.device,
                viewport: Viewport { width, height },
            }
        })
        .collect();

    let trigger_type = synthetics_runs::get_run(conn, &check.run_id)
        .await
        .ok()
        .flatten()
        .map(|r| r.trigger_type)
        .unwrap_or_else(|| "schedule".to_string());

    let metadata: serde_json::Value =
        serde_json::from_str(&check.metadata).unwrap_or(serde_json::json!({}));

    // SSRF policy from the location registry: private locations run relaxed
    // (probing the customer's own network is the point), everything else strict.
    let location_record = synthetics_locations::get(&check.location)
        .await
        .ok()
        .flatten();
    let ssrf_policy = match &location_record {
        Some(l) if l.kind == synthetics_locations::KIND_PRIVATE => "relaxed".to_string(),
        _ => "strict".to_string(),
    };
    // Human label for the result record (id fallback keeps it non-empty).
    let location_label = location_record
        .map(|l| l.label)
        .unwrap_or_else(|| check.location.clone());

    // Ingest destination for agent-mode probes — looked up at resolve time so
    // the token is never at rest in the queue (01 §7.1).
    let ingest = org_ingestion_tokens::find_default_enabled(&check.org_id)
        .await
        .ok()
        .flatten()
        .map(|t| IngestInfo {
            base_url: config::meta::synthetics::api_endpoint(),
            org: check.org_id.clone(),
            stream: RESULTS_STREAM.to_string(),
            step_stream: STEP_RESULTS_STREAM.to_string(),
            token: t.token,
        });

    Ok(ResolveResponse {
        job_id: req.job_id,
        run_id: check.run_id,
        synthetic,
        location: check.location,
        location_label,
        scheduled_ts: check.scheduled_ts,
        trigger_type,
        browser_devices,
        env_inject,
        metadata,
        valid_until: check.valid_until,
        ssrf_policy,
        ingest,
    })
}

/// AES-decrypt credentials from `auth` and return as env var map.
fn build_env_map(auth: &SyntheticAuth, dek: &[u8]) -> anyhow::Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    match auth {
        SyntheticAuth::Basic { username, password } => {
            map.insert("_AUTH_USERNAME".into(), username.clone());
            if !password.is_empty() {
                map.insert(
                    "_AUTH_PASSWORD".into(),
                    crate::service::decrypt_secret(dek, password)?,
                );
            }
        }
        SyntheticAuth::Bearer { token } => {
            if !token.is_empty() {
                map.insert(
                    "_AUTH_TOKEN".into(),
                    crate::service::decrypt_secret(dek, token)?,
                );
            }
        }
        SyntheticAuth::Secret { .. } => {}
    }
    Ok(map)
}

/// Keep auth type + non-secret fields (tells probe how to apply), clear secret values.
fn redact_auth(auth: SyntheticAuth) -> SyntheticAuth {
    match auth {
        SyntheticAuth::Basic { username, .. } => SyntheticAuth::Basic {
            username,
            password: String::new(),
        },
        SyntheticAuth::Bearer { .. } => SyntheticAuth::Bearer {
            token: String::new(),
        },
        other => other,
    }
}

/// The 200 an ack that did not apply gets — SPEC §4.1 step 3c.
///
/// `ack_complete` returned `None`, which means either a duplicate ack (T14/E8)
/// or a late one from a holder the reaper already evicted (T15/E9). The probe
/// did its work and is entitled to its 200, but nothing here may touch run
/// accounting a second time — and nothing here may bill. `usage_events` is
/// empty, and that is the whole of exactly-once on the billing side: this is
/// the only way out of `ack` that skips the emit, and it cannot construct a
/// response that carries one.
fn stale_lease_response(
    job_id: String,
    trigger_type: String,
    check: synthetics_jobs::LeasedRow,
) -> AckResponse {
    AckResponse {
        run_complete: false,
        run_status: None,
        job_count: 0,
        org_id: check.org_id,
        job_id,
        run_id: check.run_id,
        synthetics_id: check.synthetics_id,
        synthetics_name: check.synthetics_name,
        synthetic_type: String::new(),
        target: String::new(),
        destinations: Vec::new(),
        location: check.location,
        pool: check.pool,
        trigger_type,
        alert: AlertDecision::Silent,
        status_reason: None,
        consecutive_failures: 0,
        failing_locations: Vec::new(),
        passing_locations: Vec::new(),
        usage_events: Vec::new(),
        // Nothing billed, so nothing to reconcile. A duplicate or evicted ack
        // must not move the pool either (§4.1 step 3c, E8/E9, T14/T15) — and
        // this is the only way out of `ack` that skips the emit, so it is also
        // the only one that has to say so.
        pool_adjustment: None,
    }
}

/// Acknowledges completion of a job.
///
/// Marks the job complete, increments the run counter, and returns context for
/// notifications. Returns `run_complete = true` when all jobs in the run have
/// acked.
///
/// `pool` is the org's free step grant as the CALLER resolved it — SPEC §6.1,
/// item 2.3. It is a parameter rather than a global for the reason the `billing`
/// module doc gives: the pool lives in `openobserve-core`, this crate has no
/// edge to it, and a `OnceCell` installed from `init()` would be unset on the
/// API nodes that serve acks (§11 **F6**). A required argument cannot be unset.
pub async fn ack(
    req: AckRequest,
    token_org: &str,
    pool: StepPoolView,
) -> anyhow::Result<AckResponse> {
    let conn = get_orm_client_rw().await;

    // Fetch the leased row first for context (location, check_id, org_id).
    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary — same as resolve.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    // Convert probe status string to SyntheticStatus DB integer.
    let synthetic_status = config::meta::synthetics::SyntheticStatus::from_probe_str(&req.status);
    let status_db = synthetic_status.to_db();

    // Map SyntheticStatus DB int → synthetics_jobs status int.
    // Jobs use: 3=Passed, 4=Failed, 5=Warning, 6=Error.
    let job_status = match status_db {
        1 => 3, // Passed
        2 => 5, // Warning
        3 => 4, // Failed
        4 => 6, // Error
        _ => 4,
    };

    let now_us = config::utils::time::now_micros();

    // Mark job complete. `None` means the ack did not apply: the job was no longer
    // Claimed (a duplicate ack), or it is claimed by a different agent now (a late
    // ack from a holder the reaper already evicted).
    let acked = synthetics_jobs::ack_complete(
        conn,
        &req.job_id,
        job_status,
        None,
        now_us,
        req.claimed_by.as_deref(),
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if acked.is_none() {
        // Dropped, not errored: the probe did its work and is entitled to a 200.
        // What must not happen is touching run accounting a second time —
        // `jobs_done` would overshoot `job_count`, the run would be declared
        // complete on a partial set, and `resolve_alert` would advance the failure
        // streak twice for one failure.
        tracing::warn!(
            job_id = %req.job_id,
            synthetics_id = %check.synthetics_id,
            claimed_by = req.claimed_by.as_deref().unwrap_or("<not sent>"),
            "[synthetics] stale_lease: ack dropped, job is no longer claimed by this agent"
        );
        return Ok(stale_lease_response(req.job_id, req.trigger_type, check));
    }

    // Increment run counter; Some(run_result) when all jobs have acked.
    let run_completion =
        synthetics_runs::increment_jobs_done(conn, &check.run_id, status_db, now_us)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let run_complete = run_completion.is_some();
    let (run_status, job_count) = match run_completion {
        Some((run_result, count)) => {
            let status = match config::meta::synthetics::SyntheticStatus::from_db(run_result) {
                config::meta::synthetics::SyntheticStatus::Passed => "passed",
                config::meta::synthetics::SyntheticStatus::Warning => "warning",
                config::meta::synthetics::SyntheticStatus::Failed => "failed",
                _ => "error",
            }
            .to_string();
            (Some(status), count)
        }
        None => (None, 1),
    };

    // Denormalize last check status onto the synthetic row.
    //
    // The write returns whether it CHANGED the stored value, and that bool is
    // the whole reason the publish below is affordable: this runs on every ack,
    // so publishing unconditionally would put a super-cluster message on the
    // queue for every run of every check. Publishing on the transition instead
    // means a check that keeps passing sends nothing at all.
    match synthetics_checks::update_last_check_status(conn, &check.synthetics_id, status_db).await {
        // Only the region that ran the check writes this column, so without the
        // broadcast every other region's LIST shows "Unknown" for a check its
        // own detail page — federated search over the results stream — reports
        // as passing.
        Ok(true) => {
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
                && let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::synthetics_check_last_status(
                        &check.org_id,
                        &check.synthetics_id,
                        status_db,
                    )
                    .await
            {
                // Logged, never propagated. The probe has done its work and is
                // owed its 200; failing the ack here would lose the run, and a
                // status badge that is stale in another region until the next
                // flip is cosmetic by comparison.
                tracing::warn!(
                    synthetics_id = %check.synthetics_id,
                    "[synthetics] super-cluster last_check_status publish: {e}"
                );
            }
        }
        // Unchanged — the steady state, and deliberately silent.
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(
                synthetics_id = %check.synthetics_id,
                "[synthetics] update_last_check_status: {e}"
            );
        }
    }

    // Fetch synthetic for type, target, and destinations — all definition
    // fields, so the cached read is correct here. Alert state is read
    // separately via resolve_alert/get_alert_state, which go to the DB.
    let synthetic = synthetics_checks::get_cached(conn, &check.org_id, &check.synthetics_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {}", check.synthetics_id))?;

    let synthetic_type = serde_json::to_value(&synthetic.check_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();

    // ── Step billing — SPEC §4.1 step 3 d–g, items 1.4 / 1.9 / 1.10 ─────────
    //
    // Computed here, emitted by the `job_ack` handler in
    // `openobserve-api-management` (see the `billing` module doc). Placed after
    // the live check is in hand because §4.4.1 reads `retries` from it, and
    // after step 3c's early return because a duplicate ack must bill nothing.
    //
    // Step 3h — the pool reconcile — is item 2.3, and is computed here for the
    // same reason and applied in the same place as the usage rows.
    #[cfg(feature = "cloud")]
    let (usage_events, pool_adjustment) = {
        let ent = o2_enterprise::enterprise::common::config::get_config();
        let flags = billing::BillingFlags {
            billing_enabled: ent.cloud.synthetics_billing_enabled,
            clamp_enabled: ent.cloud.synthetics_step_clamp_enabled,
        };
        // The master switch is re-checked inside `events_for_ack`, and THAT is
        // the authoritative check. This one only avoids the registry read, and
        // its failure logging, on a node that is not metering at all.
        let venue = if flags.billing_enabled {
            billing::resolve_venue(&check.location).await
        } else {
            billing::Venue::Unresolved
        };
        // Item 1.11: the region whose node WROTE the row — EXEC-SPEC §11A's
        // attribution axis. Only a super cluster has one, so a single-region
        // deployment leaves it `None` rather than stamping the `"default"`
        // placeholder, which would say nothing while looking like an answer.
        //
        // It is NOT the probe's execution region. That is `check.location`, and
        // giving one column two meanings would make the first query that joins
        // the two wrong.
        //
        // The section is bound locally on purpose: the source-level guard
        // `lib.rs::nothing_on_the_run_path_publishes` counts the dotted
        // `enabled` access on that config section against the number of
        // super-cluster PUBLISHES in this file, and this is a read. Reaching it
        // through a binding keeps that count honest instead of inflating it.
        let sc = &ent.super_cluster;
        let region = (sc.enabled && !sc.region.is_empty()).then(|| sc.region.clone());
        let inputs =
            billing::inputs_from(&check, &req, synthetic.retries, venue, now_us, region, pool);
        // Built BEFORE `events_for_ack` consumes `inputs`. The two read the same
        // struct and must not be able to see different ones.
        let adjustment =
            billing::pool_adjustment_for_ack(flags, &inputs).map(|movement| StepPoolAdjustment {
                org_id: inputs.org_id.to_string(),
                movement,
                idempotency_key: adjustment_key(
                    inputs.synthetics_id,
                    &check.location,
                    check.scheduled_ts,
                    inputs.job_id,
                ),
            });
        (billing::events_for_ack(flags, inputs), adjustment)
    };
    // §8.1: a self-hosted Enterprise build has `enterprise` and NOT `cloud`.
    // Gating on `enterprise` would write synthetics usage rows onto every
    // customer's own cluster.
    #[cfg(not(feature = "cloud"))]
    let (usage_events, pool_adjustment) = {
        // `pool` is the caller's answer for a pool this build does not have.
        let _ = pool;
        (Vec::new(), None)
    };

    // Decide the notification, once per RUN. Per-job would alert once per
    // location for the same outage, and would advance the failure streak by the
    // fan-out factor rather than by one.
    let (alert, consecutive_failures) = if run_complete {
        resolve_alert(
            conn,
            &check.synthetics_id,
            RunOutcome {
                status: run_status.as_deref(),
                attempts: req.attempts,
                status_reason: req.status_reason.as_deref(),
                error_source: &req.error_source,
            },
            &synthetic,
            now_us,
        )
        .await
    } else {
        (AlertDecision::Silent, 0)
    };

    // Which locations broke and which came back. Only worth a query when the run
    // finished and we are going to say something about it. Both sides are needed:
    // a recovery has nothing failing to name, and a partial recovery needs both.
    let outcomes = if run_complete && !matches!(alert, AlertDecision::Silent) {
        synthetics_jobs::run_location_outcomes(conn, &check.run_id)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(run_id = %check.run_id, "[synthetics] run_location_outcomes: {e}");
                Default::default()
            })
    } else {
        Default::default()
    };
    let (failing_locations, passing_locations) = (outcomes.failing, outcomes.passing);

    Ok(AckResponse {
        run_complete,
        run_status,
        job_count,
        org_id: check.org_id,
        job_id: req.job_id,
        run_id: check.run_id,
        synthetics_id: check.synthetics_id,
        synthetics_name: synthetic.name,
        synthetic_type,
        target: synthetic.target,
        destinations: synthetic.destinations,
        location: check.location,
        pool: check.pool,
        trigger_type: req.trigger_type,
        alert,
        // Echoed straight back so the notification can name the condition.
        status_reason: req.status_reason.clone(),
        consecutive_failures,
        failing_locations,
        passing_locations,
        usage_events,
        pool_adjustment,
    })
}

/// Resolves the alert decision for a completed run and persists the new state.
///
/// A failure to read or write the state is never allowed to fail the ack: the
/// probe has already done its work and the result is already ingested. It
/// degrades to `Silent` and says so in the log, rather than making a
/// notification bookkeeping error look like a probe error.
/// What a completed run reported, as far as alerting is concerned.
///
/// Grouped rather than passed as four loose arguments because they are one fact
/// about one run — they are always read together, and `classify` takes all four.
/// Splitting them across a long parameter list is also how a caller ends up
/// transposing two `&str`s the compiler cannot tell apart.
struct RunOutcome<'a> {
    status: Option<&'a str>,
    attempts: i32,
    /// `flaky`, `cert_expiring`, `sftp_degraded`. `None` from a probe too old to
    /// report one, which falls back to the `attempts` proxy.
    status_reason: Option<&'a str>,
    error_source: &'a str,
}

async fn resolve_alert<C: sea_orm::ConnectionTrait>(
    conn: &C,
    synthetics_id: &str,
    outcome: RunOutcome<'_>,
    check: &config::meta::synthetics::Synthetic,
    now_us: i64,
) -> (AlertDecision, i32) {
    // See `alerting::classify`. Four outcomes, not two: an outage accumulates and
    // drives the streak, a degradation does not (a certificate is not "more
    // expired" on the twentieth check), and `error` is an outage rather than a
    // reason for silence.
    let class = crate::alerting::classify(
        outcome.status,
        outcome.attempts,
        outcome.error_source,
        outcome.status_reason,
    );

    let prior = match infra::table::synthetics_checks::get_alert_state(conn, synthetics_id).await {
        Ok(Some(state)) => state,
        Ok(None) => return (AlertDecision::Silent, 0), // deleted mid-run
        Err(e) => {
            tracing::warn!(%synthetics_id, "[synthetics] get_alert_state: {e}");
            return (AlertDecision::Silent, 0);
        }
    };

    // A check with no destination cannot notify, so it must not accumulate alert
    // state. Advancing it anyway produced a check sitting at `alerting = true`
    // having never sent anything — and two follow-on faults:
    //
    //   1. Add a destination later, let the check recover, and the FIRST thing the user receives is
    //      "RECOVERED" for an incident they were never told about. Suppressing exactly that is why
    //      `alerting` exists.
    //   2. `last_alert_at` was stamped without a send, so the first real failure after adding a
    //      destination lands inside a cooldown it never earned and is silenced.
    //
    // Stale state is cleared rather than merely left alone: a destination can be
    // removed mid-incident, and `alerting = true` must not outlive the ability
    // to act on it.
    if check.destinations.is_empty() {
        if prior != infra::table::synthetics_checks::AlertState::default()
            && let Err(e) = infra::table::synthetics_checks::update_alert_state_if(
                conn,
                synthetics_id,
                prior,
                infra::table::synthetics_checks::AlertState::default(),
            )
            .await
        {
            tracing::warn!(%synthetics_id, "[synthetics] clear_alert_state: {e}");
        }
        return (AlertDecision::Silent, 0);
    }

    let (outcome, next) = crate::alerting::decide(
        prior,
        class,
        check.alert_if_fails,
        check.cooldown_mins,
        now_us,
    );

    // Compare-and-swap on the state we decided against. `resolve_alert` is a
    // read-modify-write with no transaction, and two runs of the same check can
    // complete close together — a run outlasts its interval precisely when the
    // target is slow, which is when it is failing. Losing the race means our
    // decision was made against a stale read, so we discard it rather than
    // overwrite the winner: the streak would otherwise undercount and the
    // notification would double.
    if next != prior {
        match infra::table::synthetics_checks::update_alert_state_if(
            conn,
            synthetics_id,
            prior,
            next,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                tracing::info!(
                    %synthetics_id,
                    "[synthetics] alert state changed under us; another run decided this one"
                );
                return (AlertDecision::Silent, next.consecutive_failures);
            }
            Err(e) => tracing::warn!(%synthetics_id, "[synthetics] update_alert_state: {e}"),
        }
    }

    let decision = match outcome {
        crate::alerting::AlertOutcome::Silent => AlertDecision::Silent,
        crate::alerting::AlertOutcome::Firing => AlertDecision::Firing,
        crate::alerting::AlertOutcome::Flaky => AlertDecision::Flaky,
        crate::alerting::AlertOutcome::Degraded => AlertDecision::Degraded,
        crate::alerting::AlertOutcome::Recovered => AlertDecision::Recovered,
    };
    (decision, next.consecutive_failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The minimum an ack has ever had to carry. Everything else on
    /// `AckRequest` is `#[serde(default)]`, which is what makes the rollback
    /// story in spec §9D true.
    fn old_probe_ack() -> serde_json::Value {
        serde_json::json!({
            "job_id": "2MNfNTxePfZ1pnY5gKVLkwsVRXv",
            "status": "up",
            "response_time_ms": 812.5,
            "attempts": 1
        })
    }

    /// **The rollback guarantee (§9D, Phase 1 wire).** The probes gain these
    /// three fields in two other repos, on their own release cadence. Until
    /// they ship — and again the moment either is rolled back — every ack
    /// arrives WITHOUT them, and an ack this server rejects is a check result
    /// thrown away, not a billing error. So absence must parse, and must parse
    /// to zero rather than to anything that would be mistaken for a real count.
    #[test]
    fn an_old_probe_acks_without_the_billing_fields_and_is_still_accepted() {
        let req: AckRequest = serde_json::from_value(old_probe_ack())
            .expect("an ack from a probe built before these fields must still deserialize");

        assert_eq!(req.steps_executed, 0);
        assert_eq!(req.steps_defined, 0);
        assert_eq!(req.browser_ms, 0);
        // And the rest of the ack is untouched by the widening.
        assert_eq!(req.job_id, "2MNfNTxePfZ1pnY5gKVLkwsVRXv");
        assert_eq!(req.status, "up");
        assert_eq!(req.attempts, 1);
    }

    /// The new-probe shape: all three present, carried through unchanged. The
    /// `18 executed / 14 defined` pair is the retry case from §4.3 — executed
    /// above defined is normal and must not be sanitised on the way in.
    #[test]
    fn an_ack_carrying_all_three_billing_fields_deserializes_them() {
        let mut body = old_probe_ack();
        body["attempts"] = serde_json::json!(2);
        body["steps_executed"] = serde_json::json!(18);
        body["steps_defined"] = serde_json::json!(14);
        body["browser_ms"] = serde_json::json!(42_137_u64);

        let req: AckRequest = serde_json::from_value(body).unwrap();

        assert_eq!(req.steps_executed, 18);
        assert_eq!(req.steps_defined, 14);
        assert_eq!(req.browser_ms, 42_137);
    }

    /// The probe side of the wire, written the way the two probe repos write
    /// it. Field names, not types, are the coupling here: this struct and
    /// `AckRequest` are compiled from different repositories and are never
    /// checked against each other by a compiler.
    #[derive(Serialize)]
    struct ProbeAck {
        job_id: String,
        status: String,
        attempts: i32,
        steps_executed: u32,
        steps_defined: u32,
        browser_ms: u64,
    }

    /// **The rename guard.** `#[serde(default)]` makes a mis-named field
    /// silent: it does not fail, it yields 0 — and a 0 `steps_executed` is
    /// indistinguishable from an old probe, so a rename on either side would
    /// zero the bill with no error anywhere. So the keys are asserted as
    /// literal strings first — a `ProbeAck` renamed in step with `AckRequest`
    /// would round-trip perfectly and prove nothing — and only then round-
    /// tripped, which is what pins the two ends to the same three names.
    #[test]
    fn the_billing_field_names_on_the_wire_are_pinned() {
        let sent = ProbeAck {
            job_id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
            status: "up".to_string(),
            attempts: 2,
            steps_executed: 18,
            steps_defined: 14,
            browser_ms: 42_137,
        };
        let wire = serde_json::to_value(&sent).unwrap();

        assert_eq!(
            wire["steps_executed"].as_u64(),
            Some(18),
            "wire name: steps_executed"
        );
        assert_eq!(
            wire["steps_defined"].as_u64(),
            Some(14),
            "wire name: steps_defined"
        );
        assert_eq!(
            wire["browser_ms"].as_u64(),
            Some(42_137),
            "wire name: browser_ms"
        );

        let back: AckRequest = serde_json::from_value(wire).unwrap();
        assert_eq!(back.steps_executed, sent.steps_executed);
        assert_eq!(back.steps_defined, sent.steps_defined);
        assert_eq!(back.browser_ms, sent.browser_ms);
    }

    /// The failure the pin above exists to catch, demonstrated. camelCase is
    /// the realistic slip — the probes are a Go binary and a Node one — and it
    /// does not fail: it is accepted and bills nothing. The server cannot tell
    /// the result apart from a probe that genuinely executed no steps, which is
    /// why the three names are pinned rather than trusted.
    #[test]
    fn a_misnamed_billing_field_silently_bills_zero() {
        let mut body = old_probe_ack();
        body["stepsExecuted"] = serde_json::json!(18);
        body["stepsDefined"] = serde_json::json!(14);
        body["browserMs"] = serde_json::json!(42_137_u64);

        let req: AckRequest = serde_json::from_value(body).unwrap();

        assert_eq!(req.steps_executed, 0);
        assert_eq!(req.steps_defined, 0);
        assert_eq!(req.browser_ms, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Step billing — SPEC §9C T1–T21, §10 E1–E13/E21/E22, §11 F6/F7/F9.
    //
    // Every guard in SPEC §4.1 step 3 is a pure function here, so a "duplicate ack
    // bills nothing" test needs no database, no usage queue and no globals.
    // ─────────────────────────────────────────────────────────────────────────────
    #[cfg(feature = "cloud")]
    mod billing {
        use config::meta::{
            self_reporting::usage::{UsageData, UsageEvent},
            stream::StreamType,
        };
        use infra::table::synthetics_jobs::LeasedRow;

        use crate::job_api::{
            AckRequest, AlertDecision, PoolMovement, StepPoolDirection, StepPoolView,
            adjustment_key,
            billing::{
                BillingFlags, BillingInputs, Venue, events_for_ack, frozen_combos, inputs_from,
                pool_adjustment_for_ack, reconcile,
            },
            enqueue_reservation, stale_lease_response,
        };

        /// 2026-08-25T13:47:11Z, so the derived hour fields are checkable literals.
        const NOW_US: i64 = 1_787_665_631_000_000;

        /// Phase 1 as deployed once the operator flips the switch: the emit live,
        /// the clamp on.
        const LIVE: BillingFlags = BillingFlags {
            billing_enabled: true,
            clamp_enabled: true,
        };

        /// A browser ack that ran on a public location and completed cleanly.
        /// `steps_configured` is per combo (what the scheduler freezes), `combos` is
        /// the fan-out inside this one job.
        fn browser(
            configured: i32,
            combos: u32,
            retries: i32,
            executed: u32,
        ) -> BillingInputs<'static> {
            BillingInputs {
                org_id: "acme",
                job_id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv",
                synthetics_id: "chk_1",
                venue: Venue::Public,
                error_source: "",
                steps_executed: executed,
                steps_defined: 0,
                browser_ms: 0,
                steps_configured: configured,
                combos: Some(combos),
                retries,
                now_us: NOW_US,
                // The Phase 1 default. Every test below that cares about the
                // free pool overrides it, and every test that does not is
                // asserting the BILLABLE row — which is what an org with no
                // pool, or a node with no metering, produces.
                pool: StepPoolView::NotApplicable,
                region: None,
            }
        }

        /// A protocol ack: no `browser_devices` column, one step per attempt (§1.1).
        fn protocol(retries: i32, executed: u32) -> BillingInputs<'static> {
            BillingInputs {
                combos: None,
                steps_configured: 1,
                retries,
                steps_executed: executed,
                ..browser(1, 1, retries, executed)
            }
        }

        /// The `size` of the one row carrying `event`, or `None` if absent.
        fn size_for(events: &[UsageData], event: UsageEvent) -> Option<f64> {
            let mut matching = events.iter().filter(|e| e.event == event);
            let first = matching.next()?.size;
            assert!(
                matching.next().is_none(),
                "{event} must appear at most once per ack"
            );
            Some(first)
        }

        fn billed(events: &[UsageData]) -> Option<f64> {
            size_for(events, UsageEvent::SyntheticsSteps)
        }

        fn defined(events: &[UsageData]) -> Option<f64> {
            size_for(events, UsageEvent::_SyntheticsStepsDefined)
        }

        // ── Counting — §9C T1, T2, T3, T9 ───────────────────────────────────────

        /// **T1.** `http`/`tcp`/`tls`/`ssh`, one attempt ⇒ one step. §1.1: one
        /// request is one step.
        #[test]
        fn t1_protocol_check_one_attempt_bills_one_step() {
            let events = events_for_ack(LIVE, protocol(0, 1));
            assert_eq!(billed(&events), Some(1.0));
        }

        /// **T2.** A 14-step journey, one combo, no retry ⇒ 14 billed and 14
        /// defined.
        #[test]
        fn t2_browser_fourteen_steps_one_combo_no_retry() {
            let events = events_for_ack(LIVE, browser(14, 1, 0, 14));
            assert_eq!(billed(&events), Some(14.0));
            assert_eq!(defined(&events), Some(14.0));
        }

        /// **T3 / E21 / E22.** 14 steps × 2 combos × 3 locations = 84.
        ///
        /// Combos are sequential INSIDE one job (§1.2), so one ack carries all of a
        /// location's combos: 28. Locations are separate jobs with separate acks
        /// (E22), so the 84 is a sum over three acks — which is what
        /// `ingest_usages` does with `size` for a shared `GroupKey`.
        ///
        /// ⚠ This is the case that decides whether the clamp ceiling includes the
        /// combo factor. SPEC §4.4.1's snippet reads `configured × (retries + 1)`,
        /// which for this ack is 14 — it would clamp 28 down to 14 and under-bill
        /// by the fan-out factor, and E21's twelve-combo check by 12×. §4.2 defines
        /// "defined" as `configured × combos`, so the ceiling must use the same
        /// product. See the note on `frozen_definition`.
        #[test]
        fn t3_browser_fourteen_steps_two_combos_three_locations_sums_to_84() {
            let per_location = events_for_ack(LIVE, browser(14, 2, 0, 28));
            assert_eq!(
                billed(&per_location),
                Some(28.0),
                "one location, two combos"
            );
            assert_eq!(defined(&per_location), Some(28.0));

            let total: f64 = (0..3)
                .map(|_| billed(&events_for_ack(LIVE, browser(14, 2, 0, 28))).unwrap())
                .sum();
            assert_eq!(total, 84.0, "3 locations × 2 combos × 14 steps");
        }

        /// **E21.** Twelve combos, one ack, no clamp: 12 × 14 = 168.
        #[test]
        fn e21_twelve_combos_bill_twelve_times_the_steps_in_one_ack() {
            let events = events_for_ack(LIVE, browser(14, 12, 0, 168));
            assert_eq!(billed(&events), Some(168.0));
        }

        /// **T9.** A protocol check that took three attempts bills three steps —
        /// retries are billed additively (§2.3, decision 2).
        #[test]
        fn t9_protocol_three_attempts_bills_three_steps() {
            // `attempts = 3` is `retries = 2`.
            let events = events_for_ack(LIVE, protocol(2, 3));
            assert_eq!(billed(&events), Some(3.0));
        }

        /// **E1 / E2 / E3 / E4.** Partial and retried runs bill what executed.
        /// The server bills the probe's count; these differ only in that count.
        #[test]
        fn e1_e2_e3_partial_and_retried_runs_bill_what_executed() {
            // E1 — fails at step 4 of 14, no retry.
            let events = events_for_ack(LIVE, browser(14, 1, 0, 4));
            assert_eq!(billed(&events), Some(4.0));
            assert_eq!(defined(&events), Some(14.0), "defined is still the journey");

            // E2 — fails at 4, retry completes 14: 18 cumulative, under the
            // ceiling of 14 × 2 = 28.
            let events = events_for_ack(LIVE, browser(14, 1, 1, 18));
            assert_eq!(billed(&events), Some(18.0));

            // E3 — fails at step 1: the one step that ran.
            let events = events_for_ack(LIVE, browser(14, 1, 0, 1));
            assert_eq!(billed(&events), Some(1.0));
        }

        // ── Guards — §9C T10–T18 ────────────────────────────────────────────────

        /// **T10 / E6.** A probe reporting above `configured × combos ×
        /// (retries + 1)` is clamped to the ceiling.
        #[test]
        fn t10_a_report_above_the_ceiling_is_clamped() {
            // ceiling = 14 × 1 × (0 + 1) = 14
            let events = events_for_ack(LIVE, browser(14, 1, 0, 9_999));
            assert_eq!(billed(&events), Some(14.0));
        }

        /// **T10, the boundary.** Exactly at the ceiling is not clamped; one above
        /// is. An off-by-one here silently over- or under-bills every retried run.
        #[test]
        fn t10_the_clamp_boundary_is_inclusive_of_the_ceiling() {
            // ceiling = 14 × 2 combos × (1 retry + 1) = 56
            assert_eq!(
                billed(&events_for_ack(LIVE, browser(14, 2, 1, 56))),
                Some(56.0)
            );
            assert_eq!(
                billed(&events_for_ack(LIVE, browser(14, 2, 1, 57))),
                Some(56.0)
            );
        }

        /// **§9A `O2_SYNTHETICS_STEP_CLAMP_ENABLED = false`.** The incident switch:
        /// the over-report is billed as reported, without a deploy.
        #[test]
        fn the_clamp_can_be_disabled_at_runtime() {
            let flags = BillingFlags {
                clamp_enabled: false,
                ..LIVE
            };
            assert_eq!(
                billed(&events_for_ack(flags, browser(14, 1, 0, 9_999))),
                Some(9_999.0)
            );
            // And it changes nothing when nothing was over the ceiling.
            assert_eq!(
                billed(&events_for_ack(flags, browser(14, 1, 0, 14))),
                Some(14.0)
            );
        }

        /// **T11 / E7.** An old probe sends `steps_executed = 0` on a browser
        /// check ⇒ bill the frozen definition, across every combo. Never 0.
        #[test]
        fn t11_zero_from_an_old_browser_probe_falls_back_to_the_frozen_definition() {
            assert_eq!(
                billed(&events_for_ack(LIVE, browser(14, 1, 0, 0))),
                Some(14.0)
            );
            assert_eq!(
                billed(&events_for_ack(LIVE, browser(14, 2, 0, 0))),
                Some(28.0),
                "the fallback is the whole definition, combos included"
            );
        }

        /// **T12.** The same from a protocol probe ⇒ 1, not the attempt count: an
        /// old probe's `attempts` is itself defaulted to 0.
        #[test]
        fn t12_zero_from_an_old_protocol_probe_falls_back_to_one() {
            assert_eq!(billed(&events_for_ack(LIVE, protocol(0, 0))), Some(1.0));
            assert_eq!(
                billed(&events_for_ack(LIVE, protocol(2, 0))),
                Some(1.0),
                "retries must not inflate a fallback"
            );
        }

        /// **§4.4.2's whole point.** No input to a billable ack bills zero.
        #[test]
        fn f9_no_billable_ack_ever_bills_zero_steps() {
            for configured in [1, 5, 14, 50] {
                for combos in [1_u32, 2, 12] {
                    for retries in [0, 1, 3] {
                        for executed in [0_u32, 1, 14, 1_000_000] {
                            let events = events_for_ack(
                                LIVE,
                                browser(configured, combos, retries, executed),
                            );
                            let size = billed(&events).expect("a public ack must bill");
                            assert!(
                                size >= 1.0,
                                "configured={configured} combos={combos} retries={retries} \
                                 executed={executed} billed {size}"
                            );
                        }
                    }
                }
            }
        }

        /// **T13 / E5.** The journey was edited 14 → 8 while these jobs were in
        /// flight. The ceiling uses the count FROZEN on the job row; `retries`
        /// comes from the LIVE check. That asymmetry is §4.4.1's, deliberately, and
        /// it is a property of the WIRING — so this goes through `inputs_from`,
        /// which is the only place either value can enter.
        #[test]
        fn t13_the_ceiling_uses_the_frozen_count_not_the_live_one() {
            // Enqueued when the journey defined 14 steps; edited to 8 since.
            let mut row = leased_row();
            row.steps_configured = 14;
            row.browser_devices = Some(one_combo());
            let req = probe_ack(14, 0);

            // `inputs_from` cannot see the live 8 at all — there is no parameter
            // for it. A ceiling built from the edited definition would clamp this
            // to 8; the frozen 14 does not.
            let events = events_for_ack(
                LIVE,
                inputs_from(
                    &row,
                    &req,
                    0,
                    Venue::Public,
                    NOW_US,
                    None,
                    StepPoolView::NotApplicable,
                ),
            );
            assert_eq!(billed(&events), Some(14.0));
        }

        /// The other half of the asymmetry: `retries` DOES move the ceiling, and it
        /// is the caller's argument — `ack` sources it from the live check — not
        /// anything on the frozen row.
        #[test]
        fn the_live_retry_count_moves_the_ceiling_and_the_frozen_row_does_not_carry_it() {
            let mut row = leased_row();
            row.steps_configured = 8;
            row.browser_devices = Some(one_combo());
            let req = probe_ack(16, 0);

            // retries = 1 ⇒ ceiling 8 × (1 + 1) = 16.
            let events = events_for_ack(
                LIVE,
                inputs_from(
                    &row,
                    &req,
                    1,
                    Venue::Public,
                    NOW_US,
                    None,
                    StepPoolView::NotApplicable,
                ),
            );
            assert_eq!(billed(&events), Some(16.0));

            // retries = 0 ⇒ ceiling 8, and the same ack clamps.
            let events = events_for_ack(
                LIVE,
                inputs_from(
                    &row,
                    &req,
                    0,
                    Venue::Public,
                    NOW_US,
                    None,
                    StepPoolView::NotApplicable,
                ),
            );
            assert_eq!(billed(&events), Some(8.0));
        }

        /// `inputs_from` reads each value from exactly one place: the frozen row,
        /// the probe's request, or the caller. Mixing them up is the failure T13
        /// and §4.4.1's asymmetry exist to prevent, and it would be invisible in
        /// the arithmetic tests above.
        #[test]
        fn inputs_from_takes_the_frozen_values_from_the_row_and_the_reported_ones_from_the_request()
        {
            let mut row = leased_row();
            row.org_id = "acme".to_string();
            row.id = "job_7".to_string();
            row.synthetics_id = "chk_7".to_string();
            row.steps_configured = 14;
            row.browser_devices = Some(two_combos());

            let mut req = probe_ack(18, 14);
            req.browser_ms = 42_137;
            req.error_source = "probe".to_string();

            let i = inputs_from(
                &row,
                &req,
                3,
                Venue::Public,
                NOW_US,
                Some("eu-1".into()),
                StepPoolView::NotApplicable,
            );

            // From the FROZEN row.
            assert_eq!(i.steps_configured, 14);
            assert_eq!(i.combos, Some(2));
            assert_eq!(i.org_id, "acme");
            assert_eq!(i.job_id, "job_7");
            assert_eq!(i.synthetics_id, "chk_7");
            // From the probe's REQUEST.
            assert_eq!(i.steps_executed, 18);
            assert_eq!(i.steps_defined, 14);
            assert_eq!(i.browser_ms, 42_137);
            assert_eq!(i.error_source, "probe");
            // From the CALLER — the live check.
            assert_eq!(i.retries, 3);
            assert_eq!(i.venue, Venue::Public);
            assert_eq!(i.now_us, NOW_US);
            assert_eq!(i.region.as_deref(), Some("eu-1"));
        }

        /// A protocol job has no `browser_devices` column, so `inputs_from` reports
        /// no combos — which is what makes the §4.4.2 fallback take the protocol
        /// branch.
        #[test]
        fn inputs_from_reads_a_protocol_job_as_having_no_combos() {
            let mut row = leased_row();
            row.browser_devices = None;
            row.steps_configured = 1;
            let req = probe_ack(0, 0);

            let events = events_for_ack(
                LIVE,
                inputs_from(
                    &row,
                    &req,
                    0,
                    Venue::Public,
                    NOW_US,
                    None,
                    StepPoolView::NotApplicable,
                ),
            );
            assert_eq!(billed(&events), Some(1.0));
        }

        /// **T14 / E8 — duplicate ack.** `ack_complete` returned `None`, so the ack
        /// did not apply. Exactly-once: the response carries no usage events.
        #[test]
        fn t14_a_duplicate_ack_emits_nothing() {
            let resp = stale_lease_response(
                "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                "scheduled".to_string(),
                leased_row(),
            );
            assert!(resp.usage_events.is_empty());
            // …and it still touches no run accounting.
            assert!(!resp.run_complete);
            assert_eq!(resp.job_count, 0);
            assert_eq!(resp.alert, AlertDecision::Silent);
        }

        /// **T15 / E9 — late ack from an evicted holder.** The reaper handed the
        /// job to another agent; `ack_complete` returns `None` for the same reason,
        /// through the same path, so it bills the same nothing.
        #[test]
        fn t15_a_late_ack_from_an_evicted_holder_emits_nothing() {
            let resp = stale_lease_response(
                "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                "scheduled".to_string(),
                leased_row(),
            );
            assert!(resp.usage_events.is_empty());
        }

        /// **T16 / E11.** `error_source = "queue"` — the job waited behind other
        /// jobs until its own `valid_until` passed and was never executed. Our
        /// scheduling lag, not the customer's work.
        #[test]
        fn t16_a_queue_error_emits_nothing() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    error_source: "queue",
                    ..browser(14, 1, 0, 0)
                },
            );
            assert!(events.is_empty());

            // Even if a probe somehow reported real steps alongside it.
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    error_source: "queue",
                    ..browser(14, 1, 0, 14)
                },
            );
            assert!(events.is_empty());
        }

        /// **T17 / E13 / §8.2.** A private agent is the customer's own hardware.
        /// A Cloud org running one is a `cloud` build that MUST NOT bill.
        #[test]
        fn t17_a_private_venue_emits_nothing() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    venue: Venue::Private,
                    ..browser(14, 1, 0, 14)
                },
            );
            assert!(events.is_empty());
        }

        /// **Item 1.4, the failure direction.** A venue we could not resolve — the
        /// registry read failed, or the location has no row — bills nothing. Only a
        /// positively-public row bills.
        #[test]
        fn an_unresolved_venue_emits_nothing() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    venue: Venue::Unresolved,
                    ..browser(14, 1, 0, 14)
                },
            );
            assert!(events.is_empty());
        }

        /// **T18 / E12.** A Lambda invoke failure DOES bill — `mark_failure`
        /// reaches `ack_complete`, and the invocation cost us money. Only `"queue"`
        /// is exempt; `"dispatch"` and `"probe"` are not.
        #[test]
        fn t18_a_lambda_invoke_failure_still_bills() {
            for source in ["dispatch", "probe"] {
                let events = events_for_ack(
                    LIVE,
                    BillingInputs {
                        error_source: source,
                        ..browser(14, 1, 0, 3)
                    },
                );
                assert_eq!(
                    billed(&events),
                    Some(3.0),
                    "error_source={source} must still bill"
                );
            }
        }

        // ── Events — §9C T19, T20, T21 ──────────────────────────────────────────

        /// **T19.** `_SyntheticsStepsDefined` accompanies EVERY billable ack — it
        /// is half of §4.3's ratio and cannot be reconstructed later.
        #[test]
        fn t19_every_billable_ack_carries_steps_defined() {
            for (configured, combos, retries, executed) in [
                (14, 1, 0, 14),
                (14, 2, 1, 3),
                (1, 1, 0, 0),
                (50, 12, 3, 99_999),
            ] {
                let events = events_for_ack(LIVE, browser(configured, combos, retries, executed));
                assert!(billed(&events).is_some());
                assert!(
                    defined(&events).is_some(),
                    "no _SyntheticsStepsDefined for ({configured}, {combos}, {retries}, {executed})"
                );
            }
        }

        /// `_SyntheticsStepsDefined` reports what the PROBE says the journey
        /// defined, and falls back to the frozen definition only when the probe is
        /// too old to say. It is never clamped — nothing bills on it.
        #[test]
        fn steps_defined_prefers_the_probe_and_is_never_clamped() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    steps_defined: 8,
                    ..browser(14, 1, 0, 8)
                },
            );
            assert_eq!(defined(&events), Some(8.0), "the probe's own number");

            // Absurdly large, and still not clamped: it is not billed.
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    steps_defined: 4_000,
                    ..browser(14, 1, 0, 14)
                },
            );
            assert_eq!(defined(&events), Some(4_000.0));
            assert_eq!(billed(&events), Some(14.0), "…while the BILLED count is");
        }

        /// **T21.** Nothing on this path marks a free or underscore variant
        /// billable. Phase 1 emits `SyntheticsSteps` and never
        /// `SyntheticsFreeSteps` — the free-pool split is Phase 2 item 2.3.
        #[test]
        fn t21_phase_one_emits_the_billable_variant_and_never_the_free_one() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    browser_ms: 42_137,
                    ..browser(14, 1, 0, 14)
                },
            );
            let names: Vec<String> = events.iter().map(|e| e.event.to_string()).collect();
            assert_eq!(
                names,
                vec![
                    "SyntheticsSteps".to_string(),
                    "_SyntheticsStepsDefined".to_string(),
                    "_SyntheticsBrowserMs".to_string(),
                ]
            );
            assert!(
                !events
                    .iter()
                    .any(|e| e.event == UsageEvent::SyntheticsFreeSteps),
                "the free-pool branch is Phase 2 item 2.3 and must not be emitted yet"
            );
        }

        /// Exactly one of the two step-count variants per ack (§4.2).
        #[test]
        fn exactly_one_billable_or_free_step_event_per_ack() {
            let events = events_for_ack(LIVE, browser(14, 1, 0, 14));
            let count = events
                .iter()
                .filter(|e| {
                    matches!(
                        e.event,
                        UsageEvent::SyntheticsSteps | UsageEvent::SyntheticsFreeSteps
                    )
                })
                .count();
            assert_eq!(count, 1);
        }

        /// `_SyntheticsBrowserMs` carries `browser_ms`, and is omitted when there
        /// is none — a protocol ack has no browser duration to report.
        #[test]
        fn browser_ms_is_emitted_only_when_there_is_a_duration() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    browser_ms: 42_137,
                    ..browser(14, 1, 0, 14)
                },
            );
            assert_eq!(
                size_for(&events, UsageEvent::_SyntheticsBrowserMs),
                Some(42_137.0)
            );

            let events = events_for_ack(LIVE, protocol(0, 1));
            assert_eq!(size_for(&events, UsageEvent::_SyntheticsBrowserMs), None);
        }

        /// **T20 / §4.2's hard rule.** `ingest_usages` sums only `size` and
        /// `num_records`; `response_time` is AVERAGED and `request_body` keeps the
        /// FIRST row of the bucket. So a per-run count must travel in `size` and
        /// nowhere else.
        #[test]
        fn t20_no_per_run_count_travels_outside_size() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    browser_ms: 42_137,
                    steps_defined: 14,
                    // retries = 1 ⇒ ceiling 28, so the 18 is not clamped here.
                    ..browser(14, 1, 1, 18)
                },
            );
            assert_eq!(events.len(), 3);
            for e in &events {
                assert_eq!(e.request_body, "", "request_body keeps only the FIRST row");
                assert_eq!(
                    e.response_time, 0.0,
                    "response_time is averaged, not summed"
                );
                assert_eq!(e.num_records, 1, "sums to the ack count for the hour");
            }
            // And every number that must survive summation is in `size`.
            assert_eq!(billed(&events), Some(18.0));
            assert_eq!(defined(&events), Some(14.0));
            assert_eq!(
                size_for(&events, UsageEvent::_SyntheticsBrowserMs),
                Some(42_137.0)
            );
        }

        /// The remaining `UsageData` fields a metering row needs to be readable and
        /// to aggregate into the right bucket.
        #[test]
        fn the_usage_row_is_shaped_for_the_metering_pipeline() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    browser_ms: 5,
                    region: Some("us-west-2".to_string()),
                    ..browser(14, 1, 0, 14)
                },
            );
            for e in &events {
                assert_eq!(e.org_id, "acme", "the metering loop groups by org_id");
                assert_eq!(e._timestamp, NOW_US);
                assert_eq!(e.year, 2026);
                assert_eq!(e.month, 8);
                assert_eq!(e.day, 25);
                assert_eq!(e.hour, 13);
                assert_eq!(e.event_time_hour, "2026082513");
                assert_eq!(e.stream_type, StreamType::Logs);
                assert_eq!(e.stream_name, "");
                assert_eq!(e.user_email, "", "a probe acked, not a user");
                assert_eq!(e.dropped_records, 0);
                assert!(!e.is_partial);
                assert_eq!(e.region.as_deref(), Some("us-west-2"));
                assert!(e.trace_id.is_none());
                assert!(e.search_type.is_none());
                assert!(e.dashboard_info.is_none());
            }
            // `unit` mirrors o2-enterprise's `MeteringEventName::unit()` for the
            // same event — never "MB" (§11 F3).
            for e in &events {
                let expected = match e.event {
                    UsageEvent::_SyntheticsBrowserMs => "ms",
                    _ => "steps",
                };
                assert_eq!(e.unit, expected, "{} carries the wrong unit", e.event);
                assert_ne!(e.unit, "MB");
            }
        }

        /// All four rows of one ack share a `GroupKey` hour, so an ack that lands
        /// either side of an hour boundary cannot split itself across two.
        #[test]
        fn all_rows_of_one_ack_share_one_timestamp() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    browser_ms: 5,
                    ..browser(14, 1, 0, 14)
                },
            );
            let first = &events[0];
            for e in &events {
                assert_eq!(e._timestamp, first._timestamp);
                assert_eq!(e.event_time_hour, first.event_time_hour);
                assert_eq!(
                    (e.year, e.month, e.day, e.hour),
                    (first.year, first.month, first.day, first.hour)
                );
            }
        }

        // ── The §9A / §9D master switch ─────────────────────────────────────────

        /// **§9D's MUST.** `O2_SYNTHETICS_BILLING_ENABLED = false` stops the emit
        /// itself — the rollback for a mis-metering incident is a config flip, not
        /// a redeploy. This is also §11 F2's stated mitigation, which is a no-op
        /// unless the flag gates the WRITE.
        #[test]
        fn the_master_switch_off_emits_nothing() {
            let off = BillingFlags {
                billing_enabled: false,
                ..LIVE
            };
            assert!(events_for_ack(off, browser(14, 1, 0, 14)).is_empty());
            assert!(events_for_ack(off, protocol(0, 1)).is_empty());
        }

        /// **§9A.** `BILLING_ENABLED = false` with the emit code live is the
        /// Phase 1 shipping state, and it is a supported configuration rather than
        /// an accident of ordering: the path is REACHED, it is inert, it returns a
        /// well-formed empty result, and it is independent of the clamp switch.
        #[test]
        fn both_flag_positions_are_supported_and_the_two_flags_are_independent() {
            for clamp_enabled in [true, false] {
                let off = BillingFlags {
                    billing_enabled: false,
                    clamp_enabled,
                };
                assert!(
                    events_for_ack(off, browser(14, 1, 0, 9_999)).is_empty(),
                    "the master switch wins regardless of the clamp switch"
                );
                let on = BillingFlags {
                    billing_enabled: true,
                    clamp_enabled,
                };
                let expected = if clamp_enabled { 14.0 } else { 9_999.0 };
                assert_eq!(
                    billed(&events_for_ack(on, browser(14, 1, 0, 9_999))),
                    Some(expected),
                    "the clamp switch decides only the clamp"
                );
            }
        }

        // ── Arithmetic safety ───────────────────────────────────────────────────

        /// No input can overflow, panic, or produce a negative or zero ceiling.
        /// `steps_configured` is `i32` on the row while §4.4.1's snippet is `u32`,
        /// so the cast is at the clamp site and every combining op saturates.
        #[test]
        fn the_clamp_arithmetic_cannot_overflow_or_go_negative() {
            let extremes = [
                // (steps_configured, combos, retries, executed)
                (i32::MAX, u32::MAX, i32::MAX, u32::MAX),
                (i32::MAX, 1, 0, u32::MAX),
                (1, u32::MAX, i32::MAX, 1),
                // Impossible at the source (NOT NULL, floored at 1) — asserted so a
                // corrupt row can only ever floor UP, never to a zero ceiling.
                (0, 1, 0, 14),
                (-1, 1, 0, 14),
                (i32::MIN, 1, i32::MIN, 14),
            ];
            for (configured, combos, retries, executed) in extremes {
                let events = events_for_ack(LIVE, browser(configured, combos, retries, executed));
                let size = billed(&events).expect("a public ack must bill");
                assert!(
                    size >= 1.0 && size.is_finite(),
                    "({configured}, {combos}, {retries}, {executed}) billed {size}"
                );
            }
        }

        // ── The frozen check-type / fan-out signal ──────────────────────────────

        /// `browser_devices` is written by the scheduler iff the check is a browser
        /// check, so its PRESENCE is the frozen check type — unlike the live
        /// `check_type`, it cannot change under an in-flight job.
        #[test]
        fn frozen_combos_reads_the_fan_out_off_the_job_row() {
            assert_eq!(frozen_combos(None), None, "protocol: no column");
            assert_eq!(
                frozen_combos(Some(
                    r#"[{"execution_id":"a","engine":"chromium","device":"desktop"}]"#
                )),
                Some(1)
            );
            assert_eq!(
                frozen_combos(Some(
                    r#"[{"execution_id":"a","engine":"chromium","device":"desktop"},
                        {"execution_id":"b","engine":"webkit","device":"mobile"}]"#
                )),
                Some(2)
            );
            // Present but unreadable or empty is still "browser", floored to one
            // combo: a zero fan-out is a zero ceiling, and a zero ceiling bills
            // real work as nothing.
            assert_eq!(frozen_combos(Some("[]")), Some(1));
            assert_eq!(frozen_combos(Some("not json")), Some(1));
        }

        /// A protocol job's `browser_devices` is NULL, so the zero-fallback takes
        /// the protocol branch even when the frozen `steps_configured` is not 1.
        #[test]
        fn the_absent_browser_devices_column_is_what_makes_a_check_protocol() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    combos: None,
                    steps_configured: 14,
                    ..browser(14, 1, 0, 0)
                },
            );
            assert_eq!(billed(&events), Some(1.0), "protocol falls back to 1");
        }

        // ── The wire contract of the returned events ────────────────────────────

        /// The usage rows ride back on `AckResponse` as DATA and must never reach
        /// the probe. `AckResponse` is the HTTP body of a single ack, so the field
        /// is `#[serde(skip)]` — pinned here because dropping that attribute would
        /// silently start shipping the org's billing rows to a probe agent.
        #[test]
        fn the_usage_events_never_serialize_onto_the_probes_response() {
            let mut resp = stale_lease_response(
                "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                "scheduled".to_string(),
                leased_row(),
            );
            resp.usage_events = events_for_ack(LIVE, browser(14, 1, 0, 14));
            assert!(!resp.usage_events.is_empty(), "precondition");

            let wire = serde_json::to_value(&resp).unwrap();
            let obj = wire.as_object().unwrap();
            assert!(!obj.contains_key("usage_events"));
            let text = wire.to_string();
            for leaked in ["usage_events", "SyntheticsSteps", "_SyntheticsStepsDefined"] {
                assert!(!text.contains(leaked), "`{leaked}` leaked to the probe");
            }
        }

        /// An `AckRequest` carrying the three billing fields feeds them straight
        /// into the guard chain — the wire and the arithmetic agree on units.
        #[test]
        fn an_ack_request_feeds_the_guards_directly() {
            let req: AckRequest = serde_json::from_value(serde_json::json!({
                "job_id": "2MNfNTxePfZ1pnY5gKVLkwsVRXv",
                "status": "down",
                "attempts": 2,
                "steps_executed": 18,
                "steps_defined": 14,
                "browser_ms": 42_137_u64,
            }))
            .unwrap();

            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    steps_executed: req.steps_executed,
                    steps_defined: req.steps_defined,
                    browser_ms: req.browser_ms,
                    error_source: &req.error_source,
                    retries: req.attempts - 1,
                    ..browser(14, 1, 1, 0)
                },
            );
            assert_eq!(billed(&events), Some(18.0));
            assert_eq!(defined(&events), Some(14.0));
            assert_eq!(
                size_for(&events, UsageEvent::_SyntheticsBrowserMs),
                Some(42_137.0)
            );
        }

        // ── The free pool — §6, items 2.3/2.4, tests T25-T31 ───────────────

        /// A funded ack: the org's one-time grant still had room when it landed.
        fn funded(i: BillingInputs<'static>) -> BillingInputs<'static> {
            BillingInputs {
                pool: StepPoolView::Funded,
                ..i
            }
        }

        fn free_billed(events: &[UsageData]) -> Option<f64> {
            size_for(events, UsageEvent::SyntheticsFreeSteps)
        }

        /// The number of §4.2 step rows in an ack. MUST be exactly one when the
        /// ack bills at all — *"exactly one of the first two per ack"*.
        fn step_rows(events: &[UsageData]) -> usize {
            events
                .iter()
                .filter(|e| {
                    matches!(
                        e.event,
                        UsageEvent::SyntheticsSteps | UsageEvent::SyntheticsFreeSteps
                    )
                })
                .count()
        }

        // --- the reservation, and the baseline it must equal ---

        /// **The load-bearing identity of item 2.3.** The enqueue reserves
        /// `configured x combos` and the ack reconciles against
        /// `frozen_definition()`. Nothing records what the enqueue actually took
        /// — SPEC §5 adds no column for it — so if these two ever computed
        /// different numbers, every ack would refund or top up a difference that
        /// never existed, silently and forever.
        ///
        /// They agree because there is ONE function. This asserts that over the
        /// whole shape space rather than trusting the call graph.
        #[test]
        fn the_reservation_and_the_reconcile_baseline_are_the_same_number() {
            for configured in [1i32, 5, 14, 50] {
                for combos in [None, Some(1u32), Some(2), Some(12)] {
                    let i = BillingInputs {
                        steps_configured: configured,
                        combos,
                        ..browser(configured, 1, 0, 0)
                    };
                    assert_eq!(
                        enqueue_reservation(configured, combos),
                        i.frozen_definition(),
                        "configured={configured} combos={combos:?}",
                    );
                }
            }
        }

        /// A zero reservation is a zero clamp ceiling, and a zero ceiling bills
        /// real executed work as nothing (§4.4.2 forbids exactly that). Both
        /// inputs are floored, so no combination can produce one.
        #[test]
        fn a_reservation_is_never_zero() {
            assert_eq!(enqueue_reservation(14, Some(2)), 28);
            assert_eq!(enqueue_reservation(0, Some(2)), 2, "configured floors to 1");
            assert_eq!(enqueue_reservation(-7, None), 1, "a negative floors to 1");
            assert_eq!(enqueue_reservation(14, Some(0)), 14, "combos floor to 1");
            assert_eq!(enqueue_reservation(1, None), 1, "a protocol check");
        }

        /// SPEC §6.3 is explicit that the baseline is the NO-RETRY count: a
        /// reservation of `configured x combos x (retries + 1)` would let one
        /// flaky check hold 3x the pool it usually needs.
        #[test]
        fn the_reservation_ignores_the_retry_multiplier() {
            let no_retry = BillingInputs {
                retries: 0,
                ..browser(14, 2, 0, 28)
            };
            let three_attempts = BillingInputs {
                retries: 2,
                ..browser(14, 2, 2, 28)
            };
            assert_eq!(no_retry.frozen_definition(), 28);
            assert_eq!(
                three_attempts.frozen_definition(),
                28,
                "the reservation must not scale with retries — the clamp ceiling does, \
                 and they are different numbers",
            );
        }

        // --- the reconcile arithmetic ---

        #[test]
        fn reconcile_refunds_tops_up_and_stays_silent_when_they_match() {
            assert_eq!(
                reconcile(14, 4),
                Some(PoolMovement {
                    direction: StepPoolDirection::Refund,
                    steps: 10
                }),
            );
            assert_eq!(
                reconcile(14, 18),
                Some(PoolMovement {
                    direction: StepPoolDirection::TopUp,
                    steps: 4
                }),
            );
            assert_eq!(reconcile(14, 14), None, "the common case moves nothing");
            assert_eq!(reconcile(0, 0), None);
        }

        // --- T25 / T26 at the ack ---

        /// **T25.** The enqueue reserved 14 (`configured x combos`); the journey
        /// failed at step 4, so 4 are billed and 10 go back.
        #[test]
        fn t25_an_ack_billing_4_of_a_14_step_reservation_refunds_10() {
            let i = funded(browser(14, 1, 0, 4));
            assert_eq!(
                pool_adjustment_for_ack(LIVE, &i),
                Some(PoolMovement {
                    direction: StepPoolDirection::Refund,
                    steps: 10
                }),
            );
            // …and the row it emits is the FREE one, for the executed count.
            let events = events_for_ack(LIVE, funded(browser(14, 1, 0, 4)));
            assert_eq!(free_billed(&events), Some(4.0));
            assert_eq!(billed(&events), None);
        }

        /// **T26.** A retry fired: 18 executed against a 14-step reservation, so
        /// 4 more come out of the grant.
        #[test]
        fn t26_an_ack_billing_18_of_a_14_step_reservation_tops_up_4() {
            let i = funded(browser(14, 1, 1, 18));
            assert_eq!(
                pool_adjustment_for_ack(LIVE, &i),
                Some(PoolMovement {
                    direction: StepPoolDirection::TopUp,
                    steps: 4
                }),
            );
            let events = events_for_ack(LIVE, funded(browser(14, 1, 1, 18)));
            assert_eq!(free_billed(&events), Some(18.0));
        }

        /// The clean completion — the overwhelmingly common ack — moves nothing.
        /// A zero-valued adjustment would burn an idempotency key and a flush
        /// record on every run of every check.
        #[test]
        fn a_clean_ack_moves_the_pool_by_nothing() {
            assert_eq!(
                pool_adjustment_for_ack(LIVE, &funded(browser(14, 2, 0, 28))),
                None
            );
        }

        // --- §4.2's split ---

        /// **§4.2 — exactly one of the two step events, ever.** Both rows, or
        /// neither, would make `SUM(size)` over the usage stream unusable: the
        /// free and billable series would double-count the same steps.
        #[test]
        fn exactly_one_step_row_per_billing_ack() {
            for pool in [
                StepPoolView::Funded,
                StepPoolView::Spent,
                StepPoolView::NotApplicable,
            ] {
                let events = events_for_ack(
                    LIVE,
                    BillingInputs {
                        pool,
                        ..browser(14, 1, 0, 14)
                    },
                );
                assert_eq!(step_rows(&events), 1, "pool={pool:?}");
            }
        }

        /// A funded ack emits `SyntheticsFreeSteps` — non-billable in
        /// o2-enterprise's `is_billable`, so the grant burns down in `_usage`
        /// without reaching an invoice.
        #[test]
        fn a_funded_ack_emits_free_steps_and_never_the_billable_row() {
            let events = events_for_ack(LIVE, funded(browser(14, 2, 0, 28)));
            assert_eq!(free_billed(&events), Some(28.0));
            assert_eq!(billed(&events), None);
            // T19 — the defined row rides along with a FREE ack too. It is half
            // of §4.3's ratio, and the ratio is not a billing number.
            assert_eq!(defined(&events), Some(28.0));
        }

        /// **T31 / E16.** The grant is spent and the org is on a plan that can be
        /// charged: the run happens and is metered as overage.
        #[test]
        fn t31_a_spent_pool_emits_the_billable_row() {
            let spent = BillingInputs {
                pool: StepPoolView::Spent,
                ..browser(14, 1, 0, 14)
            };
            let events = events_for_ack(LIVE, spent);
            assert_eq!(billed(&events), Some(14.0));
            assert_eq!(free_billed(&events), None);
        }

        /// **T31 / E16, second half.** An exhausted org reserved nothing at
        /// enqueue, so its ack has nothing to reconcile. Refunding here would
        /// hand a paying org free grant it never took.
        #[test]
        fn t31_a_spent_pool_is_never_moved_by_an_ack() {
            for executed in [1u32, 4, 14, 18] {
                let spent = BillingInputs {
                    pool: StepPoolView::Spent,
                    ..browser(14, 1, 1, executed)
                };
                assert_eq!(pool_adjustment_for_ack(LIVE, &spent), None, "{executed}");
            }
        }

        /// **T36 / E18.** A contract org is *"never pool-gated"*, so its acks are
        /// `NotApplicable`: they carry the BILLABLE row — which §7.4 needs, so the
        /// NoOp provider can advance a step-denominated true-up — and they move no
        /// grant.
        #[test]
        fn t36_a_contract_org_bills_and_never_moves_the_pool() {
            let contract = BillingInputs {
                pool: StepPoolView::NotApplicable,
                ..browser(14, 1, 0, 4)
            };
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    pool: StepPoolView::NotApplicable,
                    ..browser(14, 1, 0, 4)
                },
            );
            assert_eq!(billed(&events), Some(4.0), "§7.4 needs the billable event");
            assert_eq!(free_billed(&events), None);
            assert_eq!(pool_adjustment_for_ack(LIVE, &contract), None);
        }

        /// The default is the billable row. A build that forgets to resolve the
        /// pool must under-consume the grant, never over-consume it — the wrong
        /// direction here is silently free service.
        #[test]
        fn the_default_pool_view_bills() {
            assert_eq!(StepPoolView::default(), StepPoolView::NotApplicable);
        }

        // --- the guards, on the pool side ---

        /// **T16 / E11.** `error_source = "queue"` — the job never ran. It emits
        /// nothing (already pinned above) and the WHOLE reservation goes back.
        ///
        /// The two are not the same statement: an ack that emits nothing has, up
        /// to here, also refunded nothing, and a reservation held against a job
        /// that never ran is never reconciled by anything else.
        #[test]
        fn t16_a_queue_errored_ack_refunds_the_whole_reservation() {
            let queued = BillingInputs {
                error_source: "queue",
                ..funded(browser(14, 2, 0, 0))
            };
            assert!(
                events_for_ack(
                    LIVE,
                    BillingInputs {
                        error_source: "queue",
                        ..funded(browser(14, 2, 0, 0))
                    },
                )
                .is_empty()
            );
            assert_eq!(
                pool_adjustment_for_ack(LIVE, &queued),
                Some(PoolMovement {
                    direction: StepPoolDirection::Refund,
                    steps: 28
                }),
                "configured 14 x 2 combos, all of it",
            );
        }

        /// A queue-errored ack must NOT go through §4.4.2's zero fallback. That
        /// path turns `steps_executed = 0` into "bill the whole definition",
        /// which here would produce a zero adjustment and quietly keep the
        /// reservation.
        #[test]
        fn a_queue_errored_ack_does_not_take_the_zero_fallback_path() {
            let queued = BillingInputs {
                error_source: "queue",
                steps_executed: 0,
                ..funded(browser(14, 1, 0, 0))
            };
            let adjustment = pool_adjustment_for_ack(LIVE, &queued);
            assert_eq!(
                adjustment,
                Some(PoolMovement {
                    direction: StepPoolDirection::Refund,
                    steps: 14
                }),
            );
        }

        /// **T17 / E13.** A private agent is the customer's own hardware: no
        /// gate, no deduct, no bill. Nothing was taken at enqueue, so nothing may
        /// be given back.
        #[test]
        fn t17_a_private_venue_never_moves_the_pool() {
            for venue in [Venue::Private, Venue::Unresolved] {
                let i = BillingInputs {
                    venue,
                    ..funded(browser(14, 1, 0, 4))
                };
                assert!(
                    events_for_ack(
                        LIVE,
                        BillingInputs {
                            venue,
                            ..funded(browser(14, 1, 0, 4))
                        }
                    )
                    .is_empty()
                );
                assert_eq!(pool_adjustment_for_ack(LIVE, &i), None, "{venue:?}");
            }
        }

        /// §9A / §9D — the master switch gates the reconcile as well as the emit.
        /// It is the runtime rollback for a mis-metering incident, and a rollback
        /// that stopped the rows but kept draining grants would be half a
        /// rollback.
        #[test]
        fn the_master_switch_off_moves_no_pool_at_all() {
            const DARK: BillingFlags = BillingFlags {
                billing_enabled: false,
                clamp_enabled: true,
            };
            let i = funded(browser(14, 1, 0, 4));
            assert!(events_for_ack(DARK, funded(browser(14, 1, 0, 4))).is_empty());
            assert_eq!(pool_adjustment_for_ack(DARK, &i), None);
        }

        /// **T14/T15 again, on the pool side.** The one way out of `ack` that
        /// skips the emit also skips the reconcile — a duplicate or evicted ack
        /// must not move the grant either (E8/E9).
        #[test]
        fn a_stale_lease_response_carries_no_pool_adjustment() {
            let resp = stale_lease_response(
                "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                "scheduled".to_string(),
                leased_row(),
            );
            assert!(resp.pool_adjustment.is_none());
        }

        // --- the idempotency key ---

        /// **T27 / §6.3's MUST.** All four fields, and each one alone changes the
        /// key. A key missing one of them would collapse two genuinely different
        /// adjustments into one and silently drop the second — permanently, under
        /// a one-time grant.
        #[test]
        fn the_idempotency_key_covers_all_four_fields() {
            let base = adjustment_key("chk_1", "us-east-1", 1_787_665_631_000_000, "job-a");
            assert_ne!(
                base,
                adjustment_key("chk_2", "us-east-1", 1_787_665_631_000_000, "job-a"),
            );
            assert_ne!(
                base,
                adjustment_key("chk_1", "eu-west-1", 1_787_665_631_000_000, "job-a"),
            );
            assert_ne!(
                base,
                adjustment_key("chk_1", "us-east-1", 1_787_665_631_000_001, "job-a"),
            );
            assert_ne!(
                base,
                adjustment_key("chk_1", "us-east-1", 1_787_665_631_000_000, "job-b"),
            );
            // …and the same tuple is the same key, which is the half that makes
            // it idempotent rather than merely unique.
            assert_eq!(
                base,
                adjustment_key("chk_1", "us-east-1", 1_787_665_631_000_000, "job-a"),
            );
        }

        /// A location name is operator-chosen. A separator it could CONTAIN
        /// would let two different tuples produce one key — and a collision here
        /// does not double-apply, it silently DROPS the second adjustment, which
        /// under a one-time grant is permanent.
        ///
        /// Both pairs below collide exactly under a printable separator (`|` and
        /// `/` respectively): the joined strings are byte-identical. They differ
        /// only because the separator is a control character no location name,
        /// check id or KSUID can contain.
        #[test]
        fn the_idempotency_key_cannot_be_forged_from_a_location_name() {
            // "x|y|1|2|j" both ways, under a `|` separator.
            assert_ne!(
                adjustment_key("x", "y|1", 2, "j"),
                adjustment_key("x", "y", 1, "2|j"),
            );
            // "x/y/1/2/j" both ways, under a `/` separator.
            assert_ne!(
                adjustment_key("x", "y/1", 2, "j"),
                adjustment_key("x", "y", 1, "2/j"),
            );
        }

        fn one_combo() -> String {
            r#"[{"execution_id":"a","engine":"chromium","device":"desktop"}]"#.to_string()
        }

        fn two_combos() -> String {
            r#"[{"execution_id":"a","engine":"chromium","device":"desktop"},
                {"execution_id":"b","engine":"webkit","device":"mobile"}]"#
                .to_string()
        }

        /// An ack as a current probe sends it.
        fn probe_ack(steps_executed: u32, steps_defined: u32) -> AckRequest {
            let mut req: AckRequest = serde_json::from_value(serde_json::json!({
                "job_id": "2MNfNTxePfZ1pnY5gKVLkwsVRXv",
                "status": "up",
                "attempts": 1,
            }))
            .unwrap();
            req.steps_executed = steps_executed;
            req.steps_defined = steps_defined;
            req
        }

        // ── SPEC §9B.1 rows 6 and 7 — the two guard counters ────────────────
        //
        // ## Why these are source assertions and not delta assertions
        //
        // Both counters are process-global `prometheus::IntCounter`s, and
        // `cargo test` runs this module on many threads. Dozens of tests above
        // call `events_for_ack` with over-ceiling and zero-step inputs, so a
        // `before`/`after` delta measures its neighbours' increments as well as
        // its own: an exact-delta test passes alone and fails in the suite,
        // which is worse than no test. A mutex here cannot help, because the
        // other callers are not holding it.
        //
        // The three mutations that matter — the counter never increments, it
        // increments on the other branch, it increments unconditionally — are
        // all edits to two lines inside `events_for_ack`, so they are pinned
        // where they live. `the_guard_counters_move_only_below_every_guard`
        // does that, and `each_guard_counter_moves_on_its_own_branch` pins
        // which branch each sits in. The runtime half is
        // `the_guard_counters_really_move`, which is monotone and so is immune
        // to the interference above.
        //
        // The needles are assembled from fragments so that this test's own
        // source does not satisfy the searches it makes — the same device
        // `every_ack_path_reports_the_usage_it_produced` uses in
        // `openobserve-api-management`.

        fn clamp_counter_needle() -> String {
            ["SYNTHETICS_STEP_CLAMP", "_TOTAL.inc()"].concat()
        }

        fn zero_fallback_counter_needle() -> String {
            ["SYNTHETICS_STEP_ZERO_FALLBACK", "_TOTAL.inc()"].concat()
        }

        /// **§9B.1 rows 6 and 7.** Each counter is incremented from inside its
        /// OWN `if`, exactly once, and nowhere else.
        ///
        /// A2 and A3 mean different things — *"a probe is over-reporting"* and
        /// *"un-upgraded probes are still in the fleet"* (§11 **F9**) — and
        /// swapping the two `.inc()` calls produces a build in which each alert
        /// fires for the other's cause, with no test, log or number
        /// disagreeing.
        #[test]
        fn each_guard_counter_moves_on_its_own_branch() {
            let source = include_str!("job_api.rs");
            let clamp = clamp_counter_needle();
            let zero_fallback = zero_fallback_counter_needle();

            assert_eq!(
                source.matches(&clamp).count(),
                1,
                "the §4.4.1 clamp counter must be incremented from exactly one place",
            );
            assert_eq!(
                source.matches(&zero_fallback).count(),
                1,
                "the §4.4.2 zero-fallback counter must be incremented from exactly one place",
            );

            // The clamp branch runs first and the zero-fallback branch second,
            // so the text between them is the clamp branch and everything after
            // is the fallback branch.
            let clamp_branch_opens = source.find("if steps.clamped {").expect("clamp branch");
            let fallback_branch_opens = source
                .find("if steps.zero_fallback {")
                .expect("zero-fallback branch");
            assert!(clamp_branch_opens < fallback_branch_opens);

            let clamp_at = source.find(&clamp).expect("clamp counter");
            let fallback_at = source.find(&zero_fallback).expect("zero-fallback counter");
            assert!(
                clamp_branch_opens < clamp_at && clamp_at < fallback_branch_opens,
                "the clamp counter is not inside `if steps.clamped`",
            );
            assert!(
                fallback_branch_opens < fallback_at,
                "the zero-fallback counter is not inside `if steps.zero_fallback`",
            );
        }

        /// **The counters sit BELOW every guard**, which is what stops them
        /// alerting on work that is not ours.
        ///
        /// Three guards return before the emit, and each one would produce a
        /// false alert if a counter were hoisted above it:
        ///
        ///   * the §9A/§9D master switch — a dark node is not a metering fleet, and A2/A3 both
        ///     describe one;
        ///   * the venue (§8.2, E13) — a private agent is the customer's own hardware, and an
        ///     `Unresolved` venue means the registry read failed FLEET-WIDE, so a counter there
        ///     pages on a database blip;
        ///   * `error_source = "queue"` (E11) — the job never ran, and it carries `steps_executed =
        ///     0`, so §4.4.2's arithmetic says "fell back" for a job no probe ever touched. A3
        ///     would then page on ordinary scheduling lag while claiming the probe rollout was
        ///     deployed backwards.
        ///
        /// The emitted-rows side of all three is already pinned by
        /// `the_master_switch_off_emits_nothing`, `t16_a_queue_error_emits_nothing` and
        /// `t17_a_private_venue_emits_nothing`; this is the same statement for
        /// the counters, which those tests cannot make.
        #[test]
        fn the_guard_counters_move_only_below_every_guard() {
            let source = include_str!("job_api.rs");
            let body = source
                .split_once("pub(crate) fn events_for_ack(")
                .expect("events_for_ack")
                .1;

            let clamp_at = body.find(&clamp_counter_needle()).expect("clamp counter");
            let fallback_at = body
                .find(&zero_fallback_counter_needle())
                .expect("zero-fallback counter");

            for (guard, what) in [
                ("if !flags.billing_enabled {", "the §9A/§9D master switch"),
                ("match i.venue {", "the §8.2 venue gate"),
                (r#"if i.error_source == "queue" {"#, "the E11 queue guard"),
            ] {
                let guard_at = body.find(guard).unwrap_or_else(|| panic!("{what} is gone"));
                assert!(
                    guard_at < clamp_at,
                    "the clamp counter was hoisted above {what}",
                );
                assert!(
                    guard_at < fallback_at,
                    "the zero-fallback counter was hoisted above {what}",
                );
            }
        }

        /// The runtime half: the two counters really are wired to the two
        /// globals the alerts query, and an ack that trips a guard really does
        /// move one.
        ///
        /// Monotone (`>=`), because the counters are shared with every other
        /// test in this binary and an exact delta would measure them too. That
        /// is enough for the two mutations this half is here to catch — a
        /// deleted `.inc()` and an `.inc()` on the wrong global — and the
        /// branch itself is pinned above.
        #[test]
        fn the_guard_counters_really_move() {
            let clamp_before = config::metrics::SYNTHETICS_STEP_CLAMP_TOTAL.get();
            // 14 configured x 1 combo x (0 retries + 1) = ceiling 14; 20 reported.
            events_for_ack(LIVE, browser(14, 1, 0, 20));
            assert!(
                config::metrics::SYNTHETICS_STEP_CLAMP_TOTAL.get() > clamp_before,
                "a clamped ack did not move zo_synthetics_step_clamp_total",
            );

            let fallback_before = config::metrics::SYNTHETICS_STEP_ZERO_FALLBACK_TOTAL.get();
            events_for_ack(LIVE, browser(14, 1, 0, 0));
            assert!(
                config::metrics::SYNTHETICS_STEP_ZERO_FALLBACK_TOTAL.get() > fallback_before,
                "a zero-reporting ack did not move zo_synthetics_step_zero_fallback_total",
            );
        }

        /// The counter answers *"did a probe over-report"*, which is A2's
        /// question, so it must NOT be conditioned on whether the clamp was
        /// enabled to do anything about it.
        ///
        /// `O2_SYNTHETICS_STEP_CLAMP_ENABLED=false` is the §9A incident switch
        /// and it bills the reported count verbatim — precisely the window in
        /// which an over-report stops being visible in the billed numbers, so
        /// losing the counter there would blind A2 exactly when it matters
        /// most. Pinned as source because the `.inc()` must sit OUTSIDE the
        /// inner `if flags.clamp_enabled`, which no delta assertion can see.
        #[test]
        fn the_clamp_counter_still_fires_while_the_clamp_is_disabled() {
            let source = include_str!("job_api.rs");
            let clamp_branch = source
                .split_once("if steps.clamped {")
                .expect("clamp branch")
                .1;
            let counter_at = clamp_branch
                .find(&clamp_counter_needle())
                .expect("clamp counter");
            let switch_at = clamp_branch
                .find("if flags.clamp_enabled {")
                .expect("the clamp switch");
            assert!(
                counter_at < switch_at,
                "the clamp counter was moved inside `if flags.clamp_enabled`, so disabling the \
                 clamp in an incident now also silences A2",
            );

            // …and the switch still does what it says.
            const UNCLAMPED: BillingFlags = BillingFlags {
                billing_enabled: true,
                clamp_enabled: false,
            };
            assert_eq!(
                billed(&events_for_ack(UNCLAMPED, browser(14, 1, 0, 20))),
                Some(20.0),
            );
        }

        fn leased_row() -> LeasedRow {
            LeasedRow {
                id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                synthetics_id: "chk_1".to_string(),
                synthetics_name: "checkout journey".to_string(),
                org_id: "acme".to_string(),
                location: "us-east-1".to_string(),
                pool: "aws-browser".to_string(),
                scheduled_ts: NOW_US,
                valid_until: NOW_US + 60_000_000,
                dispatch_attempts: 1,
                run_id: "run_1".to_string(),
                browser_devices: Some("[]".to_string()),
                steps_configured: 14,
                metadata: "{}".to_string(),
            }
        }
    }
}

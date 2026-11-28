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

//! Probe credentials span one org. Dispatcher credentials authorize one job attempt.

// Step billing. `ack` COMPUTES the usage events and RETURNS them on
// [`AckResponse`]; it never sends them — this crate has no edge to
// `usage_reporting`, so `report_usage(..)` happens in the `job_ack` handler in
// `openobserve-api-management`. NOT a `OnceCell` callback installed from
// `init()`: `init()` runs only on scheduler nodes while the ack is routed to API
// nodes, where the cell would be unset and the emit would meter nothing.
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

    /// Where the execution physically ran — the *venue* axis, orthogonal to
    /// the `cloud`/`enterprise` *deployment* axis. A Cloud org running a
    /// private agent MUST NOT bill; neither gate substitutes for the other.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Venue {
        /// An o2-operated location. We paid AWS for the compute, so we bill it.
        Public,
        /// A private agent: the customer's own hardware.
        Private,
        /// The location registry could not answer — see [`resolve_venue`].
        Unresolved,
    }

    /// The two runtime switches, read once per ack and threaded in as data so
    /// both positions of both are testable without touching the environment.
    #[derive(Debug, Clone, Copy)]
    pub(crate) struct BillingFlags {
        /// `O2_SYNTHETICS_STEP_CLAMP_ENABLED`, default **true** — disables the
        /// clamp in an incident without a deploy. False bills the probe's raw
        /// count; the `warn` still fires, because with the clamp off the
        /// over-report is invisible in the numbers themselves.
        pub clamp_enabled: bool,
    }

    /// Everything the emit needs from one ack. Built by [`inputs_from`].
    /// `steps_configured` and `combos` are **frozen** onto the job row at
    /// enqueue, so a mid-flight journey edit cannot reprice work already
    /// dispatched; `retries` is read from the **live** check. Deliberate.
    pub(crate) struct BillingInputs<'a> {
        pub org_id: &'a str,
        pub job_id: &'a str,
        pub synthetics_id: &'a str,
        pub venue: Venue,
        /// `"queue"` means the job never ran.
        pub error_source: &'a str,
        /// Probe-reported, never trusted — clamped at the frozen ceiling.
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
        /// LIVE, from the current check definition.
        pub retries: i32,
        /// The ack instant, in microseconds. One value for every row of the ack
        /// so they cannot straddle an hour boundary.
        pub now_us: i64,
        /// See the call site in [`super::ack`].
        pub region: Option<String>,
        /// A confirm job re-tests a failure; it is our cost of a correct answer, so never billed.
        pub confirm: bool,
    }

    /// What one ack bills, and which of the two guards fired.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct BillableSteps {
        pub billable: u32,
        pub defined: u32,
        pub clamped: bool,
        pub zero_fallback: bool,
        /// What the clamp compared against — carried for the log line.
        pub ceiling: u32,
    }

    /// The fields every synthetics usage row shares, resolved once per ack.
    ///
    /// `ingest_usages` buckets rows by `GroupKey`; on a collision `size` and
    /// `num_records` **sum**, `response_time` is an **average**, and every other
    /// field — **`request_body` included** — keeps the FIRST row's value. `size`
    /// is the only channel a summable quantity may travel in.
    struct RowTemplate {
        timestamp: i64,
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        event_time_hour: String,
        org_id: String,
        synthetics_id: String,
        region: Option<String>,
    }

    impl BillingInputs<'_> {
        /// A browser check is exactly one whose job row froze a
        /// `browser_devices` list — written iff `check_type == Browser`, and
        /// unlike the LIVE `check_type` it cannot change under an in-flight job.
        fn is_browser(&self) -> bool {
            self.combos.is_some()
        }

        /// Steps ONE full pass of the frozen definition executes, across every
        /// combo: `configured × combos`. Both sources already floor
        /// `steps_configured` at 1, so the floor here never fires in practice —
        /// it is so a corrupt or negative value cannot produce a ZERO ceiling,
        /// which would clamp real executed work down to nothing.
        pub(crate) fn frozen_definition(&self) -> u32 {
            let configured = u32::try_from(self.steps_configured.max(1)).unwrap_or(u32::MAX);
            configured.saturating_mul(self.combos.unwrap_or(1).max(1))
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
                synthetics_id: i.synthetics_id.to_string(),
                region: i.region.clone(),
            }
        }

        fn build(
            &self,
            event: UsageEvent,
            size: f64,
            unit: &str,
            stream_name: Option<&str>,
        ) -> UsageData {
            UsageData {
                _timestamp: self.timestamp,
                event,
                year: self.year,
                month: self.month,
                day: self.day,
                hour: self.hour,
                event_time_hour: self.event_time_hour.clone(),
                org_id: self.org_id.clone(),
                // Left EMPTY on purpose — see the type doc above.
                request_body: String::new(),
                // The one field that survives aggregation as a SUM.
                size,
                // Mirrors o2-enterprise's `MeteringEventName::unit()` for the
                // same event. Nothing bills on it, but a disagreement reads as a
                // bug to whoever finds it.
                unit: unit.to_string(),
                // A synthetic address would only shard `GroupKey`; nothing reads a per-probe split.
                user_email: String::new(),
                // MUST stay 0.0. `ingest_usages` AVERAGES this field, so it can
                // never carry a summable quantity (see the type doc).
                response_time: 0.0,
                stream_type: StreamType::Logs,
                // Sums to the acks in THIS row's `GroupKey` bucket, not the org's hour.
                num_records: 1,
                dropped_records: 0,
                stream_name: stream_name.unwrap_or_default().to_string(),
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

    /// Reads the location registry (a whole-table cache, 30 s TTL) and classifies
    /// the venue.
    ///
    /// FAILS CLOSED: only a row positively resolved as public bills, and BOTH a
    /// lookup error and a missing row yield [`Venue::Unresolved`], which emits
    /// nothing. The cache refresh is a single query, so an `Err` means the
    /// database was unreachable — a FLEET-WIDE condition, and erring towards
    /// "bill it" would over-bill every org at once. Erring this way under-reports
    /// visibly and stays reconstructable from `synthetics_jobs`.
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
    /// for a protocol check. Written iff the check is a browser check, so its
    /// PRESENCE is the frozen check-type signal — the live `check_type` could
    /// have been edited since dispatch. An unreadable or empty list still means
    /// "browser", floored to one combo: a zero fan-out is a zero ceiling, and a
    /// zero ceiling bills real work as nothing.
    pub(crate) fn frozen_combos(browser_devices: Option<&str>) -> Option<u32> {
        let raw = browser_devices?;
        let n = serde_json::from_str::<Vec<serde_json::Value>>(raw)
            .ok()
            .and_then(|v| u32::try_from(v.len()).ok())
            .unwrap_or(1);
        Some(n.max(1))
    }

    /// Gathers one ack's billing inputs from the FROZEN job row and the probe's
    /// request. The frozen/live split is a property of this wiring:
    /// `steps_configured` and `combos` can only come from `row`, `retries` only
    /// from the caller's argument, which [`super::ack`] takes from the check.
    pub(crate) fn inputs_from<'a>(
        row: &'a LeasedRow,
        req: &'a AckRequest,
        live_retries: i32,
        venue: Venue,
        now_us: i64,
        region: Option<String>,
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
            confirm: super::is_confirm_job(row),
        }
    }

    /// The clamp and the zero fallback, as pure arithmetic.
    ///
    /// `LeasedRow::steps_configured` is `i32`, so the conversion to `u32` is at
    /// the clamp site. Every operand is `u32` and every combining operation is
    /// `saturating_*`, so the ceiling lands in `1..=u32::MAX` rather than
    /// wrapping; `.max(0)` reads a negative `retries` as one attempt.
    pub(crate) fn resolve_billable(flags: BillingFlags, i: &BillingInputs<'_>) -> BillableSteps {
        let definition = i.frozen_definition();
        let attempts = u32::try_from(i.retries.max(0))
            .unwrap_or(u32::MAX)
            .saturating_add(1);
        let ceiling = definition.saturating_mul(attempts);

        // Prefer the probe's own number: it describes the journey that ACTUALLY
        // ran, so after a mid-flight edit it is the honest denominator. Falls
        // back to the frozen definition only for a probe too old to send one.
        // Never clamped — nothing bills on it.
        let defined = if i.steps_defined == 0 {
            definition
        } else {
            i.steps_defined
        };

        // Keys on the RAW reported value, not the clamped one: a 0 means "a
        // probe too old to send the field", and billing zero for real work is
        // worse than billing the definition.
        if i.steps_executed == 0 {
            let billable = if i.is_browser() {
                // Browser ⇒ the frozen definition, across every combo.
                definition
            } else {
                // Protocol ⇒ 1 (one request is one step). NOT `attempts`: a
                // probe old enough to omit `steps_executed` also defaults
                // `attempts` to 0, so that would bill a guess off a guess.
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

    /// The guards, in spec order, and then the emit. Returns the rows `job_ack`
    /// hands to `report_usage` — EMPTY whenever this ack must not be billed. A
    /// stale or duplicate ack never reaches here; [`super::stale_lease_response`]
    /// answers it, and that carries no events.
    pub(crate) fn events_for_ack(flags: BillingFlags, i: BillingInputs<'_>) -> Vec<UsageData> {
        // d. Venue.
        match i.venue {
            Venue::Public => {}
            Venue::Private | Venue::Unresolved => return Vec::new(),
        }

        // e. Clamp + zero fallback.
        let steps = resolve_billable(flags, &i);

        // Queue, control plane and config errors never ran, and confirm jobs are ours: nothing
        // billed, no zero-fallback warning.
        if i.confirm
            || i.error_source == "queue"
            || i.error_source == crate::alerting::ERROR_SOURCE_CONTROL_PLANE
            || i.error_source == crate::alerting::ERROR_SOURCE_CONFIG
        {
            return Vec::new();
        }

        // MUST log every clamp at `warn` — it means a probe bug or a definition
        // mismatch (alert A2).
        if steps.clamped {
            // Counted here, BELOW every guard, not inside `resolve_billable`: an
            // ack we do not bill cannot have over-reported anything we care about.
            //
            // OUTSIDE the `clamp_enabled` branch below, deliberately. A2 asks
            // *"is a probe over-reporting"*, not *"did we clamp"*, and the
            // incident switch that stops the clamping is exactly the window in
            // which the over-report leaves the billed numbers.
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
        // Alert A3: this firing after the probe rollout has completed means the
        // deploy order was inverted.
        if steps.zero_fallback {
            // BELOW the `error_source = "queue"` guard above, and not inside
            // `resolve_billable`: a queue-errored ack always carries
            // `steps_executed = 0`, so the arithmetic says "fell back" for a job
            // no probe ever touched and A3 would page on scheduling lag.
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

        // g. The emit.
        let row = RowTemplate::new(&i);
        let mut events = Vec::with_capacity(3);

        // Separate events because the two carry different Stripe meters and rates.
        let step_event = if i.is_browser() {
            UsageEvent::SyntheticsBrowserSteps
        } else {
            UsageEvent::SyntheticsProtocolSteps
        };
        // STEP row only: `stream_name` is in `GroupKey`, so a per-check value shards the bucket.
        events.push(row.build(
            step_event,
            f64::from(steps.billable),
            "steps",
            Some(&row.synthetics_id),
        ));

        // ALWAYS, alongside every billable ack: half of the `executed/defined`
        // ratio, and unreconstructable once the definition is edited.
        events.push(row.build(
            UsageEvent::_SyntheticsStepsDefined,
            f64::from(steps.defined),
            "steps",
            None,
        ));

        // The v2 duration hedge. Skipped at zero: browser-only, and a 0 adds
        // nothing to `SUM(size)` while adding a permanent empty bucket to every
        // protocol org's every hour.
        if i.browser_ms > 0 {
            events.push(row.build(
                UsageEvent::_SyntheticsBrowserMs,
                i.browser_ms as f64,
                "ms",
                None,
            ));
        }

        events
    }
}

/// Test-only tally of the expensive steps a call takes, keyed by org, so tests can bound cost.
#[cfg(test)]
pub(crate) mod cost {
    use std::{
        collections::HashMap,
        sync::{LazyLock, Mutex},
    };

    static HITS: LazyLock<Mutex<HashMap<(String, &'static str), usize>>> =
        LazyLock::new(Default::default);

    pub(crate) fn hit(org: &str, step: &'static str) {
        *HITS
            .lock()
            .unwrap()
            .entry((org.to_owned(), step))
            .or_default() += 1;
    }

    pub(crate) fn take(org: &str, step: &'static str) -> usize {
        HITS.lock()
            .unwrap()
            .remove(&(org.to_owned(), step))
            .unwrap_or_default()
    }
}

use std::{
    collections::{HashMap, HashSet},
    fmt,
    time::Duration,
};

use anyhow::Context;
use config::meta::{
    secret_store::{
        ConsumerType, SecretErrorCode,
        grammar::{PinPattern, has_secret_ref},
    },
    self_reporting::usage::UsageData,
    synthetics::{
        MAX_VARIABLES, Synthetic, SyntheticAuth, SyntheticType, SyntheticVariable,
        validate_http_url_quietly, with_default_scheme,
    },
    synthetics_variables::{placeholder_names, substitute_placeholders},
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    secret_store::{lease_notice::runner_lease_notice, resolver},
    table::{
        entity::{synthetics_agents as agent_entity, synthetics_jobs as job_entity},
        org_ingestion_tokens, org_secrets, secret_dependencies, secret_refs, synthetics_agents,
        synthetics_checks, synthetics_environments,
        synthetics_jobs::{self, CompletionProof, LeaseIssuer, complete_attempt},
        synthetics_locations,
        synthetics_probe_tokens::{self, token_sha256},
        synthetics_runs,
        synthetics_variables::{self as variable_table, SyntheticsVariableRecord},
    },
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zeroize::Zeroizing;

use crate::{RESULTS_STREAM, STEP_RESULTS_STREAM};

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub job_id: String,
    #[serde(default)]
    pub lease_token: Option<PresentedLease>,
}

#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct PresentedLease(String);

impl PresentedLease {
    pub fn new(token: String) -> Self {
        Self(token)
    }

    pub fn sha256(&self) -> String {
        token_sha256(self.expose())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for PresentedLease {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PresentedLease(..)")
    }
}

pub struct LeasePrincipal {
    pub org: String,
    pub job_id: String,
    pub attempt: i32,
    pub lease_sha256: String,
}

impl fmt::Debug for LeasePrincipal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LeasePrincipal")
            .field("org", &self.org)
            .field("job_id", &self.job_id)
            .field("attempt", &self.attempt)
            .finish_non_exhaustive()
    }
}

/// A probe's o2syn_ token belongs to the path org. A dispatcher lease grants one job attempt.
#[derive(Debug)]
pub enum JobCaller {
    /// `token_id` names the o2syn_ token the probe authenticated with; None only in-process.
    Probe {
        org: String,
        token_id: Option<String>,
    },
    Lease(LeasePrincipal),
}

impl JobCaller {
    pub fn org(&self) -> &str {
        match self {
            Self::Probe { org, .. } => org,
            Self::Lease(principal) => &principal.org,
        }
    }

    fn check_job_id(&self, job_id: &str) -> Result<(), AttemptError> {
        if let Self::Lease(principal) = self
            && principal.job_id != job_id
        {
            return Err(AttemptError::OtherJob);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptError {
    NotFound,
    WrongOrg,
    OtherJob,
    Superseded,
    LeaseRequired,
    KeyOutsideAttempt,
    Unavailable,
    CaptureOff,
    ProbeUpgradeRequired,
    BadRequest(String),
}

impl fmt::Display for AttemptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NotFound => "job not found",
            Self::WrongOrg => "forbidden: job does not belong to this org",
            Self::OtherJob => "lease is for another job",
            Self::Superseded => "lease_superseded",
            Self::LeaseRequired => "forbidden: lease_required",
            Self::KeyOutsideAttempt => "forbidden: artifact key is outside this attempt",
            Self::Unavailable => "job lookup failed",
            Self::CaptureOff => "capture_off_for_secret_bearing",
            Self::ProbeUpgradeRequired => SecretErrorCode::ProbeUpgradeRequired.as_str(),
            Self::BadRequest(message) => message,
        })
    }
}

impl std::error::Error for AttemptError {}

pub(crate) struct BoundAttempt {
    pub row: job_entity::Model,
    pub attempt: i32,
    pub lease_sha256: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tokenless {
    Allow,
    RefuseLeased,
}

/// Viewport dimensions delivered to the probe so it doesn't need hardcoded device tables.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = SyntheticsViewport)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// One engine+device combination with a pre-generated execution_id (from the scheduler).
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = SyntheticsBrowserDevice)]
pub struct BrowserDeviceEntry {
    pub execution_id: String,
    pub engine: String,
    pub device: String,
    pub viewport: Viewport,
}

#[derive(Deserialize)]
struct StoredBrowserDevice {
    execution_id: String,
    engine: String,
    device: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[schema(as = SyntheticsJobResolveResponse)]
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
    /// Https origins a credential-bearing request or navigation may reach; set only for a check
    /// that carries store refs, whose `follow_redirects` is then forced off.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub allowed_hosts: Vec<String>,
    /// Set when this response hands a write-only value to an agent; never on the wire.
    #[serde(skip)]
    pub agent_audit: Option<AgentResolveAudit>,
}

/// The `secret.agent_resolve` audit record: ids and slot keys, never a value or lease material.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentResolveAudit {
    pub agent_id: String,
    pub location_id: String,
    pub check_id: String,
    pub check_name: String,
    pub job_id: String,
    pub attempt: i32,
    pub secret_ids: Vec<String>,
    pub inline_slots: Vec<String>,
    /// Names of the shared `kind=secret` variables delivered with the attempt.
    pub secret_variables: Vec<String>,
}

impl AgentResolveAudit {
    pub fn target(&self) -> String {
        format!(
            "secret.agent_resolve agent={} location={} check={} ({}) job={} attempt={} secrets=[{}] inline_slots=[{}] secret_variables=[{}]",
            self.agent_id,
            self.location_id,
            self.check_name,
            self.check_id,
            self.job_id,
            self.attempt,
            self.secret_ids.join(","),
            self.inline_slots.join(","),
            self.secret_variables.join(","),
        )
    }
}

/// Ingest destination for probe result records.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[schema(as = SyntheticsIngestInfo)]
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
    #[serde(default)]
    pub lease_token: Option<PresentedLease>,
    /// Older probes omit their agent id, so only check ownership when it is present.
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
    /// excluding skipped ones. **The billed quantity.**
    ///
    /// It arrives here and nowhere else: 43% of executions are missing from
    /// `synthetics_step_results`, so a count derived from the results stream
    /// would under-bill silently. Never trusted as sent — clamped at the frozen
    /// ceiling. `#[serde(default)]` is the rollback story: a rejected ack is a
    /// discarded check result, so a 0 means "an older probe" and the fallback
    /// bills the frozen count, not zero.
    #[serde(default)]
    pub steps_executed: u32,
    /// Steps the journey DEFINES for this execution. Reported, never billed.
    /// `executed / defined` under 1.0 means the journey failed partway, over 1.0
    /// means retries fired, and this half cannot be recovered afterwards — the
    /// definition it came from may already have been edited.
    #[serde(default)]
    pub steps_defined: u32,
    /// Browser wall-clock milliseconds for this execution. The duration hedge
    /// for a possible per-second v2, which only works if the history exists
    /// BEFORE the decision. Nothing bills on it.
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

#[derive(Debug, Deserialize)]
pub struct ArtifactUrlsRequest {
    pub job_id: String,
    #[serde(default)]
    pub lease_token: Option<PresentedLease>,
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

/// The job's scheduled date keeps every artifact under one prefix across midnight.
pub(crate) fn artifact_prefix(
    org_id: &str,
    synthetics_id: &str,
    scheduled_ts_us: i64,
    run_id: &str,
    leaf: &str,
    dispatch_attempt: i32,
) -> String {
    let date = chrono::DateTime::from_timestamp_micros(scheduled_ts_us)
        .unwrap_or_else(chrono::Utc::now)
        .format("%Y/%m/%d");
    let prefix = format!("synthetics/{org_id}/{synthetics_id}/{date}/{run_id}/{leaf}/");
    if dispatch_attempt > 0 {
        format!("{prefix}d{dispatch_attempt}/")
    } else {
        prefix
    }
}

fn artifact_key(prefix: &str, retry: u32, name: &str) -> String {
    if retry == 0 {
        format!("{prefix}{name}")
    } else {
        format!("{prefix}attempt-{retry}-{name}")
    }
}

fn upload_ttl(
    deadline: Option<i64>,
    now_us: i64,
    signing_time_us: i64,
) -> Result<Duration, AttemptError> {
    let max = Duration::from_secs(30 * 60);
    let Some(deadline) = deadline else {
        return Ok(max);
    };
    let remaining = deadline.saturating_sub(now_us);
    // The storage signers encode lifetimes in whole seconds.
    if remaining < 1_000_000 {
        return Err(AttemptError::Superseded);
    }
    let budget = remaining.saturating_sub(signing_time_us).max(1_000_000);
    Ok(max.min(Duration::from_secs(budget as u64 / 1_000_000)))
}

async fn presign_upload(key: &str, deadline: Option<i64>) -> anyhow::Result<reqwest::Url> {
    let mut signing_time_us = 0;
    for _ in 0..2 {
        let start = config::utils::time::now_micros();
        let ttl = upload_ttl(deadline, start, signing_time_us)?;
        let url = infra::storage::presign_url(key, reqwest::Method::PUT, ttl).await?;
        let finish = config::utils::time::now_micros();
        // The signer can fetch credentials before starting the TTL. Its return time bounds
        // issuance.
        if ttl <= upload_ttl(deadline, finish, 0)? {
            return Ok(url);
        }
        signing_time_us = finish.saturating_sub(start);
    }
    anyhow::bail!("could not sign an upload URL within its lease")
}

fn stored_devices(row: &job_entity::Model) -> Result<Vec<StoredBrowserDevice>, AttemptError> {
    match row.browser_devices.as_deref() {
        None | Some("") => Ok(Vec::new()),
        Some(json) => serde_json::from_str(json).map_err(|e| {
            log::error!("[synthetics] browser devices job_id={}: {e}", row.id);
            AttemptError::Unavailable
        }),
    }
}

fn artifact_leaf(
    row: &job_entity::Model,
    execution_id: Option<&str>,
) -> Result<String, AttemptError> {
    let devices = stored_devices(row)?;
    if devices.is_empty() && execution_id.is_none_or(|id| id == row.id) {
        return Ok(row.id.clone());
    }
    if let Some(id) = execution_id
        && devices.iter().any(|device| device.execution_id == id)
    {
        return Ok(id.to_owned());
    }
    Err(AttemptError::BadRequest(
        "invalid execution_id for job".into(),
    ))
}

pub async fn artifact_urls(
    req: ArtifactUrlsRequest,
    caller: &JobCaller,
) -> anyhow::Result<ArtifactUrlsResponse> {
    let conn = get_orm_client_rw().await;
    let bound = bind_attempt(
        conn,
        caller,
        req.lease_token.as_ref(),
        &req.job_id,
        config::utils::time::now_micros(),
        Tokenless::RefuseLeased,
    )
    .await?;
    let check = &bound.row;
    // F08: an attempt that was handed values stays capture-off even if the check loses them.
    if stamped_delivery_marker(check).is_some()
        || secret_bearing_in(conn, &check.org_id, &check.synthetics_id).await?
    {
        return Err(AttemptError::CaptureOff.into());
    }
    let leaf = artifact_leaf(check, req.execution_id.as_deref())?;
    let prefix = artifact_prefix(
        &check.org_id,
        &check.synthetics_id,
        check.scheduled_ts,
        &check.run_id,
        &leaf,
        bound.attempt,
    );
    let is_local = config::is_local_disk_storage();
    let lease_deadline = if bound.lease_sha256.is_some() {
        Some(check.lease_expires_at.ok_or(AttemptError::Superseded)?)
    } else {
        None
    };

    let mut screenshots = Vec::with_capacity(req.screenshots.len());
    for step_id in &req.screenshots {
        let name = format!("screenshot-{step_id}.png");
        if name.contains(['/', '\\']) || name.contains("..") {
            return Err(AttemptError::BadRequest("invalid screenshot step_id".into()).into());
        }
        let key = artifact_key(&prefix, req.attempt, &name);
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
            let url = presign_upload(&key, lease_deadline)
                .await
                .context("presign screenshot")?;
            screenshots.push(ArtifactUploadRef {
                step_id: Some(step_id.clone()),
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            });
        }
    }

    let trace = if req.trace {
        let key = artifact_key(&prefix, req.attempt, "trace.zip");
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
            let url = presign_upload(&key, lease_deadline)
                .await
                .context("presign trace")?;
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
        let key = artifact_key(&prefix, req.attempt, "evidence.ndjson");
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
            let url = presign_upload(&key, lease_deadline)
                .await
                .context("presign evidence")?;
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

pub async fn authorize_upload(
    caller: &JobCaller,
    presented: Option<&PresentedLease>,
    key: &str,
) -> Result<(), AttemptError> {
    let conn = get_orm_client_rw().await;
    authorize_upload_in(
        conn,
        caller,
        presented,
        key,
        config::utils::time::now_micros(),
    )
    .await
}

pub(crate) async fn authorize_upload_in<C: ConnectionTrait>(
    conn: &C,
    caller: &JobCaller,
    presented: Option<&PresentedLease>,
    key: &str,
    now_us: i64,
) -> Result<(), AttemptError> {
    use job_entity::Column;

    let invalid_key = || AttemptError::BadRequest("invalid artifact key".into());
    let parts: Vec<_> = key.split('/').collect();
    let ["synthetics", org, sid, _, _, _, run, leaf, first, ..] = parts.as_slice() else {
        return Err(invalid_key());
    };
    if *org != caller.org()
        || first.is_empty()
        || key.contains("..")
        || key.contains("//")
        || key.contains('\\')
    {
        return Err(invalid_key());
    }

    let rows = job_entity::Entity::find()
        .filter(Column::OrgId.eq(*org))
        .filter(Column::SyntheticsId.eq(*sid))
        .filter(Column::RunId.eq(*run))
        .all(conn)
        .await
        .map_err(|e| {
            log::error!("[synthetics] artifact job lookup run_id={run}: {e}");
            AttemptError::Unavailable
        })?;
    for row in rows {
        if row.id != *leaf
            && !stored_devices(&row)?
                .iter()
                .any(|device| device.execution_id == *leaf)
        {
            continue;
        }
        let bound = bind_attempt(
            conn,
            caller,
            presented,
            &row.id,
            now_us,
            Tokenless::RefuseLeased,
        )
        .await?;
        if stamped_delivery_marker(&bound.row).is_some()
            || secret_bearing_in(conn, org, sid).await?
        {
            return Err(AttemptError::CaptureOff);
        }
        if bound.lease_sha256.is_some() {
            let prefix =
                artifact_prefix(org, sid, bound.row.scheduled_ts, run, leaf, bound.attempt);
            if !key
                .strip_prefix(&prefix)
                .is_some_and(|name| !name.is_empty() && name != "." && !name.contains('/'))
            {
                return Err(AttemptError::KeyOutsideAttempt);
            }
        }
        return Ok(());
    }
    Err(AttemptError::NotFound)
}

/// True when the check or a child it embeds holds a write-only value; such runs keep no artifacts.
pub async fn secret_bearing(org_id: &str, synthetics_id: &str) -> Result<bool, AttemptError> {
    secret_bearing_in(get_orm_client_rw().await, org_id, synthetics_id).await
}

pub(crate) async fn secret_bearing_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    synthetics_id: &str,
) -> Result<bool, AttemptError> {
    let Some(check) = cached_check(conn, org_id, synthetics_id).await? else {
        return Ok(false);
    };
    if crate::service::carries_write_only(&check) || needs_lease(&check, false) {
        return Ok(true);
    }
    for child_id in child_ids(&check) {
        if cached_check(conn, org_id, &child_id)
            .await?
            .is_some_and(|child| {
                crate::service::carries_write_only(&child) || needs_lease(&child, false)
            })
        {
            return Ok(true);
        }
    }
    async {
        let refs = secret_refs::list_for_consumer_in(
            conn,
            org_id,
            ConsumerType::SyntheticsCheck.as_str(),
            synthetics_id,
        )
        .await?;
        if !refs.is_empty() {
            return Ok(true);
        }
        has_store_secret_dependency(conn, org_id, synthetics_id).await
    }
    .await
    .map_err(|e| {
        log::error!("[synthetics] secret binding lookup {org_id}/{synthetics_id}: {e}");
        AttemptError::Unavailable
    })
}

pub fn needs_lease(snapshot: &Synthetic, has_store_secret_dependency: bool) -> bool {
    has_store_secret_dependency
        || serde_json::to_string(snapshot).map_or(true, |snapshot| {
            snapshot.contains("{{secrets.") || has_secret_ref(&snapshot)
        })
}

async fn has_store_secret_dependency<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<bool, infra::errors::Error> {
    #[cfg(test)]
    cost::hit(org, "store_dependency_read");
    let deps = secret_dependencies::list_for_consumer_in(
        conn,
        org,
        ConsumerType::SyntheticsCheck.as_str(),
        id,
    )
    .await?;
    let ids: Vec<_> = deps
        .iter()
        .filter_map(|dep| dep.dep_key.strip_prefix("vars:"))
        .collect();
    if ids.is_empty() {
        return Ok(false);
    }
    Ok(org_secrets::Entity::find()
        .filter(org_secrets::Column::OrgId.eq(org))
        .filter(org_secrets::Column::Id.is_in(ids))
        .filter(org_secrets::Column::Kind.eq("secret"))
        .one(conn)
        .await?
        .is_some())
}

async fn cached_check<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Synthetic>, AttemptError> {
    synthetics_checks::get_cached(conn, org_id, id)
        .await
        .map_err(|e| {
            log::error!("[synthetics] check lookup {org_id}/{id}: {e}");
            AttemptError::Unavailable
        })
}

fn child_ids(check: &Synthetic) -> std::collections::BTreeSet<String> {
    if check.check_type != SyntheticType::Browser {
        return Default::default();
    }
    check
        .config
        .get("steps")
        .and_then(|s| s.as_array())
        .map(|steps| {
            config::meta::synthetics_composition::subtest_refs(steps)
                .into_iter()
                .collect()
        })
        .unwrap_or_default()
}

/// Scrubs the job's write-only values, inline and resolved store values alike, from the probe's
/// error and status reason before they are stored or sent on. Another org's job is left alone.
pub async fn redact_ack_error(req: &mut AckRequest, org_id: &str) {
    let conn = get_orm_client_rw().await;
    for (field, is_reason) in [(&mut req.error, false), (&mut req.status_reason, true)] {
        let Some(text) = field.as_deref().filter(|t| !t.is_empty()) else {
            continue;
        };
        let redacted = match ack_error_redaction(conn, &req.job_id, org_id, text).await {
            Ok(None) => continue,
            Ok(Some(redacted)) => redacted,
            // Fail closed: text that may hold a value is withheld rather than passed on.
            Err(e) => {
                log::error!(
                    "[synthetics] ack error redaction job_id={}: {e}",
                    req.job_id
                );
                REDACTED.to_owned()
            }
        };
        // A withheld reason is dropped: classification then falls back to `attempts`.
        *field = (!(is_reason && redacted.contains(REDACTED))).then_some(redacted);
    }
    if !error_source_is_clean(conn, req, org_id).await {
        req.error_source.clear();
    }
}

/// `error_source` is a short code; anything else, or a code that holds a job value, is dropped.
async fn error_source_is_clean(
    conn: &sea_orm::DatabaseConnection,
    req: &AckRequest,
    org_id: &str,
) -> bool {
    let source = req.error_source.as_str();
    // Reserved codes go through the scrub too: a credential can equal one.
    if source.is_empty() {
        return true;
    }
    let code_shaped = source.len() <= MAX_ERROR_SOURCE_LEN
        && source.starts_with(|c: char| c.is_ascii_lowercase())
        && source
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if !code_shaped {
        return false;
    }
    match ack_error_redaction(conn, &req.job_id, org_id, source).await {
        Ok(None) => true,
        Ok(Some(redacted)) => redacted == source,
        Err(_) => false,
    }
}

/// None when the job's check and children hold no write-only value to scrub.
async fn ack_error_redaction(
    conn: &sea_orm::DatabaseConnection,
    job_id: &str,
    org_id: &str,
    error: &str,
) -> anyhow::Result<Option<String>> {
    let Some(job) = job_entity::Entity::find_by_id(job_id)
        .filter(job_entity::Column::OrgId.eq(org_id))
        .one(conn)
        .await?
    else {
        return Ok(None);
    };
    let secrets = match (
        stamped_delivery_marker(&job),
        attempt_secrets(conn, &job).await,
    ) {
        (None, secrets) => match secrets? {
            Some(secrets) => secrets,
            None => return Ok(None),
        },
        (Some(marker), Ok(Some(secrets))) if secrets.fingerprint == marker => secrets,
        // T02: values changed or unreadable since delivery cannot be matched, so all text goes.
        (Some(_), _) => return Ok(Some(REDACTED.to_owned())),
    };
    let mut text = crate::service::redact_run_text(error, &secrets.values);
    if let Some(redactor) = &secrets.redactor {
        text = redactor.redact(&text);
    }
    Ok(Some(text))
}

/// The marker a resolve stamps when it hands out values: their fingerprint, or `unverifiable`
/// when the check now on record no longer holds every value that was sent.
pub(crate) async fn delivery_marker(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
    mut delivered: Delivered,
) -> Option<String> {
    let bearing = delivered.bearing();
    // Every value sent must be on record: a save that drops a ref or placeholder mid-resolve
    // would otherwise leave a fingerprint that omits it.
    let mut sent = Zeroizing::new(std::mem::take(&mut *delivered.inline));
    sent.extend(delivered.legacy.iter().cloned());
    if let Some(store) = &delivered.store {
        sent.extend(store.slots.iter().cloned());
    }
    match attempt_secrets_with(conn, job, Some(delivered)).await {
        Ok(Some(secrets)) if sent.iter().all(|v| secrets.values.contains(v)) => {
            Some(secrets.fingerprint)
        }
        Ok(None) if !bearing => None,
        Ok(_) => Some(UNVERIFIABLE_DELIVERY.to_owned()),
        Err(e) => {
            log::warn!("[synthetics] delivery fingerprint job_id={}: {e}", job.id);
            Some(UNVERIFIABLE_DELIVERY.to_owned())
        }
    }
}

fn stamped_delivery_marker(job: &job_entity::Model) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(&job.metadata)
        .ok()?
        .get(DELIVERY_MARKER_KEY)?
        .as_str()
        .map(str::to_owned)
}

/// The last step before a resolve answers: the attempt must still be live under the presented
/// lease. A marker that differs from one an earlier resolve stamped becomes `unverifiable`.
async fn seal_delivery(
    conn: &sea_orm::DatabaseConnection,
    bound: &BoundAttempt,
    marker: Option<&str>,
    clock: impl Fn() -> i64,
) -> anyhow::Result<()> {
    if marker.is_none() && bound.lease_sha256.is_none() {
        return Ok(());
    }
    let expiry = stamp_live_attempt(conn, bound, marker, &clock).await?;
    // The CAS can wait on a row lock past expiry, so the lease is checked again once it is done.
    if expiry.is_some_and(|expiry| expiry <= clock()) {
        return Err(AttemptError::Superseded.into());
    }
    Ok(())
}

/// The lease expiry the attempt was live under when the marker landed.
async fn stamp_live_attempt(
    conn: &sea_orm::DatabaseConnection,
    bound: &BoundAttempt,
    marker: Option<&str>,
    clock: &impl Fn() -> i64,
) -> anyhow::Result<Option<i64>> {
    use job_entity::Column;
    for _ in 0..SEAL_ATTEMPTS {
        let now_us = clock();
        let row = job_entity::Entity::find_by_id(&bound.row.id)
            .filter(Column::OrgId.eq(&bound.row.org_id))
            .one(conn)
            .await?
            .ok_or(AttemptError::Superseded)?;
        if !attempt_still_live(&row, bound, now_us) {
            return Err(AttemptError::Superseded.into());
        }
        let expiry = bound.lease_sha256.as_ref().and(row.lease_expires_at);
        let Some(marker) = marker else {
            return Ok(expiry);
        };
        let mut update = job_entity::Entity::update_many()
            .col_expr(
                Column::Metadata,
                sea_orm::sea_query::Expr::value(merged_marker_metadata(&row.metadata, marker)),
            )
            .filter(Column::Id.eq(&row.id))
            .filter(Column::OrgId.eq(&row.org_id))
            .filter(Column::DispatchAttempts.eq(bound.attempt))
            .filter(Column::Metadata.eq(&row.metadata));
        if let Some(hash) = &bound.lease_sha256 {
            update = update
                .filter(Column::Status.eq(1))
                .filter(Column::LeaseTokenSha256.eq(hash))
                .filter(Column::LeaseExpiresAt.gt(now_us));
        }
        if update.exec(conn).await?.rows_affected == 1 {
            return Ok(expiry);
        }
    }
    Err(AttemptError::Superseded.into())
}

fn attempt_still_live(row: &job_entity::Model, bound: &BoundAttempt, now_us: i64) -> bool {
    if row.dispatch_attempts != bound.attempt {
        return false;
    }
    let Some(hash) = &bound.lease_sha256 else {
        return true;
    };
    row.status == 1
        && row.lease_expires_at.is_some_and(|expiry| expiry > now_us)
        && row
            .lease_token_sha256
            .as_deref()
            .is_some_and(|s| config::utils::str::constant_time_eq(s.as_bytes(), hash.as_bytes()))
}

fn merged_marker_metadata(metadata: &str, marker: &str) -> String {
    let mut metadata: serde_json::Value =
        serde_json::from_str(metadata).unwrap_or_else(|_| serde_json::json!({}));
    if !metadata.is_object() {
        metadata = serde_json::json!({});
    }
    let merged = match metadata
        .get(DELIVERY_MARKER_KEY)
        .and_then(serde_json::Value::as_str)
    {
        Some(prior) if prior != marker => UNVERIFIABLE_DELIVERY,
        _ => marker,
    };
    metadata[DELIVERY_MARKER_KEY] = merged.into();
    metadata.to_string()
}

/// Every value the attempt can hand the runner: inline write-only values, shared `kind=secret`
/// variables and substituted store slots. None when there is none.
async fn attempt_secrets(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
) -> anyhow::Result<Option<AttemptSecrets>> {
    attempt_secrets_with(conn, job, None).await
}

/// [`attempt_secrets`] over the values a resolve just delivered, when it has them.
async fn attempt_secrets_with(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
    delivered: Option<Delivered>,
) -> anyhow::Result<Option<AttemptSecrets>> {
    let Some(check) = cached_check(conn, &job.org_id, &job.synthetics_id).await? else {
        return Ok(None);
    };
    let mut checks = vec![check];
    for child_id in child_ids(&checks[0]) {
        if let Some(child) = cached_check(conn, &job.org_id, &child_id).await? {
            checks.push(child);
        }
    }
    let mut store_bound = false;
    for check in &checks {
        store_bound |= !secret_refs::list_for_consumer_in(
            conn,
            &job.org_id,
            ConsumerType::SyntheticsCheck.as_str(),
            &check.id,
        )
        .await?
        .is_empty();
    }
    let shared_secrets = crate::service::shared_secret_names(conn, &job.org_id).await?;
    let mut dek = None;
    let mut legacy_named = false;
    if !shared_secrets.is_empty() {
        let key = crate::service::synthetics_dek(&job.org_id).await?;
        for check in &checks {
            // Placeholders in split config values are only visible once rehydrated.
            let mut open = check.clone();
            if crate::service::has_encrypted_config(&mut open) {
                crate::service::rehydrate_config_secrets(&mut open, &key)?;
            }
            let named =
                placeholder_names(&crate::service::variables::check_placeholder_text(&open));
            legacy_named |= shared_secrets.iter().any(|name| named.contains(name));
        }
        dek = Some(key);
    }
    checks.retain(crate::service::carries_write_only);
    if checks.is_empty() && !store_bound && !legacy_named {
        return Ok(None);
    }
    let dek = match dek {
        Some(dek) => dek,
        None => crate::service::synthetics_dek(&job.org_id).await?,
    };
    let mut values = Zeroizing::new(
        checks
            .iter()
            .flat_map(|check| crate::service::stored_write_only_values(check, &dek))
            .collect::<Vec<_>>(),
    );
    let mut redactor = None;
    if store_bound || legacy_named {
        let mut delivered = match delivered {
            Some(delivered) => delivered,
            None => fresh_delivery(conn, job, store_bound).await?,
        };
        values.extend(delivered.legacy.drain(..));
        if store_bound && let Some(mut store) = delivered.store {
            values.extend(store.slots.drain(..));
            redactor = Some(store.redactor);
        }
    }
    let fingerprint = delivery_fingerprint(&dek, &values);
    Ok(Some(AttemptSecrets {
        values,
        redactor,
        fingerprint,
    }))
}

/// The legacy and store values a resolve of `job` would deliver now.
async fn fresh_delivery(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
    store_bound: bool,
) -> anyhow::Result<Delivered> {
    let prepared =
        prepare_delivery(conn, &job.org_id, &job.synthetics_id, job.env.as_deref()).await?;
    let legacy = legacy_values(&prepared.legacy_secrets, &prepared.env_inject);
    let mut store = None;
    if store_bound
        && let Some((snapshot, resolved)) = store_resolution(
            conn,
            job,
            &prepared.synthetic,
            prepared.dek.as_deref(),
            &prepared.env_inject,
            prepared.shared_rows.as_deref(),
        )
        .await?
        .map_err(|code| anyhow::anyhow!("store values unavailable for redaction: {code}"))?
    {
        let mut slots = Zeroizing::new(Vec::with_capacity(snapshot.slot_pointers.len()));
        for field in &snapshot.slot_pointers {
            let text = snapshot
                .stored
                .pointer(field)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let value = resolved
                .substitute_slot(field, text)
                .map_err(|code| anyhow::anyhow!("store slot unavailable: {code}"))?;
            slots.push(value.as_str().to_owned());
        }
        store = Some(StoreValues {
            slots,
            redactor: resolved.redactor,
        });
    }
    Ok(Delivered {
        inline: Zeroizing::default(),
        legacy,
        store,
    })
}

fn legacy_values(names: &[String], env_inject: &HashMap<String, String>) -> Zeroizing<Vec<String>> {
    Zeroizing::new(
        names
            .iter()
            .filter_map(|name| env_inject.get(name).cloned())
            .collect(),
    )
}

/// Keyed with the org DEK, so the stamped digest cannot be checked against guessed values.
fn delivery_fingerprint(dek: &[u8], values: &[String]) -> String {
    let mut sorted: Vec<&str> = values
        .iter()
        .map(String::as_str)
        .filter(|v| !v.is_empty())
        .collect();
    sorted.sort_unstable();
    sorted.dedup();
    let key = Zeroizing::new(config::utils::base64::encode_raw(dek));
    // Sized up front: a reallocation would leave a copy of the plaintext behind.
    let size = key.len() + sorted.iter().map(|v| v.len() + 22).sum::<usize>();
    let mut input = Zeroizing::new(String::with_capacity(size));
    input.push_str(&key);
    for value in sorted {
        input.push('\n');
        input.push_str(&value.len().to_string());
        input.push(':');
        input.push_str(value);
    }
    token_sha256(&input)
}

// ── Artifact download: presigned URLs for the UI ─────────────────────────────

/// How long presigned download URLs stay valid (seconds).
const PRESIGN_DOWNLOAD_EXPIRES_SECS: u64 = 180;

#[derive(Debug, Deserialize, ToSchema)]
pub struct PresignArtifactsRequest {
    /// Full object-store keys as stored in the stream records
    /// (`screenshot_key`, `trace_key`).
    pub keys: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PresignedArtifact {
    pub key: String,
    pub url: String,
}

#[derive(Debug, Serialize, ToSchema)]
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

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[schema(as = SyntheticsJobAckResponse)]
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
    /// The usage rows this ack should meter. Returned as DATA rather than
    /// emitted here — see the `billing` module doc. EMPTY on every path that
    /// must not bill: a duplicate or late ack, a private venue, an
    /// `error_source = "queue"` ack, and any build without `cloud`.
    ///
    /// `#[serde(skip)]`, and it MUST stay that way: this struct is the HTTP body
    /// of a single ack, so serializing it would ship an org's billing rows to a
    /// probe agent. Pinned by a test.
    #[serde(skip)]
    pub usage_events: Vec<UsageData>,
    /// Environments of this run that did not pass, worst first, by name.
    pub failing_environments: Vec<String>,
    /// The downtime that muted this run; server-side only, since the ack body goes to a probe.
    #[serde(skip)]
    pub suppressed_by: Option<String>,
    /// "Failing in 1 of 2 locations (aws-us-east-1)" on a firing partial or down run.
    #[serde(skip)]
    pub coverage: Option<String>,
    /// The "Monitoring gap" or "Monitoring resumed" notice this run owes, sent apart from
    /// `alert`. `None` when muted.
    #[serde(skip)]
    pub gap_notice: Option<crate::alerting::GapNotice>,
    /// The check's template override; server-side only.
    #[serde(skip)]
    pub template: Option<String>,
}

/// An ack's answer; `applied` is false when the completion matched no row (stale or duplicate).
#[derive(Debug)]
pub struct AckOutcome {
    pub response: AckResponse,
    pub applied: bool,
}

/// The notification a completed run should send, resolved against the check's
/// `alert_if_fails` / `cooldown_mins` settings and its persisted alert state.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq, utoipa::ToSchema)]
#[schema(as = SyntheticsAlertDecision)]
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

pub const REASON_CONFIG_STEPS_EXCEEDED: &str = "config_steps_exceeded";
pub const REASON_CONFIG_REFERENCE_MISSING: &str = "config_reference_missing";
/// A super-cluster parent references a child that has not replicated to this region yet.
pub const REASON_CONFIG_REFERENCE_PENDING: &str = "config_reference_pending";
pub const REASON_CONFIG_REFERENCE_INVALID: &str = "config_reference_invalid";
pub const REASON_CONFIG_VARIABLE_UNDEFINED: &str = "config_variable_undefined";
/// A shared secret row the check references exists but holds no value; retrying cannot fix it.
pub const REASON_CONFIG_SECRET_UNSET: &str = "config_secret_unset";
pub const REASON_CONFIG_VARIABLE_LIMIT: &str = "config_variable_limit";
/// A write-only value would reach an origin it was not typed for (design §6 S03).
pub const REASON_SLOT_ORIGIN_CHANGED: &str = "secret_error:slot_origin_changed";
/// Job `metadata` key holding the delivery fingerprint; stripped before the runner sees it.
const DELIVERY_MARKER_KEY: &str = "_secret_delivery";
pub(crate) const UNVERIFIABLE_DELIVERY: &str = "unverifiable";
/// A concurrent resolve of the same attempt can move the metadata between read and write.
const SEAL_ATTEMPTS: usize = 3;
const MAX_ERROR_SOURCE_LEN: usize = 32;
const REDACTED: &str = "[REDACTED]";
const TOKENLESS_STAMP_INTERVAL_US: i64 = 3_600_000_000;

/// Expansion could not produce a runnable journey; `guard_failure` means a guard of ours failed.
#[derive(Debug, Clone)]
pub struct ConfigError {
    pub status_reason: &'static str,
    pub message: String,
    pub guard_failure: bool,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.status_reason, self.message)
    }
}

impl std::error::Error for ConfigError {}

/// What the deferred child-placeholder guard needs after `env_inject` is complete.
#[derive(Debug)]
struct ComposedJourney {
    parent_steps: Vec<serde_json::Value>,
    children: HashMap<String, config::meta::synthetics_composition::ChildJourney>,
}

struct AttemptSecrets {
    values: Zeroizing<Vec<String>>,
    redactor: Option<infra::secret_store::redact::Redactor>,
    fingerprint: String,
}

/// The values one resolve handed out; its delivery marker is computed from them.
pub(crate) struct Delivered {
    /// Inline write-only values as sent; empty when rebuilt for an ACK.
    pub(crate) inline: Zeroizing<Vec<String>>,
    pub(crate) legacy: Zeroizing<Vec<String>>,
    pub(crate) store: Option<StoreValues>,
}

impl Delivered {
    fn bearing(&self) -> bool {
        !self.inline.is_empty() || !self.legacy.is_empty() || self.store.is_some()
    }
}

pub(crate) struct StoreValues {
    slots: Zeroizing<Vec<String>>,
    redactor: infra::secret_store::redact::Redactor,
}

#[cfg(test)]
impl StoreValues {
    pub(crate) fn for_tests(slots: Vec<String>) -> Self {
        let redactor =
            infra::secret_store::redact::Redactor::for_attempt(slots.iter().map(String::as_str));
        Self {
            slots: Zeroizing::new(slots),
            redactor,
        }
    }
}

/// What [`deliver_store_refs`] did to the check.
struct StoreDelivery {
    allowed_hosts: Vec<String>,
    secret_ids: Vec<String>,
    values: Option<StoreValues>,
}

struct Prepared {
    synthetic: Synthetic,
    env_inject: HashMap<String, String>,
    dek: Option<Vec<u8>>,
    composed: Option<ComposedJourney>,
    has_shared_variables: bool,
    /// One uncached read for a check with store refs: values and dependency digests both use it.
    shared_rows: Option<Vec<SyntheticsVariableRecord>>,
    /// Shared `kind=secret` variables in `env_inject`; they get the write-only delivery rules.
    legacy_secrets: Vec<String>,
    write_only_live: bool,
}

#[derive(Clone, Copy)]
enum SnapshotPurpose {
    Save,
    Resolve { write_only_live: bool },
}

// ── Service functions (called by OSS handlers) ────────────────────────────────

pub(crate) async fn bind_attempt<C: ConnectionTrait>(
    conn: &C,
    caller: &JobCaller,
    presented: Option<&PresentedLease>,
    job_id: &str,
    now_us: i64,
    tokenless: Tokenless,
) -> Result<BoundAttempt, AttemptError> {
    caller.check_job_id(job_id)?;
    // Another org's job reads as absent, so a probe cannot tell it from a missing one.
    let row = job_entity::Entity::find_by_id(job_id)
        .filter(job_entity::Column::OrgId.eq(caller.org()))
        .one(conn)
        .await
        .map_err(|e| {
            log::error!("[synthetics] lease lookup job_id={job_id}: {e}");
            AttemptError::Unavailable
        })?
        .ok_or(AttemptError::NotFound)?;
    if row.org_id != caller.org() {
        return Err(AttemptError::WrongOrg);
    }

    let lease_sha256 = match caller {
        JobCaller::Lease(principal) => Some(principal.lease_sha256.clone()),
        JobCaller::Probe { .. } => presented.map(PresentedLease::sha256),
    };
    let bound = BoundAttempt {
        attempt: row.dispatch_attempts,
        row,
        lease_sha256,
    };
    if let JobCaller::Lease(principal) = caller
        && principal.attempt != bound.attempt
    {
        return Err(AttemptError::Superseded);
    }
    let stored = bound.row.lease_token_sha256.as_deref();
    if let Some(hash) = &bound.lease_sha256 {
        if bound.row.status != 1
            || bound
                .row
                .lease_expires_at
                .is_none_or(|expiry| expiry <= now_us)
            || !stored.is_some_and(|s| {
                config::utils::str::constant_time_eq(s.as_bytes(), hash.as_bytes())
            })
        {
            return Err(AttemptError::Superseded);
        }
    } else if stored.is_some() && tokenless == Tokenless::RefuseLeased {
        return Err(AttemptError::LeaseRequired);
    }
    Ok(bound)
}

/// Authorization must precede decryption because the probe receives plaintext credentials in
/// `env_inject` over TLS.
pub async fn resolve(req: ResolveRequest, caller: &JobCaller) -> anyhow::Result<ResolveResponse> {
    resolve_at(req, caller, config::utils::time::now_micros()).await
}

pub(crate) async fn resolve_at(
    req: ResolveRequest,
    caller: &JobCaller,
    now: i64,
) -> anyhow::Result<ResolveResponse> {
    let conn = get_orm_client_rw().await;
    let started = std::time::Instant::now();

    let bound = bind_attempt(
        conn,
        caller,
        req.lease_token.as_ref(),
        &req.job_id,
        now,
        Tokenless::Allow,
    )
    .await
    .map_err(anyhow::Error::new)?;
    let check = synthetics_jobs::get_by_id(conn, &bound.row.id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or(AttemptError::NotFound)?;

    let Prepared {
        mut synthetic,
        mut env_inject,
        dek,
        composed,
        has_shared_variables,
        shared_rows,
        legacy_secrets,
        write_only_live,
    } = prepare_delivery(
        conn,
        &check.org_id,
        &check.synthetics_id,
        check.env.as_deref(),
    )
    .await?;
    // Before the store splice rewrites env_inject: the marker holds the values as delivered.
    let legacy_delivered = legacy_values(&legacy_secrets, &env_inject);
    let inline_delivered = Zeroizing::new(
        dek.as_deref()
            .map(|dek| crate::service::stored_write_only_values(&synthetic, dek))
            .unwrap_or_default(),
    );

    let auth_ref = ["_AUTH_PASSWORD", "_AUTH_TOKEN", "_AUTH_COOKIES"]
        .into_iter()
        .any(|key| {
            env_inject
                .get(key)
                .is_some_and(|value| has_secret_ref(value))
        });
    // After the splice, so a child's inline write-only value counts as well.
    let inline_slots = crate::service::write_only_slot_keys(&synthetic);
    // A shared `kind=secret` variable is delivered under the inline write-only rules.
    let inline_credentials =
        write_only_live && (!inline_slots.is_empty() || !legacy_secrets.is_empty());
    let mut lease_required = auth_ref
        || needs_lease(&synthetic, false)
        || has_store_secret_dependency(conn, &check.org_id, &check.synthetics_id).await?;
    // P1-11: once the banner period is over, an inline write-only value needs a leased runner too.
    if !lease_required && inline_credentials && bound.lease_sha256.is_none() {
        lease_required = banner_period_over(conn, now).await?;
    }
    if lease_required && bound.lease_sha256.is_none() {
        return Err(AttemptError::ProbeUpgradeRequired.into());
    }
    let agent = attempt_agent(&bound.row).await?;
    if let Some(agent) = &agent
        && (lease_required || inline_credentials)
    {
        require_rotated_agent_token(conn, agent, caller).await?;
        if bound.lease_sha256.is_none() {
            record_tokenless_resolve(conn, &agent.id, now).await;
        }
    }
    // After the lease check, and before capture or target edits leave the signed save form.
    let StoreDelivery {
        allowed_hosts,
        secret_ids,
        values: store_values,
    } = deliver_store_refs(
        conn,
        &bound.row,
        &mut synthetic,
        dek.as_deref(),
        &mut env_inject,
        shared_rows.as_deref(),
    )
    .await?;
    let delivered = Delivered {
        inline: inline_delivered,
        legacy: legacy_delivered,
        store: store_values,
    };
    let delivery_marker = delivery_marker(conn, &bound.row, delivered).await;
    let allowed_hosts = if allowed_hosts.is_empty() && inline_credentials && write_only_live {
        inline_allowed_hosts(&mut synthetic, &env_inject)
    } else {
        allowed_hosts
    };
    refuse_url_placeholders_after_banner(conn, &synthetic, has_shared_variables, now).await?;
    // After the splice, so a child's write-only step value also turns capture off (D277).
    if lease_required || inline_credentials {
        crate::service::force_capture_off(&mut synthetic);
    }
    let agent_audit = agent
        .filter(|_| lease_required || inline_credentials)
        .map(|agent| AgentResolveAudit {
            agent_id: agent.id,
            location_id: agent.location_id,
            check_id: synthetic.id.clone(),
            check_name: synthetic.name.clone(),
            job_id: bound.row.id.clone(),
            attempt: bound.attempt,
            secret_ids,
            inline_slots,
            secret_variables: legacy_secrets,
        });

    inject_journey_secrets(&synthetic, &mut env_inject);
    synthetic.target = resolved_target(
        &synthetic.check_type,
        &substitute_placeholders(&synthetic.target, &env_inject),
    )?;
    // Deferred to here: env_inject is the whole set of names the probe can substitute.
    if let Some(composed) = composed {
        let defined: HashSet<String> = env_inject.keys().cloned().collect();
        validate_child_placeholders(&composed.parent_steps, &composed.children, &defined)
            .map_err(anyhow::Error::new)?;
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

    // The probe writes this to the result row, the only marker a confirm job has there.
    let trigger_type = if is_confirm_job(&check) {
        synthetics_runs::TRIGGER_CONFIRM.to_string()
    } else {
        run_trigger_type(conn, &check.run_id).await
    };

    let mut metadata: serde_json::Value =
        serde_json::from_str(&check.metadata).unwrap_or(serde_json::json!({}));
    if let Some(fields) = metadata.as_object_mut() {
        fields.remove(DELIVERY_MARKER_KEY);
    }
    if let Some(env_id) = check.env.as_deref() {
        metadata["environment"] =
            serde_json::json!(environment_display_name(&check.org_id, env_id).await);
    }

    // Private locations run relaxed SSRF: probing the customer's own network is the point.
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

    let clock = || {
        let elapsed = i64::try_from(started.elapsed().as_micros()).unwrap_or(i64::MAX);
        now.saturating_add(elapsed)
    };
    seal_delivery(conn, &bound, delivery_marker.as_deref(), clock).await?;
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
        allowed_hosts,
        agent_audit,
    })
}

/// The check as the runner gets it before store refs: decrypted, rehydrated, children spliced in,
/// with `env_inject` built. Resolve and ack-time redaction share it.
async fn prepare_delivery(
    conn: &sea_orm::DatabaseConnection,
    org_id: &str,
    synthetics_id: &str,
    env_id: Option<&str>,
) -> anyhow::Result<Prepared> {
    #[cfg(test)]
    cost::hit(org_id, "prepare_delivery");
    // Definition only (config/secrets/type) — served from the definition cache.
    let mut synthetic = synthetics_checks::get_cached(conn, org_id, synthetics_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {}", synthetics_id))?;

    // Decrypt credentials and variables; build env_inject for the probe.
    let has_encrypted_config = crate::service::has_encrypted_config(&mut synthetic);
    let mut shared_rows = fresh_rows_for_store_refs(conn, org_id, &synthetic, None).await?;
    let has_shared_variables = match &shared_rows {
        Some(rows) => !rows.is_empty(),
        None => crate::service::org_has_shared_variables(org_id).await,
    };
    let mut env_inject = HashMap::new();
    let write_only = crate::service::carries_write_only(&synthetic);
    let dek = if write_only || needs_dek(&synthetic, has_encrypted_config, has_shared_variables) {
        Some(crate::service::synthetics_dek(org_id).await?)
    } else {
        None
    };
    // Shared secret variables also become write-only, even without a local credential slot.
    let write_only_live = if write_only || has_shared_variables || !child_ids(&synthetic).is_empty()
    {
        crate::service::write_only_live_in(
            conn,
            crate::service::store_latched(),
            crate::service::durably_latched(),
        )
        .await?
    } else {
        false
    };
    if write_only
        && write_only_live
        && let Some(dek) = dek.as_deref()
    {
        require_slot_origins(org_id, &synthetic, dek).await?;
    }

    // Before the shared tier: a `{{NAME}}` in a header only exists once its slot is restored.
    if has_encrypted_config && let Some(dek) = dek.as_deref() {
        crate::service::rehydrate_config_secrets(&mut synthetic, dek)?;
    }
    // Before the shared tier too: a child's `{{NAME}}` is invisible until its steps are spliced in.
    let composed = expand_snapshot(conn, &mut synthetic, dek.as_deref(), write_only_live).await?;
    shared_rows = fresh_rows_for_store_refs(conn, org_id, &synthetic, shared_rows).await?;
    let mut legacy_secrets = Vec::new();
    if let Some(dek) = dek.as_deref() {
        if let Some(ref auth) = synthetic.auth {
            env_inject.extend(build_env_map(auth, dek)?);
        }

        let shared = match &shared_rows {
            Some(rows) => {
                crate::service::resolve_shared_variables_from(
                    org_id,
                    env_id,
                    &synthetic,
                    dek,
                    rows.clone(),
                )
                .await?
            }
            None if has_shared_variables => {
                crate::service::resolve_shared_variables(org_id, env_id, &synthetic, dek).await?
            }
            None => Vec::new(),
        };
        env_inject.extend(merge_variable_tiers(
            shared,
            &synthetic.variables,
            dek,
            synthetics_id,
        )?);
        if has_shared_variables {
            legacy_secrets =
                delivered_legacy_secrets(conn, &synthetic, env_id, shared_rows.as_deref()).await?;
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
                        crate::service::decrypt_secret(dek, &c.value)
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
    }

    Ok(Prepared {
        synthetic,
        env_inject,
        dek,
        composed,
        has_shared_variables,
        shared_rows,
        legacy_secrets,
        write_only_live,
    })
}

/// Shared `kind=secret` variables the job delivers: named by the check, in scope for the job's
/// environment and not shadowed by a check variable.
async fn delivered_legacy_secrets(
    conn: &sea_orm::DatabaseConnection,
    synthetic: &Synthetic,
    env_id: Option<&str>,
    rows: Option<&[SyntheticsVariableRecord]>,
) -> anyhow::Result<Vec<String>> {
    let listed;
    let rows = match rows {
        Some(rows) => rows,
        None => {
            listed = variable_table::list_cached(conn, &synthetic.org_id)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            listed.as_slice()
        }
    };
    let global = synthetics_environments::global_environment_id(&synthetic.org_id);
    let named = placeholder_names(&crate::service::variables::check_placeholder_text(
        synthetic,
    ));
    let mut names: Vec<String> = rows
        .iter()
        .filter(|row| row.kind == "secret" && named.contains(&row.name))
        .filter(|row| row.env == global || env_id == Some(row.env.as_str()))
        .filter(|row| !synthetic.variables.iter().any(|v| v.name == row.name))
        .map(|row| row.name.clone())
        .collect();
    names.sort_unstable();
    names.dedup();
    Ok(names)
}

/// The org's shared variables read past the cache when the check carries a store ref; `read`
/// is kept when already taken.
async fn fresh_rows_for_store_refs(
    conn: &sea_orm::DatabaseConnection,
    org_id: &str,
    synthetic: &Synthetic,
    read: Option<Vec<SyntheticsVariableRecord>>,
) -> anyhow::Result<Option<Vec<SyntheticsVariableRecord>>> {
    if read.is_some() {
        return Ok(read);
    }
    let text = serde_json::to_string(synthetic)?;
    if !has_secret_ref(&text) {
        return Ok(None);
    }
    #[cfg(test)]
    cost::hit(org_id, "org_variables_read");
    Ok(Some(
        variable_table::list(conn, org_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?,
    ))
}

/// Swaps every bound `{{secrets.X}}` for its value through the resolver's checks 0-7, so the
/// runner never sees ref text; refusals carry only the code. Returns the runner's `allowed_hosts`.
async fn deliver_store_refs(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
    synthetic: &mut Synthetic,
    dek: Option<&[u8]>,
    env_inject: &mut HashMap<String, String>,
    shared_rows: Option<&[SyntheticsVariableRecord]>,
) -> anyhow::Result<StoreDelivery> {
    let check_id = synthetic.id.clone();
    let refused = |code: SecretErrorCode| {
        anyhow::Error::new(ConfigError {
            status_reason: secret_error_reason(code),
            message: format!("check '{check_id}': {code}"),
            guard_failure: false,
        })
    };
    let resolution = store_resolution(conn, job, synthetic, dek, env_inject, shared_rows)
        .await?
        .map_err(refused)?;
    let mut allowed = Vec::new();
    let mut secret_ids = Vec::new();
    let mut values = None;
    if let Some((snapshot, resolved)) = resolution {
        let target = with_default_scheme(&substitute_placeholders(&synthetic.target, env_inject));
        let bound = resolved.bound_policies();
        secret_ids = bound.iter().map(|row| row.id.clone()).collect();
        let pins = carried_pins(bound).map_err(refused)?;
        allowed = allowed_hosts(&pins, &target).map_err(refused)?;
        if synthetic.check_type == SyntheticType::Http
            && let Some(config) = synthetic.config.as_object_mut()
        {
            config.insert("follow_redirects".into(), false.into());
        }
        let mut slots = Zeroizing::new(Vec::with_capacity(snapshot.slot_pointers.len()));
        for field in &snapshot.slot_pointers {
            let text = snapshot
                .stored
                .pointer(field)
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| refused(SecretErrorCode::SecretUnbound))?;
            let value = resolved.substitute_slot(field, text).map_err(refused)?;
            place_slot_value(synthetic, env_inject, field, &value).map_err(refused)?;
            slots.push(value.as_str().to_owned());
        }
        values = Some(StoreValues {
            slots,
            redactor: resolved.redactor,
        });
    }
    // Ref text that reached no slot above must never travel to the runner as a literal.
    let leftover = env_inject.values().any(|v| has_secret_ref(v))
        || has_secret_ref(&synthetic.target)
        || has_secret_ref(&synthetic.config.to_string());
    if leftover {
        return Err(refused(SecretErrorCode::SecretUnbound));
    }
    Ok(StoreDelivery {
        allowed_hosts: allowed,
        secret_ids,
        values,
    })
}

/// Runs the resolver over the signed save form; the outer error is infrastructure, the inner one
/// a store refusal. None when the check carries no store ref.
async fn store_resolution(
    conn: &sea_orm::DatabaseConnection,
    job: &job_entity::Model,
    synthetic: &Synthetic,
    dek: Option<&[u8]>,
    env_inject: &HashMap<String, String>,
    shared_rows: Option<&[SyntheticsVariableRecord]>,
) -> anyhow::Result<Result<Option<(resolver::Snapshot, resolver::Resolved)>, SecretErrorCode>> {
    #[cfg(test)]
    cost::hit(&synthetic.org_id, "store_resolution");
    let form = save_form(synthetic, dek)?;
    let global = synthetics_environments::global_environment_id(&synthetic.org_id);
    let org_scoped = job.env.as_deref().is_none_or(|env| env == global);
    let attempt = resolver::SyntheticsJob {
        env_incarnation: if org_scoped {
            None
        } else {
            job.env_incarnation.clone()
        },
        leased_by_agent: job.lease_issuer.as_deref() == Some(LeaseIssuer::Agent.as_str()),
    };
    let snapshot = match crate::service::checks::resolver_snapshot(
        conn,
        &form,
        job.env.as_deref(),
        attempt,
        env_inject,
        shared_rows,
    )
    .await
    {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => return Ok(Ok(None)),
        Err(code) => return Ok(Err(code)),
    };
    Ok(resolver::resolve(conn, &snapshot)
        .await
        .map(|resolved| Some((snapshot, resolved))))
}

/// Host lists of the bound secrets with `pin_mode = hosts`; `any` and `legacy` add no constraint.
fn carried_pins(rows: &[org_secrets::Model]) -> Result<Vec<Vec<PinPattern>>, SecretErrorCode> {
    rows.iter()
        .filter(|row| row.kind == "secret" && row.pin_mode == org_secrets::PinMode::Hosts)
        .map(|row| {
            row.allowed_hosts
                .lines()
                .map(PinPattern::parse)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| SecretErrorCode::PinMismatch)
        })
        .collect()
}

/// The intersection of the carried host lists as https origins, else the target's origin; never
/// empty, since an empty list would read as "no limit" (R8-02, R9-16, R13-02).
pub(crate) fn allowed_hosts(
    pins: &[Vec<PinPattern>],
    target: &str,
) -> Result<Vec<String>, SecretErrorCode> {
    if pins.is_empty() {
        let url = reqwest::Url::parse(target).map_err(|_| SecretErrorCode::InsecureTransport)?;
        let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
            return Err(SecretErrorCode::InsecureTransport);
        };
        if url.scheme() != "https" {
            return Err(SecretErrorCode::InsecureTransport);
        }
        return Ok(vec![format!("https://{host}:{port}")]);
    }
    let inside_all = |candidate: &PinPattern| {
        pins.iter()
            .all(|list| list.iter().any(|pin| pin.covers(candidate)))
    };
    let common: Vec<&PinPattern> = pins.iter().flatten().filter(|p| inside_all(p)).collect();
    let mut origins: Vec<String> = common
        .iter()
        .filter(|p| !common.iter().any(|q| q != *p && q.covers(p)))
        .map(ToString::to_string)
        .collect();
    origins.sort();
    origins.dedup();
    if origins.is_empty() {
        return Err(SecretErrorCode::PinMismatch);
    }
    Ok(origins)
}

/// The expanded snapshot as the save signed it: inline credentials in plaintext.
fn save_form(synthetic: &Synthetic, dek: Option<&[u8]>) -> anyhow::Result<Synthetic> {
    let mut form = synthetic.clone();
    let Some(dek) = dek else {
        return Ok(form);
    };
    let open = |value: &mut String| -> anyhow::Result<()> {
        if !value.is_empty() {
            *value = crate::service::decrypt_secret(dek, value)?;
        }
        Ok(())
    };
    match &mut form.auth {
        Some(SyntheticAuth::Basic { password, .. }) => open(password)?,
        Some(SyntheticAuth::Bearer { token }) => open(token)?,
        _ => {}
    }
    for var in &mut form.variables {
        if var.value.starts_with("AESenc:") {
            open(&mut var.value)?;
        }
    }
    for cookie in &mut form.cookies {
        open(&mut cookie.value)?;
    }
    Ok(form)
}

/// Writes a substituted slot where the runner reads it; a ref cookie is forced `Secure`.
fn place_slot_value(
    synthetic: &mut Synthetic,
    env_inject: &mut HashMap<String, String>,
    field: &str,
    value: &str,
) -> Result<(), SecretErrorCode> {
    let unbound = SecretErrorCode::SecretUnbound;
    let path: Vec<_> = field.split('/').skip(1).collect();
    match path.as_slice() {
        ["auth", "password"] => {
            env_inject.insert("_AUTH_PASSWORD".into(), value.to_owned());
        }
        ["auth", "token"] => {
            env_inject.insert("_AUTH_TOKEN".into(), value.to_owned());
        }
        ["cookies", index, "value"] => {
            let index: usize = index.parse().map_err(|_| unbound)?;
            let raw = env_inject.get("_AUTH_COOKIES").ok_or(unbound)?;
            let mut cookies: Vec<serde_json::Value> =
                serde_json::from_str(raw).map_err(|_| unbound)?;
            let cookie = cookies.get_mut(index).ok_or(unbound)?;
            cookie["value"] = value.into();
            cookie["secure"] = true.into();
            let raw = serde_json::to_string(&cookies).map_err(|_| unbound)?;
            env_inject.insert("_AUTH_COOKIES".into(), raw);
        }
        ["config", ..] => {
            let slot = synthetic
                .config
                .pointer_mut(&field["/config".len()..])
                .ok_or(unbound)?;
            if !slot.is_string() {
                return Err(unbound);
            }
            *slot = value.into();
        }
        _ => return Err(SecretErrorCode::RefNotAllowedInField),
    }
    Ok(())
}

/// Run results record a store refusal as `secret_error:{code}`; one leaked string per code.
fn secret_error_reason(code: SecretErrorCode) -> &'static str {
    static REASONS: std::sync::LazyLock<std::sync::Mutex<HashMap<SecretErrorCode, &'static str>>> =
        std::sync::LazyLock::new(Default::default);
    let mut reasons = REASONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    reasons
        .entry(code)
        .or_insert_with(|| Box::leak(format!("secret_error:{}", code.as_str()).into_boxed_str()))
}

fn secret_config_error(code: SecretErrorCode, message: String) -> anyhow::Error {
    anyhow::Error::new(ConfigError {
        status_reason: secret_error_reason(code),
        message,
        guard_failure: false,
    })
}

/// The agent behind an attempt: an agent lease, or a tokenless claim by a registered agent.
async fn attempt_agent(
    job: &job_entity::Model,
) -> anyhow::Result<Option<synthetics_agents::SyntheticsAgentRecord>> {
    if job.lease_issuer.as_deref() == Some(LeaseIssuer::Dispatcher.as_str()) {
        return Ok(None);
    }
    let Some(agent_id) = job.claimed_by.as_deref() else {
        return Ok(None);
    };
    let agent = synthetics_agents::get_cached(agent_id)
        .await
        .map_err(|e| anyhow::anyhow!("agent lookup failed: {e}"))?;
    Ok(agent.filter(|agent| agent.org_id == job.org_id))
}

/// The old-runner banner period ends 7 days after the `(tokenless_recorder, _meta)` marker; it
/// has not started while the marker is missing.
async fn banner_period_over<C: ConnectionTrait>(conn: &C, now: i64) -> anyhow::Result<bool> {
    Ok(runner_lease_notice(conn)
        .await?
        .is_some_and(|notice| notice.deadline_us <= now))
}

/// Once write-only values are live, an agent registered with a token minted before the cutover
/// marker gets no write-only value (D296); nor does a probe presenting such a token for it.
async fn require_rotated_agent_token<C: ConnectionTrait>(
    conn: &C,
    agent: &synthetics_agents::SyntheticsAgentRecord,
    caller: &JobCaller,
) -> anyhow::Result<()> {
    if !crate::service::write_only_live_in(
        conn,
        crate::service::store_latched(),
        crate::service::durably_latched(),
    )
    .await?
    {
        return Ok(());
    }
    let cutover_at = synthetics_probe_tokens::agent_token_cutover_at().await?;
    let mut tokens = vec![agent.token_id.as_deref()];
    if let JobCaller::Probe {
        token_id: Some(id), ..
    } = caller
        && agent.token_id.as_deref() != Some(id.as_str())
    {
        tokens.push(Some(id.as_str()));
    }
    for token in tokens {
        let created_at = match token {
            Some(id) => synthetics_probe_tokens::created_at_by_id(&agent.org_id, id).await?,
            None => None,
        };
        if token_rotation_required(created_at, cutover_at) {
            return Err(secret_config_error(
                SecretErrorCode::AgentTokenRotationRequired,
                "This agent's token must be rotated".to_owned(),
            ));
        }
    }
    Ok(())
}

/// T07: an inline write-only value may reach only the origins of the expanded check's
/// requests, all inside the slot origins checked at prepare; redirects stay off.
fn inline_allowed_hosts(
    synthetic: &mut Synthetic,
    env_inject: &HashMap<String, String>,
) -> Vec<String> {
    let mut urls = vec![synthetic.target.clone()];
    match synthetic.check_type {
        SyntheticType::Http => {}
        SyntheticType::Browser => urls.extend(
            synthetic
                .config
                .get("steps")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter(|step| step["action"] == "navigate")
                .filter_map(|step| step["url"].as_str().map(str::to_owned)),
        ),
        _ => return Vec::new(),
    }
    let mut origins = Vec::new();
    for url in urls {
        let resolved = with_default_scheme(&substitute_placeholders(&url, env_inject));
        origins.push(config::meta::synthetics::effective_origin(&resolved));
    }
    origins.sort();
    origins.dedup();
    if synthetic.check_type == SyntheticType::Http
        && let Some(config) = synthetic.config.as_object_mut()
    {
        config.insert("follow_redirects".into(), false.into());
    }
    origins
}

pub(crate) fn token_rotation_required(
    token_created_at: Option<i64>,
    cutover_at: Option<i64>,
) -> bool {
    // No recorded or surviving token row cannot prove a token minted after the cutover.
    match token_created_at {
        Some(created_at) => synthetics_probe_tokens::is_pre_cutover(created_at, cutover_at),
        None => cutover_at.is_some(),
    }
}

/// Stamps the agent for the old-runner banner, at most hourly; a failure loses one banner entry.
async fn record_tokenless_resolve<C: ConnectionTrait>(conn: &C, agent_id: &str, now: i64) {
    use agent_entity::Column;
    let stale = Column::LastTokenlessCredentialResolveAt
        .is_null()
        .or(Column::LastTokenlessCredentialResolveAt.lt(now - TOKENLESS_STAMP_INTERVAL_US));
    let stamped = agent_entity::Entity::update_many()
        .col_expr(
            Column::LastTokenlessCredentialResolveAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(Column::Id.eq(agent_id))
        .filter(stale)
        .exec(conn)
        .await;
    if let Err(e) = stamped {
        log::warn!("[synthetics] tokenless resolve stamp agent_id={agent_id}: {e}");
    }
}

/// After the banner period, resolve refuses what save refuses: a write-only `{{NAME}}` in a URL.
async fn refuse_url_placeholders_after_banner(
    conn: &sea_orm::DatabaseConnection,
    synthetic: &Synthetic,
    has_shared_variables: bool,
    now: i64,
) -> anyhow::Result<()> {
    let shared = if has_shared_variables {
        crate::service::shared_secret_names(conn, &synthetic.org_id).await?
    } else {
        Vec::new()
    };
    let Err(code) = crate::service::refuse_write_only_url_placeholders(synthetic, &shared) else {
        return Ok(());
    };
    if !banner_period_over(conn, now).await? {
        return Ok(());
    }
    Err(secret_config_error(
        code,
        format!("check '{}': {code}", synthetic.id),
    ))
}

pub(crate) async fn expand_snapshot_for_save<C: ConnectionTrait>(
    conn: &C,
    synthetic: &mut Synthetic,
) -> anyhow::Result<()> {
    expand_snapshot_with(conn, synthetic, None, SnapshotPurpose::Save).await?;
    Ok(())
}

fn needs_dek(
    synthetic: &Synthetic,
    has_encrypted_config: bool,
    has_shared_variables: bool,
) -> bool {
    synthetic.auth.is_some()
        || !synthetic.variables.is_empty()
        || !synthetic.cookies.is_empty()
        || has_encrypted_config
        || has_shared_variables
}

/// The two variable tiers merged into what the probe receives.
fn merge_variable_tiers(
    shared: Vec<(String, String)>,
    check_variables: &[SyntheticVariable],
    dek: &[u8],
    synthetics_id: &str,
) -> anyhow::Result<HashMap<String, String>> {
    let mut merged: HashMap<String, String> = shared.into_iter().collect();
    for var in check_variables {
        let value = if var.value.starts_with("AESenc:") {
            crate::service::decrypt_secret(dek, &var.value)?
        } else {
            var.value.clone()
        };
        merged.insert(var.name.clone(), value);
    }
    // A plain error here would 500, and a 500 makes the probe retry a job that can never resolve.
    if merged.len() > MAX_VARIABLES {
        return Err(anyhow::Error::new(ConfigError {
            status_reason: REASON_CONFIG_VARIABLE_LIMIT,
            message: format!(
                "check {synthetics_id} resolves {} variables, more than the {MAX_VARIABLES} allowed",
                merged.len()
            ),
            guard_failure: false,
        }));
    }
    Ok(merged)
}

/// The target the probe gets, normalised and re-checked: a variable can still supply `file://`.
fn resolved_target(check_type: &SyntheticType, substituted: &str) -> anyhow::Result<String> {
    match check_type {
        SyntheticType::Http | SyntheticType::Browser => {
            let target = with_default_scheme(substituted);
            validate_http_url_quietly("target", &target).map_err(|e| anyhow::anyhow!(e))?;
            Ok(target)
        }
        _ => Ok(substituted.to_string()),
    }
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

// The probe fills {{NAME}} only from env_inject, so a journey with or without subtests needs its
// secrets there.
fn inject_journey_secrets(
    synthetic: &config::meta::synthetics::Synthetic,
    env_inject: &mut HashMap<String, String>,
) {
    if synthetic.check_type == SyntheticType::Browser {
        inject_browser_secrets(&synthetic.config, env_inject);
    }
}

// Browser secrets substitute {{NAME}} like variables, so their decrypted values join env_inject.
fn inject_browser_secrets(config: &serde_json::Value, env_inject: &mut HashMap<String, String>) {
    let Some(secrets) = config.get("secrets").and_then(|s| s.as_array()) else {
        return;
    };
    for secret in secrets {
        if let (Some(name), Some(value)) = (
            secret.get("name").and_then(|v| v.as_str()),
            secret.get("value").and_then(|v| v.as_str()),
        ) {
            env_inject.insert(name.to_string(), value.to_string());
        }
    }
}

fn expand_journey(
    parent_steps: &[serde_json::Value],
    children: &HashMap<String, config::meta::synthetics_composition::ChildJourney>,
    parent_updated_at: i64,
    super_cluster: bool,
) -> Result<Vec<serde_json::Value>, ConfigError> {
    use config::meta::{
        synthetics::is_composition_action,
        synthetics_composition::{ExpansionError, expand_steps},
    };
    // Keyed on the action: a `subtest` step with no id yields no ref and would reach the probe.
    let mut has_reference = false;
    for step in parent_steps {
        if !step
            .get("action")
            .and_then(|a| a.as_str())
            .is_some_and(is_composition_action)
        {
            continue;
        }
        has_reference = true;
        let names_a_child = step
            .pointer("/subtest/id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| !id.trim().is_empty());
        if !names_a_child {
            return Err(ConfigError {
                status_reason: REASON_CONFIG_REFERENCE_INVALID,
                message: format!(
                    "step '{}' is a subtest reference that names no check",
                    step.get("id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                ),
                guard_failure: true,
            });
        }
    }
    if !has_reference {
        return Ok(parent_steps.to_vec());
    }
    let expanded = expand_steps(parent_steps, children).map_err(|e| match e {
        ExpansionError::MissingChild(_)
            if super_cluster && within_replication_grace(parent_updated_at) =>
        {
            ConfigError {
                status_reason: REASON_CONFIG_REFERENCE_PENDING,
                message: e.to_string(),
                guard_failure: false,
            }
        }
        ExpansionError::MissingChild(_) => ConfigError {
            status_reason: REASON_CONFIG_REFERENCE_MISSING,
            message: e.to_string(),
            guard_failure: true,
        },
        _ => ConfigError {
            status_reason: REASON_CONFIG_REFERENCE_INVALID,
            message: e.to_string(),
            guard_failure: true,
        },
    })?;
    let max_steps = config::get_config().synthetics.browser_max_steps;
    if expanded.len() > max_steps {
        return Err(ConfigError {
            status_reason: REASON_CONFIG_STEPS_EXCEEDED,
            message: format!(
                "this test now needs {} steps after expanding its subtests; the limit is {max_steps}",
                expanded.len(),
            ),
            guard_failure: false,
        });
    }
    Ok(expanded)
}

/// Saving a child never re-validates its parents, so the parent-save guard is not enough.
fn validate_child_placeholders(
    parent_steps: &[serde_json::Value],
    children: &HashMap<String, config::meta::synthetics_composition::ChildJourney>,
    defined: &HashSet<String>,
) -> Result<(), ConfigError> {
    use config::meta::synthetics_composition::{placeholders_in, subtest_refs};
    // Keyed on the child map, not the expanded array: the message needs the child's identity, and
    // the parent's own steps are never validated here.
    for child_id in subtest_refs(parent_steps) {
        let Some(child) = children.get(&child_id) else {
            continue;
        };
        if let Some(var) =
            crate::service::composition::undefined_among(&placeholders_in(&child.steps), defined)
                .first()
        {
            return Err(ConfigError {
                status_reason: REASON_CONFIG_VARIABLE_UNDEFINED,
                message: format!(
                    "'{}' uses {{{{{var}}}}}, which this test does not define",
                    child.name
                ),
                guard_failure: false,
            });
        }
    }
    Ok(())
}

fn within_replication_grace(parent_updated_at: i64) -> bool {
    let grace_secs = config::get_config()
        .synthetics
        .subtests_replication_grace_secs;
    let grace_us = i64::try_from(grace_secs)
        .unwrap_or(i64::MAX)
        .saturating_mul(1_000_000);
    config::utils::time::now_micros().saturating_sub(parent_updated_at) < grace_us
}

/// Refuses the run before any host is contacted when a write-only slot's origins moved.
async fn require_slot_origins(org_id: &str, check: &Synthetic, dek: &[u8]) -> anyhow::Result<()> {
    let origins = crate::service::stored_check_origins(org_id, check, dek).await?;
    crate::service::slot_origins_allowed_at_resolve(
        check,
        dek,
        &origins,
        crate::origins_backfill::origins_backfill_done(),
    )
    .await
    .map_err(|code| {
        anyhow::Error::new(ConfigError {
            status_reason: REASON_SLOT_ORIGIN_CHANGED,
            message: format!(
                "check '{}': {code}; a write-only value must be typed again for its new host",
                check.id
            ),
            guard_failure: false,
        })
    })
}

async fn require_stored_child_slot_origins<C: ConnectionTrait>(
    conn: &C,
    parent: &Synthetic,
    child: &Synthetic,
    dek: &[u8],
) -> Result<(), SecretErrorCode> {
    let mut view = parent.clone();
    view.environments.clone_from(&child.environments);
    let origins = crate::service::stored_check_origins(&parent.org_id, &view, dek)
        .await
        .map_err(|_| SecretErrorCode::SlotOriginChanged)?;
    crate::service::slot_origins_allowed_at_resolve(
        child,
        dek,
        &origins,
        crate::origins_backfill::origins_backfill_done_in(conn),
    )
    .await
}

/// S03: an embedded child's write-only values go only to hosts they were typed for, judged by the
/// expanded parent's requests under the parent's variables, per child environment.
pub(crate) async fn require_child_slot_origins(
    parent: &Synthetic,
    child: &Synthetic,
    dek: &[u8],
) -> Result<(), SecretErrorCode> {
    let mut view = parent.clone();
    view.environments.clone_from(&child.environments);
    let vars = crate::service::load_origin_vars(&parent.org_id, &view, dek)
        .await
        .map_err(|_| SecretErrorCode::SlotOriginChanged)?;
    let origins = crate::service::check_origins(&view, &vars);
    crate::service::slot_origins_allowed(child, dek, &origins)
}

/// S03 at parent save: refuses an embedding whose journey would carry a child's write-only value
/// to a host the value was not typed for.
pub(crate) async fn refuse_child_host_change<C: ConnectionTrait>(
    conn: &C,
    body: &Synthetic,
) -> anyhow::Result<()> {
    let mut children = Vec::new();
    for child_id in child_ids(body) {
        if let Some(child) = synthetics_checks::get(conn, &body.org_id, &child_id).await?
            && child.check_type == SyntheticType::Browser
            && crate::service::carries_write_only(&child)
        {
            children.push(child);
        }
    }
    if children.is_empty() {
        return Ok(());
    }
    let dek = crate::service::synthetics_dek(&body.org_id).await?;
    let write_only_live = crate::service::write_only_live_in(
        conn,
        crate::service::store_latched(),
        crate::service::durably_latched(),
    )
    .await?;
    if !write_only_live {
        return Ok(());
    }
    let mut expanded = body.clone();
    expand_snapshot_for_save(conn, &mut expanded).await?;
    for child in &children {
        require_child_slot_origins(&expanded, child, &dek)
            .await
            .map_err(|_| {
                crate::service::SlotRefusal::new(
                    SecretErrorCode::SlotValueRequiredOnHostChange,
                    "subtests",
                )
            })?;
    }
    Ok(())
}

/// Splices every referenced child's stored steps, rehydrated, into the parent's config.
async fn expand_snapshot<C: sea_orm::ConnectionTrait>(
    conn: &C,
    synthetic: &mut config::meta::synthetics::Synthetic,
    parent_dek: Option<&[u8]>,
    write_only_live: bool,
) -> anyhow::Result<Option<ComposedJourney>> {
    expand_snapshot_with(
        conn,
        synthetic,
        parent_dek,
        SnapshotPurpose::Resolve { write_only_live },
    )
    .await
}

async fn expand_snapshot_with<C: ConnectionTrait>(
    conn: &C,
    synthetic: &mut Synthetic,
    parent_dek: Option<&[u8]>,
    purpose: SnapshotPurpose,
) -> anyhow::Result<Option<ComposedJourney>> {
    use config::meta::{
        synthetics::{BrowserConfig, is_composition_action},
        synthetics_composition::{ChildJourney, subtest_refs},
    };
    if synthetic.check_type != SyntheticType::Browser {
        return Ok(None);
    }
    let steps = synthetic
        .config
        .get("steps")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    // Keyed on the action so that a reference naming no child still reaches the boundary check.
    if !steps.iter().any(|s| {
        s.get("action")
            .and_then(|a| a.as_str())
            .is_some_and(is_composition_action)
    }) {
        return Ok(None);
    }
    let refs = subtest_refs(&steps);
    let mut children = HashMap::new();
    let mut write_only_children = Vec::new();
    let mut org_dek = parent_dek.map(<[u8]>::to_vec);
    for child_id in refs.iter().collect::<std::collections::HashSet<_>>() {
        let child = match purpose {
            SnapshotPurpose::Save => {
                synthetics_checks::get(conn, &synthetic.org_id, child_id).await
            }
            SnapshotPurpose::Resolve { .. } => {
                synthetics_checks::get_cached(conn, &synthetic.org_id, child_id).await
            }
        }?;
        if let Some(mut child) = child
            && child.check_type == SyntheticType::Browser
        {
            // Split step values live in `config_secrets`; without this they splice in blank (D231).
            if crate::service::has_encrypted_config(&mut child) {
                if org_dek.is_none() {
                    org_dek = Some(crate::service::synthetics_dek(&synthetic.org_id).await?);
                }
                let dek = org_dek.as_deref().unwrap_or_default();
                if let SnapshotPurpose::Resolve { .. } = purpose
                    && crate::service::carries_write_only(&child)
                {
                    write_only_children.push(child.clone());
                }
                crate::service::rehydrate_config_secrets(&mut child, dek)?;
            }
            // Not `unwrap_or_default`: a 0-step child would silently drop the reference.
            let cfg: BrowserConfig = serde_json::from_value(child.config).map_err(|e| {
                config::metrics::SYNTHETICS_COMPOSITION_GUARD_FAILURES_TOTAL.inc();
                anyhow::Error::new(ConfigError {
                    status_reason: REASON_CONFIG_REFERENCE_INVALID,
                    message: format!(
                        "referenced check '{}' has an unreadable journey: {e}",
                        child.id
                    ),
                    guard_failure: true,
                })
            })?;
            children.insert(
                child.id.clone(),
                ChildJourney {
                    id: child.id,
                    name: child.name,
                    steps: cfg.steps,
                },
            );
        }
    }
    #[cfg(feature = "enterprise")]
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    let super_cluster = false;
    let expanded =
        expand_journey(&steps, &children, synthetic.updated_at, super_cluster).map_err(|e| {
            if e.guard_failure {
                config::metrics::SYNTHETICS_COMPOSITION_GUARD_FAILURES_TOTAL.inc();
            }
            anyhow::Error::new(e)
        })?;
    synthetic.config["steps"] = serde_json::Value::Array(expanded);
    if let SnapshotPurpose::Resolve {
        write_only_live: true,
    } = purpose
    {
        let dek = org_dek.as_deref().unwrap_or_default();
        for child in &write_only_children {
            require_stored_child_slot_origins(conn, synthetic, child, dek)
                .await
                .map_err(|code| {
                    anyhow::Error::new(ConfigError {
                        status_reason: REASON_SLOT_ORIGIN_CHANGED,
                        message: format!(
                            "check '{}': {code}; embedded '{}' must have its write-only value typed again for this journey's hosts",
                            synthetic.id, child.id
                        ),
                        guard_failure: false,
                    })
                })?;
        }
    }
    Ok(Some(ComposedJourney {
        parent_steps: steps,
        children,
    }))
}

/// The 200 an ack that did not apply gets: a duplicate, or a late one from a
/// holder the reaper already evicted. Nothing here may touch run accounting a
/// second time, and nothing here may bill. `usage_events` stays empty, and that
/// is the whole of exactly-once on the billing side: this is the only way out of
/// `ack` that skips the emit, and it cannot construct a response carrying one.
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
        failing_environments: Vec::new(),
        usage_events: Vec::new(),
        suppressed_by: None,
        template: None,
        coverage: None,
        gap_notice: None,
    }
}

/// Whether a leased job is a confirm job, which re-tests another job's failure.
pub(crate) fn is_confirm_job(row: &synthetics_jobs::LeasedRow) -> bool {
    serde_json::from_str::<synthetics_jobs::JobMetadata>(&row.metadata)
        .is_ok_and(|m| m.confirm_of.is_some())
}

/// Whether a failed ack earns a confirm job: a target-side failure of a scheduled job that is not
/// itself a confirm job, on a check that confirms failures.
pub(crate) fn wants_confirm_job(
    status_db: i32,
    error_source: &str,
    status_reason: Option<&str>,
    probe_trigger_type: &str,
    run_trigger_type: &str,
    confirm_failures: bool,
    is_confirm: bool,
) -> bool {
    status_db == config::meta::synthetics::SyntheticStatus::Failed.to_db()
        && confirm_failures
        && !is_confirm
        && probe_trigger_type != "manual"
        && (run_trigger_type == synthetics_runs::TRIGGER_SCHEDULE
            || run_trigger_type == synthetics_runs::TRIGGER_GAP_RETRY)
        && error_source != crate::alerting::ERROR_SOURCE_CONFIG
        && !synthetics_runs::is_not_measured_source(error_source, status_reason)
}

/// Sends the notification for a run that finalized outside an ack; the server registers it, as
/// notification delivery lives above this crate.
pub type RunNotifier = fn(AckResponse) -> crate::alerting::BoxFuture<'static, ()>;

static RUN_NOTIFIER: std::sync::OnceLock<RunNotifier> = std::sync::OnceLock::new();

pub fn register_run_notifier(f: RunNotifier) {
    let _ = RUN_NOTIFIER.set(f);
}

/// The alert inputs of a run that held a confirm job: `(status, status_reason, error_source)`
/// from the merged vote, so neither the worst raw job nor the last ack decides the alert.
pub(crate) fn merged_alert_input(
    class: config::meta::synthetics::RunClass,
    confirmed_flaky: bool,
) -> (&'static str, Option<&'static str>, &'static str) {
    use config::meta::synthetics::RunClass as C;
    match class {
        C::Up if confirmed_flaky => ("warning", Some(crate::alerting::REASON_FLAKY), ""),
        C::Up => ("passed", None, ""),
        C::Partial | C::Down => ("failed", None, ""),
        C::NotMeasured => ("error", None, crate::alerting::ERROR_SOURCE_CONTROL_PLANE),
        C::Misconfigured => ("error", None, crate::alerting::ERROR_SOURCE_CONFIG),
        C::Unknown => ("error", None, ""),
    }
}

/// An up run with a warning and no confirm job keeps its flaky or degraded reason only on the ack,
/// so the merged vote would read it as passed and close an open incident. Any other up run, such
/// as one with a Not measured location, goes on: it can close a gap or an incident.
fn swept_run_keeps_its_warning(
    had_confirm: bool,
    run_class: config::meta::synthetics::RunClass,
    run_result: i32,
) -> bool {
    !had_confirm
        && run_class == config::meta::synthetics::RunClass::Up
        && run_result == config::meta::synthetics::SyntheticStatus::Warning.to_db()
}

/// Decides and sends the alert of a run that finalized outside an ack: a dead letter, a failed
/// dispatch or the stuck-run sweep. No ack runs the alert for it, and a Not measured run must
/// still count toward its gap notice.
pub(crate) async fn alert_for_swept_run(done: &synthetics_runs::RunFinalized) {
    if swept_run_keeps_its_warning(done.had_confirm, done.run_class, done.run_result) {
        return;
    }
    let conn = get_orm_client_rw().await;
    let Ok(Some(synthetic)) =
        synthetics_checks::get_cached(conn, &done.org_id, &done.synthetics_id).await
    else {
        return;
    };
    let (status, status_reason, error_source) =
        merged_alert_input(done.run_class, done.confirmed_flaky);
    let now_us = config::utils::time::now_micros();
    let resolved = resolve_alert(
        conn,
        RunOutcome {
            status: Some(status),
            attempts: 1,
            status_reason,
            error_source,
        },
        done,
        &synthetic,
        now_us,
    )
    .await;
    let alert = if resolved.suppressed_by.is_some() {
        AlertDecision::Silent
    } else {
        resolved.decision
    };
    if matches!(alert, AlertDecision::Silent) && resolved.gap_notice.is_none() {
        return;
    }
    let Some(notify) = RUN_NOTIFIER.get() else {
        return;
    };
    let outcomes = synthetics_jobs::run_location_outcomes(conn, &done.run_id)
        .await
        .unwrap_or_default();
    let failing_environments = environment_names(&done.org_id, &done.run_id).await;
    let synthetic_type = serde_json::to_value(&synthetic.check_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    notify(AckResponse {
        run_complete: true,
        run_status: Some(status.to_string()),
        job_count: done.job_count,
        org_id: done.org_id.clone(),
        job_id: String::new(),
        run_id: done.run_id.clone(),
        synthetics_id: done.synthetics_id.clone(),
        synthetics_name: synthetic.name,
        synthetic_type,
        target: synthetic.target,
        destinations: synthetic.destinations,
        location: String::new(),
        pool: String::new(),
        trigger_type: "scheduled".to_string(),
        alert,
        status_reason: status_reason.map(str::to_owned),
        consecutive_failures: resolved.consecutive_failures,
        failing_locations: outcomes.failing,
        passing_locations: outcomes.passing,
        usage_events: Vec::new(),
        failing_environments,
        suppressed_by: None,
        coverage: resolved.coverage,
        gap_notice: resolved.gap_notice,
        template: synthetic.template,
    })
    .await;
}

/// Sends the "Monitoring gap" notice of every gap that passed the 15-minute rule without a run
/// to send it, for example on an hourly check, and retries a gap or resumed notice whose send
/// failed. The reaper calls it on each sweep. A notice is marked only after delivery
/// (`core::synthetics::notify_gap`).
pub(crate) async fn send_due_gap_notices(now_us: i64) {
    use crate::alerting::{
        GAP_NOTICE_AFTER_US, GAP_RESUMED_GIVE_UP_US, GAP_RESUMED_RETRY_AFTER_US, GapNotice,
    };

    if RUN_NOTIFIER.get().is_none() {
        return;
    }
    let conn = get_orm_client_rw().await;
    match synthetics_checks::list_due_gap_notices(conn, now_us - GAP_NOTICE_AFTER_US).await {
        Ok(due) => {
            for (org_id, synthetics_id, since) in due {
                send_gap_notice(&org_id, &synthetics_id, GapNotice::Opened { since }).await;
            }
        }
        Err(e) => tracing::error!("[synthetics reaper] list_due_gap_notices: {e}"),
    }
    match synthetics_checks::list_due_resumed_notices(conn, now_us - GAP_RESUMED_RETRY_AFTER_US)
        .await
    {
        Ok(due) => {
            for (org_id, synthetics_id, since, until) in due {
                if now_us - until >= GAP_RESUMED_GIVE_UP_US {
                    tracing::warn!(
                        %synthetics_id,
                        "[synthetics reaper] gave up on a resumed notice"
                    );
                    if let Err(e) =
                        synthetics_checks::clear_resumed_gap(conn, &synthetics_id, since).await
                    {
                        tracing::error!("[synthetics reaper] clear_resumed_gap: {e}");
                    }
                    continue;
                }
                send_gap_notice(&org_id, &synthetics_id, GapNotice::Resumed { since, until }).await;
            }
        }
        Err(e) => tracing::error!("[synthetics reaper] list_due_resumed_notices: {e}"),
    }
}

/// Sends one gap notice outside a run, unless the check has no destination or is muted.
async fn send_gap_notice(org_id: &str, synthetics_id: &str, notice: crate::alerting::GapNotice) {
    let Some(notify) = RUN_NOTIFIER.get() else {
        return;
    };
    let conn = get_orm_client_rw().await;
    let Ok(Some(synthetic)) = synthetics_checks::get_cached(conn, org_id, synthetics_id).await
    else {
        return;
    };
    if synthetic.destinations.is_empty()
        || crate::alerting::muted_by(org_id, &synthetic.id, &synthetic.folder_id, &synthetic.tags)
            .await
            .is_some()
    {
        return;
    }
    notify(AckResponse {
        run_complete: true,
        run_status: None,
        job_count: 0,
        org_id: org_id.to_string(),
        job_id: String::new(),
        run_id: String::new(),
        synthetics_id: synthetics_id.to_string(),
        synthetics_name: synthetic.name,
        synthetic_type: String::new(),
        target: synthetic.target,
        destinations: synthetic.destinations,
        location: String::new(),
        pool: String::new(),
        trigger_type: "scheduled".to_string(),
        alert: AlertDecision::Silent,
        status_reason: None,
        consecutive_failures: 0,
        failing_locations: Vec::new(),
        passing_locations: Vec::new(),
        usage_events: Vec::new(),
        failing_environments: Vec::new(),
        suppressed_by: None,
        coverage: None,
        gap_notice: Some(notice),
        template: None,
    })
    .await;
}

/// Delay before the one extra run that fills a Not measured gap.
const GAP_RETRY_DELAY_US: i64 = 60_000_000;

/// Everything a finalized run owes: the replicated check row, and the one extra run after a Not
/// measured gap.
pub(crate) async fn after_run_finalized(done: &synthetics_runs::RunFinalized) {
    let run_id = done.run_id.as_str();
    publish_check_status(done).await;
    if !done.gap_retry {
        return;
    }
    let conn = get_orm_client_rw().await;
    let now_us = config::utils::time::now_micros();
    match synthetics_runs::add_gap_retry_run(conn, run_id, now_us, GAP_RETRY_DELAY_US).await {
        Ok(Some(new_run)) => tracing::info!(
            synthetics_id = %done.synthetics_id,
            run_id = %run_id,
            new_run_id = %new_run,
            "[synthetics] Not measured run: one extra run scheduled"
        ),
        Ok(None) => {}
        Err(e) => tracing::warn!(
            synthetics_id = %done.synthetics_id,
            run_id = %run_id,
            "[synthetics] gap retry run: {e}"
        ),
    }
}

async fn run_trigger_type<C: sea_orm::ConnectionTrait>(conn: &C, run_id: &str) -> String {
    synthetics_runs::get_run(conn, run_id)
        .await
        .ok()
        .flatten()
        .map(|r| r.trigger_type)
        .unwrap_or_else(|| "schedule".to_string())
}

/// Replicates a changed check row to the other regions; a no-op unless the row changed.
///
/// Only the region that ran the check writes the row. Logged, never returned: the run is
/// already recorded, and a stale badge in another region is fixed by the next change.
pub(crate) async fn publish_check_status(done: &synthetics_runs::RunFinalized) {
    let Some(_streaks) = done.check_update else {
        return;
    };
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::synthetics_check_last_status(
                &done.org_id,
                &done.synthetics_id,
                _streaks.last_check_status,
                _streaks.down_runs,
                _streaks.up_runs,
                _streaks.run_ts,
                _streaks.run_class,
                _streaks.run_class_at,
                _streaks.tested_at,
                _streaks.recovered_at,
                true,
            )
            .await
    {
        tracing::warn!(
            synthetics_id = %done.synthetics_id,
            "[synthetics] super-cluster last_check_status publish: {e}"
        );
    }
}

/// Acknowledges completion of a job.
///
/// Marks the job complete, increments the run counter, and returns context for
/// notifications. Returns `run_complete = true` when all jobs in the run have
/// acked.
pub async fn ack(req: AckRequest, caller: &JobCaller) -> anyhow::Result<AckResponse> {
    ack_attempt(req, caller)
        .await
        .map(|outcome| outcome.response)
}

/// Like [`ack`], and says whether the completion changed a row: settlement publishes only then.
pub async fn ack_attempt(req: AckRequest, caller: &JobCaller) -> anyhow::Result<AckOutcome> {
    caller.check_job_id(&req.job_id)?;
    let conn = get_orm_client_rw().await;

    // Fetch the leased row first for context (location, check_id, org_id).
    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or(AttemptError::NotFound)?;

    // Tenant boundary — same as resolve.
    if check.org_id != caller.org() {
        return Err(AttemptError::WrongOrg.into());
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

    // An error records where it came from, so finalization can tell "not measured" from a
    // config error.
    let result_json = (job_status == 6).then(|| {
        serde_json::json!({
            "error_source": req.error_source,
            "status_reason": req.status_reason,
        })
        .to_string()
    });

    let presented_hash;
    let proof = match caller {
        JobCaller::Lease(principal) => CompletionProof::Lease(&principal.lease_sha256),
        JobCaller::Probe { .. } => {
            presented_hash = req.lease_token.as_ref().map(PresentedLease::sha256);
            presented_hash
                .as_deref()
                .map_or(CompletionProof::Tokenless, CompletionProof::Lease)
        }
    };
    let acked = complete_attempt(
        conn,
        &req.job_id,
        job_status,
        result_json.as_deref(),
        now_us,
        req.claimed_by.as_deref(),
        proof,
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
        return Ok(AckOutcome {
            response: stale_lease_response(req.job_id, req.trigger_type, check),
            applied: false,
        });
    }

    // A failure waits for one confirm job from the same location before it counts. The confirm
    // job joins the run before this job is counted, so the run cannot complete without it.
    if status_db == config::meta::synthetics::SyntheticStatus::Failed.to_db() {
        let confirm_failures =
            synthetics_checks::get_cached(conn, &check.org_id, &check.synthetics_id)
                .await
                .ok()
                .flatten()
                .is_some_and(|c| c.confirms_failures());
        let run_trigger = run_trigger_type(conn, &check.run_id).await;
        if wants_confirm_job(
            status_db,
            &req.error_source,
            req.status_reason.as_deref(),
            &req.trigger_type,
            &run_trigger,
            confirm_failures,
            is_confirm_job(&check),
        ) {
            match synthetics_runs::add_confirm_job(conn, &req.job_id, now_us).await {
                Ok(Some(confirm_id)) => tracing::info!(
                    synthetics_id = %check.synthetics_id,
                    run_id = %check.run_id,
                    job_id = %req.job_id,
                    confirm_job_id = %confirm_id,
                    "[synthetics] failure: confirm job enqueued"
                ),
                Ok(None) => {}
                // The failure still counts without its confirm job.
                Err(e) => tracing::warn!(
                    run_id = %check.run_id,
                    job_id = %req.job_id,
                    "[synthetics] add_confirm_job: {e}"
                ),
            }
        }
    }

    // Some only for the ack that completed the run; the check row is already written by then.
    let run_completion = synthetics_runs::finalize_run(conn, &check.run_id, status_db, now_us)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let run_complete = run_completion.is_some();
    let merged = run_completion
        .as_ref()
        .filter(|d| d.had_confirm)
        .map(|d| merged_alert_input(d.run_class, d.confirmed_flaky));
    let (run_status, job_count) = match &run_completion {
        Some(done) if merged.is_some() => (merged.map(|m| m.0.to_string()), done.job_count),
        Some(done) => {
            let status =
                match config::meta::synthetics::SyntheticStatus::from_db(done.run_result) {
                    config::meta::synthetics::SyntheticStatus::Passed => "passed",
                    config::meta::synthetics::SyntheticStatus::Warning => "warning",
                    config::meta::synthetics::SyntheticStatus::Failed => "failed",
                    _ => "error",
                }
                .to_string();
            (Some(status), done.job_count)
        }
        None => (None, 1),
    };
    if let Some(done) = &run_completion {
        after_run_finalized(done).await;
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

    // Step billing. Computed here, emitted by the `job_ack` handler (see the
    // `billing` module doc). Placed after the live check is in hand because the
    // ceiling reads `retries` from it, and after the duplicate-ack early return
    // because a duplicate must bill nothing.
    #[cfg(feature = "cloud")]
    let usage_events = {
        let ent = o2_enterprise::enterprise::common::config::get_config();
        let flags = billing::BillingFlags {
            clamp_enabled: ent.cloud.synthetics_step_clamp_enabled,
        };
        let venue = billing::resolve_venue(&check.location).await;
        // The region whose node WROTE the row. Only a super cluster has one, so
        // a single-region deployment leaves it `None` rather than stamping the
        // `"default"` placeholder. It is NOT the probe's execution region — that
        // is `check.location`, and one column with two meanings makes the first
        // query joining them wrong.
        //
        // Bound locally on purpose: `lib.rs::nothing_on_the_run_path_publishes`
        // counts dotted `enabled` accesses on this config section against the
        // number of super-cluster PUBLISHES, and this is a read.
        let sc = &ent.super_cluster;
        let region = (sc.enabled && !sc.region.is_empty()).then(|| sc.region.clone());
        let inputs = billing::inputs_from(&check, &req, synthetic.retries, venue, now_us, region);
        billing::events_for_ack(flags, inputs)
    };
    // A self-hosted Enterprise build has `enterprise` and NOT `cloud`; gating on
    // `enterprise` would write usage rows onto every customer's own cluster.
    #[cfg(not(feature = "cloud"))]
    let usage_events = Vec::new();

    // Decide the notification, once per RUN. Per-job would alert once per
    // location for the same outage, and would advance the failure streak by the
    // fan-out factor rather than by one.
    let resolved = if let Some(done) = &run_completion {
        // A run that held a confirm job answers with its merged vote, so neither its worst raw
        // job nor the last ack's error source decides the alert.
        resolve_alert(
            conn,
            RunOutcome {
                status: run_status.as_deref(),
                attempts: req.attempts,
                status_reason: merged.map_or(req.status_reason.as_deref(), |m| m.1),
                error_source: merged.map_or(req.error_source.as_str(), |m| m.2),
            },
            done,
            &synthetic,
            now_us,
        )
        .await
    } else {
        AlertResolution::default()
    };
    let AlertResolution {
        decision: alert,
        consecutive_failures,
        suppressed_by,
        coverage,
        gap_notice,
    } = resolved;

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

    let failing_environments = if run_complete && !matches!(alert, AlertDecision::Silent) {
        environment_names(&check.org_id, &check.run_id).await
    } else {
        Vec::new()
    };

    Ok(AckOutcome {
        response: AckResponse {
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
            status_reason: merged.map_or(req.status_reason.clone(), |m| m.1.map(str::to_owned)),
            consecutive_failures,
            failing_locations,
            passing_locations,
            usage_events,
            failing_environments,
            suppressed_by,
            coverage,
            gap_notice,
            template: synthetic.template.clone(),
        },
        applied: true,
    })
}

pub(crate) async fn environment_display_name(org_id: &str, env_id: &str) -> String {
    let conn = get_orm_client_rw().await;
    match infra::table::synthetics_environments::get_by_id(conn, org_id, env_id).await {
        Ok(Some(env)) => env.name,
        _ => env_id.to_string(),
    }
}

/// Failing environment IDs for a run, mapped to the names a reader recognises.
async fn environment_names(org_id: &str, run_id: &str) -> Vec<String> {
    let conn = get_orm_client_rw().await;
    let ids = match synthetics_jobs::failing_environments(conn, run_id).await {
        Ok(ids) if !ids.is_empty() => ids,
        Ok(_) => return Vec::new(),
        Err(e) => {
            tracing::warn!(run_id = %run_id, "[synthetics] failing_environments: {e}");
            return Vec::new();
        }
    };
    let known = match infra::table::synthetics_environments::list(conn, org_id).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(org_id = %org_id, "[synthetics] environment lookup: {e}");
            return ids;
        }
    };
    ids.into_iter()
        .map(|id| {
            known
                .iter()
                .find(|e| e.id == id)
                .map_or(id, |e| e.name.clone())
        })
        .collect()
}

/// Writes the result row for a config error; the ack path completes the run separately.
pub async fn report_config_error_result(
    org_id: &str,
    job_id: &str,
    err: &ConfigError,
) -> anyhow::Result<()> {
    let conn = get_orm_client_ro().await;
    let job = synthetics_jobs::get_by_id(conn, job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {job_id}"))?;
    let Some(token) = org_ingestion_tokens::find_default_enabled(org_id)
        .await?
        .map(|t| t.token)
    else {
        tracing::warn!(
            org_id,
            job_id,
            "[synthetics] no enabled ingest token — config-error result not recorded"
        );
        return Ok(());
    };
    let now_us = config::utils::time::now_micros();
    let row = serde_json::json!([{
        "_timestamp": now_us,
        "job_id": job_id,
        "run_id": job.run_id,
        "execution_id": "",
        "synthetics_id": job.synthetics_id,
        "synthetics_name": job.synthetics_name,
        "org_id": org_id,
        "location": job.location,
        "scheduled_ts": job.scheduled_ts,
        "status": "error",
        "error_source": crate::alerting::ERROR_SOURCE_CONFIG,
        "status_reason": err.status_reason,
        "error": err.message,
        "response_time_ms": 0,
        "dispatch_attempt": job.dispatch_attempts
    }]);
    let api_endpoint = config::meta::synthetics::api_endpoint();
    crate::scheduler::post_json(
        &reqwest::Client::new(),
        &format!("{api_endpoint}/api/{org_id}/synthetics_results/_json"),
        &token,
        &row,
        &job.synthetics_id,
    )
    .await;
    Ok(())
}

/// The trigger type that `resolve` would have sent for this job, so a config-error ack matches it.
pub async fn job_trigger_type(job_id: &str) -> String {
    let conn = get_orm_client_ro().await;
    match synthetics_jobs::get_by_id(conn, job_id).await {
        Ok(Some(job)) => run_trigger_type(conn, &job.run_id).await,
        _ => "schedule".to_string(),
    }
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

/// What `resolve_alert` decided for one finalized run.
#[derive(Debug, Default)]
struct AlertResolution {
    decision: AlertDecision,
    consecutive_failures: i32,
    suppressed_by: Option<String>,
    /// Set only when `decision` is `Firing` on a partial or down run.
    coverage: Option<String>,
    /// `None` when muted.
    gap_notice: Option<crate::alerting::GapNotice>,
}

/// The gap follows the stored class where there is one: a run is Not measured only when no
/// location tested the site. A Misconfigured run did not test it either, so it neither grows nor
/// closes the gap: "Monitoring resumed" needs a run that tested the site.
fn gap_step(
    next: infra::table::synthetics_checks::AlertState,
    run_class: config::meta::synthetics::RunClass,
    not_measured: bool,
    now_us: i64,
) -> (
    Option<crate::alerting::GapNotice>,
    infra::table::synthetics_checks::AlertState,
) {
    if run_class == config::meta::synthetics::RunClass::Misconfigured {
        return (None, next);
    }
    crate::alerting::decide_gap(next, not_measured, now_us)
}

async fn resolve_alert<C: sea_orm::ConnectionTrait>(
    conn: &C,
    outcome: RunOutcome<'_>,
    done: &synthetics_runs::RunFinalized,
    check: &config::meta::synthetics::Synthetic,
    now_us: i64,
) -> AlertResolution {
    let synthetics_id = done.synthetics_id.as_str();
    // See `alerting::classify`. Four outcomes, not two: an outage accumulates and
    // drives the streak, a degradation does not (a certificate is not "more
    // expired" on the twentieth check), and `error` is an outage rather than a
    // reason for silence. The stored run class then corrects what one ack cannot
    // know, and applies the check's "any location" rule.
    let class = crate::alerting::class_for_run(
        done.run_class,
        check.alerts_on_partial(),
        crate::alerting::classify(
            outcome.status,
            outcome.attempts,
            outcome.error_source,
            outcome.status_reason,
        ),
    );

    let prior = match infra::table::synthetics_checks::get_alert_state(conn, synthetics_id).await {
        Ok(Some(state)) => state,
        Ok(None) => return AlertResolution::default(), // deleted mid-run
        Err(e) => {
            tracing::warn!(%synthetics_id, "[synthetics] get_alert_state: {e}");
            return AlertResolution::default();
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
        return AlertResolution::default();
    }

    let (outcome, next) = crate::alerting::decide(
        prior,
        class,
        check.alert_if_fails,
        check.cooldown_mins,
        now_us,
    );
    let (gap_notice, next) = gap_step(
        next,
        done.run_class,
        class == crate::alerting::RunClass::NotMeasured,
        now_us,
    );
    let suppressed_by = if outcome == crate::alerting::AlertOutcome::Silent && gap_notice.is_none()
    {
        None
    } else {
        crate::alerting::muted_by(&check.org_id, &check.id, &check.folder_id, &check.tags).await
    };
    let next = if suppressed_by.is_some() {
        crate::alerting::suppressed_state(prior, next)
    } else {
        next
    };

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
                return AlertResolution {
                    consecutive_failures: next.consecutive_failures,
                    ..Default::default()
                };
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
    let coverage = (decision == AlertDecision::Firing)
        .then(|| {
            crate::alerting::coverage_line(done.run_class, &done.failed_locations, done.voters)
        })
        .flatten();
    AlertResolution {
        decision,
        consecutive_failures: next.consecutive_failures,
        gap_notice: gap_notice.filter(|_| suppressed_by.is_none()),
        suppressed_by,
        coverage,
    }
}

#[cfg(test)]
mod tests {
    mod attempt_binding {
        use infra::table::entity::synthetics_jobs::{ActiveModel, Entity};
        use sea_orm::{
            ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection,
            Schema, Set,
        };

        use super::*;

        const NOW: i64 = 200;
        const BROWSER_DEVICES: &str =
            r#"[{"execution_id":"E","engine":"chromium","device":"desktop"}]"#;

        #[test]
        fn attempt_authorization_never_reads_a_replica() {
            let source = include_str!("job_api.rs");
            for signature in [
                "\npub async fn artifact_urls(",
                "\npub async fn resolve(",
                "\npub(crate) async fn bind_attempt<",
                "\npub async fn authorize_upload(",
            ] {
                let (_, function) = source.split_once(signature).expect(signature);
                let (body, _) = function.split_once("\n}").expect(signature);
                assert!(!body.contains("get_orm_client_ro"), "{signature}");
            }
        }

        async fn jobs_db() -> DatabaseConnection {
            let mut options = ConnectOptions::new("sqlite::memory:");
            options.max_connections(1);
            let db = Database::connect(options).await.unwrap();
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            for table in [
                schema.create_table_from_entity(Entity),
                schema.create_table_from_entity(infra::table::entity::synthetics_checks::Entity),
                schema.create_table_from_entity(infra::table::entity::secret_refs::Entity),
                schema.create_table_from_entity(infra::table::entity::secret_dependencies::Entity),
            ] {
                db.execute(backend.build(&table)).await.unwrap();
            }
            db
        }

        async fn insert_job(db: &DatabaseConnection, hash: Option<String>) -> ActiveModel {
            ActiveModel {
                id: Set("job".into()),
                synthetics_id: Set("check".into()),
                synthetics_name: Set("check".into()),
                org_id: Set("org".into()),
                location: Set("test".into()),
                pool: Set("pool".into()),
                scheduled_ts: Set(NOW - 1),
                valid_until: Set(NOW + 100),
                status: Set(1),
                lease_expires_at: Set(Some(NOW + 1)),
                dispatch_attempts: Set(2),
                run_id: Set("run".into()),
                steps_configured: Set(1),
                metadata: Set("{}".into()),
                lease_token_sha256: Set(hash),
                ..Default::default()
            }
            .insert(db)
            .await
            .unwrap()
            .into()
        }

        fn principal(token: &PresentedLease) -> LeasePrincipal {
            LeasePrincipal {
                org: "org".into(),
                job_id: "job".into(),
                attempt: 2,
                lease_sha256: token.sha256(),
            }
        }

        #[test]
        fn upload_expiration_accounts_for_time_spent_signing() {
            let end = Some(5_000_000);
            let first = upload_ttl(end, 0, 0).unwrap();
            assert_eq!(first, Duration::from_secs(5));
            assert!(first > upload_ttl(end, 2_000_000, 0).unwrap());
            let retry = upload_ttl(end, 2_000_000, 2_000_000).unwrap();
            assert_eq!(retry, upload_ttl(end, 4_000_000, 0).unwrap());
            assert_eq!(upload_ttl(end, 4_000_001, 0), Err(AttemptError::Superseded));
            assert_eq!(upload_ttl(end, 5_000_000, 0), Err(AttemptError::Superseded));
            for deadline in [None, Some(3_600_000_000)] {
                assert_eq!(
                    upload_ttl(deadline, 0, 0).unwrap(),
                    Duration::from_secs(1_800)
                );
            }
        }

        #[test]
        fn artifacts_share_the_jobs_scheduled_date_across_midnight() {
            let scheduled = 1_704_067_199_999_999;
            let key = |name| {
                let prefix = artifact_prefix("org", "check", scheduled, "run", "job", 0);
                artifact_key(&prefix, 0, name)
            };
            let prefix = "synthetics/org/check/2023/12/31/run/job/";
            assert_eq!(key("before.png"), format!("{prefix}before.png"));
            assert_eq!(key("after.png"), format!("{prefix}after.png"));
        }

        #[tokio::test]
        async fn artifact_leaves_belong_to_the_job_and_retries_keep_their_names() {
            let db = jobs_db().await;
            let mut job = insert_job(&db, None).await;
            job.browser_devices = Set(Some(BROWSER_DEVICES.into()));
            let mut row = job.update(&db).await.unwrap();
            let leaf = artifact_leaf(&row, Some("E")).unwrap();
            let prefix = artifact_prefix(
                &row.org_id,
                &row.synthetics_id,
                row.scheduled_ts,
                &row.run_id,
                &leaf,
                row.dispatch_attempts,
            );
            assert_eq!(prefix, "synthetics/org/check/1970/01/01/run/E/d2/");
            assert_eq!(
                artifact_key(&prefix, 3, "trace.zip"),
                format!("{prefix}attempt-3-trace.zip")
            );
            for execution in [None, Some("J")] {
                assert!(matches!(
                    artifact_leaf(&row, execution),
                    Err(AttemptError::BadRequest(_))
                ));
            }
            for devices in [None, Some("[]".to_owned())] {
                row.browser_devices = devices;
                assert_eq!(artifact_leaf(&row, None).unwrap(), "job");
                assert_eq!(artifact_leaf(&row, Some("job")).unwrap(), "job");
                assert!(matches!(
                    artifact_leaf(&row, Some("E")),
                    Err(AttemptError::BadRequest(_))
                ));
            }
        }

        #[tokio::test]
        async fn completion_matches_only_the_live_dispatcher_attempt_once() {
            let db = jobs_db().await;
            let previous = token_sha256("previous");
            let current = token_sha256("current");
            let mut job = insert_job(&db, Some(current.clone())).await;
            job.claimed_by = Set(Some("dispatcher-node".into()));
            job.lease_issuer = Set(Some("dispatcher".into()));
            job.update(&db).await.unwrap();

            let complete =
                |now, owner, proof| complete_attempt(&db, "job", 3, Some("{}"), now, owner, proof);
            let owner = Some("dispatcher-node");
            for (now, claimed_by, proof) in [
                (NOW, owner, CompletionProof::Lease(&previous)),
                (NOW, owner, CompletionProof::Tokenless),
                (NOW + 1, owner, CompletionProof::Lease(&current)),
                (NOW, Some("other-node"), CompletionProof::Lease(&current)),
            ] {
                assert_eq!(complete(now, claimed_by, proof).await.unwrap(), None);
            }
            assert_eq!(
                complete(NOW, owner, CompletionProof::Lease(&current))
                    .await
                    .unwrap()
                    .as_deref(),
                Some("run")
            );
            assert_eq!(
                complete(NOW, owner, CompletionProof::Lease(&current))
                    .await
                    .unwrap(),
                None
            );
            let row = Entity::find_by_id("job").one(&db).await.unwrap().unwrap();
            assert_eq!(row.status, 3);
            assert_eq!(row.result.as_deref(), Some("{}"));
            assert_eq!(row.completed_at, Some(NOW));
            assert_eq!(row.lease_token_sha256, Some(current));
        }

        #[tokio::test]
        async fn tokenless_completion_accepts_a_legacy_claim() {
            let db = jobs_db().await;
            insert_job(&db, None).await;
            let run = complete_attempt(&db, "job", 4, None, NOW, None, CompletionProof::Tokenless)
                .await
                .unwrap();
            assert_eq!(run.as_deref(), Some("run"));
        }

        /// F08: removing a check's credential mid-lease does not reopen uploads for an attempt
        /// that was handed values.
        #[tokio::test]
        async fn a_credentialed_attempt_stays_capture_off_after_an_edit() {
            let db = jobs_db().await;
            let token = PresentedLease::new("current".into());
            let mut job = insert_job(&db, Some(token.sha256())).await;
            job.metadata = Set(serde_json::json!({ DELIVERY_MARKER_KEY: "f" }).to_string());
            job.update(&db).await.unwrap();
            let lease = JobCaller::Lease(principal(&token));
            let key = "synthetics/org/check/1970/01/01/run/job/file";
            assert_eq!(
                authorize_upload_in(&db, &lease, None, key, NOW).await,
                Err(AttemptError::CaptureOff)
            );
        }

        fn superseded(result: anyhow::Result<()>) -> bool {
            result
                .unwrap_err()
                .downcast_ref::<AttemptError>()
                .is_some_and(|e| *e == AttemptError::Superseded)
        }

        async fn marker_of(db: &DatabaseConnection) -> Option<String> {
            let row = Entity::find_by_id("job").one(db).await.unwrap().unwrap();
            stamped_delivery_marker(&row)
        }

        /// N04: a lease that expired or moved on while the resolve worked releases nothing.
        #[tokio::test]
        async fn a_resolve_seals_only_an_attempt_still_live_under_its_lease() {
            let db = jobs_db().await;
            let token = PresentedLease::new("current".into());
            let mut job = insert_job(&db, Some(token.sha256())).await;
            let lease = JobCaller::Lease(principal(&token));
            let bound = bind_attempt(&db, &lease, None, "job", NOW, Tokenless::Allow)
                .await
                .unwrap();
            assert!(superseded(
                seal_delivery(&db, &bound, Some("f"), || NOW + 1).await
            ));
            assert!(superseded(
                seal_delivery(&db, &bound, None, || NOW + 1).await
            ));
            assert_eq!(marker_of(&db).await, None);

            seal_delivery(&db, &bound, Some("f"), || NOW).await.unwrap();
            assert_eq!(marker_of(&db).await.as_deref(), Some("f"));

            job.dispatch_attempts = Set(3);
            job.update(&db).await.unwrap();
            assert!(superseded(
                seal_delivery(&db, &bound, Some("f"), || NOW).await
            ));
            assert!(superseded(seal_delivery(&db, &bound, None, || NOW).await));
        }

        /// N04: a lease that expires while the marker write waits releases nothing.
        #[tokio::test]
        async fn a_lease_that_expires_during_the_seal_releases_nothing() {
            use std::sync::atomic::{AtomicI64, Ordering};

            let db = jobs_db().await;
            let token = PresentedLease::new("current".into());
            insert_job(&db, Some(token.sha256())).await;
            let lease = JobCaller::Lease(principal(&token));
            let bound = bind_attempt(&db, &lease, None, "job", NOW, Tokenless::Allow)
                .await
                .unwrap();
            for marker in [Some("f"), None] {
                let ticks = AtomicI64::new(NOW);
                let clock = || ticks.fetch_add(1, Ordering::Relaxed);
                assert!(superseded(seal_delivery(&db, &bound, marker, clock).await));
            }
        }

        /// T02: a second resolve of one attempt that sent other values cannot narrow the marker.
        #[tokio::test]
        async fn a_second_resolve_with_other_values_marks_the_attempt_unverifiable() {
            let db = jobs_db().await;
            let token = PresentedLease::new("current".into());
            insert_job(&db, Some(token.sha256())).await;
            let lease = JobCaller::Lease(principal(&token));
            let bound = bind_attempt(&db, &lease, None, "job", NOW, Tokenless::Allow)
                .await
                .unwrap();
            for (marker, stamped) in [("a", "a"), ("a", "a"), ("b", UNVERIFIABLE_DELIVERY)] {
                seal_delivery(&db, &bound, Some(marker), || NOW)
                    .await
                    .unwrap();
                assert_eq!(marker_of(&db).await.as_deref(), Some(stamped));
            }
            seal_delivery(&db, &bound, Some("a"), || NOW).await.unwrap();
            assert_eq!(marker_of(&db).await.as_deref(), Some(UNVERIFIABLE_DELIVERY));
        }

        #[tokio::test]
        async fn leased_upload_matches_only_its_execution_attempt_and_filename() {
            let db = jobs_db().await;
            let token = PresentedLease::new("current".into());
            let mut job = insert_job(&db, Some(token.sha256())).await;
            job.browser_devices = Set(Some(BROWSER_DEVICES.into()));
            job.update(&db).await.unwrap();
            let lease = JobCaller::Lease(principal(&token));
            let probe = JobCaller::Probe {
                org: "org".into(),
                token_id: None,
            };
            let key = "synthetics/org/check/1970/01/01/run/E/d2/file";
            for (caller, presented) in [(&lease, None), (&probe, Some(&token))] {
                assert_eq!(
                    authorize_upload_in(&db, caller, presented, key, NOW).await,
                    Ok(())
                );
            }
            for wrong in [
                key.replace("/d2/", "/d1/"),
                key.replace("/d2/", "/"),
                key.replace("/01/01/", "/01/02/"),
                key.trim_end_matches("file").to_owned(),
                key.replace("file", "nested/file"),
            ] {
                assert_eq!(
                    authorize_upload_in(&db, &lease, None, &wrong, NOW).await,
                    Err(AttemptError::KeyOutsideAttempt)
                );
            }
            for missing in [
                key.replace("/E/", "/J/"),
                key.replace("/run/", "/elsewhere/"),
            ] {
                assert_eq!(
                    authorize_upload_in(&db, &lease, None, &missing, NOW).await,
                    Err(AttemptError::NotFound)
                );
            }
            for malformed in [
                key.replace("file", "../file"),
                key.replace("file", "a//file"),
                key.replace("file", "a\\file"),
                key.replace("/org/", "/other/"),
            ] {
                assert!(matches!(
                    authorize_upload_in(&db, &probe, Some(&token), &malformed, NOW).await,
                    Err(AttemptError::BadRequest(_))
                ));
            }
        }

        #[tokio::test]
        async fn tokenless_upload_requires_a_legacy_claim_even_after_completion() {
            let db = jobs_db().await;
            let mut job = insert_job(&db, Some(token_sha256("current"))).await;
            let probe = JobCaller::Probe {
                org: "org".into(),
                token_id: None,
            };
            let key = "synthetics/org/check/1970/01/01/run/job/file";
            let upload = || authorize_upload_in(&db, &probe, None, key, NOW);
            assert_eq!(upload().await, Err(AttemptError::LeaseRequired));
            job.status = Set(3);
            let mut job: ActiveModel = job.update(&db).await.unwrap().into();
            assert_eq!(upload().await, Err(AttemptError::LeaseRequired));
            job.lease_token_sha256 = Set(None);
            job.update(&db).await.unwrap();
            assert_eq!(upload().await, Ok(()));
        }

        #[tokio::test]
        async fn a_secret_bearing_check_takes_no_artifact_uploads() {
            let db = crate::service::composition::tests::db_with_synthetics_defaults().await;
            let backend = db.get_database_backend();
            let table = Schema::new(backend).create_table_from_entity(Entity);
            db.execute(backend.build(&table)).await.unwrap();
            let mut job = insert_job(&db, None).await;
            job.org_id = Set("org-wo".into());
            job.synthetics_id = Set("check-wo".into());
            job.update(&db).await.unwrap();
            let check = Synthetic {
                id: "check-wo".into(),
                check_type: SyntheticType::Http,
                auth: Some(SyntheticAuth::Bearer {
                    token: "AESenc:stored".into(),
                }),
                ..Default::default()
            };
            synthetics_checks::insert_row(&db, "org-wo", "check-wo", &check)
                .await
                .unwrap();
            let probe = JobCaller::Probe {
                org: "org-wo".into(),
                token_id: None,
            };
            let key = "synthetics/org-wo/check-wo/1970/01/01/run/job/file";
            assert_eq!(
                authorize_upload_in(&db, &probe, None, key, NOW).await,
                Err(AttemptError::CaptureOff)
            );
        }

        #[test]
        fn debug_redacts_lease_credentials() {
            let token = PresentedLease::new("private-lease-token".into());
            assert_eq!(format!("{token:?}"), "PresentedLease(..)");
            let debug = format!("{:?}", principal(&token));
            assert!(!debug.contains(token.expose()));
            assert!(!debug.contains(&token.sha256()));
        }

        #[tokio::test]
        async fn dispatcher_is_bound_to_one_live_attempt() {
            let db = jobs_db().await;
            let token = PresentedLease::new("dispatcher-token".into());
            let mut row = insert_job(&db, Some(token.sha256())).await;
            let caller = JobCaller::Lease(principal(&token));
            let bind = |job, now| bind_attempt(&db, &caller, None, job, now, Tokenless::Allow);
            let bound = bind("job", NOW).await.unwrap();
            assert_eq!(bound.row.id, "job");
            assert_eq!(bound.attempt, 2);
            assert_eq!(bound.lease_sha256, Some(token.sha256()));
            assert_eq!(
                bind("missing", NOW).await.err(),
                Some(AttemptError::OtherJob)
            );
            assert_eq!(
                bind("job", NOW + 1).await.err(),
                Some(AttemptError::Superseded)
            );

            row.dispatch_attempts = Set(3);
            row.lease_token_sha256 = Set(Some(PresentedLease::new("new-token".into()).sha256()));
            row.update(&db).await.unwrap();
            assert_eq!(bind("job", NOW).await.err(), Some(AttemptError::Superseded));
        }

        #[tokio::test]
        async fn probe_proof_and_tokenless_policy_follow_the_stored_lease() {
            let db = jobs_db().await;
            let token = PresentedLease::new("agent-token".into());
            let mut row = insert_job(&db, Some(token.sha256())).await;
            let probe = JobCaller::Probe {
                org: "org".into(),
                token_id: None,
            };
            let bind = |proof, policy| bind_attempt(&db, &probe, proof, "job", NOW, policy);
            let valid = bind(Some(&token), Tokenless::RefuseLeased).await.unwrap();
            assert_eq!(valid.attempt, 2);
            assert_eq!(valid.lease_sha256, Some(token.sha256()));
            let wrong = PresentedLease::new("wrong-token".into());
            assert_eq!(
                bind(Some(&wrong), Tokenless::Allow).await.err(),
                Some(AttemptError::Superseded)
            );
            let tokenless = bind(None, Tokenless::Allow).await.unwrap();
            assert_eq!(tokenless.attempt, 2);
            assert_eq!(tokenless.lease_sha256, None);
            assert_eq!(
                bind(None, Tokenless::RefuseLeased).await.err(),
                Some(AttemptError::LeaseRequired)
            );

            row.lease_token_sha256 = Set(None);
            row.update(&db).await.unwrap();
            assert_eq!(
                bind(None, Tokenless::RefuseLeased)
                    .await
                    .unwrap()
                    .lease_sha256,
                None
            );
        }

        #[tokio::test]
        async fn probe_must_own_an_existing_job() {
            let db = jobs_db().await;
            insert_job(&db, None).await;
            let caller = JobCaller::Probe {
                org: "other".into(),
                token_id: None,
            };
            let bind = |job| bind_attempt(&db, &caller, None, job, NOW, Tokenless::Allow);
            assert_eq!(bind("job").await.err(), Some(AttemptError::NotFound));
            assert_eq!(bind("missing").await.err(), Some(AttemptError::NotFound));
        }
    }

    use config::meta::synthetics::{SyntheticCookie, SyntheticVariable};

    use super::*;
    use crate::service::encrypt_secret;

    #[test]
    fn an_expanded_store_reference_or_secret_dependency_needs_a_lease() {
        use config::meta::synthetics_composition::ChildJourney;
        use serde_json::json;

        let mut snapshot = Synthetic {
            check_type: SyntheticType::Browser,
            config: json!({"steps": [
                {"id": "login", "action": "subtest", "subtest": {"id": "child"}}
            ]}),
            ..Default::default()
        };
        assert!(!needs_lease(&snapshot, false));
        assert!(needs_lease(&snapshot, true));
        let child = ChildJourney {
            id: "child".into(),
            name: "login".into(),
            steps: vec![json!({"id": "fill", "action": "fill", "value": "{{secrets.TOKEN}}"})],
        };
        let expanded = expand_journey(
            snapshot.config["steps"].as_array().unwrap(),
            &HashMap::from([(child.id.clone(), child)]),
            0,
            false,
        )
        .unwrap();
        snapshot.config["steps"] = json!(expanded);
        assert!(needs_lease(&snapshot, false));
        snapshot.config["steps"][0]["value"] = json!("{{vars.PLAIN}} {{LEGACY}}");
        assert!(!needs_lease(&snapshot, false));
    }

    /// The minimum an ack has ever had to carry. Everything else on
    /// `AckRequest` is `#[serde(default)]`, which is what makes rollback safe.
    fn old_probe_ack() -> serde_json::Value {
        serde_json::json!({
            "job_id": "2MNfNTxePfZ1pnY5gKVLkwsVRXv",
            "status": "up",
            "response_time_ms": 812.5,
            "attempts": 1
        })
    }

    /// **The rollback guarantee.** The probes gain these fields in two other
    /// repos on their own cadence, and an ack this server rejects is a check
    /// result thrown away. Absence must parse, and must parse to zero.
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

    /// All three present, carried through unchanged. Executed above defined is
    /// the retry case — normal, and must not be sanitised on the way in.
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

    /// The probe side of the wire. Field NAMES are the coupling: this struct and
    /// `AckRequest` are compiled from different repos, never checked together.
    #[derive(Serialize)]
    struct ProbeAck {
        job_id: String,
        status: String,
        attempts: i32,
        steps_executed: u32,
        steps_defined: u32,
        browser_ms: u64,
    }

    /// **The rename guard.** `#[serde(default)]` makes a mis-named field silent:
    /// it yields 0, indistinguishable from an old probe, so a rename on either
    /// side would zero the bill with no error anywhere. The keys are asserted as
    /// literal strings first — a `ProbeAck` renamed in step would round-trip and
    /// prove nothing — and only then round-tripped.
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

    /// The failure the pin above exists to catch: camelCase does not fail — the
    /// ack is accepted and bills nothing, like a probe that executed no steps.
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

    // Step billing. Every guard is a pure function, so these need no database.
    #[test]
    fn a_misconfigured_run_neither_closes_nor_grows_a_gap() {
        use config::meta::synthetics::RunClass as C;
        let open = infra::table::synthetics_checks::AlertState {
            gap_since: 100,
            gap_runs: 3,
            gap_notified_at: 200,
            ..Default::default()
        };
        assert_eq!(gap_step(open, C::Misconfigured, false, 300), (None, open));
        let (resumed, closed) = gap_step(open, C::Up, false, 300);
        assert!(matches!(
            resumed,
            Some(crate::alerting::GapNotice::Resumed { .. })
        ));
        assert_eq!(closed.gap_since, 100, "only a delivery closes the gap");
        assert_eq!(closed.gap_resumed_at, 300);
    }

    #[test]
    fn a_swept_up_run_with_a_not_measured_location_still_resolves_its_alert() {
        use config::meta::synthetics::{RunClass as C, SyntheticStatus as S};
        assert!(!swept_run_keeps_its_warning(false, C::Up, S::Error.to_db()));
        assert!(!swept_run_keeps_its_warning(
            false,
            C::Up,
            S::Passed.to_db()
        ));
        assert!(swept_run_keeps_its_warning(
            false,
            C::Up,
            S::Warning.to_db()
        ));
        assert!(!swept_run_keeps_its_warning(
            true,
            C::Up,
            S::Warning.to_db()
        ));
    }

    #[test]
    fn a_confirm_run_alerts_on_its_merged_vote() {
        use config::meta::synthetics::RunClass as C;
        let classify = |class, flaky| {
            let (status, reason, source) = super::merged_alert_input(class, flaky);
            crate::alerting::classify(Some(status), 1, source, reason)
        };
        use crate::alerting::RunClass as A;
        assert_eq!(classify(C::Up, true), A::Flaky);
        assert_eq!(classify(C::Up, false), A::Healthy);
        // A not measured location beside a confirmed pass must not page the owner.
        assert_eq!(classify(C::Up, false), A::Healthy);
        assert_eq!(classify(C::Down, false), A::Failing);
        assert_eq!(classify(C::Partial, false), A::Failing);
        assert_eq!(classify(C::NotMeasured, false), A::NotMeasured);
        assert_eq!(classify(C::Misconfigured, false), A::Failing);
    }

    #[test]
    fn only_a_scheduled_target_failure_gets_a_confirm_job() {
        let want = |status, source: &str, reason, probe, run, on, confirm| {
            super::wants_confirm_job(status, source, reason, probe, run, on, confirm)
        };
        assert!(want(3, "", None, "scheduled", "schedule", true, false));
        assert!(want(
            3,
            "probe",
            None,
            "scheduled",
            "gap_retry",
            true,
            false
        ));
        assert!(
            !want(1, "", None, "scheduled", "schedule", true, false),
            "a pass"
        );
        assert!(
            !want(4, "", None, "scheduled", "schedule", true, false),
            "an error"
        );
        assert!(
            !want(3, "", None, "manual", "schedule", true, false),
            "a manual run"
        );
        assert!(
            !want(3, "", None, "scheduled", "schedule", false, false),
            "setting off"
        );
        assert!(
            !want(3, "", None, "scheduled", "schedule", true, true),
            "a confirm job"
        );
        assert!(!want(
            3,
            "config",
            None,
            "scheduled",
            "schedule",
            true,
            false
        ));
        assert!(!want(
            3,
            "control_plane",
            None,
            "scheduled",
            "schedule",
            true,
            false
        ));
    }

    #[cfg(feature = "cloud")]
    mod billing {
        use config::meta::{
            self_reporting::usage::{UsageData, UsageEvent},
            stream::StreamType,
        };
        use infra::table::synthetics_jobs::LeasedRow;

        use crate::job_api::{
            AckRequest, AlertDecision,
            billing::{
                BillingFlags, BillingInputs, Venue, events_for_ack, frozen_combos, inputs_from,
                resolve_billable,
            },
            stale_lease_response,
        };

        /// 2026-08-25T13:47:11Z, so the derived hour fields are checkable literals.
        const NOW_US: i64 = 1_787_665_631_000_000;

        /// As deployed once the operator flips the switch: emit live, clamp on.
        const LIVE: BillingFlags = BillingFlags {
            clamp_enabled: true,
        };

        /// A clean browser ack on a public location. `steps_configured` is per
        /// combo; `combos` is the fan-out inside this one job.
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
                region: None,
                confirm: false,
            }
        }

        /// A protocol ack: no `browser_devices` column, one step per attempt.
        fn protocol(retries: i32, executed: u32) -> BillingInputs<'static> {
            BillingInputs {
                combos: None,
                steps_configured: 1,
                retries,
                steps_executed: executed,
                ..browser(1, 1, retries, executed)
            }
        }

        fn size_for(events: &[UsageData], event: UsageEvent) -> Option<f64> {
            let mut matching = events.iter().filter(|e| e.event == event);
            let first = matching.next()?.size;
            assert!(
                matching.next().is_none(),
                "{event} must appear at most once per ack"
            );
            Some(first)
        }

        /// Whichever billable step event the ack emitted — the check type picks it.
        fn billed(events: &[UsageData]) -> Option<f64> {
            size_for(events, UsageEvent::SyntheticsBrowserSteps)
                .or_else(|| size_for(events, UsageEvent::SyntheticsProtocolSteps))
        }

        /// The step rows, and only those — the rows the metering split buckets.
        fn step_events(events: &[UsageData]) -> Vec<&UsageData> {
            events
                .iter()
                .filter(|e| {
                    matches!(
                        e.event,
                        UsageEvent::SyntheticsBrowserSteps | UsageEvent::SyntheticsProtocolSteps
                    )
                })
                .collect()
        }

        fn defined(events: &[UsageData]) -> Option<f64> {
            size_for(events, UsageEvent::_SyntheticsStepsDefined)
        }

        #[test]
        fn t1_protocol_check_one_attempt_bills_one_step() {
            let events = events_for_ack(LIVE, protocol(0, 1));
            assert_eq!(billed(&events), Some(1.0));
        }

        #[test]
        fn t2_browser_fourteen_steps_one_combo_no_retry() {
            let events = events_for_ack(LIVE, browser(14, 1, 0, 14));
            assert_eq!(billed(&events), Some(14.0));
            assert_eq!(defined(&events), Some(14.0));
        }

        /// 14 steps × 2 combos × 3 locations = 84. Combos are sequential INSIDE
        /// one job, so one ack carries all of a location's combos: 28; locations
        /// are separate jobs, so the 84 is a sum over three acks.
        ///
        /// ⚠ This is the case that decides whether the clamp ceiling includes the
        /// combo factor. A ceiling of `configured × (retries + 1)` is 14 here: it
        /// would clamp 28 down to 14 and under-bill by the fan-out factor. The
        /// ceiling must use `configured × combos`, the same product as "defined".
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

        #[test]
        fn e21_twelve_combos_bill_twelve_times_the_steps_in_one_ack() {
            let events = events_for_ack(LIVE, browser(14, 12, 0, 168));
            assert_eq!(billed(&events), Some(168.0));
        }

        #[test]
        fn t9_protocol_three_attempts_bills_three_steps() {
            // `attempts = 3` is `retries = 2`.
            let events = events_for_ack(LIVE, protocol(2, 3));
            assert_eq!(billed(&events), Some(3.0));
        }

        #[test]
        fn e1_e2_e3_partial_and_retried_runs_bill_what_executed() {
            // Fails at step 4 of 14, no retry.
            let events = events_for_ack(LIVE, browser(14, 1, 0, 4));
            assert_eq!(billed(&events), Some(4.0));
            assert_eq!(defined(&events), Some(14.0), "defined is still the journey");

            // Fails at 4, retry completes 14: 18 cumulative, ceiling 28.
            let events = events_for_ack(LIVE, browser(14, 1, 1, 18));
            assert_eq!(billed(&events), Some(18.0));

            // Fails at step 1: the one step that ran.
            let events = events_for_ack(LIVE, browser(14, 1, 0, 1));
            assert_eq!(billed(&events), Some(1.0));
        }

        #[test]
        fn t10_a_report_above_the_ceiling_is_clamped() {
            // ceiling = 14 × 1 × (0 + 1) = 14
            let events = events_for_ack(LIVE, browser(14, 1, 0, 9_999));
            assert_eq!(billed(&events), Some(14.0));
        }

        /// Exactly at the ceiling is not clamped; one above is. An off-by-one
        /// here silently over- or under-bills every retried run.
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

        #[test]
        fn the_clamp_can_be_disabled_at_runtime() {
            let flags = BillingFlags {
                clamp_enabled: false,
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

        #[test]
        fn t12_zero_from_an_old_protocol_probe_falls_back_to_one() {
            assert_eq!(billed(&events_for_ack(LIVE, protocol(0, 0))), Some(1.0));
            assert_eq!(
                billed(&events_for_ack(LIVE, protocol(2, 0))),
                Some(1.0),
                "retries must not inflate a fallback"
            );
        }

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

        /// The journey was edited 14 → 8 in flight. The ceiling uses the FROZEN
        /// count; `retries` comes from the LIVE check. That asymmetry is a
        /// property of the WIRING, so this goes through `inputs_from`.
        #[test]
        fn t13_the_ceiling_uses_the_frozen_count_not_the_live_one() {
            // Enqueued when the journey defined 14 steps; edited to 8 since.
            let mut row = leased_row();
            row.steps_configured = 14;
            row.browser_devices = Some(one_combo());
            let req = probe_ack(14, 0);

            // A ceiling from the edited definition would clamp this to 8.
            let events = events_for_ack(
                LIVE,
                inputs_from(&row, &req, 0, Venue::Public, NOW_US, None),
            );
            assert_eq!(billed(&events), Some(14.0));
        }

        /// The other half: `retries` moves the ceiling and comes from the caller.
        #[test]
        fn the_live_retry_count_moves_the_ceiling_and_the_frozen_row_does_not_carry_it() {
            let mut row = leased_row();
            row.steps_configured = 8;
            row.browser_devices = Some(one_combo());
            let req = probe_ack(16, 0);

            // retries = 1 ⇒ ceiling 8 × (1 + 1) = 16.
            let events = events_for_ack(
                LIVE,
                inputs_from(&row, &req, 1, Venue::Public, NOW_US, None),
            );
            assert_eq!(billed(&events), Some(16.0));

            // retries = 0 ⇒ ceiling 8, and the same ack clamps.
            let events = events_for_ack(
                LIVE,
                inputs_from(&row, &req, 0, Venue::Public, NOW_US, None),
            );
            assert_eq!(billed(&events), Some(8.0));
        }

        /// `inputs_from` reads each value from exactly one place: the frozen row,
        /// the probe's request, or the caller. Mixing them up is what the
        /// frozen/live asymmetry prevents, and no arithmetic test can see it.
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

            let i = inputs_from(&row, &req, 3, Venue::Public, NOW_US, Some("eu-1".into()));

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

        #[test]
        fn inputs_from_reads_a_protocol_job_as_having_no_combos() {
            let mut row = leased_row();
            row.browser_devices = None;
            row.steps_configured = 1;
            let req = probe_ack(0, 0);

            let events = events_for_ack(
                LIVE,
                inputs_from(&row, &req, 0, Venue::Public, NOW_US, None),
            );
            assert_eq!(billed(&events), Some(1.0));
        }

        /// A stale completion cannot charge a second time for the same job.
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

        #[test]
        fn t15_a_late_ack_from_an_evicted_holder_emits_nothing() {
            let resp = stale_lease_response(
                "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
                "scheduled".to_string(),
                leased_row(),
            );
            assert!(resp.usage_events.is_empty());
        }

        /// The job waited behind other jobs past its own `valid_until` and was
        /// never executed. Our scheduling lag, not the customer's work.
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

        #[test]
        fn a_config_errored_ack_bills_nothing_and_does_not_take_the_zero_fallback() {
            let mut i = browser(16, 1, 0, 0);
            i.error_source = crate::alerting::ERROR_SOURCE_CONFIG;
            assert!(events_for_ack(LIVE, i).is_empty());
        }

        #[test]
        fn a_control_plane_errored_ack_bills_nothing() {
            let mut i = browser(14, 1, 0, 14);
            i.error_source = crate::alerting::ERROR_SOURCE_CONTROL_PLANE;
            assert!(events_for_ack(LIVE, i).is_empty());
        }

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

        /// The failure direction: a venue we could not resolve — registry read
        /// failed, or no row — bills nothing. Only a positively-public row bills.
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

        #[test]
        fn a_confirm_job_is_not_billed() {
            let events = events_for_ack(
                LIVE,
                BillingInputs {
                    confirm: true,
                    ..browser(14, 1, 0, 14)
                },
            );
            assert!(events.is_empty());
            let mut row = leased_row();
            row.metadata = r#"{"confirm_of":"job-1"}"#.to_string();
            assert!(super::super::is_confirm_job(&row));
            assert!(!super::super::is_confirm_job(&leased_row()));
        }

        /// A Lambda invoke failure DOES bill — the invocation cost us money.
        /// Only `"queue"` is exempt; `"dispatch"` and `"probe"` are not.
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

        /// Reports what the PROBE says the journey defined, falling back to the
        /// frozen definition only for a probe too old to say. Never clamped.
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

        #[test]
        fn t21_an_ack_emits_the_step_row_the_defined_row_and_the_duration_row() {
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
                    "SyntheticsBrowserSteps".to_string(),
                    "_SyntheticsStepsDefined".to_string(),
                    "_SyntheticsBrowserMs".to_string(),
                ]
            );
        }

        /// The metering split keys on `stream_name`, so the one step row must carry the check id.
        #[test]
        fn ack_emits_one_neutral_step_event_with_the_check_id() {
            for (i, expected) in [
                (browser(14, 1, 0, 14), UsageEvent::SyntheticsBrowserSteps),
                (protocol(0, 1), UsageEvent::SyntheticsProtocolSteps),
            ] {
                let synthetics_id = i.synthetics_id.to_string();

                let events = events_for_ack(LIVE, i);
                let steps = step_events(&events);

                assert_eq!(steps.len(), 1, "exactly one step event per ack");
                assert_eq!(steps[0].event, expected, "the event follows is_browser");
                assert_eq!(steps[0].stream_name, synthetics_id);
            }
        }

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

        /// `ingest_usages` sums only `size` and `num_records`; `response_time` is
        /// AVERAGED and `request_body` keeps the FIRST row of the bucket. So a
        /// per-run count must travel in `size` and nowhere else.
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
                assert_eq!(e.num_records, 1, "sums to the acks in this row's bucket");
            }
            // And every number that must survive summation is in `size`.
            assert_eq!(billed(&events), Some(18.0));
            assert_eq!(defined(&events), Some(14.0));
            assert_eq!(
                size_for(&events, UsageEvent::_SyntheticsBrowserMs),
                Some(42_137.0)
            );
        }

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
                assert_eq!(e.user_email, "", "a probe acked, not a user");
                assert_eq!(e.dropped_records, 0);
                assert!(!e.is_partial);
                assert_eq!(e.region.as_deref(), Some("us-west-2"));
                assert!(e.trace_id.is_none());
                assert!(e.search_type.is_none());
                assert!(e.dashboard_info.is_none());
                let expected = match e.event {
                    UsageEvent::SyntheticsBrowserSteps | UsageEvent::SyntheticsProtocolSteps => {
                        "chk_1"
                    }
                    // Blank so these keep collapsing per org: `stream_name` is in `GroupKey`.
                    _ => "",
                };
                assert_eq!(
                    e.stream_name, expected,
                    "{} carries the wrong stream_name",
                    e.event
                );
            }
            // `unit` mirrors `MeteringEventName::unit()` — never "MB".
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

        /// No input can overflow, panic, or produce a negative or zero ceiling —
        /// the cast is at the clamp site and every combining op saturates.
        #[test]
        fn the_clamp_arithmetic_cannot_overflow_or_go_negative() {
            let extremes = [
                // (steps_configured, combos, retries, executed)
                (i32::MAX, u32::MAX, i32::MAX, u32::MAX),
                (i32::MAX, 1, 0, u32::MAX),
                (1, u32::MAX, i32::MAX, 1),
                // Impossible at the source (NOT NULL, floored at 1) — asserted so
                // a corrupt row can only floor UP, never to a zero ceiling.
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
            // Present but unreadable or empty is still "browser", floored to 1.
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

        /// The usage rows ride back as DATA and must never reach the probe:
        /// dropping the `#[serde(skip)]` would ship an org's billing rows to it.
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
            for leaked in [
                "usage_events",
                "SyntheticsBrowserSteps",
                "_SyntheticsStepsDefined",
            ] {
                assert!(!text.contains(leaked), "`{leaked}` leaked to the probe");
            }
        }

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

        /// The ack carries only counters, so a run that opened row 0 acks like one that did not.
        #[test]
        fn a_run_with_a_start_load_acks_the_same_counters_and_bills_the_same() {
            fn inputs<'a>(row: &'a LeasedRow, req: &'a AckRequest) -> BillingInputs<'a> {
                inputs_from(row, req, 0, Venue::Public, NOW_US, None)
            }
            // A `[click, assert]` journey: row 0 opened first, its load time on the clock.
            let mut opened = probe_ack(2, 2);
            opened.browser_ms = 9_150;
            // The same journey with a navigate first step: no row 0, so less wall time.
            let mut plain = probe_ack(2, 2);
            plain.browser_ms = 8_400;

            let row = LeasedRow {
                steps_configured: 2,
                browser_devices: Some(one_combo()),
                ..leased_row()
            };
            let with_row0 = resolve_billable(LIVE, &inputs(&row, &opened));
            assert_eq!(with_row0, resolve_billable(LIVE, &inputs(&row, &plain)));
            assert_eq!(
                with_row0.billable, 2,
                "the start load is never a billed step"
            );
            assert!(!with_row0.clamped);

            let opened_events = events_for_ack(LIVE, inputs(&row, &opened));
            let plain_events = events_for_ack(LIVE, inputs(&row, &plain));
            assert_eq!(billed(&opened_events), Some(2.0));
            assert_eq!(billed(&plain_events), Some(2.0));
            assert_eq!(defined(&opened_events), Some(2.0));
            assert_eq!(defined(&plain_events), Some(2.0));
            // The wall clock is the one thing a start load changes; it passes through untouched.
            assert_eq!(
                size_for(&opened_events, UsageEvent::_SyntheticsBrowserMs),
                Some(9_150.0)
            );
            assert_eq!(
                size_for(&plain_events, UsageEvent::_SyntheticsBrowserMs),
                Some(8_400.0)
            );
        }

        /// A zero definition is a zero clamp ceiling, which bills real work as nothing.
        #[test]
        fn the_frozen_definition_is_never_zero() {
            let definition = |configured: i32, combos: Option<u32>| {
                BillingInputs {
                    steps_configured: configured,
                    combos,
                    ..browser(configured, 1, 0, 0)
                }
                .frozen_definition()
            };
            assert_eq!(definition(14, Some(2)), 28);
            assert_eq!(definition(0, Some(2)), 2, "configured floors to 1");
            assert_eq!(definition(-7, None), 1, "a negative floors to 1");
            assert_eq!(definition(14, Some(0)), 14, "combos floor to 1");
            assert_eq!(definition(1, None), 1, "a protocol check");
        }

        #[test]
        fn the_frozen_definition_ignores_the_retry_multiplier() {
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
                "the definition must not scale with retries — the clamp ceiling does, \
                 and they are different numbers",
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

        // The two guard counters, pinned as SOURCE rather than as deltas: both are
        // process-global `IntCounter`s that dozens of tests above move on other
        // threads, so an exact-delta test would pass alone and fail in the suite.
        // The needles are split so this test's own source does not match them.

        /// The runtime half: the counters really are wired to the globals the
        /// alerts query. Monotone, because other tests share them.
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

    fn dek() -> Vec<u8> {
        vec![7u8; 64]
    }

    fn variable(name: &str, value: &str) -> SyntheticVariable {
        SyntheticVariable {
            name: name.to_string(),
            value: encrypt_secret(&dek(), value).unwrap(),
            secure: false,
            example: String::new(),
        }
    }

    #[test]
    fn a_check_with_only_shared_variables_still_needs_the_dek() {
        let synthetic = Synthetic::default();
        assert!(!needs_dek(&synthetic, false, false));
        assert!(needs_dek(&synthetic, false, true));
    }

    #[test]
    fn the_original_four_inputs_still_decide_on_their_own() {
        let with_variables = Synthetic {
            variables: vec![variable("A", "1")],
            ..Default::default()
        };
        assert!(needs_dek(&with_variables, false, false));

        let with_cookies = Synthetic {
            cookies: vec![SyntheticCookie::default()],
            ..Default::default()
        };
        assert!(needs_dek(&with_cookies, false, false));

        assert!(needs_dek(&Synthetic::default(), true, false));
    }

    #[test]
    fn a_check_tier_name_overrides_a_shared_one_and_the_rest_inherit() {
        let shared = vec![
            ("BASE_URL".to_string(), "https://shared".to_string()),
            ("API_TOKEN".to_string(), "shared-token".to_string()),
        ];
        let merged = merge_variable_tiers(
            shared,
            &[variable("BASE_URL", "https://check")],
            &dek(),
            "check-1",
        )
        .unwrap();

        assert_eq!(merged.get("BASE_URL").unwrap(), "https://check");
        assert_eq!(merged.get("API_TOKEN").unwrap(), "shared-token");
    }

    #[test]
    fn the_shared_tier_resolves_on_its_own_when_the_check_has_none() {
        let shared = vec![("PASSWORD".to_string(), "hunter2".to_string())];
        let merged = merge_variable_tiers(shared, &[], &dek(), "check-1").unwrap();

        assert_eq!(merged.get("PASSWORD").unwrap(), "hunter2");
    }

    #[test]
    fn the_cap_counts_the_resolved_set_not_either_tier() {
        let shared: Vec<(String, String)> = (0..MAX_VARIABLES)
            .map(|i| (format!("SHARED_{i}"), "x".to_string()))
            .collect();
        assert!(merge_variable_tiers(shared.clone(), &[], &dek(), "check-1").is_ok());
        // One inline variable that does not collide pushes the merged set over.
        let err =
            merge_variable_tiers(shared, &[variable("EXTRA", "1")], &dek(), "check-1").unwrap_err();
        // A plain error would 500, and the probe would retry a job that can never resolve.
        let cfg = err
            .downcast_ref::<ConfigError>()
            .expect("the cap must settle the job, not 500");
        assert_eq!(cfg.status_reason, REASON_CONFIG_VARIABLE_LIMIT);
        assert!(!cfg.guard_failure);
    }

    #[test]
    fn an_overriding_name_does_not_count_twice_toward_the_cap() {
        let shared: Vec<(String, String)> = (0..MAX_VARIABLES)
            .map(|i| (format!("SHARED_{i}"), "x".to_string()))
            .collect();
        let merged = merge_variable_tiers(
            shared,
            &[variable("SHARED_0", "override")],
            &dek(),
            "check-1",
        )
        .unwrap();
        assert_eq!(merged.len(), MAX_VARIABLES);
        assert_eq!(merged.get("SHARED_0").unwrap(), "override");
    }

    #[test]
    fn a_resolved_target_must_still_be_an_http_url() {
        assert!(resolved_target(&SyntheticType::Http, "file:///etc/passwd").is_err());
        assert!(resolved_target(&SyntheticType::Browser, "javascript:alert(1)").is_err());
        assert_eq!(
            resolved_target(&SyntheticType::Http, "https://shop.test/login").unwrap(),
            "https://shop.test/login"
        );
        assert_eq!(
            resolved_target(&SyntheticType::Tcp, "db.internal:5432").unwrap(),
            "db.internal:5432"
        );
    }

    #[test]
    fn a_resolved_target_without_a_scheme_gets_https_as_at_save_time() {
        assert_eq!(
            resolved_target(&SyntheticType::Http, "shop.test/login").unwrap(),
            "https://shop.test/login"
        );
    }

    #[test]
    fn a_bad_resolved_target_never_echoes_the_substituted_secret() {
        let err = resolved_target(&SyntheticType::Http, "ftp://x/?key=hunter2")
            .unwrap_err()
            .to_string();
        assert!(err.starts_with("target: "), "{err}");
        assert!(!err.contains("hunter2"), "{err}");
    }

    #[test]
    fn a_secret_referenced_only_from_a_header_is_visible_once_rehydrated() {
        let mut synthetic = Synthetic {
            check_type: SyntheticType::Http,
            target: "https://shop.test".to_string(),
            config: serde_json::json!({
                "method": "GET",
                "headers": [{ "key": "Authorization", "value": "" }]
            }),
            ..Default::default()
        };
        synthetic.config_secrets.insert(
            "/headers/0/value".to_string(),
            encrypt_secret(&dek(), "Bearer {{API_TOKEN}}").unwrap(),
        );
        let referenced = |s: &Synthetic| {
            config::meta::synthetics_variables::placeholder_names(
                &crate::service::check_placeholder_text(s),
            )
        };
        assert!(!referenced(&synthetic).contains("API_TOKEN"));

        crate::service::rehydrate_config_secrets(&mut synthetic, &dek()).unwrap();

        assert!(referenced(&synthetic).contains("API_TOKEN"));
        assert!(synthetic.config_secrets.is_empty());
    }

    mod expansion {
        use std::collections::{HashMap, HashSet};

        use config::meta::synthetics_composition::ChildJourney;
        use serde_json::json;

        use super::super::*;

        fn nav(id: &str) -> serde_json::Value {
            json!({ "id": id, "action": "navigate", "url": "https://x" })
        }

        fn child(id: &str, steps: usize) -> ChildJourney {
            ChildJourney {
                id: id.into(),
                name: id.into(),
                steps: (0..steps).map(|i| nav(&format!("c{i}"))).collect(),
            }
        }

        fn parent(refs: &[&str], own: usize) -> Vec<serde_json::Value> {
            let mut v: Vec<_> = (0..own).map(|i| nav(&format!("s{i}"))).collect();
            for (i, r) in refs.iter().enumerate() {
                v.push(
                    json!({ "id": format!("r{i}"), "action": "subtest", "subtest": { "id": r } }),
                );
            }
            v
        }

        #[test]
        fn a_plain_journey_passes_through_untouched() {
            let steps = parent(&[], 3);
            assert_eq!(
                expand_journey(&steps, &HashMap::new(), 0, false).unwrap(),
                steps
            );
        }

        #[test]
        fn over_the_cap_is_a_customer_fixable_config_error() {
            let children = HashMap::from([("big".to_string(), child("big", 40))]);
            // `own` excludes the appended reference: 11 + 40 = 51 executed, one over the cap.
            let err = expand_journey(&parent(&["big"], 11), &children, 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_STEPS_EXCEEDED);
            assert!(!err.guard_failure);
            assert!(err.message.contains("51"), "{}", err.message);
        }

        #[test]
        fn a_malformed_reference_never_reaches_a_browser() {
            // No `subtest.id`, so it yields no ref — the early return must still catch it.
            let steps = vec![nav("s0"), json!({ "id": "r0", "action": "subtest" })];
            let err = expand_journey(&steps, &HashMap::new(), 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_INVALID);
            assert!(err.guard_failure);
        }

        #[test]
        fn a_missing_child_is_our_guard_failure() {
            let err = expand_journey(&parent(&["gone"], 1), &HashMap::new(), 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_MISSING);
            assert!(err.guard_failure);
        }

        #[test]
        fn a_fresh_super_cluster_parent_waits_for_its_child_to_replicate() {
            let now = config::utils::time::now_micros();
            let err =
                expand_journey(&parent(&["gone"], 1), &HashMap::new(), now, true).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_PENDING);
            assert!(!err.guard_failure);
        }

        #[test]
        fn a_super_cluster_parent_past_the_grace_period_reports_the_child_missing() {
            let grace_us = i64::try_from(
                config::get_config()
                    .synthetics
                    .subtests_replication_grace_secs,
            )
            .unwrap()
                * 1_000_000;
            let stale = config::utils::time::now_micros() - grace_us - 1_000_000;
            let err =
                expand_journey(&parent(&["gone"], 1), &HashMap::new(), stale, true).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_MISSING);
            assert!(err.guard_failure);
        }

        #[test]
        fn a_fresh_parent_without_super_cluster_reports_the_child_missing() {
            let now = config::utils::time::now_micros();
            let err =
                expand_journey(&parent(&["gone"], 1), &HashMap::new(), now, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_MISSING);
        }

        fn defined(name: &str) -> HashSet<String> {
            HashSet::from([name.to_string()])
        }

        #[test]
        fn a_variable_is_matched_by_name_never_by_value() {
            // A name/value swap in what feeds `defined` compiles and fails every composed check.
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{TOKEN}}");
            let children = HashMap::from([("login".to_string(), c)]);
            let steps = parent(&["login"], 1);
            validate_child_placeholders(&steps, &children, &defined("TOKEN")).unwrap();
            assert!(validate_child_placeholders(&steps, &children, &defined("sekret")).is_err());
        }

        // A {{NAME}} defined only as a browser secret passes the guard and reaches env_inject.
        #[test]
        fn a_parent_secret_defines_a_child_placeholder_and_feeds_env_inject() {
            let synthetic = config::meta::synthetics::Synthetic {
                config: json!({
                    "steps": [ { "id": "r0", "action": "subtest", "subtest": { "id": "login" } } ],
                    "secrets": [ { "name": "PASSWORD", "value": "hunter2" } ]
                }),
                ..Default::default()
            };
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{PASSWORD}}");
            let children = HashMap::from([("login".to_string(), c)]);

            let mut env_inject = HashMap::new();
            inject_browser_secrets(&synthetic.config, &mut env_inject);
            assert_eq!(
                env_inject.get("PASSWORD").map(String::as_str),
                Some("hunter2")
            );
            let steps = parent(&["login"], 1);
            let names: HashSet<String> = env_inject.keys().cloned().collect();
            validate_child_placeholders(&steps, &children, &names).unwrap();

            let mut expanded_config = synthetic.config.clone();
            expanded_config["steps"] = json!(expand_journey(&steps, &children, 0, false).unwrap());
            let mut env_inject = HashMap::new();
            inject_browser_secrets(&expanded_config, &mut env_inject);
            assert_eq!(
                env_inject.get("PASSWORD").map(String::as_str),
                Some("hunter2")
            );
        }

        /// The shared tier reads placeholders off `config`, so expansion must already have run.
        #[test]
        fn an_expanded_journey_exposes_a_child_placeholder_to_the_shared_tier() {
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{REGION}}");
            let children = HashMap::from([("login".to_string(), c)]);
            let steps = parent(&["login"], 1);
            let mut synthetic = config::meta::synthetics::Synthetic {
                check_type: SyntheticType::Browser,
                config: json!({ "steps": steps }),
                ..Default::default()
            };
            assert!(!crate::service::check_placeholder_text(&synthetic).contains("REGION"));
            synthetic.config["steps"] = json!(expand_journey(&steps, &children, 0, false).unwrap());
            assert!(crate::service::check_placeholder_text(&synthetic).contains("REGION"));
        }

        /// A shared row resolves into env_inject, which is the whole of what the guard accepts.
        #[test]
        fn a_shared_variable_in_env_inject_defines_a_child_placeholder() {
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{REGION}}");
            let children = HashMap::from([("login".to_string(), c)]);
            let env_inject = HashMap::from([("REGION".to_string(), "eu-west".to_string())]);
            let names: HashSet<String> = env_inject.keys().cloned().collect();
            validate_child_placeholders(&parent(&["login"], 1), &children, &names).unwrap();
        }

        #[test]
        fn the_first_referenced_child_is_the_one_named() {
            let mut a = child("a", 1);
            a.steps[0]["url"] = json!("https://x/{{AAA}}");
            let mut b = child("b", 1);
            b.steps[0]["url"] = json!("https://x/{{BBB}}");
            let children = HashMap::from([("a".to_string(), a), ("b".to_string(), b)]);
            let err =
                validate_child_placeholders(&parent(&["a", "b"], 1), &children, &HashSet::new())
                    .unwrap_err();
            assert!(err.message.contains("AAA"), "{}", err.message);
        }

        #[test]
        fn a_child_placeholder_the_parent_does_not_define_is_a_config_error() {
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{TOKEN}}");
            let children = HashMap::from([("login".to_string(), c)]);
            let err =
                validate_child_placeholders(&parent(&["login"], 1), &children, &HashSet::new())
                    .unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_VARIABLE_UNDEFINED);
            // Customer-fixable, so it must not be counted as one of our guards failing.
            assert!(!err.guard_failure);
            assert!(err.message.contains("TOKEN"), "{}", err.message);
        }

        #[test]
        fn a_child_placeholder_the_parent_defines_expands_normally() {
            let mut c = child("login", 1);
            c.steps[0]["url"] = json!("https://x/{{TOKEN}}");
            let children = HashMap::from([("login".to_string(), c)]);
            let steps = parent(&["login"], 1);
            validate_child_placeholders(&steps, &children, &defined("TOKEN")).unwrap();
            let out = expand_journey(&steps, &children, 0, false).unwrap();
            assert_eq!(out.len(), 2);
        }

        fn holding(id: &str, child: &str) -> ChildJourney {
            ChildJourney {
                id: id.into(),
                name: id.into(),
                steps: parent(&[child], 1),
            }
        }

        #[test]
        fn a_two_node_cycle_ends_as_an_invalid_reference() {
            let children = HashMap::from([
                ("a".to_string(), holding("a", "b")),
                ("b".to_string(), holding("b", "a")),
            ]);
            let err = expand_journey(&parent(&["b"], 1), &children, 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_INVALID);
        }

        #[test]
        fn a_self_cycle_ends_as_an_invalid_reference() {
            let children = HashMap::from([("a".to_string(), holding("a", "a"))]);
            let err = expand_journey(&parent(&["a"], 1), &children, 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_INVALID);
        }

        #[test]
        fn a_child_holding_a_reference_is_our_guard_failure() {
            let mut nested = child("nested", 2);
            nested
                .steps
                .push(json!({ "id": "z", "action": "subtest", "subtest": { "id": "other" } }));
            let children = HashMap::from([("nested".to_string(), nested)]);
            let err = expand_journey(&parent(&["nested"], 1), &children, 0, false).unwrap_err();
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_INVALID);
            assert!(err.guard_failure);
        }

        async fn empty_db() -> sea_orm::DatabaseConnection {
            sea_orm::Database::connect("sqlite::memory:").await.unwrap()
        }

        fn browser_synthetic(steps: serde_json::Value) -> config::meta::synthetics::Synthetic {
            config::meta::synthetics::Synthetic {
                check_type: SyntheticType::Browser,
                config: json!({
                    "steps": steps,
                    "secrets": [ { "name": "PASSWORD", "value": "hunter2" } ]
                }),
                ..Default::default()
            }
        }

        #[tokio::test]
        async fn a_plain_journey_resolves_unchanged() {
            let mut synthetic = browser_synthetic(json!(parent(&[], 2)));
            let before = synthetic.config.clone();
            expand_snapshot(&empty_db().await, &mut synthetic, None, false)
                .await
                .unwrap();
            assert_eq!(synthetic.config, before);
        }

        #[test]
        fn a_plain_journey_gets_its_secrets_in_env_inject() {
            let mut synthetic = browser_synthetic(json!(parent(&[], 2)));
            synthetic.config["secrets"] = json!([{ "name": "PASSWORD", "value": "s3cret" }]);
            let mut env_inject = HashMap::new();
            inject_journey_secrets(&synthetic, &mut env_inject);
            assert_eq!(
                env_inject.get("PASSWORD").map(String::as_str),
                Some("s3cret")
            );
        }

        #[tokio::test]
        async fn a_reference_naming_no_child_reaches_the_boundary_check() {
            let mut synthetic =
                browser_synthetic(json!([nav("s0"), { "id": "r0", "action": "subtest" }]));
            let err = expand_snapshot(&empty_db().await, &mut synthetic, None, false)
                .await
                .unwrap_err();
            let err = err.downcast_ref::<ConfigError>().expect("a ConfigError");
            assert_eq!(err.status_reason, REASON_CONFIG_REFERENCE_INVALID);
            assert!(err.message.contains("names no check"), "{}", err.message);
        }

        async fn db_with_split_child(org: &str, child_id: &str) -> sea_orm::DatabaseConnection {
            let db = crate::service::composition::tests::db_with_synthetics_defaults().await;
            let child = config::meta::synthetics::Synthetic {
                id: child_id.into(),
                org_id: org.into(),
                check_type: SyntheticType::Browser,
                config: json!({ "steps": [
                    nav("c0"),
                    { "id": "c1", "action": "fill", "locator": "#password", "value": null },
                ] }),
                config_secrets: [(
                    "/steps/1/value".to_string(),
                    crate::service::encrypt_literal(&super::dek(), "hunter2").unwrap(),
                )]
                .into(),
                ..Default::default()
            };
            synthetics_checks::insert_row(&db, org, child_id, &child)
                .await
                .unwrap();
            db
        }

        fn embedding(org: &str, child_id: &str) -> config::meta::synthetics::Synthetic {
            let mut parent = browser_synthetic(json!(parent(&[child_id], 1)));
            parent.org_id = org.into();
            parent.config["secrets"] = json!([]);
            parent
        }

        #[tokio::test]
        async fn a_split_child_value_is_spliced_in_and_turns_capture_off() {
            let db = db_with_split_child("org-d231", "child-d231").await;
            let mut synthetic = embedding("org-d231", "child-d231");
            assert!(!crate::service::carries_write_only(&synthetic));
            expand_snapshot(&db, &mut synthetic, Some(&super::dek()), false)
                .await
                .unwrap();
            let steps = synthetic.config["steps"].as_array().unwrap();
            assert!(steps.iter().any(|s| s["value"] == "hunter2"), "{steps:?}");
            assert!(crate::service::carries_write_only(&synthetic));
            crate::service::force_capture_off(&mut synthetic);
            assert_eq!(synthetic.config["capture"]["trace"], "off");
        }

        #[tokio::test]
        async fn a_child_slot_without_origins_fails_closed_after_the_backfill() {
            let db = db_with_split_child("org-origins", "child-origins").await;
            let mut synthetic = embedding("org-origins", "child-origins");
            let err = expand_snapshot(&db, &mut synthetic, Some(&super::dek()), true)
                .await
                .unwrap_err();
            let err = err.downcast_ref::<ConfigError>().expect("a ConfigError");
            assert_eq!(err.status_reason, REASON_SLOT_ORIGIN_CHANGED);
            assert!(!err.message.contains("hunter2"));
        }

        #[tokio::test]
        async fn artifacts_and_ack_text_follow_a_child_write_only_value() {
            let db = db_with_split_child("org-art", "child-art").await;
            let parent = embedding("org-art", "child-art");
            synthetics_checks::insert_row(&db, "org-art", "parent-art", &parent)
                .await
                .unwrap();
            let mut plain = browser_synthetic(json!([nav("p0")]));
            plain.config["secrets"] = json!([]);
            synthetics_checks::insert_row(&db, "org-art", "plain-art", &plain)
                .await
                .unwrap();
            assert_eq!(
                secret_bearing_in(&db, "org-art", "child-art").await,
                Ok(true)
            );
            assert_eq!(
                secret_bearing_in(&db, "org-art", "parent-art").await,
                Ok(true)
            );
            assert_eq!(
                secret_bearing_in(&db, "org-art", "plain-art").await,
                Ok(false)
            );
            assert_eq!(
                secret_bearing_in(&db, "org-art", "missing").await,
                Ok(false)
            );
        }
    }
}

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

//! Trial Quota Service — in-memory quota counters with DB persistence.
//!
//! Free tier: every org gets one lifetime grant **per pool** of free credits.
//! A pool never resets — once consumed, the org must subscribe to continue.
//! Pay-as-you-go: when free credits are exhausted and the org has an active
//! Stripe subscription, AI metering prices are auto-added to the subscription
//! and usage is reported to the _usage stream for billing.
//!
//! ## Pools
//!
//! [`TrialQuotaPool::AiCredits`] and the two synthetics step pools are
//! independent: every counter, limit, DB read and HA message is keyed
//! `(org, pool)`, so spending one grant cannot drain the other, and
//! [`TrialQuotaFeature::pool`] is the only feature-to-pool mapping. No
//! migration — a pool is just a fixed set of `trial_quota_usage.feature` keys.
//! The grants are one-time: no rollover column, no reset logic (§6.1, E23).
//!
//! ## Architecture
//!
//! - **Hot path** (`try_deduct`): atomic CAS on per-org counter, sends deduction record to a
//!   bounded channel, broadcasts delta via dedicated NATS queue.
//! - **DB flush** (`flush_to_db`): background job drains the channel periodically, coalesces
//!   per-org/feature records, and batch-upserts to DB.
//! - **Cluster sync** (`subscribe_ha_queue`): listens for delta messages from other nodes on a
//!   dedicated NATS queue and atomically adds the delta to the local counter. Skips messages from
//!   self (source_node check). Deltas are commutative so message ordering doesn't matter.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, LazyLock as Lazy, Mutex, OnceLock, RwLock,
        atomic::{AtomicI64, AtomicU64, Ordering},
    },
};

use bytes::Bytes;
use chrono::{Datelike, Timelike, Utc};
use config::{
    cluster::LOCAL_NODE,
    meta::{
        cluster::Node,
        self_reporting::usage::{UsageData, UsageEvent},
        stream::StreamType,
    },
    utils::json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use utoipa::ToSchema;

/// Per-`(org, pool)` total usage counter, keyed by [`scope`] — one AtomicU64
/// per scope, no cross-key locks. Keyed by scope and not by org: one counter
/// per org made the two pools drain each other.
static ORG_USAGE: Lazy<RwLock<HashMap<String, AtomicU64>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Explicit per-`(org, pool)` limits, keyed by [`scope`]. Missing scopes use the
/// pool's deployment-wide default ([`TrialQuotaPool::default_limit`]).
static ORG_LIMITS: Lazy<RwLock<HashMap<String, u64>>> = Lazy::new(|| RwLock::new(HashMap::new()));

/// Pool adjustments already applied in THIS process. See [`IdempotencyLedger`].
static ADJUSTMENTS: Lazy<IdempotencyLedger> =
    Lazy::new(|| IdempotencyLedger::new(ADJUSTMENT_LEDGER_CAPACITY));

/// How many adjustment keys the ledger remembers — ~2 h of a busy region's
/// acks, and bounded so a long-lived scheduler cannot grow it without limit.
const ADJUSTMENT_LEDGER_CAPACITY: usize = 100_000;

/// Bounded channel for deduction records pending DB flush.
/// Capacity is generous to avoid backpressure on the hot path.
static FLUSH_TX: Lazy<mpsc::Sender<FlushRecord>> = Lazy::new(|| {
    let (tx, rx) = mpsc::channel(10_000);
    // Leak the receiver into a static so the flush job can drain it.
    // Safety: this is initialized once and lives for the process lifetime.
    let rx = Box::leak(Box::new(tokio::sync::Mutex::new(rx)));
    // Store the receiver reference
    FLUSH_RX.set(rx).ok();
    tx
});

/// The receiver end, set once during FLUSH_TX initialization.
static FLUSH_RX: OnceLock<&'static tokio::sync::Mutex<mpsc::Receiver<FlushRecord>>> =
    OnceLock::new();

/// Dedicated NATS queue for HA sync of quota deductions across nodes.
pub const TRIAL_QUOTA_HA_QUEUE: &str = "trial_quota_ha_queue";

/// Max `updated_at` (micros) from DB rows loaded during init_from_db.
/// NATS messages with timestamp <= this are already reflected in the DB
/// snapshot and must be skipped to avoid double-counting.
static INIT_WATERMARK: AtomicI64 = AtomicI64::new(0);

/// The checkpoints at which quota notification emails are sent.
const QUOTA_CHECKPOINTS: &[u8] = &[80, 90, 95, 100];

/// A usage record buffered for periodic DB flush. `cost` is SIGNED: a
/// reconcile refund must reach `trial_quota_usage`, or the in-memory and
/// persisted counters diverge at the next restart.
struct FlushRecord {
    org_id: String,
    feature_key: String,
    cost: i64,
}

/// A one-time free grant, and the unit of isolation between features. Every
/// counter, limit and DB read is keyed per `(org, pool)` via [`scope`]: an org
/// that spends its AI credits must not thereby lose its synthetics budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrialQuotaPool {
    /// AI chat, incident analysis and incident re-analysis. The original pool.
    AiCredits,
    /// Browser-check steps — SPEC §6.1. One-time, never resets (E23).
    SyntheticsBrowserSteps,
    /// Protocol-check steps — SPEC §6.1. One-time, never resets (E23). Separate
    /// from the browser grant because a browser step costs ~52x a protocol one,
    /// so a shared pool let the org's mix decide our free-tier cost.
    SyntheticsProtocolSteps,
}

impl TrialQuotaPool {
    /// Stable identifier used in the [`scope`] key and on the HA wire.
    pub fn key(&self) -> &'static str {
        match self {
            TrialQuotaPool::AiCredits => "ai_credits",
            TrialQuotaPool::SyntheticsBrowserSteps => "synthetics_browser_steps",
            TrialQuotaPool::SyntheticsProtocolSteps => "synthetics_protocol_steps",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "ai_credits" => Some(TrialQuotaPool::AiCredits),
            "synthetics_browser_steps" => Some(TrialQuotaPool::SyntheticsBrowserSteps),
            // Pre-split key. Resolved to PROTOCOL so an existing balance keeps
            // draining the cheap grant rather than handing out free browser steps.
            "synthetics_steps" | "synthetics_protocol_steps" => {
                Some(TrialQuotaPool::SyntheticsProtocolSteps)
            }
            _ => None,
        }
    }

    /// Which pool a `trial_quota_usage.feature` value belongs to. `None` for a
    /// key a NEWER node wrote: guessing would spend one grant on another's usage.
    pub fn from_key_of_feature(feature: &str) -> Option<Self> {
        [
            TrialQuotaPool::AiCredits,
            TrialQuotaPool::SyntheticsBrowserSteps,
            TrialQuotaPool::SyntheticsProtocolSteps,
        ]
        .into_iter()
        .find(|pool| pool.feature_keys().contains(&feature))
    }

    /// Every `trial_quota_usage.feature` value that spends from this pool; each
    /// per-pool query uses this set as an `IN` filter. MUST stay in sync with
    /// [`TrialQuotaFeature::pool`] (`every_feature_is_listed_by_its_own_pool`).
    pub fn feature_keys(&self) -> &'static [&'static str] {
        match self {
            TrialQuotaPool::AiCredits => &["ai_chat", "new_incident", "incident_reanalysis"],
            TrialQuotaPool::SyntheticsBrowserSteps => &["synthetics_browser_steps"],
            // `synthetics_steps` is the pre-split feature key: existing rows keep
            // counting here, so no migration is needed and no balance is reset.
            TrialQuotaPool::SyntheticsProtocolSteps => {
                &["synthetics_protocol_steps", "synthetics_steps"]
            }
        }
    }

    /// The row [`set_limit_for_pool`] upserts so that an org with no prior usage
    /// in this pool can still be given an explicit limit.
    fn seed_feature(&self) -> &'static str {
        // `feature_keys` is never empty; the fallback only avoids a panic.
        self.feature_keys().first().copied().unwrap_or("ai_chat")
    }

    /// The deployment-wide default grant for this pool.
    ///
    /// ⚠️ §8.3 / §11 **F4**, UNRESOLVED: this pool is REGION-LOCAL — no
    /// super-cluster handler for `trial_quota_usage`, and the HA queue is local
    /// NATS — so in an N-region super cluster one org holds N independent
    /// grants of this size. Item 2.6 owns the fix; nothing here may assume it.
    pub fn default_limit(&self) -> u64 {
        let cfg = o2_enterprise::enterprise::common::config::get_config();
        match self {
            TrialQuotaPool::AiCredits => cfg.cloud.ai_free_credit_pool,
            TrialQuotaPool::SyntheticsBrowserSteps => cfg.cloud.synthetics_free_browser_step_pool,
            TrialQuotaPool::SyntheticsProtocolSteps => cfg.cloud.synthetics_free_protocol_step_pool,
        }
    }
}

/// The key both [`ORG_USAGE`] and [`ORG_LIMITS`] use. `\u{1f}` (ASCII unit
/// separator) rather than `/` or `:`: an org id is user-chosen, and a separator
/// it can contain would let two different scopes collide into one pool.
fn scope(org_id: &str, pool: TrialQuotaPool) -> String {
    format!("{org_id}\u{1f}{}", pool.key())
}

/// Trial quota feature variants — extensible for future metered features
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrialQuotaFeature {
    AiChat,
    NewIncident,
    IncidentReAnalysis,
    /// One unit is one EXECUTED browser step, so a 14-step journey over 2 combos costs 28.
    SyntheticsBrowserSteps,
    /// One unit is one EXECUTED protocol step.
    SyntheticsProtocolSteps,
}

impl TrialQuotaFeature {
    /// DB key for this feature (stored in `feature` column)
    pub fn feature_key(&self) -> &'static str {
        match self {
            TrialQuotaFeature::AiChat => "ai_chat",
            TrialQuotaFeature::NewIncident => "new_incident",
            TrialQuotaFeature::IncidentReAnalysis => "incident_reanalysis",
            TrialQuotaFeature::SyntheticsBrowserSteps => "synthetics_browser_steps",
            TrialQuotaFeature::SyntheticsProtocolSteps => "synthetics_protocol_steps",
        }
    }

    /// Which one-time grant this feature spends from — SPEC §9 item 2.1.
    pub fn pool(&self) -> TrialQuotaPool {
        match self {
            TrialQuotaFeature::AiChat
            | TrialQuotaFeature::NewIncident
            | TrialQuotaFeature::IncidentReAnalysis => TrialQuotaPool::AiCredits,
            TrialQuotaFeature::SyntheticsBrowserSteps => TrialQuotaPool::SyntheticsBrowserSteps,
            TrialQuotaFeature::SyntheticsProtocolSteps => TrialQuotaPool::SyntheticsProtocolSteps,
        }
    }

    /// Credit cost of ONE unit. Synthetics is fixed at 1 and the caller
    /// multiplies ([`try_deduct_units`]): the §6.1 grant is denominated in
    /// STEPS, so a configurable per-step cost would silently rescale it.
    pub fn cost(&self) -> u64 {
        let cfg = o2_enterprise::enterprise::common::config::get_config();
        match self {
            TrialQuotaFeature::AiChat => cfg.cloud.ai_credit_cost_chat,
            TrialQuotaFeature::NewIncident => cfg.cloud.ai_credit_cost_incident,
            TrialQuotaFeature::IncidentReAnalysis => cfg.cloud.ai_credit_cost_incident_reanalysis,
            TrialQuotaFeature::SyntheticsBrowserSteps
            | TrialQuotaFeature::SyntheticsProtocolSteps => 1,
        }
    }

    /// The feature-breakdown `UsageEvent`, or `None` where this path does not emit one.
    pub fn usage_event(&self) -> Option<UsageEvent> {
        match self {
            TrialQuotaFeature::AiChat => Some(UsageEvent::AiChat),
            TrialQuotaFeature::NewIncident => Some(UsageEvent::NewIncident),
            TrialQuotaFeature::IncidentReAnalysis => Some(UsageEvent::IncidentReAnalysis),
            // Synthetics emits from `job_api::events_for_ack`, never here.
            TrialQuotaFeature::SyntheticsBrowserSteps
            | TrialQuotaFeature::SyntheticsProtocolSteps => None,
        }
    }
}

/// One idempotent pool movement — SPEC §6.3's reconcile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolAdjustment {
    /// The run executed FEWER steps than reserved: give the difference back.
    Refund(u64),
    /// The run executed MORE (retries fired): take the difference. **Never
    /// refused** (§6.3 / E14) — this can push usage PAST the limit, and the next
    /// enqueue is where enforcement happens.
    TopUp(u64),
}

impl PoolAdjustment {
    /// The signed movement this applies to the counter.
    pub fn delta(&self) -> i64 {
        match self {
            // A refund cannot exceed i64::MAX; saturating keeps the sign right.
            PoolAdjustment::Refund(n) => -(i64::try_from(*n).unwrap_or(i64::MAX)),
            PoolAdjustment::TopUp(n) => i64::try_from(*n).unwrap_or(i64::MAX),
        }
    }
}

/// A bounded, process-local record of the adjustment keys already applied.
///
/// SPEC §6.3 keys every adjustment on
/// `(synthetics_id, location, scheduled_ts, job_id)`; the caller builds it,
/// this is where it is checked, and [`claim`](Self::claim) returns `true`
/// exactly once per key in the window. Process-local is enough only because it
/// is the SECOND gate — `synthetics_jobs::ack_complete` already rejects
/// duplicate acks cluster-wide (T14/T15) — and the bound stops it leaking.
struct IdempotencyLedger {
    inner: Mutex<LedgerInner>,
    capacity: usize,
}

struct LedgerInner {
    seen: HashSet<String>,
    /// Insertion order, so eviction is FIFO rather than arbitrary — a key
    /// replayed after `capacity` further adjustments would be applied twice.
    order: VecDeque<String>,
}

impl IdempotencyLedger {
    fn new(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(LedgerInner {
                seen: HashSet::new(),
                order: VecDeque::new(),
            }),
            // A zero capacity would silently disable the guard, so it is floored.
            capacity: capacity.max(1),
        }
    }

    /// `true` the first time this key is seen, `false` for every repeat.
    ///
    /// Poisoning is ignored: a panic elsewhere must not panic a billing path.
    fn claim(&self, key: &str) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.seen.insert(key.to_string()) {
            return false;
        }
        inner.order.push_back(key.to_string());
        while inner.order.len() > self.capacity {
            if let Some(evicted) = inner.order.pop_front() {
                inner.seen.remove(&evicted);
            }
        }
        true
    }

    /// How many keys are remembered. `cfg(test)` because the bound it pins —
    /// this map cannot grow forever — is not observable any other way.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .seen
            .len()
    }
}

impl std::fmt::Display for TrialQuotaFeature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.feature_key())
    }
}

/// Error returned when free quota is exhausted
#[derive(Debug, Serialize, Deserialize)]
pub struct QuotaExhaustedError {
    pub usage_count: u64,
    pub usage_limit: u64,
}

impl std::fmt::Display for QuotaExhaustedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Free trial quota exhausted ({}/{} used). Subscribe to continue using this feature.",
            self.usage_count, self.usage_limit
        )
    }
}

impl std::error::Error for QuotaExhaustedError {}

/// Get one pool's limit for an organization, falling back to the pool's
/// deployment-wide default. ⚠️ The value is REGION-LOCAL — see
/// [`TrialQuotaPool::default_limit`].
fn get_pool_limit(org_id: &str, pool: TrialQuotaPool) -> u64 {
    let org_limit = ORG_LIMITS
        .read()
        .unwrap()
        .get(&scope(org_id, pool))
        .copied();
    org_limit.unwrap_or_else(|| pool.default_limit())
}

/// Get total usage in one pool for an org (single atomic read).
fn get_pool_used(org_id: &str, pool: TrialQuotaPool) -> u64 {
    let map = ORG_USAGE.read().unwrap();
    map.get(&scope(org_id, pool))
        .map(|v| v.load(Ordering::Relaxed))
        .unwrap_or(0)
}

/// Ensure the per-`(org, pool)` atomic counter exists.
fn ensure_scope_counter(key: &str) {
    {
        let map = ORG_USAGE.read().unwrap();
        if map.contains_key(key) {
            return;
        }
    }
    // Use entry() instead of direct insert because another thread may have
    // inserted between us dropping the read lock above and acquiring this write lock.
    let mut map = ORG_USAGE.write().unwrap();
    map.entry(key.to_string())
        .or_insert_with(|| AtomicU64::new(0));
}

/// Atomically apply a SIGNED delta to one pool's counter, saturating at zero:
/// a refund larger than the recorded usage must not wrap `u64` into an org that
/// has used 18 quintillion units and can never run again.
fn apply_to_pool_counter(org_id: &str, pool: TrialQuotaPool, delta: i64) -> u64 {
    let key = scope(org_id, pool);
    ensure_scope_counter(&key);
    let map = ORG_USAGE.read().unwrap();
    let Some(counter) = map.get(&key) else {
        return 0;
    };
    loop {
        let current = counter.load(Ordering::Relaxed);
        let next = if delta >= 0 {
            current.saturating_add(delta.unsigned_abs())
        } else {
            current.saturating_sub(delta.unsigned_abs())
        };
        if counter
            .compare_exchange(current, next, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            return next;
        }
    }
}

fn set_cached_limit(org_id: &str, pool: TrialQuotaPool, usage_limit: u64) {
    ORG_LIMITS
        .write()
        .unwrap()
        .insert(scope(org_id, pool), usage_limit);
}

/// HA message broadcast to other nodes after a deduction, an adjustment or a
/// limit update.
///
/// Wire-compatible with nodes predating pool scoping: `pool` and `delta` are
/// `#[serde(default)]`, so an OLD `{cost: 50}` reads as `+50` on AI credits —
/// the only senders then — and a NEW message puts the POSITIVE part of `delta`
/// in `cost` so an un-upgraded node still applies deductions. A refund it
/// ignores, staying high until it reloads from the DB: safe direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialQuotaHaMsg {
    pub org_id: String,
    /// The POSITIVE part of `delta`, for nodes that predate `delta`.
    pub cost: u64,
    #[serde(default)]
    pub usage_limit: Option<u64>,
    /// [`TrialQuotaPool::key`]. Absent ⇒ `ai_credits` (see the type doc).
    #[serde(default)]
    pub pool: Option<String>,
    /// The SIGNED movement. Absent or zero ⇒ fall back to `cost`.
    #[serde(default)]
    pub delta: i64,
    pub source_node: Node,
    /// Microsecond timestamp of when the deduction happened.
    /// Used to skip messages older than the DB snapshot loaded at init.
    pub timestamp: i64,
}

impl TrialQuotaHaMsg {
    /// Which pool this message moves. Unknown or absent keys read as AI credits.
    pub fn resolved_pool(&self) -> TrialQuotaPool {
        self.pool
            .as_deref()
            .and_then(TrialQuotaPool::from_key)
            .unwrap_or(TrialQuotaPool::AiCredits)
    }

    /// The signed movement, reading `cost` when `delta` is absent.
    pub fn resolved_delta(&self) -> i64 {
        if self.delta != 0 {
            self.delta
        } else {
            i64::try_from(self.cost).unwrap_or(i64::MAX)
        }
    }
}

/// Build the HA message for one signed movement of one pool.
fn ha_msg(
    org_id: &str,
    pool: TrialQuotaPool,
    delta: i64,
    usage_limit: Option<u64>,
) -> TrialQuotaHaMsg {
    TrialQuotaHaMsg {
        org_id: org_id.to_string(),
        cost: u64::try_from(delta.max(0)).unwrap_or(0),
        usage_limit,
        pool: Some(pool.key().to_string()),
        delta,
        source_node: LOCAL_NODE.clone(),
        timestamp: config::utils::time::now_micros(),
    }
}

/// Apply one remote HA message to the local counters and limits. Split out of
/// [`subscribe_ha_queue`] so §6.2 propagation is testable without NATS.
fn apply_ha_msg(msg: &TrialQuotaHaMsg) -> (u64, u64) {
    let pool = msg.resolved_pool();
    if let Some(usage_limit) = msg.usage_limit {
        set_cached_limit(&msg.org_id, pool, usage_limit);
    }
    let old = get_pool_used(&msg.org_id, pool);
    let delta = msg.resolved_delta();
    let new_total = if delta != 0 {
        apply_to_pool_counter(&msg.org_id, pool, delta)
    } else {
        old
    };
    (old, new_total)
}

/// Persist and publish an explicit lifetime limit for one of an organization's
/// pools (§6.2). Re-opens an exhausted org immediately and everywhere — DB
/// write, local cache, HA broadcast — with **no restart** (T32/E17).
pub async fn set_limit_for_pool(
    org_id: &str,
    pool: TrialQuotaPool,
    usage_limit: u64,
) -> Result<(), anyhow::Error> {
    let previous_limit = get_pool_limit(org_id, pool);
    let db_limit = i64::try_from(usage_limit)
        .map_err(|_| anyhow::anyhow!("credit limit exceeds the supported maximum"))?;
    infra::table::trial_quota_usage::set_usage_limit_for_org(
        org_id,
        pool.seed_feature(),
        pool.feature_keys(),
        db_limit,
    )
    .await?;
    if usage_limit > previous_limit {
        reset_checkpoint(org_id).await;
    }
    set_cached_limit(org_id, pool, usage_limit);

    if !LOCAL_NODE.is_single_node()
        && let Err(err) = publish_ha_msg(&ha_msg(org_id, pool, 0, Some(usage_limit))).await
    {
        log::warn!(
            "[TRIAL_QUOTA] Failed to broadcast limit update for org={org_id} pool={}; periodic reconciliation will apply it: {err}",
            pool.key(),
        );
    }
    Ok(())
}

/// Persist and publish an explicit lifetime AI credit limit for an org — the
/// AI-pool spelling of [`set_limit_for_pool`], which is what the `_meta` admin
/// endpoint means by "credits".
pub async fn set_limit(org_id: &str, usage_limit: u64) -> Result<(), anyhow::Error> {
    set_limit_for_pool(org_id, TrialQuotaPool::AiCredits, usage_limit).await
}

/// Reconcile explicit limits from the database. This runs on the existing
/// flush interval so missed or out-of-order HA messages remain short-lived.
///
/// Folded per POOL, not per org: taking the max across ALL of an org's rows
/// would let a raised AI limit silently raise the synthetics grant.
pub async fn refresh_limits_from_db() {
    match infra::table::trial_quota_usage::load_all_usage_limits().await {
        Ok(rows) => {
            let mut limits: HashMap<String, u64> = HashMap::new();
            for (org_id, feature, limit) in rows {
                let Some(pool) = TrialQuotaPool::from_key_of_feature(&feature) else {
                    continue;
                };
                let Ok(limit) = u64::try_from(limit) else {
                    continue;
                };
                limits
                    .entry(scope(&org_id, pool))
                    .and_modify(|current| *current = (*current).max(limit))
                    .or_insert(limit);
            }
            *ORG_LIMITS.write().unwrap() = limits;
        }
        Err(err) => {
            log::warn!("[TRIAL_QUOTA] Failed to refresh organization limits: {err}");
        }
    }
}

/// Try to deduct one unit of a feature from its org pool.
///
/// Returns `Ok(remaining)` on success, or `Err(QuotaExhaustedError)` when
/// the pool is depleted.
///
/// The limit check is against total usage across every feature IN THAT POOL,
/// not per-feature and not across pools; the DB still tracks per feature.
pub async fn try_deduct(
    org_id: &str,
    feature: TrialQuotaFeature,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    log::info!(
        "[TRIAL_QUOTA] try_deduct called: org={org_id} feature={feature} cost={} pool_limit={}",
        feature.cost(),
        get_pool_limit(org_id, feature.pool()),
    );
    try_deduct_units(org_id, feature, 1)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
}

/// Deduct `units x feature.cost()` from the feature's pool, all or nothing.
/// Returns the REMAINING units in the pool on success.
///
/// Synchronous on purpose: the synthetics enqueue path reaches this through a
/// function-pointer hook that cannot be `dyn`-safe and async at once.
pub fn try_deduct_units(
    org_id: &str,
    feature: TrialQuotaFeature,
    units: u64,
) -> Result<u64, QuotaExhaustedError> {
    let pool = feature.pool();
    let cost = feature.cost().saturating_mul(units);
    let pool_limit = get_pool_limit(org_id, pool);
    let key = scope(org_id, pool);

    ensure_scope_counter(&key);

    let map = ORG_USAGE.read().unwrap();
    let Some(counter) = map.get(&key) else {
        // Unreachable (`ensure_scope_counter` just ran). Treated as "no room"
        // rather than unwrapped: a panic here kills the scheduler tick.
        return Err(QuotaExhaustedError {
            usage_count: 0,
            usage_limit: pool_limit,
        });
    };

    loop {
        let current = counter.load(Ordering::Relaxed);
        let new_total = current.saturating_add(cost);
        if new_total > pool_limit {
            log::info!(
                "[TRIAL_QUOTA] quota exhausted: org={org_id} pool={} feature={feature} current_used={current} cost={cost} pool_limit={pool_limit}",
                pool.key(),
            );
            return Err(QuotaExhaustedError {
                usage_count: current,
                usage_limit: pool_limit,
            });
        }
        if counter
            .compare_exchange(current, new_total, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            drop(map);
            log::debug!(
                "[TRIAL_QUOTA] deducted: org={org_id} pool={} feature={feature} cost={cost} total_used={new_total}/{pool_limit}",
                pool.key(),
            );
            let signed = i64::try_from(cost).unwrap_or(i64::MAX);
            buffer_flush(org_id, feature, signed);
            broadcast_delta_detached(org_id, pool, signed);
            return Ok(pool_limit - new_total);
        }
    }
}

/// Deduct `units` and NEVER refuse — SPEC §6.3 / E14: a top-up that would
/// exhaust the pool mid-run is still recorded, so `usage_count` can pass
/// `usage_limit` and the next [`try_deduct_units`] is what fails (T28).
pub fn force_deduct_units(org_id: &str, feature: TrialQuotaFeature, units: u64) -> u64 {
    let cost = feature.cost().saturating_mul(units);
    let signed = i64::try_from(cost).unwrap_or(i64::MAX);
    let total = apply_to_pool_counter(org_id, feature.pool(), signed);
    buffer_flush(org_id, feature, signed);
    broadcast_delta_detached(org_id, feature.pool(), signed);
    total
}

/// Give `units` back to the pool, saturating at zero.
pub fn refund_units(org_id: &str, feature: TrialQuotaFeature, units: u64) -> u64 {
    let cost = feature.cost().saturating_mul(units);
    let signed = -i64::try_from(cost).unwrap_or(i64::MAX);
    let total = apply_to_pool_counter(org_id, feature.pool(), signed);
    buffer_flush(org_id, feature, signed);
    broadcast_delta_detached(org_id, feature.pool(), signed);
    total
}

/// Apply one [`PoolAdjustment`] AT MOST ONCE for `idempotency_key` — SPEC §6.3.
///
/// `false` means this key was already applied in this process (T27). The caller
/// builds the key and it MUST identify the run:
/// `(synthetics_id, location, scheduled_ts, job_id)` — see [`IdempotencyLedger`].
pub fn apply_pool_adjustment(
    org_id: &str,
    feature: TrialQuotaFeature,
    adjustment: PoolAdjustment,
    idempotency_key: &str,
) -> bool {
    if !ADJUSTMENTS.claim(idempotency_key) {
        log::debug!(
            "[TRIAL_QUOTA] pool adjustment already applied, skipping: org={org_id} key={idempotency_key}"
        );
        return false;
    }
    match adjustment {
        PoolAdjustment::Refund(units) => refund_units(org_id, feature, units),
        PoolAdjustment::TopUp(units) => force_deduct_units(org_id, feature, units),
    };
    true
}

/// Buffer one SIGNED usage movement for the periodic DB flush.
///
/// ⚠️ §11 **F8**: the channel is bounded at 10,000 and `try_send` DROPS on
/// overflow. Only the DB half is lost — this node keeps enforcing the right
/// number until it restarts, when `init_from_db` reloads a total short by the
/// dropped amount and the org silently gets those units back. Under a one-time
/// grant that is permanent. Nothing replays it (fire-and-forget, no ack); §9B.3
/// reconciles `_usage` against `trial_quota_usage.usage_count`, and **A5**/**A8**
/// page on the drop and on the divergence.
fn buffer_flush(org_id: &str, feature: TrialQuotaFeature, cost: i64) {
    if let Err(e) = FLUSH_TX.try_send(FlushRecord {
        org_id: org_id.to_string(),
        feature_key: feature.feature_key().to_string(),
        cost,
    }) {
        record_flush_drop(org_id, feature, cost, &e);
    }
}

/// SPEC §9B.1 row 9 / §9B.2 alert **A5** — one pool movement lost on its way
/// to the database.
///
/// The `log::error!` alone cannot be alerted on: A5 is a threshold on a number
/// that is normally zero, which needs a series. Labelled by
/// `trial_quota_usage.feature` so §6.1's one-time synthetics grant alerts
/// separately from AI credits — an AI credit lost to a full channel comes back,
/// a synthetics step does not — and NOT by org, since org ids are
/// customer-chosen. This only COUNTS the loss; §11 **F8** is still open.
fn record_flush_drop(
    org_id: &str,
    feature: TrialQuotaFeature,
    cost: i64,
    error: &dyn std::fmt::Display,
) {
    config::metrics::TRIAL_QUOTA_FLUSH_DROPS_TOTAL
        .with_label_values(&[feature.feature_key()])
        .inc();
    // A5: ERROR because under a one-time grant the loss is permanent.
    log::error!(
        "[TRIAL_QUOTA] Flush channel full, DROPPING pool record for org={org_id} feature={feature} cost={cost}: {error}"
    );
}

/// Broadcast a signed pool movement to the other nodes. Skipped in single-node
/// mode — there is nobody to tell.
async fn broadcast_delta(org_id: &str, pool: TrialQuotaPool, delta: i64) {
    if LOCAL_NODE.is_single_node() || delta == 0 {
        return;
    }
    if let Err(e) = publish_ha_msg(&ha_msg(org_id, pool, delta, None)).await {
        log::warn!(
            "[TRIAL_QUOTA] Failed to broadcast delta for org={org_id} pool={}: {e}",
            pool.key(),
        );
    }
}

/// Broadcast a signed pool movement from a synchronous caller. `try_current`
/// rather than `Handle::current`: a unit test moving the counter has no
/// reactor, and a panic there would fail the test for the wrong reason.
fn broadcast_delta_detached(org_id: &str, pool: TrialQuotaPool, delta: i64) {
    if LOCAL_NODE.is_single_node() || delta == 0 {
        return;
    }
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    let org_id = org_id.to_string();
    handle.spawn(async move { broadcast_delta(&org_id, pool, delta).await });
}

// ---------------------------------------------------------------------------
// Periodic DB flush
// ---------------------------------------------------------------------------

/// Drain the flush channel and batch-upsert to DB.
/// Called periodically by the background job in `cloud.rs`.
pub async fn flush_to_db() {
    let rx_ref = match FLUSH_RX.get() {
        Some(rx) => rx,
        None => {
            // Channel not initialized yet (FLUSH_TX not accessed).
            // Force initialization by touching the sender.
            let _ = &*FLUSH_TX;
            match FLUSH_RX.get() {
                Some(rx) => rx,
                None => return,
            }
        }
    };

    // Drain all pending records under a brief lock
    let mut records: Vec<FlushRecord> = Vec::new();
    {
        let mut rx = rx_ref.lock().await;
        while let Ok(record) = rx.try_recv() {
            records.push(record);
        }
    }

    if records.is_empty() {
        return;
    }

    // Coalesce: sum costs per (org_id, feature_key)
    let mut coalesced: HashMap<(String, String), i64> = HashMap::new();
    for r in &records {
        *coalesced
            .entry((r.org_id.clone(), r.feature_key.clone()))
            .or_default() += r.cost;
    }

    let batch: Vec<(String, String, i64)> = coalesced
        .into_iter()
        .map(|((org_id, feature_key), cost)| (org_id, feature_key, cost))
        .collect();

    let batch_len = batch.len();
    log::info!(
        "[TRIAL_QUOTA] flushing {} coalesced records to DB (from {} raw)",
        batch_len,
        records.len(),
    );

    if let Err(e) = infra::table::trial_quota_usage::batch_increment(batch).await {
        log::error!("[TRIAL_QUOTA] Failed to flush quota to DB: {e}");
    }
}

// ---------------------------------------------------------------------------
// Cluster sync via dedicated NATS queue (delta-based)
// ---------------------------------------------------------------------------

/// Publish a delta message to the HA queue.
async fn publish_ha_msg(msg: &TrialQuotaHaMsg) -> Result<(), anyhow::Error> {
    let payload = Bytes::from(json::to_vec(msg).map_err(|e| anyhow::anyhow!("{e}"))?);
    let q = infra::queue::get_queue().await;
    q.publish(TRIAL_QUOTA_HA_QUEUE, payload)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
}

/// Subscribe to the HA queue and apply remote deltas to local counters.
/// Each message carries a usage delta or an explicit limit. Messages from self
/// are skipped. Usage deltas are atomically added to the local counter.
///
/// Must run on ALL cloud nodes. Skipped in single-node mode.
pub async fn subscribe_ha_queue() {
    if LOCAL_NODE.is_single_node() {
        log::info!("[TRIAL_QUOTA] Single node mode, skipping HA queue subscriber");
        return;
    }

    let q = infra::queue::get_queue().await;
    if let Err(e) = q.create(TRIAL_QUOTA_HA_QUEUE).await {
        log::error!("[TRIAL_QUOTA] Failed to create HA queue: {e}");
        return;
    }

    // DeliverPolicy::All — replay all messages, but skip any with timestamp
    // <= INIT_WATERMARK (those are already reflected in the DB snapshot).
    // This ensures we don't miss deltas published between init_from_db and
    // subscribe, while avoiding double-counting old messages.
    let mut receiver = match q
        .consume(TRIAL_QUOTA_HA_QUEUE, Some(infra::queue::DeliverPolicy::All))
        .await
    {
        Ok(rx) => rx,
        Err(e) => {
            log::error!("[TRIAL_QUOTA] Failed to consume from HA queue: {e}");
            return;
        }
    };

    let rx = match Arc::get_mut(&mut receiver) {
        Some(rx) => rx,
        None => {
            log::error!("[TRIAL_QUOTA] Failed to get mutable receiver for HA queue");
            return;
        }
    };

    log::info!("[TRIAL_QUOTA] HA queue subscriber started");

    while let Some(msg) = rx.recv().await {
        let payload = msg.message();
        let ha_msg: TrialQuotaHaMsg = match json::from_slice(payload) {
            Ok(m) => m,
            Err(e) => {
                log::error!("[TRIAL_QUOTA] Failed to deserialize HA message: {e}");
                if let Err(e) = msg.ack().await {
                    log::error!("[TRIAL_QUOTA] Failed to ack HA message: {e}");
                }
                continue;
            }
        };

        // Skip messages from self — we already applied the deduction locally
        if ha_msg.source_node.eq(&LOCAL_NODE) {
            if let Err(e) = msg.ack().await {
                log::error!("[TRIAL_QUOTA] Failed to ack HA message: {e}");
            }
            continue;
        }

        // Skip messages older than the DB snapshot — already counted in init_from_db
        let watermark = INIT_WATERMARK.load(Ordering::Relaxed);
        if ha_msg.timestamp <= watermark {
            log::debug!(
                "[TRIAL_QUOTA] Skipping stale HA message: org={} ts={} watermark={}",
                ha_msg.org_id,
                ha_msg.timestamp,
                watermark,
            );
            if let Err(e) = msg.ack().await {
                log::error!("[TRIAL_QUOTA] Failed to ack HA message: {e}");
            }
            continue;
        }

        let (old, new_total) = apply_ha_msg(&ha_msg);

        log::info!(
            "[TRIAL_QUOTA] HA sync: org={} pool={} delta={} limit={:?} total {}->{}",
            ha_msg.org_id,
            ha_msg.resolved_pool().key(),
            ha_msg.resolved_delta(),
            ha_msg.usage_limit,
            old,
            new_total,
        );

        if let Err(e) = msg.ack().await {
            log::error!("[TRIAL_QUOTA] Failed to ack HA message: {e}");
        }
    }

    log::warn!("[TRIAL_QUOTA] HA queue subscriber ended");
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/// Get remaining units in one of the org's pools.
pub fn get_remaining_for_pool(org_id: &str, pool: TrialQuotaPool) -> u64 {
    get_pool_limit(org_id, pool).saturating_sub(get_pool_used(org_id, pool))
}

/// Get total units used in one of the org's pools.
pub fn get_used_for_pool(org_id: &str, pool: TrialQuotaPool) -> u64 {
    get_pool_used(org_id, pool)
}

/// Get one pool's limit for an org, falling back to the deployment-wide default.
pub fn get_limit_for_pool(org_id: &str, pool: TrialQuotaPool) -> u64 {
    get_pool_limit(org_id, pool)
}

/// Get remaining credits in the org's AI pool.
pub fn get_remaining(org_id: &str) -> u64 {
    get_remaining_for_pool(org_id, TrialQuotaPool::AiCredits)
}

/// Get total AI credits used across the AI features for an org.
pub fn get_used(org_id: &str) -> u64 {
    get_used_for_pool(org_id, TrialQuotaPool::AiCredits)
}

/// Get the AI pool limit for an org, falling back to the deployment default.
pub fn get_limit(org_id: &str) -> u64 {
    get_limit_for_pool(org_id, TrialQuotaPool::AiCredits)
}

// Synthetics free step pool — SPEC §6. Plain `fn`, no async and no trait
// objects: `openobserve-synthetics` reaches these through a struct of function
// pointers and must NOT depend on `openobserve-core`; `openobserve-jobs` wires
// the two together.

/// The grant a check of this kind spends from. Browser and protocol hold separate
/// one-time pools: a browser step costs ~52x a protocol one, so a shared grant let
/// the org's mix decide our free-tier cost.
fn synthetics_pool(is_browser: bool) -> TrialQuotaPool {
    if is_browser {
        TrialQuotaPool::SyntheticsBrowserSteps
    } else {
        TrialQuotaPool::SyntheticsProtocolSteps
    }
}

fn synthetics_feature(is_browser: bool) -> TrialQuotaFeature {
    if is_browser {
        TrialQuotaFeature::SyntheticsBrowserSteps
    } else {
        TrialQuotaFeature::SyntheticsProtocolSteps
    }
}

/// Steps left in the org's one-time synthetics grant for this check kind (§6.1).
pub fn synthetics_steps_remaining(org_id: &str, is_browser: bool) -> u64 {
    get_remaining_for_pool(org_id, synthetics_pool(is_browser))
}

/// Reserve `steps` from the org's synthetics grant — all or nothing. `false`
/// means the grant cannot cover this run (§7.1 gate 3).
pub fn synthetics_steps_try_deduct(org_id: &str, is_browser: bool, steps: u64) -> bool {
    try_deduct_units(org_id, synthetics_feature(is_browser), steps).is_ok()
}

/// Give `steps` back — the enqueue never happened (E10/E11, T29).
pub fn synthetics_steps_refund(org_id: &str, is_browser: bool, steps: u64) {
    refund_units(org_id, synthetics_feature(is_browser), steps);
}

/// Give back the reservation of a job that will NEVER ack — SPEC §6.3, E10.
///
/// Keyed, because the reaper scan can be re-entered. The direction is fixed at
/// [`PoolAdjustment::Refund`] HERE rather than at each wiring site — inverting
/// it turns a refund into a second charge against a grant the org can never get
/// back. `false` means the key was already used.
pub fn synthetics_steps_dead_letter_refund(
    org_id: &str,
    is_browser: bool,
    steps: u64,
    idempotency_key: &str,
) -> bool {
    apply_pool_adjustment(
        org_id,
        synthetics_feature(is_browser),
        PoolAdjustment::Refund(steps),
        idempotency_key,
    )
}

/// Apply one idempotent ack-side reconcile — SPEC §6.3.
pub fn synthetics_steps_adjust(
    org_id: &str,
    is_browser: bool,
    adjustment: PoolAdjustment,
    idempotency_key: &str,
) -> bool {
    apply_pool_adjustment(
        org_id,
        synthetics_feature(is_browser),
        adjustment,
        idempotency_key,
    )
}

/// Serializable request body for AI usage events.
/// Fields that are None are omitted from the JSON output.
#[derive(Serialize)]
struct AiUsageRequestBody<'a> {
    feature: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    incident_id: Option<&'a str>,
}

/// Context for AI usage events — carries traceability info.
#[derive(Default, Clone)]
pub struct AiUsageContext {
    pub user_email: String,
    pub trace_id: Option<String>,
    pub session_id: Option<String>,
    pub incident_id: Option<String>,
}

/// Record AI usage to the _usage stream.
///
/// Writes TWO events:
/// 1. Credit event (`AiFreeCredits` or `AiCredits`) with `size = credit_cost`
/// 2. Feature event (AiChat/NewIncident/IncidentReAnalysis) with `size = 1` — for FE breakdown
///
/// `AiFreeCredits` is informational (not billed). `AiCredits` is picked up by the
/// metering pipeline and reported to Stripe/AWS/Azure.
fn record_usage_internal(
    org_id: &str,
    ctx: &AiUsageContext,
    feature: TrialQuotaFeature,
    billable: bool,
) {
    let now = Utc::now();
    let timestamp = now.timestamp_micros();
    let event_time_hour = format!(
        "{:04}{:02}{:02}{:02}",
        now.year(),
        now.month(),
        now.day(),
        now.hour()
    );

    let credit_event = UsageData {
        _timestamp: timestamp,
        event: if billable {
            UsageEvent::AiCredits
        } else {
            UsageEvent::AiFreeCredits
        },
        year: now.year(),
        month: now.month(),
        day: now.day(),
        hour: now.hour(),
        event_time_hour: event_time_hour.clone(),
        org_id: org_id.to_string(),
        request_body: serde_json::to_string(&AiUsageRequestBody {
            feature: feature.feature_key(),
            session_id: ctx.session_id.as_deref(),
            incident_id: ctx.incident_id.as_deref(),
        })
        .unwrap_or_default(),
        size: feature.cost() as f64,
        unit: "count".to_string(),
        user_email: ctx.user_email.clone(),
        response_time: 0.0,
        stream_type: StreamType::Logs,
        num_records: 1,
        dropped_records: 0,
        stream_name: String::new(),
        trace_id: ctx.trace_id.clone(),
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
        dashboard_info: None,
        peak_memory_usage: None,
        region: None,
    };

    // Feature breakdown event (informational, not billed)
    let mut events = vec![credit_event.clone()];
    if let Some(event) = feature.usage_event() {
        events.push(UsageData {
            event,
            size: 1.0,
            unit: "count".to_string(),
            ..credit_event
        });
    }

    usage_reporting::report_usage(events);
}

/// Record free credit usage (all orgs). Writes `AiFreeCredits` — not billed.
pub fn record_free_ai_usage(org_id: &str, ctx: &AiUsageContext, feature: TrialQuotaFeature) {
    record_usage_internal(org_id, ctx, feature, false);
}

/// Record billable PAYG usage (paid orgs only). Writes `AiCredits` — billed to Stripe.
pub fn record_billable_ai_usage(org_id: &str, ctx: &AiUsageContext, feature: TrialQuotaFeature) {
    record_usage_internal(org_id, ctx, feature, true);
}

/// AI usage response for the API
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AiUsageResponse {
    pub mode: String,
    pub credits_used: u64,
    pub credits_limit: u64,
    pub credits_remaining: u64,
    pub requires_additional_credits: bool,
}

/// One pool's usage for an org. Field names are unit-neutral because AI counts
/// credits and synthetics counts steps.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PoolUsageResponse {
    /// Stable pool identifier — `"ai_credits"` or `"synthetics_steps"`.
    pub pool: String,
    /// `"free"` | `"pay_as_you_go"` | `"exhausted"`.
    pub mode: String,
    pub used: u64,
    pub limit: u64,
    pub remaining: u64,
    pub requires_additional_credits: bool,
}

/// Get one pool's usage for an org. Uses the greater of persisted and
/// in-memory usage so a pending flush is never reported as unspent. The
/// exhaustion policy is a property of the org's billing, not of the pool, so
/// the AI-named resolver is correct for every pool.
pub async fn get_pool_usage(org_id: &str, pool: TrialQuotaPool) -> PoolUsageResponse {
    let limit = get_pool_limit(org_id, pool);
    let in_memory_used = get_pool_used(org_id, pool);

    // Scoped to THIS pool's feature rows: summing every row of the org would
    // report synthetics step consumption as AI credits used.
    let db_used = match infra::table::trial_quota_usage::get_total_usage_for_org(
        org_id,
        pool.feature_keys(),
    )
    .await
    {
        Ok(total) => {
            log::info!(
                "[TRIAL_QUOTA] get_pool_usage: org={} pool={} db_total={} in_memory_total={} pool_limit={}",
                org_id,
                pool.key(),
                total,
                in_memory_used,
                limit,
            );
            // Clamped: a refund flushes as a NEGATIVE delta with no portable
            // SQL floor, and `as u64` on it reads as 18 quintillion used.
            total.max(0) as u64
        }
        Err(e) => {
            log::warn!(
                "[TRIAL_QUOTA] get_pool_usage: org={} pool={} DB read failed (falling back to cache={}): {e}",
                org_id,
                pool.key(),
                in_memory_used,
            );
            in_memory_used
        }
    };

    let used = db_used.max(in_memory_used);
    let remaining = limit.saturating_sub(used);
    let exhaustion_policy = if remaining == 0 {
        Some(
            o2_enterprise::enterprise::cloud::ai_credits::resolve_ai_credit_exhaustion_policy(
                org_id,
            )
            .await,
        )
    } else {
        None
    };
    let requires_additional_credits =
        exhaustion_policy.is_some_and(|policy| policy.requires_additional_credits());

    let mode = match exhaustion_policy {
        None => "free",
        Some(policy) if policy.allows_metered_overage() => "pay_as_you_go",
        Some(_) => "exhausted",
    };

    PoolUsageResponse {
        pool: pool.key().to_string(),
        mode: mode.to_string(),
        used,
        limit,
        remaining,
        requires_additional_credits,
    }
}

impl From<PoolUsageResponse> for AiUsageResponse {
    fn from(usage: PoolUsageResponse) -> Self {
        Self {
            mode: usage.mode,
            credits_used: usage.used,
            credits_limit: usage.limit,
            credits_remaining: usage.remaining,
            requires_additional_credits: usage.requires_additional_credits,
        }
    }
}

/// AI usage in the `credits_*` field names the AI route and UI consume.
pub async fn get_usage(org_id: &str) -> AiUsageResponse {
    get_pool_usage(org_id, TrialQuotaPool::AiCredits)
        .await
        .into()
}

/// Get the current usage percentage for an org (0–100, clamped).
pub fn get_quota_percentage(org_id: &str) -> u8 {
    let pool = TrialQuotaPool::AiCredits;
    let limit = get_pool_limit(org_id, pool);
    if limit == 0 {
        return 100;
    }
    let used = get_pool_used(org_id, pool);
    let pct = (used * 100 / limit).min(100);
    pct as u8
}

/// Returns the next checkpoint to notify for the org, or None if already notified.
///
/// Walks the QUOTA_CHECKPOINTS list and returns the highest checkpoint that
/// the org's usage has reached but hasn't been notified about yet.
pub async fn get_pending_checkpoint(org_id: &str) -> Option<u8> {
    let pct = get_quota_percentage(org_id);
    let already_notified = infra::table::trial_quota_usage::get_notified_checkpoint(org_id)
        .await
        .unwrap_or(0) as u8;
    pending_checkpoint_from(pct, already_notified)
}

/// Compute the pending checkpoint given a pre-fetched usage percentage and
/// already-notified level. This is the DB-free, sync part of
/// `get_pending_checkpoint` — used by `check_all_orgs_ai_quota` which
/// pre-fetches all checkpoints in a single query to avoid N+1 DB round-trips.
pub fn pending_checkpoint_from(pct: u8, already_notified: u8) -> Option<u8> {
    // Find the highest checkpoint that the org has reached
    let mut highest_reached: Option<u8> = None;
    for &cp in QUOTA_CHECKPOINTS {
        if pct >= cp && cp > already_notified {
            highest_reached = Some(cp);
        }
    }
    highest_reached
}

/// Atomically mark a checkpoint as notified for an org in the DB.
/// Returns true if this pod won the update (no other pod set it first).
pub async fn mark_checkpoint_notified(org_id: &str, checkpoint: u8) -> bool {
    match infra::table::trial_quota_usage::update_notified_checkpoint(org_id, checkpoint as i16)
        .await
    {
        Ok(updated) => updated,
        Err(e) => {
            log::error!("[AI_QUOTA] Failed to persist checkpoint for org={org_id}: {e}");
            false
        }
    }
}

/// Reset checkpoint tracking for an org (e.g., when credits are refilled).
pub async fn reset_checkpoint(org_id: &str) {
    if let Err(e) = infra::table::trial_quota_usage::reset_notified_checkpoint(org_id).await {
        log::error!("[AI_QUOTA] Failed to reset checkpoint for org={org_id}: {e}");
    }
}

/// Fold `trial_quota_usage` rows into per-`(org, pool)` totals and limits, both
/// keyed by [`scope`]. Split out of [`init_from_db`] so the row-to-pool
/// decision is testable without a database.
fn fold_db_records(
    records: &[infra::table::entity::trial_quota_usage::Model],
) -> (HashMap<String, u64>, HashMap<String, u64>) {
    // Sum per-feature counts into per-POOL totals; folding per ORG is what made
    // the two grants one.
    let mut totals: HashMap<String, u64> = HashMap::new();
    let mut limits: HashMap<String, u64> = HashMap::new();
    for record in records {
        // A row this build does not recognise belongs to a pool it does not
        // have; counting it against another pool spends the wrong grant.
        let Some(pool) = TrialQuotaPool::from_key_of_feature(&record.feature) else {
            continue;
        };
        let key = scope(&record.org_id, pool);
        // A refund flushes as a NEGATIVE delta added verbatim, so a row can sit
        // below zero. Read as zero rather than wrapped into an astronomical
        // `u64` that would exhaust the org forever.
        *totals.entry(key.clone()).or_default() += record.usage_count.max(0) as u64;
        if let Some(limit) = record.usage_limit
            && let Ok(limit) = u64::try_from(limit)
        {
            limits
                .entry(key)
                .and_modify(|current| *current = (*current).max(limit))
                .or_insert(limit);
        }
    }
    (totals, limits)
}

/// Initialize quota from DB on node startup.
/// Loads all quota records into the in-memory counters.
pub async fn init_from_db() {
    match infra::table::trial_quota_usage::load_all().await {
        Ok(records) => {
            // Find the max updated_at across all rows — this is our watermark.
            // NATS messages with timestamp <= this are already in the DB snapshot.
            let max_updated_at = records.iter().map(|r| r.updated_at).max().unwrap_or(0);
            INIT_WATERMARK.store(max_updated_at, Ordering::Relaxed);

            let (scope_totals, scope_limits) = fold_db_records(&records);

            {
                let mut map = ORG_USAGE.write().unwrap();
                for (key, total) in scope_totals {
                    map.insert(key, AtomicU64::new(total));
                }
            }
            *ORG_LIMITS.write().unwrap() = scope_limits;

            log::info!(
                "[TRIAL_QUOTA] Loaded {} quota records from DB, watermark={}",
                records.len(),
                max_updated_at,
            );
        }
        Err(e) => {
            log::error!("[TRIAL_QUOTA] Failed to load quota from DB: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These exercise process-global counters, so every test owns a UNIQUE org
    // id — sharing one makes them order-dependent under `cargo test`'s
    // parallelism.

    /// A per-test org with an explicit pool size, not the deployment default.
    fn steps_org(name: &str, limit: u64) -> String {
        let org_id = format!("pool-test-{name}");
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsBrowserSteps, limit);
        org_id
    }

    const STEPS: TrialQuotaFeature = TrialQuotaFeature::SyntheticsBrowserSteps;

    /// `TrialQuotaFeature::pool` and `TrialQuotaPool::feature_keys` MUST agree,
    /// or a feature deducts from one pool and reports into another in the table.
    #[test]
    fn every_feature_is_listed_by_its_own_pool() {
        for feature in [
            TrialQuotaFeature::AiChat,
            TrialQuotaFeature::NewIncident,
            TrialQuotaFeature::IncidentReAnalysis,
            TrialQuotaFeature::SyntheticsBrowserSteps,
        ] {
            let pool = feature.pool();
            assert!(
                pool.feature_keys().contains(&feature.feature_key()),
                "{feature} deducts from {} but is not one of its feature_keys",
                pool.key(),
            );
            assert_eq!(
                TrialQuotaPool::from_key_of_feature(feature.feature_key()),
                Some(pool),
                "{feature} must resolve back to its own pool from the DB key",
            );
        }
    }

    #[test]
    fn pool_keys_round_trip_and_unknown_keys_are_rejected() {
        for pool in [
            TrialQuotaPool::AiCredits,
            TrialQuotaPool::SyntheticsBrowserSteps,
        ] {
            assert_eq!(TrialQuotaPool::from_key(pool.key()), Some(pool));
        }
        assert_eq!(TrialQuotaPool::from_key("ingest"), None);
        // A key a NEWER node writes must not be folded into a pool this build has.
        assert_eq!(TrialQuotaPool::from_key_of_feature("future_feature"), None);
    }

    #[test]
    fn ai_and_synthetics_pools_do_not_drain_each_other() {
        let org_id = format!("pool-test-{}", "isolation");
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsBrowserSteps, 100);
        set_cached_limit(&org_id, TrialQuotaPool::AiCredits, 100);

        assert!(try_deduct_units(&org_id, STEPS, 100).is_ok());
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );

        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::AiCredits),
            100
        );
        assert!(try_deduct_units(&org_id, TrialQuotaFeature::AiChat, 1).is_ok());

        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            100
        );
    }

    #[test]
    fn scope_keys_cannot_collide_across_orgs_or_pools() {
        assert_ne!(
            scope("acme", TrialQuotaPool::AiCredits),
            scope("acme", TrialQuotaPool::SyntheticsBrowserSteps),
        );
        assert_ne!(
            scope("acme", TrialQuotaPool::AiCredits),
            scope("acme_ai_credits", TrialQuotaPool::AiCredits),
        );
    }

    /// §4.2: this path must emit NO step event. It cannot know browser from
    /// protocol, and guessing would invoice at the wrong rate — the real events
    /// come from `job_api::events_for_ack`.
    #[test]
    fn synthetics_feature_emits_no_step_event_of_its_own() {
        assert_eq!(STEPS.usage_event(), None);
        assert_eq!(STEPS.feature_key(), "synthetics_browser_steps");
        assert_eq!(STEPS.pool(), TrialQuotaPool::SyntheticsBrowserSteps);
        // One unit is one step; any per-step cost but 1 rescales the §6.1 grant.
        assert_eq!(STEPS.cost(), 1);
    }

    #[test]
    fn t25_ack_billing_less_than_reserved_refunds_the_difference() {
        let org_id = steps_org("t25", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_ok());
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            14
        );

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            "t25|job-1"
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            4
        );
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            996
        );
    }

    #[test]
    fn t25_refund_is_idempotent() {
        let org_id = steps_org("t25-idem", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_ok());

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            "t25-idem|job-1"
        ));
        assert!(!synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            "t25-idem|job-1"
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            4
        );
    }

    #[test]
    fn t26_ack_billing_more_than_reserved_tops_up_the_difference() {
        let org_id = steps_org("t26", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_ok());

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::TopUp(4),
            "t26|job-1"
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            18
        );
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            982
        );
    }

    #[test]
    fn t26_top_up_is_idempotent() {
        let org_id = steps_org("t26-idem", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_ok());

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::TopUp(4),
            "t26-idem|job-1"
        ));
        assert!(!synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::TopUp(4),
            "t26-idem|job-1"
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            18
        );
    }

    /// **E10** — the reaper's refund gives steps BACK, and gives them back once.
    /// The direction is the one thing no compiler can check: inverting it
    /// charges the grant a second time instead of crediting it.
    #[test]
    fn e10_a_dead_letter_refund_credits_the_grant_and_is_idempotent() {
        let org_id = steps_org("e10-reaper", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 28).is_ok());
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            28
        );

        // Distinct per test: the ledger is process-global.
        let key = "chk_1\u{1f}aws-us-east-1\u{1f}1787665631000000\u{1f}job-reaper";
        assert!(synthetics_steps_dead_letter_refund(&org_id, true, 28, key));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0,
            "a refund must give the reservation BACK — a top-up here would charge the org twice \
             for a run that never happened",
        );

        assert!(!synthetics_steps_dead_letter_refund(&org_id, true, 28, key));
        assert!(!synthetics_steps_dead_letter_refund(&org_id, true, 28, key));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    /// The reaper and the ack share ONE ledger and ONE key shape, so a job that
    /// reached both paths moves the grant once — only while both build the SAME
    /// key.
    #[test]
    fn a_reaper_refund_and_an_ack_reconcile_under_one_key_apply_once() {
        let org_id = steps_org("e10-onekey", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 28).is_ok());

        let key = "chk_1\u{1f}aws-us-east-1\u{1f}1787665631000000\u{1f}job-onekey";
        assert!(synthetics_steps_dead_letter_refund(&org_id, true, 28, key));
        assert!(
            !synthetics_steps_adjust(&org_id, true, PoolAdjustment::Refund(28), key),
            "the ack-side reconcile must find the reaper's key already applied",
        );
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    /// T27 — a key that swallowed everything would pass the first half and
    /// silently stop billing, so a DIFFERENT run's adjustment must still apply.
    #[test]
    fn t27_the_same_adjustment_twice_has_no_double_effect() {
        let org_id = steps_org("t27", 1_000);
        assert!(try_deduct_units(&org_id, STEPS, 28).is_ok());

        let job_a = "chk_1|us-east-1|1787665631000000|job-a";
        let job_b = "chk_1|us-east-1|1787665631000000|job-b";

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            job_a
        ));
        assert!(!synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            job_a
        ));
        assert!(!synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            job_a
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            18
        );

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::Refund(10),
            job_b
        ));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            8
        );
    }

    /// T28 / E14 — a top-up past the limit is RECORDED anyway, and enforcement
    /// lands on the next enqueue.
    #[test]
    fn t28_top_up_past_the_limit_records_and_the_next_enqueue_blocks() {
        let org_id = steps_org("t28", 20);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_ok());

        assert!(synthetics_steps_adjust(
            &org_id,
            true,
            PoolAdjustment::TopUp(12),
            "t28|job-1"
        ));
        // RECORDED, past the limit. `try_deduct_units` would have refused it.
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            26
        );
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );

        assert!(!synthetics_steps_try_deduct(&org_id, true, 1));
        let err = try_deduct_units(&org_id, STEPS, 1).unwrap_err();
        assert_eq!(err.usage_count, 26);
        assert_eq!(err.usage_limit, 20);
    }

    #[test]
    fn an_enqueue_deduct_that_does_not_fit_takes_nothing() {
        let org_id = steps_org("partial", 10);
        assert!(!synthetics_steps_try_deduct(&org_id, true, 14));
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
        assert!(synthetics_steps_try_deduct(&org_id, true, 10));
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    /// E10/E11, T29 — saturating rather than wrapping: a refund larger than the
    /// recorded usage must read as zero used, not as 18 quintillion.
    #[test]
    fn a_refund_larger_than_the_usage_saturates_at_zero() {
        let org_id = steps_org("saturate", 1_000);
        assert!(synthetics_steps_try_deduct(&org_id, true, 14));
        synthetics_steps_refund(&org_id, true, 999_999);
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            1_000
        );
    }

    /// T32 / E17 — raising the limit re-opens the org immediately, with no
    /// restart and no re-init.
    #[test]
    fn t32_raising_the_limit_reopens_an_exhausted_org_without_a_restart() {
        let org_id = steps_org("t32", 10);
        assert!(synthetics_steps_try_deduct(&org_id, true, 10));
        assert!(!synthetics_steps_try_deduct(&org_id, true, 1));

        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsBrowserSteps, 50);
        assert!(synthetics_steps_try_deduct(&org_id, true, 1));
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            39
        );
    }

    #[test]
    fn t32_the_ha_queue_carries_the_new_limit_to_every_other_node() {
        let org_id = steps_org("t32-ha", 10);
        assert!(synthetics_steps_try_deduct(&org_id, true, 10));
        assert!(!synthetics_steps_try_deduct(&org_id, true, 1));

        apply_ha_msg(&TrialQuotaHaMsg {
            org_id: org_id.clone(),
            cost: 0,
            usage_limit: Some(50),
            pool: Some(TrialQuotaPool::SyntheticsBrowserSteps.key().to_string()),
            delta: 0,
            source_node: LOCAL_NODE.clone(),
            timestamp: 1,
        });

        assert_eq!(
            get_limit_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            50
        );
        assert!(synthetics_steps_try_deduct(&org_id, true, 1));
        assert_eq!(
            get_limit_for_pool(&org_id, TrialQuotaPool::AiCredits),
            TrialQuotaPool::AiCredits.default_limit(),
        );
    }

    /// T33 / E23 — the pool is one-time, so a month boundary does nothing.
    ///
    /// The pool API takes no time input at all, so the only way a boundary could
    /// reset it is code that reads one; the next test pins that absence.
    #[test]
    fn t33_a_month_boundary_leaves_the_one_time_pool_unchanged() {
        let org_id = steps_org("t33", 100);
        assert!(synthetics_steps_try_deduct(&org_id, true, 60));
        let before = get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps);

        // None of these reads takes a timestamp, so none of them can reset.
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            before
        );
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            40
        );
        assert_eq!(
            get_limit_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            100
        );
        // A grant that reset would let 60 more through on top of 60.
        assert!(!synthetics_steps_try_deduct(&org_id, true, 41));
        assert!(synthetics_steps_try_deduct(&org_id, true, 40));
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    #[test]
    fn t33_the_pool_has_no_period_or_reset_machinery() {
        // CODE only: comments name the thing they forbid, and a guard that
        // matched them would fail on its own explanation, not on a regression.
        let source: String = include_str!("trial_quota.rs")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        // Assembled at runtime so the guard cannot match its own text.
        let banned = [
            ["period", "ym"].join("_"),
            ["monthly", "reset"].join("_"),
            ["reset", "usage"].join("_"),
            ["reset", "pool"].join("_"),
        ];
        for banned in banned {
            assert!(
                !source.contains(&banned),
                "SPEC §6.1: the pool is a one-time grant — `{banned}` would make it periodic",
            );
        }
    }

    #[test]
    fn the_ledger_claims_a_key_exactly_once() {
        let ledger = IdempotencyLedger::new(8);
        assert!(ledger.claim("a"));
        assert!(!ledger.claim("a"));
        assert!(ledger.claim("b"));
        assert_eq!(ledger.len(), 2);
    }

    #[test]
    fn the_ledger_evicts_oldest_first_and_stays_bounded() {
        let ledger = IdempotencyLedger::new(3);
        for key in ["a", "b", "c"] {
            assert!(ledger.claim(key));
        }
        assert_eq!(ledger.len(), 3);
        assert!(ledger.claim("d"));
        assert_eq!(
            ledger.len(),
            3,
            "the ledger must not grow past its capacity"
        );
        // "a" was evicted; "b", "c" and "d" are still remembered.
        assert!(ledger.claim("a"));
        assert!(!ledger.claim("c"));
        assert!(!ledger.claim("d"));
    }

    #[test]
    fn a_zero_capacity_ledger_still_remembers_one_key() {
        let ledger = IdempotencyLedger::new(0);
        assert!(ledger.claim("a"));
        assert!(!ledger.claim("a"));
    }

    fn ha(cost: u64, pool: Option<&str>, delta: i64) -> TrialQuotaHaMsg {
        TrialQuotaHaMsg {
            org_id: "acme".to_string(),
            cost,
            usage_limit: None,
            pool: pool.map(str::to_string),
            delta,
            source_node: LOCAL_NODE.clone(),
            timestamp: 1,
        }
    }

    /// A node predating item 2.1 sends neither field; it meant an AI deduction.
    #[test]
    fn an_ha_message_without_a_pool_reads_as_ai_credits() {
        let msg = ha(50, None, 0);
        assert_eq!(msg.resolved_pool(), TrialQuotaPool::AiCredits);
        assert_eq!(msg.resolved_delta(), 50);
    }

    #[test]
    fn an_ha_message_with_an_unknown_pool_reads_as_ai_credits() {
        // Not silently dropped: an unknown key is a NEWER node's pool, and
        // dropping the message would leave this node's counters permanently low.
        assert_eq!(
            ha(1, Some("something_new"), 1).resolved_pool(),
            TrialQuotaPool::AiCredits
        );
    }

    #[test]
    fn an_ha_refund_travels_as_a_negative_delta() {
        let msg = ha_msg("acme", TrialQuotaPool::SyntheticsBrowserSteps, -10, None);
        assert_eq!(msg.delta, -10);
        // `cost` is the positive part, so an old node applies nothing, not a charge.
        assert_eq!(msg.cost, 0);
        assert_eq!(msg.resolved_delta(), -10);
        assert_eq!(msg.resolved_pool(), TrialQuotaPool::SyntheticsBrowserSteps);
    }

    #[test]
    fn an_ha_deduction_is_readable_by_a_node_that_predates_pool_scoping() {
        let msg = ha_msg("acme", TrialQuotaPool::SyntheticsBrowserSteps, 14, None);
        assert_eq!(
            msg.cost, 14,
            "an old node reads `cost` and must see the deduction"
        );
        assert_eq!(msg.delta, 14);
    }

    #[test]
    fn applying_a_remote_delta_moves_only_that_pool() {
        let org_id = steps_org("ha-delta", 1_000);
        apply_ha_msg(&TrialQuotaHaMsg {
            org_id: org_id.clone(),
            cost: 14,
            usage_limit: None,
            pool: Some(TrialQuotaPool::SyntheticsBrowserSteps.key().to_string()),
            delta: 14,
            source_node: LOCAL_NODE.clone(),
            timestamp: 1,
        });
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            14
        );
        assert_eq!(get_used_for_pool(&org_id, TrialQuotaPool::AiCredits), 0);
    }

    /// The two pools have their OWN deployment-wide defaults (item 2.5), and
    /// every other pool test installs an explicit limit, so nothing else covers
    /// this path — a synthetics grant sized from the AI knob would be a tenth.
    #[test]
    fn each_pool_has_its_own_deployment_default() {
        // A never-configured org, so nothing in ORG_LIMITS answers for it.
        let org_id = "pool-test-defaults-never-configured";
        let cfg = o2_enterprise::enterprise::common::config::get_config();

        assert_eq!(
            get_limit_for_pool(org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            cfg.cloud.synthetics_free_browser_step_pool,
        );
        assert_eq!(
            get_limit_for_pool(org_id, TrialQuotaPool::SyntheticsProtocolSteps),
            cfg.cloud.synthetics_free_protocol_step_pool,
        );
        assert_eq!(
            get_limit_for_pool(org_id, TrialQuotaPool::AiCredits),
            cfg.cloud.ai_free_credit_pool,
        );
        // §6.1: 10,000 browser steps and 20,000 protocol; the AI pool is 1,000 credits.
        assert_eq!(cfg.cloud.synthetics_free_browser_step_pool, 10_000);
        assert_eq!(cfg.cloud.synthetics_free_protocol_step_pool, 20_000);
        // The three grants must not collapse onto one knob.
        assert_ne!(
            cfg.cloud.synthetics_free_browser_step_pool,
            cfg.cloud.synthetics_free_protocol_step_pool,
        );
        assert_ne!(
            cfg.cloud.synthetics_free_browser_step_pool,
            cfg.cloud.ai_free_credit_pool,
        );
    }

    fn db_row(
        org_id: &str,
        feature: &str,
        usage_count: i64,
    ) -> infra::table::entity::trial_quota_usage::Model {
        infra::table::entity::trial_quota_usage::Model {
            org_id: org_id.to_string(),
            feature: feature.to_string(),
            usage_count,
            usage_limit: None,
            updated_at: 0,
            notified_checkpoint: 0,
        }
    }

    /// A node that reloads its counters folded per ORG has one pool again the
    /// moment it restarts, and nothing at runtime would say so.
    #[test]
    fn the_startup_fold_keeps_the_pools_apart() {
        let rows = vec![
            db_row("acme", "ai_chat", 40),
            db_row("acme", "new_incident", 50),
            db_row("acme", "synthetics_browser_steps", 900),
            db_row("acme", "synthetics_protocol_steps", 700),
        ];
        let (totals, _) = fold_db_records(&rows);

        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::AiCredits)),
            Some(&90),
            "the AI pool sums its own features and nothing else",
        );
        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsBrowserSteps)),
            Some(&900),
        );
        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsProtocolSteps)),
            Some(&700),
            "the two step grants are independent — one must not fold into the other",
        );
    }

    /// The pre-split `synthetics_steps` feature key. Existing rows must keep
    /// counting rather than resetting every org to a fresh grant, and they land
    /// on PROTOCOL so nobody is handed free browser capacity they never earned.
    #[test]
    fn the_startup_fold_reads_the_pre_split_key_as_protocol() {
        let rows = vec![db_row("acme", "synthetics_steps", 900)];
        let (totals, _) = fold_db_records(&rows);

        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsProtocolSteps)),
            Some(&900),
        );
        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsBrowserSteps)),
            None,
            "a legacy balance must not become free browser steps",
        );
    }

    /// Folding a NEWER node's unknown `feature` into a pool at random spends
    /// that pool's grant on usage that was never its own.
    #[test]
    fn the_startup_fold_skips_a_feature_it_does_not_recognise() {
        let rows = vec![
            db_row("acme", "ai_chat", 40),
            db_row("acme", "some_future_feature", 5_000),
        ];
        let (totals, _) = fold_db_records(&rows);

        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::AiCredits)),
            Some(&40),
        );
        assert_eq!(
            totals.len(),
            1,
            "the unknown feature belongs to no pool here"
        );
    }

    /// A refund flushes as a negative delta added verbatim, so a row can sit
    /// below zero; `as u64` on that is an org exhausted forever, by a refund.
    #[test]
    fn the_startup_fold_reads_a_negative_row_as_zero() {
        let rows = vec![db_row("acme", "synthetics_browser_steps", -12)];
        let (totals, _) = fold_db_records(&rows);
        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsBrowserSteps)),
            Some(&0),
        );
    }

    /// An explicit limit belongs to the pool whose feature row carries it, or
    /// raising the AI credit limit also raises the one-time step grant.
    #[test]
    fn the_startup_fold_keeps_explicit_limits_in_their_own_pool() {
        let mut ai = db_row("acme", "ai_chat", 0);
        ai.usage_limit = Some(50_000);
        let steps = db_row("acme", "synthetics_steps", 0);
        let (_, limits) = fold_db_records(&[ai, steps]);

        assert_eq!(
            limits.get(&scope("acme", TrialQuotaPool::AiCredits)),
            Some(&50_000),
        );
        assert_eq!(
            limits.get(&scope("acme", TrialQuotaPool::SyntheticsBrowserSteps)),
            None,
            "the step grant keeps its deployment default",
        );
    }

    /// **A5.** A dropped flush record is counted under its own pool's label.
    /// Reached through a function pointer so the call does not count towards
    /// `every_dropped_pool_record_is_counted` below.
    #[test]
    fn a_dropped_pool_record_is_counted_against_its_own_pool() {
        let record: fn(&str, TrialQuotaFeature, i64, &dyn std::fmt::Display) = record_flush_drop;
        let dropped = |feature: TrialQuotaFeature| {
            config::metrics::TRIAL_QUOTA_FLUSH_DROPS_TOTAL
                .with_label_values(&[feature.feature_key()])
                .get()
        };

        let before = (
            dropped(TrialQuotaFeature::SyntheticsBrowserSteps),
            dropped(TrialQuotaFeature::AiChat),
        );
        record(
            "acme",
            TrialQuotaFeature::SyntheticsBrowserSteps,
            14,
            &"channel full",
        );

        assert_eq!(
            dropped(TrialQuotaFeature::SyntheticsBrowserSteps) - before.0,
            1,
            "A5's counter did not move for the pool that lost the record",
        );
        assert_eq!(
            dropped(TrialQuotaFeature::AiChat) - before.1,
            0,
            "the drop was attributed to the wrong pool — a synthetics step lost under a \
             ONE-TIME grant is permanent, an AI credit is not",
        );
    }

    /// The drop path must stay behind the counter. The error branch needs the
    /// 10,000-slot channel full, which would leave every later test running
    /// against a saturated queue, so the wiring is pinned in source. The needles
    /// are assembled so this test's own source does not satisfy them.
    #[test]
    fn every_dropped_pool_record_is_counted() {
        let source = include_str!("trial_quota.rs");
        assert_eq!(
            source.matches(&["record_flush", "_drop("].concat()).count(),
            2,
            "one definition and exactly one call site are expected for A5's counter",
        );
        let body = source
            .split_once(&["fn buffer", "_flush("].concat())
            .expect("the flush buffer")
            .1;
        let end = body.find("\n}\n").expect("end of buffer_flush");
        assert!(
            body[..end].contains(&["record_flush", "_drop("].concat()),
            "the dropped record is no longer counted; A5 has nothing to alert on",
        );
    }

    #[test]
    fn pool_adjustment_deltas_carry_the_right_sign() {
        assert_eq!(PoolAdjustment::Refund(10).delta(), -10);
        assert_eq!(PoolAdjustment::TopUp(4).delta(), 4);
    }

    // --- pending_checkpoint_from ---
    // QUOTA_CHECKPOINTS = [80, 90, 95, 100]

    #[test]
    fn test_pending_checkpoint_below_all() {
        assert_eq!(pending_checkpoint_from(0, 0), None);
        assert_eq!(pending_checkpoint_from(79, 0), None);
    }

    #[test]
    fn test_pending_checkpoint_exactly_80() {
        assert_eq!(pending_checkpoint_from(80, 0), Some(80));
    }

    #[test]
    fn test_pending_checkpoint_90_returns_highest_reached() {
        assert_eq!(pending_checkpoint_from(90, 0), Some(90));
    }

    #[test]
    fn test_pending_checkpoint_100_returns_100() {
        assert_eq!(pending_checkpoint_from(100, 0), Some(100));
    }

    #[test]
    fn test_pending_checkpoint_already_notified_at_80() {
        // pct=90 reached, 80 already notified → highest unrenotified is 90
        assert_eq!(pending_checkpoint_from(90, 80), Some(90));
    }

    #[test]
    fn test_pending_checkpoint_all_notified() {
        assert_eq!(pending_checkpoint_from(100, 100), None);
    }

    #[test]
    fn test_pending_checkpoint_between_checkpoints() {
        // pct=85 → reached 80 but not 90; 80 already notified → None
        assert_eq!(pending_checkpoint_from(85, 80), None);
        // pct=85 → reached 80, not yet notified → Some(80)
        assert_eq!(pending_checkpoint_from(85, 0), Some(80));
    }

    #[test]
    fn test_pending_checkpoint_95_skip_lower_notified() {
        assert_eq!(pending_checkpoint_from(95, 90), Some(95));
    }

    #[test]
    fn test_pending_checkpoint_100_skip_notified_95() {
        assert_eq!(pending_checkpoint_from(100, 95), Some(100));
    }

    #[test]
    fn test_ai_usage_request_body_optional_fields_absent_when_none() {
        let body = AiUsageRequestBody {
            feature: "chat",
            session_id: None,
            incident_id: None,
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("session_id"));
        assert!(!json.contains("incident_id"));
    }

    #[test]
    fn test_ai_usage_request_body_optional_fields_present_when_some() {
        let body = AiUsageRequestBody {
            feature: "chat",
            session_id: Some("sess-123"),
            incident_id: Some("inc-456"),
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("session_id"));
        assert!(json.contains("incident_id"));
    }
}

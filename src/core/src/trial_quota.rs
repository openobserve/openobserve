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
//! Free tier: every org gets a free grant **per pool** — lifetime for all but the
//! monthly status pool, which resets each `YYYYMM` (spec §7.3).
//! Pay-as-you-go: when free credits are exhausted and the org has an active
//! Stripe subscription, AI metering prices are auto-added to the subscription
//! and usage is reported to the _usage stream for billing.
//!
//! ## Pools
//!
//! [`TrialQuotaPool::AiCredits`] and the three synthetics step pools are
//! independent: every counter, limit, DB read and HA message is keyed
//! `(org, pool)`, so spending one grant cannot drain the other, and
//! [`TrialQuotaFeature::pool`] is the only feature-to-pool mapping. No
//! migration — a pool is just a fixed set of `trial_quota_usage.feature` keys.
//! Only the status pool rolls over, and its rollover rides `infra`'s upsert
//! rather than any logic in this module (§6.1, E23, spec §7.9).
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
    collections::HashMap,
    sync::{
        Arc, LazyLock as Lazy, OnceLock, RwLock,
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
use openobserve_synthetics::pool::StepRemaining;
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

/// A usage record buffered for periodic DB flush. `cost` is signed to match the
/// counters it feeds; every producer today passes a non-negative value.
struct FlushRecord {
    org_id: String,
    feature_key: String,
    cost: i64,
}

/// A free grant — lifetime, or monthly for the status pool — and the unit of isolation between
/// features. Every counter, limit and DB read is keyed per `(org, pool)` via [`scope`]: an org that
/// spends its AI credits must not thereby lose its synthetics budget.
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
    /// The one MONTHLY pool: status-page protocol steps, rolled over by `infra` (spec §7.3).
    SyntheticsStatusProtocol,
}

impl TrialQuotaPool {
    /// Every variant. A new pool missing here is invisible to every scan built on it.
    pub const ALL_POOLS: &'static [TrialQuotaPool] = &[
        TrialQuotaPool::AiCredits,
        TrialQuotaPool::SyntheticsBrowserSteps,
        TrialQuotaPool::SyntheticsProtocolSteps,
        TrialQuotaPool::SyntheticsStatusProtocol,
    ];

    /// Stable identifier used in the [`scope`] key and on the HA wire.
    pub fn key(&self) -> &'static str {
        match self {
            TrialQuotaPool::AiCredits => "ai_credits",
            TrialQuotaPool::SyntheticsBrowserSteps => "synthetics_browser_steps",
            TrialQuotaPool::SyntheticsProtocolSteps => "synthetics_protocol_steps",
            TrialQuotaPool::SyntheticsStatusProtocol => "synthetics_status_protocol",
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
            "synthetics_status_protocol" => Some(TrialQuotaPool::SyntheticsStatusProtocol),
            _ => None,
        }
    }

    /// Which pool a `trial_quota_usage.feature` value belongs to. `None` for a
    /// key a NEWER node wrote: guessing would spend one grant on another's usage.
    pub fn from_key_of_feature(feature: &str) -> Option<Self> {
        Self::ALL_POOLS
            .iter()
            .copied()
            .find(|pool| pool.feature_keys().contains(&feature))
    }

    /// Exhaustive on purpose: a new variant must be classified before it compiles.
    pub fn is_synthetics(self) -> bool {
        match self {
            TrialQuotaPool::AiCredits => false,
            TrialQuotaPool::SyntheticsBrowserSteps
            | TrialQuotaPool::SyntheticsProtocolSteps
            | TrialQuotaPool::SyntheticsStatusProtocol => true,
        }
    }

    /// Whether this pool's counter belongs to one `YYYYMM` (spec §7.3). Exhaustive on purpose.
    pub fn is_monthly(self) -> bool {
        match self {
            TrialQuotaPool::AiCredits
            | TrialQuotaPool::SyntheticsBrowserSteps
            | TrialQuotaPool::SyntheticsProtocolSteps => false,
            TrialQuotaPool::SyntheticsStatusProtocol => true,
        }
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
            TrialQuotaPool::SyntheticsStatusProtocol => &["synthetics_status_protocol"],
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
            TrialQuotaPool::SyntheticsStatusProtocol => cfg.cloud.synthetics_free_status_step_pool,
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

/// Atomically apply a SIGNED delta to one pool's counter, saturating at zero: the
/// only negative delta left is one an older node broadcasts over HA, and wrapping
/// `u64` would leave an org at 18 quintillion units that can never run again.
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
    /// Which pool this moves: absent means AI credits, unknown means a NEWER node's.
    pub fn resolved_pool(&self) -> Option<TrialQuotaPool> {
        match self.pool.as_deref() {
            None => Some(TrialQuotaPool::AiCredits),
            Some(key) => TrialQuotaPool::from_key(key),
        }
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

/// Apply one remote HA message to the counters; `None` for a pool this build lacks.
fn apply_ha_msg(msg: &TrialQuotaHaMsg) -> Option<(TrialQuotaPool, u64, u64)> {
    let pool = msg.resolved_pool()?;
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
    Some((pool, old, new_total))
}

/// Ack even a message this node discards: an un-acked HA delta is redelivered forever.
async fn ack_ha_msg(msg: &infra::queue::Message) {
    if let Err(e) = msg.ack().await {
        log::error!("[TRIAL_QUOTA] Failed to ack HA message: {e}");
    }
}

/// Persist and publish an explicit limit for one of an organization's pools — it outlives the
/// status pool's monthly rollover (§6.2). Re-opens an exhausted org immediately and everywhere — DB
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
        reset_checkpoint(org_id, pool.feature_keys()).await;
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

/// Buffer one SIGNED usage movement for the periodic DB flush.
///
/// ⚠️ §11 **F8**: the channel is bounded at 10,000 and `try_send` DROPS on
/// overflow. Only the DB half is lost — this node keeps enforcing the right
/// number until it restarts, when `init_from_db` reloads a total short by the
/// dropped amount and the org silently gets those units back. Under a one-time
/// grant that is permanent. Nothing replays it (fire-and-forget, no ack) and
/// nothing reconciles it; **A5** pages on the drop.
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
                ack_ha_msg(&msg).await;
                continue;
            }
        };

        // Skip messages from self — we already applied the deduction locally
        if ha_msg.source_node.eq(&LOCAL_NODE) {
            ack_ha_msg(&msg).await;
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
            ack_ha_msg(&msg).await;
            continue;
        }

        let Some((pool, old, new_total)) = apply_ha_msg(&ha_msg) else {
            log::warn!(
                "[TRIAL_QUOTA] Ignoring HA message for pool {:?}, which this build does not \
                 have: org={}",
                ha_msg.pool,
                ha_msg.org_id,
            );
            ack_ha_msg(&msg).await;
            continue;
        };

        log::info!(
            "[TRIAL_QUOTA] HA sync: org={} pool={} delta={} limit={:?} total {}->{}",
            ha_msg.org_id,
            pool.key(),
            ha_msg.resolved_delta(),
            ha_msg.usage_limit,
            old,
            new_total,
        );

        ack_ha_msg(&msg).await;
    }

    log::warn!("[TRIAL_QUOTA] HA queue subscriber ended");
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/// Units left; the assert below is compiled out of release, where a monthly pool reads back its
/// FULL allowance — use `get_pool_usage` or `fold_synthetics_remaining` for one.
pub fn get_remaining_for_pool(org_id: &str, pool: TrialQuotaPool) -> u64 {
    debug_assert!(
        !pool.is_monthly(),
        "a monthly pool has no in-memory counter"
    );
    get_pool_limit(org_id, pool).saturating_sub(get_pool_used(org_id, pool))
}

/// Units used; the assert below is compiled out of release, where a monthly pool reads back 0
/// however much it has spent — use `get_pool_usage` or `fold_synthetics_remaining` for one.
pub fn get_used_for_pool(org_id: &str, pool: TrialQuotaPool) -> u64 {
    debug_assert!(
        !pool.is_monthly(),
        "a monthly pool has no in-memory counter"
    );
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
    /// Stable pool identifier — one of [`TrialQuotaPool::ALL_POOLS`]' keys.
    pub pool: String,
    /// `"free"` | `"pay_as_you_go"` | `"exhausted"`.
    pub mode: String,
    pub used: u64,
    pub limit: u64,
    pub remaining: u64,
    pub requires_additional_credits: bool,
}

/// The in-memory counter carries no month, so on a monthly pool it is a stale floor no reset
/// can clear.
fn pool_used(pool: TrialQuotaPool, db_used: u64, in_memory_used: u64) -> u64 {
    if pool.is_monthly() {
        db_used
    } else {
        db_used.max(in_memory_used)
    }
}

/// The exhaustion policy is a property of the org's billing, not of the pool, so the AI-named
/// resolver below is correct for every pool.
pub async fn get_pool_usage(org_id: &str, pool: TrialQuotaPool) -> PoolUsageResponse {
    let limit = get_pool_limit(org_id, pool);
    let in_memory_used = get_pool_used(org_id, pool);
    // Spec §7.3: an unscoped sum over a monthly pool reports a month the org has left.
    let month = pool
        .is_monthly()
        .then(|| infra::table::trial_quota_usage::month_of(config::utils::time::now_micros()));

    // Scoped to THIS pool's feature rows: summing every row of the org would
    // report synthetics step consumption as AI credits used.
    let db_used = match infra::table::trial_quota_usage::get_total_usage_for_org(
        org_id,
        pool.feature_keys(),
        month,
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

    let used = pool_used(pool, db_used, in_memory_used);
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

/// Atomically mark ONE pool's checkpoint as notified for an org in the DB.
/// Returns true if this pod won the update (no other pod set it first).
pub async fn mark_checkpoint_notified(org_id: &str, checkpoint: u8, features: &[&str]) -> bool {
    match infra::table::trial_quota_usage::update_notified_checkpoint(
        org_id,
        checkpoint as i16,
        features,
    )
    .await
    {
        Ok(updated) => updated,
        Err(e) => {
            log::error!("[AI_QUOTA] Failed to persist checkpoint for org={org_id}: {e}");
            false
        }
    }
}

/// Reset checkpoint tracking for ONE pool of an org (e.g., when its grant is raised).
pub async fn reset_checkpoint(org_id: &str, features: &[&str]) {
    if let Err(e) =
        infra::table::trial_quota_usage::reset_notified_checkpoint(org_id, features).await
    {
        log::error!("[TRIAL_QUOTA] Failed to reset checkpoint for org={org_id}: {e}");
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
        // A monthly counter's truth is the row's own `period`, which this map cannot hold.
        if !pool.is_monthly() {
            // A refund flushes as a NEGATIVE delta added verbatim, so a row can sit
            // below zero. Read as zero rather than wrapped into an astronomical
            // `u64` that would exhaust the org forever.
            *totals.entry(key.clone()).or_default() += record.usage_count.max(0) as u64;
        }
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

/// One org's synthetics spend and the grant it was spent against, per pool.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyntheticsQuota {
    pub browser_used: u64,
    pub browser_limit: u64,
    pub protocol_used: u64,
    pub protocol_limit: u64,
    pub status_used: u64,
    pub status_limit: u64,
}

/// Every `trial_quota_usage.feature` value that spends from a synthetics pool.
///
/// Composed from the pools' own `feature_keys`, never hand-written: it has to
/// carry the pre-split `synthetics_steps`, or an org whose protocol usage
/// predates the split reads `used = 0` and is handed the grant a second time.
pub fn all_synthetics_features() -> Vec<&'static str> {
    TrialQuotaPool::ALL_POOLS
        .iter()
        .filter(|pool| pool.is_synthetics())
        .flat_map(|pool| pool.feature_keys().iter().copied())
        .collect()
}

/// Steps left in each requested org's synthetics grants — SPEC §6.6, ONE read.
///
/// An org missing from the answer is UNGATED at the scheduler, so a failed read
/// returns nothing at all rather than a map of zeroes.
pub async fn synthetics_remaining_for_orgs(org_ids: Vec<String>) -> HashMap<String, StepRemaining> {
    let Some((rows, month)) = read_synthetics_rows(&org_ids).await else {
        return HashMap::new();
    };
    fold_synthetics_remaining(&org_ids, &rows, month)
}

/// Each requested org's synthetics spend and grant, for the `_meta` org listing — SPEC §11 #5.
///
/// A failed read answers with nothing: this node's own counters are not the source of truth.
pub async fn synthetics_quota_for_orgs(org_ids: Vec<String>) -> HashMap<String, SyntheticsQuota> {
    let Some((rows, month)) = read_synthetics_rows(&org_ids).await else {
        return HashMap::new();
    };
    fold_synthetics_quota(&org_ids, &rows, month)
}

/// The rows both batched readers fold, and the month to read them in — `None` when the table
/// cannot be reached, so neither reader can resolve a month the other would not.
async fn read_synthetics_rows(
    org_ids: &[String],
) -> Option<(Vec<infra::table::entity::trial_quota_usage::Model>, i32)> {
    let conn = infra::db::get_orm_client_ro().await;
    let rows = match infra::table::trial_quota_usage::get_for_orgs(
        conn,
        org_ids,
        &all_synthetics_features(),
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[TRIAL_QUOTA] synthetics counter read failed: {e}");
            return None;
        }
    };
    Some((
        rows,
        infra::table::trial_quota_usage::month_of(config::utils::time::now_micros()),
    ))
}

/// `month` is the reader's, `now`'s; the writer stamps the window START's, so the two differ
/// by at most one interval.
pub(crate) fn fold_synthetics_remaining(
    org_ids: &[String],
    rows: &[infra::table::entity::trial_quota_usage::Model],
    month: i32,
) -> HashMap<String, StepRemaining> {
    fold_synthetics_quota(org_ids, rows, month)
        .into_iter()
        .map(|(org_id, quota)| {
            (
                org_id,
                // A lowered limit leaves usage above it, so a plain subtraction is a panic.
                StepRemaining {
                    browser: quota.browser_limit.saturating_sub(quota.browser_used),
                    protocol: quota.protocol_limit.saturating_sub(quota.protocol_used),
                    status: quota.status_limit.saturating_sub(quota.status_used),
                },
            )
        })
        .collect()
}

/// The spend and the grant every requested org's rows resolve to, per pool — the one place
/// either reader decides what an org's effective limit is.
pub(crate) fn fold_synthetics_quota(
    org_ids: &[String],
    rows: &[infra::table::entity::trial_quota_usage::Model],
    month: i32,
) -> HashMap<String, SyntheticsQuota> {
    let mut used: HashMap<(&str, TrialQuotaPool), u64> = HashMap::new();
    let mut limits: HashMap<(&str, TrialQuotaPool), u64> = HashMap::new();
    for row in rows {
        let Some(pool) = TrialQuotaPool::from_key_of_feature(&row.feature) else {
            continue;
        };
        // The limit is an admin override that outlives every reset, so it is read either way.
        if let Some(limit) = row.usage_limit.and_then(|l| u64::try_from(l).ok()) {
            limits
                .entry((row.org_id.as_str(), pool))
                .and_modify(|current| *current = (*current).max(limit))
                .or_insert(limit);
        }
        if pool.is_monthly() && row.period != month {
            continue;
        }
        let entry = used.entry((row.org_id.as_str(), pool)).or_default();
        *entry = entry.saturating_add(u64::try_from(row.usage_count).unwrap_or(0));
    }

    org_ids
        .iter()
        .map(|org_id| {
            let spent = |pool| {
                // The row's override beats `ORG_LIMITS`, which is empty until the first refresh.
                let limit = limits
                    .get(&(org_id.as_str(), pool))
                    .copied()
                    .unwrap_or_else(|| get_pool_limit(org_id, pool));
                (
                    used.get(&(org_id.as_str(), pool)).copied().unwrap_or(0),
                    limit,
                )
            };
            let (browser_used, browser_limit) = spent(TrialQuotaPool::SyntheticsBrowserSteps);
            let (protocol_used, protocol_limit) = spent(TrialQuotaPool::SyntheticsProtocolSteps);
            let (status_used, status_limit) = spent(TrialQuotaPool::SyntheticsStatusProtocol);
            (
                org_id.clone(),
                SyntheticsQuota {
                    browser_used,
                    browser_limit,
                    protocol_used,
                    protocol_limit,
                    status_used,
                    status_limit,
                },
            )
        })
        .collect()
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

    /// Position of a pool in `ALL_POOLS`, exhaustive so a new variant must claim an index here.
    fn ordinal(pool: TrialQuotaPool) -> usize {
        match pool {
            TrialQuotaPool::AiCredits => 0,
            TrialQuotaPool::SyntheticsBrowserSteps => 1,
            TrialQuotaPool::SyntheticsProtocolSteps => 2,
            TrialQuotaPool::SyntheticsStatusProtocol => 3,
        }
    }

    const STEPS: TrialQuotaFeature = TrialQuotaFeature::SyntheticsBrowserSteps;

    /// The one read behind both batched entry points.
    const SYNTHETICS_READER: &str = "fn read_synthetics_rows(";

    /// Each batched synthetics read and the fold it is a thin wrapper around.
    const BATCHED_READS: [(&str, &str); 2] = [
        (
            "fn synthetics_remaining_for_orgs(",
            "fold_synthetics_remaining(",
        ),
        ("fn synthetics_quota_for_orgs(", "fold_synthetics_quota("),
    ];

    /// CODE only: a comment naming what a scan forbids would trip that scan on its own text.
    fn code_only_source() -> String {
        include_str!("trial_quota.rs")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The argument text of the first `needle` call in `body`, matched by paren balance.
    fn call_args<'a>(body: &'a str, needle: &str) -> &'a str {
        let at = body
            .find(needle)
            .unwrap_or_else(|| panic!("`{needle}` must be called here"))
            + needle.len();
        let mut depth = 1usize;
        for (offset, ch) in body[at..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' if depth == 1 => return &body[at..at + offset],
                ')' => depth -= 1,
                _ => {}
            }
        }
        panic!("`{needle}` call is never closed");
    }

    /// The text after `signature`, up to the closing brace of the item it opens.
    fn fn_body<'a>(source: &'a str, signature: &str) -> &'a str {
        let body = source
            .split_once(signature)
            .unwrap_or_else(|| panic!("`{signature}` must live in this file"))
            .1;
        let end = body.find("\n}\n").expect("end of the function");
        &body[..end]
    }

    /// rustfmt is free to break an argument list across lines, so every scan of one compares
    /// against this.
    fn without_whitespace(text: &str) -> String {
        text.chars().filter(|c| !c.is_whitespace()).collect()
    }

    /// Whether `body` reads a pool off this node's own cache rather than the table.
    fn reads_the_node_cache(body: &str) -> bool {
        // Assembled at runtime so this file is not itself a call site to the workspace scan.
        ["get_used", "get_limit", "get_remaining"]
            .into_iter()
            .any(|reader| body.contains(&[reader, "_for_pool("].concat()))
    }

    /// Whether `args` hands `param` on, as itself or as something read off it — a token scan, so
    /// `all_features()` does not read as the `features` the frame was given.
    fn passes_through(args: &str, param: &str) -> bool {
        args.split(|c: char| !c.is_alphanumeric() && c != '_')
            .any(|token| token == param)
    }

    /// The name of the `index`-th parameter the function `signature` opens declares.
    fn parameter(source: &str, signature: &str, index: usize) -> String {
        call_args(source, signature)
            .split(',')
            .nth(index)
            .unwrap_or_else(|| panic!("`{signature}` must declare {} parameters", index + 1))
            .split(':')
            .next()
            .expect("a parameter name")
            .trim()
            .to_string()
    }

    /// What `name` is bound to in `body`, up to the `;` that ends its `let`.
    fn binding_value<'a>(body: &'a str, name: &str) -> Option<&'a str> {
        let mut rest = body;
        loop {
            let at = rest.find("let ")? + "let ".len();
            rest = &rest[at..];
            let declared = rest.trim_start_matches("mut ");
            let end = declared
                .find(|c: char| !c.is_alphanumeric() && c != '_')
                .unwrap_or(declared.len());
            if &declared[..end] == name {
                let value = declared[end..].split_once('=')?.1;
                return Some(&value[..value.find(';')?]);
            }
        }
    }

    /// Whether `args` hands on ALL of `expr` — as the expression itself, or as a binding assigned
    /// it — so hoisting is fine and an index that narrows it to one element is not.
    fn hands_on_all(body: &str, args: &str, expr: &str) -> bool {
        let expr = without_whitespace(expr);
        let args = without_whitespace(args);
        let handed = args.trim_end_matches(',').trim_start_matches('&');
        if handed.contains('[') {
            return false;
        }
        handed == expr
            || binding_value(body, handed).is_some_and(|bound| {
                let bound = without_whitespace(bound);
                bound.trim_start_matches('&') == expr
            })
    }

    /// Every `.rs` file under the workspace `src/` that mentions one of `needles`, comments
    /// stripped.
    fn workspace_code_mentioning(needles: &[String]) -> Vec<(String, String)> {
        let mut found = Vec::new();
        let mut stack = vec![std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/.."
        ))];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&path) else {
                    continue;
                };
                if !needles.iter().any(|needle| text.contains(needle.as_str())) {
                    continue;
                }
                let code = text
                    .lines()
                    .filter(|line| !line.trim_start().starts_with("//"))
                    .collect::<Vec<_>>()
                    .join("\n");
                found.push((path.display().to_string(), code));
            }
        }
        found
    }

    /// Every workspace call of `needles` as `(path, argument text)`; a definition proves nothing
    /// about what a caller passes, so the `fn` that declares one is skipped.
    fn workspace_call_sites(needles: &[String]) -> Vec<(String, String)> {
        let mut sites = Vec::new();
        for (path, code) in &workspace_code_mentioning(needles) {
            for needle in needles {
                let mut rest = code.as_str();
                while let Some(at) = rest.find(needle.as_str()) {
                    let start = code.len() - rest.len() + at;
                    rest = &rest[at..];
                    if !code[..start].trim_end().ends_with("fn") {
                        sites.push((path.clone(), call_args(rest, needle).to_string()));
                    }
                    rest = &rest[needle.len()..];
                }
            }
        }
        sites
    }

    /// `TrialQuotaFeature::pool` and `TrialQuotaPool::feature_keys` MUST agree,
    /// or a feature deducts from one pool and reports into another in the table.
    #[test]
    fn every_feature_is_listed_by_its_own_pool() {
        for feature in [
            TrialQuotaFeature::AiChat,
            TrialQuotaFeature::NewIncident,
            TrialQuotaFeature::IncidentReAnalysis,
            TrialQuotaFeature::SyntheticsBrowserSteps,
            TrialQuotaFeature::SyntheticsProtocolSteps,
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

        // A key listed by two pools resolves to the first, and the other's counter is never read.
        for pool in TrialQuotaPool::ALL_POOLS {
            for key in pool.feature_keys() {
                assert_eq!(
                    TrialQuotaPool::from_key_of_feature(key),
                    Some(*pool),
                    "`{key}` is listed by {} but resolves elsewhere",
                    pool.key(),
                );
            }
        }
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

    /// All or nothing: a partial deduct would start a run the grant cannot pay for.
    #[test]
    fn a_deduct_that_does_not_fit_takes_nothing() {
        let org_id = steps_org("partial", 10);
        assert!(try_deduct_units(&org_id, STEPS, 14).is_err());
        assert_eq!(
            get_used_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
        assert!(try_deduct_units(&org_id, STEPS, 10).is_ok());
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    /// T32 / E17 — raising the limit re-opens the org immediately, with no
    /// restart and no re-init.
    #[test]
    fn t32_raising_the_limit_reopens_an_exhausted_org_without_a_restart() {
        let org_id = steps_org("t32", 10);
        assert!(try_deduct_units(&org_id, STEPS, 10).is_ok());
        assert!(try_deduct_units(&org_id, STEPS, 1).is_err());

        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsBrowserSteps, 50);
        assert!(try_deduct_units(&org_id, STEPS, 1).is_ok());
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            39
        );
    }

    #[test]
    fn t32_the_ha_queue_carries_the_new_limit_to_every_other_node() {
        let org_id = steps_org("t32-ha", 10);
        assert!(try_deduct_units(&org_id, STEPS, 10).is_ok());
        assert!(try_deduct_units(&org_id, STEPS, 1).is_err());

        apply_ha_msg(&TrialQuotaHaMsg {
            org_id: org_id.clone(),
            cost: 0,
            usage_limit: Some(50),
            pool: Some(TrialQuotaPool::SyntheticsBrowserSteps.key().to_string()),
            delta: 0,
            source_node: LOCAL_NODE.clone(),
            timestamp: 1,
        })
        .expect("a pool this build has must be applied");

        assert_eq!(
            get_limit_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            50
        );
        assert!(try_deduct_units(&org_id, STEPS, 1).is_ok());
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
        assert!(try_deduct_units(&org_id, STEPS, 60).is_ok());
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
        assert!(try_deduct_units(&org_id, STEPS, 41).is_err());
        assert!(try_deduct_units(&org_id, STEPS, 40).is_ok());
        assert_eq!(
            get_remaining_for_pool(&org_id, TrialQuotaPool::SyntheticsBrowserSteps),
            0
        );
    }

    #[test]
    fn t33_the_pool_has_no_period_or_reset_machinery() {
        let source = code_only_source();
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

    /// These are `pub`, so a leftover entry point raises no dead-code warning.
    #[test]
    fn no_synthetics_reservation_entry_point_survives() {
        let source = code_only_source();
        // Assembled at runtime so the guard cannot match its own text.
        let banned = [
            ["synthetics_steps", "_try", "_deduct"].concat(),
            ["synthetics_steps", "_ref", "und"].concat(),
            ["synthetics_steps", "_dead_letter", "_ref", "und"].concat(),
            ["synthetics_steps", "_adjust"].concat(),
            ["synthetics_steps", "_remaining"].concat(),
            ["Pool", "Adjustment"].concat(),
            ["Idempotency", "Ledger"].concat(),
            ["ADJUST", "MENTS"].concat(),
            ["apply_pool", "_adjustment"].concat(),
            ["force_deduct", "_units"].concat(),
            ["ref", "und", "_units"].concat(),
        ];
        for banned in banned {
            assert!(
                !source.contains(&banned),
                "`{banned}` takes from a ONE-TIME grant the gate no longer gives back",
            );
        }
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
        assert_eq!(msg.resolved_pool(), Some(TrialQuotaPool::AiCredits));
        assert_eq!(msg.resolved_delta(), 50);
    }

    /// A rolling deploy puts a newer node's pool key on this node's queue, and a limit
    /// defaulted to AI credits hands the org that pool's whole allowance in AI spend.
    #[test]
    fn an_ha_message_for_an_unknown_pool_is_ignored_not_defaulted() {
        let msg = ha(1, Some("something_new"), 1);
        assert_eq!(msg.resolved_pool(), None);

        let org_id = "pool-test-ha-unknown-pool";
        let before = get_limit_for_pool(org_id, TrialQuotaPool::AiCredits);
        assert!(
            apply_ha_msg(&TrialQuotaHaMsg {
                org_id: org_id.to_string(),
                cost: 0,
                usage_limit: Some(150_000),
                pool: Some("a_pool_a_newer_node_has".to_string()),
                delta: 1,
                source_node: LOCAL_NODE.clone(),
                timestamp: 1,
            })
            .is_none(),
            "an unknown pool key must not be applied to any pool this build does have",
        );
        assert_eq!(
            get_limit_for_pool(org_id, TrialQuotaPool::AiCredits),
            before,
            "the AI grant was resized by a message that was never about it",
        );
        assert_eq!(get_used_for_pool(org_id, TrialQuotaPool::AiCredits), 0);
    }

    #[test]
    fn an_ha_refund_travels_as_a_negative_delta() {
        let msg = ha_msg("acme", TrialQuotaPool::SyntheticsBrowserSteps, -10, None);
        assert_eq!(msg.delta, -10);
        // `cost` is the positive part, so an old node applies nothing, not a charge.
        assert_eq!(msg.cost, 0);
        assert_eq!(msg.resolved_delta(), -10);
        assert_eq!(
            msg.resolved_pool(),
            Some(TrialQuotaPool::SyntheticsBrowserSteps)
        );
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
        })
        .expect("a pool this build has must be applied");
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
            get_limit_for_pool(org_id, TrialQuotaPool::SyntheticsStatusProtocol),
            cfg.cloud.synthetics_free_status_step_pool,
        );
        assert_eq!(
            get_limit_for_pool(org_id, TrialQuotaPool::AiCredits),
            cfg.cloud.ai_free_credit_pool,
        );
        // §6.1: 10,000 browser steps and 20,000 protocol; the AI pool is 1,000 credits.
        assert_eq!(cfg.cloud.synthetics_free_browser_step_pool, 10_000);
        assert_eq!(cfg.cloud.synthetics_free_protocol_step_pool, 20_000);
        // §7.3: 43,200 status steps a month — 30 days of one-minute checks.
        assert_eq!(cfg.cloud.synthetics_free_status_step_pool, 43_200);
        // The four grants must not collapse onto one knob.
        assert_ne!(
            cfg.cloud.synthetics_free_browser_step_pool,
            cfg.cloud.synthetics_free_protocol_step_pool,
        );
        assert_ne!(
            cfg.cloud.synthetics_free_browser_step_pool,
            cfg.cloud.ai_free_credit_pool,
        );
        assert_ne!(
            cfg.cloud.synthetics_free_status_step_pool,
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
            period: 0,
        }
    }

    fn db_status_row(
        org_id: &str,
        usage_count: i64,
        period: i32,
    ) -> infra::table::entity::trial_quota_usage::Model {
        let mut row = db_row(org_id, "synthetics_status_protocol", usage_count);
        row.period = period;
        row
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

    /// Nothing ever resets an in-memory pool counter, so a month-blind total loaded at every
    /// restart stays as the `max()` floor `get_pool_usage` reports for the rest of time.
    #[test]
    fn the_startup_fold_never_seeds_a_monthly_counter() {
        let rows = vec![
            db_status_row("acme", 81_000, 202609),
            db_row("acme", "synthetics_browser_steps", 900),
        ];
        let (totals, _) = fold_db_records(&rows);

        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsStatusProtocol)),
            None,
            "the monthly counter's truth is the row's own period, which this map cannot hold",
        );
        assert_eq!(
            totals.get(&scope("acme", TrialQuotaPool::SyntheticsBrowserSteps)),
            Some(&900),
            "the lifetime pools still load, or every node restarts an org's grant at zero",
        );
    }

    /// A limit is an override that outlives every reset, so the monthly pool still loads it.
    #[test]
    fn the_startup_fold_keeps_a_monthly_pools_override() {
        let mut row = db_status_row("bigcorp", 81_000, 202609);
        row.usage_limit = Some(150_000);
        let (totals, limits) = fold_db_records(&[row]);

        assert!(totals.is_empty());
        assert_eq!(
            limits.get(&scope("bigcorp", TrialQuotaPool::SyntheticsStatusProtocol)),
            Some(&150_000),
            "spec §7.4: the override survives every reset, so it must survive the restart too",
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

    /// A pool missing from `ALL_POOLS` is unreachable from `from_key_of_feature`, so its rows
    /// are never read and every org reads `used = 0` for it forever.
    #[test]
    fn all_pools_lists_every_variant_exactly_once() {
        let listed = TrialQuotaPool::ALL_POOLS.len();
        let mut seen = vec![None; listed];
        for pool in TrialQuotaPool::ALL_POOLS {
            let at = ordinal(*pool);
            assert!(
                seen[at].is_none(),
                "{} shares index {at} with {:?} — ALL_POOLS lists a pool twice",
                pool.key(),
                seen[at],
            );
            seen[at] = Some(*pool);
        }
        assert!(
            seen.iter().all(Option::is_some),
            "the {listed} pools in ALL_POOLS do not cover the indices 0..{listed}",
        );

        // `ordinal` is exhaustive, so its arm count IS the number of variants.
        let src = code_only_source();
        let at = src
            .find("fn ordinal(")
            .expect("the ordinal helper must be in this file");
        let end = at
            + src[at..]
                .find("\n    }")
                .expect("the helper must close at module level");
        assert_eq!(
            src[at..end].matches("TrialQuotaPool::").count(),
            listed,
            "a pool has an ordinal but no ALL_POOLS entry, so every scan built on ALL_POOLS \
             skips it silently",
        );
    }

    /// A pool absent from `ALL_POOLS` or unresolvable by its own key is invisible to every scan.
    #[test]
    fn every_pool_round_trips_and_unknown_keys_are_rejected() {
        for pool in TrialQuotaPool::ALL_POOLS {
            assert_eq!(
                TrialQuotaPool::from_key(pool.key()),
                Some(*pool),
                "{} must resolve back to its own variant",
                pool.key(),
            );
            assert_eq!(
                pool.is_synthetics(),
                pool.key().starts_with("synthetics"),
                "{} is classified against its own key, so a new pool cannot slip through \
                 unclassified and read as 0 usage forever",
                pool.key(),
            );
        }
        assert_eq!(TrialQuotaPool::from_key("ingest"), None);
        // A key a NEWER node writes must not be folded into a pool this build has.
        assert_eq!(TrialQuotaPool::from_key_of_feature("future_feature"), None);

        // Sharing a key with the protocol pool spends the allowance lifetime and resets the grant.
        assert_eq!(
            TrialQuotaPool::SyntheticsStatusProtocol.feature_keys(),
            &["synthetics_status_protocol"],
        );
        // The `PUT /api/_meta/quota/{pool}/usage_limit` path segment and the `scope` cache key.
        assert_eq!(
            TrialQuotaPool::SyntheticsStatusProtocol.key(),
            "synthetics_status_protocol",
        );
        // Diverge from a key the upsert writes and the row is folded by no pool at all, so
        // every org reads `used = 0` against that grant forever — and the write still succeeds.
        for feature in [
            infra::table::trial_quota_usage::SYNTHETICS_BROWSER_FEATURE,
            infra::table::trial_quota_usage::SYNTHETICS_PROTOCOL_FEATURE,
            infra::table::trial_quota_usage::SYNTHETICS_STATUS_FEATURE,
        ] {
            let pool = TrialQuotaPool::from_key_of_feature(feature)
                .unwrap_or_else(|| panic!("`{feature}` is written but owned by no pool"));
            assert!(
                pool.feature_keys().contains(&feature),
                "`{feature}` resolves to {} but is not one of its keys",
                pool.key(),
            );
            assert!(pool.is_synthetics(), "`{feature}` must be a synthetics key");
        }
        assert_eq!(
            infra::table::trial_quota_usage::SYNTHETICS_STATUS_FEATURE,
            "synthetics_status_protocol",
        );
    }

    /// Exactly one pool resets, and the admin API's `used` is wrong for it unless the read
    /// carries a month — spec §7.3's `bigcorp` reads 81,000 used on 3 October otherwise.
    #[test]
    fn only_the_status_pool_is_monthly() {
        for pool in TrialQuotaPool::ALL_POOLS {
            assert_eq!(
                pool.is_monthly(),
                *pool == TrialQuotaPool::SyntheticsStatusProtocol,
                "{} is classified against the one pool spec §7.3 resets",
                pool.key(),
            );
        }
    }

    /// The sync readers answer from a counter a monthly pool has no entry in, so any workspace
    /// call site passing one — this module's own included — reads the whole allowance back for
    /// an org that already spent its month.
    #[test]
    fn no_call_site_reads_a_monthly_pool_from_the_sync_readers() {
        // Assembled at runtime so this test's own source is not itself a call site.
        let needles = [
            ["get_remaining", "_for_pool("].concat(),
            ["get_used", "_for_pool("].concat(),
        ];
        let monthly = ["Synthetics", "StatusProtocol"].concat();
        let sites = workspace_call_sites(&needles);
        for (path, args) in &sites {
            assert!(
                !args.contains(&monthly),
                "{path}: the monthly pool has no in-memory counter, so this reads the full \
                 allowance for an org that spent its month — use get_pool_usage or the batched \
                 synthetics fold",
            );
        }
        assert!(
            !sites.is_empty(),
            "the scan inspected no call site at all: every match was the definition itself, so \
             the ban above cannot fail",
        );
    }

    /// The admin API's response body is `get_pool_usage`, so a month-blind read there reports
    /// a month the org has already left and an admin sizes the next limit against it.
    #[test]
    fn the_pool_usage_read_is_month_aware() {
        let source = code_only_source();
        let body = fn_body(&source, "pub async fn get_pool_usage(");

        assert!(
            call_args(body, "get_total_usage_for_org(").contains("month"),
            "an unscoped SUM(usage_count) charges a monthly pool for every month it ever spent",
        );
    }

    /// The in-memory counter carries no month, so maxing against it on a monthly pool pins a
    /// stale total as a floor no reset can clear.
    #[test]
    fn the_monthly_total_comes_from_the_table_alone() {
        let monthly = TrialQuotaPool::SyntheticsStatusProtocol;
        assert_eq!(
            pool_used(monthly, 40, 12_890),
            40,
            "September's 12,890 is not October's floor",
        );
        assert_eq!(
            pool_used(monthly, 0, 12_890),
            0,
            "a reset the table already applied must not be undone by the cache",
        );

        for pool in TrialQuotaPool::ALL_POOLS
            .iter()
            .copied()
            .filter(|pool| !pool.is_monthly())
        {
            assert_eq!(
                pool_used(pool, 40, 12_890),
                12_890,
                "{}: a pending flush must never report as unspent",
                pool.key(),
            );
            assert_eq!(pool_used(pool, 12_890, 40), 12_890, "{}", pool.key());
        }
    }

    /// `ack_ha_msg`'s own doc: an un-acked HA delta is redelivered forever, so a branch that
    /// skips a message without acking it spins the subscriber on that message.
    #[test]
    fn every_ha_branch_acks_before_it_skips() {
        let source = code_only_source();
        let body = fn_body(&source, "pub async fn subscribe_ha_queue(");

        let skips = body.matches("continue;").count();
        assert!(skips > 0, "the subscriber no longer skips anything: {body}");
        assert_eq!(
            body.matches("ack_ha_msg(").count(),
            skips + 1,
            "each of the {skips} skipped messages acks, and so does the one applied at the \
             bottom of the loop",
        );
    }

    /// Omit the pre-split key and every org whose protocol usage predates the split is re-granted.
    #[test]
    fn all_synthetics_features_includes_the_pre_split_key() {
        let mut features = all_synthetics_features();
        let mut expected: Vec<&str> = TrialQuotaPool::SyntheticsBrowserSteps
            .feature_keys()
            .iter()
            .chain(TrialQuotaPool::SyntheticsProtocolSteps.feature_keys())
            .chain(TrialQuotaPool::SyntheticsStatusProtocol.feature_keys())
            .copied()
            .collect();
        features.sort_unstable();
        expected.sort_unstable();
        assert_eq!(
            features, expected,
            "the read's IN filter must be composed from the pools' own feature_keys, so a key \
             added to a pool cannot be forgotten here",
        );
        assert!(
            features.contains(&"synthetics_steps"),
            "without the pre-split key an org whose protocol usage predates the split reads \
             used = 0 and is handed the whole grant a second time",
        );
    }

    /// The folds' `month` is a literal in every test, so nothing else ties either reader's month
    /// to the `period` the upsert writes.
    #[test]
    fn the_read_takes_its_month_from_the_writers_own_encoding() {
        let source = code_only_source();
        // Assembled at runtime so the guard cannot match its own text.
        let local_time = ["Local", "::"].concat();
        let year_call = ["year", "()"].concat();
        let month_call = ["month", "()"].concat();
        // The first match is the definition, so nothing below it is ever scanned.
        let reader = fn_body(&source, SYNTHETICS_READER);
        assert!(
            reader.contains("month_of("),
            "the shared read carries the month both folds are handed, so a month resolved \
             anywhere else is a second encoding",
        );
        assert!(
            !reader.contains(&local_time),
            "the upsert stamps a UTC month, so a local-time month disagrees with it for up to \
             a day either side of every boundary",
        );
        assert!(
            !(reader.contains(&year_call) && reader.contains(&month_call)),
            "a second YYYYMM encoding here is the drift `month_of` exists to prevent",
        );
        for (read, fold) in BATCHED_READS {
            let body = fn_body(&source, read);
            assert!(
                !body.contains("month_of("),
                "{read}: a month resolved beside the fold drifts from the one the other entry \
                 point folds with; both take the shared read's",
            );
            assert!(
                !body.contains(&local_time),
                "{read}: the upsert stamps a UTC month, so a local-time month disagrees with it \
                 for up to a day either side of every boundary",
            );
            assert!(
                !(body.contains(&year_call) && body.contains(&month_call)),
                "{read}: a second YYYYMM encoding here is the drift `month_of` exists to prevent",
            );
            assert!(
                passes_through(call_args(body, fold), "month"),
                "{read}: 0 or any other literal in that argument reads `period == month` as \
                 false for every live row",
            );
        }
    }

    /// One read, every synthetics key, and nothing at all when it fails: a fall back to the node's
    /// own counters answers with a grant no other node agrees on.
    #[test]
    fn a_batched_read_answers_from_the_table_or_not_at_all() {
        let source = code_only_source();
        let reader = fn_body(&source, SYNTHETICS_READER);
        let args = call_args(reader, "get_for_orgs(");
        assert!(
            args.contains("all_synthetics_features()"),
            "a read narrowed to one pool's `feature_keys()` reports `used = 0` for every other \
             pool, and nothing in the answer says those rows were never asked for",
        );
        assert!(
            passes_through(args, &parameter(&source, SYNTHETICS_READER, 0)),
            "the read must ask about the orgs this frame was given",
        );
        assert!(
            without_whitespace(reader).contains("returnNone;"),
            "a failed read answers with nothing, so both entry points hand back an empty map \
             instead of a number the table never granted",
        );
        assert!(
            !reads_the_node_cache(reader),
            "the shared read answers from this node's own cache, which no other node agrees with",
        );
        for (read, _) in BATCHED_READS {
            let body = fn_body(&source, read);
            assert!(
                body.contains(SYNTHETICS_READER.trim_start_matches("fn ")),
                "{read}: the shared read is the only source either entry point has",
            );
            assert!(
                without_whitespace(body).contains("returnHashMap::new();"),
                "{read}: a failed read answers with an empty map — the listing then reports \
                 zeros for the page instead of a number the table never granted",
            );
            assert!(
                !reads_the_node_cache(body),
                "{read}: this node's own cache is not a grant the table ever made",
            );
        }
    }

    /// Absent from the map means UNGATED at the gate, so "has not used it yet" must not land there.
    #[test]
    fn fold_synthetics_remaining_gives_every_requested_org_an_entry() {
        let org_id = steps_org("fold-empty", 700);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 900);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);

        let remaining = fold_synthetics_remaining(std::slice::from_ref(&org_id), &[], 202610);
        let r = remaining
            .get(&org_id)
            .expect("an org with no rows has not used the feature — it is not absent");
        assert_eq!(r.browser, 700);
        assert_eq!(r.protocol, 900);
        assert_eq!(
            r.status, 50_000,
            "no row is a month not yet started, so the whole monthly allowance is available",
        );
    }

    /// A row is September's until it says otherwise, so October must read it as unspent
    /// without waiting for the write that resets it.
    #[test]
    fn fold_synthetics_remaining_counts_a_status_row_only_in_its_own_month() {
        let org_id = steps_org("fold-month", 10);
        // Distinct from the 43,200 default, or a fall-through to it reads as the override.
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);
        let rows = vec![db_status_row(&org_id, 12_480, 202609)];

        let in_month = fold_synthetics_remaining(std::slice::from_ref(&org_id), &rows, 202609);
        assert_eq!(in_month.get(&org_id).expect("requested").status, 37_520);

        let next_month = fold_synthetics_remaining(std::slice::from_ref(&org_id), &rows, 202610);
        assert_eq!(
            next_month.get(&org_id).expect("requested").status,
            50_000,
            "a stale September count charged against October's grant gates the org for a month",
        );

        // `period = 0` is the one-time shape; a status row must never be read as lifetime.
        let lifetime = vec![db_status_row(&org_id, 12_480, 0)];
        assert_eq!(
            fold_synthetics_remaining(std::slice::from_ref(&org_id), &lifetime, 202610)
                .get(&org_id)
                .expect("requested")
                .status,
            50_000,
        );
    }

    /// `ORG_LIMITS` is empty for ~10 s after a restart, so a status row's own override wins.
    #[test]
    fn fold_synthetics_remaining_prefers_the_status_rows_own_limit() {
        let org_id = steps_org("fold-status-override", 10);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);
        let mut row = db_status_row(&org_id, 81_000, 202609);
        row.usage_limit = Some(150_000);
        let rows = std::slice::from_ref(&row);

        let remaining = fold_synthetics_remaining(std::slice::from_ref(&org_id), rows, 202609);
        assert_eq!(remaining.get(&org_id).expect("requested").status, 69_000);

        let next_month = fold_synthetics_remaining(std::slice::from_ref(&org_id), rows, 202610);
        assert_eq!(
            next_month.get(&org_id).expect("requested").status,
            150_000,
            "spec §7.4: a stale row is unspent, but its override still stands in October",
        );
    }

    /// E14's force-deduct lets `usage_count` pass `usage_limit`, so the subtraction must saturate.
    #[test]
    fn fold_synthetics_remaining_saturates_when_used_exceeds_the_limit() {
        let org_id = steps_org("fold-saturate", 10);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 10);
        let rows = vec![
            db_row(&org_id, "synthetics_browser_steps", 4_000),
            db_row(&org_id, "synthetics_protocol_steps", 11),
        ];

        let remaining = fold_synthetics_remaining(std::slice::from_ref(&org_id), &rows, 202610);
        let r = remaining.get(&org_id).expect("the org was requested");
        assert_eq!(
            r.browser, 0,
            "a wrapping subtraction hands an over-spent org 18 quintillion free steps",
        );
        assert_eq!(r.protocol, 0);
    }

    /// Both protocol feature keys spend one grant, and a browser row spends neither of them.
    #[test]
    fn fold_synthetics_remaining_sums_a_pools_feature_rows() {
        let org_id = steps_org("fold-sum", 500);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 1_000);
        let rows = vec![
            db_row(&org_id, "synthetics_steps", 300),
            db_row(&org_id, "synthetics_protocol_steps", 200),
            db_row(&org_id, "synthetics_browser_steps", 100),
        ];

        let remaining = fold_synthetics_remaining(std::slice::from_ref(&org_id), &rows, 202610);
        let r = remaining.get(&org_id).expect("the org was requested");
        assert_eq!(
            r.protocol, 500,
            "both protocol feature keys draw down one grant, or the split hands out two",
        );
        assert_eq!(
            r.browser, 400,
            "a browser row must not spend the protocol grant"
        );
    }

    /// `ORG_LIMITS` is empty for ~10s after a restart, so the row's own override is the truth.
    #[test]
    fn fold_synthetics_remaining_prefers_the_rows_own_limit() {
        let org_id = steps_org("fold-override", 100);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 100);
        let mut browser = db_row(&org_id, "synthetics_browser_steps", 50);
        browser.usage_limit = Some(5_000);
        // The protocol pool's two feature rows, with the raise recorded on only one of them.
        let mut protocol = db_row(&org_id, "synthetics_protocol_steps", 50);
        protocol.usage_limit = Some(9_000);
        let mut pre_split = db_row(&org_id, "synthetics_steps", 0);
        pre_split.usage_limit = Some(5_000);

        let remaining = fold_synthetics_remaining(
            std::slice::from_ref(&org_id),
            &[browser, protocol, pre_split],
            202610,
        );
        let r = remaining.get(&org_id).expect("the org was requested");
        assert_eq!(
            r.browser, 4_950,
            "a just-raised limit must not be judged against a stale process-global cache",
        );
        assert_eq!(
            r.protocol, 8_950,
            "the read has no ORDER BY, so a last-row-wins limit hands the gate whichever of a \
             pool's rows arrived last while the org API reports the larger",
        );
    }

    /// Defect #5: the listing reports USED and LIMIT, so the grant it names must be the one the
    /// same rows' spend was measured against — the row's own override, not a stale cache.
    #[test]
    fn fold_synthetics_quota_reports_each_pools_spend_against_its_own_grant() {
        let org_id = steps_org("quota-pools", 4_000);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 1_000);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);
        // The pool's two rows carry different grants, so first-, last- and min-wins each differ.
        let mut pre_split = db_row(&org_id, "synthetics_steps", 300);
        pre_split.usage_limit = Some(5_000);
        let mut protocol = db_row(&org_id, "synthetics_protocol_steps", 200);
        protocol.usage_limit = Some(9_000);
        let rows = vec![
            db_row(&org_id, "synthetics_browser_steps", 900),
            pre_split,
            protocol,
            db_status_row(&org_id, 12_480, 202609),
        ];

        let quota = fold_synthetics_quota(std::slice::from_ref(&org_id), &rows, 202609);
        let q = quota.get(&org_id).expect("the org was requested");
        assert_eq!(
            (q.browser_used, q.browser_limit),
            (900, 4_000),
            "a pool's spend is its own rows against its own grant; the two must come from the \
             same pool",
        );
        assert_eq!(
            (q.protocol_used, q.protocol_limit),
            (500, 9_000),
            "both protocol feature keys draw down one grant, and an admin's row-level raise is \
             the grant they were spent against — the cache still says 1,000; the read has no \
             ORDER BY, so anything but the largest of a pool's rows reports a grant the gate is \
             not enforcing",
        );
        assert_eq!((q.status_used, q.status_limit), (12_480, 50_000));

        let next_month = fold_synthetics_quota(std::slice::from_ref(&org_id), &rows, 202610);
        let q = next_month.get(&org_id).expect("the org was requested");
        assert_eq!(
            (q.status_used, q.status_limit),
            (0, 50_000),
            "September's count reported as October's spend shows an admin a month the org has \
             already left, and the next limit is sized against it",
        );
    }

    /// E14's force-deduct lets `usage_count` pass `usage_limit`, and the admin sizing the next
    /// grant needs the org's real spend, not the grant it already spent past.
    #[test]
    fn fold_synthetics_quota_reports_the_spend_past_an_exhausted_grant() {
        let org_id = steps_org("quota-saturate", 10);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 10);
        let rows = vec![
            db_row(&org_id, "synthetics_browser_steps", 4_000),
            db_row(&org_id, "synthetics_protocol_steps", 11),
        ];

        let quota = fold_synthetics_quota(std::slice::from_ref(&org_id), &rows, 202610);
        let q = quota.get(&org_id).expect("the org was requested");
        assert_eq!(
            (q.browser_used, q.browser_limit),
            (4_000, 10),
            "`used` written as `limit - remaining` saturates to the limit here, so the listing \
             reports a spend of 10 for an org that spent 4,000",
        );
        assert_eq!((q.protocol_used, q.protocol_limit), (11, 10));
    }

    /// An org with no rows has not used the feature; a listing that leaves it out shows a blank
    /// where the grant is.
    #[test]
    fn fold_synthetics_quota_gives_every_requested_org_an_entry() {
        let org_id = steps_org("quota-empty", 700);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 900);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);
        let other = steps_org("quota-other", 5);

        let quota = fold_synthetics_quota(
            std::slice::from_ref(&org_id),
            &[db_row(&other, "synthetics_browser_steps", 4)],
            202610,
        );

        assert_eq!(
            quota.len(),
            1,
            "the fold answers about the orgs it was handed; an extra entry is a row for an org \
             this page never asked about",
        );
        let q = quota
            .get(&org_id)
            .expect("an org with no rows has not used the feature — it is not absent");
        assert_eq!((q.browser_used, q.browser_limit), (0, 700));
        assert_eq!((q.protocol_used, q.protocol_limit), (0, 900));
        assert_eq!((q.status_used, q.status_limit), (0, 50_000));
    }

    /// Defect #5: the listing's numbers are the table's, and the node's own counter cannot move
    /// them.
    #[test]
    fn the_quota_a_listing_reports_follows_the_row_not_the_node() {
        let org_id = steps_org("quota-follows-db", 4_000);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsProtocolSteps, 1_000);
        set_cached_limit(&org_id, TrialQuotaPool::SyntheticsStatusProtocol, 50_000);
        apply_to_pool_counter(&org_id, TrialQuotaPool::SyntheticsBrowserSteps, 7);
        let mut browser = db_row(&org_id, "synthetics_browser_steps", 900);
        browser.usage_limit = Some(6_000);
        // The larger of the pool's two grants comes FIRST here and last in the fold's own test.
        let mut protocol = db_row(&org_id, "synthetics_protocol_steps", 200);
        protocol.usage_limit = Some(9_000);
        let mut pre_split = db_row(&org_id, "synthetics_steps", 300);
        pre_split.usage_limit = Some(5_000);
        let rows = vec![
            browser,
            protocol,
            pre_split,
            db_status_row(&org_id, 12_480, 202610),
        ];

        let quota = fold_synthetics_quota(std::slice::from_ref(&org_id), &rows, 202610);
        let q = quota.get(&org_id).expect("the org was requested");
        assert_eq!(
            q.browser_used, 900,
            "this node's counter says 7 and the next node's says 0; the row is the only number \
             they agree on",
        );

        let remaining = fold_synthetics_remaining(std::slice::from_ref(&org_id), &rows, 202610);
        let r = remaining.get(&org_id).expect("the org was requested");
        // Every pool here is under its grant, so the two halves must add back up to it.
        assert_eq!(
            (q.browser_used + r.browser, q.browser_limit),
            (6_000, 6_000),
            "an org under its grant spends the row's own override, not the 4,000 the cache \
             still holds; a pair that does not add up means the two folds resolved different \
             limits from one row",
        );
        assert_eq!(
            (q.protocol_used + r.protocol, q.protocol_limit),
            (9_000, 9_000),
            "the raise is recorded on one of the pool's two rows, and the gate and the listing \
             must find the same one",
        );
        assert_eq!(
            (q.status_used + r.status, q.status_limit),
            (50_000, 50_000),
            "the monthly pool falls back to the cached grant, and both folds must fall back to \
             the same one",
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

    /// Spec §11.1: the limit write beside it is bounded by the pool it was handed, so a reset
    /// that is not wipes the AI watermark of an org whose synthetics grant was raised.
    #[test]
    fn the_checkpoint_reset_is_scoped_to_the_pool_whose_limit_moved() {
        let source = code_only_source();
        // Assembled at runtime so this test's own source is not what the scan finds.
        let reset = ["reset", "_checkpoint("].concat();
        let limit_write = "pub async fn set_limit_for_pool(";
        let keys = format!("{}.feature_keys()", parameter(&source, limit_write, 1));
        let body = fn_body(&source, limit_write);
        let features = call_args(body, &reset)
            .split_once(',')
            .map_or(String::new(), |(_, rest)| rest.to_string());
        assert!(
            hands_on_all(body, &features, &keys),
            "`seed_feature` is ONE key of the pool and the pre-split `synthetics_steps` row is \
             another, so a reset handed one of `{keys}` leaves the other row's watermark armed \
             — the limit write beside it is bounded by all of them",
        );

        let definition = ["pub async fn reset", "_checkpoint("].concat();
        assert!(
            passes_through(
                call_args(fn_body(&source, &definition), "reset_notified_checkpoint("),
                &parameter(&source, &definition, 1),
            ),
            "the pool stops at this frame and the UPDATE below it is org-wide again",
        );
    }

    /// Every caller resets ONE pool; an argument that spans them all is the org-wide wipe again,
    /// wearing a feature filter.
    #[test]
    fn no_call_site_resets_a_checkpoint_across_pools() {
        // Assembled at runtime so this test's own source is not itself a call site.
        let needle = ["reset", "_checkpoint("].concat();
        let cross_pool = ["all_synthetics_features", "ALL_POOLS", "flat_map", "&[]"];
        let sites = workspace_call_sites(std::slice::from_ref(&needle));
        for (path, args) in &sites {
            let features = without_whitespace(args.split_once(',').map_or("", |(_, rest)| rest));
            assert!(
                !features.is_empty() && !cross_pool.iter().any(|shape| features.contains(shape)),
                "{path}: `{args}` clears the watermark of every pool the org has, not the one \
                 whose limit moved",
            );
        }
        assert!(
            !sites.is_empty(),
            "the scan inspected no call site at all, so the ban above cannot fail",
        );
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

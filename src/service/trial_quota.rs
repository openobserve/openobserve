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

//! Trial Quota Service — in-memory quota counter with DB persistence.
//!
//! Free tier: every org gets a single shared lifetime pool of free credits.
//! All features (AI chat, incidents, etc.) deduct from the same pool.
//! The pool never resets — once consumed, the org must subscribe to continue.
//! Pay-as-you-go: when free credits are exhausted and the org has an active
//! Stripe subscription, AI metering prices are auto-added to the subscription
//! and usage is reported to the _usage stream for billing.
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
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Per-org total usage counter. Single AtomicU64 per org — no cross-key locks.
/// This is the hot-path structure used by `try_deduct`.
static ORG_USAGE: Lazy<RwLock<HashMap<String, AtomicU64>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

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

/// A deduction record buffered for periodic DB flush.
struct FlushRecord {
    org_id: String,
    feature_key: String,
    cost: i64,
}

/// Trial quota feature variants — extensible for future metered features
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrialQuotaFeature {
    AiChat,
    NewIncident,
    IncidentReAnalysis,
}

impl TrialQuotaFeature {
    /// DB key for this feature (stored in `feature` column)
    pub fn feature_key(&self) -> &'static str {
        match self {
            TrialQuotaFeature::AiChat => "ai_chat",
            TrialQuotaFeature::NewIncident => "new_incident",
            TrialQuotaFeature::IncidentReAnalysis => "incident_reanalysis",
        }
    }

    /// Get the credit cost for this feature from enterprise config
    pub fn cost(&self) -> u64 {
        let cfg = o2_enterprise::enterprise::common::config::get_config();
        match self {
            TrialQuotaFeature::AiChat => cfg.cloud.ai_credit_cost_chat,
            TrialQuotaFeature::NewIncident => cfg.cloud.ai_credit_cost_incident,
            TrialQuotaFeature::IncidentReAnalysis => cfg.cloud.ai_credit_cost_incident_reanalysis,
        }
    }

    /// Get the corresponding UsageEvent variant
    pub fn usage_event(&self) -> UsageEvent {
        match self {
            TrialQuotaFeature::AiChat => UsageEvent::AiChat,
            TrialQuotaFeature::NewIncident => UsageEvent::NewIncident,
            TrialQuotaFeature::IncidentReAnalysis => UsageEvent::IncidentReAnalysis,
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

/// Get the shared pool limit (same for all orgs, from config)
fn get_pool_limit() -> u64 {
    o2_enterprise::enterprise::common::config::get_config()
        .cloud
        .ai_free_credit_pool
}

/// Get total usage across all features for an org (single atomic read)
fn get_org_total_used(org_id: &str) -> u64 {
    let map = ORG_USAGE.read().unwrap();
    map.get(org_id)
        .map(|v| v.load(Ordering::Relaxed))
        .unwrap_or(0)
}

/// Ensure the per-org atomic counter exists.
/// If the org is new, inserts an AtomicU64(0) under a brief write lock.
fn ensure_org_counter(org_id: &str) {
    {
        let map = ORG_USAGE.read().unwrap();
        if map.contains_key(org_id) {
            return;
        }
    }
    // Use entry() instead of direct insert because another thread may have
    // inserted between us dropping the read lock above and acquiring this write lock.
    let mut map = ORG_USAGE.write().unwrap();
    map.entry(org_id.to_string())
        .or_insert_with(|| AtomicU64::new(0));
}

/// Atomically add a delta to the org's in-memory counter.
/// Used by the HA consumer to apply remote deductions.
fn add_to_org_counter(org_id: &str, delta: u64) {
    ensure_org_counter(org_id);
    let map = ORG_USAGE.read().unwrap();
    if let Some(counter) = map.get(org_id) {
        counter.fetch_add(delta, Ordering::Relaxed);
    }
}

/// HA message broadcast to other nodes after a deduction.
/// Contains the delta (cost) so receivers can add it to their local counter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialQuotaHaMsg {
    pub org_id: String,
    pub cost: u64,
    pub source_node: Node,
    /// Microsecond timestamp of when the deduction happened.
    /// Used to skip messages older than the DB snapshot loaded at init.
    pub timestamp: i64,
}

/// Check if the org has an active Stripe subscription (valid subscription_id + customer_id).
pub async fn org_has_active_subscription(org_id: &str) -> bool {
    if let Ok(Some(sub)) =
        o2_enterprise::enterprise::cloud::billings::get_billing_by_org_id(org_id).await
    {
        !sub.subscription_type.is_free_sub()
    } else {
        false
    }
}

/// Try to deduct credits from the org's shared pool for a feature.
///
/// Returns `Ok(remaining)` on success, or `Err(QuotaExhaustedError)` when
/// the shared pool is depleted.
///
/// The limit check is against the total usage across ALL features for the org,
/// not per-feature. The per-feature counter is still tracked for breakdown.
pub async fn try_deduct(
    org_id: &str,
    feature: TrialQuotaFeature,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let cost = feature.cost();
    let pool_limit = get_pool_limit();

    log::info!(
        "[TRIAL_QUOTA] try_deduct called: org={} feature={} cost={} pool_limit={}",
        org_id,
        feature,
        cost,
        pool_limit,
    );

    // Ensure the org has an atomic counter
    ensure_org_counter(org_id);

    // Single atomic CAS loop on the org-level total — no cross-key locks.
    // The RwLockReadGuard must be dropped before any .await, so the entire
    // CAS loop runs synchronously, then we do async work after.
    let deduct_result = {
        let map = ORG_USAGE.read().unwrap();
        let counter = map.get(org_id).unwrap(); // safe: ensure_org_counter just ran

        loop {
            let current = counter.load(Ordering::Relaxed);
            let new_total = current + cost;
            if new_total > pool_limit {
                log::info!(
                    "[TRIAL_QUOTA] quota exhausted: org={} feature={} current_used={} cost={} pool_limit={}",
                    org_id,
                    feature,
                    current,
                    cost,
                    pool_limit,
                );
                break Err(QuotaExhaustedError {
                    usage_count: current,
                    usage_limit: pool_limit,
                });
            }
            // Atomic compare-and-swap: only succeeds if no one else incremented
            if counter
                .compare_exchange(current, new_total, Ordering::AcqRel, Ordering::Relaxed)
                .is_ok()
            {
                log::info!(
                    "[TRIAL_QUOTA] deducted: org={} feature={} cost={} total_used={}/{} remaining={}",
                    org_id,
                    feature,
                    cost,
                    new_total,
                    pool_limit,
                    pool_limit - new_total,
                );
                break Ok(new_total);
            }
            // CAS failed — another thread incremented first, retry
        }
    }; // RwLockReadGuard dropped here

    match deduct_result {
        Err(e) => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
        Ok(new_total) => {
            // Buffer the deduction for periodic DB flush (non-blocking)
            if let Err(e) = FLUSH_TX.try_send(FlushRecord {
                org_id: org_id.to_string(),
                feature_key: feature.feature_key().to_string(),
                cost: cost as i64,
            }) {
                log::warn!(
                    "[TRIAL_QUOTA] Flush channel full, dropping record for org={}: {e}",
                    org_id
                );
            }

            // Broadcast delta to other nodes via NATS queue
            // Skip if single node — no other nodes to sync with
            if !LOCAL_NODE.is_single_node() {
                let msg = TrialQuotaHaMsg {
                    org_id: org_id.to_string(),
                    cost,
                    source_node: LOCAL_NODE.clone(),
                    timestamp: config::utils::time::now_micros(),
                };
                if let Err(e) = publish_ha_msg(&msg).await {
                    log::warn!(
                        "[TRIAL_QUOTA] Failed to broadcast delta for org={}: {e}",
                        org_id
                    );
                }
            }

            Ok(pool_limit - new_total)
        }
    }
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
/// Each message carries `(org_id, cost, source_node)`. Messages from self
/// are skipped. The delta is atomically added to the local counter.
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

        let old = get_org_total_used(&ha_msg.org_id);
        add_to_org_counter(&ha_msg.org_id, ha_msg.cost);
        let new_total = get_org_total_used(&ha_msg.org_id);

        log::info!(
            "[TRIAL_QUOTA] HA sync: org={} delta={} total {}->{}",
            ha_msg.org_id,
            ha_msg.cost,
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

/// Get remaining credits in the org's shared pool
pub fn get_remaining(org_id: &str) -> u64 {
    let limit = get_pool_limit();
    let used = get_org_total_used(org_id);
    limit.saturating_sub(used)
}

/// Get total credits used across all features for an org
pub fn get_used(org_id: &str) -> u64 {
    get_org_total_used(org_id)
}

/// Get the pool limit (same for all orgs)
pub fn get_limit(_org_id: &str) -> u64 {
    get_pool_limit()
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
    };

    // Feature breakdown event (informational, not billed)
    let feature_event = UsageData {
        event: feature.usage_event(),
        size: 1.0,
        unit: "count".to_string(),
        ..credit_event.clone()
    };

    crate::service::self_reporting::report_usage(vec![credit_event, feature_event]);
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
#[derive(Debug, Serialize, Deserialize)]
pub struct AiUsageResponse {
    pub mode: String,
    pub credits_used: u64,
    pub credits_limit: u64,
    pub credits_remaining: u64,
}

/// Get AI usage info for an org (for the usage API endpoint).
/// Reports the single shared pool across all AI features.
/// Reads from DB for accuracy (not in-memory cache).
///
/// Mode is derived from actual state:
/// - `"free"`: credits remaining in pool
/// - `"pay_as_you_go"`: credits exhausted + active subscription
/// - `"exhausted"`: credits exhausted + no subscription
pub async fn get_usage(org_id: &str) -> AiUsageResponse {
    let limit = get_pool_limit();
    let in_memory_used = get_org_total_used(org_id);

    // Read from DB for accuracy
    let db_used = match infra::table::trial_quota_usage::get_total_usage_for_org(org_id).await {
        Ok(total) => {
            log::info!(
                "[TRIAL_QUOTA] get_usage: org={} db_total={} in_memory_total={} pool_limit={}",
                org_id,
                total,
                in_memory_used,
                limit,
            );
            total as u64
        }
        Err(e) => {
            log::warn!(
                "[TRIAL_QUOTA] get_usage: org={} DB read failed (falling back to cache={}): {e}",
                org_id,
                in_memory_used,
            );
            in_memory_used
        }
    };

    let used = db_used;
    let remaining = limit.saturating_sub(used);

    let mode = if remaining > 0 {
        "free"
    } else if org_has_active_subscription(org_id).await {
        "pay_as_you_go"
    } else {
        "exhausted"
    };

    AiUsageResponse {
        mode: mode.to_string(),
        credits_used: used,
        credits_limit: limit,
        credits_remaining: remaining,
    }
}

/// Get the current usage percentage for an org (0–100, clamped).
pub fn get_quota_percentage(org_id: &str) -> u8 {
    let limit = get_pool_limit();
    if limit == 0 {
        return 100;
    }
    let used = get_org_total_used(org_id);
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
    if let Err(e) = infra::table::trial_quota_usage::update_notified_checkpoint(org_id, 0).await {
        log::error!("[AI_QUOTA] Failed to reset checkpoint for org={org_id}: {e}");
    }
}

/// Build the email message for a given checkpoint and org type (free vs paid).
pub fn build_quota_email_message(
    org_id: &str,
    org_name: &str,
    checkpoint: u8,
    is_paid: bool,
    used: u64,
    limit: u64,
) -> (String, String) {
    let display_name = if org_name.is_empty() {
        org_id
    } else {
        org_name
    };
    let subject = format!(
        "[OpenObserve] AI Credits: {}% used — {display_name}",
        checkpoint
    );

    let message = match (checkpoint, is_paid) {
        (80, false) => format!(
            "You've used 80% of your free AI credits ({used}/{limit}). Subscribe to a plan for uninterrupted AI access."
        ),
        (80, true) => format!(
            "You've used 80% of your free AI credits ({used}/{limit}). Once exhausted, AI usage will be billed to your subscription."
        ),
        (90, false) => format!(
            "You've used 90% of your free AI credits ({used}/{limit}). Subscribe now to avoid losing access."
        ),
        (90, true) => format!(
            "You've used 90% of your free AI credits ({used}/{limit}). Pay-as-you-go billing will start soon."
        ),
        (95, false) => format!(
            "Only 5% of your free AI credits remain ({used}/{limit}). Subscribe immediately to continue using AI."
        ),
        (95, true) => format!(
            "Only 5% of your free AI credits remain ({used}/{limit}). Pay-as-you-go billing is about to start."
        ),
        (100, false) => format!(
            "Your free AI credits are exhausted ({used}/{limit}). Subscribe to resume AI features."
        ),
        (100, true) => format!(
            "Your free AI credits are exhausted ({used}/{limit}). AI usage is now billed to your subscription via pay-as-you-go."
        ),
        _ => format!("You've used {checkpoint}% of your free AI credits ({used}/{limit})."),
    };

    let body = format!(
        "<html><body>\
        <h2>AI Credit Usage Alert</h2>\
        <p><strong>Organization:</strong> {display_name} ({org_id})</p>\
        <p>{message}</p>\
        <p><strong>Credits used:</strong> {used} / {limit}</p>\
        <p><a href=\"https://cloud.openobserve.ai/billings\">View Billing</a></p>\
        </body></html>"
    );

    (subject, body)
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

            // Sum per-feature counts into per-org totals
            let mut org_totals: HashMap<String, u64> = HashMap::new();
            for record in &records {
                *org_totals.entry(record.org_id.clone()).or_default() += record.usage_count as u64;
            }

            // Populate ORG_USAGE with totals
            {
                let mut map = ORG_USAGE.write().unwrap();
                for (org_id, total) in org_totals {
                    map.insert(org_id, AtomicU64::new(total));
                }
            }

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

    // --- build_quota_email_message ---

    #[test]
    fn test_email_subject_contains_percentage_and_org_name() {
        let (subject, _) = build_quota_email_message("org1", "My Org", 80, false, 80, 100);
        assert!(subject.contains("80%"), "subject: {subject}");
        assert!(subject.contains("My Org"), "subject: {subject}");
    }

    #[test]
    fn test_email_subject_uses_org_id_when_name_empty() {
        let (subject, _) = build_quota_email_message("org1", "", 80, false, 80, 100);
        assert!(subject.contains("org1"), "subject: {subject}");
    }

    #[test]
    fn test_email_body_contains_org_and_credits() {
        let (_, body) = build_quota_email_message("org1", "My Org", 90, true, 90, 100);
        assert!(body.contains("My Org"), "body missing org name");
        assert!(body.contains("90"), "body missing used credits");
        assert!(body.contains("100"), "body missing limit");
    }

    #[test]
    fn test_email_80_free_mentions_subscribe() {
        let (_, body) = build_quota_email_message("o", "o", 80, false, 80, 100);
        assert!(
            body.to_lowercase().contains("subscribe"),
            "free 80% should mention subscribe"
        );
    }

    #[test]
    fn test_email_80_paid_mentions_billing() {
        let (_, body) = build_quota_email_message("o", "o", 80, true, 80, 100);
        assert!(
            body.to_lowercase().contains("billed") || body.to_lowercase().contains("billing"),
            "paid 80% should mention billing"
        );
    }

    #[test]
    fn test_email_100_free_credits_exhausted() {
        let (_, body) = build_quota_email_message("o", "o", 100, false, 100, 100);
        assert!(
            body.to_lowercase().contains("exhaust"),
            "100% free should mention exhausted"
        );
    }

    #[test]
    fn test_email_100_paid_pay_as_you_go() {
        let (_, body) = build_quota_email_message("o", "o", 100, true, 100, 100);
        assert!(
            body.to_lowercase().contains("pay-as-you-go") || body.to_lowercase().contains("billed"),
            "100% paid should mention pay-as-you-go"
        );
    }

    #[test]
    fn test_email_unknown_checkpoint_fallback() {
        let (_, body) = build_quota_email_message("o", "o", 50, false, 50, 100);
        assert!(body.contains("50%"), "fallback should include percentage");
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

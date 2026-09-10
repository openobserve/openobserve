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

//! Alert grouping and batching for deduplication
//!
//! Implements wait-and-collect logic to batch multiple alerts with the same
//! fingerprint before sending a single grouped notification.

use std::sync::{Arc, LazyLock as Lazy};

use chrono::Utc;
use config::{
    meta::{
        alerts::alert::Alert,
        self_reporting::usage::{RunOutcome, TriggerData},
    },
    utils::json,
};
use dashmap::DashMap;

/// Keyed per tenant: a fingerprint carries no org, so two orgs would share one batch.
static PENDING_BATCHES: Lazy<Arc<DashMap<String, PendingBatch>>> =
    Lazy::new(|| Arc::new(DashMap::new()));

/// A batch of alerts waiting to be sent together
#[derive(Clone, Debug)]
pub struct PendingBatch {
    pub fingerprint: String,
    /// Group identity for a per-group batch (§5.5). `None` for an ordinary
    /// alert-level batch. Every entry shares the batch's fingerprint, and the
    /// group is part of that fingerprint, so one batch is always one group.
    pub group_labels: Option<std::collections::BTreeMap<String, String>>,
    pub org_id: String,
    pub alerts: Vec<BatchedAlert>,
    pub timer_started_at: i64,
    pub group_wait_seconds: i64,
    pub max_group_size: usize,
    /// Evaluated level shared by every entry in this batch. Well-defined
    /// because the fingerprint carries the level as an implicit component for
    /// multi-level alerts — a Warning batch and a Critical batch are distinct.
    pub level: Option<config::meta::alerts::level::AlertLevel>,
}

/// An alert waiting in a batch
#[derive(Clone, Debug)]
pub struct BatchedAlert {
    pub alert: Alert,
    pub rows: Vec<json::Map<String, json::Value>>,
    pub timestamp: i64,
    /// This evaluation's history row, held back until the flush decides its delivery.
    pub trigger_data: TriggerData,
}

/// Destinations were contacted and the send failed, wholly or partially.
#[derive(Debug)]
pub struct GroupedSendError(pub String);

/// What the batcher did with an evaluation handed to [`add_to_batch`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchAdmission {
    /// Collected into a batch that is still waiting; the flush publishes its row.
    Queued,
    /// Collected into a batch that is now full; the caller must flush it immediately.
    Ready,
    /// The batch was full and not yet taken, so this evaluation joined no batch at all.
    Refused,
}

impl PendingBatch {
    /// Create a new pending batch
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        fingerprint: String,
        org_id: String,
        alert: Alert,
        rows: Vec<json::Map<String, json::Value>>,
        trigger_data: TriggerData,
        group_wait_seconds: i64,
        max_group_size: usize,
        level: Option<config::meta::alerts::level::AlertLevel>,
        group_labels: Option<std::collections::BTreeMap<String, String>>,
    ) -> Self {
        let now = Utc::now().timestamp_micros();
        Self {
            fingerprint,
            group_labels,
            org_id,
            alerts: vec![BatchedAlert {
                alert,
                rows,
                timestamp: now,
                trigger_data,
            }],
            timer_started_at: now,
            group_wait_seconds,
            max_group_size,
            level,
        }
    }

    /// Add an alert to this batch
    pub fn add_alert(
        &mut self,
        alert: Alert,
        rows: Vec<json::Map<String, json::Value>>,
        trigger_data: TriggerData,
    ) -> bool {
        if self.alerts.len() >= self.max_group_size {
            return false; // Batch full
        }

        let now = Utc::now().timestamp_micros();
        self.alerts.push(BatchedAlert {
            alert,
            rows,
            timestamp: now,
            trigger_data,
        });
        true
    }

    /// Check if batch wait time has expired
    pub fn is_expired(&self) -> bool {
        let now = Utc::now().timestamp_micros();
        let elapsed_seconds = (now - self.timer_started_at) / 1_000_000;
        elapsed_seconds >= self.group_wait_seconds
    }

    /// Check if batch is at max capacity
    pub fn is_full(&self) -> bool {
        self.alerts.len() >= self.max_group_size
    }
}

impl std::fmt::Display for GroupedSendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for GroupedSendError {}

/// The fingerprint has no org component, so the map key must supply the tenant isolation.
fn batch_key(org_id: &str, fingerprint: &str) -> String {
    format!("{org_id}/{fingerprint}")
}

/// Add alert to pending batch or create new batch, reporting whether it was collected at all.
#[allow(clippy::too_many_arguments)]
pub fn add_to_batch(
    fingerprint: String,
    org_id: String,
    alert: Alert,
    rows: Vec<json::Map<String, json::Value>>,
    trigger_data: TriggerData,
    group_wait_seconds: i64,
    max_group_size: usize,
    level: Option<config::meta::alerts::level::AlertLevel>,
    // Group identity when this is a per-group batch (§5.5). Every entry
    // sharing a fingerprint shares a group, because the group is part of the
    // fingerprint — so this is set once, when the batch is created.
    group_labels: Option<std::collections::BTreeMap<String, String>>,
) -> BatchAdmission {
    let mut batch_ready = false;
    let mut is_new_batch = false;
    let mut refused = false;

    PENDING_BATCHES
        .entry(batch_key(&org_id, &fingerprint))
        .and_modify(|batch| {
            if batch.add_alert(alert.clone(), rows.clone(), trigger_data.clone()) {
                log::debug!(
                    "[grouping] Added alert '{}' to existing batch {} (count: {}/{})",
                    alert.name,
                    fingerprint,
                    batch.alerts.len(),
                    batch.max_group_size
                );
                if batch.is_full() {
                    batch_ready = true;
                    log::info!(
                        "[grouping] Batch {} reached max size ({}), ready to send",
                        fingerprint,
                        batch.max_group_size
                    );
                }
            } else {
                refused = true;
                log::warn!(
                    "[grouping] Failed to add alert '{}' to batch {} (already full)",
                    alert.name,
                    fingerprint
                );
            }
        })
        .or_insert_with(|| {
            is_new_batch = true;
            // A new batch holds one alert, so a `max_group_size` of 1 makes it full on creation.
            batch_ready = max_group_size <= 1;
            log::info!(
                "[grouping] Created new batch for fingerprint {}, alert: '{}', org: {}, wait_seconds: {}, max_size: {}",
                fingerprint,
                alert.name,
                org_id,
                group_wait_seconds,
                max_group_size
            );
            PendingBatch::new(
                fingerprint.clone(),
                org_id.clone(),
                alert,
                rows,
                trigger_data,
                group_wait_seconds,
                max_group_size,
                level,
                group_labels,
            )
        });

    if is_new_batch {
        // The gauge is per-org, so it must count this org's batches, not the whole map.
        let batch_count = get_pending_batch_count(&org_id);
        log::debug!("[grouping] Pending batches for org {org_id}: {batch_count}");

        config::metrics::ALERT_GROUPING_BATCHES_PENDING
            .with_label_values(&[org_id.as_str()])
            .set(batch_count);
    }

    if refused {
        BatchAdmission::Refused
    } else if batch_ready {
        BatchAdmission::Ready
    } else {
        BatchAdmission::Queued
    }
}

/// Get and remove a batch if it's ready (expired or full)
pub fn get_ready_batch(org_id: &str, fingerprint: &str) -> Option<PendingBatch> {
    // Readiness is judged under the removing write lock: a `get` guard across `remove` deadlocks.
    let batch = PENDING_BATCHES
        .remove_if(&batch_key(org_id, fingerprint), |_, batch| {
            batch.is_expired() || batch.is_full()
        })
        .map(|(_, batch)| batch);
    if let Some(ref b) = batch {
        log::debug!(
            "[grouping] Retrieved ready batch for fingerprint {} ({} alerts)",
            fingerprint,
            b.alerts.len()
        );
    }
    batch
}

/// Get all expired batches
pub fn get_expired_batches() -> Vec<PendingBatch> {
    let mut expired = Vec::new();
    let now = Utc::now().timestamp_micros();

    PENDING_BATCHES.retain(|key, batch| {
        if batch.is_expired() {
            let elapsed_seconds = (now - batch.timer_started_at) / 1_000_000;
            log::info!(
                "[grouping] Batch {} expired after {}s with {} alerts",
                key,
                elapsed_seconds,
                batch.alerts.len()
            );
            expired.push(batch.clone());
            false // Remove from map
        } else {
            true // Keep in map
        }
    });

    if !expired.is_empty() {
        log::debug!(
            "[grouping] Found {} expired batches, {} still pending",
            expired.len(),
            PENDING_BATCHES.len()
        );
    }

    expired
}

/// Get count of pending batches for an organization
pub fn get_pending_batch_count(org_id: &str) -> i64 {
    PENDING_BATCHES
        .iter()
        .filter(|entry| entry.org_id == org_id)
        .count() as i64
}

/// One held-back history row per evaluation in a batch, built before the send consumes it.
pub fn flush_rows(batch: &PendingBatch) -> Vec<TriggerData> {
    let group_size = batch.alerts.len() as i32;
    batch
        .alerts
        .iter()
        .map(|batched| TriggerData {
            dedup_enabled: Some(true),
            grouped: Some(true),
            // The real membership of the batch that was sent, not the configured maximum.
            group_size: Some(group_size),
            ..batched.trigger_data.clone()
        })
        .collect()
}

/// The row of an evaluation the batcher refused: it matched, nothing went out, nothing was tried.
pub fn refused_row(trigger_data: &TriggerData) -> TriggerData {
    TriggerData {
        status: RunOutcome::NotifyFailed,
        error: Some(
            "alert grouping batch was already full; this evaluation joined no batch and no \
             notification was sent"
                .to_string(),
        ),
        dedup_enabled: Some(true),
        grouped: Some(false),
        delivery_attempted: Some(false),
        ..trigger_data.clone()
    }
}

pub fn stamp_flush_delivery(rows: &mut [TriggerData], attempted: bool) {
    for row in rows {
        row.delivery_attempted = Some(attempted);
    }
}

pub fn stamp_flush_error(rows: &mut [TriggerData], error: &GroupedSendError) {
    let text = format!("error sending notification for alert: {error}");
    for row in rows {
        // The query succeeded; `Error` here would recount N firings as N evaluation errors.
        row.status = RunOutcome::NotifyFailed;
        row.error = Some(text.clone());
        row.delivery_attempted = Some(true);
    }
}

/// `Ok(true)` when a destination or workflow was contacted, `Ok(false)` when nothing was wired.
#[cfg(feature = "enterprise")]
pub async fn send_grouped_notification(
    trace_id: &str,
    batch: crate::alerts::grouping::PendingBatch,
) -> Result<bool, GroupedSendError> {
    use config::meta::alerts::deduplication::SendStrategy;

    use crate::alerts::alert::AlertExt;

    let elapsed_seconds =
        (chrono::Utc::now().timestamp_micros() - batch.timer_started_at) / 1_000_000;

    log::info!(
        "[alert_grouping_worker] Sending grouped notification for {} alerts with fingerprint {} (waited {}s)",
        batch.alerts.len(),
        batch.fingerprint,
        elapsed_seconds
    );

    // Record wait time metric
    config::metrics::ALERT_GROUPING_WAIT_TIME
        .with_label_values(&[batch.org_id.as_str()])
        .observe(elapsed_seconds as f64);

    // Get the first alert (primary) and grouping config
    let primary_alert = &batch.alerts[0].alert;
    // The batch holds the alert's own clone, admitted only under an enabled grouping config.
    let send_strategy = primary_alert
        .deduplication
        .as_ref()
        .and_then(|d| d.grouping.as_ref())
        .map(|g| g.send_strategy.clone())
        .unwrap_or_default();

    // Collect alert details
    let alert_names: Vec<String> = batch.alerts.iter().map(|a| a.alert.name.clone()).collect();

    let alert_count = batch.alerts.len();
    let suppressed_count = alert_count.saturating_sub(1);

    // Build notification context based on strategy
    let notification_context = match send_strategy {
        SendStrategy::FirstWithCount => {
            // "Alert a60 fired (2 others suppressed: a80, a90)"
            if suppressed_count > 0 {
                let suppressed_names = alert_names[1..].join(", ");
                format!(
                    "Alert '{}' fired ({} other{} suppressed: {})",
                    alert_names[0],
                    suppressed_count,
                    if suppressed_count == 1 { "" } else { "s" },
                    suppressed_names
                )
            } else {
                format!("Alert '{}' fired", alert_names[0])
            }
        }
        SendStrategy::Summary => {
            // "3 alerts fired: a60, a80, a90"
            format!(
                "{} alert{} fired: {}",
                alert_count,
                if alert_count == 1 { "" } else { "s" },
                alert_names.join(", ")
            )
        }
        SendStrategy::All => {
            // Full details of each alert
            let mut details = vec![format!("Grouped Alerts ({} total)", alert_count)];
            for (i, batched) in batch.alerts.iter().enumerate() {
                details.push(format!(
                    "\n{}. Alert: '{}'\n   Triggered at: {}\n   Rows matched: {}",
                    i + 1,
                    batched.alert.name,
                    chrono::DateTime::<chrono::Utc>::from_timestamp(
                        batched.timestamp / 1_000_000,
                        0
                    )
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| "unknown".to_string()),
                    batched.rows.len()
                ));
            }
            details.join("\n")
        }
    };

    log::info!(
        "[alert_grouping_worker] Strategy: {:?}, Sending notification with context: {}",
        send_strategy,
        notification_context.chars().take(200).collect::<String>() // Log first 200 chars
    );

    // Prepare combined trigger data based on strategy
    let combined_rows = match send_strategy {
        SendStrategy::FirstWithCount | SendStrategy::Summary => {
            // For FirstWithCount and Summary, just use the first alert's data
            batch.alerts[0].rows.clone()
        }
        SendStrategy::All => {
            // For All, combine all rows from all alerts
            let mut all_rows = Vec::new();
            for batched in &batch.alerts {
                all_rows.extend(batched.rows.clone());
            }
            all_rows
        }
    };

    // Use the primary alert for notification and inject grouped context
    let mut notification_alert = primary_alert.clone();

    // Inject grouped context into context_attributes for template access
    let mut context_attrs = notification_alert.context_attributes.unwrap_or_default();
    context_attrs.insert("grouped_alerts".to_string(), alert_names.join(", "));
    context_attrs.insert("alert_count".to_string(), alert_count.to_string());
    context_attrs.insert("grouped_summary".to_string(), notification_context.clone());
    context_attrs.insert("is_grouped".to_string(), "true".to_string());
    notification_alert.context_attributes = Some(context_attrs);

    // Get the timestamp for notification
    let rows_end_time = batch
        .alerts
        .iter()
        .map(|a| a.timestamp)
        .max()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_micros());

    let start_time = batch.alerts.iter().map(|a| a.timestamp).min();

    let evaluation_timestamp = chrono::Utc::now().timestamp_micros();

    // Send notification using alert's send_notification method
    match notification_alert
        .send_notification(
            trace_id,
            &combined_rows,
            rows_end_time,
            start_time,
            evaluation_timestamp,
            // Well-defined for the whole batch: the fingerprint carries the
            // level as an implicit component for multi-level alerts, so every
            // entry classified the same. `{alert_level}` renders it.
            batch.level,
            // A batch aggregates several evaluations; no single exact count
            // describes it — `{alert_count}` falls back to the row total.
            None,
            // Group identity for a batched per-group send (M-4). Every entry
            // in a batch shares one fingerprint, and the group component is
            // part of that fingerprint, so the whole batch is one group.
            batch.group_labels.as_ref(),
            &[],
        )
        .await
    {
        Ok(outcome) => {
            let nothing_to_deliver = outcome.nothing_to_deliver;
            let (success_msg, err_msg) = (outcome.success_message, outcome.error_message);
            if !err_msg.is_empty() {
                log::error!(
                    "[alert_grouping_worker] Some destinations failed for grouped notification (fingerprint: {}): {}",
                    batch.fingerprint,
                    err_msg
                );
                // Record error metric
                config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                    .with_label_values(&[batch.org_id.as_str(), "partial_failure"])
                    .inc();
                return Err(GroupedSendError(format!("Partial failure: {err_msg}")));
            }

            // Record successful send metrics
            let strategy_str = format!("{:?}", send_strategy).to_lowercase();
            let reason = if elapsed_seconds >= batch.group_wait_seconds {
                "expired"
            } else {
                "max_size"
            };

            config::metrics::ALERT_GROUPING_NOTIFICATIONS_SENT_TOTAL
                .with_label_values(&[batch.org_id.as_str(), strategy_str.as_str(), reason])
                .inc();

            config::metrics::ALERT_GROUPING_BATCH_SIZE
                .with_label_values(&[batch.org_id.as_str(), strategy_str.as_str()])
                .observe(alert_count as f64);

            log::info!(
                "[alert_grouping_worker] Successfully sent grouped notification (fingerprint: {}): {}",
                batch.fingerprint,
                success_msg
            );
            Ok(!nothing_to_deliver)
        }
        Err(e) => {
            log::error!(
                "[alert_grouping_worker] Failed to send grouped notification (fingerprint: {}): {}",
                batch.fingerprint,
                e
            );
            // Record error metric
            config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                .with_label_values(&[batch.org_id.as_str(), "send_failed"])
                .inc();
            Err(GroupedSendError(format!("Send failed: {e}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::self_reporting::usage::TriggerDataType;

    use super::*;

    fn make_alert() -> Alert {
        serde_json::from_value(serde_json::json!({})).unwrap()
    }

    fn make_named_alert(name: &str, id: &str) -> Alert {
        serde_json::from_value(serde_json::json!({ "name": name, "id": id })).unwrap()
    }

    /// The row `handle_alert_triggers` holds back at enqueue, as it builds it for a firing.
    fn enqueue_row(alert: &Alert, org: &str) -> TriggerData {
        TriggerData {
            _timestamp: 1_700_000_000_000_000,
            org: org.to_string(),
            module: TriggerDataType::Alert,
            key: format!("{}/{}", alert.name, alert.get_unique_key()),
            next_run_at: 1_700_000_300_000_000,
            status: RunOutcome::Firing,
            start_time: 1_699_999_700_000_000,
            end_time: 1_700_000_000_000_000,
            retries: 2,
            delay_in_secs: Some(4),
            source_node: Some("node-7".to_string()),
            scheduler_trace_id: Some("eval-trace".to_string()),
            time_in_queue_ms: Some(11),
            ..Default::default()
        }
    }

    #[test]
    fn test_pending_batch_new_has_one_alert() {
        let batch = PendingBatch::new(
            "fp1".to_string(),
            "myorg".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            30,
            10,
            None,
            None,
        );
        assert_eq!(batch.alerts.len(), 1);
        assert!(!batch.is_full());
    }

    #[test]
    fn test_pending_batch_is_full_at_capacity() {
        let mut batch = PendingBatch::new(
            "fp2".to_string(),
            "myorg".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            30,
            2,
            None,
            None,
        );
        assert!(!batch.is_full());
        let added = batch.add_alert(make_alert(), vec![], TriggerData::default());
        assert!(added);
        assert!(batch.is_full());
    }

    #[test]
    fn test_pending_batch_add_alert_returns_false_when_full() {
        let mut batch = PendingBatch::new(
            "fp3".to_string(),
            "myorg".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            30,
            1,
            None,
            None,
        );
        assert!(batch.is_full());
        let added = batch.add_alert(make_alert(), vec![], TriggerData::default());
        assert!(!added);
        assert_eq!(batch.alerts.len(), 1);
    }

    #[test]
    fn test_pending_batch_not_expired_immediately() {
        let batch = PendingBatch::new(
            "fp4".to_string(),
            "myorg".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600, // 1 hour wait
            10,
            None,
            None,
        );
        assert!(!batch.is_expired());
    }

    #[test]
    fn test_add_to_batch_creates_new_batch() {
        let fp = "grouping_test_add_creates_new_batch_unique".to_string();
        let key = batch_key("org-test-add", &fp);
        PENDING_BATCHES.remove(&key);

        let ready = add_to_batch(
            fp.clone(),
            "org-test-add".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            10,
            None,
            None,
        );
        assert_eq!(ready, BatchAdmission::Queued);
        assert!(PENDING_BATCHES.contains_key(&key));

        PENDING_BATCHES.remove(&key);
    }

    #[test]
    fn test_add_to_batch_reports_ready_when_full() {
        let fp = "grouping_test_add_batch_full_unique".to_string();
        let key = batch_key("org-test-full", &fp);
        PENDING_BATCHES.remove(&key);

        let ready1 = add_to_batch(
            fp.clone(),
            "org-test-full".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            2,
            None,
            None,
        );
        assert_eq!(ready1, BatchAdmission::Queued); // new batch, 1 alert, not full

        let ready2 = add_to_batch(
            fp.clone(),
            "org-test-full".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            2,
            None,
            None,
        );
        assert_eq!(ready2, BatchAdmission::Ready); // 2nd alert fills batch

        PENDING_BATCHES.remove(&key);
    }

    /// `max_group_size = 1` is a valid config, and such a batch is full the moment it is created.
    #[test]
    fn test_add_to_batch_reports_ready_when_the_new_batch_is_born_full() {
        let fp = "grouping_test_add_born_full_unique".to_string();
        let org = "org-test-born-full";
        PENDING_BATCHES.remove(&batch_key(org, &fp));
        let a = make_named_alert("disk_full", &config::ider::uuid());

        let admission = add_to_batch(
            fp.clone(),
            org.to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, org),
            3600,
            1,
            None,
            None,
        );

        assert_eq!(admission, BatchAdmission::Ready);
        let batch = get_ready_batch(org, &fp).expect("a batch born full flushes inline");
        assert_eq!(batch.alerts.len(), 1);
        assert!(!PENDING_BATCHES.contains_key(&batch_key(org, &fp)));
    }

    /// The fingerprint carries no org, so one shared between tenants must not share a batch.
    #[test]
    fn test_two_orgs_sharing_a_fingerprint_keep_separate_batches() {
        let fp = "grouping_test_cross_org_isolation_unique".to_string();
        let (org_a, org_b) = ("org-test-tenant-a", "org-test-tenant-b");
        PENDING_BATCHES.remove(&batch_key(org_a, &fp));
        PENDING_BATCHES.remove(&batch_key(org_b, &fp));
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let b = make_named_alert("disk_full", &config::ider::uuid());

        for (org, alert) in [(org_a, &a), (org_b, &b)] {
            add_to_batch(
                fp.clone(),
                org.to_string(),
                alert.clone(),
                vec![],
                enqueue_row(alert, org),
                3600,
                10,
                None,
                None,
            );
        }

        let batch_a = PENDING_BATCHES
            .get(&batch_key(org_a, &fp))
            .map(|e| e.clone())
            .expect("org a keeps its own batch");
        let batch_b = PENDING_BATCHES
            .get(&batch_key(org_b, &fp))
            .map(|e| e.clone())
            .expect("org b keeps its own batch");
        assert_eq!(batch_a.org_id, org_a);
        assert_eq!(batch_b.org_id, org_b);
        assert_eq!(batch_a.alerts.len(), 1);
        assert_eq!(batch_b.alerts.len(), 1);
        assert_eq!(batch_a.alerts[0].alert.name, "disk_full");
        assert_eq!(batch_a.alerts[0].alert.get_unique_key(), a.get_unique_key());
        assert_eq!(batch_b.alerts[0].alert.get_unique_key(), b.get_unique_key());
        assert_eq!(get_pending_batch_count(org_a), 1);
        assert_eq!(get_pending_batch_count(org_b), 1);
        for org in [org_a, org_b] {
            assert_eq!(
                config::metrics::ALERT_GROUPING_BATCHES_PENDING
                    .with_label_values(&[org])
                    .get(),
                1
            );
        }

        PENDING_BATCHES.remove(&batch_key(org_a, &fp));
        PENDING_BATCHES.remove(&batch_key(org_b, &fp));
    }

    #[test]
    fn test_get_ready_batch_returns_none_when_not_expired() {
        let fp = "grouping_test_get_ready_not_expired_unique".to_string();
        let key = batch_key("org-test-get", &fp);
        PENDING_BATCHES.remove(&key);

        add_to_batch(
            fp.clone(),
            "org-test-get".to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            10,
            None,
            None,
        );

        let batch = get_ready_batch("org-test-get", &fp);
        assert!(batch.is_none()); // 3600s wait, not expired

        PENDING_BATCHES.remove(&key);
    }

    /// A `get` guard held across `remove` deadlocks the shard, so a full batch would never flush.
    #[test]
    fn test_get_ready_batch_takes_a_full_batch() {
        let fp = "grouping_test_get_ready_full_unique".to_string();
        PENDING_BATCHES.remove(&batch_key("acme", &fp));
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let admit = || {
            add_to_batch(
                fp.clone(),
                "acme".to_string(),
                a.clone(),
                vec![],
                enqueue_row(&a, "acme"),
                3600,
                2,
                None,
                None,
            )
        };
        assert_eq!(admit(), BatchAdmission::Queued);
        assert_eq!(admit(), BatchAdmission::Ready);

        let batch = get_ready_batch("acme", &fp).expect("a full batch is ready");

        assert_eq!(batch.alerts.len(), 2);
        assert!(!PENDING_BATCHES.contains_key(&batch_key("acme", &fp)));
    }

    /// Same deadlock on the expiry path: a ready batch means `remove` runs under the `get` guard.
    #[test]
    fn test_get_ready_batch_takes_an_expired_batch() {
        let fp = "grouping_test_get_ready_expired_unique".to_string();
        PENDING_BATCHES.remove(&batch_key("acme", &fp));
        let a = make_named_alert("disk_full", &config::ider::uuid());

        add_to_batch(
            fp.clone(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            0,
            10,
            None,
            None,
        );

        let batch = get_ready_batch("acme", &fp).expect("a batch past its wait is ready");

        assert_eq!(batch.alerts.len(), 1);
        assert!(!PENDING_BATCHES.contains_key(&batch_key("acme", &fp)));
    }

    #[test]
    fn test_get_pending_batch_count_counts_org_batches() {
        let fp1 = "grouping_count_fp1_unique_org".to_string();
        let fp2 = "grouping_count_fp2_unique_org".to_string();
        let org = "org-count-unique-test";
        PENDING_BATCHES.remove(&batch_key(org, &fp1));
        PENDING_BATCHES.remove(&batch_key(org, &fp2));

        add_to_batch(
            fp1.clone(),
            org.to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            10,
            None,
            None,
        );
        add_to_batch(
            fp2.clone(),
            org.to_string(),
            make_alert(),
            vec![],
            TriggerData::default(),
            3600,
            10,
            None,
            None,
        );

        let count = get_pending_batch_count(org);
        assert!(count >= 2);

        PENDING_BATCHES.remove(&batch_key(org, &fp1));
        PENDING_BATCHES.remove(&batch_key(org, &fp2));
    }

    #[test]
    fn test_flush_rows_one_per_batched_entry() {
        let id_a = config::ider::uuid();
        let id_b = config::ider::uuid();
        let a = make_named_alert("disk_full", &id_a);
        let b = make_named_alert("cpu_hot", &id_b);
        let mut batch = PendingBatch::new(
            "fp_rows".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );
        batch.add_alert(b.clone(), vec![], enqueue_row(&b, "acme"));

        let rows = flush_rows(&batch);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key, format!("disk_full/{id_a}"));
        assert_eq!(rows[1].key, format!("cpu_hot/{id_b}"));
        assert!(rows.iter().all(|r| r.group_size == Some(2)));
        assert!(rows.iter().all(|r| r.grouped == Some(true)));
        assert!(rows.iter().all(|r| r.dedup_enabled == Some(true)));
    }

    /// `group_size` is the batch that was actually sent; the configured maximum is a ceiling.
    #[test]
    fn test_flush_rows_group_size_is_the_real_membership_not_the_maximum() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_size".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            50,
            None,
            None,
        );

        let rows = flush_rows(&batch);

        assert_eq!(rows[0].group_size, Some(1));
    }

    /// A batched evaluation publishes its own row, so it must carry its own scheduler fields.
    #[test]
    fn test_flush_rows_carry_the_held_back_evaluation_row() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_fields".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );

        let row = &flush_rows(&batch)[0];

        assert_eq!(row.org, "acme");
        assert_eq!(row.module, TriggerDataType::Alert);
        assert_eq!(row._timestamp, 1_700_000_000_000_000);
        assert_eq!(row.next_run_at, 1_700_000_300_000_000);
        assert_eq!(row.start_time, 1_699_999_700_000_000);
        assert_eq!(row.end_time, 1_700_000_000_000_000);
        assert_eq!(row.retries, 2);
        assert_eq!(row.delay_in_secs, Some(4));
        assert_eq!(row.source_node.as_deref(), Some("node-7"));
        assert_eq!(row.scheduler_trace_id.as_deref(), Some("eval-trace"));
        assert_eq!(row.time_in_queue_ms, Some(11));
    }

    /// A batch that reached its destinations records the firing the evaluation carried.
    #[test]
    fn test_flush_rows_record_the_evaluation_status_when_unstamped() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_status".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );

        let rows = flush_rows(&batch);

        assert_eq!(rows[0].status, RunOutcome::Firing);
        assert_eq!(rows[0].error, None);
    }

    #[test]
    fn test_stamp_flush_error_marks_every_member_notify_failed() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let b = make_named_alert("cpu_hot", &config::ider::uuid());
        let mut batch = PendingBatch::new(
            "fp_fail".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );
        batch.add_alert(b.clone(), vec![], enqueue_row(&b, "acme"));
        let mut rows = flush_rows(&batch);

        stamp_flush_error(
            &mut rows,
            &GroupedSendError("Send failed: boom".to_string()),
        );

        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.status == RunOutcome::NotifyFailed));
        assert!(rows.iter().all(|r| r.status.is_firing()));
        assert!(rows.iter().all(|r| r.error.as_deref()
            == Some("error sending notification for alert: Send failed: boom")));
    }

    /// A partial destination failure is still a delivery failure and still counts as firing.
    #[test]
    fn test_stamp_flush_error_records_a_partial_failure_with_its_text() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_partial".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );
        let mut rows = flush_rows(&batch);

        stamp_flush_error(
            &mut rows,
            &GroupedSendError("Partial failure: slack 500".to_string()),
        );

        assert_eq!(rows[0].status, RunOutcome::NotifyFailed);
        assert_eq!(
            rows[0].error.as_deref(),
            Some("error sending notification for alert: Partial failure: slack 500")
        );
    }

    /// The batch map is in-memory: a row exists only once a flush has decided its delivery.
    #[test]
    fn test_a_pending_batch_holds_its_rows_back_until_it_is_flushed() {
        let fp = "grouping_test_rows_held_back_unique".to_string();
        let key = batch_key("acme", &fp);
        PENDING_BATCHES.remove(&key);
        let a = make_named_alert("disk_full", &config::ider::uuid());

        let ready = add_to_batch(
            fp.clone(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            3600,
            10,
            None,
            None,
        );

        assert_eq!(ready, BatchAdmission::Queued);
        assert!(get_ready_batch("acme", &fp).is_none());
        assert_eq!(
            PENDING_BATCHES.get(&key).unwrap().alerts[0]
                .trigger_data
                .key,
            format!("disk_full/{}", a.get_unique_key())
        );

        PENDING_BATCHES.remove(&key);
    }

    /// The full-batch race: without a refusal the evaluation vanishes, unbatched and unpublished.
    #[test]
    fn test_add_to_batch_refuses_an_evaluation_when_the_full_batch_was_not_yet_taken() {
        let fp = "grouping_test_refused_when_full_unique".to_string();
        let key = batch_key("acme", &fp);
        PENDING_BATCHES.remove(&key);
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let admit = |alert: &Alert| {
            add_to_batch(
                fp.clone(),
                "acme".to_string(),
                alert.clone(),
                vec![],
                enqueue_row(alert, "acme"),
                3600,
                2,
                None,
                None,
            )
        };

        assert_eq!(admit(&a), BatchAdmission::Queued);
        assert_eq!(admit(&a), BatchAdmission::Ready);
        let refused = admit(&make_named_alert("cpu_hot", &config::ider::uuid()));

        assert_eq!(refused, BatchAdmission::Refused);
        assert_eq!(PENDING_BATCHES.get(&key).unwrap().alerts.len(), 2);

        PENDING_BATCHES.remove(&key);
    }

    /// A refused evaluation matched but reached no destination, so it is a firing with no attempt.
    #[test]
    fn test_refused_row_is_a_firing_that_attempted_no_delivery() {
        let a = make_named_alert("disk_full", &config::ider::uuid());

        let row = refused_row(&enqueue_row(&a, "acme"));

        assert_eq!(row.status, RunOutcome::NotifyFailed);
        assert!(row.status.is_firing());
        assert_eq!(row.delivery_attempted, Some(false));
        assert_eq!(row.grouped, Some(false));
        assert_eq!(row.dedup_enabled, Some(true));
        assert!(row.group_size.is_none());
        assert!(row.error.is_some());
    }

    /// The refused evaluation publishes its OWN row, so it must keep its own scheduler fields.
    #[test]
    fn test_refused_row_carries_the_evaluation_it_refused() {
        let a = make_named_alert("disk_full", &config::ider::uuid());

        let row = refused_row(&enqueue_row(&a, "acme"));

        assert_eq!(row.org, "acme");
        assert_eq!(row.key, format!("disk_full/{}", a.get_unique_key()));
        assert_eq!(row._timestamp, 1_700_000_000_000_000);
        assert_eq!(row.next_run_at, 1_700_000_300_000_000);
        assert_eq!(row.scheduler_trace_id.as_deref(), Some("eval-trace"));
    }

    #[test]
    fn test_stamp_flush_delivery_records_the_attempt_on_every_member() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let mut batch = PendingBatch::new(
            "fp_attempt".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );
        batch.add_alert(a.clone(), vec![], enqueue_row(&a, "acme"));

        for attempted in [true, false] {
            let mut rows = flush_rows(&batch);
            stamp_flush_delivery(&mut rows, attempted);
            assert!(rows.iter().all(|r| r.delivery_attempted == Some(attempted)));
            assert!(rows.iter().all(|r| r.status == RunOutcome::Firing));
        }
    }

    /// A refusing destination must be countable, or the failure ratio has no denominator.
    #[test]
    fn test_stamp_flush_error_records_an_attempt_for_a_delivery_failure() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_err_attempt".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );
        let mut rows = flush_rows(&batch);

        stamp_flush_error(
            &mut rows,
            &GroupedSendError("Send failed: boom".to_string()),
        );

        assert_eq!(rows[0].delivery_attempted, Some(true));
    }

    /// Alert Hygiene counts attempts only on firing rows, so a `Some(true)` elsewhere is lost.
    #[test]
    fn test_every_batched_row_stamped_as_attempted_is_a_firing_row() {
        let a = make_named_alert("disk_full", &config::ider::uuid());
        let batch = PendingBatch::new(
            "fp_containment".to_string(),
            "acme".to_string(),
            a.clone(),
            vec![],
            enqueue_row(&a, "acme"),
            30,
            10,
            None,
            None,
        );

        let mut stamped: Vec<TriggerData> = Vec::new();
        for attempted in [true, false] {
            let mut rows = flush_rows(&batch);
            stamp_flush_delivery(&mut rows, attempted);
            stamped.extend(rows);
        }
        let mut rows = flush_rows(&batch);
        stamp_flush_error(
            &mut rows,
            &GroupedSendError("Send failed: boom".to_string()),
        );
        stamped.extend(rows);
        stamped.push(refused_row(&enqueue_row(&a, "acme")));

        for row in &stamped {
            assert!(row.delivery_attempted.is_some(), "{:?}", row.status);
            if row.delivery_attempted == Some(true) {
                assert!(
                    row.status.is_firing(),
                    "{:?} is not a firing row",
                    row.status
                );
            }
        }
    }
}

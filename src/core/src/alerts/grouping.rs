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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock as Lazy},
};

use chrono::Utc;
use config::{
    meta::{
        alerts::alert::Alert,
        self_reporting::usage::{RunOutcome, TriggerData},
    },
    utils::json,
};
use dashmap::DashMap;

/// Keyed by [`batch_key`]: a fingerprint carries no org, so it alone would merge two orgs' batches.
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
    /// This evaluation's history row, held back until the flush knows whether the send landed.
    pub trigger_data: TriggerData,
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

/// What the batcher did with an evaluation handed to [`add_to_batch`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchAdmission {
    /// Collected into a batch that is still waiting; its flush publishes the row.
    Queued,
    /// Collected into a batch that is now full; the caller flushes it immediately.
    Ready,
    /// The batch was full and not yet taken, so this evaluation joined no batch at all.
    Refused,
}

fn batch_key(org_id: &str, fingerprint: &str) -> String {
    format!("{org_id}/{fingerprint}")
}

/// One history row per evaluation in the batch, built before the send consumes it.
fn flush_rows(batch: &PendingBatch) -> Vec<TriggerData> {
    let group_size = batch.alerts.len() as i32;
    batch
        .alerts
        .iter()
        .map(|batched| TriggerData {
            dedup_enabled: Some(true),
            grouped: Some(true),
            group_size: Some(group_size),
            ..batched.trigger_data.clone()
        })
        .collect()
}

/// A failed send is `NotifyFailed`, not `Error`: the evaluation itself succeeded.
fn stamp_flush_error(rows: &mut [TriggerData], error: &anyhow::Error) {
    let text = format!("error sending notification for alert: {error}");
    for row in rows {
        row.status = RunOutcome::NotifyFailed;
        row.error = Some(text.clone());
    }
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
    let mut refused = false;
    let full = PENDING_BATCHES
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
                    log::info!(
                        "[grouping] Batch {} reached max size ({}), ready to send",
                        fingerprint,
                        batch.max_group_size
                    );
                }
            } else {
                refused = true;
                log::warn!(
                    "[grouping] Failed to add alert '{}' to batch {} (already full), org_id: {}",
                    alert.name,
                    fingerprint,
                    org_id
                );
            }
        })
        .or_insert_with(|| {
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
                org_id,
                alert,
                rows,
                trigger_data,
                group_wait_seconds,
                max_group_size,
                level,
                group_labels,
            )
        })
        .is_full();
    if refused {
        BatchAdmission::Refused
    } else if full {
        BatchAdmission::Ready
    } else {
        BatchAdmission::Queued
    }
}

/// Get and remove a batch if it's ready (expired or full)
pub fn get_ready_batch(org_id: &str, fingerprint: &str) -> Option<PendingBatch> {
    // Checked inside `remove_if`: a `get` guard held across `remove` deadlocks the shard.
    PENDING_BATCHES
        .remove_if(&batch_key(org_id, fingerprint), |_, batch| {
            batch.is_expired() || batch.is_full()
        })
        .map(|(_, batch)| batch)
        .inspect(|batch| {
            log::debug!(
                "[grouping] Retrieved ready batch for fingerprint {} ({} alerts)",
                fingerprint,
                batch.alerts.len()
            );
        })
}

/// Take every expired batch out of the map, and report each org's remaining pending batches.
pub fn get_expired_batches() -> Vec<PendingBatch> {
    let mut expired = Vec::new();
    let mut pending_per_org: HashMap<String, i64> = HashMap::new();
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
            if let Some(count) = pending_per_org.get_mut(&batch.org_id) {
                *count += 1;
            } else {
                pending_per_org.insert(batch.org_id.clone(), 1);
            }
            true // Keep in map
        }
    });
    // Recounted here, off the scheduler path; reset drops orgs whose batches drained.
    config::metrics::ALERT_GROUPING_BATCHES_PENDING.reset();
    for (org_id, count) in &pending_per_org {
        config::metrics::ALERT_GROUPING_BATCHES_PENDING
            .with_label_values(&[org_id.as_str()])
            .set(*count);
    }

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

/// The row of an evaluation no batch took: it fired, and no notification was sent for it.
pub fn refused_row(trigger_data: &TriggerData) -> TriggerData {
    TriggerData {
        status: RunOutcome::NotifyFailed,
        error: Some(
            "alert grouping batch was already full; this evaluation joined no batch and no \
             notification was sent"
                .to_string(),
        ),
        ..trigger_data.clone()
    }
}

/// Sends a batch and publishes its members' rows; false when nothing was delivered.
#[cfg(feature = "enterprise")]
pub async fn flush_batch(trace_id: &str, batch: PendingBatch) -> bool {
    let decisions = entry_decisions(&batch).await;
    flush_decided(trace_id, batch, decisions).await
}

#[cfg(feature = "enterprise")]
pub async fn send_grouped_notification(
    trace_id: &str,
    batch: crate::alerts::grouping::PendingBatch,
) -> Result<(), anyhow::Error> {
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
    let grouping_config = primary_alert
        .deduplication
        .as_ref()
        .and_then(|d| d.grouping.as_ref())
        .ok_or_else(|| anyhow::anyhow!("Grouping config not found"))?;

    let send_strategy = &grouping_config.send_strategy;

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
            None,
        )
        .await
    {
        Ok(outcome) => {
            let (success_msg, err_msg) = (outcome.success_message, outcome.error_message);
            if !err_msg.is_empty() {
                log::error!(
                    "[alert_grouping_worker] Some destinations failed for grouped notification (org_id: {}, fingerprint: {}): {}",
                    batch.org_id,
                    batch.fingerprint,
                    err_msg
                );
                // Record error metric
                config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                    .with_label_values(&[batch.org_id.as_str(), "partial_failure"])
                    .inc();
                return Err(anyhow::anyhow!("Partial failure: {}", err_msg));
            }

            // Record successful send metrics
            let strategy_str = format!("{:?}", send_strategy).to_lowercase();
            let reason = if elapsed_seconds >= grouping_config.group_wait_seconds {
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
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[alert_grouping_worker] Failed to send grouped notification (org_id: {}, fingerprint: {}): {}",
                batch.org_id,
                batch.fingerprint,
                e
            );
            // Record error metric
            config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                .with_label_values(&[batch.org_id.as_str(), "send_failed"])
                .inc();
            Err(anyhow::anyhow!("Send failed: {}", e))
        }
    }
}

/// A member muted at its own evaluation leaves with a `Suppressed` row and does not count.
#[cfg(feature = "enterprise")]
async fn flush_decided(
    trace_id: &str,
    mut batch: PendingBatch,
    decisions: Vec<Option<config::meta::downtimes::ActiveDowntime>>,
) -> bool {
    drop_muted_entries(&mut batch, decisions);
    if batch.alerts.is_empty() {
        return false;
    }
    let mut rows = flush_rows(&batch);
    let delivered = match send_grouped_notification(trace_id, batch).await {
        Ok(()) => true,
        Err(e) => {
            stamp_flush_error(&mut rows, &e);
            false
        }
    };
    for row in rows {
        usage_reporting::publish_triggers_usage(row);
    }
    delivered
}

/// Judged at each entry's own timestamp, so a firing admitted before a window is still sent.
#[cfg(feature = "enterprise")]
async fn entry_decisions(
    batch: &PendingBatch,
) -> Vec<Option<config::meta::downtimes::ActiveDowntime>> {
    if !crate::alerts::downtimes::any_for(
        &batch.org_id,
        config::meta::downtimes::TargetModule::Alerts,
    ) {
        return vec![None; batch.alerts.len()];
    }
    let mut decisions = Vec::with_capacity(batch.alerts.len());
    for (entry, at) in batch.alerts.iter().zip(judged_at(batch)) {
        decisions.push(entry_downtime(entry, at).await);
    }
    decisions
}

/// The instant each entry is judged at: its own evaluation, never the flush.
#[cfg(feature = "enterprise")]
fn judged_at(batch: &PendingBatch) -> Vec<i64> {
    batch.alerts.iter().map(|entry| entry.timestamp).collect()
}

#[cfg(feature = "enterprise")]
fn drop_muted_entries(
    batch: &mut PendingBatch,
    decisions: Vec<Option<config::meta::downtimes::ActiveDowntime>>,
) {
    for (entry, downtime) in take_muted(batch, decisions) {
        log::info!(
            "[alert_grouping_worker] alert {}/{} dropped from its batch by downtime {}",
            entry.alert.org_id,
            entry.alert.name,
            downtime.id
        );
        crate::alerts::alert::count_suppressed_run(&entry.alert.org_id, "alerts");
        usage_reporting::publish_triggers_usage(suppressed_entry_record(&entry, downtime));
    }
}

/// Removes the muted entries from the batch and returns them with their downtime.
#[cfg(feature = "enterprise")]
fn take_muted(
    batch: &mut PendingBatch,
    decisions: Vec<Option<config::meta::downtimes::ActiveDowntime>>,
) -> Vec<(BatchedAlert, config::meta::downtimes::ActiveDowntime)> {
    let (kept, muted) = split_muted(std::mem::take(&mut batch.alerts), decisions);
    batch.alerts = kept;
    muted
}

/// The entries no downtime covers, in their order, and the others with their downtime.
#[cfg(feature = "enterprise")]
fn split_muted<T>(
    entries: Vec<T>,
    decisions: Vec<Option<config::meta::downtimes::ActiveDowntime>>,
) -> (Vec<T>, Vec<(T, config::meta::downtimes::ActiveDowntime)>) {
    let mut kept = Vec::with_capacity(entries.len());
    let mut muted = Vec::new();
    for (entry, decision) in entries.into_iter().zip(decisions) {
        match decision {
            Some(downtime) => muted.push((entry, downtime)),
            None => kept.push(entry),
        }
    }
    (kept, muted)
}

#[cfg(feature = "enterprise")]
async fn entry_downtime(
    entry: &BatchedAlert,
    at: i64,
) -> Option<config::meta::downtimes::ActiveDowntime> {
    let alert_id = entry.alert.id.as_ref()?.to_string();
    let (folder, _) =
        crate::db::alerts::alert::get_alert_from_cache(&entry.alert.org_id, &alert_id).await?;
    let identity =
        crate::alerts::scheduler::handlers::downtime_identity(&entry.alert, &entry.rows).await;
    crate::alerts::scheduler::handlers::muted_in_every_group(&identity, |dims| {
        crate::alerts::downtimes::active_for_alert(
            &entry.alert.org_id,
            &alert_id,
            &folder.folder_id,
            dims,
            at,
        )
    })
}

/// The held-back evaluation row of a dropped entry, recorded as suppressed by its downtime.
#[cfg(feature = "enterprise")]
fn suppressed_entry_record(
    entry: &BatchedAlert,
    downtime: config::meta::downtimes::ActiveDowntime,
) -> TriggerData {
    TriggerData {
        status: RunOutcome::Suppressed,
        downtime_id: Some(downtime.id),
        error: None,
        grouped: Some(true),
        ..entry.trigger_data.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_alert() -> Alert {
        serde_json::from_value(serde_json::json!({})).unwrap()
    }

    fn admit(fp: &str, org: &str, max_group_size: usize, row: TriggerData) -> BatchAdmission {
        add_to_batch(
            fp.to_string(),
            org.to_string(),
            make_alert(),
            vec![],
            row,
            3600,
            max_group_size,
            None,
            None,
        )
    }

    fn add_one(fp: &str, org: &str, max_group_size: usize) -> bool {
        admit(fp, org, max_group_size, TriggerData::default()) == BatchAdmission::Ready
    }

    fn evaluation_row(key: &str) -> TriggerData {
        TriggerData {
            key: key.to_string(),
            status: RunOutcome::Firing,
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
        let (fp, org) = ("grouping_test_add_creates_new_batch_unique", "org-test-add");

        assert!(!add_one(fp, org, 10));
        assert!(PENDING_BATCHES.contains_key(&batch_key(org, fp)));

        PENDING_BATCHES.remove(&batch_key(org, fp));
    }

    #[test]
    fn test_add_to_batch_returns_true_when_full() {
        let (fp, org) = ("grouping_test_add_batch_full_unique", "org-test-full");

        assert!(!add_one(fp, org, 2)); // new batch, 1 alert, not full
        assert!(add_one(fp, org, 2)); // 2nd alert fills batch, ready=true

        PENDING_BATCHES.remove(&batch_key(org, fp));
    }

    #[test]
    fn test_get_ready_batch_returns_none_when_not_expired() {
        let (fp, org) = ("grouping_test_get_ready_not_expired_unique", "org-test-get");
        add_one(fp, org, 10);

        assert!(get_ready_batch(org, fp).is_none()); // 3600s wait, not expired

        PENDING_BATCHES.remove(&batch_key(org, fp));
    }

    #[test]
    fn test_get_pending_batch_count_counts_org_batches() {
        let (fp1, fp2) = (
            "grouping_count_fp1_unique_org",
            "grouping_count_fp2_unique_org",
        );
        let org = "org-count-unique-test";
        add_one(fp1, org, 10);
        add_one(fp2, org, 10);

        assert!(get_pending_batch_count(org) >= 2);

        PENDING_BATCHES.remove(&batch_key(org, fp1));
        PENDING_BATCHES.remove(&batch_key(org, fp2));
    }

    #[test]
    fn test_add_to_batch_keeps_orgs_with_same_fingerprint_apart() {
        let fp = "grouping_test_same_fp_two_orgs";
        let (org_a, org_b) = ("org-isolation-a", "org-isolation-b");

        assert!(!add_one(fp, org_a, 2));
        assert!(!add_one(fp, org_b, 2));
        for org in [org_a, org_b] {
            let batch = PENDING_BATCHES.get(&batch_key(org, fp)).unwrap();
            assert_eq!(batch.org_id, org);
            assert_eq!(batch.alerts.len(), 1);
        }

        PENDING_BATCHES.remove(&batch_key(org_a, fp));
        PENDING_BATCHES.remove(&batch_key(org_b, fp));
    }

    #[test]
    fn test_get_ready_batch_takes_full_batch() {
        let fp = "grouping_test_get_ready_full";
        let org = "org-ready-full";
        assert!(!add_one(fp, org, 2));
        assert!(add_one(fp, org, 2));

        // Run on another thread so a deadlock fails the test instead of hanging it.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || tx.send(get_ready_batch(org, fp)));
        let batch = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("get_ready_batch deadlocked")
            .expect("a full batch is ready");

        assert_eq!(batch.alerts.len(), 2);
        assert!(!PENDING_BATCHES.contains_key(&batch_key(org, fp)));
    }

    #[test]
    fn test_get_ready_batch_ignores_other_org() {
        let fp = "grouping_test_get_ready_other_org";
        let (owner, other) = ("org-ready-owner", "org-ready-other");
        assert!(!add_one(fp, owner, 2));
        assert!(add_one(fp, owner, 2));

        assert!(get_ready_batch(other, fp).is_none());
        assert!(PENDING_BATCHES.contains_key(&batch_key(owner, fp)));

        PENDING_BATCHES.remove(&batch_key(owner, fp));
    }

    #[test]
    fn test_add_to_batch_ready_when_max_size_is_one() {
        let fp = "grouping_test_max_size_one";
        let org = "org-max-size-one";

        assert!(add_one(fp, org, 1));
        assert_eq!(get_ready_batch(org, fp).unwrap().alerts.len(), 1);
    }

    #[test]
    fn test_flush_rows_carry_each_held_back_row_with_the_real_group_size() {
        let (fp, org) = ("grouping_test_flush_rows", "org-flush-rows");
        assert_eq!(
            admit(fp, org, 10, evaluation_row("a/1")),
            BatchAdmission::Queued
        );
        assert_eq!(
            admit(fp, org, 10, evaluation_row("b/2")),
            BatchAdmission::Queued
        );
        let batch = PENDING_BATCHES.remove(&batch_key(org, fp)).unwrap().1;

        let rows = flush_rows(&batch);
        let keys: Vec<&str> = rows.iter().map(|row| row.key.as_str()).collect();
        assert_eq!(keys, ["a/1", "b/2"]);
        for row in &rows {
            assert_eq!(row.status, RunOutcome::Firing);
            assert_eq!(
                (row.dedup_enabled, row.grouped, row.group_size),
                (Some(true), Some(true), Some(2))
            );
        }
    }

    #[test]
    fn test_stamp_flush_error_marks_every_member_notify_failed() {
        let mut rows = vec![evaluation_row("a/1"), evaluation_row("b/2")];
        stamp_flush_error(&mut rows, &anyhow::anyhow!("Send failed: http 500"));
        for row in &rows {
            assert_eq!(row.status, RunOutcome::NotifyFailed);
            assert_eq!(
                row.error.as_deref(),
                Some("error sending notification for alert: Send failed: http 500")
            );
        }
    }

    #[test]
    fn test_add_to_batch_refuses_an_evaluation_when_the_full_batch_was_not_taken() {
        let (fp, org) = ("grouping_test_refused", "org-refused");
        assert_eq!(
            admit(fp, org, 1, evaluation_row("a/1")),
            BatchAdmission::Ready
        );
        assert_eq!(
            admit(fp, org, 1, evaluation_row("a/2")),
            BatchAdmission::Refused
        );
        let batch = PENDING_BATCHES.remove(&batch_key(org, fp)).unwrap().1;
        assert_eq!(batch.alerts.len(), 1);
        assert_eq!(batch.alerts[0].trigger_data.key, "a/1");
    }

    #[test]
    fn test_refused_row_is_notify_failed_and_not_shown_as_sent() {
        let row = refused_row(&evaluation_row("a/2"));
        assert_eq!(row.key, "a/2");
        assert_eq!(row.status, RunOutcome::NotifyFailed);
        assert!(
            row.error
                .is_some_and(|error| error.contains("no notification was sent"))
        );
        // The history page shows a dedup-enabled, ungrouped row as "notification sent".
        assert_eq!((row.dedup_enabled, row.grouped), (None, None));
    }

    #[test]
    fn test_expiry_sweep_reports_pending_batches_per_org() {
        let (busy, drained) = ("org-gauge-busy", "org-gauge-drained");
        let (fp1, fp2) = ("grouping_gauge_fp1", "grouping_gauge_fp2");
        let gauge = |org: &str| {
            config::metrics::ALERT_GROUPING_BATCHES_PENDING
                .with_label_values(&[org])
                .get()
        };
        add_one(fp1, busy, 10);
        add_one(fp2, busy, 10);
        add_one(fp1, drained, 2);

        get_expired_batches();
        assert_eq!((gauge(busy), gauge(drained)), (2, 1));

        assert!(add_one(fp1, drained, 2));
        assert!(get_ready_batch(drained, fp1).is_some());
        get_expired_batches();
        assert_eq!((gauge(busy), gauge(drained)), (2, 0));

        PENDING_BATCHES.remove(&batch_key(busy, fp1));
        PENDING_BATCHES.remove(&batch_key(busy, fp2));
    }

    #[cfg(feature = "enterprise")]
    fn downtime(id: &str) -> config::meta::downtimes::ActiveDowntime {
        config::meta::downtimes::ActiveDowntime {
            id: id.to_string(),
            name: id.to_string(),
            ends_at: 0,
            incident_mode: Default::default(),
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_flush_drops_the_muted_entries_and_keeps_the_rest_in_order() {
        let (kept, muted) = split_muted(
            vec!["a", "b", "c"],
            vec![None, Some(downtime("dt-1")), None],
        );
        assert_eq!(kept, ["a", "c"]);
        assert_eq!(muted.len(), 1);
        assert_eq!((muted[0].0, muted[0].1.id.as_str()), ("b", "dt-1"));

        let (kept, muted) = split_muted(vec!["a"], vec![Some(downtime("dt-1"))]);
        assert!(kept.is_empty(), "an emptied batch sends nothing");
        assert_eq!(muted.len(), 1);
    }

    #[cfg(feature = "enterprise")]
    fn queued_batch(fp: &str, org: &str, timestamps: &[i64]) -> PendingBatch {
        for (i, _) in timestamps.iter().enumerate() {
            admit(fp, org, 10, evaluation_row(&format!("a/{i}")));
        }
        let mut batch = PENDING_BATCHES.remove(&batch_key(org, fp)).unwrap().1;
        for (entry, at) in batch.alerts.iter_mut().zip(timestamps) {
            entry.timestamp = *at;
        }
        batch
    }

    // Dropping an entry publishes its row, and the usage queue starts on a Tokio runtime.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_entry_queued_before_the_window_stays_in_the_batch_at_flush() {
        let window_opens = 100;
        let mut batch = queued_batch("grouping_test_before_window", "org-before", &[50, 150]);
        let decisions = judged_at(&batch)
            .into_iter()
            .map(|at| (at >= window_opens).then(|| downtime("dt-1")))
            .collect();
        drop_muted_entries(&mut batch, decisions);
        let kept: Vec<_> = batch.alerts.iter().map(|e| e.timestamp).collect();
        assert_eq!(kept, [50]);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_emptied_batch_records_no_delivery() {
        let batch = queued_batch("grouping_test_emptied", "org-emptied", &[150, 160]);
        let decisions = vec![Some(downtime("dt-1")), Some(downtime("dt-1"))];
        assert!(!flush_decided("t", batch, decisions).await);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_dropped_entry_is_recorded_as_suppressed_with_its_downtime() {
        let entry = BatchedAlert {
            alert: make_alert(),
            rows: vec![],
            timestamp: 5,
            trigger_data: TriggerData {
                start_time: 5,
                end_time: 9,
                ..evaluation_row("a/1")
            },
        };
        let record = suppressed_entry_record(&entry, downtime("dt-1"));
        assert_eq!(record.key, "a/1");
        assert_eq!(record.status, RunOutcome::Suppressed);
        assert_eq!(record.downtime_id.as_deref(), Some("dt-1"));
        assert_eq!((record.start_time, record.end_time), (5, 9));
        assert_eq!(record.grouped, Some(true));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_muted_entry_leaves_the_batch_before_its_rows_are_built() {
        let (fp, org) = ("grouping_test_muted_flush", "org-muted-flush");
        assert_eq!(
            admit(fp, org, 10, evaluation_row("a/1")),
            BatchAdmission::Queued
        );
        assert_eq!(
            admit(fp, org, 10, evaluation_row("b/2")),
            BatchAdmission::Queued
        );
        let mut batch = PENDING_BATCHES.remove(&batch_key(org, fp)).unwrap().1;

        let muted = take_muted(&mut batch, vec![None, Some(downtime("dt-1"))]);
        let suppressed: Vec<_> = muted
            .into_iter()
            .map(|(entry, downtime)| suppressed_entry_record(&entry, downtime))
            .collect();
        let sent = flush_rows(&batch);

        // One row per evaluation: the muted one only as Suppressed, the rest as the batch.
        assert_eq!(suppressed.len(), 1);
        assert_eq!(suppressed[0].key, "b/2");
        assert_eq!(suppressed[0].status, RunOutcome::Suppressed);
        let keys: Vec<&str> = sent.iter().map(|row| row.key.as_str()).collect();
        assert_eq!(keys, ["a/1"]);
        assert_eq!(sent[0].group_size, Some(1));
    }
}

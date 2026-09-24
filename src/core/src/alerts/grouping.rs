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
use config::{meta::alerts::alert::Alert, utils::json};
use dashmap::DashMap;

/// In-memory cache of pending alert batches
/// Key: fingerprint, Value: PendingBatch
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
}

impl PendingBatch {
    /// Create a new pending batch
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        fingerprint: String,
        org_id: String,
        alert: Alert,
        rows: Vec<json::Map<String, json::Value>>,
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
            }],
            timer_started_at: now,
            group_wait_seconds,
            max_group_size,
            level,
        }
    }

    /// Add an alert to this batch
    pub fn add_alert(&mut self, alert: Alert, rows: Vec<json::Map<String, json::Value>>) -> bool {
        if self.alerts.len() >= self.max_group_size {
            return false; // Batch full
        }

        let now = Utc::now().timestamp_micros();
        self.alerts.push(BatchedAlert {
            alert,
            rows,
            timestamp: now,
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

/// Add alert to pending batch or create new batch
/// Returns true if batch is ready to send (expired or full)
#[allow(clippy::too_many_arguments)]
pub fn add_to_batch(
    fingerprint: String,
    org_id: String,
    alert: Alert,
    rows: Vec<json::Map<String, json::Value>>,
    group_wait_seconds: i64,
    max_group_size: usize,
    level: Option<config::meta::alerts::level::AlertLevel>,
    // Group identity when this is a per-group batch (§5.5). Every entry
    // sharing a fingerprint shares a group, because the group is part of the
    // fingerprint — so this is set once, when the batch is created.
    group_labels: Option<std::collections::BTreeMap<String, String>>,
) -> bool {
    let mut batch_ready = false;
    let mut is_new_batch = false;
    let mut batch_size = 0;

    PENDING_BATCHES
        .entry(fingerprint.clone())
        .and_modify(|batch| {
            if batch.add_alert(alert.clone(), rows.clone()) {
                batch_size = batch.alerts.len();
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
                log::warn!(
                    "[grouping] Failed to add alert '{}' to batch {} (already full)",
                    alert.name,
                    fingerprint
                );
            }
        })
        .or_insert_with(|| {
            is_new_batch = true;
            batch_size = 1;
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
                group_wait_seconds,
                max_group_size,
                level,
                group_labels,
            )
        });

    if is_new_batch {
        let batch_count = PENDING_BATCHES.len();
        log::debug!("[grouping] Current pending batches count: {batch_count}");

        // Update gauge metric for pending batches
        // Use org_id from the batch we just inserted
        if let Some(batch) = PENDING_BATCHES.get(&fingerprint) {
            config::metrics::ALERT_GROUPING_BATCHES_PENDING
                .with_label_values(&[batch.org_id.as_str()])
                .set(batch_count as i64);
        }
    }

    batch_ready
}

/// Get and remove a batch if it's ready (expired or full)
pub fn get_ready_batch(fingerprint: &str) -> Option<PendingBatch> {
    if let Some(entry) = PENDING_BATCHES.get(fingerprint)
        && (entry.is_expired() || entry.is_full())
    {
        let batch = PENDING_BATCHES.remove(fingerprint).map(|(_, batch)| batch);
        if let Some(ref b) = batch {
            log::debug!(
                "[grouping] Retrieved ready batch for fingerprint {} ({} alerts)",
                fingerprint,
                b.alerts.len()
            );
        }
        return batch;
    }
    None
}

/// Get all expired batches
pub fn get_expired_batches() -> Vec<PendingBatch> {
    let mut expired = Vec::new();
    let now = Utc::now().timestamp_micros();

    PENDING_BATCHES.retain(|fingerprint, batch| {
        if batch.is_expired() {
            let elapsed_seconds = (now - batch.timer_started_at) / 1_000_000;
            log::info!(
                "[grouping] Batch {} expired after {}s with {} alerts",
                fingerprint,
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

#[cfg(feature = "enterprise")]
pub async fn send_grouped_notification(
    trace_id: &str,
    mut batch: crate::alerts::grouping::PendingBatch,
) -> Result<(), anyhow::Error> {
    use config::meta::alerts::deduplication::SendStrategy;

    use crate::alerts::alert::AlertExt;

    drop_muted_entries(&mut batch).await;
    if batch.alerts.is_empty() {
        return Ok(());
    }

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
        )
        .await
    {
        Ok(outcome) => {
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
                "[alert_grouping_worker] Failed to send grouped notification (fingerprint: {}): {}",
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

/// Checked per entry at flush time: a window can open while the batch waits.
#[cfg(feature = "enterprise")]
async fn drop_muted_entries(batch: &mut PendingBatch) {
    if !crate::alerts::downtimes::any_for(
        &batch.org_id,
        config::meta::downtimes::TargetModule::Alerts,
    ) {
        return;
    }
    // The silence started at enqueue, so a dropped entry can delay the next send by it.
    let now = Utc::now().timestamp_micros();
    let mut decisions = Vec::with_capacity(batch.alerts.len());
    for entry in &batch.alerts {
        decisions.push(entry_downtime(entry, now).await);
    }
    let (kept, muted) = split_muted(std::mem::take(&mut batch.alerts), decisions);
    for (entry, downtime) in muted {
        log::info!(
            "[alert_grouping_worker] alert {}/{} dropped from its batch by downtime {}",
            entry.alert.org_id,
            entry.alert.name,
            downtime.id
        );
        crate::alerts::alert::count_suppressed_run(&entry.alert.org_id, "alerts");
        usage_reporting::publish_triggers_usage(suppressed_entry_record(&entry, downtime, now));
    }
    batch.alerts = kept;
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
    now: i64,
) -> Option<config::meta::downtimes::ActiveDowntime> {
    let alert_id = entry.alert.id.as_ref()?.to_string();
    let (folder, _) =
        crate::db::alerts::alert::get_alert_from_cache(&entry.alert.org_id, &alert_id).await?;
    let first_row = entry
        .rows
        .first()
        .map(std::slice::from_ref)
        .unwrap_or_default();
    let identity =
        crate::alerts::scheduler::handlers::alert_identity(&entry.alert, first_row).await;
    crate::alerts::downtimes::active_for_alert(
        &entry.alert.org_id,
        &alert_id,
        &folder.folder_id,
        identity.first()?,
        now,
    )
}

#[cfg(feature = "enterprise")]
fn suppressed_entry_record(
    entry: &BatchedAlert,
    downtime: config::meta::downtimes::ActiveDowntime,
    now: i64,
) -> config::meta::self_reporting::usage::TriggerData {
    use config::meta::self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType};

    let alert_id = entry
        .alert
        .id
        .as_ref()
        .map(|id| id.to_string())
        .unwrap_or_default();
    TriggerData {
        _timestamp: now,
        org: entry.alert.org_id.clone(),
        module: TriggerDataType::Alert,
        key: format!("{}/{alert_id}", entry.alert.name),
        status: RunOutcome::Suppressed,
        downtime_id: Some(downtime.id),
        start_time: entry.timestamp,
        end_time: now,
        next_run_at: now,
        grouped: Some(true),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_alert() -> Alert {
        serde_json::from_value(serde_json::json!({})).unwrap()
    }

    #[test]
    fn test_pending_batch_new_has_one_alert() {
        let batch = PendingBatch::new(
            "fp1".to_string(),
            "myorg".to_string(),
            make_alert(),
            vec![],
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
            30,
            2,
            None,
            None,
        );
        assert!(!batch.is_full());
        let added = batch.add_alert(make_alert(), vec![]);
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
            30,
            1,
            None,
            None,
        );
        assert!(batch.is_full());
        let added = batch.add_alert(make_alert(), vec![]);
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
        PENDING_BATCHES.remove(&fp);

        let ready = add_to_batch(
            fp.clone(),
            "org-test-add".to_string(),
            make_alert(),
            vec![],
            3600,
            10,
            None,
            None,
        );
        assert!(!ready);
        assert!(PENDING_BATCHES.contains_key(&fp));

        PENDING_BATCHES.remove(&fp);
    }

    #[test]
    fn test_add_to_batch_returns_true_when_full() {
        let fp = "grouping_test_add_batch_full_unique".to_string();
        PENDING_BATCHES.remove(&fp);

        let ready1 = add_to_batch(
            fp.clone(),
            "org-test-full".to_string(),
            make_alert(),
            vec![],
            3600,
            2,
            None,
            None,
        );
        assert!(!ready1); // new batch, 1 alert, not full

        let ready2 = add_to_batch(
            fp.clone(),
            "org-test-full".to_string(),
            make_alert(),
            vec![],
            3600,
            2,
            None,
            None,
        );
        assert!(ready2); // 2nd alert fills batch, ready=true

        PENDING_BATCHES.remove(&fp);
    }

    #[test]
    fn test_get_ready_batch_returns_none_when_not_expired() {
        let fp = "grouping_test_get_ready_not_expired_unique".to_string();
        PENDING_BATCHES.remove(&fp);

        add_to_batch(
            fp.clone(),
            "org-test-get".to_string(),
            make_alert(),
            vec![],
            3600,
            10,
            None,
            None,
        );

        let batch = get_ready_batch(&fp);
        assert!(batch.is_none()); // 3600s wait, not expired

        PENDING_BATCHES.remove(&fp);
    }

    #[test]
    fn test_get_pending_batch_count_counts_org_batches() {
        let fp1 = "grouping_count_fp1_unique_org".to_string();
        let fp2 = "grouping_count_fp2_unique_org".to_string();
        let org = "org-count-unique-test";
        PENDING_BATCHES.remove(&fp1);
        PENDING_BATCHES.remove(&fp2);

        add_to_batch(
            fp1.clone(),
            org.to_string(),
            make_alert(),
            vec![],
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
            3600,
            10,
            None,
            None,
        );

        let count = get_pending_batch_count(org);
        assert!(count >= 2);

        PENDING_BATCHES.remove(&fp1);
        PENDING_BATCHES.remove(&fp2);
    }

    #[cfg(feature = "enterprise")]
    fn downtime(id: &str) -> config::meta::downtimes::ActiveDowntime {
        config::meta::downtimes::ActiveDowntime {
            id: id.to_string(),
            name: id.to_string(),
            ends_at: 0,
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
    #[test]
    fn a_dropped_entry_is_recorded_as_suppressed_with_its_downtime() {
        use config::meta::self_reporting::usage::RunOutcome;

        let entry = BatchedAlert {
            alert: make_alert(),
            rows: vec![],
            timestamp: 5,
        };
        let record = suppressed_entry_record(&entry, downtime("dt-1"), 9);
        assert_eq!(record.status, RunOutcome::Suppressed);
        assert_eq!(record.downtime_id.as_deref(), Some("dt-1"));
        assert_eq!((record.start_time, record.end_time), (5, 9));
        assert_eq!(record.grouped, Some(true));
    }
}

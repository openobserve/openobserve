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
    pub org_id: String,
    pub alerts: Vec<BatchedAlert>,
    pub timer_started_at: i64,
    pub group_wait_seconds: i64,
    pub max_group_size: usize,
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
    pub fn new(
        fingerprint: String,
        org_id: String,
        alert: Alert,
        rows: Vec<json::Map<String, json::Value>>,
        group_wait_seconds: i64,
        max_group_size: usize,
    ) -> Self {
        let now = Utc::now().timestamp_micros();
        Self {
            fingerprint,
            org_id,
            alerts: vec![BatchedAlert {
                alert,
                rows,
                timestamp: now,
            }],
            timer_started_at: now,
            group_wait_seconds,
            max_group_size,
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
pub fn add_to_batch(
    fingerprint: String,
    org_id: String,
    alert: Alert,
    rows: Vec<json::Map<String, json::Value>>,
    group_wait_seconds: i64,
    max_group_size: usize,
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
        );
        assert!(!ready1); // new batch, 1 alert, not full

        let ready2 = add_to_batch(
            fp.clone(),
            "org-test-full".to_string(),
            make_alert(),
            vec![],
            3600,
            2,
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

        add_to_batch(fp1.clone(), org.to_string(), make_alert(), vec![], 3600, 10);
        add_to_batch(fp2.clone(), org.to_string(), make_alert(), vec![], 3600, 10);

        let count = get_pending_batch_count(org);
        assert!(count >= 2);

        PENDING_BATCHES.remove(&fp1);
        PENDING_BATCHES.remove(&fp2);
    }
}

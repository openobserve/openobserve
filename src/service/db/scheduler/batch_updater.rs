// Copyright 2025 OpenObserve Inc.
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

use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Result;
use chrono::Utc;
use tokio::{
    sync::{Mutex, RwLock, mpsc},
    time::{Instant, interval},
};
#[cfg(feature = "enterprise")]
use {
    config::meta::triggers::TriggerModule as MetaTriggerModule,
    o2_enterprise::enterprise::{common::config::get_config as get_o2_config, super_cluster},
};

use super::{Trigger, TriggerModule, TriggerStatus};

/// Maximum number of triggers to batch together for bulk operations
const MAX_BATCH_SIZE: usize = 100;

/// Maximum time to wait before flushing a batch (in milliseconds)
const MAX_BATCH_WAIT_MS: u64 = 15000; // 15 seconds

/// Maximum size of super cluster event payload (in bytes)
const MAX_SUPER_CLUSTER_EVENT_SIZE: usize = 1024 * 1024; // 1MB

/// Represents different types of trigger updates
#[derive(Debug, Clone)]
pub enum TriggerUpdate {
    /// Full trigger update
    FullUpdate(Trigger),
    /// Status-only update
    StatusUpdate {
        org: String,
        module: TriggerModule,
        module_key: String,
        status: TriggerStatus,
        retries: i32,
        data: Option<String>,
        /// The full trigger for super cluster event
        trigger: Trigger,
    },
}

impl TriggerUpdate {
    /// Returns the trigger key for deduplication
    pub fn get_key(&self) -> String {
        match self {
            TriggerUpdate::FullUpdate(trigger) => {
                format!("{}/{}/{}", trigger.module, trigger.org, trigger.module_key)
            }
            TriggerUpdate::StatusUpdate {
                org,
                module,
                module_key,
                ..
            } => format!("{}/{}/{}", module, org, module_key),
        }
    }

    /// Returns the full trigger for super cluster events
    pub fn get_trigger(&self) -> &Trigger {
        match self {
            TriggerUpdate::FullUpdate(trigger) => trigger,
            TriggerUpdate::StatusUpdate { trigger, .. } => trigger,
        }
    }

    /// Apply the update to a trigger
    pub fn apply_to_trigger(&self, mut trigger: Trigger) -> Trigger {
        match self {
            TriggerUpdate::FullUpdate(new_trigger) => new_trigger.clone(),
            TriggerUpdate::StatusUpdate {
                status,
                retries,
                data,
                ..
            } => {
                trigger.status = status.clone();
                trigger.retries = *retries;
                if let Some(data) = data {
                    trigger.data = data.clone();
                }
                trigger
            }
        }
    }
}

/// Batch of trigger updates to be processed together
#[derive(Debug, Clone)]
struct TriggerBatch {
    /// Map of trigger key to update
    updates: HashMap<String, TriggerUpdate>,
    /// Timestamp when the batch was created
    created_at: Instant,
}

impl TriggerBatch {
    fn new() -> Self {
        Self {
            updates: HashMap::new(),
            created_at: Instant::now(),
        }
    }

    fn add_update(&mut self, update: TriggerUpdate) {
        let key = update.get_key();
        self.updates.insert(key, update);
    }

    fn is_ready_to_flush(&self) -> bool {
        let size_limit_reached = self.updates.len() >= MAX_BATCH_SIZE;
        let time_limit_reached =
            self.created_at.elapsed() >= Duration::from_millis(MAX_BATCH_WAIT_MS);

        size_limit_reached || time_limit_reached
    }

    fn is_empty(&self) -> bool {
        self.updates.is_empty()
    }
}

/// Batched trigger updater that collects trigger updates and flushes them periodically
#[derive(Clone)]
pub struct TriggerBatchUpdater {
    tx: mpsc::UnboundedSender<TriggerUpdate>,
}

impl TriggerBatchUpdater {
    /// Create a new trigger batch updater
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();

        // Spawn the batch processor
        let mut processor = BatchProcessor::new(rx);
        tokio::spawn(async move {
            if let Err(e) = processor.run().await {
                log::error!("[BATCH_UPDATER] Error in batch processor: {}", e);
            }
        });

        Self { tx }
    }

    /// Add a full trigger update to the batch
    pub async fn update_trigger(&self, trigger: Trigger) -> Result<()> {
        let update = TriggerUpdate::FullUpdate(trigger);
        self.tx.send(update).map_err(|e| {
            anyhow::anyhow!("Failed to send trigger update to batch processor: {}", e)
        })?;
        Ok(())
    }

    /// Add a status update to the batch
    pub async fn update_status(
        &self,
        org: &str,
        module: TriggerModule,
        module_key: &str,
        status: TriggerStatus,
        retries: i32,
        data: Option<&str>,
        full_trigger: Trigger,
    ) -> Result<()> {
        let update = TriggerUpdate::StatusUpdate {
            org: org.to_string(),
            module,
            module_key: module_key.to_string(),
            status,
            retries,
            data: data.map(|s| s.to_string()),
            trigger: full_trigger,
        };
        self.tx.send(update).map_err(|e| {
            anyhow::anyhow!("Failed to send status update to batch processor: {}", e)
        })?;
        Ok(())
    }
}

/// Internal batch processor that handles the actual batching and flushing logic
struct BatchProcessor {
    rx: mpsc::UnboundedReceiver<TriggerUpdate>,
    current_batch: Arc<RwLock<TriggerBatch>>,
    flush_tx: mpsc::UnboundedSender<TriggerBatch>,
    flush_rx: Arc<Mutex<mpsc::UnboundedReceiver<TriggerBatch>>>,
}

impl BatchProcessor {
    fn new(rx: mpsc::UnboundedReceiver<TriggerUpdate>) -> Self {
        let (flush_tx, flush_rx) = mpsc::unbounded_channel();

        Self {
            rx,
            current_batch: Arc::new(RwLock::new(TriggerBatch::new())),
            flush_tx,
            flush_rx: Arc::new(Mutex::new(flush_rx)),
        }
    }

    async fn run(&mut self) -> Result<()> {
        // Start the flush processor
        let flush_processor = FlushProcessor::new(self.flush_rx.clone());
        tokio::spawn(async move {
            if let Err(e) = flush_processor.run().await {
                log::error!("[BATCH_UPDATER] Error in flush processor: {}", e);
            }
        });

        // Start the periodic flush timer
        let current_batch = self.current_batch.clone();
        let flush_tx = self.flush_tx.clone();
        tokio::spawn(async move {
            Self::periodic_flush(current_batch, flush_tx).await;
        });

        // Process incoming updates
        while let Some(update) = self.rx.recv().await {
            self.process_update(update).await?;
        }

        log::info!("[BATCH_UPDATER] Batch processor shutting down");
        Ok(())
    }

    async fn process_update(&self, update: TriggerUpdate) -> Result<()> {
        let should_flush = {
            let mut batch = self.current_batch.write().await;
            batch.add_update(update);
            batch.is_ready_to_flush()
        };

        if should_flush {
            self.flush_current_batch().await?;
        }

        Ok(())
    }

    async fn flush_current_batch(&self) -> Result<()> {
        let batch_to_flush = {
            let mut current_batch = self.current_batch.write().await;
            if current_batch.is_empty() {
                return Ok(());
            }
            let batch = current_batch.clone();
            *current_batch = TriggerBatch::new();
            batch
        };

        if let Err(e) = self.flush_tx.send(batch_to_flush) {
            log::error!("[BATCH_UPDATER] Failed to send batch for flushing: {}", e);
        }

        Ok(())
    }

    async fn periodic_flush(
        current_batch: Arc<RwLock<TriggerBatch>>,
        flush_tx: mpsc::UnboundedSender<TriggerBatch>,
    ) {
        let mut interval = interval(Duration::from_millis(MAX_BATCH_WAIT_MS / 3)); // Check every 5 seconds

        loop {
            interval.tick().await;

            let should_flush = {
                let batch = current_batch.read().await;
                !batch.is_empty() && batch.is_ready_to_flush()
            };

            if should_flush {
                let batch_to_flush = {
                    let mut batch = current_batch.write().await;
                    if batch.is_empty() {
                        continue;
                    }
                    let to_flush = batch.clone();
                    *batch = TriggerBatch::new();
                    to_flush
                };

                if let Err(e) = flush_tx.send(batch_to_flush) {
                    log::error!(
                        "[BATCH_UPDATER] Failed to send periodic batch for flushing: {}",
                        e
                    );
                }
            }
        }
    }
}

/// Handles the actual database operations and super cluster events
struct FlushProcessor {
    rx: Arc<Mutex<mpsc::UnboundedReceiver<TriggerBatch>>>,
}

impl FlushProcessor {
    fn new(rx: Arc<Mutex<mpsc::UnboundedReceiver<TriggerBatch>>>) -> Self {
        Self { rx }
    }

    async fn run(&self) -> Result<()> {
        let mut rx = self.rx.lock().await;

        while let Some(batch) = rx.recv().await {
            if let Err(e) = self.flush_batch(batch).await {
                log::error!("[BATCH_UPDATER] Error flushing batch: {}", e);
            }
        }

        log::info!("[BATCH_UPDATER] Flush processor shutting down");
        Ok(())
    }

    async fn flush_batch(&self, batch: TriggerBatch) -> Result<()> {
        if batch.is_empty() {
            return Ok(());
        }

        let batch_size = batch.updates.len();
        let start_time = Instant::now();

        log::debug!("[BATCH_UPDATER] Flushing batch with {} updates", batch_size);

        // Group updates by type for efficient processing
        let mut full_updates = Vec::new();
        let mut status_updates = Vec::new();

        for (_, update) in batch.updates {
            match update {
                TriggerUpdate::FullUpdate(trigger) => full_updates.push(trigger),
                TriggerUpdate::StatusUpdate {
                    org,
                    module,
                    module_key,
                    status,
                    retries,
                    data,
                    trigger,
                } => {
                    status_updates.push((org, module, module_key, status, retries, data, trigger));
                }
            }
        }

        // Execute bulk database operations
        if !full_updates.is_empty() {
            if let Err(e) = self.bulk_update_triggers(full_updates.clone()).await {
                log::error!("[BATCH_UPDATER] Error in bulk trigger updates: {}", e);
                // Fallback to individual updates
                for trigger in full_updates.clone() {
                    if let Err(e) = crate::service::db::scheduler::update_trigger(trigger).await {
                        log::error!("[BATCH_UPDATER] Error in fallback trigger update: {}", e);
                    }
                }
            }
        }

        if !status_updates.is_empty() {
            if let Err(e) = self.bulk_update_status(status_updates.clone()).await {
                log::error!("[BATCH_UPDATER] Error in bulk status updates: {}", e);
                // Fallback to individual updates
                for (org, module, module_key, status, retries, data, _) in status_updates.clone() {
                    if let Err(e) = crate::service::db::scheduler::update_status(
                        &org,
                        module,
                        &module_key,
                        status,
                        retries,
                        data.as_deref(),
                    )
                    .await
                    {
                        log::error!("[BATCH_UPDATER] Error in fallback status update: {}", e);
                    }
                }
            }
        }

        // Send super cluster events
        self.send_super_cluster_events(full_updates, status_updates)
            .await?;

        let duration = start_time.elapsed();
        log::debug!(
            "[BATCH_UPDATER] Flushed batch with {} updates in {:?}",
            batch_size,
            duration
        );

        Ok(())
    }

    async fn bulk_update_triggers(&self, triggers: Vec<Trigger>) -> Result<()> {
        infra::scheduler::bulk_update_triggers(triggers)
            .await
            .map_err(|e| anyhow::anyhow!("Bulk update triggers failed: {}", e))
    }

    async fn bulk_update_status(
        &self,
        updates: Vec<(
            String,
            TriggerModule,
            String,
            TriggerStatus,
            i32,
            Option<String>,
            Trigger,
        )>,
    ) -> Result<()> {
        // Convert to format expected by infra layer (remove the Trigger parameter)
        let infra_updates: Vec<(
            String,
            TriggerModule,
            String,
            TriggerStatus,
            i32,
            Option<String>,
        )> = updates
            .into_iter()
            .map(|(org, module, module_key, status, retries, data, _)| {
                (org, module, module_key, status, retries, data)
            })
            .collect();

        infra::scheduler::bulk_update_status(infra_updates)
            .await
            .map_err(|e| anyhow::anyhow!("Bulk update status failed: {}", e))
    }

    async fn send_super_cluster_events(
        &self,
        full_updates: Vec<Trigger>,
        status_updates: Vec<(
            String,
            TriggerModule,
            String,
            TriggerStatus,
            i32,
            Option<String>,
            Trigger,
        )>,
    ) -> Result<()> {
        #[cfg(feature = "enterprise")]
        {
            let config = get_o2_config();
            if !config.super_cluster.enabled {
                return Ok(());
            }

            // Send events for full updates
            self.send_batched_super_cluster_events(
                full_updates.into_iter().map(|t| (t, false)).collect(),
            )
            .await?;

            // Send events for status updates (extract triggers)
            let status_triggers: Vec<(Trigger, bool)> = status_updates
                .into_iter()
                .map(|(_, _, _, _, _, _, trigger)| (trigger, true))
                .collect();

            self.send_batched_super_cluster_events(status_triggers)
                .await?;
        }

        Ok(())
    }

    #[cfg(feature = "enterprise")]
    async fn send_batched_super_cluster_events(
        &self,
        triggers: Vec<(Trigger, bool)>,
    ) -> Result<()> {
        if triggers.is_empty() {
            return Ok(());
        }

        // Split triggers into batches based on size to avoid large event payloads
        let mut current_batch = Vec::new();
        let mut current_size = 0;

        for (trigger, is_status_update) in triggers {
            // Estimate size (rough approximation)
            let trigger_size =
                trigger.data.len() + trigger.org.len() + trigger.module_key.len() + 200; // Approximate overhead

            if current_size + trigger_size > MAX_SUPER_CLUSTER_EVENT_SIZE
                && !current_batch.is_empty()
            {
                // Send current batch
                self.send_super_cluster_batch(current_batch).await?;
                current_batch = Vec::new();
                current_size = 0;
            }

            current_batch.push((trigger, is_status_update));
            current_size += trigger_size;
        }

        // Send remaining batch
        if !current_batch.is_empty() {
            self.send_super_cluster_batch(current_batch).await?;
        }

        Ok(())
    }

    #[cfg(feature = "enterprise")]
    async fn send_super_cluster_batch(&self, batch: Vec<(Trigger, bool)>) -> Result<()> {
        // For now, send individual events to maintain compatibility
        // In the future, we could implement a true batch event
        for (trigger, is_status_update) in batch {
            if is_status_update {
                if let Err(e) = super_cluster::queue::scheduler_update_status(
                    &trigger.org,
                    MetaTriggerModule::from(trigger.module),
                    &trigger.module_key,
                    trigger.status,
                    trigger.retries,
                    Some(&trigger.data),
                )
                .await
                {
                    log::error!(
                        "[BATCH_UPDATER] Error sending super cluster status update: {}",
                        e
                    );
                }
            } else {
                if let Err(e) = super_cluster::queue::scheduler_update(trigger).await {
                    log::error!(
                        "[BATCH_UPDATER] Error sending super cluster trigger update: {}",
                        e
                    );
                }
            }
        }
        Ok(())
    }
}

// Global instance
use std::sync::OnceLock;
static BATCH_UPDATER: OnceLock<TriggerBatchUpdater> = OnceLock::new();

/// Get the global batch updater instance
pub fn get_batch_updater() -> &'static TriggerBatchUpdater {
    BATCH_UPDATER.get_or_init(|| TriggerBatchUpdater::new())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[tokio::test]
    async fn test_trigger_update_key_generation() {
        let trigger = Trigger {
            id: 1,
            org: "test_org".to_string(),
            module: TriggerModule::Alert,
            module_key: "test_alert".to_string(),
            status: TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: "{}".to_string(),
        };

        let full_update = TriggerUpdate::FullUpdate(trigger.clone());
        let status_update = TriggerUpdate::StatusUpdate {
            org: trigger.org.clone(),
            module: trigger.module.clone(),
            module_key: trigger.module_key.clone(),
            status: TriggerStatus::Processing,
            retries: 1,
            data: Some("{}".to_string()),
            trigger: trigger.clone(),
        };

        assert_eq!(full_update.get_key(), status_update.get_key());
        assert_eq!(full_update.get_key(), "Alert/test_org/test_alert");
    }

    #[test]
    fn test_batch_ready_to_flush() {
        let mut batch = TriggerBatch::new();

        // Empty batch should not be ready to flush
        assert!(!batch.is_ready_to_flush());

        // Add updates up to the size limit
        for i in 0..MAX_BATCH_SIZE {
            let trigger = Trigger {
                id: i as i64,
                org: "test_org".to_string(),
                module: TriggerModule::Alert,
                module_key: format!("alert_{}", i),
                status: TriggerStatus::Waiting,
                start_time: Some(Utc::now().timestamp_micros()),
                end_time: None,
                retries: 0,
                next_run_at: Utc::now().timestamp_micros(),
                is_realtime: false,
                is_silenced: false,
                data: "{}".to_string(),
            };
            batch.add_update(TriggerUpdate::FullUpdate(trigger));
        }

        // Should be ready to flush due to size limit
        assert!(batch.is_ready_to_flush());
    }

    #[tokio::test]
    async fn test_batch_updater_creation() {
        let updater = TriggerBatchUpdater::new();

        // Should be able to create multiple instances
        let _updater2 = TriggerBatchUpdater::new();

        // Basic functionality test
        let trigger = Trigger {
            id: 1,
            org: "test_org".to_string(),
            module: TriggerModule::Alert,
            module_key: "test_alert".to_string(),
            status: TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: "{}".to_string(),
        };

        // Should not panic when sending updates
        assert!(updater.update_trigger(trigger.clone()).await.is_ok());

        // Create a separate trigger instance for status update to avoid borrow issues
        let trigger2 = trigger.clone();
        assert!(
            updater
                .update_status(
                    &trigger2.org,
                    trigger2.module,
                    &trigger2.module_key,
                    TriggerStatus::Processing,
                    1,
                    Some("{}"),
                    trigger2,
                )
                .await
                .is_ok()
        );
    }
}

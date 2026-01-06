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

use async_nats::jetstream;
use chrono::Utc;
use config::{cluster, get_config, meta::self_reporting::nats::*, utils::time::now_micros};
use futures::TryStreamExt;

use crate::errors::*;

pub struct NatsVisibilityCollector {
    batch: Vec<NatsVisibilityEvent>,
}

impl NatsVisibilityCollector {
    pub fn new() -> Self {
        Self { batch: Vec::new() }
    }

    /// Main collection loop - call this every interval
    /// Collects metrics and buffers them in memory
    pub async fn collect_and_buffer(&mut self) -> Result<()> {
        let cfg = get_config();
        if !cfg.nats_visibility.enabled {
            return Ok(());
        }

        log::info!("[NATS Visibility] Starting collection cycle");

        // Clear previous batch
        self.batch.clear();

        // Collect stream metrics
        if cfg.nats_visibility.monitor_streams {
            if let Err(e) = self.collect_stream_metrics().await {
                log::error!("[NATS Visibility] Stream collection error: {}", e);
            }
        }

        // Collect consumer metrics
        if cfg.nats_visibility.monitor_consumers {
            if let Err(e) = self.collect_consumer_metrics().await {
                log::error!("[NATS Visibility] Consumer collection error: {}", e);
            }
        }

        // Buffer events instead of sending immediately
        if !self.batch.is_empty() {
            self.buffer_events().await;
        }

        log::info!(
            "[NATS Visibility] Collection cycle complete ({} events buffered)",
            self.batch.len()
        );
        Ok(())
    }

    async fn collect_stream_metrics(&mut self) -> Result<()> {
        log::info!("[NATS Visibility] Connecting to NATS to collect stream metrics...");
        let client = crate::db::nats::get_nats_client().await.clone();
        let jetstream = jetstream::new(client);

        log::info!("[NATS Visibility] Listing JetStream streams...");
        let mut streams = jetstream.streams();
        let mut stream_count = 0;

        while let Some(stream_info) = streams.try_next().await? {
            stream_count += 1;
            log::info!(
                "[NATS Visibility] Found stream: {}",
                stream_info.config.name
            );

            // Calculate capacity
            let capacity_pct = if stream_info.config.max_bytes > 0 {
                (stream_info.state.bytes as f64 / stream_info.config.max_bytes as f64) * 100.0
            } else {
                0.0
            };

            let stream_data = StreamEventData {
                stream_name: stream_info.config.name.clone(),
                stream_type: "jetstream".to_string(),
                storage_type: format!("{:?}", stream_info.config.storage).to_lowercase(),
                retention_policy: format!("{:?}", stream_info.config.retention).to_lowercase(),
                discard_policy: "old".to_string(),
                num_replicas: stream_info.config.num_replicas,
                max_bytes_configured: stream_info.config.max_bytes as i64,
                max_messages_configured: stream_info.config.max_messages as i64,
                max_age_seconds: stream_info.config.max_age.as_secs(),
                max_message_size: stream_info.config.max_message_size as i64,
                duplicate_window_seconds: stream_info.config.duplicate_window.as_secs(),
                stream_sealed: false,
                deny_delete: false,
                deny_purge: false,
                messages_total: stream_info.state.messages,
                bytes_total: stream_info.state.bytes,
                messages_first_seq: stream_info.state.first_sequence,
                messages_last_seq: stream_info.state.last_sequence,
                consumer_count: stream_info.state.consumer_count,
                num_subjects: 0,
                capacity_used_percent: capacity_pct,
                oldest_message_age_seconds: None,
                stream_created_time: (stream_info.created.unix_timestamp_nanos() / 1000) as i64,
                first_message_time: None,
                last_message_time: None,
                snapshot_time: now_micros(),
                nats_cluster_name: stream_info
                    .cluster
                    .as_ref()
                    .and_then(|c| c.name.as_ref())
                    .cloned()
                    .unwrap_or_default(),
                raft_group_id: String::new(),
                leader_node: stream_info
                    .cluster
                    .as_ref()
                    .and_then(|c| c.leader.as_ref())
                    .cloned()
                    .unwrap_or_default(),
                replicas: stream_info
                    .cluster
                    .as_ref()
                    .map(|c| {
                        c.replicas
                            .iter()
                            .map(|r| ReplicaInfo {
                                replica_name: r.name.clone(),
                                is_current: r.current,
                                lag_nanoseconds: r.active.as_nanos() as u64,
                                lag_milliseconds: r.active.as_nanos() as f64 / 1_000_000.0,
                                lag_seconds: r.active.as_secs_f64(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            };

            let event = self.create_base_event(
                NatsEventType::Stream,
                "capacity".to_string(),
                EventData::Stream(stream_data.clone()),
            );
            self.batch.push(event);

            // Check for basic anomalies
            self.check_stream_anomalies(&stream_data);
        }

        log::info!("[NATS Visibility] Collected {} stream events", stream_count);
        Ok(())
    }

    async fn collect_consumer_metrics(&mut self) -> Result<()> {
        log::info!("[NATS Visibility] Starting consumer metrics collection...");
        let client = crate::db::nats::get_nats_client().await.clone();
        let jetstream = jetstream::new(client);

        let mut streams = jetstream.streams();
        let mut consumer_count = 0;

        while let Some(stream_info) = streams.try_next().await? {
            let stream_name = stream_info.config.name.clone();

            // Get stream object to access consumers
            let stream = jetstream.get_stream(&stream_name).await.map_err(|e| {
                Error::Message(format!(
                    "[NATS Visibility] Failed to get stream {}: {}",
                    stream_name, e
                ))
            })?;

            // Get all consumers for this stream
            let mut consumers = stream.consumer_names();
            while let Some(consumer_name) = consumers.try_next().await? {
                consumer_count += 1;

                // Get consumer info
                let mut consumer: jetstream::consumer::Consumer<jetstream::consumer::pull::Config> =
                    stream.get_consumer(&consumer_name).await.map_err(|e| {
                        Error::Message(format!(
                            "[NATS Visibility] Failed to get consumer {}: {}",
                            consumer_name, e
                        ))
                    })?;
                let consumer_info = consumer.info().await.map_err(|e| {
                    Error::Message(format!(
                        "[NATS Visibility] Failed to get consumer info {}: {}",
                        consumer_name, e
                    ))
                })?;

                // Derive status based on last activity
                let status = if let Some(last_active) = consumer_info.delivered.last_active {
                    let now_nanos = Utc::now().timestamp_nanos_opt().unwrap_or(0) as i64;
                    let last_active_nanos = last_active.unix_timestamp_nanos() as i64;
                    let seconds_ago = (now_nanos - last_active_nanos) / 1_000_000_000;
                    if seconds_ago < 120 {
                        "active"
                    } else if seconds_ago < 600 {
                        "stalled"
                    } else {
                        "inactive"
                    }
                } else {
                    "inactive"
                };

                // Calculate lag
                let lag_count = consumer_info.num_pending as i64;

                let consumer_data = ConsumerEventData {
                    consumer_name: consumer_name.clone(),
                    stream_name: stream_name.clone(),
                    is_durable: consumer_info.config.durable_name.is_some(),
                    is_pull_consumer: true,
                    ack_policy: format!("{:?}", consumer_info.config.ack_policy),
                    ack_wait_seconds: consumer_info.config.ack_wait.as_secs(),
                    deliver_policy: format!("{:?}", consumer_info.config.deliver_policy),
                    replay_policy: format!("{:?}", consumer_info.config.replay_policy),
                    max_deliver: consumer_info.config.max_deliver as i64,
                    max_ack_pending_configured: consumer_info.config.max_ack_pending as usize,
                    max_waiting_pulls: consumer_info.config.max_waiting as usize,
                    consumer_num_replicas: consumer_info.config.num_replicas,
                    is_paused: consumer_info.paused,
                    pause_until: None, // Not available in async-nats 0.42
                    status: status.to_string(),
                    last_activity_timestamp: consumer_info
                        .delivered
                        .last_active
                        .map(|t| (t.unix_timestamp_nanos() / 1000) as i64),
                    delivered_seq: consumer_info.delivered.stream_sequence,
                    delivered_count: consumer_info.delivered.consumer_sequence,
                    ack_floor_seq: consumer_info.ack_floor.stream_sequence,
                    ack_floor_count: consumer_info.ack_floor.consumer_sequence,
                    ack_pending_count: consumer_info.num_ack_pending as usize,
                    num_pending: consumer_info.num_pending,
                    num_redelivered: consumer_info.num_redelivered as u64,
                    num_waiting: consumer_info.num_waiting as usize,
                    lag_count,
                    consumer_created_time: (consumer_info.created.unix_timestamp_nanos() / 1000)
                        as i64,
                    last_delivered_time: consumer_info
                        .delivered
                        .last_active
                        .map(|t| (t.unix_timestamp_nanos() / 1000) as i64),
                    last_ack_time: None,
                    processing_lag_ms: None,
                    snapshot_time: now_micros(),
                    messages_per_second: None,
                    ack_rate_per_second: None,
                    error_count_last_minute: None,
                    nats_cluster_name: consumer_info
                        .cluster
                        .as_ref()
                        .and_then(|c| c.name.as_ref())
                        .cloned()
                        .unwrap_or_default(),
                    raft_group_id: String::new(),
                    leader_node: consumer_info
                        .cluster
                        .as_ref()
                        .and_then(|c| c.leader.as_ref())
                        .cloned()
                        .unwrap_or_default(),
                    replicas: consumer_info
                        .cluster
                        .as_ref()
                        .map(|c| {
                            c.replicas
                                .iter()
                                .map(|r| ReplicaInfo {
                                    replica_name: r.name.clone(),
                                    is_current: r.current,
                                    lag_nanoseconds: r.active.as_nanos() as u64,
                                    lag_milliseconds: r.active.as_nanos() as f64 / 1_000_000.0,
                                    lag_seconds: r.active.as_secs_f64(),
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                };

                let event = self.create_base_event(
                    NatsEventType::Consumer,
                    "lag".to_string(),
                    EventData::Consumer(consumer_data.clone()),
                );
                self.batch.push(event);

                // Check for anomalies
                self.check_consumer_anomalies(&consumer_data);
            }
        }

        log::info!(
            "[NATS Visibility] Collected {} consumer events",
            consumer_count
        );
        Ok(())
    }

    fn check_stream_anomalies(&mut self, stream_data: &StreamEventData) {
        let cfg = get_config();

        // Anomaly: Zero consumers with messages
        if stream_data.consumer_count == 0 && stream_data.messages_total > 0 {
            let anomaly = self.create_anomaly(
                &stream_data.stream_name,
                anomaly_types::ZERO_CONSUMERS_WITH_MESSAGES,
                "availability",
                "critical",
                stream_data.consumer_count as f64,
                Some(1.0),
                "Stream has messages but no consumers",
                &format!(
                    "Stream {} has {} messages but 0 consumers",
                    stream_data.stream_name, stream_data.messages_total
                ),
                "Check if consumer crashed or was deleted. Create consumer or restart O2 pods.",
                "Messages are piling up and not being processed",
                stream_data.messages_total,
                stream_data.bytes_total,
                0,
                stream_data.consumer_count,
                vec![],
            );
            self.batch.push(anomaly);
        }

        // Anomaly: Stream near capacity
        if stream_data.capacity_used_percent > cfg.nats_visibility.capacity_threshold_percent {
            let anomaly = self.create_anomaly(
                &stream_data.stream_name,
                anomaly_types::STREAM_NEAR_CAPACITY,
                "capacity",
                "warning",
                stream_data.capacity_used_percent,
                Some(cfg.nats_visibility.capacity_threshold_percent),
                "Stream approaching capacity limit",
                &format!(
                    "Stream {} is at {:.1}% capacity ({} bytes / {} bytes)",
                    stream_data.stream_name,
                    stream_data.capacity_used_percent,
                    stream_data.bytes_total,
                    stream_data.max_bytes_configured
                ),
                "Consider increasing max_bytes for stream or processing messages faster",
                "Stream may start rejecting new messages when full",
                stream_data.messages_total,
                stream_data.bytes_total,
                0,
                stream_data.consumer_count,
                vec![],
            );
            self.batch.push(anomaly);
        }

        // Anomaly: High replica lag
        for replica in &stream_data.replicas {
            if replica.lag_seconds > cfg.nats_visibility.replica_lag_threshold_secs {
                let anomaly = self.create_anomaly(
                    &stream_data.stream_name,
                    anomaly_types::HIGH_REPLICA_LAG,
                    "replication",
                    "warning",
                    replica.lag_seconds,
                    Some(cfg.nats_visibility.replica_lag_threshold_secs),
                    "Replica lagging behind leader",
                    &format!(
                        "Replica {} on stream {} is lagging by {:.2}s",
                        replica.replica_name, stream_data.stream_name, replica.lag_seconds
                    ),
                    "Check network connectivity and replica node health",
                    "Data may not be fully replicated, risking data loss",
                    stream_data.messages_total,
                    stream_data.bytes_total,
                    0,
                    stream_data.consumer_count,
                    vec![replica.replica_name.clone()],
                );
                self.batch.push(anomaly);
            }
        }
    }

    fn check_consumer_anomalies(&mut self, consumer_data: &ConsumerEventData) {
        let cfg = get_config();

        // Anomaly: High consumer lag
        if consumer_data.lag_count > cfg.nats_visibility.lag_threshold {
            let anomaly = self.create_anomaly(
                &consumer_data.stream_name,
                anomaly_types::HIGH_CONSUMER_LAG,
                "lag",
                "warning",
                consumer_data.lag_count as f64,
                Some(cfg.nats_visibility.lag_threshold as f64),
                "Consumer falling behind",
                &format!(
                    "Consumer {} on stream {} has {} pending messages",
                    consumer_data.consumer_name, consumer_data.stream_name, consumer_data.lag_count
                ),
                "Scale up consumer pods or optimize processing logic",
                "Messages are accumulating, increasing processing delay",
                consumer_data.num_pending,
                0,
                0,
                1,
                vec![consumer_data.consumer_name.clone()],
            );
            self.batch.push(anomaly);
        }

        // Anomaly: Consumer stuck/inactive
        if consumer_data.status == "inactive" || consumer_data.status == "stalled" {
            let severity = if consumer_data.status == "inactive" {
                "critical"
            } else {
                "warning"
            };
            let anomaly = self.create_anomaly(
                &consumer_data.stream_name,
                anomaly_types::CONSUMER_STUCK,
                "availability",
                severity,
                0.0,
                Some(1.0),
                &format!("Consumer is {}", consumer_data.status),
                &format!(
                    "Consumer {} on stream {} has been {} (last active: {:?})",
                    consumer_data.consumer_name,
                    consumer_data.stream_name,
                    consumer_data.status,
                    consumer_data.last_activity_timestamp
                ),
                "Check consumer logs for errors. Restart consumer pod if stuck.",
                "Messages are not being processed",
                consumer_data.num_pending,
                0,
                0,
                1,
                vec![consumer_data.consumer_name.clone()],
            );
            self.batch.push(anomaly);
        }
    }

    fn create_base_event(
        &self,
        event_type: NatsEventType,
        event_category: String,
        data: EventData,
    ) -> NatsVisibilityEvent {
        let node = &cluster::LOCAL_NODE;
        let node_role = node
            .role
            .iter()
            .map(|r| format!("{:?}", r))
            .collect::<Vec<_>>()
            .join(",");

        NatsVisibilityEvent {
            timestamp: now_micros(),
            cluster_name: get_config().common.cluster_name.clone(),
            node_id: node.id,
            node_uuid: node.uuid.clone(),
            node_role,
            event_type,
            event_category,
            data,
            severity: None,
            error_message: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn create_anomaly(
        &self,
        stream_name: &str,
        anomaly_type: &str,
        category: &str,
        severity: &str,
        current_value: f64,
        threshold: Option<f64>,
        short_message: &str,
        detailed_message: &str,
        recommended_action: &str,
        impact: &str,
        messages_total: u64,
        bytes_total: u64,
        oldest_message_age_seconds: i64,
        consumer_count: usize,
        affected_entities: Vec<String>,
    ) -> NatsVisibilityEvent {
        let anomaly_data = StreamHealthAnomalyEventData {
            stream_name: stream_name.to_string(),
            anomaly_type: anomaly_type.to_string(),
            anomaly_category: category.to_string(),
            severity: severity.to_string(),
            current_value,
            expected_value: None,
            threshold_value: threshold,
            deviation_percent: None,
            title: short_message.to_string(),
            description: detailed_message.to_string(),
            recommendation: recommended_action.to_string(),
            impact: impact.to_string(),
            stream_messages: messages_total,
            stream_bytes: bytes_total,
            stream_age_seconds: oldest_message_age_seconds,
            consumer_count,
            affected_consumers: affected_entities.clone(),
            affected_nodes: vec![],
        };

        let node = &cluster::LOCAL_NODE;
        let node_role = node
            .role
            .iter()
            .map(|r| format!("{:?}", r))
            .collect::<Vec<_>>()
            .join(",");

        NatsVisibilityEvent {
            timestamp: now_micros(),
            cluster_name: get_config().common.cluster_name.clone(),
            node_id: node.id,
            node_uuid: node.uuid.clone(),
            node_role,
            event_type: NatsEventType::Anomaly,
            event_category: category.to_string(),
            data: EventData::Anomaly(anomaly_data),
            severity: Some(severity.to_string()),
            error_message: Some(detailed_message.to_string()),
        }
    }

    /// Buffer collected events to global in-memory buffer
    async fn buffer_events(&mut self) {
        if self.batch.is_empty() {
            return;
        }

        // Log summary statistics
        let stream_count = self
            .batch
            .iter()
            .filter(|e| matches!(e.event_type, NatsEventType::Stream))
            .count();
        let consumer_count = self
            .batch
            .iter()
            .filter(|e| matches!(e.event_type, NatsEventType::Consumer))
            .count();
        let anomaly_count = self
            .batch
            .iter()
            .filter(|e| matches!(e.event_type, NatsEventType::Anomaly))
            .count();

        log::info!(
            "[NATS Visibility] Collected {} events: {} streams, {} consumers, {} anomalies",
            self.batch.len(),
            stream_count,
            consumer_count,
            anomaly_count
        );

        // Log anomalies at appropriate level
        for event in &self.batch {
            if let NatsEventType::Anomaly = event.event_type {
                if let EventData::Anomaly(anomaly) = &event.data {
                    match anomaly.severity.as_str() {
                        "critical" => log::error!(
                            "[NATS Visibility] CRITICAL: {} - {}",
                            anomaly.title,
                            anomaly.description
                        ),
                        "warning" => log::warn!(
                            "[NATS Visibility] WARNING: {} - {}",
                            anomaly.title,
                            anomaly.description
                        ),
                        _ => log::info!(
                            "[NATS Visibility] INFO: {} - {}",
                            anomaly.title,
                            anomaly.description
                        ),
                    }
                }
            }
        }

        // Add to global buffer
        crate::nats_visibility::buffer_events(self.batch.clone()).await;
    }
}

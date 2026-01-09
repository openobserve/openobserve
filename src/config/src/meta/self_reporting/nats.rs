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

use serde::{Deserialize, Serialize};

pub const NATS_VISIBILITY_STREAM: &str = "nats_visibility";

// ============================================================================
// Base Event Structure
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NatsVisibilityEvent {
    #[serde(rename = "_timestamp")]
    pub timestamp: i64, // Microseconds since epoch

    // Node identity
    pub cluster_name: String,
    pub node_id: i32,
    pub node_uuid: String,
    pub node_role: String, // "ingester", "querier", "compactor", etc.

    // Event classification
    pub event_type: NatsEventType,
    pub event_category: String, // "capacity", "health", "performance", "anomaly"

    // Event data (polymorphic)
    #[serde(flatten)]
    pub data: EventData,

    // Optional fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>, // "info", "warning", "critical"

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NatsEventType {
    Stream,
    Consumer,
    Queue,
    AckPipeline,
    ConsumerGroup,
    NodeActivity,
    Account,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EventData {
    Stream(StreamEventData),
    Consumer(ConsumerEventData),
    Queue(QueueEventData),
    AckPipeline(AckPipelineEventData),
    ConsumerGroup(ConsumerGroupEventData),
    NodeActivity(NodeActivityEventData),
    Account(AccountHealthEventData),
}

// ============================================================================
// 1. Stream Event Data
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamEventData {
    // Identity
    pub stream_name: String,
    pub stream_type: String, // "queue" or "kv"

    // Configuration
    pub storage_type: String,     // "file" or "memory"
    pub retention_policy: String, // "limits" or "interest"
    pub discard_policy: String,   // "old" or "new"
    pub num_replicas: usize,
    pub max_bytes_configured: i64,
    pub max_messages_configured: i64,
    pub max_age_seconds: u64,
    pub max_message_size: i64,
    pub duplicate_window_seconds: u64,

    // Stream state flags
    pub stream_sealed: bool,
    pub deny_delete: bool,
    pub deny_purge: bool,

    // Current state
    pub messages_total: u64,
    pub bytes_total: u64,
    pub messages_first_seq: u64,
    pub messages_last_seq: u64,
    pub consumer_count: usize,
    pub num_subjects: u64,

    // Calculated metrics
    pub capacity_used_percent: f64,
    pub oldest_message_age_seconds: Option<i64>,

    // Timestamps
    pub stream_created_time: i64,
    pub first_message_time: Option<i64>,
    pub last_message_time: Option<i64>,
    pub snapshot_time: i64,

    // Cluster replication health
    pub nats_cluster_name: String,
    pub raft_group_id: String,
    pub leader_node: String,
    pub replicas: Vec<ReplicaInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplicaInfo {
    pub replica_name: String,
    pub is_current: bool,
    pub lag_nanoseconds: u64,
    pub lag_milliseconds: f64,
    pub lag_seconds: f64,
}

// ============================================================================
// 2. Consumer Event Data
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsumerEventData {
    // Identity
    pub consumer_name: String,
    pub stream_name: String,
    pub is_durable: bool,
    pub is_pull_consumer: bool,

    // Configuration
    pub ack_policy: String,
    pub ack_wait_seconds: u64,
    pub deliver_policy: String,
    pub replay_policy: String,
    pub max_deliver: i64,
    pub max_ack_pending_configured: usize,
    pub max_waiting_pulls: usize,
    pub consumer_num_replicas: usize,

    // Pause state
    pub is_paused: bool,
    pub pause_until: Option<i64>,

    // Status (derived)
    pub status: String, // "active", "inactive", "stalled"
    pub last_activity_timestamp: Option<i64>,

    // Delivery tracking
    pub delivered_seq: u64,
    pub delivered_count: u64,

    // Acknowledgment tracking
    pub ack_floor_seq: u64,
    pub ack_floor_count: u64,
    pub ack_pending_count: usize,

    // Message state
    pub num_pending: u64,
    pub num_redelivered: u64,
    pub num_waiting: usize,

    // Calculated lag
    pub lag_count: i64,

    // Timestamps
    pub consumer_created_time: i64,
    pub last_delivered_time: Option<i64>,
    pub last_ack_time: Option<i64>,
    pub processing_lag_ms: Option<f64>,
    pub snapshot_time: i64,

    // Performance (from instrumentation - Phase 2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_per_second: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ack_rate_per_second: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_count_last_minute: Option<u64>,

    // Cluster replication health
    pub nats_cluster_name: String,
    pub raft_group_id: String,
    pub leader_node: String,
    pub replicas: Vec<ReplicaInfo>,
}

// ============================================================================
// 3. Queue Operations Event Data (Phase 2 - Instrumentation)
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueEventData {
    pub queue_name: String,
    pub stream_name: String,
    pub operation: String, // "publish" or "consume"

    // Publish metrics (last minute)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_published_count: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_publish_failed_count: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_latency_avg_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_latency_p50_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_latency_p95_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_latency_p99_ms: Option<f64>,

    // Consume metrics (last minute)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_received_count: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_acked_count: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages_nacked_count: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_latency_avg_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_latency_p50_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_latency_p95_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_latency_p99_ms: Option<f64>,
}

// ============================================================================
// 4. Two-Level Ack Pipeline Event Data (Phase 2)
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AckPipelineEventData {
    pub stream_name: String,
    pub consumer_name: String,

    // Level 1: Publisher → NATS JetStream
    pub level1_publish_count: u64,
    pub level1_publish_success: u64,
    pub level1_publish_failed: u64,
    pub level1_avg_latency_ms: f64,
    pub level1_success_rate: f64,

    // In JetStream
    pub in_stream_count: u64,
    pub in_stream_oldest_age_seconds: Option<i64>,

    // Level 1 → Level 2: Delivery
    pub delivered_to_consumer: u64,
    pub pending_delivery: u64,

    // Level 2: Consumer → Processing Complete
    pub level2_processing_started: u64,
    pub level2_processing_success: u64,
    pub level2_processing_failed: u64,
    pub level2_acked: u64,
    pub level2_nacked: u64,
    pub level2_redelivered: u64,
    pub level2_avg_latency_ms: f64,
    pub level2_success_rate: f64,

    // Overall pipeline health
    pub end_to_end_success_rate: f64,
    pub total_pipeline_latency_ms: f64,
}

// ============================================================================
// 5. Consumer Group Event Data
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsumerGroupEventData {
    pub queue_name: String,
    pub stream_name: String,

    pub consumers: Vec<ConsumerSummary>,

    pub total_consumers: usize,
    pub active_consumers: usize,
    pub inactive_consumers: usize,
    pub stalled_consumers: usize,
    pub paused_consumers: usize,
    pub health_percent: f64,

    pub max_lag: i64,
    pub min_lag: i64,
    pub avg_lag: f64,
    pub balanced: bool,

    // Aggregated metrics
    pub total_pending: u64,
    pub total_ack_pending: u64,
    pub total_redelivered: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsumerSummary {
    pub consumer_name: String,
    pub node_id: Option<i32>,
    pub node_role: Option<String>,
    pub status: String,
    pub lag: i64,
    pub pending: u64,
    pub ack_pending: usize,
    pub last_activity: Option<i64>,
}

// ============================================================================
// 6. Node Activity Event Data
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeActivityEventData {
    pub publishing_to_queues: Vec<QueueActivity>,
    pub consuming_from_queues: Vec<QueueActivity>,

    pub all_consumers_healthy: bool,
    pub total_messages_in_flight: u64,
    pub total_lag: i64,
    pub total_pending: u64,
    pub total_ack_pending: u64,

    // Node-level summary
    pub active_publishers: usize,
    pub active_consumers: usize,
    pub failed_publishes_last_minute: u64,
    pub failed_acks_last_minute: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueActivity {
    pub queue_name: String,
    pub consumer_name: Option<String>,
    pub messages_count: u64,
    pub status: Option<String>,
    pub lag: Option<i64>,
    pub pending: Option<u64>,
}

// ============================================================================
// 7. Account Health Event Data
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountHealthEventData {
    pub domain: String,

    // Usage
    pub storage_bytes: u64,
    pub storage_mb: f64,
    pub storage_gb: f64,
    pub memory_bytes: u64,
    pub memory_mb: f64,
    pub total_streams: usize,
    pub total_consumers: usize,

    // Limits
    pub max_payload_bytes: u64,
    pub max_payload_mb: f64,
    pub storage_limit_bytes: Option<u64>,
    pub storage_limit_gb: Option<f64>,
    pub streams_limit: Option<usize>,
    pub consumers_limit: Option<usize>,

    // Utilization percentages
    pub storage_used_percent: Option<f64>,
    pub streams_used_percent: Option<f64>,
    pub consumers_used_percent: Option<f64>,

    // Reserved vs actual
    pub storage_reserved_gb: Option<f64>,
}

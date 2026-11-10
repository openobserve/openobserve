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

use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::{meta::search::ScanStats, utils::record_batch_ext::RecordBatchExt};
use datafusion::{
    self,
    physical_plan::metrics::{
        self, ExecutionPlanMetricsSet, MetricBuilder, MetricValue, MetricsSet,
    },
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::profile::RemoteNodeProfile;

/// Flight action that fetches a node's report on one finished run.
pub const QUERY_PROFILE_ACTION: &str = "query_profile";

const DECODE_TIME: &str = "decode_time";
const BATCHES_RECEIVED: &str = "batches_received";

#[derive(Debug, Clone)]
pub struct RemoteScanMetrics {
    /// Time in nanos to execute child operator and fetch batches
    pub fetch_time: metrics::Time,
    /// Time in nanos to perform decoding
    pub decode_time: metrics::Time,
    /// output rows
    pub output_rows: metrics::Count,
    /// number of RecordBatches received from the remote node
    pub batches_received: metrics::Count,
    /// total in-memory bytes of RecordBatches received; registered as
    /// `MetricValue::OutputBytes` so DataFusion formats it with `human_readable_size`
    /// (e.g. "1.5 GB") rather than `human_readable_count` ("1.57 B" = billion)
    pub bytes_received: metrics::Count,
}

impl RemoteScanMetrics {
    pub fn new(input_partition: usize, metrics: &ExecutionPlanMetricsSet) -> Self {
        let fetch_time = MetricBuilder::new(metrics).subset_time("fetch_time", input_partition);
        let decode_time = MetricBuilder::new(metrics).subset_time(DECODE_TIME, input_partition);
        let output_rows = MetricBuilder::new(metrics).output_rows(input_partition);
        let batches_received =
            MetricBuilder::new(metrics).counter(BATCHES_RECEIVED, input_partition);

        // Register as OutputBytes so the display uses human_readable_size (KB/MB/GB)
        // instead of human_readable_count (K/M/B where B means billion).
        let bytes_received = metrics::Count::new();
        MetricBuilder::new(metrics)
            .with_partition(input_partition)
            .build(MetricValue::OutputBytes(bytes_received.clone()));

        Self {
            fetch_time,
            decode_time,
            output_rows,
            batches_received,
            bytes_received,
        }
    }

    /// Copies the counters a scan's `set` holds for `profile`'s partition into it.
    pub fn copy_to_profile(set: &MetricsSet, profile: &mut RemoteNodeProfile) {
        let partition = Some(profile.partition);
        let sum = |name: &str| {
            set.sum(|m| m.partition() == partition && m.value().name() == name)
                .map_or(0, |v| v.as_usize() as u64)
        };
        profile.output_rows = sum("output_rows");
        profile.output_batches = sum(BATCHES_RECEIVED);
        profile.output_bytes = sum("output_bytes");
        profile.decode_ns = sum(DECODE_TIME);
    }

    pub fn record_output(&self, batch: &RecordBatch) {
        self.output_rows.add(batch.num_rows());
        self.batches_received.add(1);
        self.bytes_received.add(batch.size());
    }

    /// Average fetch time per batch in milliseconds, or 0 if no batches received.
    pub fn avg_batch_time_ms(&self) -> u64 {
        let batches = self.batches_received.value();
        if batches == 0 {
            return 0;
        }
        // fetch_time.value() is total nanoseconds (usize)
        let total_ns = self.fetch_time.value() as u64;
        total_ns / batches as u64 / 1_000_000
    }
}

#[derive(Debug)]
pub enum FlightMessage {
    Schema(SchemaRef),
    RecordBatch(RecordBatch),
    CustomMessage(CustomMessage),
}

/// Custom message for ser/deserialize
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CustomMessage {
    ScanStats(ScanStats),
    Metrics(Vec<Metrics>),
    PeakMemory(usize),
    PartialErr(String),
}

/// What older nodes send after their last batch; a caller's profile comes from `do_action` now.
#[derive(Default, Debug, Serialize, Deserialize, Clone)]
pub struct Metrics {
    pub stage: i32,
    pub node_address: String,
    pub node_name: String,
    pub metrics: String,
}

/// What a node sends besides its record batches; the shared references are read when sent.
pub struct NodeMessages {
    /// This node's own scan stats, known before execution.
    pub scan_stats: ScanStats,
    /// The peak of this node's memory pool.
    pub peak_memory: Arc<AtomicUsize>,
    pub role: NodeRole,
}

impl NodeMessages {
    /// Sent before the first batch, so the caller sees scan stats and fast failures early.
    pub fn first(&self) -> Vec<CustomMessage> {
        let mut messages = vec![CustomMessage::ScanStats(self.reported_scan_stats())];
        messages.extend(self.partial_err());
        messages
    }

    /// Sent after the last batch.
    pub fn last(&self) -> Vec<CustomMessage> {
        let mut messages = vec![CustomMessage::PeakMemory(self.reported_peak_memory())];
        messages.extend(self.partial_err());
        messages
    }

    /// Merged here rather than sent twice: the caller's add gives the same result either way.
    fn reported_scan_stats(&self) -> ScanStats {
        let mut stats = self.scan_stats;
        if let NodeRole::ClusterLeader(remote) = &self.role {
            stats.add(&remote.scan_stats.lock());
        }
        stats
    }

    fn reported_peak_memory(&self) -> usize {
        let own = self.peak_memory.load(Ordering::Relaxed);
        match &self.role {
            NodeRole::Follower => own,
            NodeRole::ClusterLeader(remote) => own.max(remote.peak_memory.load(Ordering::Relaxed)),
        }
    }

    /// Only a cluster leader has one: a follower's own failure ends its stream instead.
    fn partial_err(&self) -> Option<CustomMessage> {
        let NodeRole::ClusterLeader(remote) = &self.role else {
            return None;
        };
        let err = remote.partial_err.lock().clone();
        (!err.is_empty()).then_some(CustomMessage::PartialErr(err))
    }
}

pub enum NodeRole {
    /// Scans the data itself.
    Follower,
    /// A super cluster's cluster leader, which passes the query on to its own followers.
    ClusterLeader(RemoteScanState),
}

/// Per-partition profiles of one remote scan, keyed by partition.
pub type NodeProfiles = Arc<Mutex<BTreeMap<usize, RemoteNodeProfile>>>;

/// What a remote scan collects from the nodes it calls, shared by every copy of the scan.
#[derive(Debug, Clone, Default)]
pub struct RemoteScanState {
    pub scan_stats: Arc<Mutex<ScanStats>>,
    pub peak_memory: Arc<AtomicUsize>,
    pub partial_err: Arc<Mutex<String>>,
    /// Filled only for EXPLAIN ANALYZE.
    pub node_profiles: NodeProfiles,
}

/// The id a node keys one run by: the query's trace id and the caller's job id for that call.
pub fn job_trace_id(trace_id: &str, job_id: &str) -> String {
    format!("{trace_id}-{job_id}")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::search::ScanStats;
    use parking_lot::Mutex;

    use super::*;

    fn create_test_scan_stats() -> ScanStats {
        ScanStats {
            files: 10,
            records: 1000,
            original_size: 2048,
            compressed_size: 1024,
            querier_files: 5,
            querier_memory_cached_files: 2,
            querier_disk_cached_files: 3,
            idx_scan_size: 512,
            idx_took: 100,
            file_list_took: 50,
            aggs_cache_ratio: 80,
            peak_memory_usage: 1024000,
            wait_in_queue: 0,
        }
    }

    #[test]
    fn test_metrics_default() {
        let metrics = Metrics::default();
        assert_eq!(metrics.stage, 0);
        assert_eq!(metrics.node_address, "");
        assert_eq!(metrics.node_name, "");
        assert_eq!(metrics.metrics, "");
    }

    fn describe(messages: Vec<CustomMessage>) -> Vec<String> {
        messages
            .into_iter()
            .map(|message| match message {
                CustomMessage::ScanStats(stats) => format!("ScanStats({})", stats.files),
                CustomMessage::PeakMemory(peak) => format!("PeakMemory({peak})"),
                CustomMessage::PartialErr(err) => format!("PartialErr({err})"),
                CustomMessage::Metrics(metrics) => format!("Metrics({})", metrics.len()),
            })
            .collect()
    }

    #[test]
    fn test_follower_sends_only_its_own_values() {
        let messages = NodeMessages {
            scan_stats: create_test_scan_stats(),
            peak_memory: Arc::new(AtomicUsize::new(5)),
            role: NodeRole::Follower,
        };
        assert_eq!(describe(messages.first()), ["ScanStats(10)"]);
        assert_eq!(describe(messages.last()), ["PeakMemory(5)"]);
    }

    #[test]
    fn test_cluster_leader_merges_what_its_remote_scan_collected() {
        let remote = RemoteScanState {
            scan_stats: Arc::new(Mutex::new(ScanStats {
                files: 3,
                ..Default::default()
            })),
            peak_memory: Arc::new(AtomicUsize::new(7)),
            ..Default::default()
        };
        let partial_err = remote.partial_err.clone();
        let messages = NodeMessages {
            scan_stats: create_test_scan_stats(),
            peak_memory: Arc::new(AtomicUsize::new(5)),
            role: NodeRole::ClusterLeader(remote),
        };
        assert_eq!(describe(messages.first()), ["ScanStats(13)"]);

        *partial_err.lock() = "node down".to_string();
        assert_eq!(
            describe(messages.first()),
            ["ScanStats(13)", "PartialErr(node down)"]
        );
        assert_eq!(
            describe(messages.last()),
            ["PeakMemory(7)", "PartialErr(node down)"]
        );
    }

    #[test]
    fn test_custom_message_serialization() {
        let scan_stats = create_test_scan_stats();
        let custom_msg = CustomMessage::ScanStats(scan_stats);

        let serialized = serde_json::to_string(&custom_msg).unwrap();
        let deserialized: CustomMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 10);
                assert_eq!(stats.records, 1000);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_metrics_serialization() {
        let metrics = vec![Metrics {
            stage: 1,
            node_address: "test_node".to_string(),
            node_name: "Test Node".to_string(),
            metrics: "test_metrics".to_string(),
        }];
        let custom_msg = CustomMessage::Metrics(metrics);

        let serialized = serde_json::to_string(&custom_msg).unwrap();
        let deserialized: CustomMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            CustomMessage::Metrics(metrics) => {
                assert_eq!(metrics.len(), 1);
                assert_eq!(metrics[0].stage, 1);
                assert_eq!(metrics[0].node_address, "test_node");
                assert_eq!(metrics[0].node_name, "Test Node");
                assert_eq!(metrics[0].metrics, "test_metrics");
            }
            _ => panic!("Expected Metrics variant"),
        }
    }

    #[test]
    fn test_custom_message_peak_memory_serialization() {
        let peak_memory = 1024 * 1024 * 100; // 100 MB
        let custom_msg = CustomMessage::PeakMemory(peak_memory);

        let serialized = serde_json::to_string(&custom_msg).unwrap();
        let deserialized: CustomMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            CustomMessage::PeakMemory(mem) => {
                assert_eq!(mem, peak_memory);
            }
            _ => panic!("Expected PeakMemory variant"),
        }
    }
}

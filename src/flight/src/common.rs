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

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::{
    cluster::LOCAL_NODE,
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::record_batch_ext::RecordBatchExt,
};
use datafusion::{
    self,
    physical_plan::{
        ExecutionPlan,
        metrics::{self, ExecutionPlanMetricsSet, MetricBuilder, MetricValue},
    },
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::profile::ProfileNode;

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
        let decode_time = MetricBuilder::new(metrics).subset_time("decode_time", input_partition);
        let output_rows = MetricBuilder::new(metrics).output_rows(input_partition);
        let batches_received =
            MetricBuilder::new(metrics).counter("batches_received", input_partition);

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

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
pub struct Metrics {
    /// Unused; kept, like `metrics`, so that older leaders can still parse the message.
    pub stage: i32,
    pub node_address: String,
    pub node_name: String,
    /// Left empty: the leader renders the text plan from `profile`.
    pub metrics: String,
    /// The plan this node ran; older nodes do not send it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<ProfileNode>,
}

/// A custom message for the flight stream; the shared references are read only when it is encoded.
pub enum PreCustomMessage {
    /// This node's own scan stats, known before execution.
    ScanStats(ScanStats),
    /// What a remote scan in this plan collects from the nodes it calls.
    ScanStatsRef(Arc<Mutex<ScanStats>>),
    /// The plan to send back as a profile for EXPLAIN ANALYZE.
    Metrics(MetricsInfo),
    /// The peak of this node's memory pool, or of the nodes a remote scan in this plan calls.
    PeakMemoryRef(Arc<AtomicUsize>),
    /// Errors of the remote scan's calls, sent before the first batch so fast failures show early.
    PartialErrRefEarly(Arc<Mutex<String>>),
    /// The same errors, sent again after the last batch.
    PartialErrRef(Arc<Mutex<String>>),
}

pub struct MetricsInfo {
    pub plan: Arc<dyn ExecutionPlan>,
    /// Passed in because it lives in the search crate, which depends on this one.
    pub build_profile: fn(&dyn ExecutionPlan) -> ProfileNode,
}

impl PreCustomMessage {
    pub fn is_early_emit(&self) -> bool {
        matches!(
            self,
            PreCustomMessage::ScanStats(_)
                | PreCustomMessage::ScanStatsRef(_)
                | PreCustomMessage::PartialErrRefEarly(_)
        )
    }

    pub fn get_custom_message(&self) -> Option<CustomMessage> {
        match self {
            PreCustomMessage::ScanStats(stats) => Some(CustomMessage::ScanStats(*stats)),
            PreCustomMessage::ScanStatsRef(stats) => Some(CustomMessage::ScanStats(*stats.lock())),
            PreCustomMessage::Metrics(info) => Some(CustomMessage::Metrics(collect_metrics(info))),
            PreCustomMessage::PeakMemoryRef(peak) => {
                Some(CustomMessage::PeakMemory(peak.load(Ordering::Relaxed)))
            }
            PreCustomMessage::PartialErrRefEarly(err) | PreCustomMessage::PartialErrRef(err) => {
                let err = err.lock().clone();
                (!err.is_empty()).then_some(CustomMessage::PartialErr(err))
            }
        }
    }
}

// collect metrics from physical plan
fn collect_metrics(metrics_info: &MetricsInfo) -> Vec<Metrics> {
    vec![Metrics {
        node_address: LOCAL_NODE.get_grpc_addr().to_string(),
        node_name: LOCAL_NODE.get_name().to_string(),
        profile: Some((metrics_info.build_profile)(metrics_info.plan.as_ref())),
        ..Default::default()
    }]
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;
    use datafusion::physical_plan::{ExecutionPlan, empty::EmptyExec};
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

    fn test_profile(plan: &dyn ExecutionPlan) -> ProfileNode {
        ProfileNode {
            name: plan.name().to_string(),
            ..Default::default()
        }
    }

    fn create_test_execution_plan() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int32, false)]));
        Arc::new(EmptyExec::new(schema))
    }

    #[test]
    fn test_metrics_default() {
        let metrics = Metrics::default();
        assert_eq!(metrics.stage, 0);
        assert_eq!(metrics.node_address, "");
        assert_eq!(metrics.node_name, "");
        assert_eq!(metrics.metrics, "");
    }

    #[test]
    fn test_pre_custom_message_is_early_emit() {
        let scan_stats = create_test_scan_stats();

        // Test ScanStats variant
        let pre_msg = PreCustomMessage::ScanStats(scan_stats);
        assert!(pre_msg.is_early_emit());

        // Test ScanStatsRef variant
        let stats_ref = Arc::new(Mutex::new(scan_stats));
        let pre_msg = PreCustomMessage::ScanStatsRef(stats_ref);
        assert!(pre_msg.is_early_emit());

        // Test Metrics variant (should be false)
        let pre_msg = PreCustomMessage::Metrics(MetricsInfo {
            plan: create_test_execution_plan(),
            build_profile: test_profile,
        });
        assert!(!pre_msg.is_early_emit());
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_scan_stats() {
        let scan_stats = create_test_scan_stats();

        let pre_msg = PreCustomMessage::ScanStats(scan_stats);
        let custom_msg = pre_msg.get_custom_message().unwrap();

        match custom_msg {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 10);
                assert_eq!(stats.records, 1000);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_scan_stats_ref() {
        let scan_stats = create_test_scan_stats();
        let stats_ref = Arc::new(Mutex::new(scan_stats));

        let pre_msg = PreCustomMessage::ScanStatsRef(stats_ref);
        let custom_msg = pre_msg.get_custom_message().unwrap();

        match custom_msg {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 10);
                assert_eq!(stats.records, 1000);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_metrics() {
        let plan = create_test_execution_plan();
        let metrics_info = MetricsInfo {
            plan,
            build_profile: test_profile,
        };

        let pre_msg = PreCustomMessage::Metrics(metrics_info);
        let custom_msg = pre_msg.get_custom_message().unwrap();

        match custom_msg {
            CustomMessage::Metrics(metrics) => {
                assert_eq!(metrics.len(), 1);
                assert!(!metrics[0].node_address.is_empty());
                assert!(!metrics[0].node_name.is_empty());
                assert_eq!(metrics[0].profile.as_ref().unwrap().name, "EmptyExec");
            }
            _ => panic!("Expected Metrics variant"),
        }
    }

    #[test]
    fn test_pre_custom_message_skips_empty_partial_err() {
        let err = Arc::new(Mutex::new(String::new()));
        assert!(
            PreCustomMessage::PartialErrRef(err.clone())
                .get_custom_message()
                .is_none()
        );

        *err.lock() = "node down".to_string();
        match PreCustomMessage::PartialErrRefEarly(err).get_custom_message() {
            Some(CustomMessage::PartialErr(err)) => assert_eq!(err, "node down"),
            _ => panic!("Expected PartialErr variant"),
        }
    }

    #[test]
    fn test_metrics_without_profile_deserializes() {
        let json = r#"{"stage":1,"node_address":"a","node_name":"b","metrics":"m"}"#;
        let metrics: Metrics = serde_json::from_str(json).unwrap();
        assert!(metrics.profile.is_none());
    }

    #[test]
    fn test_metrics_keeps_fields_older_leaders_require() {
        let metrics = Metrics {
            profile: Some(ProfileNode::default()),
            ..Default::default()
        };
        let json = serde_json::to_value(&metrics).unwrap();
        for key in ["stage", "node_address", "node_name", "metrics"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
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
            profile: None,
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

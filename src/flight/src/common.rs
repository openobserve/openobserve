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

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::{
    cluster::LOCAL_NODE,
    meta::{cluster::NodeInfo, search::ScanStats},
};
use datafusion::{
    self,
    physical_plan::{
        ExecutionPlan,
        display::DisplayableExecutionPlan,
        metrics::{self, ExecutionPlanMetricsSet, MetricBuilder},
    },
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct RemoteScanMetrics {
    /// Time in nanos to execute child operator and fetch batches
    pub fetch_time: metrics::Time,
    /// Time in nanos to perform decoding
    pub decode_time: metrics::Time,
    /// output rows
    pub output_rows: metrics::Count,
}

impl RemoteScanMetrics {
    pub fn new(input_partition: usize, metrics: &ExecutionPlanMetricsSet) -> Self {
        // Time in nanos to execute child operator and fetch batches
        let fetch_time = MetricBuilder::new(metrics).subset_time("fetch_time", input_partition);

        // Time in nanos to perform decoding
        let decode_time = MetricBuilder::new(metrics).subset_time("decode_time", input_partition);

        // Output rows
        let output_rows = MetricBuilder::new(metrics).output_rows(input_partition);

        Self {
            fetch_time,
            decode_time,
            output_rows,
        }
    }

    pub fn record_output(&self, n: usize) {
        self.output_rows.add(n);
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
}

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
pub struct Metrics {
    pub stage: i32,
    pub node_address: String,
    pub node_name: String,
    pub metrics: String,
}

/// the CustomMessage is not ready, so we need to use this struct to store
/// the scan stats, and send it to the client when the scan stats is ready
pub enum PreCustomMessage {
    ScanStats(ScanStats),
    // use for super cluster follower leader
    ScanStatsRef(Option<Arc<Mutex<ScanStats>>>),
    // physical plan, is_super_cluster
    Metrics(Option<MetricsInfo>),
    // use for super cluster follower leader
    MetricsRef(Vec<Arc<Mutex<Vec<Metrics>>>>),
    // use for storing memory pool reference to extract peak later
    PeakMemoryRef(Option<Arc<AtomicUsize>>),
}

pub struct MetricsInfo {
    pub plan: Arc<dyn ExecutionPlan>,
    pub is_super_cluster: bool,
    pub func: Box<dyn Fn() -> bool + Send>,
}

impl PreCustomMessage {
    pub fn is_scan_stats(&self) -> bool {
        matches!(
            self,
            PreCustomMessage::ScanStats(_) | PreCustomMessage::ScanStatsRef(_)
        )
    }

    pub fn get_custom_message(&self) -> Option<CustomMessage> {
        match self {
            PreCustomMessage::ScanStats(stats) => Some(CustomMessage::ScanStats(*stats)),
            PreCustomMessage::ScanStatsRef(stats_ref) => stats_ref
                .as_ref()
                .map(|stats| CustomMessage::ScanStats(*stats.lock())),
            PreCustomMessage::Metrics(metrics_ref) => metrics_ref
                .as_ref()
                .map(|metrics_info| CustomMessage::Metrics(collect_metrics(metrics_info))),
            PreCustomMessage::MetricsRef(metrics) => {
                let metrics: Vec<Metrics> = metrics.iter().flat_map(|m| m.lock().clone()).collect();
                (!metrics.is_empty()).then_some(CustomMessage::Metrics(metrics))
            }
            PreCustomMessage::PeakMemoryRef(peak_memory_ref) => peak_memory_ref
                .as_ref()
                .map(|peak| CustomMessage::PeakMemory(peak.load(Ordering::Relaxed))),
        }
    }
}

// collect metrics from physical plan
fn collect_metrics(metrics_info: &MetricsInfo) -> Vec<Metrics> {
    let plan = &metrics_info.plan;
    let is_super_cluster = metrics_info.is_super_cluster;
    let func = &metrics_info.func;
    let plan_with_metrics = DisplayableExecutionPlan::with_metrics(plan.as_ref())
        .set_show_statistics(false)
        .indent(true)
        .to_string();
    let stage = if func() {
        if is_super_cluster { 1 } else { 2 }
    } else {
        1
    };
    vec![Metrics {
        stage,
        node_address: LOCAL_NODE.get_grpc_addr().to_string(),
        node_name: LOCAL_NODE.get_name().to_string(),
        metrics: plan_with_metrics,
    }]
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;
    use datafusion::physical_plan::empty::EmptyExec;
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
    fn test_pre_custom_message_is_scan_stats() {
        let scan_stats = create_test_scan_stats();

        // Test ScanStats variant
        let pre_msg = PreCustomMessage::ScanStats(scan_stats);
        assert!(pre_msg.is_scan_stats());

        // Test ScanStatsRef variant with Some
        let stats_ref = Arc::new(Mutex::new(scan_stats));
        let pre_msg = PreCustomMessage::ScanStatsRef(Some(stats_ref));
        assert!(pre_msg.is_scan_stats());

        // Test ScanStatsRef variant with None
        let pre_msg = PreCustomMessage::ScanStatsRef(None);
        assert!(pre_msg.is_scan_stats());

        // Test Metrics variant (should be false)
        let pre_msg = PreCustomMessage::Metrics(None);
        assert!(!pre_msg.is_scan_stats());

        // Test MetricsRef variant (should be false)
        let pre_msg = PreCustomMessage::MetricsRef(vec![]);
        assert!(!pre_msg.is_scan_stats());
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

        let pre_msg = PreCustomMessage::ScanStatsRef(Some(stats_ref));
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
    fn test_pre_custom_message_get_custom_message_scan_stats_ref_none() {
        let pre_msg = PreCustomMessage::ScanStatsRef(None);
        let custom_msg = pre_msg.get_custom_message();
        assert!(custom_msg.is_none());
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_metrics() {
        let plan = create_test_execution_plan();
        let metrics_info = MetricsInfo {
            plan,
            is_super_cluster: false,
            func: Box::new(|| true),
        };

        let pre_msg = PreCustomMessage::Metrics(Some(metrics_info));
        let custom_msg = pre_msg.get_custom_message().unwrap();

        match custom_msg {
            CustomMessage::Metrics(metrics) => {
                assert_eq!(metrics.len(), 1);
                assert_eq!(metrics[0].stage, 2); // func() returns true, is_super_cluster is false
                assert!(!metrics[0].node_address.is_empty());
                assert!(!metrics[0].node_name.is_empty());
                assert!(!metrics[0].metrics.is_empty());
            }
            _ => panic!("Expected Metrics variant"),
        }
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_metrics_none() {
        let pre_msg = PreCustomMessage::Metrics(None);
        let custom_msg = pre_msg.get_custom_message();
        assert!(custom_msg.is_none());
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_metrics_ref() {
        let metrics1 = vec![Metrics {
            stage: 1,
            node_address: "node1".to_string(),
            node_name: "Node 1".to_string(),
            metrics: "metrics1".to_string(),
        }];
        let metrics2 = vec![Metrics {
            stage: 2,
            node_address: "node2".to_string(),
            node_name: "Node 2".to_string(),
            metrics: "metrics2".to_string(),
        }];

        let metrics_refs = vec![
            Arc::new(Mutex::new(metrics1)),
            Arc::new(Mutex::new(metrics2)),
        ];

        let pre_msg = PreCustomMessage::MetricsRef(metrics_refs);
        let custom_msg = pre_msg.get_custom_message().unwrap();

        match custom_msg {
            CustomMessage::Metrics(metrics) => {
                assert_eq!(metrics.len(), 2);
                assert_eq!(metrics[0].node_address, "node1");
                assert_eq!(metrics[1].node_address, "node2");
            }
            _ => panic!("Expected Metrics variant"),
        }
    }

    #[test]
    fn test_pre_custom_message_get_custom_message_metrics_ref_empty() {
        let metrics_refs = vec![Arc::new(Mutex::new(vec![]))];

        let pre_msg = PreCustomMessage::MetricsRef(metrics_refs);
        let custom_msg = pre_msg.get_custom_message();
        assert!(custom_msg.is_none());
    }

    #[test]
    fn test_collect_metrics_super_cluster_true() {
        let plan = create_test_execution_plan();
        let metrics_info = MetricsInfo {
            plan,
            is_super_cluster: true,
            func: Box::new(|| true),
        };

        let metrics = collect_metrics(&metrics_info);
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].stage, 1); // func() returns true, is_super_cluster is true
        assert!(!metrics[0].node_address.is_empty());
        assert!(!metrics[0].metrics.is_empty());
    }

    #[test]
    fn test_collect_metrics_super_cluster_false() {
        let plan = create_test_execution_plan();
        let metrics_info = MetricsInfo {
            plan,
            is_super_cluster: false,
            func: Box::new(|| true),
        };

        let metrics = collect_metrics(&metrics_info);
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].stage, 2); // func() returns true, is_super_cluster is false
    }

    #[test]
    fn test_collect_metrics_func_returns_false() {
        let plan = create_test_execution_plan();
        let metrics_info = MetricsInfo {
            plan,
            is_super_cluster: true,
            func: Box::new(|| false),
        };

        let metrics = collect_metrics(&metrics_info);
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].stage, 1); // func() returns false, stage defaults to 1
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

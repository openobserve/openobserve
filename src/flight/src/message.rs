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

//! What nodes send each other over Flight besides record batches; changing it changes the protocol.

use config::meta::search::ScanStats;
use serde::{Deserialize, Serialize};

use crate::profile::ProfileNode;

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

#[cfg(test)]
mod tests {
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

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
use utoipa::ToSchema;

/// Service Graph topology snapshot record
/// Stored in ServiceGraph stream for historical queries
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ServiceGraphSnapshot {
    /// Snapshot timestamp (microseconds since epoch)
    #[serde(rename = "_timestamp")]
    pub timestamp: i64,

    /// Organization identifier
    pub org_id: String,

    /// Source trace stream name
    pub trace_stream_name: String,

    /// Client service name (initiator); None for entry-point services
    pub client_service: Option<String>,

    /// Server service name (receiver)
    pub server_service: String,

    /// Total requests (cumulative counter)
    pub total_requests: u64,

    /// Failed requests (cumulative counter)
    pub failed_requests: u64,

    /// Error rate percentage (0-100)
    pub error_rate: f64,

    /// P50 latency in nanoseconds
    pub p50_latency_ns: u64,

    /// P95 latency in nanoseconds
    pub p95_latency_ns: u64,

    /// P99 latency in nanoseconds
    pub p99_latency_ns: u64,

    /// First time this edge was seen (microseconds)
    pub first_seen: i64,

    /// Last time this edge was seen (microseconds)
    pub last_seen: i64,

    /// Snapshot version (monotonic counter for deduplication)
    pub snapshot_version: u64,
}

impl ServiceGraphSnapshot {
    /// Convert to JSON value for stream ingestion
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("Failed to serialize ServiceGraphSnapshot")
    }
}

/// Graph format for frontend visualization
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ServiceGraphData {
    pub nodes: Vec<ServiceNode>,
    pub edges: Vec<ServiceEdge>,
}

/// Node in service graph
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ServiceNode {
    pub id: String,
    pub label: String,
    pub requests: u64,
    pub errors: u64,
    pub error_rate: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
}

/// Edge in service graph
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ServiceEdge {
    /// Source service; None for entry-point services
    pub from: Option<String>,
    pub to: String,
    pub total_requests: u64,
    pub failed_requests: u64,
    pub error_rate: f64,
    pub p50_latency_ns: u64,
    pub p95_latency_ns: u64,
    pub p99_latency_ns: u64,
    /// Baseline Pxx from the previous time slot (same duration, one slot older).
    /// None when this edge had no data in the previous slot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_p50_latency_ns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_p95_latency_ns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_p99_latency_ns: Option<u64>,
}

/// One time-series data point in an edge latency trend
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct EdgeTrendDataPoint {
    pub timestamp: i64,
    pub p50_latency_ns: u64,
    pub p95_latency_ns: u64,
    pub p99_latency_ns: u64,
    pub total_requests: u64,
    pub failed_requests: u64,
}

/// Response for the edge latency history endpoint.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct EdgeTrendResponse {
    pub data_points: Vec<EdgeTrendDataPoint>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_snapshot() -> ServiceGraphSnapshot {
        ServiceGraphSnapshot {
            timestamp: 1_000_000,
            org_id: "default".to_string(),
            trace_stream_name: "traces".to_string(),
            client_service: Some("frontend".to_string()),
            server_service: "backend".to_string(),
            total_requests: 100,
            failed_requests: 5,
            error_rate: 5.0,
            p50_latency_ns: 1_000_000,
            p95_latency_ns: 5_000_000,
            p99_latency_ns: 10_000_000,
            first_seen: 900_000,
            last_seen: 1_100_000,
            snapshot_version: 1,
        }
    }

    #[test]
    fn test_to_json_includes_all_fields() {
        let snap = make_snapshot();
        let val = snap.to_json();
        assert_eq!(val["_timestamp"], 1_000_000_i64);
        assert_eq!(val["org_id"], "default");
        assert_eq!(val["server_service"], "backend");
        assert_eq!(val["total_requests"], 100_u64);
        assert_eq!(val["failed_requests"], 5_u64);
    }

    #[test]
    fn test_to_json_client_service_none_is_null() {
        let mut snap = make_snapshot();
        snap.client_service = None;
        let val = snap.to_json();
        assert!(val["client_service"].is_null());
    }

    #[test]
    fn test_to_json_roundtrip() {
        let snap = make_snapshot();
        let val = snap.to_json();
        let back: ServiceGraphSnapshot = serde_json::from_value(val).unwrap();
        assert_eq!(back.org_id, "default");
        assert_eq!(back.total_requests, 100);
        assert_eq!(back.snapshot_version, 1);
    }

    #[test]
    fn test_service_edge_baseline_none_fields_omitted_from_json() {
        let edge = ServiceEdge {
            from: Some("svc_a".to_string()),
            to: "svc_b".to_string(),
            total_requests: 10,
            failed_requests: 1,
            error_rate: 10.0,
            p50_latency_ns: 100,
            p95_latency_ns: 500,
            p99_latency_ns: 900,
            baseline_p50_latency_ns: None,
            baseline_p95_latency_ns: None,
            baseline_p99_latency_ns: None,
        };
        let val = serde_json::to_value(&edge).unwrap();
        // skip_serializing_if = "Option::is_none" → absent from JSON when None
        assert!(val.get("baseline_p50_latency_ns").is_none());
        assert!(val.get("baseline_p95_latency_ns").is_none());
        assert!(val.get("baseline_p99_latency_ns").is_none());
        assert_eq!(val["from"], "svc_a");
    }

    #[test]
    fn test_service_edge_baseline_some_fields_present_in_json() {
        let edge = ServiceEdge {
            from: None,
            to: "svc_b".to_string(),
            total_requests: 5,
            failed_requests: 0,
            error_rate: 0.0,
            p50_latency_ns: 50,
            p95_latency_ns: 200,
            p99_latency_ns: 400,
            baseline_p50_latency_ns: Some(40),
            baseline_p95_latency_ns: Some(180),
            baseline_p99_latency_ns: Some(350),
        };
        let val = serde_json::to_value(&edge).unwrap();
        assert_eq!(val["baseline_p50_latency_ns"], 40_u64);
        assert_eq!(val["baseline_p95_latency_ns"], 180_u64);
        assert_eq!(val["baseline_p99_latency_ns"], 350_u64);
        // from = None → serialized as null
        assert!(val["from"].is_null());
    }

    #[test]
    fn test_service_node_stream_name_none_omitted() {
        let node = ServiceNode {
            id: "svc".to_string(),
            label: "Service".to_string(),
            requests: 100,
            errors: 2,
            error_rate: 2.0,
            stream_name: None,
        };
        let val = serde_json::to_value(&node).unwrap();
        // skip_serializing_if = "Option::is_none" → absent when None
        assert!(val.get("stream_name").is_none());
    }

    #[test]
    fn test_service_node_stream_name_some_present() {
        let node = ServiceNode {
            id: "svc".to_string(),
            label: "Service".to_string(),
            requests: 100,
            errors: 2,
            error_rate: 2.0,
            stream_name: Some("my_stream".to_string()),
        };
        let val = serde_json::to_value(&node).unwrap();
        assert_eq!(val["stream_name"], "my_stream");
    }

    #[test]
    fn test_edge_trend_data_point_serialization() {
        let pt = EdgeTrendDataPoint {
            timestamp: 1_000_000,
            p50_latency_ns: 100,
            p95_latency_ns: 500,
            p99_latency_ns: 900,
            total_requests: 50,
            failed_requests: 2,
        };
        let val = serde_json::to_value(&pt).unwrap();
        assert_eq!(val["timestamp"], 1_000_000_i64);
        assert_eq!(val["p50_latency_ns"], 100_u64);
        assert_eq!(val["total_requests"], 50_u64);
        assert_eq!(val["failed_requests"], 2_u64);
    }

    #[test]
    fn test_edge_trend_data_point_roundtrip() {
        let pt = EdgeTrendDataPoint {
            timestamp: 42,
            p50_latency_ns: 1,
            p95_latency_ns: 2,
            p99_latency_ns: 3,
            total_requests: 10,
            failed_requests: 0,
        };
        let json = serde_json::to_string(&pt).unwrap();
        let back: EdgeTrendDataPoint = serde_json::from_str(&json).unwrap();
        assert_eq!(back.timestamp, 42);
        assert_eq!(back.p99_latency_ns, 3);
        assert_eq!(back.failed_requests, 0);
    }

    #[test]
    fn test_edge_trend_response_empty() {
        let resp = EdgeTrendResponse {
            data_points: Vec::new(),
        };
        let val = serde_json::to_value(&resp).unwrap();
        assert!(val["data_points"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_edge_trend_response_with_points() {
        let pt = EdgeTrendDataPoint {
            timestamp: 1,
            p50_latency_ns: 10,
            p95_latency_ns: 20,
            p99_latency_ns: 30,
            total_requests: 5,
            failed_requests: 1,
        };
        let resp = EdgeTrendResponse {
            data_points: vec![pt],
        };
        let val = serde_json::to_value(&resp).unwrap();
        assert_eq!(val["data_points"].as_array().unwrap().len(), 1);
        assert_eq!(val["data_points"][0]["p50_latency_ns"], 10_u64);
    }

    #[test]
    fn test_service_graph_data_nodes_and_edges() {
        let node = ServiceNode {
            id: "n1".to_string(),
            label: "Node1".to_string(),
            requests: 10,
            errors: 0,
            error_rate: 0.0,
            stream_name: None,
        };
        let edge = ServiceEdge {
            from: None,
            to: "n1".to_string(),
            total_requests: 10,
            failed_requests: 0,
            error_rate: 0.0,
            p50_latency_ns: 100,
            p95_latency_ns: 200,
            p99_latency_ns: 300,
            baseline_p50_latency_ns: None,
            baseline_p95_latency_ns: None,
            baseline_p99_latency_ns: None,
        };
        let graph = ServiceGraphData {
            nodes: vec![node],
            edges: vec![edge],
        };
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.nodes[0].id, "n1");
        assert!(graph.edges[0].from.is_none());
    }
}

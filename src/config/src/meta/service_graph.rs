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

use std::collections::HashMap;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<TopologyMeta>,
}

/// Node in service graph
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ServiceNode {
    pub id: String,
    pub label: String,
    pub requests: u64,
    pub errors: u64,
    pub error_rate: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
    /// Inferred-service category ("database"/"queue"/"rpc"/"external") when this
    /// node is an uninstrumented dependency; `None` for instrumented services.
    /// The UI renders inferred nodes with a dotted style + type icon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_type: Option<String>,
    /// `service|database|queue|rpc|external|agent|tool|model`; empty on the v1 path.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p50_server_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p95_server_ns: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p99_server_ns: Option<u64>,
    /// Org-scope `requests_server - instrumented inbound`; signed, service nodes only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unattributed_inbound: Option<i64>,
    /// Agent nodes only: upper bound on the distinct instances seen in the range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instances: Option<u64>,
}

/// Which store the topology was read from plus the v4 job's progress and unresolved counts.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct TopologyMeta {
    /// "v1" | "v4"
    pub source: String,
    /// Seconds; max over the org's trace streams.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processed_up_to: Option<i64>,
    pub unresolved: UnresolvedCounts,
    /// Non-essential queries that failed and were read as empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub degraded: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct UnresolvedCounts {
    pub no_peer: u64,
    pub ip_only: u64,
    pub ambiguous: u64,
    pub cardinality: u64,
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
    /// Inferred-dependency category ("database"/"queue"/"rpc"/"external") when the
    /// target (`to`) is an uninstrumented dependency; `None` for instrumented
    /// service-to-service edges. Presence signals the UI to draw a dotted edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
}

/// One edge identity of the v4 metrics, summed over `trace_stream` and `agent_env`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MetricEdge {
    pub client: String,
    /// "" | user | queue | agent
    pub client_type: String,
    pub server: String,
    /// "" | database | queue | rpc | external | agent | tool | model
    pub connection_type: String,
    pub requests: f64,
    pub errors: f64,
    pub p50_ns: Option<u64>,
    pub p95_ns: Option<u64>,
    pub p99_ns: Option<u64>,
    /// trace_stream -> requests, sorted by stream.
    pub streams: Vec<(String, f64)>,
}

impl MetricEdge {
    pub fn identity(&self) -> EdgeIdentity {
        (
            self.client.clone(),
            self.client_type.clone(),
            self.server.clone(),
            self.connection_type.clone(),
        )
    }
}

/// One server of the server-side node histogram (services only), summed over `trace_stream`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MetricNode {
    pub server: String,
    pub requests_server: f64,
    pub p50_ns: Option<u64>,
    pub p95_ns: Option<u64>,
    pub p99_ns: Option<u64>,
    /// trace_stream -> requests_server, sorted by stream.
    pub streams: Vec<(String, f64)>,
}

/// (client, client_type, server, connection_type)
pub type EdgeIdentity = (String, String, String, String);

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TopologyInput {
    pub edges: Vec<MetricEdge>,
    pub nodes: Vec<MetricNode>,
    /// Previous same-length range, client side: identity -> (p50, p95, p99) ns.
    pub baselines: HashMap<EdgeIdentity, (u64, u64, u64)>,
    /// Org scope, never filtered by trace_stream: server -> sum of instrumented inbound requests.
    pub org_inbound: HashMap<String, f64>,
    /// Org scope: server -> requests_server.
    pub org_requests_server: HashMap<String, f64>,
    /// Agent name -> sum of `max_over_time(agent_instances)` over its series.
    pub instances: HashMap<String, f64>,
    /// False under an `agent_env` filter, where service-only nodes do not belong to the graph.
    pub node_only_services: bool,
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
            connection_type: None,
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
            connection_type: None,
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
            service_type: None,
            ..Default::default()
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
            service_type: None,
            ..Default::default()
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
            service_type: None,
            ..Default::default()
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
            connection_type: None,
        };
        let graph = ServiceGraphData {
            nodes: vec![node],
            edges: vec![edge],
            meta: None,
        };
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.nodes[0].id, "n1");
        assert!(graph.edges[0].from.is_none());
    }

    #[test]
    fn test_inferred_node_and_edge_type_serialization() {
        // Instrumented node/edge: type fields omitted from JSON.
        let node = ServiceNode {
            id: "checkout".to_string(),
            label: "checkout".to_string(),
            requests: 10,
            errors: 0,
            error_rate: 0.0,
            stream_name: None,
            service_type: None,
            ..Default::default()
        };
        let val = serde_json::to_value(&node).unwrap();
        assert!(val.get("service_type").is_none());

        // Inferred dependency node: service_type present for dotted rendering.
        let node = ServiceNode {
            id: "redis-master.prod".to_string(),
            label: "redis-master.prod".to_string(),
            requests: 10,
            errors: 0,
            error_rate: 0.0,
            stream_name: None,
            service_type: Some("database".to_string()),
            ..Default::default()
        };
        let val = serde_json::to_value(&node).unwrap();
        assert_eq!(val["service_type"], "database");

        // Inferred edge: connection_type present signals a dotted edge.
        let edge = ServiceEdge {
            from: Some("checkout".to_string()),
            to: "redis-master.prod".to_string(),
            total_requests: 10,
            failed_requests: 0,
            error_rate: 0.0,
            p50_latency_ns: 100,
            p95_latency_ns: 200,
            p99_latency_ns: 300,
            baseline_p50_latency_ns: None,
            baseline_p95_latency_ns: None,
            baseline_p99_latency_ns: None,
            connection_type: Some("database".to_string()),
        };
        let val = serde_json::to_value(&edge).unwrap();
        assert_eq!(val["connection_type"], "database");
        // Roundtrip back through Deserialize keeps the field.
        let back: ServiceEdge = serde_json::from_value(val).unwrap();
        assert_eq!(back.connection_type.as_deref(), Some("database"));
    }

    #[test]
    fn test_service_graph_data_meta_none_omitted() {
        let graph = ServiceGraphData {
            nodes: vec![],
            edges: vec![],
            meta: None,
        };
        let val = serde_json::to_value(&graph).unwrap();
        assert!(val.get("meta").is_none());
        let back: ServiceGraphData = serde_json::from_value(val).unwrap();
        assert!(back.meta.is_none());
    }

    #[test]
    fn test_service_graph_data_meta_some_present() {
        let graph = ServiceGraphData {
            nodes: vec![],
            edges: vec![],
            meta: Some(TopologyMeta {
                source: "v4".to_string(),
                processed_up_to: Some(1_700_000_000),
                unresolved: UnresolvedCounts {
                    no_peer: 1,
                    ip_only: 2,
                    ambiguous: 3,
                    cardinality: 4,
                },
                degraded: vec![],
            }),
        };
        let val = serde_json::to_value(&graph).unwrap();
        assert_eq!(val["meta"]["source"], "v4");
        assert!(val["meta"].get("degraded").is_none());
        assert_eq!(val["meta"]["processed_up_to"], 1_700_000_000_i64);
        assert_eq!(val["meta"]["unresolved"]["ip_only"], 2_u64);
        let v1 = TopologyMeta {
            source: "v1".to_string(),
            ..Default::default()
        };
        let val = serde_json::to_value(&v1).unwrap();
        assert!(val.get("processed_up_to").is_none());
        assert_eq!(val["unresolved"]["no_peer"], 0_u64);
    }

    #[test]
    fn test_service_node_kind_empty_omitted() {
        let node = ServiceNode {
            id: "svc".to_string(),
            label: "svc".to_string(),
            ..Default::default()
        };
        let val = serde_json::to_value(&node).unwrap();
        assert!(val.get("kind").is_none());
        assert!(val.get("p50_server_ns").is_none());
        assert!(val.get("unattributed_inbound").is_none());
        assert!(val.get("instances").is_none());

        let node = ServiceNode {
            kind: "service".to_string(),
            p50_server_ns: Some(10),
            p95_server_ns: Some(20),
            p99_server_ns: Some(30),
            unattributed_inbound: Some(-5),
            instances: Some(3),
            ..node
        };
        let val = serde_json::to_value(&node).unwrap();
        assert_eq!(val["instances"], 3_u64);
        assert_eq!(val["kind"], "service");
        assert_eq!(val["p99_server_ns"], 30_u64);
        assert_eq!(val["unattributed_inbound"], -5_i64);
    }

    #[test]
    fn test_metric_edge_identity_order() {
        let e = MetricEdge {
            client: "c".to_string(),
            client_type: "queue".to_string(),
            server: "s".to_string(),
            connection_type: "database".to_string(),
            ..Default::default()
        };
        assert_eq!(
            e.identity(),
            (
                "c".to_string(),
                "queue".to_string(),
                "s".to_string(),
                "database".to_string()
            )
        );
    }

    #[test]
    fn test_service_node_without_new_fields_deserializes() {
        let json = r#"{"id":"svc","label":"svc","requests":1,"errors":0,"error_rate":0.0}"#;
        let node: ServiceNode = serde_json::from_str(json).unwrap();
        assert_eq!(node.id, "svc");
        assert!(node.kind.is_empty());
        assert!(node.service_type.is_none());
        assert!(node.p50_server_ns.is_none());
        assert!(node.unattributed_inbound.is_none());
        assert!(node.instances.is_none());
    }
}

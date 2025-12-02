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

    /// Client service name (initiator)
    pub client_service: String,

    /// Server service name (receiver)
    pub server_service: String,

    /// Connection type: "standard", "database", "messaging", "virtual"
    pub connection_type: String,

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
}

/// Edge in service graph
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ServiceEdge {
    pub from: String,
    pub to: String,
    pub total_requests: u64,
    pub failed_requests: u64,
    pub error_rate: f64,
    pub p50_latency_ns: u64,
    pub p95_latency_ns: u64,
    pub p99_latency_ns: u64,
    pub connection_type: String,
}

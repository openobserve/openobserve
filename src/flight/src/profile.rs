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

//! Structured EXPLAIN ANALYZE profile: the executed plan with typed, per-node metrics.

use config::meta::search::ScanStats;
use serde::{Deserialize, Serialize};

/// The profile of one EXPLAIN ANALYZE run, as returned to the client.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryProfile {
    pub node_name: String,
    pub node_address: String,
    pub start_us: i64,
    pub end_us: i64,
    pub output_rows: usize,
    pub plan: ProfileNode,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileNode {
    pub name: String,
    pub detail: String,
    pub partitions: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metrics: Vec<ProfileMetric>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ProfileNode>,
    /// Only on a remote scan, which then has no children: one entry per remote node.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remote: Vec<RemoteNodeProfile>,
}

/// A metric summed across partitions.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProfileMetric {
    pub name: String,
    pub kind: MetricKind,
    pub value: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MetricKind {
    Count,
    /// Nanoseconds.
    Time,
    Bytes,
    Gauge,
    Ratio,
    Pruning,
    #[default]
    #[serde(other)]
    Other,
}

/// What the leader saw of one remote node, plus the plan that node ran.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RemoteNodeProfile {
    pub partition: usize,
    pub node_name: String,
    pub node_address: String,
    pub role: String,
    pub cluster: String,
    pub start_us: i64,
    pub end_us: i64,
    pub output_rows: u64,
    pub output_batches: u64,
    pub output_bytes: u64,
    pub decode_ns: u64,
    pub skipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_stats: Option<ScanStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<ProfileNode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile_json_round_trip_and_unknown_kind() {
        let node = ProfileNode {
            name: "FilterExec".to_string(),
            metrics: vec![ProfileMetric {
                name: "output_rows".to_string(),
                kind: MetricKind::Count,
                value: 1,
                total: None,
            }],
            ..Default::default()
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(!json.contains("children"));
        let back: ProfileNode = serde_json::from_str(&json).unwrap();
        assert_eq!(back.metrics, node.metrics);
        let m: ProfileMetric =
            serde_json::from_str(r#"{"name":"x","kind":"future_kind","value":1}"#).unwrap();
        assert_eq!(m.kind, MetricKind::Other);
    }
}

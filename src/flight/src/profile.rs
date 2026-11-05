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
//!
//! The profile is a tree that follows the leader's physical plan. Ordinary operators
//! recurse through `ProfileInputs::Children`. A `RemoteScanExec` stops the recursion
//! with `ProfileInputs::Remote` instead, because the subtree under it on the leader is
//! only the plan template sent to the remote nodes and never ran there. That list
//! holds one `RemoteNodeProfile` per node it called directly (one per partition),
//! including nodes skipped because they had no files.
//!
//! A `RemoteNodeProfile` has two parts:
//! - what the caller observed of that node: start and end time, rows, batches and bytes received
//!   over Flight, decode time, and the node's scan stats;
//! - `plan`: the plan the node actually ran, with its own metrics, sent back by the node itself.
//!
//! A caller lists only the nodes it called directly; deeper nodes nest inside
//! `plan`. In a super cluster the cluster leader's plan has its own
//! `RemoteScanExec`, whose `remote` lists that cluster's queriers and ingesters:
//!
//! ```text
//! QueryProfile                                  super leader
//! └─ plan … RemoteScanExec
//!    └─ remote: [sc-a, sc-b, sc-c]              cluster leaders
//!       └─ plan … RemoteScanExec
//!          └─ remote: [querier-0 … ingester-1]  nodes of that cluster
//!             └─ plan …
//! ```
//!
//! A plan with several remote scans, such as a join of two streams, has one
//! `remote` list per scan, so the same node appears once under each of them.
//!
//! Each plan appears exactly once: a node sends back only its own plan, and its
//! caller stores it under the remote scan that made the call.
//!
//! The leader also renders the text rows of EXPLAIN ANALYZE from this tree, one per
//! node that sent back its plan, which is why `ProfileMetric::display` keeps each
//! value exactly as DataFusion prints it.

use std::fmt::Write;

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
    #[serde(flatten)]
    pub inputs: ProfileInputs,
}

impl ProfileNode {
    /// Renders the EXPLAIN ANALYZE text of the plan this node heads, stopping at remote scans.
    pub fn to_text(&self) -> String {
        let mut out = String::new();
        self.write_text(&mut out, 0);
        out
    }

    fn write_text(&self, out: &mut String, indent: usize) {
        let metrics = self
            .metrics
            .iter()
            .map(|m| format!("{}={}", m.name, m.display))
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(
            out,
            "{:indent$}{}, metrics=[{metrics}]",
            "",
            self.detail,
            indent = indent * 2
        )
        .expect("write to String");
        if let ProfileInputs::Children(children) = &self.inputs {
            for child in children {
                child.write_text(out, indent + 1);
            }
        }
    }
}

/// Where a node's input came from; serialized as a `children` or a `remote` key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileInputs {
    /// Operators that ran on this node; empty for a leaf.
    Children(Vec<ProfileNode>),
    /// Only on a remote scan: one entry per node it called directly.
    Remote(Vec<RemoteNodeProfile>),
}

impl Default for ProfileInputs {
    fn default() -> Self {
        Self::Children(Vec::new())
    }
}

/// A metric summed across partitions.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProfileMetric {
    pub name: String,
    pub kind: MetricKind,
    pub value: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    /// The value as DataFusion prints it, such as `1.20 MB` or `100 total → 20 matched`.
    #[serde(default)]
    pub display: String,
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

/// What the caller saw of one remote node, plus the plan that node ran.
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
    /// The plan this node ran; its own remote scans nest the nodes below it the same way.
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
                display: "1".to_string(),
            }],
            ..Default::default()
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""children":[]"#) && !json.contains("remote"));
        let back: ProfileNode = serde_json::from_str(&json).unwrap();
        assert_eq!(back.metrics, node.metrics);
        assert!(matches!(back.inputs, ProfileInputs::Children(c) if c.is_empty()));
        let m: ProfileMetric =
            serde_json::from_str(r#"{"name":"x","kind":"future_kind","value":1}"#).unwrap();
        assert_eq!(m.kind, MetricKind::Other);
    }

    #[test]
    fn test_remote_inputs_serialize_under_remote_key() {
        let node = ProfileNode {
            name: "RemoteScanExec".to_string(),
            inputs: ProfileInputs::Remote(vec![RemoteNodeProfile {
                node_name: "q-0".to_string(),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""remote":[{"#) && !json.contains("children"));
        let back: ProfileNode = serde_json::from_str(&json).unwrap();
        let ProfileInputs::Remote(remote) = back.inputs else {
            panic!("expected remote inputs");
        };
        assert_eq!(remote[0].node_name, "q-0");
    }

    #[test]
    fn test_to_text_indents_children_and_stops_at_remote() {
        let metric = |name: &str, display: &str| ProfileMetric {
            name: name.to_string(),
            display: display.to_string(),
            ..Default::default()
        };
        let node = ProfileNode {
            detail: "SortExec: expr=[a@0 ASC]".to_string(),
            metrics: vec![metric("output_rows", "3"), metric("spilled_bytes", "0.0 B")],
            inputs: ProfileInputs::Children(vec![ProfileNode {
                detail: "RemoteScanExec: partitions=2".to_string(),
                inputs: ProfileInputs::Remote(vec![RemoteNodeProfile {
                    plan: Some(ProfileNode {
                        detail: "FilterExec".to_string(),
                        ..Default::default()
                    }),
                    ..Default::default()
                }]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        assert_eq!(
            node.to_text(),
            "SortExec: expr=[a@0 ASC], metrics=[output_rows=3, spilled_bytes=0.0 B]\n  RemoteScanExec: partitions=2, metrics=[]\n"
        );
    }
}

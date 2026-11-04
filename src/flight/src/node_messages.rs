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

//! What a node sends back to its caller besides record batches, and when.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use config::{
    cluster::LOCAL_NODE,
    meta::{cluster::NodeInfo, search::ScanStats},
};
use datafusion::physical_plan::ExecutionPlan;

use crate::{
    message::{CustomMessage, Metrics},
    profile::ProfileNode,
    remote_scan::RemoteScanState,
};

/// What a node sends besides its record batches; the shared references are read when sent.
pub struct NodeMessages {
    /// This node's own scan stats, known before execution.
    pub scan_stats: ScanStats,
    /// The peak of this node's memory pool.
    pub peak_memory: Arc<AtomicUsize>,
    /// The plan to send back as a profile; set only for EXPLAIN ANALYZE.
    pub profile: Option<MetricsInfo>,
    pub role: NodeRole,
}

impl NodeMessages {
    /// Sent before the first batch, so the caller sees scan stats and fast failures early.
    pub fn first(&self) -> Vec<CustomMessage> {
        let mut messages = vec![CustomMessage::ScanStats(self.scan_stats)];
        if let NodeRole::ClusterLeader(remote) = &self.role {
            messages.push(CustomMessage::ScanStats(*remote.scan_stats.lock()));
            messages.extend(partial_err(remote));
        }
        messages
    }

    /// Sent after the last batch.
    pub fn last(&self) -> Vec<CustomMessage> {
        let mut messages = vec![CustomMessage::PeakMemory(
            self.peak_memory.load(Ordering::Relaxed),
        )];
        if let NodeRole::ClusterLeader(remote) = &self.role {
            messages.push(CustomMessage::PeakMemory(
                remote.peak_memory.load(Ordering::Relaxed),
            ));
            messages.extend(partial_err(remote));
        }
        if let Some(info) = &self.profile {
            messages.push(CustomMessage::Metrics(collect_metrics(info)));
        }
        messages
    }
}

pub enum NodeRole {
    /// Scans the data itself.
    Follower,
    /// A super cluster's cluster leader, which passes the query on to its own followers.
    ClusterLeader(RemoteScanState),
}

pub struct MetricsInfo {
    pub plan: Arc<dyn ExecutionPlan>,
    /// Passed in because it lives in the search crate, which depends on this one.
    pub build_profile: fn(&dyn ExecutionPlan) -> ProfileNode,
}

fn partial_err(remote: &RemoteScanState) -> Option<CustomMessage> {
    let err = remote.partial_err.lock().clone();
    (!err.is_empty()).then_some(CustomMessage::PartialErr(err))
}

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
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::empty::EmptyExec;
    use parking_lot::Mutex;

    use super::*;

    fn create_test_scan_stats() -> ScanStats {
        ScanStats {
            files: 10,
            ..Default::default()
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

    fn describe(messages: Vec<CustomMessage>) -> Vec<String> {
        messages
            .into_iter()
            .map(|message| match message {
                CustomMessage::ScanStats(stats) => format!("ScanStats({})", stats.files),
                CustomMessage::PeakMemory(peak) => format!("PeakMemory({peak})"),
                CustomMessage::PartialErr(err) => format!("PartialErr({err})"),
                CustomMessage::Metrics(metrics) => {
                    format!("Metrics({})", metrics[0].profile.as_ref().unwrap().name)
                }
            })
            .collect()
    }

    #[test]
    fn test_follower_sends_only_its_own_values() {
        let messages = NodeMessages {
            scan_stats: create_test_scan_stats(),
            peak_memory: Arc::new(AtomicUsize::new(5)),
            profile: None,
            role: NodeRole::Follower,
        };
        assert_eq!(describe(messages.first()), ["ScanStats(10)"]);
        assert_eq!(describe(messages.last()), ["PeakMemory(5)"]);
    }

    #[test]
    fn test_cluster_leader_also_sends_what_its_remote_scan_collected() {
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
            profile: Some(MetricsInfo {
                plan: create_test_execution_plan(),
                build_profile: test_profile,
            }),
            role: NodeRole::ClusterLeader(remote),
        };
        assert_eq!(
            describe(messages.first()),
            ["ScanStats(10)", "ScanStats(3)"]
        );

        *partial_err.lock() = "node down".to_string();
        assert_eq!(
            describe(messages.last()),
            [
                "PeakMemory(5)",
                "PeakMemory(7)",
                "PartialErr(node down)",
                "Metrics(EmptyExec)"
            ]
        );
    }

    #[test]
    fn test_profile_carries_this_node() {
        let metrics = collect_metrics(&MetricsInfo {
            plan: create_test_execution_plan(),
            build_profile: test_profile,
        });
        assert_eq!(metrics.len(), 1);
        assert!(!metrics[0].node_address.is_empty());
        assert!(!metrics[0].node_name.is_empty());
    }
}

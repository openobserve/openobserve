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

use std::{collections::BTreeMap, sync::Arc};

use config::{
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::time::now_micros,
};
use datafusion::physical_plan::{
    ExecutionPlan, ExecutionPlanProperties, displayable,
    metrics::{MetricValue, MetricsSet},
};
use flight::{
    common::{Metrics, RemoteScanMetrics},
    profile::{MetricKind, ProfileInputs, ProfileMetric, ProfileNode, RemoteNodeProfile},
};
use parking_lot::Mutex;

use super::remote_scan_exec::RemoteScanExec;

/// Per-partition profiles of one remote scan, keyed by partition.
pub type NodeProfiles = Arc<Mutex<BTreeMap<usize, RemoteNodeProfile>>>;

/// One remote node as the leader sees it, published to its scan on drop; the default records
/// nothing.
#[derive(Debug, Default)]
pub struct NodeProfileRecorder {
    profiles: Option<NodeProfiles>,
    profile: RemoteNodeProfile,
}

impl NodeProfileRecorder {
    pub fn start(profiles: NodeProfiles, partition: usize, node: &dyn NodeInfo) -> Self {
        let role = match (node.is_querier(), node.is_ingester()) {
            (true, true) => "querier,ingester",
            (true, false) => "querier",
            (false, true) => "ingester",
            (false, false) => "",
        };
        Self {
            profiles: Some(profiles),
            profile: RemoteNodeProfile {
                partition,
                node_name: node.get_name(),
                node_address: node.get_grpc_addr(),
                role: role.to_string(),
                cluster: node.get_cluster(),
                start_us: now_micros(),
                ..Default::default()
            },
        }
    }

    /// Takes the node's own plan out of `metrics`; forwarded entries never carry one.
    pub fn take_plan(&mut self, metrics: &mut [Metrics]) {
        if let Some(plan) = metrics.iter_mut().find_map(|m| m.profile.take()) {
            self.profile.plan = Some(plan);
        }
    }

    pub fn mark_skipped(&mut self) {
        self.profile.skipped = true;
    }

    pub fn finish(&mut self, metrics: &RemoteScanMetrics, scan_stats: ScanStats) {
        let p = &mut self.profile;
        p.output_rows = metrics.output_rows.value() as u64;
        p.output_batches = metrics.batches_received.value() as u64;
        p.output_bytes = metrics.bytes_received.value() as u64;
        p.decode_ns = metrics.decode_time.value() as u64;
        p.scan_stats = Some(scan_stats);
    }
}

impl Drop for NodeProfileRecorder {
    fn drop(&mut self) {
        if let Some(profiles) = self.profiles.take() {
            self.profile.end_us = now_micros();
            let profile = std::mem::take(&mut self.profile);
            profiles.lock().insert(profile.partition, profile);
        }
    }
}

/// Profile of an executed plan; a remote scan carries its nodes' plans, as its local children never
/// ran.
pub fn build_profile(plan: &dyn ExecutionPlan) -> ProfileNode {
    let inputs = match plan.downcast_ref::<RemoteScanExec>() {
        Some(remote) => {
            ProfileInputs::Remote(remote.node_profiles.lock().values().cloned().collect())
        }
        None => ProfileInputs::Children(
            plan.children()
                .into_iter()
                .map(|child| build_profile(child.as_ref()))
                .collect(),
        ),
    };
    ProfileNode {
        name: plan.name().to_string(),
        detail: displayable(plan)
            .one_line()
            .to_string()
            .trim_end()
            .replace('\n', " "),
        partitions: plan.output_partitioning().partition_count(),
        metrics: plan
            .metrics()
            .map(|m| convert_metrics(&m))
            .unwrap_or_default(),
        inputs,
    }
}

/// One entry per metric name in first-seen order, so related metrics stay adjacent.
fn convert_metrics(metrics: &MetricsSet) -> Vec<ProfileMetric> {
    let mut out: Vec<ProfileMetric> = Vec::new();
    for metric in metrics.iter() {
        let Some((kind, value, total)) = metric_value(metric.value()) else {
            continue;
        };
        let name = metric.value().name();
        match out.iter_mut().find(|m| m.name == name) {
            Some(m) => {
                m.value += value;
                if let Some(t) = total {
                    *m.total.get_or_insert(0) += t;
                }
            }
            None => out.push(ProfileMetric {
                name: name.to_string(),
                kind,
                value,
                total,
            }),
        }
    }
    out
}

fn metric_value(value: &MetricValue) -> Option<(MetricKind, u64, Option<u64>)> {
    let as_u64 = |v: usize| v as u64;
    Some(match value {
        MetricValue::StartTimestamp(_) | MetricValue::EndTimestamp(_) => return None,
        MetricValue::OutputRows(c)
        | MetricValue::SpillCount(c)
        | MetricValue::OutputBatches(c)
        | MetricValue::SpilledRows(c)
        | MetricValue::Count { count: c, .. } => (MetricKind::Count, as_u64(c.value()), None),
        MetricValue::SpilledBytes(c) | MetricValue::OutputBytes(c) => {
            (MetricKind::Bytes, as_u64(c.value()), None)
        }
        MetricValue::ElapsedCompute(t) | MetricValue::Time { time: t, .. } => {
            (MetricKind::Time, as_u64(t.value()), None)
        }
        MetricValue::CurrentMemoryUsage(g)
        | MetricValue::Gauge { gauge: g, .. }
        | MetricValue::PeakMemoryUsage { gauge: g, .. } => {
            (MetricKind::Gauge, as_u64(g.value()), None)
        }
        MetricValue::PruningMetrics {
            pruning_metrics, ..
        } => {
            let pruned = as_u64(pruning_metrics.pruned());
            let total = pruned + as_u64(pruning_metrics.matched());
            (MetricKind::Pruning, pruned, Some(total))
        }
        MetricValue::Ratio { ratio_metrics, .. } => (
            MetricKind::Ratio,
            as_u64(ratio_metrics.part()),
            Some(as_u64(ratio_metrics.total())),
        ),
        MetricValue::Custom { .. } => (MetricKind::Other, as_u64(value.as_usize()), None),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int32Array, RecordBatch};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::{
        empty::EmptyExec,
        metrics::{ExecutionPlanMetricsSet, MetricBuilder},
        union::UnionExec,
    };

    use super::*;
    use crate::datafusion::distributed_plan::node::RemoteScanNode;

    #[derive(Debug)]
    struct TestNode;

    impl NodeInfo for TestNode {
        fn is_querier(&self) -> bool {
            true
        }
        fn get_grpc_addr(&self) -> String {
            "10.0.0.1:5081".to_string()
        }
        fn get_auth_token(&self) -> String {
            String::new()
        }
        fn get_name(&self) -> String {
            "q-0".to_string()
        }
        fn is_local(&self) -> bool {
            false
        }
    }

    fn empty() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        Arc::new(EmptyExec::new(schema))
    }

    fn batch(rows: i32) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        RecordBatch::try_new(
            schema,
            vec![Arc::new(Int32Array::from_iter_values(0..rows))],
        )
        .unwrap()
    }

    #[test]
    fn test_recorder_publishes_one_node_on_drop() {
        let profiles = NodeProfiles::default();
        let mut recorder = NodeProfileRecorder::start(profiles.clone(), 2, &TestNode);
        let metrics = RemoteScanMetrics::new(2, &ExecutionPlanMetricsSet::new());
        metrics.record_output(&batch(3));
        metrics.record_output(&batch(4));
        let mut cluster_metrics = vec![
            Metrics::default(),
            Metrics {
                profile: Some(ProfileNode {
                    name: "FilterExec".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ];
        recorder.take_plan(&mut cluster_metrics);
        recorder.finish(
            &metrics,
            ScanStats {
                files: 5,
                ..Default::default()
            },
        );
        assert!(profiles.lock().is_empty());
        drop(recorder);

        let p = profiles.lock().get(&2).cloned().unwrap();
        assert_eq!(p.node_name, "q-0");
        assert_eq!(p.role, "querier");
        assert_eq!(p.output_rows, 7);
        assert_eq!(p.output_batches, 2);
        assert!(p.end_us >= p.start_us);
        assert_eq!(p.scan_stats.unwrap().files, 5);
        assert_eq!(p.plan.unwrap().name, "FilterExec");
        assert!(cluster_metrics[1].profile.is_none());
    }

    #[test]
    fn test_recorder_publishes_skipped_and_unfinished_nodes() {
        let profiles = NodeProfiles::default();
        NodeProfileRecorder::start(profiles.clone(), 0, &TestNode).mark_skipped();
        drop(NodeProfileRecorder::start(profiles.clone(), 1, &TestNode));
        NodeProfileRecorder::default().mark_skipped();
        let profiles = profiles.lock();
        assert_eq!(profiles.len(), 2);
        assert!(profiles[&0].skipped);
        assert!(!profiles[&1].skipped && profiles[&1].scan_stats.is_none());
    }

    #[test]
    fn test_convert_metrics_sums_partitions() {
        let set = ExecutionPlanMetricsSet::new();
        MetricBuilder::new(&set).output_rows(0).add(10);
        MetricBuilder::new(&set).output_rows(1).add(30);
        MetricBuilder::new(&set)
            .elapsed_compute(0)
            .add_duration(std::time::Duration::from_nanos(5));
        let metrics = convert_metrics(&set.clone_inner());
        let rows = metrics.iter().find(|m| m.name == "output_rows").unwrap();
        assert_eq!(rows.kind, MetricKind::Count);
        assert_eq!(rows.value, 40);
        let time = metrics
            .iter()
            .find(|m| m.name == "elapsed_compute")
            .unwrap();
        assert_eq!(time.kind, MetricKind::Time);
        assert_eq!(time.value, 5);
    }

    #[test]
    fn test_build_profile_walks_children() {
        let plan = UnionExec::try_new(vec![empty(), empty()]).unwrap();
        let profile = build_profile(plan.as_ref());
        assert_eq!(profile.name, "UnionExec");
        let ProfileInputs::Children(children) = profile.inputs else {
            panic!("expected children");
        };
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].name, "EmptyExec");
    }

    #[test]
    fn test_build_profile_stops_at_remote() {
        let node = RemoteScanNode {
            nodes: vec![Arc::new(TestNode)],
            opentelemetry_context: opentelemetry::Context::current(),
            query_identifier: Default::default(),
            search_infos: Default::default(),
            index_info: Default::default(),
            super_cluster_info: Default::default(),
        };
        let remote = RemoteScanExec::new(empty(), node).unwrap();
        drop(NodeProfileRecorder::start(
            remote.node_profiles.clone(),
            0,
            &TestNode,
        ));
        let profile = build_profile(&remote);
        assert_eq!(profile.name, "RemoteScanExec");
        let ProfileInputs::Remote(remote) = profile.inputs else {
            panic!("expected remote inputs");
        };
        assert_eq!(remote[0].node_name, "q-0");
    }
}

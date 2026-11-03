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

use std::{collections::BTreeMap, fmt, sync::Arc};

use config::{
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::time::now_micros,
};
use datafusion::physical_plan::{
    DisplayFormatType, ExecutionPlan, ExecutionPlanProperties,
    metrics::{MetricValue, MetricsSet},
};
use flight::{
    common::{Metrics, RemoteScanMetrics},
    profile::{MetricKind, ProfileMetric, ProfileNode, RemoteNodeProfile},
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
    pub fn start(
        profiles: NodeProfiles,
        partition: usize,
        node: &dyn NodeInfo,
        assigned_files: usize,
    ) -> Self {
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
                region: node.get_region(),
                cluster: node.get_cluster(),
                start_us: now_micros(),
                assigned_files,
                ..Default::default()
            },
        }
    }

    pub fn record_batch(&mut self) {
        if self.profile.first_batch_us == 0 {
            self.profile.first_batch_us = now_micros();
        }
    }

    pub fn record_peak_memory(&mut self, peak_memory: usize) {
        self.profile.peak_memory = self.profile.peak_memory.max(peak_memory as u64);
    }

    pub fn record_error(&mut self, err: &str) {
        let error = &mut self.profile.error;
        if err.is_empty() || error.contains(err) {
            return;
        }
        if !error.is_empty() {
            error.push('\n');
        }
        error.push_str(err);
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
        p.fetch_ns = metrics.fetch_time.value() as u64;
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

struct OneLine<'a>(&'a dyn ExecutionPlan);

impl fmt::Display for OneLine<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt_as(DisplayFormatType::Default, f)
    }
}

/// Profile of an executed plan; a remote scan carries its nodes' plans, as its local children never
/// ran.
pub fn build_profile(plan: &dyn ExecutionPlan) -> ProfileNode {
    let mut node = ProfileNode {
        name: plan.name().to_string(),
        detail: OneLine(plan).to_string().replace('\n', " "),
        partitions: plan.output_partitioning().partition_count(),
        metrics: plan
            .metrics()
            .map(|m| convert_metrics(&m))
            .unwrap_or_default(),
        children: Vec::new(),
        remote: Vec::new(),
    };
    if let Some(remote) = plan.downcast_ref::<RemoteScanExec>() {
        node.remote = remote.node_profiles.lock().values().cloned().collect();
        return node;
    }
    node.children = plan
        .children()
        .into_iter()
        .map(|child| build_profile(child.as_ref()))
        .collect();
    node
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
                m.max = m.max.max(value);
                if let Some(t) = total {
                    *m.total.get_or_insert(0) += t;
                }
            }
            None => out.push(ProfileMetric {
                name: name.to_string(),
                kind,
                value,
                total,
                max: value,
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
        let mut recorder = NodeProfileRecorder::start(profiles.clone(), 2, &TestNode, 7);
        let metrics = RemoteScanMetrics::new(2, &ExecutionPlanMetricsSet::new());
        for rows in [3, 4] {
            metrics.record_output(&batch(rows));
            recorder.record_batch();
        }
        recorder.record_peak_memory(10);
        recorder.record_peak_memory(4);
        recorder.record_error("boom");
        recorder.record_error("boom");
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
        assert_eq!(p.assigned_files, 7);
        assert_eq!(p.output_rows, 7);
        assert_eq!(p.output_batches, 2);
        assert!(p.first_batch_us >= p.start_us && p.end_us >= p.first_batch_us);
        assert_eq!(p.scan_stats.unwrap().files, 5);
        assert_eq!(p.peak_memory, 10);
        assert_eq!(p.error, "boom");
        assert_eq!(p.plan.unwrap().name, "FilterExec");
        assert!(cluster_metrics[1].profile.is_none());
    }

    #[test]
    fn test_recorder_publishes_skipped_and_failed_nodes() {
        let profiles = NodeProfiles::default();
        NodeProfileRecorder::start(profiles.clone(), 0, &TestNode, 0).mark_skipped();
        NodeProfileRecorder::start(profiles.clone(), 1, &TestNode, 3).record_error("down");
        NodeProfileRecorder::default().record_error("ignored");
        let profiles = profiles.lock();
        assert_eq!(profiles.len(), 2);
        assert!(profiles[&0].skipped);
        assert!(!profiles[&1].skipped);
        assert_eq!(profiles[&1].error, "down");
    }

    #[test]
    fn test_convert_metrics_sums_partitions_and_keeps_max() {
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
        assert_eq!(rows.max, 30);
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
        assert_eq!(profile.children.len(), 2);
        assert_eq!(profile.children[0].name, "EmptyExec");
        assert!(profile.remote.is_empty());
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
            0,
        ));
        let profile = build_profile(&remote);
        assert_eq!(profile.name, "RemoteScanExec");
        assert!(profile.children.is_empty());
        assert_eq!(profile.remote[0].node_name, "q-0");
    }
}

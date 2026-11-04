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

use std::fmt;

use config::{
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::time::now_micros,
};
use datafusion::physical_plan::{
    DisplayFormatType, ExecutionPlan, ExecutionPlanProperties,
    metrics::{MetricValue, MetricsSet},
};
use flight::{
    common::{Metrics, NodeProfiles, RemoteScanMetrics},
    profile::{MetricKind, ProfileInputs, ProfileMetric, ProfileNode, RemoteNodeProfile},
};

use super::remote_scan_exec::RemoteScanExec;

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

    /// Keeps the plan the node sent back about itself.
    pub fn record_plan(&mut self, metrics: Vec<Metrics>) {
        if let Some(plan) = metrics.into_iter().find_map(|m| m.profile) {
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

/// A plan node's own line, exactly as EXPLAIN prints it.
struct PlanDetail<'a>(&'a dyn ExecutionPlan);

impl fmt::Display for PlanDetail<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt_as(DisplayFormatType::Default, f)
    }
}

/// Profile of an executed plan; a remote scan lists the nodes it called, as its children never ran.
pub fn build_profile(plan: &dyn ExecutionPlan) -> ProfileNode {
    let inputs = match plan.downcast_ref::<RemoteScanExec>() {
        Some(remote) => ProfileInputs::Remote(
            remote
                .state
                .node_profiles
                .lock()
                .values()
                .cloned()
                .collect(),
        ),
        None => ProfileInputs::Children(
            plan.children()
                .into_iter()
                .map(|child| build_profile(child.as_ref()))
                .collect(),
        ),
    };
    ProfileNode {
        name: plan.name().to_string(),
        detail: PlanDetail(plan).to_string(),
        partitions: plan.output_partitioning().partition_count(),
        metrics: plan
            .metrics()
            .map(|m| convert_metrics(&m))
            .unwrap_or_default(),
        inputs,
    }
}

/// Aggregates and orders the metrics the same way the text plan does, so `display` matches it.
fn convert_metrics(metrics: &MetricsSet) -> Vec<ProfileMetric> {
    metrics
        .aggregate_by_name()
        .sorted_for_display()
        .timestamps_removed()
        .iter()
        .map(|metric| {
            let value = metric.value();
            let (kind, number, total) = metric_value(value);
            ProfileMetric {
                name: value.name().to_string(),
                kind,
                value: number,
                total,
                display: value.to_string(),
            }
        })
        .collect()
}

fn metric_value(value: &MetricValue) -> (MetricKind, u64, Option<u64>) {
    let as_u64 = |v: usize| v as u64;
    match value {
        MetricValue::OutputRows(c)
        | MetricValue::SpillCount(c)
        | MetricValue::OutputBatches(c)
        | MetricValue::SpilledRows(c)
        | MetricValue::Count { count: c, .. } => (MetricKind::Count, as_u64(c.value()), None),
        MetricValue::SpilledBytes(c) | MetricValue::OutputBytes(c) => {
            (MetricKind::Bytes, as_u64(c.value()), None)
        }
        MetricValue::CurrentMemoryUsage(g) | MetricValue::PeakMemoryUsage { gauge: g, .. } => {
            (MetricKind::Bytes, as_u64(g.value()), None)
        }
        MetricValue::ElapsedCompute(t) | MetricValue::Time { time: t, .. } => {
            (MetricKind::Time, as_u64(t.value()), None)
        }
        MetricValue::Gauge { gauge: g, .. } => (MetricKind::Gauge, as_u64(g.value()), None),
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
        // Timestamps never get here: convert_metrics removes them first.
        MetricValue::Custom { .. }
        | MetricValue::StartTimestamp(_)
        | MetricValue::EndTimestamp(_) => (MetricKind::Other, as_u64(value.as_usize()), None),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int32Array, RecordBatch};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        physical_plan::{
            collect,
            display::DisplayableExecutionPlan,
            empty::EmptyExec,
            metrics::{ExecutionPlanMetricsSet, MetricBuilder},
            union::UnionExec,
        },
        prelude::SessionContext,
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
        recorder.record_plan(vec![Metrics {
            profile: Some(ProfileNode {
                name: "FilterExec".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        }]);
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
        assert_eq!(time.display, "5ns");
    }

    #[tokio::test]
    async fn test_profile_text_matches_datafusion() {
        let ctx = SessionContext::new();
        let sql = "SELECT a % 7 AS k, count(*) FROM (SELECT unnest(range(1, 50)) AS a) \
                   WHERE a > 10 GROUP BY k ORDER BY k";
        let plan = ctx
            .sql(sql)
            .await
            .unwrap()
            .create_physical_plan()
            .await
            .unwrap();
        collect(plan.clone(), ctx.task_ctx()).await.unwrap();
        let expected = DisplayableExecutionPlan::with_metrics(plan.as_ref())
            .indent(false)
            .to_string();
        let profile = build_profile(plan.as_ref());
        assert_eq!(profile.to_text(), expected);
        assert!(expected.contains("selectivity="), "{expected}");
    }

    #[test]
    fn test_memory_metrics_are_bytes() {
        let set = ExecutionPlanMetricsSet::new();
        MetricBuilder::new(&set).mem_used(0).set(2048);
        let metrics = convert_metrics(&set.clone_inner());
        assert_eq!(metrics[0].kind, MetricKind::Bytes);
        assert_eq!(metrics[0].value, 2048);
        assert_eq!(metrics[0].display, "2.0 KB");
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
            remote.state.node_profiles.clone(),
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

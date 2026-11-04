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

use config::{meta::cluster::NodeInfo, utils::time::now_micros};
use datafusion::physical_plan::{
    DisplayFormatType, ExecutionPlan, ExecutionPlanProperties,
    metrics::{MetricValue, MetricsSet, Timestamp},
};
use flight::{
    common::RemoteCall,
    profile::{MetricKind, ProfileInputs, ProfileMetric, ProfileNode, RemoteNodeProfile},
};

use super::remote_scan_exec::RemoteScanExec;

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
        Some(remote) => ProfileInputs::Remote(remote_nodes(remote)),
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

/// The nodes a remote scan called, read from each call's live counters when the profile is built.
fn remote_nodes(remote: &RemoteScanExec) -> Vec<RemoteNodeProfile> {
    let now = now_micros();
    let nodes = &remote.remote_scan_node().nodes;
    remote
        .state
        .calls
        .lock()
        .iter()
        .filter_map(|(&partition, call)| {
            let node = nodes.get(partition)?;
            Some(remote_node(partition, node.as_ref(), call, now))
        })
        .collect()
}

fn remote_node(
    partition: usize,
    node: &dyn NodeInfo,
    call: &RemoteCall,
    now: i64,
) -> RemoteNodeProfile {
    let metrics = &call.metrics;
    let report = call.report.lock();
    RemoteNodeProfile {
        partition,
        node_name: node.get_name(),
        node_address: node.get_grpc_addr(),
        role: role_name(node).to_string(),
        cluster: node.get_cluster(),
        start_us: timestamp_us(&metrics.start_time).unwrap_or(now),
        // A call still running, or cut short by a LIMIT, ends when the profile is built.
        end_us: timestamp_us(&metrics.end_time).unwrap_or(now),
        output_rows: metrics.output_rows.value() as u64,
        output_batches: metrics.batches_received.value() as u64,
        output_bytes: metrics.bytes_received.value() as u64,
        decode_ns: metrics.decode_time.value() as u64,
        skipped: call.skipped,
        scan_stats: report.scan_stats,
        plan: report.plan.clone(),
    }
}

fn role_name(node: &dyn NodeInfo) -> &'static str {
    match (node.is_querier(), node.is_ingester()) {
        (true, true) => "querier,ingester",
        (true, false) => "querier",
        (false, true) => "ingester",
        (false, false) => "",
    }
}

fn timestamp_us(timestamp: &Timestamp) -> Option<i64> {
    timestamp.value().map(|t| t.timestamp_micros())
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
    use config::meta::search::ScanStats;
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
    use flight::common::{Metrics, RemoteScanMetrics};

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

    fn remote_scan() -> RemoteScanExec {
        let node = RemoteScanNode {
            nodes: vec![Arc::new(TestNode), Arc::new(TestNode)],
            opentelemetry_context: opentelemetry::Context::current(),
            query_identifier: Default::default(),
            search_infos: Default::default(),
            index_info: Default::default(),
            super_cluster_info: Default::default(),
        };
        RemoteScanExec::new(empty(), node).unwrap()
    }

    fn started_call(remote: &RemoteScanExec, partition: usize) -> RemoteCall {
        let call = RemoteCall {
            metrics: RemoteScanMetrics::new(partition, &remote.metrics),
            skipped: false,
            report: Default::default(),
        };
        call.metrics.start_time.record();
        remote.state.calls.lock().insert(partition, call.clone());
        call
    }

    #[test]
    fn test_build_profile_reads_each_remote_call() {
        let remote = remote_scan();
        let finished = started_call(&remote, 0);
        finished.metrics.record_output(&batch(3));
        finished.metrics.record_output(&batch(4));
        {
            let mut report = finished.report.lock();
            report.add_scan_stats(&ScanStats {
                files: 5,
                ..Default::default()
            });
            report.record_plan(vec![Metrics {
                profile: Some(ProfileNode {
                    name: "FilterExec".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            }]);
        }
        finished.metrics.end_time.record();
        started_call(&remote, 1);

        let profile = build_profile(&remote);
        assert_eq!(profile.name, "RemoteScanExec");
        let ProfileInputs::Remote(nodes) = profile.inputs else {
            panic!("expected remote inputs");
        };
        assert_eq!(nodes.len(), 2);
        let p = &nodes[0];
        assert_eq!((p.partition, p.node_name.as_str()), (0, "q-0"));
        assert_eq!(p.role, "querier");
        assert_eq!((p.output_rows, p.output_batches), (7, 2));
        assert!(p.start_us > 0 && p.end_us >= p.start_us);
        assert_eq!(p.scan_stats.unwrap().files, 5);
        assert_eq!(p.plan.as_ref().unwrap().name, "FilterExec");

        let running = &nodes[1];
        assert!(running.end_us >= running.start_us);
        assert!(running.scan_stats.is_none() && running.plan.is_none());
    }
}

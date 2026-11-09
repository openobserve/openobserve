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

use std::{collections::BTreeMap, fmt, sync::Arc, time::Duration};

use config::{
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::time::now_micros,
};
use datafusion::physical_plan::{
    DisplayFormatType, ExecutionPlan, ExecutionPlanProperties,
    metrics::{MetricValue, MetricsSet},
};
use flight::{
    common::{Metrics, NodeProfiles, RemoteScanMetrics, job_trace_id},
    profile::{
        MetricKind, NodeStatus, ProfileInputs, ProfileMetric, ProfileNode, RemoteNodeProfile,
    },
};

use crate::datafusion::distributed::remote_scan::{
    flight_client::fetch_node_report, remote_scan_exec::RemoteScanExec,
};

/// How long a caller waits for the reports its remote nodes' streams did not deliver.
pub const REMOTE_PROFILE_TIMEOUT: Duration = Duration::from_secs(10);

/// Keeps one remote call's entry in its scan's profiles current; the default records nothing.
#[derive(Debug, Default)]
pub struct NodeProfileRecorder {
    entry: Option<(NodeProfiles, usize)>,
}

impl NodeProfileRecorder {
    /// Publishes the call's entry at once, as not executed until the request goes out.
    pub fn start(profiles: NodeProfiles, partition: usize, node: &dyn NodeInfo) -> Self {
        let profile = RemoteNodeProfile {
            start_us: now_micros(),
            status: NodeStatus::NotExecuted,
            ..node_profile(partition, node)
        };
        profiles.lock().insert(partition, profile);
        Self {
            entry: Some((profiles, partition)),
        }
    }

    /// Keeps the plan the node sent back about itself.
    pub fn record_plan(&self, metrics: Vec<Metrics>) {
        if let Some(plan) = metrics.into_iter().find_map(|m| m.profile) {
            self.update(|p| {
                p.plan = Some(plan);
                p.status = NodeStatus::Completed;
            });
        }
    }

    pub fn mark_skipped(&self) {
        self.update(|p| {
            p.status = NodeStatus::Skipped;
            p.skipped = true;
        });
    }

    /// The request is going out under `job_id`; a call dropped from here on stopped early.
    pub fn mark_sent(&self, job_id: String) {
        self.update(|p| {
            p.status = NodeStatus::EarlyStopped;
            p.job_id = job_id;
        });
    }

    /// The node returned no stream, so it holds no report to fetch.
    pub fn mark_refused(&self, e: &tonic::Status) {
        self.mark_failed(e);
        self.update(|p| p.job_id.clear());
    }

    /// This caller's own deadline ended the call.
    pub fn mark_timed_out(&self) {
        self.update(|p| p.status = NodeStatus::TimedOut);
    }

    /// The call failed on this side; a report fetched later keeps this status.
    pub fn mark_failed(&self, e: &tonic::Status) {
        let status = match e.code() {
            tonic::Code::DeadlineExceeded => NodeStatus::TimedOut,
            _ => NodeStatus::Failed,
        };
        self.update(|p| p.status = status);
    }

    pub fn add_scan_stats(&self, stats: &ScanStats) {
        self.update(|p| p.scan_stats.get_or_insert_default().add(stats));
    }

    fn update(&self, f: impl FnOnce(&mut RemoteNodeProfile)) {
        if let Some((profiles, partition)) = &self.entry
            && let Some(profile) = profiles.lock().get_mut(partition)
        {
            f(profile);
        }
    }
}

impl Drop for NodeProfileRecorder {
    fn drop(&mut self) {
        self.update(|p| {
            if p.end_us == 0 {
                p.end_us = now_micros();
            }
        });
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
        Some(remote) => ProfileInputs::Remote(remote_node_profiles(remote)),
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

/// Gives every partition of every remote scan in `plan` an entry and fetches the missing reports.
pub async fn complete_remote_profiles(plan: &dyn ExecutionPlan, timeout: Duration) {
    let mut scans = Vec::new();
    collect_remote_scans(plan, &mut scans);
    let mut fetches = Vec::new();
    let now = now_micros();
    for remote in scans {
        let mut profiles = remote.state.node_profiles.lock();
        end_open_calls(&mut profiles, now);
        let nodes = &remote.remote_scan_node().nodes;
        let pending = pending_reports(&mut profiles, nodes, |p| remote.is_skipped(p));
        drop(profiles);
        for (partition, job_id) in pending {
            fetches.push(fetch_report(remote, partition, job_id, timeout));
        }
    }
    futures::future::join_all(fetches).await;
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

/// Remote scans that ran in `plan`; the inputs below them are only templates sent to the nodes.
fn collect_remote_scans<'a>(plan: &'a dyn ExecutionPlan, scans: &mut Vec<&'a RemoteScanExec>) {
    match plan.downcast_ref::<RemoteScanExec>() {
        Some(remote) => scans.push(remote),
        None => {
            for child in plan.children() {
                collect_remote_scans(child.as_ref(), scans);
            }
        }
    }
}

async fn fetch_report(
    remote: &RemoteScanExec,
    partition: usize,
    job_id: String,
    timeout: Duration,
) {
    let scan_node = remote.remote_scan_node();
    let identifier = &scan_node.query_identifier;
    // Entries are keyed by the partition that indexes `nodes`, so the index is in range.
    let node = scan_node.nodes[partition].clone();
    let node_name = node.get_name();
    let job = job_trace_id(&identifier.trace_id, &job_id);
    let fetched =
        fetch_node_report(&identifier.trace_id, &identifier.org_id, node, job, timeout).await;
    let mut profiles = remote.state.node_profiles.lock();
    let Some(profile) = profiles.get_mut(&partition) else {
        return;
    };
    // The node sees only that its caller went away; an ending the caller recorded wins.
    let caller_ended = matches!(profile.status, NodeStatus::Failed | NodeStatus::TimedOut);
    match fetched {
        Ok(report) => {
            if !caller_ended {
                profile.status = report.status;
            }
            profile.plan = report.plan;
        }
        Err(e) => {
            // Not found means the node never got as far as returning a stream.
            if !caller_ended && e.code() != tonic::Code::NotFound {
                profile.status = NodeStatus::Unavailable;
            }
            log::warn!(
                "[trace_id {}] explain analyze: no profile from node {node_name}, partition {partition}: {e}",
                identifier.trace_id
            );
        }
    }
}

/// Ends the calls whose streams the runtime has not dropped yet: their caller has stopped reading.
fn end_open_calls(profiles: &mut BTreeMap<usize, RemoteNodeProfile>, now_us: i64) {
    for p in profiles.values_mut() {
        if p.start_us > 0 && p.end_us == 0 {
            p.end_us = now_us;
        }
    }
}

fn node_profile(partition: usize, node: &dyn NodeInfo) -> RemoteNodeProfile {
    let role = match (node.is_querier(), node.is_ingester()) {
        (true, true) => "querier,ingester",
        (true, false) => "querier",
        (false, true) => "ingester",
        (false, false) => "",
    };
    RemoteNodeProfile {
        partition,
        node_name: node.get_name(),
        node_address: node.get_grpc_addr(),
        role: role.to_string(),
        cluster: node.get_cluster(),
        ..Default::default()
    }
}

/// Adds an entry for each partition that never started and lists the sent calls with no report.
fn pending_reports(
    profiles: &mut BTreeMap<usize, RemoteNodeProfile>,
    nodes: &[Arc<dyn NodeInfo>],
    is_skipped: impl Fn(usize) -> bool,
) -> Vec<(usize, String)> {
    for (partition, node) in nodes.iter().enumerate() {
        profiles.entry(partition).or_insert_with(|| {
            let skipped = is_skipped(partition);
            RemoteNodeProfile {
                status: if skipped {
                    NodeStatus::Skipped
                } else {
                    NodeStatus::NotExecuted
                },
                skipped,
                ..node_profile(partition, node.as_ref())
            }
        });
    }
    profiles
        .iter()
        .filter(|(_, p)| p.plan.is_none() && !p.job_id.is_empty())
        .map(|(partition, p)| (*partition, p.job_id.clone()))
        .collect()
}

/// The scan's node entries with their counters read from the scan, as a stream may drop late.
fn remote_node_profiles(remote: &RemoteScanExec) -> Vec<RemoteNodeProfile> {
    let metrics = remote.metrics.clone_inner();
    let mut profiles: Vec<_> = remote
        .state
        .node_profiles
        .lock()
        .values()
        .cloned()
        .collect();
    for profile in &mut profiles {
        RemoteScanMetrics::copy_to_profile(&metrics, profile);
    }
    profiles
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
    use crate::datafusion::distributed::remote_scan::node::RemoteScanNode;

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
    fn test_recorder_updates_its_placeholder_in_place() {
        let profiles = NodeProfiles::default();
        let recorder = NodeProfileRecorder::start(profiles.clone(), 2, &TestNode);
        let status = |profiles: &NodeProfiles| profiles.lock()[&2].status;
        assert_eq!(status(&profiles), NodeStatus::NotExecuted);
        assert_eq!(profiles.lock()[&2].role, "querier");
        recorder.mark_sent("j2".to_string());
        assert_eq!(status(&profiles), NodeStatus::EarlyStopped);
        assert_eq!(profiles.lock()[&2].job_id, "j2");
        recorder.record_plan(vec![Metrics {
            profile: Some(ProfileNode {
                name: "FilterExec".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        }]);
        for files in [2, 3] {
            recorder.add_scan_stats(&ScanStats {
                files,
                ..Default::default()
            });
        }
        drop(recorder);

        let p = profiles.lock().get(&2).cloned().unwrap();
        assert_eq!(p.node_name, "q-0");
        assert_eq!(p.status, NodeStatus::Completed);
        assert!(p.end_us >= p.start_us);
        assert_eq!(p.scan_stats.unwrap().files, 5);
        assert_eq!(p.plan.unwrap().name, "FilterExec");
    }

    #[test]
    fn test_recorder_marks_how_a_call_ended() {
        type Mark = fn(&NodeProfileRecorder);
        let cases: [(Mark, NodeStatus); 4] = [
            (|r| r.mark_skipped(), NodeStatus::Skipped),
            (
                |r| r.mark_failed(&tonic::Status::internal("boom")),
                NodeStatus::Failed,
            ),
            (
                |r| r.mark_failed(&tonic::Status::deadline_exceeded("slow")),
                NodeStatus::TimedOut,
            ),
            (|r| r.mark_timed_out(), NodeStatus::TimedOut),
        ];
        for (mark, expected) in cases {
            let profiles = NodeProfiles::default();
            mark(&NodeProfileRecorder::start(profiles.clone(), 0, &TestNode));
            assert_eq!(profiles.lock()[&0].status, expected);
            assert_eq!(profiles.lock()[&0].skipped, expected == NodeStatus::Skipped);
        }
        NodeProfileRecorder::default().mark_skipped();
    }

    #[test]
    fn test_refused_call_leaves_no_report_to_fetch() {
        let profiles = NodeProfiles::default();
        let recorder = NodeProfileRecorder::start(profiles.clone(), 0, &TestNode);
        recorder.mark_sent("j0".to_string());
        recorder.mark_refused(&tonic::Status::internal("no plan"));
        assert_eq!(profiles.lock()[&0].status, NodeStatus::Failed);
        let nodes: Vec<Arc<dyn NodeInfo>> = vec![Arc::new(TestNode)];
        assert!(pending_reports(&mut profiles.lock(), &nodes, |_| false).is_empty());
    }

    #[test]
    fn test_late_drop_keeps_a_fetched_report() {
        let profiles = NodeProfiles::default();
        let recorder = NodeProfileRecorder::start(profiles.clone(), 0, &TestNode);
        {
            let mut profiles = profiles.lock();
            let p = profiles.get_mut(&0).unwrap();
            p.status = NodeStatus::EarlyStopped;
            p.plan = Some(ProfileNode::default());
        }
        drop(recorder);
        let profiles = profiles.lock();
        assert_eq!(profiles[&0].status, NodeStatus::EarlyStopped);
        assert!(profiles[&0].plan.is_some() && profiles[&0].end_us > 0);
    }

    #[test]
    fn test_pending_reports_marks_unstarted_and_lists_unreported() {
        let entry = |status, job_id: &str, plan| RemoteNodeProfile {
            status,
            job_id: job_id.to_string(),
            plan,
            ..Default::default()
        };
        let mut profiles = BTreeMap::from([
            (
                0,
                entry(NodeStatus::Completed, "j0", Some(ProfileNode::default())),
            ),
            (1, entry(NodeStatus::EarlyStopped, "j1", None)),
            (2, entry(NodeStatus::Skipped, "", None)),
            (3, entry(NodeStatus::Failed, "", None)),
            (4, entry(NodeStatus::TimedOut, "j4", None)),
        ]);
        let nodes: Vec<Arc<dyn NodeInfo>> = (0..7).map(|_| Arc::new(TestNode) as _).collect();
        assert_eq!(
            pending_reports(&mut profiles, &nodes, |partition| partition == 6),
            vec![(1, "j1".to_string()), (4, "j4".to_string())]
        );
        assert_eq!(profiles[&5].status, NodeStatus::NotExecuted);
        assert_eq!(profiles[&5].node_name, "q-0");
        assert_eq!(profiles[&6].status, NodeStatus::Skipped);
        assert!(profiles[&6].skipped);
        assert_eq!(profiles[&2].status, NodeStatus::Skipped);
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

    #[tokio::test]
    async fn test_profile_reads_a_stream_the_runtime_has_not_dropped() {
        let node = RemoteScanNode {
            nodes: vec![Arc::new(TestNode), Arc::new(TestNode)],
            opentelemetry_context: opentelemetry::Context::current(),
            query_identifier: Default::default(),
            search_infos: Default::default(),
            index_info: Default::default(),
            super_cluster_info: Default::default(),
        };
        let remote = RemoteScanExec::new(empty(), node).unwrap();
        let recorders = [(0, 3), (1, 5)].map(|(partition, rows)| {
            let recorder = NodeProfileRecorder::start(
                remote.state.node_profiles.clone(),
                partition,
                &TestNode,
            );
            recorder.mark_sent(String::new());
            recorder.add_scan_stats(&ScanStats {
                files: i64::from(rows),
                ..Default::default()
            });
            let metrics = RemoteScanMetrics::new(partition, &remote.metrics);
            metrics.record_output(&batch(rows));
            metrics.record_output(&batch(rows));
            recorder
        });

        complete_remote_profiles(&remote, Duration::from_secs(1)).await;
        let ProfileInputs::Remote(nodes) = build_profile(&remote).inputs else {
            panic!("expected remote inputs");
        };
        let counts = nodes
            .iter()
            .map(|p| (p.output_rows, p.output_batches, p.scan_stats.unwrap().files))
            .collect::<Vec<_>>();
        assert_eq!(counts, [(6, 2, 3), (10, 2, 5)]);
        assert!(
            nodes
                .iter()
                .all(|p| p.output_bytes > 0 && p.end_us >= p.start_us)
        );
        let end_us = nodes[0].end_us;
        drop(recorders);
        assert_eq!(remote.state.node_profiles.lock()[&0].end_us, end_us);
    }
}

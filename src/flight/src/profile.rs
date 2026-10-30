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

use std::fmt;

use config::meta::search::ScanStats;
use datafusion::physical_plan::{
    DisplayFormatType, ExecutionPlan, ExecutionPlanProperties,
    metrics::{MetricValue, MetricsSet},
};
use serde::{Deserialize, Serialize};

pub const PROFILE_VERSION: u32 = 1;

/// The profile of one EXPLAIN ANALYZE run, as returned to the client.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryProfile {
    pub version: u32,
    pub node_name: String,
    pub node_address: String,
    pub start_us: i64,
    pub end_us: i64,
    pub output_rows: usize,
    pub plan: ProfileNode,
}

/// One operator of an executed plan.
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

/// A metric summed across partitions; `max` is the largest single partition.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProfileMetric {
    pub name: String,
    pub kind: MetricKind,
    pub value: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub max: u64,
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
    pub region: String,
    pub cluster: String,
    pub start_us: i64,
    pub first_batch_us: i64,
    pub end_us: i64,
    pub output_rows: u64,
    pub output_batches: u64,
    pub output_bytes: u64,
    pub fetch_ns: u64,
    pub decode_ns: u64,
    pub assigned_files: usize,
    pub skipped: bool,
    pub error: String,
    pub peak_memory: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_stats: Option<ScanStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<ProfileNode>,
}

struct OneLine<'a>(&'a dyn ExecutionPlan);

impl fmt::Display for OneLine<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt_as(DisplayFormatType::Default, f)
    }
}

/// `remote` yields a remote scan's per-node profiles; its local children never ran, so they are
/// skipped.
pub fn build_profile(
    plan: &dyn ExecutionPlan,
    remote: &dyn Fn(&dyn ExecutionPlan) -> Option<Vec<RemoteNodeProfile>>,
) -> ProfileNode {
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
    if let Some(nodes) = remote(plan) {
        node.remote = nodes;
        return node;
    }
    node.children = plan
        .children()
        .into_iter()
        .map(|child| build_profile(child.as_ref(), remote))
        .collect();
    node
}

/// One entry per metric name in first-seen order, so related metrics stay adjacent.
pub fn convert_metrics(metrics: &MetricsSet) -> Vec<ProfileMetric> {
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

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::{
        empty::EmptyExec,
        metrics::{ExecutionPlanMetricsSet, MetricBuilder},
        union::UnionExec,
    };

    use super::*;

    fn empty() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        Arc::new(EmptyExec::new(schema))
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
        let profile = build_profile(plan.as_ref(), &|_| None);
        assert_eq!(profile.name, "UnionExec");
        assert_eq!(profile.children.len(), 2);
        assert_eq!(profile.children[0].name, "EmptyExec");
        assert!(profile.remote.is_empty());
    }

    #[test]
    fn test_build_profile_stops_at_remote() {
        let plan = UnionExec::try_new(vec![empty(), empty()]).unwrap();
        let remote = |p: &dyn ExecutionPlan| {
            (p.name() == "UnionExec").then(|| {
                vec![RemoteNodeProfile {
                    node_name: "q-0".to_string(),
                    ..Default::default()
                }]
            })
        };
        let profile = build_profile(plan.as_ref(), &remote);
        assert!(profile.children.is_empty());
        assert_eq!(profile.remote[0].node_name, "q-0");
    }

    #[test]
    fn test_profile_json_round_trip_and_unknown_kind() {
        let node = ProfileNode {
            name: "FilterExec".to_string(),
            metrics: vec![ProfileMetric {
                name: "output_rows".to_string(),
                kind: MetricKind::Count,
                value: 1,
                total: None,
                max: 1,
            }],
            ..Default::default()
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(!json.contains("children"));
        let back: ProfileNode = serde_json::from_str(&json).unwrap();
        assert_eq!(back.metrics, node.metrics);
        let m: ProfileMetric =
            serde_json::from_str(r#"{"name":"x","kind":"future_kind","value":1,"max":1}"#).unwrap();
        assert_eq!(m.kind, MetricKind::Other);
    }
}

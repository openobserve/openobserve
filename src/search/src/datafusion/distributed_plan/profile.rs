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

use arrow::array::RecordBatch;
use config::{
    meta::{cluster::NodeInfo, search::ScanStats},
    utils::{record_batch_ext::RecordBatchExt, time::now_micros},
};
use datafusion::physical_plan::ExecutionPlan;
use flight::{
    common::{Metrics, RemoteScanMetrics},
    profile::{ProfileNode, RemoteNodeProfile},
};
use parking_lot::Mutex;

use super::remote_scan_exec::RemoteScanExec;

/// Per-partition profiles of one remote scan, keyed by partition.
pub type NodeProfiles = Arc<Mutex<BTreeMap<usize, RemoteNodeProfile>>>;

/// Records what the leader observes of one remote node during EXPLAIN ANALYZE.
#[derive(Debug, Clone)]
pub struct NodeProfileRecorder {
    partition: usize,
    profiles: NodeProfiles,
}

impl NodeProfileRecorder {
    pub fn start(
        profiles: NodeProfiles,
        partition: usize,
        node: &dyn NodeInfo,
        assigned_files: usize,
    ) -> Self {
        let role = [
            (node.is_querier(), "querier"),
            (node.is_ingester(), "ingester"),
        ]
        .into_iter()
        .filter_map(|(on, role)| on.then_some(role))
        .collect::<Vec<_>>()
        .join(",");
        profiles.lock().insert(
            partition,
            RemoteNodeProfile {
                partition,
                node_name: node.get_name(),
                node_address: node.get_grpc_addr(),
                role,
                region: node.get_region(),
                cluster: node.get_cluster(),
                start_us: now_micros(),
                assigned_files,
                ..Default::default()
            },
        );
        Self {
            partition,
            profiles,
        }
    }

    fn update(&self, f: impl FnOnce(&mut RemoteNodeProfile)) {
        if let Some(profile) = self.profiles.lock().get_mut(&self.partition) {
            f(profile);
        }
    }

    pub fn record_batch(&self, batch: &RecordBatch) {
        let (rows, bytes) = (batch.num_rows() as u64, batch.size() as u64);
        self.update(|p| {
            if p.first_batch_us == 0 {
                p.first_batch_us = now_micros();
            }
            p.output_rows += rows;
            p.output_batches += 1;
            p.output_bytes += bytes;
        });
    }

    pub fn record_scan_stats(&self, stats: &ScanStats) {
        self.update(|p| {
            p.scan_stats
                .get_or_insert_with(ScanStats::default)
                .add(stats)
        });
    }

    pub fn record_peak_memory(&self, peak_memory: usize) {
        self.update(|p| p.peak_memory = p.peak_memory.max(peak_memory as u64));
    }

    pub fn record_error(&self, err: &str) {
        if err.is_empty() {
            return;
        }
        self.update(|p| {
            if !p.error.contains(err) {
                if !p.error.is_empty() {
                    p.error.push('\n');
                }
                p.error.push_str(err);
            }
        });
    }

    /// Takes the node's own plan out of `metrics`; forwarded entries never carry one.
    pub fn take_plan(&self, metrics: &mut [Metrics]) {
        let Some(plan) = metrics.iter_mut().find_map(|m| m.profile.take()) else {
            return;
        };
        self.update(|p| p.plan = Some(plan));
    }

    pub fn finish(&self, metrics: &RemoteScanMetrics) {
        let (fetch_ns, decode_ns) = (
            metrics.fetch_time.value() as u64,
            metrics.decode_time.value() as u64,
        );
        self.update(|p| {
            p.end_us = now_micros();
            p.fetch_ns = fetch_ns;
            p.decode_ns = decode_ns;
        });
    }

    pub fn finish_skipped(&self, err: Option<&str>) {
        self.update(|p| {
            p.end_us = now_micros();
            p.skipped = err.is_none();
        });
        if let Some(err) = err {
            self.record_error(err);
        }
    }
}

/// Profile of an executed plan, with every remote scan expanded into its nodes' plans.
pub fn build_profile(plan: &dyn ExecutionPlan) -> ProfileNode {
    flight::profile::build_profile(plan, &remote_profiles)
}

fn remote_profiles(plan: &dyn ExecutionPlan) -> Option<Vec<RemoteNodeProfile>> {
    let remote = plan.downcast_ref::<RemoteScanExec>()?;
    Some(remote.node_profiles.lock().values().cloned().collect())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::Int32Array;
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::metrics::ExecutionPlanMetricsSet;

    use super::*;

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

    fn batch(rows: i32) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        RecordBatch::try_new(
            schema,
            vec![Arc::new(Int32Array::from_iter_values(0..rows))],
        )
        .unwrap()
    }

    #[test]
    fn test_recorder_tracks_one_node() {
        let profiles = NodeProfiles::default();
        let recorder = NodeProfileRecorder::start(profiles.clone(), 2, &TestNode, 7);
        recorder.record_batch(&batch(3));
        recorder.record_batch(&batch(4));
        recorder.record_scan_stats(&ScanStats {
            files: 5,
            ..Default::default()
        });
        recorder.record_peak_memory(10);
        recorder.record_peak_memory(4);
        recorder.record_error("boom");
        recorder.record_error("boom");
        let mut metrics = vec![
            Metrics::default(),
            Metrics {
                profile: Some(ProfileNode {
                    name: "FilterExec".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ];
        recorder.take_plan(&mut metrics);
        recorder.finish(&RemoteScanMetrics::new(2, &ExecutionPlanMetricsSet::new()));

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
        assert!(metrics[1].profile.is_none());
    }

    #[test]
    fn test_finish_skipped_marks_skip_or_error() {
        let profiles = NodeProfiles::default();
        NodeProfileRecorder::start(profiles.clone(), 0, &TestNode, 0).finish_skipped(None);
        NodeProfileRecorder::start(profiles.clone(), 1, &TestNode, 3).finish_skipped(Some("down"));
        let profiles = profiles.lock();
        assert!(profiles[&0].skipped);
        assert!(!profiles[&1].skipped);
        assert_eq!(profiles[&1].error, "down");
    }
}

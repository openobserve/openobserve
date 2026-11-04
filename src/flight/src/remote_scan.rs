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

//! What the caller of a remote scan tracks about the nodes it calls.

use std::{
    collections::BTreeMap,
    sync::{Arc, atomic::AtomicUsize},
};

use arrow::array::RecordBatch;
use config::{meta::search::ScanStats, utils::record_batch_ext::RecordBatchExt};
use datafusion::physical_plan::metrics::{
    self, ExecutionPlanMetricsSet, MetricBuilder, MetricValue,
};
use parking_lot::Mutex;

use crate::profile::RemoteNodeProfile;

/// Per-partition profiles of one remote scan, keyed by partition.
pub type NodeProfiles = Arc<Mutex<BTreeMap<usize, RemoteNodeProfile>>>;

#[derive(Debug, Clone)]
pub struct RemoteScanMetrics {
    /// Time in nanos to execute child operator and fetch batches
    pub fetch_time: metrics::Time,
    /// Time in nanos to perform decoding
    pub decode_time: metrics::Time,
    /// output rows
    pub output_rows: metrics::Count,
    /// number of RecordBatches received from the remote node
    pub batches_received: metrics::Count,
    /// total in-memory bytes of RecordBatches received; registered as
    /// `MetricValue::OutputBytes` so DataFusion formats it with `human_readable_size`
    /// (e.g. "1.5 GB") rather than `human_readable_count` ("1.57 B" = billion)
    pub bytes_received: metrics::Count,
}

impl RemoteScanMetrics {
    pub fn new(input_partition: usize, metrics: &ExecutionPlanMetricsSet) -> Self {
        let fetch_time = MetricBuilder::new(metrics).subset_time("fetch_time", input_partition);
        let decode_time = MetricBuilder::new(metrics).subset_time("decode_time", input_partition);
        let output_rows = MetricBuilder::new(metrics).output_rows(input_partition);
        let batches_received =
            MetricBuilder::new(metrics).counter("batches_received", input_partition);

        // Register as OutputBytes so the display uses human_readable_size (KB/MB/GB)
        // instead of human_readable_count (K/M/B where B means billion).
        let bytes_received = metrics::Count::new();
        MetricBuilder::new(metrics)
            .with_partition(input_partition)
            .build(MetricValue::OutputBytes(bytes_received.clone()));

        Self {
            fetch_time,
            decode_time,
            output_rows,
            batches_received,
            bytes_received,
        }
    }

    pub fn record_output(&self, batch: &RecordBatch) {
        self.output_rows.add(batch.num_rows());
        self.batches_received.add(1);
        self.bytes_received.add(batch.size());
    }

    /// Average fetch time per batch in milliseconds, or 0 if no batches received.
    pub fn avg_batch_time_ms(&self) -> u64 {
        let batches = self.batches_received.value();
        if batches == 0 {
            return 0;
        }
        // fetch_time.value() is total nanoseconds (usize)
        let total_ns = self.fetch_time.value() as u64;
        total_ns / batches as u64 / 1_000_000
    }
}

/// What a remote scan collects from the nodes it calls, shared by every copy of the scan.
#[derive(Debug, Clone, Default)]
pub struct RemoteScanState {
    pub scan_stats: Arc<Mutex<ScanStats>>,
    pub peak_memory: Arc<AtomicUsize>,
    pub partial_err: Arc<Mutex<String>>,
    /// Filled only for EXPLAIN ANALYZE.
    pub node_profiles: NodeProfiles,
}

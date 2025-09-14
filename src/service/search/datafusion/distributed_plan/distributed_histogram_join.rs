// Copyright 2025 OpenObserve Inc.
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

use std::{
    any::Any,
    collections::HashMap,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{
    array::{Array, RecordBatch, TimestampMicrosecondArray},
    compute,
    datatypes::SchemaRef,
};
use config::meta::cluster::NodeInfo;
use datafusion::{
    common::{DataFusionError, Result, Statistics},
    execution::{RecordBatchStream, SendableRecordBatchStream, TaskContext},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        stream::RecordBatchStreamAdapter,
    },
};
use futures::{Stream, StreamExt};
use hashbrown::HashMap as FastHashMap;
use super::{
    node::RemoteScanNode,
    remote_scan::RemoteScanExec,
    empty_exec::NewEmptyExec,
    histogram_sort_merge_join_exec::HistogramSortMergeJoinExec,
};

// Configuration constants
const MICROSECONDS_PER_SECOND: i64 = 1_000_000;


/// Distributed execution plan that coordinates time-bin sort-merge joins across nodes
#[derive(Debug)]
pub struct DistributedTimeBinJoinExec {
    left_table: String,
    right_table: String,
    left_time_column: String,
    right_time_column: String,
    join_columns: Vec<(String, String)>,
    time_bin_interval: String,
    remote_scan_nodes: RemoteScanNode,
    schema: SchemaRef,
    cache: PlanProperties,
    distributed_strategy: DistributedJoinStrategy,
}

#[derive(Debug, Clone)]
pub enum DistributedJoinStrategy {
    /// Each node processes its local partitions and streams results to coordinator
    LocalProcessing {
        coordinator_node: Arc<dyn NodeInfo>,
        worker_nodes: Vec<Arc<dyn NodeInfo>>,
    },
    /// Data is redistributed by time bins across nodes for parallel processing
    TimePartitioning {
        time_bin_assignment: HashMap<String, Vec<Arc<dyn NodeInfo>>>,
    },
    /// Hybrid approach: local processing first, then coordinator merge
    Hybrid {
        local_timeout_ms: u64,
        coordinator_node: Arc<dyn NodeInfo>,
        worker_nodes: Vec<Arc<dyn NodeInfo>>,
    },
}

impl DistributedTimeBinJoinExec {



}

impl DisplayAs for DistributedTimeBinJoinExec {
    fn fmt_as(&self, t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match t {
            DisplayFormatType::Default | DisplayFormatType::Verbose | DisplayFormatType::TreeRender => {
                write!(
                    f,
                    "DistributedTimeBinJoinExec: left={}, right={}, strategy={:?}",
                    self.left_table,
                    self.right_table,
                    match &self.distributed_strategy {
                        DistributedJoinStrategy::LocalProcessing { .. } => "LocalProcessing",
                        DistributedJoinStrategy::TimePartitioning { .. } => "TimePartitioning", 
                        DistributedJoinStrategy::Hybrid { .. } => "Hybrid",
                    }
                )
            }
        }
    }
}

impl ExecutionPlan for DistributedTimeBinJoinExec {
    fn name(&self) -> &'static str {
        "DistributedTimeBinJoinExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        // No direct children - this coordinates remote execution
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !children.is_empty() {
            return Err(DataFusionError::Internal(
                "DistributedTimeBinJoinExec should not have children".to_string(),
            ));
        }
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        match &self.distributed_strategy {
            DistributedJoinStrategy::LocalProcessing { 
                coordinator_node, 
                worker_nodes 
            } => self.execute_local_processing(partition, context, coordinator_node, worker_nodes),
            
            DistributedJoinStrategy::TimePartitioning { 
                time_bin_assignment 
            } => self.execute_time_partitioning(partition, context, time_bin_assignment),
            
            DistributedJoinStrategy::Hybrid { 
                local_timeout_ms,
                coordinator_node, 
                worker_nodes 
            } => self.execute_hybrid(partition, context, *local_timeout_ms, coordinator_node, worker_nodes),
        }
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema()))
    }
}

impl DistributedTimeBinJoinExec {
    fn execute_local_processing(
        &self,
        _partition: usize,
        _context: Arc<TaskContext>,
        _coordinator_node: &Arc<dyn NodeInfo>,
        worker_nodes: &[Arc<dyn NodeInfo>],
    ) -> Result<SendableRecordBatchStream> {
        // Create remote scan plans for each worker node
        let mut worker_streams = Vec::new();

        for node in worker_nodes {
            // Create a remote execution plan for this worker node  
            let local_join_plan = self.create_local_join_plan(self.remote_scan_nodes.clone())?;
            
            // Create a remote scan exec that will execute on the worker node
            let mut remote_node = self.remote_scan_nodes.clone();
            // Override the nodes to just this single worker
            remote_node.nodes = vec![node.clone()];
            
            let remote_exec = Arc::new(RemoteScanExec::new(
                local_join_plan,
                remote_node,
            )?);

            let stream = remote_exec.execute(_partition, _context.clone())?;
            worker_streams.push(stream);
        }

        // Create a coordinator stream that merges results from all workers
        let coordinator_stream = TimeBinCoordinatorStream::new(
            worker_streams,
            self.time_bin_interval.clone(),
            self.schema(),
        );

        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema(),
            Box::pin(coordinator_stream),
        )))
    }

    fn execute_time_partitioning(
        &self,
        _partition: usize,
        _context: Arc<TaskContext>,
        _time_bin_assignment: &HashMap<String, Vec<Arc<dyn NodeInfo>>>,
    ) -> Result<SendableRecordBatchStream> {
        // TODO: Implement time-partitioned execution
        Err(DataFusionError::NotImplemented(
            "Time partitioning strategy not yet implemented".to_string(),
        ))
    }

    fn execute_hybrid(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
        _local_timeout_ms: u64,
        coordinator_node: &Arc<dyn NodeInfo>,
        worker_nodes: &[Arc<dyn NodeInfo>],
    ) -> Result<SendableRecordBatchStream> {
        // For now, fall back to local processing
        // TODO: Implement proper hybrid strategy with timeouts
        self.execute_local_processing(partition, context, coordinator_node, worker_nodes)
    }

    fn create_local_join_plan(
        &self,
        remote_scan_nodes: RemoteScanNode,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        // Create placeholder execution plans for left and right tables
        // In practice, these would be table scans or more complex subplans
        
        let left_scan = Arc::new(RemoteScanExec::new(
            Arc::new(NewEmptyExec::new(
                &self.left_table,
                self.schema.clone(),
                None,
                &[],
                None,
                false,
                self.schema.clone(),
            )),
            remote_scan_nodes.clone(),
        )?);

        let right_scan = Arc::new(RemoteScanExec::new(
            Arc::new(NewEmptyExec::new(
                &self.right_table,
                self.schema.clone(),
                None,
                &[],
                None,
                false,
                self.schema.clone(),
            )),
            remote_scan_nodes,
        )?);

        // Create the local join execution plan
        let join_exec = HistogramSortMergeJoinExec::new(
            left_scan,
            right_scan,
            self.left_time_column.clone(),
            self.right_time_column.clone(),
            self.join_columns.clone(),
            self.time_bin_interval.clone(),
            None,
        )?;

        Ok(Arc::new(join_exec))
    }
}

/// Stream that coordinates and merges time-binned results from multiple workers
struct TimeBinCoordinatorStream {
    worker_streams: Vec<SendableRecordBatchStream>,
    time_bin_interval: String,
    schema: SchemaRef,
    time_bin_buffers: FastHashMap<i64, Vec<RecordBatch>>,
    worker_exhausted: Vec<bool>,
}

impl TimeBinCoordinatorStream {
    fn new(
        worker_streams: Vec<SendableRecordBatchStream>,
        time_bin_interval: String,
        schema: SchemaRef,
    ) -> Self {
        let num_workers = worker_streams.len();
        Self {
            worker_streams,
            time_bin_interval,
            schema,
            time_bin_buffers: FastHashMap::new(),
            worker_exhausted: vec![false; num_workers],
        }
    }

    fn parse_interval_seconds(&self) -> i64 {
        // Simple interval parsing - same as in TimeBinSortMergeJoinStream
        if self.time_bin_interval.contains("minute") {
            let minutes: i64 = self.time_bin_interval
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(5);
            minutes * 60
        } else if self.time_bin_interval.contains("second") {
            let seconds: i64 = self.time_bin_interval
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(60);
            seconds
        } else {
            300 // Default to 5 minutes
        }
    }

    fn time_bin_for_timestamp(&self, timestamp_micros: i64) -> i64 {
        let interval_seconds = self.parse_interval_seconds();
        let timestamp_seconds = timestamp_micros / MICROSECONDS_PER_SECOND;
        (timestamp_seconds / interval_seconds) * interval_seconds
    }


    fn add_batch_to_time_bins(&mut self, batch: RecordBatch) -> Result<()> {
        // Extract timestamp column
        let time_array = batch
            .column_by_name("_timestamp")
            .ok_or_else(|| DataFusionError::Internal("Timestamp column not found".to_string()))?
            .as_any()
            .downcast_ref::<TimestampMicrosecondArray>()
            .ok_or_else(|| DataFusionError::Internal("Invalid timestamp column type".to_string()))?;

        // Group rows by time bin
        let mut bin_rows: FastHashMap<i64, Vec<usize>> = FastHashMap::new();
        for (row_idx, timestamp_opt) in time_array.iter().enumerate() {
            if let Some(timestamp) = timestamp_opt {
                let time_bin = self.time_bin_for_timestamp(timestamp);
                bin_rows.entry(time_bin).or_default().push(row_idx);
            }
        }

        // Create sub-batches for each time bin
        for (time_bin, row_indices) in bin_rows {
            if !row_indices.is_empty() {
                // Create a batch with only the rows for this time bin
                let sub_batch = self.create_sub_batch(&batch, &row_indices)?;
                self.time_bin_buffers
                    .entry(time_bin)
                    .or_default()
                    .push(sub_batch);
            }
        }

        Ok(())
    }

    fn create_sub_batch(&self, batch: &RecordBatch, row_indices: &[usize]) -> Result<RecordBatch> {
        let mut columns = Vec::new();
        
        for column in batch.columns() {
            // Use arrow's take function to select specific rows
            let indices = arrow::array::UInt32Array::from(
                row_indices.iter().map(|&i| i as u32).collect::<Vec<_>>()
            );
            let taken = compute::take(column.as_ref(), &indices, None)?;
            columns.push(taken);
        }

        Ok(RecordBatch::try_new(batch.schema(), columns)?)
    }

    fn get_next_complete_time_bin(&mut self) -> Option<i64> {
        if self.time_bin_buffers.is_empty() {
            return None;
        }

        // Find the earliest time bin that has data from all workers
        // For simplicity, just return the earliest time bin
        self.time_bin_buffers.keys().min().cloned()
    }

    fn merge_time_bin(&mut self, time_bin: i64) -> Result<RecordBatch> {
        let batches = self.time_bin_buffers.remove(&time_bin).unwrap_or_default();
        
        if batches.is_empty() {
            return Err(DataFusionError::Internal("No batches for time bin".to_string()));
        }

        if batches.len() == 1 {
            return Ok(batches.into_iter().next().unwrap());
        }

        // Concatenate all batches for this time bin
        let batch_refs: Vec<&RecordBatch> = batches.iter().collect();
        let concatenated = arrow::compute::concat_batches(&self.schema, batch_refs.iter().copied())?;
        
        Ok(concatenated)
    }
}

impl Stream for TimeBinCoordinatorStream {
    type Item = Result<RecordBatch>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        // Check if all workers are exhausted
        if self.worker_exhausted.iter().all(|&exhausted| exhausted) {
            return Poll::Ready(None);
        }

        // Collect batches and worker status changes to avoid multiple borrows
        let mut collected_batches = Vec::new();
        let mut exhausted_workers = Vec::new();
        
        // Create a copy of the exhausted state to avoid borrowing issues
        let exhausted_state = self.worker_exhausted.clone();
        
        // Try to collect data from workers that haven't been exhausted
        for (worker_idx, stream) in self.worker_streams.iter_mut().enumerate() {
            if exhausted_state[worker_idx] {
                continue;
            }

            match stream.poll_next_unpin(cx) {
                Poll::Ready(Some(Ok(batch))) => {
                    collected_batches.push(batch);
                }
                Poll::Ready(Some(Err(e))) => {
                    return Poll::Ready(Some(Err(e)));
                }
                Poll::Ready(None) => {
                    exhausted_workers.push(worker_idx);
                }
                Poll::Pending => {
                    // This worker is still producing data, check others
                    continue;
                }
            }
        }
        
        // Now process the collected batches and update worker status
        for batch in collected_batches {
            if let Err(e) = self.add_batch_to_time_bins(batch) {
                return Poll::Ready(Some(Err(e)));
            }
        }
        
        for worker_idx in exhausted_workers {
            self.worker_exhausted[worker_idx] = true;
        }

        // Check if we have a complete time bin to return
        if let Some(time_bin) = self.get_next_complete_time_bin() {
            match self.merge_time_bin(time_bin) {
                Ok(batch) => return Poll::Ready(Some(Ok(batch))),
                Err(e) => return Poll::Ready(Some(Err(e))),
            }
        }

        // If we have more data coming but no complete time bins yet, wait
        if !self.worker_exhausted.iter().all(|&exhausted| exhausted) {
            Poll::Pending
        } else {
            Poll::Ready(None)
        }
    }
}

impl RecordBatchStream for TimeBinCoordinatorStream {
    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow::datatypes::Schema;


    #[test]
    fn test_time_bin_calculation() {
        let coordinator = TimeBinCoordinatorStream {
            worker_streams: Vec::new(),
            time_bin_interval: "5 minutes".to_string(),
            schema: Arc::new(Schema::empty()),
            time_bin_buffers: FastHashMap::new(),
            worker_exhausted: Vec::new(),
        };

        assert_eq!(coordinator.parse_interval_seconds(), 300);
        
        let timestamp_micros = 1000000 * 650; // 650 seconds
        let time_bin = coordinator.time_bin_for_timestamp(timestamp_micros);
        assert_eq!(time_bin, 600); // Should be in the 600-second bin
    }
}
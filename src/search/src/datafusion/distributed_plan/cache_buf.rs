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

use std::{fmt::Debug, sync::Arc};

use arrow::array::RecordBatch;
use datafusion::{common::Result, physical_plan::aggregates::AggregateExec};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::datafusion::aggregates::{
    merge_phase::GroupedHashAggregateStream, no_grouping_merge_phase::AggregateStream,
};

pub(crate) struct CacheStream {
    mode: CacheStreamMode,
    target_partitions: usize,
    aggregate_plan: Arc<AggregateExec>,
    data: Vec<Arc<RecordBatch>>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum CacheStreamMode {
    Group,
    NoGroup,
}

impl CacheStream {
    fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub(crate) fn new(
        has_group_by: bool,
        target_partitions: usize,
        aggregate_plan: Arc<AggregateExec>,
    ) -> Self {
        Self {
            mode: if has_group_by {
                CacheStreamMode::Group
            } else {
                CacheStreamMode::NoGroup
            },
            target_partitions,
            aggregate_plan,
            data: Vec::new(),
        }
    }
}

pub(crate) struct CacheBuf {
    pub(crate) total_partition_num: usize,
    pub(crate) cached_partition_num: usize,
    pub(crate) cached_buf: CacheStream,
}

impl Debug for CacheBuf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CacheBuf")
    }
}

impl CacheBuf {
    pub(crate) fn append_data(&mut self, record_batch: Arc<RecordBatch>) {
        self.cached_buf.data.push(record_batch);
    }

    pub(crate) fn check_and_add_partition(&mut self) -> bool {
        self.cached_partition_num += 1;
        if self.cached_partition_num >= self.total_partition_num {
            return true;
        }
        false
    }

    pub(crate) fn get_final_result(&mut self, stream_id: &str) -> Result<Vec<RecordBatch>> {
        if self.cached_buf.is_empty() {
            return Ok(Vec::new());
        }

        let merge_mode = self.cached_buf.mode;
        let start = std::time::Instant::now();
        let record_batchs = std::mem::take(&mut self.cached_buf.data);
        let record_batchs: Vec<Arc<RecordBatch>> = record_batchs
            .into_iter()
            .filter(|batch| batch.num_rows() != 0)
            .collect();
        let total_batch_len = record_batchs.len();
        let partition_num = std::cmp::max(2, self.cached_buf.target_partitions);

        // When partial_reduce is enabled each follower has already sent pre-merged data, so
        // phase-1 (parallel chunked aggregation) would double-aggregate already-reduced values.
        let partial_reduce_enabled = config::get_config().search.feature_partial_reduce_enabled;

        let mut merged_batches: Vec<RecordBatch> = if partial_reduce_enabled {
            // Phase 1 skipped — use follower results directly.
            record_batchs
                .into_iter()
                .map(|b| b.as_ref().clone())
                .collect()
        } else {
            let thread_pool = rayon::ThreadPoolBuilder::new()
                .num_threads(partition_num)
                .build()
                .unwrap();

            let chunk_size = std::cmp::max(1, total_batch_len / partition_num);
            let batch_chunks: Vec<Vec<Arc<RecordBatch>>> = record_batchs
                .chunks(chunk_size)
                .map(|chunk| chunk.to_vec())
                .collect();

            // Phase 1: process batch_chunks in parallel using rayon
            let partial_results: Vec<Result<Vec<RecordBatch>>> = thread_pool.install(|| {
                batch_chunks
                    .into_par_iter()
                    .map(|batches| match merge_mode {
                        CacheStreamMode::Group => {
                            let mut stream =
                                GroupedHashAggregateStream::new(&self.cached_buf.aggregate_plan)
                                    .unwrap();
                            for batch in batches {
                                stream.group_aggregate_batch(batch.as_ref().clone())?;
                            }
                            stream.get_final_result()
                        }
                        CacheStreamMode::NoGroup => {
                            let mut stream =
                                AggregateStream::new(&self.cached_buf.aggregate_plan).unwrap();
                            for batch in batches {
                                stream.aggregate_batch(batch.as_ref().clone())?;
                            }
                            stream.finalize_aggregation()
                        }
                    })
                    .collect()
            });

            let mut batches = Vec::new();
            for partial_result in partial_results {
                batches.extend(partial_result?);
            }
            batches
        };

        // Phase 2: final merge (always needed when there are multiple batches to combine)
        match merge_mode {
            CacheStreamMode::Group => {
                let mut final_stream =
                    GroupedHashAggregateStream::new(&self.cached_buf.aggregate_plan).unwrap();
                for batch in merged_batches {
                    final_stream.group_aggregate_batch(batch)?;
                }
                merged_batches = final_stream.get_final_result()?;
            }
            CacheStreamMode::NoGroup => {
                let mut final_stream =
                    AggregateStream::new(&self.cached_buf.aggregate_plan).unwrap();
                for batch in merged_batches {
                    final_stream.aggregate_batch(batch)?;
                }
                merged_batches = final_stream.finalize_aggregation()?;
            }
        }

        log::info!(
            "[StreamingAggs streaming_id: {stream_id}] merge_agg_batches from {total_batch_len} to {}, partial_reduce_enabled: {partial_reduce_enabled} unique_numbers: {}, partition_num: {partition_num}, chunk_size: {}, total_merge_times: {} ms",
            merged_batches.len(),
            merged_batches.iter().map(|b| b.num_rows()).sum::<usize>(),
            std::cmp::max(1, total_batch_len / partition_num),
            start.elapsed().as_millis(),
        );

        Ok(merged_batches)
    }
}

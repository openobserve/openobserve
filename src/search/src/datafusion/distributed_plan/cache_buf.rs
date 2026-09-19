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
        self.merge_cached_states(
            stream_id,
            config::get_config().search.feature_partial_reduce_enabled,
        )
    }

    fn merge_cached_states(
        &mut self,
        stream_id: &str,
        partial_reduce_enabled: bool,
    ) -> Result<Vec<RecordBatch>> {
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

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        ipc::{reader::FileReader, writer::FileWriter},
    };
    use datafusion::{
        common::tree_node::TreeNode,
        datasource::{MemTable, memory::MemorySourceConfig},
        physical_plan::{
            ChildrenPropertiesMode, ExecutionPlan, ReplaceChildrenOptions,
            aggregates::AggregateMode, collect,
        },
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::datafusion::optimizer::physical_optimizer::remote_scan::wrap_partial_reduce_for_aggregate;

    fn find_aggregate(plan: &Arc<dyn ExecutionPlan>, partial: bool) -> Arc<AggregateExec> {
        if let Some(agg) = plan.downcast_ref::<AggregateExec>()
            && (*agg.mode() == AggregateMode::Partial) == partial
        {
            return Arc::new(agg.clone());
        }
        for child in plan.children() {
            if child
                .exists(|node| Ok(node.downcast_ref::<AggregateExec>().is_some()))
                .unwrap()
            {
                return find_aggregate(child, partial);
            }
        }
        panic!("expected aggregate in {plan:?}");
    }

    fn sorted_result(batches: &[RecordBatch]) -> Vec<String> {
        let mut rows = batches
            .iter()
            .flat_map(|batch| {
                (0..batch.num_rows()).map(|row| {
                    let values = batch
                        .columns()
                        .iter()
                        .map(|column| {
                            datafusion::common::ScalarValue::try_from_array(column, row).unwrap()
                        })
                        .collect::<Vec<_>>();
                    format!("{values:?}")
                })
            })
            .collect::<Vec<_>>();
        rows.sort();
        rows
    }

    #[tokio::test]
    async fn test_streaming_cache_state_merge_matches_uncached_aggregation() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("g", DataType::Utf8, true),
            Field::new("v", DataType::Int64, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                    Some("a"),
                    Some("b"),
                    Some("a"),
                    None,
                    Some("b"),
                    None,
                    Some("a"),
                    Some("b"),
                ])),
                Arc::new(Int64Array::from(vec![
                    Some(2),
                    Some(4),
                    None,
                    Some(8),
                    Some(4),
                    Some(12),
                    Some(10),
                    None,
                ])),
            ],
        )?;
        let config = SessionConfig::new()
            .with_target_partitions(2)
            .set_bool("datafusion.execution.enable_migration_aggregate", false);
        let ctx = SessionContext::new_with_config(config);
        ctx.register_table(
            "t",
            Arc::new(MemTable::try_new(
                schema,
                vec![vec![batch.slice(0, 3)], vec![batch.slice(3, 5)]],
            )?),
        )?;
        for grouped in [false, true] {
            let query = if grouped {
                "SELECT g, COUNT(*), COUNT(v), SUM(v), AVG(v), MIN(v), MAX(v), COUNT(DISTINCT v), SUM(v) FILTER (WHERE v > 4) FROM t GROUP BY g"
            } else {
                "SELECT COUNT(*), COUNT(v), SUM(v), AVG(v), MIN(v), MAX(v), COUNT(DISTINCT v), SUM(v) FILTER (WHERE v > 4) FROM t"
            };
            let plan = ctx.sql(query).await?.create_physical_plan().await?;
            let expected = collect(plan.clone(), ctx.task_ctx()).await?;
            let final_agg = find_aggregate(&plan, false);
            let partial = find_aggregate(final_agg.input(), true);
            for reduced in [false, true] {
                let input: Arc<dyn ExecutionPlan> = if reduced {
                    wrap_partial_reduce_for_aggregate(true, &partial, partial.clone())?
                } else {
                    partial.clone()
                };
                let states = collect(input, ctx.task_ctx()).await?;
                for cached_prefix in [0, 1, states.len()] {
                    let mut cache = CacheBuf {
                        total_partition_num: 2,
                        cached_partition_num: 0,
                        cached_buf: CacheStream::new(grouped, 2, final_agg.clone()),
                    };
                    for state in &states[..cached_prefix] {
                        cache.append_data(Arc::new(state.clone()));
                    }
                    let merged = cache.merge_cached_states("state-compatibility", reduced)?;
                    let mut bytes = Vec::new();
                    {
                        let mut writer =
                            FileWriter::try_new(&mut bytes, &final_agg.input().schema())?;
                        for batch in &merged {
                            writer.write(batch)?;
                        }
                        writer.finish()?;
                    }
                    let replay = FileReader::try_new(Cursor::new(bytes), None)?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    for state in replay
                        .into_iter()
                        .chain(states[cached_prefix..].iter().cloned())
                    {
                        cache.append_data(Arc::new(state));
                    }
                    let replay = cache.merge_cached_states("state-compatibility", reduced)?;
                    let input = MemorySourceConfig::try_new_exec(
                        &[replay],
                        final_agg.input().schema(),
                        None,
                    )?;
                    let final_plan = final_agg.clone().replace_children(
                        vec![input],
                        ReplaceChildrenOptions::new(ChildrenPropertiesMode::Recompute),
                    )?;
                    let actual = collect(final_plan, ctx.task_ctx()).await?;
                    assert_eq!(
                        sorted_result(&actual),
                        sorted_result(&expected),
                        "grouped={grouped}, reduced={reduced}, cached_prefix={cached_prefix}"
                    );
                }
            }
        }
        Ok(())
    }
}

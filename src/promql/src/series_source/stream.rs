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

//! The hash-sorted producer: shard plans over hash-sorted scans, and the per-shard source that
//! merges a shard's ordered chains one series at a time.

use std::{hash::Hasher, sync::Arc};

use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        plan::generate_plan_string,
        promql::{
            HASH_LABEL, VALUE_LABEL,
            value::{Labels, Sample},
        },
    },
    utils::hash::gxhash,
};
use datafusion::{
    arrow::{
        array::{AsArray, RecordBatch},
        datatypes::{Float64Type, Int64Type, UInt64Type},
    },
    error::{DataFusionError, Result},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_plan::{
        ExecutionPlan, execute_stream, execute_stream_partitioned,
        expressions::Column,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
    prelude::{DataFrame, col, lit},
};
use futures::TryStreamExt;

use super::SeriesSource;
use crate::load_series::{LabelColumn, LabelInterner, batch_run_len};

/// One shard's series source; every chain holds one run per series, so the minimum head hash is the
/// next series.
pub(crate) struct StreamSource {
    cursors: Vec<ChainCursor>,
    group_cols: Arc<Vec<String>>,
    /// One interner per group column, so the emitted series share label allocations.
    interners: Vec<LabelInterner>,
    offset: i64,
    /// Hash of the series `advance` yielded, until `consume` takes it.
    current: Option<u64>,
    samples: Vec<Sample>,
}

impl StreamSource {
    pub(crate) async fn start(
        streams: Vec<SendableRecordBatchStream>,
        group_cols: Arc<Vec<String>>,
        offset: i64,
    ) -> Result<Self> {
        let mut cursors = Vec::with_capacity(streams.len());
        for stream in streams {
            cursors.push(ChainCursor::start(stream).await?);
        }
        let interners = group_cols
            .iter()
            .map(|name| LabelInterner::new(name.clone()))
            .collect();
        Ok(Self {
            cursors,
            group_cols,
            interners,
            offset,
            current: None,
            samples: Vec::new(),
        })
    }

    /// The head batch and row of the first chain holding the current series.
    fn head(&self) -> (&RecordBatch, usize) {
        let hash = self.current.expect("a series is current");
        let cursor = self
            .cursors
            .iter()
            .find(|cursor| cursor.head_hash() == Some(hash))
            .expect("the minimum head hash has a contributing chain");
        let batch = cursor.batch.as_ref().expect("head_hash implies a batch");
        (batch, cursor.row)
    }

    fn label_columns<'a>(&self, batch: &'a RecordBatch) -> Result<Vec<LabelColumn<'a>>> {
        self.group_cols
            .iter()
            .map(|name| {
                LabelColumn::try_from_array(batch[name.as_str()].as_ref()).ok_or_else(|| {
                    DataFusionError::Execution(format!(
                        "label column {name} is not Utf8 or Utf8View"
                    ))
                })
            })
            .collect()
    }
}

impl SeriesSource for StreamSource {
    async fn advance(&mut self) -> Result<Option<u64>> {
        let Some(hash) = self.cursors.iter().filter_map(ChainCursor::head_hash).min() else {
            self.current = None;
            return Ok(None);
        };
        self.current = Some(hash);
        let (batch, row) = self.head();
        let cols = self.label_columns(batch)?;
        let mut hasher = gxhash::new_hasher();
        for (values, name) in cols.iter().zip(self.group_cols.iter()) {
            if !values.is_null(row) {
                hasher.write(name.as_bytes());
                hasher.write(values.value(row).as_bytes());
            }
        }
        Ok(Some(hasher.finish()))
    }

    fn labels(&mut self) -> Labels {
        let (batch, row) = self.head();
        let batch = batch.clone();
        let cols = self
            .label_columns(&batch)
            .expect("advance validated the group columns");
        cols.iter()
            .zip(self.interners.iter_mut())
            .filter(|(values, _)| !values.is_null(row))
            .map(|(values, interner)| interner.intern(values.value(row)))
            .collect()
    }

    async fn consume(&mut self) -> Result<&[Sample]> {
        let hash = self.current.take().expect("advance yielded a series");
        self.samples.clear();
        for cursor in &mut self.cursors {
            if cursor.head_hash() == Some(hash) {
                cursor
                    .consume_run(hash, self.offset, &mut self.samples)
                    .await?;
            }
        }
        // classic parity: chains interleave in time, so restore per-series order
        self.samples.sort_unstable_by_key(|sample| sample.timestamp);
        Ok(&self.samples)
    }
}

/// One hash-ordered chain of non-overlapping files; a series is a single run per chain.
struct ChainCursor {
    stream: SendableRecordBatchStream,
    batch: Option<RecordBatch>,
    row: usize,
}

impl ChainCursor {
    async fn start(stream: SendableRecordBatchStream) -> Result<Self> {
        let mut cursor = Self {
            stream,
            batch: None,
            row: 0,
        };
        cursor.next_batch().await?;
        Ok(cursor)
    }

    fn head_hash(&self) -> Option<u64> {
        let batch = self.batch.as_ref()?;
        Some(batch[HASH_LABEL].as_primitive::<UInt64Type>().values()[self.row])
    }

    async fn next_batch(&mut self) -> Result<()> {
        self.row = 0;
        loop {
            match self.stream.try_next().await? {
                Some(batch) if batch.num_rows() == 0 => continue,
                batch => {
                    self.batch = batch;
                    return Ok(());
                }
            }
        }
    }

    /// Appends this chain's samples of series `hash`, following the run across
    /// batch boundaries until the hash changes or the chain ends.
    async fn consume_run(
        &mut self,
        hash: u64,
        offset: i64,
        samples: &mut Vec<Sample>,
    ) -> Result<()> {
        while let Some(batch) = &self.batch {
            let hashes = batch[HASH_LABEL].as_primitive::<UInt64Type>().values();
            if hashes[self.row] != hash {
                return Ok(());
            }
            let run_len = batch_run_len(hashes, self.row);
            let times = batch[TIMESTAMP_COL_NAME]
                .as_primitive::<Int64Type>()
                .values();
            let values = batch[VALUE_LABEL].as_primitive::<Float64Type>().values();
            samples.extend(
                times[self.row..self.row + run_len]
                    .iter()
                    .zip(&values[self.row..self.row + run_len])
                    .map(|(&timestamp, &value)| Sample::new(timestamp + offset, value)),
            );
            self.row += run_len;
            if self.row < hashes.len() {
                return Ok(());
            }
            self.next_batch().await?;
        }
        Ok(())
    }
}

/// Every shard's ordered input streams; `None` (logged) means a shard's plan cannot stream in
/// order.
pub(crate) async fn build_shard_inputs(
    df: &DataFrame,
    columns: &[&str],
    shards: usize,
    trace_id: &str,
) -> Result<Option<Vec<Vec<SendableRecordBatchStream>>>> {
    let mut shard_inputs = Vec::with_capacity(shards);
    for (shard, (lo, hi)) in hash_shards(shards).into_iter().enumerate() {
        let shard_df = df
            .clone()
            .filter(
                col(HASH_LABEL)
                    .gt_eq(lit(lo))
                    .and(col(HASH_LABEL).lt_eq(lit(hi))),
            )?
            .select_columns(columns)?
            // planning-only: proves the scan partitions hash-ordered; the shard source merges, not the SPM
            .sort(vec![col(HASH_LABEL).sort(true, false)])?;
        let task_ctx = Arc::new(shard_df.task_ctx());
        let plan = shard_df.create_physical_plan().await?;

        // the shards only differ in their hash interval, so one plan speaks for all
        if shard == 0 && config::get_config().common.print_key_sql {
            log::info!("{}", generate_plan_string(trace_id, plan.as_ref()));
        }

        let Some(streams) = shard_streams(plan.clone(), task_ctx)? else {
            log::info!(
                "[trace_id: {trace_id}] [PromQL] streaming fused agg fallback: shard {shard} plan cannot stream in order:\n{}",
                generate_plan_string(trace_id, plan.as_ref())
            );
            return Ok(None);
        };
        shard_inputs.push(streams);
    }
    Ok(Some(shard_inputs))
}

/// Uniform partition of the u64 hash space into `count` inclusive ranges.
fn hash_shards(count: usize) -> Vec<(u64, u64)> {
    let count = count.max(1) as u128;
    let span = (u64::MAX as u128) + 1;
    (0..count)
        .map(|shard| {
            let lo = (span * shard / count) as u64;
            let hi = (span * (shard + 1) / count - 1) as u64;
            (lo, hi)
        })
        .collect()
}

/// The merge node's own child partitions, so the row-level merge itself is never executed.
fn shard_streams(
    plan: Arc<dyn ExecutionPlan>,
    task_ctx: Arc<TaskContext>,
) -> Result<Option<Vec<SendableRecordBatchStream>>> {
    if plan_contains_sort(&plan) {
        return Ok(None);
    }
    // a shard whose pruning dropped every file scans nothing: zero chains
    if plan.properties().output_partitioning().partition_count() == 0 {
        return Ok(Some(vec![]));
    }
    if let Some(merge) = plan.downcast_ref::<SortPreservingMergeExec>() {
        return Ok(Some(execute_stream_partitioned(
            merge.input().clone(),
            task_ctx,
        )?));
    }
    if plan.properties().output_partitioning().partition_count() == 1 && hash_ordered(&plan) {
        return Ok(Some(vec![execute_stream(plan, task_ctx)?]));
    }
    Ok(None)
}

fn plan_contains_sort(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.downcast_ref::<SortExec>().is_some()
        || plan
            .children()
            .iter()
            .any(|child| plan_contains_sort(child))
}

fn hash_ordered(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.properties().output_ordering().is_some_and(|ordering| {
        let sort = ordering.first();
        !sort.options.descending
            && sort
                .expr
                .downcast_ref::<Column>()
                .is_some_and(|column| column.name() == HASH_LABEL)
    })
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        physical_plan::empty::EmptyExec,
    };

    use super::*;

    #[test]
    fn test_shard_streams_empty_scan_yields_zero_chains() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            HASH_LABEL,
            DataType::UInt64,
            false,
        )]));
        let plan = Arc::new(EmptyExec::new(schema).with_partitions(0));
        let streams = shard_streams(plan, Arc::new(TaskContext::default())).unwrap();
        assert_eq!(streams.map(|streams| streams.len()), Some(0));
    }

    #[test]
    fn test_hash_shards_cover_the_full_space_contiguously() {
        for count in [1, 3, 7, 16] {
            let shards = hash_shards(count);
            assert_eq!(shards.len(), count);
            assert_eq!(shards[0].0, 0);
            assert_eq!(shards[count - 1].1, u64::MAX);
            for pair in shards.windows(2) {
                assert_eq!(pair[0].1.wrapping_add(1), pair[1].0);
            }
        }
    }
}

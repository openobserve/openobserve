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

//! Band execution: per-chain cursors, the series-run merge, and the fold of
//! finished series into per-group accumulators merged across bands.

use std::{hash::Hasher, sync::Arc, time::Duration};

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL, VALUE_LABEL,
        value::{EvalContext, ExtrapolationKind, Label, Labels, RangeValue, Sample, Value},
    },
    utils::hash::gxhash,
};
use datafusion::{
    arrow::{
        array::{AsArray, RecordBatch},
        datatypes::{Float64Type, Int64Type, UInt64Type},
    },
    error::{DataFusionError, Result},
    execution::SendableRecordBatchStream,
};
use futures::TryStreamExt;
use hashbrown::{HashMap, hash_map::Entry};
use infra::errors::{Error, ErrorCodes};

use super::super::{accumulator::FusedAccumulator, eval::fold_series, op::FusedAggOp};
use crate::{
    functions::RangeFunc,
    load_series::{LabelColumn, batch_run_len},
};

pub(super) type GroupAccs = HashMap<u64, GroupEntry>;

pub(super) struct FoldParams {
    pub(super) op: FusedAggOp,
    pub(super) func: Arc<dyn RangeFunc>,
    pub(super) counter_kind: Option<ExtrapolationKind>,
    pub(super) range: Duration,
    pub(super) offset: i64,
    pub(super) eval_ctx: EvalContext,
    pub(super) timestamps: Vec<i64>,
    pub(super) group_cols: Vec<String>,
}

pub(super) struct GroupEntry {
    labels: Labels,
    acc: FusedAccumulator,
}

/// One hash-ordered input of a band's merge (a chain of non-overlapping
/// files). All samples of one series sit in a single run per chain.
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

/// Aborts the band tasks when `timeout` elapses before they all finish.
pub(super) async fn run_bands(
    band_inputs: Vec<Vec<SendableRecordBatchStream>>,
    params: Arc<FoldParams>,
    timeout: u64,
) -> Result<Vec<(GroupAccs, usize)>> {
    let mut tasks = Vec::with_capacity(band_inputs.len());
    let mut abort_handles = Vec::with_capacity(band_inputs.len());
    for streams in band_inputs {
        let task = tokio::task::spawn(fold_band(streams, params.clone()));
        abort_handles.push(task.abort_handle());
        tasks.push(task);
    }
    tokio::select! {
        joined = futures::future::try_join_all(tasks) => {
            joined
                .map_err(|e| DataFusionError::Execution(e.to_string()))?
                .into_iter()
                .collect()
        }
        _ = tokio::time::sleep(Duration::from_secs(timeout)) => {
            for handle in abort_handles {
                handle.abort();
            }
            Err(DataFusionError::Plan(
                Error::ErrorCode(ErrorCodes::SearchTimeout(
                    "[PromQL] streaming fused agg timeout".to_string(),
                ))
                .to_string(),
            ))
        }
    }
}

/// Merges the band's chains one series at a time: a series is one run per
/// chain, so the merge costs one round of cursor checks per series instead of
/// one heap operation per row.
async fn fold_band(
    streams: Vec<SendableRecordBatchStream>,
    params: Arc<FoldParams>,
) -> Result<(GroupAccs, usize)> {
    let mut groups = GroupAccs::new();
    let mut cursors = Vec::with_capacity(streams.len());
    for stream in streams {
        cursors.push(ChainCursor::start(stream).await?);
    }
    let mut samples: Vec<Sample> = Vec::new();
    let mut series_count = 0;
    while let Some(hash) = cursors.iter().filter_map(ChainCursor::head_hash).min() {
        samples.clear();
        let mut key = None;
        for cursor in &mut cursors {
            if cursor.head_hash() != Some(hash) {
                continue;
            }
            if key.is_none() {
                let batch = cursor.batch.as_ref().expect("head_hash implies a batch");
                key = Some(group_key_at(batch, cursor.row, &params, &groups)?);
            }
            cursor
                .consume_run(hash, params.offset, &mut samples)
                .await?;
        }
        let (sig, labels) = key.expect("the minimum head hash has a contributing chain");
        // classic parity: chains interleave in time, so restore per-series order
        samples.sort_unstable_by_key(|sample| sample.timestamp);
        let entry = match groups.entry(sig) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(GroupEntry {
                labels: labels.unwrap_or_default(),
                acc: FusedAccumulator::new(params.op, params.timestamps.len()),
            }),
        };
        fold_series(
            &mut entry.acc,
            &samples,
            params.range,
            params.func.as_ref(),
            params.counter_kind,
            &params.eval_ctx,
            &params.timestamps,
        );
        series_count += 1;
    }
    Ok((groups, series_count))
}

fn group_key_at(
    batch: &RecordBatch,
    row: usize,
    params: &FoldParams,
    groups: &GroupAccs,
) -> Result<(u64, Option<Labels>)> {
    let label_cols = params
        .group_cols
        .iter()
        .map(|name| {
            LabelColumn::try_from_array(batch[name.as_str()].as_ref()).ok_or_else(|| {
                DataFusionError::Execution(format!("label column {name} is not Utf8 or Utf8View"))
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let sig = group_signature(&label_cols, &params.group_cols, row);
    let labels = (!groups.contains_key(&sig))
        .then(|| materialize_labels(&label_cols, &params.group_cols, row));
    Ok((sig, labels))
}

fn group_signature(cols: &[LabelColumn<'_>], names: &[String], row: usize) -> u64 {
    let mut hasher = gxhash::new_hasher();
    for (values, name) in cols.iter().zip(names) {
        if !values.is_null(row) {
            hasher.write(name.as_bytes());
            hasher.write(values.value(row).as_bytes());
        }
    }
    hasher.finish()
}

fn materialize_labels(cols: &[LabelColumn<'_>], names: &[String], row: usize) -> Labels {
    cols.iter()
        .zip(names)
        .filter(|(values, _)| !values.is_null(row))
        .map(|(values, name)| Arc::new(Label::new(name.as_str(), values.value(row))))
        .collect()
}

/// Merges the band-local groups in band order and materializes the result;
/// groups whose accumulator produced no samples are dropped like the
/// materializing path drops no-output series.
pub(super) fn merge_folds(folds: Vec<GroupAccs>, timestamps: &[i64]) -> Value {
    let mut folds = folds.into_iter();
    let Some(mut merged) = folds.next() else {
        return Value::None;
    };
    for fold in folds {
        for (sig, entry) in fold {
            match merged.entry(sig) {
                Entry::Occupied(mut occupied) => occupied.get_mut().acc.merge(entry.acc),
                Entry::Vacant(vacant) => {
                    vacant.insert(entry);
                }
            }
        }
    }
    let results: Vec<RangeValue> = merged
        .into_values()
        .filter_map(|entry| {
            let samples = entry.acc.into_samples(timestamps);
            if samples.is_empty() {
                return None;
            }
            Some(RangeValue {
                labels: entry.labels,
                samples,
                exemplars: None,
                time_window: None,
            })
        })
        .collect();
    if results.is_empty() {
        Value::None
    } else {
        Value::Matrix(results)
    }
}

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

//! The single fused fold: every series source partition folds its series into
//! per-group accumulators, and the partitions merge in order at the end. The
//! producers only decide how series arrive; the aggregation lives here once.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::{
    CounterSeries, EvalContext, ExtrapolationKind, Labels, RangeValue, Sample, Value,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::{HashMap, hash_map::Entry};
use infra::errors::{Error, ErrorCodes};

use super::{accumulator::FusedAccumulator, op::FusedAggOp};
use crate::{
    functions::{RangeFunc, advance_sample_window},
    micros,
    series_stream::SeriesSource,
};

pub(super) type GroupAccs = HashMap<u64, GroupEntry>;

pub(super) struct FoldParams {
    pub(super) op: FusedAggOp,
    pub(super) func: Arc<dyn RangeFunc>,
    pub(super) counter_kind: Option<ExtrapolationKind>,
    pub(super) range: Duration,
    pub(super) eval_ctx: EvalContext,
    pub(super) timestamps: Vec<i64>,
}

pub(super) struct GroupEntry {
    labels: Labels,
    acc: FusedAccumulator,
}

/// Folds one partition's series into its group accumulators, dropping each
/// series as soon as it is folded.
pub(super) async fn fold_partition<S: SeriesSource>(
    mut source: S,
    params: Arc<FoldParams>,
) -> Result<(GroupAccs, usize)> {
    let mut groups = GroupAccs::new();
    let mut series_count = 0;
    while let Some(sig) = source.advance().await? {
        let entry = match groups.entry(sig) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(GroupEntry {
                labels: source.labels(),
                acc: FusedAccumulator::new(params.op, params.timestamps.len()),
            }),
        };
        let samples = source.consume().await?;
        fold_series(
            &mut entry.acc,
            samples,
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

/// Evaluates `func` over one series' time-ordered samples and pushes each
/// produced value into `acc` at its evaluation slot.
fn fold_series(
    acc: &mut FusedAccumulator,
    samples: &[Sample],
    range: Duration,
    func: &dyn RangeFunc,
    counter_kind: Option<ExtrapolationKind>,
    eval_ctx: &EvalContext,
    timestamps: &[i64],
) {
    let range_micros = micros(range);
    let mut start_index = 0;
    let mut end_index = 0;
    let counter = CounterSeries::try_new(samples, counter_kind, eval_ctx, range_micros);

    for (slot, &eval_ts) in timestamps.iter().enumerate() {
        let window_samples = advance_sample_window(
            samples,
            eval_ts - range_micros,
            eval_ts,
            &mut start_index,
            &mut end_index,
        );
        if window_samples.is_empty() {
            continue;
        }
        let value = match &counter {
            Some(counter) => counter.extrapolate(start_index, end_index, eval_ts, range),
            None => func.exec(window_samples, eval_ts, &range),
        };
        if let Some(value) = value {
            acc.push(slot, value);
        }
    }
}

/// Aborts the partition folds when `timeout` elapses before they all finish.
pub(super) async fn run_folds<Fut>(folds: Vec<Fut>, timeout: u64) -> Result<Vec<(GroupAccs, usize)>>
where
    Fut: Future<Output = Result<(GroupAccs, usize)>> + Send + 'static,
{
    let mut tasks = Vec::with_capacity(folds.len());
    let mut abort_handles = Vec::with_capacity(folds.len());
    for fold in folds {
        let task = tokio::task::spawn(fold);
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
                    "[PromQL] fused agg timeout".to_string(),
                ))
                .to_string(),
            ))
        }
    }
}

/// Merges the partition-local groups in partition order and materializes the
/// result; groups whose accumulator produced no samples are dropped like the
/// generic path drops no-output series.
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

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

//! The single fused fold: every series stream partition folds its series into
//! per-group accumulators, and the partitions merge in order at the end. The
//! producers only decide how series arrive; the aggregation lives here once.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::{
    CounterSeries, EvalContext, ExtrapolationKind, Labels, RangeValue, Sample, TimeWindow, Value,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::{HashMap, hash_map::Entry};
use tokio::task::JoinSet;

use super::{accumulator::FusedAccumulator, op::FusedAggOp};
use crate::{
    functions::{RangeFunc, advance_sample_window},
    micros,
    series_stream::SeriesStream,
};

pub(super) type GroupAccs = HashMap<u64, GroupEntry>;

pub(super) struct GroupEntry {
    labels: Labels,
    acc: FusedAccumulator,
}

/// How one series becomes per-step values: the range function, its window, and the slots.
pub(crate) struct SeriesEval {
    pub(crate) func: Arc<dyn RangeFunc>,
    counter_kind: Option<ExtrapolationKind>,
    pub(crate) range: Duration,
    pub(crate) eval_ctx: EvalContext,
    pub(crate) timestamps: Vec<i64>,
}

impl SeriesEval {
    pub(crate) fn new(func: Arc<dyn RangeFunc>, range: Duration, eval_ctx: &EvalContext) -> Self {
        Self {
            counter_kind: func.counter_extrapolation(),
            func,
            range,
            eval_ctx: eval_ctx.clone(),
            timestamps: eval_ctx.timestamps(),
        }
    }

    /// Evaluates the function over one series, handing each value to `emit` with its slot.
    fn eval_series(&self, samples: &[Sample], mut emit: impl FnMut(usize, f64)) {
        let range_micros = micros(self.range);
        let mut start_index = 0;
        let mut end_index = 0;
        let counter =
            CounterSeries::try_new(samples, self.counter_kind, &self.eval_ctx, range_micros);

        for (slot, &eval_ts) in self.timestamps.iter().enumerate() {
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
                Some(counter) => counter.extrapolate(start_index, end_index, eval_ts, self.range),
                None => self.func.exec(window_samples, eval_ts, &self.range),
            };
            if let Some(value) = value {
                emit(slot, value);
            }
        }
    }
}

/// Folds all partitions concurrently and merges their groups; each source opens inside its own
/// task, and dropping the future aborts them all.
pub(super) async fn fold_sources<F, S>(
    sources: Vec<F>,
    op: FusedAggOp,
    eval: Arc<SeriesEval>,
) -> Result<(Value, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let folds = sources
        .into_iter()
        .map(|source| {
            let eval = eval.clone();
            async move { fold_partition(source.await?, op, eval).await }
        })
        .collect();
    let folds = run_partitions(folds).await?;
    let series_count = folds.iter().map(|(_, series)| series).sum();
    let value = merge_folds(
        folds.into_iter().map(|(groups, _)| groups).collect(),
        &eval.timestamps,
    );
    Ok((value, series_count))
}

/// Evaluates every partition's series and returns them whole, in partition order; dropping the
/// future aborts the partitions.
pub(crate) async fn emit_sources<F, S>(
    sources: Vec<F>,
    eval: Arc<SeriesEval>,
) -> Result<(Vec<RangeValue>, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let start_time = std::time::Instant::now();
    let func_name = eval.func.name();
    let trace_id = eval.eval_ctx.trace_id.clone();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() started with {} shards",
        sources.len(),
    );
    let parts = sources
        .into_iter()
        .map(|source| {
            let eval = eval.clone();
            async move { emit_partition(source.await?, eval).await }
        })
        .collect();
    let parts = run_partitions(parts).await?;
    let series_count: usize = parts.iter().map(|(_, series)| series).sum();
    let series: Vec<RangeValue> = parts.into_iter().flat_map(|(series, _)| series).collect();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() execution took: {:?}, emitted {} of {series_count} series",
        start_time.elapsed(),
        series.len(),
    );
    Ok((series, series_count))
}

/// Emits one partition's series; like the generic evaluator, a series with no value is dropped.
async fn emit_partition<S: SeriesStream>(
    mut source: S,
    eval: Arc<SeriesEval>,
) -> Result<(Vec<RangeValue>, usize)> {
    let mut series = Vec::new();
    let mut series_count = 0;
    while source.advance().await?.is_some() {
        let labels = source.labels();
        let samples = source.consume().await?;
        let mut values = Vec::with_capacity(eval.timestamps.len());
        eval.eval_series(samples, |slot, value| {
            values.push(Sample::new(eval.timestamps[slot], value));
        });
        if !values.is_empty() {
            series.push(RangeValue {
                labels,
                samples: values,
                exemplars: None,
                time_window: Some(TimeWindow::new(eval.range)),
            });
        }
        series_count += 1;
        tokio::task::consume_budget().await;
    }
    Ok((series, series_count))
}

/// Folds one partition's series into its group accumulators, dropping each as it goes.
async fn fold_partition<S: SeriesStream>(
    mut source: S,
    op: FusedAggOp,
    eval: Arc<SeriesEval>,
) -> Result<(GroupAccs, usize)> {
    let mut groups = GroupAccs::new();
    let mut series_count = 0;
    while let Some(sig) = source.advance().await? {
        let entry = match groups.entry(sig) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(GroupEntry {
                labels: source.labels(),
                acc: FusedAccumulator::new(op, eval.timestamps.len()),
            }),
        };
        let samples = source.consume().await?;
        eval.eval_series(samples, |slot, value| entry.acc.push(slot, value));
        series_count += 1;
        // the fold is pure CPU: give the runtime a chance to time out or abort it
        tokio::task::consume_budget().await;
    }
    Ok((groups, series_count))
}

/// The first failed partition fails the whole; dropping the set aborts the rest.
async fn run_partitions<T, Fut>(parts: Vec<Fut>) -> Result<Vec<T>>
where
    T: Send + 'static,
    Fut: Future<Output = Result<T>> + Send + 'static,
{
    let mut results: Vec<Option<T>> = parts.iter().map(|_| None).collect();
    let mut tasks = JoinSet::new();
    for (index, part) in parts.into_iter().enumerate() {
        tasks.spawn(async move { (index, part.await) });
    }
    // partitions finish in any order; the merge needs them in partition order
    while let Some(joined) = tasks.join_next().await {
        let (index, part) = joined.map_err(|e| DataFusionError::Execution(e.to_string()))?;
        results[index] = Some(part?);
    }
    Ok(results
        .into_iter()
        .map(|part| part.expect("every partition joined"))
        .collect())
}

/// Merges the partition groups in partition order; groups without output are dropped like the
/// generic path.
fn merge_folds(folds: Vec<GroupAccs>, timestamps: &[i64]) -> Value {
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

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };

    use config::meta::promql::value::{Labels, Sample};

    use super::*;
    use crate::functions;

    /// Errors on its first series.
    struct FailingStream;

    impl SeriesStream for FailingStream {
        async fn advance(&mut self) -> Result<Option<u64>> {
            Err(DataFusionError::Execution("partition failed".into()))
        }
        fn labels(&mut self) -> Labels {
            Labels::default()
        }
        async fn consume(&mut self) -> Result<&[Sample]> {
            Ok(&[])
        }
    }

    /// Yields series forever; `finished` records whether it ever returned.
    struct EndlessStream {
        samples: Vec<Sample>,
        finished: Arc<AtomicBool>,
    }

    impl SeriesStream for EndlessStream {
        async fn advance(&mut self) -> Result<Option<u64>> {
            Ok(Some(1))
        }
        fn labels(&mut self) -> Labels {
            Labels::default()
        }
        async fn consume(&mut self) -> Result<&[Sample]> {
            Ok(&self.samples)
        }
    }

    impl Drop for EndlessStream {
        fn drop(&mut self) {
            self.finished.store(true, Ordering::SeqCst);
        }
    }

    fn eval() -> Arc<SeriesEval> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func("rate").unwrap());
        let eval_ctx = EvalContext::new(1_000_000, 2_000_000, 1_000_000, "test".into());
        Arc::new(SeriesEval::new(func, Duration::from_secs(60), &eval_ctx))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_run_folds_fails_fast_and_aborts_the_rest() {
        let eval = eval();
        let dropped = Arc::new(AtomicBool::new(false));
        let endless = EndlessStream {
            samples: vec![Sample::new(1_500_000, 1.0)],
            finished: dropped.clone(),
        };
        let failing = FailingStream;
        let folds = vec![
            Box::pin(fold_partition(endless, FusedAggOp::Sum, eval.clone()))
                as std::pin::Pin<Box<dyn Future<Output = Result<(GroupAccs, usize)>> + Send>>,
            Box::pin(fold_partition(failing, FusedAggOp::Sum, eval)),
        ];

        let start = std::time::Instant::now();
        let result = run_partitions(folds).await;
        assert!(result.is_err(), "the failed partition must fail the fold");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "must not wait for the endless partition"
        );

        // the aborted task drops its source at its next yield point
        for _ in 0..100 {
            if dropped.load(Ordering::SeqCst) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the endless partition was not aborted");
    }
}

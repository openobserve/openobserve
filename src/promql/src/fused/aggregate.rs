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

//! The fused aggregate: every partition folds its series into per-group accumulators (partial),
//! and the partitions merge in order at the end (final). The streams only decide how series
//! arrive; the aggregation lives here once.

use std::sync::Arc;

use config::meta::promql::value::{Labels, RangeValue, Value};
use datafusion::error::Result;
use hashbrown::{HashMap, hash_map::Entry};

use super::{
    accumulator::FusedAccumulator, collect_partitioned, op::FusedAggOp, range_expr::RangeExpr,
};
use crate::series_stream::SeriesStream;

pub(super) type GroupAccs = HashMap<u64, GroupEntry>;

pub(super) struct GroupEntry {
    labels: Labels,
    acc: FusedAccumulator,
}

/// Aggregates every partition, partial then final; each source opens inside its own task, and
/// dropping the future aborts them all.
pub(crate) async fn aggregate<F, S>(
    sources: Vec<F>,
    op: FusedAggOp,
    eval: Arc<RangeExpr>,
) -> Result<(Value, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let start_time = std::time::Instant::now();
    let func_name = eval.func.name();
    let trace_id = eval.eval_ctx.trace_id.clone();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) started with {} partitions",
        op.name(),
        sources.len(),
    );
    let folds = sources
        .into_iter()
        .map(|source| {
            let eval = eval.clone();
            async move { aggregate_partial(source.await?, op, eval).await }
        })
        .collect();
    let folds = collect_partitioned(folds).await?;
    let series_count = folds.iter().map(|(_, series)| series).sum();
    let value = aggregate_final(
        folds.into_iter().map(|(groups, _)| groups).collect(),
        &eval.timestamps,
    );
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) execution took: {:?}, folded {series_count} series into {} series",
        op.name(),
        start_time.elapsed(),
        match &value {
            Value::Matrix(matrix) => matrix.len(),
            _ => 0,
        },
    );
    Ok((value, series_count))
}

/// The partial aggregate of one partition: its series folded into group accumulators, each
/// dropped as it goes.
async fn aggregate_partial<S: SeriesStream>(
    mut source: S,
    op: FusedAggOp,
    eval: Arc<RangeExpr>,
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
        eval.evaluate(samples, |slot, value| entry.acc.push(slot, value));
        series_count += 1;
        // the fold is pure CPU: give the runtime a chance to time out or abort it
        tokio::task::consume_budget().await;
    }
    Ok((groups, series_count))
}

/// The final aggregate: partial groups merged in partition order, groups without output dropped
/// like the generic path.
fn aggregate_final(folds: Vec<GroupAccs>, timestamps: &[i64]) -> Value {
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

    use config::meta::promql::value::{EvalContext, Labels, Sample};
    use datafusion::error::DataFusionError;

    use super::*;
    use crate::functions::{self, RangeFunc};

    /// Errors on its first series.
    struct FailingStream;

    impl SeriesStream for FailingStream {
        async fn advance(&mut self) -> Result<Option<u64>> {
            Err(DataFusionError::Execution("source failed".into()))
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

    fn eval() -> Arc<RangeExpr> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func("rate").unwrap());
        let eval_ctx = EvalContext::new(1_000_000, 2_000_000, 1_000_000, "test".into());
        Arc::new(RangeExpr::new(func, Duration::from_secs(60), &eval_ctx))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_collect_partitioned_fails_fast_and_aborts_the_rest() {
        let eval = eval();
        let dropped = Arc::new(AtomicBool::new(false));
        let endless = EndlessStream {
            samples: vec![Sample::new(1_500_000, 1.0)],
            finished: dropped.clone(),
        };
        let failing = FailingStream;
        let folds = vec![
            Box::pin(aggregate_partial(endless, FusedAggOp::Sum, eval.clone()))
                as std::pin::Pin<Box<dyn Future<Output = Result<(GroupAccs, usize)>> + Send>>,
            Box::pin(aggregate_partial(failing, FusedAggOp::Sum, eval)),
        ];

        let start = std::time::Instant::now();
        let result = collect_partitioned(folds).await;
        assert!(result.is_err(), "the failed source must fail the fold");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "must not wait for the endless source"
        );

        // the aborted task drops its source at its next yield point
        for _ in 0..100 {
            if dropped.load(Ordering::SeqCst) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the endless source was not aborted");
    }
}

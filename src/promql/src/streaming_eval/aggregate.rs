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
    accumulator::{FusedAccumulator, FusedAggOp},
    collect_partitioned,
    range_expr::RangeExpr,
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

    use config::meta::promql::value::{EvalContext, Label, Labels, Sample, TimeWindow};
    use datafusion::error::DataFusionError;
    use promql_parser::parser::LabelModifier;

    use super::{super::tests::*, *};
    use crate::{
        aggregations,
        functions::{self, RangeFunc},
        series_stream::matrix::{MATRIX_PARTITION_CHUNK, group_sources},
    };

    type GenericAgg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;

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

    fn make_series(name: &str, instance: &str, path: &str, points: &[(i64, f64)]) -> RangeValue {
        RangeValue {
            labels: vec![
                Arc::new(Label::new("__name__", name)),
                Arc::new(Label::new("instance", instance)),
                Arc::new(Label::new("path", path)),
            ],
            samples: points
                .iter()
                .map(|&(timestamp, value)| Sample::new(BASE + timestamp * SECOND, value))
                .collect(),
            exemplars: None,
            time_window: Some(TimeWindow::new(Duration::from_secs(60))),
        }
    }

    fn test_matrix() -> Vec<RangeValue> {
        let dense = [10, 50, 70, 110, 130, 170];
        let zip = |values: [f64; 6]| dense.into_iter().zip(values).collect::<Vec<_>>();
        vec![
            make_series(
                "requests_total",
                "a",
                "/one",
                &zip([0.1, 40.7, 45.2, 85.9, 90.4, 130.8]),
            ),
            make_series(
                "requests_total",
                "b",
                "/one",
                &zip([0.3, 80.1, 90.6, 170.2, 180.9, 260.5]),
            ),
            // Contains a counter reset (25.1 -> 3.4) to exercise the
            // reset-prefix path in both evaluators.
            make_series(
                "requests_total",
                "c",
                "/two",
                &zip([0.2, 20.4, 25.1, 3.4, 50.3, 70.9]),
            ),
            // Samples only in the last window: earlier slots stay empty.
            make_series("other_total", "a", "/two", &[(130, 7.5), (170, 11.25)]),
            // All samples precede every window: generic drops this series and its `/zzz` group.
            make_series("stale_total", "z", "/zzz", &[(-100, 1.0), (-50, 2.0)]),
        ]
    }

    /// The generic evaluator over the same table the fused path resolves names through.
    fn range_eval(name: &str, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
        functions::eval_range(data, functions::fusable_range_func(name).unwrap(), eval_ctx)
    }

    async fn run_materialized(
        modifier: &Option<LabelModifier>,
        matrix: Vec<RangeValue>,
        func_name: &str,
        op: FusedAggOp,
        eval_ctx: &EvalContext,
    ) -> Result<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let (sources, range) = group_sources(Value::Matrix(matrix), modifier, func_name)?
            .expect("the test matrix is not empty");
        let eval = Arc::new(RangeExpr::new(func, range, eval_ctx));
        aggregate(sources, op, eval).await.map(|(value, _)| value)
    }

    #[tokio::test]
    async fn test_fused_range_agg_matches_generic_for_all_pairs() {
        let agg_cases: [(FusedAggOp, GenericAgg); 8] = [
            (FusedAggOp::Avg, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Avg, eval_ctx)
            }),
            (FusedAggOp::Count, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Count, eval_ctx)
            }),
            (FusedAggOp::Group, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Group, eval_ctx)
            }),
            (FusedAggOp::Max, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Max, eval_ctx)
            }),
            (FusedAggOp::Min, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Min, eval_ctx)
            }),
            (FusedAggOp::Stddev, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Stddev, eval_ctx)
            }),
            (FusedAggOp::Stdvar, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Stdvar, eval_ctx)
            }),
            (FusedAggOp::Sum, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Sum, eval_ctx)
            }),
        ];
        let range_cases = [
            "avg_over_time",
            "changes",
            "count_over_time",
            "delta",
            "deriv",
            "idelta",
            "increase",
            "irate",
            "last_over_time",
            "max_over_time",
            "min_over_time",
            "rate",
            "resets",
            "stddev_over_time",
            "stdvar_over_time",
            "sum_over_time",
        ];
        let modifiers = [
            None,
            by(&["path"]),
            by(&["__name__"]),
            without(&["instance"]),
        ];

        let eval_ctx = eval_ctx();
        let matrix = test_matrix();
        for (op, generic_agg) in agg_cases {
            for func_name in range_cases {
                for modifier in &modifiers {
                    let generic_input =
                        range_eval(func_name, Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                    let expected = generic_agg(modifier, generic_input, &eval_ctx).unwrap();

                    let actual =
                        run_materialized(modifier, matrix.clone(), func_name, op, &eval_ctx)
                            .await
                            .unwrap();

                    assert_eq!(
                        canonical_matrix(expected),
                        canonical_matrix(actual),
                        "fused {}({func_name}) diverged from generic (modifier: {modifier:?})",
                        op.name(),
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_fused_chunked_large_group_matches_generic_and_is_deterministic() {
        let eval_ctx = eval_ctx();
        // Ungrouped and per-`by(path)` folds both cross the partition threshold;
        // integer values keep float ops exact, so results must match generic bits.
        let series_count = 2 * (2 * MATRIX_PARTITION_CHUNK) + 100;
        let matrix = (0..series_count)
            .map(|i| {
                let value = (i % 97) as f64;
                let path = if i % 2 == 0 { "/one" } else { "/two" };
                make_series(
                    "requests_total",
                    &format!("host-{i}"),
                    path,
                    &[10, 50, 70, 110, 130, 170]
                        .into_iter()
                        .enumerate()
                        .map(|(n, timestamp)| (timestamp, value + n as f64))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();

        let agg_cases: [(FusedAggOp, GenericAgg); 8] = [
            (FusedAggOp::Avg, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Avg, eval_ctx)
            }),
            (FusedAggOp::Count, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Count, eval_ctx)
            }),
            (FusedAggOp::Group, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Group, eval_ctx)
            }),
            (FusedAggOp::Max, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Max, eval_ctx)
            }),
            (FusedAggOp::Min, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Min, eval_ctx)
            }),
            (FusedAggOp::Stddev, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Stddev, eval_ctx)
            }),
            (FusedAggOp::Stdvar, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Stdvar, eval_ctx)
            }),
            (FusedAggOp::Sum, |modifier, input, eval_ctx| {
                aggregations::eval_aggregate(modifier, input, aggregations::Sum, eval_ctx)
            }),
        ];
        for (op, generic_agg) in agg_cases {
            for modifier in [None, by(&["path"])] {
                let generic_input =
                    range_eval("sum_over_time", Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                let expected = generic_agg(&modifier, generic_input, &eval_ctx).unwrap();
                let first = canonical_matrix(
                    run_materialized(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
                        .await
                        .unwrap(),
                );
                assert_eq!(
                    canonical_matrix(expected),
                    first,
                    "chunked fused {}(sum_over_time) diverged from generic (modifier: {modifier:?})",
                    op.name(),
                );
                let second = canonical_matrix(
                    run_materialized(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
                        .await
                        .unwrap(),
                );
                assert_eq!(
                    first,
                    second,
                    "chunked fused {}(sum_over_time) must be deterministic",
                    op.name(),
                );
            }
        }
    }

    #[tokio::test]
    async fn test_fused_chunked_float_values_stay_within_epsilon_of_generic() {
        let eval_ctx = eval_ctx();
        // Above the partition threshold fused folds in partitions while generic
        // is sequential; Kahan is non-associative, so fractional sums may drift
        // in the last bits but never materially.
        let series_count = 2 * MATRIX_PARTITION_CHUNK + 500;
        let matrix = (0..series_count)
            .map(|i| {
                let base = (i % 97) as f64 * 0.1;
                make_series(
                    "requests_total",
                    &format!("host-{i}"),
                    "/one",
                    &[10, 50, 70, 110, 130, 170]
                        .into_iter()
                        .enumerate()
                        .map(|(n, timestamp)| (timestamp, base + n as f64 * 0.7))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();

        for (op, generic_agg) in [
            (
                FusedAggOp::Sum,
                (|modifier, input, eval_ctx| {
                    aggregations::eval_aggregate(modifier, input, aggregations::Sum, eval_ctx)
                }) as GenericAgg,
            ),
            (
                FusedAggOp::Avg,
                (|modifier, input, eval_ctx| {
                    aggregations::eval_aggregate(modifier, input, aggregations::Avg, eval_ctx)
                }) as GenericAgg,
            ),
        ] {
            let generic_input =
                range_eval("rate", Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
            let expected = canonical_matrix(generic_agg(&None, generic_input, &eval_ctx).unwrap());
            let actual = canonical_matrix(
                run_materialized(&None, matrix.clone(), "rate", op, &eval_ctx)
                    .await
                    .unwrap(),
            );

            assert_eq!(expected.len(), actual.len());
            for (expected, actual) in expected.iter().zip(&actual) {
                assert_eq!(expected.0, actual.0);
                assert_eq!(expected.1.len(), actual.1.len());
                for (&(expected_ts, expected_bits), &(actual_ts, actual_bits)) in
                    expected.1.iter().zip(&actual.1)
                {
                    assert_eq!(expected_ts, actual_ts);
                    let expected_value = f64::from_bits(expected_bits);
                    let actual_value = f64::from_bits(actual_bits);
                    assert!(expected_value.is_finite() && actual_value.is_finite());
                    let tolerance = expected_value.abs().max(actual_value.abs()) * 1e-12;
                    assert!(
                        (expected_value - actual_value).abs() <= tolerance,
                        "fused {}(rate) diverged beyond epsilon: {expected_value} vs {actual_value}",
                        op.name(),
                    );
                }
            }
        }
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

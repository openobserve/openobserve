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

use super::{evaluate_partitions, range_expr::RangeExpr};
use crate::{
    aggregations::{
        Accumulate, AggFunc, AggOp, Avg, Count, Group, Max, Min, Rank, Stddev, Stdvar, Sum,
    },
    series_stream::SeriesStream,
};

pub(super) type GroupAccs<A> = HashMap<u64, GroupEntry<A>>;

pub(super) struct GroupEntry<A> {
    labels: Labels,
    acc: A,
}

/// Aggregates every partition, partial then final; each source opens inside its own task, and
/// dropping the future aborts them all.
pub(crate) async fn aggregate<F, S>(
    sources: Vec<F>,
    op: AggOp,
    eval: Arc<RangeExpr>,
) -> Result<(Value, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    match op {
        AggOp::Avg => aggregate_with(sources, Avg, eval).await,
        AggOp::Bottomk(k) => aggregate_with(sources, Rank::new(k, true), eval).await,
        AggOp::Count => aggregate_with(sources, Count, eval).await,
        AggOp::Group => aggregate_with(sources, Group, eval).await,
        AggOp::Max => aggregate_with(sources, Max, eval).await,
        AggOp::Min => aggregate_with(sources, Min, eval).await,
        AggOp::Stddev => aggregate_with(sources, Stddev, eval).await,
        AggOp::Stdvar => aggregate_with(sources, Stdvar, eval).await,
        AggOp::Sum => aggregate_with(sources, Sum, eval).await,
        AggOp::Topk(k) => aggregate_with(sources, Rank::new(k, false), eval).await,
    }
}

async fn aggregate_with<A, F, S>(
    sources: Vec<F>,
    func: A,
    eval: Arc<RangeExpr>,
) -> Result<(Value, usize)>
where
    A: AggFunc + Copy + Send + 'static,
    A::Accumulator: 'static,
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let start_time = std::time::Instant::now();
    let func_name = eval.func.name();
    let trace_id = &eval.eval_ctx.trace_id;
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) started with {} partitions",
        func.name(),
        sources.len(),
    );
    let (folds, series_count) = evaluate_partitions(sources, &eval, move |source, eval| {
        aggregate_partial(source, func, eval)
    })
    .await?;
    let value = aggregate_final(folds, &eval.timestamps);
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) execution took: {:?}, folded {series_count} series into {} series",
        func.name(),
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
async fn aggregate_partial<A: AggFunc, S: SeriesStream>(
    mut source: S,
    func: A,
    eval: Arc<RangeExpr>,
) -> Result<(GroupAccs<A::Accumulator>, usize)> {
    let mut groups = GroupAccs::new();
    let mut series_count = 0;
    let mut samples = Vec::new();
    while let Some(sig) = source.advance().await? {
        let entry = match groups.entry(sig) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(GroupEntry {
                labels: source.labels(),
                acc: func.build(eval.timestamps.len()),
            }),
        };
        source.consume(&mut samples).await?;
        entry
            .acc
            .push_series(eval.values(&samples), || source.labels());
        series_count += 1;
        // the fold is pure CPU: give the runtime a chance to time out or abort it
        tokio::task::consume_budget().await;
    }
    Ok((groups, series_count))
}

/// The final aggregate: partial groups merged in partition order, groups without output dropped
/// like the generic path.
fn aggregate_final<A: Accumulate>(
    folds: impl IntoIterator<Item = GroupAccs<A>>,
    timestamps: &[i64],
) -> Value {
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
        .flat_map(|entry| entry.acc.evaluate(entry.labels, timestamps))
        .filter(|series| !series.samples.is_empty())
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

    use config::meta::promql::value::{EvalContext, Label, Labels, Sample, TimeWindow, signature};
    use datafusion::error::DataFusionError;
    use promql_parser::parser::LabelModifier;

    use super::{
        super::{collect_partitioned, tests::*},
        *,
    };
    use crate::{
        functions::{self, RangeFunc},
        series_stream::matrix::{MATRIX_PARTITION_CHUNK, group_sources},
    };

    /// Errors on its first series.
    struct FailingStream;

    impl SeriesStream for FailingStream {
        async fn advance(&mut self) -> Result<Option<u64>> {
            Err(DataFusionError::Execution("source failed".into()))
        }
        fn labels(&mut self) -> Labels {
            Labels::default()
        }
        async fn consume(&mut self, _samples: &mut Vec<Sample>) -> Result<()> {
            Ok(())
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
        async fn consume(&mut self, samples: &mut Vec<Sample>) -> Result<()> {
            samples.clone_from(&self.samples);
            Ok(())
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

    /// Every operator the fused fold covers.
    fn all_ops() -> Vec<AggOp> {
        vec![
            AggOp::Avg,
            AggOp::Bottomk(1),
            AggOp::Bottomk(2),
            AggOp::Count,
            AggOp::Group,
            AggOp::Max,
            AggOp::Min,
            AggOp::Stddev,
            AggOp::Stdvar,
            AggOp::Sum,
            AggOp::Topk(1),
            AggOp::Topk(3),
        ]
    }

    /// The generic evaluator over the same table the fused path resolves names through.
    fn range_eval(name: &str, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
        functions::eval_range(data, functions::fusable_range_func(name).unwrap(), eval_ctx)
    }

    /// The generic path: the range function over the whole matrix, then the aggregation.
    fn run_generic(
        modifier: &Option<LabelModifier>,
        matrix: Vec<RangeValue>,
        func_name: &str,
        op: AggOp,
        eval_ctx: &EvalContext,
    ) -> Result<Value> {
        let input = range_eval(func_name, Value::Matrix(matrix), eval_ctx)?;
        op.eval_aggregate(modifier, input, eval_ctx)
    }

    async fn run_materialized(
        modifier: &Option<LabelModifier>,
        matrix: Vec<RangeValue>,
        func_name: &str,
        op: AggOp,
        eval_ctx: &EvalContext,
    ) -> Result<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let (sources, range) = group_sources(
            Value::Matrix(matrix),
            modifier,
            func_name,
            op.needs_series_labels(),
        )?
        .expect("the test matrix is not empty");
        let eval = Arc::new(RangeExpr::new(func, range, eval_ctx));
        aggregate(sources, op, eval).await.map(|(value, _)| value)
    }

    #[tokio::test]
    async fn test_fused_range_agg_matches_generic_for_all_pairs() {
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
        for op in all_ops() {
            for func_name in range_cases {
                for modifier in &modifiers {
                    let expected =
                        run_generic(modifier, matrix.clone(), func_name, op, &eval_ctx).unwrap();

                    let actual =
                        run_materialized(modifier, matrix.clone(), func_name, op, &eval_ctx)
                            .await
                            .unwrap();

                    assert_eq!(
                        canonical_matrix(expected),
                        canonical_matrix(actual),
                        "fused {op:?}({func_name}) diverged from generic (modifier: {modifier:?})",
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

        for op in all_ops() {
            for modifier in [None, by(&["path"])] {
                let expected =
                    run_generic(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx).unwrap();
                let first = canonical_matrix(
                    run_materialized(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
                        .await
                        .unwrap(),
                );
                assert_eq!(
                    canonical_matrix(expected),
                    first,
                    "chunked fused {op:?}(sum_over_time) diverged from generic (modifier: {modifier:?})",
                );
                let second = canonical_matrix(
                    run_materialized(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
                        .await
                        .unwrap(),
                );
                assert_eq!(
                    first, second,
                    "chunked fused {op:?}(sum_over_time) must be deterministic",
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

        for op in [AggOp::Sum, AggOp::Avg] {
            let expected = canonical_matrix(
                run_generic(&None, matrix.clone(), "rate", op, &eval_ctx).unwrap(),
            );
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
                        "fused {op:?}(rate) diverged beyond epsilon: {expected_value} vs {actual_value}",
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
            Box::pin(aggregate_partial(endless, Sum, eval.clone()))
                as std::pin::Pin<
                    Box<
                        dyn Future<
                                Output = Result<(GroupAccs<<Sum as AggFunc>::Accumulator>, usize)>,
                            > + Send,
                    >,
                >,
            Box::pin(aggregate_partial(failing, Sum, eval)),
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

    /// One partition of series keyed by their `by()` signature, carrying the labels the
    /// projection asks for: the full set, or the group's.
    struct VecStream {
        series: std::vec::IntoIter<RangeValue>,
        current: Option<RangeValue>,
        modifier: Option<LabelModifier>,
        series_labels: bool,
    }

    impl SeriesStream for VecStream {
        async fn advance(&mut self) -> Result<Option<u64>> {
            self.current = self.series.next();
            Ok(self.current.as_ref().map(|series| {
                signature(&crate::aggregations::projected_labels(
                    &self.modifier,
                    &series.labels,
                ))
            }))
        }

        fn labels(&mut self) -> Labels {
            let series = self.current.as_ref().expect("a series is current");
            if self.series_labels {
                return series.labels.clone();
            }
            crate::aggregations::projected_labels(&self.modifier, &series.labels)
        }

        async fn consume(&mut self, samples: &mut Vec<Sample>) -> Result<()> {
            let series = self.current.as_mut().expect("a series is current");
            *samples = std::mem::take(&mut series.samples);
            Ok(())
        }
    }

    /// Ties across series, a NaN, a counter reset, and a series alone in its group.
    fn rank_matrix() -> Vec<RangeValue> {
        let series = |instance, values: [f64; 6]| {
            make_series(
                "requests_total",
                instance,
                if ["a", "b", "c"].contains(&instance) {
                    "/one"
                } else if instance == "z" {
                    "/zzz"
                } else {
                    "/two"
                },
                &[10, 50, 70, 110, 130, 170]
                    .into_iter()
                    .zip(values)
                    .collect::<Vec<_>>(),
            )
        };
        vec![
            series("a", [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
            series("b", [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
            series("c", [0.5, 9.0, 9.5, 1.0, 1.5, 2.0]),
            series("d", [2.0, 2.0, f64::NAN, 2.0, 2.0, 2.0]),
            series("e", [3.0, 1.0, 4.0, 1.0, 5.0, 9.0]),
            series("f", [-1.0, -2.0, -3.0, -4.0, -5.0, -6.0]),
            series("z", [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
        ]
    }

    /// The matrix split into `partitions` round-robin, so groups straddle partitions.
    fn partitioned_sources(
        matrix: Vec<RangeValue>,
        partitions: usize,
        modifier: &Option<LabelModifier>,
        series_labels: bool,
    ) -> Vec<std::future::Ready<Result<VecStream>>> {
        let mut parts: Vec<Vec<RangeValue>> = (0..partitions).map(|_| Vec::new()).collect();
        for (index, series) in matrix.into_iter().enumerate() {
            parts[index % partitions].push(series);
        }
        parts
            .into_iter()
            .map(|part| {
                std::future::ready(Ok(VecStream {
                    series: part.into_iter(),
                    current: None,
                    modifier: modifier.clone(),
                    series_labels,
                }))
            })
            .collect()
    }

    /// Series without the metric name, as the range function output the generic path folds.
    fn streamed_input(matrix: Vec<RangeValue>, func_name: &str) -> Vec<RangeValue> {
        let mut matrix = matrix;
        if func_name != functions::KEEP_METRIC_NAME_FUNC {
            for series in &mut matrix {
                series.labels.retain(|label| label.name != "__name__");
            }
        }
        matrix
    }

    async fn run_partitioned(
        matrix: Vec<RangeValue>,
        partitions: usize,
        func_name: &str,
        op: AggOp,
        modifier: &Option<LabelModifier>,
    ) -> Value {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let range = Duration::from_secs(60);
        let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
        let sources = partitioned_sources(
            streamed_input(matrix.clone(), func_name),
            partitions,
            modifier,
            op.needs_series_labels(),
        );
        let (value, count) = aggregate(sources, op, eval).await.unwrap();
        assert_eq!(count, matrix.len());
        value
    }

    /// Every operator over partitions that split its groups matches the generic path, so the
    /// partial merges of every accumulator agree with the sequential fold.
    #[tokio::test]
    async fn test_fused_partitions_match_generic_for_all_ops() {
        let modifiers = [
            None,
            by(&["path"]),
            by(&["instance", "path"]),
            by(&["nope"]),
        ];
        let mut ops = all_ops();
        ops.extend([AggOp::Topk(0), AggOp::Topk(10), AggOp::Bottomk(10)]);
        for func_name in ["rate", "last_over_time", "sum_over_time", "delta"] {
            for &op in &ops {
                for modifier in &modifiers {
                    let expected = canonical_matrix(
                        run_generic(modifier, rank_matrix(), func_name, op, &eval_ctx()).unwrap(),
                    );
                    for partitions in [1, 2, 3] {
                        let actual = canonical_matrix(
                            run_partitioned(rank_matrix(), partitions, func_name, op, modifier)
                                .await,
                        );
                        let context = format!(
                            "{op:?}({func_name}) over {partitions} partitions (modifier: {modifier:?})"
                        );
                        // a value buffer merged in partition order may drift in the last bits
                        if op.needs_series_labels() {
                            assert_eq!(expected, actual, "{context}");
                        } else {
                            assert_matrix_close(expected.clone(), actual, &context);
                        }
                    }
                }
            }
        }
    }

    /// `a`, `b` and `z` carry the same values everywhere, so `topk(1)` and `bottomk(1)` among
    /// them fall entirely to the label signature.
    #[tokio::test]
    async fn test_fused_rank_ties_go_to_the_lower_signature() {
        let tied: Vec<RangeValue> = streamed_input(rank_matrix(), "rate")
            .into_iter()
            .filter(|series| ["a", "b", "z"].contains(&series.labels[0].value.as_str()))
            .collect();
        let lowest = tied
            .iter()
            .min_by_key(|series| signature(&series.labels))
            .map(|series| series.labels[0].value.clone())
            .unwrap();
        for op in [AggOp::Topk(1), AggOp::Bottomk(1)] {
            let value = run_partitioned(tied.clone(), 2, "rate", op, &None).await;
            let Value::Matrix(matrix) = value else {
                panic!("expected a matrix");
            };
            assert_eq!(matrix.len(), 1, "{op:?}");
            assert_eq!(matrix[0].labels[0].value, lowest, "{op:?}");
            assert_eq!(matrix[0].samples.len(), 3, "{op:?}");
            assert_eq!(
                canonical_matrix(
                    run_generic(&None, tied.clone(), "rate", op, &eval_ctx()).unwrap()
                ),
                canonical_matrix(Value::Matrix(matrix)),
                "{op:?}"
            );
        }
    }

    #[tokio::test]
    async fn test_fused_rank_k_zero_and_no_series_are_none() {
        let value = run_partitioned(rank_matrix(), 2, "rate", AggOp::Topk(0), &None).await;
        assert!(matches!(value, Value::None));
        let value = run_partitioned(vec![], 2, "rate", AggOp::Bottomk(3), &None).await;
        assert!(matches!(value, Value::None));
    }

    /// No aggregation output carries a window, like the generic path.
    #[tokio::test]
    async fn test_fused_outputs_carry_no_window() {
        for op in all_ops() {
            let value = run_partitioned(rank_matrix(), 1, "rate", op, &None).await;
            let Value::Matrix(matrix) = value else {
                panic!("{op:?}: expected a matrix");
            };
            assert!(
                matrix
                    .iter()
                    .all(|series| series.time_window.is_none() && series.exemplars.is_none()),
                "{op:?}"
            );
        }
    }
}

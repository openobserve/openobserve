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

//! An already-materialized matrix opened as series sources, so it folds through the same
//! consumers the hash-sorted scans do.

use std::time::Duration;

use config::meta::promql::{NAME_LABEL, value::Value};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::{
    functions::KEEP_METRIC_NAME_FUNC,
    series_stream::matrix::{MatrixSeriesStream, matrix_streams},
};

/// A partition of the matrix, already open.
pub(crate) type MaterializedSource = std::future::Ready<Result<MatrixSeriesStream>>;

/// The matrix as group-ordered sources for the aggregate and the window the load applied to
/// it; `None` for no input.
pub(crate) fn group_sources(
    data: Value,
    modifier: &Option<LabelModifier>,
    func_name: &str,
) -> Result<Option<(Vec<MaterializedSource>, Duration)>> {
    let mut matrix = match data {
        Value::Matrix(matrix) if matrix.is_empty() => return Ok(None),
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(None),
        value => {
            return Err(DataFusionError::Plan(format!(
                "{func_name}: matrix argument expected but got {}",
                value.get_type()
            )));
        }
    };
    // the load applied one window to every series, so the first speaks for all
    let range = matrix[0]
        .time_window
        .as_ref()
        .expect("range function input must have a time window")
        .range;
    // strip the metric name as the range function would have; visible to `sum by(__name__)`
    if !KEEP_METRIC_NAME_FUNC.contains(func_name) {
        matrix.par_iter_mut().for_each(|series| {
            series.labels.retain(|label| label.name != NAME_LABEL);
        });
    }
    let sources = matrix_streams(matrix, modifier, config::get_config().limit.cpu_num)
        .into_iter()
        .map(|stream| std::future::ready(Ok(stream)))
        .collect();
    Ok(Some((sources, range)))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{EvalContext, Label, RangeValue, Sample, TimeWindow};

    use super::{
        super::{aggregate::aggregate, op::FusedAggOp, range_expr::RangeExpr, test_support::*},
        *,
    };
    use crate::{
        aggregations,
        functions::{self, RangeFunc},
        series_stream::matrix::MATRIX_PARTITION_CHUNK,
    };

    type GenericAgg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;

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
            (FusedAggOp::Avg, aggregations::avg),
            (FusedAggOp::Count, aggregations::count),
            (FusedAggOp::Group, aggregations::group),
            (FusedAggOp::Max, aggregations::max),
            (FusedAggOp::Min, aggregations::min),
            (FusedAggOp::Stddev, aggregations::stddev),
            (FusedAggOp::Stdvar, aggregations::stdvar),
            (FusedAggOp::Sum, aggregations::sum),
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
            (FusedAggOp::Avg, aggregations::avg),
            (FusedAggOp::Count, aggregations::count),
            (FusedAggOp::Group, aggregations::group),
            (FusedAggOp::Max, aggregations::max),
            (FusedAggOp::Min, aggregations::min),
            (FusedAggOp::Stddev, aggregations::stddev),
            (FusedAggOp::Stdvar, aggregations::stdvar),
            (FusedAggOp::Sum, aggregations::sum),
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
            (FusedAggOp::Sum, aggregations::sum as GenericAgg),
            (FusedAggOp::Avg, aggregations::avg as GenericAgg),
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

    #[test]
    fn test_group_sources_none_and_invalid_input() {
        assert!(group_sources(Value::None, &None, "rate").unwrap().is_none());
        assert!(group_sources(Value::Float(1.0), &None, "rate").is_err());
        assert!(
            group_sources(Value::Matrix(vec![]), &None, "rate")
                .unwrap()
                .is_none()
        );
    }
}

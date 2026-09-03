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

use std::sync::Arc;

use config::meta::promql::{
    NAME_LABEL,
    value::{EvalContext, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use super::{
    fold::{FoldParams, fold_partition, merge_folds, run_folds},
    op::FusedAggOp,
};
use crate::{
    functions::{KEEP_METRIC_NAME_FUNC, RangeFunc},
    series_stream::matrix::matrix_sources,
};

/// Evaluates a range function over an already-materialized matrix and folds
/// its values straight into aggregation groups, through the same fold the
/// streaming path uses.
///
/// The engine selects this only for the exact `agg(range_func(...))` shape;
/// everything else stays on the generic evaluator, the correctness reference.
pub(crate) async fn fused_range_agg(
    param: &Option<LabelModifier>,
    data: Value,
    func: Arc<dyn RangeFunc>,
    op: FusedAggOp,
    eval_ctx: &EvalContext,
    timeout: u64,
) -> Result<Value> {
    let func_name = func.name();
    let mut matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(Value::None),
        value => {
            return Err(DataFusionError::Plan(format!(
                "fused {}({func_name}): matrix argument expected but got {}",
                op.name(),
                value.get_type()
            )));
        }
    };
    if matrix.is_empty() {
        return Ok(Value::None);
    }

    let start = std::time::Instant::now();
    let trace_id = &eval_ctx.trace_id;
    let input_series = matrix.len();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) started with {input_series} series",
        op.name()
    );

    // Strip the metric name before grouping, as the range function would have;
    // visible to `sum by(__name__) (...)`.
    if !KEEP_METRIC_NAME_FUNC.contains(func_name) {
        matrix.par_iter_mut().for_each(|series| {
            series.labels.retain(|label| label.name != NAME_LABEL);
        });
    }

    // the load applied one window to every series, so the first speaks for all
    let range = matrix[0]
        .time_window
        .as_ref()
        .expect("range function input must have a time window")
        .range;
    let params = Arc::new(FoldParams {
        op,
        func: func.clone(),
        counter_kind: func.counter_extrapolation(),
        range,
        eval_ctx: eval_ctx.clone(),
        timestamps: eval_ctx.timestamps(),
    });
    let (matrix, sources) = matrix_sources(matrix, param, config::get_config().limit.cpu_num);
    let folds = sources
        .into_iter()
        .map(|source| {
            let params = params.clone();
            async move { fold_partition(source, params).await }
        })
        .collect::<Vec<_>>();
    let folds = run_folds(folds, timeout).await?;
    let value = merge_folds(
        folds.into_iter().map(|(groups, _)| groups).collect(),
        &params.timestamps,
    );

    if let Ok(matrix) = Arc::try_unwrap(matrix) {
        // Free the per-series allocations on the rayon pool; dropping them single-threaded is slow.
        matrix.into_par_iter().for_each(drop);
    }
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused {}({func_name}) completed in {:?}, folded {input_series} series into {} series",
        op.name(),
        start.elapsed(),
        match &value {
            Value::Matrix(matrix) => matrix.len(),
            _ => 0,
        },
    );
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::value::{Label, RangeValue, Sample, TimeWindow};

    use super::*;
    use crate::{aggregations, functions, series_stream::matrix::MATRIX_PARTITION_CHUNK};

    type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, u64)>);
    type GenericAgg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;
    type GenericRange = fn(Value, &EvalContext) -> Result<Value>;

    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_000 * SECOND;

    fn canonical_matrix(value: Value) -> Vec<CanonicalSeries> {
        let matrix = match value {
            Value::Matrix(matrix) => matrix,
            Value::None => return vec![],
            value => panic!("expected matrix or none, got {}", value.get_type()),
        };
        let mut canonical = matrix
            .into_iter()
            .map(|series| {
                let mut labels = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect::<Vec<_>>();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>();
                (labels, samples)
            })
            .collect::<Vec<_>>();
        canonical.sort_by(|a, b| a.0.cmp(&b.0));
        canonical
    }

    fn eval_ctx() -> EvalContext {
        EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        )
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

    fn by(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    fn without(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    async fn run_fused(
        modifier: &Option<LabelModifier>,
        matrix: Vec<RangeValue>,
        func_name: &str,
        op: FusedAggOp,
        eval_ctx: &EvalContext,
    ) -> Result<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        fused_range_agg(modifier, Value::Matrix(matrix), func, op, eval_ctx, 30).await
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
        let range_cases: [(&str, GenericRange); 16] = [
            ("avg_over_time", functions::avg_over_time),
            ("changes", functions::changes),
            ("count_over_time", functions::count_over_time),
            ("delta", functions::delta),
            ("deriv", functions::deriv),
            ("idelta", functions::idelta),
            ("increase", functions::increase),
            ("irate", functions::irate),
            ("last_over_time", functions::last_over_time),
            ("max_over_time", functions::max_over_time),
            ("min_over_time", functions::min_over_time),
            ("rate", functions::rate),
            ("resets", functions::resets),
            ("stddev_over_time", functions::stddev_over_time),
            ("stdvar_over_time", functions::stdvar_over_time),
            ("sum_over_time", functions::sum_over_time),
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
            for (func_name, generic_range) in range_cases {
                for modifier in &modifiers {
                    let generic_input =
                        generic_range(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                    let expected = generic_agg(modifier, generic_input, &eval_ctx).unwrap();

                    let actual = run_fused(modifier, matrix.clone(), func_name, op, &eval_ctx)
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
                    functions::sum_over_time(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                let expected = generic_agg(&modifier, generic_input, &eval_ctx).unwrap();
                let first = canonical_matrix(
                    run_fused(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
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
                    run_fused(&modifier, matrix.clone(), "sum_over_time", op, &eval_ctx)
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
            let generic_input = functions::rate(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
            let expected = canonical_matrix(generic_agg(&None, generic_input, &eval_ctx).unwrap());
            let actual = canonical_matrix(
                run_fused(&None, matrix.clone(), "rate", op, &eval_ctx)
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

    #[tokio::test]
    async fn test_fused_range_agg_none_and_invalid_input() {
        let eval_ctx = eval_ctx();
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func("rate").unwrap());
        let result = fused_range_agg(
            &None,
            Value::None,
            func.clone(),
            FusedAggOp::Sum,
            &eval_ctx,
            30,
        )
        .await
        .unwrap();
        assert!(matches!(result, Value::None));

        let result = fused_range_agg(
            &None,
            Value::Float(1.0),
            func.clone(),
            FusedAggOp::Sum,
            &eval_ctx,
            30,
        )
        .await;
        assert!(result.is_err());

        let result = fused_range_agg(
            &None,
            Value::Matrix(vec![]),
            func,
            FusedAggOp::Sum,
            &eval_ctx,
            30,
        )
        .await
        .unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_fusable_range_func_whitelist() {
        assert!(functions::fusable_range_func("rate").is_some());
        assert!(functions::fusable_range_func("increase").is_some());
        assert!(functions::fusable_range_func("last_over_time").is_some());
        // Parameterized or special-semantics functions stay on the generic path.
        assert!(functions::fusable_range_func("quantile_over_time").is_none());
        assert!(functions::fusable_range_func("predict_linear").is_none());
        assert!(functions::fusable_range_func("holt_winters").is_none());
        assert!(functions::fusable_range_func("absent_over_time").is_none());
        assert!(functions::fusable_range_func("histogram_quantile").is_none());
    }
}

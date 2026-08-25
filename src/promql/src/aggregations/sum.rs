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

use config::meta::promql::{
    NAME_LABEL,
    value::{EvalContext, RangeValue, Sample, Value},
};
use datafusion::error::Result;
use hashbrown::HashMap;
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::{
    aggregations::{Accumulate, AggFunc, group_series_by_labels, projected_labels},
    common::kahan_sum_increment,
    functions::{RangeFunc, advance_sample_window},
    micros,
};

/// Aggregates Matrix input for range queries
pub fn sum(param: &Option<LabelModifier>, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum() started",
        eval_ctx.trace_id
    );

    let result = super::eval_aggregate(param, data, Sum, eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

/// Evaluate a range function and immediately fold its values into `sum` groups.
///
/// The generic evaluator materializes one output `Sample` for every input series and
/// evaluation timestamp, only for `sum` to scan and discard those samples immediately.
/// This path keeps one dense compensated accumulator per output group instead. It is
/// deliberately selected by the engine only for the exact `sum(range_func(...))` shape;
/// all other expression trees continue to use the generic evaluator.
pub(crate) fn fused_range_sum<F>(
    param: &Option<LabelModifier>,
    data: Value,
    func: F,
    eval_ctx: &EvalContext,
) -> Result<Value>
where
    F: RangeFunc,
{
    let start = std::time::Instant::now();
    let trace_id = &eval_ctx.trace_id;
    let func_name = func.name();
    let mut matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(Value::None),
        value => {
            return Err(datafusion::error::DataFusionError::Plan(format!(
                "fused sum({func_name}): matrix argument expected but got {}",
                value.get_type()
            )));
        }
    };
    if matrix.is_empty() {
        return Ok(Value::None);
    }

    // `rate` drops the metric name before its parent aggregation sees the
    // labels. Apply the same transformation before computing group signatures
    // (not just while materializing output labels), including the uncommon
    // `sum by(__name__) (rate(...))` case.
    matrix.par_iter_mut().for_each(|series| {
        series.labels.retain(|label| label.name != NAME_LABEL);
    });

    let timestamps = eval_ctx.timestamps();
    let input_series = matrix.len();
    let input_samples = matrix
        .iter()
        .map(|series| series.samples.len())
        .sum::<usize>();
    let groups = group_series_by_labels(&matrix, param);

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused sum({func_name}) processing {input_series} series, {input_samples} input samples, {} groups, {} time points",
        groups.len(),
        timestamps.len(),
    );

    let results_with_counts = groups
        .par_iter()
        .map(|(_, series_indices)| {
            let labels = projected_labels(param, &matrix[series_indices[0]].labels);
            let mut sums = vec![(0.0, 0.0); timestamps.len()];
            let mut present = vec![false; timestamps.len()];
            let mut evaluated_samples = 0usize;

            // Preserve the generic path's accumulation order: series order first,
            // timestamp order second. This keeps compensated floating-point sums
            // bit-for-bit stable for the same input ordering.
            for &series_idx in series_indices {
                let metric = &matrix[series_idx];
                let range = metric
                    .time_window
                    .as_ref()
                    .expect("range function input must have a time window")
                    .range;
                let range_micros = micros(range);
                let mut start_index = 0;
                let mut end_index = 0;

                for (timestamp_idx, &eval_ts) in timestamps.iter().enumerate() {
                    let window_samples = advance_sample_window(
                        &metric.samples,
                        eval_ts - range_micros,
                        eval_ts,
                        &mut start_index,
                        &mut end_index,
                    );
                    if window_samples.is_empty() {
                        continue;
                    }
                    if let Some(value) = func.exec(window_samples, eval_ts, &range) {
                        let (sum, compensation) = &mut sums[timestamp_idx];
                        (*sum, *compensation) = kahan_sum_increment(value, *sum, *compensation);
                        present[timestamp_idx] = true;
                        evaluated_samples += 1;
                    }
                }
            }

            let samples = timestamps
                .iter()
                .enumerate()
                .filter(|(idx, _)| present[*idx])
                .map(|(idx, &timestamp)| {
                    let (sum, compensation) = sums[idx];
                    Sample::new(timestamp, sum + compensation)
                })
                .collect();

            (
                RangeValue {
                    labels,
                    samples,
                    exemplars: None,
                    time_window: None,
                },
                evaluated_samples,
            )
        })
        .collect::<Vec<_>>();

    let evaluated_samples = results_with_counts
        .iter()
        .map(|(_, count)| count)
        .sum::<usize>();
    let results = results_with_counts
        .into_iter()
        .map(|(result, _)| result)
        .collect::<Vec<_>>();

    let drop_start = std::time::Instant::now();
    matrix.into_par_iter().for_each(drop);
    let drop_elapsed = drop_start.elapsed();

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] fused sum({func_name}) completed in {:?}, evaluated {evaluated_samples} range samples into {} output series and {} dense slots; parallel input drop took {:?}",
        start.elapsed(),
        results.len(),
        results.len() * timestamps.len(),
        drop_elapsed,
    );
    Ok(Value::Matrix(results))
}

pub struct Sum;

impl AggFunc for Sum {
    fn name(&self) -> &'static str {
        "sum"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(SumAccumulate::new())
    }
}

pub struct SumAccumulate {
    sum: HashMap<i64, (f64, f64)>,
}

impl SumAccumulate {
    fn new() -> Self {
        SumAccumulate {
            sum: HashMap::new(),
        }
    }
}

impl Accumulate for SumAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let (sum, c) = self.sum.entry(sample.timestamp).or_insert((0.0, 0.0));
        (*sum, *c) = kahan_sum_increment(sample.value, *sum, *c);
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        for (timestamp, (other_sum, other_c)) in other.sum {
            let (sum, c) = self.sum.entry(timestamp).or_insert((0.0, 0.0));
            // Fold the other partial's sum and compensation in as two
            // separate compensated increments: a plain `c + other_c` add
            // rounds residuals away before the main sums get to cancel.
            (*sum, *c) = kahan_sum_increment(other_sum, *sum, *c);
            (*sum, *c) = kahan_sum_increment(other_c, *sum, *c);
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.sum
            .into_iter()
            .map(|(timestamp, (sum, c))| Sample::new(timestamp, sum + c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::value::{Label, RangeValue, Sample, TimeWindow, Value};
    use promql_parser::parser::LabelModifier;

    use super::*;
    use crate::functions::{RateFunc, rate};

    fn canonical_matrix(value: Value) -> Vec<(Vec<(String, String)>, Vec<(i64, u64)>)> {
        let Value::Matrix(matrix) = value else {
            panic!("expected matrix");
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

    #[test]
    fn test_fused_range_sum_matches_generic_rate_then_sum() {
        const SECOND: i64 = 1_000_000;
        const BASE: i64 = 1_000 * SECOND;
        let eval_ctx = EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        );
        let range = Duration::from_secs(60);
        let make_series = |instance: &str, path: &str, values: [f64; 6]| RangeValue {
            labels: vec![
                Arc::new(Label::new("__name__", "requests_total")),
                Arc::new(Label::new("instance", instance)),
                Arc::new(Label::new("path", path)),
            ],
            samples: [10, 50, 70, 110, 130, 170]
                .into_iter()
                .zip(values)
                .map(|(timestamp, value)| Sample::new(BASE + timestamp * SECOND, value))
                .collect(),
            exemplars: None,
            time_window: Some(TimeWindow::new(range)),
        };
        let matrix = vec![
            make_series("a", "/one", [0.0, 40.0, 45.0, 85.0, 90.0, 130.0]),
            make_series("b", "/one", [0.0, 80.0, 90.0, 170.0, 180.0, 260.0]),
            make_series("c", "/two", [0.0, 20.0, 25.0, 45.0, 50.0, 70.0]),
        ];
        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["path".to_string()],
        }));

        let generic_rate = rate(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
        let expected = sum(&modifier, generic_rate, &eval_ctx).unwrap();
        let actual = fused_range_sum(
            &modifier,
            Value::Matrix(matrix.clone()),
            RateFunc::new(),
            &eval_ctx,
        )
        .unwrap();

        assert_eq!(canonical_matrix(expected), canonical_matrix(actual));

        let by_metric_name = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["__name__".to_string()],
        }));
        let generic_rate = rate(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
        let expected = sum(&by_metric_name, generic_rate, &eval_ctx).unwrap();
        let actual = fused_range_sum(
            &by_metric_name,
            Value::Matrix(matrix),
            RateFunc::new(),
            &eval_ctx,
        )
        .unwrap();
        assert_eq!(canonical_matrix(expected), canonical_matrix(actual));
    }

    #[test]
    fn test_sum_value_none_input() {
        let ts = 1640995200;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let result = sum(&None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_sum_invalid_input_returns_err() {
        let ts = 1640995200;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let result = sum(&None, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_sum_empty_matrix_returns_none() {
        let ts = 1640995200;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let result = sum(&None, Value::Matrix(vec![]), &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_sum_range_function() {
        // Create test matrix data with multiple series and timestamps
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels3 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "prometheus")),
        ];

        // Create matrix with 3 series across 3 timestamps
        let ts1 = 1000;
        let ts2 = 2000;
        let ts3 = 3000;

        let matrix = vec![
            RangeValue {
                labels: labels1.clone(),
                samples: vec![
                    Sample::new(ts1, 10.0),
                    Sample::new(ts2, 20.0),
                    Sample::new(ts3, 30.0),
                ],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![
                    Sample::new(ts1, 5.0),
                    Sample::new(ts2, 15.0),
                    Sample::new(ts3, 25.0),
                ],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels3.clone(),
                samples: vec![
                    Sample::new(ts1, 2.0),
                    Sample::new(ts2, 4.0),
                    Sample::new(ts3, 6.0),
                ],
                exemplars: None,
                time_window: None,
            },
        ];

        // EvalContext with start=1000, end=3000, step=1000 will generate [1000, 2000, 3000]
        // Formula: nr_steps = (end - start) / step + 1 = (3000 - 1000) / 1000 + 1 = 3
        let eval_ctx = EvalContext::new(ts1, ts3 + 1, 1000, "test".to_string());

        // Test 1: sum without label grouping (all series summed together)
        let result = sum(&None, Value::Matrix(matrix.clone()), &eval_ctx).unwrap();

        match result {
            Value::Matrix(result_matrix) => {
                assert_eq!(result_matrix.len(), 1); // One aggregated series
                let series = &result_matrix[0];
                assert!(series.labels.is_empty()); // No labels when grouping all together
                assert_eq!(series.samples.len(), 3); // 3 timestamps
                assert_eq!(series.samples[0].timestamp, ts1);
                assert_eq!(series.samples[0].value, 17.0); // 10 + 5 + 2
                assert_eq!(series.samples[1].timestamp, ts2);
                assert_eq!(series.samples[1].value, 39.0); // 20 + 15 + 4
                assert_eq!(series.samples[2].timestamp, ts3);
                assert_eq!(series.samples[2].value, 61.0); // 30 + 25 + 6
            }
            _ => panic!("Expected Matrix result"),
        }

        // Test 2: sum by job label (group by job)
        let param = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["job".to_string()],
        }));
        let result = sum(&param, Value::Matrix(matrix.clone()), &eval_ctx).unwrap();

        match result {
            Value::Matrix(result_matrix) => {
                assert_eq!(result_matrix.len(), 2); // Two groups: node_exporter and prometheus

                // Find the groups
                let node_exporter_series = result_matrix
                    .iter()
                    .find(|s| {
                        s.labels
                            .iter()
                            .any(|l| l.name == "job" && l.value == "node_exporter")
                    })
                    .expect("Should have node_exporter group");

                let prometheus_series = result_matrix
                    .iter()
                    .find(|s| {
                        s.labels
                            .iter()
                            .any(|l| l.name == "job" && l.value == "prometheus")
                    })
                    .expect("Should have prometheus group");

                // Verify node_exporter group (server1 + server2)
                assert_eq!(node_exporter_series.samples.len(), 3);
                assert_eq!(node_exporter_series.samples[0].value, 15.0); // 10 + 5
                assert_eq!(node_exporter_series.samples[1].value, 35.0); // 20 + 15
                assert_eq!(node_exporter_series.samples[2].value, 55.0); // 30 + 25

                // Verify prometheus group (server1 only)
                assert_eq!(prometheus_series.samples.len(), 3);
                assert_eq!(prometheus_series.samples[0].value, 2.0);
                assert_eq!(prometheus_series.samples[1].value, 4.0);
                assert_eq!(prometheus_series.samples[2].value, 6.0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}

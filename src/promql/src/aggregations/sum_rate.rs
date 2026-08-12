// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Fused execution for `sum by (...) (rate(selector[range]))`.
//!
//! The generic evaluator materializes one rate sample per input series and
//! evaluation timestamp, then walks that matrix again for `sum`. At high
//! cardinality that intermediate matrix dominates both memory and CPU. This
//! module computes each rate and immediately adds it to its final label group.

use std::time::{Duration, Instant};

use config::meta::promql::{
    NAME_LABEL,
    value::{
        EvalContext, ExtrapolationKind, RangeValue, Sample, Value, extrapolated_rate,
        extrapolated_rate_with_reset_correction,
    },
};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use super::{group_series_by_labels, projected_labels};
use crate::{common::kahan_sum_increment, functions::advance_sample_window, micros};

/// Evaluate `sum by (...) (rate(...))` without materializing the per-series
/// rate matrix.
pub(crate) fn sum_rate(
    modifier: &Option<LabelModifier>,
    mut matrix: Vec<RangeValue>,
    range: Duration,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    if matrix.is_empty() {
        return Ok(Value::None);
    }

    let started = Instant::now();
    let input_series = matrix.len();
    let raw_samples = matrix
        .iter()
        .map(|series| series.samples.len())
        .sum::<usize>();
    let timestamps = eval_ctx.timestamps();

    // rate() drops the metric name before the surrounding aggregation sees
    // the labels. Do it in-place so grouping has exactly the generic path's
    // semantics without cloning a million label vectors.
    matrix.par_iter_mut().for_each(|series| {
        series.labels.retain(|label| label.name != NAME_LABEL);
    });

    let groups = group_series_by_labels(&matrix, modifier);
    let range_micros = micros(range);

    let results = groups
        .par_iter()
        .filter_map(|(_, series_indices)| {
            let labels = projected_labels(modifier, &matrix[series_indices[0]].labels);
            let mut sums = vec![0.0; timestamps.len()];
            let mut compensations = vec![0.0; timestamps.len()];
            let mut present = vec![false; timestamps.len()];
            let mut reset_prefix = Vec::new();

            for &series_index in series_indices {
                accumulate_rate_series(
                    &matrix[series_index].samples,
                    &timestamps,
                    range,
                    range_micros,
                    &mut sums,
                    &mut compensations,
                    &mut present,
                    &mut reset_prefix,
                );
            }

            let samples = timestamps
                .iter()
                .enumerate()
                .filter(|(index, _)| present[*index])
                .map(|(index, &timestamp)| {
                    Sample::new(timestamp, sums[index] + compensations[index])
                })
                .collect::<Vec<_>>();

            (!samples.is_empty()).then_some(RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            })
        })
        .collect::<Vec<_>>();

    let output_series = results.len();
    let output_samples = results
        .iter()
        .map(|series| series.samples.len())
        .sum::<usize>();

    // RangeValue owns a Vec for every TSID. Drop those allocations on the
    // Rayon pool; at million-series cardinality a serial drop is measurable.
    matrix.into_par_iter().for_each(drop);

    log::info!(
        "[trace_id: {}] [PromQL Timing] fused sum(rate()) processed {} input series / {} raw samples into {} output series / {} samples in {:?}",
        eval_ctx.trace_id,
        input_series,
        raw_samples,
        output_series,
        output_samples,
        started.elapsed(),
    );

    if results.is_empty() {
        Ok(Value::None)
    } else {
        Ok(Value::Matrix(results))
    }
}

#[allow(clippy::too_many_arguments)]
fn accumulate_rate_series(
    samples: &[Sample],
    timestamps: &[i64],
    range: Duration,
    range_micros: i64,
    sums: &mut [f64],
    compensations: &mut [f64],
    present: &mut [bool],
    reset_prefix: &mut Vec<f64>,
) {
    if samples.len() < 2 {
        return;
    }

    // A prefix turns the reset scan inside extrapolated_rate from O(samples
    // per window) into O(1). Non-finite input (or a prefix overflow) uses the
    // original implementation so NaN/Inf behaviour is preserved.
    let use_reset_prefix = build_counter_reset_prefix(samples, reset_prefix);
    let mut start_index = 0;
    let mut end_index = 0;

    for (timestamp_index, &eval_ts) in timestamps.iter().enumerate() {
        let window_samples = advance_sample_window(
            samples,
            eval_ts - range_micros,
            eval_ts,
            &mut start_index,
            &mut end_index,
        );
        if window_samples.len() < 2 {
            continue;
        }

        // Matrix-selector offsets have already shifted sample timestamps in
        // Engine::eval_matrix_selector, matching the generic rate path.
        let value = if use_reset_prefix {
            // prefix[k] contains resets whose right-hand sample index is < k.
            // The reset immediately before the first window sample must not be
            // included, hence start_index + 1.
            let reset_correction = reset_prefix[end_index] - reset_prefix[start_index + 1];
            extrapolated_rate_with_reset_correction(
                window_samples,
                eval_ts,
                range,
                Duration::ZERO,
                ExtrapolationKind::Rate,
                reset_correction,
            )
        } else {
            extrapolated_rate(
                window_samples,
                eval_ts,
                range,
                Duration::ZERO,
                ExtrapolationKind::Rate,
            )
        };

        if let Some(value) = value {
            (sums[timestamp_index], compensations[timestamp_index]) =
                kahan_sum_increment(value, sums[timestamp_index], compensations[timestamp_index]);
            present[timestamp_index] = true;
        }
    }
}

/// `prefix[k]` is the sum of values immediately preceding counter resets
/// whose right-hand sample index is strictly smaller than `k`.
fn build_counter_reset_prefix(samples: &[Sample], prefix: &mut Vec<f64>) -> bool {
    prefix.clear();
    prefix.reserve(samples.len() + 1);
    let mut correction = 0.0;
    prefix.push(correction);

    for index in 0..samples.len() {
        if !samples[index].value.is_finite() {
            return false;
        }
        if index > 0 && samples[index].value < samples[index - 1].value {
            correction += samples[index - 1].value;
            if !correction.is_finite() {
                return false;
            }
        }
        prefix.push(correction);
    }

    true
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, TimeWindow};
    use promql_parser::label::Labels as ParserLabels;

    use super::*;
    use crate::{aggregations::sum, functions};

    const SECOND: i64 = 1_000_000;

    fn labels(path: &str, instance: &str) -> Vec<Arc<Label>> {
        vec![
            Arc::new(Label::new(NAME_LABEL, "request_duration_seconds_bucket")),
            Arc::new(Label::new("instance", instance)),
            Arc::new(Label::new("le", "1")),
            Arc::new(Label::new("path", path)),
        ]
    }

    fn series(path: &str, instance: &str, values: &[f64], range: Duration) -> RangeValue {
        RangeValue {
            labels: labels(path, instance),
            samples: values
                .iter()
                .enumerate()
                .map(|(index, &value)| Sample::new((240 + index as i64 * 30) * SECOND, value))
                .collect(),
            exemplars: None,
            time_window: Some(TimeWindow::new(range)),
        }
    }

    fn assert_same_matrix(actual: Value, expected: Value) {
        let Value::Matrix(mut actual) = actual else {
            panic!("expected actual matrix")
        };
        let Value::Matrix(mut expected) = expected else {
            panic!("expected reference matrix")
        };

        let key = |series: &RangeValue| {
            series
                .labels
                .iter()
                .map(|label| format!("{}={}", label.name, label.value))
                .collect::<Vec<_>>()
                .join(",")
        };
        actual.sort_by_key(&key);
        expected.sort_by_key(&key);
        assert_eq!(actual.len(), expected.len());

        for (actual, expected) in actual.iter().zip(expected.iter()) {
            assert_eq!(actual.labels, expected.labels);
            assert_eq!(actual.samples.len(), expected.samples.len());
            for (actual, expected) in actual.samples.iter().zip(expected.samples.iter()) {
                assert_eq!(actual.timestamp, expected.timestamp);
                if actual.value.is_nan() || expected.value.is_nan() {
                    assert!(actual.value.is_nan() && expected.value.is_nan());
                } else {
                    let tolerance = 1e-12 * expected.value.abs().max(1.0);
                    assert!(
                        (actual.value - expected.value).abs() <= tolerance,
                        "actual={} expected={} tolerance={}",
                        actual.value,
                        expected.value,
                        tolerance,
                    );
                }
            }
        }
    }

    #[test]
    fn fused_sum_rate_matches_generic_pipeline_with_resets() {
        let range = Duration::from_secs(120);
        let eval_ctx = EvalContext::new(
            360 * SECOND,
            480 * SECOND,
            30 * SECOND,
            "sum-rate-test".to_string(),
        );
        let modifier = Some(LabelModifier::Include(ParserLabels {
            labels: vec!["le".to_string(), "path".to_string()],
        }));
        let matrix = vec![
            series(
                "/api",
                "a",
                &[80.0, 90.0, 100.0, 5.0, 15.0, 25.0, 35.0, 45.0, 55.0],
                range,
            ),
            series(
                "/api",
                "b",
                &[10.0, 20.0, 30.0, 40.0, 50.0, 3.0, 13.0, 23.0, 33.0],
                range,
            ),
            series(
                "/health",
                "a",
                &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
                range,
            ),
        ];

        let generic_rate = functions::rate(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
        let expected = sum(&modifier, generic_rate, &eval_ctx).unwrap();
        let actual = sum_rate(&modifier, matrix, range, &eval_ctx).unwrap();

        assert_same_matrix(actual, expected);
    }

    #[test]
    fn reset_prefix_excludes_reset_before_window_start() {
        let samples = [
            Sample::new(1, 80.0),
            Sample::new(2, 100.0),
            Sample::new(3, 5.0),
            Sample::new(4, 15.0),
        ];
        let mut prefix = Vec::new();
        assert!(build_counter_reset_prefix(&samples, &mut prefix));

        // [index 1, index 4) contains the reset between indices 1 and 2.
        assert_eq!(prefix[4] - prefix[2], 100.0);
        // [index 2, index 4) starts after the reset, so it contains none.
        assert_eq!(prefix[4] - prefix[3], 0.0);
    }

    #[test]
    fn non_finite_series_uses_generic_reset_scan() {
        let samples = [Sample::new(1, 1.0), Sample::new(2, f64::NAN)];
        assert!(!build_counter_reset_prefix(&samples, &mut Vec::new()));
    }
}

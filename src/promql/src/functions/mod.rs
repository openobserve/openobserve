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

use std::{collections::HashSet, sync::LazyLock as Lazy, time::Duration};

use config::meta::promql::value::{EvalContext, LabelsExt, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::prelude::*;
use strum::EnumString;

use crate::micros;

mod absent;
mod absent_over_time;
mod avg_over_time;
mod changes;
mod clamp;
mod count_over_time;
mod delta;
mod deriv;
mod histogram;
mod holt_winters;
mod idelta;
mod increase;
mod irate;
mod label_join;
mod label_replace;
mod last_over_time;
mod math_operations;
mod max_over_time;
mod min_over_time;
mod predict_linear;
mod quantile_over_time;
mod rate;
mod resets;
mod scalar;
mod stddev_over_time;
mod stdvar_over_time;
mod sum_over_time;
mod time_operations;
mod vector;

pub(crate) use absent::absent;
pub(crate) use absent_over_time::absent_over_time;
pub(crate) use avg_over_time::avg_over_time;
pub(crate) use changes::changes;
pub(crate) use clamp::clamp;
pub(crate) use count_over_time::count_over_time;
pub(crate) use delta::delta;
pub(crate) use deriv::deriv;
pub(crate) use histogram::histogram_quantile;
pub(crate) use holt_winters::holt_winters;
pub(crate) use idelta::idelta;
pub(crate) use increase::increase;
pub(crate) use irate::irate;
pub(crate) use label_join::label_join;
pub(crate) use label_replace::label_replace;
pub(crate) use last_over_time::last_over_time;
pub(crate) use math_operations::*;
pub(crate) use max_over_time::max_over_time;
pub(crate) use min_over_time::min_over_time;
pub(crate) use predict_linear::predict_linear;
pub(crate) use quantile_over_time::quantile_over_time;
pub(crate) use rate::rate;
pub(crate) use resets::resets;
pub(crate) use scalar::scalar;
pub(crate) use stddev_over_time::stddev_over_time;
pub(crate) use stdvar_over_time::stdvar_over_time;
pub(crate) use sum_over_time::sum_over_time;
pub(crate) use time_operations::*;
pub(crate) use vector::vector;

/// Reference: https://prometheus.io/docs/prometheus/latest/querying/functions/
#[derive(Debug, Clone, Copy, PartialEq, EnumString)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Func {
    Abs,
    Absent,
    AbsentOverTime,
    AvgOverTime,
    Ceil,
    Changes,
    Clamp,
    ClampMax,
    ClampMin,
    CountOverTime,
    DayOfMonth,
    DayOfWeek,
    DayOfYear,
    DaysInMonth,
    Delta,
    Deriv,
    Exp,
    Floor,
    HistogramCount,
    HistogramFraction,
    HistogramQuantile,
    HistogramSum,
    HoltWinters,
    Hour,
    Idelta,
    Increase,
    Irate,
    LabelJoin,
    LabelReplace,
    LastOverTime,
    Ln,
    Log10,
    Log2,
    MaxOverTime,
    MinOverTime,
    Minute,
    Month,
    PredictLinear,
    QuantileOverTime,
    Rate,
    Resets,
    Round,
    Scalar,
    Sgn,
    Sort,
    SortDesc,
    Sqrt,
    StddevOverTime,
    StdvarOverTime,
    SumOverTime,
    Time,
    Timestamp,
    Vector,
    Year,
}

pub static KEEP_METRIC_NAME_FUNC: Lazy<HashSet<&str>> =
    Lazy::new(|| HashSet::from_iter(["last_over_time"]));

/// Trait for PromQL range vector functions.
///
/// This trait defines the interface for range functions that operate on time series data
/// within a specified time window. Range functions (e.g., `rate()`, `increase()`,
/// `avg_over_time()`) compute values based on samples within a sliding time window `[eval_ts -
/// range, eval_ts]`.
///
/// Range functions are typically used with range vector selectors like `http_requests_total[5m]`,
/// where `5m` specifies the lookback range from the evaluation timestamp.
///
/// # Evaluation Model
///
/// For each evaluation timestamp:
/// 1. A time window is determined: `[eval_ts - range, eval_ts]`
/// 2. Samples within this window are extracted from the time series
/// 3. The `exec()` method processes these samples to compute a single value
/// 4. The result becomes a sample at the evaluation timestamp
///
/// # Examples
///
/// ```ignore
/// struct RateFunc;
///
/// impl RangeFunc for RateFunc {
///     fn name(&self) -> &'static str {
///         "rate"
///     }
///
///     fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
///         if samples.len() < 2 {
///             return None;
///         }
///         let first = samples.first().unwrap();
///         let last = samples.last().unwrap();
///         let time_delta = (last.timestamp - first.timestamp) as f64 / 1_000_000.0;
///         Some((last.value - first.value) / time_delta)
///     }
/// }
/// ```
pub trait RangeFunc: Sync {
    /// Returns the name of the range function (e.g., "rate", "avg_over_time", "increase").
    fn name(&self) -> &'static str;

    /// Executes the range function on samples within a time window.
    ///
    /// This method processes samples from a single time series that fall within the window
    /// `[eval_ts - range, eval_ts]` and computes a single aggregated value.
    ///
    /// # Parameters
    ///
    /// * `samples` - Samples within the time window, sorted by timestamp in ascending order. May be
    ///   empty if no samples exist in the window.
    /// * `eval_ts` - The evaluation timestamp (in microseconds) for which to compute the result.
    ///   This is the right endpoint of the time window.
    /// * `range` - The duration of the lookback window. The window spans from `eval_ts - range` to
    ///   `eval_ts`.
    ///
    /// # Returns
    ///
    /// * `Some(f64)` - The computed value for this time window
    /// * `None` - If the function cannot produce a value (e.g., insufficient samples, invalid data,
    ///   or the result should be omitted)
    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64>;
}

pub(crate) fn eval_range<F>(data: Value, func: F, eval_ctx: &EvalContext) -> Result<Value>
where
    F: RangeFunc,
{
    let start = std::time::Instant::now();
    let trace_id = &eval_ctx.trace_id;
    let func_name = func.name();
    log::info!("[trace_id: {trace_id}] [PromQL Timing] eval_range({func_name}) started");

    let data = match data {
        Value::Matrix(v) => {
            log::info!(
                "[trace_id: {trace_id}] [PromQL Timing] eval_range({func_name}) processing {} series",
                v.len()
            );
            v
        }
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "{func_name}: matrix argument expected but got {}",
                v.get_type()
            )));
        }
    };

    // Always use range query path - compute all timestamps at once
    let timestamps = eval_ctx.timestamps();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_range({func_name}) processing {} time points",
        timestamps.len()
    );

    let results: Vec<RangeValue> = data
        .into_par_iter()
        .flat_map(|mut metric| {
            let mut labels = std::mem::take(&mut metric.labels);
            if !KEEP_METRIC_NAME_FUNC.contains(func.name()) {
                labels = labels.without_metric_name();
            }
            let time_window = metric.time_window.as_ref().unwrap();
            let range = time_window.range;
            let range_micros = micros(range);
            let mut result_samples = Vec::with_capacity(timestamps.len());
            let mut start_index = 0;
            let mut end_index = 0;

            // For each eval timestamp, compute the function value
            for &eval_ts in &timestamps {
                // Find samples in the window [eval_ts - range, eval_ts]
                let window_start = eval_ts - range_micros;
                let window_end = eval_ts;

                let window_samples = advance_sample_window(
                    &metric.samples,
                    window_start,
                    window_end,
                    &mut start_index,
                    &mut end_index,
                );

                if window_samples.is_empty() {
                    continue;
                }

                if let Some(value) = func.exec(window_samples, eval_ts, &range) {
                    result_samples.push(Sample::new(eval_ts, value));
                }
            }

            if !result_samples.is_empty() {
                Some(RangeValue {
                    labels,
                    samples: result_samples,
                    exemplars: None,
                    time_window: metric.time_window,
                })
            } else {
                None
            }
        })
        .collect();

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_range({func_name}) completed in {:?}, produced {} series",
        start.elapsed(),
        results.len()
    );
    Ok(Value::Matrix(results))
}

/// Advance two indices through sorted samples for monotonically increasing
/// evaluation windows. This preserves the inclusive `[window_start,
/// window_end]` bounds previously implemented with two `partition_point`
/// calls per window.
fn advance_sample_window<'a>(
    samples: &'a [Sample],
    window_start: i64,
    window_end: i64,
    start_index: &mut usize,
    end_index: &mut usize,
) -> &'a [Sample] {
    while *start_index < samples.len() && samples[*start_index].timestamp < window_start {
        *start_index += 1;
    }
    if *end_index < *start_index {
        *end_index = *start_index;
    }
    while *end_index < samples.len() && samples[*end_index].timestamp <= window_end {
        *end_index += 1;
    }
    &samples[*start_index..*end_index]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_func_enum_parsing_known_functions() {
        assert_eq!("abs".parse::<Func>().unwrap(), Func::Abs);
        assert_eq!("rate".parse::<Func>().unwrap(), Func::Rate);
        assert_eq!("avg_over_time".parse::<Func>().unwrap(), Func::AvgOverTime);
        assert_eq!(
            "histogram_quantile".parse::<Func>().unwrap(),
            Func::HistogramQuantile
        );
        assert_eq!("label_join".parse::<Func>().unwrap(), Func::LabelJoin);
        assert_eq!("label_replace".parse::<Func>().unwrap(), Func::LabelReplace);
    }

    #[test]
    fn test_func_enum_unknown_returns_err() {
        assert!("unknown_function".parse::<Func>().is_err());
        assert!("".parse::<Func>().is_err());
    }

    #[test]
    fn test_keep_metric_name_func_contains_last_over_time() {
        assert!(KEEP_METRIC_NAME_FUNC.contains("last_over_time"));
        assert!(!KEEP_METRIC_NAME_FUNC.contains("rate"));
        assert!(!KEEP_METRIC_NAME_FUNC.contains("avg_over_time"));
    }

    #[test]
    fn test_advance_sample_window_matches_partition_points() {
        let samples = vec![
            Sample::new(0, 0.0),
            Sample::new(5, 1.0),
            Sample::new(5, 2.0),
            Sample::new(10, 3.0),
            Sample::new(20, 4.0),
        ];
        // Monotonic windows cover inclusive boundaries, overlap, a gap with no
        // samples, and recovery after the gap.
        let windows = [(-5, 0), (0, 5), (4, 10), (11, 15), (15, 20)];
        let mut start_index = 0;
        let mut end_index = 0;

        for (window_start, window_end) in windows {
            let expected_start = samples.partition_point(|s| s.timestamp < window_start);
            let expected_end = samples.partition_point(|s| s.timestamp <= window_end);
            let expected = &samples[expected_start..expected_end];
            let actual = advance_sample_window(
                &samples,
                window_start,
                window_end,
                &mut start_index,
                &mut end_index,
            );

            assert_eq!(
                actual
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value))
                    .collect::<Vec<_>>(),
                expected
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value))
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn test_advance_sample_window_handles_empty_samples() {
        let mut start_index = 0;
        let mut end_index = 0;
        assert!(advance_sample_window(&[], 0, 10, &mut start_index, &mut end_index).is_empty());
    }

    #[test]
    fn test_advance_sample_window_matches_reference_across_generated_windows() {
        for sample_step in [1_i64, 3, 11] {
            let mut samples = Vec::new();
            for i in 0..30 {
                let timestamp = i * sample_step;
                samples.push(Sample::new(timestamp, i as f64));
                if i % 5 == 0 {
                    samples.push(Sample::new(timestamp, -(i as f64)));
                }
            }

            for range in [0_i64, 1, 7, 23] {
                for eval_step in [1_i64, 4, 13] {
                    let mut start_index = 0;
                    let mut end_index = 0;
                    for window_end in (0_i64..100).step_by(eval_step as usize) {
                        let window_start = window_end - range;
                        let expected_start =
                            samples.partition_point(|sample| sample.timestamp < window_start);
                        let expected_end =
                            samples.partition_point(|sample| sample.timestamp <= window_end);
                        let actual = advance_sample_window(
                            &samples,
                            window_start,
                            window_end,
                            &mut start_index,
                            &mut end_index,
                        );

                        assert_eq!(
                            actual
                                .iter()
                                .map(|sample| (sample.timestamp, sample.value))
                                .collect::<Vec<_>>(),
                            samples[expected_start..expected_end]
                                .iter()
                                .map(|sample| (sample.timestamp, sample.value))
                                .collect::<Vec<_>>()
                        );
                    }
                }
            }
        }
    }
}

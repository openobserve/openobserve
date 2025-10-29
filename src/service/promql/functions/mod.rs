// Copyright 2025 OpenObserve Inc.
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

use std::time::Duration;

use datafusion::error::{DataFusionError, Result};
use rayon::prelude::*;
use strum::EnumString;

use crate::service::promql::value::{
    ExtrapolationKind, InstantValue, RangeValue, Sample, Value, extrapolated_rate,
};

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
pub(crate) use histogram::{histogram_quantile, histogram_quantile_range};
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
pub(crate) use rate::{rate, rate_range};
pub(crate) use resets::resets;
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

pub(crate) fn eval_idelta(
    data: Value,
    fn_name: &str,
    fn_handler: fn(RangeValue) -> Option<f64>,
    _keep_name_label: bool,
) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "{fn_name}: matrix argument expected but got {}",
                v.get_type()
            )));
        }
    };

    let mut rate_values = Vec::with_capacity(data.len());
    for mut metric in data {
        let labels = std::mem::take(&mut metric.labels);
        // if !keep_name_label {
        //     labels = labels.without_metric_name()
        // };

        let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
        if let Some(value) = fn_handler(metric) {
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
}

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn eval_idelta_range(
    data: Value,
    fn_name: &str,
    fn_handler: fn(RangeValue) -> Option<f64>,
    eval_ctx: &crate::service::promql::value::EvalContext,
) -> Result<Value> {
    use crate::service::promql::micros;

    let start = std::time::Instant::now();
    log::info!("[PromQL Timing] eval_idelta_range({}) started", fn_name);

    let data = match data {
        Value::Matrix(v) => {
            log::info!(
                "[PromQL Timing] eval_idelta_range({}) processing {} series",
                fn_name,
                v.len()
            );
            v
        }
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "{fn_name}: matrix argument expected but got {}",
                v.get_type()
            )));
        }
    };

    // For instant queries, use the original implementation
    if eval_ctx.is_instant() {
        log::info!(
            "[PromQL Timing] eval_idelta_range({}) using instant query path",
            fn_name
        );
        let mut rate_values = Vec::with_capacity(data.len());
        for mut metric in data {
            let labels = std::mem::take(&mut metric.labels);
            let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
            if let Some(value) = fn_handler(metric) {
                rate_values.push(InstantValue {
                    labels,
                    sample: Sample::new(eval_ts, value),
                });
            }
        }
        return Ok(Value::Vector(rate_values));
    }

    // For range queries, compute all timestamps at once
    let timestamps = eval_ctx.timestamps();
    let mut range_values = Vec::with_capacity(data.len());

    log::info!(
        "[PromQL Timing] eval_idelta_range({}) processing {} time points in range query mode",
        fn_name,
        timestamps.len()
    );

    let cfg = config::get_config();
    let thread_num = cfg.limit.query_thread_num;
    let chunk_size = (data.len() / thread_num).max(1);
    log::info!(
        "[PromQL Timing] eval_idelta_range({}) using {} threads with chunk_size {}",
        fn_name,
        thread_num,
        chunk_size
    );

    let parallel_start = std::time::Instant::now();
    let results: Vec<Option<RangeValue>> = data
        .par_chunks(chunk_size)
        .flat_map(|chunk| {
            chunk
                .iter()
                .map(|metric| {
                    let labels = metric.labels.clone();
                    // TODO: pass range information to here
                    // let time_window = metric.time_window.as_ref().unwrap();
                    let range = Duration::from_secs(300); // Default 5min range for rate function
                    let range_micros = micros(range);
                    let mut result_samples = Vec::with_capacity(timestamps.len());

                    // For each eval timestamp, compute the function value
                    for &eval_ts in &timestamps {
                        // Find samples in the window [eval_ts - range, eval_ts]
                        let window_start = eval_ts - range_micros;
                        let window_end = eval_ts;

                        // Extract samples within this window using binary search
                        let start_index = metric
                            .samples
                            .partition_point(|s| s.timestamp < window_start);
                        let end_index = metric
                            .samples
                            .partition_point(|s| s.timestamp <= window_end);
                        let window_samples = &metric.samples[start_index..end_index];

                        if window_samples.is_empty() {
                            continue;
                        }

                        if let Some(value) = extrapolated_rate(
                            window_samples,
                            eval_ts,
                            range,
                            Duration::ZERO,
                            ExtrapolationKind::Rate,
                        ) {
                            result_samples.push(Sample::new(eval_ts, value));
                        }
                    }

                    if !result_samples.is_empty() {
                        Some(RangeValue {
                            labels,
                            samples: result_samples,
                            exemplars: None,
                            time_window: None,
                        })
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();
    log::info!(
        "[PromQL Timing] eval_idelta_range({}) parallel processing took: {:?}",
        fn_name,
        parallel_start.elapsed()
    );

    range_values.extend(results.into_iter().flatten());

    log::info!(
        "[PromQL Timing] eval_idelta_range({}) completed in {:?}, produced {} series",
        fn_name,
        start.elapsed(),
        range_values.len()
    );
    Ok(Value::Matrix(range_values))
}

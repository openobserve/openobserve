// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use datafusion::error::{DataFusionError, Result};

use crate::service::promql::value::{InstantValue, RangeValue, Sample, Value};

mod absent;
mod absent_over_time;
mod avg_over_time;
mod changes;
mod clamp;
mod count_over_time;
mod delta;
mod histogram;
mod idelta;
mod increase;
mod irate;
mod label_join;
mod label_replace;
mod last_over_time;
mod math_operations;
mod max_over_time;
mod min_over_time;
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
pub(crate) use histogram::histogram_quantile;
pub(crate) use idelta::idelta;
pub(crate) use increase::increase;
pub(crate) use irate::irate;
pub(crate) use label_join::label_join;
pub(crate) use label_replace::label_replace;
pub(crate) use last_over_time::last_over_time;
pub(crate) use math_operations::*;
pub(crate) use max_over_time::max_over_time;
pub(crate) use min_over_time::min_over_time;
pub(crate) use rate::rate;
pub(crate) use resets::resets;
pub(crate) use stddev_over_time::stddev_over_time;
pub(crate) use stdvar_over_time::stdvar_over_time;
use strum::EnumString;
pub(crate) use sum_over_time::sum_over_time;
pub(crate) use time_operations::*;
pub(crate) use vector::vector;

use super::value::LabelsExt;

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
    data: &Value,
    fn_name: &str,
    fn_handler: fn(&RangeValue) -> Option<f64>,
    keep_name_label: bool,
) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "{fn_name}: matrix argument expected"
            )))
        }
    };

    let mut rate_values = Vec::with_capacity(data.len());
    for metric in data {
        let labels = if keep_name_label {
            metric.labels.clone()
        } else {
            metric.labels.without_metric_name()
        };

        if let Some(value) = fn_handler(metric) {
            let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
}

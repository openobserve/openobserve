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

use crate::meta::prom::NAME_LABEL;
use crate::service::promql::value::{InstantValue, RangeValue, Sample, Value};

mod avg_over_time;
mod count_over_time;
mod delta;
mod histogram;
mod idelta;
mod increase;
mod irate;
mod max_over_time;
mod min_over_time;
mod rate;
mod sum_over_time;

pub(crate) use avg_over_time::avg_over_time;
pub(crate) use count_over_time::count_over_time;
pub(crate) use delta::delta;
pub(crate) use histogram::histogram_quantile;
pub(crate) use idelta::idelta;
pub(crate) use increase::increase;
pub(crate) use irate::irate;
pub(crate) use max_over_time::max_over_time;
pub(crate) use min_over_time::min_over_time;
pub(crate) use rate::rate;
pub(crate) use sum_over_time::sum_over_time;

use strum::EnumString;

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
        let mut labels = metric.labels.clone();
        labels.retain(|l| l.name != NAME_LABEL);
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

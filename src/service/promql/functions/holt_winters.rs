// Copyright 2023 Zinc Labs Inc.
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

use crate::service::promql::common::calculate_trend;
use crate::service::promql::value::{InstantValue, LabelsExt, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#holt_winters
pub(crate) fn holt_winters(data: &Value, scaling_factor: f64, trend_factor: f64) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "holt_winters: matrix argument expected got {}",
                v.get_type()
            )))
        }
    };

    let mut rate_values = Vec::with_capacity(data.len());
    for metric in data {
        let labels = metric.labels.without_metric_name();
        if let Some(value) = holt_winters_calculation(metric, scaling_factor, trend_factor) {
            let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
}

pub fn holt_winters_calculation(
    data: &RangeValue,
    smoothing_factor: f64,
    trend_factor: f64,
) -> Option<f64> {
    if data.samples.len() < 2 {
        return None;
    }

    let mut previous_smoothed = 0.0;
    let mut current_smoothed = data.samples[0].value;
    let mut trend = data.samples[1].value - data.samples[0].value;

    for (i, &sample) in data.samples[1..].iter().enumerate() {
        let scaled_value = smoothing_factor * sample.value;
        trend = calculate_trend(
            i as i64,
            trend_factor,
            previous_smoothed,
            current_smoothed,
            trend,
        );
        let scaled_trend = (1.0 - smoothing_factor) * (current_smoothed + trend);
        previous_smoothed = current_smoothed;
        current_smoothed = scaled_value + scaled_trend;
    }

    Some(current_smoothed)
}

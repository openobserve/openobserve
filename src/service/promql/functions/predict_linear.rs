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

use datafusion::error::{DataFusionError, Result};

use crate::service::promql::common::linear_regression;
use crate::service::promql::value::{InstantValue, LabelsExt, Sample, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#predict_linear
pub(crate) fn predict_linear(data: &Value, duration: f64) -> Result<Value> {
    exec(data, duration)
}

fn exec(data: &Value, duration: f64) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "predict_linear: matrix argument expected, got {}",
                v.get_type()
            )))
        }
    };

    let mut rate_values = Vec::with_capacity(data.len());
    for metric in data {
        let labels = metric.labels.without_metric_name();

        let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
        if let Some((slope, intercept)) = linear_regression(&metric.samples, eval_ts / 1000) {
            let value = slope * duration + intercept;
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
}

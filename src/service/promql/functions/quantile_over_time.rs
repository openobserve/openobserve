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

use crate::service::promql::common::quantile;
use crate::service::promql::value::{InstantValue, Labels, LabelsExt, Sample, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#quantile_over_time
pub(crate) fn quantile_over_time(timestamp: i64, phi_quantile: f64, data: &Value) -> Result<Value> {
    eval(data, phi_quantile, timestamp, false)
}

pub(crate) fn eval(
    data: &Value,
    phi_quantile: f64,
    timestamp: i64,
    keep_name_label: bool,
) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "quantile_over_time: matrix argument expected, got {:?}",
                v.get_type()
            )))
        }
    };

    if data.is_empty() {
        return prepare_vector(timestamp, f64::NAN);
    }

    let mut rate_values = Vec::with_capacity(data.len());
    for metric in data {
        let labels = if keep_name_label {
            metric.labels.clone()
        } else {
            metric.labels.without_metric_name()
        };

        let input: Vec<f64> = metric.samples.iter().map(|x| x.value).collect();

        if let Some(value) = quantile(&input, phi_quantile) {
            let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
}

fn prepare_vector(timestamp: i64, value: f64) -> Result<Value> {
    let values = vec![InstantValue {
        labels: Labels::default(),
        sample: Sample { timestamp, value },
    }];
    Ok(Value::Vector(values))
}

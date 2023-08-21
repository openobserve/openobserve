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

use crate::service::promql::value::{InstantValue, LabelsExt, Sample, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: &Value, min: f64, max: f64) -> Result<Value> {
    let vec = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "clamp: InstantValue argument expected".into(),
            ))
        }
    };

    let out = vec
        .iter()
        .map(|instant| {
            let value = instant.sample.value.clamp(min, max);
            InstantValue {
                sample: Sample::new(instant.sample.timestamp, value),
                labels: instant.labels.without_metric_name(),
            }
        })
        .collect();
    Ok(Value::Vector(out))
}

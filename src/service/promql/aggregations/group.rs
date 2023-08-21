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

use crate::service::promql::value::{InstantValue, Sample, Value};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

/// https://prometheus.io/docs/prometheus/latest/querying/operators/#aggregation-operators
pub fn group(timestamp: i64, param: &Option<LabelModifier>, data: &Value) -> Result<Value> {
    let score_values = super::eval_arithmetic(param, data, "group", |_total, _val| 1.0)?;
    if score_values.is_none() {
        return Ok(Value::None);
    }
    let values = score_values
        .unwrap()
        .par_iter()
        .map(|v| InstantValue {
            labels: v.1.labels.clone(),
            sample: Sample::new(timestamp, v.1.value),
        })
        .collect();
    Ok(Value::Vector(values))
}

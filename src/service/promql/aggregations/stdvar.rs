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

use crate::service::promql::common::std_variance2;
use crate::service::promql::value::{InstantValue, Sample, Value};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

pub fn stdvar(timestamp: i64, param: &Option<LabelModifier>, data: &Value) -> Result<Value> {
    let score_values = super::eval_std_dev_var(param, data, "stdvar")?;
    if score_values.is_none() {
        return Ok(Value::None);
    }
    let values = score_values
        .unwrap()
        .par_iter()
        .map(|it| {
            let std_var =
                std_variance2(&it.1.values, it.1.current_mean, it.1.current_count).unwrap();
            InstantValue {
                labels: it.1.labels.clone(),
                sample: Sample::new(timestamp, std_var),
            }
        })
        .collect();
    Ok(Value::Vector(values))
}

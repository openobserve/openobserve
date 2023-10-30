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

use super::Engine;
use crate::service::promql::value::{InstantValue, Label, Sample, Value};
use datafusion::error::DataFusionError;
use datafusion::error::Result;
use promql_parser::parser::Expr as PromExpr;
use promql_parser::parser::LabelModifier;

pub async fn count_values(
    ctx: &mut Engine,
    timestamp: i64,
    param: Box<PromExpr>,
    modifier: &Option<LabelModifier>,
    data: &Value,
) -> Result<Value> {
    let param = ctx.exec_expr(&param).await?;
    let label_name = match param {
        Value::String(v) => v,
        _ => {
            return Err(DataFusionError::Plan(
                "[label_name] param must be a String".to_string(),
            ));
        }
    };
    if !Label::is_valid_label_name(&label_name) {
        return Err(DataFusionError::Plan(
            "[label_name] param invalid. Check https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels".to_string(),
        ));
    }
    let score_values = super::eval_count_values(modifier, data, "count_values", &label_name)?;
    if score_values.is_none() {
        return Ok(Value::None);
    }

    let values = score_values
        .unwrap()
        .values()
        .map(|it| InstantValue {
            labels: it.labels.clone(),
            sample: Sample::new(timestamp, it.count as f64),
        })
        .collect();

    Ok(Value::Vector(values))
}

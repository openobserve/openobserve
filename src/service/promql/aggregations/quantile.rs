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
use crate::service::promql::common::quantile as calculate_quantile;
use crate::service::promql::value::Labels;
use crate::service::promql::value::{InstantValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::Expr as PromExpr;
use rayon::prelude::*;

pub async fn quantile(
    ctx: &mut Engine,
    timestamp: i64,
    param: Box<PromExpr>,
    data: &Value,
) -> Result<Value> {
    let param = ctx.exec_expr(&param).await?;
    let qtile = match param {
        Value::Float(v) => v,
        _ => {
            return Err(DataFusionError::Plan(
                "[quantile] param must be a NumberLiteral".to_string(),
            ))
        }
    };
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "[quantile] function only accept vector values".to_string(),
            ))
        }
    };

    if qtile < 0 as f64 || qtile > 1_f64 || qtile.is_nan() {
        let value = match qtile.signum() as i32 {
            1 => f64::INFINITY,
            -1 => f64::NEG_INFINITY,
            _ => f64::NAN,
        };
        return prepare_vector(timestamp, value);
    }

    if data.is_empty() {
        return prepare_vector(timestamp, f64::NAN);
    }

    let values: Vec<f64> = data.par_iter().map(|item| item.sample.value).collect();

    let quantile_value = calculate_quantile(&values, qtile).unwrap();
    prepare_vector(timestamp, quantile_value)
}

fn prepare_vector(timestamp: i64, value: f64) -> Result<Value> {
    let values = vec![InstantValue {
        labels: Labels::default(),
        sample: Sample { timestamp, value },
    }];
    Ok(Value::Vector(values))
}

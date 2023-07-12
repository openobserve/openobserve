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

use super::Engine;
use crate::common::meta::prom::NAME_LABEL;
use crate::service::promql::value::Label;
use crate::service::promql::value::{signature, Labels, Signature, Value};
use ahash::AHashMap as HashMap;
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::Expr as PromExpr;
use promql_parser::parser::LabelModifier;
use std::collections::HashSet;
use std::sync::Arc;

mod avg;
mod bottomk;
mod count;
mod max;
mod min;
mod quantile;
mod stddev;
mod stdvar;
mod sum;
mod topk;

pub(crate) use avg::avg;
pub(crate) use bottomk::bottomk;
pub(crate) use count::count;
pub(crate) use max::max;
pub(crate) use min::min;
pub(crate) use quantile::quantile;
pub(crate) use stddev::stddev;
pub(crate) use stdvar::stdvar;
pub(crate) use sum::sum;
pub(crate) use topk::topk;

#[derive(Debug, Clone, Default)]
pub(crate) struct ArithmeticItem {
    pub(crate) labels: Labels,
    pub(crate) value: f64,
    pub(crate) num: usize,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct StatisticItems {
    pub(crate) labels: Labels,
    pub(crate) values: Vec<f64>,
    pub(crate) current_count: i64,
    pub(crate) current_mean: f64,
    pub(crate) current_sum: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct TopItem {
    pub(crate) index: usize,
    pub(crate) value: f64,
}

pub fn labels_to_include(
    include_labels: &HashSet<String>,
    actual_labels: &[Arc<Label>],
) -> Vec<Arc<Label>> {
    actual_labels
        .iter()
        .flat_map(|label| {
            if include_labels.contains(&label.name) && label.name != NAME_LABEL {
                Some(label.clone())
            } else {
                None
            }
        })
        .collect()
}

pub fn labels_to_exclude(
    exclude_labels: &HashSet<String>,
    actual_labels: &[Arc<Label>],
) -> Vec<Arc<Label>> {
    actual_labels
        .iter()
        .flat_map(|label| {
            if !exclude_labels.contains(&label.name) && label.name != NAME_LABEL {
                Some(label.clone())
            } else {
                None
            }
        })
        .collect()
}

fn eval_arithmetic_processor(
    score_values: &mut HashMap<Signature, ArithmeticItem>,
    f_handler: fn(total: f64, val: f64) -> f64,
    sum_labels: &Labels,
    value: f64,
) {
    let sum_hash = signature(sum_labels);
    let entry = score_values.entry(sum_hash).or_insert(ArithmeticItem {
        labels: sum_labels.clone(),
        ..Default::default()
    });
    entry.value = f_handler(entry.value, value);
    entry.num += 1;
}

fn eval_std_dev_var_processor(
    score_values: &mut HashMap<Signature, StatisticItems>,
    sum_labels: &Labels,
    value: f64,
) {
    let sum_hash = signature(sum_labels);
    let entry = score_values.entry(sum_hash).or_insert(StatisticItems {
        labels: sum_labels.clone(),
        ..Default::default()
    });
    entry.values.push(value);
    entry.current_count += 1;
    entry.current_sum += value;
    entry.current_mean = entry.current_sum / entry.current_count as f64;
}

pub(crate) fn eval_arithmetic(
    param: &Option<LabelModifier>,
    data: &Value,
    f_name: &str,
    f_handler: fn(total: f64, val: f64) -> f64,
) -> Result<Option<HashMap<Signature, ArithmeticItem>>> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{f_name}] function only accept vector values"
            )))
        }
    };

    let mut score_values = HashMap::default();
    match param {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                for item in data.iter() {
                    let sum_labels = labels_to_include(labels, &item.labels);
                    eval_arithmetic_processor(
                        &mut score_values,
                        f_handler,
                        &sum_labels,
                        item.sample.value,
                    );
                }
            }
            LabelModifier::Exclude(labels) => {
                for item in data.iter() {
                    let sum_labels = labels_to_exclude(labels, &item.labels);
                    eval_arithmetic_processor(
                        &mut score_values,
                        f_handler,
                        &sum_labels,
                        item.sample.value,
                    );
                }
            }
        },
        None => {
            for item in data.iter() {
                let sum_labels = Labels::default();
                eval_arithmetic_processor(
                    &mut score_values,
                    f_handler,
                    &sum_labels,
                    item.sample.value,
                );
            }
        }
    }
    Ok(Some(score_values))
}

pub async fn eval_top(
    ctx: &mut Engine,
    param: Box<PromExpr>,
    data: &Value,
    is_bottom: bool,
) -> Result<Value> {
    let fn_name = if is_bottom { "bottomk" } else { "topk" };

    let param = ctx.exec_expr(&param).await?;
    let n = match param {
        Value::Float(v) => v as usize,
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{fn_name}] param must be NumberLiteral"
            )))
        }
    };

    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{fn_name}] function only accept vector values"
            )))
        }
    };

    let mut score_values = Vec::new();
    for (i, item) in data.iter().enumerate() {
        if item.sample.value.is_nan() {
            continue;
        }
        score_values.push(TopItem {
            index: i,
            value: item.sample.value,
        });
    }

    if is_bottom {
        score_values.sort_by(|a, b| a.value.partial_cmp(&b.value).unwrap());
    } else {
        score_values.sort_by(|a, b| b.value.partial_cmp(&a.value).unwrap());
    }
    let values = score_values
        .iter()
        .take(n)
        .map(|v| data[v.index].clone())
        .collect();
    Ok(Value::Vector(values))
}

pub(crate) fn eval_std_dev_var(
    param: &Option<LabelModifier>,
    data: &Value,
    f_name: &str,
) -> Result<Option<HashMap<Signature, StatisticItems>>> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{f_name}] function only accepts vector values"
            )))
        }
    };

    let mut score_values = HashMap::default();
    match param {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                for item in data.iter() {
                    let sum_labels = labels_to_include(labels, &item.labels);
                    eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
                }
            }
            LabelModifier::Exclude(labels) => {
                for item in data.iter() {
                    let sum_labels = labels_to_exclude(labels, &item.labels);
                    eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
                }
            }
        },
        None => {
            for item in data.iter() {
                let sum_labels = Labels::default();
                eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
            }
        }
    }
    Ok(Some(score_values))
}

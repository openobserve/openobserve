// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{collections::HashMap, sync::Arc};

use config::{FxIndexMap, meta::promql::NAME_LABEL, utils::sort::sort_float};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{Expr as PromExpr, LabelModifier};
use rayon::prelude::*;

use crate::service::promql::{
    Engine,
    value::{InstantValue, Label, Labels, LabelsExt, Sample, Value},
};

mod avg;
mod bottomk;
mod count;
mod count_values;
mod group;
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
pub(crate) use count_values::count_values;
pub(crate) use group::group;
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
pub(crate) struct CountValuesItem {
    pub(crate) labels: Labels,
    pub(crate) count: u64,
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
    include_labels: &[String],
    mut actual_labels: Vec<Arc<Label>>,
) -> Vec<Arc<Label>> {
    actual_labels.retain(|label| include_labels.contains(&label.name));
    actual_labels
}

pub fn labels_to_exclude(
    exclude_labels: &[String],
    mut actual_labels: Vec<Arc<Label>>,
) -> Vec<Arc<Label>> {
    actual_labels.retain(|label| !exclude_labels.contains(&label.name) && label.name != NAME_LABEL);
    actual_labels
}

fn eval_arithmetic_processor(
    score_values: &mut HashMap<u64, ArithmeticItem>,
    f_handler: fn(total: f64, val: f64) -> f64,
    sum_labels: &Labels,
    value: f64,
) {
    let sum_hash = sum_labels.signature();
    let entry = score_values
        .entry(sum_hash)
        .or_insert_with(|| ArithmeticItem {
            labels: sum_labels.clone(),
            ..Default::default()
        });
    entry.value = f_handler(entry.value, value);
    entry.num += 1;
}

fn eval_count_values_processor(
    score_values: &mut HashMap<u64, CountValuesItem>,
    sum_labels: &Labels,
) {
    let sum_hash = sum_labels.signature();
    let entry = score_values
        .entry(sum_hash)
        .or_insert_with(|| CountValuesItem {
            labels: sum_labels.clone(),
            ..Default::default()
        });
    entry.count += 1;
}

fn eval_std_dev_var_processor(
    score_values: &mut HashMap<u64, StatisticItems>,
    sum_labels: &Labels,
    value: f64,
) {
    let sum_hash = sum_labels.signature();
    let entry = score_values
        .entry(sum_hash)
        .or_insert_with(|| StatisticItems {
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
    data: Value,
    f_name: &str,
    f_handler: fn(total: f64, val: f64) -> f64,
) -> Result<Option<HashMap<u64, ArithmeticItem>>> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{f_name}] function only accept vector values"
            )));
        }
    };

    let mut score_values = HashMap::default();
    match param {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                for item in data.into_iter() {
                    let sum_labels = labels_to_include(&labels.labels, item.labels);
                    eval_arithmetic_processor(
                        &mut score_values,
                        f_handler,
                        &sum_labels,
                        item.sample.value,
                    );
                }
            }
            LabelModifier::Exclude(labels) => {
                for item in data.into_iter() {
                    let sum_labels = labels_to_exclude(&labels.labels, item.labels);
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
            for item in data.into_iter() {
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
    data: Value,
    modifier: &Option<LabelModifier>,
    is_bottom: bool,
) -> Result<Value> {
    let fn_name = if is_bottom { "bottomk" } else { "topk" };

    let param = ctx.exec_expr(&param).await?;
    let n = match param {
        Value::Float(v) => v as usize,
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{fn_name}] param must be NumberLiteral"
            )));
        }
    };

    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{fn_name}] function only accept vector values"
            )));
        }
    };

    let data_for_labels = data.clone();
    let mut score_values: FxIndexMap<u64, Vec<TopItem>> = Default::default();
    match modifier {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                for (i, item) in data_for_labels.into_iter().enumerate() {
                    let sum_labels = labels_to_include(&labels.labels, item.labels);
                    if item.sample.value.is_nan() {
                        continue;
                    }
                    let signature = sum_labels.signature();
                    let value = score_values.entry(signature).or_default();
                    value.push(TopItem {
                        index: i,
                        value: item.sample.value,
                    });
                }
            }
            LabelModifier::Exclude(labels) => {
                for (i, item) in data_for_labels.into_iter().enumerate() {
                    let sum_labels = labels_to_exclude(&labels.labels, item.labels);
                    if item.sample.value.is_nan() {
                        continue;
                    }
                    let signature = sum_labels.signature();
                    let value = score_values.entry(signature).or_default();
                    value.push(TopItem {
                        index: i,
                        value: item.sample.value,
                    });
                }
            }
        },
        None => {
            for (i, item) in data_for_labels.into_iter().enumerate() {
                let sum_labels = Labels::default();
                if item.sample.value.is_nan() {
                    continue;
                }
                let signature = sum_labels.signature();
                let value = score_values.entry(signature).or_default();
                value.push(TopItem {
                    index: i,
                    value: item.sample.value,
                });
            }
        }
    }

    let comparator = if is_bottom {
        |a: &TopItem, b: &TopItem| sort_float(&a.value, &b.value)
    } else {
        |a: &TopItem, b: &TopItem| sort_float(&b.value, &a.value)
    };

    let values = score_values
        .into_values()
        .flat_map(|mut items| {
            items.sort_by(comparator);
            items.into_iter().take(n).collect::<Vec<_>>()
        })
        .map(|item| data[item.index].clone())
        .collect();
    Ok(Value::Vector(values))
}

pub(crate) fn eval_std_dev_var(
    param: &Option<LabelModifier>,
    data: Value,
    f_name: &str,
) -> Result<Option<HashMap<u64, StatisticItems>>> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{f_name}] function only accepts vector values"
            )));
        }
    };

    let mut score_values = HashMap::default();
    match param {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                for item in data.into_iter() {
                    let sum_labels = labels_to_include(&labels.labels, item.labels);
                    eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
                }
            }
            LabelModifier::Exclude(labels) => {
                for item in data.into_iter() {
                    let sum_labels = labels_to_exclude(&labels.labels, item.labels);
                    eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
                }
            }
        },
        None => {
            for item in data.into_iter() {
                let sum_labels = Labels::default();
                eval_std_dev_var_processor(&mut score_values, &sum_labels, item.sample.value);
            }
        }
    }
    Ok(Some(score_values))
}

pub(crate) fn eval_count_values(
    param: &Option<LabelModifier>,
    data: Value,
    f_name: &str,
    label_name: &str,
) -> Result<Option<HashMap<u64, CountValuesItem>>> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{f_name}] function only accept vector values"
            )));
        }
    };

    let mut score_values = HashMap::default();
    match param {
        Some(v) => match v {
            LabelModifier::Include(labels) => {
                let mut labels = labels.labels.clone();
                labels.push(label_name.to_string());
                for item in data.into_iter() {
                    let sum_labels = labels_to_include(&labels, item.labels);
                    eval_count_values_processor(&mut score_values, &sum_labels);
                }
            }
            LabelModifier::Exclude(labels) => {
                let mut labels = labels.labels.clone();
                labels.push(label_name.to_string());
                for item in data.into_iter() {
                    let sum_labels = labels_to_exclude(&labels, item.labels);
                    eval_count_values_processor(&mut score_values, &sum_labels);
                }
            }
        },
        None => {
            for item in data.into_iter() {
                let mut sum_labels = Labels::default();
                sum_labels.set(label_name, item.sample.value.to_string().as_str());
                eval_count_values_processor(&mut score_values, &sum_labels);
            }
        }
    }
    Ok(Some(score_values))
}

pub(crate) fn prepare_vector(timestamp: i64, value: f64) -> Result<Value> {
    let values = vec![InstantValue {
        labels: Labels::default(),
        sample: Sample { timestamp, value },
    }];
    Ok(Value::Vector(values))
}

pub(crate) fn score_to_instant_value(
    timestamp: i64,
    score_values: Option<HashMap<u64, ArithmeticItem>>,
) -> Vec<InstantValue> {
    score_values
        .unwrap()
        .into_par_iter()
        .map(|(_, mut v)| InstantValue {
            labels: std::mem::take(&mut v.labels),
            sample: Sample::new(timestamp, v.value),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test data helpers
    fn create_test_labels() -> Labels {
        vec![
            Arc::new(Label::new("instance", "localhost:9090")),
            Arc::new(Label::new("job", "prometheus")),
            Arc::new(Label::new("__name__", "http_requests_total")),
        ]
    }

    fn create_test_vector() -> Value {
        let labels1 = vec![
            Arc::new(Label::new("instance", "localhost:9090")),
            Arc::new(Label::new("job", "prometheus")),
        ];
        let labels2 = vec![
            Arc::new(Label::new("instance", "localhost:9091")),
            Arc::new(Label::new("job", "prometheus")),
        ];

        Value::Vector(vec![
            InstantValue {
                labels: labels1,
                sample: Sample::new(1000000, 10.0),
            },
            InstantValue {
                labels: labels2,
                sample: Sample::new(1000000, 20.0),
            },
        ])
    }

    #[test]
    fn test_labels_to_include() {
        let actual_labels = create_test_labels();
        let include_labels = vec!["instance".to_string(), "job".to_string()];

        let result = labels_to_include(&include_labels, actual_labels.clone());

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|l| l.name == "instance"));
        assert!(result.iter().any(|l| l.name == "job"));
        assert!(!result.iter().any(|l| l.name == "__name__"));
    }

    #[test]
    fn test_labels_to_exclude_removes_name_label() {
        let actual_labels = create_test_labels();
        let exclude_labels = vec!["instance".to_string()];

        let result = labels_to_exclude(&exclude_labels, actual_labels.clone());

        // Should not contain __name__ label (which is NAME_LABEL)
        assert!(!result.iter().any(|l| l.name == "__name__"));
    }

    #[test]
    fn test_eval_arithmetic_processor() {
        let mut score_values = HashMap::new();
        let sum_labels = create_test_labels();
        let f_handler = |total: f64, val: f64| total + val;

        eval_arithmetic_processor(&mut score_values, f_handler, &sum_labels, 10.0);
        eval_arithmetic_processor(&mut score_values, f_handler, &sum_labels, 20.0);

        let signature = sum_labels.signature();
        let item = score_values.get(&signature).unwrap();

        assert_eq!(item.value, 30.0);
        assert_eq!(item.num, 2);
    }

    #[test]
    fn test_eval_count_values_processor() {
        let mut score_values = HashMap::new();
        let sum_labels = create_test_labels();

        eval_count_values_processor(&mut score_values, &sum_labels);
        eval_count_values_processor(&mut score_values, &sum_labels);

        let signature = sum_labels.signature();
        let item = score_values.get(&signature).unwrap();

        assert_eq!(item.count, 2);
    }

    #[test]
    fn test_eval_std_dev_var_processor() {
        let mut score_values = HashMap::new();
        let sum_labels = create_test_labels();

        eval_std_dev_var_processor(&mut score_values, &sum_labels, 10.0);
        eval_std_dev_var_processor(&mut score_values, &sum_labels, 20.0);

        let signature = sum_labels.signature();
        let item = score_values.get(&signature).unwrap();

        assert_eq!(item.values, vec![10.0, 20.0]);
        assert_eq!(item.current_count, 2);
        assert_eq!(item.current_sum, 30.0);
        assert_eq!(item.current_mean, 15.0);
    }

    #[test]
    fn test_eval_arithmetic_with_exclude_labels() {
        let data = create_test_vector();
        let exclude_labels = LabelModifier::Exclude(promql_parser::label::Labels {
            labels: vec!["instance".to_string()],
        });

        let result = eval_arithmetic(
            &Some(exclude_labels),
            data,
            "test_function",
            |total: f64, val: f64| total + val,
        )
        .unwrap()
        .unwrap();

        assert_eq!(result.len(), 1); // Only job label remains
    }

    #[test]
    fn test_eval_std_dev_var_with_include_labels() {
        let data = create_test_vector();
        let include_labels = LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["instance".to_string()],
        });

        let result = eval_std_dev_var(&Some(include_labels), data, "stddev")
            .unwrap()
            .unwrap();

        assert_eq!(result.len(), 2); // Two different instance values
    }

    #[test]
    fn test_eval_count_values_with_include_labels() {
        let data = create_test_vector();
        let include_labels = LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["instance".to_string()],
        });

        let result = eval_count_values(&Some(include_labels), data, "count_values", "value_label")
            .unwrap()
            .unwrap();

        assert_eq!(result.len(), 2); // Two different instance values
    }

    #[test]
    fn test_eval_count_values_with_none_value() {
        let result = eval_count_values(&None, Value::None, "count_values", "value_label").unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn test_eval_count_values_with_invalid_value_type() {
        let result = eval_count_values(&None, Value::Float(10.0), "count_values", "value_label");

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.to_string()
                .contains("function only accept vector values")
        );
    }

    #[test]
    fn test_prepare_vector() {
        let timestamp = 1000000;
        let value = 42.5;

        let result = prepare_vector(timestamp, value).unwrap();

        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 1);
                let instant_value = &values[0];
                assert_eq!(instant_value.sample.timestamp, timestamp);
                assert_eq!(instant_value.sample.value, value);
                assert!(instant_value.labels.is_empty());
            }
            _ => panic!("Expected Vector result"),
        }
    }

    #[test]
    #[should_panic(expected = "called `Option::unwrap()` on a `None` value")]
    fn test_score_to_instant_value_with_none() {
        let timestamp = 1000000;

        // This should panic due to unwrap() on None
        score_to_instant_value(timestamp, None);
    }
}

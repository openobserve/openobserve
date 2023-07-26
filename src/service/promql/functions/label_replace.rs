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

use crate::service::promql::value::{InstantValue, Label, LabelsExt, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::prelude::*;
use regex::{self, Regex};
use std::sync::Arc;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_replace
pub(crate) fn label_replace(
    data: &Value,
    dest_label: &str,
    replacement: &str,
    source_label: &str,
    regex: &str,
) -> Result<Value> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "label_replace: vector argument expected".into(),
            ))
        }
    };

    // Check if the destination label is a valid name
    if !Label::is_valid_label_name(dest_label) {
        return Err(DataFusionError::NotImplemented(format!(
            "label_replace: invalid destination label provided {dest_label}"
        )));
    }

    let re = Regex::new(regex)
        .map_err(|_e| DataFusionError::NotImplemented("Invalid regex found".into()))?;

    let rate_values: Vec<InstantValue> = data
        .par_iter()
        .map(|instant| {
            let labels = if replacement.is_empty() {
                instant.labels.without_label(dest_label)
            } else {
                let label_value = instant.labels.get_value(source_label);
                let output_value = re.replace_all(&label_value, replacement);
                let mut new_labels = instant.labels.clone();
                if output_value != label_value {
                    new_labels.push(Arc::new(Label {
                        name: dest_label.to_string(),
                        value: output_value.to_string(),
                    }));
                }
                new_labels
            };
            InstantValue {
                labels,
                sample: instant.sample,
            }
        })
        .collect();
    Ok(Value::Vector(rate_values))
}

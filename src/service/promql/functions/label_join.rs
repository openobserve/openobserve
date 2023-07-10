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

use datafusion::error::{DataFusionError, Result};
use itertools::Itertools;
use std::{collections::HashSet, sync::Arc};

use crate::{
    common::meta::prom::NAME_LABEL,
    service::promql::value::{InstantValue, Label, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_join
pub(crate) fn label_join(
    data: &Value,
    dest_label: &str,
    separator: &str,
    source_labels: Vec<String>,
) -> Result<Value> {
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "label_join: vector argument expected".into(),
            ))
        }
    };

    let keep_source_labels: HashSet<String> = HashSet::from_iter(source_labels);
    let rate_values: Vec<InstantValue> = data
        .iter()
        .map(|instant| {
            let new_label = instant
                .labels
                .iter()
                .filter(|l| l.name != NAME_LABEL && keep_source_labels.contains(&l.name))
                .map(|label| label.value.clone())
                .join(separator);

            let mut new_labels = instant.labels.clone();
            new_labels.push(Arc::new(Label {
                name: dest_label.to_string(),
                value: new_label,
            }));
            InstantValue {
                labels: new_labels,
                sample: instant.sample,
            }
        })
        .collect();
    Ok(Value::Vector(rate_values))
}

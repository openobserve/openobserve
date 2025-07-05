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

use std::{collections::HashSet, sync::Arc};

use config::meta::promql::NAME_LABEL;
use datafusion::error::{DataFusionError, Result};
use itertools::Itertools;

use crate::service::promql::value::{InstantValue, Label, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_join
pub(crate) fn label_join(
    data: Value,
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
            ));
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
                sample: instant.sample.clone(),
            }
        })
        .collect();
    Ok(Value::Vector(rate_values))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_join_function() {
        let eval_ts = 1000;

        // Create instant values with labels
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "web")),
        ];

        let instant_value1 = InstantValue {
            labels: labels1,
            sample: crate::service::promql::value::Sample::new(eval_ts, 42.0),
        };

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "web")),
        ];

        let instant_value2 = InstantValue {
            labels: labels2,
            sample: crate::service::promql::value::Sample::new(eval_ts, 43.0),
        };

        let vector = Value::Vector(vec![instant_value1, instant_value2]);
        let source_labels = vec!["instance".to_string(), "job".to_string()];
        let result = label_join(vector, "combined", "-", source_labels).unwrap();

        // Should return a vector with joined labels
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 2);
                // Check that the combined label was added
                let combined_label1 = v[0].labels.iter().find(|l| l.name == "combined");
                let combined_label2 = v[1].labels.iter().find(|l| l.name == "combined");
                assert!(combined_label1.is_some());
                assert!(combined_label2.is_some());
                assert_eq!(combined_label1.unwrap().value, "server1-web");
                assert_eq!(combined_label2.unwrap().value, "server2-web");
            }
            _ => panic!("Expected Vector result"),
        }
    }
}

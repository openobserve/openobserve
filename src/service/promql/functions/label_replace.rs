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

use std::sync::Arc;

use config::meta::promql::value::{Label, LabelsExt, RangeValue, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use regex::Regex;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_replace
pub(crate) fn label_replace(
    data: Value,
    dest_label: &str,
    replacement: &str,
    source_label: &str,
    regex: &str,
) -> Result<Value> {
    match data {
        Value::Matrix(matrix) => {
            // Check if the destination label is a valid name
            if !Label::is_valid_label_name(dest_label) {
                return Err(DataFusionError::NotImplemented(format!(
                    "label_replace: invalid destination label provided {dest_label}"
                )));
            }

            let re = Regex::new(regex)
                .map_err(|_e| DataFusionError::NotImplemented("Invalid regex found".into()))?;

            let out: Vec<RangeValue> = matrix
                .into_par_iter()
                .map(|mut range_value| {
                    let mut labels = std::mem::take(&mut range_value.labels);
                    let labels = if replacement.is_empty() {
                        labels.without_label(dest_label)
                    } else {
                        let label_value = labels.get_value(source_label);
                        let output_value = re.replace_all(&label_value, replacement);
                        if output_value != label_value {
                            labels.push(Arc::new(Label {
                                name: dest_label.to_string(),
                                value: output_value.to_string(),
                            }));
                        }
                        labels
                    };
                    RangeValue {
                        labels,
                        samples: range_value.samples,
                        exemplars: range_value.exemplars,
                        time_window: range_value.time_window,
                    }
                })
                .collect();
            Ok(Value::Matrix(out))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::Plan(
            "label_replace: matrix argument expected".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_replace_function() {
        use config::meta::promql::value::{RangeValue, Sample};

        let eval_ts = 1000;

        // Create range values with labels
        let labels = vec![
            Arc::new(Label::new("instance", "server-123.example.com")),
            Arc::new(Label::new("job", "web")),
        ];

        let range_value = RangeValue {
            labels,
            samples: vec![Sample::new(eval_ts, 42.0)],
            exemplars: None,
            time_window: None,
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = label_replace(
            matrix,
            "hostname",
            "$1",
            "instance",
            r"server-(\d+)\.example\.com",
        )
        .unwrap();

        // Should return a matrix with replaced label
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                // Check that the hostname label was added
                let hostname_label = m[0].labels.iter().find(|l| l.name == "hostname");
                assert!(hostname_label.is_some());
                assert_eq!(hostname_label.unwrap().value, "123");
                // Verify samples are preserved
                assert_eq!(m[0].samples[0].value, 42.0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}

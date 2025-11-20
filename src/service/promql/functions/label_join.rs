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

use config::meta::promql::{
    NAME_LABEL,
    value::{Label, RangeValue, Value},
};
use datafusion::error::{DataFusionError, Result};
use itertools::Itertools;
use rayon::iter::{IntoParallelIterator, ParallelIterator};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_join
pub(crate) fn label_join(
    data: Value,
    dest_label: &str,
    separator: &str,
    source_labels: Vec<String>,
) -> Result<Value> {
    match data {
        Value::Matrix(matrix) => {
            let keep_source_labels: HashSet<String> = HashSet::from_iter(source_labels);

            let out: Vec<RangeValue> = matrix
                .into_par_iter()
                .map(|mut range_value| {
                    // Join the source label values into the new destination label
                    let new_label_value = range_value
                        .labels
                        .iter()
                        .filter(|l| l.name != NAME_LABEL && keep_source_labels.contains(&l.name))
                        .map(|label| label.value.clone())
                        .join(separator);

                    let mut labels = std::mem::take(&mut range_value.labels);
                    labels.push(Arc::new(Label {
                        name: dest_label.to_string(),
                        value: new_label_value,
                    }));

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
            "label_join: matrix argument expected".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_join_function() {
        use config::meta::promql::value::{RangeValue, Sample};

        let eval_ts = 1000;

        // Create range values with labels
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "web")),
        ];

        let range_value1 = RangeValue {
            labels: labels1,
            samples: vec![Sample::new(eval_ts, 42.0)],
            exemplars: None,
            time_window: None,
        };

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "web")),
        ];

        let range_value2 = RangeValue {
            labels: labels2,
            samples: vec![Sample::new(eval_ts, 43.0)],
            exemplars: None,
            time_window: None,
        };

        let matrix = Value::Matrix(vec![range_value1, range_value2]);
        let source_labels = vec!["instance".to_string(), "job".to_string()];
        let result = label_join(matrix, "combined", "-", source_labels).unwrap();

        // Should return a matrix with joined labels
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 2);
                // Check that the combined label was added
                let combined_label1 = m[0].labels.iter().find(|l| l.name == "combined");
                let combined_label2 = m[1].labels.iter().find(|l| l.name == "combined");
                assert!(combined_label1.is_some());
                assert!(combined_label2.is_some());
                assert_eq!(combined_label1.unwrap().value, "server1-web");
                assert_eq!(combined_label2.unwrap().value, "server2-web");
                // Verify samples are preserved
                assert_eq!(m[0].samples[0].value, 42.0);
                assert_eq!(m[1].samples[0].value, 43.0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}

// Copyright 2026 OpenObserve Inc.
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

use config::meta::promql::value::{Label, LabelsExt, Value};
use datafusion::error::{DataFusionError, Result};
use itertools::Itertools;
use rayon::iter::{IntoParallelRefMutIterator, ParallelIterator};

use super::set_label;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_join
pub(crate) fn label_join(
    data: Value,
    dest_label: &str,
    separator: &str,
    source_labels: Vec<String>,
) -> Result<Value> {
    if let Some(invalid) = source_labels
        .iter()
        .find(|label| !Label::is_valid_label_name(label))
    {
        return Err(DataFusionError::Plan(format!(
            "label_join: invalid source label name {invalid}"
        )));
    }
    if !Label::is_valid_label_name(dest_label) {
        return Err(DataFusionError::Plan(format!(
            "label_join: invalid destination label name {dest_label}"
        )));
    }

    match data {
        Value::Matrix(mut matrix) => {
            matrix.par_iter_mut().for_each(|range_value| {
                let joined = source_labels
                    .iter()
                    .map(|source| range_value.labels.get_value(source))
                    .join(separator);
                set_label(&mut range_value.labels, dest_label, &joined);
            });
            Ok(Value::Matrix(matrix))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::Plan(
            "label_join: matrix argument expected".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Labels, RangeValue, Sample, labels_value};

    use super::*;

    fn join_labels(
        labels: &[(&str, &str)],
        dest: &str,
        separator: &str,
        sources: &[&str],
    ) -> Labels {
        let mut labels: Labels = labels
            .iter()
            .map(|(name, value)| Arc::new(Label::new(*name, *value)))
            .collect();
        labels.sort();
        let data = Value::Matrix(vec![RangeValue {
            labels,
            samples: vec![Sample::new(1000, 1.0)],
            exemplars: None,
            time_window: None,
        }]);
        let sources = sources.iter().map(|source| source.to_string()).collect();
        let Value::Matrix(mut matrix) = label_join(data, dest, separator, sources).unwrap() else {
            panic!("expected matrix");
        };
        matrix.remove(0).labels
    }

    fn names(labels: &Labels) -> Vec<&str> {
        labels.iter().map(|label| label.name.as_str()).collect()
    }

    #[test]
    fn test_label_join_uses_argument_order() {
        let labels = join_labels(&[("a", "1"), ("b", "2")], "dst", ",", &["b", "a"]);
        assert_eq!(labels_value(&labels, "dst").as_deref(), Some("2,1"));
    }

    #[test]
    fn test_label_join_missing_source_is_empty_string() {
        let labels = join_labels(
            &[("a", "1"), ("b", "2")],
            "dst",
            "-",
            &["a", "missing", "b"],
        );
        assert_eq!(labels_value(&labels, "dst").as_deref(), Some("1--2"));
    }

    #[test]
    fn test_label_join_includes_metric_name_and_repeats() {
        let labels = join_labels(
            &[("__name__", "m"), ("job", "api")],
            "dst",
            ":",
            &["__name__", "job", "job"],
        );
        assert_eq!(labels_value(&labels, "dst").as_deref(), Some("m:api:api"));
        assert_eq!(labels_value(&labels, "__name__").as_deref(), Some("m"));
    }

    #[test]
    fn test_label_join_overwrites_existing_dest_sorted() {
        let labels = join_labels(
            &[
                ("__name__", "m"),
                ("instance", "old"),
                ("job", "api"),
                ("zone", "z"),
            ],
            "instance",
            "/",
            &["job", "zone"],
        );
        assert_eq!(names(&labels), vec!["__name__", "instance", "job", "zone"]);
        assert_eq!(labels_value(&labels, "instance").as_deref(), Some("api/z"));
    }

    #[test]
    fn test_label_join_empty_result_deletes_dest() {
        let labels = join_labels(&[("dst", "old"), ("job", "api")], "dst", "", &["missing"]);
        assert_eq!(names(&labels), vec!["job"]);
    }

    #[test]
    fn test_label_join_invalid_label_names_return_err() {
        assert!(label_join(Value::None, "1bad", "-", vec!["a".into()]).is_err());
        assert!(label_join(Value::None, "dst", "-", vec!["a-b".into()]).is_err());
    }

    #[test]
    fn test_label_join_value_none_input() {
        let result = label_join(Value::None, "dst", "-", vec![]).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_label_join_invalid_input_returns_err() {
        let result = label_join(Value::Float(1.0), "dst", "-", vec![]);
        assert!(result.is_err());
    }

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

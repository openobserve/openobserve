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
use rayon::iter::{IntoParallelRefMutIterator, ParallelIterator};
use regex::Regex;

use super::{merge_same_labelset, set_label};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#label_replace
pub(crate) fn label_replace(
    data: Value,
    dest_label: &str,
    replacement: &str,
    source_label: &str,
    regex: &str,
) -> Result<Value> {
    if !Label::is_valid_label_name(dest_label) {
        return Err(DataFusionError::NotImplemented(format!(
            "label_replace: invalid destination label provided {dest_label}"
        )));
    }
    let re = Regex::new(&format!("^(?s:{regex})$")).map_err(|_e| {
        DataFusionError::NotImplemented(format!("label_replace: invalid regex found {regex}"))
    })?;

    match data {
        Value::Matrix(mut matrix) => {
            matrix.par_iter_mut().for_each(|range_value| {
                let source_value = range_value.labels.get_value(source_label);
                let Some(captures) = re.captures(&source_value) else {
                    return;
                };
                let mut output = String::new();
                captures.expand(replacement, &mut output);
                set_label(&mut range_value.labels, dest_label, &output);
            });
            Ok(Value::Matrix(merge_same_labelset(matrix)?))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::Plan(
            "label_replace: matrix argument expected".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Labels, RangeValue, Sample, labels_value};

    use super::*;

    fn series(labels: &[(&str, &str)]) -> Value {
        let mut labels: Labels = labels
            .iter()
            .map(|(name, value)| Arc::new(Label::new(*name, *value)))
            .collect();
        labels.sort();
        Value::Matrix(vec![RangeValue {
            labels,
            samples: vec![Sample::new(1000, 1.0)],
            exemplars: None,
            time_window: None,
        }])
    }

    fn replace_labels(
        data: Value,
        dest: &str,
        replacement: &str,
        source: &str,
        regex: &str,
    ) -> Vec<(String, String)> {
        let Value::Matrix(matrix) = label_replace(data, dest, replacement, source, regex).unwrap()
        else {
            panic!("expected matrix");
        };
        assert_eq!(matrix.len(), 1);
        matrix[0]
            .labels
            .iter()
            .map(|label| (label.name.clone(), label.value.clone()))
            .collect()
    }

    fn pairs(labels: &[(&str, &str)]) -> Vec<(String, String)> {
        labels
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn test_label_replace_copies_unchanged_value() {
        let data = series(&[("__name__", "mem_usage"), ("instance", "a")]);
        let labels = replace_labels(data, "host", "$1", "instance", "(.*)");
        assert_eq!(
            labels,
            pairs(&[("__name__", "mem_usage"), ("host", "a"), ("instance", "a")])
        );
    }

    #[test]
    fn test_label_replace_regex_is_fully_anchored() {
        let data = series(&[("instance", "server-1:9090")]);
        let labels = replace_labels(data, "host", "$1", "instance", r"server-(\d+)");
        assert_eq!(labels, pairs(&[("instance", "server-1:9090")]));
    }

    #[test]
    fn test_label_replace_expands_template_once() {
        let data = series(&[("instance", "foo-bar")]);
        let labels = replace_labels(data, "swapped", "${2}_$1-${1}x", "instance", "(.*)-(.*)");
        assert_eq!(
            labels,
            pairs(&[("instance", "foo-bar"), ("swapped", "bar_foo-foox")])
        );

        let data = series(&[("instance", "abc")]);
        let labels = replace_labels(data, "dst", "x", "instance", ".*");
        assert_eq!(labels, pairs(&[("dst", "x"), ("instance", "abc")]));
    }

    #[test]
    fn test_label_replace_dot_matches_newline() {
        let data = series(&[("src", "a\nb")]);
        let labels = replace_labels(data, "dst", "$1", "src", "(a.b)");
        assert_eq!(labels, pairs(&[("dst", "a\nb"), ("src", "a\nb")]));
    }

    #[test]
    fn test_label_replace_named_capture_group() {
        let data = series(&[("instance", "host-7")]);
        let labels = replace_labels(data, "id", "${num}", "instance", r"host-(?P<num>\d+)");
        assert_eq!(labels, pairs(&[("id", "7"), ("instance", "host-7")]));
    }

    #[test]
    fn test_label_replace_overwrites_existing_dest_without_duplicates() {
        let data = series(&[("instance", "a:9090"), ("job", "api")]);
        let labels = replace_labels(data, "instance", "$1", "instance", "(.*):.*");
        assert_eq!(labels, pairs(&[("instance", "a"), ("job", "api")]));
    }

    #[test]
    fn test_label_replace_keeps_labels_sorted() {
        let data = series(&[("__name__", "m"), ("instance", "a"), ("job", "api")]);
        let Value::Matrix(matrix) = label_replace(data, "zone", "z-$1", "job", "(.*)").unwrap()
        else {
            panic!("expected matrix");
        };
        let matrix = label_replace(Value::Matrix(matrix), "app", "$1", "job", "(.*)").unwrap();
        let Value::Matrix(matrix) = matrix else {
            panic!("expected matrix");
        };
        let labels = &matrix[0].labels;
        assert!(labels.windows(2).all(|pair| pair[0].name < pair[1].name));
        assert_eq!(labels_value(labels, "app").as_deref(), Some("api"));
        assert_eq!(labels_value(labels, "zone").as_deref(), Some("z-api"));
        assert_eq!(labels_value(labels, "__name__").as_deref(), Some("m"));
    }

    #[test]
    fn test_label_replace_empty_expansion_deletes_dest() {
        let data = series(&[("dst", "old"), ("src", "")]);
        let labels = replace_labels(data, "dst", "$1", "src", "(.*)");
        assert_eq!(labels, pairs(&[("src", "")]));
    }

    #[test]
    fn test_label_replace_no_match_with_empty_replacement_keeps_dest() {
        let data = series(&[("dst", "old"), ("src", "value")]);
        let labels = replace_labels(data, "dst", "", "src", r"\d+");
        assert_eq!(labels, pairs(&[("dst", "old"), ("src", "value")]));
    }

    #[test]
    fn test_label_replace_missing_source_matches_empty_string() {
        let data = series(&[("job", "api")]);
        let labels = replace_labels(data, "dst", "x$1", "missing", "(.*)");
        assert_eq!(labels, pairs(&[("dst", "x"), ("job", "api")]));
    }

    #[test]
    fn test_label_replace_metric_name_as_dest() {
        let data = series(&[("__name__", "old_name"), ("job", "api")]);
        let labels = replace_labels(data, "__name__", "new_$1", "__name__", "old_(.*)");
        assert_eq!(labels, pairs(&[("__name__", "new_name"), ("job", "api")]));

        let data = series(&[("__name__", "old_name"), ("job", "api")]);
        let labels = replace_labels(data, "__name__", "", "job", ".*");
        assert_eq!(labels, pairs(&[("job", "api")]));
    }

    #[test]
    fn test_label_replace_duplicate_labelset() {
        let matrix = |second_ts: i64| {
            Value::Matrix(vec![
                RangeValue {
                    labels: vec![Arc::new(Label::new("instance", "a"))],
                    samples: vec![Sample::new(1000, 1.0)],
                    exemplars: None,
                    time_window: None,
                },
                RangeValue {
                    labels: vec![Arc::new(Label::new("instance", "b"))],
                    samples: vec![Sample::new(second_ts, 2.0)],
                    exemplars: None,
                    time_window: None,
                },
            ])
        };
        assert!(label_replace(matrix(1000), "instance", "x", "instance", ".*").is_err());

        let Value::Matrix(merged) =
            label_replace(matrix(2000), "instance", "x", "instance", ".*").unwrap()
        else {
            panic!("expected matrix");
        };
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].samples.len(), 2);
    }

    #[test]
    fn test_label_replace_validates_args_before_input() {
        assert!(label_replace(Value::None, "1bad", "$1", "src", ".*").is_err());
        assert!(label_replace(Value::None, "dst", "$1", "src", "(").is_err());
    }

    #[test]
    fn test_label_replace_value_none_input() {
        let result = label_replace(Value::None, "dst", "$1", "src", ".*").unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_label_replace_invalid_input_returns_err() {
        let result = label_replace(Value::Float(1.0), "dst", "$1", "src", ".*");
        assert!(result.is_err());
    }

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

    #[test]
    fn test_label_replace_empty_replacement_removes_dest_label() {
        use config::meta::promql::value::{RangeValue, Sample};

        let labels = vec![
            Arc::new(Label::new("dst", "old_value")),
            Arc::new(Label::new("src", "source_val")),
        ];
        let range_value = RangeValue {
            labels,
            samples: vec![Sample::new(1000, 1.0)],
            exemplars: None,
            time_window: None,
        };
        let matrix = Value::Matrix(vec![range_value]);
        let result = label_replace(matrix, "dst", "", "src", ".*").unwrap();

        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                // Empty replacement removes dst label
                assert!(m[0].labels.iter().all(|l| l.name != "dst"));
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_label_replace_no_regex_match_leaves_labels_unchanged() {
        use config::meta::promql::value::{RangeValue, Sample};

        let labels = vec![Arc::new(Label::new("instance", "prod-server"))];
        let range_value = RangeValue {
            labels,
            samples: vec![Sample::new(1000, 1.0)],
            exemplars: None,
            time_window: None,
        };
        let matrix = Value::Matrix(vec![range_value]);
        // Regex won't match "prod-server"
        let result = label_replace(matrix, "hostname", "$1", "instance", r"(\d+)").unwrap();

        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                // hostname label NOT added since regex didn't match
                assert!(m[0].labels.iter().all(|l| l.name != "hostname"));
                // instance label preserved
                assert!(m[0].labels.iter().any(|l| l.name == "instance"));
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_label_replace_invalid_dest_label_returns_err() {
        let matrix = Value::Matrix(vec![]);
        let result = label_replace(matrix, "123invalid", "$1", "src", ".*");
        assert!(result.is_err());
    }

    #[test]
    fn test_label_replace_invalid_regex_returns_err() {
        let matrix = Value::Matrix(vec![]);
        let result = label_replace(matrix, "dst", "$1", "src", "[invalid");
        assert!(result.is_err());
    }
}

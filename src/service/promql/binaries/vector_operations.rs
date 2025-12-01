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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use config::meta::promql::{
    NAME_LABEL,
    value::{Label, LabelsExt, RangeValue, Sample, Value, signature},
};
use datafusion::error::{DataFusionError, Result};
use once_cell::sync::Lazy;
use promql_parser::parser::{BinaryExpr, VectorMatchCardinality, token};
use rayon::prelude::*;

use crate::service::promql::binaries::scalar_binary_operations;

// DROP_METRIC_BIN_OP if the operation is one of these, drop the metric __name__
pub static DROP_METRIC_BIN_OP: Lazy<HashSet<u8>> = Lazy::new(|| {
    HashSet::from_iter([
        token::T_ADD,
        token::T_SUB,
        token::T_DIV,
        token::T_MUL,
        token::T_POW,
        token::T_MOD,
    ])
});

/// Implement the operation between a matrix and a float.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators
pub async fn vector_scalar_bin_op(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: f64,
    swapped_lhs_rhs: bool,
) -> Result<Value> {
    let is_comparison_operator = expr.op.is_comparison_operator();
    let return_bool = expr.return_bool();
    let output: Vec<RangeValue> = left
        .into_par_iter()
        .flat_map(|mut range| {
            let new_samples: Vec<Sample> = range
                .samples
                .into_iter()
                .flat_map(|sample| {
                    let (lhs, rhs) = if swapped_lhs_rhs {
                        (right, sample.value)
                    } else {
                        (sample.value, right)
                    };
                    match scalar_binary_operations(
                        expr.op.id(),
                        lhs,
                        rhs,
                        return_bool,
                        is_comparison_operator,
                    )
                    .ok()
                    {
                        Some(value) => {
                            let final_value =
                                if is_comparison_operator && swapped_lhs_rhs && return_bool {
                                    value
                                } else if is_comparison_operator && swapped_lhs_rhs {
                                    sample.value
                                } else {
                                    value
                                };

                            Some(Sample {
                                timestamp: sample.timestamp,
                                value: final_value,
                            })
                        }
                        None => None,
                    }
                })
                .collect();

            if new_samples.is_empty() {
                None
            } else {
                let mut labels = std::mem::take(&mut range.labels);
                if return_bool || DROP_METRIC_BIN_OP.contains(&expr.op.id()) {
                    labels = labels.without_metric_name();
                }
                Some(RangeValue {
                    labels,
                    samples: new_samples,
                    exemplars: range.exemplars,
                    time_window: range.time_window,
                })
            }
        })
        .collect();

    Ok(Value::Matrix(output))
}

/// matrix1 or matrix2 results in a matrix that contains all original elements
/// (label sets + values) of matrix1 and additionally all elements of matrix2
/// which do not have matching label sets in matrix1.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_or(expr: &BinaryExpr, left: Vec<RangeValue>, right: Vec<RangeValue>) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    if left.is_empty() {
        return Ok(Value::Matrix(right));
    }

    if right.is_empty() {
        return Ok(Value::Matrix(left));
    }

    let lhs_sig: HashSet<u64> = left
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Add all right-hand side elements which have not been added from the left-hand
    // side.
    let right_ranges: Vec<RangeValue> = right
        .into_par_iter()
        .filter(|item| {
            let right_sig = signature(&item.labels);
            !lhs_sig.contains(&right_sig)
        })
        .collect();

    let mut output = left;
    output.extend(right_ranges);
    Ok(Value::Matrix(output))
}

/// matrix1 unless matrix2 results in a matrix consisting of the elements of
/// matrix1 for which there are no elements in matrix2 with exactly matching
/// label sets. All matching elements in both matrices are dropped.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_unless(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: Vec<RangeValue>,
) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    // If right is empty, we simply return the left
    // if left is empty we will return it anyway.
    if left.is_empty() || right.is_empty() {
        return Ok(Value::Matrix(left));
    }
    // Generate all the signatures from the right hand.
    let rhs_sig: HashSet<u64> = right
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Now filter out all the matching labels from left.
    let output: Vec<RangeValue> = left
        .into_par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            !rhs_sig.contains(&left_sig)
        })
        .collect();
    Ok(Value::Matrix(output))
}

/// matrix1 and matrix2 results in a matrix consisting of the elements of
/// matrix1 for which there are elements in matrix2 with exactly matching label
/// sets. Other elements are dropped. The metric name and values are carried
/// over from the left-hand side matrix.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_and(expr: &BinaryExpr, left: Vec<RangeValue>, right: Vec<RangeValue>) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    if left.is_empty() || right.is_empty() {
        return Err(DataFusionError::NotImplemented(
            "Either left or right operand is empty.".to_string(),
        ));
    }

    let rhs_sig: HashSet<u64> = right
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Now include all the matching ones from the right
    let output: Vec<RangeValue> = left
        .into_par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            rhs_sig.contains(&left_sig)
        })
        .map(|mut range| {
            range.labels = range.labels.without_metric_name();
            range
        })
        .collect();

    Ok(Value::Matrix(output))
}

fn vector_arithmetic_operators(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: Vec<RangeValue>,
) -> Result<Value> {
    let operator = expr.op.id();

    let return_bool = expr.return_bool();
    let comparison_operator = expr.op.is_comparison_operator();

    // These are here so that we can generate signatures based on these labels.
    let mut labels_to_include_set = vec![];
    let mut labels_to_exclude_set = vec![NAME_LABEL.to_string()];

    let is_matching_on = expr.is_matching_on();
    if is_matching_on {
        let modifier = expr.modifier.as_ref().unwrap();
        if modifier.is_matching_on() {
            labels_to_include_set = modifier.matching.as_ref().unwrap().labels().labels.clone();
            labels_to_include_set.sort();
        } else {
            let excluded_labels = modifier.matching.as_ref().unwrap().labels().labels.clone();
            labels_to_exclude_set.extend(excluded_labels);
            labels_to_exclude_set.sort();
        }
    }

    // These labels should be used to compare values between lhs - rhs
    let labels_to_compare = |labels: &Vec<Arc<Label>>| {
        if is_matching_on {
            labels.keep(&labels_to_include_set)
        } else {
            labels.delete(&labels_to_exclude_set)
        }
    };

    // Get the hash for the labels on the right
    let rhs_sig: HashMap<u64, RangeValue> = right
        .into_par_iter()
        .map(|range| {
            let signature = labels_to_compare(&range.labels).signature();
            (signature, range)
        })
        .collect();

    // Iterate over left and pick up the corresponding range from rhs
    let output: Vec<RangeValue> = left
        .into_par_iter()
        .flat_map(|range| {
            let left_sig = labels_to_compare(&range.labels).signature();
            rhs_sig.get(&left_sig).map(|rhs_range| (range, rhs_range))
        })
        .flat_map(|(mut lhs_range, rhs_range)| {
            // Build a map of timestamps from rhs for quick lookup
            let rhs_map: HashMap<i64, f64> = rhs_range
                .samples
                .iter()
                .map(|s| (s.timestamp, s.value))
                .collect();

            // Apply operation to matching timestamps
            let new_samples: Vec<Sample> = lhs_range
                .samples
                .into_iter()
                .flat_map(|lhs_sample| {
                    rhs_map.get(&lhs_sample.timestamp).and_then(|&rhs_value| {
                        scalar_binary_operations(
                            operator,
                            lhs_sample.value,
                            rhs_value,
                            return_bool,
                            comparison_operator,
                        )
                        .ok()
                        .map(|value| Sample {
                            timestamp: lhs_sample.timestamp,
                            value,
                        })
                    })
                })
                .collect();

            if new_samples.is_empty() {
                None
            } else {
                let mut labels = std::mem::take(&mut lhs_range.labels);
                if return_bool || DROP_METRIC_BIN_OP.contains(&operator) {
                    labels = labels.without_metric_name();
                }

                if let Some(modifier) = expr.modifier.as_ref() {
                    if modifier.card == VectorMatchCardinality::OneToOne {
                        labels = labels_to_compare(&labels);
                    }

                    // group_labels from the `group_x` modifier are taken from the "one"-side.
                    if let Some(group_labels) = modifier.card.labels() {
                        for ln in group_labels.labels.iter() {
                            let value = rhs_range.labels.get_value(ln);
                            if !value.is_empty() {
                                labels.set(ln, &value);
                            }
                        }
                    }
                }
                Some(RangeValue {
                    labels,
                    samples: new_samples,
                    exemplars: lhs_range.exemplars,
                    time_window: lhs_range.time_window,
                })
            }
        })
        .collect();

    Ok(Value::Matrix(output))
}

/// Implement binary operations between two matrices
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#comparison-binary-operators
///
/// Between two instant vectors (now represented as matrices), a binary arithmetic
/// operator is applied to each entry in the left-hand side matrix and its matching
/// element in the right-hand matrix. The result is propagated into the result matrix
/// with the grouping labels becoming the output label set. The metric name is dropped.
/// Entries for which no matching entry in the right-hand matrix can be found
/// are not part of the result.
///
///
/// Between two instant vectors, comparison binary operators behave as a filter
/// by default, applied to matching entries. Matrix elements for which the
/// expression is not true or which do not find a match on the other side of the
/// expression get dropped from the result, while the others are propagated into
/// a result matrix with the grouping labels becoming the output label set. If
/// the bool modifier is provided, matrix elements that would have been dropped
/// instead have the value 0 and matrix elements that would be kept have the
/// value 1, with the grouping labels again becoming the output label set. The
/// metric name is dropped if the bool modifier is provided.
pub fn vector_bin_op(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: Vec<RangeValue>,
) -> Result<Value> {
    match expr.op.id() {
        token::T_LAND => vector_and(expr, left, right),
        token::T_LOR => vector_or(expr, left, right),
        token::T_LUNLESS => vector_unless(expr, left, right),
        _ => vector_arithmetic_operators(expr, left, right),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, Sample};

    use super::*;

    // Helper function to create test data for matrix operations
    fn create_test_matrix_data() -> Vec<RangeValue> {
        vec![
            create_test_range_value(vec![1.0], vec![("instance", "localhost"), ("job", "node")]),
            create_test_range_value(vec![2.0], vec![("instance", "localhost"), ("job", "node")]),
            create_test_range_value(vec![3.0], vec![("instance", "remote"), ("job", "api")]),
        ]
    }

    fn create_test_range_value(values: Vec<f64>, labels: Vec<(&str, &str)>) -> RangeValue {
        let labels = labels
            .into_iter()
            .map(|(k, v)| Arc::new(Label::new(k, v)))
            .collect();
        let samples = values
            .into_iter()
            .enumerate()
            .map(|(i, value)| Sample {
                timestamp: 1640995200000000i64 + (i as i64 * 1000000), // 1 second apart
                value,
            })
            .collect();
        RangeValue {
            labels,
            samples,
            exemplars: None,
            time_window: None,
        }
    }

    // Simple tests that don't require complex BinaryExpr construction
    #[test]
    fn test_range_value_creation() {
        let range = create_test_range_value(vec![42.0], vec![("instance", "localhost")]);
        assert_eq!(range.samples[0].value, 42.0);
        assert_eq!(range.samples[0].timestamp, 1640995200000000i64);
        assert_eq!(range.labels.len(), 1);
        assert_eq!(range.labels[0].name, "instance");
        assert_eq!(range.labels[0].value, "localhost");
    }

    #[test]
    fn test_range_value_with_multiple_labels() {
        let range = create_test_range_value(
            vec![100.0],
            vec![("env", "prod"), ("region", "us-west"), ("service", "api")],
        );
        assert_eq!(range.samples[0].value, 100.0);
        assert_eq!(range.labels.len(), 3);

        let label_names: Vec<&str> = range.labels.iter().map(|l| l.name.as_str()).collect();
        assert!(label_names.contains(&"env"));
        assert!(label_names.contains(&"region"));
        assert!(label_names.contains(&"service"));
    }

    #[test]
    fn test_range_value_empty_labels() {
        let range = create_test_range_value(vec![0.0], vec![]);
        assert_eq!(range.samples[0].value, 0.0);
        assert!(range.labels.is_empty());
    }

    #[test]
    fn test_range_value_numeric_values() {
        let test_cases = [
            (0.0, "zero"),
            (1.0, "positive integer"),
            (-1.0, "negative integer"),
            (1.234, "positive float"),
            (-1.234, "negative float"),
            (f64::MAX, "max value"),
            (f64::MIN, "min value"),
        ];

        for (value, description) in test_cases {
            let range = create_test_range_value(vec![value], vec![("test", description)]);
            assert_eq!(range.samples[0].value, value, "Failed for: {description}");
        }
    }

    #[test]
    fn test_range_value_timestamp_consistency() {
        let range1 = create_test_range_value(vec![1.0], vec![("a", "1")]);
        let range2 = create_test_range_value(vec![2.0], vec![("b", "2")]);

        // Both should have the same starting timestamp
        assert_eq!(range1.samples[0].timestamp, range2.samples[0].timestamp);
        assert_eq!(range1.samples[0].timestamp, 1640995200000000i64);
    }

    #[test]
    fn test_label_creation() {
        let labels = vec![
            ("cpu", "0"),
            ("mode", "idle"),
            ("instance", "localhost:9100"),
        ];
        let range = create_test_range_value(vec![75.5], labels.clone());

        for (i, (expected_name, expected_value)) in labels.iter().enumerate() {
            assert_eq!(range.labels[i].name, *expected_name);
            assert_eq!(range.labels[i].value, *expected_value);
        }
    }

    #[test]
    fn test_label_modification() {
        let mut labels = vec![
            Arc::new(Label::new("env", "prod")),
            Arc::new(Label::new("region", "us-west")),
            Arc::new(Label::new("service", "api")),
        ];

        // Test label modification
        labels[0] = Arc::new(Label::new("env", "staging"));
        assert_eq!(labels[0].value, "staging");

        // Test label filtering (simulate what vector operations do)
        let filtered_labels: Vec<Arc<Label>> = labels
            .into_iter()
            .filter(|label| label.name != "env")
            .collect();

        assert_eq!(filtered_labels.len(), 2);
        assert_eq!(filtered_labels[0].name, "region");
        assert_eq!(filtered_labels[1].name, "service");
    }

    #[test]
    fn test_matrix_operations_parallel_processing() {
        // Test that we can process matrices in parallel (simulating what the actual functions do)
        let matrix = vec![
            create_test_range_value(vec![1.0], vec![("a", "1")]),
            create_test_range_value(vec![2.0], vec![("a", "2")]),
            create_test_range_value(vec![3.0], vec![("a", "3")]),
            create_test_range_value(vec![4.0], vec![("a", "4")]),
            create_test_range_value(vec![5.0], vec![("a", "5")]),
        ];

        // Simulate parallel processing by mapping over the matrix
        let processed: Vec<f64> = matrix
            .par_iter()
            .map(|range| range.samples[0].value * 2.0)
            .collect();

        assert_eq!(processed.len(), 5);
        assert_eq!(processed[0], 2.0);
        assert_eq!(processed[1], 4.0);
        assert_eq!(processed[2], 6.0);
        assert_eq!(processed[3], 8.0);
        assert_eq!(processed[4], 10.0);
    }

    #[test]
    fn test_matrix_operations_error_scenarios() {
        // Test scenarios that could lead to errors in matrix operations

        // Test with very large numbers
        let large_matrix = [
            create_test_range_value(vec![f64::MAX], vec![("a", "1")]),
            create_test_range_value(vec![f64::MIN], vec![("a", "2")]),
        ];

        assert!(large_matrix[0].samples[0].value.is_finite());
        assert!(large_matrix[1].samples[0].value.is_finite());

        // Test with NaN values
        let nan_matrix = [create_test_range_value(vec![f64::NAN], vec![("a", "1")])];

        // Should handle NaN gracefully
        assert!(nan_matrix[0].samples[0].value.is_nan());
    }

    #[test]
    fn test_matrix_operations_data_structures() {
        // Test RangeValue creation and properties
        let value =
            create_test_range_value(vec![42.0], vec![("label1", "value1"), ("label2", "value2")]);
        assert_eq!(value.samples[0].value, 42.0);
        assert_eq!(value.labels.len(), 2);
        assert_eq!(value.labels[0].name, "label1");
        assert_eq!(value.labels[0].value, "value1");
        assert_eq!(value.labels[1].name, "label2");
        assert_eq!(value.labels[1].value, "value2");
    }

    #[test]
    fn test_matrix_operations_timestamp_consistency() {
        let timestamp = 1640995200000000i64;
        let value = create_test_range_value(vec![10.0], vec![("test", "value")]);
        assert_eq!(value.samples[0].timestamp, timestamp);
    }

    #[test]
    fn test_matrix_operations_label_handling() {
        let value = create_test_range_value(vec![5.0], vec![("a", "1"), ("b", "2"), ("c", "3")]);
        assert_eq!(value.labels.len(), 3);

        // Test label ordering and values
        let labels = &value.labels;
        assert_eq!(labels[0].name, "a");
        assert_eq!(labels[0].value, "1");
        assert_eq!(labels[1].name, "b");
        assert_eq!(labels[1].value, "2");
        assert_eq!(labels[2].name, "c");
        assert_eq!(labels[2].value, "3");
    }

    #[test]
    fn test_matrix_operations_empty_labels() {
        let value = create_test_range_value(vec![0.0], vec![]);
        assert_eq!(value.labels.len(), 0);
        assert_eq!(value.samples[0].value, 0.0);
    }

    #[test]
    fn test_matrix_operations_negative_values() {
        let value = create_test_range_value(vec![-15.5], vec![("negative", "test")]);
        assert_eq!(value.samples[0].value, -15.5);
        assert_eq!(value.labels.len(), 1);
        assert_eq!(value.labels[0].name, "negative");
        assert_eq!(value.labels[0].value, "test");
    }

    #[test]
    fn test_matrix_operations_large_numbers() {
        let value = create_test_range_value(vec![1e15], vec![("large", "number")]);
        assert_eq!(value.samples[0].value, 1e15);
        assert_eq!(value.labels.len(), 1);
    }

    #[test]
    fn test_matrix_operations_special_floats() {
        let value = create_test_range_value(vec![f64::INFINITY], vec![("inf", "test")]);
        assert!(value.samples[0].value.is_infinite());
        assert!(value.samples[0].value.is_sign_positive());

        let value = create_test_range_value(vec![f64::NEG_INFINITY], vec![("neg_inf", "test")]);
        assert!(value.samples[0].value.is_infinite());
        assert!(value.samples[0].value.is_sign_negative());

        let value = create_test_range_value(vec![f64::NAN], vec![("nan", "test")]);
        assert!(value.samples[0].value.is_nan());
    }

    #[test]
    fn test_matrix_operations_unicode_labels() {
        let value = create_test_range_value(
            vec![1.0],
            vec![("🚀", "🚀"), ("测试", "测试"), ("🎉", "🎉")],
        );
        assert_eq!(value.labels.len(), 3);
        assert_eq!(value.labels[0].name, "🚀");
        assert_eq!(value.labels[0].value, "🚀");
        assert_eq!(value.labels[1].name, "测试");
        assert_eq!(value.labels[1].value, "测试");
        assert_eq!(value.labels[2].name, "🎉");
        assert_eq!(value.labels[2].value, "🎉");
    }

    #[test]
    fn test_matrix_operations_long_labels() {
        let long_name = "a".repeat(1000);
        let long_value = "b".repeat(1000);
        let value = create_test_range_value(vec![1.0], vec![(&long_name, &long_value)]);
        assert_eq!(value.labels.len(), 1);
        assert_eq!(value.labels[0].name, long_name);
        assert_eq!(value.labels[0].value, long_value);
    }

    #[test]
    fn test_matrix_operations_duplicate_labels() {
        let value = create_test_range_value(vec![1.0], vec![("a", "1"), ("a", "2"), ("a", "3")]);
        assert_eq!(value.labels.len(), 3);
        // All labels should be preserved even if names are duplicate
        assert_eq!(value.labels[0].name, "a");
        assert_eq!(value.labels[0].value, "1");
        assert_eq!(value.labels[1].name, "a");
        assert_eq!(value.labels[1].value, "2");
        assert_eq!(value.labels[2].name, "a");
        assert_eq!(value.labels[2].value, "3");
    }

    #[test]
    fn test_matrix_operations_edge_case_values() {
        let value = create_test_range_value(vec![f64::EPSILON], vec![("epsilon", "test")]);
        assert_eq!(value.samples[0].value, f64::EPSILON);

        let value =
            create_test_range_value(vec![f64::MIN_POSITIVE], vec![("min_positive", "test")]);
        assert_eq!(value.samples[0].value, f64::MIN_POSITIVE);

        let value = create_test_range_value(vec![f64::MAX], vec![("max", "test")]);
        assert_eq!(value.samples[0].value, f64::MAX);
    }

    #[test]
    fn test_matrix_operations_matrix_data() {
        let matrix_data = create_test_matrix_data();
        assert_eq!(matrix_data.len(), 3);

        // Test first element
        assert_eq!(matrix_data[0].samples[0].value, 1.0);
        assert_eq!(matrix_data[0].labels.len(), 2);
        assert_eq!(matrix_data[0].labels[0].name, "instance");
        assert_eq!(matrix_data[0].labels[0].value, "localhost");

        // Test second element
        assert_eq!(matrix_data[1].samples[0].value, 2.0);
        assert_eq!(matrix_data[1].labels.len(), 2);

        // Test third element
        assert_eq!(matrix_data[2].samples[0].value, 3.0);
        assert_eq!(matrix_data[2].labels.len(), 2);
        assert_eq!(matrix_data[2].labels[0].name, "instance");
        assert_eq!(matrix_data[2].labels[0].value, "remote");
    }

    #[test]
    fn test_matrix_operations_label_signatures() {
        let value1 = create_test_range_value(vec![1.0], vec![("a", "1"), ("b", "2")]);
        let value2 = create_test_range_value(vec![2.0], vec![("a", "1"), ("b", "2")]);
        let value3 = create_test_range_value(vec![3.0], vec![("a", "1"), ("b", "3")]);

        // value1 and value2 should have the same signature (same labels)
        let sig1 = signature(&value1.labels);
        let sig2 = signature(&value2.labels);
        let sig3 = signature(&value3.labels);

        assert_eq!(sig1, sig2);
        assert_ne!(sig1, sig3);
        assert_ne!(sig2, sig3);
    }

    #[test]
    fn test_matrix_operations_empty_matrix() {
        let empty_matrix: Vec<RangeValue> = vec![];
        assert_eq!(empty_matrix.len(), 0);

        // Test that we can create an empty matrix and it doesn't panic
        let empty_matrix_with_capacity: Vec<RangeValue> = Vec::with_capacity(100);
        assert_eq!(empty_matrix_with_capacity.len(), 0);
        assert_eq!(empty_matrix_with_capacity.capacity(), 100);
    }

    #[test]
    fn test_matrix_operations_single_element() {
        let single_element = [create_test_range_value(
            vec![42.0],
            vec![("single", "test")],
        )];
        assert_eq!(single_element.len(), 1);
        assert_eq!(single_element[0].samples[0].value, 42.0);
        assert_eq!(single_element[0].labels.len(), 1);
        assert_eq!(single_element[0].labels[0].name, "single");
        assert_eq!(single_element[0].labels[0].value, "test");
    }

    #[test]
    fn test_matrix_operations_multiple_samples() {
        // Test RangeValue with multiple samples
        let value =
            create_test_range_value(vec![1.0, 2.0, 3.0, 4.0, 5.0], vec![("metric", "test")]);
        assert_eq!(value.samples.len(), 5);
        assert_eq!(value.samples[0].value, 1.0);
        assert_eq!(value.samples[1].value, 2.0);
        assert_eq!(value.samples[2].value, 3.0);
        assert_eq!(value.samples[3].value, 4.0);
        assert_eq!(value.samples[4].value, 5.0);

        // Check timestamps are incrementing
        for i in 1..value.samples.len() {
            assert!(value.samples[i].timestamp > value.samples[i - 1].timestamp);
        }
    }
}

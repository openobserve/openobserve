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

use config::meta::promql::NAME_LABEL;
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{BinaryExpr, VectorMatchCardinality, token};
use rayon::prelude::*;

use crate::service::promql::{
    binaries::scalar_binary_operations,
    value::{InstantValue, Label, LabelsExt, Sample, Value, signature},
};

// DROP_METRIC_VECTOR_BIN_OP if the operation is one of these, drop the metric
// __name__
// pub static DROP_METRIC_VECTOR_BIN_OP: Lazy<HashSet<u8>> = Lazy::new(|| {
//     HashSet::from_iter([
//         token::T_ADD,
//         token::T_SUB,
//         token::T_DIV,
//         token::T_MUL,
//         token::T_POW,
//         token::T_MOD,
//     ])
// });

/// Implement the operation between a vector and a float.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators
pub async fn vector_scalar_bin_op(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: f64,
    swapped_lhs_rhs: bool,
) -> Result<Value> {
    let is_comparison_operator = expr.op.is_comparison_operator();
    let return_bool = expr.return_bool();
    let output: Vec<InstantValue> = left
        .into_par_iter()
        .flat_map(|mut instant| {
            let (lhs, rhs) = if swapped_lhs_rhs {
                (right, instant.sample.value)
            } else {
                (instant.sample.value, right)
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
                    let labels = std::mem::take(&mut instant.labels);
                    // if return_bool || DROP_METRIC_VECTOR_BIN_OP.contains(&expr.op.id()) {
                    //     labels = labels.without_metric_name();
                    // }

                    let final_value = if is_comparison_operator && swapped_lhs_rhs && return_bool {
                        value
                    } else if is_comparison_operator && swapped_lhs_rhs {
                        instant.sample.value
                    } else {
                        value
                    };

                    Some(InstantValue {
                        labels,
                        sample: Sample {
                            timestamp: instant.sample.timestamp,
                            value: final_value,
                        },
                    })
                }
                None => None,
            }
        })
        .collect();

    Ok(Value::Vector(output))
}

/// vector1 or vector2 results in a vector that contains all original elements
/// (label sets + values) of vector1 and additionally all elements of vector2
/// which do not have matching label sets in vector1.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_or(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: Vec<InstantValue>,
) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    if left.is_empty() {
        return Ok(Value::Vector(right));
    }

    if right.is_empty() {
        return Ok(Value::Vector(left));
    }

    let lhs_sig: HashSet<u64> = left
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Add all right-hand side elements which have not been added from the left-hand
    // side.
    let right_instants: Vec<InstantValue> = right
        .into_par_iter()
        .filter(|item| {
            let right_sig = signature(&item.labels);
            !lhs_sig.contains(&right_sig)
        })
        .collect();

    let mut output = left;
    output.extend(right_instants);
    Ok(Value::Vector(output))
}

/// vector1 unless vector2 results in a vector consisting of the elements of
/// vector1 for which there are no elements in vector2 with exactly matching
/// label sets. All matching elements in both vectors are dropped.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_unless(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: Vec<InstantValue>,
) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    // If right is empty, we simply return the left
    // if left is empty we will return it anyway.
    if left.is_empty() || right.is_empty() {
        return Ok(Value::Vector(left));
    }
    // Generate all the signatures from the right hand.
    let rhs_sig: HashSet<u64> = right
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Now filter out all the matching labels from left.
    let output: Vec<InstantValue> = left
        .into_par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            !rhs_sig.contains(&left_sig)
        })
        .collect();
    Ok(Value::Vector(output))
}

/// vector1 and vector2 results in a vector consisting of the elements of
/// vector1 for which there are elements in vector2 with exactly matching label
/// sets. Other elements are dropped. The metric name and values are carried
/// over from the left-hand side vector.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_and(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: Vec<InstantValue>,
) -> Result<Value> {
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
    let output: Vec<InstantValue> = left
        .into_par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            rhs_sig.contains(&left_sig)
        })
        .collect();

    Ok(Value::Vector(output))
}

fn vector_arithmetic_operators(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: Vec<InstantValue>,
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
    let rhs_sig: HashMap<u64, InstantValue> = right
        .into_par_iter()
        .map(|instant| {
            let signature = labels_to_compare(&instant.labels).signature();
            (signature, instant)
        })
        .collect();

    // Iterate over left and pick up the corresponding instance from rhs
    let output: Vec<InstantValue> = left
        .into_par_iter()
        .flat_map(|instant| {
            let left_sig = labels_to_compare(&instant.labels).signature();
            rhs_sig
                .get(&left_sig)
                .map(|rhs_instant| (instant, rhs_instant))
        })
        .flat_map(|(mut lhs_instant, rhs_instant)| {
            scalar_binary_operations(
                operator,
                lhs_instant.sample.value,
                rhs_instant.sample.value,
                return_bool,
                comparison_operator,
            )
            .ok()
            .map(|value| {
                let mut labels = std::mem::take(&mut lhs_instant.labels);
                // if return_bool || DROP_METRIC_VECTOR_BIN_OP.contains(&operator) {
                //     labels = labels.without_metric_name();
                // }

                if let Some(modifier) = expr.modifier.as_ref() {
                    if modifier.card == VectorMatchCardinality::OneToOne {
                        labels = labels_to_compare(&labels);
                    }

                    // group_labels from the `group_x` modifier are taken from the "one"-side.
                    if let Some(group_labels) = modifier.card.labels() {
                        for ln in group_labels.labels.iter() {
                            let value = rhs_instant.labels.get_value(ln);
                            if !value.is_empty() {
                                labels.set(ln, &value);
                            }
                        }
                    }
                }
                InstantValue {
                    labels,
                    sample: Sample {
                        timestamp: lhs_instant.sample.timestamp,
                        value,
                    },
                }
            })
        })
        .collect();

    Ok(Value::Vector(output))
}

/// Implement binary operations between two vectors
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#comparison-binary-operators
///
/// Between two instant vectors, a binary arithmetic operator is applied to each
/// entry in the left-hand side vector and its matching element in the
/// right-hand vector. The result is propagated into the result vector with the
/// grouping labels becoming the output label set. The metric name is dropped.
/// Entries for which no matching entry in the right-hand vector can be found
/// are not part of the result.
///
///
/// Between two instant vectors, comparison binary operators behave as a filter
/// by default, applied to matching entries. Vector elements for which the
/// expression is not true or which do not find a match on the other side of the
/// expression get dropped from the result, while the others are propagated into
/// a result vector with the grouping labels becoming the output label set. If
/// the bool modifier is provided, vector elements that would have been dropped
/// instead have the value 0 and vector elements that would be kept have the
/// value 1, with the grouping labels again becoming the output label set. The
/// metric name is dropped if the bool modifier is provided.
pub fn vector_bin_op(
    expr: &BinaryExpr,
    left: Vec<InstantValue>,
    right: Vec<InstantValue>,
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

    use super::*;
    use crate::service::promql::value::{Label, Sample};

    // Helper function to create test data for vector operations
    fn create_test_vector_data() -> Vec<InstantValue> {
        vec![
            create_test_instant_value(1.0, vec![("instance", "localhost"), ("job", "node")]),
            create_test_instant_value(2.0, vec![("instance", "localhost"), ("job", "node")]),
            create_test_instant_value(3.0, vec![("instance", "remote"), ("job", "api")]),
        ]
    }

    fn create_test_instant_value(value: f64, labels: Vec<(&str, &str)>) -> InstantValue {
        let labels = labels
            .into_iter()
            .map(|(k, v)| Arc::new(Label::new(k, v)))
            .collect();
        InstantValue {
            labels,
            sample: Sample {
                timestamp: 1640995200000000i64,
                value,
            },
        }
    }

    // Simple tests that don't require complex BinaryExpr construction
    #[test]
    fn test_instant_value_creation() {
        let instant = create_test_instant_value(42.0, vec![("instance", "localhost")]);
        assert_eq!(instant.sample.value, 42.0);
        assert_eq!(instant.sample.timestamp, 1640995200000000i64);
        assert_eq!(instant.labels.len(), 1);
        assert_eq!(instant.labels[0].name, "instance");
        assert_eq!(instant.labels[0].value, "localhost");
    }

    #[test]
    fn test_instant_value_with_multiple_labels() {
        let instant = create_test_instant_value(
            100.0,
            vec![("env", "prod"), ("region", "us-west"), ("service", "api")],
        );
        assert_eq!(instant.sample.value, 100.0);
        assert_eq!(instant.labels.len(), 3);

        let label_names: Vec<&str> = instant.labels.iter().map(|l| l.name.as_str()).collect();
        assert!(label_names.contains(&"env"));
        assert!(label_names.contains(&"region"));
        assert!(label_names.contains(&"service"));
    }

    #[test]
    fn test_instant_value_empty_labels() {
        let instant = create_test_instant_value(0.0, vec![]);
        assert_eq!(instant.sample.value, 0.0);
        assert!(instant.labels.is_empty());
    }

    #[test]
    fn test_instant_value_numeric_values() {
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
            let instant = create_test_instant_value(value, vec![("test", description)]);
            assert_eq!(instant.sample.value, value, "Failed for: {description}");
        }
    }

    #[test]
    fn test_instant_value_timestamp_consistency() {
        let instant1 = create_test_instant_value(1.0, vec![("a", "1")]);
        let instant2 = create_test_instant_value(2.0, vec![("b", "2")]);

        // Both should have the same timestamp
        assert_eq!(instant1.sample.timestamp, instant2.sample.timestamp);
        assert_eq!(instant1.sample.timestamp, 1640995200000000i64);
    }

    #[test]
    fn test_label_creation() {
        let labels = vec![
            ("cpu", "0"),
            ("mode", "idle"),
            ("instance", "localhost:9100"),
        ];
        let instant = create_test_instant_value(75.5, labels.clone());

        for (i, (expected_name, expected_value)) in labels.iter().enumerate() {
            assert_eq!(instant.labels[i].name, *expected_name);
            assert_eq!(instant.labels[i].value, *expected_value);
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
    fn test_vector_operations_parallel_processing() {
        // Test that we can process vectors in parallel (simulating what the actual functions do)
        let vector = vec![
            create_test_instant_value(1.0, vec![("a", "1")]),
            create_test_instant_value(2.0, vec![("a", "2")]),
            create_test_instant_value(3.0, vec![("a", "3")]),
            create_test_instant_value(4.0, vec![("a", "4")]),
            create_test_instant_value(5.0, vec![("a", "5")]),
        ];

        // Simulate parallel processing by mapping over the vector
        let processed: Vec<f64> = vector
            .par_iter()
            .map(|instant| instant.sample.value * 2.0)
            .collect();

        assert_eq!(processed.len(), 5);
        assert_eq!(processed[0], 2.0);
        assert_eq!(processed[1], 4.0);
        assert_eq!(processed[2], 6.0);
        assert_eq!(processed[3], 8.0);
        assert_eq!(processed[4], 10.0);
    }

    #[test]
    fn test_vector_operations_error_scenarios() {
        // Test scenarios that could lead to errors in vector operations

        // Test with very large numbers
        let large_vector = [
            create_test_instant_value(f64::MAX, vec![("a", "1")]),
            create_test_instant_value(f64::MIN, vec![("a", "2")]),
        ];

        assert!(large_vector[0].sample.value.is_finite());
        assert!(large_vector[1].sample.value.is_finite());

        // Test with NaN values
        let nan_vector = [create_test_instant_value(f64::NAN, vec![("a", "1")])];

        // Should handle NaN gracefully
        assert!(nan_vector[0].sample.value.is_nan());
    }

    #[test]
    fn test_vector_operations_data_structures() {
        // Test InstantValue creation and properties
        let value =
            create_test_instant_value(42.0, vec![("label1", "value1"), ("label2", "value2")]);
        assert_eq!(value.sample.value, 42.0);
        assert_eq!(value.labels.len(), 2);
        assert_eq!(value.labels[0].name, "label1");
        assert_eq!(value.labels[0].value, "value1");
        assert_eq!(value.labels[1].name, "label2");
        assert_eq!(value.labels[1].value, "value2");
    }

    #[test]
    fn test_vector_operations_timestamp_consistency() {
        let timestamp = 1640995200000000i64;
        let value = create_test_instant_value(10.0, vec![("test", "value")]);
        assert_eq!(value.sample.timestamp, timestamp);
    }

    #[test]
    fn test_vector_operations_label_handling() {
        let value = create_test_instant_value(5.0, vec![("a", "1"), ("b", "2"), ("c", "3")]);
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
    fn test_vector_operations_empty_labels() {
        let value = create_test_instant_value(0.0, vec![]);
        assert_eq!(value.labels.len(), 0);
        assert_eq!(value.sample.value, 0.0);
    }

    #[test]
    fn test_vector_operations_negative_values() {
        let value = create_test_instant_value(-15.5, vec![("negative", "test")]);
        assert_eq!(value.sample.value, -15.5);
        assert_eq!(value.labels.len(), 1);
        assert_eq!(value.labels[0].name, "negative");
        assert_eq!(value.labels[0].value, "test");
    }

    #[test]
    fn test_vector_operations_large_numbers() {
        let value = create_test_instant_value(1e15, vec![("large", "number")]);
        assert_eq!(value.sample.value, 1e15);
        assert_eq!(value.labels.len(), 1);
    }

    #[test]
    fn test_vector_operations_special_floats() {
        let value = create_test_instant_value(f64::INFINITY, vec![("inf", "test")]);
        assert!(value.sample.value.is_infinite());
        assert!(value.sample.value.is_sign_positive());

        let value = create_test_instant_value(f64::NEG_INFINITY, vec![("neg_inf", "test")]);
        assert!(value.sample.value.is_infinite());
        assert!(value.sample.value.is_sign_negative());

        let value = create_test_instant_value(f64::NAN, vec![("nan", "test")]);
        assert!(value.sample.value.is_nan());
    }

    #[test]
    fn test_vector_operations_unicode_labels() {
        let value =
            create_test_instant_value(1.0, vec![("🚀", "🚀"), ("测试", "测试"), ("🎉", "🎉")]);
        assert_eq!(value.labels.len(), 3);
        assert_eq!(value.labels[0].name, "🚀");
        assert_eq!(value.labels[0].value, "🚀");
        assert_eq!(value.labels[1].name, "测试");
        assert_eq!(value.labels[1].value, "测试");
        assert_eq!(value.labels[2].name, "🎉");
        assert_eq!(value.labels[2].value, "🎉");
    }

    #[test]
    fn test_vector_operations_long_labels() {
        let long_name = "a".repeat(1000);
        let long_value = "b".repeat(1000);
        let value = create_test_instant_value(1.0, vec![(&long_name, &long_value)]);
        assert_eq!(value.labels.len(), 1);
        assert_eq!(value.labels[0].name, long_name);
        assert_eq!(value.labels[0].value, long_value);
    }

    #[test]
    fn test_vector_operations_duplicate_labels() {
        let value = create_test_instant_value(1.0, vec![("a", "1"), ("a", "2"), ("a", "3")]);
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
    fn test_vector_operations_edge_case_values() {
        let value = create_test_instant_value(f64::EPSILON, vec![("epsilon", "test")]);
        assert_eq!(value.sample.value, f64::EPSILON);

        let value = create_test_instant_value(f64::MIN_POSITIVE, vec![("min_positive", "test")]);
        assert_eq!(value.sample.value, f64::MIN_POSITIVE);

        let value = create_test_instant_value(f64::MAX, vec![("max", "test")]);
        assert_eq!(value.sample.value, f64::MAX);
    }

    #[test]
    fn test_vector_operations_vector_data() {
        let vector_data = create_test_vector_data();
        assert_eq!(vector_data.len(), 3);

        // Test first element
        assert_eq!(vector_data[0].sample.value, 1.0);
        assert_eq!(vector_data[0].labels.len(), 2);
        assert_eq!(vector_data[0].labels[0].name, "instance");
        assert_eq!(vector_data[0].labels[0].value, "localhost");

        // Test second element
        assert_eq!(vector_data[1].sample.value, 2.0);
        assert_eq!(vector_data[1].labels.len(), 2);

        // Test third element
        assert_eq!(vector_data[2].sample.value, 3.0);
        assert_eq!(vector_data[2].labels.len(), 2);
        assert_eq!(vector_data[2].labels[0].name, "instance");
        assert_eq!(vector_data[2].labels[0].value, "remote");
    }

    #[test]
    fn test_vector_operations_label_signatures() {
        let value1 = create_test_instant_value(1.0, vec![("a", "1"), ("b", "2")]);
        let value2 = create_test_instant_value(2.0, vec![("a", "1"), ("b", "2")]);
        let value3 = create_test_instant_value(3.0, vec![("a", "1"), ("b", "3")]);

        // value1 and value2 should have the same signature (same labels)
        let sig1 = signature(&value1.labels);
        let sig2 = signature(&value2.labels);
        let sig3 = signature(&value3.labels);

        assert_eq!(sig1, sig2);
        assert_ne!(sig1, sig3);
        assert_ne!(sig2, sig3);
    }

    #[test]
    fn test_vector_operations_empty_vector() {
        let empty_vector: Vec<InstantValue> = vec![];
        assert_eq!(empty_vector.len(), 0);

        // Test that we can create an empty vector and it doesn't panic
        let empty_vector_with_capacity: Vec<InstantValue> = Vec::with_capacity(100);
        assert_eq!(empty_vector_with_capacity.len(), 0);
        assert_eq!(empty_vector_with_capacity.capacity(), 100);
    }

    #[test]
    fn test_vector_operations_single_element() {
        let single_element = [create_test_instant_value(42.0, vec![("single", "test")])];
        assert_eq!(single_element.len(), 1);
        assert_eq!(single_element[0].sample.value, 42.0);
        assert_eq!(single_element[0].labels.len(), 1);
        assert_eq!(single_element[0].labels[0].name, "single");
        assert_eq!(single_element[0].labels[0].value, "test");
    }
}

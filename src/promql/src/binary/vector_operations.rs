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

use std::collections::{HashMap, HashSet, hash_map::Entry};

use config::meta::promql::{
    NAME_LABEL,
    value::{Labels, LabelsExt, RangeValue, Sample, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{BinaryExpr, VectorMatchCardinality, token};
use rayon::prelude::*;

use crate::binary::scalar_binary_operations;

// DROP_METRIC_BIN_OP if the operation is one of these, drop the metric __name__
pub const DROP_METRIC_BIN_OP: [u8; 7] = [
    token::T_ADD,
    token::T_SUB,
    token::T_DIV,
    token::T_MUL,
    token::T_POW,
    token::T_MOD,
    token::T_ATAN2,
];

/// The "one"-side series sharing a matching signature, indexed by timestamp.
struct OneSideGroup {
    labels: Vec<Labels>,
    samples: HashMap<i64, (usize, f64)>,
    /// Timestamps where two series of the group have samples, with the indexes of both series.
    duplicates: Vec<(i64, usize, usize)>,
}

impl OneSideGroup {
    fn new(series: Vec<RangeValue>) -> Self {
        let mut labels: Vec<Labels> = Vec::with_capacity(series.len());
        let mut samples = HashMap::with_capacity(series.first().map_or(0, |s| s.samples.len()));
        let mut duplicates = vec![];
        for (idx, range) in series.into_iter().enumerate() {
            labels.push(range.labels);
            for sample in &range.samples {
                match samples.entry(sample.timestamp) {
                    Entry::Occupied(entry) => {
                        let (other, _) = *entry.get();
                        duplicates.push((sample.timestamp, other, idx));
                    }
                    Entry::Vacant(entry) => {
                        entry.insert((idx, sample.value));
                    }
                }
            }
        }
        Self {
            labels,
            samples,
            duplicates,
        }
    }
}

/// Samples of one "many"-side series matched against one "one"-side series.
struct MatchedSeries {
    /// Key under which two matches may not share a timestamp.
    unique_key: u64,
    range: RangeValue,
}

/// Implement the operation between a matrix and a float.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators
pub fn vector_scalar_bin_op(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: f64,
    swapped_lhs_rhs: bool,
) -> Result<Value> {
    vector_scalar_op(expr, left, swapped_lhs_rhs, |_| Some(right))
}

/// Implement the operation between a matrix and a scalar that holds one value per step.
pub fn vector_step_scalar_bin_op(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: &[Sample],
    swapped_lhs_rhs: bool,
) -> Result<Value> {
    let right: HashMap<i64, f64> = right.iter().map(|s| (s.timestamp, s.value)).collect();
    vector_scalar_op(expr, left, swapped_lhs_rhs, |timestamp| {
        right.get(&timestamp).copied()
    })
}

fn vector_scalar_op(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    swapped_lhs_rhs: bool,
    scalar_at: impl Fn(i64) -> Option<f64> + Sync,
) -> Result<Value> {
    let is_comparison_operator = expr.op.is_comparison_operator();
    let return_bool = expr.return_bool();
    let drop_metric_name = return_bool || DROP_METRIC_BIN_OP.contains(&expr.op.id());
    let output: Vec<RangeValue> = left
        .into_par_iter()
        .filter_map(|mut range| {
            let new_samples: Vec<Sample> = range
                .samples
                .into_iter()
                .filter_map(|sample| {
                    let right = scalar_at(sample.timestamp)?;
                    let (lhs, rhs) = if swapped_lhs_rhs {
                        (right, sample.value)
                    } else {
                        (sample.value, right)
                    };
                    let value = scalar_binary_operations(
                        expr.op.id(),
                        lhs,
                        rhs,
                        return_bool,
                        is_comparison_operator,
                    )
                    .ok()?;
                    let value = if is_comparison_operator && swapped_lhs_rhs && !return_bool {
                        sample.value
                    } else {
                        value
                    };
                    Some(Sample {
                        timestamp: sample.timestamp,
                        value,
                    })
                })
                .collect();

            if new_samples.is_empty() {
                None
            } else {
                let mut labels = std::mem::take(&mut range.labels);
                if drop_metric_name {
                    labels = labels.without_metric_name();
                }
                range.labels = labels;
                range.samples = new_samples;
                Some(range)
            }
        })
        .collect();

    if drop_metric_name {
        return Ok(Value::Matrix(merge_same_labelset(output)?));
    }
    Ok(Value::Matrix(output))
}

/// matrix1 or matrix2 results in a matrix that contains all original elements
/// (label sets + values) of matrix1 and additionally all elements of matrix2
/// which do not have matching label sets in matrix1.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_or(expr: &BinaryExpr, left: Vec<RangeValue>, right: Vec<RangeValue>) -> Result<Value> {
    validate_set_matching(expr)?;
    if left.is_empty() {
        return Ok(Value::Matrix(right));
    }
    if right.is_empty() {
        return Ok(Value::Matrix(left));
    }
    // Add all right-hand side elements which have not been added from the left-hand
    // side.
    let unmatched = filter_set_series(right, &left, false);
    let mut output = left;
    output.extend(unmatched);
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
    validate_set_matching(expr)?;
    // If right is empty, we simply return the left
    // if left is empty we will return it anyway.
    if left.is_empty() || right.is_empty() {
        return Ok(Value::Matrix(left));
    }
    Ok(Value::Matrix(filter_set_series(left, &right, false)))
}

/// matrix1 and matrix2 results in a matrix consisting of the elements of
/// matrix1 for which there are elements in matrix2 with exactly matching label
/// sets. Other elements are dropped. The metric name and values are carried
/// over from the left-hand side matrix.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_and(expr: &BinaryExpr, left: Vec<RangeValue>, right: Vec<RangeValue>) -> Result<Value> {
    validate_set_matching(expr)?;
    // If either left or right is empty, we return an empty array.
    if left.is_empty() || right.is_empty() {
        return Ok(Value::Matrix(vec![]));
    }
    let output = filter_set_series(left, &right, true)
        .into_par_iter()
        .map(|mut range| {
            range.labels = range.labels.without_metric_name();
            range
        })
        .collect();
    Ok(Value::Matrix(output))
}

fn validate_set_matching(expr: &BinaryExpr) -> Result<()> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }
    Ok(())
}

fn filter_set_series(
    input: Vec<RangeValue>,
    other: &[RangeValue],
    keep_matches: bool,
) -> Vec<RangeValue> {
    let signatures: HashSet<u64> = other
        .par_iter()
        .map(|series| series.labels.signature())
        .collect();
    input
        .into_par_iter()
        .filter(|series| signatures.contains(&series.labels.signature()) == keep_matches)
        .collect()
}

fn vector_arithmetic_operators(
    expr: &BinaryExpr,
    left: Vec<RangeValue>,
    right: Vec<RangeValue>,
) -> Result<Value> {
    let is_matching_on = expr.is_matching_on();
    let matching_labels: Vec<String> = expr
        .modifier
        .as_ref()
        .and_then(|modifier| modifier.matching.as_ref())
        .map(|matching| matching.labels().labels.clone())
        .unwrap_or_default();
    let mut excluded_labels = matching_labels.clone();
    excluded_labels.push(NAME_LABEL.to_string());

    let match_signature = |labels: &Labels| {
        if is_matching_on {
            labels.keep(&matching_labels).signature()
        } else {
            labels.delete(&excluded_labels).signature()
        }
    };

    let card = expr.modifier.as_ref().map(|modifier| &modifier.card);
    // group_right makes the lhs the "one" side, so the rhs series drive the output
    let one_to_many = matches!(card, Some(VectorMatchCardinality::OneToMany(_)));
    let one_to_one = card.is_none_or(|card| *card == VectorMatchCardinality::OneToOne);
    let (many, one, one_side) = if one_to_many {
        (right, left, "left")
    } else {
        (left, right, "right")
    };

    let mut one_series: HashMap<u64, Vec<RangeValue>> = HashMap::new();
    for (signature, range) in one
        .into_par_iter()
        .map(|range| (match_signature(&range.labels), range))
        .collect::<Vec<_>>()
    {
        one_series.entry(signature).or_default().push(range);
    }
    let one_groups: HashMap<u64, OneSideGroup> = one_series
        .into_par_iter()
        .map(|(signature, series)| (signature, OneSideGroup::new(series)))
        .collect();
    check_one_side_duplicates(&one_groups, &many, one_side)?;

    let matched: Vec<MatchedSeries> = many
        .into_par_iter()
        .flat_map_iter(|range| {
            let signature = match_signature(&range.labels);
            match one_groups.get(&signature) {
                Some(group) => {
                    let pairs = match_series(expr, &range, group, one_to_many, &matching_labels);
                    pairs
                        .into_iter()
                        .map(|range| MatchedSeries {
                            unique_key: if one_to_one {
                                signature
                            } else {
                                range.labels.signature()
                            },
                            range,
                        })
                        .collect()
                }
                None => vec![],
            }
        })
        .collect();

    Ok(Value::Matrix(merge_matched_series(matched, one_to_one)?))
}

/// Applies the operator to one "many"-side series, split by the "one"-side series each step
/// matched.
fn match_series(
    expr: &BinaryExpr,
    range: &RangeValue,
    group: &OneSideGroup,
    one_to_many: bool,
    matching_labels: &[String],
) -> Vec<RangeValue> {
    let operator = expr.op.id();
    let return_bool = expr.return_bool();
    let comparison_operator = expr.op.is_comparison_operator();

    let mut per_one_series: Vec<(usize, Vec<Sample>)> = vec![];
    for sample in &range.samples {
        let Some(&(idx, one_value)) = group.samples.get(&sample.timestamp) else {
            continue;
        };
        let (lhs, rhs) = if one_to_many {
            (one_value, sample.value)
        } else {
            (sample.value, one_value)
        };
        let Ok(value) =
            scalar_binary_operations(operator, lhs, rhs, return_bool, comparison_operator)
        else {
            continue;
        };
        let sample = Sample {
            timestamp: sample.timestamp,
            value,
        };
        match per_one_series.iter_mut().find(|(i, _)| *i == idx) {
            Some((_, samples)) => samples.push(sample),
            None => per_one_series.push((idx, vec![sample])),
        }
    }

    per_one_series
        .into_iter()
        .map(|(idx, samples)| RangeValue {
            labels: result_labels(
                expr,
                range.labels.clone(),
                &group.labels[idx],
                matching_labels,
            ),
            samples,
            exemplars: range.exemplars.clone(),
            time_window: range.time_window.clone(),
        })
        .collect()
}

/// Rejects "one"-side duplicates only at steps where the "many" side has samples.
fn check_one_side_duplicates(
    groups: &HashMap<u64, OneSideGroup>,
    many: &[RangeValue],
    side: &str,
) -> Result<()> {
    if groups.values().all(|group| group.duplicates.is_empty()) {
        return Ok(());
    }
    let many_timestamps: HashSet<i64> = many
        .iter()
        .flat_map(|range| range.samples.iter().map(|s| s.timestamp))
        .collect();
    for group in groups.values() {
        if let Some(&(_, first, second)) = group
            .duplicates
            .iter()
            .find(|(timestamp, ..)| many_timestamps.contains(timestamp))
        {
            return Err(DataFusionError::Execution(format!(
                "found duplicate series for the match group on the {side} hand-side of the operation: [{}, {}];many-to-many matching not allowed: matching labels must be unique on one side",
                format_labels(&group.labels[first]),
                format_labels(&group.labels[second]),
            )));
        }
    }
    Ok(())
}

/// Rejects ambiguous matches at a timestamp and merges results that end up with the same labels.
fn merge_matched_series(matched: Vec<MatchedSeries>, one_to_one: bool) -> Result<Vec<RangeValue>> {
    let mut by_key: HashMap<u64, Vec<usize>> = HashMap::with_capacity(matched.len());
    for (idx, series) in matched.iter().enumerate() {
        by_key.entry(series.unique_key).or_default().push(idx);
    }
    for indexes in by_key.values().filter(|indexes| indexes.len() > 1) {
        let mut timestamps = HashSet::new();
        for &idx in indexes {
            let range = &matched[idx].range;
            if range
                .samples
                .iter()
                .any(|s| !timestamps.insert(s.timestamp))
            {
                return Err(DataFusionError::Execution(if one_to_one {
                    format!(
                        "multiple matches for labels {}: many-to-one matching must be explicit (group_left/group_right)",
                        format_labels(&range.labels)
                    )
                } else {
                    format!(
                        "multiple matches for labels {}: grouping labels must ensure unique matches",
                        format_labels(&range.labels)
                    )
                }));
            }
        }
    }

    merge_same_labelset(matched.into_iter().map(|series| series.range).collect())
}

/// Merges series left with the same labels, rejecting two samples of one labelset at a timestamp.
fn merge_same_labelset(series: Vec<RangeValue>) -> Result<Vec<RangeValue>> {
    let mut output: Vec<RangeValue> = Vec::with_capacity(series.len());
    let mut merged = vec![false; series.len()];
    let mut by_labels: HashMap<u64, usize> = HashMap::with_capacity(series.len());
    for range in series {
        match by_labels.entry(range.labels.signature()) {
            Entry::Occupied(entry) => {
                output[*entry.get()].samples.extend(range.samples);
                merged[*entry.get()] = true;
            }
            Entry::Vacant(entry) => {
                entry.insert(output.len());
                output.push(range);
            }
        }
    }
    for (range, _) in output.iter_mut().zip(merged).filter(|(_, merged)| *merged) {
        range.samples.sort_unstable_by_key(|s| s.timestamp);
        if range
            .samples
            .windows(2)
            .any(|pair| pair[0].timestamp == pair[1].timestamp)
        {
            return Err(DataFusionError::Execution(format!(
                "vector cannot contain metrics with the same labelset {}",
                format_labels(&range.labels)
            )));
        }
    }
    Ok(output)
}

/// Output labels of a matched pair, following Prometheus' `resultMetric`.
fn result_labels(
    expr: &BinaryExpr,
    labels: Labels,
    one_side: &Labels,
    matching_labels: &[String],
) -> Labels {
    let mut labels = if DROP_METRIC_BIN_OP.contains(&expr.op.id()) {
        labels.without_metric_name()
    } else {
        labels
    };
    if let Some(modifier) = expr.modifier.as_ref() {
        if modifier.card == VectorMatchCardinality::OneToOne {
            labels = if expr.is_matching_on() {
                labels.keep(matching_labels)
            } else {
                labels.delete(matching_labels)
            };
        } else if let Some(group_labels) = modifier.card.labels() {
            // group_labels from the `group_x` modifier are taken from the "one"-side.
            for ln in group_labels.labels.iter() {
                labels = labels.without_label(ln);
                let value = one_side.get_value(ln);
                if !value.is_empty() {
                    labels.set(ln, &value);
                }
            }
            labels.sort();
        }
    }
    // bool drops the name only now, so a __name__ copied by group_x is removed too
    if expr.return_bool() {
        labels.without_metric_name()
    } else {
        labels
    }
}

fn format_labels(labels: &Labels) -> String {
    let pairs: Vec<String> = labels
        .iter()
        .map(|label| format!("{}=\"{}\"", label.name, label.value))
        .collect();
    format!("{{{}}}", pairs.join(", "))
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

    use config::meta::promql::value::{Label, Sample, signature};

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

    fn try_eval_bin_op(
        query: &str,
        left: Vec<RangeValue>,
        right: Vec<RangeValue>,
    ) -> Result<Vec<RangeValue>> {
        let promql_parser::parser::Expr::Binary(expr) =
            promql_parser::parser::parse(query).unwrap()
        else {
            panic!("not a binary expression: {query}");
        };
        match vector_bin_op(&expr, left, right)? {
            Value::Matrix(matrix) => Ok(matrix),
            other => panic!("expected a matrix, got {other:?}"),
        }
    }

    fn eval_bin_op(query: &str, left: Vec<RangeValue>, right: Vec<RangeValue>) -> Vec<RangeValue> {
        try_eval_bin_op(query, left, right).unwrap()
    }

    fn range_at(samples: &[(i64, f64)], labels: Vec<(&str, &str)>) -> RangeValue {
        let mut range = create_test_range_value(vec![], labels);
        range.samples = samples
            .iter()
            .map(|&(timestamp, value)| Sample { timestamp, value })
            .collect();
        range
    }

    fn sample_pairs(range: &RangeValue) -> Vec<(i64, f64)> {
        range
            .samples
            .iter()
            .map(|s| (s.timestamp, s.value))
            .collect()
    }

    fn label_pairs(range: &RangeValue) -> Vec<(String, String)> {
        range
            .labels
            .iter()
            .map(|l| (l.name.clone(), l.value.clone()))
            .collect()
    }

    fn sorted_results(matrix: Vec<RangeValue>) -> Vec<(Vec<(String, String)>, f64)> {
        let mut results: Vec<_> = matrix
            .iter()
            .map(|range| (label_pairs(range), range.samples[0].value))
            .collect();
        results.sort_by(|a, b| a.0.cmp(&b.0));
        results
    }

    fn pairs(labels: &[(&str, &str)]) -> Vec<(String, String)> {
        labels
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn per_code() -> Vec<RangeValue> {
        vec![
            create_test_range_value(vec![3.0], vec![("code", "200")]),
            create_test_range_value(vec![1.0], vec![("code", "500")]),
        ]
    }

    fn total() -> Vec<RangeValue> {
        vec![create_test_range_value(vec![4.0], vec![])]
    }

    #[test]
    fn test_ignoring_group_left_matches_label_less_rhs() {
        let query = "sum(rate(http_requests_total[5m])) by (code) / ignoring (code) group_left sum(rate(http_requests_total[5m]))";
        let results = sorted_results(eval_bin_op(query, per_code(), total()));
        assert_eq!(
            results,
            vec![
                (pairs(&[("code", "200")]), 0.75),
                (pairs(&[("code", "500")]), 0.25),
            ]
        );
    }

    #[test]
    fn test_on_empty_group_left_matches_label_less_rhs() {
        let results = sorted_results(eval_bin_op("a / on () group_left b", per_code(), total()));
        assert_eq!(
            results,
            vec![
                (pairs(&[("code", "200")]), 0.75),
                (pairs(&[("code", "500")]), 0.25),
            ]
        );
    }

    #[test]
    fn test_group_right_keeps_rhs_series_and_operand_order() {
        for query in [
            "a / on () group_right b",
            "a / ignoring (code) group_right b",
        ] {
            let results = sorted_results(eval_bin_op(query, total(), per_code()));
            assert_eq!(
                results,
                vec![
                    (pairs(&[("code", "200")]), 4.0 / 3.0),
                    (pairs(&[("code", "500")]), 4.0),
                ],
                "{query}"
            );
        }
    }

    #[test]
    fn test_group_right_comparison_filters_on_lhs_value() {
        let results = sorted_results(eval_bin_op(
            "a > on () group_right b",
            vec![create_test_range_value(vec![2.0], vec![])],
            per_code(),
        ));
        assert_eq!(results, vec![(pairs(&[("code", "500")]), 2.0)]);
    }

    #[test]
    fn test_ignoring_one_to_one_drops_ignored_labels() {
        let left = vec![create_test_range_value(
            vec![5.0],
            vec![("__name__", "a"), ("code", "200"), ("job", "api")],
        )];
        let right = vec![create_test_range_value(
            vec![2.0],
            vec![("__name__", "b"), ("job", "api")],
        )];
        let results = sorted_results(eval_bin_op("a - ignoring (code) b", left, right));
        assert_eq!(results, vec![(pairs(&[("job", "api")]), 3.0)]);
    }

    #[test]
    fn test_ignoring_comparison_keeps_metric_name() {
        let left = vec![create_test_range_value(
            vec![5.0],
            vec![("__name__", "a"), ("code", "200"), ("job", "api")],
        )];
        let right = vec![create_test_range_value(
            vec![2.0],
            vec![("__name__", "b"), ("job", "api")],
        )];
        let results = sorted_results(eval_bin_op("a > ignoring (code) b", left, right));
        assert_eq!(
            results,
            vec![(pairs(&[("__name__", "a"), ("job", "api")]), 5.0)]
        );
    }

    #[test]
    fn test_group_left_labels_replace_many_side_values() {
        let left = vec![
            create_test_range_value(
                vec![1.0],
                vec![("instance", "a"), ("job", "api"), ("version", "old")],
            ),
            create_test_range_value(vec![2.0], vec![("instance", "b"), ("job", "db")]),
        ];
        let right = vec![
            create_test_range_value(vec![10.0], vec![("job", "api"), ("version", "v2")]),
            create_test_range_value(vec![10.0], vec![("job", "db")]),
        ];
        let results = sorted_results(eval_bin_op(
            "a * on (job) group_left (version) b",
            left,
            right,
        ));
        assert_eq!(
            results,
            vec![
                (
                    pairs(&[("instance", "a"), ("job", "api"), ("version", "v2")]),
                    10.0
                ),
                (pairs(&[("instance", "b"), ("job", "db")]), 20.0),
            ]
        );
    }

    #[test]
    fn test_one_side_series_changing_over_time_all_match() {
        let left = vec![range_at(&[(1, 10.0), (2, 20.0)], vec![("job", "api")])];
        let right = vec![
            range_at(&[(1, 2.0)], vec![("instance", "x"), ("job", "api")]),
            range_at(&[(2, 4.0)], vec![("instance", "y"), ("job", "api")]),
        ];
        let result = eval_bin_op("a / ignoring (instance) group_left b", left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(label_pairs(&result[0]), pairs(&[("job", "api")]));
        assert_eq!(sample_pairs(&result[0]), vec![(1, 5.0), (2, 5.0)]);
    }

    #[test]
    fn test_one_side_duplicate_at_same_timestamp_errors() {
        let left = vec![range_at(&[(1, 10.0)], vec![("job", "api")])];
        let right = vec![
            range_at(&[(1, 2.0)], vec![("instance", "x"), ("job", "api")]),
            range_at(&[(1, 4.0)], vec![("instance", "y"), ("job", "api")]),
        ];
        let err = try_eval_bin_op("a / ignoring (instance) group_left b", left, right)
            .unwrap_err()
            .to_string();
        assert!(err.contains("many-to-many matching not allowed"), "{err}");
    }

    #[test]
    fn test_one_to_one_many_matches_at_same_timestamp_errors() {
        let left = vec![
            range_at(&[(1, 3.0)], vec![("code", "200"), ("job", "api")]),
            range_at(&[(1, 1.0)], vec![("code", "500"), ("job", "api")]),
        ];
        let right = vec![range_at(&[(1, 4.0)], vec![("job", "api")])];
        let err = try_eval_bin_op("a + ignoring (code) b", left, right)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("many-to-one matching must be explicit"),
            "{err}"
        );
    }

    #[test]
    fn test_one_to_one_matches_at_different_timestamps_merge() {
        let left = vec![
            range_at(&[(2, 1.0)], vec![("code", "500"), ("job", "api")]),
            range_at(&[(1, 3.0)], vec![("code", "200"), ("job", "api")]),
        ];
        let right = vec![range_at(&[(1, 4.0), (2, 4.0)], vec![("job", "api")])];
        let result = eval_bin_op("a + ignoring (code) b", left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(label_pairs(&result[0]), pairs(&[("job", "api")]));
        assert_eq!(sample_pairs(&result[0]), vec![(1, 7.0), (2, 5.0)]);
    }

    #[test]
    fn test_group_left_duplicate_output_at_same_timestamp_errors() {
        let left = vec![
            range_at(&[(1, 3.0)], vec![("code", "200"), ("job", "api")]),
            range_at(&[(1, 1.0)], vec![("code", "500"), ("job", "api")]),
        ];
        let right = vec![range_at(&[(1, 4.0)], vec![("job", "api")])];
        let err = try_eval_bin_op("a / ignoring (code) group_left (code) b", left, right)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("grouping labels must ensure unique matches"),
            "{err}"
        );
    }

    #[test]
    fn test_atan2_drops_metric_name() {
        let left = vec![range_at(
            &[(1, 1.0)],
            vec![("__name__", "a"), ("code", "200"), ("job", "api")],
        )];
        let right = vec![range_at(
            &[(1, 1.0)],
            vec![("__name__", "b"), ("job", "api")],
        )];
        let result = eval_bin_op("a atan2 ignoring (code) b", left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(label_pairs(&result[0]), pairs(&[("job", "api")]));
    }

    #[test]
    fn test_outputs_with_same_labels_at_same_timestamp_error() {
        let series = || {
            vec![
                range_at(&[(1, 1.0)], vec![("__name__", "a"), ("job", "x")]),
                range_at(&[(1, 2.0)], vec![("__name__", "b"), ("job", "x")]),
            ]
        };
        let err = try_eval_bin_op(
            r#"{__name__=~"a|b"} + on (__name__, job) {__name__=~"a|b"}"#,
            series(),
            series(),
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("same labelset"), "{err}");
    }

    #[test]
    fn test_one_side_series_with_repeated_timestamp_errors_without_panic() {
        let left = vec![range_at(&[(1, 1.0)], vec![("job", "x")])];
        let right = vec![range_at(&[(1, 1.0), (1, 2.0)], vec![("job", "x")])];
        let err = try_eval_bin_op("a + on (job) b", left, right)
            .unwrap_err()
            .to_string();
        assert!(err.contains("many-to-many matching not allowed"), "{err}");
    }

    #[test]
    fn test_one_side_duplicates_ignored_where_many_side_is_empty() {
        let right = || {
            vec![
                range_at(
                    &[(1, 1.0), (2, 1.0)],
                    vec![("instance", "i1"), ("job", "x")],
                ),
                range_at(&[(2, 1.0)], vec![("instance", "i2"), ("job", "x")]),
            ]
        };
        let left = vec![range_at(&[(1, 5.0)], vec![("job", "x")])];
        let result = eval_bin_op("a + on (job) b", left, right());
        assert_eq!(result.len(), 1);
        assert_eq!(sample_pairs(&result[0]), vec![(1, 6.0)]);

        let left = vec![range_at(&[(1, 5.0), (2, 5.0)], vec![("job", "x")])];
        let err = try_eval_bin_op("a + on (job) b", left, right())
            .unwrap_err()
            .to_string();
        assert!(err.contains("many-to-many matching not allowed"), "{err}");
    }

    fn eval_scalar_bin_op(query: &str, left: Vec<RangeValue>) -> Result<Vec<RangeValue>> {
        let promql_parser::parser::Expr::Binary(expr) =
            promql_parser::parser::parse(query).unwrap()
        else {
            panic!("not a binary expression: {query}");
        };
        match vector_scalar_bin_op(&expr, left, 1.0, false)? {
            Value::Matrix(matrix) => Ok(matrix),
            other => panic!("expected a matrix, got {other:?}"),
        }
    }

    #[test]
    fn test_scalar_op_dropping_name_rejects_same_labelset() {
        let left = vec![
            range_at(&[(1, 1.0)], vec![("__name__", "a"), ("job", "x")]),
            range_at(&[(1, 2.0)], vec![("__name__", "b"), ("job", "x")]),
        ];
        let err = eval_scalar_bin_op(r#"{__name__=~"a|b"} atan2 1"#, left)
            .unwrap_err()
            .to_string();
        assert!(err.contains("same labelset"), "{err}");
    }

    #[test]
    fn test_scalar_op_dropping_name_merges_disjoint_timestamps() {
        let left = vec![
            range_at(&[(2, 2.0)], vec![("__name__", "b"), ("job", "x")]),
            range_at(&[(1, 1.0)], vec![("__name__", "a"), ("job", "x")]),
        ];
        let result = eval_scalar_bin_op(r#"{__name__=~"a|b"} + 1"#, left).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(label_pairs(&result[0]), pairs(&[("job", "x")]));
        assert_eq!(sample_pairs(&result[0]), vec![(1, 2.0), (2, 3.0)]);
    }

    #[test]
    fn test_scalar_comparison_keeps_distinct_names() {
        let left = vec![
            range_at(&[(1, 5.0)], vec![("__name__", "a"), ("job", "x")]),
            range_at(&[(1, 5.0)], vec![("__name__", "b"), ("job", "x")]),
        ];
        let result = eval_scalar_bin_op(r#"{__name__=~"a|b"} > 1"#, left).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_bool_drops_name_copied_by_group_left() {
        let left = vec![range_at(
            &[(1, 5.0)],
            vec![("__name__", "a"), ("instance", "i1"), ("job", "x")],
        )];
        let right = vec![range_at(&[(1, 1.0)], vec![("__name__", "b"), ("job", "x")])];
        let result = eval_bin_op("a > bool on (job) group_left (__name__) b", left, right);
        assert_eq!(result.len(), 1);
        assert_eq!(
            label_pairs(&result[0]),
            pairs(&[("instance", "i1"), ("job", "x")])
        );
        assert_eq!(sample_pairs(&result[0]), vec![(1, 1.0)]);
    }

    #[test]
    fn test_arithmetic_keeps_name_copied_by_group_left() {
        let left = vec![range_at(
            &[(1, 5.0)],
            vec![("__name__", "a"), ("instance", "i1"), ("job", "x")],
        )];
        let right = vec![range_at(&[(1, 1.0)], vec![("__name__", "b"), ("job", "x")])];
        let result = eval_bin_op("a * on (job) group_left (__name__) b", left, right);
        assert_eq!(
            label_pairs(&result[0]),
            pairs(&[("__name__", "b"), ("instance", "i1"), ("job", "x")])
        );
    }
}

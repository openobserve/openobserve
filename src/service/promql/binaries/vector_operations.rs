use ahash::{HashMap, HashSet};

use crate::service::promql::{
    binaries::scalar_binary_operations,
    value::{signature, InstantValue, Sample, Signature, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{token, BinaryExpr, VectorMatchCardinality};
use rayon::prelude::*;

/// Implement the operation between a vector and a float.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators
pub async fn vector_scalar_bin_op(
    expr: &BinaryExpr,
    left: &[InstantValue],
    right: f64,
) -> Result<Value> {
    let is_comparison_operator = expr.op.is_comparison_operator();

    let output: Vec<InstantValue> = left
        .par_iter()
        .map(|instant| {
            let value =
                scalar_binary_operations(expr.op.id(), instant.sample.value, right).unwrap();
            (instant, value)
        })
        .filter(|(_instant, value)| {
            // If the operation was of type comparison and the value was True i.e. 1.0
            // Or if this is not a comparison operation at all, take it.
            !is_comparison_operator || *value > 0.0
        })
        .map(|(instant, value)| InstantValue {
            labels: instant.labels.clone(),
            sample: Sample {
                timestamp: instant.sample.timestamp,
                value,
            },
        })
        .collect();
    Ok(Value::Vector(output))
}

/// vector1 or vector2 results in a vector that contains all original elements (label sets + values)
/// of vector1 and additionally all elements of vector2 which do not have matching label sets in vector1.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_or(expr: &BinaryExpr, left: &[InstantValue], right: &[InstantValue]) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    if left.is_empty() {
        return Ok(Value::Vector(right.to_vec()));
    }

    if right.is_empty() {
        return Ok(Value::Vector(left.to_vec()));
    }

    let lhs_sig: HashSet<Signature> = left
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Add all right-hand side elements which have not been added from the left-hand side.
    let right_instants: Vec<InstantValue> = right
        .par_iter()
        .filter(|item| {
            let right_sig = signature(&item.labels);
            !lhs_sig.contains(&right_sig)
        })
        .map(|item| item.clone())
        .collect();

    let output = [left, &right_instants].concat();
    Ok(Value::Vector(output))
}

/// vector1 unless vector2 results in a vector consisting of the elements of vector1
/// for which there are no elements in vector2 with exactly matching label sets.
/// All matching elements in both vectors are dropped.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_unless(
    expr: &BinaryExpr,
    left: &[InstantValue],
    right: &[InstantValue],
) -> Result<Value> {
    if expr.modifier.as_ref().unwrap().card != VectorMatchCardinality::ManyToMany {
        return Err(DataFusionError::NotImplemented(
            "set operations must only use many-to-many matching".to_string(),
        ));
    }

    // If right is empty, we simply return the left
    // if left is empty we will return it anyway.
    if left.is_empty() || right.is_empty() {
        return Ok(Value::Vector(left.to_vec()));
    }
    // Generate all the signatures from the right hand.
    let rhs_sig: HashSet<Signature> = right
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Now filter out all the matching labels from left.
    let output: Vec<InstantValue> = left
        .par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            !rhs_sig.contains(&left_sig)
        })
        .map(|val| val.clone())
        .collect();
    Ok(Value::Vector(output))
}

/// vector1 and vector2 results in a vector consisting of the elements of vector1 for which there
/// are elements in vector2 with exactly matching label sets.
/// Other elements are dropped. The metric name and values are carried over from the left-hand side vector.
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#logical-set-binary-operators
fn vector_and(expr: &BinaryExpr, left: &[InstantValue], right: &[InstantValue]) -> Result<Value> {
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

    let rhs_sig: HashSet<Signature> = right
        .par_iter()
        .map(|item| signature(&item.labels))
        .collect();

    // Now include all the matching ones from the right
    let output: Vec<InstantValue> = left
        .par_iter()
        .filter(|item| {
            let left_sig = signature(&item.labels);
            rhs_sig.contains(&left_sig)
        })
        .map(|val| val.clone())
        .collect();

    Ok(Value::Vector(output))
}

fn vector_arithmatic_operators(
    expr: &BinaryExpr,
    left: &[InstantValue],
    right: &[InstantValue],
) -> Result<Value> {
    let operator = expr.op.id();
    // Get the hash for the labels on the right
    let rhs_sig: HashMap<Signature, Sample> = right
        .par_iter()
        .map(|item| (signature(&item.labels), item.sample))
        .collect();

    // Iterate over left and pick up the corresponding instance from rhs
    let output: Vec<InstantValue> = left
        .par_iter()
        .flat_map(|item| {
            let left_sig = signature(&item.labels);
            if rhs_sig.contains_key(&left_sig) {
                Some((item, rhs_sig.get(&left_sig).unwrap()))
            } else {
                None
            }
        })
        .map(|(lhs_instant, rhs_sample)| {
            let value =
                scalar_binary_operations(operator, lhs_instant.sample.value, rhs_sample.value)
                    .unwrap();
            InstantValue {
                labels: lhs_instant.labels.clone(),
                sample: Sample {
                    timestamp: lhs_instant.sample.timestamp,
                    value,
                },
            }
        })
        .collect();

    Ok(Value::Vector(output))
}

/// Implement binary operations between two vectors
///
/// https://prometheus.io/docs/prometheus/latest/querying/operators/#comparison-binary-operators
///
/// Between two instant vectors, a binary arithmetic operator is applied to each entry in the
/// left-hand side vector and its matching element in the right-hand vector. The result is
/// propagated into the result vector with the grouping labels becoming the output label set.
/// The metric name is dropped. Entries for which no matching entry in the right-hand vector
/// can be found are not part of the result.
///
///
/// Between two instant vectors, comparison binary operators behave as a filter by default,
/// applied to matching entries. Vector elements for which the expression is not true or which
/// do not find a match on the other side of the expression get dropped from the result, while
/// the others are propagated into a result vector with the grouping labels becoming the output
/// label set. If the bool modifier is provided, vector elements that would have been dropped
/// instead have the value 0 and vector elements that would be kept have the value 1, with the
/// grouping labels again becoming the output label set. The metric name is dropped if the bool
/// modifier is provided.
pub fn vector_bin_op(
    expr: &BinaryExpr,
    left: &[InstantValue],
    right: &[InstantValue],
) -> Result<Value> {
    match expr.op.id() {
        token::T_LAND => vector_and(expr, left, right),
        token::T_LOR => vector_or(expr, left, right),
        token::T_LUNLESS => vector_unless(expr, left, right),
        _ => vector_arithmatic_operators(expr, left, right),
    }
}

use datafusion::error::Result;

use crate::service::promql::{
    binaries::scalar_binary_operations,
    value::{InstantValue, Sample, Value},
};
use promql_parser::parser::BinaryExpr;

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
        .iter()
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

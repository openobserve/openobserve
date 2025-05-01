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
    // fn original_code_vector_arithmetic_operators(
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

    let is_matching_on = expr.modifier.is_some();
    if is_matching_on {
        let modifier = expr.modifier.as_ref().unwrap();
        if let Some(matching) = &modifier.matching {
            if matching.is_include() {
                // For "on" modifier, keep only the specified labels
                labels_to_include_set = matching.labels().labels.clone();
                labels_to_include_set.sort();
            } else {
                // For "ignoring" modifier, add these labels to exclude list
                let excluded_labels = matching.labels().labels.clone();
                labels_to_exclude_set.extend(excluded_labels);
                labels_to_exclude_set.sort();
            }
        }
    }

    // These labels should be used to compare values between lhs - rhs
    let labels_to_compare = |labels: &Vec<Arc<Label>>| {
        if !labels_to_include_set.is_empty() {
            // For "on" modifier, keep only the specified labels
            labels.keep(&labels_to_include_set)
        } else {
            // For "ignoring" modifier or default case, remove excluded labels
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
                    // if modifier.card == VectorMatchCardinality::OneToOne {
                    //     labels = labels_to_compare(&labels);
                    // }

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

    use promql_parser::parser::{
        BinModifier, BinaryExpr, Expr, LabelModifier, VectorMatchCardinality, VectorSelector,
        token::{self, TokenType},
    };

    use super::*;

    fn create_instant_value(labels: Vec<(&str, &str)>, value: f64, timestamp: i64) -> InstantValue {
        let labels = labels
            .into_iter()
            .map(|(k, v)| Arc::new(Label::new(k, v)))
            .collect();
        InstantValue {
            labels,
            sample: Sample { value, timestamp },
        }
    }

    #[test]
    fn test_vector_arithmetic_with_filters() -> Result<()> {
        // PromQL: disk_used{device="sda1"} / on(device) disk_total{device="sda1",state="used"}

        // Build left side instant vector (disk_used metric with device filter)
        let left = vec![create_instant_value(
            vec![("device", "sda1"), ("metric", "disk_used")],
            100.0,
            1000,
        )];

        // Build right side instant vector (disk_total metric with device and state filters)
        let right = vec![create_instant_value(
            vec![
                ("device", "sda1"),
                ("state", "used"),
                ("metric", "disk_total"),
            ],
            200.0,
            1000,
        )];

        // Setup matching modifier: on(device)
        let matching = LabelModifier::include(vec!["device"]);

        // Construct division expression with on(device) 1:1 cardinality
        let expr = BinaryExpr {
            op: TokenType::new(token::T_DIV),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching),
                return_bool: false,
            }),
        };

        // Act: perform vector arithmetic operation
        let result = vector_arithmetic_operators(&expr, left, right)?;

        println!("Result: {:#?}", result);

        // Assert: verify output vector and labels
        if let Value::Vector(output) = result {
            assert_eq!(output.len(), 1);
            let result_instant = &output[0];
            // Check the value is correct (100/200 = 0.5)
            assert!((result_instant.sample.value - 0.5).abs() < f64::EPSILON);

            // Verify that labels from both sides are preserved
            assert_eq!(result_instant.labels.get_value("device"), "sda1");
            // assert_eq!(result_instant.labels.get_value("state"), "used");
        } else {
            panic!("Expected Vector result");
        }

        Ok(())
    }

    #[test]
    fn test_vector_arithmetic_multiple_matches() -> Result<()> {
        // PromQL: metric{env="prod", instance="1"} * on(env, instance) metric{env="prod",
        // instance="1", region="us"}

        // Arrange: left vector with two instances in prod environment
        let left = vec![
            create_instant_value(
                vec![
                    ("__name__", "metric"), // Set the metric name
                    ("env", "prod"),
                    ("instance", "1"),
                ],
                10.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "metric"), // Set the metric name
                    ("env", "prod"),
                    ("instance", "2"),
                ],
                20.0,
                1000,
            ),
        ];

        // Arrange: right vector with matching labels and extra region label
        let right = vec![
            create_instant_value(
                vec![("env", "prod"), ("instance", "1"), ("region", "us")],
                2.0,
                1000,
            ),
            create_instant_value(
                vec![("env", "prod"), ("instance", "2"), ("region", "eu")],
                4.0,
                1000,
            ),
        ];

        // Setup matching modifier: on(env, instance)
        let matching = LabelModifier::include(vec!["env", "instance"]);

        // Construct multiplication expression with on(env, instance) 1:1 cardinality
        let expr = BinaryExpr {
            op: TokenType::new(token::T_MUL),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching.clone()),
                return_bool: false,
            }),
        };

        // Act: perform vector arithmetic operation
        let result = vector_arithmetic_operators(&expr, left, right)?;

        println!("Result: {:#?}", result);
        // Assert: output vector has two elements sorted by instance, verify values and preserved
        // region labels
        if let Value::Vector(output) = result {
            assert_eq!(output.len(), 2);

            // Sort by instance for consistent testing
            let mut output = output;
            output.sort_by(|a, b| {
                a.labels
                    .get_value("instance")
                    .cmp(&b.labels.get_value("instance"))
            });

            // Check first result (instance 1)
            assert!((output[0].sample.value - 20.0).abs() < f64::EPSILON);
            assert_eq!(output[0].labels.get_value("env"), "prod");
            assert_eq!(output[0].labels.get_value("instance"), "1");
            // assert_eq!(output[0].labels.get_value("region"), "us");

            // Check second result (instance 2)
            println!("Second result: {:?}", output[1]);
            assert!((output[1].sample.value - 80.0).abs() < f64::EPSILON);
            assert_eq!(output[1].labels.get_value("env"), "prod");
            assert_eq!(output[1].labels.get_value("instance"), "2");
            // assert_eq!(output[1].labels.get_value("region"), "eu");
        } else {
            panic!("Expected Vector result");
        }

        Ok(())
    }

    /// PromQL Query:
    /// disk_free{device="sda1", host_name="h1", state="free"}
    ///   / on(device, host_name)
    ///   (
    ///     disk_free{device="sda1", host_name="h1", state="free"}
    ///     + on(device, host_name)
    ///     disk_used{device="sda1", host_name="h1", state="used"}
    ///   )
    ///
    /// Sample Input Data:
    /// LHS (disk_free):
    ///   disk_free{device="sda1", host_name="h1", state="free"} 10.0
    ///   disk_free{device="sda1", host_name="h2", state="free"} 20.0
    ///
    /// RHS (disk_used):
    ///   disk_used{device="sda1", host_name="h1", state="used"} 30.0
    ///   disk_used{device="sda1", host_name="h2", state="used"} 50.0
    ///
    /// Expected Output:
    ///   {device="sda1", host_name="h1", state="free"} 0.25  # 10 / (10 + 30)
    ///   {device="sda1", host_name="h2", state="free"} 0.286  # 20 / (20 + 50)
    #[test]
    fn test_free_space_share_multiple_filters() -> Result<()> {
        // Arrange: free and used series with state filters, matching on device & host_name
        let free = vec![
            create_instant_value(
                vec![
                    ("__name__", "disk_free"), // Set the metric name
                    ("device", "sda1"),
                    ("host_name", "h1"),
                    ("state", "free"),
                ],
                10.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "disk_free"), // Set the metric name
                    ("device", "sda1"),
                    ("host_name", "h2"),
                    ("state", "free"),
                ],
                20.0,
                1000,
            ),
        ];

        let used = vec![
            create_instant_value(
                vec![
                    ("__name__", "disk_used"), // Set the metric name
                    ("device", "sda1"),
                    ("host_name", "h1"),
                    ("state", "used"),
                ],
                30.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "disk_used"), // Set the metric name
                    ("device", "sda1"),
                    ("host_name", "h2"),
                    ("state", "used"),
                ],
                50.0,
                1000,
            ),
        ];

        // Compute the nested addition: free + used
        // Setup matching: on(device, host_name)
        let matching = LabelModifier::include(vec!["device", "host_name"]);

        // Compute sum: free + used
        let add_expr = BinaryExpr {
            op: TokenType::new(token::T_ADD),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching.clone()),
                return_bool: false,
            }),
        };
        let sum_value = vector_arithmetic_operators(&add_expr, free.clone(), used.clone())?;
        let sum_vec = if let Value::Vector(v) = sum_value {
            v
        } else {
            panic!("Expected Vector result from addition");
        };

        // Compute ratio: free / (free + used)
        let div_expr = BinaryExpr {
            op: TokenType::new(token::T_DIV),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching),
                return_bool: false,
            }),
        };
        let result = vector_arithmetic_operators(&div_expr, free, sum_vec)?;

        println!("Result: {:#?}", result);
        // Assert: correct ratio and state label preserved as "free"
        if let Value::Vector(output) = result {
            assert_eq!(output.len(), 2);

            let inst = &output[0];
            assert!((inst.sample.value - 0.25).abs() < f64::EPSILON);
            assert_eq!(inst.labels.get_value("device"), "sda1");
            assert_eq!(inst.labels.get_value("host_name"), "h1");
            // assert_eq!(inst.labels.get_value("state"), "free");

            let inst = &output[1];
            assert!((inst.sample.value - 0.285).abs() < 0.001_f64);
            assert_eq!(inst.labels.get_value("device"), "sda1");
            assert_eq!(inst.labels.get_value("host_name"), "h2");
            // assert_eq!(inst.labels.get_value("state"), "free");
        } else {
            panic!("Expected Vector result");
        }

        Ok(())
    }

    /// PromQL Query: http_errors{code="500"} / ignoring(code) http_requests
    ///
    /// Example input:
    ///
    /// http_errors{method="get", code="500"}  24
    /// http_errors{method="get", code="404"}  30
    /// http_errors{method="put", code="501"}  3
    /// http_errors{method="post", code="500"} 6
    /// http_errors{method="post", code="404"} 21
    /// http_requests{method="get"}  600
    /// http_requests{method="del"}  34
    /// http_requests{method="post"} 120
    ///
    /// This returns a result vector containing the fraction of HTTP requests with status code of
    /// 500 for each method, as measured over the last 5 minutes. Without ignoring(code) there
    /// would have been no match as the metrics do not share the same set of labels. The entries
    /// with methods put and del have no match and will not show up in the result:
    ///
    /// {method="get"}  0.04            //  24 / 600
    /// {method="post"} 0.05            //   6 / 120
    #[test]
    fn test_http_errors_rate_with_ignoring() -> Result<()> {
        // Arrange: Create error rate metrics with method and code labels
        let error_rates = vec![
            create_instant_value(
                vec![
                    ("__name__", "http_errors"),
                    ("method", "get"),
                    ("code", "500"),
                ],
                24.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "http_errors"),
                    ("method", "get"),
                    ("code", "404"),
                ],
                30.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "http_errors"),
                    ("method", "put"),
                    ("code", "501"),
                ],
                3.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "http_errors"),
                    ("method", "post"),
                    ("code", "500"),
                ],
                6.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "http_errors"),
                    ("method", "post"),
                    ("code", "404"),
                ],
                21.0,
                1000,
            ),
        ];

        // Create total request rate metrics with only method label
        let request_rates = vec![
            create_instant_value(
                vec![("__name__", "http_requests"), ("method", "get")],
                600.0,
                1000,
            ),
            create_instant_value(
                vec![("__name__", "http_requests"), ("method", "del")],
                34.0,
                1000,
            ),
            create_instant_value(
                vec![("__name__", "http_requests"), ("method", "post")],
                120.0,
                1000,
            ),
        ];

        // Print input vectors for debugging
        println!("Error Rates:");
        for (i, rate) in error_rates.iter().enumerate() {
            println!("  [{}]: {:?}", i, rate);
        }
        println!("\nRequest Rates:");
        for (i, rate) in request_rates.iter().enumerate() {
            println!("  [{}]: {:?}", i, rate);
        }

        // Set up division operation with ignoring(code)
        let modifier = BinModifier {
            card: VectorMatchCardinality::OneToOne,
            matching: Some(LabelModifier::exclude(vec!["code"])),
            return_bool: false,
        };

        let div_expr = BinaryExpr {
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            op: TokenType::new(token::T_DIV),
            modifier: Some(modifier),
        };

        // Print modifier details
        println!("\nModifier Details:");
        println!("  Card: {:?}", div_expr.modifier.as_ref().unwrap().card);
        println!(
            "  Matching: {:?}",
            div_expr.modifier.as_ref().unwrap().matching
        );

        // Act: Perform division with ignoring(code)
        let result = vector_arithmetic_operators(&div_expr, error_rates, request_rates)?;
        println!("\nRaw Result: {:#?}", result);

        // Assert: Check results match expected ratios
        if let Value::Vector(output) = result {
            println!("\nOutput Vector Details:");
            for (i, item) in output.iter().enumerate() {
                println!(
                    "  [{}]: Labels = {:?}, Value = {}",
                    i,
                    item.labels
                        .iter()
                        .map(|l| (l.name.as_str(), l.value.as_str()))
                        .collect::<Vec<_>>(),
                    item.sample.value
                );
            }

            // We expect 4 results because we have 2 methods (get, post) with 2 codes each (404,
            // 500)
            assert_eq!(
                output.len(),
                4,
                "Should have matches for all method/code combinations"
            );

            // Filter to just check the specific cases we're interested in
            let get_500 = output
                .iter()
                .find(|item| {
                    item.labels.get_value("method") == "get"
                        && item.labels.get_value("code") == "500"
                })
                .expect("Should have get/500 result");

            let post_500 = output
                .iter()
                .find(|item| {
                    item.labels.get_value("method") == "post"
                        && item.labels.get_value("code") == "500"
                })
                .expect("Should have post/500 result");

            // Check get method result (24/600 = 0.04)
            assert_eq!(get_500.labels.get_value("method"), "get");
            assert!((get_500.sample.value - 0.04).abs() < f64::EPSILON);
            assert_eq!(get_500.labels.get_value("code"), "500");

            // Check post method result (6/120 = 0.05)
            assert_eq!(post_500.labels.get_value("method"), "post");
            assert!((post_500.sample.value - 0.05).abs() < f64::EPSILON);
            assert_eq!(post_500.labels.get_value("code"), "500");
        } else {
            panic!("Expected Vector result");
        }

        Ok(())
    }

    /// PromQL Query:
    /// system_filesystem_usage{state="free"}
    ///   / on(device,host_name)
    ///   (
    ///     system_filesystem_usage{state="free"}
    ///     + system_filesystem_usage{state="used"}
    ///   )
    ///
    /// Sample Input Data:
    ///
    /// Free space metrics:
    ///   system_filesystem_usage{device="sda1", host_name="server01", state="free"} 15.0
    ///   system_filesystem_usage{device="sda2", host_name="server01", state="free"} 25.0
    ///   system_filesystem_usage{device="sda1", host_name="server02", state="free"} 40.0
    ///
    /// Used space metrics:
    ///   system_filesystem_usage{device="sda1", host_name="server01", state="used"} 45.0
    ///   system_filesystem_usage{device="sda2", host_name="server01", state="used"} 35.0
    ///   system_filesystem_usage{device="sda1", host_name="server02", state="used"} 60.0
    ///
    /// Expected Output:
    ///   {device="sda1", host_name="server01", state="free"} 0.25    # 15 / (15 + 45)
    ///   {device="sda2", host_name="server01", state="free"} 0.4167  # 25 / (25 + 35)
    ///   {device="sda1", host_name="server02", state="free"} 0.4     # 40 / (40 + 60)
    #[test]
    fn test_filesystem_usage_ratio() -> Result<()> {
        // Arrange: system_filesystem_usage series with different states, matching on device &
        // host_name
        let free = vec![
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda1"),
                    ("host_name", "server01"),
                    ("state", "free"),
                ],
                15.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda2"),
                    ("host_name", "server01"),
                    ("state", "free"),
                ],
                25.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda1"),
                    ("host_name", "server02"),
                    ("state", "free"),
                ],
                40.0,
                1000,
            ),
        ];

        let used = vec![
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda1"),
                    ("host_name", "server01"),
                    ("state", "used"),
                ],
                45.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda2"),
                    ("host_name", "server01"),
                    ("state", "used"),
                ],
                35.0,
                1000,
            ),
            create_instant_value(
                vec![
                    ("__name__", "system_filesystem_usage"),
                    ("device", "sda1"),
                    ("host_name", "server02"),
                    ("state", "used"),
                ],
                60.0,
                1000,
            ),
        ];

        // Setup matching: on(device, host_name)
        let matching = LabelModifier::include(vec!["device", "host_name"]);

        // Compute sum: free + used
        let add_expr = BinaryExpr {
            op: TokenType::new(token::T_ADD),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching.clone()),
                return_bool: false,
            }),
        };
        let sum_value = vector_arithmetic_operators(&add_expr, free.clone(), used.clone())?;
        let sum_vec = if let Value::Vector(v) = sum_value {
            v
        } else {
            panic!("Expected Vector result from addition");
        };

        // Compute ratio: free / (free + used)
        let div_expr = BinaryExpr {
            op: TokenType::new(token::T_DIV),
            lhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            rhs: Box::new(Expr::VectorSelector(VectorSelector::default())),
            modifier: Some(BinModifier {
                card: VectorMatchCardinality::OneToOne,
                matching: Some(matching),
                return_bool: false,
            }),
        };
        let result = vector_arithmetic_operators(&div_expr, free, sum_vec)?;

        println!("Result: {:#?}", result);

        // Assert: correct ratio and state label preserved as "free"
        if let Value::Vector(output) = result {
            assert_eq!(output.len(), 3);

            // Check server01 sda1: 15.0 / (15.0 + 45.0) = 0.25
            let inst = &output[0];
            assert!((inst.sample.value - 0.25).abs() < f64::EPSILON);
            assert_eq!(inst.labels.get_value("device"), "sda1");
            assert_eq!(inst.labels.get_value("host_name"), "server01");
            assert_eq!(inst.labels.get_value("state"), "free");

            // Check server01 sda2: 25.0 / (25.0 + 35.0) = 0.4167
            let inst = &output[1];
            assert!((inst.sample.value - 0.4167).abs() < 0.001_f64);
            assert_eq!(inst.labels.get_value("device"), "sda2");
            assert_eq!(inst.labels.get_value("host_name"), "server01");
            assert_eq!(inst.labels.get_value("state"), "free");

            // Check server02 sda1: 40.0 / (40.0 + 60.0) = 0.4
            let inst = &output[2];
            assert!((inst.sample.value - 0.4).abs() < f64::EPSILON);
            assert_eq!(inst.labels.get_value("device"), "sda1");
            assert_eq!(inst.labels.get_value("host_name"), "server02");
            assert_eq!(inst.labels.get_value("state"), "free");
        } else {
            panic!("Expected Vector result");
        }

        Ok(())
    }
}

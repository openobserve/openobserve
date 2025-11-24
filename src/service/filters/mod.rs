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

//! Condition evaluation module for pipeline conditions (v2 format)
//!
//! This module provides evaluation logic for the ConditionGroup system (v2), which offers
//! a linear alternative to the tree-based ConditionList (v1) for expressing mixed boolean
//! operations with natural left-to-right ordering.

use async_trait::async_trait;
use config::{
    meta::alerts::{ConditionGroup, ConditionItem, LogicalOperator, Operator},
    utils::json::{Map, Value},
};

#[async_trait]
pub trait ConditionGroupExt: Sync + Send + 'static {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool;
}

#[async_trait]
impl ConditionGroupExt for ConditionGroup {
    /// Evaluates the condition group against a record
    /// Returns true if the record passes all condition evaluations
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        evaluate_condition_items(&self.conditions, row).await
    }
}

#[async_trait]
impl ConditionGroupExt for ConditionItem {
    /// Evaluates a single condition item against a record
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            ConditionItem::Condition {
                column,
                operator,
                value,
                ignore_case,
                ..
            } => {
                evaluate_condition(
                    row,
                    column,
                    operator,
                    value,
                    ignore_case.unwrap_or(false),
                )
                .await
            }
            ConditionItem::Group { conditions, .. } => {
                evaluate_condition_items(conditions, row).await
            }
        }
    }
}

/// Evaluates a list of condition items with left-to-right logical operator application
///
/// Algorithm:
/// 1. Start with the first item's evaluation result
/// 2. For each subsequent item:
///    - Evaluate the item
///    - Apply the previous item's logical_operator to combine results
/// 3. Continue left-to-right until all items processed
///
/// Example: [A AND, B OR, C AND]
/// - result = eval(A)
/// - result = result AND eval(B)  // Apply A's operator
/// - result = result OR eval(C)   // Apply B's operator
async fn evaluate_condition_items(items: &[ConditionItem], row: &Map<String, Value>) -> bool {
    if items.is_empty() {
        return true;
    }

    // Start with first condition result
    let mut result = items[0].evaluate(row).await;

    // Apply operators left-to-right
    for i in 0..items.len() - 1 {
        let current_item = &items[i];
        let next_result = items[i + 1].evaluate(row).await;

        match current_item.logical_operator() {
            LogicalOperator::And => result = result && next_result,
            LogicalOperator::Or => result = result || next_result,
        }
    }

    result
}

/// Evaluates a single condition against a record
/// This reuses the same logic as the Condition::evaluate but as a standalone function
async fn evaluate_condition(
    row: &Map<String, Value>,
    column: &str,
    operator: &Operator,
    condition_value: &Value,
    ignore_case: bool,
) -> bool {
    let val: &Value = match row.get(column) {
        Some(val) => val,
        None => {
            return false;
        }
    };

    match val {
        Value::String(v) => {
            let val = v.as_str();
            let con_val = condition_value.as_str().unwrap_or_default();

            // Handle case-insensitive comparison
            if ignore_case {
                let val_lower = val.to_lowercase();
                let con_val_lower = con_val.to_lowercase();
                match operator {
                    Operator::EqualTo => val_lower == con_val_lower,
                    Operator::NotEqualTo => val_lower != con_val_lower,
                    Operator::GreaterThan => val_lower > con_val_lower,
                    Operator::GreaterThanEquals => val_lower >= con_val_lower,
                    Operator::LessThan => val_lower < con_val_lower,
                    Operator::LessThanEquals => val_lower <= con_val_lower,
                    Operator::Contains => val_lower.contains(&con_val_lower),
                    Operator::NotContains => !val_lower.contains(&con_val_lower),
                }
            } else {
                match operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    Operator::GreaterThan => val > con_val,
                    Operator::GreaterThanEquals => val >= con_val,
                    Operator::LessThan => val < con_val,
                    Operator::LessThanEquals => val <= con_val,
                    Operator::Contains => val.contains(con_val),
                    Operator::NotContains => !val.contains(con_val),
                }
            }
        }
        Value::Number(_) => {
            let val = val.as_f64().unwrap_or_default();
            let con_val = if condition_value.is_number() {
                condition_value.as_f64().unwrap_or_default()
            } else {
                condition_value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .unwrap_or_default()
            };
            match operator {
                Operator::EqualTo => val == con_val,
                Operator::NotEqualTo => val != con_val,
                Operator::GreaterThan => val > con_val,
                Operator::GreaterThanEquals => val >= con_val,
                Operator::LessThan => val < con_val,
                Operator::LessThanEquals => val <= con_val,
                _ => false,
            }
        }
        Value::Bool(v) => {
            let val = *v;
            let con_val = if condition_value.is_boolean() {
                condition_value.as_bool().unwrap_or_default()
            } else {
                condition_value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .unwrap_or_default()
            };
            match operator {
                Operator::EqualTo => val == con_val,
                Operator::NotEqualTo => val != con_val,
                _ => false,
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::utils::json::json;

    #[tokio::test]
    async fn test_simple_and_condition() {
        // Test: A AND B
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "AND"
                },
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "level",
                    "operator": "=",
                    "value": "critical",
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        // Both conditions match
        let row = json!({
            "status": "error",
            "level": "critical"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // First condition matches, second doesn't
        let row = json!({
            "status": "error",
            "level": "warning"
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_simple_or_condition() {
        // Test: A OR B
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "OR"
                },
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "warning",
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        // First condition matches
        let row = json!({
            "status": "error"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // Second condition matches
        let row = json!({
            "status": "warning"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // Neither matches
        let row = json!({
            "status": "info"
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_mixed_and_or() {
        // Test: A AND B OR C
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "AND"
                },
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "level",
                    "operator": "=",
                    "value": "critical",
                    "logicalOperator": "OR"
                },
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "severity",
                    "operator": ">",
                    "value": 5,
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        // (A AND B) matches
        let row = json!({
            "status": "error",
            "level": "critical",
            "severity": 3
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // C matches (OR makes it pass)
        let row = json!({
            "status": "info",
            "level": "info",
            "severity": 10
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // Nothing matches
        let row = json!({
            "status": "info",
            "level": "info",
            "severity": 3
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_nested_groups() {
        // Test: A AND (B OR C)
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "AND"
                },
                {
                    "filterType": "group",
                    "logicalOperator": "OR",
                    "conditions": [
                        {
                            "filterType": "condition",
                            "type": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "api",
                            "logicalOperator": "OR"
                        },
                        {
                            "filterType": "condition",
                            "type": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "web",
                            "logicalOperator": "AND"
                        }
                    ],
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        // A and B match
        let row = json!({
            "status": "error",
            "service": "api"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // A and C match
        let row = json!({
            "status": "error",
            "service": "web"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        // Only A matches
        let row = json!({
            "status": "error",
            "service": "db"
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_numeric_comparison() {
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "count",
                    "operator": ">",
                    "value": 10,
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        let row = json!({
            "count": 15
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        let row = json!({
            "count": 5
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_contains_operator() {
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "message",
                    "operator": "contains",
                    "value": "error",
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        let row = json!({
            "message": "This is an error message"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        let row = json!({
            "message": "This is a success message"
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_case_insensitive() {
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "ERROR",
                    "ignore_case": true,
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        let row = json!({
            "status": "error"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);

        let row = json!({
            "status": "Error"
        });
        assert!(filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_missing_field() {
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "type": "condition",
                    "column": "nonexistent",
                    "operator": "=",
                    "value": "value",
                    "logicalOperator": "AND"
                }
            ]
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        let row = json!({
            "status": "error"
        });
        assert!(!filter.evaluate(row.as_object().unwrap()).await);
    }

    #[tokio::test]
    async fn test_empty_conditions() {
        let filter_json = json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": []
        });

        let filter: ConditionGroup = serde_json::from_value(filter_json).unwrap();

        let row = json!({
            "status": "error"
        });
        // Empty conditions should pass (default true)
        assert!(filter.evaluate(row.as_object().unwrap()).await);
    }
}

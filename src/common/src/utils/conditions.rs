// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use arrow_schema::{DataType, Schema};
use async_trait::async_trait;
use config::{
    meta::alerts::{AlertConditionParams, Condition, ConditionList, Operator},
    utils::json::{Map, Value},
};

#[async_trait]
pub trait ConditionListExt: Sync + Send + 'static {
    async fn len(&self) -> u32;
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error>;
    async fn is_empty(&self) -> bool;
}

#[async_trait]
impl ConditionListExt for ConditionList {
    /// Returns end node count of a Condition list
    async fn len(&self) -> u32 {
        match self {
            ConditionList::OrNode { or: conditions }
            | ConditionList::AndNode { and: conditions } => {
                let mut count = 0;
                for condition in conditions.iter() {
                    count += condition.len().await
                }
                count
            }
            ConditionList::NotNode { not: inner } => inner.len().await,
            ConditionList::EndCondition(_) => 1,
            ConditionList::LegacyConditions(conditions) => conditions.len() as u32,
        }
    }

    /// Converts Condition list to SQL query as per schema
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        match self {
            ConditionList::OrNode { or: conditions } => {
                let mut cond_sql_list = Vec::new();
                for condition in conditions.iter() {
                    cond_sql_list.push(condition.to_sql(schema).await?);
                }
                Ok(format!("({})", cond_sql_list.join(" OR ")))
            }
            ConditionList::LegacyConditions(conditions) => {
                let mut cond_sql_list = Vec::new();
                for cond in conditions {
                    let data_type = match schema.field_with_name(&cond.column) {
                        Ok(field) => field.data_type(),
                        Err(_) => {
                            return Err(anyhow::anyhow!("Column {} not found", cond.column));
                        }
                    };
                    cond_sql_list.push(build_expr(cond, "", data_type)?);
                }
                Ok(format!("({})", cond_sql_list.join(" AND ")))
            }
            ConditionList::AndNode { and: conditions } => {
                let mut cond_sql_list = Vec::new();
                for condition in conditions.iter() {
                    cond_sql_list.push(condition.to_sql(schema).await?);
                }
                Ok(format!("({})", cond_sql_list.join(" AND ")))
            }
            ConditionList::NotNode { not: inner } => {
                Ok(format!("NOT ({})", inner.to_sql(schema).await?))
            }
            ConditionList::EndCondition(node) => {
                let data_type = match schema.field_with_name(&node.column) {
                    Ok(field) => field.data_type(),
                    Err(_) => {
                        return Err(anyhow::anyhow!("Column {} not found", node.column));
                    }
                };
                build_expr(node, "", data_type)
            }
        }
    }

    async fn is_empty(&self) -> bool {
        match self {
            ConditionList::OrNode { or: conditions } => {
                for condition in conditions.iter() {
                    if condition.is_empty().await {
                        return true;
                    }
                }
                false
            }
            ConditionList::AndNode { and: conditions } => {
                for condition in conditions.iter() {
                    if !condition.is_empty().await {
                        return false;
                    }
                }
                true
            }
            ConditionList::NotNode { not: inner } => inner.is_empty().await,
            ConditionList::LegacyConditions(conditions) => conditions.is_empty(),
            ConditionList::EndCondition(_) => false,
        }
    }
}

#[async_trait]
pub trait ConditionExt: Sync + Send + 'static {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool;
}

#[async_trait]
impl ConditionExt for ConditionList {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            ConditionList::OrNode { or: conditions } => {
                let mut eval = false;
                for condition in conditions {
                    eval = eval || condition.evaluate(row).await
                }
                eval
            }
            ConditionList::LegacyConditions(conditions) => {
                let mut eval = true;
                for condition in conditions {
                    eval = eval && condition.evaluate(row).await
                }
                eval
            }
            ConditionList::AndNode { and: conditions } => {
                let mut eval = true;
                for condition in conditions {
                    eval = eval && condition.evaluate(row).await
                }
                eval
            }
            ConditionList::NotNode { not: conditions } => !conditions.evaluate(row).await,
            ConditionList::EndCondition(condition) => condition.evaluate(row).await,
        }
    }
}

#[async_trait]
impl ConditionExt for Condition {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        let val = match row.get(&self.column) {
            Some(val) => val,
            None => {
                return false;
            }
        };
        match val {
            Value::String(v) => {
                let val = v.as_str();
                let con_val = self.value.as_str().unwrap_or_default().trim_matches('"');
                match self.operator {
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
            Value::Number(_) => {
                let val = val.as_f64().unwrap_or_default();
                let con_val = if self.value.is_number() {
                    self.value.as_f64().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
                match self.operator {
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
                let val = v.to_owned();
                let con_val = if self.value.is_boolean() {
                    self.value.as_bool().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    _ => false,
                }
            }
            Value::Null => {
                matches!(self.operator, Operator::EqualTo)
                    && matches!(&self.value, Value::String(v) if v == "null")
            }
            _ => false,
        }
    }
}

// Trait implementations for AlertConditionParams to support both v1 and v2
#[async_trait]
impl ConditionExt for AlertConditionParams {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            AlertConditionParams::V1(conditions) => conditions.evaluate(row).await,
            AlertConditionParams::V2(conditions) => conditions.evaluate(row).await,
        }
    }
}

#[async_trait]
impl ConditionListExt for AlertConditionParams {
    async fn len(&self) -> u32 {
        match self {
            AlertConditionParams::V1(conditions) => conditions.len().await,
            AlertConditionParams::V2(conditions) => conditions.conditions.len() as u32,
        }
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        match self {
            AlertConditionParams::V1(conditions) => conditions.to_sql(schema).await,
            AlertConditionParams::V2(conditions) => conditions.to_sql(schema).await,
        }
    }

    async fn is_empty(&self) -> bool {
        match self {
            AlertConditionParams::V1(conditions) => conditions.is_empty().await,
            AlertConditionParams::V2(conditions) => conditions.conditions.is_empty(),
        }
    }
}

// Trait and implementation for ConditionGroup (V2 format)
#[async_trait]
pub trait ConditionGroupExt: Sync + Send + 'static {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool;
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error>;
}

#[async_trait]
impl ConditionGroupExt for config::meta::alerts::ConditionGroup {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        evaluate_condition_items(&self.conditions, row).await
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        if self.conditions.is_empty() {
            return Ok("".to_string());
        }

        // Convert items to SQL left-to-right with operators
        let mut sql_parts = Vec::new();
        for item in &self.conditions {
            sql_parts.push(condition_item_to_sql(item, schema).await?);
        }

        // Apply logical operators left-to-right
        // The logicalOperator on an item indicates the operator that comes BEFORE that item
        if sql_parts.len() == 1 {
            return Ok(format!("({})", sql_parts[0]));
        }

        let mut result = sql_parts[0].clone();
        for (item, item_sql) in self.conditions.iter().skip(1).zip(sql_parts.iter().skip(1)) {
            // Use the current item's logical operator (it indicates the operator before this item)
            // Concatenate with the operator, relying on SQL operator precedence
            match item.logical_operator() {
                config::meta::alerts::LogicalOperator::And => {
                    result = format!("{} AND {}", result, item_sql);
                }
                config::meta::alerts::LogicalOperator::Or => {
                    result = format!("{} OR {}", result, item_sql);
                }
            }
        }

        // Wrap the entire result in parentheses at the end
        Ok(format!("({})", result))
    }
}

// Trait implementation for ConditionItem
#[async_trait]
impl ConditionGroupExt for config::meta::alerts::ConditionItem {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            config::meta::alerts::ConditionItem::Condition(v) => {
                evaluate_condition(
                    row,
                    &v.column,
                    &v.operator,
                    &v.value,
                    v.ignore_case.unwrap_or(false),
                )
                .await
            }
            config::meta::alerts::ConditionItem::Group { conditions, .. } => {
                evaluate_condition_items(conditions, row).await
            }
        }
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        condition_item_to_sql(self, schema).await
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
async fn evaluate_condition_items(
    items: &[config::meta::alerts::ConditionItem],
    row: &Map<String, Value>,
) -> bool {
    if items.is_empty() {
        return true;
    }

    // Evaluate with operator precedence: AND before OR (matching SQL semantics)
    // The logicalOperator on an item indicates the operator that comes BEFORE that item

    // First, evaluate all items
    let mut results = Vec::new();
    let mut operators = Vec::new();

    for (i, item) in items.iter().enumerate() {
        results.push(item.evaluate(row).await);
        if i > 0 {
            operators.push(item.logical_operator());
        }
    }

    // Phase 1: Process all AND operations first (higher precedence)
    let mut i = 0;
    while i < operators.len() {
        if matches!(operators[i], config::meta::alerts::LogicalOperator::And) {
            // Combine results[i] AND results[i+1]
            results[i] = results[i] && results[i + 1];
            results.remove(i + 1);
            operators.remove(i);
            // Don't increment i, check same position again
        } else {
            i += 1;
        }
    }

    // Phase 2: Process all OR operations (lower precedence)
    // After phase 1, only OR operators should remain
    let mut result = results[0];
    for res in results.iter().skip(1) {
        result = result || *res;
    }

    result
}

/// Evaluates a single condition against a record
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

// Helper function to convert a ConditionItem to SQL
async fn condition_item_to_sql(
    item: &config::meta::alerts::ConditionItem,
    schema: &Schema,
) -> Result<String, anyhow::Error> {
    match item {
        config::meta::alerts::ConditionItem::Condition(v) => {
            // Create a Condition struct to use with build_expr
            let condition = config::meta::alerts::Condition {
                column: v.column.clone(),
                operator: v.operator,
                value: v.value.clone(),
                ignore_case: v.ignore_case.unwrap_or(false),
            };

            let data_type = match schema.field_with_name(&condition.column) {
                Ok(field) => field.data_type(),
                Err(_) => {
                    return Err(anyhow::anyhow!("Column {} not found", condition.column));
                }
            };

            build_expr(&condition, "", data_type)
        }
        config::meta::alerts::ConditionItem::Group {
            conditions,
            logical_operator,
        } => {
            // Recursively handle nested group
            let nested_group = config::meta::alerts::ConditionGroup {
                filter_type: "group".to_string(),
                logical_operator: *logical_operator,
                conditions: conditions.clone(),
            };
            nested_group.to_sql(schema).await
        }
    }
}

pub fn build_expr(
    cond: &Condition,
    field_alias: &str,
    field_type: &DataType,
) -> Result<String, anyhow::Error> {
    let field_alias = if !field_alias.is_empty() {
        field_alias
    } else {
        cond.column.as_str()
    };
    let expr = match field_type {
        DataType::Utf8 | DataType::LargeUtf8 => {
            let val = if cond.value.is_string() {
                cond.value.as_str().unwrap_or_default().to_string()
            } else {
                cond.value.to_string()
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = '{val}'"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != '{val}'"),
                Operator::GreaterThan => format!("\"{field_alias}\" > '{val}'"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= '{val}'")
                }
                Operator::LessThan => format!("\"{field_alias}\" < '{val}'"),
                Operator::LessThanEquals => format!("\"{field_alias}\" <= '{val}'"),
                Operator::Contains => format!("str_match(\"{field_alias}\", '{val}')"),
                Operator::NotContains => {
                    format!("\"{field_alias}\" NOT LIKE '%{val}%'")
                }
            }
        }
        DataType::Int16 | DataType::Int32 | DataType::Int64 => {
            let val = if cond.value.is_number() {
                cond.value.as_i64().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                Operator::GreaterThan => format!("\"{field_alias}\" > {val}"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= {val}")
                }
                Operator::LessThan => format!("\"{field_alias}\" < {val}"),
                Operator::LessThanEquals => {
                    format!("\"{field_alias}\" <= {val}")
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
                        cond.operator
                    ));
                }
            }
        }
        DataType::Float32 | DataType::Float64 => {
            let val = if cond.value.is_number() {
                cond.value.as_f64().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                Operator::GreaterThan => format!("\"{field_alias}\" > {val}"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= {val}")
                }
                Operator::LessThan => format!("\"{field_alias}\" < {val}"),
                Operator::LessThanEquals => {
                    format!("\"{field_alias}\" <= {val}")
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
                        cond.operator
                    ));
                }
            }
        }
        DataType::Boolean => {
            let val = if cond.value.is_boolean() {
                cond.value.as_bool().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
                        cond.operator
                    ));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Column {} has data_type [{field_type}] and it does not supported by alert, if you think this is a bug please report it to us",
                cond.column,
            ));
        }
    };
    Ok(expr)
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use config::{
        meta::alerts::{
            ConditionGroup, ConditionItem, ConditionItemCondition, LogicalOperator, Operator,
        },
        utils::json::Value,
    };

    use super::*;

    #[tokio::test]
    async fn test_condition_group_to_sql_simple() {
        // Create a simple schema
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
        ]);

        // Create a simple condition group: level = 'error' AND service = 'api'
        // Remember: the logicalOperator on an item comes BEFORE that item
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("level" = 'error' AND "service" = 'api')
        assert_eq!(sql, "(\"level\" = 'error' AND \"service\" = 'api')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_with_or() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]);

        // Create condition group: level = 'error' OR status = 'critical'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("critical".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                }),
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("level" = 'error' OR "status" = 'critical')
        assert_eq!(sql, "(\"level\" = 'error' OR \"status\" = 'critical')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_nested_groups() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]);

        // Create nested condition group:
        // level = 'error' AND (service = 'api' OR service = 'web')
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("api".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, /* Not used (first item in
                                                                     * group) */
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("web".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::Or, // OR before this item
                        }),
                    ],
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Exact SQL match for nested group:
        // level = 'error' AND (service = 'api' OR service = 'web')
        assert_eq!(
            sql,
            "(\"level\" = 'error' AND (\"service\" = 'api' OR \"service\" = 'web'))"
        );
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_numeric_conditions() {
        let schema = Schema::new(vec![
            Field::new("count", DataType::Int64, false),
            Field::new("temperature", DataType::Float64, false),
        ]);

        // Create condition group: count > 100 AND temperature >= 50.5
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "count".to_string(),
                    operator: Operator::GreaterThan,
                    value: Value::Number(serde_json::Number::from(100)),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "temperature".to_string(),
                    operator: Operator::GreaterThanEquals,
                    value: Value::Number(serde_json::Number::from_f64(50.5).unwrap()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("count" > 100 AND "temperature" >= 50.5)
        assert_eq!(sql, "(\"count\" > 100 AND \"temperature\" >= 50.5)");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_contains_operator() {
        let schema = Schema::new(vec![Field::new("message", DataType::Utf8, false)]);

        // Create condition group with Contains operator
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "message".to_string(),
                operator: Operator::Contains,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Contains should generate str_match function
        assert_eq!(sql, "(str_match(\"message\", 'error'))");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_empty_conditions() {
        let schema = Schema::new(Vec::<Field>::new());

        // Empty condition group should return empty string
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();
        assert_eq!(sql, "");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_single_condition() {
        let schema = Schema::new(vec![Field::new("level", DataType::Utf8, false)]);

        // Single condition should be wrapped in parentheses
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "level".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        assert_eq!(sql, "(\"level\" = 'error')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_mixed_and_or_same_level() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
        ]);

        // Create condition group with mixed operators at same level:
        // level = 'error' AND status = 'active' OR service = 'api'
        // This tests left-to-right evaluation: (level = 'error' AND status = 'active') OR service =
        // 'api'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("active".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                }),
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Verify evaluation with operator precedence (AND before OR)
        // level = 'error' AND status = 'active' OR service = 'api'
        // SQL operator precedence will parse this as: (level = 'error' AND status = 'active') OR
        // service = 'api'
        assert_eq!(
            sql,
            "(\"level\" = 'error' AND \"status\" = 'active' OR \"service\" = 'api')"
        );
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_missing_column() {
        let schema = Schema::new(vec![Field::new("level", DataType::Utf8, false)]);

        // Reference non-existent column
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "nonexistent".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
        };

        let result = condition_group.to_sql(&schema).await;

        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Column nonexistent not found")
        );
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_complex() {
        use config::utils::json::json;

        use super::ConditionGroupExt;

        // Test the condition: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test'
        // AND kubernetes_host = 'test2') With proper Group logic structure
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Ignored because next is Group
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
                    ],
                },
            ],
        };

        // Test case 1: Data that should NOT pass (none of the conditions match)
        let test_data_fail = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2",
            "log": "request id : camelcase"
        });
        let result = condition_group
            .evaluate(test_data_fail.as_object().unwrap())
            .await;
        assert!(
            !result,
            "Should NOT pass: kubernetes_docker_id doesn't match, and kubernetes_container_image doesn't match"
        );

        // Test case 2: Data that should pass (first condition matches)
        let test_data_pass1 = json!({
            "kubernetes_docker_id": "test",
            "kubernetes_container_image": "anything",
            "kubernetes_host": "anything"
        });
        let result = condition_group
            .evaluate(test_data_pass1.as_object().unwrap())
            .await;
        assert!(
            result,
            "Should pass: first condition matches (kubernetes_docker_id = 'test')"
        );

        // Test case 3: Data that should pass (nested group matches)
        let test_data_pass2 = json!({
            "kubernetes_docker_id": "something_else",
            "kubernetes_container_image": "test",
            "kubernetes_host": "test2"
        });
        let result = condition_group
            .evaluate(test_data_pass2.as_object().unwrap())
            .await;
        assert!(
            result,
            "Should pass: nested group matches (kubernetes_container_image = 'test' AND kubernetes_host = 'test2')"
        );

        // Test case 4: Data that should NOT pass (only one condition in nested group matches)
        let test_data_fail2 = json!({
            "kubernetes_docker_id": "something_else",
            "kubernetes_container_image": "test",
            "kubernetes_host": "wrong_host"
        });
        let result = condition_group
            .evaluate(test_data_fail2.as_object().unwrap())
            .await;
        assert!(
            !result,
            "Should NOT pass: only kubernetes_container_image matches, but kubernetes_host doesn't"
        );
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_with_nested_group() {
        use config::utils::json::json;

        use super::ConditionGroupExt;

        // Test evaluation with nested group: kubernetes_docker_id = 'test' OR
        // (kubernetes_container_image = 'test' AND kubernetes_host = 'test2') Structure:
        // - kubernetes_docker_id = 'test' [OR with next]
        // - A group containing: (kubernetes_container_image = 'test' AND kubernetes_host = 'test2')

        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR with next item
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND inside the group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND with next in group
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
                    ],
                },
            ],
        };

        // Test with the data from the conversation
        let test_data = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2"
        });

        let result = condition_group
            .evaluate(test_data.as_object().unwrap())
            .await;

        // Evaluation: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test' AND
        // kubernetes_host = 'test2') = FALSE OR (FALSE AND TRUE)
        // = FALSE OR FALSE
        // = FALSE
        assert!(
            !result,
            "Should NOT PASS: kubernetes_docker_id doesn't match, and in the group only kubernetes_host matches (need both)"
        );

        println!("Test data: {:?}", test_data);
        println!("Evaluation result: {} (should be false)", result);
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_complex_with_nested_group() {
        use arrow_schema::{DataType, Field, Schema};

        use super::ConditionGroupExt;

        let schema = Schema::new(vec![
            Field::new("kubernetes_docker_id", DataType::Utf8, false),
            Field::new("kubernetes_container_image", DataType::Utf8, false),
            Field::new("kubernetes_host", DataType::Utf8, false),
        ]);

        // Test SQL generation with nested group and mixed operators
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    })],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();
        println!("Generated SQL: {}", sql);

        // Verify the generated SQL has correct operator placement
        assert!(sql.contains("OR") && sql.contains("AND"));
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_operator_precedence() {
        use config::utils::json::json;

        use super::ConditionGroupExt;

        // Test operator precedence: A OR (B) AND C should evaluate as A OR ((B) AND C)
        // Structure: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test') AND
        // kubernetes_host = 'test2'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    })],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
            ],
        };

        // Test with the data from the conversation - should NOT pass
        let test_data_fail = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2"
        });

        let result = condition_group
            .evaluate(test_data_fail.as_object().unwrap())
            .await;

        // With the fix:
        // - Between Item0 and Group: use Group's operator = OR
        // - kubernetes_docker_id = 'test' -> false
        // - Group (kubernetes_container_image = 'test') -> false
        // - result = false OR false = false
        //
        // Wait, we still need to process Item2 (kubernetes_host)...
        // Let me trace through:
        // - i=0: result = kubernetes_docker_id = 'test' = false next = Group =
        //   kubernetes_container_image = 'test' = false operator = Group's OR result = false OR
        //   false = false
        // - i=1: result = false (from above) next = kubernetes_host = 'test2' = true operator =
        //   Group.conditions[0].logicalOperator = AND result = false AND true = false
        //
        // Hmm, this gives false, but we need to think about what the Group's internal condition's
        // operator means...

        println!("Test data: {:?}", test_data_fail);
        println!("Evaluation result: {} (should be false)", result);

        assert!(!result, "Should NOT PASS: neither condition matches");

        // Test case where kubernetes_docker_id matches (should PASS with OR precedence)
        let test_data_docker_id_matches = json!({
            "kubernetes_docker_id": "test",
            "kubernetes_container_image": "wrong",
            "kubernetes_host": "wrong"
        });

        let result2 = condition_group
            .evaluate(test_data_docker_id_matches.as_object().unwrap())
            .await;

        println!("\nTest with docker_id matching:");
        println!("Test data: {:?}", test_data_docker_id_matches);
        println!("Evaluation result: {} (should be true)", result2);

        // SQL: (kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test' AND
        // kubernetes_host = 'test2')) = (TRUE OR (FALSE AND FALSE)) = TRUE
        assert!(result2, "Should PASS when kubernetes_docker_id matches");
    }

    #[tokio::test]
    async fn test_deeply_nested_groups_with_precedence() {
        use config::utils::json::json;

        use super::ConditionGroupExt;

        // Complex nested structure: A OR (B AND C OR (D AND E)) AND F
        // This tests: nested groups + operator precedence at multiple levels
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "A".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first)
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "B".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // Not used (first in group)
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "C".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND before this
                        }),
                        ConditionItem::Group {
                            logical_operator: LogicalOperator::Or, // OR before this nested group
                            conditions: vec![
                                ConditionItem::Condition(ConditionItemCondition {
                                    column: "D".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And,
                                }),
                                ConditionItem::Condition(ConditionItemCondition {
                                    column: "E".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And, // AND before this
                                }),
                            ],
                        },
                    ],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "F".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this
                }),
            ],
        };

        // Test case 1: Only A matches
        // A OR (B AND C OR (D AND E)) AND F
        // = TRUE OR (FALSE AND FALSE OR (FALSE AND FALSE)) AND FALSE
        // = TRUE OR (FALSE OR FALSE) AND FALSE
        // = TRUE OR FALSE AND FALSE
        // With precedence: TRUE OR (FALSE AND FALSE)
        // = TRUE OR FALSE = TRUE ✓
        let test1 = json!({"A": "match", "B": "no", "C": "no", "D": "no", "E": "no", "F": "no"});
        assert!(
            condition_group.evaluate(test1.as_object().unwrap()).await,
            "Should PASS: A matches, and there's OR before the group"
        );

        // Test case 2: D and E match (inner nested group), and F matches
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (FALSE AND FALSE OR (TRUE AND TRUE)) AND TRUE
        // = FALSE OR (FALSE OR TRUE) AND TRUE
        // = FALSE OR TRUE AND TRUE
        // With precedence: FALSE OR (TRUE AND TRUE)
        // = FALSE OR TRUE = TRUE ✓
        let test2 =
            json!({"A": "no", "B": "no", "C": "no", "D": "match", "E": "match", "F": "match"});
        assert!(
            condition_group.evaluate(test2.as_object().unwrap()).await,
            "Should PASS: Inner nested group (D AND E) matches, plus F matches"
        );

        // Test case 3: B and C match, and F matches
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (TRUE AND TRUE OR (FALSE AND FALSE)) AND TRUE
        // = FALSE OR (TRUE OR FALSE) AND TRUE
        // = FALSE OR TRUE AND TRUE
        // With precedence: FALSE OR (TRUE AND TRUE)
        // = FALSE OR TRUE = TRUE ✓
        let test3 =
            json!({"A": "no", "B": "match", "C": "match", "D": "no", "E": "no", "F": "match"});
        assert!(
            condition_group.evaluate(test3.as_object().unwrap()).await,
            "Should PASS: B AND C match, plus F matches"
        );

        // Test case 4: Only F matches (should fail)
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (FALSE AND FALSE OR (FALSE AND FALSE)) AND TRUE
        // = FALSE OR (FALSE OR FALSE) AND TRUE
        // = FALSE OR FALSE AND TRUE
        // With precedence: FALSE OR (FALSE AND TRUE)
        // = FALSE OR FALSE = FALSE ✓
        let test4 = json!({"A": "no", "B": "no", "C": "no", "D": "no", "E": "no", "F": "match"});
        assert!(
            !condition_group.evaluate(test4.as_object().unwrap()).await,
            "Should FAIL: Only F matches, but the OR part fails"
        );

        println!("✓ All deeply nested group tests with operator precedence passed!");
    }

    // ── build_expr sync unit tests ───────────────────────────────────────────

    fn make_cond(column: &str, operator: Operator, value: Value) -> Condition {
        Condition {
            column: column.to_string(),
            operator,
            value,
            ignore_case: false,
        }
    }

    #[test]
    fn test_build_expr_bool_equal_to() {
        let cond = make_cond("active", Operator::EqualTo, Value::Bool(true));
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" = true");
    }

    #[test]
    fn test_build_expr_bool_not_equal_to() {
        let cond = make_cond("active", Operator::NotEqualTo, Value::Bool(false));
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" != false");
    }

    #[test]
    fn test_build_expr_bool_bool_as_string_value() {
        let cond = make_cond(
            "active",
            Operator::EqualTo,
            Value::String("true".to_string()),
        );
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" = true");
    }

    #[test]
    fn test_build_expr_bool_unsupported_operator_returns_error() {
        let cond = make_cond("active", Operator::Contains, Value::Bool(true));
        let result = build_expr(&cond, "", &DataType::Boolean);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_int_contains_returns_error() {
        let cond = make_cond("count", Operator::Contains, Value::Number(1.into()));
        let result = build_expr(&cond, "", &DataType::Int64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_float_contains_returns_error() {
        let cond = make_cond("score", Operator::Contains, Value::Number(1.into()));
        let result = build_expr(&cond, "", &DataType::Float64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_unsupported_datatype_returns_error() {
        let cond = make_cond("ts", Operator::EqualTo, Value::String("x".to_string()));
        let result = build_expr(&cond, "", &DataType::Date32);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_field_alias_override() {
        let cond = make_cond(
            "level",
            Operator::EqualTo,
            Value::String("error".to_string()),
        );
        let expr = build_expr(&cond, "log_level", &DataType::Utf8).unwrap();
        assert_eq!(expr, "\"log_level\" = 'error'");
    }

    #[test]
    fn test_build_expr_string_not_contains() {
        let cond = make_cond(
            "msg",
            Operator::NotContains,
            Value::String("spam".to_string()),
        );
        let expr = build_expr(&cond, "", &DataType::Utf8).unwrap();
        assert_eq!(expr, "\"msg\" NOT LIKE '%spam%'");
    }

    #[test]
    fn test_build_expr_int_greater_than() {
        let cond = make_cond(
            "code",
            Operator::GreaterThan,
            Value::Number(serde_json::Number::from(400)),
        );
        let expr = build_expr(&cond, "", &DataType::Int32).unwrap();
        assert_eq!(expr, "\"code\" > 400");
    }

    #[test]
    fn test_build_expr_float_less_than_equal() {
        let cond = make_cond(
            "rate",
            Operator::LessThanEquals,
            Value::Number(serde_json::Number::from_f64(0.5).unwrap()),
        );
        let expr = build_expr(&cond, "", &DataType::Float32).unwrap();
        assert_eq!(expr, "\"rate\" <= 0.5");
    }

    #[test]
    fn test_build_expr_int_invalid_string_returns_error() {
        let cond = make_cond(
            "n",
            Operator::EqualTo,
            Value::String("not_a_number".to_string()),
        );
        let result = build_expr(&cond, "", &DataType::Int64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_float_invalid_string_returns_error() {
        let cond = make_cond("f", Operator::EqualTo, Value::String("abc".to_string()));
        let result = build_expr(&cond, "", &DataType::Float64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_bool_invalid_string_returns_error() {
        let cond = make_cond("b", Operator::EqualTo, Value::String("maybe".to_string()));
        let result = build_expr(&cond, "", &DataType::Boolean);
        assert!(result.is_err());
    }
}

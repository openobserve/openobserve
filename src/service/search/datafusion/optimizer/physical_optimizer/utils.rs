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

use std::sync::Arc;

use config::{TIMESTAMP_COL_NAME, meta::inverted_index::UNKNOWN_NAME};
use datafusion::{
    common::{Result, tree_node::TreeNode},
    error::DataFusionError,
    logical_expr::Operator,
    physical_expr::{
        PhysicalExpr,
        expressions::{Column, Literal},
    },
    physical_plan::{
        ExecutionPlan,
        expressions::{BinaryExpr, CastExpr, lit},
    },
    scalar::ScalarValue,
};

pub fn is_aggregate_exec(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.exists(|plan| Ok(plan.name() == "AggregateExec"))
        .unwrap_or(false)
}

pub fn extract_string_literal(expr: &Arc<dyn PhysicalExpr>) -> Result<String> {
    if let Some(literal) = expr.as_any().downcast_ref::<Literal>() {
        match literal.value() {
            ScalarValue::Utf8(Some(s)) => Ok(s.clone()),
            ScalarValue::Utf8View(Some(s)) => Ok(s.to_string()),
            ScalarValue::LargeUtf8(Some(s)) => Ok(s.clone()),
            _ => Err(DataFusionError::Internal(format!(
                "Expected string literal, got: {:?}",
                literal.value()
            ))),
        }
    } else {
        Err(DataFusionError::Internal(
            "Expected literal expression for string argument".to_string(),
        ))
    }
}

pub fn extract_column(expr: &Arc<dyn PhysicalExpr>) -> Result<Column> {
    if let Some(column) = expr.as_any().downcast_ref::<Column>() {
        Ok(column.clone())
    } else {
        Err(DataFusionError::Internal(
            "Expected column expression".to_string(),
        ))
    }
}

pub fn extract_int64_literal(expr: &Arc<dyn PhysicalExpr>) -> Result<i64> {
    if let Some(literal) = expr.as_any().downcast_ref::<Literal>() {
        match literal.value() {
            ScalarValue::Int64(Some(s)) => Ok(*s),
            _ => Err(DataFusionError::Internal(format!(
                "Expected int64 literal, got: {:?}",
                literal.value()
            ))),
        }
    } else {
        Err(DataFusionError::Internal(
            "Expected literal expression for int64 argument".to_string(),
        ))
    }
}

// combine all exprs with OR operator
pub fn disjunction(
    predicates: impl IntoIterator<Item = Arc<dyn PhysicalExpr>>,
) -> Arc<dyn PhysicalExpr> {
    disjunction_opt(predicates).unwrap_or_else(|| lit(true))
}

fn disjunction_opt(
    predicates: impl IntoIterator<Item = Arc<dyn PhysicalExpr>>,
) -> Option<Arc<dyn PhysicalExpr>> {
    predicates
        .into_iter()
        .fold(None, |acc, predicate| match acc {
            None => Some(predicate),
            Some(acc) => Some(Arc::new(BinaryExpr::new(acc, Operator::Or, predicate))),
        })
}

pub fn is_column(expr: &Arc<dyn PhysicalExpr>) -> bool {
    if expr.as_any().downcast_ref::<Column>().is_some() {
        true
    } else if let Some(expr) = expr.as_any().downcast_ref::<CastExpr>() {
        is_column(expr.expr())
    } else {
        false
    }
}

pub fn get_column_name(expr: &Arc<dyn PhysicalExpr>) -> &str {
    if let Some(expr) = expr.as_any().downcast_ref::<Column>() {
        expr.name()
    } else if let Some(expr) = expr.as_any().downcast_ref::<CastExpr>() {
        get_column_name(expr.expr())
    } else {
        UNKNOWN_NAME
    }
}

pub fn is_value(expr: &Arc<dyn PhysicalExpr>) -> bool {
    expr.as_any().downcast_ref::<Literal>().is_some()
}

pub fn is_only_timestamp_filter(expr: &[&Arc<dyn PhysicalExpr>]) -> bool {
    expr.iter().all(|expr| is_timestamp_filter(expr))
}

fn is_timestamp_filter(expr: &Arc<dyn PhysicalExpr>) -> bool {
    if let Some(expr) = expr.as_any().downcast_ref::<BinaryExpr>() {
        match expr.op() {
            Operator::Gt | Operator::GtEq | Operator::Lt | Operator::LtEq => {
                let column = if is_value(expr.left()) && is_column(expr.right()) {
                    get_column_name(expr.right())
                } else if is_value(expr.right()) && is_column(expr.left()) {
                    get_column_name(expr.left())
                } else {
                    return false;
                };

                if column != TIMESTAMP_COL_NAME {
                    return false;
                }
            }
            _ => return false,
        }
    } else {
        return false;
    }
    true
}

// Copyright 2024 Zinc Labs Inc.
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

use sqlparser::{
    ast::{Expr, Function, GroupByExpr, Query, SelectItem, SetExpr, Statement},
    dialect::GenericDialect,
    parser::Parser,
};

pub const AGGREGATE_UDF_LIST: [&str; 8] = [
    "min",
    "max",
    "avg",
    "sum",
    "count",
    "median",
    "array_agg",
    "approx_percentile_cont",
];

pub fn is_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;

    for statement in ast {
        if let Statement::Query(query) = statement {
            if is_aggregate_in_select(&query) || has_group_by(&query) || has_having(&query) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn is_aggregate_in_select(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        if select.distinct.is_some() {
            return true;
        }
        for select_item in &select.projection {
            if let SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, alias: _ } =
                select_item
            {
                if is_aggregate_expression(expr) {
                    return true;
                }
            }
        }
    }
    false
}

fn is_aggregate_expression(expr: &Expr) -> bool {
    match expr {
        Expr::Function(Function { name, .. }) => {
            AGGREGATE_UDF_LIST.contains(&name.to_string().to_lowercase().as_str())
        }
        Expr::BinaryOp { left, right, .. } => {
            // Recursively check both sides of binary operations
            is_aggregate_expression(left) || is_aggregate_expression(right)
        }
        Expr::Case {
            conditions,
            results,
            else_result,
            ..
        } => {
            // Check if any part of the CASE expression is an aggregate function
            conditions.iter().any(is_aggregate_expression)
                || results.iter().any(is_aggregate_expression)
                || else_result
                    .as_ref()
                    .map_or(false, |e| is_aggregate_expression(e))
        }
        Expr::Nested(expr) => {
            // Check nested expressions
            is_aggregate_expression(expr)
        }
        Expr::Cast { expr, .. } => {
            // Check casted expressions
            is_aggregate_expression(expr)
        }
        Expr::UnaryOp { expr, .. } => {
            // Check unary operations
            is_aggregate_expression(expr)
        }
        _ => false,
    }
}

// Check if has group_by
fn has_group_by(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        match &select.group_by {
            GroupByExpr::All(v) => !v.is_empty(),
            GroupByExpr::Expressions(v, _) => !v.is_empty(),
        }
    } else {
        false
    }
}

// Check if has having
fn has_having(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        select.having.is_some()
    } else {
        false
    }
}

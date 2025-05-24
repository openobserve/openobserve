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

use std::ops::ControlFlow;

use sqlparser::{
    ast::{Expr, Function, GroupByExpr, Query, SelectItem, SetExpr, Statement, Visit, Visitor},
    dialect::GenericDialect,
    parser::Parser,
};

use crate::TIMESTAMP_COL_NAME;

pub const AGGREGATE_UDF_LIST: [&str; 9] = [
    "min",
    "max",
    "avg",
    "sum",
    "count",
    "median",
    "array_agg",
    "approx_percentile_cont",
    "percentile_cont",
];

pub fn is_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if is_aggregate_in_select(query)
                || has_group_by(query)
                || has_having(query)
                || has_join(query)
                || has_subquery(statement)
                || has_union(query)
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// Only select from one table, have no join, no subquery, no union, and has aggreation
pub fn is_simple_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if is_aggregate_in_select(query)
                && !has_join(query)
                && !has_subquery(statement)
                && !has_union(query)
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// distinct with no group by
pub fn is_simple_distinct_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if has_distinct(query)
                && !has_group_by(query)
                && !has_join(query)
                && !has_subquery(statement)
                && !has_union(query)
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Checks if _timestamp has been selected
/// Used for validating scheduled pipeline sql queries
pub fn is_timestamp_selected(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if has_timestamp(statement) {
            return Ok(true);
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
                    .is_some_and(|e| is_aggregate_expression(e))
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

// Check if has distinct
fn has_distinct(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        select.distinct.is_some()
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

fn has_join(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        select.from.len() > 1
            || select
                .from
                .first()
                .is_some_and(|table| !table.joins.is_empty())
    } else {
        false
    }
}

fn has_union(query: &Query) -> bool {
    if let SetExpr::SetOperation { .. } = *query.body {
        return true;
    }
    false
}

fn has_subquery(stat: &Statement) -> bool {
    let mut visitor = SubqueryVisitor::new();
    let _ = stat.visit(&mut visitor);
    visitor.is_subquery
}

struct SubqueryVisitor {
    pub is_subquery: bool,
}

impl SubqueryVisitor {
    fn new() -> Self {
        Self { is_subquery: false }
    }
}

impl Visitor for SubqueryVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.is_subquery = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

fn has_timestamp(stat: &Statement) -> bool {
    let mut visitor = TimestampVisitor::new();
    let _ = stat.visit(&mut visitor);
    visitor.timestamp_selected
}

struct TimestampVisitor {
    pub timestamp_selected: bool,
}

impl TimestampVisitor {
    fn new() -> Self {
        Self {
            timestamp_selected: false,
        }
    }
}

impl Visitor for TimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_ref() {
            for item in &select.projection {
                match item {
                    SelectItem::UnnamedExpr(expr) => match expr {
                        Expr::Identifier(ident) if ident.value == TIMESTAMP_COL_NAME => {
                            self.timestamp_selected = true;
                            return ControlFlow::Break(());
                        }
                        Expr::CompoundIdentifier(idents) => {
                            if let Some(last) = idents.last() {
                                if last.value == TIMESTAMP_COL_NAME {
                                    self.timestamp_selected = true;
                                    return ControlFlow::Break(());
                                }
                            }
                        }
                        _ => {}
                    },
                    SelectItem::ExprWithAlias { alias, .. } => {
                        if alias.value == TIMESTAMP_COL_NAME {
                            self.timestamp_selected = true;
                            return ControlFlow::Break(());
                        }
                    }
                    SelectItem::Wildcard(_) => {
                        self.timestamp_selected = true;
                        return ControlFlow::Break(());
                    }
                    _ => {}
                }
            }
        }

        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_selection() -> Result<(), sqlparser::parser::ParserError> {
        let test_cases = vec![
            // Basic selection cases
            (
                "SELECT _timestamp FROM table1",
                true,
                "Direct timestamp selection",
            ),
            (
                "SELECT name, _timestamp FROM table1",
                true,
                "Timestamp with other columns",
            ),
            (
                "SELECT * FROM table1",
                true,
                "Wildcard selection includes timestamp",
            ),
            ("SELECT name FROM table1", false, "No timestamp selected"),
            // Function cases without alias - should all be false
            (
                "SELECT MAX(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT MAX(_timestamp), MAX(_timestamp) as _timestamp FROM table1",
                true,
                "One of the functions has _timestamp alias",
            ),
            (
                "SELECT MIN(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT COUNT(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            // Function cases with alias - should be true when aliased as _timestamp
            (
                "SELECT MAX(_timestamp) as _timestamp FROM table1",
                true,
                "Function aliased as _timestamp",
            ),
            (
                "SELECT MIN(_timestamp) as other FROM table1",
                false,
                "Function with different alias",
            ),
            // Expression cases
            (
                "SELECT _timestamp + 1 FROM table1",
                false,
                "Expression without _timestamp alias",
            ),
            (
                "SELECT (_timestamp + 1) as _timestamp FROM table1",
                true,
                "Expression aliased as _timestamp",
            ),
            // Compound identifiers
            (
                "SELECT t1._timestamp FROM table1 t1",
                true,
                "Table qualified timestamp",
            ),
            (
                "SELECT t1._timestamp as other FROM table1 t1",
                false,
                "Table qualified timestamp with different alias",
            ),
            // Complex expressions
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END FROM table1",
                false,
                "Timestamp in subquery",
            ),
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END as _timestamp FROM table1",
                true,
                "CASE expression aliased as _timestamp",
            ),
            // Subqueries
            (
                "SELECT * FROM (SELECT _timestamp FROM table1) t",
                true,
                "Subquery with wildcard",
            ),
            (
                "SELECT t.other FROM (SELECT _timestamp as other FROM table1) t",
                false,
                "Subquery with renamed timestamp",
            ),
            // Multiple levels of aliases
            (
                "SELECT MAX(_timestamp) as ts1, ts1 as _timestamp FROM table1",
                true,
                "Still results a _timestamp field",
            ),
        ];

        for (sql, expected, test_name) in test_cases {
            let result = is_timestamp_selected(sql)?;
            assert_eq!(
                result, expected,
                "Failed test case '{}': expected {}, got {}",
                test_name, expected, result
            );
        }

        Ok(())
    }

    #[test]
    fn check_is_simple_aggregate() {
        let query = r#"SELECT histogram(_timestamp) AS zo_sql_time, "kubernetes_docker_id" AS zo_sql_key, SUM(count) AS zo_sql_num FROM "distinct_values_logs_default22" GROUP BY zo_sql_time, zo_sql_key ORDER BY zo_sql_time ASC, zo_sql_num DESC"#;
        let ab = is_aggregate_query(query);
        print!("{:?}", ab);
    }
}

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

// Only select from one table, have no join, no subquery, no union, no window functions, no CTE, no
// distinct, and has aggregation
pub fn is_simple_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if is_aggregate_in_select(query)
                && !has_join(query)
                && !has_subquery(statement)
                && !has_union(query)
                && !has_window_functions(statement)
                && !has_cte(query)
                && !has_distinct(query)
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
            if has_distinct(query) && !has_group_by(query) {
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
    let mut visitor = DistinctVisitor::new();
    query.visit(&mut visitor);
    visitor.has_distinct
}

struct DistinctVisitor {
    pub has_distinct: bool,
}

impl DistinctVisitor {
    fn new() -> Self {
        Self {
            has_distinct: false,
        }
    }
}

impl Visitor for DistinctVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        // Check for SELECT DISTINCT
        if let SetExpr::Select(select) = query.body.as_ref() {
            if select.distinct.is_some() {
                self.has_distinct = true;
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        // Check for DISTINCT inside functions like COUNT(DISTINCT column)
        // For now, this is a simplified check - we could enhance it further if needed
        if let Expr::Function(Function { args, .. }) = expr {
            // Convert the function arguments to string and check for DISTINCT
            let args_str = format!("{:?}", args);
            if args_str.to_lowercase().contains("distinct") {
                self.has_distinct = true;
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
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
    let mut visitor = UnionVisitor::new();
    query.visit(&mut visitor);
    visitor.has_union
}

fn has_subquery(stat: &Statement) -> bool {
    let mut visitor = SubqueryVisitor::new();
    stat.visit(&mut visitor);
    visitor.is_subquery
}

struct UnionVisitor {
    pub has_union: bool,
}

impl UnionVisitor {
    fn new() -> Self {
        Self { has_union: false }
    }
}

impl Visitor for UnionVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::SetOperation { .. } = *query.body {
            self.has_union = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
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

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        // Check for table subqueries in FROM clause
        if let SetExpr::Select(select) = query.body.as_ref() {
            for table_with_joins in &select.from {
                if let sqlparser::ast::TableFactor::Derived { .. } = &table_with_joins.relation {
                    self.is_subquery = true;
                    return ControlFlow::Break(());
                }
            }
        }
        ControlFlow::Continue(())
    }
}

fn has_timestamp(stat: &Statement) -> bool {
    let mut visitor = TimestampVisitor::new();
    stat.visit(&mut visitor);
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

fn has_window_functions(stat: &Statement) -> bool {
    let mut visitor = WindowFunctionVisitor::new();
    stat.visit(&mut visitor);
    visitor.has_window_function
}

struct WindowFunctionVisitor {
    pub has_window_function: bool,
}

impl WindowFunctionVisitor {
    fn new() -> Self {
        Self {
            has_window_function: false,
        }
    }
}

impl Visitor for WindowFunctionVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Function(Function { over, .. }) if over.is_some() => {
                self.has_window_function = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

fn has_cte(query: &Query) -> bool {
    // Check if query has WITH clause (CTEs)
    !query.with.is_none()
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

    #[test]
    fn check_is_simple_aggregate_for_complex_queries_should_be_false() {
        let queries = [
            // Test case 1: Query with JOINs (should be false)
            (
                r#"SELECT COUNT(*), SUM(a.value) 
                   FROM table_a a 
                   JOIN table_b b ON a.id = b.id"#,
                "Query with JOIN should not be simple",
            ),
            // Test case 2: Query with table subquery in FROM clause (should be false)
            (
                r#"SELECT COUNT(*), AVG(total) 
                   FROM (SELECT SUM(value) as total FROM events GROUP BY user_id) subq"#,
                "Query with table subquery should not be simple",
            ),
            // Test case 3: Query with expression subquery (should be false)
            (
                r#"SELECT COUNT(*), AVG(salary) 
                   FROM employees 
                   WHERE department_id IN (SELECT id FROM departments WHERE active = 1)"#,
                "Query with expression subquery should not be simple",
            ),
            // Test case 4: Query with UNION (should be false)
            (
                r#"SELECT COUNT(*) FROM (
                     SELECT user_id FROM events_2023 
                     UNION ALL 
                     SELECT user_id FROM events_2024
                   ) combined"#,
                "Query with UNION should not be simple",
            ),
            // Test case 5: Query with window functions (should be false)
            (
                r#"SELECT COUNT(*), 
                          SUM(value) OVER (PARTITION BY category) as window_sum
                   FROM events"#,
                "Query with window functions should not be simple",
            ),
            // Test case 6: Query with multiple window functions (should be false)
            (
                r#"SELECT user_id, event_time,
                          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time) as row_num,
                          SUM(value) OVER (PARTITION BY user_id) as user_total
                   FROM events"#,
                "Query with multiple window functions should not be simple",
            ),
            // Test case 7: Complex query with multiple complexity factors (should be false)
            (
                r#"SELECT 
                     SUM(event_count) OVER (PARTITION BY time_bucket) AS total_events,
                     time_bucket,
                     ROW_NUMBER() OVER (PARTITION BY time_bucket) AS row_num
                   FROM (
                     SELECT histogram(event_time, '5 minutes') AS time_bucket,
                            COUNT(event_time) AS event_count
                     FROM events_a
                     GROUP BY time_bucket
                     UNION ALL
                     SELECT histogram(event_time, '5 minutes') AS time_bucket,
                            COUNT(event_time) AS event_count
                     FROM events_b
                     GROUP BY time_bucket
                   )"#,
                "Query with subquery + union + window functions should not be simple",
            ),
            // Test case 8: Query with EXISTS subquery (should be false)
            (
                r#"SELECT COUNT(*), AVG(amount) 
                   FROM orders o
                   WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.active = 1)"#,
                "Query with EXISTS subquery should not be simple",
            ),
            // Test case 9: Query with self-join (should be false)
            (
                r#"SELECT COUNT(*), SUM(a.value + b.value)
                   FROM events a
                   JOIN events b ON a.user_id = b.user_id AND a.event_time > b.event_time"#,
                "Query with self-join should not be simple",
            ),
            // Test case 10: Query with nested UNION (should be false)
            (
                r#"SELECT total FROM (
                     SELECT SUM(amount) as total FROM sales_q1
                     UNION
                     (SELECT SUM(amount) as total FROM sales_q2
                      UNION 
                      SELECT SUM(amount) as total FROM sales_q3)
                   )"#,
                "Query with nested UNION should not be simple",
            ),
            // Test case 11: Query with simple CTE (should be false)
            (
                r#"WITH user_totals AS (
                     SELECT user_id, SUM(amount) as total
                     FROM orders 
                     GROUP BY user_id
                   )
                   SELECT COUNT(*) FROM user_totals WHERE total > 100"#,
                "Query with simple CTE should not be simple",
            ),
            // Test case 12: Query with multiple CTEs (should be false)
            (
                r#"WITH sales_summary AS (
                     SELECT region, SUM(amount) as total_sales
                     FROM sales 
                     GROUP BY region
                   ),
                   top_regions AS (
                     SELECT region FROM sales_summary WHERE total_sales > 10000
                   )
                   SELECT COUNT(*) FROM top_regions"#,
                "Query with multiple CTEs should not be simple",
            ),
            // Test case 13: Query with recursive CTE (should be false)
            (
                r#"WITH RECURSIVE hierarchy AS (
                     SELECT id, parent_id, name, 1 as level
                     FROM categories WHERE parent_id IS NULL
                     UNION ALL
                     SELECT c.id, c.parent_id, c.name, h.level + 1
                     FROM categories c 
                     JOIN hierarchy h ON c.parent_id = h.id
                   )
                   SELECT COUNT(*) FROM hierarchy"#,
                "Query with recursive CTE should not be simple",
            ),
            // Test case 14: Query with CTE containing complex operations (should be false)
            (
                r#"WITH complex_cte AS (
                     SELECT user_id, 
                            ROW_NUMBER() OVER (ORDER BY created_at) as rank,
                            SUM(amount) OVER (PARTITION BY region) as region_total
                     FROM orders
                     WHERE created_at >= '2024-01-01'
                   )
                   SELECT COUNT(*), AVG(region_total) FROM complex_cte"#,
                "Query with CTE containing window functions should not be simple",
            ),
            // Test case 15: Query with DISTINCT (should be false)
            (
                r#"SELECT DISTINCT user_id, COUNT(*) 
                   FROM events 
                   GROUP BY user_id"#,
                "Query with DISTINCT should not be simple",
            ),
            // Test case 16: Query with DISTINCT and aggregate (should be false)
            (
                r#"SELECT DISTINCT region, SUM(amount) as total
                   FROM sales 
                   GROUP BY region"#,
                "Query with DISTINCT and aggregate should not be simple",
            ),
            // Test case 17: Query with DISTINCT on multiple columns (should be false)
            (
                r#"SELECT DISTINCT user_id, product_id, COUNT(*) as purchase_count
                   FROM purchases
                   GROUP BY user_id, product_id"#,
                "Query with DISTINCT on multiple columns should not be simple",
            ),
            // Test case 18: Query with COUNT(DISTINCT) (should be false)
            (
                r#"SELECT COUNT(DISTINCT user_id) as unique_users,
                          SUM(amount) as total_amount
                   FROM orders"#,
                "Query with COUNT(DISTINCT) should not be simple",
            ),
            // Test case 19: Query with DISTINCT and no group by (should be false)
            (
                r#"SELECT DISTINCT user_id
                   FROM orders"#,
                "Query with DISTINCT and no group by should not be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!(
                "Query [{}]: {} - is_simple: {:?}",
                i, description, is_simple_aggregate
            );
            assert_eq!(
                is_simple_aggregate, false,
                "Failed test case [{}]: '{}' - should not be simple but returned true",
                i, description
            );
        }
    }

    #[test]
    fn check_is_simple_aggregate_for_simple_queries_should_be_true() {
        let queries = [
            // Test case 1: Basic COUNT
            (
                r#"SELECT COUNT(*) FROM events"#,
                "Simple COUNT query should be simple",
            ),
            // Test case 2: SUM with GROUP BY
            (
                r#"SELECT user_id, SUM(amount) FROM orders GROUP BY user_id"#,
                "Simple SUM with GROUP BY should be simple",
            ),
            // Test case 3: Multiple aggregates
            (
                r#"SELECT COUNT(*), AVG(price), MAX(created_at) FROM products WHERE active = 1"#,
                "Multiple aggregates with WHERE should be simple",
            ),
            // Test case 4: Aggregate with GROUP BY and HAVING
            (
                r#"SELECT category, COUNT(*), AVG(price) 
                   FROM products 
                   GROUP BY category 
                   HAVING COUNT(*) > 5"#,
                "Aggregate with GROUP BY and HAVING should be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!(
                "Simple Query [{}]: {} - is_simple: {:?}",
                i, description, is_simple_aggregate
            );
            assert_eq!(
                is_simple_aggregate, true,
                "Failed test case [{}]: '{}' - should be simple but returned false",
                i, description
            );
        }
    }
}

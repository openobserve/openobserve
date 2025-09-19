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

use hashbrown::HashSet;
use sqlparser::{
    ast::{
        DuplicateTreatment, Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList,
        FunctionArguments, GroupByExpr, Query, SelectItem, SetExpr, SetQuantifier, Statement,
        TableFactor, Visit, Visitor,
    },
    dialect::GenericDialect,
    parser::Parser,
};

use crate::TIMESTAMP_COL_NAME;

pub const AGGREGATE_UDF_LIST: [&str; 17] = [
    "min",
    "max",
    "avg",
    "sum",
    "count",
    "median",
    "array_agg",
    "percentile_cont",
    "summary_percentile",
    "first_value",
    "last_value",
    "approx_distinct",
    "approx_median",
    "approx_percentile_cont",
    "approx_percentile_cont_with_weight",
    "approx_topk",
    "approx_topk_distinct",
];

pub fn is_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement
            && (is_aggregate_in_select(query)
                || has_group_by(query)
                || has_having(query)
                || has_join(query)
                || has_union(query))
        {
            return Ok(true);
        } else if has_distinct(statement) || has_subquery(statement) {
            return Ok(true);
        }
    }
    Ok(false)
}

// Only select from one table, have no join, no subquery, no union, no window functions, no CTE, no
// distinct, and has aggregation
pub fn is_simple_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if has_subquery(statement) || has_window_functions(statement) {
            return Ok(false);
        }

        if let Statement::Query(query) = statement
            && (!is_aggregate_in_select(query)
                || has_join(query)
                || has_union(query)
                || has_cte(query))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn is_explain_query(query: &str) -> bool {
    match Parser::parse_sql(&GenericDialect {}, query) {
        Ok(statements) if !statements.is_empty() => {
            matches!(statements[0], Statement::Explain { .. })
        }
        _ => false,
    }
}

/// distinct with no group by
pub fn is_simple_distinct_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement
            && has_distinct(statement)
            && !has_group_by(query)
        {
            return Ok(true);
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
                && is_aggregate_expression(expr)
            {
                return true;
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
            operand,
            conditions,
            else_result,
            ..
        } => {
            // Check if any part of the CASE expression is an aggregate function
            conditions.iter().any(|c| {
                is_aggregate_expression(&c.condition) || is_aggregate_expression(&c.result)
            }) || operand.as_ref().is_some_and(|e| is_aggregate_expression(e))
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

// (is_eligible_for_histogram, is_sub_query)
pub fn is_eligible_for_histogram(
    query: &str,
    is_multi_stream_search: bool,
) -> Result<(bool, bool), sqlparser::parser::ParserError> {
    if is_multi_stream_search {
        let is_eligible = is_multi_search_eligible_for_histogram(query)?;
        return Ok((is_eligible, false));
    }
    // Histogram is not available for CTE, DISTINCT, UNION, JOIN and LIMIT queries.
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if has_subquery(statement) {
                return Ok((true, true));
            } else if has_distinct(statement)
                || has_limit(query)
                || has_cte(query)
                || has_join(query)
                || has_union(query)
            {
                return Ok((false, false));
            }
        }
    }
    Ok((true, false))
}

fn is_multi_search_eligible_for_histogram(
    query: &str,
) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement
            && has_union_all(query)
        {
            return Ok(true);
        }
    }
    Ok(false)
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
fn has_distinct(statement: &Statement) -> bool {
    let mut visitor = DistinctVisitor::new();
    let _ = statement.visit(&mut visitor);
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
        if let SetExpr::Select(select) = query.body.as_ref()
            && select.distinct.is_some()
        {
            self.has_distinct = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        // Check for DISTINCT inside functions like COUNT(DISTINCT column)
        // from field names, string literals, or comments containing "distinct"
        if let Expr::Function(Function {
            args:
                FunctionArguments::List(FunctionArgumentList {
                    duplicate_treatment: Some(DuplicateTreatment::Distinct),
                    ..
                }),
            ..
        }) = expr
        {
            self.has_distinct = true;
            return ControlFlow::Break(());
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
    let _ = query.visit(&mut visitor);
    visitor.has_union
}

fn has_union_all(query: &Query) -> bool {
    let mut visitor = UnionAllVisitor::new();
    let _ = query.visit(&mut visitor);
    visitor.has_union_all
}

fn has_subquery(stat: &Statement) -> bool {
    let mut visitor = SubqueryVisitor::new();
    let _ = stat.visit(&mut visitor);
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

struct UnionAllVisitor {
    pub has_union_all: bool,
}

impl UnionAllVisitor {
    fn new() -> Self {
        Self {
            has_union_all: false,
        }
    }
}

impl Visitor for UnionAllVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::SetOperation { set_quantifier, .. } = *query.body
            && set_quantifier == SetQuantifier::All
        {
            self.has_union_all = true;
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
    let _ = stat.visit(&mut visitor);
    visitor.timestamp_selected
}

pub struct TimestampVisitor {
    pub timestamp_selected: bool,
    timestamp_aliases: HashSet<String>, // known aliases for _timestamp or histogram(_timestamp)
}

impl TimestampVisitor {
    pub fn new() -> Self {
        Self {
            timestamp_selected: false,
            timestamp_aliases: HashSet::new(),
        }
    }

    fn is_timestamp_expr(expr: &Expr) -> bool {
        match expr {
            Expr::Identifier(ident) => ident.value == TIMESTAMP_COL_NAME,

            Expr::CompoundIdentifier(idents) => idents
                .last()
                .is_some_and(|id| id.value == TIMESTAMP_COL_NAME),

            Expr::Function(func) => {
                func.name.to_string().to_lowercase() == "histogram"
                    && match &func.args {
                        FunctionArguments::List(args) => args.args.iter().any(|arg| match arg {
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => {
                                Self::is_timestamp_expr(e)
                            }
                            _ => false,
                        }),
                        _ => false,
                    }
            }

            _ => false,
        }
    }

    fn visit_table_factor(&mut self, relation: &TableFactor) -> ControlFlow<()> {
        match relation {
            TableFactor::Derived { subquery, .. } => {
                subquery.visit(self)?;
            }
            TableFactor::NestedJoin {
                table_with_joins,
                alias: _,
            } => {
                for join in &table_with_joins.joins {
                    join.relation.visit(self)?;
                }
                table_with_joins.relation.visit(self)?;
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

impl Default for TimestampVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Visitor for TimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        //  Recurse into CTEs
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                cte.query.visit(self)?;
            }
        }

        //  Recurse into subqueries in FROM clause
        if let SetExpr::Select(select) = query.body.as_ref() {
            for table in &select.from {
                self.visit_table_factor(&table.relation)?;
            }

            for item in &select.projection {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        if Self::is_timestamp_expr(expr) {
                            self.timestamp_selected = true;
                            return ControlFlow::Break(());
                        }

                        // Handle alias chain: SELECT ts1 FROM (...) where ts1 is alias for
                        // _timestamp
                        if let Expr::Identifier(ident) = expr
                            && self.timestamp_aliases.contains(&ident.value)
                        {
                            self.timestamp_selected = true;
                            return ControlFlow::Break(());
                        }
                    }

                    SelectItem::ExprWithAlias { expr, alias } => {
                        // If alias is "_timestamp", count it, regardless of expr
                        if alias.value == TIMESTAMP_COL_NAME {
                            self.timestamp_selected = true;
                            return ControlFlow::Break(());
                        }

                        // If the expression is timestamp-related, remember its alias
                        if Self::is_timestamp_expr(expr) {
                            self.timestamp_aliases.insert(alias.value.clone());
                        }

                        // If the expression is an alias we already know maps to timestamp
                        if let Expr::Identifier(ident) = expr
                            && self.timestamp_aliases.contains(&ident.value)
                        {
                            self.timestamp_aliases.insert(alias.value.clone());
                        }
                    }

                    // SELECT * — explicitly excluded
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
    let _ = stat.visit(&mut visitor);
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
    query.with.is_some()
}

fn has_limit(query: &Query) -> bool {
    query.limit_clause.is_some()
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
            // Subquery
            (
                "SELECT ts, code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp) AS ts, count(*) FROM tbl1 WHERE a=b AND c IN(SELECT c FROM tbl2 WHERE c=d) GROUP BY ts ORDER BY ts ASC",
                false,
                "Final result does not have _timestamp field",
            ),
            // Subquery
            (
                "SELECT ts, cnt FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT * FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM (SELECT _timestamp, array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM tbl WHERE responsecode IN(SELECT array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT * FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT ts, cnt FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
                false,
                "Final result does not have _timestamp field",
            ),
            // Subquery
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts ASC, request_count DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts AS ts2, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts2 AS ts3, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts2 ASC, request_count DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            // Join
            (
                "SELECT histogram(a._timestamp) AS ts, b.name, count(*) FROM tbl1 AS a LEFT JOIN tbl2 AS b ON a.userid=b.userid GROUP BY ts, name ORDER BY ts ASC",
                false,
                "Final result does not have _timestamp field",
            ),
            // CTE
            (
                "WITH a AS (SELECT histogram(_timestamp) AS ts, userid, count(*) as cnt FROM tbl1 GROUP BY ts, userid HAVING cnt > 40) SELECT ts, SUM(cnt) AS cnt, COUNT(DISTINCT userid) AS user_cnt FROM a GROUP BY ts",
                true,
                "Still results a _timestamp field",
            ),
            // CTE
        ];

        for (sql, expected, test_name) in test_cases {
            let result = is_timestamp_selected(sql)?;
            assert_eq!(
                result, expected,
                "Failed test case '{test_name}': expected {expected}, got {result}"
            );
        }

        Ok(())
    }

    #[test]
    fn check_is_simple_aggregate() {
        let query = r#"SELECT histogram(_timestamp) AS zo_sql_time, "kubernetes_docker_id" AS zo_sql_key, SUM(count) AS zo_sql_num FROM "distinct_values_logs_default22" GROUP BY zo_sql_time, zo_sql_key ORDER BY zo_sql_time ASC, zo_sql_num DESC"#;
        let ab = is_aggregate_query(query);
        print!("{ab:?}");
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
            // Test case 15: Query with histogram in subquery in FROM clause (should be false)
            (
                r#"SELECT SUM(x_axis_1) AS "y_axis_1"
                   FROM (
                     SELECT histogram(_timestamp) AS "xaxis",
                            COUNT(_timestamp) AS "x_axis_1"
                     FROM "default"
                     GROUP BY xaxis
                   )"#,
                "Query with histogram in subquery should not be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Query [{i}]: {description} - is_simple: {is_simple_aggregate:?}");
            assert!(
                !is_simple_aggregate,
                "Failed test case [{i}]: '{description}' - should not be simple but returned true"
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
            // Test case 5: Query with DISTINCT (should be true)
            (
                r#"SELECT DISTINCT user_id, COUNT(*)
                   FROM events
                   GROUP BY user_id"#,
                "Query with DISTINCT should be simple",
            ),
            // Test case 6: Query with DISTINCT and aggregate (should be true)
            (
                r#"SELECT DISTINCT region, SUM(amount) as total
                   FROM sales
                   GROUP BY region"#,
                "Query with DISTINCT and aggregate should be simple",
            ),
            // Test case 7: Query with DISTINCT on multiple columns (should be true)
            (
                r#"SELECT DISTINCT user_id, product_id, COUNT(*) as purchase_count
                   FROM purchases
                   GROUP BY user_id, product_id"#,
                "Query with DISTINCT on multiple columns should be simple",
            ),
            // Test case 8: Query with COUNT(DISTINCT) (should be true)
            (
                r#"SELECT COUNT(DISTINCT user_id) as unique_users,
                          SUM(amount) as total_amount
                   FROM orders"#,
                "Query with COUNT(DISTINCT) should be simple",
            ),
            // Test case 9: Query with DISTINCT and no group by (should be true)
            (
                r#"SELECT DISTINCT user_id
                   FROM orders"#,
                "Query with DISTINCT and no group by should be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Simple Query [{i}]: {description} - is_simple: {is_simple_aggregate:?}");
            assert!(
                is_simple_aggregate,
                "Failed test case [{i}]: '{description}' - should be simple but returned false"
            );
        }
    }

    #[test]
    fn check_is_simple_aggregate_for_complex_queries_should_be_false_2() {
        let queries = [r#"
            SELECT
                SUM(event_count) OVER (PARTITION BY time_bucket) AS total_events,
                time_bucket,
                (
                    SUM(error_events) OVER (PARTITION BY time_bucket) /
                    SUM(event_count) OVER (PARTITION BY time_bucket)
                ) AS error_rate,
                (
                    CASE
                        WHEN (SUM(error_events) OVER (PARTITION BY time_bucket) /
                              SUM(event_count) OVER (PARTITION BY time_bucket)) > 0.001
                             AND SUM(event_count) OVER (PARTITION BY time_bucket) > 1
                        THEN 1
                        ELSE 0
                    END
                ) AS alert_flag,
                ROW_NUMBER() OVER (PARTITION BY time_bucket) AS row_num
            FROM (
                SELECT
                    histogram(event_time, '5 minutes') AS time_bucket,
                    0 AS error_events,
                    'source_a' AS source_type,
                    CAST(COUNT(event_time) AS FLOAT) AS event_count
                FROM "event_logs_source_a"
                WHERE service_name = 'service-a'
                    AND (
                        path = '/' OR path LIKE '/?%' OR path = '/variant' OR path LIKE '/variant?%'
                    )
                GROUP BY time_bucket

                UNION ALL

                SELECT
                    histogram(event_time, '5 minutes') AS time_bucket,
                    CAST(SUM(CASE WHEN status_code = '500' THEN 1 END) AS FLOAT) AS error_events,
                    'source_b' AS source_type,
                    CAST(COUNT(event_time) AS FLOAT) AS event_count
                FROM "event_logs_source_b"
                WHERE url LIKE 'https://example.com/%'
                    AND metric_name LIKE 'query_%'
                    AND category = 'log'
                GROUP BY time_bucket
                ORDER BY time_bucket
            )
            LIMIT 500000
            "#];

        for (i, query) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Query [{i}] is_simple: {is_simple_aggregate:?}");
            assert!(!is_simple_aggregate);
        }
    }

    #[test]
    fn check_is_eligible_for_histogram_for_queries_should_be_true() {
        let queries = [
            r#"SELECT * FROM "olympics" WHERE _timestamp >= 1716854400000 AND _timestamp <= 1716940800000"#,
            r#"SELECT * FROM "olympics" WHERE _timestamp >= 1716854400000 AND _timestamp <= 1716940800000"#,
        ];
        for query in queries.iter() {
            let (is_eligible, is_sub_query) = is_eligible_for_histogram(query, false).unwrap();
            assert_eq!(is_eligible, true);
            assert_eq!(is_sub_query, false);
        }
    }

    #[test]
    fn check_is_eligible_for_histogram_for_queries_should_be_false() {
        // Histogram is not available for SUBQUERY, CTE, DISTINCT and LIMIT queries.
        let queries = [
            r#"WITH cte AS (SELECT * FROM "olympics") SELECT * FROM cte"#,
            r#"SELECT DISTINCT * FROM "olympics""#,
            r#"SELECT * FROM "olympics" LIMIT 100"#,
        ];
        for query in queries.iter() {
            let (is_eligible, is_sub_query) = is_eligible_for_histogram(query, false).unwrap();
            assert_eq!(is_eligible, false);
            // Note: subqueries return (true, true) but are still not eligible for histogram
            if query.contains("SELECT * FROM (SELECT") {
                assert_eq!(is_sub_query, true);
            } else {
                assert_eq!(is_sub_query, false);
            }
        }
    }

    #[test]
    fn check_union_all_visitor() {
        let sql1 = "select * from oly union select * from oly2";
        let sql2 = "select * from oly union all select * from oly2";

        let is_not_union_all = is_multi_search_eligible_for_histogram(sql1).unwrap();
        let is_union_all = is_multi_search_eligible_for_histogram(sql2).unwrap();

        assert_eq!(is_not_union_all, false);
        assert_eq!(is_union_all, true);
    }

    #[test]
    fn test_is_explain_query() {
        // Test EXPLAIN query
        assert!(is_explain_query("EXPLAIN SELECT * FROM users"));
        assert!(is_explain_query("explain select count(*) from logs"));

        // Test EXPLAIN ANALYZE query
        assert!(is_explain_query("EXPLAIN ANALYZE SELECT * FROM users"));

        // Test regular query
        assert!(!is_explain_query("SELECT * FROM users"));
        assert!(!is_explain_query("SELECT count(*) FROM logs"));

        // Test invalid SQL
        assert!(!is_explain_query("INVALID SQL"));
    }
}

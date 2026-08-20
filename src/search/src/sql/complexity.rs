// Copyright 2026 OpenObserve Inc.
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

//! Guards a parsed statement against pathologically deep boolean predicates.
//!
//! A query that ORs together a very large number of conditions — e.g. hundreds
//! of `match_all()` terms — parses without trouble: precedence climbing consumes
//! `a OR b OR c ...` iteratively, so the parser's own recursion limit never
//! trips and the result is a deeply left-nested `BinaryOp` tree. Every consumer
//! of that tree, however, recurses over its structure: DataFusion's logical
//! optimizer, the inverted-index condition builder
//! (`Condition::from_physical_expr` / `IndexCondition::to_tantivy_query`), the
//! tantivy scorer, and the boxed tree's own `Drop`. A deep enough tree overflows
//! the stack and aborts the whole process rather than failing the one query.
//!
//! Rejecting such a statement up front — before any of those recursions run —
//! turns the crash into a normal query error. See issue #12398.

use sqlparser::ast::{Expr, Query, SelectItem, SetExpr, Statement, TableFactor};

/// Maximum boolean-operator nesting depth permitted in a query predicate.
///
/// Chosen to sit far above any hand-written query yet comfortably below the
/// depth at which the downstream recursions were observed to overflow the stack.
/// The web UI applies the same idea (`MAX_RECURSION_DEPTH` in `useSearchBar.ts`).
pub const MAX_PREDICATE_NESTING_DEPTH: usize = 64;

/// Whether any predicate in `statement` — a `WHERE`/`HAVING` clause, a `CASE`
/// branch, or a projection expression, including inside CTEs and subqueries —
/// nests boolean operators deeper than [`MAX_PREDICATE_NESTING_DEPTH`].
///
/// Not covered: predicates buried in a `JOIN ... ON` condition or a function
/// argument; those positions are rare for the deeply-OR-ed shape this guards
/// against.
pub fn is_predicate_too_deep(statement: &Statement) -> bool {
    predicate_nesting_exceeds(statement, MAX_PREDICATE_NESTING_DEPTH)
}

/// Same as [`is_predicate_too_deep`] with an explicit limit (for testing).
///
/// The traversal is bounded on both the query structure and the predicate
/// expression: it descends at most `max_depth` levels before reporting a breach,
/// so the check itself cannot overflow on a deep input.
pub fn predicate_nesting_exceeds(statement: &Statement, max_depth: usize) -> bool {
    match statement {
        Statement::Query(query) => query_exceeds(query, max_depth),
        _ => false,
    }
}

fn query_exceeds(query: &Query, remaining: usize) -> bool {
    if remaining == 0 {
        return true;
    }
    // CTE bodies are planned like any other query, so a deep predicate hidden in
    // a `WITH x AS (SELECT ... WHERE <deep>)` reaches the same recursive consumers.
    if let Some(with) = &query.with
        && with
            .cte_tables
            .iter()
            .any(|cte| query_exceeds(&cte.query, remaining - 1))
    {
        return true;
    }
    set_expr_exceeds(&query.body, remaining)
}

fn set_expr_exceeds(set_expr: &SetExpr, remaining: usize) -> bool {
    if remaining == 0 {
        return true;
    }
    match set_expr {
        SetExpr::Select(select) => {
            // WHERE and HAVING are the boolean predicates that feed the recursive
            // consumers; a projection expression or a FROM subquery can hide the
            // same shape.
            select
                .selection
                .as_ref()
                .is_some_and(|expr| expr_exceeds(expr, remaining))
                || select
                    .having
                    .as_ref()
                    .is_some_and(|expr| expr_exceeds(expr, remaining))
                || select
                    .projection
                    .iter()
                    .any(|item| select_item_exceeds(item, remaining))
                || select
                    .from
                    .iter()
                    .any(|twj| table_factor_exceeds(&twj.relation, remaining))
                || select
                    .from
                    .iter()
                    .flat_map(|twj| twj.joins.iter())
                    .any(|join| table_factor_exceeds(&join.relation, remaining))
        }
        SetExpr::Query(query) => query_exceeds(query, remaining - 1),
        SetExpr::SetOperation { left, right, .. } => {
            set_expr_exceeds(left, remaining - 1) || set_expr_exceeds(right, remaining - 1)
        }
        _ => false,
    }
}

fn select_item_exceeds(item: &SelectItem, remaining: usize) -> bool {
    match item {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => {
            expr_exceeds(expr, remaining)
        }
        _ => false,
    }
}

fn table_factor_exceeds(relation: &TableFactor, remaining: usize) -> bool {
    if remaining == 0 {
        return true;
    }
    match relation {
        TableFactor::Derived { subquery, .. } => query_exceeds(subquery, remaining - 1),
        _ => false,
    }
}

/// Bounded depth check over a predicate expression: `true` if it nests
/// `AND`/`OR`/`NOT`/parentheses/subqueries deeper than `remaining` levels.
/// Returns as soon as the budget is exhausted, so its recursion depth never
/// exceeds `remaining`.
fn expr_exceeds(expr: &Expr, remaining: usize) -> bool {
    if remaining == 0 {
        return true;
    }
    match expr {
        Expr::BinaryOp { left, right, .. } => {
            expr_exceeds(left, remaining - 1) || expr_exceeds(right, remaining - 1)
        }
        Expr::UnaryOp { expr, .. } | Expr::Nested(expr) => expr_exceeds(expr, remaining - 1),
        Expr::Subquery(query)
        | Expr::Exists {
            subquery: query, ..
        } => query_exceeds(query, remaining - 1),
        Expr::InSubquery { subquery, .. } => query_exceeds(subquery, remaining - 1),
        Expr::Case {
            operand,
            conditions,
            else_result,
            ..
        } => {
            operand
                .as_deref()
                .is_some_and(|e| expr_exceeds(e, remaining - 1))
                || conditions.iter().any(|w| {
                    expr_exceeds(&w.condition, remaining - 1)
                        || expr_exceeds(&w.result, remaining - 1)
                })
                || else_result
                    .as_deref()
                    .is_some_and(|e| expr_exceeds(e, remaining - 1))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{dialect::PostgreSqlDialect, parser::Parser};

    use super::*;

    fn parse(sql: &str) -> Statement {
        Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap()
    }

    /// N distinct `match_all()` terms OR-ed together in a WHERE clause.
    fn or_chain_sql(n: usize) -> String {
        let terms = (0..n)
            .map(|i| format!("match_all('error{i}')"))
            .collect::<Vec<_>>()
            .join(" or ");
        format!("SELECT * FROM t WHERE {terms}")
    }

    #[test]
    fn ordinary_queries_are_not_too_deep() {
        assert!(!is_predicate_too_deep(&parse("SELECT * FROM t")));
        assert!(!is_predicate_too_deep(&parse(
            "SELECT * FROM t WHERE a = 1 AND b = 2 OR c = 3"
        )));
        // A realistic number of OR-ed conditions is allowed.
        assert!(!is_predicate_too_deep(&parse(&or_chain_sql(20))));
    }

    #[test]
    fn a_pathologically_deep_or_chain_is_rejected() {
        // Well beyond the limit — the shape from #12398.
        assert!(is_predicate_too_deep(&parse(&or_chain_sql(500))));
    }

    #[test]
    fn the_limit_is_an_exact_boundary() {
        // The WHERE predicate gets the full budget, so a chain that consumes
        // exactly `max` levels is allowed and one level deeper is rejected. Both
        // sides of the cut are asserted so an off-by-one in the limit is caught.
        let max = 8;
        assert!(!predicate_nesting_exceeds(&parse(&or_chain_sql(max)), max));
        assert!(predicate_nesting_exceeds(
            &parse(&or_chain_sql(max + 1)),
            max
        ));
    }

    #[test]
    fn the_check_does_not_overflow_on_a_deep_input() {
        // Reaching the assertion at all proves the bounded check did not recurse
        // into a stack overflow on a 5000-deep predicate.
        assert!(is_predicate_too_deep(&parse(&or_chain_sql(5000))));
    }

    #[test]
    fn depth_in_a_subquery_where_is_counted() {
        let inner = (0..500)
            .map(|i| format!("match_all('e{i}')"))
            .collect::<Vec<_>>()
            .join(" or ");
        let sql = format!("SELECT * FROM (SELECT * FROM t WHERE {inner}) x");
        assert!(is_predicate_too_deep(&parse(&sql)));
    }

    #[test]
    fn depth_in_a_cte_body_is_counted() {
        let inner = (0..500)
            .map(|i| format!("match_all('e{i}')"))
            .collect::<Vec<_>>()
            .join(" or ");
        let sql = format!("WITH x AS (SELECT * FROM t WHERE {inner}) SELECT * FROM x");
        assert!(is_predicate_too_deep(&parse(&sql)));
    }

    #[test]
    fn depth_in_a_projection_is_counted() {
        let inner = (0..500)
            .map(|i| format!("match_all('e{i}')"))
            .collect::<Vec<_>>()
            .join(" or ");
        let sql = format!("SELECT ({inner}) AS flagged FROM t");
        assert!(is_predicate_too_deep(&parse(&sql)));
    }

    #[test]
    fn depth_in_a_case_branch_is_counted() {
        let inner = (0..500)
            .map(|i| format!("match_all('e{i}')"))
            .collect::<Vec<_>>()
            .join(" or ");
        let sql = format!("SELECT * FROM t WHERE CASE WHEN ({inner}) THEN 1 ELSE 0 END = 1");
        assert!(is_predicate_too_deep(&parse(&sql)));
    }

    #[test]
    fn non_query_statements_are_ignored() {
        assert!(!is_predicate_too_deep(&parse("SHOW TABLES")));
    }
}

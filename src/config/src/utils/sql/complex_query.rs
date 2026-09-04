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

use std::ops::ControlFlow;

use sqlparser::{
    ast::{Expr, GroupByExpr, Query, SetExpr, Statement, TableFactor, Visit, Visitor},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::AGGREGATE_UDF_LIST;

pub fn is_complex_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&PostgreSqlDialect {}, query)?;
    Ok(ast.iter().any(is_complex_query_stmt))
}

pub fn is_complex_query_stmt(statement: &Statement) -> bool {
    let mut visitor = ComplexityVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.is_complex
}

// check if the query is complex query
// 1. has subquery
// 2. has join
// 3. has group by
// 4. has aggregate
// 5. has SetOperation(UNION/EXCEPT/INTERSECT of two queries)
// 6. has distinct
// 7. has having
struct ComplexityVisitor {
    pub is_complex: bool,
}

impl ComplexityVisitor {
    fn new() -> Self {
        Self { is_complex: false }
    }
}

impl Visitor for ComplexityVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        match query.body.as_ref() {
            SetExpr::Select(select) => {
                // check if has group by
                match &select.group_by {
                    GroupByExpr::Expressions(v, _) => self.is_complex = !v.is_empty(),
                    _ => self.is_complex = true,
                }
                // check if has join
                if select.from.len() > 1
                    || select.from.iter().any(|from| !from.joins.is_empty())
                    || (select.from.len() == 1
                        && !matches!(select.from[0].relation, TableFactor::Table { .. }))
                {
                    self.is_complex = true;
                }
                if select.distinct.is_some() {
                    self.is_complex = true;
                }
                if select.having.is_some() {
                    self.is_complex = true;
                }
                if self.is_complex {
                    return ControlFlow::Break(());
                }
            }
            // check if SetOperation
            SetExpr::SetOperation { .. } => {
                self.is_complex = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }

        if query.with.is_some() {
            self.is_complex = true;
            return ControlFlow::Break(());
        }

        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            // check if has subquery
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.is_complex = true;
            }
            // check if has aggregate function or window function
            Expr::Function(func) => {
                let name = func.name.to_string().to_lowercase();
                let name = trim_quotes(&name);
                if AGGREGATE_UDF_LIST.contains(&name.as_str())
                    || func.filter.is_some()
                    || func.over.is_some()
                    || !func.within_group.is_empty()
                {
                    self.is_complex = true;
                }
            }
            _ => {}
        }
        if self.is_complex {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

fn trim_quotes(s: &str) -> String {
    let s = s
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(s);
    s.strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .unwrap_or(s)
        .to_string()
}

#[cfg(test)]
mod tests {
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    use super::*;

    #[test]
    fn test_is_complex_query() {
        assert!(is_complex_query("SELECT count(*) FROM t").unwrap());
        assert!(is_complex_query("SELECT max(val), min(val) FROM t").unwrap());
        assert!(is_complex_query("SELECT x FROM t GROUP BY x").unwrap());
        assert!(is_complex_query("SELECT DISTINCT x FROM t").unwrap());
        assert!(!is_complex_query("SELECT x FROM t").unwrap());
        assert!(!is_complex_query("SELECT x, y FROM t WHERE x > 1").unwrap());
    }

    #[test]
    fn test_is_complex_query_having_join_union_subquery() {
        assert!(
            is_complex_query("SELECT x, count(*) FROM t GROUP BY x HAVING count(*) > 1").unwrap()
        );

        assert!(is_complex_query("SELECT a.x FROM a JOIN b ON a.id = b.id").unwrap());

        assert!(is_complex_query("SELECT x FROM t1 UNION SELECT x FROM t2").unwrap());

        assert!(is_complex_query("SELECT x FROM t WHERE x IN (SELECT x FROM t2)").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_via_binary_op_and_nested() {
        assert!(is_complex_query("SELECT count(*) + 1 FROM t").unwrap());
        assert!(is_complex_query("SELECT (count(*)) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_via_cast_and_unary() {
        assert!(is_complex_query("SELECT CAST(count(*) AS TEXT) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_case_with_aggregate() {
        assert!(is_complex_query("SELECT CASE WHEN 1=1 THEN count(*) ELSE 0 END FROM t").unwrap());
    }

    #[test]
    fn test_is_complex_query_count_distinct_function() {
        assert!(is_complex_query("SELECT count(DISTINCT x) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_unary_op_with_aggregate() {
        assert!(is_complex_query("SELECT -count(*) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_case_else_result_aggregate() {
        assert!(is_complex_query("SELECT CASE WHEN 1=0 THEN 0 ELSE count(*) END FROM t").unwrap());
    }

    #[test]
    fn check_is_simple_aggregate() {
        let query = r#"SELECT histogram(_timestamp) AS zo_sql_time, "kubernetes_docker_id" AS zo_sql_key, SUM(count) AS zo_sql_num FROM "distinct_values_logs_default22" GROUP BY zo_sql_time, zo_sql_key ORDER BY zo_sql_time ASC, zo_sql_num DESC"#;
        let ab = is_complex_query(query);
        print!("{ab:?}");
    }

    #[test]
    fn test_is_complex_query_wildcard_is_not_complex() {
        assert!(!is_complex_query("SELECT * FROM t").unwrap());
    }

    #[test]
    fn test_is_complex_query_multi_from_is_complex() {
        assert!(is_complex_query("SELECT a FROM t1, t2 WHERE t1.id = t2.id").unwrap());
    }

    #[test]
    fn test_is_complex_query_window_function_is_complex() {
        assert!(is_complex_query("SELECT a, row_number() OVER (PARTITION BY a) FROM t").unwrap());
    }

    #[test]
    fn test_is_complex_query_stmt_simple_select_is_not_complex() {
        let sql = "SELECT a, b FROM t WHERE a = 1";
        let ast = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
        assert!(!is_complex_query_stmt(&ast[0]));
    }

    #[test]
    fn test_is_complex_query_stmt_subquery_is_complex() {
        let sql = "SELECT a FROM t WHERE a IN (SELECT a FROM t2)";
        let ast = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
        assert!(is_complex_query_stmt(&ast[0]));
    }

    #[test]
    fn test_is_complex_query_stmt_join_is_complex() {
        let sql = "SELECT a FROM t1 JOIN t2 ON t1.id = t2.id";
        let ast = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
        assert!(is_complex_query_stmt(&ast[0]));
    }

    #[test]
    fn test_is_complex_query_cte_with_simple_select() {
        let sql = r#"WITH FilteredLogs AS (
                        SELECT * FROM "default"
                        WHERE str_match_ignore_case(log, 'err'))
                        SELECT k8s_namespace_name, CAST(array_element(regexp_match(log, 'took: ([0-9]+) ms'), 1) AS INTEGER)
                        FROM FilteredLogs"#;
        assert!(is_complex_query(sql).unwrap());
    }
}

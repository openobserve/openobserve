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

use infra::errors::Error;
use sqlparser::{
    ast::{Expr, Query, TableFactor, VisitMut, VisitorMut},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

pub fn pickup_where(sql: &str) -> Result<Option<String>, Error> {
    // disable subquery, join, union, except, intersect, etc.
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    let mut visitor = PickupWhereVisitor::new();
    let _ = statement.visit(&mut visitor);
    if let Some(where_str) = visitor.where_str {
        return Ok(Some(where_str));
    }
    Ok(None)
}

struct PickupWhereVisitor {
    where_str: Option<String>,
}

impl PickupWhereVisitor {
    fn new() -> Self {
        Self { where_str: None }
    }
}

impl VisitorMut for PickupWhereVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if query.with.is_some() {
            self.where_str = None;
            return ControlFlow::Break(());
        }
        match query.body.as_ref() {
            sqlparser::ast::SetExpr::Select(select) => {
                if select.from.len() > 1
                    || select.from.iter().any(|from| {
                        !from.joins.is_empty()
                            || matches!(
                                from.relation,
                                TableFactor::Derived { .. } | TableFactor::Function { .. }
                            )
                    })
                {
                    self.where_str = None;
                    return ControlFlow::Break(());
                }

                if let Some(selection) = select.selection.as_ref() {
                    self.where_str = Some(selection.to_string());
                    return ControlFlow::Continue(());
                } else {
                    self.where_str = None;
                    return ControlFlow::Break(());
                }
            }
            sqlparser::ast::SetExpr::SetOperation { .. } => {
                self.where_str = None;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            // check if has subquery
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.where_str = None;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pickup_where_normal_sql() {
        // Test normal SQL with WHERE clause
        let sql = "SELECT * FROM logs WHERE level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("level = 'error'".to_string()));

        // Test normal SQL with complex WHERE clause
        let sql = "SELECT * FROM logs WHERE level = 'error' AND timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level = 'error' AND timestamp > 1234567890".to_string())
        );

        // Test normal SQL with OR condition
        let sql = "SELECT * FROM logs WHERE level = 'error' OR level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level = 'error' OR level = 'warn'".to_string())
        );

        // Test normal SQL with IN clause
        let sql = "SELECT * FROM logs WHERE level IN ('error', 'warn', 'info')";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level IN ('error', 'warn', 'info')".to_string())
        );

        // Test normal SQL with LIKE clause
        let sql = "SELECT * FROM logs WHERE message LIKE '%error%'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("message LIKE '%error%'".to_string()));
    }

    #[test]
    fn test_pickup_where_no_where_clause() {
        // Test SQL without WHERE clause
        let sql = "SELECT * FROM logs";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with only SELECT and FROM
        let sql = "SELECT id, name FROM users";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_joins() {
        // Test SQL with JOIN - should return None
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with multiple FROM tables - should return None
        let sql = "SELECT * FROM logs, users WHERE logs.user_id = users.id";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with LEFT JOIN - should return None
        let sql =
            "SELECT * FROM logs l LEFT JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with INNER JOIN - should return None
        let sql =
            "SELECT * FROM logs l INNER JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_subqueries() {
        // Test SQL with subquery in WHERE - should return None
        let sql = "SELECT * FROM logs WHERE user_id IN (SELECT id FROM users WHERE active = true)";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with EXISTS subquery - should return None
        let sql =
            "SELECT * FROM logs WHERE EXISTS (SELECT 1 FROM users WHERE users.id = logs.user_id)";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with subquery in FROM - should return None
        let sql = "SELECT * FROM (SELECT * FROM logs WHERE level = 'error') sub WHERE sub.timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        let sql = "with t1 as (select log, message, kubernetes_namespace_name from default where kubernetes_namespace_name = 'ziox') select * from t1;";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        let sql = "with t1 as (select log, message, kubernetes_namespace_name from default) select * from t1 where kubernetes_namespace_name = 'ziox';";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_union() {
        // Test SQL with UNION - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' UNION SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with UNION ALL - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' UNION ALL SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with INTERSECT - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' INTERSECT SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with EXCEPT - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' EXCEPT SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_complex_where_clauses() {
        // Test complex WHERE with parentheses
        let sql = "SELECT * FROM logs WHERE (level = 'error' OR level = 'warn') AND timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("(level = 'error' OR level = 'warn') AND timestamp > 1234567890".to_string())
        );

        // Test WHERE with function calls
        let sql = "SELECT * FROM logs WHERE LENGTH(message) > 100 AND level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("LENGTH(message) > 100 AND level = 'error'".to_string())
        );

        // Test WHERE with BETWEEN
        let sql = "SELECT * FROM logs WHERE timestamp BETWEEN 1234567890 AND 1234567999";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("timestamp BETWEEN 1234567890 AND 1234567999".to_string())
        );

        // Test WHERE with IS NULL
        let sql = "SELECT * FROM logs WHERE user_id IS NULL AND level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("user_id IS NULL AND level = 'error'".to_string())
        );

        // Test WHERE with IS NOT NULL
        let sql = "SELECT * FROM logs WHERE user_id IS NOT NULL";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("user_id IS NOT NULL".to_string()));
    }

    #[test]
    fn test_pickup_where_edge_cases() {
        // Test SQL with table alias but no joins
        let sql = "SELECT * FROM logs l WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("l.level = 'error'".to_string()));

        // Test SQL with quoted identifiers
        let sql = "SELECT * FROM \"logs\" WHERE \"level\" = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("\"level\" = 'error'".to_string()));

        // Test SQL with schema prefix
        let sql = "SELECT * FROM public.logs WHERE level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("level = 'error'".to_string()));
    }
}

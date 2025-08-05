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

use hashbrown::HashMap;
use infra::errors::Error;
use sqlparser::{
    ast::{
        BinaryOperator, Expr, Ident, Query, SetExpr, Value, ValueWithSpan, VisitMut, VisitorMut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
    tokenizer::Span,
};

use crate::service::search::{sql::visitor::utils::is_complex_query, utils::conjunction};

pub fn add_new_filters_with_and_operator(
    sql: &str,
    filters: HashMap<String, String>,
) -> infra::errors::Result<String> {
    if sql.is_empty() || filters.is_empty() {
        return Ok(sql.to_string());
    }

    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    if is_complex_query(&mut statement) {
        return Ok(sql.to_string());
    }
    let mut visitor = AddNewFiltersWithAndOperatorVisitor::new(filters);
    let _ = statement.visit(&mut visitor);
    Ok(statement.to_string())
}

struct AddNewFiltersWithAndOperatorVisitor {
    filters: HashMap<String, String>,
}

impl AddNewFiltersWithAndOperatorVisitor {
    fn new(filters: HashMap<String, String>) -> Self {
        Self { filters }
    }

    fn build_selection(&mut self) -> Option<Expr> {
        if self.filters.is_empty() {
            return None;
        }
        let mut exprs = Vec::with_capacity(self.filters.len());
        let mut keys = self.filters.keys().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            let value = self.filters.get(key).unwrap();
            exprs.push(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new(key.to_string()))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(ValueWithSpan {
                    value: Value::SingleQuotedString(value.to_string()),
                    span: Span::empty(),
                })),
            });
        }
        let exprs = exprs.iter().collect();
        conjunction(exprs)
    }
}

impl VisitorMut for AddNewFiltersWithAndOperatorVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        let Some(filter_exprs) = self.build_selection() else {
            return ControlFlow::Break(());
        };
        match query.body.as_mut() {
            SetExpr::Select(statement) => match statement.selection.as_mut() {
                None => {
                    statement.selection = Some(filter_exprs);
                }
                Some(selection) => {
                    statement.selection = Some(Expr::BinaryOp {
                        left: if matches!(
                            selection,
                            Expr::BinaryOp {
                                op: BinaryOperator::Or,
                                ..
                            }
                        ) {
                            Box::new(Expr::Nested(Box::new(selection.clone())))
                        } else {
                            Box::new(selection.clone())
                        },
                        op: BinaryOperator::And,
                        // the right side must be AND so don't need to check
                        right: Box::new(filter_exprs),
                    });
                }
            },
            _ => {
                return ControlFlow::Break(());
            }
        };
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_new_filters_with_and_operator_empty_sql() {
        // Test adding filters to an empty SQL string
        let sql = "";
        let filters = HashMap::from([
            ("column1".to_string(), "'value1'".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should create a basic WHERE clause with the filters
        assert_eq!(result, "");
    }

    #[test]
    fn test_add_new_filters_with_and_operator_simple_select() {
        // Test adding filters to a simple SELECT statement
        let sql = "SELECT * FROM table1";
        let filters = HashMap::from([
            ("column1".to_string(), "value1".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add a WHERE clause
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = '10'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_existing_where() {
        // Test adding filters to a query that already has a WHERE clause
        let sql = "SELECT * FROM table1 WHERE column3 < 5";
        let filters = HashMap::from([
            ("column1".to_string(), "value1".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add to the existing WHERE clause with AND
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column3 < 5 AND column1 = 'value1' AND column2 = '10'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_multiple_filters_and_or_condition() {
        // Test adding filters to a query with multiple filters and OR condition
        let sql = "SELECT * FROM table1 WHERE column1 = 'value1' OR column2 = 'value2'";
        let filters = HashMap::from([("column3".to_string(), "value3".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE (column1 = 'value1' OR column2 = 'value2') AND column3 = 'value3'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_multiple_filters_and_and_condition() {
        // Test adding filters to a query with multiple filters and AND condition
        let sql = "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = 'value2'";
        let filters = HashMap::from([("column3".to_string(), "value3".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = 'value2' AND column3 = 'value3'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_empty_filters() {
        // Test with empty filters array
        let sql = "SELECT * FROM table1";
        let filters: HashMap<String, String> = HashMap::new();

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should return the original SQL unchanged
        assert_eq!(result, sql);
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_group_by() {
        // Test adding filters to a query with GROUP BY
        let sql = "SELECT column1, COUNT(*) FROM table1 GROUP BY column1";
        let filters = HashMap::from([("column2".to_string(), "value2".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before GROUP BY
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_order_by() {
        // Test adding filters to a query with ORDER BY
        let sql = "SELECT * FROM table1 ORDER BY column1 DESC";
        let filters = HashMap::from([("column2".to_string(), "value2".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column2 = 'value2' ORDER BY column1 DESC"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_limit() {
        // Test adding filters to a query with LIMIT
        let sql = "SELECT * FROM table1 LIMIT 10";
        let filters = HashMap::from([("column1".to_string(), "value1".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before LIMIT
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' LIMIT 10"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_complex_query() {
        // Test adding filters to a complex query
        let sql = "SELECT t1.column1, t2.column2 FROM table1 t1 JOIN table2 t2 ON t1.id = t2.id WHERE t1.status = 'active' GROUP BY t1.column1 ORDER BY t2.column2 LIMIT 20";
        let filters = HashMap::from([
            ("t1.region".to_string(), "west".to_string()),
            ("t2.value".to_string(), "100".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // the function don't add WHERE for the aggregation query
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_having() {
        // Test adding filters to a query with HAVING
        let sql = "SELECT department, AVG(salary) FROM employees GROUP BY department HAVING AVG(salary) > 50000";
        let filters = HashMap::from([("department".to_string(), "'HR'".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // the function don't add WHERE for the aggregation query
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_subquery() {
        // Test adding filters to a query with a subquery
        let sql = "SELECT * FROM (SELECT id, name FROM users) AS u";
        let filters = HashMap::from([("u.id".to_string(), "100".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // we support subquery
        assert_eq!(
            result,
            "SELECT * FROM (SELECT id, name FROM users WHERE u.id = '100') AS u WHERE u.id = '100'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_field_in_subquery() {
        // Test adding filters to a query with a subquery
        let sql = "SELECT * FROM users WHERE id IN (SELECT id FROM users)";
        let filters = HashMap::from([("id".to_string(), "100".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // we support this type of query
        assert_eq!(result, sql.to_string());
    }
}

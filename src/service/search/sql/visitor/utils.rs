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

use std::{collections::HashSet, ops::ControlFlow};

use config::utils::sql::AGGREGATE_UDF_LIST;
use datafusion::sql::TableReference;
use sqlparser::ast::{Expr, GroupByExpr, Ident, Query, Statement, VisitMut, VisitorMut};

use crate::service::search::utils::trim_quotes;

pub struct FieldNameVisitor {
    pub field_names: HashSet<String>,
}

impl FieldNameVisitor {
    pub fn new() -> Self {
        Self {
            field_names: HashSet::new(),
        }
    }
}

impl VisitorMut for FieldNameVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Identifier(ident) = expr {
            self.field_names.insert(ident.value.clone());
        }
        ControlFlow::Continue(())
    }
}

pub fn is_complex_query(statement: &mut Statement) -> bool {
    let mut visitor = ComplexQueryVisitor::new();
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
// 7. has wildcard
struct ComplexQueryVisitor {
    pub is_complex: bool,
}

impl ComplexQueryVisitor {
    fn new() -> Self {
        Self { is_complex: false }
    }
}

impl VisitorMut for ComplexQueryVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        match query.body.as_ref() {
            sqlparser::ast::SetExpr::Select(select) => {
                // check if has group by
                match select.group_by {
                    GroupByExpr::Expressions(ref expr, _) => self.is_complex = !expr.is_empty(),
                    _ => self.is_complex = true,
                }
                // check if has join
                if select.from.len() > 1 || select.from.iter().any(|from| !from.joins.is_empty()) {
                    self.is_complex = true;
                }
                if select.distinct.is_some() {
                    self.is_complex = true;
                }
                if self.is_complex {
                    return ControlFlow::Break(());
                }
            }
            // check if SetOperation
            sqlparser::ast::SetExpr::SetOperation { .. } => {
                self.is_complex = true;
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
                self.is_complex = true;
            }
            // check if has aggregate function or window function
            Expr::Function(func) => {
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&func.name.to_string().to_lowercase()).as_str())
                    || func.filter.is_some()
                    || func.over.is_some()
                    || !func.within_group.is_empty()
                {
                    self.is_complex = true;
                }
            }
            // check select * from table
            Expr::Wildcard(_) => self.is_complex = true,
            _ => {}
        }
        if self.is_complex {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

pub fn generate_table_reference(idents: &[Ident]) -> (TableReference, String) {
    if idents.len() == 2 {
        let table_name = idents[0].value.as_str();
        let field_name = idents[1].value.clone();
        (TableReference::from(table_name), field_name)
    } else {
        let stream_type = idents[0].value.as_str();
        let table_name = idents[1].value.as_str();
        let field_name = idents[2].value.clone();
        (TableReference::partial(stream_type, table_name), field_name)
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{
        ast::{Statement, VisitMut},
        dialect::GenericDialect,
        parser::Parser,
    };

    use super::*;

    fn parse_stmt(sql: &str) -> Statement {
        Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap()
    }

    #[test]
    fn test_field_name_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut field_visitor = FieldNameVisitor::new();
        let _ = statement.visit(&mut field_visitor);

        assert!(field_visitor.field_names.contains("name"));
        assert!(field_visitor.field_names.contains("age"));
    }

    #[test]
    fn test_complex_query_visitor() {
        let sql = "SELECT * FROM users WHERE name IN (SELECT name FROM admins)";
        let mut statement = Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut complex_visitor = ComplexQueryVisitor::new();
        let _ = statement.visit(&mut complex_visitor);

        assert!(complex_visitor.is_complex);
    }

    #[test]
    fn test_is_complex_query_simple_select_is_not_complex() {
        let mut stmt = parse_stmt("SELECT a, b FROM t WHERE a = 1");
        assert!(!is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_group_by_is_complex() {
        let mut stmt = parse_stmt("SELECT a, count(a) FROM t GROUP BY a");
        assert!(is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_distinct_is_complex() {
        let mut stmt = parse_stmt("SELECT DISTINCT a FROM t");
        assert!(is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_union_is_complex() {
        let mut stmt = parse_stmt("SELECT a FROM t1 UNION SELECT a FROM t2");
        assert!(is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_subquery_is_complex() {
        let mut stmt = parse_stmt("SELECT a FROM t WHERE a IN (SELECT a FROM t2)");
        assert!(is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_join_is_complex() {
        let mut stmt = parse_stmt("SELECT a FROM t1 JOIN t2 ON t1.id = t2.id");
        assert!(is_complex_query(&mut stmt));
    }

    #[test]
    fn test_is_complex_query_multi_from_is_complex() {
        let mut stmt = parse_stmt("SELECT a FROM t1, t2 WHERE t1.id = t2.id");
        assert!(is_complex_query(&mut stmt));
    }
}

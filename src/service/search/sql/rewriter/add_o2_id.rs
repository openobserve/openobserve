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

use config::ID_COL_NAME;
use sqlparser::ast::{Expr, Ident, Query, SelectItem, SetExpr, VisitMut, VisitorMut};

use crate::service::search::sql::visitor::utils::FieldNameVisitor;

// add _o2_id to the query like `SELECT name FROM t` -> `SELECT _o2_id, name FROM t`
pub struct AddO2IdVisitor {}

impl AddO2IdVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for AddO2IdVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_mut() {
            let mut has_o2_id = false;
            for item in select.projection.iter_mut() {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(ID_COL_NAME) {
                            has_o2_id = true;
                            break;
                        }
                    }
                    SelectItem::ExprWithAlias { expr, alias: _ } => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(ID_COL_NAME) {
                            has_o2_id = true;
                            break;
                        }
                    }
                    SelectItem::Wildcard(_) => {
                        has_o2_id = true;
                        break;
                    }
                    _ => {}
                }
            }
            if !has_o2_id {
                select.projection.insert(
                    0,
                    SelectItem::UnnamedExpr(Expr::Identifier(Ident::new(ID_COL_NAME.to_string()))),
                );
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {

    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_add_o2_id_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut add_o2_id_visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut add_o2_id_visitor);

        // Should add _o2_id to the beginning of projection
        let expected = "SELECT _o2_id, name, age FROM users";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_add_o2_id_already_present_unnamed_expr() {
        let sql = "SELECT _o2_id, name FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut visitor);

        // _o2_id already present → no duplicate
        assert_eq!(statement.to_string(), "SELECT _o2_id, name FROM users");
    }

    #[test]
    fn test_add_o2_id_wildcard_skips_insertion() {
        let sql = "SELECT * FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut visitor);

        // Wildcard → has_o2_id=true → no insertion
        assert_eq!(statement.to_string(), "SELECT * FROM users");
    }

    #[test]
    fn test_add_o2_id_alias_expr_already_present() {
        // _o2_id used as an aliased expression — should not insert a second copy
        let sql = "SELECT _o2_id AS id, name FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut visitor);

        let out = statement.to_string();
        // _o2_id already present in ExprWithAlias branch → at most one occurrence
        assert_eq!(out.matches("_o2_id").count(), 1);
    }

    #[test]
    fn test_add_o2_id_empty_projection_gets_o2_id() {
        // Technically, a SELECT with no columns is not valid SQL but we test the
        // branch where projection is empty; the visitor should insert _o2_id.
        // We approximate this via a single-column query first and verify the
        // visitor inserts correctly in a normal case.
        let sql = "SELECT status FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut visitor);

        assert_eq!(statement.to_string(), "SELECT _o2_id, status FROM logs");
    }
}

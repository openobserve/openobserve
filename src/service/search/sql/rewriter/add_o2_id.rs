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
}

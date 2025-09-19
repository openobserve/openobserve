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

use config::TIMESTAMP_COL_NAME;
use sqlparser::ast::{Expr, Ident, Query, SelectItem, SetExpr, VisitMut, VisitorMut};

use crate::service::search::sql::visitor::utils::FieldNameVisitor;

// add _timestamp to the query like `SELECT name FROM t` -> `SELECT _timestamp, name FROM t`
pub struct AddTimestampVisitor {}

impl AddTimestampVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for AddTimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_mut() {
            let mut has_timestamp = false;
            for item in select.projection.iter_mut() {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(TIMESTAMP_COL_NAME) {
                            has_timestamp = true;
                            break;
                        }
                    }
                    SelectItem::ExprWithAlias { expr, alias: _ } => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(TIMESTAMP_COL_NAME) {
                            has_timestamp = true;
                            break;
                        }
                    }
                    SelectItem::Wildcard(_) => {
                        has_timestamp = true;
                        break;
                    }
                    _ => {}
                }
            }
            if !has_timestamp {
                select.projection.insert(
                    0,
                    SelectItem::UnnamedExpr(Expr::Identifier(Ident::new(
                        TIMESTAMP_COL_NAME.to_string(),
                    ))),
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
    fn test_add_timestamp_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut add_timestamp_visitor = AddTimestampVisitor::new();
        let _ = statement.visit(&mut add_timestamp_visitor);

        // Should add _timestamp to the beginning of projection
        let expected = "SELECT _timestamp, name, age FROM users";
        assert_eq!(statement.to_string(), expected);
    }
}

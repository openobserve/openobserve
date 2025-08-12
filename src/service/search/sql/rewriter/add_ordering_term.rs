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
use infra::errors::Error;
use sqlparser::{
    ast::{Expr, Ident, OrderByExpr, OrderByKind, Query, VisitMut, VisitorMut},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use crate::service::search::sql::visitor::utils::is_complex_query;

/// check if the sql is complex query, if not, add ordering term by timestamp
pub fn check_or_add_order_by_timestamp(sql: &str, is_asc: bool) -> infra::errors::Result<String> {
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    if is_complex_query(&mut statement) {
        return Ok(sql.to_string());
    }
    let mut visitor = AddOrderingTermVisitor::new(TIMESTAMP_COL_NAME.to_string(), is_asc);
    let _ = statement.visit(&mut visitor);
    Ok(statement.to_string())
}

struct AddOrderingTermVisitor {
    field: String,
    is_asc: bool,
}

impl AddOrderingTermVisitor {
    fn new(field: String, is_asc: bool) -> Self {
        Self { field, is_asc }
    }
}

impl VisitorMut for AddOrderingTermVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if query.order_by.is_none() {
            query.order_by = Some(sqlparser::ast::OrderBy {
                kind: OrderByKind::Expressions(vec![OrderByExpr {
                    expr: Expr::Identifier(Ident::new(self.field.clone())),
                    with_fill: None,
                    options: sqlparser::ast::OrderByOptions {
                        asc: Some(self.is_asc),
                        nulls_first: None,
                    },
                }]),
                interpolate: None,
            });
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_add_ordering_term_visitor() {
        let sql = "SELECT * FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut ordering_visitor = AddOrderingTermVisitor::new("name".to_string(), true);
        let _ = statement.visit(&mut ordering_visitor);

        // Should add ORDER BY clause
        let expected = "SELECT * FROM users ORDER BY name ASC";
        assert_eq!(statement.to_string(), expected);
    }
}

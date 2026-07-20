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

use datafusion::sql::TableReference;
use sqlparser::ast::{Expr, Ident, VisitorMut};

pub struct FieldNameVisitor {
    pub field_names: HashSet<String>,
}

impl Default for FieldNameVisitor {
    fn default() -> Self {
        Self::new()
    }
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
    use sqlparser::{ast::VisitMut, dialect::GenericDialect, parser::Parser};

    use super::*;

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
}

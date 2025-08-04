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

use std::{ops::ControlFlow, sync::Arc};

use datafusion::common::TableReference;
use hashbrown::HashMap;
use infra::schema::SchemaCache;
use sqlparser::ast::{Expr, Query, VisitorMut};

use crate::service::search::{
    sql::visitor::utils::generate_table_reference,
    utils::{split_conjunction, trim_quotes},
};

/// get all equal items from where clause
pub struct PrefixColumnVisitor<'a> {
    pub prefix_items: HashMap<TableReference, Vec<(String, String)>>, // filed like 'value%'
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
}

impl<'a> PrefixColumnVisitor<'a> {
    pub fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            prefix_items: HashMap::new(),
            schemas,
        }
    }
}

impl VisitorMut for PrefixColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref()
            && let Some(expr) = select.selection.as_ref()
        {
            let exprs = split_conjunction(expr);
            for e in exprs {
                if let Expr::Like {
                    negated: false,
                    expr,
                    pattern,
                    escape_char: _,
                    any: _,
                } = e
                {
                    match expr.as_ref() {
                        Expr::Identifier(ident) => {
                            let mut count = 0;
                            let field_name = ident.value.clone();
                            let mut table_name = "".to_string();
                            for (name, schema) in self.schemas.iter() {
                                if schema.contains_field(&field_name) {
                                    count += 1;
                                    table_name = name.to_string();
                                }
                            }
                            if count == 1 {
                                let pattern = trim_quotes(pattern.to_string().as_str());
                                if !pattern.starts_with('%') && pattern.ends_with('%') {
                                    self.prefix_items
                                        .entry(TableReference::from(table_name))
                                        .or_default()
                                        .push((
                                            field_name,
                                            pattern.trim_end_matches('%').to_string(),
                                        ));
                                }
                            }
                        }
                        Expr::CompoundIdentifier(idents) => {
                            let (table_name, field_name) = generate_table_reference(idents);
                            // check if table_name is in schemas, otherwise the table_name
                            // maybe is a alias
                            if self.schemas.contains_key(&table_name) {
                                let pattern = trim_quotes(pattern.to_string().as_str());
                                if !pattern.starts_with('%') && pattern.ends_with('%') {
                                    self.prefix_items.entry(table_name).or_default().push((
                                        field_name,
                                        pattern.trim_end_matches('%').to_string(),
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;
    #[test]
    fn test_prefix_column_visitor() {
        let sql = "SELECT * FROM users WHERE name LIKE 'john%' AND email LIKE 'test%'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("email", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut prefix_visitor = PrefixColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut prefix_visitor);

        // Should extract prefix patterns
        let users_table = TableReference::from("users");
        assert!(prefix_visitor.prefix_items.contains_key(&users_table));
        let items = &prefix_visitor.prefix_items[&users_table];
        assert!(items.contains(&("name".to_string(), "john".to_string())));
        assert!(items.contains(&("email".to_string(), "test".to_string())));
    }
}

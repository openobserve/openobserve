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
use sqlparser::ast::{BinaryOperator, Expr, Query, VisitorMut};

use crate::service::search::{
    sql::visitor::utils::generate_table_reference,
    utils::{is_field, is_value, split_conjunction, trim_quotes},
};

/// get all equal items from where clause
pub struct PartitionColumnVisitor<'a> {
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>, // filed = value
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
}

impl<'a> PartitionColumnVisitor<'a> {
    pub fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            equal_items: HashMap::new(),
            schemas,
        }
    }
}

impl VisitorMut for PartitionColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref()
            && let Some(expr) = select.selection.as_ref()
        {
            let exprs = split_conjunction(expr);
            for e in exprs {
                match e {
                    Expr::BinaryOp {
                        left,
                        op: BinaryOperator::Eq,
                        right,
                    } => {
                        let (left, right) = if is_value(left) && is_field(right) {
                            (right, left)
                        } else if is_value(right) && is_field(left) {
                            (left, right)
                        } else {
                            continue;
                        };
                        match left.as_ref() {
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
                                    self.equal_items
                                        .entry(TableReference::from(table_name))
                                        .or_default()
                                        .push((
                                            field_name,
                                            trim_quotes(right.to_string().as_str()),
                                        ));
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                // check if table_name is in schemas, otherwise the table_name
                                // maybe is a alias
                                if self.schemas.contains_key(&table_name) {
                                    self.equal_items.entry(table_name).or_default().push((
                                        field_name,
                                        trim_quotes(right.to_string().as_str()),
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                    Expr::InList {
                        expr,
                        list,
                        negated: false,
                    } => {
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
                                    let entry = self
                                        .equal_items
                                        .entry(TableReference::from(table_name))
                                        .or_default();
                                    for val in list.iter() {
                                        entry.push((
                                            field_name.clone(),
                                            trim_quotes(val.to_string().as_str()),
                                        ));
                                    }
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                // check if table_name is in schemas, otherwise the table_name
                                // maybe is a alias
                                if self.schemas.contains_key(&table_name) {
                                    let entry = self.equal_items.entry(table_name).or_default();
                                    for val in list.iter() {
                                        entry.push((
                                            field_name.clone(),
                                            trim_quotes(val.to_string().as_str()),
                                        ));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
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
    fn test_partition_column_visitor() {
        let sql = "SELECT * FROM users WHERE name = 'john' AND age = 25 AND city IN ('NYC', 'LA')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("city", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut partition_visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut partition_visitor);

        // Should extract equal conditions and IN list values
        let users_table = TableReference::from("users");
        assert!(partition_visitor.equal_items.contains_key(&users_table));
        let items = &partition_visitor.equal_items[&users_table];
        assert!(items.contains(&("name".to_string(), "john".to_string())));
        assert!(items.contains(&("age".to_string(), "25".to_string())));
        assert!(items.contains(&("city".to_string(), "NYC".to_string())));
        assert!(items.contains(&("city".to_string(), "LA".to_string())));
    }
}

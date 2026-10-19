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

use std::{ops::ControlFlow, sync::Arc};

use config::utils::sql::is_complex_query_stmt;
use datafusion::common::TableReference;
use hashbrown::HashMap;
use infra::schema::SchemaCache;
use sqlparser::ast::{
    BinaryOperator, Expr, Query, SetExpr, Statement, TableFactor, Value, VisitorMut,
};

use crate::{
    sql::visitor::utils::generate_table_reference,
    utils::{is_field, is_value, split_conjunction},
};

pub struct PartitionColumnVisitor<'a> {
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>,
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
    query_visited: bool,
}

impl<'a> PartitionColumnVisitor<'a> {
    pub fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            equal_items: HashMap::new(),
            schemas,
            query_visited: false,
        }
    }
}

impl VisitorMut for PartitionColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_statement(&mut self, statement: &mut Statement) -> ControlFlow<Self::Break> {
        if !can_prune_partitions(statement) {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if self.query_visited {
            self.equal_items.clear();
            return ControlFlow::Break(());
        }
        self.query_visited = true;
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
                        let Some(value) = partition_value(right) else {
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
                                        .push((field_name, value));
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                if self.schemas.contains_key(&table_name) {
                                    self.equal_items
                                        .entry(table_name)
                                        .or_default()
                                        .push((field_name, value));
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
                        let Some(values) =
                            list.iter().map(partition_value).collect::<Option<Vec<_>>>()
                        else {
                            continue;
                        };
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
                                    for value in values {
                                        entry.push((field_name.clone(), value));
                                    }
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                if self.schemas.contains_key(&table_name) {
                                    let entry = self.equal_items.entry(table_name).or_default();
                                    for value in values {
                                        entry.push((field_name.clone(), value));
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

fn can_prune_partitions(statement: &Statement) -> bool {
    let Statement::Query(query) = statement else {
        return false;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return false;
    };
    select.from.len() == 1
        && select.from[0].joins.is_empty()
        && matches!(
            select.from[0].relation,
            TableFactor::Table {
                alias: None,
                args: None,
                ..
            }
        )
        && !is_complex_query_stmt(statement)
}

fn partition_value(expr: &Expr) -> Option<String> {
    let Expr::Value(value) = expr else {
        return None;
    };
    match &value.value {
        Value::SingleQuotedString(value) | Value::Number(value, _) => Some(value.clone()),
        Value::Boolean(value) => Some(value.to_string()),
        _ => None,
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

        let users_table = TableReference::from("users");
        assert!(partition_visitor.equal_items.contains_key(&users_table));
        let items = &partition_visitor.equal_items[&users_table];
        assert!(items.contains(&("name".to_string(), "john".to_string())));
        assert!(items.contains(&("age".to_string(), "25".to_string())));
        assert!(items.contains(&("city".to_string(), "NYC".to_string())));
        assert!(items.contains(&("city".to_string(), "LA".to_string())));
    }

    fn make_schemas() -> HashMap<TableReference, Arc<SchemaCache>> {
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
        schemas
    }

    #[test]
    fn test_partition_visitor_value_on_left_side() {
        let sql = "SELECT * FROM users WHERE 'john' = name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        let users_table = TableReference::from("users");
        let items = visitor.equal_items.get(&users_table).unwrap();
        assert!(items.contains(&("name".to_string(), "john".to_string())));
    }

    #[test]
    fn test_partition_visitor_no_where_clause() {
        let sql = "SELECT * FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_column_not_in_schema_ignored() {
        let sql = "SELECT * FROM users WHERE unknown_col = 'x'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        let users_table = TableReference::from("users");
        let items = visitor.equal_items.get(&users_table);
        assert!(items.is_none_or(|v| v.is_empty()));
    }

    #[test]
    fn test_partition_visitor_negated_in_list_ignored() {
        let sql = "SELECT * FROM users WHERE city NOT IN ('NYC', 'LA')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_compound_identifier_eq() {
        let sql = "SELECT * FROM users WHERE users.name = 'alice'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        let users_table = TableReference::from("users");
        let items = visitor.equal_items.get(&users_table).unwrap();
        assert!(items.contains(&("name".to_string(), "alice".to_string())));
    }

    #[test]
    fn test_partition_visitor_compound_identifier_eq_unknown_table_ignored() {
        let sql = "SELECT * FROM users WHERE other.name = 'alice'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_compound_identifier_in_list() {
        let sql = "SELECT * FROM users WHERE users.city IN ('NYC', 'LA')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        let users_table = TableReference::from("users");
        let items = visitor.equal_items.get(&users_table).unwrap();
        assert!(items.contains(&("city".to_string(), "NYC".to_string())));
        assert!(items.contains(&("city".to_string(), "LA".to_string())));
    }

    #[test]
    fn test_partition_visitor_ambiguous_field_in_multiple_tables_ignored() {
        let sql = "SELECT * FROM users WHERE name = 'alice'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema1 = Schema::new(vec![Arc::new(Field::new("name", DataType::Utf8, false))]);
        let schema2 = Schema::new(vec![Arc::new(Field::new("name", DataType::Utf8, false))]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema1)),
        );
        schemas.insert(
            TableReference::from("accounts"),
            Arc::new(SchemaCache::new(schema2)),
        );

        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_disables_complex_queries() {
        for sql in [
            "SELECT name FROM users WHERE name = 'john' AND city IN (SELECT city FROM users)",
            "SELECT name, (SELECT city FROM users LIMIT 1) FROM users WHERE name = 'john'",
            "WITH u AS (SELECT * FROM users WHERE name = 'john') SELECT * FROM u",
            "SELECT * FROM (SELECT * FROM users WHERE name = 'john') u",
            "SELECT * FROM users JOIN users AS u ON users.name = u.name WHERE users.name = 'john'",
            "SELECT * FROM users, users AS u WHERE users.name = 'john'",
            "SELECT name FROM users WHERE name = 'john' UNION ALL SELECT name FROM users",
            "SELECT name FROM users WHERE name = 'john' EXCEPT SELECT name FROM users",
            "SELECT name FROM users WHERE name = 'john' INTERSECT SELECT name FROM users",
            "SELECT count(*) FROM users WHERE name = 'john'",
            "SELECT city FROM users WHERE name = 'john' GROUP BY city",
            "SELECT DISTINCT city FROM users WHERE name = 'john'",
            "SELECT row_number() OVER () FROM users WHERE name = 'john'",
            "SELECT name FROM users WHERE name = 'john' ORDER BY (SELECT max(age) FROM users)",
            "SELECT ARRAY(SELECT city FROM users) FROM users WHERE name = 'john'",
        ] {
            assert!(partition_items(sql).is_empty(), "{sql}");
        }
    }

    #[test]
    fn test_partition_visitor_disables_aliased_and_non_table_reads() {
        for sql in [
            "SELECT * FROM users AS u WHERE name = 'john'",
            "SELECT * FROM users AS u WHERE u.name = 'john'",
            "SELECT * FROM users AS users WHERE users.name = 'john'",
            "SELECT * FROM users() WHERE name = 'john'",
            "(SELECT * FROM users WHERE name = 'john')",
        ] {
            assert!(partition_items(sql).is_empty(), "{sql}");
        }
    }

    #[test]
    fn test_partition_visitor_rejects_entire_nonliteral_in_lists() {
        for sql in [
            "SELECT * FROM users WHERE city IN (city)",
            "SELECT * FROM users WHERE city IN ('NYC', city)",
            "SELECT * FROM users WHERE users.city IN ('NYC', users.city)",
            "SELECT * FROM users WHERE city IN (upper('nyc'))",
            "SELECT * FROM users WHERE city IN ('NYC', upper('la'))",
            "SELECT * FROM users WHERE city IN ($1)",
            "SELECT * FROM users WHERE city IN ('NYC', NULL)",
            "SELECT * FROM users WHERE name = $1",
        ] {
            assert!(partition_items(sql).is_empty(), "{sql}");
        }
    }

    #[test]
    fn test_partition_visitor_keeps_independent_literal_predicates() {
        assert_eq!(
            partition_items("SELECT * FROM users WHERE name = 'john' AND city IN ('NYC', city)"),
            vec![("name".to_string(), "john".to_string())]
        );
    }

    #[test]
    fn test_partition_visitor_decodes_string_literals() {
        assert_eq!(
            partition_items(
                "SELECT * FROM users WHERE name = 'O''Reilly' AND city IN ('N''Y', 'LA')"
            ),
            vec![
                ("city".to_string(), "LA".to_string()),
                ("city".to_string(), "N'Y".to_string()),
                ("name".to_string(), "O'Reilly".to_string()),
            ]
        );
    }

    #[test]
    fn test_partition_visitor_ignores_or_and_negated_predicates() {
        for sql in [
            "SELECT * FROM users WHERE name = 'john' OR city = 'NYC'",
            "SELECT * FROM users WHERE NOT (name = 'john')",
        ] {
            assert!(partition_items(sql).is_empty(), "{sql}");
        }
        assert_eq!(
            partition_items(
                "SELECT * FROM users WHERE name = 'john' AND (age = 25 OR city = 'NYC')"
            ),
            vec![("name".to_string(), "john".to_string())]
        );
    }

    fn partition_items(sql: &str) -> Vec<(String, String)> {
        let mut statement =
            sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::PostgreSqlDialect {}, sql)
                .unwrap()
                .pop()
                .unwrap();
        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);
        let mut items = visitor
            .equal_items
            .remove(&TableReference::from("users"))
            .unwrap_or_default();
        items.sort();
        items
    }
}

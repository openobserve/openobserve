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

use datafusion::common::TableReference;
use hashbrown::HashMap;
use infra::schema::SchemaCache;
use sqlparser::ast::{
    BinaryOperator, Expr, Query, SetExpr, Statement, TableFactor, UnaryOperator, Value, VisitorMut,
};

use crate::{
    sql::visitor::utils::generate_table_reference,
    utils::{is_field, split_conjunction},
};

/// get all equal items from where clause
pub struct PartitionColumnVisitor<'a> {
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>, // filed = value
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

    fn resolve_field(&self, expr: &Expr) -> Option<(TableReference, String)> {
        match expr {
            Expr::Identifier(ident) => {
                let field_name = ident.value.clone();
                let mut tables = self
                    .schemas
                    .iter()
                    .filter(|(_, schema)| schema.contains_field(&field_name));
                let (table_name, _) = tables.next()?;
                tables
                    .next()
                    .is_none()
                    .then(|| (TableReference::from(table_name.to_string()), field_name))
            }
            Expr::CompoundIdentifier(idents) => {
                let (table_name, field_name) = generate_table_reference(idents);
                // check if table_name is in schemas, otherwise the table_name
                // maybe is a alias
                self.schemas
                    .contains_key(&table_name)
                    .then_some((table_name, field_name))
            }
            _ => None,
        }
    }
}

impl VisitorMut for PartitionColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_statement(&mut self, statement: &mut Statement) -> ControlFlow<Self::Break> {
        if !reads_single_table(statement) {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // A nested query may read the same stream without the top-level filters.
        if self.query_visited {
            self.equal_items.clear();
            return ControlFlow::Break(());
        }
        self.query_visited = true;
        let SetExpr::Select(select) = query.body.as_ref() else {
            return ControlFlow::Continue(());
        };
        let Some(selection) = select.selection.as_ref() else {
            return ControlFlow::Continue(());
        };
        for e in split_conjunction(selection) {
            let (field, values) = match e {
                Expr::BinaryOp {
                    left,
                    op: BinaryOperator::Eq,
                    right,
                } => {
                    let (field, value) = if is_field(left) {
                        (left, right)
                    } else {
                        (right, left)
                    };
                    let Some(value) = partition_value(value) else {
                        continue;
                    };
                    (field, vec![value])
                }
                Expr::InList {
                    expr,
                    list,
                    negated: false,
                } => {
                    let Some(values) = list.iter().map(partition_value).collect::<Option<Vec<_>>>()
                    else {
                        continue;
                    };
                    (expr, values)
                }
                _ => continue,
            };
            let Some((table_name, field_name)) = self.resolve_field(field) else {
                continue;
            };
            self.equal_items
                .entry(table_name)
                .or_default()
                .extend(values.into_iter().map(|value| (field_name.clone(), value)));
        }
        ControlFlow::Continue(())
    }
}

fn reads_single_table(statement: &Statement) -> bool {
    let Statement::Query(query) = statement else {
        return false;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return false;
    };
    query.with.is_none()
        && select.from.len() == 1
        && select.from[0].joins.is_empty()
        && matches!(
            select.from[0].relation,
            TableFactor::Table {
                alias: None,
                args: None,
                ..
            }
        )
}

fn partition_value(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Value(value) => match &value.value {
            Value::SingleQuotedString(value) | Value::Number(value, _) => Some(value.clone()),
            Value::Boolean(value) => Some(value.to_string()),
            _ => None,
        },
        Expr::UnaryOp {
            op: UnaryOperator::Minus,
            expr,
        } => match expr.as_ref() {
            Expr::Value(value) => match &value.value {
                Value::Number(value, _) => Some(format!("-{value}")),
                _ => None,
            },
            _ => None,
        },
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

        // Should extract equal conditions and IN list values
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
        // value = field (value on left) — should be swapped to field = value
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

        // unknown_col not in schema → should not be added
        let users_table = TableReference::from("users");
        let items = visitor.equal_items.get(&users_table);
        assert!(items.is_none_or(|v| v.is_empty()));
    }

    #[test]
    fn test_partition_visitor_negated_in_list_ignored() {
        // NOT IN should NOT be captured
        let sql = "SELECT * FROM users WHERE city NOT IN ('NYC', 'LA')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        // NOT IN → negated=true branch → not captured
        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_compound_identifier_eq() {
        // table.field = 'value' → CompoundIdentifier branch on the left side
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
        // unknown.field = 'value' → CompoundIdentifier, table not in schemas → ignored
        let sql = "SELECT * FROM users WHERE other.name = 'alice'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        // 'other' table not in schemas → nothing captured
        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_compound_identifier_in_list() {
        // table.field IN (...) → CompoundIdentifier branch in InList
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
        // field exists in 2 tables → count > 1 → ignored (no partition capture)
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

        // count == 2 (both tables have 'name') → not captured
        assert!(visitor.equal_items.is_empty());
    }

    #[test]
    fn test_partition_visitor_disables_multi_read_queries() {
        for sql in [
            "SELECT name FROM users WHERE name = 'john' AND city IN (SELECT city FROM users)",
            "SELECT name FROM users WHERE name = 'john' AND EXISTS (SELECT 1 FROM users)",
            "SELECT name, (SELECT city FROM users LIMIT 1) FROM users WHERE name = 'john'",
            "WITH u AS (SELECT * FROM users WHERE name = 'john') SELECT * FROM u",
            "WITH u AS (SELECT * FROM users) SELECT * FROM users WHERE name = 'john'",
            "SELECT * FROM (SELECT * FROM users WHERE name = 'john') u",
            "SELECT * FROM users JOIN users AS u ON users.name = u.name WHERE users.name = 'john'",
            "SELECT * FROM users, users AS u WHERE users.name = 'john'",
            "SELECT name FROM users WHERE name = 'john' UNION ALL SELECT name FROM users",
            "SELECT name FROM users WHERE name = 'john' EXCEPT SELECT name FROM users",
            "SELECT name FROM users WHERE name = 'john' INTERSECT SELECT name FROM users",
            "SELECT count(*) FROM users WHERE name = 'john' HAVING count(*) > (SELECT 1)",
            "SELECT name FROM users WHERE name = 'john' ORDER BY (SELECT max(age) FROM users)",
            "SELECT ARRAY(SELECT city FROM users) FROM users WHERE name = 'john'",
        ] {
            assert!(partition_items(sql).is_empty(), "{sql}");
        }
    }

    #[test]
    fn test_partition_visitor_keeps_single_read_aggregates() {
        for sql in [
            "SELECT count(*) FROM users WHERE name = 'john'",
            "SELECT city, count(*) FROM users WHERE name = 'john' GROUP BY city",
            "SELECT city FROM users WHERE name = 'john' GROUP BY city HAVING count(*) > 1",
            "SELECT DISTINCT city FROM users WHERE name = 'john'",
            "SELECT row_number() OVER () FROM users WHERE name = 'john'",
            "SELECT count(*) FILTER (WHERE city = 'NYC') FROM users WHERE name = 'john'",
        ] {
            assert_eq!(
                partition_items(sql),
                vec![("name".to_string(), "john".to_string())],
                "{sql}"
            );
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
    fn test_partition_visitor_accepts_negative_numbers() {
        assert_eq!(
            partition_items("SELECT * FROM users WHERE age = -1 AND city IN ('NYC')"),
            vec![
                ("age".to_string(), "-1".to_string()),
                ("city".to_string(), "NYC".to_string()),
            ]
        );
        assert_eq!(
            partition_items("SELECT * FROM users WHERE age IN (-1, 0)"),
            vec![
                ("age".to_string(), "-1".to_string()),
                ("age".to_string(), "0".to_string()),
            ]
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

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

use datafusion::{common::TableReference, sql::planner::object_name_to_table_reference};
use hashbrown::{HashMap, HashSet};
use infra::schema::SchemaCache;
use sqlparser::ast::{BinaryOperator, Expr, Query, SetExpr, TableFactor, VisitorMut};

use crate::{
    sql::visitor::utils::generate_table_reference,
    utils::{is_field, is_value, split_conjunction, trim_quotes},
};

/// get the equal items from where clause that hold for every read of a stream
pub struct PartitionColumnVisitor<'a> {
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>, // filed = value
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
    // per stream and read: only the WHERE of the SELECT that reads it filters that read
    reads: HashMap<TableReference, Vec<Vec<(String, String)>>>,
    // the reads are all known only once the outermost query has been visited
    depth: usize,
}

impl<'a> PartitionColumnVisitor<'a> {
    pub fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            equal_items: HashMap::new(),
            schemas,
            reads: HashMap::new(),
            depth: 0,
        }
    }
}

impl VisitorMut for PartitionColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        self.depth += 1;
        let mut bodies = vec![query.body.as_ref()];
        while let Some(body) = bodies.pop() {
            let select = match body {
                SetExpr::Select(select) => select,
                SetExpr::SetOperation { left, right, .. } => {
                    bodies.push(left.as_ref());
                    bodies.push(right.as_ref());
                    continue;
                }
                // a parenthesized query is visited as a query of its own
                _ => continue,
            };
            // the streams this SELECT reads itself; a derived table or CTE is a query of its own
            let mut from: HashMap<TableReference, usize> = HashMap::new();
            let mut factors = Vec::new();
            for table in &select.from {
                factors.push(&table.relation);
                factors.extend(table.joins.iter().map(|join| &join.relation));
            }
            while let Some(factor) = factors.pop() {
                match factor {
                    TableFactor::Table { name, .. } => {
                        if let Ok(table) = object_name_to_table_reference(name.clone(), true)
                            && self.schemas.contains_key(&table)
                        {
                            *from.entry(table).or_insert(0) += 1;
                        }
                    }
                    TableFactor::NestedJoin {
                        table_with_joins, ..
                    } => {
                        factors.push(&table_with_joins.relation);
                        factors.extend(table_with_joins.joins.iter().map(|join| &join.relation));
                    }
                    _ => {}
                }
            }
            let mut equal_items: HashMap<TableReference, Vec<(String, String)>> = HashMap::new();
            let exprs = select
                .selection
                .as_ref()
                .map(split_conjunction)
                .unwrap_or_default();
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
                                    equal_items
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
                                    equal_items.entry(table_name).or_default().push((
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
                                    let entry = equal_items
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
                                    let entry = equal_items.entry(table_name).or_default();
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
            for (table, count) in from {
                let reads = self.reads.entry(table.clone()).or_default();
                // a filter can't be tied to one of two reads of a stream in the same FROM
                if count == 1 {
                    reads.push(equal_items.remove(&table).unwrap_or_default());
                } else {
                    reads.extend((0..count).map(|_| Vec::new()));
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &mut Query) -> ControlFlow<Self::Break> {
        self.depth -= 1;
        if self.depth > 0 {
            return ControlFlow::Continue(());
        }
        for (table, reads) in self.reads.drain() {
            // a field prunes only when every read of the stream filters it, by all their values
            let mut reads_per_field: HashMap<&str, usize> = HashMap::new();
            for read in &reads {
                let fields: HashSet<&str> = read.iter().map(|(field, _)| field.as_str()).collect();
                for field in fields {
                    *reads_per_field.entry(field).or_insert(0) += 1;
                }
            }
            let mut seen = HashSet::new();
            let items: Vec<(String, String)> = reads
                .iter()
                .flatten()
                .filter(|(field, _)| reads_per_field.get(field.as_str()) == Some(&reads.len()))
                .filter(|item| seen.insert(*item))
                .cloned()
                .collect();
            if !items.is_empty() {
                self.equal_items.insert(table, items);
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

    /// The sorted equal items kept for `part` (pk, msg) in a query that may also read `other`.
    fn part_items(sql: &str) -> Option<Vec<(String, String)>> {
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut schemas = HashMap::new();
        for (name, fields) in [("part", ["pk", "msg"]), ("other", ["k", "note"])] {
            let fields = fields.map(|f| Arc::new(Field::new(f, DataType::Utf8, false)));
            schemas.insert(
                TableReference::from(name),
                Arc::new(SchemaCache::new(Schema::new(fields.to_vec()))),
            );
        }
        let mut visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);
        let mut items = visitor.equal_items.remove(&TableReference::from("part"))?;
        items.sort();
        Some(items)
    }

    #[test]
    fn test_partition_visitor_keeps_no_filter_when_a_read_of_the_stream_has_none() {
        for sql in [
            "SELECT count(*) FROM part WHERE msg IN (SELECT msg FROM part WHERE pk = 'a')",
            "WITH a AS (SELECT msg FROM part WHERE pk = 'a') \
             SELECT count(*) FROM part WHERE msg IN (SELECT msg FROM a)",
            "SELECT count(*), (SELECT count(*) FROM part WHERE pk = 'a') FROM part",
            "SELECT msg FROM part WHERE pk = 'a' UNION ALL SELECT msg FROM part",
            "SELECT count(*) FROM part JOIN part AS p2 ON part.msg = p2.msg WHERE part.pk = 'a'",
            "SELECT count(*) FROM (other JOIN part ON other.note = part.msg) \
             WHERE msg IN (SELECT msg FROM part WHERE pk = 'a')",
            "SELECT count(*) FROM other WHERE note IN (SELECT msg FROM part WHERE pk = 'a') \
             AND k IN (SELECT msg FROM part)",
        ] {
            assert_eq!(part_items(sql), None, "{sql}");
        }
    }

    #[test]
    fn test_partition_visitor_ignores_a_filter_outside_the_select_that_reads_the_stream() {
        // the outer pk is an aggregate's alias; a negated correlated filter keeps the other rows
        for sql in [
            "SELECT count(*) FROM (SELECT msg, max(pk) AS pk FROM part WHERE msg = 'x' GROUP BY msg) t \
             WHERE pk = 'a'",
            "SELECT count(*) FROM part WHERE msg = 'x' \
             AND NOT EXISTS (SELECT 1 FROM other WHERE part.pk = 'a')",
        ] {
            assert_eq!(
                part_items(sql),
                Some(vec![("msg".to_string(), "x".to_string())]),
                "{sql}"
            );
        }
    }

    #[test]
    fn test_partition_visitor_keeps_the_filter_every_read_of_the_stream_has() {
        let a = ("pk".to_string(), "a".to_string());
        let b = ("pk".to_string(), "b".to_string());
        for sql in [
            "SELECT count(*) FROM other WHERE note IN (SELECT msg FROM part WHERE pk = 'a')",
            "WITH a AS (SELECT msg FROM part WHERE pk = 'a') SELECT count(*) FROM a",
            "SELECT count(*) FROM (SELECT msg FROM part WHERE pk = 'a') t",
        ] {
            assert_eq!(part_items(sql), Some(vec![a.clone()]), "{sql}");
        }
        // both reads filter pk, so the files of either value are read; only one filters msg
        assert_eq!(
            part_items(
                "SELECT count(*) FROM part WHERE pk = 'b' AND msg = 'x' \
                 AND msg IN (SELECT msg FROM part WHERE pk = 'a')"
            ),
            Some(vec![a.clone(), b.clone()])
        );
        assert_eq!(
            part_items(
                "SELECT msg FROM part WHERE pk = 'a' \
                 UNION ALL SELECT msg FROM part WHERE pk IN ('a', 'b')"
            ),
            Some(vec![a, b])
        );
    }
}

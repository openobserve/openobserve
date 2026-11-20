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

use config::{meta::sql::OrderBy, utils::sql::AGGREGATE_UDF_LIST};
use datafusion::common::TableReference;
use hashbrown::{HashMap, HashSet};
use infra::schema::SchemaCache;
use sqlparser::ast::{
    Expr, GroupByExpr, OrderByKind, Query, SelectItem, SetExpr, Value, ValueWithSpan, VisitMut,
    VisitorMut,
};

use crate::{sql::visitor::utils::FieldNameVisitor, utils::trim_quotes};

/// visit a sql to get all columns
pub struct ColumnVisitor<'a> {
    pub columns: HashMap<TableReference, HashSet<String>>,
    pub columns_alias: HashSet<(String, String)>,
    pub schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
    pub group_by: Vec<String>,
    pub order_by: Vec<(String, OrderBy)>, // field_name, order_by
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub is_wildcard: bool,
    pub is_distinct: bool,
    pub has_agg_function: bool,
    outer_query_visited: bool,
}

impl<'a> ColumnVisitor<'a> {
    pub fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            columns: HashMap::new(),
            columns_alias: HashSet::new(),
            schemas,
            group_by: Vec::new(),
            order_by: Vec::new(),
            offset: None,
            limit: None,
            is_wildcard: false,
            is_distinct: false,
            has_agg_function: false,
            outer_query_visited: false,
        }
    }
}

impl VisitorMut for ColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Identifier(ident) => {
                let field_name = ident.value.clone();
                for (name, schema) in self.schemas.iter() {
                    if schema.contains_field(&field_name) {
                        self.columns
                            .entry(name.clone())
                            .or_default()
                            .insert(field_name.clone());
                    }
                }
            }
            Expr::CompoundIdentifier(idents) => {
                let name = idents
                    .iter()
                    .map(|ident| ident.value.clone())
                    .collect::<Vec<_>>();
                let field_name = name.last().unwrap().clone();
                // check if table_name is in schemas, otherwise the table_name maybe is a alias
                for (name, schema) in self.schemas.iter() {
                    if schema.contains_field(&field_name) {
                        self.columns
                            .entry(name.clone())
                            .or_default()
                            .insert(field_name.clone());
                    }
                }
            }
            Expr::Function(f)
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&f.name.to_string().to_lowercase()).as_str()) =>
            {
                self.has_agg_function = true;
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        let projection: &[SelectItem] = match query.body.as_ref() {
            SetExpr::Select(select) => &select.projection,
            _ => &[],
        };
        if let Some(order_by) = query.order_by.as_ref()
            && let OrderByKind::Expressions(exprs) = &order_by.kind
        {
            for order in exprs {
                self.order_by.push((
                    order_by_key_name(&order.expr, projection),
                    if order.options.asc.unwrap_or(true) {
                        OrderBy::Asc
                    } else {
                        OrderBy::Desc
                    },
                ));
            }
        }
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_mut() {
            for select_item in select.projection.iter_mut() {
                match select_item {
                    SelectItem::ExprWithAlias { expr, alias } => {
                        self.columns_alias
                            .insert((expr.to_string(), alias.value.to_string()));
                    }
                    SelectItem::Wildcard(_) => {
                        self.is_wildcard = true;
                    }
                    _ => {}
                }
            }
            if let GroupByExpr::Expressions(exprs, _) = &mut select.group_by {
                for expr in exprs.iter_mut() {
                    let mut name_visitor = FieldNameVisitor::new();
                    let _ = expr.visit(&mut name_visitor);
                    if name_visitor.field_names.len() == 1 {
                        let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                        self.group_by.push(expr_name);
                    }
                }
            }
            if select.distinct.is_some() {
                self.is_distinct = true;
            }
        } else if let sqlparser::ast::SetExpr::SetOperation { left, right, .. } =
            query.body.as_mut()
            && (has_wildcard(left) || has_wildcard(right))
        {
            self.is_wildcard = true;
        }
        // Only the outermost LIMIT bounds the result, not a CTE, subquery or set-op branch's.
        let is_outermost = !self.outer_query_visited;
        self.outer_query_visited = true;
        let mut has_limit = false;
        if is_outermost
            && let Some(limit_clause) = query.limit_clause.as_ref()
            && let sqlparser::ast::LimitClause::LimitOffset { limit, offset, .. } = limit_clause
        {
            if let Some(limit) = limit.as_ref()
                && let Expr::Value(ValueWithSpan { value, span: _ }) = limit
                && let Value::Number(n, _) = value
                && let Ok(num) = n.to_string().parse::<i64>()
            {
                has_limit = true;
                self.limit = Some(num);
            }
            if let Some(offset) = offset.as_ref()
                && let Expr::Value(ValueWithSpan { value, span: _ }) = &offset.value
                && let Value::Number(n, _) = value
                && let Ok(num) = n.to_string().parse::<i64>()
            {
                self.offset = Some(num);
            }
        }
        if has_limit && self.offset.is_none() {
            self.offset = Some(0);
        }
        ControlFlow::Continue(())
    }
}

/// Names an ORDER BY key by the column it sorts on; an ordinal or an aliased SELECT expression
/// resolves to that item. A key with no single column keeps its text, so no key is dropped.
fn order_by_key_name(expr: &Expr, projection: &[SelectItem]) -> String {
    let mut expr = match select_item_at_ordinal(expr, projection) {
        Some(SelectItem::ExprWithAlias { alias, .. }) => return alias.value.clone(),
        Some(SelectItem::UnnamedExpr(item)) => item.clone(),
        _ => expr.clone(),
    };
    let mut name_visitor = FieldNameVisitor::new();
    let _ = expr.visit(&mut name_visitor);
    if name_visitor.field_names.len() == 1 {
        return name_visitor.field_names.into_iter().next().unwrap();
    }
    let text = expr.to_string();
    projection
        .iter()
        .find_map(|item| match item {
            SelectItem::ExprWithAlias { expr, alias } if expr.to_string() == text => {
                Some(alias.value.clone())
            }
            _ => None,
        })
        .unwrap_or(text)
}

fn select_item_at_ordinal<'a>(expr: &Expr, projection: &'a [SelectItem]) -> Option<&'a SelectItem> {
    let Expr::Value(ValueWithSpan {
        value: Value::Number(ordinal, _),
        ..
    }) = expr
    else {
        return None;
    };
    let ordinal = ordinal.to_string().parse::<usize>().ok()?;
    projection.get(ordinal.checked_sub(1)?)
}

fn has_wildcard(set: &SetExpr) -> bool {
    match set {
        SetExpr::Select(select) => {
            for item in select.projection.iter() {
                if let SelectItem::Wildcard(_) = item {
                    return true;
                }
            }
            false
        }
        SetExpr::SetOperation { left, right, .. } => has_wildcard(left) || has_wildcard(right),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use sqlparser::dialect::GenericDialect;

    use super::*;

    #[test]
    fn test_column_visitor() {
        let sql = "SELECT name, age, COUNT(*) FROM users WHERE status = 'active' GROUP BY name, age ORDER BY name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("status", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut column_visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut column_visitor);

        // Should extract columns, group by, order by, and detect aggregate function
        assert!(column_visitor.has_agg_function);
        assert_eq!(column_visitor.group_by, vec!["name", "age"]);
        assert_eq!(
            column_visitor.order_by,
            vec![("name".to_string(), OrderBy::Asc)]
        );
    }

    #[test]
    fn test_column_visitor_detects_standard_aggregates_without_group_by() {
        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("x", DataType::Float64, false)),
            Arc::new(Field::new("y", DataType::Float64, false)),
        ]);
        schemas.insert(
            TableReference::from("t"),
            Arc::new(SchemaCache::new(schema)),
        );

        for call in [
            "stddev(x)",
            "stddev_samp(x)",
            "stddev_pop(x)",
            "var_samp(x)",
            "var_pop(x)",
            "corr(x, y)",
            "covar_samp(x, y)",
            "bool_and(x > 1)",
            "bool_or(x > 1)",
            "bit_and(x)",
            "bit_or(x)",
            "bit_xor(x)",
            "string_agg(x, ',')",
            "STDDEV(x)",
        ] {
            let sql = format!("SELECT {call} AS v FROM t");
            let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
                .unwrap()
                .pop()
                .unwrap();
            let mut column_visitor = ColumnVisitor::new(&schemas);
            let _ = statement.visit(&mut column_visitor);
            assert!(column_visitor.has_agg_function, "{sql}");
        }
    }

    #[test]
    fn test_aggregate_list_covers_every_default_datafusion_aggregate() {
        let missing: Vec<String> =
            datafusion::functions_aggregate::all_default_aggregate_functions()
                .iter()
                .flat_map(|f| {
                    std::iter::once(f.name().to_string()).chain(f.aliases().iter().cloned())
                })
                .filter(|name| !AGGREGATE_UDF_LIST.contains(&name.to_lowercase().as_str()))
                .collect();
        assert!(
            missing.is_empty(),
            "missing from AGGREGATE_UDF_LIST: {missing:?}"
        );
    }

    #[test]
    fn test_column_visitor_with_limit() {
        let sql = "SELECT name, age, COUNT(*) FROM users WHERE status in (select distinct status from users order by status limit 10) GROUP BY name, age ORDER BY name limit 1000";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("status", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut column_visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut column_visitor);

        // Should extract limit
        assert_eq!(column_visitor.limit, Some(1000));
    }

    #[test]
    fn test_column_visitor_with_wildcard() {
        let sql = "SELECT * FROM users union select * from users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("status", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut column_visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut column_visitor);

        // Should extract columns, group by, order by, and detect aggregate function
        assert!(column_visitor.is_wildcard);
    }

    fn make_schemas() -> HashMap<TableReference, Arc<SchemaCache>> {
        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("status", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );
        schemas
    }

    #[test]
    fn test_column_visitor_direct_wildcard() {
        let sql = "SELECT * FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.is_wildcard);
    }

    #[test]
    fn test_column_visitor_is_distinct() {
        let sql = "SELECT DISTINCT name FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(visitor.is_distinct);
    }

    #[test]
    fn test_column_visitor_columns_alias() {
        let sql = "SELECT name AS n, age AS a FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert!(
            visitor
                .columns_alias
                .iter()
                .any(|(expr, alias)| expr == "name" && alias == "n")
        );
        assert!(
            visitor
                .columns_alias
                .iter()
                .any(|(expr, alias)| expr == "age" && alias == "a")
        );
    }

    #[test]
    fn test_column_visitor_limit_and_offset() {
        let sql = "SELECT * FROM users LIMIT 100 OFFSET 50";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert_eq!(visitor.limit, Some(100));
        assert_eq!(visitor.offset, Some(50));
    }

    #[test]
    fn test_column_visitor_order_by_desc() {
        let sql = "SELECT name FROM users ORDER BY age DESC";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert_eq!(visitor.order_by, vec![("age".to_string(), OrderBy::Desc)]);
    }

    #[test]
    fn test_column_visitor_records_every_order_by_key() {
        let histogram = "histogram(_timestamp) AS ts, count(*) AS tn";
        let cases = [
            ("name", "", vec![]),
            ("name", "ORDER BY lower(name)", vec![("name", OrderBy::Asc)]),
            (
                "name",
                "ORDER BY name || age",
                vec![("name || age", OrderBy::Asc)],
            ),
            (
                histogram,
                "ORDER BY ts ASC, tn DESC",
                vec![("ts", OrderBy::Asc), ("tn", OrderBy::Desc)],
            ),
            (
                histogram,
                "ORDER BY 1 ASC, 2 DESC",
                vec![("ts", OrderBy::Asc), ("tn", OrderBy::Desc)],
            ),
            (
                histogram,
                "ORDER BY count(*) DESC, ts",
                vec![("tn", OrderBy::Desc), ("ts", OrderBy::Asc)],
            ),
            (
                "name, count(*)",
                "ORDER BY count(*) DESC",
                vec![("count(*)", OrderBy::Desc)],
            ),
            (
                "name, count(*)",
                "ORDER BY 1, 2 DESC",
                vec![("name", OrderBy::Asc), ("count(*)", OrderBy::Desc)],
            ),
            ("name", "ORDER BY 2", vec![("2", OrderBy::Asc)]),
            ("*", "ORDER BY 1", vec![("1", OrderBy::Asc)]),
        ];
        for (select, order_by, expected) in cases {
            let sql = format!("SELECT {select} FROM users {order_by}");
            let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
                .unwrap()
                .pop()
                .unwrap();
            let schemas = make_schemas();
            let mut visitor = ColumnVisitor::new(&schemas);
            let _ = statement.visit(&mut visitor);
            let expected: Vec<_> = expected
                .into_iter()
                .map(|(field, order)| (field.to_string(), order))
                .collect();
            assert_eq!(visitor.order_by, expected, "{sql}");
        }
    }

    #[test]
    fn test_column_visitor_no_tests_when_no_schema_match() {
        let sql = "SELECT unknown_col FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        // unknown_col not in schema → columns map empty
        let users_ref = TableReference::from("users");
        assert!(visitor.columns.get(&users_ref).is_none_or(|s| s.is_empty()));
    }

    #[test]
    fn test_column_visitor_compound_identifier() {
        // table.field style → CompoundIdentifier branch in pre_visit_expr
        let sql = "SELECT users.name, users.age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        let users_ref = TableReference::from("users");
        let columns = visitor.columns.get(&users_ref).unwrap();
        assert!(columns.contains("name"));
        assert!(columns.contains("age"));
    }

    #[test]
    fn test_column_visitor_order_by_multiple_keys() {
        let sql = "SELECT name FROM users ORDER BY name, age";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        // Both single-field order_by expressions captured
        assert_eq!(visitor.order_by.len(), 2);
        assert!(
            visitor
                .order_by
                .iter()
                .any(|(f, _)| f == "name" || f == "age")
        );
    }

    #[test]
    fn test_column_visitor_limit_no_explicit_offset_defaults_to_zero() {
        // LIMIT with no OFFSET → offset defaults to 0
        let sql = "SELECT * FROM users LIMIT 5";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);

        assert_eq!(visitor.limit, Some(5));
        assert_eq!(visitor.offset, Some(0));
    }

    fn visit_limit(sql: &str) -> (Option<i64>, Option<i64>) {
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let schemas = make_schemas();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut visitor);
        (visitor.limit, visitor.offset)
    }

    #[test]
    fn test_column_visitor_reads_only_outermost_limit() {
        let cases = [
            (
                "WITH a AS (SELECT name FROM users LIMIT 10) SELECT * FROM a",
                (None, None),
            ),
            (
                "SELECT name FROM users WHERE age IN (SELECT age FROM users LIMIT 3 OFFSET 1)",
                (None, None),
            ),
            (
                "(SELECT name FROM users LIMIT 5) UNION ALL (SELECT name FROM users LIMIT 7)",
                (None, None),
            ),
            (
                "SELECT name FROM users UNION ALL SELECT name FROM users LIMIT 20",
                (Some(20), Some(0)),
            ),
        ];
        for (sql, expected) in cases {
            assert_eq!(visit_limit(sql), expected, "{sql}");
        }
    }
}

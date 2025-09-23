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

use config::{meta::sql::OrderBy, utils::sql::AGGREGATE_UDF_LIST};
use datafusion::common::TableReference;
use hashbrown::{HashMap, HashSet};
use infra::schema::SchemaCache;
use sqlparser::ast::{
    Expr, GroupByExpr, OrderByKind, Query, SelectItem, SetExpr, Value, ValueWithSpan, VisitMut,
    VisitorMut,
};

use crate::service::search::{sql::visitor::utils::FieldNameVisitor, utils::trim_quotes};

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
            Expr::Function(f) => {
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&f.name.to_string().to_lowercase()).as_str())
                {
                    self.has_agg_function = true;
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let Some(order_by) = query.order_by.as_mut()
            && let OrderByKind::Expressions(exprs) = &mut order_by.kind
        {
            for order in exprs.iter_mut() {
                let mut name_visitor = FieldNameVisitor::new();
                let _ = order.expr.visit(&mut name_visitor);
                if name_visitor.field_names.len() == 1 {
                    let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                    self.order_by.push((
                        expr_name,
                        if order.options.asc.unwrap_or(true) {
                            OrderBy::Asc
                        } else {
                            OrderBy::Desc
                        },
                    ));
                }
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
        let mut has_limit = false;
        if let Some(limit_clause) = query.limit_clause.as_ref()
            && let sqlparser::ast::LimitClause::LimitOffset { limit, offset, .. } = limit_clause
        {
            if let Some(limit) = limit.as_ref()
                && let Expr::Value(ValueWithSpan { value, span: _ }) = limit
                && let Value::Number(n, _) = value
                && let Ok(num) = n.to_string().parse::<i64>()
                && self.limit.is_none()
            {
                has_limit = true;
                self.limit = Some(num);
            }
            if let Some(offset) = offset.as_ref()
                && let Expr::Value(ValueWithSpan { value, span: _ }) = &offset.value
                && let Value::Number(n, _) = value
                && let Ok(num) = n.to_string().parse::<i64>()
                && self.offset.is_none()
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
}

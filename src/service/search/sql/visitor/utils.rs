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

use std::{collections::HashSet, ops::ControlFlow};

use config::{meta::sql::MAX_LIMIT, utils::sql::AGGREGATE_UDF_LIST};
use datafusion::sql::TableReference;
use sqlparser::ast::{
    Expr, FunctionArguments, GroupByExpr, Ident, OrderByKind, Query, Select, SelectItem, Statement,
    Value, ValueWithSpan, VisitMut, VisitorMut,
};

use crate::service::search::utils::{get_field_name, trim_quotes};

pub struct FieldNameVisitor {
    pub field_names: HashSet<String>,
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

pub fn is_complex_query(statement: &mut Statement) -> bool {
    let mut visitor = ComplexQueryVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.is_complex
}

// check if the query is complex query
// 1. has subquery
// 2. has join
// 3. has group by
// 4. has aggregate
// 5. has SetOperation(UNION/EXCEPT/INTERSECT of two queries)
// 6. has distinct
// 7. has wildcard
struct ComplexQueryVisitor {
    pub is_complex: bool,
}

impl ComplexQueryVisitor {
    fn new() -> Self {
        Self { is_complex: false }
    }
}

impl VisitorMut for ComplexQueryVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        match query.body.as_ref() {
            sqlparser::ast::SetExpr::Select(select) => {
                // check if has group by
                match select.group_by {
                    GroupByExpr::Expressions(ref expr, _) => self.is_complex = !expr.is_empty(),
                    _ => self.is_complex = true,
                }
                // check if has join
                if select.from.len() > 1 || select.from.iter().any(|from| !from.joins.is_empty()) {
                    self.is_complex = true;
                }
                if select.distinct.is_some() {
                    self.is_complex = true;
                }
                if self.is_complex {
                    return ControlFlow::Break(());
                }
            }
            // check if SetOperation
            sqlparser::ast::SetExpr::SetOperation { .. } => {
                self.is_complex = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            // check if has subquery
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.is_complex = true;
            }
            // check if has aggregate function or window function
            Expr::Function(func) => {
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&func.name.to_string().to_lowercase()).as_str())
                    || func.filter.is_some()
                    || func.over.is_some()
                    || !func.within_group.is_empty()
                {
                    self.is_complex = true;
                }
            }
            // check select * from table
            Expr::Wildcard(_) => self.is_complex = true,
            _ => {}
        }
        if self.is_complex {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

// check if the query is only count(*) query
pub fn is_simple_count_query(select: &Select) -> bool {
    select.projection.len() == 1 && is_sql_func(&select.projection[0], "count", true)
}

// check if the query is only histogram & count query
pub fn is_simple_histogram_query(select: &Select) -> bool {
    select.projection.len() == 2
        && is_sql_func(&select.projection[0], "histogram", false)
        && is_sql_func(&select.projection[1], "count", true)
}

// check if the query is only topn query
// the topn query: `select id, count(*) as cnt from stream group by id order by cnt desc limit 10`
pub fn is_simple_topn_query(query: &Query) -> Option<(String, usize, bool)> {
    let select = match query.body.as_ref() {
        sqlparser::ast::SetExpr::Select(select) => select,
        _ => return None,
    };

    // Must have exactly 2 projections: a field and count(*)
    if select.projection.len() != 2 {
        return None;
    }

    // First projection should be a simple field (not a function)
    let field_name = match &select.projection[0] {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. }
            if matches!(expr, Expr::Identifier(_) | Expr::CompoundIdentifier(_)) =>
        {
            get_field_name(expr)
        }
        _ => return None,
    };

    // Second projection should be count(*)
    if !is_sql_func(&select.projection[1], "count", true) {
        return None;
    }

    // Must have GROUP BY with exactly one expression
    match &select.group_by {
        GroupByExpr::Expressions(exprs, _) if exprs.len() == 1 => {}
        _ => return None,
    };

    // Check if ORDER BY references the count(*) function (with alias support)
    let count_alias = match &select.projection[1] {
        SelectItem::ExprWithAlias { alias, .. } => Some(alias.value.clone()),
        _ => None,
    };

    let mut order_by_references_count = false;
    if let Some(order_by) = &query.order_by
        && let OrderByKind::Expressions(exprs) = &order_by.kind
        && exprs.len() == 1
    {
        match &exprs[0].expr {
            Expr::Identifier(ident) => {
                // Check if it's the count alias
                if let Some(alias) = &count_alias
                    && ident.value == *alias
                    && exprs[0].options.asc == Some(false)
                {
                    order_by_references_count = true;
                }
            }
            Expr::Function(func) => {
                // Check if it's count(*) function directly
                let name = trim_quotes(&func.name.to_string().to_lowercase());
                if name == "count"
                    && let FunctionArguments::List(list) = &func.args
                    && list.args.len() == 1
                    && trim_quotes(&list.args[0].to_string()) == "*"
                    && exprs[0].options.asc == Some(false)
                {
                    order_by_references_count = true;
                }
            }
            _ => {}
        }
    }

    // check if limit is present
    let limit = match &query.limit_clause {
        Some(sqlparser::ast::LimitClause::LimitOffset {
            limit:
                Some(Expr::Value(ValueWithSpan {
                    value: Value::Number(v, _b),
                    ..
                })),
            offset,
            ..
        }) => {
            let limit_val: i64 = v.parse().unwrap_or(0);
            let offset_val: i64 = match offset {
                Some(offset) => {
                    if let Expr::Value(ValueWithSpan {
                        value: Value::Number(offset_v, _),
                        ..
                    }) = &offset.value
                    {
                        offset_v.parse().unwrap_or(0)
                    } else {
                        return None;
                    }
                }
                _ => 0,
            };
            let effective_limit = limit_val + offset_val;
            std::cmp::min(effective_limit, MAX_LIMIT) as usize
        }
        _ => return None,
    };

    if order_by_references_count {
        Some((field_name, limit, order_by_references_count))
    } else {
        None
    }
}

// check if the query is only distinct query
// the distinct query: `select id from stream group by id order by id asc limit 10`
pub fn is_simple_distinct_query(query: &Query) -> Option<(String, usize, bool)> {
    let select = match query.body.as_ref() {
        sqlparser::ast::SetExpr::Select(select) => select,
        _ => return None,
    };

    // Must have exactly 1 projection: a simple field (not a function)
    if select.projection.len() != 1 {
        return None;
    }

    // First projection should be a simple field (not a function)
    let field_name = match &select.projection[0] {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. }
            if matches!(expr, Expr::Identifier(_) | Expr::CompoundIdentifier(_)) =>
        {
            get_field_name(expr)
        }
        _ => return None,
    };

    // Check if ORDER BY references the field (with alias support)
    let field_alias = match &select.projection[0] {
        SelectItem::ExprWithAlias { alias, .. } => Some(alias.value.clone()),
        _ => None,
    };

    // Must have GROUP BY with exactly one expression that references the same field
    let group_by_field = match &select.group_by {
        GroupByExpr::Expressions(exprs, _) if exprs.len() == 1 => match &exprs[0] {
            Expr::Identifier(ident) => Some(ident.value.clone()),
            Expr::CompoundIdentifier(idents) => {
                if !idents.is_empty() {
                    Some(idents.last().unwrap().value.clone())
                } else {
                    None
                }
            }
            _ => None,
        },
        _ => return None,
    };

    // GROUP BY field must match SELECT field (with alias support)
    if let Some(group_by_field_name) = group_by_field.as_ref() {
        if !field_matches_with_alias(&field_name, field_alias.as_deref(), group_by_field_name) {
            return None;
        }
    } else {
        return None;
    }

    // Check if ORDER BY references the same field
    let mut order_by_references_field = false;
    let mut is_asc = false;
    if let Some(order_by) = &query.order_by
        && let OrderByKind::Expressions(exprs) = &order_by.kind
        && exprs.len() == 1
    {
        match &exprs[0].expr {
            Expr::Identifier(ident) => {
                if field_matches_with_alias(&field_name, field_alias.as_deref(), &ident.value) {
                    order_by_references_field = true;
                    is_asc = exprs[0].options.asc.unwrap_or(true);
                }
            }
            Expr::CompoundIdentifier(idents) => {
                if !idents.is_empty()
                    && field_matches_with_alias(
                        &field_name,
                        field_alias.as_deref(),
                        &idents.last().unwrap().value,
                    )
                {
                    order_by_references_field = true;
                    is_asc = exprs[0].options.asc.unwrap_or(true);
                }
            }
            _ => {}
        }
    }

    // ORDER BY field must match SELECT field
    if !order_by_references_field {
        return None;
    }

    // check if limit is present
    let limit = match &query.limit_clause {
        Some(sqlparser::ast::LimitClause::LimitOffset {
            limit:
                Some(Expr::Value(ValueWithSpan {
                    value: Value::Number(v, _b),
                    ..
                })),
            offset,
            ..
        }) => {
            let limit_val: i64 = v.parse().unwrap_or(0);
            let offset_val: i64 = match offset {
                Some(offset) => {
                    if let Expr::Value(ValueWithSpan {
                        value: Value::Number(offset_v, _),
                        ..
                    }) = &offset.value
                    {
                        offset_v.parse().unwrap_or(0)
                    } else {
                        return None;
                    }
                }
                _ => 0,
            };
            let effective_limit = limit_val + offset_val;
            std::cmp::min(effective_limit, MAX_LIMIT) as usize
        }
        _ => return None,
    };

    Some((field_name, limit, is_asc))
}

// Check if the query is a simple `select sql_func(*)` without modifiers
fn is_sql_func(select: &SelectItem, fn_name: &str, with_star: bool) -> bool {
    match select {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => {
            if let Expr::Function(func) = expr {
                let name = trim_quotes(&func.name.to_string().to_lowercase());
                // Check function name matches and has no special modifiers
                let has_no_modifiers =
                    func.filter.is_none() && func.over.is_none() && func.within_group.is_empty();

                // If with_start is true, check for single "*" argument
                let has_valid_args = if with_star {
                    matches!(
                        &func.args,
                        FunctionArguments::List(list)
                            if list.args.len() == 1
                            && trim_quotes(&list.args[0].to_string()) == "*"
                    )
                } else {
                    true
                };

                name == fn_name && has_no_modifiers && has_valid_args
            } else {
                false
            }
        }
        _ => false,
    }
}

/// Helper function to resolve field names considering aliases
/// Returns true if the given field_name matches either the actual field name or its alias
fn field_matches_with_alias(field_name: &str, alias: Option<&str>, target_field: &str) -> bool {
    // Direct match with field name
    if field_name == target_field {
        return true;
    }

    // Match with alias if present
    if let Some(alias_name) = alias
        && alias_name == target_field
    {
        return true;
    }

    false
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
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_field_name_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut field_visitor = FieldNameVisitor::new();
        let _ = statement.visit(&mut field_visitor);

        // Should extract field names
        assert!(field_visitor.field_names.contains("name"));
        assert!(field_visitor.field_names.contains("age"));
    }

    #[test]
    fn test_field_matches_with_alias() {
        // Test direct field name match
        assert!(field_matches_with_alias("field1", None, "field1"));

        // Test alias match
        assert!(field_matches_with_alias("field1", Some("alias1"), "alias1"));

        // Test no match
        assert!(!field_matches_with_alias("field1", None, "field2"));
        assert!(!field_matches_with_alias(
            "field1",
            Some("alias1"),
            "field2"
        ));
        assert!(!field_matches_with_alias(
            "field1",
            Some("alias1"),
            "alias2"
        ));
    }

    #[test]
    fn test_complex_query_visitor() {
        let sql = "SELECT * FROM users WHERE name IN (SELECT name FROM admins)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut complex_visitor = ComplexQueryVisitor::new();
        let _ = statement.visit(&mut complex_visitor);

        // Should detect complex query due to subquery
        assert!(complex_visitor.is_complex);
    }
}

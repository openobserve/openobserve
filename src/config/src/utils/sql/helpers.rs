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

use sqlparser::ast::{Expr, Function, GroupByExpr, Query, SelectItem, SetExpr};

use super::AGGREGATE_UDF_LIST;

pub(super) fn is_aggregate_in_select(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        if select.distinct.is_some() {
            return true;
        }
        for select_item in &select.projection {
            if let SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, alias: _ } =
                select_item
                && is_aggregate_expression(expr)
            {
                return true;
            }
        }
    }
    false
}

pub(super) fn is_aggregate_expression(expr: &Expr) -> bool {
    match expr {
        Expr::Function(Function { name, .. }) => {
            AGGREGATE_UDF_LIST.contains(&name.to_string().to_lowercase().as_str())
        }
        Expr::BinaryOp { left, right, .. } => {
            is_aggregate_expression(left) || is_aggregate_expression(right)
        }
        Expr::Case {
            operand,
            conditions,
            else_result,
            ..
        } => {
            conditions.iter().any(|c| {
                is_aggregate_expression(&c.condition) || is_aggregate_expression(&c.result)
            }) || operand.as_ref().is_some_and(|e| is_aggregate_expression(e))
                || else_result
                    .as_ref()
                    .is_some_and(|e| is_aggregate_expression(e))
        }
        Expr::Nested(expr) => is_aggregate_expression(expr),
        Expr::Cast { expr, .. } => is_aggregate_expression(expr),
        Expr::UnaryOp { expr, .. } => is_aggregate_expression(expr),
        _ => false,
    }
}

pub(super) fn has_group_by(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        match &select.group_by {
            GroupByExpr::All(v) => !v.is_empty(),
            GroupByExpr::Expressions(v, _) => !v.is_empty(),
        }
    } else {
        false
    }
}

pub(super) fn has_join(query: &Query) -> bool {
    if let SetExpr::Select(ref select) = *query.body {
        select.from.len() > 1
            || select
                .from
                .first()
                .is_some_and(|table| !table.joins.is_empty())
    } else {
        false
    }
}

pub(super) fn has_cte(query: &Query) -> bool {
    query.with.is_some()
}

pub(super) fn has_limit(query: &Query) -> bool {
    query.limit_clause.is_some()
}

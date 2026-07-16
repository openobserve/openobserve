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

use config::meta::sql::OrderBy;
use sqlparser::ast::{BinaryOperator, Expr};

use crate::sql::Sql;

mod runtime;

pub use runtime::{
    AsyncDefer, ScanStatsVisitor, check_query_default_limit_exceeded,
    is_default_query_limit_exceeded, is_permissable_function_error,
};

pub fn get_ts_col_order_by(
    parsed_sql: &Sql,
    ts_col: &str,
    is_aggregate: bool,
) -> Option<(String, bool)> {
    let mut is_descending = true;
    let order_by = &parsed_sql.order_by;
    let result_ts_col = {
        #[cfg(not(feature = "enterprise"))]
        {
            let mut result = String::new();
            for (original, alias) in &parsed_sql.aliases {
                if original == ts_col || original.contains("histogram") {
                    result = alias.clone();
                }
            }
            if !is_aggregate
                && (parsed_sql
                    .columns
                    .iter()
                    .any(|(_, value)| value.contains(&ts_col.to_owned()))
                    || parsed_sql.order_by.iter().any(|value| value.0 == ts_col))
            {
                result = ts_col.to_string();
            }
            result
        }

        #[cfg(feature = "enterprise")]
        {
            o2_enterprise::enterprise::search::cache_ts_util::get_timestamp_column_name(
                &parsed_sql.sql,
            )
            .unwrap_or_default()
        }
    };

    for (field, order) in order_by {
        if (field == &result_ts_col || field.trim_matches('"') == result_ts_col)
            && !result_ts_col.is_empty()
        {
            is_descending = order == &OrderBy::Desc;
            break;
        }
    }
    (!result_ts_col.is_empty()).then_some((result_ts_col, is_descending))
}

pub fn split_conjunction(expr: &Expr) -> Vec<&Expr> {
    split_conjunction_inner(expr, Vec::new())
}

fn split_conjunction_inner<'a>(expr: &'a Expr, mut exprs: Vec<&'a Expr>) -> Vec<&'a Expr> {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            let exprs = split_conjunction_inner(left, exprs);
            split_conjunction_inner(right, exprs)
        }
        Expr::Nested(expr) => split_conjunction_inner(expr, exprs),
        other => {
            exprs.push(other);
            exprs
        }
    }
}

pub fn conjunction(exprs: Vec<&Expr>) -> Option<Expr> {
    if exprs.is_empty() {
        None
    } else if exprs.len() == 1 {
        Some(exprs[0].clone())
    } else {
        let mut expr = exprs[0].clone();
        if matches!(
            expr,
            Expr::BinaryOp {
                op: BinaryOperator::Or,
                ..
            }
        ) {
            expr = Expr::Nested(Box::new(expr));
        }
        for item in exprs.into_iter().skip(1) {
            expr = Expr::BinaryOp {
                left: Box::new(expr),
                op: BinaryOperator::And,
                right: if matches!(
                    item,
                    Expr::BinaryOp {
                        op: BinaryOperator::Or,
                        ..
                    }
                ) {
                    Box::new(Expr::Nested(Box::new(item.clone())))
                } else {
                    Box::new(item.clone())
                },
            };
        }
        Some(expr)
    }
}

pub fn trim_quotes(value: &str) -> String {
    let value = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value);
    value
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
        .unwrap_or(value)
        .to_string()
}

pub fn is_value(expr: &Expr) -> bool {
    matches!(expr, Expr::Value(_))
}

pub fn is_field(expr: &Expr) -> bool {
    matches!(expr, Expr::Identifier(_) | Expr::CompoundIdentifier(_))
}

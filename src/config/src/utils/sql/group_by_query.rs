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

use std::ops::ControlFlow;

use sqlparser::{
    ast::{
        Expr, GroupByExpr, SelectItem, SetExpr, Statement, Value, ValueWithSpan, visit_expressions,
    },
    dialect::GenericDialect,
    parser::{Parser, ParserError},
};

use super::helpers::{has_group_by, is_aggregate_expression};

const TIME_BUCKETS: [&str; 3] = ["histogram", "date_bin", "date_trunc"];

/// Top-level GROUP BY only: a grouped subquery does not group the outer result set.
pub fn is_group_by_query(query: &str) -> Result<bool, ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    Ok(ast
        .iter()
        .any(|statement| matches!(statement, Statement::Query(query) if has_group_by(query))))
}

/// The top-level GROUP BY keys (under GROUP BY ALL, every non-aggregate select item) as result
/// columns; time buckets and unnamed expressions are left out, and unparseable SQL has none.
pub fn group_by_columns(query: &str) -> Vec<String> {
    let Ok(ast) = Parser::parse_sql(&GenericDialect {}, query) else {
        return Vec::new();
    };
    let Some(Statement::Query(query)) = ast.first() else {
        return Vec::new();
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return Vec::new();
    };
    let columns: Vec<String> = match &select.group_by {
        GroupByExpr::Expressions(keys, _) => keys
            .iter()
            .filter_map(|key| result_column(key, &select.projection))
            .collect(),
        GroupByExpr::All(_) => select
            .projection
            .iter()
            .filter(|item| !is_aggregate_item(item))
            .filter_map(projected_column)
            .collect(),
    };
    columns
        .into_iter()
        .filter(|column| column != crate::TIMESTAMP_COL_NAME)
        .collect()
}

fn result_column(key: &Expr, projection: &[SelectItem]) -> Option<String> {
    if let Some(position) = ordinal(key) {
        return projected_column(projection.get(position.checked_sub(1)?)?);
    }
    let name = column_name(key);
    for item in projection {
        if let SelectItem::ExprWithAlias { expr, alias } = item
            && (name == Some(alias.value.as_str())
                || name.is_some() && column_name(expr) == name
                || expr.to_string() == key.to_string())
        {
            return (!is_time_bucket(expr)).then(|| alias.value.clone());
        }
    }
    name.map(str::to_string)
}

fn projected_column(item: &SelectItem) -> Option<String> {
    match item {
        SelectItem::ExprWithAlias { expr, alias } => {
            (!is_time_bucket(expr)).then(|| alias.value.clone())
        }
        SelectItem::UnnamedExpr(expr) => column_name(expr).map(str::to_string),
        _ => None,
    }
}

fn is_aggregate_item(item: &SelectItem) -> bool {
    match item {
        // An aggregate at any depth, e.g. round(avg(x)), makes the item a measurement, not a key.
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => {
            visit_expressions(expr, |e| {
                if is_aggregate_expression(e) {
                    ControlFlow::Break(())
                } else {
                    ControlFlow::Continue(())
                }
            })
            .is_break()
        }
        _ => false,
    }
}

fn ordinal(expr: &Expr) -> Option<usize> {
    match expr {
        Expr::Value(ValueWithSpan {
            value: Value::Number(n, _),
            ..
        }) => n.parse().ok(),
        _ => None,
    }
}

fn column_name(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Identifier(ident) => Some(&ident.value),
        Expr::CompoundIdentifier(parts) => parts.last().map(|part| part.value.as_str()),
        _ => None,
    }
}

fn is_time_bucket(expr: &Expr) -> bool {
    matches!(expr, Expr::Function(f) if TIME_BUCKETS.contains(&f.name.to_string().to_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_group_by_clause() {
        let queries = [
            "SELECT code, COUNT(*) FROM logs GROUP BY code",
            "SELECT code, host, COUNT(*) FROM logs WHERE code > 399 GROUP BY code, host",
            "SELECT code, COUNT(*) AS c FROM logs GROUP BY code HAVING COUNT(*) > 5 ORDER BY c",
        ];
        for q in queries {
            assert!(is_group_by_query(q).unwrap(), "expected GROUP BY: {q}");
        }
    }

    #[test]
    fn no_group_by_clause_is_false() {
        let queries = [
            "SELECT code FROM logs",
            "SELECT COUNT(*) FROM logs WHERE code > 399",
            "SELECT * FROM logs ORDER BY _timestamp LIMIT 10",
        ];
        for q in queries {
            assert!(!is_group_by_query(q).unwrap(), "expected no GROUP BY: {q}");
        }
    }

    #[test]
    fn group_by_only_inside_a_subquery_is_false() {
        let q = "SELECT * FROM (SELECT code, COUNT(*) FROM logs GROUP BY code) t";
        assert!(!is_group_by_query(q).unwrap());
    }

    #[test]
    fn unparseable_sql_is_an_error() {
        assert!(is_group_by_query("SELECT FROM WHERE GROUP").is_err());
    }
}

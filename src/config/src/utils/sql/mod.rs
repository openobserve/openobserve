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

mod complex_query;
mod eligible_for_histogram;
mod explain_query;
mod group_by_query;
mod helpers;
mod simple_aggregate_query;
mod timestamp_selected;
mod visitors;
mod where_fragment;

pub use complex_query::{is_complex_query, is_complex_query_stmt};
pub use eligible_for_histogram::is_eligible_for_histogram;
pub use explain_query::is_explain_query;
pub use group_by_query::is_group_by_query;
pub use simple_aggregate_query::is_simple_aggregate_query;
pub use timestamp_selected::is_timestamp_selected;
pub use visitors::TimestampVisitor;
pub use where_fragment::{validate_optional_where_fragment, validate_where_fragment};

pub const AGGREGATE_UDF_LIST: [&str; 19] = [
    "min",
    "max",
    "avg",
    "sum",
    "count",
    "median",
    "array_agg",
    "percentile_cont",
    "summary_percentile",
    "first_value",
    "last_value",
    "approx_distinct",
    "approx_median",
    "approx_percentile_cont",
    "approx_percentile_cont_with_weight",
    "approx_topk",
    "approx_topk_distinct",
    "sequence_depth",
    "sequence_step_times",
];

pub fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Splits at a `'` after `\` or `'` because sqlparser's `Display` would not re-escape it.
pub fn quote_sql_string(value: &str) -> String {
    let body = escape_sql_string(value);
    if literal_pieces(value).nth(1).is_some() {
        format!("('{body}')")
    } else {
        format!("'{body}'")
    }
}

/// Prefer [`quote_sql_string`], which also parenthesises a split `||` chain.
pub fn escape_sql_string(value: &str) -> String {
    literal_pieces(value)
        .map(|piece| piece.replace('\'', "''"))
        .collect::<Vec<_>>()
        .join("' || '")
}

/// Splits `value` before every `'` that follows a `\` or another `'`.
fn literal_pieces(value: &str) -> impl Iterator<Item = &str> {
    let mut rest = value;
    std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        let bytes = rest.as_bytes();
        let split = (1..bytes.len())
            .find(|&i| bytes[i] == b'\'' && matches!(bytes[i - 1], b'\\' | b'\''))
            .unwrap_or(bytes.len());
        let (piece, tail) = rest.split_at(split);
        rest = tail;
        Some(piece)
    })
}

#[cfg(test)]
mod tests {
    use sqlparser::{
        ast::{BinaryOperator, Expr, SetExpr, Statement, Value},
        dialect::PostgreSqlDialect,
        parser::Parser,
    };

    use super::*;

    fn parse(sql: &str) -> Statement {
        let mut statements =
            Parser::parse_sql(&PostgreSqlDialect {}, sql).unwrap_or_else(|e| panic!("{sql}: {e}"));
        assert_eq!(statements.len(), 1, "{sql}");
        statements.pop().unwrap()
    }

    fn literal_text(expr: &Expr) -> String {
        match expr {
            Expr::Value(v) => match &v.value {
                Value::SingleQuotedString(s) => s.clone(),
                other => panic!("not a string literal: {other:?}"),
            },
            Expr::BinaryOp {
                left,
                op: BinaryOperator::StringConcat,
                right,
            } => literal_text(left) + &literal_text(right),
            Expr::Nested(inner) => literal_text(inner),
            other => panic!("not a literal chain: {other}"),
        }
    }

    /// Runs two parse → `Display` passes, as the search service does.
    fn compared_values(sql: &str) -> Vec<String> {
        let once = parse(sql).to_string();
        let twice = parse(&once).to_string();
        let Statement::Query(query) = parse(&twice) else {
            panic!("not a query: {twice}");
        };
        let SetExpr::Select(select) = *query.body else {
            panic!("not a select: {twice}");
        };
        let mut values = Vec::new();
        let mut stack = vec![select.selection.expect("where clause")];
        while let Some(expr) = stack.pop() {
            match expr {
                Expr::BinaryOp {
                    left,
                    op: BinaryOperator::And,
                    right,
                } => {
                    stack.push(*right);
                    stack.push(*left);
                }
                Expr::BinaryOp {
                    op: BinaryOperator::Eq,
                    right,
                    ..
                } => values.push(literal_text(&right)),
                Expr::Like { pattern, .. } => values.push(literal_text(&pattern)),
                Expr::InList { list, .. } => values.extend(list.iter().map(literal_text)),
                other => panic!("unexpected predicate {other} in {twice}"),
            }
        }
        values
    }

    #[test]
    fn quoted_values_survive_reserialisation() {
        for value in [
            "",
            "plain",
            "o'brien",
            r"a\b",
            r"ends\",
            r"a\'b",
            r"\'",
            r"it\'s",
            r"nobody\' OR 1=1 --",
            "a''b",
            "'''",
            r"\\''\'",
            "'lead",
            "trail'",
        ] {
            let quoted = quote_sql_string(value);
            let sql = format!(
                "SELECT * FROM t WHERE a = {quoted} AND b LIKE {quoted} AND c IN ({quoted}, 'z') AND d = 'end'"
            );
            assert_eq!(
                compared_values(&sql),
                vec![value, value, value, "z", "end"],
                "{value:?} through {sql}"
            );
        }
    }

    #[test]
    fn escaped_body_inside_caller_quotes_survives_reserialisation() {
        for value in [r"a\'b", "a''b", "o'brien"] {
            let sql = format!(
                "SELECT * FROM t WHERE a = '{}' AND d = 'end'",
                escape_sql_string(value)
            );
            assert_eq!(compared_values(&sql), vec![value, "end"], "{sql}");
        }
    }

    #[test]
    fn plain_values_stay_one_literal() {
        assert_eq!(quote_sql_string("o'brien"), "'o''brien'");
        assert_eq!(quote_sql_string(r"a\b"), r"'a\b'");
        assert_eq!(quote_sql_string(r"a\'b"), r"('a\' || '''b')");
        assert_eq!(quote_sql_string("a''b"), "('a''' || '''b')");
    }
}

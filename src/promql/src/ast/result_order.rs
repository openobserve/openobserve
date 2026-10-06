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

use std::cmp::Ordering;

use config::meta::promql::value::{InstantValue, LabelsExt, Value};
use promql_parser::parser::Expr;

/// How a top-level ordering function orders an instant query's result.
#[derive(Debug, PartialEq)]
pub enum ResultOrder {
    /// `sort` / `sort_desc`.
    Value { descending: bool },
    /// `sort_by_label` / `sort_by_label_desc`.
    Labels {
        labels: Vec<String>,
        descending: bool,
    },
}

impl ResultOrder {
    /// Orders an instant vector; any other value is left as it is.
    pub fn apply(&self, value: &mut Value) {
        match self {
            Self::Value { descending } => value.sort_by_value(*descending),
            Self::Labels { labels, descending } => {
                if let Value::Vector(vector) = value {
                    vector.sort_by(|a, b| {
                        let order = compare_by_labels(a, b, labels);
                        if *descending { order.reverse() } else { order }
                    });
                }
            }
        }
    }
}

/// The ordering a top-level `sort`, `sort_desc`, `sort_by_label` or `sort_by_label_desc` asks for.
pub fn top_level_order(expr: &Expr) -> Option<ResultOrder> {
    match expr {
        Expr::Paren(paren) => top_level_order(&paren.expr),
        Expr::Call(call) => {
            let descending = call.func.name.ends_with("_desc");
            match call.func.name {
                "sort" | "sort_desc" => Some(ResultOrder::Value { descending }),
                "sort_by_label" | "sort_by_label_desc" => Some(ResultOrder::Labels {
                    labels: call
                        .args
                        .args
                        .iter()
                        .skip(1)
                        .filter_map(|arg| match arg.as_ref() {
                            Expr::StringLiteral(label) => Some(label.val.clone()),
                            _ => None,
                        })
                        .collect(),
                    descending,
                }),
                _ => None,
            }
        }
        _ => None,
    }
}

// upstream breaks ties on the given labels by the full label set
fn compare_by_labels(a: &InstantValue, b: &InstantValue, labels: &[String]) -> Ordering {
    labels
        .iter()
        .map(|name| natural_cmp(&a.labels.get_value(name), &b.labels.get_value(name)))
        .find(|order| order.is_ne())
        .unwrap_or_else(|| a.labels.partial_cmp(&b.labels).unwrap_or(Ordering::Equal))
}

/// Natural order: runs of digits compare by value, so `host2` sorts before `host10`.
fn natural_cmp(mut a: &str, mut b: &str) -> Ordering {
    while !a.is_empty() && !b.is_empty() {
        let (chunk_a, rest_a) = split_chunk(a);
        let (chunk_b, rest_b) = split_chunk(b);
        let order = if is_number(chunk_a) && is_number(chunk_b) {
            let (a, b) = (
                chunk_a.trim_start_matches('0'),
                chunk_b.trim_start_matches('0'),
            );
            a.len().cmp(&b.len()).then_with(|| a.cmp(b))
        } else {
            chunk_a.cmp(chunk_b)
        };
        if order.is_ne() {
            return order;
        }
        (a, b) = (rest_a, rest_b);
    }
    a.len().cmp(&b.len())
}

/// The leading run of digits or of non-digits, and the rest.
fn split_chunk(text: &str) -> (&str, &str) {
    let digits = is_number(text);
    let end = text
        .find(|c: char| c.is_ascii_digit() != digits)
        .unwrap_or(text.len());
    text.split_at(end)
}

fn is_number(chunk: &str) -> bool {
    chunk.starts_with(|c: char| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    fn order(query: &str) -> Option<ResultOrder> {
        top_level_order(&parser::parse(query).unwrap())
    }

    #[test]
    fn test_top_level_order() {
        let by_value = |descending| Some(ResultOrder::Value { descending });
        assert_eq!(order("sort(up)"), by_value(false));
        assert_eq!(order("sort_desc(up)"), by_value(true));
        assert_eq!(order("(sort_desc(topk(3, up)))"), by_value(true));
        assert_eq!(
            order(r#"sort_by_label_desc(up, "job", "instance")"#),
            Some(ResultOrder::Labels {
                labels: vec!["job".into(), "instance".into()],
                descending: true,
            })
        );
        assert_eq!(order("up"), None);
        assert_eq!(order("sort(up) * 2"), None);
        assert_eq!(order("sum(sort(up))"), None);
        assert_eq!(order(r#"sum(sort_by_label(up, "job"))"#), None);
    }

    #[test]
    fn test_natural_cmp() {
        for (a, b) in [
            ("host2", "host10"),
            ("host1", "host2"),
            ("a", "ab"),
            ("", "a"),
            ("1", "a"),
            ("x9y", "x10a"),
            ("x007", "x8"),
            ("10.0.0.2", "10.0.0.10"),
        ] {
            assert_eq!(natural_cmp(a, b), Ordering::Less, "{a} < {b}");
            assert_eq!(natural_cmp(b, a), Ordering::Greater, "{b} > {a}");
        }
        assert_eq!(natural_cmp("host2", "host2"), Ordering::Equal);
    }
}

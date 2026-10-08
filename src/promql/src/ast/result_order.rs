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

use config::meta::promql::value::{InstantValue, Labels, Value};
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
        .map(|name| natural_cmp(label_value(&a.labels, name), label_value(&b.labels, name)))
        .find(|order| order.is_ne())
        .unwrap_or_else(|| a.labels.partial_cmp(&b.labels).unwrap_or(Ordering::Equal))
}

/// A borrowed lookup, since the comparator runs O(n log n) times per sort.
fn label_value<'a>(labels: &'a Labels, name: &str) -> &'a str {
    labels
        .iter()
        .find(|label| label.name == name)
        .map_or("", |label| label.value.as_str())
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
    use config::meta::promql::value::LabelsExt;
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

    /// Applies an order to an instant vector of the given label sets and returns them in order.
    fn ordered(query: &str, series: &[&[(&str, &str)]]) -> Vec<Vec<(String, String)>> {
        let mut value = Value::Vector(
            series
                .iter()
                .map(|labels| {
                    let mut labels: Vec<_> = labels
                        .iter()
                        .map(|(name, value)| {
                            std::sync::Arc::new(config::meta::promql::value::Label::new(
                                *name, *value,
                            ))
                        })
                        .collect();
                    labels.sort();
                    InstantValue {
                        labels,
                        sample: config::meta::promql::value::Sample::new(0, 1.0),
                    }
                })
                .collect(),
        );
        order(query).unwrap().apply(&mut value);
        let Value::Vector(vector) = value else {
            unreachable!();
        };
        vector
            .into_iter()
            .map(|v| {
                v.labels
                    .iter()
                    .filter(|l| l.name != "__name__")
                    .map(|l| (l.name.clone(), l.value.clone()))
                    .collect()
            })
            .collect()
    }

    fn label_sets(rows: &[&[(&str, &str)]]) -> Vec<Vec<(String, String)>> {
        rows.iter()
            .map(|row| {
                let mut row: Vec<_> = row
                    .iter()
                    .map(|(n, v)| (n.to_string(), v.to_string()))
                    .collect();
                row.sort();
                row
            })
            .collect()
    }

    /// `http_requests{group, instance, job}` as upstream loads it, in load order.
    const HTTP_REQUESTS: [&[(&str, &str)]; 10] = [
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "0"),
            ("group", "production"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "1"),
            ("group", "production"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "0"),
            ("group", "canary"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "1"),
            ("group", "canary"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "2"),
            ("group", "canary"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "app-server"),
            ("instance", "0"),
            ("group", "production"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "app-server"),
            ("instance", "1"),
            ("group", "production"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "app-server"),
            ("instance", "0"),
            ("group", "canary"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "app-server"),
            ("instance", "1"),
            ("group", "canary"),
        ],
        &[
            ("__name__", "http_requests"),
            ("job", "api-server"),
            ("instance", "2"),
            ("group", "production"),
        ],
    ];

    /// `(group, instance, job)` rows of an expected upstream result.
    fn gij(rows: &[(&'static str, &'static str, &'static str)]) -> Vec<Vec<(String, String)>> {
        let rows: Vec<[(&str, &str); 3]> = rows
            .iter()
            .map(|(g, i, j)| [("group", *g), ("instance", *i), ("job", *j)])
            .collect();
        label_sets(&rows.iter().map(|r| r.as_slice()).collect::<Vec<_>>())
    }

    /// Cases from upstream `functions.test` (sort_by_label / sort_by_label_desc).
    #[test]
    fn test_sort_by_label_matches_upstream() {
        let (c, p) = ("canary", "production");
        let (api, app) = ("api-server", "app-server");
        let by_instance = gij(&[
            (c, "0", api),
            (c, "0", app),
            (p, "0", api),
            (p, "0", app),
            (c, "1", api),
            (c, "1", app),
            (p, "1", api),
            (p, "1", app),
            (c, "2", api),
            (p, "2", api),
        ]);
        for labels in [r#""instance""#, r#""instance", "group""#] {
            let query = format!("sort_by_label(http_requests, {labels})");
            assert_eq!(ordered(&query, &HTTP_REQUESTS), by_instance, "{query}");
        }
        assert_eq!(
            ordered(
                r#"sort_by_label(http_requests, "group", "instance", "job")"#,
                &HTTP_REQUESTS
            ),
            gij(&[
                (c, "0", api),
                (c, "0", app),
                (c, "1", api),
                (c, "1", app),
                (c, "2", api),
                (p, "0", api),
                (p, "0", app),
                (p, "1", api),
                (p, "1", app),
                (p, "2", api),
            ])
        );
        assert_eq!(
            ordered(
                r#"sort_by_label(http_requests, "job", "instance", "group")"#,
                &HTTP_REQUESTS
            ),
            gij(&[
                (c, "0", api),
                (p, "0", api),
                (c, "1", api),
                (p, "1", api),
                (c, "2", api),
                (p, "2", api),
                (c, "0", app),
                (p, "0", app),
                (c, "1", app),
                (p, "1", app),
            ])
        );
        let desc = gij(&[
            (p, "2", api),
            (c, "2", api),
            (p, "1", app),
            (p, "1", api),
            (c, "1", app),
            (c, "1", api),
            (p, "0", app),
            (p, "0", api),
            (c, "0", app),
            (c, "0", api),
        ]);
        for labels in [
            r#""instance""#,
            r#""instance", "group""#,
            r#""instance", "group", "job""#,
        ] {
            let query = format!("sort_by_label_desc(http_requests, {labels})");
            assert_eq!(ordered(&query, &HTTP_REQUESTS), desc, "{query}");
        }

        let cpus = ["0", "1", "2", "3", "10", "11", "12", "20", "21", "100"];
        let cpu_rows: Vec<[(&str, &str); 2]> = cpus
            .iter()
            .rev()
            .map(|cpu| [("job", "cpu"), ("cpu", *cpu)])
            .collect();
        let cpu_rows: Vec<&[(&str, &str)]> = cpu_rows.iter().map(|r| r.as_slice()).collect();
        let expected: Vec<[(&str, &str); 2]> = cpus
            .iter()
            .map(|cpu| [("job", "cpu"), ("cpu", *cpu)])
            .collect();
        assert_eq!(
            ordered(r#"sort_by_label(cpu_time_total, "cpu")"#, &cpu_rows),
            label_sets(&expected.iter().map(|r| r.as_slice()).collect::<Vec<_>>())
        );

        let uname: [&[(&str, &str)]; 3] = [
            &[("instance", "4m600"), ("release", "1.2.3")],
            &[("instance", "4m5"), ("release", "1.11.3")],
            &[("instance", "4m1000"), ("release", "1.111.3")],
        ];
        let releases = |rows: Vec<Vec<(String, String)>>| -> Vec<String> {
            rows.into_iter().map(|row| row[1].1.clone()).collect()
        };
        assert_eq!(
            releases(ordered(
                r#"sort_by_label(node_uname_info, "instance")"#,
                &uname
            )),
            ["1.11.3", "1.2.3", "1.111.3"]
        );
        assert_eq!(
            releases(ordered(
                r#"sort_by_label(node_uname_info, "release")"#,
                &uname
            )),
            ["1.2.3", "1.11.3", "1.111.3"]
        );
    }
}

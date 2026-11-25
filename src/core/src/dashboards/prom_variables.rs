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

//! PromQL variable queries, parsed as the dashboard's `parsePromVariableQuery` parses them.

use std::sync::LazyLock;

use regex::Regex;

static FUNCTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^([a-z_]+)\s*\((.*)\)$").expect("variable function regex"));
static LABEL_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").expect("label name regex"));

/// What a Grafana-style PromQL variable query reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromVariableQuery<'a> {
    /// The selector or expression the function evaluates.
    Reads(&'a str),
    /// `label_values(label)`, `label_names()` or `metrics(regex)`: a lookup across every metric.
    EveryMetric,
    /// Text that is not `label_values`, `label_names`, `metrics` or `query_result` called.
    NotAVariableFunction,
    /// A variable function with arguments the dashboard refuses to run.
    Unsupported,
}

impl<'a> PromVariableQuery<'a> {
    pub fn parse(query: &'a str) -> Self {
        let Some(caps) = FUNCTION.captures(query.trim()) else {
            return Self::NotAVariableFunction;
        };
        let args = caps.get(2).map_or("", |m| m.as_str()).trim();
        let commas = top_level_commas(args);
        match caps.get(1).map_or("", |m| m.as_str()) {
            "label_values" => label_values(args, &commas),
            "label_names" if !commas.is_empty() => Self::Unsupported,
            "label_names" | "query_result" if !args.is_empty() => Self::Reads(args),
            "label_names" | "metrics" => Self::EveryMetric,
            "query_result" => Self::Unsupported,
            _ => Self::NotAVariableFunction,
        }
    }
}

/// `parseLabelValues`: `label_values([selector,] label)` with a bare label name.
fn label_values<'a>(args: &'a str, commas: &[usize]) -> PromVariableQuery<'a> {
    let (selector, label) = match commas {
        [] => ("", args),
        [at] => (args[..*at].trim(), args[at + 1..].trim()),
        _ => return PromVariableQuery::Unsupported,
    };
    if !LABEL_NAME.is_match(label) || (!commas.is_empty() && selector.is_empty()) {
        PromVariableQuery::Unsupported
    } else if selector.is_empty() {
        PromVariableQuery::EveryMetric
    } else {
        PromVariableQuery::Reads(selector)
    }
}

/// Byte offsets of the commas outside brackets and quotes.
fn top_level_commas(text: &str) -> Vec<usize> {
    let mut commas = Vec::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (i, c) in text.char_indices() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' | '`' => quote = Some(c),
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => commas.push(i),
            _ => {}
        }
    }
    commas
}

#[cfg(test)]
mod tests {
    use super::{PromVariableQuery::*, *};

    #[test]
    fn variable_functions_name_the_expression_they_evaluate() {
        let cases = [
            (r#"label_values(up{a="x,y"}, job)"#, Reads(r#"up{a="x,y"}"#)),
            (" label_values( up , job ) ", Reads("up")),
            (
                r#"label_values(up{a="\"),"}, job)"#,
                Reads(r#"up{a="\"),"}"#),
            ),
            ("label_values(job)", EveryMetric),
            ("label_names()", EveryMetric),
            (r#"label_names(up{a="b"})"#, Reads(r#"up{a="b"}"#)),
            ("metrics(^http_.*)", EveryMetric),
            ("metrics()", EveryMetric),
            ("query_result(topk(3, up))", Reads("topk(3, up)")),
            ("query_result(\n  sum(up)\n)", Reads("sum(up)")),
        ];
        for (query, want) in cases {
            assert_eq!(PromVariableQuery::parse(query), want, "{query}");
        }
    }

    #[test]
    fn arguments_the_dashboard_refuses_are_unsupported() {
        for query in [
            "label_values(, job)",
            "label_values(up, a, b)",
            r#"label_values(up, "job")"#,
            "label_values(up, job-name)",
            "label_values()",
            "label_names(up, job)",
            "query_result()",
            "query_result(   )",
        ] {
            assert_eq!(PromVariableQuery::parse(query), Unsupported, "{query}");
        }
    }

    #[test]
    fn other_text_is_not_a_variable_function() {
        for query in [
            "up",
            "rate(up[5m])",
            "Label_values(up, job)",
            "label_values(up, job) + 1",
            "sum by (job) (up)",
            "",
        ] {
            assert_eq!(
                PromVariableQuery::parse(query),
                NotAVariableFunction,
                "{query}"
            );
        }
    }
}

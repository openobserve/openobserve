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

//! A small, stable JSON tree of a PromQL query, in OpenObserve's own shape.

use std::time::Duration;

use config::utils::json::{Value, json};
use promql_parser::{
    label::{METRIC_NAME, MatchOp, Matchers},
    parser::{
        AggregateExpr, BinaryExpr, Call, Expr, LabelModifier, MatrixSelector,
        VectorMatchCardinality, VectorSelector,
    },
    util::display_duration,
};

/// Far above any range a query would use, so a stand-in cannot collide with a real one.
const TOKEN_RANGE_BASE_MS: u64 = 1_000_000_007;

/// Template tokens in range position, swapped for durations so the query parses.
struct RangeTokens(Vec<String>);

impl RangeTokens {
    /// Replaces each `$var` / `${var}` inside `[…]` with a unique stand-in duration.
    fn neutralise(query: &str) -> (String, Self) {
        let chars: Vec<char> = query.chars().collect();
        let mut out = String::with_capacity(query.len());
        let mut tokens = Vec::new();
        let mut quote: Option<char> = None;
        let mut in_range = false;
        let mut i = 0;
        while i < chars.len() {
            let ch = chars[i];
            if ch == '$' && in_range && quote.is_none() {
                let end = token_end(&chars, i);
                if end > i + 1 {
                    let ms = TOKEN_RANGE_BASE_MS + tokens.len() as u64;
                    tokens.push(chars[i..end].iter().collect());
                    out.push_str(&format!("{ms}ms"));
                    i = end;
                    continue;
                }
            }
            match (quote, ch) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), '\\') => {
                    out.push(ch);
                    i += 1;
                    if let Some(next) = chars.get(i) {
                        out.push(*next);
                    }
                    i += 1;
                    continue;
                }
                (None, '"' | '\'' | '`') => quote = Some(ch),
                (None, '[') => in_range = true,
                (None, ']') => in_range = false,
                _ => {}
            }
            out.push(ch);
            i += 1;
        }
        (out, Self(tokens))
    }

    fn display(&self, range: &Duration) -> String {
        let index = (range.as_millis() as u64).checked_sub(TOKEN_RANGE_BASE_MS);
        index
            .and_then(|index| self.0.get(index as usize))
            .cloned()
            .unwrap_or_else(|| display_duration(range))
    }
}

/// Parses `query` into the tree, or returns the parser's message.
pub fn parse_tree(query: &str) -> Result<Value, String> {
    let (neutral, tokens) = RangeTokens::neutralise(query);
    let expr = promql_parser::parser::parse(&neutral)?;
    Ok(node(&expr, &tokens))
}

fn unsupported(kind: &str) -> Value {
    json!({ "type": "unsupported", "kind": kind })
}

fn node(expr: &Expr, tokens: &RangeTokens) -> Value {
    match expr {
        Expr::VectorSelector(vs) => selector_node(vs),
        Expr::MatrixSelector(ms) => matrix_node(ms, tokens),
        Expr::Call(call) => call_node(call, tokens),
        Expr::Aggregate(agg) => aggregate_node(agg, tokens),
        Expr::Binary(bin) => binary_node(bin, tokens),
        Expr::NumberLiteral(n) if n.val.is_finite() => json!({ "type": "number", "value": n.val }),
        Expr::NumberLiteral(_) => unsupported("non-finite number"),
        Expr::Paren(paren) => json!({ "type": "paren", "expr": node(&paren.expr, tokens) }),
        Expr::Subquery(_) => unsupported("subquery"),
        Expr::Unary(_) => unsupported("unary minus"),
        Expr::StringLiteral(_) => unsupported("string"),
        Expr::Extension(_) => unsupported("extension"),
    }
}

/// `None` when the selector is plain; otherwise the construct that makes it not.
fn selector_modifier(vs: &VectorSelector) -> Option<&'static str> {
    if vs.offset.is_some() {
        Some("offset")
    } else if vs.at.is_some() {
        Some("@")
    } else if !vs.matchers.or_matchers.is_empty() {
        Some("or matchers")
    } else {
        None
    }
}

fn selector_fields(vs: &VectorSelector) -> Value {
    json!({ "name": vs.name, "matchers": matchers(&vs.matchers, vs.name.as_deref()) })
}

fn selector_node(vs: &VectorSelector) -> Value {
    if let Some(kind) = selector_modifier(vs) {
        return unsupported(kind);
    }
    let mut fields = selector_fields(vs);
    fields["type"] = json!("selector");
    fields
}

fn matrix_node(ms: &MatrixSelector, tokens: &RangeTokens) -> Value {
    if let Some(kind) = selector_modifier(&ms.vs) {
        return unsupported(kind);
    }
    json!({
        "type": "matrix",
        "range": tokens.display(&ms.range),
        "selector": selector_fields(&ms.vs),
    })
}

/// The selector's matchers, minus the `__name__` matcher its name already states.
fn matchers(matchers: &Matchers, name: Option<&str>) -> Vec<Value> {
    matchers
        .matchers
        .iter()
        .filter(|m| {
            !(m.name == METRIC_NAME
                && matches!(m.op, MatchOp::Equal)
                && Some(m.value.as_str()) == name)
        })
        .map(|m| json!({ "label": m.name, "op": m.op.to_string(), "value": m.value }))
        .collect()
}

fn call_node(call: &Call, tokens: &RangeTokens) -> Value {
    let args: Vec<Value> = call.args.args.iter().map(|arg| node(arg, tokens)).collect();
    json!({ "type": "call", "func": call.func.name, "args": args })
}

fn aggregate_node(agg: &AggregateExpr, tokens: &RangeTokens) -> Value {
    let by = match &agg.modifier {
        Some(LabelModifier::Exclude(_)) => return unsupported("without"),
        Some(LabelModifier::Include(labels)) => labels.labels.clone(),
        None => Vec::new(),
    };
    json!({
        "type": "aggregate",
        "op": agg.op.to_string(),
        "by": by,
        "param": agg.param.as_ref().map(|param| node(param, tokens)),
        "expr": node(&agg.expr, tokens),
    })
}

fn binary_node(bin: &BinaryExpr, tokens: &RangeTokens) -> Value {
    if let Some(modifier) = &bin.modifier {
        if modifier.return_bool {
            return unsupported("bool");
        }
        let one_to_one = matches!(modifier.card, VectorMatchCardinality::OneToOne);
        if modifier.matching.is_some() || !one_to_one {
            return unsupported("vector matching");
        }
    }
    json!({
        "type": "binary",
        "op": bin.op.to_string(),
        "lhs": node(&bin.lhs, tokens),
        "rhs": node(&bin.rhs, tokens),
    })
}

/// End (exclusive) of the template token starting at `start`, or `start + 1` if there is none.
fn token_end(chars: &[char], start: usize) -> usize {
    if chars.get(start + 1) == Some(&'{') {
        return chars[start..]
            .iter()
            .position(|c| *c == '}')
            .map_or(start + 1, |offset| start + offset + 1);
    }
    let mut end = start + 1;
    while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
        end += 1;
    }
    end
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;

    use super::*;

    fn tree(query: &str) -> Value {
        parse_tree(query).unwrap()
    }

    fn selector(name: &str, matchers: Value) -> Value {
        json!({ "type": "selector", "name": name, "matchers": matchers })
    }

    #[test]
    fn serialises_a_selector_without_the_name_matcher() {
        assert_eq!(
            tree(r#"x{job="api",code=~"5.."}"#),
            selector(
                "x",
                json!([
                    { "label": "job", "op": "=", "value": "api" },
                    { "label": "code", "op": "=~", "value": "5.." }
                ])
            )
        );
        assert_eq!(tree("x"), selector("x", json!([])));
    }

    #[test]
    fn serialises_a_call_over_a_matrix() {
        assert_eq!(
            tree(r#"rate(x{job!="a"}[5m])"#),
            json!({ "type": "call", "func": "rate", "args": [{
                "type": "matrix", "range": "5m",
                "selector": { "name": "x", "matchers": [{ "label": "job", "op": "!=", "value": "a" }] }
            }]})
        );
    }

    #[test]
    fn keeps_template_tokens_in_ranges() {
        let parsed = tree("rate(x[$__rate_interval]) + rate(y[${__interval}])");
        assert_eq!(parsed["lhs"]["args"][0]["range"], json!("$__rate_interval"));
        assert_eq!(parsed["rhs"]["args"][0]["range"], json!("${__interval}"));
    }

    #[test]
    fn serialises_aggregates_binaries_numbers_and_parens() {
        assert_eq!(
            tree("(topk by (job, instance) (10, x) + 1) * 2"),
            json!({ "type": "binary", "op": "*",
                "lhs": { "type": "paren", "expr": { "type": "binary", "op": "+",
                    "lhs": { "type": "aggregate", "op": "topk", "by": ["job", "instance"],
                        "param": { "type": "number", "value": 10.0 },
                        "expr": selector("x", json!([])) },
                    "rhs": { "type": "number", "value": 1.0 } } },
                "rhs": { "type": "number", "value": 2.0 } })
        );
        assert_eq!(
            tree("sum(x)"),
            json!({ "type": "aggregate", "op": "sum", "by": [], "param": null,
                "expr": selector("x", json!([])) })
        );
    }

    #[test]
    fn marks_every_other_construct_unsupported() {
        let kind = |q: &str| tree(q);
        assert_eq!(
            kind("max without (instance) (x)"),
            json!({ "type": "unsupported", "kind": "without" })
        );
        assert_eq!(
            kind("x offset 5m"),
            json!({ "type": "unsupported", "kind": "offset" })
        );
        assert_eq!(
            kind("x @ 100"),
            json!({ "type": "unsupported", "kind": "@" })
        );
        assert_eq!(
            kind("rate(x[5m] offset 1h)")["args"][0],
            json!({ "type": "unsupported", "kind": "offset" })
        );
        assert_eq!(
            kind("max_over_time(rate(x[5m])[1h:])")["args"][0],
            json!({ "type": "unsupported", "kind": "subquery" })
        );
        assert_eq!(
            kind("a / on(job) b"),
            json!({ "type": "unsupported", "kind": "vector matching" })
        );
        assert_eq!(
            kind("x > bool 1"),
            json!({ "type": "unsupported", "kind": "bool" })
        );
        assert_eq!(
            kind("-x"),
            json!({ "type": "unsupported", "kind": "unary minus" })
        );
        assert_eq!(
            kind(r#"count_values("v", x)"#)["param"],
            json!({ "type": "unsupported", "kind": "string" })
        );
    }

    #[test]
    fn a_two_metric_binary_is_still_a_binary() {
        let parsed = tree("rate(a[5m]) / rate(b[5m])");
        assert_eq!(parsed["type"], json!("binary"));
        assert_eq!(parsed["rhs"]["type"], json!("call"));
    }

    #[test]
    fn returns_the_parser_message_on_a_parse_error() {
        assert!(parse_tree("sum(x").unwrap_err().contains("unclosed"));
    }
}

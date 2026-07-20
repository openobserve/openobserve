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

//! Scoped variable resolver for composite-alert notification templates (§6).
//!
//! Today's alert template substitution is a flat `resp.replace("{key}", value)`
//! over a single row set. A composite has no single row set — its terms hit
//! different streams — so it exposes **namespaced** scopes instead:
//!
//! ```text
//! {a.value} {a.count} {a.state} {a.error}   # per-term scope
//! {a.rows[0].host}                          # indexed row field of term `a`
//! {composite.result} {composite.expression} # composite scope
//! ```
//!
//! This module resolves those dotted / `[N]`-indexed tokens against a
//! per-composite context object (the `_composite` field carried on the
//! synthetic context row). It runs as a post-pass AFTER the existing flat
//! substitution and ONLY for composite alerts, so non-composite alerts render
//! byte-identically. Unknown `{x.y}` tokens resolve to blank (design §6).

use std::sync::LazyLock;

use config::utils::json::{Map, Value};
use regex::Regex;

/// The key under which the composite template context is stashed on the
/// synthetic notification row.
pub const COMPOSITE_CONTEXT_KEY: &str = "_composite";

/// Matches a scoped token: `{scope.key}`, `{scope.key[N]}`,
/// `{scope.rows[N].field}`. Flat tokens like `{alert_name}` (no dot) never
/// match, so the flat renderer is untouched.
static TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\[(\d+)\])?(?:\.([A-Za-z0-9_]+))?\}")
        .expect("composite token regex")
});

/// Resolves composite `{scope.path}` tokens in `text` against `cx` (the
/// `_composite` context object). Unknown tokens become blank.
pub fn resolve_composite_vars(text: &str, cx: &Value) -> String {
    let terms = cx.get("terms").and_then(|t| t.as_object());
    TOKEN_RE
        .replace_all(text, |caps: &regex::Captures| {
            let scope = &caps[1];
            let key = &caps[2];
            let index = caps.get(3).and_then(|m| m.as_str().parse::<usize>().ok());
            let subfield = caps.get(4).map(|m| m.as_str());

            resolve_one(scope, key, index, subfield, cx, terms).unwrap_or_default()
        })
        .into_owned()
}

fn resolve_one(
    scope: &str,
    key: &str,
    index: Option<usize>,
    subfield: Option<&str>,
    cx: &Value,
    terms: Option<&Map<String, Value>>,
) -> Option<String> {
    // Composite scope: {composite.result} / {composite.expression}
    if scope == "composite" {
        // A row field named `composite` on a term would be ambiguous, but the
        // composite scope wins by construction (terms are `[a-z0-9_]` names the
        // author picks; `composite` is reserved for the composite scope).
        return cx.get(key).map(value_to_string);
    }

    // Term scope: {a.value} / {a.count} / {a.state} / {a.error} / {a.rows[N].f}
    let term = terms?.get(scope)?;
    if key == "rows" {
        let idx = index?;
        let field = subfield?;
        let rows = term.get("rows")?.as_array()?;
        let row = rows.get(idx)?;
        return row.get(field).map(value_to_string);
    }
    // Non-indexed term field (value/count/state/error/...).
    term.get(key).map(value_to_string)
}

/// Renders a scalar JSON value as the plain string used in templates (strings
/// without quotes, numbers/bools as-is, null as blank).
fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;

    use super::*;

    fn ctx() -> Value {
        json!({
            "result": "true",
            "expression": "(a && b) || c",
            "terms": {
                "a": {
                    "value": "123",
                    "count": 123,
                    "state": "true",
                    "error": null,
                    "rows": [{ "host": "node-1", "code": 500 }, { "host": "node-2" }]
                },
                "b": {
                    "value": "0",
                    "count": 0,
                    "state": "false",
                    "error": null,
                    "rows": []
                },
                "c": {
                    "value": "",
                    "count": 0,
                    "state": "error",
                    "error": "query timeout",
                    "rows": []
                }
            }
        })
    }

    #[test]
    fn test_composite_scope() {
        let c = ctx();
        assert_eq!(resolve_composite_vars("{composite.result}", &c), "true");
        assert_eq!(
            resolve_composite_vars("{composite.expression}", &c),
            "(a && b) || c"
        );
    }

    #[test]
    fn test_term_fields() {
        let c = ctx();
        assert_eq!(resolve_composite_vars("{a.value}", &c), "123");
        assert_eq!(resolve_composite_vars("{a.count}", &c), "123");
        assert_eq!(resolve_composite_vars("{a.state}", &c), "true");
        assert_eq!(resolve_composite_vars("{b.state}", &c), "false");
        assert_eq!(resolve_composite_vars("{c.state}", &c), "error");
        assert_eq!(resolve_composite_vars("{c.error}", &c), "query timeout");
    }

    #[test]
    fn test_indexed_rows() {
        let c = ctx();
        assert_eq!(resolve_composite_vars("{a.rows[0].host}", &c), "node-1");
        assert_eq!(resolve_composite_vars("{a.rows[0].code}", &c), "500");
        assert_eq!(resolve_composite_vars("{a.rows[1].host}", &c), "node-2");
        // Out-of-range / missing field → blank.
        assert_eq!(resolve_composite_vars("{a.rows[5].host}", &c), "");
        assert_eq!(resolve_composite_vars("{a.rows[1].code}", &c), "");
    }

    #[test]
    fn test_unknown_tokens_blank() {
        let c = ctx();
        // Unknown term / unknown field / null → blank.
        assert_eq!(resolve_composite_vars("{z.value}", &c), "");
        assert_eq!(resolve_composite_vars("{a.nope}", &c), "");
        assert_eq!(resolve_composite_vars("{a.error}", &c), "");
    }

    #[test]
    fn test_flat_tokens_untouched() {
        let c = ctx();
        // No dot → not a composite token → left verbatim for the flat renderer.
        assert_eq!(resolve_composite_vars("{alert_name}", &c), "{alert_name}");
        assert_eq!(
            resolve_composite_vars("hi {alert_name} {a.state}", &c),
            "hi {alert_name} true"
        );
    }

    #[test]
    fn test_mixed_message() {
        let c = ctx();
        let tpl = "Composite {composite.result}: a={a.count} on {a.rows[0].host}, b={b.state}";
        assert_eq!(
            resolve_composite_vars(tpl, &c),
            "Composite true: a=123 on node-1, b=false"
        );
    }
}

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

//! Turn search error responses into self-correcting ones (AX spec D4): parse
//! the candidates that the error producers embed in the message ("No field
//! named X. Valid fields are a, b, c."), rank them by edit distance, and
//! attach `hint` + `suggestions` to the HTTP body. Runs only at the HTTP edge;
//! the wire format between cluster nodes is unchanged.

use infra::errors::ErrorCodes;
use search::datafusion::udf::DEFAULT_FUNCTIONS;

use crate::common::meta::http::HttpResponse;

const MAX_SUGGESTIONS: usize = 3;
/// When no suggestion matched, a field list up to this size is offered in the
/// hint as a fallback; anything longer points to the schema endpoint instead
/// (hundreds of fields in an error are token noise).
const MAX_FIELDS_IN_MESSAGE: usize = 10;

/// Attach `hint`/`suggestions` to an error body when the error code carries
/// enough information. No-op for codes we have nothing smart to say about.
pub fn enrich(resp: &mut HttpResponse, code: &ErrorCodes) {
    match code {
        ErrorCodes::SearchFieldNotFound(inner) => enrich_field_not_found(resp, inner),
        ErrorCodes::SearchFunctionNotDefined(inner) => enrich_function_not_defined(resp, inner),
        _ => {}
    }
}

// Every fact appears in exactly one field: `message` names the problem,
// `suggestions` is the only place candidates live, `hint` exists only when it
// adds information the agent cannot infer (UDS explanation, usage example, a
// pointer when we have no suggestions). `error_detail` is dropped on
// successful enrichment — repeating the raw engine text would only add tokens.
fn enrich_field_not_found(resp: &mut HttpResponse, inner: &str) {
    let Some((field, valid_fields)) = parse_field_not_found(inner) else {
        return;
    };

    let suggestions = suggest(&field, valid_fields.iter().map(|s| s.as_str()));
    let is_uds = inner.contains("User-Defined Schema");

    resp.message = format!("unknown field '{field}'");
    resp.error_detail = None;
    resp.hint = if is_uds {
        Some(format!(
            "'{field}' exists in the stream but is not part of its User-Defined Schema; add it in stream settings or query a UDS field."
        ))
    } else if suggestions.is_empty() {
        // nothing similar — give the agent a next step instead of candidates
        if !valid_fields.is_empty() && valid_fields.len() <= MAX_FIELDS_IN_MESSAGE {
            Some(format!("valid fields: {}", valid_fields.join(", ")))
        } else {
            Some(
                "no similar field found; use the stream schema endpoint to list fields".to_string(),
            )
        }
    } else {
        None
    };
    if !suggestions.is_empty() {
        resp.suggestions = Some(suggestions);
    }
}

fn enrich_function_not_defined(resp: &mut HttpResponse, inner: &str) {
    let Some(func) = parse_function_name(inner) else {
        return;
    };

    // The registry snapshot covers every callable function: DataFusion
    // built-ins plus the O2 UDFs (same source DataFusion's own
    // "Did you mean" pulls from, minus per-org VRL functions).
    let candidates = search::datafusion::exec::registered_function_names()
        .iter()
        .map(|s| s.as_str());
    let suggestions = suggest(&func, candidates);

    resp.message = format!("unknown function '{func}'");
    resp.error_detail = None;
    // The hint carries only what suggestions can't: the usage example —
    // agents copy examples far more reliably than prose.
    resp.hint = suggestions
        .first()
        .and_then(|s| usage_example(s))
        .map(|text| format!("usage: {text}"));
    if !suggestions.is_empty() {
        resp.suggestions = Some(suggestions);
    }
}

/// Usage example for a suggested function: the UDF registry's own text, plus
/// hand-kept signatures for the non-UDF functions agents misuse most.
fn usage_example(name: &str) -> Option<String> {
    if let Some(udf) = DEFAULT_FUNCTIONS.iter().find(|f| f.name == name) {
        return Some(udf.text.to_string());
    }
    let text = match name {
        "histogram" => "histogram(_timestamp, '1 hour')",
        "date_bin" => "date_bin(interval '1 hour', _timestamp)",
        "date_format" => "date_format(_timestamp, '%Y-%m-%d', 'UTC')",
        "approx_percentile_cont" => "approx_percentile_cont(duration, 0.99)",
        "spath" => "spath(field, 'a.b.c')",
        "to_timestamp_micros" => "to_timestamp_micros('2026-01-01T00:00:00Z')",
        _ => return None,
    };
    Some(text.to_string())
}

/// Rebuild a FieldNotFound message with the authoritative schema field list.
/// The engine's own "Valid fields" reflect the pruned scan schema (often just
/// `_timestamp`) and are misleading — callers that know the stream pass the
/// real fields here before mapping the error to HTTP.
pub fn rebuild_field_not_found(inner: &str, schema_fields: &[String]) -> Option<String> {
    if inner.contains("User-Defined Schema") {
        // the validate path already embeds the correct UDS field list
        return None;
    }
    let (field, _) = parse_field_not_found(inner)?;
    if schema_fields.is_empty() {
        return None;
    }
    Some(format!(
        "No field named {field}. Valid fields are {}.",
        schema_fields.join(", ")
    ))
}

/// Parse "... No field named <f>. Valid fields are <a, b, c>." (both the
/// DataFusion Display shape and our producer sites). Field names may be
/// wrapped in backticks and/or qualified (`table.field`).
fn parse_field_not_found(inner: &str) -> Option<(String, Vec<String>)> {
    let rest = inner.split("No field named ").nth(1)?;
    let field_raw = rest.split('.').next()?.trim();
    let field = normalize_ident(field_raw);
    if field.is_empty() {
        return None;
    }

    let valid_fields = match rest.split("Valid fields are ").nth(1) {
        Some(list) => list
            .trim_end()
            .trim_end_matches('.')
            .split(", ")
            .map(normalize_ident)
            .filter(|s| !s.is_empty())
            .collect(),
        None => Vec::new(),
    };
    Some((field, valid_fields))
}

/// Parse the function name out of DataFusion's "Invalid function 'xyz'" text.
fn parse_function_name(inner: &str) -> Option<String> {
    let rest = inner.split("Invalid function ").nth(1)?;
    let name = rest
        .trim_start_matches(['\'', '"', '`'])
        .split(['\'', '"', '`', '.', '\n'])
        .next()?
        .trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Strip backticks and a `table.` qualifier: `` `logs`.`status` `` -> status.
fn normalize_ident(raw: &str) -> String {
    let s = raw.trim().trim_matches('`');
    match s.rsplit_once('.') {
        Some((_, unqualified)) => unqualified.trim_matches('`').to_string(),
        None => s.to_string(),
    }
}

/// Rank candidates by edit distance to `target` (case-insensitive), keeping
/// close matches and prefix/substring matches, best-first, top 3.
fn suggest<'a>(target: &str, candidates: impl Iterator<Item = &'a str>) -> Vec<String> {
    let target_lc = target.to_lowercase();
    let threshold = (target_lc.chars().count() / 3).max(2);
    let mut scored: Vec<(usize, &str)> = candidates
        .filter(|c| !c.starts_with('_')) // system fields are rarely what a typo meant
        .filter_map(|c| {
            let c_lc = c.to_lowercase();
            let mut dist = levenshtein(&target_lc, &c_lc);
            // A candidate whose *prefix* matches the typo is still a likely
            // intention ("satus" -> "status_code"); rank it after full matches
            // via a +1 penalty.
            if c_lc.chars().count() > target_lc.chars().count() {
                let prefix: String = c_lc.chars().take(target_lc.chars().count() + 1).collect();
                dist = dist.min(levenshtein(&target_lc, &prefix) + 1);
            }
            let related = c_lc.contains(&target_lc) || target_lc.contains(&c_lc);
            (dist <= threshold || related).then_some((dist, c))
        })
        .collect();
    scored.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.len().cmp(&b.1.len())));
    let mut out: Vec<String> = Vec::new();
    for (_, c) in scored {
        if !out.iter().any(|s| s == c) {
            out.push(c.to_string());
        }
        if out.len() >= MAX_SUGGESTIONS {
            break;
        }
    }
    out
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        curr[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            curr[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(curr[j] + 1);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body() -> HttpResponse {
        HttpResponse::message(400u16, "orig")
    }

    #[test]
    fn parses_datafusion_shape_with_qualifier() {
        let (field, valid) = parse_field_not_found(
            "Schema error: No field named nonexist. Valid fields are logs._timestamp, logs.status, logs.message.",
        )
        .unwrap();
        assert_eq!(field, "nonexist");
        assert_eq!(valid, vec!["_timestamp", "status", "message"]);
    }

    #[test]
    fn parses_backticked_idents() {
        let (field, valid) = parse_field_not_found(
            "No field named `satus`. Valid fields are `logs`.`status`, `logs`.`status_code`.",
        )
        .unwrap();
        assert_eq!(field, "satus");
        assert_eq!(valid, vec!["status", "status_code"]);
    }

    #[test]
    fn field_typo_gets_suggestions_without_duplication() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFieldNotFound(
                "No field named satus. Valid fields are _timestamp, status, status_code, level."
                    .to_string(),
            ),
        );
        assert_eq!(
            resp.suggestions,
            Some(vec!["status".to_string(), "status_code".to_string()])
        );
        assert_eq!(resp.message, "unknown field 'satus'");
        // no fact appears twice: candidates live only in suggestions
        assert!(resp.hint.is_none());
        assert!(resp.error_detail.is_none());
    }

    #[test]
    fn no_similar_field_falls_back_to_field_list_hint() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFieldNotFound(
                "No field named zzz_totally_off. Valid fields are _timestamp, status, level."
                    .to_string(),
            ),
        );
        assert!(resp.suggestions.is_none());
        assert!(resp.hint.unwrap().contains("valid fields: _timestamp"));
    }

    #[test]
    fn wide_schema_without_match_points_to_schema_endpoint() {
        let valid = (0..50)
            .map(|i| format!("column_{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFieldNotFound(format!(
                "No field named zzz_totally_off. Valid fields are {valid}."
            )),
        );
        assert!(resp.suggestions.is_none());
        assert!(resp.hint.unwrap().contains("stream schema endpoint"));
        assert!(resp.error_detail.is_none());
    }

    #[test]
    fn uds_error_gets_uds_hint() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFieldNotFound(
                "No field named level. Field exists in the stream but not in its User-Defined Schema (UDS). Valid fields are _timestamp, message."
                    .to_string(),
            ),
        );
        assert!(resp.hint.unwrap().contains("User-Defined Schema"));
    }

    #[test]
    fn function_typo_suggests_udf_with_usage() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFunctionNotDefined(
                "Error during planning: Invalid function 'str_mach'.".to_string(),
            ),
        );
        assert_eq!(resp.suggestions.as_ref().unwrap()[0], "str_match");
        assert_eq!(resp.hint.as_deref(), Some("usage: str_match(field, 'v')"));
        assert!(resp.error_detail.is_none());
    }

    #[test]
    fn function_common_sql_suggested_with_usage() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFunctionNotDefined("Invalid function 'histgram'".to_string()),
        );
        assert_eq!(resp.suggestions.unwrap()[0], "histogram");
        assert!(
            resp.hint
                .unwrap()
                .contains("histogram(_timestamp, '1 hour')")
        );
    }

    #[test]
    fn function_datafusion_builtin_suggested() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFunctionNotDefined("Invalid function 'cout'".to_string()),
        );
        assert!(resp.suggestions.unwrap().contains(&"count".to_string()));
    }

    #[test]
    fn unparseable_message_is_left_untouched() {
        let mut resp = body();
        enrich(
            &mut resp,
            &ErrorCodes::SearchFieldNotFound("something completely different".to_string()),
        );
        assert_eq!(resp.message, "orig");
        assert!(resp.suggestions.is_none());
    }

    #[test]
    fn levenshtein_basics() {
        assert_eq!(levenshtein("status", "satus"), 1);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", "abc"), 0);
    }
}

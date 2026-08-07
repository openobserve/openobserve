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

//! The custom-kind template renderer: a pure string rewrite over a
//! [`NotificationContext`].
//!
//! This is the path every existing customer's alert notification goes through,
//! so it is locked byte-for-byte by the golden corpus at the bottom of this
//! file. The substitution ORDER is load-bearing — most notably group labels
//! substitute last, which is the only thing stopping a pod named
//! `{alert_name}` from being expanded by a later pass.

use config::utils::json::Value;

use super::context::NotificationContext;

/// Render `tpl` against `ctx`. Pure: no I/O, no clock, no DB.
pub fn apply_custom_template(tpl: &str, ctx: &NotificationContext, is_email: bool) -> String {
    let evaluation_timestamp = ctx.alert_trigger_time;
    let evaluation_timestamp_millis = evaluation_timestamp / 1000;
    let evaluation_timestamp_seconds = evaluation_timestamp_millis / 1000;
    let rows_tpl_val: &[Value] = &ctx.rows_tpl_val;

    let mut resp = tpl
        .replace("{org_name}", &ctx.org_name)
        .replace("{stream_type}", &ctx.stream_type)
        .replace("{stream_name}", &ctx.stream_name)
        .replace("{alert_name}", &ctx.alert_name)
        .replace("{alert_type}", &ctx.alert_type)
        .replace("{alert_period}", &ctx.alert_period)
        .replace("{alert_operator}", &ctx.alert_operator)
        .replace("{alert_threshold}", &ctx.alert_threshold)
        .replace("{alert_count}", &ctx.alert_count)
        .replace("{alert_agg_value}", &ctx.alert_agg_value)
        // Multi-level threshold variables (alerts_2.md T-5). `{alert_level}` is
        // what lets a template branch warning vs critical wording — per-level
        // DESTINATIONS are Phase 4; v1 routing is template-side.
        .replace("{alert_level}", &ctx.alert_level)
        // Feature 2 (PT-4 / PT-9). Scope is DESTINATION TEMPLATES ONLY (D25):
        // incident notifications build custom JSON and workflows carry
        // hard-coded metadata; neither is wired here in v1. Unset priority and
        // empty tags render as "" rather than "P0"/"null", so a template that
        // interpolates them unconditionally still produces clean output.
        .replace("{alert_priority}", &ctx.alert_priority)
        .replace("{alert_tags}", &ctx.alert_tags)
        .replace("{alert_threshold_crit}", &ctx.alert_threshold_crit)
        .replace("{alert_threshold_warn}", &ctx.alert_threshold_warn)
        // Legacy alias for `{alert_threshold_warn}` — now family-aware too;
        // previously it always read the count-family warning.
        .replace("{alert_warning_threshold}", &ctx.alert_threshold_warn)
        .replace("{alert_start_time}", &ctx.alert_start_time)
        .replace("{alert_end_time}", &ctx.alert_end_time)
        .replace("{alert_url}", &ctx.alert_url)
        .replace("{alert_trigger_time}", &evaluation_timestamp.to_string())
        .replace(
            "{alert_trigger_time_millis}",
            &evaluation_timestamp_millis.to_string(),
        )
        .replace(
            "{alert_trigger_time_seconds}",
            &evaluation_timestamp_seconds.to_string(),
        )
        .replace("{alert_trigger_time_str}", &ctx.alert_trigger_time_str)
        // Back-compat alias: shipped prebuilt bodies historically used {alert_time},
        // which was never substituted. Alias it to the trigger-time string.
        .replace("{alert_time}", &ctx.alert_trigger_time_str)
        .replace("{alert_description}", &ctx.alert_description);

    if let (Some(operator), Some(value)) = (&ctx.promql_operator, &ctx.promql_value) {
        resp = resp
            .replace("{alert_promql_operator}", operator)
            .replace("{alert_promql_value}", value);
    }

    // Check if {rows}, {rows:N}, {...rows}, or {...rows:N} is in a JSON context
    let is_json_rows_context = check_json_context(&resp, "rows");

    if is_json_rows_context {
        // Check if all row_tpl_val elements are actual JSON values (not string fallbacks)
        let all_json = rows_tpl_val.iter().all(|v| !v.is_string());

        if all_json {
            // Handle "{rows}" and "{rows:N}" — standard (non-spread) replacement
            if resp.contains("\"{rows}\"") || extract_rows_limit(&resp).is_some() {
                let row_limit = extract_rows_limit(&resp);
                let limited_rows = if let Some(n) = row_limit {
                    &rows_tpl_val[..n.min(rows_tpl_val.len())]
                } else {
                    rows_tpl_val
                };

                let json_array = Value::Array(limited_rows.to_vec());
                let json_str =
                    serde_json::to_string(&json_array).unwrap_or_else(|_| "[]".to_string());

                if let Some(n) = row_limit {
                    let pattern = format!("\"{{rows:{n}}}\"");
                    resp = resp.replace(&pattern, &json_str);
                    // Also replace plain "{rows}" if it coexists
                    if resp.contains("\"{rows}\"") {
                        let all_rows_str =
                            serde_json::to_string(&Value::Array(rows_tpl_val.to_vec()))
                                .unwrap_or_else(|_| "[]".to_string());
                        resp = resp.replace("\"{rows}\"", &all_rows_str);
                    }
                } else {
                    resp = resp.replace("\"{rows}\"", &json_str);
                }
            }

            // Handle "{...rows}" and "{...rows:N}" — spread/flatten replacement
            if has_spread_rows(&resp) {
                let spread_limit = extract_spread_rows_limit(&resp);
                let spread_rows = if let Some(n) = spread_limit {
                    &rows_tpl_val[..n.min(rows_tpl_val.len())]
                } else {
                    rows_tpl_val
                };

                // Flatten: if a row value is an array, spread its elements; otherwise include as-is
                let flattened: Vec<Value> = spread_rows
                    .iter()
                    .flat_map(|v| match v {
                        Value::Array(arr) => arr.clone(),
                        other => vec![other.clone()],
                    })
                    .collect();

                let json_str = serde_json::to_string(&Value::Array(flattened))
                    .unwrap_or_else(|_| "[]".to_string());

                if let Some(n) = spread_limit {
                    let pattern = format!("\"{{...rows:{n}}}\"");
                    resp = resp.replace(&pattern, &json_str);
                    // Also replace plain "{...rows}" if it coexists
                    if resp.contains("\"{...rows}\"") {
                        let all_flattened: Vec<Value> = rows_tpl_val
                            .iter()
                            .flat_map(|v| match v {
                                Value::Array(arr) => arr.clone(),
                                other => vec![other.clone()],
                            })
                            .collect();
                        let all_str = serde_json::to_string(&Value::Array(all_flattened))
                            .unwrap_or_else(|_| "[]".to_string());
                        resp = resp.replace("\"{...rows}\"", &all_str);
                    }
                } else {
                    resp = resp.replace("\"{...rows}\"", &json_str);
                }
            }
        } else {
            // Fallback to string behavior for non-JSON row values
            process_variable_replace(
                &mut resp,
                "rows",
                &VarValue::JsonArray(rows_tpl_val),
                is_email,
            );
        }
    } else {
        // Normal string replacement (non-JSON context)
        process_variable_replace(
            &mut resp,
            "rows",
            &VarValue::JsonArray(rows_tpl_val),
            is_email,
        );
    }

    for (key, values) in ctx.row_columns.iter() {
        // Match both bare `{key}` and length-suffixed `{key:N}` forms.
        if resp.contains(&format!("{{{key}}}")) || resp.contains(&format!("{{{key}:")) {
            process_variable_replace(&mut resp, key, &VarValue::Str(&values.join(", ")), is_email);
        }
    }
    for (key, value) in ctx.context_attributes.iter() {
        process_variable_replace(&mut resp, key, &VarValue::Str(value), is_email);
    }

    // Substitute endpoint metadata variables (e.g., credential_assignmentGroup,
    // credential_priority)
    for (key, value) in ctx.metadata.iter() {
        resp = resp.replace(&format!("{{{}}}", key), value);
    }

    // ── Group variables, LAST (M-4) ─────────────────────────────────────────
    // Position is the whole defence, not a detail. Label values are user data
    // and can contain `{...}`; because nothing runs after this, a pod named
    // `{alert_name}` is written literally instead of being expanded into the
    // alert's name by a later pass. Anything added below this point reopens
    // that hole.
    //
    // The `group.` prefix is the other half: it stops a label called
    // `alert_name` from shadowing the alert's own variable.
    if let Some(labels) = &ctx.group_labels {
        for (name, value) in config::meta::alerts::grouping::group_template_vars(labels) {
            process_variable_replace(&mut resp, &name, &VarValue::Str(&value), is_email);
        }
    }

    resp
}

/// Stringify one row value exactly the way `get_row_column_map` always has.
pub(crate) fn stringify_row_value(value: &Value) -> String {
    if value.is_string() {
        value.as_str().unwrap_or_default().to_string()
    } else if value.is_f64() {
        value.as_f64().unwrap_or_default().to_string()
    } else {
        value.to_string()
    }
}

/// Checks if a variable is being used in a JSON context (i.e., as a direct value in JSON)
/// For example, {"key": "{var}"} returns true, but {"key": "text {var} text"} returns false.
/// Also detects "{var:N}" patterns (e.g., "{rows:3}") and spread patterns
/// "{...var}" / "{...var:N}".
pub(crate) fn check_json_context(tpl: &str, var_name: &str) -> bool {
    // Check for "{var}" pattern
    let pattern_with_quotes = format!("\"{{{var_name}}}\"");
    if is_json_value_position(tpl, &pattern_with_quotes) {
        return true;
    }

    // Check for "{var:N}" pattern (e.g., "{rows:3}")
    if check_json_context_with_prefix(tpl, &format!("\"{{{var_name}:")) {
        return true;
    }

    // Check for "{...var}" spread pattern
    let spread_pattern = format!("\"{{...{var_name}}}\"");
    if is_json_value_position(tpl, &spread_pattern) {
        return true;
    }

    // Check for "{...var:N}" spread pattern (e.g., "{...rows:3}")
    if check_json_context_with_prefix(tpl, &format!("\"{{...{var_name}:")) {
        return true;
    }

    false
}

/// Helper to check if a "{var:N}" or "{...var:N}" style pattern is in JSON value position.
pub(crate) fn check_json_context_with_prefix(tpl: &str, prefix: &str) -> bool {
    if let Some(start) = tpl.find(prefix) {
        let after_prefix = start + prefix.len();
        if let Some(end) = tpl[after_prefix..].find("}\"") {
            let num_str = &tpl[after_prefix..after_prefix + end];
            if num_str.parse::<usize>().is_ok() {
                let full_pattern = &tpl[start..after_prefix + end + 2]; // includes closing }"
                if is_json_value_position(tpl, full_pattern) {
                    return true;
                }
            }
        }
    }
    false
}

/// Checks if a pattern appears in a JSON value position (after `:` and before `,` or `}`)
pub(crate) fn is_json_value_position(tpl: &str, pattern: &str) -> bool {
    if let Some(pos) = tpl.find(pattern) {
        let before = &tpl[..pos];
        let after = &tpl[pos + pattern.len()..];

        let before_trimmed = before.trim_end();
        let after_trimmed = after.trim_start();

        if before_trimmed.ends_with(':')
            && (after_trimmed.starts_with(',') || after_trimmed.starts_with('}'))
        {
            return true;
        }
    }
    false
}

/// Extracts the row limit N from a "{rows:N}" pattern in the template string.
/// Returns None if only "{rows}" is present (no limit).
pub(crate) fn extract_rows_limit(tpl: &str) -> Option<usize> {
    extract_limit_with_prefix(tpl, "\"{rows:")
}

/// Extracts the row limit N from a "{...rows:N}" spread pattern in the template string.
/// Returns None if only "{...rows}" is present (no limit).
pub(crate) fn extract_spread_rows_limit(tpl: &str) -> Option<usize> {
    extract_limit_with_prefix(tpl, "\"{...rows:")
}

/// Returns true if the template contains a spread rows pattern ("{...rows}" or "{...rows:N}").
pub(crate) fn has_spread_rows(tpl: &str) -> bool {
    tpl.contains("\"{...rows}\"") || extract_spread_rows_limit(tpl).is_some()
}

pub(crate) fn extract_limit_with_prefix(tpl: &str, prefix: &str) -> Option<usize> {
    if let Some(start) = tpl.find(prefix) {
        let after_prefix = start + prefix.len();
        if let Some(end) = tpl[after_prefix..].find("}\"") {
            let num_str = &tpl[after_prefix..after_prefix + end];
            return num_str.parse::<usize>().ok();
        }
    }
    None
}

pub(crate) fn process_variable_replace(
    tpl: &mut String,
    var_name: &str,
    var_val: &VarValue,
    is_email: bool,
) {
    scan_and_replace_var(tpl, var_name, |len| {
        var_val.to_string_with_length(len, is_email)
    });
}

/// Shared `{var}` / `{var:N}` scanner.
///
/// Used by both the custom-kind path ([`process_variable_replace`], which
/// bakes JSON-escaping into `render`) and the content-kind path
/// (`super::resolve::substitute_raw`, which passes through raw values with NO
/// escaping — escaping there happens later, per-format, in the renderers).
/// `render(len)` receives the requested truncation length (`0` = no
/// truncation, i.e. the bare `{var}` form) and returns the final replacement
/// string; it decides escaping, truncation, and formatting.
pub(crate) fn scan_and_replace_var(
    tpl: &mut String,
    var_name: &str,
    mut render: impl FnMut(usize) -> String,
) {
    // 1) Handle every `{var:N}` occurrence first. We scan left-to-right and advance `cursor` past
    //    each match so we don't loop forever on inputs that can't be parsed (e.g. `{var:abc}`) and
    //    so multiple distinct lengths in the same template (`{msg:100}` and `{msg:200}`) are all
    //    replaced.
    let prefix = format!("{{{var_name}:");
    let mut cursor = 0usize;
    while let Some(rel_start) = tpl[cursor..].find(&prefix) {
        let start = cursor + rel_start;
        let num_start = start + prefix.len();
        let Some(end_offset) = tpl[num_start..].find('}') else {
            break;
        };
        let num_end = num_start + end_offset;
        let full_end = num_end + 1; // include the closing `}`
        let len = tpl[num_start..num_end].parse::<usize>().unwrap_or_default();
        if len > 0 {
            let replacement = render(len);
            tpl.replace_range(start..full_end, &replacement);
            cursor = start + replacement.len();
        } else {
            // Invalid/zero length — skip past this occurrence to avoid an
            // infinite loop, but leave the original substring untouched.
            cursor = full_end;
        }
    }

    // 2) Then handle every bare `{var}` occurrence.
    let bare = format!("{{{var_name}}}");
    if tpl.contains(&bare) {
        *tpl = tpl.replace(&bare, &render(0));
    }
}

pub(crate) fn format_variable_value(val: String) -> String {
    val.chars()
        .map(|c| match c {
            '\'' => "\\\\'".to_string(),
            '"' => "\\\"".to_string(),
            '\\' => "\\\\".to_string(),
            '\n' => "\\n".to_string(),
            '\r' => "\\r".to_string(),
            '\t' => "\\t".to_string(),
            '\0' => "\\u{0}".to_string(),
            '\x1b' => "\\u{1b}".to_string(),
            '\x08' => "\\u{8}".to_string(),
            '\x0c' => "\\u{c}".to_string(),
            '\x0b' => "\\u{b}".to_string(),
            '\x01' => "\\u{1}".to_string(),
            '\x02' => "\\u{2}".to_string(),
            '\x1f' => "\\u{1f}".to_string(),
            _ => c.to_string(),
        })
        .collect::<String>()
}

pub(crate) enum VarValue<'a> {
    Str(&'a str),
    JsonArray(&'a [Value]),
}

impl VarValue<'_> {
    pub(crate) fn len(&self) -> usize {
        match self {
            VarValue::Str(v) => v.chars().count(),
            VarValue::JsonArray(v) => v.len(),
        }
    }

    pub(crate) fn to_string_with_length(&self, n: usize, is_email: bool) -> String {
        let n = if n > 0 && n < self.len() {
            n
        } else {
            self.len()
        };
        match self {
            VarValue::Str(v) => format_variable_value(v.chars().take(n).collect()),
            VarValue::JsonArray(v) => {
                // Convert JSON values to strings
                let strings: Vec<String> = v[0..n]
                    .iter()
                    .map(|val| {
                        if val.is_string() {
                            format_variable_value(val.as_str().unwrap_or("").to_string())
                        } else {
                            format_variable_value(val.to_string())
                        }
                    })
                    .collect();
                strings.join(if is_email { "" } else { "\\n" })
            }
        }
    }
}

#[cfg(test)]
mod golden {
    //! Byte-identity corpus for the custom-kind renderer.
    //!
    //! These constants were captured from the CURRENT (pre-refactor) output and
    //! frozen. They are the contract every existing customer's notification
    //! already depends on. NEVER edit a GOLDEN_* to make a change pass — if a
    //! golden breaks, the change broke rendering.

    use config::meta::alerts::level::AlertLevel;

    use super::*;

    fn fixture_ctx() -> NotificationContext {
        NotificationContext {
            org_name: "default".into(),
            stream_type: "logs".into(),
            stream_name: "app".into(),
            alert_name: "CPU \"high\"".into(), // hostile: quote must JSON-escape
            alert_type: "scheduled".into(),
            alert_period: "10".into(),
            alert_operator: ">=".into(),
            alert_threshold: "80".into(),
            alert_count: "3".into(),
            alert_agg_value: "92.5".into(),
            alert_level: "critical".into(),
            alert_priority: "P1".into(),
            alert_tags: "infra, prod".into(),
            alert_threshold_crit: "90".into(),
            alert_threshold_warn: "80".into(),
            alert_start_time: "2026-08-01T10:00:00".into(),
            alert_end_time: "2026-08-01T10:10:00".into(),
            alert_url: "https://o2.example/short/abc".into(),
            alert_trigger_time: 1_754_000_000_000_000,
            alert_trigger_time_str: "2026-08-01T10:10:00".into(),
            alert_description: "cpu > 80\nfor 10m".into(), // hostile: newline
            promql_operator: None,
            promql_value: None,
            rows: vec![
                serde_json::from_str(r#"{"host":"web-1","cpu":92.5}"#).unwrap(),
                serde_json::from_str(r#"{"host":"web-2","cpu":88.1}"#).unwrap(),
            ],
            rows_tpl_val: vec![
                serde_json::json!("web-1 92.5"),
                serde_json::json!("web-2 88.1"),
            ],
            // NOTE: hand-ordered, and deliberately NOT what `build_row_columns`
            // would emit for the `rows` above. serde_json's Map is a BTreeMap,
            // so the real builder yields `cpu` before `host`. Nothing in the
            // corpus depends on cross-KEY order — only on the order of VALUES
            // within a key (`web-1, web-2`), which this fixture does match.
            // If you add a golden that depends on key order, build this from
            // `build_row_columns` instead of hand-writing it. The
            // builder→renderer seam is covered by
            // `build_row_columns_feeds_renderer_in_encounter_order` below.
            row_columns: vec![
                ("host".into(), vec!["web-1".into(), "web-2".into()]),
                ("cpu".into(), vec!["92.5".into(), "88.1".into()]),
            ],
            context_attributes: vec![("env".into(), "prod".into())],
            metadata: vec![("channel".into(), "#alerts".into())],
            group_labels: Some([("pod".into(), "{alert_name}".into())].into()),
            level: Some(AlertLevel::Critical),
            chart_url: None,
            chart_png: None,
        }
    }

    // `{alert_*}` scalars go through the plain `.replace` chain, which does NOT
    // escape. The hostile quote in `alert_name` therefore lands RAW, producing
    // invalid JSON. Pre-existing behavior, frozen deliberately, reported as a
    // finding — see `golden_escaping_applies_to_process_variable_replace_path`
    // for the path where escaping IS applied.
    const GOLDEN_SCALARS: &str = r#"{"text":"CPU "high" >= 80 on app"}"#;
    // `{alert_description:8}` is NOT substituted: the `{var:N}` length form is
    // implemented only in `process_variable_replace`, and scalars never reach
    // it. The literal template text survives. Pre-existing; reported.
    const GOLDEN_TRUNC: &str = r#"{"d":"{alert_description:8}"}"#;
    // `rows_tpl_val` holds JSON *strings*, so `all_json` is false and the JSON
    // fast path is skipped in favour of the string join ("\\n", non-email).
    const GOLDEN_ROWS_JSON: &str = r#"{"rows": "web-1 92.5\nweb-2 88.1"}"#;
    // `{...rows:1}` with string row values is a no-op: `check_json_context`
    // says "JSON context", `all_json` is false, and the string fallback only
    // knows `{rows}` / `{rows:N}` — never the spread spelling. Pre-existing
    // leak of raw template text; reported.
    const GOLDEN_SPREAD: &str = r#"{"rows": "{...rows:1}"}"#;
    // is_email = true → multi-value join is "".
    const GOLDEN_EMAIL: &str = "rows: web-1 92.5web-2 88.1";
    // is_email = false → multi-value join is "\\n" (a literal backslash-n).
    const GOLDEN_EMAIL_FALSE: &str = r"rows: web-1 92.5\nweb-2 88.1";
    // Group labels substitute LAST, so the pod value "{alert_name}" lands
    // literally instead of expanding to `CPU "high"`. Injection guard holds.
    const GOLDEN_GROUP: &str = r#"{"pod":"{alert_name}"}"#;
    const GOLDEN_META: &str = r##"{"ch":"#alerts","env":"prod"}"##;
    // Deterministic encounter-order join, pinned by `build_row_columns`.
    const GOLDEN_HOSTS: &str = r#"{"hosts":"web-1, web-2"}"#;
    // Escaping IS applied on the process_variable_replace path: web"1 → web\"1.
    const GOLDEN_ESCAPE: &str = r#"{"hosts":"web\"1"}"#;
    // Truncation is pre-escape: raw web"1 → 4 chars web" → escaped web\".
    const GOLDEN_TRUNC_ROW: &str = r#"{"h":"web\""}"#;

    #[test]
    fn golden_scalars() {
        let out = apply_custom_template(
            r#"{"text":"{alert_name} {alert_operator} {alert_threshold} on {stream_name}"}"#,
            &fixture_ctx(),
            false,
        );
        assert_eq!(out, GOLDEN_SCALARS);
    }

    #[test]
    fn golden_var_truncation() {
        let out = apply_custom_template(r#"{"d":"{alert_description:8}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_TRUNC);
    }

    /// Diagnostic companion to `golden_var_truncation`: `{var:N}` truncation is
    /// implemented in `process_variable_replace`, so it works for row
    /// columns / context attributes / group labels but NOT for the `{alert_*}`
    /// scalars, which are plain `.replace`. Truncation happens PRE-escape on
    /// the raw value: "web\"1" truncated to 4 chars is `web"` → `web\"`.
    #[test]
    fn golden_truncation_applies_to_process_variable_replace_path() {
        let mut ctx = fixture_ctx();
        ctx.row_columns = vec![("host".into(), vec!["web\"1".into()])];
        let out = apply_custom_template(r#"{"h":"{host:4}"}"#, &ctx, false);
        assert_eq!(out, GOLDEN_TRUNC_ROW);
    }

    #[test]
    fn golden_rows_json_context() {
        let out = apply_custom_template(r#"{"rows": "{rows}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_ROWS_JSON);
    }

    #[test]
    fn golden_spread_rows_limit() {
        let out = apply_custom_template(r#"{"rows": "{...rows:1}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_SPREAD);
    }

    #[test]
    fn golden_email_newlines() {
        let out = apply_custom_template("rows: {rows}", &fixture_ctx(), true);
        assert_eq!(out, GOLDEN_EMAIL);
    }

    #[test]
    fn golden_non_email_newlines() {
        // Same template, is_email = false → multi-value join is "\\n", not "".
        let out = apply_custom_template("rows: {rows}", &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_EMAIL_FALSE);
    }

    #[test]
    fn golden_group_labels_last_injection_safe() {
        // pod value "{alert_name}" must land literally — group labels substitute LAST.
        let out = apply_custom_template(r#"{"pod":"{group.pod}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_GROUP);
    }

    #[test]
    fn golden_metadata_and_context_attributes() {
        let out =
            apply_custom_template(r#"{"ch":"{channel}","env":"{env}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_META);
    }

    /// Diagnostic companion to `golden_scalars`: proves JSON escaping is alive
    /// and works — it is applied by `process_variable_replace`, which handles
    /// row columns / context attributes / group labels, NOT by the leading
    /// `.replace` chain that handles the `{alert_*}` scalars. A quote in a ROW
    /// value escapes; a quote in `{alert_name}` does not. See the report.
    #[test]
    fn golden_escaping_applies_to_process_variable_replace_path() {
        let mut ctx = fixture_ctx();
        ctx.row_columns = vec![("host".into(), vec!["web\"1".into()])];
        let out = apply_custom_template(r#"{"hosts":"{host}"}"#, &ctx, false);
        assert_eq!(out, GOLDEN_ESCAPE);
    }

    /// The builder→renderer seam, end to end.
    ///
    /// Every other golden hand-writes `row_columns`, so none of them actually
    /// exercises `build_row_columns` — the function whose whole purpose is the
    /// determinism pin. This one starts from a real `&[Map<String, Value>]`,
    /// runs it through the builder, and renders the result, so the
    /// HashMap→Vec ordering change is verified where it ships rather than only
    /// in isolation.
    #[test]
    fn build_row_columns_feeds_renderer_in_encounter_order() {
        let base = fixture_ctx();
        let mut ctx = base.clone();
        // Derive row_columns from the fixture's real rows instead of the
        // hand-written list.
        ctx.row_columns = super::super::context::build_row_columns(&base.rows);

        let out = apply_custom_template(r#"{"hosts":"{host}"}"#, &ctx, false);
        assert_eq!(out, GOLDEN_HOSTS);

        // Numeric column travels the same seam and keeps encounter order too.
        let out_cpu = apply_custom_template(r#"{"cpu":"{cpu}"}"#, &ctx, false);
        assert_eq!(out_cpu, r#"{"cpu":"92.5, 88.1"}"#);
    }

    #[test]
    fn golden_multirow_scalar_join() {
        // Single-column, two distinct values → deterministic encounter-order join.
        let out = apply_custom_template(r#"{"hosts":"{host}"}"#, &fixture_ctx(), false);
        assert_eq!(out, GOLDEN_HOSTS);
    }
}

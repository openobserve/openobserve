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

//! Content-kind resolution: substitution over RAW values, `show_when`
//! filtering, and unmatched-variable markers.
//!
//! **Critical distinction from `custom.rs`:** the custom-kind path bakes
//! JSON-escaping INTO substitution (`process_variable_replace` /
//! `format_variable_value`). This module does NOT do format escaping — it
//! substitutes raw values, and per-format escaping happens later in the
//! renderers (Task 8). Escaping for a wire format here would double-escape
//! once a renderer also escapes for its target (Slack mrkdwn, Adaptive Card
//! text, HTML, JSON).
//!
//! The ONE exception is the markdown BODY, which is escaped at substitution
//! time by [`escape_markdown`]. That is not format escaping — it is source
//! escaping, and it cannot be deferred to the renderers: the body is parsed
//! as markdown by every one of them, so by the time a renderer sees it, a
//! value's `>` has already become a blockquote and is indistinguishable from
//! structure the author wrote. Title, fields, links and rows are not
//! markdown-parsed and stay raw.

use config::meta::alerts::{content_spec::ContentSpec, level::AlertLevel};

use super::{context::NotificationContext, custom::scan_and_replace_var};

/// Visible marker for an in-context variable with no value — design §5.3.
/// Never blank, never literal braces.
pub const UNMATCHED_MARKER: &str = "–";

/// Fully resolved, still-raw content for one channel render.
pub struct RenderedContent {
    /// Per-channel override already applied.
    pub title: String,
    /// Substituted, still markdown, raw values.
    pub body_markdown: String,
    /// `show_when`-filtered, substituted.
    pub fields: Vec<(String, String)>,
    /// (label, url); alert-URL link appended.
    pub links: Vec<(String, String)>,
    /// ≤ `rows.max`, column-ordered per `RowsSpec`.
    pub rows: Vec<Vec<(String, String)>>,
    /// Present when `RowsSpec.format` is set.
    pub row_lines: Option<Vec<String>>,
    pub severity: Option<AlertLevel>,
    /// Tokens with no context value.
    pub unknown_variables: Vec<String>,
}

/// Resolve `spec` against `ctx` for one channel family.
///
/// `channel_family`: "slack" | "teams" | "email" | "discord" | "pagerduty" |
/// "opsgenie" | "servicenow" | "sns" | "webhook" — keys `title_overrides`.
pub fn resolve_content(
    spec: &ContentSpec,
    ctx: &NotificationContext,
    channel_family: &str,
) -> RenderedContent {
    let mut unknown_variables = Vec::new();

    let title_tpl = spec
        .title_overrides
        .get(channel_family)
        .unwrap_or(&spec.title);
    let (title, mut unk) = substitute_raw(title_tpl, ctx);
    unknown_variables.append(&mut unk);

    // The BODY is the only markdown-parsed surface (§ `escape_markdown`).
    // Values are escaped as they are substituted so a value can never inject
    // markdown STRUCTURE into the author's document. Title, fields, links and
    // rows are NOT markdown-parsed and are deliberately left raw — escaping
    // them would surface literal backslashes to users.
    let (body_markdown, mut unk) = substitute_markdown_body(&spec.body, ctx);
    unknown_variables.append(&mut unk);

    let mut fields = Vec::new();
    for field in &spec.fields {
        if let Some(filter) = &field.show_when
            && !filter.matches(ctx.level)
        {
            continue;
        }
        let (label, mut unk) = substitute_raw(&field.label, ctx);
        unknown_variables.append(&mut unk);
        let (value, mut unk) = substitute_raw(&field.value, ctx);
        unknown_variables.append(&mut unk);
        fields.push((label, value));
    }

    let mut links = Vec::new();
    for link in &spec.links {
        if let Some(filter) = &link.show_when
            && !filter.matches(ctx.level)
        {
            continue;
        }
        let (label, mut unk) = substitute_raw(&link.label, ctx);
        unknown_variables.append(&mut unk);
        let (url, mut unk) = substitute_raw(&link.url, ctx);
        unknown_variables.append(&mut unk);
        links.push((label, url));
    }
    // Appended alert link: empty label — renderers supply the localized
    // default ("View alert" is an i18n/FE concern, Task 12), not this layer.
    links.push((String::new(), ctx.alert_url.clone()));

    let max = spec.rows.max as usize;
    let rows: Vec<Vec<(String, String)>> = ctx
        .rows
        .iter()
        .take(max)
        .map(|row| {
            let cols: Vec<&String> = match &spec.rows.columns {
                Some(cols) => cols.iter().collect(),
                None => row.keys().collect(),
            };
            cols.into_iter()
                .filter_map(|col| {
                    row.get(col)
                        .map(|v| (col.clone(), super::custom::stringify_row_value(v)))
                })
                .collect()
        })
        .collect();

    let row_lines = spec.rows.format.as_ref().map(|fmt| {
        ctx.rows
            .iter()
            .take(max)
            .map(|row| substitute_raw_row(fmt, row, &mut unknown_variables))
            .collect()
    });

    RenderedContent {
        title,
        body_markdown,
        fields,
        links,
        rows,
        row_lines,
        severity: ctx.level,
        unknown_variables,
    }
}

/// Substitute `{var}` / `{var:N}` in `input` against a single row's full
/// column set (used by `RowsSpec.format`, which operates on the full row
/// regardless of the `columns` selection — design §4.2).
///
/// Same input-scan discipline as `substitute_raw`: "unmatched" is decided
/// from the ORIGINAL `input`, not the substituted output, so a row value
/// that happens to look like `{something}` is never marker-stamped.
fn substitute_raw_row(
    input: &str,
    row: &config::utils::json::Map<String, config::utils::json::Value>,
    unknown: &mut Vec<String>,
) -> String {
    let mut unk: Vec<String> = scan_unmatched(input)
        .into_iter()
        .filter(|name| !row.contains_key(name))
        .collect();

    let mut out = input.to_string();
    for (key, value) in row {
        let s = super::custom::stringify_row_value(value);
        scan_and_replace_var(&mut out, key, |len| {
            if len > 0 {
                s.chars().take(len).collect()
            } else {
                s.clone()
            }
        });
    }
    let replaced = replace_unmatched_with_marker(&out, &unk);
    unknown.append(&mut unk);
    replaced
}

/// Raw substitution: `{var}` and `{var:N}` over the context, NO escaping.
/// Unmatched tokens render [`UNMATCHED_MARKER`] and are reported.
///
/// For the markdown body use [`substitute_markdown_body`] instead — values
/// substituted into a markdown-parsed surface must be escaped or they inject
/// structure. This function is for the NON-markdown surfaces (title, fields,
/// links), where escaping would show users literal backslashes.
///
/// Lookup order (design §5.1): scalar context fields → `row_columns`
/// (dedup + `", "` join) → `context_attributes` → `metadata` → `group_labels`
/// (`group.<name>`).
///
/// "Unmatched" is determined from the ORIGINAL input, before any
/// substitution runs — not by re-scanning the substituted output. A
/// group-label value (or any other substituted value) can itself look like a
/// `{token}` — e.g. a pod literally named `{alert_name}` — and the legacy
/// custom path's whole injection defense is that such a value lands verbatim
/// because nothing runs after it. Scanning the OUTPUT for "unmatched" tokens
/// would silently destroy that value by marker-stamping it and would
/// misreport it in `unknown_variables` as a genuinely unresolved variable.
/// Scanning the INPUT instead means only tokens absent from every lookup
/// tier are ever considered unknown; anything a substituted value happens to
/// resemble is never touched again.
pub(crate) fn substitute_raw(input: &str, ctx: &NotificationContext) -> (String, Vec<String>) {
    substitute_with(input, ctx, |v| v.to_string())
}

/// Substitute into the markdown BODY, escaping every substituted VALUE so it
/// is inert markdown — see [`escape_markdown`].
///
/// The author's template is NOT escaped: `**{alert_name}**` still bolds, and
/// a `- ` the author typed still opens a list. Only the values dropped into
/// it are neutralized. This is the exact analogue of the HTML/JSON escaping
/// the renderers already apply — with the difference that it must happen HERE,
/// before the markdown parse, because by renderer time the injected structure
/// is already indistinguishable from authored structure.
fn substitute_markdown_body(input: &str, ctx: &NotificationContext) -> (String, Vec<String>) {
    substitute_with(input, ctx, escape_markdown)
}

/// Shared substitution engine. `esc` is applied to every substituted VALUE
/// (after truncation, so `{var:8}` still counts 8 characters of real value,
/// not of backslashes) and never to the surrounding template.
fn substitute_with(
    input: &str,
    ctx: &NotificationContext,
    esc: impl Fn(&str) -> String,
) -> (String, Vec<String>) {
    let unknown = scan_unmatched(input)
        .into_iter()
        .filter(|name| !is_known_var(name, ctx))
        .collect::<Vec<_>>();

    let mut out = input.to_string();

    for (name, value) in scalar_vars(ctx) {
        scan_and_replace_var(&mut out, name, |len| esc(&truncate(value, len)));
    }

    for (key, values) in ctx.row_columns.iter() {
        let joined = values.join(", ");
        scan_and_replace_var(&mut out, key, |len| esc(&truncate(&joined, len)));
    }

    for (key, value) in ctx.context_attributes.iter() {
        scan_and_replace_var(&mut out, key, |len| esc(&truncate(value, len)));
    }

    for (key, value) in ctx.metadata.iter() {
        scan_and_replace_var(&mut out, key, |len| esc(&truncate(value, len)));
    }

    if let Some(labels) = &ctx.group_labels {
        for (name, value) in config::meta::alerts::grouping::group_template_vars(labels) {
            scan_and_replace_var(&mut out, &name, |len| esc(&truncate(&value, len)));
        }
    }

    // Only tokens confirmed unknown from the ORIGINAL input are marker-
    // replaced here — substituted values that happen to look like tokens are
    // left alone (see doc comment above).
    let out = replace_unmatched_with_marker(&out, &unknown);
    (out, unknown)
}

/// Whether `name` resolves in some lookup tier for `ctx` — used to decide,
/// from the pre-substitution input, which `{name}` tokens are genuinely
/// unknown rather than merely a substring of the raw template.
fn is_known_var(name: &str, ctx: &NotificationContext) -> bool {
    if scalar_vars(ctx).iter().any(|(n, _)| *n == name) {
        return true;
    }
    if ctx.row_columns.iter().any(|(k, _)| k == name) {
        return true;
    }
    if ctx.context_attributes.iter().any(|(k, _)| k == name) {
        return true;
    }
    if ctx.metadata.iter().any(|(k, _)| k == name) {
        return true;
    }
    if let Some(labels) = &ctx.group_labels {
        return config::meta::alerts::grouping::group_template_vars(labels)
            .iter()
            .any(|(n, _)| n == name);
    }
    false
}

/// Make a substituted value inert as markdown SOURCE.
///
/// Values are substituted into a template that is subsequently parsed as
/// markdown, so without this a value is markdown source rather than markdown
/// text. Verified live before the fix: `alert_operator = ">="` in a body of
/// `- {alert_operator}` parsed as a blockquote nested in a list item, and the
/// `>` was consumed as structure — the user saw a bare `=`.
///
/// CommonMark defines exactly one universal escape: a backslash before an
/// ASCII punctuation character is a literal. That is what this emits. It is
/// deliberately applied to the full CommonMark punctuation set rather than a
/// hand-picked "dangerous" subset — the subset approach is what lets `>` slip
/// through — and it is safe to over-apply because a backslash before ASCII
/// punctuation renders as just that punctuation in every CommonMark-compliant
/// parser, including the `pulldown-cmark` used downstream.
///
/// Backslash is escaped FIRST, or the backslashes this function itself adds
/// would be re-escaped into literal backslashes in the output.
///
/// Deliberately NOT escaped: `{` and `}`. They are not markdown-significant,
/// and escaping them would break the unmatched-variable marker pass, which
/// runs after substitution and matches on literal braces — plus the
/// established guarantee (see `substitute_raw`) that a value which merely
/// *looks* like `{alert_name}` survives verbatim.
fn escape_markdown(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        // CommonMark "ASCII punctuation", minus the braces (see above).
        if c.is_ascii_punctuation() && c != '{' && c != '}' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn truncate(value: &str, len: usize) -> String {
    if len > 0 && len < value.chars().count() {
        value.chars().take(len).collect()
    } else {
        value.to_string()
    }
}

/// Find every remaining `{identifier}` / `{identifier:N}` token — anything
/// still present after all known-variable passes ran is unmatched.
fn scan_unmatched(tpl: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = tpl.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(rel_end) = tpl[i..].find('}')
        {
            let end = i + rel_end;
            let inner = &tpl[i + 1..end];
            // Only treat as a variable token if it looks like
            // `name` or `name:N` — a bare identifier, optionally with a
            // numeric truncation suffix. `.` is allowed so `group.<name>`
            // tokens qualify too; this is deliberately broad — the brief's
            // rule is "every unmatched token marks", so a literal `{a.b}` in
            // user prose that happens to look like a variable is marked too.
            let name = inner.split(':').next().unwrap_or(inner);
            let is_ident = !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '.');
            let suffix_ok = match inner.split_once(':') {
                Some((_, n)) => n.parse::<usize>().is_ok(),
                None => true,
            };
            if is_ident && suffix_ok {
                out.push(name.to_string());
            }
            i = end + 1;
            continue;
        }
        i += 1;
    }
    out
}

fn replace_unmatched_with_marker(tpl: &str, unknown: &[String]) -> String {
    let mut out = tpl.to_string();
    for name in unknown {
        scan_and_replace_var(&mut out, name, |_| UNMATCHED_MARKER.to_string());
    }
    out
}

/// Every scalar variable available to content resolution, in no particular
/// order. `pub(crate)` because Task 8's Webhook envelope reuses it.
pub(crate) fn scalar_vars(ctx: &NotificationContext) -> Vec<(&'static str, &str)> {
    vec![
        ("org_name", ctx.org_name.as_str()),
        ("stream_type", ctx.stream_type.as_str()),
        ("stream_name", ctx.stream_name.as_str()),
        ("alert_name", ctx.alert_name.as_str()),
        ("alert_type", ctx.alert_type.as_str()),
        ("alert_period", ctx.alert_period.as_str()),
        ("alert_operator", ctx.alert_operator.as_str()),
        ("alert_threshold", ctx.alert_threshold.as_str()),
        ("alert_count", ctx.alert_count.as_str()),
        ("alert_agg_value", ctx.alert_agg_value.as_str()),
        ("alert_level", ctx.alert_level.as_str()),
        ("alert_priority", ctx.alert_priority.as_str()),
        ("alert_tags", ctx.alert_tags.as_str()),
        ("alert_threshold_crit", ctx.alert_threshold_crit.as_str()),
        ("alert_threshold_warn", ctx.alert_threshold_warn.as_str()),
        ("alert_warning_threshold", ctx.alert_threshold_warn.as_str()),
        ("alert_start_time", ctx.alert_start_time.as_str()),
        ("alert_end_time", ctx.alert_end_time.as_str()),
        ("alert_url", ctx.alert_url.as_str()),
        (
            "alert_trigger_time_str",
            ctx.alert_trigger_time_str.as_str(),
        ),
        ("alert_time", ctx.alert_trigger_time_str.as_str()),
        ("alert_description", ctx.alert_description.as_str()),
    ]
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use config::meta::alerts::level::AlertLevel;

    use super::*;
    use crate::alerts::notifications::context::NotificationContext;

    /// Mirrors `custom::golden::fixture_ctx` (Task 5). Duplicated rather than
    /// shared because that fixture is private to `custom.rs`'s golden-test
    /// module; the values relevant to this module's tests match it exactly.
    pub(super) fn fixture_ctx() -> NotificationContext {
        NotificationContext {
            org_name: "default".into(),
            stream_type: "logs".into(),
            stream_name: "app".into(),
            alert_name: "CPU \"high\"".into(),
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
            alert_description: "cpu > 80\nfor 10m".into(),
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
            row_columns: vec![
                ("host".into(), vec!["web-1".into(), "web-2".into()]),
                ("cpu".into(), vec!["92.5".into(), "88.1".into()]),
            ],
            context_attributes: vec![("env".into(), "prod".into())],
            metadata: vec![("channel".into(), "#alerts".into())],
            group_labels: Some(BTreeMap::from([("pod".into(), "{alert_name}".into())])),
            level: Some(AlertLevel::Critical),
            chart_url: None,
            chart_png: None,
        }
    }

    #[test]
    fn substitutes_raw_without_escaping() {
        let ctx = fixture_ctx();
        let (out, unknown) = substitute_raw("{alert_name} at {alert_agg_value}", &ctx);
        assert_eq!(out, r#"CPU "high" at 92.5"#); // quote NOT escaped — raw
        assert!(unknown.is_empty());
    }

    #[test]
    fn truncation_is_pre_escape_on_raw_value() {
        let (out, _) = substitute_raw("{alert_description:8}", &fixture_ctx());
        assert_eq!(out.chars().count(), 8);
    }

    #[test]
    fn unmatched_renders_marker_and_reports() {
        let (out, unknown) = substitute_raw("x {no_such_var} y", &fixture_ctx());
        assert_eq!(out, "x – y");
        assert_eq!(unknown, vec!["no_such_var"]);
    }

    #[test]
    fn multirow_scalar_join_matches_custom_rule() {
        let (out, _) = substitute_raw("{host}", &fixture_ctx());
        assert_eq!(out, "web-1, web-2"); // same dedup+join rule as custom kind
    }

    #[test]
    fn show_when_filters_and_none_level_hides() {
        use config::meta::alerts::content_spec::{ContentField, ContentSpec, SeverityFilter};

        let spec = ContentSpec {
            title: "t".into(),
            fields: vec![
                ContentField {
                    label: "always".into(),
                    value: "1".into(),
                    show_when: None,
                },
                ContentField {
                    label: "crit".into(),
                    value: "2".into(),
                    show_when: Some(SeverityFilter {
                        levels: vec![AlertLevel::Critical],
                    }),
                },
            ],
            ..Default::default()
        };
        let mut ctx = fixture_ctx();
        ctx.level = None; // single-level alert
        let r = resolve_content(&spec, &ctx, "slack");
        assert_eq!(r.fields.len(), 1); // show_when matches nothing on None
    }

    #[test]
    fn title_override_per_channel_family() {
        use config::meta::alerts::content_spec::ContentSpec;

        let mut spec = ContentSpec {
            title: "generic".into(),
            ..Default::default()
        };
        spec.title_overrides
            .insert("email".into(), "mail: {alert_name}".into());
        let r = resolve_content(&spec, &fixture_ctx(), "email");
        assert_eq!(r.title, r#"mail: CPU "high""#);
        let r2 = resolve_content(&spec, &fixture_ctx(), "slack");
        assert_eq!(r2.title, "generic");
    }

    #[test]
    fn rows_respect_max_columns_and_format() {
        use config::meta::alerts::content_spec::{ContentSpec, RowsSpec};

        let spec = ContentSpec {
            rows: RowsSpec {
                enabled: true,
                max: 1,
                columns: Some(vec!["host".into()]),
                format: Some("{host} at {cpu}".into()),
            },
            ..Default::default()
        };
        let r = resolve_content(&spec, &fixture_ctx(), "slack");
        assert_eq!(
            r.rows,
            vec![vec![("host".to_string(), "web-1".to_string())]]
        );
        // format operates on the FULL row regardless of `columns` (§4.2)
        assert_eq!(
            r.row_lines.as_ref().unwrap(),
            &vec!["web-1 at 92.5".to_string()]
        );
    }

    #[test]
    fn no_escaping_in_content_path() {
        // Grep-friendly sentinel: a hostile quote must survive verbatim.
        let ctx = fixture_ctx();
        let (out, _) = substitute_raw("{alert_name}", &ctx);
        assert!(out.contains('"'));
        assert!(!out.contains("\\\""));
    }

    #[test]
    fn context_attributes_tier_resolves() {
        let (out, unknown) = substitute_raw("env={env}", &fixture_ctx());
        assert_eq!(out, "env=prod");
        assert!(unknown.is_empty());
    }

    #[test]
    fn metadata_tier_resolves() {
        let (out, unknown) = substitute_raw("ch={channel}", &fixture_ctx());
        assert_eq!(out, "ch=#alerts");
        assert!(unknown.is_empty());
    }

    #[test]
    fn group_labels_tier_resolves() {
        // Use a group label value that isn't itself template-shaped, so the
        // group tier's resolution is observed directly without also
        // exercising the unmatched-marker pass on the substituted value.
        let mut ctx = fixture_ctx();
        ctx.group_labels = Some(BTreeMap::from([("pod".into(), "web-1".into())]));
        let (out, unknown) = substitute_raw("pod={group.pod}", &ctx);
        assert_eq!(out, "pod=web-1");
        assert!(unknown.is_empty());
    }

    #[test]
    fn group_label_value_shaped_like_a_token_is_not_re_expanded() {
        // fixture's group label "pod" -> "{alert_name}" is stored raw. It
        // must survive LITERALLY in the output (no re-expansion — group vars
        // substitute last, injection guard) AND must not be destroyed by the
        // unmatched-marker pass: "unmatched" is decided from the ORIGINAL
        // input, before substitution, so a substituted value that happens to
        // look like `{alert_name}` is never mistaken for a leftover token.
        let (out, unknown) = substitute_raw("pod={group.pod}", &fixture_ctx());
        assert_eq!(out, "pod={alert_name}");
        assert!(unknown.is_empty());
    }

    #[test]
    fn real_unknown_token_still_marks_and_reports_alongside_group_label() {
        // Companion to the above: a genuinely unknown token in the SAME
        // template must still become the marker and still be reported — the
        // fix for the group-label case must not swallow real unknowns.
        let (out, unknown) = substitute_raw("pod={group.pod} x={no_such_var}", &fixture_ctx());
        assert_eq!(out, "pod={alert_name} x=–");
        assert_eq!(unknown, vec!["no_such_var"]);
    }

    #[test]
    fn links_show_when_filters_and_alert_url_appended_with_empty_label() {
        use config::meta::alerts::content_spec::{ContentLink, ContentSpec, SeverityFilter};

        let mut spec = ContentSpec {
            title: "t".into(),
            ..Default::default()
        };
        spec.links = vec![
            ContentLink {
                label: "always".into(),
                url: "https://example/always".into(),
                show_when: None,
            },
            ContentLink {
                label: "crit only".into(),
                url: "https://example/crit".into(),
                show_when: Some(SeverityFilter {
                    levels: vec![AlertLevel::Critical],
                }),
            },
        ];
        let mut ctx = fixture_ctx();
        ctx.level = None; // single-level alert: show_when matches nothing
        let r = resolve_content(&spec, &ctx, "slack");
        // "crit only" dropped (show_when matches nothing on None level);
        // "always" kept; alert-URL link appended last with an empty label.
        assert_eq!(
            r.links,
            vec![
                ("always".to_string(), "https://example/always".to_string()),
                (String::new(), ctx.alert_url.clone()),
            ]
        );
        assert_eq!(r.links.last().unwrap().0, "");
    }

    /// The reported bug, at the substitution boundary.
    ///
    /// Before the fix `- {alert_operator}` with `>=` substituted to `- >=`,
    /// which CommonMark parses as a blockquote inside a list item — the `>`
    /// was consumed as structure and the user saw a bare `=`.
    #[test]
    fn substituted_value_cannot_inject_markdown_structure() {
        let ctx = fixture_ctx();
        let (out, _) = substitute_markdown_body("- {alert_operator}", &ctx);
        assert_eq!(out, r"- \>\=");
        // The `>` is now literal text, not a blockquote marker.
        let html = crate::alerts::notifications::render::markdown::markdown_to_html(&out);
        assert_eq!(html, "<ul>\n<li>&gt;=</li>\n</ul>\n");
        assert!(!html.contains("<blockquote>"));
    }

    /// Emphasis markers in a VALUE are data, not markup.
    #[test]
    fn value_containing_emphasis_renders_literally() {
        let mut ctx = fixture_ctx();
        ctx.alert_name = "*bold* and _em_ and `code`".into();
        let (out, _) = substitute_markdown_body("{alert_name}", &ctx);
        let html = crate::alerts::notifications::render::markdown::markdown_to_html(&out);
        assert!(!html.contains("<em>"));
        assert!(!html.contains("<strong>"));
        assert!(!html.contains("<code>"));
        assert!(html.contains("*bold*"));
        assert!(html.contains("_em_"));
    }

    /// A value must not be able to open a heading, list, rule or link either.
    #[test]
    fn value_cannot_inject_block_structure() {
        for hostile in [
            "# not a heading",
            "- not a list",
            "---",
            "[click](https://evil.example)",
            "![img](https://evil.example/x.png)",
        ] {
            let mut ctx = fixture_ctx();
            ctx.alert_name = hostile.into();
            let (out, _) = substitute_markdown_body("{alert_name}", &ctx);
            let html = crate::alerts::notifications::render::markdown::markdown_to_html(&out);
            for tag in ["<h1>", "<ul>", "<li>", "<hr />", "<a ", "<img"] {
                assert!(!html.contains(tag), "{hostile:?} injected {tag}: {html}");
            }
        }
    }

    /// The AUTHOR's markdown still works — only VALUES are neutralized.
    /// Escaping the whole substituted string would have broken this.
    #[test]
    fn author_markdown_still_renders_after_value_escaping() {
        let (out, _) = substitute_markdown_body("**{alert_agg_value}**", &fixture_ctx());
        let html = crate::alerts::notifications::render::markdown::markdown_to_html(&out);
        assert!(html.contains("<strong>92.5</strong>"), "{html}");
    }

    /// Escaping must not disturb the unmatched-marker pass, which runs after
    /// substitution and matches literal braces.
    #[test]
    fn escaping_preserves_unmatched_marker_and_token_shaped_values() {
        let (out, unknown) =
            substitute_markdown_body("pod={group.pod} x={no_such_var}", &fixture_ctx());
        // Token-shaped group value survives verbatim (braces never escaped);
        // the genuinely unknown token still becomes the marker.
        assert!(out.contains("{alert"), "{out}");
        assert!(out.ends_with('–'), "{out}");
        assert_eq!(unknown, vec!["no_such_var"]);
    }

    /// Truncation counts characters of the REAL value, not of backslashes.
    #[test]
    fn truncation_counts_value_chars_not_escapes() {
        let mut ctx = fixture_ctx();
        ctx.alert_name = "....abcd".into();
        let (out, _) = substitute_markdown_body("{alert_name:4}", &ctx);
        assert_eq!(out, r"\.\.\.\."); // 4 real chars, each escaped
        let plain = crate::alerts::notifications::render::markdown::markdown_to_plaintext(&out);
        assert_eq!(plain, "....");
    }

    /// Non-markdown surfaces stay RAW — escaping them would show users
    /// literal backslashes in Slack fields and break link URLs.
    #[test]
    fn non_markdown_surfaces_are_not_escaped() {
        use config::meta::alerts::content_spec::{ContentField, ContentLink, ContentSpec};

        let mut spec = ContentSpec {
            title: "{alert_name}".into(),
            ..Default::default()
        };
        spec.fields = vec![ContentField {
            label: "op".into(),
            value: "{alert_operator}".into(),
            show_when: None,
        }];
        spec.links = vec![ContentLink {
            label: "{alert_operator}".into(),
            url: "https://x/?op={alert_operator}".into(),
            show_when: None,
        }];
        let r = resolve_content(&spec, &fixture_ctx(), "slack");
        assert_eq!(r.title, r#"CPU "high""#); // no backslashes
        assert!(!r.title.contains('\\'));
        assert_eq!(r.fields[0].1, ">=");
        assert_eq!(r.links[0].0, ">=");
        assert_eq!(r.links[0].1, "https://x/?op=>=");
    }

    #[test]
    fn body_markdown_substitutes_end_to_end() {
        use config::meta::alerts::content_spec::ContentSpec;

        let spec = ContentSpec {
            title: "t".into(),
            body: "**{alert_name}** fired at {alert_agg_value}".into(),
            ..Default::default()
        };
        let r = resolve_content(&spec, &fixture_ctx(), "slack");
        // Values are markdown-escaped (see `escape_markdown`); the author's
        // own `**` is not. What matters is what the user SEES, so assert the
        // rendered result rather than the intermediate escape soup.
        assert_eq!(r.body_markdown, r#"**CPU \"high\"** fired at 92\.5"#);
        assert_eq!(
            crate::alerts::notifications::render::markdown::markdown_to_plaintext(&r.body_markdown),
            r#"CPU "high" fired at 92.5"#
        );
    }
}

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

use config::meta::alerts::{
    content_spec::ContentSpec,
    level::AlertLevel,
    notification_kind::{NotificationEvent, NotificationKind},
};

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
    /// Present when `RowsSpec.enabled` is true and `RowsSpec.format` is set.
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
        // Only legacy Custom templates keep a blank value; they never reach this function.
        if value.trim().is_empty() || every_variable_blank(&field.value, ctx) {
            continue;
        }
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
        // A card for another kind drops a link whose URL is empty, such as a page with no runbook;
        // an alert keeps a blank link unless its URL names another kind's variable.
        if url.trim().is_empty()
            && (ctx.kind != NotificationKind::Alert || uses_kind_variable(&link.url))
        {
            continue;
        }
        links.push((label, url));
    }
    // Appended alert link: empty label — renderers supply the localized
    // default ("View alert" is an i18n/FE concern, Task 12), not this layer.
    links.push((String::new(), ctx.alert_url.clone()));

    let max = if spec.rows.enabled {
        spec.rows.max as usize
    } else {
        0
    };
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

    let row_lines = spec
        .rows
        .format
        .as_ref()
        .filter(|_| spec.rows.enabled)
        .map(|fmt| {
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
    let spread_enabled = !row.contains_key("...row");
    if spread_enabled && input.trim() == "{...row}" {
        return serde_json::to_string(row).unwrap_or_default();
    }

    if spread_enabled && input.contains("{...row}") {
        let json = serde_json::to_string(row).unwrap_or_default();
        // Expand only source tokens, after resolving fields and unknown markers in each segment.
        return input
            .split("{...row}")
            .map(|segment| substitute_raw_row(segment, row, unknown))
            .collect::<Vec<_>>()
            .join(&json);
    }

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
    // One pass over the authored tokens: an inserted value is never scanned again.
    let mut unknown = Vec::new();
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let at = &rest[start..];
        let Some((inner, token_len)) = parse_token(at) else {
            out.push('{');
            rest = &at[1..];
            continue;
        };
        // A key may hold a colon, such as a column `http:status`, so the whole text is a key first.
        let (name, value, len) = match var_value(inner, ctx) {
            Some(value) => (inner, Some(value), 0),
            None => match inner.split_once(':') {
                Some((name, n)) => match n.parse::<usize>() {
                    Ok(len) if !name.is_empty() => (name, var_value(name, ctx), len),
                    _ => {
                        out.push('{');
                        rest = &at[1..];
                        continue;
                    }
                },
                None => (inner, None, 0),
            },
        };
        match value {
            Some(value) => out.push_str(&esc(&truncate(&value, len))),
            // Only a name that looks like a variable is marked; other braced text stays as typed.
            None if is_ident(name) => {
                out.push_str(UNMATCHED_MARKER);
                unknown.push(name.to_string());
            }
            None => out.push_str(&at[..token_len]),
        }
        rest = &at[token_len..];
    }
    out.push_str(rest);
    (out, unknown)
}

/// `{text}` at the start of `at`: the text inside and the token length. Any text without braces
/// counts, since a row column or label such as `http-status` is a key too.
fn parse_token(at: &str) -> Option<(&str, usize)> {
    let end = at.find('}')?;
    let inner = &at[1..end];
    (!inner.is_empty() && !inner.contains('{')).then_some((inner, end + 1))
}

/// Whether `input` names a variable of some kind's group, such as `{anomaly_explore_url}`.
fn uses_kind_variable(input: &str) -> bool {
    scan_unmatched(input)
        .iter()
        .any(|name| super::examples::is_kind_variable(name))
}

/// The grammar `scan_unmatched` reads: what an author meant as a variable.
fn is_ident(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
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
/// Known variables in `input` whose value for `ctx` is blank, each once, in order of use.
pub(crate) fn empty_variables(input: &str, ctx: &NotificationContext) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in scan_unmatched(input) {
        let blank = var_value(&name, ctx).is_some_and(|v| v.trim().is_empty());
        if blank && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// True when `input` names variables and each is blank, so `{check_name} ({check_type})` hides.
fn every_variable_blank(input: &str, ctx: &NotificationContext) -> bool {
    let names = scan_unmatched(input);
    !names.is_empty()
        && names
            .iter()
            .all(|n| var_value(n, ctx).is_some_and(|v| v.trim().is_empty()))
}

/// The value a `{name}` token takes for `ctx`, in the substitution engine's tier order.
fn var_value(name: &str, ctx: &NotificationContext) -> Option<String> {
    if let Some((_, v)) = extra_scalar_vars(ctx).into_iter().find(|(n, _)| *n == name) {
        return Some(v);
    }
    if let Some((_, v)) = scalar_vars(ctx).into_iter().find(|(n, _)| *n == name) {
        return Some(v.to_string());
    }
    if let Some((_, values)) = ctx.row_columns.iter().find(|(k, _)| k == name) {
        return Some(values.join(", "));
    }
    if let Some((_, v)) = ctx
        .context_attributes
        .iter()
        .chain(ctx.metadata.iter())
        .find(|(k, _)| k == name)
    {
        return Some(v.clone());
    }
    if let Some(labels) = &ctx.group_labels
        && let Some((_, v)) = config::meta::alerts::grouping::group_template_vars(labels)
            .into_iter()
            .find(|(n, _)| n == name)
    {
        return Some(v);
    }
    // One template serves every kind, so another kind's variable reads blank and its field hides.
    super::examples::is_kind_variable(name).then(String::new)
}

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
        ("alert_status", ctx.alert_status.as_str()),
        ("episode_id", ctx.episode_id.as_deref().unwrap_or_default()),
        ("recovery_reason", ctx.recovery_reason.as_str()),
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

/// Scalars added for the shared send path; kept apart so the alert webhook envelope is unchanged.
pub(crate) fn extra_scalar_vars(ctx: &NotificationContext) -> Vec<(&'static str, String)> {
    let trigger_millis = ctx.alert_trigger_time / 1000;
    vec![
        ("notification_kind", ctx.kind.as_str().to_string()),
        ("notification_event", ctx.event.as_str().to_string()),
        ("notification_kind_label", ctx.kind.label().to_string()),
        (
            "notification_event_label",
            ctx.kind.event_label(ctx.event).to_string(),
        ),
        ("status_dot", status_dot(ctx).to_string()),
        ("alert_level_label", level_label(&ctx.alert_level)),
        ("alert_trigger_time_utc", utc_stamp(ctx.alert_trigger_time)),
        ("cluster_name", ctx.cluster_name.clone()),
        (
            "alert_start_time_millis",
            ctx.alert_start_time_millis.clone(),
        ),
        ("alert_end_time_millis", ctx.alert_end_time_millis.clone()),
        ("alert_trigger_time", ctx.alert_trigger_time.to_string()),
        ("alert_trigger_time_millis", trigger_millis.to_string()),
        (
            "alert_trigger_time_seconds",
            (trigger_millis / 1000).to_string(),
        ),
        (
            "alert_promql_operator",
            ctx.promql_operator.clone().unwrap_or_default(),
        ),
        (
            "alert_promql_value",
            ctx.promql_value.clone().unwrap_or_default(),
        ),
    ]
}

/// The title's severity marker: red failing, orange degraded, green recovered, blue a notice.
pub(crate) fn status_dot(ctx: &NotificationContext) -> &'static str {
    match (ctx.event, ctx.level) {
        (NotificationEvent::Resolved, _) | (_, Some(AlertLevel::Ok)) => "🟢",
        // Before Informational: a degraded synthetics check is a Warning sent as Informational.
        (_, Some(AlertLevel::Warning | AlertLevel::NoData)) => "🟠",
        (NotificationEvent::Informational, _) => "🔵",
        // A maintenance window opening is a notice, not a failure.
        _ if ctx.kind == NotificationKind::Downtime => "🔵",
        _ => "🔴",
    }
}

/// `critical` reads `Critical` and `no_data` reads `No data`; a priority such as `P1` is kept.
pub(crate) fn level_label(level: &str) -> String {
    let words = level.replace('_', " ");
    let mut chars = words.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// One UTC stamp for every kind; alert times in `alert_trigger_time_str` keep their own zone.
pub(crate) fn utc_stamp(micros: i64) -> String {
    if micros <= 0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp_micros(micros)
        .map(|at| at.format("%Y-%m-%d %H:%M:%S UTC").to_string())
        .unwrap_or_default()
}

pub(crate) const EXTRA_SCALAR_NAMES: [&str; 15] = [
    "notification_kind",
    "notification_event",
    "notification_kind_label",
    "notification_event_label",
    "status_dot",
    "alert_level_label",
    "alert_trigger_time_utc",
    "cluster_name",
    "alert_start_time_millis",
    "alert_end_time_millis",
    "alert_trigger_time",
    "alert_trigger_time_millis",
    "alert_trigger_time_seconds",
    "alert_promql_operator",
    "alert_promql_value",
];

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
            alert_status: "firing".to_string(),
            episode_id: None,
            recovery_reason: String::new(),
            alert_priority: "P1".into(),
            alert_tags: "infra, prod".into(),
            alert_threshold_crit: "90".into(),
            alert_threshold_warn: "80".into(),
            alert_threshold_operator: ">".into(),
            alert_start_time: "2026-08-01T10:00:00".into(),
            alert_end_time: "2026-08-01T10:10:00".into(),
            alert_start_time_millis: "1785578400000".into(),
            alert_end_time_millis: "1785579000000".into(),
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
            alert_id: String::new(),
            incident_id: String::new(),
            ..Default::default()
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
    fn a_key_with_a_colon_fills_before_the_length_split() {
        let mut ctx = fixture_ctx();
        ctx.row_columns
            .push(("http:status".into(), vec!["503".into()]));
        ctx.row_columns
            .push(("metric".into(), vec!["latency".into()]));
        ctx.row_columns
            .push(("metric:2".into(), vec!["p99".into()]));
        ctx.row_columns.push(("load".into(), vec!["93.5".into()]));
        assert_eq!(substitute_raw("{http:status}", &ctx).0, "503");
        assert_eq!(substitute_raw("{metric:2}", &ctx).0, "p99");
        // No `load:2` key, so the length applies.
        assert_eq!(substitute_raw("{load:2}", &ctx).0, "93");
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
    fn rows_disabled_emits_no_rows() {
        use config::meta::alerts::content_spec::{ContentSpec, RowsSpec};

        for format in [None, Some("{host} at {cpu}".to_string())] {
            let spec = ContentSpec {
                rows: RowsSpec {
                    enabled: false,
                    format: format.clone(),
                    ..Default::default()
                },
                ..Default::default()
            };
            let r = resolve_content(&spec, &fixture_ctx(), "email");
            assert!(r.rows.is_empty(), "format {format:?}");
            assert_eq!(r.row_lines, None, "format {format:?}");
        }
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

    #[test]
    fn spread_row_token_as_sole_format_serializes_full_row() {
        use config::meta::alerts::content_spec::{ContentSpec, RowsSpec};

        let spec = ContentSpec {
            rows: RowsSpec {
                enabled: true,
                max: 5,
                columns: None,
                format: Some("{...row}".into()),
            },
            ..Default::default()
        };
        let r = resolve_content(&spec, &fixture_ctx(), "webhook");
        let lines = r.row_lines.as_ref().unwrap();
        assert_eq!(lines.len(), 2);
        let v: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(v.get("host").and_then(|v| v.as_str()), Some("web-1"));
        assert_eq!(v.get("cpu").and_then(|v| v.as_f64()), Some(92.5));
        let v2: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
        assert_eq!(v2.get("host").and_then(|v| v.as_str()), Some("web-2"));
    }

    #[test]
    fn spread_row_token_embedded_in_larger_format() {
        use config::meta::alerts::content_spec::{ContentSpec, RowsSpec};

        let spec = ContentSpec {
            rows: RowsSpec {
                enabled: true,
                max: 5,
                columns: None,
                format: Some("row={...row}".into()),
            },
            ..Default::default()
        };
        let r = resolve_content(&spec, &fixture_ctx(), "webhook");
        let lines = r.row_lines.as_ref().unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("row="), "{}", lines[0]);
        let json_part = lines[0].strip_prefix("row=").unwrap();
        let v: serde_json::Value = serde_json::from_str(json_part).unwrap();
        assert!(v.get("host").is_some());
    }

    #[test]
    fn spread_row_length_suffix_is_reported_as_unknown() {
        let row = serde_json::from_value(serde_json::json!({"host": "web-1"})).unwrap();
        for input in ["{...row:10}", "{...row:1}"] {
            let mut unknown = Vec::new();
            assert_eq!(
                substitute_raw_row(input, &row, &mut unknown),
                UNMATCHED_MARKER
            );
            assert_eq!(unknown, vec!["...row"]);
        }
    }

    #[test]
    fn spread_row_bare_token_does_not_hide_a_length_suffix() {
        let row = serde_json::from_value(serde_json::json!({"host": "web-1"})).unwrap();
        let json = serde_json::to_string(&row).unwrap();
        for input in ["{...row} | {...row:10}", "{...row:10} | {...row}"] {
            let mut unknown = Vec::new();
            let expected = input
                .replace("{...row}", &json)
                .replace("{...row:10}", UNMATCHED_MARKER);
            assert_eq!(substitute_raw_row(input, &row, &mut unknown), expected);
            assert_eq!(unknown, vec!["...row"]);
        }
    }

    #[test]
    fn spread_row_preserves_token_like_data_and_unknown_markers() {
        let row = serde_json::from_value(serde_json::json!({
            "message": "{...row}",
            "nested": {"text": "{missing} {...row:10}", "values": [true, null, 42]}
        }))
        .unwrap();
        let mut unknown = Vec::new();
        let output = substitute_raw_row(
            "{message} | {...row} | {missing} | {...row}",
            &row,
            &mut unknown,
        );
        let json = serde_json::to_string(&row).unwrap();
        assert_eq!(
            output,
            format!("{{...row}} | {json} | {UNMATCHED_MARKER} | {json}")
        );
        assert_eq!(unknown, vec!["missing"]);
    }

    #[test]
    fn spread_row_serializes_an_empty_row() {
        let mut unknown = Vec::new();
        let row = config::utils::json::Map::new();
        assert_eq!(substitute_raw_row("{...row}", &row, &mut unknown), "{}");
        assert_eq!(
            substitute_raw_row("row={...row}", &row, &mut unknown),
            "row={}"
        );
        assert!(unknown.is_empty());
    }

    #[test]
    fn spread_row_preserves_literal_field_precedence() {
        for value in [
            serde_json::json!("literal value"),
            serde_json::json!(""),
            serde_json::json!(null),
            serde_json::json!({"nested": true}),
        ] {
            let row = serde_json::from_value(serde_json::json!({
                "...row": value,
                "host": "web-1"
            }))
            .unwrap();
            let field = super::super::custom::stringify_row_value(&value);
            let short = field.chars().take(4).collect::<String>();
            for (input, expected) in [
                ("{...row}", field.clone()),
                ("  {...row}  ", format!("  {field}  ")),
                ("{...row:4}", short.clone()),
                ("{...row} | {...row:4}", format!("{field} | {short}")),
            ] {
                let mut unknown = Vec::new();
                assert_eq!(substitute_raw_row(input, &row, &mut unknown), expected);
                assert!(unknown.is_empty());
            }
        }
    }

    #[test]
    fn status_dot_colors_by_event_and_level() {
        use NotificationEvent::{Firing, Informational, Resolved};
        use NotificationKind::{Alert, Downtime, Synthetics};
        for (kind, event, level, expected) in [
            (Alert, Resolved, Some(AlertLevel::Critical), "🟢"),
            (Alert, Firing, Some(AlertLevel::Ok), "🟢"),
            (Synthetics, Informational, Some(AlertLevel::Warning), "🟠"),
            (Alert, Informational, None, "🔵"),
            (Downtime, Firing, None, "🔵"),
            (Alert, Firing, Some(AlertLevel::Critical), "🔴"),
            (Alert, Firing, None, "🔴"),
        ] {
            let ctx = NotificationContext {
                kind,
                event,
                level,
                ..Default::default()
            };
            assert_eq!(status_dot(&ctx), expected, "{kind:?} {event:?} {level:?}");
        }
    }

    #[test]
    fn a_hyphenated_row_column_fills_and_other_braced_text_stays() {
        let ctx = NotificationContext {
            row_columns: vec![("http-status".into(), vec!["503".into()])],
            ..fixture_ctx()
        };
        let (out, unknown) = substitute_raw("{http-status} {not a var} {nope}", &ctx);
        assert_eq!(out, format!("503 {{not a var}} {UNMATCHED_MARKER}"));
        assert_eq!(unknown, vec!["nope".to_string()]);
    }

    #[test]
    fn an_extra_value_with_a_kind_token_stays_literal() {
        let ctx = NotificationContext {
            cluster_name: "prod-{anomaly_score}".into(),
            ..fixture_ctx()
        };
        let (out, unknown) = substitute_raw("{cluster_name}", &ctx);
        assert_eq!(out, "prod-{anomaly_score}");
        assert!(unknown.is_empty());
    }

    #[test]
    fn alert_name_with_token_renders_literally_in_content_title() {
        use config::meta::alerts::content_spec::ContentSpec;

        let spec = ContentSpec {
            title: "{alert_name}".into(),
            ..Default::default()
        };
        for name in ["cpu-{notification_kind}", "x {check_name}"] {
            let ctx = NotificationContext {
                alert_name: name.into(),
                ..fixture_ctx()
            };
            let r = resolve_content(&spec, &ctx, "slack");
            assert_eq!(r.title, name);
            assert!(r.unknown_variables.is_empty());
        }
    }

    #[test]
    fn kind_variable_from_context_attribute_still_fills() {
        use config::meta::alerts::content_spec::ContentSpec;

        let spec = ContentSpec {
            title: "{check_name} ({check_type})".into(),
            ..Default::default()
        };
        let ctx = NotificationContext {
            kind: NotificationKind::Synthetics,
            context_attributes: vec![("check_name".into(), "Homepage".into())],
            ..fixture_ctx()
        };
        let r = resolve_content(&spec, &ctx, "slack");
        assert_eq!(r.title, "Homepage ()");
    }
}

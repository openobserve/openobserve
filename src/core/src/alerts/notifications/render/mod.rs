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

//! Per-format renderers: one authored content document → the correct wire
//! payload for any destination.
//!
//! # Escaping is this layer's job
//!
//! [`resolve`](crate::alerts::notifications::resolve) deliberately leaves every
//! substituted value RAW, because Slack mrkdwn, Adaptive Card text, HTML and
//! JSON all have incompatible escaping rules and escaping once, centrally,
//! would be wrong for at least three of the four. Every renderer here must
//! neutralize hostile input for its OWN target:
//!
//! | format | mechanism |
//! |---|---|
//! | Slack mrkdwn | `&`/`<`/`>` → entities ([`markdown::escape_mrkdwn`]) |
//! | Slack `plain_text` | none needed — Slack renders it literally |
//! | Adaptive Card | markdown stripped; text is inert, not HTML |
//! | MessageCard | HTML entity-encoded (the O365 connector renders markup) |
//! | HTML email | HTML entity-encoded; raw `<script>` never emitted |
//! | Webhook / all JSON | `serde_json` serialization |
//!
//! Link URLs get a scheme ALLOWLIST ([`safe_url`]: `http`, `https`, `mailto`,
//! plus scheme-less relative URLs). Link URLs are author-supplied templates
//! that undergo variable substitution, so they are not trusted constants. An
//! allowlist rather than a blocklist because it fails closed: control
//! characters, NUL prefixes and percent-encoding all defeat a naive
//! `javascript:`/`data:` blocklist while clients still dispatch the URL.
//!
//! Being SAFE is not the same as being DELIVERABLE, and URLs need both.
//! `safe_url` neutralizes a hostile scheme by substituting [`BLOCKED_URL`]
//! ("#") — valid and inert in HTML email, but Slack, Teams, Discord and
//! PagerDuty validate action URLs server-side and reject the ENTIRE payload
//! when one is not an absolute `http(s)` URL. Substituting there cost the
//! alert its delivery (`400 invalid_attachments`, #13742). So those renderers
//! pass links through [`dispatchable_url`] and DROP what they cannot send,
//! while the forgiving media keep substituting.
//!
//! This is NOT uniform across renderers — choose by medium, and check this
//! table before adding a renderer or a new URL sink:
//!
//! | renderer | link handling |
//! |---|---|
//! | Slack buttons, Teams actions, Discord `embed.url`, PagerDuty `href` | [`dispatchable_url`] → drop |
//! | HTML email, email plaintext, SNS plaintext, Discord description | [`safe_url`] → substitute `#` |
//! | Webhook envelope | UNFILTERED — a versioned machine contract; see [`webhook`] |
//!
//! The webhook envelope is the one deliberate exemption: it is parsed by other
//! systems, so rewriting a URL to `#` would corrupt the data it promises to
//! carry. Its consumers must treat `links[].url` as untrusted.
//!
//! Pure functions — no I/O, no async.

pub mod discord;
pub mod email;
pub mod markdown;
pub mod opsgenie;
pub mod pagerduty;
pub mod servicenow;
pub mod slack;
pub mod sns;
pub mod teams;
pub mod webhook;

use config::meta::alerts::level::AlertLevel;

use super::{context::NotificationContext, format::ChannelFormat, resolve::RenderedContent};

/// Label used for a link whose authored label is empty — `resolve` appends the
/// alert URL that way. This is the localized-default seam: the frontend
/// supplies an i18n'd label for links the user authors; this literal is the
/// backend's fallback.
pub const DEFAULT_LINK_LABEL: &str = "View in OpenObserve";

/// A rendered payload, ready for the transport layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderedMessage {
    /// JSON body for `send_http_notification`.
    Http { body: String },
    Email {
        subject: String,
        html: String,
        text: String,
    },
    /// SNS renderer lands in Phase 1b; the variant is defined now because
    /// Task 9's dispatch matches on it.
    Sns { subject: String, message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderError {
    /// A Phase-1b format. Task 9 falls back to the webhook envelope.
    NotImplemented(ChannelFormat),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotImplemented(fmt_) => {
                write!(f, "renderer not implemented for {fmt_:?} (Phase 1b)")
            }
        }
    }
}

impl std::error::Error for RenderError {}

/// Severity presentation colors — design §4.2.1. These are hex strings usable
/// directly as a Slack attachment color, a MessageCard `themeColor` (minus the
/// `#`), and an email stripe.
pub fn severity_color(level: Option<AlertLevel>) -> &'static str {
    match level {
        Some(AlertLevel::Critical) => "#E01E5A",
        Some(AlertLevel::Warning) => "#ECB22E",
        Some(AlertLevel::NoData) => "#9AA0A6",
        Some(AlertLevel::Ok) => "#2EB67D",
        // Single-level alert: no severity axis, so a brand-neutral blue rather
        // than implying a level the alert does not have.
        None => "#4A90D9",
    }
}

/// Human-readable severity label, uppercase, for surfaces that display
/// severity as a colored badge/pill next to a color swatch rather than the
/// color alone (design §4.2.1's color mapping does not by itself
/// communicate the level — a thin color stripe is easy to miss, especially
/// on mobile or in an email preview pane; see `email.rs render_email`).
/// `None` for a single-level alert renders no badge at all rather than a
/// misleading "OK"/"UNKNOWN" — see [`severity_color`]'s same rule.
pub fn severity_label(level: Option<AlertLevel>) -> Option<&'static str> {
    match level {
        Some(AlertLevel::Critical) => Some("CRITICAL"),
        Some(AlertLevel::Warning) => Some("WARNING"),
        Some(AlertLevel::NoData) => Some("NO DATA"),
        Some(AlertLevel::Ok) => Some("RECOVERED"),
        None => None,
    }
}

/// Truncate to `max` CHARACTERS (not bytes — these are vendor character caps,
/// and slicing bytes would panic on a multi-byte boundary).
pub(crate) fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let keep = max.saturating_sub(1);
    let mut out: String = s.chars().take(keep).collect();
    out.push('…');
    out
}

/// Placeholder substituted for a link URL whose scheme is not allowlisted.
pub(crate) const BLOCKED_URL: &str = "#";

/// Schemes a link URL may carry. Everything else becomes [`BLOCKED_URL`].
const ALLOWED_URL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Restrict a link URL to an allowlist of safe schemes.
///
/// Link URLs are author-supplied TEMPLATES that undergo variable substitution
/// (`resolve`), so a hostile field value can reach a URL — this is not a
/// trusted constant.
///
/// **Applied by EVERY renderer that emits a link**, not just email. Slack and
/// Teams do validate action URLs server-side, so this is defense in depth, but
/// filtering in only one renderer is the real hazard: it invites the reader to
/// assume URL filtering is global when it is not.
///
/// # Why an allowlist, not a blocklist
///
/// A blocklist of `javascript:`/`data:` fails OPEN, and every one of these
/// slips past a naive `starts_with` while a WHATWG-conformant client still
/// dispatches it:
///
/// * `java\tscript:` / `java\nscript:` — clients strip control characters before parsing the
///   scheme; Rust's `starts_with` does not.
/// * `\0javascript:` — NUL is not Unicode whitespace, so `.trim()` misses it.
/// * `java%73cript:` — percent-encoding is not decoded here.
/// * `vbscript:` — simply absent from any hand-written blocklist.
///
/// An allowlist closes all of these at once (none of them *begin* with an
/// allowed scheme) and fails CLOSED against schemes nobody has thought of yet.
/// This control now guards five call sites, which is what justifies the
/// stricter bar.
///
/// # Scheme-less URLs are PERMITTED — a deliberate branch, not an accident
///
/// `/path`, `?q=1` and `#anchor` have no scheme, cannot carry active content,
/// and an author writing a relative link is doing something legitimate. They
/// are allowed explicitly. The check for "has a scheme" is the presence of a
/// `:` before any `/`, `?` or `#`, per RFC 3986 — so `/a:b` and
/// `https://x/javascript:foo` are correctly treated as scheme-less and
/// path-bearing respectively, not as exotic schemes.
///
/// Scheme-only, deliberately: escaping is the caller's job and differs per
/// format (email additionally HTML-escapes for the `href` attribute), so doing
/// it here would double-escape three of the four.
pub(crate) fn safe_url(url: &str) -> &str {
    let trimmed = url.trim();

    // Find the scheme delimiter, if this URL has one at all. A `:` only
    // introduces a scheme when it precedes any path/query/fragment marker.
    let scheme_end = trimmed
        .find([':', '/', '?', '#'])
        .filter(|&i| trimmed.as_bytes()[i] == b':');

    let Some(end) = scheme_end else {
        // Scheme-less (relative/fragment) — permitted, see doc comment.
        return trimmed;
    };

    // Schemes are ASCII case-insensitive per RFC 3986.
    let scheme = &trimmed[..end];
    if ALLOWED_URL_SCHEMES
        .iter()
        .any(|allowed| scheme.eq_ignore_ascii_case(allowed))
    {
        trimmed
    } else {
        BLOCKED_URL
    }
}

/// Schemes a transport will accept as an ACTION target (button, card action).
const DISPATCHABLE_URL_SCHEMES: [&str; 2] = ["http", "https"];

/// Restrict a link URL to one that a strict transport will actually deliver.
///
/// [`safe_url`] answers "is this URL inert?"; this answers the different
/// question "will the transport accept it?" — and the two are NOT the same.
/// Slack, Teams and Discord validate every action URL server-side and require
/// an ABSOLUTE `http(s)` URL. Anything else makes them reject the ENTIRE
/// payload, so a link that cannot be dispatched must be DROPPED by the caller,
/// never emitted.
///
/// Returns `None` for every URL that is safe but undeliverable:
///
/// * [`BLOCKED_URL`] — what `safe_url` substitutes for a hostile scheme. Emitting it as a button
///   URL is what lost the alert in #13742.
/// * empty / whitespace-only — an unset `ZO_WEB_URL` produces exactly this.
/// * relative (`/path`, `?q=1`, `#frag`) — legitimate in email, meaningless to Slack, which has no
///   base URL to resolve against. An empty `ZO_WEB_URL` reaches here too.
/// * `mailto:` — allowlisted by `safe_url` and correct in an email body, but not a valid button
///   target.
/// * scheme-only / opaque / authority-less http(s) (`http:`, `https://`,
///   `http:javascript:alert(1)`) — an allowlisted scheme alone is NOT enough; Slack needs a host.
/// * anything containing a raw space or control character, which substitution can introduce.
///
/// Callers that render into a forgiving medium (HTML email, plain text) must
/// keep using [`safe_url`]: there, `href="#"` is valid, inert, and preserves
/// the visible signal that a link was neutralized.
pub(crate) fn dispatchable_url(url: &str) -> Option<&str> {
    let trimmed = safe_url(url).trim();

    // A raw space or control character breaks the transport even when the
    // scheme and host are fine, and substitution can introduce either.
    if trimmed
        .chars()
        .any(|c| c == ' ' || c.is_control() || c.is_whitespace())
    {
        return None;
    }

    // `safe_url` passes relative URLs through by design; they cannot be
    // resolved by a transport that has no base URL, so they stop here.
    let scheme_end = trimmed
        .find([':', '/', '?', '#'])
        .filter(|&i| trimmed.as_bytes()[i] == b':')?;

    // Schemes are ASCII case-insensitive per RFC 3986.
    let scheme = &trimmed[..scheme_end];
    if !DISPATCHABLE_URL_SCHEMES
        .iter()
        .any(|allowed| scheme.eq_ignore_ascii_case(allowed))
    {
        return None;
    }

    // An allowlisted scheme is NOT sufficient. `http:javascript:alert(1)` and
    // `https://` are both valid RFC 3986 http(s) URLs — the first is OPAQUE
    // (no authority), the second has an empty one — and Slack rejects both
    // with the very `400 invalid_attachments` this function exists to
    // prevent. Require a non-empty authority.
    let authority = trimmed[scheme_end + 1..].strip_prefix("//")?;
    let authority_end = authority.find(['/', '?', '#']).unwrap_or(authority.len());
    if authority[..authority_end].is_empty() {
        return None;
    }

    Some(trimmed)
}

/// Render `content` for `format`.
pub fn render(
    format: ChannelFormat,
    content: &RenderedContent,
    ctx: &NotificationContext,
) -> Result<RenderedMessage, RenderError> {
    let json_body = |v: serde_json::Value| RenderedMessage::Http {
        // A `serde_json::Value` cannot fail to serialize.
        body: serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()),
    };

    match format {
        ChannelFormat::Slack => Ok(json_body(slack::render_slack(content, ctx))),
        ChannelFormat::TeamsAdaptiveCard => {
            Ok(json_body(teams::render_teams_adaptive_card(content, ctx)))
        }
        ChannelFormat::TeamsMessageCard => Ok(json_body(teams::render_teams_message_card(content))),
        ChannelFormat::Webhook => Ok(json_body(webhook::render_webhook(content, ctx))),
        ChannelFormat::Email => {
            let (subject, html, text) = email::render_email(content, ctx);
            Ok(RenderedMessage::Email {
                subject,
                html,
                text,
            })
        }
        ChannelFormat::Discord => Ok(json_body(discord::render_discord(content, ctx))),
        ChannelFormat::PagerDuty => Ok(json_body(pagerduty::render_pagerduty(content, ctx))),
        ChannelFormat::Opsgenie => Ok(json_body(opsgenie::render_opsgenie(content))),
        ChannelFormat::ServiceNow => Ok(json_body(servicenow::render_servicenow(content))),
        ChannelFormat::Sns => {
            let (subject, message) = sns::render_sns(content);
            Ok(RenderedMessage::Sns { subject, message })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use config::meta::alerts::level::AlertLevel;

    use super::*;

    /// Mirrors `resolve`'s fixture context (itself mirroring Task 5's).
    fn fixture_ctx() -> NotificationContext {
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
            // Deliberately empty: exercises the §5.3 typed-absence rule.
            alert_description: String::new(),
            promql_operator: None,
            promql_value: None,
            rows: vec![serde_json::from_str(r#"{"host":"web-1","cpu":92.5}"#).unwrap()],
            rows_tpl_val: vec![serde_json::json!("web-1 92.5")],
            row_columns: vec![
                ("host".into(), vec!["web-1".into()]),
                ("cpu".into(), vec!["92.5".into()]),
            ],
            context_attributes: vec![("env".into(), "prod".into())],
            metadata: vec![("channel".into(), "#alerts".into())],
            group_labels: Some(BTreeMap::from([("pod".into(), "web-1".into())])),
            level: Some(AlertLevel::Critical),
            chart_url: None,
            chart_png: None,
        }
    }

    fn hostile_content() -> RenderedContent {
        RenderedContent {
            title: r#"CPU "high" & <fire> on web-1"#.into(),
            body_markdown:
                "Value **92.5** exceeded `80` — see [runbook](https://rb.example/x)\n\n<script>alert(1)</script>"
                    .into(),
            fields: vec![
                ("host".into(), "web-1 & web-2".into()),
                ("cpu".into(), "92.5".into()),
            ],
            links: vec![
                ("Runbook".into(), "https://rb.example/x".into()),
                ("".into(), "https://o2.example/short/abc".into()),
            ],
            rows: vec![vec![
                ("host".into(), "web-1".into()),
                ("cpu".into(), "92.5".into()),
            ]],
            row_lines: None,
            severity: Some(AlertLevel::Critical),
            unknown_variables: vec![],
        }
    }

    fn http_body(format: ChannelFormat) -> String {
        match render(format, &hostile_content(), &fixture_ctx()).unwrap() {
            RenderedMessage::Http { body } => body,
            other => panic!("expected Http, got {other:?}"),
        }
    }

    // ---- Goldens (captured, then hand-verified — see task-8 report) --------

    const GOLDEN_SLACK: &str = include_str!("testdata/slack.json");
    const GOLDEN_TEAMS_ADAPTIVE: &str = include_str!("testdata/teams_adaptive_card.json");
    const GOLDEN_TEAMS_MESSAGE: &str = include_str!("testdata/teams_message_card.json");
    const GOLDEN_WEBHOOK: &str = include_str!("testdata/webhook.json");
    const GOLDEN_EMAIL_HTML: &str = include_str!("testdata/email.html");
    const GOLDEN_EMAIL_TEXT: &str = include_str!("testdata/email.txt");
    const GOLDEN_DISCORD: &str = include_str!("testdata/discord.json");
    const GOLDEN_PAGERDUTY: &str = include_str!("testdata/pagerduty.json");
    const GOLDEN_OPSGENIE: &str = include_str!("testdata/opsgenie.json");
    const GOLDEN_SERVICENOW: &str = include_str!("testdata/servicenow.json");
    const GOLDEN_SNS: &str = include_str!("testdata/sns.txt");

    #[test]
    fn golden_slack_block_kit() {
        let body = http_body(ChannelFormat::Slack);
        // Always-valid JSON, asserted rather than eyeballed.
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();

        // mrkdwn safety: `&`/`<`/`>` entity-encoded in every mrkdwn text run.
        let fields = &v["attachments"][0]["blocks"][2]["fields"];
        assert_eq!(fields[0]["text"], "*host*\nweb-1 &amp; web-2");
        let section = v["attachments"][0]["blocks"][1]["text"]["text"]
            .as_str()
            .unwrap();
        assert!(section.contains("&lt;script&gt;"));
        assert!(!section.contains("<script>"));
        // The title is a bold mrkdwn LINK to the alert (Datadog-style,
        // user-picked in a live A/B) — the label IS mrkdwn, so `&`/`<`/`>`
        // are entity-encoded, unlike the plain_text header fallback.
        assert_eq!(
            v["attachments"][0]["blocks"][0]["text"]["text"],
            r#"*<https://o2.example/short/abc|CPU "high" &amp; &lt;fire&gt; on web-1>*"#
        );
        // Empty link label gets the renderer default; buttons live in the
        // second (tail) attachment.
        let buttons = &v["attachments"][1]["blocks"][0];
        assert_eq!(buttons["elements"][1]["text"]["text"], DEFAULT_LINK_LABEL);
        // Severity stripe.
        assert_eq!(v["attachments"][0]["color"], "#E01E5A");

        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_SLACK).unwrap()
        );
    }

    #[test]
    fn golden_teams_adaptive_card() {
        let body = http_body(ChannelFormat::TeamsAdaptiveCard);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        let content = &v["attachments"][0]["content"];
        assert_eq!(content["version"], "1.4");
        assert_eq!(content["body"][0]["color"], "attention"); // critical
        // Adaptive Card TextBlocks are not HTML — the script tag survives as
        // INERT text (never rendered as markup by the card host), and the
        // markdown emphasis markers are gone.
        let body_text = content["body"][1]["text"].as_str().unwrap();
        assert!(!body_text.contains("**"));
        assert!(body_text.contains("alert(1)"));
        assert_eq!(
            content["actions"][1]["title"].as_str().unwrap(),
            DEFAULT_LINK_LABEL
        );
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_TEAMS_ADAPTIVE).unwrap()
        );
    }

    #[test]
    fn golden_teams_message_card() {
        let body = http_body(ChannelFormat::TeamsMessageCard);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["@type"], "MessageCard");
        assert_eq!(v["themeColor"], "E01E5A"); // critical, no leading '#'
        // MessageCard text IS rendered as markup → must be entity-encoded.
        let text = v["sections"][0]["text"].as_str().unwrap();
        assert!(!text.contains("<script>"));
        assert!(text.contains("&lt;script&gt;"));
        assert_eq!(v["sections"][0]["facts"][0]["value"], "web-1 &amp; web-2");
        assert_eq!(v["potentialAction"][1]["name"], DEFAULT_LINK_LABEL);
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_TEAMS_MESSAGE).unwrap()
        );
    }

    #[test]
    fn golden_email_html_and_text() {
        let (subject, html, text) =
            match render(ChannelFormat::Email, &hostile_content(), &fixture_ctx()).unwrap() {
                RenderedMessage::Email {
                    subject,
                    html,
                    text,
                } => (subject, html, text),
                other => panic!("expected Email, got {other:?}"),
            };

        // HTML injection neutralized, everywhere.
        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<script>"));
        assert!(!html.contains("</script>"));
        assert!(!html.to_lowercase().contains("<script"));
        // Hostile title characters escaped in the visible HTML...
        assert!(html.contains("CPU &quot;high&quot; &amp; &lt;fire&gt; on web-1"));
        // ...but the SUBJECT is a mail header, not HTML — raw is correct.
        assert_eq!(subject, r#"CPU "high" & <fire> on web-1"#);
        assert!(html.contains(DEFAULT_LINK_LABEL));
        assert!(text.contains(&format!(
            "{DEFAULT_LINK_LABEL}: https://o2.example/short/abc"
        )));

        // Goldens carry a trailing newline (see `capture_goldens`); the
        // renderer's output does not, so strip exactly that.
        assert_eq!(html, GOLDEN_EMAIL_HTML.strip_suffix('\n').unwrap());
        assert_eq!(text, GOLDEN_EMAIL_TEXT.strip_suffix('\n').unwrap());
    }

    #[test]
    fn golden_webhook_envelope() {
        let body = http_body(ChannelFormat::Webhook);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["severity"], "critical");
        assert!(v["context"]["alert_name"].is_string());
        // §5.3 typed absence: an empty scalar is JSON null, never "".
        assert!(v["context"]["alert_description"].is_null());
        assert_ne!(v["context"]["alert_description"], "");
        // Machine consumers get RAW values — entity-encoding would corrupt
        // the data; JSON validity is serde's guarantee (asserted above).
        assert_eq!(v["title"], r#"CPU "high" & <fire> on web-1"#);
        assert_eq!(v["chart_url"], serde_json::Value::Null);
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_WEBHOOK).unwrap()
        );
    }

    #[test]
    fn golden_discord() {
        let body = http_body(ChannelFormat::Discord);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        let embed = &v["embeds"][0];
        assert_eq!(embed["title"], r#"CPU "high" & <fire> on web-1"#);
        // Discord's markdown DOES honor a backslash escape (unlike Slack's
        // mrkdwn), so the hostile `<script>` text survives as inert markdown
        // source rather than being interpreted as HTML.
        assert!(embed["description"].as_str().unwrap().contains("<script>"));
        assert_eq!(embed["color"], 0xE01E5A);
        // The FIRST link becomes the embed's clickable title link (a Discord
        // embed has one), whatever it is — here that's the author-added
        // "Runbook" link, since it precedes the alert URL in `hostile_content`.
        assert_eq!(embed["url"], "https://rb.example/x");
        // The alert URL (second link, empty label) has no embed slot left,
        // so it's folded into the description as a markdown link.
        assert!(
            embed["description"]
                .as_str()
                .unwrap()
                .contains("https://o2.example/short/abc")
        );
        let fields = embed["fields"].as_array().unwrap();
        assert!(fields.iter().any(|f| f["name"] == "host"));
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_DISCORD).unwrap()
        );
    }

    #[test]
    fn golden_pagerduty() {
        let body = http_body(ChannelFormat::PagerDuty);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["event_action"], "trigger");
        assert_eq!(v["payload"]["summary"], r#"CPU "high" & <fire> on web-1"#);
        assert_eq!(v["payload"]["severity"], "critical");
        assert_eq!(v["payload"]["custom_details"]["host"], "web-1 & web-2");
        assert!(
            v["payload"]["custom_details"]["body"]
                .as_str()
                .unwrap()
                .contains("<script>")
        );
        assert_eq!(v["links"][1]["text"], DEFAULT_LINK_LABEL);
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_PAGERDUTY).unwrap()
        );
    }

    #[test]
    fn golden_opsgenie() {
        let body = http_body(ChannelFormat::Opsgenie);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["message"], r#"CPU "high" & <fire> on web-1"#);
        assert_eq!(v["priority"], "P1");
        assert_eq!(v["details"]["host"], "web-1 & web-2");
        assert!(v["description"].as_str().unwrap().contains("<script>"));
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_OPSGENIE).unwrap()
        );
    }

    #[test]
    fn golden_servicenow() {
        let body = http_body(ChannelFormat::ServiceNow);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["short_description"], r#"CPU "high" & <fire> on web-1"#);
        let description = v["description"].as_str().unwrap();
        assert!(description.contains("<script>"));
        assert!(description.contains("host: web-1 & web-2"));
        assert_eq!(
            v,
            serde_json::from_str::<serde_json::Value>(GOLDEN_SERVICENOW).unwrap()
        );
    }

    #[test]
    fn golden_sns() {
        let (subject, message) =
            match render(ChannelFormat::Sns, &hostile_content(), &fixture_ctx()).unwrap() {
                RenderedMessage::Sns { subject, message } => (subject, message),
                other => panic!("expected Sns, got {other:?}"),
            };
        assert_eq!(subject, r#"CPU "high" & <fire> on web-1"#);
        // Plaintext: no markdown markup, hostile HTML survives as inert text.
        assert!(!message.contains("**"));
        assert!(message.contains("<script>alert(1)</script>"));
        assert!(message.contains("host: web-1 & web-2"));
        assert!(message.contains("https://rb.example/x"));
        assert!(message.contains("https://o2.example/short/abc"));
        assert_eq!(message, GOLDEN_SNS.strip_suffix('\n').unwrap());
    }

    /// The empty-label divergence is DELIBERATE, not incidental.
    ///
    /// `resolve` appends the alert URL with an empty label. The webhook
    /// envelope — a versioned machine contract — passes that empty string
    /// through verbatim, because it is the unambiguous signal "no label was
    /// authored; consumer chooses its own presentation". Baking the English
    /// literal in would leak English into non-English orgs' payloads and
    /// would make an authored "View alert" indistinguishable from a
    /// defaulted one (design §4.2: the label is i18n-seeded and editable).
    ///
    /// The human-facing formats substitute the display default instead. This
    /// test renders the SAME content both ways and pins both halves, so the
    /// divergence cannot regress in either direction.
    #[test]
    fn empty_link_label_is_verbatim_in_envelope_but_defaulted_when_rendered() {
        let content = hostile_content();
        let ctx = fixture_ctx();
        // The fixture's second link is the appended alert URL, empty-labelled.
        assert_eq!(content.links[1].0, "");

        // Machine contract: empty label survives verbatim...
        let envelope = webhook::render_webhook(&content, &ctx);
        assert_eq!(envelope["links"][1]["label"], "");
        assert_ne!(envelope["links"][1]["label"], DEFAULT_LINK_LABEL);
        assert_eq!(envelope["links"][1]["url"], "https://o2.example/short/abc");
        // ...and an authored label is untouched.
        assert_eq!(envelope["links"][0]["label"], "Runbook");

        // Human-facing formats: the SAME content gets the display default.
        let slack = slack::render_slack(&content, &fixture_ctx());
        let actions = &slack["attachments"][1]["blocks"][0];
        assert_eq!(actions["elements"][1]["text"]["text"], DEFAULT_LINK_LABEL);

        let card = teams::render_teams_adaptive_card(&content, &fixture_ctx());
        assert_eq!(
            card["attachments"][0]["content"]["actions"][1]["title"],
            DEFAULT_LINK_LABEL
        );

        let msg_card = teams::render_teams_message_card(&content);
        assert_eq!(msg_card["potentialAction"][1]["name"], DEFAULT_LINK_LABEL);

        let (_, html, text) = email::render_email(&content, &fixture_ctx());
        assert!(html.contains(DEFAULT_LINK_LABEL));
        assert!(text.contains(&format!(
            "{DEFAULT_LINK_LABEL}: https://o2.example/short/abc"
        )));
    }

    #[test]
    fn severity_presentation_table() {
        assert_eq!(severity_color(Some(AlertLevel::Critical)), "#E01E5A");
        assert_eq!(severity_color(Some(AlertLevel::Warning)), "#ECB22E");
        assert_eq!(severity_color(Some(AlertLevel::NoData)), "#9AA0A6");
        assert_eq!(severity_color(Some(AlertLevel::Ok)), "#2EB67D");
        assert_eq!(severity_color(None), "#4A90D9");
    }

    #[test]
    fn severity_label_table() {
        assert_eq!(severity_label(Some(AlertLevel::Critical)), Some("CRITICAL"));
        assert_eq!(severity_label(Some(AlertLevel::Warning)), Some("WARNING"));
        assert_eq!(severity_label(Some(AlertLevel::NoData)), Some("NO DATA"));
        assert_eq!(severity_label(Some(AlertLevel::Ok)), Some("RECOVERED"));
        // Single-level alert: no badge at all, not a misleading label.
        assert_eq!(severity_label(None), None);
    }

    /// Color alone is insufficient — live user feedback: a 4px stripe is easy
    /// to miss, especially in an email preview pane. Every severity-bearing
    /// notification must carry the label as TEXT somewhere, not just a color.
    #[test]
    fn severity_communicated_via_text_not_color_alone() {
        let mut c = hostile_content();
        c.severity = Some(AlertLevel::Warning);

        let (_, html, text) = email::render_email(&c, &fixture_ctx());
        assert!(html.contains("WARNING"), "{html}");
        assert!(text.starts_with("[WARNING] "), "{text}");
    }

    /// A single-level alert (`severity: None`) must show no badge — there is
    /// no level to report, and a fallback label ("OK"/"UNKNOWN") would imply
    /// one that was never computed.
    #[test]
    fn single_level_alert_shows_no_severity_badge() {
        let mut c = hostile_content();
        c.severity = None;

        let (_, html, text) = email::render_email(&c, &fixture_ctx());
        assert!(!html.contains("CRITICAL"), "{html}");
        assert!(!text.starts_with('['), "{text}");
    }

    #[test]
    fn pagerduty_severity_table() {
        use pagerduty::pagerduty_severity;
        assert_eq!(pagerduty_severity(Some(AlertLevel::Critical)), "critical");
        assert_eq!(pagerduty_severity(Some(AlertLevel::Warning)), "warning");
        assert_eq!(pagerduty_severity(Some(AlertLevel::NoData)), "warning");
        assert_eq!(pagerduty_severity(Some(AlertLevel::Ok)), "info");
        assert_eq!(pagerduty_severity(None), "error");
    }

    #[test]
    fn opsgenie_priority_table() {
        use opsgenie::opsgenie_priority;
        assert_eq!(opsgenie_priority(Some(AlertLevel::Critical)), "P1");
        assert_eq!(opsgenie_priority(Some(AlertLevel::Warning)), "P3");
        assert_eq!(opsgenie_priority(Some(AlertLevel::NoData)), "P3");
        assert_eq!(opsgenie_priority(Some(AlertLevel::Ok)), "P5");
        assert_eq!(opsgenie_priority(None), "P2");
    }

    #[test]
    fn all_formats_produce_a_result() {
        for f in [
            ChannelFormat::Slack,
            ChannelFormat::TeamsAdaptiveCard,
            ChannelFormat::TeamsMessageCard,
            ChannelFormat::Webhook,
            ChannelFormat::Email,
            ChannelFormat::Discord,
            ChannelFormat::PagerDuty,
            ChannelFormat::Opsgenie,
            ChannelFormat::ServiceNow,
            ChannelFormat::Sns,
        ] {
            render(f, &hostile_content(), &fixture_ctx())
                .unwrap_or_else(|e| panic!("{f:?} renderer failed: {e}"));
        }
    }

    #[test]
    fn all_phase_1a_formats_produce_parseable_json() {
        for f in [
            ChannelFormat::Slack,
            ChannelFormat::TeamsAdaptiveCard,
            ChannelFormat::TeamsMessageCard,
            ChannelFormat::Webhook,
            ChannelFormat::Discord,
            ChannelFormat::PagerDuty,
            ChannelFormat::Opsgenie,
            ChannelFormat::ServiceNow,
        ] {
            let body = http_body(f);
            serde_json::from_str::<serde_json::Value>(&body)
                .unwrap_or_else(|e| panic!("{f:?} produced invalid JSON: {e}"));
        }
    }

    #[test]
    fn empty_severity_uses_brand_neutral_stripe() {
        let mut c = hostile_content();
        c.severity = None;
        let v = slack::render_slack(&c, &fixture_ctx());
        assert_eq!(v["attachments"][0]["color"], "#4A90D9");
    }

    /// The user-picked "full stripe" split (live A/B on a real channel):
    /// content in attachment[0], buttons + chart in attachment[1], BOTH
    /// carrying the severity color so the stripe runs beside everything.
    /// Split in two because Slack folds any single tall attachment behind
    /// "Show more" — live-observed hiding first the buttons, then the chart
    /// — while two short halves each stay under the fold threshold. No
    /// top-level `blocks` at all.
    #[test]
    fn content_and_tail_split_across_two_striped_attachments() {
        let v = slack::render_slack(&hostile_content(), &fixture_ctx());
        assert!(
            v.get("blocks").is_none(),
            "no top-level blocks — the stripe only spans attachment content"
        );
        let attachments = v["attachments"].as_array().unwrap();
        assert_eq!(attachments.len(), 2);
        assert_eq!(
            attachments[0]["color"], attachments[1]["color"],
            "both halves carry the same severity color for a continuous stripe"
        );
        // Content half: linked title first (fixture ctx has an alert URL).
        let content = attachments[0]["blocks"].as_array().unwrap();
        assert_eq!(content[0]["type"], "section");
        // Tail half: just the actions (fixture ctx has no chart URL).
        let tail = attachments[1]["blocks"].as_array().unwrap();
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0]["type"], "actions");
    }

    /// No links and no chart → the tail attachment is OMITTED entirely:
    /// live-verified that an attachment with `color` and empty `blocks`
    /// renders nothing, so emitting it would be dead weight in the payload.
    #[test]
    fn empty_tail_attachment_is_omitted() {
        let mut c = hostile_content();
        c.links.clear();
        let v = slack::render_slack(&c, &fixture_ctx());
        assert_eq!(v["attachments"].as_array().unwrap().len(), 1);
    }

    /// Live-verified against a real Slack webhook: a field value beginning
    /// with `>` (raw or `&gt;`-entity-encoded) is parsed as blockquote
    /// syntax and Slack consumes the `>`/`&gt;` as structure — e.g. a
    /// `{alert_operator} {alert_threshold}` field value of `>= 5` renders as
    /// just `= 5`. `render_slack` must guard against a leading `>`/`&gt;` in
    /// field values (and in `row_lines`, which are also raw `\n`-joined
    /// lines) by inserting a leading space, which Slack trims visually.
    #[test]
    fn field_value_starting_with_operator_does_not_trigger_blockquote() {
        let mut c = hostile_content();
        c.fields = vec![("Threshold".into(), ">= 5".into())];
        let v = slack::render_slack(&c, &fixture_ctx());
        let blocks = v["attachments"][0]["blocks"].as_array().unwrap();
        let fields_block = blocks
            .iter()
            .find(|b| b["fields"].is_array())
            .expect("a fields section block");
        let text = fields_block["fields"][0]["text"].as_str().unwrap();
        assert!(
            !text.contains("\n>") && !text.contains("\n&gt;"),
            "field value's line must not start with the raw or entity-encoded \
             blockquote trigger: {text}"
        );
        assert!(
            text.ends_with(">= 5") || text.ends_with("&gt;= 5"),
            "{text}"
        );
    }

    #[test]
    fn clamp_is_char_safe_on_multibyte() {
        // Byte slicing here would panic; character slicing must not.
        assert_eq!(clamp("ααααα", 3), "αα…");
        assert_eq!(clamp("abc", 10), "abc");
    }

    #[test]
    fn row_lines_take_precedence_over_rows() {
        let mut c = hostile_content();
        c.row_lines = Some(vec!["web-1 & 92.5".into()]);
        let v = slack::render_slack(&c, &fixture_ctx());
        let text = v["attachments"][0]["blocks"][3]["text"]["text"]
            .as_str()
            .unwrap();
        assert_eq!(text, "web-1 &amp; 92.5");
    }

    #[test]
    fn email_drops_hostile_href_scheme() {
        let mut c = hostile_content();
        c.links = vec![("evil".into(), "javascript:alert(1)".into())];
        let (_, html, text) = email::render_email(&c, &fixture_ctx());
        assert!(!html.contains("javascript:"));
        assert!(html.contains(r##"href="#""##));
        // The plaintext part linkifies too — same filter applies.
        assert!(!text.contains("javascript:"));
    }

    /// URL scheme filtering is GLOBAL, not email-only.
    ///
    /// Link URLs are author-supplied templates that undergo variable
    /// substitution, so a hostile field value can reach a URL. Slack and Teams
    /// validate action URLs server-side, making this defense in depth — but
    /// filtering in one renderer only would invite the reader to assume it is
    /// global when it is not. Every renderer that emits a link is asserted
    /// here so the guarantee cannot silently become partial again.
    ///
    /// Two different NEUTRALIZATIONS, by medium (#13742):
    ///
    /// * Strict transports (Slack, Teams, Discord) validate action URLs and reject the whole
    ///   payload if one is invalid, so the hostile link is DROPPED — emitting the `BLOCKED_URL`
    ///   placeholder there cost the alert its delivery.
    /// * Forgiving media (HTML email, plain text) SUBSTITUTE the placeholder: `href="#"` is valid
    ///   and inert, and keeping the row preserves the visible signal that a link was neutralized.
    ///
    /// Either way the hostile URL never reaches the recipient.
    #[test]
    fn all_renderers_drop_hostile_url_schemes() {
        for hostile in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",   // scheme match is case-insensitive
            "  javascript:alert(1)", // and ignores leading whitespace
            "data:text/html;base64,PHNjcmlwdD4=",
            // Bypasses that defeat a naive blocklist but not an allowlist.
            "java\tscript:alert(1)", // control char stripped by clients
            "java\nscript:alert(1)",
            "\u{0}javascript:alert(1)", // NUL is not Unicode whitespace
            "java%73cript:alert(1)",    // percent-encoded scheme
            "vbscript:msgbox(1)",       // never was on the blocklist
            "VBScript:msgbox(1)",
            "file:///etc/passwd",
        ] {
            let mut c = hostile_content();
            // A legitimate link alongside the hostile one: without it the
            // "dropped" assertions below could pass vacuously on a renderer
            // that emitted no actions at all for an unrelated reason.
            c.links = vec![
                ("evil".into(), hostile.into()),
                ("Runbook".into(), "https://rb.example/x".into()),
            ];
            let survivor = "https://rb.example/x";

            // Strict transports: the hostile link is gone, the good one stays.
            let slack = slack::render_slack(&c, &fixture_ctx());
            let elements = &slack["attachments"][1]["blocks"][0]["elements"];
            assert_eq!(
                elements.as_array().map(Vec::len),
                Some(1),
                "slack leaked {hostile}"
            );
            assert_eq!(elements[0]["url"], survivor, "slack dropped the wrong link");

            let card = teams::render_teams_adaptive_card(&c, &fixture_ctx());
            let actions = &card["attachments"][0]["content"]["actions"];
            assert_eq!(
                actions.as_array().map(Vec::len),
                Some(1),
                "adaptive card leaked {hostile}"
            );
            assert_eq!(
                actions[0]["url"], survivor,
                "adaptive card dropped the wrong link"
            );

            let msg = teams::render_teams_message_card(&c);
            let potential = &msg["potentialAction"];
            assert_eq!(
                potential.as_array().map(Vec::len),
                Some(1),
                "message card leaked {hostile}"
            );
            assert_eq!(
                potential[0]["targets"][0]["uri"], survivor,
                "message card dropped the wrong link"
            );

            // PagerDuty validates `links[].href` too.
            let pd = pagerduty::render_pagerduty(&c, &fixture_ctx());
            let pd_links = pd["links"].as_array().expect("pagerduty links");
            assert_eq!(pd_links.len(), 1, "pagerduty leaked {hostile}");
            assert_eq!(
                pd_links[0]["href"], survivor,
                "pagerduty dropped the wrong link"
            );

            // Forgiving media: the row survives with the placeholder.
            let (_, html, text) = email::render_email(&c, &fixture_ctx());
            // Assert the placeholder positively: a `!contains` alone would
            // pass vacuously if escaping merely reshaped the hostile string.
            assert!(
                html.contains(&format!(r#"href="{BLOCKED_URL}""#)),
                "email html did not block {hostile}"
            );
            assert!(
                text.contains(&format!("evil: {BLOCKED_URL}")),
                "email text did not block {hostile}"
            );

            // SNS fans out to email/SMS clients that linkify bare URLs, so
            // its plaintext gets the same substitution as email's.
            let (_, sns_text) = sns::render_sns(&c);
            assert!(
                sns_text.contains(&format!("evil: {BLOCKED_URL}")),
                "sns did not block {hostile}: {sns_text}"
            );
        }
    }

    #[test]
    fn safe_url_leaves_legitimate_urls_untouched() {
        // Guard against over-blocking — an allowlist's characteristic
        // failure mode is rejecting something legitimate.
        for ok in [
            "https://o2.example/short/abc",
            "http://intranet/alert?q=1&x=2",
            "HTTPS://o2.example/x", // allowlist is case-insensitive too
            "mailto:oncall@example.com",
        ] {
            assert_eq!(safe_url(ok), ok);
        }

        // Scheme-less URLs are permitted by an EXPLICIT branch (see the doc
        // comment) — an author writing a relative link is legitimate, and a
        // scheme-less URL cannot carry active content.
        for relative in ["/alerts/123", "?tab=history", "#anchor", "alerts/123"] {
            assert_eq!(safe_url(relative), relative);
        }

        // A `:` appearing after a path separator does not make a scheme.
        assert_eq!(safe_url("/a:b"), "/a:b");
        assert_eq!(
            safe_url("https://x/javascript:foo"),
            "https://x/javascript:foo"
        );

        // Whitespace is still trimmed, as before.
        assert_eq!(safe_url("  https://x/y  "), "https://x/y");
    }

    /// The bypasses an adversarial pass enumerated against the previous
    /// BLOCKLIST. Each defeats a naive `starts_with("javascript:")` while a
    /// WHATWG-conformant client would still dispatch it; the allowlist blocks
    /// all of them because none BEGINS with an allowed scheme.
    #[test]
    fn safe_url_blocks_blocklist_bypasses() {
        for bypass in [
            "java\tscript:alert(1)",    // control char stripped by clients
            "java\nscript:alert(1)",    // ditto
            "java\rscript:alert(1)",    // ditto
            "\u{0}javascript:alert(1)", // NUL is not Unicode whitespace
            "java%73cript:alert(1)",    // percent-encoded scheme
            "vbscript:msgbox(1)",       // never on the blocklist
            "VBScript:msgbox(1)",       // and its mixed case
            "JaVaScRiPt:alert(1)",      // mixed case
            "file:///etc/passwd",       // local file access
            "data:text/html,<script>1", // active content by data URL
        ] {
            assert_eq!(safe_url(bypass), BLOCKED_URL, "leaked: {bypass:?}");
        }
    }

    /// A URL that is SAFE is not automatically DISPATCHABLE.
    ///
    /// Regression test for #13742: `safe_url` correctly rewrote
    /// `javascript:alert(1)` to `BLOCKED_URL` ("#"), the renderer put "#" in a
    /// Slack button's `url`, and Slack rejected the WHOLE message with
    /// `400 invalid_attachments` — the alert was lost outright. Slack, Teams
    /// and Discord validate action URLs server-side and require an absolute
    /// `http(s)` URL, so every value that is inert-but-relative must be
    /// reported as undispatchable so the renderer can DROP the link rather
    /// than emit a payload the transport will reject.
    #[test]
    fn dispatchable_url_rejects_safe_but_undeliverable_urls() {
        for undeliverable in [
            BLOCKED_URL,      // what safe_url substitutes for a hostile scheme
            "",               // unset ZO_WEB_URL yields an empty alert_url
            "   ",            // ...and a whitespace-only one
            "/web/logs?a=1",  // empty ZO_WEB_URL leaves a root-relative path
            "?query=1",       // query-only relative URL
            "#anchor",        // fragment-only relative URL
            "mailto:a@b.com", // safe + useful in email, invalid as a button URL
            // An allowlisted scheme is NOT sufficient: Slack needs an
            // authority too. These are OPAQUE http(s) URLs — valid per
            // RFC 3986, rejected by Slack, and the same lost-alert bug as
            // #13742 if they are ever emitted.
            "http:javascript:alert(1)",
            "https:alert(1)",
            "http:",
            "https://",
            "https:///path", // authority present but empty
            // Raw control characters and spaces break the transport even
            // when the scheme and host are fine.
            "https://x/ y",
            "https://x\ny",
            "https://x\ty",
            "http://ex.com\u{0}",
        ] {
            assert_eq!(
                dispatchable_url(undeliverable),
                None,
                "would be sent to a strict transport: {undeliverable:?}"
            );
        }

        // Absolute http(s) URLs remain dispatchable, hostile path notwithstanding.
        for ok in [
            "https://o2.example/short/abc",
            "http://o2.example/web/logs",
            "  https://o2.example/x  ", // trimmed, not rejected
            "HTTPS://o2.example/x",     // scheme match is case-insensitive
        ] {
            assert_eq!(
                dispatchable_url(ok),
                Some(ok.trim()),
                "over-blocked: {ok:?}"
            );
        }
    }

    /// #13742: a hostile link URL must never cost the alert its delivery.
    ///
    /// The blocked link is DROPPED from the action list; the message itself —
    /// title, body, fields and the legitimate "View in OpenObserve" link —
    /// still renders and still sends.
    #[test]
    fn hostile_link_is_dropped_not_emitted_as_blocked_url() {
        let mut c = hostile_content();
        c.links = vec![
            ("click".into(), "javascript:alert(1)".into()),
            ("Runbook".into(), "https://rb.example/x".into()),
            ("".into(), "https://o2.example/short/abc".into()),
        ];

        let slack = slack::render_slack(&c, &fixture_ctx());
        let elements = slack["attachments"][1]["blocks"][0]["elements"]
            .as_array()
            .expect("slack actions block");
        // The hostile link is gone; the two legitimate ones survive.
        assert_eq!(elements.len(), 2, "slack elements: {elements:#?}");
        for el in elements {
            let url = el["url"].as_str().expect("button url");
            assert!(
                url.starts_with("https://"),
                "slack emitted a non-dispatchable button url: {url:?}"
            );
        }

        let card = teams::render_teams_adaptive_card(&c, &fixture_ctx());
        let actions = card["attachments"][0]["content"]["actions"]
            .as_array()
            .expect("adaptive card actions");
        assert_eq!(actions.len(), 2, "adaptive card actions: {actions:#?}");
        for a in actions {
            let url = a["url"].as_str().expect("action url");
            assert!(
                url.starts_with("https://"),
                "adaptive card emitted a non-dispatchable action url: {url:?}"
            );
        }

        let msg = teams::render_teams_message_card(&c);
        let potential = msg["potentialAction"]
            .as_array()
            .expect("message card actions");
        assert_eq!(potential.len(), 2, "message card actions: {potential:#?}");
        for a in potential {
            let uri = a["targets"][0]["uri"].as_str().expect("target uri");
            assert!(
                uri.starts_with("https://"),
                "message card emitted a non-dispatchable uri: {uri:?}"
            );
        }
    }

    /// #13742, config-driven path: an EMPTY `ZO_WEB_URL` makes `alert_url` a
    /// root-relative path, which reaches the same strict transports through
    /// the always-appended "View in OpenObserve" link — breaking deployments
    /// that never authored a hostile template. The action block must not be
    /// emitted with an undispatchable URL, and when no link survives, no
    /// empty `actions` block may be emitted either (Slack rejects that too).
    #[test]
    fn relative_alert_url_does_not_produce_an_invalid_action_block() {
        let mut ctx = fixture_ctx();
        ctx.alert_url = "/web/logs?stream=app&org_identifier=default".into();
        let mut c = hostile_content();
        c.links = vec![("".into(), ctx.alert_url.clone())];

        let slack = slack::render_slack(&c, &ctx);
        // Only the content attachment remains: no buttons, no chart.
        for att in slack["attachments"].as_array().expect("attachments") {
            for block in att["blocks"].as_array().expect("blocks") {
                assert_ne!(
                    block["type"], "actions",
                    "slack emitted an actions block built from a relative url: {slack:#?}"
                );
            }
        }

        let card = teams::render_teams_adaptive_card(&c, &ctx);
        assert!(
            card["attachments"][0]["content"]["actions"]
                .as_array()
                .is_none_or(|a| a.is_empty()),
            "adaptive card kept a relative action url: {card:#?}"
        );

        let msg = teams::render_teams_message_card(&c);
        assert!(
            msg["potentialAction"]
                .as_array()
                .is_none_or(|a| a.is_empty()),
            "message card kept a relative action uri: {msg:#?}"
        );
    }

    /// Email is the deliberate counter-case: `href="#"` is valid, inert HTML,
    /// so email must keep BLOCKING (substituting) rather than DROPPING —
    /// the reader still sees the link's label and that it was neutralized.
    #[test]
    fn email_still_substitutes_blocked_url_rather_than_dropping() {
        let mut c = hostile_content();
        c.links = vec![("evil".into(), "javascript:alert(1)".into())];

        let (_, html, text) = email::render_email(&c, &fixture_ctx());
        assert!(
            html.contains(&format!(r#"href="{BLOCKED_URL}""#)),
            "email html should neutralize, not drop"
        );
        assert!(
            text.contains(&format!("evil: {BLOCKED_URL}")),
            "email text should neutralize, not drop"
        );
    }

    /// `row_lines` takes precedence over `rows` in EVERY renderer, not just
    /// Slack (which `row_lines_take_precedence_over_rows` already pins).
    #[test]
    fn row_lines_render_in_all_formats() {
        let mut c = hostile_content();
        c.row_lines = Some(vec!["web-1 & 92.5".into(), "web-2 & 88.1".into()]);

        // Adaptive Card: inert text, so `&` stays literal.
        let card = teams::render_teams_adaptive_card(&c, &fixture_ctx());
        let body = &card["attachments"][0]["content"]["body"];
        let block = body
            .as_array()
            .unwrap()
            .iter()
            .find(|b| {
                b["text"]
                    .as_str()
                    .is_some_and(|t| t.contains("web-1 & 92.5"))
            })
            .expect("adaptive card missing row_lines block");
        assert!(block["text"].as_str().unwrap().contains("web-2 & 88.1"));

        // MessageCard: rendered as markup, so `&` must be entity-encoded.
        let msg = teams::render_teams_message_card(&c);
        let text = msg["sections"][0]["text"].as_str().unwrap();
        assert!(text.contains("web-1 &amp; 92.5"));
        assert!(!text.contains("web-1 & 92.5"));

        // Email: HTML-escaped in the HTML part, raw in the plaintext part.
        let (_, html, plain) = email::render_email(&c, &fixture_ctx());
        assert!(html.contains("web-1 &amp; 92.5"));
        assert!(!html.contains("web-1 & 92.5"));
        assert!(plain.contains("web-1 & 92.5"));

        // And `rows` must NOT also render — row_lines replaces it.
        assert!(!plain.contains("host: web-1 | cpu: 92.5"));
    }

    /// Vendor caps actually fire. Slack's `actions` block holds at most 5
    /// elements, so a 6th link is DROPPED — documenting the data loss.
    #[test]
    fn slack_truncates_beyond_vendor_caps() {
        let mut c = hostile_content();
        c.links = (0..8)
            .map(|i| (format!("link{i}"), format!("https://example/{i}")))
            .collect();
        let v = slack::render_slack(&c, &fixture_ctx());
        let actions = &v["attachments"][1]["blocks"][0];
        let elements = actions["elements"].as_array().unwrap();
        assert_eq!(elements.len(), 5, "Block Kit caps actions elements at 5");
        // Links 5..8 are silently dropped.
        assert_eq!(elements[4]["text"]["text"], "link4");

        // Header clamps to 150 chars with an ellipsis rather than panicking.
        let mut c2 = hostile_content();
        c2.title = "x".repeat(400);
        let v2 = slack::render_slack(&c2, &fixture_ctx());
        // Linked-title path: the 150-char clamp applies to the link LABEL,
        // between the `|` and the closing `>`.
        let title = v2["attachments"][0]["blocks"][0]["text"]["text"]
            .as_str()
            .unwrap();
        let label = title.split_once('|').unwrap().1.strip_suffix(">*").unwrap();
        assert_eq!(label.chars().count(), 150);
        assert!(label.ends_with('…'));

        // Section fields cap at 10.
        let mut c3 = hostile_content();
        c3.fields = (0..14).map(|i| (format!("f{i}"), i.to_string())).collect();
        let v3 = slack::render_slack(&c3, &fixture_ctx());
        assert_eq!(
            v3["attachments"][0]["blocks"][2]["fields"]
                .as_array()
                .unwrap()
                .len(),
            10
        );
    }

    /// The default "View in OpenObserve" link (empty label, appended last by
    /// resolve) must SURVIVE the 5-element cap: author links only fill the
    /// remaining 4 slots, and the default keeps its `primary` (green) style
    /// so it stands out from the neutral author buttons.
    #[test]
    fn slack_default_link_survives_action_cap_and_stays_primary() {
        let mut c = hostile_content();
        c.links = (0..6)
            .map(|i| (format!("link{i}"), format!("https://example/{i}")))
            .collect();
        c.links
            .push((String::new(), "https://o2.example/short/abc".into()));
        let v = slack::render_slack(&c, &fixture_ctx());
        let actions = &v["attachments"][1]["blocks"][0];
        let elements = actions["elements"].as_array().unwrap();
        assert_eq!(elements.len(), 5);
        // Authors capped at 4; the default fills the reserved 5th slot.
        assert_eq!(elements[3]["text"]["text"], "link3");
        assert_eq!(elements[4]["text"]["text"], DEFAULT_LINK_LABEL);
        assert_eq!(elements[4]["style"], "primary");
        // Author buttons stay neutral — Block Kit's only styles are
        // default/primary/danger, and primary is reserved for the O2 link.
        assert!(elements[0].get("style").is_none());
    }

    /// With a chart URL present, the tail attachment holds actions BEFORE
    /// the image: if Slack's fold ever engages on that half, it must clip
    /// the chart's bottom edge, never the "View in OpenObserve" button
    /// (live-observed hidden when the buttons trailed the image).
    #[test]
    fn slack_buttons_render_above_chart_image() {
        let mut ctx = fixture_ctx();
        ctx.chart_url =
            Some("https://o2.example/api/v2/default/alerts/charts/render?d=x&s=y".into());
        let v = slack::render_slack(&hostile_content(), &ctx);
        let tail = v["attachments"][1]["blocks"].as_array().unwrap();
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0]["type"], "actions");
        assert_eq!(tail[1]["type"], "image");
        assert_eq!(
            tail[0]["elements"].as_array().unwrap().last().unwrap()["style"],
            "primary"
        );
    }

    #[test]
    fn adaptive_card_severity_colors() {
        let colors = |level| {
            let mut c = hostile_content();
            c.severity = level;
            teams::render_teams_adaptive_card(&c, &fixture_ctx())["attachments"][0]["content"]["body"][0]["color"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(colors(Some(AlertLevel::Critical)), "attention");
        assert_eq!(colors(Some(AlertLevel::Warning)), "warning");
        assert_eq!(colors(Some(AlertLevel::Ok)), "good");
        assert_eq!(colors(Some(AlertLevel::NoData)), "default");
        assert_eq!(colors(None), "default");
    }

    /// The reported markdown-injection bug, end to end, on EVERY channel.
    ///
    /// A body of `- {alert_operator}` with `alert_operator = ">="` must show a
    /// list item containing the literal text `>=`. Before the fix the `>` was
    /// parsed as a blockquote marker (`<ul><li><blockquote><p>=</p>…`) and the
    /// user saw a bare `=` — the character was silently eaten on all five.
    ///
    /// This drives the real `resolve_content` → `render` path rather than a
    /// hand-built `RenderedContent`, because the defect lives in the seam
    /// between them and a hand-built fixture would bypass it entirely.
    #[test]
    fn substituted_value_does_not_inject_markdown_on_any_channel() {
        use config::meta::alerts::content_spec::ContentSpec;

        use crate::alerts::notifications::resolve::resolve_content;

        let spec = ContentSpec {
            title: "t".into(),
            body: "- {alert_operator}".into(),
            ..Default::default()
        };
        let ctx = fixture_ctx();
        assert_eq!(
            ctx.alert_operator, ">=",
            "fixture must carry the bug's value"
        );

        // Slack — mrkdwn entity-encodes `>` as `&gt;`, so the bullet must
        // carry `&gt;=` and no blockquote marker.
        let slack = resolve_content(&spec, &ctx, "slack");
        let v = slack::render_slack(&slack, &fixture_ctx());
        let section = v["attachments"][0]["blocks"][1]["text"]["text"]
            .as_str()
            .unwrap();
        assert_eq!(section, "• &gt;=");

        // Teams Adaptive Card — inert plaintext, so the `>` stays literal.
        let teams = resolve_content(&spec, &ctx, "teams");
        let card = teams::render_teams_adaptive_card(&teams, &fixture_ctx());
        assert_eq!(card["attachments"][0]["content"]["body"][1]["text"], "• >=");

        // Teams MessageCard — rendered as markup, so entity-encoded.
        let msg = teams::render_teams_message_card(&teams);
        let text = msg["sections"][0]["text"].as_str().unwrap();
        assert!(text.contains("&gt;="), "{text}");
        assert!(!text.contains("<blockquote"), "{text}");

        // Email — HTML part keeps the list, `>=` as text, no blockquote.
        let email = resolve_content(&spec, &ctx, "email");
        let (_, html, plain) = email::render_email(&email, &fixture_ctx());
        assert!(html.contains("<li>&gt;=</li>"), "{html}");
        assert!(!html.contains("<blockquote>"), "{html}");
        // Plaintext part: bullet plus the literal operator.
        assert!(plain.contains("• >="), "{plain}");

        // Webhook — `body_markdown` carries the ESCAPED source, so a consumer
        // that renders it as markdown (the only thing the field name invites)
        // reproduces the literal `>=` rather than the bug. The RAW value stays
        // available, typed, under `context`.
        let wh = resolve_content(&spec, &ctx, "webhook");
        let env = webhook::render_webhook(&wh, &ctx);
        assert_eq!(env["body_markdown"], r"- \>\=");
        assert_eq!(env["context"]["alert_operator"], ">=");
        assert_eq!(
            markdown::markdown_to_plaintext(env["body_markdown"].as_str().unwrap()),
            "• >="
        );
    }

    /// Regenerate `testdata/`. `#[ignore]`d so a normal run never rewrites
    /// the goldens it is supposed to be checking — the whole point of a
    /// golden is that a diff is a failure, not a silent update.
    ///
    /// ```text
    /// cargo test -p openobserve-core --lib \
    ///     alerts::notifications::render::tests::capture -- --ignored
    /// ```
    ///
    /// Every regenerated file must be HAND-VERIFIED before it is committed:
    /// JSON parses, `<script>` never appears raw in the HTML, mrkdwn escapes
    /// `&`/`<`/`>`, severity colors match §4.2.1, and empty scalars are
    /// `null` (not `""`) in the webhook `context`.
    #[test]
    #[ignore]
    fn capture_goldens() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/alerts/notifications/render/testdata"
        );
        let c = hostile_content();
        let ctx = fixture_ctx();
        let w = |name: &str, s: &str| std::fs::write(format!("{dir}/{name}"), s).unwrap();
        let pretty = |v: serde_json::Value| serde_json::to_string_pretty(&v).unwrap() + "\n";
        w(
            "slack.json",
            &pretty(slack::render_slack(&c, &fixture_ctx())),
        );
        w(
            "teams_adaptive_card.json",
            &pretty(teams::render_teams_adaptive_card(&c, &fixture_ctx())),
        );
        w(
            "teams_message_card.json",
            &pretty(teams::render_teams_message_card(&c)),
        );
        w("webhook.json", &pretty(webhook::render_webhook(&c, &ctx)));
        // Trailing newline like the JSON goldens: without it, any editor or
        // pre-commit hook that adds one produces a spurious golden failure.
        // `golden_email_html_and_text` trims it back off before comparing.
        let (_, html, text) = email::render_email(&c, &fixture_ctx());
        w("email.html", &(html + "\n"));
        w("email.txt", &(text + "\n"));
        w(
            "discord.json",
            &pretty(discord::render_discord(&c, &fixture_ctx())),
        );
        w(
            "pagerduty.json",
            &pretty(pagerduty::render_pagerduty(&c, &ctx)),
        );
        w("opsgenie.json", &pretty(opsgenie::render_opsgenie(&c)));
        w(
            "servicenow.json",
            &pretty(servicenow::render_servicenow(&c)),
        );
        let (_, sns_message) = sns::render_sns(&c);
        w("sns.txt", &(sns_message + "\n"));
    }
}

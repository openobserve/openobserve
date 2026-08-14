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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::meta::alerts::level::AlertLevel;

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentSpec {
    /// Templated one-liner: Slack headline, email subject, PagerDuty summary.
    pub title: String,
    /// Per-channel title overrides keyed by channel family ("slack", "teams",
    /// "email", ...). Unknown keys ignored on read (mixed-version rule).
    pub title_overrides: HashMap<String, String>,
    /// Markdown with {var} placeholders.
    pub body: String,
    pub fields: Vec<ContentField>,
    pub rows: RowsSpec,
    pub links: Vec<ContentLink>,
    /// Phase 2 chart toggle; parsed and stored now, ignored by Phase 1 renderers.
    pub chart: ChartSpec,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentField {
    pub label: String,
    pub value: String,
    pub show_when: Option<SeverityFilter>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentLink {
    pub label: String,
    pub url: String,
    pub show_when: Option<SeverityFilter>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct RowsSpec {
    /// Whether to render rows in the notification.
    pub enabled: bool,
    /// Maximum number of rows to include in the notification (default 5).
    pub max: u16,
    /// Column names to include; None = all columns in table column order.
    pub columns: Option<Vec<String>>,
    /// Per-row line template over selected row columns; operates on full row regardless of columns
    /// selection.
    pub format: Option<String>,
}

impl Default for RowsSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            max: 5,
            columns: None,
            format: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct SeverityFilter {
    pub levels: Vec<AlertLevel>,
}

impl SeverityFilter {
    /// `None` level (single-level alert) matches nothing — design §4.2.1.
    pub fn matches(&self, level: Option<AlertLevel>) -> bool {
        match level {
            Some(l) => self.levels.contains(&l),
            None => false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ChartSpec {
    pub enabled: bool,
}

/// Schemes an authored link URL may carry.
///
/// Mirrors the render layer's allowlist (`alerts::notifications::render::
/// safe_url`) on purpose, but note which layer actually enforces what:
///
/// * **This check is a UX gate, not the security boundary.** It rejects a hostile scheme the author
///   typed LITERALLY, so they get a clear error at save time instead of a template whose link is
///   silently neutralized on every send forever after.
/// * **The render layer is what actually stops delivery.** Link URLs are templates: a scheme that
///   only materializes after `{variable}` substitution cannot be judged here at all, and `safe_url`
///   / `dispatchable_url` are what catch it. They also cover every template saved BEFORE this
///   validation existed.
///
/// So a URL passing this function is NOT thereby trusted — see the render
/// module's docs for the per-medium drop/substitute rules.
const ALLOWED_LINK_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Reject a link URL whose author-written scheme is not allowlisted.
///
/// An allowlist, not a blocklist, because a blocklist fails OPEN: `java\tscript:`,
/// `\0javascript:`, `java%73cript:` and `vbscript:` all slip past a naive
/// `starts_with("javascript:")` while a conformant client still dispatches
/// them. None of them *begin* with an allowed scheme, so an allowlist closes
/// all of them at once and fails closed on schemes nobody has thought of yet.
///
/// A link field holds a URL — so the value must actually LOOK like one. Three
/// shapes are accepted, and nothing else:
///
/// * **Absolute** — `http:`, `https:` or `mailto:` (the scheme allowlist).
/// * **Root-relative** (`/path`, `?q=1`, `#frag`) — inert, resolves against the deployment's own
///   host, and an author writing one is doing something legitimate (it renders fine in email).
/// * **Placeholder-led** (`{alert_url}`, `{alert_url}&tab=logs`, `{scheme}://host`) — link URLs are
///   TEMPLATES resolved by `substitute_raw` at send time, so there may be no author scheme to judge
///   yet. The render-time filter catches a hostile substituted value.
///
/// A bare word (`foo`, `javascript(0)`, `not a url at all`) or a bare host
/// (`runbook.example.com/x`) is REJECTED. None can execute anything — a
/// scheme-less string is just a relative path — but none is a working link
/// either, and silently accepting one means the author discovers the dead
/// link when an alert fires instead of when they save.
fn link_scheme_is_allowed(url: &str) -> bool {
    let trimmed = url.trim();

    if trimmed.is_empty() {
        return false;
    }

    // Whitespace and control characters are never valid inside a URL.
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }

    // A `:` only introduces a scheme when it precedes any path/query/fragment
    // marker, per RFC 3986 — so `/a:b` is a scheme-less path, not a scheme.
    let scheme_end = trimmed
        .find([':', '/', '?', '#'])
        .filter(|&i| trimmed.as_bytes()[i] == b':');

    let Some(end) = scheme_end else {
        // No scheme: accept a root-relative reference, or a template whose
        // scheme only materializes after substitution.
        return trimmed.starts_with(['/', '?', '#']) || is_variable_led(trimmed);
    };

    let scheme = &trimmed[..end];

    // A scheme that is ENTIRELY a variable has nothing to judge yet —
    // `{scheme}://host` is a legitimate template. Deliberately strict:
    // `{x}javascript:...` also begins with `{`, but the rest of its scheme is
    // the literal, hostile `javascript`, so it must be rejected.
    if scheme.starts_with('{') && scheme.ends_with('}') && !scheme[1..].contains('{') {
        return true;
    }

    // Schemes are ASCII case-insensitive per RFC 3986.
    if !ALLOWED_LINK_SCHEMES
        .iter()
        .any(|allowed| scheme.eq_ignore_ascii_case(allowed))
    {
        return false;
    }

    // An allowlisted scheme is necessary but NOT sufficient — `http:` and
    // `https://` carry one and are still not URLs. Delegate the actual
    // question to a WHATWG-conformant parser rather than hand-rolling it.
    //
    // A `{variable}` inside the path/query is fine: it percent-encodes and
    // still parses, so the substituted value is what ultimately matters.
    let Ok(parsed) = ::url::Url::parse(trimmed) else {
        return false;
    };

    if parsed.scheme().eq_ignore_ascii_case("mailto") {
        // The parser accepts ANY opaque path after `mailto:`, including an
        // empty one, so the mailbox shape is checked here: `local@domain`
        // with a dot in the domain.
        let addr = parsed.path();
        let Some((local, domain)) = addr.split_once('@') else {
            return false;
        };
        return !local.is_empty() && domain.contains('.') && !domain.starts_with('.');
    }

    // http(s): the parser already guarantees a non-empty host (an empty host
    // is a parse FAILURE for a special scheme). Reject hosts that parse but
    // can never resolve — `.`, `..`, `-` and friends.
    match parsed.host_str() {
        Some(host) => {
            !host.is_empty()
                && host.chars().any(|c| c.is_ascii_alphanumeric())
                && !host.starts_with(['.', '-'])
                && !host.ends_with(['.', '-'])
        }
        None => false,
    }
}

/// True when `url` begins with a `{variable}` and the remainder is plausible
/// URL tail (no whitespace — already checked — and not obvious prose).
///
/// `{alert_url}` and `{alert_url}&tab=logs` are legitimate templates whose
/// real value only exists at send time; `{x} not a url` is not.
fn is_variable_led(url: &str) -> bool {
    let Some(rest) = url.strip_prefix('{') else {
        return false;
    };
    let Some(close) = rest.find('}') else {
        return false;
    };
    // A non-empty variable name, and nothing unparseable glued on after it.
    !rest[..close].is_empty()
}

impl ContentSpec {
    pub fn parse(body: &str) -> Result<ContentSpec, serde_json::Error> {
        serde_json::from_str(body)
    }

    /// Validate authored content beyond what serde can express.
    ///
    /// Returns a human-readable error naming the offending link, so the author
    /// can fix the template instead of discovering at alert time that a link
    /// was dropped (#13742).
    pub fn validate(&self) -> Result<(), String> {
        for link in &self.links {
            if !link_scheme_is_allowed(&link.url) {
                let label = if link.label.is_empty() {
                    "<unlabeled>"
                } else {
                    link.label.as_str()
                };
                return Err(format!(
                    "link '{label}' has an unsupported URL scheme: {:?}. \
                     Links must use http, https or mailto (a relative path or \
                     a {{variable}} is also allowed).",
                    link.url
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_and_ignores_unknown_fields() {
        let spec =
            ContentSpec::parse(r#"{"title":"CPU high","body":"**{alert_name}** fired"}"#).unwrap();
        assert_eq!(spec.rows.max, 5);
        // Tolerant serde: future fields and channel keys must not break parse.
        let future = ContentSpec::parse(
            r#"{"title":"t","body":"b","body_overrides":{"slack":"x"},
                "title_overrides":{"some_future_channel":"y"},"new_field":1,
                "fields":[{"label":"l","value":"v","future":true}]}"#,
        )
        .unwrap();
        assert_eq!(
            future.title_overrides.get("some_future_channel").unwrap(),
            "y"
        );
    }

    #[test]
    fn severity_filter_none_matches_nothing() {
        let f = SeverityFilter {
            levels: vec![AlertLevel::Critical],
        };
        assert!(f.matches(Some(AlertLevel::Critical)));
        assert!(!f.matches(Some(AlertLevel::Warning)));
        assert!(!f.matches(None));
    }

    #[test]
    fn rejects_non_json() {
        assert!(ContentSpec::parse("Slack payload {alert_name}").is_err());
    }

    /// #13742: a link URL carrying an active-content scheme is rejected AT
    /// SAVE TIME with a clear error, rather than being stored and silently
    /// neutralized (or, before the fix, killing the whole notification) on
    /// every send forever after.
    #[test]
    fn rejects_link_urls_with_disallowed_schemes() {
        for hostile in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",   // scheme match is case-insensitive
            "  javascript:alert(1)", // and ignores surrounding whitespace
            "java\tscript:alert(1)", // control chars stripped by clients
            "java\nscript:alert(1)",
            "\u{0}javascript:alert(1)", // NUL is not Unicode whitespace
            "java%73cript:alert(1)",    // percent-encoded scheme
            "vbscript:msgbox(1)",
            "file:///etc/passwd",
            "data:text/html,<script>1",
            // A variable elsewhere in the URL does not excuse a hostile
            // scheme written literally in scheme position.
            "{x}javascript:alert(1)",
            // A link field holds a URL. These are not URLs — they are typos or
            // garbage, and accepting them means the author only finds out the
            // link is dead when an alert fires.
            "javascript(0)",
            "not a url at all",
            "foo",
            "runbook.example.com/x", // bare host: no scheme, ambiguous — require one
            // An allowlisted scheme with NO HOST. Per the WHATWG URL Standard
            // an empty host is a parse FAILURE for a special scheme (http/
            // https), not a warning — these are not URLs.
            "http:",
            "http://",
            "https://",
            "http:///",
            "http://?q=1",
            "http://#frag",
            "https:// ",
            // Hosts that parse but cannot resolve to anything real.
            "https://.",
            "http://..",
            "https://-",
            "http://.:80",
            // `mailto:` needs a real mailbox. The URL parser accepts ANY
            // opaque path after the scheme (even empty), so the address shape
            // has to be checked separately or `mailto:` alone would pass.
            "mailto:",
            "mailto:foo", // no @
            "mailto:@",
            "mailto:a@",        // no domain
            "mailto:@b.com",    // no local part
            "mailto:a b@c.com", // space in address
            // A variable-led template must still LOOK like a URL once the
            // variable is peeled off — a bare `{x}` with junk attached is not.
            "{x} not a url",
        ] {
            let body = serde_json::json!({
                "title": "t",
                "body": "b",
                "links": [{"label": "click", "url": hostile}],
            })
            .to_string();
            let spec = ContentSpec::parse(&body).expect("parses as JSON");
            let err = spec
                .validate()
                .expect_err(&format!("accepted hostile url: {hostile:?}"));
            // The message must name the offending link so the author can fix
            // it without guessing which of several links is at fault.
            assert!(
                err.contains("click"),
                "error should name the link label, got: {err}"
            );
        }
    }

    /// Guard against over-rejection — legitimate authored URLs must save.
    ///
    /// Link URLs are TEMPLATES: `substitute_raw` resolves `{var}` at send
    /// time, so a URL whose scheme only exists after substitution (or which
    /// is entirely a placeholder) has no author-written scheme to judge here
    /// and must be allowed through. Render-time filtering still guards it.
    #[test]
    fn accepts_legitimate_and_templated_link_urls() {
        for ok in [
            "https://runbook.example/x",
            "http://runbook.example/x",
            "mailto:oncall@example.com",
            "https://runbook.example/{stream_name}", // templated path
            "{alert_url}",                           // whole URL is a variable
            "{alert_url}&tab=logs",                  // ...and one with a suffix
            "{scheme}://host/x",                     // variable IN scheme position
            "/web/logs?stream=app",                  // relative: inert, valid in email
            // Positive counterparts to the hostile uppercase/whitespace cases
            // above: without these, dropping `eq_ignore_ascii_case` or `.trim()`
            // would still pass every test while silently over-rejecting.
            "HTTPS://runbook.example/x",
            "MailTo:oncall@example.com",
            "  https://runbook.example/x  ",
            // Real-world absolute URLs must keep working.
            "https://o2.example:8443/web/logs?a=1#f",
            "http://localhost:5080/web/logs",
            "https://user:pass@host.example/x", // userinfo is legal
            "https://[::1]:8080/x",             // IPv6 literal
            "https://192.168.1.1/x",            // IPv4 literal
        ] {
            let body = serde_json::json!({
                "title": "t",
                "body": "b",
                "links": [{"label": "click", "url": ok}],
            })
            .to_string();
            let spec = ContentSpec::parse(&body).expect("parses as JSON");
            assert!(
                spec.validate().is_ok(),
                "over-rejected legitimate url: {ok:?}"
            );
        }
    }

    /// A spec with no links at all validates — the shipped default content
    /// template has `links: []`, so this must never start failing or every
    /// node would fail to seed its templates at startup.
    #[test]
    fn accepts_spec_without_links() {
        let spec = ContentSpec::parse(r#"{"title":"t","body":"b"}"#).unwrap();
        assert!(spec.validate().is_ok());
    }
}

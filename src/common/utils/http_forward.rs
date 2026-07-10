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

//! Helpers that guard outbound webhook / alert-destination requests.
//!
//! Two invariants are enforced here:
//!
//! 1. **Client-supplied `Authorization` / `Cookie` / `X-Auth-*` headers must
//!    not be forwarded verbatim to arbitrary destinations.** They are stripped
//!    from the caller-supplied headers map before the outbound request is
//!    dispatched.
//! 2. **Third-party response bodies must not be echoed back to the API
//!    caller.** The `test_destination` and `send_http_notification` paths
//!    return only a size-capped shape summary (status code, length) instead of
//!    the raw body.

use std::collections::HashMap;

/// Case-insensitive names of headers that must never be forwarded from a
/// caller-supplied headers map to an outbound webhook or alert destination.
///
/// * `authorization` / `proxy-authorization` — server auth material for the
///   caller's session or a proxy; forwarding lets a caller relay whatever
///   credentials they hold through this server to a chosen URL (a form of
///   confused-deputy).
/// * `cookie` / `set-cookie` — session state for the caller (or the
///   destination), same relay risk.
/// * `www-authenticate` / `proxy-authenticate` — challenge headers that could
///   induce a downstream to send credentials.
/// * `x-auth-*` — a common product-specific auth-header namespace (e.g.
///   `x-auth-token`, `x-auth-user`).
///
/// Invariant asserted by [`sanitize_forward_headers_strips_sensitive`].
const SENSITIVE_HEADER_PREFIXES: &[&str] = &["x-auth-"];
const SENSITIVE_HEADER_EXACT: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "www-authenticate",
    "proxy-authenticate",
];

/// Return true if the given header name should be stripped from a
/// caller-supplied headers map before the outbound webhook / alert-trigger
/// request is dispatched. Matching is case-insensitive against
/// [`SENSITIVE_HEADER_EXACT`] and any prefix in
/// [`SENSITIVE_HEADER_PREFIXES`].
pub fn is_sensitive_forward_header(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    if SENSITIVE_HEADER_EXACT.contains(&lower.as_str()) {
        return true;
    }
    SENSITIVE_HEADER_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

/// Strip any header in [`SENSITIVE_HEADER_EXACT`] or matching a prefix in
/// [`SENSITIVE_HEADER_PREFIXES`] (case-insensitive) from a caller-supplied
/// headers map. The returned map is safe to forward verbatim on the outbound
/// webhook / alert-trigger request.
///
/// This does NOT touch the inbound API request's own `Authorization` header —
/// that stays with the incoming request. Only the user-supplied `headers`
/// field on the request body is sanitized here.
pub fn sanitize_forward_headers(
    headers: &HashMap<String, String>,
) -> HashMap<String, String> {
    headers
        .iter()
        .filter(|(k, _)| !is_sensitive_forward_header(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Format the error propagated to the API caller when an outbound webhook /
/// alert-trigger request receives a non-2xx status. The upstream response
/// body is intentionally not included — only the status code and the length
/// of the body received. The full body is still logged server-side (see
/// `send_http_notification`).
pub fn format_upstream_error(resp_status: reqwest::StatusCode, resp_body: &str) -> String {
    format!(
        "sent error status: {}, upstream response body suppressed ({} bytes)",
        resp_status,
        resp_body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hm(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    // -----------------------------------------------------------------------
    // TC-31E5785D (prong 3): the webhook-test / alert-trigger endpoints must
    // NOT forward caller-supplied `Authorization`, `Cookie`, or `X-Auth-*`
    // headers to the outbound URL. Doing so lets an org-scoped caller relay
    // whatever credentials they hold (e.g. root's `Basic` header) through
    // this server to a chosen destination — a confused-deputy that in the
    // finding was chained with an SSRF-guard bypass to read another
    // tenant's data.
    // -----------------------------------------------------------------------
    #[test]
    fn sanitize_forward_headers_strips_sensitive() {
        let raw = hm(&[
            ("Authorization", "Basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM="),
            ("authorization", "Bearer abc"),
            ("Proxy-Authorization", "Basic yy"),
            ("Cookie", "session=deadbeef"),
            ("SET-COOKIE", "session=deadbeef"),
            ("WWW-Authenticate", "Basic realm=proxy"),
            ("Proxy-Authenticate", "Basic realm=proxy"),
            ("X-Auth-Token", "tok"),
            ("x-auth-user", "u"),
            // Legitimate app headers must be preserved.
            ("Content-Type", "application/json"),
            ("X-Custom-Header", "keep-me"),
            ("X-Request-Id", "abc123"),
        ]);

        let cleaned = sanitize_forward_headers(&raw);

        // Every case-insensitive spelling of every sensitive header is gone.
        for stripped in [
            "Authorization",
            "authorization",
            "Proxy-Authorization",
            "Cookie",
            "SET-COOKIE",
            "WWW-Authenticate",
            "Proxy-Authenticate",
            "X-Auth-Token",
            "x-auth-user",
        ] {
            assert!(
                !cleaned.contains_key(stripped),
                "sensitive header {stripped:?} was forwarded verbatim; \
                 sanitize_forward_headers must strip it before outbound dispatch"
            );
        }

        // Legitimate headers survive.
        assert_eq!(cleaned.get("Content-Type").map(|s| s.as_str()), Some("application/json"));
        assert_eq!(cleaned.get("X-Custom-Header").map(|s| s.as_str()), Some("keep-me"));
        assert_eq!(cleaned.get("X-Request-Id").map(|s| s.as_str()), Some("abc123"));

        // The specific `root@example.com` credential the PoC forwards must
        // not survive as a value anywhere in the map.
        for (_, v) in cleaned.iter() {
            assert!(
                !v.starts_with("Basic cm9vdEBleGFtcGxlLmNvbTp"),
                "the root credential from the PoC survived sanitization: {v}"
            );
        }
    }

    #[test]
    fn is_sensitive_forward_header_is_case_insensitive() {
        for name in [
            "Authorization",
            "AUTHORIZATION",
            "authorization",
            "Cookie",
            "cookie",
            "SET-COOKIE",
            "X-Auth-Token",
            "x-AUTH-anything",
            "Proxy-Authorization",
            "www-authenticate",
        ] {
            assert!(
                is_sensitive_forward_header(name),
                "{name} must be classified sensitive"
            );
        }
        for name in ["Content-Type", "X-Custom-Header", "X-Request-Id", "Accept"] {
            assert!(
                !is_sensitive_forward_header(name),
                "{name} must NOT be classified sensitive"
            );
        }
    }

    // -----------------------------------------------------------------------
    // TC-F56CF2EE (and TC-31E5785D prong 2): the error propagated to the API
    // caller when the outbound webhook returns non-2xx must NOT include the
    // raw response body. Only the status code + a size summary is safe.
    // -----------------------------------------------------------------------
    #[test]
    fn format_upstream_error_omits_body() {
        // A distinctive marker string that only appears if the upstream body
        // leaks into the error. Mirrors the "Example Domain" / "iana.org"
        // markers the PoC uses against example.com.
        let leaked_body = "<html><title>Example Domain</title> \
            SECRET-TOKEN-abc123 iana.org</html>";
        let msg = format_upstream_error(
            reqwest::StatusCode::METHOD_NOT_ALLOWED,
            leaked_body,
        );

        // Status is included — reviewers can still diagnose the failure.
        assert!(
            msg.contains("405") || msg.contains("Method Not Allowed"),
            "error message must include the upstream status code, got: {msg}"
        );

        // The body must be suppressed. Assert none of its distinctive
        // substrings survive.
        for marker in [
            "Example Domain",
            "SECRET-TOKEN-abc123",
            "iana.org",
            "<html",
            "<title>",
        ] {
            assert!(
                !msg.contains(marker),
                "upstream response body marker {marker:?} leaked into error: {msg}"
            );
        }
    }
}

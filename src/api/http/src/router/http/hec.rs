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

//! Router-hop pieces for the Splunk HEC collector: the paths it will forward
//! and the Splunk-shaped error bodies a HEC client can parse.

use axum::{
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{router::extract_path_without_query, utils::json};

/// The Splunk-shaped 413 body, so an oversized batch reads as HEC rather than
/// as a transport error.
pub(super) fn splunk_payload_too_large() -> Response {
    splunk_status(StatusCode::PAYLOAD_TOO_LARGE, 6, "Request entity too large")
}

/// The Splunk-shaped "server is busy" body for a failed or unroutable proxy hop.
///
/// The upstream error is logged, never returned: it carries the backend node URL
/// and this route is unauthenticated.
pub(super) fn splunk_server_busy(status: StatusCode) -> Response {
    splunk_status(status, 9, "Server is busy")
}

fn splunk_status(status: StatusCode, code: u16, text: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        json::to_string(&json::json!({"text": text, "code": code})).unwrap_or_default(),
    )
        .into_response()
}

/// True for the Splunk HEC collector paths, which are never under `base_uri`.
///
/// An exact allowlist, NOT a prefix match: this is the one route whose forwarded
/// path skips the `base_uri` prefix, so anything accepted here is sent verbatim
/// to the backend. reqwest parses that path per WHATWG, which percent-DECODES a
/// segment before resolving it — `%2e%2e`, `%2E%2E`, `.%2e` and `%2e.` all mean
/// `..` there — so `/services/collector/%2e%2e/%2e%2e/api/default/_bulk`
/// collapses to `/api/default/_bulk` and escapes the mount on an unauthenticated
/// route. Rejecting the literal `..` alone does not catch any of those spellings.
pub fn is_splunk_collector_route(path: &str) -> bool {
    matches!(
        extract_path_without_query(path),
        "/services/collector" | "/services/collector/event" | "/services/collector/health"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_splunk_collector_route_detection() {
        assert!(is_splunk_collector_route("/services/collector"));
        assert!(is_splunk_collector_route("/services/collector/event"));
        assert!(is_splunk_collector_route("/services/collector/health"));
        assert!(is_splunk_collector_route("/services/collector?channel=x"));
        assert!(!is_splunk_collector_route("/services/collectorfoo"));
        assert!(!is_splunk_collector_route("/api/default/_hec"));
        assert!(!is_splunk_collector_route("/services"));
        // Nothing outside the three real paths is forwarded, because whatever is
        // accepted here reaches the backend verbatim without the base_uri prefix.
        assert!(!is_splunk_collector_route("/services/collector/raw"));
        assert!(!is_splunk_collector_route("/services/collector/event/x"));
    }

    #[test]
    fn a_percent_encoded_dot_segment_cannot_escape_the_collector_mount() {
        // reqwest parses the forwarded path per WHATWG, which DECODES a segment
        // before resolving it, so every spelling below means `..` to the backend
        // URL parser. Verified against the `url` crate: the first case resolves
        // to `/api/default/_bulk`, i.e. straight out of the mount on a route
        // that carries no authentication.
        for path in [
            "/services/collector/%2e%2e/%2e%2e/api/default/_bulk",
            "/services/collector/%2E%2E/api/default/_bulk",
            "/services/collector/.%2e/api/default/_bulk",
            "/services/collector/%2e./api/default/_bulk",
            "/services/collector/../../api/x/_bulk",
            "/services/collector/../x?a=b",
            "/services/collector/..%2f",
        ] {
            assert!(
                !is_splunk_collector_route(path),
                "must not forward {path} unchanged"
            );
        }
    }
}

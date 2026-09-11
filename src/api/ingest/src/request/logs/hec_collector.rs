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

//! The Splunk-compatible `/services/collector` endpoint.
//!
//! Response codes here are Splunk's, and deliberately distinct from the legacy
//! `/api/{org_id}/_hec` route's `HecStatus`, whose bodies must not change.

use axum::{
    Extension, Json,
    body::Bytes,
    extract::Request,
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use common::infra::config::SPLUNK_HEC_TOKENS;
use config::{DEFAULT_STREAM_NAME, metrics, utils::str::mask_secret};
use ingestion_common::IngestUser;
use serde::{Deserialize, Serialize};

use crate::service::{
    ingestion::get_thread_id,
    logs::hec::{HecParseError, parse_body},
};

/// Maximum decompressed body the collector will accept.
pub const HEC_MAX_BODY_BYTES: usize = 100 * 1024 * 1024;

/// The org and token row resolved by [`splunk_auth_middleware`].
#[derive(Clone, Debug)]
pub struct HecAuth {
    pub org_id: String,
    pub token_id: String,
}

/// Collector response statuses, each carrying its own HTTP status.
///
/// `code` must never double as an HTTP status selector here — that conflation is
/// what the legacy route does, and it is why these two types are separate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HecCollectorStatus {
    Success,
    TokenDisabled,
    TokenRequired,
    InvalidAuthorization,
    InvalidToken,
    NoData,
    InvalidDataFormat,
    IncorrectIndex,
    InternalError,
    ServerBusy,
    EventFieldRequired,
    EventFieldBlank,
    RequestEntityTooLarge,
}

/// The collector's JSON response body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HecCollectorResponse {
    pub text: String,
    pub code: u16,
}

impl HecCollectorStatus {
    /// The (HTTP status, Splunk code, Splunk text) triple for this status.
    pub fn parts(&self) -> (StatusCode, u16, &'static str) {
        match self {
            Self::Success => (StatusCode::OK, 0, "Success"),
            Self::TokenDisabled => (StatusCode::FORBIDDEN, 1, "Token disabled"),
            Self::TokenRequired => (StatusCode::UNAUTHORIZED, 2, "Token is required"),
            Self::InvalidAuthorization => (StatusCode::UNAUTHORIZED, 3, "Invalid authorization"),
            Self::InvalidToken => (StatusCode::FORBIDDEN, 4, "Invalid token"),
            Self::NoData => (StatusCode::BAD_REQUEST, 5, "No data"),
            Self::InvalidDataFormat => (StatusCode::BAD_REQUEST, 6, "Invalid data format"),
            Self::IncorrectIndex => (StatusCode::BAD_REQUEST, 7, "Incorrect index"),
            Self::InternalError => (
                StatusCode::INTERNAL_SERVER_ERROR,
                8,
                "Internal server error",
            ),
            Self::ServerBusy => (StatusCode::SERVICE_UNAVAILABLE, 9, "Server is busy"),
            Self::EventFieldRequired => (StatusCode::BAD_REQUEST, 12, "Event field is required"),
            Self::EventFieldBlank => (StatusCode::BAD_REQUEST, 13, "Event field cannot be blank"),
            Self::RequestEntityTooLarge => {
                (StatusCode::PAYLOAD_TOO_LARGE, 6, "Request entity too large")
            }
        }
    }

    /// Stable label for the `zo_hec_requests_total{status}` metric.
    fn metric_label(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::TokenDisabled => "token_disabled",
            Self::TokenRequired => "token_required",
            Self::InvalidAuthorization => "invalid_authorization",
            Self::InvalidToken => "invalid_token",
            Self::NoData => "no_data",
            Self::InvalidDataFormat => "invalid_data_format",
            Self::IncorrectIndex => "incorrect_index",
            Self::InternalError => "internal_error",
            Self::ServerBusy => "server_busy",
            Self::EventFieldRequired => "event_field_required",
            Self::EventFieldBlank => "event_field_blank",
            Self::RequestEntityTooLarge => "request_entity_too_large",
        }
    }
}

impl From<&HecParseError> for HecCollectorStatus {
    fn from(value: &HecParseError) -> Self {
        match value {
            HecParseError::NoData => Self::NoData,
            HecParseError::InvalidFormat(_) => Self::InvalidDataFormat,
            HecParseError::EventRequired => Self::EventFieldRequired,
            HecParseError::EventBlank => Self::EventFieldBlank,
            HecParseError::InvalidIndex => Self::IncorrectIndex,
        }
    }
}

impl IntoResponse for HecCollectorStatus {
    fn into_response(self) -> Response {
        let (status, code, text) = self.parts();
        (
            status,
            Json(HecCollectorResponse {
                text: text.to_string(),
                code,
            }),
        )
            .into_response()
    }
}

/// Authenticate a `Splunk <guid>` credential and attach the resolved org.
///
/// `Splunk` is parsed here and nowhere else: adding it to the shared validator
/// would let a collector GUID authenticate `/api/{other_org}/_bulk`.
pub async fn splunk_auth_middleware(mut req: Request, next: Next) -> Response {
    // A client-supplied user_id would otherwise be deserialized into UserEmail
    // by any handler downstream and billed to that user.
    req.headers_mut().remove("user_id");

    let real_ip = req
        .extensions()
        .get::<config::axum::middlewares::RealIp>()
        .map(|ip| ip.0.to_string())
        .unwrap_or_else(|| "-".to_string());

    let auth = match req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        Some(v) => v.trim().to_string(),
        None => {
            record_auth_failure("malformed", "", "", &real_ip, "missing Authorization");
            return HecCollectorStatus::TokenRequired.into_response();
        }
    };

    let Some(guid) = auth
        .strip_prefix("Splunk ")
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        record_auth_failure("malformed", "", &auth, &real_ip, "not a Splunk credential");
        return HecCollectorStatus::InvalidAuthorization.into_response();
    };

    let Some((org_id, token_id)) = lookup_token(guid).await else {
        // An unknown GUID and a well-formed non-GUID are indistinguishable to the
        // caller by design; only the log tells them apart.
        record_auth_failure("unknown", "", guid, &real_ip, "no such splunk token");
        return HecCollectorStatus::InvalidToken.into_response();
    };

    if db::org_status::is_blocked(&org_id) {
        // `/services/collector` is outside the /api tree, so the blocking
        // middleware never sees it — this is the only gate.
        record_auth_failure("disabled", &org_id, guid, &real_ip, "org is blocked");
        return HecCollectorStatus::TokenDisabled.into_response();
    }

    metrics::HEC_AUTH_TOTAL
        .with_label_values(&["success", &org_id])
        .inc();
    req.extensions_mut().insert(HecAuth { org_id, token_id });
    next.run(req).await
}

/// `POST /services/collector` and `/services/collector/event`.
pub async fn collector_event(
    Extension(auth): Extension<HecAuth>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let status = ingest_collector_body(&auth, &headers, body).await;
    metrics::HEC_REQUESTS_TOTAL
        .with_label_values(&[status.metric_label(), &auth.org_id])
        .inc();
    status.into_response()
}

/// `GET /services/collector/health` — unauthenticated liveness probe.
pub async fn collector_health() -> Response {
    (
        StatusCode::OK,
        Json(HecCollectorResponse {
            text: "HEC is healthy".to_string(),
            code: 17,
        }),
    )
        .into_response()
}

/// Any other method on a collector route.
pub async fn collector_method_not_allowed() -> Response {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        Json(HecCollectorResponse {
            text: "Method Not Allowed".to_string(),
            code: 6,
        }),
    )
        .into_response()
}

/// Resolve a GUID to its org and token row id, cache first.
async fn lookup_token(guid: &str) -> Option<(String, String)> {
    if let Some(entry) = SPLUNK_HEC_TOKENS.get(guid) {
        return Some(entry.value().clone());
    }
    // A cache miss is normal right after a token is minted on another node.
    match infra::table::org_ingestion_tokens::find_enabled_by_splunk_token(guid).await {
        Ok(Some(record)) if record.enabled => {
            let entry = (record.org_id.clone(), record.id.clone());
            SPLUNK_HEC_TOKENS.insert(guid.to_string(), entry.clone());
            Some(entry)
        }
        Ok(_) => None,
        Err(e) => {
            log::error!("[SPLUNK_HEC] splunk token lookup failed: {e}");
            None
        }
    }
}

/// Parse, validate and write one collector body.
async fn ingest_collector_body(
    auth: &HecAuth,
    headers: &HeaderMap,
    body: Bytes,
) -> HecCollectorStatus {
    if body.len() > HEC_MAX_BODY_BYTES {
        return HecCollectorStatus::RequestEntityTooLarge;
    }
    if !is_json_content_type(headers) {
        return HecCollectorStatus::InvalidDataFormat;
    }

    // Nothing is written until every group has parsed, so a rejected entry
    // cannot leave earlier streams committed.
    let parsed = match parse_body(&auth.org_id, &body, DEFAULT_STREAM_NAME).await {
        Ok(v) => v,
        Err(e) => return HecCollectorStatus::from(&e),
    };

    let user = IngestUser::User(format!("hec-{}@hec.local", auth.token_id));
    let responses =
        match crate::service::logs::hec::ingest_parsed(get_thread_id(), &auth.org_id, parsed, user)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("[SPLUNK_HEC] write failed for org {}: {e}", auth.org_id);
                return match e {
                    infra::errors::Error::ResourceError(_) => HecCollectorStatus::ServerBusy,
                    _ => HecCollectorStatus::InternalError,
                };
            }
        };

    for resp in &responses {
        if resp.code >= 500 {
            return HecCollectorStatus::InternalError;
        }
        if resp.status.iter().any(|s| s.status.failed > 0) {
            return HecCollectorStatus::InvalidDataFormat;
        }
    }
    HecCollectorStatus::Success
}

/// Splunk HEC bodies are JSON; an absent Content-Type is accepted for the many
/// senders that omit it.
fn is_json_content_type(headers: &HeaderMap) -> bool {
    match headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        None => true,
        Some(v) => {
            let v = v.to_ascii_lowercase();
            v.starts_with("application/json")
                || v.starts_with("text/plain")
                || v.starts_with("application/x-www-form-urlencoded")
        }
    }
}

/// Log and count one auth rejection, never printing the credential in full.
fn record_auth_failure(result: &str, org_id: &str, token: &str, real_ip: &str, reason: &str) {
    metrics::HEC_AUTH_TOTAL
        .with_label_values(&[result, org_id])
        .inc();
    log::warn!(
        "[SPLUNK_HEC] auth rejected: reason: {reason}, token: {}, org: {}, ip: {real_ip}",
        mask_secret(token),
        if org_id.is_empty() { "-" } else { org_id },
    );
}

#[cfg(test)]
mod tests {
    use config::utils::json;

    use super::*;

    #[test]
    fn test_status_triples_match_splunk() {
        for (status, expect) in [
            (
                HecCollectorStatus::Success,
                (StatusCode::OK, 0u16, "Success"),
            ),
            (
                HecCollectorStatus::TokenDisabled,
                (StatusCode::FORBIDDEN, 1, "Token disabled"),
            ),
            (
                HecCollectorStatus::TokenRequired,
                (StatusCode::UNAUTHORIZED, 2, "Token is required"),
            ),
            (
                HecCollectorStatus::InvalidAuthorization,
                (StatusCode::UNAUTHORIZED, 3, "Invalid authorization"),
            ),
            (
                HecCollectorStatus::InvalidToken,
                (StatusCode::FORBIDDEN, 4, "Invalid token"),
            ),
            (
                HecCollectorStatus::NoData,
                (StatusCode::BAD_REQUEST, 5, "No data"),
            ),
            (
                HecCollectorStatus::InvalidDataFormat,
                (StatusCode::BAD_REQUEST, 6, "Invalid data format"),
            ),
            (
                HecCollectorStatus::IncorrectIndex,
                (StatusCode::BAD_REQUEST, 7, "Incorrect index"),
            ),
            (
                HecCollectorStatus::InternalError,
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    8,
                    "Internal server error",
                ),
            ),
            (
                HecCollectorStatus::ServerBusy,
                (StatusCode::SERVICE_UNAVAILABLE, 9, "Server is busy"),
            ),
            (
                HecCollectorStatus::EventFieldRequired,
                (StatusCode::BAD_REQUEST, 12, "Event field is required"),
            ),
            (
                HecCollectorStatus::EventFieldBlank,
                (StatusCode::BAD_REQUEST, 13, "Event field cannot be blank"),
            ),
            (
                HecCollectorStatus::RequestEntityTooLarge,
                (StatusCode::PAYLOAD_TOO_LARGE, 6, "Request entity too large"),
            ),
        ] {
            assert_eq!(status.parts(), expect);
        }
    }

    #[test]
    fn test_unknown_token_and_invalid_token_are_indistinguishable() {
        // §12.6: an unknown GUID and a non-GUID must look identical to a caller.
        assert_eq!(
            HecCollectorStatus::InvalidToken.parts(),
            (StatusCode::FORBIDDEN, 4, "Invalid token")
        );
    }

    #[test]
    fn test_parse_error_maps_to_collector_status() {
        assert_eq!(
            HecCollectorStatus::from(&HecParseError::NoData),
            HecCollectorStatus::NoData
        );
        assert_eq!(
            HecCollectorStatus::from(&HecParseError::EventRequired),
            HecCollectorStatus::EventFieldRequired
        );
        assert_eq!(
            HecCollectorStatus::from(&HecParseError::EventBlank),
            HecCollectorStatus::EventFieldBlank
        );
        assert_eq!(
            HecCollectorStatus::from(&HecParseError::InvalidIndex),
            HecCollectorStatus::IncorrectIndex
        );
        assert_eq!(
            HecCollectorStatus::from(&HecParseError::InvalidFormat("x".to_string())),
            HecCollectorStatus::InvalidDataFormat
        );
    }

    #[test]
    fn test_content_type_gate() {
        let mut headers = HeaderMap::new();
        assert!(is_json_content_type(&headers));
        headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        assert!(is_json_content_type(&headers));
        headers.insert(
            header::CONTENT_TYPE,
            "application/json; charset=utf-8".parse().unwrap(),
        );
        assert!(is_json_content_type(&headers));
        headers.insert(header::CONTENT_TYPE, "application/xml".parse().unwrap());
        assert!(!is_json_content_type(&headers));
    }

    #[test]
    fn test_health_body_is_splunk_shaped() {
        let resp = HecCollectorResponse {
            text: "HEC is healthy".to_string(),
            code: 17,
        };
        let encoded = json::to_string(&resp).unwrap();
        assert!(encoded.contains("\"code\":17"));
        assert!(encoded.contains("HEC is healthy"));
    }

    #[test]
    fn test_metric_labels_are_distinct() {
        let all = [
            HecCollectorStatus::Success,
            HecCollectorStatus::TokenDisabled,
            HecCollectorStatus::TokenRequired,
            HecCollectorStatus::InvalidAuthorization,
            HecCollectorStatus::InvalidToken,
            HecCollectorStatus::NoData,
            HecCollectorStatus::InvalidDataFormat,
            HecCollectorStatus::IncorrectIndex,
            HecCollectorStatus::InternalError,
            HecCollectorStatus::ServerBusy,
            HecCollectorStatus::EventFieldRequired,
            HecCollectorStatus::EventFieldBlank,
            HecCollectorStatus::RequestEntityTooLarge,
        ];
        let mut labels: Vec<&str> = all.iter().map(|s| s.metric_label()).collect();
        labels.sort_unstable();
        let count = labels.len();
        labels.dedup();
        assert_eq!(labels.len(), count);
    }
}

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
    body::{Body, Bytes},
    extract::{Request, rejection::BytesRejection},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use common::infra::config::{ORG_INGESTION_TOKENS, SPLUNK_HEC_TOKENS};
use config::{DEFAULT_STREAM_NAME, meta::stream::StreamType, metrics, utils::str::mask_secret};
use db::org_ingestion_tokens::SPLUNK_HEC_TOKENS_LOADED;
use ingestion_common::IngestUser;
use serde::{Deserialize, Serialize};

use crate::service::{
    ingestion::{check_ingestion_allowed, get_thread_id},
    logs::hec::{HecParseError, parse_body, preflight_records, preflight_streams},
};

/// Maximum decompressed body the collector will accept.
pub const HEC_MAX_BODY_BYTES: usize = 100 * 1024 * 1024;
/// Maximum body on the wire, before any decompression can amplify it.
pub const HEC_MAX_WIRE_BYTES: usize = 10 * 1024 * 1024;

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
            // 413, not 400: the client's remedy is a smaller batch, not a fixed one.
            HecParseError::TooManyEvents => Self::RequestEntityTooLarge,
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

    let auth = match req.headers().get(header::AUTHORIZATION) {
        // A header that is not UTF-8 is present but unreadable: malformed (code
        // 3), not missing (code 2).
        Some(v) => match v.to_str() {
            Ok(v) => v.trim().to_string(),
            Err(_) => {
                return reject(
                    HecCollectorStatus::InvalidAuthorization,
                    "malformed",
                    "",
                    "",
                    &real_ip,
                    "Authorization is not valid UTF-8",
                );
            }
        },
        None => {
            return reject(
                HecCollectorStatus::TokenRequired,
                "malformed",
                "",
                "",
                &real_ip,
                "missing Authorization",
            );
        }
    };

    let Some(token) = splunk_scheme_token(&auth) else {
        return reject(
            HecCollectorStatus::InvalidAuthorization,
            "malformed",
            "",
            &auth,
            &real_ip,
            "not a Splunk credential",
        );
    };

    // A value that is not a canonical GUID is rejected before any cache or store
    // lookup, so a flood of random tokens cannot reach the database.
    let Some(guid) = canonical_guid(token) else {
        return reject(
            HecCollectorStatus::InvalidToken,
            "unknown",
            "",
            token,
            &real_ip,
            "not a canonical guid",
        );
    };
    let guid = guid.as_str();

    let (org_id, token_id, o2oi_token) = match lookup_token(guid) {
        TokenLookup::Found(org_id, token_id, o2oi_token) => (org_id, token_id, o2oi_token),
        TokenLookup::Disabled(org_id, token_id) => {
            return reject(
                HecCollectorStatus::TokenDisabled,
                "disabled",
                &org_id,
                guid,
                &real_ip,
                &format!("splunk token {token_id} disabled"),
            );
        }
        TokenLookup::Unknown => {
            // An unknown GUID and a well-formed non-GUID are indistinguishable to
            // the caller by design; only the log tells them apart.
            return reject(
                HecCollectorStatus::InvalidToken,
                "unknown",
                "",
                guid,
                &real_ip,
                "no such splunk token",
            );
        }
        TokenLookup::NotLoaded => {
            // Retryable: before the first load a miss is not authoritative, so a
            // valid GUID must not be turned into a 403.
            return reject(
                HecCollectorStatus::ServerBusy,
                "store_unavailable",
                "",
                guid,
                &real_ip,
                "splunk token cache not loaded yet",
            );
        }
    };

    // §6 step 2: the GUID converts to its `o2oi_` token, which is what actually
    // authorizes ingestion, and is validated through the existing org-scoped path.
    match validate_o2oi_token(&org_id, &o2oi_token).await {
        O2oiCheck::Valid => {}
        O2oiCheck::NotFound => {
            return reject(
                HecCollectorStatus::TokenDisabled,
                "disabled",
                &org_id,
                guid,
                &real_ip,
                &format!("o2oi token behind splunk token {token_id} is not enabled"),
            );
        }
        O2oiCheck::StoreError(e) => {
            // Retryable: the row may well be valid, so a store outage must not
            // read as a revoked credential.
            return reject(
                HecCollectorStatus::ServerBusy,
                "store_unavailable",
                &org_id,
                guid,
                &real_ip,
                &format!("token store unavailable for {token_id}: {e}"),
            );
        }
    }

    if db::org_status::is_blocked(&org_id) {
        // `/services/collector` is outside the /api tree, so the blocking
        // middleware never sees it — this is the only gate.
        return reject(
            HecCollectorStatus::TokenDisabled,
            "org_blocked",
            &org_id,
            guid,
            &real_ip,
            &format!("org is blocked, token {token_id}"),
        );
    }

    metrics::HEC_AUTH_TOTAL
        .with_label_values(&["success", &org_id])
        .inc();
    req.extensions_mut().insert(HecAuth { org_id, token_id });
    next.run(req).await
}

/// Cap the body on the wire, outside decompression, with the Splunk 413 triple.
///
/// `DefaultBodyLimit` sits inside the decompression layer so it bounds the
/// DECOMPRESSED body; a compressed bomb has to be stopped before that.
pub async fn wire_body_limit_middleware(req: Request, next: Next) -> Response {
    let (parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, HEC_MAX_WIRE_BYTES).await {
        Ok(b) => b,
        Err(_) => return count_and_respond(HecCollectorStatus::RequestEntityTooLarge, ""),
    };
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

/// `POST /services/collector` and `/services/collector/event`.
///
/// The body is taken as a `Result` so that `DefaultBodyLimit` — which rejects
/// INSIDE the `Bytes` extractor, i.e. before this body ever runs — is answered
/// with the Splunk 413 triple rather than the extractor's plain-text default.
pub async fn collector_event(
    Extension(auth): Extension<HecAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let status = match body {
        Ok(body) => ingest_collector_body(&auth, body).await,
        Err(e) => body_rejection_status(&e),
    };
    count_and_respond(status, &auth.org_id)
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

/// Split an `Authorization` value on its first ASCII whitespace run and return the
/// token when the scheme is `Splunk`, compared case-insensitively.
fn splunk_scheme_token(auth: &str) -> Option<&str> {
    let (scheme, rest) = auth.split_once([' ', '\t'])?;
    if !scheme.eq_ignore_ascii_case("Splunk") {
        return None;
    }
    let token = rest.trim_matches([' ', '\t']);
    // §5 rule 2 splits into exactly scheme and token: a third field is a
    // malformed credential (code 3), not a token that fails the GUID check.
    if token.is_empty() || token.contains([' ', '\t']) {
        return None;
    }
    Some(token)
}

/// Lowercase a canonical 8-4-4-4-12 hyphenated GUID, or reject anything else.
fn canonical_guid(token: &str) -> Option<String> {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let mut groups = token.split('-');
    for len in GROUPS {
        let g = groups.next()?;
        if g.len() != len || !g.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
    }
    groups.next().is_none().then(|| token.to_ascii_lowercase())
}

/// Outcome of re-validating the `o2oi_` token a GUID converts to (design §6).
enum O2oiCheck {
    Valid,
    NotFound,
    StoreError(String),
}

/// Outcome of resolving a GUID, kept distinct so each maps to its own Splunk code.
enum TokenLookup {
    Found(String, String, String),
    Disabled(String, String),
    Unknown,
    NotLoaded,
}

/// Resolve a GUID to its org and token row id, from memory only.
///
/// The map holds EVERY row that carries a GUID, enabled or not, and is repaired
/// by the 60s reload, so a miss is authoritative. Falling through to the store
/// here would let unauthenticated traffic generate database load at will —
/// random GUIDs never repeat, so every request would miss.
fn lookup_token(guid: &str) -> TokenLookup {
    resolve_guid(
        guid,
        SPLUNK_HEC_TOKENS_LOADED.load(std::sync::atomic::Ordering::Acquire),
    )
}

/// The lookup decision, with the load state passed in so it is testable.
fn resolve_guid(guid: &str, loaded: bool) -> TokenLookup {
    if let Some(entry) = SPLUNK_HEC_TOKENS.get(guid) {
        let entry = entry.value();
        return if entry.enabled {
            TokenLookup::Found(
                entry.org_id.clone(),
                entry.token_id.clone(),
                entry.o2oi_token.clone(),
            )
        } else {
            // A disabled token says so: code 4 would send an operator hunting for
            // a token they already hold.
            TokenLookup::Disabled(entry.org_id.clone(), entry.token_id.clone())
        };
    }
    if !loaded {
        return TokenLookup::NotLoaded;
    }
    TokenLookup::Unknown
}

/// Validate the `o2oi_` token behind a GUID through the existing org-scoped path.
///
/// In-memory first: `ORG_INGESTION_TOKENS` holds only enabled tokens, so a hit
/// is the whole answer. The store is consulted ONLY on a miss there, which is
/// what the Basic-auth `o2oi_` path already does — §6.2's "a miss never reaches
/// the database" is about the GUID map, whose miss is already answered with code
/// 4 above, so only a holder of a live GUID can get this far.
async fn validate_o2oi_token(org_id: &str, o2oi_token: &str) -> O2oiCheck {
    if ORG_INGESTION_TOKENS.contains_key(&format!("{org_id}/{o2oi_token}")) {
        return O2oiCheck::Valid;
    }
    match db::org_ingestion_tokens::find_enabled_token(org_id, o2oi_token).await {
        Ok(Some(record)) => {
            ORG_INGESTION_TOKENS.insert(format!("{org_id}/{o2oi_token}"), record.name);
            O2oiCheck::Valid
        }
        Ok(None) => O2oiCheck::NotFound,
        Err(e) => O2oiCheck::StoreError(e.to_string()),
    }
}

/// Map a `Bytes` extractor rejection onto a Splunk status.
///
/// `DefaultBodyLimit` caps the DECOMPRESSED body and fails inside the extractor,
/// so this is the only place the 100 MiB limit can be answered with the triple.
fn body_rejection_status(rejection: &BytesRejection) -> HecCollectorStatus {
    // Matched on the status the rejection itself declares: the length-limit case
    // is a nested variant of a macro-generated composite, so the shape is not a
    // stable thing to pattern-match on across axum versions.
    match rejection.status() {
        StatusCode::PAYLOAD_TOO_LARGE => HecCollectorStatus::RequestEntityTooLarge,
        _ => HecCollectorStatus::InvalidDataFormat,
    }
}

/// Parse, validate and write one collector body.
///
/// Content-Type is deliberately not gated: HEC senders use `application/json`,
/// `text/plain`, `application/x-ndjson` and nothing at all interchangeably, and
/// the parser is what decides whether a body is usable.
async fn ingest_collector_body(auth: &HecAuth, body: Bytes) -> HecCollectorStatus {
    if body.len() > HEC_MAX_BODY_BYTES {
        return HecCollectorStatus::RequestEntityTooLarge;
    }

    // §9.2: gate the ORG before parsing. `preflight_streams` runs the same check
    // per stream, but only after the body is parsed and only when the body
    // yielded at least one group — so a cloud org past its trial, or one over
    // quota, would otherwise do the parse work first.
    if let Err(e) = check_ingestion_allowed(&auth.org_id, StreamType::Logs, None).await {
        log::warn!("[SPLUNK_HEC] rejected for org {}: {e}", auth.org_id);
        return admission_status(&e);
    }

    // Nothing is written until every group has parsed, so a rejected entry
    // cannot leave earlier streams committed.
    let parsed = match parse_body(&auth.org_id, &body, DEFAULT_STREAM_NAME).await {
        Ok(v) => v,
        Err(e) => return HecCollectorStatus::from(&e),
    };

    let user = IngestUser::User(format!("hec-{}@hec.local", auth.token_id));
    let streams: Vec<_> = parsed.streams.into_iter().collect();
    // Admission checks for EVERY group run here, before the first write, so a
    // rejection is reported with nothing persisted rather than as a 500 after a
    // partial commit.
    if let Err(e) = preflight_streams(&auth.org_id, &streams, &user).await {
        log::warn!(
            "[SPLUNK_HEC] rejected before write for org {}: {e}",
            auth.org_id
        );
        return admission_status(&e);
    }

    // §10.4: every EVENT of every group is prepared here too, so an event that
    // group 2 cannot flatten is reported before group 1 is committed rather
    // than after — which a retrying client would otherwise duplicate.
    let streams = match preflight_records(&auth.org_id, streams).await {
        Ok(prepared) => prepared,
        Err(e) => {
            log::warn!(
                "[SPLUNK_HEC] unpreparable event for org {}: {e:?}",
                auth.org_id
            );
            return HecCollectorStatus::from(&e);
        }
    };

    let responses = match crate::service::logs::hec::ingest_prepared(
        get_thread_id(),
        &auth.org_id,
        streams,
        user,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            // Reached only after preflight passed, i.e. a genuine storage failure;
            // earlier streams in the batch may already be committed.
            log::error!("[SPLUNK_HEC] write failed for org {}: {e}", auth.org_id);
            return match e {
                infra::errors::Error::ResourceError(_) => HecCollectorStatus::ServerBusy,
                _ => HecCollectorStatus::InternalError,
            };
        }
    };

    write_outcome(&responses)
}

/// The collector status for a completed batch's per-stream outcomes.
fn write_outcome(responses: &[ingestion_common::IngestionResponse]) -> HecCollectorStatus {
    for resp in responses {
        // `code` is 200 even on a storage failure, because it is a serialized
        // body field the legacy routes depend on; the real signal is this flag.
        if resp.write_failed {
            return HecCollectorStatus::InternalError;
        }
        // §11.1: a stream that started deleting after admission is skipped and
        // its records are gone. Retryable (code 8): a retry meets code 7 at
        // admission once the deletion is visible there.
        if resp.stream_skipped {
            return HecCollectorStatus::InternalError;
        }
        // §11.1: events outside ZO_INGEST_ALLOWED_UPTO / _IN_FUTURE are dropped
        // BY POLICY on every route. Failing the batch would make the client
        // discard its in-window events too, since a 400 is not retried.
        if resp
            .status
            .iter()
            .any(|s| s.status.failed > s.status.policy_dropped)
        {
            return HecCollectorStatus::InvalidDataFormat;
        }
    }
    HecCollectorStatus::Success
}

/// Which Splunk status an admission failure maps to.
///
/// §10.2 splits these: quota, circuit breakers and a store outage are retryable
/// (503/code 9), so a client must not be told its index is wrong and give up.
fn admission_status(e: &infra::errors::Error) -> HecCollectorStatus {
    match e {
        infra::errors::Error::ResourceError(_) => HecCollectorStatus::ServerBusy,
        // Not an ingester, and a cloud trial that has run out, are both conditions
        // of the receiving side rather than of the batch.
        infra::errors::Error::TrialPeriodExpired => HecCollectorStatus::ServerBusy,
        infra::errors::Error::IngestionError(msg) if is_retryable_admission(msg) => {
            HecCollectorStatus::ServerBusy
        }
        _ => HecCollectorStatus::IncorrectIndex,
    }
}

/// True for the `IngestionError` texts that describe a node or quota condition.
///
/// `check_ingestion_allowed` flattens these into one stringly-typed variant, so
/// the message is the only thing separating "retry later" from "your index is
/// wrong"; matched on the literals it builds.
fn is_retryable_admission(msg: &str) -> bool {
    msg == "not an ingester" || msg.starts_with("Quota exceeded for this organization")
}

/// Count one collector outcome and render its Splunk body.
fn count_and_respond(status: HecCollectorStatus, org_id: &str) -> Response {
    metrics::HEC_REQUESTS_TOTAL
        .with_label_values(&[status.metric_label(), org_id])
        .inc();
    status.into_response()
}

/// Log, count and render one auth rejection.
///
/// Every middleware rejection goes through here so codes 1-4 and 9 appear in
/// `zo_hec_requests_total` alongside the outcomes the handler counts.
fn reject(
    status: HecCollectorStatus,
    result: &str,
    org_id: &str,
    token: &str,
    real_ip: &str,
    reason: &str,
) -> Response {
    record_auth_failure(result, org_id, token, real_ip, reason);
    count_and_respond(status, org_id)
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
    use ingestion_common::IngestionResponse;

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

    const GUID: &str = "ebbd9fe6-f83e-487d-801f-de5152013c3c";

    #[test]
    fn scheme_is_case_insensitive() {
        for auth in [
            format!("Splunk {GUID}"),
            format!("splunk {GUID}"),
            format!("SPLUNK {GUID}"),
        ] {
            assert_eq!(splunk_scheme_token(&auth), Some(GUID), "{auth}");
        }
    }

    #[test]
    fn scheme_splits_on_a_whitespace_run() {
        for auth in [
            format!("Splunk\t{GUID}"),
            format!("Splunk  {GUID}"),
            format!("Splunk \t {GUID}"),
        ] {
            assert_eq!(splunk_scheme_token(&auth), Some(GUID), "{auth:?}");
        }
    }

    #[test]
    fn other_schemes_and_empty_tokens_are_rejected() {
        assert_eq!(splunk_scheme_token(&format!("Bearer {GUID}")), None);
        assert_eq!(splunk_scheme_token(&format!("Basic {GUID}")), None);
        assert_eq!(splunk_scheme_token("Splunk"), None);
        assert_eq!(splunk_scheme_token("Splunk   "), None);
        assert_eq!(splunk_scheme_token(GUID), None);
    }

    #[test]
    fn a_third_field_is_malformed_not_an_invalid_token() {
        // Code 3 (malformed credential), not code 4 (bad token value): the
        // header does not parse as scheme + token at all.
        assert_eq!(splunk_scheme_token(&format!("Splunk {GUID} extra")), None);
        assert_eq!(splunk_scheme_token(&format!("Splunk {GUID}\textra")), None);
    }

    #[test]
    fn uppercase_guid_normalizes_to_lowercase() {
        assert_eq!(
            canonical_guid(&GUID.to_ascii_uppercase()).as_deref(),
            Some(GUID)
        );
        assert_eq!(canonical_guid(GUID).as_deref(), Some(GUID));
    }

    #[test]
    fn a_miss_is_authoritative_once_the_cache_is_loaded() {
        // §6.2: the map holds every GUID row, so a miss means "no such GUID".
        // Falling through to the store would let unauthenticated traffic drive
        // database load — random GUIDs never repeat, so every request misses.
        assert!(matches!(
            resolve_guid("00000000-0000-4000-8000-000000000000", true),
            TokenLookup::Unknown
        ));
    }

    #[tokio::test]
    async fn the_o2oi_token_behind_a_guid_is_validated_from_memory() {
        // §6 step 2: the GUID converts to its `o2oi_` token, which is what
        // actually authorizes ingestion. A hit in ORG_INGESTION_TOKENS is the
        // whole answer — that map holds only ENABLED tokens — so this must not
        // reach the store, which no unit test has.
        const O2OI: &str = "o2oi_step2token";
        ORG_INGESTION_TOKENS.insert(format!("orgstep2/{O2OI}"), "step2".to_string());
        assert!(matches!(
            validate_o2oi_token("orgstep2", O2OI).await,
            O2oiCheck::Valid
        ));
        ORG_INGESTION_TOKENS.remove(&format!("orgstep2/{O2OI}"));
    }

    #[test]
    fn a_found_guid_carries_the_o2oi_token_it_converts_to() {
        SPLUNK_HEC_TOKENS.insert(
            GUID.to_string(),
            infra::table::org_ingestion_tokens::SplunkHecTokenEntry {
                org_id: "org-c".to_string(),
                token_id: "tok-c".to_string(),
                o2oi_token: "o2oi_cvalue".to_string(),
                enabled: true,
            },
        );
        match resolve_guid(GUID, true) {
            TokenLookup::Found(org_id, token_id, o2oi_token) => {
                assert_eq!(org_id, "org-c");
                assert_eq!(token_id, "tok-c");
                // Without this the re-validation stage has nothing to validate.
                assert_eq!(o2oi_token, "o2oi_cvalue");
            }
            _ => panic!("an enabled row must resolve"),
        }
        SPLUNK_HEC_TOKENS.remove(GUID);
    }

    #[test]
    fn a_disabled_token_answers_from_memory() {
        SPLUNK_HEC_TOKENS.insert(
            GUID.to_string(),
            infra::table::org_ingestion_tokens::SplunkHecTokenEntry {
                org_id: "org-a".to_string(),
                token_id: "tok-a".to_string(),
                o2oi_token: "o2oi_avalue".to_string(),
                enabled: false,
            },
        );
        match resolve_guid(GUID, true) {
            TokenLookup::Disabled(org_id, token_id) => {
                assert_eq!(org_id, "org-a");
                // §12.6 wants the token id on the log line for this path.
                assert_eq!(token_id, "tok-a");
            }
            _ => panic!("a disabled row must answer code 1 from the cache"),
        }
        SPLUNK_HEC_TOKENS.remove(GUID);
    }

    #[test]
    fn a_miss_before_the_first_load_is_retryable_not_a_403() {
        // A cold node must never turn a valid GUID into an authoritative 403.
        assert!(matches!(
            resolve_guid("11111111-1111-4111-8111-111111111111", false),
            TokenLookup::NotLoaded
        ));
    }

    fn response(successful: u32, failed: u32, policy_dropped: u32) -> IngestionResponse {
        let mut status = ingestion_common::StreamStatus::new("s");
        status.status.successful = successful;
        status.status.failed = failed;
        status.status.policy_dropped = policy_dropped;
        IngestionResponse::new(200, vec![status])
    }

    #[test]
    fn events_dropped_by_the_ingestion_window_still_return_code_0() {
        // §11.1: the window drops by design. Failing the batch would make the
        // client discard its in-window events too, since a 400 is not retried.
        assert_eq!(
            write_outcome(&[response(9, 1, 1)]),
            HecCollectorStatus::Success
        );
    }

    #[test]
    fn a_stream_skipped_mid_write_is_code_8_not_code_0() {
        // §11.1's "most serious item": the write loop skips a stream that started
        // deleting after admission, so acknowledging 200 would tell the client
        // data it never stored was safe.
        let skipped = response(0, 0, 0).with_stream_skipped(true);
        assert_eq!(write_outcome(&[skipped]), HecCollectorStatus::InternalError);

        // A skip in ANY group fails the batch, not just the first.
        let skipped = response(0, 0, 0).with_stream_skipped(true);
        assert_eq!(
            write_outcome(&[response(5, 0, 0), skipped]),
            HecCollectorStatus::InternalError
        );

        // And a clean batch still succeeds.
        assert_eq!(
            write_outcome(&[response(5, 0, 0)]),
            HecCollectorStatus::Success
        );
    }

    #[test]
    fn a_genuine_preparation_failure_is_still_code_6() {
        assert_eq!(
            write_outcome(&[response(9, 1, 0)]),
            HecCollectorStatus::InvalidDataFormat
        );
        // One window drop and one real failure: the real one still decides.
        assert_eq!(
            write_outcome(&[response(8, 2, 1)]),
            HecCollectorStatus::InvalidDataFormat
        );
    }

    #[test]
    fn a_write_failure_is_code_8_even_though_code_is_200() {
        // The shared path returns 200 so the legacy routes' bodies do not change;
        // acknowledging lost data here is exactly the bug §11.1 names.
        let failed = response(10, 0, 0).with_write_failed(true);
        assert_eq!(failed.code, 200);
        assert_eq!(write_outcome(&[failed]), HecCollectorStatus::InternalError);
    }

    #[test]
    fn retryable_admission_failures_are_503_not_a_bad_index() {
        // §10.2: telling a client its index is wrong makes it drop the batch;
        // these conditions are the receiver's, and a retry will succeed.
        for e in [
            infra::errors::Error::ResourceError("memtable full".to_string()),
            infra::errors::Error::TrialPeriodExpired,
            infra::errors::Error::IngestionError("not an ingester".to_string()),
            infra::errors::Error::IngestionError(
                "Quota exceeded for this organization [acme]".to_string(),
            ),
        ] {
            assert_eq!(
                admission_status(&e),
                HecCollectorStatus::ServerBusy,
                "{e:?}"
            );
        }
    }

    #[test]
    fn a_genuine_stream_rejection_stays_code_7() {
        for e in [
            infra::errors::Error::IngestionError("Stream name is empty".to_string()),
            infra::errors::Error::IngestionError("stream [foo] is being deleted".to_string()),
        ] {
            assert_eq!(
                admission_status(&e),
                HecCollectorStatus::IncorrectIndex,
                "{e:?}"
            );
        }
    }

    #[test]
    fn non_canonical_values_are_rejected_before_lookup() {
        for bad in [
            "o2oi_5f8J6dUdH0oPjVgJSwV15z4dFwsxQqOh",
            "not-a-guid-at-all",
            "ebbd9fe6f83e487d801fde5152013c3c",
            "ebbd9fe6-f83e-487d-801f-de5152013c3",
            "ebbd9fe6-f83e-487d-801f-de5152013c3c-extra",
            "ebbd9fe6-f83e-487d-801f-gggggggggggg",
            "",
        ] {
            assert!(canonical_guid(bad).is_none(), "{bad}");
        }
    }
}

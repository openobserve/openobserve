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

//! The Datadog Agent intake under `/datadog/{org_id}`: auth, body caps and status mapping.

use std::collections::HashMap;

use axum::{
    Extension, Json,
    body::{Body, Bytes, HttpBody},
    extract::{MatchedPath, Path, Request, rejection::BytesRejection},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use common::meta::otlp::OtlpExportResponse;
use config::{
    DEFAULT_STREAM_NAME,
    meta::otlp::OtlpRequestType,
    metrics,
    utils::{json, str::mask_secret},
};
use http_body_util::{LengthLimitError, Limited};
use ingestion_common::{
    IngestUser, IngestionRequest, IngestionResponse, IngestionValueType, StreamStatus,
};
use openobserve_core::datadog::{self, DatadogError};
use opentelemetry_proto::tonic::collector::{
    metrics::v1::{ExportMetricsServiceRequest, ExportMetricsServiceResponse},
    trace::v1::ExportTraceServiceResponse,
};

use crate::{
    request::logs::hec_collector::{O2oiCheck, is_retryable_admission, validate_o2oi_token},
    service::{ingestion::get_thread_id, logs, metrics::otlp as otlp_metrics, traces},
};

/// Largest body accepted per request, both as sent and after decompression.
pub const DATADOG_MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// The key-validation route, the only one that may carry the key in its query.
pub const VALIDATE_ROUTE: &str = "/{org_id}/api/v1/validate";

const API_KEY_HEADER: &str = "dd-api-key";
const API_KEY_QUERY: &str = "api_key";
const TOKEN_PREFIX: &str = "o2oi_";

/// The org and ingestion token resolved by [`datadog_auth_middleware`].
#[derive(Clone, Debug)]
pub struct DatadogAuth {
    pub org_id: String,
    pub token_name: String,
}

impl DatadogAuth {
    fn user(&self) -> IngestUser {
        IngestUser::User(format!("dd-{}@datadog.local", self.token_name))
    }
}

/// Parsed here and nowhere else, so `DD-API-KEY` cannot authenticate any other route.
pub async fn datadog_auth_middleware(
    Path(params): Path<HashMap<String, String>>,
    mut req: Request,
    next: Next,
) -> Response {
    // A client-supplied user_id would otherwise be read downstream as the ingesting user.
    req.headers_mut().remove("user_id");
    let Some(org_id) = params.get("org_id").cloned() else {
        return forbidden();
    };
    let is_validate = req
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|m| m.as_str().ends_with(VALIDATE_ROUTE));
    let query = req.uri().query().filter(|_| is_validate);
    let Some(key) = api_key(req.headers(), query) else {
        log::warn!("[DATADOG] auth rejected: missing API key, org: {org_id}");
        return forbidden();
    };
    // Only `o2oi_` keys reach the token store; a cache miss queries it like basic auth does.
    if !key.starts_with(TOKEN_PREFIX) {
        log::warn!(
            "[DATADOG] auth rejected: not an ingestion token, key: {}, org: {org_id}",
            mask_secret(&key)
        );
        return forbidden();
    }
    match validate_o2oi_token(&org_id, &key).await {
        O2oiCheck::Valid(token_name) => {
            req.extensions_mut()
                .insert(DatadogAuth { org_id, token_name });
            next.run(req).await
        }
        O2oiCheck::NotFound => {
            log::warn!(
                "[DATADOG] auth rejected: unknown or disabled token, key: {}, org: {org_id}",
                mask_secret(&key)
            );
            forbidden()
        }
        O2oiCheck::StoreError(e) => {
            // Retryable: a store outage must not read as a revoked key.
            log::error!("[DATADOG] token store unavailable, org: {org_id}: {e}");
            reply(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// Cap the body as sent, before decompression can amplify it, without buffering it.
pub async fn datadog_wire_limit_middleware(req: Request, next: Next) -> Response {
    let (parts, body) = req.into_parts();
    if body.size_hint().lower() > DATADOG_MAX_BODY_BYTES as u64 {
        return reply(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let body = Body::new(Limited::new(body, DATADOG_MAX_BODY_BYTES));
    next.run(Request::from_parts(parts, body)).await
}

/// Reaching this handler means the auth layer accepted the key.
pub async fn validate() -> Response {
    Json(json::json!({ "valid": true })).into_response()
}

pub async fn series(
    Extension(auth): Extension<DatadogAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    ingest_metrics(&auth, body, datadog::series_to_otlp).await
}

pub async fn sketches(
    Extension(auth): Extension<DatadogAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    ingest_metrics(&auth, body, datadog::sketches_to_otlp).await
}

pub async fn check_run(
    Extension(auth): Extension<DatadogAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    ingest_metrics(&auth, body, datadog::check_runs_to_otlp).await
}

pub async fn traces(
    Extension(auth): Extension<DatadogAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(e) => return body_rejection(&e),
    };
    let request = match datadog::agent_payload_to_otlp(&body) {
        Ok(request) => request,
        Err(e) => return decode_error(&auth.org_id, "traces", &e),
    };
    match traces::handle_otlp_request(
        &auth.org_id,
        request,
        OtlpRequestType::HttpProtobuf,
        None,
        auth.user(),
    )
    .await
    {
        Ok(resp) => {
            accepted::<ExportTraceServiceResponse>(resp, StatusCode::OK, &auth.org_id).await
        }
        Err(e) => {
            log::error!("[DATADOG] traces failed for org {}: {e}", auth.org_id);
            // The trace-agent drops a payload answered 400 but retries a 500.
            reply(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn logs(
    Extension(auth): Extension<DatadogAuth>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(e) => return body_rejection(&e),
    };
    let records = match datadog::logs_to_records(&body) {
        Ok(records) => records,
        Err(e) => return decode_error(&auth.org_id, "logs", &e),
    };
    // The Agent's connectivity probe sends `{}`.
    if records.is_empty() {
        return reply(StatusCode::OK);
    }
    let result = logs::ingest::ingest(
        get_thread_id(),
        &auth.org_id,
        DEFAULT_STREAM_NAME,
        IngestionRequest::JsonValues(IngestionValueType::Bulk, records),
        auth.user(),
        None,
        false,
    )
    .await;
    match result {
        Ok(resp) => {
            log_logs_outcome(&auth.org_id, &resp);
            reply(logs_status(&resp))
        }
        Err(e) => {
            log::warn!("[DATADOG] logs rejected for org {}: {e}", auth.org_id);
            reply(logs_error_status(&e))
        }
    }
}

/// Any other path under the org: answered 2xx, because the Agent retries a 404 forever.
pub async fn unsupported(Extension(auth): Extension<DatadogAuth>) -> Response {
    metrics::DATADOG_DROPPED_REQUESTS_TOTAL
        .with_label_values(&[&auth.org_id])
        .inc();
    reply(StatusCode::ACCEPTED)
}

/// The key from `DD-API-KEY`, else from the `api_key` query parameter when one is allowed.
fn api_key(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    let from_header = headers
        .get(API_KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let from_query = || {
        query?
            .split('&')
            .find_map(|pair| pair.strip_prefix(API_KEY_QUERY)?.strip_prefix('='))
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    from_header.or_else(from_query).map(str::to_string)
}

async fn ingest_metrics(
    auth: &DatadogAuth,
    body: Result<Bytes, BytesRejection>,
    translate: fn(&[u8]) -> Result<ExportMetricsServiceRequest, DatadogError>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(e) => return body_rejection(&e),
    };
    // `agent diagnose` posts `{}` here and reports anything but 2xx as a failure.
    if body.as_ref() == b"{}" {
        return reply(StatusCode::ACCEPTED);
    }
    let request = match translate(&body) {
        Ok(request) => request,
        Err(e) => return decode_error(&auth.org_id, "metrics", &e),
    };
    match otlp_metrics::handle_otlp_request(
        &auth.org_id,
        request,
        OtlpRequestType::HttpProtobuf,
        auth.user(),
    )
    .await
    {
        Ok(resp) => {
            accepted::<ExportMetricsServiceResponse>(resp, StatusCode::ACCEPTED, &auth.org_id).await
        }
        Err(e) => {
            log::error!("[DATADOG] metrics failed for org {}: {e}", auth.org_id);
            otlp_metrics::write_failure_response(OtlpRequestType::HttpProtobuf, &e)
        }
    }
}

/// Answers an OTLP success with `success` after logging rejected points; errors pass through.
async fn accepted<T: OtlpExportResponse + Default>(
    resp: Response,
    success: StatusCode,
    org_id: &str,
) -> Response {
    if resp.status() != StatusCode::OK {
        return resp;
    }
    let body = match axum::body::to_bytes(resp.into_body(), usize::MAX).await {
        Ok(body) => body,
        Err(e) => {
            log::error!("[DATADOG] unreadable ingest response for org {org_id}: {e}");
            Bytes::new()
        }
    };
    match T::decode(body) {
        Ok(res) => {
            if let Some((rejected, error)) = res.partial_success().filter(|(n, _)| *n > 0) {
                log::warn!(
                    "[DATADOG] org {org_id}: {rejected} {} rejected: {error}",
                    T::REJECTED_FIELD
                );
            }
        }
        Err(e) => log::error!("[DATADOG] undecodable ingest response for org {org_id}: {e}"),
    }
    reply(success)
}

/// Mirrors the HEC collector's `write_outcome`; `code` is 200 even when storage failed.
fn logs_status(resp: &IngestionResponse) -> StatusCode {
    // A skipped stream lost its records; a retry meets the deletion at admission.
    if resp.write_failed || resp.stream_skipped {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    // Policy drops (outside the allowed time window) must not fail the in-window records.
    if resp
        .status
        .iter()
        .any(|s| s.status.failed > s.status.policy_dropped || failed_items(s) > 0)
    {
        return StatusCode::BAD_REQUEST;
    }
    StatusCode::OK
}

fn log_logs_outcome(org_id: &str, resp: &IngestionResponse) {
    if resp.write_failed {
        log::error!("[DATADOG] logs write failed for org {org_id}");
    }
    if resp.stream_skipped {
        log::warn!("[DATADOG] logs stream skipped for org {org_id}, records dropped");
    }
    for s in resp.status.iter().filter(|s| s.status.failed > 0) {
        log::warn!(
            "[DATADOG] org {org_id}: {} log records failed in stream {} ({} by policy): {}",
            s.status.failed,
            s.name,
            s.status.policy_dropped,
            s.status.error
        );
    }
    for s in &resp.status {
        let failed = failed_items(s);
        if failed > 0 {
            log::warn!(
                "[DATADOG] org {org_id}: {failed} log records failed to write in stream {}",
                s.name
            );
        }
    }
}

/// Bulk ingestion reports write-time record failures as items, not in `status.failed`.
fn failed_items(s: &StreamStatus) -> usize {
    s.items
        .iter()
        .filter(|item| item.values().any(|res| res.error.is_some()))
        .count()
}

fn logs_error_status(e: &infra::errors::Error) -> StatusCode {
    use infra::errors::{Error, IngestionError};

    match e {
        Error::ResourceError(_) => StatusCode::SERVICE_UNAVAILABLE,
        Error::TrialPeriodExpired => StatusCode::TOO_MANY_REQUESTS,
        Error::Ingestion(IngestionError::OrgBlocked(_)) => StatusCode::FORBIDDEN,
        Error::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
        Error::IngestionError(msg) if is_retryable_admission(msg) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        Error::IngestionError(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// `DefaultBodyLimit` rejects inside the extractor, so the decoded cap surfaces here.
fn body_rejection(rejection: &BytesRejection) -> Response {
    // Decompression hides the wire cap's error from axum's own 413 detection.
    let over_wire_cap =
        std::iter::successors(Some(rejection as &(dyn std::error::Error + 'static)), |e| {
            e.source()
        })
        .any(|e| e.is::<LengthLimitError>());
    if over_wire_cap || rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        reply(StatusCode::PAYLOAD_TOO_LARGE)
    } else {
        reply(StatusCode::BAD_REQUEST)
    }
}

fn decode_error(org_id: &str, signal: &str, e: &DatadogError) -> Response {
    log::warn!("[DATADOG] undecodable {signal} payload for org {org_id}: {e}");
    (
        StatusCode::BAD_REQUEST,
        Json(json::json!({ "errors": [e.to_string()] })),
    )
        .into_response()
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json::json!({ "errors": ["Forbidden"] })),
    )
        .into_response()
}

fn reply(status: StatusCode) -> Response {
    (status, Json(json::json!({}))).into_response()
}

#[cfg(test)]
mod tests {
    use axum::{
        Router, middleware,
        routing::{get, post},
    };
    use common::infra::config::ORG_INGESTION_TOKENS;
    use ingestion_common::BulkResponse;
    use tower::ServiceExt;

    use super::*;

    async fn whoami(Extension(auth): Extension<DatadogAuth>, headers: HeaderMap) -> String {
        format!(
            "{}|{}|{}",
            auth.org_id,
            auth.user().to_email(),
            headers.contains_key("user_id")
        )
    }

    fn app() -> Router {
        Router::new()
            .route(VALIDATE_ROUTE, get(whoami))
            .route("/{org_id}/api/v2/series", post(whoami))
            .route_layer(middleware::from_fn(datadog_auth_middleware))
    }

    async fn call(method: &str, uri: &str, key: Option<&str>) -> (StatusCode, String) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header("user_id", "root@example.com");
        if let Some(key) = key {
            req = req.header("DD-API-KEY", key);
        }
        let resp = app()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn a_cached_token_authenticates_as_its_synthetic_user_and_strips_user_id() {
        ORG_INGESTION_TOKENS.insert("ddorg1/o2oi_ddvalid1".to_string(), "agents".to_string());
        let (status, body) = call("POST", "/ddorg1/api/v2/series", Some("  o2oi_ddvalid1 ")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "ddorg1|dd-agents@datadog.local|false");
    }

    #[tokio::test]
    async fn a_key_that_is_not_an_ingestion_token_is_403() {
        for key in ["0123456789abcdef0123456789abcdef", "O2OI_upper", "o2oi"] {
            let (status, body) = call("POST", "/ddorg2/api/v2/series", Some(key)).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{key}");
            assert_eq!(body, r#"{"errors":["Forbidden"]}"#);
        }
    }

    #[tokio::test]
    async fn a_missing_key_is_403() {
        let (status, _) = call("POST", "/ddorg3/api/v2/series", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call("POST", "/ddorg3/api/v2/series", Some("   ")).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn the_agent_connectivity_probe_on_series_is_accepted() {
        let auth = DatadogAuth {
            org_id: "ddorg5".to_string(),
            token_name: "t".to_string(),
        };
        let resp = series(Extension(auth), Ok(Bytes::from_static(b"{}"))).await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn the_query_key_counts_on_validate_only() {
        ORG_INGESTION_TOKENS.insert("ddorg4/o2oi_ddvalid4".to_string(), "v".to_string());
        let (status, _) = call("GET", "/ddorg4/api/v1/validate?api_key=o2oi_ddvalid4", None).await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = call("POST", "/ddorg4/api/v2/series?api_key=o2oi_ddvalid4", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn the_header_wins_over_the_query_and_only_an_exact_query_name_counts() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            api_key(&headers, Some("api_key=o2oi_q")).as_deref(),
            Some("o2oi_q")
        );
        assert_eq!(
            api_key(&headers, Some("a=1&api_key=o2oi_q")).as_deref(),
            Some("o2oi_q")
        );
        assert_eq!(api_key(&headers, Some("xapi_key=o2oi_q")), None);
        assert_eq!(api_key(&headers, Some("api_keys=o2oi_q")), None);
        assert_eq!(api_key(&headers, Some("api_key=")), None);
        assert_eq!(api_key(&headers, None), None);
        headers.insert("dd-api-key", "o2oi_h".parse().unwrap());
        assert_eq!(
            api_key(&headers, Some("api_key=o2oi_q")).as_deref(),
            Some("o2oi_h")
        );
    }

    fn written(failed: u32, policy_dropped: u32) -> IngestionResponse {
        let mut status = StreamStatus::new("default");
        status.status.successful = 5;
        status.status.failed = failed;
        status.status.policy_dropped = policy_dropped;
        IngestionResponse::new(200, vec![status])
    }

    #[test]
    fn logs_status_is_200_when_every_record_is_written_or_dropped_by_policy() {
        assert_eq!(logs_status(&written(0, 0)), StatusCode::OK);
        assert_eq!(logs_status(&written(2, 2)), StatusCode::OK);
    }

    #[test]
    fn logs_status_is_503_when_the_write_failed() {
        assert_eq!(
            logs_status(&written(0, 0).with_write_failed(true)),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn logs_status_is_503_when_the_stream_was_skipped() {
        assert_eq!(
            logs_status(&written(0, 0).with_stream_skipped(true)),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn logs_status_is_400_when_a_bulk_write_fails_a_record() {
        use openobserve_core::logs::bulk;

        let mut bulk_res = BulkResponse::default();
        bulk_res.items.push(bulk::success_item(
            "index".into(),
            "default",
            String::new(),
            None,
        ));
        let mut ok = written(0, 0);
        ok.status[0].items = bulk_res.items.clone();
        assert_eq!(logs_status(&ok), StatusCode::OK);
        bulk::add_record_status(
            "default".to_string(),
            None,
            String::new(),
            None,
            &mut bulk_res,
            Some(bulk::SCHEMA_CONFORMANCE_FAILED.to_string()),
            Some("cannot cast".to_string()),
        );
        let mut failed = written(0, 0);
        failed.status[0].items = bulk_res.items;
        assert_eq!(logs_status(&failed), StatusCode::BAD_REQUEST);
        assert_eq!(logs_status(&written(2, 1)), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn logs_admission_errors_map_to_retryable_or_final_statuses() {
        use infra::errors::{Error, IngestionError};

        for (e, status) in [
            (
                Error::ResourceError("memtable full".to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (Error::TrialPeriodExpired, StatusCode::TOO_MANY_REQUESTS),
            (
                Error::from(IngestionError::OrgBlocked("acme".to_string())),
                StatusCode::FORBIDDEN,
            ),
            (
                Error::PayloadTooLarge("big".to_string()),
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
            (
                Error::IngestionError("not an ingester".to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (
                Error::IngestionError("Quota exceeded for this organization [acme]".to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (
                Error::IngestionError("Stream name is empty".to_string()),
                StatusCode::BAD_REQUEST,
            ),
            (
                Error::WalFileError("boom".to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ] {
            assert_eq!(logs_error_status(&e), status, "{e:?}");
        }
    }
}

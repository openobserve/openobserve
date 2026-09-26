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

use axum::{
    body::Bytes,
    extract::Path,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
#[cfg(feature = "cloud")]
use config::meta::stream::StreamType;
use config::{
    axum::middlewares::{HEADER_O2_PROCESS_TIME, get_process_time, insert_process_time_header},
    meta::otlp::OtlpRequestType,
};
use ingestion_common::IngestUser;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "cloud")]
use openobserve_core::ingestion::check_ingestion_allowed;

#[cfg(feature = "cloud")]
use crate::common::meta::otlp::otlp_rejection_response;
use crate::{
    common::meta::{
        http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, HttpResponse as MetaHttpResponse},
        otlp::otlp_error_response,
    },
    service::metrics,
};

/// _json ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/ingest/metrics/_json",
    context_path = "/api",
    tag = "Metrics",
    operation_id = "MetricsIngestionJson",
    summary = "Ingest metrics via JSON",
    description = "Ingests metrics data using JSON format. Accepts an array of metric objects containing metric name, type \
                   (counter, gauge, histogram, or summary), labels, timestamp, and value. This endpoint is ideal for custom \
                   applications and systems that generate metrics in JSON format rather than protocol buffers.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "Ingest data (json array)", content_type = "application/json", example = json!([{"__name__":"metrics stream name","__type__":"counter / gauge / histogram / summary","label_name1":"label_value1","label_name2":"label_value2", "_timestamp":1687175143,"value":1.2}])),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "up","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn json(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    // log start processing time
    let process_time = get_process_time();

    let user = IngestUser::from_user_email(&user_email.user_id);

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Metrics, None).await {
        return MetaHttpResponse::too_many_requests(e);
    }

    let mut resp = match metrics::json::ingest(&org_id, None, body, user).await {
        Ok(v) => {
            if v.code == StatusCode::OK.as_u16() {
                MetaHttpResponse::json(v)
            } else if v.code == StatusCode::TOO_MANY_REQUESTS.as_u16() {
                (StatusCode::TOO_MANY_REQUESTS, axum::Json(v)).into_response()
            } else if v.code == StatusCode::SERVICE_UNAVAILABLE.as_u16() {
                (StatusCode::SERVICE_UNAVAILABLE, axum::Json(v)).into_response()
            } else {
                (StatusCode::BAD_REQUEST, axum::Json(v)).into_response()
            }
        }
        Err(e) => {
            log::error!("Error processing request {org_id}/metrics/_json: {e}");
            MetaHttpResponse::bad_request(e)
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());
    resp
}

/// MetricsIngest
// json example at: https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/#examples
#[utoipa::path(
    post,
    path = "/{org_id}/v1/metrics",
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PostMetrics",
    summary = "Ingest metrics via OTLP",
    description = "Ingests metrics data using OpenTelemetry Protocol (OTLP) format. Supports both Protocol Buffers and JSON \
                   content types for OTLP metrics ingestion. This is the standard endpoint for OpenTelemetry SDK and \
                   collector integrations to send metrics data.",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(description = "ExportMetricsServiceRequest", content(("application/x-protobuf"), (Object = "application/json"))),
    responses(
        (status = 200, description = "ExportMetricsServiceResponse", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 206, description = "ExportMetricsServiceResponse with a partial success (JSON requests only)", content((Object = "application/json"))),
        (status = 400, description = "google.rpc.Status: invalid body, unsupported Content-Type, or write rejected (e.g. columns limit)", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 429, description = "google.rpc.Status: trial period expired", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 500, description = "google.rpc.Status: internal write error", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 503, description = "google.rpc.Status: ingester overloaded or unavailable, or ingestion not allowed (cloud)", content(("application/x-protobuf"), (Object = "application/json"))),
    )
)]
pub async fn otlp_metrics_write(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // log start processing time
    let process_time = get_process_time();

    let user = IngestUser::from_user_email(&user_email.user_id);

    let content_type = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Metrics, None).await {
        let req_type = if content_type.eq(CONTENT_TYPE_PROTO) {
            OtlpRequestType::HttpProtobuf
        } else {
            OtlpRequestType::HttpJson
        };
        let status = if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        };
        return otlp_rejection_response(req_type, status, e.to_string());
    }

    let resp = if content_type.eq(CONTENT_TYPE_PROTO) {
        metrics::otlp::otlp_proto(&org_id, body, user).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        metrics::otlp::otlp_json(&org_id, body, user).await
    } else {
        otlp_error_response(
            OtlpRequestType::HttpJson,
            StatusCode::BAD_REQUEST,
            3, // INVALID_ARGUMENT
            "Bad Request: Content-Type must be application/json or application/x-protobuf",
        )
    };

    if process_time > 0 {
        let (mut parts, body) = resp.into_parts();
        parts.headers.insert(
            HEADER_O2_PROCESS_TIME,
            process_time.to_string().parse().unwrap(),
        );
        Response::from_parts(parts, body)
    } else {
        resp
    }
}

// cloud builds run check_ingestion_allowed first, which needs a live org
#[cfg(all(test, not(feature = "cloud")))]
mod tests {
    use axum::http::header::CONTENT_TYPE;
    use config::utils::json;

    use super::*;

    async fn call_otlp_metrics_write(
        content_type: &str,
        body: &'static [u8],
    ) -> (StatusCode, HeaderMap, json::Value) {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, content_type.parse().unwrap());
        let resp = otlp_metrics_write(
            Path("default".to_string()),
            Headers(UserEmail {
                user_id: "a@a.com".to_string(),
            }),
            headers,
            Bytes::from_static(body),
        )
        .await;
        let status = resp.status();
        let resp_headers = resp.headers().clone();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, resp_headers, json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn test_otlp_metrics_invalid_json_is_rpc_status() {
        let (status, headers, body) =
            call_otlp_metrics_write(CONTENT_TYPE_JSON, b"{not json").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(headers[CONTENT_TYPE], CONTENT_TYPE_JSON);
        assert_eq!(body["code"], 3);
        assert!(
            body["message"]
                .as_str()
                .unwrap()
                .starts_with("Invalid json:")
        );
    }

    #[tokio::test]
    async fn test_otlp_metrics_unsupported_content_type_is_rpc_status() {
        let (status, headers, body) = call_otlp_metrics_write("text/plain", b"hello").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(headers[CONTENT_TYPE], CONTENT_TYPE_JSON);
        assert_eq!(body["code"], 3);
        let message = body["message"].as_str().unwrap();
        assert!(message.contains(CONTENT_TYPE_JSON) && message.contains(CONTENT_TYPE_PROTO));
    }
}

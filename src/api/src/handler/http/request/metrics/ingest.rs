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
use config::axum::middlewares::{
    HEADER_O2_PROCESS_TIME, get_process_time, insert_process_time_header,
};
#[cfg(feature = "cloud")]
use config::meta::stream::StreamType;

#[cfg(feature = "cloud")]
use crate::service::ingestion::check_ingestion_allowed;
use crate::{
    common::{
        meta::{http::HttpResponse as MetaHttpResponse, ingestion::IngestUser},
        utils::auth::UserEmail,
    },
    handler::http::{
        extractors::Headers,
        request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
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
    request_body(content = String, description = "ExportMetricsServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
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

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Metrics, None).await {
        return MetaHttpResponse::too_many_requests(e);
    }

    let content_type = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let resp = if content_type.eq(CONTENT_TYPE_PROTO) {
        match metrics::otlp::otlp_proto(&org_id, body, user).await {
            Ok(v) => v,
            Err(e) => MetaHttpResponse::internal_error(e),
        }
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        match metrics::otlp::otlp_json(&org_id, body, user).await {
            Ok(v) => v,
            Err(e) => MetaHttpResponse::internal_error(e),
        }
    } else {
        MetaHttpResponse::bad_request("Bad Request")
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

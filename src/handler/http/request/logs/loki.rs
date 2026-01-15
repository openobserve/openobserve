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

use std::io::Read;

use axum::{
    body::Bytes,
    extract::Path,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use config::axum::middlewares::{get_process_time, insert_process_time_header};
use flate2::read::GzDecoder;
use prost::Message;
use proto::loki_rpc;

use crate::{
    common::meta::loki::{LokiError, LokiPushRequest},
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::{ingestion::get_thread_id, logs},
};

#[utoipa::path(
    post,
    path = "/{org_id}/loki/api/v1/push",
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionLoki",
    summary = "Ingest logs via Loki API",
    description = "Ingests log data using Grafana Loki-compatible API format. Supports both JSON and Protocol Buffers \
                   content types with optional compression (gzip for JSON, snappy for Protobuf). Stream names are \
                   extracted from the 'stream_name' label in stream metadata. Provides seamless migration path from \
                   Loki deployments to OpenObserve while maintaining API compatibility.",
    security(("Authorization"= [])),
    params(("org_id" = String, Path, description = "Organization name")),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = inline(LokiPushRequest), description = "Loki-compatible log push data in JSON format. Stream names are extracted from 'stream_name' label in the stream labels. Also supports Protobuf format (application/x-protobuf) with optional compression (gzip for JSON, snappy for Protobuf)", content_type = "application/json", example = json!({
        "streams": [{
            "stream": {
                "stream_name": "application_logs",
                "service": "api",
                "environment": "production"
            },
            "values": [
                ["1609459200000000000", "API request processed successfully"],
                ["1609459201000000000", "Database connection established", {"trace_id": "abc123", "span_id": "def456"}]
            ]
        }]
    })),
    responses(
        (status = 204, description = "Success - logs ingested successfully"),
        (status = 400, description = "Bad Request - Possible causes: empty stream data, invalid labels format (e.g., empty labels), invalid timestamp format (e.g., non-numeric timestamp), unsupported content type (only application/json and application/x-protobuf supported), unsupported content encoding (only gzip for JSON and snappy for Protobuf), protobuf decode errors, JSON parsing errors, or compression/decompression failures", content_type = "text/plain", body = String),
        (status = 500, description = "Internal Server Error - Server error during log processing", content_type = "text/plain", body = String),
    )
)]
pub async fn loki_push(Path(org_id): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    // log start processing time
    let process_time = get_process_time();
    let thread_id = get_thread_id();

    let content_type = headers
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or(CONTENT_TYPE_PROTO);
    let content_encoding = headers
        .get("Content-Encoding")
        .and_then(|h| h.to_str().ok());
    let user_email = headers
        .get("user_id")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("loki_user");

    let request = match content_type {
        CONTENT_TYPE_JSON => {
            let loki_request = match parse_json_request(content_encoding, body) {
                Ok(req) => req,
                Err(e) => {
                    log::error!("[Loki::JSON] Parse error for org '{org_id}': {e:?}");
                    return e.into_response();
                }
            };
            logs::loki::LokiRequest::Json(loki_request)
        }
        CONTENT_TYPE_PROTO => {
            let protobuf_request = match parse_protobuf_request(content_encoding, body) {
                Ok(req) => req,
                Err(e) => {
                    log::error!("[Loki::Protobuf] Parse error for org '{org_id}': {e:?}");
                    return e.into_response();
                }
            };
            logs::loki::LokiRequest::Protobuf(protobuf_request)
        }
        _ => {
            log::error!("[Loki] Unsupported content type '{content_type}' for org '{org_id}'");
            return LokiError::UnsupportedContentType {
                content_type: content_type.to_string(),
            }
            .into_response();
        }
    };

    let mut resp = match logs::loki::handle_request(thread_id, &org_id, request, user_email).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            log::error!("[Loki] Processing error for org '{org_id}': {e:?}");
            e.into_response()
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());

    resp
}

fn parse_json_request(
    content_encoding: Option<&str>,
    body: Bytes,
) -> Result<LokiPushRequest, LokiError> {
    let json_data = match content_encoding {
        Some("gzip") => {
            let mut decoder = GzDecoder::new(body.as_ref());
            let mut decompressed = Vec::new();
            match decoder.read_to_end(&mut decompressed) {
                Ok(_) => decompressed,
                Err(_) => body.to_vec(), // Fallback to original data like OpenObserve pattern
            }
        }
        None | Some("identity") => body.to_vec(),
        Some(encoding) => {
            return Err(LokiError::UnsupportedContentEncoding {
                encoding: encoding.to_string(),
            });
        }
    };
    serde_json::from_slice::<LokiPushRequest>(&json_data).map_err(LokiError::from)
}

fn parse_protobuf_request(
    content_encoding: Option<&str>,
    body: Bytes,
) -> Result<loki_rpc::PushRequest, LokiError> {
    let decompressed = match content_encoding {
        Some("snappy") | None => snap::raw::Decoder::new()
            .decompress_vec(&body)
            .map_err(|e| LokiError::UnsupportedContentEncoding {
                encoding: format!("snappy decompression failed: {e}"),
            })?,
        Some("identity") => body.to_vec(),
        Some(encoding) => {
            return Err(LokiError::UnsupportedContentEncoding {
                encoding: encoding.to_string(),
            });
        }
    };
    loki_rpc::PushRequest::decode(&*decompressed).map_err(LokiError::from)
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing::post,
    };
    use tower::ServiceExt;

    use super::*;

    fn create_valid_loki_json() -> &'static str {
        r#"{"streams":[{"stream":{"service":"test"},"values":[["1701432000000000000","Test message"]]}]}"#
    }

    #[tokio::test]
    async fn test_loki_push_routing() {
        let app = Router::new().route("/{org_id}/loki/api/v1/push", post(loki_push));

        // Test JSON routing
        let req = Request::builder()
            .method("POST")
            .uri("/test_org/loki/api/v1/push")
            .header("content-type", "application/json")
            .body(Body::from(create_valid_loki_json()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert!(resp.status().is_server_error() || resp.status() == StatusCode::NO_CONTENT);

        // Test invalid JSON
        let req = Request::builder()
            .method("POST")
            .uri("/test_org/loki/api/v1/push")
            .header("content-type", "application/json")
            .body(Body::from("invalid"))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        // Test unsupported content type
        let req = Request::builder()
            .method("POST")
            .uri("/test_org/loki/api/v1/push")
            .header("content-type", "text/plain")
            .body(Body::from("data"))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}

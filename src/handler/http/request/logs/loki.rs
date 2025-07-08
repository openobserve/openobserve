// Copyright 2025 OpenObserve Inc.
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

use std::io::{Error, Read};

use actix_web::{HttpRequest, HttpResponse, post, web};
use flate2::read::GzDecoder;
use prost::Message;
use proto::loki_rpc;

use crate::{
    common::meta::loki::{LokiError, LokiPushRequest},
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::logs,
};

#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionLoki",
    security(("Authorization"= [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = LokiPushRequest, description = "Loki-compatible log push data in JSON format. Stream names are extracted from 'stream_name' label in the stream labels. Also supports Protobuf format (application/x-protobuf) with optional compression (gzip for JSON, snappy for Protobuf)", content_type = "application/json", example = json!({
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
#[post("/{org_id}/loki/api/v1/push")]
pub async fn loki_push(
    thread_id: web::Data<usize>,
    org_id: web::Path<String>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let thread_id = **thread_id;
    let org_id = org_id.into_inner();

    let content_type = req
        .headers()
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or(CONTENT_TYPE_PROTO);
    let content_encoding = req
        .headers()
        .get("Content-Encoding")
        .and_then(|h| h.to_str().ok());
    let user_email = req
        .headers()
        .get("user_id")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("loki_user");

    let request = match content_type {
        CONTENT_TYPE_JSON => {
            let loki_request = match parse_json_request(content_encoding, body) {
                Ok(req) => req,
                Err(e) => {
                    log::error!("[Loki::JSON] Parse error for org '{}': {:?}", org_id, e);
                    return Ok(e.into());
                }
            };
            logs::loki::LokiRequest::Json(loki_request)
        }
        CONTENT_TYPE_PROTO => {
            let protobuf_request = match parse_protobuf_request(content_encoding, body) {
                Ok(req) => req,
                Err(e) => {
                    log::error!("[Loki::Protobuf] Parse error for org '{}': {:?}", org_id, e);
                    return Ok(e.into());
                }
            };
            logs::loki::LokiRequest::Protobuf(protobuf_request)
        }
        _ => {
            log::error!(
                "[Loki] Unsupported content type '{}' for org '{}'",
                content_type,
                org_id
            );
            return Ok(LokiError::UnsupportedContentType {
                content_type: content_type.to_string(),
            }
            .into());
        }
    };

    match logs::loki::handle_request(thread_id, &org_id, request, user_email).await {
        Ok(_) => Ok(HttpResponse::NoContent().finish()),
        Err(e) => {
            log::error!("[Loki] Processing error for org '{}': {:?}", org_id, e);
            Ok(e.into())
        }
    }
}

fn parse_json_request(
    content_encoding: Option<&str>,
    body: web::Bytes,
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
    body: web::Bytes,
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
    use actix_web::{App, test};

    use super::*;

    fn create_valid_loki_json() -> &'static str {
        r#"{"streams":[{"stream":{"service":"test"},"values":[["1701432000000000000","Test message"]]}]}"#
    }

    #[tokio::test]
    async fn test_loki_push_routing() {
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(0_usize))
                .service(loki_push),
        )
        .await;

        // Test JSON routing
        let req = test::TestRequest::post()
            .uri("/test_org/loki/api/v1/push")
            .insert_header(("content-type", "application/json"))
            .set_payload(create_valid_loki_json())
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_server_error() || resp.status() == 204);

        // Test invalid JSON
        let req = test::TestRequest::post()
            .uri("/test_org/loki/api/v1/push")
            .insert_header(("content-type", "application/json"))
            .set_payload("invalid")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        // Test unsupported content type
        let req = test::TestRequest::post()
            .uri("/test_org/loki/api/v1/push")
            .insert_header(("content-type", "text/plain"))
            .set_payload("data")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }
}

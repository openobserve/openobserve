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
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{meta::otlp::OtlpRequestType, utils::json};
use prost::Message;

use super::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO};

/// Minimal `google.rpc.Status` for OTLP/HTTP failure bodies.
#[derive(Clone, PartialEq, Message)]
struct GoogleRpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
}

/// OTLP/HTTP error response: a `google.rpc.Status` encoded the way the request was.
pub fn otlp_error_response(
    req_type: OtlpRequestType,
    status: StatusCode,
    rpc_code: i32,
    message: impl Into<String>,
) -> Response {
    let message = message.into();
    match req_type {
        OtlpRequestType::HttpJson => {
            let body = json::json!({
                "code": rpc_code,
                "message": message,
            });
            (
                status,
                [(header::CONTENT_TYPE, CONTENT_TYPE_JSON)],
                json::to_vec(&body).unwrap_or_default(),
            )
                .into_response()
        }
        _ => {
            let rpc = GoogleRpcStatus {
                code: rpc_code,
                message,
            };
            (
                status,
                [(header::CONTENT_TYPE, CONTENT_TYPE_PROTO)],
                rpc.encode_to_vec(),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    #[tokio::test]
    async fn test_otlp_error_response_protobuf_is_rpc_status() {
        let resp = otlp_error_response(
            OtlpRequestType::HttpProtobuf,
            StatusCode::BAD_REQUEST,
            3,
            "Invalid proto: data is not UTF-8 encoded",
        );
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(resp.headers()[header::CONTENT_TYPE], CONTENT_TYPE_PROTO);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let status = GoogleRpcStatus::decode(body).unwrap();
        assert_eq!(status.code, 3);
        assert_eq!(status.message, "Invalid proto: data is not UTF-8 encoded");
    }

    #[tokio::test]
    async fn test_otlp_error_response_json_is_proto_json_status() {
        let resp = otlp_error_response(
            OtlpRequestType::HttpJson,
            StatusCode::SERVICE_UNAVAILABLE,
            14,
            "memtable is full",
        );
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(resp.headers()[header::CONTENT_TYPE], CONTENT_TYPE_JSON);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: json::Value = json::from_slice(&body).unwrap();
        assert_eq!(
            body,
            json::json!({"code": 14, "message": "memtable is full"})
        );
    }
}

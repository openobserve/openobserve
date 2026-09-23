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
use opentelemetry_proto::tonic::collector::{
    logs::v1::ExportLogsServiceResponse, profiles::v1development::ExportProfilesServiceResponse,
};
use prost::Message;

use super::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO};

/// OTLP `Export*ServiceResponse` whose `partial_success` gets a ProtoJSON body.
pub trait OtlpExportResponse: Message {
    /// ProtoJSON name of the partial success's rejected-count field.
    const REJECTED_FIELD: &'static str;

    fn partial_success(&self) -> Option<(i64, &str)>;
}

impl OtlpExportResponse for ExportLogsServiceResponse {
    const REJECTED_FIELD: &'static str = "rejectedLogRecords";

    fn partial_success(&self) -> Option<(i64, &str)> {
        self.partial_success
            .as_ref()
            .map(|ps| (ps.rejected_log_records, ps.error_message.as_str()))
    }
}

impl OtlpExportResponse for ExportProfilesServiceResponse {
    const REJECTED_FIELD: &'static str = "rejectedProfiles";

    fn partial_success(&self) -> Option<(i64, &str)> {
        self.partial_success
            .as_ref()
            .map(|ps| (ps.rejected_profiles, ps.error_message.as_str()))
    }
}

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

/// OTLP/HTTP requires the response body to use the encoding the request arrived in.
pub fn otlp_export_response<T: OtlpExportResponse>(res: &T, req_type: OtlpRequestType) -> Response {
    match req_type {
        OtlpRequestType::HttpJson => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, CONTENT_TYPE_JSON)],
            json::to_vec(&export_response_to_proto_json(res)).expect("serialize response"),
        )
            .into_response(),
        _ => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, CONTENT_TYPE_PROTO)],
            res.encode_to_vec(),
        )
            .into_response(),
    }
}

/// ProtoJSON rules: int64 as a decimal string, and `partial_success` omitted on a clean success.
pub fn export_response_to_proto_json<T: OtlpExportResponse>(res: &T) -> json::Value {
    match res.partial_success() {
        Some((rejected, error_message)) if rejected != 0 || !error_message.is_empty() => {
            let mut partial = json::Map::new();
            if rejected != 0 {
                partial.insert(
                    T::REJECTED_FIELD.to_string(),
                    json::Value::String(rejected.to_string()),
                );
            }
            if !error_message.is_empty() {
                partial.insert(
                    "errorMessage".to_string(),
                    json::Value::String(error_message.to_string()),
                );
            }
            json::json!({ "partialSuccess": partial })
        }
        _ => json::json!({}),
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

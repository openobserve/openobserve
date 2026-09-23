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

use std::time::Instant;

use axum::{body::to_bytes, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{metrics, utils::json};
use http::StatusCode;
use prost::Message;
use tonic::{Code, Status};

/// Converts an OTLP handler's HTTP reply to the gRPC reply, keeping its partial success and
/// never acknowledging a rejected export.
pub(crate) async fn export_reply<T: Message + Default>(resp: Response) -> Result<T, Status> {
    let status = resp.status();
    let body = to_bytes(resp.into_body(), usize::MAX)
        .await
        .map_err(|e| Status::internal(e.to_string()))?;
    if status.is_success() {
        return T::decode(body).map_err(|e| Status::internal(e.to_string()));
    }
    Err(Status::new(grpc_code(status), error_message(status, &body)))
}

pub(crate) fn error_status(e: &infra::errors::Error) -> Status {
    let status = StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    Status::new(grpc_code(status), e.to_string())
}

pub(crate) fn observe_ok(endpoint: &str, start: Instant) {
    let labels = [endpoint, "200", "", "", "", ""];
    metrics::GRPC_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(start.elapsed().as_secs_f64());
    metrics::GRPC_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}

/// 502/503/504 become UNAVAILABLE, the code OTLP clients retry with backoff.
fn grpc_code(status: StatusCode) -> Code {
    match status {
        StatusCode::UNAUTHORIZED => Code::Unauthenticated,
        StatusCode::FORBIDDEN => Code::PermissionDenied,
        StatusCode::NOT_FOUND => Code::NotFound,
        StatusCode::TOO_MANY_REQUESTS => Code::ResourceExhausted,
        StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT => {
            Code::Unavailable
        }
        s if s.is_client_error() => Code::InvalidArgument,
        _ => Code::Internal,
    }
}

fn error_message(status: StatusCode, body: &[u8]) -> String {
    json::from_slice::<MetaHttpResponse>(body)
        .map(|r| r.message)
        .unwrap_or_else(|_| status.to_string())
}

#[cfg(test)]
mod tests {
    use axum::{Json, response::IntoResponse};
    use infra::errors::Error;
    use opentelemetry_proto::tonic::collector::trace::v1::{
        ExportTracePartialSuccess, ExportTraceServiceResponse,
    };

    use super::*;

    #[tokio::test]
    async fn test_success_keeps_partial_success() {
        let res = ExportTraceServiceResponse {
            partial_success: Some(ExportTracePartialSuccess {
                rejected_spans: 3,
                error_message: "too old".to_string(),
            }),
        };
        let resp = (StatusCode::OK, res.encode_to_vec()).into_response();
        let reply = export_reply::<ExportTraceServiceResponse>(resp)
            .await
            .unwrap();
        assert_eq!(reply, res);
    }

    #[tokio::test]
    async fn test_metrics_timestamp_rejections_survive_export_reply() {
        use opentelemetry_proto::tonic::collector::metrics::v1::{
            ExportMetricsPartialSuccess, ExportMetricsServiceResponse,
        };

        let expected = ExportMetricsServiceResponse {
            partial_success: Some(ExportMetricsPartialSuccess {
                rejected_data_points: 2,
                error_message: "timestamp outside destination retention".to_string(),
            }),
        };
        let response = (StatusCode::OK, expected.encode_to_vec()).into_response();
        let actual = export_reply::<ExportMetricsServiceResponse>(response)
            .await
            .unwrap();
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn test_empty_success_body_is_full_success() {
        let reply =
            export_reply::<ExportTraceServiceResponse>(StatusCode::OK.into_response()).await;
        assert_eq!(reply.unwrap(), ExportTraceServiceResponse::default());
    }

    #[tokio::test]
    async fn test_overload_is_retryable_not_ok() {
        let resp = (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(MetaHttpResponse::error(
                StatusCode::SERVICE_UNAVAILABLE,
                "memtable is full",
            )),
        )
            .into_response();
        let status = export_reply::<ExportTraceServiceResponse>(resp)
            .await
            .unwrap_err();
        assert_eq!(status.code(), Code::Unavailable);
        assert_eq!(status.message(), "memtable is full");
    }

    #[tokio::test]
    async fn test_non_json_error_body_falls_back_to_status() {
        let resp = (StatusCode::BAD_REQUEST, vec![0xff, 0x00]).into_response();
        let status = export_reply::<ExportTraceServiceResponse>(resp)
            .await
            .unwrap_err();
        assert_eq!(status.code(), Code::InvalidArgument);
        assert_eq!(status.message(), "400 Bad Request");
    }

    #[test]
    fn test_error_status_follows_http_status() {
        let overload = error_status(&Error::ResourceError("memory is full".to_string()));
        assert_eq!(overload.code(), Code::Unavailable);
        assert_eq!(overload.message(), "Error# memory is full");
        let rejected = error_status(&Error::IngestionError("stream is deleting".to_string()));
        assert_eq!(rejected.code(), Code::InvalidArgument);
    }

    #[test]
    fn test_grpc_code_matches_otlp_retryability() {
        for (http, grpc) in [
            (StatusCode::TOO_MANY_REQUESTS, Code::ResourceExhausted),
            (StatusCode::BAD_GATEWAY, Code::Unavailable),
            (StatusCode::SERVICE_UNAVAILABLE, Code::Unavailable),
            (StatusCode::GATEWAY_TIMEOUT, Code::Unavailable),
            (StatusCode::BAD_REQUEST, Code::InvalidArgument),
            (StatusCode::PAYLOAD_TOO_LARGE, Code::InvalidArgument),
            (StatusCode::UNAUTHORIZED, Code::Unauthenticated),
            (StatusCode::FORBIDDEN, Code::PermissionDenied),
            (StatusCode::NOT_FOUND, Code::NotFound),
            (StatusCode::INTERNAL_SERVER_ERROR, Code::Internal),
        ] {
            assert_eq!(grpc_code(http), grpc, "{http}");
        }
    }
}

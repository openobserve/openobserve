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
    axum::middlewares::{get_process_time, insert_process_time_header},
    meta::otlp::OtlpRequestType,
};
#[cfg(feature = "cloud")]
use infra::errors::Error as InfraError;
use ingestion_common::IngestUser;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "cloud")]
use openobserve_core::ingestion::check_ingestion_allowed;

use crate::{
    common::meta::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::profiles,
};

fn otlp_request_type_from_content_type(content_type: &str) -> Option<OtlpRequestType> {
    if content_type.starts_with(CONTENT_TYPE_PROTO) {
        Some(OtlpRequestType::HttpProtobuf)
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        Some(OtlpRequestType::HttpJson)
    } else {
        None
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/v1/profiles",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "PostProfiles",
    summary = "Ingest profiles data via OTLP",
    description = "Ingests OpenTelemetry profiles data using OTLP protobuf or JSON payloads.",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "ExportProfilesServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn otlp_profiles_write(
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
    let req_type = otlp_request_type_from_content_type(content_type);

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Profiles, None).await {
        // Prefer the request Content-Type; fall back to protobuf for unknown types.
        let req_type = req_type.unwrap_or(OtlpRequestType::HttpProtobuf);
        let (status, rpc_code) = if matches!(e, InfraError::TrialPeriodExpired) {
            (StatusCode::TOO_MANY_REQUESTS, 8) // RESOURCE_EXHAUSTED
        } else {
            (StatusCode::SERVICE_UNAVAILABLE, 14) // UNAVAILABLE
        };
        return profiles::otlp_error_response(req_type, status, rpc_code, e.to_string());
    }

    let Some(req_type) = req_type else {
        return profiles::otlp_error_response(
            OtlpRequestType::HttpJson,
            StatusCode::BAD_REQUEST,
            3, // INVALID_ARGUMENT
            "Bad Request: Content-Type must be application/json or application/x-protobuf",
        );
    };

    let cfg = config::get_config();
    let stream_name = headers
        .get(&cfg.grpc.stream_header_key)
        .and_then(|header| header.to_str().ok());

    let result = match req_type {
        OtlpRequestType::HttpProtobuf => {
            profiles::otlp_proto(&org_id, body, stream_name, user).await
        }
        OtlpRequestType::HttpJson => profiles::otlp_json(&org_id, body, stream_name, user).await,
        OtlpRequestType::Grpc => unreachable!("HTTP handler does not receive gRPC requests"),
    };

    match result {
        Ok(mut resp) => {
            insert_process_time_header(process_time, resp.headers_mut());
            resp
        }
        // Defensive: core maps Internal to OTLP Status and should not Err.
        Err(e) => profiles::otlp_error_response(
            req_type,
            StatusCode::INTERNAL_SERVER_ERROR,
            13, // INTERNAL
            e.to_string(),
        )
        .into_response(),
    }
}

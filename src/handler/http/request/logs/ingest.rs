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
    Json,
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
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use prost::Message;

#[cfg(feature = "cloud")]
use crate::service::ingestion::check_ingestion_allowed;
use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            ingestion::{
                GCPIngestionRequest, HecResponse, HecStatus, IngestUser, IngestionRequest,
                KinesisFHIngestionResponse, KinesisFHRequest,
            },
        },
        utils::auth::UserEmail,
    },
    handler::http::{
        extractors::Headers,
        request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    },
    service::{
        ingestion::get_thread_id,
        logs::{self, otlp::handle_request},
    },
};

/// _bulk ES compatible ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/_bulk",
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionBulk",
    summary = "Bulk ingest logs (Elasticsearch compatible)",
    description = "Ingests multiple log records in bulk using Elasticsearch-compatible NDJSON format. Each line contains \
                   either an index/create action followed by the document data. This endpoint provides high-throughput \
                   ingestion for applications migrating from or integrating with Elasticsearch.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (ndjson)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"took":2,"errors":true,"items":[{"index":{"_index":"olympics","_id":1,"status":200,"error":{"type":"Too old data, only last 5 hours data can be ingested. Data discarded.","reason":"Too old data, only last 5 hours data can be ingested. Data discarded.","index_uuid":"1","shard":"1","index":"olympics"},"original_record":{"athlete":"CHASAPIS, Spiridon","city":"BER","country":"USA","discipline":"Swimming","event":"100M Freestyle For Sailors","gender":"Men","medal":"Silver","onemore":1,"season":"summer","sport":"Aquatics","year":1986}}}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let user_email = &user_email.user_id;
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    // log start processing time
    let process_time = get_process_time();

    let mut resp = match logs::bulk::ingest(
        thread_id,
        &org_id,
        body,
        IngestUser::from_user_email(user_email.clone()),
    )
    .await
    {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing request {org_id}/_bulk: {e}");
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
                )
                    .into_response()
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
                )
                    .into_response()
            }
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());

    resp
}

/// _multi ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/_multi",
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionMulti",
    summary = "Ingest logs via multi-line JSON",
    description = "Ingests log data using multi-line JSON format where each line contains a separate JSON object \
                   representing a log record. This format is efficient for streaming applications and tools that \
                   generate logs in newline-delimited JSON format.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = String, description = "Ingest data (multiple line json)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn multi(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let user_email = &user_email.user_id;
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    // log start processing time
    let process_time = get_process_time();

    let mut resp = match logs::ingest::ingest(
        thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::Multi(body),
        IngestUser::from_user_email(user_email.clone()),
        None,
        false,
    )
    .await
    {
        Ok(v) => match v.code {
            503 => (StatusCode::SERVICE_UNAVAILABLE, Json(v)).into_response(),
            _ => MetaHttpResponse::json(v),
        },
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing request {org_id}/{stream_name}/_multi: {e}");
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
                )
                    .into_response()
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
                )
                    .into_response()
            }
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());

    resp
}

/// _json ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/_json",
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionJson",
    summary = "Ingest logs via JSON array",
    description = "Ingests log data using a JSON array format where multiple log records are submitted as an array in a \
                   single request. This is ideal for batch processing scenarios where applications collect multiple \
                   log entries before sending them together for improved efficiency.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = String, description = "Ingest data (json array)", content_type = "application/json", example = json!([{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "Alfred", "Country": "HUN"},{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "HERSCHMANN", "Country":"CHN"}])),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "Ingest logs via JSON array", "category": "logs"}))
    )
)]
pub async fn json(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let user_email = &user_email.user_id;
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    // log start processing time
    let process_time = get_process_time();

    let mut resp = match logs::ingest::ingest(
        thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::JSON(body),
        IngestUser::from_user_email(user_email.clone()),
        None,
        false,
    )
    .await
    {
        Ok(v) => match v.code {
            503 => (StatusCode::SERVICE_UNAVAILABLE, Json(v)).into_response(),
            _ => MetaHttpResponse::json(v),
        },
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing request {org_id}/{stream_name}/_json: {e}");
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
                )
                    .into_response()
            } else {
                MetaHttpResponse::bad_request(e)
            }
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());

    resp
}

/// _kinesis_firehose ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/_kinesis_firehose",
    context_path = "/api",
    tag = "Logs",
    operation_id = "AWSLogsIngestion",
    summary = "Ingest logs from AWS Kinesis Firehose",
    description = "Ingests log data from AWS Kinesis Data Firehose in the native Kinesis format. This endpoint handles \
                   the specific request/response structure expected by Kinesis Firehose, making it seamless to \
                   stream AWS CloudWatch logs and other AWS services directly into OpenObserve.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = inline(KinesisFHRequest), description = "Ingest data (json array)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(KinesisFHIngestionResponse), example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f","timestamp": 1578090903599_i64})),
        (status = 500, description = "Failure", content_type = "application/json", body = (), example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f", "timestamp": 1578090903599_i64, "errorMessage": "error processing request"})),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn handle_kinesis_request(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(post_data): Json<KinesisFHRequest>,
) -> Response {
    let user_email = &user_email.user_id;
    let request_id = post_data.request_id.clone();
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    let request_time = post_data
        .timestamp
        .unwrap_or(chrono::Utc::now().timestamp_millis());

    match logs::ingest::ingest(
        thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::KinesisFH(post_data),
        IngestUser::from_user_email(user_email.clone()),
        None,
        false,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::json(KinesisFHIngestionResponse {
            request_id,
            timestamp: request_time,
            error_message: None,
        }),
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing kinesis request:  org_id: {org_id} {e}");
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(KinesisFHIngestionResponse {
                        request_id,
                        timestamp: request_time,
                        error_message: e.to_string().into(),
                    }),
                )
                    .into_response()
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    Json(KinesisFHIngestionResponse {
                        request_id,
                        timestamp: request_time,
                        error_message: e.to_string().into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

pub async fn handle_gcp_request(
    Path((org_id, stream_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(post_data): Json<GCPIngestionRequest>,
) -> Response {
    let user_email = &user_email.user_id;
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    match logs::ingest::ingest(
        thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::GCP(post_data),
        IngestUser::from_user_email(user_email.clone()),
        None,
        false,
    )
    .await
    {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing request {org_id}/{stream_name}/_gcp: {e:?}");
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
                )
                    .into_response()
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
                )
                    .into_response()
            }
        }
    }
}

/// LogsIngest
#[utoipa::path(
    post,
    path = "/{org_id}/v1/logs",
    context_path = "/api",
    tag = "Logs",
    operation_id = "PostLogs",
    summary = "Ingest logs via OTLP",
    description = "Ingests log data using OpenTelemetry Protocol (OTLP) format. Supports both Protocol Buffers and JSON \
                   content types for OTLP log ingestion. This is the standard endpoint for OpenTelemetry SDK and \
                   collector integrations to send structured log data with trace correlation.",
    request_body(content = String, description = "ExportLogsServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn otlp_logs_write(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let content_type = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(CONTENT_TYPE_PROTO);
    let user_email = &user_email.user_id;
    let in_stream_name = headers
        .get(&config::get_config().grpc.stream_header_key)
        .and_then(|v| v.to_str().ok());
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    let (request, request_type) = match content_type {
        CONTENT_TYPE_PROTO => match ExportLogsServiceRequest::decode(body) {
            Ok(req) => (req, OtlpRequestType::HttpProtobuf),
            Err(e) => {
                log::error!("[LOGS:OTLP] Invalid proto: org_id: {org_id} {e}");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(
                        StatusCode::BAD_REQUEST,
                        format!("Invalid proto: {e}"),
                    )),
                )
                    .into_response();
            }
        },
        CONTENT_TYPE_JSON => {
            match serde_json::from_slice::<ExportLogsServiceRequest>(body.as_ref()) {
                Ok(req) => (req, OtlpRequestType::HttpJson),
                Err(e) => {
                    log::error!("[LOGS:OTLP] Invalid json: org_id: {org_id} {e}");
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(MetaHttpResponse::error(
                            StatusCode::BAD_REQUEST,
                            format!("Invalid json: {e}"),
                        )),
                    )
                        .into_response();
                }
            }
        }
        _ => {
            return MetaHttpResponse::bad_request("Bad Request");
        }
    };

    match handle_request(
        thread_id,
        &org_id,
        request,
        in_stream_name,
        user_email,
        request_type,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!(
                    "Error processing otlp {content_type} logs write request {org_id}/{in_stream_name:?}: {e:?}"
                );
            }
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
                )
                    .into_response()
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
                )
                    .into_response()
            }
        }
    }
}

/// HEC format compatible ingestion API
#[utoipa::path(
    post,
    path = "/{org_id}/_hec",
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionHec",
    summary = "Ingest logs via Splunk HEC format",
    description = "Ingests log data using Splunk HTTP Event Collector (HEC) format, providing compatibility with Splunk \
                   forwarders and applications. This endpoint accepts the standard HEC JSON format, making it easy to \
                   migrate from or integrate with existing Splunk deployments.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (hec)"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(HecResponse), example = json!({"text":"Success","code": 200})),
        (status = 200, description = "Failure", content_type = "application/json", body = inline(HecResponse), example = json!({"text":"Invalid data format","code": 400})),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn hec(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let user_email = &user_email.user_id;
    let thread_id = get_thread_id();

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Logs, None).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(MetaHttpResponse::error(StatusCode::TOO_MANY_REQUESTS, e)),
        )
            .into_response();
    }

    // log start processing time
    let process_time = get_process_time();

    let mut resp = match logs::hec::ingest(thread_id, &org_id, body, user_email).await {
        Ok(v) => {
            if v.code > 299 {
                (StatusCode::BAD_REQUEST, Json(v)).into_response()
            } else {
                MetaHttpResponse::json(v)
            }
        }
        Err(e) => {
            // we do not want to log trial period expired errors
            if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
                log::error!("Error processing request {org_id}/_hec: {e}");
            }
            let res = HecResponse::from(HecStatus::Custom(e.to_string(), 400));
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                (StatusCode::SERVICE_UNAVAILABLE, Json(res)).into_response()
            } else {
                (StatusCode::BAD_REQUEST, Json(res)).into_response()
            }
        }
    };

    insert_process_time_header(process_time, resp.headers_mut());

    resp
}

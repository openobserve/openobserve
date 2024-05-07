// Copyright 2024 Zinc Labs Inc.
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

use std::io::Error;

use actix_web::{http, post, web, HttpRequest, HttpResponse};
use config::CONFIG;

use crate::{
    common::{
        infra::ingest_buffer::{send_task, IngestEntry, IngestSource},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            ingestion::{
                GCPIngestionRequest, IngestionRequest, KinesisFHIngestionResponse, KinesisFHRequest,
            },
        },
    },
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::{
        logs,
        logs::otlp_http::{logs_json_handler, logs_proto_handler},
    },
};

/// _bulk ES compatible ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionBulk",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (ndjson)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkResponse, example = json!({"took":2,"errors":true,"items":[{"index":{"_index":"olympics","_id":1,"status":200,"error":{"type":"Too old data, only last 5 hours data can be ingested. Data discarded.","reason":"Too old data, only last 5 hours data can be ingested. Data discarded.","index_uuid":"1","shard":"1","index":"olympics"},"original_record":{"athlete":"CHASAPIS, Spiridon","city":"BER","country":"USA","discipline":"Swimming","event":"100M Freestyle For Sailors","gender":"Men","medal":"Silver","onemore":1,"season":"summer","sport":"Aquatics","year":1986}}}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_bulk")]
pub async fn bulk(
    org_id: web::Path<String>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    let content_length = match in_req.headers().get("content-length") {
        None => 0,
        Some(content_length) => content_length
            .to_str()
            .unwrap_or("0")
            .parse::<usize>()
            .unwrap_or(0),
    };

    Ok(
        if CONFIG.common.feature_ingest_buffer_enabled
            && content_length > CONFIG.limit.ingest_buffer_threshold
        {
            match IngestEntry::new(
                IngestSource::Bulk,
                **thread_id,
                org_id,
                user_email.to_string(),
                None,
                content_length,
                body,
            ) {
                Ok(ingest_entry) => send_task(ingest_entry).await,
                Err(e) => HttpResponse::BadRequest().json(e.to_string()),
            }
        } else {
            match logs::bulk::ingest(&org_id, body, **thread_id, user_email).await {
                Ok(v) => MetaHttpResponse::json(v),
                Err(e) => {
                    log::error!("Error processing request: {:?}", e);
                    HttpResponse::BadRequest().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        e.to_string(),
                    ))
                }
            }
        },
    )
}

/// _multi ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionMulti",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = String, description = "Ingest data (multiple line json)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/_multi")]
pub async fn multi(
    path: web::Path<(String, String)>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    let content_length = match in_req.headers().get("content-length") {
        None => 0,
        Some(content_length) => content_length
            .to_str()
            .unwrap_or("0")
            .parse::<usize>()
            .unwrap_or(0),
    };

    Ok(
        if CONFIG.common.feature_ingest_buffer_enabled
            && content_length >= CONFIG.limit.ingest_buffer_threshold
        {
            match IngestEntry::new(
                IngestSource::Multi,
                **thread_id,
                org_id,
                user_email.to_string(),
                Some(stream_name),
                content_length,
                body,
            ) {
                Ok(ingest_entry) => send_task(ingest_entry).await,
                Err(e) => HttpResponse::BadRequest().json(e.to_string()),
            }
        } else {
            match logs::ingest::ingest(
                &org_id,
                &stream_name,
                IngestionRequest::Multi(&body),
                **thread_id,
                user_email,
            )
            .await
            {
                Ok(v) => match v.code {
                    503 => HttpResponse::ServiceUnavailable().json(v),
                    _ => MetaHttpResponse::json(v),
                },
                Err(e) => {
                    log::error!("Error processing request: {:?}", e);
                    HttpResponse::BadRequest().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        e.to_string(),
                    ))
                }
            }
        },
    )
}

/// _json ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionJson",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = String, description = "Ingest data (json array)", content_type = "application/json", example = json!([{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "Alfred", "Country": "HUN"},{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "HERSCHMANN", "Country":"CHN"}])),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/_json")]
pub async fn json(
    path: web::Path<(String, String)>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    let content_length = match in_req.headers().get("content-length") {
        None => 0,
        Some(content_length) => content_length
            .to_str()
            .unwrap_or("0")
            .parse::<usize>()
            .unwrap_or(0),
    };
    Ok(
        if CONFIG.common.feature_ingest_buffer_enabled
            && content_length >= CONFIG.limit.ingest_buffer_threshold
        {
            match IngestEntry::new(
                IngestSource::JSON,
                **thread_id,
                org_id,
                user_email.to_string(),
                Some(stream_name),
                content_length,
                body,
            ) {
                Ok(ingest_entry) => send_task(ingest_entry).await,
                Err(e) => HttpResponse::BadRequest().json(e.to_string()),
            }
        } else {
            match logs::ingest::ingest(
                &org_id,
                &stream_name,
                IngestionRequest::JSON(&body),
                **thread_id,
                user_email,
            )
            .await
            {
                Ok(v) => match v.code {
                    503 => HttpResponse::ServiceUnavailable().json(v),
                    _ => MetaHttpResponse::json(v),
                },
                Err(e) => {
                    log::error!("Error processing request: {:?}", e);
                    HttpResponse::BadRequest().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        e.to_string(),
                    ))
                }
            }
        },
    )
}

/// _kinesis_firehose ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "AWSLogsIngestion",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(content = KinesisFHRequest, description = "Ingest data (json array)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = KinesisFHIngestionResponse, example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f","timestamp": 1578090903599_i64})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse, example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f", "timestamp": 1578090903599_i64, "errorMessage": "error processing request"})),
    )
)]
#[post("/{org_id}/{stream_name}/_kinesis_firehose")]
pub async fn handle_kinesis_request(
    path: web::Path<(String, String)>,
    thread_id: web::Data<usize>,
    post_data: web::Json<KinesisFHRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    let request_id = post_data.request_id.clone();
    let request_time = post_data
        .timestamp
        .unwrap_or(chrono::Utc::now().timestamp_millis());
    Ok(
        match logs::ingest::ingest(
            &org_id,
            &stream_name,
            IngestionRequest::KinesisFH(&post_data.into_inner()),
            **thread_id,
            user_email,
        )
        .await
        {
            Ok(_) => MetaHttpResponse::json(KinesisFHIngestionResponse {
                request_id,
                timestamp: request_time,
                error_message: None,
            }),
            Err(e) => {
                log::error!("Error processing kinesis request: {:?}", e);
                HttpResponse::BadRequest().json(KinesisFHIngestionResponse {
                    request_id,
                    timestamp: request_time,
                    error_message: e.to_string().into(),
                })
            }
        },
    )
}

#[post("/{org_id}/{stream_name}/_sub")]
pub async fn handle_gcp_request(
    path: web::Path<(String, String)>,
    thread_id: web::Data<usize>,
    post_data: web::Json<GCPIngestionRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    Ok(
        match logs::ingest::ingest(
            &org_id,
            &stream_name,
            IngestionRequest::GCP(&post_data.into_inner()),
            **thread_id,
            user_email,
        )
        .await
        {
            Ok(v) => MetaHttpResponse::json(v),
            Err(e) => {
                log::error!("Error processing request: {:?}", e);
                HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                ))
            }
        },
    )
}

/// LogsIngest
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "PostLogs",
    request_body(content = String, description = "ExportLogsServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/v1/logs")]
pub async fn otlp_logs_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    let user_email = req.headers().get("user_id").unwrap().to_str().unwrap();
    let in_stream_name = req
        .headers()
        .get(&CONFIG.grpc.stream_header_key)
        .map(|header| header.to_str().unwrap());
    if content_type.eq(CONTENT_TYPE_PROTO) {
        // log::info!("otlp::logs_proto_handler");
        logs_proto_handler(&org_id, **thread_id, body, in_stream_name, user_email).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        // log::info!("otlp::logs_json_handler");
        logs_json_handler(&org_id, **thread_id, body, in_stream_name, user_email).await
    } else {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Bad Request".to_string(),
        )))
    }
}

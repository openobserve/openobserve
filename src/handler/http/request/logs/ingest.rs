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

use crate::{
    common::meta::{
        http::HttpResponse as MetaHttpResponse,
        ingestion::{
            GCPIngestionRequest, IngestionRequest, KinesisFHIngestionResponse, KinesisFHRequest,
        },
    },
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::{
        logs,
        logs::otlp_http::{logs_json_handler, logs_proto_handler},
    },
};

use serde::{Deserialize, Serialize};
use chrono::Utc;


#[derive(Deserialize, Serialize)]
pub struct KafkaIngestionRequest {
    pub key: String,
    pub value: String,
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaIngestionResponse {
    pub request_id: String,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}


/// _bulk ES compatible ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "KafkaLogsIngestion",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = KafkaIngestionRequest, description = "Ingest data from Kafka", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = KafkaIngestionResponse, example = json!({"request_id": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f", "timestamp": 1578090903599_i64})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse, example = json!({"request_id": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f", "timestamp": 1578090903599_i64, "error_message": "error processing request"})),
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
    Ok(
        match logs::bulk::ingest(&org_id, body, **thread_id, user_email).await {
            Ok(v) => MetaHttpResponse::json(v),
            Err(e) => {
                log::error!("Error processing request {org_id}/_bulk: {:?}", e);
                HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                ))
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
    Ok(
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
                log::error!("Error processing request {org_id}/{stream_name}: {:?}", e);
                HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                ))
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
    Ok(
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
                log::error!("Error processing request {org_id}/{stream_name}: {:?}", e);
                HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                ))
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
                log::error!("Error processing request {org_id}/{stream_name}: {:?}", e);
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
        .get(&config::get_config().grpc.stream_header_key)
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

#[post("/{org_id}/_kafka")]
pub async fn handle_kafka_request(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    post_data: web::Json<KafkaIngestionRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    let request_id = post_data.key.clone(); // the key can be used as a request ID
    let request_time = Utc::now().timestamp_millis();

    // Clone the topic to avoid borrowing issues
    let topic = post_data.topic.clone();

    Ok(
        match logs::ingest::ingest(
            &org_id,
            &topic,
            IngestionRequest::Kafka(&post_data.into_inner()),
            **thread_id,
            user_email,
        )
        .await
        {
            Ok(_) => HttpResponse::Ok().json(KafkaIngestionResponse {
                request_id,
                timestamp: request_time,
                error_message: None,
            }),
            Err(e) => {
                log::error!("Error processing Kafka request: {:?}", e);
                HttpResponse::BadRequest().json(KafkaIngestionResponse {
                    request_id,
                    timestamp: request_time,
                    error_message: Some(e.to_string()),
                })
            }
        },
    )
}

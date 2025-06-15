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

use std::io::Error;

use actix_web::{HttpRequest, HttpResponse, http, http::header, post, web};
use config::meta::otlp::OtlpRequestType;
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use prost::Message;

use crate::{
    common::meta::{
        http::HttpResponse as MetaHttpResponse,
        ingestion::{
            GCPIngestionRequest, HecResponse, HecStatus, IngestionRequest,
            KinesisFHIngestionResponse, KinesisFHRequest,
        },
    },
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::logs::{self, otlp::handle_request},
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
    thread_id: web::Data<usize>,
    org_id: web::Path<String>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();

    // log start processing time
    let process_time = if config::get_config().limit.http_slow_log_threshold > 0 {
        config::utils::time::now_micros()
    } else {
        0
    };

    let mut resp = match logs::bulk::ingest(**thread_id, &org_id, body, user_email).await {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => {
            log::error!("Error processing request {org_id}/_bulk: {e}");
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                ))
            } else {
                HttpResponse::BadRequest()
                    .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))
            }
        }
    };

    if process_time > 0 {
        resp.headers_mut().insert(
            header::HeaderName::from_static("o2_process_time"),
            header::HeaderValue::from_str(&process_time.to_string()).unwrap(),
        );
    }

    Ok(resp)
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
    thread_id: web::Data<usize>,
    path: web::Path<(String, String)>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();

    // log start processing time
    let process_time = if config::get_config().limit.http_slow_log_threshold > 0 {
        config::utils::time::now_micros()
    } else {
        0
    };

    let mut resp = match logs::ingest::ingest(
        **thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::Multi(&body),
        user_email,
        None,
    )
    .await
    {
        Ok(v) => match v.code {
            503 => HttpResponse::ServiceUnavailable().json(v),
            _ => MetaHttpResponse::json(v),
        },
        Err(e) => {
            log::error!("Error processing request {org_id}/{stream_name}/_multi: {e}");
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                ))
            } else {
                HttpResponse::BadRequest()
                    .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))
            }
        }
    };

    if process_time > 0 {
        resp.headers_mut().insert(
            header::HeaderName::from_static("o2_process_time"),
            header::HeaderValue::from_str(&process_time.to_string()).unwrap(),
        );
    }

    Ok(resp)
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
    thread_id: web::Data<usize>,
    path: web::Path<(String, String)>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();

    // log start processing time
    let process_time = if config::get_config().limit.http_slow_log_threshold > 0 {
        config::utils::time::now_micros()
    } else {
        0
    };

    let mut resp = match logs::ingest::ingest(
        **thread_id,
        &org_id,
        &stream_name,
        IngestionRequest::JSON(&body),
        user_email,
        None,
    )
    .await
    {
        Ok(v) => match v.code {
            503 => HttpResponse::ServiceUnavailable().json(v),
            _ => MetaHttpResponse::json(v),
        },
        Err(e) => {
            log::error!("Error processing request {org_id}/{stream_name}/_json: {e}");
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                ))
            } else {
                HttpResponse::BadRequest()
                    .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))
            }
        }
    };

    if process_time > 0 {
        resp.headers_mut().insert(
            header::HeaderName::from_static("o2_process_time"),
            header::HeaderValue::from_str(&process_time.to_string()).unwrap(),
        );
    }

    Ok(resp)
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
    thread_id: web::Data<usize>,
    path: web::Path<(String, String)>,
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
            **thread_id,
            &org_id,
            &stream_name,
            IngestionRequest::KinesisFH(&post_data.into_inner()),
            user_email,
            None,
        )
        .await
        {
            Ok(_) => MetaHttpResponse::json(KinesisFHIngestionResponse {
                request_id,
                timestamp: request_time,
                error_message: None,
            }),
            Err(e) => {
                log::error!("Error processing kinesis request: {e}");
                if matches!(e, infra::errors::Error::ResourceError(_)) {
                    HttpResponse::ServiceUnavailable().json(KinesisFHIngestionResponse {
                        request_id,
                        timestamp: request_time,
                        error_message: e.to_string().into(),
                    })
                } else {
                    HttpResponse::BadRequest().json(KinesisFHIngestionResponse {
                        request_id,
                        timestamp: request_time,
                        error_message: e.to_string().into(),
                    })
                }
            }
        },
    )
}

#[post("/{org_id}/{stream_name}/_sub")]
pub async fn handle_gcp_request(
    thread_id: web::Data<usize>,
    path: web::Path<(String, String)>,
    post_data: web::Json<GCPIngestionRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();
    Ok(
        match logs::ingest::ingest(
            **thread_id,
            &org_id,
            &stream_name,
            IngestionRequest::GCP(&post_data.into_inner()),
            user_email,
            None,
        )
        .await
        {
            Ok(v) => MetaHttpResponse::json(v),
            Err(e) => {
                log::error!(
                    "Error processing request {org_id}/{stream_name}/_gcp: {:?}",
                    e
                );
                if matches!(e, infra::errors::Error::ResourceError(_)) {
                    HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                        http::StatusCode::SERVICE_UNAVAILABLE,
                        e,
                    ))
                } else {
                    HttpResponse::BadRequest()
                        .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))
                }
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
    thread_id: web::Data<usize>,
    org_id: web::Path<String>,
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

    let (request, request_type) = match content_type {
        CONTENT_TYPE_PROTO => match ExportLogsServiceRequest::decode(body) {
            Ok(req) => (req, OtlpRequestType::HttpProtobuf),
            Err(e) => {
                log::error!("[LOGS:OTLP] Invalid proto: {}", e);
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST,
                    format!("Invalid proto: {}", e),
                )));
            }
        },
        CONTENT_TYPE_JSON => {
            match serde_json::from_slice::<ExportLogsServiceRequest>(body.as_ref()) {
                Ok(req) => (req, OtlpRequestType::HttpJson),
                Err(e) => {
                    log::error!("[LOGS:OTLP] Invalid json: {}", e);
                    return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST,
                        format!("Invalid json: {}", e),
                    )));
                }
            }
        }
        _ => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "Bad Request",
            )));
        }
    };

    let resp = match handle_request(
        **thread_id,
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
            log::error!(
                "Error processing otlp {} logs write request {org_id}/{:?}: {:?}",
                content_type,
                in_stream_name,
                e
            );
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                ))
            } else {
                HttpResponse::BadRequest()
                    .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))
            }
        }
    };

    Ok(resp)
}

/// HEC format compatible ingestion API
#[utoipa::path(
    context_path = "/api",
    tag = "Logs",
    operation_id = "LogsIngestionHec",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (hec)"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HecResponse, example = json!({"text":"Success","code": 200})),
        (status = 200, description = "Failure", content_type = "application/json", body = HecResponse, example = json!({"text":"Invalid data format","code": 400})),
    )
)]
#[post("/{org_id}/_hec")]
pub async fn hec(
    thread_id: web::Data<usize>,
    org_id: web::Path<String>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_email = in_req.headers().get("user_id").unwrap().to_str().unwrap();

    // log start processing time
    let process_time = if config::get_config().limit.http_slow_log_threshold > 0 {
        config::utils::time::now_micros()
    } else {
        0
    };

    let mut resp = match logs::hec::ingest(**thread_id, &org_id, body, user_email).await {
        Ok(v) => {
            if v.code > 299 {
                HttpResponse::BadRequest().json(v)
            } else {
                MetaHttpResponse::json(v)
            }
        }
        Err(e) => {
            log::error!("Error processing request {org_id}/_hec: {e}");
            let res = HecResponse::from(HecStatus::Custom(e.to_string(), 400));
            if matches!(e, infra::errors::Error::ResourceError(_)) {
                HttpResponse::ServiceUnavailable().json(res)
            } else {
                HttpResponse::BadRequest().json(res)
            }
        }
    };

    if process_time > 0 {
        resp.headers_mut().insert(
            header::HeaderName::from_static("o2_process_time"),
            header::HeaderValue::from_str(&process_time.to_string()).unwrap(),
        );
    }

    Ok(resp)
}

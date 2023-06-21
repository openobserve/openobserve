// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{http, post, web, HttpResponse};
use std::io::Error;

use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::{
    meta::ingestion::{GCPIngestionRequest, KinesisFHRequest},
    service::logs,
};

/** _bulk ES compatible ingestion API */
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
        (status = 200, description="Success", content_type = "application/json", body = BulkResponse, example = json!({"took":2,"errors":true,"items":[{"index":{"_index":"olympics","_id":1,"status":200,"error":{"type":"Too old data, only last 5 hours data can be ingested. Data discarded.","reason":"Too old data, only last 5 hours data can be ingested. Data discarded.","index_uuid":"1","shard":"1","index":"olympics"},"original_record":{"athlete":"CHASAPIS, Spiridon","city":"BER","country":"USA","discipline":"Swimming","event":"100M Freestyle For Sailors","gender":"Men","medal":"Silver","onemore":1,"season":"summer","sport":"Aquatics","year":1986}}}]})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_bulk")]
pub async fn bulk(
    org_id: web::Path<String>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    Ok(match logs::bulk::ingest(&org_id, body, **thread_id).await {
        Ok(v) => HttpResponse::Ok().json(v),
        Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            e.to_string(),
        )),
    })
}

/** _multi ingestion API */
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
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/_multi")]
pub async fn multi(
    path: web::Path<(String, String)>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    Ok(
        match logs::multi::ingest(&org_id, &stream_name, body, **thread_id).await {
            Ok(v) => HttpResponse::Ok().json(v),
            Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        },
    )
}

/** _json ingestion API */
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
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/_json")]
pub async fn json(
    path: web::Path<(String, String)>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    Ok(
        match logs::json::ingest(&org_id, &stream_name, body, **thread_id).await {
            Ok(v) => HttpResponse::Ok().json(v),
            Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        },
    )
}

/** _kinesis_firehose ingestion API*/
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
        (status = 200, description="Success", content_type = "application/json", body = KinesisFHIngestionResponse, example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f","timestamp": 1578090903599_i64})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse, example = json!({ "requestId": "ed4acda5-034f-9f42-bba1-f29aea6d7d8f", "timestamp": 1578090903599_i64, "errorMessage": "error processing request"})),
    )
)]
#[post("/{org_id}/{stream_name}/_kinesis_firehose")]
pub async fn handle_kinesis_request(
    path: web::Path<(String, String)>,
    thread_id: web::Data<usize>,
    post_data: web::Json<KinesisFHRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    Ok(
        match logs::kinesis_firehose::process(
            &org_id,
            &stream_name,
            post_data.into_inner(),
            **thread_id,
        )
        .await
        {
            Ok(v) => {
                if v.error_message.is_some() {
                    HttpResponse::BadRequest().json(v)
                } else {
                    HttpResponse::Ok().json(v)
                }
            }
            Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        },
    )
}

#[post("/{org_id}/{stream_name}/_sub")]
pub async fn handle_gcp_request(
    path: web::Path<(String, String)>,
    thread_id: web::Data<usize>,
    post_data: web::Json<GCPIngestionRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    Ok(
        match logs::gcs_pub_sub::process(&org_id, &stream_name, post_data.into_inner(), **thread_id)
            .await
        {
            Ok(v) => {
                if v.error_message.is_some() {
                    HttpResponse::BadRequest().json(v)
                } else {
                    HttpResponse::Ok().json(v)
                }
            }
            Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        },
    )
}

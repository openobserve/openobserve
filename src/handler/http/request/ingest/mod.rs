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

use actix_web::{post, web, HttpResponse};
use prometheus::GaugeVec;
use std::io::Error;

use crate::service::logs;

/** Elasticsearch compatible _bulk ingestion API */
#[utoipa::path(
    context_path = "/api",
    tag = "Ingestion",
    operation_id = "IngestionBulk",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (ndjson)", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_bulk")]
pub async fn bulk(
    org_id: web::Path<String>,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    logs::bulk::ingest(&org_id, body, thread_id, ingest_stats).await
}

/** ndjson (newline delimited json) multi ingestion API */
#[utoipa::path(
    context_path = "/api",
    tag = "Ingestion",
    operation_id = "IngestionMulti",
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
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    logs::multi::ingest(&org_id, &stream_name, body, thread_id, ingest_stats).await
}

/** json ingestion API, accepts array of json records */
#[utoipa::path(
    context_path = "/api",
    tag = "Ingestion",
    operation_id = "IngestionJson",
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
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    logs::json::ingest(&org_id, &stream_name, body, thread_id, ingest_stats).await
}

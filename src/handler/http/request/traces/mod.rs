// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{http, post, web, HttpRequest, HttpResponse};
use std::io::Error;

use crate::{
    common::{infra::config::CONFIG, meta},
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::traces::otlp_http,
};

/** TracesIngest */
#[utoipa::path(
    context_path = "/api",
    tag = "Traces",
    operation_id = "PostTraces",
    request_body(content = String, description = "ExportTraceServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/traces")]
pub async fn traces_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    handle_req(org_id, thread_id, req, body).await
}
#[post("/{org_id}/v1/traces")]
pub async fn otlp_traces_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    handle_req(org_id, thread_id, req, body).await
}

async fn handle_req(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    let in_stream_name = req
        .headers()
        .get(&CONFIG.grpc.stream_header_key)
        .map(|header| header.to_str().unwrap());
    if content_type.eq(CONTENT_TYPE_PROTO) {
        otlp_http::traces_proto(&org_id, **thread_id, body, in_stream_name).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        otlp_http::traces_json(&org_id, **thread_id, body, in_stream_name).await
    } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Bad Request".to_string(),
            )),
        )
    }
}

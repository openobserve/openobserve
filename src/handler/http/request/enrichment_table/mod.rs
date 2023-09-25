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

use actix_multipart::Multipart;
use actix_web::{http, post, web, HttpRequest, HttpResponse};
use std::io::Error;

use crate::common::infra::config::{CONFIG, SIZE_IN_MB};
use crate::{common::meta, service::enrichment_table::save_enrichment_data};

/** CreateEnrichmentTable */
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "CreateEnrichmentTable",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("table_name" = String, Path, description = "Table name"),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Saved enrichment table", body = HttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = HttpResponse),
    ),
)]
#[post("/{org_id}/enrichment_tables/{table_name}")]
pub async fn save_enrichment_table(
    path: web::Path<(String, String)>,
    payload: Multipart,
    req: HttpRequest,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let (org_id, table_name) = path.into_inner();
    let content_type = req.headers().get("content-type");
    let content_length = match req.headers().get("content-length") {
        None => 0.0,
        Some(content_length) => {
            content_length
                .to_str()
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0)
                / SIZE_IN_MB
        }
    };
    if content_length > CONFIG.limit.enrichment_table_limit as f64 {
        return Ok(bad_request(&format!(
            "exceeds allowed limit of {} mb",
            CONFIG.limit.enrichment_table_limit
        )));
    }
    match content_type {
        Some(content_type) => {
            if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("multipart/form-data")
            {
                save_enrichment_data(&org_id, &table_name, payload, **thread_id).await
            } else {
                Ok(bad_request(
                    "Bad Request, content-type must be multipart/form-data",
                ))
            }
        }
        None => Ok(bad_request(
            "Bad Request, content-type must be multipart/form-data",
        )),
    }
}

fn bad_request(message: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
        http::StatusCode::BAD_REQUEST.into(),
        message.to_string(),
    ))
}

// Copyright 2024 OpenObserve Inc.
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

use actix_http::StatusCode;
use actix_multipart::Multipart;
use actix_web::{post, web, HttpRequest, HttpResponse};
use config::SIZE_IN_MB;
use hashbrown::HashMap;
use url::Url;

use crate::{
    common::meta::{enrichment_table::EnrichmentTableReq, http::HttpResponse as MetaHttpResponse},
    service::enrichment_table::{
        add_task, store_file_to_disk, store_multipart_to_disk, task_ready,
    },
};

/// CreateEnrichmentTable
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "CreateUpdateEnrichmentTable",
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
    body: web::Bytes,
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
    let cfg = config::get_config();
    if content_length > cfg.limit.enrichment_table_limit as f64 {
        return Ok(MetaHttpResponse::bad_request(format!(
            "exceeds allowed limit of {} mb",
            cfg.limit.enrichment_table_limit
        )));
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let append_data = match query.get("append") {
        Some(append_data) => append_data.parse::<bool>().unwrap_or(false),
        None => false,
    };
    match content_type {
        Some(content_type) => {
            if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("multipart/form-data")
            {
                let (task_id, key) = add_task(&org_id, &table_name, append_data, None).await?;
                match store_multipart_to_disk(&key, payload).await {
                    Ok(_) => {
                        task_ready(&task_id).await?;
                        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                            StatusCode::OK.into(),
                            format!("Saved enrichment table to disk, task_id: {}", task_id),
                        )))
                    }
                    Err(error) => {
                        let err_msg = format!(
                            "[task_id: {}] Failed to save enrichment table: {}",
                            task_id, error
                        );
                        log::error!("{}", err_msg);
                        Ok(
                            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                                StatusCode::INTERNAL_SERVER_ERROR.into(),
                                err_msg,
                            )),
                        )
                    }
                }
            } else if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("application/json")
            {
                let req: EnrichmentTableReq = match serde_json::from_slice(&body) {
                    Ok(req) => req,
                    Err(_) => {
                        return Ok(MetaHttpResponse::bad_request(
                            "Bad Request, req body must be a valid JSON",
                        ))
                    }
                };
                let Some(ref file_link) = req.file_link else {
                    return Ok(MetaHttpResponse::bad_request(
                        "Bad Request, file_link missing",
                    ));
                };

                // Validate the file link
                if Url::parse(file_link).is_err() {
                    return Ok(MetaHttpResponse::bad_request("Invalid file link provided"));
                }

                let (task_id, key) =
                    add_task(&org_id, &table_name, append_data, req.file_link.clone()).await?;
                match store_file_to_disk(&key, file_link).await {
                    Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                        StatusCode::OK.into(),
                        format!("Saved enrichment table to disk, task_id: {}", task_id),
                    ))),
                    Err(error) => {
                        log::error!(
                            "[ENRICHMENT_TABLE] Failed to save enrichment table: {}",
                            error
                        );
                        Ok(
                            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                                StatusCode::INTERNAL_SERVER_ERROR.into(),
                                format!("Failed to save enrichment table: {}", error),
                            )),
                        )
                    }
                }
            } else {
                Ok(MetaHttpResponse::bad_request(
                    "Bad Request, content-type must be multipart/form-data",
                ))
            }
        }
        None => Ok(MetaHttpResponse::bad_request(
            "Bad Request, content-type must be multipart/form-data",
        )),
    }
}

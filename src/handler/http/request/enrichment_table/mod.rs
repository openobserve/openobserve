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

use actix_multipart::Multipart;
use actix_web::{HttpRequest, HttpResponse, post, web};
use config::SIZE_IN_MB;
use hashbrown::HashMap;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::enrichment_table::{extract_multipart, save_enrichment_data},
};

/// CreateEnrichmentTable
///
/// #{"ratelimit_module":"Enrichment Table", "ratelimit_module_operation":"create"}#
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
) -> Result<HttpResponse, Error> {
    let (org_id, table_name) = path.into_inner();

    let bad_req_msg = if org_id.trim().is_empty() {
        Some("Organization cannot be empty")
    } else if table_name.trim().is_empty() {
        Some("Table name cannot be empty")
    } else {
        None
    };

    if let Some(msg) = bad_req_msg {
        return Ok(MetaHttpResponse::bad_request(msg));
    }
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
    log::debug!(
        "Enrichment table {} content length in mb: {}, max size in mb: {}",
        table_name,
        content_length,
        cfg.limit.enrichment_table_max_size
    );
    if content_length > cfg.limit.enrichment_table_max_size as f64 {
        return Ok(MetaHttpResponse::bad_request(format!(
            "exceeds allowed limit of {} mb",
            cfg.limit.enrichment_table_max_size
        )));
    }
    match content_type {
        Some(content_type) => {
            if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("multipart/form-data")
            {
                let query =
                    web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
                let append_data = match query.get("append") {
                    Some(append_data) => append_data.parse::<bool>().unwrap_or(false),
                    None => false,
                };
                let json_record = extract_multipart(payload, append_data).await?;
                save_enrichment_data(&org_id, &table_name, json_record, append_data).await
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

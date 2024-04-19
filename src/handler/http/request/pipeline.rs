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

use std::{collections::HashMap, io::Error};

use actix_web::{delete, get, http, post, put, web, HttpRequest, HttpResponse};

use crate::common::{meta, meta::pipelines::PipeLine, utils::http::get_stream_type_from_request};

/// CreatePipeline
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "createPipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = PipeLine, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/pipelines")]
pub async fn save_pipeline(
    path: web::Path<String>,
    pipeline: web::Json<PipeLine>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let mut pipeline = pipeline.into_inner();
    pipeline.name = pipeline.name.trim().to_string();
    crate::service::pipelines::save_pipeline(org_id, pipeline).await
}

/// ListPipelines
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "listPipelines",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PipelineList),
    )
)]
#[get("/{org_id}/pipelines")]
async fn list_pipelines(
    org_id: web::Path<String>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = _req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            "pipeline",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return Ok(crate::common::meta::http::HttpResponse::forbidden(
                    e.to_string(),
                ));
            }
        }
        // Get List of allowed objects ends
    }

    crate::service::pipelines::list_pipelines(org_id.into_inner(), _permitted).await
}

/// DeletePipeline
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "deletePipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Pipeline name"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/pipelines/{name}")]
async fn delete_pipeline(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    crate::service::pipelines::delete_pipeline(org_id, name).await
}

/// UpdatePipeline
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "updatePipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Pipeline name"),
    ),
    request_body(content = PipeLine, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/pipelines/{name}")]
pub async fn update_pipeline(
    path: web::Path<(String, String)>,
    pipeline: web::Json<PipeLine>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let name = name.trim();
    let mut pipeline = pipeline.into_inner();
    pipeline.name = pipeline.name.trim().to_string();

    crate::service::pipelines::update_pipeline(&org_id, name, pipeline).await
}

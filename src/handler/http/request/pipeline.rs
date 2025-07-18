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

use actix_web::{HttpRequest, HttpResponse, delete, get, http, post, put, web};
use ahash::HashMap;
use config::{ider, meta::pipeline::Pipeline};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::pipelines::PipelineList,
    service::{db::pipeline::PipelineError, pipeline},
};

impl From<PipelineError> for HttpResponse {
    fn from(value: PipelineError) -> Self {
        match value {
            PipelineError::InfraError(err) => MetaHttpResponse::internal_error(err),
            PipelineError::NotFound(_) => MetaHttpResponse::not_found(value),
            PipelineError::Modified(_) => MetaHttpResponse::conflict(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}

/// CreatePipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipeline",
    operation_id = "createPipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Pipeline, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/pipelines")]
pub async fn save_pipeline(
    path: web::Path<String>,
    pipeline: web::Json<Pipeline>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let mut pipeline = pipeline.into_inner();
    pipeline.name = pipeline.name.trim().to_lowercase();
    pipeline.org = org_id;
    pipeline.id = ider::generate();
    match pipeline::save_pipeline(pipeline).await {
        Ok(()) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Pipeline created successfully",
        ))),
        Err(e) => Ok(e.into()),
    }
}

/// ListPipelines
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"list"}#
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
    let org_id = org_id.into_inner();
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        let user_id = _req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            OFGA_MODELS
                .get("pipelines")
                .map_or("pipelines", |model| model.key),
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

    let pipelines = match pipeline::list_pipelines(&org_id, _permitted).await {
        Ok(pipelines) => pipelines,
        Err(e) => return Ok(e.into()),
    };

    let pipeline_triggers = match pipeline::list_pipeline_triggers(&org_id).await {
        Ok(pipelines) => pipelines,
        Err(e) => return Ok(e.into()),
    };

    Ok(HttpResponse::Ok().json(PipelineList::from(pipelines, pipeline_triggers)))
}

/// GetStreamsWithPipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "getStreamsWithPipeline",
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
#[get("/{org_id}/pipelines/streams")]
async fn list_streams_with_pipeline(
    path: web::Path<String>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match pipeline::list_streams_with_pipeline(&org_id).await {
        Ok(stream_params) => Ok(HttpResponse::Ok().json(stream_params)),
        Err(e) => Ok(e.into()),
    }
}

/// DeletePipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "deletePipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/pipelines/{pipeline_id}")]
async fn delete_pipeline(
    path: web::Path<(String, String)>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (_org_id, pipeline_id) = path.into_inner();
    match pipeline::delete_pipeline(&pipeline_id).await {
        Ok(()) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Pipeline deleted successfully",
        ))),
        Err(e) => Ok(e.into()),
    }
}

/// UpdatePipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "updatePipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Pipeline, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/pipelines")]
pub async fn update_pipeline(
    pipeline: web::Json<Pipeline>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let pipeline = pipeline.into_inner();
    match pipeline::update_pipeline(pipeline).await {
        Ok(()) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Pipeline updated successfully",
        ))),
        Err(e) => Ok(e.into()),
    }
}

/// EnablePipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "enablePipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("value" = bool, Query, description = "Enable or disable pipeline"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/pipelines/{pipeline_id}/enable")]
pub async fn enable_pipeline(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, pipeline_id) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let resp_msg =
        "Pipeline successfully ".to_string() + if enable { "enabled" } else { "disabled" };
    match pipeline::enable_pipeline(&org_id, &pipeline_id, enable).await {
        Ok(()) => {
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(http::StatusCode::OK, resp_msg)))
        }
        Err(e) => Ok(e.into()),
    }
}

/// PauseScheduledPipeline
///
/// #{"ratelimit_module":"Pipeline", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "pauseScheduledPipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("value" = bool, Query, description = "Pause or unpause pipeline"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/pipelines/{pipeline_id}/pause")]
pub async fn pause_pipeline(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, pipeline_id) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let pause = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let resp_msg = "Pipeline successfully ".to_string() + if pause { "paused" } else { "unpaused" };
    match pipeline::pause_pipeline(&org_id, &pipeline_id, pause).await {
        Ok(()) => {
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(http::StatusCode::OK, resp_msg)))
        }
        Err(e) => Ok(e.into()),
    }
}

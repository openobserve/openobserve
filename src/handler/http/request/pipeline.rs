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

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_resource_permissions;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::pipelines::{
        PipelineBulkEnableRequest, PipelineBulkEnableResponse, PipelineList,
    },
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

#[utoipa::path(
    context_path = "/api",
    tag = "Pipeline",
    operation_id = "createPipeline",
    summary = "Create new pipeline",
    description = "Creates a new data processing pipeline with specified transformations and routing rules. Pipelines define how incoming data is processed before storage",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Pipeline, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"}))
    )
)]
#[post("/{org_id}/pipelines")]
pub async fn save_pipeline(
    path: web::Path<String>,
    pipeline: web::Json<Pipeline>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let mut pipeline = pipeline.into_inner();
    pipeline.name = pipeline.name.trim().to_lowercase();
    pipeline.org = org_id;
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let overwrite = match query.get("overwrite") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    if !overwrite {
        pipeline.id = ider::generate();
    }
    match pipeline::save_pipeline(pipeline).await {
        Ok(()) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Pipeline created successfully",
        ))),
        Err(e) => Ok(e.into()),
    }
}

/// ListPipelines

#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "listPipelines",
    summary = "List organization pipelines",
    description = "Retrieves all data processing pipelines configured for the organization, including their status and associated triggers",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PipelineList),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"}))
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

#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "getStreamsWithPipeline",
    summary = "Get streams with pipelines",
    description = "Retrieves a list of streams that have associated data processing pipelines, showing the relationship between streams and their transformation rules",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PipelineList),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"}))
    )
)]
#[get("/{org_id}/pipelines/streams")]
async fn list_streams_with_pipeline(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match pipeline::list_streams_with_pipeline(&org_id).await {
        Ok(stream_params) => Ok(HttpResponse::Ok().json(stream_params)),
        Err(e) => Ok(e.into()),
    }
}

/// DeletePipeline

#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "deletePipeline",
    summary = "Delete pipeline",
    description = "Permanently deletes a data processing pipeline. This will stop any ongoing data transformations using this pipeline",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/pipelines/{pipeline_id}")]
async fn delete_pipeline(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
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

#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "updatePipeline",
    summary = "Update pipeline",
    description = "Updates an existing data processing pipeline with new transformation rules, routing configurations, or other settings",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Pipeline, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"}))
    )
)]
#[put("/{org_id}/pipelines")]
pub async fn update_pipeline(pipeline: web::Json<Pipeline>) -> Result<HttpResponse, Error> {
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

#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "enablePipeline",
    summary = "Enable or disable pipeline",
    description = "Enables or disables a data processing pipeline. Disabled pipelines will not process incoming data until re-enabled",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("value" = bool, Query, description = "Enable or disable pipeline"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"}))
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
    let starts_from_now = match query.get("from_now") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let resp_msg =
        "Pipeline successfully ".to_string() + if enable { "enabled" } else { "disabled" };
    match pipeline::enable_pipeline(&org_id, &pipeline_id, enable, starts_from_now).await {
        Ok(()) => {
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(http::StatusCode::OK, resp_msg)))
        }
        Err(e) => Ok(e.into()),
    }
}

/// EnablePipelineBulk
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "enablePipelineBulk",
    summary = "Enable or disable pipeline in bulk",
    description = "Enables or disables data processing pipelines in bulk. Disabled pipelines will not process incoming data until re-enabled",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("value" = bool, Query, description = "Enable or disable pipeline"),
    ),
    request_body(content = Object, description = "Pipeline id list", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"}))
    )
)]
#[post("/{org_id}/pipelines/bulk/enable")]
pub async fn enable_pipeline_bulk(
    path: web::Path<String>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let starts_from_now = match query.get("from_now") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let req: PipelineBulkEnableRequest = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return Ok(MetaHttpResponse::bad_request("invalid body")),
    };

    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        for id in &req.ids {
            if let Some(res) =
                check_resource_permissions(&org_id, &user_id, "pipelines", id, "PUT").await
            {
                return Ok(res);
            }
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for id in req.ids {
        match pipeline::enable_pipeline(&org_id, &id, enable, starts_from_now).await {
            Ok(()) => {
                successful.push(id);
            }
            Err(e) => {
                log::error!("error in enabling pipeline {id} : {e}");
                err = Some(e.to_string());
                unsuccessful.push(id);
            }
        }
    }
    Ok(MetaHttpResponse::json(PipelineBulkEnableResponse {
        successful,
        unsuccessful,
        err,
    }))
}

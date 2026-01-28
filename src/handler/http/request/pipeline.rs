// Copyright 2026 OpenObserve Inc.
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

use ahash::HashMap;
use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use config::{ider, meta::pipeline::Pipeline};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::pipelines::{PipelineBulkEnableRequest, PipelineBulkEnableResponse, PipelineList},
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    service::{db::pipeline::PipelineError, pipeline},
};

impl From<PipelineError> for Response {
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
    post,
    path = "/{org_id}/pipelines",
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "createPipeline",
    summary = "Create new pipeline",
    description = "Creates a new data processing pipeline with specified transformations and routing rules. Pipelines define how incoming data is processed before storage",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(Pipeline), description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
        ("x-o2-mcp" = json!({
            "description": r#"Create a data pipeline for processing and transforming data streams.

PIPELINE STRUCTURE:
- name: Pipeline name (required, lowercase)
- source: { "source_type": "realtime" } for real-time pipelines
- nodes: Array of processing nodes (required)
- edges: Array of connections between nodes (required)

NODE STRUCTURE (each node requires):
- id: Unique identifier (use UUID format)
- io_type: MUST be one of: "input" (source stream), "output" (destination stream), "default" (processing node like function/condition)
- position: { "x": number, "y": number } for visual layout
- data: Node configuration (structure depends on node_type)

NODE DATA TYPES:
1. Stream node (input/output): { "node_type": "stream", "org_id": "default", "stream_name": "your_stream", "stream_type": "logs"|"metrics"|"traces" }
2. Function node: { "node_type": "function", "name": "function_name", "after_flatten": true|false }
3. Condition node: { "node_type": "condition", "conditions": { "column": "field", "operator": "=", "value": "val" } }

EDGE STRUCTURE:
- id: Format "e{source_id}-{target_id}"
- source: Source node id
- target: Target node id

EXAMPLE - Simple pipeline with function:
{
  "name": "my_pipeline",
  "source": { "source_type": "realtime" },
  "nodes": [
    { "id": "input-1", "io_type": "input", "position": {"x": 100, "y": 100}, "data": {"node_type": "stream", "org_id": "default", "stream_name": "source_stream", "stream_type": "logs"} },
    { "id": "func-1", "io_type": "default", "position": {"x": 100, "y": 200}, "data": {"node_type": "function", "name": "my_function", "after_flatten": true} },
    { "id": "output-1", "io_type": "output", "position": {"x": 100, "y": 300}, "data": {"node_type": "stream", "org_id": "default", "stream_name": "dest_stream", "stream_type": "logs"} }
  ],
  "edges": [
    { "id": "einput-1-func-1", "source": "input-1", "target": "func-1" },
    { "id": "efunc-1-output-1", "source": "func-1", "target": "output-1" }
  ]
}"#,
            "category": "pipelines"
        }))
    )
)]
pub async fn save_pipeline(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(mut pipeline): Json<Pipeline>,
) -> Response {
    pipeline.name = pipeline.name.trim().to_lowercase();
    pipeline.org = org_id;

    let overwrite = query
        .get("overwrite")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();
    if !overwrite {
        pipeline.id = ider::generate();
    }
    match pipeline::save_pipeline(pipeline).await {
        Ok(()) => MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            "Pipeline created successfully",
        )),
        Err(e) => e.into(),
    }
}

/// ListPipelines

#[utoipa::path(
    get,
    path = "/{org_id}/pipelines",
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(PipelineList)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all pipelines", "category": "pipelines"}))
    )
)]
pub async fn list_pipelines(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    #[cfg(not(feature = "enterprise"))] Headers(_user_email): Headers<UserEmail>,
) -> Response {
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
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
                return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    let pipelines = match pipeline::list_pipelines(&org_id, _permitted).await {
        Ok(pipelines) => pipelines,
        Err(e) => return e.into(),
    };

    let pipeline_triggers = match pipeline::list_pipeline_triggers(&org_id).await {
        Ok(pipelines) => pipelines,
        Err(e) => return e.into(),
    };

    // Fetch pipeline errors from DB
    let pipeline_errors = match crate::service::db::pipeline_errors::list_by_org(&org_id).await {
        Ok(errors) => errors
            .into_iter()
            .map(|error| {
                (
                    error.pipeline_id.clone(),
                    crate::handler::http::models::pipelines::PipelineErrorInfo {
                        last_error_timestamp: error.last_error_timestamp,
                        error_summary: error.error_summary,
                        node_errors: error.node_errors,
                    },
                )
            })
            .collect::<std::collections::HashMap<_, _>>(),
        Err(e) => {
            log::error!("[Pipeline] Failed to fetch pipeline errors: {}", e);
            std::collections::HashMap::default() // Continue without errors if DB fetch fails
        }
    };

    MetaHttpResponse::json(PipelineList::from(
        pipelines,
        pipeline_triggers,
        pipeline_errors,
    ))
}

/// GetStreamsWithPipeline

#[utoipa::path(
    get,
    path = "/{org_id}/pipelines/streams",
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(PipelineList)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List streams using pipelines", "category": "pipelines"}))
    )
)]
pub async fn list_streams_with_pipeline(Path(org_id): Path<String>) -> Response {
    match pipeline::list_streams_with_pipeline(&org_id).await {
        Ok(stream_params) => MetaHttpResponse::json(stream_params),
        Err(e) => e.into(),
    }
}

/// DeletePipeline

#[utoipa::path(
    delete,
    path = "/{org_id}/pipelines/{pipeline_id}",
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
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a pipeline", "category": "pipelines"}))
    )
)]
pub async fn delete_pipeline(Path((_org_id, pipeline_id)): Path<(String, String)>) -> Response {
    match pipeline::delete_pipeline(&pipeline_id).await {
        Ok(()) => MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            "Pipeline deleted successfully",
        )),
        Err(e) => e.into(),
    }
}

/// DeletePipelineBulk

#[utoipa::path(
    delete,
    path = "/{org_id}/pipelines/bulk",
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "deletePipelineBulk",
    summary = "Delete multiple pipelines",
    description = "Permanently deletes multiple data processing pipelines. This will stop any ongoing data transformations using these pipelines",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_pipeline_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if !check_permissions(id, &org_id, &_user_id, "pipelines", "DELETE", None).await {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for id in req.ids {
        match pipeline::delete_pipeline(&id).await {
            Ok(()) => {
                successful.push(id);
            }
            Err(e) => {
                log::error!("error deleting pipeline {org_id}/{id} : {e}");
                unsuccessful.push(id);
                err = Some(e.to_string());
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// UpdatePipeline

#[utoipa::path(
    put,
    path = "/{org_id}/pipelines",
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
    request_body(content = inline(Pipeline), description = "Pipeline data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"})),
        ("x-o2-mcp" = json!({
            "description": "Update an existing pipeline. Uses the same schema as createPipeline - include pipeline_id and version from the existing pipeline. See createPipeline for full node/edge structure documentation.",
            "category": "pipelines"
        }))
    )
)]
pub async fn update_pipeline(Json(pipeline): Json<Pipeline>) -> Response {
    match pipeline::update_pipeline(pipeline).await {
        Ok(()) => MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            "Pipeline updated successfully",
        )),
        Err(e) => e.into(),
    }
}

/// EnablePipeline

#[utoipa::path(
    put,
    path = "/{org_id}/pipelines/{pipeline_id}/enable",
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
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Enable or disable a pipeline", "category": "pipelines"}))
    )
)]
pub async fn enable_pipeline(
    Path((org_id, pipeline_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();

    let starts_from_now = query
        .get("from_now")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();

    match pipeline::enable_pipeline(&org_id, &pipeline_id, enable, starts_from_now).await {
        Ok(()) => {
            let resp_msg = format!(
                "Pipeline successfully {}",
                if enable { "enabled" } else { "disabled" }
            );
            MetaHttpResponse::json(MetaHttpResponse::message(StatusCode::OK, resp_msg))
        }
        Err(e) => e.into(),
    }
}

/// EnablePipelineBulk
#[utoipa::path(
    post,
    path = "/{org_id}/pipelines/bulk/enable",
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
    request_body(content = inline(PipelineBulkEnableRequest), description = "Pipeline id list", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn enable_pipeline_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(_user_email): Headers<UserEmail>,
    Json(req): Json<PipelineBulkEnableRequest>,
) -> Response {
    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();
    let starts_from_now = query
        .get("from_now")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();

    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;

        for id in &req.ids {
            if !check_permissions(id, &org_id, &user_id, "pipelines", "PUT", None).await {
                return MetaHttpResponse::forbidden("Unauthorized Access");
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
    MetaHttpResponse::json(PipelineBulkEnableResponse {
        successful,
        unsuccessful,
        err,
    })
}

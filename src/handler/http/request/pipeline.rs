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

use actix_web::{
    HttpResponse, delete, get, http, post, put,
    web::{self, Json, Query},
};
use ahash::HashMap;
use config::{ider, meta::pipeline::Pipeline};

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_resource_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::pipelines::{PipelineBulkEnableRequest, PipelineBulkEnableResponse, PipelineList},
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
3. Condition node (MUST use version 2): { "node_type": "condition", "version": 2, "conditions": <group> }

CONDITION FORMAT (version 2):
The conditions field is a group containing a flat array of items. Each item has a logicalOperator field (AND/OR) — this is the boolean connector BEFORE that item. The first item's logicalOperator is ignored but must be present (use AND). AND has higher precedence than OR. Use nested groups for explicit parentheses.
- Group: { "filterType": "group", "logicalOperator": "AND", "conditions": [...] }
- Condition: { "filterType": "condition", "column": "field", "operator": "<op>", "value": "val", "logicalOperator": "AND"|"OR" }
- Operators: =, !=, >, >=, <, <=, contains, not_contains

EXAMPLE - status = "error" AND (level > 5 OR source = "nginx"):
{ "node_type": "condition", "version": 2, "conditions": { "filterType": "group", "logicalOperator": "AND", "conditions": [{ "filterType": "condition", "column": "status", "operator": "=", "value": "error", "logicalOperator": "AND" }, { "filterType": "group", "logicalOperator": "AND", "conditions": [{ "filterType": "condition", "column": "level", "operator": ">", "value": "5", "logicalOperator": "OR" }, { "filterType": "condition", "column": "source", "operator": "=", "value": "nginx", "logicalOperator": "OR" }] }] } }

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
#[post("/{org_id}/pipelines")]
pub async fn save_pipeline(
    path: web::Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(mut pipeline): Json<Pipeline>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(PipelineList)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all pipelines", "category": "pipelines"}))
    )
)]
#[get("/{org_id}/pipelines")]
async fn list_pipelines(
    org_id: web::Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
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

    Ok(HttpResponse::Ok().json(PipelineList::from(
        pipelines,
        pipeline_triggers,
        pipeline_errors,
    )))
}

/// GetPipeline

#[utoipa::path(
    get,
    path = "/{org_id}/pipelines/{pipeline_id}",
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "getPipeline",
    summary = "Get pipeline by ID",
    description = "Retrieves the details of a specific data processing pipeline by its ID, including its status, trigger info, and any recent errors",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(crate::handler::http::models::pipelines::Pipeline)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get pipeline details by ID", "category": "pipelines"}))
    )
)]
#[get("/{org_id}/pipelines/{pipeline_id}")]
pub async fn get_pipeline(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, pipeline_id) = path.into_inner();
    let meta_pipeline = match crate::service::db::pipeline::get_by_id(&pipeline_id).await {
        Ok(pipeline) => pipeline,
        Err(e) => return Ok(e.into()),
    };

    // Get paused_at from trigger if this is a scheduled pipeline
    let paused_at = if let Some(derived_stream) = meta_pipeline.get_derived_stream() {
        let module_key =
            derived_stream.get_scheduler_module_key(&meta_pipeline.name, &meta_pipeline.id);
        match crate::service::db::scheduler::get(
            &meta_pipeline.org,
            config::meta::triggers::TriggerModule::DerivedStream,
            &module_key,
        )
        .await
        {
            Ok(trigger) => trigger.end_time,
            Err(_) => None,
        }
    } else {
        None
    };

    // Get last error info
    let last_error =
        match crate::service::db::pipeline_errors::get_by_pipeline_id(&pipeline_id).await {
            Ok(Some(error)) => Some(crate::handler::http::models::pipelines::PipelineErrorInfo {
                last_error_timestamp: error.last_error_timestamp,
                error_summary: error.error_summary,
                node_errors: error.node_errors,
            }),
            _ => None,
        };

    Ok(MetaHttpResponse::json(
        crate::handler::http::models::pipelines::Pipeline::from(
            meta_pipeline,
            paused_at,
            last_error,
        ),
    ))
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(PipelineList)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List streams using pipelines", "category": "pipelines"}))
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
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a pipeline", "category": "pipelines", "requires_confirmation": true}))
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
#[put("/{org_id}/pipelines")]
pub async fn update_pipeline(
    org_id: web::Path<String>,
    Json(mut pipeline): Json<Pipeline>,
) -> Result<HttpResponse, Error> {
    pipeline.org = org_id.into_inner();
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
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Enable or disable a pipeline", "category": "pipelines"}))
    )
)]
#[put("/{org_id}/pipelines/{pipeline_id}/enable")]
pub async fn enable_pipeline(
    path: web::Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let (org_id, pipeline_id) = path.into_inner();

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
#[post("/{org_id}/pipelines/bulk/enable")]
pub async fn enable_pipeline_bulk(
    path: web::Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(req): Json<PipelineBulkEnableRequest>,
    Headers(_user_email): Headers<UserEmail>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
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

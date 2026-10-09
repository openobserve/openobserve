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
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::pipelines::{PipelineBulkEnableRequest, PipelineBulkEnableResponse, PipelineList},
    request::{BulkDeleteRequest, BulkDeleteResponse},
    service::pipeline,
};

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
3. Condition node (MUST use version 2): { "node_type": "condition", "version": 2, "conditions": <group> }

CONDITION FORMAT (version 2):
The conditions field is a group containing a flat array of items. Each item has a logicalOperator field (AND/OR) — this is the boolean connector BEFORE that item. The first item's logicalOperator is ignored but must be present (use AND). AND has higher precedence than OR. Use nested groups for explicit parentheses.
- Group: { "filterType": "group", "logicalOperator": "AND", "conditions": [...] }
- Condition: { "filterType": "condition", "column": "field", "operator": "<op>", "value": "val", "logicalOperator": "AND"|"OR" }
- Operators: =, !=, >, >=, <, <=, contains, not_contains, is_null, is_not_null, is_empty, is_not_empty (null/empty checks ignore "value"; pass an empty string. is_empty matches null OR empty string)

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
pub async fn save_pipeline(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(mut pipeline): Json<Pipeline>,
) -> Response {
    pipeline.name = pipeline.name.trim().to_lowercase();
    pipeline.org = org_id;
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_pipeline(&user_email.user_id, &pipeline).await {
        return resp;
    }

    let overwrite = query
        .get("overwrite")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();
    if !overwrite {
        pipeline.id = ider::generate();
    }
    let pipeline_id = pipeline.id.to_string();
    let pipeline_name = pipeline.name.clone();
    match pipeline::save_user_pipeline(pipeline).await {
        Ok(()) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Pipeline created successfully")
                .with_id(pipeline_id)
                .with_name(pipeline_name),
        ),
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
        ("x-o2-mcp" = json!({
            "description": "List all pipelines",
            "category": "pipelines",
            "summary_fields": ["pipeline_id", "name", "description", "enabled"]
        }))
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

        match openobserve_api_common::auth::validator::list_objects_for_user(
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
                return common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    let pipelines = match pipeline::list_user_pipelines(&org_id, _permitted).await {
        Ok(pipelines) => pipelines,
        Err(e) => return e.into(),
    };

    let pipeline_triggers = match pipeline::list_pipeline_triggers(&org_id).await {
        Ok(pipelines) => pipelines,
        Err(e) => return e.into(),
    };

    // Fetch pipeline errors from DB
    let pipeline_errors = match db::pipeline_errors::list_by_org(&org_id).await {
        Ok(errors) => errors
            .into_iter()
            .map(|error| {
                (
                    error.pipeline_id.clone(),
                    crate::models::pipelines::PipelineErrorInfo {
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(crate::models::pipelines::Pipeline)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get pipeline details by ID", "category": "pipelines"}))
    )
)]
pub async fn get_pipeline(Path((org_id, pipeline_id)): Path<(String, String)>) -> Response {
    let meta_pipeline = match pipeline::get_user_pipeline(&org_id, &pipeline_id).await {
        Ok(pipeline) => pipeline,
        Err(e) => return e.into(),
    };

    // Get paused_at from trigger if this is a scheduled pipeline
    let paused_at = if let Some(derived_stream) = meta_pipeline.get_derived_stream() {
        let module_key =
            derived_stream.get_scheduler_module_key(&meta_pipeline.name, &meta_pipeline.id);
        match db::scheduler::get(
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
    let last_error = match db::pipeline_errors::get_by_pipeline_id(&pipeline_id).await {
        Ok(Some(error)) => Some(crate::models::pipelines::PipelineErrorInfo {
            last_error_timestamp: error.last_error_timestamp,
            error_summary: error.error_summary,
            node_errors: error.node_errors,
        }),
        _ => None,
    };

    MetaHttpResponse::json(crate::models::pipelines::Pipeline::from(
        meta_pipeline,
        paused_at,
        last_error,
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
        ("x-o2-mcp" = json!({"description": "Delete a pipeline", "category": "pipelines", "requires_confirmation": true}))
    )
)]
pub async fn delete_pipeline(Path((org_id, pipeline_id)): Path<(String, String)>) -> Response {
    match pipeline::delete_user_pipeline(&org_id, &pipeline_id).await {
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
        if !check_permissions(
            id,
            &org_id,
            &_user_id,
            "pipelines",
            "DELETE",
            None,
            false,
            false,
            true,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for id in req.ids {
        match pipeline::delete_user_pipeline(&org_id, &id).await {
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
pub async fn update_pipeline(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(mut pipeline): Json<Pipeline>,
) -> Response {
    pipeline.org = org_id;
    let org_id = pipeline.org.clone();
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_pipeline(&user_email.user_id, &pipeline).await {
        return resp;
    }
    match pipeline::update_user_pipeline(&org_id, pipeline).await {
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();
    #[cfg(feature = "enterprise")]
    if enable {
        let guarded = match pipeline::get_user_pipeline(&org_id, &pipeline_id).await {
            Ok(stored) => guard_pipeline(&user_email.user_id, &stored).await,
            Err(e) => Err(Response::from(e)),
        };
        if let Err(resp) = guarded {
            return resp;
        }
    }

    let starts_from_now = query
        .get("from_now")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();

    match pipeline::enable_user_pipeline(&org_id, &pipeline_id, enable, starts_from_now).await {
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
        let user_id = &_user_email.user_id;

        for id in &req.ids {
            if !check_permissions(
                id,
                &org_id,
                user_id,
                "pipelines",
                "PUT",
                None,
                false,
                false,
                true,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for id in req.ids {
        #[cfg(feature = "enterprise")]
        if enable && let Some(message) = enable_denial(&org_id, &_user_email.user_id, &id).await {
            err = Some(message);
            unsuccessful.push(id);
            continue;
        }
        match pipeline::enable_user_pipeline(&org_id, &id, enable, starts_from_now).await {
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

#[cfg(feature = "enterprise")]
async fn guard_pipeline(user_id: &str, pipeline: &Pipeline) -> Result<(), Response> {
    if !openobserve_core::background_access::rbac_enforced().await {
        return Ok(());
    }
    let sources = openobserve_core::background_access::pipeline_sources(pipeline)
        .await
        .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
    openobserve_core::background_access::guard_write(&pipeline.org, user_id, &sources).await
}

/// A pipeline that cannot be read is reported as that id's error, never enabled unchecked.
#[cfg(feature = "enterprise")]
async fn enable_denial(org_id: &str, user_id: &str, id: &str) -> Option<String> {
    let loaded = match pipeline::get_user_pipeline(org_id, id).await {
        Ok(stored) => openobserve_core::background_access::pipeline_sources(&stored)
            .await
            .map(Some),
        Err(e) => Err(anyhow::anyhow!(e.to_string())),
    };
    openobserve_core::background_access::loaded_denial_message(org_id, user_id, loaded).await
}

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, response::Response};
    use openobserve_core::pipeline::db::PipelineError;

    fn status(err: PipelineError) -> StatusCode {
        Response::from(err).status()
    }

    // 404 Not Found
    #[test]
    fn test_not_found_is_not_found() {
        assert_eq!(
            status(PipelineError::NotFound("abc".to_string())),
            StatusCode::NOT_FOUND
        );
    }

    // 409 Conflict
    #[test]
    fn test_modified_is_conflict() {
        assert_eq!(
            status(PipelineError::Modified("abc".to_string())),
            StatusCode::CONFLICT
        );
    }

    // 400 Bad Request
    #[test]
    fn test_stream_in_use_is_bad_request() {
        assert_eq!(status(PipelineError::StreamInUse), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_pipeline_does_not_apply_is_bad_request() {
        assert_eq!(
            status(PipelineError::PipelineDoesNotApply),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_invalid_pipeline_is_bad_request() {
        assert_eq!(
            status(PipelineError::InvalidPipeline("bad config".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_invalid_derived_stream_is_bad_request() {
        assert_eq!(
            status(PipelineError::InvalidDerivedStream(
                "missing field".to_string()
            )),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_delete_derived_stream_is_bad_request() {
        assert_eq!(
            status(PipelineError::DeleteDerivedStream("failed".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    // 500 Internal Server Error
    #[test]
    fn test_infra_error_is_internal_server_error() {
        let err = infra::errors::Error::DbError(infra::errors::DbError::SeaORMError(
            "db down".to_string(),
        ));
        assert_eq!(
            status(PipelineError::InfraError(err)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[cfg(feature = "enterprise")]
    mod stream_access {
        use axum::{Json, body::to_bytes, extract::Query, http::StatusCode};
        use config::meta::{pipeline::Pipeline, stream::StreamType};
        use openobserve_api_common::extractors::Headers;
        use openobserve_core::{
            auth::UserEmail,
            authz::{TypedStream, fake_checker},
        };
        use serde_json::json;

        use super::super::*;

        fn user() -> String {
            format!("{}@example.com", config::ider::uuid())
        }

        fn pipeline(org: &str, source_org: &str, stream: &str) -> Pipeline {
            let mut pipeline: Pipeline = serde_json::from_value(json!({
                "name": "p1",
                "source": {
                    "source_type": "realtime",
                    "org_id": source_org,
                    "stream_name": stream,
                    "stream_type": "logs"
                },
                "nodes": [],
                "edges": []
            }))
            .unwrap();
            pipeline.org = org.to_string();
            pipeline
        }

        fn first_node_pipeline(source: serde_json::Value, input: &str) -> Pipeline {
            let node = |id: &str, stream: &str, io_type: &str| {
                json!({
                    "id": id,
                    "data": {
                        "node_type": "stream",
                        "org_id": "",
                        "stream_name": stream,
                        "stream_type": "logs"
                    },
                    "position": {"x": 0.0, "y": 0.0},
                    "io_type": io_type
                })
            };
            let mut body = json!({
                "name": "p1",
                "nodes": [node("n1", input, "input"), node("n2", "fp_out", "output")],
                "edges": [{"id": "e1", "source": "n1", "target": "n2"}]
            });
            if !source.is_null() {
                body["source"] = source;
            }
            let mut pipeline: Pipeline = serde_json::from_value(body).unwrap();
            pipeline.org = "sp_org1".to_string();
            pipeline
        }

        async fn message(resp: axum::response::Response) -> String {
            let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            body["message"].as_str().unwrap_or_default().to_string()
        }

        #[tokio::test]
        async fn pipeline_denied_source_is_refused() {
            fake_checker();
            let caller = user();
            let resp = save_pipeline(
                Path("sp_org1".to_string()),
                Query(HashMap::default()),
                Headers(UserEmail {
                    user_id: caller.clone(),
                }),
                Json(pipeline("ignored", "", "secret")),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
            // an empty source org is the pipeline's own org, named without a prefix
            assert_eq!(
                message(resp).await,
                "Unauthorized Access: no read permission on logs/secret"
            );
        }

        #[tokio::test]
        async fn pipeline_cross_org_source_needs_read() {
            fake_checker();
            let caller = user();
            let cross = pipeline("sp_org1", "sp_org2", "b_stream");
            let resp = guard_pipeline(&caller, &cross).await.unwrap_err();
            assert_eq!(
                message(resp).await,
                "Unauthorized Access: no read permission on sp_org2/logs/b_stream"
            );

            fake_checker().grant_read(
                &caller,
                &TypedStream {
                    org_id: "sp_org2".to_string(),
                    stream_type: StreamType::Logs,
                    name: "b_stream".to_string(),
                },
            );
            assert!(guard_pipeline(&caller, &cross).await.is_ok());
        }

        #[tokio::test]
        async fn pipeline_cross_org_source_refused_for_other_org_admin() {
            let admin = user();
            fake_checker().grant_admin("sp_org1", &admin);
            assert!(
                guard_pipeline(&admin, &pipeline("sp_org1", "", "own"))
                    .await
                    .is_ok()
            );
            assert!(
                guard_pipeline(&admin, &pipeline("sp_org1", "sp_org2", "b_stream"))
                    .await
                    .is_err()
            );

            fake_checker().grant_admin("sp_org2", &admin);
            assert!(
                guard_pipeline(&admin, &pipeline("sp_org1", "sp_org2", "b_stream"))
                    .await
                    .is_ok()
            );
        }

        #[tokio::test]
        async fn pipeline_source_is_its_first_node() {
            let caller = user();
            fake_checker().grant_read(
                &caller,
                &TypedStream {
                    org_id: "sp_org1".to_string(),
                    stream_type: StreamType::Logs,
                    name: "fp_in".to_string(),
                },
            );
            // an omitted or minimal source is rebuilt from the first node, never checked as logs/
            for source in [serde_json::Value::Null, json!({"source_type": "realtime"})] {
                let pipeline = first_node_pipeline(source, "fp_in");
                assert!(guard_pipeline(&caller, &pipeline).await.is_ok());
            }
            // a stale body source is discarded by validate(), so only the first node is read
            let stale = json!({
                "source_type": "realtime",
                "org_id": "",
                "stream_name": "fp_old",
                "stream_type": "logs"
            });
            assert!(
                guard_pipeline(&caller, &first_node_pipeline(stale, "fp_in"))
                    .await
                    .is_ok()
            );

            let resp = guard_pipeline(
                &caller,
                &first_node_pipeline(serde_json::Value::Null, "fp_secret"),
            )
            .await
            .unwrap_err();
            assert_eq!(
                message(resp).await,
                "Unauthorized Access: no read permission on logs/fp_secret"
            );
        }
    }
}

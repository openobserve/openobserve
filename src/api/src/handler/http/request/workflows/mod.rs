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

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use config::{
    ider,
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        self_reporting::{error::NodeErrors, usage::TRIGGERS_STREAM},
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::table::workflows::{Workflow, WorkflowAssociation, WorkflowRunErrors};
use openobserve_api_management::request::alerts::history::escape_like;
use openobserve_core::auth::UserEmail;
use search_service::{self as SearchService, query_range::get_settings_max_query_range};
use serde::{Deserialize, Serialize};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id},
    handler::http::extractors::Headers,
    service::workflows::{self, InputMap, WorkflowTriggerType},
};

#[derive(Deserialize)]
pub struct WorkflowTestInput {
    inputs: Vec<serde_json::Value>,
    #[serde(default)]
    from_node: Option<String>,
}

#[derive(Serialize)]
pub struct WorkflowTestResult {
    errors: HashMap<String, NodeErrors>,
}

#[derive(Serialize)]
pub struct WorkflowErrorList {
    errors: Vec<WorkflowRunErrors>,
}

#[derive(Deserialize)]
pub struct WorkflowRetryDetails {
    run_id: String,
    from_node: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowHistoryQuery {
    /// Start time in Unix timestamp microseconds
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds
    pub end_time: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkflowHistoryRow {
    _timestamp: i64,
    org: String,
    start_time: i64,
    end_time: i64,
    evaluation_took_in_secs: f64,
    source_node: String,
    key: String,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    event_type: WorkflowTriggerType,
    #[serde(default)]
    source_id: String,
    #[serde(default)]
    run_id: String,
}

#[derive(Serialize)]
pub struct WorkflowErrorResponse {
    errors: Option<WorkflowRunErrors>,
    data: Option<InputMap>,
}

#[derive(Serialize)]
pub struct WorkflowListItem {
    workflow: Workflow,
    associations: Vec<WorkflowAssociation>,
}

/// CreateWorkflow

#[utoipa::path(
    post,
    path = "/{org_id}/workflows",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "createWorkflow",
    summary = "Create new workflow",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    request_body(content = inline(Object), description = "Workflow data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn save_workflow(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(mut workflow): Json<Workflow>,
) -> Response {
    workflow.name = workflow.name.trim().to_lowercase();
    workflow.org_id = org_id;
    workflow.id = ider::generate();
    workflow.created_by = user_email.user_id;

    let id = workflow.id.to_string();
    let name = workflow.name.clone();
    match workflows::save_workflow(workflow).await {
        Ok(()) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Workflow created successfully")
                .with_id(id)
                .with_name(name),
        ),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// ListWorkflows

#[utoipa::path(
    get,
    path = "/{org_id}/workflows",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "listWorkflows",
    summary = "List organization workflows",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Object)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
    )
)]
pub async fn list_workflows(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &_user_email.user_id,
            "GET",
            OFGA_MODELS
                .get("workflows")
                .map_or("workflows", |model| model.key),
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

    let workflows = match workflows::list_workflows(&org_id, _permitted).await {
        Ok(workflows) => workflows,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let mut ret = Vec::with_capacity(workflows.len());
    for w in workflows {
        let associations = match workflows::get_workflow_associations(&org_id, &w.id).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "error getting workflow associations for {org_id}/{} : {e}",
                    w.id
                );
                continue;
            }
        };
        ret.push(WorkflowListItem {
            workflow: w,
            associations,
        });
    }
    MetaHttpResponse::json(ret)
}

/// DeleteWorkflows

#[utoipa::path(
    delete,
    path = "/{org_id}/workflows/{id}",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "deleteWorkflows",
    summary = "Delete workflows",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("workflow_id" = String, Path, description = "Workflow id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Object)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
    )
)]
pub async fn delete_workflows(Path((org_id, id)): Path<(String, String)>) -> Response {
    match workflows::delete_workflow(&org_id, &id).await {
        Ok(_) => MetaHttpResponse::ok("deleted successfully"),
        Err(e) => {
            log::error!("error deleting workflow {org_id}/{id} : {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

/// UpdateWorkflows

#[utoipa::path(
    put,
    path = "/{org_id}/workflows/{id}",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "updateWorkflows",
    summary = "Update workflows",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("workflow_id" = String, Path, description = "Workflow id"),
    ),
    request_body(content = inline(Object), description = "Workflow data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Object)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "list"})),
    )
)]
pub async fn update_workflows(
    Path((org_id, id)): Path<(String, String)>,
    Json(mut workflow): Json<Workflow>,
) -> Response {
    workflow.name = workflow.name.trim().to_lowercase();
    workflow.org_id = org_id.clone();

    if workflow.id != id {
        return MetaHttpResponse::bad_request("id mismatch in payload and path");
    }

    match workflows::get_workflow_by_id(&org_id, &id).await {
        Err(e) => {
            log::error!("error getting workflow {org_id}/{id} : {e}");
            return MetaHttpResponse::internal_error(e);
        }
        Ok(None) => {
            return MetaHttpResponse::bad_request("workflow with given id does not exist");
        }
        _ => {}
    };

    let id = workflow.id.to_string();
    let name = workflow.name.clone();
    match workflows::update_workflow(workflow).await {
        Ok(()) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Workflow updated successfully")
                .with_id(id)
                .with_name(name),
        ),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// TestWorkflow

#[utoipa::path(
    post,
    path = "/{org_id}/workflows/{id}/test",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "testWorkflow",
    summary = "Test an existing workflow with given input",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    request_body(content = inline(Object), description = "Workflow inputs", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn test_workflow(
    Path((org_id, workflow_id)): Path<(String, String)>,
    Json(inputs): Json<WorkflowTestInput>,
) -> Response {
    match workflows::test_workflow(&org_id, &workflow_id, inputs.inputs, inputs.from_node).await {
        Ok(v) => MetaHttpResponse::json(WorkflowTestResult { errors: v.errors }),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// ListWorkflowErrors

#[utoipa::path(
    get,
    path = "/{org_id}/workflows/{id}/errors/{run_id}",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "listWorkflowErrors",
    summary = "List Errored workflow with errors and inputs",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn get_workflow_errors(
    Path((org_id, workflow_id, run_id)): Path<(String, String, String)>,
) -> Response {
    let errors = match workflows::get_workflow_errors(&org_id, &workflow_id, &run_id).await {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    let errors = match errors {
        Some(v) => v,
        None => {
            return MetaHttpResponse::json(WorkflowErrorResponse {
                errors: None,
                data: None,
            });
        }
    };

    let data = match openobserve_core::workflows::get_error_input_data(&errors).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error getting input data for {org_id}/{workflow_id}/{run_id}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let data: InputMap = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(e) => {
            log::error!("error deserializing input data for {org_id}/{workflow_id}/{run_id}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    MetaHttpResponse::json(WorkflowErrorResponse {
        errors: Some(errors),
        data: Some(data),
    })
}

/// RetryWorkflowRun

#[utoipa::path(
    post,
    path = "/{org_id}/workflows/{id}/retry",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "retryWorkflowRun",
    summary = "Retry a particular failed workflow run",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    request_body(content = inline(Object), description = "retry details", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn retry_workflow(
    Path((org_id, workflow_id)): Path<(String, String)>,
    Json(details): Json<WorkflowRetryDetails>,
) -> Response {
    match workflows::retry_run(&org_id, &workflow_id, &details.run_id, details.from_node).await {
        Ok(v) => MetaHttpResponse::json(WorkflowTestResult { errors: v.errors }),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// EnableDisableWorkflowRun

#[utoipa::path(
    put,
    path = "/{org_id}/workflows/{id}/enable",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "enableDisableWorkflow",
    summary = "Enable or disable a particular workflow",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    request_body(content = inline(Object), description = "retry details", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn enable_workflow(
    Path((org_id, workflow_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let value = match query.get("value") {
        Some(v) => v.as_str(),
        None => "true",
    };

    let value: bool = value.parse().unwrap_or(true);

    match workflows::enable_disable_workflow(&org_id, &workflow_id, value).await {
        Ok(_) => MetaHttpResponse::ok("updated"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// GetWorkflowHistory

#[utoipa::path(
    get,
    path = "/{org_id}/workflows/{id}/history",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "getWorkflowHistory",
    summary = "Get history of workflow executions",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Pipeline", "operation": "create"})),
    )
)]
pub async fn get_workflow_history(
    Path((org_id, workflow_id)): Path<(String, String)>,
    Query(query): Query<WorkflowHistoryQuery>,
    Headers(user_email): Headers<UserEmail>,
    req: axum::http::Request<axum::body::Body>,
) -> Response {
    // Set default time range (last 7 days if not specified)
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let mut start_time = query.start_time.unwrap_or_else(|| {
        (chrono::Utc::now() - chrono::Duration::try_days(7).unwrap()).timestamp_micros()
    });

    // Check the max query range allowed on the triggers stream
    if let Some(settings) =
        infra::schema::get_settings(&org_id, TRIGGERS_STREAM, StreamType::Logs).await
    {
        let max_query_range = get_settings_max_query_range(
            settings.max_query_range,
            &org_id,
            Some(&user_email.user_id),
        )
        .await;
        if max_query_range > 0 && (end_time - start_time) > max_query_range * 3600 * 1_000_000 {
            start_time = end_time - max_query_range * 3600 * 1_000_000;
            log::warn!(
                "Start time for alert History api for org {org_id} updated as per max query range set for triggers stream"
            )
        }
    }

    // Validate time range
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }

    let trace_id = get_or_create_trace_id(req.headers(), &tracing::Span::current());

    let data_sql = format!(
        "SELECT _timestamp, org, key,  \
         start_time, end_time, \
         evaluation_took_in_secs, \
         source_node, error \
         FROM \"{TRIGGERS_STREAM}\" \
         WHERE module = 'workflow' AND org = '{org_id}' \
         AND key like '{}/%'\
         AND _timestamp >= {start_time} AND _timestamp <= {end_time}",
        escape_like(&workflow_id).replace("'", "''")
    );

    let data_req = SearchRequest {
        query: SearchQuery {
            sql: data_sql,
            start_time,
            end_time,
            from: 0,
            size: -1,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };

    // Execute search against organization's own triggers stream
    let search_result = match SearchService::search(
        &trace_id,
        &org_id,
        StreamType::Logs,
        Some(user_email.user_id.clone()),
        &data_req,
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") || msg.contains("stream not found") {
                return MetaHttpResponse::json(Vec::<WorkflowHistoryRow>::new());
            }
            log::error!("Failed to search alert history: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to search alert history: {e}"
            ));
        }
    };

    let results = search_result.hits;
    let parsed_results = match results
        .into_iter()
        .map(serde_json::from_value::<WorkflowHistoryRow>)
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in getting workflow history for {org_id}/{workflow_id} : {e}");
            return MetaHttpResponse::internal_error(format!(
                "Failed to search alert history: {e}"
            ));
        }
    };

    let ret: Vec<_> = parsed_results
        .into_iter()
        .map(|mut v| {
            let key_splits: Vec<_> = v.key.split("/").collect();

            if key_splits.len() < 4 {
                log::warn!(
                    "unexpected key for workflow history of {org_id}/{workflow_id} : {}",
                    v.key
                );
                return v;
            }

            v.run_id = key_splits[3].to_string();
            v.source_id = key_splits[2].to_string();
            v.event_type = WorkflowTriggerType::from(key_splits[1]);
            v
        })
        .collect();

    MetaHttpResponse::json(ret)
}

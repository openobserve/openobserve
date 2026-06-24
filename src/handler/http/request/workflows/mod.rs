use ahash::HashMap;
use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use config::ider;
use infra::table::workflows::Workflow;

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::pipelines::{PipelineBulkEnableRequest, PipelineBulkEnableResponse, PipelineList},
    },
    service::workflows,
};

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
    Query(query): Query<HashMap<String, String>>,
    Json(mut workflow): Json<Workflow>,
) -> Response {
    workflow.name = workflow.name.trim().to_lowercase();
    workflow.org_id = org_id;
    workflow.id = ider::generate();

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
                return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    let workflows = match workflows::list_workflows(&org_id, _permitted).await {
        Ok(workflows) => workflows,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    MetaHttpResponse::json(workflows)
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
    // TODO YJDoc2: check for workflow associations
    match workflows::delete_workflow(&id).await {
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

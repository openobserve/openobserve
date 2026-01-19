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

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::function::{FunctionList, TestVRLRequest, Transform};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    service::functions::FunctionDeleteError,
};

/// CreateFunction
#[utoipa::path(
    post,
    path = "/{org_id}/functions",
    context_path = "/api",
    tag = "Functions",
    operation_id = "createFunction",
    summary = "Create new function",
    description = "Creates a new custom transformation function using VRL (Vector Remap Language) code. Functions can be \
                   used in data ingestion pipelines to transform, enrich, or filter incoming log, metric, and trace data. \
                   Support complex data transformations, field extraction, format conversion, and conditional processing \
                   to standardize data before storage and indexing.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(Transform), description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a VRL (Vector Remap Language) function", "category": "functions"}))
    )
)]
pub async fn save_function(Path(org_id): Path<String>, Json(func): Json<Transform>) -> Response {
    let mut transform = func;
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    match crate::service::functions::save_function(org_id, transform).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// ListFunctions

#[utoipa::path(
    get,
    path = "/{org_id}/functions",
    context_path = "/api",
    tag = "Functions",
    operation_id = "listFunctions",
    summary = "List organization functions",
    description = "Retrieves all custom transformation functions available in the organization, including their VRL code, \
                   configuration parameters, and current usage status. Shows function metadata such as creation date, \
                   last modified time, and pipeline dependencies to help administrators manage data transformation \
                   logic across the organization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(FunctionList)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all functions", "category": "functions"}))
    )
)]
pub async fn list_functions(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "function",
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

    match crate::service::functions::list_functions(org_id, _permitted).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// DeleteFunction

#[utoipa::path(
    delete,
    path = "/{org_id}/functions/{name}",
    context_path = "/api",
    tag = "Functions",
    operation_id = "deleteFunction",
    summary = "Delete function",
    description = "Permanently deletes a custom transformation function from the organization. The function must not be \
                   in use by active pipelines unless the force parameter is specified. Once deleted, any pipelines \
                   previously using this function will need to be updated with alternative transformation logic to \
                   continue functioning properly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
        ("force" = bool, Query, description = "Force delete function regardless pipeline dependencies"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a function", "category": "functions"}))
    )
)]
pub async fn delete_function(Path((org_id, name)): Path<(String, String)>) -> Response {
    match crate::service::functions::delete_function(&org_id, &name).await {
        Ok(_) => (
            StatusCode::OK,
            Json(MetaHttpResponse::message(
                StatusCode::OK,
                "Function deleted",
            )),
        )
            .into_response(),
        Err(e) => match e {
            FunctionDeleteError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(MetaHttpResponse::error(
                    StatusCode::NOT_FOUND,
                    "Function not found",
                )),
            )
                .into_response(),
            FunctionDeleteError::FunctionInUse(e) => (
                StatusCode::BAD_REQUEST,
                Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
            )
                .into_response(),
            FunctionDeleteError::PipelineDependencies(e) => (
                StatusCode::CONFLICT,
                Json(MetaHttpResponse::error(StatusCode::CONFLICT, e)),
            )
                .into_response(),
        },
    }
}

/// DeleteFunctionBulk
#[utoipa::path(
    delete,
    path = "/{org_id}/functions/bulk",
    context_path = "/api",
    tag = "Functions",
    operation_id = "deleteFunctionBulk",
    summary = "Delete multiple function",
    description = "Permanently deletes multiple custom transformation functions from the organization. The functions must not be \
                   in use by active pipelines unless the force parameter is specified. Once deleted, any pipelines \
                   previously using this function will need to be updated with alternative transformation logic to \
                   continue functioning properly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "Function names to delete", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_function_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for name in &req.ids {
        if !check_permissions(name, &org_id, &_user_id, "functions", "DELETE", None).await {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match crate::service::functions::delete_function(&org_id, &name).await {
            Ok(_) | Err(FunctionDeleteError::NotFound) => {
                successful.push(name);
            }
            Err(FunctionDeleteError::FunctionInUse(e))
            | Err(FunctionDeleteError::PipelineDependencies(e)) => {
                log::error!("error in deleting function {org_id}/{name} : {e}");
                unsuccessful.push(name);
                err = Some(e);
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// UpdateFunction

#[utoipa::path(
    put,
    path = "/{org_id}/functions/{name}",
    context_path = "/api",
    tag = "Functions",
    operation_id = "updateFunction",
    summary = "Update function",
    description = "Updates an existing transformation function with new VRL code, parameters, or configuration settings. \
                   Changes take effect immediately and apply to all data processing pipelines currently using this \
                   function. Test function changes thoroughly before deployment to avoid data transformation errors \
                   in production pipelines.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = inline(Transform), description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a VRL function", "category": "functions"}))
    )
)]
pub async fn update_function(
    Path((org_id, name)): Path<(String, String)>,
    Json(func): Json<Transform>,
) -> Response {
    let name = name.trim();
    let mut transform = func;
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    match crate::service::functions::update_function(&org_id, name, transform).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// FunctionPipelineDependency

#[utoipa::path(
    get,
    path = "/{org_id}/functions/{name}",
    context_path = "/api",
    tag = "Functions",
    operation_id = "functionPipelineDependency",
    summary = "Get function pipeline dependencies",
    description = "Lists all data processing pipelines that currently use the specified transformation function. Returns \
                   pipeline names, types, and usage details to help administrators understand the impact scope before \
                   making changes to the function. Essential for change management and ensuring data processing \
                   continuity during function updates.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(FunctionList)),
        (status = 404, description = "Function not found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal server error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Check function dependencies", "category": "functions"}))
    )
)]
pub async fn list_pipeline_dependencies(
    Path((org_id, fn_name)): Path<(String, String)>,
) -> Response {
    match crate::service::functions::get_pipeline_dependencies(&org_id, &fn_name).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// Test a Function
#[utoipa::path(
    post,
    path = "/{org_id}/functions/test",
    context_path = "/api",
    tag = "Functions",
    operation_id = "testFunction",
    summary = "Test function execution",
    description = "Tests a VRL transformation function against sample events to validate the function logic and preview \
                   the expected output before deployment to production pipelines. Allows developers to verify data \
                   transformations, debug VRL code issues, and ensure correct field mappings without affecting live \
                   data processing workflows.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(TestVRLRequest), description = "Test run function", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
    )
)]
pub async fn test_function(
    Path(org_id): Path<String>,
    Json(req_body): Json<TestVRLRequest>,
) -> Response {
    let TestVRLRequest {
        function,
        events,
        trans_type,
    } = req_body;

    // test_run_function will auto-detect VRL vs JS if trans_type is None
    match crate::service::functions::test_run_function(&org_id, function, events, trans_type).await
    {
        Ok(result) => result,
        Err(err) => (StatusCode::BAD_REQUEST, err.to_string()).into_response(),
    }
}

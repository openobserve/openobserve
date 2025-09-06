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

use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
use config::meta::function::{FunctionList, TestVRLRequest, Transform};

/// CreateFunction

#[utoipa::path(
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
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "create"}))
    )
)]
#[post("/{org_id}/functions")]
pub async fn save_function(
    path: web::Path<String>,
    func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let mut transform = func.into_inner();
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    crate::service::functions::save_function(org_id, transform).await
}

/// ListFunctions

#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = FunctionList),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "list"}))
    )
)]
#[get("/{org_id}/functions")]
async fn list_functions(
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
            "function",
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

    crate::service::functions::list_functions(org_id.into_inner(), _permitted).await
}

/// DeleteFunction

#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/functions/{name}")]
async fn delete_function(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    crate::service::functions::delete_function(org_id, name).await
}

/// UpdateFunction

#[utoipa::path(
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
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "update"}))
    )
)]
#[put("/{org_id}/functions/{name}")]
pub async fn update_function(
    path: web::Path<(String, String)>,
    func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let name = name.trim();
    let mut transform = func.into_inner();
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    crate::service::functions::update_function(&org_id, name, transform).await
}

/// FunctionPipelineDependency

#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = FunctionList),
        (status = 404, description = "Function not found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal server error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "get"}))
    )
)]
#[get("/{org_id}/functions/{name}")]
pub async fn list_pipeline_dependencies(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    let (org_id, fn_name) = path.into_inner();
    crate::service::functions::get_pipeline_dependencies(&org_id, &fn_name).await
}

/// Test a Function
#[utoipa::path(
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
    request_body(content = TestVRLRequest, description = "Test run function", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/functions/test")]
pub async fn test_function(
    path: web::Path<String>,
    req_body: web::Json<TestVRLRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let TestVRLRequest { function, events } = req_body.into_inner();

    // Assuming `test_function` applies the VRL function to each event
    match crate::service::functions::test_run_function(&org_id, function, events).await {
        Ok(result) => Ok(result),
        Err(err) => Ok(HttpResponse::BadRequest().body(err.to_string())),
    }
}

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
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::{BulkDeleteRequest, BulkDeleteResponse},
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
pub async fn save_function(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(func): Json<Transform>,
) -> Response {
    let mut transform = func;
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_function(&org_id, &user_email.user_id, &transform).await {
        return resp;
    }
    match openobserve_core::functions::save_function(org_id, transform).await {
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
        ("x-o2-mcp" = json!({
            "description": "List all functions",
            "category": "functions",
            "summary_fields": ["name", "transType", "streams"]
        }))
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
        match openobserve_api_common::auth::validator::list_objects_for_user(
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
                return common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    match openobserve_core::functions::list_functions(org_id, _permitted).await {
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
        ("x-o2-mcp" = json!({"description": "Delete a function", "category": "functions", "requires_confirmation": true}))
    )
)]
pub async fn delete_function(Path((org_id, name)): Path<(String, String)>) -> Response {
    match openobserve_core::functions::delete_function(&org_id, &name).await {
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
        if !check_permissions(
            name,
            &org_id,
            &_user_id,
            "functions",
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

    for name in req.ids {
        match openobserve_core::functions::delete_function(&org_id, &name).await {
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(func): Json<Transform>,
) -> Response {
    let name = name.trim();
    let mut transform = func;
    transform.name = transform.name.trim().to_string();
    transform.function = transform.function.trim().to_string();
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_function(&org_id, &user_email.user_id, &transform).await {
        return resp;
    }
    match openobserve_core::functions::update_function(&org_id, name, transform).await {
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
    match openobserve_core::functions::get_pipeline_dependencies(&org_id, &fn_name).await {
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
    summary = "Validate VRL function syntax",
    description = "Validates VRL (Vector Remap Language) transformation function syntax by testing it against sample events. \
                   Returns validation results with any syntax errors or successful transformation output. \
                   Use this to verify VRL code is correct before creating or updating a function. \
                   Accepts function code, sample events to test against, and optional trans_type (0 for VRL, 1 for JS).",
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
        ("x-o2-mcp" = json!({"category": "functions"})),
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
    match openobserve_core::functions::test_run_function(&org_id, function, events, trans_type)
        .await
    {
        Ok(result) => result,
        Err(err) => (StatusCode::BAD_REQUEST, err.to_string()).into_response(),
    }
}

#[cfg(feature = "enterprise")]
async fn guard_function(
    org_id: &str,
    user_id: &str,
    transform: &Transform,
) -> Result<(), Response> {
    if transform.is_js() {
        return Ok(());
    }
    openobserve_core::background_access::guard_vrl_function(org_id, user_id, &transform.function)
        .await
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    mod stream_access {
        use std::sync::Arc;

        use axum::{Json, body::to_bytes, extract::Path, http::StatusCode};
        use config::meta::{function::Transform, stream::StreamType};
        use openobserve_api_common::extractors::Headers;
        use openobserve_core::{
            auth::UserEmail,
            authz::{TypedStream, fake_checker},
        };
        use transform::enrichment::{ENRICHMENT_TABLES, StreamTable};

        use super::super::*;

        fn user() -> String {
            format!("{}@example.com", config::ider::uuid())
        }

        fn add_table(org: &str, name: &str) -> String {
            let key = format!("{org}/enrichment_tables/{name}");
            ENRICHMENT_TABLES.insert(
                key.clone(),
                StreamTable {
                    org_id: org.to_string(),
                    stream_name: name.to_string(),
                    data: Arc::new(vec![]),
                },
            );
            key
        }

        fn vrl(table: &str) -> Transform {
            Transform {
                name: "fn1".to_string(),
                function: format!("row = get_enrichment_table_record!(\"{table}\", {{\"k\": .k}})"),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: None,
            }
        }

        fn table(org: &str, name: &str) -> TypedStream {
            TypedStream {
                org_id: org.to_string(),
                stream_type: StreamType::EnrichmentTables,
                name: name.to_string(),
            }
        }

        async fn message(resp: axum::response::Response) -> String {
            let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            body["message"].as_str().unwrap_or_default().to_string()
        }

        #[tokio::test]
        async fn function_denied_enrichment_table_is_refused() {
            fake_checker();
            let key = add_table("sf_org1", "sf_own_table");
            let caller = user();
            let resp = save_function(
                Path("sf_org1".to_string()),
                Headers(UserEmail {
                    user_id: caller.clone(),
                }),
                Json(vrl("sf_own_table")),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
            assert_eq!(
                message(resp).await,
                "Unauthorized Access: no read permission on enrichment_tables/sf_own_table"
            );

            fake_checker().grant_read(&caller, &table("sf_org1", "sf_own_table"));
            assert!(
                guard_function("sf_org1", &caller, &vrl("sf_own_table"))
                    .await
                    .is_ok()
            );
            ENRICHMENT_TABLES.remove(&key);
        }

        #[tokio::test]
        async fn default_org_table_refused_for_other_org_admin() {
            let key = add_table("default", "sf_shared_table");
            let admin = user();
            fake_checker().grant_admin("sf_org2", &admin);
            let resp = guard_function("sf_org2", &admin, &vrl("sf_shared_table"))
                .await
                .unwrap_err();
            assert_eq!(
                message(resp).await,
                "Unauthorized Access: no read permission on default/enrichment_tables/sf_shared_table"
            );

            fake_checker().grant_read(&admin, &table("default", "sf_shared_table"));
            assert!(
                guard_function("sf_org2", &admin, &vrl("sf_shared_table"))
                    .await
                    .is_ok()
            );
            ENRICHMENT_TABLES.remove(&key);
        }

        #[tokio::test]
        async fn same_name_own_org_table_is_the_one_checked() {
            let shared = add_table("default", "sf_both_table");
            let own = add_table("sf_org3", "sf_both_table");
            let caller = user();
            fake_checker().grant_read(&caller, &table("sf_org3", "sf_both_table"));
            assert!(
                guard_function("sf_org3", &caller, &vrl("sf_both_table"))
                    .await
                    .is_ok()
            );
            ENRICHMENT_TABLES.remove(&shared);
            ENRICHMENT_TABLES.remove(&own);
        }

        #[tokio::test]
        async fn unknown_table_is_left_to_the_compile_error() {
            let caller = user();
            assert!(
                guard_function("sf_org1", &caller, &vrl("sf_missing_table"))
                    .await
                    .is_ok()
            );
        }
    }
}

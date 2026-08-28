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

//! Shared variables and environments.
//!
//! Route middleware authorizes each of these from the path — `/variables` against
//! the module umbrella, `/environments/{env}/...` against that environment — so
//! the only permission work left here is filtering a list and resolving the
//! environment named in the URL.

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::synthetics_variables::{
    PromoteVariableRequest, SplitVariableRequest, SyntheticsEnvironmentRequest,
    SyntheticsVariableRequest,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::{UserEmail, is_ofga_object_visible};
use openobserve_synthetics::service::SyntheticsEnvironmentRecord;

/// Confirmation that the caller has seen the deletion guard's list.
#[derive(Debug, Default, serde::Deserialize)]
pub struct ForceQuery {
    #[serde(default)]
    pub force: bool,
}

/// OpenFGA resource key for an environment. Its object id is the environment
/// *name*, which is why names are validated as FGA-safe on write.
#[cfg(feature = "enterprise")]
const ENVIRONMENT_RESOURCE: &str = "synthetic_environment";

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/variables",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsVariables",
    summary = "List org-level variables that apply to every environment",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_synthetics_variables(Path(org_id): Path<String>) -> Response {
    match openobserve_synthetics::service::list_global_variables(&org_id).await {
        Ok(vars) => MetaHttpResponse::json(vars),
        Err(e) => variables_error("list_global_variables", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/variables",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsVariable",
    summary = "Create an org-level variable that applies to every environment",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_synthetics_variable(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    // OSS has no per-request identity to attribute a write to.
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();
    match openobserve_synthetics::service::create_variable(&org_id, None, body, &created_by).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/variables/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSyntheticsVariable",
    summary = "Update an org-level variable",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetics_variable(
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    match openobserve_synthetics::service::update_variable(&org_id, None, &id, body).await {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("variable not found"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics/variables/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSyntheticsVariable",
    summary = "Delete an org-level variable",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    responses(
        (status = 200, description = "Deleted",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_variable(
    Path((org_id, id)): Path<(String, String)>,
    Query(q): Query<ForceQuery>,
) -> Response {
    match openobserve_synthetics::service::delete_variable(&org_id, None, &id, q.force).await {
        Ok(true) => MetaHttpResponse::ok("variable deleted"),
        Ok(false) => MetaHttpResponse::not_found("variable not found"),
        // The guard names what it is guarding, so the client can render the
        // confirmation without a second call.
        Err(e) => MetaHttpResponse::conflict(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/environments",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsEnvironments",
    summary = "List environments, each with its variables inline",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_synthetics_environments(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let environments = match openobserve_synthetics::service::list_environments(&org_id).await {
        Ok(envs) => envs,
        Err(e) => return variables_error("list_environments", e),
    };

    // Per-object filtering on top of the route's LIST check: the route proves
    // the caller may list environments at all, this decides which ones.
    #[cfg(feature = "enterprise")]
    let environments = {
        let permitted = match openobserve_api_common::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            ENVIRONMENT_RESOURCE,
        )
        .await
        {
            Ok(permitted) => permitted,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        };
        environments
            .into_iter()
            .filter(|env| {
                is_ofga_object_visible(
                    &org_id,
                    ENVIRONMENT_RESOURCE,
                    &env.name,
                    permitted.as_deref(),
                )
            })
            .collect::<Vec<_>>()
    };

    MetaHttpResponse::json(environments)
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/environments",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsEnvironment",
    summary = "Create an environment",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = "Environment definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_synthetics_environment(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SyntheticsEnvironmentRequest>,
) -> Response {
    // OSS has no per-request identity to attribute a write to.
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();
    match openobserve_synthetics::service::create_environment(&org_id, body, &created_by).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/environments/{env}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSyntheticsEnvironment",
    summary = "Update an environment's description",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
    ),
    request_body(content = Object, description = "Environment definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetics_environment(
    Path((org_id, env)): Path<(String, String)>,
    Json(body): Json<SyntheticsEnvironmentRequest>,
) -> Response {
    match openobserve_synthetics::service::update_environment(&org_id, &env, body).await {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("environment not found"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics/environments/{env}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSyntheticsEnvironment",
    summary = "Delete an environment and the variables scoped to it",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
    ),
    responses(
        (status = 200, description = "Deleted",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_environment(
    Path((org_id, env)): Path<(String, String)>,
    Query(q): Query<ForceQuery>,
) -> Response {
    match openobserve_synthetics::service::delete_environment(&org_id, &env, q.force).await {
        Ok(true) => MetaHttpResponse::ok("environment deleted"),
        Ok(false) => MetaHttpResponse::not_found("environment not found"),
        // The guard names the secrets or variables blocking the delete, so the
        // client can render the confirmation without a second call.
        Err(e) => MetaHttpResponse::conflict(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/environments/{env}/variables",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsEnvironmentVariables",
    summary = "List one environment's variables",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_synthetics_environment_variables(
    Path((org_id, env)): Path<(String, String)>,
) -> Response {
    match openobserve_synthetics::service::list_environment_variables(&org_id, &env).await {
        Ok(Some(vars)) => MetaHttpResponse::json(vars),
        Ok(None) => MetaHttpResponse::not_found("environment not found"),
        Err(e) => variables_error("list_environment_variables", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/environments/{env}/variables",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsEnvironmentVariable",
    summary = "Create a variable scoped to one environment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
    ),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_synthetics_environment_variable(
    Path((org_id, env)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    // OSS has no per-request identity to attribute a write to.
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();
    let record = match resolve_environment(&org_id, &env).await {
        Ok(Some(record)) => record,
        Ok(None) => return MetaHttpResponse::not_found("environment not found"),
        Err(response) => return response,
    };
    match openobserve_synthetics::service::create_variable(
        &org_id,
        Some(&record),
        body,
        &created_by,
    )
    .await
    {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/environments/{env}/variables/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSyntheticsEnvironmentVariable",
    summary = "Update a variable scoped to one environment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetics_environment_variable(
    Path((org_id, env, id)): Path<(String, String, String)>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    let record = match resolve_environment(&org_id, &env).await {
        Ok(Some(record)) => record,
        Ok(None) => return MetaHttpResponse::not_found("environment not found"),
        Err(response) => return response,
    };
    match openobserve_synthetics::service::update_variable(&org_id, Some(&record), &id, body).await
    {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("variable not found"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics/environments/{env}/variables/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSyntheticsEnvironmentVariable",
    summary = "Delete a variable scoped to one environment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    responses(
        (status = 200, description = "Deleted",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_environment_variable(
    Path((org_id, env, id)): Path<(String, String, String)>,
    Query(q): Query<ForceQuery>,
) -> Response {
    let record = match resolve_environment(&org_id, &env).await {
        Ok(Some(record)) => record,
        Ok(None) => return MetaHttpResponse::not_found("environment not found"),
        Err(response) => return response,
    };
    match openobserve_synthetics::service::delete_variable(&org_id, Some(&record), &id, q.force)
        .await
    {
        Ok(true) => MetaHttpResponse::ok("variable deleted"),
        Ok(false) => MetaHttpResponse::not_found("variable not found"),
        Err(e) => MetaHttpResponse::conflict(e),
    }
}

/// Turns the URL's environment name into the row the service works against.
async fn resolve_environment(
    org_id: &str,
    env: &str,
) -> Result<Option<SyntheticsEnvironmentRecord>, Response> {
    openobserve_synthetics::service::get_environment(org_id, env)
        .await
        .map_err(|e| variables_error("get_environment", e))
}

fn variables_error(operation: &str, error: anyhow::Error) -> Response {
    tracing::error!("[synthetics] {operation}: {error}");
    MetaHttpResponse::error(
        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
        error.to_string(),
    )
    .into_response()
}

// ── Scope moves (design §9.6) ────────────────────────────────────────────────
//
// All three only ever touch plain variables: a secret already carries an
// environment by construction, so it can never become global, and its value is
// write-only so there is nothing to copy between environments.

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/resolved-variables",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticResolvedVariables",
    summary = "The check's resolved variable set, with the scope each name comes from",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Check ID"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_synthetic_resolved_variables(
    Path((org_id, id)): Path<(String, String)>,
) -> Response {
    match openobserve_synthetics::service::resolved_variables(&org_id, &id).await {
        Ok(Some(resolved)) => MetaHttpResponse::json(resolved),
        Ok(None) => MetaHttpResponse::not_found("check not found"),
        Err(e) => variables_error("resolved_variables", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/{id}/variables/{name}/promote",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "PromoteSyntheticVariable",
    summary = "Move a check-scoped variable into the shared tier",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Check ID"),
        ("name" = String, Path, description = "Variable name on the check"),
    ),
    request_body(content = Object, description = "Destination scope", content_type = "application/json"),
    responses(
        (status = 200, description = "Promoted", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
    ),
)]
pub async fn promote_synthetic_variable(
    Path((org_id, id, name)): Path<(String, String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<PromoteVariableRequest>,
) -> Response {
    // OSS has no per-request identity to attribute a write to.
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();

    // The route authorizes the CHECK. The destination scope is a second object
    // with its own owner, so it is checked here — otherwise anyone who can edit
    // a check could plant a value in an environment they cannot touch.
    let destination = match &body.environment {
        Some(env) => match resolve_environment(&org_id, env).await {
            Ok(Some(record)) => Some(record),
            Ok(None) => return MetaHttpResponse::not_found("environment not found"),
            Err(response) => return response,
        },
        None => None,
    };
    #[cfg(feature = "enterprise")]
    if let Err(response) =
        require_scope_write(&org_id, &user_email.user_id, destination.as_ref()).await
    {
        return response;
    }

    match openobserve_synthetics::service::promote_check_variable(
        &org_id,
        &id,
        &name,
        destination.as_ref(),
        &created_by,
    )
    .await
    {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/environments/{env}/variables/{id}/promote",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "PromoteEnvironmentVariableToGlobal",
    summary = "Move an environment-scoped variable to the unscoped tier",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Environment name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    responses(
        (status = 200, description = "Promoted", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
    ),
)]
pub async fn promote_environment_variable(
    Path((org_id, env, id)): Path<(String, String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let record = match resolve_environment(&org_id, &env).await {
        Ok(Some(record)) => record,
        Ok(None) => return MetaHttpResponse::not_found("environment not found"),
        Err(response) => return response,
    };
    // The route authorizes the environment being LEFT; the unscoped tier is
    // governed by the module umbrella, so entering it is checked separately.
    #[cfg(feature = "enterprise")]
    if let Err(response) = require_scope_write(&org_id, &user_email.user_id, None).await {
        return response;
    }

    match openobserve_synthetics::service::promote_to_global(&org_id, &record, &id).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/variables/{id}/split",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SplitSyntheticsVariable",
    summary = "Split a global variable into per-environment values",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Variable ID"),
    ),
    request_body(content = Object, description = "One value per destination environment", content_type = "application/json"),
    responses(
        (status = 200, description = "Split",   content_type = "application/json", body = Object),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
    ),
)]
pub async fn split_synthetics_variable(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SplitVariableRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();

    // Every destination is a separate object with its own owner, so each is
    // checked before any row is written.
    #[cfg(feature = "enterprise")]
    for target in &body.targets {
        match resolve_environment(&org_id, &target.environment).await {
            Ok(Some(record)) => {
                if let Err(response) =
                    require_scope_write(&org_id, &user_email.user_id, Some(&record)).await
                {
                    return response;
                }
            }
            Ok(None) => return MetaHttpResponse::not_found("environment not found"),
            Err(response) => return response,
        }
    }

    match openobserve_synthetics::service::split_to_environments(
        &org_id,
        &id,
        body.targets,
        &created_by,
    )
    .await
    {
        Ok(views) => MetaHttpResponse::json(views),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Write permission on the scope a variable is moving into.
///
/// `None` means the unscoped tier, which the module umbrella governs. Scope
/// moves cross an authorization boundary that no single route can express, so
/// the destination is always checked in the handler.
#[cfg(feature = "enterprise")]
async fn require_scope_write(
    org_id: &str,
    user_id: &str,
    destination: Option<&SyntheticsEnvironmentRecord>,
) -> Result<(), Response> {
    let (object, resource, use_self_parent) = match destination {
        Some(env) => (env.name.clone(), ENVIRONMENT_RESOURCE, true),
        None => (org_id.to_string(), "synthetics_module", true),
    };
    if openobserve_core::auth::check_permissions(
        &object,
        org_id,
        user_id,
        resource,
        "PUT",
        None,
        destination.is_none(),
        false,
        use_self_parent,
    )
    .await
    {
        return Ok(());
    }
    Err(MetaHttpResponse::forbidden(match destination {
        Some(env) => format!("Forbidden: no write access to environment '{}'", env.name),
        None => "Forbidden: no write access to global variables".to_string(),
    }))
}

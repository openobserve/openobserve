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

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(any(feature = "enterprise", test))]
use config::meta::synthetics_variables::SyntheticsEnvironmentView;
use config::meta::synthetics_variables::{
    PromoteVariableRequest, SplitVariableRequest, SyntheticsEnvironmentRequest,
    SyntheticsVariableRequest,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use openobserve_synthetics::service::{
    ResyncUnavailable, SyntheticsEnvironmentRecord, UsageConflict,
};

/// Confirmation that the caller has seen the deletion guard's list.
#[derive(Debug, Default, serde::Deserialize)]
pub struct ForceQuery {
    #[serde(default)]
    pub force: bool,
}

/// Selects the resolved-variables response shape; only `all` is recognised.
#[derive(Debug, Default, serde::Deserialize)]
pub struct ResolvedQuery {
    #[serde(default)]
    pub envs: Option<String>,
}

#[cfg(feature = "enterprise")]
const ENVIRONMENT_RESOURCE: &str = "synthetic_environment";

/// Most permission lookups one request keeps in flight.
#[cfg(feature = "enterprise")]
const PERMISSION_CONCURRENCY: usize = 16;
#[cfg(feature = "enterprise")]
const ENVIRONMENT_GET: GetCheck = GetCheck {
    resource: ENVIRONMENT_RESOURCE,
    use_self_context: false,
    use_self_parent: true,
};
#[cfg(feature = "enterprise")]
const CHECK_GET: GetCheck = GetCheck {
    resource: "synthetics",
    use_self_context: true,
    use_self_parent: false,
};

/// The service's batch question "which of these ids may the caller GET?".
type Permitted = std::pin::Pin<Box<dyn std::future::Future<Output = HashSet<String>> + Send>>;

/// A resource and the flags its per-object GET is resolved with.
#[cfg(feature = "enterprise")]
struct GetCheck {
    resource: &'static str,
    use_self_context: bool,
    use_self_parent: bool,
}

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
pub async fn list_synthetics_variables(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let readable_checks = permitted(&org_id, &user_email.user_id, &CHECK_GET);
    #[cfg(not(feature = "enterprise"))]
    let readable_checks = permitted_all();
    match openobserve_synthetics::service::list_global_variables(&org_id, readable_checks).await {
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
        ("force" = Option<bool>, Query, description = "Rename even while checks reference the old name"),
    ),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Checks still reference the old name; re-send with force=true", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetics_variable(
    Path((org_id, id)): Path<(String, String)>,
    Query(q): Query<ForceQuery>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    match openobserve_synthetics::service::update_variable(&org_id, None, &id, body, q.force).await
    {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("variable not found"),
        Err(e) => update_error(e),
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
        (status = 409, description = "Checks still reference the variable; re-send with force=true", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_variable(
    Path((org_id, id)): Path<(String, String)>,
    Query(q): Query<ForceQuery>,
) -> Response {
    match openobserve_synthetics::service::delete_variable(&org_id, None, &id, q.force).await {
        Ok(true) => MetaHttpResponse::ok("variable deleted"),
        Ok(false) => MetaHttpResponse::not_found("variable not found"),
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
    #[cfg(feature = "enterprise")]
    let readable_checks = permitted(&org_id, &user_email.user_id, &CHECK_GET);
    #[cfg(not(feature = "enterprise"))]
    let readable_checks = permitted_all();
    let environments =
        match openobserve_synthetics::service::list_environments(&org_id, readable_checks).await {
            Ok(envs) => envs,
            Err(e) => return variables_error("list_environments", e),
        };

    // Per environment: `list_objects_for_user` is None unless list-only-permitted is on.
    #[cfg(feature = "enterprise")]
    let environments = {
        let names = environments
            .iter()
            .filter(|env| !env.is_global)
            .map(|env| env.name.clone())
            .collect();
        let readable = gettable(&org_id, &user_email.user_id, &ENVIRONMENT_GET, names).await;
        readable_environments(environments, &readable)
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
        (status = 409, description = "The environment is in use or still holds variables; see the message", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_environment(
    Path((org_id, env)): Path<(String, String)>,
    Query(q): Query<ForceQuery>,
) -> Response {
    match openobserve_synthetics::service::delete_environment(&org_id, &env, q.force).await {
        Ok(true) => MetaHttpResponse::ok("environment deleted"),
        Ok(false) => MetaHttpResponse::not_found("environment not found"),
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let readable_checks = permitted(&org_id, &user_email.user_id, &CHECK_GET);
    #[cfg(not(feature = "enterprise"))]
    let readable_checks = permitted_all();
    match openobserve_synthetics::service::list_environment_variables(
        &org_id,
        &env,
        readable_checks,
    )
    .await
    {
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
        ("force" = Option<bool>, Query, description = "Rename even while checks reference the old name"),
    ),
    request_body(content = Object, description = "Variable definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Checks still reference the old name; re-send with force=true", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetics_environment_variable(
    Path((org_id, env, id)): Path<(String, String, String)>,
    Query(q): Query<ForceQuery>,
    Json(body): Json<SyntheticsVariableRequest>,
) -> Response {
    let record = match resolve_environment(&org_id, &env).await {
        Ok(Some(record)) => record,
        Ok(None) => return MetaHttpResponse::not_found("environment not found"),
        Err(response) => return response,
    };
    match openobserve_synthetics::service::update_variable(
        &org_id,
        Some(&record),
        &id,
        body,
        q.force,
    )
    .await
    {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("variable not found"),
        Err(e) => update_error(e),
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
        (status = 409, description = "Checks still reference the variable; re-send with force=true", content_type = "application/json", body = Object),
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

/// Global reads are open (design §7); every other environment needs its own GET.
#[cfg(any(feature = "enterprise", test))]
fn readable_environments(
    environments: Vec<SyntheticsEnvironmentView>,
    readable: &HashSet<String>,
) -> Vec<SyntheticsEnvironmentView> {
    environments
        .into_iter()
        .filter(|env| env.is_global || readable.contains(&env.name))
        .collect()
}

/// The ids the caller may GET, asked at most `PERMISSION_CONCURRENCY` at a time.
#[cfg(feature = "enterprise")]
async fn gettable(
    org_id: &str,
    user_id: &str,
    target: &GetCheck,
    ids: Vec<String>,
) -> HashSet<String> {
    use futures::StreamExt;
    futures::stream::iter(ids)
        .map(|id| async move {
            openobserve_core::auth::check_permissions(
                &id,
                org_id,
                user_id,
                target.resource,
                "GET",
                None,
                false,
                target.use_self_context,
                target.use_self_parent,
            )
            .await
            .then_some(id)
        })
        .buffer_unordered(PERMISSION_CONCURRENCY)
        .filter_map(|id| async move { id })
        .collect()
        .await
}

/// [`gettable`] bound to the caller, in the shape the service's listings take.
#[cfg(feature = "enterprise")]
fn permitted(
    org_id: &str,
    user_id: &str,
    target: &'static GetCheck,
) -> impl FnOnce(Vec<String>) -> Permitted + use<> {
    let (org_id, user_id) = (org_id.to_string(), user_id.to_string());
    move |ids| Box::pin(async move { gettable(&org_id, &user_id, target, ids).await })
}

/// OSS has no per-object RBAC, so every id is readable.
#[cfg(not(feature = "enterprise"))]
fn permitted_all() -> impl FnOnce(Vec<String>) -> Permitted {
    |ids| Box::pin(async move { ids.into_iter().collect() })
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

/// 409 for the reference guard, like a delete, so the client can confirm and re-send with force.
fn update_error(error: anyhow::Error) -> Response {
    if error.downcast_ref::<UsageConflict>().is_some() {
        MetaHttpResponse::conflict(error)
    } else {
        MetaHttpResponse::bad_request(error)
    }
}

fn variables_error(operation: &str, error: anyhow::Error) -> Response {
    tracing::error!("[synthetics] {operation}: {error}");
    MetaHttpResponse::error(
        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
        error.to_string(),
    )
    .into_response()
}

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
        ("envs" = Option<String>, Query, description = "Pass `all` for every environment's resolved set, keyed by environment name; omit for the flat first-environment set"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_synthetic_resolved_variables(
    Path((org_id, id)): Path<(String, String)>,
    Query(q): Query<ResolvedQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let readable_envs = permitted(&org_id, &user_email.user_id, &ENVIRONMENT_GET);
    #[cfg(not(feature = "enterprise"))]
    let readable_envs = permitted_all();
    match q.envs.as_deref() {
        None => {
            match openobserve_synthetics::service::resolved_variables(&org_id, &id, readable_envs)
                .await
            {
                Ok(Some(resolved)) => MetaHttpResponse::json(resolved),
                Ok(None) => MetaHttpResponse::not_found("check not found"),
                Err(e) => variables_error("resolved_variables", e),
            }
        }
        Some("all") => {
            match openobserve_synthetics::service::resolved_variables_grouped(
                &org_id,
                &id,
                readable_envs,
            )
            .await
            {
                Ok(Some(grouped)) => MetaHttpResponse::json(grouped),
                Ok(None) => MetaHttpResponse::not_found("check not found"),
                Err(e) => variables_error("resolved_variables_grouped", e),
            }
        }
        Some(other) => {
            MetaHttpResponse::bad_request(format!("envs: '{other}' is not supported; use 'all'"))
        }
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

    let destination = match &body.environment {
        Some(env) => match resolve_environment(&org_id, env).await {
            Ok(Some(record)) => record,
            Ok(None) => return MetaHttpResponse::not_found("environment not found"),
            Err(response) => return response,
        },
        None => match openobserve_synthetics::service::global_environment(&org_id).await {
            Ok(record) => record,
            Err(e) => return variables_error("global_environment", e),
        },
    };
    #[cfg(feature = "enterprise")]
    if let Err(response) = require_scope_write(&org_id, &user_email.user_id, &destination).await {
        return response;
    }

    match openobserve_synthetics::service::promote_check_variable(
        &org_id,
        &id,
        &name,
        &destination,
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
    summary = "Move an environment-scoped variable into the global environment",
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
    // The route authorizes the environment being LEFT; entering global is a second object.
    #[cfg(feature = "enterprise")]
    {
        let global = match openobserve_synthetics::service::global_environment(&org_id).await {
            Ok(global) => global,
            Err(e) => return variables_error("global_environment", e),
        };
        if let Err(response) = require_scope_write(&org_id, &user_email.user_id, &global).await {
            return response;
        }
    }

    match openobserve_synthetics::service::promote_to_global(&org_id, &record, &id).await {
        Ok(Some(view)) => MetaHttpResponse::json(view),
        Ok(None) => MetaHttpResponse::not_found("variable not found"),
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

    #[cfg(feature = "enterprise")]
    for target in &body.targets {
        match resolve_environment(&org_id, &target.environment).await {
            Ok(Some(record)) => {
                if let Err(response) =
                    require_scope_write(&org_id, &user_email.user_id, &record).await
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

/// Write permission on the environment a variable is moving into, `global` included.
#[cfg(feature = "enterprise")]
async fn require_scope_write(
    org_id: &str,
    user_id: &str,
    destination: &SyntheticsEnvironmentRecord,
) -> Result<(), Response> {
    if openobserve_core::auth::check_permissions(
        &destination.name,
        org_id,
        user_id,
        ENVIRONMENT_RESOURCE,
        "PUT",
        None,
        false,
        false,
        true,
    )
    .await
    {
        return Ok(());
    }
    Err(MetaHttpResponse::forbidden(format!(
        "Forbidden: no write access to environment '{}'",
        destination.name
    )))
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/{id}/replay-secrets",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticReplaySecrets",
    summary = "Shared secret values for replay, when the org has opted in",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Check ID"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_synthetic_replay_secrets(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !db::organization::get_org_setting(&org_id)
        .await
        .map(|s| s.synthetics_replay_autofill)
        .unwrap_or(false)
    {
        return MetaHttpResponse::forbidden(
            "Replay auto-fill is disabled for this organization. Enter the value when prompted.",
        );
    }

    let secrets = match openobserve_synthetics::service::replay_secrets(&org_id, &id).await {
        Ok(Some(secrets)) => secrets,
        Ok(None) => return MetaHttpResponse::not_found("check not found"),
        Err(e) => return variables_error("replay_secrets", e),
    };

    #[cfg(feature = "enterprise")]
    let secrets = {
        let mut permitted = Vec::with_capacity(secrets.len());
        for secret in secrets {
            if openobserve_core::auth::check_permissions(
                &secret.environment,
                &org_id,
                &user_email.user_id,
                ENVIRONMENT_RESOURCE,
                "PUT",
                None,
                false,
                false,
                true,
            )
            .await
            {
                permitted.push(secret);
            }
        }
        permitted
    };

    if !secrets.is_empty() {
        let names: Vec<&str> = secrets.iter().map(|s| s.name.as_str()).collect();
        tracing::info!(
            org_id = %org_id,
            synthetics_id = %id,
            secrets = ?names,
            "[synthetics] released shared secret values for replay"
        );
    }

    MetaHttpResponse::json(
        secrets
            .into_iter()
            .map(|s| (s.name, s.value))
            .collect::<std::collections::HashMap<_, _>>(),
    )
}

#[derive(Debug, Default, serde::Deserialize, utoipa::ToSchema)]
pub struct DuplicateEnvironmentBody {
    pub name: String,
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/environments/{env}/duplicate",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DuplicateSyntheticsEnvironment",
    summary = "Copy an environment's variables into a new environment",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("env" = String, Path, description = "Source environment name"),
    ),
    request_body(content = Object, description = "New environment name", content_type = "application/json"),
    responses(
        (status = 200, description = "Duplicated", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",    content_type = "application/json", body = Object),
    ),
)]
pub async fn duplicate_synthetics_environment(
    Path((org_id, env)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<DuplicateEnvironmentBody>,
) -> Response {
    // OSS has no per-request identity to attribute a write to.
    #[cfg(feature = "enterprise")]
    let created_by = user_email.user_id.clone();
    #[cfg(not(feature = "enterprise"))]
    let created_by = String::new();

    // The route authorizes the SOURCE; creating the copy needs what `POST /environments` needs.
    #[cfg(feature = "enterprise")]
    if !openobserve_core::auth::check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        ENVIRONMENT_RESOURCE,
        "POST",
        None,
        true,
        false,
        true,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Forbidden: no permission to create environments");
    }

    match openobserve_synthetics::service::duplicate_environment(
        &org_id,
        &env,
        &body.name,
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
    path = "/{org_id}/synthetics/environments/_resync",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ResyncSyntheticsEnvironments",
    summary = "Publish every environment and variable of the org to the other regions again",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Counts of what was enqueued, and environments whose batch failed", content_type = "application/json", body = Object),
        (status = 400, description = "Super cluster is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn resync_synthetics_environments(Path(org_id): Path<String>) -> Response {
    match openobserve_synthetics::service::resync_environments(&org_id).await {
        Ok(summary) => MetaHttpResponse::json(summary),
        Err(e) => resync_error(e),
    }
}

/// 400 when this node has no other region to send to; any other failure is a 500.
fn resync_error(error: anyhow::Error) -> Response {
    if error.downcast_ref::<ResyncUnavailable>().is_some() {
        MetaHttpResponse::bad_request(error)
    } else {
        variables_error("resync_environments", error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(name: &str, is_global: bool) -> SyntheticsEnvironmentView {
        SyntheticsEnvironmentView {
            name: name.into(),
            is_global,
            ..Default::default()
        }
    }

    #[test]
    fn a_rename_blocked_by_references_is_a_conflict_like_a_delete() {
        let conflict = update_error(UsageConflict("referenced".to_string()).into());
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let invalid = update_error(anyhow::anyhow!("name: invalid"));
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_resync_without_super_cluster_is_a_bad_request() {
        assert_eq!(
            resync_error(ResyncUnavailable.into()).status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            resync_error(anyhow::anyhow!("db down")).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn an_environment_the_caller_cannot_get_is_dropped_but_global_stays() {
        let envs = vec![
            env("global", true),
            env("staging", false),
            env("production", false),
        ];
        let readable = HashSet::from(["staging".to_string()]);
        let names: Vec<String> = readable_environments(envs, &readable)
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, ["global", "staging"]);
    }
}

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

//! Saved AutoResolves: list, create, read, edit and delete them, switch their trigger, and run one.

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::autoresolve::{
    corrections,
    saved::{self, SavedError, SavedInput},
};
use serde::Deserialize;
use serde_json::json;
use utoipa::ToSchema;

use super::{
    autoresolve_error, connection_refusal, disabled, failed, parse_body, refusal,
    runs::{StartedRun, approve_error},
};
use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::auth::UserEmail};

#[derive(Debug, Deserialize, ToSchema)]
pub struct TriggerBody {
    /// On approves the trigger as the caller; off keeps the last approval.
    pub enabled: bool,
}

/// AutoResolveListSaved
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/saved",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveListSaved",
    summary = "List saved AutoResolves",
    description = "The org's saved AutoResolves, sorted by name, with their connections and trigger.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Saved AutoResolves", content_type = "application/json", body = openobserve_core::autoresolve::saved::SavedList),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_saved(Path(org_id): Path<String>) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match saved::list(&org_id).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(e) => saved_error("list saved", e),
    }
}

/// AutoResolveCreateSaved
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/saved",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveCreateSaved",
    summary = "Save an AutoResolve",
    description = "Saves a goal with its connections and trigger. The caller must be allowed to approve changes through every connection; an alert or incident trigger starts on, approved by the caller, and needs the Slack channel for approvals.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = openobserve_core::autoresolve::saved::SavedInput, description = "The AutoResolve", content_type = "application/json"),
    responses(
        (status = 201, description = "Saved", content_type = "application/json", body = openobserve_core::autoresolve::saved::SavedView),
        (status = 400, description = "The body is not valid, or the connections are not: none, more than the summary's `max_connections`, an unknown one, or one named in `connection` (removed, or not an MCP connection)", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not approve on a connection; `connection` and `approvers` say which and who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "An AutoResolve with this name already exists", content_type = "application/json", body = Object),
        (status = 422, description = "Slack approval is off on this deployment, or no Slack channel is chosen for approvals", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The Slack settings could not be read", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_saved(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let input: SavedInput = match parse_body(&body) {
        Ok(input) => input,
        Err(bad) => return bad,
    };
    match saved::save(&org_id, &user.user_id, input).await {
        Ok(view) => (StatusCode::CREATED, Json(view)).into_response(),
        Err(e) => saved_error("save", e),
    }
}

/// AutoResolveGetSaved
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveGetSaved",
    summary = "Get a saved AutoResolve",
    description = "One saved AutoResolve with its connections and trigger.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    responses(
        (status = 200, description = "The saved AutoResolve and who may approve changes through its MCPs", content_type = "application/json", body = openobserve_core::autoresolve::saved::SavedDetail),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_saved(Path((org_id, autoresolve_id)): Path<(String, String)>) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match saved::get(&org_id, &autoresolve_id).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => saved_error("get saved", e),
    }
}

/// AutoResolveUpdateSaved
#[utoipa::path(
    put,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveUpdateSaved",
    summary = "Edit a saved AutoResolve",
    description = "Replaces the name, goal, connections and trigger. A changed goal, connection list or trigger turns the trigger off until someone who may approve turns it on again.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    request_body(content = openobserve_core::autoresolve::saved::SavedInput, description = "The AutoResolve; `from_run_id` is ignored", content_type = "application/json"),
    responses(
        (status = 200, description = "Saved", content_type = "application/json", body = openobserve_core::autoresolve::saved::SavedView),
        (status = 400, description = "The body is not valid, or the connections are not: none, more than the summary's `max_connections`, an unknown one, or one named in `connection` (removed, or not an MCP connection)", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not approve on a connection; `connection` and `approvers` say which and who may", content_type = "application/json", body = Object),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "An AutoResolve with this name already exists, or it changed since it was read", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_saved(
    Path((org_id, autoresolve_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let input: SavedInput = match parse_body(&body) {
        Ok(input) => input,
        Err(bad) => return bad,
    };
    match saved::update(&org_id, &user.user_id, &autoresolve_id, input).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => saved_error("update saved", e),
    }
}

/// AutoResolveDeleteSaved
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveDeleteSaved",
    summary = "Delete a saved AutoResolve",
    description = "Deletes the AutoResolve and its trigger. Its past runs stay.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_saved(Path((org_id, autoresolve_id)): Path<(String, String)>) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match saved::delete(&org_id, &autoresolve_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => saved_error("delete saved", e),
    }
}

/// AutoResolveSetSavedTrigger
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}/trigger",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveSetSavedTrigger",
    summary = "Turn a saved AutoResolve's trigger on or off",
    description = "Turning it on approves it as the caller, who must be allowed to approve changes through every connection, and needs the Slack channel for approvals. Turning it off keeps the last approval.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    request_body(content = TriggerBody, description = "On or off", content_type = "application/json"),
    responses(
        (status = 200, description = "Saved", content_type = "application/json", body = openobserve_core::autoresolve::saved::SavedView),
        (status = 400, description = "The body is not valid, the AutoResolve has no trigger, or a connection was removed (named in `connection`)", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not approve on a connection; `connection` and `approvers` say which and who may", content_type = "application/json", body = Object),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The AutoResolve changed since it was read", content_type = "application/json", body = Object),
        (status = 422, description = "Slack approval is off on this deployment, or no Slack channel is chosen for approvals", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The Slack settings could not be read", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn set_saved_trigger(
    Path((org_id, autoresolve_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: TriggerBody = match parse_body(&body) {
        Ok(body) => body,
        Err(bad) => return bad,
    };
    match saved::set_trigger(&org_id, &user.user_id, &autoresolve_id, body.enabled).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => saved_error("set trigger", e),
    }
}

/// AutoResolveRunSaved
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}/run",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveRunSaved",
    summary = "Run a saved AutoResolve",
    description = "Starts a run of the AutoResolve's goal over its connections as saved now, as the caller; later edits to the AutoResolve do not change the run. The run proposes a plan; nothing changes until someone approves an option.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    responses(
        (status = 201, description = "Started", content_type = "application/json", body = StartedRun),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "A run of this AutoResolve is still in progress", content_type = "application/json", body = Object),
        (status = 422, description = "Its connections were all deleted", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The AI turn could not start", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn run_saved(
    Path((org_id, autoresolve_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match saved::run_saved(&org_id, &user.user_id, &autoresolve_id).await {
        Ok(run_id) => (StatusCode::CREATED, Json(StartedRun { run_id })).into_response(),
        Err(e) => saved_error("run saved", e),
    }
}

/// AutoResolveListSavedCorrections
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}/corrections",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveListSavedCorrections",
    summary = "List a saved AutoResolve's corrections",
    description = "The corrections people asked this AutoResolve's later runs to remember, newest first, and whether the caller may remove them. Every planning turn of a later run reads the newest of them.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
    ),
    responses(
        (status = 200, description = "Active corrections", content_type = "application/json", body = openobserve_core::autoresolve::corrections::CorrectionList),
        (status = 404, description = "Not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_corrections(
    Path((org_id, autoresolve_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match corrections::list(&org_id, &autoresolve_id, &user.user_id).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(e) => approve_error(e),
    }
}

/// AutoResolveRemoveSavedCorrection
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/autoresolve/saved/{autoresolve_id}/corrections/{correction_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveRemoveSavedCorrection",
    summary = "Remove a correction from a saved AutoResolve",
    description = "Later runs stop reading the correction; past runs keep it in their record. Needs the right to edit the AutoResolve.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("autoresolve_id" = String, Path, description = "Saved AutoResolve id"),
        ("correction_id" = String, Path, description = "Correction id"),
    ),
    responses(
        (status = 204, description = "Removed"),
        (status = 403, description = "The caller may not edit the AutoResolve; `message` names what is missing and `approvers` who may", content_type = "application/json", body = Object),
        (status = 404, description = "Not found, already removed, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn remove_correction(
    Path((org_id, autoresolve_id, correction_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let removed = corrections::remove(&org_id, &autoresolve_id, &correction_id, &user.user_id);
    match removed.await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => approve_error(e),
    }
}

/// A 403 names the connection and who may approve on it, so the person knows whom to ask.
fn saved_error(context: &str, e: SavedError) -> Response {
    let message = e.to_string();
    match e {
        SavedError::Db(e) => failed(context, e),
        SavedError::Run(e) => autoresolve_error(context, e),
        SavedError::NoPermission {
            connection,
            approvers,
        } => {
            let body = json!({
                "code": 403,
                "message": message,
                "connection": connection,
                "approvers": approvers,
            });
            (StatusCode::FORBIDDEN, Json(body)).into_response()
        }
        SavedError::Connections(e) => connection_refusal(context, e),
        SavedError::Invalid(_) => refusal(StatusCode::BAD_REQUEST, message),
        SavedError::NotFound => MetaHttpResponse::not_found(message),
        SavedError::NameTaken | SavedError::Changed | SavedError::RunInProgress => {
            refusal(StatusCode::CONFLICT, message)
        }
        SavedError::SlackOff | SavedError::NoSlackChannel => {
            refusal(StatusCode::UNPROCESSABLE_ENTITY, message)
        }
        SavedError::SlackUnreadable => refusal(StatusCode::SERVICE_UNAVAILABLE, message),
    }
}

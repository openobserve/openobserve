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
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::org_ai_toolsets::OrgToolset;
use o2_enterprise::enterprise::{
    ai::{
        client::{DiscoverError, DiscoveredTool, McpEntry, get_agent_client},
        toolsets::{
            McpData, ToolsetCreateRequest, ToolsetHealth, ToolsetKind, ToolsetListResponse,
            ToolsetResponse, ToolsetUpdateRequest, merge_update_data,
            push::{colliding_names, normalize_tool_name},
            validate_data, validate_name,
        },
    },
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::{UserEmail, check_permissions};
use serde::{Deserialize, Serialize};
use svix_ksuid::{Ksuid, KsuidLike};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Body of `_discover`: an unsaved config, or a saved toolset by `id` with unsaved `overrides`.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct DiscoverRequest {
    #[serde(default)]
    pub id: Option<String>,
    /// `url`, `headers` and `timeout_seconds` merged over the saved row, as a `PUT` would.
    #[serde(default)]
    pub overrides: Option<serde_json::Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
    #[serde(default)]
    pub timeout_seconds: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DiscoverResponse {
    pub tools: Vec<DiscoveredTool>,
}

/// A `_discover` that returned no tools: the HTTP status and the `{code, message}` body.
#[derive(Debug, PartialEq)]
struct DiscoverFailure {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl DiscoverFailure {
    fn refused(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "discovery_failed",
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "not_found",
            message: message.into(),
        }
    }

    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({"code": self.code, "message": self.message})),
        )
            .into_response()
    }
}

impl From<DiscoverError> for DiscoverFailure {
    fn from(e: DiscoverError) -> Self {
        match e {
            DiscoverError::Refused { code, message } => Self {
                status: StatusCode::BAD_REQUEST,
                code: if code == "url_refused" {
                    "url_refused"
                } else {
                    "discovery_failed"
                },
                message,
            },
            DiscoverError::InternalSecretRequired => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                code: "internal_secret_required",
                message: "The AI service has no internal secret configured, so it can't list \
                          tools; enter tool names by hand"
                    .to_string(),
            },
            DiscoverError::Unavailable(detail) => {
                log::warn!("[AI] toolset discovery: the AI service is unavailable: {detail}");
                Self {
                    status: StatusCode::SERVICE_UNAVAILABLE,
                    code: "ai_service_unavailable",
                    message: "The AI service is unavailable; enter tool names by hand or retry"
                        .to_string(),
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets",
    context_path = "/api",
    tag = "AI",
    operation_id = "CreateAiToolset",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    summary = "Create an AI toolset",
    description = "Creates a new AI toolset (MCP server, CLI tool, skill, or generic config). \
                   The name must match `^[a-z0-9]+(-[a-z0-9]+)*$` and be at most 64 characters. \
                   The `data` field is encrypted at rest using per-org envelope encryption. \
                   An MCP toolset's `data` may limit what the agent calls: `allowed_tools`, \
                   `blocked_tools` and `write_tools` (tool name globs, `*` = any characters), \
                   `max_calls_per_turn` (1-500), `rate_limit` (`{calls, per_seconds}`) and \
                   `max_result_bytes` (1 KiB-16 MiB); an omitted key keeps the agent's default, \
                   so an omitted `allowed_tools` means `[\"*\"]`; `blocked_tools` always wins. \
                   Only available in enterprise deployments.",
    request_body(
        content = inline(ToolsetCreateRequest),
        description = "Toolset configuration",
        content_type = "application/json",
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Toolset created", content_type = "application/json", body = ToolsetResponse),
        (status = 400, description = "Invalid request", content_type = "application/json"),
        (status = 409, description = "A toolset with this name, or one that normalizes to it, already exists", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "create"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<ToolsetCreateRequest>,
) -> Response {
    if let Err(e) = validate_name(&body.name) {
        return MetaHttpResponse::bad_request(e);
    }
    if let Err(e) = validate_data(body.kind, &body.data) {
        return MetaHttpResponse::bad_request(e);
    }
    let data_str = body
        .data
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap());

    let now = now_micros();
    let entry = OrgToolset {
        id: Ksuid::new(None, None).to_string(),
        org: org_id.clone(),
        name: body.name.clone(),
        kind: body.kind.to_string(),
        description: body.description.clone(),
        data: data_str,
        created_by: user_email.user_id.clone(),
        created_at: now,
        updated_at: now,
    };

    let id = entry.id.clone();
    let clash = |names: &[String]| normalized_clash(names, &body.name).map(str::to_string);
    match infra::table::org_ai_toolsets::add_checked(entry, clash).await {
        Ok(None) => {}
        Ok(Some(existing)) => {
            return MetaHttpResponse::conflict(format!(
                "toolset '{existing}' in org '{org_id}' already has the name '{}' once \
                 normalized; a second one would disable both",
                body.name
            ));
        }
        Err(infra::errors::Error::DbError(infra::errors::DbError::UniqueViolation)) => {
            return MetaHttpResponse::conflict(format!(
                "toolset '{}' already exists in org '{}'",
                body.name, org_id
            ));
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    let primary = infra::db::get_orm_client_rw().await;
    let saved = match infra::table::org_ai_toolsets::get_with(primary, &org_id, &id).await {
        Ok(Some(t)) => t,
        Ok(None) => return MetaHttpResponse::internal_error("toolset not found after insert"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let mut toolsets = [ToolsetResponse::from_toolset(saved)];
    flag_renames(&org_id, &mut toolsets).await;
    let [toolset] = toolsets;
    (StatusCode::OK, Json(toolset)).into_response()
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiToolset",
    summary = "Get an AI toolset",
    description = "Retrieves a single AI toolset by its id. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Toolset details", content_type = "application/json", body = ToolsetResponse),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get(
    Path(path): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let (org_id, id) = path;
    match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(t)) => {
            let mut toolsets = [ToolsetResponse::from_toolset(t)];
            flag_renames(&org_id, &mut toolsets).await;
            attach_health(&org_id, &mut toolsets).await;
            hide_mcp_urls(&org_id, &user_email.user_id, &mut toolsets).await;
            let [toolset] = toolsets;
            Json(toolset).into_response()
        }
        Ok(None) => MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/// Query parameters accepted by the list endpoint.
#[derive(Debug, Default, Deserialize)]
pub struct ListQuery {
    /// Substring filter on the toolset name (case-insensitive `LIKE '%val%'`).
    pub name: Option<String>,
    /// Exact filter on the toolset kind (`mcp`, `cli`, `skill`, `generic`).
    pub kind: Option<String>,
    /// Maximum number of results to return; a negative value is rejected with 400.
    pub limit: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiToolsets",
    summary = "List AI toolsets",
    description = "Lists AI toolsets for the org with optional filtering. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name"   = Option<String>, Query, description = "Substring filter on name (case-insensitive)"),
        ("kind"   = Option<String>, Query, description = "Exact filter on kind: mcp | cli | skill | generic"),
        ("limit"  = Option<u64>,   Query, description = "Maximum number of results"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "List of toolsets", content_type = "application/json", body = ToolsetListResponse),
        (status = 400, description = "Invalid query parameters, such as a negative limit"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list(
    Path(org_id): Path<String>,
    Query(params): Query<ListQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let filter = infra::table::org_ai_toolsets::ListFilter {
        name: params.name,
        kind: params.kind,
    };
    match infra::table::org_ai_toolsets::list(&org_id, filter, params.limit).await {
        Ok(toolsets) => {
            let mut res = ToolsetListResponse {
                toolsets: toolsets
                    .into_iter()
                    .map(ToolsetResponse::from_toolset)
                    .collect(),
            };
            flag_renames(&org_id, &mut res.toolsets).await;
            attach_health(&org_id, &mut res.toolsets).await;
            hide_mcp_urls(&org_id, &user_email.user_id, &mut res.toolsets).await;
            Json(res).into_response()
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

#[utoipa::path(
    put,
    path = "/{org_id}/ai/toolsets/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiToolset",
    summary = "Update an AI toolset",
    description = "Updates the description and/or data of an existing AI toolset. \
                   `data` is merged over the stored config, keeping top-level keys it omits, \
                   unless it carries `\"schema\": 2`, which replaces the config wholesale. \
                   A secret value of `***` keeps the stored value; when the MCP URL's origin \
                   changes every secret must be sent again. A merge update that omits the MCP \
                   limits (`allowed_tools`, `blocked_tools`, `write_tools`, `max_calls_per_turn`, \
                   `rate_limit`, `max_result_bytes`) keeps the stored ones; send `null` to clear \
                   one. A `\"schema\": 2` replacement drops every limit it omits, so it must \
                   resend any it wants to keep. A dropped `allowed_tools` means `[\"*\"]`, and \
                   `blocked_tools` still wins over it. \
                   Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    request_body(
        content = inline(ToolsetUpdateRequest),
        description = "Fields to update",
        content_type = "application/json",
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Toolset updated", content_type = "application/json", body = ToolsetResponse),
        (status = 400, description = "Invalid request", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update(
    Path(path): Path<(String, String)>,
    Json(body): Json<ToolsetUpdateRequest>,
) -> Response {
    let (org_id, id) = path;

    let updated = match write_update(&org_id, &id, body).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let mut toolsets = [ToolsetResponse::from_toolset(updated)];
    flag_renames(&org_id, &mut toolsets).await;
    let [toolset] = toolsets;
    Json(toolset).into_response()
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/_discover",
    context_path = "/api",
    tag = "AI",
    operation_id = "DiscoverAiToolsetTools",
    summary = "List an MCP toolset's tools",
    description = "Asks the MCP server, through the AI service, which tools it offers, \
                   without saving anything. The body is either an unsaved config \
                   (`url`, `headers`, `timeout_seconds`; no header value may be `***`) or a \
                   saved toolset's `id` with optional `overrides`, merged as a `PUT` would: \
                   `***` keeps a stored header unless the URL's origin changes. \
                   Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(DiscoverRequest),
        description = "The MCP server to list",
        content_type = "application/json",
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "The server's tools", content_type = "application/json", body = DiscoverResponse),
        (status = 400, description = "`{code, message}`: `url_refused` or `discovery_failed`", content_type = "application/json"),
        (status = 404, description = "No MCP toolset with this id", content_type = "application/json"),
        (status = 503, description = "`{code, message}`: `ai_service_unavailable` or `internal_secret_required`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn discover(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<DiscoverRequest>,
) -> Response {
    let target = discover_target(&body);
    let result = run_discovery(&org_id, body).await;
    let (status, outcome, count) = match &result {
        Ok(tools) => (StatusCode::OK, "ok", Some(tools.len())),
        Err(f) => (f.status, f.code, None),
    };
    audit_discovery(
        &org_id,
        &user_email.user_id,
        &target,
        status,
        outcome,
        count,
    )
    .await;
    match result {
        Ok(tools) => Json(DiscoverResponse { tools }).into_response(),
        Err(failure) => failure.into_response(),
    }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

#[utoipa::path(
    delete,
    path = "/{org_id}/ai/toolsets/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "DeleteAiToolset",
    summary = "Delete an AI toolset",
    description = "Permanently deletes an AI toolset. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Toolset deleted", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "delete"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete(Path(path): Path<(String, String)>) -> Response {
    let (org_id, id) = path;

    // Verify existence before deleting.
    let name = match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(row)) => row.name,
        Ok(None) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    if let Err(e) = infra::table::org_ai_toolsets::remove(&org_id, &id).await {
        return MetaHttpResponse::internal_error(e);
    }
    // A later toolset of the same name starts with no health history.
    if let Err(e) =
        infra::table::ai_toolset_health::remove(&org_id, &normalize_tool_name(&name)).await
    {
        log::warn!("failed to remove the health of toolset '{name}' in org={org_id}: {e}");
    }

    (
        StatusCode::OK,
        Json(MetaHttpResponse::message(
            StatusCode::OK,
            "toolset deleted successfully",
        )),
    )
        .into_response()
}

/// An MCP URL can carry its key in the userinfo, path or query; only toolset writers see it whole.
async fn hide_mcp_urls(org_id: &str, user_id: &str, toolsets: &mut [ToolsetResponse]) {
    if !toolsets.iter().any(|t| t.kind == ToolsetKind::Mcp)
        || check_permissions(
            org_id,
            org_id,
            user_id,
            "ai_toolsets",
            "PUT",
            None,
            true,
            false,
            false,
        )
        .await
    {
        return;
    }
    for toolset in toolsets.iter_mut().filter(|t| t.kind == ToolsetKind::Mcp) {
        if let Some(url) = toolset.data.as_mut().and_then(|d| d.get_mut("url"))
            && let Some(raw) = url.as_str()
        {
            *url = serde_json::Value::String(config::utils::str::url_origin(raw));
        }
    }
}

/// Merges and writes an update against the primary's current row, re-reading when another update
/// lands first.
async fn write_update(
    org_id: &str,
    id: &str,
    body: ToolsetUpdateRequest,
) -> Result<OrgToolset, Response> {
    const ATTEMPTS: usize = 3;
    let primary = infra::db::get_orm_client_rw().await;
    for _ in 0..ATTEMPTS {
        let existing = match infra::table::org_ai_toolsets::get_with(primary, org_id, id).await {
            Ok(Some(t)) => t,
            Ok(None) => {
                return Err(MetaHttpResponse::not_found(format!(
                    "toolset '{id}' not found"
                )));
            }
            Err(e) => return Err(MetaHttpResponse::internal_error(e)),
        };
        let data = updated_data(&existing.kind, existing.data.as_deref(), body.data.clone())
            .map_err(MetaHttpResponse::bad_request)?;
        let read_updated_at = existing.updated_at;
        let updated = OrgToolset {
            description: body.description.clone().or(existing.description),
            data,
            updated_at: now_micros().max(read_updated_at + 1),
            ..existing
        };
        match infra::table::org_ai_toolsets::update_if_unchanged(updated.clone(), read_updated_at)
            .await
        {
            Ok(true) => return Ok(updated),
            Ok(false) => continue,
            Err(e) => return Err(MetaHttpResponse::internal_error(e)),
        }
    }
    Err(MetaHttpResponse::conflict(format!(
        "toolset '{id}' kept changing while it was being updated; reload it and retry"
    )))
}

/// Each toolset's last call outcomes in this region, keyed by the name the agent uses.
async fn attach_health(org_id: &str, toolsets: &mut [ToolsetResponse]) {
    match infra::table::ai_toolset_health::list(org_id).await {
        Ok(rows) => fill_health(&rows, toolsets),
        Err(e) => log::warn!("failed to read toolset health for org={org_id}: {e}"),
    }
}

fn fill_health(
    rows: &std::collections::HashMap<String, infra::table::ai_toolset_health::ToolsetHealth>,
    toolsets: &mut [ToolsetResponse],
) {
    for toolset in toolsets {
        toolset.health = rows
            .get(&normalize_tool_name(&toolset.name))
            .map(|row| ToolsetHealth {
                last_ok_at: row.last_ok_at,
                last_error_at: row.last_error_at,
                failing_since: row.failing_since,
                last_error: row.last_error.clone(),
            });
    }
}

/// Flags toolsets whose normalized name another row of the org shares; the agent is sent neither.
async fn flag_renames(org_id: &str, toolsets: &mut [ToolsetResponse]) {
    match infra::table::org_ai_toolsets::list_names(org_id).await {
        Ok(names) => mark_renames(&names, toolsets),
        Err(e) => log::warn!("failed to list toolset names for org={org_id}: {e}"),
    }
}

/// Another raw name that normalizes to `name`; the row named `name` itself is the unique index's
/// job.
fn normalized_clash<'a>(org_names: &'a [String], name: &str) -> Option<&'a str> {
    org_names
        .iter()
        .map(String::as_str)
        .find(|existing| *existing != name && normalize_tool_name(existing) == name)
}

fn mark_renames(org_names: &[String], toolsets: &mut [ToolsetResponse]) {
    let colliding = colliding_names(org_names.iter().map(String::as_str));
    for toolset in toolsets {
        toolset.rename_needed = colliding.contains(&normalize_tool_name(&toolset.name));
    }
}

/// The `data` a `PUT` stores: the request's `data` merged over the stored one, then validated.
fn updated_data(
    kind: &str,
    stored: Option<&str>,
    incoming: Option<serde_json::Value>,
) -> Result<Option<String>, String> {
    let Some(incoming) = incoming else {
        return Ok(stored.map(str::to_string));
    };
    // An unknown stored kind was never validated, so it is merged like generic data.
    let kind = kind.parse::<ToolsetKind>().unwrap_or(ToolsetKind::Generic);
    let stored = stored.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
    let merged = Some(merge_update_data(kind, stored.as_ref(), incoming)?);
    validate_data(kind, &merged)?;
    Ok(merged.map(|v| v.to_string()))
}

async fn run_discovery(
    org_id: &str,
    body: DiscoverRequest,
) -> Result<Vec<DiscoveredTool>, DiscoverFailure> {
    let stored = match body.id.as_deref() {
        Some(id) => {
            let primary = infra::db::get_orm_client_rw().await;
            match infra::table::org_ai_toolsets::get_with(primary, org_id, id).await {
                Ok(row) => row,
                Err(e) => {
                    log::error!("[AI] toolset discovery: reading toolset {id} failed: {e}");
                    return Err(DiscoverFailure {
                        status: StatusCode::INTERNAL_SERVER_ERROR,
                        code: "internal_error",
                        message: "the toolset could not be read".to_string(),
                    });
                }
            }
        }
        None => None,
    };
    let entry = discover_entry(stored.as_ref(), body)?;
    let client = get_agent_client().ok_or_else(|| {
        DiscoverFailure::from(DiscoverError::Unavailable(
            "the agent client is not initialized".to_string(),
        ))
    })?;
    client
        .discover_toolset(org_id, &entry)
        .await
        .map_err(DiscoverFailure::from)
}

/// The config to list: the body's own, or the saved row with `overrides` merged as a `PUT` would.
fn discover_entry(
    stored: Option<&OrgToolset>,
    body: DiscoverRequest,
) -> Result<McpEntry, DiscoverFailure> {
    let data = match (body.id.as_deref(), stored) {
        (Some(id), None) => {
            return Err(DiscoverFailure::not_found(format!(
                "toolset '{id}' not found"
            )));
        }
        (Some(id), Some(row)) => {
            if row.kind.parse::<ToolsetKind>() != Ok(ToolsetKind::Mcp) {
                return Err(DiscoverFailure::not_found(format!(
                    "toolset '{id}' is not an MCP toolset"
                )));
            }
            let saved = row
                .data
                .as_deref()
                .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok());
            let overrides = body
                .overrides
                .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
            merge_update_data(ToolsetKind::Mcp, saved.as_ref(), overrides)
                .map_err(DiscoverFailure::refused)?
        }
        (None, _) => {
            let mut data = serde_json::Map::new();
            data.insert("url".into(), body.url.unwrap_or_default().into());
            for (key, value) in [
                ("headers", body.headers),
                ("timeout_seconds", body.timeout_seconds),
            ] {
                if let Some(value) = value {
                    data.insert(key.into(), value);
                }
            }
            let data = serde_json::Value::Object(data);
            // With no saved row a `***` would be sent to the server as the header's value.
            merge_update_data(ToolsetKind::Mcp, None, data).map_err(DiscoverFailure::refused)?
        }
    };
    validate_data(ToolsetKind::Mcp, &Some(data.clone())).map_err(DiscoverFailure::refused)?;
    let mcp: McpData = serde_json::from_value(data)
        .map_err(|e| DiscoverFailure::refused(format!("invalid mcp data: {e}")))?;
    // A `Host` header would send a credential kept for the checked URL to another virtual host.
    if mcp
        .headers
        .keys()
        .any(|k| k.trim().eq_ignore_ascii_case("host"))
    {
        return Err(DiscoverFailure::refused(
            "a `Host` header is not allowed; the URL decides which host is called",
        ));
    }
    Ok(McpEntry {
        name: "discovery".to_string(),
        url: mcp.url,
        headers: mcp.headers,
        timeout_seconds: mcp.timeout_seconds,
        ..Default::default()
    })
}

/// What the audit entry names: the saved toolset, else the URL's origin, never a header.
fn discover_target(body: &DiscoverRequest) -> serde_json::Value {
    match (&body.id, &body.url) {
        (Some(id), _) => serde_json::json!({"toolset_id": id}),
        (None, Some(url)) => {
            serde_json::json!({"url_origin": config::utils::str::url_origin(url)})
        }
        (None, None) => serde_json::json!({}),
    }
}

fn discover_audit_body(
    target: &serde_json::Value,
    outcome: &str,
    tool_count: Option<usize>,
) -> String {
    let mut body = target.clone();
    body["outcome"] = outcome.into();
    if let Some(count) = tool_count {
        body["tools"] = count.into();
    }
    body.to_string()
}

/// The generic middleware skips `_discover`, whose body carries header values; this entry has none.
async fn audit_discovery(
    org_id: &str,
    user_id: &str,
    target: &serde_json::Value,
    status: StatusCode,
    outcome: &str,
    tool_count: Option<usize>,
) {
    if !get_o2_config().common.audit_enabled {
        return;
    }
    audit::audit(AuditMessage {
        login_ip: None,
        user_agent: None,
        user_email: user_id.to_string(),
        org_id: org_id.to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: format!("/api/{org_id}/ai/toolsets/_discover"),
            http_query_params: String::new(),
            http_body: discover_audit_body(target, outcome, tool_count),
            http_response_code: status.as_u16(),
            error_msg: None,
            trace_id: None,
        },
        delegated: None,
        fleet_id: None,
        target: None,
    })
    .await;
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    async fn body_of(resp: Response) -> Value {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn response(name: &str) -> ToolsetResponse {
        ToolsetResponse {
            id: name.to_string(),
            org: "org".to_string(),
            name: name.to_string(),
            kind: ToolsetKind::Mcp,
            description: None,
            data: None,
            created_by: "u".to_string(),
            created_at: 0,
            updated_at: 0,
            rename_needed: false,
            health: None,
        }
    }

    fn stored_mcp() -> String {
        json!({
            "url": "https://mcp.datadoghq.com/api/mcp",
            "headers": {"DD-API-KEY": "api-secret"},
            "timeout_seconds": 30,
            "allowed_tools": ["search_logs"]
        })
        .to_string()
    }

    fn parsed(data: Option<String>) -> Value {
        serde_json::from_str(&data.unwrap()).unwrap()
    }

    #[tokio::test]
    async fn create_rejects_a_name_that_is_not_already_normalized() {
        for name in [
            "Datadog Prod",
            "datadog_prod",
            "-x",
            "x-",
            "a--b",
            &"a".repeat(65),
        ] {
            let resp = create(
                Path("org".to_string()),
                Headers(UserEmail {
                    user_id: "u@example.com".to_string(),
                }),
                Json(ToolsetCreateRequest {
                    name: name.to_string(),
                    kind: ToolsetKind::Skill,
                    description: None,
                    data: Some(json!({"content": "x"})),
                }),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{name}");
            let body = body_of(resp).await;
            let message = body["message"].as_str().unwrap();
            assert!(
                message.contains("^[a-z0-9]+(-[a-z0-9]+)*$"),
                "{name}: {message}"
            );
        }
    }

    #[test]
    fn create_conflicts_with_a_row_that_normalizes_to_the_same_name() {
        let org_names = ["GitHub", "Datadog Prod", "kubectl"].map(String::from);
        assert_eq!(normalized_clash(&org_names, "github"), Some("GitHub"));
        assert_eq!(
            normalized_clash(&org_names, "datadog-prod"),
            Some("Datadog Prod")
        );
        assert_eq!(normalized_clash(&org_names, "kubectl"), None);
        assert_eq!(normalized_clash(&org_names, "datadog-staging"), None);
        assert_eq!(normalized_clash(&[], "github"), None);
    }

    #[test]
    fn update_without_data_keeps_the_stored_data() {
        let stored = stored_mcp();
        assert_eq!(
            updated_data("mcp", Some(&stored), None).unwrap(),
            Some(stored)
        );
    }

    #[test]
    fn update_merges_over_stored_data_and_restores_redacted_secrets() {
        let data = updated_data(
            "mcp",
            Some(&stored_mcp()),
            Some(json!({
                "url": "https://mcp.datadoghq.com/api/mcp",
                "headers": {"DD-API-KEY": "***"},
                "timeout_seconds": 45
            })),
        )
        .unwrap();
        assert_eq!(
            parsed(data),
            json!({
                "url": "https://mcp.datadoghq.com/api/mcp",
                "headers": {"DD-API-KEY": "api-secret"},
                "timeout_seconds": 45,
                "allowed_tools": ["search_logs"]
            })
        );
    }

    #[test]
    fn update_keeps_stored_mcp_limits_it_does_not_send_and_validates_new_ones() {
        let stored = json!({
            "url": "https://mcp.datadoghq.com/api/mcp",
            "headers": {"DD-API-KEY": "api-secret"},
            "allowed_tools": ["search_*"],
            "blocked_tools": ["delete_*"],
            "write_tools": [],
            "max_calls_per_turn": 20,
            "rate_limit": {"calls": 50, "per_seconds": 10},
            "max_result_bytes": 65536
        })
        .to_string();
        let data = updated_data(
            "mcp",
            Some(&stored),
            Some(json!({
                "url": "https://mcp.datadoghq.com/api/mcp",
                "headers": {"DD-API-KEY": "***"},
                "timeout_seconds": 60,
                "max_calls_per_turn": null
            })),
        )
        .unwrap();
        let merged = parsed(data);
        assert_eq!(merged["allowed_tools"], json!(["search_*"]));
        assert_eq!(merged["blocked_tools"], json!(["delete_*"]));
        assert_eq!(merged["write_tools"], json!([]));
        assert_eq!(
            merged["rate_limit"],
            json!({"calls": 50, "per_seconds": 10})
        );
        assert_eq!(merged["max_result_bytes"], 65536);
        assert_eq!(
            merged["max_calls_per_turn"],
            json!(null),
            "null clears the limit"
        );
        assert_eq!(merged["timeout_seconds"], 60);

        let err = updated_data(
            "mcp",
            Some(&stored),
            Some(json!({"rate_limit": {"calls": 0, "per_seconds": 10}})),
        )
        .unwrap_err();
        assert!(err.contains("rate_limit.calls"), "{err}");
    }

    #[test]
    fn update_with_schema_2_replaces_the_stored_data() {
        let data = updated_data(
            "mcp",
            Some(&stored_mcp()),
            Some(json!({"schema": 2, "url": "https://mcp.datadoghq.com/api/mcp"})),
        )
        .unwrap();
        assert_eq!(
            parsed(data),
            json!({"schema": 2, "url": "https://mcp.datadoghq.com/api/mcp"})
        );
    }

    #[test]
    fn update_refuses_redacted_secrets_for_a_new_url_origin() {
        let err = updated_data(
            "mcp",
            Some(&stored_mcp()),
            Some(json!({
                "url": "https://attacker.example/api/mcp",
                "headers": {"DD-API-KEY": "***"}
            })),
        )
        .unwrap_err();
        assert!(
            err.contains("re-enter secrets when the URL's host changes"),
            "{err}"
        );
    }

    #[test]
    fn update_validates_the_merged_data() {
        let err = updated_data(
            "mcp",
            Some(&stored_mcp()),
            Some(json!({"schema": 2, "headers": {}})),
        )
        .unwrap_err();
        assert!(err.contains("invalid mcp data"), "{err}");
    }

    #[test]
    fn health_is_attached_by_the_name_the_agent_uses() {
        use infra::table::ai_toolset_health::ToolsetHealth as Row;
        let rows = std::collections::HashMap::from([(
            "datadog-prod".to_string(),
            Row {
                org: "org".to_string(),
                toolset: "datadog-prod".to_string(),
                last_ok_at: Some(1),
                last_error_at: Some(5),
                failing_since: Some(3),
                last_error: Some("401 Unauthorized".to_string()),
            },
        )]);
        let mut toolsets = [response("datadog-prod"), response("github")];
        fill_health(&rows, &mut toolsets);
        assert_eq!(
            toolsets[0].health,
            Some(ToolsetHealth {
                last_ok_at: Some(1),
                last_error_at: Some(5),
                failing_since: Some(3),
                last_error: Some("401 Unauthorized".to_string()),
            })
        );
        assert_eq!(toolsets[1].health, None);
    }

    #[test]
    fn rename_needed_is_set_on_every_row_sharing_a_normalized_name() {
        let org_names = ["Datadog Prod", "datadog-prod", "github"].map(String::from);
        let mut toolsets = [
            response("Datadog Prod"),
            response("datadog-prod"),
            response("github"),
        ];
        mark_renames(&org_names, &mut toolsets);
        let flags: Vec<bool> = toolsets.iter().map(|t| t.rename_needed).collect();
        assert_eq!(flags, [true, true, false]);
    }

    fn row(kind: &str, data: Value) -> OrgToolset {
        OrgToolset {
            id: "t1".to_string(),
            org: "org".to_string(),
            name: "datadog-prod".to_string(),
            kind: kind.to_string(),
            description: None,
            data: Some(data.to_string()),
            created_by: "u".to_string(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn by_id(overrides: Option<Value>) -> DiscoverRequest {
        DiscoverRequest {
            id: Some("t1".to_string()),
            overrides,
            ..Default::default()
        }
    }

    #[test]
    fn discovery_of_a_saved_toolset_uses_its_stored_secrets() {
        let stored = row("mcp", serde_json::from_str(&stored_mcp()).unwrap());
        let entry = discover_entry(Some(&stored), by_id(None)).unwrap();
        assert_eq!(entry.url, "https://mcp.datadoghq.com/api/mcp");
        assert_eq!(entry.headers["DD-API-KEY"], "api-secret");

        let overrides = json!({"url": "https://mcp.datadoghq.com/v2/mcp", "headers": {"DD-API-KEY": "***"}, "timeout_seconds": 50});
        let entry = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap();
        assert_eq!(entry.url, "https://mcp.datadoghq.com/v2/mcp");
        assert_eq!(entry.headers["DD-API-KEY"], "api-secret");
        assert_eq!(entry.timeout_seconds, 50);
    }

    #[test]
    fn discovery_refuses_stored_secrets_for_a_new_origin() {
        let stored = row("mcp", serde_json::from_str(&stored_mcp()).unwrap());
        for overrides in [
            json!({"url": "https://attacker.example/mcp", "headers": {"DD-API-KEY": "***"}}),
            json!({"url": "https://attacker.example/mcp"}),
        ] {
            let err = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap_err();
            assert_eq!(err.status, StatusCode::BAD_REQUEST);
            assert!(err.message.contains("re-enter secrets"), "{}", err.message);
        }
    }

    #[test]
    fn discovery_refuses_a_host_header_with_or_without_a_saved_row() {
        let stored = row("mcp", serde_json::from_str(&stored_mcp()).unwrap());
        for host in ["Host", "host", " HOST "] {
            let overrides = json!({"headers": {"DD-API-KEY": "***", host: "internal.example"}});
            let err = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap_err();
            assert_eq!(err.status, StatusCode::BAD_REQUEST, "{host}");
            assert!(err.message.contains("`Host`"), "{}", err.message);

            let unsaved = DiscoverRequest {
                url: Some("https://mcp.example.com/mcp".to_string()),
                headers: Some(json!({host: "internal.example"})),
                ..Default::default()
            };
            let err = discover_entry(None, unsaved).unwrap_err();
            assert_eq!(err.status, StatusCode::BAD_REQUEST, "{host}");
        }
    }

    #[test]
    fn discovery_of_an_unknown_or_non_mcp_id_is_404() {
        let err = discover_entry(None, by_id(None)).unwrap_err();
        assert_eq!(err.status, StatusCode::NOT_FOUND);
        let cli = row("cli", json!({"command": "kubectl"}));
        let err = discover_entry(Some(&cli), by_id(None)).unwrap_err();
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn discovery_without_an_id_refuses_redacted_values_and_bad_urls() {
        let unsaved = |url: &str, headers: Value| DiscoverRequest {
            url: Some(url.to_string()),
            headers: Some(headers),
            ..Default::default()
        };
        let entry = discover_entry(
            None,
            unsaved("https://mcp.example.com/mcp", json!({"X-Key": "k"})),
        )
        .unwrap();
        assert_eq!(entry.headers["X-Key"], "k");
        assert_eq!(entry.timeout_seconds, 30);

        let err = discover_entry(
            None,
            unsaved("https://mcp.example.com/mcp", json!({"X-Key": "***"})),
        )
        .unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert!(err.message.contains("X-Key"), "{}", err.message);

        let err = discover_entry(
            None,
            unsaved("https://mcp.example.com\\@evil.example/", json!({})),
        )
        .unwrap_err();
        assert!(
            err.message.starts_with("invalid mcp url"),
            "{}",
            err.message
        );
    }

    #[test]
    fn the_discovery_audit_entry_names_no_secret() {
        let body = DiscoverRequest {
            url: Some("https://user:pw@mcp.example.com/mcp?key=s3cret".to_string()),
            headers: Some(json!({"DD-API-KEY": "api-secret"})),
            ..Default::default()
        };
        let audited = discover_audit_body(&discover_target(&body), "ok", Some(12));
        assert_eq!(
            serde_json::from_str::<Value>(&audited).unwrap(),
            json!({"url_origin": "https://mcp.example.com", "outcome": "ok", "tools": 12})
        );
        for secret in ["api-secret", "s3cret", "pw"] {
            assert!(!audited.contains(secret), "{audited}");
        }
        let audited = discover_audit_body(&discover_target(&by_id(None)), "discovery_failed", None);
        assert_eq!(
            serde_json::from_str::<Value>(&audited).unwrap(),
            json!({"toolset_id": "t1", "outcome": "discovery_failed"})
        );
    }

    #[test]
    fn discovery_errors_map_to_their_statuses() {
        let cases = [
            (
                DiscoverError::Refused {
                    code: "url_refused".to_string(),
                    message: "loopback".to_string(),
                },
                StatusCode::BAD_REQUEST,
                "url_refused",
            ),
            (
                DiscoverError::Refused {
                    code: "discovery_failed".to_string(),
                    message: "HTTP 401".to_string(),
                },
                StatusCode::BAD_REQUEST,
                "discovery_failed",
            ),
            (
                DiscoverError::InternalSecretRequired,
                StatusCode::SERVICE_UNAVAILABLE,
                "internal_secret_required",
            ),
            (
                DiscoverError::Unavailable("down".to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
                "ai_service_unavailable",
            ),
        ];
        for (error, status, code) in cases {
            let failure = DiscoverFailure::from(error);
            assert_eq!((failure.status, failure.code), (status, code));
        }
    }
}

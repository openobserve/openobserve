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

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::{
    ssrf_guard::{self, SsrfGuard},
    time::now_micros,
};
use infra::table::org_ai_toolsets::{HealthOutcome, OrgToolset};
use o2_enterprise::enterprise::ai::toolsets::{
    DestinationChanged, McpData, ToolsetCreateRequest, ToolsetKind, ToolsetListResponse,
    ToolsetResponse, ToolsetUpdateRequest, merge_redacted, push::normalize_tool_name,
    validate_data,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    capabilities,
    error::{self, AiErrorCode, AiErrorEnvelope},
};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const TEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PENDING_LINE: usize = 1 << 20;
// A toolset used many times in a turn is written once a minute unless its state changes.
const HEALTH_WRITE_INTERVAL: Duration = Duration::from_secs(60);
const CALL_FAILED: &str = "The last call through this toolset failed";
// One sentence for every network outcome, so a test never tells hosts or ports apart.
const TEST_FAILED: &str = "The toolset's server did not list its tools";
const TEST_INVALID: &str = "The toolset's configuration is not valid";
const URL_REFUSED: &str = "The toolset URL must not reach a loopback, private, link-local or \
                           metadata address unless the operator allows it";
const URL_UNRESOLVED: &str = "The toolset URL's host can't be resolved";

static LAST_TEST: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Mutex::default);
static LAST_HEALTH: LazyLock<Mutex<HealthWrites>> = LazyLock::new(Mutex::default);

/// Per `(org, toolset id)`: whether the last written call succeeded, and when.
type HealthWrites = HashMap<(String, String), (bool, Instant)>;

/// `PATCH` body: only the switch.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ToolsetPatch {
    pub enabled: bool,
}

/// `POST /api/{org_id}/ai/toolsets/{id}/test`; `error.message` is a fixed sentence.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ToolsetTestResult {
    pub ok: bool,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ToolsetTestError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ToolsetTestError {
    pub code: String,
    pub message: String,
}

impl ToolsetTestError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

/// The org's enabled toolsets as tool frames name them, so a turn can report their use.
#[derive(Debug, Default)]
pub(crate) struct ToolsetUse {
    org_id: String,
    /// `(id, normalized name)`, longest name first so a prefix never shadows a longer one.
    names: Vec<(String, String)>,
    // The unterminated tail of the last chunk; a frame split across chunks is joined here.
    partial: Mutex<Vec<u8>>,
}

impl ToolsetUse {
    pub(crate) async fn load(org_id: &str) -> Self {
        let names = match infra::table::org_ai_toolsets::list_names(org_id).await {
            Ok(toolsets) => toolsets,
            Err(e) => {
                log::warn!("[org_id:{org_id}] toolset health not tracked this turn: {e}");
                Vec::new()
            }
        };
        Self::new(org_id, names)
    }

    fn new(org_id: &str, toolsets: Vec<(String, String, bool)>) -> Self {
        let mut names: Vec<(String, String)> = toolsets
            .into_iter()
            .filter(|(_, _, enabled)| *enabled)
            .map(|(id, name, _)| (id, normalize_tool_name(&name)))
            .collect();
        names.sort_by_key(|(_, name)| std::cmp::Reverse(name.len()));
        Self {
            org_id: org_id.to_string(),
            names,
            partial: Mutex::new(Vec::new()),
        }
    }

    /// Records each `tool_result` frame in `chunk` against the toolset that served it.
    pub(crate) fn note(&self, chunk: &[u8]) {
        if self.names.is_empty() {
            return;
        }
        for (id, ok) in self.results(chunk) {
            record_use(&self.org_id, &id, ok);
        }
    }

    fn results(&self, chunk: &[u8]) -> Vec<(String, bool)> {
        let complete = {
            let mut partial = self
                .partial
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            partial.extend_from_slice(chunk);
            let complete = match partial.iter().rposition(|b| *b == b'\n') {
                Some(end) => partial.drain(..=end).collect::<Vec<u8>>(),
                None => Vec::new(),
            };
            if partial.len() > MAX_PENDING_LINE {
                partial.clear();
            }
            complete
        };
        if !complete.windows(11).any(|w| w == b"tool_result") {
            return Vec::new();
        }
        std::str::from_utf8(&complete)
            .into_iter()
            .flat_map(str::lines)
            .filter_map(|line| line.strip_prefix("data: "))
            .filter_map(|data| serde_json::from_str::<serde_json::Value>(data).ok())
            .filter(|frame| frame["type"] == "tool_result")
            .filter_map(|frame| {
                let tool = frame["tool"].as_str()?;
                let id = self.toolset_of(tool)?;
                Some((id, frame["success"].as_bool().unwrap_or(false)))
            })
            .collect()
    }

    fn toolset_of(&self, tool: &str) -> Option<String> {
        self.names
            .iter()
            .find(|(_, name)| {
                tool.strip_prefix("cli_") == Some(name.as_str())
                    || tool
                        .strip_prefix(name.as_str())
                        .is_some_and(|rest| rest.starts_with(['_', '-']))
            })
            .map(|(id, _)| id.clone())
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
    summary = "Create an AI toolset",
    description = "Creates a new AI toolset (MCP server, CLI tool, skill, or generic config). \
                   The `data` field is encrypted at rest using per-org envelope encryption. \
                   Only available in enterprise deployments.",
    request_body(
        content = inline(ToolsetCreateRequest),
        description = "Toolset configuration",
        content_type = "application/json",
    ),
    responses(
        (status = 200, description = "Toolset created", content_type = "application/json"),
        (status = 400, description = "Invalid request", content_type = "application/json"),
        (status = 409, description = "Toolset with this name already exists", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<ToolsetCreateRequest>,
) -> Response {
    if let Err(e) = validate_data(body.kind, &body.data) {
        return MetaHttpResponse::bad_request(e);
    }
    if let Err(refusal) = admit_url(body.kind, body.data.as_ref()).await {
        return refusal;
    }

    let data_str = body
        .data
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap());

    let now = now_micros();
    let entry = OrgToolset {
        id: String::new(), // generated by add()
        org: org_id.clone(),
        name: body.name.clone(),
        kind: body.kind.to_string(),
        description: body.description.clone(),
        data: data_str,
        created_by: user_email.user_id.clone(),
        created_at: now,
        updated_at: now,
        enabled: true,
        status_state: None,
        status_since: None,
        last_error: None,
        last_used_at: None,
    };

    match infra::table::org_ai_toolsets::add(entry).await {
        Ok(_) => {}
        Err(infra::errors::Error::DbError(infra::errors::DbError::UniqueViolation)) => {
            return MetaHttpResponse::conflict(format!(
                "toolset '{}' already exists in org '{}'",
                body.name, org_id
            ));
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    // Fetch the saved record to get the generated id.
    let saved = match infra::table::org_ai_toolsets::get_by_name(&org_id, &body.name).await {
        Ok(Some(t)) => t,
        Ok(None) => return MetaHttpResponse::internal_error("toolset not found after insert"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    (StatusCode::OK, Json(ToolsetResponse::from_toolset(saved))).into_response()
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
    responses(
        (status = 200, description = "Toolset details", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get(Path(path): Path<(String, String)>) -> Response {
    let (org_id, id) = path;
    match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(t)) => Json(ToolsetResponse::from_toolset(t)).into_response(),
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
    /// Maximum number of results to return.
    pub limit: Option<i64>,
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
        ("limit"  = Option<i64>,   Query, description = "Maximum number of results"),
    ),
    responses(
        (status = 200, description = "List of toolsets", content_type = "application/json"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list(Path(org_id): Path<String>, Query(params): Query<ListQuery>) -> Response {
    let filter = infra::table::org_ai_toolsets::ListFilter {
        name: params.name,
        kind: params.kind,
    };
    match infra::table::org_ai_toolsets::list(&org_id, filter, params.limit).await {
        Ok(toolsets) => {
            let res = ToolsetListResponse {
                toolsets: toolsets
                    .into_iter()
                    .map(ToolsetResponse::from_toolset)
                    .collect(),
            };
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
                   When `data` is provided it replaces the existing config, except that a \
                   secret (MCP `headers`, CLI `env` and `credential_files` values) sent as \
                   `***` keeps its stored value; a secret key left out is removed. Keeping \
                   any `***` requires every destination field (MCP `url`; CLI `command`, \
                   `allowed_subcommands`, `blocked_subcommands`, `requires_confirmation`) and \
                   every entry of `headers`, `env` and `credential_files` to stay unchanged, \
                   except removals; otherwise the save is refused with 400 \
                   `invalid_request` naming the changed `fields`, and nothing is saved. \
                   Rotating one secret therefore means re-entering all of them. \
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
    responses(
        (status = 200, description = "Toolset updated", content_type = "application/json"),
        (status = 400, description = "Invalid request, or a `***` secret kept while a destination field or another secret entry changed (`invalid_request`, `error_code: destination_changed`, `fields`)", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update(
    Path(path): Path<(String, String)>,
    Json(body): Json<ToolsetUpdateRequest>,
) -> Response {
    let (org_id, id) = path;

    let existing = match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(t)) => t,
        Ok(None) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let kind = existing.kind.parse::<ToolsetKind>().ok();
    // The GET redacts secrets to `***`, so they are restored before validation and encryption.
    let merged = body
        .data
        .map(|incoming| merge_secrets(&org_id, &id, kind, existing.data.as_deref(), incoming))
        .transpose();
    let data = match merged {
        Ok(data) => data,
        Err(changed) => return destination_changed(&changed),
    };
    if data.is_some()
        && let Some(kind) = kind
        && let Err(e) = validate_data(kind, &data)
    {
        return MetaHttpResponse::bad_request(e);
    }
    if let Some(kind) = kind
        && let Err(refusal) = admit_url(kind, data.as_ref()).await
    {
        return refusal;
    }

    let data_str = data
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap())
        .or_else(|| existing.data.clone());

    let updated = OrgToolset {
        description: body.description.or(existing.description.clone()),
        data: data_str,
        updated_at: now_micros(),
        ..existing
    };

    if let Err(e) = infra::table::org_ai_toolsets::update(updated.clone()).await {
        return MetaHttpResponse::internal_error(e);
    }

    Json(ToolsetResponse::from_toolset(updated)).into_response()
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
    responses(
        (status = 200, description = "Toolset deleted", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete(Path(path): Path<(String, String)>) -> Response {
    let (org_id, id) = path;

    // Verify existence before deleting.
    match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    if let Err(e) = infra::table::org_ai_toolsets::remove(&org_id, &id).await {
        return MetaHttpResponse::internal_error(e);
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

#[utoipa::path(
    patch,
    path = "/{org_id}/ai/toolsets/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "PatchAiToolset",
    summary = "Turn an AI toolset on or off",
    description = "Body `{enabled}` only. A disabled toolset is not given to the assistant or \
                   incident analysis from their next turn on; its status reads `disabled`. \
                   Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    request_body(content = ToolsetPatch, content_type = "application/json"),
    responses(
        (status = 200, description = "The toolset", body = ToolsetResponse, content_type = "application/json"),
        (status = 400, description = "A field other than `enabled`", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn patch(Path((org_id, id)): Path<(String, String)>, body: Bytes) -> Response {
    let body: ToolsetPatch = match error::json_body(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    match infra::table::org_ai_toolsets::set_enabled(&org_id, &id, body.enabled, now_micros()).await
    {
        Ok(true) => {}
        Ok(false) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }
    log::info!("[org_id:{org_id}] toolset {id} enabled={}", body.enabled);
    match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(t)) => Json(ToolsetResponse::from_toolset(t)).into_response(),
        Ok(None) => MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/{id}/test",
    context_path = "/api",
    tag = "AI",
    operation_id = "TestAiToolset",
    summary = "Check that an AI toolset works",
    description = "Org admins and root only. An MCP toolset is asked to list its tools with \
                   its stored credentials; a CLI or skill toolset has its configuration \
                   checked, since only O2 Assistant runs it. Creates no chat, spends no \
                   credit and never returns a secret or the server's own text: \
                   `error.message` is a fixed sentence and every network failure is the \
                   same `failed` with `duration_ms: 0`. The URL must not resolve to a \
                   loopback, private, link-local, CGNAT or metadata address unless the \
                   operator allows it with `ZO_SSRF_ALLOWED_CIDRS` / `ZO_SSRF_ALLOWED_HOSTS`; \
                   no redirect is followed. The result becomes the toolset's status. At most \
                   one test per toolset and one per user every 10 s on a node.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    responses(
        (status = 200, description = "Test result", body = ToolsetTestResult, content_type = "application/json"),
        (status = 403, description = "Not an organization admin", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 429, description = "Tested moments ago (`rate_limited`)", content_type = "application/json"),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn test(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !capabilities::is_org_admin(&org_id, &user_email.user_id).await {
        return error::permission_denied("Only organization administrators can test a toolset");
    }
    let admitted = capabilities::admit_test(
        &mut LAST_TEST.lock().unwrap(),
        &format!("{org_id}/{id}"),
        &user_email.user_id,
        Instant::now(),
    );
    if let Err(wait) = admitted {
        return AiErrorEnvelope::new(
            AiErrorCode::RateLimited,
            "This toolset was tested moments ago; please wait",
        )
        .retry_after(Some(wait.as_secs().max(1)))
        .into_response();
    }
    let toolset = match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(t)) => t,
        Ok(None) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let started = Instant::now();
    let error = check_toolset(&toolset).await;
    // A failure's timing would still tell a closed port from a slow one.
    let duration_ms = match error {
        None => u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        Some(_) => 0,
    };
    let outcome = match &error {
        None => HealthOutcome::Ok,
        Some(error) => HealthOutcome::Failing(&error.message),
    };
    if let Err(e) =
        infra::table::org_ai_toolsets::record_health(&org_id, &id, outcome, now_micros()).await
    {
        log::warn!("[org_id:{org_id}] toolset {id} test result not stored: {e}");
    }
    Json(ToolsetTestResult {
        ok: error.is_none(),
        duration_ms,
        error,
    })
    .into_response()
}

/// `incoming` with every secret sent as `***` given back its stored value; logs key names only.
fn merge_secrets(
    org_id: &str,
    id: &str,
    kind: Option<ToolsetKind>,
    stored: Option<&str>,
    incoming: serde_json::Value,
) -> Result<serde_json::Value, DestinationChanged> {
    let Some(kind) = kind else {
        return Ok(incoming);
    };
    let stored = stored.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    let merge = merge_redacted(kind, stored.as_ref(), incoming).inspect_err(|changed| {
        log::warn!(
            "[org_id:{org_id}] toolset {id} update refused: secrets kept while {:?} changed",
            changed.fields
        );
    })?;
    if !(merge.kept.is_empty() && merge.replaced.is_empty() && merge.unmatched.is_empty()) {
        log::info!(
            "[org_id:{org_id}] toolset {id} secrets kept={:?} replaced={:?} dropped={:?}",
            merge.kept,
            merge.replaced,
            merge.unmatched
        );
    }
    Ok(merge.data)
}

/// An MCP toolset's URL passes the SSRF policy Test uses, since o2-ai connects to it on every turn.
async fn admit_url(kind: ToolsetKind, data: Option<&serde_json::Value>) -> Result<(), Response> {
    let url = match (kind, data.and_then(|d| d.get("url")?.as_str())) {
        (ToolsetKind::Mcp, Some(url)) => url,
        _ => return Ok(()),
    };
    SsrfGuard::validate_destination_url_with_config_async(url)
        .await
        .map_err(|e| {
            log::info!("[toolset] URL refused: {e}");
            error::invalid_request(refusal_sentence(&e))
        })
}

/// The fixed sentence for a guard refusal: a host that does not resolve is not a private address.
fn refusal_sentence(guard_error: &str) -> &'static str {
    if guard_error.starts_with("Failed to resolve host")
        || guard_error.ends_with("resolved to no addresses")
    {
        URL_UNRESOLVED
    } else {
        URL_REFUSED
    }
}

/// Stores one call's outcome unless the same state was written moments ago.
fn record_use(org_id: &str, id: &str, ok: bool) {
    let key = (org_id.to_string(), id.to_string());
    let now = Instant::now();
    {
        let mut last = LAST_HEALTH.lock().unwrap();
        if let Some((state, at)) = last.get(&key)
            && *state == ok
            && now.saturating_duration_since(*at) < HEALTH_WRITE_INTERVAL
        {
            return;
        }
        last.retain(|_, (_, at)| now.saturating_duration_since(*at) < HEALTH_WRITE_INTERVAL);
        last.insert(key, (ok, now));
    }
    let (org_id, id) = (org_id.to_string(), id.to_string());
    tokio::spawn(async move {
        let outcome = if ok {
            HealthOutcome::Ok
        } else {
            HealthOutcome::Failing(CALL_FAILED)
        };
        if let Err(e) =
            infra::table::org_ai_toolsets::record_health(&org_id, &id, outcome, now_micros()).await
        {
            log::warn!("[org_id:{org_id}] toolset {id} health not stored: {e}");
        }
    });
}

/// `None` when the toolset answers; never carries the server's own text.
async fn check_toolset(toolset: &OrgToolset) -> Option<ToolsetTestError> {
    let invalid = || Some(ToolsetTestError::new("invalid_config", TEST_INVALID));
    let Ok(kind) = toolset.kind.parse::<ToolsetKind>() else {
        return invalid();
    };
    let data = toolset
        .data
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    if validate_data(kind, &data).is_err() {
        return invalid();
    }
    match kind {
        ToolsetKind::Mcp => match data.and_then(|d| serde_json::from_value::<McpData>(d).ok()) {
            Some(mcp) => list_mcp_tools(&mcp).await.err(),
            None => invalid(),
        },
        ToolsetKind::Cli | ToolsetKind::Skill | ToolsetKind::Generic => None,
    }
}

/// [`list_tools_with`] after the SSRF policy admits the URL; private addresses need the allowlist.
async fn list_mcp_tools(mcp: &McpData) -> Result<(), ToolsetTestError> {
    let failed = || ToolsetTestError::new("failed", TEST_FAILED);
    if let Err(e) = SsrfGuard::validate_destination_url_with_config_async(&mcp.url).await {
        log::info!("[toolset test] URL refused: {e}");
        return Err(failed());
    }
    // Direct, never through an env proxy, so the connect-time check sees the real address.
    let builder = reqwest::Client::builder().timeout(TEST_TIMEOUT).no_proxy();
    let client = ssrf_guard::build_destination_client_without_redirects(builder).map_err(|e| {
        log::warn!("[toolset test] client not built: {e}");
        failed()
    })?;
    list_tools_with(&client, mcp).await
}

/// `initialize` then `tools/list` on the toolset's URL with its stored headers.
async fn list_tools_with(client: &reqwest::Client, mcp: &McpData) -> Result<(), ToolsetTestError> {
    let initialize = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": openobserve_mcp::MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "openobserve-toolset-test", "version": config::VERSION}
        }
    });
    let session = mcp_call(client, mcp, None, &initialize).await?;
    let list = serde_json::json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"});
    mcp_call(client, mcp, session.as_deref(), &list).await?;
    Ok(())
}

/// One JSON-RPC call; `Ok` carries the session id the server issued, if any.
async fn mcp_call(
    client: &reqwest::Client,
    mcp: &McpData,
    session: Option<&str>,
    request: &serde_json::Value,
) -> Result<Option<String>, ToolsetTestError> {
    let mut builder = client
        .post(&mcp.url)
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream",
        )
        .json(request);
    for (name, value) in &mcp.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(session) = session {
        builder = builder.header("mcp-session-id", session);
    }
    let failed = || ToolsetTestError::new("failed", TEST_FAILED);
    let response = builder.send().await.map_err(|e| {
        log::info!("[toolset test] MCP request failed: {e}");
        failed()
    })?;
    let status = response.status();
    let session = response
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() || !has_jsonrpc_result(&body) {
        log::info!("[toolset test] MCP server answered {status}");
        return Err(failed());
    }
    Ok(session)
}

/// A JSON or SSE answer holding a JSON-RPC `result`.
fn has_jsonrpc_result(body: &str) -> bool {
    let has = |text: &str| {
        serde_json::from_str::<serde_json::Value>(text)
            .is_ok_and(|v| v.get("result").is_some() && v.get("error").is_none())
    };
    has(body.trim())
        || body
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .any(|data| has(data.trim()))
}

/// A kept secret would follow the toolset to a new destination, so nothing is saved.
fn destination_changed(changed: &DestinationChanged) -> Response {
    AiErrorEnvelope::new(AiErrorCode::InvalidRequest, changed.to_string())
        .legacy_code("destination_changed")
        .with("fields", changed.fields.clone())
        .into_response()
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::ai::toolsets::{McpData, redact_response_data};
    use serde_json::json;

    use super::*;

    const STORED: &str =
        r#"{"url":"https://mcp.example.com/","headers":{"Authorization":"Bearer real-token"}}"#;

    /// What the edit form sends back after a GET: the redacted data, unchanged.
    fn redacted_round_trip() -> serde_json::Value {
        let stored: serde_json::Value = serde_json::from_str(STORED).unwrap();
        redact_response_data(ToolsetKind::Mcp, Some(stored)).unwrap()
    }

    #[test]
    fn a_save_that_sends_the_redacted_header_keeps_the_stored_one() {
        let incoming = redacted_round_trip();
        assert_eq!(incoming["headers"]["Authorization"], "***");
        let merged =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer real-token");

        // The agent push parses the stored data as `McpData`, so it carries the real header.
        let pushed: McpData = serde_json::from_value(merged).unwrap();
        assert_eq!(pushed.headers["Authorization"], "Bearer real-token");
    }

    #[test]
    fn a_new_secret_replaces_the_stored_one_and_a_missing_key_removes_it() {
        let mut incoming = redacted_round_trip();
        incoming["headers"]["Authorization"] = json!("Bearer rotated");
        let merged =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer rotated");

        let cleared = json!({"url": "https://mcp.example.com/", "headers": {}});
        let merged =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), cleared).unwrap();
        assert_eq!(merged["headers"], json!({}));
    }

    #[test]
    fn a_placeholder_with_nothing_stored_is_refused_and_an_unknown_kind_is_not_merged() {
        let refused = merge_secrets(
            "o",
            "t1",
            Some(ToolsetKind::Mcp),
            None,
            redacted_round_trip(),
        );
        assert!(refused.is_err());
        let untouched =
            merge_secrets("o", "t1", None, Some(STORED), redacted_round_trip()).unwrap();
        assert_eq!(untouched, redacted_round_trip());
    }

    #[test]
    fn a_kept_header_is_never_sent_to_a_changed_url() {
        let mut incoming = redacted_round_trip();
        incoming["url"] = json!("https://attacker.example/mcp");
        let changed =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), incoming).unwrap_err();
        assert_eq!(changed.fields, ["url"]);

        // Re-entering the secret makes the new URL acceptable.
        let incoming = json!({
            "url": "https://attacker.example/mcp",
            "headers": {"Authorization": "Bearer typed-again"}
        });
        let merged =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer typed-again");
    }

    #[test]
    fn kept_cli_credentials_never_run_under_a_changed_command() {
        let stored =
            r#"{"command":"kubectl","blocked_subcommands":["delete"],"env":{"TOKEN":"real"}}"#;
        let incoming =
            json!({"command": "sh", "blocked_subcommands": ["delete"], "env": {"TOKEN": "***"}});
        let changed =
            merge_secrets("o", "t1", Some(ToolsetKind::Cli), Some(stored), incoming).unwrap_err();
        assert_eq!(changed.fields, ["command"]);
    }

    #[tokio::test]
    async fn a_kept_cli_token_next_to_a_changed_env_endpoint_is_a_400_and_nothing_merges() {
        let stored = r#"{"command":"vault","env":{"VAULT_ADDR":"https://vault.corp","VAULT_TOKEN":"s.real"}}"#;
        let incoming = json!({
            "command": "vault",
            "env": {"VAULT_ADDR": "https://attacker.example", "VAULT_TOKEN": "***"}
        });
        let changed =
            merge_secrets("o", "t1", Some(ToolsetKind::Cli), Some(stored), incoming).unwrap_err();
        assert_eq!(changed.fields, ["env"]);
        let response = destination_changed(&changed);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains(r#""fields":["env"]"#), "{text}");
        assert!(
            !text.contains("s.real") && !text.contains("attacker"),
            "{text}"
        );
    }

    #[tokio::test]
    async fn a_refused_save_is_a_typed_400_that_names_fields_never_values() {
        let mut incoming = redacted_round_trip();
        incoming["url"] = json!("https://attacker.example/mcp");
        let changed =
            merge_secrets("o", "t1", Some(ToolsetKind::Mcp), Some(STORED), incoming).unwrap_err();
        let response = destination_changed(&changed);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "invalid_request");
        assert_eq!(body["error_code"], "destination_changed");
        assert_eq!(body["fields"], json!(["url"]));
        assert_eq!(body["message"], changed.to_string());
        assert!(changed.to_string().starts_with("Re-enter every secret"));
        let text = body.to_string();
        assert!(
            !text.contains("real-token") && !text.contains("attacker"),
            "{text}"
        );
    }

    /// Answers each request in turn with the next of `replies`, then closes.
    async fn mcp_server(replies: Vec<&'static str>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        tokio::spawn(async move {
            for reply in replies {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = [0u8; 8192];
                let _ = socket.read(&mut buf).await;
                let _ = socket.write_all(reply.as_bytes()).await;
            }
        });
        url
    }

    const RESULT: &str = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nmcp-session-id: s1\r\nconnection: close\r\ncontent-length: 36\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}";
    const REFUSED: &str =
        "HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 13\r\n\r\nbad token xyz";

    fn mcp(url: &str) -> McpData {
        serde_json::from_value(
            json!({"url": url, "headers": {"Authorization": "Bearer real-token"}}),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn a_test_lists_the_tools_and_every_failure_is_one_fixed_sentence() {
        let client = reqwest::Client::new();
        let ok = mcp_server(vec![RESULT, RESULT]).await;
        assert_eq!(list_tools_with(&client, &mcp(&ok)).await, Ok(()));
        let refused = mcp_server(vec![REFUSED]).await;
        let error = list_tools_with(&client, &mcp(&refused)).await.unwrap_err();
        let gone = list_tools_with(&client, &mcp("http://127.0.0.1:9/mcp"))
            .await
            .unwrap_err();
        assert_eq!(error, gone);
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("failed", TEST_FAILED)
        );
        let result = serde_json::to_string(&ToolsetTestResult {
            ok: false,
            duration_ms: 0,
            error: Some(error),
        })
        .unwrap();
        assert!(
            !result.contains("real-token") && !result.contains("xyz"),
            "{result}"
        );
    }

    #[tokio::test]
    async fn a_test_never_reaches_a_private_or_metadata_address() {
        let local = mcp_server(vec![RESULT, RESULT]).await;
        for url in [
            local.as_str(),
            "http://10.0.0.5:9200/",
            "http://100.64.0.1/mcp",
            "http://169.254.169.254/latest/",
            "http://[fd00::1]/mcp",
            "http://localhost:5080/mcp",
        ] {
            let error = list_mcp_tools(&mcp(url)).await.unwrap_err();
            assert_eq!(error.code, "failed", "{url}");
        }
    }

    #[tokio::test]
    async fn a_toolset_is_never_saved_with_a_private_or_metadata_url() {
        for url in [
            "http://10.0.0.5:9200/",
            "http://169.254.169.254/latest/",
            "http://localhost/",
        ] {
            let data = json!({"url": url, "headers": {}});
            let refusal = admit_url(ToolsetKind::Mcp, Some(&data)).await.unwrap_err();
            assert_eq!(refusal.status(), StatusCode::BAD_REQUEST, "{url}");
        }
        let public = json!({"url": "https://8.8.8.8/mcp", "headers": {}});
        assert!(admit_url(ToolsetKind::Mcp, Some(&public)).await.is_ok());
        assert!(admit_url(ToolsetKind::Mcp, None).await.is_ok());
    }

    #[tokio::test]
    async fn an_unresolvable_host_is_refused_with_its_own_sentence() {
        let message = |response: Response| async move {
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            json["message"].as_str().unwrap_or_default().to_string()
        };
        let unresolvable = json!({"url": "https://no-such-host.invalid/mcp", "headers": {}});
        let refusal = admit_url(ToolsetKind::Mcp, Some(&unresolvable))
            .await
            .unwrap_err();
        assert_eq!(message(refusal).await, URL_UNRESOLVED);
        let private = json!({"url": "http://10.0.0.5/mcp", "headers": {}});
        let refusal = admit_url(ToolsetKind::Mcp, Some(&private))
            .await
            .unwrap_err();
        assert_eq!(message(refusal).await, URL_REFUSED);
        assert_eq!(
            refusal_sentence("Host x resolved to no addresses"),
            URL_UNRESOLVED
        );
    }

    #[tokio::test]
    async fn a_toolset_whose_config_does_not_parse_fails_its_test_without_a_call() {
        let toolset = OrgToolset {
            id: "t1".into(),
            org: "o".into(),
            name: "GitHub".into(),
            kind: "mcp".into(),
            description: None,
            data: Some("{}".into()),
            created_by: "a@x".into(),
            created_at: 1,
            updated_at: 1,
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
        };
        assert_eq!(
            check_toolset(&toolset).await.unwrap().code,
            "invalid_config"
        );
    }

    #[tokio::test]
    async fn a_patch_with_anything_but_the_switch_is_the_400_envelope() {
        let response = patch(
            Path(("o".to_string(), "t1".to_string())),
            Bytes::from_static(br#"{"enabled": false, "name": "x"}"#),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["code"], "invalid_request");
    }

    #[test]
    fn an_sse_answer_counts_and_an_error_answer_does_not() {
        assert!(has_jsonrpc_result(
            "event: message\ndata: {\"result\":{\"tools\":[]}}\n\n"
        ));
        assert!(!has_jsonrpc_result(r#"{"error":{"code":-1}}"#));
        assert!(!has_jsonrpc_result("<html>"));
    }

    #[test]
    fn a_tool_frame_is_credited_to_its_enabled_toolset_only() {
        let names = vec![
            ("t1".to_string(), "GitHub".to_string(), true),
            ("t2".to_string(), "GitHub Enterprise".to_string(), true),
            ("t3".to_string(), "kubectl".to_string(), true),
            ("t4".to_string(), "Old".to_string(), false),
        ];
        let usage = ToolsetUse::new("o", names);
        let frames = concat!(
            "data: {\"type\":\"tool_result\",\"tool\":\"github-enterprise_create_issue\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"github_search\",\"success\":false}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"cli_kubectl\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"old_x\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"SearchSQL\",\"success\":true}\n",
        );
        assert_eq!(
            usage.results(frames.as_bytes()),
            vec![
                ("t2".to_string(), true),
                ("t1".to_string(), false),
                ("t3".to_string(), true)
            ]
        );
    }

    #[test]
    fn a_tool_frame_split_across_chunks_is_still_credited() {
        let usage = ToolsetUse::new("o", vec![("t1".to_string(), "GitHub".to_string(), true)]);
        let frame =
            "data: {\"type\":\"tool_result\",\"tool\":\"github_search\",\"success\":true}\n\n";
        let (head, tail) = frame.split_at(20);
        assert!(usage.results(head.as_bytes()).is_empty());
        assert_eq!(
            usage.results(tail.as_bytes()),
            vec![("t1".to_string(), true)]
        );
    }
}

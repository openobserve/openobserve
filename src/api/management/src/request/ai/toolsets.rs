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
    collections::{HashMap, HashSet},
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
use config::{
    meta::oncall::confidence::collides_with_first_party_tools,
    utils::{
        ssrf_guard::{self, SsrfGuard},
        time::now_micros,
    },
};
use infra::table::{
    ai_memory::ToolsetDelete,
    org_ai_toolsets::{HealthOutcome, OrgToolset},
};
use o2_enterprise::enterprise::{
    ai::{
        client::{DiscoverError, DiscoveredTool, McpEntry, get_agent_client},
        toolsets::{
            DestinationChanged, McpAuth, McpData, ToolsetCreateRequest, ToolsetKind,
            ToolsetListResponse, ToolsetResponse, ToolsetState, ToolsetStatus,
            ToolsetUpdateRequest, drop_write_header_names, keep_stored_write_headers,
            merge_update_data, needs_credentials,
            oauth::{TokenError, tokens},
            push::{colliding_names, normalize_tool_name},
            validate_data, validate_name, validate_update, without_dropped_keys,
        },
    },
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, check_permissions, is_ofga_object_visible},
    autoresolve::approve::{APPROVE_OBJECT_TYPE, permitted_connections, rbac_on},
};
use serde::{Deserialize, Serialize};
use svix_ksuid::{Ksuid, KsuidLike};
use utoipa::ToSchema;

use super::{
    capabilities,
    error::{self, AiErrorCode, AiErrorEnvelope},
};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const UNREADABLE: &str = "its settings can't be read";
const SAME_AGENT_NAME: &str = "another toolset has the same agent name";
const TURNED_OFF: &str = "it is turned off";
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
                // o2-ai labels a vendor tool `<toolset> · <tool>` in the chat's frames.
                tool.strip_prefix(name.as_str())
                    .is_some_and(|rest| rest.starts_with(['_', '-']) || rest.starts_with(" · "))
            })
            .map(|(id, _)| id.clone())
    }
}

/// Body of `_discover`: an unsaved config, or a saved toolset by `id` with unsaved `overrides`.
#[derive(Default, Deserialize, utoipa::ToSchema)]
pub struct DiscoverRequest {
    #[serde(default)]
    pub id: Option<String>,
    /// An unsaved toolset's name, which tells `name_too_long`; a saved one's own name is used.
    #[serde(default)]
    pub name: Option<String>,
    /// `url`, `headers`, `auth` and `timeout_seconds` merged over the saved row, as a `PUT` would.
    #[serde(default)]
    pub overrides: Option<serde_json::Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
    /// An OAuth client, whose token is requested first; absent lists with `headers` alone.
    #[serde(default)]
    pub auth: Option<serde_json::Value>,
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

impl From<TokenError> for DiscoverFailure {
    fn from(e: TokenError) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "token_request_failed",
            message: e.to_string(),
        }
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

/// One toolset as the agent may see it: an allowlist, so a field added to the stored config can't
/// reach the model unless it is added here too.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AgentToolset {
    pub id: String,
    pub name: String,
    /// What the agent's names for its tools start with; MCP only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_prefix: Option<String>,
    /// Why the agent gets nothing of this toolset, in a fixed text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<&'static str>,
    pub kind: ToolsetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Tool name globs offered to the agent; absent offers all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    /// Tool name globs never offered, even when allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_tools: Option<Vec<String>>,
    /// Tool name globs that may change things; absent means every tool not marked read-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<AgentToolsetPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_type: Option<ToolsetCredentialType>,
    /// A secret it names has no value in this region.
    pub needs_credentials: bool,
    pub region_only: bool,
    /// Its last use or test in this region; absent before its first and while turned off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<AgentToolsetHealth>,
}

impl AgentToolset {
    /// The rows `query` asks for, judged against all of the org's `rows`; a row of a kind this node
    /// doesn't know is left out and, as in a turn, doesn't count against another's name.
    fn from_rows(rows: Vec<OrgToolset>, query: &AgentListQuery) -> Vec<Self> {
        let known: Vec<(ToolsetKind, OrgToolset)> = rows
            .into_iter()
            .filter_map(|row| Some((row.kind.parse().ok()?, row)))
            .collect();
        let colliding = colliding_names(known.iter().map(|(_, row)| row.name.as_str()));
        known
            .into_iter()
            .filter(|(_, row)| query.matches(row))
            .map(|(kind, row)| Self::from_row(kind, row, &colliding))
            .collect()
    }

    fn from_row(kind: ToolsetKind, row: OrgToolset, colliding: &HashSet<String>) -> Self {
        let health = AgentToolsetHealth::of(&row);
        let enabled = row.enabled;
        let mut toolset = Self {
            id: row.id,
            name: row.name,
            tool_prefix: None,
            unavailable: None,
            kind,
            description: row.description,
            allowed_tools: None,
            blocked_tools: None,
            write_tools: None,
            preset: None,
            credential_type: None,
            needs_credentials: false,
            region_only: row.region_only,
            health: None,
        };
        // Another kind's `data` has no field the agent may see, and no calls of its own.
        if kind == ToolsetKind::Mcp {
            toolset.health = health;
            toolset.fill_mcp(row.data.as_deref());
        }
        if colliding.contains(&normalize_tool_name(&toolset.name)) {
            toolset.unavailable = Some(SAME_AGENT_NAME);
        }
        if !enabled {
            toolset.unavailable = Some(TURNED_OFF);
        }
        if toolset.unavailable.is_some() {
            toolset.tool_prefix = None;
        }
        toolset
    }

    fn fill_mcp(&mut self, data: Option<&str>) {
        let agent_name = normalize_tool_name(&self.name);
        self.tool_prefix = Some(format!("{agent_name}_"));
        let data = data.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
        let Some((mcp, data)) =
            data.and_then(|data| Some((McpData::deserialize(&data).ok()?, data)))
        else {
            // The parse error may quote a stored value, so it isn't logged.
            log::warn!("toolset '{}' has unreadable data", self.name);
            self.unavailable = Some(UNREADABLE);
            return;
        };
        self.preset = data
            .get("preset")
            .and_then(|preset| AgentToolsetPreset::deserialize(preset).ok());
        self.needs_credentials = needs_credentials(ToolsetKind::Mcp, Some(&data));
        self.credential_type = Some(ToolsetCredentialType::from(&mcp.auth));
        self.allowed_tools = mcp.policy.allowed_tools;
        self.blocked_tools = mcp.policy.blocked_tools;
        self.write_tools = mcp.policy.write_tools;
    }
}

/// The shipped preset a toolset was saved from.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct AgentToolsetPreset {
    pub id: String,
    pub revision: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolsetCredentialType {
    Headers,
    OauthClientCredentials,
}

impl From<&McpAuth> for ToolsetCredentialType {
    fn from(auth: &McpAuth) -> Self {
        match auth {
            McpAuth::Headers => Self::Headers,
            McpAuth::OauthClientCredentials(_) => Self::OauthClientCredentials,
        }
    }
}

/// A toolset's state since `since` and its last use (microseconds), never the vendor's error.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AgentToolsetHealth {
    pub status: ToolsetHealthStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<i64>,
}

impl AgentToolsetHealth {
    /// `None` before the first use or test, and while the toolset is turned off.
    fn of(row: &OrgToolset) -> Option<Self> {
        let state = row.status_state.as_deref();
        let status = ToolsetStatus::from_stored(row.enabled, state, row.status_since, None);
        let health = |status| Self {
            status,
            since: row.status_since,
            last_used_at: row.last_used_at,
        };
        match status.state {
            ToolsetState::Ok => Some(health(ToolsetHealthStatus::Ok)),
            ToolsetState::Failing => Some(health(ToolsetHealthStatus::Failing)),
            ToolsetState::NeverUsed | ToolsetState::Disabled => None,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolsetHealthStatus {
    Ok,
    Failing,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AgentToolsetList {
    pub toolsets: Vec<AgentToolset>,
}

/// What a `PUT` stores, and the secrets it kept and replaced (names only).
#[derive(Debug, PartialEq)]
struct UpdatedData {
    data: Option<String>,
    kept: Vec<String>,
    replaced: Vec<String>,
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
    description = "Creates a new AI toolset (MCP server, skill, or generic config). \
                   The name must match `^[a-z0-9]+(-[a-z0-9]+)*$` and be at most 64 characters; \
                   a new MCP toolset's may not be the first word of one of the AI assistant's own \
                   tools. The `data` field is encrypted at rest using per-org envelope encryption. \
                   An MCP toolset's `data` may limit what the agent calls: `allowed_tools`, \
                   `blocked_tools` and `write_tools` (tool name globs, `*` = any characters); \
                   an omitted key keeps the agent's default, so an omitted `allowed_tools` means \
                   `[\"*\"]`; `blocked_tools` always wins. Its `auth` is `{\"type\": \"headers\"}` \
                   (the default) or `{\"type\": \"oauth_client_credentials\", \"token_url\", \
                   \"client_id\", \"client_secret\", \"scope\"?, \"extra_params\"?, \
                   \"client_auth\": \"basic\" | \"body\"}`: O2 then sends the access token as \
                   `Authorization`, which `headers` may not hold. \
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
    Json(mut body): Json<ToolsetCreateRequest>,
) -> Response {
    let kind = match body.kind.parse::<ToolsetKind>() {
        Ok(kind) => kind,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    if let Err(e) = validate_name(&body.name) {
        return MetaHttpResponse::bad_request(e);
    }
    // On create only: a toolset that already has such a name keeps working.
    if kind == ToolsetKind::Mcp && collides_with_first_party_tools(&body.name) {
        return MetaHttpResponse::bad_request(format!(
            "toolset name '{}' can't be used: its tools could be named like the AI assistant's own \
             tools or permissions; choose another name",
            body.name
        ));
    }
    if let Err(e) = validate_data(kind, &body.data) {
        return MetaHttpResponse::bad_request(e);
    }
    if let Err(refusal) = admit_url(kind, body.data.as_ref()).await {
        return refusal;
    }
    if kind == ToolsetKind::Mcp
        && let Some(data) = body.data.as_mut()
    {
        drop_write_header_names(data);
    }

    let data_str = body
        .data
        .map(|data| without_dropped_keys(kind, data).to_string());

    let now = now_micros();
    let entry = OrgToolset {
        id: Ksuid::new(None, None).to_string(),
        org: org_id.clone(),
        name: body.name.clone(),
        kind: kind.to_string(),
        description: body.description.clone(),
        data: data_str,
        created_by: user_email.user_id.clone(),
        created_at: now,
        updated_at: now,
        region_only: body.region_only,
        origin_region: None,
        enabled: true,
        status_state: None,
        status_since: None,
        last_error: None,
        last_used_at: None,
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
    db::ai_toolsets::published_put(&saved).await;

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
            let writer = toolsets[0].kind == ToolsetKind::Mcp
                && may_update_every_toolset(&org_id, &user_email.user_id).await;
            hide_mcp_urls(&org_id, &user_email.user_id, &mut toolsets, writer).await;
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
    /// Exact filter on the toolset kind (`mcp`, `skill`, `generic`).
    pub kind: Option<String>,
    /// Maximum number of results to return; a negative value is rejected with 400.
    pub limit: Option<u64>,
    /// `list` (default) or `update`: list only the toolsets the caller holds that permission on.
    pub permission: Option<String>,
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiToolsets",
    summary = "List AI toolsets",
    description = "Lists the org's AI toolsets the caller may list (or update), with optional filtering. \
                   Org admins, and deployments without role-based access, get every toolset; a caller \
                   with no grant gets an empty list. `can_create` says whether the caller may create \
                   toolsets. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name"   = Option<String>, Query, description = "Substring filter on name (case-insensitive)"),
        ("kind"   = Option<String>, Query, description = "Exact filter on kind: mcp | skill | generic"),
        ("limit"  = Option<u64>,   Query, description = "Maximum number of results, counted after the permission filter"),
        ("permission" = Option<String>, Query, description = "list (default): toolsets the caller may list; update: toolsets the caller may update"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "List of toolsets", content_type = "application/json", body = ToolsetListResponse),
        (status = 400, description = "Invalid query parameters, such as a negative limit or an unknown permission"),
        (status = 403, description = "Feature not supported, or the permissions could not be read", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list(
    Path(org_id): Path<String>,
    Query(params): Query<ListQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let permission = match params.permission.as_deref() {
        None | Some("list") => "LIST",
        Some("update") => "PUT",
        Some(_) => return MetaHttpResponse::bad_request("permission must be list or update"),
    };
    let permitted = match permitted_connections(&org_id, &user_email.user_id, permission).await {
        Ok(permitted) => permitted,
        Err(e) => return MetaHttpResponse::forbidden(e),
    };
    let writer = may_update_every_toolset(&org_id, &user_email.user_id).await;
    let filter = infra::table::org_ai_toolsets::ListFilter {
        name: params.name,
        kind: params.kind,
    };
    let db_limit = params.limit.filter(|_| permitted.is_none());
    match infra::table::org_ai_toolsets::list(&org_id, filter, db_limit).await {
        Ok(toolsets) => {
            let toolsets = permitted_page(&org_id, toolsets, permitted.as_deref(), params.limit);
            let mut res = ToolsetListResponse {
                toolsets: toolsets
                    .into_iter()
                    .map(ToolsetResponse::from_toolset)
                    .collect(),
                can_create: !rbac_on() || writer,
            };
            flag_renames(&org_id, &mut res.toolsets).await;
            hide_mcp_urls(&org_id, &user_email.user_id, &mut res.toolsets, writer).await;
            Json(res).into_response()
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// Query parameters of `list_toolsets`.
#[derive(Debug, Default, Deserialize)]
pub struct AgentListQuery {
    pub name: Option<String>,
    pub kind: Option<String>,
}

impl AgentListQuery {
    fn matches(&self, row: &OrgToolset) -> bool {
        let name = row.name.to_lowercase();
        self.name
            .as_ref()
            .is_none_or(|part| name.contains(&part.to_lowercase()))
            && self.kind.as_ref().is_none_or(|kind| *kind == row.kind)
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/_list",
    context_path = "/api",
    tag = "AI",
    operation_id = "list_toolsets",
    summary = "List AI toolsets for the agent",
    description = "Lists each AI toolset's tool limits, credential type and health status, without \
                   URLs, credentials, skill content or error texts; a turned-off toolset is \
                   `unavailable`. \
                   Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name"   = Option<String>, Query, description = "Substring filter on name (case-insensitive)"),
        ("kind"   = Option<String>, Query, description = "Exact filter on kind: mcp | skill | generic"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "List of toolsets", content_type = "application/json", body = AgentToolsetList),
        (status = 403, description = "Feature not supported", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List the org's AI toolsets (external MCP servers and skills) and which tools each one allows, blocks or treats as writes; a missing allowed_tools allows all, unless unavailable says why the agent gets none. It shows configuration, not whether a toolset connected on this turn, and leaves out the MCP servers of an operator's own config.yaml.",
            "category": "ai",
            "pinned": true
        }))
    )
)]
pub async fn list_for_agent(
    Path(org_id): Path<String>,
    Query(params): Query<AgentListQuery>,
) -> Response {
    // Unfiltered: a row the filter hides can still share a listed row's agent name.
    let all = infra::table::org_ai_toolsets::ListFilter::default();
    let rows = match infra::table::org_ai_toolsets::list(&org_id, all, None).await {
        Ok(rows) => rows,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let toolsets = AgentToolset::from_rows(rows, &params);
    Json(AgentToolsetList { toolsets }).into_response()
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
                   A secret value of `***` keeps the stored value; when the MCP URL \
                   changes every secret must be sent again, and so must `auth`'s when \
                   `auth.token_url` does, and when a `headers` entry is added or removed next to a \
                   kept `***` (400 `invalid_request`, `error_code: destination_changed`, `fields`). \
                   `auth` is replaced whole when sent. A merge update that omits the MCP \
                   limits (`allowed_tools`, `blocked_tools`, `write_tools`) keeps the stored ones; \
                   send `null` to clear one. A `\"schema\": 2` replacement drops every limit it omits, so it must \
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
        (status = 400, description = "Invalid request, or a `***` secret kept while the URL or a `headers` entry changed (`invalid_request`, `error_code: destination_changed`, `fields`)", content_type = "application/json"),
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
    tokens().forget(&org_id, &id);
    db::ai_toolsets::published_put(&updated).await;

    let mut toolsets = [ToolsetResponse::from_toolset(updated)];
    flag_renames(&org_id, &mut toolsets).await;
    let [toolset] = toolsets;
    Json(toolset).into_response()
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
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "The toolset", body = ToolsetResponse, content_type = "application/json"),
        (status = 400, description = "A field other than `enabled`", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
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
    let primary = infra::db::get_orm_client_rw().await;
    match infra::table::org_ai_toolsets::get_with(primary, &org_id, &id).await {
        // The switch stays in this region: replication carries no `enabled`.
        Ok(Some(t)) => {
            let mut toolsets = [ToolsetResponse::from_toolset(t)];
            flag_renames(&org_id, &mut toolsets).await;
            let [toolset] = toolsets;
            Json(toolset).into_response()
        }
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
                   its stored credentials; a skill toolset has its configuration \
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
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Test result", body = ToolsetTestResult, content_type = "application/json"),
        (status = 403, description = "Not an organization admin", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
        (status = 429, description = "Tested moments ago (`rate_limited`)", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "create"})), ("x-o2-mcp" = json!({"enabled": false})))
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

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/prebuilt",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListPrebuiltAiToolsets",
    summary = "List AI toolset presets",
    description = "Returns the presets shipped with this server (Datadog, Dynatrace, Grafana): \
                   URL template, header names, tool lists and tool classes. A toolset saved from a \
                   preset stores `preset: {id, revision}` in its `data`. \
                   Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "The presets", content_type = "application/json", body = config::prebuilt_ai_toolsets::PrebuiltAiToolsets),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn prebuilt(Path(_org_id): Path<String>) -> Response {
    Json(config::prebuilt_ai_toolsets::prebuilt_ai_toolsets()).into_response()
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
                   (`name`, `url`, `headers`, `auth`, `timeout_seconds`; no secret may be `***`) or a \
                   saved toolset's `id` with optional `overrides`, merged as a `PUT` would: \
                   `***` keeps a stored secret unless a URL it is sent to changes. With OAuth \
                   client credentials a token is requested first; `token_request_failed` carries the \
                   token endpoint's `error` and `error_description`. A tool with \
                   `name_too_long` has a full name `<toolset>_<tool>` no model is offered. \
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
        (status = 400, description = "`{code, message}`: `url_refused`, `discovery_failed` or `token_request_failed`", content_type = "application/json"),
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
    description = "Permanently deletes an AI toolset and an MCP one's AI memory, which stays while another MCP toolset has the same normalized name. Only available in enterprise deployments.",
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

    // Read first: the replication tombstone needs the row's name and "this region only" switch.
    let row = match infra::table::org_ai_toolsets::get(&org_id, &id).await {
        Ok(Some(row)) => row,
        Ok(None) => return MetaHttpResponse::not_found(format!("toolset '{id}' not found")),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    // Deletes an MCP toolset's AI memory too, which stays while another MCP one shares its name.
    match ::db::ai_memory::delete_toolset(&org_id, &id, normalize_tool_name).await {
        Ok(ToolsetDelete::Deleted { .. }) => {}
        Ok(ToolsetDelete::NotFound) => {
            return MetaHttpResponse::not_found(format!("toolset '{id}' not found"));
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    // A later toolset can never reuse the id, so a failed cleanup only leaves unreachable grants.
    if o2_openfga::config::get_config().enabled {
        use o2_openfga::authorizer::authz::{remove_object_grants, remove_ownership};
        let object = openobserve_core::autoresolve::approve::connection_object(&id);
        remove_object_grants(&org_id, &object).await;
        remove_ownership(&org_id, &object, "", "").await;
    }

    tokens().forget(&org_id, &id);
    let name = row.name.clone();
    if let Err(e) = db::ai_toolsets::published_delete(&row, now_micros()).await {
        log::error!("[SUPER_CLUSTER:sync] toolset '{name}' in org={org_id} wasn't replicated: {e}");
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

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResyncResponse {
    /// Messages sent: one per replicated toolset, plus one per delete of the last 30 days.
    pub published: usize,
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/_resync",
    context_path = "/api",
    tag = "AI",
    operation_id = "ResyncAiToolsets",
    summary = "Re-send the org's AI toolsets to the other regions",
    description = "Republishes every toolset not marked \"this region only\", without secret \
                   values, plus the deletes of the last 30 days, so a region that missed changes \
                   catches up. Adds and updates only; never deletes a row another region lacks. \
                   Only available in enterprise deployments with super cluster enabled.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Messages sent", content_type = "application/json", body = ResyncResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn resync(Path(org_id): Path<String>) -> Response {
    match db::ai_toolsets::resync(&org_id, now_micros()).await {
        Ok(published) => Json(ResyncResponse { published }).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

// Preset metadata from older forms may hold the template's values, which can be the URL itself.
fn hide_mcp_url(toolset: &mut ToolsetResponse) {
    let Some(data) = toolset.data.as_mut() else {
        return;
    };
    for pointer in ["/url", "/auth/token_url"] {
        if let Some(url) = data.pointer_mut(pointer)
            && let Some(raw) = url.as_str()
        {
            *url = serde_json::Value::String(config::utils::str::url_origin(raw));
        }
    }
    if let Some(preset) = data.get_mut("preset").and_then(|p| p.as_object_mut()) {
        preset.remove("params");
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
        let update = updated_data(&existing.kind, existing.data.as_deref(), body.data.clone())
            .map_err(|e| update_refused(org_id, id, e))?;
        if let Ok(kind) = existing.kind.parse::<ToolsetKind>() {
            let parsed = update
                .data
                .as_deref()
                .and_then(|d| serde_json::from_str(d).ok());
            admit_url(kind, parsed.as_ref()).await?;
        }
        if !(update.kept.is_empty() && update.replaced.is_empty()) {
            log::info!(
                "[org_id:{org_id}] toolset {id} secrets kept={:?} replaced={:?}",
                update.kept,
                update.replaced
            );
        }
        let data = update.data;
        let read_updated_at = existing.updated_at;
        let updated = OrgToolset {
            description: body.description.clone().or(existing.description),
            data,
            updated_at: now_micros().max(read_updated_at + 1),
            region_only: body.region_only.unwrap_or(existing.region_only),
            origin_region: None,
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

/// Flags toolsets whose normalized name another row of the org shares; the agent is sent neither.
async fn flag_renames(org_id: &str, toolsets: &mut [ToolsetResponse]) {
    match infra::table::org_ai_toolsets::list_raw_names(org_id).await {
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
) -> Result<UpdatedData, UpdateRefusal> {
    let kind = kind.parse::<ToolsetKind>()?;
    let raw = stored;
    let stored = raw.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
    let Some(incoming) = incoming else {
        let data = stored
            .map(|data| without_dropped_keys(kind, data).to_string())
            .or_else(|| raw.map(str::to_string));
        return Ok(UpdatedData {
            data,
            kept: Vec::new(),
            replaced: Vec::new(),
        });
    };
    let sends_write_headers = incoming.get("write_headers").is_some();
    let mut merge = merge_update_data(kind, stored.as_ref(), incoming)?;
    if kind == ToolsetKind::Mcp {
        // The merge copies stored keys the body left out; left-out write headers are judged below.
        if !sends_write_headers && let Some(fields) = merge.data.as_object_mut() {
            fields.remove("write_headers");
        }
        // Stored write headers stay for `***` or when left out, never for a changed destination.
        keep_stored_write_headers(raw, &mut merge.data)?;
    }
    let merged = Some(merge.data);
    validate_update(kind, stored.as_ref(), &merged)?;
    Ok(UpdatedData {
        data: merged.map(|v| v.to_string()),
        kept: merge.kept,
        replaced: merge.replaced,
    })
}

/// Why a `PUT` stores nothing; `fields` names what changed under a kept secret, when that is why.
#[derive(Debug)]
struct UpdateRefusal {
    message: String,
    fields: Vec<&'static str>,
}

impl From<String> for UpdateRefusal {
    fn from(message: String) -> Self {
        let fields = if message.contains("gains or loses an entry") {
            vec!["headers"]
        } else if message.starts_with("re-enter secrets when the URL changes") {
            vec!["url"]
        } else {
            Vec::new()
        };
        Self { message, fields }
    }
}

impl From<DestinationChanged> for UpdateRefusal {
    fn from(changed: DestinationChanged) -> Self {
        Self {
            message: changed.to_string(),
            fields: changed.fields,
        }
    }
}

/// A refused merge; a kept secret that would follow a changed URL or header is the typed 400.
fn update_refused(org_id: &str, id: &str, refusal: impl Into<UpdateRefusal>) -> Response {
    let UpdateRefusal { message, fields } = refusal.into();
    if fields.is_empty() {
        return MetaHttpResponse::bad_request(message);
    }
    log::warn!(
        "[org_id:{org_id}] toolset {id} update refused: secrets kept while {fields:?} changed"
    );
    AiErrorEnvelope::new(AiErrorCode::InvalidRequest, message)
        .legacy_code("destination_changed")
        .with("fields", fields)
        .into_response()
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
    let (mut entry, auth) = discover_entry(stored.as_ref(), body)?;
    if let McpAuth::OauthClientCredentials(oauth_client) = &auth {
        // Past the cache: this is the form's connection test.
        entry.authorize(&tokens().fresh(oauth_client).await?);
    }
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
) -> Result<(McpEntry, McpAuth), DiscoverFailure> {
    let name = match stored {
        Some(row) => Some(row.name.as_str()),
        None => body.name.as_deref(),
    }
    .map(normalize_tool_name)
    .unwrap_or_default();
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
                .data
        }
        (None, _) => {
            let mut data = serde_json::Map::new();
            data.insert("url".into(), body.url.unwrap_or_default().into());
            for (key, value) in [
                ("headers", body.headers),
                ("auth", body.auth),
                ("timeout_seconds", body.timeout_seconds),
            ] {
                if let Some(value) = value {
                    data.insert(key.into(), value);
                }
            }
            let data = serde_json::Value::Object(data);
            // With no saved row a `***` would be sent to the server as the header's value.
            merge_update_data(ToolsetKind::Mcp, None, data)
                .map_err(DiscoverFailure::refused)?
                .data
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
    let entry = McpEntry {
        name,
        url: mcp.url,
        headers: mcp.headers,
        timeout_seconds: mcp.timeout_seconds,
        ..Default::default()
    };
    Ok((entry, mcp.auth))
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
            Some(mut mcp) => match authorize_test(toolset, &mut mcp).await {
                Ok(()) => list_mcp_tools(&mcp).await.err(),
                Err(error) => Some(error),
            },
            None => invalid(),
        },
        ToolsetKind::Skill | ToolsetKind::Generic => None,
    }
}

/// An OAuth toolset is tested with the token a turn would send; a refused token fails the test.
async fn authorize_test(toolset: &OrgToolset, mcp: &mut McpData) -> Result<(), ToolsetTestError> {
    let McpAuth::OauthClientCredentials(client) = &mcp.auth else {
        return Ok(());
    };
    let token = tokens()
        .token(&toolset.org, &toolset.id, client, TEST_TIMEOUT)
        .await
        .map_err(|e| {
            log::info!("[toolset test] token request failed: {}", e.reason());
            ToolsetTestError::new("failed", TEST_FAILED)
        })?;
    mcp.headers
        .retain(|name, _| !name.trim().eq_ignore_ascii_case("authorization"));
    mcp.headers
        .insert("Authorization".to_string(), token.bearer());
    Ok(())
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
    let client = ssrf_guard::build_safe_destination_client(builder).map_err(|e| {
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

/// The first `limit` of `toolsets` that `permitted` lets the caller see; `None` permits every one.
fn permitted_page(
    org_id: &str,
    toolsets: Vec<OrgToolset>,
    permitted: Option<&[String]>,
    limit: Option<u64>,
) -> Vec<OrgToolset> {
    let limit = limit.map_or(usize::MAX, |l| usize::try_from(l).unwrap_or(usize::MAX));
    toolsets
        .into_iter()
        .filter(|t| is_ofga_object_visible(org_id, APPROVE_OBJECT_TYPE, &t.id, permitted))
        .take(limit)
        .collect()
}

/// Whether the caller holds Update on every toolset of the org, as creating one requires.
async fn may_update_every_toolset(org_id: &str, user_id: &str) -> bool {
    check_permissions(
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
}

/// An MCP URL can carry its key in the userinfo, path or query; only toolset writers see it whole.
async fn hide_mcp_urls(
    org_id: &str,
    user_id: &str,
    toolsets: &mut [ToolsetResponse],
    updates_every_toolset: bool,
) {
    if updates_every_toolset || !toolsets.iter().any(|t| t.kind == ToolsetKind::Mcp) {
        return;
    }
    let mcp: Vec<&mut ToolsetResponse> = toolsets
        .iter_mut()
        .filter(|t| t.kind == ToolsetKind::Mcp)
        .collect();
    // An Update grant on one toolset alone lets its holder edit it, and a save sends the URL.
    let may_edit = futures::future::join_all(mcp.iter().map(|toolset| {
        check_permissions(
            &toolset.id,
            org_id,
            user_id,
            "ai_toolsets",
            "PUT",
            None,
            false,
            false,
            true,
        )
    }))
    .await;
    for (toolset, may_edit) in mcp.into_iter().zip(may_edit) {
        if may_edit {
            continue;
        }
        hide_mcp_url(toolset);
    }
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
            region_only: false,
            needs_credentials: false,
            enabled: true,
            status: Default::default(),
            last_used_at: None,
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

    fn parsed(update: UpdatedData) -> Value {
        serde_json::from_str(&update.data.unwrap()).unwrap()
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
                    kind: "skill".to_string(),
                    description: None,
                    data: Some(json!({"content": "x"})),
                    region_only: false,
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

    #[tokio::test]
    async fn create_refuses_a_cli_kind_a_colliding_mcp_name_and_a_bad_auth() {
        let oauth = |auth: Value| {
            json!({"name": "dt", "kind": "mcp",
                "data": {"url": "https://x.example/mcp", "auth": auth}})
        };
        for (body, needle) in [
            (
                json!({"name": "gh", "kind": "cli", "data": {"command": "gh"}}),
                "unknown toolset kind 'cli'",
            ),
            (
                json!({"name": "record", "kind": "mcp", "data": {"url": "https://x.example/mcp"}}),
                "the AI assistant's own",
            ),
            (
                json!({"name": "external", "kind": "mcp", "data": {"url": "https://x.example/mcp"}}),
                "the AI assistant's own",
            ),
            (
                json!({"name": "dt", "kind": "mcp", "data": {"url": "http://localhost./mcp"}}),
                "invalid mcp url",
            ),
            (
                oauth(json!({"type": "oauth_client_credentials",
                    "token_url": "https://169.254.169.254/t", "client_id": "a",
                    "client_secret": "s"})),
                "loopback, link-local",
            ),
            (
                oauth(json!({"type": "oauth_client_credentials",
                    "token_url": "https://sso.example.com/t", "client_id": "a",
                    "client_secret": "***"})),
                "no value is stored",
            ),
            (
                oauth(json!({"type": "authorization_code"})),
                "invalid mcp data",
            ),
        ] {
            let request: ToolsetCreateRequest = serde_json::from_value(body.clone()).unwrap();
            let resp = create(
                Path("org".to_string()),
                Headers(UserEmail {
                    user_id: "u@example.com".to_string(),
                }),
                Json(request),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{body}");
            let message = body_of(resp).await["message"].to_string();
            assert!(message.contains(needle), "{message}");
        }
    }

    #[test]
    fn an_existing_row_with_a_colliding_name_is_listed_and_updated_as_before() {
        let mut toolsets = [response("record")];
        mark_renames(&["record".to_string()], &mut toolsets);
        assert!(!toolsets[0].rename_needed);
        let stored = stored_mcp();
        assert!(updated_data("mcp", Some(&stored), Some(json!({"timeout_seconds": 9}))).is_ok());
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
            updated_data("mcp", Some(&stored), None).unwrap().data,
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
    fn update_keeps_stored_tool_lists_it_does_not_send_and_drops_the_removed_limits() {
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
                "blocked_tools": null,
                "max_result_bytes": 5
            })),
        )
        .unwrap();
        assert_eq!(
            parsed(data),
            json!({
                "url": "https://mcp.datadoghq.com/api/mcp",
                "headers": {"DD-API-KEY": "api-secret"},
                "allowed_tools": ["search_*"],
                "blocked_tools": null,
                "write_tools": [],
                "timeout_seconds": 60
            })
        );

        let untouched = parsed(updated_data("mcp", Some(&stored), None).unwrap());
        for key in ["max_calls_per_turn", "rate_limit", "max_result_bytes"] {
            assert!(
                untouched.get(key).is_none(),
                "{key}: a description-only update drops it too"
            );
        }
        assert_eq!(untouched["allowed_tools"], json!(["search_*"]));
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
    fn update_refuses_redacted_secrets_for_a_new_url() {
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
            err.message
                .contains("re-enter secrets when the URL changes"),
            "{err:?}"
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
        assert!(err.message.contains("invalid mcp data"), "{err:?}");
    }

    #[tokio::test]
    async fn the_presets_route_returns_the_shipped_presets() {
        let resp = prebuilt(Path("org".to_string())).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        let ids: Vec<&str> = body["presets"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["datadog", "dynatrace", "grafana"]);
        assert_eq!(body["presets"][1]["tool_classes"][0]["tool"], "execute-dql");
    }

    #[test]
    fn a_hidden_url_has_no_copy_left_in_the_preset_metadata() {
        let mut toolset = response("grafana");
        toolset.data = Some(json!({
            "url": "https://grafana.example.com/mcp?token=s3cret",
            "preset": {"id": "grafana", "revision": 1, "params": {"url": "https://grafana.example.com/mcp?token=s3cret"}}
        }));
        hide_mcp_url(&mut toolset);
        let data = toolset.data.unwrap();
        assert_eq!(data["url"], "https://grafana.example.com");
        assert_eq!(data["preset"], json!({"id": "grafana", "revision": 1}));
        assert!(!data.to_string().contains("s3cret"));
    }

    #[test]
    fn every_write_handler_replicates_its_change() {
        let source = include_str!("toolsets.rs");
        let body = |name: &str| {
            let rest = &source[source.find(&format!("pub async fn {name}(")).unwrap()..];
            &rest[..rest.find("\n}\n").unwrap()]
        };
        assert!(body("create").contains("db::ai_toolsets::published_put(&saved)"));
        assert!(body("update").contains("db::ai_toolsets::published_put(&updated)"));
        assert!(body("delete").contains("db::ai_toolsets::published_delete(&row, "));
        for name in ["update", "delete"] {
            assert!(
                body(name).contains("tokens().forget(&org_id, &id)"),
                "{name}"
            );
        }
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
            region_only: false,
            origin_region: None,
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
        }
    }

    fn agent_list(rows: Vec<OrgToolset>, query: &AgentListQuery) -> Vec<Value> {
        AgentToolset::from_rows(rows, query)
            .into_iter()
            .map(|toolset| serde_json::to_value(toolset).unwrap())
            .collect()
    }

    fn agent_view(row: OrgToolset) -> Value {
        agent_list(vec![row], &AgentListQuery::default()).remove(0)
    }

    #[test]
    fn the_agent_s_list_shows_a_header_toolset_s_configuration_only() {
        let mut stored = row(
            "mcp",
            json!({
                "url": "https://u-secret@mcp.example.com/p-secret?key=q-secret",
                "headers": {"X-Hname-secret": "h-secret"},
                "timeout_seconds": 30,
                "allowed_tools": ["search_*"],
                "blocked_tools": ["delete_*"],
                "write_tools": ["create_monitor"],
                "tool_classes": [{"tool": "search_logs", "class": "logs"}],
                "preset": {"id": "datadog", "revision": 3, "params": {"url": "pp-secret"}},
                "future_field": "f-secret"
            }),
        );
        stored.name = "Datadog_Prod".to_string();
        stored.description = Some("Datadog, production".to_string());
        stored.region_only = true;
        stored.status_state = Some("failing".to_string());
        stored.status_since = Some(3);
        stored.last_error = Some("401 v-secret".to_string());
        stored.last_used_at = Some(5);
        let item = agent_list(vec![stored], &AgentListQuery::default()).remove(0);
        assert_eq!(
            item,
            json!({
                "id": "t1",
                "name": "Datadog_Prod",
                "tool_prefix": "datadog-prod_",
                "kind": "mcp",
                "description": "Datadog, production",
                "allowed_tools": ["search_*"],
                "blocked_tools": ["delete_*"],
                "write_tools": ["create_monitor"],
                "preset": {"id": "datadog", "revision": 3},
                "credential_type": "headers",
                "needs_credentials": false,
                "region_only": true,
                "health": {
                    "status": "failing",
                    "since": 3,
                    "last_used_at": 5
                }
            })
        );
        let text = item.to_string();
        assert!(!text.contains("secret") && !text.contains("http"), "{text}");
    }

    #[test]
    fn the_agent_s_list_never_shows_how_calls_are_graded() {
        let item = agent_view(row(
            "mcp",
            json!({
                "url": "https://mcp.example.com/mcp",
                "tool_classes": [{"tool": "run-query", "class": "logs", "args": {"q": "^grade-me"}}]
            }),
        ));
        assert!(item.get("tool_classes").is_none(), "{item}");
        for part in ["run-query", "logs", "grade-me"] {
            assert!(!item.to_string().contains(part), "{item}");
        }
    }

    #[test]
    fn the_agent_s_list_shows_only_the_type_of_an_oauth_credential() {
        let item = agent_view(row(
            "mcp",
            json!({
                "url": "https://u-secret.example.com/mcp",
                "auth": {
                    "type": "oauth_client_credentials",
                    "token_url": "https://t-secret.example.com/token",
                    "client_id": "id-secret",
                    "client_secret": "",
                    "scope": "sc-secret",
                    "extra_params": {"en-secret": "ev-secret"},
                    "client_auth": "basic"
                }
            }),
        ));
        assert_eq!(
            item,
            json!({
                "id": "t1",
                "name": "datadog-prod",
                "tool_prefix": "datadog-prod_",
                "kind": "mcp",
                "credential_type": "oauth_client_credentials",
                "needs_credentials": true,
                "region_only": false
            })
        );
    }

    #[test]
    fn the_agent_s_list_shows_no_content_of_a_skill_or_generic_toolset() {
        for (kind, data) in [
            ("skill", json!({"content": "c-secret"})),
            (
                "generic",
                json!({"url": "g-secret", "allowed_tools": ["x"]}),
            ),
        ] {
            let mut used = row(kind, data);
            used.status_state = Some("ok".to_string());
            used.last_used_at = Some(1);
            let query = AgentListQuery::default();
            assert_eq!(
                agent_list(vec![used], &query).remove(0),
                json!({
                    "id": "t1",
                    "name": "datadog-prod",
                    "kind": kind,
                    "needs_credentials": false,
                    "region_only": false
                })
            );
        }
    }

    #[test]
    fn the_agent_s_list_leaves_out_an_unknown_kind() {
        let cli = row("cli", json!({"env": {"GH_TOKEN": "s3cret"}}));
        let listed = agent_list(vec![cli], &AgentListQuery::default());
        assert!(listed.is_empty());
    }

    #[test]
    fn an_mcp_row_whose_data_can_t_be_read_is_unavailable() {
        let mut missing = row("mcp", json!({}));
        missing.data = None;
        let bad = row("mcp", json!({"url": 7, "allowed_tools": "s3cret"}));
        for stored in [bad, missing] {
            assert_eq!(
                agent_view(stored),
                json!({
                    "id": "t1",
                    "name": "datadog-prod",
                    "unavailable": "its settings can't be read",
                    "kind": "mcp",
                    "needs_credentials": false,
                    "region_only": false
                })
            );
        }
    }

    #[test]
    fn rows_that_share_an_agent_name_are_unavailable_even_when_the_filter_hides_one() {
        let named = |name: &str, kind: &str| OrgToolset {
            name: name.to_string(),
            ..row(
                kind,
                json!({"url": "https://mcp.example.com/mcp", "content": "x"}),
            )
        };
        let by_name = |name: &str| AgentListQuery {
            name: Some(name.to_string()),
            kind: None,
        };
        let by_kind = |kind: &str| AgentListQuery {
            name: None,
            kind: Some(kind.to_string()),
        };
        // (the other row, the query, whether `Datadog Prod` is unavailable)
        for (other, query, unavailable) in [
            (named("datadog_prod", "mcp"), by_name("datadog p"), true),
            (named("datadog_prod", "skill"), by_kind("mcp"), true),
            (named("datadog_prod", "generic"), by_kind("mcp"), true),
            (named("datadog_prod", "cli"), by_kind("mcp"), false),
            (named("datadog-eu", "mcp"), by_name("DATADOG P"), false),
        ] {
            let label = format!("{} {} {query:?}", other.name, other.kind);
            let rows = vec![named("Datadog Prod", "mcp"), other];
            let listed = agent_list(rows, &query);
            assert_eq!(listed.len(), 1, "{label}");
            let item = &listed[0];
            assert_eq!(item["name"], "Datadog Prod", "{label}");
            if unavailable {
                assert_eq!(
                    item["unavailable"], "another toolset has the same agent name",
                    "{label}"
                );
                assert!(item.get("tool_prefix").is_none(), "{label}");
            } else {
                assert!(item.get("unavailable").is_none(), "{label}");
                assert_eq!(item["tool_prefix"], "datadog-prod_", "{label}");
            }
        }
        let both = vec![named("Datadog Prod", "mcp"), named("datadog_prod", "skill")];
        let listed = agent_list(both, &AgentListQuery::default());
        assert!(listed.iter().all(|t| t["unavailable"].is_string()));
    }

    #[test]
    fn the_agent_s_list_reads_health_from_the_toolset_s_status() {
        let mut failing = row("mcp", json!({"url": "https://mcp.example.com/mcp"}));
        failing.status_state = Some("failing".to_string());
        failing.status_since = Some(3);
        failing.last_error = Some("The last call through this toolset failed".to_string());
        failing.last_used_at = Some(5);
        let item = agent_view(failing.clone());
        assert_eq!(
            item["health"],
            json!({"status": "failing", "since": 3, "last_used_at": 5})
        );
        assert!(!item.to_string().contains("failed"), "{item}");

        failing.status_state = Some("ok".to_string());
        assert_eq!(agent_view(failing.clone())["health"]["status"], "ok");

        failing.enabled = false;
        let off = agent_view(failing);
        assert!(off.get("health").is_none(), "{off}");
        assert_eq!(off["unavailable"], "it is turned off");
        assert!(off.get("tool_prefix").is_none(), "{off}");
    }

    #[test]
    fn a_toolset_s_prefix_is_the_one_its_turn_uses() {
        for (name, want) in [
            ("Datadog Prod", "datadog-prod_"),
            ("datadog_prod", "datadog-prod_"),
            ("-GitHub!", "github_"),
            ("é", "toolset_"),
            ("kubectl", "kubectl_"),
        ] {
            let mut stored = row("mcp", json!({"url": "https://mcp.example.com/mcp"}));
            stored.name = name.to_string();
            assert_eq!(agent_view(stored)["tool_prefix"], want, "{name}");
            assert_eq!(want, format!("{}_", normalize_tool_name(name)), "{name}");
        }
    }

    #[tokio::test]
    async fn the_agent_s_list_filters_by_name_and_kind() {
        if !crate::request::ai::memory::tests::meta_store().await {
            return;
        }
        let org = format!("toolsets_agent_{}", config::ider::uuid());
        for (name, kind, data) in [
            (
                "datadog-prod",
                "mcp",
                json!({"url": "https://a.example/mcp"}),
            ),
            (
                "datadog-eu",
                "mcp",
                json!({"url": "https://b.example/mcp", "headers": {"K": "s3cret"}}),
            ),
            ("datadog-runbook", "skill", json!({"content": "s3cret"})),
            ("datadog-cli", "cli", json!({"env": {"T": "s3cret"}})),
        ] {
            let mut entry = row(kind, data);
            entry.id = String::new();
            entry.org = org.clone();
            entry.name = name.to_string();
            infra::table::org_ai_toolsets::add(entry).await.unwrap();
        }
        for (name, kind, want) in [
            (
                None,
                None,
                vec!["datadog-eu", "datadog-prod", "datadog-runbook"],
            ),
            (Some("PROD"), None, vec!["datadog-prod"]),
            (None, Some("skill"), vec!["datadog-runbook"]),
            (
                Some("datadog"),
                Some("mcp"),
                vec!["datadog-eu", "datadog-prod"],
            ),
            (None, Some("cli"), vec![]),
        ] {
            let query = AgentListQuery {
                name: name.map(str::to_string),
                kind: kind.map(str::to_string),
            };
            let resp = list_for_agent(Path(org.clone()), Query(query)).await;
            assert_eq!(resp.status(), StatusCode::OK);
            let body = body_of(resp).await;
            assert!(!body.to_string().contains("s3cret"), "{body}");
            let mut names: Vec<&str> = body["toolsets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["name"].as_str().unwrap())
                .collect();
            names.sort();
            assert_eq!(names, want, "{name:?} {kind:?}");
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
        let (entry, auth) = discover_entry(Some(&stored), by_id(None)).unwrap();
        assert_eq!(auth, McpAuth::Headers);
        assert_eq!(entry.name, "datadog-prod");
        assert_eq!(entry.url, "https://mcp.datadoghq.com/api/mcp");
        assert_eq!(entry.headers["DD-API-KEY"], "api-secret");

        let overrides = json!({"url": "https://mcp.datadoghq.com/api/mcp", "headers": {"DD-API-KEY": "***"}, "timeout_seconds": 50});
        let (entry, _) = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap();
        assert_eq!(entry.url, "https://mcp.datadoghq.com/api/mcp");
        assert_eq!(entry.headers["DD-API-KEY"], "api-secret");
        assert_eq!(entry.timeout_seconds, 50);
    }

    #[test]
    fn discovery_refuses_stored_secrets_for_a_new_url() {
        let stored = row("mcp", serde_json::from_str(&stored_mcp()).unwrap());
        for overrides in [
            json!({"url": "https://mcp.datadoghq.com/v2/mcp", "headers": {"DD-API-KEY": "***"}}),
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
            // A new header next to a kept `***` is refused before the `Host` check runs.
            assert!(
                err.message.contains("`headers` gains or loses an entry"),
                "{}",
                err.message
            );

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
        let skill = row("skill", json!({"content": "x"}));
        let err = discover_entry(Some(&skill), by_id(None)).unwrap_err();
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn discovery_without_an_id_refuses_redacted_values_and_bad_urls() {
        let unsaved = |url: &str, headers: Value| DiscoverRequest {
            name: Some("elastic-prod".to_string()),
            url: Some(url.to_string()),
            headers: Some(headers),
            ..Default::default()
        };
        let (entry, _) = discover_entry(
            None,
            unsaved("https://mcp.example.com/mcp", json!({"X-Key": "k"})),
        )
        .unwrap();
        assert_eq!(entry.name, "elastic-prod");
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

    fn stored_oauth() -> OrgToolset {
        row(
            "mcp",
            json!({
                "url": "https://dt.example.com/mcp",
                "auth": {
                    "type": "oauth_client_credentials",
                    "token_url": "https://sso.example.com/token",
                    "client_id": "id-1",
                    "client_secret": "stored-secret"
                }
            }),
        )
    }

    fn client_of(auth: McpAuth) -> o2_enterprise::enterprise::ai::toolsets::oauth::OAuthClient {
        match auth {
            McpAuth::OauthClientCredentials(client) => client,
            McpAuth::Headers => panic!("an OAuth toolset"),
        }
    }

    #[test]
    fn discovery_takes_the_oauth_client_saved_overridden_or_unsaved() {
        let stored = stored_oauth();
        let (_, auth) = discover_entry(Some(&stored), by_id(None)).unwrap();
        assert_eq!(client_of(auth).client_secret, "stored-secret");

        let mut auth = json!({
            "type": "oauth_client_credentials",
            "token_url": "https://SSO.example.com:443/token",
            "client_id": "id-2",
            "client_secret": "***"
        });
        let overrides = json!({"auth": auth});
        let (_, kept) = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap();
        assert_eq!(client_of(kept).client_secret, "stored-secret");

        let mut other_path = auth.clone();
        other_path["token_url"] = json!("https://sso.example.com/v2/token");
        auth["token_url"] = json!("https://attacker.example/token");
        for overrides in [
            json!({"auth": auth}),
            json!({"auth": other_path}),
            json!({"url": "https://attacker.example/mcp"}),
        ] {
            let err = discover_entry(Some(&stored), by_id(Some(overrides))).unwrap_err();
            assert_eq!(err.status, StatusCode::BAD_REQUEST);
            assert!(err.message.contains("re-enter secrets"), "{}", err.message);
        }

        auth["client_secret"] = json!("typed");
        let unsaved = DiscoverRequest {
            url: Some("https://dt.example.com/mcp".to_string()),
            auth: Some(auth),
            ..Default::default()
        };
        let (_, typed) = discover_entry(None, unsaved).unwrap();
        assert_eq!(client_of(typed).client_secret, "typed");
    }

    #[test]
    fn a_token_error_is_told_apart_and_shows_the_endpoint_s_words() {
        let failure = DiscoverFailure::from(TokenError::Refused {
            status: 401,
            detail: "invalid_client: unknown client".to_string(),
        });
        assert_eq!(failure.status, StatusCode::BAD_REQUEST);
        assert_eq!(failure.code, "token_request_failed");
        assert!(failure.message.contains("invalid_client: unknown client"));
    }

    #[test]
    fn a_viewer_sees_only_the_token_url_s_origin_and_no_secret() {
        let mut toolset = ToolsetResponse::from_toolset(stored_oauth());
        toolset.data.as_mut().unwrap()["auth"]["token_url"] =
            json!("https://sso.example.com/token?key=q-secret");
        hide_mcp_url(&mut toolset);
        let auth = &toolset.data.unwrap()["auth"];
        assert_eq!(auth["token_url"], "https://sso.example.com");
        assert_eq!(auth["client_secret"], "***");
    }

    #[test]
    fn a_row_replicated_without_its_secret_can_still_be_edited() {
        let mut data: Value = serde_json::from_str(&stored_oauth().data.unwrap()).unwrap();
        data["auth"]["client_secret"] = json!("");
        let replicated = data.to_string();
        let edit = json!({"allowed_tools": ["a"]});
        assert!(updated_data("mcp", Some(&replicated), Some(edit.clone())).is_ok());
        data["auth"]["client_secret"] = json!("s");
        let mut emptied = edit;
        emptied["auth"] = data["auth"].clone();
        emptied["auth"]["client_secret"] = json!("");
        let err = updated_data("mcp", Some(&data.to_string()), Some(emptied)).unwrap_err();
        assert!(
            err.message.contains("client_secret` is required"),
            "{err:?}"
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

    const STORED: &str =
        r#"{"url":"https://mcp.example.com/","headers":{"Authorization":"Bearer real-token"}}"#;

    /// What the edit form sends back after a GET: the redacted data, unchanged.
    fn redacted_round_trip() -> serde_json::Value {
        let stored: serde_json::Value = serde_json::from_str(STORED).unwrap();
        o2_enterprise::enterprise::ai::toolsets::redact_response_data(
            ToolsetKind::Mcp,
            Some(stored),
        )
        .unwrap()
    }

    fn merge_secrets(
        stored: Option<&str>,
        incoming: serde_json::Value,
    ) -> Result<serde_json::Value, UpdateRefusal> {
        updated_data("mcp", stored, Some(incoming)).map(parsed)
    }

    #[test]
    fn a_save_that_sends_the_redacted_header_keeps_the_stored_one() {
        let incoming = redacted_round_trip();
        assert_eq!(incoming["headers"]["Authorization"], "***");
        let merged = merge_secrets(Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer real-token");

        // The agent push parses the stored data as `McpData`, so it carries the real header.
        let pushed: McpData = serde_json::from_value(merged).unwrap();
        assert_eq!(pushed.headers["Authorization"], "Bearer real-token");
    }

    #[test]
    fn a_new_secret_replaces_the_stored_one_and_an_empty_map_removes_it() {
        let mut incoming = redacted_round_trip();
        incoming["headers"]["Authorization"] = json!("Bearer rotated");
        let merged = merge_secrets(Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer rotated");

        let cleared = json!({"url": "https://mcp.example.com/", "headers": {}});
        let merged = merge_secrets(Some(STORED), cleared).unwrap();
        assert_eq!(merged["headers"], json!({}));
    }

    #[test]
    fn a_placeholder_with_nothing_stored_is_refused() {
        assert!(merge_secrets(None, redacted_round_trip()).is_err());
    }

    #[test]
    fn a_kept_header_is_never_sent_to_a_changed_url_or_next_to_a_new_header() {
        let mut incoming = redacted_round_trip();
        incoming["url"] = json!("https://attacker.example/mcp");
        assert!(merge_secrets(Some(STORED), incoming).is_err());
        let mut incoming = redacted_round_trip();
        incoming["headers"]["Host"] = json!("attacker-vhost");
        assert!(merge_secrets(Some(STORED), incoming).is_err());

        // Re-entering the secret makes the new URL acceptable.
        let incoming = json!({
            "url": "https://attacker.example/mcp",
            "headers": {"Authorization": "Bearer typed-again"}
        });
        let merged = merge_secrets(Some(STORED), incoming).unwrap();
        assert_eq!(merged["headers"]["Authorization"], "Bearer typed-again");
    }

    #[tokio::test]
    async fn a_refused_save_is_a_typed_400_that_names_fields_never_values() {
        for (field, change) in [
            ("url", json!({"url": "https://attacker.example/mcp"})),
            (
                "headers",
                json!({"headers": {"Authorization": "***", "Host": "attacker"}}),
            ),
        ] {
            let mut incoming = redacted_round_trip();
            for (key, value) in change.as_object().unwrap() {
                incoming[key] = value.clone();
            }
            let error = merge_secrets(Some(STORED), incoming).unwrap_err();
            let response = update_refused("o", "t1", error);
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let body = body_of(response).await;
            assert_eq!(body["code"], "invalid_request");
            assert_eq!(body["error_code"], "destination_changed");
            assert_eq!(body["fields"], json!([field]));
            let text = body.to_string();
            assert!(
                !text.contains("real-token") && !text.contains("attacker"),
                "{text}"
            );
        }
        let other = update_refused("o", "t1", "invalid mcp data: x".to_string());
        assert!(body_of(other).await.get("error_code").is_none());
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
            region_only: false,
            origin_region: None,
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
            "data: {\"type\":\"tool_result\",\"tool\":\"kubectl_get\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"old_x\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"SearchSQL\",\"success\":true}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"kubectl · get\",\"success\":false}\n",
            "data: {\"type\":\"tool_result\",\"tool\":\"kubectlx · get\",\"success\":true}\n",
        );
        assert_eq!(
            usage.results(frames.as_bytes()),
            vec![
                ("t2".to_string(), true),
                ("t1".to_string(), false),
                ("t3".to_string(), true),
                ("t3".to_string(), false)
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

    #[test]
    fn list_keeps_permitted_toolsets_then_applies_the_limit() {
        let toolset = |id: &str| OrgToolset {
            id: id.to_string(),
            org: "acme".to_string(),
            name: id.to_string(),
            kind: "mcp".to_string(),
            description: None,
            data: None,
            created_by: String::new(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
            region_only: false,
            origin_region: None,
        };
        let granted = |objects: &[&str]| objects.iter().map(|o| o.to_string()).collect::<Vec<_>>();
        let one = granted(&["ai_toolsets:t2"]);
        let two = granted(&["ai_toolsets:t3", "ai_toolsets:t2", "ai_toolsets:other"]);
        let all = granted(&["ai_toolsets:_all_acme"]);
        let other_org = granted(&["ai_toolsets:_all_beta"]);
        type Case<'a> = (&'a str, Option<&'a [String]>, Option<u64>, &'a [&'a str]);
        #[rustfmt::skip]
        let cases: [Case; 6] = [
            ("no filter", None, None, &["t1", "t2", "t3"]),
            ("one toolset granted", Some(&one), None, &["t2"]),
            ("limit counts after the filter", Some(&two), Some(1), &["t2"]),
            ("every toolset of the org", Some(&all), Some(2), &["t1", "t2"]),
            ("another org's grant", Some(&other_org), None, &[]),
            ("no grant", Some(&[]), None, &[]),
        ];
        for (case, permitted, limit, want) in cases {
            let toolsets = ["t1", "t2", "t3"].map(toolset).to_vec();
            let got = permitted_page("acme", toolsets, permitted, limit);
            let got: Vec<&str> = got.iter().map(|t| t.id.as_str()).collect();
            assert_eq!(got, want, "{case}");
        }
    }
}

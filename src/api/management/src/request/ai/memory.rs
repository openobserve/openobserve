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

//! The `/{org_id}/ai/memory` API, each MCP toolset's `/memory`, and o2-ai's `/internal/ai/memory`.

use ::db::ai_memory::{self as memory_db, Submission, Submitted};
use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::ai::memory::{
    AgentMemoryWrites, Author, ContentError, EditFlag, Evidence, MemoryEdit, MemoryScope,
    MemorySettings, RevisionState,
};
use infra::table::ai_memory::{AgentOutcome, AgentWrite, Change, MemoryKey, Outcome, Revision};
use o2_enterprise::enterprise::ai::toolsets::{
    ToolsetKind,
    push::{colliding_names, normalize_tool_name},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    ai_chat::admission::{AdmitError, resolve_owner},
    auth::{UserEmail, check_permissions},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// `content` needs `base_rev`; settings never change `rev`.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct MemoryUpdateRequest {
    pub content: Option<String>,
    pub base_rev: Option<i64>,
    pub reason: Option<String>,
    pub agent_memory_writes: Option<WritesSetting>,
    pub max_bytes: Option<i64>,
    pub user_max_bytes: Option<i64>,
}

impl MemoryUpdateRequest {
    fn settings(&self) -> MemorySettings {
        let writes = self.agent_memory_writes.and_then(|w| match w {
            WritesSetting::Review => Some(AgentMemoryWrites::Review),
            WritesSetting::Auto => Some(AgentMemoryWrites::Auto),
            WritesSetting::Off => Some(AgentMemoryWrites::Off),
            WritesSetting::On => Some(AgentMemoryWrites::On),
            WritesSetting::Inherit => None,
        });
        MemorySettings {
            agent_memory_writes: writes,
            max_bytes: self.max_bytes,
            user_max_bytes: self.user_max_bytes,
            clear_agent_memory_writes: self.agent_memory_writes == Some(WritesSetting::Inherit),
        }
    }
}

/// An agent-write setting, or `inherit` to store none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum WritesSetting {
    Review,
    Auto,
    Off,
    On,
    Inherit,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RevertRequest {
    pub rev: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkDecisionRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MemoryResponse {
    pub scope: MemoryScope,
    pub scope_key: String,
    pub content: String,
    pub rev: i64,
    pub size_bytes: i64,
    /// The cap in force, default included.
    pub max_bytes: i64,
    /// Org memory only: the cap of every user memory in the org.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_max_bytes: Option<i64>,
    /// `null` when the memory follows its default.
    pub agent_memory_writes: Option<AgentMemoryWrites>,
    pub agent_memory_writes_effective: AgentMemoryWrites,
    pub updated_by: Option<String>,
    /// Microseconds since the epoch.
    pub updated_at: Option<i64>,
    pub pending_count: u64,
    /// Whether the caller's own writes apply without approval.
    pub can_apply: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RevisionResponse {
    pub id: String,
    pub rev: Option<i64>,
    pub state: RevisionState,
    pub base_rev: i64,
    pub edits: Option<Vec<MemoryEdit>>,
    /// Applied revisions only, and only when one revision is read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub updated_by: String,
    pub reason: Option<String>,
    pub evidence: Option<Vec<Evidence>>,
    pub origin_region: String,
    pub op_id: String,
    /// Microseconds since the epoch.
    pub created_at: i64,
    /// Why a pending agent edit may need a closer look.
    pub flags: Vec<EditFlag>,
}

impl From<Revision> for RevisionResponse {
    fn from(r: Revision) -> Self {
        Self {
            id: r.id,
            rev: r.rev,
            state: r.state,
            base_rev: r.base_rev,
            edits: r.edits,
            content: r.content,
            updated_by: r.updated_by,
            reason: r.reason,
            evidence: r.evidence,
            origin_region: r.origin_region,
            op_id: r.op_id,
            created_at: r.created_at,
            flags: r.flags,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RevisionListResponse {
    pub revisions: Vec<RevisionResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingEdit {
    pub scope: MemoryScope,
    pub scope_key: String,
    #[serde(flatten)]
    pub revision: RevisionResponse,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingListResponse {
    pub pending: Vec<PendingEdit>,
}

/// An agent's edit from o2-ai; the turn's row decides the org and the user, never this body.
#[derive(Debug, Deserialize)]
pub struct InternalWriteRequest {
    pub org_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub scope: MemoryScope,
    #[serde(default)]
    pub toolset: Option<String>,
    pub base_rev: i64,
    pub edits: Vec<MemoryEdit>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// The caller as a memory author, and whether their shared-memory writes apply directly.
struct Caller {
    author: Author,
    is_memory_admin: bool,
}

#[derive(Clone, Copy)]
enum Decision {
    Accept,
    Discard,
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/org",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiOrgMemory",
    summary = "Get the org's AI memory",
    description = "The org memory every AI turn in the org reads, with its settings. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Org memory", content_type = "application/json", body = MemoryResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_org_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let can_apply = is_memory_admin(&org_id, &user_email.user_id).await;
    read_memory(&MemoryKey::org(&org_id), can_apply).await
}

#[utoipa::path(
    put,
    path = "/{org_id}/ai/memory/org",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiOrgMemory",
    summary = "Replace the org's AI memory text or change its settings",
    description = "Memory admins only. `content` needs the `base_rev` it was edited against. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(MemoryUpdateRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied: `{state, rev, op_id}`", content_type = "application/json"),
        (status = 400, description = "Invalid request, or `{code: memory_too_large}`", content_type = "application/json"),
        (status = 403, description = "Not a memory admin", content_type = "application/json"),
        (status = 409, description = "`{code: rev_conflict, rev, content}`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update_org_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<MemoryUpdateRequest>,
) -> Response {
    match caller(&org_id, &user_email.user_id).await {
        Ok(caller) => write_memory(&MemoryKey::org(&org_id), None, body, caller).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/org/revisions",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiOrgMemoryRevisions",
    summary = "List the org memory's revisions",
    description = "Newest first, without each revision's full text. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses((status = 200, description = "Revisions", content_type = "application/json", body = RevisionListResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_org_memory_revisions(Path(org_id): Path<String>) -> Response {
    list_revisions(&MemoryKey::org(&org_id)).await
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/org/revisions/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiOrgMemoryRevision",
    summary = "Get one org memory revision",
    description = "Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Revision", content_type = "application/json", body = RevisionResponse),
        (status = 404, description = "No such revision of this memory", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_org_memory_revision(Path((org_id, id)): Path<(String, String)>) -> Response {
    get_revision(&MemoryKey::org(&org_id), &id).await
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/org/revert",
    context_path = "/api",
    tag = "AI",
    operation_id = "RevertAiOrgMemory",
    summary = "Revert the org memory to an earlier revision",
    description = "Writes revision `rev`'s text as a new revision. Memory admins only. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(RevertRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 404, description = "No applied revision `rev`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn revert_org_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RevertRequest>,
) -> Response {
    match caller(&org_id, &user_email.user_id).await {
        Ok(caller) => revert(&MemoryKey::org(&org_id), None, body.rev, caller).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/org/revisions/{id}/accept",
    context_path = "/api",
    tag = "AI",
    operation_id = "AcceptAiOrgMemoryRevision",
    summary = "Accept a pending org memory edit",
    description = "Re-applies the edit to the latest text. Memory admins only. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 404, description = "No pending revision with this id in this memory", content_type = "application/json"),
        (status = 409, description = "`{code: edit_conflict}`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn accept_org_memory_revision(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide(&MemoryKey::org(&org_id), &id, Decision::Accept, admin).await
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/org/revisions/{id}/discard",
    context_path = "/api",
    tag = "AI",
    operation_id = "DiscardAiOrgMemoryRevision",
    summary = "Discard a pending org memory edit",
    description = "Memory admins only. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Discarded", content_type = "application/json"),
        (status = 404, description = "No pending revision with this id in this memory", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn discard_org_memory_revision(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide(&MemoryKey::org(&org_id), &id, Decision::Discard, admin).await
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MemoryResyncResponse {
    /// Messages sent: one per memory, plus one per delete of the last 30 days.
    pub published: usize,
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/_resync",
    context_path = "/api",
    tag = "AI",
    operation_id = "ResyncAiMemory",
    summary = "Re-send the org's AI memory to the other regions",
    description = "Republishes every org, toolset and user memory of the org (applied content, settings and \
                   pending edits) plus the deletes of the last 30 days, so a region that missed changes \
                   catches up. Adds and updates only; never deletes a memory another region lacks. Needs \
                   the memory admin permission. Only available in enterprise deployments with super cluster enabled.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Messages sent", content_type = "application/json", body = MemoryResyncResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn resync_memory(Path(org_id): Path<String>) -> Response {
    let now = config::utils::time::now_micros();
    match ::db::ai_memory_replication::resync(&org_id, now).await {
        Ok(published) => Json(MemoryResyncResponse { published }).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/pending",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiMemoryPendingEdits",
    summary = "List pending memory edits",
    description = "Every edit waiting for a memory admin, across org and toolset memories, oldest first. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses((status = 200, description = "Pending edits", content_type = "application/json", body = PendingListResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_pending_memory_edits(Path(org_id): Path<String>) -> Response {
    match memory_db::list_pending(&org_id).await {
        Ok(pending) => Json(PendingListResponse {
            pending: pending
                .into_iter()
                .map(|p| PendingEdit {
                    scope: p.key.scope,
                    scope_key: p.key.scope_key,
                    revision: p.revision.into(),
                })
                .collect(),
        })
        .into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/pending/accept",
    context_path = "/api",
    tag = "AI",
    operation_id = "AcceptAiMemoryPendingEdits",
    summary = "Accept pending memory edits",
    description = "Accepts each id in turn; the result lists one outcome per id. Memory admins only. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(BulkDecisionRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses((status = 200, description = "`{results: [{id, status, ...}]}`", content_type = "application/json")),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn accept_pending_memory_edits(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BulkDecisionRequest>,
) -> Response {
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide_many(&org_id, body.ids, Decision::Accept, admin).await
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/pending/discard",
    context_path = "/api",
    tag = "AI",
    operation_id = "DiscardAiMemoryPendingEdits",
    summary = "Discard pending memory edits",
    description = "Discards each id; the result lists one outcome per id. Memory admins only. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(BulkDecisionRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses((status = 200, description = "`{results: [{id, status, ...}]}`", content_type = "application/json")),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn discard_pending_memory_edits(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BulkDecisionRequest>,
) -> Response {
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide_many(&org_id, body.ids, Decision::Discard, admin).await
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/{id}/memory",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiToolsetMemory",
    summary = "Get an MCP toolset's AI memory",
    description = "Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Toolset memory", content_type = "application/json", body = MemoryResponse),
        (status = 400, description = "The toolset is not an MCP toolset", content_type = "application/json"),
        (status = 404, description = "Toolset not found", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_toolset_memory(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let key = match toolset_key(&org_id, &id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    let can_apply = is_memory_admin(&org_id, &user_email.user_id).await;
    read_memory(&key, can_apply).await
}

#[utoipa::path(
    put,
    path = "/{org_id}/ai/toolsets/{id}/memory",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiToolsetMemory",
    summary = "Replace an MCP toolset's AI memory text or change its settings",
    description = "Memory admins only. `content` needs the `base_rev` it was edited against. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    request_body(content = inline(MemoryUpdateRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 400, description = "Invalid request, or `{code: memory_too_large}`", content_type = "application/json"),
        (status = 403, description = "Not a memory admin", content_type = "application/json"),
        (status = 409, description = "`{code: rev_conflict, rev, content}`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update_toolset_memory(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<MemoryUpdateRequest>,
) -> Response {
    let key = match toolset_key(&org_id, &id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    match caller(&org_id, &user_email.user_id).await {
        Ok(caller) => write_memory(&key, Some(&id), body, caller).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/{id}/memory/revisions",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiToolsetMemoryRevisions",
    summary = "List an MCP toolset memory's revisions",
    description = "Newest first, without each revision's full text. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    security(("Authorization" = [])),
    responses((status = 200, description = "Revisions", content_type = "application/json", body = RevisionListResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_toolset_memory_revisions(Path((org_id, id)): Path<(String, String)>) -> Response {
    match toolset_key(&org_id, &id).await {
        Ok(key) => list_revisions(&key).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/toolsets/{id}/memory/revisions/{rev_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiToolsetMemoryRevision",
    summary = "Get one MCP toolset memory revision",
    description = "Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
        ("rev_id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Revision", content_type = "application/json", body = RevisionResponse),
        (status = 404, description = "No such revision of this memory", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_toolset_memory_revision(
    Path((org_id, id, rev_id)): Path<(String, String, String)>,
) -> Response {
    match toolset_key(&org_id, &id).await {
        Ok(key) => get_revision(&key, &rev_id).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/{id}/memory/revert",
    context_path = "/api",
    tag = "AI",
    operation_id = "RevertAiToolsetMemory",
    summary = "Revert an MCP toolset memory to an earlier revision",
    description = "Writes revision `rev`'s text as a new revision. Memory admins only. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
    ),
    request_body(content = inline(RevertRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 404, description = "No applied revision `rev`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn revert_toolset_memory(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RevertRequest>,
) -> Response {
    let key = match toolset_key(&org_id, &id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    match caller(&org_id, &user_email.user_id).await {
        Ok(caller) => revert(&key, Some(&id), body.rev, caller).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/{id}/memory/revisions/{rev_id}/accept",
    context_path = "/api",
    tag = "AI",
    operation_id = "AcceptAiToolsetMemoryRevision",
    summary = "Accept a pending MCP toolset memory edit",
    description = "Re-applies the edit to the latest text. Memory admins only. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
        ("rev_id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 404, description = "No pending revision with this id in this memory", content_type = "application/json"),
        (status = 409, description = "`{code: edit_conflict}`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn accept_toolset_memory_revision(
    Path((org_id, id, rev_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let key = match toolset_key(&org_id, &id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide(&key, &rev_id, Decision::Accept, admin).await
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/toolsets/{id}/memory/revisions/{rev_id}/discard",
    context_path = "/api",
    tag = "AI",
    operation_id = "DiscardAiToolsetMemoryRevision",
    summary = "Discard a pending MCP toolset memory edit",
    description = "Memory admins only. Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Toolset id (KSUID)"),
        ("rev_id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Discarded", content_type = "application/json"),
        (status = 404, description = "No pending revision with this id in this memory", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn discard_toolset_memory_revision(
    Path((org_id, id, rev_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let key = match toolset_key(&org_id, &id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    let admin = is_memory_admin(&org_id, &user_email.user_id).await;
    decide(&key, &rev_id, Decision::Discard, admin).await
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/me",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiMyMemory",
    summary = "Get the caller's own AI memory",
    description = "Read only in the caller's own turns. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses((status = 200, description = "User memory", content_type = "application/json", body = MemoryResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_my_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => read_memory(&key, true).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/ai/memory/me",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiMyMemory",
    summary = "Replace the caller's own AI memory text or switch agent writes",
    description = "`content` needs `base_rev`; `agent_memory_writes` is `on` or `off`. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(MemoryUpdateRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 400, description = "Invalid request, or `{code: memory_too_large}`", content_type = "application/json"),
        (status = 409, description = "`{code: rev_conflict, rev, content}`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update_my_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<MemoryUpdateRequest>,
) -> Response {
    match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => {
            let caller = Caller {
                author: Author::User(key.scope_key.clone()),
                is_memory_admin: false,
            };
            write_memory(&key, None, body, caller).await
        }
        Err(resp) => resp,
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/ai/memory/me",
    context_path = "/api",
    tag = "AI",
    operation_id = "DeleteAiMyMemory",
    summary = "Clear the caller's own AI memory",
    description = "Deletes the text, its settings and its history. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses((status = 200, description = "Deleted", content_type = "application/json", body = MetaHttpResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "delete"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete_my_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let key = match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => key,
        Err(resp) => return resp,
    };
    match memory_db::delete(&key).await {
        Ok(()) => MetaHttpResponse::ok("memory deleted"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/me/revisions",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiMyMemoryRevisions",
    summary = "List the caller's own memory revisions",
    description = "Newest first, without each revision's full text. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    security(("Authorization" = [])),
    responses((status = 200, description = "Revisions", content_type = "application/json", body = RevisionListResponse)),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_my_memory_revisions(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => list_revisions(&key).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/memory/me/revisions/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiMyMemoryRevision",
    summary = "Get one of the caller's own memory revisions",
    description = "Only available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Revision id"),
    ),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Revision", content_type = "application/json", body = RevisionResponse),
        (status = 404, description = "No such revision of this memory", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "get"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_my_memory_revision(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => get_revision(&key, &id).await,
        Err(resp) => resp,
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/memory/me/revert",
    context_path = "/api",
    tag = "AI",
    operation_id = "RevertAiMyMemory",
    summary = "Revert the caller's own memory to an earlier revision",
    description = "Writes revision `rev`'s text as a new revision. Only available in enterprise deployments.",
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(RevertRequest), content_type = "application/json"),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Applied", content_type = "application/json"),
        (status = 404, description = "No applied revision `rev`", content_type = "application/json"),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "update"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn revert_my_memory(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RevertRequest>,
) -> Response {
    match my_key(&org_id, &user_email.user_id).await {
        Ok(key) => {
            let caller = Caller {
                author: Author::User(key.scope_key.clone()),
                is_memory_admin: false,
            };
            revert(&key, None, body.rev, caller).await
        }
        Err(resp) => resp,
    }
}

/// o2-ai's write for a running turn: checks the secret, then the turn, then writes as the agent.
/// Not under `/api`, so no user auth runs before it and it writes its own audit entry.
pub async fn internal_write(headers: axum::http::HeaderMap, body: axum::body::Bytes) -> Response {
    use o2_enterprise::enterprise::ai::client::{INTERNAL_SECRET_HEADER, internal_secret_matches};
    let supplied = headers
        .get(INTERNAL_SECRET_HEADER)
        .and_then(|v| v.to_str().ok());
    if let Some(refusal) = secret_refusal(internal_secret_matches(supplied)) {
        return refusal;
    }
    let request: InternalWriteRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(e) => return MetaHttpResponse::bad_request(format!("invalid request: {e}")),
    };
    if request.edits.is_empty() {
        return MetaHttpResponse::bad_request("edits must not be empty");
    }
    let (status, reply) = write_for_turn(request).await;
    audit_internal_write(&body, status, &reply).await;
    (status, Json(reply)).into_response()
}

/// Holding `ai_memory` PUT is what makes someone a memory admin.
async fn is_memory_admin(org_id: &str, user_email: &str) -> bool {
    check_permissions(
        org_id,
        org_id,
        user_email,
        "ai_memory",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
}

async fn caller(org_id: &str, user_email: &str) -> Result<Caller, Response> {
    let user_id = resolve_owner(user_email).await.map_err(owner_error)?;
    Ok(Caller {
        author: Author::User(user_id),
        is_memory_admin: is_memory_admin(org_id, user_email).await,
    })
}

async fn my_key(org_id: &str, user_email: &str) -> Result<MemoryKey, Response> {
    let user_id = resolve_owner(user_email).await.map_err(owner_error)?;
    Ok(MemoryKey::user(org_id, &user_id))
}

/// Memory belongs to MCP toolsets only, under the normalized name every region shares.
async fn toolset_key(org_id: &str, id: &str) -> Result<MemoryKey, Response> {
    let toolset = match infra::table::org_ai_toolsets::get(org_id, id).await {
        Ok(Some(t)) => t,
        Ok(None) => {
            return Err(MetaHttpResponse::not_found(format!(
                "toolset '{id}' not found"
            )));
        }
        Err(e) => return Err(MetaHttpResponse::internal_error(e)),
    };
    if toolset.kind.parse::<ToolsetKind>() != Ok(ToolsetKind::Mcp) {
        return Err(MetaHttpResponse::bad_request(
            "only MCP toolsets have a memory",
        ));
    }
    let names = infra::table::org_ai_toolsets::list_names(org_id)
        .await
        .map_err(MetaHttpResponse::internal_error)?;
    let normalized = normalize_tool_name(&toolset.name);
    if colliding_names(names.iter().map(String::as_str)).contains(&normalized) {
        return Err(MetaHttpResponse::conflict(format!(
            "another toolset's name also normalizes to '{normalized}', so their memory would be \
             shared; rename one of them first"
        )));
    }
    Ok(MemoryKey::toolset(org_id, &normalized))
}

fn owner_error(error: AdmitError) -> Response {
    match error {
        AdmitError::NotRegistered => {
            MetaHttpResponse::forbidden("AI memory is only available to registered users")
        }
        AdmitError::Unavailable(message) => MetaHttpResponse::service_unavailable(message),
        other => MetaHttpResponse::internal_error(format!("{other:?}")),
    }
}

async fn read_memory(key: &MemoryKey, can_apply: bool) -> Response {
    match memory_body(key, can_apply).await {
        Ok(body) => Json(body).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// A scope with no row reads as empty memory with default settings.
async fn memory_body(
    key: &MemoryKey,
    can_apply: bool,
) -> Result<MemoryResponse, infra::errors::Error> {
    let memory = memory_db::get(key).await?;
    let writes = memory_db::effective_writes(key, memory.as_ref()).await?;
    let settings = memory
        .as_ref()
        .map(|m| m.settings.clone())
        .unwrap_or_default();
    let cap_setting = match key.scope {
        MemoryScope::User => memory_db::get(&MemoryKey::org(&key.org))
            .await?
            .and_then(|org| org.settings.user_max_bytes),
        MemoryScope::Org | MemoryScope::Toolset => settings.max_bytes,
    };
    let pending_count = match &memory {
        Some(m) => memory_db::count_pending(&m.id).await?,
        None => 0,
    };
    let content = memory
        .as_ref()
        .map(|m| m.content.clone())
        .unwrap_or_default();
    Ok(MemoryResponse {
        scope: key.scope,
        scope_key: key.scope_key.clone(),
        size_bytes: content.len() as i64,
        content,
        rev: memory.as_ref().map_or(0, |m| m.rev),
        max_bytes: key.scope.effective_max_bytes(cap_setting),
        user_max_bytes: (key.scope == MemoryScope::Org)
            .then(|| MemoryScope::User.effective_max_bytes(settings.user_max_bytes)),
        agent_memory_writes: settings.agent_memory_writes,
        agent_memory_writes_effective: writes,
        updated_by: memory.as_ref().map(|m| m.updated_by.clone()),
        updated_at: memory.as_ref().map(|m| m.updated_at),
        pending_count,
        can_apply,
    })
}

/// Shared settings need a memory admin; others' whole text is held (202). Settings and text
/// commit together, and nothing commits on a refusal. [strong]
async fn write_memory(
    key: &MemoryKey,
    toolset_id: Option<&str>,
    body: MemoryUpdateRequest,
    caller: Caller,
) -> Response {
    let settings = body.settings();
    if let Err(resp) = check_write(key.scope, &body, &settings, caller.is_memory_admin) {
        return resp;
    }
    let Some(content) = body.content else {
        return match memory_db::set_settings(key, toolset_id, &settings).await {
            Ok(outcome) => outcome_response(outcome),
            Err(e) => MetaHttpResponse::internal_error(e),
        };
    };
    let submission = Submission {
        key: key.clone(),
        toolset_id: toolset_id.map(str::to_string),
        // check_write refused a `content` without `base_rev`.
        base_rev: body.base_rev.unwrap_or_default(),
        change: Change::Content(content),
        settings,
        author: caller.author,
        is_memory_admin: caller.is_memory_admin,
        reason: body.reason,
        evidence: None,
    };
    match memory_db::submit(submission).await {
        Ok(Submitted::Written(outcome)) => outcome_response(outcome),
        Ok(Submitted::Refused | Submitted::NeedsMemoryAdmin) => {
            MetaHttpResponse::forbidden("only a memory admin can change this memory")
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

fn check_write(
    scope: MemoryScope,
    body: &MemoryUpdateRequest,
    settings: &MemorySettings,
    is_memory_admin: bool,
) -> Result<(), Response> {
    let shared = scope != MemoryScope::User;
    if shared && !is_memory_admin && (body.content.is_none() || !settings.is_empty()) {
        return Err(MetaHttpResponse::forbidden(
            "only a memory admin can change this memory",
        ));
    }
    if body.content.is_none() && settings.is_empty() {
        return Err(MetaHttpResponse::bad_request("nothing to change"));
    }
    if body.content.is_some() && body.base_rev.is_none() {
        return Err(MetaHttpResponse::bad_request(
            "base_rev is required with content",
        ));
    }
    settings
        .validate(scope)
        .map_err(MetaHttpResponse::bad_request)
}

async fn revert(key: &MemoryKey, toolset_id: Option<&str>, rev: i64, caller: Caller) -> Response {
    if key.scope != MemoryScope::User && !caller.is_memory_admin {
        return MetaHttpResponse::forbidden("only a memory admin can revert this memory");
    }
    match memory_db::revert(key, toolset_id, rev, caller.author).await {
        Ok(outcome) => outcome_response(outcome),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

async fn list_revisions(key: &MemoryKey) -> Response {
    let memory = match memory_db::get(key).await {
        Ok(memory) => memory,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let revisions = match memory {
        Some(m) => match memory_db::list_revisions(&key.org, &m.id).await {
            Ok(revisions) => revisions,
            Err(e) => return MetaHttpResponse::internal_error(e),
        },
        None => vec![],
    };
    Json(RevisionListResponse {
        revisions: revisions.into_iter().map(Into::into).collect(),
    })
    .into_response()
}

async fn get_revision(key: &MemoryKey, revision_id: &str) -> Response {
    let not_found = || MetaHttpResponse::not_found(format!("revision '{revision_id}' not found"));
    let memory = match memory_db::get(key).await {
        Ok(Some(memory)) => memory,
        Ok(None) => return not_found(),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    match memory_db::get_revision(&key.org, &memory.id, revision_id).await {
        Ok(Some(revision)) => Json(RevisionResponse::from(revision)).into_response(),
        Ok(None) => not_found(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// The revision must belong to `key`'s memory, so a path never reaches another memory's edit.
async fn decide(
    key: &MemoryKey,
    revision_id: &str,
    decision: Decision,
    is_memory_admin: bool,
) -> Response {
    if !is_memory_admin {
        return MetaHttpResponse::forbidden("only a memory admin can accept or discard edits");
    }
    let memory = match memory_db::get(key).await {
        Ok(Some(memory)) => memory,
        Ok(None) => return outcome_response(Outcome::NotFound),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    match apply_decision(key, &memory.id, revision_id, decision).await {
        Ok(outcome) => outcome_response(outcome),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

async fn decide_many(
    org_id: &str,
    ids: Vec<String>,
    decision: Decision,
    is_memory_admin: bool,
) -> Response {
    if !is_memory_admin {
        return MetaHttpResponse::forbidden("only a memory admin can accept or discard edits");
    }
    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let outcome = match memory_db::revision_memory(org_id, &id).await {
            Ok(Some((memory_id, key))) => apply_decision(&key, &memory_id, &id, decision).await,
            Ok(None) => Ok(Outcome::NotFound),
            Err(e) => Err(e),
        };
        let (status, mut body) = match outcome {
            Ok(outcome) => outcome_parts(outcome),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"code": "internal_error", "message": e.to_string()}),
            ),
        };
        body["id"] = Value::String(id);
        body["status"] = Value::from(status.as_u16());
        results.push(body);
    }
    Json(json!({ "results": results })).into_response()
}

async fn apply_decision(
    key: &MemoryKey,
    memory_id: &str,
    revision_id: &str,
    decision: Decision,
) -> Result<Outcome, infra::errors::Error> {
    match decision {
        Decision::Accept => memory_db::accept(key, memory_id, revision_id).await,
        Decision::Discard => memory_db::discard(key, memory_id, revision_id).await,
    }
}

fn secret_refusal(matches: Option<bool>) -> Option<Response> {
    match matches {
        None => Some(MetaHttpResponse::service_unavailable(
            "the internal secret is not set on OpenObserve",
        )),
        Some(false) => Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"code": 401, "message": "missing or wrong internal secret"})),
            )
                .into_response(),
        ),
        Some(true) => None,
    }
}

/// The reply for an agent's write; the turn, chat, setting and cap are checked in its transaction.
async fn write_for_turn(request: InternalWriteRequest) -> (StatusCode, Value) {
    let toolset = match (request.scope, request.toolset.as_deref()) {
        (MemoryScope::Toolset, name) => {
            let name = name.unwrap_or_default();
            match mcp_toolset_id(&request.org_id, name).await {
                Some(id) => Some((name.to_string(), id)),
                None => return (StatusCode::OK, unknown_toolset()),
            }
        }
        (MemoryScope::Org | MemoryScope::User, _) => None,
    };
    let now = config::utils::time::now_micros();
    let evidence = request
        .evidence
        .into_iter()
        .map(|e| Evidence {
            turn_id: Some(request.turn_id.clone()),
            ..e
        })
        .collect();
    let write = AgentWrite {
        org: request.org_id,
        session_id: request.session_id,
        turn_id: request.turn_id,
        running_since: super::chats::running_since(now),
        scope: request.scope,
        toolset,
        base_rev: request.base_rev,
        edits: request.edits,
        reason: request.reason,
        evidence,
        origin_region: String::new(),
        now,
    };
    match memory_db::agent_write(write).await {
        Ok(AgentOutcome::TurnNotRunning) => (
            StatusCode::FORBIDDEN,
            json!({"code": "turn_not_running", "message": "the turn is not running"}),
        ),
        Ok(AgentOutcome::UserScopeRefused) => (
            StatusCode::OK,
            refusal(
                "user_scope_not_allowed",
                "an RCA turn has no user to remember things for",
            ),
        ),
        Ok(AgentOutcome::WritesOff) => (
            StatusCode::OK,
            refusal("writes_off", "AI changes to this memory are turned off"),
        ),
        Ok(AgentOutcome::Written(key, outcome)) => {
            (StatusCode::OK, agent_reply(key.scope, outcome))
        }
        Err(e) => {
            log::error!("[AI-MEMORY] agent write failed: {e}");
            let reply = json!({"code": "internal_error", "message": "the write failed"});
            (StatusCode::INTERNAL_SERVER_ERROR, reply)
        }
    }
}

fn unknown_toolset() -> Value {
    refusal(
        "unknown_toolset",
        "no MCP toolset of the org has this normalized name",
    )
}

/// The id of the one MCP toolset whose normalized name is `name`; a read error finds none.
async fn mcp_toolset_id(org: &str, name: &str) -> Option<String> {
    let filter = infra::table::org_ai_toolsets::ListFilter {
        name: None,
        kind: Some(ToolsetKind::Mcp.to_string()),
    };
    let toolsets = match infra::table::org_ai_toolsets::list(org, filter, None).await {
        Ok(toolsets) => toolsets,
        Err(e) => {
            log::error!("[AI-MEMORY] cannot list toolsets of {org}: {e}");
            return None;
        }
    };
    let names = infra::table::org_ai_toolsets::list_names(org).await.ok()?;
    if colliding_names(names.iter().map(String::as_str)).contains(name) {
        return None;
    }
    toolsets
        .into_iter()
        .find(|t| normalize_tool_name(&t.name) == name)
        .map(|t| t.id)
}

fn refusal(code: &str, reason: &str) -> Value {
    json!({"status": "refused", "code": code, "reason": reason})
}

fn agent_reply(scope: MemoryScope, outcome: Outcome) -> Value {
    match outcome {
        Outcome::Applied { rev, .. } => json!({"status": "applied", "rev": rev}),
        Outcome::Unchanged { rev } => json!({"status": "applied", "rev": rev, "no_change": true}),
        Outcome::Pending { revision_id } => json!({
            "status": "pending",
            "revision_id": revision_id,
            "reason": "needs a memory admin's approval",
        }),
        Outcome::RevConflict { rev, content } => json!({
            "status": "refused",
            "code": "rev_conflict",
            "reason": "the memory changed since base_rev; retry against this rev and content",
            "rev": rev,
            "content": content,
        }),
        Outcome::EditConflict(e @ config::meta::ai::memory::EditError::Empty { .. }) => {
            refusal("invalid_content", &e.to_string())
        }
        Outcome::EditConflict(e) => refusal("edit_no_match", &e.to_string()),
        Outcome::Invalid(e @ ContentError::TooLarge { .. }) => refusal("too_large", &e.to_string()),
        Outcome::Invalid(e @ ContentError::LooksLikeSecret { .. }) => {
            refusal("invalid_content", &e.to_string())
        }
        Outcome::NotFound if scope == MemoryScope::User => refusal(
            "user_scope_not_allowed",
            "the user is no longer a member of the org",
        ),
        Outcome::NotFound => unknown_toolset(),
        Outcome::Discarded | Outcome::SettingsSaved { .. } => refusal(
            "invalid_content",
            "the write changed nothing it could report",
        ),
    }
}

/// The route has no audit middleware, so it records each call itself.
async fn audit_internal_write(body: &[u8], status: StatusCode, reply: &Value) {
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    if !get_o2_config().common.audit_enabled {
        return;
    }
    audit::audit(internal_audit_message(body, status, reply)).await;
}

/// Attributed to o2-ai; the body names the session and turn the edit came from.
fn internal_audit_message(
    body: &[u8],
    status: StatusCode,
    reply: &Value,
) -> o2_enterprise::enterprise::common::auditor::AuditMessage {
    use o2_enterprise::enterprise::common::auditor::{AuditMessage, Protocol, ResponseMeta};
    let request: Value = serde_json::from_slice(body).unwrap_or_default();
    let error_msg = (reply["status"] != "applied" && reply["status"] != "pending")
        .then(|| reply["code"].as_str().unwrap_or("refused").to_string());
    AuditMessage {
        login_ip: None,
        user_agent: None,
        user_email: "o2-ai".to_string(),
        org_id: request["org_id"].as_str().unwrap_or_default().to_string(),
        _timestamp: config::utils::time::now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: "/internal/ai/memory".to_string(),
            http_query_params: String::new(),
            http_body: String::from_utf8_lossy(body).to_string(),
            http_response_code: status.as_u16(),
            error_msg,
            trace_id: None,
        },
        delegated: None,
        fleet_id: None,
        target: None,
    }
}

fn outcome_response(outcome: Outcome) -> Response {
    let (status, body) = outcome_parts(outcome);
    (status, Json(body)).into_response()
}

fn outcome_parts(outcome: Outcome) -> (StatusCode, Value) {
    match outcome {
        Outcome::Applied { rev, op_id } => (
            StatusCode::OK,
            json!({"state": "applied", "rev": rev, "op_id": op_id}),
        ),
        Outcome::Pending { revision_id } => (
            StatusCode::ACCEPTED,
            json!({"state": "pending", "revision_id": revision_id}),
        ),
        Outcome::Unchanged { rev } => (
            StatusCode::OK,
            json!({"state": "applied", "rev": rev, "no_change": true}),
        ),
        Outcome::Discarded => (StatusCode::OK, json!({"state": "discarded"})),
        Outcome::SettingsSaved { rev, op_id } => (
            StatusCode::OK,
            json!({"state": "applied", "rev": rev, "op_id": op_id}),
        ),
        Outcome::RevConflict { rev, content } => (
            StatusCode::CONFLICT,
            json!({"code": "rev_conflict", "rev": rev, "content": content}),
        ),
        Outcome::EditConflict(e) => (
            StatusCode::CONFLICT,
            json!({"code": "edit_conflict", "message": e.to_string()}),
        ),
        Outcome::Invalid(ContentError::TooLarge {
            size_bytes,
            max_bytes,
        }) => (
            StatusCode::BAD_REQUEST,
            json!({"code": "memory_too_large", "size_bytes": size_bytes, "max_bytes": max_bytes}),
        ),
        Outcome::Invalid(e @ ContentError::LooksLikeSecret { .. }) => (
            StatusCode::BAD_REQUEST,
            json!({"code": "memory_looks_like_secret", "message": e.to_string()}),
        ),
        Outcome::NotFound => (
            StatusCode::NOT_FOUND,
            json!({"code": "not_found", "message": "no such toolset, pending revision or applied rev in this memory"}),
        ),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    async fn body_of(resp: Response) -> Value {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn person(is_memory_admin: bool) -> Caller {
        Caller {
            author: Author::User("u1".to_string()),
            is_memory_admin,
        }
    }

    fn text(content: &str, base_rev: i64) -> MemoryUpdateRequest {
        MemoryUpdateRequest {
            content: Some(content.to_string()),
            base_rev: Some(base_rev),
            ..Default::default()
        }
    }

    /// The handlers read the global meta store; CI points it at one through `ZO_META_STORE`.
    pub(crate) async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
            infra::table::cipher::boot(None).await.expect("cipher");
        })
        .await;
        true
    }

    fn unique_org(label: &str) -> String {
        format!("{label}_{}", config::utils::time::now_micros())
    }

    #[tokio::test]
    async fn a_non_admin_cannot_put_shared_memory_settings() {
        for key in [MemoryKey::org("o1"), MemoryKey::toolset("o1", "datadog")] {
            let with_cap = MemoryUpdateRequest {
                max_bytes: Some(32 * 1024),
                ..text("x", 0)
            };
            let resp = write_memory(&key, None, with_cap, person(false)).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
            let settings = MemoryUpdateRequest {
                agent_memory_writes: Some(WritesSetting::Auto),
                ..Default::default()
            };
            let resp = write_memory(&key, None, settings, person(false)).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
            let resp = revert(&key, None, 1, person(false)).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        }
        let resp = decide(&MemoryKey::org("o1"), "r1", Decision::Accept, false).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        let resp = decide_many("o1", vec!["r1".to_string()], Decision::Discard, false).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_put_is_checked_before_anything_is_written() {
        let user = MemoryScope::User;
        let check = |body: &MemoryUpdateRequest, scope, admin| {
            check_write(scope, body, &body.settings(), admin).map(|_| ())
        };
        assert!(check(&MemoryUpdateRequest::default(), user, false).is_err());
        let no_base = MemoryUpdateRequest {
            content: Some("x".to_string()),
            ..Default::default()
        };
        assert!(check(&no_base, user, false).is_err());
        assert!(check(&text("x", 0), user, false).is_ok());
        let own_cap = MemoryUpdateRequest {
            max_bytes: Some(4096),
            ..Default::default()
        };
        assert!(check(&own_cap, user, false).is_err());
        let off = MemoryUpdateRequest {
            agent_memory_writes: Some(WritesSetting::Off),
            ..Default::default()
        };
        assert!(check(&off, user, false).is_ok());
        assert!(check(&off, MemoryScope::Org, true).is_ok());
    }

    #[test]
    fn write_outcomes_map_to_the_documented_responses() {
        let cases = [
            (
                Outcome::Applied {
                    rev: 2,
                    op_id: "op".to_string(),
                },
                StatusCode::OK,
                json!({"state": "applied", "rev": 2, "op_id": "op"}),
            ),
            (
                Outcome::Pending {
                    revision_id: "r".to_string(),
                },
                StatusCode::ACCEPTED,
                json!({"state": "pending", "revision_id": "r"}),
            ),
            (
                Outcome::RevConflict {
                    rev: 3,
                    content: "c".to_string(),
                },
                StatusCode::CONFLICT,
                json!({"code": "rev_conflict", "rev": 3, "content": "c"}),
            ),
            (
                Outcome::Invalid(ContentError::TooLarge {
                    size_bytes: 5,
                    max_bytes: 4,
                }),
                StatusCode::BAD_REQUEST,
                json!({"code": "memory_too_large", "size_bytes": 5, "max_bytes": 4}),
            ),
        ];
        for (outcome, status, body) in cases {
            assert_eq!(outcome_parts(outcome), (status, body));
        }
        let (status, body) = outcome_parts(Outcome::EditConflict(
            config::meta::ai::memory::EditError::NoMatch { index: 0 },
        ));
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::CONFLICT, &json!("edit_conflict"))
        );
    }

    #[tokio::test]
    async fn a_settings_only_put_keeps_the_rev() {
        if !meta_store().await {
            return;
        }
        let key = MemoryKey::org(&unique_org("memory_settings"));
        let resp = write_memory(&key, None, text("## Notes\n", 0), person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let settings = MemoryUpdateRequest {
            agent_memory_writes: Some(WritesSetting::Auto),
            max_bytes: Some(32 * 1024),
            ..Default::default()
        };
        let resp = write_memory(&key, None, settings, person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_of(resp).await["rev"], json!(1));
        let read = memory_body(&key, true).await.unwrap();
        assert_eq!((read.rev, read.max_bytes), (1, 32 * 1024));
        assert_eq!(read.agent_memory_writes_effective, AgentMemoryWrites::Auto);
    }

    #[tokio::test]
    async fn a_non_admin_s_text_is_held_and_applies_only_on_its_base_rev() {
        if !meta_store().await {
            return;
        }
        let key = MemoryKey::org(&unique_org("memory_propose"));
        let resp = write_memory(&key, None, text("a\n", 0), person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let mut held = vec![];
        for proposal in ["b\n", "c\n"] {
            let resp = write_memory(&key, None, text(proposal, 1), person(false)).await;
            assert_eq!(resp.status(), StatusCode::ACCEPTED);
            held.push(
                body_of(resp).await["revision_id"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        let read = memory_body(&key, false).await.unwrap();
        assert_eq!(
            (read.rev, read.content.as_str(), read.pending_count),
            (1, "a\n", 2)
        );
        let resp = decide(&key, &held[0], Decision::Accept, true).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = decide(&key, &held[1], Decision::Accept, true).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let body = body_of(resp).await;
        assert_eq!(
            (&body["code"], &body["rev"]),
            (&json!("rev_conflict"), &json!(2))
        );
        let read = memory_body(&key, true).await.unwrap();
        assert_eq!((read.rev, read.content.as_str()), (2, "b\n"));
    }

    #[tokio::test]
    async fn inherit_clears_a_toolset_s_own_agent_write_setting() {
        let inherit: MemoryUpdateRequest =
            serde_json::from_value(json!({"agent_memory_writes": "inherit"})).unwrap();
        let settings = inherit.settings();
        assert!(settings.clear_agent_memory_writes && settings.agent_memory_writes.is_none());
        assert!(settings.validate(MemoryScope::User).is_err());
        if !meta_store().await {
            return;
        }
        let key = MemoryKey::org(&unique_org("memory_inherit"));
        let off = MemoryUpdateRequest {
            agent_memory_writes: Some(WritesSetting::Off),
            ..Default::default()
        };
        let resp = write_memory(&key, None, off, person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = write_memory(&key, None, inherit, person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let read = memory_body(&key, true).await.unwrap();
        assert_eq!(read.agent_memory_writes, None);
    }

    /// A user who is a member of `org`; private memory is written only for members.
    async fn member(org: &str, label: &str) -> String {
        use config::meta::{organization::OrganizationType, user::UserRole};
        use infra::table::{org_users, organizations, users};
        let email = format!("{label}-{}@example.com", config::utils::time::now_micros());
        let _ = organizations::add(org, org, OrganizationType::Custom).await;
        users::add(users::UserRecord {
            email: email.clone(),
            first_name: String::new(),
            last_name: String::new(),
            password: String::new(),
            salt: String::new(),
            is_root: false,
            password_ext: None,
            user_type: config::meta::user::UserType::Internal,
            created_at: 0,
            updated_at: 0,
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: None,
        })
        .await
        .unwrap();
        org_users::add(org, &email, UserRole::User, "", None)
            .await
            .unwrap();
        users::get_id_by_email(&email).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn me_writes_touch_only_the_callers_row_and_need_a_membership() {
        if !meta_store().await {
            return;
        }
        let org = unique_org("memory_me");
        let (me, them) = (member(&org, "me").await, member(&org, "them").await);
        let (mine, theirs) = (MemoryKey::user(&org, &me), MemoryKey::user(&org, &them));
        let caller = |id: &str| Caller {
            author: Author::User(id.to_string()),
            is_memory_admin: false,
        };
        let resp = write_memory(&theirs, None, text("theirs", 0), caller(&them)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = write_memory(&mine, None, text("mine", 0), caller(&me)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        memory_db::delete(&mine).await.unwrap();
        assert!(memory_db::get(&mine).await.unwrap().is_none());
        let kept = memory_db::get(&theirs).await.unwrap().unwrap();
        assert_eq!((kept.rev, kept.content.as_str()), (1, "theirs"));
        let outsider = MemoryKey::user(&unique_org("memory_other"), &me);
        let resp = write_memory(&outsider, None, text("x", 0), caller(&me)).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    async fn add_mcp_toolset(org: &str, name: &str) -> String {
        use infra::table::org_ai_toolsets::OrgToolset;
        use svix_ksuid::{Ksuid, KsuidLike};
        let id = Ksuid::new(None, None).to_string();
        let toolset = OrgToolset {
            id: id.clone(),
            org: org.to_string(),
            name: name.to_string(),
            kind: "mcp".to_string(),
            description: None,
            data: Some(r#"{"url":"https://mcp.example.com/mcp"}"#.to_string()),
            created_by: "u".to_string(),
            created_at: 1,
            updated_at: 1,
            region_only: false,
            origin_region: None,
        };
        infra::table::org_ai_toolsets::add(toolset).await.unwrap();
        id
    }

    #[tokio::test]
    async fn deleting_a_toolset_deletes_its_memory_and_later_writes_to_it_fail() {
        if !meta_store().await {
            return;
        }
        let org = unique_org("toolset_memory");
        let id = add_mcp_toolset(&org, "datadog-prod").await;
        let key = toolset_key(&org, &id).await.unwrap();
        assert_eq!(key, MemoryKey::toolset(&org, "datadog-prod"));
        let resp = write_memory(&key, Some(&id), text("## Quirks\n", 0), person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = super::super::toolsets::delete(Path((org.clone(), id.clone()))).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(memory_db::get(&key).await.unwrap().is_none());
        // A write that resolved the toolset before the delete must not bring the memory back.
        let resp = write_memory(&key, Some(&id), text("## Late\n", 0), person(true)).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let settings = MemoryUpdateRequest {
            max_bytes: Some(8 * 1024),
            ..Default::default()
        };
        let resp = write_memory(&key, Some(&id), settings, person(true)).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            revert(&key, Some(&id), 1, person(true)).await.status(),
            StatusCode::NOT_FOUND
        );
        assert!(memory_db::get(&key).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn legacy_toolsets_sharing_a_normalized_name_never_share_a_memory() {
        if !meta_store().await {
            return;
        }
        let org = unique_org("toolset_clash");
        let spaced = add_mcp_toolset(&org, "Datadog Prod").await;
        let dashed = add_mcp_toolset(&org, "datadog-prod").await;
        for id in [&spaced, &dashed] {
            let resp = toolset_key(&org, id).await.unwrap_err();
            assert_eq!(resp.status(), StatusCode::CONFLICT);
        }
        // A memory written before the clash stays while either toolset still owns the name.
        let key = MemoryKey::toolset(&org, "datadog-prod");
        write_memory(&key, None, text("## Quirks\n", 0), person(true)).await;
        let resp = super::super::toolsets::delete(Path((org.clone(), spaced))).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(memory_db::get(&key).await.unwrap().is_some());
        assert_eq!(toolset_key(&org, &dashed).await.unwrap(), key);
        let resp = super::super::toolsets::delete(Path((org.clone(), dashed))).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(memory_db::get(&key).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_refused_combined_put_changes_neither_text_nor_settings() {
        if !meta_store().await {
            return;
        }
        let key = MemoryKey::org(&unique_org("memory_combined"));
        let resp = write_memory(&key, None, text("## Notes\n", 0), person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let stale = MemoryUpdateRequest {
            agent_memory_writes: Some(WritesSetting::Auto),
            ..text("## Stale\n", 0)
        };
        let resp = write_memory(&key, None, stale, person(true)).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let too_big = MemoryUpdateRequest {
            agent_memory_writes: Some(WritesSetting::Auto),
            max_bytes: Some(32 * 1024),
            ..text(&"x".repeat(40 * 1024), 1)
        };
        let resp = write_memory(&key, None, too_big, person(true)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let read = memory_body(&key, true).await.unwrap();
        assert_eq!((read.rev, read.content.as_str()), (1, "## Notes\n"));
        assert_eq!(read.agent_memory_writes, None);
        assert_eq!(
            read.max_bytes,
            config::meta::ai::memory::ORG_DEFAULT_MAX_BYTES
        );
        // The cap a PUT raises applies to the text in that same PUT.
        let fits = MemoryUpdateRequest {
            max_bytes: Some(32 * 1024),
            ..text(&"x".repeat(20 * 1024), 1)
        };
        let resp = write_memory(&key, None, fits, person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let read = memory_body(&key, true).await.unwrap();
        assert_eq!((read.rev, read.max_bytes), (2, 32 * 1024));
    }

    #[tokio::test]
    async fn a_revision_under_another_memory_is_not_found() {
        if !meta_store().await {
            return;
        }
        let org = unique_org("memory_wrong");
        let toolset = MemoryKey::toolset(&org, "datadog");
        write_memory(&toolset, None, text("t", 0), person(true)).await;
        write_memory(&MemoryKey::org(&org), None, text("o", 0), person(true)).await;
        let memory = memory_db::get(&toolset).await.unwrap().unwrap();
        let revision = memory_db::list_revisions(&org, &memory.id).await.unwrap();
        let id = &revision[0].id;
        assert_eq!(get_revision(&toolset, id).await.status(), StatusCode::OK);
        for resp in [
            get_revision(&MemoryKey::org(&org), id).await,
            decide(&MemoryKey::org(&org), id, Decision::Accept, true).await,
            decide(&MemoryKey::org(&org), id, Decision::Discard, true).await,
        ] {
            assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        }
    }

    /// A chat of a new member with one running turn; `(org, session, turn, user_id)`.
    async fn running_turn(agent_type: &str) -> (String, String, String, String) {
        use infra::table::{ai_chat_sessions, ai_chat_turns};
        let org = unique_org("memory_agent");
        let user_id = member(&org, "agent-user").await;
        let session = config::ider::uuid();
        let turn = config::ider::uuid();
        let now = config::utils::time::now_micros();
        ai_chat_sessions::get_or_create(&org, &session, &user_id, "u@example.com", agent_type, now)
            .await
            .unwrap();
        ai_chat_turns::admit(&org, &session, &turn, 0, now)
            .await
            .unwrap();
        (org, session, turn, user_id)
    }

    fn agent_write(
        (org, session, turn): (&str, &str, &str),
        scope: MemoryScope,
        toolset: Option<&str>,
        base_rev: i64,
        edits: Vec<MemoryEdit>,
    ) -> InternalWriteRequest {
        InternalWriteRequest {
            org_id: org.to_string(),
            session_id: session.to_string(),
            turn_id: turn.to_string(),
            scope,
            toolset: toolset.map(str::to_string),
            base_rev,
            edits,
            evidence: vec![Evidence {
                turn_id: None,
                call_ref: "user".to_string(),
                tool: None,
            }],
            reason: Some("seen in a result".to_string()),
        }
    }

    fn add(text: &str) -> Vec<MemoryEdit> {
        vec![MemoryEdit::Add {
            section: "Quirks".to_string(),
            text: text.to_string(),
        }]
    }

    async fn set_writes(key: &MemoryKey, writes: AgentMemoryWrites) {
        let settings = MemorySettings {
            agent_memory_writes: Some(writes),
            ..Default::default()
        };
        memory_db::set_settings(key, None, &settings).await.unwrap();
    }

    #[test]
    fn the_internal_route_wants_the_configured_secret() {
        let unset = secret_refusal(None).unwrap();
        assert_eq!(unset.status(), StatusCode::SERVICE_UNAVAILABLE);
        let wrong = secret_refusal(Some(false)).unwrap();
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
        assert!(secret_refusal(Some(true)).is_none());
    }

    #[tokio::test]
    async fn without_a_secret_on_openobserve_the_internal_route_is_closed() {
        let resp = internal_write(axum::http::HeaderMap::new(), axum::body::Bytes::new()).await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn an_agent_edit_follows_the_memory_setting_and_a_toolset_overrides_the_org() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let (status, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, add("- a"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(reply["status"], "pending", "{reply}");

        set_writes(&MemoryKey::org(&org), AgentMemoryWrites::Auto).await;
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, add("- a"))).await;
        assert_eq!(
            (reply["status"].clone(), reply["rev"].clone()),
            (json!("applied"), json!(1))
        );
        let memory = memory_db::get(&MemoryKey::org(&org))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(memory.updated_by, format!("agent:{session}/{turn}"));
        let revisions = memory_db::list_revisions(&org, &memory.id).await.unwrap();
        let evidence = revisions[0].evidence.clone().unwrap();
        assert_eq!(evidence[0].turn_id.as_deref(), Some(turn.as_str()));

        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 1, add("- a"))).await;
        assert_eq!(reply["status"], "applied", "{reply}");
        assert_eq!(reply["rev"], 2);
        let same = vec![MemoryEdit::Replace {
            old: "- a".to_string(),
            new: "- a".to_string(),
        }];
        let (_, reply) = write_for_turn(agent_write(
            ids,
            MemoryScope::Org,
            None,
            2,
            vec![MemoryEdit::Remove {
                old: "- a\n- a".to_string(),
            }],
        ))
        .await;
        assert_eq!(reply["rev"], 3, "{reply}");
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 3, same)).await;
        assert_eq!(reply["code"], "edit_no_match", "{reply}");
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 1, add("- b"))).await;
        assert_eq!(reply["code"], "rev_conflict", "{reply}");
        assert_eq!(reply["rev"], 3);
        assert_eq!(reply["content"], "## Quirks\n\n");

        set_writes(&MemoryKey::org(&org), AgentMemoryWrites::Off).await;
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 3, add("- c"))).await;
        assert_eq!(reply["code"], "writes_off", "{reply}");

        add_mcp_toolset(&org, "datadog-prod").await;
        let toolset = MemoryKey::toolset(&org, "datadog-prod");
        let write = || {
            agent_write(
                ids,
                MemoryScope::Toolset,
                Some("datadog-prod"),
                0,
                add("- t"),
            )
        };
        let (_, reply) = write_for_turn(write()).await;
        assert_eq!(reply["code"], "writes_off", "{reply}");
        set_writes(&toolset, AgentMemoryWrites::Auto).await;
        let (_, reply) = write_for_turn(write()).await;
        assert_eq!(reply["status"], "applied", "{reply}");
        let unknown = agent_write(ids, MemoryScope::Toolset, Some("nope"), 0, add("- t"));
        let (_, reply) = write_for_turn(unknown).await;
        assert_eq!(reply["code"], "unknown_toolset", "{reply}");
    }

    #[tokio::test]
    async fn an_identical_edit_is_no_change() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        set_writes(&MemoryKey::org(&org), AgentMemoryWrites::Auto).await;
        write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, add("- a"))).await;
        let same = vec![MemoryEdit::Replace {
            old: "- a".to_string(),
            new: "- a".to_string(),
        }];
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 1, same)).await;
        assert_eq!(
            reply,
            json!({"status": "applied", "rev": 1, "no_change": true})
        );
    }

    #[tokio::test]
    async fn only_the_running_turn_of_the_named_chat_may_write() {
        use infra::table::{ai_chat_sessions, ai_chat_turns};
        if !meta_store().await {
            return;
        }
        let forbidden = |status: StatusCode, reply: &Value| {
            assert_eq!(status, StatusCode::FORBIDDEN, "{reply}");
            assert_eq!(reply["code"], "turn_not_running");
        };
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let elsewhere = agent_write(
            ("other_org", &session, &turn),
            MemoryScope::Org,
            None,
            0,
            add("- a"),
        );
        let (status, reply) = write_for_turn(elsewhere).await;
        forbidden(status, &reply);

        let second = config::ider::uuid();
        let now = config::utils::time::now_micros();
        ai_chat_turns::admit(&org, &session, &second, 0, now)
            .await
            .unwrap();
        let (status, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, add("- a"))).await;
        forbidden(status, &reply);
        let current = (org.as_str(), session.as_str(), second.as_str());
        let (status, ..) =
            write_for_turn(agent_write(current, MemoryScope::Org, None, 0, add("- a"))).await;
        assert_eq!(status, StatusCode::OK);

        ai_chat_turns::finish(
            &org,
            &session,
            &second,
            ai_chat_turns::TURN_COMPLETED,
            None,
            None,
            None,
            now,
        )
        .await
        .unwrap();
        let (status, reply) =
            write_for_turn(agent_write(current, MemoryScope::Org, None, 0, add("- a"))).await;
        forbidden(status, &reply);

        let stale_session = config::ider::uuid();
        let stale_turn = config::ider::uuid();
        ai_chat_sessions::get_or_create(&org, &stale_session, "u1", "u@example.com", "o2-ai", 1)
            .await
            .unwrap();
        ai_chat_turns::admit(&org, &stale_session, &stale_turn, 0, 1)
            .await
            .unwrap();
        let stale = (org.as_str(), stale_session.as_str(), stale_turn.as_str());
        let (status, reply) =
            write_for_turn(agent_write(stale, MemoryScope::Org, None, 0, add("- a"))).await;
        forbidden(status, &reply);
    }

    #[tokio::test]
    async fn rca_turns_write_shared_memory_but_never_a_users() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) =
            running_turn(o2_enterprise::enterprise::ai::client::RCA_AGENT_TYPE).await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, add("- a"))).await;
        assert_eq!(reply["status"], "pending", "{reply}");
        add_mcp_toolset(&org, "datadog-prod").await;
        let toolset = agent_write(
            ids,
            MemoryScope::Toolset,
            Some("datadog-prod"),
            0,
            add("- t"),
        );
        let (_, reply) = write_for_turn(toolset).await;
        assert_eq!(reply["status"], "pending", "{reply}");
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::User, None, 0, add("- u"))).await;
        assert_eq!(reply["code"], "user_scope_not_allowed", "{reply}");
    }

    #[tokio::test]
    async fn a_chat_turn_writes_its_users_memory_unless_the_user_turned_it_off() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, user_id) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::User, None, 0, add("- p99"))).await;
        assert_eq!(reply["status"], "applied", "{reply}");
        let mine = memory_db::get(&MemoryKey::user(&org, &user_id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(mine.content, "## Quirks\n- p99\n");
        set_writes(&MemoryKey::user(&org, &user_id), AgentMemoryWrites::Off).await;
        let (_, reply) =
            write_for_turn(agent_write(ids, MemoryScope::User, None, 1, add("- more"))).await;
        assert_eq!(reply["code"], "writes_off", "{reply}");
    }

    #[test]
    fn each_internal_write_is_audited_with_its_outcome() {
        let body = br#"{"org_id":"o1","turn_id":"t1"}"#;
        let ok = internal_audit_message(
            body,
            StatusCode::OK,
            &json!({"status": "applied", "rev": 2}),
        );
        assert_eq!(ok.org_id, "o1");
        assert_eq!(ok.user_email, "o2-ai");
        assert_eq!(ok.response_meta.http_path, "/internal/ai/memory");
        assert_eq!(ok.response_meta.http_response_code, 200);
        assert!(ok.response_meta.error_msg.is_none());
        let refused = internal_audit_message(
            body,
            StatusCode::FORBIDDEN,
            &json!({"code": "turn_not_running"}),
        );
        assert_eq!(
            refused.response_meta.error_msg.as_deref(),
            Some("turn_not_running")
        );
    }

    #[tokio::test]
    async fn a_turn_gets_its_memory_writable_only_when_it_can_write() {
        use o2_enterprise::enterprise::ai::toolsets::{McpEntry, push::load_turn_memory};
        if !meta_store().await {
            return;
        }
        let org = unique_org("memory_delivery");
        let user_id = member(&org, "reader").await;
        add_mcp_toolset(&org, "datadog-prod").await;
        write_memory(
            &MemoryKey::org(&org),
            None,
            text("org notes", 0),
            person(true),
        )
        .await;
        let mine = Caller {
            author: Author::User(user_id.clone()),
            is_memory_admin: false,
        };
        write_memory(&MemoryKey::user(&org, &user_id), None, text("p99", 0), mine).await;
        let mcps = || {
            [McpEntry {
                name: "datadog-prod".to_string(),
                ..Default::default()
            }]
        };

        let mut chat = mcps();
        let got = load_turn_memory(&org, Some(&user_id), false, true, &mut chat).await;
        let org_block = got.org.unwrap();
        assert_eq!(
            (org_block.content.as_str(), org_block.rev),
            ("org notes", 1)
        );
        assert!(org_block.writable && org_block.op_id.is_some());
        let user_block = got.user.unwrap();
        assert_eq!(
            (user_block.content.as_str(), user_block.writable),
            ("p99", true)
        );
        let tool = chat[0].memory.clone().unwrap();
        assert_eq!(
            (tool.content.as_str(), tool.rev, tool.writable),
            ("", 0, true)
        );

        for (read_only, persisted) in [(true, true), (false, false)] {
            let mut slack = mcps();
            let got =
                load_turn_memory(&org, Some(&user_id), read_only, persisted, &mut slack).await;
            assert!(!got.org.unwrap().writable && !got.user.unwrap().writable);
            assert!(!slack[0].memory.clone().unwrap().writable);
        }

        let mut rca = mcps();
        let got = load_turn_memory(&org, None, false, true, &mut rca).await;
        assert!(got.user.is_none());
        assert_eq!(got.org.unwrap().content, "org notes");
    }

    #[tokio::test]
    async fn a_review_mode_edit_over_the_cap_is_refused_not_queued() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let big = add(&"x".repeat(config::meta::ai::memory::ORG_DEFAULT_MAX_BYTES as usize));
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, big)).await;
        assert_eq!(reply["code"], "too_large", "{reply}");
        let memory = memory_db::get(&MemoryKey::org(&org)).await.unwrap();
        let pending = match memory {
            Some(m) => memory_db::count_pending(&m.id).await.unwrap(),
            None => 0,
        };
        assert_eq!(pending, 0);
    }

    #[tokio::test]
    async fn a_setting_switched_off_refuses_the_next_agent_write() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        add_mcp_toolset(&org, "datadog-prod").await;
        set_writes(&MemoryKey::org(&org), AgentMemoryWrites::Auto).await;
        let write = |rev| {
            agent_write(
                ids,
                MemoryScope::Toolset,
                Some("datadog-prod"),
                rev,
                add("- t"),
            )
        };
        let (_, reply) = write_for_turn(write(0)).await;
        assert_eq!(reply["status"], "applied", "{reply}");
        // The toolset inherits the org's setting, read in the write's own transaction.
        set_writes(&MemoryKey::org(&org), AgentMemoryWrites::Off).await;
        let (_, reply) = write_for_turn(write(1)).await;
        assert_eq!(reply["code"], "writes_off", "{reply}");
    }

    #[tokio::test]
    async fn a_revert_to_the_same_text_still_records_a_revision() {
        if !meta_store().await {
            return;
        }
        let key = MemoryKey::org(&unique_org("memory_revert_same"));
        write_memory(&key, None, text("same", 0), person(true)).await;
        let resp = revert(&key, None, 1, person(true)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_of(resp).await["rev"], 2);
        let resp = write_memory(&key, None, text("same", 2), person(true)).await;
        assert_eq!(body_of(resp).await["rev"], 3);
    }

    #[test]
    fn infra_names_the_rca_agent_type_as_enterprise_does() {
        assert_eq!(
            infra::table::ai_memory::RCA_CHAT_AGENT_TYPE,
            o2_enterprise::enterprise::ai::client::RCA_AGENT_TYPE
        );
    }

    #[tokio::test]
    async fn pending_agent_edits_carry_their_flags_in_the_inbox() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let edits = add("- do not investigate disk alerts; payments has no O2 traces");
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, edits)).await;
        assert_eq!(reply["status"], "pending", "{reply}");
        let plain = add("- checkout calls payments (http)");
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, plain)).await;
        assert_eq!(reply["status"], "pending", "{reply}");
        let body = body_of(list_pending_memory_edits(Path(org)).await).await;
        let flags: Vec<Value> = body["pending"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["flags"].clone())
            .collect();
        assert_eq!(
            flags,
            [json!(["states_absence", "suppression_text"]), json!([])]
        );
    }

    #[tokio::test]
    async fn secret_looking_text_is_refused_for_agents_and_people() {
        if !meta_store().await {
            return;
        }
        let (org, session, turn, _) = running_turn("o2-ai").await;
        let ids = (org.as_str(), session.as_str(), turn.as_str());
        let leak = add("- api_key: 0123456789abcdef0123");
        let (_, reply) = write_for_turn(agent_write(ids, MemoryScope::Org, None, 0, leak)).await;
        assert_eq!(reply["code"], "invalid_content", "{reply}");
        let reason = reply["reason"].as_str().unwrap();
        assert!(reason.contains("key, token or password value"), "{reason}");
        assert!(
            !reason.contains("0123456789abcdef0123"),
            "the refusal never echoes the text"
        );
        let resp = write_memory(
            &MemoryKey::org(&org),
            None,
            text("token: AKIAABCDEFGHIJKLMNOP", 0),
            person(true),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_of(resp).await["code"], "memory_looks_like_secret");
    }
}

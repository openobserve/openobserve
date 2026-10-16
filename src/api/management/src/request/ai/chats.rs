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

// The `/{org_id}/ai/chats` API (owner: `users.id`) and the responses of turn admission.

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use infra::table::{
    ai_chat_sessions::{self, ListCursor, Model, NO_SEQ, STATUS_ACTIVE},
    ai_chat_turns::{self, Model as TurnRecord, TURN_FAILED, TURN_INTERRUPTED, TURN_RUNNING},
};
use o2_enterprise::enterprise::{
    ai::{
        chat::registry::{self, CancelReason},
        client::get_agent_client,
    },
    common::config::get_config as get_o2_config,
};
use openobserve_core::ai_chat::admission::{
    AdmitError, TURN_LIMIT, is_uuid, normalize_uuid, resolve_owner,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Browser-generated UUID of one turn, so a retried request does not run the model twice.
pub const X_O2_ASSISTANT_TURN_ID: &str = "x-o2-assistant-turn-id";

pub(super) const MAX_TITLE_CHARS: usize = 200;
const DEFAULT_PAGE: u64 = 50;
const MAX_PAGE: u64 = 200;
const MAX_TURNS_PAGE: usize = 1000;
/// A turn still marked running this long past the longest allowed turn died with its node.
const RUNNING_GRACE_SECS: i64 = 60;
const MICROS_PER_SEC: i64 = 1_000_000;
const TURN_ALREADY_RUNNING: &str = "turn_already_running";

/// One chat in the user's list.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatSummary {
    pub session_id: String,
    pub title: String,
    pub agent_type: String,
    /// Microseconds since the epoch.
    pub created_at: i64,
    pub updated_at: i64,
    /// Highest durably stored event sequence (-1: nothing yet).
    pub last_committed_seq: i64,
    /// Set on a chat forked from a share: the share's id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forked_from_share: Option<String>,
}

impl From<Model> for ChatSummary {
    fn from(row: Model) -> Self {
        Self {
            session_id: row.session_id,
            title: row.title,
            agent_type: row.agent_type,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_committed_seq: row.last_committed_seq,
            forked_from_share: row.forked_from_share,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChatListResponse {
    pub chats: Vec<ChatSummary>,
    /// Pass back as `cursor` for the next page; absent on the last page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub limit: Option<u64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetParams {
    /// The `last_committed_seq` of the caller's cached copy.
    pub known_seq: Option<i64>,
    /// The `state_version` of the caller's cached copy.
    pub known_version: Option<String>,
    /// At most this many turns, the newest.
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChatDetailResponse {
    #[serde(flatten)]
    pub chat: ChatSummary,
    /// Changes whenever the committed seq, a turn's status or error, or `active_turn` changes.
    pub state_version: String,
    /// True when `known_seq` and `known_version` are current; `turns` is then omitted.
    pub not_modified: bool,
    /// A turn of this chat is running right now.
    pub active_turn: bool,
    /// Set when `turns` holds the turns past this seq plus older ones whose status changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_from_seq: Option<i64>,
    /// Older turns were left out to honour `limit`.
    pub has_more: bool,
    /// Per turn: the user's words, the UI frames, and `turn_id`/`status`/`error_code` if recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub turns: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameRequest {
    pub title: String,
}

/// The turns a detail read returns (see [`build_history`]).
#[derive(Debug, Default, PartialEq)]
struct History {
    turns: Vec<Value>,
    partial_from_seq: Option<i64>,
    has_more: bool,
}

/// How [`build_history`] cuts a chat's turns.
#[derive(Debug, Default, Clone, Copy)]
struct Cut {
    /// The committed seq the history ends at.
    cutoff: i64,
    /// Only turns past this seq, or whose record changed after `changed_since`.
    known_seq: Option<i64>,
    changed_since: Option<i64>,
    /// Turns admitted later than this (a snapshot's time) are left out.
    admitted_by: Option<i64>,
    limit: Option<usize>,
}

/// What a client's `state_version` says about its copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StateVersion {
    seq: i64,
    changed_at: i64,
    active: bool,
}

impl StateVersion {
    fn of(row: &Model, records: &[TurnRecord], active: bool) -> Self {
        let changed_at = records
            .iter()
            .map(|r| r.started_at.max(r.ended_at.unwrap_or(0)))
            .max()
            .unwrap_or(0);
        Self {
            seq: row.last_committed_seq,
            changed_at,
            active,
        }
    }

    fn parse(text: &str) -> Option<Self> {
        let mut parts = text.split('.');
        let seq = parts.next()?.parse().ok()?;
        let changed_at = parts.next()?.parse().ok()?;
        let active = match parts.next()? {
            "1" => true,
            "0" => false,
            _ => return None,
        };
        parts.next().is_none().then_some(Self {
            seq,
            changed_at,
            active,
        })
    }
}

impl std::fmt::Display for StateVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}.{}.{}",
            self.seq,
            self.changed_at,
            u8::from(self.active)
        )
    }
}

/// Started-at bound (micros) below which a turn marked running is treated as dead.
pub(super) fn running_since(now: i64) -> i64 {
    let max_turn = get_o2_config().ai.chat_max_turn_secs.max(60) as i64;
    now - (max_turn + RUNNING_GRACE_SECS) * MICROS_PER_SEC
}

/// The response each admission refusal gets.
pub(super) fn admit_error_response(error: AdmitError) -> Response {
    match error {
        AdmitError::InvalidSession(message) => MetaHttpResponse::bad_request(message),
        AdmitError::NotRegistered => {
            MetaHttpResponse::forbidden("Chat history is only available to registered users")
        }
        AdmitError::NotFound(message) => MetaHttpResponse::not_found(message),
        AdmitError::Busy => lease_conflict_response(),
        AdmitError::TurnLimit(scope) => turn_limit_response(scope),
        AdmitError::AlreadySubmitted => MetaHttpResponse::conflict(
            "This turn was already submitted; reload the conversation to see its result",
        ),
        AdmitError::Unavailable(message) => MetaHttpResponse::service_unavailable(message),
    }
}

/// The caller's own active chat, or a 404 that does not reveal whether it exists for another.
pub(super) async fn owned_chat(
    org_id: &str,
    session_id: &str,
    owner: &str,
) -> Result<Model, Response> {
    let Some(session_id) = normalize_uuid(session_id) else {
        return Err(MetaHttpResponse::bad_request("Invalid session id"));
    };
    match ai_chat_sessions::get(org_id, &session_id).await {
        Ok(Some(row)) if row.user_id == owner && row.status == STATUS_ACTIVE => Ok(row),
        Ok(_) => Err(MetaHttpResponse::not_found("Unknown conversation")),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read chat {org_id}/{session_id}: {e}");
            Err(MetaHttpResponse::service_unavailable(
                "Chat history is unavailable; please retry",
            ))
        }
    }
}

/// A chat's projected turns through `row.last_committed_seq` (lower it to cut the history).
pub(super) async fn load_turns(
    row: &Model,
    _auth: Option<&str>,
) -> Result<Vec<serde_json::Value>, Response> {
    let events = match openobserve_core::ai_chat::read_committed_events(row, -1).await {
        Ok(events) => events,
        // Logged and counted by the reader; a partial chat is never presented as whole.
        Err(_) => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "code": StatusCode::SERVICE_UNAVAILABLE.as_u16(),
                    "message": "This conversation's history could not be read in full; please retry",
                    "error_code": "history_unavailable",
                })),
            )
                .into_response());
        }
    };

    let mut projected = openobserve_core::ai_chat::projection::project(&events);
    match projected.get_mut("turns").map(serde_json::Value::take) {
        Some(serde_json::Value::Array(turns)) => Ok(turns),
        _ => Ok(Vec::new()),
    }
}

/// Projected `turns` with their turn records; turns admitted after `admitted_by` are left out.
pub(super) async fn attach_turn_status_at(
    row: &Model,
    turns: Vec<Value>,
    admitted_by: Option<i64>,
) -> Vec<Value> {
    let records = turn_records(row).await;
    let now = config::utils::time::now_micros();
    let cut = Cut {
        cutoff: row.last_committed_seq,
        admitted_by,
        ..Default::default()
    };
    build_history(turns, &records, running_since(now), cut).turns
}

pub(super) fn user_email(req: &axum::extract::Request) -> Option<String> {
    req.headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// ListAiChats
#[utoipa::path(
    get,
    path = "/{org_id}/ai/chats",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiChats",
    summary = "List the caller's AI conversations",
    description = "The caller's own stored AI conversations in this organization, most \
                   recently active first, keyset-paginated.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("limit" = Option<u64>, Query, description = "Page size (default 50, max 200)"),
        ("cursor" = Option<String>, Query, description = "`next_cursor` of the previous page"),
    ),
    responses(
        (status = 200, description = "A page of conversations", body = inline(ChatListResponse)),
        (status = 400, description = "Invalid cursor", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list(
    Path(org_id): Path<String>,
    Query(params): Query<ListParams>,
    in_req: axum::extract::Request,
) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return MetaHttpResponse::unauthorized("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return MetaHttpResponse::not_found("Chat history is not enabled");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let cursor = match params.cursor.as_deref().map(decode_cursor) {
        Some(None) => return MetaHttpResponse::bad_request("Invalid cursor"),
        Some(Some(c)) => Some(c),
        None => None,
    };
    let limit = params.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let running_since = running_since(config::utils::time::now_micros());
    // One extra row tells whether there is a next page.
    let mut rows = match ai_chat_sessions::list_for_user(
        &org_id,
        &owner,
        cursor.as_ref(),
        limit + 1,
        running_since,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[AI-CHAT] cannot list chats of {org_id}/{owner}: {e}");
            return MetaHttpResponse::service_unavailable(
                "Chat history is unavailable; please retry",
            );
        }
    };
    let next_cursor = if rows.len() as u64 > limit {
        rows.truncate(limit as usize);
        rows.last().map(encode_cursor)
    } else {
        None
    };
    Json(ChatListResponse {
        chats: rows.into_iter().map(ChatSummary::from).collect(),
        next_cursor,
    })
    .into_response()
}

/// GetAiChat
#[utoipa::path(
    get,
    path = "/{org_id}/ai/chats/{session_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiChat",
    summary = "Get one AI conversation",
    description = "The caller's stored conversation, reconstructed from its durable event \
                   history. With `known_seq` and `known_version` equal to the stored ones the \
                   body says `not_modified` and carries no turns. With an older `known_seq` only \
                   the turns past it come back, plus earlier turns whose status changed since \
                   `known_version`; with the same seq but another version, every turn does.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
        ("known_seq" = Option<i64>, Query, description = "Sequence of the caller's cached copy"),
        ("known_version" = Option<String>, Query, description = "`state_version` of the caller's cached copy"),
        ("limit" = Option<usize>, Query, description = "At most this many turns, the newest"),
    ),
    responses(
        (status = 200, description = "The conversation", body = inline(ChatDetailResponse)),
        (status = 404, description = "Unknown conversation", body = Object),
        (status = 503, description = "History temporarily unreadable", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get(
    Path((org_id, session_id)): Path<(String, String)>,
    Query(params): Query<GetParams>,
    in_req: axum::extract::Request,
) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return MetaHttpResponse::unauthorized("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return MetaHttpResponse::not_found("Chat history is not enabled");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let row = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(row) => row,
        Err(resp) => return resp,
    };
    let now = config::utils::time::now_micros();
    let records = turn_records(&row).await;
    let active_turn = records
        .iter()
        .any(|r| ai_chat_turns::is_running(r, running_since(now)));
    let version = StateVersion::of(&row, &records, active_turn);
    let known = params
        .known_version
        .as_deref()
        .and_then(StateVersion::parse);
    if params.known_seq == Some(row.last_committed_seq) && known == Some(version) {
        return Json(ChatDetailResponse {
            chat: row.into(),
            state_version: version.to_string(),
            not_modified: true,
            active_turn,
            partial_from_seq: None,
            has_more: false,
            turns: None,
        })
        .into_response();
    }

    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    let turns = match load_turns(&row, Some(&auth)).await {
        Ok(turns) => turns,
        Err(resp) => return resp,
    };
    // Incremental only from a copy older than the watermark whose version we can read.
    let known_seq = params
        .known_seq
        .filter(|n| (NO_SEQ..row.last_committed_seq).contains(n))
        .filter(|_| known.is_some());
    let cut = Cut {
        cutoff: row.last_committed_seq,
        known_seq,
        changed_since: known.map(|k| k.changed_at),
        admitted_by: None,
        limit: params.limit.map(|l| l.clamp(1, MAX_TURNS_PAGE)),
    };
    let history = build_history(turns, &records, running_since(now), cut);
    Json(ChatDetailResponse {
        chat: row.into(),
        state_version: version.to_string(),
        not_modified: false,
        active_turn,
        partial_from_seq: history.partial_from_seq,
        has_more: history.has_more,
        turns: Some(history.turns),
    })
    .into_response()
}

/// RenameAiChat
#[utoipa::path(
    patch,
    path = "/{org_id}/ai/chats/{session_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "RenameAiChat",
    summary = "Rename an AI conversation",
    description = "Sets the title of the caller's conversation. A title set here is never \
                   replaced by the automatically generated one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
    ),
    request_body(content = inline(RenameRequest), content_type = "application/json"),
    responses(
        (status = 200, description = "Renamed", body = Object),
        (status = 400, description = "Invalid title", body = Object),
        (status = 404, description = "Unknown conversation", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn rename(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return MetaHttpResponse::unauthorized("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return MetaHttpResponse::not_found("Chat history is not enabled");
    }
    let body = match axum::body::to_bytes(in_req.into_body(), 16 * 1024).await {
        Ok(b) => b,
        Err(_) => return MetaHttpResponse::bad_request("Request body too large"),
    };
    let Ok(RenameRequest { title }) = serde_json::from_slice::<RenameRequest>(&body) else {
        return MetaHttpResponse::bad_request("Expected {\"title\": string}");
    };
    let title = title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return MetaHttpResponse::bad_request(format!(
            "The title must be 1 to {MAX_TITLE_CHARS} characters"
        ));
    }
    let Some(session_id) = normalize_uuid(&session_id) else {
        return MetaHttpResponse::bad_request("Invalid session id");
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    match ai_chat_sessions::rename(&org_id, &session_id, &owner, title).await {
        Ok(true) => MetaHttpResponse::json(serde_json::json!({"title": title})),
        Ok(false) => MetaHttpResponse::not_found("Unknown conversation"),
        Err(e) => {
            log::error!("[AI-CHAT] cannot rename {org_id}/{session_id}: {e}");
            MetaHttpResponse::service_unavailable("Chat history is unavailable; please retry")
        }
    }
}

/// DeleteAiChat
#[utoipa::path(
    delete,
    path = "/{org_id}/ai/chats/{session_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "DeleteAiChat",
    summary = "Delete an AI conversation",
    description = "Deletes the caller's conversation: it disappears from every list and read \
                   at once. Its stored events are physically removed by the chat stream's \
                   retention.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
    ),
    responses(
        (status = 200, description = "Deleted", body = Object),
        (status = 404, description = "Unknown conversation", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return MetaHttpResponse::unauthorized("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return MetaHttpResponse::not_found("Chat history is not enabled");
    }
    let Some(session_id) = normalize_uuid(&session_id) else {
        return MetaHttpResponse::bad_request("Invalid session id");
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    // Owner checked first: stopping the running turn must not be open to anyone else.
    if let Err(resp) = owned_chat(&org_id, &session_id, &owner).await {
        return resp;
    }
    registry::cancel(&org_id, &session_id, CancelReason::Deleted);
    let now = config::utils::time::now_micros();
    match ai_chat_sessions::mark_deleted(&org_id, &session_id, &owner, now).await {
        Ok(true) => {}
        Ok(false) => return MetaHttpResponse::not_found("Unknown conversation"),
        Err(e) => {
            log::error!("[AI-CHAT] cannot delete {org_id}/{session_id}: {e}");
            return MetaHttpResponse::service_unavailable(
                "Chat history is unavailable; please retry",
            );
        }
    }
    super::shares::revoke_for_deleted(&org_id, std::slice::from_ref(&session_id), now).await;
    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    tokio::spawn(purge_replicas(org_id, vec![session_id], auth));
    MetaHttpResponse::json(serde_json::json!({"deleted": true}))
}

/// DeleteAllAiChats
#[utoipa::path(
    delete,
    path = "/{org_id}/ai/chats",
    context_path = "/api",
    tag = "AI",
    operation_id = "DeleteAllAiChats",
    summary = "Delete all of the caller's AI conversations",
    description = "Deletes every conversation the caller owns in this organization, at once \
                   for every read. Stored events are physically removed by retention.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Deleted", body = Object)),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete_all(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return MetaHttpResponse::unauthorized("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return MetaHttpResponse::not_found("Chat history is not enabled");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let session_ids = match openobserve_core::ai_chat::delete_all_for_user(&org_id, &owner).await {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("[AI-CHAT] cannot clear chats of {org_id}/{owner}: {e}");
            return MetaHttpResponse::service_unavailable(
                "Chat history is unavailable; please retry",
            );
        }
    };
    let deleted = session_ids.len();
    if !session_ids.is_empty() {
        let (parts, _) = in_req.into_parts();
        let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        tokio::spawn(purge_replicas(org_id, session_ids, auth));
    }
    MetaHttpResponse::json(serde_json::json!({ "deleted": deleted }))
}

fn encode_cursor(row: &Model) -> String {
    format!("{}_{}", row.updated_at, row.session_id)
}

fn decode_cursor(cursor: &str) -> Option<ListCursor> {
    let (updated_at, session_id) = cursor.split_once('_')?;
    Some(ListCursor {
        updated_at: updated_at.parse().ok()?,
        session_id: session_id.to_string(),
    })
    .filter(|c| is_uuid(&c.session_id))
}

/// Best effort; copies not confirmed gone are retried by the retention sweep until they are.
async fn purge_replicas(org_id: String, session_ids: Vec<String>, auth: String) {
    use futures::StreamExt;

    let Some(client) = get_agent_client() else {
        return;
    };
    futures::stream::iter(session_ids)
        .for_each_concurrent(4, |session_id| {
            let (client, org_id, auth) = (client.clone(), org_id.clone(), auth.clone());
            async move {
                match client
                    .delete_session_everywhere(&session_id, &org_id, &auth)
                    .await
                {
                    Ok(()) => {
                        let now = config::utils::time::now_micros();
                        if let Err(e) =
                            ai_chat_sessions::mark_replica_purged(&org_id, &session_id, now).await
                        {
                            log::warn!("[AI-CHAT] cannot record purge of {session_id}: {e}");
                        }
                    }
                    Err(e) => log::warn!(
                        "[AI-CHAT] cached copy of deleted chat {session_id} not removed: {e:#}"
                    ),
                }
            }
        })
        .await;
}

async fn turn_records(row: &Model) -> Vec<TurnRecord> {
    match ai_chat_turns::list_for_session(&row.org_id, &row.session_id).await {
        Ok(records) => records,
        Err(e) => {
            // Statuses are an annotation: the history itself still reads.
            log::error!(
                "[AI-CHAT] cannot read the turn records of {}/{}: {e}",
                row.org_id,
                row.session_id
            );
            Vec::new()
        }
    }
}

/// Merges turn records into projected turns (K2) and cuts them as `cut` says (K3).
fn build_history(
    projected: Vec<Value>,
    records: &[TurnRecord],
    running_since: i64,
    cut: Cut,
) -> History {
    let admitted = |r: &TurnRecord| cut.admitted_by.is_none_or(|at| r.started_at <= at);
    let changed = |r: &TurnRecord| {
        cut.changed_since
            .is_some_and(|since| r.started_at.max(r.ended_at.unwrap_or(0)) > since)
    };
    let mut synthetic = records
        .iter()
        .filter(|r| r.status == TURN_FAILED && r.end_seq.is_none() && admitted(r))
        .filter(|r| {
            let start = r.start_seq.unwrap_or(NO_SEQ + 1);
            start <= cut.cutoff + 1 && (cut.known_seq.is_none_or(|n| start > n) || changed(r))
        })
        .peekable();
    let mut turns = Vec::with_capacity(projected.len());
    for mut turn in projected {
        let first_seq = turn.get("first_seq").and_then(Value::as_i64);
        let last_seq = turn.get("last_seq").and_then(Value::as_i64);
        let record = first_seq.and_then(|seq| covering_record(records, seq));
        if let Some(record) = record {
            while let Some(failed) = synthetic.next_if(|s| s.started_at < record.started_at) {
                turns.push(failed_turn(failed));
            }
            attach_record(&mut turn, record, running_since);
        }
        let newer = cut
            .known_seq
            .is_none_or(|n| last_seq.is_none_or(|last| last > n));
        if newer || record.is_some_and(changed) {
            turns.push(turn);
        }
    }
    turns.extend(synthetic.map(failed_turn));
    let has_more = cut.limit.is_some_and(|limit| turns.len() > limit);
    if let Some(limit) = cut.limit.filter(|_| has_more) {
        turns.drain(..turns.len() - limit);
    }
    History {
        turns,
        partial_from_seq: cut.known_seq,
        has_more,
    }
}

/// A turn that never finished covers every seq up to the next recorded turn.
fn covering_record(records: &[TurnRecord], first_seq: i64) -> Option<&TurnRecord> {
    records
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let start = r.start_seq?;
            let end = match r.end_seq {
                Some(end) => end,
                None if r.status == TURN_RUNNING || r.status == TURN_INTERRUPTED => records
                    [i + 1..]
                    .iter()
                    .find_map(|next| next.start_seq)
                    .map_or(i64::MAX, |next| next - 1),
                None => return None,
            };
            (start..=end).contains(&first_seq).then_some(r)
        })
        .max_by_key(|r| (r.start_seq, r.started_at))
}

/// Labels a projected turn with its record; its frames end as the live stream of that outcome did.
fn attach_record(turn: &mut Value, record: &TurnRecord, running_since: i64) {
    let Some(obj) = turn.as_object_mut() else {
        return;
    };
    let status =
        if record.status == TURN_RUNNING && !ai_chat_turns::is_running(record, running_since) {
            TURN_INTERRUPTED
        } else {
            record.status.as_str()
        };
    if status == TURN_RUNNING || status == TURN_FAILED {
        end_frames_as(obj, status, record.error_code.as_deref());
    }
    obj.insert("turn_id".into(), record.turn_id.clone().into());
    obj.insert("status".into(), status.into());
    obj.insert("error_code".into(), record.error_code.clone().into());
}

/// A running turn has no terminal frame yet; a failed one ends with its error, never `complete`.
fn end_frames_as(turn: &mut serde_json::Map<String, Value>, status: &str, code: Option<&str>) {
    let error = turn
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| failed_turn_message(code));
    let Some(Value::Array(frames)) = turn.get_mut("frames") else {
        return;
    };
    if frames
        .last()
        .is_some_and(|f| f.get("type").and_then(Value::as_str) == Some("complete"))
    {
        frames.pop();
    }
    let has_error = frames
        .iter()
        .any(|f| f.get("type").and_then(Value::as_str) == Some("error"));
    if status == TURN_FAILED && !has_error {
        frames.push(error_frame(&error, code));
    }
    if status == TURN_FAILED {
        turn.insert("error".into(), error.into());
    }
}

/// A failed turn that stored nothing; the prompt is not kept server-side, so `user` is null.
fn failed_turn(record: &TurnRecord) -> Value {
    let code = record.error_code.as_deref();
    let error = failed_turn_message(code);
    serde_json::json!({
        "turn_id": record.turn_id,
        "status": TURN_FAILED,
        "error_code": code,
        "frames": [error_frame(&error, code)],
        "error": error,
        "user": null,
    })
}

/// The terminal frame a failed turn's live stream would have ended with.
fn error_frame(error: &str, code: Option<&str>) -> Value {
    serde_json::json!({
        "type": "error",
        "error": error,
        "error_code": code,
        "recoverable": false,
    })
}

/// The browser-facing text of a failed turn; provider details never leave the server.
fn failed_turn_message(code: Option<&str>) -> String {
    match code {
        Some(code) => format!("The response failed ({code}). Please try again."),
        None => "The response failed. Please try again.".to_string(),
    }
}

/// 409 with the reason in `error_code`, so the Slack bridge matches on it instead of the text.
fn lease_conflict_response() -> Response {
    (
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "code": StatusCode::CONFLICT.as_u16(),
            "error_code": TURN_ALREADY_RUNNING,
            "message": "Another turn is already running in this conversation",
        })),
    )
        .into_response()
}
/// 429 with the numeric HTTP code in `code` and the reason in `error_code` (E2E #5).
fn turn_limit_response(scope: &str) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "code": StatusCode::TOO_MANY_REQUESTS.as_u16(),
            "error_code": TURN_LIMIT,
            "scope": scope,
            "message": "Too many AI responses are running at once; please wait for one to finish",
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_of(resp: Response) -> Value {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    /// TH4: each admission refusal keeps the status and body the route answered before.
    #[tokio::test]
    async fn each_admit_error_maps_to_its_response() {
        let cases = [
            (
                AdmitError::InvalidSession("Invalid session id"),
                StatusCode::BAD_REQUEST,
                "Invalid session id",
            ),
            (
                AdmitError::NotRegistered,
                StatusCode::FORBIDDEN,
                "Chat history is only available to registered users",
            ),
            (
                AdmitError::NotFound("Unknown conversation"),
                StatusCode::NOT_FOUND,
                "Unknown conversation",
            ),
            (
                AdmitError::Busy,
                StatusCode::CONFLICT,
                "Another turn is already running in this conversation",
            ),
            (
                AdmitError::AlreadySubmitted,
                StatusCode::CONFLICT,
                "This turn was already submitted; reload the conversation to see its result",
            ),
            (
                AdmitError::Unavailable("Chat persistence is unavailable; please retry"),
                StatusCode::SERVICE_UNAVAILABLE,
                "Chat persistence is unavailable; please retry",
            ),
        ];
        for (error, status, message) in cases {
            let resp = admit_error_response(error);
            assert_eq!(resp.status(), status, "{error:?}");
            let body = body_of(resp).await;
            assert_eq!(body["code"], status.as_u16(), "{error:?}");
            assert_eq!(body["message"], message, "{error:?}");
        }
    }

    /// TH4, TH10: a turn-cap refusal is the 429 with its scope.
    #[tokio::test]
    async fn a_turn_limit_admit_error_is_the_429() {
        for scope in ["user", "org", "node"] {
            let resp = admit_error_response(AdmitError::TurnLimit(scope));
            assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
            let body = body_of(resp).await;
            assert_eq!(body["error_code"], TURN_LIMIT);
            assert_eq!(body["scope"], scope);
        }
    }

    #[test]
    fn cursors_round_trip_and_reject_garbage() {
        let sid = "01234567-89ab-7def-8123-456789abcdef";
        let cursor = decode_cursor(&format!("1700_{sid}")).unwrap();
        assert_eq!(cursor.updated_at, 1700);
        assert_eq!(cursor.session_id, sid);
        assert!(decode_cursor("1700").is_none());
        assert!(decode_cursor("x_01234567-89ab-7def-8123-456789abcdef").is_none());
        assert!(decode_cursor("1700_not-a-session").is_none());
    }

    #[test]
    fn ids_are_lowercased_and_only_hyphenated_uuids_accepted() {
        assert_eq!(
            normalize_uuid("0195A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B").as_deref(),
            Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
        );
        assert!(normalize_uuid("0195a1b2c3d47e5f8a9b0c1d2e3f4a5b").is_none());
        assert!(normalize_uuid("../etc").is_none());
    }

    #[tokio::test]
    async fn a_turn_limit_is_a_429_with_a_numeric_code() {
        let resp = turn_limit_response("user");
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], 429);
        assert_eq!(body["error_code"], "turn_limit");
        assert_eq!(body["scope"], "user");
    }

    #[tokio::test]
    async fn a_lease_conflict_is_a_409_with_turn_already_running() {
        let resp = lease_conflict_response();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "code": 409,
                "error_code": "turn_already_running",
                "message": "Another turn is already running in this conversation",
            })
        );
    }

    #[test]
    fn a_state_version_round_trips_and_rejects_garbage() {
        let v = StateVersion {
            seq: 12,
            changed_at: 1700,
            active: true,
        };
        assert_eq!(v.to_string(), "12.1700.1");
        assert_eq!(StateVersion::parse("12.1700.1"), Some(v));
        assert_eq!(
            StateVersion::parse("-1.0.0").map(|v| (v.seq, v.active)),
            Some((-1, false))
        );
        for bad in ["", "12", "12.1700", "12.1700.2", "12.1700.1.0", "x.1.1"] {
            assert_eq!(StateVersion::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_state_version_moves_with_any_turn_status_change() {
        let row = Model {
            last_committed_seq: 13,
            ..chat_row()
        };
        let mut records = sample_records();
        let before = StateVersion::of(&row, &records, true);
        assert_eq!(before.changed_at, 50);
        // Same seq, but the running turn ended: the version changes.
        records[4].status = "completed".into();
        records[4].ended_at = Some(60);
        let after = StateVersion::of(&row, &records, false);
        assert_ne!(before, after);
        assert_eq!(after.seq, before.seq);
    }

    fn record(
        turn: &str,
        status: &str,
        seqs: (Option<i64>, Option<i64>),
        started_at: i64,
    ) -> TurnRecord {
        TurnRecord {
            org_id: "org".into(),
            session_id: "sid".into(),
            turn_id: turn.into(),
            status: status.into(),
            error_code: (status == TURN_FAILED).then(|| "upstream_error".to_string()),
            start_seq: seqs.0,
            end_seq: seqs.1,
            started_at,
            ended_at: None,
        }
    }

    fn chat_row() -> Model {
        Model {
            org_id: "org".into(),
            session_id: "sid".into(),
            user_id: "u".into(),
            user_email: "u@x".into(),
            opencode_session_id: None,
            agent_type: "o2-ai".into(),
            title: String::new(),
            title_source: String::new(),
            status: STATUS_ACTIVE.into(),
            created_at: 0,
            updated_at: 0,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: NO_SEQ,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
        }
    }

    fn cut(cutoff: i64, known_seq: Option<i64>, limit: Option<usize>) -> Cut {
        Cut {
            cutoff,
            known_seq,
            limit,
            ..Default::default()
        }
    }

    fn projected(first: i64, last: i64) -> Value {
        serde_json::json!({"first_seq": first, "last_seq": last, "user": {"text": format!("q{first}")}, "frames": []})
    }

    fn summary(history: &History) -> Vec<(String, String)> {
        history
            .turns
            .iter()
            .map(|t| {
                (
                    t["turn_id"].as_str().unwrap_or("-").to_string(),
                    t["status"].as_str().unwrap_or("-").to_string(),
                )
            })
            .collect()
    }

    fn sample_records() -> Vec<TurnRecord> {
        use infra::table::ai_chat_turns::{TURN_CANCELLED, TURN_COMPLETED};
        vec![
            record("t1", TURN_COMPLETED, (Some(0), Some(4)), 10),
            record("t2", TURN_FAILED, (Some(5), None), 20),
            record("t3", TURN_CANCELLED, (Some(5), Some(8)), 30),
            record("t4", TURN_FAILED, (Some(9), Some(11)), 40),
            record("t5", TURN_RUNNING, (Some(12), None), 50),
        ]
    }

    #[test]
    fn turns_carry_their_record_and_failed_empty_turns_are_interleaved() {
        let turns = vec![
            projected(0, 4),
            projected(5, 8),
            projected(9, 11),
            projected(12, 13),
        ];
        let history = build_history(turns, &sample_records(), 0, cut(13, None, None));
        assert_eq!(
            summary(&history),
            vec![
                ("t1".into(), "completed".into()),
                ("t2".into(), "failed".into()),
                ("t3".into(), "cancelled".into()),
                ("t4".into(), "failed".into()),
                ("t5".into(), "running".into()),
            ]
        );
        let synthetic = &history.turns[1];
        assert_eq!(synthetic["user"], Value::Null);
        assert_eq!(
            synthetic["frames"],
            serde_json::json!([{
                "type": "error",
                "error": synthetic["error"],
                "error_code": "upstream_error",
                "recoverable": false,
            }])
        );
        assert!(
            synthetic["error"]
                .as_str()
                .unwrap()
                .contains("upstream_error")
        );
        assert_eq!(synthetic["error_code"], "upstream_error");
        assert_eq!(history.turns[3]["error_code"], "upstream_error");
        assert_eq!(history.turns[0]["error_code"], Value::Null);
        assert!(!history.has_more);
        assert_eq!(history.partial_from_seq, None);

        // Past the longest allowed turn the running one died.
        let history = build_history(
            vec![projected(12, 13)],
            &sample_records(),
            60,
            cut(13, None, None),
        );
        assert_eq!(summary(&history).last().unwrap().1, "interrupted");
    }

    #[test]
    fn turns_without_a_record_are_left_as_projected() {
        let history = build_history(
            vec![projected(0, 3), projected(4, 6)],
            &[],
            0,
            cut(6, None, None),
        );
        assert_eq!(history.turns, vec![projected(0, 3), projected(4, 6)]);
        // An interrupted turn without an end covers up to the next recorded turn.
        let records = vec![
            record("dead", TURN_INTERRUPTED, (Some(0), None), 10),
            record("next", TURN_RUNNING, (Some(4), None), 20),
        ];
        let history = build_history(
            vec![projected(0, 3), projected(4, 6)],
            &records,
            0,
            cut(6, None, None),
        );
        assert_eq!(
            summary(&history),
            vec![
                ("dead".into(), "interrupted".into()),
                ("next".into(), "running".into())
            ]
        );
    }

    #[test]
    fn an_incremental_read_returns_only_newer_turns_and_limit_keeps_the_newest() {
        let turns = || {
            vec![
                projected(0, 4),
                projected(5, 8),
                projected(9, 11),
                projected(12, 13),
            ]
        };
        let history = build_history(turns(), &sample_records(), 0, cut(13, Some(8), None));
        assert_eq!(history.partial_from_seq, Some(8));
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t4", "t5"]
        );
        // A turn spanning the cached seq comes back whole.
        let history = build_history(turns(), &sample_records(), 0, cut(13, Some(6), None));
        assert_eq!(history.turns[0]["first_seq"], 5);
        // The failed empty turn was submitted after seq 4: newer than a copy at 4.
        let history = build_history(turns(), &sample_records(), 0, cut(13, Some(4), None));
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t2", "t3", "t4", "t5"]
        );

        let history = build_history(turns(), &sample_records(), 0, cut(13, None, Some(2)));
        assert!(history.has_more);
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t4", "t5"]
        );
        let history = build_history(turns(), &sample_records(), 0, cut(13, None, Some(10)));
        assert!(!history.has_more);
        assert_eq!(history.turns.len(), 5);
    }

    #[test]
    fn a_snapshot_shows_no_turn_admitted_after_it() {
        // t2 failed with nothing stored right after seq 4, but after the snapshot was taken.
        let snapshot = Cut {
            cutoff: 4,
            admitted_by: Some(15),
            ..Default::default()
        };
        let history = build_history(vec![projected(0, 4)], &sample_records(), 0, snapshot);
        assert_eq!(summary(&history), vec![("t1".into(), "completed".into())]);
        let live = build_history(
            vec![projected(0, 4)],
            &sample_records(),
            0,
            cut(4, None, None),
        );
        assert_eq!(summary(&live).len(), 2);
    }

    #[test]
    fn an_incremental_read_also_returns_older_turns_whose_status_changed() {
        let mut records = sample_records();
        // t3 (seq 5..=8) was re-labelled after the client's copy at change time 45.
        records[2].ended_at = Some(70);
        let turns = vec![projected(0, 4), projected(5, 8), projected(12, 13)];
        let incremental = Cut {
            changed_since: Some(45),
            ..cut(13, Some(11), None)
        };
        let history = build_history(turns, &records, 0, incremental);
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t3", "t5"]
        );
    }

    fn frame_types(turn: &Value) -> Vec<String> {
        turn["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["type"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn running_turns_have_no_terminal_and_failed_ones_end_with_their_error() {
        let with_complete = |first, last| {
            let mut turn = projected(first, last);
            turn["frames"] = serde_json::json!([{"type": "message"}, {"type": "complete"}]);
            turn["error"] = Value::Null;
            turn
        };
        let records = sample_records();
        let history = build_history(
            vec![with_complete(9, 11), with_complete(12, 13)],
            &records,
            0,
            cut(13, None, None),
        );
        let by_id = |id: &str| history.turns.iter().find(|t| t["turn_id"] == id).unwrap();
        let failed = by_id("t4");
        assert_eq!(failed["status"], "failed");
        assert_eq!(frame_types(failed), vec!["message", "error"]);
        assert_eq!(failed["frames"][1]["error_code"], "upstream_error");
        assert_eq!(failed["frames"][1]["recoverable"], false);
        assert_eq!(failed["frames"][1]["error"], failed["error"]);
        assert!(failed["error"].as_str().unwrap().contains("upstream_error"));
        let running = by_id("t5");
        assert_eq!(running["status"], "running");
        assert_eq!(frame_types(running), vec!["message"]);
        // A completed turn keeps its terminal.
        let done = build_history(vec![with_complete(0, 4)], &records, 0, cut(4, None, None));
        assert_eq!(frame_types(&done.turns[0]), vec!["message", "complete"]);
    }

    #[test]
    fn a_cut_history_shows_no_failed_turn_from_after_the_cut() {
        let history = build_history(
            vec![projected(0, 4)],
            &sample_records(),
            0,
            cut(3, None, None),
        );
        assert_eq!(summary(&history), vec![("t1".into(), "completed".into())]);
    }
}

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

//! Server-side AI chat history: admission of persisted turns and the
//! `/{org_id}/ai/chats` API.
//!
//! A chat belongs to the user who started it — by stable `users.id`, not by
//! email — and every read goes through here: the chat-events stream itself is
//! not searchable by anyone else (see `config::meta::self_reporting::ai_chat`).

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use infra::table::{
    ai_chat_sessions::{self, ListCursor, Model, NO_SEQ, STATUS_ACTIVE},
    ai_chat_turns::{
        self, Admission, Model as TurnRecord, TURN_FAILED, TURN_INTERRUPTED, TURN_RUNNING,
    },
};
use o2_enterprise::enterprise::{
    ai::{
        chat::{
            lease::{self, LeaseError, TurnLease},
            registry::{self, CancelReason},
        },
        client::get_agent_client,
    },
    common::config::get_config as get_o2_config,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Browser-generated id of one turn (a UUID). A request retried with the same
/// id is recognized instead of starting a second model run.
pub const X_O2_ASSISTANT_TURN_ID: &str = "x-o2-assistant-turn-id";

pub(super) const MAX_TITLE_CHARS: usize = 200;
const DEFAULT_PAGE: u64 = 50;
const MAX_PAGE: u64 = 200;
const MAX_TURNS_PAGE: usize = 1000;
/// A turn still marked running this long past the longest allowed turn died with its node.
const RUNNING_GRACE_SECS: i64 = 60;
const MICROS_PER_SEC: i64 = 1_000_000;

/// A new chat's provisional title: the first line of its first prompt,
/// trimmed to [`PROMPT_TITLE_CHARS`] characters.
fn prompt_title(prompt: &str) -> Option<String> {
    let line = prompt.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut title: String = line.chars().take(PROMPT_TITLE_CHARS).collect();
    if line.chars().count() > PROMPT_TITLE_CHARS {
        title.push('…');
    }
    Some(title)
}

const PROMPT_TITLE_CHARS: usize = 80;

pub(super) fn is_uuid(value: &str) -> bool {
    value.len() == 36 && uuid::Uuid::try_parse(value).is_ok()
}

/// Lowercased id, so both spellings of one UUID name the same chat; `None` unless a hyphenated
/// UUID.
pub(super) fn normalize_uuid(value: &str) -> Option<String> {
    is_uuid(value).then(|| value.to_ascii_lowercase())
}

/// Started-at bound (micros) below which a turn marked running is treated as dead.
pub(super) fn running_since(now: i64) -> i64 {
    let max_turn = get_o2_config().ai.chat_max_turn_secs.max(60) as i64;
    now - (max_turn + RUNNING_GRACE_SECS) * MICROS_PER_SEC
}

/// The stable owner id for an authenticated email.
pub async fn resolve_owner(user_email: &str) -> Result<String, Response> {
    match infra::table::users::get_id_by_email(user_email).await {
        Ok(Some(id)) => Ok(id),
        Ok(None) => Err(MetaHttpResponse::forbidden(
            "Chat history is only available to registered users",
        )),
        Err(e) => {
            log::error!("[AI-CHAT] cannot resolve user id for {user_email}: {e}");
            Err(MetaHttpResponse::service_unavailable(
                "Chat persistence is unavailable; please retry",
            ))
        }
    }
}

/// The caller's own active chat, or a 404 that does not reveal whether the
/// id exists for someone else.
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
        // Logged and counted by the reader. Never a partial chat presented as
        // whole: the caller keeps whatever it had and may retry.
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

/// Everything a persisted turn needs once admitted.
pub struct AdmittedTurn {
    pub row: Model,
    pub owner: String,
    pub turn_id: String,
    pub lease: TurnLease,
}

/// Admit one persisted turn (design §8.1); a turn id seen before is refused unless it failed
/// without storing anything.
pub async fn admit_turn(
    org_id: &str,
    session_id: Option<&str>,
    turn_id: Option<&str>,
    user_email: &str,
    agent_type: &str,
    prompt: &str,
    trace_id: &str,
) -> Result<AdmittedTurn, Response> {
    // The session id is the key every stored event and the index row hang
    // off; without it a turn cannot be persisted at all.
    let Some(session_id) = session_id.and_then(normalize_uuid) else {
        return Err(MetaHttpResponse::bad_request(
            "A valid session id is required while chat persistence is enabled",
        ));
    };
    let session_id = session_id.as_str();
    let turn_id = match turn_id {
        Some(id) => {
            normalize_uuid(id).ok_or_else(|| MetaHttpResponse::bad_request("Invalid turn id"))?
        }
        None => config::ider::uuid(),
    };
    let owner = resolve_owner(user_email).await?;
    let now = config::utils::time::now_micros();
    let row =
        ai_chat_sessions::get_or_create(org_id, session_id, &owner, user_email, agent_type, now)
            .await
            .map_err(|e| {
                // Durability is the contract here: answering without an index row
                // would silently drop the conversation.
                log::error!(
                    "[AI-CHAT] [trace_id:{trace_id}] cannot read/create the index row for \
             {org_id}/{session_id}: {e}"
                );
                MetaHttpResponse::service_unavailable(
                    "Chat persistence is unavailable; please retry",
                )
            })?;
    if row.user_id != owner {
        // The id is client-supplied: replaying someone else's must not append
        // to (or reveal) their conversation.
        log::warn!(
            "[AI-CHAT] [trace_id:{trace_id}] {user_email} tried to continue session \
             {session_id} owned by another user"
        );
        return Err(MetaHttpResponse::not_found("Unknown conversation"));
    }
    if row.status != STATUS_ACTIVE {
        return Err(MetaHttpResponse::not_found(
            "This conversation has been deleted",
        ));
    }
    if let Some(limit) = turn_limit_reached(org_id, &owner) {
        config::metrics::AI_CHAT_TURN_RESULT_TOTAL
            .with_label_values(&[org_id, "turn_limit"])
            .inc();
        log::warn!(
            "[AI-CHAT] [trace_id:{trace_id}] {org_id}/{session_id} refused: {limit} \
             active-turn limit reached"
        );
        return Err(turn_limit_response(limit));
    }

    let lease = acquire_lease(org_id, session_id, trace_id).await?;
    match ai_chat_turns::admit(
        org_id,
        session_id,
        &turn_id,
        row.last_committed_seq + 1,
        now,
    )
    .await
    {
        Ok(Admission::Admitted | Admission::Retried) => {
            // Kept for readers of the phase-1 column; admission itself uses the turn records.
            if let Err(e) = ai_chat_sessions::begin_turn(org_id, session_id, &turn_id, now).await {
                log::warn!("[AI-CHAT] cannot record the last turn of {session_id}: {e}");
            }
            if row.title_source.is_empty()
                && let Some(title) = prompt_title(prompt)
                && let Err(e) =
                    ai_chat_sessions::set_prompt_title(org_id, session_id, &title, now).await
            {
                // Cosmetic: the generated title replaces it shortly anyway.
                log::warn!("[AI-CHAT] cannot set the initial title of {session_id}: {e}");
            }
            Ok(AdmittedTurn {
                row,
                owner,
                turn_id,
                lease,
            })
        }
        Ok(Admission::AlreadySubmitted) => {
            lease.release().await;
            Err(MetaHttpResponse::conflict(
                "This turn was already submitted; reload the conversation to see its result",
            ))
        }
        Err(e) => {
            lease.release().await;
            log::error!("[AI-CHAT] [trace_id:{trace_id}] cannot record turn {turn_id}: {e}");
            Err(MetaHttpResponse::service_unavailable(
                "Chat persistence is unavailable; please retry",
            ))
        }
    }
}

/// Ends a turn that never started as `failed` with nothing stored, so its id may be submitted
/// again.
pub async fn abandon_turn(admitted: AdmittedTurn, error_code: &str) {
    let AdmittedTurn {
        row,
        turn_id,
        lease,
        ..
    } = admitted;
    let now = config::utils::time::now_micros();
    if let Err(e) = ai_chat_turns::finish(
        &row.org_id,
        &row.session_id,
        &turn_id,
        TURN_FAILED,
        Some(error_code),
        None,
        None,
        now,
    )
    .await
    {
        log::error!(
            "[AI-CHAT] cannot release turn {turn_id} of {}/{}: {e}",
            row.org_id,
            row.session_id
        );
    }
    lease.release().await;
}

// ---------------------------------------------------------------------------
// History API
// ---------------------------------------------------------------------------

/// One chat in the user's list.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatSummary {
    pub session_id: String,
    pub title: String,
    pub agent_type: String,
    /// Microseconds since the epoch.
    pub created_at: i64,
    pub updated_at: i64,
    /// Highest durably stored event sequence (-1: nothing yet). A cached copy
    /// at this sequence is current and need not be fetched again.
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
        Err(resp) => return resp,
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

#[derive(Debug, Deserialize)]
pub struct GetParams {
    /// The `last_committed_seq` of the caller's cached copy.
    pub known_seq: Option<i64>,
    /// At most this many turns, the newest.
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChatDetailResponse {
    #[serde(flatten)]
    pub chat: ChatSummary,
    /// True when `known_seq` is current; `turns` is then omitted.
    pub not_modified: bool,
    /// A turn of this chat is running right now.
    pub active_turn: bool,
    /// Set when `turns` holds only the turns past this `known_seq` (merge by `first_seq`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_from_seq: Option<i64>,
    /// Older turns were left out to honour `limit`.
    pub has_more: bool,
    /// Per turn: the user's words, the live stream's UI frames, and
    /// `turn_id`/`status`/`error_code` when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub turns: Option<Vec<serde_json::Value>>,
}

/// The turns a detail read returns (see [`build_history`]).
#[derive(Debug, Default, PartialEq)]
struct History {
    turns: Vec<Value>,
    partial_from_seq: Option<i64>,
    has_more: bool,
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
                   history. With `known_seq` equal to the stored sequence the body says \
                   `not_modified` and carries no turns.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
        ("known_seq" = Option<i64>, Query, description = "Sequence of the caller's cached copy; \
            when older than the stored one only the newer turns are returned"),
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
        Err(resp) => return resp,
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
    if params.known_seq == Some(row.last_committed_seq) {
        return Json(ChatDetailResponse {
            chat: row.into(),
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
    let known_seq = params
        .known_seq
        .filter(|n| (NO_SEQ..row.last_committed_seq).contains(n));
    let history = build_history(
        turns,
        &records,
        running_since(now),
        row.last_committed_seq,
        known_seq,
        params.limit.map(|l| l.clamp(1, MAX_TURNS_PAGE)),
    );
    Json(ChatDetailResponse {
        chat: row.into(),
        not_modified: false,
        active_turn,
        partial_from_seq: history.partial_from_seq,
        has_more: history.has_more,
        turns: Some(history.turns),
    })
    .into_response()
}

/// Projected `turns` with their turn records merged in (K2), as every history read shows them.
pub(super) async fn attach_turn_status(row: &Model, turns: Vec<Value>) -> Vec<Value> {
    let records = turn_records(row).await;
    let now = config::utils::time::now_micros();
    build_history(
        turns,
        &records,
        running_since(now),
        row.last_committed_seq,
        None,
        None,
    )
    .turns
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenameRequest {
    pub title: String,
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
        Err(resp) => return resp,
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
        Err(resp) => return resp,
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
        Err(resp) => return resp,
    };
    match ai_chat_sessions::active_ids_for_user(&org_id, &owner).await {
        Ok(ids) => {
            for session_id in ids {
                registry::cancel(&org_id, &session_id, CancelReason::Deleted);
            }
        }
        Err(e) => log::warn!("[AI-CHAT] cannot list chats of {org_id}/{owner} to stop: {e}"),
    }
    let now = config::utils::time::now_micros();
    let session_ids = match ai_chat_sessions::mark_all_deleted(&org_id, &owner, now).await {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("[AI-CHAT] cannot clear chats of {org_id}/{owner}: {e}");
            return MetaHttpResponse::service_unavailable(
                "Chat history is unavailable; please retry",
            );
        }
    };
    super::shares::revoke_for_deleted(&org_id, &session_ids, now).await;
    let deleted = session_ids.len();
    if !session_ids.is_empty() {
        let (parts, _) = in_req.into_parts();
        let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        tokio::spawn(purge_replicas(org_id, session_ids, auth));
    }
    MetaHttpResponse::json(serde_json::json!({ "deleted": deleted }))
}

pub(super) fn user_email(req: &axum::extract::Request) -> Option<String> {
    req.headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// Best effort; copies not confirmed gone are retried by the retention sweep.
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

/// Merges turn records into projected turns (K2) and cuts them by `known_seq` and `limit` (K3).
fn build_history(
    projected: Vec<Value>,
    records: &[TurnRecord],
    running_since: i64,
    cutoff: i64,
    known_seq: Option<i64>,
    limit: Option<usize>,
) -> History {
    let mut synthetic = records
        .iter()
        .filter(|r| r.status == TURN_FAILED && r.end_seq.is_none())
        .filter(|r| {
            let start = r.start_seq.unwrap_or(NO_SEQ + 1);
            start <= cutoff + 1 && known_seq.is_none_or(|n| start > n)
        })
        .peekable();
    let mut turns = Vec::with_capacity(projected.len());
    for mut turn in projected {
        let first_seq = turn.get("first_seq").and_then(Value::as_i64);
        let last_seq = turn.get("last_seq").and_then(Value::as_i64);
        if let Some(record) = first_seq.and_then(|seq| covering_record(records, seq)) {
            while let Some(failed) = synthetic.next_if(|s| s.started_at < record.started_at) {
                turns.push(failed_turn(failed));
            }
            attach_record(&mut turn, record, running_since);
        }
        if known_seq.is_none_or(|n| last_seq.is_none_or(|last| last > n)) {
            turns.push(turn);
        }
    }
    turns.extend(synthetic.map(failed_turn));
    let has_more = limit.is_some_and(|limit| turns.len() > limit);
    if let Some(limit) = limit.filter(|_| has_more) {
        turns.drain(..turns.len() - limit);
    }
    History {
        turns,
        partial_from_seq: known_seq,
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
    obj.insert("turn_id".into(), record.turn_id.clone().into());
    obj.insert("status".into(), status.into());
    obj.insert("error_code".into(), record.error_code.clone().into());
}

fn failed_turn(record: &TurnRecord) -> Value {
    serde_json::json!({
        "turn_id": record.turn_id,
        "status": TURN_FAILED,
        "error_code": record.error_code,
        "user": null,
        "frames": [],
    })
}

async fn acquire_lease(
    org_id: &str,
    session_id: &str,
    trace_id: &str,
) -> Result<TurnLease, Response> {
    match lease::acquire(
        org_id,
        session_id,
        get_o2_config().ai.chat_turn_lease_wait_secs,
    )
    .await
    {
        Ok(lease) => Ok(lease),
        Err(LeaseError::Busy) => {
            config::metrics::AI_CHAT_TURN_LEASE_CONFLICTS_TOTAL
                .with_label_values(&[org_id])
                .inc();
            config::metrics::AI_CHAT_TURN_RESULT_TOTAL
                .with_label_values(&[org_id, "busy"])
                .inc();
            Err(MetaHttpResponse::conflict(
                "Another turn is already running in this conversation",
            ))
        }
        Err(LeaseError::Backend(e)) => {
            log::error!(
                "[AI-CHAT] [trace_id:{trace_id}] turn lease unavailable for \
                 {org_id}/{session_id}: {e}"
            );
            Err(MetaHttpResponse::service_unavailable(
                "Chat coordination is unavailable; please retry",
            ))
        }
    }
}

/// Which active-turn cap (`user`, `org` or `node`) this node's running turns already reach.
fn turn_limit_reached(org_id: &str, owner: &str) -> Option<&'static str> {
    let cfg = &get_o2_config().ai;
    first_cap_reached([
        (
            "user",
            registry::active_for_user(org_id, owner),
            cfg.chat_max_active_turns_per_user,
        ),
        (
            "org",
            registry::active_for_org(org_id),
            cfg.chat_max_active_turns_per_org,
        ),
        (
            "node",
            registry::active_count(),
            cfg.chat_max_active_turns_per_node,
        ),
    ])
}

/// The first `(scope, active, cap)` whose cap is reached; a cap of 0 is unlimited.
fn first_cap_reached(caps: [(&'static str, usize, usize); 3]) -> Option<&'static str> {
    caps.into_iter()
        .find(|(_, active, cap)| *cap > 0 && active >= cap)
        .map(|(scope, ..)| scope)
}

fn turn_limit_response(scope: &str) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "code": "turn_limit",
            "scope": scope,
            "message": "Too many AI responses are running at once; please wait for one to finish",
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_titles_take_the_first_line_and_are_bounded() {
        assert_eq!(
            prompt_title("\n  why is p99 up?\nmore"),
            Some("why is p99 up?".into())
        );
        assert_eq!(prompt_title("   \n"), None);
        let long = "x".repeat(200);
        let title = prompt_title(&long).unwrap();
        assert_eq!(title.chars().count(), PROMPT_TITLE_CHARS + 1);
        assert!(title.ends_with('…'));
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

    #[test]
    fn the_first_reached_cap_is_reported_and_zero_is_unlimited() {
        assert_eq!(
            first_cap_reached([("user", 2, 3), ("org", 10, 50), ("node", 0, 200)]),
            None
        );
        assert_eq!(
            first_cap_reached([("user", 3, 3), ("org", 50, 50), ("node", 0, 200)]),
            Some("user")
        );
        assert_eq!(
            first_cap_reached([("user", 1, 3), ("org", 50, 50), ("node", 0, 200)]),
            Some("org")
        );
        assert_eq!(
            first_cap_reached([("user", 9, 0), ("org", 9, 0), ("node", 200, 200)]),
            Some("node")
        );
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
        let history = build_history(turns, &sample_records(), 0, 13, None, None);
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
        assert_eq!(synthetic["frames"], serde_json::json!([]));
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
            13,
            None,
            None,
        );
        assert_eq!(summary(&history).last().unwrap().1, "interrupted");
    }

    #[test]
    fn turns_without_a_record_are_left_as_projected() {
        let history = build_history(
            vec![projected(0, 3), projected(4, 6)],
            &[],
            0,
            6,
            None,
            None,
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
            6,
            None,
            None,
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
        let history = build_history(turns(), &sample_records(), 0, 13, Some(8), None);
        assert_eq!(history.partial_from_seq, Some(8));
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t4", "t5"]
        );
        // A turn spanning the cached seq comes back whole.
        let history = build_history(turns(), &sample_records(), 0, 13, Some(6), None);
        assert_eq!(history.turns[0]["first_seq"], 5);
        // The failed empty turn was submitted after seq 4: newer than a copy at 4.
        let history = build_history(turns(), &sample_records(), 0, 13, Some(4), None);
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t2", "t3", "t4", "t5"]
        );

        let history = build_history(turns(), &sample_records(), 0, 13, None, Some(2));
        assert!(history.has_more);
        assert_eq!(
            summary(&history)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>(),
            vec!["t4", "t5"]
        );
        let history = build_history(turns(), &sample_records(), 0, 13, None, Some(10));
        assert!(!history.has_more);
        assert_eq!(history.turns.len(), 5);
    }

    #[test]
    fn a_cut_history_shows_no_failed_turn_from_after_the_cut() {
        let history = build_history(vec![projected(0, 4)], &sample_records(), 0, 3, None, None);
        assert_eq!(summary(&history), vec![("t1".into(), "completed".into())]);
    }
}

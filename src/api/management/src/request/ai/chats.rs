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
use infra::table::ai_chat_sessions::{self, ListCursor, Model, STATUS_ACTIVE};
use o2_enterprise::enterprise::{
    ai::{
        chat::lease::{self, LeaseError, TurnLease},
        client::get_agent_client,
    },
    common::config::get_config as get_o2_config,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Browser-generated id of one turn (a UUID). A request retried with the same
/// id is recognized instead of starting a second model run.
pub const X_O2_ASSISTANT_TURN_ID: &str = "x-o2-assistant-turn-id";

/// Largest projection request sent to o2-ai, in events (whole turns only; a
/// single longer turn is sent alone).
const PROJECT_CHUNK_EVENTS: usize = 5000;
const MAX_TITLE_CHARS: usize = 200;
const DEFAULT_PAGE: u64 = 50;
const MAX_PAGE: u64 = 200;

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

fn is_uuid(value: &str) -> bool {
    value.len() == 36 && uuid::Uuid::try_parse(value).is_ok()
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
async fn owned_chat(org_id: &str, session_id: &str, owner: &str) -> Result<Model, Response> {
    if !is_uuid(session_id) {
        return Err(MetaHttpResponse::bad_request("Invalid session id"));
    }
    match ai_chat_sessions::get(org_id, session_id).await {
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

/// Everything a persisted turn needs once admitted.
pub struct AdmittedTurn {
    pub row: Model,
    pub owner: String,
    pub turn_id: String,
    pub lease: TurnLease,
}

/// Admit one persisted turn (design §8.1): resolve the owner, create or read
/// the chat's index row, refuse another user's or a deleted chat, take the
/// session's turn lease, and recognize a retried turn.
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
    let Some(session_id) = session_id.filter(|s| is_uuid(s)) else {
        return Err(MetaHttpResponse::bad_request(
            "A valid session id is required while chat persistence is enabled",
        ));
    };
    let turn_id = match turn_id {
        Some(id) if is_uuid(id) => id.to_string(),
        Some(_) => return Err(MetaHttpResponse::bad_request("Invalid turn id")),
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
        return Err(MetaHttpResponse::forbidden(
            "This conversation belongs to another user",
        ));
    }
    if row.status != STATUS_ACTIVE {
        return Err(MetaHttpResponse::not_found(
            "This conversation has been deleted",
        ));
    }

    let lease = match lease::acquire(
        org_id,
        session_id,
        get_o2_config().ai.chat_turn_lease_wait_secs,
    )
    .await
    {
        Ok(lease) => lease,
        Err(LeaseError::Busy) => {
            config::metrics::AI_CHAT_TURN_LEASE_CONFLICTS_TOTAL
                .with_label_values(&[org_id])
                .inc();
            return Err(MetaHttpResponse::conflict(
                "Another turn is already running in this conversation",
            ));
        }
        Err(LeaseError::Backend(e)) => {
            log::error!(
                "[AI-CHAT] [trace_id:{trace_id}] turn lease unavailable for \
                 {org_id}/{session_id}: {e}"
            );
            return Err(MetaHttpResponse::service_unavailable(
                "Chat coordination is unavailable; please retry",
            ));
        }
    };

    match ai_chat_sessions::begin_turn(org_id, session_id, &turn_id, now).await {
        Ok(true) => {
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
        Ok(false) => {
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
    // One extra row tells whether there is a next page.
    let mut rows =
        match ai_chat_sessions::list_for_user(&org_id, &owner, cursor.as_ref(), limit + 1).await {
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
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChatDetailResponse {
    #[serde(flatten)]
    pub chat: ChatSummary,
    /// True when `known_seq` is current; `turns` is then omitted.
    pub not_modified: bool,
    /// Per turn: the user's words and the UI frames the live stream produced,
    /// to be folded with the same reducer as a live turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub turns: Option<Vec<serde_json::Value>>,
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
        ("known_seq" = Option<i64>, Query, description = "Sequence of the caller's cached copy"),
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
    if params.known_seq == Some(row.last_committed_seq) {
        return Json(ChatDetailResponse {
            chat: row.into(),
            not_modified: true,
            turns: None,
        })
        .into_response();
    }

    let events = match openobserve_core::ai_chat::read_committed_events(&row, -1).await {
        Ok(events) => events,
        // Logged and counted by the reader. Never a partial chat presented as
        // whole: the caller keeps whatever it had and may retry.
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "code": StatusCode::SERVICE_UNAVAILABLE.as_u16(),
                    "message": "This conversation's history could not be read in full; please retry",
                    "error_code": "history_unavailable",
                    "detail": e.to_string(),
                })),
            )
                .into_response();
        }
    };

    let Some(client) = get_agent_client() else {
        return MetaHttpResponse::service_unavailable("Agent service not configured");
    };
    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    let mut turns = Vec::new();
    for chunk in openobserve_core::ai_chat::turn_chunks(&events, PROJECT_CHUNK_EVENTS) {
        let payload: Vec<_> = chunk.iter().map(|e| e.to_replay_json()).collect();
        match client.project_session(&org_id, &payload, &auth).await {
            Ok(projected) => {
                if let Some(chunk_turns) = projected.get("turns").and_then(|t| t.as_array()) {
                    turns.extend(chunk_turns.iter().cloned());
                }
            }
            Err(e) => {
                log::error!("[AI-CHAT] projecting {org_id}/{session_id} failed: {e:#}");
                return MetaHttpResponse::service_unavailable(
                    "This conversation could not be rendered right now; please retry",
                );
            }
        }
    }
    Json(ChatDetailResponse {
        chat: row.into(),
        not_modified: false,
        turns: Some(turns),
    })
    .into_response()
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
    if !is_uuid(&session_id) {
        return MetaHttpResponse::bad_request("Invalid session id");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let now = config::utils::time::now_micros();
    match ai_chat_sessions::rename(&org_id, &session_id, &owner, title, now).await {
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
    if !is_uuid(&session_id) {
        return MetaHttpResponse::bad_request("Invalid session id");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
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
    // Drop the replica's working copy too. Best effort: the chat is already
    // unreadable, and a leftover opencode session is never served again.
    if let Some(client) = get_agent_client() {
        let (parts, _) = in_req.into_parts();
        let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        tokio::spawn(async move {
            if let Err(e) = client.delete_session(&session_id, &org_id, &auth).await {
                log::warn!("[AI-CHAT] cached copy of deleted chat {session_id} not removed: {e:#}");
            }
        });
    }
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
    let deleted = session_ids.len();
    // Drop the replicas' working copies in the background, a few at a time:
    // the chats are already unreadable, this only reclaims o2-ai's disk.
    if !session_ids.is_empty()
        && let Some(client) = get_agent_client()
    {
        let (parts, _) = in_req.into_parts();
        let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        tokio::spawn(async move {
            use futures::StreamExt;
            futures::stream::iter(session_ids)
                .for_each_concurrent(4, |session_id| {
                    let (client, org_id, auth) = (client.clone(), org_id.clone(), auth.clone());
                    async move {
                        if let Err(e) = client.delete_session(&session_id, &org_id, &auth).await {
                            log::warn!(
                                "[AI-CHAT] cached copy of deleted chat {session_id} not removed: {e:#}"
                            );
                        }
                    }
                })
                .await;
        });
    }
    MetaHttpResponse::json(serde_json::json!({ "deleted": deleted }))
}

fn user_email(req: &axum::extract::Request) -> Option<String> {
    req.headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
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
}

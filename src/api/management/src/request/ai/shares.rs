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

//! Sharing persisted AI chats; every unservable share answers the same 404.

use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, RwLock},
    time::Duration,
};

use axum::{
    Json,
    extract::{Extension, Path, Query},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{axum::middlewares::RealIp, meta::user::UserRole, utils::time::now_micros};
use infra::table::{
    ai_chat_sessions::{self, Model as ChatModel, NO_SEQ, NewFork, STATUS_ACTIVE},
    ai_chat_shares::{
        self, MODE_LIVE, MODE_SNAPSHOT, Model as ShareModel, NewShare, ShareSettings,
        VISIBILITY_ORG, VISIBILITY_PUBLIC,
    },
};
use o2_enterprise::enterprise::ai::chat::{
    batcher::DurableEvent,
    lease::{self, LeaseError},
};
use openobserve_core::ai_chat::ReadError;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tokio::sync::{Semaphore, SemaphorePermit};
use utoipa::ToSchema;

use super::chats::{MAX_TITLE_CHARS, is_uuid, load_turns, owned_chat, resolve_owner, user_email};
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::public_rate_limit::{Counters, client_ip, over_budget, too_many_requests},
    service::auth::check_permissions,
};

const NOT_FOUND: &str = "Shared chat not found";
const MIN_EXPIRY_SECS: i64 = 60;
const MAX_EXPIRY_SECS: i64 = 365 * 24 * 60 * 60;
const MAX_BODY_BYTES: usize = 16 * 1024;
const PUBLIC_READ_WINDOW: Duration = Duration::from_secs(60);
const PUBLIC_READ_SLOTS: usize = 8;
// o2-ai refuses a longer seed with 413 instead of truncating it.
const SEED_MAX_MESSAGES: usize = 200;
const SEED_MAX_CHARS: usize = 200_000;
const FALLBACK_TITLE: &str = "Shared chat";
const TURN_RUNNING: &str = "A response is still being generated; share again when it finishes";
const SEED_HEADER: &str = "[Restored conversation]\n";
const SEED_FENCE: &str = "\n---\n\n";
const CONTEXT_HEADER: &str = "[Context]\n";

static PUBLIC_READS: LazyLock<Counters> = LazyLock::new(|| RwLock::new(Default::default()));
// Reads that resolve no client address still cannot pile up without bound.
static PUBLIC_READ_GATE: Semaphore = Semaphore::const_new(PUBLIC_READ_SLOTS);

/// A share as its owner sees it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ShareView {
    pub id: String,
    /// Bearer secret of the link; part of `url_path`.
    pub token: String,
    /// Path of the web page that shows the share.
    pub url_path: String,
    pub mode: String,
    pub visibility: String,
    pub snapshot_seq: Option<i64>,
    /// Microseconds since the epoch; absent when the share never expires.
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub access_count: i64,
    pub last_accessed_at: Option<i64>,
    pub session_id: String,
    pub title: String,
}

impl ShareView {
    fn new(share: ShareModel, title: &str) -> Self {
        Self {
            url_path: url_path(&share),
            id: share.id,
            token: share.token,
            mode: share.mode,
            visibility: share.visibility,
            snapshot_seq: share.snapshot_seq,
            expires_at: share.expires_at,
            created_at: share.created_at,
            updated_at: share.updated_at,
            access_count: share.access_count,
            last_accessed_at: share.last_accessed_at,
            session_id: share.session_id,
            title: title.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShareListResponse {
    pub shares: Vec<ShareView>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateShareRequest {
    /// `snapshot` or `live`.
    pub mode: String,
    /// `org` or `public`.
    pub visibility: String,
    /// 60 seconds to 365 days; absent for a share that never expires.
    pub expires_in_secs: Option<i64>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateShareRequest {
    pub mode: Option<String>,
    /// A number sets a new expiry from now; `null` removes the expiry.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<i64>)]
    pub expires_in_secs: Option<Option<i64>>,
    /// Moves a snapshot share to the chat's latest committed history.
    #[serde(default)]
    pub refresh_snapshot: bool,
}

#[derive(Debug, Deserialize)]
pub struct SharedChatParams {
    /// The `seq` of the caller's cached copy.
    pub known_seq: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SharedChat {
    pub title: String,
    pub mode: String,
    /// Last committed event the share shows; pass back as `known_seq`.
    pub seq: i64,
    /// When the chat was started (micros).
    pub created_at: i64,
    /// When the share was created (micros).
    pub shared_at: i64,
    /// The owner's display name; never their email on a public link.
    pub owner_name: Option<String>,
    /// True when `known_seq` is current; `turns` is then omitted.
    pub not_modified: bool,
    /// Same shape as `GET /ai/chats/{session_id}` returns.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub turns: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ForkResponse {
    pub session_id: String,
    pub title: String,
}

/// A share that may be served, with its chat.
struct Served {
    share: ShareModel,
    chat: ChatModel,
}

/// A chat's stored events folded to final message and part snapshots, like o2-ai's projection.
#[derive(Default)]
struct Folded {
    /// Message ids in first-seen order.
    order: Vec<String>,
    infos: HashMap<String, Value>,
    /// Per message: its parts' final snapshots in first-seen order.
    parts: HashMap<String, Vec<(String, Value)>>,
}

impl Folded {
    fn new(events: &[DurableEvent]) -> Self {
        let mut folded = Self::default();
        let mut seen = HashSet::new();
        for event in events {
            folded.apply(live_type(&event.event_type), &event.data, &mut seen);
        }
        folded
    }

    fn apply(&mut self, event_type: &str, data: &Value, seen: &mut HashSet<String>) {
        match event_type {
            "message.updated" => {
                let info = &data["info"];
                if let Some(id) = info["id"].as_str().filter(|_| info["role"].is_string()) {
                    if seen.insert(id.to_string()) {
                        self.order.push(id.to_string());
                    }
                    self.infos.insert(id.to_string(), info.clone());
                }
            }
            "message.part.updated" => {
                let part = &data["part"];
                if let (Some(id), Some(message)) = (part["id"].as_str(), part["messageID"].as_str())
                {
                    let parts = self.parts.entry(message.to_string()).or_default();
                    match parts.iter_mut().find(|(pid, _)| pid == id) {
                        Some((_, snapshot)) => *snapshot = part.clone(),
                        None => parts.push((id.to_string(), part.clone())),
                    }
                }
            }
            "message.part.removed" => {
                if let (Some(message), Some(id)) =
                    (data["messageID"].as_str(), data["partID"].as_str())
                    && let Some(parts) = self.parts.get_mut(message)
                {
                    parts.retain(|(pid, _)| pid != id);
                }
            }
            "message.removed" => {
                if let Some(id) = data["messageID"].as_str() {
                    self.infos.remove(id);
                }
            }
            _ => {}
        }
    }

    fn messages_with_role<'a>(&'a self, role: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.order
            .iter()
            .filter(move |id| self.infos.get(*id).is_some_and(|i| i["role"] == role))
            .map(String::as_str)
    }

    fn parts_of(&self, message: &str) -> &[(String, Value)] {
        self.parts
            .get(message)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    /// The user's own words: o2-ai's injected preamble parts are not part of them.
    fn user_text(&self, message: &str) -> String {
        let texts: Vec<(&str, bool)> = self
            .parts_of(message)
            .iter()
            .filter(|(_, p)| p["type"] == "text")
            .map(|(_, p)| {
                let injected = p["metadata"]["o2_injected"] == true;
                (p["text"].as_str().unwrap_or_default(), injected)
            })
            .collect();
        let tagged = texts.iter().any(|(_, injected)| *injected);
        let mut plain: Vec<&str> = texts
            .into_iter()
            .filter(|(_, injected)| !injected)
            .map(|(text, _)| text)
            .collect();
        if !tagged && plain.len() == 1 {
            plain[0] = strip_legacy_prefix(plain[0]);
        }
        plain
            .into_iter()
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
            .trim()
            .to_string()
    }

    fn assistant_text(&self, message: &str, text: &mut String) {
        for (_, part) in self.parts_of(message) {
            match part["type"].as_str() {
                Some("text") if part["synthetic"] != true && part["ignored"] != true => {
                    text.push_str(part["text"].as_str().unwrap_or_default());
                }
                Some("tool") => {
                    let name = part["tool"].as_str().unwrap_or("unknown");
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                    text.push_str(&format!("[tool {name}]\n"));
                }
                _ => {}
            }
        }
    }
}

/// CreateAiChatShare
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chats/{session_id}/shares",
    context_path = "/api",
    tag = "AI",
    operation_id = "CreateAiChatShare",
    summary = "Share an AI conversation",
    description = "Creates a share link for the caller's conversation: a snapshot of its \
                   history as of now, or a live view of it, for org members or (when public \
                   chat links are enabled) anyone holding the link. Tool inputs and outputs \
                   in the conversation are part of the share.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
    ),
    request_body(content = inline(CreateShareRequest), content_type = "application/json"),
    responses(
        (status = 201, description = "The new share", body = inline(ShareView)),
        (status = 400, description = "Invalid request or nothing to share", body = Object),
        (status = 404, description = "Unknown conversation", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let req: CreateShareRequest = match read_body(in_req).await {
        Ok(req) => req,
        Err(resp) => return resp,
    };
    let expires_in = match validate_create(&req, public_links_enabled()) {
        Ok(expires_in) => expires_in,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let chat = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(chat) if req.mode == MODE_SNAPSHOT => settled_chat(&chat, &owner).await,
        Ok(chat) => Ok(chat),
        Err(resp) => Err(resp),
    };
    let chat = match chat {
        Ok(chat) => chat,
        Err(resp) => return resp,
    };
    if chat.last_committed_seq == NO_SEQ {
        return MetaHttpResponse::bad_request(
            "A conversation with no stored messages cannot be shared",
        );
    }
    let now = now_micros();
    let new = NewShare {
        org_id: &org_id,
        session_id: &session_id,
        created_by: &owner,
        mode: &req.mode,
        snapshot_seq: (req.mode == MODE_SNAPSHOT).then_some(chat.last_committed_seq),
        visibility: &req.visibility,
        expires_at: expires_in.map(|secs| now + secs * 1_000_000),
    };
    match ai_chat_shares::insert(&new, now).await {
        Ok(share) => {
            count_op("create");
            (
                StatusCode::CREATED,
                Json(ShareView::new(share, &chat.title)),
            )
                .into_response()
        }
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot share {org_id}/{session_id}: {e}");
            unavailable()
        }
    }
}

/// ListAiChatShares
#[utoipa::path(
    get,
    path = "/{org_id}/ai/chats/{session_id}/shares",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiChatShares",
    summary = "List the active shares of an AI conversation",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
    ),
    responses(
        (status = 200, description = "Active shares", body = inline(ShareListResponse)),
        (status = 404, description = "Unknown conversation", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_for_chat(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let chat = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(chat) => chat,
        Err(resp) => return resp,
    };
    match ai_chat_shares::list_live_for_session(&org_id, &session_id, now_micros()).await {
        Ok(shares) => Json(ShareListResponse {
            shares: shares
                .into_iter()
                .filter(|s| s.created_by == owner)
                .map(|s| ShareView::new(s, &chat.title))
                .collect(),
        })
        .into_response(),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot list shares of {org_id}/{session_id}: {e}");
            unavailable()
        }
    }
}

/// ListMyAiChatShares
#[utoipa::path(
    get,
    path = "/{org_id}/ai/shares",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListMyAiChatShares",
    summary = "List the caller's active AI conversation shares",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Active shares", body = inline(ShareListResponse))),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_mine(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let shares = match ai_chat_shares::list_live_for_creator(&org_id, &owner, now_micros()).await {
        Ok(shares) => shares,
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot list shares of {org_id}/{owner}: {e}");
            return unavailable();
        }
    };
    let mut session_ids: Vec<String> = shares.iter().map(|s| s.session_id.clone()).collect();
    session_ids.sort();
    session_ids.dedup();
    let chats = match ai_chat_sessions::get_many(&org_id, &session_ids).await {
        Ok(chats) => chats,
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read shared chats of {org_id}/{owner}: {e}");
            return unavailable();
        }
    };
    let titles: std::collections::HashMap<String, String> = chats
        .into_iter()
        .filter(|c| c.status == STATUS_ACTIVE && c.user_id == owner)
        .map(|c| (c.session_id, c.title))
        .collect();
    Json(ShareListResponse {
        shares: shares
            .into_iter()
            .filter_map(|s| {
                let title = titles.get(&s.session_id)?.clone();
                Some(ShareView::new(s, &title))
            })
            .collect(),
    })
    .into_response()
}

/// UpdateAiChatShare
#[utoipa::path(
    patch,
    path = "/{org_id}/ai/shares/{share_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiChatShare",
    summary = "Change an AI conversation share",
    description = "Changes the mode or expiry of one of the caller's shares, or moves a \
                   snapshot share to the conversation's latest history.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("share_id" = String, Path, description = "Share ID"),
    ),
    request_body(content = inline(UpdateShareRequest), content_type = "application/json"),
    responses(
        (status = 200, description = "The updated share", body = inline(ShareView)),
        (status = 400, description = "Invalid request", body = Object),
        (status = 404, description = "Unknown share", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update(
    Path((org_id, share_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let req: UpdateShareRequest = match read_body(in_req).await {
        Ok(req) => req,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let now = now_micros();
    let Served { share, chat } = match owned_share(&org_id, &share_id, &owner, now).await {
        Ok(Some(served)) => served,
        Ok(None) => return not_found(),
        Err(resp) => return resp,
    };
    let chat = if moves_snapshot(&share, &req) {
        match settled_chat(&chat, &owner).await {
            Ok(chat) => chat,
            Err(resp) => return resp,
        }
    } else {
        chat
    };
    let settings = match apply_update(&share, &req, chat.last_committed_seq, now) {
        Ok(settings) => settings,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    match ai_chat_shares::update(&org_id, &share_id, &settings, now).await {
        Ok(true) => {}
        Ok(false) => return not_found(),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot update share {org_id}/{share_id}: {e}");
            return unavailable();
        }
    }
    count_op("update");
    match ai_chat_shares::get(&org_id, &share_id).await {
        Ok(Some(share)) => Json(ShareView::new(share, &chat.title)).into_response(),
        Ok(None) => not_found(),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read share {org_id}/{share_id}: {e}");
            unavailable()
        }
    }
}

/// RevokeAiChatShare
#[utoipa::path(
    delete,
    path = "/{org_id}/ai/shares/{share_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "RevokeAiChatShare",
    summary = "Revoke an AI conversation share",
    description = "Revokes a share at once for every reader. Allowed to its creator and to \
                   organization admins.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("share_id" = String, Path, description = "Share ID"),
    ),
    responses(
        (status = 200, description = "Revoked", body = Object),
        (status = 404, description = "Unknown share", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn revoke(
    Path((org_id, share_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let share = match ai_chat_shares::get(&org_id, &share_id).await {
        Ok(Some(share)) => share,
        Ok(None) => return not_found(),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read share {org_id}/{share_id}: {e}");
            return unavailable();
        }
    };
    if share.created_by != owner && !is_org_admin(&org_id, &user_email).await {
        return not_found();
    }
    match ai_chat_shares::revoke(&org_id, &share_id, now_micros()).await {
        Ok(true) => {
            count_op("revoke");
            MetaHttpResponse::json(serde_json::json!({"revoked": true}))
        }
        Ok(false) => not_found(),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot revoke share {org_id}/{share_id}: {e}");
            unavailable()
        }
    }
}

/// GetSharedAiChat
#[utoipa::path(
    get,
    path = "/{org_id}/ai/shared/{token}",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetSharedAiChat",
    summary = "Read a shared AI conversation",
    description = "The conversation behind a share link, cut at the share's sequence. With \
                   `known_seq` equal to it the body says `not_modified` and carries no turns.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Share token"),
        ("known_seq" = Option<i64>, Query, description = "Sequence of the caller's cached copy"),
    ),
    responses(
        (status = 200, description = "The shared conversation", body = inline(SharedChat)),
        (status = 404, description = "Unknown, revoked or expired share", body = Object),
        (status = 503, description = "History temporarily unreadable", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_shared(
    Path((org_id, token)): Path<(String, String)>,
    Query(params): Query<SharedChatParams>,
    in_req: axum::extract::Request,
) -> Response {
    if let Err(resp) = guard(&in_req) {
        return resp;
    }
    let served = match resolve(&token, Some(&org_id), false).await {
        Ok(Some(served)) => served,
        Ok(None) => return not_found(),
        Err(resp) => return resp,
    };
    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    read_shared(served, params.known_seq, Some(&auth), VISIBILITY_ORG).await
}

/// ForkSharedAiChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/shared/{token}/fork",
    context_path = "/api",
    tag = "AI",
    operation_id = "ForkSharedAiChat",
    summary = "Continue a shared AI conversation as your own",
    description = "Creates a new conversation owned by the caller. Nothing is copied now: its \
                   first turn carries the shared transcript as context.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Share token"),
    ),
    responses(
        (status = 201, description = "The new conversation", body = inline(ForkResponse)),
        (status = 403, description = "Not allowed to start conversations", body = Object),
        (status = 404, description = "Unknown, revoked or expired share", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn fork(
    Path((org_id, token)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    // The route grants reading the share; continuing it is a chat of the caller's own.
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email,
        "ai",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(resp) => return resp,
    };
    let Served { share, chat } = match resolve(&token, Some(&org_id), false).await {
        Ok(Some(served)) => served,
        Ok(None) => return not_found(),
        Err(resp) => return resp,
    };
    let title = fork_title(&chat.title);
    let session_id = uuid::Uuid::now_v7().to_string();
    let fork = NewFork {
        org_id: &org_id,
        session_id: &session_id,
        user_id: &owner,
        user_email: &user_email,
        agent_type: &chat.agent_type,
        title: &title,
        share_id: &share.id,
        seed_seq: ai_chat_shares::visible_seq(&share, chat.last_committed_seq),
    };
    match ai_chat_sessions::insert_fork(&fork, now_micros()).await {
        Ok(_) => {
            count_op("fork");
            (
                StatusCode::CREATED,
                Json(ForkResponse { session_id, title }),
            )
                .into_response()
        }
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot fork share {} into {org_id}/{session_id}: {e}",
                share.id
            );
            unavailable()
        }
    }
}

/// GET /api/public/ai_chats/{token}: a public share, without authentication.
pub async fn get_public(ip: Option<Extension<RealIp>>, Path(token): Path<String>) -> Response {
    let ip = ip.map(|e| e.0);
    if public_rate_limited(ip) {
        return with_public_headers(too_many_requests(PUBLIC_READ_WINDOW));
    }
    let Some(_slot) = enter(&PUBLIC_READ_GATE) else {
        return with_public_headers(too_many_requests(Duration::from_secs(1)));
    };
    log::info!(
        "[AI-CHAT-SHARE] public read of {}… from {}",
        token_prefix(&token),
        client_ip(ip)
    );
    if !public_links_enabled() || !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return with_public_headers(not_found());
    }
    let served = match resolve(&token, None, true).await {
        Ok(Some(served)) => served,
        Ok(None) => return with_public_headers(not_found()),
        Err(resp) => return with_public_headers(resp),
    };
    let resp = read_shared(served, None, None, VISIBILITY_PUBLIC).await;
    // Internal error details are for signed-in readers only.
    if resp.status().is_server_error() {
        return with_public_headers(unavailable());
    }
    with_public_headers(resp)
}

/// Revoke the shares of chats that were just deleted.
pub(super) async fn revoke_for_deleted(org_id: &str, session_ids: &[String], now: i64) {
    // Best effort: a share of a deleted chat is already inactive.
    if let Err(e) = ai_chat_shares::revoke_for_sessions(org_id, session_ids, now).await {
        log::error!("[AI-CHAT-SHARE] cannot revoke shares of deleted chats in {org_id}: {e}");
    }
}

/// The transcript a fork's first turn starts from, if this is one and its share is still live.
pub(super) async fn fork_seed(
    org_id: &str,
    session_id: Option<&str>,
    user_email: &str,
) -> Result<Option<Vec<Value>>, Response> {
    let Some(session_id) = session_id.filter(|s| is_uuid(s)) else {
        return Ok(None);
    };
    let row = match ai_chat_sessions::get(org_id, session_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return Ok(None),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read chat {org_id}/{session_id}: {e}");
            return Err(unavailable());
        }
    };
    let (Some(share_id), Some(seed_seq)) = (row.forked_from_share.as_deref(), row.fork_seed_seq)
    else {
        return Ok(None);
    };
    if row.last_committed_seq != NO_SEQ || row.status != STATUS_ACTIVE {
        return Ok(None);
    }
    // Admission refuses another user's chat; seeding it would only waste the read.
    if resolve_owner(user_email).await.ok().as_deref() != Some(row.user_id.as_str()) {
        return Ok(None);
    }
    let source = match seed_source(org_id, share_id).await {
        Ok(Some(source)) => source,
        Ok(None) => return Ok(None),
        Err(resp) => return Err(resp),
    };
    let mut cut = source;
    cut.last_committed_seq = cut.last_committed_seq.min(seed_seq);
    if cut.last_committed_seq == NO_SEQ {
        return Ok(None);
    }
    let events = match openobserve_core::ai_chat::read_committed_events(&cut, NO_SEQ).await {
        Ok(events) => events,
        // Logged by the reader; only an unreadable stream is worth a retry.
        Err(ReadError::Search(_)) => return Err(unavailable()),
        Err(_) => return Ok(None),
    };
    let seed = fit_seed(transcript(&events));
    Ok((!seed.is_empty()).then_some(seed))
}

/// The active chat a fork's share points at, while the share is live and the chat exists.
async fn seed_source(org_id: &str, share_id: &str) -> Result<Option<ChatModel>, Response> {
    let share = match ai_chat_shares::get(org_id, share_id).await {
        Ok(Some(share)) if ai_chat_shares::is_live(&share, now_micros()) => share,
        Ok(_) => return Ok(None),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read share {org_id}/{share_id}: {e}");
            return Err(unavailable());
        }
    };
    match ai_chat_sessions::get(org_id, &share.session_id).await {
        Ok(chat) => Ok(chat.filter(|c| c.status == STATUS_ACTIVE)),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot read chat {org_id}/{}: {e}",
                share.session_id
            );
            Err(unavailable())
        }
    }
}

/// The caller's email, once chat history is known to be on.
fn guard(in_req: &axum::extract::Request) -> Result<String, Response> {
    let Some(email) = user_email(in_req) else {
        return Err(MetaHttpResponse::unauthorized("Unauthorized"));
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Err(MetaHttpResponse::not_found("Chat history is not enabled"));
    }
    Ok(email)
}

async fn read_body<T: serde::de::DeserializeOwned>(
    in_req: axum::extract::Request,
) -> Result<T, Response> {
    let body = axum::body::to_bytes(in_req.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| MetaHttpResponse::bad_request("Request body too large"))?;
    serde_json::from_slice(&body)
        .map_err(|e| MetaHttpResponse::bad_request(format!("Invalid request body: {e}")))
}

/// The share with this token if it may be served on this route, with its chat.
async fn resolve(
    token: &str,
    org_id: Option<&str>,
    public_only: bool,
) -> Result<Option<Served>, Response> {
    if !ai_chat_shares::is_valid_token(token) {
        return Ok(None);
    }
    let share = match ai_chat_shares::get_by_token(token).await {
        Ok(Some(share)) => share,
        Ok(None) => return Ok(None),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot read share {}…: {e}",
                token_prefix(token)
            );
            return Err(unavailable());
        }
    };
    if !share_servable(&share, org_id, public_only, now_micros()) {
        return Ok(None);
    }
    if public_only && db::org_status::is_blocked(&share.org_id) {
        return Ok(None);
    }
    match ai_chat_sessions::get(&share.org_id, &share.session_id).await {
        Ok(Some(chat)) if chat_servable(&chat) => Ok(Some(Served { share, chat })),
        Ok(_) => Ok(None),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot read chat {}/{}: {e}",
                share.org_id,
                share.session_id
            );
            Err(unavailable())
        }
    }
}

/// One of the caller's own live shares, with its active chat.
async fn owned_share(
    org_id: &str,
    share_id: &str,
    owner: &str,
    now: i64,
) -> Result<Option<Served>, Response> {
    let share = match ai_chat_shares::get(org_id, share_id).await {
        Ok(Some(share)) if share.created_by == owner && ai_chat_shares::is_live(&share, now) => {
            share
        }
        Ok(_) => return Ok(None),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read share {org_id}/{share_id}: {e}");
            return Err(unavailable());
        }
    };
    match owned_chat(org_id, &share.session_id, owner).await {
        Ok(chat) => Ok(Some(Served { share, chat })),
        Err(_) => Ok(None),
    }
}

/// The owner's chat re-read while no turn runs in it, so a snapshot never cuts a turn in half.
async fn settled_chat(chat: &ChatModel, owner: &str) -> Result<ChatModel, Response> {
    let (org_id, session_id) = (&chat.org_id, &chat.session_id);
    let lease = match lease::acquire(org_id, session_id, 0).await {
        Ok(lease) => lease,
        Err(LeaseError::Busy) => return Err(MetaHttpResponse::conflict(TURN_RUNNING)),
        Err(LeaseError::Backend(e)) => {
            log::error!("[AI-CHAT-SHARE] turn lease unavailable for {org_id}/{session_id}: {e}");
            return Err(unavailable());
        }
    };
    let fresh = owned_chat(org_id, session_id, owner).await;
    lease.release().await;
    fresh
}

async fn read_shared(
    served: Served,
    known_seq: Option<i64>,
    auth: Option<&str>,
    route: &'static str,
) -> Response {
    let Served { share, chat } = served;
    let seq = ai_chat_shares::visible_seq(&share, chat.last_committed_seq);
    let mut body = SharedChat {
        title: chat.title.clone(),
        mode: share.mode.clone(),
        seq,
        created_at: chat.created_at,
        shared_at: share.created_at,
        owner_name: None,
        not_modified: known_seq == Some(seq),
        turns: None,
    };
    if !body.not_modified {
        let mut cut = chat.clone();
        cut.last_committed_seq = seq;
        body.turns = match load_turns(&cut, auth).await {
            Ok(turns) => Some(turns),
            Err(resp) => return resp,
        };
        let now = now_micros();
        if let Err(e) = ai_chat_shares::record_access(&share.id, now).await {
            log::warn!("[AI-CHAT-SHARE] cannot count a read of {}: {e}", share.id);
        }
        config::metrics::AI_CHAT_SHARE_READS_TOTAL
            .with_label_values(&[route])
            .inc();
    }
    body.owner_name = owner_name(&chat, route == VISIBILITY_PUBLIC).await;
    Json(body).into_response()
}

async fn owner_name(chat: &ChatModel, public: bool) -> Option<String> {
    let name = match infra::table::users::get_name_by_id(&chat.user_id).await {
        Ok(Some((first, last))) => display_name(&first, &last),
        Ok(None) => None,
        Err(e) => {
            log::warn!(
                "[AI-CHAT-SHARE] cannot read the name of {}: {e}",
                chat.user_id
            );
            None
        }
    };
    if public {
        name
    } else {
        name.or_else(|| Some(chat.user_email.clone()))
    }
}

async fn is_org_admin(org_id: &str, user_email: &str) -> bool {
    if db::user::is_root_user(user_email) {
        return true;
    }
    openobserve_core::users::get_user(Some(org_id), user_email)
        .await
        .is_some_and(|u| matches!(u.role, UserRole::Root | UserRole::Admin))
}

fn public_links_enabled() -> bool {
    config::get_config().public_ai_chat.enabled
}

fn public_rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = u32::try_from(config::get_config().public_ai_chat.rpm).unwrap_or(u32::MAX);
    // Unresolved clients would share one bucket any of them could exhaust; the gate bounds them.
    let Some(ip) = ip else {
        return false;
    };
    rpm != 0 && over_budget(&PUBLIC_READS, ip.0.to_string(), PUBLIC_READ_WINDOW, rpm)
}

fn enter(gate: &Semaphore) -> Option<SemaphorePermit<'_>> {
    gate.try_acquire().ok()
}

fn count_op(op: &str) {
    config::metrics::AI_CHAT_SHARE_OPS_TOTAL
        .with_label_values(&[op])
        .inc();
}

fn not_found() -> Response {
    MetaHttpResponse::not_found(NOT_FOUND)
}

fn unavailable() -> Response {
    MetaHttpResponse::service_unavailable("Shared chats are unavailable; please retry")
}

/// The token is a bearer secret, so no response is indexed or leaks it through `Referer`.
fn with_public_headers(mut resp: Response) -> Response {
    let headers = resp.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

fn token_prefix(token: &str) -> &str {
    token.get(..6).unwrap_or("")
}

fn url_path(share: &ShareModel) -> String {
    if share.visibility == VISIBILITY_PUBLIC {
        format!("/web/ai/public/{}", share.token)
    } else {
        format!(
            "/web/ai/shared/{}?org_identifier={}",
            share.token, share.org_id
        )
    }
}

/// The share's own conditions for being served on a route.
fn share_servable(share: &ShareModel, org_id: Option<&str>, public_only: bool, now: i64) -> bool {
    ai_chat_shares::is_live(share, now)
        && org_id.is_none_or(|org| org == share.org_id)
        && (!public_only || share.visibility == VISIBILITY_PUBLIC)
}

fn chat_servable(chat: &ChatModel) -> bool {
    chat.status == STATUS_ACTIVE && chat.last_committed_seq != NO_SEQ
}

/// The expiry (seconds from now) of a valid create request.
fn validate_create(
    req: &CreateShareRequest,
    public_enabled: bool,
) -> Result<Option<i64>, &'static str> {
    if req.mode != MODE_SNAPSHOT && req.mode != MODE_LIVE {
        return Err("mode must be \"snapshot\" or \"live\"");
    }
    if req.visibility != VISIBILITY_ORG && req.visibility != VISIBILITY_PUBLIC {
        return Err("visibility must be \"org\" or \"public\"");
    }
    if req.visibility == VISIBILITY_PUBLIC && !public_enabled {
        return Err("Public chat links are disabled on this deployment");
    }
    validate_expiry(req.expires_in_secs)?;
    Ok(req.expires_in_secs)
}

fn validate_expiry(expires_in_secs: Option<i64>) -> Result<(), &'static str> {
    match expires_in_secs {
        Some(secs) if !(MIN_EXPIRY_SECS..=MAX_EXPIRY_SECS).contains(&secs) => {
            Err("expires_in_secs must be between 60 seconds and 365 days")
        }
        _ => Ok(()),
    }
}

/// The settings a share has after `req`, given its chat's committed watermark.
fn apply_update(
    share: &ShareModel,
    req: &UpdateShareRequest,
    chat_seq: i64,
    now: i64,
) -> Result<ShareSettings, &'static str> {
    let mode = req.mode.clone().unwrap_or_else(|| share.mode.clone());
    if mode != MODE_SNAPSHOT && mode != MODE_LIVE {
        return Err("mode must be \"snapshot\" or \"live\"");
    }
    let expires_at = match req.expires_in_secs {
        Some(Some(secs)) => {
            validate_expiry(Some(secs))?;
            Some(now + secs * 1_000_000)
        }
        Some(None) => None,
        None => share.expires_at,
    };
    let snapshot_seq = if mode == MODE_LIVE {
        None
    } else if req.refresh_snapshot || share.mode != MODE_SNAPSHOT || share.snapshot_seq.is_none() {
        Some(chat_seq)
    } else {
        share.snapshot_seq
    };
    Ok(ShareSettings {
        mode,
        snapshot_seq,
        expires_at,
    })
}

/// Whether `req` points the share at the chat's current history.
fn moves_snapshot(share: &ShareModel, req: &UpdateShareRequest) -> bool {
    let mode = req.mode.as_deref().unwrap_or(&share.mode);
    mode == MODE_SNAPSHOT
        && (req.refresh_snapshot || share.mode != MODE_SNAPSHOT || share.snapshot_seq.is_none())
}

fn display_name(first: &str, last: &str) -> Option<String> {
    let name = format!("{} {}", first.trim(), last.trim());
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

fn fork_title(source: &str) -> String {
    let source = source.trim();
    let base = if source.is_empty() {
        FALLBACK_TITLE
    } else {
        source
    };
    let suffix = " (copy)";
    let keep = MAX_TITLE_CHARS - suffix.chars().count();
    let mut title: String = base.chars().take(keep).collect();
    title.push_str(suffix);
    title
}

/// A chat's stored events as `{role, content}` messages, tool calls as `[tool <name>]` notes.
fn transcript(events: &[DurableEvent]) -> Vec<Value> {
    let folded = Folded::new(events);
    let mut answers: HashMap<&str, Vec<&str>> = HashMap::new();
    for id in folded.messages_with_role("assistant") {
        if let Some(parent) = folded.infos[id]["parentID"].as_str() {
            answers.entry(parent).or_default().push(id);
        }
    }
    let mut messages = Vec::new();
    for id in folded.messages_with_role("user") {
        let user = folded.user_text(id);
        if !user.is_empty() {
            messages.push(serde_json::json!({"role": "user", "content": user}));
        }
        let mut assistant = String::new();
        for answer in answers.get(id).map(Vec::as_slice).unwrap_or_default() {
            folded.assistant_text(answer, &mut assistant);
        }
        let assistant = assistant.trim();
        if !assistant.is_empty() {
            messages.push(serde_json::json!({"role": "assistant", "content": assistant}));
        }
    }
    messages
}

/// A durable event type without opencode's version suffix (`message.updated.1`).
fn live_type(event_type: &str) -> &str {
    match event_type.rsplit_once('.') {
        Some((head, tail)) if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => event_type,
    }
}

/// Drops o2-ai's preamble from a prompt stored before it became a separate tagged part.
fn strip_legacy_prefix(text: &str) -> &str {
    let mut text = text;
    if text.starts_with(SEED_HEADER) {
        text = text
            .find(SEED_FENCE)
            .map_or("", |end| &text[end + SEED_FENCE.len()..]);
    }
    if text.starts_with(CONTEXT_HEADER) {
        text = text.find("\n\n").map_or("", |end| &text[end + 2..]);
    }
    text
}

/// The most recent messages that fit o2-ai's seed limits, oldest first.
fn fit_seed(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut budget = SEED_MAX_CHARS;
    let mut kept = Vec::new();
    for mut message in messages.into_iter().rev() {
        if kept.len() == SEED_MAX_MESSAGES {
            break;
        }
        let prefix = if message["role"] == "user" {
            "User: "
        } else {
            "Assistant: "
        };
        let content = message["content"].as_str().unwrap_or_default();
        let size = prefix.len() + content.chars().count();
        if size > budget {
            if kept.is_empty() && budget > prefix.len() + 1 {
                let keep = budget - prefix.len() - 1;
                let cut: String = content.chars().take(keep).collect();
                message["content"] = serde_json::Value::String(format!("{cut}…"));
                kept.push(message);
            }
            break;
        }
        budget -= size;
        kept.push(message);
    }
    kept.reverse();
    kept
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const ORG: &str = "org";

    fn share(mode: &str, visibility: &str) -> ShareModel {
        ShareModel {
            id: "share-1".into(),
            org_id: ORG.into(),
            session_id: "01234567-89ab-7def-8123-456789abcdef".into(),
            created_by: "owner".into(),
            token: ai_chat_shares::generate_token(),
            mode: mode.into(),
            snapshot_seq: (mode == MODE_SNAPSHOT).then_some(4),
            visibility: visibility.into(),
            expires_at: None,
            revoked_at: None,
            access_count: 0,
            last_accessed_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn create_req(mode: &str, visibility: &str, expires: Option<i64>) -> CreateShareRequest {
        CreateShareRequest {
            mode: mode.into(),
            visibility: visibility.into(),
            expires_in_secs: expires,
        }
    }

    #[test]
    fn create_requests_are_validated() {
        assert_eq!(
            validate_create(&create_req(MODE_LIVE, VISIBILITY_ORG, None), false),
            Ok(None)
        );
        assert_eq!(
            validate_create(
                &create_req(MODE_SNAPSHOT, VISIBILITY_PUBLIC, Some(60)),
                true
            ),
            Ok(Some(60))
        );
        for bad in [
            create_req("frozen", VISIBILITY_ORG, None),
            create_req(MODE_LIVE, "team", None),
            create_req(MODE_LIVE, VISIBILITY_ORG, Some(59)),
            create_req(MODE_LIVE, VISIBILITY_ORG, Some(MAX_EXPIRY_SECS + 1)),
        ] {
            assert!(validate_create(&bad, true).is_err(), "{bad:?}");
        }
        assert!(validate_create(&create_req(MODE_LIVE, VISIBILITY_PUBLIC, None), false).is_err());
    }

    #[test]
    fn updates_move_the_snapshot_only_when_asked_or_switching() {
        let snap = share(MODE_SNAPSHOT, VISIBILITY_ORG);
        let keep = apply_update(&snap, &UpdateShareRequest::default(), 9, 0).unwrap();
        assert_eq!(keep.snapshot_seq, Some(4));
        let refresh = UpdateShareRequest {
            refresh_snapshot: true,
            ..Default::default()
        };
        assert_eq!(
            apply_update(&snap, &refresh, 9, 0).unwrap().snapshot_seq,
            Some(9)
        );
        let to_live = UpdateShareRequest {
            mode: Some(MODE_LIVE.into()),
            ..Default::default()
        };
        assert_eq!(
            apply_update(&snap, &to_live, 9, 0).unwrap().snapshot_seq,
            None
        );
        let to_snapshot = UpdateShareRequest {
            mode: Some(MODE_SNAPSHOT.into()),
            ..Default::default()
        };
        let live = share(MODE_LIVE, VISIBILITY_ORG);
        assert_eq!(
            apply_update(&live, &to_snapshot, 9, 0)
                .unwrap()
                .snapshot_seq,
            Some(9)
        );
        let bad_mode = UpdateShareRequest {
            mode: Some("x".into()),
            ..Default::default()
        };
        assert!(apply_update(&live, &bad_mode, 9, 0).is_err());
    }

    #[test]
    fn expiry_can_be_set_kept_or_cleared() {
        let mut s = share(MODE_LIVE, VISIBILITY_ORG);
        s.expires_at = Some(500);
        let parse = |body: &str| serde_json::from_str::<UpdateShareRequest>(body).unwrap();
        let kept = apply_update(&s, &parse("{}"), 9, 1_000_000).unwrap();
        assert_eq!(kept.expires_at, Some(500));
        let cleared = apply_update(&s, &parse(r#"{"expires_in_secs":null}"#), 9, 0).unwrap();
        assert_eq!(cleared.expires_at, None);
        let set = apply_update(&s, &parse(r#"{"expires_in_secs":60}"#), 9, 1_000_000).unwrap();
        assert_eq!(set.expires_at, Some(61_000_000));
        assert!(apply_update(&s, &parse(r#"{"expires_in_secs":1}"#), 9, 0).is_err());
    }

    #[test]
    fn every_unservable_share_is_refused_alike() {
        let now = 100;
        let ok = share(MODE_LIVE, VISIBILITY_PUBLIC);
        assert!(share_servable(&ok, Some(ORG), false, now));
        assert!(share_servable(&ok, None, true, now));

        let mut revoked = ok.clone();
        revoked.revoked_at = Some(50);
        let mut expired = ok.clone();
        expired.expires_at = Some(now);
        let org_only = share(MODE_LIVE, VISIBILITY_ORG);
        assert!(!share_servable(&revoked, Some(ORG), false, now));
        assert!(!share_servable(&expired, Some(ORG), false, now));
        assert!(!share_servable(&ok, Some("other-org"), false, now));
        assert!(!share_servable(&org_only, None, true, now));
        assert!(share_servable(&org_only, Some(ORG), false, now));
    }

    #[tokio::test]
    async fn the_not_found_answer_is_one_body() {
        let a = axum::body::to_bytes(not_found().into_body(), 1024)
            .await
            .unwrap();
        let b = axum::body::to_bytes(with_public_headers(not_found()).into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(a, b);
        let resp = with_public_headers(not_found());
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(resp.headers()[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(resp.headers()["x-robots-tag"], "noindex, nofollow");
    }

    #[test]
    fn url_paths_and_names() {
        let org = share(MODE_LIVE, VISIBILITY_ORG);
        assert_eq!(
            url_path(&org),
            format!("/web/ai/shared/{}?org_identifier=org", org.token)
        );
        let public = share(MODE_LIVE, VISIBILITY_PUBLIC);
        assert_eq!(
            url_path(&public),
            format!("/web/ai/public/{}", public.token)
        );
        assert_eq!(token_prefix("abcdefghij"), "abcdef");
        assert_eq!(token_prefix("abc"), "");
        assert_eq!(display_name(" Ada ", ""), Some("Ada".into()));
        assert_eq!(display_name("", " "), None);
        assert_eq!(fork_title(""), "Shared chat (copy)");
        let long = fork_title(&"x".repeat(500));
        assert_eq!(long.chars().count(), MAX_TITLE_CHARS);
        assert!(long.ends_with(" (copy)"));
    }

    fn event(seq: i64, event_type: &str, data: Value) -> DurableEvent {
        DurableEvent {
            id: format!("evt_{seq}"),
            aggregate_id: "ses_test".into(),
            seq,
            event_type: event_type.into(),
            data,
        }
    }

    fn message(seq: i64, id: &str, role: &str, parent: Option<&str>) -> DurableEvent {
        let mut info = json!({"id": id, "role": role});
        if let Some(parent) = parent {
            info["parentID"] = json!(parent);
        }
        event(seq, "message.updated.1", json!({ "info": info }))
    }

    fn part(seq: i64, message: &str, part: Value) -> DurableEvent {
        let mut part = part;
        part["messageID"] = json!(message);
        event(seq, "message.part.updated.1", json!({ "part": part }))
    }

    #[test]
    fn transcripts_are_built_from_stored_events() {
        let events = vec![
            message(0, "msg_u1", "user", None),
            part(
                1,
                "msg_u1",
                json!({"id": "p0", "type": "text", "text": "[Context]\nstream: x", "metadata": {"o2_injected": true}}),
            ),
            part(
                2,
                "msg_u1",
                json!({"id": "p1", "type": "text", "text": " why is p99 up? "}),
            ),
            message(3, "msg_a1", "assistant", Some("msg_u1")),
            part(
                4,
                "msg_a1",
                json!({"id": "p2", "type": "text", "text": "Because "}),
            ),
            part(
                5,
                "msg_a1",
                json!({"id": "p3", "type": "tool", "tool": "SearchSQL", "state": {"status": "running"}}),
            ),
            part(
                6,
                "msg_a1",
                json!({"id": "p3", "type": "tool", "tool": "SearchSQL", "state": {"status": "completed", "output": "rows"}}),
            ),
            part(
                7,
                "msg_a1",
                json!({"id": "p2", "type": "text", "text": "Because of GC."}),
            ),
            part(
                8,
                "msg_a1",
                json!({"id": "p4", "type": "text", "text": "hidden", "synthetic": true}),
            ),
            part(
                9,
                "msg_a1",
                json!({"id": "p5", "type": "reasoning", "text": "thinking"}),
            ),
            message(10, "msg_u2", "user", None),
            part(
                11,
                "msg_u2",
                json!({"id": "p6", "type": "text", "text": "and now?"}),
            ),
            part(
                12,
                "msg_u2",
                json!({"id": "p7", "type": "text", "text": "gone"}),
            ),
            event(
                13,
                "message.part.removed.1",
                json!({"messageID": "msg_u2", "partID": "p7"}),
            ),
            message(14, "msg_x", "assistant", Some("msg_u2")),
            event(15, "message.removed.1", json!({"messageID": "msg_x"})),
        ];
        assert_eq!(
            transcript(&events),
            vec![
                json!({"role": "user", "content": "why is p99 up?"}),
                json!({"role": "assistant", "content": "Because of GC.\n[tool SearchSQL]"}),
                json!({"role": "user", "content": "and now?"}),
            ]
        );
    }

    #[test]
    fn legacy_prompts_lose_the_restored_seed_and_context_preamble() {
        assert_eq!(
            strip_legacy_prefix(
                "[Restored conversation]\nUser: hi\n---\n\n[Context]\na: b\n\nreal"
            ),
            "real"
        );
        assert_eq!(strip_legacy_prefix("[Context]\na: b\n\nreal"), "real");
        assert_eq!(strip_legacy_prefix("plain question"), "plain question");
        assert_eq!(live_type("message.part.updated.1"), "message.part.updated");
        assert_eq!(live_type("session.updated"), "session.updated");
    }

    #[test]
    fn share_requests_reject_unknown_fields() {
        assert!(serde_json::from_str::<UpdateShareRequest>(r#"{"refresh":true}"#).is_err());
        assert!(serde_json::from_str::<UpdateShareRequest>(r#"{"refresh_snapshot":true}"#).is_ok());
        let create = r#"{"mode":"live","visibility":"org","public":true}"#;
        assert!(serde_json::from_str::<CreateShareRequest>(create).is_err());
    }

    #[test]
    fn only_requests_that_move_a_snapshot_need_a_settled_chat() {
        let snap = share(MODE_SNAPSHOT, VISIBILITY_ORG);
        let live = share(MODE_LIVE, VISIBILITY_ORG);
        let req = |mode: Option<&str>, refresh: bool| UpdateShareRequest {
            mode: mode.map(str::to_string),
            refresh_snapshot: refresh,
            ..Default::default()
        };
        assert!(!moves_snapshot(&snap, &req(None, false)));
        assert!(moves_snapshot(&snap, &req(None, true)));
        assert!(!moves_snapshot(&snap, &req(Some(MODE_LIVE), true)));
        assert!(!moves_snapshot(&live, &req(None, false)));
        assert!(moves_snapshot(&live, &req(Some(MODE_SNAPSHOT), false)));
    }

    #[test]
    fn public_reads_are_limited_per_ip_and_by_a_global_gate() {
        assert!(!public_rate_limited(None));
        let gate = Semaphore::new(1);
        let first = enter(&gate);
        assert!(first.is_some());
        assert!(enter(&gate).is_none());
        drop(first);
        assert!(enter(&gate).is_some());
    }

    #[test]
    fn seeds_keep_the_most_recent_messages_within_o2_ai_limits() {
        let many: Vec<_> = (0..SEED_MAX_MESSAGES + 10)
            .map(|i| json!({"role": "user", "content": format!("m{i}")}))
            .collect();
        let fitted = fit_seed(many);
        assert_eq!(fitted.len(), SEED_MAX_MESSAGES);
        assert_eq!(fitted[0]["content"], "m10");
        assert_eq!(
            fitted.last().unwrap()["content"],
            format!("m{}", SEED_MAX_MESSAGES + 9)
        );

        let big = "y".repeat(SEED_MAX_CHARS / 2);
        let fitted = fit_seed(vec![
            json!({"role": "user", "content": "oldest"}),
            json!({"role": "assistant", "content": big.clone()}),
            json!({"role": "user", "content": big.clone()}),
        ]);
        assert_eq!(fitted.len(), 1);
        let total: usize = fitted
            .iter()
            .map(|m| m["content"].as_str().unwrap().chars().count() + 11)
            .sum();
        assert!(total <= SEED_MAX_CHARS);

        let huge = fit_seed(vec![
            json!({"role": "user", "content": "z".repeat(SEED_MAX_CHARS * 2)}),
        ]);
        assert_eq!(huge.len(), 1);
        assert!(huge[0]["content"].as_str().unwrap().chars().count() <= SEED_MAX_CHARS);
    }
}

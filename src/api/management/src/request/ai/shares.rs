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
    sync::{Arc, LazyLock, Mutex, Once},
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::{Extension, Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    axum::middlewares::RealIp,
    meta::user::UserRole,
    utils::{
        hash::{Sum64, fnv},
        time::now_micros,
    },
};
use infra::table::{
    ai_chat_imports,
    ai_chat_sessions::{self, Model as ChatModel, NO_SEQ, NewFork, STATUS_ACTIVE},
    ai_chat_shares::{
        self, MODE_LIVE, MODE_SNAPSHOT, Model as ShareModel, NewShare, ShareSettings,
        VISIBILITY_ORG, VISIBILITY_PUBLIC,
    },
    ai_chat_turns::{self, Model as TurnRecord, TURN_INTERRUPTED, TURN_RUNNING},
};
use o2_enterprise::enterprise::ai::chat::{
    batcher::DurableEvent,
    lease::{self, LeaseError},
};
use openobserve_core::ai_chat::{
    ReadError,
    admission::{normalize_uuid, resolve_owner},
    projection,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tokio::sync::{Semaphore, SemaphorePermit};
use utoipa::ToSchema;

use super::{
    chats::{
        MAX_TITLE_CHARS, admit_error_response, attach_turn_status_at, history_not_enabled,
        load_turns, owned_chat, running_since, user_email,
    },
    error::{self, AiErrorCode, AiErrorEnvelope},
};
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::public_rate_limit::{Counters, client_ip},
    service::auth::check_permissions,
};

const NOT_FOUND: &str = "Shared chat not found";
const MIN_EXPIRY_SECS: i64 = 60;
const MAX_EXPIRY_SECS: i64 = 365 * DAY_SECS;
const DAY_SECS: i64 = 24 * 60 * 60;
const MAX_BODY_BYTES: usize = 16 * 1024;
const PUBLIC_READ_WINDOW: Duration = Duration::from_secs(60);
const PUBLIC_READ_SLOTS: usize = 8;
const PROJECTION_SLOTS: usize = 16;
const PROJECTION_WAIT: Duration = Duration::from_secs(5);
// Above this a shared read keeps only the newest turns and says `truncated`.
const SHARED_TURNS_MAX_BYTES: usize = 16 * 1024 * 1024;
const PUBLIC_TURNS_TTL: Duration = Duration::from_secs(60);
const PUBLIC_TURNS_MAX_ENTRIES: usize = 256;
const PUBLIC_TURNS_MAX_BYTES: usize = 64 * 1024 * 1024;
const ACCESS_FLUSH_EVERY: Duration = Duration::from_secs(60);
const ACCESS_MAX_PENDING: usize = 8192;
// o2-ai refuses a longer seed with 413 instead of truncating it.
const SEED_MAX_MESSAGES: usize = 200;
const SEED_MAX_CHARS: usize = 200_000;
const FALLBACK_TITLE: &str = "Shared chat";
const TURN_IN_PROGRESS: &str = "A response is still being generated; share again when it finishes";
const SEED_HEADER: &str = "[Restored conversation]\n";
const SEED_FENCE: &str = "\n---\n\n";
const CONTEXT_HEADER: &str = "[Context]\n";
const FORK_SUFFIX: &str = "continued";
// A fork stores the newest shared turns that fit; the model still sees at most `SEED_MAX_CHARS`.
const SEED_MAX_BYTES: usize = 2 * 1024 * 1024;
const STREAM_FORBIDDEN: &str = "stream_forbidden";
const IMPORTED_CHAT: &str = "imported_chat";
// Permission checks per read; steps on streams past this many are hidden unchecked.
const MAX_STREAM_CHECKS: usize = 32;

static PUBLIC_READS: LazyLock<Counters> = LazyLock::new(Counters::default);
// Reads that resolve no client address still cannot pile up without bound.
static PUBLIC_READ_GATE: Semaphore = Semaphore::const_new(PUBLIC_READ_SLOTS);
static PROJECTION_GATE: Semaphore = Semaphore::const_new(PROJECTION_SLOTS);
static PUBLIC_TURNS: LazyLock<TurnCache> = LazyLock::new(|| TurnCache::new(PUBLIC_TURNS_TTL));
static PENDING_READS: LazyLock<ReadCounter> =
    LazyLock::new(|| ReadCounter::new(ACCESS_FLUSH_EVERY));
static READ_FLUSHER: Once = Once::new();

/// A share as its owner sees it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ShareView {
    pub id: String,
    /// Bearer secret of the link; absent on other creators' rows of the org-wide listing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Path of the web page that shows the share; absent whenever `token` is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_path: Option<String>,
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
    /// Readers see assistant text and tool names, never tool inputs or outputs.
    pub redact_tools: bool,
    /// Readers see `[Attached {kind} hidden]` for attachment blocks and no images.
    pub hide_attachments: bool,
    /// The creator's display name (email when unnamed); only in the org-wide admin listing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    /// The creator's email; only in the org-wide admin listing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_email: Option<String>,
}

impl ShareView {
    fn new(share: ShareModel, title: &str) -> Self {
        Self {
            url_path: Some(url_path(&share)),
            redact_tools: share.redact_tools,
            hide_attachments: share.hide_attachments,
            owner_name: None,
            owner_email: None,
            id: share.id,
            token: Some(share.token),
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
    /// 60 s to 365 days, absent = never; public shares need one within the public maximum.
    pub expires_in_secs: Option<i64>,
    /// Hide tool inputs and outputs from readers; defaults to true for public shares.
    pub redact_tools: Option<bool>,
    /// Replace attachment blocks and drop images for readers; defaults to true for public shares.
    pub hide_attachments: Option<bool>,
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
    pub redact_tools: Option<bool>,
    pub hide_attachments: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ListSharesParams {
    /// Every active share in the org instead of the caller's own; org admins only.
    #[serde(default)]
    pub all: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct SharedChatParams {
    /// The `seq` of the caller's cached copy.
    pub known_seq: Option<i64>,
    /// The `state_version` of the caller's cached copy.
    pub known_version: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SharedChat {
    pub title: String,
    pub mode: String,
    /// Last committed event the share shows; pass back as `known_seq`.
    pub seq: i64,
    /// Changes with `seq`, turn statuses and share settings; send back as `known_version`.
    pub state_version: String,
    /// A turn of a live share is running; poll until it is false.
    pub active_turn: bool,
    /// When the chat was started (micros).
    pub created_at: i64,
    /// When the share was created (micros).
    pub shared_at: i64,
    /// The owner's display name; never their email on a public link.
    pub owner_name: Option<String>,
    /// True when `known_seq` and `known_version` are current; `turns` is then omitted.
    pub not_modified: bool,
    /// Tool inputs and outputs are left out of `turns`.
    pub redact_tools: bool,
    /// Attachment blocks read `[Attached {kind} hidden]` and images are left out of `turns`.
    pub hide_attachments: bool,
    /// The owner's organization, where a signed-in reader continues the chat.
    pub org_identifier: String,
    /// `{call_id: {reason, stream}}` of steps hidden from this reader; redacted links name none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub hidden: Option<serde_json::Map<String, Value>>,
    /// The oldest turns were left out to keep the response within the server's size cap.
    pub truncated: bool,
    /// Same shape as `GET /ai/chats/{session_id}` returns, without `user_message_id`.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "shared_turns_ser"
    )]
    #[schema(value_type = Option<Vec<Object>>)]
    pub turns: Option<Arc<Vec<Value>>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ForkResponse {
    pub session_id: String,
    pub title: String,
    /// `{owner_name, as_of, turns}`: the shared turns as this reader saw them, kept with the fork.
    #[schema(value_type = Object)]
    pub seed: Value,
}

/// A share that may be served, with its chat.
struct Served {
    share: ShareModel,
    chat: ChatModel,
}

/// Who reads a share: a signed-in member (`viewer`, with their `auth`), or anyone (public).
#[derive(Debug, Default, Clone, Copy)]
struct Reader<'a> {
    auth: Option<&'a str>,
    viewer: Option<&'a str>,
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

/// Projected turns of public reads per (share, state version), so a busy link is not re-projected.
struct TurnCache {
    ttl: Duration,
    entries: Mutex<HashMap<TurnKey, CachedTurns>>,
}

impl TurnCache {
    fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, key: &TurnKey, now: Instant) -> Option<Shown> {
        let entries = self.entries.lock().ok()?;
        entries
            .get(key)
            .filter(|cached| now.duration_since(cached.at) < self.ttl)
            .map(|cached| cached.shown.clone())
    }

    fn put(&self, key: TurnKey, shown: Shown, now: Instant) {
        let bytes = serde_json::to_vec(shown.0.as_ref()).map_or(usize::MAX, |b| b.len());
        // One huge chat must not evict every other link's entry.
        if bytes > PUBLIC_TURNS_MAX_BYTES / 4 {
            return;
        }
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|_, cached| now.duration_since(cached.at) < self.ttl);
        let mut total: usize = entries.values().map(|cached| cached.bytes).sum();
        while !entries.is_empty()
            && (entries.len() >= PUBLIC_TURNS_MAX_ENTRIES || total + bytes > PUBLIC_TURNS_MAX_BYTES)
        {
            let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, cached)| cached.at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some(evicted) = entries.remove(&oldest) {
                total -= evicted.bytes;
            }
        }
        entries.insert(
            key,
            CachedTurns {
                at: now,
                bytes,
                shown,
            },
        );
    }
}

/// `(share id, state version)`.
type TurnKey = (String, String);
/// The turns a reader is shown, whether the oldest were cut for size, and the steps hidden.
type Shown = (Arc<Vec<Value>>, bool, Arc<serde_json::Map<String, Value>>);

struct CachedTurns {
    at: Instant,
    bytes: usize,
    shown: Shown,
}

/// Reads not yet in `access_count`; a share's first is written at once, the rest by the flush.
struct ReadCounter {
    every: Duration,
    /// Per share: reads not yet written, and when it was last written.
    pending: Mutex<HashMap<String, (i64, Instant)>>,
}

impl ReadCounter {
    fn new(every: Duration) -> Self {
        Self {
            every,
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Counts one read; returns how many reads to write now, if any.
    fn hit(&self, share_id: &str, now: Instant) -> Option<i64> {
        let Ok(mut pending) = self.pending.lock() else {
            return Some(1);
        };
        if let Some((reads, _)) = pending.get_mut(share_id) {
            *reads += 1;
            return None;
        }
        if pending.len() >= ACCESS_MAX_PENDING {
            return Some(1);
        }
        pending.insert(share_id.to_string(), (0, now));
        Some(1)
    }

    /// Takes every share's unwritten reads and forgets shares idle for a whole interval.
    fn drain(&self, now: Instant) -> Vec<(String, i64)> {
        let Ok(mut pending) = self.pending.lock() else {
            return Vec::new();
        };
        let every = self.every;
        pending.retain(|_, (reads, at)| *reads > 0 || now.duration_since(*at) < every);
        pending
            .iter_mut()
            .filter(|(_, (reads, _))| *reads > 0)
            .map(|(id, (reads, at))| {
                *at = now;
                (id.clone(), std::mem::take(reads))
            })
            .collect()
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
                   are part of the share unless `redact_tools` is set, which is the default \
                   for public links. Public links must expire.",
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
        (status = 415, description = "The body is not JSON", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req).and_then(|email| require_json(&in_req).map(|_| email)) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let req: CreateShareRequest = match read_body(in_req).await {
        Ok(req) => req,
        Err(resp) => return resp,
    };
    let expires_in = match validate_create(&req, public_links_enabled(), public_max_expiry_secs()) {
        Ok(expires_in) => expires_in,
        Err(msg) => return error::invalid_request(msg),
    };
    let public = req.visibility == VISIBILITY_PUBLIC;
    if !super::settings::sharing_allowed(&org_id, public).await {
        return error::permission_denied(
            "Sharing chats this way is turned off for this organization",
        );
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
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
        return error::invalid_request("A conversation with no stored messages cannot be shared");
    }
    // A share reads the stored events, which hold none of the imported turns.
    match ai_chat_imports::is_imported(&org_id, &chat.session_id).await {
        Ok(false) => {}
        Ok(true) => {
            return AiErrorEnvelope::new(
                AiErrorCode::InvalidRequest,
                "A conversation moved from this browser cannot be shared",
            )
            .with("reason", IMPORTED_CHAT)
            .into_response();
        }
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read the import of {org_id}/{session_id}: {e}");
            return unavailable();
        }
    }
    let now = now_micros();
    let new = NewShare {
        org_id: &org_id,
        session_id: &chat.session_id,
        created_by: &owner,
        mode: &req.mode,
        snapshot_seq: (req.mode == MODE_SNAPSHOT).then_some(chat.last_committed_seq),
        visibility: &req.visibility,
        expires_at: expires_in.map(|secs| now + secs * 1_000_000),
        redact_tools: hiding_of(&req).0,
        hide_attachments: hiding_of(&req).1,
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
        Err(e) => return admit_error_response(e),
    };
    let chat = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(chat) => chat,
        Err(resp) => return resp,
    };
    match ai_chat_shares::list_live_for_session(&org_id, &chat.session_id, now_micros()).await {
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
    description = "The caller's active shares across their conversations; with `all=true`, \
                   every active share in the organization, for organization admins only.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("all" = Option<bool>, Query, description = "List every active share in the org (admins)"),
    ),
    responses(
        (status = 200, description = "Active shares", body = inline(ShareListResponse)),
        (status = 403, description = "`all=true` from a non-admin", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_mine(
    Path(org_id): Path<String>,
    Query(params): Query<ListSharesParams>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let now = now_micros();
    let (shares, scope, caller) = if params.all {
        if !is_org_admin(&org_id, &user_email).await {
            return error::permission_denied("Only organization admins can list every share");
        }
        let shares = ai_chat_shares::list_live_for_org(&org_id, now).await;
        (
            shares,
            org_id.clone(),
            resolve_owner(&user_email).await.ok(),
        )
    } else {
        let owner = match resolve_owner(&user_email).await {
            Ok(owner) => owner,
            Err(e) => return admit_error_response(e),
        };
        let shares = ai_chat_shares::list_live_for_creator(&org_id, &owner, now).await;
        (shares, format!("{org_id}/{owner}"), Some(owner))
    };
    let shares = match shares {
        Ok(shares) => shares,
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot list shares of {scope}: {e}");
            return unavailable();
        }
    };
    match share_views(&org_id, shares, params.all, caller.as_deref()).await {
        Ok(shares) => Json(ShareListResponse { shares }).into_response(),
        Err(resp) => resp,
    }
}

/// UpdateAiChatShare
#[utoipa::path(
    patch,
    path = "/{org_id}/ai/shares/{share_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiChatShare",
    summary = "Change an AI conversation share",
    description = "Changes the mode, expiry or tool redaction of one of the caller's shares, \
                   or moves a snapshot share to the conversation's latest history.",
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
        (status = 415, description = "The body is not JSON", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn update(
    Path((org_id, share_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req).and_then(|email| require_json(&in_req).map(|_| email)) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let req: UpdateShareRequest = match read_body(in_req).await {
        Ok(req) => req,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
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
    let settings = match apply_update(
        &share,
        &req,
        chat.last_committed_seq,
        now,
        public_max_expiry_secs(),
    ) {
        Ok(settings) => settings,
        Err(msg) => return error::invalid_request(msg),
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
        Err(e) => return admit_error_response(e),
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
                   `known_seq` and `known_version` equal to the current `seq` and \
                   `state_version` the body says `not_modified` and carries no turns.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Share token"),
        ("known_seq" = Option<i64>, Query, description = "Sequence of the caller's cached copy"),
        ("known_version" = Option<String>, Query, description = "`state_version` of the cached copy"),
    ),
    responses(
        (status = 200, description = "The shared conversation", body = inline(SharedChat)),
        (status = 404, description = "Unknown, revoked or expired share", body = Object),
        (status = 429, description = "Too many shared reads in flight; retry", body = Object),
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
    // A link made before the org turned sharing off stops working with it.
    if !super::settings::sharing_allowed(&org_id, served.share.visibility == VISIBILITY_PUBLIC)
        .await
    {
        return not_found();
    }
    let viewer = user_email(&in_req);
    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    let reader = Reader {
        auth: Some(&auth),
        viewer: viewer.as_deref(),
    };
    read_shared(served, &params, reader, VISIBILITY_ORG).await
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
                   first turn carries the shared transcript as context. Send `{}` as JSON.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Share token"),
    ),
    responses(
        (status = 201, description = "The new conversation", body = inline(ForkResponse)),
        (status = 403, description = "Not allowed to start conversations", body = Object),
        (status = 404, description = "Unknown, revoked or expired share", body = Object),
        (status = 415, description = "The body is not JSON", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn fork(
    Path((org_id, token)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req).and_then(|email| require_json(&in_req).map(|_| email)) {
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
        return error::permission_denied("Unauthorized Access");
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let Served { share, chat } = match resolve(&token, Some(&org_id), false).await {
        Ok(Some(served)) => served,
        Ok(None) => return not_found(),
        Err(resp) => return resp,
    };
    let (parts, _) = in_req.into_parts();
    let auth = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
    let reader = Reader {
        auth: Some(&auth),
        viewer: Some(&user_email),
    };
    let seed = match fork_seed_of(&share, &chat, reader).await {
        Ok(seed) => seed,
        Err(resp) => return resp,
    };
    let earlier = ai_chat_sessions::count_forks(&org_id, &owner, &share.id)
        .await
        .unwrap_or_else(|e| {
            // Only the title's number depends on it.
            log::warn!(
                "[AI-CHAT-SHARE] cannot count forks of share {}: {e}",
                share.id
            );
            0
        });
    let title = fork_title(&chat.title, earlier);
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
        seed: Some(&seed),
    };
    match ai_chat_sessions::insert_fork(&fork, now_micros()).await {
        Ok(_) => {
            count_op("fork");
            (
                StatusCode::CREATED,
                Json(ForkResponse {
                    session_id,
                    title,
                    seed,
                }),
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
pub async fn get_public(
    ip: Option<Extension<RealIp>>,
    Path(token): Path<String>,
    Query(params): Query<SharedChatParams>,
) -> Response {
    let ip = ip.map(|e| e.0);
    if public_rate_limited(ip) {
        return with_public_headers(rate_limited(PUBLIC_READ_WINDOW));
    }
    // Only clients outside the per-IP limit share the node-wide gate (design: public links).
    let _slot = match ip {
        Some(_) => None,
        None => match enter(&PUBLIC_READ_GATE) {
            Some(slot) => Some(slot),
            None => return with_public_headers(rate_limited(Duration::from_secs(1))),
        },
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
    if !super::settings::sharing_allowed(&served.share.org_id, true).await {
        return with_public_headers(not_found());
    }
    let resp = read_shared(served, &params, Reader::default(), VISIBILITY_PUBLIC).await;
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

/// The transcript a chat's first turn starts from: a fork's shared turns or an import's turns.
pub(super) async fn first_turn_seed(
    org_id: &str,
    session_id: Option<&str>,
    user_email: &str,
) -> Result<Option<Vec<Value>>, Response> {
    let Some(session_id) = session_id.and_then(normalize_uuid) else {
        return Ok(None);
    };
    let row = match ai_chat_sessions::get(org_id, &session_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return Ok(None),
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read chat {org_id}/{session_id}: {e}");
            return Err(unavailable());
        }
    };
    if row.last_committed_seq != NO_SEQ || row.status != STATUS_ACTIVE {
        return Ok(None);
    }
    // Admission refuses another user's chat; seeding it would only waste the read.
    if resolve_owner(user_email).await.ok().as_deref() != Some(row.user_id.as_str()) {
        return Ok(None);
    }
    // Copied at fork or import time, so a revoked or expired share never empties the chat.
    if let Some(turns) = stored_seed(&row) {
        let seed = fit_seed(seed_messages(&turns));
        return Ok((!seed.is_empty()).then_some(seed));
    }
    let (Some(share_id), Some(seed_seq)) = (row.forked_from_share.as_deref(), row.fork_seed_seq)
    else {
        let read = ai_chat_imports::turns_for_session(org_id, &row.session_id).await;
        return Ok(import_seed(read, &row.session_id));
    };
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

/// What a turn version is answered from: carried turns, then the chat before `before_seq`.
pub(super) async fn history_before(
    row: &ChatModel,
    before_seq: i64,
) -> Result<(Vec<Value>, bool), Response> {
    let carried = carried_seed(row).await?;
    let mut cut = row.clone();
    cut.last_committed_seq = cut.last_committed_seq.min(before_seq - 1);
    let own = if cut.last_committed_seq <= NO_SEQ {
        Vec::new()
    } else {
        match openobserve_core::ai_chat::read_committed_events(&cut, NO_SEQ).await {
            Ok(events) => transcript_before(&events, before_seq),
            Err(e) => {
                log::warn!(
                    "[AI-CHAT] cannot read {} for a version: {e}",
                    row.session_id
                );
                return Err(unavailable());
            }
        }
    };
    Ok(versioned_history(carried, own))
}

/// `{owner_name, as_of, turns}`: what `reader` sees of the share now, to keep with the fork.
async fn fork_seed_of(
    share: &ShareModel,
    chat: &ChatModel,
    reader: Reader<'_>,
) -> Result<Value, Response> {
    let seq = ai_chat_shares::visible_seq(share, chat.last_committed_seq);
    let records = turn_records(chat).await;
    let key = (
        share.id.clone(),
        state_version(share, seq, &records, running_since(now_micros())),
    );
    let (turns, ..) = shared_turns(share, chat, seq, key, reader).await?;
    let (turns, _) = newest_within(turns.as_ref().clone(), SEED_MAX_BYTES);
    let as_of = if share.mode == MODE_SNAPSHOT {
        share.updated_at
    } else {
        now_micros()
    };
    Ok(serde_json::json!({
        "owner_name": owner_name(chat, false).await,
        "as_of": as_of,
        "turns": turns,
    }))
}

/// `{call_id: {reason, stream}}` of steps on streams `viewer` cannot read, one check per stream.
async fn hidden_steps(
    org_id: &str,
    turns: &[Value],
    viewer: Option<&str>,
    redact_tools: bool,
) -> serde_json::Map<String, Value> {
    // A public reader has no identity: only the owner's un-redacted choice shows steps.
    let check = |place: Option<(String, String)>| async move {
        match (viewer, place) {
            (Some(viewer), Some((stream_type, stream))) => {
                can_read_stream(org_id, viewer, &stream_type, &stream).await
            }
            (Some(_), None) => false,
            (None, _) => !redact_tools,
        }
    };
    hidden_steps_with(turns, viewer.is_some() && !redact_tools, check).await
}

/// [`hidden_steps`] over `can_read`, naming streams only when `named`.
async fn hidden_steps_with<F, Fut>(
    turns: &[Value],
    named: bool,
    mut can_read: F,
) -> serde_json::Map<String, Value>
where
    F: FnMut(Option<(String, String)>) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let mut readable: HashMap<Option<(String, String)>, bool> = HashMap::new();
    let mut hidden = serde_json::Map::new();
    for (call_id, place) in projection::step_streams(turns) {
        let can = match readable.get(&place) {
            Some(can) => *can,
            None => {
                let can = readable.len() < MAX_STREAM_CHECKS && can_read(place.clone()).await;
                readable.insert(place.clone(), can);
                can
            }
        };
        if !can && !hidden.contains_key(&call_id) {
            let stream = place.filter(|_| named).map(|p| p.1).unwrap_or_default();
            hidden.insert(
                call_id,
                serde_json::json!({"reason": STREAM_FORBIDDEN, "stream": stream}),
            );
        }
    }
    hidden
}

/// The same search permission a query on the stream is checked against.
async fn can_read_stream(org_id: &str, user_email: &str, stream_type: &str, stream: &str) -> bool {
    openobserve_core::authz::check_stream_permissions(
        stream,
        org_id,
        user_email,
        &config::meta::stream::StreamType::from(stream_type),
        openobserve_core::authz::StreamPermissionResourceType::Search,
    )
    .await
    .is_none()
}

/// Messages of the turns a chat carries from elsewhere: a fork's stored seed or its import.
async fn carried_seed(row: &ChatModel) -> Result<Vec<Value>, Response> {
    if let Some(turns) = stored_seed(row) {
        return Ok(seed_messages(&turns));
    }
    // Only a chat that is no fork can have begun as an import.
    if row.forked_from_share.is_some() {
        return Ok(Vec::new());
    }
    match ai_chat_imports::turns_for_session(&row.org_id, &row.session_id).await {
        Ok(Some(Value::Array(turns))) => Ok(seed_messages(&turns)),
        Ok(_) => Ok(Vec::new()),
        Err(e) => {
            log::error!(
                "[AI-CHAT] cannot read the import of {}: {e}",
                row.session_id
            );
            Err(unavailable())
        }
    }
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
    let chat = match ai_chat_sessions::get(org_id, &share.session_id).await {
        Ok(Some(chat)) if chat.status == STATUS_ACTIVE => chat,
        Ok(_) => return Ok(None),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot read chat {org_id}/{}: {e}",
                share.session_id
            );
            return Err(unavailable());
        }
    };
    Ok(creator_is_member(&share, &chat).await?.then_some(chat))
}

/// The caller's email, once chat history is known to be on.
fn guard(in_req: &axum::extract::Request) -> Result<String, Response> {
    let Some(email) = user_email(in_req) else {
        return Err(error::session_expired("Unauthorized"));
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Err(history_not_enabled());
    }
    Ok(email)
}

async fn read_body<T: serde::de::DeserializeOwned>(
    in_req: axum::extract::Request,
) -> Result<T, Response> {
    let body = axum::body::to_bytes(in_req.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| error::invalid_request("Request body too large"))?;
    serde_json::from_slice(&body)
        .map_err(|e| error::invalid_request(format!("Invalid request body: {e}")))
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
    let chat = match ai_chat_sessions::get(&share.org_id, &share.session_id).await {
        Ok(Some(chat)) if chat_servable(&chat) => chat,
        Ok(_) => return Ok(None),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot read chat {}/{}: {e}",
                share.org_id,
                share.session_id
            );
            return Err(unavailable());
        }
    };
    Ok(creator_is_member(&share, &chat)
        .await?
        .then_some(Served { share, chat }))
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
        Err(LeaseError::Busy) => {
            return Err(
                AiErrorEnvelope::new(AiErrorCode::TurnBusy, TURN_IN_PROGRESS).into_response(),
            );
        }
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
    params: &SharedChatParams,
    reader: Reader<'_>,
    route: &'static str,
) -> Response {
    let Served { share, chat } = served;
    let public = route == VISIBILITY_PUBLIC;
    let seq = ai_chat_shares::visible_seq(&share, chat.last_committed_seq);
    let records = turn_records(&chat).await;
    let since = running_since(now_micros());
    let state_version = state_version(&share, seq, &records, since);
    let not_modified =
        params.known_seq == Some(seq) && params.known_version.as_deref() == Some(&state_version);
    let mut body = SharedChat {
        title: chat.title.clone(),
        mode: share.mode.clone(),
        seq,
        active_turn: share.mode == MODE_LIVE
            && records.iter().any(|r| ai_chat_turns::is_running(r, since)),
        state_version,
        created_at: chat.created_at,
        shared_at: share.created_at,
        owner_name: None,
        not_modified,
        redact_tools: share.redact_tools,
        hide_attachments: share.hide_attachments,
        org_identifier: chat.org_id.clone(),
        hidden: None,
        truncated: false,
        turns: None,
    };
    if !not_modified {
        let key = (share.id.clone(), body.state_version.clone());
        let (turns, truncated, hidden) = match shared_turns(&share, &chat, seq, key, reader).await {
            Ok(shown) => shown,
            Err(resp) => return resp,
        };
        body.turns = Some(turns);
        body.truncated = truncated;
        body.hidden = (!hidden.is_empty()).then(|| hidden.as_ref().clone());
        count_read(&share.id).await;
        config::metrics::AI_CHAT_SHARE_READS_TOTAL
            .with_label_values(&[route])
            .inc();
    }
    body.owner_name = owner_name(&chat, public).await;
    Json(body).into_response()
}

/// The share's turns through `seq` as readers see them, and whether old ones were cut for size.
async fn shared_turns(
    share: &ShareModel,
    chat: &ChatModel,
    seq: i64,
    key: TurnKey,
    reader: Reader<'_>,
) -> Result<Shown, Response> {
    let public = reader.viewer.is_none();
    if public && let Some(shown) = PUBLIC_TURNS.get(&key, Instant::now()) {
        return Ok(shown);
    }
    let Ok(Ok(_slot)) = tokio::time::timeout(PROJECTION_WAIT, PROJECTION_GATE.acquire()).await
    else {
        return Err(rate_limited(Duration::from_secs(1)));
    };
    let mut cut = chat.clone();
    cut.last_committed_seq = seq;
    // A snapshot hides turns admitted after it was taken, including failures that stored nothing.
    let admitted_by = (share.mode == MODE_SNAPSHOT).then_some(share.updated_at);
    let turns =
        attach_turn_status_at(&cut, load_turns(&cut, reader.auth).await?, admitted_by).await;
    let hidden = hidden_steps(&chat.org_id, &turns, reader.viewer, share.redact_tools).await;
    let view = projection::ReaderView {
        hidden: Some(&hidden),
        hide_attachments: share.hide_attachments,
    };
    let (turns, truncated) = newest_within(
        reader_view(turns, share.redact_tools, &view),
        SHARED_TURNS_MAX_BYTES,
    );
    let shown = (Arc::new(turns), truncated, Arc::new(hidden));
    if public {
        PUBLIC_TURNS.put(key, shown.clone(), Instant::now());
    }
    Ok(shown)
}

async fn count_read(share_id: &str) {
    READ_FLUSHER.call_once(|| {
        tokio::spawn(flush_reads());
    });
    let Some(reads) = PENDING_READS.hit(share_id, Instant::now()) else {
        return;
    };
    write_reads(share_id, reads).await;
}

/// Writes buffered read counts every interval, so a share read only now and then is still counted.
async fn flush_reads() {
    let mut tick = tokio::time::interval(ACCESS_FLUSH_EVERY);
    loop {
        tick.tick().await;
        for (share_id, reads) in PENDING_READS.drain(Instant::now()) {
            write_reads(&share_id, reads).await;
        }
    }
}

async fn write_reads(share_id: &str, reads: i64) {
    if let Err(e) = ai_chat_shares::record_access(share_id, reads, now_micros()).await {
        log::warn!("[AI-CHAT-SHARE] cannot count {reads} reads of {share_id}: {e}");
    }
}

async fn turn_records(chat: &ChatModel) -> Vec<TurnRecord> {
    match ai_chat_turns::list_for_session(&chat.org_id, &chat.session_id).await {
        Ok(records) => records,
        Err(e) => {
            // Statuses only annotate the history; the version then differs and readers refetch.
            log::error!(
                "[AI-CHAT-SHARE] cannot read the turn records of {}/{}: {e}",
                chat.org_id,
                chat.session_id
            );
            Vec::new()
        }
    }
}

/// Whether the share's creator still owns the chat under the same user id and belongs to the org.
async fn creator_is_member(share: &ShareModel, chat: &ChatModel) -> Result<bool, Response> {
    if chat.user_id != share.created_by {
        return Ok(false);
    }
    // A deleted user's email can come back as a new user, who must not revive the old links.
    match infra::table::users::get_id_by_email(&chat.user_email).await {
        Ok(Some(id)) if id == share.created_by => {}
        Ok(_) => return Ok(false),
        Err(e) => {
            log::error!(
                "[AI-CHAT-SHARE] cannot resolve the owner of share {}: {e}",
                share.id
            );
            return Err(unavailable());
        }
    }
    Ok(db::user::is_root_user(&chat.user_email)
        || openobserve_core::users::get_user(Some(&share.org_id), &chat.user_email)
            .await
            .is_some())
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

/// Views of `shares` whose active chat its creator still owns; only the caller's own carry links.
async fn share_views(
    org_id: &str,
    shares: Vec<ShareModel>,
    with_owner: bool,
    caller: Option<&str>,
) -> Result<Vec<ShareView>, Response> {
    let mut session_ids: Vec<String> = shares.iter().map(|s| s.session_id.clone()).collect();
    session_ids.sort();
    session_ids.dedup();
    let chats = match ai_chat_sessions::get_many(org_id, &session_ids).await {
        Ok(chats) => chats,
        Err(e) => {
            log::error!("[AI-CHAT-SHARE] cannot read shared chats of {org_id}: {e}");
            return Err(unavailable());
        }
    };
    let chats: HashMap<String, ChatModel> = chats
        .into_iter()
        .filter(|c| c.status == STATUS_ACTIVE)
        .map(|c| (c.session_id.clone(), c))
        .collect();
    let mut names = HashMap::new();
    if with_owner {
        for chat in chats.values() {
            if !names.contains_key(&chat.user_id) {
                let name = owner_name(chat, false).await;
                names.insert(chat.user_id.clone(), name);
            }
        }
    }
    Ok(shares
        .into_iter()
        .filter_map(|s| {
            let chat = chats
                .get(&s.session_id)
                .filter(|c| c.user_id == s.created_by)?;
            let own = caller == Some(s.created_by.as_str());
            let mut view = ShareView::new(s, &chat.title);
            if with_owner {
                view.owner_name = names.get(&chat.user_id).cloned().flatten();
                view.owner_email = Some(chat.user_email.clone());
            }
            if !own {
                view.token = None;
                view.url_path = None;
            }
            Some(view)
        })
        .collect())
}

fn public_links_enabled() -> bool {
    config::get_config().public_ai_chat.enabled
}

/// The longest expiry a public link may have, in seconds.
fn public_max_expiry_secs() -> i64 {
    let days = config::get_config().public_ai_chat.expiry_limit_days();
    i64::try_from(days)
        .unwrap_or(i64::MAX)
        .saturating_mul(DAY_SECS)
        .min(MAX_EXPIRY_SECS)
}

fn public_rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = u32::try_from(config::get_config().public_ai_chat.rpm).unwrap_or(u32::MAX);
    // Unresolved clients would share one bucket any of them could exhaust; the gate bounds them.
    let Some(ip) = ip else {
        return false;
    };
    rpm != 0 && PUBLIC_READS.over_budget(&ip.0.to_string(), PUBLIC_READ_WINDOW, rpm)
}

fn enter(gate: &Semaphore) -> Option<SemaphorePermit<'_>> {
    gate.try_acquire().ok()
}

fn count_op(op: &str) {
    config::metrics::AI_CHAT_SHARE_OPS_TOTAL
        .with_label_values(&[op])
        .inc();
}

/// Cross-site forms cannot send JSON without a CORS preflight, so state changes require it.
fn require_json(in_req: &axum::extract::Request) -> Result<(), Response> {
    if is_json(in_req.headers()) {
        return Ok(());
    }
    Err(AiErrorEnvelope::new(
        AiErrorCode::InvalidRequest,
        "Content-Type must be application/json",
    )
    .status(StatusCode::UNSUPPORTED_MEDIA_TYPE)
    .into_response())
}

fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
}

fn not_found() -> Response {
    error::not_found(NOT_FOUND)
}

fn unavailable() -> Response {
    error::history_unavailable("Shared chats are unavailable; please retry")
}

fn rate_limited(retry_after: Duration) -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::RateLimited,
        "Too many requests; please retry later",
    )
    .retry_after(Some(retry_after.as_secs().max(1)))
    .into_response()
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
    public_max_secs: i64,
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
    validate_expiry(req.expires_in_secs, &req.visibility, public_max_secs)?;
    Ok(req.expires_in_secs)
}

fn validate_expiry(
    expires_in_secs: Option<i64>,
    visibility: &str,
    public_max_secs: i64,
) -> Result<(), &'static str> {
    let public = visibility == VISIBILITY_PUBLIC;
    match expires_in_secs {
        Some(secs) if !(MIN_EXPIRY_SECS..=MAX_EXPIRY_SECS).contains(&secs) => {
            Err("expires_in_secs must be between 60 seconds and 365 days")
        }
        None if public => Err("A public link must have an expiry"),
        Some(secs) if public && secs > public_max_secs => {
            Err("expires_in_secs is longer than this deployment allows for public links")
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
    public_max_secs: i64,
) -> Result<ShareSettings, &'static str> {
    let mode = req.mode.clone().unwrap_or_else(|| share.mode.clone());
    if mode != MODE_SNAPSHOT && mode != MODE_LIVE {
        return Err("mode must be \"snapshot\" or \"live\"");
    }
    if let Some(expires_in_secs) = req.expires_in_secs {
        validate_expiry(expires_in_secs, &share.visibility, public_max_secs)?;
    }
    let expires_at = match req.expires_in_secs {
        Some(secs) => secs.map(|secs| now + secs * 1_000_000),
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
        redact_tools: req.redact_tools.unwrap_or(share.redact_tools),
        hide_attachments: req.hide_attachments.unwrap_or(share.hide_attachments),
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

/// `(redact_tools, hide_attachments)` of a new share: what it asks, else hidden on public links.
fn hiding_of(req: &CreateShareRequest) -> (bool, bool) {
    let public = req.visibility == VISIBILITY_PUBLIC;
    (
        req.redact_tools.unwrap_or(public),
        req.hide_attachments.unwrap_or(public),
    )
}

/// "{title} (continued)", "(continued 2)" for the caller's second fork of the share, and so on.
fn fork_title(source: &str, earlier_forks: u64) -> String {
    let source = source.trim();
    let base = if source.is_empty() {
        FALLBACK_TITLE
    } else {
        source
    };
    let suffix = match earlier_forks {
        0 => format!(" ({FORK_SUFFIX})"),
        n => format!(" ({FORK_SUFFIX} {})", n + 1),
    };
    let keep = MAX_TITLE_CHARS - suffix.chars().count();
    let mut title: String = base.chars().take(keep).collect();
    title.push_str(&suffix);
    title
}

/// Turns as a share reader sees them: no opencode ids, remote images or model names.
fn reader_view(
    mut turns: Vec<Value>,
    redact_tools: bool,
    view: &projection::ReaderView<'_>,
) -> Vec<Value> {
    let audience = if redact_tools {
        projection::Audience::ViewerRedacted
    } else {
        projection::Audience::Viewer
    };
    projection::for_audience(&mut turns, audience, view);
    for turn in &mut turns {
        if let Some(turn) = turn.as_object_mut() {
            turn.remove("user_message_id");
        }
    }
    turns
}

/// Changes whenever a reader's copy would: the seq, a shown turn's status or error, or a setting.
fn state_version(
    share: &ShareModel,
    seq: i64,
    records: &[TurnRecord],
    running_since: i64,
) -> String {
    let mut key = format!(
        "{seq}|{}|{}|{}|{:?}",
        share.mode, share.redact_tools, share.hide_attachments, share.snapshot_seq
    );
    for record in records
        .iter()
        .filter(|r| r.start_seq.is_none_or(|start| start <= seq + 1))
    {
        let status =
            if record.status == TURN_RUNNING && !ai_chat_turns::is_running(record, running_since) {
                TURN_INTERRUPTED
            } else {
                record.status.as_str()
            };
        let error_code = record.error_code.as_deref().unwrap_or_default();
        key.push_str(&format!("|{}:{status}:{error_code}", record.turn_id));
    }
    format!("{seq}.{:016x}", fnv::new().sum64(&key))
}

/// The newest `turns` whose JSON fits in `max_bytes`, and whether any were left out.
fn newest_within(mut turns: Vec<Value>, max_bytes: usize) -> (Vec<Value>, bool) {
    let mut total = 0usize;
    let mut keep = 0;
    for turn in turns.iter().rev() {
        let bytes = serde_json::to_vec(turn).map_or(usize::MAX, |b| b.len() + 1);
        total = total.saturating_add(bytes);
        if total > max_bytes {
            break;
        }
        keep += 1;
    }
    let cut = turns.len() - keep;
    turns.drain(..cut);
    (turns, cut > 0)
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

/// [`transcript`] of the events before `before_seq` only.
fn transcript_before(events: &[DurableEvent], before_seq: i64) -> Vec<Value> {
    let kept: Vec<DurableEvent> = events
        .iter()
        .filter(|e| e.seq < before_seq)
        .cloned()
        .collect();
    transcript(&kept)
}

/// The carried messages then the chat's own, fitted; `true` while carried ones survive the fit.
fn versioned_history(carried: Vec<Value>, own: Vec<Value>) -> (Vec<Value>, bool) {
    let own_len = own.len();
    let fitted = fit_seed(carried.into_iter().chain(own).collect());
    let seeded = fitted.len() > own_len;
    (fitted, seeded)
}

/// The turns a fork copied when it was made.
fn stored_seed(row: &ChatModel) -> Option<Vec<Value>> {
    let seed: Value = serde_json::from_str(row.seed.as_deref()?).ok()?;
    match seed {
        Value::Object(mut seed) => match seed.remove("turns") {
            Some(Value::Array(turns)) => Some(turns),
            _ => None,
        },
        _ => None,
    }
}

/// The first-turn seed of a chat that may be an import; an unreadable import seeds nothing.
fn import_seed(
    read: Result<Option<Value>, infra::errors::Error>,
    session_id: &str,
) -> Option<Vec<Value>> {
    let turns = match read {
        Ok(Some(Value::Array(turns))) => turns,
        Ok(_) => return None,
        Err(e) => {
            log::warn!("[AI-CHAT] first turn of {session_id} goes unseeded, import unread: {e}");
            return None;
        }
    };
    let seed = fit_seed(seed_messages(&turns));
    (!seed.is_empty()).then_some(seed)
}

/// Stored seed turns as `{role, content}` messages: the user's words and the assistant's text.
fn seed_messages(turns: &[Value]) -> Vec<Value> {
    let mut messages = Vec::new();
    for turn in turns {
        let user = turn["user"]["text"].as_str().unwrap_or_default().trim();
        if !user.is_empty() {
            messages.push(serde_json::json!({"role": "user", "content": user}));
        }
        let answer: String = turn["frames"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f["type"] == "message_delta")
            .filter_map(|f| f["content"].as_str())
            .collect();
        let answer = answer.trim();
        if !answer.is_empty() {
            messages.push(serde_json::json!({"role": "assistant", "content": answer}));
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

fn shared_turns_ser<S: serde::Serializer>(
    turns: &Option<Arc<Vec<Value>>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    turns.as_deref().serialize(serializer)
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
            redact_tools: visibility == VISIBILITY_PUBLIC,
            hide_attachments: false,
        }
    }

    const PUBLIC_MAX: i64 = 90 * DAY_SECS;

    fn create_req(mode: &str, visibility: &str, expires: Option<i64>) -> CreateShareRequest {
        CreateShareRequest {
            mode: mode.into(),
            visibility: visibility.into(),
            expires_in_secs: expires,
            redact_tools: None,
            hide_attachments: None,
        }
    }

    #[test]
    fn create_requests_are_validated() {
        let validate = |req: &CreateShareRequest, public| validate_create(req, public, PUBLIC_MAX);
        assert_eq!(
            validate(&create_req(MODE_LIVE, VISIBILITY_ORG, None), false),
            Ok(None)
        );
        assert_eq!(
            validate(
                &create_req(MODE_SNAPSHOT, VISIBILITY_PUBLIC, Some(60)),
                true
            ),
            Ok(Some(60))
        );
        assert_eq!(
            validate(
                &create_req(MODE_LIVE, VISIBILITY_ORG, Some(MAX_EXPIRY_SECS)),
                true
            ),
            Ok(Some(MAX_EXPIRY_SECS))
        );
        for bad in [
            create_req("frozen", VISIBILITY_ORG, None),
            create_req(MODE_LIVE, "team", None),
            create_req(MODE_LIVE, VISIBILITY_ORG, Some(59)),
            create_req(MODE_LIVE, VISIBILITY_ORG, Some(MAX_EXPIRY_SECS + 1)),
            create_req(MODE_LIVE, VISIBILITY_PUBLIC, None),
            create_req(MODE_LIVE, VISIBILITY_PUBLIC, Some(PUBLIC_MAX + 1)),
        ] {
            assert!(validate(&bad, true).is_err(), "{bad:?}");
        }
        assert!(validate(&create_req(MODE_LIVE, VISIBILITY_PUBLIC, Some(60)), false).is_err());
    }

    #[test]
    fn public_links_must_expire_within_the_public_maximum_on_update_too() {
        let public = share(MODE_LIVE, VISIBILITY_PUBLIC);
        let parse = |body: &str| serde_json::from_str::<UpdateShareRequest>(body).unwrap();
        let update = |req: &UpdateShareRequest| apply_update(&public, req, 9, 0, PUBLIC_MAX);
        assert!(update(&parse(r#"{"expires_in_secs":null}"#)).is_err());
        let too_long = format!(r#"{{"expires_in_secs":{}}}"#, PUBLIC_MAX + 1);
        assert!(update(&parse(&too_long)).is_err());
        let max = format!(r#"{{"expires_in_secs":{PUBLIC_MAX}}}"#);
        assert_eq!(
            update(&parse(&max)).unwrap().expires_at,
            Some(PUBLIC_MAX * 1_000_000)
        );
        let org = share(MODE_LIVE, VISIBILITY_ORG);
        assert!(
            apply_update(
                &org,
                &parse(r#"{"expires_in_secs":null}"#),
                9,
                0,
                PUBLIC_MAX
            )
            .is_ok()
        );
    }

    #[test]
    fn redaction_defaults_per_visibility_and_can_be_toggled() {
        let public = share(MODE_LIVE, VISIBILITY_PUBLIC);
        let parse = |body: &str| serde_json::from_str::<UpdateShareRequest>(body).unwrap();
        let kept = apply_update(&public, &parse("{}"), 9, 0, PUBLIC_MAX).unwrap();
        assert!(kept.redact_tools);
        let off = apply_update(
            &public,
            &parse(r#"{"redact_tools":false}"#),
            9,
            0,
            PUBLIC_MAX,
        );
        assert!(!off.unwrap().redact_tools);
        let create: CreateShareRequest =
            serde_json::from_str(r#"{"mode":"live","visibility":"org","redact_tools":true}"#)
                .unwrap();
        assert_eq!(create.redact_tools, Some(true));
    }

    #[test]
    fn shared_turns_drop_opencode_message_ids() {
        let turns = vec![json!({"user_message_id": "msg_1", "user": {"text": "hi"}, "frames": []})];
        let view = reader_view(turns, false, &projection::ReaderView::default());
        assert_eq!(view, vec![json!({"user": {"text": "hi"}, "frames": []})]);
        let remote = vec![json!({"user": {"text": "", "images": [{"url": "https://x/y.png"}]}})];
        assert_eq!(
            reader_view(remote, false, &projection::ReaderView::default())[0]["user"]["images"][0]
                ["url"],
            Value::Null
        );
    }

    #[test]
    fn redacted_shares_keep_text_and_tool_names_only() {
        let turns = vec![
            json!({
                "user_message_id": "msg_1",
                "status": "completed",
                "user": {"text": "why?"},
                "frames": [
                    {"type": "message_delta", "content": "Because."},
                    {"type": "tool_call", "tool": "SearchSQL", "args": {"sql": "secret"}},
                    {"type": "tool_result", "tool": "SearchSQL", "success": true, "output": "rows"},
                ],
            }),
            json!({"turn_id": "t2", "status": "failed", "error_code": "x", "user": null, "frames": []}),
        ];
        let view = reader_view(turns, true, &projection::ReaderView::default());
        let text = serde_json::to_string(&view).unwrap();
        assert!(!text.contains("secret") && !text.contains("rows"), "{text}");
        assert!(!text.contains("user_message_id"));
        assert_eq!(view[0]["frames"][0]["content"], "Because.");
        assert_eq!(view[0]["frames"][1]["tool"], "SearchSQL");
        assert_eq!(view[1]["user"], Value::Null);
        assert_eq!(view[1]["status"], "failed");
    }

    #[test]
    fn state_changes_require_a_json_body() {
        let headers = |ct: &str| {
            let mut h = HeaderMap::new();
            h.insert(header::CONTENT_TYPE, HeaderValue::from_str(ct).unwrap());
            h
        };
        assert!(is_json(&headers("application/json")));
        assert!(is_json(&headers("Application/JSON; charset=utf-8")));
        assert!(!is_json(&headers("text/plain")));
        assert!(!is_json(&headers("application/x-www-form-urlencoded")));
        assert!(!is_json(&HeaderMap::new()));
        let req = axum::http::Request::builder()
            .header(header::CONTENT_TYPE, "text/plain")
            .body(axum::body::Body::empty())
            .unwrap();
        let resp = require_json(&req).unwrap_err();
        assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn the_default_public_expiry_maximum_is_90_days() {
        assert_eq!(public_max_expiry_secs(), PUBLIC_MAX);
    }

    #[test]
    fn public_turns_are_cached_per_share_and_version_until_they_expire() {
        let cache = TurnCache::new(Duration::from_secs(60));
        let t0 = Instant::now();
        let key = ("s".to_string(), "4.a".to_string());
        cache.put(
            key.clone(),
            (Arc::new(vec![json!({"a": 1})]), false, Arc::default()),
            t0,
        );
        assert!(cache.get(&key, t0 + Duration::from_secs(59)).is_some());
        assert!(
            cache
                .get(&("s".to_string(), "4.b".to_string()), t0)
                .is_none()
        );
        assert!(cache.get(&key, t0 + Duration::from_secs(60)).is_none());
        for i in 0..PUBLIC_TURNS_MAX_ENTRIES + 5 {
            cache.put(
                (format!("s{i}"), "1".into()),
                (Arc::new(Vec::new()), false, Arc::default()),
                t0,
            );
        }
        assert_eq!(
            cache.entries.lock().unwrap().len(),
            PUBLIC_TURNS_MAX_ENTRIES
        );
    }

    #[test]
    fn first_reads_are_written_at_once_and_the_rest_by_the_flush() {
        let counter = ReadCounter::new(Duration::from_secs(60));
        let t0 = Instant::now();
        assert_eq!(counter.hit("a", t0), Some(1));
        assert_eq!(counter.hit("a", t0 + Duration::from_secs(1)), None);
        assert_eq!(counter.hit("a", t0 + Duration::from_secs(2)), None);
        assert_eq!(counter.hit("b", t0 + Duration::from_secs(2)), Some(1));
        assert_eq!(
            counter.drain(t0 + Duration::from_secs(60)),
            vec![("a".to_string(), 2)]
        );
        assert!(counter.drain(t0 + Duration::from_secs(61)).is_empty());
        assert_eq!(counter.hit("a", t0 + Duration::from_secs(62)), None);
        assert!(counter.drain(t0 + Duration::from_secs(200)).len() == 1);
        assert!(counter.drain(t0 + Duration::from_secs(400)).is_empty());
        assert!(counter.pending.lock().unwrap().is_empty());
        assert_eq!(counter.hit("a", t0 + Duration::from_secs(401)), Some(1));
    }

    fn record(turn_id: &str, status: &str, start_seq: i64, started_at: i64) -> TurnRecord {
        TurnRecord {
            org_id: ORG.into(),
            session_id: "s".into(),
            turn_id: turn_id.into(),
            status: status.into(),
            error_code: None,
            start_seq: Some(start_seq),
            end_seq: None,
            started_at,
            ended_at: None,
            first_event_at: None,
            version_of: None,
            decisions: None,
        }
    }

    #[test]
    fn the_state_version_follows_statuses_settings_and_the_cut() {
        let live = share(MODE_LIVE, VISIBILITY_ORG);
        let running = vec![
            record("t1", "completed", 0, 5),
            record("t2", TURN_RUNNING, 5, 10),
        ];
        let base = state_version(&live, 4, &running, 0);
        assert_eq!(base, state_version(&live, 4, &running, 0));
        assert!(base.starts_with("4."));
        let mut done = running.clone();
        done[1].status = "completed".into();
        assert_ne!(base, state_version(&live, 4, &done, 0));
        assert_ne!(
            base,
            state_version(&live, 4, &running, 11),
            "running turn went stale"
        );
        let mut failed = done.clone();
        failed[1].error_code = Some("agent_error".into());
        assert_ne!(
            state_version(&live, 4, &done, 0),
            state_version(&live, 4, &failed, 0)
        );
        let mut redacted = live.clone();
        redacted.redact_tools = true;
        assert_ne!(base, state_version(&redacted, 4, &running, 0));
        let mut snap = share(MODE_SNAPSHOT, VISIBILITY_ORG);
        snap.snapshot_seq = Some(2);
        let before = state_version(&snap, 2, &running[..1], 0);
        assert_eq!(
            before,
            state_version(&snap, 2, &running, 0),
            "turn after the cut"
        );
    }

    #[test]
    fn oversized_histories_keep_the_newest_turns() {
        let turns: Vec<Value> = (0..4)
            .map(|i| json!({"n": i, "pad": "x".repeat(100)}))
            .collect();
        let one = serde_json::to_vec(&turns[0]).unwrap().len() + 1;
        let (all, cut) = newest_within(turns.clone(), one * 4);
        assert_eq!((all.len(), cut), (4, false));
        let (kept, cut) = newest_within(turns.clone(), one * 2 + 1);
        assert!(cut);
        assert_eq!(kept, turns[2..].to_vec());
        let (none, cut) = newest_within(turns, 1);
        assert!(none.is_empty() && cut);
    }

    #[test]
    fn updates_move_the_snapshot_only_when_asked_or_switching() {
        let snap = share(MODE_SNAPSHOT, VISIBILITY_ORG);
        let apply_update = |share: &ShareModel, req: &UpdateShareRequest, seq: i64, now: i64| {
            apply_update(share, req, seq, now, PUBLIC_MAX)
        };
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
        let apply_update = |share: &ShareModel, req: &UpdateShareRequest, seq: i64, now: i64| {
            apply_update(share, req, seq, now, PUBLIC_MAX)
        };
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
        let body: Value = serde_json::from_slice(&a).unwrap();
        assert_eq!(body["code"], "not_found");
        assert_eq!(body["message"], NOT_FOUND);
    }

    #[tokio::test]
    async fn a_busy_reader_is_told_when_to_retry() {
        let resp = rate_limited(PUBLIC_READ_WINDOW);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "60");
        let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "rate_limited");
        assert_eq!(body["retry_after"], 60);
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
        assert_eq!(fork_title("", 0), "Shared chat (continued)");
        assert_eq!(fork_title(" 5xx spike ", 1), "5xx spike (continued 2)");
        let long = fork_title(&"x".repeat(500), 0);
        assert_eq!(long.chars().count(), MAX_TITLE_CHARS);
        assert!(long.ends_with(" (continued)"));
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
    fn public_reads_are_limited_per_ip_and_unknown_clients_by_a_gate() {
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

    #[test]
    fn share_bodies_accept_hide_attachments_and_still_refuse_unknown_fields() {
        let create: CreateShareRequest = serde_json::from_value(json!({
            "mode": "snapshot", "visibility": "org", "redact_tools": true, "hide_attachments": true,
        }))
        .unwrap();
        assert_eq!(create.hide_attachments, Some(true));
        let old: CreateShareRequest =
            serde_json::from_value(json!({"mode": "snapshot", "visibility": "org"})).unwrap();
        assert_eq!(old.hide_attachments, None);
        assert!(
            serde_json::from_value::<CreateShareRequest>(
                json!({"mode": "snapshot", "visibility": "org", "redact_attachments": true})
            )
            .is_err()
        );
        let update: UpdateShareRequest =
            serde_json::from_value(json!({"hide_attachments": false})).unwrap();
        assert_eq!(update.hide_attachments, Some(false));
        assert!(serde_json::from_value::<UpdateShareRequest>(json!({"nope": 1})).is_err());
        let share = share(MODE_LIVE, VISIBILITY_ORG);
        let kept = apply_update(&share, &UpdateShareRequest::default(), 3, 1, 60).unwrap();
        assert!(!kept.hide_attachments);
        let hid = UpdateShareRequest {
            hide_attachments: Some(true),
            ..Default::default()
        };
        assert!(
            apply_update(&share, &hid, 3, 1, 60)
                .unwrap()
                .hide_attachments
        );
    }

    #[test]
    fn readers_never_see_hidden_attachments_or_model_names() {
        let turns = vec![json!({
            "user": {
                "text": "Explain\n\n--- Log rows [abcdefgh] ---\n\"card 4111\"\n--- end [abcdefgh] ---",
                "images": [{"filename": "a.png", "mime": "image/png", "url": "data:image/png;base64,AA"}],
            },
            "frames": [{"type": "message_delta", "content": "gpt-4o says hi"}],
        })];
        let view = projection::ReaderView {
            hidden: None,
            hide_attachments: true,
        };
        let shown = reader_view(turns, false, &view);
        assert_eq!(
            shown[0]["user"]["text"],
            "Explain\n\n[Attached log rows hidden]"
        );
        assert_eq!(shown[0]["user"]["images"], json!([]));
        assert_eq!(shown[0]["frames"][0]["content"], "the model says hi");
    }

    #[tokio::test]
    async fn a_public_reader_of_a_redacted_link_sees_every_stream_step_hidden_without_names() {
        let turns = vec![json!({"frames": [
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c1", "context": {"sql": "SELECT * FROM payments"}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c2", "context": {"stream_name": "payments"}},
            {"type": "tool_call", "tool": "StreamList", "call_id": "c3", "context": {}},
        ]})];
        let hidden = hidden_steps("org", &turns, None, true).await;
        assert_eq!(
            Value::Object(hidden),
            json!({
                "c1": {"reason": "stream_forbidden", "stream": ""},
                "c2": {"reason": "stream_forbidden", "stream": ""},
            })
        );
        assert!(hidden_steps("org", &turns, None, false).await.is_empty());
    }

    #[tokio::test]
    async fn a_signed_in_reader_has_unreadable_and_unplaceable_steps_hidden() {
        let turns = vec![json!({"frames": [
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c1", "context": {"sql": "SELECT * FROM payments_audit"}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c2", "context": {"stream_name": "default"}},
            {"type": "tool_call", "tool": "PrometheusQuery", "call_id": "c3", "context": {"query": "up"}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c4", "context": {"stream_name": "default"}},
            {"type": "tool_call", "tool": "StreamList", "call_id": "c5", "context": {}},
        ]})];
        let checked = std::cell::RefCell::new(Vec::new());
        let can_read = |place: Option<(String, String)>| {
            checked.borrow_mut().push(place.clone());
            async move { place.is_some_and(|(_, stream)| stream == "default") }
        };
        let hidden = hidden_steps_with(&turns, true, can_read).await;
        assert_eq!(
            Value::Object(hidden),
            json!({
                "c1": {"reason": "stream_forbidden", "stream": "payments_audit"},
                "c3": {"reason": "stream_forbidden", "stream": ""},
            })
        );
        assert_eq!(checked.borrow().len(), 3, "one check per distinct stream");
        // A redacted link names no stream, not even to a signed-in reader.
        let hidden = hidden_steps_with(&turns, false, |_| async { false }).await;
        assert_eq!(hidden.len(), 4);
        assert!(hidden.values().all(|h| h["stream"] == ""));
        let many: Vec<Value> = (0..MAX_STREAM_CHECKS + 2)
            .map(|n| json!({"type": "tool_call", "tool": "SearchSQL", "call_id": format!("s{n}"), "context": {"stream_name": format!("s{n}")}}))
            .collect();
        let calls = std::cell::Cell::new(0);
        let hidden = hidden_steps_with(&[json!({"frames": many})], true, |_| {
            calls.set(calls.get() + 1);
            async { true }
        })
        .await;
        assert_eq!(calls.get(), MAX_STREAM_CHECKS);
        assert_eq!(hidden.len(), 2);
    }

    #[test]
    fn public_links_hide_tools_and_attachments_unless_asked() {
        let public = create_req(MODE_LIVE, VISIBILITY_PUBLIC, Some(3600));
        assert_eq!(hiding_of(&public), (true, true));
        assert_eq!(
            hiding_of(&create_req(MODE_LIVE, VISIBILITY_ORG, None)),
            (false, false)
        );
        let shown = CreateShareRequest {
            hide_attachments: Some(false),
            redact_tools: Some(false),
            ..public
        };
        assert_eq!(hiding_of(&shown), (false, false));
    }

    #[test]
    fn versions_keep_the_carried_turns_ahead_of_the_chat() {
        let msg = |role: &str, content: &str| json!({"role": role, "content": content});
        let carried = vec![msg("user", "shared q"), msg("assistant", "shared a")];
        let own = vec![msg("user", "mine")];
        let (history, seeded) = versioned_history(carried.clone(), own.clone());
        assert_eq!(history, [carried.clone(), own.clone()].concat());
        assert!(seeded);
        assert_eq!(versioned_history(Vec::new(), own.clone()), (own, false));
        assert_eq!(
            versioned_history(carried.clone(), Vec::new()),
            (carried, true)
        );
    }

    #[test]
    fn fork_seeds_and_version_seeds_hold_only_what_came_before() {
        let turns = vec![
            json!({"user": {"text": " why? "}, "frames": [
                {"type": "message_delta", "content": "Because "},
                {"type": "tool_call", "tool": "SearchSQL"},
                {"type": "message_delta", "content": "of GC."},
            ]}),
            json!({"user": null, "frames": [{"type": "error", "error": "x"}]}),
        ];
        assert_eq!(
            seed_messages(&turns),
            vec![
                json!({"role": "user", "content": "why?"}),
                json!({"role": "assistant", "content": "Because of GC."}),
            ]
        );
        let events = vec![
            message(0, "msg_u1", "user", None),
            part(
                1,
                "msg_u1",
                json!({"id": "p1", "type": "text", "text": "first"}),
            ),
            message(2, "msg_a1", "assistant", Some("msg_u1")),
            part(
                3,
                "msg_a1",
                json!({"id": "p2", "type": "text", "text": "one"}),
            ),
            message(4, "msg_u2", "user", None),
            part(
                5,
                "msg_u2",
                json!({"id": "p3", "type": "text", "text": "replaced"}),
            ),
        ];
        assert_eq!(
            transcript_before(&events, 4),
            vec![
                json!({"role": "user", "content": "first"}),
                json!({"role": "assistant", "content": "one"}),
            ]
        );
    }

    #[test]
    fn an_unreadable_import_seeds_nothing_and_never_fails_the_turn() {
        let failed = Err(infra::errors::Error::Message("db down".into()));
        assert_eq!(import_seed(failed, "s1"), None);
        assert_eq!(import_seed(Ok(None), "s1"), None);
        assert_eq!(import_seed(Ok(Some(json!([]))), "s1"), None);
        let turns = json!([{"user": {"text": "why?"}, "frames": [{"type": "message_delta", "content": "GC"}]}]);
        assert_eq!(
            import_seed(Ok(Some(turns)), "s1"),
            Some(vec![
                json!({"role": "user", "content": "why?"}),
                json!({"role": "assistant", "content": "GC"}),
            ])
        );
    }
}

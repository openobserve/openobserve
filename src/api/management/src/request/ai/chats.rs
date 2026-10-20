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

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use infra::table::{
    ai_chat_sessions::{self, ListCursor, Model, NO_SEQ, STATUS_ACTIVE},
    ai_chat_turns::{
        self, Model as TurnRecord, TURN_CANCELLED, TURN_COMPLETED, TURN_FAILED, TURN_INTERRUPTED,
        TURN_RUNNING,
    },
};
use o2_enterprise::enterprise::{
    ai::{
        chat::{
            batcher::DurableEvent,
            registry::{self, CancelReason, FeedItem, FeedRecv, TurnFeed},
        },
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

use super::error::{self, AiErrorAction, AiErrorCode, AiErrorEnvelope};
use crate::common::meta::{http::HttpResponse as MetaHttpResponse, user::AuthTokens};

/// Open tails on this node per `user:` and `turn:` key (see [`TailSlot`]).
static OPEN_TAILS: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The trace id the server gave a turn at admission, so a refused turn's Details can show it.
pub const X_O2_TRACE_ID: &str = "x-o2-trace-id";

pub(super) const MAX_TITLE_CHARS: usize = 200;
const DEFAULT_PAGE: u64 = 50;
const MAX_PAGE: u64 = 200;
const MAX_TURNS_PAGE: usize = 1000;
/// A turn still marked running this long past the longest allowed turn died with its node.
const RUNNING_GRACE_SECS: i64 = 60;
const MICROS_PER_SEC: i64 = 1_000_000;
const TURN_ALREADY_RUNNING: &str = "turn_already_running";
/// The stored error code of a turn its signed-out auth session stopped.
const SIGNED_OUT: &str = "signed_out";
/// The client's stall detector expects a sign of life at least this often (`99` §2.1).
const TAIL_KEEPALIVE: Duration = Duration::from_secs(15);
/// Projections one tail read may run; more events are sent in this many batches.
const MAX_REPLAY_STEPS: usize = 64;
const TAIL_CHANNEL: usize = 64;
/// Longest wait between two polls of a quiet turn running on another node.
const TAIL_POLL_MAX: Duration = Duration::from_secs(5);
/// Open tails one node serves per user and per turn; more is a client bug or abuse.
const MAX_TAILS_PER_USER: usize = 16;
const MAX_TAILS_PER_TURN: usize = 4;
const MICROS_PER_DAY: i64 = 86_400 * MICROS_PER_SEC;
/// Older confirmation requests go unreported, so a dormant chat never widens the search.
const PENDING_APPROVAL_MAX_AGE: i64 = MICROS_PER_DAY;

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
    /// A turn of this chat is running right now, on any node.
    pub active_turn: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    /// A hint: the newest turn stored a confirmation request the caller has not answered.
    pub pending_approval: bool,
    /// The call id of that request, when it could be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_approval_id: Option<String>,
}

impl ChatSummary {
    /// The running turn and the pending approval call id (empty: unknown) of this chat.
    fn with_markers(mut self, running: Option<&TurnRecord>, pending: Option<&String>) -> Self {
        self.active_turn = running.is_some();
        self.active_turn_id = running.map(|r| r.turn_id.clone());
        self.pending_approval = pending.is_some();
        self.pending_approval_id = pending.filter(|id| !id.is_empty()).cloned();
        self
    }
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
            active_turn: false,
            active_turn_id: None,
            pending_approval: false,
            pending_approval_id: None,
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

#[derive(Debug, Deserialize)]
pub struct TailParams {
    /// The last seq the caller applied; a `Last-Event-ID` header wins over it.
    pub from_seq: Option<i64>,
}

/// One turn's committed events a tail holds, and the frames it has sent for them.
struct TurnTail {
    turn_id: String,
    start_seq: i64,
    /// Its rows were written no earlier, so reads start there instead of at the chat's first row.
    started_at: i64,
    /// Events past it belong to the chat's next turn.
    end_seq: Option<i64>,
    events: Vec<DurableEvent>,
    /// The turn's frames as of `sent`, as runs.
    runs: Vec<FrameRun>,
    /// The last seq whose frames were sent, or that the caller already had.
    sent: i64,
}

impl TurnTail {
    fn new(record: &TurnRecord, from_seq: i64) -> Self {
        let start_seq = record.start_seq.unwrap_or(NO_SEQ + 1);
        Self {
            turn_id: record.turn_id.clone(),
            start_seq,
            started_at: record.started_at,
            end_seq: record.end_seq,
            events: Vec::new(),
            runs: Vec::new(),
            sent: from_seq.max(start_seq - 1),
        }
    }

    fn last_seq(&self) -> i64 {
        self.events.last().map_or(self.start_seq - 1, |e| e.seq)
    }

    /// Holds newly committed events of this turn; `false` when one is missing before them.
    fn push(&mut self, events: impl IntoIterator<Item = DurableEvent>) -> bool {
        let known_before = self.last_seq() <= self.sent;
        let mut contiguous = true;
        for event in events {
            if event.seq <= self.last_seq() || self.end_seq.is_some_and(|end| event.seq > end) {
                continue;
            }
            if event.seq != self.last_seq() + 1 {
                contiguous = false;
                break;
            }
            self.events.push(event);
        }
        // Events the caller already had are its starting point, never sent again.
        if known_before && self.events.first().is_some_and(|e| e.seq <= self.sent) {
            let known = self.events.partition_point(|e| e.seq <= self.sent);
            self.runs = frame_runs(turn_frames(&self.events[..known]));
        }
        contiguous
    }

    fn has_unsent(&self) -> bool {
        self.last_seq() > self.sent
    }

    /// SSE messages for every held event past `sent`: each batch's frames, then its seq boundary.
    fn take_messages(&mut self) -> Vec<Bytes> {
        let first = self.events.partition_point(|e| e.seq <= self.sent);
        let stride = (self.events.len() - first)
            .div_ceil(MAX_REPLAY_STEPS)
            .max(1);
        let mut messages = Vec::new();
        let mut end = first;
        while end < self.events.len() {
            end = (end + stride).min(self.events.len());
            let runs = frame_runs(turn_frames(&self.events[..end]));
            let seq = self.events[end - 1].seq;
            // As on the live stream, a frame carries the last seq it comes after.
            for frame in frames_between(&self.runs, &runs) {
                messages.push(sse_message(self.sent, &frame));
            }
            messages.push(seq_boundary(seq));
            self.runs = runs;
            self.sent = seq;
        }
        messages
    }
}

/// A run of `message_delta` frames is one text, so a grown text diffs as its new suffix.
#[derive(Debug, Clone, PartialEq)]
enum FrameRun {
    Text(String),
    Frame(Value),
}

impl FrameRun {
    fn into_frame(self) -> Value {
        match self {
            FrameRun::Text(text) => serde_json::json!({"type": "message_delta", "content": text}),
            FrameRun::Frame(frame) => frame,
        }
    }
}

/// A tail's place under the per-user and per-turn caps of this node; dropping it frees it.
struct TailSlot {
    keys: Vec<String>,
}

impl TailSlot {
    /// `None` when the user or the turn already has as many open tails as its cap allows.
    fn take(org_id: &str, owner: &str, session_id: &str, turn_id: &str) -> Option<Self> {
        let keys = [
            (format!("user:{org_id}/{owner}"), MAX_TAILS_PER_USER),
            (
                format!("turn:{org_id}/{session_id}/{turn_id}"),
                MAX_TAILS_PER_TURN,
            ),
        ];
        let mut open = OPEN_TAILS.lock().unwrap_or_else(|e| e.into_inner());
        if keys
            .iter()
            .any(|(key, cap)| open.get(key).copied().unwrap_or(0) >= *cap)
        {
            return None;
        }
        for (key, _) in &keys {
            *open.entry(key.clone()).or_insert(0) += 1;
        }
        Some(Self {
            keys: keys.into_iter().map(|(key, _)| key).collect(),
        })
    }
}

impl Drop for TailSlot {
    fn drop(&mut self) {
        let mut open = OPEN_TAILS.lock().unwrap_or_else(|e| e.into_inner());
        for key in &self.keys {
            if let Some(count) = open.get_mut(key) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    open.remove(key);
                }
            }
        }
    }
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
    /// Set by events and the newest turn's age; a current copy's holds until that ages out.
    pending: bool,
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
            pending: false,
        }
    }

    /// Whether a copy at `self` is current with `now`.
    fn current_with(&self, now: &Self) -> bool {
        (self.seq, self.changed_at, self.active) == (now.seq, now.changed_at, now.active)
    }

    fn parse(text: &str) -> Option<Self> {
        let flag = |part: Option<&str>| match part? {
            "1" => Some(true),
            "0" => Some(false),
            _ => None,
        };
        let mut parts = text.split('.');
        let seq = parts.next()?.parse().ok()?;
        let changed_at = parts.next()?.parse().ok()?;
        let active = flag(parts.next())?;
        let pending = flag(parts.next())?;
        parts.next().is_none().then_some(Self {
            seq,
            changed_at,
            active,
            pending,
        })
    }
}

impl std::fmt::Display for StateVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}.{}.{}.{}",
            self.seq,
            self.changed_at,
            u8::from(self.active),
            u8::from(self.pending)
        )
    }
}

/// Started-at bound (micros) below which a turn marked running is treated as dead.
pub(super) fn running_since(now: i64) -> i64 {
    let max_turn = get_o2_config().ai.chat_max_turn_secs.max(60) as i64;
    now - (max_turn + RUNNING_GRACE_SECS) * MICROS_PER_SEC
}

pub(super) fn admit_error_response(error: AdmitError) -> Response {
    match error {
        AdmitError::InvalidSession(message) => error::invalid_request(message),
        AdmitError::NotRegistered => {
            error::permission_denied("Chat history is only available to registered users")
        }
        AdmitError::NotFound(message) => error::not_found(message),
        AdmitError::Busy => lease_busy(None).into_response(),
        AdmitError::TurnLimit(scope) => turn_limit_response(scope),
        AdmitError::AlreadySubmitted => already_submitted().into_response(),
        AdmitError::Unavailable(message) => error::history_unavailable(message),
    }
}

/// A refused turn admission; a busy chat names its running turn when this node runs it.
pub(super) async fn turn_admit_error_response(
    error: AdmitError,
    org_id: &str,
    session_id: Option<&str>,
) -> Response {
    match (error, session_id.and_then(normalize_uuid)) {
        (AdmitError::Busy, Some(session_id)) => {
            lease_busy(running_turn_id(org_id, &session_id).await).into_response()
        }
        (error, _) => admit_error_response(error),
    }
}

/// The caller's own active chat, or a 404 that does not reveal whether it exists for another.
pub(super) async fn owned_chat(
    org_id: &str,
    session_id: &str,
    owner: &str,
) -> Result<Model, Response> {
    let Some(session_id) = normalize_uuid(session_id) else {
        return Err(error::invalid_request("Invalid session id"));
    };
    match ai_chat_sessions::get(org_id, &session_id).await {
        Ok(Some(row)) if row.user_id == owner && row.status == STATUS_ACTIVE => Ok(row),
        Ok(_) => Err(error::not_found("Unknown conversation")),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read chat {org_id}/{session_id}: {e}");
            Err(error::history_unavailable(
                "Chat history is unavailable; please retry",
            ))
        }
    }
}

/// The chat's running turn: this node's registry first, else its record, wherever it runs.
pub(super) async fn running_turn_id(org_id: &str, session_id: &str) -> Option<String> {
    if let Some(turn) = registry::get(org_id, session_id) {
        return Some(turn.turn_id);
    }
    let since = running_since(config::utils::time::now_micros());
    let session_ids = [session_id.to_string()];
    match ai_chat_turns::running_for_sessions(org_id, &session_ids, since).await {
        Ok(running) => running.into_iter().last().map(|r| r.turn_id),
        Err(e) => {
            log::warn!("[AI-CHAT] cannot read the running turn of {org_id}/{session_id}: {e}");
            None
        }
    }
}

/// A chat's projected turns through `row.last_committed_seq` (lower it to cut the history).
pub(super) async fn load_turns(
    row: &Model,
    _auth: Option<&str>,
) -> Result<Vec<serde_json::Value>, Response> {
    Ok(project_turns(&load_events(row).await?))
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

/// The SSO browser login an authenticated request carries, if any (see [`cookie_login`]).
pub fn login_key(headers: &axum::http::HeaderMap) -> Option<String> {
    let jar = axum_extra::extract::CookieJar::from_headers(headers);
    let raw = config::utils::base64::decode_raw(jar.get("auth_tokens")?.value()).ok()?;
    let tokens: AuthTokens = serde_json::from_slice(&raw).ok()?;
    cookie_login(&tokens, true)
}

/// The cookie's login if the server's binding verifies; an older cookie's is its live session.
pub fn cookie_login(tokens: &AuthTokens, session_live: bool) -> Option<String> {
    let session_id = tokens.session_id()?;
    let Some(value) = tokens.login_id.as_deref() else {
        return session_live.then(|| session_id.to_string());
    };
    let (login, mac) = value.split_once('.')?;
    let expected = login_mac(login, session_id, &tokens.refresh_token);
    let genuine = mac.len() == expected.len()
        && mac
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0;
    genuine.then(|| login.to_string())
}

/// `login_id` for a cookie: the login, bound to the session and refresh token it is issued with.
pub fn bound_login_id(login: &str, session_id: &str, refresh_token: &str) -> String {
    format!("{login}.{}", login_mac(login, session_id, refresh_token))
}

pub(super) fn user_email(req: &axum::extract::Request) -> Option<String> {
    req.headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// 429 `turn_limit`, its reason also in the legacy `error_code` (E2E #5).
pub(super) fn turn_limit_response(scope: &str) -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::TurnLimit,
        "Too many AI responses are running at once; please wait for one to finish",
    )
    .legacy_code(TURN_LIMIT)
    .with("scope", scope)
    .into_response()
}

/// History routes answer a deployment without chat persistence with a 404.
pub(super) fn history_not_enabled() -> Response {
    AiErrorEnvelope::new(AiErrorCode::NotEnabled, "Chat history is not enabled")
        .status(StatusCode::NOT_FOUND)
        .into_response()
}

/// A chat whose stored events could not all be read; never shown as a partial chat.
pub(super) fn history_unreadable() -> AiErrorEnvelope {
    AiErrorEnvelope::new(
        AiErrorCode::HistoryUnavailable,
        "This conversation's history could not be read in full; please retry",
    )
    .legacy_code("history_unavailable")
}

pub(super) fn already_submitted() -> AiErrorEnvelope {
    AiErrorEnvelope::new(
        AiErrorCode::AlreadySubmitted,
        "This turn was already submitted; reload the conversation to see its result",
    )
}

/// `active_turn_id` lets the client offer to stop the running turn.
pub(super) fn lease_busy(active_turn_id: Option<String>) -> AiErrorEnvelope {
    // The Slack bridge matches the legacy `error_code`, not the text.
    let busy = AiErrorEnvelope::new(
        AiErrorCode::TurnBusy,
        "Another turn is already running in this conversation",
    )
    .legacy_code(TURN_ALREADY_RUNNING);
    match active_turn_id {
        Some(turn_id) => busy.with("active_turn_id", turn_id),
        None => busy,
    }
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
                   recently active first, keyset-paginated. Each carries `active_turn` (and \
                   `active_turn_id`) while one of its turns runs on any node, and \
                   `pending_approval` (and `pending_approval_id`) when its newest turn, started \
                   in the last 24 hours, stored a request for confirmation that the caller has \
                   not yet answered through `/confirm`; the latter is a hint, so re-read the \
                   conversation before acting on it.",
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
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let cursor = match params.cursor.as_deref().map(decode_cursor) {
        Some(None) => return error::invalid_request("Invalid cursor"),
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
            return error::history_unavailable("Chat history is unavailable; please retry");
        }
    };
    let next_cursor = if rows.len() as u64 > limit {
        rows.truncate(limit as usize);
        rows.last().map(encode_cursor)
    } else {
        None
    };
    let (running, pending) = list_markers(&org_id, &user_email, &rows, running_since).await;
    let chats = rows
        .into_iter()
        .map(|row| {
            let session_id = row.session_id.clone();
            ChatSummary::from(row).with_markers(running.get(&session_id), pending.get(&session_id))
        })
        .collect();
    Json(ChatListResponse { chats, next_cursor }).into_response()
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
                   `known_version`; with the same seq but another version, every turn does. \
                   `active_turn_id` and `pending_approval` are as in the list; a `not_modified` \
                   answer repeats the copy's `pending_approval` flag, without its id.",
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
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
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
    let active = records
        .iter()
        .rfind(|r| ai_chat_turns::is_running(r, running_since(now)))
        .cloned();
    let mut version = StateVersion::of(&row, &records, active.is_some());
    let known = params
        .known_version
        .as_deref()
        .and_then(StateVersion::parse);
    let answers = answers_in_newest(&org_id, &user_email, &row.session_id, records.last()).await;
    // An answer since the copy may leave another request pending; only a full read can count.
    if params.known_seq == Some(row.last_committed_seq)
        && let Some(known) = known
            .filter(|k| k.current_with(&version))
            .filter(|k| !(k.pending && answers > 0))
    {
        // The copy's id stays with the copy; only the flag is repeated, and only while it holds.
        version.pending = still_pending(known.pending, records.last(), now);
        let pending = version.pending.then(String::new);
        return Json(ChatDetailResponse {
            chat: ChatSummary::from(row).with_markers(active.as_ref(), pending.as_ref()),
            state_version: version.to_string(),
            not_modified: true,
            partial_from_seq: None,
            has_more: false,
            turns: None,
        })
        .into_response();
    }

    let events = match load_events(&row).await {
        Ok(events) => events,
        Err(resp) => return resp,
    };
    let newest = records.last().filter(|r| recent_turn(r, now));
    let pending = pending_approval_in(&events, newest)
        .filter(|_| unanswered(confirmations_in(&events, newest), answers));
    version.pending = pending.is_some();
    let turns = project_turns(&events);
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
        chat: ChatSummary::from(row).with_markers(active.as_ref(), pending.as_ref()),
        state_version: version.to_string(),
        not_modified: false,
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
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
    }
    let body = match axum::body::to_bytes(in_req.into_body(), 16 * 1024).await {
        Ok(b) => b,
        Err(_) => return error::invalid_request("Request body too large"),
    };
    let Ok(RenameRequest { title }) = serde_json::from_slice::<RenameRequest>(&body) else {
        return error::invalid_request("Expected {\"title\": string}");
    };
    let title = title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return error::invalid_request(format!(
            "The title must be 1 to {MAX_TITLE_CHARS} characters"
        ));
    }
    let Some(session_id) = normalize_uuid(&session_id) else {
        return error::invalid_request("Invalid session id");
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    match ai_chat_sessions::rename(&org_id, &session_id, &owner, title).await {
        Ok(true) => MetaHttpResponse::json(serde_json::json!({"title": title})),
        Ok(false) => error::not_found("Unknown conversation"),
        Err(e) => {
            log::error!("[AI-CHAT] cannot rename {org_id}/{session_id}: {e}");
            error::history_unavailable("Chat history is unavailable; please retry")
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
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
    }
    let Some(session_id) = normalize_uuid(&session_id) else {
        return error::invalid_request("Invalid session id");
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
        Ok(false) => return error::not_found("Unknown conversation"),
        Err(e) => {
            log::error!("[AI-CHAT] cannot delete {org_id}/{session_id}: {e}");
            return error::history_unavailable("Chat history is unavailable; please retry");
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
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let session_ids = match openobserve_core::ai_chat::delete_all_for_user(&org_id, &owner).await {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("[AI-CHAT] cannot clear chats of {org_id}/{owner}: {e}");
            return error::history_unavailable("Chat history is unavailable; please retry");
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

/// StreamAiChatTurn
#[utoipa::path(
    get,
    path = "/{org_id}/ai/chats/{session_id}/turns/{turn_id}/stream",
    context_path = "/api",
    tag = "AI",
    operation_id = "StreamAiChatTurn",
    summary = "Follow one turn of an AI conversation from a seq",
    description = "Server-sent events of the caller's turn: the frames of every committed event \
                   past `from_seq`, then new ones as they are committed while the turn runs, then \
                   the turn's terminal frame (`complete`, `cancelled` or `error`). Every message \
                   carries `id: N`, as on the live stream: a frame's `id` is the last seq it \
                   comes after, and an `id: N` message without data marks that everything \
                   through seq N was sent. A client that lost the connection drops the frames \
                   that carried the last id it saw and resumes from that id (`from_seq` or \
                   `Last-Event-ID`, which wins). A comment line is sent every 15 s. A tail that \
                   falls behind ends with `error{code:\"stream_dropped\"}` (no id) and is resumed \
                   the same way. 429 `rate_limited` past the open-tail caps of a user or a turn. \
                   Requires chat persistence.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID"),
        ("turn_id" = String, Path, description = "Turn ID (`x-o2-assistant-turn-id`)"),
        ("from_seq" = Option<i64>, Query, description = "Last seq the caller applied (default: none)"),
        ("Last-Event-ID" = Option<i64>, Header, description = "Overrides `from_seq`"),
    ),
    responses(
        (status = 200, description = "The turn's frames", content_type = "text/event-stream", body = String),
        (status = 404, description = "Unknown turn (`not_found`) or chat persistence off (`not_enabled`)", body = Object),
        (status = 410, description = "The turn's stored events have expired (`turn_expired`)", body = Object),
        (status = 429, description = "Too many open tails of this user or turn (`rate_limited`)", body = Object),
        (status = 503, description = "History temporarily unreadable", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn stream_turn(
    Path((org_id, session_id, turn_id)): Path<(String, String, String)>,
    Query(params): Query<TailParams>,
    in_req: axum::extract::Request,
) -> Response {
    let Some(user_email) = user_email(&in_req) else {
        return error::session_expired("Unauthorized");
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return history_not_enabled();
    }
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let row = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(row) => row,
        Err(resp) => return resp,
    };
    let Some(turn_id) = normalize_uuid(&turn_id) else {
        return error::not_found("Unknown turn");
    };
    let record = match ai_chat_turns::get(&org_id, &row.session_id, &turn_id).await {
        Ok(Some(record)) => record,
        Ok(None) => return error::not_found("Unknown turn"),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read turn {turn_id} of {org_id}/{session_id}: {e}");
            return error::history_unavailable("Chat history is unavailable; please retry");
        }
    };
    let now = config::utils::time::now_micros();
    if turn_expired(&row, &record, get_o2_config().ai.chat_retention_days, now) {
        return turn_expired_response();
    }
    let Some(slot) = TailSlot::take(&org_id, &owner, &row.session_id, &turn_id) else {
        return AiErrorEnvelope::new(
            AiErrorCode::RateLimited,
            "Too many open streams of this answer; close another tab and retry",
        )
        .retry_after(Some(TAIL_KEEPALIVE.as_secs()))
        .into_response();
    };
    let from_seq = last_event_id(in_req.headers())
        .or(params.from_seq)
        .unwrap_or(NO_SEQ);
    // Subscribed before storage is read, so no commit falls between the two.
    let feed = registry::subscribe(&org_id, &row.session_id, &turn_id);
    let mut tail = TurnTail::new(&record, from_seq);
    tail.end_seq = turn_end_seq(&record).await;
    if let Err(resp) = catch_up(&mut tail, &org_id, &row.session_id).await {
        return resp;
    }
    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(TAIL_CHANNEL);
    tokio::spawn(follow(tail, record, feed, tx, slot));
    let body = futures::stream::unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|chunk| (Ok::<_, std::convert::Infallible>(chunk), rx))
    });
    super::chat::sse_response(axum::body::Body::from_stream(body))
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

/// Every committed event of a chat; a chat that cannot be read whole is a 503, never partial.
async fn load_events(row: &Model) -> Result<Vec<DurableEvent>, Response> {
    match openobserve_core::ai_chat::read_committed_events(row, NO_SEQ).await {
        Ok(events) => Ok(events),
        // Logged and counted by the reader.
        Err(_) => Err(history_unreadable().into_response()),
    }
}

/// The cluster-keyed MAC that ties a login id to one cookie's session and refresh token.
fn login_mac(login: &str, session_id: &str, refresh_token: &str) -> String {
    registry::login_binding_mac(&format!("ai-login\n{login}\n{session_id}\n{refresh_token}"))
}

fn project_turns(events: &[DurableEvent]) -> Vec<Value> {
    let mut projected = openobserve_core::ai_chat::projection::project(events);
    match projected.get_mut("turns").map(Value::take) {
        Some(Value::Array(turns)) => turns,
        _ => Vec::new(),
    }
}

/// Each listed chat's running turn and pending approval: one query and one search for the page.
async fn list_markers(
    org_id: &str,
    user_email: &str,
    rows: &[Model],
    running_since: i64,
) -> (HashMap<String, TurnRecord>, HashMap<String, String>) {
    let session_ids: Vec<String> = rows.iter().map(|r| r.session_id.clone()).collect();
    let (running, pending) = tokio::join!(
        ai_chat_turns::running_for_sessions(org_id, &session_ids, running_since),
        list_pending(org_id, user_email, rows),
    );
    // Markers annotate the list; an unreadable marker leaves it unset instead of failing the list.
    let running = running
        .unwrap_or_else(|e| {
            log::error!("[AI-CHAT] cannot read the running turns of {org_id}: {e}");
            Vec::new()
        })
        .into_iter()
        .map(|r| (r.session_id.clone(), r))
        .collect();
    let pending = pending.unwrap_or_else(|e| {
        log::warn!("[AI-CHAT] cannot read the pending approvals of {org_id}: {e}");
        HashMap::new()
    });
    (running, pending)
}

/// The pending approvals of listed chats, searched from their newest turns' starts on.
async fn list_pending(
    org_id: &str,
    user_email: &str,
    rows: &[Model],
) -> Result<HashMap<String, String>, openobserve_core::ai_chat::ReadError> {
    let keys: Vec<(String, String)> = rows
        .iter()
        .filter_map(|r| Some((r.session_id.clone(), r.last_turn_id.clone()?)))
        .collect();
    let newest = ai_chat_turns::get_many(org_id, &keys)
        .await
        .map_err(|e| openobserve_core::ai_chat::ReadError::Search(format!("turn records: {e}")))?;
    let now = config::utils::time::now_micros();
    let chats: Vec<(&Model, &str, i64)> = newest
        .iter()
        .filter(|turn| recent_turn(turn, now))
        .filter_map(|turn| {
            let row = rows.iter().find(|r| r.session_id == turn.session_id)?;
            Some((row, turn.turn_id.as_str(), turn.started_at))
        })
        .collect();
    let sessions: Vec<(String, i64)> = chats
        .iter()
        .map(|(r, _, started)| (r.session_id.clone(), *started))
        .collect();
    let (pending, answers) = tokio::join!(
        openobserve_core::ai_chat::pending_confirmations(org_id, &chats),
        super::turn_marks::answers_since(org_id, user_email, &sessions),
    );
    Ok(pending?
        .into_iter()
        .filter(|(session_id, (_, asked))| {
            unanswered(*asked, answers.get(session_id).copied().unwrap_or(0))
        })
        .map(|(session_id, (call, _))| (session_id, call))
        .collect())
}

/// The newest turn still waits while it asked more confirmations than the member has answered.
fn unanswered(asked: usize, answered: usize) -> bool {
    asked > answered
}

/// How many confirmations the member answered in this chat since its newest turn started.
async fn answers_in_newest(
    org_id: &str,
    user_email: &str,
    session_id: &str,
    newest: Option<&TurnRecord>,
) -> usize {
    let Some(newest) = newest else {
        return 0;
    };
    let sessions = [(session_id.to_string(), newest.started_at)];
    super::turn_marks::answers_since(org_id, user_email, &sessions)
        .await
        .remove(session_id)
        .unwrap_or(0)
}

/// The newest turn's confirmation requests: one per call id, or per event without one.
fn confirmations_in(events: &[DurableEvent], newest: Option<&TurnRecord>) -> usize {
    let Some(newest) = newest else {
        return 0;
    };
    let Some(start) = newest.start_seq else {
        return 0;
    };
    let end = newest.end_seq.unwrap_or(i64::MAX);
    let asked: std::collections::HashSet<String> = events
        .iter()
        .filter(|e| (start..=end).contains(&e.seq))
        .filter_map(|e| {
            let call = openobserve_core::ai_chat::projection::delete_confirmation_call(
                &e.event_type,
                &e.data,
            )?;
            Some(if call.is_empty() {
                format!("#{}", e.seq)
            } else {
                call
            })
        })
        .collect();
    asked.len()
}

/// A current copy's pending flag: its own, until the newest turn ages out of the window.
fn still_pending(known: bool, newest: Option<&TurnRecord>, now: i64) -> bool {
    known && newest.is_some_and(|r| recent_turn(r, now))
}

/// Whether a newest turn is young enough for its confirmation request to be reported.
fn recent_turn(record: &TurnRecord, now: i64) -> bool {
    record.started_at >= now - PENDING_APPROVAL_MAX_AGE
}

/// The call id (empty: unknown) of the confirmation request the newest turn stored, if any.
fn pending_approval_in(events: &[DurableEvent], newest: Option<&TurnRecord>) -> Option<String> {
    let newest = newest?;
    let start = newest.start_seq?;
    let end = newest.end_seq.unwrap_or(i64::MAX);
    events
        .iter()
        .rev()
        .filter(|e| (start..=end).contains(&e.seq))
        .find_map(|e| {
            openobserve_core::ai_chat::projection::delete_confirmation_call(&e.event_type, &e.data)
        })
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

/// The terminal frame a failed turn's live stream would have ended with; `code` is the stored one.
fn error_frame(error: &str, code: Option<&str>) -> Value {
    let (ledger, action) = code.map_or(
        (AiErrorCode::Unknown, AiErrorAction::None),
        AiErrorCode::live_failure,
    );
    let mut frame = AiErrorEnvelope::new(ledger, error)
        .retryable(action == AiErrorAction::Retry)
        .action(Some(action))
        .body();
    if let Some(obj) = frame.as_object_mut() {
        obj.insert("type".into(), "error".into());
        obj.insert("error_code".into(), code.into());
    }
    frame
}

/// The browser-facing text of a failed turn; provider details never leave the server.
fn failed_turn_message(code: Option<&str>) -> String {
    match code {
        Some(code) => format!("The response failed ({code}). Please try again."),
        None => "The response failed. Please try again.".to_string(),
    }
}

/// Reads the turn's events committed past what the tail holds; a 503 when they cannot be read.
async fn catch_up(tail: &mut TurnTail, org_id: &str, session_id: &str) -> Result<(), Response> {
    let row = match ai_chat_sessions::get(org_id, session_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return Ok(()),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read chat {org_id}/{session_id} for a tail: {e}");
            return Err(error::history_unavailable(
                "Chat history is unavailable; please retry",
            ));
        }
    };
    let upto = tail.end_seq.map_or(row.last_committed_seq, |end| {
        end.min(row.last_committed_seq)
    });
    if upto <= tail.last_seq() {
        return Ok(());
    }
    // A lowered watermark keeps later turns out; the turn's own start bounds the searched time.
    let bounded = Model {
        last_committed_seq: upto,
        first_event_at: row.first_event_at.map(|at| at.max(tail.started_at)),
        ..row
    };
    match openobserve_core::ai_chat::read_committed_events(&bounded, tail.last_seq()).await {
        Ok(events) => {
            tail.push(events);
            Ok(())
        }
        // Logged and counted by the reader.
        Err(_) => Err(history_unreadable().into_response()),
    }
}

/// Sends the turn's frames until it ends: from the owner's feed on its node, else by polling.
async fn follow(
    mut tail: TurnTail,
    mut record: TurnRecord,
    mut feed: Option<TurnFeed>,
    tx: tokio::sync::mpsc::Sender<Bytes>,
    _slot: TailSlot,
) {
    let flush = Duration::from_millis(get_o2_config().ai.chat_persist_flush_interval_ms.max(50));
    let mut poll = flush;
    let start = tokio::time::Instant::now() + TAIL_KEEPALIVE;
    let mut keepalive = tokio::time::interval_at(start, TAIL_KEEPALIVE);
    // Events are projected at most once per flush interval, however fast they commit.
    let mut next_flush = tokio::time::Instant::now();
    loop {
        if tail.has_unsent() && tokio::time::Instant::now() >= next_flush {
            if !send_all(&tx, tail.take_messages()).await {
                return;
            }
            next_flush = tokio::time::Instant::now() + flush;
        }
        if let Some(status) = ended_as(&record) {
            tail.end_seq = turn_end_seq(&record).await;
            let last = match catch_up(&mut tail, &record.org_id, &record.session_id).await {
                Ok(()) => {
                    let terminal = terminal_frame(&record, status, tail.last_seq());
                    end_messages(&mut tail, &terminal)
                }
                Err(_) => vec![stream_dropped(&tail.turn_id)],
            };
            send_all(&tx, last).await;
            return;
        }
        let item = tokio::select! {
            item = next_feed(&mut feed) => Some(item),
            _ = tokio::time::sleep(poll), if feed.is_none() => None,
            _ = tokio::time::sleep_until(next_flush), if tail.has_unsent() => continue,
            _ = keepalive.tick() => {
                if tx.send(Bytes::from_static(b": keepalive\n\n")).await.is_err() {
                    return;
                }
                continue;
            }
        };
        let go_on = match item {
            Some(item) => on_feed(item, &mut tail, &mut feed, &mut record, &tx).await,
            None => {
                let before = tail.last_seq();
                let go_on = on_poll(&mut tail, &mut record, &tx).await;
                poll = next_poll(poll, flush, tail.last_seq() > before);
                go_on
            }
        };
        if !go_on {
            return;
        }
    }
}

/// One item of the owner's feed; `false` once the tail has ended.
async fn on_feed(
    item: FeedRecv,
    tail: &mut TurnTail,
    feed: &mut Option<TurnFeed>,
    record: &mut TurnRecord,
    tx: &tokio::sync::mpsc::Sender<Bytes>,
) -> bool {
    let (org_id, session_id) = (record.org_id.clone(), record.session_id.clone());
    match item {
        FeedRecv::Item(FeedItem::Event(event)) => {
            if !tail.push([event.as_ref().clone()])
                && catch_up(tail, &org_id, &session_id).await.is_err()
            {
                send_all(tx, vec![stream_dropped(&tail.turn_id)]).await;
                return false;
            }
            true
        }
        // The turn's row is closed before its end frame is published.
        FeedRecv::Item(FeedItem::End(frame)) => {
            let committed = frame.get("last_committed_seq").and_then(Value::as_i64);
            let caught_up = match committed {
                Some(committed) if committed <= tail.last_seq() => Ok(()),
                _ => catch_up(tail, &org_id, &session_id).await,
            };
            let last = match caught_up {
                Ok(()) => end_messages(tail, &frame),
                Err(_) => vec![stream_dropped(&tail.turn_id)],
            };
            send_all(tx, last).await;
            false
        }
        FeedRecv::Lagged(_) => {
            send_all(tx, vec![stream_dropped(&tail.turn_id)]).await;
            false
        }
        FeedRecv::Closed => {
            *feed = None;
            refresh_record(record).await;
            true
        }
    }
}

/// One poll of storage for a turn running on another node; `false` once the tail has ended.
async fn on_poll(
    tail: &mut TurnTail,
    record: &mut TurnRecord,
    tx: &tokio::sync::mpsc::Sender<Bytes>,
) -> bool {
    // A turn that ended is read up to its own end by the caller, never into the next turn.
    refresh_record(record).await;
    if ended_as(record).is_none()
        && catch_up(tail, &record.org_id, &record.session_id)
            .await
            .is_err()
    {
        send_all(tx, vec![stream_dropped(&tail.turn_id)]).await;
        return false;
    }
    true
}

/// A quiet turn on another node is polled less often, up to `TAIL_POLL_MAX`; progress resets it.
fn next_poll(poll: Duration, flush: Duration, progressed: bool) -> Duration {
    if progressed {
        flush
    } else {
        (poll * 2).clamp(flush, TAIL_POLL_MAX.max(flush))
    }
}

/// What is left to send, then the turn's terminal after its last seq.
fn end_messages(tail: &mut TurnTail, terminal: &Value) -> Vec<Bytes> {
    let mut messages = tail.take_messages();
    messages.push(sse_message(tail.last_seq(), terminal));
    messages
}

async fn next_feed(feed: &mut Option<TurnFeed>) -> FeedRecv {
    match feed {
        Some(feed) => feed.recv().await,
        None => std::future::pending().await,
    }
}

/// Re-reads the turn's record; a failed read keeps the last one, whose age still ends the tail.
async fn refresh_record(record: &mut TurnRecord) {
    match ai_chat_turns::get(&record.org_id, &record.session_id, &record.turn_id).await {
        Ok(Some(fresh)) => *record = fresh,
        Ok(None) => {}
        Err(e) => log::warn!(
            "[AI-CHAT] cannot re-read turn {} of {}/{}: {e}",
            record.turn_id,
            record.org_id,
            record.session_id
        ),
    }
}

/// The turn's last seq: its recorded end, else the seq before the chat's next recorded turn.
async fn turn_end_seq(record: &TurnRecord) -> Option<i64> {
    if record.end_seq.is_some() || record.status == TURN_RUNNING {
        return record.end_seq;
    }
    let records = match ai_chat_turns::list_for_session(&record.org_id, &record.session_id).await {
        Ok(records) => records,
        Err(e) => {
            log::warn!(
                "[AI-CHAT] cannot bound turn {} of {}/{}: {e}",
                record.turn_id,
                record.org_id,
                record.session_id
            );
            // Unbounded could show the next turn's answer as this one's; nothing is safer.
            return record.start_seq.map(|start| start - 1);
        }
    };
    next_turn_start(&records, record).map(|start| start - 1)
}

/// `false` once the client is gone.
async fn send_all(tx: &tokio::sync::mpsc::Sender<Bytes>, messages: Vec<Bytes>) -> bool {
    for message in messages {
        if tx.send(message).await.is_err() {
            return false;
        }
    }
    true
}

/// The first seq of the turn recorded after `record`, if any.
fn next_turn_start(records: &[TurnRecord], record: &TurnRecord) -> Option<i64> {
    let start = record.start_seq?;
    records
        .iter()
        .filter(|r| r.turn_id != record.turn_id && r.started_at >= record.started_at)
        .filter_map(|r| r.start_seq)
        .filter(|next| *next >= start)
        .min()
}

/// How the turn ended, if it did; a running record past the longest allowed turn died.
fn ended_as(record: &TurnRecord) -> Option<&str> {
    if record.status != TURN_RUNNING {
        return Some(record.status.as_str());
    }
    let since = running_since(config::utils::time::now_micros());
    (!ai_chat_turns::is_running(record, since)).then_some(TURN_INTERRUPTED)
}

/// The terminal frame of a turn that ended as `status`, rebuilt from its record.
fn terminal_frame(record: &TurnRecord, status: &str, committed: i64) -> Value {
    let code = record.error_code.as_deref();
    let mut frame = match status {
        TURN_COMPLETED => serde_json::json!({"type": "complete", "persisted": true}),
        TURN_CANCELLED if code != Some(SIGNED_OUT) => {
            serde_json::json!({"type": "cancelled", "cancelled": true, "persisted": true})
        }
        _ => {
            let code = code.or((status == TURN_INTERRUPTED).then_some("stream_interrupted"));
            error_frame(&failed_turn_message(code), code)
        }
    };
    if let Some(obj) = frame.as_object_mut() {
        obj.insert("turn_id".into(), record.turn_id.clone().into());
        obj.insert("last_committed_seq".into(), committed.into());
    }
    frame
}

/// A tail that fell behind; it carries no `id`, so the client resumes from what it applied.
fn stream_dropped(turn_id: &str) -> Bytes {
    AiErrorEnvelope::new(
        AiErrorCode::StreamDropped,
        "The answer's stream fell behind; resume it from the last seq",
    )
    .with("turn_id", turn_id)
    .to_sse_frame()
}

/// The frames of the turn these events are; the record's typed terminal is its only end or error.
fn turn_frames(events: &[DurableEvent]) -> Vec<Value> {
    project_turns(events)
        .into_iter()
        .filter_map(|turn| match turn {
            Value::Object(mut turn) => turn.remove("frames"),
            _ => None,
        })
        .flat_map(|frames| match frames {
            Value::Array(frames) => frames,
            _ => Vec::new(),
        })
        .filter(|f| {
            !matches!(
                f.get("type").and_then(Value::as_str),
                Some("complete" | "cancelled" | "error")
            )
        })
        .collect()
}

/// The frames that turn `old` into `new`; a text that grew is sent as its new suffix.
fn frames_between(old: &[FrameRun], new: &[FrameRun]) -> Vec<Value> {
    let common = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let mut rest = new[common..].to_vec();
    if let (Some(FrameRun::Text(had)), Some(FrameRun::Text(grown))) =
        (old.get(common), rest.first_mut())
        && grown.starts_with(had.as_str())
    {
        grown.drain(..had.len());
        if grown.is_empty() {
            rest.remove(0);
        }
    }
    rest.into_iter().map(FrameRun::into_frame).collect()
}

fn frame_runs(frames: Vec<Value>) -> Vec<FrameRun> {
    let mut runs: Vec<FrameRun> = Vec::with_capacity(frames.len());
    for frame in frames {
        let delta = (frame.get("type").and_then(Value::as_str) == Some("message_delta"))
            .then(|| {
                frame
                    .get("content")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .flatten();
        match (delta, runs.last_mut()) {
            (Some(text), Some(FrameRun::Text(run))) => run.push_str(&text),
            (Some(text), _) => runs.push(FrameRun::Text(text)),
            (None, _) => runs.push(FrameRun::Frame(frame)),
        }
    }
    runs
}

fn sse_message(seq: i64, frame: &Value) -> Bytes {
    Bytes::from(format!("id: {seq}\ndata: {frame}\n\n"))
}

/// An event with no data: per SSE it only moves the last event id, here to a completed seq.
fn seq_boundary(seq: i64) -> Bytes {
    Bytes::from(format!("id: {seq}\n\n"))
}

fn last_event_id(headers: &axum::http::HeaderMap) -> Option<i64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse().ok())
}

/// Retention pruned a turn that ended before its cutoff, unless the chat's rows were rewritten.
fn turn_expired(row: &Model, record: &TurnRecord, retention_days: i64, now: i64) -> bool {
    if retention_days <= 0 || record.end_seq.is_none() {
        return false;
    }
    let cutoff = now - retention_days * MICROS_PER_DAY;
    record.ended_at.unwrap_or(record.started_at) < cutoff
        && row.first_event_at.is_some_and(|at| at < cutoff)
}

fn turn_expired_response() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::TurnExpired,
        "This answer's stored events have expired",
    )
    .into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    async fn body_of(resp: Response) -> Value {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

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
            assert!(body["code"].is_string(), "{error:?}");
            assert_eq!(body["message"], message, "{error:?}");
        }
    }

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
    async fn a_turn_limit_is_a_429_coded_turn_limit_in_both_keys() {
        let resp = turn_limit_response("user");
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        let body = body_of(resp).await;
        assert_eq!(body["code"], "turn_limit");
        assert_eq!(body["error_code"], "turn_limit");
        assert_eq!(body["scope"], "user");
        assert_eq!(body["retryable"], true);
    }

    #[tokio::test]
    async fn the_duplicate_turn_409_is_already_submitted_and_the_lease_409_is_turn_busy() {
        let duplicate = already_submitted().into_response();
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);
        let duplicate = body_of(duplicate).await;
        assert_eq!(duplicate["code"], "already_submitted");
        assert_eq!(duplicate["action"], "reload");
        let busy = body_of(lease_busy(Some("t-1".into())).into_response()).await;
        assert_eq!(busy["code"], "turn_busy");
        assert_eq!(busy["error_code"], TURN_ALREADY_RUNNING);
        assert_eq!(busy["retryable"], false);
        assert_eq!(busy["action"], "none");
        assert_eq!(busy["active_turn_id"], "t-1");
        assert!(
            body_of(lease_busy(None).into_response())
                .await
                .get("active_turn_id")
                .is_none()
        );
    }

    #[tokio::test]
    async fn history_unavailable_not_enabled_and_forbidden_are_told_apart() {
        let unreadable = history_unreadable().into_response();
        assert_eq!(unreadable.status(), StatusCode::SERVICE_UNAVAILABLE);
        let unreadable = body_of(unreadable).await;
        assert_eq!(unreadable["code"], "history_unavailable");
        assert_eq!(unreadable["error_code"], "history_unavailable");
        assert_eq!(unreadable["retryable"], true);

        let off = history_not_enabled();
        assert_eq!(off.status(), StatusCode::NOT_FOUND);
        assert_eq!(body_of(off).await["code"], "not_enabled");

        let forbidden = error::permission_denied("no");
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
        assert_eq!(body_of(forbidden).await["code"], "permission_denied");
    }

    #[test]
    fn a_failed_turn_frame_carries_the_ledger_code_and_keeps_the_stored_one() {
        let frame = error_frame("The response failed.", Some("agent_unreachable"));
        assert_eq!(frame["type"], "error");
        assert_eq!(frame["code"], "agent_unavailable");
        assert_eq!(frame["error_code"], "agent_unreachable");
        assert_eq!(frame["retryable"], true, "as the live frame said");
        assert_eq!(frame["recoverable"], true);
        assert_eq!(frame["action"], "retry");
        let fenced = error_frame("The response failed.", Some("fenced"));
        assert_eq!(fenced["code"], "persistence_failed");
        assert_eq!(fenced["action"], "none");
        assert_eq!(fenced["retryable"], false);
        let crashed = error_frame("The response failed.", Some("agent_query_failed"));
        assert_eq!(crashed["code"], "internal");
        let uncoded = error_frame("The response failed.", None);
        assert_eq!(uncoded["code"], "unknown");
        assert_eq!(uncoded["action"], "none");
        assert_eq!(uncoded["error_code"], Value::Null);
    }

    #[tokio::test]
    async fn a_lease_conflict_is_a_409_with_turn_already_running() {
        let resp = admit_error_response(AdmitError::Busy);
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let body = body_of(resp).await;
        assert_eq!(body["code"], "turn_busy");
        assert_eq!(body["error_code"], "turn_already_running");
        assert_eq!(
            body["message"],
            "Another turn is already running in this conversation"
        );
    }

    #[test]
    fn a_state_version_round_trips_and_rejects_garbage() {
        let v = StateVersion {
            seq: 12,
            changed_at: 1700,
            active: true,
            pending: true,
        };
        assert_eq!(v.to_string(), "12.1700.1.1");
        assert_eq!(StateVersion::parse("12.1700.1.1"), Some(v));
        assert_eq!(
            StateVersion::parse("-1.0.0.0").map(|v| (v.seq, v.active, v.pending)),
            Some((-1, false, false))
        );
        // A version from before the pending flag is read in full once.
        for bad in [
            "",
            "12",
            "12.1700",
            "12.1700.1",
            "12.1700.2.0",
            "12.1700.1.0.0",
            "x.1.1.1",
        ] {
            assert_eq!(StateVersion::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_copy_is_current_whatever_its_pending_flag_says() {
        let now = StateVersion::of(&chat_row(), &sample_records(), true);
        let copy = StateVersion {
            pending: true,
            ..now
        };
        assert!(copy.current_with(&now));
        assert!(!StateVersion { seq: 5, ..copy }.current_with(&now));
        assert!(
            !StateVersion {
                active: false,
                ..copy
            }
            .current_with(&now)
        );
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
            first_event_at: None,
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
                "code": "unknown",
                "message": synthetic["error"],
                "retryable": false,
                "action": "none",
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

    fn event(seq: i64, event_type: &str, data: Value) -> DurableEvent {
        DurableEvent {
            id: format!("evt_{seq}"),
            aggregate_id: "ses_T".into(),
            seq,
            event_type: format!("{event_type}.1"),
            data,
        }
    }

    fn message(seq: i64, id: &str, role: &str) -> DurableEvent {
        event(
            seq,
            "message.updated",
            serde_json::json!({"info": {"id": id, "role": role, "parentID": "msg_u", "time": {"created": 1}}}),
        )
    }

    fn text_part(seq: i64, message: &str, part: &str, text: &str) -> DurableEvent {
        event(
            seq,
            "message.part.updated",
            serde_json::json!({"part": {"id": part, "messageID": message, "type": "text", "text": text}}),
        )
    }

    fn delete_request(seq: i64, call: &str) -> DurableEvent {
        let sentinel = serde_json::json!({"type": "delete_confirmation", "resource_type": "alert", "id": "a1"});
        event(
            seq,
            "message.part.updated",
            serde_json::json!({"part": {"id": "prt_d", "messageID": "msg_a", "callID": call, "tool": "o2_delete",
                "type": "tool", "state": {"status": "completed", "output": sentinel.to_string()}}}),
        )
    }

    /// A turn of seqs 0..=5 whose answer text grows over two events and gains a second part.
    fn answer_turn() -> Vec<DurableEvent> {
        vec![
            message(0, "msg_u", "user"),
            text_part(1, "msg_u", "prt_u", "why is p99 up?"),
            message(2, "msg_a", "assistant"),
            text_part(3, "msg_a", "prt_1", "Checkout latency rose at 10:02."),
            text_part(
                4,
                "msg_a",
                "prt_1",
                "Checkout latency rose at 10:02. The payments pool was saturated.",
            ),
            text_part(5, "msg_a", "prt_2", "Scale the pool to fix it."),
        ]
    }

    fn turn_record(start: i64, end: Option<i64>, status: &str) -> TurnRecord {
        TurnRecord {
            end_seq: end,
            ..record("t-tail", status, (Some(start), end), 10)
        }
    }

    /// `(id, frame)` of each SSE message; a seq boundary has no frame (`Null`).
    fn messages_of(messages: &[Bytes]) -> Vec<(Option<i64>, Value)> {
        messages
            .iter()
            .map(|m| {
                let text = std::str::from_utf8(m).unwrap();
                assert!(text.ends_with("\n\n"), "{text}");
                let id = text
                    .lines()
                    .find_map(|l| l.strip_prefix("id: "))
                    .map(|id| id.parse().unwrap());
                let data = text.lines().find_map(|l| l.strip_prefix("data: "));
                (
                    id,
                    data.map_or(Value::Null, |d| serde_json::from_str(d).unwrap()),
                )
            })
            .collect()
    }

    fn boundaries(messages: &[(Option<i64>, Value)]) -> Vec<i64> {
        messages
            .iter()
            .filter(|(_, f)| f.is_null())
            .map(|(id, _)| id.unwrap())
            .collect()
    }

    /// The client's resume rule: frames that carried the last id seen are dropped; resume from it.
    fn after_drop(received: &[(Option<i64>, Value)]) -> (Vec<(Option<i64>, Value)>, i64) {
        let last = received
            .iter()
            .filter_map(|(id, _)| *id)
            .max()
            .unwrap_or(NO_SEQ);
        let kept = received
            .iter()
            .filter(|(id, f)| f.is_null() || *id != Some(last))
            .cloned()
            .collect();
        (kept, last)
    }

    fn text_of(frames: &[(Option<i64>, Value)]) -> String {
        frames
            .iter()
            .filter(|(_, f)| f["type"] == "message_delta")
            .map(|(_, f)| f["content"].as_str().unwrap())
            .collect()
    }

    fn tail_from(
        events: Vec<DurableEvent>,
        record: &TurnRecord,
        from: i64,
    ) -> Vec<(Option<i64>, Value)> {
        let mut tail = TurnTail::new(record, from);
        assert!(tail.push(events));
        messages_of(&tail.take_messages())
    }

    #[test]
    fn list_and_detail_carry_the_running_and_waiting_markers() {
        let running = record("t-run", TURN_RUNNING, (Some(3), None), 50);
        let marked =
            ChatSummary::from(chat_row()).with_markers(Some(&running), Some(&"call_9".to_string()));
        let body = serde_json::to_value(&marked).unwrap();
        assert_eq!(body["active_turn"], true);
        assert_eq!(body["active_turn_id"], "t-run");
        assert_eq!(body["pending_approval"], true);
        assert_eq!(body["pending_approval_id"], "call_9");
        // A request whose call id could not be read is still a waiting chat.
        let unnamed = ChatSummary::from(chat_row()).with_markers(None, Some(&String::new()));
        let body = serde_json::to_value(&unnamed).unwrap();
        assert_eq!(
            (
                body["active_turn"].clone(),
                body["pending_approval"].clone()
            ),
            (false.into(), true.into())
        );
        assert!(body.get("pending_approval_id").is_none() && body.get("active_turn_id").is_none());

        let detail = ChatDetailResponse {
            chat: ChatSummary::from(chat_row()).with_markers(Some(&running), None),
            state_version: "1.2.1".into(),
            not_modified: true,
            partial_from_seq: None,
            has_more: false,
            turns: None,
        };
        let text = serde_json::to_string(&detail).unwrap();
        assert_eq!(text.matches("\"active_turn\"").count(), 1, "{text}");
        let body: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(body["active_turn_id"], "t-run");
        assert_eq!(body["pending_approval"], false);
    }

    #[test]
    fn a_second_request_in_the_same_turn_stays_pending_after_the_first_is_answered() {
        let mut events = answer_turn();
        events.push(delete_request(6, "call_1"));
        let newest = turn_record(0, Some(9), TURN_COMPLETED);
        assert_eq!(confirmations_in(&events, Some(&newest)), 1);
        assert!(!unanswered(confirmations_in(&events, Some(&newest)), 1));
        // The turn resumed and asked again; one answer covers only the first request.
        events.push(delete_request(7, "call_2"));
        events.push(delete_request(8, "call_2"));
        assert_eq!(confirmations_in(&events, Some(&newest)), 2);
        assert!(unanswered(confirmations_in(&events, Some(&newest)), 1));
        assert!(!unanswered(confirmations_in(&events, Some(&newest)), 2));
        assert_eq!(confirmations_in(&events, None), 0);
    }

    #[test]
    fn a_pending_approval_is_read_from_the_newest_turn_only() {
        let mut events = answer_turn();
        events.push(delete_request(6, "call_9"));
        events.push(text_part(7, "msg_a", "prt_3", "Confirm the delete above."));
        let newest = turn_record(0, Some(7), TURN_COMPLETED);
        assert_eq!(
            pending_approval_in(&events, Some(&newest)).as_deref(),
            Some("call_9")
        );
        let later = turn_record(8, None, TURN_RUNNING);
        assert_eq!(pending_approval_in(&events, Some(&later)), None);
        assert_eq!(pending_approval_in(&answer_turn(), Some(&newest)), None);
        assert_eq!(pending_approval_in(&events, None), None);
    }

    #[test]
    fn a_tail_sends_every_committed_frame_past_from_seq_with_its_seq_as_id() {
        let record = turn_record(0, Some(5), TURN_COMPLETED);
        let all = tail_from(answer_turn(), &record, NO_SEQ);
        let full = "Checkout latency rose at 10:02. The payments pool was saturated.Scale the pool to fix it.";
        assert_eq!(text_of(&all), full);
        // Every message has an id; a frame carries the boundary it comes after.
        assert!(all.iter().all(|(id, _)| id.is_some()));
        assert_eq!(boundaries(&all), vec![0, 1, 2, 3, 4, 5]);
        let mut boundary = NO_SEQ;
        for (id, frame) in &all {
            if frame.is_null() {
                boundary = id.unwrap();
            } else {
                assert_eq!(*id, Some(boundary), "{frame}");
            }
        }

        // A client that applied seq 3 gets only what seqs 4 and 5 added: no text twice.
        let resumed = tail_from(answer_turn(), &record, 3);
        assert_eq!(
            text_of(&resumed),
            " The payments pool was saturated.Scale the pool to fix it."
        );
        assert_eq!(boundaries(&resumed), vec![4, 5]);
        assert!(resumed.iter().all(|(id, _)| id.unwrap() >= 3));
        assert!(tail_from(answer_turn(), &record, 5).is_empty());
    }

    #[test]
    fn a_tail_dropped_anywhere_resumes_without_a_duplicate_or_a_gap() {
        let record = turn_record(0, Some(5), TURN_COMPLETED);
        let all = tail_from(answer_turn(), &record, NO_SEQ);
        let full = text_of(&all);
        for cut in 1..all.len() {
            let (kept, from) = after_drop(&all[..cut]);
            let resumed = tail_from(answer_turn(), &record, from);
            assert_eq!(text_of(&kept) + &text_of(&resumed), full, "cut after {cut}");
        }
    }

    #[test]
    fn a_live_stream_dropped_mid_seq_resumes_through_the_tail_exactly() {
        let delta = |t: &str| serde_json::json!({"type": "message_delta", "content": t});
        // The live stream tags a frame with the last durable seq received before it.
        let live = vec![
            (Some(2), delta("Checkout latency rose at 10:02.")),
            (Some(3), delta(" The payments pool")),
        ];
        let (kept, from) = after_drop(&live);
        assert_eq!(from, 3);
        let resumed = tail_from(answer_turn(), &turn_record(0, None, TURN_RUNNING), from);
        assert_eq!(
            text_of(&kept) + &text_of(&resumed),
            "Checkout latency rose at 10:02. The payments pool was saturated.Scale the pool to fix it."
        );
    }

    #[test]
    fn a_tail_only_holds_its_own_turn_and_stops_at_a_gap() {
        let mut events = answer_turn();
        events.push(message(6, "msg_next", "user"));
        let mut tail = TurnTail::new(&turn_record(0, Some(5), TURN_COMPLETED), NO_SEQ);
        assert!(tail.push(events));
        assert_eq!(tail.last_seq(), 5, "the next turn's events are left out");

        let mut running = TurnTail::new(&turn_record(0, None, TURN_RUNNING), NO_SEQ);
        assert!(running.push(answer_turn().into_iter().take(3)));
        assert!(
            !running.push([text_part(4, "msg_a", "prt_1", "x")]),
            "seq 3 is missing"
        );
        assert_eq!(running.last_seq(), 2);
        // Events arriving one by one say the same as one read of all of them.
        let mut live = TurnTail::new(&turn_record(0, None, TURN_RUNNING), NO_SEQ);
        let mut frames = Vec::new();
        for event in answer_turn() {
            assert!(live.push([event]));
            frames.extend(messages_of(&live.take_messages()));
        }
        assert_eq!(
            text_of(&frames),
            text_of(&tail_from(
                answer_turn(),
                &turn_record(0, None, TURN_RUNNING),
                NO_SEQ
            ))
        );
    }

    #[test]
    fn a_grown_text_is_sent_as_its_suffix_and_anything_else_from_where_it_differs() {
        let delta = |t: &str| serde_json::json!({"type": "message_delta", "content": t});
        let tool = serde_json::json!({"type": "tool_call", "tool": "SearchSQL"});
        let before = frame_runs(vec![delta("Hello "), delta("wor")]);
        let after = frame_runs(vec![delta("Hello world."), tool.clone()]);
        assert_eq!(
            frames_between(&before, &after),
            vec![delta("ld."), tool.clone()]
        );
        assert!(frames_between(&after, &after).is_empty());
        let rewritten = frame_runs(vec![delta("Bye."), tool.clone()]);
        assert_eq!(
            frames_between(&before, &rewritten),
            vec![delta("Bye."), tool]
        );
    }

    #[test]
    fn last_event_id_is_a_seq_or_ignored() {
        let mut headers = axum::http::HeaderMap::new();
        assert_eq!(last_event_id(&headers), None);
        headers.insert("Last-Event-ID", " 7".parse().unwrap());
        assert_eq!(last_event_id(&headers), Some(7));
        headers.insert("Last-Event-ID", "evt_7".parse().unwrap());
        assert_eq!(last_event_id(&headers), None);
    }

    #[test]
    fn a_tail_ends_with_the_terminal_its_record_names() {
        let record = |status: &str, code: Option<&str>| TurnRecord {
            error_code: code.map(str::to_string),
            ..turn_record(0, Some(5), status)
        };
        let complete = terminal_frame(&record(TURN_COMPLETED, None), TURN_COMPLETED, 5);
        assert_eq!(complete["type"], "complete");
        assert_eq!(
            (
                complete["turn_id"].clone(),
                complete["last_committed_seq"].clone()
            ),
            ("t-tail".into(), 5.into())
        );
        let stopped = terminal_frame(&record(TURN_CANCELLED, None), TURN_CANCELLED, 5);
        assert_eq!(stopped["type"], "cancelled");
        let signed_out =
            terminal_frame(&record(TURN_CANCELLED, Some(SIGNED_OUT)), TURN_CANCELLED, 5);
        assert_eq!(
            (signed_out["type"].clone(), signed_out["code"].clone()),
            ("error".into(), "signed_out".into())
        );
        assert_eq!(signed_out["action"], "sign_in");
        let failed = terminal_frame(
            &record(TURN_FAILED, Some("agent_unreachable")),
            TURN_FAILED,
            5,
        );
        assert_eq!(
            (failed["code"].clone(), failed["retryable"].clone()),
            ("agent_unavailable".into(), true.into())
        );
        let died = terminal_frame(&record(TURN_RUNNING, None), TURN_INTERRUPTED, 5);
        assert_eq!(died["error_code"], "stream_interrupted");

        let stale = TurnRecord {
            started_at: 0,
            ..turn_record(0, None, TURN_RUNNING)
        };
        assert_eq!(ended_as(&stale), Some(TURN_INTERRUPTED));
        let live = TurnRecord {
            started_at: config::utils::time::now_micros(),
            ..turn_record(0, None, TURN_RUNNING)
        };
        assert_eq!(ended_as(&live), None);
        assert_eq!(
            ended_as(&record(TURN_COMPLETED, None)),
            Some(TURN_COMPLETED)
        );
    }

    #[tokio::test]
    async fn an_unknown_turn_is_a_404_an_expired_one_a_410_and_a_lagging_tail_resumable() {
        let unknown = error::not_found("Unknown turn");
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(body_of(unknown).await["code"], "not_found");
        let expired = turn_expired_response();
        assert_eq!(expired.status(), StatusCode::GONE);
        assert_eq!(body_of(expired).await["code"], "turn_expired");

        let dropped = stream_dropped("t-1");
        let text = std::str::from_utf8(&dropped).unwrap();
        assert!(
            !text.contains("id:"),
            "the client must resume from what it applied"
        );
        let frame: Value =
            serde_json::from_str(text.trim().strip_prefix("data: ").unwrap()).unwrap();
        assert_eq!(
            (frame["type"].clone(), frame["code"].clone()),
            ("error".into(), "stream_dropped".into())
        );
        assert_eq!(
            (frame["retryable"].clone(), frame["turn_id"].clone()),
            (true.into(), "t-1".into())
        );
        assert_eq!(
            sse_message(4, &serde_json::json!({"type": "status"})),
            Bytes::from("id: 4\ndata: {\"type\":\"status\"}\n\n")
        );
    }

    #[test]
    fn a_turn_past_retention_is_expired_unless_its_rows_were_rewritten() {
        let now = 100 * MICROS_PER_DAY;
        let old = TurnRecord {
            ended_at: Some(MICROS_PER_DAY),
            ..turn_record(0, Some(5), TURN_COMPLETED)
        };
        let stored_long_ago = Model {
            first_event_at: Some(MICROS_PER_DAY),
            ..chat_row()
        };
        assert!(turn_expired(&stored_long_ago, &old, 30, now));
        let refreshed = Model {
            first_event_at: Some(now - MICROS_PER_DAY),
            ..chat_row()
        };
        assert!(!turn_expired(&refreshed, &old, 30, now));
        assert!(
            !turn_expired(&stored_long_ago, &old, 0, now),
            "no retention keeps everything"
        );
        let recent = TurnRecord {
            ended_at: Some(now),
            ..old
        };
        assert!(!turn_expired(&stored_long_ago, &recent, 30, now));
    }

    #[test]
    fn a_tail_speaks_the_frames_the_web_client_has_fixtures_for() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../web/src/composables/assistant/__fixtures__/frames"
        );
        let fixture_keys = |kind: &str| -> Option<Vec<String>> {
            let text = std::fs::read_to_string(format!("{dir}/{kind}.json")).ok()?;
            let fixture: Value = serde_json::from_str(&text).unwrap();
            Some(fixture["frame"].as_object()?.keys().cloned().collect())
        };
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../core/src/ai_chat/testdata/tool_heavy.json"
        );
        let body: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let events: Vec<DurableEvent> = body["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| DurableEvent::from_sync_event(e).unwrap())
            .collect();
        let last = events.last().unwrap().seq;
        let record = turn_record(events[0].seq, Some(last), TURN_COMPLETED);
        let mut frames = tail_from(events, &record, NO_SEQ);
        frames.retain(|(_, f)| !f.is_null());
        frames.push((Some(last), terminal_frame(&record, TURN_COMPLETED, last)));
        let kinds: std::collections::HashSet<&str> = frames
            .iter()
            .filter_map(|(_, f)| f["type"].as_str())
            .collect();
        for kind in ["message_delta", "tool_call", "tool_result", "complete"] {
            assert!(
                kinds.contains(kind),
                "the captured tail has no `{kind}`: {kinds:?}"
            );
        }
        // The server adds the turn's id and committed seq to its terminal, as the live stream does.
        let server_keys = ["turn_id", "last_committed_seq"];
        for (_, frame) in &frames {
            let kind = frame["type"].as_str().unwrap();
            let keys = fixture_keys(kind).unwrap_or_else(|| panic!("no fixture for `{kind}`"));
            // Tool and navigation frames are the projection's, checked by its golden tests.
            if !["message_delta", "complete", "cancelled"].contains(&kind) {
                continue;
            }
            for key in frame.as_object().unwrap().keys() {
                assert!(
                    keys.contains(key) || server_keys.contains(&key.as_str()),
                    "`{kind}` frame key `{key}` is not in its fixture"
                );
            }
        }
    }

    #[test]
    fn a_turn_without_a_recorded_end_ends_where_the_next_one_starts() {
        let records = sample_records();
        // t2 failed at seq 5 with nothing stored; t3 started there.
        assert_eq!(next_turn_start(&records, &records[1]), Some(5));
        let dead = record("dead", TURN_INTERRUPTED, (Some(9), None), 45);
        assert_eq!(
            next_turn_start(&[dead.clone(), records[4].clone()], &dead),
            Some(12)
        );
        assert_eq!(
            next_turn_start(&records, &records[4]),
            None,
            "the newest turn is open-ended"
        );
    }

    #[test]
    fn a_failed_turn_tail_has_exactly_one_error_and_it_is_typed() {
        let mut events = answer_turn();
        events.push(event(
            6,
            "message.updated",
            serde_json::json!({"info": {"id": "msg_a", "role": "assistant", "parentID": "msg_u",
                "error": {"name": "APIError", "data": {"message": "provider down"}}}}),
        ));
        let projected = project_turns(&events);
        assert!(
            projected[0]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["type"] == "error"),
            "the projection has its own untyped error"
        );
        let record = TurnRecord {
            error_code: Some("agent_error".into()),
            ..turn_record(0, Some(6), TURN_FAILED)
        };
        let mut frames = tail_from(events, &record, NO_SEQ);
        frames.retain(|(_, f)| !f.is_null());
        frames.push((Some(6), terminal_frame(&record, TURN_FAILED, 6)));
        let errors: Vec<&Value> = frames
            .iter()
            .map(|(_, f)| f)
            .filter(|f| f["type"] == "error")
            .collect();
        assert_eq!(errors.len(), 1, "{frames:?}");
        assert_eq!(errors[0]["code"], "provider_error");
        assert_eq!(errors[0]["error_code"], "agent_error");
    }

    async fn sent(rx: &mut tokio::sync::mpsc::Receiver<Bytes>) -> Vec<(Option<i64>, Value)> {
        let mut out = Vec::new();
        while let Ok(message) = rx.try_recv() {
            out.push(message);
        }
        messages_of(&out)
    }

    #[tokio::test]
    async fn the_owner_feed_adds_events_ends_with_its_end_frame_and_drops_a_lagging_tail() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        let mut record = turn_record(0, None, TURN_RUNNING);
        let mut tail = TurnTail::new(&record, NO_SEQ);
        assert!(tail.push(answer_turn().into_iter().take(4)));
        tail.take_messages();
        let mut feed = None;
        let next = FeedRecv::Item(FeedItem::Event(Arc::new(answer_turn().remove(4))));
        assert!(on_feed(next, &mut tail, &mut feed, &mut record, &tx).await);
        assert_eq!(tail.last_seq(), 4);
        assert!(
            sent(&mut rx).await.is_empty(),
            "frames wait for the next flush"
        );

        let end =
            serde_json::json!({"type": "complete", "turn_id": "t-tail", "last_committed_seq": 4});
        let end = FeedRecv::Item(FeedItem::End(Arc::new(end)));
        assert!(!on_feed(end, &mut tail, &mut feed, &mut record, &tx).await);
        let out = sent(&mut rx).await;
        assert_eq!(text_of(&out), " The payments pool was saturated.");
        assert_eq!(
            out.last().unwrap(),
            &(
                Some(4),
                serde_json::json!({"type": "complete", "turn_id": "t-tail", "last_committed_seq": 4})
            )
        );

        assert!(!on_feed(FeedRecv::Lagged(3), &mut tail, &mut feed, &mut record, &tx).await);
        let out = sent(&mut rx).await;
        assert_eq!(
            (out[0].0, out[0].1["code"].clone()),
            (None, "stream_dropped".into())
        );
    }

    #[test]
    fn a_quiet_poll_backs_off_and_progress_resets_it() {
        let flush = Duration::from_millis(500);
        assert_eq!(next_poll(flush, flush, false), Duration::from_secs(1));
        assert_eq!(
            next_poll(Duration::from_secs(4), flush, false),
            TAIL_POLL_MAX
        );
        assert_eq!(next_poll(TAIL_POLL_MAX, flush, true), flush);
    }

    #[test]
    fn tails_are_capped_per_user_and_per_turn_and_freed_on_drop() {
        let held: Vec<TailSlot> = (0..MAX_TAILS_PER_TURN)
            .map(|_| TailSlot::take("cap-org", "alice", "s1", "t1").unwrap())
            .collect();
        assert!(
            TailSlot::take("cap-org", "alice", "s1", "t1").is_none(),
            "per turn"
        );
        let other_turn: Vec<TailSlot> = (MAX_TAILS_PER_TURN..MAX_TAILS_PER_USER)
            .map(|i| TailSlot::take("cap-org", "alice", "s2", &format!("t{i}")).unwrap())
            .collect();
        assert!(
            TailSlot::take("cap-org", "alice", "s3", "t9").is_none(),
            "per user"
        );
        assert!(
            TailSlot::take("cap-org", "bob", "s1", "t1").is_none(),
            "the turn is still full"
        );
        assert!(TailSlot::take("cap-org", "bob", "s4", "t4").is_some());
        drop(held);
        drop(other_turn);
        assert!(TailSlot::take("cap-org", "alice", "s1", "t1").is_some());
    }

    #[test]
    fn only_a_login_id_the_server_bound_to_this_cookie_names_its_login() {
        let cookie = |sid: &str, refresh: &str, login_id: Option<String>| AuthTokens {
            access_token: format!("session {sid}"),
            refresh_token: refresh.into(),
            login_id,
        };
        let issued = Some(bound_login_id("L", "s1", "r1"));
        assert_eq!(
            cookie_login(&cookie("s1", "r1", issued.clone()), false).as_deref(),
            Some("L")
        );
        // Moved to another session or refresh token, or edited, it names nobody.
        assert_eq!(
            cookie_login(&cookie("s2", "r1", issued.clone()), true),
            None
        );
        assert_eq!(cookie_login(&cookie("s1", "r2", issued), true), None);
        assert_eq!(
            cookie_login(&cookie("s1", "r1", Some("L.00".into())), true),
            None
        );
        assert_eq!(
            cookie_login(&cookie("s1", "r1", Some("L".into())), true),
            None
        );
        // A refresh binds the same login to the new cookie.
        let refreshed = cookie("s3", "r3", Some(bound_login_id("L", "s3", "r3")));
        assert_eq!(cookie_login(&refreshed, true).as_deref(), Some("L"));
        // An older cookie is its session, and only a live one.
        assert_eq!(
            cookie_login(&cookie("s1", "r1", None), true).as_deref(),
            Some("s1")
        );
        assert_eq!(cookie_login(&cookie("s1", "r1", None), false), None);
        let basic = AuthTokens {
            access_token: "Basic eDp5".into(),
            ..Default::default()
        };
        assert_eq!(cookie_login(&basic, true), None);
        // A login handle is made under another subkey, so it can never pass as a binding.
        let handle = registry::auth_session_handle("ai-login\nL\ns1\nr1");
        assert_eq!(
            cookie_login(&cookie("s1", "r1", Some(format!("L.{handle}"))), true),
            None
        );
    }

    #[test]
    fn a_dormant_chats_confirmation_request_is_neither_searched_nor_reported() {
        let now = 10 * MICROS_PER_DAY;
        let turn = |started_at| TurnRecord {
            started_at,
            ..turn_record(0, Some(7), TURN_COMPLETED)
        };
        assert!(recent_turn(&turn(now - MICROS_PER_DAY / 2), now));
        assert!(!recent_turn(&turn(now - 2 * MICROS_PER_DAY), now));
        let mut events = answer_turn();
        events.push(delete_request(6, "call_9"));
        let old = turn(now - 2 * MICROS_PER_DAY);
        assert_eq!(
            pending_approval_in(&events, Some(&old).filter(|r| recent_turn(r, now))),
            None
        );
    }

    #[test]
    fn a_current_copy_keeps_its_pending_flag_only_inside_the_window() {
        let now = 10 * MICROS_PER_DAY;
        let turn = |started_at| TurnRecord {
            started_at,
            ..turn_record(0, Some(7), TURN_COMPLETED)
        };
        let fresh = turn(now - MICROS_PER_DAY / 2);
        assert!(still_pending(true, Some(&fresh), now));
        assert!(!still_pending(false, Some(&fresh), now));
        // A day on, with nothing new committed, the copy's flag no longer holds.
        assert!(!still_pending(true, Some(&fresh), now + MICROS_PER_DAY));
        assert!(!still_pending(true, None, now));
    }
}

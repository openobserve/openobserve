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

//! A new chat that starts from an answer a door (such as Logs "Open in chat") already showed.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::ai_chat_sessions::{self, Model as ChatModel, NewBranch};
use o2_enterprise::enterprise::ai::client::{
    DEFAULT_AGENT_TYPE, GENERATE_QUERY_AGENT_TYPE, SRE_CHAT_AGENT_TYPE,
};
use openobserve_core::ai_chat::admission::{normalize_uuid, resolve_owner};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::{
    chats::{admit_error_response, imported_title, imported_turn},
    error::{self, AiErrorCode, AiErrorEnvelope},
    shares::{SEED_MAX_BYTES, guard, require_json},
};

const MAX_SEED_TURNS: usize = 4;
const MAX_ORIGIN_CHARS: usize = 32;
const MAX_AGENT_CHARS: usize = 32;
const CHAT_AGENTS: [&str; 3] = [
    DEFAULT_AGENT_TYPE,
    SRE_CHAT_AGENT_TYPE,
    GENERATE_QUERY_AGENT_TYPE,
];

/// `POST` body: the chat the door opens, with the turns it already showed.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SeededChatRequest {
    /// The id the client gave the chat (a UUID).
    pub session_id: String,
    #[serde(default)]
    pub title: String,
    /// `o2-ai`, `sre` or `generate-query`; anything else is the default assistant.
    #[serde(default)]
    pub agent_type: String,
    /// Which door made the chat; informational.
    #[serde(default)]
    pub origin: String,
    /// One to four stored turns, in the shape a chat read returns them.
    #[schema(value_type = Vec<Object>)]
    pub turns: Vec<Value>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SeededChatResponse {
    pub session_id: String,
    pub title: String,
    pub agent_type: String,
}

/// CreateSeededAiChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chats/seeded",
    context_path = "/api",
    tag = "AI",
    operation_id = "CreateSeededAiChat",
    summary = "Start an AI conversation from turns the app already showed",
    description = "Creates a conversation owned by the caller, under the id the client chose, \
                   that starts from `turns` (an answer an entry point such as Logs already \
                   showed). The turns are read back first in the conversation and given to the \
                   assistant as context on the first message. The title and agent are kept. \
                   Posting the same id again returns the stored conversation unchanged.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(SeededChatRequest), content_type = "application/json"),
    responses(
        (status = 201, description = "The new conversation", body = inline(SeededChatResponse)),
        (status = 200, description = "The caller already has this conversation", body = inline(SeededChatResponse)),
        (status = 400, description = "Invalid body", body = Object),
        (status = 403, description = "Not allowed to start conversations", body = Object),
        (status = 404, description = "The id belongs to another conversation", body = Object),
        (status = 413, description = "The turns are too large", body = Object),
        (status = 415, description = "The body is not JSON", body = Object),
        (status = 503, description = "History temporarily unreadable", body = Object),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "create"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create_seeded(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let user_email = match guard(&in_req).and_then(|email| require_json(&in_req).map(|_| email)) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let body = match axum::body::to_bytes(in_req.into_body(), SEED_MAX_BYTES).await {
        Ok(body) => body,
        Err(_) => return too_large(),
    };
    let seeded = match SeededChat::parse(&body) {
        Ok(seeded) => seeded,
        Err(resp) => return resp,
    };
    match ai_chat_sessions::get(&org_id, &seeded.session_id).await {
        Ok(Some(row)) => return existing(&row, &owner),
        Ok(None) => {}
        Err(e) => {
            log::error!(
                "[AI-CHAT] cannot read chat {org_id}/{}: {e}",
                seeded.session_id
            );
            return unavailable();
        }
    }
    let now = now_micros();
    let seed = serde_json::json!({"as_of": now, "origin": seeded.origin, "turns": seeded.turns});
    let new = NewBranch {
        org_id: &org_id,
        session_id: &seeded.session_id,
        user_id: &owner,
        user_email: &user_email,
        agent_type: seeded.agent_type,
        title: &seeded.title,
        seed: &seed,
        branched_from: None,
    };
    match ai_chat_sessions::insert_branch(&new, now).await {
        Ok(row) => (StatusCode::CREATED, Json(response(&row))).into_response(),
        // A concurrent retry of the same POST inserted it first.
        Err(e) => match ai_chat_sessions::get(&org_id, &seeded.session_id).await {
            Ok(Some(row)) => existing(&row, &owner),
            _ => {
                log::error!(
                    "[AI-CHAT] cannot create seeded chat {org_id}/{}: {e}",
                    seeded.session_id
                );
                unavailable()
            }
        },
    }
}

/// A validated body: a canonical id, a bounded title and the turns to store.
#[derive(Debug, PartialEq)]
struct SeededChat {
    session_id: String,
    title: String,
    agent_type: &'static str,
    origin: String,
    turns: Vec<Value>,
}

impl SeededChat {
    fn parse(body: &[u8]) -> Result<Self, Response> {
        let req: SeededChatRequest = error::json_body(body)?;
        let Some(session_id) = normalize_uuid(&req.session_id) else {
            return Err(error::invalid_request("Invalid session id"));
        };
        if req.turns.is_empty() || req.turns.len() > MAX_SEED_TURNS {
            return Err(error::invalid_request(format!(
                "A seeded chat carries 1 to {MAX_SEED_TURNS} turns"
            )));
        }
        let turns = req
            .turns
            .into_iter()
            .map(seed_turn)
            .collect::<Option<Vec<Value>>>()
            .ok_or_else(|| error::invalid_request("Invalid turn"))?;
        let title = imported_title(&req.title, &Value::Array(turns.clone()));
        Ok(Self {
            session_id,
            title,
            agent_type: chat_agent(&req.agent_type),
            origin: req.origin.trim().chars().take(MAX_ORIGIN_CHARS).collect(),
            turns,
        })
    }
}

/// A stored turn as an import keeps it, plus the agent that answered it.
fn seed_turn(turn: Value) -> Option<Value> {
    let agent = turn
        .get("agent_type")
        .and_then(Value::as_str)
        .filter(|a| a.chars().count() <= MAX_AGENT_CHARS)
        .map(str::to_string);
    let mut kept = imported_turn(turn)?;
    if let (Some(agent), Some(obj)) = (agent, kept.as_object_mut()) {
        obj.insert("agent_type".into(), agent.into());
    }
    Some(kept)
}

fn chat_agent(requested: &str) -> &'static str {
    CHAT_AGENTS
        .into_iter()
        .find(|agent| *agent == requested.trim())
        .unwrap_or(DEFAULT_AGENT_TYPE)
}

/// The caller's own chat under that id answers the retry; anyone else's is not theirs to see.
fn existing(row: &ChatModel, owner: &str) -> Response {
    if row.user_id != owner || row.status != ai_chat_sessions::STATUS_ACTIVE {
        return error::not_found("Unknown conversation");
    }
    (StatusCode::OK, Json(response(row))).into_response()
}

fn response(row: &ChatModel) -> SeededChatResponse {
    SeededChatResponse {
        session_id: row.session_id.clone(),
        title: row.title.clone(),
        agent_type: row.agent_type.clone(),
    }
}

fn too_large() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::InvalidRequest,
        "The seeded turns are too large",
    )
    .status(StatusCode::PAYLOAD_TOO_LARGE)
    .into_response()
}

fn unavailable() -> Response {
    error::history_unavailable("Chat history is unavailable; please retry")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const SID: &str = "01234567-89ab-7def-8123-456789abcdef";

    fn turn(text: &str) -> Value {
        json!({
            "turn_id": "019a0000-0000-7000-8000-000000000001",
            "user": {"text": text},
            "frames": [{"type": "message", "content": "count per service"}],
            "agent_type": "generate-query",
            "secret": "dropped",
        })
    }

    fn body(value: Value) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn a_door_chat_keeps_its_title_agent_and_turns() {
        let parsed = SeededChat::parse(&body(json!({
            "session_id": SID.to_uppercase(),
            "title": "  count the logs per service ",
            "agent_type": "generate-query",
            "origin": "editor",
            "turns": [turn("count per service")],
        })))
        .unwrap();

        assert_eq!(parsed.session_id, SID);
        assert_eq!(parsed.title, "count the logs per service");
        assert_eq!(parsed.agent_type, GENERATE_QUERY_AGENT_TYPE);
        assert_eq!(parsed.turns[0]["agent_type"], "generate-query");
        assert_eq!(parsed.turns[0]["status"], "completed");
        assert!(parsed.turns[0].get("secret").is_none());
    }

    #[test]
    fn an_unknown_agent_is_the_default_assistant() {
        let parsed = SeededChat::parse(&body(json!({
            "session_id": SID, "agent_type": "rca", "turns": [turn("hi")],
        })))
        .unwrap();

        assert_eq!(parsed.agent_type, DEFAULT_AGENT_TYPE);
        assert_eq!(parsed.title, "hi");
    }

    #[test]
    fn a_body_without_turns_too_many_or_a_bad_id_is_refused() {
        let five: Vec<Value> = (0..5).map(|i| turn(&i.to_string())).collect();
        for bad in [
            json!({"session_id": SID, "turns": []}),
            json!({"session_id": SID, "turns": five}),
            json!({"session_id": "not-a-uuid", "turns": [turn("x")]}),
            json!({"session_id": SID, "turns": [{"user": {"text": "no frames"}}]}),
        ] {
            let refused = SeededChat::parse(&body(bad)).unwrap_err();
            assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        }
    }

    fn row(user_id: &str) -> ChatModel {
        ChatModel {
            org_id: "org".into(),
            session_id: SID.into(),
            user_id: user_id.into(),
            user_email: "a@x".into(),
            opencode_session_id: None,
            agent_type: GENERATE_QUERY_AGENT_TYPE.into(),
            title: "t".into(),
            title_source: ai_chat_sessions::TITLE_FROM_USER.into(),
            status: ai_chat_sessions::STATUS_ACTIVE.into(),
            created_at: 1,
            updated_at: 1,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: ai_chat_sessions::NO_SEQ,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
            branched_from: None,
        }
    }

    #[test]
    fn a_retry_by_the_owner_is_200_and_another_users_id_is_404() {
        assert_eq!(existing(&row("alice"), "alice").status(), StatusCode::OK);
        assert_eq!(
            existing(&row("bob"), "alice").status(),
            StatusCode::NOT_FOUND
        );
    }
}

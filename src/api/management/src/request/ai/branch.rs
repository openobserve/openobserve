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

//! Branching one of the caller's chats at an answer into a new chat that starts from it.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::{
    ai_chat_imports,
    ai_chat_sessions::{self, Model as ChatModel, NewBranch},
    ai_chat_turns::{self, Model as TurnRecord},
};
use openobserve_core::ai_chat::admission::resolve_owner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::{
    chats::{
        MAX_TITLE_CHARS, admit_error_response, attach_turn_status_at, load_turns, owned_chat,
        running_since,
    },
    error::{self, AiErrorCode, AiErrorEnvelope},
    shares::{SEED_MAX_BYTES, guard, newest_within, owner_name, require_json, stored_seed},
};

const MAX_BODY_BYTES: usize = 4 * 1024;
const MAX_TURN_ID_CHARS: usize = 128;
const TITLE_PREFIX: &str = "Branch of ";
const FALLBACK_TITLE: &str = "chat";
const TURN_NOT_FINISHED: &str = "turn_not_finished";
// A `version_of` loop in bad data must not hang the walk to the original turn.
const MAX_VERSION_DEPTH: usize = 64;

/// `POST` body: the answer to branch at.
#[derive(Debug, Deserialize, ToSchema)]
pub struct BranchRequest {
    /// The answer's turn: the original turn of its versions, or one of them.
    pub turn_id: String,
    /// 1-based, oldest first, among the original turn and its regenerations; absent: the newest.
    #[serde(default)]
    pub version: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BranchResponse {
    pub session_id: String,
    pub title: String,
    #[schema(inline)]
    pub branched_from: BranchSource,
}

/// The chat and answer a branch starts from, with the chat's title at branch time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BranchSource {
    pub session_id: String,
    pub turn_id: String,
    pub title: String,
}

/// Why the source cannot be cut at the requested answer.
#[derive(Debug, PartialEq, Eq)]
enum CutError {
    UnknownTurn,
    UnknownVersion,
    NotFinished,
}

/// BranchAiChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chats/{session_id}/branch",
    context_path = "/api",
    tag = "AI",
    operation_id = "BranchAiChat",
    summary = "Start a new AI conversation from one answer of yours",
    description = "Creates a new conversation owned by the caller whose first turn carries the \
                   source conversation up to and including the answer of `turn_id` (at \
                   `version`, else its newest version; earlier answers at their newest) as \
                   context, the way a continued shared conversation does. The source stays as \
                   it is.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Source chat session ID"),
    ),
    request_body(content = inline(BranchRequest), content_type = "application/json"),
    responses(
        (status = 201, description = "The new conversation", body = inline(BranchResponse)),
        (status = 400, description = "Invalid body or unknown version", body = Object),
        (status = 403, description = "Not allowed to start conversations", body = Object),
        (status = 404, description = "Unknown conversation or turn", body = Object),
        (status = 409, description = "The answer is still being generated (`error_code: turn_not_finished`)", body = Object),
        (status = 415, description = "The body is not JSON", body = Object),
        (status = 503, description = "History temporarily unreadable", body = Object),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "create"})), ("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn branch(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let user_email = match guard(&in_req).and_then(|email| require_json(&in_req).map(|_| email)) {
        Ok(email) => email,
        Err(resp) => return resp,
    };
    let owner = match resolve_owner(&user_email).await {
        Ok(owner) => owner,
        Err(e) => return admit_error_response(e),
    };
    let req = match read_request(in_req).await {
        Ok(req) => req,
        Err(resp) => return resp,
    };
    let row = match owned_chat(&org_id, &session_id, &owner).await {
        Ok(row) => row,
        Err(resp) => return resp,
    };
    let records = match ai_chat_turns::list_for_session(&org_id, &row.session_id).await {
        Ok(records) => records,
        Err(e) => {
            log::error!("[AI-CHAT] cannot read the turns of {org_id}/{session_id} to branch: {e}");
            return unavailable();
        }
    };
    let turns = match source_turns(&row).await {
        Ok(turns) => turns,
        Err(resp) => return resp,
    };
    let now = now_micros();
    let cut = match cut_at(
        turns,
        &records,
        &req.turn_id,
        req.version,
        running_since(now),
    ) {
        Ok(cut) => cut,
        Err(e) => return cut_error_response(e),
    };
    let (cut, _) = newest_within(cut, SEED_MAX_BYTES);
    let seed = serde_json::json!({
        "owner_name": owner_name(&row, false).await,
        "as_of": now,
        "turns": cut,
    });
    let source = BranchSource {
        session_id: row.session_id.clone(),
        turn_id: req.turn_id.clone(),
        title: row.title.clone(),
    };
    let title = branch_title(&row.title);
    let new_id = uuid::Uuid::now_v7().to_string();
    let branched_from = serde_json::json!(source);
    let branch = NewBranch {
        org_id: &org_id,
        session_id: &new_id,
        user_id: &owner,
        user_email: &user_email,
        agent_type: &row.agent_type,
        title: &title,
        seed: &seed,
        branched_from: &branched_from,
    };
    match ai_chat_sessions::insert_branch(&branch, now).await {
        Ok(_) => (
            StatusCode::CREATED,
            Json(BranchResponse {
                session_id: new_id,
                title,
                branched_from: source,
            }),
        )
            .into_response(),
        Err(e) => {
            log::error!("[AI-CHAT] cannot branch {org_id}/{session_id} into {new_id}: {e}");
            unavailable()
        }
    }
}

/// The body, with a turn id that can name a stored turn.
async fn read_request(in_req: axum::extract::Request) -> Result<BranchRequest, Response> {
    let body = axum::body::to_bytes(in_req.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| error::invalid_request("Request body too large"))?;
    let mut req: BranchRequest = error::json_body(&body)?;
    req.turn_id = req.turn_id.trim().to_string();
    if req.turn_id.is_empty() || req.turn_id.chars().count() > MAX_TURN_ID_CHARS {
        return Err(error::invalid_request("Invalid turn_id"));
    }
    Ok(req)
}

/// The source's turns as its owner reads them: the turns it carries first, then its own.
async fn source_turns(row: &ChatModel) -> Result<Vec<Value>, Response> {
    let own = load_turns(row, None).await?;
    let own = attach_turn_status_at(row, own, None).await;
    let mut turns = carried_turns(row).await?;
    turns.extend(own);
    Ok(turns)
}

/// The turns a chat starts from: a fork's or branch's stored seed, or its import.
async fn carried_turns(row: &ChatModel) -> Result<Vec<Value>, Response> {
    if let Some(turns) = stored_seed(row) {
        return Ok(turns);
    }
    // Only a chat that is no fork can have begun as an import.
    if row.forked_from_share.is_some() {
        return Ok(Vec::new());
    }
    match ai_chat_imports::turns_for_session(&row.org_id, &row.session_id).await {
        Ok(Some(Value::Array(turns))) => Ok(turns),
        Ok(_) => Ok(Vec::new()),
        Err(e) => {
            log::error!(
                "[AI-CHAT] cannot read the import of {} to branch: {e}",
                row.session_id
            );
            Err(unavailable())
        }
    }
}

/// `turns` through the answer of `turn_id` at `version`, every earlier answer at its newest.
fn cut_at(
    turns: Vec<Value>,
    records: &[TurnRecord],
    turn_id: &str,
    version: Option<u32>,
    running_since: i64,
) -> Result<Vec<Value>, CutError> {
    let root = original_of(records, turn_id);
    let family = versions_of(records, &root);
    let chosen = match version {
        Some(v) => v
            .checked_sub(1)
            .and_then(|i| family.get(i as usize))
            .ok_or(CutError::UnknownVersion)?
            .clone(),
        None if turn_id == root => family.last().cloned().unwrap_or_else(|| root.clone()),
        None => turn_id.to_string(),
    };
    if records
        .iter()
        .any(|r| r.turn_id == chosen && ai_chat_turns::is_running(r, running_since))
    {
        return Err(CutError::NotFinished);
    }
    // One slot per answer, at its original turn's place; a later version replaces an earlier.
    let mut slots: Vec<(Option<String>, Option<Value>)> = Vec::new();
    for turn in turns {
        let id = turn
            .get("turn_id")
            .and_then(Value::as_str)
            .map(str::to_string);
        let family_of = id.as_deref().map(|id| original_of(records, id));
        let slot = match family_of
            .as_ref()
            .and_then(|f| slots.iter().position(|(s, _)| s.as_ref() == Some(f)))
        {
            Some(slot) => slot,
            None => {
                slots.push((family_of.clone(), None));
                slots.len() - 1
            }
        };
        if family_of.as_deref() != Some(root.as_str()) || id.as_deref() == Some(chosen.as_str()) {
            slots[slot].1 = Some(turn);
        }
    }
    let target = slots
        .iter()
        .position(|(family, turn)| family.as_deref() == Some(root.as_str()) && turn.is_some())
        .ok_or(CutError::UnknownTurn)?;
    let answered = &slots[target].1;
    if answered
        .as_ref()
        .is_some_and(|t| t["status"] == ai_chat_turns::TURN_RUNNING)
    {
        return Err(CutError::NotFinished);
    }
    slots.truncate(target + 1);
    Ok(slots.into_iter().filter_map(|(_, turn)| turn).collect())
}

/// The original turn `turn_id` is a version of, or itself.
fn original_of(records: &[TurnRecord], turn_id: &str) -> String {
    let mut current = turn_id;
    for _ in 0..MAX_VERSION_DEPTH {
        match records
            .iter()
            .find(|r| r.turn_id == current)
            .and_then(|r| r.version_of.as_deref())
        {
            Some(of) => current = of,
            None => break,
        }
    }
    current.to_string()
}

/// The original turn `root` and each version of it, oldest first.
fn versions_of(records: &[TurnRecord], root: &str) -> Vec<String> {
    let mut family = vec![root.to_string()];
    family.extend(
        records
            .iter()
            .filter(|r| r.turn_id != root && original_of(records, &r.turn_id) == root)
            .map(|r| r.turn_id.clone()),
    );
    family
}

/// "Branch of {title}", within the title limit.
fn branch_title(source: &str) -> String {
    let source = source.trim();
    let base = if source.is_empty() {
        FALLBACK_TITLE
    } else {
        source
    };
    let keep = MAX_TITLE_CHARS - TITLE_PREFIX.chars().count();
    let mut title = TITLE_PREFIX.to_string();
    title.extend(base.chars().take(keep));
    title
}

fn cut_error_response(e: CutError) -> Response {
    match e {
        CutError::UnknownTurn => error::not_found("Unknown turn"),
        CutError::UnknownVersion => error::invalid_request("Unknown version of the turn"),
        CutError::NotFinished => AiErrorEnvelope::new(
            AiErrorCode::TurnBusy,
            "The answer is still being generated; branch when it finishes",
        )
        .status(StatusCode::CONFLICT)
        .legacy_code(TURN_NOT_FINISHED)
        .into_response(),
    }
}

fn unavailable() -> Response {
    error::history_unavailable("Chat history is unavailable; please retry")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const NOW: i64 = 1_000_000;

    fn record(turn: &str, status: &str, version_of: Option<&str>, started_at: i64) -> TurnRecord {
        TurnRecord {
            org_id: "org".into(),
            session_id: "sid".into(),
            turn_id: turn.into(),
            status: status.into(),
            error_code: None,
            start_seq: None,
            end_seq: None,
            started_at,
            ended_at: None,
            first_event_at: None,
            version_of: version_of.map(str::to_string),
            decisions: None,
            agent_type: None,
            handoff_from: None,
        }
    }

    fn turn(id: &str, status: &str) -> Value {
        json!({"turn_id": id, "status": status, "user": {"text": format!("q {id}")}})
    }

    fn ids(turns: &[Value]) -> Vec<&str> {
        turns
            .iter()
            .map(|t| t["turn_id"].as_str().unwrap())
            .collect()
    }

    /// t1, t2 regenerated twice (t2b, t2c), t3, then a running t4.
    fn chat() -> (Vec<Value>, Vec<TurnRecord>) {
        let records = vec![
            record("t1", "completed", None, NOW - 50),
            record("t2", "completed", None, NOW - 40),
            record("t2b", "completed", Some("t2"), NOW - 30),
            record("t2c", "failed", Some("t2b"), NOW - 20),
            record("t3", "completed", None, NOW - 10),
            record("t4", "running", None, NOW - 5),
        ];
        let turns = ["t1", "t2", "t2b", "t2c", "t3"]
            .into_iter()
            .map(|id| turn(id, "completed"))
            .chain([turn("t4", "running")])
            .collect();
        (turns, records)
    }

    #[test]
    fn the_cut_ends_at_the_answer_in_its_newest_version_by_default() {
        let (turns, records) = chat();
        let cut = cut_at(turns, &records, "t2", None, 0).unwrap();
        assert_eq!(ids(&cut), ["t1", "t2c"]);
    }

    #[test]
    fn the_cut_takes_the_requested_version_of_the_answer() {
        let (turns, records) = chat();
        let cut = cut_at(turns.clone(), &records, "t2", Some(1), 0).unwrap();
        assert_eq!(ids(&cut), ["t1", "t2"]);
        let cut = cut_at(turns.clone(), &records, "t2c", Some(2), 0).unwrap();
        assert_eq!(ids(&cut), ["t1", "t2b"], "a version names its family");
        let cut = cut_at(turns, &records, "t2b", None, 0).unwrap();
        assert_eq!(
            ids(&cut),
            ["t1", "t2b"],
            "a named version without one is that version"
        );
    }

    #[test]
    fn earlier_answers_keep_their_newest_version_and_later_turns_are_left_out() {
        let (turns, records) = chat();
        let cut = cut_at(turns, &records, "t3", None, 0).unwrap();
        assert_eq!(ids(&cut), ["t1", "t2c", "t3"]);
    }

    #[test]
    fn an_unknown_turn_or_version_is_refused() {
        let (turns, records) = chat();
        assert_eq!(
            cut_at(turns.clone(), &records, "nope", None, 0),
            Err(CutError::UnknownTurn)
        );
        for version in [0, 4] {
            assert_eq!(
                cut_at(turns.clone(), &records, "t2", Some(version), 0),
                Err(CutError::UnknownVersion),
                "{version}"
            );
        }
    }

    #[test]
    fn a_running_answer_cannot_be_branched_yet() {
        let (turns, records) = chat();
        assert_eq!(
            cut_at(turns.clone(), &records, "t4", None, NOW - 100),
            Err(CutError::NotFinished)
        );
        assert_eq!(
            cut_at(turns, &records, "t4", None, NOW),
            Err(CutError::NotFinished)
        );
        let mut late = vec![turn("t1", "completed")];
        let records = vec![
            record("t1", "completed", None, 1),
            record("t2", "running", None, NOW),
        ];
        assert_eq!(
            cut_at(late.clone(), &records, "t2", None, 0),
            Err(CutError::NotFinished),
            "a turn with nothing stored yet is still running"
        );
        late.push(turn("t2", "interrupted"));
        assert_eq!(
            ids(&cut_at(late, &records, "t2", None, NOW + 1).unwrap()),
            ["t1", "t2"]
        );
    }

    #[test]
    fn carried_turns_without_records_are_their_own_answers() {
        let carried = vec![
            json!({"user": {"text": "imported"}}),
            turn("imp-1", "completed"),
        ];
        let mut turns = carried;
        turns.extend([turn("t1", "completed"), turn("t2", "completed")]);
        let records = vec![
            record("t1", "completed", None, 1),
            record("t2", "completed", None, 2),
        ];
        let cut = cut_at(turns.clone(), &records, "t1", None, 0).unwrap();
        assert_eq!(cut.len(), 3);
        assert_eq!(cut[0]["user"]["text"], "imported");
        let cut = cut_at(turns, &records, "imp-1", None, 0).unwrap();
        assert_eq!(cut.len(), 2);
    }

    #[test]
    fn a_version_loop_still_finds_an_original() {
        let records = vec![
            record("a", "completed", Some("b"), 1),
            record("b", "completed", Some("a"), 2),
        ];
        let root = original_of(&records, "a");
        assert!(root == "a" || root == "b");
    }

    #[test]
    fn the_title_names_the_source_within_the_limit() {
        assert_eq!(branch_title("p99 latency"), "Branch of p99 latency");
        assert_eq!(branch_title("  "), "Branch of chat");
        let long = "x".repeat(MAX_TITLE_CHARS * 2);
        assert_eq!(branch_title(&long).chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn the_source_serializes_as_the_contract_shape() {
        let source = BranchSource {
            session_id: "s".into(),
            turn_id: "t".into(),
            title: "x".into(),
        };
        assert_eq!(
            serde_json::to_value(&source).unwrap(),
            json!({"session_id": "s", "turn_id": "t", "title": "x"})
        );
    }
}

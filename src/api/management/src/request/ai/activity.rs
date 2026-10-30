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

//! What the assistant changed (`/ai/activity`), its undo, and the store behind the MCP ledger.

use std::sync::Arc;

use audit::report_http as report_to_audit;
use axum::{
    Json,
    extract::{Path, Query},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::{
    ai_actions::{
        self, APPROVAL_APPROVED, APPROVAL_NONE, APPROVAL_STANDING, ListQuery, STATUS_DONE,
        STATUS_FAILED,
    },
    ai_grants,
};
use o2_enterprise::enterprise::ai::chat::registry;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::{UserEmail, extract_auth_str_from_headers};
use openobserve_mcp::ledger::{
    self, Op, Origin, Recorded, Recorder, ResourceKind, UNDO_WINDOW_MICROS, UndoOutcome, UndoTarget,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

use super::{
    capabilities,
    error::{self, AiErrorCode, AiErrorEnvelope},
};

const PAGE_DEFAULT: u64 = 50;
const PAGE_MAX: u64 = 200;
const REASON_UNDONE: &str = "already_undone";
const REASON_EXPIRED: &str = "expired";
const REASON_IS_UNDO: &str = "is_undo";
// A `/confirm` relays results of calls the MCP executor recorded moments before.
const CONFIRM_MATCH_WINDOW_MICROS: i64 = 10 * 60 * 1_000_000;
const MESSAGE_MAX_CHARS: usize = 256;

#[derive(Debug, Clone, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ActivityQuery {
    /// Microseconds, inclusive.
    pub from: Option<i64>,
    /// Microseconds, exclusive.
    pub to: Option<i64>,
    /// An admin's filter on the member acted for; ignored for other members.
    pub actor: Option<String>,
    /// Substring of the tool, object type or object name.
    pub q: Option<String>,
    /// `next_cursor` of the previous page.
    pub cursor: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ActivityPage {
    pub rows: Vec<ActivityRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ActivityRow {
    pub id: String,
    pub at: i64,
    pub action: String,
    pub target: Target,
    pub on_behalf_of: String,
    pub approval: Approval,
    pub result: ActionResult,
    pub undo: Undo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    /// On an undo's own row, the row it reverted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<String>,
}

impl ActivityRow {
    fn new(row: ai_actions::Model, now: i64) -> Self {
        let undone = row.undone_at.is_some();
        let undo = Undo::of(&row, now);
        Self {
            action: action_label(&row.op, &row.resource_type, row.undo_of.is_some()),
            target: Target {
                kind: row.resource_type,
                id: row.resource_id,
                name: row.resource_name,
                link: None,
                deleted: row.op == ledger::Op::Delete.as_str() && !undone && row.undo_of.is_none(),
            },
            on_behalf_of: row.user_email,
            approval: Approval {
                kind: row.approval_kind,
                by: row.approved_by,
            },
            result: ActionResult {
                state: if undone {
                    "undone".to_string()
                } else {
                    row.status
                },
                message: row.message,
            },
            undo,
            chat_id: row.session_id,
            turn_id: row.turn_id,
            undo_of: row.undo_of,
            id: row.id,
            at: row.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Target {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Approval {
    /// `approved` | `standing` | `none`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ActionResult {
    /// `done` | `failed` | `undone`.
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Undo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Undo {
    fn of(row: &ai_actions::Model, now: i64) -> Self {
        let reason = if row.undo_of.is_some() {
            Some(REASON_IS_UNDO.to_string())
        } else if row.undone_at.is_some() {
            Some(REASON_UNDONE.to_string())
        } else if !row.undoable {
            Some(
                row.undo_reason
                    .clone()
                    .unwrap_or_else(|| ledger::REASON_UNSUPPORTED.into()),
            )
        } else if row.undo_until.is_some_and(|until| now >= until) {
            Some(REASON_EXPIRED.to_string())
        } else {
            None
        };
        Self {
            available: reason.is_none(),
            until: row.undo_until.filter(|_| row.undoable),
            reason,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct UndoResponse {
    /// The undo's own ledger row.
    pub id: String,
    pub undone: String,
    pub target: Target,
}

/// Writes each row the MCP executor hands over, off the tool call's path.
pub struct LedgerRecorder;

impl Recorder for LedgerRecorder {
    fn record(&self, action: Recorded) {
        tokio::spawn(store(action));
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/activity",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiActivity",
    summary = "What the assistant changed",
    description = "Rows of the assistant's action ledger, newest first: every change it made \
                   through the MCP tools for a member, and what `/confirm` relayed. Org admins \
                   read the org's rows and may filter by `actor`; other members read their \
                   own. History starts when this server version was deployed; older changes \
                   are only in the `_audit` stream.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ActivityQuery),
    responses(
        (status = 200, description = "One page of rows", body = ActivityPage),
        (status = 400, description = "Malformed cursor", body = Object),
        (status = 403, description = "Not a member of the organization", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_activity(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(params): Query<ActivityQuery>,
) -> Response {
    let user_id = user_email.user_id;
    if !capabilities::is_member(&org_id, &user_id).await {
        return error::permission_denied("Unauthorized Access");
    }
    let admin = capabilities::is_org_admin(&org_id, &user_id).await;
    let query = match list_query(params, admin.then_some(()).map_or(Some(user_id), |_| None)) {
        Ok(query) => query,
        Err(message) => return error::invalid_request(message),
    };
    match ai_actions::list(&org_id, &query).await {
        Ok(rows) => Json(page(rows, query.limit, now_micros())).into_response(),
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot list AI activity: {e}");
            error::history_unavailable("Activity could not be read; please retry")
        }
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/activity/{id}/undo",
    context_path = "/api",
    tag = "AI",
    operation_id = "UndoAiAction",
    summary = "Undo one change the assistant made",
    description = "The member it was made for, or an org admin, within 24 h. A delete is \
                   re-created from the stored copy, an update reverted to it, a create \
                   deleted. The reverse call runs as the caller through the same permission \
                   check as any API call, so a caller who lost access is refused (403). If \
                   the object changed after the action the undo is refused with 409 \
                   `changed_since`, and nothing is overwritten. The undo is a new ledger row; \
                   the original is marked undone.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Activity row id"),
    ),
    responses(
        (status = 200, description = "Undone", body = UndoResponse),
        (status = 400, description = "This action cannot be undone (`reason`)", body = Object),
        (status = 403, description = "The caller may not make the reverse change", body = Object),
        (status = 404, description = "No such row visible to the caller", body = Object),
        (status = 409, description = "Already undone, or `changed_since` with `changed_by` and `at`", body = Object),
        (status = 410, description = "The undo window passed (`undo_expired`)", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn undo_action(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    let user_id = user_email.user_id;
    let row = match visible_row(&org_id, &id, &user_id).await {
        Ok(row) => row,
        Err(response) => return response,
    };
    let now = now_micros();
    let (kind, resource_id) = match undoable(&row, now) {
        Ok(target) => target,
        Err(response) => return response,
    };
    match ai_actions::mark_undone(&org_id, &id, &user_id, now).await {
        Ok(true) => {}
        Ok(false) => return already_undone(),
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot claim the undo of {id}: {e}");
            return error::history_unavailable("The undo could not start; please retry");
        }
    }
    let auth = extract_auth_str_from_headers(&headers).await;
    let target = UndoTarget {
        org_id: &org_id,
        kind,
        op: Op::parse(&row.op),
        resource_id: &resource_id,
        before: row.before.as_deref(),
        after: row.after.as_deref(),
    };
    let outcome = ledger::undo(target, &auth).await;
    if !matches!(outcome, UndoOutcome::Done { .. })
        && let Err(e) = ai_actions::clear_undone(&org_id, &id).await
    {
        log::error!("[org_id:{org_id}] cannot release the undo claim of {id}: {e}");
    }
    finish_undo(row, outcome, &user_id, now).await
}

/// Registers [`LedgerRecorder`] with the MCP executor; called once at startup.
pub fn register_recorder() {
    ledger::set_recorder(Arc::new(LedgerRecorder));
}

/// Stamps the rows a successful `/confirm` relays as approved, adding any the executor missed.
pub(crate) async fn record_confirm(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    request: &[u8],
    response: &Value,
) {
    if user_id.is_empty() {
        return;
    }
    let approval_id = confirmed_id(request, response).unwrap_or_else(|| "confirm".to_string());
    let Some(items) = response.get("items").and_then(Value::as_array) else {
        return;
    };
    let since = now_micros() - CONFIRM_MATCH_WINDOW_MICROS;
    for item in items {
        let (Some(kind), Some(id)) = (text(item, "type"), text(item, "id")) else {
            continue;
        };
        let stamped = ai_actions::stamp_approval(
            org_id,
            session_id,
            (&kind, &id),
            (&approval_id, user_id),
            since,
        )
        .await;
        match stamped {
            Ok(true) => {}
            Ok(false) => {
                let row = confirmed_row(org_id, session_id, user_id, &approval_id, item);
                if let Err(e) = ai_actions::insert(row).await {
                    log::error!("[org_id:{org_id}] cannot store a confirmed action: {e}");
                }
            }
            Err(e) => log::error!("[org_id:{org_id}] cannot stamp a confirmed action: {e}"),
        }
    }
}

/// The card a `/confirm` decided: o2-ai's answer first, else whichever id key the body used.
fn confirmed_id(request: &[u8], response: &Value) -> Option<String> {
    let body = serde_json::from_slice::<Value>(request).unwrap_or_default();
    [
        &response["id"],
        &response["resolved"]["id"],
        &body["id"],
        &body["approval_id"],
        &body["call_id"],
    ]
    .into_iter()
    .find_map(|id| id.as_str().filter(|id| !id.is_empty()))
    .map(str::to_string)
}

async fn store(action: Recorded) {
    let org_id = action.org_id.clone();
    if !bound_to_turn(&org_id, &action.origin).await {
        log::info!(
            "[org_id:{org_id}] {} by {} not recorded: session {} has no turn of theirs running",
            action.tool,
            action.origin.user_email,
            action.origin.session_id
        );
        return;
    }
    let standing = has_standing_grant(&action).await;
    let row = ledger_row(action, standing, now_micros());
    let stored = ai_actions::insert(row.clone()).await;
    if let Err(e) = &stored {
        log::error!("[org_id:{org_id}] cannot store an assistant action: {e}");
    }
    audit_row(&row, stored.is_ok()).await;
}

/// Whether a turn of the member runs the session on any node, so the header is not forged.
async fn bound_to_turn(org_id: &str, origin: &Origin) -> bool {
    runs_here(org_id, origin)
        || super::turn_marks::turn_runs(org_id, &origin.session_id, &origin.user_email).await
}

/// This node's registry, which holds the direct path's turns by the member's email.
fn runs_here(org_id: &str, origin: &Origin) -> bool {
    registry::turns(org_id, &origin.session_id)
        .iter()
        .any(|turn| turn.user_id == origin.user_email)
}

async fn has_standing_grant(action: &Recorded) -> bool {
    let Some(operation) = ledger::tool_operation(&action.tool) else {
        return false;
    };
    let grants = ai_grants::active_for_turn(
        &action.org_id,
        &action.origin.user_email,
        Some(&action.origin.session_id),
    )
    .await
    .unwrap_or_default();
    grants
        .iter()
        .any(|grant| grant.tool == action.tool && grant.operation == operation)
}

fn ledger_row(action: Recorded, standing: bool, now: i64) -> ai_actions::Model {
    ai_actions::Model {
        id: String::new(),
        org_id: action.org_id,
        session_id: Some(action.origin.session_id),
        turn_id: action.origin.turn_id,
        approval_id: None,
        approval_kind: if standing {
            APPROVAL_STANDING
        } else {
            APPROVAL_NONE
        }
        .to_string(),
        approved_by: None,
        user_email: action.origin.user_email,
        tool: action.tool,
        op: action.op.as_str().to_string(),
        resource_type: action.resource_type,
        resource_id: action.resource_id,
        resource_name: action.resource_name,
        before: action.before,
        after: action.after,
        status: if action.ok {
            STATUS_DONE
        } else {
            STATUS_FAILED
        }
        .to_string(),
        message: (!action.ok).then(|| format!("The call answered {}", action.status_code)),
        undoable: action.undoable,
        undo_reason: action.undo_reason.map(str::to_string),
        undo_until: action.undoable.then_some(now + UNDO_WINDOW_MICROS),
        undone_by: None,
        undone_at: None,
        undo_of: None,
        created_at: now,
    }
}

fn confirmed_row(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    approval_id: &str,
    item: &Value,
) -> ai_actions::Model {
    let done = text(item, "status").as_deref() == Some(STATUS_DONE);
    ai_actions::Model {
        id: String::new(),
        org_id: org_id.to_string(),
        session_id: Some(session_id.to_string()),
        turn_id: None,
        approval_id: Some(approval_id.to_string()),
        approval_kind: APPROVAL_APPROVED.to_string(),
        approved_by: Some(user_id.to_string()),
        user_email: user_id.to_string(),
        tool: text(item, "tool").unwrap_or_else(|| "confirm".to_string()),
        op: Op::parse(text(item, "operation").as_deref().unwrap_or_default())
            .as_str()
            .to_string(),
        resource_type: text(item, "type").unwrap_or_default(),
        resource_id: text(item, "id"),
        resource_name: text(item, "name"),
        before: None,
        after: None,
        status: if done { STATUS_DONE } else { STATUS_FAILED }.to_string(),
        message: (!done).then(|| "The approved change did not complete".to_string()),
        undoable: false,
        undo_reason: Some(ledger::REASON_NO_SNAPSHOT.to_string()),
        undo_until: None,
        undone_by: None,
        undone_at: None,
        undo_of: None,
        created_at: now_micros(),
    }
}

/// A short string field of `item`, never upstream text beyond its own value.
fn text(item: &Value, key: &str) -> Option<String> {
    item.get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(|v| v.chars().take(MESSAGE_MAX_CHARS).collect())
}

/// `stored` says whether Activity holds the row, so a missing one is explained in the audit.
async fn audit_row(row: &ai_actions::Model, stored: bool) {
    let body = serde_json::json!({
        "message": format!("changed by O2 Assistant on behalf of {}", row.user_email),
        "ledger": if stored { "stored" } else { "not_stored" },
        "tool": row.tool,
        "op": row.op,
        "resource": {"type": row.resource_type, "id": row.resource_id, "name": row.resource_name},
        "session_id": row.session_id,
        "status": row.status,
    });
    report_to_audit(
        row.user_email.clone(),
        row.org_id.clone(),
        String::new(),
        if row.status == STATUS_DONE { 200 } else { 500 },
        None,
        "POST".to_string(),
        format!("/api/{}/ai/activity", row.org_id),
        String::new(),
        body.to_string(),
    )
    .await;
}

fn list_query(params: ActivityQuery, only: Option<String>) -> Result<ListQuery, &'static str> {
    let cursor = params
        .cursor
        .as_deref()
        .map(|cursor| {
            let (at, id) = cursor.split_once(':').ok_or("Malformed cursor")?;
            let at = at.parse::<i64>().map_err(|_| "Malformed cursor")?;
            Ok::<_, &'static str>((at, id.to_string()))
        })
        .transpose()?;
    Ok(ListQuery {
        from: params.from,
        to: params.to,
        user_email: only.or(params.actor.filter(|a| !a.is_empty())),
        q: params.q,
        cursor,
        limit: params.limit.unwrap_or(PAGE_DEFAULT).clamp(1, PAGE_MAX),
    })
}

fn page(rows: Vec<ai_actions::Model>, limit: u64, now: i64) -> ActivityPage {
    let next_cursor = (rows.len() as u64 == limit)
        .then(|| rows.last().map(|r| format!("{}:{}", r.created_at, r.id)))
        .flatten();
    ActivityPage {
        rows: rows
            .into_iter()
            .map(|row| ActivityRow::new(row, now))
            .collect(),
        next_cursor,
    }
}

fn action_label(op: &str, resource_type: &str, is_undo: bool) -> String {
    let verb = match Op::parse(op) {
        Op::Create => "Created",
        Op::Update => "Updated",
        Op::Delete => "Deleted",
        Op::Other => "Changed",
    };
    let label = format!("{verb} {}", resource_type.replace('_', " "));
    if is_undo {
        format!("Undo: {label}")
    } else {
        label
    }
}

/// The row if the caller may see it: their own, or any of the org for an admin.
async fn visible_row(org_id: &str, id: &str, user_id: &str) -> Result<ai_actions::Model, Response> {
    let row = match ai_actions::get(org_id, id).await {
        Ok(row) => row,
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot read AI action {id}: {e}");
            return Err(error::history_unavailable(
                "Activity could not be read; please retry",
            ));
        }
    };
    match row {
        Some(row) if row.user_email == user_id => Ok(row),
        Some(row) if capabilities::is_org_admin(org_id, user_id).await => Ok(row),
        _ => Err(error::not_found("No such activity")),
    }
}

/// What to reverse, or the refusal: not undoable (400), done (409), expired (410).
fn undoable(row: &ai_actions::Model, now: i64) -> Result<(ResourceKind, String), Response> {
    let undo = Undo::of(row, now);
    match undo.reason.as_deref() {
        None => {}
        Some(REASON_UNDONE) => return Err(already_undone()),
        Some(REASON_EXPIRED) => {
            return Err(AiErrorEnvelope::new(
                AiErrorCode::UndoExpired,
                "The time to undo this change has passed",
            )
            .into_response());
        }
        Some(reason) => {
            return Err(AiErrorEnvelope::new(
                AiErrorCode::InvalidRequest,
                "This change cannot be undone",
            )
            .with("reason", reason)
            .into_response());
        }
    }
    let kind = ResourceKind::parse(&row.resource_type);
    match (kind, row.resource_id.clone()) {
        (Some(kind), Some(id)) => Ok((kind, id)),
        _ => Err(
            AiErrorEnvelope::new(AiErrorCode::InvalidRequest, "This change cannot be undone")
                .with("reason", ledger::REASON_UNSUPPORTED)
                .into_response(),
        ),
    }
}

fn already_undone() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::AlreadySubmitted,
        "This change was already undone",
    )
    .into_response()
}

async fn finish_undo(
    row: ai_actions::Model,
    outcome: UndoOutcome,
    user_id: &str,
    now: i64,
) -> Response {
    match outcome {
        UndoOutcome::Done { id } => {
            let undo = undo_row(&row, id, user_id, now);
            let target = ActivityRow::new(undo.clone(), now).target;
            let stored = ai_actions::insert(undo.clone()).await;
            audit_row(&undo, stored.is_ok()).await;
            match stored {
                Ok(stored) => Json(UndoResponse {
                    id: stored.id,
                    undone: row.id,
                    target,
                })
                .into_response(),
                Err(e) => {
                    log::error!(
                        "[org_id:{}] undo done but its row was not stored: {e}",
                        row.org_id
                    );
                    Json(UndoResponse {
                        id: String::new(),
                        undone: row.id,
                        target,
                    })
                    .into_response()
                }
            }
        }
        UndoOutcome::ChangedSince { changed_by, at } => AiErrorEnvelope::new(
            AiErrorCode::ChangedSince,
            "The object changed after the assistant's change, so it was not overwritten",
        )
        .with("changed_by", changed_by)
        .with("at", at)
        .into_response(),
        UndoOutcome::Refused(401 | 403) => {
            error::permission_denied("You may not make the change that undoes this one")
        }
        UndoOutcome::Refused(_) => {
            error::invalid_request("The change that undoes this one was refused")
        }
        UndoOutcome::Unavailable => error::internal("The undo could not run; please retry"),
    }
}

/// The undo's own row: the reverse operation on the same object, never itself undoable.
fn undo_row(
    original: &ai_actions::Model,
    id: Option<String>,
    user_id: &str,
    now: i64,
) -> ai_actions::Model {
    let op = match Op::parse(&original.op) {
        Op::Create => Op::Delete,
        Op::Delete => Op::Create,
        other => other,
    };
    ai_actions::Model {
        id: String::new(),
        approval_id: None,
        approval_kind: APPROVAL_NONE.to_string(),
        approved_by: None,
        user_email: user_id.to_string(),
        tool: "undo".to_string(),
        op: op.as_str().to_string(),
        resource_id: id.or_else(|| original.resource_id.clone()),
        before: None,
        after: None,
        status: STATUS_DONE.to_string(),
        message: None,
        undoable: false,
        undo_reason: Some(REASON_IS_UNDO.to_string()),
        undo_until: None,
        undone_by: None,
        undone_at: None,
        undo_of: Some(original.id.clone()),
        created_at: now,
        ..original.clone()
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use openobserve_mcp::ledger::Origin;
    use serde_json::json;

    use super::*;

    const NOW: i64 = 1_000_000_000;

    fn action() -> Recorded {
        Recorded {
            org_id: "o".into(),
            origin: Origin {
                user_email: "a@x".into(),
                session_id: "s".into(),
                turn_id: Some("t".into()),
                approval: None,
            },
            tool: "DeleteAlert".into(),
            op: Op::Delete,
            resource_type: "alert".into(),
            resource_id: Some("a1".into()),
            resource_name: Some("cpu".into()),
            before: Some(r#"{"object":{"id":"a1"}}"#.into()),
            after: None,
            ok: true,
            status_code: 200,
            undoable: true,
            undo_reason: None,
        }
    }

    async fn body(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn a_ledger_row_reads_as_the_contract_row() {
        let mut row = ledger_row(action(), false, NOW);
        row.id = "r1".into();
        let json = serde_json::to_value(ActivityRow::new(row, NOW)).unwrap();
        assert_eq!(
            json,
            json!({
                "id": "r1",
                "at": NOW,
                "action": "Deleted alert",
                "target": {"type": "alert", "id": "a1", "name": "cpu", "deleted": true},
                "on_behalf_of": "a@x",
                "approval": {"kind": "none"},
                "result": {"state": "done"},
                "undo": {"available": true, "until": NOW + UNDO_WINDOW_MICROS},
                "chat_id": "s",
                "turn_id": "t"
            })
        );
        let standing = ledger_row(action(), true, NOW);
        assert_eq!(standing.approval_kind, APPROVAL_STANDING);
    }

    #[test]
    fn undo_is_offered_only_within_its_window_and_once() {
        let row = ledger_row(action(), false, NOW);
        assert!(Undo::of(&row, NOW + 1).available);
        let late = Undo::of(&row, NOW + UNDO_WINDOW_MICROS);
        assert_eq!(late.reason.as_deref(), Some(REASON_EXPIRED));
        let undone = ai_actions::Model {
            undone_at: Some(NOW + 5),
            ..row.clone()
        };
        assert_eq!(
            Undo::of(&undone, NOW + 6).reason.as_deref(),
            Some(REASON_UNDONE)
        );
        assert_eq!(ActivityRow::new(undone, NOW).result.state, "undone");
        let failed = ledger_row(
            Recorded {
                ok: false,
                undoable: false,
                undo_reason: Some(ledger::REASON_FAILED),
                ..action()
            },
            false,
            NOW,
        );
        assert_eq!(
            Undo::of(&failed, NOW).reason.as_deref(),
            Some(ledger::REASON_FAILED)
        );
        assert!(failed.undo_until.is_none());
    }

    #[tokio::test]
    async fn an_expired_undo_is_410_a_done_one_409_and_an_unsupported_one_400() {
        let row = ledger_row(action(), false, NOW);
        let (status, json) = body(undoable(&row, NOW + UNDO_WINDOW_MICROS).unwrap_err()).await;
        assert_eq!(
            (status, json["code"].as_str()),
            (StatusCode::GONE, Some("undo_expired"))
        );
        let undone = ai_actions::Model {
            undone_at: Some(NOW),
            ..row.clone()
        };
        let (status, _) = body(undoable(&undone, NOW).unwrap_err()).await;
        assert_eq!(status, StatusCode::CONFLICT);
        let other = ai_actions::Model {
            undoable: false,
            undo_reason: Some("unsupported".into()),
            ..row.clone()
        };
        let (status, json) = body(undoable(&other, NOW).unwrap_err()).await;
        assert_eq!(
            (status, json["reason"].as_str()),
            (StatusCode::BAD_REQUEST, Some("unsupported"))
        );
        assert_eq!(
            undoable(&row, NOW).unwrap(),
            (ResourceKind::Alert, "a1".to_string())
        );
    }

    #[tokio::test]
    async fn a_changed_object_is_a_409_naming_who_and_when() {
        let row = ledger_row(action(), false, NOW);
        let outcome = UndoOutcome::ChangedSince {
            changed_by: Some("b@x".into()),
            at: Some(7),
        };
        let (status, json) = body(finish_undo(row, outcome, "a@x", NOW).await).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(json["code"], "changed_since");
        assert_eq!(
            (json["changed_by"].as_str(), json["at"].as_i64()),
            (Some("b@x"), Some(7))
        );
        let row = ledger_row(action(), false, NOW);
        let (status, _) = body(finish_undo(row, UndoOutcome::Refused(403), "a@x", NOW).await).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn an_undo_is_its_own_row_with_the_reverse_operation() {
        let mut original = ledger_row(action(), false, NOW);
        original.id = "r1".into();
        let undo = undo_row(&original, Some("a2".into()), "admin@x", NOW + 1);
        assert_eq!((undo.op.as_str(), undo.tool.as_str()), ("create", "undo"));
        assert_eq!(undo.undo_of.as_deref(), Some("r1"));
        assert_eq!(undo.resource_id.as_deref(), Some("a2"));
        assert_eq!(undo.user_email, "admin@x");
        assert!(!undo.undoable && undo.before.is_none());
        let view = ActivityRow::new(undo, NOW + 1);
        assert_eq!(view.action, "Undo: Created alert");
        assert!(!view.target.deleted && !view.undo.available);
    }

    #[test]
    fn a_member_pages_only_their_own_rows_and_a_bad_cursor_is_refused() {
        let params = ActivityQuery {
            actor: Some("b@x".into()),
            cursor: Some("12:r9".into()),
            limit: Some(10_000),
            ..Default::default()
        };
        let member = list_query(params.clone(), Some("a@x".into())).unwrap();
        assert_eq!(member.user_email.as_deref(), Some("a@x"));
        assert_eq!(member.cursor, Some((12, "r9".to_string())));
        assert_eq!(member.limit, PAGE_MAX);
        let admin = list_query(params, None).unwrap();
        assert_eq!(admin.user_email.as_deref(), Some("b@x"));
        let bad = ActivityQuery {
            cursor: Some("nope".into()),
            ..Default::default()
        };
        assert!(list_query(bad, None).is_err());
        let mut rows = vec![
            ledger_row(action(), false, NOW),
            ledger_row(action(), false, NOW),
        ];
        rows[1].id = "r2".into();
        assert_eq!(
            page(rows.clone(), 2, NOW).next_cursor.as_deref(),
            Some("1000000000:r2")
        );
        assert!(page(rows, 3, NOW).next_cursor.is_none());
    }

    #[test]
    fn a_confirmed_item_the_executor_missed_is_approved_and_not_undoable() {
        let item = json!({"type": "alert", "id": "a1", "name": "cpu", "status": "done", "operation": "delete"});
        let row = confirmed_row("o", "s", "a@x", "ap1", &item);
        assert_eq!(
            (row.approval_kind.as_str(), row.approved_by.as_deref()),
            (APPROVAL_APPROVED, Some("a@x"))
        );
        assert_eq!(
            (row.op.as_str(), row.status.as_str()),
            ("delete", STATUS_DONE)
        );
        assert!(!row.undoable);
        let failed = confirmed_row(
            "o",
            "s",
            "a@x",
            "ap1",
            &json!({"type": "alert", "id": "a1", "status": "failed"}),
        );
        assert_eq!(failed.status, STATUS_FAILED);
    }

    #[test]
    fn a_turn_on_this_node_binds_only_its_member() {
        const SESSION: &str = "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f6aaaa";
        let origin = |user: &str| Origin {
            user_email: user.into(),
            session_id: SESSION.into(),
            turn_id: None,
            approval: None,
        };
        assert!(!runs_here("o-bound", &origin("a@x")));
        let turn = registry::register("o-bound", SESSION, "t1", "a@x", None);
        assert!(runs_here("o-bound", &origin("a@x")));
        assert!(!runs_here("o-bound", &origin("m@x")));
        assert!(!runs_here("o-other", &origin("a@x")));
        drop(turn);
        assert!(!runs_here("o-bound", &origin("a@x")));
    }

    #[test]
    fn a_confirm_names_its_card_under_any_id_key() {
        let answer = json!({"resolved": {"id": "apr_a"}});
        assert_eq!(confirmed_id(b"{}", &answer).as_deref(), Some("apr_a"));
        let body = br#"{"call_id":"apr_c"}"#;
        assert_eq!(confirmed_id(body, &json!({})).as_deref(), Some("apr_c"));
        assert_eq!(confirmed_id(b"not json", &json!({})), None);
    }
}

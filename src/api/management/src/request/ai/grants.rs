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

//! Standing approvals (`/ai/grants`): created by `/confirm`, listed and revoked here.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::ai_grants::{self, NewGrant, SCOPE_ALWAYS, SCOPE_CHAT};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use openobserve_mcp::ledger;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::{capabilities, error};

const FIELD_MAX_CHARS: usize = 256;
// A tool named for removal is never granted `always`, whatever its method says.
const NEVER_STANDING: [&str; 5] = ["delete", "remove", "purge", "drop", "destroy"];

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct GrantView {
    pub id: String,
    /// The member the grant is for; admins list the whole org.
    pub user: String,
    pub tool: String,
    pub operation: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    pub granted_by: String,
    pub granted_at: i64,
}

impl From<ai_grants::Model> for GrantView {
    fn from(grant: ai_grants::Model) -> Self {
        Self {
            id: grant.id,
            user: grant.user_email,
            tool: grant.tool,
            operation: grant.operation,
            scope: grant.scope,
            chat_id: grant.chat_id,
            granted_by: grant.granted_by,
            granted_at: grant.granted_at,
        }
    }
}

/// The grant a `/confirm` body asks for, already checked.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Requested {
    tool: String,
    operation: String,
    scope: &'static str,
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/grants",
    context_path = "/api",
    tag = "AI",
    operation_id = "ListAiGrants",
    summary = "Standing approvals of the assistant",
    description = "Org admins list every member's grants; any other member lists their own. \
                   A grant lets the assistant run one tool operation for its member without \
                   asking, always or in one chat. Deletes are never granted `always`.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Grants, newest first", body = Vec<GrantView>),
        (status = 403, description = "Not a member of the organization", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn list_grants(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    if !capabilities::is_member(&org_id, &user_id).await {
        return error::permission_denied("Unauthorized Access");
    }
    let admin = capabilities::is_org_admin(&org_id, &user_id).await;
    let only = (!admin).then_some(user_id.as_str());
    match ai_grants::list(&org_id, only).await {
        Ok(grants) => {
            Json(grants.into_iter().map(GrantView::from).collect::<Vec<_>>()).into_response()
        }
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot list AI grants: {e}");
            error::history_unavailable("Standing approvals could not be read; please retry")
        }
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/ai/grants/{id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "DeleteAiGrant",
    summary = "Revoke a standing approval",
    description = "The member the grant is for, or an org admin. The next turn no longer \
                   carries it to the assistant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Grant id"),
    ),
    responses(
        (status = 204, description = "Revoked"),
        (status = 404, description = "No such grant visible to the caller", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn delete_grant(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    let grant = match ai_grants::get(&org_id, &id).await {
        Ok(grant) => grant,
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot read AI grant {id}: {e}");
            return error::history_unavailable("The approval could not be read; please retry");
        }
    };
    let allowed = match &grant {
        Some(grant) if grant.user_email == user_id => true,
        Some(_) => capabilities::is_org_admin(&org_id, &user_id).await,
        None => false,
    };
    // Another member's grant reads as missing, so ids cannot be probed.
    if !allowed {
        return error::not_found("No such approval");
    }
    match ai_grants::delete(&org_id, &id).await {
        Ok(_) => {
            log::info!("[org_id:{org_id}] AI grant {id} revoked by {user_id}");
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot delete AI grant {id}: {e}");
            error::history_unavailable("The approval could not be revoked; please retry")
        }
    }
}

/// Stores the grant an approved `/confirm` asked for with `scope`; a refused one is only logged.
pub(crate) async fn record_from_confirm(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    body: &[u8],
) {
    if user_id.is_empty() {
        return;
    }
    let Ok(body) = serde_json::from_slice::<Value>(body) else {
        return;
    };
    let requested = match requested(&body, ledger::tool_operation) {
        Ok(Some(requested)) => requested,
        Ok(None) => return,
        Err(reason) => {
            log::info!("[org_id:{org_id}] standing approval not stored: {reason}");
            return;
        }
    };
    // Only what the turn asked can stand; the approval itself still went through as a one-time one.
    if !super::turn_marks::take_confirmation(org_id, session_id, user_id, &requested.tool).await {
        log::info!(
            "[org_id:{org_id}] standing approval of {} not stored: the turn asked no such confirmation",
            requested.tool
        );
        return;
    }
    let grant = NewGrant {
        org_id,
        user_email: user_id,
        tool: &requested.tool,
        operation: &requested.operation,
        scope: requested.scope,
        chat_id: (requested.scope == SCOPE_CHAT).then_some(session_id),
        granted_by: user_id,
    };
    if let Err(e) = ai_grants::insert(&grant, now_micros()).await {
        log::error!("[org_id:{org_id}] cannot store a standing approval: {e}");
    }
}

/// `Ok(None)` when no grant is asked, `Err` why one is refused; the operation is never the body's.
fn requested(
    body: &Value,
    operation_of: impl Fn(&str) -> Option<&'static str>,
) -> Result<Option<Requested>, &'static str> {
    let scope = match body.get("scope").and_then(Value::as_str) {
        Some(SCOPE_ALWAYS) => SCOPE_ALWAYS,
        Some(SCOPE_CHAT) => SCOPE_CHAT,
        _ => return Ok(None),
    };
    if body.get("approved").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    let field = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty() && v.chars().count() <= FIELD_MAX_CHARS)
            .map(str::to_string)
    };
    let Some(tool) = field("tool") else {
        return Err("the approval names no tool");
    };
    let Some(operation) = operation_of(&tool) else {
        return Err("the approval names no tool this server has");
    };
    let lower = tool.to_ascii_lowercase();
    let deletes =
        operation == ledger::OPERATION_DELETE || NEVER_STANDING.iter().any(|w| lower.contains(w));
    if scope == SCOPE_ALWAYS && deletes {
        return Err("a delete is never approved for always");
    }
    Ok(Some(Requested {
        tool,
        operation: operation.to_string(),
        scope,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// The server's reading of the tools these tests name.
    fn operation_of(tool: &str) -> Option<&'static str> {
        match tool {
            "UpdateDashboard" => Some("update"),
            "DeleteAlert" | "BulkCleanup" => Some("delete"),
            "DestroyThing" => Some("update"),
            _ => None,
        }
    }

    #[test]
    fn only_an_approved_confirm_with_a_scope_asks_for_a_grant() {
        let ask = |body: Value| requested(&body, operation_of);
        assert_eq!(ask(json!({"approved": true})), Ok(None));
        assert_eq!(
            ask(json!({"approved": false, "scope": "always", "tool": "UpdateDashboard"})),
            Ok(None)
        );
        assert_eq!(
            ask(
                json!({"approved": true, "scope": "chat", "tool": "UpdateDashboard", "operation": "anything"})
            ),
            Ok(Some(Requested {
                tool: "UpdateDashboard".into(),
                operation: "update".into(),
                scope: SCOPE_CHAT,
            }))
        );
        assert!(ask(json!({"approved": true, "scope": "always"})).is_err());
        assert!(
            ask(json!({"approved": true, "scope": "always", "tool": "x".repeat(300)})).is_err()
        );
        assert!(ask(json!({"approved": true, "scope": "chat", "tool": "Unknown"})).is_err());
    }

    #[test]
    fn a_delete_is_granted_for_one_chat_at_most_whatever_the_body_says() {
        for tool in ["DeleteAlert", "BulkCleanup", "DestroyThing"] {
            let always =
                json!({"approved": true, "scope": "always", "tool": tool, "operation": "update"});
            assert!(requested(&always, operation_of).is_err(), "{tool}");
        }
        let chat = json!({"approved": true, "scope": "chat", "tool": "DeleteAlert"});
        let granted = requested(&chat, operation_of).unwrap().unwrap();
        assert_eq!(granted.operation, "delete");
    }

    #[test]
    fn a_listed_grant_names_its_member_and_hides_an_absent_chat() {
        let view = GrantView::from(ai_grants::Model {
            id: "g1".into(),
            org_id: "o".into(),
            user_email: "a@x".into(),
            tool: "t".into(),
            operation: "update".into(),
            scope: "always".into(),
            chat_id: None,
            granted_by: "a@x".into(),
            granted_at: 3,
        });
        let json = serde_json::to_value(view).unwrap();
        assert_eq!(
            json,
            json!({"id": "g1", "user": "a@x", "tool": "t", "operation": "update", "scope": "always", "granted_by": "a@x", "granted_at": 3})
        );
    }
}

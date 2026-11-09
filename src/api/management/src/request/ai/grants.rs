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

use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicI64, Ordering},
};

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::time::now_micros;
use infra::table::ai_grants::{self, NewGrant, SCOPE_ALWAYS, SCOPE_CHAT};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use openobserve_mcp::{
    approval::{self, GrantQuery},
    tools::{self, ToolClass},
};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::{capabilities, error};

const FIELD_MAX_CHARS: usize = 256;
const SPENT_APPROVAL_PREFIX: &str = "/ai_approval_spent/";
const SPENT_SWEEP_EVERY_SECS: i64 = 60;
const DECIDING_PREFIX: &str = "/ai_approval_deciding/";
// Outlasts the confirm relay's wait, so a slow decision is never claimed a second time.
const DECIDING_HOLD_SECS: i64 = 120;
const GRANT_NO_TOOL: &str = "no_tool";
const GRANT_UNKNOWN_TOOL: &str = "unknown_tool";
const GRANT_READ_ONLY: &str = "read_only";
const GRANT_DELETE_NOT_ALWAYS: &str = "delete_not_always";
const GRANT_NO_MEMBER: &str = "no_member";
const GRANT_STORE_FAILED: &str = "store_failed";

static LAST_SPENT_SWEEP: AtomicI64 = AtomicI64::new(0);

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

/// The `grant` a `/confirm` answer reports: stored with its id, or why it was not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct GrantOutcome {
    pub stored: bool,
    pub scope: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

impl GrantOutcome {
    fn refused(scope: &'static str, reason: &'static str) -> Self {
        Self {
            stored: false,
            scope,
            id: None,
            reason: Some(reason),
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
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "list"})), ("x-o2-mcp" = json!({"enabled": false})))
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
    extensions(("x-o2-ratelimit" = json!({"module": "AI", "operation": "delete"})), ("x-o2-mcp" = json!({"enabled": false})))
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

/// Registers the executor's check that a `grant_<id>` approval names a live grant, spent once.
pub fn register_grant_check() {
    approval::set_grant_check(grant_is_live);
    approval::set_spend_claim(claim_spent_approval);
}

/// Stores the grant o2-ai's `resolved` frame applied, never the scope the browser's body asked
/// for; `None` when no grant was asked.
pub(crate) async fn record_from_confirm(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    resolved: &Value,
    tool: Option<&str>,
) -> Option<GrantOutcome> {
    let requested = match requested(resolved, tool, tools::tool_class) {
        Ok(Some(requested)) => requested,
        Ok(None) => return None,
        Err((scope, reason)) => {
            log::info!("[org_id:{org_id}] standing approval not stored: {reason}");
            return Some(GrantOutcome::refused(scope, reason));
        }
    };
    if user_id.is_empty() {
        return Some(GrantOutcome::refused(requested.scope, GRANT_NO_MEMBER));
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
    match ai_grants::insert(&grant, now_micros()).await {
        Ok(stored) => Some(GrantOutcome {
            stored: true,
            scope: requested.scope,
            id: Some(stored.id),
            reason: None,
        }),
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot store a standing approval: {e}");
            Some(GrantOutcome::refused(requested.scope, GRANT_STORE_FAILED))
        }
    }
}

/// `Ok(None)` when no grant is asked, else the asked scope and why it is refused; the class is
/// the server's own.
fn requested(
    resolved: &Value,
    tool: Option<&str>,
    class_of: impl Fn(&str) -> Option<ToolClass>,
) -> Result<Option<Requested>, (&'static str, &'static str)> {
    let scope = match resolved.get("scope").and_then(Value::as_str) {
        Some(SCOPE_ALWAYS) => SCOPE_ALWAYS,
        Some(SCOPE_CHAT) => SCOPE_CHAT,
        _ => return Ok(None),
    };
    if resolved.get("approved").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    let Some(tool) = tool
        .map(str::trim)
        .filter(|t| !t.is_empty() && t.chars().count() <= FIELD_MAX_CHARS)
    else {
        return Err((scope, GRANT_NO_TOOL));
    };
    let Some(class) = class_of(tool) else {
        return Err((scope, GRANT_UNKNOWN_TOOL));
    };
    if class.read_only {
        return Err((scope, GRANT_READ_ONLY));
    }
    if scope == SCOPE_ALWAYS && class.destructive {
        return Err((scope, GRANT_DELETE_NOT_ALWAYS));
    }
    Ok(Some(Requested {
        tool: tool.to_string(),
        operation: class.operation.to_string(),
        scope,
    }))
}

/// Whether the grant `query` names is still stored for that member, tool and chat.
fn grant_is_live(query: GrantQuery) -> futures::future::BoxFuture<'static, bool> {
    Box::pin(async move {
        match ai_grants::get(&query.org_id, &query.grant_id).await {
            Ok(Some(grant)) => grant_matches(&grant, &query),
            Ok(None) => false,
            Err(e) => {
                log::error!(
                    "[org_id:{}] cannot read AI grant {}: {e}",
                    query.org_id,
                    query.grant_id
                );
                false
            }
        }
    })
}

/// Claims an approval's signature in the meta store every node shares; a failed write refuses it.
fn claim_spent_approval(
    signature: String,
    expiry: i64,
) -> futures::future::BoxFuture<'static, bool> {
    Box::pin(async move {
        let key = format!("{SPENT_APPROVAL_PREFIX}{expiry}/{signature}");
        let claimed = Arc::new(AtomicBool::new(false));
        let (won, insert_key) = (claimed.clone(), key.clone());
        // NATS creates a missing key only through the insert slot.
        let claim = Box::new(move |stored: Option<Bytes>| {
            if stored.is_some() {
                return Ok(None);
            }
            won.store(true, Ordering::Release);
            Ok(Some((
                None,
                Some((insert_key, Bytes::from(expiry.to_string()), None)),
            )))
        });
        let db = infra::db::get_db().await;
        match db.get_for_update(&key, false, None, claim).await {
            Ok(()) => {
                let claimed = claimed.load(Ordering::Acquire);
                if claimed {
                    tokio::spawn(sweep_spent_approvals());
                }
                claimed
            }
            Err(e) => {
                log::error!("[AI] cannot claim an approval as spent, refusing it: {e}");
                false
            }
        }
    })
}

/// Claims card `id`'s decision for one `/confirm` on every node; `false` while another holds it.
pub(crate) async fn claim_decision(org_id: &str, id: &str) -> bool {
    let key = format!("{DECIDING_PREFIX}{org_id}/{id}");
    let now = now_micros() / 1_000_000;
    let hold = Bytes::from((now + DECIDING_HOLD_SECS).to_string());
    let claimed = Arc::new(AtomicBool::new(false));
    let (won, insert_key) = (claimed.clone(), key.clone());
    let claim = Box::new(move |stored: Option<Bytes>| match stored {
        None => {
            won.store(true, Ordering::Release);
            Ok(Some((None, Some((insert_key, hold, None)))))
        }
        Some(held) if decision_free(&held, now) => {
            won.store(true, Ordering::Release);
            Ok(Some((Some(hold), None)))
        }
        Some(_) => Ok(None),
    });
    let db = infra::db::get_db().await;
    match db.get_for_update(&key, false, None, claim).await {
        Ok(()) => {
            tokio::spawn(sweep_spent_approvals());
            claimed.load(Ordering::Acquire)
        }
        Err(e) => {
            log::error!("[AI] cannot claim the decision on {org_id}/{id}, refusing it: {e}");
            false
        }
    }
}

/// Frees a claim whose `/confirm` never reached o2-ai, so the member can decide again.
pub(crate) async fn release_decision(org_id: &str, id: &str) {
    let key = format!("{DECIDING_PREFIX}{org_id}/{id}");
    let db = infra::db::get_db().await;
    if let Err(e) = db.delete_if_exists(&key, false, false).await {
        log::warn!("[AI] cannot release the decision claim {key}: {e}");
    }
}

/// Drops spent claims whose approval has expired, at most once a minute per node.
async fn sweep_spent_approvals() {
    let now = now_micros() / 1_000_000;
    let last = LAST_SPENT_SWEEP.load(Ordering::Relaxed);
    if now - last < SPENT_SWEEP_EVERY_SECS
        || LAST_SPENT_SWEEP
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
    {
        return;
    }
    let db = infra::db::get_db().await;
    let keys = match db.list_keys(SPENT_APPROVAL_PREFIX).await {
        Ok(keys) => keys,
        Err(e) => {
            log::warn!("[AI] cannot list spent approvals to sweep: {e}");
            return;
        }
    };
    for key in keys {
        let (_, expiry, _) = infra::db::parse_key(&key);
        if expiry.parse::<i64>().is_ok_and(|expiry| expiry < now)
            && let Err(e) = db.delete_if_exists(&key, false, false).await
        {
            log::warn!("[AI] cannot sweep spent approval {key}: {e}");
        }
    }
    let Ok(held) = db.list_keys(DECIDING_PREFIX).await else {
        return;
    };
    for key in held {
        let free = match db.get(&key).await {
            Ok(until) => decision_free(&until, now),
            Err(_) => false,
        };
        if free && let Err(e) = db.delete_if_exists(&key, false, false).await {
            log::warn!("[AI] cannot sweep decision claim {key}: {e}");
        }
    }
}

/// Whether a stored decision claim has run out at unix time `now`; an unreadable one has.
fn decision_free(held: &[u8], now: i64) -> bool {
    std::str::from_utf8(held)
        .ok()
        .and_then(|until| until.parse::<i64>().ok())
        .is_none_or(|until| until <= now)
}

fn grant_matches(grant: &ai_grants::Model, query: &GrantQuery) -> bool {
    let chat_ok = match grant.scope.as_str() {
        SCOPE_ALWAYS => true,
        SCOPE_CHAT => grant.chat_id.as_deref() == Some(query.session_id.as_str()),
        _ => false,
    };
    chat_ok && grant.tool == query.tool && grant.user_email.eq_ignore_ascii_case(&query.user_email)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// The server's reading of the tools these tests name.
    fn class_of(tool: &str) -> Option<ToolClass> {
        let class = |operation, destructive| ToolClass {
            read_only: false,
            destructive,
            operation,
            telemetry: false,
        };
        match tool {
            "UpdateDashboard" | "DestroyThing" => Some(class("update", false)),
            "DeleteAlert" | "BulkCleanup" => Some(class("delete", true)),
            "SearchSQL" => Some(ToolClass {
                read_only: true,
                ..class("read", false)
            }),
            _ => None,
        }
    }

    #[test]
    fn only_an_approved_confirm_with_a_scope_asks_for_a_grant() {
        let ask = |body: Value, tool: Option<&str>| requested(&body, tool, class_of);
        let dashboard = Some("UpdateDashboard");
        assert_eq!(ask(json!({"approved": true}), dashboard), Ok(None));
        assert_eq!(
            ask(json!({"approved": false, "scope": "always"}), dashboard),
            Ok(None)
        );
        assert_eq!(
            ask(
                json!({"approved": true, "scope": "chat", "tool": "DeleteAlert", "operation": "anything"}),
                dashboard
            ),
            Ok(Some(Requested {
                tool: "UpdateDashboard".into(),
                operation: "update".into(),
                scope: SCOPE_CHAT,
            }))
        );
        let always = json!({"approved": true, "scope": "always"});
        let refused = |reason| Err((SCOPE_ALWAYS, reason));
        assert_eq!(ask(always.clone(), None), refused(GRANT_NO_TOOL));
        assert_eq!(
            ask(always.clone(), Some(&"x".repeat(300))),
            refused(GRANT_NO_TOOL)
        );
        assert_eq!(
            ask(always.clone(), Some("Unknown")),
            refused(GRANT_UNKNOWN_TOOL)
        );
        assert_eq!(ask(always, Some("SearchSQL")), refused(GRANT_READ_ONLY));
    }

    #[test]
    fn only_the_scope_o2_ai_resolved_is_granted() {
        let dashboard = Some("UpdateDashboard");
        assert_eq!(requested(&Value::Null, dashboard, class_of), Ok(None));
        let once = json!({"type": "confirmation_resolved", "approved": true, "scope": "once"});
        assert_eq!(requested(&once, dashboard, class_of), Ok(None));
        let unscoped = json!({"type": "confirmation_resolved", "approved": true});
        assert_eq!(requested(&unscoped, dashboard, class_of), Ok(None));
    }

    #[test]
    fn a_delete_is_granted_for_one_chat_at_most_whatever_its_name() {
        let always = json!({"approved": true, "scope": "always"});
        for tool in ["DeleteAlert", "BulkCleanup"] {
            assert!(requested(&always, Some(tool), class_of).is_err(), "{tool}");
        }
        let named_like_a_delete = requested(&always, Some("DestroyThing"), class_of);
        assert!(named_like_a_delete.unwrap().is_some());
        let chat = json!({"approved": true, "scope": "chat"});
        let granted = requested(&chat, Some("DeleteAlert"), class_of)
            .unwrap()
            .unwrap();
        assert_eq!(granted.operation, "delete");
    }

    #[test]
    fn a_grant_signs_only_its_member_tool_and_chat() {
        let grant = |scope: &str, chat_id: Option<&str>| ai_grants::Model {
            id: "g1".into(),
            org_id: "o".into(),
            user_email: "Alice@x".into(),
            tool: "UpdateAlert".into(),
            operation: "update".into(),
            scope: scope.into(),
            chat_id: chat_id.map(str::to_string),
            granted_by: "Alice@x".into(),
            granted_at: 3,
        };
        let query = GrantQuery {
            org_id: "o".into(),
            user_email: "alice@x".into(),
            session_id: "s1".into(),
            grant_id: "g1".into(),
            tool: "UpdateAlert".into(),
        };
        assert!(grant_matches(&grant("always", None), &query));
        assert!(grant_matches(&grant("chat", Some("s1")), &query));
        assert!(!grant_matches(&grant("chat", Some("s2")), &query));
        let other_tool = GrantQuery {
            tool: "DeleteAlert".into(),
            ..query.clone()
        };
        assert!(!grant_matches(&grant("always", None), &other_tool));
        let other_user = GrantQuery {
            user_email: "mallory@x".into(),
            ..query
        };
        assert!(!grant_matches(&grant("always", None), &other_user));
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

    #[tokio::test]
    async fn a_confirm_reports_a_grant_it_refused_instead_of_dropping_it() {
        let always = json!({"type": "confirmation_resolved", "approved": true, "scope": "always"});
        let outcome = record_from_confirm("o", "s1", "a@x", &always, Some("NoSuchTool")).await;
        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            json!({"stored": false, "scope": "always", "reason": "unknown_tool"})
        );
        let once = json!({"type": "confirmation_resolved", "approved": true, "scope": "once"});
        assert_eq!(
            record_from_confirm("o", "s1", "a@x", &once, Some("NoSuchTool")).await,
            None,
            "no grant asked, nothing to report"
        );
        let stored = GrantOutcome {
            stored: true,
            scope: SCOPE_CHAT,
            id: Some("g1".into()),
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(stored).unwrap(),
            json!({"stored": true, "scope": "chat", "id": "g1"})
        );
    }

    #[test]
    fn a_decision_claim_is_held_until_it_runs_out() {
        assert!(!decision_free(b"1000", 999));
        assert!(decision_free(b"1000", 1000));
        assert!(decision_free(b"garbled", 0));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn only_one_confirm_holds_a_cards_decision_at_a_time() {
        crate::request::security::tests::meta_store().await;
        let id = format!("apr_{}", config::ider::uuid());
        assert!(claim_decision("o", &id).await);
        assert!(
            !claim_decision("o", &id).await,
            "a second confirm, on any replica, must not forward"
        );
        assert!(claim_decision("other", &id).await);
        release_decision("o", &id).await;
        assert!(claim_decision("o", &id).await);
    }
}

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

use std::{collections::BTreeSet, str::FromStr};

use async_trait::async_trait;
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, Query, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use config::{
    meta::{
        alerts::ack::{AckSource, PersonRef},
        user::UserRole,
    },
    utils::time::now_micros,
};
use infra::db::get_orm_client_ro;
use o2_enterprise::enterprise::{
    alert_calibration_service::{applied::SuggestedChange, dismissals::Target},
    autoobserve::{
        api::Deps,
        contract::EntityRef,
        decisions::{
            self, Access, BODY_INVALID, CAN_ACT_SHOWN, Caller, Ctx, DecideBody, DecisionError,
            Family, ListQuery, Owners, OwnersScope, PreviewQuery, QUERY_INVALID, RefusalReason,
            Source, SubjectInfo, UndoRequest,
        },
        names::{dims, kinds},
    },
};
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::Headers};
use openobserve_core::{
    alerts::{
        alert,
        alert_calibration::{applied::LiveAlerts, dismissals::DismissalKv},
    },
    background_access::rbac_enforced,
    users,
};
use serde::Serialize;
use svix_ksuid::Ksuid;

use super::{LiveDigest, alert_allows, may_change_mark, readable_subjects};
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::{
        alert_calibration::{
            digests::{finding_change, finding_target},
            dismissals::{may_dismiss, visible_alerts},
        },
        alert_grants::org_wide_allows,
        alerts::ack::ack_source,
        security,
    },
    service::auth::UserEmail,
};

const DISABLED_MESSAGE: &str =
    "AutoObserve decisions are disabled (O2_AUTOOBSERVE_DECISIONS_ENABLED=false)";
const OWNERS_SHOWN: usize = 10;

struct LiveAccess<'a> {
    org_id: &'a str,
    user_id: &'a str,
}

#[async_trait]
impl Access for LiveAccess<'_> {
    async fn readable(&self, subjects: Vec<EntityRef>) -> Vec<bool> {
        readable_subjects(self.org_id, self.user_id, subjects).await
    }

    async fn visible_alerts(&self, alert_ids: Vec<String>) -> anyhow::Result<BTreeSet<String>> {
        Ok(visible_alerts(self.org_id, self.user_id, alert_ids).await?)
    }

    /// Calibration's org-wide rule; the service adds DEC-3's folder rule through `may_edit_alert`.
    async fn may_decide(&self, family: Family, subject: &EntityRef) -> bool {
        match family {
            Family::AlertFinding => may_dismiss(self.org_id, self.user_id).await,
            Family::Suggestion => {
                let id = subject
                    .key_dims
                    .get(dims::ENTITY_ID)
                    .map_or("", String::as_str);
                may_change_mark(self.org_id, self.user_id, &subject.kind, id).await
            }
        }
    }

    async fn reads_notes(&self, family: Family) -> bool {
        match family {
            Family::AlertFinding => may_dismiss(self.org_id, self.user_id).await,
            Family::Suggestion => {
                !rbac_enforced().await
                    || org_wide_allows(self.org_id, self.user_id, "alerts", "PUT").await
            }
        }
    }

    async fn describe(&self, subject: &EntityRef) -> SubjectInfo {
        describe(self.org_id, subject).await
    }

    async fn can_act(&self) -> Vec<PersonRef> {
        can_act(self.org_id).await
    }

    async fn finding(&self, id: &str, now: i64) -> anyhow::Result<Option<Target>> {
        Ok(finding_target(self.org_id, id, now).await?)
    }

    /// The checks the alert PUT route makes, so a change here needs what the editor's Save does.
    async fn may_edit_alert(&self, alert_id: &str) -> bool {
        let may_put = !rbac_enforced().await
            || alert_allows(self.org_id, self.user_id, alert_id, "PUT").await == Some(true);
        let detection = security::is_siem_alert(self.org_id, alert_id).await;
        may_put
            && security::guard_siem(self.org_id, self.user_id, "POST", detection)
                .await
                .is_ok()
    }

    /// Only a caller the folder already lets edit is refused for Security alone.
    async fn lacks_security(&self, alert_id: &str) -> bool {
        let detection = security::is_siem_alert(self.org_id, alert_id).await;
        if !detection {
            return false;
        }
        let may_put = !rbac_enforced().await
            || alert_allows(self.org_id, self.user_id, alert_id, "PUT").await == Some(true);
        may_put
            && security::guard_siem(self.org_id, self.user_id, "POST", detection)
                .await
                .is_err()
    }

    async fn owners(&self, subject: &EntityRef, reason: RefusalReason) -> Owners {
        let folder_admins = match (reason, alert_folder_id(self.org_id, subject).await) {
            (RefusalReason::Folder, Some(folder)) if rbac_enforced().await => {
                folder_admins(self.org_id, &folder).await
            }
            _ => Vec::new(),
        };
        pick_owners(folder_admins, org_admins(self.org_id).await, self.user_id)
    }

    async fn suggested_change(
        &self,
        id: &str,
        now: i64,
    ) -> anyhow::Result<Option<SuggestedChange>> {
        Ok(finding_change(self.org_id, self.user_id, id, now).await?)
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/decisions/preview",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObservePreviewDecision",
    summary = "Preview a decision",
    description = "What dismissing or accepting a suggestion, or dismissing or applying an alert calibration finding, would change: for whom, until when, and whether the caller may do it. An apply answers `change`: the alert, each field's old and new value, and how many acknowledged firings would no longer alert. A caller who may not gets `locked` with the folder and up to 3 people who can act. Changes no alert and no decision; the change shown to someone who may apply it is kept, so an apply or an editor Save records exactly that change. `reason`, `duration_days`, `until` and `until_reopened` are optional and shape `effect`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("family" = String, Query, description = "suggestion or alert_finding"),
        ("id" = String, Query, description = "The suggestion id, or the finding id"),
        ("action" = String, Query, description = "dismiss, accept or apply"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown family, action or term", content_type = "application/json", body = Object),
        (status = 404, description = "The item is not listed or not readable, or decisions are disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "The suggestion is an alert calibration finding", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Preview what an AutoObserve decision would change", "category": "autoobserve"}))
    )
)]
pub async fn preview_decision(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    query: Result<Query<PreviewQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(Query(query)) = query else {
        return failed(&DecisionError::Invalid(QUERY_INVALID.to_string()));
    };
    let source = decision_source(delegated.as_deref(), &headers);
    let access = LiveAccess {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    let deps = match Deps::live() {
        Ok(deps) => deps,
        Err(e) => return failed(&e.into()),
    };
    let ctx = context(&deps, &access, source);
    respond(decisions::preview(&ctx, &query, now_micros()).await)
}

#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoobserve/decisions",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveDecide",
    summary = "Dismiss, accept or apply",
    description = "Dismisses or accepts a suggestion, or dismisses an alert calibration finding or applies its stored change to the alert as the caller, for the whole org. An apply writes only while the alert still holds each old value; `applied_via: editor` records a change the alert editor already saved. The body is one decision or `items` (1 to 50), each answered with its own status. The same `request_id` answers the stored outcome as `unchanged` and writes nothing; a stale `expected_revision` is a 409. Planned work takes `until`, at most 7 days ahead; other reasons take `duration_days` (30, 90 or 180) or, for a finding, `until_reopened`. A refusal is a 403 naming the folder and up to 3 people who can act.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(Object), description = "family, id, action, reason, note, until, duration_days or until_reopened, expected_revision, request_id, applied_via; or items of those", content_type = "application/json"),
    responses(
        (status = 200, description = "`change` is created, updated or unchanged; a batch answers `results`", content_type = "application/json", body = Object),
        (status = 400, description = "An unreadable body, or an invalid reason, note or term", content_type = "application/json", body = Object),
        (status = 403, description = "decision_refused: the caller may not decide on this item; slack_changes_off: a Slack caller's decision while the org does not allow changes from Slack", content_type = "application/json", body = Object),
        (status = 404, description = "The item is not listed or not readable, or decisions are disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "The item changed since `expected_revision`, the suggestion is an alert calibration finding, or alert_changed: the alert no longer holds the old value", content_type = "application/json", body = Object),
        (status = 500, description = "The write failed, or the decision was saved without its history row", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Dismiss or accept AutoObserve suggestions and alert calibration findings", "category": "autoobserve", "requires_confirmation": true}))
    )
)]
pub async fn decide(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(body) = serde_json::from_slice::<DecideBody>(&body) else {
        return failed(&DecisionError::Invalid(BODY_INVALID.to_string()));
    };
    let source = decision_source(delegated.as_deref(), &headers);
    let access = LiveAccess {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    let deps = match Deps::live() {
        Ok(deps) => deps,
        Err(e) => return failed(&e.into()),
    };
    let ctx = context(&deps, &access, source);
    let now = now_micros();
    match body {
        DecideBody::One(request) => respond(decisions::decide_one(&ctx, &request, now).await),
        DecideBody::Batch(batch) => respond(decisions::decide_batch(&ctx, &batch.items, now).await),
    }
}

#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoobserve/decisions/{decision_id}/undo",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveUndoDecision",
    summary = "Undo a decision",
    description = "Ends a decision in force, so the item is shown again: a dismissal is reopened, an accept also removes the mark it set, and an apply puts each old value back for 30 days while the alert still holds the new ones. Needs the rights of the decision it undoes and the revision the caller last saw. The same `request_id` answers `unchanged`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("decision_id" = String, Path, description = "The decision_id a decision or the list answered"),
    ),
    request_body(content = inline(Object), description = "expected_revision, and an optional request_id", content_type = "application/json"),
    responses(
        (status = 200, description = "`change` is undone or unchanged", content_type = "application/json", body = Object),
        (status = 400, description = "An unreadable body", content_type = "application/json", body = Object),
        (status = 403, description = "decision_refused: the caller may not undo this decision; slack_changes_off: a Slack caller's undo while the org does not allow changes from Slack", content_type = "application/json", body = Object),
        (status = 404, description = "No such decision in force, the changed alert was deleted, or decisions are disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "The decision changed since `expected_revision`, or alert_changed: the alert no longer holds an applied value", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Undo an AutoObserve decision", "category": "autoobserve", "requires_confirmation": true}))
    )
)]
pub async fn undo_decision(
    Path((org_id, decision_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(request) = serde_json::from_slice::<UndoRequest>(&body) else {
        return failed(&DecisionError::Invalid(BODY_INVALID.to_string()));
    };
    let source = decision_source(delegated.as_deref(), &headers);
    let access = LiveAccess {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    let deps = match Deps::live() {
        Ok(deps) => deps,
        Err(e) => return failed(&e.into()),
    };
    let ctx = context(&deps, &access, source);
    respond(decisions::undo(&ctx, &decision_id, &request, now_micros()).await)
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/decisions",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveListDecisions",
    summary = "List decisions in force and applied changes",
    description = "The dismissals and accepts in force on items the caller can read, and every change applied to an alert the caller can read, newest first: who, why, until when, and the revision an undo needs. An applied change has action `apply`, state `applied` or `undone`, `via` (`apply` or `editor`) and `change` with the alert's id and title and each field from old to new; undone changes stay listed. `total` counts only readable decisions. A note is returned only to its author and to callers who may decide; others see `has_note`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("state" = Option<String>, Query, description = "active, the default and the only state listed"),
        ("family" = Option<String>, Query, description = "suggestion or alert_finding; both when absent"),
        ("limit" = Option<usize>, Query, description = "1 to 500; 100 when absent"),
        ("offset" = Option<usize>, Query, description = "Rows to skip"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown state or family, or a limit outside 1 to 500", content_type = "application/json", body = Object),
        (status = 404, description = "Decisions are disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List AutoObserve decisions in force, such as dismissed suggestions", "category": "autoobserve"}))
    )
)]
pub async fn list_decisions(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(Query(query)) = query else {
        return failed(&DecisionError::Invalid(QUERY_INVALID.to_string()));
    };
    let source = decision_source(delegated.as_deref(), &headers);
    let access = LiveAccess {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    let deps = match Deps::live() {
        Ok(deps) => deps,
        Err(e) => return failed(&e.into()),
    };
    let ctx = context(&deps, &access, source);
    respond(decisions::list(&ctx, &query, now_micros()).await)
}

pub(crate) fn decision_source(delegated: Option<&DelegatedCaller>, headers: &HeaderMap) -> Source {
    match ack_source(delegated, headers) {
        AckSource::Slack => Source::Slack,
        AckSource::Ui => Source::Ui,
        _ => Source::Api,
    }
}

/// Every active suggestion decision `user_id` can read, for the Slack insights feed's S5 updates.
pub(super) async fn feed_decisions(
    org_id: &str,
    user_id: &str,
    now: i64,
) -> Result<Vec<o2_enterprise::enterprise::autoobserve::decisions::DecisionView>, DecisionError> {
    use o2_enterprise::enterprise::autoobserve::decisions::{Family, ListQuery};
    let access = LiveAccess { org_id, user_id };
    let deps = Deps::live().map_err(DecisionError::from)?;
    let ctx = context(&deps, &access, Source::Api);
    let mut out = Vec::new();
    loop {
        let query = ListQuery {
            state: Some("active".into()),
            family: Some(Family::Suggestion),
            limit: None,
            offset: Some(out.len()),
        };
        let page = decisions::list(&ctx, &query, now).await?;
        let got = page.decisions.len();
        out.extend(page.decisions);
        if got == 0 || out.len() >= page.total {
            return Ok(out);
        }
    }
}

fn deployment_disabled() -> Option<Response> {
    (!decisions_enabled()).then(|| MetaHttpResponse::not_found(DISABLED_MESSAGE))
}

fn decisions_enabled() -> bool {
    #[cfg(test)]
    if let Some(on) = tests::DECISIONS_ON.with(std::cell::Cell::get) {
        return on;
    }
    decisions::is_enabled()
}

fn context<'a>(deps: &'a Deps, access: &'a LiveAccess<'a>, source: Source) -> Ctx<'a> {
    Ctx {
        deps,
        store: &DismissalKv,
        alerts: &LiveAlerts,
        findings: &LiveDigest,
        access,
        org: access.org_id,
        caller: Caller {
            user_id: access.user_id,
            source,
        },
    }
}

fn respond<T: Serialize>(result: Result<T, DecisionError>) -> Response {
    match result {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => failed(&e),
    }
}

fn failed(error: &DecisionError) -> Response {
    let status = StatusCode::from_u16(error.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status, Json(error.body())).into_response()
}

async fn describe(org_id: &str, subject: &EntityRef) -> SubjectInfo {
    let alert_id = (subject.kind == kinds::ALERT)
        .then(|| subject.key_dims.get(dims::ENTITY_ID))
        .flatten();
    if let Some(found) = alert_id.and_then(|id| Ksuid::from_str(id).ok()) {
        let read = alert::get_by_id(get_orm_client_ro().await, org_id, found).await;
        if let Ok((folder, alert)) = read {
            return SubjectInfo {
                title: alert.name,
                folder: Some(folder.name),
                team: None,
            };
        }
    }
    // The entity id is an internal key, so a reader sees the subject's named dims instead.
    let named: Vec<String> = subject
        .key_dims
        .iter()
        .filter(|(dim, _)| dim.as_str() != dims::ENTITY_ID)
        .map(|(_, value)| value.clone())
        .collect();
    let title = if alert_id.is_some() {
        "A deleted alert".to_string()
    } else if named.is_empty() {
        subject
            .key_dims
            .values()
            .cloned()
            .collect::<Vec<_>>()
            .join(" / ")
    } else {
        named.join(" / ")
    };
    SubjectInfo {
        title,
        folder: None,
        team: None,
    }
}

async fn alert_folder_id(org_id: &str, subject: &EntityRef) -> Option<String> {
    let id = (subject.kind == kinds::ALERT)
        .then(|| subject.key_dims.get(dims::ENTITY_ID))
        .flatten()?;
    let found = Ksuid::from_str(id).ok()?;
    let (folder, _) = alert::get_by_id(get_orm_client_ro().await, org_id, found)
        .await
        .ok()?;
    Some(folder.folder_id)
}

/// Users of every role holding All on this alert folder or on all of them; groups are not followed.
async fn folder_admins(org_id: &str, folder_id: &str) -> Vec<String> {
    use o2_openfga::authorizer::roles::{get_all_roles, get_role_permissions, get_users_with_role};

    let objects = [
        format!("afolder:{folder_id}"),
        format!("afolder:_all_{org_id}"),
    ];
    let Ok(roles) = get_all_roles(org_id, None).await else {
        return Vec::new();
    };
    let mut out = BTreeSet::new();
    for role in roles {
        let Ok(grants) = get_role_permissions(org_id, &role, "afolder").await else {
            continue;
        };
        let owns = grants.iter().any(|g| {
            g.permission == o2_dex::meta::auth::Permission::AllowAll && objects.contains(&g.object)
        });
        if owns && let Ok(users) = get_users_with_role(org_id, &role).await {
            out.extend(users);
        }
    }
    out.into_iter().collect()
}

async fn org_admins(org_id: &str) -> Vec<String> {
    infra::table::org_users::list_users_by_org(org_id)
        .await
        .map(|members| {
            members
                .into_iter()
                .filter(|m| m.role == UserRole::Admin)
                .map(|m| m.email)
                .collect()
        })
        .unwrap_or_default()
}

/// Folder admins when there are any besides the caller, else the org's admins; never the caller.
fn pick_owners(folder_admins: Vec<String>, org_admins: Vec<String>, caller: &str) -> Owners {
    let others = |emails: Vec<String>| {
        let mut kept: Vec<String> = emails
            .into_iter()
            .filter(|e| !e.eq_ignore_ascii_case(caller))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        kept.truncate(OWNERS_SHOWN);
        kept
    };
    let folder = others(folder_admins);
    if !folder.is_empty() {
        return Owners {
            scope: Some(OwnersScope::Folder),
            emails: folder,
        };
    }
    let org = others(org_admins);
    Owners {
        scope: (!org.is_empty()).then_some(OwnersScope::Org),
        emails: org,
    }
}

async fn can_act(org_id: &str) -> Vec<PersonRef> {
    let Ok(members) = infra::table::org_users::list_users_by_org(org_id).await else {
        return Vec::new();
    };
    let mut people: Vec<(bool, String)> = members
        .into_iter()
        .filter(|m| matches!(m.role, UserRole::Admin | UserRole::Editor))
        .map(|m| (m.role != UserRole::Admin, m.email))
        .collect();
    people.sort();
    let mut out = Vec::with_capacity(people.len());
    for (index, (_, email)) in people.into_iter().enumerate() {
        let name = if index < CAN_ACT_SHOWN {
            users::get_user(Some(org_id), &email)
                .await
                .map(|u| {
                    format!("{} {}", u.first_name, u.last_name)
                        .trim()
                        .to_string()
                })
                .filter(|n| !n.is_empty())
        } else {
            None
        };
        out.push(PersonRef { email, name });
    }
    out
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, header},
        routing,
    };
    use o2_enterprise::enterprise::autoobserve::decisions::{
        Action, BatchRequest, BatchResult, Change, ComesBack, DecisionList, DecisionRequest,
        DecisionResult, DecisionState, DecisionView, Effect, ErrorBody, Failure, ItemResult,
        Preview, Reason, Refusal,
    };
    use serde::Deserialize;
    use tower::ServiceExt;

    use super::*;

    thread_local! {
        pub(super) static DECISIONS_ON: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
    }

    const FIXTURE: &str = include_str!(
        "../../../../../../web/src/components/autoobserve/live/__fixtures__/autoobserveDecisions.json"
    );
    const AT: i64 = 1_730_908_800_000_000;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Fixture {
        decide_one: DecisionRequest,
        decide_batch: BatchRequest,
        undo: UndoRequest,
        preview: Preview,
        preview_locked: Preview,
        decided: DecisionResult,
        batch: BatchResult,
        undone: DecisionResult,
        list: DecisionList,
        refused: ErrorBody,
        conflict: ErrorBody,
    }

    fn app() -> Router {
        Router::new()
            .route(
                "/v2/{org_id}/autoobserve/decisions",
                routing::get(list_decisions).post(decide),
            )
            .route(
                "/v2/{org_id}/autoobserve/decisions/preview",
                routing::get(preview_decision),
            )
            .route(
                "/v2/{org_id}/autoobserve/decisions/{decision_id}/undo",
                routing::post(undo_decision),
            )
            .route(
                "/v2/{org_id}/alert_calibration/findings/{finding_id}/dismiss",
                routing::post(crate::request::alert_calibration::dismissals::dismiss_finding),
            )
    }

    async fn send(method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("user_id", "root@example.com")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    fn caller(scope: &str) -> DelegatedCaller {
        DelegatedCaller {
            link_id: "l1".into(),
            installation_id: "i1".into(),
            org: "demo-org".into(),
            jti: "j1".into(),
            scope: scope.into(),
        }
    }

    fn view(family: Family, id: &str, action: Action, reason: Option<&str>) -> DecisionView {
        DecisionView {
            decision_id: decisions::decision_id(family, id),
            family,
            id: id.into(),
            action,
            state: DecisionState::Active,
            reason: reason.map(str::to_string),
            note: None,
            has_note: false,
            actor: "alice@demo-org.test".into(),
            source: Some(Source::Slack),
            decided_at: AT,
            until: Some(AT + 2 * 3_600_000_000),
            revision: 1,
            subject: None,
            change: None,
            via: None,
            undone_at: None,
            undone_by: None,
        }
    }

    fn subject() -> SubjectInfo {
        SubjectInfo {
            title: "cluster-d k8s_events".into(),
            folder: None,
            team: None,
        }
    }

    fn refusal() -> Refusal {
        let people = ["ada", "bo", "cy", "di"]
            .iter()
            .map(|n| PersonRef {
                email: format!("{n}@demo-org.test"),
                name: None,
            })
            .collect();
        Refusal::new(
            "dismiss",
            RefusalReason::Folder,
            Some("infra".into()),
            Owners::default(),
            people,
        )
    }

    fn fixture() -> Fixture {
        let (suggestion, finding) = ("s-cluster-d", "f".repeat(64));
        let one = DecisionRequest {
            family: Family::Suggestion,
            id: suggestion.into(),
            action: Action::Dismiss,
            reason: Some(Reason::PlannedWork),
            note: Some("node pool upgrade".into()),
            until: Some(AT + 2 * 3_600_000_000),
            duration_days: None,
            until_reopened: None,
            expected_revision: None,
            request_id: Some("3f2c9a1e-dialog".into()),
            applied_via: None,
        };
        let report = DecisionRequest {
            family: Family::AlertFinding,
            id: finding.clone(),
            reason: Some(Reason::IntendedReport),
            note: None,
            until: None,
            until_reopened: Some(true),
            request_id: Some("slack-hash-1".into()),
            ..one.clone()
        };
        let dismissed = view(
            Family::Suggestion,
            suggestion,
            Action::Dismiss,
            Some("planned_work"),
        );
        let preview = Preview {
            may: true,
            verb: "dismiss".into(),
            decision_id: dismissed.decision_id.clone(),
            family: Family::Suggestion,
            id: suggestion.into(),
            action: Action::Dismiss,
            effect: Effect {
                scope: decisions::SCOPE_ORG.into(),
                until: Some(AT + 2 * 3_600_000_000),
                comes_back_when: ComesBack::AtUntil,
                mark: None,
            },
            subject: subject(),
            revision: 0,
            current: None,
            locked: None,
            change: None,
            summary: None,
        };
        let mut reported = view(
            Family::AlertFinding,
            &finding,
            Action::Dismiss,
            Some("intended_report"),
        );
        reported.until = None;
        let failed = Failure {
            code: 409,
            error: "calibration_owned".into(),
            message: decisions::CALIBRATION_OWNED.into(),
        };
        let mut undone = dismissed.clone();
        undone.state = DecisionState::Undone;
        undone.revision = 2;
        undone.reason = None;
        undone.until = None;
        let mut listed = dismissed.clone();
        listed.subject = Some(subject());
        Fixture {
            decide_one: one,
            decide_batch: BatchRequest {
                items: vec![report.clone()],
            },
            undo: UndoRequest {
                expected_revision: 1,
                request_id: Some("3f2c9a1e-undo".into()),
            },
            preview_locked: Preview {
                may: false,
                locked: Some(refusal()),
                ..preview.clone()
            },
            preview,
            decided: DecisionResult {
                change: Change::Created,
                decision: dismissed.clone(),
                replayed: false,
            },
            batch: BatchResult {
                results: vec![
                    ItemResult {
                        index: 0,
                        family: Family::AlertFinding,
                        id: finding.clone(),
                        status: 200,
                        result: Some(DecisionResult {
                            change: Change::Created,
                            decision: reported,
                            replayed: false,
                        }),
                        error: None,
                    },
                    ItemResult {
                        index: 1,
                        family: Family::Suggestion,
                        id: "s-blind-alert".into(),
                        status: 409,
                        result: None,
                        error: Some(ErrorBody::Failed(failed)),
                    },
                ],
                written: 1,
                unchanged: 0,
                failed: 1,
            },
            undone: DecisionResult {
                change: Change::Undone,
                decision: undone,
                replayed: false,
            },
            list: DecisionList {
                decisions: vec![listed],
                total: 1,
                limit: 100,
                offset: 0,
            },
            refused: ErrorBody::Refused(refusal()),
            conflict: DecisionError::Conflict(
                o2_enterprise::enterprise::alert_calibration_service::dismissals::FINDING_CHANGED
                    .into(),
            )
            .body(),
        }
    }

    #[test]
    fn owners_are_the_folder_admins_else_the_org_admins_and_never_the_caller() {
        let emails = |v: &[&str]| v.iter().map(|e| e.to_string()).collect::<Vec<_>>();
        let folder = pick_owners(
            emails(&["pay-lead@x.test", "ops-lead@x.test", "pay-lead@x.test"]),
            emails(&["admin@x.test"]),
            "OPS-LEAD@x.test",
        );
        assert_eq!(folder.scope, Some(OwnersScope::Folder));
        assert_eq!(folder.emails, emails(&["pay-lead@x.test"]));
        let org = pick_owners(
            emails(&["ops-lead@x.test"]),
            emails(&["b@x.test", "a@x.test"]),
            "ops-lead@x.test",
        );
        assert_eq!(org.scope, Some(OwnersScope::Org));
        assert_eq!(org.emails, emails(&["a@x.test", "b@x.test"]));
        let nobody = pick_owners(vec![], emails(&["me@x.test"]), "me@x.test");
        assert_eq!((nobody.scope, nobody.emails.len()), (None, 0));
        let many: Vec<String> = (0..15).map(|i| format!("u{i:02}@x.test")).collect();
        assert_eq!(
            pick_owners(many, vec![], "me@x.test").emails.len(),
            OWNERS_SHOWN
        );
    }

    #[test]
    fn the_decision_bodies_match_the_web_fixture_byte_for_byte() {
        let built = fixture();
        let text = serde_json::to_string_pretty(&built).unwrap() + "\n";
        assert_eq!(
            text, FIXTURE,
            "regenerate the fixture from this test's output"
        );
        let parsed: Fixture = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(parsed, built);
        assert_eq!(built.refused.clone(), ErrorBody::Refused(refusal()));
        let refused = serde_json::to_value(&built.refused).unwrap();
        assert_eq!(refused["code"], "decision_refused");
        assert_eq!(refused["more"], 1);
        assert_eq!(built.list.decisions[0].until, Some(AT + 2 * 3_600_000_000));
    }

    #[test]
    fn a_slack_action_caller_is_slack_and_a_session_is_the_ui() {
        let mut session = HeaderMap::new();
        session.insert(header::COOKIE, "auth_tokens=abc".parse().unwrap());
        let slack = caller("slack_action");
        assert_eq!(decision_source(Some(&slack), &session), Source::Slack);
        assert_eq!(decision_source(None, &session), Source::Ui);
        assert_eq!(decision_source(None, &HeaderMap::new()), Source::Api);
        let assistant = caller("assistant");
        assert_eq!(decision_source(Some(&assistant), &session), Source::Api);
    }

    #[tokio::test]
    async fn every_decision_route_is_a_404_while_the_switch_is_off_and_calibration_still_answers() {
        DECISIONS_ON.with(|on| on.set(Some(false)));
        let body = r#"{"family":"suggestion","id":"s1","action":"dismiss"}"#;
        for (method, uri, body) in [
            ("GET", "/v2/demo-org/autoobserve/decisions", ""),
            ("POST", "/v2/demo-org/autoobserve/decisions", body),
            (
                "GET",
                "/v2/demo-org/autoobserve/decisions/preview?family=suggestion&id=s1&action=dismiss",
                "",
            ),
            (
                "POST",
                "/v2/demo-org/autoobserve/decisions/suggestion:s1/undo",
                r#"{"expected_revision":1}"#,
            ),
        ] {
            let (status, text) = send(method, uri, body).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri}");
            assert!(text.contains("O2_AUTOOBSERVE_DECISIONS_ENABLED"), "{text}");
        }
        // Calibration's route answers by its own switch and checks, never by this one.
        let (_, text) = send(
            "POST",
            "/v2/demo-org/alert_calibration/findings/f1/dismiss",
            "{}",
        )
        .await;
        assert!(!text.contains("O2_AUTOOBSERVE_DECISIONS_ENABLED"), "{text}");
    }

    #[tokio::test]
    async fn an_unreadable_body_or_query_is_a_json_400_naming_no_field() {
        DECISIONS_ON.with(|on| on.set(Some(true)));
        for (method, uri, body) in [
            (
                "POST",
                "/v2/demo-org/autoobserve/decisions",
                r#"{"family":"suggestion"}"#,
            ),
            (
                "POST",
                "/v2/demo-org/autoobserve/decisions",
                r#"{"items":[],"x":1}"#,
            ),
            ("GET", "/v2/demo-org/autoobserve/decisions?stat=active", ""),
            (
                "GET",
                "/v2/demo-org/autoobserve/decisions/preview?family=x&id=s1&action=dismiss",
                "",
            ),
            (
                "POST",
                "/v2/demo-org/autoobserve/decisions/suggestion:s1/undo",
                r#"{"expected_revison":1}"#,
            ),
        ] {
            let (status, text) = send(method, uri, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{method} {uri}");
            let body: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(body["error"], "invalid", "{text}");
            assert!(!body["message"].as_str().unwrap().contains('_'), "{text}");
        }
    }

    #[tokio::test]
    async fn a_subject_is_titled_by_its_named_dims_never_its_entity_id() {
        let service = EntityRef::new(
            kinds::SERVICE,
            &[
                (dims::ENTITY_ID, "3LjZZsvc0000000000000000001"),
                (dims::SERVICE_NAME, "svc-a"),
            ],
        );
        assert_eq!(describe("demo-org", &service).await.title, "svc-a");
        let bare = EntityRef::new(kinds::SERVICE, &[(dims::ENTITY_ID, "svc-a")]);
        assert_eq!(describe("demo-org", &bare).await.title, "svc-a");
    }

    mod detection_gate {
        use std::{
            collections::HashMap,
            sync::{
                Arc, Mutex,
                atomic::{AtomicUsize, Ordering::SeqCst},
            },
        };

        use config::meta::{
            alerts::alert::{Alert, SIEM_ATTRIBUTE},
            folder::Folder,
        };
        use o2_enterprise::enterprise::{
            alert_calibration_service::applied::{AlertNow, AlertPatcher, Fence, Patched},
            autoobserve::{
                analyzers::heartbeat::HeartbeatSwitches,
                decisions::{DecisionError, DecisionRequest, DecisionResult, Preview},
                insight::FieldPatch,
                marks::TableKvReader,
                ports::{Ports, StreamSinkPort},
            },
        };
        use serde_json::{Value, json};

        use super::*;
        use crate::request::security::tests::{grant, meta_store};

        const FINDING: &str = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";

        /// The finding's change is handed in; the edit rule is the route's own.
        struct Offered<'a> {
            live: LiveAccess<'a>,
            change: SuggestedChange,
        }

        #[async_trait]
        impl Access for Offered<'_> {
            async fn readable(&self, subjects: Vec<EntityRef>) -> Vec<bool> {
                vec![true; subjects.len()]
            }

            async fn visible_alerts(
                &self,
                alert_ids: Vec<String>,
            ) -> anyhow::Result<BTreeSet<String>> {
                Ok(alert_ids.into_iter().collect())
            }

            async fn may_decide(&self, _family: Family, _subject: &EntityRef) -> bool {
                false
            }

            async fn reads_notes(&self, _family: Family) -> bool {
                true
            }

            async fn describe(&self, _subject: &EntityRef) -> SubjectInfo {
                SubjectInfo {
                    title: "login failures".into(),
                    folder: Some("ops".into()),
                    team: None,
                }
            }

            async fn can_act(&self) -> Vec<PersonRef> {
                Vec::new()
            }

            async fn finding(&self, _id: &str, _now: i64) -> anyhow::Result<Option<Target>> {
                Ok(None)
            }

            async fn may_edit_alert(&self, alert_id: &str) -> bool {
                self.live.may_edit_alert(alert_id).await
            }

            async fn lacks_security(&self, alert_id: &str) -> bool {
                self.live.lacks_security(alert_id).await
            }

            async fn suggested_change(
                &self,
                _id: &str,
                _now: i64,
            ) -> anyhow::Result<Option<SuggestedChange>> {
                Ok(Some(self.change.clone()))
            }
        }

        #[derive(Default)]
        struct Pending {
            secs: Mutex<HashMap<String, i64>>,
            writes: AtomicUsize,
        }

        impl Pending {
            fn of(&self, alert_id: &str) -> i64 {
                self.secs
                    .lock()
                    .unwrap()
                    .get(alert_id)
                    .copied()
                    .unwrap_or(0)
            }

            fn write(&self, alert_id: &str, patch: &[FieldPatch]) -> Patched {
                let mut secs = self.secs.lock().unwrap();
                let now = secs.entry(alert_id.to_string()).or_insert(0);
                for field in patch {
                    if let FieldPatch::PendingPeriodSecs { from, to } = field {
                        if *now != *from {
                            return Patched::Changed;
                        }
                        *now = *to;
                    }
                }
                self.writes.fetch_add(1, SeqCst);
                Patched::Written
            }
        }

        #[async_trait]
        impl AlertPatcher for Pending {
            async fn read(&self, _org: &str, alert_id: &str) -> anyhow::Result<Option<AlertNow>> {
                Ok(Some(AlertNow {
                    title: "login failures".into(),
                    folder: Some("ops".into()),
                    destinations: vec!["ops".into()],
                    pending_period_secs: self.of(alert_id),
                }))
            }

            async fn patch(
                &self,
                _org: &str,
                alert_id: &str,
                _actor: &str,
                patch: &[FieldPatch],
            ) -> anyhow::Result<Patched> {
                Ok(self.write(alert_id, patch))
            }

            async fn patch_fenced(
                &self,
                org: &str,
                alert_id: &str,
                _actor: &str,
                patch: &[FieldPatch],
                fence: &Fence,
            ) -> anyhow::Result<Patched> {
                let written = Bytes::from(fence.written.clone());
                let swapped = openobserve_core::kv::compare_and_set(
                    org,
                    &fence.key,
                    Some(&fence.expected),
                    written,
                )
                .await?;
                Ok(if swapped {
                    self.write(alert_id, patch)
                } else {
                    Patched::Fenced
                })
            }
        }

        #[derive(Default)]
        struct History(Mutex<Vec<Value>>);

        #[async_trait]
        impl StreamSinkPort for History {
            async fn append(&self, _stream: &str, rows: Vec<Value>) -> anyhow::Result<()> {
                self.0.lock().unwrap().extend(rows);
                Ok(())
            }
        }

        fn deps() -> Deps {
            Deps {
                ports: Arc::new(Ports {
                    sink: Arc::new(History::default()),
                    ..openobserve_core::autoobserve::ports::ports()
                }),
                kv: Arc::new(TableKvReader),
                heartbeat: HeartbeatSwitches::default(),
                source_suggestions: false,
                learning: None,
            }
        }

        /// An alert stored in folder ops and cached as the alert routes read it, and a root user.
        async fn stored_alert(org: &str) -> (String, String) {
            use config::meta::folder::FolderType;

            meta_store().await;
            let folder = Folder {
                folder_id: "ops".to_string(),
                name: "ops".to_string(),
                ..Default::default()
            };
            infra::table::folders::put(org, None, folder, FolderType::Alerts)
                .await
                .unwrap();
            let mut alert = Alert::default();
            alert.name = "login_failures".to_string();
            alert.org_id = org.to_string();
            alert.stream_name = "web".to_string();
            let alert = infra::table::alerts::create(
                infra::db::get_orm_client_rw().await,
                org,
                "ops",
                alert,
                false,
            )
            .await
            .unwrap();
            let id = alert.id.unwrap().to_string();
            mark(org, &id, false).await;
            let root = format!("root-{org}@example.com");
            common::infra::config::ORG_USERS.insert(
                format!("{}/{root}", config::DEFAULT_ORG),
                infra::table::org_users::OrgUserRecord::new(
                    config::DEFAULT_ORG,
                    &root,
                    config::meta::user::UserRole::Root,
                    "token",
                    None,
                ),
            );
            (id, root)
        }

        /// Marks or unmarks the cached alert as a detection, as saving the detection flag does.
        async fn mark(org: &str, id: &str, detection: bool) {
            let mut alert = Alert::default();
            alert.id = Some(svix_ksuid::Ksuid::from_str(id).unwrap());
            alert.org_id = org.to_string();
            alert.name = "login_failures".to_string();
            if detection {
                alert.context_attributes = Some(
                    [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                        .into_iter()
                        .collect(),
                );
            }
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(org, id),
                (Folder::default(), alert),
            );
        }

        fn wait_longer(alert_id: &str) -> SuggestedChange {
            SuggestedChange {
                alert_id: alert_id.to_string(),
                patch: vec![FieldPatch::PendingPeriodSecs { from: 0, to: 120 }],
                acknowledged: None,
            }
        }

        fn ctx<'a>(
            deps: &'a Deps,
            access: &'a Offered<'a>,
            alerts: &'a Pending,
            user_id: &'a str,
        ) -> Ctx<'a> {
            Ctx {
                deps,
                store: &DismissalKv,
                alerts,
                findings: &LiveDigest,
                access,
                org: access.live.org_id,
                caller: Caller {
                    user_id,
                    source: Source::Ui,
                },
            }
        }

        async fn apply(ctx: &Ctx<'_>) -> Result<DecisionResult, DecisionError> {
            let ask: DecisionRequest = serde_json::from_value(
                json!({"family": "alert_finding", "id": FINDING, "action": "apply"}),
            )
            .unwrap();
            decisions::decide_one(ctx, &ask, now_micros()).await
        }

        async fn preview(ctx: &Ctx<'_>) -> Preview {
            let query: PreviewQuery = serde_json::from_value(
                json!({"family": "alert_finding", "id": FINDING, "action": "apply"}),
            )
            .unwrap();
            decisions::preview(ctx, &query, now_micros()).await.unwrap()
        }

        fn is_refused<T: std::fmt::Debug>(result: &Result<T, DecisionError>) -> bool {
            matches!(result, Err(DecisionError::Refused(_)))
        }

        #[tokio::test]
        async fn detection_apply_needs_the_security_permission_the_editor_save_needs() {
            let org = format!("aec_{}", config::ider::uuid());
            let (alert_id, user) = stored_alert(&org).await;
            mark(&org, &alert_id, true).await;
            grant(&user, &[]);
            let (deps, alerts) = (deps(), Pending::default());
            let access = Offered {
                live: LiveAccess {
                    org_id: &org,
                    user_id: &user,
                },
                change: wait_longer(&alert_id),
            };
            let ctx = ctx(&deps, &access, &alerts, &user);

            let shown = preview(&ctx).await;
            assert!(!shown.may);
            let locked = shown.locked.unwrap();
            assert_eq!(locked.verb, "apply");
            assert_eq!(locked.reason, RefusalReason::Security);
            assert!(
                locked.message.contains("Security permission"),
                "{}",
                locked.message
            );
            let refused = apply(&ctx).await;
            assert!(is_refused(&refused), "{refused:?}");
            assert_eq!((alerts.of(&alert_id), alerts.writes.load(SeqCst)), (0, 0));

            grant(&user, &["POST"]);
            assert!(preview(&ctx).await.may);
            let done = apply(&ctx).await;
            assert!(done.is_ok(), "{done:?}");
            assert_eq!(alerts.of(&alert_id), 120);
        }

        #[tokio::test]
        async fn detection_undo_needs_the_security_permission_the_editor_save_needs() {
            let org = format!("aec_{}", config::ider::uuid());
            let (alert_id, user) = stored_alert(&org).await;
            grant(&user, &[]);
            let (deps, alerts) = (deps(), Pending::default());
            let access = Offered {
                live: LiveAccess {
                    org_id: &org,
                    user_id: &user,
                },
                change: wait_longer(&alert_id),
            };
            let ctx = ctx(&deps, &access, &alerts, &user);
            let done = apply(&ctx).await.unwrap();
            assert_eq!(alerts.of(&alert_id), 120);

            mark(&org, &alert_id, true).await;
            let ask = UndoRequest {
                expected_revision: done.decision.revision,
                request_id: None,
            };
            let decision_id = done.decision.decision_id.clone();
            let refused = decisions::undo(&ctx, &decision_id, &ask, now_micros()).await;
            assert!(is_refused(&refused), "{refused:?}");
            assert_eq!((alerts.of(&alert_id), alerts.writes.load(SeqCst)), (120, 1));

            grant(&user, &["POST"]);
            let undone = decisions::undo(&ctx, &decision_id, &ask, now_micros()).await;
            assert!(undone.is_ok(), "{undone:?}");
            assert_eq!(alerts.of(&alert_id), 0);
        }
    }
}

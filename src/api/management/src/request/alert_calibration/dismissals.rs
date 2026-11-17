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

//! Dismissing one alert's finding, reopening it, and listing them, under the alert's own grants.

use std::{
    collections::{BTreeSet, HashMap},
    future::ready,
};

use axum::{
    Extension, Json,
    extract::{
        Path, Query,
        rejection::{JsonRejection, QueryRejection},
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{meta::alerts::alert::ListAlertsParams, utils::time::now_micros};
use infra::errors::Error as InfraError;
use o2_enterprise::enterprise::{
    alert_calibration_service::{
        AlertCalibrationServiceError as Error,
        dismissals::{
            self, ALERT_NOT_FOUND, BODY_INVALID, DISMISSAL_NOT_FOUND, DismissRequest, Dismissal,
            DismissalFilter, LIST_INVALID, LOAD_FAILED, Reader, ReopenRequest, SAVE_FAILED,
        },
    },
    autoobserve::decisions::{self, Caller},
};
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::Headers};
use openobserve_core::{
    alerts::{alert, alert_calibration::dismissals::DismissalKv},
    background_access::rbac_enforced,
};

use super::{deployment_disabled, visibility::PROBE_CAP};
use crate::{
    request::{
        alert_grants::{
            AlertAuthority, AlertVisibility, LiveAuthority, Probe, alert_visibility,
            live_visibility, org_wide_allows,
        },
        autoobserve::decisions::decision_source,
    },
    service::auth::UserEmail,
};

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/dismissals",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ListAlertCalibrationDismissals",
    summary = "List dismissed alert calibration findings",
    description = "The org's dismissals of single alerts' findings, newest change first. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, and `total` counts only those. A note is returned only to its author and to callers who may dismiss; others see `has_note`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("state" = Option<String>, Query, description = "active (default), expired, reopened or all"),
        ("alert_id" = Option<String>, Query, description = "Only this alert's dismissals"),
        ("rule_id" = Option<String>, Query, description = "Only this rule's, or this rule and pattern's, dismissals"),
        ("cursor" = Option<String>, Query, description = "The previous page's next_cursor"),
        ("limit" = Option<i64>, Query, description = "Rows per page, 1 to 200; 50 when absent"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown state or a malformed cursor", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List dismissed alert calibration findings", "category": "alerts"}))
    )
)]
pub async fn list_dismissals(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    filter: Result<Query<DismissalFilter>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(Query(filter)) = filter else {
        return refused(&Error::Rejected(LIST_INVALID), LOAD_FAILED);
    };
    let rows = match dismissals::load_all(&org_id).await {
        Ok(rows) => rows,
        Err(e) => return refused(&e, LOAD_FAILED),
    };
    let probe = probe_of(&rows);
    let visibility = match live_visibility(&org_id, &user.user_id, || ready(Ok(probe))).await {
        Ok(visibility) => visibility,
        Err(e) => return refused(&e.into(), LOAD_FAILED),
    };
    let reader = Reader {
        user_id: &user.user_id,
        may_dismiss: may_dismiss(&org_id, &user.user_id).await,
    };
    let page = dismissals::select_page(rows, &filter, now_micros(), reader, |id| {
        admits(&visibility, id)
    });
    let mut page = match page {
        Ok(page) => page,
        Err(e) => return refused(&e, LOAD_FAILED),
    };
    let ids = page
        .items
        .iter()
        .map(|item| item.scope_key.clone())
        .collect();
    let names = alert_names(&org_id, ids).await;
    for item in &mut page.items {
        item.alert_name = names.get(&item.scope_key).cloned();
    }
    MetaHttpResponse::json(page)
}

#[utoipa::path(
    post,
    path = "/v2/{org_id}/alert_calibration/findings/{finding_id}/dismiss",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "DismissAlertCalibrationFinding",
    summary = "Dismiss one alert's calibration finding",
    description = "Hides the finding from the next calibration pass for 30, 90 or 180 days, or until reopened. Needs read access to the alert. Repeating the same dismissal changes nothing; any other change starts a new dismissal from now.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("finding_id" = String, Path, description = "The finding_id of the digest record"),
    ),
    request_body(content = inline(Object), description = "rule_id, optional pattern, scope_kind \"alert\", scope_key (the alert id), reason, optional note, and duration_days or until_reopened", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An invalid duration, note, reason, scope or rule", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "The alert is not readable, or alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "The finding id does not match the rule and alert", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Dismiss one alert's calibration finding", "category": "alerts", "requires_confirmation": true}))
    )
)]
pub async fn dismiss_finding(
    Path((org_id, finding_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Result<Json<DismissRequest>, JsonRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(Json(request)) = body else {
        return refused(&Error::Rejected(BODY_INVALID), SAVE_FAILED);
    };
    let validated = match request.validate(&org_id, &finding_id) {
        Ok(validated) => validated,
        Err(e) => return refused(&e, SAVE_FAILED),
    };
    let auth = LiveAuthority {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    if let Err(e) = dismiss_target(&auth, rbac_enforced().await, &validated.alert_id).await {
        return refused(&e, SAVE_FAILED);
    }
    let now = now_micros();
    let caller = Caller {
        user_id: &user.user_id,
        source: decision_source(delegated.as_deref(), &headers),
    };
    match decisions::dismiss_compat(&DismissalKv, &org_id, caller, validated, now).await {
        Ok(row) => respond(&org_id, &row, now).await,
        Err(e) => refused(&e, SAVE_FAILED),
    }
}

#[utoipa::path(
    post,
    path = "/v2/{org_id}/alert_calibration/dismissals/{id}/reopen",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ReopenAlertCalibrationDismissal",
    summary = "Reopen a dismissed alert calibration finding",
    description = "Ends the dismissal, so the next calibration pass may report the finding again. Needs read access to the alert, and the revision the caller last saw.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "The dismissal id, which is the finding_id"),
    ),
    request_body(content = inline(Object), description = "expected_revision: the revision the caller last saw", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A malformed body", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "The dismissal or its alert is not readable, or alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "The dismissal changed since that revision", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Reopen a dismissed alert calibration finding", "category": "alerts"}))
    )
)]
pub async fn reopen_dismissal(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Result<Json<ReopenRequest>, JsonRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let Ok(Json(request)) = body else {
        return refused(&Error::Rejected(BODY_INVALID), SAVE_FAILED);
    };
    let auth = LiveAuthority {
        org_id: &org_id,
        user_id: &user.user_id,
    };
    let loaded = dismissals::load(&org_id, &id).await;
    if let Err(e) = reopen_target(&auth, rbac_enforced().await, loaded).await {
        return refused(&e, SAVE_FAILED);
    }
    let now = now_micros();
    let caller = Caller {
        user_id: &user.user_id,
        source: decision_source(delegated.as_deref(), &headers),
    };
    let reopened = decisions::reopen_compat(
        &DismissalKv,
        &org_id,
        caller,
        &id,
        request.expected_revision,
        now,
    )
    .await;
    match reopened {
        Ok(row) => respond(&org_id, &row, now).await,
        Err(e) => refused(&e, SAVE_FAILED),
    }
}

pub(crate) async fn visible_alerts(
    org_id: &str,
    user_id: &str,
    alert_ids: Vec<String>,
) -> Result<BTreeSet<String>, InfraError> {
    let probe = Probe {
        full: alert_ids.len() > PROBE_CAP,
        ids: alert_ids.clone(),
    };
    let visibility = live_visibility(org_id, user_id, || ready(Ok(probe))).await?;
    let existing = LiveAuthority { org_id, user_id }
        .folders_of(alert_ids)
        .await;
    Ok(existing
        .into_keys()
        .filter(|id| admits(&visibility, id))
        .collect())
}

/// A listed row's alert is readable, so calibration POST is what dismissing still needs.
pub(crate) async fn may_dismiss(org_id: &str, user_id: &str) -> bool {
    !rbac_enforced().await || org_wide_allows(org_id, user_id, "alert_calibration", "POST").await
}

/// Hidden, missing and foreign alerts share one 404, so the answer discloses nothing (D:L329).
async fn dismiss_target<A: AlertAuthority>(
    auth: &A,
    rbac: bool,
    alert_id: &str,
) -> Result<(), Error> {
    if authorize_target(auth, rbac, alert_id).await {
        Ok(())
    } else {
        Err(Error::NotFound(ALERT_NOT_FOUND))
    }
}

/// A dismissal of a hidden alert is as missing as one that never existed.
async fn reopen_target<A: AlertAuthority>(
    auth: &A,
    rbac: bool,
    loaded: Result<Dismissal, Error>,
) -> Result<Dismissal, Error> {
    let row = loaded?;
    if authorize_target(auth, rbac, &row.scope_key).await {
        Ok(row)
    } else {
        Err(Error::NotFound(DISMISSAL_NOT_FOUND))
    }
}

/// The alert exists in this org and the caller may read it; alert PUT is not needed (D:L263).
async fn authorize_target<A: AlertAuthority>(auth: &A, rbac: bool, alert_id: &str) -> bool {
    let visibility = if rbac {
        let probe = || {
            ready(Ok(Probe {
                ids: vec![alert_id.to_string()],
                full: false,
            }))
        };
        match alert_visibility(auth, probe).await {
            Ok(visibility) => visibility,
            Err(_) => return false,
        }
    } else {
        AlertVisibility::Org
    };
    auth.folders_of(vec![alert_id.to_string()])
        .await
        .contains_key(alert_id)
        && admits(&visibility, alert_id)
}

fn admits(visibility: &AlertVisibility, alert_id: &str) -> bool {
    match visibility {
        AlertVisibility::Org | AlertVisibility::AnyAlert => true,
        AlertVisibility::Only(ids) => ids.contains(alert_id),
    }
}

/// Past the cap the probe is full, so the whole org's alerts are judged instead (P3-D3).
fn probe_of(rows: &[Dismissal]) -> Probe {
    let ids: BTreeSet<&str> = rows.iter().map(|row| row.scope_key.as_str()).collect();
    Probe {
        full: ids.len() > PROBE_CAP,
        ids: ids.into_iter().map(str::to_string).collect(),
    }
}

/// The live names, so a renamed alert reads as it is now and a deleted one as null.
async fn alert_names(org_id: &str, ids: Vec<String>) -> HashMap<String, String> {
    if ids.is_empty() {
        return HashMap::new();
    }
    let params = ListAlertsParams::new(org_id).with_tag_alert_ids(ids);
    match alert::list_with_folders_db(params).await {
        Ok(listed) => listed
            .into_iter()
            .filter_map(|(_, a)| Some((a.id?.to_string(), a.name)))
            .collect(),
        Err(e) => {
            log::warn!("[alert_calibration] naming {org_id}'s dismissed alerts failed: {e}");
            HashMap::new()
        }
    }
}

async fn respond(org_id: &str, row: &Dismissal, now: i64) -> Response {
    let mut names = alert_names(org_id, vec![row.scope_key.clone()]).await;
    MetaHttpResponse::json(row.view(now, names.remove(&row.scope_key)))
}

/// A storage failure is logged whole and answered with `storage`, which names nothing internal.
fn refused(error: &Error, storage: &'static str) -> Response {
    let status = error.http_status();
    if status >= 500 {
        log::error!("[alert_calibration] dismissal: {error}");
        return MetaHttpResponse::error(status, storage).into_response();
    }
    MetaHttpResponse::error(status, error.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use o2_enterprise::enterprise::{
        alert_calibration_service::dismissals::{DismissReason, DismissalState},
        autoobserve::insight::finding_identity,
    };

    use super::*;
    use crate::request::alert_grants::tests::CountingAuthority;

    fn folders(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, folder)| (id.to_string(), folder.to_string()))
            .collect()
    }

    fn reader(org_wide: bool, grants: &[&str]) -> CountingAuthority {
        CountingAuthority {
            org_wide: HashMap::from([("alerts", org_wide)]),
            folders: folders(&[("a1", "ops"), ("a2", "pay")]),
            grants: grants.iter().map(|g| g.to_string()).collect(),
            ..Default::default()
        }
    }

    async fn body(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    fn row_on(alert: &str) -> Dismissal {
        Dismissal {
            version: 1,
            id: finding_identity("ops", "noise", "alert", alert),
            rule_id: "noise".to_string(),
            pattern: None,
            scope_kind: "alert".to_string(),
            scope_key: alert.to_string(),
            state: DismissalState::Active,
            revision: 1,
            reason: DismissReason::Expected,
            note: None,
            actor: "u-ops".to_string(),
            dismissed_at: 1,
            duration_days: None,
            expires_at: None,
            reopened_at: None,
            reopened_by: None,
            updated_at: 1,
            source: None,
            request_id: None,
        }
    }

    #[tokio::test]
    async fn a_hidden_or_missing_target_is_the_same_404() {
        let cases = [
            (reader(false, &["alert:a2"]), "a1"),
            (reader(true, &[]), "a9"),
            (reader(false, &["afolder:_all_o"]), "a9"),
            (reader(false, &[]), "a1"),
        ];
        let mut bodies = BTreeSet::new();
        for (auth, alert) in &cases {
            let refusal = dismiss_target(auth, true, alert).await.unwrap_err();
            bodies.insert(body(refused(&refusal, SAVE_FAILED)).await);
        }
        assert_eq!(
            bodies.into_iter().collect::<Vec<_>>(),
            [(
                StatusCode::NOT_FOUND,
                r#"{"code":404,"message":"Alert not found."}"#.to_string()
            )]
        );
        assert!(
            dismiss_target(&reader(false, &["alert:a2"]), true, "a2")
                .await
                .is_ok()
        );
        assert!(
            dismiss_target(&reader(false, &["afolder:ops"]), true, "a1")
                .await
                .is_ok()
        );
        assert!(
            dismiss_target(&reader(false, &[]), false, "a1")
                .await
                .is_ok()
        );
        assert!(
            dismiss_target(&reader(false, &[]), false, "a9")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_reopen_of_a_hidden_alerts_dismissal_is_a_404() {
        let auth = reader(false, &["afolder:pay"]);
        let hidden = reopen_target(&auth, true, Ok(row_on("a1")))
            .await
            .unwrap_err();
        let missing = reopen_target(&auth, true, Err(Error::NotFound(DISMISSAL_NOT_FOUND)))
            .await
            .unwrap_err();
        let (hidden, missing) = (
            body(refused(&hidden, SAVE_FAILED)).await,
            body(refused(&missing, SAVE_FAILED)).await,
        );
        assert_eq!(hidden, missing);
        assert_eq!(hidden.0, StatusCode::NOT_FOUND);
        assert!(hidden.1.contains("Dismissal not found."), "{}", hidden.1);
        let visible = reopen_target(&auth, true, Ok(row_on("a2"))).await.unwrap();
        assert_eq!(visible.scope_key, "a2");
    }

    #[tokio::test]
    async fn a_storage_failure_names_nothing_internal() {
        let failure = Error::Storage("no such table: kv_store".to_string());
        let (status, text) = body(refused(&failure, SAVE_FAILED)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(
            text.contains(SAVE_FAILED) && !text.contains("kv_store"),
            "{text}"
        );
    }

    #[test]
    fn a_large_dismissal_set_probes_the_whole_org() {
        let rows: Vec<Dismissal> = (0..=PROBE_CAP).map(|n| row_on(&format!("a{n}"))).collect();
        assert!(probe_of(&rows).full);
        let few = probe_of(&[row_on("a1"), row_on("a1"), row_on("a2")]);
        assert_eq!(
            (few.ids, few.full),
            (vec!["a1".to_string(), "a2".to_string()], false)
        );
    }

    #[test]
    fn a_visibility_admits_only_its_alerts() {
        let only = AlertVisibility::Only(BTreeSet::from(["a1".to_string()]));
        assert!(admits(&only, "a1") && !admits(&only, "a2"));
        assert!(admits(&AlertVisibility::Org, "a2") && admits(&AlertVisibility::AnyAlert, "a2"));
    }
}

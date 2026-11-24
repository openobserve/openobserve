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

//! Alert lease routes: list, end, extend and keep leases, and the timed `creates_incident` toggle.

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::alerts::lease::{
    CreatesIncidentRequest, CreatesIncidentResponse, LeaseConflict, LeaseExtendRequest, LeaseState,
    LeaseView,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    alerts::leases::{self, LeaseError},
    auth::UserEmail,
};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LeaseListQuery {
    /// `active`, `ended`, `kept`, `superseded` or `removed`; all when absent.
    pub state: Option<LeaseState>,
}

/// ListOrgAlertLeases
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_leases",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListOrgAlertLeases",
    summary = "List the org's alert leases",
    description = "Temporary alerts and timed incident-creation changes, newest first (500 at most), only on alerts the caller can see. `state` narrows the list.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        LeaseListQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<LeaseView>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List temporary alerts and timed incident-creation changes", "category": "alerts"}))
    )
)]
pub async fn list_org_alert_leases(
    Path(org_id): Path<String>,
    Query(query): Query<LeaseListQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id: Option<&str> = None;
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());
    // The same permission path the alert list uses, so no lease shows an alert the caller can't.
    let params = config::meta::alerts::alert::ListAlertsParams::new(&org_id);
    let client = infra::db::get_orm_client_ro().await;
    let visible: Vec<String> =
        match openobserve_core::alerts::alert::list_v2(client, user_id, params).await {
            Ok(list) => list
                .into_iter()
                .filter_map(|(_, a)| a.id.map(|id| id.to_string()))
                .collect(),
            Err(e) => return e.into(),
        };
    match leases::list_for_alerts(&org_id, &visible, query.state).await {
        Ok(leases) => MetaHttpResponse::json::<Vec<LeaseView>>(leases),
        Err(e) => error_response(e),
    }
}

/// ListAlertLeases
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/leases",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertLeases",
    summary = "List one alert's leases",
    description = "The alert's temporary-alert lease and timed incident-creation changes, newest first. `version` is the alert version each lease's write left.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        LeaseListQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<LeaseView>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List an alert's temporary changes", "category": "alerts"}))
    )
)]
pub async fn list_alert_leases(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<LeaseListQuery>,
) -> Response {
    match leases::list(&org_id, Some(&alert_id), query.state).await {
        Ok(leases) => MetaHttpResponse::json(leases),
        Err(e) => error_response(e),
    }
}

/// SetAlertCreatesIncident
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/creates_incident",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SetAlertCreatesIncident",
    summary = "Turn incident creation on or off, optionally for a window",
    description = "Changes only the alert's `creates_incident`. With `until_us` (at most 7 days ahead) and a `reason`, the prior value returns at `until_us`, unless someone edits the alert first, in which case their edit stays. `expected_version` is the alert version the caller saw; any other stored version answers 409 `version_changed`, as does an edit landing during the call.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
    ),
    request_body(content = CreatesIncidentRequest, description = "The value, and the window if timed", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CreatesIncidentResponse),
        (status = 400, description = "Invalid window or reason", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The alert changed, a timed change is already active or still being applied, or a multi-region deployment", content_type = "application/json", body = LeaseConflict),
        (status = 503, description = "The change could not be finished and will be undone; try again", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Turn an alert's incident creation on or off, optionally for a window", "category": "alerts"}))
    )
)]
pub async fn set_alert_creates_incident(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<CreatesIncidentRequest>,
) -> Response {
    if let Err(resp) = guard_siem(&org_id, &user_email.user_id, &alert_id).await {
        return resp;
    }
    match leases::set_creates_incident(&org_id, &alert_id, &req, &user_email.user_id).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => error_response(e),
    }
}

/// EndAlertLease
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/leases/{lease_id}/end",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EndAlertLease",
    summary = "End a lease now",
    description = "Does now what the lease's end would do: a temporary alert is disabled (and deleted 7 days later unless kept); a timed incident-creation change returns to its prior value. An alert edited since the lease began is left as it is.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("lease_id" = String, Path, description = "Lease ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = LeaseView),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The lease is not active", content_type = "application/json", body = LeaseConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "End a temporary alert or a timed incident-creation change now", "category": "alerts"}))
    )
)]
pub async fn end_alert_lease(
    Path((org_id, alert_id, lease_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(resp) = guard_siem(&org_id, &user_email.user_id, &alert_id).await {
        return resp;
    }
    match leases::end_now(&org_id, &alert_id, &lease_id).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => error_response(e),
    }
}

/// ExtendAlertLease
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/leases/{lease_id}/extend",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExtendAlertLease",
    summary = "Move a lease's end",
    description = "Sets a new end for an active lease, at most 7 days from now.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("lease_id" = String, Path, description = "Lease ID"),
    ),
    request_body(content = LeaseExtendRequest, description = "The new end", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = LeaseView),
        (status = 400, description = "Invalid end", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The lease is not active", content_type = "application/json", body = LeaseConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move the end of a temporary alert or timed incident-creation change", "category": "alerts"}))
    )
)]
pub async fn extend_alert_lease(
    Path((org_id, alert_id, lease_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<LeaseExtendRequest>,
) -> Response {
    if let Err(resp) = guard_siem(&org_id, &user_email.user_id, &alert_id).await {
        return resp;
    }
    match leases::extend(&org_id, &alert_id, &lease_id, req.ends_at_us).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => error_response(e),
    }
}

/// KeepAlertLease
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/leases/{lease_id}/keep",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "KeepAlertLease",
    summary = "Keep a temporary alert",
    description = "Makes an active temporary alert an ordinary alert: it is no longer disabled or deleted when the lease would have ended.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("lease_id" = String, Path, description = "Lease ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = LeaseView),
        (status = 400, description = "Not a temporary alert", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The lease is not active", content_type = "application/json", body = LeaseConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Keep a temporary alert as an ordinary alert", "category": "alerts"}))
    )
)]
pub async fn keep_alert_lease(
    Path((org_id, alert_id, lease_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(resp) = guard_siem(&org_id, &user_email.user_id, &alert_id).await {
        return resp;
    }
    match leases::keep(&org_id, &alert_id, &lease_id, &user_email.user_id).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => error_response(e),
    }
}

/// A SIEM detection needs the Security permission too, as for every other alert edit.
async fn guard_siem(_org_id: &str, _user_id: &str, _alert_id: &str) -> Result<(), Response> {
    #[cfg(feature = "enterprise")]
    {
        use crate::request::security;
        security::guard_siem(
            _org_id,
            _user_id,
            "POST",
            security::is_siem_alert(_org_id, _alert_id).await,
        )
        .await?;
    }
    Ok(())
}

pub fn error_response(e: LeaseError) -> Response {
    match e {
        LeaseError::NotFound(msg) => MetaHttpResponse::not_found(msg),
        LeaseError::BadRequest(msg) => MetaHttpResponse::bad_request(msg),
        LeaseError::Conflict(conflict) => (StatusCode::CONFLICT, Json(conflict)).into_response(),
        LeaseError::NotAnnounced(msg) => MetaHttpResponse::service_unavailable(msg),
        LeaseError::Alert(e) => e.into(),
        LeaseError::Infra(e) => MetaHttpResponse::internal_error(e),
    }
}

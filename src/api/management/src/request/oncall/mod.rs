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

//! On-call teams, schedules and escalation policies.

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
// Used only inside #[cfg(feature = "enterprise")] handler bodies.
#[cfg(feature = "enterprise")]
use axum::{http::StatusCode, response::IntoResponse};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::oncall::{PriorityRung, Rotation};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use serde::{Deserialize, Deserializer};

#[cfg(feature = "enterprise")]
use crate::service::auth::UserEmail;

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateTeamRequest {
    pub name: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_timezone() -> String {
    "UTC".to_string()
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateTeamRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    /// Absent leaves the description alone; explicit `null` clears it.
    ///
    /// Needs `double_option`: plain `#[serde(default)]` on `Option<Option<T>>`
    /// decodes an explicit `null` to the OUTER `None`, which is the same value
    /// as absent — making it impossible to clear a description.
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,
}

fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

/// Accepts one email or many. Setting a team up is mostly "add these six
/// people", and forcing the client to fan out one request per person is the
/// most tedious part of the flow.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddMembersRequest {
    #[serde(default)]
    pub user_email: Option<String>,
    #[serde(default)]
    pub user_emails: Vec<String>,
}

impl AddMembersRequest {
    // Only the enterprise arm calls this; the OSS arm returns Not Supported.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    fn emails(self) -> Vec<String> {
        let mut all = self.user_emails;
        if let Some(one) = self.user_email {
            all.push(one);
        }
        all
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetScheduleRequest {
    /// Absent means "the team's own zone". It used to default to UTC, so a
    /// client that omitted it silently shifted every restriction window on an
    /// Asia/Kolkata team by five and a half hours.
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub rotations: Vec<Rotation>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetPolicyRequest {
    pub rungs: Vec<PriorityRung>,
    /// Alert Destination names to page through. Absent leaves them unchanged.
    #[serde(default)]
    pub destinations: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ListResponsesQuery {
    pub team_id: Option<String>,
    /// Include closed records. Off by default: the home screen is what still
    /// needs somebody, and resolved pages would bury it within a day.
    #[serde(default)]
    pub include_resolved: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct OnCallQuery {
    /// Resolve at this instant (micros) instead of now, so the UI can show a
    /// future week without a second endpoint.
    pub at: Option<i64>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOwnershipRuleRequest {
    pub team_id: String,
    /// `{alias_id: value}` — the same vocabulary the service-identity config
    /// produces, e.g. `{"k8s-cluster": "prod"}`.
    pub dimensions: std::collections::HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ResolveRequest {
    /// Why it happened. Optional, but it is what makes the next firing of the
    /// same rule useful history rather than a list of dates.
    #[serde(default)]
    pub cause: Option<config::meta::oncall::ResolutionCause>,
    /// One sentence beside the structured cause.
    #[serde(default)]
    pub cause_note: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddNoteRequest {
    pub body: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SnoozeRequest {
    /// How long to stay quiet, in minutes.
    pub minutes: i64,
}

/// Exactly one of `to` (a person on this team) or `to_team_id` (ownership
/// moves to another team, and their on-call is paged under their rotation).
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct HandoffRequest {
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub to_team_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PreviewRoutingRequest {
    #[serde(default)]
    pub oncall_team: Option<String>,
    #[serde(default)]
    pub dimensions: std::collections::HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct OwnershipQuery {
    pub team_id: Option<String>,
}

/// Carried as a query param on the confirmation GET and as a form field on
/// the POST that actually acknowledges.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AckQuery {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoveMemberQuery {
    pub user_email: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Maps a service error onto a status code.
///
/// The distinction that matters: a validation failure or a missing team is
/// the caller's problem and must not read as a server fault, or every
/// mistyped timezone looks like an outage in the logs.
#[cfg(feature = "enterprise")]
fn to_response(e: anyhow::Error) -> Response {
    use o2_enterprise::enterprise::oncall::service::OncallError;
    let status = match e.downcast_ref::<OncallError>() {
        Some(OncallError::TeamNotFound(_)) => StatusCode::NOT_FOUND,
        Some(OncallError::NameTaken(_)) => StatusCode::CONFLICT,
        Some(OncallError::Invalid(_)) => StatusCode::BAD_REQUEST,
        None => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::INTERNAL_SERVER_ERROR {
        tracing::error!("[oncall] {e}");
    }
    MetaHttpResponse::error(status.as_u16(), e.to_string()).into_response()
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/teams",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "CreateOnCallTeam",
    summary = "Create an on-call team",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateTeamRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
        (status = 409, description = "Conflict", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_team(
    Path(org_id): Path<String>,
    Json(body): Json<CreateTeamRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::create_team(
            &org_id,
            &body.name,
            &body.timezone,
            body.description,
        )
        .await
        {
            Ok(team) => MetaHttpResponse::json(team),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallTeams",
    summary = "List on-call teams",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_teams(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::list_teams(&org_id).await {
            Ok(teams) => MetaHttpResponse::json(teams),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallTeam",
    summary = "Get an on-call team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_team(Path((org_id, team_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::get_team(&org_id, &team_id).await {
            Ok(team) => MetaHttpResponse::json(team),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/oncall/teams/{team_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "UpdateOnCallTeam",
    summary = "Update an on-call team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = UpdateTeamRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn update_team(
    Path((org_id, team_id)): Path<(String, String)>,
    Json(body): Json<UpdateTeamRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::update_team(
            &org_id,
            &team_id,
            body.name,
            body.timezone,
            body.description,
        )
        .await
        {
            Ok(team) => MetaHttpResponse::json(team),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/teams/{team_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallTeam",
    summary = "Delete an on-call team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn delete_team(Path((org_id, team_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::delete_team(&org_id, &team_id).await {
            Ok(()) => MetaHttpResponse::ok("Team deleted"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/members",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallTeamMembers",
    summary = "List a team's members",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_members(Path((org_id, team_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::list_members(&org_id, &team_id).await {
            Ok(members) => MetaHttpResponse::json(members),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/teams/{team_id}/members",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "AddOnCallTeamMember",
    summary = "Add a member to a team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = AddMembersRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn add_member(
    Path((org_id, team_id)): Path<(String, String)>,
    Json(body): Json<AddMembersRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let emails = body.emails();
        match o2_enterprise::enterprise::oncall::service::add_members(&org_id, &team_id, &emails)
            .await
        {
            Ok(members) => MetaHttpResponse::json(members),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/teams/{team_id}/members",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "RemoveOnCallTeamMember",
    summary = "Remove a member from a team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("user_email" = String, Query, description = "Member email"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn remove_member(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<RemoveMemberQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::remove_member(
            &org_id,
            &team_id,
            &q.user_email,
        )
        .await
        {
            Ok(true) => MetaHttpResponse::ok("Member removed"),
            Ok(false) => {
                MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), "Member not found")
                    .into_response()
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/schedule",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallSchedule",
    summary = "Get a team's schedule",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_schedule(Path((org_id, team_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::get_schedule(&org_id, &team_id).await {
            Ok(schedule) => MetaHttpResponse::json(schedule),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/oncall/teams/{team_id}/schedule",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SetOnCallSchedule",
    summary = "Replace a team's schedule",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = SetScheduleRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn set_schedule(
    Path((org_id, team_id)): Path<(String, String)>,
    Json(body): Json<SetScheduleRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::set_schedule(
            &org_id,
            &team_id,
            body.timezone.as_deref(),
            body.rotations,
        )
        .await
        {
            Ok(schedule) => MetaHttpResponse::json(schedule),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/on-call",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetWhoIsOnCall",
    summary = "Who is on call for a team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("at" = Option<i64>, Query, description = "Resolve at this instant (microseconds) instead of now"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn who_is_on_call(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<OnCallQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::who_is_on_call(&org_id, &team_id, q.at)
            .await
        {
            Ok(slots) => MetaHttpResponse::json(slots),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/policy",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallPolicy",
    summary = "Get a team's escalation policy",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_policy(Path((org_id, team_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::get_policy(&org_id, &team_id).await {
            Ok(policy) => MetaHttpResponse::json(policy),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/oncall/teams/{team_id}/policy",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SetOnCallPolicy",
    summary = "Replace a team's escalation policy",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = SetPolicyRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn set_policy(
    Path((org_id, team_id)): Path<(String, String)>,
    Json(body): Json<SetPolicyRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::set_policy(
            &org_id,
            &team_id,
            body.rungs,
            body.destinations,
        )
        .await
        {
            Ok(policy) => MetaHttpResponse::json(policy),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Renders the confirmation page an emailed acknowledgement link opens.
///
/// Deliberately plain HTML with no JavaScript: it is opened on a phone, at
/// night, from a mail client, and it must work there.
#[cfg(feature = "enterprise")]
fn ack_confirm_page(org_id: &str, token: &str, title: &str) -> Response {
    let esc = |v: &str| {
        v.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let body = format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acknowledge</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem">{title}</h1>
<p style="color:#555">Acknowledging tells the others you have this. The
escalation stops.</p>
<form method="post" action="/api/{org}/oncall/ack">
<input type="hidden" name="token" value="{token}">
<button type="submit" style="font-size:1rem;padding:0.75rem 1.5rem;border-radius:0.25rem;
border:0;background:#4f46e5;color:#fff">Acknowledge</button>
</form>
</body></html>"#,
        title = esc(title),
        org = esc(org_id),
        token = esc(token),
    );
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(axum::body::Body::from(body))
        .unwrap()
        .into_response()
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/ack",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "AcknowledgeOnCallPage",
    summary = "Acknowledge a page from its emailed link",
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 303, description = "Acknowledged, redirects to the page")),
)]
pub async fn acknowledge(
    Path(org_id): Path<String>,
    axum::Form(form): axum::Form<AckQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::{escalation, token};

        let claims = match token::verify(&form.token, config::utils::time::now_micros()).await {
            Ok(c) => c,
            Err(e) => {
                return MetaHttpResponse::error(StatusCode::UNAUTHORIZED.as_u16(), e.to_string())
                    .into_response();
            }
        };
        if claims.org_id != org_id {
            return MetaHttpResponse::error(
                StatusCode::UNAUTHORIZED.as_u16(),
                "acknowledgement link does not belong to this organization",
            )
            .into_response();
        }
        if let Err(e) =
            escalation::acknowledge(&claims.org_id, &claims.response_id, &claims.user_email).await
        {
            return to_response(e);
        }
        // Land on the record, not on JSON. Somebody who just acknowledged from
        // a phone at 3am needs the page, and the org has to be in the URL or
        // the app resolves whichever org they last had selected.
        let base = config::get_config().common.web_url.clone();
        let location = format!(
            "{base}/web/oncall/responses/{}?org_identifier={}",
            claims.response_id, claims.org_id
        );
        axum::response::Response::builder()
            .status(StatusCode::SEE_OTHER)
            .header(axum::http::header::LOCATION, location)
            .body(axum::body::Body::empty())
            .unwrap()
            .into_response()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, form);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/ack",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallAckConfirmPage",
    summary = "Confirmation page for an emailed acknowledgement link",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Query, description = "Signed acknowledgement token"),
    ),
    responses((status = 200, description = "Success", content_type = "text/html")),
)]
/// GET only LOOKS. It must not acknowledge.
///
/// This link is emailed, and mail gateways — Outlook Safe Links, Gmail's
/// scanner, any corporate filter — fetch URLs in messages to check them. A GET
/// that acknowledged meant a scanner could take the page before the human read
/// it: the ladder stops, the timeline records an acknowledgement nobody made,
/// and the incident sleeps. So the fetch renders a button, and the button
/// POSTs.
pub async fn ack_page(Path(org_id): Path<String>, Query(q): Query<AckQuery>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::token;

        let claims = match token::verify(&q.token, config::utils::time::now_micros()).await {
            Ok(c) => c,
            Err(e) => {
                return MetaHttpResponse::error(StatusCode::UNAUTHORIZED.as_u16(), e.to_string())
                    .into_response();
            }
        };
        // The org in the path must match the org the token was minted for, or
        // a link for one tenant would act on another.
        if claims.org_id != org_id {
            return MetaHttpResponse::error(
                StatusCode::UNAUTHORIZED.as_u16(),
                "acknowledgement link does not belong to this organization",
            )
            .into_response();
        }
        let title = infra::table::oncall_responses::get(&claims.org_id, &claims.response_id)
            .await
            .ok()
            .flatten()
            .and_then(|r| r.title)
            .unwrap_or_else(|| "Acknowledge this page?".to_string());
        ack_confirm_page(&claims.org_id, &q.token, &title)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallResponses",
    summary = "List open response records",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = Option<String>, Query, description = "Restrict to one team"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_responses(
    Path(org_id): Path<String>,
    Query(q): Query<ListResponsesQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match infra::table::oncall_responses::list_open(
            &org_id,
            q.team_id.as_deref(),
            q.include_resolved,
        )
        .await
        {
            Ok(rows) => MetaHttpResponse::json(rows),
            Err(e) => {
                tracing::error!("[oncall] list_responses: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses/{response_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallResponse",
    summary = "Get a response record and its timeline",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_response(Path((org_id, response_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let record = match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(Some(r)) => r,
            Ok(None) => {
                return MetaHttpResponse::error(
                    StatusCode::NOT_FOUND.as_u16(),
                    "Response not found",
                )
                .into_response();
            }
            Err(e) => {
                tracing::error!("[oncall] get_response: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        };
        match infra::table::oncall_responses::list_events(&response_id).await {
            Ok(events) => MetaHttpResponse::json(serde_json::json!({
                "response": record,
                "events": events,
            })),
            Err(e) => {
                tracing::error!("[oncall] get_response events: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/resolve",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ResolveOnCallResponse",
    summary = "Resolve a response record",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn resolve_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<Option<ResolveRequest>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let body = body.unwrap_or_default();
        match o2_enterprise::enterprise::oncall::escalation::resolve(
            &org_id,
            &response_id,
            &user_email.user_id,
            body.cause,
            body.cause_note.as_deref(),
        )
        .await
        {
            Ok(record) => MetaHttpResponse::json(record),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/notes",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "AddOnCallNote",
    summary = "Add a note to a response record",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = AddNoteRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn add_note(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<AddNoteRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::escalation::add_note(
            &org_id,
            &response_id,
            &user_email.user_id,
            &body.body,
        )
        .await
        {
            Ok(()) => MetaHttpResponse::ok("Note added"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/incidents/{incident_id}/responses",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallResponsesForIncident",
    summary = "The on-call records that paged for an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_responses_for_incident(
    Path((org_id, incident_id)): Path<(String, String)>,
) -> Response {
    // Lets an incident show who it woke without duplicating any of the paging
    // machinery: the record already exists, it was simply unreachable.
    #[cfg(feature = "enterprise")]
    {
        match infra::table::oncall_responses::list_for_incident(&org_id, &incident_id).await {
            Ok(rows) => MetaHttpResponse::json(rows),
            Err(e) => to_response(e.into()),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, incident_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses/{response_id}/escalation",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallEscalationProgress",
    summary = "Where the escalation ladder has got to",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_escalation_progress(
    Path((org_id, response_id)): Path<(String, String)>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::escalation::progress(&org_id, &response_id).await {
            Ok(p) => MetaHttpResponse::json(p),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses/{response_id}/prior-causes",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallPriorCauses",
    summary = "What previous firings of this subject turned out to be",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_prior_causes(
    Path((org_id, response_id)): Path<(String, String)>,
) -> Response {
    // Grouped, not a list of dates. "3x config change / deploy" is the thing
    // worth reading mid-page; the individual firings are not.
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::escalation::prior_causes(&org_id, &response_id)
            .await
        {
            Ok(groups) => MetaHttpResponse::json(groups),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/acknowledge",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "AcknowledgeOnCallResponse",
    summary = "Acknowledge a response record",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn acknowledge_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    // The emailed link carries a signed token because the reader may not have
    // a session. In-product there already is one, so the logged-in user is the
    // acknowledger and no token is involved.
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::escalation::acknowledge(
            &org_id,
            &response_id,
            &user_email.user_id,
        )
        .await
        {
            Ok(r) => MetaHttpResponse::json(r),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/snooze",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SnoozeOnCallResponse",
    summary = "Quiet a response record without claiming it",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = SnoozeRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn snooze_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SnoozeRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::escalation::snooze(
            &org_id,
            &response_id,
            &user_email.user_id,
            body.minutes,
            config::utils::time::now_micros(),
        )
        .await
        {
            Ok(Some(r)) => MetaHttpResponse::json(r),
            Ok(None) => MetaHttpResponse::not_found("Response record not found"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/handoff",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "HandoffOnCallResponse",
    summary = "Hand a page to somebody else",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = HandoffRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn handoff_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<HandoffRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::escalation;

        let result = match (body.to_team_id.as_deref(), body.to.as_deref()) {
            (Some(team), _) => {
                escalation::handoff_to_team(
                    &org_id,
                    &response_id,
                    &user_email.user_id,
                    team,
                    body.note.as_deref(),
                )
                .await
            }
            (None, Some(person)) => {
                escalation::handoff(
                    &org_id,
                    &response_id,
                    &user_email.user_id,
                    person,
                    body.note.as_deref(),
                )
                .await
            }
            (None, None) => {
                return MetaHttpResponse::error(
                    StatusCode::BAD_REQUEST.as_u16(),
                    "a handoff needs either `to` (a person) or `to_team_id` (another team)",
                )
                .into_response();
            }
        };
        match result {
            Ok(record) => MetaHttpResponse::json(record),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Past firings of the same source — "this fired before, and here is what it
/// was". The causes recorded at resolve are the point of it.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses/{response_id}/history",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallResponseHistory",
    summary = "Past firings of the same alert",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
        ("limit" = Option<u64>, Query, description = "Max records (default 10)"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_response_history(
    Path((org_id, response_id)): Path<(String, String)>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let Ok(Some(current)) = infra::table::oncall_responses::get(&org_id, &response_id).await
        else {
            return MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), "Response not found")
                .into_response();
        };
        let limit = q.limit.unwrap_or(10).clamp(1, 100);
        match infra::table::oncall_responses::history_for_source(
            &org_id,
            current.subject.subject_type,
            &current.subject.source_id,
            limit,
        )
        .await
        {
            // The current firing is not its own history.
            Ok(rows) => MetaHttpResponse::json(
                rows.into_iter()
                    .filter(|r| r.id != response_id)
                    .collect::<Vec<_>>(),
            ),
            Err(e) => {
                tracing::error!("[oncall] history: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/ownership",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallOwnershipRules",
    summary = "List ownership rules",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = Option<String>, Query, description = "Restrict to one team"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_ownership_rules(
    Path(org_id): Path<String>,
    Query(q): Query<OwnershipQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::routing;
        let result = match q.team_id.as_deref() {
            Some(team_id) => routing::list_rules_for_team(&org_id, team_id).await,
            None => routing::list_rules(&org_id).await,
        };
        match result {
            Ok(rules) => MetaHttpResponse::json(rules),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/ownership",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "CreateOnCallOwnershipRule",
    summary = "Give a team ownership of an identity-dimension path",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateOwnershipRuleRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
        (status = 409, description = "Conflict", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_ownership_rule(
    Path(org_id): Path<String>,
    Json(body): Json<CreateOwnershipRuleRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::routing::create_rule(
            &org_id,
            &body.team_id,
            body.dimensions,
        )
        .await
        {
            Ok(rule) => MetaHttpResponse::json(rule),
            Err(e) => {
                // The unique index on (org_id, path) is what refuses a second
                // team claiming the same path; surface it as a conflict rather
                // than a server fault.
                if e.to_string().to_lowercase().contains("unique")
                    || e.to_string().to_lowercase().contains("duplicate")
                {
                    return MetaHttpResponse::error(
                        StatusCode::CONFLICT.as_u16(),
                        "another team already owns this path",
                    )
                    .into_response();
                }
                to_response(e)
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/ownership/{rule_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallOwnershipRule",
    summary = "Delete an ownership rule",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("rule_id" = String, Path, description = "Rule ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn delete_ownership_rule(Path((org_id, rule_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::routing::delete_rule(&org_id, &rule_id).await {
            Ok(true) => MetaHttpResponse::ok("Rule deleted"),
            Ok(false) => MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), "Rule not found")
                .into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, rule_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Answer "where would this route?" without waiting for an alert to fire.
///
/// Ownership is longest-prefix over a set of rules, which is easy to get wrong
/// by hand once a few overlap. Returning the decision AND its reason turns
/// debugging a mis-route from guesswork into a lookup.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/routing/preview",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "PreviewOnCallRouting",
    summary = "Show which team a set of dimensions would page",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = PreviewRoutingRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn preview_routing(
    Path(org_id): Path<String>,
    Json(body): Json<PreviewRoutingRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::routing::decide(
            &org_id,
            body.oncall_team.as_deref(),
            &body.dimensions,
        )
        .await
        {
            Ok(decision) => MetaHttpResponse::json(serde_json::json!({
                "decision": decision,
                "team_id": decision.team_id(),
                "reason": decision.reason(),
            })),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_team_defaults_to_utc() {
        let r: CreateTeamRequest = serde_json::from_str(r#"{"name":"Platform"}"#).unwrap();
        assert_eq!(r.timezone, "UTC");
        assert_eq!(r.description, None);
    }

    /// An absent description leaves it alone; an explicit null clears it.
    /// Collapsing the two would make it impossible to remove one.
    #[test]
    fn test_update_distinguishes_absent_from_null_description() {
        let absent: UpdateTeamRequest = serde_json::from_str(r#"{"name":"P"}"#).unwrap();
        assert_eq!(absent.description, None);

        let cleared: UpdateTeamRequest = serde_json::from_str(r#"{"description":null}"#).unwrap();
        assert_eq!(cleared.description, Some(None));

        let set: UpdateTeamRequest = serde_json::from_str(r#"{"description":"owns db"}"#).unwrap();
        assert_eq!(set.description, Some(Some("owns db".to_string())));
    }

    /// One email or many, so a bulk add is one request and a single add still
    /// works with the obvious payload.
    #[test]
    fn test_add_members_accepts_one_or_many() {
        let single: AddMembersRequest =
            serde_json::from_str(r#"{"user_email":"ana@o2.ai"}"#).unwrap();
        assert_eq!(single.emails(), vec!["ana@o2.ai".to_string()]);

        let many: AddMembersRequest =
            serde_json::from_str(r#"{"user_emails":["ana@o2.ai","bob@o2.ai"]}"#).unwrap();
        assert_eq!(
            many.emails(),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()]
        );

        let both: AddMembersRequest =
            serde_json::from_str(r#"{"user_email":"c@o2.ai","user_emails":["a@o2.ai"]}"#).unwrap();
        assert_eq!(both.emails().len(), 2);
    }

    #[test]
    fn test_schedule_body_accepts_an_empty_rotation_list() {
        let r: SetScheduleRequest = serde_json::from_str(r#"{"timezone":"UTC"}"#).unwrap();
        assert!(r.rotations.is_empty());
    }

    #[test]
    fn test_on_call_query_at_is_optional() {
        let none: OnCallQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(none.at, None);
        let some: OnCallQuery = serde_json::from_str(r#"{"at":1700000000000000}"#).unwrap();
        assert_eq!(some.at, Some(1_700_000_000_000_000));
    }
}

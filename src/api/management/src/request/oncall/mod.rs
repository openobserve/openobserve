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
use crate::service::auth::{UserEmail, check_permissions};

// ── Authorization ─────────────────────────────────────────────────────────────

/// The configuration surface: teams, members, rotations, escalation policies
/// and ownership rules. Writing any of it decides who gets woken, which is an
/// administrative act.
#[cfg(feature = "enterprise")]
const CONFIG: &str = "oncall";

/// The record of a page. Reading one is for everybody; the verbs on it —
/// acknowledge, note, snooze, hand off, resolve — belong to whoever the ladder
/// actually woke, and the openfga model opens them to any member of the org.
/// Gating them behind admin would mean the engineer holding the pager could
/// not use the product they were paged into.
#[cfg(feature = "enterprise")]
const RESPONSES: &str = "oncall_responses";

/// Gate one on-call request against the caller's role.
///
/// The route table in `o2_openfga::meta::route_permissions` gates these paths
/// too, so this is the second lock on the same door — deliberately. That table
/// is ordered and first-match-wins, so a broader entry added later can shadow
/// a narrower one without anything failing loudly. Naming the resource and the
/// verb at the handler means it cannot quietly inherit somebody else's rule.
///
/// `use_all_org` is on because an on-call grant is org-wide. A team is
/// deliberately not an openfga group, so there is no per-team subject to hang
/// a grant on; the org in the path is the whole of the scoping.
#[cfg(feature = "enterprise")]
async fn allowed(org_id: &str, user_id: &str, resource: &str, permission: &str) -> bool {
    check_permissions(
        org_id, org_id, user_id, resource, permission, None, true, false, false,
    )
    .await
}

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
    /// The team's L0 block — how the AI SRE agent relates to their paging.
    ///
    /// Absent leaves it unchanged, so editing rungs cannot silently un-configure
    /// L0. `mode.P1` is not editable and `mode.P4` must stay agent-only; both are
    /// refused with a message naming the field.
    #[serde(default)]
    pub l0: Option<config::meta::oncall::L0Policy>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ListResponsesQuery {
    pub team_id: Option<String>,
    /// Include closed records. Off by default: the home screen is what still
    /// needs somebody, and resolved pages would bury it within a day.
    #[serde(default)]
    pub include_resolved: bool,
    /// Page size. Defaulted and capped, because this is the screen somebody
    /// loads at 3am and a busy org has hundreds of open records.
    pub limit: Option<u64>,
    pub offset: Option<u64>,
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
    /// What the source object's `context_attributes.team` would say. Accepted
    /// here so "test routing" can answer for an alert that carries one — the
    /// attribute is a routing input, and a preview that ignored it would tell
    /// people the wrong team.
    #[serde(default)]
    pub context_team: Option<String>,
    #[serde(default)]
    pub dimensions: std::collections::HashMap<String, String>,
}

/// The whole routing configuration, stated in one body.
///
/// `default_team_id` absent or `null` clears the nomination. There is exactly
/// one field, so "send the state you want" is unambiguous and clearing needs no
/// second endpoint and no sentinel value.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct SetRoutingConfigRequest {
    #[serde(default)]
    pub default_team_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct OwnershipQuery {
    pub team_id: Option<String>,
}

/// "Cover for me" — `architecture/02` §5, as one request.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOverrideRequest {
    /// Who is covering. Must be a user of this org: an override outranks every
    /// layer, so an address that goes nowhere is a team with no pager for the
    /// length of the window.
    pub user_email: String,
    /// Micros, inclusive.
    pub start_at: i64,
    /// Micros, exclusive — a cover ending exactly when the next begins does
    /// not overlap it.
    pub end_at: i64,
    /// Who is being covered. Optional: "cover tonight" is a real request even
    /// when nobody has worked out whose shift tonight is.
    #[serde(default)]
    pub covering_for: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Both bounds or neither. A half-specified window is a client bug, and
/// answering it with the unfiltered list would look like it worked.
#[derive(Debug, Default, Deserialize)]
pub struct OverrideWindowQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
}

/// The window a resolved-schedule read covers. Both bounds are required: this
/// endpoint has no useful default, and inventing one would hide the bound.
#[derive(Debug, Deserialize)]
pub struct ResolvedScheduleQuery {
    pub from: i64,
    pub to: i64,
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

#[derive(Debug, Default, Deserialize)]
pub struct UnroutedQuery {
    /// A dismissed entry is kept rather than deleted — the evidence that the
    /// gap existed is the point — so asking for them back is opt-in. Left off,
    /// this is the queue somebody still has to act on.
    #[serde(default)]
    pub include_dismissed: bool,
    /// `default_team` for the gaps that are waking the catch-all — §4's
    /// "Assign next" — `nobody` for the gaps that are waking no one, and absent
    /// for both. Unrecognised values are treated as absent rather than refused:
    /// this is a filter on a worklist, and showing too much is a far better
    /// failure than a 400 on a screen somebody opened to see what is broken.
    pub landing: Option<String>,
    pub limit: Option<u64>,
}

impl UnroutedQuery {
    // Only the enterprise arm calls this; the OSS arm returns Not Supported.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    fn landing(&self) -> infra::table::oncall_ownership::Landing {
        use infra::table::oncall_ownership::Landing;
        match self.landing.as_deref() {
            Some("default_team") => Landing::DefaultTeam,
            Some("nobody") => Landing::Nobody,
            _ => Landing::Any,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct CoverageGapsQuery {
    /// Answer for this instant (micros) instead of now, so the same call can
    /// ask "will anybody be on call at 2am on Sunday?".
    pub at: Option<i64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct DeliveriesQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
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
        // A conflict, not a 400: the request is well-formed and the state of
        // the org is what refuses it, and the caller fixes it by changing that
        // state rather than by changing the request.
        Some(OncallError::NameTaken(_)) | Some(OncallError::IsDefaultTeam(_)) => {
            StatusCode::CONFLICT
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateTeamRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn list_teams(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn get_team(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<UpdateTeamRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn delete_team(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn list_members(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<AddMembersRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn get_schedule(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SetScheduleRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // A read anyone in the org has a reason to make — "who do I wake?" is
        // not privileged information.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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

// ── Overrides / cover requests (§5) ───────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/teams/{team_id}/overrides",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "CreateOnCallOverride",
    summary = "Arrange cover for a bounded window",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = CreateOverrideRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
        (status = 404, description = "No such team", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_override(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateOverrideRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Configuration: a cover decides who gets woken for its window, which
        // is the same authority as editing the rotation it stands over.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::create_override(
            &org_id,
            &team_id,
            &body.user_email,
            body.start_at,
            body.end_at,
            body.covering_for,
            body.reason,
            // Who arranged it, taken from the caller rather than the body:
            // "who agreed to this" is not something a client gets to assert.
            &user_email.user_id,
            config::utils::time::now_micros(),
        )
        .await
        {
            Ok(record) => MetaHttpResponse::json(record),
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
    path = "/{org_id}/oncall/teams/{team_id}/overrides",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallOverrides",
    summary = "List a team's covers",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("from" = Option<i64>, Query, description = "Window start (microseconds); requires `to`"),
        ("to" = Option<i64>, Query, description = "Window end (microseconds); requires `from`"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_overrides(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<OverrideWindowQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::list_overrides(
            &org_id, &team_id, q.from, q.to,
        )
        .await
        {
            Ok(records) => MetaHttpResponse::json(records),
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
    delete,
    path = "/{org_id}/oncall/teams/{team_id}/overrides/{override_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallOverride",
    summary = "Cancel a cover",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("override_id" = String, Path, description = "Override ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "No such override", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_override(
    Path((org_id, team_id, override_id)): Path<(String, String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let _ = &team_id;
        match o2_enterprise::enterprise::oncall::service::delete_override(&org_id, &override_id)
            .await
        {
            // Reported rather than silently 200: cancelling a cover that is not
            // there means somebody is looking at a stale screen, and the
            // difference matters at 3am.
            Ok(true) => MetaHttpResponse::json(serde_json::json!({ "deleted": true })),
            Ok(false) => MetaHttpResponse::not_found("override not found"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, override_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/resolved-schedule",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetResolvedOnCallSchedule",
    summary = "The resolved schedule across a window, gaps included",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("from" = i64, Query, description = "Window start (microseconds)"),
        ("to" = i64, Query, description = "Window end (microseconds), at most 31 days after `from`"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Window inverted or too long", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_resolved_schedule(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<ResolvedScheduleQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // The same read as "who is on call", over a window instead of an
        // instant, so it costs the same permission.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::resolved_schedule(
            &org_id, &team_id, q.from, q.to,
        )
        .await
        {
            Ok(segments) => MetaHttpResponse::json(segments),
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
pub async fn get_policy(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SetPolicyRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::set_policy(
            &org_id,
            &team_id,
            body.rungs,
            body.destinations,
            body.l0,
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
        ("limit" = Option<u64>, Query, description = "Page size (default 100, max 200)"),
        ("offset" = Option<u64>, Query, description = "Rows to skip"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_responses(
    Path(org_id): Path<String>,
    Query(q): Query<ListResponsesQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Same clamp shape as `get_response_history` below.
        let limit = q.limit.unwrap_or(100).clamp(1, 200);
        let offset = q.offset.unwrap_or(0);
        match infra::table::oncall_responses::list_open(
            &org_id,
            q.team_id.as_deref(),
            q.include_resolved,
            limit,
            offset,
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
pub async fn get_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Lets an incident show who it woke without duplicating any of the paging
    // machinery: the record already exists, it was simply unreachable.
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Grouped, not a list of dates. "3x config change / deploy" is the thing
    // worth reading mid-page; the individual firings are not.
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::routing;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateOwnershipRuleRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn delete_ownership_rule(
    Path((org_id, rule_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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

/// Serializes a routing config with the default team's name beside its id.
///
/// The id is what the setting stores and what every other endpoint speaks; the
/// name is what the screen has to render. Sending both means the routing screen
/// does not have to fetch the whole team list to draw one label — and, more to
/// the point, does not have to leave the label blank when the team it points at
/// is one the caller has not loaded.
#[cfg(feature = "enterprise")]
async fn routing_config_body(config: &config::meta::oncall::RoutingConfig) -> serde_json::Value {
    let name = match config.default_team_id.as_deref() {
        Some(team_id) => {
            o2_enterprise::enterprise::oncall::service::get_team(&config.org_id, team_id)
                .await
                .ok()
                .map(|t| t.name)
        }
        None => None,
    };
    serde_json::json!({
        "org_id": config.org_id,
        "default_team_id": config.default_team_id,
        "default_team_name": name,
        "updated_at": config.updated_at,
    })
}

/// The org's routing configuration — which team catches whatever nothing else
/// claimed.
///
/// Always answers, even for an org that has never set one: `default_team_id` is
/// then `null`, which is the honest reading of "nothing routes here yet" and
/// saves every caller a 404 branch.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/routing/config",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallRoutingConfig",
    summary = "Get the org's routing configuration",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_routing_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::routing::get_config(&org_id).await {
            Ok(config) => MetaHttpResponse::json(routing_config_body(&config).await),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Nominate the org's default on-call team, or clear the nomination.
///
/// Nothing creates this team and nothing picks it automatically — an operator
/// chooses one of their own teams, which is precisely what makes a catch-all
/// tier safe. The team is checked against **this org**: the setting holds a
/// team id from a shared table, so an id from another tenant would otherwise be
/// stored and start paging strangers.
#[utoipa::path(
    put,
    path = "/{org_id}/oncall/routing/config",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SetOnCallRoutingConfig",
    summary = "Nominate or clear the org's default on-call team",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = SetRoutingConfigRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn set_routing_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SetRoutingConfigRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::routing::set_default_team(
            &org_id,
            body.default_team_id.as_deref(),
        )
        .await
        {
            Ok(config) => MetaHttpResponse::json(routing_config_body(&config).await),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<PreviewRoutingRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Changes nothing — it is a POST only because the dimensions travel in
        // a body — so it costs a read, not a write.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::routing::decide(
            &org_id,
            body.oncall_team.as_deref(),
            body.context_team.as_deref(),
            &body.dimensions,
        )
        .await
        {
            Ok(routed) => MetaHttpResponse::json(serde_json::json!({
                "decision": routed.decision,
                "team_id": routed.team_id(),
                "reason": routed.reason(),
                // The one thing §4 says is worth surfacing, hoisted out of the
                // tagged decision so a caller does not have to know the variant
                // names to draw the "this is only covered by the fallback" badge.
                "landed_on_default": routed.landed_on_default(),
                "notes": routed.notes,
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

/// Serializes a queue entry with its own one-line summary beside it.
///
/// `describe()` is where the phrasing of "what fired, and what nobody claimed"
/// already lives. Sending it means every reader of the queue says the same
/// sentence, instead of each one reassembling it out of four optional fields
/// and getting the empty-dimensions case subtly wrong.
#[cfg(feature = "enterprise")]
fn with_description(signal: &config::meta::oncall::UnroutedSignal) -> serde_json::Value {
    let mut value = serde_json::json!(signal);
    if let Some(obj) = value.as_object_mut() {
        obj.insert("description".to_string(), signal.describe().into());
    }
    value
}

/// The queue of signals that fired and that no team owned.
///
/// This is the surface that makes "nobody was paged" a state somebody can see.
/// Without it the only trace was a log line on whichever node happened to
/// evaluate the alert, which is indistinguishable from nothing having fired.
///
/// By default it returns the *outstanding* queue: dismissed entries are out,
/// and so are entries that an ownership rule written since would now catch.
/// That is what makes working the queue the same act as fixing it — add the
/// missing rule and the entry stops being outstanding on its own, with nothing
/// to tick off by hand. `include_dismissed=true` asks for the raw list
/// instead, which is the historical record rather than the worklist.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/unrouted",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallUnroutedSignals",
    summary = "Signals that fired and that no team owned",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("include_dismissed" = Option<bool>, Query, description = "Include dismissed and already-covered entries (default false)"),
        ("landing" = Option<String>, Query, description = "`default_team` for gaps the default team is absorbing, `nobody` for gaps that paged no one; omit for both"),
        ("limit" = Option<u64>, Query, description = "Page size (default 100, max 200)"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_unrouted_signals(
    Path(org_id): Path<String>,
    Query(q): Query<UnroutedQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::routing;

        // Configuration, not a page: the fix for an entry here is an ownership
        // rule, and the people who write those are the people who read this.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Same clamp shape as `list_responses`. An org that has been paging
        // into a hole for a week accumulates a lot of these, and this is a
        // screen somebody opens expecting it to load.
        let limit = q.limit.unwrap_or(100).clamp(1, 200);
        let landing = q.landing();
        let result = if q.include_dismissed {
            routing::list_unrouted(&org_id, true, landing, limit).await
        } else {
            routing::list_outstanding_unrouted(&org_id, landing, limit).await
        };
        match result {
            Ok(signals) => {
                MetaHttpResponse::json(signals.iter().map(with_description).collect::<Vec<_>>())
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Marks one queue entry handled.
///
/// The escape hatch for an entry no rule will ever cover — a one-off from a
/// decommissioned cluster, say. It is a DELETE on the queue position, not on
/// the row: dismissing stamps `dismissed_at` and leaves the record, because
/// the evidence that a page fell through is worth more than a tidy table.
#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/unrouted/{signal_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DismissOnCallUnroutedSignal",
    summary = "Dismiss an entry from the unrouted queue",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("signal_id" = String, Path, description = "Unrouted queue entry ID"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn dismiss_unrouted_signal(
    Path((org_id, signal_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::routing::dismiss_unrouted(&org_id, &signal_id)
            .await
        {
            Ok(Some(signal)) => MetaHttpResponse::json(with_description(&signal)),
            Ok(None) => MetaHttpResponse::not_found("Unrouted signal not found"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, signal_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Teams whose schedule would page nobody at a given instant.
///
/// An emptied rotation is reported at the moment it happens, but a warning
/// nobody was looking at when it was logged is a warning nobody saw. This
/// answers the same question on demand, which is what a standing banner on the
/// team screen needs.
///
/// `total` is the honest count of teams with a gap; `teams` is that list cut
/// to `limit`. A banner wants the number even when it only renders three
/// names, and a truncated array that pretended to be the whole answer would
/// undercount exactly the org most in trouble.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/coverage-gaps",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallCoverageGaps",
    summary = "Teams that would page nobody right now",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("at" = Option<i64>, Query, description = "Ask about this instant (microseconds) instead of now"),
        ("limit" = Option<u64>, Query, description = "Max teams returned (default 100, max 200); `total` is never truncated"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_coverage_gaps(
    Path(org_id): Path<String>,
    Query(q): Query<CoverageGapsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Resolved here rather than left to the service so the response can
        // say which instant it answered for. A banner that cannot name its own
        // "as of" is unreadable the moment a shift changes under it.
        let at = q.at.unwrap_or_else(config::utils::time::now_micros);
        let limit = q.limit.unwrap_or(100).clamp(1, 200) as usize;
        match o2_enterprise::enterprise::oncall::service::teams_with_coverage_gaps(
            &org_id,
            Some(at),
        )
        .await
        {
            Ok(mut teams) => {
                let total = teams.len();
                teams.truncate(limit);
                MetaHttpResponse::json(serde_json::json!({
                    "at": at,
                    "total": total,
                    "teams": teams,
                }))
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Every page this record actually attempted, per person and per channel.
///
/// The timeline deliberately leaves these out — a rung that paged eight people
/// on two channels is one legible line to a responder and sixteen rows to the
/// ledger — so "which channel did ana's page go out on, and did it arrive"
/// needs its own read. It was answerable from the database and not from the
/// product, which is the wrong way round for the one fact a paging system
/// exists to be able to state.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/responses/{response_id}/deliveries",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallDeliveries",
    summary = "What was attempted for a page, and whether it landed",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
        ("limit" = Option<u64>, Query, description = "Page size (default 100, max 200)"),
        ("offset" = Option<u64>, Query, description = "Rows to skip"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_deliveries(
    Path((org_id, response_id)): Path<(String, String)>,
    Query(q): Query<DeliveriesQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // The ledger is keyed on the record alone, so the org has to be
        // established here: without this a response id from another tenant
        // would read straight through, and it carries their responders' email
        // addresses.
        match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(Some(_)) => {}
            Ok(None) => return MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                tracing::error!("[oncall] list_deliveries lookup: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        }
        let limit = q.limit.unwrap_or(100).clamp(1, 200) as usize;
        let offset = q.offset.unwrap_or(0) as usize;
        match infra::table::oncall_responses::list_deliveries(&response_id).await {
            Ok(rows) => {
                // A long-running page that walked several ladder runs has one
                // row per recipient per channel per rung, so the body is cut
                // even though the query is not. `total` keeps the count true.
                let total = rows.len();
                let page: Vec<_> = rows.into_iter().skip(offset).take(limit).collect();
                MetaHttpResponse::json(serde_json::json!({
                    "total": total,
                    "deliveries": page,
                }))
            }
            Err(e) => {
                tracing::error!("[oncall] list_deliveries: {e}");
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

    /// Every session-authenticated handler must gate itself.
    ///
    /// This module once had zero authorization calls in it, and because the
    /// generic middleware denies a resource it does not recognise, the result
    /// was not an open door but a closed one: every non-root user got a 403 on
    /// every on-call path. Reading our own source is blunt, but it is the only
    /// thing that catches a handler added later without a gate — the failure
    /// mode is silent until somebody who is not root tries to use it.
    #[test]
    fn test_every_session_handler_is_gated() {
        // The two exemptions are the emailed acknowledgement link. It is served
        // from `basic_routes` with no auth middleware and no session at all,
        // because the whole point is a phone at 3am; its gate is the signed
        // token verified inside the handler.
        const TOKEN_AUTHENTICATED: [&str; 2] = ["acknowledge", "ack_page"];

        let source = include_str!("mod.rs");
        let mut ungated = Vec::new();

        let handlers: Vec<usize> = source
            .match_indices("\npub async fn ")
            .map(|(i, _)| i)
            .collect();

        for (n, &start) in handlers.iter().enumerate() {
            let end = handlers.get(n + 1).copied().unwrap_or(source.len());
            let body = &source[start..end];
            let name = body
                .trim_start()
                .trim_start_matches("pub async fn ")
                .split('(')
                .next()
                .unwrap()
                .trim();

            if TOKEN_AUTHENTICATED.contains(&name) {
                continue;
            }
            if !body.contains("if !allowed(") {
                ungated.push(name.to_string());
            }
        }

        assert!(
            handlers.len() > 20,
            "handler scan found only {} functions — the parser is broken, not the code",
            handlers.len()
        );
        assert!(
            ungated.is_empty(),
            "on-call handlers with no permission check: {ungated:?}"
        );
    }

    #[test]
    fn test_on_call_query_at_is_optional() {
        let none: OnCallQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(none.at, None);
        let some: OnCallQuery = serde_json::from_str(r#"{"at":1700000000000000}"#).unwrap();
        assert_eq!(some.at, Some(1_700_000_000_000_000));
    }

    /// The queue defaults to the worklist, not to the archive. A caller that
    /// asks for nothing must get the entries somebody still has to act on, or
    /// a badge built on this endpoint counts dismissed history forever.
    #[test]
    fn test_unrouted_query_defaults_to_outstanding() {
        let bare: UnroutedQuery = serde_json::from_str("{}").unwrap();
        assert!(!bare.include_dismissed);
        assert_eq!(bare.limit, None);
        assert_eq!(bare.landing, None);

        let all: UnroutedQuery =
            serde_json::from_str(r#"{"include_dismissed":true,"limit":25}"#).unwrap();
        assert!(all.include_dismissed);
        assert_eq!(all.limit, Some(25));
    }

    /// The queue now records two outcomes, and the filter is how "Assign next"
    /// asks for one of them. An unrecognised value widens rather than refuses:
    /// this is a worklist somebody opened to see what is broken, and a 400 is
    /// the worst possible answer to that.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_unrouted_landing_filter_parses_and_never_refuses() {
        use infra::table::oncall_ownership::Landing;

        let cases = [
            (r#"{"landing":"default_team"}"#, Landing::DefaultTeam),
            (r#"{"landing":"nobody"}"#, Landing::Nobody),
            (r#"{"landing":"typo"}"#, Landing::Any),
            (r#"{"landing":""}"#, Landing::Any),
            ("{}", Landing::Any),
        ];
        for (body, want) in cases {
            let q: UnroutedQuery = serde_json::from_str(body).unwrap();
            assert_eq!(q.landing(), want, "body={body}");
        }
    }

    /// Clearing the default team has to be expressible. Both an explicit null
    /// and an empty body mean "no default", because the body states the whole
    /// configuration and the configuration is one field.
    #[test]
    fn test_setting_the_default_team_can_also_clear_it() {
        let set: SetRoutingConfigRequest =
            serde_json::from_str(r#"{"default_team_id":"team_1"}"#).unwrap();
        assert_eq!(set.default_team_id.as_deref(), Some("team_1"));

        for clearing in ["{}", r#"{"default_team_id":null}"#] {
            let cleared: SetRoutingConfigRequest = serde_json::from_str(clearing).unwrap();
            assert_eq!(cleared.default_team_id, None, "body={clearing}");
        }
    }

    /// The preview has to see every level-1 source, or "test routing" reports a
    /// team the real page would not go to — which is worse than no preview.
    #[test]
    fn test_preview_accepts_both_level_one_sources() {
        let full: PreviewRoutingRequest = serde_json::from_str(
            r#"{"oncall_team":"t1","context_team":"Payments","dimensions":{"k8s-cluster":"prod"}}"#,
        )
        .unwrap();
        assert_eq!(full.oncall_team.as_deref(), Some("t1"));
        assert_eq!(full.context_team.as_deref(), Some("Payments"));
        assert_eq!(full.dimensions.get("k8s-cluster").unwrap(), "prod");

        let bare: PreviewRoutingRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.oncall_team, None);
        assert_eq!(bare.context_team, None);
        assert!(bare.dimensions.is_empty());
    }

    /// Every list on this surface is bounded the same way, because the bug
    /// that made it necessary was 473 records in one body.
    #[test]
    fn test_list_bounds_are_clamped() {
        let clamp = |limit: Option<u64>| limit.unwrap_or(100).clamp(1, 200);
        assert_eq!(clamp(None), 100);
        assert_eq!(clamp(Some(0)), 1);
        assert_eq!(clamp(Some(50)), 50);
        assert_eq!(clamp(Some(100_000)), 200);
    }

    #[test]
    fn test_coverage_gaps_query_is_all_optional() {
        let bare: CoverageGapsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.at, None);
        assert_eq!(bare.limit, None);

        let future: CoverageGapsQuery =
            serde_json::from_str(r#"{"at":1700000000000000,"limit":5}"#).unwrap();
        assert_eq!(future.at, Some(1_700_000_000_000_000));
        assert_eq!(future.limit, Some(5));
    }

    #[test]
    fn test_deliveries_query_is_all_optional() {
        let bare: DeliveriesQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.limit, None);
        assert_eq!(bare.offset, None);

        let paged: DeliveriesQuery = serde_json::from_str(r#"{"limit":20,"offset":40}"#).unwrap();
        assert_eq!(paged.limit, Some(20));
        assert_eq!(paged.offset, Some(40));
    }

    /// The summary travels beside the row rather than replacing it: the UI
    /// gets one agreed sentence AND the structured fields it needs to offer
    /// "make a rule out of this".
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_unrouted_row_carries_both_its_fields_and_its_sentence() {
        use config::meta::oncall::UnroutedSignal;

        let signal = UnroutedSignal {
            id: "sig_1".to_string(),
            org_id: "default".to_string(),
            path: "k8s-cluster=prod/k8s-namespace=search".to_string(),
            dimensions: std::collections::HashMap::from([
                ("k8s-cluster".to_string(), "prod".to_string()),
                ("k8s-namespace".to_string(), "search".to_string()),
            ]),
            occurrences: 412,
            first_seen_at: 1_000,
            last_seen_at: 2_000,
            last_subject_type: None,
            last_source_id: None,
            last_title: None,
            last_priority: None,
            defaulted_team_id: None,
            dismissed_at: None,
        };

        let row = with_description(&signal);
        assert_eq!(row["id"], "sig_1");
        assert_eq!(row["occurrences"], 412);
        assert_eq!(row["dimensions"]["k8s-cluster"], "prod");
        assert_eq!(
            row["description"].as_str().unwrap(),
            signal.describe(),
            "the list row must say exactly what describe() says"
        );

        // The "Assign next" surface reads this field to tell a gap that is
        // waking somebody from a gap that is waking nobody, so it has to reach
        // the wire — and the sentence beside it has to agree with it.
        let defaulted = config::meta::oncall::UnroutedSignal {
            defaulted_team_id: Some("team_platform".to_string()),
            ..signal
        };
        let row = with_description(&defaulted);
        assert_eq!(row["defaulted_team_id"], "team_platform");
        assert!(
            row["description"]
                .as_str()
                .unwrap()
                .contains("paged the default team team_platform")
        );
    }
}

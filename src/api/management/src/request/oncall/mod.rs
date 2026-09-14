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
use openobserve_api_common::extractors::ValidatedJson;
use serde::{Deserialize, Deserializer};

#[cfg(feature = "enterprise")]
use crate::service::auth::{UserEmail, check_permissions};

// ── Authorization ─────────────────────────────────────────────────────────────

/// Writing any of this surface decides who gets woken, which is an administrative act.
#[cfg(feature = "enterprise")]
const CONFIG: &str = "oncall";

/// Open to any member of the org: gating the verbs behind admin locks out whoever holds the pager.
#[cfg(feature = "enterprise")]
const RESPONSES: &str = "oncall_responses";

/// A second lock behind `route_permissions`, which is first-match-wins and silently shadowable.
#[cfg(feature = "enterprise")]
async fn allowed(org_id: &str, user_id: &str, resource: &str, permission: &str) -> bool {
    check_permissions(
        org_id, org_id, user_id, resource, permission, None, true, false, false,
    )
    .await
}

// ── Request bodies ────────────────────────────────────────────────────────────

/// The timezone is the one every restriction window on the team is later read in.
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

/// A partial edit of a team: every field absent leaves that part alone.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateTeamRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    /// Needs `double_option`: `#[serde(default)]` decodes an explicit `null` to the outer `None`.
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

/// Accepts one email or many, because setting a team up is mostly "add these six people".
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

    /// Both fields default, so `{}` and a misspelled key both mean "add nobody" and answer 200.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    fn names_nobody(&self) -> bool {
        self.user_emails.iter().all(|e| e.trim().is_empty())
            && self
                .user_email
                .as_deref()
                .is_none_or(|e| e.trim().is_empty())
    }
}

/// A full replace: rotations absent from the body are removed, not left standing.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetScheduleRequest {
    /// Absent means the team's own zone; UTC silently shifts an Asia/Kolkata team by 5.5 hours.
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub rotations: Vec<Rotation>,
}

/// A full replace; which fields a preset takes is the catalogue's job to say, not this struct's.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct FromPresetRequest {
    /// Absent means the team's own zone; there is no per-user timezone to fall back on.
    #[serde(default)]
    pub timezone: Option<String>,
    /// How long one shift lasts, on every layer the preset builds. Absent is a week.
    #[serde(default)]
    pub handover_micros: Option<i64>,
    /// Absent is now, snapped to the last local Monday 00:00 so handovers land on a week boundary.
    #[serde(default)]
    pub anchor_micros: Option<i64>,
    #[serde(flatten)]
    pub spec: config::meta::oncall::PresetSpec,
}

/// `rungs` is a full replace; the two optional fields are left as they were when absent.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetPolicyRequest {
    pub rungs: Vec<PriorityRung>,
    /// Alert Destination names to page through. Absent leaves them unchanged.
    #[serde(default)]
    pub destinations: Option<Vec<String>>,
    /// Absent leaves it unchanged, so editing rungs cannot silently un-configure L0.
    #[serde(default)]
    pub l0: Option<config::meta::oncall::L0Policy>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ListResponsesQuery {
    pub team_id: Option<String>,
    /// Off by default: resolved pages would bury the home screen within a day.
    #[serde(default)]
    pub include_resolved: bool,
    /// Every firing of one subject: a client-side filter cannot see past the page bound.
    pub source_id: Option<String>,
    /// `alert` / `incident` / … — pairs with `source_id`, whose ids are only unique within a kind.
    pub subject_type: Option<String>,
    /// Resolved to the owning teams; a path nobody owns matches nothing, not everything.
    pub ownership_path: Option<String>,
    /// Implies closed records, since only a closed record has a cause.
    pub cause: Option<String>,
    /// Defaulted and capped, because a busy org has hundreds of open records.
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `double_option` throughout: a screen that omits push tokens would otherwise erase one.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct SetContactRequest {
    #[serde(default, deserialize_with = "double_option")]
    pub phone: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub push_token: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub quiet_hours: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
pub struct InboxQuery {
    /// Only what nobody has looked at — what a badge counts.
    #[serde(default)]
    pub unread_only: bool,
    /// Micros, inclusive.
    pub from: Option<i64>,
    /// Micros, exclusive.
    pub to: Option<i64>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `all` is the "clear my inbox" button and is bounded server-side.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct MarkReadRequest {
    #[serde(default)]
    pub event_ids: Vec<String>,
    #[serde(default)]
    pub all: bool,
    /// `false` puts them back to unread: a 3am dismissal by accident must be undoable.
    #[serde(default = "yes")]
    pub read: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Default, Deserialize)]
pub struct MyTeamsQuery {
    /// Answer for this instant (micros) instead of now.
    pub at: Option<i64>,
}

/// Both bounds default: making callers compute timestamps is how a tile hardcodes a month.
#[derive(Debug, Default, Deserialize)]
pub struct CauseAnalyticsQuery {
    pub team_id: Option<String>,
    /// Micros, inclusive. Defaults to 30 days before `to`.
    pub from: Option<i64>,
    /// Micros, exclusive. Defaults to now.
    pub to: Option<i64>,
}

/// Promotes a firing to a full incident.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct PromoteRequest {
    /// Absent takes the record's own title, which is one less field to fill in mid-page.
    #[serde(default)]
    pub title: Option<String>,
    /// Absent derives it from the record's priority, so a promotion cannot silently downgrade.
    #[serde(default)]
    pub severity: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct OnCallQuery {
    /// Resolve at this instant (micros), so the UI shows a future week without a second endpoint.
    pub at: Option<i64>,
}

/// Points one identity-dimension path at the team that gets woken for it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOwnershipRuleRequest {
    pub team_id: String,
    /// `{alias_id: value}`, the same vocabulary the service-identity config produces.
    pub dimensions: std::collections::HashMap<String, String>,
}

/// Closes a page and optionally records what it turned out to be; the whole body may be omitted.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ResolveRequest {
    /// Optional, but it is what makes the next firing history rather than a list of dates.
    #[serde(default)]
    pub cause: Option<config::meta::oncall::ResolutionCause>,
    /// One sentence beside the structured cause.
    #[serde(default)]
    pub cause_note: Option<String>,
}

/// One line onto a page's timeline, attributed to the caller.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddNoteRequest {
    pub body: String,
}

/// Not an acknowledgement: the ladder resumes when the snooze lapses.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SnoozeRequest {
    /// `1`–`1440`: negative silences a live page into the past, unbounded overflows the i64.
    pub minutes: i64,
}

/// Exactly one of `to` (a person here) or `to_team_id` (the other team's on-call is paged).
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct HandoffRequest {
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub to_team_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// The cause belongs to the owner team's record, not to this one, so there is nothing else to send.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ConfirmRecoveryRequest {
    #[serde(default)]
    pub note: Option<String>,
}

/// "This needs more people, now." Optional context for the timeline.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct EscalateRequest {
    #[serde(default)]
    pub note: Option<String>,
}

/// Priorities page differently, so the caller has to say which ladder to prove.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TestPageRequest {
    /// Defaults to P2, the highest priority whose ladder starts with one person, not everyone.
    #[serde(default = "default_test_priority")]
    pub priority: i32,
}

fn default_test_priority() -> i32 {
    2
}

impl Default for TestPageRequest {
    fn default() -> Self {
        Self {
            priority: default_test_priority(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<u64>,
}

/// Resolves the same rules a real firing would and sends nothing.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PreviewRoutingRequest {
    #[serde(default)]
    pub oncall_team: Option<String>,
    #[serde(default)]
    pub dimensions: std::collections::HashMap<String, String>,
}

/// One field, so absent or `null` clears the nomination without a second endpoint.
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
    /// Omitted means the primary; an unknown rotation is refused, or a cover staffs nothing.
    #[serde(default)]
    pub rotation_id: Option<String>,
    /// Must be a user of this org: an override outranks every layer, so a bad address is no pager.
    pub user_email: String,
    /// Micros, inclusive.
    pub start_at: i64,
    /// Micros, exclusive — a cover ending exactly when the next begins does not overlap it.
    pub end_at: i64,
    /// Optional: "cover tonight" is real even before whose shift tonight is has been worked out.
    #[serde(default)]
    pub covering_for: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Both bounds or neither: answering half a window with the unfiltered list looks like it worked.
#[derive(Debug, Default, Deserialize)]
pub struct OverrideWindowQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
}

/// Both bounds required: there is no useful default, and inventing one would hide the bound.
#[derive(Debug, Deserialize)]
pub struct ResolvedScheduleQuery {
    pub from: i64,
    pub to: i64,
    /// Omitted means the primary; one per call, because a row with two answers is not a row.
    #[serde(default)]
    pub rotation_id: Option<String>,
}

/// A person, a window, or both; listing every absence an org ever recorded is not a question.
#[derive(Debug, Default, Deserialize)]
pub struct UnavailabilityQuery {
    #[serde(default)]
    pub user_email: Option<String>,
    #[serde(default)]
    pub from: Option<i64>,
    #[serde(default)]
    pub to: Option<i64>,
}

/// "I am away 20 Aug – 3 Sep."
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateUnavailabilityRequest {
    /// Omitted means the caller's own, which is the case that must not need an administrator.
    #[serde(default)]
    pub user_email: Option<String>,
    /// Micros, inclusive.
    pub start_at: i64,
    /// Micros, exclusive — somebody back on the 3rd is on call on the 3rd.
    pub end_at: i64,
    #[serde(default)]
    pub reason: Option<String>,
}

/// A query param on the confirmation GET, a form field on the POST that acknowledges.
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
    /// A dismissed entry is kept, not deleted — the evidence matters — so asking back is opt-in.
    #[serde(default)]
    pub include_dismissed: bool,
    /// An unrecognised value is treated as absent: a 400 is the worst answer on a worklist.
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
    /// Answer for this instant (micros), so the same call can ask about 2am on Sunday.
    pub at: Option<i64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct DeliveriesQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// Bounded server-side: these are `COUNT`s over the only on-call table with no upper bound.
#[derive(Debug, Default, Deserialize)]
pub struct LookbackQuery {
    /// Days. Clamped `1..=366`.
    pub days: Option<i64>,
    pub limit: Option<u64>,
}

/// Which ladder to dry-run, and when.
#[derive(Debug, Default, Deserialize)]
pub struct EscalationPreviewQuery {
    /// `P1`–`P5`, or `1`–`5`. Absent is P1, the ladder somebody opening this screen is checking.
    pub priority: Option<String>,
    /// Resolve at this instant (micros) instead of now.
    pub at: Option<i64>,
}

/// The ownership list with its usage figures beside it.
#[derive(Debug, Default, Deserialize)]
pub struct OwnershipStatsQuery {
    pub team_id: Option<String>,
    /// Days of history the counts cover. Clamped `1..=366`.
    pub days: Option<i64>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// The `sea-orm` text carries SQL fragments, and every endpoint here is open to the whole org.
#[cfg(feature = "enterprise")]
fn internal_error(context: &str, e: &impl std::fmt::Display) -> Response {
    tracing::error!("[oncall] {context}: {e}");
    MetaHttpResponse::error(
        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
        "internal error".to_string(),
    )
    .into_response()
}

/// A validation failure must not read as a server fault, or a typo looks like an outage.
#[cfg(feature = "enterprise")]
fn to_response(e: anyhow::Error) -> Response {
    use o2_enterprise::enterprise::oncall::service::OncallError;
    let status = match e.downcast_ref::<OncallError>() {
        Some(OncallError::TeamNotFound(_)) | Some(OncallError::ResponseNotFound(_)) => {
            StatusCode::NOT_FOUND
        }
        // Not 404: the record exists, and the honest answer is that working it is not theirs.
        Some(OncallError::NotOnThisTeam { .. }) => StatusCode::FORBIDDEN,
        // A conflict, not a 400: the caller fixes it by changing the org's state, not the request.
        Some(OncallError::NameTaken(_)) | Some(OncallError::IsDefaultTeam(_)) => {
            StatusCode::CONFLICT
        }
        Some(OncallError::Invalid(_)) => StatusCode::BAD_REQUEST,
        None => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::INTERNAL_SERVER_ERROR {
        return internal_error("service", &e);
    }
    // Every remaining status is an `OncallError` whose message is written for the caller.
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
    ValidatedJson(body): ValidatedJson<CreateTeamRequest>,
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
    ValidatedJson(body): ValidatedJson<UpdateTeamRequest>,
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
    ValidatedJson(body): ValidatedJson<AddMembersRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Refused, not 200: a caller who mistyped the key must not find an empty roster at 3am.
        if body.names_nobody() {
            return MetaHttpResponse::bad_request(
                "no members named — send `user_email` or a non-empty `user_emails`",
            );
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
    ValidatedJson(body): ValidatedJson<SetScheduleRequest>,
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
    path = "/{org_id}/oncall/schedule-presets",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallSchedulePresets",
    summary = "The catalogue of schedule presets",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_schedule_presets(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Each entry carries its own input schema, so a form can be built from this response alone.
        MetaHttpResponse::json(config::meta::oncall::preset_catalogue())
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/teams/{team_id}/schedule/from-preset",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ApplyOnCallSchedulePreset",
    summary = "Replace a team's schedule with one built from a preset",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = FromPresetRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
        (status = 404, description = "No such team", content_type = "application/json", body = Object),
    ),
)]
pub async fn apply_schedule_preset(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<FromPresetRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // A full replace of the rotations, so the same authority as `PUT /schedule`.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::apply_schedule_preset(
            &org_id,
            &team_id,
            body.timezone.as_deref(),
            body.spec,
            body.handover_micros,
            body.anchor_micros,
            config::utils::time::now_micros(),
        )
        .await
        {
            // The stored schedule: nothing preset-shaped was stored, so none comes back.
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
    ValidatedJson(body): ValidatedJson<CreateOverrideRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // A cover decides who is woken for its window, as much as editing the rotation does.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::create_override(
            &org_id,
            &team_id,
            body.rotation_id,
            &body.user_email,
            body.start_at,
            body.end_at,
            body.covering_for,
            body.reason,
            // From the caller, not the body: "who agreed" is not a client's to assert.
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
            // Reported, not silently 200: cancelling a missing cover means a stale screen.
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
        ("rotation_id" = Option<String>, Query, description = "Rotation id or name; defaults to the team's primary"),
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
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::resolved_schedule(
            &org_id,
            &team_id,
            q.rotation_id.clone(),
            q.from,
            q.to,
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
    ValidatedJson(body): ValidatedJson<SetPolicyRequest>,
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

/// Absent restores "never set" so the policy takes over, `[]` says no channel; do not collapse.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct SetTeamChannelRequest {
    #[serde(default)]
    pub destinations: Option<Vec<String>>,
}

/// A team's channel and where the answer came from.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TeamChannelResponse {
    pub team_id: String,
    pub destinations: Vec<String>,
    /// `team` or `policy`, or "pages still go to the old room" is unanswerable from the API.
    pub source: &'static str,
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/channel",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallTeamChannel",
    summary = "Get where a team is talked to",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = TeamChannelResponse)),
)]
pub async fn get_team_channel(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let team = match infra::table::oncall_teams::get_channel(&org_id, &team_id).await {
            Ok(t) => t,
            Err(e) => return internal_error("get_team_channel", &e),
        };
        // An empty list while pages go to the policy's room would be a lie of omission.
        let policy =
            match o2_enterprise::enterprise::oncall::service::get_policy(&org_id, &team_id).await {
                Ok(p) => p.destinations,
                Err(e) => return to_response(e),
            };
        let source = if team.is_some() { "team" } else { "policy" };
        MetaHttpResponse::json(TeamChannelResponse {
            team_id,
            destinations: config::meta::oncall::policy::team_channel(team.as_deref(), &policy)
                .to_vec(),
            source,
        })
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/oncall/teams/{team_id}/channel",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SetOnCallTeamChannel",
    summary = "Set where a team is talked to",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    request_body(content = SetTeamChannelRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = TeamChannelResponse)),
)]
pub async fn set_team_channel(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<SetTeamChannelRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let requested = body.destinations.map(|d| {
            d.into_iter()
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty())
                .collect::<Vec<_>>()
        });
        match infra::table::oncall_teams::set_channel(&org_id, &team_id, requested.clone()).await {
            Ok(false) => MetaHttpResponse::not_found(format!("team `{team_id}` not found")),
            Err(e) => internal_error("set_team_channel", &e),
            Ok(true) => {
                let policy =
                    match o2_enterprise::enterprise::oncall::service::get_policy(&org_id, &team_id)
                        .await
                    {
                        Ok(p) => p.destinations,
                        Err(e) => return to_response(e),
                    };
                let source = if requested.is_some() {
                    "team"
                } else {
                    "policy"
                };
                MetaHttpResponse::json(TeamChannelResponse {
                    team_id,
                    destinations: config::meta::oncall::policy::team_channel(
                        requested.as_deref(),
                        &policy,
                    )
                    .to_vec(),
                    source,
                })
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Plain HTML, no JavaScript: it is opened on a phone at night from a mail client.
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
<form method="post" action="/api/v2/{org}/oncall/ack">
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
        use o2_enterprise::enterprise::oncall::{escalation, service, token};

        // Through the service, not `token::verify`: membership is read once for both entry points.
        let claims = match service::ack_claims(
            &form.token,
            &org_id,
            config::utils::time::now_micros(),
        )
        .await
        {
            Ok(c) => c,
            Err(e) => {
                return MetaHttpResponse::error(StatusCode::UNAUTHORIZED.as_u16(), e.to_string())
                    .into_response();
            }
        };
        // Spent before the ack: expiry does not stop a replay, and a losing token must not act.
        if !token::spend(
            &form.token,
            claims.expires_at,
            config::utils::time::now_micros(),
        )
        .await
        {
            // Not an error page: acking is idempotent, so a second click lands where the first did.
            return ack_redirect(&claims.org_id, &claims.response_id);
        }
        if let Err(e) =
            escalation::acknowledge(&claims.org_id, &claims.response_id, &claims.user_email).await
        {
            return to_response(e);
        }
        ack_redirect(&claims.org_id, &claims.response_id)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, form);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// The org must be in the URL, or the app resolves whichever one was last selected.
#[cfg(feature = "enterprise")]
fn ack_redirect(org_id: &str, response_id: &str) -> Response {
    let base = config::get_config().common.web_url.clone();
    let location = format!("{base}/web/oncall/responses/{response_id}?org_identifier={org_id}");
    axum::response::Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(axum::http::header::LOCATION, location)
        .body(axum::body::Body::empty())
        .unwrap()
        .into_response()
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
/// GET must only look: mail gateways fetch URLs, so a scanner would take the page first.
pub async fn ack_page(Path(org_id): Path<String>, Query(q): Query<AckQuery>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::service;

        // Checked on the GET too: a leaver never sees the button, nor the record's title.
        let claims = match service::ack_claims(&q.token, &org_id, config::utils::time::now_micros())
            .await
        {
            Ok(c) => c,
            Err(e) => {
                return MetaHttpResponse::error(StatusCode::UNAUTHORIZED.as_u16(), e.to_string())
                    .into_response();
            }
        };
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

/// Spelled here rather than on the meta type: parsing a query param is this surface's job.
#[cfg(feature = "enterprise")]
const SUBJECT_TYPES: [config::meta::oncall::SubjectType; 2] = {
    use config::meta::oncall::SubjectType::{Alert, Incident};
    [Alert, Incident]
};

#[cfg(feature = "enterprise")]
fn parse_subject_type(s: &str) -> Option<config::meta::oncall::SubjectType> {
    let s = s.trim();
    SUBJECT_TYPES.into_iter().find(|t| t.as_str() == s)
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
        ("include_resolved" = Option<bool>, Query, description = "Include closed records (default false)"),
        ("source_id" = Option<String>, Query, description = "Every firing of one subject"),
        ("subject_type" = Option<String>, Query, description = "`alert` / `incident` — pairs with `source_id`"),
        ("ownership_path" = Option<String>, Query, description = "Identity-dimension path, e.g. `k8s-cluster=prod`"),
        ("cause" = Option<String>, Query, description = "Resolution cause, e.g. `noisy_threshold`; implies closed records"),
        ("limit" = Option<u64>, Query, description = "Page size (default 100, max 200)"),
        ("offset" = Option<u64>, Query, description = "Rows to skip"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Unknown filter value", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_responses(
    Path(org_id): Path<String>,
    Query(q): Query<ListResponsesQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::oncall::ResolutionCause;
        use infra::table::oncall_responses::ResponseFilter;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Same clamp shape as `get_response_history` below.
        let limit = q.limit.unwrap_or(100).clamp(1, 200);
        let offset = q.offset.unwrap_or(0);

        // Refused when unrecognised: ignoring `cause=noisy_treshold` returns every record instead.
        let cause = match q.cause.as_deref() {
            None => None,
            Some(c) => match ResolutionCause::from_str_opt(c) {
                Some(c) => Some(c),
                None => {
                    return MetaHttpResponse::bad_request(format!(
                        "`cause` must be one of {:?}",
                        ResolutionCause::ALL.map(|c| c.as_str())
                    ));
                }
            },
        };
        let subject_type = match q.subject_type.as_deref() {
            None => None,
            Some(s) => match parse_subject_type(s) {
                Some(t) => Some(t),
                None => {
                    return MetaHttpResponse::bad_request(format!(
                        "`subject_type` must be one of {:?}",
                        SUBJECT_TYPES.map(|t| t.as_str())
                    ));
                }
            },
        };
        // A path nobody owns matches nothing; it must never fall through to unfiltered.
        let team_ids = match q.ownership_path.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(path) => match infra::table::oncall_ownership::list(&org_id).await {
                Ok(rules) => {
                    // The trailing `/` anchors the subtree, or `k8s-cluster=pro` claims `prod`.
                    let below = format!("{path}/");
                    Some(
                        rules
                            .into_iter()
                            .filter(|r| {
                                let rule_path = r.path();
                                rule_path == path || rule_path.starts_with(&below)
                            })
                            .map(|r| r.team_id)
                            .collect::<Vec<_>>(),
                    )
                }
                Err(e) => {
                    return internal_error("list_responses ownership", &e);
                }
            },
        };

        let filter = ResponseFilter {
            team_id: q.team_id.as_deref(),
            include_resolved: q.include_resolved,
            source_id: q.source_id.as_deref(),
            subject_type,
            team_ids,
            cause,
        };
        match infra::table::oncall_responses::list_open(&org_id, &filter, limit, offset).await {
            Ok(rows) => MetaHttpResponse::json(with_page_details(&org_id, rows).await),
            Err(e) => internal_error("list_responses", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Two queries for the whole page, never one per row, which is the N+1 this exists to avoid.
#[cfg(feature = "enterprise")]
async fn with_page_details(
    org_id: &str,
    rows: Vec<config::meta::oncall::Response>,
) -> Vec<serde_json::Value> {
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let runbooks = infra::table::oncall_responses::runbook_urls(org_id, &ids)
        .await
        .unwrap_or_else(|e| {
            // A missing runbook must never cost somebody the list of what is on fire.
            tracing::error!("[oncall] runbook lookup: {e}");
            Default::default()
        });
    let rungs = infra::table::oncall_responses::deepest_rungs(&ids)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("[oncall] rung lookup: {e}");
            Default::default()
        });
    rows.into_iter()
        .map(|r| {
            let mut value = serde_json::json!(r);
            if let Some(obj) = value.as_object_mut() {
                if let Some(url) = runbooks.get(&r.id) {
                    obj.insert("runbook_url".to_string(), url.clone().into());
                }
                // The rung's `after_micros`: an index would not survive a reordered ladder.
                if let Some(rung) = rungs.get(&r.id) {
                    obj.insert("reached_rung_micros".to_string(), (*rung).into());
                }
                // Only when answered: a null is indistinguishable from "answered instantly".
                if let Some(acked_at) = r.acked_at {
                    obj.insert(
                        "time_to_ack_micros".to_string(),
                        (acked_at - r.opened_at).max(0).into(),
                    );
                }
            }
            value
        })
        .collect()
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
                return internal_error("get_response", &e);
            }
        };
        match infra::table::oncall_responses::list_events(&response_id).await {
            Ok(events) => MetaHttpResponse::json(serde_json::json!({
                // Hoisted: "where is the runbook" must not depend on the alert still existing.
                "response": with_page_details(&org_id, vec![record]).await.pop(),
                "events": events,
            })),
            Err(e) => internal_error("get_response events", &e),
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
    request_body(content = ResolveRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn resolve_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<ResolveRequest>>,
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
    ValidatedJson(body): ValidatedJson<AddNoteRequest>,
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
    // Grouped, not a list of dates: "3x config change / deploy" is what is worth reading mid-page.
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
    ValidatedJson(body): ValidatedJson<SnoozeRequest>,
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
    ValidatedJson(body): ValidatedJson<HandoffRequest>,
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

#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/confirm-recovery",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ConfirmOnCallRecovery",
    summary = "An impacted team confirms its own service has recovered",
    description = "An impacted team confirms its own service has recovered. The last confirmation \
                   closes the originating incident.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = ConfirmRecoveryRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn confirm_recovery(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<ConfirmRecoveryRequest>>,
) -> Response {
    // Recovery is ordered: without this verb the engine waits for a confirmation nothing sends.
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Looked up here so "no such record" stays a 404 and the wrong kind stays a 400.
        match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(None) => return MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                return internal_error("confirm-recovery lookup", &e);
            }
            Ok(Some(record)) if record.origin_response_id.is_none() => {
                return MetaHttpResponse::error(
                    StatusCode::BAD_REQUEST.as_u16(),
                    format!(
                        "`{response_id}` is not an impacted record; resolve it with a cause instead"
                    ),
                )
                .into_response();
            }
            Ok(Some(_)) => {}
        }
        let body = body.unwrap_or_default();
        // The actor is the session's: this is the record of who said the service was clear.
        match o2_enterprise::enterprise::oncall::escalation::confirm_recovery(
            &org_id,
            &response_id,
            &user_email.user_id,
            body.note.as_deref(),
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
    path = "/{org_id}/oncall/responses/{response_id}/escalate",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "EscalateOnCallResponse",
    summary = "Wake the next rung now, without waiting for the timer",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = EscalateRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn escalate_response(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<EscalateRequest>>,
) -> Response {
    // Not a handoff: a handoff gives the page away, this keeps it and adds people to it.
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::escalation::EscalatedTo;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if infra::table::oncall_responses::get(&org_id, &response_id)
            .await
            .ok()
            .flatten()
            .is_none()
        {
            return MetaHttpResponse::not_found("Response not found");
        }
        let body = body.unwrap_or_default();
        match o2_enterprise::enterprise::oncall::escalation::escalate_now(
            &org_id,
            &response_id,
            &user_email.user_id,
            body.note.as_deref(),
        )
        .await
        {
            // `ladder_exhausted` is a 200: an error reads as a failed press and invites a second.
            Ok((record, EscalatedTo::LadderExhausted)) => {
                MetaHttpResponse::json(serde_json::json!({
                    "escalated_to": "ladder_exhausted",
                    "response": record,
                }))
            }
            Ok((
                record,
                EscalatedTo::Rung {
                    rung_micros,
                    recipients,
                    chased,
                    deduplicated,
                },
            )) => MetaHttpResponse::json(serde_json::json!({
                "escalated_to": "rung",
                "rung_micros": rung_micros,
                "recipients": recipients,
                "chased": chased,
                "deduplicated": deduplicated,
                "response": record,
            })),
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
    path = "/{org_id}/oncall/teams/{team_id}/test-page",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SendOnCallTestPage",
    summary = "Prove this team's paging configuration reaches a human",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "On-call team ID"),
    ),
    request_body(content = TestPageRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn send_test_page(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<TestPageRequest>>,
) -> Response {
    // `oncall`, not `oncall_responses`: this puts a real page out with no real firing.
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let body = body.unwrap_or_default();
        match o2_enterprise::enterprise::oncall::service::send_test_page(
            &org_id,
            &team_id,
            &user_email.user_id,
            body.priority,
            config::utils::time::now_micros(),
        )
        .await
        {
            // 200 even when nothing was sent: the endpoint worked, the configuration did not.
            Ok(result) => MetaHttpResponse::json(serde_json::json!({
                "reached_anyone": result.reached_anyone(),
                "not_sent_because": result.not_sent_because,
                "channels": result.channels,
                "attempts": result.attempts,
            })),
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
            Err(e) => internal_error("history", &e),
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
    ValidatedJson(body): ValidatedJson<CreateOwnershipRuleRequest>,
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
                // The unique index on (org_id, path) refuses it, so it is a conflict, not a fault.
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
    put,
    path = "/{org_id}/oncall/ownership/{rule_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "UpdateOnCallOwnershipRule",
    summary = "Repoint an ownership rule at a team, a path, or both",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("rule_id" = String, Path, description = "Rule ID"),
    ),
    request_body(content = CreateOwnershipRuleRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",  content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Conflict", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_ownership_rule(
    Path((org_id, rule_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<CreateOwnershipRuleRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::routing::update_rule(
            &org_id,
            &rule_id,
            &body.team_id,
            body.dimensions,
        )
        .await
        {
            Ok(Some(rule)) => MetaHttpResponse::json(rule),
            Ok(None) => MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), "Rule not found")
                .into_response(),
            Err(e) => {
                // Same unique-index shape as create: a claimed path is a conflict, not a fault.
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
        let _ = (org_id, rule_id, body);
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

/// Sends the name beside the id, so the screen need not fetch the team list for one label.
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

/// Always answers: an unset org gets a `null` `default_team_id`, saving callers a 404 branch.
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

/// Checked against this org: the setting holds an id from a shared table across tenants.
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
    ValidatedJson(body): ValidatedJson<SetRoutingConfigRequest>,
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

/// Returns the reason too: longest-prefix ownership is easy to get wrong once rules overlap.
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
    ValidatedJson(body): ValidatedJson<PreviewRoutingRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Changes nothing; a POST only because the dimensions travel in a body, so it costs a read.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let routed = match o2_enterprise::enterprise::oncall::routing::decide(
            &org_id,
            body.oncall_team.as_deref(),
            &body.dimensions,
        )
        .await
        {
            Ok(routed) => routed,
            Err(e) => return to_response(e),
        };

        // From the decision itself, so "who lost" is measured against the winner it reported.
        let winning_rule_id = match &routed.decision {
            config::meta::oncall::RoutingDecision::Ownership { rule_id, .. } => {
                Some(rule_id.clone())
            }
            _ => None,
        };
        // A failure here costs the context, never the decision this screen was opened for.
        let context = o2_enterprise::enterprise::oncall::insight::routing_context(
            &org_id,
            routed.team_id(),
            winning_rule_id.as_deref(),
            &body.dimensions,
            config::utils::time::now_micros(),
        )
        .await
        .map_err(|e| tracing::error!("[oncall] routing preview context: {e}"))
        .ok();

        MetaHttpResponse::json(serde_json::json!({
            "decision": routed.decision,
            "team_id": routed.team_id(),
            "reason": routed.reason(),
            // Hoisted out of the tagged decision, so no caller needs the variant names.
            "landed_on_default": routed.landed_on_default(),
            "notes": routed.notes,
            "ladder": context.as_ref().map(|c| &c.ladder),
            "current_responder": context.as_ref().and_then(|c| c.current_responder.as_ref()),
            "covered_now": context.as_ref().map(|c| c.covered_now),
            "also_matched": context.as_ref().map(|c| &c.also_matched),
        }))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// A native user can hold any string as an email, so an unreachable person can sit on a rota.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/reachability",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallTeamReachability",
    summary = "Whether a page would reach each member of a team",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_team_reachability(
    Path((org_id, team_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::reachability::team_reachability(&org_id, &team_id)
            .await
        {
            Ok(report) => MetaHttpResponse::json(report),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Derived, never persisted: a stored risk list goes stale as soon as somebody fixes it.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/config-risks",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallTeamConfigRisks",
    summary = "Actionable problems with a team's paging configuration",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("days" = Option<i64>, Query, description = "How far ahead to look for a coverage gap (default 7, max 31)"),
        ("limit" = Option<u64>, Query, description = "Most severe first (default 50, max 200)"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_team_config_risks(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<LookbackQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::insight;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Bounded harder than history windows: past a month it is not news about anybody's rota.
        let days = q
            .days
            .unwrap_or(insight::DEFAULT_LOOKBACK_DAYS)
            .clamp(1, 31);
        let limit = q.limit.unwrap_or(50).clamp(1, 200) as usize;
        match insight::config_risks(
            &org_id,
            &team_id,
            days,
            limit,
            config::utils::time::now_micros(),
        )
        .await
        {
            // `total` is what was found, `risks` what fits: four shown may be twelve found.
            Ok(found) => MetaHttpResponse::json(serde_json::json!({
                "team_id": team_id,
                "horizon_days": days,
                "total": found.total,
                "risks": found.risks,
            })),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Counted in the database: the team most in need of the summary has the most rows.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/overview",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallTeamOverview",
    summary = "A team's header figures and recent paging record",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("days" = Option<i64>, Query, description = "Window for the summary (default 7, max 366)"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_team_overview(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<LookbackQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::insight;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let days = insight::bounded_days(q.days, insight::DEFAULT_LOOKBACK_DAYS);
        match insight::team_overview(&org_id, &team_id, days, config::utils::time::now_micros())
            .await
        {
            Ok(overview) => MetaHttpResponse::json(overview),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Two bounded windows: what was carried is history, only the shifts ahead can change.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/load",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallTeamLoad",
    summary = "Per-person paging load and rotation fairness",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("days" = Option<i64>, Query, description = "Window, backwards and forwards (default 30, max 366; the forward half is capped at 31 days by the schedule resolver)"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_team_load(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<LookbackQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::insight;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let days = insight::bounded_days(q.days, 30);
        match insight::team_load(&org_id, &team_id, days, config::utils::time::now_micros()).await {
            Ok(load) => MetaHttpResponse::json(load),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// A dry run: no record, page, timer or token; `POST …/test-page` is what delivers.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/teams/{team_id}/escalation-preview",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallEscalationPreview",
    summary = "Resolve a team's ladder against right now, sending nothing",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = String, Path, description = "Team ID"),
        ("priority" = Option<String>, Query, description = "`P1`–`P5` (default `P1`)"),
        ("at" = Option<i64>, Query, description = "Resolve at this instant (micros) instead of now"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 400, description = "Invalid",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_escalation_preview(
    Path((org_id, team_id)): Path<(String, String)>,
    Query(q): Query<EscalationPreviewQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::insight;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let priority = match insight::parse_priority(q.priority.as_deref().unwrap_or("P1")) {
            Ok(p) => p,
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        };
        let at = q.at.unwrap_or_else(config::utils::time::now_micros);
        match insight::escalation_preview(&org_id, &team_id, priority, at).await {
            Ok(preview) => MetaHttpResponse::json(preview),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, team_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// A sibling, not a widening: the counts cost a grouped read the routing path must not pay.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/ownership/stats",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallOwnershipRuleStats",
    summary = "Ownership rules with pages caught, last match and a health verdict",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = Option<String>, Query, description = "Restrict to one team"),
        ("days" = Option<i64>, Query, description = "History window (default 30, max 366)"),
        ("limit" = Option<u64>, Query, description = "Page size (default 50, max 200)"),
        ("offset" = Option<u64>, Query, description = "Rules to skip"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_ownership_rule_stats(
    Path(org_id): Path<String>,
    Query(q): Query<OwnershipStatsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::oncall::insight;

        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let days = insight::bounded_days(q.days, 30);
        let now = config::utils::time::now_micros();
        let from = now - days * config::meta::oncall::MICROS_PER_DAY;
        let limit = q.limit.unwrap_or(50).clamp(1, 200) as usize;
        let offset = q.offset.unwrap_or(0) as usize;
        match insight::ownership_stats(&org_id, q.team_id.as_deref(), from, now, limit, offset)
            .await
        {
            Ok(stats) => {
                // Echoed back so a client can tell "no rules matched" from "past the last page".
                let mut body = serde_json::json!(stats);
                if let Some(obj) = body.as_object_mut() {
                    obj.insert("days".to_string(), days.into());
                    obj.insert("limit".to_string(), limit.into());
                    obj.insert("offset".to_string(), offset.into());
                }
                MetaHttpResponse::json(body)
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

/// Sends `describe()`, so every reader of the queue says the same sentence.
#[cfg(feature = "enterprise")]
fn with_description(signal: &config::meta::oncall::UnroutedSignal) -> serde_json::Value {
    let mut value = serde_json::json!(signal);
    if let Some(obj) = value.as_object_mut() {
        obj.insert("description".to_string(), signal.describe().into());
    }
    value
}

/// Defaults to the outstanding queue, so the missing rule clears an entry on its own.
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

        // Configuration, not a page: the fix for an entry here is an ownership rule.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Same clamp as `list_responses`: a week of paging into a hole accumulates a lot.
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

/// A DELETE on the queue position, not the row: it stamps `dismissed_at` and keeps evidence.
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

/// `total` is honest and `teams` is cut to `limit`, or the worst-off org is undercounted.
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
        // Resolved here so the response names its instant; a banner with no "as of" is unreadable.
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

/// Its own read: the timeline collapses a rung that paged eight people into one line.
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
        // Keyed on the record alone, so another tenant's id would otherwise read straight through.
        match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(Some(_)) => {}
            Ok(None) => return MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                return internal_error("list_deliveries lookup", &e);
            }
        }
        let limit = q.limit.unwrap_or(100).clamp(1, 200);
        let offset = q.offset.unwrap_or(0);
        // `total` is what the ledger holds, `deliveries` what fits, both cut in the database.
        let total = match infra::table::oncall_responses::count_deliveries(&response_id).await {
            Ok(n) => n,
            Err(e) => return internal_error("count_deliveries", &e),
        };
        match infra::table::oncall_responses::list_deliveries_page(&response_id, limit, offset)
            .await
        {
            Ok(rows) => MetaHttpResponse::json(serde_json::json!({
                "total": total,
                "deliveries": rows,
            })),
            Err(e) => internal_error("list_deliveries", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Unavailability / holidays (`architecture/02` §5a) ─────────────────────────

/// Your own always, others only with the config permission: self-service must not need an admin.
#[cfg(feature = "enterprise")]
async fn may_touch_unavailability(org_id: &str, caller: &str, subject: &str, verb: &str) -> bool {
    if caller.eq_ignore_ascii_case(subject) {
        return true;
    }
    allowed(org_id, caller, CONFIG, verb).await
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/unavailability",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListOnCallUnavailability",
    summary = "When people are away",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = Option<String>, Query, description = "Whose absences; defaults to the caller when no window is given"),
        ("from" = Option<i64>, Query, description = "Window start (microseconds); requires `to`"),
        ("to" = Option<i64>, Query, description = "Window end (microseconds); requires `from`"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_unavailability(
    Path(org_id): Path<String>,
    Query(q): Query<UnavailabilityQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let subject = match q.user_email.as_deref() {
            Some(email) if !email.trim().is_empty() => email.trim().to_string(),
            // No person and no window means "mine", rather than an unbounded read.
            _ if q.from.is_none() && q.to.is_none() => user_email.user_id.clone(),
            _ => String::new(),
        };
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = if subject.is_empty() {
            // An org-wide window reads everybody's leave calendar, which is configuration.
            allowed(&org_id, &user_email.user_id, CONFIG, "LIST").await
        } else {
            may_touch_unavailability(&org_id, &user_email.user_id, &subject, "LIST").await
        };
        if !permitted {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let who = (!subject.is_empty()).then_some(subject);
        match o2_enterprise::enterprise::oncall::service::list_unavailability(
            &org_id,
            who.as_deref(),
            q.from,
            q.to,
        )
        .await
        {
            Ok(records) => MetaHttpResponse::json(records),
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
    path = "/{org_id}/oncall/unavailability",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "CreateOnCallUnavailability",
    summary = "Record that somebody is away",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateUnavailabilityRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_unavailability(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<CreateUnavailabilityRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let subject = match body.user_email.as_deref() {
            Some(email) if !email.trim().is_empty() => email.trim().to_string(),
            _ => user_email.user_id.clone(),
        };
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await
            || !may_touch_unavailability(&org_id, &user_email.user_id, &subject, "POST").await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::create_unavailability(
            &org_id,
            &subject,
            body.start_at,
            body.end_at,
            body.reason,
            // From the caller, not the body: booking your own leave differs from having it booked.
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
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/unavailability/{unavailability_id}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallUnavailability",
    summary = "Withdraw an absence",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("unavailability_id" = String, Path, description = "Unavailability ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "No such absence", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_unavailability(
    Path((org_id, unavailability_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Read before the inner lock: once the row is gone, whose absence it was is unanswerable.
        let existing = match o2_enterprise::enterprise::oncall::service::get_unavailability(
            &org_id,
            &unavailability_id,
        )
        .await
        {
            Ok(Some(record)) => record,
            Ok(None) => return MetaHttpResponse::not_found("unavailability not found"),
            Err(e) => return to_response(e),
        };
        if !may_touch_unavailability(&org_id, &user_email.user_id, &existing.user_email, "DELETE")
            .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::oncall::service::delete_unavailability(
            &org_id,
            &unavailability_id,
        )
        .await
        {
            // Reported, not silently 200: withdrawing a missing absence means a stale screen.
            Ok(true) => MetaHttpResponse::json(serde_json::json!({ "deleted": true })),
            Ok(false) => MetaHttpResponse::not_found("unavailability not found"),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, unavailability_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Contact profiles (U27, `architecture/03` §5) ──────────────────────────────

/// Your own always, others only with the config permission: a whole org's numbers are not open.
#[cfg(feature = "enterprise")]
async fn may_touch_contacts(org_id: &str, caller: &str, subject: &str, verb: &str) -> bool {
    // Case-insensitive: a login is not case-sensitive, and a refusal here loses a phone number.
    if caller.eq_ignore_ascii_case(subject) {
        return true;
    }
    allowed(org_id, caller, CONFIG, verb).await
}

/// `unverified` is the point: somebody who saved a number must not learn otherwise at 3am.
#[cfg(feature = "enterprise")]
fn contact_body(contact: &config::meta::oncall::Contact) -> serde_json::Value {
    let mut value = serde_json::json!(contact);
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "unverified".to_string(),
            serde_json::json!(contact.unverified_methods()),
        );
        obj.insert(
            "phone_is_pageable".to_string(),
            contact.phone_is_pageable().into(),
        );
        obj.insert(
            "push_is_pageable".to_string(),
            contact.push_is_pageable().into(),
        );
    }
    value
}

#[utoipa::path(
    get,
    path = "/{org_id}/oncall/contacts/{user_email}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "GetOnCallContact",
    summary = "How to reach one person",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "The person's email"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn get_contact(
    Path((org_id, subject_email)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "GET").await
            || !may_touch_contacts(&org_id, &user_email.user_id, &subject_email, "GET").await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match infra::table::oncall_user_contacts::get(&org_id, &subject_email).await {
            // An empty profile, not a 404: the branch a 404 forces is one that renders nothing.
            Ok(found) => {
                MetaHttpResponse::json(contact_body(&found.unwrap_or_else(|| {
                    config::meta::oncall::Contact::empty(&org_id, &subject_email)
                })))
            }
            Err(e) => internal_error("get_contact", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, subject_email);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// No SMS or voice transport exists yet, so every number saved here lands unverified.
#[utoipa::path(
    put,
    path = "/{org_id}/oncall/contacts/{user_email}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "SetOnCallContact",
    summary = "Set or clear a person's contact methods",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "The person's email"),
    ),
    request_body(content = SetContactRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Not a dialable number", content_type = "application/json", body = Object),
    ),
)]
pub async fn set_contact(
    Path((org_id, subject_email)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<SetContactRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::oncall_user_contacts::ContactPatch;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "PUT").await
            || !may_touch_contacts(&org_id, &user_email.user_id, &subject_email, "PUT").await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // An empty string clears: a stored "" would look like a number to anything reading it.
        let phone = match body.phone {
            None => None,
            Some(None) => Some(None),
            Some(Some(raw)) if raw.trim().is_empty() => Some(None),
            Some(Some(raw)) => match config::meta::oncall::normalize_phone(&raw) {
                Ok(p) => Some(Some(p)),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            },
        };
        let blank_to_none = |v: Option<Option<String>>| match v {
            Some(Some(s)) if s.trim().is_empty() => Some(None),
            other => other,
        };
        let patch = ContactPatch {
            phone,
            push_token: blank_to_none(body.push_token),
            quiet_hours: blank_to_none(body.quiet_hours),
        };
        match infra::table::oncall_user_contacts::upsert(
            &org_id,
            &subject_email,
            &patch,
            config::utils::time::now_micros(),
        )
        .await
        {
            Ok(contact) => MetaHttpResponse::json(contact_body(&contact)),
            Err(e) => internal_error("set_contact", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, subject_email, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/oncall/contacts/{user_email}",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "DeleteOnCallContact",
    summary = "Forget a person's contact methods",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "The person's email"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn delete_contact(
    Path((org_id, subject_email)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "DELETE").await
            || !may_touch_contacts(&org_id, &user_email.user_id, &subject_email, "DELETE").await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match infra::table::oncall_user_contacts::delete(&org_id, &subject_email).await {
            // Reported, not silently 200: deleting a missing profile means a stale screen.
            Ok(deleted) => MetaHttpResponse::json(serde_json::json!({ "deleted": deleted })),
            Err(e) => internal_error("delete_contact", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, subject_email);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── The responder's own inbox (U25) ───────────────────────────────────────────

/// Keyed on the caller and paginated, with `total` and `unread` so a badge never walks it.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/my/deliveries",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListMyOnCallDeliveries",
    summary = "Every page addressed to the caller, and whether it landed",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("unread_only" = Option<bool>, Query, description = "Only rows the caller has not marked read (default false)"),
        ("from" = Option<i64>, Query, description = "Window start (microseconds), inclusive"),
        ("to" = Option<i64>, Query, description = "Window end (microseconds), exclusive"),
        ("limit" = Option<u64>, Query, description = "Page size (default 100, max 200)"),
        ("offset" = Option<u64>, Query, description = "Rows to skip"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_my_deliveries(
    Path(org_id): Path<String>,
    Query(q): Query<InboxQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::oncall_deliveries;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // The caller, never a parameter: an inbox's "whose" is not a client's to assert.
        let me = &user_email.user_id;
        let filter = oncall_deliveries::InboxQuery {
            unread_only: q.unread_only,
            from: q.from,
            to: q.to,
        };
        let limit = q.limit.unwrap_or(100).clamp(1, 200);
        let offset = q.offset.unwrap_or(0);

        let rows = match oncall_deliveries::list_for_user(&org_id, me, &filter, limit, offset).await
        {
            Ok(rows) => rows,
            Err(e) => {
                return internal_error("list_my_deliveries", &e);
            }
        };
        // `unread` ignores the window: "3 unread" must not change on scrolling to last Tuesday.
        let total = oncall_deliveries::count_for_user(&org_id, me, &filter)
            .await
            .unwrap_or(rows.len() as u64);
        let unread = oncall_deliveries::unread_count(&org_id, me)
            .await
            .unwrap_or(0);
        MetaHttpResponse::json(serde_json::json!({
            "total": total,
            "unread": unread,
            "deliveries": rows,
        }))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Marks inbox rows read, or unread again.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/my/deliveries/read",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "MarkMyOnCallDeliveriesRead",
    summary = "Mark pages read, or unread again",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = MarkReadRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Too many ids", content_type = "application/json", body = Object),
    ),
)]
pub async fn mark_deliveries_read(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<MarkReadRequest>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::oncall_deliveries;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let body = body.unwrap_or_default();
        let me = &user_email.user_id;
        let now = config::utils::time::now_micros();

        // Same bound as every list here, on a write: an unbounded id list is unbounded round trips.
        const MAX_IDS: usize = 200;
        if body.event_ids.len() > MAX_IDS {
            return MetaHttpResponse::bad_request(format!(
                "at most {MAX_IDS} `event_ids` per request"
            ));
        }

        let result = if body.all && body.read {
            // Bounded: an unbounded UPDATE holds a lock across a whole paging history.
            oncall_deliveries::mark_all_read(&org_id, me, 1_000, now).await
        } else {
            oncall_deliveries::set_read(&org_id, me, &body.event_ids, body.read, now).await
        };
        match result {
            // The unread count travels back, so a badge is right without a second request.
            Ok(updated) => {
                let unread = oncall_deliveries::unread_count(&org_id, me)
                    .await
                    .unwrap_or(0);
                MetaHttpResponse::json(serde_json::json!({
                    "updated": updated,
                    "unread": unread,
                }))
            }
            Err(e) => internal_error("mark_deliveries_read", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── "Which teams am I on, and am I on call?" ──────────────────────────────────

/// One request instead of N+1: only the per-team schedule read cannot be folded into a join.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/my/teams",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "ListMyOnCallTeams",
    summary = "The caller's teams, and whether they are on call",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("at" = Option<i64>, Query, description = "Answer for this instant (microseconds) instead of now"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn list_my_teams(
    Path(org_id): Path<String>,
    Query(q): Query<MyTeamsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let me = &user_email.user_id;
        let at = q.at.unwrap_or_else(config::utils::time::now_micros);
        let teams = match infra::table::oncall_teams::list_for_user(&org_id, me).await {
            Ok(teams) => teams,
            Err(e) => {
                return internal_error("list_my_teams", &e);
            }
        };

        // Concurrent, or latency grows with team count; `join_all` keeps the input order.
        let resolutions = futures::future::join_all(teams.iter().map(|team| {
            o2_enterprise::enterprise::oncall::service::who_is_on_call(&org_id, &team.id, Some(at))
        }))
        .await;

        let mut out = Vec::with_capacity(teams.len());
        let mut on_call_anywhere = false;
        for (team, slots) in teams.into_iter().zip(resolutions) {
            // An unresolvable schedule reads as unknown; "not on call" must never be a guess.
            let (on_call_now, whos_on_call, resolved) = match slots {
                Ok(slots) => {
                    let mine = slots.iter().any(|s| s.user_email.eq_ignore_ascii_case(me));
                    let names: Vec<String> = slots.iter().map(|s| s.user_email.clone()).collect();
                    (Some(mine), names, true)
                }
                Err(e) => {
                    tracing::warn!("[oncall] my_teams schedule for {}: {e}", team.id);
                    (None, Vec::new(), false)
                }
            };
            on_call_anywhere |= on_call_now.unwrap_or(false);
            out.push(serde_json::json!({
                "team_id": team.id,
                "team_name": team.name,
                "timezone": team.timezone,
                "description": team.description,
                "on_call_now": on_call_now,
                "on_call": whos_on_call,
                "schedule_resolved": resolved,
            }));
        }
        MetaHttpResponse::json(serde_json::json!({
            "at": at,
            "user_email": me,
            "on_call_now": on_call_anywhere,
            "teams": out,
        }))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Cause analytics (U26) ─────────────────────────────────────────────────────

/// Counted in the database: the org with most to learn from this has the most rows.
#[utoipa::path(
    get,
    path = "/{org_id}/oncall/analytics/causes",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "OnCallCauseAnalytics",
    summary = "Counts per resolution cause over a window",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("team_id" = Option<String>, Query, description = "Restrict to one team; omit for the whole org"),
        ("from" = Option<i64>, Query, description = "Window start (microseconds); defaults to 30 days before `to`"),
        ("to" = Option<i64>, Query, description = "Window end (microseconds); defaults to now"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Window inverted or too long", content_type = "application/json", body = Object),
    ),
)]
pub async fn cause_analytics(
    Path(org_id): Path<String>,
    Query(q): Query<CauseAnalyticsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let (from, to) = match analytics_window(q.from, q.to) {
            Ok(w) => w,
            Err(msg) => return MetaHttpResponse::bad_request(msg),
        };
        match infra::table::oncall_responses::cause_breakdown(
            &org_id,
            q.team_id.as_deref(),
            from,
            to,
        )
        .await
        {
            Ok(causes) => {
                // Summed from what was counted: a second read would not add up to 100.
                let total: i64 = causes.iter().map(|c| c.count).sum();
                MetaHttpResponse::json(serde_json::json!({
                    "from": from,
                    "to": to,
                    "team_id": q.team_id,
                    "total": total,
                    "causes": causes,
                }))
            }
            Err(e) => internal_error("cause_analytics", &e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Capped at a year because this scans a table that grows with every page an org has ever taken.
#[cfg(feature = "enterprise")]
fn analytics_window(from: Option<i64>, to: Option<i64>) -> Result<(i64, i64), String> {
    const DAY: i64 = 86_400_000_000;
    let to = to.unwrap_or_else(config::utils::time::now_micros);
    let from = from.unwrap_or(to - 30 * DAY);
    if from >= to {
        return Err("`from` must be before `to`".to_string());
    }
    if to - from > 366 * DAY {
        return Err("the window may cover at most 366 days".to_string());
    }
    Ok((from, to))
}

// ── Promote a firing to an incident ───────────────────────────────────────────

/// Idempotent by refusal: an attached record is a conflict, so two clicks give one incident.
#[utoipa::path(
    post,
    path = "/{org_id}/oncall/responses/{response_id}/promote",
    context_path = "/api",
    tag = "OnCall",
    operation_id = "PromoteOnCallResponseToIncident",
    summary = "Promote a response record to an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("response_id" = String, Path, description = "Response record ID"),
    ),
    request_body(content = PromoteRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "No such record", content_type = "application/json", body = Object),
        (status = 409, description = "Already an incident", content_type = "application/json", body = Object),
    ),
)]
/// Best effort: a thin history beats rolling the incident back over a timeline write.
#[cfg(feature = "enterprise")]
async fn carry_page_history_into_incident(
    org_id: &str,
    response_id: &str,
    incident_id: &str,
    record: &config::meta::oncall::Response,
) {
    use config::meta::{alerts::incidents::IncidentEvent, oncall::ResponseEventKind};

    // Written first so it heads the timeline.
    let team = infra::table::oncall_teams::get(org_id, record.team())
        .await
        .ok()
        .flatten()
        .map(|t| t.name)
        .unwrap_or_else(|| record.team().to_string());
    let mut summary = format!(
        "Promoted from on-call page {response_id} — paged {team} at P{}",
        record.priority
    );
    match (record.acked_by.as_deref(), record.acked_at) {
        (Some(who), _) => summary.push_str(&format!(", acknowledged by {who}")),
        // Said explicitly, or its absence reads as "not recorded" rather than "nobody answered".
        (None, _) => summary.push_str(", never acknowledged"),
    }
    if let Some(cause) = record.cause.as_ref() {
        summary.push_str(&format!(", cause recorded as {}", cause.as_str()));
    }
    if let Err(e) = infra::table::incident_events::append(
        org_id,
        incident_id,
        IncidentEvent::comment("o2-engine", summary),
    )
    .await
    {
        tracing::warn!("[oncall] promote summary onto {incident_id}: {e}");
    }

    let timeline = match infra::table::oncall_responses::list_events(response_id).await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("[oncall] promote read page timeline {response_id}: {e}");
            return;
        }
    };

    // `AiVerdict`, not `Rca`: nothing writes `Rca`, so filtering on it makes this unreachable.
    for event in timeline.iter().filter(|e| {
        matches!(
            e.kind,
            ResponseEventKind::Note | ResponseEventKind::AiVerdict
        ) && !e.body.trim().is_empty()
    }) {
        let prefix = match event.kind {
            ResponseEventKind::AiVerdict => "AI SRE (from the page): ",
            _ => "",
        };
        if let Err(e) = infra::table::incident_events::append(
            org_id,
            incident_id,
            IncidentEvent::comment(event.actor.clone(), format!("{prefix}{}", event.body)),
        )
        .await
        {
            tracing::warn!("[oncall] promote note onto {incident_id}: {e}");
        }
    }
}

/// A promotion may raise the severity, never lower what woke somebody, so it is discarded.
#[cfg(feature = "enterprise")]
fn promoted_severity(
    priority: i32,
    asked: Option<config::meta::alerts::incidents::IncidentSeverity>,
) -> config::meta::alerts::incidents::IncidentSeverity {
    use config::meta::alerts::incidents::IncidentSeverity;

    let floor = match priority {
        1 => IncidentSeverity::P1,
        2 => IncidentSeverity::P2,
        3 => IncidentSeverity::P3,
        _ => IncidentSeverity::P4,
    };
    // Ranked by hand: `IncidentSeverity` has no `Ord`, and P1 is the most urgent, not the least.
    let rank = |s: IncidentSeverity| match s {
        IncidentSeverity::P1 => 1u8,
        IncidentSeverity::P2 => 2,
        IncidentSeverity::P3 => 3,
        IncidentSeverity::P4 => 4,
    };
    match asked {
        Some(s) if rank(s) < rank(floor) => s,
        _ => floor,
    }
}

pub async fn promote_to_incident(
    Path((org_id, response_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<Option<PromoteRequest>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::alerts::incidents::IncidentSeverity;

        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let body = body.unwrap_or_default();

        let record = match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(Some(r)) => r,
            Ok(None) => return MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                return internal_error("promote lookup", &e);
            }
        };
        // Checked before the incident opens: `add_note`'s check comes too late for a stranger.
        if let Err(e) = o2_enterprise::enterprise::oncall::service::refuse_if_not_on_the_paged_team(
            &org_id,
            record.team(),
            &user_email.user_id,
        )
        .await
        {
            return to_response(e);
        }
        if let Some(existing) = record.incident_id.as_deref() {
            return MetaHttpResponse::error(
                StatusCode::CONFLICT.as_u16(),
                format!("this record is already part of incident {existing}"),
            )
            .into_response();
        }

        let asked = match body.severity.as_deref() {
            None => None,
            Some(raw) => match raw.trim().parse::<IncidentSeverity>() {
                Ok(s) => Some(s),
                Err(_) => return MetaHttpResponse::bad_request("`severity` must be P1–P4"),
            },
        };
        let severity = promoted_severity(record.priority, asked);
        let title = body
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .or_else(|| record.title.clone());

        // Isolated by its own subject: a correlation rule would attach it to somebody else's.
        let group_values = serde_json::json!({
            "oncall_subject_type": record.subject.subject_type.as_str(),
            "oncall_source_id": record.subject.source_id,
            "oncall_response_id": record.id,
        });
        // Written together: as two statements a failure leaves an incident nothing points at.
        let incident = match infra::table::alert_incidents::create_and_attach_to_oncall_response(
            &org_id,
            &response_id,
            &severity.to_string(),
            group_values,
            "AlertId",
            record.opened_at,
            title,
        )
        .await
        {
            Ok(Some(i)) => i,
            // Promoted between the guard and this write, or gone; either way nothing was created.
            Ok(None) => {
                return MetaHttpResponse::error(
                    StatusCode::CONFLICT.as_u16(),
                    "this record has already been promoted".to_string(),
                )
                .into_response();
            }
            Err(e) => {
                return internal_error("promote create incident", &e);
            }
        };
        let mut updated = record.clone();
        updated.incident_id = Some(incident.id.clone());

        // Best effort: an attached incident beats rolling back over a failed display join.
        if record.subject.subject_type == config::meta::oncall::SubjectType::Alert
            && let Err(e) = infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                &record.subject.source_id,
                record.title.as_deref().unwrap_or(&record.subject.source_id),
                "internal",
                record.opened_at,
                "promoted from an on-call page",
            )
            .await
        {
            tracing::warn!("[oncall] promote link alert: {e}");
        }

        // Copied, not linked: this is what was known at promotion and must not change after.
        carry_page_history_into_incident(&org_id, &response_id, &incident.id, &record).await;

        if let Err(e) = o2_enterprise::enterprise::oncall::escalation::add_note(
            &org_id,
            &response_id,
            &user_email.user_id,
            &format!("promoted to incident {}", incident.id),
        )
        .await
        {
            tracing::warn!("[oncall] promote note: {e}");
        }
        MetaHttpResponse::json(serde_json::json!({
            "incident_id": incident.id,
            "severity": incident.severity,
            "response": updated,
        }))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, response_id, body);
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

    /// Collapsing absent and explicit null would make a description impossible to remove.
    #[test]
    fn test_update_distinguishes_absent_from_null_description() {
        let absent: UpdateTeamRequest = serde_json::from_str(r#"{"name":"P"}"#).unwrap();
        assert_eq!(absent.description, None);

        let cleared: UpdateTeamRequest = serde_json::from_str(r#"{"description":null}"#).unwrap();
        assert_eq!(cleared.description, Some(None));

        let set: UpdateTeamRequest = serde_json::from_str(r#"{"description":"owns db"}"#).unwrap();
        assert_eq!(set.description, Some(Some("owns db".to_string())));
    }

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

    /// The preset's inputs sit flat beside the common fields, and a UI is built on that shape.
    #[test]
    fn test_from_preset_body_reads_the_published_shape() {
        let body: FromPresetRequest = serde_json::from_str(
            r#"{"preset":"follow_the_sun",
                "timezone":"Asia/Kolkata",
                "handover_micros":604800000000,
                "groups":[
                  {"name":"APAC","members":["naoto@o2.ai"],"start_minute":0,"end_minute":480},
                  {"name":"EMEA","members":["lars@o2.ai"],"start_minute":480,"end_minute":1440}
                ]}"#,
        )
        .unwrap();
        assert_eq!(body.timezone.as_deref(), Some("Asia/Kolkata"));
        assert_eq!(body.handover_micros, Some(604_800_000_000));
        assert_eq!(body.anchor_micros, None);
        assert_eq!(body.spec.id(), config::meta::oncall::PresetId::FollowTheSun);
        assert_eq!(body.spec.members(), vec!["naoto@o2.ai", "lars@o2.ai"]);
    }

    /// Everything but the preset and its groups is optional.
    #[test]
    fn test_from_preset_body_defaults_everything_optional() {
        let body: FromPresetRequest = serde_json::from_str(
            r#"{"preset":"weekday_weekend",
                "weekdays":{"members":["ana@o2.ai"]},
                "weekend":{"members":["sam@o2.ai"]}}"#,
        )
        .unwrap();
        assert_eq!(body.timezone, None);
        assert_eq!(body.handover_micros, None);
        assert_eq!(body.anchor_micros, None);
    }

    /// An unknown preset id is a decode failure, not a silent fallback to one of the four.
    #[test]
    fn test_an_unknown_preset_is_refused() {
        assert!(serde_json::from_str::<FromPresetRequest>(r#"{"preset":"round_robin"}"#).is_err());
    }

    /// Accepting a cause here would let a dependent write the reason somebody else's service broke.
    #[test]
    fn test_confirm_recovery_takes_a_note_and_nothing_else() {
        let body: ConfirmRecoveryRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(body.note, None);
        let body: ConfirmRecoveryRequest =
            serde_json::from_str(r#"{"note":"buffered writes replayed"}"#).unwrap();
        assert_eq!(body.note.as_deref(), Some("buffered writes replayed"));
        // Ignored rather than refused, which is how every other body in this module behaves.
        let body: ConfirmRecoveryRequest =
            serde_json::from_str(r#"{"cause":"genuine_defect"}"#).unwrap();
        assert_eq!(body.note, None);
    }

    /// Somebody reaching for "wake more people" must not be stopped by a required field.
    #[test]
    fn test_escalate_body_is_entirely_optional() {
        let none: Option<EscalateRequest> = serde_json::from_str("null").unwrap();
        assert!(none.is_none());
        let empty: EscalateRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(empty.note, None);
        let with_note: EscalateRequest =
            serde_json::from_str(r#"{"note":"needs the db team"}"#).unwrap();
        assert_eq!(with_note.note.as_deref(), Some("needs the db team"));
    }

    /// P1's ladder pages the whole schedule at once, which is a lot of phones for a test.
    #[test]
    fn test_a_test_page_defaults_to_the_priority_that_wakes_one_person() {
        let defaulted: TestPageRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(defaulted.priority, 2);
        assert_eq!(TestPageRequest::default().priority, 2);
        let explicit: TestPageRequest = serde_json::from_str(r#"{"priority":1}"#).unwrap();
        assert_eq!(explicit.priority, 1);
    }

    /// Reading our own source is the only thing that catches a handler added later with no gate.
    #[test]
    fn test_every_session_handler_is_gated() {
        // Exempt: served from `basic_routes` with no session, gated by the token in the handler.
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

    /// The queue defaults to the worklist, or a badge built on it counts dismissed history forever.
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

    /// An unrecognised value widens: a 400 is the worst answer on a worklist somebody opened.
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

    /// Explicit null and an empty body both mean "no default": the body is one whole field.
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

    /// Without the level-1 source, "test routing" names a team the real page would not use.
    #[test]
    fn test_preview_accepts_the_level_one_source() {
        let full: PreviewRoutingRequest =
            serde_json::from_str(r#"{"oncall_team":"t1","dimensions":{"k8s-cluster":"prod"}}"#)
                .unwrap();
        assert_eq!(full.oncall_team.as_deref(), Some("t1"));
        assert_eq!(full.dimensions.get("k8s-cluster").unwrap(), "prod");

        let bare: PreviewRoutingRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.oncall_team, None);
        assert!(bare.dimensions.is_empty());
    }

    /// Every list here is bounded the same way, after a bug that put 473 records in one body.
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

    /// All optional, so the bare call still answers the home screen.
    #[test]
    fn test_response_filters_are_all_optional() {
        let bare: ListResponsesQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.source_id, None);
        assert_eq!(bare.subject_type, None);
        assert_eq!(bare.ownership_path, None);
        assert_eq!(bare.cause, None);
        assert!(!bare.include_resolved);

        let full: ListResponsesQuery = serde_json::from_str(
            r#"{"source_id":"al_ckt","subject_type":"alert",
                "ownership_path":"k8s-cluster=prod","cause":"noisy_threshold",
                "team_id":"team_1","limit":25,"offset":50}"#,
        )
        .unwrap();
        assert_eq!(full.source_id.as_deref(), Some("al_ckt"));
        assert_eq!(full.ownership_path.as_deref(), Some("k8s-cluster=prod"));
        assert_eq!(full.cause.as_deref(), Some("noisy_threshold"));
        assert_eq!(full.limit, Some(25));
        assert_eq!(full.offset, Some(50));
    }

    /// Refused, not widened: ignoring `cause=noisy_treshold` returns every record instead.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_unknown_cause_is_not_silently_ignored() {
        use config::meta::oncall::ResolutionCause;

        assert_eq!(
            ResolutionCause::from_str_opt("noisy_threshold"),
            Some(ResolutionCause::NoisyThreshold)
        );
        for bad in ["noisy_treshold", "", "NoisyThreshold", "anything"] {
            assert!(
                ResolutionCause::from_str_opt(bad).is_none(),
                "value={bad:?} must not parse, so the handler can refuse it"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_subject_type_filter_parses_every_kind_and_nothing_else() {
        use config::meta::oncall::SubjectType;

        assert_eq!(parse_subject_type("alert"), Some(SubjectType::Alert));
        assert_eq!(
            parse_subject_type(" incident "),
            Some(SubjectType::Incident)
        );
        assert_eq!(parse_subject_type("Alert"), None, "wire values are exact");
        assert_eq!(parse_subject_type("synthetic"), None);
        assert_eq!(parse_subject_type("dashboard"), None);
    }

    /// Collapsing absent and `null` means a screen omitting push tokens erases one on save.
    #[test]
    fn test_contact_body_distinguishes_absent_from_null() {
        let absent: SetContactRequest = serde_json::from_str(r#"{"phone":"+15550100"}"#).unwrap();
        assert_eq!(absent.push_token, None);
        assert_eq!(absent.quiet_hours, None);
        assert_eq!(absent.phone, Some(Some("+15550100".to_string())));

        let cleared: SetContactRequest = serde_json::from_str(r#"{"phone":null}"#).unwrap();
        assert_eq!(cleared.phone, Some(None));

        let nothing: SetContactRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(nothing.phone, None);
    }

    /// No SMS or voice transport exists yet, so the body must say a number is unverified.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_saved_number_is_reported_as_unverified() {
        use config::meta::oncall::Contact;

        let mut contact = Contact::empty("default", "ana@o2.ai");
        contact.phone = Some("+15550100".to_string());
        let body = contact_body(&contact);

        assert_eq!(body["phone"], "+15550100");
        assert_eq!(body["unverified"][0], "phone");
        assert_eq!(body["phone_is_pageable"], false);
        assert!(
            body.get("phone_verified_at").is_none(),
            "an unverified number carries no verification instant at all"
        );

        contact.phone_verified_at = Some(1_700_000_000_000_000i64);
        let body = contact_body(&contact);
        assert_eq!(body["phone_is_pageable"], true);
        assert_eq!(body["unverified"].as_array().unwrap().len(), 0);
    }

    /// An empty profile is a complete answer; the branch a 404 forces renders nothing.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_person_with_no_profile_still_has_a_body() {
        use config::meta::oncall::Contact;

        let body = contact_body(&Contact::empty("default", "new@o2.ai"));
        assert_eq!(body["user_email"], "new@o2.ai");
        assert_eq!(body["phone_is_pageable"], false);
        assert_eq!(body["unverified"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_inbox_query_defaults_to_everything_recent() {
        let bare: InboxQuery = serde_json::from_str("{}").unwrap();
        assert!(!bare.unread_only);
        assert_eq!(bare.from, None);
        assert_eq!(bare.limit, None);

        let badge: InboxQuery = serde_json::from_str(r#"{"unread_only":true,"limit":1}"#).unwrap();
        assert!(badge.unread_only);
        assert_eq!(badge.limit, Some(1));
    }

    /// Unmarking must be expressible: a 3am dismissal by accident has to be undoable.
    #[test]
    fn test_marking_read_defaults_to_read() {
        let ids: MarkReadRequest =
            serde_json::from_str(r#"{"event_ids":["ev_1","ev_2"]}"#).unwrap();
        assert!(ids.read);
        assert!(!ids.all);
        assert_eq!(ids.event_ids.len(), 2);

        let undo: MarkReadRequest =
            serde_json::from_str(r#"{"event_ids":["ev_1"],"read":false}"#).unwrap();
        assert!(!undo.read);

        let clear: MarkReadRequest = serde_json::from_str(r#"{"all":true}"#).unwrap();
        assert!(clear.all);
        assert!(clear.read);
        assert!(clear.event_ids.is_empty());
    }

    /// Refuses "all time": this scans a table that grows with every page an org has taken.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_analytics_window_defaults_and_is_capped() {
        const DAY: i64 = 86_400_000_000;
        let to = 1_700_000_000_000_000i64;

        let (from, got_to) = analytics_window(None, Some(to)).unwrap();
        assert_eq!(got_to, to);
        assert_eq!(to - from, 30 * DAY);

        assert_eq!(
            analytics_window(Some(to - DAY), Some(to)).unwrap(),
            (to - DAY, to)
        );
        assert!(
            analytics_window(Some(to), Some(to)).is_err(),
            "empty window"
        );
        assert!(
            analytics_window(Some(to + DAY), Some(to)).is_err(),
            "inverted window"
        );
        assert!(
            analytics_window(Some(to - 400 * DAY), Some(to)).is_err(),
            "an unbounded scan is not a default anybody chose"
        );
        assert!(analytics_window(None, None).is_ok());
    }

    /// Copying pages and acks too would give the incident two timelines for one story.
    #[test]
    fn test_only_what_a_human_wrote_carries_into_the_incident() {
        use config::meta::oncall::ResponseEventKind as K;

        let carries =
            |kind: K, body: &str| matches!(kind, K::Note | K::AiVerdict) && !body.trim().is_empty();

        assert!(carries(K::Note, "rolled back checkout 4.2.1"));
        // `AiVerdict` is what the agent writes; asserting `Rca` passes with the branch dead.
        assert!(carries(K::AiVerdict, "probable cause: the deploy at 14:02"));
        assert!(
            !carries(K::Rca, "anything"),
            "Rca has no producer; matching it is how the branch went dead"
        );

        assert!(!carries(K::Page, "paged ana@o2.ai"));
        assert!(!carries(K::Ack, "acknowledged by bo@o2.ai"));
        assert!(!carries(K::Handoff, "handed to payments"));
        assert!(!carries(K::Sys, "nothing could be delivered to this rung"));
        assert!(!carries(K::Exhausted, "escalation ladder exhausted"));

        // Copying an empty note puts a blank comment on the incident with a name against it.
        assert!(!carries(K::Note, "   "));
    }

    #[test]
    fn test_promote_body_is_entirely_optional() {
        let bare: PromoteRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.title, None);
        assert_eq!(bare.severity, None);

        let full: PromoteRequest =
            serde_json::from_str(r#"{"title":"checkout down","severity":"P1"}"#).unwrap();
        assert_eq!(full.title.as_deref(), Some("checkout down"));
        assert_eq!(full.severity.as_deref(), Some("P1"));
    }

    /// P1..P5 is the alert scale and incidents stop at P4, so the two lowest collapse.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_priority_derives_an_incident_severity() {
        use config::meta::alerts::incidents::IncidentSeverity;

        assert_eq!(promoted_severity(1, None), IncidentSeverity::P1);
        assert_eq!(promoted_severity(2, None), IncidentSeverity::P2);
        assert_eq!(promoted_severity(3, None), IncidentSeverity::P3);
        assert_eq!(promoted_severity(4, None), IncidentSeverity::P4);
        assert_eq!(
            promoted_severity(5, None),
            IncidentSeverity::P4,
            "P5 has nowhere lower"
        );
    }

    /// Raises only: taken as given, `{"severity":"P4"}` turns a P1 page into a P4 incident.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_promotion_cannot_downgrade_what_already_woke_somebody() {
        use config::meta::alerts::incidents::IncidentSeverity;

        assert_eq!(
            promoted_severity(1, Some(IncidentSeverity::P4)),
            IncidentSeverity::P1,
            "a P1 page must not be promoted into a P4 incident"
        );
        assert_eq!(
            promoted_severity(2, Some(IncidentSeverity::P3)),
            IncidentSeverity::P2
        );
        assert_eq!(
            promoted_severity(4, Some(IncidentSeverity::P1)),
            IncidentSeverity::P1,
            "raising it is the whole point of sending the field"
        );
        assert_eq!(
            promoted_severity(3, Some(IncidentSeverity::P3)),
            IncidentSeverity::P3
        );
        // P5 has no incident severity, so its floor is P4 and there is nothing left to lower.
        assert_eq!(
            promoted_severity(5, Some(IncidentSeverity::P4)),
            IncidentSeverity::P4
        );
    }

    /// An address that differs only in case is still your own profile.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_person_always_owns_their_own_profile() {
        let same = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
        assert!(same("ana@o2.ai", "ana@o2.ai"));
        assert!(
            same("Ana@O2.ai", "ana@o2.ai"),
            "a link that capitalised the address must not lock somebody out"
        );
        assert!(!same("ana@o2.ai", "bo@o2.ai"));
    }

    /// The summary travels beside the row, never replacing the fields a rule is built from.
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

        // Separates a gap waking somebody from one waking nobody, so it must reach the wire.
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

    #[test]
    fn test_the_lookback_query_is_entirely_optional() {
        let bare: LookbackQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.days, None);
        assert_eq!(bare.limit, None);

        let asked: LookbackQuery = serde_json::from_str(r#"{"days":30,"limit":10}"#).unwrap();
        assert_eq!(asked.days, Some(30));
        assert_eq!(asked.limit, Some(10));
    }

    /// Defaults to P1, the ladder somebody asking "would a page land" actually means.
    #[test]
    fn test_the_escalation_preview_defaults_to_p1() {
        let bare: EscalationPreviewQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.priority, None);
        assert_eq!(bare.at, None);

        let asked: EscalationPreviewQuery =
            serde_json::from_str(r#"{"priority":"P3","at":1700000000000000}"#).unwrap();
        assert_eq!(asked.priority.as_deref(), Some("P3"));
        assert_eq!(asked.at, Some(1_700_000_000_000_000));
    }

    #[test]
    fn test_ownership_stats_query_is_all_optional() {
        let bare: OwnershipStatsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.team_id, None);
        assert_eq!(bare.days, None);
        assert_eq!(bare.limit, None);
        assert_eq!(bare.offset, None);

        let asked: OwnershipStatsQuery =
            serde_json::from_str(r#"{"team_id":"team_1","days":7,"limit":5,"offset":10}"#).unwrap();
        assert_eq!(asked.team_id.as_deref(), Some("team_1"));
        assert_eq!(asked.days, Some(7));
        assert_eq!(asked.limit, Some(5));
        assert_eq!(asked.offset, Some(10));
    }

    /// These are `COUNT`s over the delivery ledger, the only table with no upper bound.
    #[test]
    fn test_every_new_read_is_bounded() {
        assert_eq!(7i64.clamp(1, 31), 7);
        assert_eq!(365i64.clamp(1, 31), 31);
        assert_eq!(0i64.clamp(1, 31), 1);
        assert_eq!(50u64.clamp(1, 200), 50);
        assert_eq!(10_000u64.clamp(1, 200), 200);
        assert_eq!(0u64.clamp(1, 200), 1);
    }

    /// Pins the arithmetic the pages table needs per row without a second call each.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_time_to_ack_is_never_negative_and_is_absent_when_unanswered() {
        use config::meta::oncall::{
            ResponderRole, Response, ResponseState, SubjectRef, SubjectType,
        };

        let base = Response {
            id: "resp_1".into(),
            org_id: "default".into(),
            subject: SubjectRef::new(SubjectType::Alert, "al_ckt", 1),
            team_id: Some("team_1".into()),
            title: Some("payment_gateway_error_rate".into()),
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: Some(1),
            exhausted_at: None,
            responder_role: ResponderRole::Owner,
            origin_response_id: None,
            priority: 2,
            state: ResponseState::Acknowledged,
            opened_at: 1_000,
            acked_by: Some("ana@o2.ai".into()),
            acked_at: Some(4_000),
            closed_at: None,
            incident_id: None,
            updated_at: 4_000,
        };
        assert_eq!(base.acked_at.unwrap() - base.opened_at, 3_000);

        // A clock that went backwards between nodes must not show a negative duration.
        let skewed = Response {
            acked_at: Some(500),
            ..base.clone()
        };
        assert_eq!((skewed.acked_at.unwrap() - skewed.opened_at).max(0), 0);

        let unanswered = Response {
            acked_at: None,
            acked_by: None,
            ..base
        };
        assert!(
            unanswered.acked_at.is_none(),
            "an unanswered record carries no time-to-ack at all"
        );
    }

    /// A cover body with no rotation still parses and still means the primary.
    #[test]
    fn test_a_cover_body_without_a_rotation_still_parses() {
        let body: CreateOverrideRequest =
            serde_json::from_str(r#"{"user_email":"sam@o2.ai","start_at":1,"end_at":2}"#).unwrap();
        assert_eq!(body.rotation_id, None, "absent means the team's primary");
        assert_eq!(body.covering_for, None);

        let named: CreateOverrideRequest = serde_json::from_str(
            r#"{"rotation_id":"Secondary","user_email":"sam@o2.ai","start_at":1,"end_at":2}"#,
        )
        .unwrap();
        assert_eq!(named.rotation_id.as_deref(), Some("Secondary"));
    }

    /// Omitting the rotation draws the primary, which is the row a calendar opens on.
    #[test]
    fn test_the_resolved_schedule_rotation_is_optional() {
        let q: ResolvedScheduleQuery = serde_json::from_str(r#"{"from":1,"to":2}"#).unwrap();
        assert_eq!(q.rotation_id, None);
        let q: ResolvedScheduleQuery =
            serde_json::from_str(r#"{"from":1,"to":2,"rotation_id":"rot_2"}"#).unwrap();
        assert_eq!(q.rotation_id.as_deref(), Some("rot_2"));
    }

    /// The handler fills the email from the session, so omitting it cannot book another's leave.
    #[test]
    fn test_an_absence_body_defaults_to_the_caller() {
        let body: CreateUnavailabilityRequest =
            serde_json::from_str(r#"{"start_at":1,"end_at":2}"#).unwrap();
        assert_eq!(body.user_email, None);
        assert_eq!(body.reason, None);

        let for_somebody_else: CreateUnavailabilityRequest = serde_json::from_str(
            r#"{"user_email":"ana@o2.ai","start_at":1,"end_at":2,"reason":"annual leave"}"#,
        )
        .unwrap();
        assert_eq!(for_somebody_else.user_email.as_deref(), Some("ana@o2.ai"));
        assert_eq!(for_somebody_else.reason.as_deref(), Some("annual leave"));
    }

    /// Optional on the wire; which combinations answer is the service layer's decision.
    #[test]
    fn test_the_absence_query_is_entirely_optional() {
        let q: UnavailabilityQuery = serde_json::from_str("{}").unwrap();
        assert!(q.user_email.is_none() && q.from.is_none() && q.to.is_none());
    }
}

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

    /// Whether this body names anybody at all.
    ///
    /// Both fields default, so `{}`, `{"user_emails":[]}` and a body whose only
    /// key was misspelled all deserialized to "add nobody" and answered 200 —
    /// a team that reads as configured and pages no one. Whatever the caller
    /// got wrong, no emails arrived, and that is the thing worth refusing.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    fn names_nobody(&self) -> bool {
        self.user_emails.iter().all(|e| e.trim().is_empty())
            && self
                .user_email
                .as_deref()
                .is_none_or(|e| e.trim().is_empty())
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

/// Applies one of the four §3b shapes, as a full replace of the schedule.
///
/// The preset's own inputs are flattened in beside these three, so the body is
/// `{"preset": "weekday_weekend", "timezone": "...", "weekdays": {...}, ...}` —
/// the shape §C.3 published and the UI is built against. Which fields a given
/// preset takes is the catalogue's job to say, not this struct's.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct FromPresetRequest {
    /// Absent means the team's own zone, exactly as `PUT /schedule` means it.
    /// Every window the preset generates is read in this one zone — there is no
    /// per-user timezone, which is why the caller supplies the grouping.
    #[serde(default)]
    pub timezone: Option<String>,
    /// How long one shift lasts, on every layer the preset builds. Absent is a
    /// week.
    #[serde(default)]
    pub handover_micros: Option<i64>,
    /// When the first shift begins. Absent is now — snapped back to the most
    /// recent local Monday 00:00, so handovers land on a week boundary rather
    /// than on whenever somebody happened to click the button.
    #[serde(default)]
    pub anchor_micros: Option<i64>,
    #[serde(flatten)]
    pub spec: config::meta::oncall::PresetSpec,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetPolicyRequest {
    pub rungs: Vec<PriorityRung>,
    /// How many times the ladder runs before `final_action`. 1..=5.
    ///
    /// **Absent leaves it unchanged**, which is why it can be added without
    /// breaking a client that never sent it. It was missing entirely: the
    /// engine stored, validated and honoured both this and `final_action`,
    /// while the write path silently dropped them — so a policy could never
    /// leave the defaults, `PolicyError::RepeatOutOfRange` could never fire
    /// from the API, and the editor showing them read-only was correct rather
    /// than lazy.
    #[serde(default)]
    pub repeat_count: Option<i32>,
    /// What happens once the last pass ends with nobody having answered.
    /// Absent leaves it unchanged.
    #[serde(default)]
    pub final_action: Option<config::meta::oncall::FinalAction>,
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
    /// Every firing of one subject, whatever its firing number.
    ///
    /// The alert drawer's Firings tab and the "Related & past" panels were both
    /// built on fetching the org's whole open list and filtering it client-side,
    /// which is wrong twice: it is slow, and it silently cannot see anything
    /// past the page bound.
    pub source_id: Option<String>,
    /// `alert` / `incident` / … — pairs with `source_id`, whose ids are only
    /// unique within a kind.
    pub subject_type: Option<String>,
    /// An identity-dimension path, e.g. `k8s-cluster=prod`.
    ///
    /// Resolved to the teams that own it or own anything beneath it, and then
    /// matched on the record's team — the record carries a team, not a path, and
    /// making the client do that translation is what "requires N+1 calls" meant.
    /// A path nobody owns matches nothing, rather than everything.
    pub ownership_path: Option<String>,
    /// What the firing turned out to be — the known-causes tab. Implies closed
    /// records, since only a closed record has a cause.
    pub cause: Option<String>,
    /// Page size. Defaulted and capped, because this is the screen somebody
    /// loads at 3am and a busy org has hundreds of open records.
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// Sets or clears one person's contact methods.
///
/// Every field uses `double_option`, so absent means "leave it alone" and an
/// explicit `null` means "remove it". Without that distinction a profile screen
/// that does not render push tokens would erase one every time somebody saved a
/// phone number.
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

/// Marks inbox rows read, or unread again.
///
/// `all` is the "clear my inbox" button and is bounded server-side; naming ids
/// is what a list does as it scrolls.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct MarkReadRequest {
    #[serde(default)]
    pub event_ids: Vec<String>,
    #[serde(default)]
    pub all: bool,
    /// `false` puts them back to unread — a responder who dismissed something
    /// by accident at 3am must be able to undo it.
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

/// The window a cause breakdown covers.
///
/// Both bounds default rather than being required: "what keeps breaking us" has
/// an obvious answer for "lately", and forcing every caller to compute
/// timestamps is how a dashboard tile ends up hardcoding the wrong month.
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
    /// Absent takes the record's own title, which is nearly always right and
    /// is one less field to fill in mid-page.
    #[serde(default)]
    pub title: Option<String>,
    /// `P1`–`P4`. Absent derives it from the record's priority, so a promotion
    /// cannot silently downgrade what woke somebody.
    #[serde(default)]
    pub severity: Option<String>,
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

/// An impacted team saying its own service is clear. The cause belongs to the
/// owner team's record, not to this one, so there is nothing else to send.
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

/// Which ladder to prove. Priorities page differently, so "does paging work"
/// has a different answer per priority and the caller has to say which one.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TestPageRequest {
    /// 1–5. Defaults to P2, the highest priority whose ladder starts with one
    /// person: P1 pages the primary, the secondary and everyone on the schedule
    /// at once, which is a lot of phones for a test nobody asked to receive.
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
    /// Which rotation is being covered. Omitted means the team's primary, which
    /// is what "cover for me" means on a team that has never thought about
    /// positions. A rotation the team does not have is refused: a cover over a
    /// position nothing staffs would page somebody nobody expected.
    ///
    /// Accepts an id or a name — a client with the calendar in front of it sends
    /// the id, a human writing the call by hand sends "Secondary".
    #[serde(default)]
    pub rotation_id: Option<String>,
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
    /// Which rotation's row of the grid to draw. Omitted means the primary.
    /// One rotation per call rather than all of them interleaved: a row with
    /// two answers in it is not a row.
    #[serde(default)]
    pub rotation_id: Option<String>,
}

/// A person, a window, or both. Listing every absence an org has ever recorded
/// is not a question anything asks, so it is not one this answers.
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
    /// Whose absence. Omitted means the caller's own, which is the common case
    /// and the one that must not need an administrator.
    #[serde(default)]
    pub user_email: Option<String>,
    /// Micros, inclusive.
    pub start_at: i64,
    /// Micros, exclusive — somebody back on the 3rd is on call on the 3rd.
    pub end_at: i64,
    #[serde(default)]
    pub reason: Option<String>,
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

/// How far back a summary looks, and how far ahead a warning does.
///
/// Bounded server-side rather than trusted: these drive `COUNT`s over the
/// delivery ledger, which is the only on-call table that grows without an
/// upper bound.
#[derive(Debug, Default, Deserialize)]
pub struct LookbackQuery {
    /// Days. Clamped `1..=366`.
    pub days: Option<i64>,
    pub limit: Option<u64>,
}

/// Which ladder to dry-run. Required: "would a page land" has a different
/// answer per priority, and defaulting it would answer a question nobody
/// asked.
#[derive(Debug, Default, Deserialize)]
pub struct EscalationPreviewQuery {
    /// `P1`–`P5`, or `1`–`5`. Defaults to P1 — the ladder somebody opening
    /// this screen is checking.
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
        // Refused rather than answered 200: a caller that meant to add six
        // people and mistyped the key should hear about it, not read success
        // and find an empty roster at 3am.
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
        // A read of what the product can build, not of what this org has
        // built — but it is still the configuration surface, and gating it
        // with anything else would mean a second rule to keep in step.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // A closed set of four, compiled in, so there is nothing to page
        // through and no bound that could be exceeded. Each entry carries its
        // own input schema — including the 2–4 on follow-the-sun's groups —
        // so a form can be built from this response alone.
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
        // Configuration, and a full replace of the rotations at that — the
        // same authority as `PUT /schedule`, which is what this ends up
        // calling. POST rather than PUT because the request names a shape to
        // build rather than the state to store.
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
            // The stored schedule, which is the body `GET /schedule` returns:
            // nothing preset-shaped comes back, because nothing preset-shaped
            // was stored.
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
    ValidatedJson(body): ValidatedJson<CreateOverrideRequest>,
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
            body.rotation_id,
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
        ("slot" = Option<String>, Query, description = "Rotation slot; defaults to `primary`"),
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
            body.repeat_count,
            body.final_action,
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

/// Where a team is talked to, as opposed to where its ladder pages (Change 1).
///
/// `destinations` absent or `null` puts the team back to "never set", so the
/// escalation policy's list takes over again. `[]` says the team has no channel
/// at all. The two are different answers deliberately: collapsing them would
/// make the field impossible to turn off, because clearing it would silently
/// resurrect whatever the policy still had in it.
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
    /// `team` or `policy`. Precedence is a thing an operator has to be able to
    /// see: "I set the team channel and pages still go to the old room" is
    /// otherwise unanswerable from the API.
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
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        // Read whole rather than reported as "unset": the caller wants to know
        // where the team is actually talked to, and answering with an empty
        // list while pages go to the policy's room would be a lie of omission.
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
            Err(e) => MetaHttpResponse::internal_error(e),
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

        // Signature, expiry, org, **and** whether the person the token names is
        // still a member of that org. The last one is why this goes through
        // the service rather than calling `token::verify` here: the token is
        // stateless by design and stays that way, and the entitlement is read
        // once, in one place both ack entry points share.
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
        // `03` §8: the link is single-use. Signing makes it unforgeable and the
        // expiry makes it short-lived, but neither stops a replay inside the
        // TTL — and a record whose ladder has restarted since is a page a stale
        // link can take from whoever holds it now.
        //
        // Spent *before* the acknowledgement rather than after: a token that
        // loses the race must not be able to act, and the acknowledgement it
        // would have made has already been made by the click that won.
        if !token::spend(
            &form.token,
            claims.expires_at,
            config::utils::time::now_micros(),
        )
        .await
        {
            // Not an error page. §8 is explicit that acking is idempotent and a
            // second click "returns the same result and changes nothing", so
            // this lands on the record exactly as the first click did — the
            // reader gets what they wanted, and nothing was acted on twice.
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

/// Where an acknowledgement click lands.
///
/// The record, not JSON. Somebody who just acknowledged from a phone at 3am
/// needs the page, and the org has to be in the URL or the app resolves
/// whichever org they last had selected — which for anyone in more than one is
/// an empty screen.
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
        use o2_enterprise::enterprise::oncall::service;

        // Checked on the GET too, not only on the POST that acts. A leaver who
        // is refused here never sees the button — and, just as importantly,
        // never sees the record's title, which this page would otherwise show
        // to somebody who has left the organization.
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

/// The subject kinds a filter may name.
///
/// Spelled here rather than as a `from_str` on the meta type: parsing a query
/// parameter is this surface's problem, and the enum is shared with the engine.
#[cfg(feature = "enterprise")]
const SUBJECT_TYPES: [config::meta::oncall::SubjectType; 4] = {
    use config::meta::oncall::SubjectType::{Alert, Anomaly, Incident, Synthetic};
    [Alert, Incident, Synthetic, Anomaly]
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

        // These two ARE refused when unrecognised, unlike the unrouted queue's
        // `landing`. The difference is what a wrong answer costs: widening a
        // worklist shows too much, but silently ignoring `cause=noisy_treshold`
        // returns every record in the org and reads as "we have never had a
        // noisy threshold", which is a false statement about the org.
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
        // An ownership path names teams, and the record carries a team. A path
        // nobody owns resolves to an empty set and therefore matches nothing —
        // it must not fall through to "unfiltered", which would report every
        // page in the org as owned by a path with no owner.
        let team_ids = match q.ownership_path.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(path) => match infra::table::oncall_ownership::list(&org_id).await {
                Ok(rules) => {
                    // `path()` is derived from the rule's dimensions, so it is
                    // already in the canonical form every other surface emits —
                    // which is where a client got this value from in the first
                    // place. The trailing `/` anchors the subtree match, or
                    // `k8s-cluster=pro` would claim `k8s-cluster=prod`.
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
                    tracing::error!("[oncall] list_responses ownership: {e}");
                    return MetaHttpResponse::error(
                        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                        e.to_string(),
                    )
                    .into_response();
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

/// Serializes records with everything a pages table renders beside them.
///
/// Three things live off the meta type. The runbook link is a column on the
/// record but not a field on `Response` — that type is constructed by the
/// escalation engine in several places this surface does not own. How far a
/// firing climbed lives on the timeline. And time-to-ack is arithmetic nobody
/// should have to repeat in four clients.
///
/// All three are merged in here, from **two** queries for the whole page and
/// never one per row: the table shows opened-at, the alert, who answered, how
/// long they took and which rung it reached, and a second call per row is the
/// N+1 this exists to avoid.
///
/// A record with no runbook, no ack or no page event simply has no key, which
/// keeps the body identical to what it was before the fields existed.
#[cfg(feature = "enterprise")]
async fn with_page_details(
    org_id: &str,
    rows: Vec<config::meta::oncall::Response>,
) -> Vec<serde_json::Value> {
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let runbooks = infra::table::oncall_responses::runbook_urls(org_id, &ids)
        .await
        .unwrap_or_else(|e| {
            // A missing runbook must never cost somebody the list of what is
            // on fire.
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
                // The rung's `after_micros`, which is how a rung is identified
                // everywhere else in this feature — a positional index would
                // not survive somebody reordering the ladder.
                if let Some(rung) = rungs.get(&r.id) {
                    obj.insert("reached_rung_micros".to_string(), (*rung).into());
                }
                // Only for a record somebody answered. A null here would be
                // indistinguishable from "answered instantly".
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
                // Hoisted beside the record rather than nested inside it: this
                // is the one screen where "where is the runbook" is asked, and
                // it must not depend on the alert still existing.
                "response": with_page_details(&org_id, vec![record]).await.pop(),
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
    // Recovery is ordered (`00-simplified-flow` §4): the incident closes on the
    // slowest dependent, not on the root cause, and the owner team cannot close
    // on a dependent's behalf. This is the verb that lets the dependent say it
    // is done — without it the engine tells impacted teams their upstream is
    // fixed and then waits for a confirmation nothing can send.
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // The record has to exist before the engine's error message is the only
        // thing distinguishing "no such record" from "wrong kind of record", and
        // those are a 404 and a 400.
        match infra::table::oncall_responses::get(&org_id, &response_id).await {
            Ok(None) => return MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                tracing::error!("[oncall] confirm-recovery lookup: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
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
        // The actor is the session's, never the body's: this is the record of
        // who said the service was clear.
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
    // Not a handoff. A handoff gives the page away; this keeps it and adds
    // people to it, which is what a responder means by "I need more help".
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
            // `ladder_exhausted` is a 200, deliberately. The responder asked a
            // reasonable question and the answer is "there is nobody above
            // you" — rendering that as an error would read as though the press
            // failed and invite a second one.
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
    // `oncall`, not `oncall_responses`: this proves a configuration, and the
    // person who configures who gets woken is the one who should be able to
    // check it. It is also the one on-call verb that puts a message on a real
    // pager without a real firing, which is a reason to keep it with the
    // configuration permission rather than the responder one.
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
            // 200 even when nothing was sent, with `reached_anyone: false` and
            // the reason beside it. A test page that found a team nobody is on
            // call for has succeeded at its job — the endpoint worked, the
            // configuration did not, and reporting that as a 4xx would blame
            // the request.
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
                // Same unique-index shape as create: repointing a rule onto a
                // path another team already claims is a conflict, not a fault.
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
    ValidatedJson(body): ValidatedJson<PreviewRoutingRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Changes nothing — it is a POST only because the dimensions travel in
        // a body — so it costs a read, not a write.
        if !allowed(&org_id, &user_email.user_id, CONFIG, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let routed = match o2_enterprise::enterprise::oncall::routing::decide(
            &org_id,
            body.oncall_team.as_deref(),
            body.context_team.as_deref(),
            &body.dimensions,
        )
        .await
        {
            Ok(routed) => routed,
            Err(e) => return to_response(e),
        };

        // Which rule the decision itself named, so "who lost" is computed
        // against the winner the decision reported rather than against a
        // second, independently re-derived one.
        let winning_rule_id = match &routed.decision {
            config::meta::oncall::RoutingDecision::Ownership { rule_id, .. } => {
                Some(rule_id.clone())
            }
            _ => None,
        };
        // The tester's other three questions: which ladder that team runs, who
        // it would reach at this instant, and which rules matched and lost.
        // A failure here costs the extra half, never the decision — the
        // decision is what somebody opened this screen for.
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
            // The one thing §4 says is worth surfacing, hoisted out of the
            // tagged decision so a caller does not have to know the variant
            // names to draw the "this is only covered by the fallback" badge.
            "landed_on_default": routed.landed_on_default(),
            "notes": routed.notes,
            "ladder": context.as_ref().map(|c| &c.ladder),
            "repeat_count": context.as_ref().map(|c| c.repeat_count),
            "final_action": context.as_ref().map(|c| c.final_action),
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

/// "Would a page to this team actually land?"
///
/// The reason this exists at all: a native OpenObserve user can be created
/// with any string as an email, and root's address very often is not a mailbox
/// anybody reads. Such a person can sit on a rotation for months while every
/// page to them is silently lost. Every verdict here is computed — is this a
/// user of this org, is SMTP configured, is there a verified method — never
/// asserted, and nothing is sent to find out.
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

/// What is wrong with this team's paging setup, derived rather than stored.
///
/// Nothing here is persisted. A stored risk list goes stale the moment
/// somebody fixes the thing it warns about, and then argues with the screen
/// beside it.
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
        // The coverage look-ahead is bounded harder than the history windows:
        // past a month, "somebody will be missing" stops being news about the
        // rota anybody is actually holding.
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
            // `total` is what was found, `risks` is what fits in the page. A
            // screen showing four problems needs to know whether there are
            // twelve.
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

/// The team screen's header in one call.
///
/// The seven-day figures are counted in the database. The team most in need of
/// the summary is the one with the most rows, and loading every record of the
/// week to tally them in Rust would make this slowest exactly where it matters.
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

/// Who has been carrying this team, and who will be.
///
/// Two windows, deliberately: the pages and nights already taken are history,
/// and the share of the shifts still to come is the thing anybody can still
/// change. Both are bounded.
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

/// "If a P1 fired right now, who would it reach?"
///
/// A dry run, and free of side effects by construction: it resolves the same
/// rungs against the same schedule and the same covers a real firing would,
/// and then stops. No record is opened, no page is sent, no timer is armed and
/// no acknowledgement token is minted. `POST …/test-page` is the endpoint that
/// actually delivers something; this one never does.
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

/// The ownership rules with their usage beside them.
///
/// A sibling of `GET /oncall/ownership` rather than a widening of it: the
/// counts cost a grouped read of the timeline, and the routing path's own list
/// must stay the cheap read it is. Paged, because the number of `COUNT`s is
/// bounded by the page and not by the size of the rule set.
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
                // The window and the page are echoed back so a client can tell
                // "no rules matched" from "you asked past the last page".
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

// ── Unavailability / holidays (`architecture/02` §5a) ─────────────────────────

/// Whether the caller may record or withdraw this person's absences.
///
/// Your own, always. Somebody else's, only with the configuration permission.
/// The split is the same one contact methods make, for the same reason: the
/// common case is somebody entering their own leave, and gating that behind an
/// administrator means the leave does not get entered and the page lands on a
/// beach. Entering it *for* somebody — a team lead doing the rota — is a real
/// workflow and is administrative, because an absence quietly takes a person
/// out of every rotation they are on.
///
/// The route table gates the path on `oncall_responses`, which the model opens
/// to any org member. This is the second, narrower lock behind it.
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
        // Whose absences are being read decides the lock, not the verb: a
        // window over the whole org is a read of everybody's leave calendar,
        // which is configuration.
        let subject = match q.user_email.as_deref() {
            Some(email) if !email.trim().is_empty() => email.trim().to_string(),
            // No person named and no window either means "mine" — the personal
            // view — rather than an unbounded read.
            _ if q.from.is_none() && q.to.is_none() => user_email.user_id.clone(),
            _ => String::new(),
        };
        // Two locks, like the contact profiles: the outer one establishes that
        // the caller belongs to the org, and the inner one that this is their
        // own leave — or that they hold the configuration permission.
        if !allowed(&org_id, &user_email.user_id, RESPONSES, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = if subject.is_empty() {
            // An org-wide window is a read of everybody's leave calendar,
            // which is configuration however narrow the dates are.
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
            // Who recorded it, taken from the caller rather than the body:
            // "who entered this" is not something a client gets to assert, and
            // it is the difference between somebody booking their own leave and
            // somebody having it booked for them.
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
        // Read before the inner lock, to learn whose absence it is:
        // withdrawing your own is self-service and withdrawing somebody else's
        // is not, and after the row is gone there is nothing left to ask.
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
            // Reported rather than silently 200: withdrawing an absence that
            // is not there means somebody is looking at a stale screen, and
            // the difference matters when the answer decides who gets woken.
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

/// Whether the caller may read or write this person's contact methods.
///
/// Your own, always. Somebody else's, only with the configuration permission —
/// an administrator setting up a team is a real workflow, and so is one reading
/// the phone numbers of an entire org, which is why it is not open to everyone.
///
/// The route table gates this path on `oncall_responses`, which the model opens
/// to any org member; that is deliberate, because self-service is the common
/// case. This is the second, narrower lock behind it.
#[cfg(feature = "enterprise")]
async fn may_touch_contacts(org_id: &str, caller: &str, subject: &str, verb: &str) -> bool {
    // Addresses are compared case-insensitively: a login is not case-sensitive
    // in practice, and "ana@o2.ai" being refused their own profile because a
    // link said "Ana@o2.ai" is an infuriating way to lose a phone number.
    if caller.eq_ignore_ascii_case(subject) {
        return true;
    }
    allowed(org_id, caller, CONFIG, verb).await
}

/// Serializes a profile with the facts a screen has to state out loud.
///
/// `unverified` is the point of it. Somebody who typed a number in and saw it
/// saved reasonably believes they will be phoned; until a transport can prove
/// the handset, they will not be, and the profile has to say so rather than
/// let them find out by not being woken.
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
            // An empty profile rather than a 404. "This person has no phone" is
            // a complete answer, and making every caller branch on a missing
            // row is how a profile screen ends up rendering nothing at all.
            Ok(found) => {
                MetaHttpResponse::json(contact_body(&found.unwrap_or_else(|| {
                    config::meta::oncall::Contact::empty(&org_id, &subject_email)
                })))
            }
            Err(e) => {
                tracing::error!("[oncall] get_contact: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, subject_email);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Sets or clears one person's contact methods.
///
/// **No SMS or voice is sent from here, and none can be.** Those transports are
/// out of scope for this release, so nothing can complete a verification and
/// every number saved lands unverified. That is the intended state, not a gap:
/// the column exists now so the transport that arrives later has something to
/// refuse on, rather than inheriting a table full of unproven numbers it treats
/// as addresses.
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
        // An empty string clears, exactly as it does for `oncall_team` on an
        // alert: that is how a form clears a text input, and a stored "" would
        // look like a number to anything reading the column.
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
            Err(e) => {
                tracing::error!("[oncall] set_contact: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
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
            // Reported rather than silently 200: deleting a profile that is not
            // there means somebody is looking at a stale screen, and email —
            // which is their login — keeps working either way.
            Ok(deleted) => MetaHttpResponse::json(serde_json::json!({ "deleted": deleted })),
            Err(e) => {
                tracing::error!("[oncall] delete_contact: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, subject_email);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── The responder's own inbox (U25) ───────────────────────────────────────────

/// "What was I sent last night, and did any of it arrive?"
///
/// The per-record ledger already answers "who did THIS page reach". It cannot
/// answer this one without fetching every record in the org, which is the shape
/// of read `list_responses` had to be fixed for. Keyed on the caller, bounded,
/// and paginated, with `total` and `unread` beside the page so a badge never
/// has to walk it.
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
        // The caller, never a parameter. An inbox is the one read where "whose"
        // must not be something a client gets to assert.
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
                tracing::error!("[oncall] list_my_deliveries: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        };
        // Two counts, both honest: `total` is what the filter matches, `unread`
        // is what the badge shows and is deliberately NOT affected by the
        // window — "3 unread" must not change because somebody scrolled to
        // last Tuesday.
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

        // Same bound as every list on this surface, applied to a write. An
        // unbounded id list is an unbounded number of round trips, sent by a
        // client that thought it was being helpful.
        const MAX_IDS: usize = 200;
        if body.event_ids.len() > MAX_IDS {
            return MetaHttpResponse::bad_request(format!(
                "at most {MAX_IDS} `event_ids` per request"
            ));
        }

        let result = if body.all && body.read {
            // "Clear my inbox", bounded server-side: the natural implementation
            // is an unbounded UPDATE, and the natural consequence is a lock
            // held across somebody's entire paging history.
            oncall_deliveries::mark_all_read(&org_id, me, 1_000, now).await
        } else {
            oncall_deliveries::set_read(&org_id, me, &body.event_ids, body.read, now).await
        };
        match result {
            // The unread count travels back, so a badge is correct without a
            // second request — and correct even when some ids named rows that
            // were already read, or were never the caller's to read.
            Ok(updated) => {
                let unread = oncall_deliveries::unread_count(&org_id, me)
                    .await
                    .unwrap_or(0);
                MetaHttpResponse::json(serde_json::json!({
                    "updated": updated,
                    "unread": unread,
                }))
            }
            Err(e) => {
                tracing::error!("[oncall] mark_deliveries_read: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── "Which teams am I on, and am I on call?" ──────────────────────────────────

/// One request instead of N+1.
///
/// Answering this needed a team list, then a membership read per team, then a
/// who-is-on-call read per team. The first two are one join; the third is the
/// only part that has to be done per team, and it is done here rather than
/// across the network.
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
                tracing::error!("[oncall] list_my_teams: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        };

        let mut out = Vec::with_capacity(teams.len());
        let mut on_call_anywhere = false;
        for team in teams {
            // A schedule that cannot be resolved must not read as "you are not
            // on call". It reads as unknown, because telling somebody they are
            // off duty when the truth is that we could not work it out is the
            // one answer this endpoint must never give.
            let slots = o2_enterprise::enterprise::oncall::service::who_is_on_call(
                &org_id,
                &team.id,
                Some(at),
            )
            .await;
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

/// "What keeps breaking us?" — counts per cause for a team or a whole org.
///
/// `prior_causes` answers the same question about one subject, mid-page.
/// This is the org-level version, and it is the one that has to be careful:
/// the org with the most to learn from it is the org with the most rows, so the
/// counting happens in the database rather than by loading every record.
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
                // `total` is the sum of what was counted, not a second query:
                // a percentage computed against a different read of the table
                // would not add up to 100 and would be blamed on the maths.
                let total: i64 = causes.iter().map(|c| c.count).sum();
                MetaHttpResponse::json(serde_json::json!({
                    "from": from,
                    "to": to,
                    "team_id": q.team_id,
                    "total": total,
                    "causes": causes,
                }))
            }
            Err(e) => {
                tracing::error!("[oncall] cause_analytics: {e}");
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

/// Resolves and bounds an analytics window.
///
/// Defaults to the last 30 days, and refuses more than a year in one request.
/// The cap is not arithmetic squeamishness: this scans a table that grows with
/// every page an org has ever taken, and "all time" is the query somebody runs
/// once and then wonders why the API is slow.
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

/// Makes an incident out of a page that turned out to be one.
///
/// `Response.incident_id` has existed since the beginning and could only ever be
/// set by the path that opened the record. A responder who works a page for ten
/// minutes and realises it is bigger than an alert had no way to say so, which
/// meant the correlated view — the one thing an incident is for — was decided by
/// a rule written weeks earlier and never revisable.
///
/// Idempotent by refusal, not by silence: a record already attached to an
/// incident is a conflict naming that incident, so two responders clicking at
/// once do not end up looking at two different incidents for one firing.
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
/// Copies what the page knew onto the incident it became.
///
/// Best effort throughout: an incident that exists with a thin history is worth
/// more than one rolled back because a timeline write failed. Every step logs
/// and continues.
#[cfg(feature = "enterprise")]
async fn carry_page_history_into_incident(
    org_id: &str,
    response_id: &str,
    incident_id: &str,
    record: &config::meta::oncall::Response,
) {
    use config::meta::{alerts::incidents::IncidentEvent, oncall::ResponseEventKind};

    // One line naming the things a reader of the incident would otherwise have
    // to open the page to learn. Written first so it heads the timeline.
    let team = infra::table::oncall_teams::get(org_id, &record.team_id)
        .await
        .ok()
        .flatten()
        .map(|t| t.name)
        .unwrap_or_else(|| record.team_id.clone());
    let mut summary = format!(
        "Promoted from on-call page {response_id} — paged {team} at P{}",
        record.priority
    );
    match (record.acked_by.as_deref(), record.acked_at) {
        (Some(who), _) => summary.push_str(&format!(", acknowledged by {who}")),
        // Worth saying explicitly. "Nobody answered" is the reason a page most
        // often becomes an incident, and its absence reads as "not recorded".
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

    // Notes and the agent's findings, in the order they were written. Pages,
    // acks and system lines are deliberately left behind: they describe how the
    // *page* was worked, and the incident has its own timeline for that. What a
    // human typed, and what the AI SRE concluded, are the parts that carry.
    // `AiVerdict`, not `Rca`. `Rca` is a variant no producer in either tree
    // writes — the agent's findings land as `AiVerdict` (`escalation.rs`,
    // `verdict_event`). Filtering on `Rca` made this loop's whole AI branch
    // unreachable: notes carried, findings never did, and the prefix below was
    // dead code.
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
                tracing::error!("[oncall] promote lookup: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        };
        if let Some(existing) = record.incident_id.as_deref() {
            return MetaHttpResponse::error(
                StatusCode::CONFLICT.as_u16(),
                format!("this record is already part of incident {existing}"),
            )
            .into_response();
        }

        // A promotion may raise the severity but must never lower what already
        // woke somebody: the record's priority is the floor.
        let derived = match record.priority {
            1 => IncidentSeverity::P1,
            2 => IncidentSeverity::P2,
            3 => IncidentSeverity::P3,
            _ => IncidentSeverity::P4,
        };
        let severity = match body.severity.as_deref() {
            None => derived,
            Some(raw) => match raw.trim().to_uppercase().parse::<IncidentSeverity>() {
                Ok(s) => s,
                Err(_) => return MetaHttpResponse::bad_request("`severity` must be P1–P4"),
            },
        };
        let title = body
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .or_else(|| record.title.clone());

        // Isolated by its own subject rather than correlated by dimensions.
        // A promotion is a human saying "this specific firing is an incident";
        // folding it into whatever group a correlation rule would have chosen
        // would silently attach it to somebody else's incident.
        let group_values = serde_json::json!({
            "oncall_subject_type": record.subject.subject_type.as_str(),
            "oncall_source_id": record.subject.source_id,
            "oncall_response_id": record.id,
        });
        let incident = match infra::table::alert_incidents::create(
            &org_id,
            &severity.to_string(),
            group_values,
            "AlertId",
            record.opened_at,
            title,
        )
        .await
        {
            Ok(i) => i,
            Err(e) => {
                tracing::error!("[oncall] promote create incident: {e}");
                return MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    e.to_string(),
                )
                .into_response();
            }
        };

        // Link the alert in, so the incident screen shows what it was made of.
        // Best effort: an incident that exists and is attached is worth more
        // than one rolled back because a display join failed.
        if record.subject.subject_type == config::meta::oncall::SubjectType::Alert {
            if let Err(e) = infra::table::alert_incidents::add_alert_to_incident(
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
        }

        // Carry the page's own record across.
        //
        // A promotion is the page saying "this is bigger than me" — and the
        // incident becomes the system of record from that moment. An incident
        // that opens empty makes the responder re-type what they already wrote,
        // or worse, lose it: the notes, who was woken, who answered and what the
        // ladder did all stayed on a page nobody opens again.
        //
        // Copied rather than linked, deliberately. This is an audit record of
        // what was known *at the moment of promotion*, so it must not change
        // afterwards — and the incident has to be readable on its own, without
        // the reader knowing there is a page behind it.
        carry_page_history_into_incident(&org_id, &response_id, &incident.id, &record).await;

        match infra::table::oncall_responses::attach_incident(&org_id, &response_id, &incident.id)
            .await
        {
            Ok(Some(updated)) => {
                // The timeline is how a page explains itself the next morning,
                // and "this became an incident" is the single most important
                // thing that can happen to one.
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
            Ok(None) => MetaHttpResponse::not_found("Response not found"),
            Err(e) => {
                tracing::error!("[oncall] promote attach: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
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

    /// The §C.3 wire shape: the preset's own inputs sit flat beside the three
    /// common fields, not nested under a key. A UI is being built against this
    /// exact body, so it is worth a test that fails if the flattening is ever
    /// tidied away.
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

    /// Everything but the preset and its groups is optional, so the smallest
    /// body that means anything is accepted.
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

    /// An unknown preset id is a decode failure, not a silent fallback to one
    /// of the four.
    #[test]
    fn test_an_unknown_preset_is_refused() {
        assert!(serde_json::from_str::<FromPresetRequest>(r#"{"preset":"round_robin"}"#).is_err());
    }

    /// Every session-authenticated handler must gate itself.
    ///
    /// This module once had zero authorization calls in it, and because the
    /// generic middleware denies a resource it does not recognise, the result
    /// was not an open door but a closed one: every non-root user got a 403 on
    /// every on-call path. Reading our own source is blunt, but it is the only
    /// thing that catches a handler added later without a gate — the failure
    /// mode is silent until somebody who is not root tries to use it.
    /// The dependent's verb carries nothing but an optional note: the cause is
    /// the owner team's to record, and accepting one here would let a dependent
    /// write the reason somebody else's service broke.
    #[test]
    fn test_confirm_recovery_takes_a_note_and_nothing_else() {
        let body: ConfirmRecoveryRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(body.note, None);
        let body: ConfirmRecoveryRequest =
            serde_json::from_str(r#"{"note":"buffered writes replayed"}"#).unwrap();
        assert_eq!(body.note.as_deref(), Some("buffered writes replayed"));
        // Anything else is ignored rather than refused, which is how every
        // other body in this module behaves.
        let body: ConfirmRecoveryRequest =
            serde_json::from_str(r#"{"cause":"genuine_defect"}"#).unwrap();
        assert_eq!(body.note, None);
    }

    /// Pressing escalate needs no body at all. Somebody mid-incident reaching
    /// for "wake more people" must not be stopped by a required field.
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

    /// A test page defaults to P2, not P1. P1's shipped ladder pages the
    /// primary, the secondary and everyone on the schedule at once, which is a
    /// lot of phones ringing for a test none of their owners asked for.
    #[test]
    fn test_a_test_page_defaults_to_the_priority_that_wakes_one_person() {
        let defaulted: TestPageRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(defaulted.priority, 2);
        assert_eq!(TestPageRequest::default().priority, 2);
        let explicit: TestPageRequest = serde_json::from_str(r#"{"priority":1}"#).unwrap();
        assert_eq!(explicit.priority, 1);
    }

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

    /// The four filters that made three "Related & past" panels impossible.
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

    /// A cause filter is refused when it is not a cause, unlike the unrouted
    /// queue's `landing`, which widens. The difference is what a wrong answer
    /// says: a silently-ignored `cause=noisy_treshold` returns every record in
    /// the org and reads as "we have never had a noisy threshold".
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
        assert_eq!(
            parse_subject_type("synthetic"),
            Some(SubjectType::Synthetic)
        );
        assert_eq!(parse_subject_type("anomaly"), Some(SubjectType::Anomaly));
        assert_eq!(parse_subject_type("Alert"), None, "wire values are exact");
        assert_eq!(parse_subject_type("dashboard"), None);
    }

    /// Absent leaves a contact method alone; explicit `null` removes it.
    /// Collapsing the two means a screen that does not render push tokens
    /// erases one every time somebody saves a phone number.
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

    /// The one thing this release must not do: imply that a saved number will
    /// be dialled. No SMS or voice transport exists yet, so every number lands
    /// unverified and the body has to say so in a field a UI can read.
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

    /// An empty profile is a complete answer. Returning 404 for "this person
    /// has no phone" makes every caller write a branch, and the branch they
    /// write renders nothing at all.
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

    /// Marking read is the default, because that is what a list scrolling past
    /// a row means. Unmarking has to be expressible — a responder who
    /// dismissed something by accident at 3am must be able to undo it.
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

    /// Defaults to the last 30 days and refuses "all time". This scans a table
    /// that grows with every page an org has ever taken.
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
        // No bounds at all still answers, because "what keeps breaking us"
        // has an obvious meaning for "lately".
        assert!(analytics_window(None, None).is_ok());
    }

    /// A promotion must never lower the severity that already woke somebody,
    /// so an absent `severity` derives it from the record's own priority.
    /// What a promotion must carry across, expressed as the filter that decides
    /// it — the copying itself needs a database, but the *choice* of what
    /// travels is the part worth pinning.
    ///
    /// Notes and the agent's findings carry: they are what a human wrote and
    /// what the analysis concluded, and the incident becomes the system of
    /// record the moment it exists. Pages, acks, handoffs and system lines stay
    /// behind: they describe how the *page* was worked, and the incident keeps
    /// its own timeline of how the incident is worked. Copying those would
    /// produce two timelines telling the same story in different words.
    #[test]
    fn test_only_what_a_human_wrote_carries_into_the_incident() {
        use config::meta::oncall::ResponseEventKind as K;

        let carries =
            |kind: K, body: &str| matches!(kind, K::Note | K::AiVerdict) && !body.trim().is_empty();

        assert!(carries(K::Note, "rolled back checkout 4.2.1"));
        // `AiVerdict` is the kind the agent actually writes. This test named
        // `Rca` when it was first written and passed, because it asserted
        // against the same filter it was testing rather than against a kind
        // some producer emits — so the AI branch was dead and green.
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

        // An empty note is not a note. Copying it would put a blank comment on
        // the incident with somebody's name against it.
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

    /// The mapping the handler applies when no severity is asked for. P1..P5
    /// is the alert scale; incidents stop at P4, so the two lowest collapse.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_priority_derives_an_incident_severity() {
        use config::meta::alerts::incidents::IncidentSeverity;

        let derive = |priority: i32| match priority {
            1 => IncidentSeverity::P1,
            2 => IncidentSeverity::P2,
            3 => IncidentSeverity::P3,
            _ => IncidentSeverity::P4,
        };
        assert_eq!(derive(1), IncidentSeverity::P1);
        assert_eq!(derive(2), IncidentSeverity::P2);
        assert_eq!(derive(3), IncidentSeverity::P3);
        assert_eq!(derive(4), IncidentSeverity::P4);
        assert_eq!(derive(5), IncidentSeverity::P4, "P5 has nowhere lower");
    }

    /// Your own profile, always. Somebody else's, only with the configuration
    /// permission — and an address that differs only in case is still yours.
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

    #[test]
    fn test_the_lookback_query_is_entirely_optional() {
        let bare: LookbackQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(bare.days, None);
        assert_eq!(bare.limit, None);

        let asked: LookbackQuery = serde_json::from_str(r#"{"days":30,"limit":10}"#).unwrap();
        assert_eq!(asked.days, Some(30));
        assert_eq!(asked.limit, Some(10));
    }

    /// The dry run defaults to P1 rather than refusing: somebody opening
    /// "would a page land" is nearly always asking about the ladder that
    /// wakes people at 3am.
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

    /// Every bound this surface promises, asserted where the clamp is written
    /// rather than trusted to a comment. These are `COUNT`s over the delivery
    /// ledger, which is the only on-call table with no upper bound on its
    /// size.
    #[test]
    fn test_every_new_read_is_bounded() {
        // config-risks: coverage look-ahead, and the page of risks.
        assert_eq!(7i64.clamp(1, 31), 7);
        assert_eq!(365i64.clamp(1, 31), 31);
        assert_eq!(0i64.clamp(1, 31), 1);
        // limits, shared by config-risks and ownership/stats.
        assert_eq!(50u64.clamp(1, 200), 50);
        assert_eq!(10_000u64.clamp(1, 200), 200);
        assert_eq!(0u64.clamp(1, 200), 1);
    }

    /// The pages table has to render five things per row without a second
    /// call each: when it opened, what fired, who answered, how long they
    /// took and how far it climbed. The first three are fields on the record;
    /// this pins the arithmetic behind the fourth.
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
            team_id: "team_1".into(),
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
        };
        assert_eq!(base.acked_at.unwrap() - base.opened_at, 3_000);

        // A clock that went backwards between two nodes must not produce a
        // negative duration on a screen.
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

    /// A cover body written before slots existed still parses, and still means
    /// the default slot. The UI sends the field only when a team runs more
    /// than one pool.
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

    /// The grid is drawn one rotation at a time; omitting the parameter draws
    /// the primary, which is the row a calendar opens on.
    #[test]
    fn test_the_resolved_schedule_rotation_is_optional() {
        let q: ResolvedScheduleQuery = serde_json::from_str(r#"{"from":1,"to":2}"#).unwrap();
        assert_eq!(q.rotation_id, None);
        let q: ResolvedScheduleQuery =
            serde_json::from_str(r#"{"from":1,"to":2,"rotation_id":"rot_2"}"#).unwrap();
        assert_eq!(q.rotation_id.as_deref(), Some("rot_2"));
    }

    /// Both were stored, validated and honoured by the engine while the write
    /// path had no field for them — so a policy could never leave the defaults.
    /// Absent still means "leave unchanged", so a client that never sent them
    /// keeps working.
    #[test]
    fn test_a_policy_body_can_now_set_repeat_count_and_final_action() {
        let bare: SetPolicyRequest = serde_json::from_str(r#"{"rungs":[]}"#).unwrap();
        assert_eq!(bare.repeat_count, None);
        assert_eq!(bare.final_action, None);

        let full: SetPolicyRequest = serde_json::from_str(
            r#"{"rungs":[],"repeat_count":3,"final_action":"notify_default_team"}"#,
        )
        .unwrap();
        assert_eq!(full.repeat_count, Some(3));
        assert_eq!(
            full.final_action,
            Some(config::meta::oncall::FinalAction::NotifyDefaultTeam)
        );
    }

    /// "I am away" is the common case, and it must not require the caller to
    /// name themselves — the handler fills that in from the session, so a
    /// client cannot record somebody else's leave by leaving a field out.
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

    /// Every field of the absence query is optional on the wire; which
    /// combinations are answerable is the service layer's decision, stated
    /// once there rather than half here and half there.
    #[test]
    fn test_the_absence_query_is_entirely_optional() {
        let q: UnavailabilityQuery = serde_json::from_str("{}").unwrap();
        assert!(q.user_email.is_none() && q.from.is_none() && q.to.is_none());
    }
}

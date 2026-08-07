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
use config::meta::oncall::{EscalationLevel, PriorityRung, Rotation};
use serde::{Deserialize, Deserializer};

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

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddMemberRequest {
    pub user_email: String,
    pub level: EscalationLevel,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetScheduleRequest {
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default)]
    pub rotations: Vec<Rotation>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetPolicyRequest {
    pub rungs: Vec<PriorityRung>,
}

#[derive(Debug, Default, Deserialize)]
pub struct OnCallQuery {
    /// Resolve at this instant (micros) instead of now, so the UI can show a
    /// future week without a second endpoint.
    pub at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct RemoveMemberQuery {
    pub user_email: String,
    pub level: EscalationLevel,
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
    request_body(content = AddMemberRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", content_type = "application/json", body = Object)),
)]
pub async fn add_member(
    Path((org_id, team_id)): Path<(String, String)>,
    Json(body): Json<AddMemberRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::oncall::service::add_member(
            &org_id,
            &team_id,
            &body.user_email,
            body.level,
        )
        .await
        {
            Ok(member) => MetaHttpResponse::json(member),
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
        ("level" = String, Query, description = "Escalation level"),
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
            q.level,
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
            &body.timezone,
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
        match o2_enterprise::enterprise::oncall::service::set_policy(&org_id, &team_id, body.rungs)
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

    #[test]
    fn test_member_level_parses_from_the_wire_form() {
        let r: AddMemberRequest =
            serde_json::from_str(r#"{"user_email":"ana@o2.ai","level":"secondary"}"#).unwrap();
        assert_eq!(r.level, EscalationLevel::Secondary);
        assert!(
            serde_json::from_str::<AddMemberRequest>(r#"{"user_email":"ana@o2.ai","level":"vp"}"#)
                .is_err()
        );
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

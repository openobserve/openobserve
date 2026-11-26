// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#[cfg(feature = "enterprise")]
use axum::{extract::FromRequest, response::IntoResponse};
use axum::{
    extract::{Path, Request},
    response::Response,
};
use common::meta::incidents_v2::incidents_v2_off_response;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::ValidatedJson};
#[cfg(feature = "enterprise")]
use openobserve_core::alerts::incidents::{
    declare::DeclareError,
    page_team::{self, TeamPage},
};
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::alerts::ack;

#[cfg(feature = "enterprise")]
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct PageTeamRequest {
    team_id: String,
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/page_team",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PageIncidentTeam",
    summary = "Page an on-call team for an incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    request_body = PageTeamRequest,
    responses(
        (status = 200, description = "Team page intent", body = TeamPage),
        (status = 400, description = "Team ID is required"),
        (status = 403, description = "Caller cannot page the team"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Incident is closed or Incidents v2 is off"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/page_team",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PageIncidentTeam",
    summary = "Page an on-call team for an incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn page(
    Path((org, incident)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    request: Request,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, user, request);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        if !common::meta::incidents_v2::incidents_v2_enabled() {
            return incidents_v2_off_response();
        }
        let delegated = request.extensions().get::<DelegatedCaller>();
        let caller = ack::caller_of(&org, &user.user_id, delegated, request.headers());
        if caller.ai || delegated.is_some() {
            return MetaHttpResponse::forbidden("Only a person can page an incident team");
        }
        let ValidatedJson(body) =
            match ValidatedJson::<PageTeamRequest>::from_request(request, &()).await {
                Ok(body) => body,
                Err(error) => return error.into_response(),
            };
        match page_team::page(&org, &incident, &body.team_id, &caller.email).await {
            Ok(result) => MetaHttpResponse::json(result),
            Err(error) => error_response(error),
        }
    }
}

#[cfg(feature = "enterprise")]
fn error_response(error: DeclareError) -> Response {
    match error {
        DeclareError::BadRequest(message) => MetaHttpResponse::bad_request(message),
        DeclareError::Forbidden | DeclareError::NoTeam => {
            MetaHttpResponse::forbidden("Caller cannot page the team")
        }
        DeclareError::NotFound => MetaHttpResponse::not_found("Incident not found"),
        DeclareError::Conflict(message) => MetaHttpResponse::conflict(message),
        DeclareError::Internal(error) => {
            log::error!("[incidents] page_team failed: {error:#}");
            MetaHttpResponse::internal_error("Could not page the incident team")
        }
    }
}

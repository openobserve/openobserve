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

use axum::{
    extract::{Path, Request},
    http::HeaderMap,
    response::Response,
};
use common::meta::incidents_v2::incidents_v2_off_response;
#[cfg(feature = "enterprise")]
use config::meta::alerts::incidents::Incident;
#[cfg(feature = "enterprise")]
use openobserve_api_common::auth::delegation::DelegatedCaller;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::alerts::incidents::feedback::{
    self, CauseRequest, Feedback, FeedbackActor, FeedbackError, FeedbackRequest, RunKey,
};
use openobserve_core::auth::UserEmail;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::{alerts::ack, security};

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRcaFeedback",
    summary = "List feedback for an incident analysis run",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("run_id" = String, Path)),
    responses(
        (status = 200, description = "Run feedback", body = [Feedback]),
        (status = 403, description = "Caller cannot read the run"),
        (status = 404, description = "Incident or run not found"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": true, "description": "List feedback for an incident analysis run", "category": "alerts"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRcaFeedback",
    summary = "List feedback for an incident analysis run",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("run_id" = String, Path)),
    responses((status = 403, description = "Incident feedback requires enterprise features")),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn get_feedback(
    Path((org, incident, run)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, run, user, headers);
        MetaHttpResponse::forbidden("Not Supported")
    }
    #[cfg(feature = "enterprise")]
    {
        let key = RunKey {
            org: &org,
            incident: &incident,
            run: &run,
        };
        match read_feedback(key, &user.user_id, &headers).await {
            Ok(rows) => MetaHttpResponse::json(rows),
            Err(response) => response,
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RecordIncidentRcaFeedback",
    summary = "Record feedback for an incident analysis run",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("run_id" = String, Path)),
    request_body = FeedbackRequest,
    responses(
        (status = 200, description = "Run feedback", body = [Feedback]),
        (status = 400, description = "Invalid feedback"),
        (status = 403, description = "Caller cannot record feedback"),
        (status = 404, description = "Incident or run not found"),
        (status = 409, description = "Incidents v2 is off"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RecordIncidentRcaFeedback",
    summary = "Record feedback for an incident analysis run",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("run_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off")),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn post_feedback(
    Path((org, incident, run)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    request: Request,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, run, user, request);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        if let Err(response) = authorize_write(&org, &user.user_id, &request) {
            return response;
        }
        let body = match super::incident_mitigations::json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        let actor = FeedbackActor {
            email: &user.user_id,
            may_access_cases: security::security_allowed(&org, &user.user_id, "POST").await,
        };
        let key = RunKey {
            org: &org,
            incident: &incident,
            run: &run,
        };
        match feedback::post(key, actor, body).await {
            Ok(rows) => MetaHttpResponse::json(rows),
            Err(error) => error_response(error, "POST"),
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/cause/confirm",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ConfirmIncidentCause",
    summary = "Confirm the cause of an incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    request_body = CauseRequest,
    responses(
        (status = 200, description = "Incident with confirmed cause", body = Incident),
        (status = 400, description = "Invalid cause"),
        (status = 403, description = "Caller cannot confirm a cause"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Incidents v2 is off"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/cause/confirm",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ConfirmIncidentCause",
    summary = "Confirm the cause of an incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off")),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn confirm_cause(
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
        if let Err(response) = authorize_write(&org, &user.user_id, &request) {
            return response;
        }
        let body = match super::incident_mitigations::json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        let actor = FeedbackActor {
            email: &user.user_id,
            may_access_cases: security::security_allowed(&org, &user.user_id, "PUT").await,
        };
        match feedback::confirm(&org, &incident, actor, body).await {
            Ok(row) => MetaHttpResponse::json(row),
            Err(error) => error_response(error, "PUT"),
        }
    }
}

#[cfg(feature = "enterprise")]
async fn read_feedback(
    key: RunKey<'_>,
    viewer: &str,
    headers: &HeaderMap,
) -> Result<Vec<Feedback>, Response> {
    use security::rca_scope;

    let caller = rca_scope::rca_caller(key.org, viewer, headers).await;
    let forbidden = || MetaHttpResponse::forbidden("This analysis cannot read past runs");
    if !rca_scope::may_read_run_history(key.org, &caller, key.incident).await {
        return Err(forbidden());
    }
    let may_access_cases = security::security_allowed(key.org, viewer, "GET").await;
    let rows = feedback::list(key, may_access_cases)
        .await
        .map_err(|error| error_response(error, "GET"))?;
    if !rca_scope::record_history_response(key.org, &caller, !rows.is_empty()).await {
        return Err(forbidden());
    }
    Ok(rows)
}

#[cfg(feature = "enterprise")]
fn authorize_write(org: &str, actor: &str, request: &Request) -> Result<(), Response> {
    if !common::meta::incidents_v2::incidents_v2_enabled() {
        return Err(incidents_v2_off_response());
    }
    let delegated = request.extensions().get::<DelegatedCaller>();
    if delegated.is_some() || ack::is_ai_principal(org, actor, delegated, request.headers()) {
        return Err(MetaHttpResponse::forbidden(
            "Only a person can give feedback or confirm a cause",
        ));
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
fn error_response(error: FeedbackError, permission: &str) -> Response {
    match error {
        FeedbackError::BadRequest(message) => MetaHttpResponse::bad_request(message),
        FeedbackError::NotFound => MetaHttpResponse::not_found(error),
        FeedbackError::CaseAccessDenied => {
            MetaHttpResponse::forbidden(security::case_refusal(permission))
        }
        FeedbackError::Database(_) | FeedbackError::Internal(_) => {
            log::error!("[incidents] Feedback or cause request failed: {error:#}");
            MetaHttpResponse::internal_error("Feedback or cause request failed")
        }
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests;

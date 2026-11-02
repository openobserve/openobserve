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

//! The ack, unack and acks routes (§5.3); the rule and the writes live in `core::alerts::ack`.

use axum::{
    Extension, Json,
    body::Bytes,
    extract::Path,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::meta::alerts::ack::{
    AckConflict, AckListResponse, AckRequest, AckResponse, AckSource, ActRefusal,
    ProblemAckRequest, UnackRequest, UnackResponse,
};
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::Headers};
use openobserve_core::{
    alerts::ack::{self, AckError, Act, Groups, Problem, Verb},
    auth::UserEmail,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// AckAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/ack",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "AckAlert",
    summary = "Acknowledge an alert's current firing",
    description = "Acknowledges the problem behind the alert: its incident when the firing is in one, else the current firing of one group (or every firing group with `all_groups`). Repeat notifications stop until it clears; a level increase still notifies. Allowed for root, admins and editors (alert edit access with OpenFGA on) and members of a team the problem pages. Every on-call page of the problem stops, unless another group still fires unacknowledged. `take_over` moves an acknowledgement held by someone else to the caller.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    request_body(content = AckRequest, description = "The group and firing to acknowledge", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AckResponse),
        (status = 403, description = "Refused, with who is on call and who can act", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The group is not firing, or is on another firing", content_type = "application/json", body = AckConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Acknowledge an alert's current firing", "category": "alerts"}))
    )
)]
pub async fn ack_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    Json(req): Json<AckRequest>,
) -> Response {
    let source = ack_source(delegated.as_deref(), &headers);
    let groups = if req.all_groups {
        Groups::All
    } else {
        Groups::One {
            group_key: req.group_key,
            firing_started_at: req.firing_started_at,
        }
    };
    let problem = match ack::problem_of_alert(&org_id, &alert_id, groups).await {
        Ok(p) => p,
        Err(e) => return error_response(e),
    };
    let verb = if req.take_over {
        Verb::TakeOver
    } else {
        Verb::Acknowledge
    };
    act_on(&problem, &user_email.user_id, verb, source).await
}

/// UnackAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/unack",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UnackAlert",
    summary = "Remove the acknowledgement of an alert's firing",
    description = "Clears the acknowledgement of the problem behind the alert: its incident when the firing is in one, else the group's firing. Repeat notifications resume one silence interval after the unack, and the on-call pages the acknowledgement stopped restart at step 1. A no-op when nothing is acknowledged.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    request_body(content = UnackRequest, description = "The group and firing to unacknowledge", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UnackResponse),
        (status = 403, description = "Refused, with who is on call and who can act", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Remove the acknowledgement of an alert's firing", "category": "alerts"}))
    )
)]
pub async fn unack_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    Json(req): Json<UnackRequest>,
) -> Response {
    let source = ack_source(delegated.as_deref(), &headers);
    let groups = Groups::One {
        group_key: req.group_key,
        firing_started_at: req.firing_started_at,
    };
    let problem = match ack::problem_of_alert(&org_id, &alert_id, groups).await {
        Ok(p) => p,
        Err(e) => return error_response(e),
    };
    act_on(&problem, &user_email.user_id, Verb::Unack, source).await
}

/// AcknowledgeIncident
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/acknowledge",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "AcknowledgeIncident",
    summary = "Acknowledge an incident",
    description = "Acknowledges the incident, every firing of its alerts and every on-call page for it. Allowed for root, admins and editors (edit access to any of its alerts with OpenFGA on) and members of a team it pages. `take_over` moves an acknowledgement held by someone else to the caller. Enterprise only.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = ProblemAckRequest, description = "Optional; `take_over` moves someone else's acknowledgement", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AckResponse),
        (status = 403, description = "Refused, with who is on call and who can act", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
pub async fn ack_incident(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let verb = match take_over_of(&body) {
        Ok(true) => Verb::TakeOver,
        Ok(false) => Verb::Acknowledge,
        Err(resp) => return resp,
    };
    let source = ack_source(delegated.as_deref(), &headers);
    incident_verb(org_id, incident_id, &user_email.user_id, verb, source).await
}

/// UnacknowledgeIncident
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/unacknowledge",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "UnacknowledgeIncident",
    summary = "Remove the acknowledgement of an incident",
    description = "Clears the acknowledgement of the incident and of its alerts' firings, and restarts the on-call pages it stopped at step 1. The incident goes back to open without a new analysis run. Enterprise only.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UnackResponse),
        (status = 403, description = "Refused, with who is on call and who can act", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
pub async fn unack_incident(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
) -> Response {
    let source = ack_source(delegated.as_deref(), &headers);
    incident_verb(
        org_id,
        incident_id,
        &user_email.user_id,
        Verb::Unack,
        source,
    )
    .await
}

/// ListAlertAcks
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/acks",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertAcks",
    summary = "List the acknowledgements in force",
    description = "Returns the acks in force for the alert's current firings, one per group.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AckListResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List an alert's acknowledgements in force", "category": "alerts"}))
    )
)]
pub async fn list_alert_acks(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let target = match ack::resolve_target(&org_id, &alert_id).await {
        Ok(t) => t,
        Err(e) => return error_response(e),
    };
    match ack::list_in_force(&target).await {
        Ok(acks) => MetaHttpResponse::json(AckListResponse { acks }),
        Err(e) => error_response(e),
    }
}

/// `slack` for a `slack_action` token, `ui` for the web's session cookie, `api` otherwise.
pub(crate) fn ack_source(delegated: Option<&DelegatedCaller>, headers: &HeaderMap) -> AckSource {
    if let Some(caller) = delegated {
        // An assistant token is an agent turn, not a Slack button press.
        return if caller.is_slack_action() {
            AckSource::Slack
        } else {
            AckSource::Api
        };
    }
    let browser_session = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|c| {
            c.split(';')
                .any(|p| p.trim_start().starts_with("auth_tokens="))
        });
    if browser_session {
        AckSource::Ui
    } else {
        AckSource::Api
    }
}

/// Runs the one rule on the problem, then the verb, and answers with the verb's body.
pub(crate) async fn act_on(
    problem: &Problem,
    actor: &str,
    verb: Verb,
    source: AckSource,
) -> Response {
    if let Err(e) = ack::authorize_problem(problem, actor, Act::Ack).await {
        return error_response(e);
    }
    match act(problem, actor, verb, source).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => error_response(e),
    }
}

/// The verb's answer as JSON: an `AckResponse`, or an `UnackResponse` for an unack.
pub(crate) async fn act(
    problem: &Problem,
    actor: &str,
    verb: Verb,
    source: AckSource,
) -> Result<serde_json::Value, AckError> {
    let body = match verb {
        Verb::Acknowledge => serde_json::to_value(ack::acknowledge(problem, actor, source).await?),
        Verb::TakeOver => serde_json::to_value(ack::take_over(problem, actor, source).await?),
        Verb::Unack => serde_json::to_value(ack::unack(problem, actor, source).await?),
        Verb::HandOff => {
            serde_json::to_value(ack::release_for_hand_off(problem, actor, source).await?)
        }
    };
    body.map_err(|e| AckError::Internal(e.to_string()))
}

/// An empty body is a plain acknowledge; `{"take_over": true}` asks for a take-over.
pub(crate) fn take_over_of(body: &[u8]) -> Result<bool, Response> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(false);
    }
    serde_json::from_slice::<ProblemAckRequest>(body)
        .map(|r| r.take_over)
        .map_err(|e| MetaHttpResponse::bad_request(e.to_string()))
}

#[cfg(feature = "enterprise")]
async fn incident_verb(
    org_id: String,
    incident_id: String,
    actor: &str,
    verb: Verb,
    source: AckSource,
) -> Response {
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found("incident not found"),
        Err(e) => return error_response(AckError::Internal(e.to_string())),
    }
    let problem = Problem::Incident {
        org_id,
        incident_id,
    };
    act_on(&problem, actor, verb, source).await
}

#[cfg(not(feature = "enterprise"))]
async fn incident_verb(
    org_id: String,
    incident_id: String,
    actor: &str,
    verb: Verb,
    source: AckSource,
) -> Response {
    let _ = (org_id, incident_id, actor, verb, source);
    MetaHttpResponse::forbidden("Not Supported")
}

pub(crate) fn error_response(e: AckError) -> Response {
    match e {
        AckError::NotFound => MetaHttpResponse::not_found("alert not found"),
        AckError::Refused(refusal) => (StatusCode::FORBIDDEN, Json(refusal)).into_response(),
        AckError::Conflict(conflict) => (StatusCode::CONFLICT, Json(conflict)).into_response(),
        AckError::Internal(message) => MetaHttpResponse::internal_error(message),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;
    use config::utils::delegation::{SCOPE_ASSISTANT, SCOPE_SLACK_ACTION};

    use super::*;

    fn caller(scope: &str) -> DelegatedCaller {
        DelegatedCaller {
            link_id: "lnk_01".to_string(),
            installation_id: "inst_01".to_string(),
            org: "acme".to_string(),
            jti: "jti-0001".to_string(),
            scope: scope.to_string(),
        }
    }

    fn session() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("a=b; auth_tokens=xyz"),
        );
        headers
    }

    #[test]
    fn the_source_is_slack_for_a_slack_action_caller_ui_for_a_session_and_api_otherwise() {
        let headers = session();
        assert_eq!(ack_source(None, &HeaderMap::new()), AckSource::Api);
        assert_eq!(ack_source(None, &headers), AckSource::Ui);
        let slack = caller(SCOPE_SLACK_ACTION);
        assert_eq!(ack_source(Some(&slack), &headers), AckSource::Slack);
        let mut other = HeaderMap::new();
        other.insert(
            header::COOKIE,
            HeaderValue::from_static("not_auth_tokens=1"),
        );
        assert_eq!(ack_source(None, &other), AckSource::Api);
    }

    #[test]
    fn an_assistant_delegated_caller_is_api_not_slack() {
        let assistant = caller(SCOPE_ASSISTANT);
        assert_eq!(
            ack_source(Some(&assistant), &HeaderMap::new()),
            AckSource::Api
        );
        assert_eq!(ack_source(Some(&assistant), &session()), AckSource::Api);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn only_a_slack_action_caller_mutes_with_source_slack() {
        use config::meta::downtimes::MuteSource;
        use openobserve_core::alerts::mute::source_of;

        let none = HeaderMap::new();
        let slack = caller(SCOPE_SLACK_ACTION);
        assert_eq!(
            source_of(ack_source(Some(&slack), &none)),
            MuteSource::Slack
        );
        let assistant = caller(SCOPE_ASSISTANT);
        assert_eq!(
            source_of(ack_source(Some(&assistant), &none)),
            MuteSource::Api
        );
        assert_eq!(
            source_of(ack_source(None, &session())),
            MuteSource::Openobserve
        );
    }

    #[test]
    fn conflicts_and_refusals_keep_their_status_codes() {
        assert_eq!(
            error_response(AckError::Conflict(AckConflict::NotFiring)).status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            error_response(AckError::Refused(ActRefusal::default())).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            error_response(AckError::NotFound).status(),
            StatusCode::NOT_FOUND
        );
    }
}

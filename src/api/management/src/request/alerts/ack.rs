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
    alerts::ack::{self, AckError, Act, Caller, Groups, Problem, Verb},
    auth::UserEmail,
};

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, request::security};

/// The header the MCP server's loopback calls carry (`src/mcp/src/tools.rs`).
const MCP_MARKER: &str = "x-o2-mcp";

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
    if let Err(resp) =
        security::guard_siem_ids(&org_id, &user_email.user_id, "PUT", [alert_id.as_str()]).await
    {
        return resp;
    }
    let source = ack_source(delegated.as_deref(), &headers);
    let caller = caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
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
    act_on(&problem, &caller, verb, source).await
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
    if let Err(resp) =
        security::guard_siem_ids(&org_id, &user_email.user_id, "PUT", [alert_id.as_str()]).await
    {
        return resp;
    }
    let source = ack_source(delegated.as_deref(), &headers);
    let caller = caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
    let groups = Groups::One {
        group_key: req.group_key,
        firing_started_at: req.firing_started_at,
    };
    let problem = match ack::problem_of_alert(&org_id, &alert_id, groups).await {
        Ok(p) => p,
        Err(e) => return error_response(e),
    };
    act_on(&problem, &caller, Verb::Unack, source).await
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
    request_body(content = ProblemAckRequest, description = "Optional; `take_over` moves someone else's acknowledgement. Incidents v2 adds `assign_self`, `expected_holder`, and `expected_lead`; expected values guard the acknowledgement and assignment together.", content_type = "application/json"),
    responses(
        (status = 200, description = "Success; includes the actual acknowledgement holder in `acked` and lead in `assigned_to`", content_type = "application/json", body = AckResponse),
        (status = 403, description = "Refused, with who is on call and who can act", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "Expected values changed; includes actual `acked` and `assigned_to`, or Incidents v2 is disabled", content_type = "application/json", body = serde_json::Value),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": true}))
    )
)]
pub async fn ack_incident(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = security::guard_case(&org_id, &user_email.user_id, "PUT", &incident_id).await
    {
        return resp;
    }
    let (request, v2_fields) = match ack_request_of(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    if v2_fields && !common::meta::incidents_v2::incidents_v2_enabled() {
        return common::meta::incidents_v2::incidents_v2_off_response();
    }
    let source = ack_source(delegated.as_deref(), &headers);
    let caller = caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
    incident_ack(
        org_id,
        incident_id,
        &caller,
        request,
        v2_fields,
        source,
        false,
    )
    .await
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
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": true}))
    )
)]
pub async fn unack_incident(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = security::guard_case(&org_id, &user_email.user_id, "PUT", &incident_id).await
    {
        return resp;
    }
    let source = ack_source(delegated.as_deref(), &headers);
    let caller = caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
    incident_verb(org_id, incident_id, &caller, Verb::Unack, source).await
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
pub async fn list_alert_acks(
    Path((org_id, alert_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) =
        security::guard_siem_ids(&org_id, &user_email.user_id, "GET", [alert_id.as_str()]).await
    {
        return resp;
    }
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

/// §6.7: the one test of an AI principal, an assistant token, an MCP call or SysRcaAgent.
pub(crate) fn is_ai_principal(
    org_id: &str,
    email: &str,
    delegated: Option<&DelegatedCaller>,
    headers: &HeaderMap,
) -> bool {
    // Any marker value counts: a forged one only refuses its own sender.
    delegated.is_some_and(|d| !d.is_slack_action())
        || headers.contains_key(MCP_MARKER)
        || security::rca_scope::is_sys_rca_agent(org_id, email)
}

/// The request's [`Caller`], built once per request from what only this layer sees.
pub(crate) fn caller_of(
    org_id: &str,
    email: &str,
    delegated: Option<&DelegatedCaller>,
    headers: &HeaderMap,
) -> Caller {
    Caller {
        email: email.to_string(),
        ai: is_ai_principal(org_id, email, delegated, headers),
    }
}

/// Runs the one rule on the problem, then the verb, and answers with the verb's body.
pub(crate) async fn act_on(
    problem: &Problem,
    caller: &Caller,
    verb: Verb,
    source: AckSource,
) -> Response {
    if let Err(e) = ack::authorize_problem(problem, caller, Act::from(verb)).await {
        return error_response(e);
    }
    match act(problem, caller, verb, source).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => error_response(e),
    }
}

/// The verb's answer as JSON: an `AckResponse`, or an `UnackResponse` for a verb that clears.
pub(crate) async fn act(
    problem: &Problem,
    caller: &Caller,
    verb: Verb,
    source: AckSource,
) -> Result<serde_json::Value, AckError> {
    let actor = caller.email.as_str();
    let body = match verb {
        Verb::Acknowledge => {
            serde_json::to_value(ack::acknowledge_as(problem, caller, source).await?)
        }
        Verb::TakeOver => serde_json::to_value(ack::take_over_as(problem, caller, source).await?),
        Verb::Unack => serde_json::to_value(ack::unack(problem, actor, source).await?),
        Verb::HandOff => {
            serde_json::to_value(ack::release_for_hand_off(problem, actor, source).await?)
        }
        Verb::Resolve => serde_json::to_value(ack::resolve(problem, actor, source, None).await?),
    };
    body.map_err(|e| AckError::Internal(e.to_string()))
}

pub(crate) fn ack_request_of(body: &[u8]) -> Result<(ProblemAckRequest, bool), Response> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok((ProblemAckRequest::default(), false));
    }
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| MetaHttpResponse::bad_request(e.to_string()))?;
    let v2_fields = ["assign_self", "expected_holder", "expected_lead"]
        .iter()
        .any(|field| value.get(field).is_some());
    let request =
        serde_json::from_value(value).map_err(|e| MetaHttpResponse::bad_request(e.to_string()))?;
    Ok((request, v2_fields))
}

#[cfg(feature = "enterprise")]
pub(crate) async fn incident_ack(
    org_id: String,
    incident_id: String,
    caller: &Caller,
    request: ProblemAckRequest,
    v2_fields: bool,
    source: AckSource,
    ops_only: bool,
) -> Response {
    match incident_ack_body(
        org_id,
        incident_id,
        caller,
        request,
        v2_fields,
        source,
        ops_only,
    )
    .await
    {
        Ok(body) => MetaHttpResponse::json(body),
        Err(response) => response,
    }
}

#[cfg(feature = "enterprise")]
pub(crate) async fn incident_ack_body(
    org_id: String,
    incident_id: String,
    caller: &Caller,
    request: ProblemAckRequest,
    v2_fields: bool,
    source: AckSource,
    ops_only: bool,
) -> Result<serde_json::Value, Response> {
    use config::meta::alerts::incidents::{IncidentEvent, IncidentStatus};
    use infra::table::alert_incidents::{self, OwnershipRequest, OwnershipResult};

    match alert_incidents::get_rw(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return Err(MetaHttpResponse::not_found("incident not found")),
        Err(error) => return Err(error_response(AckError::Internal(error.to_string()))),
    }
    let problem = Problem::Incident {
        org_id: org_id.clone(),
        incident_id: incident_id.clone(),
    };
    let verb = if request.take_over {
        Verb::TakeOver
    } else {
        Verb::Acknowledge
    };
    ack::authorize_problem(&problem, caller, verb.into())
        .await
        .map_err(error_response)?;
    let (snapshot, committed) = if v2_fields {
        let change = OwnershipRequest {
            caller: &caller.email,
            take_over_of: request
                .take_over
                .then_some(request.expected_holder.as_deref())
                .flatten(),
            assign_self: request.assign_self.unwrap_or(false),
            ops_only,
            expected_holder: request.expected_holder.as_deref(),
            expected_lead: request.expected_lead.as_deref(),
        };
        match alert_incidents::take_ownership(&org_id, &incident_id, &change).await {
            Ok(OwnershipResult::Committed(model, event)) => {
                infra::race_point!("incident_ack.after_commit");
                infra::race_point!("incident_ack.before_effects");
                if let Some(event) = event
                    && let Err(error) = openobserve_core::incidents::send_incident_event_trigger(
                        &org_id,
                        &incident_id,
                        *event,
                    )
                    .await
                {
                    log::error!(
                        "[INCIDENTS] could not dispatch ownership change of {incident_id}: {error}"
                    );
                }
                (Some(model), true)
            }
            Ok(OwnershipResult::Unchanged(model)) => {
                infra::race_point!("incident_ack.after_commit");
                infra::race_point!("incident_ack.before_effects");
                (Some(model), false)
            }
            Ok(OwnershipResult::Conflict(model)) => {
                if ops_only && model.security_case {
                    return Err(MetaHttpResponse::forbidden(
                        "Recovery checks are unavailable for security cases",
                    ));
                }
                return Err((
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "acked": model.acknowledged_by, "assigned_to": model.assigned_to,
                    })),
                )
                    .into_response());
            }
            Ok(OwnershipResult::Missing) => {
                return Err(MetaHttpResponse::not_found("incident not found"));
            }
            Err(error) => return Err(error_response(AckError::Internal(error.to_string()))),
        }
    } else {
        (None, false)
    };
    if committed {
        openobserve_core::alerts::incidents::record_ack_change(
            &org_id,
            &incident_id,
            IncidentStatus::Acknowledged,
            IncidentEvent::acknowledged(&caller.email),
            caller,
            snapshot.as_ref().and_then(|row| row.acknowledged_at),
        )
        .await;
    }
    let outcome = match snapshot {
        Some(snapshot) => match ack::incident_ack_effects(&snapshot, caller, verb, source).await {
            Ok(outcome) => {
                serde_json::to_value(outcome).map_err(|error| AckError::Internal(error.to_string()))
            }
            Err(error) => Err(error),
        },
        None => act(&problem, caller, verb, source).await,
    };
    let mut body = outcome.map_err(error_response)?;
    match alert_incidents::get_rw(&org_id, &incident_id).await {
        Ok(Some(model)) => {
            body["acked"] = model.acknowledged_by.into();
            body["assigned_to"] = model.assigned_to.into();
            if committed {
                body["changed"] = true.into();
            }
            Ok(body)
        }
        Ok(None) => Err(MetaHttpResponse::not_found("incident not found")),
        Err(error) => Err(error_response(AckError::Internal(error.to_string()))),
    }
}

#[cfg(not(feature = "enterprise"))]
async fn incident_ack(
    org_id: String,
    incident_id: String,
    caller: &Caller,
    request: ProblemAckRequest,
    v2_fields: bool,
    source: AckSource,
    ops_only: bool,
) -> Response {
    let _ = (
        org_id,
        incident_id,
        caller,
        request,
        v2_fields,
        source,
        ops_only,
    );
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
async fn incident_verb(
    org_id: String,
    incident_id: String,
    caller: &Caller,
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
    act_on(&problem, caller, verb, source).await
}

#[cfg(not(feature = "enterprise"))]
async fn incident_verb(
    org_id: String,
    incident_id: String,
    caller: &Caller,
    verb: Verb,
    source: AckSource,
) -> Response {
    let _ = (org_id, incident_id, caller, verb, source);
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
    #[cfg(feature = "enterprise")]
    mod incident_contract {
        include!("ack_incident_tests.rs");
    }

    use axum::http::HeaderValue;
    use config::utils::delegation::{SCOPE_ASSISTANT, SCOPE_SLACK_ACTION};

    use super::*;

    #[test]
    fn the_ack_parser_preserves_live_bodies_and_detects_every_v2_field() {
        for body in [b"".as_slice(), b"  ", b"{}"] {
            let (request, v2_fields) = ack_request_of(body).unwrap();
            assert_eq!(request, ProblemAckRequest::default());
            assert!(!v2_fields);
        }
        let (request, v2_fields) = ack_request_of(br#"{"take_over":true}"#).unwrap();
        assert!(request.take_over);
        assert!(!v2_fields);
        for body in [
            br#"{"assign_self":false}"#.as_slice(),
            br#"{"expected_holder":null}"#,
            br#"{"expected_lead":null}"#,
        ] {
            assert!(ack_request_of(body).unwrap().1);
        }
        for body in [
            b"invalid".as_slice(),
            br#"{"assign_self":"yes"}"#,
            br#"{"expected_holder":42}"#,
        ] {
            assert_eq!(
                ack_request_of(body).unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
    }

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

    fn mcp_call() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(MCP_MARKER, HeaderValue::from_static("loopback"));
        headers
    }

    fn sre_agent(org: &str) -> String {
        use config::meta::user::{SRE_AGENT_EMAIL_PREFIX, SRE_AGENT_EMAIL_SUFFIX};
        format!("{SRE_AGENT_EMAIL_PREFIX}{org}{SRE_AGENT_EMAIL_SUFFIX}")
    }

    #[test]
    fn an_assistant_token_an_mcp_call_and_the_sre_agent_are_ai_principals() {
        let none = HeaderMap::new();
        let person = "dana@acme.com";
        let assistant = caller(SCOPE_ASSISTANT);
        assert!(is_ai_principal("acme", person, Some(&assistant), &none));
        assert!(is_ai_principal("acme", person, None, &mcp_call()));
        assert!(is_ai_principal("acme", &sre_agent("acme"), None, &none));
        assert!(
            !is_ai_principal("acme", &sre_agent("other"), None, &none),
            "another org's agent is not this org's"
        );
        let slack = caller(SCOPE_SLACK_ACTION);
        assert!(
            !is_ai_principal("acme", person, Some(&slack), &session()),
            "a Slack button is a person's press"
        );
        assert!(!is_ai_principal("acme", person, None, &session()));
        assert!(!is_ai_principal("acme", person, None, &none));
        assert_eq!(
            caller_of("acme", person, Some(&assistant), &none),
            Caller {
                email: person.to_string(),
                ai: true
            }
        );
        assert_eq!(
            caller_of("acme", person, None, &none),
            Caller::person(person)
        );
    }

    /// F22 (D34, D40) through the real routes: only the AI fact differs between the calls.
    #[tokio::test]
    async fn an_ai_principal_cannot_act_on_a_plain_firing_and_a_person_still_can() {
        use axum::body::to_bytes;
        use config::meta::{
            alerts::{
                alert::Alert,
                state::{AlertState, StateUpdate},
            },
            folder::Folder,
            self_reporting::usage::RunOutcome,
            user::UserRole,
        };
        use svix_ksuid::{Ksuid, KsuidLike};

        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
        infra::db_init().await.expect("meta store");
        infra::table::migrate().await.expect("migrations");
        let org = format!("ai_ack_{}", config::utils::time::now_micros());
        let root = format!("root-{org}@example.com");
        let agent = sre_agent(&org);
        for email in [&root, &agent] {
            common::infra::config::ORG_USERS.insert(
                format!("{}/{email}", config::DEFAULT_ORG),
                infra::table::org_users::OrgUserRecord {
                    role: UserRole::Root,
                    token: String::new(),
                    rum_token: None,
                    org_id: config::DEFAULT_ORG.to_string(),
                    email: email.clone(),
                    created_at: 0,
                    allow_static_token: false,
                },
            );
        }
        let id = Ksuid::new(None, None);
        let alert_id = id.to_string();
        let mut alert = Alert::default();
        alert.id = Some(id);
        alert.org_id = org.clone();
        alert.name = "checkout errors".to_string();
        common::infra::config::ALERTS.write().await.insert(
            db::alerts::alert::cache_alert_key(&org, &alert_id),
            (Folder::default(), alert),
        );
        let firing = 1_760_000_000_000_000;
        infra::table::alert_states::persist(
            &StateUpdate {
                state: Some(AlertState {
                    last_outcome: Some(RunOutcome::Firing),
                    last_outcome_at: Some(firing),
                    since: Some(firing),
                    firing_started_at: Some(firing),
                    ..AlertState::empty(&alert_id, "")
                }),
                transition: None,
            },
            None,
        )
        .await
        .unwrap();
        let ack = |user: &str, take_over: bool, d: Option<DelegatedCaller>, h: HeaderMap| {
            ack_alert(
                Path((org.clone(), alert_id.clone())),
                Headers(UserEmail {
                    user_id: user.to_string(),
                }),
                d.map(Extension),
                h,
                Json(AckRequest {
                    take_over,
                    ..Default::default()
                }),
            )
        };
        let unack = |user: &str, d: Option<DelegatedCaller>, h: HeaderMap| {
            unack_alert(
                Path((org.clone(), alert_id.clone())),
                Headers(UserEmail {
                    user_id: user.to_string(),
                }),
                d.map(Extension),
                h,
                Json(UnackRequest::default()),
            )
        };
        let held = || async {
            infra::table::alert_acks::get(&org, &alert_id, "")
                .await
                .unwrap()
                .filter(|a| a.in_force_for(Some(firing)))
                .map(|a| (a.acked_by, a.ack_source))
        };

        let ai = [
            (
                root.clone(),
                Some(caller(SCOPE_ASSISTANT)),
                HeaderMap::new(),
            ),
            (root.clone(), None, mcp_call()),
            (agent.clone(), None, HeaderMap::new()),
        ];
        for (user, d, h) in &ai {
            for take_over in [false, true] {
                let refused = ack(user, take_over, d.clone(), h.clone()).await;
                assert_eq!(
                    refused.status(),
                    StatusCode::FORBIDDEN,
                    "{user} {take_over}"
                );
                let body = to_bytes(refused.into_body(), usize::MAX).await.unwrap();
                let body: ActRefusal = serde_json::from_slice(&body).unwrap();
                assert!(body.message.contains("AI assistant"), "{}", body.message);
            }
            assert_eq!(held().await, None, "a refused ack writes nothing");
        }

        let pressed = ack(
            &root,
            false,
            Some(caller(SCOPE_SLACK_ACTION)),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(pressed.status(), StatusCode::OK);
        assert_eq!(held().await, Some((root.clone(), AckSource::Slack)));
        for (user, d, h) in &ai {
            let refused = unack(user, d.clone(), h.clone()).await;
            assert_eq!(refused.status(), StatusCode::FORBIDDEN, "{user}");
            assert_eq!(
                held().await,
                Some((root.clone(), AckSource::Slack)),
                "a refused unack leaves the person's ack"
            );
        }
        let released = unack(&root, None, HeaderMap::new()).await;
        assert_eq!(released.status(), StatusCode::OK);
        assert_eq!(held().await, None);
        let by_person = ack(&root, false, None, HeaderMap::new()).await;
        assert_eq!(by_person.status(), StatusCode::OK);
        assert_eq!(held().await, Some((root.clone(), AckSource::Api)));
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

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_siem_detections_acks_need_the_security_grant() {
        use config::meta::{alerts::alert::Alert, folder::Folder};
        use svix_ksuid::{Ksuid, KsuidLike};

        let org = format!("acks_{}", config::ider::uuid());
        let id = Ksuid::new(None, None);
        let mut alert = Alert::default();
        alert.id = Some(id);
        alert.org_id = org.clone();
        alert.context_attributes = Some(
            [(security::SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                .into_iter()
                .collect(),
        );
        common::infra::config::ALERTS.write().await.insert(
            db::alerts::alert::cache_alert_key(&org, &id.to_string()),
            (Folder::default(), alert),
        );
        let stranger = Headers(UserEmail {
            user_id: format!("{}@example.com", config::ider::uuid()),
        });
        let resp = list_alert_acks(Path((org, id.to_string())), stranger).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}

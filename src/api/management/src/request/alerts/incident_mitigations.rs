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
use axum::{Json, extract::FromRequest, http::StatusCode, response::IntoResponse};
use axum::{
    extract::{Path, Request},
    response::Response,
};
use common::meta::incidents_v2::incidents_v2_off_response;
#[cfg(feature = "enterprise")]
use config::meta::alerts::{
    ack::{AckSource, ProblemAckRequest},
    recovery::transitions::RecoveryEvent,
    what_changed::ChangeRow,
};
#[cfg(feature = "enterprise")]
use infra::table::entity::alert_incidents as incident;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::ValidatedJson};
#[cfg(feature = "enterprise")]
use openobserve_core::alerts::{
    ack::Caller,
    incidents::mitigations::{
        self, ClaimRequest, Claimed, CurrentAttempt, MitigationError, RecordRequest, Recorded,
        Retracted,
    },
};
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use serde::de::DeserializeOwned;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::{alerts::ack, security};

#[cfg(feature = "enterprise")]
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(untagged)]
#[allow(dead_code)]
enum RecordMitigationConflicts {
    Attempt(CurrentAttempt),
    Change {
        #[schema(required)]
        current_change: Option<Box<ChangeRow>>,
    },
    Ownership {
        #[schema(required)]
        acked: Option<String>,
        #[schema(required)]
        assigned_to: Option<String>,
    },
    Error(MetaHttpResponse),
}

#[cfg(feature = "enterprise")]
config::any_of_schema!(RecordMitigationConflict, RecordMitigationConflicts);

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RecordIncidentMitigation",
    summary = "Record an incident mitigation",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    request_body = RecordRequest,
    responses(
        (status = 200, description = "Fix recorded", body = Recorded),
        (status = 400, description = "Invalid request or recovery condition"),
        (status = 403, description = "Caller cannot record the fix"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Current attempt, observed change or incident state conflict", body = RecordMitigationConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RecordIncidentMitigation",
    summary = "Record an incident mitigation",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn record(
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
        match record_request(&org, &incident, &user.user_id, request).await {
            Ok(value) => MetaHttpResponse::json(value),
            Err(response) => response,
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations/{attempt_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RetractIncidentMitigation",
    summary = "Retract an incident mitigation",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("attempt_id" = String, Path)),
    responses(
        (status = 200, description = "Fix retracted", body = Retracted),
        (status = 403, description = "Caller cannot retract the fix"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Attempt cannot be retracted or Incidents v2 is off", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations/{attempt_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "RetractIncidentMitigation",
    summary = "Retract an incident mitigation",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("incident_id" = String, Path),
        ("attempt_id" = String, Path),
    ),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn retract(
    Path((org, incident, attempt)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    request: Request,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, attempt, user, request);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        let actor = &user.user_id;
        if let Err(response) = authorize(actor, &org, &request) {
            return response;
        }
        match mitigations::retract(&org, &incident, &attempt, actor).await {
            Ok(result) => MetaHttpResponse::json(result),
            Err(error) => error_response(error),
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations/claims",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ClaimIncidentMitigation",
    summary = "Claim an incident mitigation option",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    request_body = ClaimRequest,
    responses(
        (status = 200, description = "Fix option claimed", body = Claimed),
        (status = 403, description = "Caller cannot claim the option"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Incident is closed or Incidents v2 is off", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/mitigations/claims",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ClaimIncidentMitigation",
    summary = "Claim an incident mitigation option",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn claim(
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
        let actor = &user.user_id;
        if let Err(response) = authorize(actor, &org, &request) {
            return response;
        }
        let body = match json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        match mitigations::claim(&org, &incident, actor, body).await {
            Ok(result) => MetaHttpResponse::json(result),
            Err(error) => error_response(error),
        }
    }
}

#[cfg(feature = "enterprise")]
pub(super) fn authorize(actor: &str, org: &str, request: &Request) -> Result<Caller, Response> {
    if !common::meta::incidents_v2::incidents_v2_enabled() {
        return Err(incidents_v2_off_response());
    }
    let delegated = request.extensions().get::<DelegatedCaller>();
    let caller = ack::caller_of(org, actor, delegated, request.headers());
    if caller.ai || delegated.is_some() {
        return Err(MetaHttpResponse::forbidden(
            "Only a person can change incident mitigations",
        ));
    }
    Ok(caller)
}

#[cfg(feature = "enterprise")]
pub(super) async fn json_body<T: DeserializeOwned>(request: Request) -> Result<T, Response> {
    ValidatedJson::<T>::from_request(request, &())
        .await
        .map(|ValidatedJson(body)| body)
        .map_err(IntoResponse::into_response)
}

#[cfg(feature = "enterprise")]
pub(super) fn error_response(error: MitigationError) -> Response {
    match error {
        MitigationError::BadRequest(message) => MetaHttpResponse::bad_request(message),
        MitigationError::Forbidden | MitigationError::SecurityCase => {
            MetaHttpResponse::forbidden(error)
        }
        MitigationError::AcknowledgementRequired
        | MitigationError::MeasurementChanged
        | MitigationError::RevivalBudget => MetaHttpResponse::conflict(error),
        MitigationError::ObservedChange(current) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"current_change": *current})),
        )
            .into_response(),
        MitigationError::Missing => MetaHttpResponse::not_found(error),
        MitigationError::Refused(_) | MitigationError::Current(_) => {
            MetaHttpResponse::conflict(error)
        }
        MitigationError::Db(_) | MitigationError::Internal(_) => {
            MetaHttpResponse::internal_error(error)
        }
    }
}

#[cfg(feature = "enterprise")]
async fn record_request(
    org: &str,
    id: &str,
    actor: &str,
    request: Request,
) -> Result<Recorded, Response> {
    let caller = authorize(actor, org, &request)?;
    let body: RecordRequest = json_body(request).await?;
    body.validate().map_err(error_response)?;
    let row = infra::table::alert_incidents::get_rw(org, id)
        .await
        .map_err(MetaHttpResponse::internal_error)?
        .ok_or_else(|| MetaHttpResponse::not_found("Incident not found"))?;
    mitigations::ensure_recordable(&row).map_err(error_response)?;
    mitigations::ensure_open(&row, RecoveryEvent::Record).map_err(error_response)?;
    if row.acknowledged_by.is_none() && row.status == "open" {
        let result = ack::incident_ack(
            org.to_owned(),
            id.to_owned(),
            &caller,
            ProblemAckRequest {
                take_over: false,
                assign_self: Some(true),
                expected_holder: None,
                expected_lead: row.assigned_to.clone(),
            },
            true,
            AckSource::Api,
            true,
        )
        .await;
        if !result.status().is_success() && result.status() != StatusCode::CONFLICT {
            return Err(result);
        }
        if result.status() == StatusCode::CONFLICT {
            let fresh = infra::table::alert_incidents::get_rw(org, id)
                .await
                .map_err(MetaHttpResponse::internal_error)?;
            if fresh.is_some_and(|row| row.status == "open" && row.acknowledged_by.is_none()) {
                return Err(result);
            }
        }
    }
    let watch = body.watch.clone();
    let effect = body
        .expect_effect_secs
        .unwrap_or_else(|| common::meta::incidents_v2::recovery_settings().expect_effect_secs);
    let prepare = async move |row: &incident::Model| {
        mitigations::prepare_watch(
            row,
            actor,
            watch.as_ref(),
            effect,
            async |logs: Vec<String>| {
                security::guard_stream_reads(org, actor, logs.iter().map(String::as_str))
                    .await
                    .map_err(|_| MitigationError::Forbidden)
            },
        )
        .await
    };
    match mitigations::record(&row, actor, body, prepare).await {
        Ok(result) => Ok(result),
        Err(MitigationError::Current(mut attempt)) => {
            attempt.authorize_values(actor).await;
            Err((StatusCode::CONFLICT, Json(attempt)).into_response())
        }
        Err(error) => Err(error_response(error)),
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use serde_json::json;
    use utoipa::Path as _;

    #[test]
    fn mitigation_operations_are_disabled_for_mcp() {
        for operation in [
            super::__path_record::operation(),
            super::__path_retract::operation(),
            super::__path_claim::operation(),
        ] {
            let document = serde_json::to_value(operation).unwrap();
            assert_eq!(document["x-o2-mcp"], json!({"enabled": false}));
        }
    }
}

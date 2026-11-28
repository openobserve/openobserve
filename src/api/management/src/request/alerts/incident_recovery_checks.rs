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
use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use axum::{
    extract::{Path, Request},
    http::HeaderMap,
    response::Response,
};
#[cfg(not(feature = "enterprise"))]
use common::meta::incidents_v2::incidents_v2_off_response;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::alerts::incidents::recovery::checks::{
    self, Cancelled, CheckPatch, RecoveryCheckList, RecoveryCheckView,
};
use openobserve_core::auth::UserEmail;

#[cfg(feature = "enterprise")]
use super::incident_mitigations::{authorize, error_response, json_body};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::security;

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRecoveryChecks",
    summary = "List incident recovery checks",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("incident_id" = String, Path),
        ("If-None-Match" = Option<String>, Header),
    ),
    responses(
        (status = 200, description = "Recovery checks", body = RecoveryCheckList, headers(("ETag" = String))),
        (status = 304, description = "Recovery checks unchanged", headers(("ETag" = String))),
        (status = 403, description = "Caller cannot read the incident"),
        (status = 404, description = "Incident not found"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRecoveryChecks",
    summary = "List incident recovery checks",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn get(
    Path((org, incident)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, user, headers);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        match list_request(&org, &incident, &user.user_id, &headers).await {
            Ok(response) | Err(response) => response,
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks/{check_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "EditIncidentRecoveryCheck",
    summary = "Edit an incident recovery check",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("check_id" = String, Path)),
    request_body = CheckPatch,
    responses(
        (status = 200, description = "Recovery check updated", body = RecoveryCheckView),
        (status = 400, description = "Invalid recovery condition"),
        (status = 403, description = "Caller cannot edit the check"),
        (status = 404, description = "Incident or recovery check not found"),
        (status = 409, description = "Check state conflict or Incidents v2 is off"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks/{check_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "EditIncidentRecoveryCheck",
    summary = "Edit an incident recovery check",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("check_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn patch(
    Path((org, incident, check)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    request: Request,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, check, user, request);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        if let Err(response) = authorize(&user.user_id, &org, &request) {
            return response;
        }
        let body = match json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        match checks::edit(&org, &incident, &check, &user.user_id, body).await {
            Ok(result) => Json(result).into_response(),
            Err(error) => error_response(error),
        }
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks/{check_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "CancelIncidentRecoveryCheck",
    summary = "Cancel an incident recovery check",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("check_id" = String, Path)),
    responses(
        (status = 200, description = "Recovery check cancelled", body = Cancelled),
        (status = 403, description = "Caller cannot cancel the check"),
        (status = 404, description = "Incident or recovery check not found"),
        (status = 409, description = "Check state conflict or Incidents v2 is off"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/recovery_checks/{check_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "CancelIncidentRecoveryCheck",
    summary = "Cancel an incident recovery check",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path), ("check_id" = String, Path)),
    responses((status = 409, description = "Incidents v2 is off", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn delete(
    Path((org, incident, check)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    request: Request,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, check, user, request);
        incidents_v2_off_response()
    }
    #[cfg(feature = "enterprise")]
    {
        if let Err(response) = authorize(&user.user_id, &org, &request) {
            return response;
        }
        match checks::cancel(&org, &incident, &check, &user.user_id).await {
            Ok(result) => Json(result).into_response(),
            Err(error) => error_response(error),
        }
    }
}

#[cfg(feature = "enterprise")]
async fn list_request(
    org: &str,
    incident: &str,
    viewer: &str,
    headers: &HeaderMap,
) -> Result<Response, Response> {
    use security::rca_scope;

    let caller = rca_scope::rca_caller(org, viewer, headers).await;
    let forbidden = || MetaHttpResponse::forbidden("This analysis cannot read that incident");
    if !rca_scope::may_read_incident(org, &caller, incident).await {
        return Err(forbidden());
    }
    let read = checks::list(org, incident, viewer)
        .await
        .map_err(error_response)?;
    security::guard_siem_case(org, viewer, "GET", read.security_case).await?;
    security::guard_case(org, viewer, "GET", incident).await?;
    if let rca_scope::RcaCaller::Bound { run_id, .. } = &caller
        && caller.own_incident() != Some(incident)
    {
        let session = headers
            .get(rca_scope::ASSISTANT_SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(forbidden)?;
        if !infra::table::rca_fence::record_incident_history_read(org, run_id, session, incident)
            .await
            .map_err(MetaHttpResponse::internal_error)?
        {
            return Err(forbidden());
        }
    }
    let etag = HeaderValue::from_str(&read.etag).map_err(MetaHttpResponse::internal_error)?;
    let requested = headers.get_all(header::IF_NONE_MATCH);
    let mut response =
        if read.matches_etag(requested.iter().filter_map(|value| value.to_str().ok())) {
            StatusCode::NOT_MODIFIED.into_response()
        } else {
            Json(read.into_body().map_err(MetaHttpResponse::internal_error)?).into_response()
        };
    response.headers_mut().insert(header::ETAG, etag);
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    response.headers_mut().append(
        header::VARY,
        HeaderValue::from_static("Authorization, Cookie"),
    );
    Ok(response)
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use axum::body::to_bytes;
    use config::utils::time::now_micros;
    use infra::table::alert_incidents;
    use serde_json::json;
    use utoipa::Path as _;

    use super::*;

    #[test]
    fn recovery_check_operations_are_disabled_for_mcp() {
        for operation in [
            super::__path_get::operation(),
            super::__path_patch::operation(),
            super::__path_delete::operation(),
        ] {
            let document = serde_json::to_value(operation).unwrap();
            assert_eq!(document["x-o2-mcp"], json!({"enabled": false}));
        }
    }

    #[tokio::test]
    async fn recovery_checks_http_returns_304_and_empty_body_for_same_etag() {
        security::tests::meta_store().await;
        let org = config::ider::generate();
        let incident = alert_incidents::create(
            &org,
            "P3",
            json!({}),
            "AlertId",
            now_micros(),
            Some("Recovery check polling".to_owned()),
        )
        .await
        .unwrap();
        let get_checks = |headers| {
            get(
                Path((org.clone(), incident.id.clone())),
                Headers(UserEmail {
                    user_id: "viewer".to_owned(),
                }),
                headers,
            )
        };

        let first = get_checks(HeaderMap::new()).await;
        assert_eq!(first.status(), StatusCode::OK);
        let etag = first.headers()[header::ETAG].clone();
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag.clone());
        let unchanged = get_checks(headers).await;
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(unchanged.headers()[header::ETAG], etag);
        assert!(
            to_bytes(unchanged.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

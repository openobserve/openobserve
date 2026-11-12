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

//! The alert-scoped mute routes (§6, Q1): enterprise only, 403 "Not Supported" in the OSS build.

use axum::{Extension, Json, extract::Path, http::HeaderMap, response::Response};
use config::meta::{
    alerts::ack::ActRefusal,
    downtimes::{
        AlertMuteConflict, AlertMuteExtendRequest, AlertMuteExtendResponse, AlertMuteRequest,
        AlertMuteResponse, Downtime,
    },
};
use openobserve_api_common::{auth::delegation::DelegatedCaller, extractors::Headers};
use openobserve_core::auth::UserEmail;

/// MuteAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/mute",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "MuteAlert",
    summary = "Mute an alert or some of its groups",
    description = "Creates a one-time downtime that targets only this alert: until it clears (ended by the alert's clear, 24 hours at most), for 1 to 1440 minutes, or until an instant. `group_keys` mutes only those groups of a multi-alert; `all_groups` or no keys mutes the whole alert. Filed in `folder_id`, else the default downtimes folder. Allowed for admins and editors (alert edit access with OpenFGA on) and for members of the team of an open on-call response for the alert or its incident. Enterprise only.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    request_body(content = AlertMuteRequest, description = "How long, and which groups", content_type = "application/json"),
    responses(
        (status = 201, description = "Muted", content_type = "application/json", body = AlertMuteResponse),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Refused, with who is on call and who can act; or not supported", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "Already muted, or the org's downtime cap is reached", content_type = "application/json", body = AlertMuteConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Mute an alert or some of its groups", "category": "alerts"}))
    )
)]
pub async fn mute_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    Json(req): Json<AlertMuteRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use openobserve_core::alerts::mute;

        let source = mute::source_of(super::ack::ack_source(delegated.as_deref(), &headers));
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match mute::mute(&target, &req, &user_email.user_id, source).await {
            Ok(body) => created(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, alert_id, user_email, delegated, headers, req);
        crate::request::downtimes::not_supported()
    }
}

/// ExtendAlertMute
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/mute/{downtime_id}/extend",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExtendAlertMute",
    summary = "Move the end of an alert's quick mute",
    description = "Changes when a quick mute of this alert ends: `minutes` added to the later of its end and now (from now for an until-it-clears mute, which then becomes timed), `until_clear`, or `ends_at`. `version` is the one the caller saw; a newer row answers 409 `version_changed` with the current end. Same rule as mute.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("downtime_id" = String, Path, description = "Downtime ID of the quick mute"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    request_body(content = AlertMuteExtendRequest, description = "The new end and the version seen", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AlertMuteExtendResponse),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Refused, with who is on call and who can act; or not supported", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "The version changed, or the downtime is not a quick mute of this alert", content_type = "application/json", body = AlertMuteConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move the end of an alert's quick mute", "category": "alerts"}))
    )
)]
pub async fn extend_alert_mute(
    Path((org_id, alert_id, downtime_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<AlertMuteExtendRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match openobserve_core::alerts::mute::extend(
            &target,
            &downtime_id,
            &req,
            &user_email.user_id,
        )
        .await
        {
            Ok(body) => crate::common::meta::http::HttpResponse::json(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, alert_id, downtime_id, user_email, req);
        crate::request::downtimes::not_supported()
    }
}

/// CancelAlertMute
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/mute/{downtime_id}/cancel",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CancelAlertMute",
    summary = "End an alert's quick mute now",
    description = "Cancels a quick mute of this alert; the row stays for history. Same rule as mute.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("downtime_id" = String, Path, description = "Downtime ID of the quick mute"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Downtime),
        (status = 403, description = "Refused, with who is on call and who can act; or not supported", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "Not a quick mute of this alert", content_type = "application/json", body = AlertMuteConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "End an alert's quick mute now", "category": "alerts"}))
    )
)]
pub async fn cancel_alert_mute(
    Path((org_id, alert_id, downtime_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match openobserve_core::alerts::mute::unmute(&target, &downtime_id, &user_email.user_id)
            .await
        {
            Ok(body) => crate::common::meta::http::HttpResponse::json(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, alert_id, downtime_id, user_email);
        crate::request::downtimes::not_supported()
    }
}

#[cfg(feature = "enterprise")]
async fn target_of(
    org_id: &str,
    alert_id: &str,
) -> Result<openobserve_core::alerts::ack::AckTarget, Response> {
    openobserve_core::alerts::ack::resolve_target(org_id, alert_id)
        .await
        .map_err(super::ack::error_response)
}

#[cfg(feature = "enterprise")]
fn created(body: AlertMuteResponse) -> Response {
    use axum::response::IntoResponse;
    (axum::http::StatusCode::CREATED, Json(body)).into_response()
}

#[cfg(feature = "enterprise")]
fn error_response(e: openobserve_core::alerts::mute::MuteError) -> Response {
    use axum::{http::StatusCode, response::IntoResponse};
    use openobserve_core::alerts::mute::MuteError;

    match e {
        MuteError::Refused(refusal) => (StatusCode::FORBIDDEN, Json(refusal)).into_response(),
        MuteError::Conflict(conflict) => (StatusCode::CONFLICT, Json(conflict)).into_response(),
        MuteError::Downtime(e) => crate::request::downtimes::error_response(e),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn every_mute_route_is_forbidden_in_the_oss_build() {
        let user = || {
            Headers(UserEmail {
                user_id: "root@example.com".to_string(),
            })
        };
        let one = || Path(("default".to_string(), "a1".to_string()));
        let two = || Path(("default".to_string(), "a1".to_string(), "d1".to_string()));
        let responses = [
            mute_alert(
                one(),
                user(),
                None,
                HeaderMap::new(),
                Json(AlertMuteRequest::default()),
            )
            .await,
            extend_alert_mute(two(), user(), Json(AlertMuteExtendRequest::default())).await,
            cancel_alert_mute(two(), user()).await,
        ];
        for response in responses {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn refusals_and_conflicts_keep_their_status_codes() {
        use openobserve_core::alerts::mute::MuteError;
        assert_eq!(
            error_response(MuteError::Refused(ActRefusal::default())).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            error_response(MuteError::Conflict(AlertMuteConflict::NotAQuickMute)).status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            created(AlertMuteResponse::default()).status(),
            StatusCode::CREATED
        );
    }
}

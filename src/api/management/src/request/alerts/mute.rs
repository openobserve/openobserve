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

use axum::{
    Extension, Json,
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
use config::meta::{
    alerts::ack::ActRefusal,
    downtimes::{
        AlertMuteConflict, AlertMuteExtendRequest, AlertMuteExtendResponse, AlertMuteRequest,
        AlertMuteResponse, CancelDowntimeQuery, Downtime,
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
    description = "Cancels a quick mute of this alert; the row stays for history. A `version` other than the stored one cancels nothing and answers 409 `version_changed`. Same rule as mute.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("downtime_id" = String, Path, description = "Downtime ID of the quick mute"),
        ("folder" = Option<String>, Query, description = "Folder ID of the alert, for the permission check"),
        CancelDowntimeQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Downtime),
        (status = 403, description = "Refused, with who is on call and who can act; or not supported", content_type = "application/json", body = ActRefusal),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 409, description = "Not a quick mute of this alert, or the version changed", content_type = "application/json", body = AlertMuteConflict),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "End an alert's quick mute now", "category": "alerts"}))
    )
)]
pub async fn cancel_alert_mute(
    Path((org_id, alert_id, downtime_id)): Path<(String, String, String)>,
    Query(query): Query<CancelDowntimeQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match openobserve_core::alerts::mute::unmute(
            &target,
            &downtime_id,
            query.version,
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
        let _ = (org_id, alert_id, downtime_id, query, user_email);
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
    #[cfg(feature = "enterprise")]
    use svix_ksuid::KsuidLike as _;

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
            cancel_alert_mute(two(), Query(CancelDowntimeQuery::default()), user()).await,
        ];
        for response in responses {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }

    // The route reads the alert through the cache first, so a cached alert needs no alert table.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_unmute_route_refuses_a_version_the_mute_widened_past() {
        use config::meta::folder::{DEFAULT_FOLDER, Folder, FolderType};
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
        infra::db_init().await.expect("meta store");
        infra::table::migrate().await.expect("migrations");
        let now = config::utils::time::now_micros();
        let org = format!("unmute_route_{now}");
        let root = "root-unmute-route@example.com";
        common::infra::config::ORG_USERS.insert(
            format!("{}/{root}", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord {
                role: config::meta::user::UserRole::Root,
                token: String::new(),
                rum_token: None,
                org_id: config::DEFAULT_ORG.to_string(),
                email: root.to_string(),
                created_at: 0,
                allow_static_token: false,
            },
        );
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_string(),
            name: DEFAULT_FOLDER.to_string(),
            description: String::new(),
            icon: None,
        };
        infra::table::folders::get_or_create(&org, folder.clone(), FolderType::Downtimes)
            .await
            .unwrap();
        let alert_id = svix_ksuid::Ksuid::new(None, None);
        let mut alert = config::meta::alerts::alert::Alert::default();
        alert.id = Some(alert_id);
        alert.name = "checkout errors".to_string();
        common::infra::config::ALERTS
            .write()
            .await
            .insert(format!("{org}/{alert_id}"), (folder, alert));
        let alert_id = alert_id.to_string();
        let hour = 3_600_000_000;
        let group = |key: &str| serde_json::json!({ "alert_id": alert_id, "group_key": key });
        let conn = infra::db::get_orm_client_rw().await;
        let put = |id: &str, groups: serde_json::Value, version: i64| {
            let row: Downtime = serde_json::from_value(serde_json::json!({
                "id": id, "org": org, "name": "Quick mute",
                "targets": [{ "module": "alerts", "folders": { "kind": "all" }, "ids": [alert_id] }],
                "alert_groups": groups,
                "schedule": { "repeat": "none", "starts_at": now - hour, "ends_at": now + hour,
                              "timezone": "UTC", "duration_secs": 7200 },
                "version": version,
                "created_by": root, "created_at": now, "updated_by": root, "updated_at": now
            }))
            .unwrap();
            async move { infra::table::downtimes::put_with(conn, &row).await.unwrap() }
        };
        let unmute = |id: &'static str, version: Option<i64>| {
            cancel_alert_mute(
                Path((org.clone(), alert_id.clone(), id.to_string())),
                Query(CancelDowntimeQuery { version }),
                Headers(UserEmail {
                    user_id: root.to_string(),
                }),
            )
        };
        let cancelled = |id: &'static str| {
            let org = org.clone();
            async move {
                let stored = infra::table::downtimes::get_rw(&org, id)
                    .await
                    .unwrap()
                    .unwrap();
                stored.cancelled_at.is_some()
            }
        };

        put("widened", serde_json::json!([group("g1")]), 1).await;
        put("widened", serde_json::json!([group("g1"), group("g2")]), 2).await;
        let one_group = unmute("widened", Some(1)).await;
        assert_eq!(one_group.status(), StatusCode::CONFLICT);
        assert!(
            !cancelled("widened").await,
            "a refused unmute leaves the mute live"
        );
        put("widened", serde_json::Value::Null, 3).await;
        let two_groups = unmute("widened", Some(2)).await;
        assert_eq!(two_groups.status(), StatusCode::CONFLICT);
        assert!(!cancelled("widened").await);
        let whole_alert = unmute("widened", Some(3)).await;
        assert_eq!(whole_alert.status(), StatusCode::OK);
        assert!(cancelled("widened").await);

        put("absent", serde_json::Value::Null, 1).await;
        let absent = unmute("absent", None).await;
        assert_eq!(absent.status(), StatusCode::OK);
        assert!(cancelled("absent").await);
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

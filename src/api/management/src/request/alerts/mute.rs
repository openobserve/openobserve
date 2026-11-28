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

use axum::{Extension, extract::Path, http::HeaderMap, response::Response};
#[cfg(feature = "enterprise")]
use axum::{Json, extract::Query};
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
    #[cfg(feature = "enterprise")] Json(req): Json<AlertMuteRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use openobserve_core::alerts::mute;

        let source = mute::source_of(super::ack::ack_source(delegated.as_deref(), &headers));
        let caller =
            super::ack::caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match mute::mute(&target, &req, &caller, source).await {
            Ok(body) => created(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, alert_id, user_email, delegated, headers);
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
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
    #[cfg(feature = "enterprise")] Json(req): Json<AlertMuteExtendRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller =
            super::ack::caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match openobserve_core::alerts::mute::extend(&target, &downtime_id, &req, &caller).await {
            Ok(body) => crate::common::meta::http::HttpResponse::json(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (
            org_id,
            alert_id,
            downtime_id,
            user_email,
            delegated,
            headers,
        );
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
    #[cfg(feature = "enterprise")] Query(query): Query<CancelDowntimeQuery>,
    Headers(user_email): Headers<UserEmail>,
    delegated: Option<Extension<DelegatedCaller>>,
    headers: HeaderMap,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let caller =
            super::ack::caller_of(&org_id, &user_email.user_id, delegated.as_deref(), &headers);
        let target = match target_of(&org_id, &alert_id).await {
            Ok(t) => t,
            Err(resp) => return resp,
        };
        match openobserve_core::alerts::mute::unmute(
            &target,
            &downtime_id,
            query.version,
            &caller,
            None,
        )
        .await
        {
            Ok(body) => crate::common::meta::http::HttpResponse::json(body),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (
            org_id,
            alert_id,
            downtime_id,
            user_email,
            delegated,
            headers,
        );
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
            mute_alert(one(), user(), None, HeaderMap::new()).await,
            extend_alert_mute(two(), user(), None, HeaderMap::new()).await,
            cancel_alert_mute(two(), user(), None, HeaderMap::new()).await,
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
        // Rows are keyed by id alone, so a fixed id would move another test's row into this org.
        let id_of = |name: &str| format!("{org}_{name}");
        let put = |name: &str, groups: serde_json::Value, version: i64| {
            let row: Downtime = serde_json::from_value(serde_json::json!({
                "id": id_of(name), "org": org, "name": "Quick mute",
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
        let unmute = |name: &'static str, version: Option<i64>| {
            cancel_alert_mute(
                Path((org.clone(), alert_id.clone(), id_of(name))),
                Query(CancelDowntimeQuery { version }),
                Headers(UserEmail {
                    user_id: root.to_string(),
                }),
                None,
                HeaderMap::new(),
            )
        };
        let cancelled = |name: &'static str| {
            let (org, id) = (org.clone(), id_of(name));
            async move {
                let stored = infra::table::downtimes::get_rw(&org, &id)
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

        // A fix's Undo goes through the same fence: it ends only the version its snooze made.
        use o2_enterprise::enterprise::autoobserve::ports::{FixPort, MuteAnswer};
        let port = crate::request::autoobserve::fix_ports::LiveFixPort;
        let snooze = id_of("snooze");
        put("snooze", serde_json::Value::Null, 2).await;
        let stale = port
            .unmute(&org, &alert_id, (snooze.as_str(), 1), root, None)
            .await;
        assert!(matches!(stale, Ok(MuteAnswer::Changed(_))), "{stale:?}");
        assert!(!cancelled("snooze").await);
        assert!(port.mute_in_force(&org, &snooze).await.unwrap());
        let live = port.mutes(&org, &alert_id).await.unwrap();
        assert!(
            live.iter()
                .any(|m| m.downtime_id == snooze && m.version == 2)
        );
        let ended = port
            .unmute(&org, &alert_id, (snooze.as_str(), 2), root, None)
            .await;
        assert!(matches!(ended, Ok(MuteAnswer::Done(_))), "{ended:?}");
        assert!(cancelled("snooze").await);
        assert!(!port.mute_in_force(&org, &snooze).await.unwrap());
    }

    /// F22 refuses an AI mute of a plain firing, F24 one of a P1 alert in an incident (D34, D40).
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_ai_principal_cannot_mute_or_extend_where_a_page_would_go_quiet() {
        use axum::body::to_bytes;
        use config::{
            meta::{
                alerts::{alert::Alert, priority::AlertPriority},
                folder::{DEFAULT_FOLDER, Folder, FolderType},
                user::{SRE_AGENT_EMAIL_PREFIX, SRE_AGENT_EMAIL_SUFFIX, UserRole},
            },
            utils::delegation::SCOPE_ASSISTANT,
        };

        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
        infra::db_init().await.expect("meta store");
        infra::table::migrate().await.expect("migrations");
        let now = config::utils::time::now_micros();
        let org = format!("ai_mute_{now}");
        let root = format!("root-{org}@example.com");
        let agent = format!("{SRE_AGENT_EMAIL_PREFIX}{org}{SRE_AGENT_EMAIL_SUFFIX}");
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
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_string(),
            name: DEFAULT_FOLDER.to_string(),
            description: String::new(),
            icon: None,
        };
        infra::table::folders::get_or_create(&org, folder.clone(), FolderType::Downtimes)
            .await
            .unwrap();
        let mut alerts = Vec::new();
        for (name, priority) in [
            ("plain", AlertPriority::P1),
            ("incident-p1", AlertPriority::P1),
            ("incident-p3", AlertPriority::P3),
        ] {
            let id = svix_ksuid::Ksuid::new(None, None);
            let mut alert = Alert::default();
            alert.id = Some(id);
            alert.org_id = org.clone();
            alert.name = name.to_string();
            alert.priority = Some(priority);
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, &id.to_string()),
                (folder.clone(), alert),
            );
            alerts.push(id.to_string());
        }
        let [plain, incident_p1, incident_p3] = <[String; 3]>::try_from(alerts).unwrap();
        for alert_id in [&incident_p1, &incident_p3] {
            let incident = infra::table::alert_incidents::create(
                &org,
                "P2",
                serde_json::json!({}),
                "alert",
                now,
                Some(alert_id.clone()),
            )
            .await
            .unwrap();
            infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                alert_id,
                alert_id,
                "alert",
                now,
                "test",
            )
            .await
            .unwrap();
        }
        let mut mcp = HeaderMap::new();
        mcp.insert("x-o2-mcp", axum::http::HeaderValue::from_static("loopback"));
        let assistant = DelegatedCaller {
            link_id: "lnk_01".to_string(),
            installation_id: "inst_01".to_string(),
            org: org.clone(),
            jti: "jti-0001".to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
        };
        let ai = [
            (root.clone(), Some(assistant), HeaderMap::new()),
            (root.clone(), None, mcp),
            (agent.clone(), None, HeaderMap::new()),
        ];
        let user = |email: &str| {
            Headers(UserEmail {
                user_id: email.to_string(),
            })
        };
        let mute = |alert_id: &str, email: &str, d: Option<DelegatedCaller>, h: HeaderMap| {
            mute_alert(
                Path((org.clone(), alert_id.to_string())),
                user(email),
                d.map(Extension),
                h,
                Json(AlertMuteRequest {
                    minutes: Some(30),
                    ..Default::default()
                }),
            )
        };
        let rows = || async {
            let conn = infra::db::get_orm_client_rw().await;
            infra::table::downtimes::list_with(conn, &org, None)
                .await
                .unwrap()
                .len()
        };

        for (email, d, h) in &ai {
            for alert_id in [&plain, &incident_p1] {
                let before = rows().await;
                let refused = mute(alert_id, email, d.clone(), h.clone()).await;
                assert_eq!(
                    refused.status(),
                    StatusCode::FORBIDDEN,
                    "{email} {alert_id}"
                );
                assert_eq!(rows().await, before, "a refused mute writes no downtime");
            }
        }
        let low = mute(&incident_p3, &root, ai[1].1.clone(), ai[1].2.clone()).await;
        assert_eq!(
            low.status(),
            StatusCode::CREATED,
            "a P3 in an incident stays s15's"
        );

        let muted = mute(&incident_p1, &root, None, HeaderMap::new()).await;
        assert_eq!(muted.status(), StatusCode::CREATED);
        let muted: AlertMuteResponse =
            serde_json::from_slice(&to_bytes(muted.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        for (email, d, h) in &ai {
            let refused = extend_alert_mute(
                Path((org.clone(), incident_p1.clone(), muted.downtime_id.clone())),
                user(email),
                d.clone().map(Extension),
                h.clone(),
                Json(AlertMuteExtendRequest {
                    version: muted.version,
                    minutes: Some(1440),
                    until_clear: false,
                    ends_at: None,
                }),
            )
            .await;
            assert_eq!(refused.status(), StatusCode::FORBIDDEN, "{email}: extend");
        }
        let row = infra::table::downtimes::get_rw(&org, &muted.downtime_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.schedule.ends_at,
            Some(muted.ends_at),
            "the person's end stands"
        );

        let firing = mute(&plain, &root, None, HeaderMap::new()).await;
        assert_eq!(firing.status(), StatusCode::CREATED);
        let firing: AlertMuteResponse =
            serde_json::from_slice(&to_bytes(firing.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let unmute =
            |alert_id: &String,
             m: &AlertMuteResponse,
             (email, d, h): &(String, Option<DelegatedCaller>, HeaderMap)| {
                cancel_alert_mute(
                    Path((org.clone(), alert_id.clone(), m.downtime_id.clone())),
                    Query(CancelDowntimeQuery {
                        version: Some(m.version),
                    }),
                    user(email),
                    d.clone().map(Extension),
                    h.clone(),
                )
            };
        for caller in &ai {
            let refused = unmute(&plain, &firing, caller).await;
            assert_eq!(
                refused.status(),
                StatusCode::FORBIDDEN,
                "{}: unmute a firing",
                caller.0
            );
        }
        let kept = infra::table::downtimes::get_rw(&org, &firing.downtime_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            kept.cancelled_at, None,
            "a refused unmute keeps the downtime"
        );
        // With v2 off an incident's alert keeps the Live result; ack's rule tests cover v2 on.
        let live = unmute(&incident_p1, &muted, &ai[1]).await;
        assert_eq!(
            live.status(),
            StatusCode::OK,
            "an incident's unmute with v2 off"
        );
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

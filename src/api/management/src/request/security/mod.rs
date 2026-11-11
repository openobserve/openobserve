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

#[cfg(feature = "enterprise")]
pub mod audit;
#[cfg(feature = "enterprise")]
pub mod cases;
#[cfg(feature = "enterprise")]
pub mod intel;
#[cfg(feature = "enterprise")]
pub mod investigate;
#[cfg(feature = "enterprise")]
pub mod sigma;
#[cfg(feature = "enterprise")]
pub mod sources;
#[cfg(feature = "enterprise")]
pub mod streams;

use std::collections::HashSet;

use axum::{Json, extract::Path, response::Response};
pub use config::meta::alerts::alert::SIEM_ATTRIBUTE;
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::security::ocsf::{self, OcsfPack};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use serde::Serialize;
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(feature = "enterprise")]
#[derive(Debug, Serialize, ToSchema)]
pub struct OcsfPacksResponse {
    pub ocsf_version: String,
    pub packs: Vec<OcsfPack>,
}

/// The caller's own Security (SIEM) grants in an org.
#[derive(Debug, Default, PartialEq, Serialize, ToSchema)]
pub struct SecurityAccessResponse {
    pub read: bool,
    pub triage: bool,
    pub author: bool,
    pub admin: bool,
}

/// True when the user holds `method` on the org's `security` module; always true without RBAC.
#[cfg(feature = "enterprise")]
pub async fn security_allowed(org_id: &str, user_id: &str, method: &str) -> bool {
    #[cfg(test)]
    if let Some(allowed) = tests::granted(user_id, method) {
        return allowed;
    }
    openobserve_core::security::security_allowed(org_id, user_id, method).await
}

#[cfg(not(feature = "enterprise"))]
pub async fn security_allowed(_org_id: &str, _user_id: &str, _method: &str) -> bool {
    true
}

/// True when an alert's context attributes mark it as a SIEM detection.
pub fn marks_siem(attrs: Option<&HashMap<String, String>>) -> bool {
    config::meta::alerts::alert::is_siem_detection(attrs)
}

/// True when the stored alert `alert_id` is one of the org's SIEM detections.
pub async fn is_siem_alert(org_id: &str, alert_id: &str) -> bool {
    db::alerts::alert::any_siem_alert(org_id, [alert_id]).await
}

/// Refuses a request that touches a SIEM detection unless the user holds `method` on `security`.
pub async fn guard_siem(
    org_id: &str,
    user_id: &str,
    method: &str,
    touches_siem: bool,
) -> Result<(), Response> {
    guard_security(
        org_id,
        user_id,
        method,
        touches_siem,
        "Security detections need the Security permission",
    )
    .await
}

/// [`guard_siem`] for a request on a security case, refused in the case's own words.
pub async fn guard_siem_case(
    org_id: &str,
    user_id: &str,
    method: &str,
    is_case: bool,
) -> Result<(), Response> {
    guard_security(org_id, user_id, method, is_case, case_refusal(method)).await
}

/// Names the Security grant a case request lacks, as the role editor names it.
pub fn case_refusal(method: &str) -> &'static str {
    match method {
        "GET" => "Security cases need the Security read permission",
        "PUT" => "Security cases need the Security triage permission",
        "POST" => "Security cases need the Security write permission",
        _ => "Security cases need the Security admin permission",
    }
}

/// Like [`guard_siem`], for a request naming several stored alerts.
pub async fn guard_siem_ids<'a>(
    org_id: &str,
    user_id: &str,
    method: &str,
    alert_ids: impl IntoIterator<Item = &'a str>,
) -> Result<(), Response> {
    let touches_siem = db::alerts::alert::any_siem_alert(org_id, alert_ids).await;
    guard_siem(org_id, user_id, method, touches_siem).await
}

/// True when the incident is a security case: its durable marker, else a live detection's firing.
#[cfg(feature = "enterprise")]
pub async fn incident_touches_siem(org_id: &str, incident_id: &str) -> bool {
    use infra::table::alert_incidents;

    match alert_incidents::security_case_of(org_id, incident_id).await {
        Ok(Some(true)) => return true,
        Ok(None) => return false,
        Ok(Some(false)) => {}
        Err(e) => {
            log::error!("[SECURITY] reading the case marker of {org_id}/{incident_id}: {e}");
            return true;
        }
    }
    let fired_by_detection = match alert_incidents::get_incident_alerts(incident_id).await {
        Ok(links) => {
            db::alerts::alert::any_siem_alert(org_id, links.iter().map(|l| l.alert_id.as_str()))
                .await
        }
        Err(e) => {
            log::error!("[SECURITY] reading the firings of {org_id}/{incident_id}: {e}");
            return true;
        }
    };
    // Heals a case whose marker write was lost, so lists and the stale sweep agree with it.
    if fired_by_detection
        && let Err(e) = alert_incidents::mark_security_case(org_id, incident_id).await
    {
        log::error!("[SECURITY] marking {org_id}/{incident_id} a security case: {e}");
    }
    fired_by_detection
}

/// Which incidents a user may list: security cases need the Security read grant.
pub async fn visible_cases(
    org_id: &str,
    user_id: &str,
) -> infra::table::alert_incidents::CaseFilter {
    if security_allowed(org_id, user_id, "GET").await {
        infra::table::alert_incidents::CaseFilter::All
    } else {
        infra::table::alert_incidents::CaseFilter::NoCases
    }
}

/// [`guard_siem`] for a request on one incident: gated only when it is a security case.
#[cfg(feature = "enterprise")]
pub async fn guard_case(
    org_id: &str,
    user_id: &str,
    method: &str,
    incident_id: &str,
) -> Result<(), Response> {
    let is_case = incident_touches_siem(org_id, incident_id).await;
    guard_siem_case(org_id, user_id, method, is_case).await
}

/// Any incident but a case still needs `incidents_method`, since its route only checks a read.
#[cfg(feature = "enterprise")]
pub async fn guard_case_or_incidents(
    org_id: &str,
    user_id: &str,
    incident_id: &str,
    method: &str,
    incidents_method: &str,
) -> Result<(), Response> {
    if incident_touches_siem(org_id, incident_id).await {
        return guard_siem_case(org_id, user_id, method, true).await;
    }
    let allowed = openobserve_core::auth::check_permissions(
        org_id,
        org_id,
        user_id,
        "incidents",
        incidents_method,
        None,
        true,
        false,
        false,
    )
    .await;
    if allowed {
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden("Unauthorized Access"))
    }
}

/// Refuses unless the caller may read every named logs stream, since the search service checks
/// none.
#[cfg(feature = "enterprise")]
pub async fn guard_stream_reads<'a>(
    org_id: &str,
    user_id: &str,
    streams: impl IntoIterator<Item = &'a str>,
) -> Result<(), Response> {
    use openobserve_core::authz::{QuerySource, authorize_query_sources, stream_access_forbidden};

    let sources: Vec<QuerySource> = streams
        .into_iter()
        .map(|name| QuerySource::Stream {
            org_id: org_id.to_string(),
            stream_type: config::meta::stream::StreamType::Logs,
            name: name.to_string(),
        })
        .collect();
    authorize_query_sources(user_id, &sources)
        .await
        .map_err(|denied| stream_access_forbidden(org_id, &denied))
}

/// The named logs streams the caller may not read, judged as a search on them would be.
#[cfg(feature = "enterprise")]
pub async fn unreadable_streams<'a>(
    org_id: &str,
    user_id: &str,
    streams: impl IntoIterator<Item = &'a str>,
) -> HashSet<String> {
    use openobserve_core::authz::{Denial, QuerySource, authorize_query_sources};

    let sources: Vec<QuerySource> = streams
        .into_iter()
        .map(|name| QuerySource::Stream {
            org_id: org_id.to_string(),
            stream_type: config::meta::stream::StreamType::Logs,
            name: name.to_string(),
        })
        .collect();
    match authorize_query_sources(user_id, &sources).await {
        Ok(()) => HashSet::new(),
        Err(denied) => denied
            .denials
            .into_iter()
            .filter_map(|d| match d {
                Denial::Stream(s) => Some(s.name),
                _ => None,
            })
            .collect(),
    }
}

/// Refuses a caller who may not read the alert in its folder, as the alert's own `GET` route does.
#[cfg(feature = "enterprise")]
pub async fn guard_alert_read(
    org_id: &str,
    user_id: &str,
    alert_id: &str,
    folder_id: &str,
) -> Result<(), Response> {
    let allowed = openobserve_core::auth::check_permissions(
        alert_id,
        org_id,
        user_id,
        "alerts",
        "GET",
        Some(folder_id),
        false,
        true,
        false,
    )
    .await;
    if allowed {
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden("Unauthorized Access"))
    }
}

/// Refuses unplannable SQL or a taken name; `folder_id` is `None` on an update (stored folder).
#[cfg(feature = "enterprise")]
pub async fn validate_detection(
    org_id: &str,
    folder_id: Option<&str>,
    alert: &config::meta::alerts::alert::Alert,
) -> Result<(), Response> {
    if !marks_siem(alert.context_attributes.as_ref()) {
        return Ok(());
    }
    let own_id = alert.id.map(|id| id.to_string());
    let prefix = format!("{org_id}/");
    let message = {
        let cache = common::infra::config::ALERTS.read().await;
        let in_org: Vec<_> = cache
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, (folder, other))| (folder, other))
            .collect();
        let folder = folder_id.map(str::to_string).or_else(|| {
            in_org
                .iter()
                .find(|(_, other)| other.id.map(|id| id.to_string()) == own_id)
                .map(|(folder, _)| folder.folder_id.clone())
        });
        folder.and_then(|folder| {
            let ids: Vec<(String, &str)> = in_org
                .iter()
                .filter(|(f, _)| f.folder_id == folder)
                .map(|(_, other)| {
                    (
                        other.id.map(|id| id.to_string()).unwrap_or_default(),
                        other.name.as_str(),
                    )
                })
                .collect();
            o2_enterprise::enterprise::security::detection::duplicate_name_error(
                &alert.name,
                own_id.as_deref(),
                ids.iter().map(|(id, name)| (id.as_str(), *name)),
            )
        })
    };
    if let Some(message) = message {
        return Err(MetaHttpResponse::bad_request(message));
    }
    let Some(sql) = alert
        .query_condition
        .sql
        .as_deref()
        .filter(|sql| !sql.trim().is_empty())
    else {
        return Ok(());
    };
    openobserve_core::alerts::alert::plan_sql(org_id, alert.stream_type, sql)
        .await
        .map_err(|e| MetaHttpResponse::bad_request(format!("The detection's SQL cannot run: {e}")))
}

/// SIEM detection ids a user may not see, so alert lists and histories can drop them.
#[cfg(feature = "enterprise")]
pub async fn hidden_siem_alert_ids(org_id: &str, user_id: &str) -> HashSet<String> {
    if security_allowed(org_id, user_id, "GET").await {
        return HashSet::new();
    }
    db::alerts::alert::resolve_siem_alert_ids(org_id)
        .await
        .into_iter()
        .collect()
}

/// SIEM detection ids a user may not see, so alert lists and histories can drop them.
#[cfg(not(feature = "enterprise"))]
pub async fn hidden_siem_alert_ids(_org_id: &str, _user_id: &str) -> HashSet<String> {
    HashSet::new()
}

/// GetSecurityAccess
#[utoipa::path(
    get,
    path = "/{org_id}/security/access",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetSecurityAccess",
    summary = "The caller's Security (SIEM) access",
    description = "Whether the caller may read, triage, author detections in and administer Security in this org; answers every member, so the UI can hide what they cannot use",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SecurityAccessResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_security_access(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Json<SecurityAccessResponse> {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        Json(SecurityAccessResponse::default())
    }
    #[cfg(feature = "enterprise")]
    {
        let user_id = user_email.user_id;
        let (read, triage, author, admin) = tokio::join!(
            security_allowed(&org_id, &user_id, "GET"),
            security_allowed(&org_id, &user_id, "PUT"),
            security_allowed(&org_id, &user_id, "POST"),
            security_allowed(&org_id, &user_id, "DELETE"),
        );
        Json(SecurityAccessResponse {
            read,
            triage,
            author,
            admin,
        })
    }
}

/// ListOcsfPacks
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/security/ocsf/packs",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListOcsfPacks",
    summary = "List the built-in OCSF mapping packs",
    description = "The OCSF version and every pack compiled into this build, with its VRL program; holds no org data",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = OcsfPacksResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": true}))
    ),
)]
pub async fn list_ocsf_packs() -> Json<OcsfPacksResponse> {
    Json(OcsfPacksResponse {
        ocsf_version: ocsf::OCSF_VERSION.to_string(),
        packs: ocsf::packs().to_vec(),
    })
}

async fn guard_security(
    org_id: &str,
    user_id: &str,
    method: &str,
    gated: bool,
    refusal: &str,
) -> Result<(), Response> {
    if !gated {
        return Ok(());
    }
    if !security_allowed(org_id, user_id, method).await {
        return Err(MetaHttpResponse::forbidden(refusal));
    }
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::security::audit::mark();
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    #[cfg(feature = "enterprise")]
    use std::cell::RefCell;

    #[cfg(feature = "enterprise")]
    use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};

    use super::*;

    #[cfg(feature = "enterprise")]
    thread_local! {
        static GRANTS: RefCell<HashMap<String, Vec<&'static str>>> = RefCell::new(HashMap::new());
    }

    /// Gives `user_id` exactly these Security grants on this test thread, as OpenFGA would.
    #[cfg(feature = "enterprise")]
    pub(crate) fn grant(user_id: &str, methods: &[&'static str]) {
        GRANTS.with(|g| g.borrow_mut().insert(user_id.to_string(), methods.to_vec()));
    }

    /// The migrated SQLite meta store, set up once per test process.
    #[cfg(feature = "enterprise")]
    pub(crate) async fn meta_store() {
        static READY: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        READY
            .get_or_init(|| async {
                std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
                infra::db_init().await.unwrap();
                infra::table::migrate().await.unwrap();
            })
            .await;
    }

    /// `None` leaves users without a [`grant`] to the real check.
    #[cfg(feature = "enterprise")]
    pub(super) fn granted(user_id: &str, method: &str) -> Option<bool> {
        GRANTS.with(|g| g.borrow().get(user_id).map(|m| m.contains(&method)))
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_security_access_is_closed_in_oss() {
        let Json(access) = get_security_access(Path("org".to_string())).await;
        assert_eq!(access, SecurityAccessResponse::default());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_list_ocsf_packs_returns_the_version_and_every_pack() {
        let response = list_ocsf_packs().await.into_response();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["ocsf_version"], "1.6.0");
        let packs = body["packs"].as_array().unwrap();
        assert_eq!(packs.len(), ocsf::packs().len());
        let entity = packs.iter().find(|p| p["id"] == "entity").unwrap();
        let mut keys = entity
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(
            keys,
            [
                "id",
                "kind",
                "label",
                "ocsf_classes",
                "product_name",
                "requires_all",
                "source_type",
                "vendor_name",
                "version",
                "vrl"
            ]
        );
        assert_eq!(entity["kind"], "entity");
        assert_eq!(entity["version"], 1);
        assert!(entity["vrl"].as_str().unwrap().ends_with("\n."));
    }

    #[cfg(feature = "enterprise")]
    mod siem_detection_gate {
        use axum::extract::Query;
        use config::meta::{alerts::alert::Alert, folder::Folder};
        use openobserve_api_common::extractors::Headers;
        use openobserve_core::auth::UserEmail;
        use svix_ksuid::{Ksuid, KsuidLike};

        use super::*;
        use crate::{
            models::alerts::requests::EnableAlertQuery,
            request::alerts::{delete_alert, enable_alert},
        };

        async fn plant_siem_detection(org: &str) -> String {
            let id = Ksuid::new(None, None);
            let mut alert = Alert::default();
            alert.id = Some(id);
            alert.org_id = org.to_string();
            alert.context_attributes = Some(
                [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                    .into_iter()
                    .collect(),
            );
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(org, &id.to_string()),
                (Folder::default(), alert),
            );
            id.to_string()
        }

        fn stranger() -> Headers<UserEmail> {
            Headers(UserEmail {
                user_id: format!("{}@example.com", config::ider::uuid()),
            })
        }

        async fn refusal_message(response: Response) -> String {
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            body["message"].as_str().unwrap_or_default().to_string()
        }

        #[tokio::test]
        async fn test_disabling_a_siem_detection_needs_the_security_grant() {
            let org = format!("gate_{}", config::ider::uuid());
            let id = plant_siem_detection(&org).await;
            let resp = enable_alert(
                Path((org.clone(), id)),
                Query(EnableAlertQuery {
                    value: false,
                    folder: None,
                }),
                stranger(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        }

        #[tokio::test]
        async fn test_deleting_a_siem_detection_needs_the_security_grant() {
            let org = format!("gate_{}", config::ider::uuid());
            let id = plant_siem_detection(&org).await;
            let resp = delete_alert(Path((org.clone(), id)), stranger()).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        }

        #[tokio::test]
        async fn test_bulk_writes_are_gated_only_when_they_name_a_siem_detection() {
            let org = format!("gate_{}", config::ider::uuid());
            let id = plant_siem_detection(&org).await;
            let other = Ksuid::new(None, None).to_string();
            let Headers(user) = stranger();
            let refused = guard_siem_ids(&org, &user.user_id, "DELETE", [other.as_str(), &id])
                .await
                .unwrap_err();
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
            assert!(
                guard_siem_ids(&org, &user.user_id, "DELETE", [other.as_str()])
                    .await
                    .is_ok()
            );
        }

        /// An ops-style incident a SIEM detection fired into, opened before the case marker.
        async fn unmarked_case(org: &str, detection: &str) -> String {
            tests::meta_store().await;
            let incident = infra::table::alert_incidents::create(
                org,
                "P2",
                serde_json::json!({}),
                "AlertId",
                1,
                Some("case".to_string()),
            )
            .await
            .unwrap();
            infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                detection,
                "detection",
                "internal",
                1,
                "alert_id",
            )
            .await
            .unwrap();
            incident.id
        }

        async fn forget_detection(org: &str, id: &str) {
            common::infra::config::ALERTS
                .write()
                .await
                .remove(&db::alerts::alert::cache_alert_key(org, id));
        }

        #[tokio::test]
        async fn test_a_deleted_detections_case_still_needs_security_and_a_verdict() {
            use crate::request::alerts::incidents::{
                IncidentStatus, UpdatePayload, update_incident,
            };

            let org = format!("gate_{}", config::ider::uuid());
            let id = plant_siem_detection(&org).await;
            let case = unmarked_case(&org, &id).await;
            assert!(incident_touches_siem(&org, &case).await);
            forget_detection(&org, &id).await;

            assert!(
                incident_touches_siem(&org, &case).await,
                "the marker outlives the detection"
            );
            let Headers(outsider) = stranger();
            tests::grant(&outsider.user_id, &["GET"]);
            tests::grant(&format!("triager-{}", outsider.user_id), &["GET", "PUT"]);
            let ops = format!("ops-{}", outsider.user_id);
            tests::grant(&ops, &[]);
            let refused = guard_case(&org, &ops, "GET", &case).await.unwrap_err();
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
            let reader = &outsider.user_id;
            let refused = guard_case(&org, reader, "PUT", &case).await.unwrap_err();
            assert_eq!(
                refusal_message(refused).await,
                "Security cases need the Security triage permission"
            );
            let refused = guard_siem(&org, reader, "PUT", true).await.unwrap_err();
            assert_eq!(
                refusal_message(refused).await,
                "Security detections need the Security permission"
            );
            assert_eq!(
                visible_cases(&org, &ops).await,
                infra::table::alert_incidents::CaseFilter::NoCases
            );

            let triager = Headers(UserEmail {
                user_id: format!("triager-{}", outsider.user_id),
            });
            let resp = update_incident(
                Path((org.clone(), case.clone())),
                triager,
                Json(UpdatePayload::Status {
                    status: IncidentStatus::Resolved,
                    verdict: None,
                    reason: None,
                }),
            )
            .await;
            assert_eq!(
                resp.status(),
                StatusCode::BAD_REQUEST,
                "closing still needs a verdict"
            );
        }

        /// A SIEM detection stored in the org's alert table and cache, readable by a root user.
        async fn stored_siem_detection(org: &str) -> (String, String) {
            stored_siem_detection_with(org, &[]).await
        }

        /// [`stored_siem_detection`] with extra context attributes.
        async fn stored_siem_detection_with(org: &str, extra: &[(&str, &str)]) -> (String, String) {
            use config::meta::folder::FolderType;

            tests::meta_store().await;
            let folder = Folder {
                folder_id: "siem".to_string(),
                name: "Security Detections".to_string(),
                ..Default::default()
            };
            infra::table::folders::put(org, None, folder, FolderType::Alerts)
                .await
                .unwrap();
            let mut alert = Alert::default();
            alert.name = "brute_force".to_string();
            alert.org_id = org.to_string();
            alert.stream_name = "web".to_string();
            alert.context_attributes = Some(
                [(SIEM_ATTRIBUTE, "true")]
                    .iter()
                    .chain(extra)
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            );
            let alert = infra::table::alerts::create(
                infra::db::get_orm_client_rw().await,
                org,
                "siem",
                alert,
                false,
            )
            .await
            .unwrap();
            let id = alert.id.unwrap().to_string();
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(org, &id),
                (Folder::default(), alert),
            );
            let root = format!("root-{org}@example.com");
            common::infra::config::ORG_USERS.insert(
                format!("{}/{root}", config::DEFAULT_ORG),
                infra::table::org_users::OrgUserRecord::new(
                    config::DEFAULT_ORG,
                    &root,
                    config::meta::user::UserRole::Root,
                    "token",
                    None,
                ),
            );
            (id, root)
        }

        fn caller(user: &str) -> Headers<UserEmail> {
            Headers(UserEmail {
                user_id: user.to_string(),
            })
        }

        #[tokio::test]
        async fn test_a_detections_groups_and_transitions_need_security_read() {
            use crate::request::alerts::{list_alert_group_transitions, list_alert_groups};

            let org = format!("gate_{}", config::ider::uuid());
            let (id, root) = stored_siem_detection(&org).await;
            let path = || Path((org.clone(), id.clone()));
            let transitions = || async {
                list_alert_group_transitions(path(), Query(Default::default()), caller(&root)).await
            };

            tests::grant(&root, &[]);
            let groups = list_alert_groups(path(), caller(&root)).await;
            assert_eq!(groups.status(), StatusCode::FORBIDDEN);
            assert_eq!(transitions().await.status(), StatusCode::FORBIDDEN);

            tests::grant(&root, &["GET"]);
            let groups = list_alert_groups(path(), caller(&root)).await;
            assert_eq!(groups.status(), StatusCode::OK);
            assert_eq!(transitions().await.status(), StatusCode::OK);
        }

        #[tokio::test]
        async fn test_composites_referencing_a_detection_need_security_read() {
            use crate::request::alerts::get_composite_references;

            let org = format!("gate_{}", config::ider::uuid());
            let (id, root) = stored_siem_detection(&org).await;

            tests::grant(&root, &[]);
            let refused =
                get_composite_references(Path((org.clone(), id.clone())), caller(&root)).await;
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
            tests::grant(&root, &["GET"]);
            let allowed = get_composite_references(Path((org.clone(), id)), caller(&root)).await;
            assert_eq!(allowed.status(), StatusCode::OK);
        }

        fn logs(org: &str, name: &str) -> openobserve_core::authz::TypedStream {
            openobserve_core::authz::TypedStream {
                org_id: org.to_string(),
                stream_type: config::meta::stream::StreamType::Logs,
                name: name.to_string(),
            }
        }

        #[tokio::test]
        async fn test_detection_evidence_needs_the_alert_and_its_stream() {
            use crate::request::security::sigma::{EvidenceParams, get_detection_evidence};

            const RULE: &str = "title: t\nlogsource:\n  product: test\ndetection:\n  sel:\n    user: bob\n  condition: sel\n";
            let checker = openobserve_core::authz::fake_checker();
            let org = format!("gate_{}", config::ider::uuid());
            let (id, root) = stored_siem_detection_with(&org, &[("sigma_yaml", RULE)]).await;
            let evidence = |user: String| {
                let path = Path((org.clone(), id.clone()));
                async move {
                    let params: EvidenceParams = serde_json::from_value(
                        serde_json::json!({"firing_time": 1, "start_time": 1, "end_time": 2}),
                    )
                    .unwrap();
                    get_detection_evidence(path, Query(params), caller(&user)).await
                }
            };
            tests::grant(&root, &["GET"]);
            assert_eq!(
                evidence(root.clone()).await.status(),
                StatusCode::FORBIDDEN,
                "no read on the detection's stream"
            );
            checker.grant_read(&root, &logs(&org, "web"));
            assert_eq!(evidence(root.clone()).await.status(), StatusCode::OK);

            let Headers(outsider) = stranger();
            tests::grant(&outsider.user_id, &["GET"]);
            checker.grant_read(&outsider.user_id, &logs(&org, "web"));
            assert_eq!(
                evidence(outsider.user_id).await.status(),
                StatusCode::FORBIDDEN,
                "no read on the detection in its folder"
            );
        }

        #[tokio::test]
        async fn test_a_case_from_an_event_needs_read_on_its_stream() {
            use crate::request::security::cases::{PromoteRequest, promote_to_case};

            tests::meta_store().await;
            let checker = openobserve_core::authz::fake_checker();
            let org = format!("gate_{}", config::ider::uuid());
            let Headers(triager) = stranger();
            tests::grant(&triager.user_id, &["GET", "PUT"]);
            let promote = || async {
                let req: PromoteRequest = serde_json::from_value(serde_json::json!({
                    "event": {"stream": "okta", "timestamp": 1, "fields": {"actor": "bob@acme.io"}}
                }))
                .unwrap();
                promote_to_case(Path(org.clone()), caller(&triager.user_id), Json(req)).await
            };
            assert_eq!(promote().await.status(), StatusCode::FORBIDDEN);
            checker.grant_read(&triager.user_id, &logs(&org, "okta"));
            assert_eq!(promote().await.status(), StatusCode::OK);
        }

        #[tokio::test]
        async fn test_investigation_needs_read_on_every_planned_stream() {
            use crate::request::security::investigate::{EntitiesRequest, list_entities};

            let checker = openobserve_core::authz::fake_checker();
            let org = format!("gate_{}", config::ider::uuid());
            let Headers(analyst) = stranger();
            tests::grant(&analyst.user_id, &["GET"]);
            checker.grant_read(&analyst.user_id, &logs(&org, "okta"));
            let now = chrono::Utc::now().timestamp_micros();
            let entities = |streams: &[&str]| {
                let req: EntitiesRequest = serde_json::from_value(serde_json::json!({
                    "startTime": now - 3_600_000_000_i64,
                    "endTime": now,
                    "plans": streams.iter().map(|s| serde_json::json!({"stream": s})).collect::<Vec<_>>(),
                }))
                .unwrap();
                list_entities(Path(org.clone()), caller(&analyst.user_id), Json(req))
            };
            assert_eq!(
                entities(&["okta", "edr"]).await.status(),
                StatusCode::FORBIDDEN
            );
            assert_eq!(entities(&["okta"]).await.status(), StatusCode::OK);
        }

        #[tokio::test]
        async fn test_stream_reads_follow_the_callers_grants() {
            let checker = openobserve_core::authz::fake_checker();
            let org = format!("gate_{}", config::ider::uuid());
            let Headers(user) = stranger();
            checker.grant_read(&user.user_id, &logs(&org, "okta"));
            assert!(
                guard_stream_reads(&org, &user.user_id, ["okta"])
                    .await
                    .is_ok()
            );
            let refused = guard_stream_reads(&org, &user.user_id, ["okta", "edr"])
                .await
                .unwrap_err();
            assert_eq!(refused.status(), StatusCode::FORBIDDEN);
            checker.grant_admin(&org, &user.user_id);
            assert!(
                guard_stream_reads(&org, &user.user_id, ["edr"])
                    .await
                    .is_ok()
            );
        }

        #[tokio::test]
        async fn test_unreadable_streams_names_only_the_refused_ones() {
            let checker = openobserve_core::authz::fake_checker();
            let org = format!("gate_{}", config::ider::uuid());
            let Headers(user) = stranger();
            assert_eq!(
                unreadable_streams(&org, &user.user_id, ["okta", "edr"]).await,
                HashSet::from(["okta".to_string(), "edr".to_string()]),
                "a Security grant alone reads no stream"
            );
            checker.grant_read(&user.user_id, &logs(&org, "okta"));
            assert_eq!(
                unreadable_streams(&org, &user.user_id, ["okta", "edr"]).await,
                HashSet::from(["edr".to_string()])
            );
            checker.grant_admin(&org, &user.user_id);
            assert!(
                unreadable_streams(&org, &user.user_id, ["okta", "edr"])
                    .await
                    .is_empty()
            );
        }

        #[tokio::test]
        async fn test_an_incident_no_detection_fired_into_is_no_case() {
            let org = format!("gate_{}", config::ider::uuid());
            let incident = unmarked_case(&org, "2ops").await;
            assert!(!incident_touches_siem(&org, &incident).await);
            assert!(!incident_touches_siem(&org, "missing").await);
        }
    }
}

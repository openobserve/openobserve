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

//! Change-event intake: CI posts with a `change_events` integration token in the URL, a user posts
//! with `incidents` POST. The token route is in `basic_routes()`; see GHSA-wffq-g8qf-ccmv.

#![cfg_attr(not(feature = "enterprise"), allow(dead_code))]

use async_trait::async_trait;
#[cfg(feature = "enterprise")]
use axum::Json;
use axum::{extract::Path, http::StatusCode, response::Response};
use config::{
    meta::alerts::change_events::{CHANGE_EVENTS_SOURCE_TYPE, Provenance, parse_events},
    utils::json::Value,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_core::alerts::change_events::ChangeWriteError;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use serde::Serialize;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Maximum request body size accepted on both intake routes (bytes).
pub const MAX_BODY_BYTES: usize = 1_048_576;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ChangeEventsAccepted {
    pub accepted: usize,
}

/// Where accepted rows go; the stream in production, a recorder in tests.
#[async_trait]
trait ChangeSink: Send + Sync {
    async fn write(&self, org: &str, records: Vec<Value>) -> Result<(), ChangeWriteError>;
}

struct StreamSink;

#[async_trait]
impl ChangeSink for StreamSink {
    async fn write(&self, org: &str, records: Vec<Value>) -> Result<(), ChangeWriteError> {
        openobserve_core::alerts::change_events::write_events(org, records).await
    }
}

#[cfg(feature = "enterprise")]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/changes",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "IngestIncidentChanges",
    summary = "Record changes made outside OpenObserve",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::alerts::change_events::ChangeEventsRequest, description = "One change event, or {events: [..]} with 1 to 100", content_type = "application/json"),
    responses(
        (status = 200, description = "Stored", content_type = "application/json", body = ChangeEventsAccepted),
        (status = 400, description = "Invalid event or more than 100 events"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn ingest_changes(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<Value>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }
    let permitted = openobserve_core::auth::check_permissions(
        &org_id,
        &org_id,
        &user.user_id,
        "incidents",
        "POST",
        None,
        true,
        false,
        false,
    )
    .await;
    ingest_in_app(&StreamSink, &org_id, &user.user_id, permitted, body).await
}

#[cfg(feature = "enterprise")]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/incidents/changes/{token}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "IngestIncidentChangesWithToken",
    summary = "Record changes from CI with a change-events token in the URL",
    security(),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Change-events integration token"),
    ),
    request_body(content = config::meta::alerts::change_events::ChangeEventsRequest, description = "One change event, or {events: [..]} with 1 to 100", content_type = "application/json"),
    responses(
        (status = 200, description = "Stored", content_type = "application/json", body = ChangeEventsAccepted),
        (status = 400, description = "Invalid event or more than 100 events"),
        (status = 401, description = "Not a change-events token of this organization"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn ingest_changes_url_token(
    Path((org_id, token)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }
    ingest_ci(&StreamSink, &org_id, &token, body).await
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/changes",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "IngestIncidentChanges",
    summary = "Record changes made outside OpenObserve",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::alerts::change_events::ChangeEventsRequest, description = "One change event, or {events: [..]} with 1 to 100", content_type = "application/json"),
    responses(
        (status = 403, description = "Not supported without enterprise features"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn ingest_changes(_path: Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/incidents/changes/{token}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "IngestIncidentChangesWithToken",
    summary = "Record changes from CI with a change-events token in the URL",
    security(),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("token" = String, Path, description = "Change-events integration token"),
    ),
    request_body(content = config::meta::alerts::change_events::ChangeEventsRequest, description = "One change event, or {events: [..]} with 1 to 100", content_type = "application/json"),
    responses(
        (status = 403, description = "Not supported without enterprise features"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn ingest_changes_url_token(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

/// Whether `source_type` is a change-events credential, which no other intake accepts.
pub fn is_change_events_source(source_type: &str) -> bool {
    source_type == CHANGE_EVENTS_SOURCE_TYPE
}

/// 401 with a 401 body; `MetaHttpResponse::unauthorized` answers 403.
pub fn unauthorized() -> Response {
    use axum::response::IntoResponse;
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(MetaHttpResponse::error(
            StatusCode::UNAUTHORIZED,
            "invalid change events token",
        )),
    )
        .into_response()
}

#[cfg(feature = "enterprise")]
fn gate_enabled() -> Option<Response> {
    use o2_enterprise::enterprise::common::config::get_config as o2_config;
    (!o2_config().incidents.enabled).then(|| MetaHttpResponse::forbidden("Incidents not enabled"))
}

async fn ingest_in_app(
    sink: &dyn ChangeSink,
    org_id: &str,
    user_id: &str,
    permitted: bool,
    body: Value,
) -> Response {
    if !permitted {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    store(sink, org_id, body, &Provenance::InApp { user: user_id })
        .await
        .0
}

async fn ingest_ci(sink: &dyn ChangeSink, org_id: &str, token: &str, body: Value) -> Response {
    let integration = match authorize_ci(org_id, token).await {
        Ok(integration) => integration,
        Err(resp) => return resp,
    };
    let provenance = Provenance::Integration {
        id: &integration.id,
        name: &integration.name,
    };
    let (resp, accepted, rejected) = store(sink, org_id, body, &provenance).await;
    let touched = infra::table::incident_integrations::touch_sender(
        infra::table::incident_integrations::TouchSenderParams {
            integration_id: &integration.id,
            detected_source: CHANGE_EVENTS_SOURCE_TYPE,
            sender_label: None,
            now: chrono::Utc::now().timestamp_micros(),
            accepted,
            rejected,
            saw_resolved: false,
        },
    )
    .await;
    if let Err(e) = touched {
        log::warn!("[change_events] could not record the sender of {org_id}: {e}");
    }
    resp
}

/// The enabled `change_events` row of `org_id` holding `token`; any other token is a 401.
async fn authorize_ci(
    org_id: &str,
    token: &str,
) -> Result<infra::table::incident_integrations::IncidentIntegrationRecord, Response> {
    let Some(token) = super::external_events::extract_token(None, Some(token)) else {
        return Err(unauthorized());
    };
    let integration = match infra::table::incident_integrations::find_by_token(&token).await {
        Ok(Some(i)) if i.org_id == org_id && is_change_events_source(&i.source_type) => i,
        Ok(_) => return Err(unauthorized()),
        Err(e) => return Err(MetaHttpResponse::internal_error(e)),
    };
    if let Some(resp) = super::external_events::inactive_org_response(&integration.org_id).await {
        return Err(resp);
    }
    Ok(integration)
}

/// The response, and how many events were accepted and rejected for the sender row.
async fn store(
    sink: &dyn ChangeSink,
    org_id: &str,
    body: Value,
    provenance: &Provenance<'_>,
) -> (Response, u32, u32) {
    let now = chrono::Utc::now().timestamp_micros();
    let limit = &config::get_config().limit;
    let window = (
        now - limit.ingest_allowed_upto_micro,
        now + limit.ingest_allowed_in_future_micro,
    );
    let events = match parse_events(body, window) {
        Ok(events) => events,
        Err(reason) => return (MetaHttpResponse::bad_request(reason), 0, 1),
    };
    let count = events.len();
    let records = events
        .into_iter()
        .map(|event| event.into_record(provenance, now))
        .collect();
    let n = count as u32;
    match sink.write(org_id, records).await {
        Ok(()) => (
            MetaHttpResponse::json(ChangeEventsAccepted { accepted: count }),
            n,
            0,
        ),
        Err(ChangeWriteError::Disabled(m)) => (MetaHttpResponse::forbidden(m), 0, n),
        Err(ChangeWriteError::NotReady(m)) => (MetaHttpResponse::service_unavailable(m), 0, n),
        Err(ChangeWriteError::Failed(m)) => {
            log::error!("[change_events] could not store the events of {org_id}: {m}");
            (
                MetaHttpResponse::internal_error("the change events were not stored"),
                0,
                n,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use infra::table::incident_integrations::{self as integrations, IncidentIntegrationRecord};
    use serde_json::json;

    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        written: Mutex<Vec<(String, Vec<Value>)>>,
    }

    #[async_trait]
    impl ChangeSink for RecordingSink {
        async fn write(&self, org: &str, records: Vec<Value>) -> Result<(), ChangeWriteError> {
            self.written
                .lock()
                .unwrap()
                .push((org.to_string(), records));
            Ok(())
        }
    }

    async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    async fn integration(org: &str, name: &str, source_type: &str) -> IncidentIntegrationRecord {
        let custom = config::meta::organization::OrganizationType::Custom;
        let _ = infra::table::organizations::add(org, org, custom).await;
        let now = chrono::Utc::now().timestamp_micros();
        let record = IncidentIntegrationRecord {
            id: format!("{name}-{now}"),
            org_id: org.to_string(),
            name: name.to_string(),
            source_type: source_type.to_string(),
            token: integrations::generate_token(),
            enabled: true,
            config: json!({}),
            destinations: vec![],
            oncall_team: None,
            created_by: "admin@example.com".to_string(),
            created_at: now,
            updated_at: now,
        };
        integrations::add(&record).await.unwrap();
        record
    }

    fn event() -> Value {
        json!({"service": "checkout", "kind": "deploy", "summary": "v42", "integration_name": "forged"})
    }

    async fn body(resp: Response) -> Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn alert_intake(org: &str, token: &str) -> Result<String, StatusCode> {
        super::super::external_events::authorize_alert_source(org, Some(token.to_string()))
            .await
            .map(|i| i.id)
            .map_err(|r| r.status())
    }

    #[tokio::test]
    async fn a_change_events_token_of_the_org_is_accepted_and_names_the_rows() {
        meta_store().await;
        let org = format!("chg-ci-{}", chrono::Utc::now().timestamp_micros());
        let row = integration(&org, "deploy-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        let sink = RecordingSink::default();
        let resp = ingest_ci(
            &sink,
            &org,
            &row.token,
            json!({"events": [event(), event()]}),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body(resp).await, json!({"accepted": 2}));
        let written = sink.written.lock().unwrap().clone();
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].0, org);
        for record in &written[0].1 {
            assert_eq!(record["integration_name"], "deploy-bot");
            assert_eq!(record["integration_id"], row.id.as_str());
        }
        let senders = integrations::list_senders(&row.id).await.unwrap();
        assert_eq!(senders.len(), 1);
        assert_eq!(senders[0].accepted_count, 2);
    }

    #[tokio::test]
    async fn every_other_token_is_a_401_and_writes_nothing() {
        meta_store().await;
        let org = format!("chg-deny-{}", chrono::Utc::now().timestamp_micros());
        let other = format!("{org}-other");
        let foreign = integration(&other, "deploy-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        let alerts = integration(&org, "grafana", "auto").await;
        let disabled = integration(&org, "old-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        integrations::set_enabled(&org, &disabled.id, false)
            .await
            .unwrap();
        let rotated = integration(&org, "rotated-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        integrations::rotate_token(&org, &rotated.id).await.unwrap();
        let sink = RecordingSink::default();
        for (label, token) in [
            ("wrong org", foreign.token.as_str()),
            ("alert source", alerts.token.as_str()),
            ("disabled", disabled.token.as_str()),
            ("rotated out", rotated.token.as_str()),
            ("not a token", "o2oi_plain"),
        ] {
            let resp = ingest_ci(&sink, &org, token, event()).await;
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{label}");
        }
        assert!(sink.written.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_alert_intake_refuses_a_change_events_token_only_in_its_own_org() {
        meta_store().await;
        let org = format!("chg-alert-{}", chrono::Utc::now().timestamp_micros());
        let other = format!("{org}-other");
        let change = integration(&org, "deploy-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        let alerts = integration(&org, "grafana", "auto").await;
        assert_eq!(
            alert_intake(&org, &change.token).await,
            Err(StatusCode::UNAUTHORIZED)
        );
        assert_eq!(
            alert_intake(&other, &change.token).await,
            Err(StatusCode::NOT_FOUND),
            "a foreign org learned the token type"
        );
        assert_eq!(alert_intake(&org, &alerts.token).await, Ok(alerts.id));
        assert_eq!(
            alert_intake(&other, &alerts.token).await,
            Err(StatusCode::NOT_FOUND)
        );
        assert_eq!(
            alert_intake(&org, "o2iat_unknown").await,
            Err(StatusCode::NOT_FOUND)
        );
    }

    #[tokio::test]
    async fn an_invalid_or_oversized_batch_is_a_400() {
        meta_store().await;
        let org = format!("chg-bad-{}", chrono::Utc::now().timestamp_micros());
        let row = integration(&org, "deploy-bot", CHANGE_EVENTS_SOURCE_TYPE).await;
        let sink = RecordingSink::default();
        let over = json!({"events": vec![event(); 101]});
        let resp = ingest_ci(&sink, &org, &row.token, over).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let mut missing = event();
        missing.as_object_mut().unwrap().remove("summary");
        let resp = ingest_ci(&sink, &org, &row.token, missing).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(sink.written.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_in_app_route_needs_incidents_post_and_records_the_user() {
        let sink = RecordingSink::default();
        let resp = ingest_in_app(&sink, "demo-org", "ana@example.com", false, event()).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert!(sink.written.lock().unwrap().is_empty());
        let resp = ingest_in_app(&sink, "demo-org", "ana@example.com", true, event()).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let written = sink.written.lock().unwrap().clone();
        let record = &written[0].1[0];
        assert_eq!(record["integration"], "in-app");
        assert_eq!(record["created_by"], "ana@example.com");
        assert!(record.get("integration_name").is_none());
    }

    #[test]
    fn only_a_change_events_row_is_a_change_events_source() {
        assert!(is_change_events_source("change_events"));
        for other in ["auto", "grafana", "alertmanager", "generic"] {
            assert!(!is_change_events_source(other));
        }
        assert_eq!(unauthorized().status(), StatusCode::UNAUTHORIZED);
    }
}

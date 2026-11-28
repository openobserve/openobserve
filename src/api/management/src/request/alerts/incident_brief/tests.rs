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

use std::{future::Future, time::Duration};

use arrow_schema::{DataType, Field, Schema};
use axum::http::{StatusCode, header};
use config::{
    meta::{
        alerts::{
            alert::Alert,
            incidents::{IncidentEvent, IncidentEventType},
            rca_runs::{RunMode, RunSubjectType, RunTrigger},
        },
        folder::Folder,
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::{
    idempotency::canonical_sha256,
    table::{
        alert_incidents,
        entity::{
            alert_incidents::Model as Incident, incident_contexts::Model as Context,
            service_version_deploys,
        },
        incident_contexts, incident_events, rca_fence,
        rca_runs::{self, NewRun, RunUpdate, StartGuards, StartResult},
    },
};
use openobserve_core::authz::{TypedStream, fake_checker};
use sea_orm::{ActiveModelTrait, IntoActiveModel, Set, TransactionTrait};
use serde_json::{Value, json};
use svix_ksuid::{Ksuid, KsuidLike};

use super::*;
use crate::request::security::{self, rca_scope};

async fn incident(scope: Value) -> Incident {
    security::tests::meta_store().await;
    let org = format!("brief_{}", rca_runs::new_run_id().to_lowercase());
    alert_incidents::create(
        &org,
        "P2",
        scope,
        "AlertId",
        now_micros() - 120_000_000,
        Some("checkout errors".into()),
    )
    .await
    .unwrap()
}

async fn opening_alert(incident: &Incident) {
    let fields = ["service", "env", "region"].map(|name| Field::new(name, DataType::Utf8, false));
    let mut fields = Vec::from(fields);
    fields.push(Field::new("_timestamp", DataType::Int64, false));
    infra::schema::merge(
        &incident.org_id,
        "app_a",
        StreamType::Logs,
        &Schema::new(fields),
        Some(incident.first_alert_at),
    )
    .await
    .unwrap();
    let id = Ksuid::new(None, None);
    let mut alert = Alert::default();
    alert.id = Some(id);
    alert.name = "checkout errors".into();
    alert.org_id = incident.org_id.clone();
    alert.stream_type = StreamType::Logs;
    alert.stream_name = "app_a".into();
    alert.trigger_condition.period = 1;
    common::infra::config::ALERTS.write().await.insert(
        db::alerts::alert::cache_alert_key(&incident.org_id, &id.to_string()),
        (Folder::default(), alert),
    );
    alert_incidents::add_alert_to_incident(
        &incident.id,
        &id.to_string(),
        "checkout errors",
        "internal",
        incident.first_alert_at,
        "primary_match",
    )
    .await
    .unwrap();
    impact::install_search_rows(
        &incident.org_id,
        vec![
            json!({"zo_onset_at": incident.first_alert_at - 60_000_000, "zo_onset_value": 3}),
            json!({"zo_onset_at": incident.first_alert_at + 60_000_000, "zo_onset_value": 18}),
        ],
    );
}

async fn detected_deploy(incident: &Incident) {
    let row = service_version_deploys::Model {
        deploy_key: canonical_sha256(&json!([
            incident.org_id,
            "checkout",
            "env:prod",
            "east",
            "v2",
            incident.first_alert_at,
        ])),
        org_id: incident.org_id.clone(),
        service_name: "checkout".into(),
        where_key: "env:prod".into(),
        scope_key: format!("{}-prod", incident.id),
        cluster: "east".into(),
        to_version: "v2".into(),
        to_version_key: format!("{}-v2", incident.id),
        kind: "deploy".into(),
        entry_source: "traffic".into(),
        at: incident.first_alert_at,
        share_at_entry: 1.0,
        serving_versions: "[]".into(),
        full_serving: "[]".into(),
        source_streams: r#"["logs/app_a"]"#.into(),
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        ..Default::default()
    };
    assert!(
        infra::table::service_version_deploys::put(infra::db::get_orm_client_rw().await, row)
            .await
            .unwrap()
    );
}

async fn request(incident: &Incident, viewer: &str, refresh: bool, headers: HeaderMap) -> Response {
    get(
        Path((incident.org_id.clone(), incident.id.clone())),
        Query(BriefQuery { refresh }),
        Headers(UserEmail {
            user_id: viewer.to_string(),
        }),
        headers,
    )
    .await
}

async fn body(response: Response) -> Value {
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn a_declared_incident_without_any_firing_is_identified_in_the_brief() {
    let incident = incident(json!({"service": "checkout"})).await;
    let viewer = format!("reader@{}.example", incident.org_id);
    let at = incident.first_alert_at;
    let start = at - 60_000_000;
    let txn = infra::db::get_orm_client_rw().await.begin().await.unwrap();
    let context = Context {
        id: config::ider::generate(),
        org_id: incident.org_id.clone(),
        incident_id: incident.id.clone(),
        role: "declared".into(),
        kind: "logs".into(),
        title: "Checkout errors".into(),
        note: None,
        target: json!({
            "signal": "logs", "streams": ["app_a"],
            "sql": "SELECT * FROM app_a", "start_us": start, "end_us": at,
        })
        .to_string(),
        origin: json!({"route": "/logs"}).to_string(),
        start_at: start,
        end_at: at,
        result_summary: None,
        bytes: 0,
        client_key: None,
        created_by: viewer.clone(),
        deleted_at: None,
        created_at: at,
        updated_at: at,
    };
    assert!(incident_contexts::insert_in(&txn, context).await.unwrap());
    incident_events::append_in(
        &txn,
        &incident.org_id,
        &incident.id,
        IncidentEvent {
            timestamp: at,
            seq: 0,
            event_type: IncidentEventType::Declared {
                declared_by: viewer.clone(),
            },
        },
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();

    let brief = body(request(&incident, &viewer, false, HeaderMap::new()).await).await;
    assert_eq!(brief["declared_no_alert"], true);
}

#[tokio::test]
async fn a_service_only_declaration_is_identified_without_a_context() {
    let incident = incident(json!({"service": "checkout"})).await;
    let viewer = format!("reader@{}.example", incident.org_id);
    incident_events::append(
        &incident.org_id,
        &incident.id,
        IncidentEvent {
            timestamp: incident.first_alert_at,
            seq: 0,
            event_type: IncidentEventType::Declared {
                declared_by: viewer.clone(),
            },
        },
    )
    .await
    .unwrap();

    let brief = body(request(&incident, &viewer, false, HeaderMap::new()).await).await;
    assert_eq!(brief["declared_no_alert"], true);
}

#[tokio::test]
async fn briefs_do_not_share_impact_or_changes_between_different_stream_grants() {
    let incident = incident(json!({"service": "checkout", "env": "prod", "region": "east"})).await;
    opening_alert(&incident).await;
    detected_deploy(&incident).await;
    let mut published = incident.clone().into_active_model();
    published.impact_headline = Set(Some("18".into()));
    published
        .update(infra::db::get_orm_client_rw().await)
        .await
        .unwrap();
    let viewer_a = format!("a@{}.example", incident.org_id);
    let viewer_b = format!("b@{}.example", incident.org_id);
    fake_checker().grant_read(
        &viewer_a,
        &TypedStream {
            org_id: incident.org_id.clone(),
            stream_type: StreamType::Logs,
            name: "app_a".into(),
        },
    );

    let response = request(&incident, &viewer_a, false, HeaderMap::new()).await;
    let a_tag = response.headers()[header::ETAG].clone();
    let a = body(response).await;
    let searches = impact::search_count(&incident.org_id);
    assert!(searches > 0);
    let mut headers = HeaderMap::new();
    headers.insert(header::IF_NONE_MATCH, a_tag);
    let b = body(request(&incident, &viewer_b, false, headers).await).await;
    assert_eq!(impact::search_count(&incident.org_id), searches);

    assert_eq!(a["impact"]["value"], 18.0);
    assert_eq!(b["impact"]["value"], a["impact"]["value"]);
    assert_eq!(a["impact"]["series"].as_array().unwrap().len(), 2);
    assert!(b["impact"].get("series").is_none());
    assert!(b["impact"]["source"].is_null());
    assert_eq!(a["onset"]["precision_secs"], 120);
    assert_eq!(
        a["grouping"],
        json!({"reason": "primary_match", "alert_count": 1})
    );
    assert_eq!(a["changes"].as_array().unwrap().len(), 1);
    assert!(a["change_coverage"].get("regions").is_none());
    assert_eq!(b["changes"], json!([]));
    let hides_app_a = |brief: &Value| {
        brief["hidden"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["stream"] == "app_a" && entry["stream_type"] == "logs")
    };
    assert!(!hides_app_a(&a));
    assert!(hides_app_a(&b));
    assert_ne!(a["computed_at"], b["computed_at"]);
}

#[tokio::test]
async fn the_same_fingerprint_reuses_the_brief_until_refresh_or_an_event() {
    let incident = incident(json!({})).await;
    let viewer = format!("reader@{}.example", incident.org_id);
    let first = request(&incident, &viewer, false, HeaderMap::new()).await;
    let first_tag = first.headers()[header::ETAG].clone();
    let first = body(first).await;
    assert_eq!(
        first_tag.to_str().unwrap(),
        format!("\"{}\"", first["computed_at"])
    );

    let cached = body(request(&incident, &viewer, false, HeaderMap::new()).await).await;
    assert_eq!(first, cached);
    let mut headers = HeaderMap::new();
    headers.insert(header::IF_NONE_MATCH, first_tag.clone());
    let unchanged = request(&incident, &viewer, false, headers.clone()).await;
    assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(unchanged.headers()[header::ETAG], first_tag);
    assert!(
        axum::body::to_bytes(unchanged.into_body(), usize::MAX)
            .await
            .unwrap()
            .is_empty()
    );

    incident_events::append(&incident.org_id, &incident.id, IncidentEvent::created())
        .await
        .unwrap();
    let after_event = request(&incident, &viewer, false, headers).await;
    let mut refresh_headers = HeaderMap::new();
    refresh_headers.insert(
        header::IF_NONE_MATCH,
        after_event.headers()[header::ETAG].clone(),
    );
    let after_event = body(after_event).await;
    assert_ne!(first["computed_at"], after_event["computed_at"]);

    let refreshed = body(request(&incident, &viewer, true, refresh_headers).await).await;
    assert_ne!(refreshed["computed_at"], after_event["computed_at"]);
    assert_eq!(
        refreshed,
        body(request(&incident, &viewer, false, HeaderMap::new()).await).await
    );
}

#[tokio::test]
async fn a_cached_brief_rechecks_deploy_grants_without_scanning_deploys() {
    let checker = fake_checker();
    let incident = incident(json!({"service": "checkout", "env": "prod", "region": "east"})).await;
    detected_deploy(&incident).await;
    let viewer = format!("reader@{}.example", incident.org_id);
    let barriers = infra::race::Barriers::new();
    let point = "incident_brief.changes_before_deploy_scan";
    barriers.arm(point, 1);

    let denied = body(
        barriers
            .run(request(&incident, &viewer, false, HeaderMap::new()))
            .await,
    )
    .await;
    assert_eq!(denied["changes"], json!([]));
    assert_eq!(barriers.arrived(point), 1);
    let hit = body(
        barriers
            .run(request(&incident, &viewer, false, HeaderMap::new()))
            .await,
    )
    .await;
    assert_eq!(hit, denied);
    assert_eq!(barriers.arrived(point), 1);

    checker.grant_read(
        &viewer,
        &TypedStream {
            org_id: incident.org_id.clone(),
            stream_type: StreamType::Logs,
            name: "app_a".into(),
        },
    );
    let allowed = body(
        barriers
            .run(request(&incident, &viewer, false, HeaderMap::new()))
            .await,
    )
    .await;
    assert_eq!(allowed["changes"].as_array().unwrap().len(), 1);
    assert_ne!(allowed["computed_at"], denied["computed_at"]);
    assert_eq!(barriers.arrived(point), 2);
}

#[tokio::test]
async fn a_case_needs_the_case_guard_even_after_an_authorized_read() {
    let incident = incident(json!({})).await;
    alert_incidents::mark_security_case(&incident.org_id, &incident.id)
        .await
        .unwrap();
    let reader = format!("case@{}.example", incident.org_id);
    let other = format!("reader@{}.example", incident.org_id);
    security::tests::grant(&reader, &["GET"]);
    security::tests::grant(&other, &[]);
    let allowed = request(&incident, &reader, false, HeaderMap::new()).await;
    assert_eq!(allowed.status(), StatusCode::OK);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::IF_NONE_MATCH,
        allowed.headers()[header::ETAG].clone(),
    );
    assert_eq!(
        request(&incident, &other, false, headers).await.status(),
        StatusCode::FORBIDDEN
    );
}

async fn bound_run(incident: &Incident, agent: &str) -> (String, HeaderMap) {
    let now = now_micros();
    let run_id = rca_runs::new_run_id();
    let started = rca_runs::start_run(
        NewRun {
            run_id: run_id.clone(),
            org_id: incident.org_id.clone(),
            subject_type: RunSubjectType::Incident,
            subject_id: incident.id.clone(),
            incident_id: Some(incident.id.clone()),
            trigger: RunTrigger::Manual,
            mode: RunMode::Fresh,
            started_by: agent.into(),
            guidance: None,
            oncall_subjects: None,
            context_used: None,
            recipients: Vec::new(),
            page_key: None,
        },
        StartGuards {
            now_us: now,
            rca_timeout_secs: 60,
            cooldown_us: None,
            history_limit: 5,
            latest_run_id: None,
            first_run: false,
        },
        None,
        None,
    )
    .await
    .unwrap();
    assert!(matches!(started, StartResult::Started { .. }));

    let session = format!("session_{run_id}");
    assert!(
        rca_runs::update_run(
            &incident.org_id,
            &run_id,
            RunUpdate {
                session_id: Some(session.clone()),
                now_us: now,
                ..Default::default()
            },
        )
        .await
        .unwrap()
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        rca_scope::ASSISTANT_SESSION_HEADER,
        session.parse().unwrap(),
    );
    (run_id, headers)
}

async fn change_before_response(
    request: impl Future<Output = Response>,
    change: impl Future<Output = ()>,
) -> Response {
    let barriers = infra::race::Barriers::new();
    let point = "incident_brief.before_response";
    barriers.arm(point, 2);
    let change = async {
        tokio::time::timeout(Duration::from_secs(10), async {
            while barriers.arrived(point) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        change.await;
        barriers.wait(point).await;
    };
    let (response, ()) = tokio::join!(barriers.run(request), change);
    response
}

#[tokio::test]
async fn the_sre_agent_of_a_case_run_reads_only_its_own_incident_without_history() {
    let case = incident(json!({})).await;
    alert_incidents::mark_security_case(&case.org_id, &case.id)
        .await
        .unwrap();
    let other =
        alert_incidents::create(&case.org_id, "P2", json!({}), "AlertId", now_micros(), None)
            .await
            .unwrap();
    let agent = format!("o2-sre-agent.org-{}@openobserve.internal", case.org_id);
    let reader = format!("human@{}.example", case.org_id);
    security::tests::grant(&agent, &["GET"]);
    security::tests::grant(&reader, &["GET"]);
    let (run_id, headers) = bound_run(&case, &agent).await;

    let human = body(request(&case, &reader, false, HeaderMap::new()).await).await;
    let brief = body(request(&case, &agent, false, headers.clone()).await).await;
    assert_ne!(brief["computed_at"], human["computed_at"]);
    assert_eq!(brief["declared_no_alert"], false);
    assert_eq!(brief["similar"], json!([]));
    assert_eq!(brief["related_active"], json!([]));
    assert_eq!(
        request(&other, &agent, false, headers).await.status(),
        StatusCode::FORBIDDEN
    );
    let run = rca_runs::get_rw(&case.org_id, &run_id)
        .await
        .unwrap()
        .unwrap();
    assert!(!rca_fence::read_history(&run));
}

#[tokio::test]
async fn reclassification_during_a_brief_refuses_ordinary_and_cross_incident_reads() {
    let origin = incident(json!({})).await;
    let agent = format!("o2-sre-agent.org-{}@openobserve.internal", origin.org_id);
    let reader = format!("human@{}.example", origin.org_id);
    security::tests::grant(&agent, &["GET"]);
    security::tests::grant(&reader, &[]);
    let (run_id, agent_headers) = bound_run(&origin, &agent).await;

    for (viewer, headers) in [(&reader, HeaderMap::new()), (&agent, agent_headers)] {
        let target = alert_incidents::create(
            &origin.org_id,
            "P2",
            json!({}),
            "AlertId",
            now_micros(),
            None,
        )
        .await
        .unwrap();
        let reclassify = async {
            alert_incidents::mark_security_case(&target.org_id, &target.id)
                .await
                .unwrap();
        };
        let response =
            change_before_response(request(&target, viewer, false, headers), reclassify).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    let run = rca_runs::get_rw(&origin.org_id, &run_id)
        .await
        .unwrap()
        .unwrap();
    assert!(!rca_fence::read_history(&run));
}

#[tokio::test]
async fn a_session_rebound_during_its_own_brief_cannot_receive_the_body() {
    let target = incident(json!({})).await;
    let agent = format!("o2-sre-agent.org-{}@openobserve.internal", target.org_id);
    let (run_id, headers) = bound_run(&target, &agent).await;
    let rebind = async {
        assert!(
            rca_runs::update_run(
                &target.org_id,
                &run_id,
                RunUpdate {
                    session_id: Some(format!("next_{run_id}")),
                    now_us: now_micros(),
                    ..Default::default()
                },
            )
            .await
            .unwrap()
        );
    };
    let response = change_before_response(request(&target, &agent, false, headers), rebind).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_incident_history_is_recorded_only_when_a_body_is_returned() {
    let origin = incident(json!({})).await;
    let target = alert_incidents::create(
        &origin.org_id,
        "P2",
        json!({}),
        "AlertId",
        now_micros(),
        None,
    )
    .await
    .unwrap();
    let agent = format!("o2-sre-agent.org-{}@openobserve.internal", origin.org_id);
    let (run_id, headers) = bound_run(&origin, &agent).await;
    let mut conditional = headers.clone();
    conditional.insert(header::IF_NONE_MATCH, "*".parse().unwrap());

    assert_eq!(
        request(&target, &agent, false, conditional).await.status(),
        StatusCode::NOT_MODIFIED
    );
    let run = rca_runs::get_rw(&origin.org_id, &run_id)
        .await
        .unwrap()
        .unwrap();
    assert!(!rca_fence::read_history(&run));

    assert_eq!(
        request(&target, &agent, false, headers).await.status(),
        StatusCode::OK
    );
    let run = rca_runs::get_rw(&origin.org_id, &run_id)
        .await
        .unwrap()
        .unwrap();
    assert!(rca_fence::read_history(&run));
}

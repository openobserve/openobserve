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

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, StatusCode, request::Builder},
    routing::{get, patch, post},
};
use config::{
    meta::{
        alerts::{
            incidents::IncidentEventType,
            rca_runs::{RunMode, RunSubjectType, RunTrigger},
        },
        oncall::{ResolutionCause, ResponderRole, SubjectRef, SubjectType},
        user::{SRE_AGENT_EMAIL_PREFIX, SRE_AGENT_EMAIL_SUFFIX},
    },
    utils::{delegation::SCOPE_ASSISTANT, time::now_micros},
};
use infra::table::{alert_incidents, incident_events, oncall_responses, rca_runs};
use o2_enterprise::enterprise::common::config::with_incidents_v2;
use tower::ServiceExt;

use super::*;

const FEEDBACK: &str = "/acme/inc-1/rca/runs/run-1/feedback";
const CONFIRM: &str = "/acme/inc-1/cause/confirm";
const AUTHOR: &str = "ana@example.test";
const RCA_BODY: &str = r#"{"target_kind":"run","target_id":"","verdict":"wrong"}"#;
const CAUSE_BODY: &str = r#"{"cause_class":"capacity_or_load","cause_text":"Load increased"}"#;

fn app() -> Router {
    Router::new()
        .route(
            "/{org}/{incident}/rca/runs/{run}/feedback",
            get(get_feedback).post(post_feedback),
        )
        .route("/{org}/{incident}/cause/confirm", post(confirm_cause))
        .route(
            "/{org}/{incident}/update",
            patch(super::super::incidents::update_incident),
        )
}

fn request(method: Method, path: &str, actor: &str) -> Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header("user_id", actor)
        .header("content-type", "application/json")
}

async fn send(request: Builder, body: &str) -> Response {
    app()
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn feedback_writes_refuse_off_state_and_ai_principals() {
    let assistant = DelegatedCaller {
        link_id: "link".into(),
        installation_id: "installation".into(),
        org: "acme".into(),
        jti: "token".into(),
        scope: SCOPE_ASSISTANT.into(),
    };
    let agent = format!("{SRE_AGENT_EMAIL_PREFIX}acme{SRE_AGENT_EMAIL_SUFFIX}");
    for (path, body) in [(FEEDBACK, RCA_BODY), (CONFIRM, CAUSE_BODY)] {
        let person = || request(Method::POST, path, AUTHOR);
        let off = with_incidents_v2(false, send(person(), "{invalid")).await;
        assert_eq!(off.status(), StatusCode::CONFLICT);
        for write in [
            person().extension(assistant.clone()),
            person().header("x-o2-mcp", "loopback"),
            request(Method::POST, path, &agent),
        ] {
            let forbidden = with_incidents_v2(true, send(write, body)).await;
            assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
        }
    }
}

async fn new_incident(org: &str) -> String {
    security::tests::meta_store().await;
    alert_incidents::create(
        org,
        "P3",
        serde_json::json!({}),
        "Primary",
        now_micros(),
        None,
    )
    .await
    .unwrap()
    .id
}

async fn start_run(org: &str, incident: &str) -> String {
    let run = rca_runs::new_run_id();
    assert!(matches!(
        rca_runs::start_run(
            rca_runs::NewRun {
                run_id: run.clone(),
                org_id: org.to_owned(),
                subject_type: RunSubjectType::Incident,
                subject_id: incident.to_owned(),
                incident_id: Some(incident.to_owned()),
                trigger: RunTrigger::Manual,
                mode: RunMode::Fresh,
                started_by: AUTHOR.to_owned(),
                guidance: None,
                oncall_subjects: None,
                context_used: None,
                recipients: Vec::new(),
                page_key: None,
            },
            rca_runs::StartGuards {
                now_us: now_micros(),
                rca_timeout_secs: 600,
                history_limit: 10,
                cooldown_us: None,
                latest_run_id: None,
                first_run: false,
            },
            None,
            None,
        )
        .await
        .unwrap(),
        rca_runs::StartResult::Started { .. }
    ));
    run
}

#[tokio::test]
async fn feedback_get_answers_while_off_and_requires_case_access() {
    let org = format!("feedback-{}", config::ider::uuid());
    let incident = new_incident(&org).await;
    let run = start_run(&org, &incident).await;
    let read = format!("/{org}/{incident}/rca/runs/{run}/feedback");
    let actor = format!("reader-{org}@example.test");

    let response = with_incidents_v2(false, send(request(Method::GET, &read, &actor), "")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        b"[]"
    );

    let foreign = new_incident(&org).await;
    let wrong = format!("/{org}/{foreign}/rca/runs/{run}/feedback");
    for method in [Method::POST, Method::GET] {
        let response =
            with_incidents_v2(true, send(request(method, &wrong, &actor), RCA_BODY)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    alert_incidents::mark_security_case(&org, &incident)
        .await
        .unwrap();
    let confirm = format!("/{org}/{incident}/cause/confirm");
    security::tests::grant(&actor, &[]);
    for (path, method, body) in [
        (&read, Method::GET, ""),
        (&read, Method::POST, RCA_BODY),
        (&confirm, Method::POST, CAUSE_BODY),
    ] {
        let response = with_incidents_v2(true, send(request(method, path, &actor), body)).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    security::tests::grant(&actor, &["GET"]);
    let mcp = request(Method::GET, &read, &actor).header("x-o2-mcp", "loopback");
    assert_eq!(
        with_incidents_v2(false, send(mcp, "")).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn resolving_after_confirm_returns_200_and_clears_the_review_stamp() {
    let org = format!("confirm-{}", config::ider::uuid());
    let incident = new_incident(&org).await;
    let confirm = format!("/{org}/{incident}/cause/confirm");
    let update = format!("/{org}/{incident}/update");
    with_incidents_v2(true, async {
        assert_eq!(
            send(request(Method::POST, &confirm, AUTHOR), CAUSE_BODY)
                .await
                .status(),
            StatusCode::OK
        );
        let body = r#"{"status":"resolved","resolution_cause":"dependency_failure"}"#;
        assert_eq!(
            send(request(Method::PATCH, &update, AUTHOR), body)
                .await
                .status(),
            StatusCode::OK
        );
    })
    .await;
    let row = alert_incidents::get_rw(&org, &incident)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.resolution_cause.as_deref(), Some("dependency_failure"));
    assert!(row.cause_reviewed_by.is_none());
    assert!(row.cause_reviewed_at.is_none());
    let events = incident_events::get(&org, &incident).await.unwrap();
    assert!(
        events
            .iter()
            .any(|event| matches!(event.event_type, IncidentEventType::CauseReviewed { .. }))
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event.event_type, IncidentEventType::Resolved { .. }))
    );
}

#[tokio::test]
async fn confirm_endpoint_cascades_through_the_oncall_resolver_without_closing_open_pages() {
    let org = format!("cascade-{}", config::ider::uuid());
    let incident = new_incident(&org).await;
    let page = async |label: &str| {
        let key = format!("{label}-{}", config::ider::uuid());
        let subject = SubjectRef::new(SubjectType::Alert, &key, 1);
        let page =
            oncall_responses::open(&org, &subject, None, 3, None, ResponderRole::Owner, None)
                .await
                .unwrap();
        oncall_responses::attach_incident(&org, &page.id, &incident)
            .await
            .unwrap()
            .unwrap()
    };
    let open = page("open").await;
    let closed = page("closed").await;
    let responder = page("responder").await;
    oncall_responses::resolve(&org, &closed.id, None, None)
        .await
        .unwrap()
        .unwrap();
    oncall_responses::resolve(
        &org,
        &responder.id,
        Some(ResolutionCause::GenuineDefect),
        Some("Responder cause"),
    )
    .await
    .unwrap()
    .unwrap();

    let events_before = oncall_responses::list_events(&closed.id).await.unwrap();
    let path = format!("/{org}/{incident}/cause/confirm");
    let response =
        with_incidents_v2(true, send(request(Method::POST, &path, AUTHOR), CAUSE_BODY)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let closed_after = oncall_responses::get(&org, &closed.id)
        .await
        .unwrap()
        .unwrap();
    assert!(closed_after.closed_at.is_some());
    assert_eq!(closed_after.cause, Some(ResolutionCause::CapacityOrLoad));
    assert_eq!(closed_after.cause_note.as_deref(), Some("Load increased"));
    assert_eq!(
        oncall_responses::list_events(&closed.id).await.unwrap(),
        events_before
    );
    let responder = oncall_responses::get(&org, &responder.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(responder.cause_note.as_deref(), Some("Responder cause"));
    let open_after = oncall_responses::get(&org, &open.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(open_after, open);
    assert!(open_after.is_escalating());
}

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

//! Own test binary: the ack routes and the Slack message view over a real sqlite meta store.

#![cfg(feature = "enterprise")]
// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

use std::collections::HashMap;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    meta::{
        alerts::{
            alert::Alert,
            incidents::IncidentStatus,
            priority::AlertPriority,
            state::{AlertState, StateUpdate},
        },
        folder::{Folder, FolderType},
        organization::OrganizationType,
        self_reporting::usage::RunOutcome,
        user::{UserRole, UserType},
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_incidents, alert_states, folders, oncall_policies, org_users, organizations, users,
    users::UserRecord,
};
use o2_enterprise::enterprise::oncall::{escalation, service};
use openobserve_api_http::handler::http::router::create_app_router;
use openobserve_core::alerts::slack_view;
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@acme.test";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const ALERT_NAME: &str = "checkout-errors";
const FIRING: i64 = 1_760_000_000_000_000;

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-alert-truth-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("ZO_WEB_URL", "http://o2.test:5080");
    set_env("O2_ONCALL_ENABLED", "true");
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    assert!(o2_enterprise::enterprise::oncall::is_enabled());
}

/// One org, one admin, one alert on its own row, firing since `FIRING`.
async fn seed() -> String {
    organizations::add("acme", "acme", OrganizationType::Custom)
        .await
        .unwrap();
    users::add(UserRecord {
        email: ADMIN.to_string(),
        first_name: "A".to_string(),
        last_name: "D".to_string(),
        password: openobserve_core::auth::get_hash(PASSWORD, SALT),
        salt: SALT.to_string(),
        is_root: false,
        password_ext: None,
        user_type: UserType::Internal,
        created_at: 0,
        updated_at: 0,
        must_reset_password: false,
        password_reset_reason: None,
        flagged_at: None,
        password_updated_at: Some(now_micros()),
    })
    .await
    .unwrap();
    org_users::add("acme", ADMIN, UserRole::Admin, "tok-acme", None)
        .await
        .unwrap();
    folders::put(
        "acme",
        None,
        Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Folder::default()
        },
        FolderType::Alerts,
    )
    .await
    .unwrap();
    let mut alert = Alert::default();
    alert.org_id = "acme".to_string();
    alert.name = ALERT_NAME.to_string();
    alert.stream_name = "checkout".to_string();
    alert.enabled = true;
    alert.id = Some(<svix_ksuid::Ksuid as svix_ksuid::KsuidLike>::new(
        None, None,
    ));
    let alert = db::alerts::alert::set("acme", alert, true).await.unwrap();
    let alert_id = alert.id.unwrap().to_string();
    let state = AlertState {
        last_outcome: Some(RunOutcome::Firing),
        last_outcome_at: Some(FIRING),
        since: Some(FIRING),
        firing_started_at: Some(FIRING),
        ..AlertState::empty(&alert_id, "")
    };
    alert_states::persist(
        &StateUpdate {
            state: Some(state),
            transition: None,
        },
        None,
    )
    .await
    .unwrap();
    alert_id
}

fn app() -> Router {
    create_app_router(|_| Router::new())
}

async fn call(method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let basic = BASE64_STANDARD.encode(format!("{ADMIN}:{PASSWORD}"));
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Basic {basic}"))
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()));
    (status, value)
}

async fn view(alert_id: &str) -> config::meta::slack::AlertMessageView {
    slack_view::alert_message_view("acme", alert_id, "", FIRING)
        .await
        .unwrap()
        .expect("a well-formed alert id")
}

/// The B5 click sends `{}` for a single-row alert; it has to name the alert's own row.
async fn an_empty_unack_body_unacks_the_alerts_own_row(alert_id: &str) {
    let base = format!("/api/v2/acme/alerts/{alert_id}");
    let (status, body) = call(
        Method::POST,
        &format!("{base}/ack"),
        Some(json!({"group_key": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    assert_eq!(
        view(alert_id).await.ack.map(|a| a.acked_by),
        Some(ADMIN.to_string())
    );

    let (status, body) = call(Method::POST, &format!("{base}/unack"), Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    let (status, acks) = call(Method::GET, &format!("{base}/acks"), None).await;
    assert_eq!(status, StatusCode::OK, "{acks}");
    assert_eq!(acks["acks"], json!([]), "{acks}");
    assert!(
        view(alert_id).await.ack.is_none(),
        "the view reads the unack"
    );

    let (status, body) = call(Method::POST, &format!("{base}/unack"), Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], false, "a second unack is a no-op: {body}");
}

/// The producers the scheduler calls on a firing: an on-call page and an incident.
async fn the_view_carries_the_firings_page_and_incident(alert_id: &str) {
    let before = view(alert_id).await;
    assert!(
        before.page.is_none() && before.incident.is_none(),
        "{before:?}"
    );

    let team = service::create_team("acme", "sre", "UTC", None)
        .await
        .unwrap();
    service::add_member("acme", &team.id, ADMIN).await.unwrap();
    let response = escalation::start_for_alert(
        "acme",
        alert_id,
        ALERT_NAME,
        AlertPriority::P1,
        Some(&team.id),
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the firing pages the team");
    let incident = alert_incidents::create(
        "acme",
        "P2",
        json!({}),
        "alert",
        FIRING,
        Some("Checkout errors".to_string()),
    )
    .await
    .unwrap();
    alert_incidents::add_alert_to_incident(
        &incident.id,
        alert_id,
        ALERT_NAME,
        "alert",
        FIRING,
        "test",
    )
    .await
    .unwrap();

    let paged = view(alert_id).await;
    let page = paged.page.clone().expect("the open page is on the view");
    assert_eq!(page.response_ids, vec![response.id.clone()]);
    assert_eq!(page.team, "sre");
    let policy = oncall_policies::get_or_create_cached("acme", &team.id)
        .await
        .unwrap();
    let of = policy
        .rung(AlertPriority::P1)
        .map_or(0, |r| u32::try_from(r.steps.len()).unwrap());
    assert_eq!((page.step, page.of), (of.min(1), of), "{page:?}");
    let inc = paged
        .incident
        .clone()
        .expect("the open incident is on the view");
    assert_eq!(
        (inc.id.as_str(), inc.label.as_str(), inc.status),
        (
            incident.id.as_str(),
            "Checkout errors",
            IncidentStatus::Open
        )
    );

    escalation::resolve("acme", &response.id, ADMIN, None, None)
        .await
        .unwrap();
    let resolved = view(alert_id).await;
    assert!(
        resolved.page.is_none(),
        "a resolved page leaves the view: {resolved:?}"
    );
    assert_eq!(
        resolved.incident, paged.incident,
        "the incident stays until it is resolved"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn alert_truth_end_to_end() {
    boot().await;
    let alert_id = seed().await;
    an_empty_unack_body_unacks_the_alerts_own_row(&alert_id).await;
    the_view_carries_the_firings_page_and_incident(&alert_id).await;
}

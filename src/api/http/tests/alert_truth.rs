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
            QueryType,
            alert::Alert,
            incidents::IncidentStatus,
            priority::AlertPriority,
            state::{AlertState, StateUpdate},
        },
        folder::{Folder, FolderType},
        oncall::response::{ResponseEventKind, ResponseState},
        organization::OrganizationType,
        self_reporting::usage::RunOutcome,
        slack::AlertMessagePhase,
        user::{UserRole, UserType},
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_incidents, alert_states, folders, oncall_policies, oncall_responses, org_users,
    organizations, users, users::UserRecord,
};
use o2_enterprise::enterprise::oncall::{escalation, service};
use openobserve_api_http::handler::http::router::create_app_router;
use openobserve_core::alerts::{
    lifecycle::{self, ClearKind},
    slack_view,
};
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@acme.test";
const TAKER: &str = "taker@acme.test";
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

async fn seed() -> String {
    organizations::add("acme", "acme", OrganizationType::Custom)
        .await
        .unwrap();
    add_admin(ADMIN, "tok-acme").await;
    add_admin(TAKER, "tok-taker").await;
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
    firing_alert(ALERT_NAME).await
}

async fn firing_alert(name: &str) -> String {
    let alert_id = saved_alert(name, false).await;
    fire_row(&alert_id, "").await;
    alert_id
}

async fn grouped_firing_alert(name: &str, groups: &[&str]) -> String {
    let alert_id = saved_alert(name, true).await;
    for group in groups {
        fire_row(&alert_id, group).await;
    }
    alert_id
}

async fn saved_alert(name: &str, multi_alert: bool) -> String {
    let mut alert = Alert::default();
    alert.org_id = "acme".to_string();
    alert.name = name.to_string();
    alert.stream_name = "checkout".to_string();
    alert.enabled = true;
    if multi_alert {
        alert.query_condition.query_type = QueryType::PromQL;
        alert.query_condition.promql_multi_alert = true;
    }
    alert.id = Some(<svix_ksuid::Ksuid as svix_ksuid::KsuidLike>::new(
        None, None,
    ));
    let alert = db::alerts::alert::set("acme", alert, true).await.unwrap();
    alert.id.unwrap().to_string()
}

async fn fire_row(alert_id: &str, group_key: &str) {
    let state = AlertState {
        last_outcome: Some(RunOutcome::Firing),
        last_outcome_at: Some(FIRING),
        since: Some(FIRING),
        firing_started_at: Some(FIRING),
        ..AlertState::empty(alert_id, group_key)
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
}

async fn clear(alert_id: &str) {
    let at = now_micros();
    lifecycle::on_cleared("acme", alert_id, "", FIRING, at, ClearKind::Recovered).await;
    let cleared = AlertState {
        last_outcome: Some(RunOutcome::Normal),
        last_outcome_at: Some(at),
        since: Some(at),
        firing_started_at: None,
        ..AlertState::empty(alert_id, "")
    };
    alert_states::persist(
        &StateUpdate {
            state: Some(cleared),
            transition: None,
        },
        None,
    )
    .await
    .unwrap();
}

/// A mute checks its target against the alerts cache, which no watcher fills in this binary.
async fn cache_alert(alert_id: &str) {
    let id = alert_id.parse().unwrap();
    let conn = infra::db::get_orm_client_ro().await;
    let found = db::alerts::alert::get_by_id(conn, "acme", id)
        .await
        .unwrap()
        .unwrap();
    common::infra::config::ALERTS
        .write()
        .await
        .insert(db::alerts::alert::cache_alert_key("acme", alert_id), found);
}

async fn mute(alert_id: &str, body: Value) -> config::meta::slack::MuteView {
    cache_alert(alert_id).await;
    let (status, body) = call(
        Method::POST,
        &format!("/api/v2/acme/alerts/{alert_id}/mute"),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    view(alert_id).await.mute.expect("the mute is on the view")
}

async fn page_acks_by(response_id: &str, actor: &str) -> usize {
    oncall_responses::list_events(response_id)
        .await
        .unwrap()
        .iter()
        .filter(|e| e.kind == ResponseEventKind::Ack && e.actor == actor)
        .count()
}

async fn add_admin(email: &str, token: &str) {
    users::add(UserRecord {
        email: email.to_string(),
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
    org_users::add("acme", email, UserRole::Admin, token, None)
        .await
        .unwrap();
}

fn app() -> Router {
    create_app_router(|_| Router::new())
}

async fn call(method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    call_as(ADMIN, method, uri, body).await
}

async fn call_as(
    user: &str,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let basic = BASE64_STANDARD.encode(format!("{user}:{PASSWORD}"));
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

async fn a_take_over_moves_the_acknowledged_page() {
    let alert_id = &firing_alert("payments-errors").await;
    let team = service::create_team("acme", "payments", "UTC", None)
        .await
        .unwrap();
    service::add_member("acme", &team.id, ADMIN).await.unwrap();
    service::add_member("acme", &team.id, TAKER).await.unwrap();
    let response = escalation::start_for_alert(
        "acme",
        alert_id,
        "payments-errors",
        AlertPriority::P1,
        Some(&team.id),
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the firing pages the team");
    let ack = format!("/api/v2/acme/alerts/{alert_id}/ack");
    let (status, body) = call(Method::POST, &ack, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let page = oncall_responses::get("acme", &response.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(page.acked_by.as_deref(), Some(ADMIN));

    let (status, body) = call_as(TAKER, Method::POST, &ack, Some(json!({"take_over": true}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    let page = oncall_responses::get("acme", &response.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (page.state, page.acked_by.as_deref()),
        (ResponseState::Acknowledged, Some(TAKER)),
        "the page follows the alert's ack"
    );
    assert_eq!(
        page_acks_by(&response.id, TAKER).await,
        1,
        "the take-over is on the page's timeline"
    );
    escalation::resolve("acme", &response.id, TAKER, None, None)
        .await
        .unwrap();
}

async fn a_partial_take_over_moves_the_page_only_once_the_holder_lets_go() {
    let alert_id = &grouped_firing_alert("orders-errors", &["g1", "g2"]).await;
    let team = service::create_team("acme", "orders", "UTC", None)
        .await
        .unwrap();
    service::add_member("acme", &team.id, ADMIN).await.unwrap();
    service::add_member("acme", &team.id, TAKER).await.unwrap();
    let response = escalation::start_for_alert(
        "acme",
        alert_id,
        "orders-errors",
        AlertPriority::P1,
        Some(&team.id),
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the firing pages the team");
    let ack = format!("/api/v2/acme/alerts/{alert_id}/ack");
    let (status, body) = call(Method::POST, &ack, Some(json!({"all_groups": true}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let holder = |id: String| async move {
        oncall_responses::get("acme", &id)
            .await
            .unwrap()
            .unwrap()
            .acked_by
    };
    assert_eq!(holder(response.id.clone()).await.as_deref(), Some(ADMIN));

    let take = |group: &str| json!({"group_key": group, "take_over": true});
    let (status, body) = call_as(TAKER, Method::POST, &ack, Some(take("g1"))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    assert_eq!(
        holder(response.id.clone()).await.as_deref(),
        Some(ADMIN),
        "the holder still acks g2, so the page stays theirs"
    );
    assert_eq!(page_acks_by(&response.id, TAKER).await, 0);

    let (status, body) = call_as(TAKER, Method::POST, &ack, Some(take("g2"))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        holder(response.id.clone()).await.as_deref(),
        Some(TAKER),
        "the holder let go of the whole alert"
    );
    assert_eq!(page_acks_by(&response.id, TAKER).await, 1);
    escalation::resolve("acme", &response.id, TAKER, None, None)
        .await
        .unwrap();
}

async fn a_cleared_view_keeps_an_active_timed_mute(alert_id: &str) {
    let muted = mute(alert_id, json!({"minutes": 30})).await;
    clear(alert_id).await;
    let after = view(alert_id).await;
    assert_eq!(after.phase, AlertMessagePhase::Cleared, "{after:?}");
    assert_eq!(after.mute, Some(muted), "the mute is still in force");
}

async fn a_cleared_view_drops_an_expired_timed_mute() {
    let alert_id = &firing_alert("search-errors").await;
    let muted = mute(alert_id, json!({"minutes": 1})).await;
    // The shortest mute is a minute, so its stored window moves into the past instead.
    let mut row = db::downtimes::list_cached("acme")
        .iter()
        .find(|d| d.id == muted.downtime_id)
        .cloned()
        .expect("the mute row is cached");
    let now = now_micros();
    row.schedule.starts_at = now - 120_000_000;
    row.schedule.ends_at = Some(now - 1_000_000);
    row.schedule.duration_secs = 119;
    db::downtimes::set(&row, &[]).await.unwrap();
    clear(alert_id).await;
    let after = view(alert_id).await;
    assert_eq!(after.phase, AlertMessagePhase::Cleared, "{after:?}");
    assert_eq!(after.mute, None, "an expired mute is not shown");
}

async fn a_clear_cancels_an_until_clear_mute() {
    let alert_id = &firing_alert("login-errors").await;
    let muted = mute(alert_id, json!({"until_clear": true})).await;
    assert!(muted.until_clear, "{muted:?}");
    clear(alert_id).await;
    let after = view(alert_id).await;
    assert_eq!(after.phase, AlertMessagePhase::Cleared, "{after:?}");
    assert_eq!(after.mute, None, "the clear cancelled the mute");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn alert_truth_end_to_end() {
    boot().await;
    let alert_id = seed().await;
    an_empty_unack_body_unacks_the_alerts_own_row(&alert_id).await;
    the_view_carries_the_firings_page_and_incident(&alert_id).await;
    a_take_over_moves_the_acknowledged_page().await;
    a_partial_take_over_moves_the_page_only_once_the_holder_lets_go().await;
    a_cleared_view_keeps_an_active_timed_mute(&alert_id).await;
    a_cleared_view_drops_an_expired_timed_mute().await;
    a_clear_cancels_an_until_clear_mute().await;
}

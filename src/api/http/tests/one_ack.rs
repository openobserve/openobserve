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

//! Own test binary: one acknowledge across alerts, incidents and pages over a real sqlite store.

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
            ack::AckSource,
            alert::Alert,
            priority::AlertPriority,
            state::{AlertState, StateUpdate},
        },
        folder::{Folder, FolderType},
        oncall::{
            ResponderRole, SubjectRef, SubjectType,
            response::{Response, ResponseEventKind, ResponseState},
        },
        organization::OrganizationType,
        self_reporting::usage::RunOutcome,
        user::{UserRole, UserType},
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_acks, alert_incidents, alert_states, folders, oncall_policies, oncall_responses,
    org_users, organizations, users, users::UserRecord,
};
use o2_enterprise::enterprise::oncall::{escalation, service, token};
use openobserve_api_http::handler::http::router::create_app_router;
use openobserve_core::alerts::{
    ack::{self, Groups, Problem},
    slack_view,
};
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@acme.test";
const TAKER: &str = "taker@acme.test";
const MEMBER: &str = "member@acme.test";
const STRANGER: &str = "stranger@acme.test";
const ROOT: &str = "root@acme.test";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const FIRING: i64 = 1_760_000_000_000_000;

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-one-ack-{}", std::process::id()));
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

async fn seed() {
    organizations::add("acme", "acme", OrganizationType::Custom)
        .await
        .unwrap();
    add_user(ADMIN, UserRole::Admin, "tok-admin").await;
    add_user(TAKER, UserRole::Admin, "tok-taker").await;
    add_user(MEMBER, UserRole::Viewer, "tok-member").await;
    add_user(STRANGER, UserRole::Viewer, "tok-stranger").await;
    add_root().await;
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
}

async fn add_user(email: &str, role: UserRole, token: &str) {
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
    org_users::add("acme", email, role, token, None)
        .await
        .unwrap();
}

/// The ack tokens' signing keys derive from the root user's password.
async fn add_root() {
    users::add(UserRecord {
        email: ROOT.to_string(),
        first_name: "R".to_string(),
        last_name: "T".to_string(),
        password: openobserve_core::auth::get_hash(PASSWORD, SALT),
        salt: SALT.to_string(),
        is_root: true,
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
}

async fn firing_alert(name: &str) -> String {
    let mut alert = Alert::default();
    alert.org_id = "acme".to_string();
    alert.name = name.to_string();
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

async fn team(name: &str, members: &[&str]) -> String {
    let team = service::create_team("acme", name, "UTC", None)
        .await
        .unwrap();
    for m in members {
        service::add_member("acme", &team.id, m).await.unwrap();
    }
    team.id
}

async fn alert_page(alert_id: &str, team_id: Option<&str>) -> Response {
    escalation::start_for_alert(
        "acme",
        alert_id,
        alert_id,
        AlertPriority::P1,
        team_id,
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the firing pages")
}

/// An impacted page's subject, as `escalation::page_impacted` writes it.
fn impacted_subject(kind: SubjectType, origin_source: &str, team_id: &str) -> SubjectRef {
    SubjectRef::new(kind, format!("{origin_source}:impacted:{team_id}"), 1)
}

async fn impacted_page(origin: &Response, kind: SubjectType, team_id: &str) -> Response {
    oncall_responses::open(
        "acme",
        &impacted_subject(kind, &origin.subject.source_id, team_id),
        Some(team_id),
        AlertPriority::P1.to_i32(),
        Some("impacted"),
        ResponderRole::Impacted,
        Some(&origin.id),
    )
    .await
    .unwrap()
}

/// A saved alert with no firing row: its page outlived the firing.
async fn quiet_alert(name: &str) -> String {
    let mut alert = Alert::default();
    alert.org_id = "acme".to_string();
    alert.name = name.to_string();
    alert.stream_name = "checkout".to_string();
    alert.enabled = true;
    alert.id = Some(<svix_ksuid::Ksuid as svix_ksuid::KsuidLike>::new(
        None, None,
    ));
    let alert = db::alerts::alert::set("acme", alert, true).await.unwrap();
    alert.id.unwrap().to_string()
}

/// Makes every UPDATE of one row of `table` fail, as a lost database write would.
async fn fail_updates(name: &str, table: &str, key_column: &str, id: &str) {
    use sea_orm::ConnectionTrait;
    let db = infra::db::get_orm_client_rw().await;
    unfail(name).await;
    db.execute_unprepared(&format!(
        "CREATE TRIGGER {name} BEFORE UPDATE ON {table} WHEN OLD.{key_column} = '{id}' \
         BEGIN SELECT RAISE(ABORT, 'update fails'); END"
    ))
    .await
    .expect("fault");
}

async fn unfail(name: &str) {
    use sea_orm::ConnectionTrait;
    infra::db::get_orm_client_rw()
        .await
        .execute_unprepared(&format!("DROP TRIGGER IF EXISTS {name}"))
        .await
        .expect("unfault");
}

async fn incident_of(alert_id: &str, title: &str) -> String {
    let incident = alert_incidents::create(
        "acme",
        "P2",
        json!({}),
        "alert",
        FIRING,
        Some(title.to_string()),
    )
    .await
    .unwrap();
    alert_incidents::add_alert_to_incident(&incident.id, alert_id, title, "alert", FIRING, "test")
        .await
        .unwrap();
    incident.id
}

async fn page(id: &str) -> Response {
    oncall_responses::get("acme", id).await.unwrap().unwrap()
}

async fn incident_holder(id: &str) -> (String, Option<String>) {
    let m = alert_incidents::get("acme", id).await.unwrap().unwrap();
    (m.status, m.acknowledged_by)
}

async fn row_holder(alert_id: &str) -> Option<(String, AckSource)> {
    alert_acks::get("acme", alert_id, "")
        .await
        .unwrap()
        .filter(|a| a.in_force_for(Some(FIRING)))
        .map(|a| (a.acked_by, a.ack_source))
}

async fn page_acks_by(response_id: &str, actor: &str) -> usize {
    oncall_responses::list_events(response_id)
        .await
        .unwrap()
        .iter()
        .filter(|e| e.kind == ResponseEventKind::Ack && e.actor == actor)
        .count()
}

fn app() -> Router {
    create_app_router(|_| Router::new())
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

/// An unauthenticated form post, as a mail client or Twilio sends it.
async fn post_form(uri: &str, form: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(Body::from(form.to_string()))
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8_lossy(&bytes).to_string())
}

async fn token_for(response_id: &str, user: &str, purpose: token::TokenPurpose) -> String {
    token::issue(
        "acme",
        response_id,
        user,
        now_micros() + 3_600_000_000,
        purpose,
    )
    .await
    .unwrap()
}

async fn post(user: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    call_as(user, Method::POST, uri, Some(body)).await
}

/// AK-1: an alert alone is its firing; in an incident, and behind an incident page, the incident.
async fn the_problem_is_the_incident_when_there_is_one_else_the_firing() {
    let alone = firing_alert("ak1-alone").await;
    let alone_page = alert_page(&alone, Some(&team("ak1", &[ADMIN]).await)).await;
    let by_page = ack::problem_of_page("acme", &alone_page.id).await.unwrap();
    assert!(
        matches!(&by_page, Problem::Firing { target, groups: Groups::All } if target.alert_id == alone),
        "{by_page:?}"
    );
    let joined = firing_alert("ak1-joined").await;
    let incident = incident_of(&joined, "AK1").await;
    let in_incident = ack::problem_of_alert("acme", &joined, Groups::All)
        .await
        .unwrap();
    assert_eq!(
        in_incident,
        Problem::Incident {
            org_id: "acme".into(),
            incident_id: incident.clone()
        }
    );
    let incident_page = escalation::start_for_incident(
        "acme",
        &incident,
        "AK1",
        AlertPriority::P1,
        Some(&team("ak1-inc", &[ADMIN]).await),
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the incident pages");
    assert_eq!(
        ack::problem_of_page("acme", &incident_page.id)
            .await
            .unwrap(),
        in_incident
    );
}

/// AK-4, D26: every page action refuses someone who is neither an editor nor on a paged team.
async fn every_page_action_runs_the_one_rule() {
    let alert_id = firing_alert("ak4").await;
    let response = alert_page(&alert_id, Some(&team("ak4", &[MEMBER]).await)).await;
    let base = format!("/api/acme/oncall/responses/{}", response.id);
    for (verb, body) in [
        ("acknowledge", json!({})),
        ("unacknowledge", json!({})),
        ("resolve", json!({})),
        ("notes", json!({"body": "looking"})),
        ("snooze", json!({"minutes": 5})),
        ("handoff", json!({"to": ADMIN})),
        ("escalate", json!({})),
        ("confirm-recovery", json!({})),
    ] {
        let (status, body) = post(STRANGER, &format!("{base}/{verb}"), body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{verb}: {body}");
        assert_eq!(body["code"], "ack_refused", "{verb}: {body}");
        assert_eq!(body["on_call"][0]["email"], MEMBER, "{verb}: {body}");
    }
    assert_eq!(page(&response.id).await.state, ResponseState::Triggered);

    let (status, body) = post(MEMBER, &format!("{base}/acknowledge"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "a paged viewer may act: {body}");
    assert_eq!(body["ack"]["changed"], true, "{body}");
    assert_eq!(
        row_holder(&alert_id).await.map(|(who, _)| who).as_deref(),
        Some(MEMBER),
        "a page press acknowledges the alert"
    );
    assert_eq!(page(&response.id).await.acked_by.as_deref(), Some(MEMBER));
    assert_eq!(page_acks_by(&response.id, MEMBER).await, 1, "AK-12");
}

/// AK-4: a teamless page has no ladder to move, and reading its view creates no policy for "".
async fn a_teamless_page_refuses_escalate_and_snooze_and_can_be_handed_off() {
    let alert_id = firing_alert("ak4-teamless").await;
    let response = alert_page(&alert_id, None).await;
    assert_eq!(response.team(), "", "{response:?}");
    let base = format!("/api/acme/oncall/responses/{}", response.id);
    for (verb, body) in [("escalate", json!({})), ("snooze", json!({"minutes": 5}))] {
        let (status, body) = post(ADMIN, &format!("{base}/{verb}"), body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{verb}: {body}");
        assert!(body.to_string().contains("no team yet"), "{verb}: {body}");
    }
    let _ = slack_view::alert_message_view("acme", &alert_id, "", FIRING)
        .await
        .unwrap();
    assert!(
        oncall_policies::get_by_team("acme", "")
            .await
            .unwrap()
            .is_none(),
        "no policy row for team \"\""
    );
    let to = team("ak4-target", &[ADMIN]).await;
    let (status, body) = post(ADMIN, &format!("{base}/handoff"), json!({"to_team_id": to})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&response.id).await.team(), to);
}

struct IncidentFixture {
    alert_id: String,
    incident_id: String,
    owner: String,
    impacted: String,
}

async fn incident_with_owner_and_impacted_pages(name: &str) -> IncidentFixture {
    let alert_id = firing_alert(name).await;
    let incident_id = incident_of(&alert_id, name).await;
    let owner = escalation::start_for_incident(
        "acme",
        &incident_id,
        name,
        AlertPriority::P1,
        Some(&team(&format!("{name}-owner"), &[MEMBER]).await),
        &HashMap::new(),
    )
    .await
    .unwrap()
    .expect("the incident pages its owner");
    let impacted_team = team(&format!("{name}-impacted"), &[]).await;
    let impacted = oncall_responses::open(
        "acme",
        &impacted_subject(SubjectType::Incident, &incident_id, &impacted_team),
        Some(&impacted_team),
        AlertPriority::P1.to_i32(),
        Some(name),
        ResponderRole::Impacted,
        Some(&owner.id),
    )
    .await
    .unwrap();
    IncidentFixture {
        alert_id,
        incident_id,
        owner: owner.id,
        impacted: impacted.id,
    }
}

/// AK-8, AK-10, AK-12: an alert ack acknowledges its incident, its alert rows and every page.
async fn an_alert_ack_acknowledges_its_incident_and_stops_every_page(f: &IncidentFixture) {
    let ack = format!("/api/v2/acme/alerts/{}/ack", f.alert_id);
    let (status, body) = post(ADMIN, &ack, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    assert_eq!(body["incident"]["status"], "acknowledged", "{body}");
    let mut stopped: Vec<&str> = body["oncall"]["stopped"]
        .as_array()
        .map(|a| a.iter().filter_map(|p| p["team"].as_str()).collect())
        .unwrap_or_default();
    stopped.sort_unstable();
    assert_eq!(
        stopped,
        ["ak8-impacted", "ak8-owner"],
        "the toast names them: {body}"
    );
    assert_eq!(
        incident_holder(&f.incident_id).await,
        ("acknowledged".to_string(), Some(ADMIN.to_string()))
    );
    assert_eq!(
        row_holder(&f.alert_id).await,
        Some((ADMIN.to_string(), AckSource::Incident)),
        "the incident-source row carries the ack to other regions"
    );
    for id in [&f.owner, &f.impacted] {
        let p = page(id).await;
        assert_eq!(
            (p.state, p.acked_by.as_deref()),
            (ResponseState::Acknowledged, Some(ADMIN)),
            "{id}"
        );
    }
    assert_eq!(page_acks_by(&f.owner, ADMIN).await, 1);

    let (status, body) = post(TAKER, &ack, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], false, "already acknowledged: {body}");
    assert_eq!(
        incident_holder(&f.incident_id).await.1.as_deref(),
        Some(ADMIN)
    );
}

/// AK-13: a take over moves the incident, its alerts' rows and every page to the new holder.
async fn a_take_over_moves_every_record(f: &IncidentFixture) {
    let uri = format!(
        "/api/v2/acme/alerts/incidents/{}/acknowledge",
        f.incident_id
    );
    let (status, body) = post(TAKER, &uri, json!({"take_over": true})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], true, "{body}");
    assert_eq!(
        incident_holder(&f.incident_id).await.1.as_deref(),
        Some(TAKER)
    );
    assert_eq!(
        row_holder(&f.alert_id).await.map(|(who, _)| who).as_deref(),
        Some(TAKER)
    );
    for id in [&f.owner, &f.impacted] {
        assert_eq!(page(id).await.acked_by.as_deref(), Some(TAKER), "{id}");
    }
}

/// AK-14: unacknowledging a page clears the ack of its incident and of the incident's alerts.
async fn an_unack_clears_every_record(f: &IncidentFixture) {
    let uri = format!("/api/acme/oncall/responses/{}/unacknowledge", f.owner);
    let (status, body) = post(MEMBER, &uri, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ack"]["changed"], true, "{body}");
    assert_eq!(
        incident_holder(&f.incident_id).await,
        ("open".to_string(), None)
    );
    assert_eq!(row_holder(&f.alert_id).await, None);
    for id in [&f.owner, &f.impacted] {
        let p = page(id).await;
        assert_eq!(
            (p.state, p.acked_by),
            (ResponseState::Triggered, None),
            "the page the ack stopped restarts at step 1: {id}"
        );
    }
}

/// AK-5: the incident routes pass a paged viewer through and refuse a stranger with who can act.
async fn the_incident_routes_admit_a_paged_member_and_refuse_a_stranger(f: &IncidentFixture) {
    let uri = format!(
        "/api/v2/acme/alerts/incidents/{}/acknowledge",
        f.incident_id
    );
    let (status, body) = post(STRANGER, &uri, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "ack_refused", "{body}");
    let (status, body) = call_as(MEMBER, Method::POST, &uri, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "an empty body is a plain ack: {body}"
    );
    assert_eq!(
        incident_holder(&f.incident_id).await.1.as_deref(),
        Some(MEMBER)
    );
    let unack = format!(
        "/api/v2/acme/alerts/incidents/{}/unacknowledge",
        f.incident_id
    );
    let (status, body) = call_as(MEMBER, Method::POST, &unack, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(incident_holder(&f.incident_id).await.0, "open");
}

/// AK-9, D23: a firing joining an acknowledged incident takes the incident's ack.
async fn a_firing_joining_an_acknowledged_incident_is_acknowledged(f: &IncidentFixture) {
    let (status, body) = post(
        TAKER,
        &format!(
            "/api/v2/acme/alerts/incidents/{}/acknowledge",
            f.incident_id
        ),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let late = firing_alert("ak9-late").await;
    alert_incidents::add_alert_to_incident(&f.incident_id, &late, "late", "alert", FIRING, "test")
        .await
        .unwrap();
    ack::join_acked_incident("acme", &f.incident_id, &late).await;
    assert_eq!(
        row_holder(&late).await,
        Some((TAKER.to_string(), AckSource::Incident))
    );
}

/// P1-2, D27: a refused hand-off (same team, unknown team, outsider) changes nothing.
async fn a_refused_hand_off_keeps_the_ack_and_the_page() {
    let alert_id = firing_alert("p12").await;
    let owner = team("p12", &[ADMIN]).await;
    let response = alert_page(&alert_id, Some(&owner)).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/ack"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let uri = format!("/api/acme/oncall/responses/{}/handoff", response.id);
    for (target, want) in [
        (json!({"to_team_id": owner}), StatusCode::BAD_REQUEST),
        (json!({"to_team_id": "no_such_team"}), StatusCode::NOT_FOUND),
        (
            json!({"to": "outsider@example.com"}),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let to = target.to_string();
        let (status, body) = post(ADMIN, &uri, target).await;
        assert_eq!(status, want, "{to}: {body}");
        assert_eq!(
            row_holder(&alert_id).await.map(|(who, _)| who).as_deref(),
            Some(ADMIN),
            "{to}: the alert keeps its ack"
        );
        let kept = page(&response.id).await;
        assert_eq!(
            (kept.state, kept.acked_by.as_deref()),
            (ResponseState::Acknowledged, Some(ADMIN)),
            "{to}: the page keeps its ack"
        );
    }
}

/// AK-15, D27: a hand-off clears the ack everywhere and pages only the new team.
async fn a_hand_off_clears_the_ack_and_moves_the_page() {
    let alert_id = firing_alert("ak15").await;
    let response = alert_page(&alert_id, Some(&team("ak15", &[ADMIN]).await)).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/ack"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&response.id).await.state, ResponseState::Acknowledged);
    let to = team("ak15-target", &[TAKER]).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/handoff", response.id),
        json!({"to_team_id": to}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        row_holder(&alert_id).await,
        None,
        "the alert reads unacknowledged"
    );
    let moved = page(&response.id).await;
    assert_eq!(
        (moved.team(), moved.state),
        (to.as_str(), ResponseState::Triggered)
    );
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

/// AK-18, D25: a mute in the UI snoozes the problem's open page until the mute ends.
async fn a_mute_snoozes_the_open_page() {
    let alert_id = firing_alert("ak18").await;
    let response = alert_page(&alert_id, Some(&team("ak18", &[ADMIN]).await)).await;
    cache_alert(&alert_id).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/mute"),
        json!({"minutes": 30}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["pages"][0]["response_id"],
        response.id.as_str(),
        "{body}"
    );
    assert_eq!(body["pages"][0]["team"], "ak18", "{body}");
    let until = page(&response.id).await.snoozed_until.expect("snoozed");
    assert_eq!(body["pages"][0]["snoozed_until"], until, "{body}");
    assert!(until > now_micros() + 29 * 60 * 1_000_000, "{until}");
}

/// P1-1: an impacted page's Acknowledge acknowledges the whole problem (incident and alert).
async fn an_impacted_page_acknowledges_the_whole_problem() {
    let f = incident_with_owner_and_impacted_pages("p11-incident").await;
    let (status, body) = post(
        MEMBER,
        &format!("/api/acme/oncall/responses/{}/acknowledge", f.impacted),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        incident_holder(&f.incident_id).await,
        ("acknowledged".to_string(), Some(MEMBER.to_string()))
    );
    assert_eq!(page(&f.owner).await.acked_by.as_deref(), Some(MEMBER));

    let alert_id = firing_alert("p11-alert").await;
    let owner = alert_page(&alert_id, Some(&team("p11-alert", &[MEMBER]).await)).await;
    let impacted_team = team("p11-alert-impacted", &[]).await;
    let impacted = impacted_page(&owner, SubjectType::Alert, &impacted_team).await;
    let uri = format!("/api/acme/oncall/responses/{}/acknowledge", impacted.id);
    let (status, body) = post(MEMBER, &uri, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        row_holder(&alert_id).await.map(|(who, _)| who).as_deref(),
        Some(MEMBER)
    );
    assert_eq!(page(&owner.id).await.acked_by.as_deref(), Some(MEMBER));
}

/// P1-3, decision 4: a page whose alert no longer fires still stops, and restarts on Unacknowledge.
async fn a_page_whose_alert_stopped_firing_still_stops_and_restarts() {
    let alert_id = quiet_alert("p13").await;
    let response = alert_page(&alert_id, Some(&team("p13", &[ADMIN]).await)).await;
    let base = format!("/api/acme/oncall/responses/{}", response.id);
    let (status, body) = post(ADMIN, &format!("{base}/acknowledge"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&response.id).await.state, ResponseState::Acknowledged);
    let (status, body) = post(ADMIN, &format!("{base}/unacknowledge"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&response.id).await.state, ResponseState::Triggered);
}

/// P2-1, D26: promoting a page to an incident runs the one rule.
async fn promote_runs_the_one_rule() {
    let alert_id = firing_alert("p21").await;
    let response = alert_page(&alert_id, Some(&team("p21", &[MEMBER]).await)).await;
    let (status, body) = post(
        STRANGER,
        &format!("/api/acme/oncall/responses/{}/promote", response.id),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "ack_refused", "{body}");
}

/// P2-2 and the [weak] tags: a page step that fails is finished by the next press.
async fn a_failed_page_step_is_finished_by_the_next_press() {
    let alert_id = firing_alert("weak").await;
    let response = alert_page(&alert_id, Some(&team("weak", &[ADMIN, TAKER]).await)).await;
    let ack = format!("/api/v2/acme/alerts/{alert_id}/ack");
    let stuck = "weak_page_step_fails";

    fail_updates(stuck, "oncall_responses", "id", &response.id).await;
    let (status, body) = post(ADMIN, &ack, json!({})).await;
    unfail(stuck).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["oncall"]["still_paging"][0]["response_id"],
        response.id.as_str(),
        "{body}"
    );
    assert_eq!(page(&response.id).await.state, ResponseState::Triggered);
    let (status, body) = post(TAKER, &ack, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["changed"], false, "Ana's ack stands: {body}");
    assert_eq!(
        page(&response.id).await.acked_by.as_deref(),
        Some(ADMIN),
        "finished as the holder"
    );

    fail_updates(stuck, "oncall_responses", "id", &response.id).await;
    let (status, body) = post(TAKER, &ack, json!({"take_over": true})).await;
    unfail(stuck).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        row_holder(&alert_id).await.map(|(w, _)| w).as_deref(),
        Some(TAKER)
    );
    assert_eq!(page(&response.id).await.acked_by.as_deref(), Some(ADMIN));
    let (status, body) = post(TAKER, &ack, json!({"take_over": true})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        page(&response.id).await.acked_by.as_deref(),
        Some(TAKER),
        "the retry moves the page"
    );

    let unack = format!("/api/v2/acme/alerts/{alert_id}/unack");
    fail_updates(stuck, "oncall_responses", "id", &response.id).await;
    let (status, body) = post(TAKER, &unack, json!({})).await;
    unfail(stuck).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(row_holder(&alert_id).await, None);
    assert_eq!(page(&response.id).await.state, ResponseState::Acknowledged);
    let (status, body) = post(TAKER, &unack, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        page(&response.id).await.state,
        ResponseState::Triggered,
        "the next unack restarts it"
    );
}

/// The mute [weak] tag: a page the mute could not snooze says why.
async fn a_mute_says_why_a_page_was_not_snoozed() {
    let alert_id = firing_alert("mute-teamless").await;
    let response = alert_page(&alert_id, None).await;
    cache_alert(&alert_id).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/mute"),
        json!({"minutes": 30}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["pages"][0]["response_id"],
        response.id.as_str(),
        "{body}"
    );
    assert!(
        body["pages"][0]["refused"]
            .as_str()
            .is_some_and(|why| why.contains("no team yet")),
        "{body}"
    );
}

/// The hand-off [weak] tag: a release that fails stops the hand-off, so the page is not moved.
async fn a_failed_release_stops_the_hand_off() {
    let alert_id = firing_alert("release-fails").await;
    let response = alert_page(&alert_id, Some(&team("release-fails", &[ADMIN]).await)).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/ack"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let to = team("release-fails-target", &[TAKER]).await;
    let stuck = "release_fails";
    fail_updates(stuck, "alert_acks", "alert_id", &alert_id).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/handoff", response.id),
        json!({"to_team_id": to}),
    )
    .await;
    unfail(stuck).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    let kept = page(&response.id).await;
    assert_ne!(kept.team(), to, "the page was not handed off");
    assert_eq!(kept.state, ResponseState::Acknowledged);
}

/// AK-15: a hand-off to one person clears the ack and restarts the page for them.
async fn a_hand_off_to_a_person_clears_the_ack() {
    let alert_id = firing_alert("ak15-person").await;
    let response = alert_page(&alert_id, Some(&team("ak15-person", &[ADMIN, TAKER]).await)).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/ack"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/handoff", response.id),
        json!({"to": TAKER}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(row_holder(&alert_id).await, None);
    let moved = page(&response.id).await;
    assert_eq!(
        (moved.state, moved.acked_by),
        (ResponseState::Triggered, None)
    );
}

/// P3: a failed read of the firing's incident is an error, not an ack of the firing alone.
async fn a_failed_incident_read_is_an_error() {
    use sea_orm::ConnectionTrait;
    let alert_id = firing_alert("p3-incident-read").await;
    let db = infra::db::get_orm_client_rw().await;
    db.execute_unprepared("ALTER TABLE alert_incident_alerts RENAME TO alert_incident_alerts_gone")
        .await
        .unwrap();
    let got = ack::problem_of_alert("acme", &alert_id, Groups::All).await;
    db.execute_unprepared("ALTER TABLE alert_incident_alerts_gone RENAME TO alert_incident_alerts")
        .await
        .unwrap();
    assert!(matches!(got, Err(ack::AckError::Internal(_))), "{got:?}");
}

/// N1, R3-1, R3-3: on a closed page the one rule runs first; who may act gets the page's own
/// answer.
async fn a_press_on_a_closed_page_answers_from_the_page() {
    let alert_id = quiet_alert("n1").await;
    let response = alert_page(&alert_id, Some(&team("n1", &[MEMBER]).await)).await;
    escalation::resolve("acme", &response.id, ADMIN, None, None)
        .await
        .unwrap();
    let base = format!("/api/acme/oncall/responses/{}", response.id);
    for verb in ["acknowledge", "unacknowledge"] {
        let (status, body) = post(STRANGER, &format!("{base}/{verb}"), json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{verb}: {body}");
        let (status, body) = post(ADMIN, &format!("{base}/{verb}"), json!({})).await;
        assert_eq!(status, StatusCode::OK, "{verb}: {body}");
        assert_eq!(body["state"], "resolved", "{verb}: {body}");
        assert_eq!(body["ack"]["changed"], false, "N1: {verb}: {body}");
    }
    let link = token_for(&response.id, STRANGER, token::TokenPurpose::Link).await;
    let (status, body) = post_form("/api/v2/acme/oncall/ack", &format!("token={link}")).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let link = token_for(&response.id, ADMIN, token::TokenPurpose::Link).await;
    let (status, body) = post_form("/api/v2/acme/oncall/ack", &format!("token={link}")).await;
    assert_eq!(status, StatusCode::OK, "the outcome page: {body}");
    let voice = token_for(&response.id, STRANGER, token::TokenPurpose::Voice).await;
    let (status, body) = post_form(
        &format!("/api/v2/acme/oncall/ack/voice/{voice}"),
        "Digits=4",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("can&apos;t be changed by phone"), "{body}");
    let voice = token_for(&response.id, ADMIN, token::TokenPurpose::Voice).await;
    let (status, body) = post_form(
        &format!("/api/v2/acme/oncall/ack/voice/{voice}"),
        "Digits=4",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("already resolved"), "{body}");
}

/// R3-2: a press on the older of two open pages of an alert that stopped firing stops that page.
async fn a_press_on_an_older_open_page_stops_it() {
    let alert_id = quiet_alert("r32").await;
    let team_id = team("r32", &[ADMIN]).await;
    let page_of = |firing: u32| {
        let (alert_id, team_id) = (alert_id.clone(), team_id.clone());
        async move {
            oncall_responses::open(
                "acme",
                &SubjectRef::new(SubjectType::Alert, alert_id, firing),
                Some(&team_id),
                AlertPriority::P1.to_i32(),
                Some("r32"),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap()
        }
    };
    let older = page_of(1).await;
    let newer = page_of(2).await;
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/acknowledge", older.id),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&older.id).await.state, ResponseState::Acknowledged);
    assert_eq!(
        page(&newer.id).await.state,
        ResponseState::Acknowledged,
        "D19"
    );
    let phone_alert = quiet_alert("r32-phone").await;
    let open_page = |firing: u32| {
        let (alert_id, team_id) = (phone_alert.clone(), team_id.clone());
        async move {
            oncall_responses::open(
                "acme",
                &SubjectRef::new(SubjectType::Alert, alert_id, firing),
                Some(&team_id),
                AlertPriority::P1.to_i32(),
                Some("r32"),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap()
        }
    };
    let first = open_page(1).await;
    open_page(2).await;
    let voice = token_for(&first.id, ADMIN, token::TokenPurpose::Voice).await;
    let (status, body) = post_form(
        &format!("/api/v2/acme/oncall/ack/voice/{voice}"),
        "Digits=4",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        page(&first.id).await.state,
        ResponseState::Acknowledged,
        "{body}"
    );
}

/// D34: unack restarts, and take over moves, only the current firing's page; ack stops both.
async fn a_leftover_page_stays_stopped_on_unack_and_take_over() {
    let alert_id = quiet_alert("d34").await;
    let team_id = team("d34", &[ADMIN, TAKER]).await;
    let open_page = |firing: u32| {
        let (alert_id, team_id) = (alert_id.clone(), team_id.clone());
        async move {
            oncall_responses::open(
                "acme",
                &SubjectRef::new(SubjectType::Alert, alert_id, firing),
                Some(&team_id),
                AlertPriority::P1.to_i32(),
                Some("d34"),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap()
        }
    };
    let old = open_page(1).await;
    let now = open_page(2).await;
    let base = format!("/api/acme/oncall/responses/{}", now.id);
    let (status, body) = post(ADMIN, &format!("{base}/acknowledge"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        page(&old.id).await.acked_by.as_deref(),
        Some(ADMIN),
        "ack stops both"
    );
    let (status, body) = post(
        TAKER,
        &format!("{base}/acknowledge"),
        json!({"take_over": true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&now.id).await.acked_by.as_deref(), Some(TAKER));
    assert_eq!(
        page(&old.id).await.acked_by.as_deref(),
        Some(ADMIN),
        "the leftover stays"
    );
    escalation::acknowledge_as("acme", &now.id, TAKER)
        .await
        .unwrap();
    let (status, body) = post(TAKER, &format!("{base}/unacknowledge"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&now.id).await.state, ResponseState::Triggered);
    assert_eq!(
        page(&old.id).await.state,
        ResponseState::Acknowledged,
        "a dead firing never pages again"
    );
}

/// D35: the team of any open page of the alert, a leftover included, may act.
async fn a_leftover_pages_team_is_a_responder() {
    let alert_id = quiet_alert("d35").await;
    let open_page = |firing: u32, team_id: String| {
        let alert_id = alert_id.clone();
        async move {
            oncall_responses::open(
                "acme",
                &SubjectRef::new(SubjectType::Alert, alert_id, firing),
                Some(&team_id),
                AlertPriority::P1.to_i32(),
                Some("d35"),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap()
        }
    };
    open_page(1, team("d35-old", &[MEMBER]).await).await;
    let now = open_page(2, team("d35-now", &[]).await).await;
    let (status, body) = post(
        MEMBER,
        &format!("/api/acme/oncall/responses/{}/acknowledge", now.id),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// N2: a page step that took no effect does not report a change.
async fn a_press_that_changes_nothing_says_so() {
    use sea_orm::ConnectionTrait;
    let alert_id = quiet_alert("n2").await;
    let response = alert_page(&alert_id, Some(&team("n2", &[ADMIN]).await)).await;
    let name = "n2_page_update_ignored";
    unfail(name).await;
    infra::db::get_orm_client_rw()
        .await
        .execute_unprepared(&format!(
            "CREATE TRIGGER {name} BEFORE UPDATE ON oncall_responses WHEN OLD.id = '{}' \
             BEGIN SELECT RAISE(IGNORE); END",
            response.id
        ))
        .await
        .unwrap();
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/acknowledge", response.id),
        json!({}),
    )
    .await;
    unfail(name).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ack"]["changed"], false, "{body}");
}

/// OSS-N3: a restart whose trigger is not armed still took effect, and the unack says so.
async fn an_unack_whose_restart_lost_its_trigger_still_reports_it() {
    use sea_orm::ConnectionTrait;
    let alert_id = quiet_alert("n3").await;
    let response = alert_page(&alert_id, Some(&team("n3", &[ADMIN]).await)).await;
    escalation::acknowledge_as("acme", &response.id, ADMIN)
        .await
        .unwrap();
    let name = "n3_trigger_insert_fails";
    unfail(name).await;
    infra::db::get_orm_client_rw()
        .await
        .execute_unprepared(&format!(
            "CREATE TRIGGER {name} BEFORE INSERT ON scheduled_jobs WHEN NEW.module_key = '{}' \
             BEGIN SELECT RAISE(ABORT, 'insert fails'); END",
            response.id
        ))
        .await
        .unwrap();
    let (status, body) = post(
        ADMIN,
        &format!("/api/acme/oncall/responses/{}/unacknowledge", response.id),
        json!({}),
    )
    .await;
    unfail(name).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(page(&response.id).await.state, ResponseState::Triggered);
    assert_eq!(
        body["ack"]["changed"], true,
        "the restart took effect: {body}"
    );
}

/// N5: a failed read of the problem's pages is an error, not an ack that pages on.
async fn a_failed_page_read_is_an_error() {
    use sea_orm::ConnectionTrait;
    let alert_id = firing_alert("n5").await;
    let db = infra::db::get_orm_client_rw().await;
    db.execute_unprepared("ALTER TABLE oncall_responses RENAME TO oncall_responses_gone")
        .await
        .unwrap();
    let (status, body) = post(
        ADMIN,
        &format!("/api/v2/acme/alerts/{alert_id}/ack"),
        json!({}),
    )
    .await;
    let target = ack::resolve_target("acme", &alert_id).await.unwrap();
    let pages =
        ack::snooze_pages_until(&target, ADMIN, now_micros() + 60_000_000, now_micros()).await;
    db.execute_unprepared("ALTER TABLE oncall_responses_gone RENAME TO oncall_responses")
        .await
        .unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    assert!(row_holder(&alert_id).await.is_none(), "nothing written");
    assert!(
        pages.len() == 1 && pages[0].refused.is_some(),
        "N4: a mute says its pages could not be read: {pages:?}"
    );
}

#[derive(Clone, Copy, Debug)]
enum Surface {
    AlertRoute,
    IncidentRoute,
    PageRoute,
    EmailLink,
    PhoneKey,
}

/// Presses Acknowledge on one surface as the paged member.
async fn press(surface: Surface, f: &IncidentFixture) {
    let ok = |status: StatusCode, body: &str| {
        assert!(
            status.is_success() || status == StatusCode::SEE_OTHER,
            "{surface:?}: {status} {body}"
        )
    };
    match surface {
        Surface::AlertRoute => {
            let uri = format!("/api/v2/acme/alerts/{}/ack", f.alert_id);
            let (status, body) = post(MEMBER, &uri, json!({})).await;
            ok(status, &body.to_string());
        }
        Surface::IncidentRoute => {
            let uri = format!(
                "/api/v2/acme/alerts/incidents/{}/acknowledge",
                f.incident_id
            );
            let (status, body) = post(MEMBER, &uri, json!({})).await;
            ok(status, &body.to_string());
        }
        Surface::PageRoute => {
            let uri = format!("/api/acme/oncall/responses/{}/acknowledge", f.owner);
            let (status, body) = post(MEMBER, &uri, json!({})).await;
            ok(status, &body.to_string());
        }
        Surface::EmailLink => {
            let tok = token_for(&f.owner, MEMBER, token::TokenPurpose::Link).await;
            let (status, body) =
                post_form("/api/v2/acme/oncall/ack", &format!("token={tok}")).await;
            ok(status, &body);
        }
        Surface::PhoneKey => {
            let tok = token_for(&f.owner, MEMBER, token::TokenPurpose::Voice).await;
            let (status, body) =
                post_form(&format!("/api/v2/acme/oncall/ack/voice/{tok}"), "Digits=4").await;
            ok(status, &body);
            assert!(body.contains("Acknowledged"), "{surface:?}: {body}");
        }
    }
}

/// AK-2: a press on every surface writes the incident, its alert rows and every page.
async fn every_surface_reaches_the_one_ack() {
    for surface in [
        Surface::AlertRoute,
        Surface::IncidentRoute,
        Surface::PageRoute,
        Surface::EmailLink,
        Surface::PhoneKey,
    ] {
        let f = incident_with_owner_and_impacted_pages(&format!("ak2-{surface:?}")).await;
        press(surface, &f).await;
        assert_eq!(
            incident_holder(&f.incident_id).await,
            ("acknowledged".to_string(), Some(MEMBER.to_string())),
            "{surface:?}"
        );
        assert_eq!(
            row_holder(&f.alert_id).await,
            Some((MEMBER.to_string(), AckSource::Incident)),
            "{surface:?}"
        );
        for id in [&f.owner, &f.impacted] {
            assert_eq!(
                page(id).await.acked_by.as_deref(),
                Some(MEMBER),
                "{surface:?}: {id}"
            );
        }
    }
}

/// AK-4: the phone and the email link run the one rule too, though the token names its person.
async fn the_phone_and_the_link_refuse_someone_the_rule_refuses() {
    let f = incident_with_owner_and_impacted_pages("ak4-tokens").await;
    let voice = token_for(&f.owner, STRANGER, token::TokenPurpose::Voice).await;
    let (status, body) = post_form(
        &format!("/api/v2/acme/oncall/ack/voice/{voice}"),
        "Digits=4",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("can&apos;t be changed by phone"), "{body}");
    let link = token_for(&f.owner, STRANGER, token::TokenPurpose::Link).await;
    let (status, body) = post_form("/api/v2/acme/oncall/ack", &format!("token={link}")).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(
        incident_holder(&f.incident_id).await,
        ("open".to_string(), None)
    );
    assert_eq!(page(&f.owner).await.state, ResponseState::Triggered);
}

/// D24: with OpenFGA on, edit on any one alert of the incident admits the actor.
async fn openfga_edit_on_any_alert_of_an_incident_admits() {
    let first = firing_alert("d24-first").await;
    let incident_id = incident_of(&first, "D24").await;
    let second = firing_alert("d24-second").await;
    alert_incidents::add_alert_to_incident(&incident_id, &second, "second", "alert", FIRING, "t")
        .await
        .unwrap();
    let problem = Problem::Incident {
        org_id: "acme".into(),
        incident_id,
    };
    let only = |id: String| {
        move |t: ack::AckTarget| {
            let id = id.clone();
            async move { t.alert_id == id }
        }
    };
    assert!(ack::may_edit_any_alert_with(&problem, only(second.clone())).await);
    assert!(ack::may_edit_any_alert_with(&problem, only(first.clone())).await);
    assert!(!ack::may_edit_any_alert_with(&problem, only("none".into())).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_ack_end_to_end() {
    boot().await;
    seed().await;
    the_problem_is_the_incident_when_there_is_one_else_the_firing().await;
    every_page_action_runs_the_one_rule().await;
    a_teamless_page_refuses_escalate_and_snooze_and_can_be_handed_off().await;
    let f = incident_with_owner_and_impacted_pages("ak8").await;
    an_alert_ack_acknowledges_its_incident_and_stops_every_page(&f).await;
    a_take_over_moves_every_record(&f).await;
    an_unack_clears_every_record(&f).await;
    the_incident_routes_admit_a_paged_member_and_refuse_a_stranger(&f).await;
    a_firing_joining_an_acknowledged_incident_is_acknowledged(&f).await;
    a_refused_hand_off_keeps_the_ack_and_the_page().await;
    a_hand_off_clears_the_ack_and_moves_the_page().await;
    a_mute_snoozes_the_open_page().await;
    an_impacted_page_acknowledges_the_whole_problem().await;
    a_page_whose_alert_stopped_firing_still_stops_and_restarts().await;
    promote_runs_the_one_rule().await;
    a_failed_page_step_is_finished_by_the_next_press().await;
    a_mute_says_why_a_page_was_not_snoozed().await;
    a_failed_release_stops_the_hand_off().await;
    a_hand_off_to_a_person_clears_the_ack().await;
    every_surface_reaches_the_one_ack().await;
    the_phone_and_the_link_refuse_someone_the_rule_refuses().await;
    openfga_edit_on_any_alert_of_an_incident_admits().await;
    a_failed_incident_read_is_an_error().await;
    a_press_on_a_closed_page_answers_from_the_page().await;
    a_press_on_an_older_open_page_stops_it().await;
    a_leftover_page_stays_stopped_on_unack_and_take_over().await;
    a_leftover_pages_team_is_a_responder().await;
    a_press_that_changes_nothing_says_so().await;
    an_unack_whose_restart_lost_its_trigger_still_reports_it().await;
    a_failed_page_read_is_an_error().await;
}

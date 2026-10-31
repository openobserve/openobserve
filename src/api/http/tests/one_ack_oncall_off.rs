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

//! Own test binary: with on-call off, an ack is the problem's and pages nothing (AK-1).

#![cfg(feature = "enterprise")]
// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

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
    alert_incidents, alert_states, folders, org_users, organizations, users, users::UserRecord,
};
use openobserve_api_http::handler::http::router::create_app_router;
use openobserve_core::alerts::ack::{self, Groups, Problem};
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@acme.test";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const FIRING: i64 = 1_760_000_000_000_000;

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-one-ack-off-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("O2_ONCALL_ENABLED", "false");
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    assert!(!o2_enterprise::enterprise::oncall::is_enabled());
}

async fn seed() {
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
    org_users::add("acme", ADMIN, UserRole::Admin, "tok-admin", None)
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
    alert_states::persist(
        &StateUpdate {
            state: Some(AlertState {
                last_outcome: Some(RunOutcome::Firing),
                last_outcome_at: Some(FIRING),
                since: Some(FIRING),
                firing_started_at: Some(FIRING),
                ..AlertState::empty(&alert_id, "")
            }),
            transition: None,
        },
        None,
    )
    .await
    .unwrap();
    alert_id
}

async fn ack_as_admin(alert_id: &str) -> (StatusCode, Value) {
    let basic = BASE64_STANDARD.encode(format!("{ADMIN}:{PASSWORD}"));
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/v2/acme/alerts/{alert_id}/ack"))
        .header("Authorization", format!("Basic {basic}"))
        .header("content-type", "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let response = create_app_router(|_| Router::new())
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// AK-1, decision 1: with on-call off the problem is still the incident, and nothing is paged.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn with_oncall_off_an_ack_is_the_problems_and_pages_nothing() {
    boot().await;
    seed().await;
    let alone = firing_alert("off-alone").await;
    assert!(matches!(
        ack::problem_of_alert("acme", &alone, Groups::All)
            .await
            .unwrap(),
        Problem::Firing { .. }
    ));
    let joined = firing_alert("off-joined").await;
    let incident = alert_incidents::create("acme", "P2", json!({}), "alert", FIRING, None)
        .await
        .unwrap();
    alert_incidents::add_alert_to_incident(&incident.id, &joined, "j", "alert", FIRING, "t")
        .await
        .unwrap();
    let (status, body) = ack_as_admin(&joined).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["incident"]["status"], "acknowledged", "{body}");
    assert!(
        body.get("oncall").is_none(),
        "no pages with on-call off: {body}"
    );
}

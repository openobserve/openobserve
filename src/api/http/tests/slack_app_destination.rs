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

//! Own test binary: process-wide master key, Slack config, a fake Slack Web API and the queue.

#![cfg(feature = "enterprise")]
// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    meta::{
        alerts::{alert::Alert, level::AlertLevel},
        destinations::{Destination, DestinationType, Endpoint, Module},
        organization::OrganizationType,
        slack::{
            AlertSlackEvent, AlertSlackEventKind, SLACK_OUTBOUND_TOPIC, SetFrom, SlackInstallation,
            SlackOrgConnection,
        },
        user::{UserRole, UserType},
    },
    utils::time::now_micros,
};
use infra::table::{cipher, org_users, organizations, users, users::UserRecord};
use o2_enterprise::enterprise::slack::store;
use openobserve_api_http::handler::http::router::create_app_router;
use openobserve_core::alerts::{alert::AlertExt, slack_publish};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
use tower::ServiceExt;

const ADMIN: &str = "admin@acme.test";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const INSTALL: &str = "I0FAKE00001";
const TEAM: &str = "T0FAKE00001";
const PLAIN: &str = "C0FAKE00001";
const SHARED: &str = "C0FAKE00002";
const ARCHIVED: &str = "C0FAKE00003";
const ONCALL_ROOM: &str = "C0FAKE00004";

static SLACK_CALLS: Mutex<Vec<(String, HashMap<String, String>)>> = Mutex::new(Vec::new());

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config.
    unsafe { std::env::set_var(key, value) };
}

/// Answers `conversations.info` per channel and `chat.postMessage`, recording every call.
fn serve_fake_slack() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let (method, form) = read_request(&mut stream);
            let body = reply(&method, &form);
            SLACK_CALLS.lock().unwrap().push((method, form));
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    format!("http://127.0.0.1:{port}/api")
}

fn read_request(stream: &mut std::net::TcpStream) -> (String, HashMap<String, String>) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let (head_end, length) = loop {
        let n = stream.read(&mut chunk).unwrap_or(0);
        if n == 0 {
            return (String::new(), HashMap::new());
        }
        buf.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&buf).to_string();
        if let Some(end) = text.find("\r\n\r\n") {
            let length = text[..end]
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.eq_ignore_ascii_case("content-length")
                        .then(|| v.trim().parse::<usize>().ok())?
                })
                .unwrap_or(0);
            break (end + 4, length);
        }
    };
    while buf.len() < head_end + length {
        let n = stream.read(&mut chunk).unwrap_or(0);
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let text = String::from_utf8_lossy(&buf).to_string();
    let method = text
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string();
    let form = url::form_urlencoded::parse(&text.as_bytes()[head_end..])
        .into_owned()
        .collect();
    (method, form)
}

fn reply(method: &str, form: &HashMap<String, String>) -> String {
    let channel = form.get("channel").cloned().unwrap_or_default();
    match method {
        "conversations.info" => {
            let info = |ext: bool, archived: bool| {
                json!({"ok": true, "channel": {"id": channel, "name": "sre-prod", "is_member": true,
                    "is_ext_shared": ext, "is_archived": archived}})
            };
            match channel.as_str() {
                PLAIN | ONCALL_ROOM => info(false, false),
                SHARED => info(true, false),
                ARCHIVED => info(false, true),
                _ => json!({"ok": false, "error": "channel_not_found"}),
            }
            .to_string()
        }
        "chat.postMessage" => {
            json!({"ok": true, "channel": channel, "ts": "1760000000.000100"}).to_string()
        }
        _ => json!({"ok": false, "error": "unknown_method"}).to_string(),
    }
}

fn master_key() -> String {
    BASE64_STANDARD.encode([7u8; 64])
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-slack-app-dest-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("ZO_WEB_URL", "http://o2.test:5080");
    set_env("ZO_SKIP_SSRF_CHECKS", "true");
    set_env("O2_SLACK_ENABLED", "true");
    set_env("O2_MASTER_ENCRYPTION_KEY", &master_key());
    set_env("O2_SLACK_API_BASE_URL", &serve_fake_slack());
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    cipher::boot(Some(&master_key())).await.unwrap();
    assert!(o2_enterprise::enterprise::slack::enabled_for("acme"));
}

async fn seed() {
    for org in ["acme", "beta"] {
        organizations::add(org, org, OrganizationType::Custom)
            .await
            .unwrap();
    }
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
    for org in ["acme", "beta"] {
        org_users::add(org, ADMIN, UserRole::Admin, &format!("tok-{org}"), None)
            .await
            .unwrap();
    }
    store::slack_installations::put(&SlackInstallation {
        id: INSTALL.to_string(),
        app_id: "A0FAKE00001".to_string(),
        team_id: TEAM.to_string(),
        team_name: "Acme".to_string(),
        bot_token: Some("xoxb-fake".to_string()),
        installed_by: ADMIN.to_string(),
        installed_org_id: "acme".to_string(),
        created_at: now_micros(),
        credentials_readable: true,
        ..Default::default()
    })
    .await
    .unwrap();
    for org in ["acme", "beta"] {
        store::slack_org_connections::put(&SlackOrgConnection {
            installation_id: INSTALL.to_string(),
            org_id: org.to_string(),
            connected_by: ADMIN.to_string(),
            created_at: now_micros(),
            ..Default::default()
        })
        .await
        .unwrap();
    }
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

/// The body the destination form builds (`buildSlackAppDestination`).
fn app_body(name: &str, channel: &str) -> Value {
    json!({
        "name": name, "type": "slack_app", "installation_id": INSTALL,
        "channel_id": channel, "channel_name": "sre-prod", "buttons": true,
        "mention": "default", "refire_reuse_minutes": 30, "auto_investigate": "off",
        "shared_channel_confirmed": false, "oncall_room_confirmed": false
    })
}

fn with(mut body: Value, key: &str, value: Value) -> Value {
    body[key] = value;
    body
}

fn webhook(org: &str, name: &str, channel: &str) -> Destination {
    Destination {
        id: None,
        org_id: org.to_string(),
        name: name.to_string(),
        module: Module::Alert {
            template: None,
            destination_type: DestinationType::Http(Endpoint {
                url: "https://hooks.slack.com/services/T0FAKE/B0FAKE/x".to_string(),
                destination_type: Some("slack".to_string()),
                metadata: hashbrown::HashMap::from([
                    ("prebuilt_type".to_string(), "slack".to_string()),
                    ("slack_team_id".to_string(), TEAM.to_string()),
                    ("slack_channel_id".to_string(), channel.to_string()),
                ]),
                ..Default::default()
            }),
        },
    }
}

async fn create_and_read_back_fills_the_default_once() {
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("sre-app", PLAIN)),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let (code, got) = call(Method::GET, "/api/acme/alerts/destinations/sre-app", None).await;
    assert_eq!(code, StatusCode::OK, "{got}");
    assert_eq!(got["type"], "slack_app");
    assert_eq!(got["channel_id"], PLAIN);
    assert_eq!(got["installation_id"], INSTALL);
    assert_eq!(got["buttons"], true);
    assert_eq!(
        got["template"], "prebuilt_slack",
        "the Slack template is chosen"
    );
    assert!(got.get("url").is_none_or(|u| u == ""), "{got}");
    let default = infra::table::slack_channel_defaults::get(INSTALL, PLAIN)
        .await
        .unwrap()
        .expect("the channel had no default, so the save set it");
    assert_eq!(
        (
            default.org_id.as_str(),
            default.set_from,
            default.updated_by.as_str()
        ),
        ("acme", SetFrom::Destination, ADMIN)
    );
    let (code, body) = call(
        Method::POST,
        "/api/beta/alerts/destinations",
        Some(app_body("beta-app", PLAIN)),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let after = infra::table::slack_channel_defaults::get(INSTALL, PLAIN)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        after.org_id, "acme",
        "another org's save never moves the default"
    );
}

async fn shared_archived_and_unknown_channels_are_refused() {
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("shared-app", SHARED)),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "shared_channel_unconfirmed");
    let ticked = with(
        app_body("shared-app", SHARED),
        "shared_channel_confirmed",
        json!(true),
    );
    let (code, body) = call(Method::POST, "/api/acme/alerts/destinations", Some(ticked)).await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("archived-app", ARCHIVED)),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "slack_target");
    assert_eq!(body["message"], "#sre-prod is archived");
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("gone-app", "C0FAKE00099")),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["message"].as_str().unwrap().contains("not found"),
        "{body}"
    );
}

async fn an_oncall_room_needs_the_confirm_and_its_webhook_is_not_switched() {
    openobserve_core::alerts::destinations::save(
        "",
        webhook("acme", "pay-slack", ONCALL_ROOM),
        true,
    )
    .await
    .unwrap();
    let team = infra::table::oncall_teams::create("acme", "payments", "UTC", None)
        .await
        .unwrap();
    infra::table::oncall_teams::set_channel("acme", &team.id, Some(vec!["pay-slack".to_string()]))
        .await
        .unwrap();
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("room-app", ONCALL_ROOM)),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "oncall_room_unconfirmed");
    assert_eq!(body["team"], "payments");
    assert_eq!(body["destination"], "pay-slack");
    let ticked = with(
        app_body("room-app", ONCALL_ROOM),
        "oncall_room_confirmed",
        json!(true),
    );
    let (code, body) = call(Method::POST, "/api/acme/alerts/destinations", Some(ticked)).await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let switch = app_body("pay-slack", ONCALL_ROOM);
    let (code, body) = call(
        Method::PUT,
        "/api/acme/alerts/destinations/pay-slack",
        Some(with(switch, "oncall_room_confirmed", json!(true))),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "used_by_oncall");
    let err = o2_enterprise::enterprise::oncall::service::refuse_slack_app_destinations(
        "acme",
        &["room-app".to_string()],
    )
    .await
    .expect_err("a team room cannot be a Slack app destination");
    assert!(
        err.to_string().contains("cannot receive on-call pages"),
        "{err}"
    );
}

async fn a_switch_keeps_name_id_and_template_and_switch_back_restores_the_webhook() {
    let saved =
        openobserve_core::alerts::destinations::save("", webhook("acme", "ops-hook", PLAIN), true)
            .await
            .unwrap();
    let id = saved.id;
    let previous = json!({
        "url": "https://hooks.slack.com/services/T0FAKE/B0FAKE/x", "method": "post",
        "metadata": {"prebuilt_type": "slack", "slack_channel_id": PLAIN}
    });
    let switch = with(
        with(app_body("ops-hook", PLAIN), "previous_webhook", previous),
        "template",
        json!("prebuilt_slack"),
    );
    let (code, body) = call(
        Method::PUT,
        "/api/acme/alerts/destinations/ops-hook",
        Some(switch),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let row = db::alerts::destinations::get("acme", "ops-hook")
        .await
        .unwrap();
    assert_eq!(
        row.id, id,
        "an in-place edit keeps the id the alerts reference"
    );
    let (_, got) = call(Method::GET, "/api/acme/alerts/destinations/ops-hook", None).await;
    assert_eq!(got["type"], "slack_app");
    assert_eq!(
        got["previous_webhook"]["url"],
        "https://hooks.slack.com/services/T0FAKE/B0FAKE/x"
    );
    let back = json!({
        "name": "ops-hook", "type": "http", "method": "post", "template": "prebuilt_slack",
        "url": "https://hooks.slack.com/services/T0FAKE/B0FAKE/x",
        "destination_type_name": "slack",
        "metadata": {"prebuilt_type": "slack", "slack_channel_id": PLAIN}
    });
    let (code, body) = call(
        Method::PUT,
        "/api/acme/alerts/destinations/ops-hook",
        Some(back),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let (_, got) = call(Method::GET, "/api/acme/alerts/destinations/ops-hook", None).await;
    assert_eq!(got["type"], "http");
    assert_eq!(
        got["url"],
        "https://hooks.slack.com/services/T0FAKE/B0FAKE/x"
    );
    assert!(got.get("previous_webhook").is_none(), "{got}");
}

async fn a_row_from_a_newer_release_is_never_overwritten() {
    openobserve_core::alerts::destinations::save("", webhook("acme", "future", PLAIN), true)
        .await
        .unwrap();
    infra::db::get_orm_client_rw()
        .await
        .execute_unprepared(
            r#"UPDATE destinations SET type='{"type":"from_a_newer_release"}' WHERE org='acme' AND name='future'"#,
        )
        .await
        .unwrap();
    common::infra::config::DESTINATIONS.remove("acme/future");
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations",
        Some(app_body("future", PLAIN)),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "version_mismatch");
    let (code, body) = call(
        Method::PUT,
        "/api/acme/alerts/destinations/future",
        Some(app_body("future", PLAIN)),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("upgrade every node first"),
        "{body}"
    );
}

async fn send_test_posts_now_and_returns_slacks_answer() {
    SLACK_CALLS.lock().unwrap().clear();
    let (code, body) = call(
        Method::POST,
        "/api/acme/alerts/destinations/test",
        Some(json!({
            "type": "slack_app", "template": "prebuilt_slack",
            "slackApp": {"installation_id": INSTALL, "channel_id": PLAIN, "channel_name": "sre-prod",
                "buttons": true, "mention": "default", "refire_reuse_minutes": 30,
                "auto_investigate": "off", "shared_channel_confirmed": false,
                "oncall_room_confirmed": false}
        })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert_eq!(body["success"], true, "{body}");
    let calls = SLACK_CALLS.lock().unwrap().clone();
    let post = calls
        .iter()
        .find(|(m, _)| m == "chat.postMessage")
        .expect("Send test posts synchronously");
    assert_eq!(post.1.get("channel").map(String::as_str), Some(PLAIN));
    let rendered = format!(
        "{} {}",
        post.1["text"],
        post.1.get("blocks").cloned().unwrap_or_default()
    );
    assert!(rendered.contains("[TEST]"), "{rendered}");
}

async fn a_real_alert_send_publishes_one_keyed_fire_and_a_dead_queue_is_notify_failed() {
    let dest = db::alerts::destinations::get("acme", "sre-app")
        .await
        .unwrap();
    let mut alert = Alert::default();
    alert.org_id = "acme".to_string();
    alert.name = "checkout-errors".to_string();
    alert.stream_name = "checkout".to_string();
    alert.id = Some(<svix_ksuid::Ksuid as svix_ksuid::KsuidLike>::new(
        None, None,
    ));
    alert.destinations = vec!["sre-app".to_string()];
    let alert_id = alert.id.unwrap().to_string();
    let row: serde_json::Map<String, Value> =
        serde_json::from_value(json!({"host": "web-1", "count": 3})).unwrap();
    let rows = vec![row];
    let now = now_micros();
    let send = |alert: Alert| {
        let rows = rows.clone();
        async move {
            alert
                .send_notification(
                    "trace",
                    &rows,
                    now,
                    None,
                    now,
                    Some(AlertLevel::Critical),
                    Some(3.0),
                    None,
                    &[],
                    None,
                )
                .await
        }
    };
    let err = send(alert.clone())
        .await
        .expect_err("the stream does not exist yet");
    assert!(err.to_string().contains("sre-app"), "{err}");

    let queue = infra::queue::get_queue().await;
    queue.create(SLACK_OUTBOUND_TOPIC).await.unwrap();
    let mut consumer = queue.consume(SLACK_OUTBOUND_TOPIC, None).await.unwrap();
    let outcome = send(alert.clone()).await.expect("queued");
    assert_eq!(outcome.succeeded, vec!["sre-app".to_string()]);
    let rx = Arc::get_mut(&mut consumer).expect("one consumer");
    let msg = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let event: AlertSlackEvent = serde_json::from_slice(msg.message()).unwrap();
    assert_eq!(event.kind, AlertSlackEventKind::Fire);
    assert_eq!(event.destination_id, dest.id.unwrap().to_string());
    assert_eq!(event.alert_id, alert_id);
    assert_eq!(event.org_id, "acme");
    assert_eq!(event.group_key, "");
    assert_eq!(event.level, AlertLevel::Critical);
    let rendered = event.rendered.clone().expect("Fire carries the content");
    assert!(rendered.title.contains("checkout-errors"), "{rendered:?}");
    assert_eq!(
        slack_publish::take_pending_start(&alert_id, now_micros()),
        Some(event.firing_started_at),
        "the run's state commit writes the start the event carries"
    );
    println!(
        "SAMPLE_FIRE_EVENT {}",
        serde_json::to_string(&event).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slack_app_destinations_end_to_end() {
    boot().await;
    seed().await;
    create_and_read_back_fills_the_default_once().await;
    shared_archived_and_unknown_channels_are_refused().await;
    an_oncall_room_needs_the_confirm_and_its_webhook_is_not_switched().await;
    a_switch_keeps_name_id_and_template_and_switch_back_restores_the_webhook().await;
    a_row_from_a_newer_release_is_never_overwritten().await;
    send_test_posts_now_and_returns_slacks_answer().await;
    a_real_alert_send_publishes_one_keyed_fire_and_a_dead_queue_is_notify_failed().await;
}

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

//! Own test binary: it installs the process-wide master key and flips process-wide Slack config.

#![cfg(feature = "enterprise")]

use std::{
    io::{Read, Write},
    sync::Mutex,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    meta::{
        organization::OrganizationType,
        slack::{ExternalIdentityLink, RevokedReason, SlackInstallation, SlackOrgConnection},
        user::{UserRole, UserType},
    },
    utils::{
        delegation::{Claims, SCOPE_ASSISTANT, TOKEN_VERSION, effective_keys, sign},
        time::now_micros,
    },
};
use infra::table::{cipher, org_users, organizations, users, users::UserRecord};
use o2_enterprise::enterprise::{
    common::{auditor, config::refresh_config as refresh_o2_config},
    slack::store,
};
use openobserve_api_http::handler::http::router::create_app_router;
use tower::ServiceExt;

const ALICE: &str = "alice@acme.io";
const BOB: &str = "bob@acme.io";
const STALE: &str = "stale@acme.io";
const CAROL: &str = "carol@acme.io";

static AUDITS: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());

fn master_key() -> String {
    BASE64_STANDARD.encode([9u8; 64])
}

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config, then serially.
    unsafe { std::env::set_var(key, value) };
}

/// A JWKS endpoint with no keys, so a non-`o2dt` bearer fails validation instead of needing Dex.
fn serve_empty_jwks() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            let body = r#"{"keys":[]}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    format!("http://127.0.0.1:{port}/dex")
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-slack-delegated-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("O2_SLACK_ENABLED", "true");
    set_env("O2_MASTER_ENCRYPTION_KEY", &master_key());
    set_env("O2_AUDIT_ENABLED", "true");
    set_env("O2_AUDIT_BATCH_SIZE", "100000");
    set_env("O2_DEX_BASE_URL", &serve_empty_jwks());
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    cipher::boot(Some(&master_key())).await.unwrap();
    assert!(cipher::is_encrypting());
    assert!(o2_enterprise::enterprise::slack::enabled_for("acme"));
}

async fn add_member(org: &str, email: &str, role: UserRole) {
    let _ = users::add(user_record(email, false)).await;
    org_users::add(org, email, role, &format!("tok-{email}"), None)
        .await
        .unwrap();
}

fn user_record(email: &str, must_reset_password: bool) -> UserRecord {
    UserRecord {
        email: email.to_string(),
        first_name: "T".to_string(),
        last_name: "U".to_string(),
        password: "hash".to_string(),
        salt: "salt".to_string(),
        is_root: false,
        password_ext: None,
        user_type: UserType::Internal,
        created_at: 0,
        updated_at: 0,
        must_reset_password,
        password_reset_reason: None,
        flagged_at: None,
        password_updated_at: Some(now_micros()),
    }
}

async fn seed() {
    for org in ["acme", "other", "third", "kv"] {
        organizations::add(org, org, OrganizationType::Custom)
            .await
            .unwrap();
    }
    add_member("acme", ALICE, UserRole::Admin).await;
    add_member("other", ALICE, UserRole::Admin).await;
    add_member("third", ALICE, UserRole::Admin).await;
    add_member("kv", ALICE, UserRole::Admin).await;
    add_member("acme", BOB, UserRole::Viewer).await;
    add_member("acme", STALE, UserRole::Admin).await;
    add_member("acme", CAROL, UserRole::Admin).await;
    installation("I1").await;
    installation("I2").await;
    store::slack_installations::revoke("I2", now_micros())
        .await
        .unwrap();
    for org in ["acme", "other", "kv"] {
        connect("I1", org).await;
    }
    connect("I2", "acme").await;
    for (lid, team_user, email, installation_id) in [
        ("lnk_alice", "U1", ALICE, "I1"),
        ("lnk_bob", "U2", BOB, "I1"),
        ("lnk_stale", "U3", STALE, "I1"),
        ("lnk_revoked", "U4", CAROL, "I1"),
        ("lnk_old_install", "U5", CAROL, "I2"),
    ] {
        link(lid, team_user, email, installation_id).await;
    }
    store::external_identity_links::revoke("lnk_revoked", RevokedReason::Unlinked, now_micros())
        .await
        .unwrap();
    common::infra::config::USERS.insert(STALE.to_string(), user_record(STALE, true));
}

async fn installation(id: &str) {
    store::slack_installations::put(&SlackInstallation {
        id: id.to_string(),
        app_id: "A0APP".to_string(),
        team_id: format!("T-{id}"),
        team_name: "Acme".to_string(),
        bot_token: Some("xoxb-bot".to_string()),
        installed_by: ALICE.to_string(),
        installed_org_id: "acme".to_string(),
        created_at: now_micros(),
        credentials_readable: true,
        ..Default::default()
    })
    .await
    .unwrap();
}

async fn connect(installation_id: &str, org: &str) {
    store::slack_org_connections::put(&SlackOrgConnection {
        installation_id: installation_id.to_string(),
        org_id: org.to_string(),
        connected_by: ALICE.to_string(),
        created_at: now_micros(),
        ..Default::default()
    })
    .await
    .unwrap();
}

async fn link(id: &str, team_user: &str, email: &str, installation_id: &str) {
    store::external_identity_links::put(&ExternalIdentityLink {
        id: id.to_string(),
        provider: "slack".to_string(),
        installation_id: installation_id.to_string(),
        external_team_id: format!("T-{installation_id}"),
        external_user_id: team_user.to_string(),
        user_email: email.to_string(),
        default_org_id: "acme".to_string(),
        created_at: now_micros(),
        ..Default::default()
    })
    .await
    .unwrap();
}

fn token(sub: &str, org: &str, lid: &str) -> String {
    let now = now_micros() / 1_000_000;
    let keys = effective_keys(&master_key(), "", "").unwrap();
    sign(
        &keys,
        &Claims {
            v: TOKEN_VERSION,
            sub: sub.to_string(),
            org: org.to_string(),
            lid: lid.to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
            iat: now,
            exp: now + 3600,
            jti: format!("jti-{lid}-{org}"),
        },
    )
}

fn app() -> Router {
    create_app_router(|_| Router::new())
}

async fn call(method: Method, uri: &str, token: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8_lossy(&body).to_string())
}

async fn status(method: Method, uri: &str, token: &str) -> StatusCode {
    call(method, uri, token).await.0
}

async fn drained_audits() -> Vec<serde_json::Value> {
    auditor::publish_existing_audits("_meta", |request| async move {
        let data = request.data.map(|d| d.data).unwrap_or_default();
        let rows: Vec<serde_json::Value> = serde_json::from_slice(&data).unwrap();
        AUDITS.lock().unwrap().extend(rows);
        Ok(Default::default())
    })
    .await;
    std::mem::take(&mut *AUDITS.lock().unwrap())
}

async fn own_org_passes_and_is_audited() {
    let alice = token(ALICE, "acme", "lnk_alice");
    let (code, body) = call(Method::GET, "/api/acme/streams", &alice).await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let audits = drained_audits().await;
    let record = audits
        .iter()
        .find(|a| a["http_path"] == "acme/streams")
        .unwrap_or_else(|| panic!("no audit record for the delegated call: {audits:#?}"));
    assert_eq!(record["user_email"], ALICE);
    assert_eq!(record["delegated"]["link_id"], "lnk_alice");
    assert_eq!(record["delegated"]["jti"], "jti-lnk_alice-acme");
    let touched = store::external_identity_links::get("lnk_alice")
        .await
        .unwrap()
        .unwrap();
    assert!(touched.last_used_at > 0, "step 7 touches last_used_at");
}

async fn other_orgs_and_routes_are_refused() {
    let alice = token(ALICE, "acme", "lnk_alice");
    for (method, uri) in [
        (Method::GET, "/api/other/streams"),
        (Method::POST, "/api/other/_search"),
        (Method::GET, "/api/v2/other/alerts"),
        (Method::DELETE, "/api/acme/streams/logs"),
        (Method::DELETE, "/api/v2/acme/alerts/a1"),
        (Method::GET, "/api/acme/alerts/destinations"),
        (Method::GET, "/api/acme/users"),
        (Method::GET, "/api/organizations"),
        (Method::POST, "/api/acme/streams/_around"),
        (Method::GET, "/proxy/acme/https://example.com/a.css"),
    ] {
        assert_eq!(
            status(method.clone(), uri, &alice).await,
            StatusCode::FORBIDDEN,
            "{method} {uri}"
        );
    }
    let other = token(ALICE, "other", "lnk_alice");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &other).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status(Method::GET, "/api/other/streams", &other).await,
        StatusCode::OK
    );
    let v2 = status(Method::GET, "/api/v2/acme/alerts", &alice).await;
    assert!(
        v2 != StatusCode::UNAUTHORIZED && v2 != StatusCode::FORBIDDEN,
        "v2 org: {v2}"
    );
}

async fn an_org_named_api_cannot_shift_the_path_org() {
    let kv = token(ALICE, "kv", "lnk_alice");
    assert_eq!(
        status(Method::GET, "/api/kv/streams", &kv).await,
        StatusCode::OK
    );
    assert_eq!(
        status(Method::POST, "/api/api/kv/_search", &kv).await,
        StatusCode::FORBIDDEN,
        "org `api` reached kv::set while the token named org `kv`"
    );
}

async fn link_refusals() {
    let unconnected = token(ALICE, "third", "lnk_alice");
    assert_eq!(
        status(Method::GET, "/api/third/streams", &unconnected).await,
        StatusCode::FORBIDDEN
    );
    let revoked = token(CAROL, "acme", "lnk_revoked");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &revoked).await,
        StatusCode::FORBIDDEN
    );
    let old_install = token(CAROL, "acme", "lnk_old_install");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &old_install).await,
        StatusCode::FORBIDDEN
    );
    let not_the_linked_user = token(BOB, "acme", "lnk_alice");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &not_the_linked_user).await,
        StatusCode::FORBIDDEN
    );
    let unknown = token(ALICE, "acme", "lnk_missing");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &unknown).await,
        StatusCode::FORBIDDEN
    );
}

async fn removed_member_is_refused_at_once() {
    let bob = token(BOB, "acme", "lnk_bob");
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &bob).await,
        StatusCode::OK
    );
    org_users::remove("acme", BOB).await.unwrap();
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &bob).await,
        StatusCode::FORBIDDEN
    );
}

async fn bad_tokens_are_401() {
    let alice = token(ALICE, "acme", "lnk_alice");
    let (head, mac) = alice.rsplit_once('.').unwrap();
    let forged_head = token(ALICE, "other", "lnk_alice");
    let (forged_head, _) = forged_head.rsplit_once('.').unwrap();
    for bad in [
        format!("{forged_head}.{mac}"),
        format!("{head}.{}", &mac[2..]),
        alice.replacen("o2dt.", "o2dx.", 1),
        "o2dt.e30.bWFj".to_string(),
    ] {
        assert_eq!(
            status(Method::GET, "/api/acme/streams", &bad).await,
            StatusCode::UNAUTHORIZED,
            "{bad}"
        );
    }
}

async fn password_owed_is_the_policy_403() {
    let stale = token(STALE, "acme", "lnk_stale");
    let (code, body) = call(Method::GET, "/api/acme/streams", &stale).await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    assert!(
        body.contains("Your password must be updated before you can continue."),
        "{body}"
    );
}

async fn flag_off_is_401() {
    let alice = token(ALICE, "acme", "lnk_alice");
    set_env("O2_SLACK_ENABLED", "false");
    refresh_o2_config().unwrap();
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &alice).await,
        StatusCode::UNAUTHORIZED
    );
    set_env("O2_SLACK_ENABLED", "true");
    refresh_o2_config().unwrap();
    assert_eq!(
        status(Method::GET, "/api/acme/streams", &alice).await,
        StatusCode::OK
    );
}

async fn base_uri_does_not_shift_the_org() {
    let alice = token(ALICE, "acme", "lnk_alice");
    set_env("ZO_BASE_URI", "/o2");
    config::refresh_config().unwrap();
    assert_eq!(
        status(Method::GET, "/o2/api/acme/streams", &alice).await,
        StatusCode::OK
    );
    assert_eq!(
        status(Method::GET, "/o2/api/other/streams", &alice).await,
        StatusCode::FORBIDDEN
    );
    set_env("ZO_BASE_URI", "");
    config::refresh_config().unwrap();
}

#[tokio::test]
async fn phase0_http_proof() {
    boot().await;
    seed().await;
    own_org_passes_and_is_audited().await;
    other_orgs_and_routes_are_refused().await;
    an_org_named_api_cannot_shift_the_path_org().await;
    link_refusals().await;
    removed_member_is_refused_at_once().await;
    bad_tokens_are_401().await;
    password_owed_is_the_policy_403().await;
    base_uri_does_not_shift_the_org().await;
    flag_off_is_401().await;
}

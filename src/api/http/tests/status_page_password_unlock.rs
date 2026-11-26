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

//! Own test binary: config, signing key and SQLite store are process-wide. It drives the by-host
//! unlock flow through the production router.

#![cfg(all(feature = "enterprise", not(feature = "cloud")))]

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use config::meta::organization::OrganizationType;
use infra::table::{
    entity::{status_page_custom_domains as claims, status_pages as pages},
    organizations, status_pages as table,
};
use openobserve_api_http::handler::http::router::create_app_router;
use sea_orm::{ActiveModelTrait, IntoActiveModel};
use tower::ServiceExt;

/// The PHC hash of "open sesame" at argon2's default cost.
const SESAME_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$L9rKncp0tg7B1aX0NS8EXg$TmmEKmF0oLtQ2rKnVMk5qDM1zyPSsf/SkWVA/Zj6kvI";
const SESAME: &str = "open sesame";
const ORG: &str = "unlockorg";
const PAGE_ID: &str = "unlockpage1";
const CLAIM_ID: &str = "unlockclaim1";
const DOMAIN: &str = "status.unlock.example.com";
const PAGE_NAME: &str = "Unlock Test Page";
/// Deterministic signing material, so the unlock cookie resolves without a database lookup.
const SIGNING_KEY: &str = "unlock-test-signing-key-material-0123456789";

/// The data directory this test created itself (`create_dir` fails on an existing path), removed
/// on drop, also when an assertion fails.
struct DataDir(std::path::PathBuf);

impl Drop for DataDir {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            eprintln!("cannot remove {}: {e}", self.0.display());
        }
    }
}

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config, then serially.
    unsafe { std::env::set_var(key, value) };
}

/// The boot the domain-listener test uses: an explicit config file, then SQLite in a temp dir.
async fn boot() -> DataDir {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
    let data_dir = std::env::temp_dir().join(format!(
        "o2-unlock-{}-{}",
        std::process::id(),
        now.unwrap().as_nanos()
    ));
    std::fs::create_dir(&data_dir).unwrap();
    let guard = DataDir(data_dir.clone());
    std::fs::create_dir(data_dir.join("db")).unwrap();
    // An explicit config file stops config loading from finding a developer `.env` up the tree.
    let env_file = data_dir.join("empty.env");
    std::fs::write(&env_file, "").unwrap();
    config::config_path_manager::set_config_file_path(env_file).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("ZO_SYNTHETICS_ENABLED", "true");
    set_env("ZO_STATUS_PAGE_DOMAIN_TLS", "proxy");
    set_env("ZO_ALERT_CHART_SIGNING_KEY", SIGNING_KEY);
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    guard
}

/// A password-protected page with a snapshot, and the claim that holds `DOMAIN`.
async fn seed() {
    organizations::add(ORG, ORG, OrganizationType::Custom)
        .await
        .unwrap();
    pages::Model {
        id: PAGE_ID.to_string(),
        org_id: ORG.to_string(),
        name: PAGE_NAME.to_string(),
        slug: "unlock-test-page".to_string(),
        description: None,
        visibility: 2,
        password_hash: Some(SESAME_HASH.to_string()),
        noindex: true,
        show_uptime_percent: false,
        show_timeline_bars: false,
        show_response_time: false,
        confirm_failures: 1,
        confirm_recovery: 1,
        confirm_after_secs: None,
        brand_name: Some("Acme".to_string()),
        accent_color: None,
        logo_img: None,
        favicon_img: None,
        tracking_since: None,
        owner: None,
        created_at: 1,
        updated_at: 1,
    }
    .into_active_model()
    .insert(infra::db::get_orm_client_rw().await)
    .await
    .unwrap();
    let conn = infra::db::get_orm_client_rw().await;
    table::upsert_snapshot(
        conn,
        PAGE_ID,
        ORG,
        Some(r#"{"days":[]}"#),
        Some(r#"{"overall":"operational","components":[],"notices":[]}"#),
        1,
    )
    .await
    .unwrap();
    claims::Model {
        id: CLAIM_ID.to_string(),
        org_id: ORG.to_string(),
        status_page_id: PAGE_ID.to_string(),
        domain: DOMAIN.to_string(),
        verification_token: "o2v_unlocktest".to_string(),
        verification_state: 1,
        held_domain: Some(DOMAIN.to_string()),
        cname_label: Some("labelunlocktest".to_string()),
        created_at: 1,
        updated_at: 1,
        ..Default::default()
    }
    .into_active_model()
    .insert(conn)
    .await
    .unwrap();
}

fn app() -> Router {
    create_app_router(|_| Router::new())
}

fn by_host(cookie: Option<&str>) -> Request<Body> {
    let builder = Request::builder()
        .uri("/api/status_pages_public_by_host")
        .header(header::HOST, DOMAIN);
    match cookie {
        Some(cookie) => builder.header(header::COOKIE, cookie),
        None => builder,
    }
    .body(Body::empty())
    .unwrap()
}

fn unlock_request(password: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/status_pages_public_by_host/auth")
        .header(header::HOST, DOMAIN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!("{{\"password\":\"{password}\"}}")))
        .unwrap()
}

#[tokio::test]
async fn a_password_page_on_a_custom_domain_unlocks_through_the_by_host_flow() {
    let _data_dir = boot().await;
    seed().await;
    let cfg = config::get_config();
    assert!(cfg.synthetics.enabled, "the by-host route needs synthetics");
    assert_eq!(cfg.status_page_domain.tls, "proxy");

    let locked = app().oneshot(by_host(None)).await.unwrap();
    assert_eq!(
        locked.status(),
        StatusCode::NOT_FOUND,
        "a locked page is the uniform 404"
    );

    let wrong = app().oneshot(unlock_request("open sesamee")).await.unwrap();
    assert_eq!(
        wrong.status(),
        StatusCode::UNAUTHORIZED,
        "a wrong password is refused"
    );
    assert!(!wrong.headers().contains_key(header::SET_COOKIE));

    let unlocked = app().oneshot(unlock_request(SESAME)).await.unwrap();
    assert_eq!(
        unlocked.status(),
        StatusCode::OK,
        "the right password is accepted"
    );
    let set_cookie = unlocked.headers()[header::SET_COOKIE]
        .to_str()
        .expect("a cookie value without control characters")
        .to_string();
    assert!(
        set_cookie.contains(PAGE_ID),
        "the unlock is scoped to the page identity: {set_cookie}"
    );

    let cookie = set_cookie.split(';').next().unwrap().to_string();
    let snapshot = app().oneshot(by_host(Some(&cookie))).await.unwrap();
    assert_eq!(
        snapshot.status(),
        StatusCode::OK,
        "the cookie unlocks the snapshot"
    );
    let body = axum::body::to_bytes(snapshot.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = String::from_utf8(body.to_vec()).unwrap();
    assert!(
        body.contains(PAGE_NAME) && body.contains("operational"),
        "the snapshot is the page's: {body}"
    );
}

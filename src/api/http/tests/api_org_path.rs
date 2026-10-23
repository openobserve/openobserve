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

//! Own test binary: it points the process-wide meta store at a private sqlite file.

// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use config::{
    meta::{
        organization::OrganizationType,
        user::{UserRole, UserType},
    },
    utils::{base64, time::now_micros},
};
use infra::table::{kv_store, org_users, organizations, users, users::UserRecord};
use openobserve_api_http::handler::http::router::{
    other_service_routes, proxy_routes, service_routes,
};
use tower::ServiceExt;

const MEMBER: &str = "member@kv.io";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";

fn set_env(key: &str, value: &str) {
    // SAFETY: this binary runs one test, which sets variables only between its own requests.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-api-org-path-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
}

async fn seed() {
    for org in ["kv", "api", "v2", "aws", "gcp", "acme", "default"] {
        organizations::add(org, org, OrganizationType::Custom)
            .await
            .unwrap();
    }
    users::add(UserRecord {
        email: MEMBER.to_string(),
        first_name: "K".to_string(),
        last_name: "V".to_string(),
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
    org_users::add(
        "kv",
        MEMBER,
        UserRole::Admin,
        "kv-member-ingest-token",
        None,
    )
    .await
    .unwrap();
    org_users::add(
        "acme",
        MEMBER,
        UserRole::Admin,
        "acme-member-ingest-token",
        None,
    )
    .await
    .unwrap();
    org_users::add(
        "default",
        MEMBER,
        UserRole::Admin,
        "default-member-ingest-token",
        None,
    )
    .await
    .unwrap();
}

fn app() -> Router {
    Router::new()
        .nest("/api", service_routes())
        .merge(other_service_routes())
}

fn behind_base_uri() -> Router {
    Router::new().nest(
        "/o2",
        Router::new()
            .nest("/api", service_routes())
            .merge(proxy_routes(true)),
    )
}

fn member_basic() -> String {
    base64::encode(&format!("{MEMBER}:{PASSWORD}"))
}

async fn send(app: Router, request: Request<Body>) -> StatusCode {
    app.oneshot(request).await.unwrap().status()
}

fn kv_set(path: &str) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("Authorization", format!("Basic {}", member_basic()))
        .header("Content-Type", "text/plain")
        .body(Body::from("note-body"))
        .unwrap()
}

async fn written(org: &str, key: &str) -> bool {
    kv_store::get(org, key).await.unwrap().is_some()
}

async fn a_member_writes_their_own_org() -> Option<String> {
    let status = send(app(), kv_set("/api/kv/kv/note")).await;
    (status != StatusCode::OK || !written("kv", "note").await)
        .then(|| format!("a member of org `kv` could not write org `kv` (status {status})"))
}

async fn a_member_reaches_a_v2_route_of_their_org() -> Option<String> {
    let request = Request::builder()
        .method(Method::GET)
        .uri("/api/v2/acme/alerts")
        .header("Authorization", format!("Basic {}", member_basic()))
        .body(Body::empty())
        .unwrap();
    let status = send(app(), request).await;
    (status != StatusCode::OK)
        .then(|| format!("/api/v2/acme/alerts: a member of org `acme` got status {status}"))
}

// The router binds `{org_id}` to "" while auth sees the org-less `/cipher_keys` (org `default`).
async fn a_blank_org_is_not_found() -> Option<String> {
    let request = Request::builder()
        .method(Method::GET)
        .uri("/api//cipher_keys")
        .header("Authorization", format!("Basic {}", member_basic()))
        .body(Body::empty())
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&body);
    // OSS registers no cipher routes, so only an enterprise build reaches the handler's 404.
    (status != StatusCode::NOT_FOUND)
        .then(|| format!("/api//cipher_keys answered {status} instead of 404: {body}"))
}

async fn kv_write_is_refused(app: Router, prefix: &str, org: &str, key: &str) -> Option<String> {
    let status = send(app, kv_set(&format!("{prefix}/api/{org}/kv/{key}"))).await;
    let stored = written(org, key).await;
    (stored || status == StatusCode::OK).then(|| {
        format!("{prefix}/api/{org}/kv/{key}: a non-member write was accepted for org `{org}` ({status})")
    })
}

async fn ingest_is_refused(org: &str, request: Request<Body>) -> Option<String> {
    let status = send(app(), request).await;
    (!matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)).then(|| {
        format!("ingest for org `{org}` by a member of `kv` was not refused (status {status})")
    })
}

fn firehose_request_for_aws() -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri("/aws/aws/kv/_kinesis_firehose")
        .header("X-Amz-Firehose-Access-Key", member_basic())
        .header("Content-Type", "application/json")
        .body(Body::from("{}"))
        .unwrap()
}

fn pubsub_request_for_gcp() -> Request<Body> {
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("API-Key", &member_basic())
        .finish();
    Request::builder()
        .method(Method::POST)
        .uri(format!("/gcp/gcp/kv/_sub?{query}"))
        .header("Content-Type", "application/json")
        .body(Body::from("{}"))
        .unwrap()
}

// The proxy handler ignores the org, so a refusal here comes from the auth layer.
async fn proxy_serves_a_member_behind_base_uri() -> Option<String> {
    let request = Request::builder()
        .method(Method::GET)
        .uri("/o2/proxy/kv/http://127.0.0.1/x")
        .header("Authorization", format!("Basic {}", member_basic()))
        .body(Body::empty())
        .unwrap();
    let status = send(behind_base_uri(), request).await;
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
        .then(|| format!("/o2/proxy: a member of org `kv` was refused (status {status})"))
}

async fn behind_base_uri_cases() -> Vec<Option<String>> {
    set_env("ZO_BASE_URI", "/o2");
    config::refresh_config().unwrap();
    let failures = vec![
        kv_write_is_refused(behind_base_uri(), "/o2", "api", "behind").await,
        proxy_serves_a_member_behind_base_uri().await,
    ];
    set_env("ZO_BASE_URI", "");
    config::refresh_config().unwrap();
    failures
}

#[tokio::test]
async fn the_org_auth_checks_is_the_org_the_route_serves() {
    boot().await;
    seed().await;
    let mut failures = vec![
        a_member_writes_their_own_org().await,
        a_member_reaches_a_v2_route_of_their_org().await,
        a_blank_org_is_not_found().await,
        kv_write_is_refused(app(), "", "api", "note").await,
        kv_write_is_refused(app(), "", "v2", "note").await,
        // The key is a v2 module name, so the path also fits a `/v2/{org_id}/folders` route.
        kv_write_is_refused(app(), "", "v2", "folders").await,
        ingest_is_refused("aws", firehose_request_for_aws()).await,
        ingest_is_refused("gcp", pubsub_request_for_gcp()).await,
    ];
    failures.extend(behind_base_uri_cases().await);
    let failures: Vec<String> = failures.into_iter().flatten().collect();
    assert!(failures.is_empty(), "{failures:#?}");
}

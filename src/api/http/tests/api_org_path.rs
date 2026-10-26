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
        folder::FolderType,
        organization::OrganizationType,
        stream::StreamType,
        user::{UserRole, UserType},
    },
    utils::{base64, time::now_micros},
};
use infra::table::{
    kv_store,
    org_ingestion_tokens::{self, OrgIngestionTokenRecord},
    org_users, organizations, users,
    users::UserRecord,
};
use openobserve_api_http::handler::http::router::{
    other_service_routes, proxy_routes, service_routes,
};
use tower::ServiceExt;

const MEMBER: &str = "member@kv.io";
const OUTSIDER: &str = "member@outsider.io";
const V2_MEMBER: &str = "member@v2.io";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const V2_SECRET: &[u8] = b"v2-only-secret";
const ACME_INGEST_TOKEN: &str = "o2oi_acme_folders_check";

fn set_env(key: &str, value: &str) {
    // SAFETY: this binary runs one test, which sets variables only between its own requests.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-api-org-path-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    // An explicit config file stops config loading from finding a developer `.env` up the tree.
    let env_file = data_dir.join("empty.env");
    std::fs::write(&env_file, "").unwrap();
    config::config_path_manager::set_config_file_path(env_file).unwrap();
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
    // `v2` is seeded below the org-creation checks, as an org that predates its reservation.
    for org in [
        "kv", "api", "v2", "aws", "gcp", "acme", "default", "outsider",
    ] {
        organizations::add(org, org, OrganizationType::Custom)
            .await
            .unwrap();
    }
    add_member(MEMBER, &["kv", "acme", "default"]).await;
    add_member(OUTSIDER, &["outsider"]).await;
    add_member(V2_MEMBER, &["v2"]).await;
    kv_store::set("v2", "secret", V2_SECRET).await.unwrap();
    org_ingestion_tokens::add(&OrgIngestionTokenRecord {
        id: "acme-ingest".to_string(),
        org_id: "acme".to_string(),
        name: "acme-ingest".to_string(),
        token: ACME_INGEST_TOKEN.to_string(),
        description: String::new(),
        is_default: false,
        enabled: true,
        created_by: MEMBER.to_string(),
        created_at: 0,
        updated_at: 0,
        splunk_token: Some(None),
    })
    .await
    .unwrap();
}

async fn add_member(email: &str, orgs: &[&str]) {
    users::add(UserRecord {
        email: email.to_string(),
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
    for org in orgs {
        let token = format!("{org}-{email}-ingest-token");
        org_users::add(org, email, UserRole::Admin, &token, None)
            .await
            .unwrap();
    }
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
    basic(MEMBER)
}

fn basic(email: &str) -> String {
    base64::encode(&format!("{email}:{PASSWORD}"))
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

// The router binds `{org_id}` to "" while auth sees the next segment, `kv`, which the caller is in.
async fn a_blank_org_is_refused() -> Option<String> {
    let status = send(app(), kv_set("/api//kv/blank")).await;
    let stored = written("", "blank").await || written("kv", "blank").await;
    (status != StatusCode::NOT_FOUND || stored)
        .then(|| format!("/api//kv/blank: answered {status} (stored: {stored}) instead of 404"))
}

async fn empty_org_folder_routes_are_not_found() -> Vec<Option<String>> {
    let mut failures = Vec::new();
    for folder_type in ["dashboards", "alerts"] {
        let uri = format!("/api/v2//folders/{folder_type}");
        let request = as_user(
            Method::POST,
            &uri,
            MEMBER,
            r#"{"description":"newfoldernvp","name":"test"}"#,
        );
        let status = send(app(), request).await;
        failures.push(
            (status != StatusCode::NOT_FOUND)
                .then(|| format!("{uri}: answered {status} instead of 404")),
        );
    }
    failures
}

fn refused(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
}

fn as_user(method: Method, uri: &str, email: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Basic {}", basic(email)))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

// The route binds `{org_id}` to `v2`, so naming a caller's own org second must not open org `v2`.
async fn a_v2_read_route_serves_only_v2_members() -> Option<String> {
    let uri = "/api/v2/outsider/traces/latest?start_time=0&end_time=1";
    let status = send(app(), as_user(Method::GET, uri, OUTSIDER, "")).await;
    (!refused(status)).then(|| format!("{uri}: a member of `outsider` got {status}"))
}

async fn a_v2_ingest_route_serves_only_v2_members() -> Option<String> {
    let request = as_user(
        Method::POST,
        "/api/v2/outsider/_json",
        OUTSIDER,
        r#"[{"msg":"x"}]"#,
    );
    let status = send(app(), request).await;
    let schema = infra::schema::get("v2", "outsider", StreamType::Logs).await;
    let stored = schema
        .as_ref()
        .map_or(true, |schema| !schema.fields().is_empty());
    (!refused(status) || stored).then(|| {
        format!(
            "/api/v2/outsider/_json: a member of `outsider` got {status} (v2 schema: {schema:?})"
        )
    })
}

async fn a_v2_member_is_refused_a_v2_module_route_of_another_org() -> Vec<Option<String>> {
    let read = send(
        app(),
        as_user(Method::GET, "/api/v2/acme/alerts", V2_MEMBER, ""),
    )
    .await;
    let create = as_user(
        Method::POST,
        "/api/v2/acme/folders/alerts",
        V2_MEMBER,
        r#"{"name":"from-v2","description":""}"#,
    );
    let write = send(app(), create).await;
    let folders = infra::table::folders::list_folders("acme", FolderType::Alerts)
        .await
        .unwrap();
    let stored = folders.iter().any(|folder| folder.name == "from-v2");
    vec![
        (!refused(read)).then(|| format!("/api/v2/acme/alerts: a member of `v2` only got {read}")),
        (!refused(write) || stored).then(|| {
            format!(
                "/api/v2/acme/folders/alerts: a member of `v2` only got {write} (stored: {stored})"
            )
        }),
    ]
}

// No ingestion route lives under `/v2`, so an org ingestion token is no credential there.
async fn an_ingestion_token_cannot_reach_a_v2_module_route() -> Option<String> {
    let credentials = base64::encode(&format!("collector@acme.io:{ACME_INGEST_TOKEN}"));
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v2/acme/folders/_json")
        .header("Authorization", format!("Basic {credentials}"))
        .header("Content-Type", "application/json")
        .body(Body::from(r#"[{"msg":"x"}]"#))
        .unwrap();
    let status = send(app(), request).await;
    (!refused(status))
        .then(|| format!("/api/v2/acme/folders/_json: an `acme` ingestion token got {status}"))
}

async fn a_member_cannot_read_org_v2() -> Option<String> {
    let response = app()
        .oneshot(as_user(Method::GET, "/api/v2/kv/secret", MEMBER, ""))
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let leaked = body
        .windows(V2_SECRET.len())
        .any(|window| window == V2_SECRET);
    (!refused(status) || leaked)
        .then(|| format!("/api/v2/kv/secret: a member of `kv` got {status} (leaked: {leaked})"))
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
        a_blank_org_is_refused().await,
        a_v2_read_route_serves_only_v2_members().await,
        a_v2_ingest_route_serves_only_v2_members().await,
        a_member_cannot_read_org_v2().await,
        an_ingestion_token_cannot_reach_a_v2_module_route().await,
        kv_write_is_refused(app(), "", "api", "note").await,
        kv_write_is_refused(app(), "", "v2", "note").await,
        // The key is a v2 module name, so the path also fits a `/v2/{org_id}/folders` route.
        kv_write_is_refused(app(), "", "v2", "folders").await,
        ingest_is_refused("aws", firehose_request_for_aws()).await,
        ingest_is_refused("gcp", pubsub_request_for_gcp()).await,
    ];
    failures.extend(a_v2_member_is_refused_a_v2_module_route_of_another_org().await);
    failures.extend(empty_org_folder_routes_are_not_found().await);
    failures.extend(behind_base_uri_cases().await);
    let failures: Vec<String> = failures.into_iter().flatten().collect();
    assert!(failures.is_empty(), "{failures:#?}");
}

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

#![cfg(feature = "enterprise")]

use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use axum::{
    Router,
    http::HeaderValue,
    routing::{get, post},
};
use config::{
    META_ORG_ID,
    axum::middlewares::{extract_real_ip, resolve_client_ip_sources},
    meta::{
        system_settings::{SystemSetting, keys},
        user::DBUser,
    },
};
use o2_enterprise::enterprise::password_policy::meta::{LockoutPolicy, PasswordPolicy};
use openobserve_api_management::request::{status, users};
use openobserve_core::auth::get_hash;
use proto::cluster_rpc::{IngestionRequest, IngestionResponse};
use reqwest::{Client, RequestBuilder, StatusCode, redirect::Policy};
use serde_json::{Value, json};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};

const EMAIL: &str = "audit-login@example.com";
const PASSWORD: &str = "Valid-login-password#123";

static PUBLISHED: Mutex<Vec<Value>> = Mutex::const_new(Vec::new());

struct Capture;

#[async_trait]
impl audit::AuditPublisher for Capture {
    async fn publish(&self, request: IngestionRequest) -> Result<IngestionResponse, anyhow::Error> {
        let rows: Vec<Value> = serde_json::from_slice(&request.data.expect("audit rows").data)?;
        PUBLISHED.lock().await.extend(rows);
        Ok(IngestionResponse::default())
    }
}

struct LoginServer {
    url: String,
    client: Client,
    task: JoinHandle<()>,
}

impl LoginServer {
    async fn start(ip_source: Option<&str>) -> Self {
        let mut app = Router::new()
            .route(
                "/auth/login",
                post(users::authentication).get(users::get_auth),
            )
            .route("/config/redirect", get(status::redirect));
        if let Some(source) = ip_source {
            app = app
                .layer(axum::middleware::from_fn(extract_real_ip))
                .layer(axum::Extension(resolve_client_ip_sources(source)));
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        Self {
            url: format!("http://{address}"),
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            task,
        }
    }

    fn login(&self, email: &str, password: &str) -> RequestBuilder {
        self.client
            .post(format!("{}/auth/login", self.url))
            .header("User-Agent", "LoginAudit/1.0")
            .json(&json!({"name": email, "password": password}))
    }
}

impl Drop for LoginServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = Self(
            PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
                .join(format!("o2-login-audit-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir_all(directory.0.join("db")).unwrap();
        directory
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            eprintln!(
                "Failed to remove login audit test directory {}: {error}",
                self.0.display()
            );
        }
    }
}

async fn audit_of(request: RequestBuilder, expected_status: StatusCode) -> Value {
    PUBLISHED.lock().await.clear();
    let response = request.send().await.unwrap();
    assert_eq!(response.status(), expected_status);
    if expected_status == StatusCode::TOO_MANY_REQUESTS {
        assert!(response.headers().contains_key("retry-after"));
    }
    audit::flush().await;
    let rows = std::mem::take(&mut *PUBLISHED.lock().await);
    assert_eq!(rows.len(), 1, "one audit event per login attempt: {rows:?}");
    let row = rows.into_iter().next().unwrap();
    assert_eq!(row["http_response_code"], expected_status.as_u16());
    row
}

async fn initialize(directory: &Path) {
    // The integration binary owns its config and sets these before the server starts.
    unsafe {
        std::env::set_var("ZO_DATA_DIR", format!("{}/", directory.display()));
        std::env::set_var("ZO_DATA_DB_DIR", format!("{}/db/", directory.display()));
        std::env::set_var("ZO_META_STORE", "sqlite");
        std::env::set_var("ZO_LOCAL_MODE", "true");
        std::env::set_var("O2_AUDIT_ENABLED", "true");
        std::env::set_var("O2_DEX_NATIVE_LOGIN_ENABLED", "true");
        std::env::set_var("O2_DEX_ROOT_ONLY_LOGIN", "false");
    }
    assert!(audit::set_audit_publisher(Arc::new(Capture)).is_ok());
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::create_user_tables().await.unwrap();
    let salt = "login-audit-test-salt";
    let user = DBUser {
        email: EMAIL.to_string(),
        first_name: "Audit".to_string(),
        last_name: "Login".to_string(),
        password: get_hash(PASSWORD, salt),
        salt: salt.to_string(),
        organizations: Vec::new(),
        is_external: false,
        password_ext: Some("existing-derived-hash".to_string()),
    };
    let record = infra::table::users::UserRecord::from(&user);
    infra::table::users::add(record).await.unwrap();
    let policy = PasswordPolicy {
        lockout: LockoutPolicy {
            threshold: 2,
            ..Default::default()
        },
        ..Default::default()
    };
    db::system_settings::set_only_cached(&SystemSetting::new_org(
        META_ORG_ID,
        keys::PASSWORD_POLICY,
        serde_json::to_value(policy).unwrap(),
    ))
    .await;
}

#[tokio::test]
async fn login_attempts_retain_request_metadata_and_do_not_panic_on_headers() {
    let directory = TestDirectory::new();
    initialize(&directory.0).await;
    let server = LoginServer::start(Some("ConnectInfo")).await;
    for agent in [
        HeaderValue::from_str(&"a".repeat(1025)).unwrap(),
        HeaderValue::from_bytes(b"invalid\xff").unwrap(),
    ] {
        let row = audit_of(
            server
                .client
                .post(format!("{}/auth/login", server.url))
                .header("User-Agent", agent)
                .json(&json!({"name": EMAIL, "password": PASSWORD})),
            StatusCode::OK,
        )
        .await;
        assert_eq!(row["login_ip"], "127.0.0.1");
        assert!(row.get("user_agent").is_none());
    }
    for (email, password, status) in [
        (EMAIL, PASSWORD, StatusCode::OK),
        (
            "unknown-audit-user@example.com",
            PASSWORD,
            StatusCode::UNAUTHORIZED,
        ),
        (EMAIL, "Wrong-password#123", StatusCode::UNAUTHORIZED),
        (EMAIL, "Wrong-password#123", StatusCode::TOO_MANY_REQUESTS),
        (EMAIL, PASSWORD, StatusCode::TOO_MANY_REQUESTS),
    ] {
        let row = audit_of(server.login(email, password), status).await;
        assert_eq!(row["login_ip"], "127.0.0.1");
        assert_eq!(row["user_agent"], "LoginAudit/1.0");
        assert_eq!(row["user_email"], email);
    }
    let bad_authorization = HeaderValue::from_bytes(b"Basic \xff").unwrap();
    let row = audit_of(
        server
            .client
            .post(format!("{}/auth/login", server.url))
            .header("Authorization", bad_authorization)
            .header("User-Agent", "LoginAudit/invalid-authorization"),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    assert_eq!(row["login_ip"], "127.0.0.1");
    assert_eq!(row["user_agent"], "LoginAudit/invalid-authorization");

    let proxied = LoginServer::start(Some("XRealIp")).await;
    let row = audit_of(
        proxied
            .client
            .get(format!("{}/auth/login", proxied.url))
            .header("X-Real-IP", "not-an-ip"),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    assert_eq!(row["login_ip"], "127.0.0.1");
    let boundary = "a".repeat(1024);
    let oversized = "a".repeat(1025);
    for (user_agent, expected) in [
        (None, None),
        (
            Some(HeaderValue::from_static("LoginAudit/2.0")),
            Some("LoginAudit/2.0"),
        ),
        (
            Some(HeaderValue::from_str(&boundary).unwrap()),
            Some(boundary.as_str()),
        ),
        (Some(HeaderValue::from_str(&oversized).unwrap()), None),
        (Some(HeaderValue::from_bytes(b"invalid\xff").unwrap()), None),
        (Some(HeaderValue::from_static("invalid\tagent")), None),
    ] {
        let mut request = proxied
            .client
            .get(format!("{}/auth/login", proxied.url))
            .header("X-Real-IP", "2001:db8::42");
        if let Some(agent) = user_agent {
            request = request.header("User-Agent", agent);
        }
        let row = audit_of(request, StatusCode::UNAUTHORIZED).await;
        assert_eq!(row["login_ip"], "2001:db8::42");
        assert_eq!(row.get("user_agent").and_then(Value::as_str), expected);
    }
    let row = audit_of(
        proxied
            .client
            .get(format!(
                "{}/config/redirect?code=test-code&state=unbound",
                proxied.url
            ))
            .header("X-Real-IP", "198.51.100.10")
            .header("User-Agent", "LoginAudit/sso"),
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert_eq!(row["login_ip"], "198.51.100.10");
    assert_eq!(row["user_agent"], "LoginAudit/sso");

    let no_ip = LoginServer::start(None).await;
    let row = audit_of(
        no_ip.client.get(format!("{}/auth/login", no_ip.url)),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    assert!(row.get("login_ip").is_none());
    assert!(row.get("user_agent").is_none());
    drop((server, proxied, no_ip));
}

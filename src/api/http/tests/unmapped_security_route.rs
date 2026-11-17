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

//! Own test binary: it turns OpenFGA on and points the meta store at a private sqlite file.

#![cfg(feature = "enterprise")]
// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
    middleware,
    routing::get,
};
use config::{
    meta::{
        organization::OrganizationType,
        user::{UserRole, UserType},
    },
    utils::{base64, time::now_micros},
};
use infra::table::{org_users, organizations, users, users::UserRecord};
use openobserve_api_http::handler::http::router::auth_middleware;
use tower::ServiceExt;

const ORG: &str = "soc";
const MEMBER: &str = "analyst@soc.io";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const UNMAPPED: &str = "/api/soc/security/zzz";

fn set_env(key: &str, value: &str) {
    // SAFETY: this binary runs one test, which sets variables before any request.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir =
        std::env::temp_dir().join(format!("o2-unmapped-security-{}", std::process::id()));
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
    // Nothing listens here, so any OpenFGA call for the unmapped route would fail the request.
    set_env("O2_OPENFGA_ENABLED", "true");
    set_env("O2_OPENFGA_BASE_URL", "http://127.0.0.1:1/stores");
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
}

async fn seed() {
    organizations::add(ORG, ORG, OrganizationType::Custom)
        .await
        .unwrap();
    users::add(UserRecord {
        email: MEMBER.to_string(),
        first_name: "S".to_string(),
        last_name: "A".to_string(),
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
    org_users::add(ORG, MEMBER, UserRole::Editor, "soc-member-token", None)
        .await
        .unwrap();
}

// A registered route with no permission row: an unmatched path never reaches the auth layer.
fn app() -> Router {
    let routes = Router::new()
        .route("/{org_id}/security/zzz", get(|| async { "served" }))
        .layer(middleware::from_fn(auth_middleware));
    Router::new().nest("/api", routes)
}

fn request(credential: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method(Method::GET).uri(UNMAPPED);
    if let Some(credential) = credential {
        builder = builder.header(
            "Authorization",
            format!("Basic {}", base64::encode(credential)),
        );
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn an_unmapped_security_route_refuses_a_member_and_challenges_an_anonymous_caller() {
    boot().await;
    seed().await;
    assert!(openobserve_core::authz::rbac_enforced().await);

    let member = format!("{MEMBER}:{PASSWORD}");
    let signed_in = app().oneshot(request(Some(&member))).await.unwrap();
    let status = signed_in.status();
    let body = axum::body::to_bytes(signed_in.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "{}",
        String::from_utf8_lossy(&body)
    );

    let anonymous = app().oneshot(request(None)).await.unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
}

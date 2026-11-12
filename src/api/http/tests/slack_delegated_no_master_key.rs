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

//! Own test binary: the master key is process-wide and installed once, here as "none".

#![cfg(feature = "enterprise")]

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::utils::{
    delegation::{Claims, SCOPE_ASSISTANT, TOKEN_VERSION, effective_keys, sign},
    time::now_micros,
};
use openobserve_api_http::handler::http::router::create_app_router;
use tower::ServiceExt;

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before any config is read.
    unsafe { std::env::set_var(key, value) };
}

#[tokio::test]
async fn an_empty_master_key_refuses_tokens_even_with_the_override_set() {
    let data_dir = std::env::temp_dir().join(format!("o2-slack-no-key-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    let override_key = BASE64_STANDARD.encode([5u8; 32]);
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("O2_SLACK_ENABLED", "true");
    set_env("O2_MASTER_ENCRYPTION_KEY", "");
    set_env("ZO_DELEGATION_SIGNING_KEY", &override_key);
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    infra::table::cipher::boot(Some("")).await.unwrap();
    assert!(!infra::table::cipher::is_encrypting());

    let now = now_micros() / 1_000_000;
    let token = sign(
        &effective_keys("", &override_key, "").unwrap(),
        &Claims {
            v: TOKEN_VERSION,
            sub: "alice@acme.io".to_string(),
            org: "acme".to_string(),
            lid: "lnk_alice".to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
            iat: now,
            exp: now + 3600,
            jti: "jti-1".to_string(),
        },
    );
    let request = Request::builder()
        .uri("/api/acme/streams")
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = create_app_router(|_| Router::new())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

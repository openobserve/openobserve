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

//! Own test binary: no master key, only `O2_ONCALL_MASTER_KEY`, installed once process-wide.

#![cfg(feature = "enterprise")]

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    meta::{
        organization::OrganizationType,
        slack::{ExternalIdentityLink, SlackInstallation, SlackOrgConnection},
        user::{UserRole, UserType},
    },
    utils::{
        delegation::{Claims, SCOPE_ASSISTANT, TOKEN_VERSION, effective_keys, sign},
        time::now_micros,
    },
};
use infra::table::{cipher, org_telephony, org_users, organizations, users, users::UserRecord};
use o2_enterprise::enterprise::slack::{self, store};
use openobserve_api_http::handler::http::router::create_app_router;
use tower::ServiceExt;

const ALICE: &str = "alice@acme.io";

fn oncall_key() -> String {
    BASE64_STANDARD.encode([4u8; 64])
}

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before any config is read.
    unsafe { std::env::set_var(key, value) };
}

async fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-slack-oncall-key-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("O2_SLACK_ENABLED", "true");
    set_env("O2_MASTER_ENCRYPTION_KEY", "");
    set_env("O2_ONCALL_MASTER_KEY", &oncall_key());
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    cipher::boot(Some("")).await.unwrap();
    cipher::install_oncall_key(true).unwrap();
}

async fn seed() {
    organizations::add("acme", "acme", OrganizationType::Custom)
        .await
        .unwrap();
    let _ = users::add(UserRecord {
        email: ALICE.to_string(),
        first_name: "T".to_string(),
        last_name: "U".to_string(),
        password: "hash".to_string(),
        salt: "salt".to_string(),
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
    .await;
    org_users::add("acme", ALICE, UserRole::Admin, "tok-alice", None)
        .await
        .unwrap();
    store::slack_installations::put(&SlackInstallation {
        id: "I1".to_string(),
        app_id: "A0APP".to_string(),
        team_id: "T-I1".to_string(),
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
    store::slack_org_connections::put(&SlackOrgConnection {
        installation_id: "I1".to_string(),
        org_id: "acme".to_string(),
        connected_by: ALICE.to_string(),
        created_at: now_micros(),
        ..Default::default()
    })
    .await
    .unwrap();
    store::external_identity_links::put(&ExternalIdentityLink {
        id: "lnk_alice".to_string(),
        provider: "slack".to_string(),
        installation_id: "I1".to_string(),
        external_team_id: "T-I1".to_string(),
        external_user_id: "U1".to_string(),
        user_email: ALICE.to_string(),
        default_org_id: "acme".to_string(),
        created_at: now_micros(),
        ..Default::default()
    })
    .await
    .unwrap();
}

fn token(signing_key: &str) -> String {
    let now = now_micros() / 1_000_000;
    sign(
        &effective_keys(signing_key, "", "").unwrap(),
        &Claims {
            v: TOKEN_VERSION,
            sub: ALICE.to_string(),
            org: "acme".to_string(),
            lid: "lnk_alice".to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
            iat: now,
            exp: now + 3600,
            jti: "jti-1".to_string(),
        },
    )
}

async fn call(token: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .uri("/api/acme/streams")
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = create_app_router(|_| Router::new())
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8_lossy(&body).to_string())
}

#[tokio::test]
async fn the_oncall_key_runs_telephony_and_slack_without_a_master_key() {
    boot().await;
    assert!(!cipher::is_encrypting(), "no master key is installed");
    assert!(cipher::oncall_secrets_on());
    assert!(slack::enabled_for("acme"));

    org_telephony::put(
        "acme",
        &org_telephony::StoredAccount {
            provider: "twilio".to_string(),
            account_sid: "AC1".to_string(),
            auth_token: "tw-secret".to_string(),
            from_number: "+14155550100".to_string(),
        },
        1,
    )
    .await
    .unwrap();
    let stored = org_telephony::get("acme").await.unwrap().unwrap();
    assert_eq!(stored.auth_token, "tw-secret");

    seed().await;
    let install = store::slack_installations::get("I1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(install.bot_token.as_deref(), Some("xoxb-bot"));
    assert!(install.credentials_readable);

    let (code, body) = call(&token(&oncall_key())).await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let other_key = BASE64_STANDARD.encode([5u8; 64]);
    assert_eq!(call(&token(&other_key)).await.0, StatusCode::UNAUTHORIZED);

    assert!(slack::inbound::runs_here());
    assert!(
        slack::token::configured_keys().unwrap() == effective_keys(&oncall_key(), "", "").unwrap(),
        "minted tokens are signed with the on-call key"
    );
    assert_eq!(
        slack::state::state_key().unwrap(),
        slack::state::derive_self_hosted_key(&[4u8; 64]).unwrap()
    );
    let api = slack::client::ReqwestSlackApi::new("http://127.0.0.1:9", "").unwrap();
    let caller = slack::authz::Caller::new("acme", ALICE, false);
    let ctx = slack::install::live_ctx(&slack::repo::LiveRepo, &api, &caller, b"k")
        .await
        .unwrap();
    assert!(ctx.encrypting, "installs may store tokens");
}

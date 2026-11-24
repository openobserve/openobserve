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

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, header},
    response::Response,
};
use base64::{Engine, prelude::BASE64_STANDARD};
use common::infra::config::{ORG_USERS, USERS};
use config::{
    meta::{
        correlation::ServiceIdentityConfig,
        organization::OrganizationType,
        system_settings::SystemSetting,
        user::{UserRole, UserType},
    },
    metrics::authz::AUTHZ_OPENFGA_CALLS_PER_REQUEST,
    utils::time::now_micros,
};
use infra::table::{org_users::OrgUserRecord, organizations, service_streams, users::UserRecord};
use openobserve_core::authz::{
    fake_checker,
    list::{ListMode, UnavailableReason},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use super::{create_app_router, one_ack_tests::meta_store};

const ROUTE: &str = "/api/{org_id}/service_streams";
const PASSWORD: &str = "Complexpass#123";
const SALT: &str = "0123456789abcdef";
const OPENFGA_CHILD: &str = "O2_TEST_SERVICE_STREAMS_AUTHZ_CHILD";

#[tokio::test]
async fn list_services_accounts_for_auth_rejections_and_answers_503_on_authz_probe_failure() {
    let org = format!("list-authz-{}", now_micros());
    let user = seed_service_streams(&org, UserRole::Root).await;
    let app = create_app_router(|_| Router::new());
    let metric = AUTHZ_OPENFGA_CALLS_PER_REQUEST.with_label_values(&[ROUTE]);
    let count = metric.get_sample_count();
    let sum = metric.get_sample_sum();
    let rejected = app
        .clone()
        .oneshot(
            Request::get(service_streams_uri(&org, ""))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(metric.get_sample_count() - count, 1);
    assert_eq!(metric.get_sample_sum() - sum, 0.0);

    let checker = fake_checker();
    checker.set_list_mode(&user, ListMode::On);
    checker.fail_types_access_once(&user, UnavailableReason::Timeout);

    let response = app
        .oneshot(service_streams_request(
            &org,
            &user,
            Method::GET,
            "",
            Body::empty(),
        ))
        .await
        .unwrap();

    assert_authz_unavailable(response).await;
    assert_eq!(checker.calls(&user).probe_c, 1);
    assert_eq!(metric.get_sample_sum() - sum, 1.0);
}

#[tokio::test]
async fn correlate_streams_answers_503_when_the_authz_list_fails() {
    let org = format!("correlate-authz-{}", now_micros());
    let user = seed_service_streams(&org, UserRole::Root).await;
    let identity = ServiceIdentityConfig {
        tracked_alias_ids: vec!["service".to_string()],
        ..ServiceIdentityConfig::new_default()
    };
    let setting = SystemSetting::new_org(
        org.as_str(),
        "service_identity",
        serde_json::to_value(identity).unwrap(),
    );
    db::system_settings::set_service_identity_config(&setting)
        .await
        .unwrap();
    let checker = fake_checker();
    checker.set_list_mode(&user, ListMode::On);
    checker.fail_list_once(&user, UnavailableReason::Server(502));
    let body = Body::from(
        json!({
            "source_stream": "checkout_logs",
            "source_type": "logs",
            "available_dimensions": { "service_name": "checkout" },
        })
        .to_string(),
    );

    let response = create_app_router(|_| Router::new())
        .oneshot(service_streams_request(
            &org,
            &user,
            Method::POST,
            "/_correlate",
            body,
        ))
        .await
        .unwrap();

    assert_authz_unavailable(response).await;
    assert_eq!(checker.calls(&user).lists, 1);
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn list_services_counts_the_route_check_with_handler_calls() {
    use o2_openfga::{
        authorizer::test_support::{Reply, mock_openfga},
        config::{OFGA, OFGA_STORE_ID},
    };

    // The fake checker, OpenFGA config and route histogram are process-wide.
    if std::env::var_os(OPENFGA_CHILD).is_none() {
        run_openfga_child();
        return;
    }

    let org = format!("list-authz-member-{}", now_micros());
    let user = seed_service_streams(&org, UserRole::User).await;
    let mock = mock_openfga(|path, _| {
        if path.ends_with("/check") {
            Reply::allowed(true)
        } else {
            Reply::error(400, "validation_error")
        }
    })
    .await;
    OFGA.set(mock.conf.clone()).unwrap();
    OFGA_STORE_ID.insert("store_id".to_string(), "service-streams-test".to_string());

    let app = create_app_router(|_| Router::new());
    let metric = AUTHZ_OPENFGA_CALLS_PER_REQUEST.with_label_values(&[ROUTE]);
    let count = metric.get_sample_count();
    let sum = metric.get_sample_sum();
    let response = app
        .oneshot(service_streams_request(
            &org,
            &user,
            Method::GET,
            "",
            Body::empty(),
        ))
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let body = to_bytes(body, usize::MAX).await.unwrap();
    assert_eq!(
        parts.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&body)
    );
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body[0]["logs_streams"], json!(["checkout_logs"]));

    let checks = mock.bodies("/check");
    let (route_check, handler_checks) = checks.split_first().expect("missing route Check");
    assert_eq!(
        route_check["tuple_key"],
        json!({
            "user": format!("user:{user}"),
            "relation": "LIST",
            "object": format!("service_streams:_all_{org}"),
        })
    );
    let probe_object = format!("stream:_all_{org}");
    assert!(
        handler_checks
            .iter()
            .any(|check| check["tuple_key"]["object"] == probe_object),
        "missing handler stream probe: {handler_checks:?}"
    );
    assert_eq!(metric.get_sample_count() - count, 1);
    assert_eq!(metric.get_sample_sum() - sum, mock.requests().len() as f64);
}

#[cfg(feature = "enterprise")]
fn run_openfga_child() {
    let dir = std::env::temp_dir().join(format!(
        "o2-service-streams-authz-{}-{}",
        std::process::id(),
        now_micros()
    ));
    std::fs::create_dir(&dir).unwrap();
    // A developer's .env would override the child's SQLite and routing settings.
    std::fs::write(dir.join(".env"), "").unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "handler::http::router::authz_calls_tests::list_services_counts_the_route_check_with_handler_calls",
        ])
        .current_dir(&dir)
        .env(OPENFGA_CHILD, "1")
        .env("ZO_LOCAL_MODE", "true")
        .env("ZO_META_STORE", "sqlite")
        .env("ZO_NODE_ROLE", "all")
        .env("ZO_BASE_URI", "")
        .env("ZO_DATA_DIR", &dir)
        .env("ZO_DATA_DB_DIR", dir.join("db"))
        .env("O2_DEX_NATIVE_LOGIN_ENABLED", "true")
        .env("O2_DEX_ROOT_ONLY_LOGIN", "false")
        .env("O2_OPENFGA_ENABLED", "true")
        .env("O2_OPENFGA_AUTH_METHOD", "")
        .env("O2_OPENFGA_LIST_AUTHZ_MODE", "on")
        .env("O2_CLOUD_OPENFGA_CHECK_DISABLED", "false")
        .output();
    std::fs::remove_dir_all(&dir).unwrap();
    let output = output.unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn seed_service_streams(org: &str, role: UserRole) -> String {
    meta_store().await;
    organizations::add(org, org, OrganizationType::Custom)
        .await
        .unwrap();
    let mut record = service_streams::ServiceRecord::new(org, "checkout", "default", json!({}));
    record.logs_streams = json!(["checkout_logs"]);
    record.last_seen = now_micros();
    let _ = service_streams::put(org, record, 10).await.unwrap();

    // The root fixture bypasses the endpoint Check while the fake still enforces stream access.
    let is_root = role == UserRole::Root;
    let membership_org = if is_root { config::DEFAULT_ORG } else { org };
    let user = format!("{role}@{org}.test");
    USERS.insert(
        user.clone(),
        UserRecord {
            email: user.clone(),
            first_name: String::new(),
            last_name: String::new(),
            password: openobserve_core::auth::get_hash(PASSWORD, SALT),
            salt: SALT.to_string(),
            is_root,
            password_ext: None,
            user_type: UserType::Internal,
            created_at: 0,
            updated_at: 0,
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: Some(now_micros()),
        },
    );
    ORG_USERS.insert(
        format!("{membership_org}/{user}"),
        OrgUserRecord {
            email: user.clone(),
            org_id: membership_org.to_string(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: true,
        },
    );
    user
}

fn service_streams_request(
    org: &str,
    user: &str,
    method: Method,
    suffix: &str,
    body: Body,
) -> Request<Body> {
    let credentials = BASE64_STANDARD.encode(format!("{user}:{PASSWORD}"));
    Request::builder()
        .method(method)
        .uri(service_streams_uri(org, suffix))
        .header(header::AUTHORIZATION, format!("Basic {credentials}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .unwrap()
}

fn service_streams_uri(org: &str, suffix: &str) -> String {
    let cfg = config::get_config();
    let base = cfg.common.base_uri.trim_end_matches('/');
    format!("{base}/api/{org}/service_streams{suffix}")
}

async fn assert_authz_unavailable(response: Response) {
    let (parts, body) = response.into_parts();
    let body = to_bytes(body, usize::MAX).await.unwrap();
    assert_eq!(
        parts.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{}",
        String::from_utf8_lossy(&body)
    );
    assert_eq!(parts.headers[header::RETRY_AFTER], "3");
    assert_eq!(parts.headers["x-o2-authz"], "unavailable");
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["error_code"], "authz_unavailable");
}

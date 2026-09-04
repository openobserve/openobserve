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

//! The axum layer that applies the instance password policy.
//!
//! The decision itself is `o2_enterprise::enterprise::password_policy::enforcement`; this is the
//! glue that finds the user, reads the live policy, and turns a refusal into a response. Without
//! the enterprise feature there is no policy to apply and the layer passes everything through,
//! so the routers can install it unconditionally.

use axum::{extract::Request, middleware::Next, response::Response};
#[cfg(feature = "enterprise")]
use {
    axum::{
        body::Body,
        http::{Method, StatusCode, Uri, header},
    },
    chrono::Utc,
    common::infra::config::USERS,
    o2_enterprise::enterprise::password_policy::enforcement::{
        PolicyDecision, RESET_REQUIRED_CODE, decide,
    },
};

/// The header `auth_middleware` writes the authenticated email into. Reading it here rather than
/// re-validating is what keeps this a layer of its own; `audit_middleware` consumes the same one.
#[cfg(feature = "enterprise")]
const USER_ID_HEADER: &str = "user_id";

/// Refuse a request whose user owes the instance a new password.
///
/// Must be layered *inside* `auth_middleware`: the email comes from the header that authentication
/// writes, and a request that never authenticated has no user to hold to a policy. A request
/// arriving without that header is passed straight through — this layer authenticates nobody and
/// must not appear to.
pub async fn password_policy_middleware(request: Request, next: Next) -> Response {
    #[cfg(feature = "enterprise")]
    if let Some(user_email) = request
        .headers()
        .get(USER_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        && let Some(blocked) = check_request(&user_email, request.uri(), request.method()).await
    {
        return blocked;
    }

    next.run(request).await
}

/// Look the user up and apply the policy, returning the refusal when there is one.
#[cfg(feature = "enterprise")]
async fn check_request(user_email: &str, uri: &Uri, method: &Method) -> Option<Response> {
    // Served from the cluster-consistent users cache, so this costs no database round trip on the
    // authenticated hot path.
    // Authentication succeeding against something this cache does not hold — a token or an
    // enterprise identity — means there is nothing here that applies to it.
    let user = USERS.get(&user_email.to_lowercase())?;

    // Root's exemption is settled inside `decide`, which is the only place that holds both the user
    // and the policy. An early return here could only guess at the policy it has not read yet.
    let policy = db::password_policy::get_effective_policy().await;
    match decide(&user, uri, method, &policy, Utc::now()) {
        PolicyDecision::Allow => None,
        PolicyDecision::Block { reason } => Some(blocked_response(&reason)),
    }
}

#[cfg(feature = "enterprise")]
fn blocked_response(reason: &str) -> Response {
    let body = serde_json::json!({
        "code": RESET_REQUIRED_CODE,
        "reason": reason,
        "message": "Your password must be updated before you can continue.",
    });

    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| StatusCode::FORBIDDEN.into_response_fallback())
}

/// Infallible fallback so a malformed header can never turn a policy block into a panic.
#[cfg(feature = "enterprise")]
trait InfallibleResponse {
    fn into_response_fallback(self) -> Response;
}

#[cfg(feature = "enterprise")]
impl InfallibleResponse for StatusCode {
    fn into_response_fallback(self) -> Response {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = self;
        response
    }
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::StatusCode, routing::get};
    use tower::ServiceExt;

    use super::*;

    /// Layered outside the gate, so the gate sees exactly what `auth_middleware` leaves behind.
    #[cfg(feature = "enterprise")]
    async fn stub_auth(email: &'static str, mut request: Request, next: Next) -> Response {
        request
            .headers_mut()
            .insert(USER_ID_HEADER, email.parse().unwrap());
        next.run(request).await
    }

    /// An unauthenticated request must come out the other side untouched: this layer decides
    /// nothing about identity, and a 401 here would hide whatever the route itself answers.
    #[tokio::test]
    async fn a_request_carrying_no_authenticated_email_passes_through() {
        let app = Router::new()
            .route("/default/streams", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(password_policy_middleware));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/default/streams")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    /// Authentication succeeded against an identity the users cache does not hold — a token, or an
    /// enterprise login. There is no local password to have a policy about.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_user_the_cache_does_not_hold_passes_through() {
        let app = Router::new()
            .route("/default/streams", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(password_policy_middleware))
            .layer(axum::middleware::from_fn(|request, next| async move {
                stub_auth("nobody@b.com", request, next).await
            }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/default/streams")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    /// `decide` blocking an expired password is unit-tested in the enterprise crate, but not the
    /// step that reads the live policy and turns that into a response: dropping it would leave
    /// those tests green. This one runs a real request through the layer.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_expired_password_is_refused_through_the_layer() {
        use chrono::TimeDelta;
        use common::infra::config::SYSTEM_SETTINGS;
        use config::{
            META_ORG_ID,
            meta::{
                password_policy::PasswordPolicy,
                system_settings::{SystemSetting, keys},
                user::UserType,
            },
        };
        use infra::table::users::UserRecord;

        let email = "expired@b.com";
        USERS.insert(
            email.to_string(),
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
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                // Against the wall clock: the layer reads `Utc::now()`.
                password_updated_at: Some((Utc::now() - TimeDelta::days(91)).timestamp_micros()),
            },
        );

        // Seeding the settings cache keeps the policy read off the database. The key format is
        // db::system_settings::cache_key's; a drift there fails this test rather than silencing it,
        // since the read would then fall back to a policy with rotation off.
        let policy_key = format!("org:{META_ORG_ID}:_:{}", keys::PASSWORD_POLICY);
        SYSTEM_SETTINGS.write().await.insert(
            policy_key.clone(),
            SystemSetting::new_org(
                META_ORG_ID,
                keys::PASSWORD_POLICY,
                serde_json::to_value(PasswordPolicy {
                    rotation_days: 90,
                    rotation_warning_days: 7,
                    ..PasswordPolicy::default()
                })
                .unwrap(),
            ),
        );

        let app = Router::new()
            .route("/default/streams", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(password_policy_middleware))
            .layer(axum::middleware::from_fn(|request, next| async move {
                stub_auth("expired@b.com", request, next).await
            }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/default/streams")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        USERS.remove(email);
        SYSTEM_SETTINGS.write().await.remove(&policy_key);
    }

    /// The enterprise unit tests feed `decide` a path string directly, so they cannot catch the
    /// case where the layer receives a different string than expected. This one routes a real
    /// request through `nest("/api", ..)` and asserts on what actually arrives.
    #[tokio::test]
    async fn nesting_strips_the_api_prefix_before_the_middleware_sees_it() {
        use axum::{extract::Request, middleware, response::Response};

        async fn capture(request: Request, next: middleware::Next) -> Response {
            let seen = request.uri().path().to_string();
            let mut response = next.run(request).await;
            response
                .headers_mut()
                .insert("x-seen-path", seen.parse().unwrap());
            response
        }

        let app = Router::new().nest(
            "/api",
            Router::new()
                .route("/{org_id}/password_complexity", get(|| async { "ok" }))
                .layer(middleware::from_fn(capture)),
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/default/password_complexity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let seen = response.headers()["x-seen-path"].to_str().unwrap();
        assert_eq!(seen, "/default/password_complexity");

        // And the real matcher must let exactly that string through, for a user it would otherwise
        // refuse. Asserting on the string alone is what would let the two drift apart.
        #[cfg(feature = "enterprise")]
        {
            use config::meta::{password_policy::PasswordPolicy, user::UserType};
            use infra::table::users::UserRecord;

            let flagged = UserRecord {
                email: "a@b.com".to_string(),
                first_name: "T".to_string(),
                last_name: "U".to_string(),
                password: "hash".to_string(),
                salt: "salt".to_string(),
                is_root: false,
                password_ext: None,
                user_type: UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: true,
                password_reset_reason: Some("policy_tightened".to_string()),
                flagged_at: Some(1),
                password_updated_at: Some(1),
            };
            assert_eq!(
                decide(
                    &flagged,
                    &seen.parse().unwrap(),
                    &Method::GET,
                    &PasswordPolicy::default(),
                    Utc::now(),
                ),
                PolicyDecision::Allow
            );
        }
    }
}

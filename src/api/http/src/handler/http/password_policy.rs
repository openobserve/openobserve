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

//! Access-time enforcement of the instance password policy.
//!
//! Enforcement deliberately sits here rather than at the login endpoint: blocking authentication
//! itself would lock every user out at once the moment a policy tightened, with no way back in.
//! A flagged user can still log in, and is refused resources until they set a compliant password.

use axum::{
    body::Body,
    http::{Method, StatusCode, Uri, header},
    response::Response,
};
use common::infra::config::USERS;
use config::meta::password_policy::EnforcementMode;
use infra::table::users::UserRecord;

/// A distinct code so the console can route to a reset screen. A generic 401/403 would be
/// indistinguishable from an expired session and send the user back through login, which cannot
/// clear the flag and so would loop.
const RESET_REQUIRED_CODE: &str = "password_reset_required";

/// What the policy says about a request.
#[derive(Debug, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Block { reason: String },
}

/// Decide whether a request may proceed.
///
/// Split from the middleware so it is testable without axum's `Next` machinery; the middleware
/// below is only the glue that turns [`PolicyDecision::Block`] into a response.
pub fn decide(
    user: &UserRecord,
    uri: &Uri,
    method: &Method,
    enforcement_mode: EnforcementMode,
) -> PolicyDecision {
    // Root is never blocked by any policy (design §4, principle 5). It is the only account that can
    // repair a misconfigured policy or clear another user's flag, and the only one whose lockout
    // has no remedy. The sweep already skips it; this is the guarantee at the enforcement
    // point.
    if user.is_root {
        return PolicyDecision::Allow;
    }

    if !user.must_reset_password {
        return PolicyDecision::Allow;
    }

    // Checked before the block so the user has a route out. Without this the flag is a trap: every
    // request refused, including the one that would clear it.
    if is_remediation_route(uri, method, &user.email) {
        return PolicyDecision::Allow;
    }

    if enforcement_mode == EnforcementMode::RestrictWrites && is_read_only(method) {
        return PolicyDecision::Allow;
    }

    PolicyDecision::Block {
        reason: user
            .password_reset_reason
            .clone()
            .unwrap_or_else(|| "policy_tightened".to_string()),
    }
}

/// Routes a blocked user must still reach: the complexity requirements they are being held to, and
/// their own password change.
///
/// `/config` and `/config/logout` are not listed. They live in a separate nest, and only
/// `/config/reload` within it is behind `auth_middleware` at all, so neither ever reaches here.
fn is_remediation_route(uri: &Uri, method: &Method, user_email: &str) -> bool {
    let segments = route_segments(uri.path());

    if method == Method::GET && is_complexity_route(&segments) {
        return true;
    }

    // The caller's own account only. Matched on path alone — the body is not readable at this
    // layer, so a request that turns out not to be a password change simply proceeds and is
    // rejected downstream on its own merits.
    if method == Method::PUT
        && let Some(email) = users_route_email(&segments)
    {
        return email.eq_ignore_ascii_case(user_email);
    }

    false
}

/// Split a request path into non-empty segments.
///
/// The `/api` prefix is deliberately NOT assumed. `auth_middleware` runs inside
/// `nest("/api", service_routes())`, and axum strips the matched prefix before inner services see
/// the request, so the path here is `/{org}/…`. The matchers below accept the prefixed form too,
/// which keeps them correct if this middleware is ever mounted outside that nest.
fn route_segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

/// `{org}/password_complexity`, with or without a leading `api`.
fn is_complexity_route(segments: &[&str]) -> bool {
    matches!(
        segments,
        [_org, "password_complexity"] | ["api", _org, "password_complexity"]
    )
}

/// The `{email_id}` of `{org}/users/{email_id}`, with or without a leading `api`.
///
/// Deeper paths are rejected so a sub-resource cannot ride in on the same prefix.
fn users_route_email<'a>(segments: &[&'a str]) -> Option<&'a str> {
    match segments {
        [_org, "users", email] => Some(email),
        ["api", _org, "users", email] => Some(email),
        _ => None,
    }
}

fn is_read_only(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Look the user up and apply the policy. `None` means the request may proceed.
pub async fn check_request(user_email: &str, uri: &Uri, method: &Method) -> Option<Response> {
    // Served from the cluster-consistent users cache, so this costs no database round trip on the
    // authenticated hot path.
    let user = USERS.get(&user_email.to_lowercase())?;

    // Nothing else in the policy is consulted unless the user is actually flagged, so the settings
    // read is skipped entirely for the overwhelmingly common case.
    if user.is_root || !user.must_reset_password {
        return None;
    }

    let policy = db::password_policy::get_effective_policy().await;
    match decide(&user, uri, method, policy.enforcement_mode) {
        PolicyDecision::Allow => None,
        PolicyDecision::Block { reason } => Some(blocked_response(&reason)),
    }
}

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
trait InfallibleResponse {
    fn into_response_fallback(self) -> Response;
}

impl InfallibleResponse for StatusCode {
    fn into_response_fallback(self) -> Response {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = self;
        response
    }
}

#[cfg(test)]
mod tests {
    use config::meta::user::UserType;

    use super::*;

    fn user(email: &str) -> UserRecord {
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
            must_reset_password: true,
            password_reset_reason: Some("policy_tightened".to_string()),
            flagged_at: Some(1),
            password_updated_at: Some(1),
        }
    }

    fn uri(path: &str) -> Uri {
        path.parse().unwrap()
    }

    fn decide_hard(u: &UserRecord, path: &str, m: Method) -> PolicyDecision {
        decide(u, &uri(path), &m, EnforcementMode::HardBlock)
    }

    #[test]
    fn flagged_user_is_blocked() {
        let d = decide_hard(&user("a@b.com"), "/api/default/streams", Method::GET);
        assert_eq!(
            d,
            PolicyDecision::Block {
                reason: "policy_tightened".to_string()
            }
        );
    }

    #[test]
    fn unflagged_user_passes() {
        let mut u = user("a@b.com");
        u.must_reset_password = false;
        assert_eq!(
            decide_hard(&u, "/api/default/streams", Method::GET),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn root_is_never_blocked() {
        // Root stays flagged in the row but must always be let through: it is the only account
        // that can undo a bad policy, and nothing else can unblock it.
        let mut u = user("root@b.com");
        u.is_root = true;
        assert_eq!(
            decide_hard(&u, "/api/default/streams", Method::POST),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn own_password_change_is_allowed() {
        let u = user("a@b.com");
        // Stripped form first — this is what the middleware actually receives, since it runs
        // inside nest("/api", ..). Asserting only the prefixed form is what let a matcher that
        // never fired in production pass its tests.
        for path in ["/default/users/a@b.com", "/api/default/users/a@b.com"] {
            assert_eq!(
                decide_hard(&u, path, Method::PUT),
                PolicyDecision::Allow,
                "{path} must stay reachable"
            );
        }
    }

    #[test]
    fn own_password_change_matches_case_insensitively() {
        let u = user("a@b.com");
        assert_eq!(
            decide_hard(&u, "/default/users/A@B.com", Method::PUT),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn another_users_password_change_is_still_blocked() {
        // Otherwise a flagged user could reset someone else's password while refusing to fix
        // their own.
        let u = user("a@b.com");
        assert!(matches!(
            decide_hard(&u, "/default/users/victim@b.com", Method::PUT),
            PolicyDecision::Block { .. }
        ));
    }

    #[test]
    fn users_subresource_does_not_inherit_the_bypass() {
        let u = user("a@b.com");
        assert!(matches!(
            decide_hard(&u, "/default/users/a@b.com/roles", Method::PUT),
            PolicyDecision::Block { .. }
        ));
    }

    #[test]
    fn complexity_route_is_allowed() {
        let u = user("a@b.com");
        // The stripped form is the one that matters — see own_password_change_is_allowed.
        for path in [
            "/default/password_complexity",
            "/api/default/password_complexity",
            // A trailing slash is still the same route.
            "/default/password_complexity/",
        ] {
            assert_eq!(
                decide_hard(&u, path, Method::GET),
                PolicyDecision::Allow,
                "{path} must stay reachable"
            );
        }
    }

    #[test]
    fn complexity_route_bypass_is_get_only() {
        let u = user("a@b.com");
        assert!(matches!(
            decide_hard(&u, "/default/password_complexity", Method::POST),
            PolicyDecision::Block { .. }
        ));
    }

    #[test]
    fn an_org_named_api_is_not_mistaken_for_the_prefix() {
        let u = user("a@b.com");
        assert_eq!(
            decide_hard(&u, "/api/password_complexity", Method::GET),
            PolicyDecision::Allow,
            "org 'api' must resolve as an org, not as the route prefix"
        );
    }

    #[test]
    fn restrict_writes_allows_reads_and_refuses_writes() {
        let u = user("a@b.com");
        let path = "/api/default/streams";
        for m in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert_eq!(
                decide(&u, &uri(path), &m, EnforcementMode::RestrictWrites),
                PolicyDecision::Allow,
                "{m} should read"
            );
        }
        for m in [Method::POST, Method::PUT, Method::DELETE] {
            assert!(
                matches!(
                    decide(&u, &uri(path), &m, EnforcementMode::RestrictWrites),
                    PolicyDecision::Block { .. }
                ),
                "{m} should be refused"
            );
        }
    }

    /// The unit tests above feed `decide` a path string directly, so they cannot catch the case
    /// where the middleware receives a different string than expected. This one routes a real
    /// request through `nest("/api", ..)` and asserts on what actually arrives.
    #[tokio::test]
    async fn nesting_strips_the_api_prefix_before_the_middleware_sees_it() {
        use axum::{
            Router, body::Body, extract::Request, middleware, response::Response, routing::get,
        };
        use tower::ServiceExt;

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

        // And the matcher must accept exactly that string.
        assert!(is_complexity_route(&route_segments(seen)));
    }

    #[test]
    fn missing_reason_falls_back_rather_than_leaking_none() {
        let mut u = user("a@b.com");
        u.password_reset_reason = None;
        assert_eq!(
            decide_hard(&u, "/api/default/streams", Method::GET),
            PolicyDecision::Block {
                reason: "policy_tightened".to_string()
            }
        );
    }
}

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
//!
//! Two things are enforced here. A stored `must_reset_password` flag, set by the complexity sweep
//! when the policy tightened; and password rotation, which stores nothing and is recomputed from
//! `password_updated_at` on every request, so a change to `rotation_days` takes effect at once.

use axum::{
    body::Body,
    extract::Request,
    http::{Method, StatusCode, Uri, header},
    middleware::Next,
    response::Response,
};
use chrono::{DateTime, Utc};
use common::infra::config::USERS;
use config::meta::password_policy::{
    EnforcementMode, PasswordPolicy, PasswordResetReason, ROTATION_WARNING_HEADER, RotationStatus,
};
use infra::table::users::UserRecord;

/// A distinct code so the console can route to a reset screen. A generic 401/403 would be
/// indistinguishable from an expired session and send the user back through login, which cannot
/// clear the flag and so would loop.
const RESET_REQUIRED_CODE: &str = "password_reset_required";

/// The header `auth_middleware` writes the authenticated email into. Reading it here rather than
/// re-validating is what keeps this a layer of its own; `audit_middleware` consumes the same one.
const USER_ID_HEADER: &str = "user_id";

/// What the policy says about a request.
#[derive(Debug, PartialEq, Eq)]
enum PolicyDecision {
    Allow,
    /// Inside the rotation warning window: the request proceeds and carries a countdown.
    Warn {
        days_remaining: i64,
    },
    Block {
        reason: String,
    },
}

/// [`PolicyDecision`] with the block already rendered.
enum RequestOutcome {
    Proceed,
    Warn {
        days_remaining: i64,
    },
    /// Boxed: a `Response` dwarfs the other variants, and this one is the rare case.
    Block(Box<Response>),
}

/// Refuse a request whose user owes the instance a new password, or tag it with how long they have
/// left before they do.
///
/// Must be layered *inside* `auth_middleware`: the email comes from the header that authentication
/// writes, and a request that never authenticated has no user to hold to a policy. A request
/// arriving without that header is passed straight through — this layer authenticates nobody and
/// must not appear to.
pub async fn password_policy_middleware(request: Request, next: Next) -> Response {
    let Some(user_email) = request
        .headers()
        .get(USER_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
    else {
        return next.run(request).await;
    };

    let warning = match check_request(&user_email, request.uri(), request.method()).await {
        RequestOutcome::Proceed => None,
        RequestOutcome::Warn { days_remaining } => Some(days_remaining),
        RequestOutcome::Block(blocked) => return *blocked,
    };

    let mut response = next.run(request).await;
    // The deadline is advisory until it passes, so the warning rides on whatever response the
    // request produced rather than interrupting it.
    if let Some(days_remaining) = warning {
        attach_rotation_warning(&mut response, days_remaining);
    }
    response
}

/// Decide whether a request may proceed.
///
/// Split from the middleware so it is testable without axum's `Next` machinery; the middleware
/// above is only the glue that turns [`PolicyDecision`] into a response.
fn decide(
    user: &UserRecord,
    uri: &Uri,
    method: &Method,
    policy: &PasswordPolicy,
    now: DateTime<Utc>,
) -> PolicyDecision {
    // Root is never blocked by any policy (design §4, principle 5). It is the only account that can
    // repair a misconfigured policy or clear another user's flag, and the only one whose lockout
    // has no remedy. The sweep already skips it; this is the guarantee at the enforcement
    // point.
    if user.is_root {
        return PolicyDecision::Allow;
    }

    // The stored flag wins over rotation: it is the more specific reason, and both lead to the same
    // remediation anyway.
    let reason = if user.must_reset_password {
        user.password_reset_reason
            .clone()
            .unwrap_or_else(|| PasswordResetReason::PolicyTightened.as_str().to_string())
    } else {
        // An unrepresentable stored timestamp lands on the same never-expired reading as no
        // timestamp at all.
        let set_at = user
            .password_updated_at
            .and_then(DateTime::from_timestamp_micros);
        match policy.rotation_status(set_at, now) {
            RotationStatus::Current => return PolicyDecision::Allow,
            RotationStatus::Warning { days_remaining } => {
                return PolicyDecision::Warn { days_remaining };
            }
            RotationStatus::Expired => PasswordResetReason::RotationExpired.as_str().to_string(),
        }
    };

    // Checked before the block so the user has a route out. Without this the flag is a trap: every
    // request refused, including the one that would clear it.
    if is_remediation_route(uri, method, &user.email) {
        return PolicyDecision::Allow;
    }

    if policy.enforcement_mode == EnforcementMode::RestrictWrites && is_read_only(method) {
        return PolicyDecision::Allow;
    }

    PolicyDecision::Block { reason }
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

/// Look the user up and apply the policy.
async fn check_request(user_email: &str, uri: &Uri, method: &Method) -> RequestOutcome {
    // Served from the cluster-consistent users cache, so this costs no database round trip on the
    // authenticated hot path.
    let Some(user) = USERS.get(&user_email.to_lowercase()) else {
        // Authentication succeeded against something this cache does not hold — a token or an
        // enterprise identity. Nothing here applies to it.
        return RequestOutcome::Proceed;
    };

    if user.is_root {
        return RequestOutcome::Proceed;
    }

    let policy = db::password_policy::get_effective_policy().await;
    match decide(&user, uri, method, &policy, Utc::now()) {
        PolicyDecision::Allow => RequestOutcome::Proceed,
        PolicyDecision::Warn { days_remaining } => RequestOutcome::Warn { days_remaining },
        PolicyDecision::Block { reason } => {
            RequestOutcome::Block(Box::new(blocked_response(&reason)))
        }
    }
}

/// Attach the rotation countdown to a response that has already been produced.
///
/// A warning must not change what the caller asked for, so an unrepresentable value is dropped
/// rather than turned into an error.
fn attach_rotation_warning(response: &mut Response, days_remaining: i64) {
    if let Ok(value) = header::HeaderValue::from_str(&days_remaining.to_string()) {
        response.headers_mut().insert(
            header::HeaderName::from_static(ROTATION_WARNING_HEADER),
            value,
        );
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
    use chrono::TimeDelta;
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

    /// Rotation off, hard block — the default policy, under which only the stored flag matters.
    fn decide_hard(u: &UserRecord, path: &str, m: Method) -> PolicyDecision {
        decide(u, &uri(path), &m, &PasswordPolicy::default(), now())
    }

    fn rotating(days: u32, warning_days: u32) -> PasswordPolicy {
        PasswordPolicy {
            rotation_days: days,
            rotation_warning_days: warning_days,
            ..PasswordPolicy::default()
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_700_000_000, 0).unwrap()
    }

    /// A compliant user whose password was set `n` days ago, so rotation is the only thing that
    /// can act on them.
    fn unflagged(email: &str, password_age_days: i64) -> UserRecord {
        let mut u = user(email);
        u.must_reset_password = false;
        u.password_reset_reason = None;
        u.flagged_at = None;
        u.password_updated_at =
            Some((now() - TimeDelta::days(password_age_days)).timestamp_micros());
        u
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
        let policy = PasswordPolicy {
            enforcement_mode: EnforcementMode::RestrictWrites,
            ..PasswordPolicy::default()
        };
        for m in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert_eq!(
                decide(&u, &uri(path), &m, &policy, now()),
                PolicyDecision::Allow,
                "{m} should read"
            );
        }
        for m in [Method::POST, Method::PUT, Method::DELETE] {
            assert!(
                matches!(
                    decide(&u, &uri(path), &m, &policy, now()),
                    PolicyDecision::Block { .. }
                ),
                "{m} should be refused"
            );
        }
    }

    #[test]
    fn expired_password_is_blocked_with_its_own_reason() {
        let u = unflagged("a@b.com", 91);
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::GET,
                &rotating(90, 7),
                now()
            ),
            PolicyDecision::Block {
                reason: "rotation_expired".to_string()
            }
        );
    }

    #[test]
    fn expiry_lands_exactly_on_the_threshold() {
        let mut u = unflagged("a@b.com", 90);
        let policy = rotating(90, 7);
        assert!(matches!(
            decide(&u, &uri("/default/streams"), &Method::GET, &policy, now()),
            PolicyDecision::Block { .. }
        ));

        u.password_updated_at = u.password_updated_at.map(|t| t + 1);
        assert!(matches!(
            decide(&u, &uri("/default/streams"), &Method::GET, &policy, now()),
            PolicyDecision::Warn { .. }
        ));
    }

    #[test]
    fn expired_user_can_still_reach_the_remediation_routes() {
        // The whole point of blocking at access time rather than at login: the way out stays open.
        let u = unflagged("a@b.com", 91);
        let policy = rotating(90, 7);
        assert_eq!(
            decide(
                &u,
                &uri("/default/users/a@b.com"),
                &Method::PUT,
                &policy,
                now()
            ),
            PolicyDecision::Allow
        );
        assert_eq!(
            decide(
                &u,
                &uri("/default/password_complexity"),
                &Method::GET,
                &policy,
                now()
            ),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn warning_window_warns_rather_than_blocks() {
        let u = unflagged("a@b.com", 85);
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::POST,
                &rotating(90, 7),
                now()
            ),
            PolicyDecision::Warn { days_remaining: 5 }
        );
    }

    #[test]
    fn a_window_as_long_as_the_period_warns_on_every_request() {
        let u = unflagged("a@b.com", 1);
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::GET,
                &rotating(90, 90),
                now()
            ),
            PolicyDecision::Warn { days_remaining: 89 }
        );
    }

    #[test]
    fn root_is_exempt_from_rotation() {
        let mut u = unflagged("root@b.com", 10_000);
        u.is_root = true;
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::POST,
                &rotating(90, 7),
                now()
            ),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn a_password_with_no_recorded_age_is_never_expired() {
        // Should not survive the backfill, but reading None as the epoch would expire the whole
        // instance at once.
        let mut u = unflagged("a@b.com", 0);
        u.password_updated_at = None;
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::POST,
                &rotating(1, 0),
                now()
            ),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn rotation_off_ignores_an_ancient_password() {
        let u = unflagged("a@b.com", 10_000);
        assert_eq!(
            decide_hard(&u, "/default/streams", Method::POST),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn the_stored_flag_outranks_rotation() {
        // Both apply; the reason reported is the one that was actually recorded.
        let mut u = user("a@b.com");
        u.password_updated_at = Some((now() - TimeDelta::days(91)).timestamp_micros());
        assert_eq!(
            decide(
                &u,
                &uri("/default/streams"),
                &Method::GET,
                &rotating(90, 7),
                now()
            ),
            PolicyDecision::Block {
                reason: "policy_tightened".to_string()
            }
        );
    }

    #[test]
    fn restrict_writes_applies_to_rotation_too() {
        let u = unflagged("a@b.com", 91);
        let policy = PasswordPolicy {
            rotation_days: 90,
            enforcement_mode: EnforcementMode::RestrictWrites,
            ..PasswordPolicy::default()
        };
        assert_eq!(
            decide(&u, &uri("/default/streams"), &Method::GET, &policy, now()),
            PolicyDecision::Allow
        );
        assert!(matches!(
            decide(&u, &uri("/default/streams"), &Method::POST, &policy, now()),
            PolicyDecision::Block { .. }
        ));
    }

    #[test]
    fn the_warning_header_carries_the_countdown() {
        let mut response = Response::new(Body::empty());
        attach_rotation_warning(&mut response, 3);
        assert_eq!(response.headers()[ROTATION_WARNING_HEADER], "3");
    }

    /// Layered outside the gate, so the gate sees exactly what `auth_middleware` leaves behind.
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
        use axum::{Router, body::Body, routing::get};
        use tower::ServiceExt;

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
        assert!(!response.headers().contains_key(ROTATION_WARNING_HEADER));
    }

    /// Authentication succeeded against an identity the users cache does not hold — a token, or an
    /// enterprise login. There is no local password to have a policy about.
    #[tokio::test]
    async fn a_user_the_cache_does_not_hold_passes_through() {
        use axum::{Router, body::Body, routing::get};
        use tower::ServiceExt;

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

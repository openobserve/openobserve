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

//! OSS Admin/Root role gate for handlers that must reject non-admin principals.
//!
//! In the OSS build there is no RBAC middleware — `check_permissions` is a
//! no-op that returns `true` for every authenticated caller, so any handler
//! that a low-privilege `service_account` principal can reach with valid
//! credentials must reject non-admin roles itself. This module is that
//! reusable, root-cause fix: instead of scattering identical
//! `role != Admin && role != Root` blocks across handlers (with the attendant
//! risk of any single site drifting), every OSS admin-only handler calls
//! [`assert_admin_role`] and propagates the returned `403` response.
//!
//! The gate is guarded with `#[cfg(not(feature = "enterprise"))]` at each
//! call site so enterprise builds (which have proper RBAC middleware or an
//! equivalent handler-level Admin/Root check) skip it — matching the
//! codebase convention established in
//! `handler/http/request/organization/ingestion_tokens.rs`.

use axum::response::Response;
use config::meta::user::UserRole;

use crate::common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::is_root_user};

/// Reject the caller with HTTP 403 unless they hold the Admin or Root role in
/// the given organization.
///
/// Returns `Ok(())` if the caller is authorized and `Err(Response)` with a
/// pre-built forbidden response otherwise. Callers propagate the response
/// with an explicit match (or `?`), for example:
///
/// ```ignore
/// #[cfg(not(feature = "enterprise"))]
/// if let Err(resp) = assert_admin_role(&org_id, &user_email.user_id).await {
///     return resp;
/// }
/// ```
pub async fn assert_admin_role(org_id: &str, user_id: &str) -> Result<(), Response> {
    if is_root_user(user_id) {
        return Ok(());
    }
    match crate::service::users::get_user(Some(org_id), user_id).await {
        Some(initiator)
            if initiator.role == UserRole::Admin || initiator.role == UserRole::Root =>
        {
            Ok(())
        }
        _ => Err(MetaHttpResponse::forbidden(
            "Admin or Root role required for this action",
        )),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::user::{UserRole, UserType};
    use infra::table::{org_users::OrgUserRecord, users::UserRecord};

    use super::*;
    use crate::common::infra::config::{ORG_USERS, USERS};

    /// Fabricate a minimal in-memory user + org-membership pair so
    /// `get_user` resolves synchronously in this test, without a DB
    /// round-trip. `get_cached_user_org` requires BOTH `USERS` and
    /// `ORG_USERS` entries — miss either and the lookup falls through to
    /// the persistent DB (returns None), which would collapse "Admin" to
    /// "unknown user" and mis-report the gate as too strict. Every field
    /// on `OrgUserRecord` must be populated — `allow_static_token`
    /// defaults to `true` in real writes (see `OrgUserRecord::new`).
    fn seed_org_user(org_id: &str, email: &str, role: UserRole) {
        USERS.insert(
            email.to_string(),
            UserRecord {
                email: email.to_string(),
                password: "test-pass".to_string(),
                salt: String::new(),
                first_name: "Test".to_string(),
                last_name: "User".to_string(),
                password_ext: None,
                user_type: UserType::Internal,
                is_root: false,
                created_at: 0,
                updated_at: 0,
            },
        );
        let key = format!("{org_id}/{email}");
        ORG_USERS.insert(
            key,
            OrgUserRecord {
                email: email.to_string(),
                org_id: org_id.to_string(),
                role,
                token: "test-token".to_string(),
                rum_token: None,
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    async fn body_text(resp: Response) -> String {
        let (_parts, body) = resp.into_parts();
        let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        String::from_utf8_lossy(&bytes).to_string()
    }

    /// Regression: a `service_account`-role principal within an
    /// organization must be rejected by every OSS admin-only handler that
    /// calls this gate, before the handler reads or writes anything. This
    /// asserts the shared invariant behind the six covered endpoints
    /// (reports list/create, folders list/create/update/delete, enrichment
    /// table write, org settings write, service-account list, org-users
    /// list).
    #[tokio::test]
    async fn service_account_rejected_with_403_forbidden() {
        let org = "org-oss-gate-sa";
        let sa = "sa-oss-gate@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);

        let result = assert_admin_role(org, sa).await;
        let err = result.expect_err("service account must be rejected by the OSS admin gate");
        assert_eq!(err.status().as_u16(), 403);
        let text = body_text(err).await;
        assert!(
            text.contains("Admin or Root"),
            "forbidden body should name the required role, got: {text}"
        );
    }

    /// Baseline: the org's own Admin role must be allowed through, so the
    /// service-account rejection above is provably the invariant being
    /// enforced (not a broken test setup that fails everyone).
    #[tokio::test]
    async fn admin_allowed() {
        let org = "org-oss-gate-admin";
        let admin = "admin-oss-gate@example.test";
        seed_org_user(org, admin, UserRole::Admin);

        assert!(
            assert_admin_role(org, admin).await.is_ok(),
            "admin role must pass the OSS admin gate"
        );
    }

    /// Any lower-privilege role must be rejected, not only
    /// `ServiceAccount` — the gate is role-based, not
    /// "is-service-account".
    #[tokio::test]
    async fn viewer_rejected() {
        let org = "org-oss-gate-viewer";
        let viewer = "viewer-oss-gate@example.test";
        seed_org_user(org, viewer, UserRole::Viewer);

        let result = assert_admin_role(org, viewer).await;
        assert!(
            result.is_err(),
            "viewer role must be rejected by the OSS admin gate"
        );
        assert_eq!(result.err().unwrap().status().as_u16(), 403);
    }

    /// A caller with no membership record must be rejected — no implicit
    /// trust just because authentication succeeded.
    #[tokio::test]
    async fn unknown_user_rejected() {
        let org = "org-oss-gate-unknown";
        let stranger = "stranger-oss-gate@example.test";
        // Deliberately do NOT seed — `get_user` returns None.

        let result = assert_admin_role(org, stranger).await;
        assert!(
            result.is_err(),
            "unknown user must be rejected (no implicit trust)"
        );
        assert_eq!(result.err().unwrap().status().as_u16(), 403);
    }
}

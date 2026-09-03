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

//! Administering the failed-login lockout on a single user.
//!
//! This is how an operator answers "why can this account not log in, and how do I fix it now".
//! Nothing else ends a lockout early — a password change leaves it standing, because the lock
//! records failed attempts rather than anything about the password — so without these routes a
//! locked user waits out `lockout.max_secs`.
//!
//! Both routes are administrative: the counters they expose would tell the user they describe
//! exactly how to pace attempts underneath the threshold, and clearing a lock hands an account back
//! its remaining guesses. Who counts as an administrator is [`validate_lockout_admin`].

use axum::{extract::Path, response::Response};
use config::{META_ORG_ID, meta::user::UserRole};
use openobserve_api_common::{auth::login_lockout, extractors::Headers};
use openobserve_core::auth::UserEmail;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::organization::password_policy::validate_meta_admin,
};

/// Who may inspect or clear a lockout, and over whom.
///
/// Root and administrators of `_meta` administer the instance, so they reach any account. Everyone
/// else must administer the organization named in the path **and** the target must belong to it: a
/// lockout is an account-level fact, so that membership is the only thing keeping one tenant's
/// admin out of another tenant's users.
///
/// This is deliberately wider than the policy routes next door, which stay `_meta`-only. Reading
/// the whole policy exposes the thresholds for the entire deployment; this exposes one account's
/// counters to someone who already administers that account.
async fn validate_lockout_admin(org_id: &str, caller: &str, target: &str) -> Result<(), String> {
    if db::user::is_root_user(caller) {
        return Ok(());
    }
    if org_id == META_ORG_ID {
        return validate_meta_admin(org_id, caller).await;
    }

    let administers_org = db::org_users::get(org_id, caller)
        .await
        .is_ok_and(|record| matches!(record.role, UserRole::Root | UserRole::Admin));
    if !administers_org {
        return Err(format!(
            "Administering a lockout requires Root or Admin on {org_id}, or on {META_ORG_ID}"
        ));
    }

    // Root is out of an org admin's reach even where it shares their organization. Clearing its
    // lockout would hand a brute-force run against the instance's own account a fresh start, and
    // an org admin is not who that decision belongs to.
    if db::user::is_root_user(target) {
        return Err(format!(
            "The root account's lockout can only be administered from {META_ORG_ID}"
        ));
    }

    if db::org_users::get(org_id, target).await.is_err() {
        return Err(format!("{target} is not a member of {org_id}"));
    }

    Ok(())
}

/// Get a user's lockout state
#[utoipa::path(
    get,
    path = "/{org_id}/settings/password_policy/lockouts/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetUserLockout",
    summary = "Get a user's failed-login lockout state",
    description = "Reports whether the named user is currently locked out of password \
                   authentication, how long is left on the lock, and the failure counters behind \
                   it. Requires Root or Admin on the named organization, and the user must belong \
                   to it; administrators of the meta organization may inspect any account. A user \
                   who has never failed a login has no stored state and is reported as unlocked \
                   with zeroed counters rather than as missing, so this endpoint never 404s.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization the caller administers, or the meta org for instance-wide access"),
        ("email_id" = String, Path, description = "Email address of the user to inspect; must belong to org_id unless the caller administers the meta org"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = login_lockout::LockoutState),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get a user's failed-login lockout state", "category": "system"}))
    )
)]
pub async fn get_lockout(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(e) = validate_lockout_admin(&org_id, &user_email.user_id, &email_id).await {
        return MetaHttpResponse::forbidden(e);
    }

    match login_lockout::lockout_state(&email_id).await {
        Ok(state) => MetaHttpResponse::json(state),
        Err(e) => {
            log::error!("{e}");
            MetaHttpResponse::internal_error("Failed to read the lockout state")
        }
    }
}

/// Clear a user's lockout
#[utoipa::path(
    delete,
    path = "/{org_id}/settings/password_policy/lockouts/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "DeleteUserLockout",
    summary = "Clear a user's failed-login lockout",
    description = "Releases an active lockout and resets the failure counters, letting the user \
                   authenticate again at once. Requires Root or Admin on the named organization, \
                   and the user must belong to it; administrators of the meta organization may \
                   unlock any account, and only they may unlock root. Clearing a user who was never \
                   locked succeeds and changes nothing, so this is safe to retry. Note that this \
                   also resets the escalation level, so the user's next lockout starts from the \
                   shortest backoff again.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization the caller administers, or the meta org for instance-wide access"),
        ("email_id" = String, Path, description = "Email address of the user to unlock; must belong to org_id unless the caller administers the meta org"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Clear a user's failed-login lockout", "category": "system"}))
    )
)]
pub async fn delete_lockout(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(e) = validate_lockout_admin(&org_id, &user_email.user_id, &email_id).await {
        return MetaHttpResponse::forbidden(e);
    }

    match login_lockout::clear_lockout(&email_id).await {
        Ok(()) => {
            log::info!("Lockout cleared for {email_id} by {}", user_email.user_id);
            MetaHttpResponse::ok("Lockout cleared")
        }
        Err(e) => {
            log::error!("{e}");
            MetaHttpResponse::internal_error("Failed to clear the lockout")
        }
    }
}

#[cfg(test)]
mod tests {
    use common::infra::config::ORG_USERS;
    use config::DEFAULT_ORG;
    use infra::table::org_users::OrgUserRecord;

    use super::*;

    /// Seeds the org-user cache a running node fills from the coordinator watcher. Nothing watches
    /// under test, and every allow path below is answered from this cache alone.
    fn join(org_id: &str, email: &str, role: UserRole) {
        ORG_USERS.insert(
            format!("{org_id}/{email}"),
            OrgUserRecord {
                role,
                token: "token".to_string(),
                rum_token: None,
                org_id: org_id.to_string(),
                email: email.to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    #[tokio::test]
    async fn an_org_admin_administers_its_own_members() {
        let org = "lockout-acme";
        let admin = "admin@lockout-acme.test";
        let member = "member@lockout-acme.test";
        join(org, admin, UserRole::Admin);
        join(org, member, UserRole::Viewer);

        assert!(validate_lockout_admin(org, admin, member).await.is_ok());
    }

    #[tokio::test]
    async fn an_org_admin_is_refused_a_user_outside_the_org() {
        let org = "lockout-outsider";
        let admin = "admin@lockout-outsider.test";
        join(org, admin, UserRole::Admin);

        let refused = validate_lockout_admin(org, admin, "stranger@elsewhere.test")
            .await
            .unwrap_err();

        assert!(refused.contains("not a member"), "{refused}");
    }

    #[tokio::test]
    async fn a_non_admin_is_refused_its_own_org() {
        let org = "lockout-viewer";
        let viewer = "viewer@lockout-viewer.test";
        let member = "member@lockout-viewer.test";
        join(org, viewer, UserRole::Viewer);
        join(org, member, UserRole::Viewer);

        assert!(validate_lockout_admin(org, viewer, member).await.is_err());
    }

    /// The org boundary is the whole point: administering one tenant must not reach into another.
    #[tokio::test]
    async fn administering_one_org_does_not_reach_another() {
        let (mine, theirs) = ("lockout-mine", "lockout-theirs");
        let admin = "admin@lockout-mine.test";
        let target = "member@lockout-theirs.test";
        join(mine, admin, UserRole::Admin);
        join(theirs, target, UserRole::Viewer);

        assert!(validate_lockout_admin(mine, admin, target).await.is_err());
    }

    #[tokio::test]
    async fn root_administers_any_org() {
        let root = "root@lockout-root.test";
        join(DEFAULT_ORG, root, UserRole::Root);

        assert!(
            validate_lockout_admin("lockout-any", root, "someone@elsewhere.test")
                .await
                .is_ok()
        );
    }

    /// An org admin who happens to share root's organization still may not clear its lockout.
    #[tokio::test]
    async fn root_is_out_of_an_org_admins_reach() {
        let org = "lockout-shared";
        let admin = "admin@lockout-shared.test";
        let root = "root@lockout-shared.test";
        join(org, admin, UserRole::Admin);
        join(org, root, UserRole::Root);
        join(DEFAULT_ORG, root, UserRole::Root);

        let refused = validate_lockout_admin(org, admin, root).await.unwrap_err();

        assert!(refused.contains(META_ORG_ID), "{refused}");
    }
}

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
//! Both routes require Root or Admin on `_meta`, the same rule that guards the policy itself: the
//! state they expose is the policy's enforcement record, and the counters in it would tell the user
//! they describe exactly how to pace attempts underneath the threshold.

use axum::{extract::Path, response::Response};
use openobserve_api_common::{auth::login_lockout, extractors::Headers};
use openobserve_core::auth::UserEmail;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::organization::password_policy::validate_meta_admin,
};

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
                   it. Requires Root or Admin on the meta organization. A user who has never failed \
                   a login has no stored state and is reported as unlocked with zeroed counters \
                   rather than as missing, so this endpoint never 404s.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org; caller must be Root or Admin)"),
        ("email_id" = String, Path, description = "Email address of the user to inspect"),
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
    if let Err(e) = validate_meta_admin(&org_id, &user_email.user_id).await {
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
                   authenticate again at once. Requires Root or Admin on the meta organization. \
                   Clearing a user who was never locked succeeds and changes nothing, so this is \
                   safe to retry. Note that this also resets the escalation level, so the user's \
                   next lockout starts from the shortest backoff again.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org; caller must be Root or Admin)"),
        ("email_id" = String, Path, description = "Email address of the user to unlock"),
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
    if let Err(e) = validate_meta_admin(&org_id, &user_email.user_id).await {
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

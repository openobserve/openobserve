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

//! Instance-wide authentication policy HTTP handler.
//!
//! The policy governs every native user on the deployment, so it is authored on `_meta` and never
//! per-tenant. Both methods require an administrator of that org, on top of the ordinary `settings`
//! permission: the grant answers "may this caller edit settings for the org they named", and the
//! checks below answer "is that org the one org allowed to hold this policy" and "is this caller an
//! instance administrator".
//!
//! The role check is not redundant with OpenFGA. That grant is optional — an OSS build compiles
//! `check_permissions` as an unconditional `true`, and an enterprise build with `openfga.enabled =
//! false`, or one whose license reporting has failed, short-circuits to the same. In those
//! configurations org membership would otherwise be the only gate, leaving a Viewer who happens to
//! belong to `_meta` able to read the lockout thresholds or rewrite the policy for everyone.

use axum::{Json, extract::Path, response::Response};
use config::{
    META_ORG_ID,
    meta::{
        password_policy::{PasswordComplexity, PasswordPolicy},
        user::UserRole,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// A tightening write forces a password reset on every affected user, so the count comes back with
/// the policy rather than leaving the admin to discover the blast radius from support tickets.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SetPasswordPolicyResponse {
    pub policy: PasswordPolicy,
    pub users_flagged: u64,
}

fn validate_meta_org_access(org_id: &str) -> Result<(), String> {
    if org_id != META_ORG_ID {
        return Err(format!(
            "The password policy can only be configured from the meta organization. Provided \
             org_id: {org_id}, expected: {META_ORG_ID}"
        ));
    }
    Ok(())
}

/// Both methods additionally require Root or Admin on `_meta`. See the module docs for why this is
/// enforced here rather than left to the OpenFGA `settings` grant.
///
/// Shared with the lockout routes, which administer the same policy and answer to the same rule.
pub async fn validate_meta_admin(org_id: &str, user_id: &str) -> Result<(), String> {
    validate_meta_org_access(org_id)?;

    // Root's membership lives on the default org, so it will not always be found under `_meta`.
    if db::user::is_root_user(user_id) {
        return Ok(());
    }

    match openobserve_core::users::get_user(Some(META_ORG_ID), user_id).await {
        Some(user) if matches!(user.role, UserRole::Root | UserRole::Admin) => Ok(()),
        _ => Err(format!(
            "Configuring the password policy requires an administrator of the {META_ORG_ID} \
             organization"
        )),
    }
}

/// Get the instance-wide password policy
#[utoipa::path(
    get,
    path = "/{org_id}/settings/password_policy",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetPasswordPolicy",
    summary = "Get the password policy",
    description = "Returns the authentication policy enforced for native users across the whole \
                   deployment: password complexity, rotation, reuse prevention and account lockout. \
                   Requires Root or Admin on the meta organization, because the full policy \
                   includes lockout thresholds and history depth; callers who only need the \
                   password requirements should use /{org_id}/password_complexity. An instance that has \
                   never configured a policy returns the built-in defaults rather than an error, \
                   so this endpoint never 404s.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org; caller must be Root or Admin)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PasswordPolicy),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get the instance password policy", "category": "system"}))
    )
)]
pub async fn get_policy(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Gated like the write, not just like a read: the full policy carries lockout thresholds and
    // history depth, which tell an attacker how to pace attempts. Non-admins who need to know what
    // a password must look like read /{org_id}/password_complexity instead.
    if let Err(e) = validate_meta_admin(&org_id, &user_email.user_id).await {
        return MetaHttpResponse::forbidden(e);
    }

    MetaHttpResponse::json(db::password_policy::get_effective_policy().await)
}

/// Get the password complexity requirements
#[utoipa::path(
    get,
    path = "/{org_id}/password_complexity",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetPasswordComplexity",
    summary = "Get password complexity requirements",
    description = "Returns only what a password must look like — length bounds, required character \
                   classes, and the special-character set. Readable by any authenticated user in any \
                   organization, because the caller who most needs it is one who has just been \
                   forced to reset their password and holds no settings permission. Rotation, reuse \
                   and lockout settings are never included.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PasswordComplexity),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get password complexity requirements", "category": "system"}))
    )
)]
pub async fn get_password_complexity(Path(_org_id): Path<String>) -> Response {
    let policy = db::password_policy::get_effective_policy().await;
    MetaHttpResponse::json(PasswordComplexity::from(&policy))
}

/// Replace the instance-wide password policy
#[utoipa::path(
    put,
    path = "/{org_id}/settings/password_policy",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SetPasswordPolicy",
    summary = "Configure the password policy",
    description = "Replaces the whole policy; any field omitted from the body falls back to its \
                   default rather than to its current value. Requires Root or Admin on the meta \
                   organization. If the complexity requirements grew, every native user is flagged \
                   for a forced password reset and the response reports how many were affected — \
                   root, external users and service accounts are never flagged.",
    security(("Authorization" = [])),
    request_body(content = PasswordPolicy, description = "The policy to enforce", content_type = "application/json"),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org; caller must be Root or Admin)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SetPasswordPolicyResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Configure the instance password policy", "category": "system", "requires_confirmation": true}))
    )
)]
pub async fn set_policy(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(policy): Json<PasswordPolicy>,
) -> Response {
    if let Err(e) = validate_meta_admin(&org_id, &user_email.user_id).await {
        return MetaHttpResponse::forbidden(e);
    }

    // Reject a self-contradictory policy before it can flag anyone: the sweep is not something an
    // admin can undo by correcting the request.
    if let Err(e) = policy.validate() {
        return MetaHttpResponse::bad_request(e);
    }

    match db::password_policy::set_policy(&policy).await {
        Ok(users_flagged) => MetaHttpResponse::json(SetPasswordPolicyResponse {
            policy,
            users_flagged,
        }),
        Err(e) => {
            log::error!("Error saving the password policy: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meta_org_access_allows_only_meta() {
        assert!(validate_meta_org_access(META_ORG_ID).is_ok());

        let err = validate_meta_org_access("acme").unwrap_err();
        assert!(err.contains("acme"), "the error names the rejected org");
        assert!(err.contains(META_ORG_ID), "and the expected one");
    }

    #[test]
    fn test_response_serializes_flagged_count() {
        let body = serde_json::to_value(SetPasswordPolicyResponse {
            policy: PasswordPolicy::default(),
            users_flagged: 12,
        })
        .unwrap();

        assert_eq!(body["users_flagged"], 12);
        assert_eq!(body["policy"]["min_length"], 8);
    }
}

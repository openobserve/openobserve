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

//! System Settings HTTP Handler
//!
//! Provides REST API endpoints for multi-level system settings.
//! Settings resolution order (most specific wins): User -> Org -> System

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::system_settings::{
    SettingScope, SystemSetting, SystemSettingPayload, SystemSettingQuery,
};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
    service::db::system_settings,
};

/// OSS-only Admin/Root role gate for the v2 system-settings mutating
/// handlers. In the OSS build there is no RBAC middleware and
/// `check_permissions` returns `true` for every authenticated caller, so
/// each admin-only handler has to reject non-admin roles itself. Returns
/// `Err(Response)` with a pre-built HTTP 403 when the caller is not an
/// Admin or Root in `org_id`; the handler propagates that response
/// unchanged.
///
/// This helper is intentionally private to this module. The v1 settings
/// handler in `settings.rs` has an equivalent gate on the
/// `security/enforce-admin-oss-endpoints` branch; once that branch lands
/// (introducing `crate::handler::http::auth::oss_role_gate`), this
/// private helper should be replaced with the shared one. Keeping it
/// private here avoids a public-API conflict with that in-flight PR.
#[cfg(not(feature = "enterprise"))]
async fn assert_admin_role_oss(org_id: &str, user_id: &str) -> Result<(), Response> {
    use config::meta::user::UserRole;

    use crate::common::utils::auth::is_root_user;

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

/// OSS-only self-or-admin gate for user-level v2 system-settings
/// mutations. The `user_id` path param names the target account whose
/// setting is being written. Personal preferences are legitimately
/// mutable by the owning user, so we allow the call when the
/// authenticated caller's `user_id` matches the target path segment
/// (compared case-insensitively to mirror how the auth layer normalizes
/// email identifiers). Everything else must clear the Admin/Root role
/// gate — otherwise any authenticated org member could overwrite an
/// admin's user-level settings via BFLA.
#[cfg(not(feature = "enterprise"))]
async fn assert_self_or_admin_oss(
    org_id: &str,
    caller_user_id: &str,
    target_user_id: &str,
) -> Result<(), Response> {
    if caller_user_id.eq_ignore_ascii_case(target_user_id) {
        return Ok(());
    }
    assert_admin_role_oss(org_id, caller_user_id).await
}

/// Get a specific system setting with resolution (user -> org -> system)
#[utoipa::path(
    get,
    path = "/{org_id}/settings/v2/{key}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingGetResolved",
    summary = "Get resolved system setting",
    description = "Retrieves a setting value with multi-level resolution. Checks user-level first, \
                   then org-level, then system-level defaults. Returns the most specific setting found, \
                   or null if no setting exists at any level.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Setting key"),
        ("user_id" = Option<String>, Query, description = "User ID for user-level resolution"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Option<SystemSetting>),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get resolved system setting", "category": "system"}))
    )
)]
pub async fn get_setting(
    Path((org_id, key)): Path<(String, String)>,
    Query(query): Query<SystemSettingQuery>,
) -> Response {
    let user_id = query.user_id.as_deref();

    match system_settings::get_resolved(Some(&org_id), user_id, &key).await {
        Ok(setting) => (StatusCode::OK, Json(setting)).into_response(), // Returns setting or null
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// List all resolved settings for an organization/user
#[utoipa::path(
    get,
    path = "/{org_id}/settings/v2",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingListResolved",
    summary = "List all resolved system settings",
    description = "Lists all settings with multi-level resolution applied. Merges system, org, and user \
                   levels, returning the most specific value for each key.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_id" = Option<String>, Query, description = "User ID for user-level resolution"),
        ("category" = Option<String>, Query, description = "Filter by setting category"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List resolved system settings", "category": "system"}))
    )
)]
pub async fn list_settings(
    Path(org_id): Path<String>,
    Query(query): Query<SystemSettingQuery>,
) -> Response {
    let user_id = query.user_id.as_deref();
    let category = query.category.as_deref();

    match system_settings::list_resolved(Some(&org_id), user_id, category).await {
        Ok(settings) => (StatusCode::OK, Json(settings)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// Create or update a setting at org level
#[utoipa::path(
    post,
    path = "/{org_id}/settings/v2",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingSetOrg",
    summary = "Set organization-level setting",
    description = "Creates or updates an organization-level setting. This setting applies to all users \
                   in the organization unless overridden at the user level.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = SystemSettingPayload, description = "Setting to create/update", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SystemSetting),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Set org-level system setting", "category": "system"}))
    )
)]
pub async fn set_org_setting(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(payload): Json<SystemSettingPayload>,
) -> Response {
    // OSS: no RBAC middleware, so require Admin/Root role explicitly here.
    // Enterprise builds enforce this in their auth middleware and skip the
    // check.
    #[cfg(not(feature = "enterprise"))]
    if let Err(resp) = assert_admin_role_oss(&org_id, &user_email.user_id).await {
        return resp;
    }
    let _ = &user_email; // silence unused warning on enterprise builds
    let mut setting = SystemSetting::new_org(&org_id, &payload.setting_key, payload.setting_value);
    if let Some(cat) = payload.setting_category.as_deref() {
        setting.setting_category = Some(cat.to_string());
    }
    if let Some(desc) = payload.description.as_deref() {
        setting.description = Some(desc.to_string());
    }

    match system_settings::set(&setting).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// Create or update a setting at user level
#[utoipa::path(
    post,
    path = "/{org_id}/settings/v2/user/{user_id}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingSetUser",
    summary = "Set user-level setting",
    description = "Creates or updates a user-level setting. This setting applies only to the specific \
                   user and overrides org-level and system-level settings.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    request_body(content = SystemSettingPayload, description = "Setting to create/update", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SystemSetting),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Set user-level system setting", "category": "system"}))
    )
)]
pub async fn set_user_setting(
    Path((org_id, user_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(payload): Json<SystemSettingPayload>,
) -> Response {
    // OSS: no RBAC middleware, so require caller == target OR Admin/Root.
    // Self-mutation stays open so users can still write their own prefs;
    // cross-user writes are the BFLA path we're closing.
    #[cfg(not(feature = "enterprise"))]
    if let Err(resp) = assert_self_or_admin_oss(&org_id, &user_email.user_id, &user_id).await {
        return resp;
    }
    let _ = &user_email;
    let mut setting = SystemSetting::new_user(
        &org_id,
        &user_id,
        &payload.setting_key,
        payload.setting_value,
    );
    if let Some(cat) = payload.setting_category.as_deref() {
        setting.setting_category = Some(cat.to_string());
    }
    if let Some(desc) = payload.description.as_deref() {
        setting.description = Some(desc.to_string());
    }

    match system_settings::set(&setting).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// Delete an organization-level setting
#[utoipa::path(
    delete,
    path = "/{org_id}/settings/v2/{key}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingDeleteOrg",
    summary = "Delete organization-level setting",
    description = "Deletes an organization-level setting. After deletion, queries for this key will \
                   fall back to system-level defaults.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Setting key"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete org system setting", "category": "system", "requires_confirmation": true}))
    )
)]
pub async fn delete_org_setting(
    Path((org_id, key)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    // OSS: no RBAC middleware, so require Admin/Root role explicitly here.
    #[cfg(not(feature = "enterprise"))]
    if let Err(resp) = assert_admin_role_oss(&org_id, &user_email.user_id).await {
        return resp;
    }
    let _ = &user_email;
    match system_settings::delete(&SettingScope::Org, Some(&org_id), None, &key).await {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({"deleted": true}))).into_response(),
        Ok(false) => MetaHttpResponse::not_found("Setting not found"),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// Delete a user-level setting
#[utoipa::path(
    delete,
    path = "/{org_id}/settings/v2/user/{user_id}/{key}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingDeleteUser",
    summary = "Delete user-level setting",
    description = "Deletes a user-level setting. After deletion, queries for this key will fall back \
                   to org-level or system-level settings.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_id" = String, Path, description = "User ID"),
        ("key" = String, Path, description = "Setting key"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete user system setting", "category": "system", "requires_confirmation": true}))
    )
)]
pub async fn delete_user_setting(
    Path((org_id, user_id, key)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    // OSS: no RBAC middleware, so require caller == target OR Admin/Root.
    #[cfg(not(feature = "enterprise"))]
    if let Err(resp) = assert_self_or_admin_oss(&org_id, &user_email.user_id, &user_id).await {
        return resp;
    }
    let _ = &user_email;
    match system_settings::delete(&SettingScope::User, Some(&org_id), Some(&user_id), &key).await {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({"deleted": true}))).into_response(),
        Ok(false) => MetaHttpResponse::not_found("Setting not found"),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

#[cfg(test)]
mod tests {
    //! Regression tests for the v2 system-settings mutating handlers.
    //!
    //! Invariants asserted here (OSS build; enterprise builds delegate the
    //! same check to their RBAC middleware):
    //!
    //! - Org-level mutations (POST /settings/v2, DELETE /settings/v2/{key})
    //!   require Admin/Root role. A `service_account` role must be rejected
    //!   with HTTP 403 before any write hits the store.
    //! - User-level mutations (POST/DELETE /settings/v2/user/{user_id}[/{key}])
    //!   must reject a caller whose authenticated `user_id` does not match
    //!   the path `user_id`, unless the caller holds Admin/Root role.
    //!   Self-mutation is allowed for any authenticated org member so
    //!   personal preferences remain writable by the owning user.
    //!
    //! These tests exercise the handler functions directly (not through the
    //! router) so no HTTP server, no DB, and no auth middleware is required
    //! — the OSS-mode `#[cfg(not(feature = "enterprise"))]` gate itself is
    //! what we're regression-testing. The USERS + ORG_USERS in-memory caches
    //! are pre-seeded so `service::users::get_user` resolves synchronously.
    #![cfg(not(feature = "enterprise"))]
    #![allow(clippy::items_after_test_module)]

    use axum::{Json, extract::Path};
    use config::meta::{
        system_settings::SystemSettingPayload,
        user::{UserRole, UserType},
    };
    use infra::table::{org_users::OrgUserRecord, users::UserRecord};
    use serde_json::json;

    use super::{delete_org_setting, delete_user_setting, set_org_setting, set_user_setting};
    use crate::{
        common::{
            infra::config::{ORG_USERS, USERS},
            utils::auth::UserEmail,
        },
        handler::http::extractors::Headers as HeadersExtractor,
    };

    /// Seed both the USERS and ORG_USERS caches so `service::users::get_user`
    /// (called by the gate helper) resolves without a DB round-trip. Both
    /// entries are required — miss either and the cached lookup falls
    /// through to the persistent DB (returns None), which would collapse
    /// "Admin" to "unknown user" and misreport the gate as too strict.
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
        ORG_USERS.insert(
            format!("{org_id}/{email}"),
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

    fn payload(key: &str, value: &str) -> SystemSettingPayload {
        SystemSettingPayload {
            setting_key: key.to_string(),
            setting_value: json!(value),
            setting_category: None,
            description: None,
        }
    }

    /// TC-8EBA40D2 (org-level POST):
    /// A `service_account`-role principal must NOT be able to create or
    /// overwrite an org-level v2 setting via
    /// `POST /api/{org_id}/settings/v2`. Fails on the unfixed handler
    /// (returned HTTP 200 and persisted the caller's payload) and passes
    /// once the handler rejects the caller with HTTP 403 before touching
    /// the store.
    #[tokio::test]
    async fn service_account_cannot_set_org_v2_setting() {
        let org = "org-v2-sys-set-sa";
        let sa = "sa-v2-set@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);

        let resp = set_org_setting_with_caller(org, sa, payload("theme", "dark")).await;
        assert_eq!(
            resp.status().as_u16(),
            403,
            "service_account must be blocked from setting org-level v2 settings"
        );
    }

    /// TC-8EBA40D2 (org-level DELETE):
    /// A `service_account`-role principal must NOT be able to delete an
    /// org-level v2 setting via `DELETE /api/{org_id}/settings/v2/{key}`.
    #[tokio::test]
    async fn service_account_cannot_delete_org_v2_setting() {
        let org = "org-v2-sys-del-sa";
        let sa = "sa-v2-del@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);

        let resp = delete_org_setting_with_caller(org, sa, "some_key").await;
        assert_eq!(
            resp.status().as_u16(),
            403,
            "service_account must be blocked from deleting org-level v2 settings"
        );
    }

    /// TC-F8888344 / TC-573B213C (user-level BFLA on POST):
    /// A caller must NOT be able to write user-level settings for a
    /// DIFFERENT user's account unless they hold Admin/Root. Fails on the
    /// unfixed handler (any authenticated org member could overwrite an
    /// admin's user-level settings) and passes once the handler enforces
    /// caller == target OR caller-is-admin.
    #[tokio::test]
    async fn service_account_cannot_set_v2_setting_for_another_user() {
        let org = "org-v2-sys-user-bfla-post";
        let sa = "sa-bfla-post@example.test";
        let victim = "admina-victim@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);
        seed_org_user(org, victim, UserRole::Admin);

        let resp =
            set_user_setting_with_caller(org, victim, sa, payload("pref_theme", "hacked")).await;
        assert_eq!(
            resp.status().as_u16(),
            403,
            "service_account must not overwrite another user's settings"
        );
    }

    /// TC-F8888344 / TC-573B213C (user-level BFLA on DELETE):
    /// Same invariant on the delete verb.
    #[tokio::test]
    async fn service_account_cannot_delete_v2_setting_for_another_user() {
        let org = "org-v2-sys-user-bfla-del";
        let sa = "sa-bfla-del@example.test";
        let victim = "admina-victim-del@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);
        seed_org_user(org, victim, UserRole::Admin);

        let resp = delete_user_setting_with_caller(org, victim, sa, "pref_theme").await;
        assert_eq!(
            resp.status().as_u16(),
            403,
            "service_account must not delete another user's settings"
        );
    }

    /// Self-mutation baseline: a non-admin caller writing user-level
    /// settings for THEMSELVES must NOT be blocked by the gate. This is
    /// the paired green legitimate case that proves the 403s above are the
    /// BFLA invariant, not a "reject everyone" over-fix. The call may
    /// return a non-200 later (DB unavailable in tests), but it must NOT
    /// be 403 — no auth rejection.
    #[tokio::test]
    async fn service_account_can_set_v2_setting_for_self_is_not_forbidden() {
        let org = "org-v2-sys-user-self";
        let sa = "sa-self@example.test";
        seed_org_user(org, sa, UserRole::ServiceAccount);

        let resp = set_user_setting_with_caller(org, sa, sa, payload("pref_theme", "dark")).await;
        assert_ne!(
            resp.status().as_u16(),
            403,
            "self-mutation of user-level settings must not be forbidden"
        );
    }

    /// Admin baseline for the org-level gate: an Admin-role caller MUST be
    /// allowed past the role gate on `POST /settings/v2` — so the 403s
    /// above are the role gate firing, not a broken environment. The call
    /// may return a non-200 later (DB unavailable in tests), but it must
    /// NOT be 403 — no auth rejection.
    #[tokio::test]
    async fn admin_is_not_forbidden_on_set_org_v2_setting() {
        let org = "org-v2-sys-set-admin";
        let admin = "admin-v2-set@example.test";
        seed_org_user(org, admin, UserRole::Admin);

        let resp = set_org_setting_with_caller(org, admin, payload("theme", "dark")).await;
        assert_ne!(
            resp.status().as_u16(),
            403,
            "Admin-role caller must not be blocked by the OSS role gate"
        );
    }

    // --- Test helpers ---------------------------------------------------
    //
    // Wrap the handler invocations so we assemble the handler args in one
    // place — if the handler signature evolves (e.g. an extra extractor
    // like `UserEmail` is added), only the helper changes, and every test
    // above still exercises the same intent.

    async fn set_org_setting_with_caller(
        org: &str,
        caller_user_id: &str,
        payload: SystemSettingPayload,
    ) -> axum::response::Response {
        set_org_setting(
            Path(org.to_string()),
            HeadersExtractor(UserEmail {
                user_id: caller_user_id.to_string(),
            }),
            Json(payload),
        )
        .await
    }

    async fn delete_org_setting_with_caller(
        org: &str,
        caller_user_id: &str,
        key: &str,
    ) -> axum::response::Response {
        delete_org_setting(
            Path((org.to_string(), key.to_string())),
            HeadersExtractor(UserEmail {
                user_id: caller_user_id.to_string(),
            }),
        )
        .await
    }

    async fn set_user_setting_with_caller(
        org: &str,
        target_user_id: &str,
        caller_user_id: &str,
        payload: SystemSettingPayload,
    ) -> axum::response::Response {
        set_user_setting(
            Path((org.to_string(), target_user_id.to_string())),
            HeadersExtractor(UserEmail {
                user_id: caller_user_id.to_string(),
            }),
            Json(payload),
        )
        .await
    }

    async fn delete_user_setting_with_caller(
        org: &str,
        target_user_id: &str,
        caller_user_id: &str,
        key: &str,
    ) -> axum::response::Response {
        delete_user_setting(
            Path((
                org.to_string(),
                target_user_id.to_string(),
                key.to_string(),
            )),
            HeadersExtractor(UserEmail {
                user_id: caller_user_id.to_string(),
            }),
        )
        .await
    }
}

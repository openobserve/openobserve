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
use config::meta::{
    system_settings::{SettingScope, SystemSetting, SystemSettingPayload, SystemSettingQuery},
    user::UserRole,
};
use db::system_settings;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Keys owned by endpoints with stricter authorization than the generic settings API.
fn is_reserved_key(key: &str) -> bool {
    key.trim()
        .to_ascii_lowercase()
        .starts_with(db::prompt_settings::PROMPT_SETTINGS_PREFIX)
}

fn reserved_key_response() -> Response {
    MetaHttpResponse::forbidden("This setting is managed by /prompts/settings")
}

/// Own settings are the caller's; another user's need root, Admin, or an OpenFGA users write.
async fn may_access_user_settings(org_id: &str, caller: &str, subject: &str) -> bool {
    if caller.eq_ignore_ascii_case(subject) || db::user::is_root_user(caller) {
        return true;
    }
    if matches!(
        openobserve_core::users::get_user(Some(org_id), caller).await,
        Some(user) if matches!(user.role, UserRole::Root | UserRole::Admin)
    ) {
        return true;
    }
    // With OpenFGA off `check_permissions` allows everyone, so only the role check above applies.
    openfga_enabled()
        && openobserve_core::auth::check_permissions(
            org_id, org_id, caller, "users", "PUT", None, true, false, false,
        )
        .await
}

#[cfg(feature = "enterprise")]
fn openfga_enabled() -> bool {
    o2_openfga::config::get_config().enabled
}

#[cfg(not(feature = "enterprise"))]
fn openfga_enabled() -> bool {
    false
}

fn foreign_user_response() -> Response {
    MetaHttpResponse::forbidden("Settings of another user require user administration")
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
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<SystemSettingQuery>,
) -> Response {
    let user_id = query.user_id.as_deref();
    if let Some(subject) = user_id
        && !may_access_user_settings(&org_id, &user_email.user_id, subject).await
    {
        return foreign_user_response();
    }

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
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<SystemSettingQuery>,
) -> Response {
    let user_id = query.user_id.as_deref();
    if let Some(subject) = user_id
        && !may_access_user_settings(&org_id, &user_email.user_id, subject).await
    {
        return foreign_user_response();
    }
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
    Json(payload): Json<SystemSettingPayload>,
) -> Response {
    if is_reserved_key(&payload.setting_key) {
        return reserved_key_response();
    }
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
    if is_reserved_key(&payload.setting_key) {
        return reserved_key_response();
    }
    if !may_access_user_settings(&org_id, &user_email.user_id, &user_id).await {
        return foreign_user_response();
    }
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
pub async fn delete_org_setting(Path((org_id, key)): Path<(String, String)>) -> Response {
    if is_reserved_key(&key) {
        return reserved_key_response();
    }
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
    if is_reserved_key(&key) {
        return reserved_key_response();
    }
    if !may_access_user_settings(&org_id, &user_email.user_id, &user_id).await {
        return foreign_user_response();
    }
    match system_settings::delete(&SettingScope::User, Some(&org_id), Some(&user_id), &key).await {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({"deleted": true}))).into_response(),
        Ok(false) => MetaHttpResponse::not_found("Setting not found"),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_settings_keys_are_reserved() {
        assert!(is_reserved_key("prompt_settings/default"));
        assert!(is_reserved_key(" PROMPT_SETTINGS/default"));
        assert!(!is_reserved_key("gen_ai_agent_mapping"));
        assert!(!is_reserved_key("my_prompt_settings/default"));
    }

    #[tokio::test]
    async fn generic_api_rejects_prompt_settings_writes() {
        let payload = || {
            Json(SystemSettingPayload {
                setting_key: "prompt_settings/default".to_string(),
                setting_value: serde_json::json!({"protectedLabels": ["x"]}),
                setting_category: None,
                description: None,
            })
        };
        let key = "prompt_settings/default".to_string();
        let org = "default".to_string();
        for response in [
            set_org_setting(Path(org.clone()), payload()).await,
            set_user_setting(
                Path((org.clone(), "u@x.com".to_string())),
                caller("u@x.com"),
                payload(),
            )
            .await,
            delete_org_setting(Path((org.clone(), key.clone()))).await,
            delete_user_setting(
                Path((org.clone(), "u@x.com".to_string(), key.clone())),
                caller("u@x.com"),
            )
            .await,
        ] {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }

    fn caller(email: &str) -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: email.to_string(),
        })
    }

    fn join(org_id: &str, email: &str, role: UserRole) {
        common::infra::config::USERS.insert(
            email.to_string(),
            infra::table::users::UserRecord {
                email: email.to_string(),
                first_name: "F".to_string(),
                last_name: "L".to_string(),
                password: "hash".to_string(),
                salt: "salt".to_string(),
                is_root: false,
                password_ext: None,
                user_type: config::meta::user::UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        common::infra::config::ORG_USERS.insert(
            format!("{org_id}/{email}"),
            infra::table::org_users::OrgUserRecord {
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

    async fn seed_user_setting(org_id: &str, user_id: &str, key: &str) {
        common::infra::config::SYSTEM_SETTINGS.write().await.insert(
            format!("user:{org_id}:{user_id}:{key}"),
            SystemSetting::new_user(org_id, user_id, key, serde_json::json!({"secret": user_id})),
        );
    }

    fn user_query(user_id: &str) -> Query<SystemSettingQuery> {
        Query(serde_json::from_value(serde_json::json!({ "user_id": user_id })).unwrap())
    }

    #[tokio::test]
    async fn user_settings_of_another_user_are_forbidden() {
        let org = "settings-idor-org";
        let (viewer, victim) = ("viewer@settings-idor.test", "victim@settings-idor.test");
        join(org, viewer, UserRole::Viewer);
        seed_user_setting(org, victim, "favorite_dashboards").await;

        let read = get_setting(
            Path((org.to_string(), "favorite_dashboards".to_string())),
            caller(viewer),
            user_query(victim),
        )
        .await;
        assert_eq!(read.status(), StatusCode::FORBIDDEN);

        let list = list_settings(Path(org.to_string()), caller(viewer), user_query(victim)).await;
        assert_eq!(list.status(), StatusCode::FORBIDDEN);

        let write = set_user_setting(
            Path((org.to_string(), victim.to_string())),
            caller(viewer),
            Json(SystemSettingPayload {
                setting_key: "favorite_dashboards".to_string(),
                setting_value: serde_json::json!([]),
                setting_category: None,
                description: None,
            }),
        )
        .await;
        assert_eq!(write.status(), StatusCode::FORBIDDEN);

        let delete = delete_user_setting(
            Path((
                org.to_string(),
                victim.to_string(),
                "favorite_dashboards".to_string(),
            )),
            caller(viewer),
        )
        .await;
        assert_eq!(delete.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn user_settings_of_the_caller_are_readable() {
        let org = "settings-own-org";
        let viewer = "viewer@settings-own.test";
        join(org, viewer, UserRole::Viewer);
        seed_user_setting(org, viewer, "favorite_dashboards").await;

        let read = get_setting(
            Path((org.to_string(), "favorite_dashboards".to_string())),
            caller(viewer),
            user_query(viewer),
        )
        .await;
        assert_eq!(read.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn user_settings_of_another_user_are_open_to_an_admin() {
        let org = "settings-admin-org";
        let (admin, member) = ("admin@settings-admin.test", "member@settings-admin.test");
        join(org, admin, UserRole::Admin);
        seed_user_setting(org, member, "favorite_dashboards").await;

        let read = get_setting(
            Path((org.to_string(), "favorite_dashboards".to_string())),
            caller(admin),
            user_query(member),
        )
        .await;
        assert_eq!(read.status(), StatusCode::OK);
    }
}

// Copyright 2025 OpenObserve Inc.
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

use std::io::Error as StdErr;

use actix_web::{HttpResponse, delete, get, post, web};
use config::meta::system_settings::{
    SettingScope, SystemSetting, SystemSettingPayload, SystemSettingQuery,
};

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::db::system_settings};

/// Get a specific system setting with resolution (user -> org -> system)
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "SystemSettingGetResolved",
    summary = "Get resolved system setting",
    description = "Retrieves a setting value with multi-level resolution. Checks user-level first, \
                   then org-level, then system-level defaults. Returns the most specific setting found.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Setting key"),
        ("user_id" = Option<String>, Query, description = "User ID for user-level resolution"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SystemSetting),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"}))
    )
)]
#[get("/{org_id}/settings/v2/{key}")]
async fn get_setting(
    path: web::Path<(String, String)>,
    query: web::Query<SystemSettingQuery>,
) -> Result<HttpResponse, StdErr> {
    let (org_id, key) = path.into_inner();
    let user_id = query.user_id.as_deref();

    match system_settings::get_resolved(Some(&org_id), user_id, &key).await {
        Ok(Some(setting)) => Ok(HttpResponse::Ok().json(setting)),
        Ok(None) => Ok(MetaHttpResponse::not_found("Setting not found")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/// List all resolved settings for an organization/user
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "list"}))
    )
)]
#[get("/{org_id}/settings/v2")]
async fn list_settings(
    path: web::Path<String>,
    query: web::Query<SystemSettingQuery>,
) -> Result<HttpResponse, StdErr> {
    let org_id = path.into_inner();
    let user_id = query.user_id.as_deref();
    let category = query.category.as_deref();

    match system_settings::list_resolved(Some(&org_id), user_id, category).await {
        Ok(settings) => Ok(HttpResponse::Ok().json(settings)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/// Create or update a setting at org level
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"}))
    )
)]
#[post("/{org_id}/settings/v2")]
async fn set_org_setting(
    path: web::Path<String>,
    payload: web::Json<SystemSettingPayload>,
) -> Result<HttpResponse, StdErr> {
    let org_id = path.into_inner();
    let payload = payload.into_inner();

    let mut setting = SystemSetting::new_org(&org_id, &payload.setting_key, payload.setting_value);
    if let Some(cat) = payload.setting_category.as_deref() {
        setting.setting_category = Some(cat.to_string());
    }
    if let Some(desc) = payload.description.as_deref() {
        setting.description = Some(desc.to_string());
    }

    match system_settings::set(&setting).await {
        Ok(result) => Ok(HttpResponse::Ok().json(result)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/// Create or update a setting at user level
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"}))
    )
)]
#[post("/{org_id}/settings/v2/user/{user_id}")]
async fn set_user_setting(
    path: web::Path<(String, String)>,
    payload: web::Json<SystemSettingPayload>,
) -> Result<HttpResponse, StdErr> {
    let (org_id, user_id) = path.into_inner();
    let payload = payload.into_inner();

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
        Ok(result) => Ok(HttpResponse::Ok().json(result)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/// Delete an organization-level setting
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/settings/v2/{key}")]
async fn delete_org_setting(path: web::Path<(String, String)>) -> Result<HttpResponse, StdErr> {
    let (org_id, key) = path.into_inner();

    match system_settings::delete(&SettingScope::Org, Some(&org_id), None, &key).await {
        Ok(true) => Ok(HttpResponse::Ok().json(serde_json::json!({"deleted": true}))),
        Ok(false) => Ok(MetaHttpResponse::not_found("Setting not found")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/// Delete a user-level setting
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/settings/v2/user/{user_id}/{key}")]
async fn delete_user_setting(
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, StdErr> {
    let (org_id, user_id, key) = path.into_inner();

    match system_settings::delete(&SettingScope::User, Some(&org_id), Some(&user_id), &key).await {
        Ok(true) => Ok(HttpResponse::Ok().json(serde_json::json!({"deleted": true}))),
        Ok(false) => Ok(MetaHttpResponse::not_found("Setting not found")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

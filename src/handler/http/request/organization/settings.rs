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

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use infra::errors::{DbError, Error};
#[cfg(feature = "enterprise")]
use {
    axum::extract::{Multipart, Query},
    o2_enterprise::enterprise::common::settings,
};

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                OrganizationSetting, OrganizationSettingPayload, OrganizationSettingResponse,
            },
        },
        utils::auth::UserEmail,
    },
    handler::http::extractors::Headers,
    service::db::organization::{get_org_setting, set_org_setting},
};

/// Organization specific settings

#[utoipa::path(
    post,
    path = "/{org_id}/settings",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSettingCreate",
    summary = "Update organization settings",
    description = "Creates or updates organization-specific settings such as scrape interval, trace field names, ingestion \
                   toggles, and streaming configurations. Allows administrators to customize organizational behavior and \
                   operational parameters to match specific requirements and use cases.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(OrganizationSettingPayload), description = "Organization settings", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create/update org settings", "category": "users"}))
    )
)]
pub async fn create(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(settings): Json<OrganizationSettingPayload>,
) -> Response {
    // Non-enterprise: no RBAC middleware, so enforce Admin/Root role explicitly here.
    #[cfg(not(feature = "enterprise"))]
    if let Err(resp) = crate::handler::http::auth::oss_role_gate::assert_admin_role(
        &org_id,
        &user_email.user_id,
    )
    .await
    {
        return resp;
    }
    let _ = &user_email; // silence unused warning on enterprise builds

    let mut data = match get_org_setting(&org_id).await {
        Ok(data) => data,
        Err(err) => {
            if let Error::DbError(DbError::KeyNotExists(_e)) = &err {
                OrganizationSetting::default()
            } else {
                return MetaHttpResponse::bad_request(&err);
            }
        }
    };

    let mut field_found = false;
    if let Some(scrape_interval) = settings.scrape_interval {
        if scrape_interval == 0 {
            return MetaHttpResponse::bad_request("scrape_interval should be a positive value");
        }
        field_found = true;
        data.scrape_interval = scrape_interval;
    }
    if let Some(trace_id_field_name) = settings.trace_id_field_name {
        field_found = true;
        data.trace_id_field_name = trace_id_field_name;
    }
    if let Some(span_id_field_name) = settings.span_id_field_name {
        field_found = true;
        data.span_id_field_name = span_id_field_name;
    }
    if let Some(toggle_ingestion_logs) = settings.toggle_ingestion_logs {
        field_found = true;
        data.toggle_ingestion_logs = toggle_ingestion_logs;
    }

    if let Some(enable_streaming_search) = settings.enable_streaming_search {
        field_found = true;
        data.enable_streaming_search = enable_streaming_search;
    }

    if let Some(light_mode_theme_color) = settings.light_mode_theme_color {
        field_found = true;
        data.light_mode_theme_color = Some(light_mode_theme_color);
    }

    if let Some(dark_mode_theme_color) = settings.dark_mode_theme_color {
        field_found = true;
        data.dark_mode_theme_color = Some(dark_mode_theme_color);
    }

    if let Some(max_series_per_query) = settings.max_series_per_query {
        // Validate max_series_per_query is within acceptable range
        if !(1_000..=1_000_000).contains(&max_series_per_query) {
            return MetaHttpResponse::bad_request(
                "max_series_per_query must be between 1,000 and 1,000,000",
            );
        }
        field_found = true;
        data.max_series_per_query = Some(max_series_per_query);
    }

    #[cfg(feature = "enterprise")]
    if let Some(claim_parser_function) = settings.claim_parser_function {
        field_found = true;
        data.claim_parser_function = claim_parser_function;
    }

    if let Some(usage_stream_enabled) = settings.usage_stream_enabled {
        field_found = true;
        data.usage_stream_enabled = usage_stream_enabled;
    }

    if let Some(cross_links) = settings.cross_links {
        for link in &cross_links {
            if link.name.is_empty() {
                return MetaHttpResponse::bad_request("Cross-link name is required");
            }
            if link.name.len() > 256 {
                return MetaHttpResponse::bad_request(
                    "Cross-link name must be 256 characters or less",
                );
            }
            if link.url.is_empty() {
                return MetaHttpResponse::bad_request("Cross-link URL is required");
            }
        }
        field_found = true;
        data.cross_links = cross_links;
    }

    if !field_found {
        return MetaHttpResponse::bad_request("No valid field found");
    }

    // this will always be taken from orgs table, never from settings
    data.free_trial_expiry = None;
    match set_org_setting(&org_id, &data).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::bad_request(e.to_string().as_str()),
    }
}

/// Retrieve organization specific settings

#[utoipa::path(
    get,
    path = "/{org_id}/settings",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSettingGet",
    summary = "Get organization settings",
    description = "Retrieves the current configuration settings for an organization, including scrape intervals, field \
                   mappings, ingestion preferences, and streaming options. Returns default settings if none have been \
                   configured previously for the organization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get organization settings", "category": "users"}))
    )
)]
pub async fn get(Path(org_id): Path<String>) -> Response {
    match get_org_setting(&org_id).await {
        Ok(data) => (StatusCode::OK, Json(OrganizationSettingResponse { data })).into_response(),
        Err(err) => {
            if let Error::DbError(DbError::KeyNotExists(_e)) = &err {
                let setting = OrganizationSetting::default();
                if let Ok(()) = set_org_setting(&org_id, &setting).await {
                    return (
                        StatusCode::OK,
                        Json(OrganizationSettingResponse { data: setting }),
                    )
                        .into_response();
                }
            };
            MetaHttpResponse::bad_request(&err)
        }
    }
}

#[cfg(feature = "enterprise")]
pub async fn upload_logo(
    Query(query): Query<std::collections::HashMap<String, String>>,
    mut payload: Multipart,
) -> Response {
    let theme = query.get("theme").map(|s| s.to_string());

    let mut data: Vec<u8> = Vec::<u8>::new();
    while let Ok(Some(field)) = payload.next_field().await {
        if let Ok(bytes) = field.bytes().await {
            data.extend(bytes);
        }
    }

    if data.is_empty() {
        return MetaHttpResponse::bad_request("Image data not present");
    }

    match settings::upload_logo(data, theme).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn upload_logo() -> Response {
    (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
}

#[cfg(feature = "enterprise")]
pub async fn delete_logo(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let theme = query.get("theme").map(|s| s.to_string());

    match settings::delete_logo(theme).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn delete_logo() -> Response {
    (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
}

#[cfg(feature = "enterprise")]
pub async fn set_logo_text(body: axum::body::Bytes) -> Response {
    match settings::set_logo_text(body).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn set_logo_text() -> Response {
    (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
}

#[cfg(feature = "enterprise")]
pub async fn delete_logo_text() -> Response {
    match settings::delete_logo_text().await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn delete_logo_text() -> Response {
    (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
}

#[cfg(test)]
mod tests {
    /// Regression: OSS `POST /api/{org}/settings` must reject a
    /// `service_account`-role caller with HTTP 403 before mutating any
    /// org-level setting. Fails on the unfixed handler (which returned 200
    /// and persisted the caller's `scrape_interval`) and passes once the
    /// handler calls `oss_role_gate::assert_admin_role`.
    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn service_account_cannot_mutate_org_settings_regression() {
        use axum::extract::Path;
        use config::meta::user::UserRole;
        use infra::table::org_users::OrgUserRecord;

        use super::create;
        use crate::{
            common::{
                infra::config::ORG_USERS,
                meta::organization::OrganizationSettingPayload,
                utils::auth::UserEmail,
            },
            handler::http::extractors::Headers as HeadersExtractor,
        };

        let org = "org-settings-regression";
        let sa_email = "settings-sa-regression@example.test";
        let key = format!("{org}/{sa_email}");
        ORG_USERS.insert(
            key,
            OrgUserRecord {
                email: sa_email.to_string(),
                org_id: org.to_string(),
                role: UserRole::ServiceAccount,
                token: "test-token".to_string(),
                rum_token: None,
                created_at: 0,
                allow_static_token: true,
            },
        );

        let payload = OrganizationSettingPayload {
            scrape_interval: Some(7777),
            trace_id_field_name: None,
            span_id_field_name: None,
            toggle_ingestion_logs: None,
            streaming_aggregation_enabled: None,
            enable_streaming_search: None,
            min_auto_refresh_interval: None,
            light_mode_theme_color: None,
            dark_mode_theme_color: None,
            max_series_per_query: None,
            usage_stream_enabled: None,
            cross_links: None,
        };
        let resp = create(
            Path(org.to_string()),
            HeadersExtractor(UserEmail {
                user_id: sa_email.to_string(),
            }),
            axum::Json(payload),
        )
        .await;

        assert_eq!(
            resp.status().as_u16(),
            403,
            "OSS service_account must be blocked from mutating org settings"
        );
    }

    #[test]
    fn test_max_series_per_query_validation_valid_values() {
        // Test minimum valid value
        let value = 1_000;
        assert!((1_000..=1_000_000).contains(&value));

        // Test maximum valid value
        let value = 1_000_000;
        assert!((1_000..=1_000_000).contains(&value));

        // Test mid-range value (default)
        let value = 40_000;
        assert!((1_000..=1_000_000).contains(&value));

        // Test another mid-range value
        let value = 500_000;
        assert!((1_000..=1_000_000).contains(&value));
    }

    #[test]
    fn test_max_series_per_query_validation_invalid_values() {
        // Test below minimum
        let value = 999;
        assert!(!(1_000..=1_000_000).contains(&value));

        // Test above maximum
        let value = 1_000_001;
        assert!(!(1_000..=1_000_000).contains(&value));

        // Test zero
        let value = 0;
        assert!(!(1_000..=1_000_000).contains(&value));

        // Test very large value
        let value = 10_000_000;
        assert!(!(1_000..=1_000_000).contains(&value));

        // Test value just below minimum
        let value = 500;
        assert!(!(1_000..=1_000_000).contains(&value));
    }
}

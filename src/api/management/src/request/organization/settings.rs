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
use db::organization::{get_org_setting, set_org_setting};
use infra::errors::{DbError, Error};
#[cfg(feature = "enterprise")]
use {
    axum::extract::{Multipart, Query},
    o2_enterprise::enterprise::common::settings,
};
#[cfg(feature = "cloud")]
use {
    config::META_ORG_ID,
    o2_enterprise::enterprise::cloud::{
        billing_group::list_billing_group_members_of, billings::MeteringProvider, customer_billings,
    },
    std::collections::HashSet,
};

use crate::common::meta::{
    http::HttpResponse as MetaHttpResponse,
    organization::{OrganizationSetting, OrganizationSettingPayload, OrganizationSettingResponse},
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
    Json(settings): Json<OrganizationSettingPayload>,
) -> Response {
    if let Err(msg) = validate_settings_payload(&settings) {
        return MetaHttpResponse::bad_request(msg);
    }
    #[cfg(feature = "cloud")]
    let settings = match check_domain_org_mappings(&org_id, settings).await {
        Ok(settings) => settings,
        Err(refusal) => return refusal,
    };
    #[cfg(feature = "cloud")]
    if let Err(response) = check_budget_config(&org_id, &settings).await {
        return response;
    }

    match db::organization::update_org_setting(&org_id, |data| {
        apply_settings_payload(data, settings)
    })
    .await
    {
        Ok(true) => (
            StatusCode::OK,
            Json(serde_json::json!({"successful": "true"})),
        )
            .into_response(),
        Ok(false) => MetaHttpResponse::bad_request("No valid field found"),
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
        Ok(data) => (
            StatusCode::OK,
            Json(OrganizationSettingResponse {
                data: without_ai(data),
            }),
        )
            .into_response(),
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

fn validate_settings_payload(settings: &OrganizationSettingPayload) -> Result<(), &'static str> {
    if settings.scrape_interval == Some(0) {
        return Err("scrape_interval should be a positive value");
    }
    if let Some(max_series_per_query) = settings.max_series_per_query
        && !(1_000..=1_000_000).contains(&max_series_per_query)
    {
        return Err("max_series_per_query must be between 1,000 and 1,000,000");
    }
    for link in settings.cross_links.iter().flatten() {
        if link.name.is_empty() {
            return Err("Cross-link name is required");
        }
        if link.name.len() > 256 {
            return Err("Cross-link name must be 256 characters or less");
        }
        if link.url.is_empty() {
            return Err("Cross-link URL is required");
        }
    }
    Ok(())
}

// ignore this for all non _meta orgs
#[cfg(feature = "cloud")]
async fn check_domain_org_mappings(
    org_id: &str,
    mut settings: OrganizationSettingPayload,
) -> Result<OrganizationSettingPayload, Response> {
    let Some(mut mappings) = settings.domain_org_mappings.take() else {
        return Ok(settings);
    };
    if org_id != META_ORG_ID {
        return Ok(settings);
    }
    for mapping in &mut mappings {
        // A deleted org keeps its row as a tombstone, so the row alone does not make it a target.
        match db::org_status::read_active(&mapping.org_id).await {
            Ok(true) => {}
            Ok(false) => return Err(inactive_mapping_target(&mapping.org_id).await),
            Err(e) => {
                return Err(MetaHttpResponse::internal_error(format!(
                    "cannot read the status of org {}: {e}",
                    mapping.org_id
                )));
            }
        }

        if mapping.domain.is_empty() || mapping.domain.contains(' ') {
            return Err(MetaHttpResponse::bad_request(format!(
                "domain cannot have space or be empty, bad domain '{}'",
                mapping.domain
            )));
        }

        if !matches!(
            mapping.base_role.as_str(),
            "admin" | "editor" | "viewer" | "allowed_user"
        ) {
            return Err(MetaHttpResponse::bad_request(format!(
                "base role {} for org {} is not a valid base role - only admin, editor, viewer, allowed_user are supported",
                mapping.base_role, mapping.org_id
            )));
        }
        if let Some(claim) = mapping.role_claim_name.as_mut() {
            if claim.trim().is_empty() {
                return Err(MetaHttpResponse::bad_request(
                    "role claim name must not be empty",
                ));
            }
            *claim = claim.trim().to_string();
        }

        mapping.domain = mapping.domain.to_lowercase();
    }
    settings.domain_org_mappings = Some(mappings);
    Ok(settings)
}

/// The refusal for a mapping whose target org is not active: missing, blocked, or unreadable.
#[cfg(feature = "cloud")]
async fn inactive_mapping_target(org_id: &str) -> Response {
    match infra::table::organizations::find(org_id).await {
        Ok(None) => MetaHttpResponse::bad_request(format!("No org with org id {org_id} found")),
        Ok(Some(_)) => MetaHttpResponse::bad_request(format!("org {org_id} is not active")),
        Err(e) => MetaHttpResponse::internal_error(format!("cannot read org {org_id}: {e}")),
    }
}

// Budgets are for Stripe-billed orgs only, and only for this org, its group members and the
// group total; checked before the settings lock, since it reads billing and group tables.
#[cfg(feature = "cloud")]
async fn check_budget_config(
    org_id: &str,
    settings: &OrganizationSettingPayload,
) -> Result<(), Response> {
    let Some(configs) = settings.budget_config.as_ref() else {
        return Ok(());
    };
    let billings = match customer_billings::get_by_org_id(org_id).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error getting customer billings for org_id {org_id} : {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    if !billings
        .first()
        .is_some_and(|v| v.provider == MeteringProvider::Stripe)
    {
        return Err(MetaHttpResponse::bad_request(
            "this org is not configured with stripe billing, so budget cannot be set".to_string(),
        ));
    }
    let child_orgs = match list_billing_group_members_of(org_id).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in getting child orgs of {org_id} for budget config update : {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let mut allowed_orgs: HashSet<_> = child_orgs.into_iter().map(|v| v.member_org_id).collect();
    allowed_orgs.insert(org_id.to_string());
    allowed_orgs.insert("total".to_string()); // special indicator for total of super org
    if let Some(config) = configs.iter().find(|c| !allowed_orgs.contains(&c.org_id)) {
        return Err(MetaHttpResponse::bad_request(format!(
            "cannot set budget notification configuration for org {}",
            config.org_id
        )));
    }
    for config in configs {
        if config.total_budget_amount <= 0.0 {
            return Err(MetaHttpResponse::bad_request(format!(
                "cannot set budget amount less than 0 for org {}",
                config.org_id
            )));
        }
        if config.warn_at_amount <= 0.0 || config.warn_at_amount > config.total_budget_amount {
            return Err(MetaHttpResponse::bad_request(format!(
                "invalid warning amount for org {}",
                config.org_id
            )));
        }
    }
    Ok(())
}

// Runs under the settings lock on a fresh read, so it must not await or fail.
fn apply_settings_payload(
    data: &mut OrganizationSetting,
    settings: OrganizationSettingPayload,
) -> bool {
    let mut field_found = false;
    if let Some(scrape_interval) = settings.scrape_interval {
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
    if merge_red_insights_enabled(data, settings.red_insights_enabled) {
        field_found = true;
    }
    if let Some(ai_rca_thread_tool_output) = settings.ai_rca_thread_tool_output {
        field_found = true;
        data.ai_rca_thread_tool_output = ai_rca_thread_tool_output;
    }
    if let Some(cross_links) = settings.cross_links {
        field_found = true;
        data.cross_links = cross_links;
    }
    #[cfg(feature = "cloud")]
    if let Some(mappings) = settings.domain_org_mappings {
        field_found = true;
        data.domain_org_mappings = mappings;
    }
    #[cfg(feature = "cloud")]
    if let Some(configs) = settings.budget_config {
        field_found = true;
        data.budget_config = configs;
    }
    // this will always be taken from orgs table, never from settings
    data.free_trial_expiry = None;
    field_found
}

/// `ai` is read only through `/ai/settings`, which hides all but `enabled` from non-admins.
fn without_ai(mut data: OrganizationSetting) -> OrganizationSetting {
    data.ai = None;
    data
}

fn merge_red_insights_enabled(data: &mut OrganizationSetting, value: Option<bool>) -> bool {
    let Some(enabled) = value else {
        return false;
    };
    data.red_insights_enabled = enabled;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_general_settings_read_never_carries_the_assistant_settings() {
        let data = OrganizationSetting {
            ai: Some(Default::default()),
            ..Default::default()
        };
        let body = serde_json::to_value(OrganizationSettingResponse {
            data: without_ai(data),
        })
        .unwrap();
        assert!(body["data"].get("ai").is_none(), "{body}");
    }

    #[test]
    fn test_merge_red_insights_enabled_sets_and_leaves() {
        let mut data = OrganizationSetting::default();
        assert!(!merge_red_insights_enabled(&mut data, None));
        assert!(!data.red_insights_enabled);
        assert!(merge_red_insights_enabled(&mut data, Some(true)));
        assert!(data.red_insights_enabled);
        assert!(!merge_red_insights_enabled(&mut data, None));
        assert!(data.red_insights_enabled);
        assert!(merge_red_insights_enabled(&mut data, Some(false)));
        assert!(!data.red_insights_enabled);
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

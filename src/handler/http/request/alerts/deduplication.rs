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

//! Alert deduplication API endpoints (Enterprise feature)

use axum::{Json, extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use config::meta::alerts::deduplication::GlobalDeduplicationConfig;
#[cfg(feature = "enterprise")]
use config::meta::correlation::SemanticFieldGroup;

#[cfg(feature = "enterprise")]
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Get deduplication configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = GlobalDeduplicationConfig),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn get_config(Path(org_id): Path<String>) -> Response {
    match crate::service::alerts::org_config::get_deduplication_config(&org_id).await {
        Ok(Some(config)) => axum::response::Response::builder()
            .status(axum::http::StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_string(&config).unwrap(),
            ))
            .unwrap(),
        Ok(None) => MetaHttpResponse::json(GlobalDeduplicationConfig::default_with_presets()),
        Err(e) => {
            log::error!("Error getting deduplication config for org {org_id}: {e}");

            MetaHttpResponse::internal_error(format!("Failed to get deduplication config: {e}"))
        }
    }
}

/// Get deduplication configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
pub async fn get_config(_org_id: Path<String>) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

/// Set deduplication configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SetDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = GlobalDeduplicationConfig, description = "Deduplication configuration", content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn set_config(
    Path(org_id): Path<String>,
    Json(config): Json<GlobalDeduplicationConfig>,
) -> Response {
    match crate::service::alerts::org_config::set_deduplication_config(&org_id, &config).await {
        Ok(()) => MetaHttpResponse::ok("Deduplication config saved successfully"),
        Err(e) => {
            log::error!("Error setting deduplication config for org {org_id}: {e}");
            MetaHttpResponse::internal_error(format!("Failed to set deduplication config: {e}"))
        }
    }
}

/// Set deduplication configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SetDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn set_config(_org_id: Path<String>, _config: Json<serde_json::Value>) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

/// Delete deduplication configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn delete_config(Path(org_id): Path<String>) -> Response {
    match crate::service::alerts::org_config::delete_deduplication_config(&org_id).await {
        Ok(()) => axum::response::Response::builder()
            .status(axum::http::StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::json!({
                    "message": "Deduplication config deleted successfully"
                })
                .to_string(),
            ))
            .unwrap(),
        Err(e) => {
            log::error!("Error deleting deduplication config for org {org_id}: {e}");
            MetaHttpResponse::internal_error(format!("Failed to delete deduplication config: {e}"))
        }
    }
}

/// Delete deduplication configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/deduplication/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteDeduplicationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
pub async fn delete_config(_org_id: Path<String>) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

// ==================== SEMANTIC GROUPS MANAGEMENT ====================

#[cfg(feature = "enterprise")]
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct SemanticGroupDiff {
    /// Groups that exist in the imported JSON but not in DB (new)
    pub additions: Vec<SemanticFieldGroup>,
    /// Groups that exist in both but have different content
    pub modifications: Vec<SemanticGroupModification>,
    /// Groups that are identical in both
    pub unchanged: Vec<SemanticFieldGroup>,
}

#[cfg(feature = "enterprise")]
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct SemanticGroupModification {
    /// Current version in DB
    pub current: SemanticFieldGroup,
    /// New version from import
    pub proposed: SemanticFieldGroup,
}

/// Get semantic field groups for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/deduplication/semantic-groups",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetSemanticGroups",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = Vec<SemanticFieldGroup>),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn get_semantic_groups(Path(org_id): Path<String>) -> Response {
    // Use system_settings which has proper caching and cluster watch
    let groups = crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;
    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::to_string(&groups).unwrap(),
        ))
        .unwrap()
}

/// Get semantic field groups (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/deduplication/semantic-groups",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetSemanticGroups",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
pub async fn get_semantic_groups(_org_id: Path<String>) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

/// Preview diff between imported semantic groups and current DB state
///
/// This endpoint compares the provided semantic groups with what's currently stored
/// and returns a diff showing additions, modifications, and unchanged groups.
/// The UI can use this to show users what will change before they commit.
#[cfg(feature = "enterprise")]
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/deduplication/semantic-groups/preview-diff",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "PreviewSemanticGroupsDiff",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = Vec<SemanticFieldGroup>, description = "Semantic groups to compare", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = SemanticGroupDiff),
        (status = 400, description = "Bad request - Invalid semantic groups"),
        (status = 500, description = "Internal server error"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn preview_semantic_groups_diff(
    Path(org_id): Path<String>,
    Json(proposed_groups): Json<Vec<SemanticFieldGroup>>,
) -> Response {
    // Validate all group IDs
    for group in &proposed_groups {
        if !SemanticFieldGroup::validate_id(&group.id) {
            return axum::response::Response::builder()
                .status(axum::http::StatusCode::BAD_REQUEST)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({
                        "error": format!("Invalid semantic group ID: '{}'. IDs must be lowercase, alphanumeric, dash-separated", group.id)
                    }).to_string(),
                ))
                .unwrap();
        }
    }

    // Get current groups from system_settings (with caching)
    let current_groups =
        crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;

    // Build a map of current groups by ID
    let current_map: std::collections::HashMap<String, &SemanticFieldGroup> =
        current_groups.iter().map(|g| (g.id.clone(), g)).collect();

    let mut additions = Vec::new();
    let mut modifications = Vec::new();
    let mut unchanged = Vec::new();

    for proposed_group in &proposed_groups {
        match current_map.get(&proposed_group.id) {
            Some(current_group) => {
                if current_group != &proposed_group {
                    // Modified
                    modifications.push(SemanticGroupModification {
                        current: (*current_group).clone(),
                        proposed: proposed_group.clone(),
                    });
                } else {
                    // Unchanged
                    unchanged.push(proposed_group.clone());
                }
            }
            None => {
                // New group
                additions.push(proposed_group.clone());
            }
        }
    }

    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::to_string(&SemanticGroupDiff {
                additions,
                modifications,
                unchanged,
            })
            .unwrap(),
        ))
        .unwrap()
}

/// Preview diff (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/deduplication/semantic-groups/preview-diff",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "PreviewSemanticGroupsDiff",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn preview_semantic_groups_diff(
    _org_id: Path<String>,
    _proposed_groups: Json<serde_json::Value>,
) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

/// Save semantic field groups for an organization
///
/// Merges provided groups with existing ones:
/// - Groups with matching IDs are updated (replaced)
/// - New groups (no matching ID) are added
/// - Existing groups not in the request are preserved
#[cfg(feature = "enterprise")]
#[utoipa::path(
    put,
    path = "/{org_id}/alerts/deduplication/semantic-groups",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SaveSemanticGroups",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = Vec<SemanticFieldGroup>, description = "Semantic groups to save (merged with existing)", content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request - Invalid semantic groups"),
        (status = 500, description = "Internal server error"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn save_semantic_groups(
    Path(org_id): Path<String>,
    Json(groups): Json<Vec<SemanticFieldGroup>>,
) -> Response {
    use config::meta::system_settings::{
        SettingCategory, SystemSetting, keys::SEMANTIC_FIELD_GROUPS,
    };

    let incoming_groups = groups;

    // Validate all group IDs
    for group in &incoming_groups {
        if !SemanticFieldGroup::validate_id(&group.id) {
            return axum::response::Response::builder()
                .status(axum::http::StatusCode::BAD_REQUEST)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({
                        "error": format!("Invalid semantic group ID: '{}'. IDs must be lowercase, alphanumeric, dash-separated", group.id)
                    }).to_string(),
                ))
                .unwrap();
        }
    }

    // Get existing groups from system_settings (with caching)
    let existing_groups =
        crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;

    // Merge incoming groups with existing ones
    // Build a map of incoming groups by ID for quick lookup
    let incoming_map: std::collections::HashMap<String, SemanticFieldGroup> = incoming_groups
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();

    // Update existing groups if they're in incoming, keep others unchanged
    let mut merged_groups: Vec<SemanticFieldGroup> = existing_groups
        .into_iter()
        .map(|existing| {
            if let Some(updated) = incoming_map.get(&existing.id) {
                updated.clone()
            } else {
                existing
            }
        })
        .collect();

    // Add new groups that don't exist in current config
    let existing_ids: std::collections::HashSet<String> =
        merged_groups.iter().map(|g| g.id.clone()).collect();
    for (id, group) in incoming_map {
        if !existing_ids.contains(&id) {
            merged_groups.push(group);
        }
    }

    let total_groups = merged_groups.len();

    // Save to system_settings table (with caching and cluster watch)
    let setting = SystemSetting::new_org(
        &org_id,
        SEMANTIC_FIELD_GROUPS,
        serde_json::to_value(&merged_groups).unwrap_or_default(),
    )
    .with_category(SettingCategory::Correlation);

    match crate::service::db::system_settings::set(&setting).await {
        Ok(_) => axum::response::Response::builder()
            .status(axum::http::StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::json!({
                    "message": "Semantic groups saved successfully",
                    "total_groups": total_groups
                })
                .to_string(),
            ))
            .unwrap(),
        Err(e) => {
            log::error!("Error saving semantic groups for org {org_id}: {e}");
            MetaHttpResponse::internal_error(format!("Failed to save semantic groups: {e}"))
        }
    }
}

/// Save semantic groups (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    put,
    path = "/{org_id}/alerts/deduplication/semantic-groups",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SaveSemanticGroups",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn save_semantic_groups(
    _org_id: Path<String>,
    _groups: Json<serde_json::Value>,
) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

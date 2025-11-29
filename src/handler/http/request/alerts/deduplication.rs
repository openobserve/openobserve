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

//! Alert deduplication API endpoints (Enterprise feature)

use actix_web::{HttpResponse, delete, get, post, put, web};
#[cfg(feature = "enterprise")]
use config::meta::alerts::deduplication::{GlobalDeduplicationConfig, SemanticFieldGroup};

// ==================== ENTERPRISE IMPLEMENTATIONS ====================

/// Get deduplication configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
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
#[get("/{org_id}/alerts/deduplication/config")]
pub async fn get_config(org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    match crate::service::alerts::org_config::get_deduplication_config(&org_id).await {
        Ok(Some(config)) => Ok(HttpResponse::Ok().json(config)),
        Ok(None) => Ok(HttpResponse::Ok().json(GlobalDeduplicationConfig::default_with_presets())),
        Err(e) => {
            log::error!(
                "Error getting deduplication config for org {}: {}",
                org_id,
                e
            );
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get deduplication config: {}", e)
            })))
        }
    }
}

/// Get deduplication configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
#[get("/{org_id}/alerts/deduplication/config")]
pub async fn get_config(_org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Set deduplication configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
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
)]
#[post("/{org_id}/alerts/deduplication/config")]
pub async fn set_config(
    org_id: web::Path<String>,
    config: web::Json<GlobalDeduplicationConfig>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();
    let config = config.into_inner();

    match crate::service::alerts::org_config::set_deduplication_config(&org_id, &config).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Deduplication config saved successfully"
        }))),
        Err(e) => {
            log::error!(
                "Error setting deduplication config for org {}: {}",
                org_id,
                e
            );
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to set deduplication config: {}", e)
            })))
        }
    }
}

/// Set deduplication configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
)]
#[post("/{org_id}/alerts/deduplication/config")]
pub async fn set_config(
    _org_id: web::Path<String>,
    _config: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
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
#[delete("/{org_id}/alerts/deduplication/config")]
pub async fn delete_config(org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    match crate::service::alerts::org_config::delete_deduplication_config(&org_id).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Deduplication config deleted successfully"
        }))),
        Err(e) => {
            log::error!(
                "Error deleting deduplication config for org {}: {}",
                org_id,
                e
            );
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to delete deduplication config: {}", e)
            })))
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
#[delete("/{org_id}/alerts/deduplication/config")]
pub async fn delete_config(_org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
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
#[get("/{org_id}/alerts/deduplication/semantic-groups")]
pub async fn get_semantic_groups(
    org_id: web::Path<String>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    match crate::service::alerts::org_config::get_semantic_groups(&org_id).await {
        Ok(groups) => Ok(HttpResponse::Ok().json(groups)),
        Err(e) => {
            log::error!("Error getting semantic groups for org {}: {}", org_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get semantic groups: {}", e)
            })))
        }
    }
}

/// Get semantic field groups (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
#[get("/{org_id}/alerts/deduplication/semantic-groups")]
pub async fn get_semantic_groups(
    _org_id: web::Path<String>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Preview diff between imported semantic groups and current DB state
///
/// This endpoint compares the provided semantic groups with what's currently stored
/// and returns a diff showing additions, modifications, and unchanged groups.
/// The UI can use this to show users what will change before they commit.
#[cfg(feature = "enterprise")]
#[utoipa::path(
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
)]
#[post("/{org_id}/alerts/deduplication/semantic-groups/preview-diff")]
pub async fn preview_semantic_groups_diff(
    org_id: web::Path<String>,
    proposed_groups: web::Json<Vec<SemanticFieldGroup>>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();
    let proposed = proposed_groups.into_inner();

    // Validate all group IDs
    for group in &proposed {
        if !SemanticFieldGroup::validate_id(&group.id) {
            return Ok(HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("Invalid semantic group ID: '{}'. IDs must be lowercase, alphanumeric, dash-separated", group.id)
            })));
        }
    }

    // Get current groups from DB
    let current_groups =
        match crate::service::alerts::org_config::get_semantic_groups(&org_id).await {
            Ok(groups) => groups,
            Err(e) => {
                log::error!(
                    "Error getting current semantic groups for org {}: {}",
                    org_id,
                    e
                );
                return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": format!("Failed to get current groups: {}", e)
                })));
            }
        };

    // Build a map of current groups by ID
    let current_map: std::collections::HashMap<String, &SemanticFieldGroup> =
        current_groups.iter().map(|g| (g.id.clone(), g)).collect();

    let mut additions = Vec::new();
    let mut modifications = Vec::new();
    let mut unchanged = Vec::new();

    for proposed_group in &proposed {
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

    Ok(HttpResponse::Ok().json(SemanticGroupDiff {
        additions,
        modifications,
        unchanged,
    }))
}

/// Preview diff (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
)]
#[post("/{org_id}/alerts/deduplication/semantic-groups/preview-diff")]
pub async fn preview_semantic_groups_diff(
    _org_id: web::Path<String>,
    _proposed_groups: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Save semantic field groups for an organization
///
/// Replaces all semantic groups with the provided list.
/// Usually called after user reviews the diff from preview-diff endpoint.
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SaveSemanticGroups",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = Vec<SemanticFieldGroup>, description = "Semantic groups to save", content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request - Invalid semantic groups"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[put("/{org_id}/alerts/deduplication/semantic-groups")]
pub async fn save_semantic_groups(
    org_id: web::Path<String>,
    groups: web::Json<Vec<SemanticFieldGroup>>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();
    let new_groups = groups.into_inner();

    // Validate all group IDs
    for group in &new_groups {
        if !SemanticFieldGroup::validate_id(&group.id) {
            return Ok(HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("Invalid semantic group ID: '{}'. IDs must be lowercase, alphanumeric, dash-separated", group.id)
            })));
        }
    }

    // Get existing config or create new one
    let mut config =
        match crate::service::alerts::org_config::get_deduplication_config(&org_id).await {
            Ok(Some(cfg)) => cfg,
            Ok(None) => GlobalDeduplicationConfig::default(),
            Err(e) => {
                log::error!(
                    "Error getting deduplication config for org {}: {}",
                    org_id,
                    e
                );
                return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": format!("Failed to get existing config: {}", e)
                })));
            }
        };

    // Replace semantic groups
    config.semantic_field_groups = new_groups;

    // Save config
    match crate::service::alerts::org_config::set_deduplication_config(&org_id, &config).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Semantic groups saved successfully",
            "total_groups": config.semantic_field_groups.len()
        }))),
        Err(e) => {
            log::error!("Error saving semantic groups for org {}: {}", org_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to save semantic groups: {}", e)
            })))
        }
    }
}

/// Save semantic groups (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
)]
#[put("/{org_id}/alerts/deduplication/semantic-groups")]
pub async fn save_semantic_groups(
    _org_id: web::Path<String>,
    _groups: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

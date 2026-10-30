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

//! Semantic field group endpoints (Enterprise feature), under the historical `deduplication` path.

use axum::{Json, extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use config::meta::correlation::FieldAlias;

#[cfg(feature = "enterprise")]
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct SemanticGroupDiff {
    /// Groups that exist in the imported JSON but not in DB (new)
    pub additions: Vec<FieldAlias>,
    /// Groups that exist in both but have different content
    pub modifications: Vec<SemanticGroupModification>,
    /// Groups that are identical in both
    pub unchanged: Vec<FieldAlias>,
}

#[cfg(feature = "enterprise")]
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct SemanticGroupModification {
    /// Current version in DB
    pub current: FieldAlias,
    /// New version from import
    pub proposed: FieldAlias,
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
        (status = 200, description = "Success", body = Vec<FieldAlias>),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn get_semantic_groups(Path(org_id): Path<String>) -> Response {
    // Use system_settings which has proper caching and cluster watch
    let groups = db::system_settings::get_semantic_field_groups(&org_id).await;
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
    request_body(content = Vec<FieldAlias>, description = "Semantic groups to compare", content_type = "application/json"),
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
    Json(proposed_groups): Json<Vec<FieldAlias>>,
) -> Response {
    // Validate all group IDs
    for group in &proposed_groups {
        if !FieldAlias::validate_id(&group.id) {
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
    let current_groups = db::system_settings::get_semantic_field_groups(&org_id).await;

    // Build a map of current groups by ID
    let current_map: std::collections::HashMap<String, &FieldAlias> =
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
    request_body(content = Vec<FieldAlias>, description = "Semantic groups to save (merged with existing)", content_type = "application/json"),
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
    Json(groups): Json<Vec<FieldAlias>>,
) -> Response {
    use config::meta::system_settings::{
        SettingCategory, SystemSetting, keys::SEMANTIC_FIELD_GROUPS,
    };

    let incoming_groups = groups;

    // Validate all group IDs
    for group in &incoming_groups {
        if !FieldAlias::validate_id(&group.id) {
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

    // The PUT body is the authoritative new list of semantic groups for the org.
    // Previously this endpoint did an upsert-only merge against existing groups
    // (or the bundled defaults when the DB row was empty), which silently
    // resurrected any group the UI had deleted. Treat the incoming list as the
    // full replacement — but re-inject protected groups (like "service") from the
    // existing config if the client omitted them, so they can never be lost.
    let existing_groups = db::system_settings::get_semantic_field_groups(&org_id).await;

    let incoming_ids: std::collections::HashSet<String> =
        incoming_groups.iter().map(|g| g.id.clone()).collect();

    let mut merged_groups: Vec<FieldAlias> = incoming_groups;

    // Re-inject protected groups (always present, never deletable)
    const PROTECTED_GROUP_IDS: &[&str] = &["service"];
    for protected_id in PROTECTED_GROUP_IDS {
        if !incoming_ids.contains(*protected_id)
            && let Some(existing) = existing_groups.iter().find(|g| g.id == *protected_id)
        {
            merged_groups.push(existing.clone());
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

    match db::system_settings::set(&setting).await {
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

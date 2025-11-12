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

use actix_web::{HttpResponse, delete, get, post, web};
#[cfg(feature = "enterprise")]
use config::meta::alerts::deduplication::DeduplicationConfig;

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
        (status = 200, description = "Success", body = DeduplicationConfig),
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
        Ok(None) => Ok(HttpResponse::NotFound().json(serde_json::json!({
            "error": "Deduplication config not found for this organization"
        }))),
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
    request_body(content = DeduplicationConfig, description = "Deduplication configuration", content_type = "application/json"),
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
    config: web::Json<DeduplicationConfig>,
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

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

//! Alert incidents and correlation API endpoints (Enterprise feature)
//!
//! # Code Duplication Note
//!
//! This module contains paired OSS/Enterprise implementations for each endpoint.
//! The duplication is intentional and serves several purposes:
//!
//! 1. **OpenAPI Documentation**: Each implementation has its own `#[utoipa::path]` attributes that
//!    document the OSS vs Enterprise behavior in generated docs.
//!
//! 2. **Type Safety**: OSS endpoints use `serde_json::Value` for request bodies to avoid importing
//!    enterprise-only types, while enterprise uses proper types.
//!
//! 3. **Compile-Time Feature Gating**: The `#[cfg(feature = "enterprise")]` ensures only the
//!    appropriate implementation is compiled, with zero runtime overhead.
//!
//! Alternative approaches (macros, trait objects) would reduce duplication but at
//! the cost of clarity, type safety, or runtime performance. Given these endpoints
//! are stable and rarely change, explicit duplication is the pragmatic choice.

use actix_web::{HttpResponse, delete, get, post, put, web};
#[cfg(feature = "enterprise")]
use config::meta::alerts::correlation::{CorrelationConfig, IncidentStatus};
#[cfg(feature = "enterprise")]
use infra::db::ORM_CLIENT;

// ==================== ENTERPRISE IMPLEMENTATIONS ====================

/// Get correlation configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetCorrelationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = CorrelationConfig),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/correlation/config")]
pub async fn get_config(org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    match crate::service::alerts::org_config::get_correlation_config(&org_id).await {
        Ok(Some(config)) => Ok(HttpResponse::Ok().json(config)),
        Ok(None) => Ok(HttpResponse::NotFound().json(serde_json::json!({
            "error": "Correlation config not found for this organization"
        }))),
        Err(e) => {
            log::error!("Error getting correlation config for org {}: {}", org_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get correlation config: {}", e)
            })))
        }
    }
}

/// Get correlation configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetCorrelationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[get("/{org_id}/correlation/config")]
pub async fn get_config(_org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Set correlation configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SetCorrelationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CorrelationConfig, description = "Correlation configuration", content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[post("/{org_id}/correlation/config")]
pub async fn set_config(
    org_id: web::Path<String>,
    config: web::Json<CorrelationConfig>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();
    let config = config.into_inner();

    // Validate config before saving
    if let Err(e) = config.validate() {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!("Invalid correlation config: {}", e)
        })));
    }

    match crate::service::alerts::org_config::set_correlation_config(&org_id, &config).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Correlation config saved successfully"
        }))),
        Err(e) => {
            log::error!("Error setting correlation config for org {}: {}", org_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to set correlation config: {}", e)
            })))
        }
    }
}

/// Set correlation configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SetCorrelationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[post("/{org_id}/correlation/config")]
pub async fn set_config(
    _org_id: web::Path<String>,
    _config: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Delete correlation configuration for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/correlation/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteCorrelationConfig",
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
#[delete("/{org_id}/correlation/config")]
pub async fn delete_config(org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    match crate::service::alerts::org_config::delete_correlation_config(&org_id).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Correlation config deleted successfully"
        }))),
        Err(e) => {
            log::error!(
                "Error deleting correlation config for org {}: {}",
                org_id,
                e
            );
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to delete correlation config: {}", e)
            })))
        }
    }
}

/// Delete correlation configuration for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/{org_id}/correlation/config",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteCorrelationConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[delete("/{org_id}/correlation/config")]
pub async fn delete_config(_org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// List incidents for an organization
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListIncidents",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("status" = Option<String>, Query, description = "Filter by status (open, acknowledged, resolved)"),
        ("limit" = Option<u64>, Query, description = "Maximum number of results", minimum = 1, maximum = 1000),
        ("offset" = Option<u64>, Query, description = "Offset for pagination"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/incidents")]
pub async fn list_incidents(
    org_id: web::Path<String>,
    query: web::Query<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    let db = match ORM_CLIENT.get() {
        Some(db) => db,
        None => {
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Database connection not available"
            })));
        }
    };

    // Parse query parameters
    let status: Option<IncidentStatus> = query
        .get("status")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let limit: u64 = query
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(100)
        .min(1000);
    let offset: u64 = query.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);

    match crate::service::alerts::correlation::list_incidents(db, &org_id, status, limit, offset)
        .await
    {
        Ok(incidents) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "incidents": incidents,
            "limit": limit,
            "offset": offset,
        }))),
        Err(e) => {
            log::error!("Error listing incidents for org {}: {}", org_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to list incidents: {}", e)
            })))
        }
    }
}

/// List incidents for an organization (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListIncidents",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[get("/{org_id}/incidents")]
pub async fn list_incidents(
    _org_id: web::Path<String>,
    _query: web::Query<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Get incident details including all correlated alerts
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetIncident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/incidents/{incident_id}")]
pub async fn get_incident(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, incident_id) = path.into_inner();

    let db = match ORM_CLIENT.get() {
        Some(db) => db,
        None => {
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Database connection not available"
            })));
        }
    };

    // Get incident
    let incident = match crate::service::alerts::correlation::get_incident(db, &incident_id).await {
        Ok(Some(inc)) => {
            // Verify it belongs to this org
            if inc.org_id != org_id {
                return Ok(HttpResponse::NotFound().json(serde_json::json!({
                    "error": "Incident not found"
                })));
            }
            inc
        }
        Ok(None) => {
            return Ok(HttpResponse::NotFound().json(serde_json::json!({
                "error": "Incident not found"
            })));
        }
        Err(e) => {
            log::error!("Error getting incident {}: {}", incident_id, e);
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get incident: {}", e)
            })));
        }
    };

    // Get alerts in this incident
    let alerts =
        match crate::service::alerts::correlation::get_incident_alerts(db, &incident_id).await {
            Ok(alerts) => alerts,
            Err(e) => {
                log::error!("Error getting alerts for incident {}: {}", incident_id, e);
                return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": format!("Failed to get incident alerts: {}", e)
                })));
            }
        };

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "incident": incident,
        "alerts": alerts,
    })))
}

/// Get incident details (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetIncident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[get("/{org_id}/incidents/{incident_id}")]
pub async fn get_incident(
    _path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

/// Update incident status
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateIncidentStatus",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = String, description = "New status (open, acknowledged, resolved)", content_type = "application/json", example = json!({"status": "acknowledged"})),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[put("/{org_id}/incidents/{incident_id}/status")]
pub async fn update_incident_status(
    path: web::Path<(String, String)>,
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, incident_id) = path.into_inner();

    let db = match ORM_CLIENT.get() {
        Some(db) => db,
        None => {
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Database connection not available"
            })));
        }
    };

    // Parse new status
    let new_status: IncidentStatus = match body.get("status").and_then(|v| v.as_str()) {
        Some(s) => match s.parse() {
            Ok(status) => status,
            Err(e) => {
                return Ok(HttpResponse::BadRequest().json(serde_json::json!({
                    "error": format!("Invalid status: {}", e)
                })));
            }
        },
        None => {
            return Ok(HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Missing 'status' field"
            })));
        }
    };

    // Verify incident belongs to this org
    match crate::service::alerts::correlation::get_incident(db, &incident_id).await {
        Ok(Some(inc)) if inc.org_id == org_id => {}
        Ok(Some(_)) => {
            return Ok(HttpResponse::NotFound().json(serde_json::json!({
                "error": "Incident not found"
            })));
        }
        Ok(None) => {
            return Ok(HttpResponse::NotFound().json(serde_json::json!({
                "error": "Incident not found"
            })));
        }
        Err(e) => {
            log::error!("Error getting incident {}: {}", incident_id, e);
            return Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to get incident: {}", e)
            })));
        }
    }

    // Update status
    match crate::service::alerts::correlation::update_incident_status(db, &incident_id, new_status)
        .await
    {
        Ok(updated_incident) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "message": "Incident status updated",
            "incident": updated_incident,
        }))),
        Err(e) => {
            log::error!("Error updating incident {}: {}", incident_id, e);
            Ok(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to update incident: {}", e)
            })))
        }
    }
}

/// Update incident status (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateIncidentStatus",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[put("/{org_id}/incidents/{incident_id}/status")]
pub async fn update_incident_status(
    _path: web::Path<(String, String)>,
    _body: web::Json<serde_json::Value>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Enterprise feature not available"))
}

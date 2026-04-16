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

//! HTTP handlers for Service Routing Config API (WP-1).
//!
//! Routes are registered unconditionally in the router.
//! Enterprise impls are gated with `#[cfg(feature = "enterprise")]`;
//! OSS stubs return 403.

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

// ── Query params ──────────────────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize, IntoParams, ToSchema)]
pub struct ListServicesQuery {
    /// Filter by exact service name
    pub service_name: Option<String>,
    /// true → only services with routing config; false → only without
    pub has_routing: Option<bool>,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
    #[serde(default)]
    pub page_token: u64,
}

fn default_page_size() -> u64 {
    50
}

// ── Response wrappers ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
pub struct ListServicesResponse {
    pub items: Vec<config::meta::alerts::incidents::ServiceWithRouting>,
    pub total: u64,
    pub next_page_token: Option<u64>,
}

// ── GET /services ─────────────────────────────────────────────────────────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/services",
    context_path = "/api",
    tag = "Services",
    operation_id = "ListServices",
    summary = "List services with routing config",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization"), ListServicesQuery),
    responses(
        (status = 200, description = "Success", body = ListServicesResponse),
        (status = 403, description = "Enterprise only"),
    )
)]
pub async fn list_services(
    Path(org_id): Path<String>,
    Query(query): Query<ListServicesQuery>,
) -> Response {
    let q = o2_enterprise::enterprise::alerts::services::ListServicesQuery {
        service_name: query.service_name,
        has_routing: query.has_routing,
        page_size: query.page_size,
        page_token: query.page_token,
    };
    match o2_enterprise::enterprise::alerts::services::list_services(&org_id, q).await {
        Ok((items, total)) => {
            let next_page_token = if query.page_token + query.page_size < total {
                Some(query.page_token + query.page_size)
            } else {
                None
            };
            MetaHttpResponse::json(ListServicesResponse {
                items,
                total,
                next_page_token,
            })
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/services",
    context_path = "/api",
    tag = "Services",
    operation_id = "ListServices",
    summary = "List services with routing config",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization"), ListServicesQuery),
    responses(
        (status = 403, description = "Enterprise only"),
    )
)]
pub async fn list_services(
    _path: Path<String>,
    _query: Query<ListServicesQuery>,
) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

// ── GET /services/{service_stream_id} ─────────────────────────────────────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/services/{service_stream_id}",
    context_path = "/api",
    tag = "Services",
    operation_id = "GetService",
    summary = "Get a service with its routing config",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    responses(
        (status = 200, description = "Success", body = config::meta::alerts::incidents::ServiceWithRouting),
        (status = 404, description = "Not found"),
        (status = 403, description = "Enterprise only"),
    )
)]
pub async fn get_service(
    Path((org_id, service_stream_id)): Path<(String, String)>,
) -> Response {
    match o2_enterprise::enterprise::alerts::services::get_service(&org_id, &service_stream_id)
        .await
    {
        Ok(Some(s)) => MetaHttpResponse::json(s),
        Ok(None) => MetaHttpResponse::not_found("Service not found"),
        Err(o2_enterprise::enterprise::alerts::services::ServiceError::NotFound(_)) => {
            MetaHttpResponse::not_found("Service not found")
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/services/{service_stream_id}",
    context_path = "/api",
    tag = "Services",
    operation_id = "GetService",
    summary = "Get a service with its routing config",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    responses((status = 403, description = "Enterprise only"))
)]
pub async fn get_service(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

// ── PUT /services/{service_stream_id}/routing ─────────────────────────────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    put,
    path = "/v2/{org_id}/services/{service_stream_id}/routing",
    context_path = "/api",
    tag = "Services",
    operation_id = "PutServiceRouting",
    summary = "Create or update routing config for a service",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    request_body = config::meta::alerts::incidents::PutRoutingConfigRequest,
    responses(
        (status = 200, description = "Success", body = config::meta::alerts::incidents::ServiceWithRouting),
        (status = 404, description = "Service not found"),
        (status = 422, description = "Validation error"),
    )
)]
pub async fn put_service_routing(
    Path((org_id, service_stream_id)): Path<(String, String)>,
    Json(req): Json<config::meta::alerts::incidents::PutRoutingConfigRequest>,
) -> Response {
    use o2_enterprise::enterprise::alerts::services::ServiceError;
    match o2_enterprise::enterprise::alerts::services::put_routing_config(
        &org_id,
        &service_stream_id,
        req,
    )
    .await
    {
        Ok(s) => MetaHttpResponse::json(s),
        Err(ServiceError::NotFound(_)) => MetaHttpResponse::not_found("Service not found"),
        Err(ServiceError::InvalidEmails(emails)) => MetaHttpResponse::bad_request(
            serde_json::json!({ "invalid_emails": emails }).to_string(),
        ),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    put,
    path = "/v2/{org_id}/services/{service_stream_id}/routing",
    context_path = "/api",
    tag = "Services",
    operation_id = "PutServiceRouting",
    summary = "Create or update routing config for a service",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    responses((status = 403, description = "Enterprise only"))
)]
pub async fn put_service_routing(
    _path: Path<(String, String)>,
    _body: Json<config::meta::alerts::incidents::PutRoutingConfigRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

// ── DELETE /services/{service_stream_id}/routing ──────────────────────────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/services/{service_stream_id}/routing",
    context_path = "/api",
    tag = "Services",
    operation_id = "DeleteServiceRouting",
    summary = "Remove routing config for a service",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "Service not found"),
    )
)]
pub async fn delete_service_routing(
    Path((org_id, service_stream_id)): Path<(String, String)>,
) -> Response {
    use o2_enterprise::enterprise::alerts::services::ServiceError;
    match o2_enterprise::enterprise::alerts::services::delete_routing_config(
        &org_id,
        &service_stream_id,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::no_content(),
        Err(ServiceError::NotFound(_)) => MetaHttpResponse::not_found("Service not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/services/{service_stream_id}/routing",
    context_path = "/api",
    tag = "Services",
    operation_id = "DeleteServiceRouting",
    summary = "Remove routing config for a service",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("service_stream_id" = String, Path, description = "Service ID"),
    ),
    responses((status = 403, description = "Enterprise only"))
)]
pub async fn delete_service_routing(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

// ── PATCH /incidents/{incident_id}/services/{service_stream_id}/role ──────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/services/{service_stream_id}/role",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PatchIncidentServiceRole",
    summary = "Change the responsible service for an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("service_stream_id" = String, Path, description = "Service ID to promote"),
    ),
    request_body = config::meta::alerts::incidents::PatchServiceRoleRequest,
    responses(
        (status = 204, description = "Updated"),
        (status = 404, description = "Incident or service not found"),
    )
)]
pub async fn patch_incident_service_role(
    Path((org_id, incident_id, service_stream_id)): Path<(String, String, String)>,
    Json(req): Json<config::meta::alerts::incidents::PatchServiceRoleRequest>,
) -> Response {
    use config::meta::alerts::incidents::IncidentServiceRole;
    if req.role != IncidentServiceRole::Responsible {
        return MetaHttpResponse::bad_request("Only 'responsible' role can be set via this endpoint");
    }
    match o2_enterprise::enterprise::alerts::services::change_responsible_service(
        &incident_id,
        &service_stream_id,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::no_content(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/services/{service_stream_id}/role",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PatchIncidentServiceRole",
    summary = "Change the responsible service for an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("service_stream_id" = String, Path, description = "Service ID to promote"),
    ),
    responses((status = 403, description = "Enterprise only"))
)]
pub async fn patch_incident_service_role(
    _path: Path<(String, String, String)>,
    _body: Json<config::meta::alerts::incidents::PatchServiceRoleRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

// ── PATCH /incidents/{incident_id}/metadata ───────────────────────────────────

#[cfg(feature = "enterprise")]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/metadata",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PatchIncidentMetadata",
    summary = "Merge-patch external_refs on an incident",
    description = "JSON merge-patch on external_refs. New keys added, existing overwritten, null-valued keys removed.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body = config::meta::alerts::incidents::PatchIncidentMetadataRequest,
    responses(
        (status = 200, description = "Updated incident"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn patch_incident_metadata(
    Path((org_id, incident_id)): Path<(String, String)>,
    Json(req): Json<config::meta::alerts::incidents::PatchIncidentMetadataRequest>,
) -> Response {
    match infra::table::alert_incidents::update_external_refs(
        &org_id,
        &incident_id,
        req.external_refs,
    )
    .await
    {
        Ok(model) => MetaHttpResponse::json(model),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/metadata",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PatchIncidentMetadata",
    summary = "Merge-patch external_refs on an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses((status = 403, description = "Enterprise only"))
)]
pub async fn patch_incident_metadata(
    _path: Path<(String, String)>,
    _body: Json<config::meta::alerts::incidents::PatchIncidentMetadataRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Enterprise feature")
}

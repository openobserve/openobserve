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

use axum::{extract::Path, response::Response};
use config::META_ORG_ID;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::domain_management::{self, meta::DomainManagementRequest};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Helper function to validate that only meta org can access domain management APIs
fn validate_meta_org_access(org_id: &str) -> Result<(), infra::errors::Error> {
    if org_id != META_ORG_ID {
        return Err(infra::errors::Error::Message(format!(
            "Domain management APIs are only available for meta organization. Provided org_id: {org_id}, expected: {META_ORG_ID}"
        )));
    }
    Ok(())
}

/// Get domain management configuration
#[utoipa::path(
    get,
    path = "/{org_id}/domain_management",
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "GetDomainManagementConfig",
    summary = "Get domain management configuration",
    description = "Retrieves the current domain management configuration for custom domain settings and SSL certificate \
                   management. Only accessible by the meta organization for security and control purposes. Returns \
                   domain configuration including DNS settings, certificate status, and routing configurations for \
                   enterprise domain management.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    )
)]
pub async fn get_domain_management_config(Path(org_id): Path<String>) -> Response {
    // Validate that only meta org can access domain management APIs
    if let Err(e) = validate_meta_org_access(&org_id) {
        return MetaHttpResponse::forbidden(e);
    }

    #[cfg(feature = "enterprise")]
    match domain_management::get_domain_management_config().await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => {
            log::error!("Error getting domain management config: {e}");
            match e {
                infra::errors::Error::Message(ref msg) if msg.contains("not found") => {
                    MetaHttpResponse::not_found(e)
                }
                _ => MetaHttpResponse::internal_error(e),
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Domain management is not available")
}

/// Set domain management configuration
#[utoipa::path(
    put,
    path = "/{org_id}/domain_management",
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "SetDomainManagementConfig",
    summary = "Configure domain management settings",
    description = "Updates the domain management configuration for custom domain settings, SSL certificates, and DNS \
                   routing. Only accessible by the meta organization for security and administrative control. Allows \
                   configuration of custom domains, certificate management, and traffic routing for enterprise \
                   deployments with custom branding and domain requirements.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    request_body(content = inline(DomainManagementRequest), description = "Domain management configuration", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    )
)]
pub async fn set_domain_management_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] axum::Json(body): axum::Json<DomainManagementRequest>,
) -> Response {
    // Validate that only meta org can access domain management APIs
    if let Err(e) = validate_meta_org_access(&org_id) {
        return MetaHttpResponse::forbidden(e);
    }

    #[cfg(feature = "enterprise")]
    match domain_management::set_domain_management_config(body).await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => {
            log::error!("Error setting domain management config: {e}");
            match e {
                infra::errors::Error::Message(_) => MetaHttpResponse::bad_request(e),
                _ => MetaHttpResponse::internal_error(e),
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Domain management is not available")
}

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

use std::io::Error;

use actix_web::{HttpResponse, get, put, web};
use config::META_ORG_ID;
use utoipa::OpenApi;

use crate::{
    common::meta::{
        domain_management::{
            DomainManagementRequest, DomainManagementResponse, DomainOperationResponse,
        },
        http::HttpResponse as MetaHttpResponse,
    },
    service::domain_management,
};

/// Helper function to validate that only meta org can access domain management APIs
fn validate_meta_org_access(org_id: &str) -> Result<(), infra::errors::Error> {
    if org_id != META_ORG_ID {
        return Err(infra::errors::Error::Message(format!(
            "Domain management APIs are only available for meta organization. Provided org_id: {org_id}, expected: {META_ORG_ID}"
        )));
    }
    Ok(())
}

#[derive(OpenApi)]
#[openapi(
    paths(
        get_domain_management_config,
        set_domain_management_config,
    ),
    components(schemas(
        DomainManagementRequest,
        DomainManagementResponse,
        DomainOperationResponse,
    )),
    tags(
        (name = "Domain Management", description = "Domain management operations")
    )
)]
pub struct ApiDoc;

/// Get domain management configuration
#[utoipa::path(
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "GetDomainManagementConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DomainManagementResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/domain_management")]
pub async fn get_domain_management_config(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    // Validate that only meta org can access domain management APIs
    if let Err(e) = validate_meta_org_access(&org_id) {
        return Ok(MetaHttpResponse::forbidden(e));
    }

    match domain_management::get_domain_management_config().await {
        Ok(response) => Ok(MetaHttpResponse::json(response)),
        Err(e) => {
            log::error!("Error getting domain management config: {}", e);
            match e {
                infra::errors::Error::Message(ref msg) if msg.contains("not found") => {
                    Ok(MetaHttpResponse::not_found(e))
                }
                _ => Ok(MetaHttpResponse::internal_error(e)),
            }
        }
    }
}

/// Set domain management configuration
#[utoipa::path(
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "SetDomainManagementConfig",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    request_body(content = DomainManagementRequest, description = "Domain management configuration", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DomainOperationResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = HttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/domain_management")]
pub async fn set_domain_management_config(
    path: web::Path<String>,
    body: web::Json<DomainManagementRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let request = body.into_inner();

    // Validate that only meta org can access domain management APIs
    if let Err(e) = validate_meta_org_access(&org_id) {
        return Ok(MetaHttpResponse::forbidden(e));
    }

    match domain_management::set_domain_management_config(request).await {
        Ok(response) => Ok(MetaHttpResponse::json(response)),
        Err(e) => {
            log::error!("Error setting domain management config: {}", e);
            match e {
                infra::errors::Error::Message(_) => Ok(MetaHttpResponse::bad_request(e)),
                _ => Ok(MetaHttpResponse::internal_error(e)),
            }
        }
    }
}

// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::io::Error;

use actix_web::{HttpResponse, get, web};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// GET /api/{org_id}/service_streams
///
/// List all discovered services for an organization
#[get("/{org_id}/service_streams")]
pub async fn list_services(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();

    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::list(&org_id)
            .await
        {
            Ok(services) => Ok(MetaHttpResponse::json(services)),
            Err(e) => Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500u16,
                    format!("Failed to list services: {}", e),
                )),
            ),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            403u16,
            "Service Discovery is an enterprise-only feature".to_string(),
        )))
    }
}

/// GET /api/{org_id}/service_streams/{service_name}
///
/// List all instances of a service across dimension combinations
///
/// Query parameters:
/// - Any key-value pair will be treated as a dimension filter
/// - Example: ?cluster=us-west&environment=prod
/// - Only services matching ALL specified dimensions will be returned
#[get("/{org_id}/service_streams/{service_name}")]
pub async fn list_service_instances(
    path: web::Path<(String, String)>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let (org_id, service_name) = path.into_inner();
    let dimension_filters = query.into_inner();

    #[cfg(feature = "enterprise")]
    {
        // If dimension filters are provided, use filtered query
        let result = if dimension_filters.is_empty() {
            o2_enterprise::enterprise::service_streams::storage::ServiceStorage::list_by_name(
                &org_id,
                &service_name,
            )
            .await
        } else {
            o2_enterprise::enterprise::service_streams::storage::ServiceStorage::list_by_dimensions(
                &org_id,
                Some(&service_name),
                &dimension_filters,
            )
            .await
        };

        match result {
            Ok(services) => Ok(MetaHttpResponse::json(services)),
            Err(e) => Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500u16,
                    format!("Failed to list service instances: {}", e),
                )),
            ),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            403u16,
            "Service Discovery is an enterprise-only feature".to_string(),
        )))
    }
}

/// GET /api/{org_id}/service_streams/_stats
///
/// Get dimension cardinality statistics
#[get("/{org_id}/service_streams/_stats")]
pub async fn get_dimension_stats(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();

    #[cfg(feature = "enterprise")]
    {
        let stats =
            o2_enterprise::enterprise::service_streams::dimension_tracker::get_dimension_stats(
                &org_id,
            )
            .await;

        Ok(MetaHttpResponse::json(stats))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            403u16,
            "Service Discovery is an enterprise-only feature".to_string(),
        )))
    }
}

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
///
/// **DEPRECATED**: This API is for admin/debugging only.
/// For correlation use cases, use `POST _correlate` instead.
#[deprecated(
    note = "Use POST _correlate for stream-based correlation. This is for admin/debug only."
)]
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
/// **DEPRECATED**: This API uses service-first approach which is wrong.
/// Use `POST _correlate` with stream name instead.
///
/// Query parameters:
/// - Any key-value pair will be treated as a dimension filter
/// - Example: ?cluster=us-west&environment=prod
/// - Only services matching ALL specified dimensions will be returned
#[deprecated(note = "Use POST _correlate with stream name. Service-first approach is incorrect.")]
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
///
/// **DEPRECATED**: Use `GET _analytics` instead which includes CardinalityClass.
#[deprecated(note = "Use GET _analytics for cardinality with classification")]
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

/// GET /api/{org_id}/service_streams/_analytics
///
/// Get comprehensive dimension analytics including cardinality classification
///
/// Returns:
/// - Cardinality of each dimension
/// - Cardinality class (VeryLow/Low/Medium/High/VeryHigh)
/// - Recommended priority dimensions for correlation
/// - Sample values for each dimension
///
/// This endpoint provides the data needed to understand which dimensions
/// are stable (good for correlation) vs transient (good for filtering only)
#[utoipa::path(
    get,
    path = "/{org_id}/service_streams/_analytics",
    tag = "Service Streams",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    responses(
        (status = 200, description = "Dimension analytics", body = DimensionAnalyticsSummary),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error")
    )
)]
#[get("/{org_id}/service_streams/_analytics")]
pub async fn get_dimension_analytics(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();

    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::calculate_dimension_analytics(&org_id)
            .await
        {
            Ok(analytics) => Ok(MetaHttpResponse::json(analytics)),
            Err(e) => Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500u16,
                    format!("Failed to calculate dimension analytics: {}", e),
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

/// GET /api/{org_id}/service_streams/_lookup
///
/// Lookup service by stream name and dimensions
///
/// **DEPRECATED**: Use `POST _correlate` instead which returns correlation data
/// with dimension categorization (matched vs additional).
///
/// Query parameters:
/// - stream: Stream name (required)
/// - type: Stream type - logs/traces/metrics (required)
/// - Additional dimension filters as key-value pairs
///
/// Example: ?stream=default&type=logs&k8s-cluster=prod&k8s-deployment=api
///
/// Returns the single best-matching service instance
#[deprecated(
    note = "Use POST _correlate which provides dimension categorization and related streams"
)]
#[get("/{org_id}/service_streams/_lookup")]
pub async fn lookup_by_stream(
    org_id: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let params = query.into_inner();

    // Extract required parameters
    let stream_name = match params.get("stream") {
        Some(s) => s.clone(),
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                400u16,
                "Missing required parameter: stream".to_string(),
            )));
        }
    };

    let stream_type = match params.get("type") {
        Some(t) => t.clone(),
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                400u16,
                "Missing required parameter: type".to_string(),
            )));
        }
    };

    // Validate stream type
    if stream_type != "logs" && stream_type != "traces" && stream_type != "metrics" {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            400u16,
            format!(
                "Invalid stream type: {}. Must be logs, traces, or metrics",
                stream_type
            ),
        )));
    }

    // Extract dimension filters (everything except stream and type)
    let mut dimension_filters = params.clone();
    dimension_filters.remove("stream");
    dimension_filters.remove("type");

    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::lookup_by_stream(
            &org_id,
            &stream_name,
            &stream_type,
            &dimension_filters,
        )
        .await
        {
            Ok(Some(service)) => Ok(MetaHttpResponse::json(service)),
            Ok(None) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                404u16,
                format!(
                    "No service found with stream '{}' matching the provided dimensions",
                    stream_name
                ),
            ))),
            Err(e) => Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500u16,
                    format!("Failed to lookup service: {}", e),
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

/// POST /api/{org_id}/service_streams/_correlate
///
/// Find related telemetry streams for a given log/trace/metric event
///
/// Request body:
/// {
///   "source_stream": "default",
///   "source_type": "logs",
///   "available_dimensions": {
///     "k8s-cluster": "prod",
///     "k8s-namespace": "app",
///     "k8s-deployment": "api",
///     "k8s-pod": "api-xyz",
///     "host": "node-123"
///   }
/// }
///
/// Response includes:
/// - The matched service
/// - Which dimensions were used for matching (minimal set)
/// - Which dimensions are available for additional filtering
/// - All related streams (logs/traces/metrics) with their dimension requirements
#[utoipa::path(
    post,
    path = "/{org_id}/service_streams/_correlate",
    tag = "Service Streams",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    request_body(
        content = CorrelationRequest,
        description = "Correlation request parameters"
    ),
    responses(
        (status = 200, description = "Correlation results", body = CorrelationResponse),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "No matching service found"),
        (status = 500, description = "Internal server error")
    )
)]
#[actix_web::post("/{org_id}/service_streams/_correlate")]
pub async fn correlate_streams(
    org_id: web::Path<String>,
    req: web::Json<CorrelationRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();

    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::correlate(
            &org_id,
            &req.source_stream,
            &req.source_type,
            &req.available_dimensions,
        )
        .await
        {
            Ok(Some(response)) => Ok(MetaHttpResponse::json(response)),
            Ok(None) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                404u16,
                format!(
                    "No service found for stream '{}' (type: {}) with the provided dimensions",
                    req.source_stream, req.source_type
                ),
            ))),
            Err(e) => Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500u16,
                    format!("Failed to correlate streams: {}", e),
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

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CorrelationRequest {
    /// Source stream name
    pub source_stream: String,
    /// Source stream type (logs/traces/metrics)
    pub source_type: String,
    /// Available dimensions from the source event
    pub available_dimensions: std::collections::HashMap<String, String>,
}

// Re-export types from enterprise module
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::service_streams::meta::{
    CorrelationResponse, DimensionAnalyticsSummary, RelatedStreams, StreamInfo,
};

// Provide stub types for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
mod stubs {
    use std::collections::HashMap;

    #[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
    pub struct CorrelationResponse {
        pub service_name: String,
        pub matched_dimensions: HashMap<String, String>,
        pub additional_dimensions: HashMap<String, String>,
        pub related_streams: RelatedStreams,
    }

    #[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
    pub struct RelatedStreams {
        pub logs: Vec<StreamInfo>,
        pub traces: Vec<StreamInfo>,
        pub metrics: Vec<StreamInfo>,
    }

    #[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
    pub struct StreamInfo {
        pub stream_name: String,
        pub filters: HashMap<String, String>,
    }

    #[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
    pub struct DimensionAnalyticsSummary {
        pub org_id: String,
        pub total_dimensions: usize,
        pub by_cardinality: HashMap<String, Vec<String>>,
        pub recommended_priority_dimensions: Vec<String>,
        pub dimensions: Vec<String>, // Simplified for stub
        pub generated_at: i64,
    }
}

#[cfg(not(feature = "enterprise"))]
pub use stubs::*;

// Copyright 2026 OpenObserve Inc.
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

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
};

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
    operation_id = "GetServiceStreamAnalytics",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    responses(
        (status = 200, description = "Dimension analytics", body = DimensionAnalyticsSummary),
        (status = 401, description = "Unauthorized - Authentication required"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("Authorization" = [])
    )
)]
pub async fn get_dimension_analytics(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>, // Require authentication
) -> Response {
    // Note: No stream-specific permissions needed - this is org-level analytics

    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::calculate_dimension_analytics(&org_id)
            .await
        {
            Ok(analytics) => MetaHttpResponse::json(analytics),
            Err(e) => MetaHttpResponse::internal_error(
                format!("Failed to calculate dimension analytics: {e}")
            ),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        MetaHttpResponse::forbidden("Service Discovery is an enterprise-only feature")
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
    operation_id = "CorrelateServiceStreams",
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
        (status = 401, description = "Unauthorized - Authentication required"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 404, description = "No matching service found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("Authorization" = [])
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn correlate_streams(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>, // Require authentication
    #[allow(unused_variables)] Json(req): Json<CorrelationRequest>,
) -> Response {
    // Note: No stream-specific permissions needed - user already has access to source stream

    #[cfg(feature = "enterprise")]
    {
        // Get FQN priority from DB/cache (org-level setting or system default)
        let fqn_priority =
            crate::service::db::system_settings::get_fqn_priority_dimensions(&org_id).await;

        // Get semantic field groups - MUST use same source as UI to ensure consistency
        // This resolves org-level custom groups or falls back to enterprise defaults
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;

        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::correlate(
            &org_id,
            &req.source_stream,
            &req.source_type,
            &req.available_dimensions,
            &fqn_priority,
            &semantic_groups,
        )
        .await
        {
            Ok(Some(response)) => MetaHttpResponse::json(response),
            Ok(None) => {
                // No service found - this is a successful API call with no results
                // Return 200 with null to indicate "no match" (not an error)
                (StatusCode::OK, Json(serde_json::json!(null))).into_response()
            }
            Err(e) => MetaHttpResponse::internal_error(format!("Failed to correlate streams: {e}")),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        (
            StatusCode::FORBIDDEN,
            Json(MetaHttpResponse::error(
                StatusCode::FORBIDDEN,
                "Service Discovery is an enterprise-only feature",
            )),
        )
            .into_response()
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

/// GET /api/{org_id}/service_streams/_grouped
///
/// Get services grouped by their Fully Qualified Name (FQN)
///
/// This endpoint is used by the Correlation Settings UI to display
/// which services are correlated together via their shared FQN.
///
/// Response includes:
/// - Services grouped by FQN
/// - Each group shows which services share the FQN
/// - Stream counts per group (logs/traces/metrics)
/// - Whether each group has full telemetry coverage
#[utoipa::path(
    get,
    path = "/{org_id}/service_streams/_grouped",
    tag = "Service Streams",
    operation_id = "GetServiceStreamGrouped",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    responses(
        (status = 200, description = "Services grouped by FQN", body = GroupedServicesResponse),
        (status = 401, description = "Unauthorized - Authentication required"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("Authorization" = [])
    )
)]
pub async fn get_services_grouped(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>, // Require authentication
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Get FQN priority from DB/cache (org-level setting or system default)
        let fqn_priority =
            crate::service::db::system_settings::get_fqn_priority_dimensions(&org_id).await;

        // Get semantic groups to determine scope vs workload dimensions
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;

        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::list_grouped_by_fqn(&org_id, &fqn_priority, &semantic_groups)
            .await
        {
            Ok(response) => MetaHttpResponse::json(response),
            Err(e) => MetaHttpResponse::internal_error(
                format!("Failed to get grouped services: {e}")
            ),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        log::info!("Service Discovery is an enterprise-only feature");
        MetaHttpResponse::forbidden("Service Discovery is an enterprise-only feature")
    }
}

// Re-export shared types from config for API documentation (utoipa)
// These types are the same for both enterprise and non-enterprise builds
pub use config::meta::service_streams::{
    CardinalityClass, CorrelationResponse, DimensionAnalytics, DimensionAnalyticsSummary,
    GroupedServicesResponse, RelatedStreams, ServiceFqnGroup, ServiceInGroup, ServiceStreams,
    StreamInfo, StreamSummary,
};

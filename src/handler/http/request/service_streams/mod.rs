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

#[utoipa::path(
    get,
    path = "/{org_id}/service_streams",
    tag = "Service Streams",
    operation_id = "ListServiceStreams",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    responses(
        (status = 200, description = "List of discovered services"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn list_services(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    match infra::table::service_streams::list(&org_id).await {
        Ok(records) => MetaHttpResponse::json(records),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to list services: {e}")),
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
        use config::meta::{correlation::ServiceIdentityConfig, system_settings::SettingScope};
        let identity_config = match infra::table::system_settings::get(
            &SettingScope::Org,
            Some(&org_id),
            None,
            "service_identity",
        )
        .await
        {
            Ok(Some(s)) => serde_json::from_value::<ServiceIdentityConfig>(s.setting_value)
                .unwrap_or_else(|_| ServiceIdentityConfig::default_config()),
            _ => ServiceIdentityConfig::default_config(),
        };
        let semantic_groups =
            o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file();

        match o2_enterprise::enterprise::service_streams::storage::correlate(
            &org_id,
            &req.available_dimensions,
            &identity_config,
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

#[utoipa::path(
    get,
    path = "/{org_id}/service_streams/config/identity",
    tag = "Service Streams",
    operation_id = "GetServiceIdentityConfig",
    params(("org_id" = String, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Current identity config"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn get_identity_config(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    use config::meta::{correlation::ServiceIdentityConfig, system_settings::SettingScope};

    match infra::table::system_settings::get(
        &SettingScope::Org,
        Some(&org_id),
        None,
        "service_identity",
    )
    .await
    {
        Ok(Some(s)) => match serde_json::from_value::<ServiceIdentityConfig>(s.setting_value) {
            Ok(cfg) => MetaHttpResponse::json(cfg),
            Err(e) => MetaHttpResponse::internal_error(format!("Failed to parse config: {e}")),
        },
        Ok(None) => MetaHttpResponse::json(ServiceIdentityConfig::default_config()),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to load config: {e}")),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/service_streams/config/identity",
    tag = "Service Streams",
    operation_id = "SaveServiceIdentityConfig",
    params(("org_id" = String, Path, description = "Organization ID")),
    request_body(content = serde_json::Value, description = "ServiceIdentityConfig JSON"),
    responses(
        (status = 200, description = "Config saved"),
        (status = 400, description = "Invalid config"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn save_identity_config(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<config::meta::correlation::ServiceIdentityConfig>,
) -> Response {
    use config::meta::system_settings::{SettingScope, SystemSetting};

    if let Err(e) = body.validate() {
        return MetaHttpResponse::bad_request(e);
    }

    let value = match serde_json::to_value(&body) {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::internal_error(format!("Serialization error: {e}")),
    };

    let setting = SystemSetting {
        id: None,
        scope: SettingScope::Org,
        org_id: Some(org_id),
        user_id: None,
        setting_key: "service_identity".to_string(),
        setting_category: Some("service_streams".to_string()),
        setting_value: value,
        description: None,
        created_at: 0,
        updated_at: 0,
        created_by: None,
        updated_by: Some(user_email.user_id),
    };

    match infra::table::system_settings::set(&setting).await {
        Ok(_) => MetaHttpResponse::json(serde_json::json!({"message": "saved"})),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to save config: {e}")),
    }
}

// Re-export shared types from config for API documentation (utoipa)
// These types are the same for both enterprise and non-enterprise builds
pub use config::meta::service_streams::{
    CardinalityClass, CorrelationResponse, DimensionAnalytics, DimensionAnalyticsSummary,
    RelatedStreams, ServiceStreams, StreamInfo, StreamSummary,
};

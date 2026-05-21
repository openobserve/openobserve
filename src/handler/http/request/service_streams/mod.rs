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

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
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
    Headers(user_email): Headers<UserEmail>, // Require authentication
) -> Response {
    // Note: No stream-specific permissions needed - this is org-level analytics

    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &org_id,
            &org_id,
            &user_email.user_id,
            "service_streams",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::calculate_dimension_analytics(&org_id, semantic_groups)
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
        let _ = (org_id, user_email);
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
    Headers(user_email): Headers<UserEmail>, // Require authentication
    #[allow(unused_variables)] Json(req): Json<CorrelationRequest>,
) -> Response {
    // Note: No stream-specific permissions needed - user already has access to source stream

    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &org_id,
            &org_id,
            &user_email.user_id,
            "service_streams",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
        let identity_config =
            crate::service::db::system_settings::get_service_identity_config(&org_id).await;
        log::debug!(
            "[correlation] Loaded service_identity config for org {}: sets={}, tracked_alias_ids={:?}",
            org_id,
            identity_config.sets.len(),
            identity_config.tracked_alias_ids
        );
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(&org_id).await;

        // Enhanced debug logging for correlation troubleshooting
        log::debug!(
            "[correlation] org_id={}, available_dimensions={:?}, source_stream={}, source_type={}",
            org_id,
            req.available_dimensions,
            req.source_stream,
            req.source_type
        );
        log::debug!(
            "[correlation] identity_config: sets_count={}, tracked_alias_ids={:?}",
            identity_config.sets.len(),
            identity_config.tracked_alias_ids
        );
        log::debug!(
            "[correlation] semantic_groups_count={}",
            semantic_groups.len()
        );

        match o2_enterprise::enterprise::service_streams::storage::correlate(
            &org_id,
            &req.available_dimensions,
            &identity_config,
            &semantic_groups,
        )
        .await
        {
            Ok(Some(response)) => {
                log::debug!(
                    "[correlation] success: found match for org_id={}, source_stream={}",
                    org_id,
                    req.source_stream
                );
                MetaHttpResponse::json(response)
            }
            Ok(None) => {
                log::debug!(
                    "[correlation] no_match: no service found for org_id={}, source_stream={}, available_dimensions={:?}",
                    org_id,
                    req.source_stream,
                    req.available_dimensions
                );
                // No service found - this is a successful API call with no results
                // Return 200 with null to indicate "no match" (not an error)
                (StatusCode::OK, Json(serde_json::json!(null))).into_response()
            }
            Err(e) => {
                log::error!(
                    "[correlation] error: failed correlation for org_id={}, source_stream={}, error={}",
                    org_id,
                    req.source_stream,
                    e
                );
                MetaHttpResponse::internal_error(format!("Failed to correlate streams: {e}"))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email);
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
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "service_streams",
        "GET",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    #[cfg(not(feature = "enterprise"))]
    let _ = &user_email;

    let cfg = crate::service::db::system_settings::get_service_identity_config(&org_id).await;
    MetaHttpResponse::json(cfg)
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

    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "service_streams",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    if let Err(e) = body.validate() {
        return MetaHttpResponse::bad_request(e);
    }

    // Validate that all tracked_alias_ids exist in canonical groups (defaults + custom DB groups)
    #[cfg(feature = "enterprise")]
    {
        use std::collections::HashSet;
        // Defaults from bundled JSON
        let mut known_ids: HashSet<String> =
            o2_enterprise::enterprise::common::semantic_config::load_defaults_from_file()
                .into_iter()
                .map(|g| g.id)
                .collect();
        // User-defined semantic groups stored in system_settings
        known_ids.extend(
            crate::service::db::system_settings::get_semantic_field_groups(&org_id)
                .await
                .into_iter()
                .map(|g| g.id),
        );
        let unknown: Vec<&str> = body
            .tracked_alias_ids
            .iter()
            .filter(|id| !known_ids.contains(*id))
            .map(String::as_str)
            .collect();
        if !unknown.is_empty() {
            return MetaHttpResponse::bad_request(format!(
                "Unknown alias group IDs: {}",
                unknown.join(", ")
            ));
        }
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

/// DELETE /api/{org_id}/service_streams/_reset
///
/// Reset (delete) all discovered services for an organization.
///
/// Services will be automatically re-discovered as new telemetry data arrives.
/// This is useful after changing service identity configuration to force
/// a clean re-discovery with the updated settings.
#[utoipa::path(
    delete,
    path = "/{org_id}/service_streams/_reset",
    tag = "Service Streams",
    operation_id = "ResetServiceStreams",
    params(
        ("org_id" = String, Path, description = "Organization ID")
    ),
    responses(
        (status = 200, description = "Services reset successfully"),
        (status = 401, description = "Unauthorized - Authentication required"),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("Authorization" = [])
    )
)]
pub async fn reset_services(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &org_id,
            &org_id,
            &user_email.user_id,
            "service_streams",
            "DELETE",
            None,
            true,
            false,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
        match infra::table::service_streams::delete_all(&org_id).await {
            Ok(deleted_count) => MetaHttpResponse::json(serde_json::json!({
                "deleted_count": deleted_count,
                "message": format!("Successfully deleted {} discovered service(s) for org '{}'", deleted_count, org_id),
                "note": "Services will be automatically re-discovered as new telemetry data arrives. This typically begins within minutes of the next data ingestion."
            })),
            Err(e) => MetaHttpResponse::internal_error(format!("Failed to reset services: {e}")),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email);
        MetaHttpResponse::forbidden("Service Discovery is an enterprise-only feature")
    }
}

// Re-export shared types from config for API documentation (utoipa)
// These types are the same for both enterprise and non-enterprise builds
pub use config::meta::service_streams::{
    CardinalityClass, CorrelationResponse, DimensionAnalytics, DimensionAnalyticsSummary,
    RelatedStreams, ServiceStreams, StreamInfo, StreamSummary,
};

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::{
        service_streams::{
            CardinalityClass, CorrelationResponse, DimensionAnalytics, RelatedStreams,
            ServiceStreams, StreamInfo, StreamSummary,
        },
        stream::StreamType,
    };

    use super::CorrelationRequest;

    // -----------------------------------------------------------------------
    // Group A: CorrelationRequest serialization / deserialization
    // -----------------------------------------------------------------------

    #[test]
    fn test_correlation_request_deserialization() {
        let json = r#"{
            "source_stream": "default",
            "source_type": "logs",
            "available_dimensions": {
                "k8s-cluster": "prod",
                "k8s-namespace": "app"
            }
        }"#;
        let req: CorrelationRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.source_stream, "default");
        assert_eq!(req.source_type, "logs");
        assert_eq!(req.available_dimensions.len(), 2);
        assert_eq!(req.available_dimensions.get("k8s-cluster").unwrap(), "prod");
        assert_eq!(
            req.available_dimensions.get("k8s-namespace").unwrap(),
            "app"
        );
    }

    #[test]
    fn test_correlation_request_serialization_roundtrip() {
        let mut dims = HashMap::new();
        dims.insert("host".to_string(), "node-1".to_string());

        let req = CorrelationRequest {
            source_stream: "my_stream".to_string(),
            source_type: "traces".to_string(),
            available_dimensions: dims,
        };

        let json = serde_json::to_string(&req).unwrap();
        let deserialized: CorrelationRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.source_stream, "my_stream");
        assert_eq!(deserialized.source_type, "traces");
        assert_eq!(
            deserialized.available_dimensions.get("host").unwrap(),
            "node-1"
        );
    }

    #[test]
    fn test_correlation_request_empty_dimensions() {
        let json = r#"{
            "source_stream": "default",
            "source_type": "metrics",
            "available_dimensions": {}
        }"#;
        let req: CorrelationRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.source_stream, "default");
        assert_eq!(req.source_type, "metrics");
        assert!(req.available_dimensions.is_empty());
    }

    #[test]
    fn test_correlation_request_missing_required_field() {
        let json = r#"{
            "source_stream": "default",
            "available_dimensions": {}
        }"#;
        let result = serde_json::from_str::<CorrelationRequest>(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_correlation_request_missing_dimensions_field() {
        let json = r#"{
            "source_stream": "default",
            "source_type": "logs"
        }"#;
        let result = serde_json::from_str::<CorrelationRequest>(json);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Group B: CardinalityClass — boundary values and methods
    // -----------------------------------------------------------------------

    #[test]
    fn test_cardinality_class_boundary_values() {
        assert_eq!(
            CardinalityClass::from_cardinality(0),
            CardinalityClass::VeryLow
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10),
            CardinalityClass::VeryLow
        );
        assert_eq!(
            CardinalityClass::from_cardinality(11),
            CardinalityClass::Low
        );
        assert_eq!(
            CardinalityClass::from_cardinality(100),
            CardinalityClass::Low
        );
        assert_eq!(
            CardinalityClass::from_cardinality(101),
            CardinalityClass::Medium
        );
        assert_eq!(
            CardinalityClass::from_cardinality(1000),
            CardinalityClass::Medium
        );
        assert_eq!(
            CardinalityClass::from_cardinality(1001),
            CardinalityClass::High
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10000),
            CardinalityClass::High
        );
        assert_eq!(
            CardinalityClass::from_cardinality(10001),
            CardinalityClass::VeryHigh
        );
    }

    #[test]
    fn test_cardinality_class_is_suitable_for_correlation() {
        assert!(CardinalityClass::VeryLow.is_suitable_for_correlation());
        assert!(CardinalityClass::Low.is_suitable_for_correlation());
        assert!(CardinalityClass::Medium.is_suitable_for_correlation());
        assert!(!CardinalityClass::High.is_suitable_for_correlation());
        assert!(!CardinalityClass::VeryHigh.is_suitable_for_correlation());
    }

    #[test]
    fn test_cardinality_class_priority_score_ordering() {
        assert!(
            CardinalityClass::VeryLow.priority_score() < CardinalityClass::Low.priority_score()
        );
        assert!(CardinalityClass::Low.priority_score() < CardinalityClass::Medium.priority_score());
        assert!(
            CardinalityClass::Medium.priority_score() < CardinalityClass::High.priority_score()
        );
        assert!(
            CardinalityClass::High.priority_score() < CardinalityClass::VeryHigh.priority_score()
        );
    }

    #[test]
    fn test_cardinality_class_priority_score_values() {
        assert_eq!(CardinalityClass::VeryLow.priority_score(), 1);
        assert_eq!(CardinalityClass::Low.priority_score(), 2);
        assert_eq!(CardinalityClass::Medium.priority_score(), 3);
        assert_eq!(CardinalityClass::High.priority_score(), 4);
        assert_eq!(CardinalityClass::VeryHigh.priority_score(), 5);
    }

    // -----------------------------------------------------------------------
    // Group C: DimensionAnalytics
    // -----------------------------------------------------------------------

    #[test]
    fn test_dimension_analytics_new() {
        let analytics = DimensionAnalytics::new("k8s-cluster".to_string());
        assert_eq!(analytics.dimension_name, "k8s-cluster");
        assert_eq!(analytics.cardinality, 0);
        assert_eq!(analytics.cardinality_class, CardinalityClass::VeryLow);
        assert_eq!(analytics.service_count, 0);
        assert!(analytics.sample_values.is_empty());
        assert!(analytics.first_seen > 0);
        assert!(analytics.last_updated > 0);
    }

    #[test]
    fn test_dimension_analytics_update() {
        let mut analytics = DimensionAnalytics::new("environment".to_string());
        let mut samples = HashMap::new();
        let mut logs_streams = HashMap::new();
        logs_streams.insert(
            "default".to_string(),
            vec!["prod".to_string(), "staging".to_string(), "dev".to_string()],
        );
        samples.insert("logs".to_string(), logs_streams);
        analytics.update(3, 10, samples.clone(), HashMap::new(), HashMap::new());

        assert_eq!(analytics.cardinality, 3);
        assert_eq!(analytics.cardinality_class, CardinalityClass::VeryLow);
        assert_eq!(analytics.service_count, 10);
        assert_eq!(analytics.sample_values, samples);
    }

    #[test]
    fn test_dimension_analytics_update_truncates_sample_values() {
        let mut analytics = DimensionAnalytics::new("host".to_string());
        let mut samples = HashMap::new();
        let mut logs_streams = HashMap::new();
        let values: Vec<String> = (0..20).map(|i| format!("host-{i}")).collect();
        logs_streams.insert("default".to_string(), values);
        samples.insert("logs".to_string(), logs_streams);
        analytics.update(20, 5, samples, HashMap::new(), HashMap::new());

        // Should be truncated to 10 per stream
        let truncated = &analytics.sample_values["logs"]["default"];
        assert_eq!(truncated.len(), 10);
        assert_eq!(truncated[0], "host-0");
        assert_eq!(truncated[9], "host-9");
    }

    #[test]
    fn test_dimension_analytics_is_suitable_for_correlation() {
        let mut analytics = DimensionAnalytics::new("cluster".to_string());
        analytics.update(5, 10, HashMap::new(), HashMap::new(), HashMap::new());
        assert!(analytics.is_suitable_for_correlation());

        analytics.update(5000, 10, HashMap::new(), HashMap::new(), HashMap::new());
        assert!(!analytics.is_suitable_for_correlation());
    }

    // -----------------------------------------------------------------------
    // Group D: Response format / structure tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_correlation_response_json_structure() {
        let response = CorrelationResponse::new(
            "api-server".to_string(),
            {
                let mut m = HashMap::new();
                m.insert("k8s-cluster".to_string(), "prod".to_string());
                m
            },
            {
                let mut m = HashMap::new();
                m.insert("host".to_string(), "node-1".to_string());
                m
            },
            RelatedStreams {
                logs: vec![StreamInfo::with_type(
                    "app_logs".to_string(),
                    StreamType::Logs,
                )],
                traces: vec![],
                metrics: vec![StreamInfo::with_type(
                    "app_metrics".to_string(),
                    StreamType::Metrics,
                )],
            },
        );

        let json = serde_json::to_value(&response).unwrap();

        assert_eq!(json["service_name"], "api-server");
        assert_eq!(json["matched_dimensions"]["k8s-cluster"], "prod");
        assert_eq!(json["additional_dimensions"]["host"], "node-1");
        assert!(json["related_streams"]["logs"].is_array());
        assert!(json["related_streams"]["traces"].is_array());
        assert!(json["related_streams"]["metrics"].is_array());
        assert_eq!(json["related_streams"]["logs"].as_array().unwrap().len(), 1);
        assert_eq!(
            json["related_streams"]["traces"].as_array().unwrap().len(),
            0
        );
        assert_eq!(
            json["related_streams"]["metrics"].as_array().unwrap().len(),
            1
        );
        assert_eq!(json["all_streams"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_correlation_response_empty_streams() {
        let response = CorrelationResponse::new(
            "orphan-service".to_string(),
            HashMap::new(),
            HashMap::new(),
            RelatedStreams {
                logs: vec![],
                traces: vec![],
                metrics: vec![],
            },
        );

        assert!(response.all_streams.is_empty());

        let json = serde_json::to_value(&response).unwrap();
        assert!(json.get("all_streams").is_none());
    }

    #[test]
    fn test_stream_summary_full_correlation() {
        let summary = StreamSummary {
            logs_count: 2,
            traces_count: 1,
            metrics_count: 3,
            has_full_correlation: true,
        };

        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["has_full_correlation"], true);
    }

    #[test]
    fn test_service_streams_empty_fields_skipped_in_json() {
        let streams = ServiceStreams {
            logs: vec!["app_logs".to_string()],
            traces: vec![],
            metrics: vec![],
        };

        let json = serde_json::to_value(&streams).unwrap();
        assert!(json.get("logs").is_some());
        assert!(json.get("traces").is_none());
        assert!(json.get("metrics").is_none());
    }

    #[test]
    fn test_stream_info_new_defaults_to_logs() {
        let stream = StreamInfo::new("my_stream".to_string());
        assert_eq!(stream.stream_type, StreamType::Logs);
        assert!(stream.filters.is_empty());
    }

    #[test]
    fn test_stream_info_set_stream_type_builder() {
        let stream = StreamInfo::new("my_stream".to_string()).set_stream_type(StreamType::Metrics);
        assert_eq!(stream.stream_type, StreamType::Metrics);
    }

    #[test]
    fn test_stream_info_with_filters() {
        let mut filters = HashMap::new();
        filters.insert("env".to_string(), "prod".to_string());
        filters.insert("region".to_string(), "us-east-1".to_string());

        let stream = StreamInfo::with_filters("app".to_string(), filters.clone());
        assert_eq!(stream.stream_name, "app");
        assert_eq!(stream.stream_type, StreamType::Logs);
        assert_eq!(stream.filters, filters);
    }

    #[test]
    fn test_stream_info_json_omits_empty_filters() {
        let stream = StreamInfo::with_type("app".to_string(), StreamType::Logs);
        let json = serde_json::to_value(&stream).unwrap();
        assert!(json.get("filters").is_none());
    }

    #[test]
    fn test_stream_info_json_includes_nonempty_filters() {
        let mut filters = HashMap::new();
        filters.insert("ns".to_string(), "default".to_string());
        let stream =
            StreamInfo::with_type_and_filters("app".to_string(), StreamType::Traces, filters);
        let json = serde_json::to_value(&stream).unwrap();

        assert!(json.get("filters").is_some());
        assert_eq!(json["filters"]["ns"], "default");
    }

    // -----------------------------------------------------------------------
    // Group E: FieldAlias additional coverage
    // -----------------------------------------------------------------------

    #[test]
    fn test_field_alias_with_group() {
        use config::meta::correlation::FieldAlias;

        let group = FieldAlias::with_group(
            "k8s-pod",
            "K8s Pod",
            "Kubernetes",
            &["pod", "pod_name", "k8s.pod.name"],
        );
        assert_eq!(group.id, "k8s-pod");
        assert_eq!(group.display, "K8s Pod");
        assert_eq!(group.group, Some("Kubernetes".to_string()));
        assert_eq!(group.fields.len(), 3);
    }

    #[test]
    fn test_field_alias_new() {
        use config::meta::correlation::FieldAlias;

        let group = FieldAlias::new("environment", "Environment", &["env", "environment"]);
        assert_eq!(group.id, "environment");
        assert_eq!(group.display, "Environment");
        assert!(group.group.is_none());
        assert_eq!(group.fields.len(), 2);
    }

    #[test]
    fn test_field_alias_validate_id_edge_cases() {
        use config::meta::correlation::FieldAlias;

        assert!(FieldAlias::validate_id("a"));
        assert!(FieldAlias::validate_id("1"));
        assert!(FieldAlias::validate_id("k8s-cluster-01"));
        assert!(FieldAlias::validate_id("123"));
        assert!(!FieldAlias::validate_id("K8S"));
        assert!(!FieldAlias::validate_id("k8s_cluster"));
        assert!(!FieldAlias::validate_id("k8s cluster"));
        assert!(!FieldAlias::validate_id("k8s.cluster"));
    }

    #[test]
    fn test_cardinality_class_serde_roundtrip() {
        for class in [
            CardinalityClass::VeryLow,
            CardinalityClass::Low,
            CardinalityClass::Medium,
            CardinalityClass::High,
            CardinalityClass::VeryHigh,
        ] {
            let json = serde_json::to_string(&class).unwrap();
            let deserialized: CardinalityClass = serde_json::from_str(&json).unwrap();
            assert_eq!(class, deserialized);
        }
    }

    #[test]
    fn test_cardinality_class_ordering() {
        assert!(CardinalityClass::VeryLow < CardinalityClass::Low);
        assert!(CardinalityClass::Low < CardinalityClass::Medium);
        assert!(CardinalityClass::Medium < CardinalityClass::High);
        assert!(CardinalityClass::High < CardinalityClass::VeryHigh);
    }
}

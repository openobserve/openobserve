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

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::anomaly_detection as anomaly_service,
};

/// List all anomaly detection configurations for an organization
#[utoipa::path(
    get,
    path = "/{org_id}/anomaly_detection",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "ListAnomalyConfigs",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AnomalyConfigListResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn list_configs(Path(org_id): Path<String>) -> Response {
    match anomaly_service::list_configs(&org_id).await {
        Ok(configs) => MetaHttpResponse::json(configs),
        Err(e) => {
            tracing::error!("Failed to list anomaly configs: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// Get a specific anomaly detection configuration
#[utoipa::path(
    get,
    path = "/{org_id}/anomaly_detection/{config_id}",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "GetAnomalyConfig",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AnomalyConfigResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn get_config(Path((org_id, config_id)): Path<(String, String)>) -> Response {
    match anomaly_service::get_config(&org_id, &config_id).await {
        Ok(Some(config)) => MetaHttpResponse::json(config),
        Ok(None) => MetaHttpResponse::error(
            StatusCode::NOT_FOUND.as_u16(),
            format!("Anomaly config not found: {}", config_id),
        )
        .into_response(),
        Err(e) => {
            tracing::error!("Failed to get anomaly config: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// Create a new anomaly detection configuration
#[utoipa::path(
    post,
    path = "/{org_id}/anomaly_detection",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "CreateAnomalyConfig",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
    ),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = AnomalyConfigResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
    request_body(
        content = CreateAnomalyConfigRequest,
        description = "Anomaly detection configuration",
        content_type = "application/json",
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn create_config(
    Path(org_id): Path<String>,
    Json(req): Json<CreateAnomalyConfigRequest>,
) -> Response {
    match anomaly_service::create_config(&org_id, req).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(e) => {
            tracing::error!("Failed to create anomaly config: {}", e);
            let status = if e.to_string().contains("validation") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            MetaHttpResponse::error(status.as_u16(), e.to_string()).into_response()
        }
    }
}

/// Update an existing anomaly detection configuration
#[utoipa::path(
    put,
    path = "/{org_id}/anomaly_detection/{config_id}",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "UpdateAnomalyConfig",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AnomalyConfigResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
    request_body(
        content = UpdateAnomalyConfigRequest,
        description = "Updated configuration",
        content_type = "application/json",
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn update_config(
    Path((org_id, config_id)): Path<(String, String)>,
    Json(req): Json<UpdateAnomalyConfigRequest>,
) -> Response {
    match anomaly_service::update_config(&org_id, &config_id, req).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(e) if e.to_string().contains("not found") => {
            MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), e.to_string()).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to update anomaly config: {}", e);
            let status = if e.to_string().contains("validation") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            MetaHttpResponse::error(status.as_u16(), e.to_string()).into_response()
        }
    }
}

/// Delete an anomaly detection configuration
#[utoipa::path(
    delete,
    path = "/{org_id}/anomaly_detection/{config_id}",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "DeleteAnomalyConfig",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DeleteResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn delete_config(Path((org_id, config_id)): Path<(String, String)>) -> Response {
    match anomaly_service::delete_config(&org_id, &config_id).await {
        Ok(_) => MetaHttpResponse::message(
            StatusCode::OK.as_u16(),
            "Anomaly config deleted successfully".to_string(),
        )
        .into_response(),
        Err(e) if e.to_string().contains("not found") => {
            MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), e.to_string()).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to delete anomaly config: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// Trigger manual training for a configuration
#[utoipa::path(
    post,
    path = "/{org_id}/anomaly_detection/{config_id}/train",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "TrainAnomalyModel",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = TrainingResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn train_model(Path((org_id, config_id)): Path<(String, String)>) -> Response {
    match anomaly_service::train_model(&org_id, &config_id).await {
        Ok(result) => MetaHttpResponse::json(result),
        Err(e) if e.to_string().contains("not found") || e.to_string().contains("disabled") => {
            MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), e.to_string()).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to train model: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// Trigger manual detection for a configuration
#[utoipa::path(
    post,
    path = "/{org_id}/anomaly_detection/{config_id}/detect",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "DetectAnomalies",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DetectionResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn detect_anomalies(Path((org_id, config_id)): Path<(String, String)>) -> Response {
    match anomaly_service::detect_anomalies(&org_id, &config_id).await {
        Ok(result) => MetaHttpResponse::json(result),
        Err(e) if e.to_string().contains("not found") || e.to_string().contains("disabled") => {
            MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), e.to_string()).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to detect anomalies: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// Get detection history for a configuration
#[utoipa::path(
    get,
    path = "/{org_id}/anomaly_detection/{config_id}/history",
    context_path = "/api",
    tag = "Anomaly Detection",
    operation_id = "GetDetectionHistory",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("config_id" = String, Path, description = "Anomaly config identifier"),
        ("limit" = Option<i64>, Query, description = "Maximum number of results"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DetectionHistoryResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, config_id = %config_id))]
pub async fn get_detection_history(
    Path((org_id, config_id)): Path<(String, String)>,
    Query(query): Query<HistoryQuery>,
) -> Response {
    let limit = query.limit.unwrap_or(100);

    match anomaly_service::get_detection_history(&org_id, &config_id, limit).await {
        Ok(history) => MetaHttpResponse::json(history),
        Err(e) => {
            tracing::error!("Failed to get detection history: {}", e);
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

// Request/Response types

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateAnomalyConfigRequest {
    pub config_id: String,
    pub stream_name: String,
    pub alert_id: Option<String>,
    pub query_mode: String, // "filters" or "custom_sql"
    pub filters: Option<Vec<FilterRequest>>,
    pub custom_sql: Option<String>,
    pub detection_function: String, // "count(*)", "avg(field)", etc.
    pub anomaly_threshold: f64,
    pub detection_frequency_hours: i64,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateAnomalyConfigRequest {
    pub alert_id: Option<String>,
    pub query_mode: Option<String>,
    pub filters: Option<Vec<FilterRequest>>,
    pub custom_sql: Option<String>,
    pub detection_function: Option<String>,
    pub anomaly_threshold: Option<f64>,
    pub detection_frequency_hours: Option<i64>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FilterRequest {
    pub field: String,
    pub operator: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HistoryQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AnomalyConfigResponse {
    // Response mirrors the database structure
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AnomalyConfigListResponse {
    pub configs: Vec<AnomalyConfigResponse>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TrainingResponse {
    pub model_version: i64,
    pub trained_points: usize,
    pub s3_path: String,
    pub model_size_bytes: usize,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DetectionResponse {
    pub config_id: String,
    pub model_version: i64,
    pub points_scored: usize,
    pub anomalies_detected: usize,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DetectionHistoryResponse {
    pub history: Vec<DetectionHistoryItem>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DetectionHistoryItem {
    pub timestamp: i64,
    pub anomalies_detected: usize,
    pub points_scored: usize,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DeleteResponse {
    pub message: String,
}

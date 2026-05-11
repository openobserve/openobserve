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

use std::str::FromStr;

use axum::{
    Json,
    extract::{OriginalUri, Path, Query},
    http::StatusCode,
    response::Response,
};
use config::meta::{
    alerts::alert::{Alert as MetaAlert, AlertTypeFilter},
    triggers::{Trigger, TriggerModule},
};
use hashbrown::HashMap;
use infra::db::{ORM_CLIENT, connect_to_orm};
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::auth::check_permissions,
    crate::handler::http::request::search::utils::{
        StreamPermissionResourceType, check_stream_permissions,
    },
};

#[cfg(feature = "enterprise")]
use crate::handler::http::models::alerts::requests::UpdateAnomalyAlertFields;
#[cfg(feature = "enterprise")]
use crate::handler::http::models::alerts::responses::anomaly_config_to_list_item;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::alerts::{
            requests::{
                AlertBulkEnableRequest, CloneAlertRequestBody, CreateAlertRequestBody,
                EnableAlertQuery, GenerateSqlRequestBody, ListAlertsQuery, MoveAlertsRequestBody,
                UpdateAlertRequestBody,
            },
            responses::{
                AlertBulkEnableResponse, EnableAlertResponseBody, GenerateSqlMetadata,
                GenerateSqlResponseBody, GetAlertResponseBody, ListAlertsResponseBody,
                ListAlertsResponseBodyItem,
            },
        },
        request::{
            BulkDeleteRequest, BulkDeleteResponse,
            dashboards::{get_folder, is_overwrite},
        },
    },
    service::{
        alerts::{
            ConditionListExt,
            alert::{self, AlertError},
            build_sql,
        },
        db::scheduler,
    },
};

pub mod dedup_stats;
pub mod deduplication;
pub mod destinations;
pub mod history;
pub mod incidents;
pub mod templates;

impl From<AlertError> for Response {
    fn from(value: AlertError) -> Self {
        match &value {
            AlertError::InfraError(err) => MetaHttpResponse::internal_error(err),
            AlertError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
            AlertError::AlertNameMissing => MetaHttpResponse::bad_request(value),
            AlertError::AlertNameOfgaUnsupported => MetaHttpResponse::bad_request(value),
            AlertError::AlertNameContainsForwardSlash => MetaHttpResponse::bad_request(value),
            AlertError::AlertDestinationMissing => MetaHttpResponse::bad_request(value),
            AlertError::CreateAlreadyExists => MetaHttpResponse::conflict(value),
            AlertError::CreateFolderNotFound => MetaHttpResponse::not_found(value),
            AlertError::MoveDestinationFolderNotFound => MetaHttpResponse::not_found(value),
            AlertError::AlertNotFound => MetaHttpResponse::not_found(value),
            AlertError::AlertDestinationNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::TemplateNotConfigured { .. } => MetaHttpResponse::bad_request(value),
            AlertError::AlertTemplateNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::StreamNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::DecodeVrl(err) => MetaHttpResponse::bad_request(err),
            AlertError::ParseCron(err) => MetaHttpResponse::bad_request(err),
            AlertError::RealtimeMissingCustomQuery => MetaHttpResponse::bad_request(value),
            AlertError::SqlMissingQuery => MetaHttpResponse::bad_request(value),
            AlertError::SqlContainsSelectStar => MetaHttpResponse::bad_request(value),
            AlertError::PromqlMissingQuery => MetaHttpResponse::bad_request(value),
            AlertError::SendNotificationError { .. } => MetaHttpResponse::internal_error(value),
            AlertError::GetDestinationWithTemplateError(err) => {
                MetaHttpResponse::internal_error(err)
            }
            AlertError::PeriodExceedsMaxQueryRange { .. } => MetaHttpResponse::bad_request(value),
            AlertError::ResolveStreamNameError(_) => MetaHttpResponse::internal_error(value),
            AlertError::PermittedAlertsMissingUser => MetaHttpResponse::forbidden(""),
            AlertError::PermittedAlertsValidator(err) => MetaHttpResponse::forbidden(err),
            AlertError::NotSupportedAlertDestinationType(err) => MetaHttpResponse::forbidden(err),
            AlertError::PermissionDenied => MetaHttpResponse::forbidden("Unauthorized access"),
            AlertError::UserNotFound => MetaHttpResponse::forbidden("Unauthorized access"),
            AlertError::AlertIdMissing => MetaHttpResponse::bad_request(value),
        }
    }
}

/// CreateAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateAlert",
    summary = "Create new alert",
    description = "Creates a new alert with specified conditions, triggers, and notifications. Users can define custom queries, thresholds, and notification destinations to monitor their data and receive timely alerts when conditions are met.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if alert folder is not the default folder)"),
      ),
    request_body(content = inline(CreateAlertRequestBody), description = "Alert data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a new alert rule with flexible query options. IMPORTANT: Alert name must use snake_case (no spaces/special chars like :,#,?,&,%,/,quotes), destinations array is required with valid destination names. QueryCondition supports 3 query types: (1) Custom - uses conditions, aggregation, vrl_function, search_event_type, multi_time_range; (2) SQL - uses sql, vrl_function, search_event_type; (3) PromQL - uses promql, promql_condition, multi_time_range", "category": "alerts"}))
    )
)]
pub async fn create_alert(
    Path(org_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<CreateAlertRequestBody>,
) -> Response {
    let query_str = uri.query().unwrap_or("");
    let folder_id = get_folder(query_str);

    // Anomaly detection path: delegate to anomaly config creation (enterprise only).
    #[cfg(feature = "enterprise")]
    if req_body.alert_type == Some(AlertTypeFilter::AnomalyDetection) {
        return create_anomaly_alert(&org_id, user_email.user_id, req_body, &folder_id).await;
    }
    let overwrite = is_overwrite(query_str);
    let mut alert: MetaAlert = req_body.into();
    if alert.owner.clone().filter(|o| !o.is_empty()).is_none() {
        alert.owner = Some(user_email.user_id.clone());
    }
    alert.last_edited_by = Some(user_email.user_id);

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::create(client, &org_id, &folder_id, alert, overwrite).await {
        Ok(v) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Alert saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        ),
        Err(e) => e.into(),
    }
}

#[cfg(feature = "enterprise")]
async fn create_anomaly_alert(
    org_id: &str,
    user_id: String,
    req_body: CreateAlertRequestBody,
    query_folder_id: &str,
) -> Response {
    use crate::handler::http::request::anomaly_detection::CreateAnomalyConfigRequest;

    let Some(anomaly_fields) = req_body.anomaly_fields() else {
        return MetaHttpResponse::bad_request(
            "detection_function is required when alert_type is anomaly_detection",
        );
    };

    let owner = if req_body.alert.owner.as_deref().unwrap_or("").is_empty() {
        Some(user_id)
    } else {
        req_body.alert.owner
    };

    let req = CreateAnomalyConfigRequest {
        name: req_body.alert.name,
        description: Some(req_body.alert.description).filter(|d| !d.is_empty()),
        stream_name: req_body.alert.stream_name,
        stream_type: config::meta::stream::StreamType::from(req_body.alert.stream_type).to_string(),
        query_mode: anomaly_fields.query_mode,
        filters: anomaly_fields.filters,
        custom_sql: anomaly_fields.custom_sql,
        // detection_function is already in combined form "avg(field)" from anomaly_fields()
        detection_function: anomaly_fields.detection_function,
        detection_function_field: None,
        histogram_interval: anomaly_fields.histogram_interval,
        schedule_interval: anomaly_fields.schedule_interval,
        detection_window_seconds: anomaly_fields.detection_window_seconds,
        training_window_days: anomaly_fields.training_window_days,
        retrain_interval_days: anomaly_fields.retrain_interval_days,
        percentile: anomaly_fields.percentile,
        rcf_num_trees: anomaly_fields.rcf_num_trees,
        rcf_tree_size: anomaly_fields.rcf_tree_size,
        rcf_shingle_size: anomaly_fields.rcf_shingle_size,
        alert_enabled: anomaly_fields.alert_enabled,
        alert_destinations: req_body.alert.destinations,
        enabled: Some(req_body.alert.enabled),
        // Prefer explicit folder_id in JSON body; fall back to the ?folder= query param
        // (same mechanism regular alerts use — the UI sends folder as a query param).
        folder_id: req_body
            .folder_id
            .filter(|f| !f.is_empty())
            .or_else(|| Some(query_folder_id.to_string()).filter(|f| !f.is_empty())),
        owner,
    };

    match crate::service::anomaly_detection::create_config(org_id, req).await {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// GetAlert
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlert",
    summary = "Get alert details",
    description = "Retrieves detailed information about a specific alert including its configuration, conditions, triggers, notification settings, and current status. Useful for viewing and understanding existing alert setups.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(GetAlertResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get alert details by ID", "category": "alerts"}))
    )
)]
pub async fn get_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((_, alert)) => {
            let key = alert.get_unique_key();
            let scheduled_job = scheduler::get(&org_id, TriggerModule::Alert, &key)
                .await
                .ok();
            let resp_body: GetAlertResponseBody = (alert, scheduled_job).into();
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config lookup.
                match crate::service::anomaly_detection::get_config(&org_id, &alert_id_str).await {
                    Ok(Some(mut v)) => {
                        // Tag with alert_type so the caller can discriminate.
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert(
                                "alert_type".to_string(),
                                serde_json::Value::String("anomaly_detection".to_string()),
                            );
                        }
                        MetaHttpResponse::json(v)
                    }
                    Ok(None) => {
                        MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
                    }
                    Err(e) => MetaHttpResponse::internal_error(e.to_string()),
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// ExportAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/export",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExportAlert",
    summary = "Export alert configuration",
    description = "Exports the complete configuration of a specific alert in a format suitable for backup, sharing, or importing into other environments. Includes all alert settings, conditions, and notification configurations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(GetAlertResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Export alert as JSON", "category": "alerts"}))
    )
)]
pub async fn export_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((_, alert)) => {
            let key = alert.get_unique_key();
            let scheduled_job = scheduler::get(&org_id, TriggerModule::Alert, &key)
                .await
                .ok();
            let resp_body: GetAlertResponseBody = (alert, scheduled_job).into();
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found("alert not found")
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config export
                match crate::service::anomaly_detection::get_config(&org_id, &alert_id_str).await {
                    Ok(Some(mut v)) => {
                        // Inject alert_type so consumers know what kind this is
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert(
                                "alert_type".to_string(),
                                serde_json::Value::String("anomaly_detection".to_string()),
                            );
                            // Strip runtime/training state from the export payload
                            for key in &[
                                "is_trained",
                                "training_started_at",
                                "training_completed_at",
                                "last_processed_timestamp",
                                "current_model_version",
                                "status",
                                "last_error",
                                "retries",
                            ] {
                                obj.remove(*key);
                            }
                        }
                        MetaHttpResponse::json(v)
                    }
                    Ok(None) => MetaHttpResponse::not_found("alert not found"),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// CloneAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/clone",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CloneAlert",
    summary = "Clone an alert or anomaly detection config",
    description = "Creates a copy of an existing alert or anomaly detection config. For anomaly configs, the clone starts untrained with counters reset. Provide an optional name and folder_id in the request body.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Source alert or anomaly config ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    request_body(content = inline(CloneAlertRequestBody), description = "Clone options", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
    )
)]
pub async fn clone_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Json(req_body): Json<CloneAlertRequestBody>,
) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Check if this is a regular alert first
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((folder, mut src_alert)) => {
            // Clone the alert: copy fields, generate new name
            let new_name = req_body
                .name
                .unwrap_or_else(|| format!("{}_copy", src_alert.name));
            let dst_folder = req_body
                .folder_id
                .unwrap_or_else(|| folder.folder_id.clone());
            src_alert.name = new_name;
            // Clear the ID so a new one is assigned on insert
            src_alert.id = None;
            match alert::create(client, &org_id, &dst_folder, src_alert, false).await {
                Ok(saved) => MetaHttpResponse::json(saved),
                Err(e) => e.into(),
            }
        }
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config clone
                match crate::service::anomaly_detection::clone_config(
                    &org_id,
                    &alert_id_str,
                    req_body.name,
                    req_body.folder_id,
                )
                .await
                {
                    Ok(v) => MetaHttpResponse::json(v),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// UpdateAlert
#[utoipa::path(
    put,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateAlert",
    summary = "Update alert configuration",
    description = "Updates an existing alert's configuration including conditions, queries, thresholds, notification destinations, and scheduling. Allows users to modify alert behavior and settings as monitoring requirements change.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    request_body(content = inline(UpdateAlertRequestBody), description = "Alert data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update an existing alert", "category": "alerts"}))
    )
)]
pub async fn update_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<UpdateAlertRequestBody>,
) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };

    // Explicit anomaly detection path (enterprise only).
    #[cfg(feature = "enterprise")]
    if req_body.alert_type == Some(AlertTypeFilter::AnomalyDetection) {
        let alert = req_body.alert.clone();
        let anomaly_fields = req_body.anomaly_fields();
        return build_and_run_anomaly_update(
            &org_id,
            &alert_id_str,
            user_email.user_id,
            anomaly_fields,
            alert,
        )
        .await;
    }

    // Save anomaly fields before req_body is consumed, in case we need the fallback.
    #[cfg(feature = "enterprise")]
    let anomaly_config = req_body.anomaly_fields();
    #[cfg(feature = "enterprise")]
    let alert_fields_for_fallback = req_body.alert.clone();

    let mut alert: MetaAlert = req_body.into();
    alert.last_edited_by = Some(user_email.user_id.clone());
    alert.id = Some(alert_id);

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::update(client, &org_id, None, alert).await {
        Ok(_) => MetaHttpResponse::ok("Alert Updated"),
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // ID not in alerts table — try anomaly config.
                build_and_run_anomaly_update(
                    &org_id,
                    &alert_id_str,
                    user_email.user_id,
                    anomaly_config,
                    alert_fields_for_fallback,
                )
                .await
            }
        }
        Err(e) => e.into(),
    }
}

#[cfg(feature = "enterprise")]
async fn build_and_run_anomaly_update(
    org_id: &str,
    anomaly_id: &str,
    user_id: String,
    fields: UpdateAnomalyAlertFields,
    alert: crate::handler::http::models::alerts::Alert,
) -> Response {
    use crate::handler::http::request::anomaly_detection::UpdateAnomalyConfigRequest;

    let owner = fields
        .owner
        .or_else(|| alert.owner.clone())
        .or(Some(user_id));
    let name = fields
        .name
        .or_else(|| Some(alert.name).filter(|n| !n.is_empty()));
    let description = fields
        .description
        .or_else(|| Some(alert.description).filter(|d| !d.is_empty()));

    let req = UpdateAnomalyConfigRequest {
        name,
        description,
        query_mode: fields.query_mode,
        filters: fields.filters,
        custom_sql: fields.custom_sql,
        detection_function: fields.detection_function,
        detection_function_field: None, /* already combined into detection_function by
                                         * anomaly_fields() */
        histogram_interval: fields.histogram_interval,
        schedule_interval: fields.schedule_interval,
        detection_window_seconds: fields.detection_window_seconds,
        training_window_days: fields.training_window_days,
        percentile: fields.percentile,
        retrain_interval_days: fields.retrain_interval_days,
        alert_enabled: fields.alert_enabled,
        alert_destinations: Some(alert.destinations),
        enabled: fields.enabled,
        folder_id: fields.folder_id,
        owner,
    };

    match crate::service::anomaly_detection::update_config(org_id, anomaly_id, req).await {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// DeleteAlert
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlert",
    summary = "Delete alert",
    description = "Permanently removes an alert and all its configurations including conditions, triggers, and notification settings. This action cannot be undone and will stop all monitoring and notifications for the deleted alert.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete an alert by ID", "category": "alerts", "requires_confirmation": true}))
    )
)]
pub async fn delete_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Check whether this ID belongs to a regular alert before attempting delete.
    // delete_by_id silently returns Ok(()) when the record is not found (required
    // for super-cluster sync idempotency), so we must check existence explicitly.
    let is_regular_alert = alert::get_by_id(client, &org_id, alert_id).await.is_ok();

    if is_regular_alert {
        return match alert::delete_by_id(client, &org_id, alert_id).await {
            Ok(_) => MetaHttpResponse::ok("Alert deleted"),
            Err(e) => e.into(),
        };
    }

    // Not a regular alert — try anomaly detection config (enterprise only).
    #[cfg(feature = "enterprise")]
    {
        match crate::service::anomaly_detection::delete_config(&org_id, &alert_id_str).await {
            Ok(_) => MetaHttpResponse::ok("Alert deleted"),
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                if msg.contains("not found") {
                    MetaHttpResponse::not_found(e.to_string())
                } else {
                    MetaHttpResponse::internal_error(e.to_string())
                }
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
}

/// DeleteAlertBulk
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/bulk",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertBulk",
    summary = "Delete multiple alerts",
    description = "Permanently removes multiple alerts and all their configurations including conditions, triggers, and notification settings. This action cannot be undone and will stop all monitoring and notifications for the deleted alerts.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    request_body(content = BulkDeleteRequest, description = "Alert ids", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_alert_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;
    let _folder_id = crate::common::utils::http::get_folder(&query);

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if Ksuid::from_str(id).is_err() {
            return MetaHttpResponse::bad_request(format!("invalid alert id {id}"));
        };
        if !check_permissions(
            id,
            &org_id,
            &_user_id,
            "alerts",
            "DELETE",
            Some(&_folder_id),
            false,
            false,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    for id in req.ids {
        // already checked this is valid, so ok to unwrap
        let alert_id = Ksuid::from_str(&id).unwrap();
        let is_regular_alert = alert::get_by_id(client, &org_id, alert_id).await.is_ok();
        let result = if is_regular_alert {
            alert::delete_by_id(client, &org_id, alert_id)
                .await
                .map_err(|e| e.to_string())
        } else {
            // Not a regular alert — fall back to anomaly config delete (enterprise only).
            #[cfg(not(feature = "enterprise"))]
            {
                Err(format!("alert {id} not found"))
            }
            #[cfg(feature = "enterprise")]
            crate::service::anomaly_detection::delete_config(&org_id, &id)
                .await
                .map_err(|e: anyhow::Error| e.to_string())
        };
        match result {
            Ok(_) => successful.push(id),
            Err(e) => {
                log::error!("error deleting alert {org_id}/{id} : {e}");
                unsuccessful.push(id);
                err = Some(e);
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// ListAlerts
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlerts",
    summary = "List organization alerts",
    description = "Retrieves a list of all alerts in the organization with filtering and pagination options. Shows alert summaries including names, status, folder organization, and basic configuration details for monitoring and management purposes.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListAlertsQuery,
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ListAlertsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all alerts",
            "category": "alerts",
            "summary_fields": ["name", "stream_name", "stream_type", "enabled", "is_real_time", "folder_id", "folder_name"]
        }))
    )
)]
pub async fn list_alerts(
    Path(org_id): Path<String>,
    Query(query): Query<ListAlertsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id = None;
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());

    #[cfg(feature = "enterprise")]
    let folder_slug = query.folder.clone();
    #[cfg(feature = "enterprise")]
    let name_substring = query.alert_name_substring.clone();
    #[cfg(feature = "enterprise")]
    let page_size_and_idx = query.page_size.map(|s| (s, query.page_idx.unwrap_or(0)));

    #[cfg(not(feature = "enterprise"))]
    let params = query.into(&org_id);
    #[cfg(feature = "enterprise")]
    let mut params = query.into(&org_id);

    let alert_type = params.alert_type;

    // In enterprise builds, pagination is applied after merging regular alerts with
    // anomaly detection configs, so we fetch all matching results from the DB here.
    #[cfg(feature = "enterprise")]
    {
        params.page_size_and_idx = None;
    }

    // Fetch regular (scheduled / realtime) alerts unless the filter is anomaly-only.
    let list: Vec<ListAlertsResponseBodyItem> = if alert_type != AlertTypeFilter::AnomalyDetection {
        let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
        let mut scheduled_jobs: HashMap<String, Trigger> =
            scheduler::list_by_org(&org_id, Some(TriggerModule::Alert))
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|t| (t.module_key.clone(), t))
                .collect();

        let folders_and_alerts = match alert::list_v2(client, user_id, params).await {
            Ok(v) => v,
            Err(e) => return e.into(),
        };

        folders_and_alerts
                .into_iter()
                // Apply is_real_time filter when a specific type is requested.
                .filter(|(_, a)| match alert_type {
                    AlertTypeFilter::Scheduled => !a.is_real_time,
                    AlertTypeFilter::Realtime => a.is_real_time,
                    _ => true,
                })
                .map(|(folder, alert)| {
                    let key = alert.get_unique_key();
                    (folder, alert, scheduled_jobs.remove(&key))
                })
                .filter_map(|item| ListAlertsResponseBodyItem::try_from(item).ok())
                .collect()
    } else {
        vec![]
    };
    // In enterprise builds, anomaly configs will be appended — we need mutability.
    #[cfg(feature = "enterprise")]
    let mut list = list;

    // Fetch anomaly detection configs and merge when the filter includes them (enterprise only).
    #[cfg(feature = "enterprise")]
    if matches!(
        alert_type,
        AlertTypeFilter::All | AlertTypeFilter::AnomalyDetection
    ) && let Ok(configs) = crate::service::anomaly_detection::list_configs(
        &org_id,
        folder_slug.as_deref(),
        name_substring.as_deref(),
    )
    .await
    {
        list.extend(configs.iter().filter_map(anomaly_config_to_list_item));
    }

    // Apply pagination to the combined list (regular alerts + anomaly configs).
    #[cfg(feature = "enterprise")]
    let list = if let Some((page_size, page_idx)) = page_size_and_idx {
        // Use saturating_mul to prevent u64 overflow before casting to usize.
        let start = page_idx.saturating_mul(page_size) as usize;
        list.into_iter()
            .skip(start)
            .take(page_size as usize)
            .collect()
    } else {
        list
    };

    MetaHttpResponse::json(ListAlertsResponseBody { list })
}

/// EnableAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/enable",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EnableAlert",
    summary = "Enable or disable alert",
    description = "Toggles the active status of an alert to enable or disable its monitoring and notification functionality. When disabled, the alert will stop evaluating conditions and sending notifications until re-enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        EnableAlertQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Enable or disable an alert", "category": "alerts"}))
    )
)]
pub async fn enable_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<EnableAlertQuery>,
) -> Response {
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let should_enable = query.value;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::enable_by_id(client, &org_id, alert_id, should_enable).await {
        Ok(_) => {
            let resp_body = EnableAlertResponseBody {
                enabled: should_enable,
            };
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config
                use crate::handler::http::request::anomaly_detection::UpdateAnomalyConfigRequest;
                let req = UpdateAnomalyConfigRequest {
                    enabled: Some(should_enable),
                    ..Default::default()
                };
                match crate::service::anomaly_detection::update_config(
                    &org_id,
                    &alert_id.to_string(),
                    req,
                )
                .await
                {
                    Ok(_) => MetaHttpResponse::json(EnableAlertResponseBody {
                        enabled: should_enable,
                    }),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// EnableAlertBulk
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/bulk/enable",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EnableAlertBulk",
    summary = "Enable or disable alert in bulk",
    description = "Toggles the active status of alerts to enable or disable its monitoring and notification functionality in bulk. When disabled, the alert will stop evaluating conditions and sending notifications until re-enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        EnableAlertQuery,
    ),
    request_body(content = inline(AlertBulkEnableRequest), description = "Alert id list", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn enable_alert_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<EnableAlertQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(req): Json<AlertBulkEnableRequest>,
) -> Response {
    let should_enable = query.value;

    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;

        for id in &req.ids {
            if !check_permissions(
                &id.to_string(),
                &org_id,
                user_id,
                "alerts",
                "PUT",
                None,
                false,
                false,
                false,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    for id in req.ids {
        match alert::enable_by_id(client, &org_id, id, should_enable).await {
            Ok(_) => {
                successful.push(id);
            }
            Err(AlertError::AlertNotFound) => {
                #[cfg(not(feature = "enterprise"))]
                {
                    unsuccessful.push(id);
                    err = Some(format!("alert {id} not found"));
                }
                #[cfg(feature = "enterprise")]
                {
                    // Fall back to anomaly detection config
                    use crate::handler::http::request::anomaly_detection::UpdateAnomalyConfigRequest;
                    let req = UpdateAnomalyConfigRequest {
                        enabled: Some(should_enable),
                        ..Default::default()
                    };
                    match crate::service::anomaly_detection::update_config(
                        &org_id,
                        &id.to_string(),
                        req,
                    )
                    .await
                    {
                        Ok(_) => successful.push(id),
                        Err(e) => {
                            log::error!("error in enabling anomaly config {id} : {e}");
                            unsuccessful.push(id);
                            err = Some(e.to_string());
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("error in enabling alert {id} : {e}");
                unsuccessful.push(id);
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(AlertBulkEnableResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// TriggerAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/trigger",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "TriggerAlert",
    summary = "Manually trigger alert",
    description = "Manually triggers an alert to test its functionality and notification delivery. Useful for testing alert configurations, verifying notification channels, and ensuring alerts work as expected before relying on them for monitoring.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Manually trigger an alert", "category": "alerts"}))
    )
)]
pub async fn trigger_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::trigger_by_id(client, &org_id, alert_id).await {
        Ok(_) => MetaHttpResponse::ok("Alert triggered"),
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection — trigger a detection run
                match crate::service::anomaly_detection::detect_anomalies(
                    &org_id,
                    &alert_id.to_string(),
                )
                .await
                {
                    Ok(_) => MetaHttpResponse::ok("Detection triggered"),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// RetrainAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/retrain",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "RetrainAlert",
    summary = "Trigger retraining for an anomaly detection alert",
    description = "Triggers a model retrain for an anomaly detection alert. Returns 400 if called on a non-anomaly alert type.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Anomaly detection alert ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Not an anomaly detection alert", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
    )
)]
pub async fn retrain_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // Check if this is a regular alert — if so, return 400
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok(_) => {
            return MetaHttpResponse::bad_request(
                "retrain is only supported for anomaly detection alerts",
            );
        }
        Err(AlertError::AlertNotFound) => {
            // Expected — fall through to anomaly detection
        }
        Err(e) => return e.into(),
    }
    #[cfg(not(feature = "enterprise"))]
    {
        MetaHttpResponse::bad_request("retrain is only supported for anomaly detection alerts")
    }
    #[cfg(feature = "enterprise")]
    match crate::service::anomaly_detection::train_model(&org_id, &alert_id_str).await {
        Ok(_) => MetaHttpResponse::ok("Retraining triggered"),
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") {
                MetaHttpResponse::not_found(e.to_string())
            } else {
                MetaHttpResponse::internal_error(e.to_string())
            }
        }
    }
}

/// MoveAlerts
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/move",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "MoveAlerts",
    summary = "Move alerts between folders",
    description = "Moves one or more alerts from their current folder to a specified destination folder. Helps organize alerts into logical groups and manage access permissions when using role-based access control.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "From Folder ID (Required if RBAC enabled)"),
    ),
    request_body(content = inline(MoveAlertsRequestBody), description = "Identifies alerts and the destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move alerts to another folder", "category": "alerts"}))
    )
)]
pub async fn move_alerts(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<MoveAlertsRequestBody>,
) -> Response {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let total_ids = req_body.alert_ids.len() + req_body.anomaly_config_ids.len();

    // anomaly_config_ids is now a required Vec (defaults to empty), so no
    // per-ID DB lookups are needed to classify IDs.
    let alert_ids: Vec<Ksuid> = req_body.alert_ids;
    #[cfg(feature = "enterprise")]
    let anomaly_ids: Vec<Ksuid> = req_body.anomaly_config_ids;

    // Move anomaly configs first (enterprise only) so that if this fails,
    // regular alerts have not yet been relocated (reduces partial-move risk).
    #[cfg(feature = "enterprise")]
    for id in anomaly_ids {
        use crate::handler::http::request::anomaly_detection::UpdateAnomalyConfigRequest;
        let req = UpdateAnomalyConfigRequest {
            folder_id: Some(req_body.dst_folder_id.clone()),
            ..Default::default()
        };
        if let Err(e) =
            crate::service::anomaly_detection::update_config(&org_id, &id.to_string(), req).await
        {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") {
                return MetaHttpResponse::not_found(e.to_string());
            } else {
                return MetaHttpResponse::internal_error(e.to_string());
            }
        }
    }

    // Move regular alerts in one batch
    if !alert_ids.is_empty()
        && let Err(e) = alert::move_to_folder(
            client,
            &org_id,
            &alert_ids,
            &req_body.dst_folder_id,
            &user_email.user_id,
        )
        .await
    {
        return e.into();
    }

    let message = if total_ids == 1 {
        "Alert moved"
    } else {
        "Alerts moved"
    };
    MetaHttpResponse::ok(message)
}

/// GenerateSql
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/generate_sql",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GenerateSql",
    summary = "Generate SQL from alert query parameters",
    description = "Generates a SQL query string based on alert query parameters including stream, aggregations, and conditions. This endpoint is useful for testing alert queries and understanding the SQL that will be executed.",
    security(("Authorization"= [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(GenerateSqlRequestBody),
        description = "SQL generation parameters",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(GenerateSqlResponseBody)),
        (status = 400, description = "Bad request - invalid parameters", content_type = "application/json", body = Object),
        (status = 500, description = "Internal server error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "generate_sql"})),
        ("x-o2-mcp" = json!({"description": "Generate SQL from natural language", "category": "alerts"}))
    )
)]
pub async fn generate_sql(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    #[cfg(not(feature = "enterprise"))] Headers(_user_email): Headers<UserEmail>,
    Json(req_body): Json<GenerateSqlRequestBody>,
) -> Response {
    // Convert HTTP models to internal types
    let stream_type: config::meta::stream::StreamType = req_body.stream_type.into();
    let query_condition: config::meta::alerts::QueryCondition = req_body.query_condition.into();

    #[cfg(feature = "enterprise")]
    {
        // Check stream permissions for enterprise builds
        if let Some(response) = check_stream_permissions(
            &req_body.stream_name,
            &org_id,
            &user_email.user_id,
            &stream_type,
            StreamPermissionResourceType::Search,
        )
        .await
        {
            return response;
        }
    }

    // Validate that the stream exists
    match infra::schema::get(&org_id, &req_body.stream_name, stream_type).await {
        Err(e) => {
            log::warn!(
                "Stream validation failed for org {} stream {} ({}): {}",
                org_id,
                req_body.stream_name,
                stream_type,
                e
            );
            return MetaHttpResponse::bad_request(format!(
                "Stream '{}' of type '{}' does not exist",
                req_body.stream_name, stream_type
            ));
        }
        Ok(schema) if schema.fields().is_empty() => {
            log::warn!(
                "Stream '{}' of type '{}' in org {} has no schema (does not exist)",
                req_body.stream_name,
                stream_type,
                org_id
            );
            return MetaHttpResponse::bad_request(format!(
                "Stream '{}' of type '{}' does not exist",
                req_body.stream_name, stream_type
            ));
        }
        Ok(_) => {
            // Stream exists and has a schema, continue
        }
    }

    // Extract conditions from query_condition or use default empty conditions
    let conditions = query_condition.conditions.clone().unwrap_or(
        config::meta::alerts::AlertConditionParams::V1(
            config::meta::alerts::ConditionList::LegacyConditions(vec![]),
        ),
    );

    // Call the existing build_sql function from service layer
    match build_sql(
        &org_id,
        &req_body.stream_name,
        stream_type,
        &query_condition,
        &conditions,
    )
    .await
    {
        Ok(sql) => {
            // Calculate metadata
            let has_agg = query_condition.aggregation.is_some();
            let has_conds = conditions.len().await > 0;
            let has_group = has_agg
                && query_condition
                    .aggregation
                    .as_ref()
                    .map(|a| a.group_by.is_some() && !a.group_by.as_ref().unwrap().is_empty())
                    .unwrap_or(false);

            let response = GenerateSqlResponseBody {
                sql,
                metadata: Some(GenerateSqlMetadata {
                    has_aggregation: has_agg,
                    has_conditions: has_conds,
                    has_group_by: has_group,
                }),
            };
            MetaHttpResponse::json(response)
        }
        Err(e) => {
            let error_msg = e.to_string();
            log::warn!(
                "Failed to generate SQL for org {} stream {}: {}",
                org_id,
                req_body.stream_name,
                error_msg
            );
            MetaHttpResponse::bad_request(format!("Failed to generate SQL: {}", error_msg))
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, response::Response};

    use crate::service::alerts::alert::AlertError;

    fn status(err: AlertError) -> StatusCode {
        Response::from(err).status()
    }

    // 400 Bad Request
    #[test]
    fn test_alert_name_missing_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameMissing),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_name_contains_forward_slash_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameContainsForwardSlash),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_name_ofga_unsupported_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameOfgaUnsupported),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_destination_missing_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertDestinationMissing),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_id_missing_is_bad_request() {
        assert_eq!(status(AlertError::AlertIdMissing), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_sql_missing_query_is_bad_request() {
        assert_eq!(status(AlertError::SqlMissingQuery), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_sql_contains_select_star_is_bad_request() {
        assert_eq!(
            status(AlertError::SqlContainsSelectStar),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_promql_missing_query_is_bad_request() {
        assert_eq!(
            status(AlertError::PromqlMissingQuery),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_realtime_missing_custom_query_is_bad_request() {
        assert_eq!(
            status(AlertError::RealtimeMissingCustomQuery),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_template_not_configured_is_bad_request() {
        assert_eq!(
            status(AlertError::TemplateNotConfigured {
                dest: "slack".to_string()
            }),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_period_exceeds_max_query_range_is_bad_request() {
        assert_eq!(
            status(AlertError::PeriodExceedsMaxQueryRange {
                max_query_range_hours: 24,
                stream_name: "logs".to_string(),
            }),
            StatusCode::BAD_REQUEST
        );
    }

    // 404 Not Found
    #[test]
    fn test_alert_not_found_is_not_found() {
        assert_eq!(status(AlertError::AlertNotFound), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_create_folder_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::CreateFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_move_destination_folder_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::MoveDestinationFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_alert_destination_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::AlertDestinationNotFound {
                dest: "pagerduty".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_stream_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::StreamNotFound {
                stream_name: "events".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_alert_template_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::AlertTemplateNotFound {
                template: "default".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    // 409 Conflict
    #[test]
    fn test_create_already_exists_is_conflict() {
        assert_eq!(
            status(AlertError::CreateAlreadyExists),
            StatusCode::CONFLICT
        );
    }

    // 403 Forbidden
    #[test]
    fn test_permitted_alerts_missing_user_is_forbidden() {
        assert_eq!(
            status(AlertError::PermittedAlertsMissingUser),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_permission_denied_is_forbidden() {
        assert_eq!(status(AlertError::PermissionDenied), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_user_not_found_is_forbidden() {
        assert_eq!(status(AlertError::UserNotFound), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_permitted_alerts_validator_is_forbidden() {
        assert_eq!(
            status(AlertError::PermittedAlertsValidator("err".to_string())),
            StatusCode::FORBIDDEN
        );
    }

    // 500 Internal Server Error
    #[test]
    fn test_create_default_folder_error_is_internal_error() {
        assert_eq!(
            status(AlertError::CreateDefaultFolderError),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_send_notification_error_is_internal_error() {
        assert_eq!(
            status(AlertError::SendNotificationError {
                error_message: "timeout".to_string()
            }),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_resolve_stream_name_error_is_internal_error() {
        assert_eq!(
            status(AlertError::ResolveStreamNameError(anyhow::anyhow!("err"))),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_infra_error_is_internal_server_error() {
        let err = infra::errors::Error::DbError(infra::errors::DbError::SeaORMError(
            "db unavailable".to_string(),
        ));
        assert_eq!(
            status(AlertError::InfraError(err)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_decode_vrl_is_bad_request() {
        let io_err = std::io::Error::new(std::io::ErrorKind::InvalidData, "bad vrl");
        assert_eq!(
            status(AlertError::DecodeVrl(io_err)),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_parse_cron_is_bad_request() {
        use std::str::FromStr as _;
        let cron_err = cron::Schedule::from_str("not-a-cron").unwrap_err();
        assert_eq!(
            status(AlertError::ParseCron(cron_err)),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_get_destination_with_template_error_is_internal_server_error() {
        use crate::service::db::alerts::destinations::DestinationError;
        assert_eq!(
            status(AlertError::GetDestinationWithTemplateError(
                DestinationError::NotFound
            )),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

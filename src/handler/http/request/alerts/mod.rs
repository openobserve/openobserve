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
    alerts::alert::Alert as MetaAlert,
    triggers::{Trigger, TriggerModule},
};
use hashbrown::HashMap;
use infra::db::{ORM_CLIENT, connect_to_orm};
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::auth::check_permissions,
    crate::handler::http::request::search::utils::check_stream_permissions,
};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::alerts::{
            requests::{
                AlertBulkEnableRequest, CreateAlertRequestBody, EnableAlertQuery,
                GenerateSqlRequestBody, ListAlertsQuery, MoveAlertsRequestBody,
                UpdateAlertRequestBody,
            },
            responses::{
                AlertBulkEnableResponse, EnableAlertResponseBody, GenerateSqlMetadata,
                GenerateSqlResponseBody, GetAlertResponseBody, ListAlertsResponseBody,
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
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let mut alert: MetaAlert = req_body.into();
    alert.last_edited_by = Some(user_email.user_id);
    alert.id = Some(alert_id);

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::update(client, &org_id, None, alert).await {
        Ok(_) => MetaHttpResponse::ok("Alert Updated"),
        Err(e) => e.into(),
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
        ("x-o2-mcp" = json!({"description": "Delete an alert by ID", "category": "alerts"}))
    )
)]
pub async fn delete_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::delete_by_id(client, &org_id, alert_id).await {
        Ok(_) => MetaHttpResponse::ok("Alert deleted"),
        Err(e) => e.into(),
    }
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
        match alert::delete_by_id(client, &org_id, alert_id).await {
            Ok(_) => {
                successful.push(id);
            }
            Err(e) => {
                log::error!("error deleting alert {org_id}/{id} : {e}");
                unsuccessful.push(id);
                err = Some(e.to_string())
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
        ("x-o2-mcp" = json!({"description": "List all alerts", "category": "alerts"}))
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

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let scheduled_jobs = scheduler::list_by_org(&org_id, Some(TriggerModule::Alert))
        .await
        .unwrap_or_default();
    let mut scheduled_jobs: HashMap<String, Trigger> = scheduled_jobs
        .into_iter()
        .map(|t| (t.module_key.clone(), t))
        .collect();
    let folders_and_alerts_scheduled_job =
        match alert::list_v2(client, user_id, query.into(&org_id)).await {
            Ok(f_a) => {
                let f_a: Vec<_> = f_a
                    .into_iter()
                    .map(|(folder, alert)| {
                        let key = alert.get_unique_key();
                        (folder, alert, scheduled_jobs.remove(&key))
                    })
                    .collect();
                f_a
            }
            Err(e) => return e.into(),
        };
    let Ok(resp_body) = ListAlertsResponseBody::try_from(folders_and_alerts_scheduled_job) else {
        return MetaHttpResponse::internal_error("");
    };
    MetaHttpResponse::json(resp_body)
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
            if !check_permissions(&id.to_string(), &org_id, user_id, "alerts", "PUT", None).await {
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
        Err(e) => e.into(),
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
    match alert::move_to_folder(
        client,
        &org_id,
        &req_body.alert_ids,
        &req_body.dst_folder_id,
        &user_email.user_id,
    )
    .await
    {
        Ok(_) => {
            let message = if req_body.alert_ids.len() == 1 {
                "Alert moved"
            } else {
                "Alerts moved"
            };
            MetaHttpResponse::ok(message)
        }
        Err(e) => e.into(),
    }
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

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

use actix_web::{HttpRequest, HttpResponse, delete, get, http::StatusCode, patch, post, put, web};
use config::meta::{
    alerts::alert::Alert as MetaAlert,
    triggers::{Trigger, TriggerModule},
};
use hashbrown::HashMap;
use infra::db::{ORM_CLIENT, connect_to_orm};
use svix_ksuid::Ksuid;

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_resource_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        models::alerts::{
            requests::{
                AlertBulkEnableRequest, CreateAlertRequestBody, EnableAlertQuery, ListAlertsQuery,
                MoveAlertsRequestBody, UpdateAlertRequestBody,
            },
            responses::{
                AlertBulkEnableResponse, EnableAlertResponseBody, GetAlertResponseBody,
                ListAlertsResponseBody,
            },
        },
        request::dashboards::{get_folder, is_overwrite},
    },
    service::{
        alerts::alert::{self, AlertError},
        db::scheduler,
    },
};

#[allow(deprecated)]
pub mod deprecated;
pub mod destinations;
pub mod templates;

impl From<AlertError> for HttpResponse {
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
    request_body(content = CreateAlertRequestBody, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"}))
    )
)]
#[post("/v2/{org_id}/alerts")]
pub async fn create_alert(
    path: web::Path<String>,
    req_body: web::Json<CreateAlertRequestBody>,
    user_email: UserEmail,
    req: HttpRequest,
) -> HttpResponse {
    let org_id = path.into_inner();
    let req_body = req_body.into_inner();

    let query_str = req.query_string();
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
        (status = 200, description = "Success",  content_type = "application/json", body = GetAlertResponseBody),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"}))
    )
)]
#[get("/v2/{org_id}/alerts/{alert_id}")]
async fn get_alert(path: web::Path<(String, Ksuid)>) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok(alert) => {
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
        (status = 200, description = "Success",  content_type = "application/json", body = GetAlertResponseBody),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"}))
    )
)]
#[get("/v2/{org_id}/alerts/{alert_id}/export")]
pub async fn export_alert(path: web::Path<(String, Ksuid)>) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok(alert) => {
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
    request_body(content = UpdateAlertRequestBody, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[put("/v2/{org_id}/alerts/{alert_id}")]
pub async fn update_alert(
    path: web::Path<(String, Ksuid)>,
    req_body: web::Json<UpdateAlertRequestBody>,
    user_email: UserEmail,
) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();
    let req_body = req_body.into_inner();

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
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"}))
    )
)]
#[delete("/v2/{org_id}/alerts/{alert_id}")]
async fn delete_alert(path: web::Path<(String, Ksuid)>) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::delete_by_id(client, &org_id, alert_id).await {
        Ok(_) => MetaHttpResponse::ok("Alert deleted"),
        Err(e) => e.into(),
    }
}

/// ListAlerts
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = ListAlertsResponseBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"}))
    )
)]
#[get("/v2/{org_id}/alerts")]
async fn list_alerts(path: web::Path<String>, req: HttpRequest) -> HttpResponse {
    let org_id = path.into_inner();
    let Ok(query) = web::Query::<ListAlertsQuery>::from_query(req.query_string()) else {
        return MetaHttpResponse::bad_request("Error parsing query parameters");
    };
    let query = query.0;

    #[cfg(not(feature = "enterprise"))]
    let user_id = None;
    #[cfg(feature = "enterprise")]
    let Ok(user_id) = req.headers().get("user_id").map(|v| v.to_str()).transpose() else {
        return MetaHttpResponse::forbidden("");
    };

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
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[patch("/v2/{org_id}/alerts/{alert_id}/enable")]
async fn enable_alert(path: web::Path<(String, Ksuid)>, req: HttpRequest) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();
    let Ok(query) = web::Query::<EnableAlertQuery>::from_query(req.query_string()) else {
        return MetaHttpResponse::bad_request("Error parsing query parameters");
    };
    let should_enable = query.0.value;

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
    request_body(content = AlertBulkEnableRequest, description = "Alert id list", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[post("/v2/{org_id}/alerts/bulk/enable")]
async fn enable_alert_bulk(
    path: web::Path<String>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> HttpResponse {
    let org_id = path.into_inner();
    let Ok(query) = web::Query::<EnableAlertQuery>::from_query(in_req.query_string()) else {
        return MetaHttpResponse::bad_request("Error parsing query parameters");
    };
    let should_enable = query.0.value;

    let req: AlertBulkEnableRequest = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return MetaHttpResponse::bad_request("invalid body"),
    };

    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        for id in &req.ids {
            if let Some(res) =
                check_resource_permissions(&org_id, &user_id, "alerts", &id.to_string(), "PUT")
                    .await
            {
                return res;
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
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[patch("/v2/{org_id}/alerts/{alert_id}/trigger")]
async fn trigger_alert(path: web::Path<(String, Ksuid)>) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::trigger_by_id(client, &org_id, alert_id).await {
        Ok(_) => MetaHttpResponse::ok("Alert triggered"),
        Err(e) => e.into(),
    }
}

/// MoveAlerts
#[utoipa::path(
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
    request_body(content = MoveAlertsRequestBody, description = "Identifies alerts and the destination folder", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[patch("/v2/{org_id}/alerts/move")]
async fn move_alerts(
    path: web::Path<String>,
    req_body: web::Json<MoveAlertsRequestBody>,
    user_email: UserEmail,
) -> HttpResponse {
    let org_id = path.into_inner();
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

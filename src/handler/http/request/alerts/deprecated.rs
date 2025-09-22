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

use core::result::Result::Ok;

use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
use config::{
    meta::{
        alerts::alert::{Alert, AlertListFilter},
        dashboards::datetime_now,
        triggers::{ScheduledTriggerData, TriggerModule},
    },
    utils::json,
};
use hashbrown::HashMap;

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{auth::UserEmail, http::get_stream_type_from_request},
    },
    service::{
        alerts::alert::{self, AlertError},
        db::scheduler,
    },
};

/// CreateAlert
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SaveAlert",
    summary = "Create alert (deprecated)",
    description = "Creates a new alert for the specified stream. This endpoint is deprecated; please use the newer \
                   alert management endpoints for better functionality and support.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
      ),
    request_body(content = Alert, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"}))
    )
)]
#[post("/{org_id}/{stream_name}/alerts")]
pub async fn save_alert(
    path: web::Path<(String, String)>,
    alert: web::Json<Alert>,
    user_email: UserEmail,
    req: HttpRequest,
) -> HttpResponse {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let overwrite = match query.get("overwrite") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };

    // Hack for frequency: convert minutes to seconds
    let mut alert = alert.into_inner();
    alert.trigger_condition.frequency *= 60;
    if alert.owner.clone().filter(|o| !o.is_empty()).is_none() {
        alert.owner = Some(user_email.user_id.clone());
    };
    alert.last_edited_by = Some(user_email.user_id);
    alert.updated_at = Some(datetime_now());
    alert.set_last_satisfied_at(None);
    alert.set_last_triggered_at(None);

    match alert::save(&org_id, &stream_name, "", alert, true, overwrite).await {
        Ok(_) => MetaHttpResponse::ok("Alert saved"),
        Err(e) => e.into(),
    }
}

/// UpdateAlert
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateAlertDeprecated",
    summary = "Update alert (deprecated)",
    description = "Updates an existing alert with new configuration settings. This endpoint is deprecated; please use \
                   the newer alert management endpoints for improved functionality and better error handling.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
      ),
    request_body(content = Alert, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"}))
    )
)]
#[put("/{org_id}/{stream_name}/alerts/{alert_name}")]
pub async fn update_alert(
    path: web::Path<(String, String, String)>,
    alert: web::Json<Alert>,
    user_email: UserEmail,
) -> HttpResponse {
    let (org_id, stream_name, name) = path.into_inner();

    // Hack for frequency: convert minutes to seconds
    let mut alert = alert.into_inner();
    alert.trigger_condition.frequency *= 60;
    alert.last_edited_by = Some(user_email.user_id);
    alert.updated_at = Some(datetime_now());
    match alert::save(&org_id, &stream_name, &name, alert, false, false).await {
        Ok(_) => MetaHttpResponse::ok("Alert Updated"),
        Err(e) => e.into(),
    }
}

/// ListStreamAlerts
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListStreamAlerts",
    summary = "List stream alerts (deprecated)",
    description = "Retrieves all alerts configured for a specific stream. This endpoint is deprecated; please use the \
                   newer alert management endpoints for enhanced filtering and better performance.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"}))
    )
)]
#[get("/{org_id}/{stream_name}/alerts")]
async fn list_stream_alerts(path: web::Path<(String, String)>, req: HttpRequest) -> HttpResponse {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query);
    let user_filter = query.get("owner").map(|v| v.to_string());
    let enabled_filter = query
        .get("enabled")
        .and_then(|field| field.parse::<bool>().ok());
    let alert_filter = AlertListFilter {
        owner: user_filter,
        enabled: enabled_filter,
    };
    match alert::list(
        &org_id,
        stream_type,
        Some(stream_name.as_str()),
        None,
        alert_filter,
    )
    .await
    {
        Ok(mut data) => {
            // Hack for frequency: convert seconds to minutes
            for alert in data.iter_mut() {
                alert.trigger_condition.frequency /= 60;
            }

            let mut mapdata = HashMap::new();
            mapdata.insert("list", data);
            MetaHttpResponse::json(mapdata)
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// ListAlerts
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertsDeprecated",
    summary = "List all alerts (deprecated)",
    description = "Retrieves all alerts in the organization across all streams. Supports filtering by owner, enabled \
                   status, stream type, and stream name. This endpoint is deprecated; please use the newer alert \
                   management endpoints for better filtering capabilities and improved performance.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"}))
    )
)]
#[get("/{org_id}/alerts")]
async fn list_alerts(path: web::Path<String>, req: HttpRequest) -> HttpResponse {
    let org_id = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();

    let mut _alert_list_from_rbac = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            "alert",
        )
        .await
        {
            Ok(stream_list) => {
                _alert_list_from_rbac = stream_list;
            }
            Err(e) => {
                return MetaHttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    let user_filter = query.get("owner").map(|v| v.to_string());
    let enabled_filter = query
        .get("enabled")
        .and_then(|field| field.parse::<bool>().ok());
    let stream_type_filter = get_stream_type_from_request(&query);
    let stream_name_filter = query.get("stream_name").map(|v| v.as_str());

    let alert_filter = AlertListFilter {
        owner: user_filter,
        enabled: enabled_filter,
    };
    match alert::list(
        &org_id,
        stream_type_filter,
        stream_name_filter,
        _alert_list_from_rbac,
        alert_filter,
    )
    .await
    {
        Ok(mut data) => {
            // `last_triggered_at` and `last_satisfied_at` are not part
            // of the alerts anymore, so fetch the scheduled_jobs to get
            // the last_triggered_at and last_satisfied_at.

            if let Ok(scheduled_jobs) =
                scheduler::list_by_org(&org_id, Some(TriggerModule::Alert)).await
            {
                for alert in data.iter_mut() {
                    // Hack for frequency: convert seconds to minutes
                    alert.trigger_condition.frequency /= 60;
                    if let Some(scheduled_job) = scheduled_jobs.iter().find(|job| {
                        job.module_key.eq(&format!(
                            "{}/{}/{}",
                            alert.stream_type, alert.stream_name, alert.name
                        ))
                    }) {
                        alert.set_last_triggered_at(scheduled_job.start_time);
                        let trigger_data: Result<ScheduledTriggerData, json::Error> =
                            json::from_str(&scheduled_job.data);
                        if let Ok(trigger_data) = trigger_data {
                            alert.set_last_satisfied_at(trigger_data.last_satisfied_at);
                        }
                    }
                }
            } else {
                // Hack for frequency: convert seconds to minutes
                for alert in data.iter_mut() {
                    alert.trigger_condition.frequency /= 60;
                }
            }

            let mut mapdata = HashMap::new();
            mapdata.insert("list", data);
            MetaHttpResponse::json(mapdata)
        }
        Err(e) => e.into(),
    }
}

/// GetAlertByName
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertDeprecated",
    summary = "Get alert details (deprecated)",
    description = "Retrieves detailed information about a specific alert including its configuration, trigger conditions, \
                   and execution status. This endpoint is deprecated; please use the newer alert management endpoints \
                   for enhanced functionality and better data structure.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = Alert),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"}))
    )
)]
#[get("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn get_alert(path: web::Path<(String, String, String)>, req: HttpRequest) -> HttpResponse {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    match alert::get_by_name(&org_id, stream_type, &stream_name, &name).await {
        Ok(Some(mut data)) => {
            if let Ok(scheduled_job) = scheduler::get(
                &org_id,
                TriggerModule::Alert,
                &format!("{stream_type}/{stream_name}/{name}"),
            )
            .await
            {
                data.set_last_triggered_at(scheduled_job.start_time);
                let trigger_data: Result<ScheduledTriggerData, json::Error> =
                    json::from_str(&scheduled_job.data);
                if let Ok(trigger_data) = trigger_data {
                    data.set_last_satisfied_at(trigger_data.last_satisfied_at);
                }
            }
            // Hack for frequency: convert seconds to minutes
            data.trigger_condition.frequency /= 60;
            MetaHttpResponse::json(data)
        }
        Ok(None) => AlertError::AlertNotFound.into(),
        Err(e) => e.into(),
    }
}

/// DeleteAlert
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertDeprecated",
    summary = "Delete alert (deprecated)",
    description = "Permanently removes an alert and stops its monitoring and notification functionality. This endpoint is \
                   deprecated; please use the newer alert management endpoints for better error handling and \
                   confirmation responses.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn delete_alert(path: web::Path<(String, String, String)>, req: HttpRequest) -> HttpResponse {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    match alert::delete_by_name(&org_id, stream_type, &stream_name, &name).await {
        Ok(_) => MetaHttpResponse::ok("Alert deleted"),
        Err(e) => e.into(),
    }
}

/// EnableAlert
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EnableAlertDeprecated",
    summary = "Enable/disable alert (deprecated)",
    description = "Enables or disables an alert's monitoring and notification functionality. When disabled, the alert \
                   will not trigger or send notifications. This endpoint is deprecated; please use the newer alert \
                   management endpoints for better state management and validation.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
        ("value" = bool, Query, description = "Enable or disable alert"),
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
#[put("/{org_id}/{stream_name}/alerts/{alert_name}/enable")]
async fn enable_alert(path: web::Path<(String, String, String)>, req: HttpRequest) -> HttpResponse {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let mut resp = HashMap::new();
    resp.insert("enabled".to_string(), enable);
    match alert::enable_by_name(&org_id, stream_type, &stream_name, &name, enable).await {
        Ok(_) => MetaHttpResponse::json(resp),
        Err(e) => e.into(),
    }
}

/// TriggerAlert
#[deprecated]
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "TriggerAlertDeprecated",
    summary = "Manually trigger alert (deprecated)",
    description = "Manually triggers an alert to test its notification functionality and validate the configured \
                   destinations. This is useful for testing alert configurations without waiting for actual \
                   conditions. This endpoint is deprecated; please use the newer alert management endpoints.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
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
#[put("/{org_id}/{stream_name}/alerts/{alert_name}/trigger")]
async fn trigger_alert(
    path: web::Path<(String, String, String)>,
    req: HttpRequest,
) -> HttpResponse {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    match alert::trigger_by_name(&org_id, stream_type, &stream_name, &name).await {
        Ok(_) => MetaHttpResponse::ok("Alert triggered"),
        Err(e) => e.into(),
    }
}

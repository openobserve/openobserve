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

use std::{collections::HashMap, io::Error};

use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
use config::meta::{
    dashboards::reports::{Report, ReportListFilters},
    triggers::{Trigger, TriggerModule},
};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::models::reports::{ListReportsResponseBody, ListReportsResponseBodyItem},
    service::{
        dashboards::reports::{self, ReportError},
        db::scheduler,
    },
};

impl From<ReportError> for HttpResponse {
    fn from(value: ReportError) -> Self {
        match &value {
            ReportError::SmtpNotEnabled => MetaHttpResponse::internal_error(value),
            ReportError::ChromeNotEnabled => MetaHttpResponse::internal_error(value),
            ReportError::ReportUsernamePasswordNotSet => MetaHttpResponse::bad_request(value),
            ReportError::NameContainsOpenFgaUnsupportedCharacters => {
                MetaHttpResponse::bad_request(value)
            }
            ReportError::NameIsEmpty => MetaHttpResponse::bad_request(value),
            ReportError::NameContainsForwardSlash => MetaHttpResponse::bad_request(value),
            ReportError::CreateReportNameAlreadyUsed => MetaHttpResponse::bad_request(value),
            ReportError::ReportNotFound => MetaHttpResponse::not_found(value),
            ReportError::NoDashboards => MetaHttpResponse::bad_request(value),
            ReportError::NoDashboardTabs => MetaHttpResponse::bad_request(value),
            ReportError::NoDestinations => MetaHttpResponse::bad_request(value),
            ReportError::DashboardTabNotFound => MetaHttpResponse::not_found(value),
            ReportError::ParseCronError(e) => MetaHttpResponse::bad_request(e),
            ReportError::DbError(e) => MetaHttpResponse::internal_error(e),
            ReportError::SendReportError(e) => MetaHttpResponse::internal_error(e),
            ReportError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
        }
    }
}

/// CreateReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "CreateReport",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = Report,
        description = "Report details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Report created", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[post("/{org_id}/reports")]
pub async fn create_report(
    path: web::Path<String>,
    report: web::Json<Report>,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    let mut report = report.into_inner();
    if report.owner.is_empty() {
        report.owner = user_email.user_id;
    }
    match reports::save(&org_id, "", report, true).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// UpdateReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "UpdateReport",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    request_body(
        content = Report,
        description = "Report details",
    ),
    responses(
        (status = StatusCode::OK, description = "Report updated", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Report not found", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the report", body = HttpResponse),
    ),
)]
#[put("/{org_id}/reports/{name}")]
async fn update_report(
    path: web::Path<(String, String)>,
    report: web::Json<Report>,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let mut report = report.into_inner();
    report.last_edited_by = user_email.user_id;
    match reports::save(&org_id, &name, report, false).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// ListReports
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "ListReports",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, body = Vec<Report>),
    ),
)]
#[get("/{org_id}/reports")]
async fn list_reports(org_id: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();

    let folder = query.get("folder_id").map(|field| field.to_owned());
    let dashboard = query.get("dashboard_id").map(|field| field.to_owned());
    let destination_less = query
        .get("cache")
        .and_then(|field| field.parse::<bool>().ok());
    let filters = ReportListFilters {
        folder,
        dashboard,
        destination_less,
    };

    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            "report",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return Ok(crate::common::meta::http::HttpResponse::forbidden(
                    e.to_string(),
                ));
            }
        }
        // Get List of allowed objects ends
    }

    let scheduled_jobs = scheduler::list_by_org(&org_id, Some(TriggerModule::Report))
        .await
        .unwrap_or_default();
    let mut scheduled_jobs: HashMap<String, Trigger> = scheduled_jobs
        .into_iter()
        .map(|t| (t.module_key.clone(), t))
        .collect();
    let data = match reports::list(&org_id, filters, _permitted).await {
        Ok(data) => ListReportsResponseBody(
            data.into_iter()
                .map(|d| {
                    let scheduled_job = scheduled_jobs.remove(&d.report_id);
                    let Ok(mut item) = ListReportsResponseBodyItem::try_from(d) else {
                        return None;
                    };
                    item.last_triggered_at = scheduled_job.and_then(|t| t.start_time);
                    Some(item)
                })
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default(),
        ),
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    Ok(MetaHttpResponse::json(data))
}

/// GetReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "GetReport",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = StatusCode::OK, body = Report),
        (status = StatusCode::NOT_FOUND, description = "Report not found", body = HttpResponse),
    ),
)]
#[get("/{org_id}/reports/{name}")]
async fn get_report(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match reports::get(&org_id, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// DeleteReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "DeleteReport",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = HttpResponse),
    ),
)]
#[delete("/{org_id}/reports/{name}")]
async fn delete_report(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match reports::delete(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report deleted")),
        Err(e) => match e {
            ReportError::ReportNotFound => Ok(MetaHttpResponse::not_found(e)),
            e => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

/// EnableReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Report",
    operation_id = "EnableReport",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
        ("value" = bool, Query, description = "Enable or disable report"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/reports/{name}/enable")]
async fn enable_report(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let mut resp = HashMap::new();
    resp.insert("enabled".to_string(), enable);
    match reports::enable(&org_id, &name, enable).await {
        Ok(_) => Ok(MetaHttpResponse::json(resp)),
        Err(e) => match e {
            ReportError::ReportNotFound => Ok(MetaHttpResponse::not_found(e)),
            e => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

/// TriggerReport
///
/// #{"ratelimit_module":"Reports", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Reports",
    operation_id = "TriggerReport",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/reports/{name}/trigger")]
async fn trigger_report(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match reports::trigger(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report triggered")),
        Err(e) => match e {
            ReportError::ReportNotFound => Ok(MetaHttpResponse::not_found(e)),
            e => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

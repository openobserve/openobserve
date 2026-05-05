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

use std::collections::HashMap;

use axum::{
    extract::{OriginalUri, Path, Query},
    response::Response,
};
use config::meta::{
    dashboards::reports::{Report, ReportListFilters},
    folder::DEFAULT_FOLDER,
    triggers::{Trigger, TriggerModule},
};
use serde::Deserialize;

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::reports::{ListReportsResponseBody, ListReportsResponseBodyItem},
        request::{BulkDeleteRequest, BulkDeleteResponse, dashboards::get_folder},
    },
    service::{
        dashboards::reports::{self, ReportError},
        db::scheduler,
    },
};

impl From<ReportError> for Response {
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
            ReportError::InlineAttachmentTypeNotSupportedForPdf => {
                MetaHttpResponse::bad_request(value)
            }
            ReportError::NoDashboardTabs => MetaHttpResponse::bad_request(value),
            ReportError::NoDestinations => MetaHttpResponse::bad_request(value),
            ReportError::DashboardTabNotFound => MetaHttpResponse::not_found(value),
            ReportError::ParseCronError(e) => MetaHttpResponse::bad_request(e),
            ReportError::DbError(e) => MetaHttpResponse::internal_error(e),
            ReportError::SendReportError(e) => MetaHttpResponse::internal_error(e),
            ReportError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
            ReportError::FolderNotFound => MetaHttpResponse::not_found(value),
        }
    }
}

#[derive(Debug, serde::Serialize, Deserialize, utoipa::ToSchema)]
pub struct MoveReportsRequestBody {
    pub report_ids: Vec<String>,
    pub dst_folder_id: String,
}

/// CreateReport

#[utoipa::path(
    post,
    path = "/{org_id}/reports",
    context_path = "/api",
    tag = "Reports",
    operation_id = "CreateReport",
    summary = "Create dashboard report",
    description = "Creates a new automated dashboard report configuration. Reports can be scheduled to automatically \
                   generate and distribute dashboard snapshots via email or other notification channels. Includes \
                   support for custom time ranges, recipient lists, delivery schedules, and output formats to keep \
                   stakeholders informed of key metrics and trends.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(Report),
        description = "Report details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Report created", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a scheduled report", "category": "dashboards"}))
    )
)]
pub async fn create_report(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(report): axum::Json<Report>,
) -> Response {
    let mut report = report;
    if report.owner.is_empty() {
        report.owner = user_email.user_id;
    }
    match reports::save(&org_id, DEFAULT_FOLDER, "", report, true).await {
        Ok(_) => MetaHttpResponse::ok("Report saved"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// UpdateReport

#[utoipa::path(
    put,
    path = "/{org_id}/reports/{name}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "UpdateReport",
    summary = "Update dashboard report",
    description = "Updates an existing dashboard report configuration. Allows modification of report parameters including \
                   schedule, recipients, dashboard selection, time ranges, and delivery options. Changes take effect on \
                   the next scheduled execution, ensuring report distribution continues with updated settings and content \
                   selection.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    request_body(
        content = inline(Report),
        description = "Report details",
    ),
    responses(
        (status = StatusCode::OK, description = "Report updated", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Report not found", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the report", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a report", "category": "dashboards"}))
    )
)]
pub async fn update_report(
    Path((org_id, name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(report): axum::Json<Report>,
) -> Response {
    let mut report = report;
    report.last_edited_by = user_email.user_id;
    match reports::save(&org_id, DEFAULT_FOLDER, &name, report, false).await {
        Ok(_) => MetaHttpResponse::ok("Report saved"),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// ListReports

#[utoipa::path(
    get,
    path = "/{org_id}/reports",
    context_path = "/api",
    tag = "Reports",
    operation_id = "ListReports",
    summary = "List dashboard reports",
    description = "Retrieves a list of all dashboard reports configured for the organization. Optionally filter by folder \
                   or dashboard to get specific report subsets. Returns report metadata including schedules, status, \
                   destinations, and execution history to help administrators manage automated reporting and monitor \
                   delivery performance.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(Vec<Report>)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all reports",
            "category": "dashboards",
            "summary_fields": ["name", "description", "enabled", "folder_name"]
        }))
    )
)]
pub async fn list_reports(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let folder = query.get("folder_id").map(|field| field.to_owned());
    let dashboard = query.get("dashboard_id").map(|field| field.to_owned());
    let destination_less = query
        .get("cache")
        .and_then(|field| field.parse::<bool>().ok());
    let filters = ReportListFilters {
        folder,
        dashboard,
        destination_less,
        name_substring: None,
    };

    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "report",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
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
                    match ListReportsResponseBodyItem::try_from(d) {
                        Ok(mut item) => {
                            item.last_triggered_at = scheduled_job.and_then(|t| t.start_time);
                            Some(item)
                        }
                        Err(e) => {
                            log::error!("Error converting report to response body: {e}");
                            None
                        }
                    }
                })
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default(),
        ),
        Err(e) => {
            return MetaHttpResponse::bad_request(e);
        }
    };

    MetaHttpResponse::json(data)
}

/// GetReport

#[utoipa::path(
    get,
    path = "/{org_id}/reports/{name}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "GetReport",
    summary = "Get dashboard report",
    description = "Retrieves the complete configuration and details for a specific dashboard report. Returns report \
                   parameters including schedule settings, dashboard selection, recipient lists, delivery options, and \
                   execution status. Used for reviewing existing report configurations before making modifications or \
                   troubleshooting delivery issues.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(Report)),
        (status = StatusCode::NOT_FOUND, description = "Report not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get report details", "category": "dashboards"}))
    )
)]
pub async fn get_report(Path((org_id, name)): Path<(String, String)>) -> Response {
    match reports::get(&org_id, DEFAULT_FOLDER, &name).await {
        Ok(data) => MetaHttpResponse::json(data),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// DeleteReport

#[utoipa::path(
    delete,
    path = "/{org_id}/reports/{name}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "DeleteReport",
    summary = "Delete dashboard report",
    description = "Removes a dashboard report configuration from the organization. This action cancels any scheduled \
                   report deliveries and permanently removes the report configuration. Recipients will no longer receive \
                   automated report deliveries, and the report configuration cannot be recovered once deleted.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = ()),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a report", "category": "dashboards", "requires_confirmation": true}))
    )
)]
pub async fn delete_report(Path((org_id, name)): Path<(String, String)>) -> Response {
    match reports::delete(&org_id, DEFAULT_FOLDER, &name).await {
        Ok(_) => MetaHttpResponse::ok("Report deleted"),
        Err(e) => match e {
            ReportError::ReportNotFound => MetaHttpResponse::not_found(e),
            e => MetaHttpResponse::internal_error(e),
        },
    }
}

/// DeleteReportBulk

#[utoipa::path(
    delete,
    path = "/{org_id}/reports/bulk",
    context_path = "/api",
    tag = "Reports",
    operation_id = "DeleteReportBulk",
    summary = "Delete multiple dashboard reports",
    description = "Removes multiple dashboard reports configuration from the organization. This action cancels any scheduled \
                   report deliveries and permanently removes the report configuration. Recipients will no longer receive \
                   automated report deliveries, and the report configuration cannot be recovered once deleted.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = BulkDeleteRequest,
        description = "Reports to delete",
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_report_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if !check_permissions(
            id, &org_id, &_user_id, "reports", "DELETE", None, false, false, false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match reports::delete(&org_id, DEFAULT_FOLDER, &name).await {
            Ok(_) => successful.push(name),
            Err(e) => match e {
                ReportError::ReportNotFound => successful.push(name),
                e => {
                    log::error!("error in deleting report {org_id}/{name} : {e}");
                    unsuccessful.push(name);
                    err = Some(e.to_string());
                }
            },
        }
    }
    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// EnableReport

#[utoipa::path(
    put,
    path = "/{org_id}/reports/{name}/enable",
    context_path = "/api",
    tag = "Report",
    operation_id = "EnableReport",
    summary = "Enable or disable dashboard report",
    description = "Enables or disables automated execution of a dashboard report. When disabled, scheduled report \
                   deliveries are paused but the configuration is preserved. When re-enabled, report deliveries resume \
                   according to the configured schedule. Useful for temporarily stopping report distribution without \
                   losing the complete report setup.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
        ("value" = bool, Query, description = "Enable or disable report"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    )
)]
pub async fn enable_report(
    Path((org_id, name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let mut resp = HashMap::new();
    resp.insert("enabled".to_string(), enable);
    match reports::enable(&org_id, DEFAULT_FOLDER, &name, enable).await {
        Ok(_) => MetaHttpResponse::json(resp),
        Err(e) => match e {
            ReportError::ReportNotFound => MetaHttpResponse::not_found(e),
            e => MetaHttpResponse::internal_error(e),
        },
    }
}

/// TriggerReport

#[utoipa::path(
    put,
    path = "/{org_id}/reports/{name}/trigger",
    context_path = "/api",
    tag = "Reports",
    operation_id = "TriggerReport",
    summary = "Manually trigger dashboard report",
    description = "Manually triggers immediate execution of a dashboard report outside of its regular schedule. Generates \
                   the report with current data and delivers it to configured destinations. Useful for ad-hoc reporting \
                   needs, testing report configurations, or providing immediate updates to stakeholders between scheduled \
                   deliveries.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Report name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn trigger_report(Path((org_id, name)): Path<(String, String)>) -> Response {
    match reports::trigger(&org_id, DEFAULT_FOLDER, &name).await {
        Ok(_) => MetaHttpResponse::ok("Report triggered"),
        Err(e) => match e {
            ReportError::ReportNotFound => MetaHttpResponse::not_found(e),
            e => MetaHttpResponse::internal_error(e),
        },
    }
}

// ─── V2 handlers (folder-aware, ID-based) ──────────────────────────────────

/// CreateReportV2
#[utoipa::path(
    post,
    path = "/v2/{org_id}/reports",
    context_path = "/api",
    tag = "Reports",
    operation_id = "CreateReportV2",
    summary = "Create dashboard report (v2)",
    description = "Creates a new automated dashboard report in the specified folder. \
                   Pass `?folder=<folder_id>` to place the report in a non-default folder.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID (defaults to 'default')"),
    ),
    request_body(content = inline(Report), description = "Report details"),
    responses(
        (status = StatusCode::OK, description = "Report created", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "create"})),
    )
)]
pub async fn create_report_v2(
    Path(org_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(mut report): axum::Json<Report>,
) -> Response {
    let folder_id = get_folder(uri.query().unwrap_or(""));
    if report.owner.is_empty() {
        report.owner = user_email.user_id;
    }
    match reports::save(&org_id, &folder_id, "", report, true).await {
        Ok(_) => MetaHttpResponse::ok("Report saved"),
        Err(e) => e.into(),
    }
}

/// ListReportsV2
#[utoipa::path(
    get,
    path = "/v2/{org_id}/reports",
    context_path = "/api",
    tag = "Reports",
    operation_id = "ListReportsV2",
    summary = "List dashboard reports (v2)",
    description = "Lists reports for the organization, optionally filtered by folder.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID filter"),
        ("dashboard_id" = Option<String>, Query, description = "Dashboard ID filter"),
        ("cache" = Option<bool>, Query, description = "Filter destination-less (cache) reports"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(Vec<Report>)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "list"})),
    )
)]
pub async fn list_reports_v2(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Reuse the v1 list handler logic — it already reads ?folder as a filter.
    // Re-map the query key from "folder" to "folder_id" if needed by the service.
    let folder = query.get("folder").map(|s| s.to_owned());
    let dashboard = query.get("dashboard_id").map(|s| s.to_owned());
    let destination_less = query.get("cache").and_then(|s| s.parse::<bool>().ok());
    let name_substring = query
        .get("report_name_substring")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_owned());
    let filters = ReportListFilters {
        folder,
        dashboard,
        destination_less,
        name_substring,
    };

    let mut _permitted = None;
    #[cfg(feature = "enterprise")]
    {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "report",
        )
        .await
        {
            Ok(list) => _permitted = list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
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
                    match ListReportsResponseBodyItem::try_from(d) {
                        Ok(mut item) => {
                            item.last_triggered_at = scheduled_job.and_then(|t| t.start_time);
                            Some(item)
                        }
                        Err(e) => {
                            log::error!("Error converting report to response body: {e}");
                            None
                        }
                    }
                })
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default(),
        ),
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    MetaHttpResponse::json(data)
}

/// GetReportV2
#[utoipa::path(
    get,
    path = "/v2/{org_id}/reports/{report_id}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "GetReportV2",
    summary = "Get dashboard report by ID (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = String, Path, description = "Report ID (KSUID)"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(Report)),
        (status = StatusCode::NOT_FOUND, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "get"})),
    )
)]
pub async fn get_report_v2(Path((org_id, report_id)): Path<(String, String)>) -> Response {
    match reports::get_by_id(&org_id, &report_id).await {
        Ok((_, report)) => MetaHttpResponse::json(report),
        Err(e) => e.into(),
    }
}

/// UpdateReportV2
#[utoipa::path(
    put,
    path = "/v2/{org_id}/reports/{report_id}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "UpdateReportV2",
    summary = "Update dashboard report by ID (v2)",
    description = "Updates an existing report. Pass `?folder=<folder_id>` to move the report \
                   to a different folder at the same time.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = String, Path, description = "Report ID (KSUID)"),
        ("folder" = Option<String>, Query, description = "Move to this folder ID"),
    ),
    request_body(content = inline(Report), description = "Report details"),
    responses(
        (status = StatusCode::OK, description = "Updated", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "update"})),
    )
)]
pub async fn update_report_v2(
    Path((org_id, report_id)): Path<(String, String)>,
    OriginalUri(uri): OriginalUri,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(mut report): axum::Json<Report>,
) -> Response {
    report.last_edited_by = user_email.user_id;
    // ?folder on update means "move to this folder"; absent means stay in current folder.
    let new_folder: Option<String> = uri.query().and_then(|q| {
        url::form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "folder")
            .map(|(_, v)| v.into_owned())
    });
    match reports::update_by_id(&org_id, &report_id, new_folder.as_deref(), report).await {
        Ok(_) => MetaHttpResponse::ok("Report updated"),
        Err(e) => e.into(),
    }
}

/// DeleteReportV2
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/reports/{report_id}",
    context_path = "/api",
    tag = "Reports",
    operation_id = "DeleteReportV2",
    summary = "Delete dashboard report by ID (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = String, Path, description = "Report ID (KSUID)"),
    ),
    responses(
        (status = StatusCode::OK, description = "Deleted", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "delete"})),
    )
)]
pub async fn delete_report_v2(Path((org_id, report_id)): Path<(String, String)>) -> Response {
    match reports::delete_by_id(&org_id, &report_id).await {
        Ok(_) => MetaHttpResponse::ok("Report deleted"),
        Err(e) => e.into(),
    }
}

/// DeleteReportBulkV2
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/reports/bulk",
    context_path = "/api",
    tag = "Reports",
    operation_id = "DeleteReportBulkV2",
    summary = "Delete multiple dashboard reports by ID (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "Report IDs (KSUIDs)"),
    responses(
        (status = StatusCode::OK, description = "Success", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_report_bulk_v2(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if !check_permissions(
            id, &org_id, &_user_id, "reports", "DELETE", None, false, false, false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for report_id in req.ids {
        match reports::delete_by_id(&org_id, &report_id).await {
            Ok(_) => successful.push(report_id),
            Err(ReportError::ReportNotFound) => successful.push(report_id), // idempotent
            Err(e) => {
                log::error!("error deleting report {org_id}/{report_id}: {e}");
                unsuccessful.push(report_id);
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// EnableReportV2
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/reports/{report_id}/enable",
    context_path = "/api",
    tag = "Reports",
    operation_id = "EnableReportV2",
    summary = "Enable or disable a report by ID (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = String, Path, description = "Report ID (KSUID)"),
        ("value" = bool, Query, description = "true to enable, false to disable"),
    ),
    responses(
        (status = 200, description = "Success", body = Object),
        (status = 404, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "update"})),
    )
)]
pub async fn enable_report_v2(
    Path((org_id, report_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or(false);
    match reports::enable_by_id(&org_id, &report_id, enable).await {
        Ok(_) => {
            let mut resp = HashMap::new();
            resp.insert("enabled", enable);
            MetaHttpResponse::json(resp)
        }
        Err(e) => e.into(),
    }
}

/// TriggerReportV2
#[utoipa::path(
    put,
    path = "/v2/{org_id}/reports/{report_id}/trigger",
    context_path = "/api",
    tag = "Reports",
    operation_id = "TriggerReportV2",
    summary = "Manually trigger a report by ID (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = String, Path, description = "Report ID (KSUID)"),
    ),
    responses(
        (status = 200, description = "Success", body = Object),
        (status = 404, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn trigger_report_v2(Path((org_id, report_id)): Path<(String, String)>) -> Response {
    match reports::trigger_by_id(&org_id, &report_id).await {
        Ok(_) => MetaHttpResponse::ok("Report triggered"),
        Err(e) => e.into(),
    }
}

/// MoveReports
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/reports/move",
    context_path = "/api",
    tag = "Reports",
    operation_id = "MoveReports",
    summary = "Move reports between folders (v2)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(MoveReportsRequestBody),
        description = "Report IDs and destination folder",
    ),
    responses(
        (status = 200, description = "Success", body = Object),
        (status = 404, description = "Not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Reports", "operation": "update"})),
    )
)]
pub async fn move_reports(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<MoveReportsRequestBody>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for id in &req.report_ids {
        if !check_permissions(
            id, &org_id, &_user_id, "reports", "PUT", None, false, false, false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    match reports::move_to_folder(&org_id, &req.report_ids, &req.dst_folder_id).await {
        Ok(_) => MetaHttpResponse::ok(if req.report_ids.len() == 1 {
            "Report moved"
        } else {
            "Reports moved"
        }),
        Err(e) => e.into(),
    }
}

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, response::Response};

    use crate::service::dashboards::reports::ReportError;

    fn status(err: ReportError) -> StatusCode {
        Response::from(err).status()
    }

    // 500 Internal Server Error
    #[test]
    fn test_smtp_not_enabled_is_internal_error() {
        assert_eq!(
            status(ReportError::SmtpNotEnabled),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_chrome_not_enabled_is_internal_error() {
        assert_eq!(
            status(ReportError::ChromeNotEnabled),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_create_default_folder_error_is_internal_error() {
        assert_eq!(
            status(ReportError::CreateDefaultFolderError),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_db_error_is_internal_error() {
        assert_eq!(
            status(ReportError::DbError(anyhow::anyhow!("db fail"))),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    // 400 Bad Request
    #[test]
    fn test_report_username_password_not_set_is_bad_request() {
        assert_eq!(
            status(ReportError::ReportUsernamePasswordNotSet),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_name_contains_openfga_unsupported_chars_is_bad_request() {
        assert_eq!(
            status(ReportError::NameContainsOpenFgaUnsupportedCharacters),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_name_is_empty_is_bad_request() {
        assert_eq!(status(ReportError::NameIsEmpty), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_name_contains_forward_slash_is_bad_request() {
        assert_eq!(
            status(ReportError::NameContainsForwardSlash),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_create_report_name_already_used_is_bad_request() {
        assert_eq!(
            status(ReportError::CreateReportNameAlreadyUsed),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_no_dashboards_is_bad_request() {
        assert_eq!(status(ReportError::NoDashboards), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_inline_attachment_type_not_supported_for_pdf_is_bad_request() {
        assert_eq!(
            status(ReportError::InlineAttachmentTypeNotSupportedForPdf),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_no_dashboard_tabs_is_bad_request() {
        assert_eq!(
            status(ReportError::NoDashboardTabs),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_no_destinations_is_bad_request() {
        assert_eq!(status(ReportError::NoDestinations), StatusCode::BAD_REQUEST);
    }

    // 404 Not Found
    #[test]
    fn test_report_not_found_is_not_found() {
        assert_eq!(status(ReportError::ReportNotFound), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_dashboard_tab_not_found_is_not_found() {
        assert_eq!(
            status(ReportError::DashboardTabNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_folder_not_found_is_not_found() {
        assert_eq!(status(ReportError::FolderNotFound), StatusCode::NOT_FOUND);
    }

    // 400 Bad Request
    #[test]
    fn test_parse_cron_error_is_bad_request() {
        use std::str::FromStr as _;
        let cron_err = cron::Schedule::from_str("not-a-cron").unwrap_err();
        assert_eq!(
            status(ReportError::ParseCronError(cron_err)),
            StatusCode::BAD_REQUEST
        );
    }

    // 500 Internal Server Error
    #[test]
    fn test_send_report_error_is_internal_server_error() {
        use crate::service::dashboards::reports::SendReportError;
        assert_eq!(
            status(ReportError::SendReportError(SendReportError::NoDashboards)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

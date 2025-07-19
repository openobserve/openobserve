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

use actix_web::{HttpRequest, HttpResponse, Responder, delete, get, http, patch, post, put, web};
use hashbrown::HashMap;

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::models::dashboards::{
        CreateDashboardRequestBody, CreateDashboardResponseBody, GetDashboardResponseBody,
        ListDashboardsQuery, ListDashboardsResponseBody, MoveDashboardRequestBody,
        MoveDashboardsRequestBody, UpdateDashboardRequestBody, UpdateDashboardResponseBody,
    },
    service::dashboards::{self, DashboardError},
};

pub mod reports;
pub mod timed_annotations;

impl From<DashboardError> for HttpResponse {
    fn from(value: DashboardError) -> Self {
        match value {
            DashboardError::InfraError(err) => MetaHttpResponse::internal_error(err),
            DashboardError::DashboardNotFound => MetaHttpResponse::not_found("Dashboard not found"),
            DashboardError::UpdateMissingHash => MetaHttpResponse::internal_error(
                "Request to update existing dashboard with missing or invalid hash value. BUG",
            ),
            DashboardError::UpdateConflictingHash => MetaHttpResponse::conflict(
                "Conflict: Failed to save due to concurrent changes. Please refresh the page after backing up your work to avoid losing changes.",
            ),
            DashboardError::PutMissingTitle => {
                MetaHttpResponse::internal_error("Dashboard should have title")
            }
            DashboardError::MoveMissingFolderParam => MetaHttpResponse::bad_request(
                "Please specify from & to folder from dashboard movement",
            ),
            DashboardError::MoveDestinationFolderNotFound => {
                MetaHttpResponse::not_found("Folder not found")
            }
            DashboardError::CreateFolderNotFound => MetaHttpResponse::not_found("Folder not found"),
            DashboardError::CreateDefaultFolder => {
                MetaHttpResponse::internal_error("Error saving default folder")
            }
            DashboardError::DistinctValueError => {
                MetaHttpResponse::internal_error("Error in updating distinct values")
            }
            DashboardError::MoveDashboardDeleteOld(dashb_id, folder_id, e) => {
                MetaHttpResponse::internal_error(format!(
                    "error deleting the dashboard {dashb_id} from old folder {folder_id} : {e}"
                ))
            }
            DashboardError::ListPermittedDashboardsError(err) => MetaHttpResponse::forbidden(err),
            DashboardError::UserNotFound => MetaHttpResponse::unauthorized("User not found"),
            DashboardError::PermissionDenied => MetaHttpResponse::forbidden("Permission denied"),
        }
    }
}

/// CreateDashboard
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "CreateDashboard",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = CreateDashboardRequestBody,
        description = "Dashboard details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Dashboard created", body = CreateDashboardResponseBody),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[post("/{org_id}/dashboards")]
pub async fn create_dashboard(
    path: web::Path<String>,
    req_body: web::Json<CreateDashboardRequestBody>,
    req: HttpRequest,
    user_email: UserEmail,
) -> impl Responder {
    let org_id = path.into_inner();
    let folder = get_folder(req.query_string());
    let mut dashboard: config::meta::dashboards::Dashboard = match req_body.into_inner().try_into()
    {
        Ok(dashboard) => dashboard,
        Err(_) => return MetaHttpResponse::bad_request("Error parsing request body"),
    };

    set_dashboard_owner_if_empty(&mut dashboard, &user_email.user_id);

    let saved = match dashboards::create_dashboard(&org_id, &folder, dashboard).await {
        Ok(saved) => saved,
        Err(err) => return err.into(),
    };
    let resp_body: CreateDashboardResponseBody = saved.into();
    MetaHttpResponse::json(resp_body)
}

/// UpdateDashboard
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "UpdateDashboard",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    request_body(
        content = UpdateDashboardRequestBody,
        description = "Dashboard details",
    ),
    responses(
        (status = StatusCode::OK, description = "Dashboard updated", body = UpdateDashboardResponseBody),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the dashboard", body = HttpResponse),
    ),
)]
#[put("/{org_id}/dashboards/{dashboard_id}")]
async fn update_dashboard(
    path: web::Path<(String, String)>,
    req_body: web::Json<UpdateDashboardRequestBody>,
    req: HttpRequest,
    user_email: UserEmail,
) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let folder = crate::common::utils::http::get_folder(&query);
    let hash = query.get("hash").map(|h| h.as_str());

    let mut dashboard: config::meta::dashboards::Dashboard = match req_body.into_inner().try_into()
    {
        Ok(dashboard) => dashboard,
        Err(_) => return MetaHttpResponse::bad_request("Error parsing request body"),
    };

    set_dashboard_owner_if_empty(&mut dashboard, &user_email.user_id);

    let saved = match dashboards::update_dashboard(&org_id, &dashboard_id, &folder, dashboard, hash)
        .await
    {
        Ok(saved) => saved,
        Err(err) => return err.into(),
    };
    let resp_body: UpdateDashboardResponseBody = saved.into();
    MetaHttpResponse::json(resp_body)
}

/// ListDashboards
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "ListDashboards",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListDashboardsQuery
    ),
    responses(
        (status = StatusCode::OK, body = ListDashboardsResponseBody),
    ),
)]
#[get("/{org_id}/dashboards")]
async fn list_dashboards(org_id: web::Path<String>, req: HttpRequest) -> impl Responder {
    let Ok(query) = web::Query::<ListDashboardsQuery>::from_query(req.query_string()) else {
        return MetaHttpResponse::bad_request("Error parsing query parameters");
    };
    let params = query.into_inner().into(&org_id.into_inner());
    let Some(user_id) = get_user_id(req) else {
        return MetaHttpResponse::unauthorized("User ID not found in request headers");
    };
    let dashboards = match dashboards::list_dashboards(&user_id, params).await {
        Ok(dashboards) => dashboards,
        Err(err) => return err.into(),
    };
    let resp_body: ListDashboardsResponseBody = dashboards.into();
    MetaHttpResponse::json(resp_body)
}

/// GetDashboard
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "GetDashboard",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    responses(
        (status = StatusCode::OK, body = GetDashboardResponseBody),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
    ),
)]
#[get("/{org_id}/dashboards/{dashboard_id}")]
async fn get_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    let dashboard = match dashboards::get_dashboard(&org_id, &dashboard_id).await {
        Ok(dashboard) => dashboard,
        Err(err) => return err.into(),
    };
    let resp_body: GetDashboardResponseBody = dashboard.into();
    MetaHttpResponse::json(resp_body)
}

/// DeleteDashboard
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "DeleteDashboard",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = HttpResponse),
    ),
)]
#[delete("/{org_id}/dashboards/{dashboard_id}")]
async fn delete_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    match dashboards::delete_dashboard(&org_id, &dashboard_id).await {
        Ok(()) => HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Dashboard deleted",
        )),
        Err(err) => err.into(),
    }
}

/// MoveDashboard
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "MoveDashboard",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
     request_body(
        content = MoveDashboardRequestBody,
        description = "MoveDashboard details",
        example = json!({
            "from": "Source folder id",
            "to": "Destination folder id",
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Dashboard Moved", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
    ),
)]
#[put("/{org_id}/folders/dashboards/{dashboard_id}")]
async fn move_dashboard(
    path: web::Path<(String, String)>,
    req_body: web::Json<MoveDashboardRequestBody>,
    user_email: UserEmail,
) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    // For this endpoint, openfga check is already done in the middleware
    match dashboards::move_dashboard(
        &org_id,
        &dashboard_id,
        &req_body.to,
        &user_email.user_id,
        false,
    )
    .await
    {
        Ok(()) => HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "Dashboard moved",
        )),
        Err(err) => err.into(),
    }
}

/// MoveDashboards
///
/// #{"ratelimit_module":"Dashboards", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "MoveDashboards",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = MoveDashboardsRequestBody, description = "Identifies dashboards and the destination folder", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[patch("/{org_id}/dashboards/move")]
async fn move_dashboards(
    path: web::Path<String>,
    req_body: web::Json<MoveDashboardsRequestBody>,
    user_email: UserEmail,
) -> HttpResponse {
    let org_id = path.into_inner();
    // For this endpoint, openfga check is needed here, as we don't do openfga check in the
    // middleware for this api endpoint, because it includes a batch of dashboards
    match dashboards::move_dashboards(
        &org_id,
        &req_body.dashboard_ids,
        &req_body.dst_folder_id,
        &user_email.user_id,
        true,
    )
    .await
    {
        Ok(_) => {
            let message = if req_body.dashboard_ids.len() == 1 {
                "Dashboard moved"
            } else {
                "Dashboards moved"
            };
            MetaHttpResponse::ok(message)
        }
        Err(e) => e.into(),
    }
}

pub fn get_folder(query_str: &str) -> String {
    let query = web::Query::<HashMap<String, String>>::from_query(query_str).unwrap();
    crate::common::utils::http::get_folder(&query)
}

pub fn is_overwrite(query_str: &str) -> bool {
    let query = web::Query::<HashMap<String, String>>::from_query(query_str).unwrap();
    match query.get("overwrite") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    }
}

/// Tries to get the user ID from the request headers.
fn get_user_id(req: HttpRequest) -> Option<String> {
    req.headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn set_dashboard_owner_if_empty(
    dashboard: &mut config::meta::dashboards::Dashboard,
    user_email: &str,
) {
    match dashboard.owner() {
        Some(owner) => {
            if owner.is_empty() {
                dashboard.set_owner(user_email.to_string());
            }
        }
        None => {
            dashboard.set_owner(user_email.to_string());
        }
    }
}

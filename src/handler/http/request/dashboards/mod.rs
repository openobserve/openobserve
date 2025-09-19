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
use config::meta::dashboards::{
    Dashboard, v1::Dashboard as DashboardV1, v2::Dashboard as DashboardV2,
    v3::Dashboard as DashboardV3, v4::Dashboard as DashboardV4, v5::Dashboard as DashboardV5,
};
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "CreateDashboard",
    summary = "Create new dashboard",
    description = "Creates a new dashboard with specified title, description, and visualization panels. The dashboard will be saved in the specified folder",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content((DashboardV1), (DashboardV2), (DashboardV3), (DashboardV4), (DashboardV5)),
        description = "Dashboard details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Dashboard created", body = CreateDashboardResponseBody),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "create"}))
    )
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
    let mut dashboard: Dashboard = match req_body.into_inner().try_into() {
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "UpdateDashboard",
    summary = "Update existing dashboard",
    description = "Updates an existing dashboard with new content, panels, or settings. Supports concurrent edit conflict detection using hash values",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    request_body(
        content((DashboardV1), (DashboardV2), (DashboardV3), (DashboardV4), (DashboardV5)),
        description = "Dashboard details",
    ),
    responses(
        (status = StatusCode::OK, description = "Dashboard updated", body = UpdateDashboardResponseBody),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the dashboard", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"}))
    )
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

    let mut dashboard: Dashboard = match req_body.into_inner().try_into() {
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "ListDashboards",
    summary = "List organization dashboards",
    description = "Retrieves a list of dashboards within the organization, with optional filtering by folder and pagination support",
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
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "list"}))
    )
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "GetDashboard",
    summary = "Get dashboard details",
    description = "Retrieves complete details of a specific dashboard including its panels, queries, and visualization configurations",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    responses(
        (status = StatusCode::OK, body = GetDashboardResponseBody),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "get"}))
    )
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

/// ExportDashboard
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "ExportDashboard",
    summary = "Export dashboard",
    description = "Exports a dashboard configuration in a portable format that can be imported into other organizations or instances",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    responses(
        (status = StatusCode::OK, body = GetDashboardResponseBody),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "get"}))
    )
)]
#[get("/{org_id}/dashboards/{dashboard_id}/export")]
pub async fn export_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    let dashboard = match dashboards::get_dashboard(&org_id, &dashboard_id).await {
        Ok(dashboard) => dashboard,
        Err(err) => return err.into(),
    };
    let resp_body: GetDashboardResponseBody = dashboard.into();
    MetaHttpResponse::json(resp_body)
}

/// DeleteDashboard
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "DeleteDashboard",
    summary = "Delete dashboard",
    description = "Permanently deletes a dashboard and all its associated panels and configurations. This action cannot be undone",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = Object),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"}))
    )
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "MoveDashboard",
    summary = "Move dashboard to folder",
    description = "Moves a dashboard from one folder to another within the organization. The dashboard content remains unchanged",
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
        (status = StatusCode::OK, description = "Dashboard Moved", body = Object),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"}))
    )
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
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "MoveDashboards",
    summary = "Move multiple dashboards",
    description = "Moves multiple dashboards to a specified destination folder in a single batch operation. Useful for organizing dashboards efficiently",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = MoveDashboardsRequestBody, description = "Identifies dashboards and the destination folder", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"}))
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

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
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
use config::meta::dashboards::Dashboard;
use hashbrown::HashMap;

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::dashboards::{
            DashboardRequestBody,
            DashboardResponseBody,
            ListDashboardsQuery,
            ListDashboardsResponseBody,
            MoveDashboardRequestBody,
            MoveDashboardsRequestBody, // UpdateDashboardRequestBody, UpdateDashboardResponseBody,
        },
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    service::dashboards::{self, DashboardError},
};

pub mod reports;
pub mod timed_annotations;

impl From<DashboardError> for Response {
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
    post,
    path = "/{org_id}/dashboards",
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
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard will be created. Used for RBAC checks in enterprise version. Defaults to 'default' if not specified"),
    ),
    request_body(
        content = inline(DashboardRequestBody),
        description = "Dashboard details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Dashboard created", body = inline(DashboardResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Folder not found", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "create"})),
        ("x-o2-mcp" = json!({
            "description": "Create a dashboard with panels on a 192-column grid. Each panel needs layout: {x, y, w, h, i}. x=column position (0-191), y=row position, w=width, h=height, i=panel ID. Rules: (1) panels in same row must have same height, (2) side-by-side widths sum to ~192. Common sizes: full-width w=192, half w=96, third w=64, quarter w=48. Stack rows by adding previous h to y value. IMPORTANT: you MUST set the correct queryType based on the stream type.",
            "category": "dashboards"
        }))
    )
)]
pub async fn create_dashboard(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req_body): axum::Json<DashboardRequestBody>,
) -> Response {
    let folder = crate::common::utils::http::get_folder(&query);

    let mut dashboard: Dashboard = req_body.into();

    set_dashboard_owner_if_empty(&mut dashboard, &user_email.user_id);

    let saved = match dashboards::create_dashboard(&org_id, &folder, dashboard).await {
        Ok(saved) => saved,
        Err(err) => return err.into(),
    };
    let resp_body: DashboardResponseBody = saved.into();
    MetaHttpResponse::json(resp_body)
}

/// UpdateDashboard
#[utoipa::path(
    put,
    path = "/{org_id}/dashboards/{dashboard_id}",
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
        ("folder" = String, Query, description = "Folder ID where the dashboard is located"),
        ("hash" = Option<String>, Query, description = "Hash value for conflict detection. Required when updating an existing dashboard to prevent concurrent edit conflicts"),
    ),
    request_body(content = inline(DashboardRequestBody), description = "Dashboard details"),
    responses(
        (status = StatusCode::OK, description = "Dashboard updated", body = inline(DashboardResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
        (status = StatusCode::CONFLICT, description = "Conflict: Failed to save due to concurrent changes", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the dashboard", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update an existing dashboard", "category": "dashboards"}))
    )
)]
pub async fn update_dashboard(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req_body): axum::Json<DashboardRequestBody>,
) -> Response {
    let folder = crate::common::utils::http::get_folder(&query);
    let hash = query.get("hash").map(|h| h.as_str());

    let mut dashboard: Dashboard = req_body.into();

    set_dashboard_owner_if_empty(&mut dashboard, &user_email.user_id);

    let saved = match dashboards::update_dashboard(&org_id, &dashboard_id, &folder, dashboard, hash)
        .await
    {
        Ok(saved) => saved,
        Err(err) => return err.into(),
    };
    let resp_body: DashboardResponseBody = saved.into();
    MetaHttpResponse::json(resp_body)
}

/// ListDashboards
#[utoipa::path(
    get,
    path = "/{org_id}/dashboards",
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
        (status = StatusCode::OK, body = inline(ListDashboardsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all dashboards in organization", "category": "dashboards"}))
    )
)]
pub async fn list_dashboards(
    Path(org_id): Path<String>,
    Query(query): Query<ListDashboardsQuery>,
    headers: HeaderMap,
) -> Response {
    let params = query.into(&org_id);
    let Some(user_id) = get_user_id(&headers) else {
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
    get,
    path = "/{org_id}/dashboards/{dashboard_id}",
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
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located. Used for RBAC permission checks in enterprise version"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(DashboardResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
        (status = StatusCode::FORBIDDEN, description = "Unauthorized Access", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get dashboard details by ID", "category": "dashboards"}))
    )
)]
pub async fn get_dashboard(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    let dashboard = match dashboards::get_dashboard(&org_id, &dashboard_id).await {
        Ok(dashboard) => dashboard,
        Err(err) => return err.into(),
    };
    let resp_body: DashboardResponseBody = dashboard.into();
    MetaHttpResponse::json(resp_body)
}

/// ExportDashboard
#[utoipa::path(
    get,
    path = "/{org_id}/dashboards/{dashboard_id}/export",
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
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located. Used for RBAC permission checks in enterprise version"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(DashboardResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = ()),
        (status = StatusCode::FORBIDDEN, description = "Unauthorized Access", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Export dashboard as JSON", "category": "dashboards"}))
    )
)]
pub async fn export_dashboard(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    let dashboard = match dashboards::get_dashboard(&org_id, &dashboard_id).await {
        Ok(dashboard) => dashboard,
        Err(err) => return err.into(),
    };
    let resp_body: DashboardResponseBody = dashboard.into();
    MetaHttpResponse::json(resp_body)
}

/// DeleteDashboard
#[utoipa::path(
    delete,
    path = "/{org_id}/dashboards/{dashboard_id}",
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
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located. Used for RBAC permission checks in enterprise version"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = Object),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = ()),
        (status = StatusCode::FORBIDDEN, description = "Unauthorized Access", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a dashboard by ID", "category": "dashboards"}))
    )
)]
pub async fn delete_dashboard(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    match dashboards::delete_dashboard(&org_id, &dashboard_id).await {
        Ok(()) => MetaHttpResponse::ok("Dashboard deleted"),
        Err(err) => err.into(),
    }
}

/// DeleteDashboardBulk
#[utoipa::path(
    delete,
    path = "/{org_id}/dashboards/bulk",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "DeleteDashboardBulk",
    summary = "Delete multiple dashboard",
    description = "Permanently deletes multiple dashboard and all their associated panels and configurations. This action cannot be undone",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboards are located. Required for RBAC permission checks in enterprise version"),
    ),
    request_body(
        content = BulkDeleteRequest,
        description = "Dashboard ids",
        example = json!({"ids": vec!["1","2","3"]}),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = BulkDeleteResponse),
        (status = StatusCode::FORBIDDEN, description = "Unauthorized Access", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_dashboard_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;
    let _folder_id = crate::common::utils::http::get_folder(&query);

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if !check_permissions(
            id,
            &org_id,
            &_user_id,
            "dashboards",
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

    for id in req.ids {
        match dashboards::delete_dashboard(&org_id, &id).await {
            Ok(()) => successful.push(id),
            Err(e) => {
                log::error!("error deleting dashboard {org_id}/{id} : {e}");
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

/// MoveDashboard
#[utoipa::path(
    put,
    path = "/{org_id}/folders/dashboards/{dashboard_id}",
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
        content = inline(MoveDashboardRequestBody),
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
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move dashboard to another folder", "category": "dashboards"}))
    )
)]
pub async fn move_dashboard(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req_body): axum::Json<MoveDashboardRequestBody>,
) -> Response {
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
        Ok(()) => MetaHttpResponse::ok("Dashboard moved"),
        Err(err) => err.into(),
    }
}

/// MoveDashboards
#[utoipa::path(
    patch,
    path = "/{org_id}/dashboards/move",
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
    request_body(content = inline(MoveDashboardsRequestBody), description = "Identifies dashboards and the destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move multiple dashboards to folder", "category": "dashboards"}))
    )
)]
pub async fn move_dashboards(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req_body): axum::Json<MoveDashboardsRequestBody>,
) -> Response {
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
    let query: HashMap<String, String> = url::form_urlencoded::parse(query_str.as_bytes())
        .into_owned()
        .collect();
    crate::common::utils::http::get_folder(&query)
}

pub fn is_overwrite(query_str: &str) -> bool {
    let query: HashMap<String, String> = url::form_urlencoded::parse(query_str.as_bytes())
        .into_owned()
        .collect();
    match query.get("overwrite") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    }
}

/// Tries to get the user ID from the request headers.
fn get_user_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn set_dashboard_owner_if_empty(
    dashboard: &mut config::meta::dashboards::Dashboard,
    user_email: &str,
) {
    if dashboard.owner().filter(|v| !v.is_empty()).is_none() {
        dashboard.set_owner(user_email.to_string());
    }
}

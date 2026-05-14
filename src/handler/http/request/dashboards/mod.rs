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
            DashboardRequestBody, DashboardResponseBody, DeletePanelResponseBody,
            ListDashboardsQuery, ListDashboardsResponseBody, MoveDashboardRequestBody,
            MoveDashboardsRequestBody, PanelRequestBody, PanelResponseBody,
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
            DashboardError::PanelUnsupportedVersion => MetaHttpResponse::bad_request(
                "Panel operations are only supported for v8 dashboards",
            ),
            DashboardError::TabNotFound(tab_id) => {
                MetaHttpResponse::not_found(format!("Tab not found: {tab_id}"))
            }
            DashboardError::PanelNotFound(panel_id) => {
                MetaHttpResponse::not_found(format!("Panel not found: {panel_id}"))
            }
            DashboardError::PanelAlreadyExists(panel_id, tab_id) => MetaHttpResponse::conflict(
                format!("Panel with id {panel_id} already exists in tab {tab_id}"),
            ),
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
            "description": "Create a dashboard with visualization panels. LAYOUT: 192-column grid with {x, y, w, h, i} where x=column(0-191), y=row, w=width, h=height, i=panel_id. Common widths: full=192, half=96, third=64. PANEL QUERIES: Each panel query needs 'fields' with x/y/z arrays populated EVEN when customQuery=true. AXIS RULES: x=dimension/time field, y=metric field(s), z=only for heatmaps(color intensity)/stacked-charts(breakdown field)/geo-maps(value). For most charts (line/area/bar/pie), leave z=[]. Use SELECT aliases as column values. Example: 'SELECT histogram(_timestamp) as ts, COUNT(*) as cnt' needs x=[{label:'ts',alias:'ts',column:'ts',aggregationFunction:null}], y=[{label:'cnt',alias:'cnt',column:'cnt',aggregationFunction:null}], z=[]. FILTER: The 'filter' field in 'fields' MUST be an object (NOT an array). Use: {type:'list',values:[],logicalOperator:'AND',filterType:'list'} for no filters.",
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
        ("x-o2-mcp" = json!({
            "description": "List all dashboards in organization",
            "category": "dashboards",
            "summary_fields": ["dashboard_id", "title", "description", "owner", "folder_name"]
        }))
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
        ("x-o2-mcp" = json!({"description": "Delete a dashboard by ID", "category": "dashboards", "requires_confirmation": true}))
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
            false,
            true,
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

/// AddPanel
#[utoipa::path(
    post,
    path = "/{org_id}/dashboards/{dashboard_id}/panels",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "AddPanel",
    summary = "Add a panel to a dashboard",
    description = "Add a panel to an existing dashboard. Layout auto-computed if not specified. Returns new hash for chaining.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located"),
        ("hash" = String, Query, description = "Hash value for conflict detection"),
    ),
    request_body(content = inline(PanelRequestBody), description = "Panel to add"),
    responses(
        (status = StatusCode::OK, description = "Panel added", body = inline(PanelResponseBody)),
        (status = StatusCode::BAD_REQUEST, description = "Unsupported dashboard version", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Dashboard or tab not found", body = ()),
        (status = StatusCode::CONFLICT, description = "Panel ID already exists or hash conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Add a panel to an existing dashboard. Layout auto-computed. Returns new hash for chaining.", "category": "dashboards"}))
    )
)]
pub async fn add_panel(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    axum::Json(req_body): axum::Json<PanelRequestBody>,
) -> Response {
    let folder = crate::common::utils::http::get_folder(&query);
    let hash = match query.get("hash") {
        Some(h) => h.as_str(),
        None => {
            return MetaHttpResponse::bad_request("hash query parameter is required");
        }
    };

    match dashboards::add_panel_to_dashboard(
        &org_id,
        &dashboard_id,
        &folder,
        hash,
        req_body.tab_id.as_deref(),
        req_body.panel,
    )
    .await
    {
        Ok((panel, new_hash, tab_id)) => MetaHttpResponse::json(PanelResponseBody {
            panel,
            hash: new_hash,
            tab_id,
        }),
        Err(err) => err.into(),
    }
}

/// UpdatePanel
#[utoipa::path(
    put,
    path = "/{org_id}/dashboards/{dashboard_id}/panels/{panel_id}",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "UpdatePanel",
    summary = "Update a single panel in a dashboard",
    description = "Update a single panel in a dashboard by panel ID. Preserves layout if not explicitly set.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
        ("panel_id" = String, Path, description = "Panel ID"),
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located"),
        ("hash" = String, Query, description = "Hash value for conflict detection"),
    ),
    request_body(content = inline(PanelRequestBody), description = "Panel data to update"),
    responses(
        (status = StatusCode::OK, description = "Panel updated", body = inline(PanelResponseBody)),
        (status = StatusCode::BAD_REQUEST, description = "Unsupported dashboard version", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Dashboard, tab, or panel not found", body = ()),
        (status = StatusCode::CONFLICT, description = "Hash conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a single panel in a dashboard by panel ID. Preserves layout if not explicitly set.", "category": "dashboards"}))
    )
)]
pub async fn update_panel(
    Path((org_id, dashboard_id, panel_id)): Path<(String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
    axum::Json(req_body): axum::Json<PanelRequestBody>,
) -> Response {
    let folder = crate::common::utils::http::get_folder(&query);
    let hash = match query.get("hash") {
        Some(h) => h.as_str(),
        None => {
            return MetaHttpResponse::bad_request("hash query parameter is required");
        }
    };

    match dashboards::update_panel_in_dashboard(
        &org_id,
        &dashboard_id,
        &folder,
        &panel_id,
        hash,
        req_body.tab_id.as_deref(),
        req_body.panel,
    )
    .await
    {
        Ok((panel, new_hash, tab_id)) => MetaHttpResponse::json(PanelResponseBody {
            panel,
            hash: new_hash,
            tab_id,
        }),
        Err(err) => err.into(),
    }
}

/// DeletePanel
#[utoipa::path(
    delete,
    path = "/{org_id}/dashboards/{dashboard_id}/panels/{panel_id}",
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "DeletePanel",
    summary = "Delete a single panel from a dashboard",
    description = "Delete a single panel from a dashboard by panel ID.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("dashboard_id" = String, Path, description = "Dashboard ID"),
        ("panel_id" = String, Path, description = "Panel ID"),
        ("folder" = Option<String>, Query, description = "Folder ID where the dashboard is located"),
        ("hash" = String, Query, description = "Hash value for conflict detection"),
        ("tabId" = Option<String>, Query, description = "Tab ID to search for the panel"),
    ),
    responses(
        (status = StatusCode::OK, description = "Panel deleted", body = inline(DeletePanelResponseBody)),
        (status = StatusCode::BAD_REQUEST, description = "Unsupported dashboard version", body = ()),
        (status = StatusCode::NOT_FOUND, description = "Dashboard, tab, or panel not found", body = ()),
        (status = StatusCode::CONFLICT, description = "Hash conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Delete a single panel from a dashboard by panel ID.", "category": "dashboards", "requires_confirmation": true}))
    )
)]
pub async fn delete_panel(
    Path((org_id, dashboard_id, panel_id)): Path<(String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let folder = crate::common::utils::http::get_folder(&query);
    let hash = match query.get("hash") {
        Some(h) => h.as_str(),
        None => {
            return MetaHttpResponse::bad_request("hash query parameter is required");
        }
    };
    let tab_id = query.get("tabId").map(|s| s.as_str());

    match dashboards::delete_panel_from_dashboard(
        &org_id,
        &dashboard_id,
        &folder,
        &panel_id,
        hash,
        tab_id,
    )
    .await
    {
        Ok((new_hash, deleted_panel_id)) => MetaHttpResponse::json(DeletePanelResponseBody {
            hash: new_hash,
            panel_id: deleted_panel_id,
        }),
        Err(err) => err.into(),
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

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, response::Response};

    use super::{get_folder, is_overwrite};
    use crate::service::dashboards::DashboardError;

    fn status(err: DashboardError) -> StatusCode {
        Response::from(err).status()
    }

    // get_folder
    #[test]
    fn test_get_folder_returns_param_when_present() {
        assert_eq!(get_folder("folder=my-folder"), "my-folder");
    }

    #[test]
    fn test_get_folder_returns_default_when_absent() {
        assert_eq!(
            get_folder(""),
            config::meta::folder::DEFAULT_FOLDER.to_owned()
        );
    }

    #[test]
    fn test_get_folder_other_params_ignored() {
        assert_eq!(
            get_folder("overwrite=true"),
            config::meta::folder::DEFAULT_FOLDER.to_owned()
        );
    }

    // is_overwrite
    #[test]
    fn test_is_overwrite_true() {
        assert!(is_overwrite("overwrite=true"));
    }

    #[test]
    fn test_is_overwrite_false() {
        assert!(!is_overwrite("overwrite=false"));
    }

    #[test]
    fn test_is_overwrite_absent() {
        assert!(!is_overwrite(""));
    }

    #[test]
    fn test_is_overwrite_invalid_value_defaults_false() {
        assert!(!is_overwrite("overwrite=maybe"));
    }

    // From<DashboardError> for Response — 404
    #[test]
    fn test_dashboard_not_found_is_not_found() {
        assert_eq!(
            status(DashboardError::DashboardNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_move_destination_folder_not_found_is_not_found() {
        assert_eq!(
            status(DashboardError::MoveDestinationFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_create_folder_not_found_is_not_found() {
        assert_eq!(
            status(DashboardError::CreateFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_tab_not_found_is_not_found() {
        assert_eq!(
            status(DashboardError::TabNotFound("t1".to_string())),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_panel_not_found_is_not_found() {
        assert_eq!(
            status(DashboardError::PanelNotFound("p1".to_string())),
            StatusCode::NOT_FOUND
        );
    }

    // 400 Bad Request
    #[test]
    fn test_move_missing_folder_param_is_bad_request() {
        assert_eq!(
            status(DashboardError::MoveMissingFolderParam),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_panel_unsupported_version_is_bad_request() {
        assert_eq!(
            status(DashboardError::PanelUnsupportedVersion),
            StatusCode::BAD_REQUEST
        );
    }

    // 409 Conflict
    #[test]
    fn test_update_conflicting_hash_is_conflict() {
        assert_eq!(
            status(DashboardError::UpdateConflictingHash),
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn test_panel_already_exists_is_conflict() {
        assert_eq!(
            status(DashboardError::PanelAlreadyExists(
                "p1".to_string(),
                "t1".to_string()
            )),
            StatusCode::CONFLICT
        );
    }

    // 403 Forbidden
    #[test]
    fn test_permission_denied_is_forbidden() {
        assert_eq!(
            status(DashboardError::PermissionDenied),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_user_not_found_is_forbidden() {
        assert_eq!(status(DashboardError::UserNotFound), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_list_permitted_dashboards_error_is_forbidden() {
        assert_eq!(
            status(DashboardError::ListPermittedDashboardsError(
                anyhow::anyhow!("err")
            )),
            StatusCode::FORBIDDEN
        );
    }

    // 500 Internal Server Error
    #[test]
    fn test_update_missing_hash_is_internal_error() {
        assert_eq!(
            status(DashboardError::UpdateMissingHash),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_put_missing_title_is_internal_error() {
        assert_eq!(
            status(DashboardError::PutMissingTitle),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_create_default_folder_is_internal_error() {
        assert_eq!(
            status(DashboardError::CreateDefaultFolder),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_distinct_value_error_is_internal_error() {
        assert_eq!(
            status(DashboardError::DistinctValueError),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_move_dashboard_delete_old_is_internal_error() {
        assert_eq!(
            status(DashboardError::MoveDashboardDeleteOld(
                "d1".to_string(),
                "f1".to_string(),
                "db error".to_string()
            )),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

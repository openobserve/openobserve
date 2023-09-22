// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse, Responder};
use std::{collections::HashMap, io::Error};

use crate::service::dashboards;

pub mod folders;

/** CreateDashboard */
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
        content = Dashboard,
        description = "Dashboard details",
        example = json!({
            "title": "Network Traffic Overview",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Dashboard created", body = Dashboard),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[post("/{org_id}/dashboards")]
pub async fn create_dashboard(
    path: web::Path<String>,
    body: web::Bytes,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let folder = get_folder(req);
    dashboards::create_dashboard(&org_id, &folder, body).await
}

/// UpdateDashboard
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
        content = Dashboard,
        description = "Dashboard details",
    ),
    responses(
        (status = StatusCode::OK, description = "Dashboard updated", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the dashboard", body = HttpResponse),
    ),
)]
#[put("/{org_id}/dashboards/{dashboard_id}")]
async fn update_dashboard(
    path: web::Path<(String, String)>,
    body: web::Bytes,
    req: HttpRequest,
) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    let folder = get_folder(req);
    dashboards::update_dashboard(&org_id, &dashboard_id, &folder, body).await
}

/// ListDashboards
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "ListDashboards",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, body = Dashboards),
    ),
)]
#[get("/{org_id}/dashboards")]
async fn list_dashboards(org_id: web::Path<String>, req: HttpRequest) -> impl Responder {
    let folder = get_folder(req);
    dashboards::list_dashboards(&org_id.into_inner(), &folder).await
}

/// GetDashboard
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
        (status = StatusCode::OK, body = Dashboard),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
    ),
)]
#[get("/{org_id}/dashboards/{dashboard_id}")]
async fn get_dashboard(path: web::Path<(String, String)>, req: HttpRequest) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    let folder = get_folder(req);
    dashboards::get_dashboard(&org_id, &dashboard_id, &folder).await
}

/// DeleteDashboard
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
        (status = StatusCode::OK, description = "Dashboard deleted", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Dashboard not found", body = HttpResponse),
    ),
)]
#[delete("/{org_id}/dashboards/{dashboard_id}")]
async fn delete_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, dashboard_id) = path.into_inner();
    dashboards::delete_dashboard(&org_id, &dashboard_id).await
}

fn get_folder(req: HttpRequest) -> String {
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    match query.get("folder") {
        Some(s) => s.to_string(),
        None => crate::common::meta::dashboards::DEFAULT_FOLDER.to_owned(),
    }
}

// Copyright 2024 Zinc Labs Inc.
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

use std::io::Error;

use actix_web::{delete, get, post, put, web, HttpResponse, Responder};

use crate::{
    common::meta::syslog::{SyslogRoute, SyslogServer},
    service::syslogs_route::{self},
};

/// Start/StopSyslog Server

#[post("/{org_id}/syslog-server")]
pub async fn toggle_state(details: web::Json<SyslogServer>) -> Result<HttpResponse, Error> {
    syslogs_route::toggle_state(details.into_inner()).await
}

/// CreateSyslogRoute
#[utoipa::path(
    context_path = "/api",
    tag = "Syslog Routes",
    operation_id = "CreateSyslogRoute",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = SyslogRoute,
        description = "SyslogRoute details",        
    ),
    responses(
        (status = StatusCode::CREATED, description = "Route created", body = SyslogRoute),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[post("/{org_id}/syslog-routes")]
pub async fn create_route(details: web::Json<SyslogRoute>) -> Result<HttpResponse, Error> {
    syslogs_route::create_route(details.into_inner()).await
}

/// UpdateSyslogRoute
#[utoipa::path(
    context_path = "/api",
    tag = "Syslog Routes",
    operation_id = "UpdateSyslogRoute",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Route ID"),
    ),
    request_body(
        content = SyslogRoute,
        description = "SyslogRoute details",
    ),
    responses(
        (status = StatusCode::OK, description = "SyslogRoute updated", body = SyslogRoute),
        (status = StatusCode::NOT_FOUND, description = "SyslogRoute not found", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to update the SyslogRoute", body = HttpResponse),
    ),
)]
#[put("/{org_id}/syslog-routes/{id}")]
async fn update_route(
    path: web::Path<(String, String)>,
    details: web::Json<SyslogRoute>,
) -> impl Responder {
    let (_, id) = path.into_inner();
    syslogs_route::update_route(&id, &mut details.into_inner()).await
}

/// ListSyslogRoutes
#[utoipa::path(
    context_path = "/api",
   tag = "Syslog Routes",
    operation_id = "ListSyslogRoutes",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, body = SyslogRoutes),
    ),
)]
#[get("/{org_id}/syslog-routes")]
async fn list_routes() -> impl Responder {
    syslogs_route::list_routes().await
}

/// DeleteSyslogRoute
#[utoipa::path(
    context_path = "/api",
   tag = "Syslog Routes",
    operation_id = "DeleteSyslogRoute",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "SyslogRoute Id"),
    ),
    responses(
        (status = StatusCode::OK, description = "Route deleted", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Route not found", body = HttpResponse),
    ),
)]
#[delete("/{org_id}/syslog-routes/{id}")]
async fn delete_route(path: web::Path<(String, String)>) -> impl Responder {
    let (_, id) = path.into_inner();
    syslogs_route::delete_route(&id).await
}

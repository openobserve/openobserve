// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{delete, get, http, post, put, web, HttpRequest, HttpResponse};

use crate::{
    common::meta::{dashboards::reports::Report, http::HttpResponse as MetaHttpResponse},
    service::dashboards::reports,
};

/// CreateReport
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
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match reports::save(&org_id, "", report.into_inner(), true).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// UpdateReport
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
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match reports::save(&org_id, &name, report.into_inner(), false).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Report saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// ListReports
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
async fn list_reports(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    match reports::list(&org_id.into_inner()).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// GetReport
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
            (http::StatusCode::FORBIDDEN, e) => Ok(MetaHttpResponse::forbidden(e)),
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

/// EnableReport
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
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

/// TriggerReport
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
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

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

use std::io::Error;

use actix_web::{delete, get, http, post, put, web, HttpResponse};

use crate::{
    common::meta::{alerts::scripts::Script, http::HttpResponse as MetaHttpResponse},
    service::alerts::scripts,
};

/// CreateScript
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateScript",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = Script, description = "Script data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/alerts/scripts")]
pub async fn save_script(
    path: web::Path<String>,
    script: web::Json<Script>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let script = script.into_inner();
    match scripts::save(&org_id, "", script).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert script saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// UpdateScript
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateScript",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("script_name" = String, Path, description = "Script name"),
      ),
    request_body(content = Script, description = "Script data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/alerts/scripts/{script_name}")]
pub async fn update_script(
    path: web::Path<(String, String)>,
    script: web::Json<Script>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let script = script.into_inner();
    let name = name.trim();
    match scripts::save(&org_id, name, script).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert script updated")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// GetScriptByName
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetScript",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("script_name" = String, Path, description = "Script name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = Script),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/scripts/{script_name}")]
async fn get_script(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match scripts::get(&org_id, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::not_found(e)),
    }
}

/// ListScripts
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListScripts",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Script>),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/scripts")]
async fn list_scripts(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match scripts::list(&org_id).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// DeleteScript
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertScript",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("script_name" = String, Path, description = "Script name"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = HttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/alerts/scripts/{script_name}")]
async fn delete_script(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match scripts::delete(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert script deleted")),
        Err(e) => match e {
            (http::StatusCode::FORBIDDEN, e) => Ok(MetaHttpResponse::forbidden(e)),
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

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

use actix_web::{delete, get, http, post, web, HttpResponse};
use std::io::Error;

use crate::common::meta::{alerts::DestinationTemplate, http::HttpResponse as MetaHttpResponse};
use crate::service::alerts::templates;

/** CreateTemplate */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateTemplate",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    request_body(content = DestinationTemplate, description = "Template data", content_type = "application/json"),    
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/alerts/templates/{template_name}")]
pub async fn save_template(
    path: web::Path<(String, String)>,
    tmpl: web::Json<DestinationTemplate>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let tmpl = tmpl.into_inner();
    match templates::save_template(&org_id, &name, tmpl).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert template saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/** ListTemplates */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListTemplates",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = Vec<DestinationTemplate>),
        (status = 400, description="Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/templates")]
async fn list_templates(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    match templates::list_templates(&org_id).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/** GetTemplateByName */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetTemplate",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    responses(
        (status = 200, description="Success",  content_type = "application/json", body = DestinationTemplate),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/templates/{template_name}")]
async fn get_template(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match templates::get_template(&org_id, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::not_found(e)),
    }
}

/** DeleteTemplate */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertTemplate",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = HttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Error",     content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/alerts/templates/{template_name}")]
async fn delete_template(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match templates::delete_template(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert template deleted")),
        Err(e) => match e {
            (http::StatusCode::FORBIDDEN, e) => Ok(MetaHttpResponse::forbidden(e)),
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

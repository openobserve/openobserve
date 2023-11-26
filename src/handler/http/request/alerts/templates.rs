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

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::{common::meta::alert::DestinationTemplate, service::alerts::templates};

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
    )
)]
#[post("/{org_id}/alerts/templates/{template_name}")]
pub async fn save_template(
    path: web::Path<(String, String)>,
    alert: web::Json<DestinationTemplate>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    templates::save_template(org_id, name, alert.into_inner()).await
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
    )
)]
#[get("/{org_id}/alerts/templates")]
async fn list_templates(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();
    templates::list_templates(org_id).await
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
        (status = 200, description="Success", content_type = "application/json", body = DestinationTemplate),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/templates/{template_name}")]
async fn get_template(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    templates::get_template(org_id, name).await
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description="Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/alerts/templates/{template_name}")]
async fn delete_template(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    templates::delete_template(org_id, name).await
}

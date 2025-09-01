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

use std::io::Error;

use actix_web::{HttpRequest, HttpResponse, delete, get, http::StatusCode, post, put, web};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::destinations::Template,
    service::{alerts::templates, db::alerts::templates::TemplateError},
};

impl From<TemplateError> for HttpResponse {
    fn from(value: TemplateError) -> Self {
        match value {
            TemplateError::InfraError(e) => {
                MetaHttpResponse::internal_error(TemplateError::InfraError(e))
            }
            TemplateError::NotFound => MetaHttpResponse::not_found(TemplateError::NotFound),
            TemplateError::DeleteWithDestination(e) => {
                MetaHttpResponse::conflict(TemplateError::DeleteWithDestination(e))
            }
            other_err => MetaHttpResponse::bad_request(other_err),
        }
    }
}

/// CreateTemplate
///
/// #{"ratelimit_module":"Templates", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Templates",
    operation_id = "CreateTemplate",
    summary = "Create alert template",
    description = "Creates a new alert notification template for an organization. Templates define the format and content \
                   of alert notifications, including message structure, variable substitutions, and styling options. \
                   Templates can be reused across multiple alert destinations to maintain consistent notification formatting \
                   and branding across different channels.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = Template, description = "Template data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/alerts/templates")]
pub async fn save_template(
    path: web::Path<String>,
    tmpl: web::Json<Template>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let tmpl = tmpl.into_inner().into(&org_id);
    match templates::save("", tmpl, true).await {
        Ok(v) => Ok(MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Template saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        )),
        Err(e) => Ok(e.into()),
    }
}

/// UpdateTemplate
///
/// #{"ratelimit_module":"Templates", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Templates",
    operation_id = "UpdateTemplate",
    summary = "Update alert template",
    description = "Updates an existing alert notification template. Allows modification of template content, formatting, \
                   variable placeholders, and styling options. Changes to templates will apply to all future alert \
                   notifications that use this template, providing a centralized way to update notification formats across \
                   multiple alerts and destinations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    request_body(content = Template, description = "Template data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
#[put("/{org_id}/alerts/templates/{template_name}")]
pub async fn update_template(
    path: web::Path<(String, String)>,
    tmpl: web::Json<Template>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let tmpl = tmpl.into_inner().into(&org_id);
    match templates::save(&name, tmpl, false).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Template updated")),
        Err(e) => Ok(e.into()),
    }
}

/// GetTemplateByName
///
/// #{"ratelimit_module":"Templates", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Templates",
    operation_id = "GetTemplate",
    summary = "Get alert template",
    description = "Retrieves the configuration and content of a specific alert notification template. Returns the template \
                   structure including message format, variable definitions, styling options, and other formatting \
                   parameters. Used for reviewing existing templates and understanding notification formats before making \
                   modifications.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = Template),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/alerts/templates/{template_name}")]
async fn get_template(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match templates::get(&org_id, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(Template::from(data))),
        Err(e) => Ok(e.into()),
    }
}

/// ListTemplates
///
/// #{"ratelimit_module":"Templates", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Templates",
    operation_id = "ListTemplates",
    summary = "List alert templates",
    description = "Retrieves a list of all alert notification templates configured for an organization. Returns template \
                   names, types, and basic metadata to help administrators manage notification formatting options. \
                   Templates provide reusable formatting configurations that ensure consistent alert notifications across \
                   different channels and destinations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Template>),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/alerts/templates")]
async fn list_templates(path: web::Path<String>, _req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = _req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            "template",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return Ok(crate::common::meta::http::HttpResponse::forbidden(
                    e.to_string(),
                ));
            }
        }
        // Get List of allowed objects ends
    }

    match templates::list(&org_id, _permitted).await {
        Ok(data) => Ok(MetaHttpResponse::json(
            data.into_iter().map(Template::from).collect::<Vec<_>>(),
        )),
        Err(e) => Ok(e.into()),
    }
}

/// DeleteTemplate
///
/// #{"ratelimit_module":"Templates", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Templates",
    operation_id = "DeleteAlertTemplate",
    summary = "Delete alert template",
    description = "Removes an alert notification template from the organization. The template must not be in use by any \
                   active destinations before deletion. Once deleted, any destinations previously using this template \
                   will need to be updated with alternative templates to continue formatting notifications properly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 409, description = "Conflict", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    )
)]
#[delete("/{org_id}/alerts/templates/{template_name}")]
async fn delete_template(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match templates::delete(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Template deleted")),
        Err(e) => Ok(e.into()),
    }
}

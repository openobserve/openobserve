// Copyright 2024 OpenObserve Inc.
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

use actix_web::{delete, get, http, post, put, web, HttpRequest, HttpResponse};
use config::meta::{actions::action::Action, alerts::destinations::Destination};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::action::save_and_run_action;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
/// Save Action
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Actions",
    operation_id = "Create Action",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Template, description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/actions")]
pub async fn save_action(
    path: web::Path<String>,
    action: web::Json<Action>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let action = action.into_inner();
    match save_and_run_action(action).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Action saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// /// Update Action
// #[utoipa::path(
//     context_path = "/api",
//     tag = "Actions",
//     operation_id = "UpdateAction",
//     security(
//         ("Authorization"= [])
//     ),
//     params(
//         ("org_id" = String, Path, description = "Organization name"),
//     ),
//     request_body(content = Template, description = "Template data", content_type =
// "application/json"),     responses(
//         (status = 200, description = "Success", content_type = "application/json", body =
// HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
// body = HttpResponse),     )
// )]
// #[put("/{org_id}/actions")]
// pub async fn update_action(
//     path: web::Path<String>,
//     action: web::Json<Action>,
// ) -> Result<HttpResponse, Error> {
// }
//
// /// Get Action
// #[utoipa::path(
//     context_path = "/api",
//     tag = "Actions",
//     operation_id = "ListActions",
//     security(
//         ("Authorization"= [])
//     ),
//     params(
//         ("org_id" = String, Path, description = "Organization name"),
//     ),
//     request_body(content = Template, description = "Template data", content_type =
// "application/json"),     responses(
//         (status = 200, description = "Success", content_type = "application/json", body =
// HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
// body = HttpResponse),     )
// )]
// #[get("/{org_id}/actions")]
// pub async fn list_actions(path: web::Path<String>) -> Result<HttpResponse, Error> {
//     let org_id = path.into_inner();
// }
//
// /// Delete Action
// #[utoipa::path(
//     context_path = "/api",
//     tag = "Actions",
//     operation_id = "CreateAction",
//     security(
//         ("Authorization"= [])
//     ),
//     params(
//         ("org_id" = String, Path, description = "Organization name"),
//     ),
//     request_body(content = Template, description = "Template data", content_type =
// "application/json"),     responses(
//         (status = 200, description = "Success", content_type = "application/json", body =
// HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
// body = HttpResponse),     )
// )]
// #[delete("/{org_id}/actions")]
// pub async fn delete_action(
//     path: web::Path<String>,
//     action: web::Json<Action>,
// ) -> Result<HttpResponse, Error> {
//     let org_id = path.into_inner();
// }
//
// /// Get single Action
// #[utoipa::path(
//     context_path = "/api",
//     tag = "Actions",
//     operation_id = "CreateAction",
//     security(
//         ("Authorization"= [])
//     ),
//     params(
//         ("org_id" = String, Path, description = "Organization name"),
//         ("action_id" = String, Path, description = "Action ID"),
//     ),
//     request_body(content = Template, description = "Template data", content_type =
// "application/json"),     responses(
//         (status = 200, description = "Success", content_type = "application/json", body =
// HttpResponse),         (status = 400, description = "Error",   content_type = "application/json",
// body = HttpResponse),     )
// )]
// #[get("/{org_id}/actions/{action_id}")]
// pub async fn get_action(
//     path: web::Path<String>,
//     action: web::Json<Action>,
// ) -> Result<HttpResponse, Error> {
//     let org_id = path.into_inner();
// }

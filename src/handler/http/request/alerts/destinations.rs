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

use actix_web::{delete, get, http, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
use crate::service::db;
use crate::{common::meta::alert::AlertDestination, service::alerts::destinations};

/** CreateDestination */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateDestination",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
      ),
    request_body(content = AlertDestination, description = "Destination data", content_type = "application/json"),  
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/alerts/destinations/{destination_name}")]
pub async fn save_destination(
    path: web::Path<(String, String)>,
    dest: web::Json<AlertDestination>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();

    let dest = dest.into_inner();

    if db::alerts::templates::get(org_id.as_str(), &dest.template)
        .await
        .is_err()
    {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Please specify valid template".to_string(),
        )));
    }
    destinations::save_destination(org_id, name, dest).await
}

/** ListDestinations */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListDestinations",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = Vec<AlertDestinationResponse>),
    )
)]
#[get("/{org_id}/alerts/destinations")]
async fn list_destinations(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();
    destinations::list_destinations(org_id).await
}

/** GetDestination */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetDestination",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = AlertDestinationResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/destinations/{destination_name}")]
async fn get_destination(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    destinations::get_destination(org_id, name).await
}

/** DeleteDestination */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertDestination",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/alerts/destinations/{destination_name}")]
async fn delete_destination(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    destinations::delete_destination(org_id, name).await
}

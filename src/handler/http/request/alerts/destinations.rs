// Copyright 2022 Zinc Labs Inc. and Contributors
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

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::{
    meta::alert::AlertDestination,
    service::alerts::{destinations, templates},
};

/** Create new alert destination for an organization */
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
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/alerts/templates/{destination_name}")]
pub async fn save_destination(
    path: web::Path<(String, String)>,
    dest: web::Json<AlertDestination>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    destinations::save_destination(org_id, name, dest.into_inner()).await
}

/** List all destinations for an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/destinations")]
async fn list_destinations(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();
    destinations::list_destinations(org_id).await
}

/** Get alert destination by destination name */
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
        (status = 200, description="Success", content_type = "application/json", body = Alert),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/alerts/destinations/{destination_name}")]
async fn get_destination(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    destinations::get_destination(org_id, name).await
}

/** Delete alert destination by alert destination name */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/alerts/templates/{template_name}")]
async fn delete_destination(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    destinations::delete_destination(org_id, name).await
}

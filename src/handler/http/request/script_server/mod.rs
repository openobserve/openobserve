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

use actix_web::{delete, get, post, web, Responder};
use config::meta::actions::action::DeployActionRequest;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::action_deployer::{
    create_app, delete_app, get_app_status, list_apps,
};

use crate::common::meta::http::HttpResponse;

#[post("/{org_id}/v1/job")]
pub async fn create_job(
    path: web::Path<String>,
    req: web::Json<DeployActionRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    log::info!("Creating job for org_id: {}", org_id);
    match create_app(&org_id, req.into_inner()).await {
        Ok(created_at) => HttpResponse::ok(created_at.to_rfc3339()),
        Err(e) => HttpResponse::internal_error(e),
    }
}

#[delete("/{org_id}/v1/job/{name}")]
pub async fn delete_job(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    match delete_app(&name).await {
        Ok(_) => HttpResponse::ok(""),
        Err(e) => HttpResponse::internal_error(e),
    }
}

#[get("/{org_id}/v1/job/{name}")]
pub async fn get_app_details(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    match get_app_status(&name).await {
        Ok(resp) => HttpResponse::json(resp),
        Err(e) => HttpResponse::internal_error(e),
    }
}

#[get("/{org_id}/v1/job")]
pub async fn list_deployed_apps(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();
    match list_apps(&org_id).await {
        Ok(resp) => HttpResponse::json(resp),
        Err(e) => HttpResponse::internal_error(e),
    }
}

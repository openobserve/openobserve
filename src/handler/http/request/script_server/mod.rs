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

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use config::meta::actions::action::DeployActionRequest;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::app_deployer::APP_DEPLOYER;

#[post("/{org_id}/v1/job")]
pub async fn create_job(path: web::Path<String>, body: web::Bytes) -> impl Responder {
    let org_id = path.into_inner();

    // Convert body to string
    let req: DeployActionRequest = serde_json::from_slice(&body).unwrap();

    if let Some(deployer) = APP_DEPLOYER.get() {
        return match deployer.create_app(&org_id, req).await {
            Ok(created_at) => HttpResponse::Ok().body(created_at.to_rfc3339()),
            Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
        };
    }

    HttpResponse::InternalServerError().json("AppDeployer not initialized")
}

#[delete("/{org_id}/v1/job/{name}")]
pub async fn delete_job(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();

    if let Some(deployer) = APP_DEPLOYER.get() {
        return match deployer.delete_app(&org_id, &name).await {
            Ok(_) => HttpResponse::Ok().finish(),
            Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
        };
    }
    HttpResponse::InternalServerError().json("AppDeployer not initialized")
}

#[get("/{org_id}/v1/job/{name}")]
pub async fn get_app_details(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();

    if let Some(deployer) = APP_DEPLOYER.get() {
        return match deployer.get_app_status(&org_id, &name).await {
            Ok(resp) => HttpResponse::Ok().json(resp),
            Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
        };
    }
    HttpResponse::InternalServerError().json("AppDeployer not initialized")
}

#[get("/{org_id}/v1/job")]
pub async fn list_deployed_apps(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();

    if let Some(deployer) = APP_DEPLOYER.get() {
        return match deployer.list_apps(&org_id).await {
            Ok(resp) => HttpResponse::Ok().json(resp),
            Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
        };
    }

    HttpResponse::InternalServerError().json("AppDeployer not initialized")
}

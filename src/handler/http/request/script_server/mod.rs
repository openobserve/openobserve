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

use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse, Responder};
use config::meta::actions::action::DeployActionRequest;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::acton_deployer::{
    create_app, delete_app, get_app_status, list_apps,
};

#[post("/v1/job")]
pub async fn create_job(path: web::Path<String>, req: DeployActionRequest) -> impl Responder {
    match create_app(req) {
        Ok(created_at) => HttpResponse::Ok().json(serde_json::json!({"created_at":created_at})),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

#[delete("/v1/job/{name}")]
pub async fn delete_job(path: web::Path<String>) -> impl Responder {
    let name = path.into();
    match delete_app(&name) {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({"deleted":name})),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

#[get("/v1/job/{name}")]
pub async fn get_app_details(path: web::Path<String>) -> impl Responder {
    let name = path.into();
    match get_app_status(&name) {
        Ok(resp) => HttpResponse::Ok().json(resp),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

#[get("/v1/job")]
pub async fn list_deployed_apps(_path: web::Path<String>) -> impl Responder {
    match list_apps() {
        Ok(resp) => HttpResponse::Ok().json(resp),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

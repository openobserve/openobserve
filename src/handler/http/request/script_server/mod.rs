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

use actix_web::{delete, get, post, web, HttpRequest, Responder};
use config::meta::actions::action::DeployActionRequest;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::app_deployer::APP_DEPLOYER;

use crate::common::meta::http::HttpResponse;

#[post("/{org_id}/v1/job")]
pub async fn create_job(
    path: web::Path<String>,
    req: HttpRequest,
    body: web::Bytes,
) -> impl Responder {
    // Extract header
    let cluster_url = if let Some(cluster_url) = req
        .headers()
        .get("X-Cluster-URL")
        .and_then(|v| v.to_str().ok())
    {
        log::info!("Cluster URL: {}", cluster_url);
        cluster_url
    } else {
        return HttpResponse::bad_request("Cluster URL not provided");
    };

    let org_id = path.into_inner();

    // Convert body to string
    let req: DeployActionRequest = serde_json::from_slice(&body).unwrap();

    let deployer = APP_DEPLOYER
        .get()
        .ok_or_else(|| HttpResponse::internal_error("AppDeployer not initialized"))
        .unwrap();
    match deployer.create_app(&org_id, req, cluster_url).await {
        Ok(created_at) => HttpResponse::ok(created_at.to_rfc3339()),
        Err(e) => HttpResponse::internal_error(e.to_string()),
    }
}

#[delete("/{org_id}/v1/job/{name}")]
pub async fn delete_job(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();

    let deployer = APP_DEPLOYER
        .get()
        .ok_or_else(|| HttpResponse::internal_error("AppDeployer not initialized"))
        .unwrap();
    match deployer.delete_app(&name).await {
        Ok(_) => HttpResponse::ok(""),
        Err(e) => HttpResponse::internal_error(e),
    }
}

#[get("/{org_id}/v1/job/{name}")]
pub async fn get_app_details(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();

    let deployer = APP_DEPLOYER
        .get()
        .ok_or_else(|| HttpResponse::internal_error("AppDeployer not initialized"))
        .unwrap();
    match deployer.get_app_status(&name).await {
        Ok(resp) => HttpResponse::json(resp),
        Err(e) => HttpResponse::internal_error(e),
    }
}

#[get("/{org_id}/v1/job")]
pub async fn list_deployed_apps(path: web::Path<String>) -> impl Responder {
    let org_id = path.into_inner();

    let deployer = APP_DEPLOYER
        .get()
        .ok_or_else(|| HttpResponse::internal_error("AppDeployer not initialized"))
        .unwrap();
    match deployer.list_apps(&org_id).await {
        Ok(resp) => HttpResponse::json(resp),
        Err(e) => HttpResponse::internal_error(e),
    }
}

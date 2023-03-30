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

use crate::{meta::dashboards::Dashboard, service::dashboards};

#[post("/{org_id}/dashboards/{name}")]
pub async fn save_dashboard(
    path: web::Path<(String, String)>,
    details: web::Json<Dashboard>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    dashboards::save_dashboard(&org_id, &name, &details.into_inner()).await
}

#[get("/{org_id}/dashboards")]
async fn list_dashboards(org_id: web::Path<String>) -> impl Responder {
    dashboards::list_dashboards(&org_id.into_inner()).await
}

#[get("/{org_id}/dashboards/{name}")]
async fn get_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    dashboards::get_dashboard(&org_id, &name).await
}

#[delete("/{org_id}/dashboards/{name}")]
async fn delete_dashboard(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    dashboards::delete_dashboard(&org_id, &name).await
}

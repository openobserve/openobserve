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

use actix_web::{http::StatusCode, HttpResponse};
use std::io;
use tracing::instrument;

use crate::meta::{self, dashboards::Dashboard, http::HttpResponse as MetaHttpResponse};
use crate::service::db::dashboard;

#[instrument]
pub async fn get_dashboard(org_id: &str, name: &str) -> Result<HttpResponse, io::Error> {
    Ok(match dashboard::get(org_id, name).await {
        Err(_) | Ok(None) => not_found("Dashboard not found"),
        Ok(Some(dashboard)) => HttpResponse::Ok().json(dashboard),
    })
}

#[instrument(skip(dashboard))]
pub async fn create_dashboard(
    org_id: &str,
    name: &str,
    dashboard: &Dashboard,
) -> Result<HttpResponse, io::Error> {
    if let Err(e) = dashboard::set(org_id, name, dashboard).await {
        return Ok(
            HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        );
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "Dashboard saved".to_string(),
    )))
}

#[instrument]
pub async fn list_dashboards(org_id: &str) -> Result<HttpResponse, io::Error> {
    use meta::dashboards::DashboardList;

    Ok(HttpResponse::Ok().json(DashboardList {
        list: dashboard::list(org_id).await.unwrap(),
    }))
}

#[instrument]
pub async fn delete_dashboard(org_id: &str, name: &str) -> Result<HttpResponse, io::Error> {
    if let Err(e) = dashboard::delete(org_id, name).await {
        return Ok(not_found(e.to_string()));
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "Dashboard deleted".to_string(),
    )))
}

fn not_found(error_message: impl AsRef<str>) -> HttpResponse {
    HttpResponse::NotFound().json(MetaHttpResponse::error(
        StatusCode::NOT_FOUND.into(),
        error_message.as_ref().to_owned(),
    ))
}

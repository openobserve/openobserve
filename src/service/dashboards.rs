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

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;
use tracing::info_span;

use crate::meta::dashboards::DashboardList;
use crate::meta::{self, http::HttpResponse as MetaHttpResponse};
use crate::service::db;

pub async fn get_dashboard(org_id: &str, name: &str) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:dashboards:get");
    let _guard = loc_span.enter();
    let ret = db::dashboard::get(org_id, name).await;
    match ret {
        Ok(Some(dashboard)) => Ok(HttpResponse::Ok().json(dashboard)),
        Ok(None) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some("Dashboard not found".to_string()),
        ))),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some("Dashboard not found".to_string()),
        ))),
    }
}

pub async fn save_dashboard(
    org_id: &str,
    name: &str,
    details: &str,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:dashboards:save");
    let _guard = loc_span.enter();
    let ret = db::dashboard::set(org_id, name, details).await;
    match ret {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Dashboard saved".to_string(),
        ))),
        Err(err) => Ok(
            HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                StatusCode::BAD_REQUEST.into(),
                Some(err.to_string()),
            )),
        ),
    }
}

pub async fn list_dashboards(org_id: &str) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:dashboards:list");
    let _guard = loc_span.enter();
    let list = db::dashboard::list(org_id).await.unwrap();
    Ok(HttpResponse::Ok().json(DashboardList { list }))
}

pub async fn delete_dashboard(org_id: &str, name: &str) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:dashboards:delete");
    let _guard = loc_span.enter();
    let result = db::dashboard::delete(org_id, name).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Dashboard deleted".to_string(),
        ))),
        Err(err) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some(err.to_string()),
        ))),
    }
}

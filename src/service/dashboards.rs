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

#[instrument(skip(dashboard))]
pub async fn create_dashboard(
    org_id: &str,
    mut dashboard: Dashboard,
) -> Result<HttpResponse, io::Error> {
    // NOTE: here we overwrite whatever `dashboard_id` the client sent us.
    dashboard.dashboard_id = crate::infra::ider::generate();
    let resp = if let Err(e) = dashboard::put(org_id, &dashboard).await {
        Response::InternalServerError(e)
    } else {
        tracing::info!(dashboard_id = dashboard.dashboard_id, "Dashboard created");
        Response::Created {
            dashboard_id: dashboard.dashboard_id,
        }
    };
    Ok(resp.into())
}

#[instrument(skip(dashboard))]
pub async fn update_dashboard(
    org_id: &str,
    dashboard_id: &str,
    dashboard: &Dashboard,
) -> Result<HttpResponse, io::Error> {
    if dashboard::get(org_id, dashboard_id).await.is_err() {
        return Ok(Response::NotFound { error: None }.into());
    }
    if let Err(e) = dashboard::put(org_id, dashboard).await {
        return Ok(Response::InternalServerError(e).into());
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "Dashboard updated".to_owned(),
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
pub async fn get_dashboard(org_id: &str, dashboard_id: &str) -> Result<HttpResponse, io::Error> {
    Ok(match dashboard::get(org_id, dashboard_id).await {
        Err(_) => Response::NotFound { error: None }.into(),
        Ok(dashboard) => HttpResponse::Ok().json(
            // The value is safe to unwrap, because `dashboard::get` never
            // returns `Ok(None)`.
            dashboard.unwrap(),
        ),
    })
}

#[instrument]
pub async fn delete_dashboard(org_id: &str, dashboard_id: &str) -> Result<HttpResponse, io::Error> {
    if let Err(e) = dashboard::delete(org_id, dashboard_id).await {
        return Ok(Response::NotFound {
            error: Some(e.to_string()),
        }
        .into());
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "Dashboard deleted".to_string(),
    )))
}

#[derive(Debug)]
enum Response {
    Created { dashboard_id: String },
    NotFound { error: Option<String> },
    InternalServerError(anyhow::Error),
}

impl From<Response> for HttpResponse {
    fn from(resp: Response) -> Self {
        match resp {
            Response::Created { dashboard_id } => Self::Created().json(MetaHttpResponse::message(
                StatusCode::CREATED.into(),
                format!("Dashboard {dashboard_id} created"),
            )),
            Response::NotFound { error } => Self::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                error.unwrap_or_else(|| "Dashboard not found".to_owned()),
            )),
            Response::InternalServerError(err) => Self::InternalServerError().json(
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.into(), err.to_string()),
            ),
        }
    }
}

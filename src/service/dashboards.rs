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

use crate::meta::{self, dashboards::Dashboard, http::HttpResponse as MetaHttpResponse};
use crate::service::db::dashboard;

#[tracing::instrument(skip(dashboard))]
pub async fn create_dashboard(
    org_id: &str,
    mut dashboard: Dashboard,
) -> Result<HttpResponse, io::Error> {
    // NOTE: Overwrite whatever `dashboard_id` the client has sent us
    dashboard.dashboard_id = crate::infra::ider::generate();
    if let Err(e) = dashboard::put(org_id, &dashboard).await {
        return Ok(Response::InternalServerError(e).into());
    }
    tracing::info!(dashboard_id = dashboard.dashboard_id, "Dashboard created");
    Ok(HttpResponse::Created().json(dashboard))
}

#[tracing::instrument(skip(dashboard))]
pub async fn update_dashboard(
    org_id: &str,
    dashboard_id: &str,
    dashboard: &Dashboard,
) -> Result<HttpResponse, io::Error> {
    // Try to find this dashboard in the database
    let old_dashboard = match dashboard::get(org_id, dashboard_id).await {
        Ok(dashboard) => dashboard,
        Err(error) => {
            tracing::info!(%error, dashboard_id, "Dashboard not found");
            return Ok(Response::NotFound.into());
        }
    };

    if dashboard == &old_dashboard {
        // There is no need to update the database
        return Ok(HttpResponse::Ok().json(dashboard));
    }

    // Store new dashboard in the database
    if let Err(error) = dashboard::put(org_id, dashboard).await {
        tracing::error!(%error, dashboard_id, "Failed to store the dashboard");
        return Ok(Response::InternalServerError(error).into());
    }
    Ok(HttpResponse::Ok().json(dashboard))
}

#[tracing::instrument]
pub async fn list_dashboards(org_id: &str) -> Result<HttpResponse, io::Error> {
    use meta::dashboards::Dashboards;

    Ok(HttpResponse::Ok().json(Dashboards {
        dashboards: dashboard::list(org_id).await.unwrap(),
    }))
}

#[tracing::instrument]
pub async fn get_dashboard(org_id: &str, dashboard_id: &str) -> Result<HttpResponse, io::Error> {
    let resp = if let Ok(dashboard) = dashboard::get(org_id, dashboard_id).await {
        HttpResponse::Ok().json(dashboard)
    } else {
        Response::NotFound.into()
    };
    Ok(resp)
}

#[tracing::instrument]
pub async fn delete_dashboard(org_id: &str, dashboard_id: &str) -> Result<HttpResponse, io::Error> {
    let resp = if dashboard::delete(org_id, dashboard_id).await.is_err() {
        Response::NotFound
    } else {
        Response::OkMessage("Dashboard deleted".to_owned())
    };
    Ok(resp.into())
}

#[derive(Debug)]
enum Response {
    OkMessage(String),
    NotFound,
    InternalServerError(anyhow::Error),
}

impl From<Response> for HttpResponse {
    fn from(resp: Response) -> Self {
        match resp {
            Response::OkMessage(message) => {
                Self::Ok().json(MetaHttpResponse::message(StatusCode::OK.into(), message))
            }
            Response::NotFound => Self::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                "Dashboard not found".to_owned(),
            )),
            Response::InternalServerError(err) => Self::InternalServerError().json(
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.into(), err.to_string()),
            ),
        }
    }
}

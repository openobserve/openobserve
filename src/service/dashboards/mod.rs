// Copyright 2023 Zinc Labs Inc.
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

use actix_web::web;
use actix_web::{http::StatusCode, HttpResponse};
use std::io;

use crate::common::meta::dashboards::DEFAULT_FOLDER;
use crate::common::meta::{self, http::HttpResponse as MetaHttpResponse};
use crate::common::utils::json;
use crate::service::db::dashboards;

pub mod folders;

#[tracing::instrument(skip(body))]
pub async fn create_dashboard(
    org_id: &str,
    folder_id: &str,
    body: web::Bytes,
) -> Result<HttpResponse, io::Error> {
    // NOTE: Overwrite whatever `dashboard_id` the client has sent us
    // If folder is default folder & doesn't exist then create it

    match dashboards::folders::get(org_id, folder_id).await {
        Ok(_) => {
            let dashboard_id = crate::common::infra::ider::generate();
            save_dashboard(org_id, &dashboard_id, folder_id, body).await
        }
        Err(_) => {
            if folder_id == DEFAULT_FOLDER {
                let folder = meta::dashboards::Folder {
                    folder_id: DEFAULT_FOLDER.to_string(),
                    name: DEFAULT_FOLDER.to_string(),
                    description: DEFAULT_FOLDER.to_string(),
                };
                folders::save_folder(org_id, folder, true).await?;
                let dashboard_id = crate::common::infra::ider::generate();
                save_dashboard(org_id, &dashboard_id, folder_id, body).await
            } else {
                Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    StatusCode::NOT_FOUND.into(),
                    "folder not found".to_string(),
                )))
            }
        }
    }
}

#[tracing::instrument(skip(body))]
pub async fn update_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    body: web::Bytes,
) -> Result<HttpResponse, io::Error> {
    // Store new dashboard in the database
    save_dashboard(org_id, dashboard_id, folder_id, body).await
}

#[tracing::instrument]
pub async fn list_dashboards(org_id: &str, folder_id: &str) -> Result<HttpResponse, io::Error> {
    use meta::dashboards::Dashboards;

    Ok(HttpResponse::Ok().json(Dashboards {
        dashboards: dashboards::list(org_id, folder_id).await.unwrap(),
    }))
}

#[tracing::instrument]
pub async fn get_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
) -> Result<HttpResponse, io::Error> {
    let resp = if let Ok(dashboard) = dashboards::get(org_id, dashboard_id, folder_id).await {
        HttpResponse::Ok().json(dashboard)
    } else {
        return Ok(Response::NotFound("Dashboard".to_string()).into());
    };
    Ok(resp)
}

#[tracing::instrument]
pub async fn delete_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
) -> Result<HttpResponse, io::Error> {
    let resp = if dashboards::delete(org_id, dashboard_id, folder_id)
        .await
        .is_err()
    {
        return Ok(Response::NotFound("Dashboard".to_string()).into());
    } else {
        Response::OkMessage("Dashboard deleted".to_owned())
    };
    Ok(resp.into())
}

async fn save_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    body: web::Bytes,
) -> Result<HttpResponse, io::Error> {
    match dashboards::put(org_id, dashboard_id, folder_id, body).await {
        Ok(dashboard) => {
            tracing::info!(dashboard_id, "Dashboard updated");
            Ok(HttpResponse::Ok().json(dashboard))
        }
        Err(error) => {
            tracing::error!(%error, dashboard_id, "Failed to store the dashboard");
            Ok(Response::InternalServerError(error).into())
        }
    }
}

#[tracing::instrument]
pub async fn move_dashboard(
    org_id: &str,
    dashboard_id: &str,
    from_folder: &str,
    to_folder: &str,
) -> Result<HttpResponse, io::Error> {
    if let Ok(dashboard) = dashboards::get(org_id, dashboard_id, from_folder).await {
        // make sure the destination folder exists
        if dashboards::folders::get(org_id, to_folder).await.is_err() {
            return Ok(Response::NotFound("Destination Folder".to_string()).into());
        }
        let dash = if dashboard.version == 1 {
            json::to_vec(&dashboard.v1.unwrap()).unwrap()
        } else {
            json::to_vec(&dashboard.v2.unwrap()).unwrap()
        };

        // add the dashboard to the destination folder
        if let Err(error) = dashboards::put(org_id, dashboard_id, to_folder, dash.into()).await {
            return Ok(Response::InternalServerError(error).into());
        }

        //delete the dashboard from the source folder
        let _ = dashboards::delete(org_id, dashboard_id, from_folder).await;
        Ok(Response::OkMessage("Dashboard moved successfully".to_string()).into())
    } else {
        Ok(Response::NotFound("Dashboard".to_string()).into())
    }
}

#[derive(Debug)]
enum Response {
    OkMessage(String),
    NotFound(String),
    InternalServerError(anyhow::Error),
}

impl From<Response> for HttpResponse {
    fn from(resp: Response) -> Self {
        match resp {
            Response::OkMessage(message) => {
                Self::Ok().json(MetaHttpResponse::message(StatusCode::OK.into(), message))
            }
            Response::NotFound(entity) => Self::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                format!("{entity} not found"),
            )),
            Response::InternalServerError(err) => Self::InternalServerError().json(
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.into(), err.to_string()),
            ),
        }
    }
}

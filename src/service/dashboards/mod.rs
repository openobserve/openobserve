// Copyright 2023 Zinc Labs Inc.
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

use std::io;

use actix_web::{http, web, HttpResponse};
use config::{ider, utils::json};

use crate::{
    common::{
        meta::{
            authz::Authz,
            dashboards::{Dashboards, Folder, DEFAULT_FOLDER},
            http::HttpResponse as MetaHttpResponse,
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::db::dashboards,
};

pub mod folders;
pub mod reports;

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
            let dashboard_id = ider::generate();
            match save_dashboard(org_id, &dashboard_id, folder_id, body).await {
                Ok(res) => {
                    set_ownership(
                        org_id,
                        "dashboards",
                        Authz {
                            obj_id: dashboard_id,
                            parent_type: "folders".to_owned(),
                            parent: folder_id.to_owned(),
                        },
                    )
                    .await;
                    Ok(res)
                }
                Err(_) => todo!(),
            }
        }
        Err(_) => {
            if folder_id == DEFAULT_FOLDER {
                let folder = Folder {
                    folder_id: DEFAULT_FOLDER.to_string(),
                    name: DEFAULT_FOLDER.to_string(),
                    description: DEFAULT_FOLDER.to_string(),
                };
                folders::save_folder(org_id, folder, true).await?;
                let dashboard_id = ider::generate();
                match save_dashboard(org_id, &dashboard_id, folder_id, body).await {
                    Ok(res) => {
                        set_ownership(
                            org_id,
                            "dashboards",
                            Authz {
                                obj_id: dashboard_id,
                                parent_type: "folders".to_owned(),
                                parent: folder_id.to_owned(),
                            },
                        )
                        .await;
                        Ok(res)
                    }
                    Err(error) => Ok(HttpResponse::InternalServerError().json(
                        MetaHttpResponse::message(
                            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                            error.to_string(),
                        ),
                    )),
                }
            } else {
                Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    http::StatusCode::NOT_FOUND.into(),
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
    if dashboards::get(org_id, dashboard_id, folder_id)
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Dashboard not found".to_string(),
        )));
    }
    match dashboards::delete(org_id, dashboard_id, folder_id).await {
        Ok(_) => {
            remove_ownership(
                org_id,
                "dashboards",
                Authz {
                    obj_id: dashboard_id.to_owned(),
                    parent_type: "folders".to_owned(),
                    parent: folder_id.to_owned(),
                },
            )
            .await;
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "Dashboard deleted".to_string(),
            )))
        }
        Err(error) => Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        ),
    }
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
        } else if dashboard.version == 2 {
            json::to_vec(&dashboard.v2.unwrap()).unwrap()
        } else {
            json::to_vec(&dashboard.v3.unwrap()).unwrap()
        };

        // add the dashboard to the destination folder
        if let Err(error) = dashboards::put(org_id, dashboard_id, to_folder, dash.into()).await {
            return Ok(Response::InternalServerError(error).into());
        }

        // delete the dashboard from the source folder
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
            Response::OkMessage(message) => Self::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                message,
            )),
            Response::NotFound(entity) => Self::NotFound().json(MetaHttpResponse::error(
                http::StatusCode::NOT_FOUND.into(),
                format!("{entity} not found"),
            )),
            Response::InternalServerError(err) => {
                Self::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                ))
            }
        }
    }
}

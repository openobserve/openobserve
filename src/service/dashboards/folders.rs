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

use std::io::Error;

use actix_web::{http, HttpResponse};

use crate::{
    common::meta::{
        dashboards::{Folder, FolderList, DEFAULT_FOLDER},
        http::HttpResponse as MetaHttpResponse,
    },
    service::db,
};

#[tracing::instrument(skip(folder))]
pub async fn save_folder(
    org_id: &str,
    mut folder: Folder,
    is_internal: bool,
) -> Result<HttpResponse, Error> {
    folder.name = folder.name.trim().to_string();
    if folder.name.is_empty() {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::BAD_REQUEST.into(),
                "folder name not allow empty".to_string(),
            )),
        );
    }

    if !is_internal && folder.folder_id == DEFAULT_FOLDER {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::BAD_REQUEST.into(),
                "can't update default Dashboard folder".to_string(),
            )),
        );
    }
    if folder.folder_id != DEFAULT_FOLDER {
        folder.folder_id = crate::common::infra::ider::generate();
    }

    match db::dashboards::folders::put(org_id, folder).await {
        Ok(folder) => Ok(HttpResponse::Ok().json(folder)),
        Err(error) => Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        ),
    }
}

#[tracing::instrument(skip(folder))]
pub async fn update_folder(
    org_id: &str,
    folder_id: &str,
    mut folder: Folder,
) -> Result<HttpResponse, Error> {
    if folder_id.eq(DEFAULT_FOLDER) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::BAD_REQUEST.into(),
                "can't update default Dashboard folder".to_string(),
            )),
        );
    }
    folder.folder_id = folder_id.to_string();

    if let Err(error) = db::dashboards::folders::put(org_id, folder).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Dashboard folder updated".to_string(),
    )))
}

#[tracing::instrument()]
pub async fn list_folders(org_id: &str) -> Result<HttpResponse, Error> {
    if let Ok(folders) = db::dashboards::folders::list(org_id).await {
        Ok(HttpResponse::Ok().json(FolderList { list: folders }))
    } else {
        Ok(HttpResponse::Ok().json(FolderList { list: vec![] }))
    }
}

#[tracing::instrument()]
pub async fn get_folder(org_id: &str, folder_id: &str) -> Result<HttpResponse, Error> {
    let resp = if let Ok(folder) = db::dashboards::folders::get(org_id, folder_id).await {
        HttpResponse::Ok().json(folder)
    } else {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Dashboard folder not found".to_string(),
        )));
    };
    Ok(resp)
}

#[tracing::instrument()]
pub async fn delete_folder(org_id: &str, folder_id: &str) -> Result<HttpResponse, Error> {
    let dashboards = db::dashboards::list(org_id, folder_id).await.unwrap();
    if !dashboards.is_empty() {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Dashboard folder contains dashboards, please move/delete dashboards from folder "
                .to_string(),
        )));
    }

    if db::dashboards::folders::get(org_id, folder_id)
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Dashboard folder not found".to_string(),
        )));
    }
    match db::dashboards::folders::delete(org_id, folder_id).await {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Dashboard folder deleted".to_string(),
        ))),
        Err(e) => Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                e.to_string(),
            )),
        ),
    }
}

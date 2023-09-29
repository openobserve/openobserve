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

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;

use crate::common::meta::{
    dashboards::{Folder, FolderList, DEFAULT_FOLDER},
    http::HttpResponse as MetaHttpResponse,
};

use crate::service::db;

#[tracing::instrument(skip(folder))]
pub async fn save_folder(
    org_id: &str,
    mut folder: Folder,
    is_internal: bool,
) -> Result<HttpResponse, Error> {
    if !is_internal && folder.folder_id == DEFAULT_FOLDER {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::BAD_REQUEST.into(),
                "can't update default folder".to_string(),
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
                "can't update default folder".to_string(),
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
        "folder updated".to_string(),
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
            StatusCode::NOT_FOUND.into(),
            "folder not found".to_string(),
        )));
    };
    Ok(resp)
}

#[tracing::instrument()]
pub async fn delete_folder(org_id: &str, folder_id: &str) -> Result<HttpResponse, Error> {
    let dashboards = db::dashboards::list(org_id, folder_id).await.unwrap();
    if !dashboards.is_empty() {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.into(),
            "folder contains dashboards, please move/delete dashboards from folder ".to_string(),
        )));
    }

    let resp = if let Ok(folder) = db::dashboards::folders::delete(org_id, folder_id).await {
        HttpResponse::Ok().json(folder)
    } else {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            "folder not found".to_string(),
        )));
    };
    Ok(resp)
}

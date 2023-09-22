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

use crate::service::dashboards::folders;
use actix_web::{delete, get, post, put, web, HttpResponse};
use std::io::Error;

use crate::common::meta::dashboards::Folder;

/** CreateFolder */
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "CreateFolder",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = Folder,
        description = "Folder details",
        example = json!({
            "title": "Infrastructure",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Folder created", body = Folder),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[post("/{org_id}/folders")]
pub async fn create_folder(
    path: web::Path<String>,
    folder: web::Json<Folder>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    folders::save_folder(&org_id, folder.into_inner()).await
}

/** UpdateFolder */
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "UpdateFolder",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_id" = String, Path, description = "Folder name"),
    ),
    request_body(
        content = Folder,
        description = "Folder details",
        example = json!({
            "title": "Infra",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Folder updated", body = Folder),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = HttpResponse),
    ),
)]
#[put("/{org_id}/folders/{folder_id}")]
pub async fn update_folder(
    path: web::Path<(String, String)>,
    folder: web::Json<Folder>,
) -> Result<HttpResponse, Error> {
    let (org_id, folder_id) = path.into_inner();
    folders::update_folder(&org_id, &folder_id, folder.into_inner()).await
}

/// ListFolders
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "ListFolders",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, body = FolderList),
    ),
)]
#[get("/{org_id}/folders")]
pub async fn list_folders(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    folders::list_folders(&org_id).await
}

/// GetFolder
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "GetFolder",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_id" = String, Path, description = "Folder ID"),
    ),
    responses(
        (status = StatusCode::OK, body = Folder),
        (status = StatusCode::NOT_FOUND, description = "Folder not found", body = HttpResponse),
    ),
)]
#[get("/{org_id}/folders/{folder_id}")]
pub async fn get_folder(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, folder_id) = path.into_inner();
    folders::get_folder(&org_id, &folder_id).await
}

/// DeleteFolder
#[utoipa::path(
    context_path = "/api",
    tag = "Dashboards",
    operation_id = "DeleteFolder",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_id" = String, Path, description = "Folder ID"),
    ),
    responses(
        (status = StatusCode::OK, description = "Folder deleted", body = HttpResponse),
        (status = StatusCode::NOT_FOUND, description = "Folder not found", body = HttpResponse),
    ),
)]
#[delete("/{org_id}/folders/{folder_id}")]
async fn delete_folder(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, folder_id) = path.into_inner();
    folders::delete_folder(&org_id, &folder_id).await
}

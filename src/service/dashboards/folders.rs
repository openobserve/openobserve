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
    http::{self},
    HttpResponse,
};
use std::io::Error;

use crate::common::meta::{dashboards::Folder, http::HttpResponse as MetaHttpResponse};

use crate::service::db;

#[tracing::instrument(skip(folder))]
pub async fn save_folder(org_id: &str, mut folder: Folder) -> Result<HttpResponse, Error> {
    let folder_id = crate::common::infra::ider::generate();
    folder.folder_id = folder_id.clone();

    if let Err(error) = db::dashboards::folders::put(&org_id, folder).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "folder created".to_string(),
    )))
}
#[tracing::instrument(skip(folder))]
pub async fn update_folder(org_id: &str, folder: Folder) -> Result<HttpResponse, Error> {
    if let Err(error) = db::dashboards::folders::put(&org_id, folder).await {
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

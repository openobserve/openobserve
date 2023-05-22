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

use actix_web::{http, HttpResponse};
use std::io::Error;

use crate::infra::config::ALERTS_DESTINATIONS;
use crate::meta::alert::DestinationTemplate;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::service::db;

#[tracing::instrument(skip_all)]
pub async fn save_template(
    org_id: String,
    name: String,
    mut template: DestinationTemplate,
) -> Result<HttpResponse, Error> {
    template.name = Some(name.clone());
    db::alerts::templates::set(org_id.as_str(), name.as_str(), template.clone())
        .await
        .unwrap();

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Alert template saved".to_string(),
    )))
}

#[tracing::instrument]
pub async fn list_templates(org_id: String) -> Result<HttpResponse, Error> {
    let list = db::alerts::templates::list(org_id.as_str()).await.unwrap();
    Ok(HttpResponse::Ok().json(list))
}

#[tracing::instrument]
pub async fn delete_template(org_id: String, name: String) -> Result<HttpResponse, Error> {
    for dest in ALERTS_DESTINATIONS.iter() {
        if dest.key().starts_with(&org_id) && dest.value().template.eq(&name) {
            return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                http::StatusCode::FORBIDDEN.into(),
                format!(
                    "Template is in use for destination {}",
                    &dest.value().clone().name.unwrap()
                ),
            )));
        }
    }

    let result = db::alerts::templates::delete(org_id.as_str(), name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert template deleted ".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

#[tracing::instrument]
pub async fn get_template(org_id: String, name: String) -> Result<HttpResponse, Error> {
    let result = db::alerts::templates::get(org_id.as_str(), name.as_str()).await;
    match result {
        Ok(alert) => Ok(HttpResponse::Ok().json(alert)),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert template not found".to_string(),
        ))),
    }
}

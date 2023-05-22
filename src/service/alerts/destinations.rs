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

use crate::infra::config::STREAM_ALERTS;
use crate::meta::alert::AlertDestination;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::service::db;

#[tracing::instrument(skip(destination))]
pub async fn save_destination(
    org_id: String,
    name: String,
    destination: AlertDestination,
) -> Result<HttpResponse, Error> {
    db::alerts::destinations::set(org_id.as_str(), name.as_str(), destination.clone())
        .await
        .unwrap();

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "Alert destination saved".to_string(),
    )))
}

#[tracing::instrument]
pub async fn list_destinations(org_id: String) -> Result<HttpResponse, Error> {
    let list = db::alerts::destinations::list(org_id.as_str())
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(list))
}

#[tracing::instrument]
pub async fn delete_destination(org_id: String, name: String) -> Result<HttpResponse, Error> {
    for alert_list in STREAM_ALERTS.iter() {
        for alert in alert_list.value().list.clone() {
            if alert_list.key().starts_with(&org_id) && alert.destination.eq(&name) {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    http::StatusCode::FORBIDDEN.into(),
                    format!("Destination is in use for alert {}", alert.name),
                )));
            }
        }
    }

    let result = db::alerts::destinations::delete(org_id.as_str(), name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert destination deleted ".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

#[tracing::instrument]
pub async fn get_destination(org_id: String, name: String) -> Result<HttpResponse, Error> {
    let result = db::alerts::destinations::get(org_id.as_str(), name.as_str()).await;
    match result {
        Ok(alert) => Ok(HttpResponse::Ok().json(alert)),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert destination not found".to_string(),
        ))),
    }
}

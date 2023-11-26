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

use actix_web::{http, HttpResponse};
use std::io::Error;

use crate::common::infra::config::STREAM_ALERTS;
use crate::common::meta::{alert::AlertDestination, http::HttpResponse as MetaHttpResponse};
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

    if db::alerts::destinations::get(org_id.as_str(), name.as_str())
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert destination not found".to_string(),
        )));
    }
    let result = db::alerts::destinations::delete(org_id.as_str(), name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert destination deleted ".to_string(),
        ))),
        Err(e) => Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                e.to_string(),
            )),
        ),
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

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

use crate::common::infra::config::ALERTS_DESTINATIONS;
use crate::common::meta::{alert::DestinationTemplate, http::HttpResponse as MetaHttpResponse};
use crate::service::db;

#[tracing::instrument(skip_all)]
pub async fn save_template(
    org_id: String,
    name: String,
    mut template: DestinationTemplate,
) -> Result<HttpResponse, Error> {
    if template.body.is_null() {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Alert template body empty".to_string(),
        )));
    }

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

    if db::alerts::templates::get(org_id.as_str(), name.as_str())
        .await
        .is_err()
    {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "Alert template not found".to_string(),
        )));
    }
    match db::alerts::templates::delete(org_id.as_str(), name.as_str()).await {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "Alert template deleted".to_string(),
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

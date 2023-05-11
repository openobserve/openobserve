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

use actix_web::{http::StatusCode, HttpResponse};
use std::io;
use tracing::instrument;

use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::syslog::{Routes, SyslogRoute};
use crate::service::db::syslog;

#[instrument(skip(route))]
pub async fn create_route(mut route: SyslogRoute) -> Result<HttpResponse, io::Error> {
    route.id = crate::infra::ider::generate();
    if let Err(e) = syslog::set(&route).await {
        return Ok(Response::InternalServerError(e).into());
    }
    tracing::info!(dashboard_id = route.id, "Syslog Route created");
    Ok(HttpResponse::Created().json(route))
}

#[instrument(skip(route))]
pub async fn update_route(id: &str, route: &mut SyslogRoute) -> Result<HttpResponse, io::Error> {
    if route.id.is_empty() {
        route.id = id.to_owned();
    }
    let old_route = match syslog::get(id).await {
        Ok(route) => route,
        Err(error) => {
            tracing::info!(%error, id, "Syslog Route not found");
            return Ok(Response::NotFound.into());
        }
    };

    if route == &old_route {
        return Ok(HttpResponse::Ok().json(route));
    }

    if let Err(error) = syslog::set(route).await {
        tracing::error!(%error, id, "Failed to save the syslog route");
        return Ok(Response::InternalServerError(error).into());
    }
    Ok(HttpResponse::Ok().json(route))
}

#[instrument]
pub async fn list_routes() -> Result<HttpResponse, io::Error> {
    Ok(HttpResponse::Ok().json(Routes {
        routes: syslog::list().await.unwrap(),
    }))
}

#[instrument]
pub async fn get_route(id: &str) -> Result<HttpResponse, io::Error> {
    let resp = if let Ok(route) = syslog::get(id).await {
        HttpResponse::Ok().json(route)
    } else {
        Response::NotFound.into()
    };
    Ok(resp)
}

#[instrument]
pub async fn delete_route(id: &str) -> Result<HttpResponse, io::Error> {
    let resp = if syslog::delete(id).await.is_err() {
        Response::NotFound
    } else {
        Response::OkMessage("Syslog route deleted".to_owned())
    };
    Ok(resp.into())
}

#[derive(Debug)]
enum Response {
    OkMessage(String),
    NotFound,
    InternalServerError(anyhow::Error),
}

impl From<Response> for HttpResponse {
    fn from(resp: Response) -> Self {
        match resp {
            Response::OkMessage(message) => {
                Self::Ok().json(MetaHttpResponse::message(StatusCode::OK.into(), message))
            }
            Response::NotFound => Self::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                "Syslog route not found".to_owned(),
            )),
            Response::InternalServerError(err) => Self::InternalServerError().json(
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.into(), err.to_string()),
            ),
        }
    }
}

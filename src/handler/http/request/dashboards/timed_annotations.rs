// Copyright 2024 OpenObserve Inc.
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

use std::{collections::HashMap, io::Error};

use actix_web::{delete, get, post, web, HttpResponse};
use config::meta::timed_annotations::{TimedAnnotationDelete, TimedAnnotationReq};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, service::dashboards::timed_annotations,
};

#[post("/{org_id}/annotations")]
pub async fn create_annotations(
    path: web::Path<String>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let req = serde_json::from_slice::<TimedAnnotationReq>(&body)?;

    match timed_annotations::create_timed_annotations(&org_id, req).await {
        Ok(res) => Ok(MetaHttpResponse::json(res)),
        Err(e) => {
            log::error!("Error creating timed annotations: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500,
                    "Failed to create timed annotations".to_string(),
                )),
            )
        }
    }
}

#[get("/{org_id}/annotations")]
pub async fn get_annotations(
    path: web::Path<String>,
    query: web::Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let _org_id = path.into_inner();
    let (dashboard_id, panels, start_time, end_time) = match get_query_params(query) {
        Ok(params) => params,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e.to_string())),
    };

    match timed_annotations::get_timed_annotations(&dashboard_id, panels, start_time, end_time)
        .await
    {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => {
            log::error!("Error getting timed annotations: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500,
                    "Failed to get timed annotations".to_string(),
                )),
            )
        }
    }
}

#[delete("/{org_id}/annotations")]
pub async fn delete_annotations(
    path: web::Path<String>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let _org_id = path.into_inner();
    let req: TimedAnnotationDelete = serde_json::from_slice(&body)?;
    match timed_annotations::delete_timed_annotations(req).await {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(e) => {
            log::error!("Error deleting timed annotations: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    500,
                    "Failed to delete timed annotations".to_string(),
                )),
            )
        }
    }
}

fn get_query_params(
    query: web::Query<HashMap<String, String>>,
) -> anyhow::Result<(String, Option<Vec<String>>, i64, i64)> {
    let dashboard_id = query
        .get("dashboard_id")
        .ok_or_else(|| anyhow::anyhow!("dashboard_id is required"))?
        .to_string();
    if dashboard_id.is_empty() {
        return Err(anyhow::anyhow!("dashboard_id cannot be empty"));
    }
    let panels = query
        .get("panels")
        .map(|p| p.split(',').map(|s| s.to_string()).collect());
    let start_time = query
        .get("start_time")
        .ok_or_else(|| anyhow::anyhow!("start_time is required"))?
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid start_time"))?;
    let end_time = query
        .get("end_time")
        .ok_or_else(|| anyhow::anyhow!("end_time is required"))?
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid end_time"))?;
    Ok((dashboard_id, panels, start_time, end_time))
}

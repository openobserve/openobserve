// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{delete, get, put, web, HttpResponse};

#[cfg(feature = "enterprise")]
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(feature = "enterprise")]
#[delete("/{org_id}/query_manager/{trace_id}")]
pub async fn cancel_query(params: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_, trace_id) = params.into_inner();
    let trace_ids = trace_id.split(',').collect::<Vec<&str>>();
    cancel_query_inner(&trace_ids).await
}

#[cfg(not(feature = "enterprise"))]
#[delete("/{org_id}/query_manager/{trace_id}")]
pub async fn cancel_query(_params: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[put("/{org_id}/query_manager/cancel")]
pub async fn cancel_multiple_query(body: web::Bytes) -> Result<HttpResponse, Error> {
    let trace_ids: Vec<String> = match config::utils::json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    let trace_ids = trace_ids.iter().map(|s| s.as_str()).collect::<Vec<&str>>();
    cancel_query_inner(&trace_ids).await
}

#[cfg(not(feature = "enterprise"))]
#[put("/{org_id}/query_manager/cancel")]
pub async fn cancel_multiple_query(
    _params: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/query_manager/status")]
pub async fn query_status(_params: web::Path<String>) -> Result<HttpResponse, Error> {
    let res = crate::service::search::query_status().await;
    match res {
        Ok(query_status) => Ok(HttpResponse::Ok().json(query_status)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/query_manager/status")]
pub async fn query_status(_params: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
async fn cancel_query_inner(trace_ids: &[&str]) -> Result<HttpResponse, Error> {
    if trace_ids.is_empty() {
        return Ok(HttpResponse::BadRequest().json("Invalid trace_id"));
    }
    let mut res = Vec::with_capacity(trace_ids.len());
    for trace_id in trace_ids {
        match crate::service::search::cancel_query(trace_id).await {
            Ok(status) => res.push(status),
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        }
    }
    Ok(HttpResponse::Ok().json(res))
}

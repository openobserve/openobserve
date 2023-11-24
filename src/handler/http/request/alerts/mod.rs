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

use actix_web::{delete, get, http, post, put, web, HttpRequest, HttpResponse};
use ahash::AHashMap as HashMap;
use std::io::Error;

use crate::common::meta::{alerts::Alert, http::HttpResponse as MetaHttpResponse};
use crate::common::utils::http::get_stream_type_from_request;
use crate::service::alerts;

pub mod destinations;
pub mod templates;

/** CreateAlert */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "SaveAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
      ),
    request_body(content = Alert, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/alerts/{alert_name}")]
pub async fn save_alert(
    path: web::Path<(String, String, String)>,
    alert: web::Json<Alert>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::save_alert(
        &org_id,
        &stream_name,
        stream_type,
        &name,
        alert.into_inner(),
    )
    .await
    {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/** ListStreamAlerts */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListStreamAlerts",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = AlertList),
        (status = 400, description="Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/alerts")]
async fn list_stream_alerts(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::list_alert(&org_id, Some(stream_name.as_str()), stream_type).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/** ListAlerts */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlerts",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = AlertList),
    )
)]
#[get("/{org_id}/alerts")]
async fn list_alerts(path: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::list_alert(&org_id, None, stream_type).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/** GetAlertByName */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
      ),
    responses(
        (status = 200, description="Success",  content_type = "application/json", body = Alert),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn get_alert(
    path: web::Path<(String, String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::get_alert(&org_id, &stream_name, stream_type, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(data)),
        Err(e) => Ok(MetaHttpResponse::not_found(e)),
    }
}

/** DeleteAlert */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = HttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Error",     content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/{stream_name}/alerts/{alert_name}")]
async fn delete_alert(
    path: web::Path<(String, String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::delete_alert(&org_id, &stream_name, stream_type, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert deleted")),
        Err(e) => match e {
            (http::StatusCode::FORBIDDEN, e) => Ok(MetaHttpResponse::forbidden(e)),
            (http::StatusCode::NOT_FOUND, e) => Ok(MetaHttpResponse::not_found(e)),
            (_, e) => Ok(MetaHttpResponse::internal_error(e)),
        },
    }
}

/** TriggerAlert */
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "TriggerAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("alert_name" = String, Path, description = "Alert name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/{stream_name}/alerts/{alert_name}/trigger")]
async fn trigger_alert(
    path: web::Path<(String, String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    match alerts::trigger_alert(&org_id, &stream_name, stream_type, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert triggered")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

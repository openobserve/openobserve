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

use std::{collections::HashMap, io::Error};

use actix_web::{delete, get, http, post, put, web, HttpRequest, HttpResponse};

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            scheduled_ops::derived_streams::DerivedStreamMeta,
        },
        utils::http::get_stream_type_from_request,
    },
    service::scheduled_ops::derived_streams,
};

/// CreateDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "SaveDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = DerivedStreamMeta, description = "DerivedStream details", content_type = "application/json"),
    responses(
        (status = 200, description = "DerivedStream created", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Internal Server Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/derived_streams")]
pub async fn save(
    path: web::Path<String>,
    derived_streams: web::Json<DerivedStreamMeta>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    // TODO: any hacks or preprocessing
    let mut derived_streams = derived_streams.into_inner();
    // alert.trigger_condition.frequency *= 60;

    match derived_streams::save(&org_id, "", derived_streams, true).await {
        Ok(_) => Ok(MetaHttpResponse::ok("DerivedStream saved")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// UpdateDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "UpdateDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "DerivedStream name"),
      ),
    request_body(content = DerivedStreamMeta, description = "DerivedStream details", content_type = "application/json"),
    responses(
        (status = 200, description = "DerivedStream updated", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Internal Server Error", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/derived_streams/{name}")]
pub async fn update_derived_streams(
    path: web::Path<(String, String)>,
    derived_streams: web::Json<DerivedStreamMeta>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    
    // TODO: any hacks or preprocessing
    let mut derived_streams = derived_streams.into_inner();
    // alert.trigger_condition.frequency *= 60;

    match derived_streams::save(&org_id, &name, derived_streams, false).await {
        Ok(_) => Ok(MetaHttpResponse::ok("DerivedStream updated")),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// ListDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "ListDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<DerivedStreamMeta>),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/derived_streams")]
async fn list_derived_streams(
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    // TODO: call service
    Ok(MetaHttpResponse::json("data"))
}

/// GetDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "GetDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "DerivedStream name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = DerivedStreamMeta),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/derived_streams/{name}")]
async fn get_derived_streams(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();

    // TODO: call service
    Ok(MetaHttpResponse::json("data"))
}

/// DeleteDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "DeleteDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "DerivedStream name"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/derived_streams/{name}")]
async fn delete_derived_streams(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();

    // TODO: call service
    Ok(MetaHttpResponse::json("data"))
}

/// EnableDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "EnableDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "DerivedStreams name"),
        ("value" = bool, Query, description = "Enable or disable DerivedStreams"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/derived_streams/{name}/enable")]
async fn enable_derived_streams(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let enable = match query.get("value") {
        Some(v) => v.parse::<bool>().unwrap_or_default(),
        None => false,
    };
    let mut resp = HashMap::new();
    resp.insert("enabled".to_string(), enable);

    // TODO: call service
    Ok(MetaHttpResponse::json(resp))
}

/// TriggerDerivedStreams
#[utoipa::path(
    context_path = "/api",
    tag = "DerivedStreams",
    operation_id = "TriggerDerivedStreams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "DerivedStreams name"),
    ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/derived_streams/{name}/trigger")]
async fn trigger_derived_streams(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();

    // TODO: call service
    Ok(MetaHttpResponse::ok("DerivedStreams triggered"))
}

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

#[cfg(feature = "zo_functions")]
use crate::meta;
use actix_web::{delete, get, post, web, HttpResponse};
#[cfg(feature = "zo_functions")]
use actix_web::{http, HttpRequest};
#[cfg(feature = "zo_functions")]
use std::collections::HashMap;
use std::io::Error;

use crate::meta::functions::Transform;

/** Create new query function*/
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSave",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/functions/{name}")]
pub async fn save_function(
    path: web::Path<(String, String)>,
    js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let transform = js_func.into_inner();
    crate::service::functions::register_function(org_id, None, None, name, transform).await
}

/** List all functions for an organization */
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/functions")]
async fn list_functions(
    org_id: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match crate::common::http::get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    crate::service::functions::list_functions(org_id.into_inner(), None, stream_type).await
}

/** Delete a query function by name */
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDelete",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/functions/{name}")]
async fn delete_function(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    crate::service::functions::delete_function(org_id, None, None, name).await
}

/** Create new ingest time function */
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSaveForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/functions/{name}")]
pub async fn save_stream_function(
    path: web::Path<(String, String, String)>,
    js_func: web::Json<Transform>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    use crate::meta::StreamType;

    let (org_id, stream_name, name) = path.into_inner();
    let transform = js_func.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let mut stream_type = match crate::common::http::get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    if stream_type.is_none() {
        stream_type = Some(StreamType::Logs)
    }
    crate::service::functions::register_function(
        org_id,
        Some(stream_name),
        stream_type,
        name,
        transform,
    )
    .await
}

/** List all ingest time functions for a stream*/
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionListForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/{stream_name}/functions")]
async fn list_stream_function(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match crate::common::http::get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    crate::service::functions::list_functions(org_id, Some(stream_name), stream_type).await
}

/** Delete ingest time function by name */
#[cfg(feature = "zo_functions")]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDeleteForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/{stream_name}/functions/{name}")]
async fn delete_stream_function(
    path: web::Path<(String, String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match crate::common::http::get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    crate::service::functions::delete_function(org_id, Some(stream_name), stream_type, name).await
}

/** Create new query function*/
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSave",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/functions/{name}")]
pub async fn save_function(
    _path: web::Path<(String, String)>,
    _js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

/** List all functions for an organization */
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/functions")]
async fn list_functions(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

/** Delete a query function by name */
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDelete",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/functions/{name}")]
async fn delete_function(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

/** Create new ingest time function */
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSaveForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/functions/{name}")]
pub async fn save_stream_function(
    _path: web::Path<(String, String, String)>,
    _js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

/** List all ingest time functions for a stream*/
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionListForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/{stream_name}/functions")]
async fn list_stream_function(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

/** Delete ingest time function by name */
#[cfg(not(feature = "zo_functions"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDeleteForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/{stream_name}/functions/{name}")]
async fn delete_stream_function(
    _path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::NotImplemented().json(crate::meta::http::HttpResponse::message(
            actix_web::http::StatusCode::NOT_IMPLEMENTED.into(),
            "Functions support is not enabled".to_string(),
        )),
    )
}

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

use actix_web::http::header::ContentType;
use actix_web::{delete, get, post, web, HttpRequest, HttpResponse};
use ahash::HashMap;
use std::io::Error;

use crate::service::kv;

/** GetValue */
#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "GetKVValue",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "text/plain", body = String),
        (status = 404, description="NotFound", content_type = "text/plain", body = String),
    )
)]
#[get("/{org_id}/kv/{key}")]
pub async fn get(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, key) = path.into_inner();
    match kv::get(&org_id, &key).await {
        Ok(value) => Ok(HttpResponse::Ok()
            .content_type(ContentType::plaintext())
            .body(value)),
        Err(_) => Ok(HttpResponse::NotFound()
            .content_type(ContentType::plaintext())
            .body("Not Found".to_string())),
    }
}

/** SetValue */
#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "SetKVValue",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    request_body(content = String, description = "Value of the key", content_type = "text/plain"),
    responses(
        (status = 200, description="Success", content_type = "text/plain", body = String),
        (status = 500, description="Error", content_type = "text/plain", body = String),
    )
)]
#[post("/{org_id}/kv/{key}")]
pub async fn set(
    path: web::Path<(String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (org_id, key) = path.into_inner();
    match kv::set(&org_id, &key, body).await {
        Ok(_) => Ok(HttpResponse::Ok()
            .content_type(ContentType::plaintext())
            .body("OK")),
        Err(e) => {
            log::error!("Setting KV value: {}, error: {}", key, e);
            Ok(HttpResponse::InternalServerError()
                .content_type(ContentType::plaintext())
                .body("Error".to_string()))
        }
    }
}

/** RemoveValue */
#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "RemoveKVValue",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "text/plain", body = String),
        (status = 404, description="NotFound", content_type = "text/plain", body = String),
    )
)]
#[delete("/{org_id}/kv/{key}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, key) = path.into_inner();
    match kv::delete(&org_id, &key).await {
        Ok(_) => Ok(HttpResponse::Ok()
            .content_type(ContentType::plaintext())
            .body("OK")),
        Err(_) => Ok(HttpResponse::NotFound()
            .content_type(ContentType::plaintext())
            .body("Not Found".to_string())),
    }
}

/** ListKeys */
#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "ListKVKeys",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("prefix" = Option<String>, Query, description = "Key prefix"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = Vec<String>),
    )
)]
#[get("/{org_id}/kv")]
pub async fn list(org_id: web::Path<String>, in_req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let prefix = match query.get("prefix") {
        Some(prefix) => prefix,
        None => "",
    };
    match kv::list(&org_id, prefix).await {
        Ok(keys) => Ok(HttpResponse::Ok().json(keys)),
        Err(err) => {
            log::error!("list KV keys: {}, error: {}", prefix, err);
            let keys: Vec<String> = Vec::new();
            Ok(HttpResponse::Ok().json(keys))
        }
    }
}

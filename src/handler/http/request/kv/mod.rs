// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpRequest, HttpResponse, delete, get, http::header::ContentType, post, web};
use hashbrown::HashMap;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::kv};

/// GetValue

#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "GetKVValue",
    summary = "Get value from key-value store",
    description = "Retrieves the stored value for a specific key from the organization's key-value store. Returns the raw text \
                   value if the key exists, or a 404 error if the key is not found. Useful for storing and retrieving \
                   configuration settings, application state, or other simple data.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "text/plain", body = String),
        (status = 404, description = "NotFound", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "get"}))
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

/// SetValue

#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "SetKVValue",
    summary = "Store value in key-value store",
    description = "Stores a text value under the specified key in the organization's key-value store. Creates a new key if it \
                   doesn't exist, or updates the existing value. The key-value store is perfect for configuration settings, \
                   feature flags, application state, and other simple data that needs to persist across sessions.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    request_body(content = String, description = "Value of the key", content_type = "text/plain"),
    responses(
        (status = 200, description = "Success", content_type = "text/plain", body = String),
        (status = 500, description = "Failure", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "create"}))
    )
)]
#[post("/{org_id}/kv/{key}")]
pub async fn set(
    path: web::Path<(String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (org_id, key) = path.into_inner();
    let key = key.trim();
    match kv::set(&org_id, key, body).await {
        Ok(_) => Ok(HttpResponse::Ok()
            .content_type(ContentType::plaintext())
            .body("OK")),
        Err(e) => {
            log::error!("Setting KV value: {key}, error: {e}");
            Ok(HttpResponse::InternalServerError()
                .content_type(ContentType::plaintext())
                .body("Error".to_string()))
        }
    }
}

/// RemoveValue

#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "RemoveKVValue",
    summary = "Delete key from key-value store",
    description = "Permanently removes a key and its associated value from the organization's key-value store. Returns a success \
                   response if the key was deleted, or a 404 error if the key doesn't exist. This operation cannot be undone, \
                   so use carefully when cleaning up unused configuration or application data.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key" = String, Path, description = "Key name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "text/plain", body = String),
        (status = 404, description = "NotFound", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "delete"}))
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

/// ListKeys

#[utoipa::path(
    context_path = "/api",
    tag = "KV",
    operation_id = "ListKVKeys",
    summary = "List keys from key-value store",
    description = "Retrieves a list of all keys stored in the organization's key-value store. You can optionally filter keys by \
                   providing a prefix to only return keys that start with specific characters. This is useful for organizing \
                   related configuration settings or browsing available stored data.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("prefix" = Option<String>, Query, description = "Key prefix"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "list"}))
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
        Ok(keys) => Ok(MetaHttpResponse::json(keys)),
        Err(err) => {
            log::error!("list KV keys: {prefix}, error: {err}");
            let keys: Vec<String> = Vec::new();
            Ok(MetaHttpResponse::json(keys))
        }
    }
}

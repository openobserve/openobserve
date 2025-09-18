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

use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
#[cfg(feature = "enterprise")]
use {
    crate::cipher::{KeyAddRequest, KeyGetResponse, KeyInfo, KeyListResponse},
    crate::common::{
        meta::authz::Authz,
        utils::auth::{remove_ownership, set_ownership},
    },
    actix_web::http,
    config::utils::time::now_micros,
    infra::table::cipher::CipherEntry,
    o2_enterprise::enterprise::cipher::{Cipher, CipherData, http_repr::merge_updates},
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(feature = "enterprise")]
/// Store a key credential in db
#[utoipa::path(
    post,
    context_path = "/api",
    operation_id = "CreateCipherKey",
    summary = "Create encryption key",
    description = "Creates a new encryption key for data encryption and decryption operations. The key is securely stored \
                   and validated before being made available for use. Key names cannot contain ':' characters. Only \
                   available in enterprise deployments for enhanced data security and compliance requirements.",
    request_body(
        content = KeyAddRequest,
        description = "Key data to add",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "Key"
)]
#[post("/{org_id}/cipher_keys")]
pub async fn save(
    org_id: web::Path<String>,
    body: web::Json<KeyAddRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let req = body.into_inner();

    let user_id = match in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
    {
        Some(id) => id,
        None => return Ok(MetaHttpResponse::bad_request("Invalid user_id in request")),
    };

    if req.name.contains(":") {
        return Ok(MetaHttpResponse::bad_request(
            "Key name cannot have ':' in it",
        ));
    }

    let cd: CipherData = match req.key.try_into() {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    match cd.get_key().await {
        // here we are just checking that the key can encrypt a string, i.e.
        // it is set up correctly. We don't care what the actual entrypted string is.
        Ok(mut k) => match k.encrypt("hello world") {
            Ok(_) => {}
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        },
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    }

    match crate::service::db::keys::add(CipherEntry {
        org: org_id.to_string(),
        created_at: now_micros(),
        created_by: user_id.to_string(),
        name: req.name.clone(),
        data: serde_json::to_string(&cd).unwrap(),
        kind: infra::table::cipher::EntryKind::CipherKey,
    })
    .await
    {
        Ok(_) => {
            set_ownership(&org_id, "cipher_keys", Authz::new(&req.name)).await;
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK,
                "Key created successfully",
            )))
        }
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

#[cfg(not(feature = "enterprise"))]
/// Store a key credential in db
#[utoipa::path(
    post,
    context_path = "/api",
    operation_id = "CreateCipherKey",
    summary = "Create encryption key",
    description = "Creates a new encryption key for data encryption and decryption operations. This feature is only \
                   available in enterprise deployments.",
    responses(
        (status = 403, description = "Feature not supported", content_type = "application/json")
    ),
    tag = "Keys"
)]
#[post("/{org_id}/cipher_keys")]
pub async fn save(
    _org_id: web::Path<String>,
    mut _body: web::Payload,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("not supported"))
}

/// get key with given name if present
#[utoipa::path(
    get,
    context_path = "/api",
    operation_id = "GetCipherKey",
    summary = "Get encryption key details",
    description = "Retrieves the configuration and metadata for a specific encryption key by name. Returns key \
                   information without exposing sensitive key material. Used for managing and auditing encryption \
                   keys within the organization. Only available in enterprise deployments for enhanced security \
                   management.",
    params(
        ("key_name" = String, Path, description = "Name of the key to retrieve", example = "test_key")
    ),
    responses(
        (
            status = 200,
            description = "Key info",
            body = Object,
            content_type = "application/json",
        ),
        (status = 404, description = "Key not found", content_type = "text/plain")
    ),
    tag = "Key"
)]
#[get("/{org_id}/cipher_keys/{key_name}")]
pub async fn get(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, key_name) = path.into_inner();

        let kdata = match infra::table::cipher::get_data(
            &org_id,
            infra::table::cipher::EntryKind::CipherKey,
            &key_name,
        )
        .await
        {
            Ok(Some(k)) => k,
            Ok(None) => {
                return Ok(MetaHttpResponse::not_found(format!(
                    "Key {key_name} not found"
                )));
            }
            Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
        };

        // we can be fairly certain that in db we have proper json
        let cd: CipherData = serde_json::from_str(&kdata).unwrap();

        let res = KeyGetResponse {
            name: key_name,
            key: cd.into(),
        };
        Ok(HttpResponse::Ok().json(res))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// list all keys for given org
#[utoipa::path(
    get,
    context_path = "/api",
    operation_id = "ListCipherKeys",
    summary = "List encryption keys",
    description = "Retrieves a list of all encryption keys available within the organization. Returns key names and \
                   metadata without exposing sensitive key material. Helps administrators manage encryption keys, \
                   audit key usage, and ensure proper key lifecycle management. Only available in enterprise \
                   deployments for enhanced security and compliance.",
    responses(
        (
            status = 200,
            description = "list all keys in the org",
            body = Object,
            content_type = "application/json",
        ),
    ),
    tag = "Key"
)]
#[get("/{org_id}/cipher_keys")]
pub async fn list(path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();

        let filter = infra::table::cipher::ListFilter {
            org: Some(org_id),
            kind: Some(infra::table::cipher::EntryKind::CipherKey),
        };

        let kdata = match infra::table::cipher::list_filtered(filter, None).await {
            Ok(list) => list,
            Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
        };

        let kdata = kdata
            .into_iter()
            .map(|d| {
                let cd = serde_json::from_str::<CipherData>(&d.data).unwrap();
                KeyInfo {
                    name: d.name,
                    key: cd.into(),
                }
            })
            .collect::<Vec<_>>();

        let res = KeyListResponse { keys: kdata };
        Ok(HttpResponse::Ok().json(res))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// delete key credentials for given key name
#[utoipa::path(
    delete,
    context_path = "/api",
    operation_id = "DeleteCipherKey",
    summary = "Delete encryption key",
    description = "Permanently removes an encryption key from the organization. This action cannot be undone and will \
                   prevent any future data decryption operations that depend on this key. Ensure all data encrypted \
                   with this key is either migrated or no longer needed before deletion. Only available in enterprise \
                   deployments for enhanced security management.",
    params(
        ("key_name" = String, Path, description = "name of the key to delete", example = "test_key")
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
    ),
    tag = "Keys"
)]
#[delete("/{org_id}/cipher_keys/{key_name}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, key_name) = path.into_inner();
        match crate::service::db::keys::remove(
            &org_id,
            infra::table::cipher::EntryKind::CipherKey,
            &key_name,
        )
        .await
        {
            Ok(_) => {
                remove_ownership(&org_id, "cipher_keys", Authz::new(&key_name)).await;
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK,
                    "cipher key removed successfully",
                )))
            }
            Err(e) => Ok(MetaHttpResponse::internal_error(e)),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

#[cfg(feature = "enterprise")]
/// update the credentials for given key
#[utoipa::path(
    post,
    context_path = "/api",
    operation_id = "UpdateCipherKey",
    summary = "Update encryption key",
    description = "Updates the configuration and parameters of an existing encryption key. The key is validated after \
                   updates to ensure it remains functional for encryption and decryption operations. Changes are \
                   applied atomically to maintain data security and consistency. Only available in enterprise \
                   deployments for enhanced security management.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key_name" = String, Path, description = "name of the key to update", example = "test_key")
    ),
    request_body(
        content = KeyAddRequest,
        description = "updated key data",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "Key"
)]
#[put("/{org_id}/cipher_keys/{key_name}")]
pub async fn update(
    path: web::Path<(String, String)>,
    body: web::Json<KeyAddRequest>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, key_name) = path.into_inner();
    let req = body.into_inner();
    if key_name != req.name {
        return Ok(MetaHttpResponse::bad_request(
            "Key name from request does not match path",
        ));
    }

    let user_id = match in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
    {
        Some(id) => id,
        None => return Ok(MetaHttpResponse::bad_request("Invalid user_id in request")),
    };

    if req.name.contains(":") {
        return Ok(MetaHttpResponse::bad_request(
            "Key name cannot have ':' in it",
        ));
    }

    let incoming: CipherData = match req.key.try_into() {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let kdata = match infra::table::cipher::get_data(
        &org_id,
        infra::table::cipher::EntryKind::CipherKey,
        &key_name,
    )
    .await
    {
        Ok(Some(k)) => k,
        Ok(None) => {
            return Ok(MetaHttpResponse::not_found(format!(
                "Key {key_name} not found"
            )));
        }
        Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
    };

    // we can be fairly certain that in db we have proper json
    let existing: CipherData = serde_json::from_str(&kdata).unwrap();

    let cd = merge_updates(existing, incoming);

    match cd.get_key().await {
        // here we are just checking that the key can encrypt a string, i.e.
        // it is set up correctly. We don't care what the actual entrypted string is.
        Ok(mut k) => match k.encrypt("hello world") {
            Ok(_) => {}
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        },
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    }

    match crate::service::db::keys::update(CipherEntry {
        org: org_id.to_string(),
        created_at: now_micros(),
        created_by: user_id.to_string(),
        name: req.name,
        data: serde_json::to_string(&cd).unwrap(),
        kind: infra::table::cipher::EntryKind::CipherKey,
    })
    .await
    {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "key updated successfully",
        ))),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

#[cfg(not(feature = "enterprise"))]
/// update the credentials for given key
#[utoipa::path(
    put,
    context_path = "/api",
    operation_id = "UpdateCipherKey",
    summary = "Update encryption key",
    description = "Updates the configuration and parameters of an existing encryption key. This feature is only \
                   available in enterprise deployments.",
    params(
        ("key_name" = String, Path, description = "name of the key to update", example = "test_key")
    ),
    responses(
        (status = 403, description = "Feature not supported", content_type = "application/json")
    ),
    tag = "Keys"
)]
#[put("/{org_id}/cipher_keys/{key_name}")]
pub async fn update(
    _path: web::Path<(String, String)>,
    _body: web::Payload,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("not supported"))
}

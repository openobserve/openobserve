// Copyright 2026 OpenObserve Inc.
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

use axum::{extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use {
    crate::cipher::{KeyAddRequest, KeyGetResponse, KeyInfo, KeyListResponse},
    crate::common::utils::auth::check_permissions,
    crate::common::{
        meta::authz::Authz,
        utils::auth::{UserEmail, remove_ownership, set_ownership},
    },
    crate::handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    axum::{Json, http::StatusCode, response::IntoResponse},
    config::utils::time::now_micros,
    infra::table::cipher::CipherEntry,
    o2_enterprise::enterprise::cipher::{Cipher, CipherData, http_repr::merge_updates},
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(feature = "enterprise")]
/// Store a key credential in db
#[utoipa::path(
    post,
    path = "/{org_id}/cipher_keys",
    context_path = "/api",
    operation_id = "CreateCipherKey",
    summary = "Create encryption key",
    description = "Creates a new encryption key for data encryption and decryption operations. The key is securely stored \
                   and validated before being made available for use. Key names cannot contain ':' characters. Only \
                   available in enterprise deployments for enhanced data security and compliance requirements.",
    request_body(
        content = inline(KeyAddRequest),
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
    tag = "Key",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn save(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<KeyAddRequest>,
) -> Response {
    let req = body;

    let user_id = user_email.user_id;

    if req.name.contains(":") {
        return MetaHttpResponse::bad_request("Key name cannot have ':' in it");
    }

    let cd: CipherData = match req.key.try_into() {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    match cd.get_key().await {
        // here we are just checking that the key can encrypt a string, i.e.
        // it is set up correctly. We don't care what the actual entrypted string is.
        Ok(mut k) => match k.encrypt("hello world") {
            Ok(_) => {}
            Err(e) => return MetaHttpResponse::bad_request(e),
        },
        Err(e) => return MetaHttpResponse::bad_request(e),
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
            (
                StatusCode::OK,
                Json(MetaHttpResponse::message(
                    StatusCode::OK,
                    "Key created successfully",
                )),
            )
                .into_response()
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(not(feature = "enterprise"))]
/// Store a key credential in db
#[utoipa::path(
    post,
    path = "/{org_id}/cipher_keys",
    context_path = "/api",
    operation_id = "CreateCipherKey",
    summary = "Create encryption key",
    description = "Creates a new encryption key for data encryption and decryption operations. This feature is only \
                   available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 403, description = "Feature not supported", content_type = "application/json")
    ),
    tag = "Keys",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn save(Path(_org_id): Path<String>) -> Response {
    MetaHttpResponse::forbidden("not supported")
}

/// get key with given name if present
#[utoipa::path(
    get,
    path = "/{org_id}/cipher_keys/{key_name}",
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
    tag = "Key",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get(Path(path): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, key_name) = path;

        let kdata = match infra::table::cipher::get_data(
            &org_id,
            infra::table::cipher::EntryKind::CipherKey,
            &key_name,
        )
        .await
        {
            Ok(Some(k)) => k,
            Ok(None) => {
                return MetaHttpResponse::not_found(format!("Key {key_name} not found"));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        // we can be fairly certain that in db we have proper json
        let cd: CipherData = serde_json::from_str(&kdata).unwrap();

        let res = KeyGetResponse {
            name: key_name,
            key: cd.into(),
        };
        Json(res).into_response()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// list all keys for given org
#[utoipa::path(
    get,
    path = "/{org_id}/cipher_keys",
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
    tag = "Key",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id.is_empty() {
            return MetaHttpResponse::not_found("Organization not found");
        }
        let filter = infra::table::cipher::ListFilter {
            org: Some(org_id),
            kind: Some(infra::table::cipher::EntryKind::CipherKey),
        };

        let kdata = match infra::table::cipher::list_filtered(filter, None).await {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::internal_error(e),
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
        Json(res).into_response()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// delete key credentials for given key name
#[utoipa::path(
    delete,
    path = "/{org_id}/cipher_keys/{key_name}",
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
    tag = "Keys",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete(Path(path): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, key_name) = path;
        match crate::service::db::keys::remove(
            &org_id,
            infra::table::cipher::EntryKind::CipherKey,
            &key_name,
        )
        .await
        {
            Ok(_) => {
                remove_ownership(&org_id, "cipher_keys", Authz::new(&key_name)).await;
                (
                    StatusCode::OK,
                    Json(MetaHttpResponse::message(
                        StatusCode::OK,
                        "cipher key removed successfully",
                    )),
                )
                    .into_response()
            }
            Err(e) => MetaHttpResponse::internal_error(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// delete multiple key credentials
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/cipher_keys/bulk",
    context_path = "/api",
    operation_id = "DeleteCipherKeysBulk",
    summary = "Delete multiple encryption key",
    description = "Permanently removes multiple encryption key from the organization. This action cannot be undone and will \
                   prevent any future data decryption operations that depend on this key. Ensure all data encrypted \
                   with this key is either migrated or no longer needed before deletion. Only available in enterprise \
                   deployments for enhanced security management.",
    params(
        ("org_id" = String, Path, description = "name of the organization from which delete", example = "default")
    ),
    request_body(content = BulkDeleteRequest, description = "Key name list", content_type = "application/json"),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
    ),
    tag = "Keys",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_bulk(
    Path(path): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BulkDeleteRequest>,
) -> Response {
    let org_id = path;
    let user_id = &user_email.user_id;
    for key in &body.ids {
        if !check_permissions(key, &org_id, user_id, "cipher_keys", "DELETE", None).await {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }
    let mut successful = Vec::with_capacity(body.ids.len());
    let mut unsuccessful = Vec::with_capacity(body.ids.len());
    let mut err = None;
    for key_name in &body.ids {
        match crate::service::db::keys::remove(
            &org_id,
            infra::table::cipher::EntryKind::CipherKey,
            key_name,
        )
        .await
        {
            Ok(_) => {
                remove_ownership(&org_id, "cipher_keys", Authz::new(key_name)).await;
                successful.push(key_name.clone());
            }
            Err(e) => {
                log::error!("error in deleting key {key_name} : {e}");
                unsuccessful.push(key_name.clone());
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

#[cfg(feature = "enterprise")]
/// update the credentials for given key
#[utoipa::path(
    put,
    path = "/{org_id}/cipher_keys/{key_name}",
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
        content = inline(KeyAddRequest),
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
    tag = "Key",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update(
    Path(path): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<KeyAddRequest>,
) -> Response {
    let (org_id, key_name) = path;

    if key_name != req.name {
        return MetaHttpResponse::bad_request("Key name from request does not match path");
    }

    let user_id = user_email.user_id;

    if req.name.contains(":") {
        return MetaHttpResponse::bad_request("Key name cannot have ':' in it");
    }

    let incoming: CipherData = match req.key.try_into() {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
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
            return MetaHttpResponse::not_found(format!("Key {key_name} not found"));
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    // we can be fairly certain that in db we have proper json
    let existing: CipherData = serde_json::from_str(&kdata).unwrap();

    let cd = merge_updates(existing, incoming);

    match cd.get_key().await {
        // here we are just checking that the key can encrypt a string, i.e.
        // it is set up correctly. We don't care what the actual entrypted string is.
        Ok(mut k) => match k.encrypt("hello world") {
            Ok(_) => {}
            Err(e) => return MetaHttpResponse::bad_request(e),
        },
        Err(e) => return MetaHttpResponse::bad_request(e),
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
        Ok(_) => (
            StatusCode::OK,
            Json(MetaHttpResponse::message(
                StatusCode::OK,
                "key updated successfully",
            )),
        )
            .into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(not(feature = "enterprise"))]
/// update the credentials for given key
#[utoipa::path(
    put,
    path = "/{org_id}/cipher_keys/{key_name}",
    context_path = "/api",
    operation_id = "UpdateCipherKey",
    summary = "Update encryption key",
    description = "Updates the configuration and parameters of an existing encryption key. This feature is only \
                   available in enterprise deployments.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("key_name" = String, Path, description = "name of the key to update", example = "test_key")
    ),
    responses(
        (status = 403, description = "Feature not supported", content_type = "application/json")
    ),
    tag = "Keys",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("not supported")
}

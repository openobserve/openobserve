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

use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::{StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use config::meta::autoobserve::is_reserved_kv_key;
use hashbrown::HashMap;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::kv};

/// GetValue

#[utoipa::path(
    get,
    path = "/{org_id}/kv/{key}",
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
        (status = 403, description = "Reserved key", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get value by key", "category": "kv-store"}))
    )
)]
pub async fn get(Path((org_id, key)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    if is_reserved_kv_key(&key) {
        return reserved_key_refused();
    }
    match kv::get(&org_id, &key).await {
        Ok(value) => (
            StatusCode::OK,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            value,
        )
            .into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Not Found",
        )
            .into_response(),
    }
}

/// SetValue

#[utoipa::path(
    post,
    path = "/{org_id}/kv/{key}",
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
        (status = 403, description = "Reserved key", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Set key-value pair", "category": "kv-store"}))
    )
)]
pub async fn set(Path((org_id, key)): Path<(String, String)>, body: Bytes) -> Response {
    let key = key.trim();
    #[cfg(feature = "enterprise")]
    if is_reserved_kv_key(key) {
        return reserved_key_refused();
    }
    match kv::set(&org_id, key, body).await {
        Ok(_) => (
            StatusCode::OK,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "OK",
        )
            .into_response(),
        Err(e) => {
            log::error!("Setting KV value: {key}, error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(CONTENT_TYPE, "text/plain; charset=utf-8")],
                "Error",
            )
                .into_response()
        }
    }
}

/// RemoveValue

#[utoipa::path(
    delete,
    path = "/{org_id}/kv/{key}",
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
        (status = 403, description = "Reserved key", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "text/plain", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete key-value pair", "category": "kv-store", "requires_confirmation": true}))
    )
)]
pub async fn delete(Path((org_id, key)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    if is_reserved_kv_key(&key) {
        return reserved_key_refused();
    }
    match kv::delete(&org_id, &key).await {
        Ok(_) => (
            StatusCode::OK,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "OK",
        )
            .into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Not Found",
        )
            .into_response(),
    }
}

/// ListKeys

#[utoipa::path(
    get,
    path = "/{org_id}/kv",
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
        (status = 200, description = "Success; reserved keys are never listed", content_type = "application/json", body = inline(Vec<String>)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Key Values", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all keys", "category": "kv-store", "summary_fields": []}))
    )
)]
pub async fn list(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let prefix = query.get("prefix").map(|s| s.as_str()).unwrap_or("");
    match kv::list(&org_id, prefix).await {
        Ok(keys) => MetaHttpResponse::json(listable(keys)),
        Err(err) => {
            log::error!("list KV keys: {prefix}, error: {err}");
            let keys: Vec<String> = Vec::new();
            MetaHttpResponse::json(keys)
        }
    }
}

/// The namespace holds investigation marks and owners' dismissals of hidden alerts (P4-Q2).
#[cfg(feature = "enterprise")]
fn reserved_key_refused() -> Response {
    MetaHttpResponse::forbidden(
        "This key is reserved for alert analysis and cannot be read or changed here.",
    )
}

#[cfg(feature = "enterprise")]
fn listable(keys: Vec<String>) -> Vec<String> {
    keys.into_iter()
        .filter(|key| !is_reserved_kv_key(key))
        .collect()
}

#[cfg(not(feature = "enterprise"))]
fn listable(keys: Vec<String>) -> Vec<String> {
    keys
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::Request, routing};
    #[cfg(feature = "enterprise")]
    use config::meta::autoobserve::{dismissal_key, marks::protected_key};
    use infra::table::{entity::kv_store::Entity, kv_store};
    use sea_orm::{ConnectionTrait, Schema};
    use tower::ServiceExt;

    use super::*;

    async fn setup() -> String {
        infra::db::create_table().await.unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let mut stmt = Schema::new(backend).create_table_from_entity(Entity);
        conn.execute(backend.build(stmt.if_not_exists()))
            .await
            .unwrap();
        format!("kvguard{}", config::ider::uuid())
    }

    fn app() -> Router {
        Router::new()
            .route(
                "/{org_id}/kv/{key}",
                routing::get(get).post(set).delete(delete),
            )
            .route("/{org_id}/kv", routing::get(list))
    }

    async fn send(method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    async fn stored(org: &str, key: &str) -> Option<Vec<u8>> {
        kv_store::get(org, key).await.unwrap().map(|m| m.value)
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn setting_a_reserved_key_is_forbidden_and_stores_nothing() {
        let org = setup().await;
        let key = protected_key("a1", "host=a");
        let resp = set(
            Path((org.clone(), key.clone())),
            Bytes::from_static(b"forged"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert_eq!(stored(&org, &key).await, None);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn deleting_a_reserved_key_is_forbidden_and_keeps_it() {
        let org = setup().await;
        let key = protected_key("a1", "host=a");
        kv_store::set(&org, &key, b"mark").await.unwrap();
        let resp = delete(Path((org.clone(), key.clone()))).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert_eq!(stored(&org, &key).await.as_deref(), Some(&b"mark"[..]));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_reserved_key_cannot_be_read_or_listed_through_kv() {
        let org = setup().await;
        let dismissal = dismissal_key("a1", "f1");
        kv_store::set(&org, &dismissal, b"{\"note\":\"secret\"}")
            .await
            .unwrap();
        kv_store::set(&org, &protected_key("a1", "host=a"), b"mark")
            .await
            .unwrap();
        kv_store::set(&org, "cfg/x", b"v").await.unwrap();
        for uri_key in [
            "_o2_ao%2Fdismissal%2Fa1%2Ff1",
            "%5Fo2_ao%2Fdismissal%2Fa1%2Ff1",
        ] {
            let (status, body) = send("GET", &format!("/{org}/kv/{uri_key}"), "").await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{uri_key}");
            assert!(
                body.contains("reserved") && !body.contains("secret"),
                "{body}"
            );
        }
        let (status, body) = send("GET", &format!("/{org}/kv"), "").await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, r#"["cfg/x"]"#));
        let (status, body) = send("GET", &format!("/{org}/kv?prefix=_o2_ao%2F"), "").await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, "[]"));
        let (status, body) = send("GET", &format!("/{org}/kv/cfg%2Fx"), "").await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, "v"));
    }

    #[tokio::test]
    async fn ordinary_keys_set_read_and_delete() {
        let org = setup().await;
        for (uri_key, key) in [
            ("settings", "settings"),
            ("dash%2Flayout", "dash/layout"),
            ("o2_ao%2Fmark", "o2_ao/mark"),
            ("my%2F_o2_ao%2Fmark", "my/_o2_ao/mark"),
        ] {
            let uri = format!("/{org}/kv/{uri_key}");
            assert_eq!(send("POST", &uri, "v").await.0, StatusCode::OK, "{key}");
            assert_eq!(stored(&org, key).await.as_deref(), Some(&b"v"[..]));
            assert_eq!(send("GET", &uri, "").await, (StatusCode::OK, "v".into()));
            assert_eq!(send("DELETE", &uri, "").await.0, StatusCode::OK, "{key}");
            assert_eq!(stored(&org, key).await, None);
        }
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn a_build_without_enterprise_reserves_no_key() {
        let org = setup().await;
        let uri = format!("/{org}/kv/_o2_ao%2Fmark%2Fx");
        assert_eq!(send("POST", &uri, "v").await.0, StatusCode::OK);
        assert_eq!(
            stored(&org, "_o2_ao/mark/x").await.as_deref(),
            Some(&b"v"[..])
        );
        assert_eq!(send("DELETE", &uri, "").await.0, StatusCode::OK);
        assert_eq!(stored(&org, "_o2_ao/mark/x").await, None);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn encoded_cased_and_padded_reserved_keys_are_forbidden() {
        let org = setup().await;
        let target = "_o2_ao/mark/x";
        kv_store::set(&org, target, b"mark").await.unwrap();
        for uri_key in [
            "_o2_ao%2Fmark%2Fx",
            "%5Fo2%5Fao%2Fmark%2Fx",
            "%5fo2_ao%2fmark%2fx",
            "_O2_AO%2Fmark%2Fx",
            "%2F_o2_ao%2Fmark%2Fx",
            "%2F%2F_o2_ao%2Fmark%2Fx",
            "%20_o2_ao%2Fmark%2Fx%20",
            "%09%2F%20_o2_ao%2Fmark%2Fx",
            "_o2_ao%252Fmark%252Fx",
            "%255Fo2_ao%25252Fmark",
        ] {
            let uri = format!("/{org}/kv/{uri_key}");
            let (status, body) = send("POST", &uri, "forged").await;
            assert_eq!(status, StatusCode::FORBIDDEN, "POST {uri_key}");
            assert!(body.contains("reserved"), "POST {uri_key}: {body}");
            assert_eq!(send("DELETE", &uri, "").await.0, StatusCode::FORBIDDEN);
        }
        assert_eq!(stored(&org, target).await.as_deref(), Some(&b"mark"[..]));
        assert_eq!(kv_store::list(&org, "").await.unwrap(), vec![target]);
    }
}

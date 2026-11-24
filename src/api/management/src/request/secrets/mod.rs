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

pub mod backends;

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
#[cfg(feature = "enterprise")]
use axum::{http::StatusCode, response::IntoResponse};
use common::meta::http::HttpResponse;
#[cfg(feature = "enterprise")]
use config::meta::secret_store::api::{
    CreateSecretResponse, PolicyResponse, PrescanPage, SecretDetail, SecretErrorBody,
    SecretGrantsResponse, SecretListPage, StoreStatus, UsagePage, ValueWriteResponse,
};
use config::meta::secret_store::{
    GateState::{self, Closed, Latched, Writable},
    api::{
        CreateGrantsAll, CreateSecretRequest, DeleteSecretQuery, DescribeSecretRequest,
        ListSecretsQuery, PolicyQuery, PolicyRequest, PutValueRequest, RenameSecretRequest,
        SecretGrants, UsageQuery,
    },
};
#[cfg(feature = "enterprise")]
use config::meta::{secret_store::SecretErrorCode, user::UserRole};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::auditor::AuditTarget,
    secret_store::{
        authz::FgaSecretStoreAuthz,
        grants::{self, FgaGrantStore},
        lifecycle, policy, prescan, refresh,
        service::{self, Caller, Done, StoreError},
        status, values,
    },
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use serde::Serialize;

#[cfg(feature = "enterprise")]
use crate::service::auth::UserEmail;

// Policy updates that widen access and creates that carry grants require Latched in the handler.
pub const SECRET_ROUTE_GATES: &[(&str, &str, Option<GateState>)] = &[
    ("GET", "/{org_id}/secrets", Some(Closed)),
    ("POST", "/{org_id}/secrets", Some(Writable)),
    ("GET", "/{org_id}/secrets/status", None),
    ("GET", "/{org_id}/secrets/prescan", Some(Closed)),
    ("GET", "/{org_id}/secrets/backends", Some(Closed)),
    ("POST", "/{org_id}/secrets/backends", Some(Writable)),
    (
        "PUT",
        "/{org_id}/secrets/backends/{backend_id}",
        Some(Writable),
    ),
    (
        "DELETE",
        "/{org_id}/secrets/backends/{backend_id}",
        Some(Writable),
    ),
    (
        "PUT",
        "/{org_id}/secrets/backends/{backend_id}/credential",
        Some(Writable),
    ),
    (
        "POST",
        "/{org_id}/secrets/backends/{backend_id}/test",
        Some(Writable),
    ),
    (
        "GET",
        "/{org_id}/secrets/backends/{backend_id}/grants",
        Some(Closed),
    ),
    (
        "PUT",
        "/{org_id}/secrets/backends/{backend_id}/grants",
        Some(Latched),
    ),
    (
        "GET",
        "/{org_id}/secrets/backends/{backend_id}/identity",
        Some(Closed),
    ),
    (
        "GET",
        "/{org_id}/secrets/backends/{backend_id}/trust_template",
        Some(Closed),
    ),
    (
        "POST",
        "/{org_id}/secrets/backends/{backend_id}/identity/rotate",
        Some(Writable),
    ),
    (
        "PUT",
        "/{org_id}/secrets/backend_identities/{target_org}/{provider}",
        Some(Writable),
    ),
    ("GET", "/{org_id}/secrets/identity_jobs", Some(Closed)),
    (
        "POST",
        "/{org_id}/secrets/identities/{target_org}/{provider}/retry",
        Some(Writable),
    ),
    ("GET", "/{org_id}/secrets/_all/grants", Some(Closed)),
    ("PUT", "/{org_id}/secrets/_all/grants", Some(Latched)),
    ("GET", "/{org_id}/secrets/{secret_id}", Some(Closed)),
    ("PUT", "/{org_id}/secrets/{secret_id}", Some(Writable)),
    ("DELETE", "/{org_id}/secrets/{secret_id}", Some(Writable)),
    (
        "PUT",
        "/{org_id}/secrets/{secret_id}/values/{env}",
        Some(Writable),
    ),
    (
        "DELETE",
        "/{org_id}/secrets/{secret_id}/values/{env}",
        Some(Writable),
    ),
    (
        "PUT",
        "/{org_id}/secrets/{secret_id}/policy",
        Some(Writable),
    ),
    ("GET", "/{org_id}/secrets/{secret_id}/grants", Some(Closed)),
    ("PUT", "/{org_id}/secrets/{secret_id}/grants", Some(Latched)),
    ("GET", "/{org_id}/secrets/{secret_id}/usage", Some(Closed)),
    (
        "POST",
        "/{org_id}/secrets/{secret_id}/restore",
        Some(Writable),
    ),
    (
        "POST",
        "/{org_id}/secrets/{secret_id}/purge",
        Some(Writable),
    ),
    (
        "POST",
        "/{org_id}/secrets/{secret_id}/refresh",
        Some(Writable),
    ),
    (
        "PUT",
        "/{org_id}/secrets/{secret_id}/rename",
        Some(Writable),
    ),
];

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets",
    context_path = "/api",
    operation_id = "ListSecrets",
    tag = "Secrets",
    summary = "List secrets and variables (secret values are write-only and never returned)",
    description = "Lists metadata, or picker entries when filtering by consumer. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ListSecretsQuery,
    ),
    responses(
        (status = 200, description = "Success", body = SecretListPage, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true, "category": "secrets"})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets",
    context_path = "/api",
    operation_id = "ListSecrets",
    tag = "Secrets",
    summary = "List secrets and variables (secret values are write-only and never returned)",
    description = "Lists metadata, or picker entries when filtering by consumer. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ListSecretsQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true, "category": "secrets"})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
pub async fn list(
    Path(org_id): Path<String>,
    Query(query): Query<ListSecretsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match service::list(&FgaSecretStoreAuthz, &caller, &org_id, query).await {
                    Ok(page) => HttpResponse::json(page),
                    Err(e) => store_error(e),
                }
            }
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((org_id, query));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/{org_id}/secrets",
    context_path = "/api",
    operation_id = "CreateSecret",
    tag = "Secrets",
    summary = "Create a secret or variable (secret values are write-only and never returned)",
    description = "Creates a named secret or variable with its initial values and consumer policy. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateSecretRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = CreateSecretResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "create"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/{org_id}/secrets",
    context_path = "/api",
    operation_id = "CreateSecret",
    tag = "Secrets",
    summary = "Create a secret or variable (secret values are write-only and never returned)",
    description = "Creates a named secret or variable with its initial values and consumer policy. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateSecretRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "create"}))
    )
))]
pub async fn create(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateSecretRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                json_reply(service::create(&FgaSecretStoreAuthz, &caller, &org_id, body).await)
            }
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((org_id, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/status",
    context_path = "/api",
    operation_id = "GetSecretStoreStatus",
    tag = "Secrets",
    summary = "Get secret store status (secret values are write-only and never returned)",
    description = "Returns organization readiness, or gate and node details for the _meta organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = StoreStatus, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/status",
    context_path = "/api",
    operation_id = "GetSecretStoreStatus",
    tag = "Secrets",
    summary = "Get secret store status (secret values are write-only and never returned)",
    description = "Returns organization readiness, or gate and node details for the _meta organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
pub async fn status(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id == config::META_ORG_ID {
            if !db::user::is_root_user(&user_email.user_id) {
                return code_error(SecretErrorCode::SecretAccessRequired);
            }
            return match status::meta_status().await {
                Ok(body) => HttpResponse::json(StoreStatus::Meta(body)),
                Err(e) => store_error(e),
            };
        }
        // The route row bypasses FGA, so membership is the only check.
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match status::org_status(&FgaSecretStoreAuthz, &caller, &org_id).await {
                Ok(body) => HttpResponse::json(StoreStatus::Org(body)),
                Err(e) => store_error(e),
            },
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/prescan",
    context_path = "/api",
    operation_id = "ListSecretPrescanHits",
    tag = "Secrets",
    summary = "List secret prescan hits (secret values are write-only and never returned)",
    description = "Lists consumer fields containing tokens identified by the prescan. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = PrescanPage, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/prescan",
    context_path = "/api",
    operation_id = "ListSecretPrescanHits",
    tag = "Secrets",
    summary = "List secret prescan hits (secret values are write-only and never returned)",
    description = "Lists consumer fields containing tokens identified by the prescan. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
pub async fn prescan(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match prescan::list(&FgaSecretStoreAuthz, &caller, &org_id).await {
                Ok(page) => HttpResponse::json(page),
                Err(e) => store_error(e),
            },
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/_all/grants",
    context_path = "/api",
    operation_id = "GetSecretCreateGrants",
    tag = "Secrets",
    summary = "Get secret creation grants (secret values are write-only and never returned)",
    description = "Lists the roles with permission to create secrets in this organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = CreateGrantsAll, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/_all/grants",
    context_path = "/api",
    operation_id = "GetSecretCreateGrants",
    tag = "Secrets",
    summary = "Get secret creation grants (secret values are write-only and never returned)",
    description = "Lists the roles with permission to create secrets in this organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get_create_grants(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match grants::get_create_grants(&FgaGrantStore, &caller, &org_id).await {
                Ok(body) => HttpResponse::json(body),
                Err(e) => store_error(e),
            },
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/_all/grants",
    context_path = "/api",
    operation_id = "UpdateSecretCreateGrants",
    tag = "Secrets",
    summary = "Update secret creation grants (secret values are write-only and never returned)",
    description = "Replaces the roles with permission to create secrets in this organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateGrantsAll, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = CreateGrantsAll, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/_all/grants",
    context_path = "/api",
    operation_id = "UpdateSecretCreateGrants",
    tag = "Secrets",
    summary = "Update secret creation grants (secret values are write-only and never returned)",
    description = "Replaces the roles with permission to create secrets in this organization. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateGrantsAll, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_create_grants(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateGrantsAll>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                json_reply(grants::put_create_grants(&FgaGrantStore, &caller, &org_id, body).await)
            }
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((org_id, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "GetSecret",
    tag = "Secrets",
    summary = "Get secret or variable details (secret values are write-only and never returned)",
    description = "Returns metadata, environment states, and consumer policy for one secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 200, description = "Success", body = SecretDetail, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true, "category": "secrets"})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "GetSecret",
    tag = "Secrets",
    summary = "Get secret or variable details (secret values are write-only and never returned)",
    description = "Returns metadata, environment states, and consumer policy for one secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true, "category": "secrets"})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match service::get(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id).await {
                    Ok(detail) => HttpResponse::json(detail),
                    Err(e) => store_error(e),
                }
            }
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "UpdateSecretDescription",
    tag = "Secrets",
    summary = "Update a secret description (secret values are write-only and never returned)",
    description = "Replaces the description of a secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = DescribeSecretRequest, content_type = "application/json"),
    responses(
        (status = 204, description = "Success"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "UpdateSecretDescription",
    tag = "Secrets",
    summary = "Update a secret description (secret values are write-only and never returned)",
    description = "Replaces the description of a secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = DescribeSecretRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn describe(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<DescribeSecretRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                service::describe(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id, body).await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    delete,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "DeleteSecret",
    tag = "Secrets",
    summary = "Delete a secret or variable (secret values are write-only and never returned)",
    description = "Deletes the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        DeleteSecretQuery,
    ),
    responses(
        (status = 204, description = "Success"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "delete"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    delete,
    path = "/{org_id}/secrets/{secret_id}",
    context_path = "/api",
    operation_id = "DeleteSecret",
    tag = "Secrets",
    summary = "Delete a secret or variable (secret values are write-only and never returned)",
    description = "Deletes the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        DeleteSecretQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "delete"}))
    )
))]
pub async fn delete(
    Path(path): Path<(String, String)>,
    Query(query): Query<DeleteSecretQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                lifecycle::delete(
                    &FgaSecretStoreAuthz,
                    &caller,
                    &org_id,
                    &secret_id,
                    query.force,
                )
                .await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, query));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/values/{env}",
    context_path = "/api",
    operation_id = "PutSecretValue",
    tag = "Secrets",
    summary = "Write a secret or variable value (secret values are write-only and never returned)",
    description = "Writes or unsets the value in the specified environment or organization scope. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        ("env" = String, Path, description = "Environment name or _org for organization scope"),
    ),
    request_body(content = PutValueRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = ValueWriteResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/values/{env}",
    context_path = "/api",
    operation_id = "PutSecretValue",
    tag = "Secrets",
    summary = "Write a secret or variable value (secret values are write-only and never returned)",
    description = "Writes or unsets the value in the specified environment or organization scope. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        ("env" = String, Path, description = "Environment name or _org for organization scope"),
    ),
    request_body(content = PutValueRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_value(
    Path(path): Path<(String, String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<PutValueRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id, env) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                values::put_value(
                    &FgaSecretStoreAuthz,
                    &caller,
                    &org_id,
                    &secret_id,
                    &env,
                    body,
                )
                .await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    delete,
    path = "/{org_id}/secrets/{secret_id}/values/{env}",
    context_path = "/api",
    operation_id = "DeleteSecretValue",
    tag = "Secrets",
    summary = "Delete a secret or variable value (secret values are write-only and never returned)",
    description = "Deletes the value in the specified environment or organization scope. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        ("env" = String, Path, description = "Environment name or _org for organization scope"),
    ),
    responses(
        (status = 200, description = "Success", body = ValueWriteResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "delete"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    delete,
    path = "/{org_id}/secrets/{secret_id}/values/{env}",
    context_path = "/api",
    operation_id = "DeleteSecretValue",
    tag = "Secrets",
    summary = "Delete a secret or variable value (secret values are write-only and never returned)",
    description = "Deletes the value in the specified environment or organization scope. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        ("env" = String, Path, description = "Environment name or _org for organization scope"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "delete"}))
    )
))]
pub async fn delete_value(
    Path(path): Path<(String, String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id, env) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                values::delete_value(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id, &env)
                    .await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/policy",
    context_path = "/api",
    operation_id = "UpdateSecretPolicy",
    tag = "Secrets",
    summary = "Update a secret consumer policy (secret values are write-only and never returned)",
    description = "Updates the consumer policy, or lists affected consumers during a dry run. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        PolicyQuery,
    ),
    request_body(content = PolicyRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = PolicyResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/policy",
    context_path = "/api",
    operation_id = "UpdateSecretPolicy",
    tag = "Secrets",
    summary = "Update a secret consumer policy (secret values are write-only and never returned)",
    description = "Updates the consumer policy, or lists affected consumers during a dry run. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        PolicyQuery,
    ),
    request_body(content = PolicyRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_policy(
    Path(path): Path<(String, String)>,
    Query(query): Query<PolicyQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<PolicyRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                policy::put_policy(
                    &FgaSecretStoreAuthz,
                    &caller,
                    &org_id,
                    &secret_id,
                    query,
                    body,
                )
                .await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, query, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}/grants",
    context_path = "/api",
    operation_id = "GetSecretGrants",
    tag = "Secrets",
    summary = "Get access grants for a secret (secret values are write-only and never returned)",
    description = "Lists the roles granted access to the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 200, description = "Success", body = SecretGrantsResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}/grants",
    context_path = "/api",
    operation_id = "GetSecretGrants",
    tag = "Secrets",
    summary = "Get access grants for a secret (secret values are write-only and never returned)",
    description = "Lists the roles granted access to the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get_grants(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match grants::get_grants(
                &FgaSecretStoreAuthz,
                &FgaGrantStore,
                &caller,
                &org_id,
                &secret_id,
            )
            .await
            {
                Ok(body) => HttpResponse::json(body),
                Err(e) => store_error(e),
            },
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/grants",
    context_path = "/api",
    operation_id = "UpdateSecretGrants",
    tag = "Secrets",
    summary = "Update access grants for a secret (secret values are write-only and never returned)",
    description = "Replaces the access grants for the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = SecretGrants, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = SecretGrantsResponse, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/grants",
    context_path = "/api",
    operation_id = "UpdateSecretGrants",
    tag = "Secrets",
    summary = "Update access grants for a secret (secret values are write-only and never returned)",
    description = "Replaces the access grants for the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = SecretGrants, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_grants(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<SecretGrants>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                grants::put_grants(
                    &FgaSecretStoreAuthz,
                    &FgaGrantStore,
                    &caller,
                    &org_id,
                    &secret_id,
                    body,
                )
                .await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, body));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}/usage",
    context_path = "/api",
    operation_id = "GetSecretUsage",
    tag = "Secrets",
    summary = "List consumers using a secret (secret values are write-only and never returned)",
    description = "Lists the consumer paths and fields that reference the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        UsageQuery,
    ),
    responses(
        (status = 200, description = "Success", body = UsagePage, content_type = "application/json"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/{org_id}/secrets/{secret_id}/usage",
    context_path = "/api",
    operation_id = "GetSecretUsage",
    tag = "Secrets",
    summary = "List consumers using a secret (secret values are write-only and never returned)",
    description = "Lists the consumer paths and fields that reference the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
        UsageQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "list"}))
    )
))]
pub async fn usage(
    Path(path): Path<(String, String)>,
    Query(query): Query<UsageQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match lifecycle::usage(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id, query)
                    .await
                {
                    Ok(page) => HttpResponse::json(page),
                    Err(e) => store_error(e),
                }
            }
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, query));
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/restore",
    context_path = "/api",
    operation_id = "RestoreSecret",
    tag = "Secrets",
    summary = "Restore a deleted secret or variable (secret values are write-only and never returned)",
    description = "Restores the selected deleted secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 204, description = "Success"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/restore",
    context_path = "/api",
    operation_id = "RestoreSecret",
    tag = "Secrets",
    summary = "Restore a deleted secret or variable (secret values are write-only and never returned)",
    description = "Restores the selected deleted secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn restore(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                lifecycle::restore(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id).await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/refresh",
    context_path = "/api",
    operation_id = "RefreshSecret",
    tag = "Secrets",
    summary = "Refresh a secret's cached external value (secret values are write-only and never returned)",
    description = "Evicts the cached values of the selected secret on every node, at most once per 30 seconds. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret ID"),
    ),
    responses(
        (status = 200, description = "Success; refreshed is false while the cooldown runs", body = refresh::RefreshResponse, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/refresh",
    context_path = "/api",
    operation_id = "RefreshSecret",
    tag = "Secrets",
    summary = "Refresh a secret's cached external value (secret values are write-only and never returned)",
    description = "Evicts the cached values of the selected secret on every node, at most once per 30 seconds. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn refresh(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                refresh::refresh(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id).await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/purge",
    context_path = "/api",
    operation_id = "PurgeSecret",
    tag = "Secrets",
    summary = "Purge a deleted secret or variable (secret values are write-only and never returned)",
    description = "Permanently purges the selected deleted secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 204, description = "Success"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/{org_id}/secrets/{secret_id}/purge",
    context_path = "/api",
    operation_id = "PurgeSecret",
    tag = "Secrets",
    summary = "Purge a deleted secret or variable (secret values are write-only and never returned)",
    description = "Permanently purges the selected deleted secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn purge(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                lifecycle::purge(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id).await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        store_unavailable()
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/rename",
    context_path = "/api",
    operation_id = "RenameSecret",
    tag = "Secrets",
    summary = "Rename a secret or variable (secret values are write-only and never returned)",
    description = "Changes the name of the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = RenameSecretRequest, content_type = "application/json"),
    responses(
        (status = 204, description = "Success"),
        (status = 400, description = "Invalid request", body = SecretErrorBody, content_type = "application/json"),
        (status = 403, description = "Forbidden", body = SecretErrorBody, content_type = "application/json"),
        (status = 404, description = "Resource not found", body = SecretErrorBody, content_type = "application/json"),
        (status = 409, description = "Conflict", body = SecretErrorBody, content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    put,
    path = "/{org_id}/secrets/{secret_id}/rename",
    context_path = "/api",
    operation_id = "RenameSecret",
    tag = "Secrets",
    summary = "Rename a secret or variable (secret values are write-only and never returned)",
    description = "Changes the name of the selected secret or variable. Secret values are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("secret_id" = String, Path, description = "Secret or variable ID"),
    ),
    request_body(content = RenameSecretRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn rename(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RenameSecretRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, secret_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                lifecycle::rename(&FgaSecretStoreAuthz, &caller, &org_id, &secret_id, body).await,
            ),
            Err(refused) => refused,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop((path, body));
        store_unavailable()
    }
}

/// `check_strict` takes `root` for a root user, else the caller's role in the path org.
#[cfg(feature = "enterprise")]
async fn caller(org_id: &str, user_id: &str) -> Result<Caller, Response> {
    let role = if db::user::is_root_user(user_id) {
        UserRole::Root
    } else {
        match openobserve_core::users::get_user(Some(org_id), user_id).await {
            Some(user) => user.role,
            None => return Err(code_error(SecretErrorCode::SecretAccessRequired)),
        }
    };
    Ok(Caller {
        user_id: user_id.to_string(),
        role: role.to_string(),
    })
}

#[cfg(feature = "enterprise")]
fn json_reply<T: Serialize>(result: Result<Done<T>, StoreError>) -> Response {
    match result {
        Ok(done) => audited(HttpResponse::json(done.body), done.audit),
        Err(e) => store_error(e),
    }
}

#[cfg(feature = "enterprise")]
fn empty_reply(result: Result<Done<()>, StoreError>) -> Response {
    match result {
        Ok(done) => audited(StatusCode::NO_CONTENT.into_response(), done.audit),
        Err(e) => store_error(e),
    }
}

#[cfg(feature = "enterprise")]
fn audited(mut res: Response, target: AuditTarget) -> Response {
    res.extensions_mut().insert(target);
    res
}

#[cfg(feature = "enterprise")]
fn store_error(e: StoreError) -> Response {
    match e {
        StoreError::Code(code) => code_error(code),
        StoreError::InUse(usage) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "code": SecretErrorCode::SecretInUse,
                "message": "the secret is in use; delete with force=true",
                "usage": usage,
            })),
        )
            .into_response(),
        StoreError::VariableFeedsConsumers(usage) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "code": SecretErrorCode::VariableFeedsSecretConsumer,
                "message": "a consumer that reads this variable uses a secret you cannot use",
                "usage": usage,
            })),
        )
            .into_response(),
        StoreError::BackendInUse(secrets) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "code": SecretErrorCode::SecretInUse,
                "message": "the backend has pointers; delete with force=true",
                "secrets": secrets,
            })),
        )
            .into_response(),
        StoreError::Internal(e) => {
            log::error!("secret store: {e}");
            HttpResponse::internal_error("secret store error")
        }
    }
}

/// Resolve-only codes carry no status of their own; on a route they are conflicts.
#[cfg(feature = "enterprise")]
fn code_error(code: SecretErrorCode) -> Response {
    let status = code
        .http_status()
        .and_then(|s| StatusCode::from_u16(s).ok())
        .unwrap_or(StatusCode::CONFLICT);
    let body = SecretErrorBody {
        code,
        message: code.as_str().to_string(),
    };
    (status, Json(body)).into_response()
}

#[cfg(not(feature = "enterprise"))]
fn store_unavailable() -> Response {
    HttpResponse::forbidden("Secret store is not available in this edition")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::SECRET_ROUTE_GATES;

    #[test]
    fn route_gates_are_unique_by_method_and_path() {
        let mut seen = HashSet::new();
        for &(method, path, _) in SECRET_ROUTE_GATES {
            assert!(
                seen.insert((method, path)),
                "duplicate route: {method} {path}"
            );
        }
    }

    #[test]
    fn route_gates_exclude_reveal() {
        for &(_, path, _) in SECRET_ROUTE_GATES {
            assert!(!path.contains("reveal"), "{path}");
        }
    }
}

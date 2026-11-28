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

//! External secret backends: every route answers 403 outside the enterprise edition.

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
#[cfg(feature = "enterprise")]
use common::meta::http::HttpResponse;
#[cfg(feature = "enterprise")]
use config::meta::secret_store::api::{
    BackendGrantsResponse, BackendIdentityResponse, BackendListPage, BackendTestResponse,
    CreateBackendResponse, IdentityAccepted, IdentityJobsResponse, SecretErrorBody,
    TrustTemplateResponse,
};
use config::meta::secret_store::{
    api::{
        BackendCredentialRequest, BackendGrants, BackendTestRequest, CreateBackendRequest,
        DeleteBackendQuery, IdentityJobsQuery, PutBackendIdentityRequest, RetryIdentityRequest,
        TrustTemplateQuery, UpdateBackendRequest,
    },
    external::BackendKind,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::secret_store::{
    authz::FgaSecretStoreAuthz, backends, grants::FgaGrantStore, identity,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;

#[cfg(not(feature = "enterprise"))]
use super::store_unavailable;
#[cfg(feature = "enterprise")]
use super::{caller, empty_reply, json_reply, store_error};
#[cfg(feature = "enterprise")]
use crate::service::auth::UserEmail;

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/{org_id}/secrets/backends",
    context_path = "/api",
    operation_id = "ListSecretBackends",
    tag = "Secrets",
    summary = "List external secret backends",
    description = "Lists the external secret backends the caller can see. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "Success", body = BackendListPage, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends",
    context_path = "/api",
    operation_id = "ListSecretBackends",
    tag = "Secrets",
    summary = "List external secret backends",
    description = "Lists the external secret backends the caller can see. Credentials are write-only and never returned.",
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
pub async fn list_backends(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match backends::list(&FgaSecretStoreAuthz, &caller, &org_id).await {
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
    post,
    path = "/{org_id}/secrets/backends",
    context_path = "/api",
    operation_id = "CreateSecretBackend",
    tag = "Secrets",
    summary = "Create an external secret backend",
    description = "Creates an external secret backend; it serves only after a passing connection test. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateBackendRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = CreateBackendResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends",
    context_path = "/api",
    operation_id = "CreateSecretBackend",
    tag = "Secrets",
    summary = "Create an external secret backend",
    description = "Creates an external secret backend; it serves only after a passing connection test. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = CreateBackendRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "create"}))
    )
))]
pub async fn create_backend(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateBackendRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                json_reply(backends::create(&FgaSecretStoreAuthz, &caller, &org_id, body).await)
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
    put,
    path = "/{org_id}/secrets/backends/{backend_id}",
    context_path = "/api",
    operation_id = "UpdateSecretBackend",
    tag = "Secrets",
    summary = "Update an external secret backend",
    description = "Updates the backend's name, description, settings or path prefixes. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = UpdateBackendRequest, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}",
    context_path = "/api",
    operation_id = "UpdateSecretBackend",
    tag = "Secrets",
    summary = "Update an external secret backend",
    description = "Updates the backend's name, description, settings or path prefixes. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = UpdateBackendRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn update_backend(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<UpdateBackendRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                backends::update(&FgaSecretStoreAuthz, &caller, &org_id, &backend_id, body).await,
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
    path = "/{org_id}/secrets/backends/{backend_id}",
    context_path = "/api",
    operation_id = "DeleteSecretBackend",
    tag = "Secrets",
    summary = "Delete an external secret backend",
    description = "Deletes the backend; with pointers it needs force=true. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
        DeleteBackendQuery,
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
    path = "/{org_id}/secrets/backends/{backend_id}",
    context_path = "/api",
    operation_id = "DeleteSecretBackend",
    tag = "Secrets",
    summary = "Delete an external secret backend",
    description = "Deletes the backend; with pointers it needs force=true. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
        DeleteBackendQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "delete"}))
    )
))]
pub async fn delete_backend(
    Path(path): Path<(String, String)>,
    Query(query): Query<DeleteBackendQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                backends::delete(
                    &FgaSecretStoreAuthz,
                    &caller,
                    &org_id,
                    &backend_id,
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
    path = "/{org_id}/secrets/backends/{backend_id}/credential",
    context_path = "/api",
    operation_id = "PutSecretBackendCredential",
    tag = "Secrets",
    summary = "Replace an external secret backend credential",
    description = "Stores the backend's static credential. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendCredentialRequest, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/credential",
    context_path = "/api",
    operation_id = "PutSecretBackendCredential",
    tag = "Secrets",
    summary = "Replace an external secret backend credential",
    description = "Stores the backend's static credential. Credentials are write-only and never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendCredentialRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_backend_credential(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BackendCredentialRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                backends::put_credential(&FgaSecretStoreAuthz, &caller, &org_id, &backend_id, body)
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
    post,
    path = "/{org_id}/secrets/backends/{backend_id}/test",
    context_path = "/api",
    operation_id = "TestSecretBackend",
    tag = "Secrets",
    summary = "Test an external secret backend",
    description = "Tests the backend connection, optionally for one locator, and returns a status only. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendTestRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = BackendTestResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/test",
    context_path = "/api",
    operation_id = "TestSecretBackend",
    tag = "Secrets",
    summary = "Test an external secret backend",
    description = "Tests the backend connection, optionally for one locator, and returns a status only. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendTestRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn test_backend(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BackendTestRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                backends::test(&FgaSecretStoreAuthz, &caller, &org_id, &backend_id, body).await,
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
    path = "/{org_id}/secrets/backends/{backend_id}/grants",
    context_path = "/api",
    operation_id = "GetSecretBackendGrants",
    tag = "Secrets",
    summary = "Get external secret backend grants",
    description = "Lists the roles granted rights on this backend. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 200, description = "Success", body = BackendGrantsResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/grants",
    context_path = "/api",
    operation_id = "GetSecretBackendGrants",
    tag = "Secrets",
    summary = "Get external secret backend grants",
    description = "Lists the roles granted rights on this backend. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get_backend_grants(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match backends::get_grants(&FgaGrantStore, &caller, &org_id, &backend_id).await {
                    Ok(page) => HttpResponse::json(page),
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
    path = "/{org_id}/secrets/backends/{backend_id}/grants",
    context_path = "/api",
    operation_id = "PutSecretBackendGrants",
    tag = "Secrets",
    summary = "Replace external secret backend grants",
    description = "Replaces the roles granted rights on this backend. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendGrants, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = BackendGrantsResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/grants",
    context_path = "/api",
    operation_id = "PutSecretBackendGrants",
    tag = "Secrets",
    summary = "Replace external secret backend grants",
    description = "Replaces the roles granted rights on this backend. Secret values are never returned.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    request_body(content = BackendGrants, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_backend_grants(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<BackendGrants>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(
                backends::put_grants(&FgaGrantStore, &caller, &org_id, &backend_id, body).await,
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
    path = "/{org_id}/secrets/backends/{backend_id}/identity",
    context_path = "/api",
    operation_id = "GetSecretBackendIdentity",
    tag = "Secrets",
    summary = "Get a backend identity",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 200, description = "Success", body = BackendIdentityResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/identity",
    context_path = "/api",
    operation_id = "GetSecretBackendIdentity",
    tag = "Secrets",
    summary = "Get a backend identity",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get_backend_identity(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match identity::get_identity(&FgaSecretStoreAuthz, &caller, &org_id, &backend_id)
                    .await
                {
                    Ok(body) => HttpResponse::json(body),
                    Err(error) => store_error(error),
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
    get,
    path = "/{org_id}/secrets/backends/{backend_id}/trust_template",
    context_path = "/api",
    operation_id = "GetSecretBackendTrustTemplate",
    tag = "Secrets",
    summary = "Get a backend trust template",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
        TrustTemplateQuery,
    ),
    responses(
        (status = 200, description = "Success", body = TrustTemplateResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/trust_template",
    context_path = "/api",
    operation_id = "GetSecretBackendTrustTemplate",
    tag = "Secrets",
    summary = "Get a backend trust template",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
        TrustTemplateQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn get_backend_trust_template(
    Path(path): Path<(String, String)>,
    Query(query): Query<TrustTemplateQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => {
                match identity::trust_template(
                    &FgaSecretStoreAuthz,
                    &caller,
                    &org_id,
                    &backend_id,
                    query.format,
                )
                .await
                {
                    Ok(body) => HttpResponse::json(body),
                    Err(error) => store_error(error),
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
    path = "/{org_id}/secrets/backends/{backend_id}/identity/rotate",
    context_path = "/api",
    operation_id = "RotateSecretBackendIdentity",
    tag = "Secrets",
    summary = "Request backend identity rotation",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 200, description = "Success", body = IdentityAccepted, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backends/{backend_id}/identity/rotate",
    context_path = "/api",
    operation_id = "RotateSecretBackendIdentity",
    tag = "Secrets",
    summary = "Request backend identity rotation",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("backend_id" = String, Path, description = "Backend ID"),
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn rotate_backend_identity(
    Path(path): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, backend_id) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => json_reply(identity::rotate(&caller, &org_id, &backend_id).await),
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
    path = "/{org_id}/secrets/backend_identities/{target_org}/{provider}",
    context_path = "/api",
    operation_id = "PutSecretBackendIdentity",
    tag = "Secrets",
    summary = "Set a manual backend identity",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("target_org" = String, Path, description = "Target organization ID"),
        ("provider" = BackendKind, Path, description = "Provider kind"),
    ),
    request_body(content = PutBackendIdentityRequest, content_type = "application/json"),
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
    path = "/{org_id}/secrets/backend_identities/{target_org}/{provider}",
    context_path = "/api",
    operation_id = "PutSecretBackendIdentity",
    tag = "Secrets",
    summary = "Set a manual backend identity",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("target_org" = String, Path, description = "Target organization ID"),
        ("provider" = BackendKind, Path, description = "Provider kind"),
    ),
    request_body(content = PutBackendIdentityRequest, content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn put_backend_identity(
    Path(path): Path<(String, String, BackendKind)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<PutBackendIdentityRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, target_org, provider) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                identity::put_manual(&caller, &org_id, &target_org, provider, body.principal).await,
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
    path = "/{org_id}/secrets/identity_jobs",
    context_path = "/api",
    operation_id = "ListSecretIdentityJobs",
    tag = "Secrets",
    summary = "List identity provisioning runs",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        IdentityJobsQuery,
    ),
    responses(
        (status = 200, description = "Success", body = IdentityJobsResponse, content_type = "application/json"),
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
    path = "/{org_id}/secrets/identity_jobs",
    context_path = "/api",
    operation_id = "ListSecretIdentityJobs",
    tag = "Secrets",
    summary = "List identity provisioning runs",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        IdentityJobsQuery,
    ),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "get"}))
    )
))]
pub async fn list_identity_jobs(
    Path(path): Path<String>,
    Query(query): Query<IdentityJobsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => match identity::list_jobs(&caller, &org_id, query.state).await {
                Ok(body) => HttpResponse::json(body),
                Err(error) => store_error(error),
            },
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
    path = "/{org_id}/secrets/identities/{target_org}/{provider}/retry",
    context_path = "/api",
    operation_id = "RetrySecretBackendIdentity",
    tag = "Secrets",
    summary = "Retry identity provisioning",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("target_org" = String, Path, description = "Target organization ID"),
        ("provider" = BackendKind, Path, description = "Provider kind"),
    ),
    request_body(content = ref("#/components/schemas/RetryIdentityRequest"), description = "May be omitted; force_switch defaults to false", content_type = "application/json"),
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
    path = "/{org_id}/secrets/identities/{target_org}/{provider}/retry",
    context_path = "/api",
    operation_id = "RetrySecretBackendIdentity",
    tag = "Secrets",
    summary = "Retry identity provisioning",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("target_org" = String, Path, description = "Target organization ID"),
        ("provider" = BackendKind, Path, description = "Provider kind"),
    ),
    request_body(content = ref("#/components/schemas/RetryIdentityRequest"), description = "May be omitted; force_switch defaults to false", content_type = "application/json"),
    responses(
        (status = 403, description = "Not available in this edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Secrets", "operation": "update"}))
    )
))]
pub async fn retry_backend_identity(
    Path(path): Path<(String, String, BackendKind)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    body: Option<Json<RetryIdentityRequest>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, target_org, provider) = path;
        match caller(&org_id, &user_email.user_id).await {
            Ok(caller) => empty_reply(
                identity::retry(
                    &caller,
                    &org_id,
                    &target_org,
                    provider,
                    body.is_some_and(|Json(body)| body.force_switch),
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

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

pub mod schema;

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query},
    response::Response,
};
#[cfg(feature = "enterprise")]
use axum::{http::StatusCode, response::IntoResponse};
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::service_identity::{
    aliases,
    api::{self, Context},
};
use openobserve_core::{
    auth::UserEmail,
    service_identity::aliases::{AliasBulk, AliasCreate, AliasUndo, AliasUpdate},
};

use crate::{
    common::meta::http::HttpResponse,
    request::service_identity::schema::{
        AliasBulkResult, AliasList, AliasesRestored, EnvList, OverrideList, OverrideRemoved,
        OverrideSaved, ServiceAlias, UnresolvedServices,
    },
};

#[utoipa::path(
    get,
    path = "/{org_id}/service_identity/envs",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceEnvs",
    summary = "List service environments",
    description = "Lists the environments seen in the last window with their service and scope counts.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("where" = Option<String>, Query, description = "Scope key; adds its per-service counts"),
        ("service" = Option<String>, Query, description = "Service name, with where"),
    ),
    responses(
        (status = 200, description = "Environments", content_type = "application/json", body = EnvList),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn envs(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "GET").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::envs(&ctx, &params).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, params);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/service_identity/unresolved",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListUnresolvedServices",
    summary = "List services with no resolved version or name",
    description = "Lists scopes that report no version and services without a real name.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("limit" = Option<usize>, Query, description = "Rows per list, 1 to 1000 (default 100)"),
    ),
    responses(
        (status = 200, description = "Unresolved services", content_type = "application/json", body = UnresolvedServices),
        (status = 400, description = "Invalid pagination"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn unresolved(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "GET").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::unresolved(&ctx, &params).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, params);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/service_identity/overrides",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceEnvOverrides",
    summary = "List service environment overrides",
    description = "Lists the environment overrides the caller can read, with the services and versions each relabels.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("scope" = Option<String>, Query, description = "Keep only this override scope"),
        ("q" = Option<String>, Query, description = "Text the value, service or scope key contains"),
        ("limit" = Option<usize>, Query, description = "Page size, 1 to 1000 (default 50)"),
        ("offset" = Option<usize>, Query, description = "Rows to skip (default 0)"),
    ),
    responses(
        (status = 200, description = "Overrides", content_type = "application/json", body = OverrideList),
        (status = 400, description = "Invalid pagination"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn overrides(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "GET").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::overrides(&ctx, &params).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, params);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/service_identity/overrides",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "PutServiceEnvOverride",
    summary = "Set a service environment override",
    description = "Sets the environment of a scope; a value equal to the inferred environment removes the override.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::service_identity::OverrideWrite, content_type = "application/json"),
    responses(
        (status = 200, description = "Override saved", content_type = "application/json", body = OverrideSaved),
        (status = 400, description = "Invalid override"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_override(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<config::meta::service_identity::OverrideWrite>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "PUT").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::put_override(&ctx, request, &user.user_id).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, request);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/service_identity/overrides/{rule_key}",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "DeleteServiceEnvOverride",
    summary = "Remove a service environment override",
    description = "Removes an override, so the scope returns to its inferred environment.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("rule_key" = String, Path, description = "Override key"),
    ),
    responses(
        (status = 200, description = "Override removed", content_type = "application/json", body = OverrideRemoved),
        (status = 404, description = "Override not found"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_override(
    Path((org, key)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "PUT").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::delete_override(&ctx, &key, &user.user_id).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, key);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/service_identity/aliases",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceAliases",
    summary = "List service name aliases",
    description = "Lists service name aliases with their status and confidence.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("kind" = Option<String>, Query, description = "rename, rum_service or k8s_workload"),
        ("status" = Option<String>, Query, description = "proposed, active, rejected or accepted"),
        ("confidence" = Option<String>, Query, description = "high, medium or low"),
        ("q" = Option<String>, Query, description = "Text the alias or canonical name contains, ignoring case"),
        ("limit" = Option<usize>, Query, description = "Page size, 1 to 1000 (default 50)"),
        ("offset" = Option<usize>, Query, description = "Rows to skip (default 0)"),
    ),
    responses(
        (status = 200, description = "Aliases and their total", content_type = "application/json", body = AliasList),
        (status = 400, description = "Invalid filter"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_aliases(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::list(&org, &user.user_id, &params).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, params);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/service_identity/aliases",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "CreateServiceAlias",
    summary = "Create a service name alias",
    description = "Creates an alias that maps a service name onto a canonical one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = AliasCreate, content_type = "application/json"),
    responses(
        (status = 201, description = "Alias created", content_type = "application/json", body = ServiceAlias),
        (status = 400, description = "Invalid alias"),
        (status = 409, description = "Display-name collision"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_alias(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<AliasCreate>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::create(&org, &user.user_id, request).await {
            Ok(value) => (StatusCode::CREATED, axum::Json(value)).into_response(),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, request);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/service_identity/aliases/{alias_key}",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "UpdateServiceAlias",
    summary = "Update a service name alias",
    description = "Accepts, rejects or edits one alias.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alias_key" = String, Path, description = "Alias key"),
    ),
    request_body(content = AliasUpdate, content_type = "application/json"),
    responses(
        (status = 200, description = "Alias updated", content_type = "application/json", body = ServiceAlias),
        (status = 400, description = "Invalid alias"),
        (status = 404, description = "Alias not found"),
        (status = 409, description = "Display-name collision"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_alias(
    Path((org, key)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<AliasUpdate>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::update(&org, &user.user_id, &key, request).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, key, request);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/service_identity/aliases/{alias_key}",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "DeleteServiceAlias",
    summary = "Delete a service name alias",
    description = "Deletes one alias.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alias_key" = String, Path, description = "Alias key"),
    ),
    responses(
        (status = 204, description = "Alias deleted"),
        (status = 404, description = "Alias not found"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_alias(
    Path((org, key)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::delete(&org, &user.user_id, &key).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, key);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/service_identity/aliases/_bulk",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "BulkServiceAliases",
    summary = "Accept or reject service name aliases in bulk",
    description = "Accepts or rejects the aliases given by key or by filter; the result's batch_id undoes the change.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = AliasBulk, content_type = "application/json"),
    responses(
        (status = 200, description = "Bulk accept or reject result", content_type = "application/json", body = AliasBulkResult),
        (status = 400, description = "Invalid bulk request"),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn bulk_aliases(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<AliasBulk>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::bulk(&org, &user.user_id, request).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, request);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/service_identity/aliases/_undo",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "UndoServiceAliases",
    summary = "Undo a bulk service name alias change",
    description = "Restores the aliases a bulk change touched.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = AliasUndo, content_type = "application/json"),
    responses(
        (status = 200, description = "Rows restored", content_type = "application/json", body = AliasesRestored),
        (status = 403, description = "Forbidden"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn undo_aliases(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<AliasUndo>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match aliases::undo(&org, &user.user_id, request).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user, request);
        HttpResponse::forbidden("Service versions require the enterprise build")
    }
}

#[cfg(all(test, not(feature = "enterprise")))]
mod tests {
    use super::*;

    fn user() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: "reader@example.com".into(),
        })
    }

    #[tokio::test]
    async fn oss_identity_routes_require_enterprise() {
        let request = serde_json::from_value(serde_json::json!({"scope":"service","service_name":"svc","where_key":"env:prod","value":"prod"})).unwrap();
        let responses = [
            envs(Path("org".into()), user(), Query(BTreeMap::new())).await,
            unresolved(Path("org".into()), user(), Query(BTreeMap::new())).await,
            overrides(Path("org".into()), user(), Query(BTreeMap::new())).await,
            put_override(Path("org".into()), user(), axum::Json(request)).await,
            delete_override(Path(("org".into(), "key".into())), user()).await,
            list_aliases(Path("org".into()), user(), Query(BTreeMap::new())).await,
            create_alias(
                Path("org".into()),
                user(),
                axum::Json(
                    serde_json::from_value(
                        serde_json::json!({"kind":"rename","alias":"a","canonical":"b"}),
                    )
                    .unwrap(),
                ),
            )
            .await,
            update_alias(
                Path(("org".into(), "key".into())),
                user(),
                axum::Json(serde_json::from_value(serde_json::json!({"status":"active"})).unwrap()),
            )
            .await,
            delete_alias(Path(("org".into(), "key".into())), user()).await,
            bulk_aliases(
                Path("org".into()),
                user(),
                axum::Json(
                    serde_json::from_value(
                        serde_json::json!({"action":"accept","alias_keys":["k"]}),
                    )
                    .unwrap(),
                ),
            )
            .await,
            undo_aliases(
                Path("org".into()),
                user(),
                axum::Json(serde_json::from_value(serde_json::json!({"batch_id":"b"})).unwrap()),
            )
            .await,
        ];
        for response in responses {
            assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert!(
                String::from_utf8(body.to_vec())
                    .unwrap()
                    .contains("Service versions require the enterprise build")
            );
        }
    }
}

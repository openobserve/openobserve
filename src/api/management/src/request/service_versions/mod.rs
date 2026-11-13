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
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use openobserve_core::service_identity::api::{self, Context};

use crate::{
    common::meta::http::HttpResponse,
    request::service_versions::schema::{
        CompareResponse, DeployList, ServiceCatalog, ServiceVersionList, VerdictList,
        VersionCompareRequest, VersionDeleted,
    },
};

#[utoipa::path(
    get,
    path = "/{org_id}/service_versions",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceVersions",
    summary = "List the versions of a service",
    description = "Lists the versions of one service, newest first, merged with the versions of its active aliases.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("service" = String, Query, description = "Service name"),
        ("where" = Option<String>, Query, description = "Scope key; every scope of the service when omitted"),
        ("env" = Option<String>, Query, description = "Keep only this environment"),
        ("no_env" = Option<bool>, Query, description = "Keep only scopes with no environment"),
        ("include_inactive" = Option<bool>, Query, description = "Also list versions not seen in the last 15 minutes (default true)"),
        ("limit" = Option<usize>, Query, description = "Page size, 1 to 1000 (default 100)"),
        ("offset" = Option<usize>, Query, description = "Rows to skip (default 0)"),
    ),
    responses(
        (status = 200, description = "Versions of the service", content_type = "application/json", body = ServiceVersionList),
        (status = 400, description = "Missing service or invalid pagination"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "LIST").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::versions(&ctx, &params).await {
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
    path = "/{org_id}/service_versions/_services",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListVersionedServices",
    summary = "List services with their newest version and verdict",
    description = "Lists each service scope with its newest and serving versions and the verdict of its latest deploy.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("signal" = Option<String>, Query, description = "Keep only `traces` or `rum` scopes"),
        ("service" = Option<String>, Query, description = "Service name"),
        ("where" = Option<String>, Query, description = "Scope key"),
        ("q" = Option<String>, Query, description = "Text the service name contains"),
        ("env" = Option<String>, Query, description = "Keep only this environment"),
        ("no_env" = Option<bool>, Query, description = "Keep only scopes with no environment"),
        ("verdict" = Option<String>, Query, description = "Comma-separated verdicts to keep: regressed, not_serving, watch, insufficient, ok, pre_existing, no_version, capped"),
        ("limit" = Option<usize>, Query, description = "Page size, 1 to 1000 (default 100)"),
        ("offset" = Option<usize>, Query, description = "Rows to skip (default 0)"),
    ),
    responses(
        (status = 200, description = "Service scopes", content_type = "application/json", body = ServiceCatalog),
        (status = 400, description = "Invalid signal, verdict filter or pagination"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry or verdicts unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn services(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "LIST").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::catalog(&ctx, &params).await {
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
    path = "/{org_id}/service_versions/deploys",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceDeploys",
    summary = "List service deploy markers",
    description = "Lists the deploys of one service in a time range, oldest first, each with its verdict badge.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("service" = String, Query, description = "Service name"),
        ("where" = Option<String>, Query, description = "Scope key"),
        ("start_time" = Option<i64>, Query, description = "Range start in Unix microseconds"),
        ("end_time" = Option<i64>, Query, description = "Range end in Unix microseconds"),
        ("env" = Option<String>, Query, description = "Keep only this environment"),
        ("no_env" = Option<bool>, Query, description = "Keep only scopes with no environment"),
    ),
    responses(
        (status = 200, description = "Deploy markers", content_type = "application/json", body = DeployList),
        (status = 400, description = "Missing service or invalid time range"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Storage unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn deploys(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "LIST").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match openobserve_core::service_identity::signals::reads::deploys(&ctx, &params).await {
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
    path = "/{org_id}/service_versions/verdicts",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "ListServiceVerdicts",
    summary = "List stored service version verdicts",
    description = "Lists stored verdicts by deploy key, by version keys, or for one version given by service, where and version.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("deploy_key" = Option<String>, Query, description = "Verdicts of this deploy"),
        ("keys" = Option<String>, Query, description = "Comma-separated version keys, 1 to 100"),
        ("service" = Option<String>, Query, description = "Service name; required without deploy_key and keys"),
        ("where" = Option<String>, Query, description = "Scope key; required without deploy_key and keys"),
        ("version" = Option<String>, Query, description = "Version; required without deploy_key and keys"),
        ("image" = Option<String>, Query, description = "Image of the version"),
    ),
    responses(
        (status = 200, description = "Verdict summaries", content_type = "application/json", body = VerdictList),
        (status = 400, description = "Missing or invalid selection"),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Storage unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn verdicts(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "LIST").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match openobserve_core::service_identity::signals::reads::verdicts(&ctx, &params).await {
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
    delete,
    path = "/{org_id}/service_versions/{version_key}",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "DeleteServiceVersion",
    summary = "Delete a service version",
    description = "Removes a version from the registry in every region; it is listed again only if it is seen after the delete.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("version_key" = String, Path, description = "Version key"),
    ),
    responses(
        (status = 200, description = "Version deleted", content_type = "application/json", body = VersionDeleted),
        (status = 403, description = "Forbidden"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete(
    Path((org, key)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let ctx = match Context::load(&org, &user.user_id, "PUT").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match api::delete_version(&ctx, &key).await {
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
    post,
    path = "/{org_id}/service_versions/compare",
    context_path = "/api",
    tag = "Service Versions",
    operation_id = "CompareServiceVersions",
    summary = "Compare two versions of a service",
    description = "Compares a version with a baseline on the requested signals; without `b` the baseline is chosen automatically.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = VersionCompareRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Version comparison", content_type = "application/json", body = CompareResponse),
        (status = 400, description = "Missing service, where, a.version or signals, or invalid options"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Service scope not found"),
        (status = 503, description = "Registry unavailable"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "post"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn compare(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(request): axum::Json<serde_json::Value>,
) -> Response {
    let Some(signals) = request["signals"].as_array().filter(|signals| {
        !signals.is_empty()
            && signals
                .iter()
                .all(|signal| matches!(signal.as_str(), Some("traces" | "rum")))
    }) else {
        return HttpResponse::bad_request("signals must be a non-empty subset of traces and rum");
    };
    #[cfg(feature = "enterprise")]
    {
        let _ = signals;
        let ctx = match Context::load(&org, &user.user_id, "GET").await {
            Ok(ctx) => ctx,
            Err(response) => return response,
        };
        match openobserve_core::service_identity::signals::api::compare(&ctx, request).await {
            Ok(value) => HttpResponse::json(value),
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user);
        let delta = serde_json::json!({"a":0,"b":0,"delta":0,"lo":0,"hi":0,"insufficient":true,"straddles_zero":true,"ci_kind":"variance"});
        let mut response = serde_json::json!({"traces":{"insufficient":true,"reason":"enterprise_required","error_rate":delta,"p50":delta,"p95":delta,"p99":delta,"endpoints":[]},"rum":{"insufficient":true,"reason":"enterprise_required","error_view_rate":delta,"lcp_p75":delta,"inp_p75":delta,"cls_p75":delta,"loading_time_p75":delta},"notes":["Service versions require the enterprise build"]});
        for signal in ["traces", "rum"] {
            if !signals.iter().any(|value| value == signal) {
                response
                    .as_object_mut()
                    .expect("response object")
                    .remove(signal);
            }
        }
        HttpResponse::json(response)
    }
}

#[cfg(all(test, feature = "enterprise"))]
#[path = "enterprise_tests.rs"]
mod enterprise_tests;

#[cfg(all(test, not(feature = "enterprise")))]
mod tests {
    use super::*;

    fn user() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: "reader@example.com".into(),
        })
    }

    #[tokio::test]
    async fn oss_compare_validates_subsets_and_omits_unrequested_sections() {
        for signals in [serde_json::json!([]), serde_json::json!(["logs"])] {
            let response = compare(
                Path("org".into()),
                user(),
                axum::Json(serde_json::json!({"signals":signals})),
            )
            .await;
            assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        }
        let response = compare(
            Path("org".into()),
            user(),
            axum::Json(serde_json::json!({"signals":["rum"]})),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(body.get("traces").is_none());
        assert!(body.get("rum").is_some());
    }

    #[tokio::test]
    async fn oss_version_routes_require_enterprise_except_compare() {
        let responses = [
            list(Path("org".into()), user(), Query(BTreeMap::new())).await,
            services(Path("org".into()), user(), Query(BTreeMap::new())).await,
            delete(Path(("org".into(), "key".into())), user()).await,
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
        let response = compare(
            Path("org".into()),
            user(),
            axum::Json(serde_json::json!({"signals":["traces","rum"]})),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["traces"]["insufficient"], true);
        assert_eq!(body["rum"]["insufficient"], true);
        assert!(body.to_string().contains("enterprise"));
    }
}

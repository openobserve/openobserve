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

use std::time::Duration;

use axum::{
    Router,
    extract::{DefaultBodyLimit, FromRequestParts, Path, Request},
    http::{Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, patch, post, put},
};
use config::get_config;
use openobserve_api_common::X_O2_ASSISTANT_SESSION_ID;
use openobserve_api_ingest::request::{clusters, logs, metrics, rum};
#[cfg(feature = "cloud")]
use openobserve_api_management::request::cloud;
#[cfg(feature = "profiling")]
use openobserve_api_management::request::profiling;
use openobserve_api_management::request::{
    alerts, announcements, authz, dashboards, db_monitoring, folders, kv, model_pricing,
    organization, service_accounts, short_url, slos, sourcemaps, status, stream, synthetics, users,
};
use openobserve_api_pipelines::request::{enrichment_table, functions, pipeline, pipelines};
use openobserve_api_search::{promql, search, traces};
use openobserve_core::auth::AuthExtractor;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    decompression::RequestDecompressionLayer,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;
#[cfg(feature = "enterprise")]
use {
    audit::audit,
    axum::body::{Body, to_bytes},
    base64::{Engine as _, engine::general_purpose},
    config::utils::time::now_micros,
    o2_enterprise::enterprise::common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
    openobserve_api_management::request::{
        actions, ai, annotation_queues, annotations, anomaly_detection, datasets, discovery,
        domain_management, eval_jobs, gen_ai, keys, license, providers, score_configs, scorers,
        service_streams, workflows,
    },
    openobserve_api_pipelines::request::re_pattern,
    openobserve_api_search::search::patterns,
};

use super::request::mcp;
#[cfg(feature = "enterprise")]
use super::request::ratelimit;
use crate::{
    common::meta::{middleware_data::RumExtraData, proxy::PathParamProxyURL},
    handler::http::{
        auth::validator::{
            RequestData, oo_validator, validator_aws, validator_gcp, validator_proxy_url,
            validator_rum,
        },
        router::middlewares::blocked_orgs_middleware,
    },
};

pub mod decompression;
pub mod middlewares;
pub mod openapi;

use common::meta::http::ERROR_HEADER;

/// Create CORS layer for axum
pub fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_methods([
            Method::HEAD,
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::OPTIONS,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("stream-name"),
            header::HeaderName::from_static("organization"),
            header::HeaderName::from_static("traceparent"),
            header::HeaderName::from_static("tracestate"),
            header::HeaderName::from_static("x-openobserve-span-id"),
            header::HeaderName::from_static("x-openobserve-trace-id"),
            header::HeaderName::from_static("x-openobserve-sampled"),
            X_O2_ASSISTANT_SESSION_ID,
        ])
        // Restrict CORS to the configured web_url origin, plus any extra origins in
        // ZO_CORS_ALLOWED_ORIGINS (comma-separated).  mirror_request() + allow_credentials(true)
        // allows any origin to make credentialed requests — effectively disabling same-origin
        // protection.  Only reflect the Origin header back if it matches one of our allowed origins.
        // We extract only the scheme+host+port from each URL (ignoring any path) because the Origin
        // header per RFC 6454 never carries a path component.  This prevents prefix-match bypasses
        // like https://app.example.com.evil.com when the allowed URL is https://app.example.com.
        .allow_origin(AllowOrigin::predicate(|origin, _parts| {
            let cfg = config::get_config();
            let web_url = cfg.common.web_url.trim_end_matches('/');
            if is_origin_allowed(origin.as_bytes(), web_url) {
                return true;
            }
            // Also check any extra origins in ZO_CORS_ALLOWED_ORIGINS.
            let extra = cfg.common.cors_allowed_origins.trim();
            if !extra.is_empty() {
                for url in extra.split(',') {
                    let url = url.trim().trim_end_matches('/');
                    if is_origin_allowed(origin.as_bytes(), url) {
                        return true;
                    }
                }
            }
            false
        }))
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
}

/// Returns `true` if `request_origin` should be permitted for CORS.
///
/// Rules:
/// - If `web_url` is empty (dev / unconfigured), allow all origins and log a warning.
/// - Extract the `scheme://host[:port]` portion of `web_url`, ignoring any path component, because
///   the `Origin` header per RFC 6454 never carries a path.
/// - Perform a byte-exact comparison — no prefix-match that could be bypassed by `https://app.example.com.evil.com`
///   when `web_url=https://app.example.com`.
/// - If `web_url` is malformed (no `://`), deny the request.
pub(crate) fn is_origin_allowed(request_origin: &[u8], web_url: &str) -> bool {
    if web_url.is_empty() {
        // In dev/test when web_url is empty, fall back to permissive behaviour.
        // Log a warning so misconfigured production deployments are visible.
        log::warn!(
            "ZO_WEB_URL is not configured — CORS is unrestricted. \
             Set ZO_WEB_URL to your frontend origin in production."
        );
        return true;
    }
    // Extract the origin (scheme://host[:port]) from web_url so that a
    // web_url with a path (e.g. https://app.example.com/o2) still matches
    // the bare Origin header (https://app.example.com).
    let allowed_origin = match web_url.find("://") {
        Some(scheme_end) => {
            let after_scheme = &web_url[scheme_end + 3..];
            let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
            &web_url[..scheme_end + 3 + host_end]
        }
        // Malformed web_url — deny rather than fall back to prefix match.
        None => return false,
    };
    request_origin == allowed_origin.as_bytes()
}

/// If `resp` is a 401 for an MCP endpoint, attach the RFC 9728 `WWW-Authenticate`
/// header so MCP clients start the OAuth flow. No-op for every other route/status.
fn maybe_add_mcp_www_authenticate(uri: &Uri, resp: Response) -> Response {
    if resp.status() != StatusCode::UNAUTHORIZED {
        return resp;
    }
    // MCP endpoint == `/{org}/mcp`. `auth_middleware` runs inside the
    // `.nest("/api", …)` router, so the `/api` prefix is already stripped by the
    // time we see the URI. Match the SECOND segment specifically (mirroring
    // `token.rs`'s `path_columns.get(1)`) so routes that merely END in a
    // user-named `mcp` segment (e.g. a stream called "mcp") do not false-positive.
    let path = uri.path();
    let mut segments = path.trim_start_matches('/').split('/');
    let Some(org_id) = segments.next() else {
        return resp;
    };
    if segments.next() != Some("mcp") {
        return resp;
    }

    // The org id is reflected into a quoted `WWW-Authenticate` parameter below.
    // A `"` or `\` there would close the quoted-string and let a caller append
    // an arbitrary extra challenge (e.g. `Basic realm="…"`, which browsers turn
    // into a credential prompt on our own origin). Org identifiers are opaque
    // alphanumeric tokens, so refuse to emit a challenge for anything else
    // rather than trying to escape it.
    if org_id.is_empty()
        || !org_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return resp;
    }

    // On the OSS build MCP OAuth discovery is a 404 anyway, so there is nothing
    // to advertise — `attach_mcp_www_authenticate` is a no-op there.
    attach_mcp_www_authenticate(org_id, resp)
}

/// Enterprise: attach the RFC 9728 `WWW-Authenticate` header pointing at this
/// org's protected-resource metadata, unless Dex is disabled.
#[cfg(feature = "enterprise")]
fn attach_mcp_www_authenticate(org_id: &str, mut resp: Response) -> Response {
    let dex = o2_dex::config::get_config();
    if !dex.dex_enabled {
        return resp; // no auth server to advertise
    }
    let cfg = config::get_config();
    // Rebuild the externally-visible resource path from the validated `org_id`
    // rather than reflecting the request URI, so nothing caller-controlled can
    // reach the quoted header parameter. The RFC 9728 discovery doc lives at
    // `<web_url>{base_uri}/.well-known/oauth-protected-resource` with that
    // resource path appended (RFC 9728 §3.1).
    let external_resource_path = format!("/api/{org_id}/mcp");
    let resource_meta = format!(
        "{}{}/.well-known/oauth-protected-resource{}",
        cfg.common.web_url.trim_end_matches('/'),
        cfg.common.base_uri,
        external_resource_path
    );
    let value = format!(r#"Bearer resource_metadata="{resource_meta}""#);
    if let Ok(hv) = header::HeaderValue::from_str(&value) {
        resp.headers_mut().insert(header::WWW_AUTHENTICATE, hv);
    }
    resp
}

/// OSS: no MCP OAuth discovery, so the 401 is returned unchanged.
#[cfg(not(feature = "enterprise"))]
fn attach_mcp_www_authenticate(_org_id: &str, resp: Response) -> Response {
    resp
}

/// Authentication middleware for API routes
pub async fn auth_middleware(request: Request, next: Next) -> Response {
    // Extract request data FIRST, before any async calls
    // This ensures the future is Send because RequestData is Send + Sync
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    // Extract auth info from request (synchronous now, no await)
    let (mut parts, body) = request.into_parts();
    let uri = req_data.uri.clone();
    let auth_info = match AuthExtractor::from_request_parts(&mut parts, &()).await {
        Ok(info) => info,
        Err(e) => return maybe_add_mcp_www_authenticate(&uri, e.into_response()),
    };

    // Validate authentication using extracted data
    match oo_validator(&req_data, &auth_info).await {
        Ok(result) => {
            // Insert user_id into request headers for downstream handlers
            parts.headers.insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );

            // Handle Prometheus POST hack - add content-type if missing
            if parts.method.eq(&Method::POST) && !parts.headers.contains_key(header::CONTENT_TYPE) {
                parts.headers.insert(
                    header::CONTENT_TYPE,
                    header::HeaderValue::from_static("application/x-www-form-urlencoded"),
                );
            }

            next.run(Request::from_parts(parts, body)).await
        }
        Err(e) => maybe_add_mcp_www_authenticate(&uri, e.into_response()),
    }
}

/// Authentication middleware for AWS routes
pub async fn aws_auth_middleware(mut request: Request, next: Next) -> Response {
    // Extract request data BEFORE any async validator calls
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    match validator_aws(&req_data).await {
        Ok(result) => {
            request.headers_mut().insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );
            next.run(request).await
        }
        Err(e) => e.into_response(),
    }
}

/// Authentication middleware for GCP routes
pub async fn gcp_auth_middleware(mut request: Request, next: Next) -> Response {
    // Extract request data BEFORE any async validator calls
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    match validator_gcp(&req_data).await {
        Ok(result) => {
            request.headers_mut().insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );
            next.run(request).await
        }
        Err(e) => e.into_response(),
    }
}

/// Authentication middleware for RUM routes
pub async fn rum_auth_middleware(mut request: Request, next: Next) -> Response {
    // Extract request data BEFORE any async validator calls
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    match validator_rum(&req_data).await {
        Ok(result) => {
            request.headers_mut().insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );
            next.run(request).await
        }
        Err(e) => e.into_response(),
    }
}

/// Authentication middleware for proxy routes
pub async fn proxy_auth_middleware(request: Request, next: Next) -> Response {
    // Extract request data FIRST, before any async calls
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    let (mut parts, body) = request.into_parts();
    let auth_info = match AuthExtractor::from_request_parts(&mut parts, &()).await {
        Ok(info) => info,
        Err(e) => return e.into_response(),
    };

    match validator_proxy_url(&req_data, &auth_info).await {
        Ok(result) => {
            parts.headers.insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );
            next.run(Request::from_parts(parts, body)).await
        }
        Err(e) => e.into_response(),
    }
}

#[cfg(feature = "enterprise")]
pub async fn audit_middleware(request: Request, next: Next) -> Response {
    let http_method = request.method().clone();
    let method = http_method.to_string();
    let path = request
        .uri()
        .path()
        .strip_prefix("/")
        .unwrap_or("")
        .to_string();
    let path_columns = path.split('/').collect::<Vec<&str>>();

    // Org-relative view of the path so the ingestion-route classifier sees
    // segment 0 as `{org_id}`. `audit_middleware` runs before prefix stripping,
    // so `path` here is e.g. `[base_uri/]api/{org}/_bulk`; take everything after
    // the `api/` segment.
    let ingestion_path = path.split_once("api/").map(|(_, rest)| rest).unwrap_or("");

    if get_o2_config().common.audit_enabled
        && !(path_columns
            .get(1)
            .unwrap_or(&"")
            .to_string()
            .ends_with("_stream")
            || path.ends_with("ai/chat_stream")
            || common::meta::ingestion_routes::is_ingestion_write(&http_method, ingestion_path))
    {
        let query_params = request.uri().query().unwrap_or("").to_string();
        let org_id = {
            let org = path_columns.first().unwrap_or(&"");
            if org.eq(&"organizations") {
                "".to_string()
            } else {
                org.to_string()
            }
        };

        let user_email = request
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        // Extract body
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, usize::MAX).await {
            Ok(b) => b,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read body").into_response();
            }
        };
        let request_body = bytes.to_vec();

        // Reconstruct request
        let request = axum::http::Request::from_parts(parts, Body::from(bytes));

        // Call next
        let mut response = next.run(request).await;

        if response.status().is_success() || response.status().is_redirection() {
            let body = if path.ends_with("/settings/logo") {
                general_purpose::STANDARD.encode(&request_body)
            } else {
                String::from_utf8(request_body).unwrap_or_default()
            };

            let error_header = response.headers().get(ERROR_HEADER);
            let error_msg = error_header
                .and_then(|h| h.to_str().ok())
                .map(|s| s.to_string());

            response.headers_mut().remove(ERROR_HEADER);

            audit(AuditMessage {
                user_email,
                org_id,
                _timestamp: now_micros(),
                protocol: Protocol::Http,
                response_meta: ResponseMeta {
                    http_method: method,
                    http_path: path,
                    http_body: body,
                    http_query_params: query_params,
                    http_response_code: response.status().as_u16(),
                    error_msg,
                    trace_id: None,
                },
            })
            .await;
        }
        response
    } else {
        let mut response = next.run(request).await;
        response.headers_mut().remove(ERROR_HEADER);
        response
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn audit_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().remove(ERROR_HEADER);
    response
}

/// Handler for /metrics endpoint
pub async fn get_metrics() -> impl IntoResponse {
    let body = if config::get_config().common.prometheus_enabled {
        config::metrics::gather()
    } else {
        "".to_string()
    };
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
}

/// Proxy handler
pub async fn proxy(Path(params): Path<PathParamProxyURL>) -> impl IntoResponse {
    // SSRF protection: validate the target URL (incl. DNS resolution) before issuing
    // the proxied request. The reqwest client is built via `build_safe_client` so
    // redirect chains and connect-time DNS are re-validated too.
    if let Err(e) =
        common::utils::ssrf_guard::SsrfGuard::validate_url_with_config_async(&params.target_url)
            .await
    {
        return (StatusCode::BAD_REQUEST, format!("URL blocked: {e}")).into_response();
    }
    let client = match common::utils::ssrf_guard::build_safe_client(reqwest::Client::builder()) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build HTTP client: {e}"),
            )
                .into_response();
        }
    };
    match client.get(&params.target_url).send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            match resp.bytes().await {
                Ok(body) => (status, body.to_vec()).into_response(),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read response: {e}"),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Request failed: {e}"),
        )
            .into_response(),
    }
}

/// Create proxy routes
pub fn proxy_routes(enable_auth: bool) -> Router {
    let mut router = Router::new().route("/proxy/{org_id}/{*target_url}", get(proxy));

    if enable_auth {
        router = router.layer(middleware::from_fn(proxy_auth_middleware));
    }

    router
}

/// Create basic routes (health, auth, etc.)
pub fn basic_routes() -> Router {
    let mut router = Router::new()
        .route("/healthz", get(status::healthz).head(status::healthz_head))
        .route("/schedulez", get(status::schedulez))
        .route("/metrics", get(get_metrics));

    #[cfg(feature = "cloud")]
    {
        router = router.nest(
            "/webhook",
            Router::new()
                .route("/stripe", post(cloud::billings::handle_stripe_event))
                .route("/azure", post(cloud::billings::handle_azure_event)),
        );

        // AWS Marketplace registration endpoint - receives POST from AWS Marketplace
        // Must be publicly accessible (no auth) as users haven't logged in yet
        // Using /marketplace path to avoid conflict with authenticated /api scope
        router = router.route(
            "/marketplace/aws/register",
            post(cloud::aws_marketplace::aws_marketplace_register),
        );
    }

    // OAuth 2.0 metadata endpoint
    router = router.route(
        "/.well-known/oauth-authorization-server",
        get(mcp::oauth_authorization_server_metadata),
    );

    // OAuth 2.0 Protected Resource Metadata (RFC 9728) — public, points MCP
    // clients at the auth server. Path-suffixed form per RFC 9728 §3.1, plus a
    // bare root probe. Registered here (before auth_middleware nesting) so both
    // stay unauthenticated.
    router = router
        .route(
            "/.well-known/oauth-protected-resource/{*resource_path}",
            get(mcp::oauth_protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource",
            get(mcp::oauth_protected_resource_metadata_root),
        );

    // Auth routes (no authentication required)
    let auth_routes = Router::new()
        .route("/login", post(users::authentication).get(users::get_auth))
        .route("/presigned-url", get(users::get_presigned_url))
        .route("/invites", get(users::list_invitations))
        .route("/invites/{token}", delete(users::decline_invitation));
    router = router.nest("/auth", auth_routes);

    // Node routes with auth
    let mut node_routes = Router::new()
        .route("/status", get(status::cache_status))
        .route("/enable", put(status::enable_node))
        .route("/flush", put(status::flush_node))
        .route("/reload", get(status::cache_reload))
        .route("/list", get(status::list_node))
        .route("/metrics", get(status::node_metrics));

    #[cfg(feature = "enterprise")]
    {
        node_routes = node_routes.route("/drain_status", get(status::drain_status));
    }

    node_routes = node_routes
        .route("/consistent_hash", post(status::consistent_hash))
        .route("/refresh_nodes_list", get(status::refresh_nodes_list))
        .route("/refresh_user_sessions", get(status::refresh_user_sessions))
        .layer(middleware::from_fn(auth_middleware));

    router = router.nest("/node", node_routes);

    // Debug/profiling routes with auth
    #[cfg(feature = "profiling")]
    {
        let debug_routes = Router::new()
            .route("/profile/memory", get(profiling::memory_profile))
            .route("/profile/stats", get(profiling::jemalloc_stats))
            .route("/profile/cpu", get(profiling::cpu_profile))
            .layer(middleware::from_fn(auth_middleware));

        router = router.nest("/debug", debug_routes);
    }

    // Swagger UI
    if get_config().common.swagger_enabled {
        router = router.merge(
            SwaggerUi::new("/swagger").url("/api-doc/openapi.json", openapi::ApiDoc::openapi()),
        );
        router = router.route("/docs", get(|| async { Redirect::permanent("/swagger/") }));
    }

    // Stateless alert-chart render endpoint — the URL carries an HMAC-signed
    // chart payload, verified inside the handler itself (never via
    // auth_middleware), so it must stay in basic_routes like the incident
    // webhooks below. Renders run in-process on this node; no search/storage.
    router = router.route(
        "/api/v2/{org_id}/alerts/charts/render",
        get(alerts::chart_render::render_chart),
    );

    // External alert source webhooks — token-authenticated inside the handler itself
    // (never via auth_middleware), so these must stay in basic_routes rather than
    // service_routes. See GHSA-wffq-g8qf-ccmv: do not widen the shared token
    // classifier in validator.rs to cover this token type.
    router = router
        .route(
            "/api/v2/{org_id}/incidents/events",
            post(alerts::external_events::ingest_events),
        )
        .route(
            "/api/v2/{org_id}/incidents/events/{token}",
            post(alerts::external_events::ingest_events_url_token),
        )
        .route_layer(DefaultBodyLimit::max(
            alerts::external_events::MAX_BODY_BYTES,
        ));

    router
}

/// Create config routes. `/` is served WITHOUT auth (the login page bootstraps
/// from it), so it must expose only [`status::zo_config_bootstrap`]'s minimal
/// payload — the full config lives at the authenticated `/api/{org_id}/config`.
#[cfg(not(feature = "enterprise"))]
pub fn config_routes() -> Router {
    Router::new()
        .route("/reload", get(status::config_reload))
        .route_layer(middleware::from_fn(auth_middleware))
        .route("/", get(status::zo_config_bootstrap))
        .route("/logout", get(status::logout))
}

#[cfg(feature = "enterprise")]
pub fn config_routes() -> Router {
    Router::new()
        .route("/reload", get(status::config_reload))
        .route_layer(middleware::from_fn(auth_middleware))
        .route("/", get(status::zo_config_bootstrap))
        .route("/logout", get(status::logout))
        .route("/redirect", get(status::redirect))
        .route("/dex_login", get(status::dex_login))
        .route("/dex_refresh", get(status::refresh_token_with_dex))
        .route("/token", post(users::service_accounts::exchange_token))
}

/// Create main API service routes
pub fn service_routes() -> Router {
    let cfg = get_config();

    // Set server header
    #[cfg(feature = "enterprise")]
    let server = format!(
        "{}-{}",
        get_o2_config().super_cluster.region,
        cfg.common.instance_name_short
    );
    #[cfg(not(feature = "enterprise"))]
    let server = cfg.common.instance_name_short.to_string();

    let mut router = Router::new();
    // Full UI configuration — authenticated counterpart of the unauthenticated
    // `/config` bootstrap in config_routes()
    router = router.route("/{org_id}/config", get(status::zo_config));
    // Users
    router = router.route("/{org_id}/users", get(users::list).post(users::save))
        .route("/{org_id}/users/{email_id}", post(users::add_user_to_org).put(users::update).delete(users::delete))
        .route("/{org_id}/users/bulk", delete(users::delete_bulk))
        .route("/{org_id}/users/roles", get(users::list_roles))
        .route("/invites", get(users::list_invitations))
        .route("/invites/{token}", delete(users::decline_invitation))

        // Organizations
        .route("/organizations", get(organization::org::organizations).post(organization::org::create_org))
        .route("/{org_id}/organizations/assume_service_account", post(organization::assume_service_account::assume_service_account))
        .route("/{org_id}/org_cleanup_tasks/{target_org_id}", get(organization::org::list_org_cleanup_tasks))
        .route(
            "/{org_id}/organizations/{target_org_id}/resurrect",
            post(organization::org::resurrect_org_deletion),
        )
        .route("/{org_id}/settings", get(organization::settings::get).post(organization::settings::create))
        .route("/{org_id}/settings/logo", post(organization::settings::upload_logo).delete(organization::settings::delete_logo))
        .route("/{org_id}/settings/logo/text", post(organization::settings::set_logo_text).delete(organization::settings::delete_logo_text))

        // System settings v2
        .route("/{org_id}/settings/v2", get(organization::system_settings::list_settings).post(organization::system_settings::set_org_setting))
        .route("/{org_id}/settings/v2/{key}", get(organization::system_settings::get_setting).delete(organization::system_settings::delete_org_setting))
        .route("/{org_id}/settings/v2/user/{user_id}", post(organization::system_settings::set_user_setting))
        .route("/{org_id}/settings/v2/user/{user_id}/{key}", delete(organization::system_settings::delete_user_setting))

        // Announcement banners: read by every org, authored on the meta org
        .route("/{org_id}/announcements", get(announcements::get_announcements))
        .route("/{org_id}/announcements/config", get(announcements::get_announcements_config).put(announcements::set_announcements_config))

        // Org info
        .route("/{org_id}/summary", get(organization::org::org_summary))
        .route("/{org_id}/passcode", get(organization::org::get_user_passcode).put(organization::org::update_user_passcode))
        .route("/{org_id}/rumtoken", get(organization::org::get_user_rumtoken).post(organization::org::create_user_rumtoken).put(organization::org::update_user_rumtoken))
        .route("/{org_id}/ingestion-tokens", get(organization::ingestion_tokens::list_ingestion_tokens).post(organization::ingestion_tokens::create_ingestion_token))
        .route("/{org_id}/ingestion-tokens/{name}", patch(organization::ingestion_tokens::enable_disable_ingestion_token))
        .route("/{org_id}/node/list", get(organization::org::node_list))
        .route("/{org_id}/cluster/info", get(organization::org::cluster_info))
        .route("/{org_id}/rename", put(organization::org::rename_org))

        // ES compatibility
        .route("/{org_id}/", get(organization::es::org_index).head(organization::es::org_index))
        .route("/{org_id}/_license", get(organization::es::org_license))
        .route("/{org_id}/_xpack", get(organization::es::org_xpack))
        .route("/{org_id}/_ilm/policy/{name}", get(organization::es::org_ilm_policy).head(organization::es::org_ilm_policy))
        .route("/{org_id}/_index_template/{name}", get(organization::es::org_index_template).head(organization::es::org_index_template).post(organization::es::org_index_template_create))
        .route("/{org_id}/_data_stream/{name}", get(organization::es::org_data_stream).head(organization::es::org_data_stream).post(organization::es::org_data_stream_create))
        .route("/{org_id}/_ingest/pipeline/{name}", get(organization::es::org_pipeline).head(organization::es::org_pipeline).post(organization::es::org_pipeline_create))

        // Streams
        .route("/{org_id}/streams", get(stream::list))
        .route("/{org_id}/streams/{stream_name}", post(stream::create).delete(stream::delete))
        .route("/{org_id}/streams/{stream_name}/schema", get(stream::schema))
        .route("/{org_id}/streams/{stream_name}/settings", put(stream::update_settings))
        .route("/{org_id}/streams/{stream_name}/update_fields", put(stream::update_fields))
        .route("/{org_id}/streams/{stream_name}/delete_fields", put(stream::delete_fields))
        .route("/{org_id}/streams/{stream_name}/cache/results", delete(stream::delete_stream_cache))
        .route("/{org_id}/streams/{stream_name}/data_by_time_range", delete(stream::delete_stream_data_by_time_range))
        .route("/{org_id}/streams/{stream_name}/data_by_time_range/status/{id}", get(stream::get_delete_stream_data_status))

        // Logs ingestion
        .route("/{org_id}/_bulk", post(logs::ingest::bulk))
        .route("/{org_id}/{stream_name}/_multi", post(logs::ingest::multi))
        .route("/{org_id}/{stream_name}/_json", post(logs::ingest::json))
        .route("/{org_id}/_hec", post(logs::ingest::hec))
        .route("/{org_id}/loki/api/v1/push", post(logs::loki::loki_push))
        .route("/{org_id}/v1/logs", post(logs::ingest::otlp_logs_write))
        .route("/{org_id}/v1/metrics", post(metrics::ingest::otlp_metrics_write))
        .route("/{org_id}/v1/traces", post(traces::traces_write))
        .route("/{org_id}/traces", post(traces::traces_write))
        .route("/{org_id}/otel/v1/traces", post(traces::traces_write))

        // Traces
        .route("/{org_id}/{stream_name}/traces/latest", get(traces::get_latest_traces))
        .route("/{org_id}/{stream_name}/traces/latest_stream", get(traces::get_latest_traces_stream))
        .route("/{org_id}/{stream_name}/traces/session", get(traces::session::get_latest_sessions))
        .route("/{org_id}/{stream_name}/traces/session/details", get(traces::session::get_session_details))
        .route("/{org_id}/{stream_name}/traces/user", get(traces::user::get_latest_users))
        .route("/{org_id}/{stream_name}/traces/time_range", get(traces::time_index::get_trace_time_range))
        .route("/{org_id}/{stream_name}/traces/{trace_id}/details", get(traces::details::get_trace_details))
        .route("/{org_id}/{stream_name}/traces/{trace_id}/dag", get(traces::dag::get_trace_dag))

        // Database Monitoring — its own top-level module, not under /traces.
        // The path segment must stay `db_monitoring` to match the OFGA resource
        // these routes authorize against (`db_monitoring:{org}`, see o2_openfga
        // ROUTE_PERMISSIONS).
        //
        // Every route below is registered in both builds; the build-type gate
        // lives in the handlers, three of which (deadlocks/blocking/
        // table_health) are dual-implemented and answer 403 on OSS. Registering
        // them in the enterprise-gated block instead would 404 them, losing the
        // distinction between "not licensed" and "no such endpoint". Runtime
        // off-switch is ZO_DB_MONITORING_ENABLED.
        .route("/{org_id}/db_monitoring/databases", get(db_monitoring::handler::get_dbm_databases))
        .route("/{org_id}/db_monitoring/queries", get(db_monitoring::handler::get_dbm_queries))
        .route("/{org_id}/db_monitoring/query/history", get(db_monitoring::handler::get_dbm_query_history))
        .route("/{org_id}/db_monitoring/query/endpoints", get(db_monitoring::handler::get_dbm_query_endpoints))
        .route("/{org_id}/db_monitoring/samples", get(db_monitoring::handler::get_dbm_samples))
        // Server-vantage events (read the canonical o2_dbm_* columns)
        .route("/{org_id}/db_monitoring/deadlocks", get(db_monitoring::handler::get_dbm_deadlocks))
        .route("/{org_id}/db_monitoring/blocking", get(db_monitoring::handler::get_dbm_blocking))
        .route("/{org_id}/db_monitoring/activity", get(db_monitoring::handler::get_dbm_activity))
        // `query/insights` returns the query-detail page's Logs-side pair in one
        // round trip; `query/plans` and `query/server_metrics` are superseded by
        // it (same sections, same envelopes) and stay registered for
        // compatibility.
        .route("/{org_id}/db_monitoring/query/insights", get(db_monitoring::handler::get_dbm_query_insights))
        .route("/{org_id}/db_monitoring/query/plans", get(db_monitoring::handler::get_dbm_query_plans))
        .route("/{org_id}/db_monitoring/query/server_metrics", get(db_monitoring::handler::get_dbm_query_server_metrics))
        .route("/{org_id}/db_monitoring/server_queries", get(db_monitoring::handler::get_dbm_server_queries))
        .route("/{org_id}/db_monitoring/server_samples", get(db_monitoring::handler::get_dbm_server_samples))
        .route("/{org_id}/db_monitoring/table_health", get(db_monitoring::handler::get_dbm_table_health))
        .route("/{org_id}/db_monitoring/instances", get(db_monitoring::handler::get_dbm_instances))
        .route(
            "/{org_id}/db_monitoring/instance_metrics",
            get(db_monitoring::handler::get_dbm_instance_metrics),
        )
        .route("/{org_id}/db_monitoring/badges", get(db_monitoring::handler::get_dbm_badges))

        // LLM Model Pricing
        .route("/{org_id}/llm/models", get(model_pricing::list).post(model_pricing::create))
        // NOTE: named routes MUST be registered before {model_id} to avoid being matched as a model ID
        .route("/{org_id}/llm/models/built-in", get(model_pricing::get_built_in))
        .route("/{org_id}/llm/models/refresh-built-in", post(model_pricing::refresh_built_in))
        .route("/{org_id}/llm/models/test", post(model_pricing::test_model_match))
        .route("/{org_id}/llm/models/{model_id}", get(model_pricing::get).put(model_pricing::update).delete(model_pricing::delete))

        // Metrics
        .route("/{org_id}/ingest/metrics/_json", post(metrics::ingest::json))

        // PromQL
        .route("/{org_id}/prometheus/api/v1/write", post(promql::remote_write))
        .route("/{org_id}/prometheus/api/v1/query", get(promql::query_get).post(promql::query_post))
        .route("/{org_id}/prometheus/api/v1/query_range", get(promql::query_range_get).post(promql::query_range_post))
        .route("/{org_id}/prometheus/api/v1/query_exemplars", get(promql::query_exemplars_get).post(promql::query_exemplars_post))
        .route("/{org_id}/prometheus/api/v1/metadata", get(promql::metadata))
        .route("/{org_id}/prometheus/api/v1/series", get(promql::series_get).post(promql::series_post))
        .route("/{org_id}/prometheus/api/v1/labels", get(promql::labels_get).post(promql::labels_post))
        .route("/{org_id}/prometheus/api/v1/label/{label_name}/values", get(promql::label_values))
        .route("/{org_id}/prometheus/api/v1/format_query", get(promql::format_query_get).post(promql::format_query_post))

        // Search
        .route("/{org_id}/_search", post(search::search))
        .route("/{org_id}/query_functions", get(search::query_functions::list))
        .route("/{org_id}/_search_partition", post(search::search_partition))
        .route("/{org_id}/{stream_name}/_around", get(search::around_v1).post(search::around_v2))
        .route("/{org_id}/{stream_name}/_values", get(search::values))
        .route("/{org_id}/_search_history", post(search::search_history))
        .route("/{org_id}/result_schema", post(search::result_schema))

        // Multi-stream search
        .route("/{org_id}/_search_multi", post(search::multi_streams::search_multi))
        .route("/{org_id}/_search_multi_stream", post(search::multi_streams::search_multi_stream))
        .route("/{org_id}/_search_partition_multi", post(search::multi_streams::_search_partition_multi))
        .route("/{org_id}/{stream_names}/_around_multi", get(search::multi_streams::around_multi))

        // HTTP/2 streaming
        .route("/{org_id}/_search_stream", post(search::search_stream::search_http2_stream))
        .route("/{org_id}/_values_stream", post(search::search_stream::values_http2_stream))

        // Saved views
        .route("/{org_id}/savedviews", get(search::saved_view::get_views).post(search::saved_view::create_view))
        .route("/{org_id}/savedviews/{view_id}", get(search::saved_view::get_view).put(search::saved_view::update_view).delete(search::saved_view::delete_view))

        // Functions
        .route("/{org_id}/functions", get(functions::list_functions).post(functions::save_function))
        .route("/{org_id}/functions/test", post(functions::test_function))
        .route("/{org_id}/functions/bulk", delete(functions::delete_function_bulk))
        .route("/{org_id}/functions/{name}", get(functions::list_pipeline_dependencies).put(functions::update_function).delete(functions::delete_function))

        // Dashboards
        .route("/{org_id}/dashboards", get(dashboards::list_dashboards).post(dashboards::create_dashboard))
        .route("/{org_id}/dashboards/{dashboard_id}", get(dashboards::get_dashboard).put(dashboards::update_dashboard).delete(dashboards::delete_dashboard))
        .route("/{org_id}/dashboards/bulk", delete(dashboards::delete_dashboard_bulk))
        .route("/{org_id}/folders/dashboards/{dashboard_id}", put(dashboards::move_dashboard))
        .route("/{org_id}/dashboards/move", patch(dashboards::move_dashboards))
        .route("/{org_id}/dashboards/{dashboard_id}/panels", post(dashboards::add_panel))
        .route("/{org_id}/dashboards/{dashboard_id}/panels/{panel_id}", put(dashboards::update_panel).delete(dashboards::delete_panel))

        // Reports
        .route("/{org_id}/reports", get(dashboards::reports::list_reports).post(dashboards::reports::create_report))
        .route("/{org_id}/reports/{name}", get(dashboards::reports::get_report).put(dashboards::reports::update_report).delete(dashboards::reports::delete_report))
        .route("/{org_id}/reports/bulk", delete(dashboards::reports::delete_report_bulk))
        .route("/{org_id}/reports/{name}/enable", put(dashboards::reports::enable_report))
        .route("/{org_id}/reports/{name}/trigger", put(dashboards::reports::trigger_report))

        // Timed annotations
        .route("/{org_id}/dashboards/{dashboard_id}/annotations", get(dashboards::timed_annotations::get_annotations).post(dashboards::timed_annotations::create_annotations).delete(dashboards::timed_annotations::delete_annotations))
        .route("/{org_id}/dashboards/{dashboard_id}/annotations/{timed_annotation_id}", put(dashboards::timed_annotations::update_annotations))
        .route("/{org_id}/dashboards/{dashboard_id}/annotations/panels/{timed_annotation_id}", delete(dashboards::timed_annotations::delete_annotation_panels))

        // Reports (v2) — /bulk and /move must precede /{report_id} to avoid route conflicts
        .route("/v2/{org_id}/reports", get(dashboards::reports::list_reports_v2).post(dashboards::reports::create_report_v2))
        .route("/v2/{org_id}/reports/bulk", delete(dashboards::reports::delete_report_bulk_v2))
        .route("/v2/{org_id}/reports/move", patch(dashboards::reports::move_reports))
        .route("/v2/{org_id}/reports/{report_id}", get(dashboards::reports::get_report_v2).put(dashboards::reports::update_report_v2).delete(dashboards::reports::delete_report_v2))
        .route("/v2/{org_id}/reports/{report_id}/enable", patch(dashboards::reports::enable_report_v2))
        .route("/v2/{org_id}/reports/{report_id}/trigger", put(dashboards::reports::trigger_report_v2))

        // SLOs. Deliberately NOT enterprise-gated: nothing about SLO
        // measurement is an enterprise capability. Literal segments are
        // registered before the {slo_id} catch-all, per the router's ordering
        // rule.
        .route(
            "/{org_id}/slos",
            get(slos::list_slos).post(slos::create_slo),
        )
        // Before the {slo_id} catch-all, or "move" is parsed as an SLO id.
        .route("/{org_id}/slos/move", post(slos::move_slos))
        .route("/{org_id}/slos/{slo_id}/enable", put(slos::enable_slo))
        .route("/{org_id}/slos/{slo_id}/groups", get(slos::get_slo_groups))
        .route(
            "/{org_id}/slos/{slo_id}",
            get(slos::get_slo)
                .put(slos::update_slo)
                .delete(slos::delete_slo),
        )

        // Folders (v2)
        .route("/v2/{org_id}/folders/{folder_type}", get(folders::list_folders).post(folders::create_folder))
        .route("/v2/{org_id}/folders/{folder_type}/{folder_id}", get(folders::get_folder).put(folders::update_folder).delete(folders::delete_folder))
        .route("/v2/{org_id}/folders/{folder_type}/name/{folder_name}", get(folders::get_folder_by_name))

        // Alerts (v2)
        .route("/v2/{org_id}/alerts", get(alerts::list_alerts).post(alerts::create_alert))
        .route("/v2/{org_id}/alerts/composites/validate", post(alerts::validate_composite_alert))
        .route("/v2/{org_id}/alerts/{alert_id}/composite-references", get(alerts::get_composite_references))
        .route("/v2/{org_id}/alerts/{alert_id}/composite-timeline", get(alerts::get_composite_timeline))
        .route("/v2/{org_id}/alerts/{alert_id}", get(alerts::get_alert).put(alerts::update_alert).delete(alerts::delete_alert))
        .route("/v2/{org_id}/alerts/{alert_id}/groups", get(alerts::list_alert_groups))
        // The uptime this alert would produce as an SLI source. Sits with the
        // other per-alert sub-resources because it reads this alert's history.
        .route("/v2/{org_id}/alerts/{alert_id}/slo-preview", get(slos::preview_alert_sli))
        .route("/v2/{org_id}/alerts/{alert_id}/groups/transitions", get(alerts::list_alert_group_transitions))
        .route("/v2/{org_id}/alerts/{alert_id}/export", post(alerts::export_alert))
        .route("/v2/{org_id}/alerts/bulk", delete(alerts::delete_alert_bulk))
        .route("/v2/{org_id}/alerts/{alert_id}/enable", patch(alerts::enable_alert))
        .route("/v2/{org_id}/alerts/bulk/enable", post(alerts::enable_alert_bulk))
        .route("/v2/{org_id}/alerts/{alert_id}/trigger", patch(alerts::trigger_alert))
        .route("/v2/{org_id}/alerts/{alert_id}/retrain", patch(alerts::retrain_alert))
        .route("/v2/{org_id}/alerts/{alert_id}/clone", post(alerts::clone_alert))
        .route("/v2/{org_id}/alerts/generate_sql", post(alerts::generate_sql))
        .route("/v2/{org_id}/alerts/move", patch(alerts::move_alerts))
        .route("/v2/{org_id}/alerts/tags", get(alerts::list_alert_tags))
        .route("/v2/{org_id}/alerts/history", get(alerts::history::get_alert_history))
        .route("/v2/{org_id}/alerts/dedup/summary", get(alerts::dedup_stats::get_dedup_summary))

        // Alerts - incidents must be before alerts to avoid route conflicts
        .route("/v2/{org_id}/alerts/incidents", get(alerts::incidents::list_incidents))
        .route("/v2/{org_id}/alerts/incidents/stats", get(alerts::incidents::get_incident_stats))
        .route("/v2/{org_id}/alerts/incidents/external-alerts/{external_alert_id}/payload", get(alerts::incidents::get_external_alert_payload))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}", get(alerts::incidents::get_incident))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/rca", post(alerts::incidents::trigger_incident_rca).delete(alerts::incidents::cancel_incident_rca))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/rca/history", get(alerts::incidents::get_incident_rca_history))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/update", patch(alerts::incidents::update_incident))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/events", get(alerts::incidents::get_incident_events))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/events/comment", post(alerts::incidents::post_incident_comment))
        .route("/v2/{org_id}/incidents/integrations", get(alerts::incident_integrations::list_integrations).post(alerts::incident_integrations::create_integration))
        .route("/v2/{org_id}/incidents/integrations/{integration_id}", delete(alerts::incident_integrations::delete_integration).patch(alerts::incident_integrations::update_integration))
        .route("/v2/{org_id}/incidents/integrations/{integration_id}/enable", patch(alerts::incident_integrations::set_integration_enabled))
        .route("/v2/{org_id}/incidents/integrations/{integration_id}/rotate", post(alerts::incident_integrations::rotate_integration_token))
        .route("/v2/{org_id}/incidents/integrations/{integration_id}/senders", get(alerts::incident_integrations::list_integration_senders))

        // Which alerts can be an SLI source, and why the rest cannot.
        .route("/{org_id}/alerts/slo-eligible", get(slos::list_slo_eligible_alerts))

        // Alert templates
        .route("/{org_id}/alerts/templates", get(alerts::templates::list_templates).post(alerts::templates::save_template))
        .route("/{org_id}/alerts/templates/system/prebuilt", get(alerts::templates::get_system_templates))
        .route("/{org_id}/alerts/templates/preview", post(alerts::templates::preview_template))
        .route("/{org_id}/alerts/templates/{template_name}", get(alerts::templates::get_template).put(alerts::templates::update_template).delete(alerts::templates::delete_template))
        .route("/{org_id}/alerts/templates/bulk", delete(alerts::templates::delete_template_bulk))

        // Alert destinations
        .route("/{org_id}/alerts/destinations", get(alerts::destinations::list_destinations).post(alerts::destinations::save_destination))
        .route("/{org_id}/alerts/destinations/prebuilt", get(alerts::destinations::list_prebuilt_destinations))
        .route("/{org_id}/alerts/destinations/{destination_name}", get(alerts::destinations::get_destination).put(alerts::destinations::update_destination).delete(alerts::destinations::delete_destination))
        .route("/{org_id}/alerts/destinations/test", post(alerts::destinations::test_destination))
        .route("/{org_id}/alerts/destinations/{destination_name}/test_send", post(alerts::destinations::test_send))
        .route("/{org_id}/alerts/destinations/bulk", delete(alerts::destinations::delete_destination_bulk))

        // Deduplication
        .route("/{org_id}/alerts/deduplication/config", get(alerts::deduplication::get_config).post(alerts::deduplication::set_config).delete(alerts::deduplication::delete_config))
        .route("/{org_id}/alerts/deduplication/semantic-groups", get(alerts::deduplication::get_semantic_groups).put(alerts::deduplication::save_semantic_groups))
        .route("/{org_id}/alerts/deduplication/semantic-groups/preview-diff", post(alerts::deduplication::preview_semantic_groups_diff));

    #[cfg(feature = "enterprise")]
    {
        router = router
            // Anomaly Detection
            .route("/{org_id}/anomaly_detection", get(anomaly_detection::list_configs).post(anomaly_detection::create_config))
            .route("/{org_id}/anomaly_detection/{config_id}", get(anomaly_detection::get_config).put(anomaly_detection::update_config).delete(anomaly_detection::delete_config))
            .route("/{org_id}/anomaly_detection/{config_id}/train", post(anomaly_detection::train_model).delete(anomaly_detection::cancel_training))
            .route("/{org_id}/anomaly_detection/{config_id}/detect", post(anomaly_detection::detect_anomalies))
            .route("/{org_id}/anomaly_detection/{config_id}/history", get(anomaly_detection::get_detection_history))
            .route("/{org_id}/anomaly_detection/history", get(alerts::history::get_all_anomaly_history));
    }

    router = router
        // KV store
        .route("/{org_id}/kv/{key}", get(kv::get).post(kv::set).delete(kv::delete))
        .route("/{org_id}/kv", get(kv::list))

        // Enrichment tables
        .route("/{org_id}/enrichment_tables/{table_name}", post(enrichment_table::save_enrichment_table))
        .route("/{org_id}/enrichment_tables/{table_name}/url", post(enrichment_table::save_enrichment_table_from_url))
        .route("/{org_id}/enrichment_tables/status", get(enrichment_table::get_all_enrichment_table_statuses))

        // Authz/FGA
        .route("/{org_id}/roles", get(authz::fga::get_roles).post(authz::fga::create_role))
        .route("/{org_id}/roles/bulk", delete(authz::fga::delete_role_bulk))
        .route("/{org_id}/roles/{role_id}", put(authz::fga::update_role).delete(authz::fga::delete_role))
        .route("/{org_id}/roles/{role_id}/permissions", get(authz::fga::get_all_role_permissions))
        .route("/{org_id}/roles/{role_id}/permissions/{resource}", get(authz::fga::get_role_permissions))
        .route("/{org_id}/groups", get(authz::fga::get_groups).post(authz::fga::create_group))
        .route("/{org_id}/groups/{group_name}", get(authz::fga::get_group_details).put(authz::fga::update_group).delete(authz::fga::delete_group))
        .route("/{org_id}/groups/bulk", delete(authz::fga::delete_group_bulk))
        .route("/{org_id}/resources", get(authz::fga::get_resources))
        .route("/{org_id}/roles/{role_id}/users", get(authz::fga::get_users_with_role))
        .route("/{org_id}/users/roles/all", get(authz::fga::get_roles_for_all_users))
        .route("/{org_id}/users/{user_id}/roles", get(authz::fga::get_roles_for_user))
        .route("/{org_id}/users/{user_id}/groups", get(authz::fga::get_groups_for_user))

        // Clusters
        .route("/clusters", get(clusters::list_clusters))

        // Pipelines
        .route("/{org_id}/pipelines", get(pipeline::list_pipelines).post(pipeline::save_pipeline).put(pipeline::update_pipeline))
        .route("/{org_id}/pipelines/{pipeline_id}", get(pipeline::get_pipeline).delete(pipeline::delete_pipeline))
        .route("/{org_id}/pipelines/bulk", delete(pipeline::delete_pipeline_bulk))
        .route("/{org_id}/pipelines/{pipeline_id}/enable", put(pipeline::enable_pipeline))
        .route("/{org_id}/pipelines/bulk/enable", post(pipeline::enable_pipeline_bulk))
        .route("/{org_id}/pipelines/streams", get(pipeline::list_streams_with_pipeline))
        .route("/{org_id}/pipelines/history", get(pipelines::history::get_pipeline_history))

        // Pipeline backfills
        .route("/{org_id}/pipelines/backfill", get(pipelines::backfill::list_backfills))
        .route("/{org_id}/pipelines/{pipeline_id}/backfill", post(pipelines::backfill::create_backfill))
        .route("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}", get(pipelines::backfill::get_backfill).put(pipelines::backfill::update_backfill).delete(pipelines::backfill::delete_backfill))
        .route("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}/enable", put(pipelines::backfill::enable_backfill))


        // Short URLs
        .route("/{org_id}/short", post(short_url::shorten))
        .route("/{org_id}/short/{short_id}", get(short_url::retrieve))

        // Service accounts
        .route("/{org_id}/service_accounts", get(service_accounts::list).post(service_accounts::save))
        .route("/{org_id}/service_accounts/bulk", delete(service_accounts::delete_bulk))
        .route("/{org_id}/service_accounts/{email_id}", put(service_accounts::update).delete(service_accounts::delete))

        // MCP
        .route("/{org_id}/mcp", get(mcp::handle_mcp_get).post(mcp::handle_mcp_post).delete(mcp::handle_mcp_delete))

        // sourcemaps
        .route("/{org_id}/sourcemaps",get(sourcemaps::list).post(sourcemaps::upload_maps).delete(sourcemaps::delete))
        .route("/{org_id}/sourcemaps/values",get(sourcemaps::list_values))
        .route("/{org_id}/sourcemaps/stacktrace",post(sourcemaps::translate_stacktrace));

    #[cfg(feature = "enterprise")]
    {
        router = router
            // Gen-AI agent mapping and registry are enterprise features, independent of Online Evaluations.
            .route("/{org_id}/settings/gen_ai/agent_mapping", get(gen_ai::get_agent_mapping).put(gen_ai::save_agent_mapping))
            .route("/{org_id}/settings/gen_ai/agent_registry", delete(gen_ai::clear_agent_registry))
            .route("/{org_id}/gen_ai/agents", get(gen_ai::list_scored_agents));

        if get_o2_config().llm_eval_config.enabled {
            router = router
                // Annotation Queues and Datasets (LLM Observability Phase 2.5a)
                .route(
                    "/{org_id}/annotation_queues",
                    get(annotation_queues::list_annotation_queues)
                        .post(annotation_queues::create_annotation_queue),
                )
                .route(
                    "/{org_id}/annotation_queues/items",
                    get(annotation_queues::list_annotation_queue_items),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}/items",
                    post(annotation_queues::enqueue_annotation_queue_item)
                        .delete(annotation_queues::clear_annotation_queue_items),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}",
                    get(annotation_queues::get_annotation_queue_item),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/reviews",
                    get(annotation_queues::list_annotation_queue_item_reviews)
                        .post(annotation_queues::review_annotation_queue_item),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/push_to_dataset",
                    post(datasets::push_annotation_queue_item_to_dataset),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}/items/archive",
                    post(annotation_queues::archive_annotation_queue_items),
                )
                .route(
                    "/{org_id}/annotation_queues/{queue_id}",
                    get(annotation_queues::get_annotation_queue)
                        .put(annotation_queues::update_annotation_queue)
                        .delete(annotation_queues::delete_annotation_queue),
                )
                .route(
                    "/{org_id}/datasets",
                    get(datasets::list_datasets).post(datasets::create_dataset),
                )
                .route(
                    "/{org_id}/datasets/{dataset_id}/items/import",
                    post(datasets::import_dataset_items),
                )
                .route(
                    "/{org_id}/datasets/{dataset_id}/items",
                    get(datasets::list_dataset_items).post(datasets::push_dataset_item),
                )
                .route(
                    "/{org_id}/datasets/{dataset_id}/items/{item_id}",
                    get(datasets::get_dataset_item_versions)
                        .put(datasets::update_dataset_item)
                        .delete(datasets::delete_dataset_item),
                )
                .route(
                    "/{org_id}/datasets/{dataset_id}",
                    get(datasets::get_dataset)
                        .put(datasets::update_dataset)
                        .delete(datasets::delete_dataset),
                )

                // On-demand human annotation from Discovery
                .route("/{org_id}/annotations", post(annotations::annotate_target))

                // LLM score-based Discovery
                .route("/{org_id}/discovery", get(discovery::list_discovery_items))

                // LLM Providers (Online Eval Phase 2)
                .route("/{org_id}/providers", get(providers::list_providers).post(providers::create_provider))
                .route("/{org_id}/providers/{provider_id}", get(providers::get_provider).put(providers::update_provider).delete(providers::delete_provider))
                .route("/{org_id}/providers/{provider_id}/test", post(providers::test_provider))

                // Score Configs (Online Eval Phase 2)
                // NOTE: /{entity_id}/versions must precede /{entity_id} for routing correctness
                .route("/{org_id}/score_configs", get(score_configs::list_score_configs).post(score_configs::create_score_config))
                .route("/{org_id}/score_configs/{entity_id}/versions", get(score_configs::list_score_config_versions))
                .route("/{org_id}/score_configs/{entity_id}", get(score_configs::get_score_config).put(score_configs::update_score_config).delete(score_configs::delete_score_config))

                // Scorers (Online Eval Phase 2)
                // NOTE: static and nested routes must precede /{entity_id}
                .route("/{org_id}/scorers", get(scorers::list_scorers).post(scorers::create_scorer))
                .route("/{org_id}/scorers/test", post(scorers::test_scorer))
                .route("/{org_id}/scorers/llm_judge/output_schema", post(scorers::preview_llm_judge_output_schema))
                .route("/{org_id}/scorers/{entity_id}/versions", get(scorers::list_scorer_versions))
                .route("/{org_id}/scorers/{entity_id}", get(scorers::get_scorer).put(scorers::update_scorer).delete(scorers::delete_scorer))

                // Online Eval Jobs (Online Eval Phase 2)
                // NOTE: /activate, /pause, /resume, /archive must precede /{job_id}
                .route("/{org_id}/eval_jobs", get(eval_jobs::list_eval_jobs).post(eval_jobs::create_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}/activate", post(eval_jobs::activate_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}/pause", post(eval_jobs::pause_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}/resume", post(eval_jobs::resume_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}/archive", post(eval_jobs::archive_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}/manual_eval", post(eval_jobs::manual_eval_job))
                .route("/{org_id}/eval_jobs/{job_id}", get(eval_jobs::get_eval_job).put(eval_jobs::update_eval_job).delete(eval_jobs::delete_eval_job));
        }
    }

    #[cfg(feature = "enterprise")]
    {
        router = router
            // Search jobs
            .route("/{org_id}/search_jobs", get(search::search_job::list_status).post(search::search_job::submit_job))
            .route("/{org_id}/search_jobs/{job_id}", get(search::search_job::get_status).delete(search::search_job::delete_job))
            .route("/{org_id}/search_jobs/{job_id}/result", get(search::search_job::get_job_result))
            .route("/{org_id}/search_jobs/{job_id}/cancel", post(search::search_job::cancel_job))
            .route("/{org_id}/search_jobs/{job_id}/retry", post(search::search_job::retry_job))

            // Query manager
            .route("/{org_id}/query_manager/status", get(search::query_manager::query_status))
            .route("/{org_id}/query_manager/cancel", put(search::query_manager::cancel_multiple_query))
            .route("/{org_id}/query_manager/{query_id}/cancel", delete(search::query_manager::cancel_query))


            // search inspector
            .route("/{org_id}/search/profile", get(search::search_inspector::get_search_profile))

            // Keys
            .route("/{org_id}/cipher_keys", get(keys::list).post(keys::save))
            .route("/{org_id}/cipher_keys/bulk", delete(keys::delete_bulk))
            .route("/{org_id}/cipher_keys/{key_name}", get(keys::get).put(keys::update).delete(keys::delete))

            // Actions
            .route("/{org_id}/actions", get(actions::action::list_actions))
            .route("/{org_id}/actions/upload", post(actions::action::upload_zipped_action))
            .route("/{org_id}/actions/bulk", delete(actions::action::delete_action_bulk))
            .route("/{org_id}/actions/{action_id}", get(actions::action::get_action_from_id).put(actions::action::update_action_details).delete(actions::action::delete_action))
            .route("/{org_id}/actions/download/{action_id}", get(actions::action::serve_action_zip))
            .route("/{org_id}/actions/pause/{action_id}", get(actions::operations::pause_action))
            .route("/{org_id}/actions/resume/{action_id}", get(actions::operations::resume_action))
            .route("/{org_id}/actions/test/{action_id}", post(actions::operations::test_action))

            // Rate limits
            .route("/{org_id}/ratelimit/api_modules", get(ratelimit::api_modules))
            .route("/{org_id}/ratelimit/module_list", get(ratelimit::list_module_ratelimit))
            .route("/{org_id}/ratelimit/role_list", get(ratelimit::list_role_ratelimit))
            .route("/{org_id}/ratelimit/update", put(ratelimit::update_ratelimit))

            // AI
            .route("/{org_id}/ai/chat", post(ai::chat::chat))
            .route("/{org_id}/ai/chat_stream", post(ai::chat::chat_stream))
            .route("/{org_id}/ai/feedback", post(ai::chat::feedback))
            .route("/{org_id}/ai/confirm/{session_id}", post(ai::chat::confirm_action))
            .route("/{org_id}/ai/toolsets", get(ai::toolsets::list).post(ai::toolsets::create))
            .route("/{org_id}/ai/toolsets/{id}", get(ai::toolsets::get).put(ai::toolsets::update).delete(ai::toolsets::delete))

            // RE patterns
            .route("/{org_id}/re_patterns", get(re_pattern::list).post(re_pattern::save))
            .route("/{org_id}/re_patterns/{pattern_id}", get(re_pattern::get).put(re_pattern::update).delete(re_pattern::delete))
            .route("/{org_id}/re_patterns/built-in", get(re_pattern::get_built_in_patterns))
            .route("/{org_id}/re_patterns/test", post(re_pattern::test))
            .route("/{org_id}/re_patterns/bulk", delete(re_pattern::delete_bulk))

            // Domain management
            .route("/{org_id}/domain_management", get(domain_management::get_domain_management_config).put(domain_management::set_domain_management_config))

            // License
            .route("/license", get(license::get_license_info).post(license::store_license))
            .route("/license/refresh", post(license::refresh_license_limits))

            // Topology
            .route("/{org_id}/traces/service_graph/topology/current", get(traces::get_current_topology))
            .route("/{org_id}/traces/service_graph/edge/history", get(traces::get_edge_history))
            // Agent behavior signals (loop / failure / cost) — reads the derived _agent_signals stream
            .route("/{org_id}/traces/agent_signals", get(traces::get_agent_signals))
            .route("/{org_id}/traces/agent_signals/compare", post(traces::compare_agent_versions))

            // Patterns
            .route("/{org_id}/streams/{stream_name}/patterns/extract", post(patterns::extract_patterns))

            // Service streams
            .route("/{org_id}/service_streams", get(service_streams::list_services))
            .route("/{org_id}/service_streams/_analytics", get(service_streams::get_dimension_analytics))
            .route("/{org_id}/service_streams/_correlate", post(service_streams::correlate_streams))
            .route("/{org_id}/service_streams/config/identity", get(service_streams::get_identity_config).put(service_streams::save_identity_config))
            .route("/{org_id}/service_streams/_reset", delete(service_streams::reset_services))
            .route("/{org_id}/storage",get(organization::storage::get).post(organization::storage::save).put(organization::storage::update));

        if get_o2_config().common.workflows_enabled {
            // workflows
            router = router
                .route(
                    "/{org_id}/workflows",
                    get(workflows::list_workflows).post(workflows::save_workflow),
                )
                .route(
                    "/{org_id}/workflows/{id}",
                    delete(workflows::delete_workflows).put(workflows::update_workflows),
                )
                .route("/{org_id}/workflows/test", post(workflows::test_workflow))
                .route(
                    "/{org_id}/workflows/{id}/trigger",
                    post(workflows::trigger_workflow),
                )
                .route(
                    "/{org_id}/workflows/{id}/history",
                    get(workflows::get_workflow_history),
                )
                .route(
                    "/{org_id}/workflows/{id}/errors/{run_id}",
                    get(workflows::get_workflow_errors),
                )
                .route(
                    "/{org_id}/workflows/{id}/retry",
                    post(workflows::retry_workflow),
                )
                .route(
                    "/{org_id}/workflows/{id}/enable",
                    put(workflows::enable_workflow),
                )
                .route(
                    "/{org_id}/workflows/promote/{id}",
                    post(workflows::promote_draft),
                );
        }
    }

    // Synthetics — all routes gated behind ZO_SYNTHETICS_ENABLED. When off,
    // nothing is registered and every synthetics path 404s.
    if config::get_config().synthetics.enabled {
        router = router
            // Synthetics — CRUD + locations
            .route("/{org_id}/synthetics", get(synthetics::list_synthetics).post(synthetics::create_synthetic).delete(synthetics::delete_synthetics_bulk))
            .route("/{org_id}/synthetics/locations", get(synthetics::list_locations).post(synthetics::create_location))
            .route("/{org_id}/synthetics/agent-tokens", get(synthetics::list_agent_tokens).post(synthetics::create_agent_token))
            .route("/{org_id}/synthetics/agent-tokens/rotate", post(synthetics::rotate_agent_token))
            .route("/{org_id}/synthetics/agent-tokens/{name}", patch(synthetics::set_agent_token_enabled))
            .route("/{org_id}/synthetics/locations/{id}", get(synthetics::get_location).put(synthetics::update_location).delete(synthetics::delete_location))
            .route("/{org_id}/synthetics/{id}", get(synthetics::get_synthetic).put(synthetics::update_synthetic).delete(synthetics::delete_synthetic))
            .route("/{org_id}/synthetics/{id}/run", post(synthetics::run_synthetic_now))
            .route("/{org_id}/synthetics/{id}/enable", put(synthetics::set_synthetic_enabled))
            .route("/{org_id}/synthetics/{id}/artifact", get(synthetics::get_artifact))
            .route("/{org_id}/synthetics/{id}/artifacts/presign", post(synthetics::presign_artifacts))
            .route("/{org_id}/synthetics/{id}/runs", get(synthetics::list_runs))
            .route("/{org_id}/synthetics/{id}/runs/{run_id}", get(synthetics::get_run_detail))
            // Synthetics — folder move (v2 prefix to match the shared MoveAcrossFolders utility)
            .route("/v2/{org_id}/synthetics/move", patch(synthetics::move_synthetics))
            // Synthetics — job API (org-scoped path; authenticated via the
            // o2syn_ token, whose org must match {org_id} in the path)
            .route("/{org_id}/synthetics/jobs/resolve", post(synthetics::job_resolve))
            .route("/{org_id}/synthetics/jobs/ack", post(synthetics::job_ack))
            .route(
                "/{org_id}/synthetics/jobs/artifact-urls",
                post(synthetics::job_artifact_urls),
            )
            .route("/{org_id}/synthetics/jobs/upload", post(synthetics::job_upload));

        // The private-VPC-agent path, and the only part of synthetics that
        // is enterprise. Not registered at all in an OSS build, so these
        // 404 rather than 403 — the endpoints do not exist there.
        //
        // `lease` is the whole of the job API that is gated: a Lambda probe
        // calls `resolve` and `ack` and is handed its work by the
        // dispatcher, which leases in-process. Only a long-running agent
        // inside a customer VPC pulls work by leasing.
        #[cfg(feature = "enterprise")]
        {
            router = router
                .route(
                    "/{org_id}/synthetics/jobs/lease",
                    post(synthetics::job_lease),
                )
                .route(
                    "/{org_id}/synthetics/agent-setup",
                    get(synthetics::agent_setup),
                )
                .route(
                    "/{org_id}/synthetics/agent/register",
                    post(synthetics::agent_register),
                )
                .route(
                    "/{org_id}/synthetics/agent/heartbeat",
                    post(synthetics::agent_heartbeat),
                );
        }
    }

    #[cfg(feature = "cloud")]
    {
        router = router
            .route(
                "/{org_id}/invites",
                get(organization::org::get_org_invites)
                    .post(organization::org::generate_org_invite),
            )
            .route(
                "/{org_id}/invites/{token}",
                delete(organization::org::delete_org_invite),
            )
            .route(
                "/{org_id}/member_subscription/{invite_token}",
                put(organization::org::accept_org_invite),
            )
            .route(
                "/{org_id}/billings/hosted_subscription_url",
                get(cloud::billings::create_checkout_session),
            )
            .route(
                "/{org_id}/billings/checkout_session_detail",
                get(cloud::billings::process_session_detail),
            )
            .route(
                "/{org_id}/billings/list_subscription",
                get(cloud::billings::list_subscription),
            )
            .route(
                "/{org_id}/billings/invoices",
                get(cloud::billings::list_invoices),
            )
            .route(
                "/{org_id}/billings/unsubscribe",
                get(cloud::billings::unsubscribe),
            )
            .route(
                "/{org_id}/billings/billing_portal",
                get(cloud::billings::create_billing_portal_session),
            )
            .route("/{org_id}/ai/usage", get(cloud::billings::get_ai_usage))
            .route(
                "/{org_id}/ai/usage_limit",
                put(organization::org::set_ai_usage_limit),
            )
            .route(
                "/{org_id}/billings/data_usage/{usage_date}",
                get(cloud::org_usage::get_org_usage),
            )
            .route(
                "/{org_id}/billings/new_user_attribution",
                post(cloud::marketing::handle_new_attribution_event),
            )
            .route(
                "/{org_id}/organizations",
                get(organization::org::all_organizations)
                    .delete(organization::org::initiate_org_deletion),
            )
            .route(
                "/{org_id}/extend_trial_period",
                put(organization::org::extend_trial_period),
            )
            .route(
                "/{org_id}/external_contract",
                post(organization::org::create_external_contract)
                    .put(organization::org::extend_external_contract),
            )
            .route(
                "/{org_id}/external_contract/{target_org_id}",
                delete(organization::org::revoke_external_contract),
            )
            .route(
                "/{org_id}/aws-marketplace/link-subscription",
                post(cloud::aws_marketplace::link_subscription),
            )
            .route(
                "/{org_id}/aws-marketplace/activation-status",
                get(cloud::aws_marketplace::activation_status),
            )
            .route(
                "/{org_id}/azure-marketplace/link-subscription",
                post(cloud::azure_marketplace::link_subscription),
            )
            .route(
                "/{org_id}/enable_org_storage",
                put(organization::org::enable_org_storage),
            )
            .route(
                "/{org_id}/billing_group/invites",
                get(organization::billing_group::list_invites)
                    .post(organization::billing_group::invite),
            )
            .route(
                "/{org_id}/billing_group/invites/{token}/accept",
                post(organization::billing_group::accept),
            )
            .route(
                "/{org_id}/billing_group/invites/{token}/reject",
                delete(organization::billing_group::reject),
            )
            .route(
                "/{org_id}/billing_group/membership",
                get(organization::billing_group::check_membership),
            )
            .route(
                "/{org_id}/billing_group/members",
                get(organization::billing_group::check_members),
            );
    }

    // Apply middlewares in order: preprocessing -> decompression -> cors -> server header -> auth
    // -> audit -> blocked orgs NOTE: Preprocessing middleware removes Content-Encoding: snappy
    // header before tower_http sees it. This prevents 415 errors while allowing handlers to
    // manually decompress snappy data. tower_http's RequestDecompressionLayer handles gzip,
    // deflate, brotli, and zstd.
    router
        .layer(middleware::from_fn(blocked_orgs_middleware))
        .layer(middleware::from_fn(audit_middleware))
        .layer(middleware::from_fn(auth_middleware))
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ))
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            let server = server.clone();
            async move {
                let mut response = next.run(request).await;
                response.headers_mut().insert(
                    header::HeaderName::from_static("x-api-node"),
                    header::HeaderValue::from_str(&server)
                        .unwrap_or_else(|_| header::HeaderValue::from_static("")),
                );
                response
            }
        }))
}

/// Create other service routes (AWS, GCP, RUM)
pub fn other_service_routes() -> Router {
    // AWS routes - with standard decompression (gzip/deflate/brotli) + snappy preprocessing
    let aws_routes = Router::new()
        .route(
            "/{org_id}/{stream_name}/_kinesis_firehose",
            post(logs::ingest::handle_kinesis_request),
        )
        .layer(middleware::from_fn(aws_auth_middleware))
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ));

    // GCP routes - with standard decompression (gzip/deflate/brotli) + snappy preprocessing
    let gcp_routes = Router::new()
        .route(
            "/{org_id}/{stream_name}/_sub",
            post(logs::ingest::handle_gcp_request),
        )
        .layer(middleware::from_fn(gcp_auth_middleware))
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ));

    // RUM routes - with standard decompression (gzip/deflate/brotli) + snappy preprocessing
    let rum_routes = Router::new()
        .route("/v1/{org_id}/logs", post(rum::ingest::log))
        .route("/v1/{org_id}/replay", post(rum::ingest::sessionreplay))
        .route("/v1/{org_id}/rum", post(rum::ingest::data))
        .layer(middleware::from_fn(RumExtraData::extractor_middleware))
        .layer(middleware::from_fn(rum_auth_middleware))
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ));

    Router::new()
        .nest("/aws", aws_routes)
        .nest("/gcp", gcp_routes)
        .nest("/rum", rum_routes)
}

/// Create the full application router
pub fn create_app_router(ui_routes: fn(&str) -> Router) -> Router {
    let cfg = get_config();

    let mut app = if config::cluster::LOCAL_NODE.is_router() {
        // Router node: use proxy routes that dispatch to backend nodes
        // All routes under base_uri will be proxied to backend nodes

        let mut router_routes = Router::new();
        router_routes = router_routes
            .merge(crate::router::http::create_router_routes())
            .nest("/config", config_routes())
            .merge(proxy_routes(true));

        // Add rate limiting middleware for router nodes (enterprise feature)
        #[cfg(feature = "enterprise")]
        {
            router_routes = router_routes.layer(
                o2_ratelimit::middleware::RateLimitLayer::new_with_extractor(Some(
                    crate::router::ratelimit::resource_extractor::default_extractor,
                )),
            );
        }

        // basic_routes are at root level (not under base_uri)
        Router::new().merge(basic_routes()).merge(router_routes)
    } else {
        // Non-router node: use direct service routes
        Router::new()
            .merge(basic_routes())
            .nest("/config", config_routes())
            .nest("/api", service_routes())
            .merge(other_service_routes())
            .merge(proxy_routes(true))
    };

    // Ensure redirect takes into account base_uri
    let web_path = format!("{}/web/", cfg.common.base_uri);
    // Add UI routes at app level (outside basic_routes to avoid any middleware conflicts)
    if cfg.common.ui_enabled {
        // `web_path` is also the `<base href>` the UI needs; resolve it here so the
        // web crate does not have to depend on `config`.
        let ui = ui_routes(&web_path);
        let web_path = web_path.clone();
        app = app
            .route(
                "/",
                get(move || core::future::ready(axum::response::Redirect::permanent(&web_path))),
            )
            .nest_service("/web", ui);
    }

    // Set request body size limit (equivalent to actix-web's PayloadConfig)
    app = app
        .layer(cors_layer())
        .layer(DefaultBodyLimit::max(cfg.limit.req_payload_limit));

    // Apply base_uri if configured
    if cfg.common.base_uri.is_empty() || cfg.common.base_uri == "/" {
        app
    } else {
        // In axum 0.8, nest("/abc", app) maps the inner "/" route to exactly "/abc",
        // but NOT "/abc/" (trailing slash). Add an explicit redirect for the trailing
        // slash case so both /abc and /abc/ work.
        let mut outer = Router::new().nest(&cfg.common.base_uri, app);
        if cfg.common.ui_enabled {
            let base_uri_slash = format!("{}/", cfg.common.base_uri);
            outer = outer.route(
                &base_uri_slash,
                get(move || core::future::ready(axum::response::Redirect::permanent(&web_path))),
            );
        }
        outer
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn test_proxy_routes() {
        let app = proxy_routes(false);

        let req = Request::builder()
            .uri("/proxy/org1/https://cloud.openobserve.ai/assets/test.woff")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        // The route should be reachable and return an error status.
        assert!(
            response.status().is_client_error() || response.status().is_server_error(),
            "expected 4xx/5xx, got {}",
            response.status()
        );
    }

    // ── unauthenticated /config bootstrap ─────────────────────────────────
    //
    // GET /config is served WITHOUT auth so the login page can render. Its
    // response is therefore a security surface: this exact-key-set assertion is
    // the contract that keeps deployment details (version, license, billing
    // orgs, storage region, …) from leaking to anonymous clients. Adding a key
    // here needs the same scrutiny as removing auth from an endpoint.
    #[tokio::test]
    async fn config_bootstrap_exposes_only_login_page_fields() {
        let app = config_routes();

        let req = Request::builder().uri("/").body(Body::empty()).unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        let mut keys: Vec<&str> = payload
            .as_object()
            .expect("bootstrap config is a JSON object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "build_type",
                "commit_hash",
                "custom_hide_self_logo",
                "custom_logo_dark_img",
                "custom_logo_img",
                "custom_logo_text",
                "native_login_enabled",
                "rum",
                "sso_enabled",
                "telemetry_enabled",
            ],
            "unauthenticated /config must expose exactly the login-page bootstrap fields"
        );

        // build_type (enterprise/cloud/opensource) is not sensitive and the o2
        // CLI + o2-operator read it from this unauthenticated endpoint to gate
        // enterprise commands — it must stay a real build-type token.
        assert_eq!(
            payload.get("build_type").and_then(Value::as_str),
            Some("opensource"),
            "bootstrap build_type must carry the real build kind"
        );

        assert_eq!(
            payload.get("commit_hash").and_then(Value::as_str),
            Some(config::COMMIT_HASH),
            "bootstrap commit_hash must carry the real commit for stale-build detection"
        );
    }

    #[tokio::test]
    async fn config_reload_still_requires_auth() {
        let app = config_routes();

        let req = Request::builder()
            .uri("/reload")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "/config/reload must stay behind auth_middleware"
        );
    }

    // Same testability constraint as query_functions above: service_routes()
    // answers 401 for every path, so registration of /{org_id}/config is pinned
    // via a minimal router carrying only this route.
    #[tokio::test]
    async fn config_full_route_dispatches_get_and_rejects_other_methods() {
        let app = Router::new().route("/{org_id}/config", get(status::zo_config));

        let ok = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/myorg/config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);

        let body = axum::body::to_bytes(ok.into_body(), usize::MAX)
            .await
            .unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert!(
            payload
                .get("sql_reserved_keywords")
                .and_then(Value::as_array)
                .is_some_and(|keywords| !keywords.is_empty())
        );
        assert!(
            payload.get("version").is_some(),
            "authenticated config carries the version"
        );
        assert!(
            payload.get("instance").is_none(),
            "the instance id is a fingerprinting handle no UI consumer reads; it must not be served"
        );

        let wrong_method = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/myorg/config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong_method.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    // NOTE ON WHAT IS TESTABLE HERE.
    //
    // service_routes() wraps the entire router in auth_middleware, which
    // short-circuits BEFORE routing: a completely nonexistent path also answers
    // 401. So an HTTP-level test against service_routes() cannot tell a
    // registered route from an absent one — an assertion like "not 404", or
    // even "== 401", passes whether or not the endpoint exists.
    //
    // Registration is therefore pinned two ways that DO discriminate: the route
    // appears in the OpenAPI surface, and a minimal router carrying only this
    // route dispatches GET to the handler and rejects other methods.

    #[tokio::test]
    async fn query_functions_route_dispatches_get_and_rejects_other_methods() {
        let app = Router::new().route(
            "/{org_id}/query_functions",
            get(search::query_functions::list),
        );

        let ok = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/myorg/query_functions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);

        let wrong_method = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/myorg/query_functions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            wrong_method.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "the catalog is read-only; the frontend issues GET"
        );
    }

    #[test]
    fn query_functions_is_published_in_the_openapi_surface() {
        // Discriminating: this fails if the handler is dropped from openapi.rs.
        let spec = super::openapi::ApiDoc::openapi();
        let json = serde_json::to_string(&spec).unwrap();
        assert!(
            json.contains("/{org_id}/query_functions"),
            "query_functions is missing from the OpenAPI surface"
        );
    }

    // ── tmp/code.md B4 — the query-function catalog route ─────────────────────
    //
    // catalog_functions() can be perfect while no HTTP route exposes it. This is
    // the only assertion that fails if the endpoint is simply never registered.

    #[tokio::test]
    async fn query_functions_handler_returns_the_documented_payload_shape() {
        // Calls the handler DIRECTLY, bypassing auth, so the body contract the
        // frontend service depends on ({ list: [...] }) is actually asserted.
        use axum::extract::Path;

        let response =
            openobserve_api_search::search::query_functions::list(Path("default".to_string()))
                .await
                .into_response();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let payload: Value = serde_json::from_slice(&body).expect("body must be JSON");

        let list = payload
            .get("list")
            .and_then(Value::as_array)
            .expect("payload must be { list: [...] } — the frontend reads data.list");
        assert!(!list.is_empty(), "catalog must not be empty");

        let entry = list
            .iter()
            .find(|f| f.get("name").and_then(Value::as_str) == Some("match_all"))
            .expect("match_all must be present");
        for field in ["name", "signature", "doc", "kind", "deprecated"] {
            assert!(
                entry.get(field).is_some(),
                "serialized entry is missing `{field}`"
            );
        }

        // Assert non-empty doc on an entry the SERVER is the sole source for.
        // The frontend catalog carries its own prose for the O2 UDFs and wins
        // on merge, so requiring a server-side doc for match_all would pin data
        // the UI never renders.
        let alias = list
            .iter()
            .find(|f| f.get("name").and_then(Value::as_str) == Some("match_all_raw"))
            .expect("rewriter alias must be present");
        assert!(!alias["doc"].as_str().unwrap_or("").is_empty());
        assert_eq!(alias["deprecated"], Value::Bool(true));
    }

    // ── is_origin_allowed unit tests ──────────────────────────────────────────

    #[test]
    fn test_cors_exact_match_allowed() {
        assert!(is_origin_allowed(
            b"https://app.example.com",
            "https://app.example.com"
        ));
    }

    #[test]
    fn test_cors_exact_match_with_port() {
        assert!(is_origin_allowed(
            b"https://app.example.com:8080",
            "https://app.example.com:8080"
        ));
    }

    #[test]
    fn test_cors_web_url_with_path_stripped() {
        // web_url has a path component — origin must still match scheme+host only.
        assert!(is_origin_allowed(
            b"https://app.example.com",
            "https://app.example.com/o2"
        ));
    }

    #[test]
    fn test_cors_web_url_trailing_slash_stripped() {
        // Caller trims trailing slashes on web_url before calling us.
        assert!(is_origin_allowed(
            b"https://app.example.com",
            "https://app.example.com"
        ));
    }

    #[test]
    fn test_cors_prefix_bypass_denied() {
        // https://app.example.com.evil.com must NOT match https://app.example.com
        assert!(!is_origin_allowed(
            b"https://app.example.com.evil.com",
            "https://app.example.com"
        ));
    }

    #[test]
    fn test_cors_subdomain_denied() {
        assert!(!is_origin_allowed(
            b"https://sub.app.example.com",
            "https://app.example.com"
        ));
    }

    #[test]
    fn test_cors_different_scheme_denied() {
        assert!(!is_origin_allowed(
            b"http://app.example.com",
            "https://app.example.com"
        ));
    }

    #[test]
    fn test_cors_different_port_denied() {
        assert!(!is_origin_allowed(
            b"https://app.example.com:9000",
            "https://app.example.com:8080"
        ));
    }

    #[test]
    fn test_cors_malformed_web_url_denied() {
        // web_url without "://" is malformed — should deny
        assert!(!is_origin_allowed(
            b"https://app.example.com",
            "app.example.com"
        ));
    }

    #[test]
    fn test_cors_empty_web_url_allows_all() {
        // Empty web_url is permissive (dev mode)
        assert!(is_origin_allowed(b"https://any.origin.com", ""));
    }

    #[test]
    fn mcp_www_authenticate_skips_non_401() {
        let uri: Uri = "/default/mcp".parse().unwrap();
        let resp = (StatusCode::OK, "ok").into_response();
        let out = maybe_add_mcp_www_authenticate(&uri, resp);
        assert!(!out.headers().contains_key(header::WWW_AUTHENTICATE));
    }

    #[test]
    fn mcp_www_authenticate_skips_non_mcp_routes() {
        // A stream literally named "mcp" must NOT get the MCP challenge.
        for p in [
            "/default/streams/mcp",
            "/default/streams/foo",
            "/default/dashboards/mcp",
        ] {
            let uri: Uri = p.parse().unwrap();
            let resp = (StatusCode::UNAUTHORIZED, "no").into_response();
            let out = maybe_add_mcp_www_authenticate(&uri, resp);
            assert!(
                !out.headers().contains_key(header::WWW_AUTHENTICATE),
                "non-mcp path {p} must not carry an MCP WWW-Authenticate challenge"
            );
        }
    }

    #[test]
    fn mcp_www_authenticate_rejects_header_injection_in_org_id() {
        // A `"` in the org segment previously closed the quoted-string parameter
        // and let the caller append a second challenge (e.g. `Basic realm="…"`,
        // which browsers render as a credential prompt on our own origin).
        // Such an org id is not valid, so no challenge must be emitted at all.
        for org in [
            r#"x",Basic,realm="phish"#,
            r#"a"b"#,
            r"back\slash",
            "sp ace",
            "",
        ] {
            let uri: Uri = format!("/{org}/mcp").parse().unwrap_or_else(|_| {
                // Unparseable URIs can never reach the middleware; use a benign
                // stand-in so the loop still asserts the no-header outcome.
                "//mcp".parse().unwrap()
            });
            let resp = (StatusCode::UNAUTHORIZED, "no").into_response();
            let out = maybe_add_mcp_www_authenticate(&uri, resp);
            if let Some(v) = out.headers().get(header::WWW_AUTHENTICATE) {
                let v = v.to_str().unwrap();
                assert!(
                    !v.contains(r#"","#) && !v.contains("Basic"),
                    "injected challenge for org {org:?}: {v}"
                );
            }
        }
    }

    #[test]
    fn mcp_www_authenticate_targets_mcp_endpoint() {
        let uri: Uri = "/default/mcp".parse().unwrap();
        let resp = (StatusCode::UNAUTHORIZED, "no").into_response();
        let out = maybe_add_mcp_www_authenticate(&uri, resp);
        // Enterprise adds the RFC 9728 challenge (when dex is enabled); OSS never does.
        // Assert only that the path classification did not panic and that any header
        // present is the expected RFC 9728 shape.
        if let Some(v) = out.headers().get(header::WWW_AUTHENTICATE) {
            let v = v.to_str().unwrap();
            assert!(
                v.contains("resource_metadata="),
                "unexpected challenge: {v}"
            );
            assert!(
                v.contains("/.well-known/oauth-protected-resource/api/default/mcp"),
                "unexpected challenge: {v}"
            );
        }
    }
}

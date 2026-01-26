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
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, patch, post, put},
};
use config::get_config;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    decompression::RequestDecompressionLayer,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;
#[cfg(feature = "enterprise")]
use {
    crate::{common::meta::ingestion::INGESTION_EP, service::self_reporting::audit},
    axum::body::{Body, to_bytes},
    base64::{Engine as _, engine::general_purpose},
    config::utils::time::now_micros,
    o2_enterprise::enterprise::common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
};

use super::request::*;
use crate::{
    common::{
        meta::{middleware_data::RumExtraData, proxy::PathParamProxyURL},
        utils::auth::AuthExtractor,
    },
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
pub mod ui;

pub const ERROR_HEADER: &str = "X-Error-Message";

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
            header::HeaderName::from_lowercase(b"traceparent").unwrap(),
        ])
        .allow_origin(AllowOrigin::mirror_request())
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
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
    let auth_info = match AuthExtractor::from_request_parts(&mut parts, &()).await {
        Ok(info) => info,
        Err(e) => return e.into_response(),
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
        Err(e) => e.into_response(),
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
    let method = request.method().to_string();
    let prefix = format!("{}/api/", get_config().common.base_uri);
    let path = request
        .uri()
        .path()
        .strip_prefix(&prefix)
        .unwrap_or("")
        .to_string();
    let path_columns = path.split('/').collect::<Vec<&str>>();
    let path_len = path_columns.len();

    if get_o2_config().common.audit_enabled
        && !(path_columns.get(1).unwrap_or(&"").to_string().eq("ws")
            || path_columns
                .get(1)
                .unwrap_or(&"")
                .to_string()
                .ends_with("_stream")
            || path.ends_with("ai/chat_stream")
            || (method.eq("POST") && INGESTION_EP.contains(&path_columns[path_len - 1])))
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
    let client = reqwest::Client::new();
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

    router.layer(cors_layer())
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
            Router::new().route("/stripe", post(cloud::billings::handle_stripe_event)),
        );
    }

    // OAuth 2.0 metadata endpoint
    router = router.route(
        "/.well-known/oauth-authorization-server",
        get(mcp::oauth_authorization_server_metadata),
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

    // Swagger UI
    if get_config().common.swagger_enabled {
        router = router.merge(
            SwaggerUi::new("/swagger").url("/api-doc/openapi.json", openapi::ApiDoc::openapi()),
        );
        router = router.route("/docs", get(|| async { Redirect::permanent("/swagger/") }));
    }

    router.layer(cors_layer())
}

/// Create config routes
#[cfg(not(feature = "enterprise"))]
pub fn config_routes() -> Router {
    Router::new()
        .route("/", get(status::zo_config))
        .route("/logout", get(status::logout))
        .route("/runtime", get(status::config_runtime))
        .route("/reload", get(status::config_reload))
        .layer(cors_layer())
}

#[cfg(feature = "enterprise")]
pub fn config_routes() -> Router {
    Router::new()
        .route("/", get(status::zo_config))
        .route("/logout", get(status::logout))
        .route("/runtime", get(status::config_runtime))
        .route("/reload", get(status::config_reload))
        .route("/redirect", get(status::redirect))
        .route("/dex_login", get(status::dex_login))
        .route("/dex_refresh", post(status::refresh_token_with_dex))
        .route("/token", post(users::service_accounts::exchange_token))
        .layer(cors_layer())
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
        .route("/{org_id}/settings", get(organization::settings::get).post(organization::settings::create))
        .route("/{org_id}/settings/logo", post(organization::settings::upload_logo).delete(organization::settings::delete_logo))
        .route("/{org_id}/settings/logo_text", post(organization::settings::set_logo_text).delete(organization::settings::delete_logo_text))

        // System settings v2
        .route("/{org_id}/settings/v2", get(organization::system_settings::list_settings).post(organization::system_settings::set_org_setting))
        .route("/{org_id}/settings/v2/{key}", get(organization::system_settings::get_setting).delete(organization::system_settings::delete_org_setting))
        .route("/{org_id}/settings/v2/user/{user_id}", post(organization::system_settings::set_user_setting))
        .route("/{org_id}/settings/v2/user/{user_id}/{key}", delete(organization::system_settings::delete_user_setting))

        // Org info
        .route("/{org_id}/summary", get(organization::org::org_summary))
        .route("/{org_id}/passcode", get(organization::org::get_user_passcode).put(organization::org::update_user_passcode))
        .route("/{org_id}/rumtoken", get(organization::org::get_user_rumtoken).post(organization::org::create_user_rumtoken).put(organization::org::update_user_rumtoken))
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
        .route("/{org_id}/{stream_name}/_kinesis_firehose", post(logs::ingest::handle_kinesis_request))
        .route("/{org_id}/{stream_name}/_sub", post(logs::ingest::handle_gcp_request))
        .route("/{org_id}/_hec", post(logs::ingest::hec))
        .route("/{org_id}/loki/api/v1/push", post(logs::loki::loki_push))
        .route("/{org_id}/v1/logs", post(logs::ingest::otlp_logs_write))
        .route("/{org_id}/v1/metrics", post(metrics::ingest::otlp_metrics_write))
        .route("/{org_id}/v1/traces", post(traces::traces_write))
        .route("/{org_id}/traces", post(traces::traces_write))
        .route("/{org_id}/otel/v1/traces", post(traces::traces_write))

        // Traces
        .route("/{org_id}/{stream_name}/traces/latest", get(traces::get_latest_traces))

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
        .route("/{org_id}/_search_partition", post(search::search_partition))
        .route("/{org_id}/{stream_name}/_around", get(search::around_v1).post(search::around_v2))
        .route("/{org_id}/{stream_name}/_values", get(search::values))
        .route("/{org_id}/_search_history", post(search::search_history))
        .route("/{org_id}/result_schema", post(search::result_schema))
        .route("/{org_id}/search/profile", get(search::search_inspector::get_search_profile))

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
        .route("/{org_id}/dashboards/{dashboard_id}/export", get(dashboards::export_dashboard))
        .route("/{org_id}/dashboards/bulk", delete(dashboards::delete_dashboard_bulk))
        .route("/{org_id}/folders/dashboards/{dashboard_id}", put(dashboards::move_dashboard))
        .route("/{org_id}/dashboards/move", patch(dashboards::move_dashboards))

        // Reports
        .route("/{org_id}/reports", get(dashboards::reports::list_reports).post(dashboards::reports::create_report))
        .route("/{org_id}/reports/{name}", get(dashboards::reports::get_report).put(dashboards::reports::update_report).delete(dashboards::reports::delete_report))
        .route("/{org_id}/reports/bulk", delete(dashboards::reports::delete_report_bulk))
        .route("/{org_id}/reports/{name}/enable", put(dashboards::reports::enable_report))
        .route("/{org_id}/reports/{name}/trigger", put(dashboards::reports::trigger_report))

        // Timed annotations
        .route("/{org_id}/dashboards/{dashboard_id}/annotations", get(dashboards::timed_annotations::get_annotations).post(dashboards::timed_annotations::create_annotations))
        .route("/{org_id}/dashboards/{dashboard_id}/annotations/{timed_annotation_id}", put(dashboards::timed_annotations::update_annotations).delete(dashboards::timed_annotations::delete_annotations))
        .route("/{org_id}/dashboards/{dashboard_id}/annotations/panels/{timed_annotation_id}", delete(dashboards::timed_annotations::delete_annotation_panels))

        // Folders (v2)
        .route("/v2/{org_id}/folders/{folder_type}", get(folders::list_folders).post(folders::create_folder))
        .route("/v2/{org_id}/folders/{folder_type}/{folder_id}", get(folders::get_folder).put(folders::update_folder).delete(folders::delete_folder))
        .route("/v2/{org_id}/folders/{folder_type}/name/{folder_name}", get(folders::get_folder_by_name))

        // Alerts (v2)
        .route("/v2/{org_id}/alerts", get(alerts::list_alerts).post(alerts::create_alert))
        .route("/v2/{org_id}/alerts/{alert_id}", get(alerts::get_alert).put(alerts::update_alert).delete(alerts::delete_alert))
        .route("/v2/{org_id}/alerts/{alert_id}/export", get(alerts::export_alert))
        .route("/v2/{org_id}/alerts/bulk", delete(alerts::delete_alert_bulk))
        .route("/v2/{org_id}/alerts/{alert_id}/enable", patch(alerts::enable_alert))
        .route("/v2/{org_id}/alerts/bulk/enable", post(alerts::enable_alert_bulk))
        .route("/v2/{org_id}/alerts/{alert_id}/trigger", patch(alerts::trigger_alert))
        .route("/v2/{org_id}/alerts/generate_sql", post(alerts::generate_sql))
        .route("/v2/{org_id}/alerts/move", patch(alerts::move_alerts))
        .route("/v2/{org_id}/alerts/history", get(alerts::history::get_alert_history))
        .route("/v2/{org_id}/alerts/dedup/summary", get(alerts::dedup_stats::get_dedup_summary))

        // Alerts - incidents must be before alerts to avoid route conflicts
        .route("/v2/{org_id}/alerts/incidents", get(alerts::incidents::list_incidents))
        .route("/v2/{org_id}/alerts/incidents/stats", get(alerts::incidents::get_incident_stats))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}", get(alerts::incidents::get_incident))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/rca", post(alerts::incidents::trigger_incident_rca))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/service_graph", get(alerts::incidents::get_incident_service_graph))
        .route("/v2/{org_id}/alerts/incidents/{incident_id}/status", patch(alerts::incidents::update_incident_status))

        // Alert templates
        .route("/{org_id}/alerts/templates", get(alerts::templates::list_templates).post(alerts::templates::save_template))
        .route("/{org_id}/alerts/templates/{template_name}", get(alerts::templates::get_template).put(alerts::templates::update_template).delete(alerts::templates::delete_template))
        .route("/{org_id}/alerts/templates/bulk", delete(alerts::templates::delete_template_bulk))

        // Alert destinations
        .route("/{org_id}/alerts/destinations", get(alerts::destinations::list_destinations).post(alerts::destinations::save_destination))
        .route("/{org_id}/alerts/destinations/prebuilt", get(alerts::destinations::list_prebuilt_destinations))
        .route("/{org_id}/alerts/destinations/{destination_name}", get(alerts::destinations::get_destination).put(alerts::destinations::update_destination).delete(alerts::destinations::delete_destination))
        .route("/{org_id}/alerts/destinations/test", post(alerts::destinations::test_destination))
        .route("/{org_id}/alerts/destinations/bulk", delete(alerts::destinations::delete_destination_bulk))

        // Deduplication
        .route("/{org_id}/alerts/deduplication/config", get(alerts::deduplication::get_config).post(alerts::deduplication::set_config).delete(alerts::deduplication::delete_config))
        .route("/{org_id}/alerts/deduplication/semantic-groups", get(alerts::deduplication::get_semantic_groups).put(alerts::deduplication::save_semantic_groups))
        .route("/{org_id}/alerts/deduplication/semantic-groups/preview-diff", post(alerts::deduplication::preview_semantic_groups_diff))

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
        .route("/{org_id}/roles/{role_id}/permissions/{resource}", get(authz::fga::get_role_permissions))
        .route("/{org_id}/groups", get(authz::fga::get_groups).post(authz::fga::create_group))
        .route("/{org_id}/groups/{group_name}", get(authz::fga::get_group_details).put(authz::fga::update_group).delete(authz::fga::delete_group))
        .route("/{org_id}/groups/bulk", delete(authz::fga::delete_group_bulk))
        .route("/{org_id}/resources", get(authz::fga::get_resources))
        .route("/{org_id}/roles/{role_id}/users", get(authz::fga::get_users_with_role))
        .route("/{org_id}/users/{user_id}/roles", get(authz::fga::get_roles_for_user))
        .route("/{org_id}/users/{user_id}/groups", get(authz::fga::get_groups_for_user))

        // Clusters
        .route("/clusters", get(clusters::list_clusters))

        // Pipelines
        .route("/{org_id}/pipelines", get(pipeline::list_pipelines).post(pipeline::save_pipeline).put(pipeline::update_pipeline))
        .route("/{org_id}/pipelines/{pipeline_id}", delete(pipeline::delete_pipeline))
        .route("/{org_id}/pipelines/bulk", delete(pipeline::delete_pipeline_bulk))
        .route("/{org_id}/pipelines/{pipeline_id}/enable", put(pipeline::enable_pipeline))
        .route("/{org_id}/pipelines/bulk/enable", post(pipeline::enable_pipeline_bulk))
        .route("/{org_id}/pipelines/streams", get(pipeline::list_streams_with_pipeline))
        .route("/{org_id}/pipelines/history", get(pipelines::history::get_pipeline_history))

        // Pipeline backfills
        .route("/{org_id}/pipelines/{pipeline_id}/backfill", get(pipelines::backfill::list_backfills).post(pipelines::backfill::create_backfill))
        .route("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}", get(pipelines::backfill::get_backfill).put(pipelines::backfill::update_backfill).delete(pipelines::backfill::delete_backfill))
        .route("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}/enable", put(pipelines::backfill::enable_backfill))


        // Short URLs
        .route("/{org_id}/short", post(short_url::shorten))
        .route("/{org_id}/short/{short_id}", get(short_url::retrieve))

        // Service accounts
        .route("/{org_id}/service_accounts", get(service_accounts::list).post(service_accounts::save))
        .route("/{org_id}/service_accounts/bulk", delete(service_accounts::delete_bulk))
        .route("/{org_id}/service_accounts/{email_id}", get(service_accounts::get_api_token).put(service_accounts::update).delete(service_accounts::delete))

        // MCP
        .route("/{org_id}/mcp", get(mcp::handle_mcp_get).post(mcp::handle_mcp_post));

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
            .route("/{org_id}/ai/prompts", get(ai::prompt::list_prompts))
            .route("/{org_id}/ai/prompts/{prompt_id}", get(ai::prompt::get_prompt).put(ai::prompt::update_prompt))
            .route("/{org_id}/ai/prompts/{prompt_id}/rollback", post(ai::prompt::rollback_prompt))

            // RE patterns
            .route("/{org_id}/re_patterns", get(re_pattern::list).post(re_pattern::save))
            .route("/{org_id}/re_patterns/{pattern_id}", get(re_pattern::get).put(re_pattern::update).delete(re_pattern::delete))
            .route("/{org_id}/re_patterns/built-in", get(re_pattern::get_built_in_patterns))
            .route("/{org_id}/re_patterns/test", post(re_pattern::test))
            .route("/{org_id}/re_patterns/bulk", delete(re_pattern::delete_bulk))

            // Domain management
            .route("/{org_id}/domain_management", get(domain_management::get_domain_management_config).post(domain_management::set_domain_management_config))

            // License
            .route("/license", get(license::get_license_info).post(license::store_license))

            // Topology
            .route("/{org_id}/traces/service_graph/topology/current", get(traces::get_current_topology))

            // Patterns
            .route("/{org_id}/streams/{stream_name}/patterns/extract", post(patterns::extract_patterns))

            // Agent chat
            .route("/{org_id}/agent/chat", post(agent::chat::agent_chat))
            .route("/{org_id}/agent/chat_stream", post(agent::chat::agent_chat_stream))

            // Service streams
            .route("/{org_id}/service_streams/_analytics", get(service_streams::get_dimension_analytics))
            .route("/{org_id}/service_streams/_correlate", post(service_streams::correlate_streams))
            .route("/{org_id}/service_streams/_grouped", get(service_streams::get_services_grouped));
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
                post(organization::org::accept_org_invite),
            )
            .route(
                "/{org_id}/billings/checkout",
                post(cloud::billings::create_checkout_session),
            )
            .route(
                "/{org_id}/billings/session",
                post(cloud::billings::process_session_detail),
            )
            .route(
                "/{org_id}/billings/subscriptions",
                get(cloud::billings::list_subscription),
            )
            .route(
                "/{org_id}/billings/invoices",
                get(cloud::billings::list_invoices),
            )
            .route(
                "/{org_id}/billings/unsubscribe",
                post(cloud::billings::unsubscribe),
            )
            .route(
                "/{org_id}/billings/portal",
                post(cloud::billings::create_billing_portal_session),
            )
            .route("/{org_id}/usage", get(cloud::org_usage::get_org_usage))
            .route(
                "/{org_id}/marketing/attribution",
                post(cloud::marketing::handle_new_attribution_event),
            )
            .route(
                "/organizations/all",
                get(organization::org::all_organizations),
            )
            .route(
                "/{org_id}/extend_trial_period",
                put(organization::org::extend_trial_period),
            );
    }

    // Apply middlewares in order: preprocessing -> decompression -> cors -> server header -> auth
    // -> audit -> blocked orgs NOTE: Preprocessing middleware removes Content-Encoding: snappy
    // header before tower_http sees it. This prevents 415 errors while allowing handlers to
    // manually decompress snappy data. tower_http's RequestDecompressionLayer handles gzip,
    // deflate, and brotli.
    router
        .layer(middleware::from_fn(blocked_orgs_middleware))
        .layer(middleware::from_fn(audit_middleware))
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(
            move |mut request: Request, next: Next| {
                let server = server.clone();
                async move {
                    request.headers_mut().insert(
                        header::HeaderName::from_static("x-api-node"),
                        header::HeaderValue::from_str(&server)
                            .unwrap_or_else(|_| header::HeaderValue::from_static("")),
                    );
                    next.run(request).await
                }
            },
        ))
        .layer(cors_layer())
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ))
}

/// Create other service routes (AWS, GCP, RUM)
pub fn other_service_routes() -> Router {
    // AWS routes - with standard decompression (gzip/deflate/brotli) + snappy preprocessing
    let aws_routes = Router::new()
        .route(
            "/{org_id}/_kinesis_firehose",
            post(logs::ingest::handle_kinesis_request),
        )
        .layer(middleware::from_fn(aws_auth_middleware))
        .layer(RequestDecompressionLayer::new())
        .layer(middleware::from_fn(
            decompression::preprocess_encoding_middleware,
        ));

    // GCP routes - with standard decompression (gzip/deflate/brotli) + snappy preprocessing
    let gcp_routes = Router::new()
        .route("/{org_id}/_sub", post(logs::ingest::handle_gcp_request))
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
        .layer(cors_layer())
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
pub fn create_app_router() -> Router {
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

        let router_routes = router_routes;

        // Apply base_uri if configured
        let router_routes = if cfg.common.base_uri.is_empty() || cfg.common.base_uri == "/" {
            router_routes
        } else {
            Router::new().nest(&cfg.common.base_uri, router_routes)
        };

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

    // Add UI routes at app level (outside basic_routes to avoid any middleware conflicts)
    if cfg.common.ui_enabled {
        app = app
            .route(
                "/",
                get(|| async { axum::response::Redirect::permanent("/web/") }),
            )
            .nest_service("/web", ui::ui_routes());
    }

    // Set request body size limit (equivalent to actix-web's PayloadConfig)
    app = app
        .layer(cors_layer())
        .layer(DefaultBodyLimit::max(cfg.limit.req_payload_limit));

    app
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
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
        // The proxy will fail to connect in tests, but route should be reachable
        assert!(
            response.status() == StatusCode::INTERNAL_SERVER_ERROR
                || response.status() == StatusCode::NOT_FOUND
        );
    }
}

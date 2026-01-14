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

use std::{collections::HashMap as StdHashMap, sync::OnceLock};

use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    META_ORG_ID, RouteDispatchStrategy, get_config,
    meta::{
        cluster::{Node, Role, RoleGroup},
        search::{Request as SearchRequest, SearchPartitionRequest, ValuesRequest},
    },
    router::{is_fixed_querier_route, is_querier_route, is_querier_route_by_body},
    utils::{json, rand::get_rand_element},
};
use futures::StreamExt;
use hashbrown::HashMap;
use http_body_util::BodyExt;
use infra::cluster;

use crate::common::utils::http::get_search_type_from_request;

/// Global HTTP client for connection pooling.
/// Using OnceLock ensures thread-safe lazy initialization.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Returns a reference to the global HTTP client, initializing it if necessary.
fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        crate::service::tls::reqwest_client_tls_config()
            .expect("Failed to create HTTP client with TLS config")
    })
}

/// Details about the target URL for proxying requests.
struct ProxyTarget {
    path: String,
    full_url: String,
    node_addr: String,
}

/// Payload types for querier requests that need body-based routing.
enum QuerierPayload {
    /// No payload (GET request)
    Empty,
    /// PromQL query form data
    PromQL(HashMap<String, String>),
    /// Search request JSON
    Search(Box<SearchRequest>),
    /// Search partition request JSON
    SearchPartition(Box<SearchPartitionRequest>),
    /// Values stream request JSON
    Values(Box<ValuesRequest>),
}

/// Main dispatch handler for all routes
pub async fn dispatch(req: Request) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let path = req
        .uri()
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    // Handle node list API locally (special case)
    if path.contains("/api/_meta/node/list") {
        return handle_node_list_request(req).await;
    }

    // Resolve target node
    let target = match resolve_target(&path, &cfg.common.base_uri).await {
        Ok(target) => target,
        Err(error) => {
            log::error!(
                "dispatch: {}, resolve target error: {}, took: {} ms",
                path,
                error,
                start.elapsed().as_millis()
            );
            return (StatusCode::SERVICE_UNAVAILABLE, error).into_response();
        }
    };

    // Route based on request type
    if cfg.common.result_cache_enabled && is_querier_route_by_body(&path) {
        proxy_with_body_routing(req, target, start).await
    } else {
        proxy_request(req, target, start).await
    }
}

/// Handles the special node list API request locally.
async fn handle_node_list_request(req: Request) -> Response {
    let query_string = req.uri().query().unwrap_or("");
    let query: StdHashMap<String, String> = url::form_urlencoded::parse(query_string.as_bytes())
        .into_owned()
        .collect();

    crate::handler::http::request::organization::org::node_list_impl(META_ORG_ID, query)
        .await
        .into_response()
}

/// Resolves the target node for a given request path.
async fn resolve_target(path: &str, base_uri: &str) -> Result<ProxyTarget, String> {
    // Strip base URI if present
    let api_path = if !base_uri.is_empty() {
        path.strip_prefix(base_uri).unwrap_or(path)
    } else {
        path
    };

    let (node_type, nodes) = if is_querier_route(api_path) {
        (Role::Querier, get_querier_nodes(path).await)
    } else {
        (
            Role::Ingester,
            cluster::get_cached_schedulable_ingester_nodes().await,
        )
    };

    let nodes = nodes.ok_or_else(|| format!("No online {node_type} nodes"))?;
    if nodes.is_empty() {
        return Err(format!("No online {node_type} nodes"));
    }

    let node = select_node(&nodes);
    Ok(ProxyTarget {
        path: path.to_string(),
        full_url: format!("{}{}", node.http_addr, path),
        node_addr: node
            .http_addr
            .replace("http://", "")
            .replace("https://", ""),
    })
}

/// Gets available querier nodes for the request.
async fn get_querier_nodes(path: &str) -> Option<Vec<Node>> {
    let query_str = &path[path.find('?').unwrap_or(path.len())..];
    let query_str = query_str.strip_prefix('?').unwrap_or(query_str);
    let params: HashMap<String, String> = url::form_urlencoded::parse(query_str.as_bytes())
        .into_owned()
        .collect();

    let role_group = get_search_type_from_request(&params)
        .unwrap_or(None)
        .map(RoleGroup::from)
        .unwrap_or(RoleGroup::Interactive);

    let nodes = cluster::get_cached_online_querier_nodes(Some(role_group)).await;

    // For fixed querier routes, only use the first node
    if is_fixed_querier_route(path) {
        nodes.map(|v| v.into_iter().take(1).collect())
    } else {
        nodes
    }
}

/// Selects a node from the available nodes based on dispatch strategy.
fn select_node(nodes: &[Node]) -> &Node {
    match get_config().route.dispatch_strategy {
        RouteDispatchStrategy::Random => get_rand_element(nodes),
        _ => cluster::select_best_node(nodes).unwrap_or_else(|| get_rand_element(nodes)),
    }
}

/// Proxies a request to the target node.
async fn proxy_request(req: Request, target: ProxyTarget, start: std::time::Instant) -> Response {
    let query_path = extract_path_without_query(&target.path);
    let is_streaming = is_streaming_endpoint(query_path);

    // Extract method and headers before consuming the request
    let method = req.method().clone();
    let headers = build_request_headers(req.headers(), is_streaming);

    // Read request body
    let body = match req.into_body().collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            log::error!("Failed to read request body: {:?}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read request body",
            )
                .into_response();
        }
    };

    // Build upstream request
    let client = get_http_client();
    let upstream_req = match method {
        Method::GET => client.get(&target.full_url).headers(headers),
        Method::POST => client
            .post(&target.full_url)
            .headers(headers)
            .body(body.to_vec()),
        Method::PUT => client
            .put(&target.full_url)
            .headers(headers)
            .body(body.to_vec()),
        Method::DELETE => client
            .delete(&target.full_url)
            .headers(headers)
            .body(body.to_vec()),
        Method::PATCH => client
            .patch(&target.full_url)
            .headers(headers)
            .body(body.to_vec()),
        _ => return (StatusCode::METHOD_NOT_ALLOWED).into_response(),
    };

    send_and_respond(upstream_req, &target, is_streaming, start).await
}

/// Proxies a querier request with body-based routing for consistent hashing.
async fn proxy_with_body_routing(
    req: Request,
    mut target: ProxyTarget,
    start: std::time::Instant,
) -> Response {
    let query_path = extract_path_without_query(&target.path);
    let headers = req.headers().clone();

    // Parse request payload based on endpoint type
    let (routing_key, querier_payload) = match parse_querier_payload(req, query_path).await {
        Ok(Some(result)) => result,
        Ok(None) => {
            // For None case, we can't fall back because we consumed the request
            // This shouldn't happen in practice since None is only for unknown endpoints
            return (
                StatusCode::BAD_REQUEST,
                "Unsupported endpoint for body-based routing",
            )
                .into_response();
        }
        Err(e) => return e,
    };

    // Use routing_key for consistent hash node selection
    let Some(node_name) =
        cluster::get_node_from_consistent_hash(&routing_key, &Role::Querier, None).await
    else {
        log::error!(
            "dispatch: {} to {}, get node from consistent hash error: {:?}, took: {} ms",
            target.path,
            target.node_addr,
            "No online querier nodes",
            start.elapsed().as_millis()
        );
        return (StatusCode::SERVICE_UNAVAILABLE, "No online querier nodes").into_response();
    };
    // get node by name
    let Some(node) = cluster::get_cached_node_by_name(&node_name).await else {
        log::error!(
            "dispatch: {} to {}, get node from cache error: {:?}, took: {} ms",
            target.path,
            target.node_addr,
            "No online querier nodes",
            start.elapsed().as_millis()
        );
        return (StatusCode::SERVICE_UNAVAILABLE, "No online querier nodes").into_response();
    };
    target.full_url = format!("{}{}", node.http_addr, target.path);
    target.node_addr = node
        .http_addr
        .replace("http://", "")
        .replace("https://", "");

    let is_streaming = is_streaming_endpoint(query_path);
    let headers = build_request_headers(&headers, is_streaming);
    let client = get_http_client();

    // Build upstream request based on payload type
    let upstream_req = match querier_payload {
        QuerierPayload::Empty => client.get(&target.full_url).headers(headers),
        QuerierPayload::PromQL(form) => client.post(&target.full_url).headers(headers).form(&form),
        QuerierPayload::Search(json) => client.post(&target.full_url).headers(headers).json(&*json),
        QuerierPayload::SearchPartition(json) => {
            client.post(&target.full_url).headers(headers).json(&*json)
        }
        QuerierPayload::Values(json) => client.post(&target.full_url).headers(headers).json(&*json),
    };

    send_and_respond(upstream_req, &target, is_streaming, start).await
}

/// Parses the request payload for querier routing.
async fn parse_querier_payload(
    req: Request,
    query_path: &str,
) -> Result<Option<(String, QuerierPayload)>, Response> {
    let result = match query_path {
        // PromQL endpoints
        s if s.ends_with("/prometheus/api/v1/query_range")
            || s.ends_with("/prometheus/api/v1/query_exemplars") =>
        {
            parse_promql_payload(req).await?
        }

        // Values stream endpoint
        s if s.ends_with("/_values_stream") => {
            let body = read_payload_bytes(req, "values stream").await?;
            let query = json::from_slice::<ValuesRequest>(&body).map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    "Failed to parse values stream request",
                )
                    .into_response()
            })?;
            Some((
                query.sql.to_string(),
                QuerierPayload::Values(Box::new(query)),
            ))
        }

        // Search endpoints
        s if s.ends_with("/_search") || s.ends_with("/_search_stream") => {
            let body = read_payload_bytes(req, "search").await?;
            let query = json::from_slice::<SearchRequest>(&body).map_err(|_| {
                (StatusCode::BAD_REQUEST, "Failed to parse search request").into_response()
            })?;
            Some((
                query.query.sql.to_string(),
                QuerierPayload::Search(Box::new(query)),
            ))
        }

        // Search partition endpoint
        s if s.ends_with("/_search_partition") => {
            let body = read_payload_bytes(req, "search partition").await?;
            let query = json::from_slice::<SearchPartitionRequest>(&body).map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    "Failed to parse search partition request",
                )
                    .into_response()
            })?;
            Some((
                query.sql.to_string(),
                QuerierPayload::SearchPartition(Box::new(query)),
            ))
        }

        // Unknown endpoint - fall back to default proxy
        _ => None,
    };

    Ok(result)
}

/// Parses PromQL request payload.
async fn parse_promql_payload(req: Request) -> Result<Option<(String, QuerierPayload)>, Response> {
    let method = req.method().clone();
    if method == Method::GET {
        let query_string = req.uri().query().unwrap_or("");
        let params: StdHashMap<String, String> =
            url::form_urlencoded::parse(query_string.as_bytes())
                .into_owned()
                .collect();

        let query = params.get("query").cloned().unwrap_or_default();
        Ok(Some((query, QuerierPayload::Empty)))
    } else {
        let body = read_payload_bytes(req, "promql").await?;
        let form_str = String::from_utf8(body.to_vec())
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid UTF-8 in form data").into_response())?;

        // Parse form data
        let form: HashMap<String, String> = url::form_urlencoded::parse(form_str.as_bytes())
            .into_owned()
            .collect();

        let query = form.get("query").cloned().unwrap_or_default();
        Ok(Some((query, QuerierPayload::PromQL(form))))
    }
}

/// Sends the upstream request and builds the response.
async fn send_and_respond(
    upstream_req: reqwest::RequestBuilder,
    target: &ProxyTarget,
    is_streaming: bool,
    start: std::time::Instant,
) -> Response {
    let resp = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!(
                "proxy request failed: {} -> {}, error: {:?}, took: {} ms",
                target.path,
                target.node_addr,
                e,
                start.elapsed().as_millis()
            );
            return (
                StatusCode::BAD_GATEWAY,
                format!("Proxy request failed: {e}"),
            )
                .into_response();
        }
    };

    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut builder = Response::builder().status(status);

    // Copy headers
    let skip_headers = if is_streaming {
        SKIP_RESPONSE_HEADERS_STREAMING
    } else {
        SKIP_RESPONSE_HEADERS_NORMAL
    };

    for (key, value) in resp.headers() {
        if skip_headers.contains(&key.as_str()) {
            continue;
        }
        builder = builder.header(key, value);
    }

    // Add streaming-specific headers
    if is_streaming {
        builder = builder
            .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
            .header(header::PRAGMA, "no-cache")
            .header(header::CONNECTION, "keep-alive")
            .header("X-Accel-Buffering", "no");
    }

    if is_streaming {
        let stream = resp
            .bytes_stream()
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));
        match builder.body(Body::from_stream(stream)) {
            Ok(r) => r,
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build streaming response: {e}"),
            )
                .into_response(),
        }
    } else {
        let body = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                log::error!(
                    "proxy response failed: {} -> {}, error: {:?}, took: {} ms",
                    target.path,
                    target.node_addr,
                    e,
                    start.elapsed().as_millis()
                );
                return (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to read response: {e}"),
                )
                    .into_response();
            }
        };
        match builder.body(Body::from(body)) {
            Ok(r) => r,
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build response: {e}"),
            )
                .into_response(),
        }
    }
}

/// Headers to skip when forwarding requests.
const SKIP_REQUEST_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "transfer-encoding",
    "host",
    "content-length",
];

/// Headers to skip when forwarding responses (streaming).
const SKIP_RESPONSE_HEADERS_STREAMING: &[&str] = &[
    "content-encoding",
    "transfer-encoding",
    "cache-control",
    "connection",
    "content-length",
];

/// Headers to skip when forwarding responses (non-streaming).
/// Note: reqwest auto-decompresses responses, so content-length refers to compressed size.
const SKIP_RESPONSE_HEADERS_NORMAL: &[&str] =
    &["content-encoding", "transfer-encoding", "content-length"];

/// Builds request headers for the upstream request.
fn build_request_headers(headers: &HeaderMap, is_streaming: bool) -> reqwest::header::HeaderMap {
    let mut req_headers = reqwest::header::HeaderMap::new();

    for (key, value) in headers {
        let key_str = key.as_str();

        // Skip hop-by-hop headers
        if SKIP_REQUEST_HEADERS.contains(&key_str) {
            continue;
        }

        // For streaming, skip accept-encoding to request uncompressed response
        if is_streaming && key_str == "accept-encoding" {
            continue;
        }

        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(key.as_ref()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            req_headers.insert(name, val);
        }
    }

    // For streaming endpoints, request uncompressed response
    if is_streaming {
        req_headers.insert(
            reqwest::header::ACCEPT_ENCODING,
            reqwest::header::HeaderValue::from_static("identity"),
        );
    }

    req_headers
}

/// Streaming endpoint patterns.
const STREAMING_ENDPOINTS: &[&str] = &[
    "/_search_stream",
    "/_values_stream",
    "/ai/chat_stream",
    "/prometheus/api/v1/query_range",
];

/// Checks if the request path is for a streaming endpoint.
fn is_streaming_endpoint(path: &str) -> bool {
    STREAMING_ENDPOINTS.iter().any(|&ep| path.ends_with(ep))
}

/// Extracts the path without query string.
fn extract_path_without_query(path: &str) -> &str {
    let query_start = path.find('?').unwrap_or(path.len());
    &path[..query_start]
}

/// Reads payload bytes with error handling.
async fn read_payload_bytes(req: Request, request_type: &str) -> Result<Bytes, Response> {
    match req.into_body().collect().await {
        Ok(collected) => Ok(collected.to_bytes()),
        Err(e) => {
            log::error!("Failed to read {request_type} request body: {e}");
            Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to read {request_type} request body"),
            )
                .into_response())
        }
    }
}

/// Creates router-specific routes that proxy requests to backend nodes.
/// This is used when the node is running in router mode.
pub fn create_router_routes() -> axum::Router {
    use axum::routing::any;

    axum::Router::new()
        .route("/config", any(dispatch))
        .route("/config/{*path}", any(dispatch))
        .route("/api/{*path}", any(dispatch))
        .route("/aws/{*path}", any(dispatch))
        .route("/gcp/{*path}", any(dispatch))
        .route("/rum/{*path}", any(dispatch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_querier_route() {
        assert!(is_querier_route("/api/default/_search"));
        assert!(is_querier_route("/api/default/default/_around"));
        assert!(is_querier_route("/config"));
        assert!(is_querier_route(
            "/api/default/prometheus/api/v1/query_range"
        ));
        assert!(!is_querier_route("/api/config/_bulk"));
        assert!(!is_querier_route("/api/clusters/_bulk"));
        assert!(!is_querier_route("/api/clusters/ws/_multi"));
        assert!(!is_querier_route("/api/default/config/_json"));
        assert!(is_querier_route("/api/default/ai/chat_stream"));
    }

    #[test]
    fn test_is_querier_route_by_body() {
        assert!(is_querier_route_by_body("/prometheus/api/v1/query_range"));
        assert!(is_querier_route_by_body(
            "/prometheus/api/v1/query_exemplars"
        ));
        assert!(!is_querier_route_by_body("/prometheus/api/v1/query"));
    }

    #[test]
    fn test_is_streaming_endpoint() {
        assert!(is_streaming_endpoint("/api/org/_search_stream"));
        assert!(is_streaming_endpoint("/api/org/_values_stream"));
        assert!(is_streaming_endpoint("/api/org/ai/chat_stream"));
        assert!(is_streaming_endpoint(
            "/api/org/prometheus/api/v1/query_range"
        ));
        assert!(!is_streaming_endpoint("/api/org/_search"));
        assert!(!is_streaming_endpoint("/api/org/logs"));
    }

    #[test]
    fn test_extract_path_without_query() {
        assert_eq!(extract_path_without_query("/api/test?foo=bar"), "/api/test");
        assert_eq!(extract_path_without_query("/api/test"), "/api/test");
        assert_eq!(
            extract_path_without_query("/api/test?foo=bar&baz=qux"),
            "/api/test"
        );
    }

    #[tokio::test]
    async fn test_resolve_target_with_base_uri() {
        let result = resolve_target("/base/api/default/summary", "/base").await;
        match result {
            Ok(target) => {
                assert!(target.path.contains("/api/default/summary"));
            }
            Err(e) => {
                assert!(e.contains("No online"));
            }
        }
    }
}

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

use std::sync::OnceLock;

use ::config::{
    META_ORG_ID, RouteDispatchStrategy, get_config,
    meta::{
        cluster::{Node, Role, RoleGroup},
        promql::RequestRangeQuery,
        search::{Request as SearchRequest, SearchPartitionRequest, ValuesRequest},
    },
    router::{is_fixed_querier_route, is_querier_route, is_querier_route_by_body},
    utils::{json, rand::get_rand_element},
};
use actix_web::{
    FromRequest, HttpRequest, HttpResponse,
    http::{Error, Method, header},
    route, web,
};
use futures::StreamExt;
use hashbrown::HashMap;
use infra::cluster;

use crate::common::utils::http::get_search_type_from_request;

/// Global HTTP client for connection pooling.
/// Using OnceLock ensures thread-safe lazy initialization.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Returns a reference to the global HTTP client, initializing it if necessary.
fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        let cfg = get_config();
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(cfg.route.timeout))
            .pool_max_idle_per_host(cfg.route.max_connections)
            .build()
            .expect("Failed to create HTTP client")
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
    PromQL(web::Form<RequestRangeQuery>),
    /// Search request JSON
    Search(Box<web::Json<SearchRequest>>),
    /// Search partition request JSON
    SearchPartition(Box<web::Json<SearchPartitionRequest>>),
    /// Values stream request JSON
    Values(Box<web::Json<ValuesRequest>>),
}

#[route(
    "/config",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
)]
pub async fn config(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

#[route(
    "/config/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
)]
pub async fn config_paths(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

#[route(
    "/api/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE",
    method = "PATCH"
)]
pub async fn api(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

#[route(
    "/aws/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
)]
pub async fn aws(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

#[route(
    "/gcp/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
)]
pub async fn gcp(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

#[route("/rum/{path:.*}", method = "POST")]
pub async fn rum(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

/// Main dispatch function that routes requests to appropriate backend nodes.
async fn dispatch(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
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
        return handle_node_list_request(&req).await;
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
            return Ok(HttpResponse::ServiceUnavailable().force_close().body(error));
        }
    };

    // Route based on request type
    if cfg.common.result_cache_enabled && is_querier_route_by_body(&path) {
        proxy_with_body_routing(req, payload, target, start).await
    } else {
        proxy_request(req, payload, target, start).await
    }
}

/// Handles the special node list API request locally.
async fn handle_node_list_request(req: &HttpRequest) -> actix_web::Result<HttpResponse, Error> {
    let query =
        web::Query::<std::collections::HashMap<String, String>>::from_query(req.query_string())
            .ok()
            .map(|x| x.into_inner())
            .unwrap_or_default();

    crate::handler::http::request::organization::org::node_list_impl(META_ORG_ID, query)
        .await
        .map_err(|e| {
            Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                format!("Failed to get node list: {e}"),
            )))
        })
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
    let role_group = web::Query::<HashMap<String, String>>::from_query(query_str)
        .map(|params| {
            get_search_type_from_request(&params)
                .unwrap_or(None)
                .map(RoleGroup::from)
                .unwrap_or(RoleGroup::Interactive)
        })
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
async fn proxy_request(
    req: HttpRequest,
    payload: web::Payload,
    target: ProxyTarget,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let query_path = extract_path_without_query(&target.path);
    let is_streaming = is_streaming_endpoint(query_path);
    let headers = build_request_headers(&req, is_streaming);

    // Read request body
    let body = payload.to_bytes().await.map_err(|e| {
        log::error!("Failed to read request body: {:?}", e);
        into_payload_error("Failed to read request body")
    })?;

    // Build upstream request
    let client = get_http_client();
    let upstream_req = match *req.method() {
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
        _ => return Ok(HttpResponse::MethodNotAllowed().finish()),
    };

    send_and_respond(upstream_req, &target, is_streaming, start).await
}

/// Proxies a request without body (for fallback cases).
async fn proxy_request_no_body(
    req: HttpRequest,
    target: ProxyTarget,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let query_path = extract_path_without_query(&target.path);
    let is_streaming = is_streaming_endpoint(query_path);
    let headers = build_request_headers(&req, is_streaming);

    let client = get_http_client();
    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let upstream_req = client.request(method, &target.full_url).headers(headers);

    send_and_respond(upstream_req, &target, is_streaming, start).await
}

/// Proxies a querier request with body-based routing for consistent hashing.
async fn proxy_with_body_routing(
    req: HttpRequest,
    payload: web::Payload,
    mut target: ProxyTarget,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let query_path = extract_path_without_query(&target.path);

    // Parse request payload based on endpoint type
    let (routing_key, querier_payload) =
        match parse_querier_payload(&req, payload, query_path).await? {
            Some(result) => result,
            None => {
                // Fall back to default proxy without payload
                return proxy_request_no_body(req, target, start).await;
            }
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
        return Ok(HttpResponse::ServiceUnavailable()
            .force_close()
            .body("No online querier nodes"));
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
        return Ok(HttpResponse::ServiceUnavailable()
            .force_close()
            .body("No online querier nodes"));
    };
    target.full_url = format!("{}{}", node.http_addr, target.path);
    target.node_addr = node
        .http_addr
        .replace("http://", "")
        .replace("https://", "");

    let is_streaming = is_streaming_endpoint(query_path);
    let headers = build_request_headers(&req, is_streaming);
    let client = get_http_client();

    // Build upstream request based on payload type
    let upstream_req = match querier_payload {
        QuerierPayload::Empty => client.get(&target.full_url).headers(headers),
        QuerierPayload::PromQL(form) => client
            .post(&target.full_url)
            .headers(headers)
            .form(&form.into_inner()),
        QuerierPayload::Search(json) => client
            .post(&target.full_url)
            .headers(headers)
            .json(&json.into_inner()),
        QuerierPayload::SearchPartition(json) => client
            .post(&target.full_url)
            .headers(headers)
            .json(&json.into_inner()),
        QuerierPayload::Values(json) => client
            .post(&target.full_url)
            .headers(headers)
            .json(&json.into_inner()),
    };

    send_and_respond(upstream_req, &target, is_streaming, start).await
}

/// Parses the request payload for querier routing.
async fn parse_querier_payload(
    req: &HttpRequest,
    payload: web::Payload,
    query_path: &str,
) -> actix_web::Result<Option<(String, QuerierPayload)>, Error> {
    let result = match query_path {
        // PromQL endpoints
        s if s.ends_with("/prometheus/api/v1/query_range")
            || s.ends_with("/prometheus/api/v1/query_exemplars") =>
        {
            parse_promql_payload(req, payload).await?
        }

        // Values stream endpoint
        s if s.ends_with("/_values_stream") => {
            let body = read_payload_bytes(payload, "values stream").await?;
            let query = json::from_slice::<ValuesRequest>(&body).map_err(|_| {
                Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                    "Failed to parse values stream request",
                )))
            })?;
            Some((
                query.sql.to_string(),
                QuerierPayload::Values(Box::new(web::Json(query))),
            ))
        }

        // Search endpoints
        s if s.ends_with("/_search") || s.ends_with("/_search_stream") => {
            let body = read_payload_bytes(payload, "search").await?;
            let query = json::from_slice::<SearchRequest>(&body).map_err(|_| {
                Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                    "Failed to parse search request",
                )))
            })?;
            Some((
                query.query.sql.to_string(),
                QuerierPayload::Search(Box::new(web::Json(query))),
            ))
        }

        // Search partition endpoint
        s if s.ends_with("/_search_partition") => {
            let body = read_payload_bytes(payload, "search partition").await?;
            let query = json::from_slice::<SearchPartitionRequest>(&body).map_err(|_| {
                Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                    "Failed to parse search partition request",
                )))
            })?;
            Some((
                query.sql.to_string(),
                QuerierPayload::SearchPartition(Box::new(web::Json(query))),
            ))
        }

        // Unknown endpoint - fall back to default proxy
        _ => None,
    };

    Ok(result)
}

/// Parses PromQL request payload.
async fn parse_promql_payload(
    req: &HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<Option<(String, QuerierPayload)>, Error> {
    if req.method() == Method::GET {
        let query =
            web::Query::<RequestRangeQuery>::from_query(req.query_string()).map_err(|_| {
                Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                    "Failed to parse query string",
                )))
            })?;
        Ok(Some((
            query.query.clone().unwrap_or_default(),
            QuerierPayload::Empty,
        )))
    } else {
        let form = web::Form::<RequestRangeQuery>::from_request(req, &mut payload.into_inner())
            .await
            .map_err(|_| {
                Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                    "Failed to parse form data",
                )))
            })?;
        Ok(Some((
            form.query.clone().unwrap_or_default(),
            QuerierPayload::PromQL(form),
        )))
    }
}

/// Sends the upstream request and builds the response.
async fn send_and_respond(
    upstream_req: reqwest::RequestBuilder,
    target: &ProxyTarget,
    is_streaming: bool,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let resp = upstream_req.send().await.map_err(|e| {
        log::error!(
            "proxy request failed: {} -> {}, error: {:?}, took: {} ms",
            target.path,
            target.node_addr,
            e,
            start.elapsed().as_millis()
        );
        into_payload_error(e.to_string())
    })?;

    let mut builder = build_response_headers(&resp, is_streaming);

    if is_streaming {
        let stream = resp
            .bytes_stream()
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));
        Ok(builder.streaming(stream))
    } else {
        let body = resp.bytes().await.map_err(|e| {
            log::error!(
                "proxy response failed: {} -> {}, error: {:?}, took: {} ms",
                target.path,
                target.node_addr,
                e,
                start.elapsed().as_millis()
            );
            into_payload_error(e.to_string())
        })?;
        Ok(builder.body(body))
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
fn build_request_headers(req: &HttpRequest, is_streaming: bool) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();

    for (key, value) in req.headers() {
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
            headers.insert(name, val);
        }
    }

    // For streaming endpoints, request uncompressed response
    if is_streaming {
        headers.insert(
            reqwest::header::ACCEPT_ENCODING,
            reqwest::header::HeaderValue::from_static("identity"),
        );
    }

    headers
}

/// Builds response headers from the upstream response.
fn build_response_headers(
    resp: &reqwest::Response,
    is_streaming: bool,
) -> actix_web::HttpResponseBuilder {
    let status = actix_web::http::StatusCode::from_u16(resp.status().as_u16())
        .unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR);
    let mut builder = HttpResponse::build(status);

    let skip_headers = if is_streaming {
        SKIP_RESPONSE_HEADERS_STREAMING
    } else {
        SKIP_RESPONSE_HEADERS_NORMAL
    };

    for (key, value) in resp.headers() {
        if skip_headers.contains(&key.as_str()) {
            continue;
        }

        if let (Ok(name), Ok(val)) = (
            actix_web::http::header::HeaderName::from_bytes(key.as_ref()),
            actix_web::http::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            builder.insert_header((name, val));
        }
    }

    // Add streaming-specific headers
    if is_streaming {
        builder.insert_header((header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"));
        builder.insert_header((header::PRAGMA, "no-cache"));
        builder.insert_header((header::CONNECTION, "keep-alive"));
        builder.insert_header(("X-Accel-Buffering", "no"));
    }

    builder
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
async fn read_payload_bytes(
    payload: web::Payload,
    request_type: &str,
) -> actix_web::Result<web::Bytes, Error> {
    payload.to_bytes().await.map_err(|e| {
        log::error!("Failed to read {request_type} request body: {e}");
        into_payload_error(format!("Failed to read {request_type} request body"))
    })
}

/// Converts a message into a payload error.
fn into_payload_error(msg: impl Into<String>) -> Error {
    Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
        msg.into(),
    )))
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

// Copyright 2025 OpenObserve Inc.
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

use ::config::{
    get_config,
    meta::{
        cluster::{Role, RoleGroup},
        promql::RequestRangeQuery,
        search::{Request as SearchRequest, SearchPartitionRequest},
    },
    router::{INGESTER_ROUTES, is_fixed_querier_route, is_querier_route, is_querier_route_by_body},
    utils::{json, rand::get_rand_element},
};
use actix_web::{
    FromRequest, HttpRequest, HttpResponse,
    http::{Error, Method},
    route, web,
};
use hashbrown::HashMap;
pub use ws::remove_querier_from_handler;

use crate::common::{infra::cluster, utils::http::get_search_type_from_request};

pub(crate) mod ws;

struct URLDetails {
    is_error: bool,
    error: Option<String>,
    path: String,
    full_url: String,
    node_addr: String,
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
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
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
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
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
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
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
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
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
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
}

#[route(
    "/rum/{path:.*}",
    // method = "GET",
    method = "POST",
)]
pub async fn rum(
    req: HttpRequest,
    payload: web::Payload,
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload, client).await
}

async fn dispatch(
    req: HttpRequest,
    payload: web::Payload,
    client: web::Data<awc::Client>,
) -> actix_web::Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    // get online nodes
    let path = req
        .uri()
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let new_url = get_url(&path).await;
    if new_url.is_error {
        return Ok(HttpResponse::ServiceUnavailable()
            .force_close()
            .body(new_url.error.unwrap_or("internal server error".to_string())));
    }

    // check if the request is a websocket request
    let path_columns: Vec<&str> = path.split('/').collect();
    if *path_columns.get(3).unwrap_or(&"") == "ws"
        && INGESTER_ROUTES
            .iter()
            .all(|ingest_route| !path.ends_with(ingest_route))
    {
        return proxy_ws(req, payload, start).await;
    }

    // check if the request need to be proxied by body
    if (cfg.common.result_cache_enabled || cfg.common.metrics_cache_enabled)
        && is_querier_route_by_body(&path)
    {
        return proxy_querier_by_body(req, payload, client, new_url, start).await;
    }

    // send query
    default_proxy(req, payload, client, new_url, start).await
}

async fn get_url(path: &str) -> URLDetails {
    let node_type;
    let is_querier_path = is_querier_route(path);

    let nodes = if is_querier_path {
        node_type = Role::Querier;
        let query_str = path[path.find("?").unwrap_or(path.len())..].to_string();
        let role_group = web::Query::<HashMap<String, String>>::from_query(&query_str)
            .map(|query_params| {
                get_search_type_from_request(&query_params)
                    .unwrap_or(None)
                    .map(RoleGroup::from)
                    .unwrap_or(RoleGroup::Interactive)
            })
            .unwrap_or(RoleGroup::Interactive);
        let nodes = cluster::get_cached_online_querier_nodes(Some(role_group)).await;
        if is_fixed_querier_route(path) && nodes.is_some() && !nodes.as_ref().unwrap().is_empty() {
            nodes.map(|v| v.into_iter().take(1).collect())
        } else {
            nodes
        }
    } else {
        node_type = Role::Ingester;
        cluster::get_cached_schedulable_ingester_nodes().await
    };

    if nodes.is_none() || nodes.as_ref().unwrap().is_empty() {
        return URLDetails {
            is_error: true,
            error: Some(format!("No online {node_type} nodes")),
            path: path.to_string(),
            full_url: "".to_string(),
            node_addr: "".to_string(),
        };
    }

    let nodes = nodes.unwrap();
    let node = cluster::select_best_node(&nodes).unwrap_or(get_rand_element(&nodes));
    URLDetails {
        is_error: false,
        error: None,
        path: path.to_string(),
        full_url: format!("{}{}", node.http_addr, path),
        node_addr: node
            .http_addr
            .replace("http://", "")
            .replace("https://", ""),
    }
}

async fn default_proxy(
    req: HttpRequest,
    payload: web::Payload,
    client: web::Data<awc::Client>,
    new_url: URLDetails,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    // send query
    let req = create_proxy_request(client, req, &new_url).await?;
    let mut resp = match req.send_stream(payload).await {
        Ok(resp) => resp,
        Err(e) => {
            log::error!(
                "dispatch: {} to {}, proxy request error: {:?}, took: {} ms",
                new_url.path,
                new_url.node_addr,
                e,
                start.elapsed().as_millis()
            );
            return Ok(HttpResponse::ServiceUnavailable()
                .force_close()
                .body(e.to_string()));
        }
    };

    // handle response
    let mut new_resp = HttpResponse::build(resp.status());

    // copy headers
    for (key, value) in resp.headers() {
        if !key.eq("content-encoding") {
            new_resp.insert_header((key.clone(), value.clone()));
        }
    }

    // set body
    let body = match resp
        .body()
        .limit(get_config().limit.req_payload_limit)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            log::error!(
                "dispatch: {} to {}, proxy response error: {:?}, took: {} ms",
                new_url.path,
                new_url.node_addr,
                e,
                start.elapsed().as_millis()
            );
            return Ok(HttpResponse::ServiceUnavailable()
                .force_close()
                .body(e.to_string()));
        }
    };
    Ok(new_resp.body(body))
}

enum ProxyPayload {
    None,
    PromQLQuery(web::Form<RequestRangeQuery>),
    SearchRequest(Box<web::Json<SearchRequest>>),
    SearchPartitionRequest(Box<web::Json<SearchPartitionRequest>>),
}

async fn proxy_querier_by_body(
    req: HttpRequest,
    payload: web::Payload,
    client: web::Data<awc::Client>,
    mut new_url: URLDetails,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let p = new_url.path.find("?").unwrap_or(new_url.path.len());
    let query_str = &new_url.path[..p];
    log::debug!("proxy_querier_by_body checking query_str: {}", query_str);
    let (key, payload) = if query_str.ends_with("/prometheus/api/v1/query_range")
        || query_str.ends_with("/prometheus/api/v1/query_exemplars")
    {
        if req.method() == Method::GET {
            let Ok(query) = web::Query::<RequestRangeQuery>::from_query(req.query_string()) else {
                return Ok(HttpResponse::BadRequest().body("Failed to parse query string"));
            };
            (query.query.clone().unwrap_or_default(), ProxyPayload::None)
        } else {
            let Ok(query) =
                web::Form::<RequestRangeQuery>::from_request(&req, &mut payload.into_inner()).await
            else {
                return Ok(HttpResponse::BadRequest().body("Failed to parse form data"));
            };
            (
                query.query.clone().unwrap_or_default(),
                ProxyPayload::PromQLQuery(query),
            )
        }
    } else if query_str.ends_with("/_search") {
        let body = payload.to_bytes().await.map_err(|e| {
            log::error!("Failed to parse search request data: {:?}", e);
            Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                "Failed to parse search request data",
            )))
        })?;
        let Ok(query) = json::from_slice::<SearchRequest>(&body) else {
            return Ok(HttpResponse::BadRequest().body("Failed to parse search request"));
        };
        (
            query.query.sql.to_string(),
            ProxyPayload::SearchRequest(Box::new(web::Json(query))),
        )
    } else if query_str.ends_with("/_search_partition") {
        let body = payload.to_bytes().await.map_err(|e| {
            log::error!("Failed to parse search partition request data: {:?}", e);
            Error::from(actix_http::error::PayloadError::Io(std::io::Error::other(
                "Failed to parse search partition request data",
            )))
        })?;
        let Ok(query) = json::from_slice::<SearchPartitionRequest>(&body) else {
            return Ok(HttpResponse::BadRequest().body("Failed to parse search request"));
        };
        (
            query.sql.to_string(),
            ProxyPayload::SearchPartitionRequest(Box::new(web::Json(query))),
        )
    } else {
        return default_proxy(req, payload, client, new_url, start).await;
    };

    // get node name by consistent hash
    let Some(node_name) = cluster::get_node_from_consistent_hash(&key, &Role::Querier, None).await
    else {
        return Ok(HttpResponse::ServiceUnavailable()
            .force_close()
            .body("No online querier nodes"));
    };

    // get node by name
    let Some(node) = cluster::get_cached_node_by_name(&node_name).await else {
        return Ok(HttpResponse::ServiceUnavailable()
            .force_close()
            .body("No online querier nodes"));
    };
    new_url.full_url = format!("{}{}", node.http_addr, new_url.path);
    new_url.node_addr = node
        .http_addr
        .replace("http://", "")
        .replace("https://", "");

    // send query
    let req = create_proxy_request(client, req, &new_url).await?;
    let resp = match payload {
        ProxyPayload::None => req.send().await,
        ProxyPayload::PromQLQuery(payload) => req.send_form(&payload).await,
        ProxyPayload::SearchRequest(payload) => req.send_json(&payload).await,
        ProxyPayload::SearchPartitionRequest(payload) => req.send_json(&payload).await,
    };
    let mut resp = match resp {
        Ok(resp) => resp,
        Err(e) => {
            log::error!(
                "dispatch: {} to {}, proxy request error: {:?}, took: {} ms",
                new_url.path,
                new_url.node_addr,
                e,
                start.elapsed().as_millis()
            );
            return Ok(HttpResponse::ServiceUnavailable()
                .force_close()
                .body(e.to_string()));
        }
    };

    // handle response
    let mut new_resp = HttpResponse::build(resp.status());

    // copy headers
    for (key, value) in resp.headers() {
        if !key.eq("content-encoding") {
            new_resp.insert_header((key.clone(), value.clone()));
        }
    }

    // set body
    let body = match resp
        .body()
        .limit(get_config().limit.req_payload_limit)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            log::error!(
                "dispatch: {} to {}, proxy response error: {:?}, took: {} ms",
                new_url.path,
                new_url.node_addr,
                e,
                start.elapsed().as_millis()
            );
            return Ok(HttpResponse::ServiceUnavailable()
                .force_close()
                .body(e.to_string()));
        }
    };
    Ok(new_resp.body(body))
}

async fn proxy_ws(
    req: HttpRequest,
    payload: web::Payload,
    start: std::time::Instant,
) -> actix_web::Result<HttpResponse, Error> {
    let cfg = get_config();
    if cfg.websocket.enabled {
        // Check if this is a WebSocket v2 request (e.g., contains a specific path segment or
        // header)
        let path = req.uri().path();
        // Extract client ID from the path or query parameters
        // Path format example: /api/{org_id}/ws/v2/{client_id}
        if path.contains("/ws/v2/") {
            let path_parts: Vec<&str> = path.split('/').collect();
            let client_id = path_parts[path_parts.len() - 1].to_string();

            log::info!(
                "[WS_ROUTER] Handling WS connection for client: {}, took: {} ms",
                client_id,
                start.elapsed().as_millis()
            );

            // Use the WebSocket v2 handler
            let ws_handler = ws::get_ws_handler().await;
            match ws_handler.handle_connection(req, payload, client_id).await {
                Ok(response) => Ok(response),
                Err(e) => {
                    log::error!("[WS_ROUTER] failed: {}", e);
                    Ok(HttpResponse::InternalServerError().body("WebSocket v2 error"))
                }
            }
        } else {
            log::info!(
                "[WS_ROUTER]: Node Role: {} Websocket is disabled",
                cfg.common.node_role
            );
            Ok(HttpResponse::NotFound().body("WebSocket is disabled"))
        }
    } else {
        log::info!(
            "[WS_ROUTER]: Node Role: {} Websocket is disabled",
            cfg.common.node_role
        );
        Ok(HttpResponse::NotFound().body("WebSocket is disabled"))
    }
}

async fn create_proxy_request(
    client: web::Data<awc::Client>,
    req: HttpRequest,
    new_url: &URLDetails,
) -> actix_web::Result<awc::ClientRequest, Error> {
    // get cookies
    let cookies = req
        .head()
        .headers
        .iter()
        .filter_map(|(key, value)| {
            if key.as_str() == "cookie" {
                Some(value.to_str().unwrap_or("").to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    // create request
    let mut req = if new_url.full_url.starts_with("https://") {
        create_http_client()
            .unwrap()
            .request_from(req.full_url().to_string(), req.head())
            .address(new_url.node_addr.parse().unwrap())
    } else {
        client.request_from(&new_url.full_url, req.head())
    };
    // set cookies
    if !cookies.is_empty() {
        req.headers_mut().insert(
            actix_web::http::header::COOKIE,
            actix_http::header::HeaderValue::from_str(&cookies.join("; ")).unwrap(),
        );
    }
    Ok(req)
}

pub fn create_http_client() -> Result<awc::Client, anyhow::Error> {
    let cfg = get_config();
    let mut client_builder = awc::Client::builder()
        .connector(awc::Connector::new().limit(cfg.route.max_connections))
        .timeout(std::time::Duration::from_secs(cfg.route.timeout))
        .disable_redirects();
    if cfg.http.tls_enabled {
        let tls_config = crate::service::tls::client_tls_config()?;
        client_builder = client_builder.connector(awc::Connector::new().rustls_0_23(tls_config));
    }
    Ok(client_builder.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_is_querier_route() {
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
    }

    #[test]
    fn test_router_is_querier_route_by_body() {
        assert!(is_querier_route_by_body("/prometheus/api/v1/query_range"));
        assert!(is_querier_route_by_body(
            "/prometheus/api/v1/query_exemplars"
        ));
        assert!(!is_querier_route_by_body("/prometheus/api/v1/query"));
    }
}

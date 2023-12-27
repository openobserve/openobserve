// Copyright 2023 Zinc Labs Inc.
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

use ::config::{meta::cluster::Role, CONFIG};
use actix_web::{http::Error, route, web, HttpRequest, HttpResponse};

use crate::common::{infra::cluster, utils::rand::get_rand_element};

const QUERIER_ROUTES: [&str; 13] = [
    "/summary",
    "/schema",
    "/streams",
    "/_search",
    "/_around",
    "/_values",
    "/api/cache/status",
    "/prometheus/api/v1/series",
    "/prometheus/api/v1/query_range",
    "/prometheus/api/v1/query",
    "/prometheus/api/v1/metadata",
    "/prometheus/api/v1/labels",
    "/prometheus/api/v1/label/",
];

#[inline]
fn check_querier_route(path: &str) -> bool {
    QUERIER_ROUTES.iter().any(|x| path.contains(x))
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
    "/api/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
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

#[route(
    "/rum/{path:.*}",
    // method = "GET",
    method = "POST",
)]
pub async fn rum(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    dispatch(req, payload).await
}

async fn dispatch(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    // get online nodes
    let path = req.uri().path_and_query().map(|x| x.as_str()).unwrap_or("");

    let client = awc::Client::builder()
        .connector(
            awc::Connector::new()
                .timeout(Duration::from_secs(CONFIG.route.timeout))
                .limit(0),
        )
        .timeout(Duration::from_secs(CONFIG.route.timeout))
        .finish();

    // send query
    let new_url = get_url(path);

    if new_url.is_error {
        return Ok(HttpResponse::ServiceUnavailable().body(new_url.value));
    }

    let resp = client
        .request_from(new_url.value.clone(), req.head())
        .send_stream(payload)
        .await;
    if resp.is_err() {
        let e = resp.unwrap_err();
        log::error!("{}: {}", new_url.value, e);
        return Ok(HttpResponse::ServiceUnavailable().body(e.to_string()));
    }

    // handle response
    let mut resp = resp.unwrap();
    let mut new_resp = HttpResponse::build(resp.status());

    // copy headers
    for (key, value) in resp.headers() {
        if !key.eq("content-encoding") {
            new_resp.insert_header((key.clone(), value.clone()));
        }
    }

    // set body
    let body = resp
        .body()
        .limit(CONFIG.limit.req_payload_limit)
        .await
        .unwrap();
    Ok(new_resp.body(body))
}

fn get_url(path: &str) -> URLDetails {
    let node_type;
    let is_querier_path = check_querier_route(path);

    let nodes = if is_querier_path {
        node_type = Role::Querier;
        cluster::get_cached_online_querier_nodes()
    } else {
        node_type = Role::Ingester;
        cluster::get_cached_online_ingester_nodes()
    };
    if nodes.is_none() || nodes.as_ref().unwrap().is_empty() {
        if node_type == Role::Ingester && !CONFIG.route.ingester_srv_url.is_empty() {
            return URLDetails {
                is_error: false,
                value: format!(
                    "http://{}:{}{}",
                    CONFIG.route.ingester_srv_url, CONFIG.http.port, path
                ),
            };
        }
        return URLDetails {
            is_error: true,
            value: format!("No online {node_type} nodes"),
        };
    }

    let nodes = nodes.unwrap();
    let node = get_rand_element(&nodes);
    URLDetails {
        is_error: false,
        value: format!("{}{}", node.http_addr, path),
    }
}

struct URLDetails {
    is_error: bool,
    value: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_querier_route() {
        assert!(check_querier_route("/api/_search"));
        assert!(check_querier_route("/api/_around"));
        assert!(!check_querier_route("/api/_bulk"));
    }
}

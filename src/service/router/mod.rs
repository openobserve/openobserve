// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::http::Error;
use actix_web::{route, web, HttpRequest, HttpResponse};
use rand::{seq::SliceRandom, thread_rng};
use std::time::Duration;

use crate::infra::cluster;
use crate::infra::config::CONFIG;

const QUERIER_ROUTES: [&str; 10] = [
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

async fn dispatch(
    req: HttpRequest,
    payload: web::Payload,
) -> actix_web::Result<HttpResponse, Error> {
    // get online nodes
    let path = req.uri().path_and_query().map(|x| x.as_str()).unwrap_or("");
    let nodes = if check_querier_route(path) {
        cluster::get_cached_online_querier_nodes()
    } else {
        cluster::get_cached_online_ingester_nodes()
    };
    if nodes.is_none() {
        return Ok(HttpResponse::ServiceUnavailable().body("No online nodes"));
    }

    // checking nodes
    let mut nodes = nodes.unwrap();
    if nodes.is_empty() {
        log::error!("Not found online nodes, restaring...");
        std::process::exit(1);
    }

    // random nodes
    let mut rng = thread_rng();
    nodes.shuffle(&mut rng);

    let client = awc::Client::builder()
        .connector(
            awc::Connector::new()
                .timeout(Duration::from_secs(CONFIG.route.timeout))
                .limit(0),
        )
        .timeout(Duration::from_secs(CONFIG.route.timeout))
        .finish();

    // send query
    let node = nodes.first().unwrap();
    let new_url = format!("{}{}", node.http_addr, path);
    let resp = client
        .request_from(new_url.clone(), req.head())
        .send_stream(payload)
        .await;
    if resp.is_err() {
        let e = resp.unwrap_err();
        log::error!("{}: {}", new_url, e);
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

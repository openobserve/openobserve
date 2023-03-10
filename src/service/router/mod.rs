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
use awc::Client;
use rand::seq::SliceRandom;
use rand::thread_rng;

use crate::infra::cluster;
use crate::infra::config::CONFIG;

#[inline]
pub fn is_router() -> bool {
    cluster::is_router(&cluster::load_local_node_role().to_vec())
}

#[inline]
fn check_search_route(path: &str) -> bool {
    if path.contains(format!("{}/_search", CONFIG.common.base_uri).as_str()) {
        return true;
    }
    if path.contains(format!("{}/_around", CONFIG.common.base_uri).as_str()) {
        return true;
    }
    if path.eq(format!("{}/api/cache/status", CONFIG.common.base_uri).as_str()) {
        return true;
    }
    false
}

#[route(
    "/api/{path:.*}",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "DELETE"
)]
pub async fn dispatch(
    req: HttpRequest,
    payload: web::Payload,
    client: web::Data<Client>,
) -> actix_web::Result<HttpResponse, Error> {
    // get online nodes
    let path = req.uri().path_and_query().map(|x| x.as_str()).unwrap_or("");
    let nodes = if check_search_route(path) {
        cluster::get_cached_online_querier_nodes()
    } else {
        cluster::get_cached_online_ingester_nodes()
    };
    if nodes.is_none() {
        return Ok(HttpResponse::ServiceUnavailable().body("No online nodes"));
    }

    // random nodes
    let mut nodes = nodes.unwrap();
    let mut rng = thread_rng();
    nodes.shuffle(&mut rng);

    let node = nodes.first().unwrap();
    let new_url = format!("{}{}", node.http_addr, path);

    // send query
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
        if key.eq("content-encoding") {
            continue;
        }
        new_resp.insert_header((key.clone(), value.clone()));
    }
    // set body
    let body = resp
        .body()
        .limit(CONFIG.limit.req_payload_limit)
        .await
        .unwrap();
    let new_resp = new_resp.body(body);

    Ok(new_resp)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_is_router() {
        let is_router = is_router();
        assert_eq!(is_router, false);
    }
    #[test]
    fn test_check_search_route() {
        let is_search_route = check_search_route("/api/_search");
        assert_eq!(is_search_route, true);
        let is_search_route = check_search_route("/api/_around");
        assert_eq!(is_search_route, true);
        let is_search_route = check_search_route("/api/cache/status");
        assert_eq!(is_search_route, true);
        let is_search_route = check_search_route("/api/_bulk");
        assert_eq!(is_search_route, false);
    }
}

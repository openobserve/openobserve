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

use actix_web::http::{self, StatusCode};
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use chrono::Duration;
use std::collections::HashMap;
use std::io::Error;
use std::sync::Mutex;

use crate::common::http::get_stream_type_from_request;
use crate::infra::config::{CONFIG, LOCKER};
use crate::meta;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::StreamType;
use crate::service::search as SearchService;

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchSQL",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = SearchRequest, description = "Search query", content_type = "application/json", example = json!({
        "query": {
            "sql": "select * from k8s ",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "from": 0,
            "size": 10
        },
        "aggs": {
            "histogram": "select histogram(_timestamp, '30 second') AS key, count(*) AS num from query GROUP BY key ORDER BY key"
        }
    })),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "hits": [
                {
                    "_p": "F",
                    "_timestamp": 1674213225158000i64,
                    "kubernetes": {
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/zincobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/zincobserve:v0.0.3",
                        "container_name": "zincobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "zincobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "zincobserve-ingester-0"
                    },
                    "log": "[2023-01-20T11:13:45Z INFO  actix_web::middleware::logger] 10.2.80.192 \"POST /api/demo/_bulk HTTP/1.1\" 200 68",
                    "stream": "stderr"
                }
            ],
            "aggs": {
                "agg1": [
                    {
                        "key": "2023-01-15 14:00:00",
                        "num": 345940
                    },
                    {
                        "key": "2023-01-15 19:00:00",
                        "num": 384026
                    }
                ]
            },
            "total": 27179431,
            "from": 0,
            "size": 1,
            "scan_size": 28943
        })),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_search")]
pub async fn search(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(e.to_string()),
            )))
        }
    };
    let req: meta::search::Request = serde_json::from_slice(&body)?;

    // get a local search queue lock
    let locker = LOCKER
        .entry("search/local_queue".to_string())
        .or_insert(Mutex::new(true));
    let _locker = locker.lock();

    // do search
    match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => {
            log::error!("search error: {:?}", err);
            Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            )
        }
    }
}

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchAround",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "stream_name name"),
        ("key" = i64, Query, description = "around key"),
        ("size" = i64, Query, description = "around size"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "hits": [
                {
                    "_p": "F",
                    "_timestamp": 1674213225158000i64,
                    "kubernetes": {
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/zincobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/zincobserve:v0.0.3",
                        "container_name": "zincobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "zincobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "zincobserve-ingester-0"
                    },
                    "log": "[2023-01-20T11:13:45Z INFO  actix_web::middleware::logger] 10.2.80.192 \"POST /api/demo/_bulk HTTP/1.1\" 200 68",
                    "stream": "stderr"
                }
            ],
            "total": 10,
            "from": 0,
            "size": 10,
            "scan_size": 28943
        })),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/_around")]
pub async fn around(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(e.to_string()),
            )))
        }
    };

    let around_key = match query.get("key") {
        Some(v) => v.parse::<i64>().unwrap_or(0),
        None => 0,
    };
    let around_size = match query.get("size") {
        Some(v) => v.parse::<usize>().unwrap_or(0),
        None => 0,
    };

    // get a local search queue lock
    let locker = LOCKER
        .entry("search/local_queue".to_string())
        .or_insert(Mutex::new(true));
    let _locker = locker.lock();

    // search forward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: format!(
                "SELECT * FROM {} ORDER BY {} DESC",
                stream_name, CONFIG.common.time_stamp_col
            ),
            from: 0,
            size: around_size / 2,
            start_time: around_key - Duration::seconds(300).num_microseconds().unwrap(),
            end_time: around_key,
            sql_mode: "context".to_string(),
            track_total_hits: false,
        },
        aggs: HashMap::new(),
    };
    let resp_forward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            log::error!("search error: {:?}", err);
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            );
        }
    };

    // search backward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: format!(
                "SELECT * FROM {} ORDER BY {} ASC",
                stream_name, CONFIG.common.time_stamp_col
            ),
            from: 0,
            size: around_size / 2,
            start_time: around_key,
            end_time: around_key + Duration::seconds(300).num_microseconds().unwrap(),
            sql_mode: "context".to_string(),
            track_total_hits: false,
        },
        aggs: HashMap::new(),
    };
    let resp_backward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            log::error!("search error: {:?}", err);
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            );
        }
    };

    // merge
    let mut resp = meta::search::Response::default();
    let hits_num = resp_backward.hits.len();
    for i in 0..hits_num {
        resp.hits
            .push(resp_backward.hits[hits_num - 1 - i].to_owned());
    }
    let hits_num = resp_forward.hits.len();
    for i in 0..hits_num {
        resp.hits.push(resp_forward.hits[i].to_owned());
    }
    resp.total = resp.hits.len();
    resp.size = around_size;
    resp.scan_size = resp_forward.scan_size + resp_backward.scan_size;
    resp.took = resp_forward.took + resp_backward.took;

    Ok(HttpResponse::Ok().json(resp))
}

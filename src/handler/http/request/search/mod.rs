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

use actix_web::http::StatusCode;
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use ahash::AHashMap;
use chrono::Duration;
use std::collections::HashMap;
use std::io::Error;

use crate::common::base64;
use crate::common::functions;
use crate::common::http::get_stream_type_from_request;
use crate::common::infra::config::CONFIG;
use crate::common::infra::{errors, metrics};
use crate::common::json;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;
use crate::common::meta::usage::{RequestStats, UsageType};
use crate::common::meta::{self, StreamType};
use crate::service::search as SearchService;
use crate::service::usage::report_request_usage_stats;

/** SearchStreamData*/
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
            "histogram": "select histogram(_timestamp, '30 second') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key"
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
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/openobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
                        "container_name": "openobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "openobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "openobserve-ingester-0"
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_search")]
pub async fn search(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let org_id = org_id.into_inner();
    let query = web::Query::<AHashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(bad_request(e)),
    };

    // handle encoding for query and aggs
    let mut req: meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(bad_request(e)),
    };
    if let Err(e) = req.decode() {
        return Ok(bad_request(e));
    }

    req.query.query_fn = req.query.query_fn.and_then(|v| base64::decode(&v).ok());

    for fn_name in functions::get_all_transform_keys(&org_id).await {
        if req.query.sql.contains(&fn_name) {
            req.query.uses_zo_fn = true;
            break;
        }
    }

    // get a local search queue lock
    let locker = SearchService::QUEUE_LOCKER.clone();
    let _locker = locker.lock().await;
    let took_wait = start.elapsed().as_millis() as usize;

    // do search
    match SearchService::search(&org_id, stream_type, &req).await {
        Ok(mut res) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search",
                    "200",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search",
                    "200",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .inc();
            res.set_local_took(start.elapsed().as_millis() as usize, took_wait);

            let req_stats = RequestStats {
                records: res.hits.len() as u64,
                response_time: time,
                size: res.scan_size as f64,
                request_body: Some(req.query.sql),
                ..Default::default()
            };
            let num_fn = req.query.query_fn.is_some() as u16;
            report_request_usage_stats(
                req_stats,
                &org_id,
                "", // TODO see if we can steam name
                StreamType::Logs,
                UsageType::Search,
                num_fn,
            )
            .await;
            Ok(HttpResponse::Ok().json(res))
        }
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search",
                    "500",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search",
                    "500",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search error: {:?}", err);
            Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                    .json(meta::http::HttpResponse::error_code(code)),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            })
        }
    }
}

/** SearchAround*/
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
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/openobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
                        "container_name": "openobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "openobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "openobserve-ingester-0"
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/_around")]
pub async fn around(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let mut uses_fn = false;
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<AHashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(bad_request(e)),
    };

    let around_key = match query.get("key") {
        Some(v) => v.parse::<i64>().unwrap_or(0),
        None => return Ok(bad_request("around key is empty")),
    };
    let query_fn = query.get("query_fn").and_then(|v| base64::decode(v).ok());

    let default_sql = format!("SELECT * FROM \"{}\" ", stream_name);
    let around_sql = match query.get("sql") {
        None => default_sql,
        Some(v) => match base64::decode(v) {
            Err(_) => default_sql,
            Ok(v) => {
                uses_fn = functions::get_all_transform_keys(&org_id)
                    .await
                    .iter()
                    .any(|fn_name| v.contains(fn_name));
                if uses_fn {
                    v
                } else {
                    default_sql
                }
            }
        },
    };

    let around_size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(0));

    // get a local search queue lock
    let locker = SearchService::QUEUE_LOCKER.clone();
    let _locker = locker.lock().await;
    let query_context = if uses_fn {
        Some(around_sql.clone())
    } else {
        None
    };

    // search forward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: around_sql.clone(),
            from: 0,
            size: around_size / 2,
            start_time: around_key - Duration::seconds(900).num_microseconds().unwrap(),
            end_time: around_key,
            sort_by: Some(format!("{} DESC", CONFIG.common.column_timestamp)),
            sql_mode: "context".to_string(),
            query_type: "logs".to_string(),
            track_total_hits: false,
            query_context: query_context.clone(),
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    let resp_forward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_around",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_around",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search around error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                    .json(meta::http::HttpResponse::error_code(code)),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    // search backward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: around_sql.clone(),
            from: 0,
            size: around_size / 2,
            start_time: around_key,
            end_time: around_key + Duration::seconds(900).num_microseconds().unwrap(),
            sort_by: Some(format!("{} ASC", CONFIG.common.column_timestamp)),
            sql_mode: "context".to_string(),
            query_type: "logs".to_string(),
            track_total_hits: false,
            query_context,
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    let resp_backward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_around",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_around",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search around error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                    .json(meta::http::HttpResponse::error_code(code)),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
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

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/_around",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/_around",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();

    let req_stats = RequestStats {
        records: resp.hits.len() as u64,
        response_time: time,
        size: resp.scan_size as f64,
        request_body: Some(req.query.sql),
        ..Default::default()
    };
    let num_fn = req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        &org_id,
        &stream_name,
        StreamType::Logs,
        UsageType::SearchAround,
        num_fn,
    )
    .await;

    Ok(HttpResponse::Ok().json(resp))
}

/** SearchTopNValues */
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchValues",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "stream_name name"),
        ("fields" = String, Query, description = "fields, split by comma"),
        ("size" = i64, Query, description = "size"), // topN
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "values": [
                {
                    "field": "field1",
                    "values": ["value1", "value2"]
                }
            ]
        })),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/_values")]
pub async fn values(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let mut uses_fn = false;
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<AHashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(bad_request(e)),
    };

    let fields = match query.get("fields") {
        Some(v) => v.split(',').map(|s| s.to_string()).collect::<Vec<_>>(),
        None => return Ok(bad_request("fields is empty")),
    };
    let query_fn = query.get("query_fn").and_then(|v| base64::decode(v).ok());

    let default_sql = format!("SELECT * FROM \"{stream_name}\"");
    let query_context = match query.get("sql") {
        None => None,
        Some(v) => match base64::decode(v) {
            Err(_) => None,
            Ok(v) => {
                uses_fn = functions::get_all_transform_keys(&org_id)
                    .await
                    .iter()
                    .any(|fn_name| v.contains(fn_name));
                uses_fn.then_some(v)
            }
        },
    };

    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(0));
    let start_time = query
        .get("start_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if start_time == 0 {
        return Ok(bad_request("start_time is empty"));
    }
    let mut end_time = query
        .get("end_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if end_time == 0 {
        end_time = chrono::Utc::now().timestamp_micros();
    }

    // get a local search queue lock
    let locker = SearchService::QUEUE_LOCKER.clone();
    let _locker = locker.lock().await;

    // search
    let mut req = meta::search::Request {
        query: meta::search::Query {
            sql: default_sql.clone(),
            from: 0,
            size: 0,
            start_time,
            end_time,
            sort_by: None,
            sql_mode: "context".to_string(),
            query_type: "logs".to_string(),
            track_total_hits: false,
            query_context,
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };

    for field in &fields {
        req.aggs.insert(
                field.clone(),
                format!(
                    "SELECT {field} AS zo_sql_key, COUNT(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_num DESC LIMIT {size}"
                ),
            );
    }
    let resp_search = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_values",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_values",
                    "500",
                    &org_id,
                    &stream_name,
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search values error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                    .json(meta::http::HttpResponse::error_code(code)),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    let mut resp = meta::search::Response::default();
    let mut hit_values: Vec<json::Value> = Vec::new();
    for (key, values) in resp_search.aggs {
        let mut field_value: json::Map<String, json::Value> = json::Map::new();
        field_value.insert("field".to_string(), json::Value::String(key));
        field_value.insert("values".to_string(), json::Value::Array(values));
        hit_values.push(json::Value::Object(field_value));
    }
    resp.total = fields.len();
    resp.hits = hit_values;
    resp.size = size;
    resp.scan_size = resp_search.scan_size;
    resp.took = start.elapsed().as_millis() as usize;

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/_values",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/_values",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();

    let req_stats = RequestStats {
        records: resp.hits.len() as u64,
        response_time: time,
        size: resp.scan_size as f64,
        request_body: Some(req.query.sql),
        ..Default::default()
    };
    let num_fn = req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        &org_id,
        &stream_name,
        StreamType::Logs,
        UsageType::SearchTopNValues,
        num_fn,
    )
    .await;

    Ok(HttpResponse::Ok().json(resp))
}

fn bad_request(error: impl ToString) -> HttpResponse {
    HttpResponse::BadRequest().json(MetaHttpResponse::error(
        StatusCode::BAD_REQUEST.into(),
        error.to_string(),
    ))
}

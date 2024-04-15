// Copyright 2024 Zinc Labs Inc.
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

use std::{collections::HashMap, io::Error};

use actix_web::{get, http::StatusCode, post, web, HttpRequest, HttpResponse};
use chrono::Duration;
use config::{
    ider,
    meta::{
        stream::StreamType,
        usage::{RequestStats, UsageType},
    },
    metrics,
    utils::{base64, json},
    CONFIG, DISTINCT_FIELDS,
};
use infra::{errors, schema::STREAM_SCHEMAS};
use opentelemetry::{global, trace::TraceContextExt};
use tracing::{Instrument, Span};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::{
        meta::{self, http::HttpResponse as MetaHttpResponse},
        utils::{
            functions,
            http::{get_stream_type_from_request, RequestHeaderExtractor},
        },
    },
    service::{search as SearchService, usage::report_request_usage_stats},
};

pub mod job;
pub mod saved_view;

/// SearchStreamData
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
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
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
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
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

    let mut http_span = None;
    let trace_id = if CONFIG.common.tracing_enabled {
        let ctx = global::get_text_map_propagator(|propagator| {
            propagator.extract(&RequestHeaderExtractor::new(in_req.headers()))
        });
        ctx.span().span_context().trace_id().to_string()
    } else if CONFIG.common.tracing_search_enabled {
        let span = tracing::info_span!("/api/{org_id}/_search", org_id = org_id.clone());
        let trace_id = span.context().span().span_context().trace_id().to_string();
        http_span = Some(span);
        trace_id
    } else {
        ider::uuid()
    };

    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    // handle encoding for query and aggs
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };
    if let Err(e) = req.decode() {
        return Ok(MetaHttpResponse::bad_request(e));
    }

    let user_id = in_req.headers().get("user_id").unwrap();
    let mut rpc_req: proto::cluster_rpc::SearchRequest = req.to_owned().into();
    rpc_req.org_id = org_id.to_string();
    rpc_req.stream_type = stream_type.to_string();
    let stream_name = match config::meta::sql::Sql::new(&req.query.sql) {
        Ok(v) => v.source.to_string(),
        Err(e) => {
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            );
        }
    };

    // Check permissions on stream
    #[cfg(feature = "enterprise")]
    {
        use crate::common::{
            infra::config::USERS,
            utils::auth::{is_root_user, AuthExtractor},
        };

        if !is_root_user(user_id.to_str().unwrap()) {
            let user: meta::user::User = USERS
                .get(&format!("{org_id}/{}", user_id.to_str().unwrap()))
                .unwrap()
                .clone();

            if user.is_external
                && !crate::handler::http::auth::validator::check_permissions(
                    user_id.to_str().unwrap(),
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!("{}:{}", stream_type, stream_name),
                        org_id: org_id.clone(),
                        bypass_check: false,
                        parent_id: "".to_string(),
                    },
                    Some(user.role),
                )
                .await
            {
                return Ok(MetaHttpResponse::forbidden("Unauthorized Access"));
            }
        }
        // Check permissions on stream ends
    }

    let mut query_fn = req.query.query_fn.and_then(|v| base64::decode_url(&v).ok());

    if let Some(vrl_function) = &query_fn {
        if !vrl_function.trim().ends_with('.') {
            query_fn = Some(format!("{} \n .", vrl_function));
        }
    }
    req.query.query_fn = query_fn;

    for fn_name in functions::get_all_transform_keys(&org_id).await {
        if req.query.sql.contains(&format!("{}(", fn_name)) {
            req.query.uses_zo_fn = true;
            break;
        }
    }

    // get a local search queue lock
    #[cfg(not(feature = "enterprise"))]
    let locker = SearchService::QUEUE_LOCKER.clone();
    #[cfg(not(feature = "enterprise"))]
    let locker = locker.lock().await;
    #[cfg(not(feature = "enterprise"))]
    if !CONFIG.common.feature_query_queue_enabled {
        drop(locker);
    }
    #[cfg(not(feature = "enterprise"))]
    let took_wait = start.elapsed().as_millis() as usize;
    #[cfg(feature = "enterprise")]
    let took_wait = 0;

    let search_fut = SearchService::search(
        &trace_id,
        &org_id,
        stream_type,
        Some(user_id.to_str().unwrap().to_string()),
        &req,
    );
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.unwrap()).await
    } else {
        search_fut.await
    };

    // do search
    match search_res {
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
            res.set_trace_id(trace_id);
            res.set_local_took(start.elapsed().as_millis() as usize, took_wait);

            let req_stats = RequestStats {
                records: res.hits.len() as i64,
                response_time: time,
                size: res.scan_size as f64,
                request_body: Some(req.query.sql),
                user_email: Some(user_id.to_str().unwrap().to_string()),
                min_ts: Some(req.query.start_time),
                max_ts: Some(req.query.end_time),
                ..Default::default()
            };
            let num_fn = req.query.query_fn.is_some() as u16;
            report_request_usage_stats(
                req_stats,
                &org_id,
                &stream_name,
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
                errors::Error::ErrorCode(code) => match code {
                    errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests()
                        .json(meta::http::HttpResponse::error_code_with_trace_id(
                            code,
                            Some(trace_id),
                        )),
                    _ => HttpResponse::InternalServerError().json(
                        meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                    ),
                },
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            })
        }
    }
}

/// SearchAround
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
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
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
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/_around")]
pub async fn around(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let (org_id, stream_name) = path.into_inner();

    let mut http_span = None;
    let trace_id = if CONFIG.common.tracing_enabled {
        let ctx = global::get_text_map_propagator(|propagator| {
            propagator.extract(&RequestHeaderExtractor::new(in_req.headers()))
        });
        ctx.span().span_context().trace_id().to_string()
    } else if CONFIG.common.tracing_search_enabled {
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/_around",
            org_id = org_id.clone(),
            stream_name = stream_name.clone()
        );
        let trace_id = span.context().span().span_context().trace_id().to_string();
        http_span = Some(span);
        trace_id
    } else {
        ider::uuid()
    };

    let mut uses_fn = false;
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let around_key = match query.get("key") {
        Some(v) => v.parse::<i64>().unwrap_or(0),
        None => return Ok(MetaHttpResponse::bad_request("around key is empty")),
    };
    let query_fn = query
        .get("query_fn")
        .and_then(|v| base64::decode_url(v).ok());

    let default_sql = format!("SELECT * FROM \"{}\" ", stream_name);
    let around_sql = match query.get("sql") {
        None => default_sql,
        Some(v) => match base64::decode_url(v) {
            Err(_) => default_sql,
            Ok(v) => {
                uses_fn = functions::get_all_transform_keys(&org_id)
                    .await
                    .iter()
                    .any(|fn_name| v.contains(&format!("{}(", fn_name)));
                if uses_fn { v } else { default_sql }
            }
        },
    };

    let around_size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(10));

    // get a local search queue lock
    let locker = SearchService::QUEUE_LOCKER.clone();
    let _locker = locker.lock().await;

    // We don't need query_context now
    // let query_context = if uses_fn {
    //     Some(around_sql.clone())
    // } else {
    //     None
    // };
    let query_context: Option<String> = None;

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    let around_start_time = around_key
        - Duration::try_seconds(900)
            .unwrap()
            .num_microseconds()
            .unwrap();
    let around_end_time = around_key
        + Duration::try_seconds(900)
            .unwrap()
            .num_microseconds()
            .unwrap();

    // search forward
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: around_sql.clone(),
            from: 0,
            size: around_size / 2,
            start_time: around_start_time,
            end_time: around_key,
            sort_by: Some(format!("{} DESC", CONFIG.common.column_timestamp)),
            sql_mode: "".to_string(),
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            query_context: query_context.clone(),
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: config::meta::search::RequestEncoding::Empty,
        clusters: vec![],
        timeout,
    };
    let user_id = in_req
        .headers()
        .get("user_id")
        .unwrap()
        .to_str()
        .ok()
        .map(|v| v.to_string());
    let search_fut = SearchService::search(&trace_id, &org_id, stream_type, user_id.clone(), &req);
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.clone().unwrap()).await
    } else {
        search_fut.await
    };
    let resp_forward = match search_res {
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
                errors::Error::ErrorCode(code) => match code {
                    errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests()
                        .json(meta::http::HttpResponse::error_code_with_trace_id(
                            code,
                            Some(trace_id),
                        )),
                    _ => HttpResponse::InternalServerError().json(
                        meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                    ),
                },
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    // search backward
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: around_sql.clone(),
            from: 0,
            size: around_size / 2,
            start_time: around_key,
            end_time: around_end_time,
            sort_by: Some(format!("{} ASC", CONFIG.common.column_timestamp)),
            sql_mode: "".to_string(),
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            query_context,
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: config::meta::search::RequestEncoding::Empty,
        clusters: vec![],
        timeout,
    };
    let search_fut = SearchService::search(&trace_id, &org_id, stream_type, user_id, &req);
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.unwrap()).await
    } else {
        search_fut.await
    };
    let resp_backward = match search_res {
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
                errors::Error::ErrorCode(code) => match code {
                    errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests()
                        .json(meta::http::HttpResponse::error_code_with_trace_id(
                            code,
                            Some(trace_id),
                        )),
                    _ => HttpResponse::InternalServerError().json(
                        meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                    ),
                },
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    // merge
    let mut resp = config::meta::search::Response::default();
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

    let user_id = match in_req.headers().get("user_id") {
        Some(v) => v.to_str().unwrap(),
        None => "",
    };
    let req_stats = RequestStats {
        records: resp.hits.len() as i64,
        response_time: time,
        size: resp.scan_size as f64,
        request_body: Some(req.query.sql),
        user_email: Some(user_id.to_string()),
        min_ts: Some(around_start_time),
        max_ts: Some(around_end_time),
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

/// SearchTopNValues
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
        ("filter" = Option<String>, Query, description = "filter, eg: a=b"),
        ("keyword" = Option<String>, Query, description = "keyword, eg: abc"),
        ("size" = i64, Query, description = "size"), // topN
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "values": [
                {
                    "field": "field1",
                    "values": ["value1", "value2"]
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/_values")]
pub async fn values(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(meta::http::HttpResponse::bad_request(e)),
    };

    let fields = match query.get("fields") {
        Some(v) => v.split(',').map(|s| s.to_string()).collect::<Vec<_>>(),
        None => return Ok(MetaHttpResponse::bad_request("fields is empty")),
    };

    let query_context = match query.get("sql") {
        None => "".to_string(),
        Some(v) => base64::decode_url(v).unwrap_or("".to_string()),
    };
    let user_id = match in_req.headers().get("user_id") {
        Some(v) => v.to_str().unwrap(),
        None => "",
    };
    let mut http_span = None;
    let trace_id = if CONFIG.common.tracing_enabled {
        let ctx = global::get_text_map_propagator(|propagator| {
            propagator.extract(&RequestHeaderExtractor::new(in_req.headers()))
        });
        ctx.span().span_context().trace_id().to_string()
    } else if CONFIG.common.tracing_search_enabled {
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/_values",
            org_id = org_id.clone(),
            stream_name = stream_name.clone()
        );
        let trace_id = span.context().span().span_context().trace_id().to_string();
        http_span = Some(span);
        trace_id
    } else {
        ider::uuid()
    };
    if fields.len() == 1
        && DISTINCT_FIELDS.contains(&fields[0])
        && !query_context.to_lowercase().contains(" where ")
    {
        if let Some(v) = query.get("filter") {
            if !v.is_empty() {
                let column = v.splitn(2, '=').collect::<Vec<_>>();
                if DISTINCT_FIELDS.contains(&column[0].to_string()) {
                    // has filter and the filter can be used to distinct_values
                    return values_v2(
                        &org_id,
                        stream_type,
                        &stream_name,
                        &fields[0],
                        Some((column[0], column[1])),
                        &query,
                        user_id,
                        trace_id,
                        http_span,
                    )
                    .await;
                }
            } else {
                // no filter
                return values_v2(
                    &org_id,
                    stream_type,
                    &stream_name,
                    &fields[0],
                    None,
                    &query,
                    user_id,
                    trace_id,
                    http_span,
                )
                .await;
            }
        } else {
            // no filter
            return values_v2(
                &org_id,
                stream_type,
                &stream_name,
                &fields[0],
                None,
                &query,
                user_id,
                trace_id,
                http_span,
            )
            .await;
        }
    }

    values_v1(
        &org_id,
        stream_type,
        &stream_name,
        &query,
        user_id,
        trace_id,
        http_span,
    )
    .await
}

/// search in original data
async fn values_v1(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    query: &web::Query<HashMap<String, String>>,
    user_id: &str,
    trace_id: String,
    http_span: Option<Span>,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    let mut uses_fn = false;
    let fields = match query.get("fields") {
        Some(v) => v.split(',').map(|s| s.to_string()).collect::<Vec<_>>(),
        None => return Ok(MetaHttpResponse::bad_request("fields is empty")),
    };
    let mut query_fn = query
        .get("query_fn")
        .and_then(|v| base64::decode_url(v).ok());
    if let Some(vrl_function) = &query_fn {
        if !vrl_function.trim().ends_with('.') {
            query_fn = Some(format!("{} \n .", vrl_function));
        }
    }

    let default_sql = format!("SELECT * FROM \"{stream_name}\"");
    let mut query_sql = match query.get("filter") {
        None => default_sql,
        Some(v) => {
            if v.is_empty() {
                default_sql
            } else {
                format!("{} WHERE {v}", default_sql)
            }
        }
    };

    let mut query_context = match query.get("sql") {
        None => None,
        Some(v) => match base64::decode_url(v) {
            Err(_) => None,
            Ok(v) => {
                uses_fn = functions::get_all_transform_keys(org_id)
                    .await
                    .iter()
                    .any(|fn_name| v.contains(&format!("{}(", fn_name)));
                Some(v)
            }
        },
    };

    if query_context.is_some() {
        query_sql = query_context.clone().unwrap();
        // We don't need query_context now
        query_context = None;
    }

    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(10));
    let start_time = query
        .get("start_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if start_time == 0 {
        return Ok(MetaHttpResponse::bad_request("start_time is empty"));
    }
    let end_time = query
        .get("end_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if end_time == 0 {
        return Ok(MetaHttpResponse::bad_request("end_time is empty"));
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // get a local search queue lock
    let locker = SearchService::QUEUE_LOCKER.clone();
    let _locker = locker.lock().await;

    // search
    let mut req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql,
            from: 0,
            size: 0,
            start_time,
            end_time,
            sort_by: None,
            sql_mode: "".to_string(),
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            query_context,
            uses_zo_fn: uses_fn,
            query_fn: query_fn.clone(),
        },
        aggs: HashMap::new(),
        encoding: config::meta::search::RequestEncoding::Empty,
        clusters: vec![],
        timeout,
    };

    // skip fields which arent part of the schema
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    let r = STREAM_SCHEMAS.read().await;
    let schema = if let Some(schema) = r.get(&key) {
        schema.last().unwrap().clone()
    } else {
        arrow_schema::Schema::empty()
    };
    drop(r);

    for field in &fields {
        // skip values for field which aren't part of the schema
        if schema.field_with_name(field).is_err() {
            continue;
        }
        req.aggs.insert(
                field.clone(),
                format!(
                    "SELECT {field} AS zo_sql_key, COUNT(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_num DESC LIMIT {size}"
                ),
            );
    }
    let search_fut = SearchService::search(
        &trace_id,
        org_id,
        stream_type,
        Some(user_id.to_string()),
        &req,
    );
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.unwrap()).await
    } else {
        search_fut.await
    };
    let resp_search = match search_res {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_values/v1",
                    "500",
                    org_id,
                    stream_name,
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_values/v1",
                    "500",
                    org_id,
                    stream_name,
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search values error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => match code {
                    errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests()
                        .json(meta::http::HttpResponse::error_code_with_trace_id(
                            code,
                            Some(trace_id),
                        )),
                    _ => HttpResponse::InternalServerError().json(
                        meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                    ),
                },
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    let mut resp = config::meta::search::Response::default();
    let mut hit_values: Vec<json::Value> = Vec::new();
    for (key, val) in resp_search.aggs {
        let mut field_value: json::Map<String, json::Value> = json::Map::new();
        field_value.insert("field".to_string(), json::Value::String(key));
        field_value.insert("values".to_string(), json::Value::Array(val));
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
            "/api/org/_values/v1",
            "200",
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/_values/v1",
            "200",
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();

    let req_stats = RequestStats {
        records: resp.hits.len() as i64,
        response_time: time,
        size: resp.scan_size as f64,
        request_body: Some(req.query.sql),
        user_email: Some(user_id.to_string()),
        min_ts: Some(start_time),
        max_ts: Some(end_time),
        ..Default::default()
    };
    let num_fn = req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::SearchTopNValues,
        num_fn,
    )
    .await;

    Ok(HttpResponse::Ok().json(resp))
}

/// search in distinct data
#[allow(clippy::too_many_arguments)]
async fn values_v2(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    field: &str,
    filter: Option<(&str, &str)>,
    query: &web::Query<HashMap<String, String>>,
    user_id: &str,
    trace_id: String,
    http_span: Option<Span>,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    let mut query_sql = format!(
        "SELECT field_value AS zo_sql_key, SUM(count) as zo_sql_num FROM distinct_values WHERE stream_type='{}' AND stream_name='{}' AND field_name='{}'",
        stream_type, stream_name, field
    );
    if let Some((key, val)) = filter {
        let val = val.split(',').collect::<Vec<_>>().join("','");
        query_sql = format!(
            "{} AND filter_name='{}' AND filter_value IN ('{}')",
            query_sql, key, val
        );
    }
    if let Some(val) = query.get("keyword") {
        let val = val.trim();
        if !val.is_empty() {
            query_sql = format!("{} AND field_value ILIKE '%{}%'", query_sql, val);
        }
    }

    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(10));
    let start_time = query
        .get("start_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if start_time == 0 {
        return Ok(MetaHttpResponse::bad_request("start_time is empty"));
    }
    let end_time = query
        .get("end_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if end_time == 0 {
        return Ok(MetaHttpResponse::bad_request("end_time is empty"));
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // search
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: format!("{query_sql} GROUP BY zo_sql_key ORDER BY zo_sql_num DESC LIMIT {size}"),
            from: 0,
            size: 0,
            start_time,
            end_time,
            sort_by: None,
            sql_mode: "full".to_string(),
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        },
        aggs: HashMap::new(),
        encoding: config::meta::search::RequestEncoding::Empty,
        clusters: vec![],
        timeout,
    };
    let search_fut = SearchService::search(
        &trace_id,
        org_id,
        StreamType::Metadata,
        Some(user_id.to_string()),
        &req,
    );
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.unwrap()).await
    } else {
        search_fut.await
    };
    let resp_search = match search_res {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_values/v2",
                    "500",
                    org_id,
                    stream_name,
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_values/v2",
                    "500",
                    org_id,
                    stream_name,
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search values error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => match code {
                    errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests()
                        .json(meta::http::HttpResponse::error_code_with_trace_id(
                            code,
                            Some(trace_id),
                        )),
                    _ => HttpResponse::InternalServerError().json(
                        meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                    ),
                },
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };

    let mut resp = config::meta::search::Response::default();
    let mut hit_values: Vec<json::Value> = Vec::new();
    let mut field_value: json::Map<String, json::Value> = json::Map::new();
    field_value.insert("field".to_string(), json::Value::String(field.to_string()));
    field_value.insert("values".to_string(), json::Value::Array(resp_search.hits));
    hit_values.push(json::Value::Object(field_value));

    resp.total = 1;
    resp.hits = hit_values;
    resp.size = size;
    resp.scan_size = resp_search.scan_size;
    resp.took = start.elapsed().as_millis() as usize;

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/_values/v2",
            "200",
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/_values/v2",
            "200",
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();

    let req_stats = RequestStats {
        records: resp.hits.len() as i64,
        response_time: time,
        size: resp.scan_size as f64,
        request_body: Some(req.query.sql),
        user_email: Some(user_id.to_string()),
        min_ts: Some(start_time),
        max_ts: Some(end_time),
        ..Default::default()
    };
    let num_fn = req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::SearchTopNValues,
        num_fn,
    )
    .await;

    Ok(HttpResponse::Ok().json(resp))
}

/// SearchStreamPartition
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchPartition",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = SearchRequest, description = "Search query", content_type = "application/json", example = json!({
        "sql": "select * from k8s ",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "file_num": 10,
            "original_size": 10240,
            "compressed_size": 1024,
            "partitions": [
                [1674213225158000i64, 1674213225158000i64],
                [1674213225158000i64, 1674213225158000i64],
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_search_partition")]
pub async fn search_partition(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    let mut http_span = None;
    let trace_id = if CONFIG.common.tracing_enabled {
        let ctx = global::get_text_map_propagator(|propagator| {
            propagator.extract(&RequestHeaderExtractor::new(in_req.headers()))
        });
        ctx.span().span_context().trace_id().to_string()
    } else if CONFIG.common.tracing_search_enabled {
        let span = tracing::info_span!("/api/{org_id}/_search_partition", org_id = org_id.clone());
        let trace_id = span.context().span().span_context().trace_id().to_string();
        http_span = Some(span);
        trace_id
    } else {
        ider::uuid()
    };

    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let req: config::meta::search::SearchPartitionRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let search_fut = SearchService::search_partition(&trace_id, &org_id, stream_type, &req);
    let search_res = if !CONFIG.common.tracing_enabled && CONFIG.common.tracing_search_enabled {
        search_fut.instrument(http_span.unwrap()).await
    } else {
        search_fut.await
    };

    // do search
    match search_res {
        Ok(res) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search_partition",
                    "200",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition",
                    "200",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .inc();
            Ok(HttpResponse::Ok().json(res))
        }
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search_partition",
                    "500",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition",
                    "500",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("search error: {:?}", err);
            Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError().json(
                    meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                ),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            })
        }
    }
}

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

use std::{collections::HashMap, io::Error};

use actix_web::{http::StatusCode, post, web, HttpRequest, HttpResponse};
use config::{
    ider,
    meta::{
        stream::StreamType,
        usage::{RequestStats, UsageType},
    },
    metrics,
    utils::{base64, json},
};
use infra::errors;

use crate::{
    common::{
        meta::{self, http::HttpResponse as MetaHttpResponse},
        utils::{functions, http::get_stream_type_from_request},
    },
    service::{search as SearchService, usage::report_request_usage_stats},
};

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
#[post("/{org_id}/_search_multi")]
pub async fn search_multi(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let session_id = ider::uuid();

    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    // handle encoding for query and aggs
    let mut multi_req: meta::search::MultiStreamRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let user_id = in_req.headers().get("user_id").unwrap();
    let queries = multi_req.to_query_req();
    let mut multi_res = meta::search::Response::new(multi_req.from, multi_req.size);

    for mut req in queries {
        let mut rpc_req: crate::handler::grpc::cluster_rpc::SearchRequest = req.to_owned().into();
        rpc_req.org_id = org_id.to_string();
        rpc_req.stream_type = stream_type.to_string();
        let resp: SearchService::sql::Sql = match crate::service::search::sql::Sql::new(&rpc_req)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                return Ok(match e {
                    errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                        .json(meta::http::HttpResponse::error_code(code)),
                    _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                        StatusCode::INTERNAL_SERVER_ERROR.into(),
                        e.to_string(),
                    )),
                });
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
                            o2_type: format!("{}:{}", stream_type, resp.stream_name),
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

        let mut query_fn = req.query.query_fn.and_then(|v| base64::decode(&v).ok());

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
        let session_id = session_id.clone();
        // do search
        match SearchService::search(&session_id, &org_id, stream_type, &req).await {
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
                res.set_session_id(session_id);
                res.set_local_took(start.elapsed().as_millis() as usize, took_wait);

                let req_stats = RequestStats {
                    records: res.hits.len() as i64,
                    response_time: time,
                    size: res.scan_size as f64,
                    request_body: Some(req.query.sql),
                    user_email: Some(user_id.to_str().unwrap().to_string()),
                    ..Default::default()
                };
                let num_fn = req.query.query_fn.is_some() as u16;
                report_request_usage_stats(
                    req_stats,
                    &org_id,
                    &resp.stream_name,
                    StreamType::Logs,
                    UsageType::Search,
                    num_fn,
                )
                .await;

                multi_res.took += res.took;

                multi_res.total += res.total;
                multi_res.from = res.from;
                multi_res.size += res.size;
                multi_res.file_count += res.file_count;
                multi_res.scan_size += res.scan_size;
                multi_res.scan_records += res.scan_records;
                multi_res.columns.append(&mut res.columns);
                multi_res.hits.append(&mut res.hits);
                multi_res.aggs.extend(res.aggs.into_iter());
                multi_res.response_type = res.response_type;
                multi_res.session_id = res.session_id;
                // function_error: "".to_string(),

                // took_detail: None,

                // Ok(HttpResponse::Ok().json(res))
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

                multi_res.function_error = format!("{};{:?}", multi_res.function_error, err);
            }
        }
    }
    Ok(HttpResponse::Ok().json(multi_res))
}

/// SearchMultiStreamPartition
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchPartitionMulti",
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
#[post("/{org_id}/_search_partition_multi")]
pub async fn _search_partition_multi(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let session_id = ider::uuid();

    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    let req: meta::search::MultiSearchPartitionRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    // do search
    match SearchService::search_partition_multi(&session_id, &org_id, stream_type, &req).await {
        Ok(res) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
                    "200",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
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
                    "/api/org/_search_partition_multi",
                    "500",
                    &org_id,
                    "",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
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

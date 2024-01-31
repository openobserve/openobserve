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

use actix_web::{get, http, post, web, HttpRequest, HttpResponse};
use config::{ider, meta::stream::StreamType, metrics, utils::json, CONFIG};
use infra::errors;
use serde::Serialize;

use crate::{
    common::meta::{self, http::HttpResponse as MetaHttpResponse},
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::{search as SearchService, traces::otlp_http},
};

/// TracesIngest
#[utoipa::path(
    context_path = "/api",
    tag = "Traces",
    operation_id = "PostTraces",
    security(
        ("Authorization"= [])
    ),
    request_body(content = String, description = "ExportTraceServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/traces")]
pub async fn traces_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    handle_req(org_id, thread_id, req, body).await
}

#[post("/{org_id}/v1/traces")]
pub async fn otlp_traces_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    handle_req(org_id, thread_id, req, body).await
}

async fn handle_req(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    let in_stream_name = req
        .headers()
        .get(&CONFIG.grpc.stream_header_key)
        .map(|header| header.to_str().unwrap());
    if content_type.eq(CONTENT_TYPE_PROTO) {
        otlp_http::traces_proto(&org_id, **thread_id, body, in_stream_name).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        otlp_http::traces_json(&org_id, **thread_id, body, in_stream_name).await
    } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Bad Request".to_string(),
            )),
        )
    }
}

/// GetLatestTraces
#[utoipa::path(
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestTraces",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("filter" = Option<String>, Query, description = "filter, eg: a=b AND c=d"),
        ("from" = i64, Query, description = "from"), // topN
        ("size" = i64, Query, description = "size"), // topN
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
            "took": 155,
            "hits": [
                {
                    "trace_id": "12345678",
                    "spans": [1, 2],
                    "service_name": [{"job1": 1, "job2": 0}],
                    "first_event": {
                        "start_time": 1234567890,
                        "operation_name": "operation_name"
                    }
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/traces/latest")]
pub async fn get_latest_traces(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let session_id = ider::uuid();

    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();

    let filter = match query.get("filter") {
        Some(v) => v.to_string(),
        None => "".to_string(),
    };
    let from = query
        .get("from")
        .map_or(0, |v| v.parse::<usize>().unwrap_or(0));
    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<usize>().unwrap_or(10));
    let mut start_time = query
        .get("start_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if start_time == 0 {
        return Ok(MetaHttpResponse::bad_request("start_time is empty"));
    }
    let mut end_time = query
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
    let query_sql = format!(
        "SELECT trace_id, min({}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time FROM {stream_name}",
        CONFIG.common.column_timestamp
    );
    let query_sql = if filter.is_empty() {
        format!("{query_sql} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    } else {
        format!("{query_sql} WHERE {filter} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    };
    let mut req = meta::search::Request {
        query: meta::search::Query {
            sql: query_sql.to_string(),
            from,
            size,
            start_time,
            end_time,
            sort_by: None,
            sql_mode: "full".to_string(),
            query_type: "".to_string(),
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
        timeout,
    };
    let stream_type = StreamType::Traces;
    let resp_search = match SearchService::search(&session_id, &org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/latest",
                    "500",
                    &org_id,
                    "default",
                    stream_type.to_string().as_str(),
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/latest",
                    "500",
                    &org_id,
                    "default",
                    stream_type.to_string().as_str(),
                ])
                .inc();
            log::error!("get traces latest data error: {:?}", err);
            return Ok(match err {
                errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                    .json(meta::http::HttpResponse::error_code(code)),
                _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            });
        }
    };
    if resp_search.hits.is_empty() {
        return Ok(HttpResponse::Ok().json(resp_search));
    }

    let mut traces_data: HashMap<String, TraceResponseItem> =
        HashMap::with_capacity(resp_search.hits.len());
    for item in resp_search.hits {
        let trace_id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
        let trace_start_time = item.get("trace_start_time").unwrap().as_i64().unwrap();
        let trace_end_time = item.get("trace_end_time").unwrap().as_i64().unwrap();
        if trace_start_time < start_time {
            start_time = trace_start_time;
        }
        if trace_end_time > end_time {
            end_time = trace_end_time;
        }
        traces_data.insert(
            trace_id.clone(),
            TraceResponseItem {
                trace_id,
                start_time: trace_start_time,
                end_time: trace_end_time,
                duration: 0,
                spans: [0, 0],
                service_name: Vec::new(),
                first_event: serde_json::Value::Null,
            },
        );
    }

    // query the detail of the traces
    let trace_ids = traces_data
        .values()
        .map(|v| v.trace_id.clone())
        .collect::<Vec<String>>()
        .join("','");
    let query_sql = format!(
        "SELECT {}, trace_id, start_time, end_time, duration, service_name, operation_name, span_status FROM {stream_name} WHERE trace_id IN ('{}') ORDER BY {} ASC",
        CONFIG.common.column_timestamp, trace_ids, CONFIG.common.column_timestamp,
    );
    req.query.from = 0;
    req.query.size = 9999;
    req.query.sql = query_sql.to_string();
    req.query.start_time = start_time;
    req.query.end_time = end_time;
    let mut traces_service_name: HashMap<String, HashMap<String, u16>> = HashMap::new();

    loop {
        let resp_search = match SearchService::search(&session_id, &org_id, stream_type, &req).await
        {
            Ok(res) => res,
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::HTTP_RESPONSE_TIME
                    .with_label_values(&[
                        "/api/org/traces/latest",
                        "500",
                        &org_id,
                        &stream_name,
                        stream_type.to_string().as_str(),
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/traces/latest",
                        "500",
                        &org_id,
                        &stream_name,
                        stream_type.to_string().as_str(),
                    ])
                    .inc();
                log::error!("get traces latest data error: {:?}", err);
                return Ok(match err {
                    errors::Error::ErrorCode(code) => HttpResponse::InternalServerError()
                        .json(meta::http::HttpResponse::error_code(code)),
                    _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        err.to_string(),
                    )),
                });
            }
        };

        let resp_size = resp_search.hits.len();
        for item in resp_search.hits {
            let trace_id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
            let trace_start_time = item.get("start_time").unwrap().as_i64().unwrap();
            let trace_end_time = item.get("end_time").unwrap().as_i64().unwrap();
            let duration = item.get("duration").unwrap().as_i64().unwrap();
            let service_name = item
                .get("service_name")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string();
            let span_status = item
                .get("span_status")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string();
            let trace = traces_data.get_mut(&trace_id).unwrap();
            if trace.first_event.is_null() {
                trace.first_event = item.clone();
            }
            trace.spans[0] += 1;
            if span_status.eq("ERROR") {
                trace.spans[1] += 1;
            }
            if trace.duration < duration {
                trace.duration = duration;
            }
            if trace.start_time == 0 || trace.start_time > trace_start_time {
                trace.start_time = trace_start_time;
            }
            if trace.end_time < trace_end_time {
                trace.end_time = trace_end_time;
            }
            let service_name_map = traces_service_name.entry(trace_id.clone()).or_default();
            let count = service_name_map.entry(service_name.clone()).or_default();
            *count += 1;
        }
        if resp_size < req.query.size {
            break;
        }
        req.query.from += req.query.size;
    }

    // apply service_name to traces_data
    for (trace_id, service_name_map) in traces_service_name {
        let trace = traces_data.get_mut(&trace_id).unwrap();
        for (service_name, count) in service_name_map {
            trace.service_name.push(TraceServiceNameItem {
                service_name,
                count,
            });
        }
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/traces/latest",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/traces/latest",
            "200",
            &org_id,
            &stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();

    let mut resp: HashMap<&str, json::Value> = HashMap::new();
    resp.insert("took", json::Value::from((time * 1000.0) as usize));
    resp.insert("total", json::Value::from(traces_data.len()));
    resp.insert("from", json::Value::from(from));
    resp.insert("size", json::Value::from(size));
    resp.insert(
        "hits",
        json::to_value(traces_data.values().collect::<Vec<&TraceResponseItem>>()).unwrap(),
    );
    resp.insert("session_id", json::Value::from(session_id));
    Ok(HttpResponse::Ok().json(resp))
}

#[derive(Debug, Serialize)]
struct TraceResponseItem {
    trace_id: String,
    start_time: i64,
    end_time: i64,
    duration: i64,
    spans: [u16; 2],
    service_name: Vec<TraceServiceNameItem>,
    first_event: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct TraceServiceNameItem {
    service_name: String,
    count: u16,
}

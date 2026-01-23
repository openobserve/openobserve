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

use axum::{body::Bytes, extract::Path, http::HeaderMap, response::Response};
use config::{
    TIMESTAMP_COL_NAME,
    axum::middlewares::{get_process_time, insert_process_time_header},
    get_config,
    meta::{search::default_use_cache, stream::StreamType},
    metrics,
    utils::json,
};
use hashbrown::HashMap;
use serde::Serialize;
use tracing::{Instrument, Span};

#[cfg(feature = "cloud")]
use crate::service::ingestion::check_ingestion_allowed;
// Re-export service graph API handlers
pub use crate::service::traces::service_graph::{self, get_current_topology};
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
        },
    },
    handler::http::{
        extractors::Headers,
        request::{
            CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, search::error_utils::map_error_to_http_response,
        },
    },
    service::{search as SearchService, traces},
};

/// TracesIngest
#[utoipa::path(
    post,
    path = "/{org_id}/v1/traces",
    context_path = "/api",
    tag = "Traces",
    operation_id = "PostTraces",
    summary = "Ingest trace data",
    description = "Accepts and processes distributed tracing data from applications and services. Supports both Protocol Buffers and JSON formats for OTLP (OpenTelemetry Protocol) trace ingestion. Use this endpoint to send trace spans, timing information, and service dependency data for observability and performance monitoring.",
    security(
        ("Authorization"= [])
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "ExportTraceServiceRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn traces_write(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // log start processing time
    let process_time = get_process_time();

    let user = crate::common::meta::ingestion::IngestUser::from_user_email(&user_email.user_id);

    #[cfg(feature = "cloud")]
    match check_ingestion_allowed(&org_id, StreamType::Traces, None).await {
        Ok(_) => {}
        Err(e) => {
            return MetaHttpResponse::too_many_requests(e);
        }
    }

    let content_type = headers
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/json");
    let in_stream_name = headers
        .get(&get_config().grpc.stream_header_key)
        .and_then(|header| header.to_str().ok());

    let result = if content_type.eq(CONTENT_TYPE_PROTO) {
        traces::otlp_proto(&org_id, body, in_stream_name, user).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        traces::otlp_json(&org_id, body, in_stream_name, user).await
    } else {
        return MetaHttpResponse::bad_request("Bad Request");
    };

    match result {
        Ok(mut resp) => {
            insert_process_time_header(process_time, resp.headers_mut());
            resp
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// GetLatestTraces
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/latest",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestTraces",
    summary = "Get recent trace data",
    description = "Retrieves the most recent trace data from a specific stream within a time range. Returns trace summaries including trace IDs, span counts, service names, and timing information. You can filter results and control pagination to analyze distributed system performance and identify bottlenecks or errors in your applications.",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
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
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_latest_traces(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = crate::service::search::check_search_allowed(&org_id, Some(&stream_name)) {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, trace_id) = if cfg.common.tracing_search_enabled {
        let uuid_v7_trace_id = config::ider::generate_trace_id();
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/traces/latest",
            org_id = org_id.clone(),
            stream_name = stream_name.clone(),
            trace_id = uuid_v7_trace_id.clone()
        );

        (span, uuid_v7_trace_id)
    } else {
        let trace_id = get_or_create_trace_id(&headers, &Span::none());
        (Span::none(), trace_id)
    };
    let user_id = &user_email.user_id;

    // Check permissions on stream

    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::users::get_user,
        };
        if !is_root_user(user_id) {
            let user: config::meta::user::User = get_user(Some(&org_id), user_id).await.unwrap();
            let stream_type_str = StreamType::Traces.as_str();

            if !crate::handler::http::auth::validator::check_permissions(
                user_id,
                AuthExtractor {
                    auth: "".to_string(),
                    method: "GET".to_string(),
                    o2_type: format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(stream_type_str)
                            .map_or(stream_type_str, |model| model.key),
                        stream_name
                    ),
                    org_id: org_id.clone(),
                    bypass_check: false,
                    parent_id: "".to_string(),
                },
                user.role,
                user.is_external,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
        // Check permissions on stream ends
    }

    let filter = match query.get("filter") {
        Some(v) => v.to_string(),
        None => "".to_string(),
    };

    let from = query
        .get("from")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<i64>().unwrap_or(10));
    let mut start_time = query
        .get("start_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if start_time == 0 {
        return MetaHttpResponse::bad_request("start_time is empty");
    }
    let mut end_time = query
        .get("end_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if end_time == 0 {
        return MetaHttpResponse::bad_request("end_time is empty");
    }
    // default/traces/latest?filter=trace_id=%2701990a31c98e72cbb5e38df024e7adef%27&
    // start_time=1756811970952000&end_time=1756812870952000&from=0&size=25
    // filter=trace_id=%2701990a31c98e72cbb5e38df024e7adef%27%20and%20service_name%20=%27all%27

    let search_trace_id = query.get("trace_id").map(|v| v.to_string());
    let start_time_from_trace_id = if let Some(trace_id) = search_trace_id {
        config::ider::get_start_time_from_trace_id(&trace_id).unwrap_or(0)
    } else if filter.contains("trace_id=") {
        // Safely extract trace_id from filter string
        let trace_id = filter
            .split("trace_id=")
            .nth(1)
            .and_then(|s| s.split("&").next())
            .and_then(|s| s.split(" ").next())
            .map(|s| s.replace("'", "").replace("\"", ""))
            .filter(|s| !s.is_empty());

        if let Some(trace_id) = trace_id {
            config::ider::get_start_time_from_trace_id(&trace_id).unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    if start_time_from_trace_id > 0 {
        start_time = start_time_from_trace_id - 60 * 1_000_000; //60 seconds earlier
        end_time = start_time_from_trace_id + 3600 * 1_000_000; //1 hour later
    }

    let max_query_range = crate::common::utils::stream::get_max_query_range(
        std::slice::from_ref(&stream_name),
        org_id.as_str(),
        user_id,
        StreamType::Traces,
    )
    .await;
    let mut range_error = String::new();
    if max_query_range > 0 && (end_time - start_time) > max_query_range * 3600 * 1_000_000 {
        start_time = end_time - max_query_range * 3600 * 1_000_000;
        range_error = format!(
            "Query duration is modified due to query range restriction of {max_query_range} hours"
        );
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // search
    let query_sql = format!(
        "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time FROM {stream_name}"
    );
    let query_sql = if filter.is_empty() {
        format!("{query_sql} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    } else {
        format!("{query_sql} WHERE {filter} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    };
    let mut req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.to_string(),
            from,
            size,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            action_id: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout,
        search_type: None,
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
    };

    req.use_cache = get_use_cache_from_request(&query);

    let stream_type = StreamType::Traces;
    let user_id_opt = Some(user_id.to_string());

    let search_res = SearchService::cache::search(
        &trace_id,
        &org_id,
        stream_type,
        user_id_opt.clone(),
        &req,
        "".to_string(),
        false,
        None,
        false,
    )
    .instrument(http_span.clone())
    .await;

    let resp_search = match search_res {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/latest",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/latest",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("get traces latest data error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    if resp_search.hits.is_empty() {
        return MetaHttpResponse::json(resp_search);
    }

    let mut traces_data: HashMap<String, TraceResponseItem> =
        HashMap::with_capacity(resp_search.hits.len());
    for item in resp_search.hits {
        let trace_id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
        let trace_start_time = json::get_int_value(item.get("trace_start_time").unwrap());
        let trace_end_time = json::get_int_value(item.get("trace_end_time").unwrap());
        // trace time is nanosecond, need to compare with microsecond
        if trace_start_time / 1000 < start_time {
            start_time = trace_start_time / 1000;
        }
        if trace_end_time / 1000 > end_time {
            end_time = trace_end_time / 1000;
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
        "SELECT {TIMESTAMP_COL_NAME}, trace_id, start_time, end_time, duration, service_name, operation_name, span_status FROM {stream_name} WHERE trace_id IN ('{trace_ids}') ORDER BY {TIMESTAMP_COL_NAME} ASC"
    );
    req.query.from = 0;
    req.query.size = 9999;
    req.query.sql = query_sql.to_string();
    req.query.start_time = start_time;
    req.query.end_time = end_time;
    let mut traces_service_name: HashMap<String, HashMap<String, u16>> = HashMap::new();

    loop {
        let search_res = SearchService::cache::search(
            &trace_id,
            &org_id,
            stream_type,
            user_id_opt.clone(),
            &req,
            "".to_string(),
            false,
            None,
            false,
        )
        .instrument(http_span.clone())
        .await;

        let resp_search = match search_res {
            Ok(res) => res,
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::HTTP_RESPONSE_TIME
                    .with_label_values(&[
                        "/api/org/traces/latest",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/traces/latest",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .inc();
                log::error!("get traces latest data error: {err:?}");
                return map_error_to_http_response(&err, Some(trace_id));
            }
        };

        let resp_size = resp_search.hits.len() as i64;
        for item in resp_search.hits {
            let trace_id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
            let trace_start_time = json::get_int_value(item.get("start_time").unwrap());
            let trace_end_time = json::get_int_value(item.get("end_time").unwrap());
            let duration = json::get_int_value(item.get("duration").unwrap());
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
    let mut traces_data = traces_data.values().collect::<Vec<&TraceResponseItem>>();
    traces_data.sort_by(|a, b| b.start_time.cmp(&a.start_time));

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/traces/latest",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/traces/latest",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .inc();

    let mut resp: HashMap<&str, json::Value> = HashMap::new();
    resp.insert("took", json::Value::from((time * 1000.0) as usize));
    resp.insert("total", json::Value::from(traces_data.len()));
    resp.insert("from", json::Value::from(from));
    resp.insert("size", json::Value::from(size));
    resp.insert("hits", json::to_value(traces_data).unwrap());
    resp.insert("trace_id", json::Value::from(trace_id));
    if !range_error.is_empty() {
        resp.insert("function_error", json::Value::String(range_error));
    }
    MetaHttpResponse::json(resp)
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

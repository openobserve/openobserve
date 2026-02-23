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
    meta::{
        search::{SearchPartitionRequest, StreamResponses, TimeOffset, default_use_cache},
        stream::StreamType,
    },
    metrics,
    utils::json,
};
use futures::stream::StreamExt;
use hashbrown::HashMap;
use serde::Serialize;
use tokio::sync::mpsc;
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

pub mod dag;
pub mod session;
pub mod user;

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

    let cfg = get_config();
    let content_type = headers
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/json");
    let org_id = if let Some(Some(v)) = headers
        .get(&cfg.grpc.org_header_key)
        .map(|header| header.to_str().ok())
    {
        v.to_string()
    } else {
        org_id
    };
    let in_stream_name = headers
        .get(&cfg.grpc.stream_header_key)
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
    let is_llm_stream =
        infra::schema::get_is_llm_stream(org_id.as_str(), stream_name.as_str(), StreamType::Traces)
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
    let query_sql = if is_llm_stream {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
        sum(_o2_llm_usage_details_input) as llm_usage_details_input, \
        sum(_o2_llm_usage_details_output) as llm_usage_details_output, \
        sum(_o2_llm_usage_details_total) as llm_usage_details_total, \
        sum(_o2_llm_cost_details_total) as llm_cost_details_total, \
        FIRST_VALUE(_o2_llm_input ORDER BY {TIMESTAMP_COL_NAME} ASC) as llm_input \
        FROM \"{stream_name}\""
        )
    } else {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time FROM \"{stream_name}\""
        )
    };
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
                _o2_llm_usage_details_input: json::get_int_value(
                    item.get("llm_usage_details_input").unwrap_or_default(),
                ),
                _o2_llm_usage_details_output: json::get_int_value(
                    item.get("llm_usage_details_output").unwrap_or_default(),
                ),
                _o2_llm_usage_details_total: json::get_int_value(
                    item.get("llm_usage_details_total").unwrap_or_default(),
                ),
                _o2_llm_cost_details_total: json::get_float_value(
                    item.get("llm_cost_details_total").unwrap_or_default(),
                ),
                _o2_llm_input: item.get("llm_input").cloned(),
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
        "SELECT {TIMESTAMP_COL_NAME}, trace_id, start_time, end_time, duration, service_name, operation_name, span_status FROM \"{stream_name}\" WHERE trace_id IN ('{trace_ids}') ORDER BY {TIMESTAMP_COL_NAME} ASC"
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

/// GetLatestTracesStream — HTTP/2 streaming variant of GetLatestTraces
///
/// Returns results progressively as each time partition is processed.
/// Uses the same SSE format as `_search_stream` so the frontend can reuse
/// the existing `useStreamingSearch` composable.
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/latest_stream",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestTracesStream",
    summary = "Stream recent trace data",
    description = "Streams the most recent trace data from a specific stream within a time range using HTTP/2 server-sent events. Results are returned progressively as each time partition is processed, reducing time-to-first-result for large time ranges.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("filter" = Option<String>, Query, description = "filter, eg: a=b AND c=d"),
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_latest_traces_stream(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
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
            "/api/{org_id}/{stream_name}/traces/latest_stream",
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

    // Narrow time range if trace_id is present in filter
    let search_trace_id = query.get("trace_id").map(|v| v.to_string());
    let start_time_from_trace_id = if let Some(tid) = search_trace_id {
        config::ider::get_start_time_from_trace_id(&tid).unwrap_or(0)
    } else if filter.contains("trace_id=") {
        let tid = filter
            .split("trace_id=")
            .nth(1)
            .and_then(|s| s.split('&').next())
            .and_then(|s| s.split(' ').next())
            .map(|s| s.replace(['\'', '"'], ""))
            .filter(|s| !s.is_empty());
        if let Some(tid) = tid {
            config::ider::get_start_time_from_trace_id(&tid).unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    if start_time_from_trace_id > 0 {
        start_time = start_time_from_trace_id - 60 * 1_000_000;
        end_time = start_time_from_trace_id + 3600 * 1_000_000;
    }

    let max_query_range = crate::common::utils::stream::get_max_query_range(
        std::slice::from_ref(&stream_name),
        org_id.as_str(),
        user_id,
        StreamType::Traces,
    )
    .await;
    let is_llm_stream =
        infra::schema::get_is_llm_stream(org_id.as_str(), stream_name.as_str(), StreamType::Traces)
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

    let use_cache = get_use_cache_from_request(&query);

    let (tx, rx) = mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);

    tokio::spawn(
        process_latest_traces_stream(
            org_id.clone(),
            stream_name,
            user_id.to_string(),
            trace_id.clone(),
            filter,
            start_time,
            end_time,
            from,
            size,
            timeout,
            is_llm_stream,
            use_cache,
            range_error,
            tx,
        )
        .instrument(http_span),
    );

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!("[TRACES_STREAM trace_id {trace_id}] Error: {err}");
                let err_res = match err {
                    infra::errors::Error::ErrorCode(ref code) => {
                        let message = code.get_message();
                        let error_detail = code.get_error_detail();
                        let http_response = map_error_to_http_response(&err, None);
                        StreamResponses::Error {
                            code: http_response.status().into(),
                            message,
                            error_detail: Some(error_detail),
                        }
                    }
                    _ => StreamResponses::Error {
                        code: 500,
                        message: err.to_string(),
                        error_detail: None,
                    },
                };
                err_res.to_chunks()
            }
        };
        futures::stream::iter(chunks_iter)
    });

    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

/// Core streaming logic for get_latest_traces_stream.
///
/// For each time partition (newest first):
///   1. Run Query 1: GROUP BY trace_id to get trace summaries.
///   2. Run Query 2: fetch span details for those trace IDs.
///   3. Assemble TraceResponseItem and stream hits via the sender.
#[allow(clippy::too_many_arguments)]
async fn process_latest_traces_stream(
    org_id: String,
    stream_name: String,
    user_id: String,
    trace_id: String,
    filter: String,
    start_time: i64,
    end_time: i64,
    from: i64,
    size: i64,
    timeout: i64,
    is_llm_stream: bool,
    use_cache: bool,
    range_error: String,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) {
    let stream_type = StreamType::Traces;

    // Send initial progress immediately so client knows the stream is alive
    if sender
        .send(Ok(StreamResponses::Progress { percent: 0 }))
        .await
        .is_err()
    {
        return;
    }

    // Sanitize filter before embedding in SQL. The filter is a user-supplied URL query param
    // of the form "field=value AND field2=value2". We remove SQL comment sequences and
    // semicolons to prevent injection; the broader pattern is consistent with get_latest_traces.
    let filter = {
        let f = filter.replace("--", "").replace(';', "");
        f.trim().to_string()
    };

    // Build the aggregation SQL (Query 1) — identical to get_latest_traces
    let query_sql_base = if is_llm_stream {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
        sum(_o2_llm_usage_details_input) as llm_usage_details_input, \
        sum(_o2_llm_usage_details_output) as llm_usage_details_output, \
        sum(_o2_llm_usage_details_total) as llm_usage_details_total, \
        sum(_o2_llm_cost_details_total) as llm_cost_details_total, \
        FIRST_VALUE(_o2_llm_input ORDER BY {TIMESTAMP_COL_NAME} ASC) as llm_input \
        FROM \"{stream_name}\""
        )
    } else {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, min(start_time) as trace_start_time, max(end_time) as trace_end_time FROM \"{stream_name}\""
        )
    };
    let query_sql = if filter.is_empty() {
        format!("{query_sql_base} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    } else {
        format!("{query_sql_base} WHERE {filter} GROUP BY trace_id ORDER BY zo_sql_timestamp DESC")
    };

    // Build a base search request. from/size are set per-partition; leave at 0 here.
    let base_req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.clone(),
            from: 0,
            size: 0,
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
        search_type: Some(config::meta::search::SearchEventType::UI),
        search_event_context: None,
        use_cache,
        clear_cache: false,
        local_mode: None,
    };

    // Get time partitions
    let partition_req = SearchPartitionRequest {
        sql: query_sql.clone(),
        start_time,
        end_time,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        query_fn: None,
        streaming_output: false,
        histogram_interval: 0,
        sampling_ratio: None,
    };

    let partitions = match SearchService::search_partition(
        &trace_id,
        &org_id,
        Some(user_id.as_str()),
        stream_type,
        &partition_req,
        false,
        false,
        false,
        use_cache,
    )
    .await
    {
        Ok(resp) => resp.partitions,
        Err(e) => {
            log::error!("[TRACES_STREAM trace_id {trace_id}] Failed to get partitions: {e}");
            let _ = sender.send(Err(e)).await;
            return;
        }
    };

    if partitions.is_empty() {
        let _ = sender.send(Ok(StreamResponses::Done)).await;
        return;
    }

    let total_partitions = partitions.len();
    // Process partitions newest-first (partitions from search_partition are ordered oldest-first)
    let partitions_desc: Vec<[i64; 2]> = partitions.into_iter().rev().collect();

    // `from` is a global offset: skip the first `from` hits across all partitions,
    // then deliver `size` hits. We track how many we've seen and delivered so far.
    //
    // NOTE: partition boundaries come from search_partition() which is sensitive to querier
    // node count. Boundaries can shift between requests, so `from`-based pagination may
    // produce overlapping or missing results if cluster topology changes between page requests.
    // For stable pagination, callers should use time-based cursors (end_time of last seen trace).
    let mut hits_seen: i64 = 0; // hits returned by Q1 across all partitions (may be truncated by fetch_size)
    let hits_to_skip = from; // global offset
    let hits_to_deliver = size; // how many the caller wants after the offset
    let mut hits_delivered: i64 = 0; // how many we've actually sent
    let mut total_across_partitions: usize = 0; // cumulative total count for UI display
    let mut range_error_sent = false; // send range_error only once
    // Dedup: a trace whose spans straddle a partition boundary appears in multiple partitions'
    // GROUP BY results. Track already-emitted trace IDs to avoid sending duplicates.
    let mut seen_trace_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (idx, partition) in partitions_desc.iter().enumerate() {
        if sender.is_closed() {
            break;
        }
        if hits_delivered >= hits_to_deliver {
            break;
        }

        let p_start = partition[0];
        let p_end = partition[1];

        // Ask for enough rows to cover remaining offset + remaining needed,
        // capped at query_default_limit (default 1000) to prevent oversized Q1 scans.
        let remaining_to_skip = (hits_to_skip - hits_seen).max(0);
        let remaining_needed = hits_to_deliver - hits_delivered;
        let fetch_size =
            (remaining_to_skip + remaining_needed).min(get_config().limit.query_default_limit);

        // ---------- Query 1: aggregate over this partition ----------
        let mut req1 = base_req.clone();
        req1.query.start_time = p_start;
        req1.query.end_time = p_end;
        req1.query.from = 0;
        req1.query.size = fetch_size;

        let agg_res = match SearchService::cache::search(
            &trace_id,
            &org_id,
            stream_type,
            Some(user_id.clone()),
            &req1,
            "".to_string(),
            false,
            None,
            false,
        )
        .await
        {
            Ok(res) => res,
            Err(e) => {
                log::error!(
                    "[TRACES_STREAM trace_id {trace_id}] Query1 error on partition [{p_start},{p_end}]: {e}"
                );
                let _ = sender.send(Err(e)).await;
                return;
            }
        };

        // Deduplicate against already-emitted trace IDs (a trace whose spans straddle a
        // partition boundary can appear in multiple partitions' GROUP BY result).
        // We filter hits *before* counting so that total and pagination are not inflated.
        let deduped_hits: Vec<_> = agg_res
            .hits
            .into_iter()
            .filter(|item| {
                let tid = item
                    .get("trace_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                !tid.is_empty() && !seen_trace_ids.contains(tid)
            })
            .collect();
        // Use deduped count for both pagination tracking and total display.
        // agg_res.total would be inflated by duplicates, so count only deduped hits.
        let partition_total = deduped_hits.len() as i64;
        total_across_partitions += deduped_hits.len();
        hits_seen += partition_total;

        if deduped_hits.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        // Sort Q1 hits by trace_start_time descending (same order as the final result).
        // Q1 returns traces ordered by zo_sql_timestamp DESC, but we need start_time order.
        let mut sorted_hits = deduped_hits;
        sorted_hits.sort_by(|a, b| {
            let a_t = json::get_int_value(a.get("trace_start_time").unwrap_or_default());
            let b_t = json::get_int_value(b.get("trace_start_time").unwrap_or_default());
            b_t.cmp(&a_t)
        });

        // Register ALL trace IDs from this partition into seen_trace_ids now, before slicing.
        // This prevents a trace that is skipped (before `from`) or not yet delivered from
        // appearing again in a later partition's Q1 result and inflating counts or being
        // delivered twice when it finally falls in a deliverable window.
        for item in &sorted_hits {
            if let Some(tid) = item.get("trace_id").and_then(|v| v.as_str())
                && !tid.is_empty()
            {
                seen_trace_ids.insert(tid.to_string());
            }
        }

        // Apply global offset up-front on the Q1 result so Q2 only runs on traces we will deliver.
        // This avoids sending hundreds of already-delivered trace IDs back to the storage layer.
        let hits_seen_before = hits_seen - partition_total;
        let skip_in_partition = (hits_to_skip - hits_seen_before)
            .max(0)
            .min(sorted_hits.len() as i64);
        let need = (hits_to_deliver - hits_delivered) as usize;
        let deliverable_q1: Vec<_> = sorted_hits
            .into_iter()
            .skip(skip_in_partition as usize)
            .take(need)
            .collect();

        if deliverable_q1.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        // ---------- Query 2: fetch span details only for the traces we will deliver ----------
        let mut traces_data: HashMap<String, TraceResponseItem> =
            HashMap::with_capacity(deliverable_q1.len());
        let mut p_start_actual = p_start;
        let mut p_end_actual = p_end;

        for item in &deliverable_q1 {
            let tid = item
                .get("trace_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let trace_start_time = json::get_int_value(
                item.get("trace_start_time")
                    .unwrap_or(&serde_json::Value::Null),
            );
            let trace_end_time = json::get_int_value(
                item.get("trace_end_time")
                    .unwrap_or(&serde_json::Value::Null),
            );
            // Expand window to cover actual span times (nanoseconds → microseconds)
            if trace_start_time > 0 && trace_start_time / 1000 < p_start_actual {
                p_start_actual = trace_start_time / 1000;
            }
            if trace_end_time > 0 && trace_end_time / 1000 > p_end_actual {
                p_end_actual = trace_end_time / 1000;
            }
            traces_data.insert(
                tid.clone(),
                TraceResponseItem {
                    trace_id: tid,
                    start_time: trace_start_time,
                    end_time: trace_end_time,
                    duration: 0,
                    spans: [0, 0],
                    service_name: Vec::new(),
                    first_event: serde_json::Value::Null,
                    _o2_llm_usage_details_input: json::get_int_value(
                        item.get("llm_usage_details_input").unwrap_or_default(),
                    ),
                    _o2_llm_usage_details_output: json::get_int_value(
                        item.get("llm_usage_details_output").unwrap_or_default(),
                    ),
                    _o2_llm_usage_details_total: json::get_int_value(
                        item.get("llm_usage_details_total").unwrap_or_default(),
                    ),
                    _o2_llm_cost_details_total: json::get_float_value(
                        item.get("llm_cost_details_total").unwrap_or_default(),
                    ),
                    _o2_llm_input: item.get("llm_input").cloned(),
                },
            );
        }

        // Sanitize trace IDs before interpolating into SQL: allow only hex chars and hyphens.
        // Trace IDs originate from ingested data and could contain injected SQL if not validated.
        let sanitized_ids: Vec<String> = traces_data
            .keys()
            .map(|tid| {
                tid.chars()
                    .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                    .collect::<String>()
            })
            .filter(|tid| !tid.is_empty())
            .collect();
        let trace_ids_str = sanitized_ids.join("','");
        let detail_sql = format!(
            "SELECT {TIMESTAMP_COL_NAME}, trace_id, start_time, end_time, duration, service_name, span_status \
             FROM \"{stream_name}\" WHERE trace_id IN ('{trace_ids_str}') ORDER BY {TIMESTAMP_COL_NAME} ASC"
        );

        let mut req2 = base_req.clone();
        req2.query.sql = detail_sql.clone();
        req2.query.from = 0;
        req2.query.size = get_config().limit.query_default_limit;
        req2.query.start_time = p_start_actual;
        req2.query.end_time = p_end_actual;
        let mut traces_service_name: HashMap<String, HashMap<String, u16>> = HashMap::new();

        loop {
            if sender.is_closed() {
                return;
            }
            let detail_res = match SearchService::cache::search(
                &trace_id,
                &org_id,
                stream_type,
                Some(user_id.clone()),
                &req2,
                "".to_string(),
                false,
                None,
                false,
            )
            .await
            {
                Ok(res) => res,
                Err(e) => {
                    log::error!(
                        "[TRACES_STREAM trace_id {trace_id}] Query2 error on partition [{p_start},{p_end}]: {e}"
                    );
                    let _ = sender.send(Err(e)).await;
                    return;
                }
            };

            let resp_size = detail_res.hits.len() as i64;
            for item in detail_res.hits {
                let tid = item
                    .get("trace_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let trace_start_time =
                    json::get_int_value(item.get("start_time").unwrap_or_default());
                let trace_end_time = json::get_int_value(item.get("end_time").unwrap_or_default());
                let duration = json::get_int_value(item.get("duration").unwrap_or_default());
                let service_name = item
                    .get("service_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let span_status = item
                    .get("span_status")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if let Some(trace) = traces_data.get_mut(&tid) {
                    if trace.first_event.is_null() {
                        trace.first_event = item.clone();
                    }
                    trace.spans[0] += 1;
                    if span_status == "ERROR" {
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
                    let svc_map = traces_service_name.entry(tid).or_default();
                    *svc_map.entry(service_name).or_default() += 1;
                }
            }

            if resp_size < req2.query.size {
                break;
            }
            req2.query.from += req2.query.size;
        }

        // Apply service_name aggregations
        for (tid, svc_map) in traces_service_name {
            if let Some(trace) = traces_data.get_mut(&tid) {
                for (svc, count) in svc_map {
                    trace.service_name.push(TraceServiceNameItem {
                        service_name: svc,
                        count,
                    });
                }
            }
        }

        // Sort by start_time descending (Q2 may have refined start_time from actual span data).
        let mut partition_hits: Vec<&TraceResponseItem> = traces_data.values().collect();
        partition_hits.sort_by(|a, b| b.start_time.cmp(&a.start_time));

        let deliverable: Vec<serde_json::Value> = partition_hits
            .iter()
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Null))
            .collect();

        hits_delivered += deliverable.len() as i64;

        let mut results = config::meta::search::Response::default();
        for h in deliverable {
            results.add_hit(&h);
        }
        // Set total so the frontend can display "N of M" correctly.
        results.set_total(total_across_partitions);
        // Send range_error only once (with the first batch of hits).
        if !range_error.is_empty() && !range_error_sent {
            results.function_error.push(range_error.clone());
            range_error_sent = true;
        }

        let progress = ((idx + 1) * 100) / total_partitions;
        if sender
            .send(Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs: false,
                streaming_id: None,
                time_offset: TimeOffset {
                    start_time: p_start,
                    end_time: p_end,
                },
            }))
            .await
            .is_err()
        {
            return;
        }

        if sender
            .send(Ok(StreamResponses::Progress { percent: progress }))
            .await
            .is_err()
        {
            return;
        }
    }

    let _ = sender.send(Ok(StreamResponses::Done)).await;
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
    _o2_llm_usage_details_input: i64,
    _o2_llm_usage_details_output: i64,
    _o2_llm_usage_details_total: i64,
    _o2_llm_cost_details_total: f64,
    _o2_llm_input: Option<serde_json::Value>,
}

#[derive(Debug, Default, Serialize)]
struct TraceServiceNameItem {
    service_name: String,
    count: u16,
}

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
        search::{
            PaginatedResponse, SearchPartitionRequest, StreamResponses, TimeOffset,
            default_use_cache,
        },
        stream::StreamType,
    },
    metrics,
    utils::{json, time::now_micros},
};
use futures::stream::StreamExt;
use hashbrown::HashMap;
use serde::Serialize;
use tokio::sync::mpsc;
use tracing::{Instrument, Span};

#[cfg(feature = "cloud")]
use crate::service::ingestion::check_ingestion_allowed;
// Re-export service graph API handlers
pub use crate::service::traces::service_graph::{self, get_current_topology, get_edge_history};
use crate::{
    common::{
        meta::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, HttpResponse as MetaHttpResponse},
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
        },
    },
    extractors::Headers,
    search::error_utils::map_error_to_http_response,
    service::{
        search::{self as SearchService, streaming::sorting::TopKHeap},
        traces,
    },
};

pub mod dag;
pub(crate) mod schema_compat;
pub mod session;
pub mod user;

#[derive(Default, Clone, Debug)]
pub(crate) struct TraceDetail {
    pub(crate) start_time: i64,
    pub(crate) end_time: i64,
    pub(crate) gen_ai_usage_input_tokens: i64,
    pub(crate) gen_ai_usage_output_tokens: i64,
    pub(crate) gen_ai_usage_total_tokens: i64,
    pub(crate) gen_ai_usage_cost: f64,
    pub(crate) gen_ai_usage_cache_read_input_tokens: i64,
    pub(crate) gen_ai_usage_cache_creation_input_tokens: i64,
    pub(crate) gen_ai_usage_cost_cache_read_input: f64,
    pub(crate) gen_ai_usage_cost_cache_creation_input: f64,
    pub(crate) gen_ai_usage_cost_estimated_without_cache: f64,
    pub(crate) gen_ai_usage_cost_cache_read_savings: f64,
    pub(crate) gen_ai_usage_cost_net_cache_impact: f64,
    pub(crate) error_count: i64,
    pub(crate) user_id: Option<String>,
    pub(crate) first_user_message: Option<String>,
}

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
        ("sort_by" = Option<String>, Query, description = "sort by field: start_time, duration (default: start_time)"),
        ("sort_order" = Option<String>, Query, description = "sort order: asc, desc (default: desc)"),
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
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "List recent traces with summaries (trace_id, span count, service names, duration). Supports filter and sort by start_time/duration.", "category": "traces", "pinned": true}))
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

    let (http_span, trace_id) = if cfg.common.should_create_span() {
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

            if !crate::service::authz::check_permissions(
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
                    use_all_org: false,
                    use_self_context: false,
                    use_self_parent: true,
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
        end_time = std::cmp::min(now_micros(), start_time_from_trace_id + 3600 * 1_000_000); //1 hour later
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
    // Fetch and validate the LLM schema so SQL never references missing columns.
    let schema = infra::schema::get_stream_schema_from_cache(
        org_id.as_str(),
        stream_name.as_str(),
        StreamType::Traces,
    )
    .await;
    let validated_schema = if is_llm_stream {
        match schema.as_ref() {
            Some(s) => match schema_compat::validate_llm_schema(s, &stream_name) {
                Ok(v) => Some(v),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            },
            // Schema not yet cached: fall back with all required fields assumed
            // present and optional fields marked absent.
            None => Some(schema_compat::ValidatedLlmSchema::fallback(false)),
        }
    } else {
        None
    };
    let mut range_error = String::new();
    if max_query_range > 0 && (end_time - start_time) > max_query_range * 3600 * 1_000_000 {
        start_time = end_time - max_query_range * 3600 * 1_000_000;
        range_error = format!(
            "Query duration is modified due to query range restriction of {max_query_range} hours"
        );
    }

    // Schema-dependent expressions for Q2a trace aggregates — computed once here
    // and reused in Q1 (merged) and Q2b (service breakdown).
    let has_ref_parent_id = schema
        .as_ref()
        .map(|s| s.field_with_name("reference_parent_span_id").is_ok())
        .unwrap_or(false);
    let has_infer = schema
        .as_ref()
        .map(|s| {
            s.field_with_name(traces::inferred::INFER_SERVICE_NAME)
                .is_ok()
        })
        .unwrap_or(false);
    let service_key_expr = if has_infer {
        "COALESCE(infer_service_name, service_name)"
    } else {
        "service_name"
    };
    let (root_service_name_expr, root_operation_name_expr) = if has_ref_parent_id {
        (
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN service_name END)",
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN operation_name END)",
        )
    } else {
        ("null", "null")
    };
    let extra_trace_selects = format!(
        "count(*) AS span_count, \
         sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count, \
         max(duration) AS max_duration, \
         count(DISTINCT {service_key_expr}) AS service_count, \
         {root_service_name_expr} AS root_service_name, \
         {root_operation_name_expr} AS root_operation_name, \
         first_value(service_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_service_name, \
         first_value(operation_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_operation_name"
    );

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    let sort_by = query
        .get("sort_by")
        .map_or("start_time", |v| v.as_str())
        .to_string()
        .to_lowercase();
    let sort_order = query
        .get("sort_order")
        .map_or("desc", |v| v.as_str())
        .to_string()
        .to_lowercase();
    let sort_order = if sort_order == "asc" { "ASC" } else { "DESC" };

    // search
    let query_sql = if let Some(ref validated) = validated_schema {
        build_llm_trace_query(&stream_name, validated, &extra_trace_selects)
    } else {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            {extra_trace_selects} \
            FROM \"{stream_name}\""
        )
    };
    let sql_order_expr = match sort_by.as_str() {
        "duration" => format!("zo_sql_duration {sort_order}"),
        "start_time" | "_timestamp" => format!("zo_sql_timestamp {sort_order}"),
        _ => {
            return MetaHttpResponse::bad_request(
                "Invalid sort_by field, only support duration and start_time",
            );
        }
    };
    let query_sql = if filter.is_empty() {
        format!("{query_sql} GROUP BY trace_id ORDER BY {sql_order_expr}")
    } else {
        format!("{query_sql} WHERE {filter} GROUP BY trace_id ORDER BY {sql_order_expr}")
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
            timezone: None,
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
    // Trace IDs that have more than one service — these need a follow-up Q2b.
    let mut multi_service_tids: Vec<String> = Vec::new();
    let mut multi_service_total: i64 = 0;

    for item in resp_search.hits {
        let trace_id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
        let trace_start_time = json::get_int_value(item.get("trace_start_time").unwrap());
        let trace_end_time = json::get_int_value(item.get("trace_end_time").unwrap());
        let _trace_duration = json::get_int_value(item.get("zo_sql_duration").unwrap());
        // trace time is nanosecond, need to compare with microsecond
        if trace_start_time / 1000 < start_time {
            start_time = trace_start_time / 1000;
        }
        if trace_end_time / 1000 > end_time {
            // because we search with < end_time, so we need to add 1 to the end_time
            end_time = trace_end_time / 1000 + 1;
        }

        // Q2a fields now populated directly from Q1 (merged query).
        let span_count = json::get_int_value(item.get("span_count").unwrap_or_default());
        let error_count = json::get_int_value(item.get("error_count").unwrap_or_default());
        let max_duration = json::get_int_value(item.get("max_duration").unwrap_or_default());
        let service_count = json::get_int_value(item.get("service_count").unwrap_or_default());
        let root_service_name = item
            .get("root_service_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let root_operation_name = item
            .get("root_operation_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let first_service_name = item
            .get("first_service_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let first_operation_name = item
            .get("first_operation_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        // Prefer the true root span's labels; fall back to earliest span.
        let event_service_name = if !root_service_name.is_empty() {
            root_service_name
        } else {
            first_service_name
        };
        let event_operation_name = if !root_operation_name.is_empty() {
            root_operation_name
        } else {
            first_operation_name
        };

        let mut svc_list = Vec::new();
        if service_count <= 1 {
            if !event_service_name.is_empty() {
                svc_list.push(TraceServiceNameItem {
                    service_name: event_service_name.clone(),
                    count: span_count.try_into().unwrap_or_default(),
                    duration: max_duration,
                    service_type: None,
                });
            }
        } else {
            multi_service_tids.push(trace_id.clone());
            multi_service_total += service_count;
        }

        let computed_duration = if trace_end_time - trace_start_time > max_duration * 1000 {
            (trace_end_time - trace_start_time) / 1000
        } else {
            max_duration
        };

        traces_data.insert(
            trace_id.clone(),
            TraceResponseItem {
                trace_id,
                start_time: trace_start_time,
                end_time: trace_end_time,
                duration: computed_duration,
                spans: [
                    span_count.try_into().unwrap_or_default(),
                    error_count.try_into().unwrap_or_default(),
                ],
                service_name: svc_list,
                first_event: serde_json::json!({
                    "service_name": event_service_name,
                    "operation_name": event_operation_name,
                }),
                gen_ai_usage_input_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_input").unwrap_or_default(),
                ),
                gen_ai_usage_output_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_output").unwrap_or_default(),
                ),
                gen_ai_usage_total_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_total").unwrap_or_default(),
                ),
                gen_ai_usage_cost: json::get_float_value(
                    item.get("gen_ai_usage_cost_details").unwrap_or_default(),
                ),
                gen_ai_input_messages: item.get("gen_ai_input_messages").cloned(),
                models: item
                    .get("gen_ai_response_models")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            },
        );
    }

    // Q2b: per-(trace_id, service_name) breakdown, only for multi-service traces.
    if !multi_service_tids.is_empty() {
        // Trace IDs come from DB rows and must be validated before interpolating into SQL.
        let multi_ids_str = multi_service_tids
            .iter()
            .map(|tid| {
                tid.chars()
                    .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                    .collect::<String>()
            })
            .filter(|tid| !tid.is_empty())
            .collect::<Vec<String>>()
            .join("','");
        // max(infer_service_type) over a COALESCE group is the group's inferred type
        // ("database"/"queue"/...) for inferred entities and NULL for instrumented
        // services, which the UI uses to render inferred nodes with a dotted style.
        let svc_type_select = if has_infer {
            ", max(infer_service_type) AS service_type"
        } else {
            ""
        };
        let svc_sql = format!(
            "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
             count(*) AS svc_count, max(duration) AS svc_duration \
             FROM \"{stream_name}\" WHERE trace_id IN ('{multi_ids_str}') \
             GROUP BY trace_id, {service_key_expr}"
        );
        req.query.sql = svc_sql;
        req.query.from = 0;
        // Output is bounded to the total service count summed from Q1, so a single
        // request fetches everything.
        req.query.size = multi_service_total;

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
                log::error!("get traces latest service-breakdown error: {err:?}");
                return map_error_to_http_response(&err, Some(trace_id));
            }
        };

        for item in resp_search.hits {
            let tid = item
                .get("trace_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_name = item
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_count = json::get_int_value(item.get("svc_count").unwrap_or_default());
            let svc_duration = json::get_int_value(item.get("svc_duration").unwrap_or_default());
            // Present only for inferred entities; absent => instrumented service.
            let svc_type = item
                .get("service_type")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);
            if let Some(trace) = traces_data.get_mut(&tid) {
                trace.service_name.push(TraceServiceNameItem {
                    service_name: svc_name,
                    count: svc_count.try_into().unwrap_or_default(),
                    duration: svc_duration,
                    service_type: svc_type,
                });
            }
        }
    }
    let mut traces_data = traces_data.values().collect::<Vec<&TraceResponseItem>>();
    match sort_by.as_str() {
        "duration" => {
            if sort_order == "ASC" {
                traces_data.sort_by_key(|k| k.duration);
            } else {
                traces_data.sort_by_key(|k| std::cmp::Reverse(k.duration));
            }
        }
        _ => {
            if sort_order == "ASC" {
                traces_data.sort_by_key(|k| k.start_time);
            } else {
                traces_data.sort_by_key(|k| std::cmp::Reverse(k.start_time));
            }
        }
    }

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

    MetaHttpResponse::json(PaginatedResponse {
        took: (time * 1000.0) as usize,
        total: traces_data.len(),
        from,
        size,
        hits: traces_data
            .into_iter()
            .map(|v| json::to_value(v).unwrap())
            .collect(),
        trace_id,
        function_error: range_error,
    })
}

/// Build the shared LLM trace aggregation SQL (Query 1) for table and streaming
/// handlers.
///
/// Produces a `SELECT trace_id … GROUP BY trace_id` query that computes per-trace
/// start/end times, duration, token/cost sums, distinct response models, and
/// (when the optional input-messages column exists) the first input message.
///
/// `extra_selects` are additional aggregate columns appended before `FROM` (e.g.
/// span_count, error_count, max_duration — the Q2a fields now merged into Q1).
///
/// For legacy `_o2_llm` streams the column names are mapped to the legacy
/// `llm_*` equivalents. The function is pure — callers add WHERE and ORDER BY.
fn build_llm_trace_query(
    stream_name: &str,
    validated: &schema_compat::ValidatedLlmSchema,
    extra_selects: &str,
) -> String {
    let first_msg_clause = if validated.has_gen_ai {
        if validated.has_input_messages {
            format!(
                "FIRST_VALUE(gen_ai_input_messages ORDER BY {TIMESTAMP_COL_NAME} ASC) FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != '')"
            )
        } else {
            "''".to_string()
        }
    } else if validated.has_input_messages {
        format!(
            "FIRST_VALUE(llm_input ORDER BY {TIMESTAMP_COL_NAME} ASC) FILTER (WHERE llm_input IS NOT NULL AND llm_input != '')"
        )
    } else {
        "''".to_string()
    };

    if validated.has_gen_ai {
        let total_tokens_expr = if validated.has_total_tokens {
            "sum(gen_ai_usage_total_tokens) as gen_ai_usage_details_total"
        } else {
            "0 as gen_ai_usage_details_total"
        };
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            sum(gen_ai_usage_input_tokens) as gen_ai_usage_details_input, \
            sum(gen_ai_usage_output_tokens) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(gen_ai_usage_cost) as gen_ai_usage_cost_details, \
            array_agg(DISTINCT gen_ai_response_model) FILTER (WHERE gen_ai_response_model IS NOT NULL AND gen_ai_response_model != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {extra_selects} \
            FROM \"{stream_name}\""
        )
    } else {
        let total_tokens_expr = if validated.has_total_tokens {
            "sum(llm_usage_tokens_total) as gen_ai_usage_details_total"
        } else {
            "0 as gen_ai_usage_details_total"
        };
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            sum(llm_usage_tokens_input) as gen_ai_usage_details_input, \
            sum(llm_usage_tokens_output) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(llm_usage_cost_total) as gen_ai_usage_cost_details, \
            array_agg(DISTINCT llm_model_name) FILTER (WHERE llm_model_name IS NOT NULL AND llm_model_name != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {extra_selects} \
            FROM \"{stream_name}\""
        )
    }
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
        ("sort_by" = Option<String>, Query, description = "sort by field: start_time, duration (default: start_time)"),
        ("sort_order" = Option<String>, Query, description = "sort order: asc, desc (default: desc)"),
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

    let (http_span, trace_id) = if cfg.common.should_create_span() {
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

            if !crate::service::authz::check_permissions(
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
                    use_all_org: false,
                    use_self_context: false,
                    use_self_parent: true,
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
    let validated_schema = if is_llm_stream {
        let schema = infra::schema::get_stream_schema_from_cache(
            org_id.as_str(),
            stream_name.as_str(),
            StreamType::Traces,
        )
        .await;
        match schema.as_ref() {
            Some(s) => match schema_compat::validate_llm_schema(s, &stream_name) {
                Ok(v) => Some(v),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            },
            None => Some(schema_compat::ValidatedLlmSchema::fallback(false)),
        }
    } else {
        None
    };
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
    let sort_by = query
        .get("sort_by")
        .map_or("start_time", |v| v.as_str())
        .to_string()
        .to_lowercase();
    let sort_order = query
        .get("sort_order")
        .map_or("desc", |v| v.as_str())
        .to_string()
        .to_lowercase();
    let sort_order = if sort_order == "asc" { "ASC" } else { "DESC" };
    let sql_order_expr = match sort_by.as_str() {
        "duration" => format!("zo_sql_duration {sort_order}"),
        "start_time" | "_timestamp" => format!("zo_sql_timestamp {sort_order}"),
        _ => {
            return MetaHttpResponse::bad_request(
                "Invalid sort_by field, only support duration and start_time",
            );
        }
    };

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
            sort_order.to_string(),
            sql_order_expr,
            validated_schema,
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
///   1. Run Query 1: GROUP BY trace_id to get trace summaries with per-trace aggregates
///      (span_count, error_count, etc. — formerly Q2a, now merged).
///   2. Run Query 2b: per-service breakdown only for multi-service traces.
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
    sort_order: String,
    sql_order_expr: String,
    validated_schema: Option<schema_compat::ValidatedLlmSchema>,
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

    // Schema-dependent expressions for Q2a trace aggregates — computed once here
    // and reused in Q1 (merged) and Q2b (service breakdown).
    let stream_schema =
        infra::schema::get_stream_schema_from_cache(&org_id, &stream_name, StreamType::Traces)
            .await;
    let has_ref_parent_id = stream_schema
        .as_ref()
        .map(|s| s.field_with_name("reference_parent_span_id").is_ok())
        .unwrap_or(false);
    let has_infer = stream_schema
        .as_ref()
        .map(|s| {
            s.field_with_name(traces::inferred::INFER_SERVICE_NAME)
                .is_ok()
        })
        .unwrap_or(false);
    let service_key_expr = if has_infer {
        "COALESCE(infer_service_name, service_name)"
    } else {
        "service_name"
    };
    let (root_svc_expr, root_op_expr) = if has_ref_parent_id {
        (
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN service_name END)",
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN operation_name END)",
        )
    } else {
        ("null", "null")
    };
    let extra_trace_selects = format!(
        "count(*) AS span_count, \
         sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count, \
         max(duration) AS max_duration, \
         count(DISTINCT {service_key_expr}) AS service_count, \
         {root_svc_expr} AS root_service_name, \
         {root_op_expr} AS root_operation_name, \
         first_value(service_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_service_name, \
         first_value(operation_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_operation_name"
    );

    // Build the aggregation SQL (Query 1) — shared with get_latest_traces through
    // build_llm_trace_query. The validated schema (or fallback when not cached)
    // guarantees required columns exist and optional columns are checked.
    let query_sql_base = if let Some(ref validated) = validated_schema {
        build_llm_trace_query(&stream_name, validated, &extra_trace_selects)
    } else {
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            {extra_trace_selects} \
            FROM \"{stream_name}\""
        )
    };
    let query_sql = if filter.is_empty() {
        format!("{query_sql_base} GROUP BY trace_id ORDER BY {sql_order_expr}")
    } else {
        format!("{query_sql_base} WHERE {filter} GROUP BY trace_id ORDER BY {sql_order_expr}")
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
            timezone: None,
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
        sql: format!("SELECT * FROM \"{stream_name}\""),
        start_time,
        end_time,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        query_fn: None,
        streaming_output: false,
        histogram_interval: 0,
        sampling_ratio: None,
        search_type: Some(config::meta::search::SearchEventType::UI),
    };

    let partitions = match SearchService::search_partition(
        &trace_id,
        &org_id,
        Some(user_id.as_str()),
        stream_type,
        &partition_req,
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
    // Non-ts ORDER BY uses TopKHeap across all partitions — no single-partition collapse.
    // ts ASC reverses partition order; everything else (ts DESC and all non-ts) is newest-first.
    let is_non_ts_order_by = !sql_order_expr.starts_with("zo_sql_timestamp");
    let partitions_desc: Vec<[i64; 2]> = if sql_order_expr == "zo_sql_timestamp ASC" {
        log::info!(
            "[TRACES_STREAM trace_id {trace_id}] using {} time partitions, order=ASC",
            partitions.len()
        );
        partitions.into_iter().rev().collect()
    } else {
        log::info!(
            "[TRACES_STREAM trace_id {trace_id}] using {} time partitions, order={}",
            partitions.len(),
            if is_non_ts_order_by {
                format!("non-ts ({sql_order_expr}), TopKHeap")
            } else {
                "DESC".to_string()
            }
        );
        partitions
    };

    // For non-ts ORDER BY: TopKHeap merges Q1 results across all partitions.
    // k = from + size so the heap is bounded and O(k) memory at all times.
    // Q2 runs once after all partitions are drained — no per-partition streaming.
    let heap_k = if from + size > 0 {
        (from + size) as usize
    } else {
        get_config().limit.query_default_limit as usize
    };
    let (non_ts_col, non_ts_is_desc) = parse_order_expr(&sql_order_expr);
    let mut topk_heap: Option<TopKHeap> = if is_non_ts_order_by {
        Some(TopKHeap::new(heap_k, &[(non_ts_col, non_ts_is_desc)]))
    } else {
        None
    };

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
    // For absolute time ranges: skip remaining partitions after 3 consecutive empty ones.
    let mut consecutive_empty_partitions: i64 = 0;

    for (idx, partition) in partitions_desc.iter().enumerate() {
        if sender.is_closed() {
            break;
        }
        if hits_delivered >= hits_to_deliver {
            break;
        }

        let p_start = partition[0];
        let p_end = partition[1];

        let remaining_to_skip = (hits_to_skip - hits_seen).max(0);
        let remaining_needed = hits_to_deliver - hits_delivered;
        // Non-ts ORDER BY: each partition fetches its local top-k = heap_k rows so the heap can
        // select the global top-k after all partitions complete. No query_default_limit cap here.
        // ts ORDER BY: cap per partition to avoid oversized Q1 scans.
        let fetch_size = if is_non_ts_order_by {
            heap_k as i64
        } else {
            (remaining_to_skip + remaining_needed).min(get_config().limit.query_default_limit)
        };

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

        // For ts ORDER BY with absolute time ranges: skip remaining partitions after
        // 3 consecutive genuinely empty ones (no data at all, not just deduped).
        let raw_hit_count = agg_res.hits.len();
        if !is_non_ts_order_by {
            if raw_hit_count == 0 {
                consecutive_empty_partitions += 1;
                if consecutive_empty_partitions >= 3 {
                    break;
                }
            } else {
                consecutive_empty_partitions = 0;
            }
        }

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

        // Non-ts ORDER BY: push this partition's Q1 hits into the global heap and move on.
        // Seen trace IDs are registered here so later partitions skip duplicates.
        // Q2 and final streaming happen after all partitions complete.
        if is_non_ts_order_by {
            for item in &deduped_hits {
                if let Some(tid) = item.get("trace_id").and_then(|v| v.as_str())
                    && !tid.is_empty()
                {
                    seen_trace_ids.insert(tid.to_string());
                }
            }
            if let Some(ref mut heap) = topk_heap {
                heap.push_hits(deduped_hits);
            }
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        // ts ORDER BY: sort Q1 hits by trace_start_time (Q1 orders by zo_sql_timestamp; UI expects
        // trace_start_time order). Register seen IDs before slicing so dedup covers skipped traces.
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
        let Some(traces_data) = run_q2_for_traces(
            &deliverable_q1,
            p_start,
            p_end,
            &base_req,
            &trace_id,
            &org_id,
            stream_type,
            &user_id,
            &stream_name,
            &sender,
            &format!("partition [{p_start},{p_end}]"),
        )
        .await
        else {
            return;
        };

        let mut partition_hits: Vec<&TraceResponseItem> = traces_data.values().collect();
        if sort_order == "ASC" {
            partition_hits.sort_by_key(|k| k.start_time);
        } else {
            partition_hits.sort_by_key(|k| std::cmp::Reverse(k.start_time));
        }

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

    // ── Non-ts ORDER BY: drain heap → Q2 once → stream final result ─────────────────────────
    if is_non_ts_order_by {
        let deliverable_q1 = topk_heap
            .take()
            .map(|h| h.into_sorted_vec(from as usize))
            .unwrap_or_default();

        if deliverable_q1.is_empty() {
            let _ = sender.send(Ok(StreamResponses::Done)).await;
            return;
        }

        let Some(traces_data) = run_q2_for_traces(
            &deliverable_q1,
            start_time,
            end_time,
            &base_req,
            &trace_id,
            &org_id,
            stream_type,
            &user_id,
            &stream_name,
            &sender,
            "non-ts",
        )
        .await
        else {
            return;
        };

        // Preserve heap ordering: walk deliverable_q1 in heap-drain order (already globally
        // sorted by the non-ts column). Q2 may have refined start_time/duration but the
        // relative ORDER BY column rank from Q1 is authoritative.
        let partition_hits: Vec<&TraceResponseItem> = deliverable_q1
            .iter()
            .filter_map(|item| {
                let tid = item.get("trace_id").and_then(|v| v.as_str())?;
                traces_data.get(tid)
            })
            .collect();

        let deliverable: Vec<serde_json::Value> = partition_hits
            .iter()
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Null))
            .collect();

        let mut results = config::meta::search::Response::default();
        for h in deliverable {
            results.add_hit(&h);
        }
        results.set_total(total_across_partitions);
        if !range_error.is_empty() {
            results.function_error.push(range_error.clone());
        }

        let _ = sender
            .send(Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs: false,
                streaming_id: None,
                time_offset: TimeOffset {
                    start_time,
                    end_time,
                },
            }))
            .await;
        let _ = sender.send(Ok(StreamResponses::Done)).await;
        return;
    }

    let _ = sender.send(Ok(StreamResponses::Done)).await;
}

/// Extract ORDER BY column name and direction from a `"<col> DESC|ASC"` expression.
fn parse_order_expr(sql_order_expr: &str) -> (String, bool) {
    let mut parts = sql_order_expr.split_whitespace();
    let col = parts.next().unwrap_or("zo_sql_duration").to_string();
    let is_desc = parts
        .next()
        .map(|d| d.to_uppercase() != "ASC")
        .unwrap_or(true);
    (col, is_desc)
}

/// Runs Q2b (per-service breakdown) for a slice of Q1 hits that already contain
/// the per-trace aggregate fields (span_count, error_count, etc. — merged from Q2a).
/// Builds the `TraceResponseItem` map.
///
/// `window_start` / `window_end` (microseconds) are the initial search window; they expand
/// to cover actual span times reported by Q1.
///
/// Returns `Some(traces_data)` on success. On error the error is sent on `sender` and
/// `None` is returned — callers should `return` immediately.
#[allow(clippy::too_many_arguments)]
async fn run_q2_for_traces(
    q1_hits: &[serde_json::Value],
    window_start: i64,
    window_end: i64,
    base_req: &config::meta::search::Request,
    req_trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: &str,
    stream_name: &str,
    sender: &mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    log_ctx: &str,
) -> Option<HashMap<String, TraceResponseItem>> {
    let mut q2_start = window_start;
    let mut q2_end = window_end;
    let mut traces_data: HashMap<String, TraceResponseItem> = HashMap::with_capacity(q1_hits.len());
    let mut multi_service_tids: Vec<String> = Vec::new();
    let mut multi_service_total: i64 = 0;

    for item in q1_hits {
        let tid = item
            .get("trace_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let trace_start_time =
            json::get_int_value(item.get("trace_start_time").unwrap_or_default());
        let trace_end_time = json::get_int_value(item.get("trace_end_time").unwrap_or_default());
        if trace_start_time > 0 && trace_start_time / 1000 < q2_start {
            q2_start = trace_start_time / 1000;
        }
        if trace_end_time > 0 && trace_end_time / 1000 + 1 > q2_end {
            q2_end = trace_end_time / 1000 + 1;
        }
        if tid.is_empty() {
            continue;
        }

        // Q2a fields now populated directly from Q1 (merged query).
        let span_count = json::get_int_value(item.get("span_count").unwrap_or_default());
        let error_count = json::get_int_value(item.get("error_count").unwrap_or_default());
        let max_duration = json::get_int_value(item.get("max_duration").unwrap_or_default());
        let service_count = json::get_int_value(item.get("service_count").unwrap_or_default());
        let root_service_name = item
            .get("root_service_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let root_operation_name = item
            .get("root_operation_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let first_service_name = item
            .get("first_service_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let first_operation_name = item
            .get("first_operation_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let event_service_name = if !root_service_name.is_empty() {
            root_service_name
        } else {
            first_service_name
        };
        let event_operation_name = if !root_operation_name.is_empty() {
            root_operation_name
        } else {
            first_operation_name
        };

        let mut svc_list = Vec::new();
        if service_count <= 1 {
            if !event_service_name.is_empty() {
                svc_list.push(TraceServiceNameItem {
                    service_name: event_service_name.clone(),
                    count: span_count.try_into().unwrap_or_default(),
                    duration: max_duration,
                    service_type: None,
                });
            }
        } else {
            multi_service_tids.push(tid.clone());
            multi_service_total += service_count;
        }

        let computed_duration = if trace_end_time - trace_start_time > max_duration * 1000 {
            (trace_end_time - trace_start_time) / 1000
        } else {
            max_duration
        };

        traces_data.insert(
            tid.clone(),
            TraceResponseItem {
                trace_id: tid,
                start_time: trace_start_time,
                end_time: trace_end_time,
                duration: computed_duration,
                spans: [
                    span_count.try_into().unwrap_or_default(),
                    error_count.try_into().unwrap_or_default(),
                ],
                service_name: svc_list,
                first_event: serde_json::json!({
                    "service_name": event_service_name,
                    "operation_name": event_operation_name,
                }),
                gen_ai_usage_input_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_input").unwrap_or_default(),
                ),
                gen_ai_usage_output_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_output").unwrap_or_default(),
                ),
                gen_ai_usage_total_tokens: json::get_int_value(
                    item.get("gen_ai_usage_details_total").unwrap_or_default(),
                ),
                gen_ai_usage_cost: json::get_float_value(
                    item.get("gen_ai_usage_cost_details").unwrap_or_default(),
                ),
                gen_ai_input_messages: item.get("gen_ai_input_messages").cloned(),
                models: item
                    .get("gen_ai_response_models")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            },
        );
    }

    // Re-fetch schema for Q2b (service breakdown) expressions.
    let trace_schema =
        infra::schema::get_stream_schema_from_cache(org_id, stream_name, StreamType::Traces).await;
    let has_infer = trace_schema
        .as_ref()
        .map(|s| {
            s.field_with_name(traces::inferred::INFER_SERVICE_NAME)
                .is_ok()
        })
        .unwrap_or(false);
    let service_key_expr = if has_infer {
        "COALESCE(infer_service_name, service_name)"
    } else {
        "service_name"
    };

    if !multi_service_tids.is_empty() {
        let multi_ids_str = multi_service_tids
            .iter()
            .map(|tid| {
                tid.chars()
                    .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                    .collect::<String>()
            })
            .filter(|tid| !tid.is_empty())
            .collect::<Vec<String>>()
            .join("','");
        let svc_type_select = if has_infer {
            ", max(infer_service_type) AS service_type"
        } else {
            ""
        };
        let svc_sql = format!(
            "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
             count(*) AS svc_count, max(duration) AS svc_duration \
             FROM \"{stream_name}\" WHERE trace_id IN ('{multi_ids_str}') \
             GROUP BY trace_id, {service_key_expr}"
        );
        let mut req3 = base_req.clone();
        req3.query.sql = svc_sql;
        req3.query.from = 0;
        req3.query.size = multi_service_total;
        req3.query.start_time = q2_start;
        req3.query.end_time = q2_end;

        if sender.is_closed() {
            return None;
        }
        let svc_res = match SearchService::cache::search(
            req_trace_id,
            org_id,
            stream_type,
            Some(user_id.to_string()),
            &req3,
            "".to_string(),
            false,
            None,
            false,
        )
        .await
        {
            Ok(res) => res,
            Err(e) => {
                log::error!("[TRACES_STREAM trace_id {req_trace_id}] Q2b error ({log_ctx}): {e}");
                let _ = sender.send(Err(e)).await;
                return None;
            }
        };
        for item in svc_res.hits {
            let tid = item
                .get("trace_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_name = item
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_count = json::get_int_value(item.get("svc_count").unwrap_or_default());
            let svc_duration = json::get_int_value(item.get("svc_duration").unwrap_or_default());
            // Present only for inferred entities; absent => instrumented service.
            let svc_type = item
                .get("service_type")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);
            if let Some(trace) = traces_data.get_mut(&tid) {
                trace.service_name.push(TraceServiceNameItem {
                    service_name: svc_name,
                    count: svc_count.try_into().unwrap_or_default(),
                    duration: svc_duration,
                    service_type: svc_type,
                });
            }
        }
    }

    Some(traces_data)
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
    gen_ai_usage_input_tokens: i64,
    gen_ai_usage_output_tokens: i64,
    gen_ai_usage_total_tokens: i64,
    gen_ai_usage_cost: f64,
    gen_ai_input_messages: Option<serde_json::Value>,
    models: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
struct TraceServiceNameItem {
    service_name: String,
    count: u16,
    duration: i64,
    /// Inferred-service category ("database"/"queue"/"rpc"/"external") when this
    /// entity is an uninstrumented dependency; `None` for instrumented services.
    /// The UI renders inferred entities with a dotted style.
    #[serde(skip_serializing_if = "Option::is_none")]
    service_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trace_service_name_item_default() {
        let item = TraceServiceNameItem::default();
        assert_eq!(item.service_name, "");
        assert_eq!(item.count, 0);
        assert_eq!(item.duration, 0);
        assert_eq!(item.service_type, None);
    }

    #[test]
    fn test_trace_service_name_item_fields() {
        let item = TraceServiceNameItem {
            service_name: "my-service".to_string(),
            count: 42,
            duration: 1000,
            service_type: None,
        };
        assert_eq!(item.service_name, "my-service");
        assert_eq!(item.count, 42);
        assert_eq!(item.duration, 1000);
    }

    #[test]
    fn test_trace_service_name_item_inferred_serializes_service_type() {
        // Instrumented service: service_type omitted from JSON.
        let instrumented = TraceServiceNameItem {
            service_name: "checkout".to_string(),
            count: 3,
            duration: 100,
            service_type: None,
        };
        let json = serde_json::to_value(&instrumented).unwrap();
        assert!(!json.as_object().unwrap().contains_key("service_type"));

        // Inferred dependency: service_type present for dotted rendering.
        let inferred = TraceServiceNameItem {
            service_name: "redis-master.prod".to_string(),
            count: 5,
            duration: 200,
            service_type: Some("database".to_string()),
        };
        let json = serde_json::to_value(&inferred).unwrap();
        assert_eq!(
            json.get("service_type").and_then(|v| v.as_str()),
            Some("database")
        );
    }
}

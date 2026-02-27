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

use axum::{extract::Path, http::HeaderMap, response::Response};
use config::{TIMESTAMP_COL_NAME, get_config, meta::stream::StreamType, metrics, utils::json};
use hashbrown::HashMap;
use serde::Serialize;
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
        },
    },
    handler::http::{
        extractors::Headers, request::search::error_utils::map_error_to_http_response,
    },
    service::{search as SearchService, traces::otel::attributes::O2Attributes},
};

/// GetLatestSessions
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/session",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestSessions",
    summary = "Get recent session data",
    description = "Retrieves the most recent LLM session data from a specific trace stream within a time range. Sessions group multiple traces that share the same session ID. Returns session summaries including session IDs, trace counts, LLM usage statistics, cost, and timing information.",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "total": 2,
            "from": 0,
            "size": 10,
            "hits": [
                {
                    "session_id": "session-abc-123",
                    "start_time": 1234567890,
                    "end_time": 1234567900,
                    "duration": 10,
                    "trace_count": 3,
                    "_o2_llm_usage_details_input": 100,
                    "_o2_llm_usage_details_output": 50,
                    "_o2_llm_usage_details_total": 150,
                    "_o2_llm_cost_details_total": 0.005
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_latest_sessions(
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
            "/api/{org_id}/{stream_name}/traces/session",
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
    let end_time = query
        .get("end_time")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    if end_time == 0 {
        return MetaHttpResponse::bad_request("end_time is empty");
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

    // session_id may appear on the first span only or on all spans of a trace.
    // _o2_llm_* fields may be on different spans than session_id.
    // So we must: get session→trace_id mapping first, then query by trace_id
    // (which captures ALL spans) to get accurate _o2_llm_* totals.
    let session_id_col = O2Attributes::SESSION_ID;
    let stream_type = StreamType::Traces;
    let user_id_opt = Some(user_id.to_string());

    // Phase 1: Get paginated session list with trace_ids per session
    let session_filter = if filter.is_empty() {
        format!("{session_id_col} IS NOT NULL AND {session_id_col} != ''")
    } else {
        format!("{session_id_col} IS NOT NULL AND {session_id_col} != '' AND {filter}")
    };
    let query_sql = format!(
        "SELECT {session_id_col}, \
        min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
        array_agg(DISTINCT trace_id) as trace_ids \
        FROM \"{stream_name}\" \
        WHERE {session_filter} \
        GROUP BY {session_id_col} \
        ORDER BY zo_sql_timestamp DESC"
    );

    let mut req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql,
            from,
            size,
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        timeout,
        use_cache: get_use_cache_from_request(&query),
        ..Default::default()
    };

    let resp_search = match SearchService::cache::search(
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
    .await
    {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/session",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/session",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("get sessions latest data error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    if resp_search.hits.is_empty() {
        return MetaHttpResponse::json(resp_search);
    }

    // Parse session_id -> trace_ids from Phase 1 results
    let mut session_trace_ids: HashMap<String, Vec<String>> =
        HashMap::with_capacity(resp_search.hits.len());
    let mut session_ids: Vec<String> = Vec::with_capacity(resp_search.hits.len());
    for item in resp_search.hits {
        let session_id = match item.get(session_id_col).and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let trace_ids: Vec<String> = item
            .get("trace_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        session_ids.push(session_id.clone());
        session_trace_ids.insert(session_id, trace_ids);
    }

    // Collect all unique trace_ids across sessions
    let all_trace_ids: Vec<String> = session_trace_ids
        .values()
        .flat_map(|ids| ids.iter().cloned())
        .collect::<hashbrown::HashSet<String>>()
        .into_iter()
        .collect();

    // Phase 2: Get per-trace details by querying with trace_id (captures ALL spans)
    let trace_ids_sql = all_trace_ids.join("','");
    let query_sql = format!(
        "SELECT trace_id, \
        min(start_time) as trace_start_time, \
        max(end_time) as trace_end_time, \
        sum(_o2_llm_usage_details_input) as llm_usage_details_input, \
        sum(_o2_llm_usage_details_output) as llm_usage_details_output, \
        sum(_o2_llm_usage_details_total) as llm_usage_details_total, \
        sum(_o2_llm_cost_details_total) as llm_cost_details_total \
        FROM \"{stream_name}\" \
        WHERE trace_id IN ('{trace_ids_sql}') \
        GROUP BY trace_id"
    );
    req.query.sql = query_sql;
    req.query.from = 0;
    req.query.size = all_trace_ids.len() as i64;

    let mut trace_details: HashMap<String, TraceDetail> = HashMap::new();
    let resp = match SearchService::cache::search(
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
    .await
    {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/session",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/session",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("get sessions trace details error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    for item in resp.hits {
        let tid = match item.get("trace_id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        trace_details.insert(
            tid,
            TraceDetail {
                start_time: json::get_int_value(item.get("trace_start_time").unwrap_or_default()),
                end_time: json::get_int_value(item.get("trace_end_time").unwrap_or_default()),
                llm_usage_input: json::get_int_value(
                    item.get("llm_usage_details_input").unwrap_or_default(),
                ),
                llm_usage_output: json::get_int_value(
                    item.get("llm_usage_details_output").unwrap_or_default(),
                ),
                llm_usage_total: json::get_int_value(
                    item.get("llm_usage_details_total").unwrap_or_default(),
                ),
                llm_cost_total: json::get_float_value(
                    item.get("llm_cost_details_total").unwrap_or_default(),
                ),
            },
        );
    }

    // Aggregate per session from trace details
    let mut sessions_data: Vec<SessionResponseItem> = Vec::with_capacity(session_ids.len());
    for session_id in &session_ids {
        let trace_ids = match session_trace_ids.get(session_id) {
            Some(ids) => ids,
            None => continue,
        };
        let mut session_start_time: i64 = 0;
        let mut session_end_time: i64 = 0;
        let mut usage_input: i64 = 0;
        let mut usage_output: i64 = 0;
        let mut usage_total: i64 = 0;
        let mut cost_total: f64 = 0.0;
        for tid in trace_ids {
            if let Some(detail) = trace_details.get(tid) {
                if session_start_time == 0 || detail.start_time < session_start_time {
                    session_start_time = detail.start_time;
                }
                if detail.end_time > session_end_time {
                    session_end_time = detail.end_time;
                }
                usage_input += detail.llm_usage_input;
                usage_output += detail.llm_usage_output;
                usage_total += detail.llm_usage_total;
                cost_total += detail.llm_cost_total;
            }
        }
        let duration = if session_end_time > session_start_time {
            session_end_time - session_start_time
        } else {
            0
        };
        sessions_data.push(SessionResponseItem {
            session_id: session_id.clone(),
            start_time: session_start_time,
            end_time: session_end_time,
            duration,
            trace_count: trace_ids.len() as u16,
            _o2_llm_usage_details_input: usage_input,
            _o2_llm_usage_details_output: usage_output,
            _o2_llm_usage_details_total: usage_total,
            _o2_llm_cost_details_total: cost_total,
        });
    }
    sessions_data.sort_by(|a, b| b.start_time.cmp(&a.start_time));

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/traces/session",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/traces/session",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .inc();

    let mut resp: HashMap<&str, json::Value> = HashMap::new();
    resp.insert("took", json::Value::from((time * 1000.0) as usize));
    resp.insert("total", json::Value::from(sessions_data.len()));
    resp.insert("from", json::Value::from(from));
    resp.insert("size", json::Value::from(size));
    resp.insert("hits", json::to_value(sessions_data).unwrap());
    resp.insert("trace_id", json::Value::from(trace_id));
    if !range_error.is_empty() {
        resp.insert("function_error", json::Value::String(range_error));
    }
    MetaHttpResponse::json(resp)
}

struct TraceDetail {
    start_time: i64,
    end_time: i64,
    llm_usage_input: i64,
    llm_usage_output: i64,
    llm_usage_total: i64,
    llm_cost_total: f64,
}

#[derive(Debug, Serialize)]
struct SessionResponseItem {
    session_id: String,
    start_time: i64,
    end_time: i64,
    duration: i64,
    trace_count: u16,
    _o2_llm_usage_details_input: i64,
    _o2_llm_usage_details_output: i64,
    _o2_llm_usage_details_total: i64,
    _o2_llm_cost_details_total: f64,
}

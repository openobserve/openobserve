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
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{search::PaginatedResponse, stream::StreamType},
    metrics,
    utils::json,
};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, traces};
use search_service as SearchService;
use serde::Serialize;
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::http::{get_or_create_trace_id, get_use_cache_from_request},
    },
    search::error_utils::map_error_to_http_response,
};

/// Session-list pagination deliberately avoids an exact count query because
/// counting every distinct session is more expensive than fetching one page.
/// `total` is therefore a lower bound while `has_more` is true, and becomes
/// exact on the final page.
#[derive(Serialize, utoipa::ToSchema)]
struct LatestSessionsResponse {
    took: usize,
    total: usize,
    from: i64,
    size: i64,
    #[schema(value_type = Vec<Object>)]
    hits: Vec<json::Value>,
    #[serde(skip_serializing_if = "String::is_empty")]
    trace_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    function_error: String,
    has_more: bool,
}

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
        ("keyword" = Option<String>, Query, description = "Case-insensitive substring match on the session's user id or conversation text (the input or output messages of any span in the session). Literal text: no wildcards or operators. Trimmed and capped at 256 characters; combined with `filter` using AND."),
        ("user_id" = Option<String>, Query, description = "Exact match on the session's user id: only sessions with a span whose user id equals this value. Trimmed and capped at 256 characters; combined with `filter` and `keyword` using AND."),
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
        ("sort_by" = Option<String>, Query, description = "Session field to sort by: end_time, user_id, trace_count, duration, gen_ai_usage_total_tokens, gen_ai_usage_cost, status (default: end_time)"),
        ("sort_order" = Option<String>, Query, description = "Sort order: asc or desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = LatestSessionsResponse, example = json!({
            "took": 155,
            "total": 11,
            "has_more": true,
            "from": 0,
            "size": 10,
            "hits": [
                {
                    "session_id": "session-abc-123",
                    "start_time": 1234567890,
                    "end_time": 1234567900,
                    "duration": 10,
                    "trace_count": 3,
                    "gen_ai_usage_input_tokens": 100,
                    "gen_ai_usage_output_tokens": 50,
                    "gen_ai_usage_total_tokens": 150,
                    "gen_ai_usage_cost": 0.005,
                    "error_count": 1
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "List recent LLM sessions from a trace stream: session_id, trace count, token usage, cost, error count. An optional keyword narrows the list by matching either the user id or conversation text; user_id keeps only one user's sessions.", "category": "traces"})),
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"}))
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
        // the request's SQL or filter may read streams other than the one it names
        if let Err(e) = search_service::check_org_search_allowed(&org_id) {
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

    if let Some(response) = super::check_stream_permissions(&org_id, &stream_name, user_id).await {
        return response;
    }

    let filter = match query.get("filter") {
        Some(v) => v.to_string(),
        None => "".to_string(),
    };
    // F2: the filter is spliced into the page query, so it has to be one boolean expression.
    if let Err(e) = config::utils::sql::validate_optional_where_fragment(&filter) {
        return MetaHttpResponse::bad_request(format!("invalid filter: {e}"));
    }
    let search = LatestSessionSearch::from_query(&query);
    let sort = match LatestSessionSort::from_query(&query) {
        Ok(sort) => sort,
        Err(message) => return MetaHttpResponse::bad_request(message),
    };

    let from = query
        .get("from")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0))
        .max(0);
    let size = query
        .get("size")
        .map_or(10, |v| v.parse::<i64>().unwrap_or(10))
        .max(1);
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

    let max_query_range = search_service::query_range::get_max_query_range(
        std::slice::from_ref(&stream_name),
        org_id.as_str(),
        user_id,
        StreamType::Traces,
    )
    .await;
    let mut range_error = String::new();
    if let Some(clamped) =
        config::utils::query_range::clamp_start_time(start_time, end_time, max_query_range)
    {
        start_time = clamped;
        range_error = format!(
            "Query duration is modified due to query range restriction of {max_query_range} hours"
        );
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // Page by session id before aggregating, so summaries run only for the page's sessions.
    let stream_type = StreamType::Traces;
    let schema = infra::schema::get_stream_schema_from_cache(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
    )
    .await;
    let validated = match schema.as_ref() {
        Some(s) => match super::schema_compat::validate_llm_schema(s, &stream_name) {
            Ok(v) => {
                // Verify a session identifier column actually exists — even if
                // all required LLM fields pass, we cannot run a session query
                // without something to group by.
                if s.field_with_name(v.columns.session_id).is_err() {
                    return MetaHttpResponse::json(LatestSessionsResponse {
                        took: 0,
                        total: 0,
                        from,
                        size,
                        hits: vec![],
                        trace_id,
                        function_error: String::new(),
                        has_more: false,
                    });
                }
                Some(v)
            }
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        },
        None => Some(super::schema_compat::ValidatedLlmSchema::fallback(false)),
    };
    let validated = match validated {
        Some(v) => v,
        None => {
            return MetaHttpResponse::json(LatestSessionsResponse {
                took: 0,
                total: 0,
                from,
                size,
                hits: vec![],
                trace_id,
                function_error: String::new(),
                has_more: false,
            });
        }
    };
    let query_sql =
        build_latest_session_page_sql(&stream_name, &filter, &search, &sort, &validated);
    if let Some(response) =
        super::check_sql_permissions(&org_id, user_id, &query_sql, &trace_id).await
    {
        return response;
    }
    let user_id_opt = Some(user_id.to_string());

    let mut req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql,
            from,
            // Fetch one extra grouped session to determine whether a next page
            // exists without running a full distinct-session count query.
            size: size.saturating_add(1),
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        timeout,
        use_cache: get_use_cache_from_request(&query),
        ..Default::default()
    };

    let resp_page = match SearchService::cache::search(
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
            log::error!("get sessions latest page error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    let mut session_ids: Vec<String> = resp_page
        .hits
        .iter()
        .filter_map(|hit| hit.get("session_id").and_then(|value| value.as_str()))
        .map(String::from)
        .collect();
    let has_more = session_ids.len() > size as usize;
    session_ids.truncate(size as usize);
    let pagination_total = from as usize + session_ids.len() + usize::from(has_more);
    if session_ids.is_empty() {
        return MetaHttpResponse::json(LatestSessionsResponse {
            took: start.elapsed().as_millis() as usize,
            total: pagination_total,
            from,
            size,
            hits: vec![],
            trace_id,
            function_error: range_error,
            has_more,
        });
    }

    req.query.sql = build_latest_sessions_sql(&stream_name, &session_ids, &validated);
    req.query.from = 0;
    req.query.size = session_ids.len() as i64;
    let resp_summary = match SearchService::cache::search(
        &trace_id,
        &org_id,
        stream_type,
        user_id_opt,
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
            log::error!("get sessions latest summary error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    let read_rules = SessionReadRules::for_org(&org_id).await;
    let sessions_data = normalize_latest_session_hits(resp_summary.hits, &session_ids, &read_rules);

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

    MetaHttpResponse::json(LatestSessionsResponse {
        took: (time * 1000.0) as usize,
        total: pagination_total,
        from,
        size,
        hits: sessions_data,
        trace_id,
        function_error: range_error,
        has_more,
    })
}

/// Same bound the time index applies to its trace lists.
const SESSION_TRACE_ID_LIMIT: i64 = 50_000;

/// GetSessionDetails
///
/// Returns per-trace turn summaries for one LLM session. Session membership is
/// selected by the session id column, then each returned trace is aggregated by
/// `trace_id` across all spans so child/tool error spans are reflected in the
/// turn status even when they do not carry the session id attribute.
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/session/details",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetSessionDetails",
    summary = "Get session turn details",
    description = "Retrieves per-turn trace summaries for a single LLM session. The response uses the same trace-summary hit shape as the trace latest endpoint, but aggregates each matched trace across all spans so turn status reflects child span errors.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("session_id" = String, Query, description = "Session/conversation id"),
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = Option<i64>, Query, description = "Caller range start in microseconds; optional, must be supplied together with end_time. The effective range is the union of this range and the indexed session range — it is never narrowed."),
        ("end_time" = Option<i64>, Query, description = "Caller range end in microseconds; optional, must be supplied together with start_time"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds for the session time index lookup"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::search::PaginatedResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "Get per-turn trace summaries for a single LLM session by session_id.", "category": "traces"})),
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"}))
    )
)]
pub async fn get_session_details(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) =
            search_service::check_search_allowed(&org_id, Some((&stream_name, StreamType::Traces)))
        {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, trace_id) = if cfg.common.should_create_span() {
        let uuid_v7_trace_id = config::ider::generate_trace_id();
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/traces/session/details",
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

    let session_id = match query.get("session_id") {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => return MetaHttpResponse::bad_request("session_id is empty"),
    };

    if let Some(response) = super::check_stream_permissions(&org_id, &stream_name, user_id).await {
        return response;
    }

    let from = query
        .get("from")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0))
        .max(0);
    let size = query
        .get("size")
        .map_or(1000, |v| v.parse::<i64>().unwrap_or(1000))
        .max(0);
    let caller_range = match super::time_index::parse_optional_time_range(&query) {
        Ok(range) => range,
        Err(response) => return response,
    };
    let hint_ts = match query.get("hint_ts") {
        Some(value) => match value.parse::<i64>() {
            Ok(0) => None,
            Ok(value) => Some(value),
            Err(_) => return MetaHttpResponse::bad_request("Invalid hint_ts parameter"),
        },
        None => caller_range.map(|range| {
            range
                .start_time
                .saturating_add(range.end_time.saturating_sub(range.start_time) / 2)
        }),
    };
    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    let stream_type = StreamType::Traces;
    let schema = infra::schema::get_stream_schema_from_cache(
        org_id.as_str(),
        stream_name.as_str(),
        stream_type,
    )
    .await;
    let (validated, session_id_columns) = match schema.as_ref() {
        Some(s) => match super::schema_compat::validate_llm_schema(s, &stream_name) {
            Ok(v) => {
                let session_id_columns = traces::session::session_id_columns(s);
                if session_id_columns.is_empty() {
                    return MetaHttpResponse::json(PaginatedResponse {
                        took: 0,
                        total: 0,
                        from,
                        size,
                        hits: vec![],
                        trace_id,
                        function_error: String::new(),
                    });
                }
                (v, session_id_columns)
            }
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        },
        None => {
            let validated = super::schema_compat::ValidatedLlmSchema::fallback(false);
            let session_id_columns = vec![validated.columns.session_id.to_string()];
            (validated, session_id_columns)
        }
    };
    let use_cache = get_use_cache_from_request(&query);
    let user_id_opt = Some(user_id.to_string());

    // Resolve the session through the time index first: it yields the
    // session's full range plus its member traces, independent of the
    // caller's window.
    let index_result = match super::time_index::query_session(
        &org_id,
        &stream_name,
        &session_id,
        hint_ts,
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            log::error!(
                "[trace_id {trace_id}] session time index query failed for {org_id}/{stream_name}: {e}"
            );
            None
        }
    };
    let effective_range = match super::time_index::union_ranges(
        caller_range,
        index_result.as_ref().map(|result| result.range),
    ) {
        Some(range) => range,
        None => {
            return MetaHttpResponse::bad_request(
                "A caller time range is required when the session time index has no result",
            );
        }
    };

    // The legacy source-stream scan covers what the index cannot: traces
    // ingested before index coverage. It is skipped only when the index
    // resolved the session and the caller range lies entirely inside
    // coverage — there the index is authoritative.
    let legacy_needed = match (caller_range, index_result.as_ref()) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(caller), Some(_)) => {
            match infra::db::trace_time_index::get_or_create_coverage_start().await {
                Ok(coverage_start) => caller.start_time < coverage_start,
                Err(_) => true,
            }
        }
    };

    let mut req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: String::new(),
            from: 0,
            size,
            start_time: effective_range.start_time,
            end_time: effective_range.end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        timeout,
        use_cache,
        ..Default::default()
    };

    // trace_id → sort timestamp, ordered like the legacy
    // "ORDER BY zo_sql_timestamp DESC, trace_id ASC". The index timestamp is
    // the trace's real start; on duplicates it wins over the window-clipped
    // legacy value because it is inserted first.
    let mut ordering: HashMap<String, i64> = HashMap::new();
    if let Some(result) = &index_result {
        for (tid, range) in &result.traces {
            ordering.insert(tid.clone(), range.start_time);
        }
    }
    if legacy_needed && let Some(caller) = caller_range {
        req.query.sql =
            traces::session::trace_ids_sql(&stream_name, &session_id_columns, &session_id, None);
        req.query.from = 0;
        // Fetch every id so `total` counts all turns after merging with index-discovered traces.
        req.query.size = SESSION_TRACE_ID_LIMIT;
        req.query.start_time = caller.start_time;
        req.query.end_time = caller.end_time;

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
                        "/api/org/traces/session/details",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/traces/session/details",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .inc();
                log::error!("get session details trace ids error: {err:?}");
                return map_error_to_http_response(&err, Some(trace_id));
            }
        };

        for hit in &resp_search.hits {
            let Some(tid) = hit.get("trace_id").and_then(json::Value::as_str) else {
                continue;
            };
            if tid.trim().is_empty() {
                continue;
            }
            let ts = json::get_int_value(hit.get("zo_sql_timestamp").unwrap_or(&json::Value::Null));
            ordering.entry(tid.to_string()).or_insert(ts);
        }
    }

    let (total, trace_ids) = session_trace_page(ordering, from, size);
    if trace_ids.is_empty() {
        return MetaHttpResponse::json(PaginatedResponse {
            took: 0,
            total,
            from,
            size,
            hits: vec![],
            trace_id,
            function_error: String::new(),
        });
    }

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

    let hits = match fetch_session_trace_hits(
        &trace_ids,
        &mut req,
        &trace_id,
        &org_id,
        stream_type,
        user_id_opt,
        &stream_name,
        &validated,
        has_ref_parent_id,
        has_infer,
        effective_range.start_time,
        // The index range is a closed interval; searches are half-open.
        effective_range.end_time.saturating_add(1),
    )
    .instrument(http_span.clone())
    .await
    {
        Ok(hits) => hits,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/session/details",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/session/details",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("get session details trace aggregates error: {err:?}");
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/traces/session/details",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/traces/session/details",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .inc();

    MetaHttpResponse::json(PaginatedResponse {
        took: (time * 1000.0) as usize,
        total,
        from,
        size,
        hits: hits
            .into_iter()
            .map(|v| json::to_value(v).unwrap())
            .collect(),
        trace_id,
        function_error: String::new(),
    })
}

fn session_trace_page(
    ordering: HashMap<String, i64>,
    from: i64,
    size: i64,
) -> (usize, Vec<String>) {
    let mut ordered: Vec<(String, i64)> = ordering.into_iter().collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let total = ordered.len();
    let page = ordered
        .into_iter()
        .skip(from as usize)
        .take(size as usize)
        .map(|(tid, _)| tid)
        .collect();
    (total, page)
}

#[allow(clippy::too_many_arguments)]
async fn fetch_session_trace_hits(
    trace_ids: &[String],
    req: &mut config::meta::search::Request,
    req_trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id_opt: Option<String>,
    stream_name: &str,
    validated: &super::schema_compat::ValidatedLlmSchema,
    has_ref_parent_id: bool,
    has_infer: bool,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<SessionTraceResponseItem>, infra::errors::Error> {
    let trace_id_predicate = traces::session::trace_id_predicate(trace_ids);
    let service_key_expr = if has_infer {
        "COALESCE(infer_service_name, service_name)"
    } else {
        "service_name"
    };
    req.query.sql = build_session_trace_details_sql(
        stream_name,
        validated,
        has_ref_parent_id,
        service_key_expr,
        &trace_id_predicate,
    );
    req.query.from = 0;
    req.query.size = trace_ids.len() as i64;
    req.query.start_time = start_time;
    req.query.end_time = end_time;

    let resp = SearchService::cache::search(
        req_trace_id,
        org_id,
        stream_type,
        user_id_opt.clone(),
        req,
        "".to_string(),
        false,
        None,
        false,
    )
    .await?;

    let mut traces_data: HashMap<String, SessionTraceResponseItem> =
        HashMap::with_capacity(resp.hits.len());
    let mut multi_service_tids: Vec<String> = Vec::new();
    let mut multi_service_total = 0;

    for item in resp.hits {
        let Some((tid, service_count, hit)) = build_session_trace_response_item(&item) else {
            continue;
        };
        if service_count > 1 {
            multi_service_tids.push(tid.clone());
            multi_service_total += service_count;
        }
        traces_data.insert(tid, hit);
    }

    if !multi_service_tids.is_empty() {
        let multi_trace_id_predicate = traces::session::trace_id_predicate(&multi_service_tids);
        let svc_type_select = if has_infer {
            ", max(infer_service_type) AS service_type"
        } else {
            ""
        };
        let svc_sql = build_session_service_breakdown_sql(
            stream_name,
            service_key_expr,
            svc_type_select,
            &multi_trace_id_predicate,
        );
        req.query.sql = svc_sql;
        req.query.from = 0;
        req.query.size = multi_service_total;
        req.query.start_time = start_time;
        req.query.end_time = end_time;

        let svc_res = SearchService::cache::search(
            req_trace_id,
            org_id,
            stream_type,
            user_id_opt,
            req,
            "".to_string(),
            false,
            None,
            false,
        )
        .await?;

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
            let svc_type = item
                .get("service_type")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);
            if let Some(trace) = traces_data.get_mut(&tid) {
                trace.service_name.push(SessionTraceServiceNameItem {
                    service_name: svc_name,
                    count: svc_count.try_into().unwrap_or_default(),
                    duration: svc_duration,
                    service_type: svc_type,
                });
            }
        }
    }

    Ok(trace_ids
        .iter()
        .filter_map(|tid| traces_data.remove(tid))
        .collect())
}

fn build_session_service_breakdown_sql(
    stream_name: &str,
    service_key_expr: &str,
    svc_type_select: &str,
    trace_id_predicate: &str,
) -> String {
    let stream_ident = traces::session::quote_identifier(stream_name);
    format!(
        "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
         count(*) AS svc_count, max(duration) AS svc_duration \
         FROM {stream_ident} WHERE {trace_id_predicate} \
         GROUP BY trace_id, {service_key_expr}"
    )
}

fn build_session_trace_details_sql(
    stream_name: &str,
    validated: &super::schema_compat::ValidatedLlmSchema,
    has_ref_parent_id: bool,
    service_key_expr: &str,
    trace_id_predicate: &str,
) -> String {
    let user_id_col = validated.columns.user_id;
    let (root_service_name_expr, root_operation_name_expr) = if has_ref_parent_id {
        (
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN service_name END)",
            "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN operation_name END)",
        )
    } else {
        ("null", "null")
    };
    let trace_selects = format!(
        "count(*) AS span_count, \
         sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count, \
         max(duration) AS max_duration, \
         count(DISTINCT {service_key_expr}) AS service_count, \
         {root_service_name_expr} AS root_service_name, \
         {root_operation_name_expr} AS root_operation_name, \
         first_value(service_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_service_name, \
         first_value(operation_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_operation_name, \
         array_agg(DISTINCT {user_id_col}) \
             FILTER (WHERE {user_id_col} IS NOT NULL AND {user_id_col} != '') AS user_ids"
    );
    let stream_ident = traces::session::quote_identifier(stream_name);

    if validated.has_gen_ai {
        let (first_msg_clause, agent_clause) = if validated.has_input_messages {
            let present = "gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != ''";
            (
                format!(
                    "FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC) FILTER (WHERE {present})"
                ),
                // The page picks the session agent's harness patterns from its turns' agents.
                format!("{} as agent_name, ", trace_agent_expr(present)),
            )
        } else {
            ("''".to_string(), String::new())
        };
        let usage = |column: &str| usage_rule(column, validated.has_operation_name);
        let optional_usage =
            |has_field: bool, column: &str| optional_usage_expr(has_field, &usage(column), column);
        let input_tokens_expr = usage("gen_ai_usage_input_tokens");
        let output_tokens_expr = usage("gen_ai_usage_output_tokens");
        let cost_expr = usage("gen_ai_usage_cost");
        let total_tokens_expr = optional_usage_expr(
            validated.has_total_tokens,
            &usage("gen_ai_usage_total_tokens"),
            "gen_ai_usage_details_total",
        );
        let cache_read_tokens_expr = optional_usage(
            validated.has_cache_read_input_tokens,
            "gen_ai_usage_cache_read_input_tokens",
        );
        let cache_creation_tokens_expr = optional_usage(
            validated.has_cache_creation_input_tokens,
            "gen_ai_usage_cache_creation_input_tokens",
        );
        let cost_cache_read_expr = optional_usage(
            validated.has_cost_cache_read_input,
            "gen_ai_usage_cost_cache_read_input",
        );
        let cost_cache_creation_expr = optional_usage(
            validated.has_cost_cache_creation_input,
            "gen_ai_usage_cost_cache_creation_input",
        );
        let cost_estimated_without_cache_expr = optional_usage(
            validated.has_cost_estimated_without_cache,
            "gen_ai_usage_cost_estimated_without_cache",
        );
        let cost_cache_read_savings_expr = optional_usage(
            validated.has_cost_cache_read_savings,
            "gen_ai_usage_cost_cache_read_savings",
        );
        let cost_net_cache_impact_expr = optional_usage(
            validated.has_cost_net_cache_impact,
            "gen_ai_usage_cost_net_cache_impact",
        );
        let unpriced_selects = validated.unpriced_selects();
        let agent_parents =
            agent_parents_join(&stream_ident, validated.layout(), Some(trace_id_predicate));
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            {input_tokens_expr} as gen_ai_usage_details_input, \
            {output_tokens_expr} as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            {cost_expr} as gen_ai_usage_cost_details, \
            {unpriced_selects}, \
            {cache_read_tokens_expr}, \
            {cache_creation_tokens_expr}, \
            {cost_cache_read_expr}, \
            {cost_cache_creation_expr}, \
            {cost_estimated_without_cache_expr}, \
            {cost_cache_read_savings_expr}, \
            {cost_net_cache_impact_expr}, \
            array_agg(DISTINCT gen_ai_response_model) FILTER (WHERE gen_ai_response_model IS NOT NULL AND gen_ai_response_model != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {agent_clause}\
            {trace_selects} \
            FROM {stream_ident}{agent_parents} \
            WHERE {trace_id_predicate} \
            GROUP BY trace_id"
        )
    } else {
        let first_msg_clause = if validated.has_input_messages {
            "FIRST_VALUE(llm_input ORDER BY start_time ASC) FILTER (WHERE llm_input IS NOT NULL AND llm_input != '')".to_string()
        } else {
            "''".to_string()
        };
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
            {trace_selects} \
            FROM {stream_ident} \
            WHERE {trace_id_predicate} \
            GROUP BY trace_id"
        )
    }
}

fn build_session_trace_response_item(
    item: &json::Value,
) -> Option<(String, i64, SessionTraceResponseItem)> {
    let tid = item.get("trace_id")?.as_str()?.to_string();
    let mut user_ids = item
        .get("user_ids")
        .and_then(json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(json::Value::as_str)
                .filter(|value| !value.is_empty())
                .map(String::from)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    user_ids.sort();
    user_ids.dedup();
    let trace_start_time = json::get_int_value(item.get("trace_start_time").unwrap_or_default());
    let trace_end_time = json::get_int_value(item.get("trace_end_time").unwrap_or_default());
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
    if service_count <= 1 && !event_service_name.is_empty() {
        svc_list.push(SessionTraceServiceNameItem {
            service_name: event_service_name.clone(),
            count: span_count.try_into().unwrap_or_default(),
            duration: max_duration,
            service_type: None,
        });
    }

    let computed_duration = if trace_end_time - trace_start_time > max_duration * 1000 {
        (trace_end_time - trace_start_time) / 1000
    } else {
        max_duration
    };
    let (gen_ai_unpriced_tokens, gen_ai_unpriced_models) =
        super::schema_compat::parse_unpriced(item);
    let hit = SessionTraceResponseItem {
        trace_id: tid.clone(),
        user_ids,
        start_time: trace_start_time,
        end_time: trace_end_time,
        duration: computed_duration,
        spans: [
            span_count.try_into().unwrap_or_default(),
            error_count.try_into().unwrap_or_default(),
        ],
        service_name: svc_list,
        first_event: json::json!({
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
        gen_ai_usage_cache_read_input_tokens: json::get_int_value(
            item.get("gen_ai_usage_cache_read_input_tokens")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cache_creation_input_tokens: json::get_int_value(
            item.get("gen_ai_usage_cache_creation_input_tokens")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cost_cache_read_input: json::get_float_value(
            item.get("gen_ai_usage_cost_cache_read_input")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cost_cache_creation_input: json::get_float_value(
            item.get("gen_ai_usage_cost_cache_creation_input")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cost_estimated_without_cache: json::get_float_value(
            item.get("gen_ai_usage_cost_estimated_without_cache")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cost_cache_read_savings: json::get_float_value(
            item.get("gen_ai_usage_cost_cache_read_savings")
                .unwrap_or_default(),
        ),
        gen_ai_usage_cost_net_cache_impact: json::get_float_value(
            item.get("gen_ai_usage_cost_net_cache_impact")
                .unwrap_or_default(),
        ),
        gen_ai_input_messages: item.get("gen_ai_input_messages").cloned(),
        agent_name: item
            .get("agent_name")
            .and_then(|v| v.as_str())
            .filter(|name| !name.is_empty())
            .map(String::from),
        models: item
            .get("gen_ai_response_models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        gen_ai_unpriced_tokens,
        gen_ai_unpriced_models,
    };

    Some((tid, service_count, hit))
}

/// A trace's agent comes from its first-message span, so a later-sorting sub-agent never wins.
fn trace_agent_expr(message_present: &str) -> String {
    format!(
        "COALESCE(\
             FIRST_VALUE(NULLIF(gen_ai_agent_name, '') ORDER BY start_time ASC) \
             FILTER (WHERE {message_present}), \
             FIRST_VALUE(gen_ai_agent_name ORDER BY start_time ASC) \
             FILTER (WHERE gen_ai_agent_name IS NOT NULL AND gen_ai_agent_name != '')\
             )"
    )
}

/// `<sum_expr> as <alias>` when the column exists, else `0 as <alias>`.
fn optional_usage_expr(has_field: bool, sum_expr: &str, alias: &str) -> String {
    if has_field {
        format!("{sum_expr} as {alias}")
    } else {
        format!("0 as {alias}")
    }
}

/// Falls back to top-level agent spans so nested agents repeating child usage count once.
pub(super) fn usage_rule(column: &str, has_operation_name: bool) -> String {
    let llm_sum = super::schema_compat::usage_sum_expr(column, has_operation_name);
    if !has_operation_name {
        return llm_sum;
    }
    format!(
        "COALESCE(NULLIF({llm_sum}, 0), sum(CASE WHEN {AGENT_SPAN} AND {AGENT_PARENT_SPAN} IS NULL \
         THEN {column} END), 0)"
    )
}

/// The spans the usage rule falls back to.
const AGENT_SPAN: &str = "gen_ai_operation_name = 'invoke_agent'";

const AGENT_PARENT_SPAN: &str = "agent_parent_span";

/// Joins each span to its agent parent; a stream without the parent column holds only roots.
pub(super) fn agent_parents_join(
    stream_ident: &str,
    layout: super::schema_compat::StreamLlmLayout,
    scope: Option<&str>,
) -> String {
    if !layout.has_operation_name {
        return String::new();
    }
    let agents = format!(
        "SELECT DISTINCT trace_id AS agent_parent_trace, span_id AS {AGENT_PARENT_SPAN} \
         FROM {stream_ident}"
    );
    if !layout.has_parent_span {
        return format!(
            " LEFT JOIN ({agents} WHERE false) AS agent_parents ON trace_id = agent_parent_trace"
        );
    }
    let scope = scope.map(|p| format!(" AND ({p})")).unwrap_or_default();
    format!(
        " LEFT JOIN ({agents} WHERE {AGENT_SPAN}{scope}) AS agent_parents \
         ON trace_id = agent_parent_trace AND {} = {AGENT_PARENT_SPAN}",
        super::schema_compat::PARENT_SPAN_ID_COLUMN
    )
}

/// Older clients wrapped the agent predicate in a same-stream session
/// membership subquery. Inside the grouped page query that becomes an
/// unsupported `InSubquery` expression, while its inner WHERE clause has the
/// exact membership semantics we need. Only unwrap the narrow legacy shape;
/// leave every other filter untouched.
fn normalize_latest_session_filter(
    filter: &str,
    stream_name: &str,
    session_id_col: &str,
) -> String {
    let trimmed = filter.trim();
    let normalized_outer = trimmed.to_ascii_lowercase();
    let outer_prefix = format!("{} in (", session_id_col.to_ascii_lowercase());
    if !normalized_outer.starts_with(&outer_prefix) || !trimmed.ends_with(')') {
        return trimmed.to_string();
    }

    let inner = &trimmed[outer_prefix.len()..trimmed.len() - 1];
    let normalized_inner = inner
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let session_id_col = session_id_col.to_ascii_lowercase();
    let stream_name = stream_name.to_ascii_lowercase();
    let quoted_prefix = format!("select {session_id_col} from \"{stream_name}\" where ");
    let bare_prefix = format!("select {session_id_col} from {stream_name} where ");
    let group_suffix = format!(" group by {session_id_col}");
    if !(normalized_inner.starts_with(&quoted_prefix) || normalized_inner.starts_with(&bare_prefix))
        || !normalized_inner.ends_with(&group_suffix)
    {
        return trimmed.to_string();
    }

    search::sql::visitor::pickup_where::pickup_where(inner)
        .ok()
        .flatten()
        .unwrap_or_else(|| trimmed.to_string())
}

/// Hard cap on the list search `keyword`, in characters. Longer input is
/// truncated, never rejected; the UI applies the same cap before sending.
const SESSION_SEARCH_MAX_LEN: usize = 256;

/// Trims a raw search term and caps it at [`SESSION_SEARCH_MAX_LEN`]
/// characters. An empty result means "no search" and yields `None`.
fn normalize_session_search_term(raw: Option<&String>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(SESSION_SEARCH_MAX_LEN).collect())
}

/// Case-insensitive literal substring match; `str_match_ignore_case` needs no wildcard escaping.
fn session_search_predicate(column: &str, term: &str) -> String {
    format!(
        "str_match_ignore_case({column}, {})",
        config::utils::sql::quote_sql_string(term)
    )
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct LatestSessionSearch {
    pub(super) keyword: Option<String>,
    pub(super) user_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LatestSessionSortField {
    EndTime,
    UserId,
    TraceCount,
    Duration,
    TotalTokens,
    Cost,
    Status,
}

impl LatestSessionSortField {
    fn parse(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "end_time" => Ok(Self::EndTime),
            "user_id" => Ok(Self::UserId),
            "trace_count" => Ok(Self::TraceCount),
            "duration" => Ok(Self::Duration),
            "gen_ai_usage_total_tokens" => Ok(Self::TotalTokens),
            "gen_ai_usage_cost" => Ok(Self::Cost),
            "status" => Ok(Self::Status),
            _ => Err(format!(
                "Invalid sort_by field: '{value}'. Valid fields are: end_time, user_id, \
                 trace_count, duration, gen_ai_usage_total_tokens, gen_ai_usage_cost, status"
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LatestSessionSortOrder {
    Asc,
    Desc,
}

impl LatestSessionSortOrder {
    fn parse(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "asc" => Ok(Self::Asc),
            "desc" => Ok(Self::Desc),
            _ => Err(format!(
                "Invalid sort_order: '{value}'. Valid values are: asc, desc"
            )),
        }
    }

    const fn sql(self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LatestSessionSort {
    field: LatestSessionSortField,
    order: LatestSessionSortOrder,
}

impl Default for LatestSessionSort {
    fn default() -> Self {
        Self {
            field: LatestSessionSortField::EndTime,
            order: LatestSessionSortOrder::Desc,
        }
    }
}

impl LatestSessionSort {
    fn from_query(query: &HashMap<String, String>) -> Result<Self, String> {
        let field = query
            .get("sort_by")
            .map(|value| LatestSessionSortField::parse(value))
            .transpose()?
            .unwrap_or(LatestSessionSortField::EndTime);
        let order = query
            .get("sort_order")
            .map(|value| LatestSessionSortOrder::parse(value))
            .transpose()?
            .unwrap_or(LatestSessionSortOrder::Desc);
        Ok(Self { field, order })
    }
}

impl LatestSessionSearch {
    fn from_query(query: &HashMap<String, String>) -> Self {
        Self {
            keyword: normalize_session_search_term(query.get("keyword")),
            user_id: normalize_session_search_term(query.get("user_id")),
        }
    }

    /// Each holds on some span of the session, not necessarily the same one.
    fn predicates(&self, validated: &super::schema_compat::ValidatedLlmSchema) -> Vec<String> {
        let user_col = validated.columns.user_id;
        let keyword = self.keyword.as_deref().map(|keyword| {
            let user = session_search_predicate(user_col, keyword);
            match message_search_predicate(validated, keyword) {
                Some(messages) => format!("({user} OR {messages})"),
                None => format!("({user})"),
            }
        });
        let user = self.user_id.as_deref().map(|user| {
            format!(
                "{user_col} = {}",
                config::utils::sql::quote_sql_string(user)
            )
        });
        keyword.into_iter().chain(user).collect()
    }
}

fn message_search_predicate(
    validated: &super::schema_compat::ValidatedLlmSchema,
    term: &str,
) -> Option<String> {
    match (validated.has_input_messages, validated.has_output_messages) {
        (true, true) => Some(format!(
            "({} OR {})",
            session_search_predicate(input_messages_column(validated), term),
            session_search_predicate(output_messages_column(validated), term)
        )),
        (false, true) => Some(session_search_predicate(
            output_messages_column(validated),
            term,
        )),
        (true, false) => Some(session_search_predicate(
            input_messages_column(validated),
            term,
        )),
        (false, false) => None,
    }
}

/// Stored column holding the prompt text for the stream's schema generation.
fn input_messages_column(validated: &super::schema_compat::ValidatedLlmSchema) -> &'static str {
    if validated.has_gen_ai {
        "gen_ai_input_messages"
    } else {
        "llm_input"
    }
}

/// Stored column holding the response text for the stream's schema generation.
fn output_messages_column(validated: &super::schema_compat::ValidatedLlmSchema) -> &'static str {
    if validated.has_gen_ai {
        "gen_ai_output_messages"
    } else {
        "llm_output"
    }
}

fn build_latest_session_page_sql(
    stream_name: &str,
    filter: &str,
    search: &LatestSessionSearch,
    sort: &LatestSessionSort,
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> String {
    let session_id_col = validated.columns.session_id;
    let filter = normalize_latest_session_filter(filter, stream_name, session_id_col);
    // Separate per-trace flags: SDKs put `user.id` on the agent span, messages on its chat child.
    let conditions: Vec<String> = std::iter::once(filter)
        .filter(|filter| !filter.is_empty())
        .chain(search.predicates(validated))
        .collect();
    let match_columns: String = conditions
        .iter()
        .enumerate()
        .map(|(index, predicate)| {
            format!(", max(CASE WHEN {predicate} THEN 1 ELSE 0 END) as session_match_{index}")
        })
        .collect();
    let membership_filter = if conditions.is_empty() {
        String::new()
    } else {
        let checks: Vec<String> = (0..conditions.len())
            .map(|index| format!("max(session_match_{index}) = 1"))
            .collect();
        format!(" HAVING {}", checks.join(" AND "))
    };
    let direction = sort.order.sql();
    let (trace_sort, session_sort) = latest_session_sort_expressions(sort.field, validated);
    let trace_sort_projection = trace_sort
        .map(|expression| format!(", {expression} as trace_sort_value"))
        .unwrap_or_default();
    let (sort_projection, order_by) = match session_sort {
        None => (
            String::new(),
            format!("session_last_activity {direction}, session_id {direction}"),
        ),
        Some(expression) => (
            format!(", {expression} as session_sort_value"),
            format!(
                "session_sort_value {direction} NULLS LAST, \
                 session_last_activity DESC, session_id DESC"
            ),
        ),
    };
    let stream_ident = traces::session::quote_identifier(stream_name);
    // Only a Tokens/Cost sort applies the usage rule here.
    let agent_parents = if latest_session_usage_sort_column(sort.field, validated).is_some() {
        agent_parents_join(&stream_ident, validated.layout(), None)
    } else {
        String::new()
    };

    // Grouping all traces then dropping sessionless ones beats a `trace_id IN (SELECT ...)`.
    format!(
        "SELECT session_id, max(trace_last_activity) as session_last_activity{sort_projection} \
         FROM (SELECT max({session_id_col}) as session_id, trace_id, \
         max(end_time) as trace_last_activity{trace_sort_projection}{match_columns} \
         FROM {stream_ident}{agent_parents} \
         GROUP BY trace_id) \
         WHERE session_id IS NOT NULL AND session_id != '' \
         GROUP BY session_id{membership_filter} \
         ORDER BY {order_by}"
    )
}

/// The usage column a Tokens/Cost sort ranks by, when the stream stores it.
fn latest_session_usage_sort_column(
    field: LatestSessionSortField,
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> Option<&'static str> {
    match (field, validated.has_gen_ai) {
        (LatestSessionSortField::TotalTokens, true) if validated.has_total_tokens => {
            Some("gen_ai_usage_total_tokens")
        }
        (LatestSessionSortField::TotalTokens, false) if validated.has_total_tokens => {
            Some("llm_usage_tokens_total")
        }
        (LatestSessionSortField::Cost, true) => Some("gen_ai_usage_cost"),
        (LatestSessionSortField::Cost, false) => Some("llm_usage_cost_total"),
        _ => None,
    }
}

fn latest_session_sort_expressions(
    field: LatestSessionSortField,
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> (Option<String>, Option<String>) {
    if let Some(column) = latest_session_usage_sort_column(field, validated) {
        // Usage rule holds per trace; a session's usage is the sum of its traces.
        let usage = usage_rule(column, validated.has_operation_name);
        return (
            Some(format!("COALESCE({usage}, 0)")),
            Some("sum(trace_sort_value)".to_string()),
        );
    }
    match field {
        LatestSessionSortField::EndTime => (None, None),
        LatestSessionSortField::UserId => (
            Some(format!("min(NULLIF({}, ''))", validated.columns.user_id)),
            Some("min(trace_sort_value)".to_string()),
        ),
        LatestSessionSortField::TraceCount => (None, Some("count(trace_id)".to_string())),
        LatestSessionSortField::Duration => (
            Some("min(start_time)".to_string()),
            Some(
                "CASE WHEN max(trace_last_activity) > min(trace_sort_value) \
                 THEN max(trace_last_activity) - min(trace_sort_value) ELSE 0 END"
                    .to_string(),
            ),
        ),
        // Only a stream without a total-tokens column lands here.
        LatestSessionSortField::TotalTokens | LatestSessionSortField::Cost => {
            (None, Some("0".to_string()))
        }
        LatestSessionSortField::Status => (
            Some("max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)".to_string()),
            Some("max(trace_sort_value)".to_string()),
        ),
    }
}

fn build_latest_sessions_sql(
    stream_name: &str,
    session_ids: &[String],
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> String {
    let session_id_col = validated.columns.session_id;
    let user_id_col = validated.columns.user_id;
    let session_ids_sql = session_ids
        .iter()
        .map(|session_id| config::utils::sql::quote_sql_string(session_id))
        .collect::<Vec<_>>()
        .join(",");

    let input_messages_col = input_messages_column(validated);
    let (input_tokens_col, output_tokens_col, total_tokens_col, cost_col) = if validated.has_gen_ai
    {
        (
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_total_tokens",
            "gen_ai_usage_cost",
        )
    } else {
        (
            "llm_usage_tokens_input",
            "llm_usage_tokens_output",
            "llm_usage_tokens_total",
            "llm_usage_cost_total",
        )
    };

    let usage = |column: &str| usage_rule(column, validated.has_operation_name);
    let optional_usage =
        |has_field: bool, column: &str| optional_usage_expr(has_field, &usage(column), column);
    let input_tokens_expr = usage(input_tokens_col);
    let output_tokens_expr = usage(output_tokens_col);
    let cost_expr = usage(cost_col);
    let total_tokens_expr = optional_usage_expr(
        validated.has_total_tokens,
        &usage(total_tokens_col),
        "gen_ai_usage_total_tokens",
    );
    let (first_message_expr, session_first_message_expr) = if validated.has_input_messages {
        let present = format!("{input_messages_col} IS NOT NULL AND {input_messages_col} != ''");
        (
            format!(
                "FIRST_VALUE({input_messages_col} ORDER BY start_time ASC) \
                 FILTER (WHERE {present}) as gen_ai_input_messages, \
                 min(start_time) FILTER (WHERE {present}) as first_message_time"
            ),
            "FIRST_VALUE(gen_ai_input_messages ORDER BY first_message_time ASC) \
             FILTER (WHERE gen_ai_input_messages IS NOT NULL) as gen_ai_input_messages"
                .to_string(),
        )
    } else {
        (
            "'' as gen_ai_input_messages".to_string(),
            "'' as gen_ai_input_messages".to_string(),
        )
    };

    let cache_read_tokens_expr = optional_usage(
        validated.has_cache_read_input_tokens,
        "gen_ai_usage_cache_read_input_tokens",
    );
    let cache_creation_tokens_expr = optional_usage(
        validated.has_cache_creation_input_tokens,
        "gen_ai_usage_cache_creation_input_tokens",
    );
    let cost_cache_read_expr = optional_usage(
        validated.has_cost_cache_read_input,
        "gen_ai_usage_cost_cache_read_input",
    );
    let cost_cache_creation_expr = optional_usage(
        validated.has_cost_cache_creation_input,
        "gen_ai_usage_cost_cache_creation_input",
    );
    let cost_estimated_without_cache_expr = optional_usage(
        validated.has_cost_estimated_without_cache,
        "gen_ai_usage_cost_estimated_without_cache",
    );
    let cost_cache_read_savings_expr = optional_usage(
        validated.has_cost_cache_read_savings,
        "gen_ai_usage_cost_cache_read_savings",
    );
    let cost_net_cache_impact_expr = optional_usage(
        validated.has_cost_net_cache_impact,
        "gen_ai_usage_cost_net_cache_impact",
    );
    let unpriced_selects = validated.unpriced_selects();
    let session_unpriced_models = if validated.has_gen_ai && validated.has_cost_status {
        "array_distinct(flatten(array_agg(gen_ai_unpriced_models))) as gen_ai_unpriced_models, "
    } else {
        ""
    };
    let session_usage: String = [
        "gen_ai_usage_input_tokens",
        "gen_ai_usage_output_tokens",
        "gen_ai_usage_total_tokens",
        "gen_ai_usage_cost",
        "gen_ai_unpriced_tokens",
        "gen_ai_usage_cache_read_input_tokens",
        "gen_ai_usage_cache_creation_input_tokens",
        "gen_ai_usage_cost_cache_read_input",
        "gen_ai_usage_cost_cache_creation_input",
        "gen_ai_usage_cost_estimated_without_cache",
        "gen_ai_usage_cost_cache_read_savings",
        "gen_ai_usage_cost_net_cache_impact",
    ]
    .iter()
    .map(|alias| format!("sum({alias}) as {alias}, "))
    .collect();
    let stream_ident = traces::session::quote_identifier(stream_name);
    let agent_parents = agent_parents_join(&stream_ident, validated.layout(), None);
    // Picks the agent's harness patterns when the session is read.
    let (agent_name_expr, session_agent_name_expr) = if validated.has_gen_ai
        && validated.has_input_messages
    {
        let present = format!("{input_messages_col} IS NOT NULL AND {input_messages_col} != ''");
        (
            format!("{} as agent_name, ", trace_agent_expr(&present)),
            "FIRST_VALUE(agent_name ORDER BY first_message_time ASC) \
                 FILTER (WHERE gen_ai_input_messages IS NOT NULL) as agent_name, "
                .to_string(),
        )
    } else {
        // No first message, so no harness text to hide.
        (String::new(), String::new())
    };

    // Grouping every trace beats a membership semi-join, as in the page query.
    format!(
        "SELECT session_id, {session_agent_name_expr}\
         min(start_time) as start_time, \
         max(end_time) as end_time, \
         CASE WHEN max(end_time) > min(start_time) \
              THEN max(end_time) - min(start_time) ELSE 0 END as duration, \
         count(DISTINCT trace_id) as trace_count, \
         {session_usage}\
         {session_unpriced_models}\
         sum(error_count) as error_count, \
         array_distinct(flatten(array_agg(user_ids))) as user_ids, \
         {session_first_message_expr} \
         FROM (SELECT max({session_id_col}) as session_id, trace_id, {agent_name_expr}\
         min(start_time) as start_time, \
         max(end_time) as end_time, \
         {input_tokens_expr} as gen_ai_usage_input_tokens, \
         {output_tokens_expr} as gen_ai_usage_output_tokens, \
         {total_tokens_expr}, \
         {cost_expr} as gen_ai_usage_cost, \
         {unpriced_selects}, \
         {cache_read_tokens_expr}, \
         {cache_creation_tokens_expr}, \
         {cost_cache_read_expr}, \
         {cost_cache_creation_expr}, \
         {cost_estimated_without_cache_expr}, \
         {cost_cache_read_savings_expr}, \
         {cost_net_cache_impact_expr}, \
         sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as error_count, \
         array_agg(DISTINCT {user_id_col}) \
             FILTER (WHERE {user_id_col} IS NOT NULL AND {user_id_col} != '') as user_ids, \
         {first_message_expr} \
         FROM {stream_ident}{agent_parents} \
         GROUP BY trace_id) \
         WHERE session_id IN ({session_ids_sql}) \
         GROUP BY session_id"
    )
}

#[derive(Default)]
struct SessionReadRules {
    harness: HashMap<String, Vec<config::meta::gen_ai::CompiledHarnessPattern>>,
    title: config::meta::gen_ai::SessionTitleMode,
}

impl SessionReadRules {
    async fn for_org(org_id: &str) -> Self {
        let config = db::system_settings::get_saved_gen_ai_agent_mapping_config(org_id).await;
        Self {
            harness: harness_by_agent(&config.harness_patterns),
            title: config.session_title,
        }
    }
}

/// Save refuses duplicate agents; for older stored duplicates the first rule wins.
fn harness_by_agent(
    rules: &[config::meta::gen_ai::HarnessPatternRule],
) -> HashMap<String, Vec<config::meta::gen_ai::CompiledHarnessPattern>> {
    let mut harness = HashMap::with_capacity(rules.len());
    for r in rules {
        harness
            .entry(r.agent.clone())
            .or_insert_with(|| config::meta::gen_ai::compile_harness_patterns(&r.patterns));
    }
    harness
}

const FIRST_MESSAGE_LEN: usize = 400;
const SESSION_TITLE_LEN: usize = 60;

fn normalize_latest_session_hits(
    mut hits: Vec<json::Value>,
    session_ids: &[String],
    rules: &SessionReadRules,
) -> Vec<json::Value> {
    for hit in &mut hits {
        let patterns = hit
            .get("agent_name")
            .and_then(|value| value.as_str())
            .and_then(|agent| rules.harness.get(agent));
        // Hide harness text before the cut, or a long wrapper pushes the request past it.
        let full = hit.get("gen_ai_input_messages").and_then(|value| {
            extract_first_user_message(
                value,
                if patterns.is_some() {
                    usize::MAX
                } else {
                    FIRST_MESSAGE_LEN
                },
            )
        });
        let (first_user_message, hidden, only) = match (full, patterns) {
            (Some(text), Some(patterns)) => {
                let stripped = config::meta::gen_ai::strip_harness(&text, patterns);
                (
                    truncate_message(stripped.text, FIRST_MESSAGE_LEN),
                    stripped.hidden,
                    stripped.only,
                )
            }
            (full, _) => (full, 0, None),
        };
        let title = match rules.title {
            config::meta::gen_ai::SessionTitleMode::FirstRequest => {
                first_user_message.as_deref().map(session_title)
            }
            config::meta::gen_ai::SessionTitleMode::Off => None,
        };
        let Some(hit) = hit.as_object_mut() else {
            continue;
        };

        hit.remove("zo_sql_timestamp");
        hit.remove("gen_ai_input_messages");
        hit.insert(
            "first_user_message".to_string(),
            first_user_message.map_or(json::Value::Null, json::Value::String),
        );
        if hidden > 0 {
            hit.insert("harness_hidden".to_string(), json::json!(hidden));
        }
        if let Some(only) = only {
            hit.insert("harness_only".to_string(), json::Value::String(only));
        }
        if let Some(title) = title {
            hit.insert("session_title".to_string(), json::Value::String(title));
        }

        if let Some(json::Value::Array(user_ids)) = hit.get_mut("user_ids") {
            user_ids.retain(|value| value.as_str().is_some_and(|value| !value.is_empty()));
            user_ids.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
            user_ids.dedup();
        }
    }
    let page_order: HashMap<&str, usize> = session_ids
        .iter()
        .enumerate()
        .map(|(index, session_id)| (session_id.as_str(), index))
        .collect();
    // Phase 1 owns pagination and ordering. Distributed phase-2 aggregation
    // does not preserve its input order, so restore the exact selected-ID
    // sequence for every sort field.
    hits.sort_by_key(|hit| {
        hit.get("session_id")
            .and_then(|value| value.as_str())
            .and_then(|session_id| page_order.get(session_id))
            .copied()
            .unwrap_or(usize::MAX)
    });
    hits
}

#[derive(Debug, Serialize)]
struct SessionTraceResponseItem {
    trace_id: String,
    user_ids: Vec<String>,
    start_time: i64,
    end_time: i64,
    duration: i64,
    spans: [u16; 2],
    service_name: Vec<SessionTraceServiceNameItem>,
    first_event: json::Value,
    gen_ai_usage_input_tokens: i64,
    gen_ai_usage_output_tokens: i64,
    gen_ai_usage_total_tokens: i64,
    gen_ai_usage_cost: f64,
    gen_ai_usage_cache_read_input_tokens: i64,
    gen_ai_usage_cache_creation_input_tokens: i64,
    gen_ai_usage_cost_cache_read_input: f64,
    gen_ai_usage_cost_cache_creation_input: f64,
    gen_ai_usage_cost_estimated_without_cache: f64,
    gen_ai_usage_cost_cache_read_savings: f64,
    gen_ai_usage_cost_net_cache_impact: f64,
    gen_ai_input_messages: Option<json::Value>,
    /// The trace's agent, on streams with message fields; the page picks harness patterns by it.
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_name: Option<String>,
    models: Vec<String>,
    /// Tokens of this trace's spans that no price matched; their cost is missing.
    gen_ai_unpriced_tokens: i64,
    gen_ai_unpriced_models: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
struct SessionTraceServiceNameItem {
    service_name: String,
    count: u16,
    duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_type: Option<String>,
}

/// The request's first line, cut at a word near `SESSION_TITLE_LEN` characters.
fn session_title(request: &str) -> String {
    let line = request
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    if line.chars().count() <= SESSION_TITLE_LEN {
        return line.to_string();
    }
    let cut: String = line.chars().take(SESSION_TITLE_LEN).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
    format!("{}…", cut.trim_end())
}

fn truncate_message(value: String, max_len: usize) -> Option<String> {
    if value.trim().is_empty() {
        return None;
    }
    Some(value.chars().take(max_len).collect())
}

fn content_value_to_text(value: &json::Value) -> Option<String> {
    match value {
        json::Value::Null => None,
        json::Value::Bool(value) => Some(value.to_string()),
        json::Value::Number(value) => Some(value.to_string()),
        json::Value::String(value) => (!value.trim().is_empty()).then(|| value.to_string()),
        json::Value::Array(values) => {
            let parts: Vec<String> = values.iter().filter_map(content_value_to_text).collect();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        json::Value::Object(value) => {
            if let Some(part_type) = value.get("type").and_then(|value| value.as_str()) {
                if part_type == "text" {
                    return value
                        .get("content")
                        .or_else(|| value.get("text"))
                        .and_then(content_value_to_text);
                }
                return None;
            }

            value
                .get("text")
                .or_else(|| value.get("content"))
                .or_else(|| value.get("parts"))
                .and_then(content_value_to_text)
        }
    }
}

fn any_value_to_text(value: &json::Value) -> Option<String> {
    content_value_to_text(value).or_else(|| match value {
        json::Value::Null => None,
        json::Value::Array(value) if value.is_empty() => None,
        json::Value::Object(value) if value.is_empty() => None,
        _ => json::to_string(value).ok(),
    })
}

/// Extract the first user message from an OTEL `gen_ai_input_messages` AnyValue.
fn extract_first_user_message(value: &json::Value, max_len: usize) -> Option<String> {
    match value {
        json::Value::Null => None,
        json::Value::String(value) => match json::from_str::<json::Value>(value) {
            Ok(json::Value::String(parsed)) => truncate_message(parsed, max_len),
            Ok(parsed) => extract_first_user_message(&parsed, max_len),
            Err(_) => truncate_message(value.to_string(), max_len),
        },
        json::Value::Array(values) => {
            let contains_messages = values.iter().any(|value| {
                value
                    .as_object()
                    .is_some_and(|value| value.contains_key("role"))
            });

            if contains_messages {
                for message in values {
                    let Some(message) = message.as_object() else {
                        continue;
                    };
                    let role = message
                        .get("role")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if !role.eq_ignore_ascii_case("user") && !role.eq_ignore_ascii_case("human") {
                        continue;
                    }

                    if let Some(content) = message
                        .get("content")
                        .or_else(|| message.get("text"))
                        .or_else(|| message.get("parts"))
                        .and_then(content_value_to_text)
                        .and_then(|value| truncate_message(value, max_len))
                    {
                        return Some(content);
                    }
                }
                return None;
            }

            any_value_to_text(value).and_then(|value| truncate_message(value, max_len))
        }
        json::Value::Object(value) => {
            if let Some(messages) = value.get("messages").or_else(|| value.get("contents")) {
                return extract_first_user_message(messages, max_len);
            }

            if let Some(role) = value.get("role").and_then(|value| value.as_str())
                && !role.eq_ignore_ascii_case("user")
                && !role.eq_ignore_ascii_case("human")
            {
                return None;
            }

            any_value_to_text(&json::Value::Object(value.clone()))
                .and_then(|value| truncate_message(value, max_len))
        }
        json::Value::Bool(_) | json::Value::Number(_) => {
            any_value_to_text(value).and_then(|value| truncate_message(value, max_len))
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    // The agent's harness text is hidden before the 400-character cut.
    #[test]
    fn session_hits_hide_the_agents_harness_text_and_take_a_title() {
        let wrapper = format!("<system-reminder>{}</system-reminder>", "x".repeat(600));
        let messages = json!([{"role": "user", "content": format!("{wrapper}\nFix the Thread durations in the trace view please")}]);
        let hits = vec![
            json!({"session_id": "a", "agent_name": "omp", "gen_ai_input_messages": messages.clone()}),
            json!({"session_id": "b", "agent_name": "support-bot", "gen_ai_input_messages": messages}),
            json!({"session_id": "c", "agent_name": "omp", "gen_ai_input_messages": [{"role": "user", "content": "<job>nightly</job>"}]}),
        ];
        let mut rules = SessionReadRules {
            title: config::meta::gen_ai::SessionTitleMode::FirstRequest,
            ..Default::default()
        };
        rules.harness.insert(
            "omp".to_string(),
            config::meta::gen_ai::compile_harness_patterns(&[
                "tag system-reminder".to_string(),
                "tag job".to_string(),
            ]),
        );
        let ids = ["a".to_string(), "b".to_string(), "c".to_string()];
        let out = normalize_latest_session_hits(hits, &ids, &rules);
        assert_eq!(
            out[0]["first_user_message"],
            "Fix the Thread durations in the trace view please"
        );
        assert_eq!(out[0]["harness_hidden"], 1);
        assert_eq!(
            out[0]["session_title"],
            "Fix the Thread durations in the trace view please"
        );
        // Another agent's sessions are untouched.
        assert!(out[1].get("harness_hidden").is_none());
        assert!(
            out[1]["first_user_message"]
                .as_str()
                .unwrap()
                .starts_with("<system-reminder>")
        );
        assert_eq!(out[2]["harness_only"], "job");
        assert!(out[2]["first_user_message"].is_null());
    }

    #[test]
    fn session_title_cuts_at_a_word() {
        assert_eq!(session_title("short ask"), "short ask");
        let long = "Rebase the AI observability branch onto origin main and fix every conflict";
        let title = session_title(long);
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= SESSION_TITLE_LEN + 1);
    }

    #[test]
    fn session_trace_details_sql_aggregates_by_trace_id() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let sql = build_session_trace_details_sql(
            "default",
            &validated,
            true,
            "service_name",
            "\"trace_id\" IN ('trace-1', 'trace-2')",
        );

        assert!(sql.contains("WHERE \"trace_id\" IN ('trace-1', 'trace-2')"));
        assert!(
            sql.contains("sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count")
        );
        assert!(sql.contains("array_agg(DISTINCT user_id)"));
        assert!(!sql.contains("gen_ai_conversation_id"));
    }

    #[test]
    fn session_trace_response_item_maps_full_trace_errors() {
        let item = json!({
            "trace_id": "37a3437cc8127a738e2424193619be49",
            "trace_start_time": 1_000_000_000i64,
            "trace_end_time": 2_000_000_000i64,
            "span_count": 3,
            "error_count": 1,
            "max_duration": 900_000,
            "service_count": 1,
            "root_service_name": "o2-ai",
            "root_operation_name": "gen_ai.chat.completions",
            "first_service_name": "o2-ai",
            "first_operation_name": "fallback-op",
            "user_ids": ["user-b", "user-a", "user-b", ""],
            "gen_ai_usage_details_input": 10,
            "gen_ai_usage_details_output": 20,
            "gen_ai_usage_details_total": 30,
            "gen_ai_usage_cost_details": 0.001,
            "gen_ai_response_models": ["claude-sonnet-4-6"],
            "gen_ai_input_messages": "[]"
        });

        let (_, service_count, hit) = build_session_trace_response_item(&item).unwrap();

        assert_eq!(service_count, 1);
        assert_eq!(hit.spans, [3, 1]);
        assert_eq!(
            hit.user_ids,
            vec!["user-a".to_string(), "user-b".to_string()]
        );
        assert_eq!(hit.service_name[0].service_name, "o2-ai");
        assert_eq!(hit.models, vec!["claude-sonnet-4-6".to_string()]);
    }

    #[test]
    fn session_trace_details_carry_the_first_message_spans_agent() {
        let details = |gen_ai: bool, messages: bool| {
            let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(gen_ai);
            validated.has_input_messages = messages;
            build_session_trace_details_sql(
                "default",
                &validated,
                false,
                "service_name",
                "\"trace_id\" IN ('trace-1')",
            )
        };
        let sql = details(true, true);
        assert!(
            sql.contains(
                "COALESCE(FIRST_VALUE(NULLIF(gen_ai_agent_name, '') ORDER BY start_time ASC) \
                 FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != ''), \
                 FIRST_VALUE(gen_ai_agent_name ORDER BY start_time ASC) \
                 FILTER (WHERE gen_ai_agent_name IS NOT NULL AND gen_ai_agent_name != '')) \
                 as agent_name"
            ),
            "{sql}"
        );
        // Without messages there is no harness text to hide, so no agent is read.
        assert!(!details(true, false).contains("gen_ai_agent_name"));
        assert!(!details(false, true).contains("gen_ai_agent_name"));

        let item = |agent: &str| json!({"trace_id": "t", "trace_start_time": 1, "trace_end_time": 2, "agent_name": agent});
        let (_, _, hit) = build_session_trace_response_item(&item("omp")).unwrap();
        assert_eq!(hit.agent_name.as_deref(), Some("omp"));
        let (_, _, hit) = build_session_trace_response_item(&item("")).unwrap();
        assert_eq!(hit.agent_name, None);
    }

    #[test]
    fn gen_ai_session_sql_uses_flattened_user_id_column() {
        // Ingestion flattens the Gen-AI `user.id` attribute to a `user_id`
        // column, so the SQL must never emit the dotted attribute name —
        // DataFusion would read `user.id` as `<table>.<column>`.
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let details_sql = build_session_trace_details_sql(
            "default",
            &validated,
            false,
            "service_name",
            "\"trace_id\" IN ('trace-1')",
        );
        let sessions_sql =
            build_latest_sessions_sql("default", &["session-1".to_string()], &validated);

        for sql in [&details_sql, &sessions_sql] {
            assert!(sql.contains("array_agg(DISTINCT user_id)"));
            assert!(sql.contains("user_id IS NOT NULL AND user_id != ''"));
            assert!(!sql.contains("user.id"));
        }
    }

    #[test]
    fn legacy_session_trace_details_sql_uses_legacy_user_id_column() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(false);
        let sql = build_session_trace_details_sql(
            "default",
            &validated,
            false,
            "service_name",
            "\"trace_id\" IN ('trace-1')",
        );

        assert!(sql.contains("array_agg(DISTINCT llm_user_id)"));
        assert!(!sql.contains("array_agg(DISTINCT user_id)"));
    }

    #[test]
    fn shared_trace_ids_from_hits_preserves_exact_ids_and_deduplicates() {
        let hits = vec![
            json!({"trace_id": "abc-123"}),
            json!({"trace_id": "abc-123"}),
            json!({"trace_id": "bad';drop"}),
        ];

        assert_eq!(
            traces::session::trace_ids_from_hits(&hits),
            vec!["abc-123", "bad';drop"]
        );
    }

    #[test]
    fn latest_sessions_sql_pages_then_aggregates_by_session_id() {
        let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        validated.has_input_messages = true;
        validated.has_total_tokens = true;
        validated.has_cache_read_input_tokens = true;
        let filter = "gen_ai_conversation_id IN (SELECT gen_ai_conversation_id FROM \"bench_traces\" WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != '' AND gen_ai_agent_id = 'agent-123' GROUP BY gen_ai_conversation_id)";
        assert!(config::utils::sql::validate_optional_where_fragment(filter).is_ok());
        let page_sql = build_latest_session_page_sql(
            "bench_traces",
            filter,
            &LatestSessionSearch::default(),
            &LatestSessionSort::default(),
            &validated,
        );
        let sql = build_latest_sessions_sql(
            "bench_traces",
            &["session-1".to_string(), "session'2".to_string()],
            &validated,
        );

        // The legacy membership subquery filter is unwrapped to its predicate.
        assert!(!page_sql.contains("IN (SELECT gen_ai_conversation_id"));
        assert!(page_sql.contains("max(trace_last_activity) as session_last_activity"));
        assert!(page_sql.contains("gen_ai_agent_id = 'agent-123'"));
        assert!(page_sql.contains("HAVING max(session_match_0) = 1"));
        assert!(page_sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
        assert!(!page_sql.contains("min(start_time) as session_start_time"));
        assert!(sql.contains("count(DISTINCT trace_id) as trace_count"));
        assert!(sql.contains("GROUP BY session_id"));
        assert!(sql.contains("WHERE session_id IN ('session-1','session''2') GROUP BY session_id"));
        assert!(sql.contains("sum(gen_ai_usage_input_tokens) as gen_ai_usage_input_tokens"));
        assert!(sql.contains("sum(gen_ai_usage_total_tokens) as gen_ai_usage_total_tokens"));
        assert!(sql.contains("array_agg(DISTINCT user_id)"));
        assert!(sql.contains("FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC)"));
        assert!(!sql.contains("array_agg(DISTINCT trace_id)"));
        // Trace ids are never materialized into the query text.
        assert!(!sql.contains("trace_id IN ('"));
    }

    #[test]
    fn latest_session_page_sql_without_filter_has_no_membership_having() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &LatestSessionSearch::default(),
            &LatestSessionSort::default(),
            &validated,
        );

        assert!(
            sql.contains(") WHERE session_id IS NOT NULL AND session_id != '' GROUP BY session_id")
        );
        assert!(!sql.contains("HAVING"));
        assert!(sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
    }

    #[test]
    fn latest_session_page_sql_keeps_unrelated_subqueries_unchanged() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let filter = "gen_ai_conversation_id IN (SELECT other_id FROM other_stream WHERE active = true GROUP BY other_id)";
        assert!(config::utils::sql::validate_optional_where_fragment(filter).is_ok());
        let sql = build_latest_session_page_sql(
            "bench_traces",
            filter,
            &LatestSessionSearch::default(),
            &LatestSessionSort::default(),
            &validated,
        );

        assert!(sql.contains(filter));
        let tables = openobserve_core::authz::resolve_sql_tables(&sql).unwrap();
        assert!(tables.iter().any(|t| t.table() == "other_stream"));
    }

    fn sort(field: LatestSessionSortField, order: LatestSessionSortOrder) -> LatestSessionSort {
        LatestSessionSort { field, order }
    }

    #[test]
    fn session_sort_query_defaults_and_validates_allowlisted_values() {
        let mut query = HashMap::new();
        assert_eq!(
            LatestSessionSort::from_query(&query).unwrap(),
            LatestSessionSort::default()
        );

        query.insert("sort_by".to_string(), "TRACE_COUNT".to_string());
        query.insert("sort_order".to_string(), "ASC".to_string());
        assert_eq!(
            LatestSessionSort::from_query(&query).unwrap(),
            sort(
                LatestSessionSortField::TraceCount,
                LatestSessionSortOrder::Asc
            )
        );

        for unsupported in ["start_time", "session_id"] {
            query.insert("sort_by".to_string(), unsupported.to_string());
            assert!(LatestSessionSort::from_query(&query).is_err());
        }

        query.insert("sort_by".to_string(), "drop table".to_string());
        assert!(LatestSessionSort::from_query(&query).is_err());
        query.insert("sort_by".to_string(), "end_time".to_string());
        query.insert("sort_order".to_string(), "sideways".to_string());
        assert!(LatestSessionSort::from_query(&query).is_err());
    }

    #[test]
    fn session_page_sql_preserves_default_order_and_reverses_it_explicitly() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let default_sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &LatestSessionSearch::default(),
            &LatestSessionSort::default(),
            &validated,
        );
        assert!(default_sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
        assert!(!default_sql.contains("session_sort_value"));

        let ascending_sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &LatestSessionSearch::default(),
            &sort(LatestSessionSortField::EndTime, LatestSessionSortOrder::Asc),
            &validated,
        );
        assert!(ascending_sql.contains("ORDER BY session_last_activity ASC, session_id ASC"));
        assert!(!ascending_sql.contains("session_sort_value"));
    }

    #[test]
    fn session_page_sql_orders_by_each_summary_value_before_pagination() {
        let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        validated.has_total_tokens = true;
        // (field, per-trace value over all the trace's spans, session rollup)
        let cases = [
            (
                LatestSessionSortField::UserId,
                Some("min(NULLIF(user_id, '')) as trace_sort_value"),
                "min(trace_sort_value) as session_sort_value",
            ),
            (
                LatestSessionSortField::TraceCount,
                None,
                "count(trace_id) as session_sort_value",
            ),
            (
                LatestSessionSortField::Duration,
                Some("min(start_time) as trace_sort_value"),
                "THEN max(trace_last_activity) - min(trace_sort_value) ELSE 0 END \
                 as session_sort_value",
            ),
            (
                LatestSessionSortField::TotalTokens,
                Some("COALESCE(sum(gen_ai_usage_total_tokens), 0) as trace_sort_value"),
                "sum(trace_sort_value) as session_sort_value",
            ),
            (
                LatestSessionSortField::Cost,
                Some("COALESCE(sum(gen_ai_usage_cost), 0) as trace_sort_value"),
                "sum(trace_sort_value) as session_sort_value",
            ),
            (
                LatestSessionSortField::Status,
                Some("max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as trace_sort_value"),
                "max(trace_sort_value) as session_sort_value",
            ),
        ];

        for (field, trace_value, session_value) in cases {
            let sql = build_latest_session_page_sql(
                "bench_traces",
                "",
                &LatestSessionSearch::default(),
                &sort(field, LatestSessionSortOrder::Asc),
                &validated,
            );
            let (per_session, per_trace, tail) = split_per_trace(&sql);
            assert!(per_session.ends_with(session_value), "{field:?}: {sql}");
            match trace_value {
                Some(value) => assert!(per_trace.contains(value), "{field:?}: {sql}"),
                None => assert!(!per_trace.contains("trace_sort_value"), "{field:?}: {sql}"),
            }
            assert_eq!(
                tail,
                "WHERE session_id IS NOT NULL AND session_id != '' \
                 GROUP BY session_id ORDER BY session_sort_value ASC NULLS LAST, \
                 session_last_activity DESC, session_id DESC"
            );
        }
    }

    #[test]
    fn session_page_sort_uses_legacy_usage_columns_and_missing_token_default() {
        let mut legacy = super::super::schema_compat::ValidatedLlmSchema::fallback(false);
        legacy.has_total_tokens = true;
        assert_eq!(
            latest_session_sort_expressions(LatestSessionSortField::UserId, &legacy).0,
            Some("min(NULLIF(llm_user_id, ''))".to_string())
        );
        assert_eq!(
            latest_session_usage_sort_column(LatestSessionSortField::TotalTokens, &legacy),
            Some("llm_usage_tokens_total")
        );
        assert_eq!(
            latest_session_usage_sort_column(LatestSessionSortField::Cost, &legacy),
            Some("llm_usage_cost_total")
        );

        legacy.has_total_tokens = false;
        assert_eq!(
            latest_session_usage_sort_column(LatestSessionSortField::TotalTokens, &legacy),
            None
        );
        let page = build_latest_session_page_sql(
            "legacy_traces",
            "",
            &LatestSessionSearch::default(),
            &sort(
                LatestSessionSortField::TotalTokens,
                LatestSessionSortOrder::Desc,
            ),
            &legacy,
        );
        assert!(page.contains(", 0 as session_sort_value"), "{page}");
    }

    fn split_per_trace(sql: &str) -> (&str, &str, &str) {
        let (per_session, rest) = sql
            .split_once(" FROM (SELECT ")
            .unwrap_or_else(|| panic!("no per-trace subquery: {sql}"));
        let (per_trace, tail) = rest
            .split_once(" GROUP BY trace_id) ")
            .unwrap_or_else(|| panic!("no per-trace grouping: {sql}"));
        (per_session, per_trace, tail)
    }

    #[test]
    fn session_usage_rule_runs_per_trace_and_sums_per_session() {
        // Agent-only traces must sum per trace, not take the session's largest agent span.
        let mut validated = with_operation_name();
        validated.has_input_messages = true;
        validated.has_cost_status = true;
        let sql = build_latest_sessions_sql("bench_traces", &["sA".to_string()], &validated);
        let (per_session, per_trace, tail) = split_per_trace(&sql);

        assert!(per_trace.starts_with("max(gen_ai_conversation_id) as session_id, trace_id, "));
        assert_eq!(tail, "WHERE session_id IN ('sA') GROUP BY session_id");
        assert!(
            !per_session.contains("gen_ai_operation_name"),
            "{per_session}"
        );
        for column in [
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_total_tokens",
            "gen_ai_usage_cost",
            "gen_ai_usage_cache_read_input_tokens",
        ] {
            assert!(
                per_trace.contains(&format!("{} as {column}", usage_rule(column, true))),
                "{column}: {per_trace}"
            );
            assert!(
                per_session.contains(&format!("sum({column}) as {column}")),
                "{column}: {per_session}"
            );
        }
        // The other session aggregates roll up from the traces.
        for rollup in [
            "count(DISTINCT trace_id) as trace_count",
            "min(start_time) as start_time",
            "max(end_time) as end_time",
            "sum(error_count) as error_count",
            "sum(gen_ai_unpriced_tokens) as gen_ai_unpriced_tokens",
            "array_distinct(flatten(array_agg(gen_ai_unpriced_models))) as gen_ai_unpriced_models",
            "array_distinct(flatten(array_agg(user_ids))) as user_ids",
            // The agent of the trace the first message came from.
            "FIRST_VALUE(agent_name ORDER BY first_message_time ASC) \
             FILTER (WHERE gen_ai_input_messages IS NOT NULL) as agent_name",
            "FIRST_VALUE(gen_ai_input_messages ORDER BY first_message_time ASC)",
        ] {
            assert!(per_session.contains(rollup), "{rollup}: {per_session}");
        }
        for per_trace_value in [
            "sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as error_count",
            "array_agg(DISTINCT user_id)",
            "as first_message_time",
            "COALESCE(FIRST_VALUE(NULLIF(gen_ai_agent_name, '') ORDER BY start_time ASC) \
             FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != ''), \
             FIRST_VALUE(gen_ai_agent_name ORDER BY start_time ASC) \
             FILTER (WHERE gen_ai_agent_name IS NOT NULL AND gen_ai_agent_name != '')) \
             as agent_name",
        ] {
            assert!(per_trace.contains(per_trace_value), "{per_trace_value}");
        }
        assert!(!sql.contains("max(gen_ai_agent_name)"), "{sql}");
        assert!(!sql.contains("max(agent_name)"), "{sql}");
    }

    #[test]
    fn harness_by_agent_keeps_the_first_rule_for_an_agent() {
        let rule = |agent: &str, pattern: &str| config::meta::gen_ai::HarnessPatternRule {
            agent: agent.to_string(),
            patterns: vec![pattern.to_string()],
        };
        let harness = harness_by_agent(&[
            rule("omp", "tag a"),
            rule("omp", "tag b"),
            rule("task", "tag c"),
        ]);
        assert_eq!(harness.len(), 2);
        let labels = |agent: &str| -> Vec<String> {
            harness[agent].iter().map(|(_, l)| l.clone()).collect()
        };
        assert_eq!(labels("omp"), ["a"]);
        assert_eq!(labels("task"), ["c"]);
    }

    #[test]
    fn session_usage_sort_ranks_by_per_trace_usage_and_keeps_membership() {
        // The Tokens/Cost sort must rank by the same per-trace sum the list shows.
        let filter = "gen_ai_agent_id = 'agent-1'";
        let mut validated = gen_ai_with_messages();
        validated.has_total_tokens = true;
        validated.has_operation_name = true;
        validated.has_parent_span = true;
        for field in [
            LatestSessionSortField::TotalTokens,
            LatestSessionSortField::Cost,
        ] {
            let sql = build_latest_session_page_sql(
                "bench_traces",
                filter,
                &search(Some("refund")),
                &sort(field, LatestSessionSortOrder::Desc),
                &validated,
            );
            let (per_session, per_trace, tail) = split_per_trace(&sql);
            assert_eq!(
                per_session,
                "SELECT session_id, max(trace_last_activity) as session_last_activity, \
                 sum(trace_sort_value) as session_sort_value"
            );
            assert!(per_trace.contains(
                "sum(CASE WHEN gen_ai_operation_name = 'invoke_agent' AND agent_parent_span IS NULL"
            ));
            assert!(per_trace.contains(&format!(
                "FROM \"bench_traces\"{}",
                agent_parents_join("\"bench_traces\"", validated.layout(), None)
            )));
            assert!(per_trace.contains(&format!(
                "max(CASE WHEN {filter} THEN 1 ELSE 0 END) as session_match_0"
            )));
            assert!(per_trace.contains("as session_match_1"));
            assert_eq!(
                tail,
                "WHERE session_id IS NOT NULL AND session_id != '' \
                 GROUP BY session_id HAVING max(session_match_0) = 1 AND max(session_match_1) = 1 \
                 ORDER BY session_sort_value DESC NULLS LAST, \
                 session_last_activity DESC, session_id DESC"
            );
        }
    }

    #[test]
    fn session_list_reads_every_span_of_the_sessions_traces() {
        // Session id is often on the agent span only; chat children carry usage and messages.
        let mut validated = gen_ai_with_messages();
        validated.has_total_tokens = true;
        validated.has_operation_name = true;
        validated.has_parent_span = true;
        let any_session = "WHERE session_id IS NOT NULL AND session_id != '' GROUP BY session_id";
        let page_sorts = [
            LatestSessionSortField::EndTime,
            LatestSessionSortField::UserId,
            LatestSessionSortField::TraceCount,
            LatestSessionSortField::Duration,
            LatestSessionSortField::TotalTokens,
            LatestSessionSortField::Cost,
            LatestSessionSortField::Status,
        ];
        let searches = [
            LatestSessionSearch::default(),
            LatestSessionSearch {
                keyword: Some("kiwiword".to_string()),
                user_id: Some("qa-user".to_string()),
            },
        ];
        let mut queries = vec![(
            build_latest_sessions_sql("bench_traces", &["s1".to_string()], &validated),
            "WHERE session_id IN ('s1') GROUP BY session_id",
        )];
        for field in page_sorts {
            for search in &searches {
                queries.push((
                    build_latest_session_page_sql(
                        "bench_traces",
                        "gen_ai_agent_id = 'agent-1'",
                        search,
                        &sort(field, LatestSessionSortOrder::Desc),
                        &validated,
                    ),
                    any_session,
                ));
            }
        }

        for (sql, sessions) in queries {
            let (_, per_trace, tail) = split_per_trace(&sql);
            assert!(
                per_trace.starts_with("max(gen_ai_conversation_id) as session_id, trace_id, "),
                "{sql}"
            );
            // The usage rule's agent-parent join narrows no span either.
            let agent_parents = agent_parents_join("\"bench_traces\"", validated.layout(), None);
            let spans = per_trace.trim_end_matches(agent_parents.as_str());
            assert!(spans.ends_with(" FROM \"bench_traces\""), "{sql}");
            assert!(tail.starts_with(sessions), "{sql}");
            assert!(!tail.contains("gen_ai_conversation_id"), "{sql}");
            // Per-trace flags let the keyword and the user sit on different spans.
            if sql.contains("kiwiword") {
                assert!(per_trace.contains("as session_match_1"), "{sql}");
                assert!(per_trace.contains("as session_match_2"), "{sql}");
                assert!(tail.contains("HAVING max(session_match_0) = 1"), "{sql}");
            }
        }
    }

    #[test]
    fn session_trace_page_reports_every_turn_and_pages_newest_first() {
        // `total` is the session's turn count, not the page length.
        let ordering: HashMap<String, i64> = (0..5).map(|n| (format!("t{n}"), n)).collect();
        assert_eq!(
            session_trace_page(ordering.clone(), 0, 2),
            (5, vec!["t4".to_string(), "t3".to_string()])
        );
        assert_eq!(
            session_trace_page(ordering.clone(), 4, 2),
            (5, vec!["t0".to_string()])
        );
        assert_eq!(session_trace_page(ordering, 9, 2), (5, vec![]));
    }

    const LLM_CALL: &str = "(gen_ai_operation_name IS NULL OR gen_ai_operation_name IN \
                            ('chat', 'text_completion', 'generate_content', 'embeddings'))";

    fn with_operation_name() -> super::super::schema_compat::ValidatedLlmSchema {
        let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        validated.has_total_tokens = true;
        validated.has_cache_read_input_tokens = true;
        validated.has_operation_name = true;
        validated.has_parent_span = true;
        validated
    }

    #[test]
    fn usage_rule_sums_top_level_agents_found_through_their_parents() {
        assert_eq!(
            usage_rule("gen_ai_usage_cost", true),
            format!(
                "COALESCE(NULLIF(sum(CASE WHEN {LLM_CALL} THEN gen_ai_usage_cost ELSE 0 END), 0), \
                 sum(CASE WHEN gen_ai_operation_name = 'invoke_agent' AND agent_parent_span IS NULL \
                 THEN gen_ai_usage_cost END), 0)"
            )
        );
        let layout = with_operation_name().layout();
        // Agent ids are distinct, so the parent join duplicates no span.
        let agents = "SELECT DISTINCT trace_id AS agent_parent_trace, span_id AS agent_parent_span \
                      FROM \"s\" WHERE gen_ai_operation_name = 'invoke_agent'";
        let on =
            "ON trace_id = agent_parent_trace AND reference_parent_span_id = agent_parent_span";
        assert_eq!(
            agent_parents_join("\"s\"", layout, None),
            format!(" LEFT JOIN ({agents}) AS agent_parents {on}")
        );
        // Bounded to the traces the outer query reads.
        assert_eq!(
            agent_parents_join("\"s\"", layout, Some("trace_id IN ('t1')")),
            format!(" LEFT JOIN ({agents} AND (trace_id IN ('t1'))) AS agent_parents {on}")
        );
        let flat = super::super::schema_compat::StreamLlmLayout {
            has_parent_span: false,
            ..layout
        };
        let no_parents = agent_parents_join("\"s\"", flat, Some("trace_id IN ('t1')"));
        assert_eq!(
            no_parents,
            " LEFT JOIN (SELECT DISTINCT trace_id AS agent_parent_trace, span_id AS agent_parent_span \
             FROM \"s\" WHERE false) AS agent_parents ON trace_id = agent_parent_trace"
        );
        assert!(!no_parents.contains("reference_parent_span_id"));
        // Without the operation name the rule is a plain sum and reads no agent span.
        let legacy = super::super::schema_compat::StreamLlmLayout {
            has_operation_name: false,
            ..layout
        };
        assert_eq!(agent_parents_join("\"s\"", legacy, None), "");
        assert_eq!(
            usage_rule("gen_ai_usage_cost", false),
            "sum(gen_ai_usage_cost)"
        );
    }

    #[test]
    fn session_queries_join_agent_parents_wherever_they_apply_the_usage_rule() {
        let validated = with_operation_name();
        let join = |scope: Option<&str>| agent_parents_join("\"s\"", validated.layout(), scope);
        let details = build_session_trace_details_sql(
            "s",
            &validated,
            true,
            "service_name",
            "trace_id IN ('t1')",
        );
        assert!(
            details.contains(&format!(
                "FROM \"s\"{} WHERE trace_id IN ('t1') GROUP BY trace_id",
                join(Some("trace_id IN ('t1')"))
            )),
            "{details}"
        );
        let sessions = build_latest_sessions_sql("s", &["s1".to_string()], &validated);
        assert!(
            sessions.contains(&format!("FROM \"s\"{} GROUP BY trace_id)", join(None))),
            "{sessions}"
        );
        let page = |field| {
            build_latest_session_page_sql(
                "s",
                "",
                &LatestSessionSearch::default(),
                &sort(field, LatestSessionSortOrder::Desc),
                &validated,
            )
        };
        for field in [
            LatestSessionSortField::TotalTokens,
            LatestSessionSortField::Cost,
        ] {
            let sql = page(field);
            assert!(
                sql.contains(&format!("FROM \"s\"{} GROUP BY trace_id)", join(None))),
                "{sql}"
            );
        }
        // Sorts that read no usage scan the stream alone.
        for field in [
            LatestSessionSortField::EndTime,
            LatestSessionSortField::TraceCount,
        ] {
            assert!(!page(field).contains("agent_parents"));
        }
    }

    #[test]
    fn session_usage_sums_count_only_llm_call_spans() {
        let validated = with_operation_name();
        let llm_sum = |column: &str| {
            format!(
                "COALESCE(NULLIF(sum(CASE WHEN {LLM_CALL} THEN {column} ELSE 0 END), 0), \
                 sum(CASE WHEN gen_ai_operation_name = 'invoke_agent' AND agent_parent_span IS NULL \
                 THEN {column} END), 0)"
            )
        };
        let details = build_session_trace_details_sql(
            "default",
            &validated,
            false,
            "service_name",
            "trace_id IN ('t1')",
        );
        for (column, alias) in [
            ("gen_ai_usage_input_tokens", "gen_ai_usage_details_input"),
            ("gen_ai_usage_output_tokens", "gen_ai_usage_details_output"),
            ("gen_ai_usage_total_tokens", "gen_ai_usage_details_total"),
            ("gen_ai_usage_cost", "gen_ai_usage_cost_details"),
            (
                "gen_ai_usage_cache_read_input_tokens",
                "gen_ai_usage_cache_read_input_tokens",
            ),
        ] {
            let expected = format!("{} as {alias}", llm_sum(column));
            assert!(details.contains(&expected), "{alias}: {details}");
        }
        assert!(details.contains("0 as gen_ai_usage_cache_creation_input_tokens"));

        let sessions =
            build_latest_sessions_sql("bench_traces", &["session-1".to_string()], &validated);
        for column in [
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_total_tokens",
            "gen_ai_usage_cost",
        ] {
            let expected = format!("{} as {column}", llm_sum(column));
            assert!(sessions.contains(&expected), "{column}: {sessions}");
        }

        for (field, column) in [
            (
                LatestSessionSortField::TotalTokens,
                "gen_ai_usage_total_tokens",
            ),
            (LatestSessionSortField::Cost, "gen_ai_usage_cost"),
        ] {
            let page = build_latest_session_page_sql(
                "bench_traces",
                "",
                &LatestSessionSearch::default(),
                &sort(field, LatestSessionSortOrder::Desc),
                &validated,
            );
            let expected = format!("COALESCE({}, 0) as trace_sort_value", llm_sum(column));
            assert!(page.contains(&expected), "{page}");
        }
    }

    #[test]
    fn session_sql_without_operation_name_keeps_plain_sums() {
        let mut validated = with_operation_name();
        validated.has_operation_name = false;
        let sessions =
            build_latest_sessions_sql("bench_traces", &["session-1".to_string()], &validated);
        let details = build_session_trace_details_sql(
            "bench_traces",
            &validated,
            false,
            "service_name",
            "trace_id IN ('t1')",
        );
        let page = build_latest_session_page_sql(
            "bench_traces",
            "",
            &LatestSessionSearch::default(),
            &sort(LatestSessionSortField::Cost, LatestSessionSortOrder::Desc),
            &validated,
        );
        for sql in [&sessions, &details, &page] {
            assert!(!sql.contains("gen_ai_operation_name"), "{sql}");
            assert!(!sql.contains("agent_parents"), "{sql}");
        }
        assert!(sessions.contains("sum(gen_ai_usage_input_tokens) as gen_ai_usage_input_tokens"));
        assert!(sessions.contains("WHERE session_id IN ('session-1')"));
        assert!(details.contains("sum(gen_ai_usage_cost) as gen_ai_usage_cost_details"));
        assert!(page.contains("COALESCE(sum(gen_ai_usage_cost), 0) as trace_sort_value"));
    }

    // ── List search (`keyword`) ─────────────────────────────────────────────

    fn search(keyword: Option<&str>) -> LatestSessionSearch {
        LatestSessionSearch {
            keyword: keyword.map(str::to_string),
            user_id: None,
        }
    }

    fn gen_ai_with_messages() -> super::super::schema_compat::ValidatedLlmSchema {
        let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        validated.has_input_messages = true;
        validated.has_output_messages = true;
        validated
    }

    #[test]
    fn page_sql_keywords_user_and_messages_with_or_in_one_having_clause() {
        let sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &search(Some("refund")),
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );

        assert!(sql.contains(
            "max(CASE WHEN (str_match_ignore_case(user_id, 'refund') OR \
             (str_match_ignore_case(gen_ai_input_messages, 'refund') OR \
             str_match_ignore_case(gen_ai_output_messages, 'refund'))) THEN 1 ELSE 0 END) \
             as session_match_0"
        ));
        assert!(sql.contains("GROUP BY session_id HAVING max(session_match_0) = 1 ORDER BY"));
        assert_eq!(sql.matches("HAVING").count(), 1);
        assert!(sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
    }

    #[test]
    fn page_sql_checks_agent_filter_and_keyword_as_separate_session_conditions() {
        let filter = "gen_ai_agent_id = 'agent-1' OR gen_ai_agent_id = 'agent-2'";
        assert!(config::utils::sql::validate_optional_where_fragment(filter).is_ok());
        let sql = build_latest_session_page_sql(
            "bench_traces",
            filter,
            &search(Some("refund")),
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );

        assert!(sql.contains(
            "max(CASE WHEN gen_ai_agent_id = 'agent-1' OR gen_ai_agent_id = 'agent-2' \
             THEN 1 ELSE 0 END) as session_match_0, \
             max(CASE WHEN (str_match_ignore_case(user_id, 'refund') OR \
             (str_match_ignore_case(gen_ai_input_messages, 'refund') OR \
             str_match_ignore_case(gen_ai_output_messages, 'refund'))) THEN 1 ELSE 0 END) \
             as session_match_1"
        ));
        assert!(sql.contains("HAVING max(session_match_0) = 1 AND max(session_match_1) = 1"));
        assert_eq!(sql.matches("HAVING").count(), 1);
    }

    #[test]
    fn page_sql_keyword_unwraps_the_legacy_membership_subquery_filter() {
        let filter = "gen_ai_conversation_id IN (SELECT gen_ai_conversation_id FROM \"bench_traces\" WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != '' AND gen_ai_agent_id = 'agent-123' GROUP BY gen_ai_conversation_id)";
        let sql = build_latest_session_page_sql(
            "bench_traces",
            filter,
            &search(Some("luis")),
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );

        assert!(!sql.contains("IN (SELECT gen_ai_conversation_id"));
        assert!(sql.contains("gen_ai_agent_id = 'agent-123'"));
        assert!(sql.contains(
            "THEN 1 ELSE 0 END) as session_match_0, \
             max(CASE WHEN (str_match_ignore_case(user_id, 'luis') OR"
        ));
    }

    #[test]
    fn page_sql_keyword_uses_legacy_columns_on_a_legacy_stream() {
        let mut validated = super::super::schema_compat::ValidatedLlmSchema::fallback(false);
        validated.has_input_messages = true;
        validated.has_output_messages = true;
        let sql = build_latest_session_page_sql(
            "legacy_traces",
            "",
            &search(Some("refund")),
            &LatestSessionSort::default(),
            &validated,
        );

        assert!(sql.contains("str_match_ignore_case(llm_user_id, 'refund')"));
        assert!(sql.contains(
            "(str_match_ignore_case(llm_input, 'refund') OR \
             str_match_ignore_case(llm_output, 'refund'))"
        ));
        assert!(sql.contains("max(llm_session_id) as session_id"));
    }

    #[test]
    fn search_predicate_escapes_only_the_single_quote() {
        // A quote must not close the literal; nothing else is special for
        // str_match_ignore_case (no LIKE wildcards, no backslash escapes).
        assert_eq!(
            session_search_predicate("user_id", "o'brien"),
            "str_match_ignore_case(user_id, 'o''brien')"
        );
        assert_eq!(
            session_search_predicate("user_id", "a'; DROP TABLE x; --"),
            "str_match_ignore_case(user_id, 'a''; DROP TABLE x; --')"
        );
        assert_eq!(
            session_search_predicate("gen_ai_input_messages", "100% off_the\\path"),
            "str_match_ignore_case(gen_ai_input_messages, '100% off_the\\path')"
        );
    }

    #[test]
    fn page_sql_keyword_uses_only_available_message_columns() {
        let mut input_only = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        input_only.has_input_messages = true;
        let input_sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &search(Some("refund")),
            &LatestSessionSort::default(),
            &input_only,
        );
        assert!(input_sql.contains("str_match_ignore_case(user_id, 'refund') OR"));
        assert!(input_sql.contains("str_match_ignore_case(gen_ai_input_messages, 'refund')"));
        assert!(!input_sql.contains("gen_ai_output_messages"));

        let user_only = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let user_sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &search(Some("refund")),
            &LatestSessionSort::default(),
            &user_only,
        );
        assert!(user_sql.contains(
            "max(CASE WHEN (str_match_ignore_case(user_id, 'refund')) \
             THEN 1 ELSE 0 END) as session_match_0"
        ));
        assert!(!user_sql.contains("gen_ai_input_messages"));
        assert!(!user_sql.contains("gen_ai_output_messages"));
    }

    #[test]
    fn page_sql_user_id_matches_the_user_exactly() {
        let filter = "gen_ai_agent_id = 'agent-1' OR gen_ai_agent_id = 'agent-2'";
        let user = LatestSessionSearch {
            keyword: None,
            user_id: Some("o'brien".to_string()),
        };
        let sql = build_latest_session_page_sql(
            "bench_traces",
            filter,
            &user,
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );
        assert!(sql.contains(
            "max(CASE WHEN gen_ai_agent_id = 'agent-1' OR gen_ai_agent_id = 'agent-2' \
             THEN 1 ELSE 0 END) as session_match_0, \
             max(CASE WHEN user_id = 'o''brien' THEN 1 ELSE 0 END) as session_match_1"
        ));
        assert!(sql.contains("HAVING max(session_match_0) = 1 AND max(session_match_1) = 1"));
        assert!(!sql.contains("str_match_ignore_case"));

        let both = LatestSessionSearch {
            keyword: Some("refund".to_string()),
            user_id: Some("qa-u1".to_string()),
        };
        let sql = build_latest_session_page_sql(
            "bench_traces",
            "",
            &both,
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );
        // User and messages may sit on different spans, so each is its own session-level condition.
        assert!(sql.contains(
            "OR str_match_ignore_case(gen_ai_output_messages, 'refund'))) THEN 1 ELSE 0 END) \
             as session_match_0, \
             max(CASE WHEN user_id = 'qa-u1' THEN 1 ELSE 0 END) as session_match_1"
        ));
        assert!(!sql.contains("AND user_id = 'qa-u1'"));
    }

    #[test]
    fn user_id_is_read_from_the_query_and_empty_means_absent() {
        let mut query: HashMap<String, String> = HashMap::new();
        query.insert("user_id".into(), "  qa-u1 ".into());
        assert_eq!(
            LatestSessionSearch::from_query(&query).user_id.as_deref(),
            Some("qa-u1")
        );
        query.insert("user_id".into(), "  ".into());
        assert_eq!(
            LatestSessionSearch::from_query(&query),
            LatestSessionSearch::default()
        );
    }

    #[test]
    fn keyword_is_trimmed_capped_and_empty_means_absent() {
        let mut query: HashMap<String, String> = HashMap::new();
        assert_eq!(
            LatestSessionSearch::from_query(&query),
            LatestSessionSearch::default()
        );

        query.insert("keyword".into(), "  refund  ".into());
        assert_eq!(
            LatestSessionSearch::from_query(&query),
            search(Some("refund"))
        );

        query.insert("keyword".into(), "é".repeat(300));
        let parsed = LatestSessionSearch::from_query(&query);
        assert_eq!(
            parsed.keyword.as_deref().map(|s| s.chars().count()),
            Some(256)
        );

        query.insert("keyword".into(), "   ".into());
        assert_eq!(
            LatestSessionSearch::from_query(&query),
            LatestSessionSearch::default()
        );
    }

    #[test]
    fn page_sql_keeps_conditions_out_of_subqueries() {
        // A subquery inside `max(CASE ...)` is an unsupported `InSubquery` expression.
        let sql = build_latest_session_page_sql(
            "bench_traces",
            "gen_ai_agent_id = 'agent-1'",
            &search(Some("100% refund")),
            &LatestSessionSort::default(),
            &gen_ai_with_messages(),
        );

        assert!(!sql.contains("IN (SELECT"), "{sql}");
        assert!(sql.contains("str_match_ignore_case(user_id, '100% refund')"));
    }

    #[test]
    fn latest_sessions_sql_keeps_legacy_aliases_and_optional_defaults() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(false);
        let sql =
            build_latest_sessions_sql("legacy_traces", &["session-1".to_string()], &validated);

        assert!(sql.contains("max(llm_session_id) as session_id"));
        assert!(sql.contains("sum(llm_usage_tokens_input) as gen_ai_usage_input_tokens"));
        assert!(sql.contains("sum(llm_usage_cost_total) as gen_ai_usage_cost"));
        assert!(sql.contains("0 as gen_ai_usage_total_tokens"));
        assert!(sql.contains("0 as gen_ai_usage_cache_read_input_tokens"));
        assert!(sql.contains("'' as gen_ai_input_messages"));
    }

    #[test]
    fn normalize_latest_sessions_removes_internal_fields_and_stabilizes_users() {
        let hits = vec![
            json!({
                "session_id": "session-1",
                "start_time": 100,
                "end_time": 300,
                "zo_sql_timestamp": 300,
                "gen_ai_input_messages": [
                    {"role": "assistant", "content": "hi"},
                    {"role": "user", "content": "show me the weather"}
                ],
                "user_ids": ["zeta", "alpha", "zeta", ""]
            }),
            json!({
                "session_id": "session-2",
                "start_time": 200,
                "end_time": 250,
                "zo_sql_timestamp": 200,
                "gen_ai_input_messages": [],
                "user_ids": []
            }),
        ];

        let normalized = normalize_latest_session_hits(
            hits,
            &["session-2".to_string(), "session-1".to_string()],
            &SessionReadRules::default(),
        );
        assert_eq!(normalized[0]["session_id"], "session-2");
        assert_eq!(normalized[1]["first_user_message"], "show me the weather");
        assert_eq!(normalized[1]["user_ids"], json!(["alpha", "zeta"]));
        assert_eq!(normalized[1]["session_id"], "session-1");
        assert!(normalized[0].get("zo_sql_timestamp").is_none());
        assert!(normalized[0].get("gen_ai_input_messages").is_none());
    }

    #[test]
    fn test_extract_first_user_message_basic() {
        let messages = json::json!([
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hello, how are you doing today?"},
            {"role": "assistant", "content": "I'm fine, thanks!"}
        ]);
        let result = extract_first_user_message(&messages, 30);
        assert_eq!(result, Some("Hello, how are you doing today".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_trim_to_length() {
        let messages = json::json!([
            {"role": "user", "content": "short"}
        ]);
        let result = extract_first_user_message(&messages, 30);
        assert_eq!(result, Some("short".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_empty() {
        assert_eq!(extract_first_user_message(&json::json!([]), 30), None);
        assert_eq!(
            extract_first_user_message(&json::json!([{"role": "assistant", "content": "hi"}]), 30),
            None
        );
    }

    #[test]
    fn test_extract_first_user_message_case_insensitive_role() {
        let messages = json::json!([
            {"role": "User", "content": "Hello"}
        ]);
        let result = extract_first_user_message(&messages, 30);
        assert_eq!(result, Some("Hello".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_from_plain_string_any_value() {
        let result = extract_first_user_message(&json::json!("plain input"), 30);
        assert_eq!(result, Some("plain input".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_from_scalar_any_values() {
        assert_eq!(
            extract_first_user_message(&json::json!(42), 30),
            Some("42".to_string())
        );
        assert_eq!(
            extract_first_user_message(&json::json!(false), 30),
            Some("false".to_string())
        );
    }

    #[test]
    fn test_extract_first_user_message_from_json_encoded_scalar() {
        let result = extract_first_user_message(&json::json!("\"encoded input\""), 30);
        assert_eq!(result, Some("encoded input".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_from_json_encoded_messages() {
        let input = json::json!(r#"[{"role":"user","content":"encoded message"}]"#);
        let result = extract_first_user_message(&input, 30);
        assert_eq!(result, Some("encoded message".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_from_otel_parts() {
        let messages = json::json!([
            {
                "role": "user",
                "parts": [
                    {"type": "text", "content": "Weather in Paris?"}
                ]
            }
        ]);
        let result = extract_first_user_message(&messages, 30);
        assert_eq!(result, Some("Weather in Paris?".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_from_unstructured_object_any_value() {
        let input = json::json!({"prompt": "hello"});
        let result = extract_first_user_message(&input, 30);
        assert_eq!(result, Some("{\"prompt\":\"hello\"}".to_string()));
    }

    #[test]
    fn session_sql_quotes_a_stream_name_that_contains_a_quote() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let page = build_latest_session_page_sql(
            "bench\"traces",
            "",
            &LatestSessionSearch::default(),
            &LatestSessionSort::default(),
            &validated,
        );
        let summary =
            build_latest_sessions_sql("bench\"traces", &["session-1".to_string()], &validated);
        let details = build_session_trace_details_sql(
            "bench\"traces",
            &validated,
            false,
            "service_name",
            "\"trace_id\" IN ('trace-1')",
        );
        let services = build_session_service_breakdown_sql(
            "bench\"traces",
            "service_name",
            "",
            "\"trace_id\" IN ('trace-1')",
        );
        for sql in [&page, &summary, &details, &services] {
            assert!(sql.contains("FROM \"bench\"\"traces\""), "{sql}");
            assert!(!sql.contains("FROM \"bench\"traces\""), "{sql}");
        }
    }
}

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
#[derive(Serialize)]
struct LatestSessionsResponse {
    took: usize,
    total: usize,
    from: i64,
    size: i64,
    hits: Vec<json::Value>,
    #[serde(skip_serializing_if = "String::is_empty")]
    trace_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    function_error: String,
    has_more: bool,
    total_is_exact: bool,
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
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "total": 11,
            "has_more": true,
            "total_is_exact": false,
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
        ("x-o2-mcp" = json!({"description": "List recent LLM sessions from a trace stream: session_id, trace count, token usage, cost, error count.", "category": "traces"}))
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
        if let Err(e) = search_service::check_search_allowed(&org_id, Some(&stream_name)) {
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
    if max_query_range > 0 && (end_time - start_time) > max_query_range * 3600 * 1_000_000 {
        start_time = end_time - max_query_range * 3600 * 1_000_000;
        range_error = format!(
            "Query duration is modified due to query range restriction of {max_query_range} hours"
        );
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // Session list aggregation assumes the session id is present on every span.
    // Page by session id first, then aggregate only those sessions. This avoids
    // materializing every trace id while keeping expensive summary aggregation
    // after pagination.
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
                        total_is_exact: true,
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
                total_is_exact: true,
            });
        }
    };
    let query_sql = build_latest_session_page_sql(&stream_name, &filter, &validated);
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
            total_is_exact: !has_more,
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
    let sessions_data = normalize_latest_session_hits(resp_summary.hits, &session_ids);

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
        total_is_exact: !has_more,
    })
}

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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "Get per-turn trace summaries for a single LLM session by session_id.", "category": "traces"}))
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
        if let Err(e) = search_service::check_search_allowed(&org_id, Some(&stream_name)) {
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
        // Enough rows to build the requested page after merging with the
        // index-discovered traces.
        req.query.size = from.saturating_add(size);
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

    let mut ordered: Vec<(String, i64)> = ordering.into_iter().collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let trace_ids: Vec<String> = ordered
        .into_iter()
        .skip(from as usize)
        .take(size as usize)
        .map(|(tid, _)| tid)
        .collect();
    if trace_ids.is_empty() {
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
        total: hits.len(),
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
        let svc_sql = format!(
            "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
             count(*) AS svc_count, max(duration) AS svc_duration \
             FROM \"{stream_name}\" WHERE {multi_trace_id_predicate} \
             GROUP BY trace_id, {service_key_expr}"
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

fn build_session_trace_details_sql(
    stream_name: &str,
    validated: &super::schema_compat::ValidatedLlmSchema,
    has_ref_parent_id: bool,
    service_key_expr: &str,
    trace_id_predicate: &str,
) -> String {
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
         first_value(operation_name ORDER BY {TIMESTAMP_COL_NAME} ASC) AS first_operation_name"
    );

    if validated.has_gen_ai {
        let first_msg_clause = if validated.has_input_messages {
            "FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC) FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != '')".to_string()
        } else {
            "''".to_string()
        };
        let total_tokens_expr = if validated.has_total_tokens {
            "sum(gen_ai_usage_total_tokens) as gen_ai_usage_details_total"
        } else {
            "0 as gen_ai_usage_details_total"
        };
        let cache_read_tokens_expr = optional_sum_expr(
            validated.has_cache_read_input_tokens,
            "gen_ai_usage_cache_read_input_tokens",
            "gen_ai_usage_cache_read_input_tokens",
        );
        let cache_creation_tokens_expr = optional_sum_expr(
            validated.has_cache_creation_input_tokens,
            "gen_ai_usage_cache_creation_input_tokens",
            "gen_ai_usage_cache_creation_input_tokens",
        );
        let cost_cache_read_expr = optional_sum_expr(
            validated.has_cost_cache_read_input,
            "gen_ai_usage_cost_cache_read_input",
            "gen_ai_usage_cost_cache_read_input",
        );
        let cost_cache_creation_expr = optional_sum_expr(
            validated.has_cost_cache_creation_input,
            "gen_ai_usage_cost_cache_creation_input",
            "gen_ai_usage_cost_cache_creation_input",
        );
        let cost_estimated_without_cache_expr = optional_sum_expr(
            validated.has_cost_estimated_without_cache,
            "gen_ai_usage_cost_estimated_without_cache",
            "gen_ai_usage_cost_estimated_without_cache",
        );
        let cost_cache_read_savings_expr = optional_sum_expr(
            validated.has_cost_cache_read_savings,
            "gen_ai_usage_cost_cache_read_savings",
            "gen_ai_usage_cost_cache_read_savings",
        );
        let cost_net_cache_impact_expr = optional_sum_expr(
            validated.has_cost_net_cache_impact,
            "gen_ai_usage_cost_net_cache_impact",
            "gen_ai_usage_cost_net_cache_impact",
        );
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            sum(gen_ai_usage_input_tokens) as gen_ai_usage_details_input, \
            sum(gen_ai_usage_output_tokens) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(gen_ai_usage_cost) as gen_ai_usage_cost_details, \
            {cache_read_tokens_expr}, \
            {cache_creation_tokens_expr}, \
            {cost_cache_read_expr}, \
            {cost_cache_creation_expr}, \
            {cost_estimated_without_cache_expr}, \
            {cost_cache_read_savings_expr}, \
            {cost_net_cache_impact_expr}, \
            array_agg(DISTINCT gen_ai_response_model) FILTER (WHERE gen_ai_response_model IS NOT NULL AND gen_ai_response_model != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {trace_selects} \
            FROM \"{stream_name}\" \
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
            FROM \"{stream_name}\" \
            WHERE {trace_id_predicate} \
            GROUP BY trace_id"
        )
    }
}

fn build_session_trace_response_item(
    item: &json::Value,
) -> Option<(String, i64, SessionTraceResponseItem)> {
    let tid = item.get("trace_id")?.as_str()?.to_string();
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

    let hit = SessionTraceResponseItem {
        trace_id: tid.clone(),
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
        models: item
            .get("gen_ai_response_models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
    };

    Some((tid, service_count, hit))
}

fn optional_sum_expr(has_field: bool, column: &str, alias: &str) -> String {
    if has_field {
        format!("sum({column}) as {alias}")
    } else {
        format!("0 as {alias}")
    }
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

fn build_latest_session_page_sql(
    stream_name: &str,
    filter: &str,
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> String {
    let session_id_col = validated.columns.session_id;
    let filter = normalize_latest_session_filter(filter, stream_name, session_id_col);
    let membership_filter = if filter.is_empty() {
        String::new()
    } else {
        format!(" HAVING max(CASE WHEN {filter} THEN 1 ELSE 0 END) = 1")
    };
    format!(
        "SELECT {session_id_col} as session_id, \
         max(end_time) as session_last_activity \
         FROM \"{stream_name}\" \
         WHERE {session_id_col} IS NOT NULL AND {session_id_col} != '' \
         GROUP BY {session_id_col}{membership_filter} \
         ORDER BY session_last_activity DESC, session_id DESC"
    )
}

fn build_latest_sessions_sql(
    stream_name: &str,
    session_ids: &[String],
    validated: &super::schema_compat::ValidatedLlmSchema,
) -> String {
    let session_id_col = validated.columns.session_id;
    // Trace ingestion normalizes OTEL `user.id` to the stored `user_id`
    // column. Keep the legacy schema's explicit `llm_user_id` name.
    let user_id_col = if validated.has_gen_ai {
        "user_id"
    } else {
        validated.columns.user_id
    };
    let session_ids_sql = session_ids
        .iter()
        .map(|session_id| format!("'{}'", session_id.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");

    let (input_tokens_col, output_tokens_col, total_tokens_col, cost_col, input_messages_col) =
        if validated.has_gen_ai {
            (
                "gen_ai_usage_input_tokens",
                "gen_ai_usage_output_tokens",
                "gen_ai_usage_total_tokens",
                "gen_ai_usage_cost",
                "gen_ai_input_messages",
            )
        } else {
            (
                "llm_usage_tokens_input",
                "llm_usage_tokens_output",
                "llm_usage_tokens_total",
                "llm_usage_cost_total",
                "llm_input",
            )
        };

    let total_tokens_expr = optional_sum_expr(
        validated.has_total_tokens,
        total_tokens_col,
        "gen_ai_usage_total_tokens",
    );
    let first_message_expr = if validated.has_input_messages {
        format!(
            "FIRST_VALUE({input_messages_col} ORDER BY start_time ASC) \
             FILTER (WHERE {input_messages_col} IS NOT NULL AND {input_messages_col} != '') \
             as gen_ai_input_messages"
        )
    } else {
        "'' as gen_ai_input_messages".to_string()
    };

    let cache_read_tokens_expr = optional_sum_expr(
        validated.has_cache_read_input_tokens,
        "gen_ai_usage_cache_read_input_tokens",
        "gen_ai_usage_cache_read_input_tokens",
    );
    let cache_creation_tokens_expr = optional_sum_expr(
        validated.has_cache_creation_input_tokens,
        "gen_ai_usage_cache_creation_input_tokens",
        "gen_ai_usage_cache_creation_input_tokens",
    );
    let cost_cache_read_expr = optional_sum_expr(
        validated.has_cost_cache_read_input,
        "gen_ai_usage_cost_cache_read_input",
        "gen_ai_usage_cost_cache_read_input",
    );
    let cost_cache_creation_expr = optional_sum_expr(
        validated.has_cost_cache_creation_input,
        "gen_ai_usage_cost_cache_creation_input",
        "gen_ai_usage_cost_cache_creation_input",
    );
    let cost_estimated_without_cache_expr = optional_sum_expr(
        validated.has_cost_estimated_without_cache,
        "gen_ai_usage_cost_estimated_without_cache",
        "gen_ai_usage_cost_estimated_without_cache",
    );
    let cost_cache_read_savings_expr = optional_sum_expr(
        validated.has_cost_cache_read_savings,
        "gen_ai_usage_cost_cache_read_savings",
        "gen_ai_usage_cost_cache_read_savings",
    );
    let cost_net_cache_impact_expr = optional_sum_expr(
        validated.has_cost_net_cache_impact,
        "gen_ai_usage_cost_net_cache_impact",
        "gen_ai_usage_cost_net_cache_impact",
    );

    format!(
        "SELECT {session_id_col} as session_id, \
         min(start_time) as start_time, \
         max(end_time) as end_time, \
         CASE WHEN max(end_time) > min(start_time) \
              THEN max(end_time) - min(start_time) ELSE 0 END as duration, \
         count(DISTINCT trace_id) as trace_count, \
         sum({input_tokens_col}) as gen_ai_usage_input_tokens, \
         sum({output_tokens_col}) as gen_ai_usage_output_tokens, \
         {total_tokens_expr}, \
         sum({cost_col}) as gen_ai_usage_cost, \
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
         FROM \"{stream_name}\" \
         WHERE {session_id_col} IN ({session_ids_sql}) \
         GROUP BY {session_id_col}"
    )
}

fn normalize_latest_session_hits(
    mut hits: Vec<json::Value>,
    session_ids: &[String],
) -> Vec<json::Value> {
    for hit in &mut hits {
        let first_user_message = hit
            .get("gen_ai_input_messages")
            .and_then(|value| extract_first_user_message(value, 400));
        let Some(hit) = hit.as_object_mut() else {
            continue;
        };

        hit.remove("zo_sql_timestamp");
        hit.remove("gen_ai_input_messages");
        hit.insert(
            "first_user_message".to_string(),
            first_user_message.map_or(json::Value::Null, json::Value::String),
        );

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
    // Both phases use the latest span end_time across the full session.
    // Keep the explicit final sort because distributed aggregation does not
    // guarantee phase 2 row order. Preserve phase 1 order as a deterministic
    // tie-breaker for sessions with the same last activity time.
    hits.sort_by(|left, right| {
        let last_activity =
            |hit: &json::Value| json::get_int_value(hit.get("end_time").unwrap_or_default());
        let page_index = |hit: &json::Value| {
            hit.get("session_id")
                .and_then(|value| value.as_str())
                .and_then(|session_id| page_order.get(session_id))
                .copied()
                .unwrap_or(usize::MAX)
        };

        last_activity(right)
            .cmp(&last_activity(left))
            .then_with(|| page_index(left).cmp(&page_index(right)))
    });
    hits
}

#[derive(Debug, Serialize)]
struct SessionTraceResponseItem {
    trace_id: String,
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
    models: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
struct SessionTraceServiceNameItem {
    service_name: String,
    count: u16,
    duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_type: Option<String>,
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
        assert_eq!(hit.service_name[0].service_name, "o2-ai");
        assert_eq!(hit.models, vec!["claude-sonnet-4-6".to_string()]);
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
        let page_sql = build_latest_session_page_sql("bench_traces", filter, &validated);
        let sql = build_latest_sessions_sql(
            "bench_traces",
            &["session-1".to_string(), "session'2".to_string()],
            &validated,
        );

        assert!(!page_sql.contains("IN (SELECT"));
        assert!(!page_sql.contains("trace_id"));
        assert!(page_sql.contains("max(end_time) as session_last_activity"));
        assert!(page_sql.contains("gen_ai_agent_id = 'agent-123'"));
        assert!(page_sql.contains("HAVING max(CASE WHEN"));
        assert!(page_sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
        assert!(!page_sql.contains("min(start_time) as session_start_time"));
        assert!(sql.contains("count(DISTINCT trace_id) as trace_count"));
        assert!(sql.contains("GROUP BY gen_ai_conversation_id"));
        assert!(sql.contains("gen_ai_conversation_id IN ('session-1','session''2')"));
        assert!(sql.contains("sum(gen_ai_usage_input_tokens) as gen_ai_usage_input_tokens"));
        assert!(sql.contains("sum(gen_ai_usage_total_tokens) as gen_ai_usage_total_tokens"));
        assert!(sql.contains("array_agg(DISTINCT user_id)"));
        assert!(sql.contains("FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC)"));
        assert!(!sql.contains("array_agg(DISTINCT trace_id)"));
        assert!(!sql.contains("WHERE trace_id IN"));
    }

    #[test]
    fn latest_session_page_sql_without_filter_has_no_membership_having() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let sql = build_latest_session_page_sql("bench_traces", "", &validated);

        assert!(
            sql.contains(
                "WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != ''"
            )
        );
        assert!(!sql.contains("HAVING"));
        assert!(sql.contains("ORDER BY session_last_activity DESC, session_id DESC"));
    }

    #[test]
    fn latest_session_page_sql_keeps_unrelated_subqueries_unchanged() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(true);
        let filter = "gen_ai_conversation_id IN (SELECT other_id FROM other_stream WHERE active = true GROUP BY other_id)";
        let sql = build_latest_session_page_sql("bench_traces", filter, &validated);

        assert!(sql.contains(filter));
    }

    #[test]
    fn latest_sessions_sql_keeps_legacy_aliases_and_optional_defaults() {
        let validated = super::super::schema_compat::ValidatedLlmSchema::fallback(false);
        let sql =
            build_latest_sessions_sql("legacy_traces", &["session-1".to_string()], &validated);

        assert!(sql.contains("llm_session_id as session_id"));
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
        );
        assert_eq!(normalized[0]["session_id"], "session-1");
        assert_eq!(normalized[0]["first_user_message"], "show me the weather");
        assert_eq!(normalized[0]["user_ids"], json!(["alpha", "zeta"]));
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
}

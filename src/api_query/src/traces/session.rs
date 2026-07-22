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
use hashbrown::{HashMap, HashSet};
use serde::Serialize;
use tracing::{Instrument, Span};

use super::TraceDetail;
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
        },
    },
    extractors::Headers,
    search::error_utils::map_error_to_http_response,
    service::{search as SearchService, traces},
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
    // gen_ai_*/llm_* fields may be on different spans than session_id.
    // So we must: get session→trace_id mapping first, then query by trace_id
    // (which captures ALL spans) to get accurate usage totals.
    //
    // Use ValidatedLlmSchema (Tier 1) for column-name resolution and optional
    // field detection. Session handler keeps its own SQL shape (Phase 1 groups
    // by session_id; Phase 2 queries by trace_id; ordering is done in Rust).
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
                Some(v)
            }
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        },
        None => Some(super::schema_compat::ValidatedLlmSchema::fallback(false)),
    };
    let validated = match validated {
        Some(v) => v,
        None => {
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
    };
    let session_id_col = validated.columns.session_id;
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
    let (session_ids, session_trace_ids) =
        parse_session_trace_ids(&resp_search.hits, session_id_col);

    // Collect all unique trace_ids across sessions
    let all_trace_ids: Vec<String> = session_trace_ids
        .values()
        .flat_map(|ids| ids.iter().cloned())
        .collect::<hashbrown::HashSet<String>>()
        .into_iter()
        .collect();

    if all_trace_ids.is_empty() {
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
    // Phase 2: Get per-trace details by querying with trace_id (captures ALL spans)
    // Sanitize trace IDs before interpolating into SQL: allow only hex chars and hyphens.
    // Trace IDs originate from ingested data and could contain injected SQL if not validated.
    let sanitized_ids: Vec<String> = all_trace_ids
        .iter()
        .map(|tid| {
            tid.chars()
                .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                .collect::<String>()
        })
        .filter(|tid| !tid.is_empty())
        .collect();
    let trace_ids_sql = sanitized_ids.join("','");

    // Build Phase 2 SQL using ValidatedLlmSchema for column names and optional
    // field presence (the session handler keeps its own SQL shape).
    let query_sql = if validated.has_gen_ai {
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
            "SELECT trace_id, \
            max(user_id) as user_id,
            min(start_time) as trace_start_time, \
            max(end_time) as trace_end_time, \
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
            sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as error_count, \
            {first_msg_clause} as gen_ai_input_messages \
            FROM \"{stream_name}\" \
            WHERE trace_id IN ('{trace_ids_sql}') \
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
            "SELECT trace_id, \
            max(llm_user_id) as user_id,
            min(start_time) as trace_start_time, \
            max(end_time) as trace_end_time, \
            sum(llm_usage_tokens_input) as gen_ai_usage_details_input, \
            sum(llm_usage_tokens_output) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(llm_usage_cost_total) as gen_ai_usage_cost_details, \
            sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as error_count, \
            {first_msg_clause} as gen_ai_input_messages \
            FROM \"{stream_name}\" \
            WHERE trace_id IN ('{trace_ids_sql}') \
            GROUP BY trace_id"
        )
    };
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
        let first_user_message = extract_first_user_message(item.get("gen_ai_input_messages"), 400);
        trace_details.insert(
            tid,
            TraceDetail {
                start_time: json::get_int_value(item.get("trace_start_time").unwrap_or_default()),
                end_time: json::get_int_value(item.get("trace_end_time").unwrap_or_default()),
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
                error_count: json::get_int_value(item.get("error_count").unwrap_or_default()),
                user_id: item
                    .get("user_id")
                    .and_then(|v| v.as_str().map(String::from)),
                first_user_message,
            },
        );
    }

    // Aggregate per session from trace details
    let sessions_data = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);

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

    MetaHttpResponse::json(PaginatedResponse {
        took: (time * 1000.0) as usize,
        total: sessions_data.len(),
        from,
        size,
        hits: sessions_data
            .into_iter()
            .map(|v| json::to_value(v).unwrap())
            .collect(),
        trace_id,
        function_error: range_error,
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
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
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

    let from = query
        .get("from")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
    let size = query
        .get("size")
        .map_or(1000, |v| v.parse::<i64>().unwrap_or(1000));
    let start_time = query
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

    let query_sql = traces::session::trace_ids_sql(&stream_name, &session_id_columns, &session_id);

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
        use_cache,
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

    let trace_ids = traces::session::trace_ids_from_hits(&resp_search.hits);
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
        start_time,
        end_time,
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

/// Extract the first user message from a `gen_ai_input_messages` JSON value.
///
/// The input is expected to be a JSON array of message objects with `role` and
/// `content` fields (e.g. `[{"role":"user","content":"hello"}]`). Returns the
/// content of the first message with role "user", trimmed to `max_len` chars.
fn extract_first_user_message(
    messages_val: Option<&json::Value>,
    max_len: usize,
) -> Option<String> {
    let val = messages_val?;

    // The value may be:
    // 1. A JSON array directly: [{"role":"user","content":"..."}]
    // 2. A JSON string of an array: "[{\"role\":\"user\",...}]"
    // 3. A JSON string of an object with a nested "messages" array:
    //    "{\"model\":\"...\",\"messages\":[{\"role\":\"user\",...}]}"
    let parsed: json::Value;
    let msgs_val: &json::Value = if val.is_array() {
        val
    } else {
        let s = val.as_str()?;
        parsed = json::from_str(s).ok()?;
        &parsed
    };

    // Resolve the actual messages array — either the top-level value, or a nested
    // "messages" key (OpenAI-style) or "contents" key (Gemini/LiteLLM-style).
    let arr = if let Some(a) = msgs_val.as_array() {
        a
    } else if let Some(a) = msgs_val.get("messages").and_then(|v| v.as_array()) {
        a
    } else {
        msgs_val.get("contents").and_then(|v| v.as_array())?
    };

    for msg in arr {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if !role.eq_ignore_ascii_case("user") {
            continue;
        }

        // OpenAI-style: content is a plain string
        if let Some(content) = msg.get("content").and_then(|v| v.as_str()) {
            let trimmed: String = content.chars().take(max_len).collect();
            return Some(trimmed);
        }

        // Gemini/LiteLLM-style: parts: [{text: "..."}]
        if let Some(text) = msg
            .get("parts")
            .and_then(|v| v.as_array())
            .and_then(|parts| {
                parts
                    .iter()
                    .find_map(|p| p.get("text").and_then(|t| t.as_str()))
            })
        {
            let trimmed: String = text.chars().take(max_len).collect();
            return Some(trimmed);
        }
    }
    None
}

#[derive(Debug, Serialize)]
struct SessionDetails {
    session_id: String,
    start_time: i64,
    end_time: i64,
    duration: i64,
    trace_count: u16,
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
    error_count: i64,
    user_ids: Vec<String>,
    first_user_message: Option<String>,
}

impl SessionDetails {
    fn from_trace_details(session_id: String, trace_count: usize, details: &[TraceDetail]) -> Self {
        let mut start_time: i64 = 0;
        let mut end_time: i64 = 0;
        let mut usage_input: i64 = 0;
        let mut usage_output: i64 = 0;
        let mut usage_total: i64 = 0;
        let mut cost_total: f64 = 0.0;
        let mut cache_read_tokens: i64 = 0;
        let mut cache_creation_tokens: i64 = 0;
        let mut cost_cache_read: f64 = 0.0;
        let mut cost_cache_creation: f64 = 0.0;
        let mut cost_estimated_without_cache: f64 = 0.0;
        let mut cost_cache_read_savings: f64 = 0.0;
        let mut cost_net_cache_impact: f64 = 0.0;
        let mut error_count: i64 = 0;
        let mut user_ids: HashSet<String> = HashSet::with_capacity(details.len());
        let mut first_user_message: Option<String> = None;
        let mut earliest_user_msg_time: i64 = 0;
        for detail in details {
            if start_time == 0 || detail.start_time < start_time {
                start_time = detail.start_time;
            }
            if detail.end_time > end_time {
                end_time = detail.end_time;
            }
            usage_input += detail.gen_ai_usage_input_tokens;
            usage_output += detail.gen_ai_usage_output_tokens;
            usage_total += detail.gen_ai_usage_total_tokens;
            cost_total += detail.gen_ai_usage_cost;
            cache_read_tokens += detail.gen_ai_usage_cache_read_input_tokens;
            cache_creation_tokens += detail.gen_ai_usage_cache_creation_input_tokens;
            cost_cache_read += detail.gen_ai_usage_cost_cache_read_input;
            cost_cache_creation += detail.gen_ai_usage_cost_cache_creation_input;
            cost_estimated_without_cache += detail.gen_ai_usage_cost_estimated_without_cache;
            cost_cache_read_savings += detail.gen_ai_usage_cost_cache_read_savings;
            cost_net_cache_impact += detail.gen_ai_usage_cost_net_cache_impact;
            error_count += detail.error_count;
            if let Some(ref uid) = detail.user_id {
                user_ids.insert(uid.clone());
            }
            if let Some(ref msg) = detail.first_user_message
                && (first_user_message.is_none()
                    || (detail.start_time != 0 && detail.start_time < earliest_user_msg_time)
                    || earliest_user_msg_time == 0)
            {
                first_user_message = Some(msg.clone());
                earliest_user_msg_time = detail.start_time;
            }
        }
        let duration = if end_time > start_time {
            end_time - start_time
        } else {
            0
        };
        // HashSet → Vec produces non-deterministic order; sort so callers
        // (and tests) see a stable result.
        let mut user_ids: Vec<String> = user_ids.into_iter().collect();
        user_ids.sort();
        SessionDetails {
            session_id,
            start_time,
            end_time,
            duration,
            trace_count: trace_count as u16,
            gen_ai_usage_input_tokens: usage_input,
            gen_ai_usage_output_tokens: usage_output,
            gen_ai_usage_total_tokens: usage_total,
            gen_ai_usage_cost: cost_total,
            gen_ai_usage_cache_read_input_tokens: cache_read_tokens,
            gen_ai_usage_cache_creation_input_tokens: cache_creation_tokens,
            gen_ai_usage_cost_cache_read_input: cost_cache_read,
            gen_ai_usage_cost_cache_creation_input: cost_cache_creation,
            gen_ai_usage_cost_estimated_without_cache: cost_estimated_without_cache,
            gen_ai_usage_cost_cache_read_savings: cost_cache_read_savings,
            gen_ai_usage_cost_net_cache_impact: cost_net_cache_impact,
            error_count,
            user_ids,
            first_user_message,
        }
    }
}

fn parse_session_trace_ids(
    hits: &[json::Value],
    session_id_col: &str,
) -> (Vec<String>, HashMap<String, Vec<String>>) {
    let mut session_trace_ids: HashMap<String, Vec<String>> = HashMap::with_capacity(hits.len());
    let mut session_ids: Vec<String> = Vec::with_capacity(hits.len());
    for item in hits {
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
    (session_ids, session_trace_ids)
}

fn aggregate_sessions(
    session_ids: &[String],
    session_trace_ids: &HashMap<String, Vec<String>>,
    trace_details: &HashMap<String, TraceDetail>,
) -> Vec<SessionDetails> {
    let mut sessions_data: Vec<SessionDetails> = Vec::with_capacity(session_ids.len());
    for session_id in session_ids {
        let trace_ids = match session_trace_ids.get(session_id) {
            Some(ids) => ids,
            None => continue,
        };
        let details: Vec<TraceDetail> = trace_ids
            .iter()
            .filter_map(|tid| trace_details.get(tid).cloned())
            .collect();
        sessions_data.push(SessionDetails::from_trace_details(
            session_id.clone(),
            trace_ids.len(),
            &details,
        ));
    }
    sessions_data.sort_by_key(|k| std::cmp::Reverse(k.start_time));
    sessions_data
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
    fn test_parse_session_trace_ids_empty() {
        let (ids, map) = parse_session_trace_ids(&[], "gen_ai_conversation_id");
        assert!(ids.is_empty());
        assert!(map.is_empty());
    }

    #[test]
    fn test_parse_session_trace_ids_basic() {
        let hits = vec![
            json!({"gen_ai_conversation_id": "sess-1", "trace_ids": ["t1", "t2"]}),
            json!({"gen_ai_conversation_id": "sess-2", "trace_ids": ["t3"]}),
        ];
        let (ids, map) = parse_session_trace_ids(&hits, "gen_ai_conversation_id");
        assert_eq!(ids, vec!["sess-1", "sess-2"]);
        assert_eq!(
            map.get("sess-1").unwrap(),
            &vec!["t1".to_string(), "t2".to_string()]
        );
        assert_eq!(map.get("sess-2").unwrap(), &vec!["t3".to_string()]);
    }

    #[test]
    fn test_parse_session_trace_ids_skips_missing_col() {
        let hits = vec![
            json!({"other": "value"}),
            json!({"gen_ai_conversation_id": "sess-1", "trace_ids": ["t1"]}),
        ];
        let (ids, map) = parse_session_trace_ids(&hits, "gen_ai_conversation_id");
        assert_eq!(ids.len(), 1);
        assert!(map.contains_key("sess-1"));
    }

    #[test]
    fn test_parse_session_trace_ids_no_trace_ids_array() {
        let hits = vec![json!({"gen_ai_conversation_id": "sess-1"})];
        let (ids, map) = parse_session_trace_ids(&hits, "gen_ai_conversation_id");
        assert_eq!(ids, vec!["sess-1"]);
        assert!(map.get("sess-1").unwrap().is_empty());
    }

    #[test]
    fn test_aggregate_sessions_empty() {
        let result = aggregate_sessions(&[], &HashMap::new(), &HashMap::new());
        assert!(result.is_empty());
    }

    #[test]
    fn test_aggregate_sessions_single_session_two_traces() {
        let session_ids = vec!["sess-1".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert(
            "sess-1".to_string(),
            vec!["t1".to_string(), "t2".to_string()],
        );
        let mut trace_details = HashMap::new();
        trace_details.insert(
            "t1".to_string(),
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                gen_ai_usage_input_tokens: 100,
                gen_ai_usage_output_tokens: 50,
                gen_ai_usage_total_tokens: 150,
                gen_ai_usage_cost: 0.01,
                error_count: 0,
                user_id: None,
                ..Default::default()
            },
        );
        trace_details.insert(
            "t2".to_string(),
            TraceDetail {
                start_time: 1500,
                end_time: 3000,
                gen_ai_usage_input_tokens: 200,
                gen_ai_usage_output_tokens: 100,
                gen_ai_usage_total_tokens: 300,
                gen_ai_usage_cost: 0.02,
                error_count: 0,
                user_id: None,
                ..Default::default()
            },
        );

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);
        assert_eq!(result.len(), 1);
        let s = &result[0];
        assert_eq!(s.session_id, "sess-1");
        assert_eq!(s.start_time, 1000);
        assert_eq!(s.end_time, 3000);
        assert_eq!(s.duration, 2000);
        assert_eq!(s.trace_count, 2);
        assert_eq!(s.gen_ai_usage_input_tokens, 300);
        assert_eq!(s.gen_ai_usage_output_tokens, 150);
        assert_eq!(s.gen_ai_usage_total_tokens, 450);
        assert!((s.gen_ai_usage_cost - 0.03).abs() < 1e-10);
        assert_eq!(s.error_count, 0);
    }

    #[test]
    fn test_aggregate_sessions_sorted_descending_by_start_time() {
        let session_ids = vec!["sess-1".to_string(), "sess-2".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert("sess-1".to_string(), vec!["t1".to_string()]);
        session_trace_ids.insert("sess-2".to_string(), vec!["t2".to_string()]);
        let mut trace_details = HashMap::new();
        trace_details.insert(
            "t1".to_string(),
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                gen_ai_usage_input_tokens: 0,
                gen_ai_usage_output_tokens: 0,
                gen_ai_usage_total_tokens: 0,
                gen_ai_usage_cost: 0.0,
                error_count: 0,
                user_id: None,
                ..Default::default()
            },
        );
        trace_details.insert(
            "t2".to_string(),
            TraceDetail {
                start_time: 5000,
                end_time: 6000,
                gen_ai_usage_input_tokens: 0,
                gen_ai_usage_output_tokens: 0,
                gen_ai_usage_total_tokens: 0,
                gen_ai_usage_cost: 0.0,
                error_count: 0,
                user_id: None,
                ..Default::default()
            },
        );

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);
        assert_eq!(result.len(), 2);
        assert!(result[0].start_time >= result[1].start_time);
    }

    #[test]
    fn test_aggregate_sessions_missing_trace_detail() {
        let session_ids = vec!["sess-1".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert("sess-1".to_string(), vec!["missing".to_string()]);

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &HashMap::new());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_time, 0);
        assert_eq!(result[0].trace_count, 1);
        assert_eq!(result[0].duration, 0);
    }

    #[test]
    fn test_aggregate_sessions_duration_zero_when_times_equal() {
        let session_ids = vec!["sess-1".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert("sess-1".to_string(), vec!["t1".to_string()]);
        let mut trace_details = HashMap::new();
        trace_details.insert(
            "t1".to_string(),
            TraceDetail {
                start_time: 1000,
                end_time: 1000,
                gen_ai_usage_input_tokens: 0,
                gen_ai_usage_output_tokens: 0,
                gen_ai_usage_total_tokens: 0,
                gen_ai_usage_cost: 0.0,
                error_count: 0,
                user_id: None,
                ..Default::default()
            },
        );

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);
        assert_eq!(result[0].duration, 0);
    }

    #[test]
    fn test_aggregate_sessions_start_time_uses_earliest() {
        let session_ids = vec!["sess-1".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert(
            "sess-1".to_string(),
            vec!["t1".to_string(), "t2".to_string(), "t3".to_string()],
        );
        let mut trace_details = HashMap::new();
        for (id, start) in [("t1", 500i64), ("t2", 100i64), ("t3", 300i64)] {
            trace_details.insert(
                id.to_string(),
                TraceDetail {
                    start_time: start,
                    end_time: start + 100,
                    gen_ai_usage_input_tokens: 0,
                    gen_ai_usage_output_tokens: 0,
                    gen_ai_usage_total_tokens: 0,
                    gen_ai_usage_cost: 0.0,
                    error_count: 0,
                    user_id: None,
                    ..Default::default()
                },
            );
        }

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);
        assert_eq!(result[0].start_time, 100);
        assert_eq!(result[0].end_time, 600); // max(500+100, 100+100, 300+100)
    }

    #[test]
    fn test_aggregate_sessions_error_count_across_traces() {
        let session_ids = vec!["sess-1".to_string()];
        let mut session_trace_ids = HashMap::new();
        session_trace_ids.insert(
            "sess-1".to_string(),
            vec!["t1".to_string(), "t2".to_string()],
        );
        let mut trace_details = HashMap::new();
        trace_details.insert(
            "t1".to_string(),
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                gen_ai_usage_input_tokens: 0,
                gen_ai_usage_output_tokens: 0,
                gen_ai_usage_total_tokens: 0,
                gen_ai_usage_cost: 0.0,
                error_count: 3,
                user_id: None,
                ..Default::default()
            },
        );
        trace_details.insert(
            "t2".to_string(),
            TraceDetail {
                start_time: 1500,
                end_time: 3000,
                gen_ai_usage_input_tokens: 0,
                gen_ai_usage_output_tokens: 0,
                gen_ai_usage_total_tokens: 0,
                gen_ai_usage_cost: 0.0,
                error_count: 2,
                user_id: None,
                ..Default::default()
            },
        );

        let result = aggregate_sessions(&session_ids, &session_trace_ids, &trace_details);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].error_count, 5);
    }

    #[test]
    fn test_from_trace_details_empty() {
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 0, &[]);
        assert_eq!(session.session_id, "sess-1");
        assert_eq!(session.start_time, 0);
        assert_eq!(session.end_time, 0);
        assert_eq!(session.duration, 0);
        assert_eq!(session.trace_count, 0);
        assert_eq!(session.gen_ai_usage_input_tokens, 0);
        assert_eq!(session.gen_ai_usage_output_tokens, 0);
        assert_eq!(session.gen_ai_usage_total_tokens, 0);
        assert_eq!(session.gen_ai_usage_cost, 0.0);
        assert_eq!(session.error_count, 0);
        assert!(session.user_ids.is_empty());
        assert!(session.first_user_message.is_none());
    }

    #[test]
    fn test_from_trace_details_single_trace() {
        let details = vec![TraceDetail {
            start_time: 1000,
            end_time: 2000,
            gen_ai_usage_input_tokens: 10,
            gen_ai_usage_output_tokens: 20,
            gen_ai_usage_total_tokens: 30,
            gen_ai_usage_cost: 0.05,
            error_count: 1,
            ..Default::default()
        }];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 1, &details);
        assert_eq!(session.session_id, "sess-1");
        assert_eq!(session.start_time, 1000);
        assert_eq!(session.end_time, 2000);
        assert_eq!(session.duration, 1000);
        assert_eq!(session.trace_count, 1);
        assert_eq!(session.gen_ai_usage_input_tokens, 10);
        assert_eq!(session.gen_ai_usage_output_tokens, 20);
        assert_eq!(session.gen_ai_usage_total_tokens, 30);
        assert!((session.gen_ai_usage_cost - 0.05).abs() < 1e-10);
        assert_eq!(session.error_count, 1);
    }

    #[test]
    fn test_from_trace_details_with_user_ids() {
        let details = vec![
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                user_id: Some("user-a".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 1500,
                end_time: 3000,
                user_id: Some("user-b".to_string()),
                ..Default::default()
            },
        ];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 2, &details);
        assert_eq!(session.trace_count, 2);
        assert_eq!(session.start_time, 1000);
        assert_eq!(session.end_time, 3000);
        assert_eq!(session.user_ids, vec!["user-a", "user-b"]);
    }

    #[test]
    fn test_from_trace_details_user_ids_sorted() {
        // user_ids are collected into a HashSet; ensure the final Vec is sorted
        // so output is deterministic regardless of hash iteration order.
        let details: Vec<TraceDetail> = ["zeta", "alpha", "mike", "bravo"]
            .iter()
            .enumerate()
            .map(|(i, uid)| TraceDetail {
                start_time: 1000 + i as i64,
                end_time: 2000 + i as i64,
                user_id: Some((*uid).to_string()),
                ..Default::default()
            })
            .collect();
        let session =
            SessionDetails::from_trace_details("sess-1".to_string(), details.len(), &details);
        assert_eq!(session.user_ids, vec!["alpha", "bravo", "mike", "zeta"]);
    }

    #[test]
    fn test_from_trace_details_user_ids_deduplicated() {
        let details = vec![
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                user_id: Some("user-a".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 1500,
                end_time: 3000,
                user_id: Some("user-a".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 2000,
                end_time: 4000,
                user_id: Some("user-b".to_string()),
                ..Default::default()
            },
        ];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 3, &details);
        assert_eq!(session.user_ids, vec!["user-a", "user-b"]);
    }

    #[test]
    fn test_from_trace_details_skips_none_user_ids() {
        let details = vec![
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                user_id: Some("user-a".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 1500,
                end_time: 3000,
                user_id: None,
                ..Default::default()
            },
        ];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 2, &details);
        assert_eq!(session.user_ids, vec!["user-a"]);
    }

    #[test]
    fn test_from_trace_details_trace_count_independent_of_details_len() {
        let details = vec![];
        // trace_count can be larger than details.len() (e.g. traces not found in DB)
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 5, &details);
        assert_eq!(session.trace_count, 5);
        assert_eq!(session.start_time, 0);
        assert_eq!(session.end_time, 0);
    }

    #[test]
    fn test_from_trace_details_first_user_message_from_earliest_trace() {
        let details = vec![
            TraceDetail {
                start_time: 2000,
                end_time: 3000,
                first_user_message: Some("what is the weather".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 1000, // earliest
                end_time: 2000,
                first_user_message: Some("hello".to_string()),
                ..Default::default()
            },
        ];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 2, &details);
        assert_eq!(session.first_user_message, Some("hello".to_string()));
    }

    #[test]
    fn test_from_trace_details_first_user_message_skips_zero_start_time() {
        let details = vec![
            TraceDetail {
                start_time: 0, // no start_time, skipped
                end_time: 2000,
                first_user_message: Some("zero time msg".to_string()),
                ..Default::default()
            },
            TraceDetail {
                start_time: 1000,
                end_time: 2000,
                first_user_message: Some("real msg".to_string()),
                ..Default::default()
            },
        ];
        let session = SessionDetails::from_trace_details("sess-1".to_string(), 2, &details);
        assert_eq!(session.first_user_message, Some("real msg".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_basic() {
        let messages = json::json!([
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hello, how are you doing today?"},
            {"role": "assistant", "content": "I'm fine, thanks!"}
        ]);
        let result = extract_first_user_message(Some(&messages), 30);
        assert_eq!(result, Some("Hello, how are you doing today".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_trim_to_length() {
        let messages = json::json!([
            {"role": "user", "content": "short"}
        ]);
        let result = extract_first_user_message(Some(&messages), 30);
        assert_eq!(result, Some("short".to_string()));
    }

    #[test]
    fn test_extract_first_user_message_empty() {
        assert_eq!(extract_first_user_message(None, 30), None);
        assert_eq!(extract_first_user_message(Some(&json::json!([])), 30), None);
        assert_eq!(
            extract_first_user_message(
                Some(&json::json!([{"role": "assistant", "content": "hi"}])),
                30
            ),
            None
        );
    }

    #[test]
    fn test_extract_first_user_message_case_insensitive_role() {
        let messages = json::json!([
            {"role": "User", "content": "Hello"}
        ]);
        let result = extract_first_user_message(Some(&messages), 30);
        assert_eq!(result, Some("Hello".to_string()));
    }
}

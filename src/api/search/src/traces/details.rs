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

use axum::{
    Json,
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::{
    get_config,
    meta::{
        search::{Query, Request, RequestEncoding, Response as SearchResponse, SearchEventType},
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use tracing::{Instrument, Span};

use super::time_index::{check_stream_permission, parse_optional_time_range, union_ranges};
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id},
    search::error_utils::map_error_to_http_response,
};

/// GetTraceDetails
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/{trace_id}/details",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetTraceDetails",
    summary = "Get all spans for a trace",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Traces stream name"),
        ("trace_id" = String, Path, description = "Trace ID"),
        ("start_time" = Option<i64>, Query, description = "Caller range start in microseconds"),
        ("end_time" = Option<i64>, Query, description = "Caller range end in microseconds"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds"),
    ),
    responses(
        (status = 200, description = "Success", body = SearchResponse),
        (status = 400, description = "Invalid time range"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn get_trace_details(
    Path((org_id, stream_name, trace_id)): Path<(String, String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let caller_range = match parse_optional_time_range(&params) {
        Ok(range) => range,
        Err(response) => return response,
    };
    let hint_ts = match params.get("hint_ts") {
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
    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let index_range = match super::time_index::query(&org_id, &stream_name, &trace_id, hint_ts)
        .await
    {
        Ok(range) => range,
        Err(e) => {
            log::error!(
                "[trace_id {request_trace_id}] trace time index query failed for {org_id}/{stream_name}: {e}"
            );
            None
        }
    };
    let effective_range = match union_ranges(caller_range, index_range) {
        Some(range) => range,
        None => {
            return MetaHttpResponse::bad_request(
                "A caller time range is required when the trace time index has no result",
            );
        }
    };

    let timeout = match params.get("timeout") {
        Some(value) => match value.parse::<i64>() {
            Ok(value) if value > 0 => value,
            _ => return MetaHttpResponse::bad_request("Invalid timeout parameter"),
        },
        None => get_config().limit.query_timeout as i64,
    };
    let request = Request {
        query: Query {
            sql: format!(
                "SELECT * FROM {} WHERE trace_id = {} ORDER BY start_time",
                quote_identifier(&stream_name),
                quote_sql_string(&trace_id),
            ),
            from: 0,
            size: 50_000,
            start_time: effective_range.start_time,
            end_time: effective_range.end_time.saturating_add(1),
            quick_mode: false,
            query_type: String::new(),
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
        encoding: RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout,
        search_type: Some(SearchEventType::UI),
        search_event_context: None,
        use_cache: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let response = SearchService::cache::search(
        &request_trace_id,
        &org_id,
        StreamType::Traces,
        Some(user_email.user_id),
        &request,
        String::new(),
        false,
        None,
        false,
    )
    .instrument(http_span)
    .await;
    let mut response = match response {
        Ok(response) => response,
        Err(error) => return map_error_to_http_response(&error, Some(request_trace_id)),
    };
    response
        .new_start_time
        .get_or_insert(effective_range.start_time);
    response
        .new_end_time
        .get_or_insert(effective_range.end_time);
    Json(response).into_response()
}

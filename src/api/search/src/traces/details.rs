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
use serde::Serialize;
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use super::time_index::{check_stream_permission, parse_optional_time_range, union_ranges};
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id},
    search::error_utils::map_error_to_http_response,
};

/// Largest page, and the default when `size` is absent.
const MAX_PAGE_SIZE: usize = 50_000;

/// Keyset cursor; `start_time` is a string because 19-digit ns lose precision as JSON numbers.
#[derive(Debug, PartialEq, Serialize, ToSchema)]
struct TraceDetailsCursor {
    start_time: String,
    span_id: String,
}

#[derive(Serialize, ToSchema)]
struct TraceDetailsResponse {
    #[serde(flatten)]
    response: SearchResponse,
    /// More spans follow this page.
    has_more: bool,
    /// Send back as `after_start_time` and `after_span_id` to fetch the next page.
    next_after: Option<TraceDetailsCursor>,
}

/// Spans of one trace in `(start_time, span_id)` order, a total order, after the optional cursor.
fn details_sql(stream: &str, trace_id: &str, after: Option<(u64, &str)>) -> String {
    let cursor = after
        .map(|(start, span_id)| {
            let span_id = quote_sql_string(span_id);
            format!(" AND (start_time > {start} OR (start_time = {start} AND span_id > {span_id}))")
        })
        .unwrap_or_default();
    format!(
        "SELECT * FROM {} WHERE trace_id = {}{cursor} ORDER BY start_time, span_id",
        quote_identifier(stream),
        quote_sql_string(trace_id),
    )
}

/// Page size (clamped to 1..=50,000) and the keyset cursor, which needs both of its params.
fn parse_page(
    params: &HashMap<String, String>,
) -> Result<(usize, Option<(u64, String)>), Response> {
    let size = match params.get("size") {
        Some(value) => match value.parse::<i64>() {
            Ok(value) => value.clamp(1, MAX_PAGE_SIZE as i64) as usize,
            Err(_) => return Err(MetaHttpResponse::bad_request("Invalid size parameter")),
        },
        None => MAX_PAGE_SIZE,
    };
    let after = match (params.get("after_start_time"), params.get("after_span_id")) {
        (None, None) => None,
        (Some(start), Some(span_id)) => match start.parse::<u64>() {
            Ok(start) => Some((start, span_id.clone())),
            Err(_) => {
                return Err(MetaHttpResponse::bad_request(
                    "Invalid after_start_time parameter",
                ));
            }
        },
        _ => {
            return Err(MetaHttpResponse::bad_request(
                "after_start_time and after_span_id must be given together",
            ));
        }
    };
    Ok((size, after))
}

/// Exact `start_time` as an integer; an f64 merges ns timestamps into 256 ns buckets.
fn start_key(hit: &serde_json::Value) -> Option<u64> {
    match &hit["start_time"] {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Rows without a usable start_time sort last, where they end paging instead of a page's middle.
fn order_key(hit: &serde_json::Value) -> (u64, Option<String>) {
    (
        start_key(hit).unwrap_or(u64::MAX),
        hit["span_id"].as_str().map(str::to_owned),
    )
}

/// Drops the `size + 1` sentinel row; `total` is the fetched count, as total hits are untracked.
fn split_page(mut response: SearchResponse, size: usize) -> TraceDetailsResponse {
    // The cache re-sorts hits through f64, so restore the exact (start_time, span_id) order first.
    response.hits.sort_by_cached_key(order_key);
    let more = response.hits.len() > size;
    response.hits.truncate(size);
    response.size = response.hits.len() as i64;
    response.total = response.hits.len();
    let next_after = more
        .then(|| response.hits.last())
        .flatten()
        .and_then(|last| {
            Some(TraceDetailsCursor {
                start_time: start_key(last)?.to_string(),
                span_id: last["span_id"].as_str()?.to_string(),
            })
        });
    if more && next_after.is_none() {
        log::warn!(
            "[TRACE DETAILS] last span of a page has no usable start_time/span_id; paging stops"
        );
        response.is_partial = true;
    }
    TraceDetailsResponse {
        response,
        has_more: next_after.is_some(),
        next_after,
    }
}

/// The page query, `size + 1` rows; it bypasses the result cache, whose merge sorts through f64.
fn details_request(sql: String, size: usize, range: (i64, i64), timeout: i64) -> Request {
    Request {
        query: Query {
            sql,
            from: 0,
            size: size as i64 + 1,
            start_time: range.0,
            end_time: range.1.saturating_add(1),
            quick_mode: false,
            query_type: String::new(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
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
        use_cache: false,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    }
}

/// GetTraceDetails
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/{trace_id}/details",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetTraceDetails",
    summary = "Get a page of spans for a trace",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Traces stream name"),
        ("trace_id" = String, Path, description = "Trace ID"),
        ("start_time" = Option<i64>, Query, description = "Caller range start in microseconds"),
        ("end_time" = Option<i64>, Query, description = "Caller range end in microseconds"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds"),
        ("size" = Option<i64>, Query, description = "Spans per page (default 50000); values outside 1 to 50000 are clamped"),
        ("after_start_time" = Option<String>, Query, description = "Keyset cursor: start_time (ns, decimal) of the last span of the previous page; needs after_span_id"),
        ("after_span_id" = Option<String>, Query, description = "Keyset cursor: span_id of the last span of the previous page; needs after_start_time"),
    ),
    responses(
        (status = 200, description = "Success; has_more and next_after page the trace", body = TraceDetailsResponse),
        (status = 400, description = "Invalid time range or page parameters"),
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
    let (size, after) = match parse_page(&params) {
        Ok(page) => page,
        Err(response) => return response,
    };
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
    let request = details_request(
        details_sql(
            &stream_name,
            &trace_id,
            after
                .as_ref()
                .map(|(start, span_id)| (*start, span_id.as_str())),
        ),
        size,
        (effective_range.start_time, effective_range.end_time),
        timeout,
    );
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
    Json(split_page(response, size)).into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;

    use super::*;

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn hit(start_time: u64, span_id: &str) -> serde_json::Value {
        json!({"start_time": start_time, "span_id": span_id})
    }

    fn search_response(hits: Vec<serde_json::Value>) -> SearchResponse {
        let mut response = SearchResponse::new(0, hits.len() as i64);
        response.total = hits.len();
        response.hits = hits;
        response
    }

    #[test]
    fn test_details_sql_without_and_with_cursor() {
        assert_eq!(
            details_sql("default", "abc", None),
            r#"SELECT * FROM "default" WHERE trace_id = 'abc' ORDER BY start_time, span_id"#
        );
        assert_eq!(
            details_sql(
                "my\"stream",
                "t'1",
                Some((1_700_000_000_000_000_001, "s'1"))
            ),
            "SELECT * FROM \"my\"\"stream\" WHERE trace_id = 't''1' AND (start_time > 1700000000000000001 OR (start_time = 1700000000000000001 AND span_id > 's''1')) ORDER BY start_time, span_id"
        );
    }

    #[test]
    fn test_page_size_defaults_and_clamps() {
        assert_eq!(parse_page(&params(&[])).unwrap(), (MAX_PAGE_SIZE, None));
        assert_eq!(parse_page(&params(&[("size", "10")])).unwrap().0, 10);
        assert_eq!(parse_page(&params(&[("size", "0")])).unwrap().0, 1);
        assert_eq!(parse_page(&params(&[("size", "-3")])).unwrap().0, 1);
        assert_eq!(
            parse_page(&params(&[("size", "50001")])).unwrap().0,
            MAX_PAGE_SIZE
        );
        assert_eq!(MAX_PAGE_SIZE, 50_000);
        assert_eq!(
            parse_page(&params(&[("size", "ten")]))
                .unwrap_err()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_cursor_needs_both_params() {
        let cursor = params(&[("after_start_time", "17"), ("after_span_id", "ab")]);
        assert_eq!(
            parse_page(&cursor).unwrap(),
            (MAX_PAGE_SIZE, Some((17, "ab".to_string())))
        );
        for one in [
            params(&[("after_start_time", "17")]),
            params(&[("after_span_id", "ab")]),
            params(&[("after_start_time", "x"), ("after_span_id", "ab")]),
        ] {
            assert_eq!(
                parse_page(&one).unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
    }

    #[test]
    fn test_split_page_with_a_sentinel_row() {
        let hits = vec![hit(1, "a"), hit(2, "b"), hit(2, "c")];
        let page = split_page(search_response(hits), 2);
        assert!(page.has_more);
        assert_eq!(page.response.hits.len(), 2);
        assert_eq!(page.response.total, 2);
        assert_eq!(page.response.size, 2);
        let value = serde_json::to_value(&page).unwrap();
        assert_eq!(value["has_more"], true);
        assert_eq!(
            value["next_after"],
            json!({"start_time": "2", "span_id": "b"})
        );
        assert_eq!(value["total"], 2);
        assert_eq!(value["hits"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_split_page_without_more_rows() {
        for n in [0, 1, 2] {
            let hits = (0..n).map(|i| hit(i, "a")).collect();
            let page = split_page(search_response(hits), 2);
            assert!(!page.has_more);
            assert!(page.next_after.is_none());
            assert_eq!(page.response.hits.len(), n as usize);
            assert_eq!(page.response.total, n as usize);
            assert_eq!(page.response.size, n as i64);
            let value = serde_json::to_value(&page).unwrap();
            assert_eq!(value["has_more"], false);
            assert!(value["next_after"].is_null());
        }
    }

    #[test]
    fn test_cursor_keeps_ns_precision() {
        let hits = vec![
            hit(1_759_000_000_123_456_789, "a"),
            hit(1_759_000_000_123_456_790, "b"),
        ];
        let page = split_page(search_response(hits), 1);
        assert_eq!(
            serde_json::to_value(&page).unwrap()["next_after"]["start_time"],
            "1759000000123456789"
        );
    }

    #[test]
    fn test_split_page_sorts_exactly_before_dropping_the_sentinel() {
        // As f64 these start_times are equal, so the cache's re-sort can put B before A by span_id.
        let a = hit(1_759_000_000_123_456_769, "b");
        let b = hit(1_759_000_000_123_456_770, "a");
        let page = split_page(search_response(vec![b.clone(), a.clone()]), 1);
        assert_eq!(page.response.hits, vec![a]);
        let value = serde_json::to_value(&page).unwrap();
        assert_eq!(
            value["next_after"],
            json!({"start_time": "1759000000123456769", "span_id": "b"})
        );
        let page = split_page(
            search_response(vec![
                json!({"start_time": "5", "span_id": "y"}),
                json!({"start_time": "5", "span_id": "x"}),
                hit(9, "z"),
            ]),
            1,
        );
        assert_eq!(page.response.hits[0]["span_id"], "x");
        assert_eq!(
            serde_json::to_value(&page).unwrap()["next_after"],
            json!({"start_time": "5", "span_id": "x"})
        );
    }

    #[test]
    fn test_split_page_orders_a_crowded_f64_bucket_exactly() {
        // Five spans in one 256 ns f64 bucket, in the span_id order an f64 sort leaves them.
        let base = 1_759_000_000_123_456_768u64;
        let hits = ["a", "b", "c", "d", "e"]
            .iter()
            .enumerate()
            .map(|(i, id)| hit(base + 4 - i as u64, id))
            .collect();
        let page = split_page(search_response(hits), 2);
        let ids: Vec<&str> = page
            .response
            .hits
            .iter()
            .map(|h| h["span_id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["e", "d"]);
        assert_eq!(page.next_after.unwrap().span_id, "d");
    }

    #[test]
    fn test_details_request_bypasses_the_result_cache() {
        // A cache merge re-sorts through f64 and truncates, which can drop an earlier span.
        let request = details_request("SELECT 1".to_string(), 10, (1, 2), 30);
        assert!(!request.use_cache);
        assert_eq!(request.query.size, 11);
        assert_eq!(request.query.from, 0);
        assert_eq!((request.query.start_time, request.query.end_time), (1, 3));
        assert_eq!(request.timeout, 30);
    }

    #[test]
    fn test_split_page_stops_paging_without_a_usable_cursor() {
        for last in [
            json!({"span_id": "a"}),
            json!({"start_time": null, "span_id": "a"}),
            json!({"start_time": "", "span_id": "a"}),
            json!({"start_time": 1.5, "span_id": "a"}),
            json!({"start_time": 1}),
            json!({"start_time": 1, "span_id": 7}),
        ] {
            // The unusable row sorts last, so a size of 2 keeps it as the page's last row.
            let page = split_page(
                search_response(vec![hit(0, "a"), last.clone(), hit(u64::MAX, "z")]),
                2,
            );
            assert!(!page.has_more, "{last}");
            assert!(page.next_after.is_none(), "{last}");
            assert!(page.response.is_partial, "{last}");
        }
    }

    #[test]
    fn test_split_page_keeps_partial_and_function_error() {
        let mut response = search_response(vec![hit(1, "a")]);
        response.is_partial = true;
        response.function_error = vec!["shard timed out".to_string()];
        let value = serde_json::to_value(split_page(response, 10)).unwrap();
        assert_eq!(value["is_partial"], true);
        assert_eq!(value["function_error"], json!(["shard timed out"]));
        assert_eq!(value["has_more"], false);
    }
}

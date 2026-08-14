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

use std::{collections::HashSet, time::Duration};

use axum::{
    Json,
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::{
    get_config,
    meta::{
        search::{Query, Request, RequestEncoding, SearchEventType},
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
    utils::{json, time::now_micros, util::get_trace_time_index_stream_name},
};
use hashbrown::HashMap;
use infra::errors::{Error, Result};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use serde::Serialize;
use tokio::time::Instant;
use utoipa::ToSchema;

use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

const EXPAND_WINDOW: i64 = 24 * 60 * 60 * 1_000_000;
const DAY_MICROS: i64 = 24 * 60 * 60 * 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub struct TraceTimeRange {
    pub start_time: i64,
    pub end_time: i64,
}

impl TraceTimeRange {
    fn merge(self, other: Self) -> Self {
        Self {
            start_time: self.start_time.min(other.start_time),
            end_time: self.end_time.max(other.end_time),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TraceTimeRangeResponse {
    pub stream: String,
    pub trace_id: String,
    pub range: Option<TraceTimeRange>,
}

#[derive(Clone, Copy, Debug)]
struct CoveredRange {
    start: i64,
    end: i64,
}

#[derive(Default)]
struct TimerStats {
    locate_rounds: u64,
    expand_rounds: u64,
    timed_out: bool,
}

struct TimerContext<'a> {
    org_id: &'a str,
    index_stream: &'a str,
    trace_id: &'a str,
    query_start: i64,
    query_end: i64,
    deadline: Instant,
}

enum WindowResult {
    Hit(TraceTimeRange),
    Miss,
    TimedOut,
}

fn locate_batch_sizes() -> impl Iterator<Item = i64> {
    [1, 2, 7, 14, 28]
        .into_iter()
        .chain(std::iter::successors(Some(56_i64), |days| {
            Some(days.saturating_mul(2))
        }))
        .map(|days| days.saturating_mul(DAY_MICROS))
}

fn probe_range(candidate: i64, query_start: i64, query_end: i64) -> CoveredRange {
    CoveredRange {
        start: candidate.saturating_sub(EXPAND_WINDOW).max(query_start),
        end: candidate.saturating_add(EXPAND_WINDOW).min(query_end),
    }
}

async fn query_window(
    org_id: &str,
    index_stream: &str,
    trace_id: &str,
    start_time: i64,
    end_time: i64,
    deadline: Instant,
) -> Result<WindowResult> {
    if start_time >= end_time {
        return Ok(WindowResult::Miss);
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Ok(WindowResult::TimedOut);
    }

    let sql = format!(
        "SELECT MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts FROM {} WHERE trace_id = {}",
        quote_identifier(index_stream),
        quote_sql_string(trace_id),
    );
    let request = Request {
        query: Query {
            sql,
            from: 0,
            size: 1,
            start_time,
            // Timer windows use closed endpoints; search ranges are half-open.
            end_time: end_time.saturating_add(1),
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
        timeout: remaining.as_secs().max(1) as i64,
        search_type: Some(SearchEventType::UI),
        search_event_context: None,
        use_cache: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let internal_trace_id = config::ider::generate_trace_id();
    let search = SearchService::cache::search(
        &internal_trace_id,
        org_id,
        StreamType::Metadata,
        None,
        &request,
        String::new(),
        false,
        None,
        false,
    );
    let response = match tokio::time::timeout(remaining, search).await {
        Ok(response) => {
            response.map_err(|e| Error::Message(format!("query trace time index: {e}")))?
        }
        Err(_) => return Ok(WindowResult::TimedOut),
    };
    let Some(hit) = response.hits.first() else {
        return Ok(WindowResult::Miss);
    };
    let Some(min_ts) = hit.get("min_ts").map(json::get_int_value) else {
        return Ok(WindowResult::Miss);
    };
    let Some(max_ts) = hit.get("max_ts").map(json::get_int_value) else {
        return Ok(WindowResult::Miss);
    };
    Ok(WindowResult::Hit(TraceTimeRange {
        start_time: min_ts,
        end_time: max_ts,
    }))
}

async fn locate(
    context: &TimerContext<'_>,
    hint_ts: Option<i64>,
    stats: &mut TimerStats,
) -> Result<Option<(TraceTimeRange, CoveredRange)>> {
    let mut candidates = Vec::with_capacity(2);
    if let Some(hint) = hint_ts {
        candidates.push(hint);
    }
    if let Some(uuid_time) = config::ider::get_start_time_from_trace_id(context.trace_id) {
        candidates.push(uuid_time);
    }
    let mut seen = HashSet::new();
    for candidate in candidates {
        if !seen.insert(candidate) {
            continue;
        }
        let CoveredRange { start, end } =
            probe_range(candidate, context.query_start, context.query_end);
        stats.locate_rounds += 1;
        match query_window(
            context.org_id,
            context.index_stream,
            context.trace_id,
            start,
            end,
            context.deadline,
        )
        .await?
        {
            WindowResult::Hit(range) => {
                return Ok(Some((range, CoveredRange { start, end })));
            }
            WindowResult::Miss => {}
            WindowResult::TimedOut => {
                stats.timed_out = true;
                return Ok(None);
            }
        }
    }

    let mut cursor = context.query_end;
    for batch_size in locate_batch_sizes() {
        if cursor <= context.query_start {
            break;
        }
        let start = cursor.saturating_sub(batch_size).max(context.query_start);
        stats.locate_rounds += 1;
        match query_window(
            context.org_id,
            context.index_stream,
            context.trace_id,
            start,
            cursor,
            context.deadline,
        )
        .await?
        {
            WindowResult::Hit(range) => {
                return Ok(Some((range, CoveredRange { start, end: cursor })));
            }
            WindowResult::Miss => cursor = start,
            WindowResult::TimedOut => {
                stats.timed_out = true;
                return Ok(None);
            }
        }
    }
    Ok(None)
}

async fn expand(
    context: &TimerContext<'_>,
    mut range: TraceTimeRange,
    mut covered: CoveredRange,
    stats: &mut TimerStats,
) -> Result<TraceTimeRange> {
    // expand left
    loop {
        let target = range
            .start_time
            .saturating_sub(EXPAND_WINDOW)
            .max(context.query_start);
        if target >= covered.start {
            break;
        }
        stats.expand_rounds += 1;
        match query_window(
            context.org_id,
            context.index_stream,
            context.trace_id,
            target,
            covered.start,
            context.deadline,
        )
        .await?
        {
            WindowResult::Hit(found) => range = range.merge(found),
            WindowResult::Miss => {}
            WindowResult::TimedOut => {
                stats.timed_out = true;
                return Ok(range);
            }
        }
        covered.start = target;
    }

    // expand right
    loop {
        let target = range
            .end_time
            .saturating_add(EXPAND_WINDOW)
            .min(context.query_end);
        if target <= covered.end {
            break;
        }
        stats.expand_rounds += 1;
        match query_window(
            context.org_id,
            context.index_stream,
            context.trace_id,
            covered.end,
            target,
            context.deadline,
        )
        .await?
        {
            WindowResult::Hit(found) => range = range.merge(found),
            WindowResult::Miss => {}
            WindowResult::TimedOut => {
                stats.timed_out = true;
                return Ok(range);
            }
        }
        covered.end = target;
    }
    Ok(range)
}

pub async fn query(
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hint_ts: Option<i64>,
) -> Result<Option<TraceTimeRange>> {
    let started = std::time::Instant::now();
    let mut stats = TimerStats::default();
    let result = query_inner(org_id, stream_name, trace_id, hint_ts, &mut stats).await;
    let status = match &result {
        Ok(Some(_)) => "hit",
        Ok(None) => "miss",
        Err(_) => "error",
    };
    config::metrics::TRACE_TIME_INDEX_OPERATIONS
        .with_label_values(&[org_id, "query", status])
        .inc();
    if stats.timed_out {
        config::metrics::TRACE_TIME_INDEX_OPERATIONS
            .with_label_values(&[org_id, "query", "timeout"])
            .inc();
    }
    config::metrics::TRACE_TIME_INDEX_QUERY_DURATION
        .with_label_values(&[org_id, status])
        .observe(started.elapsed().as_secs_f64());
    config::metrics::TRACE_TIME_INDEX_QUERY_ROUNDS
        .with_label_values(&[org_id, "locate"])
        .observe(stats.locate_rounds as f64);
    config::metrics::TRACE_TIME_INDEX_QUERY_ROUNDS
        .with_label_values(&[org_id, "expand"])
        .observe(stats.expand_rounds as f64);
    result
}

async fn query_inner(
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hint_ts: Option<i64>,
    stats: &mut TimerStats,
) -> Result<Option<TraceTimeRange>> {
    let cfg = get_config();
    if !cfg.common.trace_time_index_enabled {
        return Ok(None);
    }

    let query_start = infra::db::trace_time_index::get_or_create_coverage_start()
        .await
        .map_err(|e| Error::Message(format!("read trace time index coverage marker: {e}")))?;
    let query_end = now_micros().saturating_add(cfg.limit.ingest_allowed_in_future_micro);
    if query_start >= query_end {
        return Ok(None);
    }
    let deadline = Instant::now() + Duration::from_secs(cfg.limit.query_timeout);
    let index_stream = get_trace_time_index_stream_name(stream_name);
    if !infra::schema::exists(org_id, StreamType::Metadata, &index_stream).await {
        return Ok(None);
    }
    let context = TimerContext {
        org_id,
        index_stream: &index_stream,
        trace_id,
        query_start,
        query_end,
        deadline,
    };
    let Some((range, covered)) = locate(&context, hint_ts, stats).await? else {
        return Ok(None);
    };
    expand(&context, range, covered, stats).await.map(Some)
}

pub(crate) async fn check_stream_permission(
    org_id: &str,
    stream_name: &str,
    user_id: &str,
) -> std::result::Result<(), Response> {
    #[cfg(feature = "enterprise")]
    if let Err(e) = search_service::check_search_allowed(org_id, Some(stream_name)) {
        return Err(MetaHttpResponse::too_many_requests(e.to_string()));
    }
    if let Some(response) = super::check_stream_permissions(org_id, stream_name, user_id).await {
        return Err(response);
    }
    Ok(())
}

/// GetTraceTimeRange
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/{trace_id}/time_range",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetTraceTimeRange",
    summary = "Get the indexed time range for a trace",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Traces stream name"),
        ("trace_id" = String, Path, description = "Trace ID"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
    ),
    responses(
        (status = 200, description = "Success", body = TraceTimeRangeResponse),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn get_trace_time_range(
    Path((org_id, stream_name, trace_id)): Path<(String, String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let hint_ts = match params.get("hint_ts") {
        Some(value) => match value.parse::<i64>() {
            Ok(value) => Some(value),
            Err(_) => return MetaHttpResponse::bad_request("Invalid hint_ts parameter"),
        },
        None => None,
    };
    let request_trace_id = get_or_create_trace_id(&headers, &tracing::Span::none());
    match query(&org_id, &stream_name, &trace_id, hint_ts).await {
        Ok(range) => Json(TraceTimeRangeResponse {
            stream: stream_name,
            trace_id,
            range,
        })
        .into_response(),
        Err(e) => {
            log::error!(
                "[trace_id {request_trace_id}] trace time index query failed for {org_id}/{stream_name}: {e}"
            );
            MetaHttpResponse::internal_error("Failed to query trace time index")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locate_batches_are_monotonic() {
        let batches = locate_batch_sizes().take(8).collect::<Vec<_>>();
        assert_eq!(batches[0], DAY_MICROS);
        assert!(batches.windows(2).all(|pair| pair[1] > pair[0]));
    }

    #[test]
    fn time_ranges_merge_outward() {
        let range = TraceTimeRange {
            start_time: 10,
            end_time: 20,
        }
        .merge(TraceTimeRange {
            start_time: 5,
            end_time: 30,
        });
        assert_eq!(range.start_time, 5);
        assert_eq!(range.end_time, 30);
    }

    #[test]
    fn probe_uses_expand_window_and_clamps_to_query_bounds() {
        let range = probe_range(EXPAND_WINDOW, EXPAND_WINDOW / 2, EXPAND_WINDOW * 3 / 2);
        assert_eq!(range.start, EXPAND_WINDOW / 2);
        assert_eq!(range.end, EXPAND_WINDOW * 3 / 2);
    }

    #[tokio::test]
    async fn expansion_timeout_returns_the_partial_range() {
        let original = TraceTimeRange {
            start_time: EXPAND_WINDOW * 10,
            end_time: EXPAND_WINDOW * 10 + 1,
        };
        let context = TimerContext {
            org_id: "org",
            index_stream: "trace_time_index_stream",
            trace_id: "trace",
            query_start: 0,
            query_end: EXPAND_WINDOW * 20,
            deadline: Instant::now(),
        };
        let mut stats = TimerStats::default();

        let resolved = expand(
            &context,
            original,
            CoveredRange {
                start: original.start_time,
                end: original.end_time,
            },
            &mut stats,
        )
        .await
        .unwrap();

        assert_eq!(resolved, original);
        assert!(stats.timed_out);
        assert_eq!(stats.expand_rounds, 1);
    }
}

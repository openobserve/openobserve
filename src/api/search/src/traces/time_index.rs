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

const DAY_MICROS: i64 = 24 * 60 * 60 * 1_000_000;
const EXPAND_WINDOW: i64 = DAY_MICROS;
const SESSION_EXPAND_WINDOW: i64 = 7 * DAY_MICROS;

/// What the lookup key identifies. The timer algorithm is shared; the kind
/// selects the index column and the completeness assumption (expand window):
/// gaps inside a trace are bounded by 24h, gaps inside an LLM session by 7d.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimeIndexKind {
    Trace,
    Session,
}

impl TimeIndexKind {
    fn column(self) -> &'static str {
        match self {
            Self::Trace => "trace_id",
            Self::Session => "session_id",
        }
    }

    fn expand_window(self) -> i64 {
        match self {
            Self::Trace => EXPAND_WINDOW,
            Self::Session => SESSION_EXPAND_WINDOW,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Session => "session",
        }
    }

    fn operation(self) -> &'static str {
        match self {
            Self::Trace => "query",
            Self::Session => "query_session",
        }
    }
}

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

/// A resolved session range plus the member traces the lookup discovered,
/// each with its own real range. The map can only be missing traces (timeout,
/// gap wider than the expand window, pre-coverage data) — it never contains a
/// wrong claim.
#[derive(Debug)]
pub struct SessionTimeIndexResult {
    pub range: TraceTimeRange,
    pub traces: HashMap<String, TraceTimeRange>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TraceTimeRangeResponse {
    pub stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
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
    kind: TimeIndexKind,
    key: &'a str,
    query_start: i64,
    query_end: i64,
    deadline: Instant,
}

/// One window's worth of index rows: the merged overall range drives the
/// locate/expand state machine, the per-trace rows accumulate into the
/// session result. A trace lookup returns exactly one row.
struct WindowHit {
    range: TraceTimeRange,
    traces: Vec<(String, TraceTimeRange)>,
}

enum WindowResult {
    Hit(WindowHit),
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

fn probe_range(
    candidate: i64,
    expand_window: i64,
    query_start: i64,
    query_end: i64,
) -> CoveredRange {
    CoveredRange {
        start: candidate.saturating_sub(expand_window).max(query_start),
        end: candidate.saturating_add(expand_window).min(query_end),
    }
}

async fn query_window(
    context: &TimerContext<'_>,
    start_time: i64,
    end_time: i64,
) -> Result<WindowResult> {
    if start_time >= end_time {
        return Ok(WindowResult::Miss);
    }
    let remaining = context.deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Ok(WindowResult::TimedOut);
    }

    // Grouping by trace_id serves both kinds: a trace lookup returns its
    // single row, a session lookup returns one row per member trace.
    let sql = format!(
        "SELECT trace_id, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts FROM {} WHERE {} = {} GROUP BY trace_id",
        quote_identifier(context.index_stream),
        quote_identifier(context.kind.column()),
        quote_sql_string(context.key),
    );
    let request = Request {
        query: Query {
            sql,
            from: 0,
            size: 50_000,
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
        context.org_id,
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
    let mut range: Option<TraceTimeRange> = None;
    let mut traces = Vec::with_capacity(response.hits.len());
    for hit in &response.hits {
        let Some(trace_id) = hit.get("trace_id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(min_ts) = hit.get("min_ts").map(json::get_int_value) else {
            continue;
        };
        let Some(max_ts) = hit.get("max_ts").map(json::get_int_value) else {
            continue;
        };
        let trace_range = TraceTimeRange {
            start_time: min_ts,
            end_time: max_ts,
        };
        range = Some(range.map_or(trace_range, |r| r.merge(trace_range)));
        traces.push((trace_id.to_string(), trace_range));
    }
    match range {
        Some(range) => Ok(WindowResult::Hit(WindowHit { range, traces })),
        None => Ok(WindowResult::Miss),
    }
}

fn collect_traces(
    collector: &mut HashMap<String, TraceTimeRange>,
    traces: Vec<(String, TraceTimeRange)>,
) {
    for (trace_id, range) in traces {
        collector
            .entry(trace_id)
            .and_modify(|existing| *existing = existing.merge(range))
            .or_insert(range);
    }
}

async fn locate(
    context: &TimerContext<'_>,
    hint_ts: Option<i64>,
    collector: &mut HashMap<String, TraceTimeRange>,
    stats: &mut TimerStats,
) -> Result<Option<(TraceTimeRange, CoveredRange)>> {
    let mut candidates = Vec::with_capacity(2);
    if let Some(hint) = hint_ts {
        candidates.push(hint);
    }
    if let Some(uuid_time) = config::ider::get_start_time_from_trace_id(context.key) {
        candidates.push(uuid_time);
    }
    let expand_window = context.kind.expand_window();
    let mut seen = HashSet::new();
    for candidate in candidates {
        if !seen.insert(candidate) {
            continue;
        }
        let CoveredRange { start, end } = probe_range(
            candidate,
            expand_window,
            context.query_start,
            context.query_end,
        );
        stats.locate_rounds += 1;
        match query_window(context, start, end).await? {
            WindowResult::Hit(hit) => {
                collect_traces(collector, hit.traces);
                return Ok(Some((hit.range, CoveredRange { start, end })));
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
        match query_window(context, start, cursor).await? {
            WindowResult::Hit(hit) => {
                collect_traces(collector, hit.traces);
                return Ok(Some((hit.range, CoveredRange { start, end: cursor })));
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
    collector: &mut HashMap<String, TraceTimeRange>,
    stats: &mut TimerStats,
) -> Result<TraceTimeRange> {
    let expand_window = context.kind.expand_window();
    // expand left
    loop {
        let target = range
            .start_time
            .saturating_sub(expand_window)
            .max(context.query_start);
        if target >= covered.start {
            break;
        }
        stats.expand_rounds += 1;
        match query_window(context, target, covered.start).await? {
            WindowResult::Hit(hit) => {
                range = range.merge(hit.range);
                collect_traces(collector, hit.traces);
            }
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
            .saturating_add(expand_window)
            .min(context.query_end);
        if target <= covered.end {
            break;
        }
        stats.expand_rounds += 1;
        match query_window(context, covered.end, target).await? {
            WindowResult::Hit(hit) => {
                range = range.merge(hit.range);
                collect_traces(collector, hit.traces);
            }
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
    query_instrumented(org_id, stream_name, TimeIndexKind::Trace, trace_id, hint_ts)
        .await
        .map(|result| result.map(|result| result.range))
}

pub async fn query_session(
    org_id: &str,
    stream_name: &str,
    session_id: &str,
    hint_ts: Option<i64>,
) -> Result<Option<SessionTimeIndexResult>> {
    query_instrumented(
        org_id,
        stream_name,
        TimeIndexKind::Session,
        session_id,
        hint_ts,
    )
    .await
}

async fn query_instrumented(
    org_id: &str,
    stream_name: &str,
    kind: TimeIndexKind,
    key: &str,
    hint_ts: Option<i64>,
) -> Result<Option<SessionTimeIndexResult>> {
    let started = std::time::Instant::now();
    let mut stats = TimerStats::default();
    let result = query_inner(org_id, stream_name, kind, key, hint_ts, &mut stats).await;
    let status = match &result {
        Ok(Some(_)) => "hit",
        Ok(None) => "miss",
        Err(_) => "error",
    };
    let kind_label = kind.label();
    config::metrics::TRACE_TIME_INDEX_OPERATIONS
        .with_label_values(&[org_id, kind.operation(), status])
        .inc();
    if stats.timed_out {
        config::metrics::TRACE_TIME_INDEX_OPERATIONS
            .with_label_values(&[org_id, kind.operation(), "timeout"])
            .inc();
    }
    let elapsed = started.elapsed();
    config::metrics::TRACE_TIME_INDEX_QUERY_DURATION
        .with_label_values(&[org_id, kind_label, status])
        .observe(elapsed.as_secs_f64());
    config::metrics::TRACE_TIME_INDEX_QUERY_ROUNDS
        .with_label_values(&[org_id, kind_label, "locate"])
        .observe(stats.locate_rounds as f64);
    config::metrics::TRACE_TIME_INDEX_QUERY_ROUNDS
        .with_label_values(&[org_id, kind_label, "expand"])
        .observe(stats.expand_rounds as f64);
    log::info!(
        "[trace_time_index] query org_id={org_id:?} stream={stream_name:?} kind={kind_label} key={key:?} hint_ts={hint_ts:?} status={status} timed_out={} locate_rounds={} expand_rounds={} took={} ms",
        stats.timed_out,
        stats.locate_rounds,
        stats.expand_rounds,
        elapsed.as_millis(),
    );
    result
}

async fn query_inner(
    org_id: &str,
    stream_name: &str,
    kind: TimeIndexKind,
    key: &str,
    hint_ts: Option<i64>,
    stats: &mut TimerStats,
) -> Result<Option<SessionTimeIndexResult>> {
    let cfg = get_config();
    if !cfg.common.trace_time_index_enabled {
        return Ok(None);
    }

    let mut query_start = infra::db::trace_time_index::get_or_create_coverage_start()
        .await
        .map_err(|e| Error::Message(format!("read trace time index coverage marker: {e}")))?;
    // A session's spans cannot causally precede its creation, so a UUID v7
    // session id tightens the scan's left bound to the session's lifetime
    // neighborhood; the expand-window margin absorbs clock skew.
    if kind == TimeIndexKind::Session
        && let Some(uuid_time) = config::ider::get_start_time_from_trace_id(key)
    {
        query_start = query_start.max(uuid_time.saturating_sub(kind.expand_window()));
    }
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
        kind,
        key,
        query_start,
        query_end,
        deadline,
    };
    let mut traces = HashMap::new();
    let Some((range, covered)) = locate(&context, hint_ts, &mut traces, stats).await? else {
        return Ok(None);
    };
    let range = expand(&context, range, covered, &mut traces, stats).await?;
    Ok(Some(SessionTimeIndexResult { range, traces }))
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

pub(crate) fn parse_optional_time_range(
    params: &HashMap<String, String>,
) -> std::result::Result<Option<TraceTimeRange>, Response> {
    match (params.get("start_time"), params.get("end_time")) {
        (None, None) => Ok(None),
        (Some(start), Some(end)) => {
            let start_time = start
                .parse::<i64>()
                .map_err(|_| MetaHttpResponse::bad_request("Invalid start_time parameter"))?;
            let end_time = end
                .parse::<i64>()
                .map_err(|_| MetaHttpResponse::bad_request("Invalid end_time parameter"))?;
            if start_time == 0 && end_time == 0 {
                return Ok(None);
            }
            if start_time == 0 || end_time == 0 {
                return Err(MetaHttpResponse::bad_request(
                    "start_time and end_time must both be zero or non-zero",
                ));
            }
            if start_time > end_time {
                return Err(MetaHttpResponse::bad_request(
                    "start_time must not be greater than end_time",
                ));
            }
            Ok(Some(TraceTimeRange {
                start_time,
                end_time,
            }))
        }
        _ => Err(MetaHttpResponse::bad_request(
            "start_time and end_time must be provided together",
        )),
    }
}

pub(crate) fn union_ranges(
    caller_range: Option<TraceTimeRange>,
    index_range: Option<TraceTimeRange>,
) -> Option<TraceTimeRange> {
    match (caller_range, index_range) {
        (Some(caller), Some(index)) => Some(TraceTimeRange {
            start_time: caller.start_time.min(index.start_time),
            end_time: caller.end_time.max(index.end_time),
        }),
        (Some(range), None) | (None, Some(range)) => Some(range),
        (None, None) => None,
    }
}

/// GetTraceTimeRange
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/time_range",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetTraceTimeRange",
    summary = "Get the indexed time range for a trace or a session",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Traces stream name"),
        ("trace_id" = Option<String>, Query, description = "Trace ID; exactly one of trace_id and session_id is required"),
        ("session_id" = Option<String>, Query, description = "Session ID; exactly one of trace_id and session_id is required"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
    ),
    responses(
        (status = 200, description = "Success", body = TraceTimeRangeResponse),
        (status = 400, description = "Invalid parameters"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn get_trace_time_range(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let trace_id = params
        .get("trace_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let session_id = params
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let (kind, key) = match (trace_id, session_id) {
        (Some(trace_id), None) => (TimeIndexKind::Trace, trace_id),
        (None, Some(session_id)) => (TimeIndexKind::Session, session_id),
        _ => {
            return MetaHttpResponse::bad_request(
                "exactly one of trace_id and session_id is required",
            );
        }
    };
    let hint_ts = match params.get("hint_ts") {
        Some(value) => match value.parse::<i64>() {
            Ok(value) => Some(value),
            Err(_) => return MetaHttpResponse::bad_request("Invalid hint_ts parameter"),
        },
        None => None,
    };
    let request_trace_id = get_or_create_trace_id(&headers, &tracing::Span::none());
    match query_instrumented(&org_id, &stream_name, kind, key, hint_ts).await {
        Ok(result) => Json(TraceTimeRangeResponse {
            stream: stream_name,
            trace_id: matches!(kind, TimeIndexKind::Trace).then(|| key.to_string()),
            session_id: matches!(kind, TimeIndexKind::Session).then(|| key.to_string()),
            range: result.map(|result| result.range),
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
        let range = probe_range(
            EXPAND_WINDOW,
            EXPAND_WINDOW,
            EXPAND_WINDOW / 2,
            EXPAND_WINDOW * 3 / 2,
        );
        assert_eq!(range.start, EXPAND_WINDOW / 2);
        assert_eq!(range.end, EXPAND_WINDOW * 3 / 2);
    }

    #[test]
    fn expand_windows_encode_the_completeness_assumptions() {
        assert_eq!(TimeIndexKind::Trace.expand_window(), DAY_MICROS);
        assert_eq!(TimeIndexKind::Session.expand_window(), 7 * DAY_MICROS);
    }

    #[test]
    fn session_probe_window_is_wider_than_trace_probe_window() {
        let anchor = SESSION_EXPAND_WINDOW * 2;
        let trace = probe_range(anchor, TimeIndexKind::Trace.expand_window(), 0, i64::MAX);
        let session = probe_range(anchor, TimeIndexKind::Session.expand_window(), 0, i64::MAX);
        assert_eq!(trace.end - trace.start, 2 * EXPAND_WINDOW);
        assert_eq!(session.end - session.start, 2 * SESSION_EXPAND_WINDOW);
    }

    #[test]
    fn collected_traces_merge_per_trace_ranges() {
        let mut collector = HashMap::new();
        collect_traces(
            &mut collector,
            vec![(
                "trace-a".to_string(),
                TraceTimeRange {
                    start_time: 10,
                    end_time: 20,
                },
            )],
        );
        collect_traces(
            &mut collector,
            vec![
                (
                    "trace-a".to_string(),
                    TraceTimeRange {
                        start_time: 5,
                        end_time: 15,
                    },
                ),
                (
                    "trace-b".to_string(),
                    TraceTimeRange {
                        start_time: 30,
                        end_time: 40,
                    },
                ),
            ],
        );
        assert_eq!(collector.len(), 2);
        assert_eq!(
            collector["trace-a"],
            TraceTimeRange {
                start_time: 5,
                end_time: 20,
            }
        );
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
            kind: TimeIndexKind::Trace,
            key: "trace",
            query_start: 0,
            query_end: EXPAND_WINDOW * 20,
            deadline: Instant::now(),
        };
        let mut stats = TimerStats::default();
        let mut collector = HashMap::new();

        let resolved = expand(
            &context,
            original,
            CoveredRange {
                start: original.start_time,
                end: original.end_time,
            },
            &mut collector,
            &mut stats,
        )
        .await
        .unwrap();

        assert_eq!(resolved, original);
        assert!(stats.timed_out);
        assert_eq!(stats.expand_rounds, 1);
    }

    #[test]
    fn parses_complete_optional_range() {
        let params = HashMap::from_iter([
            ("start_time".to_string(), "10".to_string()),
            ("end_time".to_string(), "20".to_string()),
        ]);
        assert_eq!(
            parse_optional_time_range(&params).unwrap(),
            Some(TraceTimeRange {
                start_time: 10,
                end_time: 20,
            })
        );
    }

    #[test]
    fn rejects_half_of_a_range() {
        let params = HashMap::from_iter([("start_time".to_string(), "10".to_string())]);
        assert!(parse_optional_time_range(&params).is_err());
    }

    #[test]
    fn zero_zero_range_counts_as_absent() {
        let params = HashMap::from_iter([
            ("start_time".to_string(), "0".to_string()),
            ("end_time".to_string(), "0".to_string()),
        ]);
        assert_eq!(parse_optional_time_range(&params).unwrap(), None);
    }

    #[test]
    fn union_never_narrows_the_caller_range() {
        let caller = TraceTimeRange {
            start_time: 10,
            end_time: 20,
        };
        assert_eq!(
            union_ranges(
                Some(caller),
                Some(TraceTimeRange {
                    start_time: 12,
                    end_time: 18,
                })
            ),
            Some(caller)
        );
        assert_eq!(union_ranges(Some(caller), None), Some(caller));
        assert_eq!(union_ranges(None, None), None);
    }
}

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

use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

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
use futures::{StreamExt, TryStreamExt};
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
const MAX_LOOKUP_KEYS: usize = 100;
const LOOKUP_CONCURRENCY: usize = 8;

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

/// Per-key lookup verdict. `NotFound` means the searched bounds were fully
/// scanned without a hit; `Timeout` means the scan gave up, so the key may
/// still exist.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimeRangeStatus {
    Found,
    NotFound,
    Timeout,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TimeRangeResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    pub status: TimeRangeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<TraceTimeRange>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TraceTimeRangeResponse {
    pub stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Legacy single-id field; always null for multi-id requests.
    pub range: Option<TraceTimeRange>,
    pub results: Vec<TimeRangeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub searched_range: Option<TraceTimeRange>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub partial_coverage: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrgTraceTimeRangeResponse {
    pub results: Vec<TimeRangeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub searched_range: Option<TraceTimeRange>,
    /// True when some trace streams could not be searched (no index, no
    /// permission, or indexing disabled), so `not_found` is not org-wide proof.
    pub partial_coverage: bool,
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
    coverage_missing: bool,
}

/// Locate honors the scan bounds (tightened by a caller range); expand honors
/// the hard bounds so a found range is never truncated by the caller range.
struct TimerContext<'a> {
    org_id: &'a str,
    index_stream: &'a str,
    kind: TimeIndexKind,
    key: &'a str,
    key_uuid_ts: Option<i64>,
    scan_start: i64,
    scan_end: i64,
    hard_start: i64,
    hard_end: i64,
    deadline: Instant,
}

struct LookupParams<'a> {
    org_id: &'a str,
    stream_name: &'a str,
    kind: TimeIndexKind,
    key: &'a str,
    hint_ts: Option<i64>,
    bounds: Option<TraceTimeRange>,
    deadline: Instant,
}

/// The parsed query parameters shared by both time-range handlers.
struct LookupRequest {
    kind: TimeIndexKind,
    keys: Vec<String>,
    hint_ts: Option<i64>,
    bounds: Option<TraceTimeRange>,
}

/// `coverage_missing` reports that the lookup could not consult an index at
/// all (feature disabled or index stream absent), so a miss is not proof.
struct TimeIndexLookup {
    result: Option<SessionTimeIndexResult>,
    timed_out: bool,
    coverage_missing: bool,
}

/// One (key, stream) fan-out result.
struct LookupOutcome {
    key_index: usize,
    stream_index: usize,
    range: Option<TraceTimeRange>,
    timed_out: bool,
    coverage_missing: bool,
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

fn probe_range(candidate: i64, expand_window: i64, scan_start: i64, scan_end: i64) -> CoveredRange {
    CoveredRange {
        start: candidate.saturating_sub(expand_window).max(scan_start),
        end: candidate.saturating_add(expand_window).min(scan_end),
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
    if let Some(uuid_time) = context.key_uuid_ts {
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
            context.scan_start,
            context.scan_end,
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

    let mut cursor = context.scan_end;
    for batch_size in locate_batch_sizes() {
        if cursor <= context.scan_start {
            break;
        }
        let start = cursor.saturating_sub(batch_size).max(context.scan_start);
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
            .max(context.hard_start);
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
            .min(context.hard_end);
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
    query_instrumented(&LookupParams {
        org_id,
        stream_name,
        kind: TimeIndexKind::Trace,
        key: trace_id,
        hint_ts,
        bounds: None,
        deadline: default_deadline(),
    })
    .await
    .map(|lookup| lookup.result.map(|result| result.range))
}

pub async fn query_session(
    org_id: &str,
    stream_name: &str,
    session_id: &str,
    hint_ts: Option<i64>,
) -> Result<Option<SessionTimeIndexResult>> {
    query_instrumented(&LookupParams {
        org_id,
        stream_name,
        kind: TimeIndexKind::Session,
        key: session_id,
        hint_ts,
        bounds: None,
        deadline: default_deadline(),
    })
    .await
    .map(|lookup| lookup.result)
}

fn default_deadline() -> Instant {
    Instant::now() + Duration::from_secs(get_config().limit.query_timeout)
}

async fn query_instrumented(params: &LookupParams<'_>) -> Result<TimeIndexLookup> {
    let started = std::time::Instant::now();
    let mut stats = TimerStats::default();
    let result = query_inner(params, &mut stats).await;
    let status = match &result {
        Ok(Some(_)) => "hit",
        Ok(None) => "miss",
        Err(_) => "error",
    };
    let org_id = params.org_id;
    let kind = params.kind;
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
        "[trace_time_index] query org_id={org_id:?} stream={:?} kind={kind_label} key={:?} hint_ts={:?} status={status} timed_out={} locate_rounds={} expand_rounds={} took={} ms",
        params.stream_name,
        params.key,
        params.hint_ts,
        stats.timed_out,
        stats.locate_rounds,
        stats.expand_rounds,
        elapsed.as_millis(),
    );
    result.map(|result| TimeIndexLookup {
        result,
        timed_out: stats.timed_out,
        coverage_missing: stats.coverage_missing,
    })
}

async fn query_inner(
    params: &LookupParams<'_>,
    stats: &mut TimerStats,
) -> Result<Option<SessionTimeIndexResult>> {
    let cfg = get_config();
    if !cfg.common.trace_time_index_enabled {
        stats.coverage_missing = true;
        return Ok(None);
    }

    let kind = params.kind;
    let key_uuid_ts = config::ider::get_start_time_from_trace_id(params.key);
    let mut hard_start = infra::db::trace_time_index::get_or_create_coverage_start()
        .await
        .map_err(|e| Error::Message(format!("read trace time index coverage marker: {e}")))?;
    // A session's spans cannot causally precede its creation, so a UUID v7
    // session id tightens the scan's left bound to the session's lifetime
    // neighborhood; the expand-window margin absorbs clock skew.
    if kind == TimeIndexKind::Session
        && let Some(uuid_time) = key_uuid_ts
    {
        hard_start = hard_start.max(uuid_time.saturating_sub(kind.expand_window()));
    }
    let hard_end = now_micros().saturating_add(cfg.limit.ingest_allowed_in_future_micro);
    let mut scan_start = hard_start;
    let mut scan_end = hard_end;
    if let Some(padded) = padded_bounds(kind, params.bounds) {
        scan_start = scan_start.max(padded.start_time);
        scan_end = scan_end.min(padded.end_time);
    }
    if scan_start >= scan_end {
        return Ok(None);
    }
    if !index_stream_exists(params.org_id, params.stream_name).await {
        stats.coverage_missing = true;
        return Ok(None);
    }
    let index_stream = get_trace_time_index_stream_name(params.stream_name);
    let context = TimerContext {
        org_id: params.org_id,
        index_stream: &index_stream,
        kind,
        key: params.key,
        key_uuid_ts,
        scan_start,
        scan_end,
        hard_start,
        hard_end,
        deadline: params.deadline,
    };
    let mut traces = HashMap::new();
    let Some((range, covered)) = locate(&context, params.hint_ts, &mut traces, stats).await? else {
        return Ok(None);
    };
    let range = expand(&context, range, covered, &mut traces, stats).await?;
    Ok(Some(SessionTimeIndexResult { range, traces }))
}

/// Runs every (key, stream) lookup under one shared deadline, walking
/// stream-major so a key resolved in an earlier stream is skipped in later
/// ones (a trace or session id lives in exactly one stream). The bool reports
/// whether any lookup ran without index coverage.
async fn run_lookups(
    org_id: &str,
    streams: &[String],
    kind: TimeIndexKind,
    keys: &[String],
    hint_ts: Option<i64>,
    bounds: Option<TraceTimeRange>,
) -> Result<(Vec<TimeRangeResult>, bool)> {
    let deadline = default_deadline();
    let resolved: Vec<AtomicBool> = (0..keys.len()).map(|_| AtomicBool::new(false)).collect();
    let resolved = &resolved;
    let pairs = (0..streams.len())
        .flat_map(|stream_index| (0..keys.len()).map(move |key_index| (key_index, stream_index)));
    let outcomes = futures::stream::iter(pairs.map(|(key_index, stream_index)| async move {
        if resolved[key_index].load(Ordering::Relaxed) {
            return Ok::<_, Error>(None);
        }
        let lookup = query_instrumented(&LookupParams {
            org_id,
            stream_name: &streams[stream_index],
            kind,
            key: &keys[key_index],
            hint_ts,
            bounds,
            deadline,
        })
        .await?;
        if lookup.result.is_some() {
            resolved[key_index].store(true, Ordering::Relaxed);
        }
        Ok(Some(LookupOutcome {
            key_index,
            stream_index,
            range: lookup.result.map(|result| result.range),
            timed_out: lookup.timed_out,
            coverage_missing: lookup.coverage_missing,
        }))
    }))
    .buffer_unordered(LOOKUP_CONCURRENCY)
    .try_collect::<Vec<Option<LookupOutcome>>>()
    .await?;
    Ok(aggregate_outcomes(
        streams,
        kind,
        keys,
        outcomes.into_iter().flatten(),
    ))
}

fn aggregate_outcomes(
    streams: &[String],
    kind: TimeIndexKind,
    keys: &[String],
    outcomes: impl IntoIterator<Item = LookupOutcome>,
) -> (Vec<TimeRangeResult>, bool) {
    let mut found: Vec<Vec<(usize, TraceTimeRange)>> = vec![Vec::new(); keys.len()];
    let mut timed_out = vec![false; keys.len()];
    let mut coverage_missing = false;
    for outcome in outcomes {
        coverage_missing |= outcome.coverage_missing;
        match outcome.range {
            Some(range) => found[outcome.key_index].push((outcome.stream_index, range)),
            None if outcome.timed_out => timed_out[outcome.key_index] = true,
            None => {}
        }
    }
    let mut results = Vec::with_capacity(keys.len());
    for ((key, found), timed_out) in keys.iter().zip(found).zip(timed_out) {
        if found.is_empty() {
            let status = if timed_out {
                TimeRangeStatus::Timeout
            } else {
                TimeRangeStatus::NotFound
            };
            results.push(make_result(kind, key, None, status, None));
        } else {
            for (stream_index, range) in found {
                results.push(make_result(
                    kind,
                    key,
                    Some(streams[stream_index].clone()),
                    TimeRangeStatus::Found,
                    Some(range),
                ));
            }
        }
    }
    (results, coverage_missing)
}

fn make_result(
    kind: TimeIndexKind,
    key: &str,
    stream: Option<String>,
    status: TimeRangeStatus,
    range: Option<TraceTimeRange>,
) -> TimeRangeResult {
    TimeRangeResult {
        trace_id: matches!(kind, TimeIndexKind::Trace).then(|| key.to_string()),
        session_id: matches!(kind, TimeIndexKind::Session).then(|| key.to_string()),
        stream,
        status,
        range,
    }
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

fn parse_lookup_request(
    params: &HashMap<String, String>,
) -> std::result::Result<LookupRequest, Response> {
    let (kind, keys) = parse_lookup_keys(params)?;
    Ok(LookupRequest {
        kind,
        keys,
        hint_ts: parse_hint_ts(params)?,
        bounds: parse_optional_time_range(params)?,
    })
}

fn parse_lookup_keys(
    params: &HashMap<String, String>,
) -> std::result::Result<(TimeIndexKind, Vec<String>), Response> {
    let trace_ids = parse_id_list(params.get("trace_id"));
    let session_ids = parse_id_list(params.get("session_id"));
    let (kind, keys) = match (trace_ids.is_empty(), session_ids.is_empty()) {
        (false, true) => (TimeIndexKind::Trace, trace_ids),
        (true, false) => (TimeIndexKind::Session, session_ids),
        _ => {
            return Err(MetaHttpResponse::bad_request(
                "exactly one of trace_id and session_id is required",
            ));
        }
    };
    if keys.len() > MAX_LOOKUP_KEYS {
        return Err(MetaHttpResponse::bad_request(format!(
            "at most {MAX_LOOKUP_KEYS} ids are allowed per request"
        )));
    }
    Ok((kind, keys))
}

fn parse_id_list(value: Option<&String>) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .map_or("", String::as_str)
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty() && seen.insert(*id))
        .map(str::to_string)
        .collect()
}

fn parse_hint_ts(params: &HashMap<String, String>) -> std::result::Result<Option<i64>, Response> {
    match params.get("hint_ts") {
        Some(value) => value
            .parse::<i64>()
            .map(Some)
            .map_err(|_| MetaHttpResponse::bad_request("Invalid hint_ts parameter")),
        None => Ok(None),
    }
}

/// The caller range padded by the kind's completeness window: the bounds
/// locate honors, and the `searched_range` echoed to callers. Found ranges
/// may still extend past it via expand.
fn padded_bounds(kind: TimeIndexKind, bounds: Option<TraceTimeRange>) -> Option<TraceTimeRange> {
    bounds.map(|bounds| TraceTimeRange {
        start_time: bounds.start_time.saturating_sub(kind.expand_window()),
        end_time: bounds.end_time.saturating_add(kind.expand_window()),
    })
}

async fn index_stream_exists(org_id: &str, stream_name: &str) -> bool {
    infra::schema::exists(
        org_id,
        StreamType::Metadata,
        &get_trace_time_index_stream_name(stream_name),
    )
    .await
}

/// Trace streams of the org the caller may search and that have a time index,
/// optionally narrowed to `filter`. The bool reports whether any candidate
/// stream had to be skipped (partial coverage).
async fn resolve_org_streams(
    org_id: &str,
    user_id: &str,
    filter: &[String],
) -> Result<(Vec<String>, bool)> {
    if !get_config().common.trace_time_index_enabled {
        return Ok((Vec::new(), true));
    }
    let stream_list = db::schema::list(org_id, Some(StreamType::Traces), false)
        .await
        .map_err(|e| Error::Message(format!("list trace streams: {e}")))?;
    let candidates = stream_list
        .into_iter()
        .map(|stream| stream.stream_name)
        .filter(|name| filter.is_empty() || filter.contains(name));
    let checks = futures::stream::iter(candidates.map(|name| async move {
        let searchable = super::check_stream_permissions(org_id, &name, user_id)
            .await
            .is_none()
            && index_stream_exists(org_id, &name).await;
        (name, searchable)
    }))
    .buffered(LOOKUP_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    let mut streams = Vec::new();
    let mut partial = false;
    for (name, searchable) in checks {
        if searchable {
            streams.push(name);
        } else {
            partial = true;
        }
    }
    Ok((streams, partial))
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
    summary = "Get the indexed time range for traces or sessions",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Traces stream name"),
        ("trace_id" = Option<String>, Query, description = "Comma-separated trace IDs; exactly one of trace_id and session_id is required"),
        ("session_id" = Option<String>, Query, description = "Comma-separated session IDs; exactly one of trace_id and session_id is required"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
        ("start_time" = Option<i64>, Query, description = "Optional locate lower bound in microseconds; paired with end_time. Found ranges may extend past it"),
        ("end_time" = Option<i64>, Query, description = "Optional locate upper bound in microseconds; paired with start_time"),
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
    let request = match parse_lookup_request(&params) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let request_trace_id = get_or_create_trace_id(&headers, &tracing::Span::none());
    let streams = std::slice::from_ref(&stream_name);
    let (results, coverage_missing) = match run_lookups(
        &org_id,
        streams,
        request.kind,
        &request.keys,
        request.hint_ts,
        request.bounds,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(e) => {
            log::error!(
                "[trace_id {request_trace_id}] trace time index query failed for {org_id}/{stream_name}: {e}"
            );
            return MetaHttpResponse::internal_error("Failed to query trace time index");
        }
    };
    let single = (request.keys.len() == 1).then(|| results.first()).flatten();
    let (trace_id, session_id, range) = match single {
        Some(single) => (
            single.trace_id.clone(),
            single.session_id.clone(),
            single.range,
        ),
        None => (None, None, None),
    };
    Json(TraceTimeRangeResponse {
        stream: stream_name,
        trace_id,
        session_id,
        range,
        results,
        searched_range: padded_bounds(request.kind, request.bounds),
        partial_coverage: coverage_missing,
    })
    .into_response()
}

/// GetOrgTraceTimeRange
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/traces/time_range",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetOrgTraceTimeRange",
    summary = "Get indexed time ranges for traces or sessions across all trace streams",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("trace_id" = Option<String>, Query, description = "Comma-separated trace IDs; exactly one of trace_id and session_id is required"),
        ("session_id" = Option<String>, Query, description = "Comma-separated session IDs; exactly one of trace_id and session_id is required"),
        ("hint_ts" = Option<i64>, Query, description = "Optional time hint in microseconds"),
        ("start_time" = Option<i64>, Query, description = "Optional locate lower bound in microseconds; paired with end_time. Found ranges may extend past it"),
        ("end_time" = Option<i64>, Query, description = "Optional locate upper bound in microseconds; paired with start_time"),
        ("streams" = Option<String>, Query, description = "Optional comma-separated trace stream names to narrow the search"),
    ),
    responses(
        (status = 200, description = "Success", body = OrgTraceTimeRangeResponse),
        (status = 400, description = "Invalid parameters"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_org_trace_time_range(
    Path(org_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(e) = search_service::check_search_allowed(&org_id, None) {
        return MetaHttpResponse::too_many_requests(e.to_string());
    }
    let request = match parse_lookup_request(&params) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let request_trace_id = get_or_create_trace_id(&headers, &tracing::Span::none());
    let stream_filter = parse_id_list(params.get("streams"));
    let (streams, partial_streams) = match resolve_org_streams(
        &org_id,
        &user_email.user_id,
        &stream_filter,
    )
    .await
    {
        Ok(resolved) => resolved,
        Err(e) => {
            log::error!(
                "[trace_id {request_trace_id}] trace time index stream listing failed for {org_id}: {e}"
            );
            return MetaHttpResponse::internal_error("Failed to query trace time index");
        }
    };
    let (results, coverage_missing) = match run_lookups(
        &org_id,
        &streams,
        request.kind,
        &request.keys,
        request.hint_ts,
        request.bounds,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(e) => {
            log::error!(
                "[trace_id {request_trace_id}] trace time index query failed for {org_id}: {e}"
            );
            return MetaHttpResponse::internal_error("Failed to query trace time index");
        }
    };
    Json(OrgTraceTimeRangeResponse {
        results,
        searched_range: padded_bounds(request.kind, request.bounds),
        partial_coverage: partial_streams || coverage_missing,
    })
    .into_response()
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
            key_uuid_ts: None,
            scan_start: 0,
            scan_end: EXPAND_WINDOW * 20,
            hard_start: 0,
            hard_end: EXPAND_WINDOW * 20,
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
    fn id_lists_trim_dedup_and_drop_empties() {
        let value = " a ,b,,a,c ".to_string();
        assert_eq!(parse_id_list(Some(&value)), vec!["a", "b", "c"]);
        assert!(parse_id_list(None).is_empty());
    }

    #[test]
    fn lookup_keys_require_exactly_one_kind() {
        let both = HashMap::from_iter([
            ("trace_id".to_string(), "a".to_string()),
            ("session_id".to_string(), "b".to_string()),
        ]);
        assert!(parse_lookup_keys(&both).is_err());
        assert!(parse_lookup_keys(&HashMap::new()).is_err());

        let traces = HashMap::from_iter([("trace_id".to_string(), "a,b".to_string())]);
        let (kind, keys) = parse_lookup_keys(&traces).unwrap();
        assert_eq!(kind, TimeIndexKind::Trace);
        assert_eq!(keys, vec!["a", "b"]);
    }

    #[test]
    fn lookup_keys_are_capped() {
        let ids = (0..=MAX_LOOKUP_KEYS)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let params = HashMap::from_iter([("trace_id".to_string(), ids)]);
        assert!(parse_lookup_keys(&params).is_err());
    }

    #[test]
    fn searched_range_pads_by_the_expand_window() {
        let bounds = TraceTimeRange {
            start_time: EXPAND_WINDOW * 2,
            end_time: EXPAND_WINDOW * 3,
        };
        let padded = padded_bounds(TimeIndexKind::Trace, Some(bounds)).unwrap();
        assert_eq!(padded.start_time, EXPAND_WINDOW);
        assert_eq!(padded.end_time, EXPAND_WINDOW * 4);
        assert!(padded_bounds(TimeIndexKind::Trace, None).is_none());
    }

    #[test]
    fn outcomes_aggregate_into_per_key_statuses() {
        let streams = vec!["a".to_string(), "b".to_string()];
        let keys = vec!["k1".to_string(), "k2".to_string(), "k3".to_string()];
        let range = TraceTimeRange {
            start_time: 1,
            end_time: 2,
        };
        let outcome = |key_index, stream_index, range, timed_out, coverage_missing| LookupOutcome {
            key_index,
            stream_index,
            range,
            timed_out,
            coverage_missing,
        };
        let outcomes = vec![
            // k1 found in stream b (its stream-a pair was skipped)
            outcome(0, 1, Some(range), false, false),
            // k2 missed everywhere, one stream timed out and lacked coverage
            outcome(1, 0, None, true, true),
            outcome(1, 1, None, false, false),
            // k3 missed everywhere without timeouts
            outcome(2, 0, None, false, false),
        ];
        let (results, coverage_missing) =
            aggregate_outcomes(&streams, TimeIndexKind::Trace, &keys, outcomes);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].status, TimeRangeStatus::Found);
        assert_eq!(results[0].stream.as_deref(), Some("b"));
        assert_eq!(results[0].range, Some(range));
        assert_eq!(results[1].status, TimeRangeStatus::Timeout);
        assert_eq!(results[2].status, TimeRangeStatus::NotFound);
        assert!(results[2].trace_id.as_deref() == Some("k3"));
        assert!(coverage_missing);
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

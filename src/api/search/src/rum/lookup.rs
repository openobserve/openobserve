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

use std::time::Duration;

use axum::{
    Json,
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        search::{
            Query, Request, RequestEncoding, Response as SearchResponse, SearchEventType,
            default_use_cache,
        },
        stream::StreamType,
        traces::session::{key_in_predicate, quote_identifier, quote_sql_string},
    },
    utils::json,
};
use infra::errors::{Error, ErrorCodes};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, rum::RUM_DATA_STREAM};
use search_service::{self as SearchService, query_range::get_settings_max_query_range};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tracing::Span;
use utoipa::ToSchema;

use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

const TRACE_ID_FIELDS: [&str; 2] = ["_o2_trace_id", "_oo_trace_id"];
const TRACE_ID_HEX_LENGTH: usize = 32;
// A browser request starts before the trace but is stamped on completion, so the tail is longer.
const BRIDGE_LEAD_US: i64 = 60_000_000;
const BRIDGE_LAG_US: i64 = 300_000_000;
// A page view outlives any trace started from it, so its rows are searched around the request.
const PAGE_VIEW_WINDOW_US: i64 = 3_600_000_000;
const HOUR_US: i64 = 3_600_000_000;
const MAX_TIMEOUT_SECS: i64 = 24 * 3600;

/// Body of a trace-to-RUM lookup.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RumLookupRequest {
    pub trace_id: String,
    /// Earliest start of the backend spans, in microseconds.
    pub start_time: i64,
    /// Latest end of the backend spans, in microseconds.
    pub end_time: i64,
    /// RUM data stream; defaults to `_rumdata`.
    #[serde(default)]
    pub rum_stream: Option<String>,
    /// Budget for the whole lookup in seconds; defaults to the query timeout.
    #[serde(default)]
    pub timeout: Option<i64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumLookupStatus {
    Found,
    NotFound,
    /// The stream is missing or has no trace id column, so nothing was queried.
    Unavailable,
    /// A query failed, timed out or returned partial results.
    Incomplete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumQuery {
    TracedResources,
    Views,
    Actions,
    ContextEvents,
}

impl RumQuery {
    fn as_str(self) -> &'static str {
        match self {
            Self::TracedResources => "traced_resources",
            Self::Views => "views",
            Self::Actions => "actions",
            Self::ContextEvents => "context_events",
        }
    }

    fn limit(self) -> usize {
        match self {
            Self::TracedResources => 10,
            Self::Views => 50,
            Self::Actions | Self::ContextEvents => 250,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumQueryErrorKind {
    Timeout,
    Cancelled,
    Failed,
    Partial,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumQueryError {
    pub query: RumQuery,
    pub kind: RumQueryErrorKind,
    pub message: String,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumBridge {
    #[schema(value_type = Vec<Object>)]
    pub traced_resources: Vec<json::Value>,
}

/// Which result sets hit their limit and were cut.
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumLookupTruncated {
    pub traced_resources: bool,
    pub views: bool,
    pub actions: bool,
    pub context_events: bool,
}

impl RumLookupTruncated {
    fn any(&self) -> bool {
        self.traced_resources || self.views || self.actions || self.context_events
    }
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumLookupDiagnostics {
    /// Wall time of the whole lookup, in milliseconds.
    pub took: usize,
    pub queries: Vec<RumQueryDiagnostics>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumQueryDiagnostics {
    pub query: RumQuery,
    pub start_time: i64,
    pub end_time: i64,
    /// Wall time of the sub-query as seen by the lookup, in milliseconds.
    pub took: usize,
    pub search_took: usize,
    pub wait_in_queue: usize,
    pub scan_files: usize,
    pub scan_size: usize,
    pub scan_records: usize,
    pub cached_ratio: usize,
    pub result_cache_ratio: usize,
    pub hits: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumLookupResponse {
    pub status: RumLookupStatus,
    pub bridge: RumBridge,
    #[schema(value_type = Vec<Object>)]
    pub views: Vec<json::Value>,
    #[schema(value_type = Vec<Object>)]
    pub actions: Vec<json::Value>,
    #[schema(value_type = Vec<Object>)]
    pub context_events: Vec<json::Value>,
    /// Some result set is truncated or some query did not complete.
    pub partial: bool,
    pub truncated: RumLookupTruncated,
    pub errors: Vec<RumQueryError>,
    pub diagnostics: RumLookupDiagnostics,
}

impl RumLookupResponse {
    fn new(status: RumLookupStatus) -> Self {
        Self {
            status,
            bridge: RumBridge::default(),
            views: Vec::new(),
            actions: Vec::new(),
            context_events: Vec::new(),
            partial: false,
            truncated: RumLookupTruncated::default(),
            errors: Vec::new(),
            diagnostics: RumLookupDiagnostics::default(),
        }
    }

    fn record(&mut self, outcome: QueryOutcome) {
        let QueryOutcome {
            query,
            hits,
            truncated,
            error,
            diagnostics,
        } = outcome;
        match query {
            RumQuery::TracedResources => {
                self.bridge.traced_resources = hits;
                self.truncated.traced_resources = truncated;
            }
            RumQuery::Views => {
                self.views = hits;
                self.truncated.views = truncated;
            }
            RumQuery::Actions => {
                self.actions = hits;
                self.truncated.actions = truncated;
            }
            RumQuery::ContextEvents => {
                self.context_events = hits;
                self.truncated.context_events = truncated;
            }
        }
        self.errors.extend(error);
        self.diagnostics.queries.extend(diagnostics);
    }

    fn finish(mut self, found: bool) -> Self {
        let incomplete = !self.errors.is_empty();
        self.status = match (found, incomplete) {
            (_, true) => RumLookupStatus::Incomplete,
            (true, false) => RumLookupStatus::Found,
            (false, false) => RumLookupStatus::NotFound,
        };
        self.partial = incomplete || self.truncated.any();
        self
    }
}

struct QueryOutcome {
    query: RumQuery,
    hits: Vec<json::Value>,
    truncated: bool,
    error: Option<RumQueryError>,
    diagnostics: Option<RumQueryDiagnostics>,
}

impl QueryOutcome {
    fn failed(query: RumQuery, kind: RumQueryErrorKind, message: String) -> Self {
        Self {
            query,
            hits: Vec::new(),
            truncated: false,
            error: Some(RumQueryError {
                query,
                kind,
                message,
            }),
            diagnostics: None,
        }
    }

    /// Cuts the `limit + 1` sentinel row, which only signals truncation.
    fn from_response(
        query: RumQuery,
        range: (i64, i64),
        took: Duration,
        mut response: SearchResponse,
    ) -> Self {
        let truncated = response.hits.len() > query.limit();
        response.hits.truncate(query.limit());
        let error = response.is_partial.then(|| RumQueryError {
            query,
            kind: RumQueryErrorKind::Partial,
            message: if response.function_error.is_empty() {
                "search returned partial results".to_string()
            } else {
                response.function_error.join("; ")
            },
        });
        let diagnostics = RumQueryDiagnostics {
            query,
            start_time: range.0,
            end_time: range.1,
            took: took.as_millis() as usize,
            search_took: response.took_detail.search_took,
            wait_in_queue: response.took_detail.wait_in_queue,
            scan_files: response.scan_files,
            scan_size: response.scan_size,
            scan_records: response.scan_records,
            cached_ratio: response.cached_ratio,
            result_cache_ratio: response.result_cache_ratio,
            hits: response.hits.len(),
        };
        Self {
            query,
            hits: response.hits,
            truncated,
            error,
            diagnostics: Some(diagnostics),
        }
    }
}

struct LookupContext {
    org_id: String,
    stream: String,
    user_id: String,
    trace_id: String,
    deadline: Instant,
    max_query_range_us: i64,
}

impl LookupContext {
    async fn run(&self, query: RumQuery, sql: String, range: (i64, i64)) -> QueryOutcome {
        let started = Instant::now();
        let remaining = self.deadline.saturating_duration_since(started);
        if remaining.is_zero() {
            return QueryOutcome::failed(
                query,
                RumQueryErrorKind::Timeout,
                "lookup deadline passed before the query started".to_string(),
            );
        }
        let (range, range_error) = clamp_range(range, self.max_query_range_us);
        let request = rum_request(sql, query.limit(), range, remaining);
        let trace_id = format!("{}-{}", self.trace_id, query.as_str());
        let response = SearchService::cache::search(
            &trace_id,
            &self.org_id,
            StreamType::Logs,
            Some(self.user_id.clone()),
            &request,
            range_error,
            false,
            None,
            false,
        )
        .await;
        match response {
            Ok(response) => QueryOutcome::from_response(query, range, started.elapsed(), response),
            Err(e) => QueryOutcome::failed(query, error_kind(&e), e.to_string()),
        }
    }
}

struct PagePlan {
    view_ids: Vec<String>,
    action_ids: Vec<String>,
    range: (i64, i64),
}

impl PagePlan {
    /// Views come from every traced resource, the actions and time anchor from the first one.
    fn from_bridge(traced_resources: &[json::Value], trace_end: i64) -> Self {
        let mut view_ids: Vec<String> = Vec::new();
        for id in traced_resources
            .iter()
            .filter_map(|hit| id_string(&hit["view_id"]))
        {
            if !view_ids.contains(&id) {
                view_ids.push(id);
            }
        }
        let first = traced_resources.first();
        let anchor = first
            .and_then(|hit| date_us(&hit["date"]))
            .unwrap_or(trace_end);
        let action_ids = first
            .map(|hit| parse_action_ids(&hit["action_id"]))
            .unwrap_or_default();
        Self {
            view_ids,
            action_ids,
            range: (
                anchor.saturating_sub(PAGE_VIEW_WINDOW_US),
                anchor.saturating_add(PAGE_VIEW_WINDOW_US),
            ),
        }
    }
}

/// RumLookup
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    post,
    path = "/{org_id}/rum/lookup",
    context_path = "/api",
    tag = "Search",
    operation_id = "RumLookup",
    summary = "Find the RUM events linked to a trace",
    description = "Finds the browser requests that carry the trace id, then fetches their page views, actions and other page events in parallel. Each result set keeps its own order and limit; `truncated`, `errors` and `status` report what is missing.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = RumLookupRequest, description = "Trace id and backend span time range", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RumLookupResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 429, description = "Search not allowed now"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn lookup(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    Json(req): Json<RumLookupRequest>,
) -> Response {
    let started = Instant::now();
    if let Err(message) = validate(&req) {
        return MetaHttpResponse::bad_request(message);
    }
    let stream = req
        .rum_stream
        .as_deref()
        .map(str::trim)
        .filter(|stream| !stream.is_empty())
        .unwrap_or(RUM_DATA_STREAM)
        .to_string();
    let user_id = user_email.user_id;
    if let Err(response) = check_permission(&org_id, &stream, &user_id).await {
        return response;
    }
    // Bounded so the deadline arithmetic cannot overflow.
    let budget = req
        .timeout
        .unwrap_or(get_config().limit.query_timeout as i64)
        .min(MAX_TIMEOUT_SECS);
    let ctx = LookupContext {
        trace_id: get_or_create_trace_id(&headers, &Span::none()),
        deadline: started + Duration::from_secs(budget as u64),
        max_query_range_us: max_query_range_us(&org_id, &stream, &user_id).await,
        org_id,
        stream,
        user_id,
    };
    let mut response = run_lookup(&ctx, &req).await;
    response.diagnostics.took = started.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {}] rum lookup {}/{} status {:?}, partial {}, took {} ms",
        ctx.trace_id,
        ctx.org_id,
        ctx.stream,
        response.status,
        response.partial,
        response.diagnostics.took
    );
    Json(response).into_response()
}

async fn run_lookup(ctx: &LookupContext, req: &RumLookupRequest) -> RumLookupResponse {
    let Some(columns) = trace_id_columns(&ctx.org_id, &ctx.stream).await else {
        return RumLookupResponse::new(RumLookupStatus::Unavailable);
    };
    let mut response = RumLookupResponse::new(RumLookupStatus::NotFound);
    let bridge = ctx
        .run(
            RumQuery::TracedResources,
            bridge_sql(&ctx.stream, &columns, &trace_id_variants(&req.trace_id)),
            (
                req.start_time.saturating_sub(BRIDGE_LEAD_US),
                req.end_time.saturating_add(BRIDGE_LAG_US),
            ),
        )
        .await;
    response.record(bridge);
    if response.bridge.traced_resources.is_empty() {
        return response.finish(false);
    }

    let plan = PagePlan::from_bridge(&response.bridge.traced_resources, req.end_time);
    let views = async {
        if plan.view_ids.is_empty() {
            return None;
        }
        let sql = views_sql(&ctx.stream, &plan.view_ids);
        Some(ctx.run(RumQuery::Views, sql, plan.range).await)
    };
    let actions = async {
        if plan.action_ids.is_empty() {
            return None;
        }
        let sql = actions_sql(&ctx.stream, &plan.action_ids);
        Some(ctx.run(RumQuery::Actions, sql, plan.range).await)
    };
    let context_events = async {
        if plan.view_ids.is_empty() {
            return None;
        }
        let sql = context_events_sql(&ctx.stream, &plan.view_ids);
        Some(ctx.run(RumQuery::ContextEvents, sql, plan.range).await)
    };
    let (views, actions, context_events) = tokio::join!(views, actions, context_events);
    for outcome in [views, actions, context_events].into_iter().flatten() {
        response.record(outcome);
    }
    response.finish(true)
}

fn validate(req: &RumLookupRequest) -> Result<(), &'static str> {
    if req.trace_id.trim().is_empty() {
        return Err("trace_id is required");
    }
    if req.start_time <= 0 || req.end_time <= 0 {
        return Err("start_time and end_time must be positive microsecond timestamps");
    }
    if req.start_time > req.end_time {
        return Err("start_time must not be greater than end_time");
    }
    if req.timeout.is_some_and(|timeout| timeout <= 0) {
        return Err("timeout must be positive");
    }
    Ok(())
}

async fn check_permission(org_id: &str, stream: &str, user_id: &str) -> Result<(), Response> {
    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = search_service::check_search_allowed(org_id, Some(stream)) {
            return Err(MetaHttpResponse::too_many_requests(e.to_string()));
        }
        if let Some(response) = openobserve_core::authz::check_stream_permissions(
            stream,
            org_id,
            user_id,
            &StreamType::Logs,
            openobserve_core::authz::StreamPermissionResourceType::Search,
        )
        .await
        {
            return Err(response);
        }
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, stream, user_id);
    Ok(())
}

/// Matches `_search`, which clamps only streams that have settings.
async fn max_query_range_us(org_id: &str, stream: &str, user_id: &str) -> i64 {
    let Some(settings) = infra::schema::get_settings(org_id, stream, StreamType::Logs).await else {
        return 0;
    };
    get_settings_max_query_range(settings.max_query_range, org_id, Some(user_id))
        .await
        .saturating_mul(HOUR_US)
}

/// The trace id columns the stream has; naming a missing column fails the whole query.
async fn trace_id_columns(org_id: &str, stream: &str) -> Option<Vec<&'static str>> {
    let schema = match infra::schema::get_cache(org_id, stream, StreamType::Logs).await {
        Ok(schema) => schema,
        Err(e) => {
            log::warn!("[RUM] lookup could not load the schema of {org_id}/{stream}: {e}");
            return None;
        }
    };
    let columns = TRACE_ID_FIELDS
        .into_iter()
        .filter(|field| schema.contains_field(field))
        .collect::<Vec<_>>();
    (!columns.is_empty()).then_some(columns)
}

/// The padded id plus the zero-stripped form some SDK versions stored; non-hex ids match as given.
fn trace_id_variants(trace_id: &str) -> Vec<String> {
    let trimmed = trace_id.trim();
    let id = trimmed.to_ascii_lowercase();
    if id.len() > TRACE_ID_HEX_LENGTH || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return vec![trimmed.to_string()];
    }
    let canonical = format!("{id:0>TRACE_ID_HEX_LENGTH$}");
    let legacy = match canonical.trim_start_matches('0') {
        "" => "0",
        legacy => legacy,
    };
    if legacy == canonical {
        vec![canonical]
    } else {
        let legacy = legacy.to_string();
        vec![canonical, legacy]
    }
}

fn bridge_sql(stream: &str, columns: &[&str], trace_ids: &[String]) -> String {
    // OR of equalities rather than COALESCE so each column can use its own index.
    let predicate = columns
        .iter()
        .flat_map(|column| {
            trace_ids
                .iter()
                .map(move |id| format!("{column} = {}", quote_sql_string(id)))
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    format!(
        "SELECT * FROM {} WHERE ({predicate}) ORDER BY {TIMESTAMP_COL_NAME} ASC",
        quote_identifier(stream)
    )
}

/// Newest first: a view is re-sent on every update and only its last document is final.
fn views_sql(stream: &str, view_ids: &[String]) -> String {
    format!(
        "SELECT * FROM {} WHERE {} AND type = 'view' ORDER BY {TIMESTAMP_COL_NAME} DESC",
        quote_identifier(stream),
        key_in_predicate("view_id", view_ids.iter().map(String::as_str))
    )
}

fn actions_sql(stream: &str, action_ids: &[String]) -> String {
    format!(
        "SELECT * FROM {} WHERE {} AND type = 'action' ORDER BY {TIMESTAMP_COL_NAME} ASC",
        quote_identifier(stream),
        key_in_predicate("action_id", action_ids.iter().map(String::as_str))
    )
}

fn context_events_sql(stream: &str, view_ids: &[String]) -> String {
    format!(
        "SELECT * FROM {} WHERE {} AND type IN ('error', 'resource', 'long_task', 'action') ORDER BY {TIMESTAMP_COL_NAME} ASC",
        quote_identifier(stream),
        key_in_predicate("view_id", view_ids.iter().map(String::as_str))
    )
}

fn rum_request(sql: String, limit: usize, range: (i64, i64), budget: Duration) -> Request {
    Request {
        query: Query {
            sql,
            from: 0,
            size: limit as i64 + 1,
            start_time: range.0,
            end_time: range.1,
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
        timeout: budget.as_millis().div_ceil(1000) as i64,
        search_type: Some(SearchEventType::RUM),
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    }
}

fn clamp_range(range: (i64, i64), max_range_us: i64) -> ((i64, i64), String) {
    if max_range_us <= 0 || range.1.saturating_sub(range.0) <= max_range_us {
        return (range, String::new());
    }
    (
        (range.1 - max_range_us, range.1),
        format!(
            "Query duration is modified due to query range restriction of {} hours",
            max_range_us / HOUR_US
        ),
    )
}

fn error_kind(error: &Error) -> RumQueryErrorKind {
    match error {
        Error::ErrorCode(ErrorCodes::SearchTimeout(_)) => RumQueryErrorKind::Timeout,
        Error::ErrorCode(ErrorCodes::SearchCancelQuery(_)) => RumQueryErrorKind::Cancelled,
        _ => RumQueryErrorKind::Failed,
    }
}

fn id_string(value: &json::Value) -> Option<String> {
    match value {
        json::Value::String(id) if !id.is_empty() => Some(id.clone()),
        json::Value::Number(id) if id.as_f64() != Some(0.0) => Some(id.to_string()),
        _ => None,
    }
}

/// RUM `date` is in milliseconds, as a number or a numeric string.
fn date_us(value: &json::Value) -> Option<i64> {
    let ms = match value {
        json::Value::Number(ms) => ms.as_f64()?,
        json::Value::String(ms) => ms.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (ms > 0.0).then_some((ms * 1000.0) as i64)
}

/// `action_id` is stored as a JSON array encoded in a string.
fn parse_action_ids(value: &json::Value) -> Vec<String> {
    let Some(encoded) = value.as_str().filter(|encoded| !encoded.is_empty()) else {
        return Vec::new();
    };
    match json::from_str::<json::Value>(encoded) {
        Ok(json::Value::Array(ids)) => ids
            .into_iter()
            .map(|id| match id {
                json::Value::String(id) => id,
                other => other.to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn search_response(hits: usize) -> SearchResponse {
        let mut response = SearchResponse::new(0, hits as i64);
        response.hits = (0..hits).map(|i| json!({"i": i})).collect();
        response
    }

    #[test]
    fn test_trace_id_variants() {
        assert_eq!(
            trace_id_variants(" 00000000000000000123ABCDEF000000 "),
            vec!["00000000000000000123abcdef000000", "123abcdef000000"]
        );
        assert_eq!(
            trace_id_variants("abc"),
            vec!["00000000000000000000000000000abc", "abc"]
        );
        assert_eq!(
            trace_id_variants("4bf92f3577b34da6a3ce929d0e0e4736"),
            vec!["4bf92f3577b34da6a3ce929d0e0e4736"]
        );
        assert_eq!(
            trace_id_variants("0"),
            vec!["00000000000000000000000000000000", "0"]
        );
        assert_eq!(trace_id_variants("not-hex'"), vec!["not-hex'"]);
        assert_eq!(
            trace_id_variants("4bf92f3577b34da6a3ce929d0e0e47360"),
            vec!["4bf92f3577b34da6a3ce929d0e0e47360"]
        );
    }

    #[test]
    fn test_bridge_sql_covers_every_column_and_variant() {
        assert_eq!(
            bridge_sql(
                "_rumdata",
                &["_o2_trace_id", "_oo_trace_id"],
                &["0abc".to_string(), "abc".to_string()]
            ),
            "SELECT * FROM \"_rumdata\" WHERE (_o2_trace_id = '0abc' OR _o2_trace_id = 'abc' OR _oo_trace_id = '0abc' OR _oo_trace_id = 'abc') ORDER BY _timestamp ASC"
        );
        assert_eq!(
            bridge_sql("_rumdata", &["_oo_trace_id"], &["it's".to_string()]),
            "SELECT * FROM \"_rumdata\" WHERE (_oo_trace_id = 'it''s') ORDER BY _timestamp ASC"
        );
    }

    #[test]
    fn test_page_queries_keep_their_filters_and_order() {
        let ids = vec!["v1".to_string(), "v'2".to_string()];
        assert_eq!(
            views_sql("_rumdata", &ids),
            "SELECT * FROM \"_rumdata\" WHERE \"view_id\" IN ('v1', 'v''2') AND type = 'view' ORDER BY _timestamp DESC"
        );
        assert_eq!(
            actions_sql("_rumdata", &["a1".to_string()]),
            "SELECT * FROM \"_rumdata\" WHERE \"action_id\" IN ('a1') AND type = 'action' ORDER BY _timestamp ASC"
        );
        assert_eq!(
            context_events_sql("_rumdata", &ids),
            "SELECT * FROM \"_rumdata\" WHERE \"view_id\" IN ('v1', 'v''2') AND type IN ('error', 'resource', 'long_task', 'action') ORDER BY _timestamp ASC"
        );
    }

    #[test]
    fn test_page_plan_from_bridge() {
        let traced = vec![
            json!({"view_id": "v1", "date": 1_700_000_000_000i64, "action_id": "[\"a1\",\"a2\"]"}),
            json!({"view_id": "v2", "action_id": "[\"a3\"]"}),
            json!({"view_id": "v1"}),
            json!({"view_id": ""}),
        ];
        let plan = PagePlan::from_bridge(&traced, 5);
        assert_eq!(plan.view_ids, vec!["v1", "v2"]);
        assert_eq!(plan.action_ids, vec!["a1", "a2"]);
        assert_eq!(
            plan.range,
            (
                1_700_000_000_000_000 - PAGE_VIEW_WINDOW_US,
                1_700_000_000_000_000 + PAGE_VIEW_WINDOW_US
            )
        );
    }

    #[test]
    fn test_page_plan_falls_back_to_trace_end() {
        let traced = vec![json!({"view_id": "v1", "date": 0, "action_id": "not json"})];
        let plan = PagePlan::from_bridge(&traced, 10 * PAGE_VIEW_WINDOW_US);
        assert!(plan.action_ids.is_empty());
        assert_eq!(
            plan.range,
            (9 * PAGE_VIEW_WINDOW_US, 11 * PAGE_VIEW_WINDOW_US)
        );
        assert_eq!(
            date_us(&json!("1700000000000")),
            Some(1_700_000_000_000_000)
        );
        assert_eq!(date_us(&json!(null)), None);
    }

    #[test]
    fn test_outcome_drops_the_sentinel_row() {
        let outcome = QueryOutcome::from_response(
            RumQuery::Views,
            (1, 2),
            Duration::ZERO,
            search_response(51),
        );
        assert!(outcome.truncated);
        assert_eq!(outcome.hits.len(), 50);
        assert!(outcome.error.is_none());

        let outcome = QueryOutcome::from_response(
            RumQuery::Views,
            (1, 2),
            Duration::ZERO,
            search_response(50),
        );
        assert!(!outcome.truncated);
        assert_eq!(outcome.hits.len(), 50);
    }

    #[test]
    fn test_partial_search_is_an_error() {
        let mut response = search_response(1);
        response.is_partial = true;
        response.function_error = vec!["range clamped".to_string()];
        let outcome =
            QueryOutcome::from_response(RumQuery::Actions, (1, 2), Duration::ZERO, response);
        let error = outcome.error.unwrap();
        assert_eq!(error.kind, RumQueryErrorKind::Partial);
        assert_eq!(error.message, "range clamped");
        assert_eq!(outcome.hits.len(), 1);
    }

    #[test]
    fn test_finish_status() {
        let found = RumLookupResponse::new(RumLookupStatus::NotFound).finish(true);
        assert_eq!(found.status, RumLookupStatus::Found);
        assert!(!found.partial);

        let not_found = RumLookupResponse::new(RumLookupStatus::NotFound).finish(false);
        assert_eq!(not_found.status, RumLookupStatus::NotFound);

        let mut failed = RumLookupResponse::new(RumLookupStatus::NotFound);
        failed.record(QueryOutcome::failed(
            RumQuery::TracedResources,
            RumQueryErrorKind::Timeout,
            "timeout".to_string(),
        ));
        let failed = failed.finish(false);
        assert_eq!(failed.status, RumLookupStatus::Incomplete);
        assert!(failed.partial);

        let mut truncated = RumLookupResponse::new(RumLookupStatus::NotFound);
        truncated.record(QueryOutcome::from_response(
            RumQuery::ContextEvents,
            (1, 2),
            Duration::ZERO,
            search_response(251),
        ));
        let truncated = truncated.finish(true);
        assert_eq!(truncated.status, RumLookupStatus::Found);
        assert!(truncated.partial);
        assert!(truncated.truncated.context_events);
        assert_eq!(truncated.context_events.len(), 250);
    }

    #[test]
    fn test_clamp_range() {
        assert_eq!(
            clamp_range((0, 3 * HOUR_US), 0),
            ((0, 3 * HOUR_US), String::new())
        );
        assert_eq!(
            clamp_range((0, 3 * HOUR_US), 3 * HOUR_US),
            ((0, 3 * HOUR_US), String::new())
        );
        let (range, message) = clamp_range((0, 3 * HOUR_US), HOUR_US);
        assert_eq!(range, (2 * HOUR_US, 3 * HOUR_US));
        assert!(message.contains("1 hours"));
    }

    #[test]
    fn test_validate() {
        let request = |trace_id: &str, start_time, end_time, timeout| RumLookupRequest {
            trace_id: trace_id.to_string(),
            start_time,
            end_time,
            rum_stream: None,
            timeout,
        };
        assert!(validate(&request("abc", 1, 2, None)).is_ok());
        assert!(validate(&request(" ", 1, 2, None)).is_err());
        assert!(validate(&request("abc", 0, 2, None)).is_err());
        assert!(validate(&request("abc", 3, 2, None)).is_err());
        assert!(validate(&request("abc", 1, 2, Some(0))).is_err());
    }

    #[test]
    fn test_response_shape() {
        let response =
            serde_json::to_value(RumLookupResponse::new(RumLookupStatus::Unavailable)).unwrap();
        assert_eq!(response["status"], "unavailable");
        assert_eq!(response["bridge"]["traced_resources"], json!([]));
        assert_eq!(response["truncated"]["context_events"], false);
        assert_eq!(response["errors"], json!([]));
    }
}

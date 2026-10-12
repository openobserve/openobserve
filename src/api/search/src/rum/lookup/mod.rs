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

mod plan;
mod query;
mod response;

use std::time::Duration;

use axum::{
    Json,
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::{get_config, meta::stream::StreamType};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, rum::RUM_DATA_STREAM};
use plan::PagePlan;
use query::LookupContext;
pub use query::RumQuery;
pub use response::{
    RumBridge, RumLookupDiagnostics, RumLookupResponse, RumLookupStatus, RumLookupTruncated,
    RumQueryDiagnostics, RumQueryError, RumQueryErrorKind,
};
use search_service::query_range::get_settings_max_query_range;
use serde::Deserialize;
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
        trace_columns: trace_id_columns(&org_id, &stream).await,
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
    if ctx.trace_columns.is_empty() {
        return RumLookupResponse::new(RumLookupStatus::Unavailable);
    }
    let mut response = RumLookupResponse::new(RumLookupStatus::NotFound);
    let bridge_range = (
        req.start_time.saturating_sub(BRIDGE_LEAD_US),
        req.end_time.saturating_add(BRIDGE_LAG_US),
    );
    let trace_ids = trace_id_variants(&req.trace_id);
    if let Some(bridge) = ctx
        .run(RumQuery::TracedResources, &trace_ids, bridge_range)
        .await
    {
        response.record(bridge);
    }
    if response.bridge.traced_resources.is_empty() {
        return response.finish(false);
    }

    let plan = PagePlan::from_bridge(&response.bridge.traced_resources, req.end_time);
    let (views, actions, context_events) = tokio::join!(
        ctx.run(RumQuery::Views, &plan.view_ids, plan.range),
        ctx.run(RumQuery::Actions, &plan.action_ids, plan.range),
        ctx.run(RumQuery::ContextEvents, &plan.view_ids, plan.range),
    );
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
async fn trace_id_columns(org_id: &str, stream: &str) -> Vec<&'static str> {
    let schema = match infra::schema::get_cache(org_id, stream, StreamType::Logs).await {
        Ok(schema) => schema,
        Err(e) => {
            log::warn!("[RUM] lookup could not load the schema of {org_id}/{stream}: {e}");
            return Vec::new();
        }
    };
    TRACE_ID_FIELDS
        .into_iter()
        .filter(|field| schema.contains_field(field))
        .collect()
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

#[cfg(test)]
mod tests {
    use config::meta::search::Response as SearchResponse;
    use serde_json::json;

    use super::*;

    pub(super) fn search_response(hits: usize) -> SearchResponse {
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
}

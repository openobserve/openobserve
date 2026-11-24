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

//! Service Graph API - HTTP Handlers
//!
//! HTTP handlers for the service graph, read from the v4 metrics.

#[cfg(any(feature = "enterprise", test))]
use std::future::Future;

use axum::response::Response as HttpResponse;
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(any(feature = "enterprise", test))]
use config::meta::stream::StreamType;
use serde::Deserialize;

#[cfg(any(feature = "enterprise", test))]
use crate::authz::{
    StreamAccessChecker, check_each,
    list::{
        AuthzUnavailable, Bypass, Identity, LegacyChecks, ListMode, ObjectRef, ObjectsQuery,
        OrgWideCheck, SITE_SERVICE_GRAPH, ShadowComparison, StreamAnswer, StreamSet,
        answer_in_mode_with, type_answers,
    },
};

#[cfg(feature = "enterprise")]
const EDGE_HISTORY_WINDOW_MICROS: i64 = 24 * 60 * 60 * 1_000_000;
// Allows clock skew while keeping every bound far from i64 overflow in the step alignment.
#[cfg(any(feature = "enterprise", test))]
const MAX_FUTURE_MICROS: i64 = 24 * 60 * 60 * 1_000_000;
// A stream's own retention can outlast the global one, so the cap never drops below the default.
#[cfg(any(feature = "enterprise", test))]
const MIN_MAX_WINDOW_DAYS: i64 = 3650;
#[cfg(any(feature = "enterprise", test))]
const DAY_MICROS: i64 = 24 * 60 * 60 * 1_000_000;
#[cfg(any(feature = "enterprise", test))]
const TRACE_STREAM_PRELUDE: OrgWideCheck<'static> = OrgWideCheck {
    resource: "traces",
    permission: "GET",
    use_all_org: true,
    use_self_context: false,
    use_self_parent: false,
};

/// Query parameters for service graph API
#[derive(Debug, Deserialize)]
pub struct ServiceGraphQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub filter: Option<String>,
    pub stream_name: Option<String>,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_env: Option<String>,
}

/// The trace streams one request reads, after its user's stream permissions are applied.
#[cfg(any(feature = "enterprise", test))]
#[derive(Debug, PartialEq)]
struct StreamScope {
    trace_stream: Option<String>,
    /// `None` when the user may read every trace stream.
    visible_streams: Option<Vec<String>>,
}

/// GetCurrentTopology
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/topology/current",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetCurrentServiceGraphTopology",
    summary = "Get current service graph topology",
    description = "Returns the service graph topology for the time range (default: last 60 minutes), read from the service graph metrics. Only the trace streams the user may read are included.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start of the window (microseconds); with end_time, replaces the last 60 minutes"),
        ("end_time" = Option<i64>, Query, description = "End of the window (microseconds); with start_time, replaces the last 60 minutes"),
        ("stream_name" = Option<String>, Query, description = "Optional stream name to filter service graph topology"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::service_graph::ServiceGraphData),
        (status = 400, description = "Invalid time window (negative start_time, end_time not after start_time, end_time more than a day ahead, or longer than the data retention, at least 3650 days) or a stream name the metrics query cannot quote", content_type = "application/json", body = String),
        (status = 403, description = "Forbidden: an enterprise feature, or the user may not read the requested trace stream or any trace stream", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": true}))
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_current_topology(
    org_id: &str,
    user_id: &str,
    query: ServiceGraphQuery,
) -> HttpResponse {
    let (start_time, end_time) = match resolve_window(
        query.start_time,
        query.end_time,
        chrono::Utc::now().timestamp_micros(),
        super::DEFAULT_QUERY_WINDOW_MINUTES * 60 * 1_000_000,
        max_window_days(config::get_config().compact.data_retention_days),
    ) {
        Ok(window) => window,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    let readable = match readable_trace_streams(org_id, user_id).await {
        Ok(readable) => readable,
        Err(err) => return crate::authz::list::authz_unavailable_response(err),
    };
    let Some(scope) = scope_streams(trace_stream_filter(query.stream_name.clone()), readable)
    else {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    };
    let filter = v4_read_filter(&query, scope);
    if let Err(e) = filter.validate() {
        return MetaHttpResponse::bad_request(e);
    }
    match topology_v4(org_id, &filter, start_time, end_time).await {
        Ok(data) => MetaHttpResponse::json(data),
        Err(e) => {
            log::warn!("[ServiceGraph] v4 topology read failed for org '{org_id}': {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

#[cfg(feature = "enterprise")]
async fn topology_v4(
    org_id: &str,
    filter: &super::v4::read::ReadFilter,
    start_time: i64,
    end_time: i64,
) -> Result<config::meta::service_graph::ServiceGraphData, anyhow::Error> {
    use config::meta::service_graph::ServiceGraphData;

    use super::v4::read::fetch_topology;

    let (input, meta) = fetch_topology(org_id, filter, start_time, end_time).await?;
    let (nodes, edges) = o2_enterprise::enterprise::service_graph::build_topology_v4(input);
    Ok(ServiceGraphData {
        nodes,
        edges,
        meta: Some(meta),
    })
}

#[cfg(feature = "enterprise")]
fn v4_read_filter(query: &ServiceGraphQuery, scope: StreamScope) -> super::v4::read::ReadFilter {
    super::v4::read::ReadFilter {
        trace_stream: scope.trace_stream,
        agent_env: query.agent_env.clone().filter(|s| !s.is_empty()),
        visible_streams: scope.visible_streams,
    }
}

/// `stream_name=all` is the front end's "every stream" choice, not a stream.
#[cfg(feature = "enterprise")]
fn trace_stream_filter(stream_name: Option<String>) -> Option<String> {
    stream_name.filter(|s| !s.is_empty() && s != "all")
}

/// Query parameters for edge trend endpoint
#[derive(Debug, Deserialize)]
pub struct EdgeHistoryQuery {
    pub client_service: Option<String>,
    pub server_service: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream_name: Option<String>,
}

/// GetEdgeTrend (Enterprise)
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/edge/history",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetServiceGraphEdgeTrend",
    summary = "Get latency trend for a specific service graph edge",
    description = "Returns per-step request, error and client latency points for a client→server edge (default: last 24 hours). Only the trace streams the user may read are included.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("client_service" = Option<String>, Query, description = "Source service name"),
        ("server_service" = Option<String>, Query, description = "Target service name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream_name" = Option<String>, Query, description = "Trace stream filter"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::service_graph::EdgeTrendResponse),
        (status = 400, description = "Invalid time window (negative start_time, end_time not after start_time, end_time more than a day ahead, or longer than the data retention, at least 3650 days), or a service or stream name the metrics query cannot quote", content_type = "application/json", body = String),
        (status = 403, description = "Forbidden: an enterprise feature, or the user may not read the requested trace stream or any trace stream"),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_edge_history(
    org_id: &str,
    user_id: &str,
    query: EdgeHistoryQuery,
) -> HttpResponse {
    use config::meta::service_graph::EdgeTrendResponse;

    use super::v4::history::{EdgeFilter, fetch_edge_history};

    let (start_time, end_time) = match resolve_window(
        query.start_time,
        query.end_time,
        chrono::Utc::now().timestamp_micros(),
        EDGE_HISTORY_WINDOW_MICROS,
        max_window_days(config::get_config().compact.data_retention_days),
    ) {
        Ok(window) => window,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let readable = match readable_trace_streams(org_id, user_id).await {
        Ok(readable) => readable,
        Err(err) => return crate::authz::list::authz_unavailable_response(err),
    };
    let Some(scope) = scope_streams(trace_stream_filter(query.stream_name), readable) else {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    };
    let non_empty = |v: Option<String>| v.filter(|s| !s.is_empty());
    let filter = EdgeFilter {
        client: non_empty(query.client_service),
        server: non_empty(query.server_service),
        trace_stream: scope.trace_stream,
        visible_streams: scope.visible_streams,
    };
    if let Err(e) = filter.validate() {
        return MetaHttpResponse::bad_request(e);
    }
    match fetch_edge_history(org_id, &filter, start_time, end_time).await {
        Ok(data_points) => MetaHttpResponse::json(EdgeTrendResponse { data_points }),
        Err(e) => {
            log::error!("[ServiceGraph] Edge history query failed for org '{org_id}': {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

/// GetEdgeTrend (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
pub async fn get_edge_history(
    _org_id: &str,
    _user_id: &str,
    _query: EdgeHistoryQuery,
) -> HttpResponse {
    MetaHttpResponse::forbidden("Not Supported")
}

/// GetCurrentTopology (OSS - Not Supported)
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/topology/current",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetCurrentServiceGraphTopology",
    summary = "Get current service graph topology",
    description = "Returns the service graph topology (last 60 minutes). Enterprise feature only.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = Option<String>, Query, description = "Optional stream name to filter service graph topology"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"}))
    )
)]
#[cfg(not(feature = "enterprise"))]
pub async fn get_current_topology(
    _org_id: &str,
    _user_id: &str,
    _query: ServiceGraphQuery,
) -> HttpResponse {
    MetaHttpResponse::forbidden("Not Supported")
}

/// The trace streams `user_id` may read in `org_id`, sorted; `None` when it may read all of them.
#[cfg(feature = "enterprise")]
async fn readable_trace_streams(
    org_id: &str,
    user_id: &str,
) -> Result<Option<Vec<String>>, AuthzUnavailable> {
    let checker = crate::authz::active_checker();
    let placeholder = &config::get_config().common.dashboard_placeholder;
    readable_among(
        checker.as_ref(),
        &crate::authz::list::TodayChecks,
        org_id,
        user_id,
        || crate::db::schema::list_streams_from_cache(org_id, StreamType::Traces),
        placeholder,
    )
    .await
}

#[cfg(any(feature = "enterprise", test))]
async fn readable_among<F: Future<Output = Vec<String>>>(
    checker: &dyn StreamAccessChecker,
    checks: &dyn LegacyChecks,
    org_id: &str,
    user_id: &str,
    list: impl Fn() -> F,
    placeholder: &str,
) -> Result<Option<Vec<String>>, AuthzUnavailable> {
    let query = trace_stream_query(org_id, user_id);
    let streams = tokio::sync::OnceCell::<Vec<String>>::new();
    // Legacy owns the snapshot whenever its prelude requires stream checks.
    let legacy_list_ready = tokio::sync::Notify::new();
    let (readable, _) = answer_in_mode_with(
        checker,
        SITE_SERVICE_GRAPH,
        user_id,
        || {
            streams
                .get()
                .into_iter()
                .flatten()
                .filter(|stream| stream.as_str() != placeholder)
                .map(|stream| (StreamType::Traces, stream.clone()))
                .collect()
        },
        ShadowComparison::PreserveUnscoped(StreamType::Traces),
        || async {
            let readable = legacy_trace_stream_set(
                checker,
                checks,
                org_id,
                user_id,
                async {
                    streams
                        .get_or_init(|| {
                            legacy_list_ready.notify_one();
                            list()
                        })
                        .await
                        .as_slice()
                },
                placeholder,
            )
            .await;
            legacy_list_ready.notify_one();
            readable
        },
        |mode| {
            let streams = &streams;
            let list = &list;
            let legacy_list_ready = &legacy_list_ready;
            trace_stream_answers(
                checker,
                &query,
                async move {
                    if mode == ListMode::Shadow {
                        legacy_list_ready.notified().await;
                    }
                    streams.get_or_init(list).await.as_slice()
                },
                placeholder,
            )
        },
    )
    .await?;
    Ok(readable.map(|streams| {
        let mut names: Vec<_> = streams.into_iter().map(|(_, name)| name).collect();
        names.sort();
        names
    }))
}

#[cfg(any(feature = "enterprise", test))]
async fn trace_stream_answers<'s>(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    streams: impl Future<Output = &'s [String]>,
    placeholder: &str,
) -> StreamAnswer {
    let answers = type_answers(checker, query, &[StreamType::Traces]).await?;
    if answers.reads_every() {
        return Ok((None, answers));
    }
    let streams = streams.await;
    let objects: Vec<_> = streams
        .iter()
        .filter(|stream| stream.as_str() != placeholder)
        .map(|stream| ObjectRef::stream(StreamType::Traces, stream))
        .collect();
    let readable = answers.decide(checker, query.site, &objects).await?;
    Ok((readable.into_streams(), answers))
}

#[cfg(any(feature = "enterprise", test))]
fn trace_stream_query<'a>(org_id: &'a str, user_id: &'a str) -> ObjectsQuery<'a> {
    ObjectsQuery {
        site: SITE_SERVICE_GRAPH,
        org_id,
        user_id,
        stream_types: &[StreamType::Traces],
        permission: "GET",
        use_all_org: false,
        use_self_parent: true,
        use_self_context: false,
        parent_id: "",
        bypass: Bypass::RbacOffOrRoot,
        identity: Identity::StoredEmail,
        prelude: Some(TRACE_STREAM_PRELUDE),
    }
}

#[cfg(any(feature = "enterprise", test))]
async fn legacy_trace_stream_set<'s>(
    checker: &dyn StreamAccessChecker,
    checks: &dyn LegacyChecks,
    org_id: &str,
    user_id: &str,
    streams: impl Future<Output = &'s [String]>,
    placeholder: &str,
) -> Option<StreamSet> {
    // an org-wide reader keeps the unscoped graph, collector series included
    if checks
        .org_wide(org_id, user_id, &TRACE_STREAM_PRELUDE)
        .await
    {
        return None;
    }
    // the engine drops a matcher whose value is the placeholder, which would unscope the read
    let wanted = streams
        .await
        .iter()
        .filter(|stream| stream.as_str() != placeholder)
        .map(|stream| (StreamType::Traces, stream.clone()))
        .collect();
    Some(check_each(checker, user_id, org_id, wanted).await)
}

/// `None` when the user may read no requested stream, which the handlers answer with 403.
#[cfg(any(feature = "enterprise", test))]
fn scope_streams(requested: Option<String>, readable: Option<Vec<String>>) -> Option<StreamScope> {
    match (requested, readable) {
        (trace_stream, None) => Some(StreamScope {
            trace_stream,
            visible_streams: None,
        }),
        (Some(stream), Some(readable)) => readable.contains(&stream).then_some(StreamScope {
            trace_stream: Some(stream),
            visible_streams: Some(readable),
        }),
        (None, Some(readable)) => (!readable.is_empty()).then_some(StreamScope {
            trace_stream: None,
            visible_streams: Some(readable),
        }),
    }
}

/// The longest window a request may ask for: the global data retention, at least 3650 days.
#[cfg(any(feature = "enterprise", test))]
fn max_window_days(retention_days: i64) -> i64 {
    retention_days.max(MIN_MAX_WINDOW_DAYS)
}

#[cfg(any(feature = "enterprise", test))]
fn resolve_window(
    start: Option<i64>,
    end: Option<i64>,
    now: i64,
    default_span_micros: i64,
    max_days: i64,
) -> Result<(i64, i64), String> {
    let (Some(start), Some(end)) = (start, end) else {
        return Ok((now - default_span_micros, now));
    };
    if start < 0 {
        return Err("start_time must not be negative".to_string());
    }
    if end <= start {
        return Err("end_time must be after start_time".to_string());
    }
    if end > now.saturating_add(MAX_FUTURE_MICROS) {
        return Err("end_time must be at most one day after the current time".to_string());
    }
    if end - start > max_days.saturating_mul(DAY_MICROS) {
        return Err(format!(
            "the window from start_time to end_time must not exceed {max_days} days"
        ));
    }
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    use config::{meta::stream::StreamType, metrics::authz as metrics};

    use super::*;
    use crate::authz::{
        FakeStreamChecker, TypedStream,
        list::{CheckerChecks, ListMode, ListPolicy, SHADOW_TESTS, UnavailableReason},
        within_budget,
    };

    const NOW: i64 = 1_800_000_000_000_000;
    const SPAN: i64 = 3_600_000_000;
    const MAX_DAYS: i64 = 3650;
    const ORG: &str = "service-graph";
    const PLACEHOLDER: &str = "_o2_all_";

    #[derive(Default)]
    struct DelayedLegacyPrelude {
        finished: AtomicBool,
    }

    #[async_trait::async_trait]
    impl LegacyChecks for DelayedLegacyPrelude {
        async fn org_wide(&self, _org_id: &str, _user_id: &str, _check: &OrgWideCheck<'_>) -> bool {
            tokio::task::yield_now().await;
            self.finished.store(true, Ordering::Relaxed);
            false
        }

        async fn object(
            &self,
            _org_id: &str,
            _user_id: &str,
            _query: &ObjectsQuery<'_>,
            _object: &ObjectRef<'_>,
        ) -> bool {
            unreachable!("service graph uses the stream checker for per-stream checks")
        }
    }

    fn trace_streams() -> Vec<String> {
        ["c", "a", "b", PLACEHOLDER].map(str::to_string).to_vec()
    }

    fn grant_trace_read(checker: &FakeStreamChecker, user: &str, name: &str) {
        checker.grant_read(
            user,
            &TypedStream {
                org_id: ORG.to_string(),
                stream_type: StreamType::Traces,
                name: name.to_string(),
            },
        );
    }

    #[test]
    fn test_resolve_window_uses_an_explicit_window() {
        assert_eq!(
            resolve_window(Some(1_000), Some(2_000), NOW, SPAN, MAX_DAYS),
            Ok((1_000, 2_000))
        );
        assert_eq!(
            resolve_window(Some(0), Some(1), NOW, SPAN, MAX_DAYS),
            Ok((0, 1))
        );
    }

    #[test]
    fn test_resolve_window_rejects_a_negative_start() {
        assert!(resolve_window(Some(-1), Some(2_000), NOW, SPAN, MAX_DAYS).is_err());
        assert!(resolve_window(Some(i64::MIN), Some(i64::MAX), NOW, SPAN, MAX_DAYS).is_err());
    }

    #[test]
    fn test_resolve_window_rejects_an_end_not_after_the_start() {
        assert!(resolve_window(Some(2_189_567), Some(-1_358), NOW, SPAN, MAX_DAYS).is_err());
        assert!(resolve_window(Some(2_000), Some(2_000), NOW, SPAN, MAX_DAYS).is_err());
        assert!(resolve_window(Some(2_000), Some(1_999), NOW, SPAN, MAX_DAYS).is_err());
    }

    #[test]
    fn test_resolve_window_rejects_an_end_beyond_tomorrow_and_near_i64_max() {
        assert_eq!(
            resolve_window(
                Some(NOW),
                Some(NOW + MAX_FUTURE_MICROS),
                NOW,
                SPAN,
                MAX_DAYS
            ),
            Ok((NOW, NOW + MAX_FUTURE_MICROS))
        );
        assert!(
            resolve_window(
                Some(NOW),
                Some(NOW + MAX_FUTURE_MICROS + 1),
                NOW,
                SPAN,
                MAX_DAYS
            )
            .is_err()
        );
        assert!(resolve_window(Some(i64::MAX - 1), Some(i64::MAX), NOW, SPAN, MAX_DAYS).is_err());
        assert!(resolve_window(Some(0), Some(i64::MAX), NOW, SPAN, MAX_DAYS).is_err());
        assert!(resolve_window(Some(0), Some(1), i64::MAX, SPAN, MAX_DAYS).is_ok());
    }

    #[test]
    fn test_resolve_window_caps_the_span_at_the_given_days() {
        let max_span = MAX_DAYS * DAY_MICROS;
        assert_eq!(
            resolve_window(Some(NOW - max_span), Some(NOW), NOW, SPAN, MAX_DAYS),
            Ok((NOW - max_span, NOW))
        );
        let err =
            resolve_window(Some(NOW - max_span - 1), Some(NOW), NOW, SPAN, MAX_DAYS).unwrap_err();
        assert!(err.contains("3650 days"), "{err}");
        let longer = 7300 * DAY_MICROS;
        assert!(resolve_window(Some(NOW - longer), Some(NOW), NOW, SPAN, 7300).is_ok());
        assert!(resolve_window(Some(0), Some(NOW), NOW, SPAN, i64::MAX).is_ok());
    }

    #[test]
    fn test_max_window_days_follows_a_longer_retention() {
        assert_eq!(max_window_days(7300), 7300);
        assert_eq!(max_window_days(3650), 3650);
        assert_eq!(
            max_window_days(30),
            3650,
            "a stream may keep data longer than the default"
        );
        assert_eq!(max_window_days(0), 3650, "0 means unbounded retention");
        assert_eq!(max_window_days(-1), 3650);
    }

    #[test]
    fn test_resolve_window_defaults_when_a_bound_is_missing() {
        let default = Ok((NOW - SPAN, NOW));
        assert_eq!(resolve_window(None, None, NOW, SPAN, MAX_DAYS), default);
        assert_eq!(resolve_window(Some(-5), None, NOW, SPAN, MAX_DAYS), default);
        assert_eq!(resolve_window(None, Some(-5), NOW, SPAN, MAX_DAYS), default);
    }

    #[test]
    fn test_scope_streams_keeps_a_request_inside_the_readable_streams() {
        let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let scope = |requested: Option<&str>, readable: Option<&[&str]>| {
            scope_streams(requested.map(str::to_string), readable.map(names))
                .map(|s| (s.trace_stream, s.visible_streams))
        };
        let ab = names(&["a", "b"]);
        assert_eq!(scope(None, None), Some((None, None)));
        assert_eq!(scope(Some("a"), None), Some((Some("a".to_string()), None)));
        assert_eq!(
            scope(None, Some(&["a", "b"])),
            Some((None, Some(ab.clone())))
        );
        assert_eq!(
            scope(Some("a"), Some(&["a", "b"])),
            Some((Some("a".to_string()), Some(ab)))
        );
        assert_eq!(scope(Some("c"), Some(&["a", "b"])), None);
        assert_eq!(scope(None, Some(&[])), None);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_trace_query_matches_the_live_stream_check() {
        let query = trace_stream_query(ORG, "user");
        assert_eq!(query.permission, "GET");
        assert_eq!(query.identity, Identity::StoredEmail);
        assert!(query.use_self_parent);
        assert!(!query.use_self_context);
        assert!(!query.use_all_org);
        assert!(query.parent_id.is_empty());
    }

    #[tokio::test]
    async fn test_off_sends_the_prelude_before_listing_streams() {
        let checker = FakeStreamChecker::default();
        let scoped = "off-scoped@example.com";
        let wide = "off-wide@example.com";
        checker.grant_org_wide_check(wide, ORG, "traces");
        for user in [scoped, wide] {
            checker.set_list_mode(user, ListMode::Off);
            let snapshots = Mutex::new(Vec::new());
            let readable = readable_among(
                &checker,
                &CheckerChecks(&checker),
                ORG,
                user,
                || {
                    let calls = checker.calls(user);
                    snapshots
                        .lock()
                        .unwrap()
                        .push((calls.org_wide_checks, calls.streams));
                    std::future::ready(trace_streams())
                },
                PLACEHOLDER,
            )
            .await
            .unwrap();
            if user == scoped {
                assert_eq!(*snapshots.lock().unwrap(), vec![(1, 0)]);
                assert_eq!(readable, Some(vec![]));
            } else {
                assert!(snapshots.lock().unwrap().is_empty());
                assert_eq!(readable, None);
            }
        }
    }

    #[tokio::test]
    async fn test_on_lists_streams_only_after_a_scoped_type_answer() {
        let checker = FakeStreamChecker::default();
        let root = "on-root@example.com";
        let wide = "on-wide@example.com";
        let scoped = "on-scoped@example.com";
        checker.grant_root(root);
        checker.grant_org_wide_check(wide, ORG, "traces");
        checker.set_role(ORG, scoped, "custom");
        grant_trace_read(&checker, scoped, "a");
        for user in [root, wide, scoped] {
            checker.set_list_mode(user, ListMode::On);
            let snapshots = Mutex::new(Vec::new());
            let readable = readable_among(
                &checker,
                &CheckerChecks(&checker),
                ORG,
                user,
                || {
                    let calls = checker.calls(user);
                    snapshots
                        .lock()
                        .unwrap()
                        .push((calls.org_wide_checks, calls.types_access));
                    std::future::ready(trace_streams())
                },
                PLACEHOLDER,
            )
            .await
            .unwrap();
            if user == scoped {
                assert_eq!(*snapshots.lock().unwrap(), vec![(1, 1)]);
                assert_eq!(readable, Some(vec!["a".to_string()]));
            } else {
                assert!(snapshots.lock().unwrap().is_empty());
                assert_eq!(readable, None);
            }
        }
    }

    #[tokio::test]
    async fn test_shadow_lists_streams_at_most_once() {
        let _serial = SHADOW_TESTS.lock().await;
        let checker = FakeStreamChecker::default();
        let user = "shadow-lazy@example.com";
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        grant_trace_read(&checker, user, "a");
        let listings = AtomicUsize::new(0);
        let readable = readable_among(
            &checker,
            &CheckerChecks(&checker),
            ORG,
            user,
            || {
                listings.fetch_add(1, Ordering::Relaxed);
                std::future::ready(trace_streams())
            },
            PLACEHOLDER,
        )
        .await
        .unwrap();
        assert_eq!(readable, Some(vec!["a".to_string()]));
        assert_eq!(listings.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_shadow_snapshots_streams_after_the_legacy_prelude() {
        let _serial = SHADOW_TESTS.lock().await;
        let checker = FakeStreamChecker::default();
        let user = "shadow-legacy-snapshot@example.com";
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        for name in ["early", "late"] {
            grant_trace_read(&checker, user, name);
        }
        let checks = DelayedLegacyPrelude::default();
        let listings = AtomicUsize::new(0);
        let readable = readable_among(
            &checker,
            &checks,
            ORG,
            user,
            || {
                assert_eq!(checker.calls(user).types_access, 1);
                listings.fetch_add(1, Ordering::Relaxed);
                let mut snapshot = vec!["early".to_string()];
                if checks.finished.load(Ordering::Relaxed) {
                    snapshot.push("late".to_string());
                }
                std::future::ready(snapshot)
            },
            PLACEHOLDER,
        )
        .await
        .unwrap();

        assert_eq!(
            readable,
            Some(vec!["early".to_string(), "late".to_string()])
        );
        assert_eq!(listings.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_shadow_reports_unscoped_legacy_and_all_cached_streams_as_different() {
        let _serial = SHADOW_TESTS.lock().await;
        let checker = FakeStreamChecker::default();
        let legacy_checker = FakeStreamChecker::default();
        let user = "shadow-scope-mismatch@example.com";
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.grant_read_every_stream(user, ORG);
        legacy_checker.grant_org_wide_check(user, ORG, TRACE_STREAM_PRELUDE.resource);
        let mismatch = metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL.with_label_values(&[
            SITE_SERVICE_GRAPH,
            StreamType::Traces.as_str(),
            "new_allows_less",
        ]);
        let before = mismatch.get();

        let readable = readable_among(
            &checker,
            &CheckerChecks(&legacy_checker),
            ORG,
            user,
            || std::future::ready(trace_streams()),
            PLACEHOLDER,
        )
        .await
        .unwrap();

        assert_eq!(readable, None);
        assert_eq!(mismatch.get(), before + 1);
    }

    #[tokio::test]
    async fn test_readable_among_checks_each_stream_and_skips_the_placeholder() {
        let checker = FakeStreamChecker::default();
        let user = "placeholder@example.com";
        for name in ["a", "c", PLACEHOLDER] {
            grant_trace_read(&checker, user, name);
        }
        let checks = CheckerChecks(&checker);
        assert_eq!(
            readable_among(
                &checker,
                &checks,
                ORG,
                user,
                || std::future::ready(trace_streams()),
                PLACEHOLDER
            )
            .await
            .unwrap(),
            Some(vec!["a".to_string(), "c".to_string()])
        );
        assert_eq!(checker.calls(user).streams, 3);
        assert!(checker.calls(user).org_wide.is_empty());
        assert_eq!(
            readable_among(
                &checker,
                &checks,
                ORG,
                user,
                || std::future::ready(Vec::new()),
                PLACEHOLDER
            )
            .await
            .unwrap(),
            Some(vec![])
        );
    }

    #[tokio::test]
    async fn test_readable_among_on_matches_legacy_for_each_role() {
        let cases: [(&str, &str, bool, &[&str]); 5] = [
            ("user@example.com", "user", true, &["a", "c"]),
            ("custom@example.com", "custom", true, &["a", "c"]),
            ("editor@example.com", "editor", false, &["a", "b", "c"]),
            (ORG, "admin", false, &[]),
            (ORG, "admin", true, &["a", "c"]),
        ];
        for (user, role, granted, expected) in cases {
            let checker = FakeStreamChecker::default();
            checker.set_role(ORG, user, role);
            if role == "admin" {
                checker.grant_admin(ORG, user);
            }
            if granted {
                for name in ["a", "c", PLACEHOLDER] {
                    grant_trace_read(&checker, user, name);
                }
            }
            let checks = CheckerChecks(&checker);
            let legacy = readable_among(
                &checker,
                &checks,
                ORG,
                user,
                || std::future::ready(trace_streams()),
                PLACEHOLDER,
            )
            .await
            .unwrap();
            checker.set_list_mode(user, ListMode::On);
            let actual = readable_among(
                &checker,
                &checks,
                ORG,
                user,
                || std::future::ready(trace_streams()),
                PLACEHOLDER,
            )
            .await
            .unwrap();
            assert_eq!(actual, legacy, "{user}: {role}");
            assert_eq!(
                actual,
                Some(expected.iter().map(|name| name.to_string()).collect()),
                "{user}: {role}"
            );
        }
    }

    #[tokio::test]
    async fn test_readable_among_off_and_shadow_match_legacy() {
        let _serial = SHADOW_TESTS.lock().await;
        let checker = FakeStreamChecker::default();
        let user = "legacy@example.com";
        grant_trace_read(&checker, user, "a");
        let checks = CheckerChecks(&checker);
        let resolve = || {
            readable_among(
                &checker,
                &checks,
                ORG,
                user,
                || std::future::ready(trace_streams()),
                PLACEHOLDER,
            )
        };
        let legacy = resolve().await.unwrap();
        assert_eq!(legacy, Some(vec!["a".to_string()]));
        assert_eq!(checker.calls(user).types_access, 0);

        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.fail_types_access_once(user, UnavailableReason::Timeout);
        assert_eq!(resolve().await.unwrap(), legacy);
        assert_eq!(checker.calls(user).types_access, 1);
    }

    #[tokio::test]
    async fn test_readable_among_root_and_prelude_keep_an_unscoped_graph() {
        let checker = FakeStreamChecker::default();
        let root = "root@example.com";
        let reader = "wide@example.com";
        checker.grant_root(root);
        checker.grant_org_wide_check(reader, ORG, "traces");
        for user in [root, reader] {
            checker.set_list_mode(user, ListMode::On);
            assert_eq!(
                within_budget(
                    1,
                    readable_among(
                        &checker,
                        &CheckerChecks(&checker),
                        ORG,
                        user,
                        || std::future::ready(trace_streams()),
                        PLACEHOLDER,
                    ),
                )
                .await
                .unwrap(),
                None
            );
            assert_eq!(checker.calls(user).types_access, 0);
            assert_eq!(checker.calls(user).object_checks, 0);
        }
        assert_eq!(checker.calls(root).org_wide_checks, 0);
        assert_eq!(checker.calls(reader).org_wide_checks, 1);
    }

    #[tokio::test]
    async fn test_readable_among_probe_all_keeps_a_scoped_graph() {
        let checker = FakeStreamChecker::default();
        let user = "all-streams@example.com";
        checker.set_list_mode(user, ListMode::On);
        checker.grant_read_every_stream(user, ORG);
        assert_eq!(
            within_budget(
                5,
                readable_among(
                    &checker,
                    &CheckerChecks(&checker),
                    ORG,
                    user,
                    || std::future::ready(trace_streams()),
                    PLACEHOLDER,
                ),
            )
            .await
            .unwrap(),
            Some(["a", "b", "c"].map(str::to_string).to_vec())
        );
        assert_eq!(checker.calls(user).lists, 0);
        assert_eq!(checker.calls(user).object_checks, 0);
    }

    #[tokio::test]
    async fn test_readable_among_stays_within_five_calls() {
        let checker = FakeStreamChecker::default();
        let user = "budget@example.com";
        checker.set_role(ORG, user, "custom");
        checker.set_list_mode(user, ListMode::On);
        let mut streams: Vec<String> = (0..2000).rev().map(|i| format!("stream_{i:04}")).collect();
        let mut expected: Vec<String> = streams.iter().step_by(2).cloned().collect();
        for name in &expected {
            grant_trace_read(&checker, user, name);
        }
        expected.sort();
        streams.push(PLACEHOLDER.to_string());
        let readable = within_budget(
            5,
            readable_among(
                &checker,
                &CheckerChecks(&checker),
                ORG,
                user,
                || std::future::ready(streams.clone()),
                PLACEHOLDER,
            ),
        )
        .await
        .unwrap();
        assert_eq!(readable, Some(expected));
        let calls = checker.calls(user);
        assert!(calls.total() <= 5, "{calls:?}");
        assert_eq!(calls.lists, 1);
        assert_eq!(calls.object_checks, 0);
        assert_eq!(calls.stored_email_types, 1);
    }

    #[tokio::test]
    async fn test_readable_among_on_propagates_authz_failures() {
        let failures: [fn(&FakeStreamChecker, &str, UnavailableReason); 3] = [
            FakeStreamChecker::fail_org_wide_check_once,
            FakeStreamChecker::fail_types_access_once,
            FakeStreamChecker::fail_list_once,
        ];
        for fail in failures {
            let checker = FakeStreamChecker::default();
            let user = "failure@example.com";
            checker.set_list_mode(user, ListMode::On);
            fail(&checker, user, UnavailableReason::Timeout);
            let err = within_budget(
                5,
                readable_among(
                    &checker,
                    &CheckerChecks(&checker),
                    ORG,
                    user,
                    || std::future::ready(trace_streams()),
                    PLACEHOLDER,
                ),
            )
            .await
            .unwrap_err();
            assert_eq!(err.reason, UnavailableReason::Timeout);
        }
    }

    #[tokio::test]
    async fn test_readable_among_on_propagates_fallback_failure() {
        let checker = FakeStreamChecker::default();
        let user = "fallback-failure@example.com";
        checker.set_list_mode(user, ListMode::On);
        checker.set_list_policy(user, ListPolicy::Disabled);
        checker.fail_object_check_once(user, UnavailableReason::Timeout);
        let result = readable_among(
            &checker,
            &CheckerChecks(&checker),
            ORG,
            user,
            || std::future::ready(trace_streams()),
            PLACEHOLDER,
        )
        .await;
        assert_eq!(result.unwrap_err().reason, UnavailableReason::Timeout);
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    async fn assert_authz_unavailable_response(response: HttpResponse) {
        assert_eq!(
            response.status(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(response.headers()["retry-after"], "3");
        assert_eq!(response.headers()["x-o2-authz"], "unavailable");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({
                "code": 503,
                "error_code": "authz_unavailable",
                "message": "Permission service unavailable, try again",
            })
        );
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn test_handlers_return_authz_unavailable_with_503() {
        let checker = crate::authz::fake_checker();
        let user = "service-graph-handler-failure@example.com";
        checker.set_list_mode(user, ListMode::On);
        checker.fail_org_wide_check_once(user, UnavailableReason::Timeout);
        let topology = within_budget(
            5,
            get_current_topology(
                ORG,
                user,
                ServiceGraphQuery {
                    start_time: None,
                    end_time: None,
                    filter: None,
                    stream_name: None,
                    agent_id: None,
                    agent_name: None,
                    agent_env: None,
                },
            ),
        )
        .await;
        assert_authz_unavailable_response(topology).await;

        checker.fail_org_wide_check_once(user, UnavailableReason::Timeout);
        let history = within_budget(
            5,
            get_edge_history(
                ORG,
                user,
                EdgeHistoryQuery {
                    client_service: None,
                    server_service: None,
                    start_time: None,
                    end_time: None,
                    stream_name: None,
                },
            ),
        )
        .await;
        assert_authz_unavailable_response(history).await;
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_v4_read_filter_maps_scope_and_env_only() {
        let query = |stream: Option<&str>, env: Option<&str>| ServiceGraphQuery {
            start_time: None,
            end_time: None,
            filter: None,
            stream_name: stream.map(str::to_string),
            agent_id: Some("id".to_string()),
            agent_name: Some("name".to_string()),
            agent_env: env.map(str::to_string),
        };
        assert_eq!(trace_stream_filter(Some("all".to_string())), None);
        assert_eq!(trace_stream_filter(Some(String::new())), None);
        let unscoped = || StreamScope {
            trace_stream: None,
            visible_streams: None,
        };
        assert!(v4_read_filter(&query(None, Some("")), unscoped()).is_empty());
        let f = v4_read_filter(
            &query(Some("ignored"), Some("prod")),
            StreamScope {
                trace_stream: Some("default".to_string()),
                visible_streams: Some(vec!["default".to_string()]),
            },
        );
        assert_eq!(f.trace_stream.as_deref(), Some("default"));
        assert_eq!(f.agent_env.as_deref(), Some("prod"));
        assert_eq!(f.visible_streams, Some(vec!["default".to_string()]));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_handlers_reject_an_invalid_window_with_400() {
        let topology = get_current_topology(
            "default",
            "root@example.com",
            ServiceGraphQuery {
                start_time: Some(2_189_567),
                end_time: Some(-1_358),
                filter: None,
                stream_name: None,
                agent_id: None,
                agent_name: None,
                agent_env: None,
            },
        )
        .await;
        assert_eq!(topology.status(), axum::http::StatusCode::BAD_REQUEST);

        let history = get_edge_history(
            "default",
            "root@example.com",
            EdgeHistoryQuery {
                client_service: None,
                server_service: None,
                start_time: Some(-1),
                end_time: Some(10),
                stream_name: None,
            },
        )
        .await;
        assert_eq!(history.status(), axum::http::StatusCode::BAD_REQUEST);

        let near_max = get_edge_history(
            "default",
            "root@example.com",
            EdgeHistoryQuery {
                client_service: None,
                server_service: None,
                start_time: Some(i64::MAX - 1),
                end_time: Some(i64::MAX),
                stream_name: None,
            },
        )
        .await;
        assert_eq!(near_max.status(), axum::http::StatusCode::BAD_REQUEST);

        let near_max_topology = get_current_topology(
            "default",
            "root@example.com",
            ServiceGraphQuery {
                start_time: Some(i64::MAX - 1),
                end_time: Some(i64::MAX),
                filter: None,
                stream_name: None,
                agent_id: None,
                agent_name: None,
                agent_env: None,
            },
        )
        .await;
        assert_eq!(
            near_max_topology.status(),
            axum::http::StatusCode::BAD_REQUEST
        );
    }
}

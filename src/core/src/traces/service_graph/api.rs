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

use axum::response::Response as HttpResponse;
use common::meta::http::HttpResponse as MetaHttpResponse;
use serde::Deserialize;

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

/// GetCurrentTopology
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/topology/current",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetCurrentServiceGraphTopology",
    summary = "Get current service graph topology",
    description = "Returns the service graph topology for the time range (default: last 60 minutes), read from the service graph metrics.",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time window (negative start_time, end_time not after start_time, end_time more than a day ahead, or longer than the data retention, at least 3650 days) or a stream name the metrics query cannot quote", content_type = "application/json", body = String),
        (status = 403, description = "Forbidden - Enterprise feature", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "service_graph_topology"}))
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_current_topology(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<ServiceGraphQuery>,
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

    let filter = v4_read_filter(&query);
    if let Err(e) = filter.validate() {
        return MetaHttpResponse::bad_request(e);
    }
    match topology_v4(&org_id, &filter, start_time, end_time).await {
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
fn v4_read_filter(query: &ServiceGraphQuery) -> super::v4::read::ReadFilter {
    super::v4::read::ReadFilter {
        trace_stream: trace_stream_filter(query.stream_name.clone()),
        agent_env: query.agent_env.clone().filter(|s| !s.is_empty()),
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
    description = "Returns per-step request, error and client latency points for a client→server edge (default: last 24 hours).",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time window (negative start_time, end_time not after start_time, end_time more than a day ahead, or longer than the data retention, at least 3650 days), or a service or stream name the metrics query cannot quote", content_type = "application/json", body = String),
        (status = 403, description = "Forbidden - Enterprise feature"),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
)]
#[cfg(feature = "enterprise")]
pub async fn get_edge_history(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<EdgeHistoryQuery>,
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
    let non_empty = |v: Option<String>| v.filter(|s| !s.is_empty());
    let filter = EdgeFilter {
        client: non_empty(query.client_service),
        server: non_empty(query.server_service),
        trace_stream: trace_stream_filter(query.stream_name),
    };
    if let Err(e) = filter.validate() {
        return MetaHttpResponse::bad_request(e);
    }
    match fetch_edge_history(&org_id, &filter, start_time, end_time).await {
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
    axum::extract::Path(_org_id): axum::extract::Path<String>,
    axum::extract::Query(_query): axum::extract::Query<EdgeHistoryQuery>,
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
)]
#[cfg(not(feature = "enterprise"))]
pub async fn get_current_topology(
    axum::extract::Path(_org_id): axum::extract::Path<String>,
    axum::extract::Query(_query): axum::extract::Query<ServiceGraphQuery>,
) -> HttpResponse {
    MetaHttpResponse::forbidden("Not Supported")
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
    use super::*;

    const NOW: i64 = 1_800_000_000_000_000;
    const SPAN: i64 = 3_600_000_000;
    const MAX_DAYS: i64 = 3650;

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

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_v4_read_filter_maps_stream_and_env_only() {
        let query = |stream: Option<&str>, env: Option<&str>| ServiceGraphQuery {
            start_time: None,
            end_time: None,
            filter: None,
            stream_name: stream.map(str::to_string),
            agent_id: Some("id".to_string()),
            agent_name: Some("name".to_string()),
            agent_env: env.map(str::to_string),
        };
        let f = v4_read_filter(&query(None, None));
        assert!(f.is_empty());
        let f = v4_read_filter(&query(Some("all"), Some("")));
        assert!(f.is_empty());
        let f = v4_read_filter(&query(Some(""), None));
        assert!(f.is_empty());
        let f = v4_read_filter(&query(Some("default"), Some("prod")));
        assert_eq!(f.trace_stream.as_deref(), Some("default"));
        assert_eq!(f.agent_env.as_deref(), Some("prod"));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_handlers_reject_an_invalid_window_with_400() {
        use axum::extract::{Path, Query};

        let topology = get_current_topology(
            Path("default".to_string()),
            Query(ServiceGraphQuery {
                start_time: Some(2_189_567),
                end_time: Some(-1_358),
                filter: None,
                stream_name: None,
                agent_id: None,
                agent_name: None,
                agent_env: None,
            }),
        )
        .await;
        assert_eq!(topology.status(), axum::http::StatusCode::BAD_REQUEST);

        let history = get_edge_history(
            Path("default".to_string()),
            Query(EdgeHistoryQuery {
                client_service: None,
                server_service: None,
                start_time: Some(-1),
                end_time: Some(10),
                stream_name: None,
            }),
        )
        .await;
        assert_eq!(history.status(), axum::http::StatusCode::BAD_REQUEST);

        let near_max = get_edge_history(
            Path("default".to_string()),
            Query(EdgeHistoryQuery {
                client_service: None,
                server_service: None,
                start_time: Some(i64::MAX - 1),
                end_time: Some(i64::MAX),
                stream_name: None,
            }),
        )
        .await;
        assert_eq!(near_max.status(), axum::http::StatusCode::BAD_REQUEST);

        let near_max_topology = get_current_topology(
            Path("default".to_string()),
            Query(ServiceGraphQuery {
                start_time: Some(i64::MAX - 1),
                end_time: Some(i64::MAX),
                filter: None,
                stream_name: None,
                agent_id: None,
                agent_name: None,
                agent_env: None,
            }),
        )
        .await;
        assert_eq!(
            near_max_topology.status(),
            axum::http::StatusCode::BAD_REQUEST
        );
    }
}

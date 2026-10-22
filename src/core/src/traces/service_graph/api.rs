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
        ("stream_name" = Option<String>, Query, description = "Optional stream name to filter service graph topology"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
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
    // Resolve the current window boundaries
    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_micros = super::DEFAULT_QUERY_WINDOW_MINUTES * 60 * 1_000_000;
            (now - window_micros, now)
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
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
)]
#[cfg(feature = "enterprise")]
pub async fn get_edge_history(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<EdgeHistoryQuery>,
) -> HttpResponse {
    use config::meta::service_graph::EdgeTrendResponse;

    use super::v4::history::{EdgeFilter, fetch_edge_history};

    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            (now - 24 * 60 * 60 * 1_000_000, now)
        };
    let non_empty = |v: Option<String>| v.filter(|s| !s.is_empty());
    let filter = EdgeFilter {
        client: non_empty(query.client_service),
        server: non_empty(query.server_service),
        trace_stream: trace_stream_filter(query.stream_name),
    };
    let matcher = match filter.matcher() {
        Ok(m) => m,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    match fetch_edge_history(&org_id, &matcher, start_time, end_time).await {
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

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::*;

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
}

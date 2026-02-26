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
//! HTTP handlers for service graph topology queries.
//! Business logic is in enterprise crate.

use axum::response::Response as HttpResponse;
use serde::Deserialize;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Query parameters for service graph API
#[derive(Debug, Deserialize)]
pub struct ServiceGraphQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub filter: Option<String>,
    pub stream_name: Option<String>,
}

/// GetCurrentTopology
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/topology/current",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetCurrentServiceGraphTopology",
    summary = "Get current service graph topology",
    description = "Returns service graph topology from stream storage (last 60 minutes). Stream-only - NO in-memory metrics.",
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
    use config::meta::service_graph::ServiceGraphData;

    // Resolve the current window boundaries
    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_minutes = o2_enterprise::enterprise::common::config::get_config()
                .service_graph
                .query_time_range_minutes;
            let window_micros = window_minutes * 60 * 1_000_000;
            (now - window_micros, now)
        };

    // 1. Query current window
    let edges = match query_edges_from_stream_internal(
        &org_id,
        query.stream_name.as_deref(),
        Some(start_time),
        Some(end_time),
    )
    .await
    {
        Ok(edges) => edges,
        Err(e) => {
            log::debug!(
                "[ServiceGraph] Stream query failed (likely stream doesn't exist yet): {}",
                e
            );
            return MetaHttpResponse::json(ServiceGraphData {
                nodes: vec![],
                edges: vec![],
            });
        }
    };

    if edges.is_empty() {
        log::debug!(
            "[ServiceGraph] No edges found for org '{}'",
            org_id.as_str()
        );
        return MetaHttpResponse::json(ServiceGraphData {
            nodes: vec![],
            edges: vec![],
        });
    }

    // 2. Query previous slot (same duration, one slot older) for baselines
    let duration = end_time - start_time;
    let prev_start = start_time - duration;
    let prev_end = start_time;

    log::debug!(
        "[ServiceGraph] Querying previous slot for baselines: [{}, {}) (duration={}μs)",
        prev_start,
        prev_end,
        duration
    );

    let prev_edges = query_edges_from_stream_internal(
        &org_id,
        query.stream_name.as_deref(),
        Some(prev_start),
        Some(prev_end),
    )
    .await
    .unwrap_or_else(|e| {
        log::debug!(
            "[ServiceGraph] Previous-slot query failed (non-fatal): {}",
            e
        );
        vec![]
    });

    log::debug!(
        "[ServiceGraph] Previous-slot returned {} records, current slot has {} records",
        prev_edges.len(),
        edges.len()
    );

    // Aggregate previous-slot edges into a per-(client,server) weighted-average map
    let baselines = aggregate_baselines(prev_edges);

    log::debug!(
        "[ServiceGraph] Baselines computed for {} edges",
        baselines.len()
    );

    log::debug!(
        "[ServiceGraph] Processing {} edge records for org '{}'",
        edges.len(),
        &org_id
    );

    let (nodes, edges) = o2_enterprise::enterprise::service_graph::build_topology(edges, baselines);

    MetaHttpResponse::json(ServiceGraphData { nodes, edges })
}

/// Aggregate raw edge records from a slot into a per-(client,server) weighted-average
/// baseline map: (client_service, server_service) → (p50, p95, p99).
#[cfg(feature = "enterprise")]
fn aggregate_baselines(
    records: Vec<serde_json::Value>,
) -> std::collections::HashMap<(Option<String>, String), (u64, u64, u64)> {
    type EdgeKey = (Option<String>, String);
    type WeightedSums = (u64, u64, u64, u64); // (sum_p50*req, sum_p95*req, sum_p99*req, total_req)

    let mut acc: std::collections::HashMap<EdgeKey, WeightedSums> =
        std::collections::HashMap::new();

    let get = |k: &str, hit: &serde_json::Value| {
        hit.get(k)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(0.0) as u64
    };

    for hit in records {
        let client = hit
            .get("client_service")
            .and_then(|v| v.as_str())
            .map(String::from);
        let server = match hit.get("server_service").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let p50 = get("p50_latency_ns", &hit);
        let p95 = get("p95_latency_ns", &hit);
        let p99 = get("p99_latency_ns", &hit);
        let req = get("total_requests", &hit);

        let e = acc.entry((client, server)).or_insert((0, 0, 0, 0));
        e.0 += p50.saturating_mul(req);
        e.1 += p95.saturating_mul(req);
        e.2 += p99.saturating_mul(req);
        e.3 += req;
    }

    acc.into_iter()
        .filter_map(|(key, (sp50, sp95, sp99, total))| {
            if total == 0 {
                return None;
            }
            Some((key, (sp50 / total, sp95 / total, sp99 / total)))
        })
        .collect()
}

#[cfg(feature = "enterprise")]
/// Query edge records from the _o2_service_graph stream
///
/// Internal version exposed for incident topology enrichment.
/// Supports optional custom time range via start_time/end_time parameters.
pub async fn query_edges_from_stream_internal(
    org_id: &str,
    stream_filter: Option<&str>,
    custom_start_time: Option<i64>,
    custom_end_time: Option<i64>,
) -> Result<Vec<serde_json::Value>, infra::errors::Error> {
    use config::meta::stream::StreamType;

    let stream_name = "_o2_service_graph";

    // Use custom time range if provided, otherwise fall back to configured window
    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (custom_start_time, custom_end_time) {
            (start, end)
        } else {
            // Use configured time range (same as processor)
            let now = chrono::Utc::now().timestamp_micros();
            let window_minutes = o2_enterprise::enterprise::common::config::get_config()
                .service_graph
                .query_time_range_minutes;
            let window_micros = window_minutes * 60 * 1_000_000;
            (now - window_micros, now)
        };

    // Query pre-aggregated edge state (already summarized per minute)
    let sql = if let Some(stream) = stream_filter {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {} AND _timestamp < {}
             AND org_id = '{}'
             AND trace_stream_name = '{}'
             LIMIT 10000",
            stream_name, start_time, end_time, org_id, stream
        )
    } else {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {} AND _timestamp < {}
             AND org_id = '{}'
             LIMIT 10000",
            stream_name, start_time, end_time, org_id
        )
    };

    // Build search request
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: sql.clone(),
            from: 0,
            size: 100000,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
    };

    // Check if stream exists (using Logs type since we write as logs stream)
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        log::debug!(
            "[ServiceGraph] Stream '{}' does not exist yet for org '{}'",
            stream_name,
            org_id
        );
        return Ok(Vec::new());
    }

    // Execute search
    let trace_id = config::ider::generate();
    let resp = crate::service::search::search(&trace_id, org_id, StreamType::Logs, None, &req)
        .await
        .map_err(|e| {
            log::error!("[ServiceGraph] Stream query failed: {}", e);
            infra::errors::Error::ErrorCode(infra::errors::ErrorCodes::SearchStreamNotFound(
                stream_name.to_string(),
            ))
        })?;

    log::debug!(
        "[ServiceGraph] Retrieved {} edge records from stream for org '{}'",
        resp.hits.len(),
        org_id
    );

    Ok(resp.hits)
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
    description = "Returns raw time-series latency records for a client→server edge, plus 24h weighted-average baselines.",
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
    use config::meta::{
        service_graph::{EdgeTrendDataPoint, EdgeTrendResponse},
        stream::StreamType,
    };

    let stream_name = "_o2_service_graph";

    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_24h = 24 * 60 * 60 * 1_000_000i64;
            (now - window_24h, now)
        };

    let mut filters = format!(
        "_timestamp >= {} AND _timestamp < {} AND org_id = '{}'",
        start_time, end_time, org_id
    );
    if let Some(ref client) = query.client_service {
        filters.push_str(&format!(" AND client_service = '{}'", client));
    }
    if let Some(ref server) = query.server_service {
        filters.push_str(&format!(" AND server_service = '{}'", server));
    }
    if let Some(ref stream) = query.stream_name {
        filters.push_str(&format!(" AND trace_stream_name = '{}'", stream));
    }

    let sql = format!(
        "SELECT _timestamp, p50_latency_ns, p95_latency_ns, p99_latency_ns, \
         total_requests, failed_requests \
         FROM \"{}\" WHERE {} ORDER BY _timestamp ASC LIMIT 10000",
        stream_name, filters
    );

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 10000,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
    };

    // Return empty if stream doesn't exist yet
    let schema = infra::schema::get(&org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        return MetaHttpResponse::json(EdgeTrendResponse {
            data_points: vec![],
        });
    }

    let trace_id = config::ider::generate();
    let resp = match crate::service::search::search(
        &trace_id,
        &org_id,
        StreamType::Logs,
        None,
        &req,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("[ServiceGraph] Edge history query failed: {}", e);
            return MetaHttpResponse::json(EdgeTrendResponse {
                data_points: vec![],
            });
        }
    };

    let data_points: Vec<EdgeTrendDataPoint> = resp
        .hits
        .into_iter()
        .filter_map(|hit| {
            Some(EdgeTrendDataPoint {
                timestamp: hit.get("_timestamp")?.as_i64()?,
                p50_latency_ns: hit
                    .get("p50_latency_ns")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as u64,
                p95_latency_ns: hit
                    .get("p95_latency_ns")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as u64,
                p99_latency_ns: hit
                    .get("p99_latency_ns")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as u64,
                total_requests: hit
                    .get("total_requests")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as u64,
                failed_requests: hit
                    .get("failed_requests")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as u64,
            })
        })
        .collect();

    MetaHttpResponse::json(EdgeTrendResponse { data_points })
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
    description = "Returns service graph topology from stream storage (last 60 minutes). Enterprise feature only.",
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

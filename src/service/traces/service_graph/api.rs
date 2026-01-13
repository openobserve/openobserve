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

    // Query edges from stream (last 60 minutes by default)
    let edges = match query_edges_from_stream_internal(&org_id, query.stream_name.as_deref()).await
    {
        Ok(edges) => edges,
        Err(e) => {
            // Stream doesn't exist yet or query failed - return empty topology gracefully
            log::debug!(
                "[ServiceGraph] Stream query failed (likely stream doesn't exist yet): {}",
                e
            );
            return MetaHttpResponse::json(serde_json::json!({
                "nodes": vec![] as Vec<()>,
                "edges": vec![] as Vec<()>,
                "availableStreams": vec![] as Vec<String>,
            }));
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

    log::debug!(
        "[ServiceGraph] Processing {} edge records for org '{}'",
        edges.len(),
        &org_id
    );

    // Use enterprise business logic to build topology
    let (nodes, edges, available_streams) =
        o2_enterprise::enterprise::service_graph::build_topology(edges);

    MetaHttpResponse::json(serde_json::json!({
        "nodes": nodes,
        "edges": edges,
        "availableStreams": available_streams,
    }))
}

#[cfg(feature = "enterprise")]
/// Query edge records from the _o2_service_graph stream
///
/// Internal version exposed for incident topology enrichment.
pub async fn query_edges_from_stream_internal(
    org_id: &str,
    stream_filter: Option<&str>,
) -> Result<Vec<serde_json::Value>, infra::errors::Error> {
    use config::meta::stream::StreamType;

    let stream_name = "_o2_service_graph";

    // Use configured time range (same as processor)
    let now = chrono::Utc::now().timestamp_micros();
    let window_minutes = o2_enterprise::enterprise::common::config::get_config()
        .service_graph
        .query_time_range_minutes;
    let window_micros = window_minutes * 60 * 1_000_000;
    let start_time = now - window_micros;

    // Query pre-aggregated edge state (already summarized per minute)
    let sql = if let Some(stream) = stream_filter {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {}
             AND org_id = '{}'
             AND trace_stream_name = '{}'
             LIMIT 10000",
            stream_name, start_time, org_id, stream
        )
    } else {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {}
             AND org_id = '{}'
             LIMIT 10000",
            stream_name, start_time, org_id
        )
    };

    // Build search request
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: sql.clone(),
            from: 0,
            size: 100000,
            start_time,
            end_time: now,
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

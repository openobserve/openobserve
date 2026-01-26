// Copyright 2025 OpenObserve Inc.
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

//! Service Graph Processor
//!
//! Queries trace streams and builds service graph topology.
//! Called by compactor job - zero impact on ingestion performance.

#[cfg(feature = "enterprise")]
use chrono::Utc;
#[cfg(feature = "enterprise")]
use config::meta::stream::StreamType;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

/// Main entry point for service graph processing
/// Called by compactor job
#[cfg(feature = "enterprise")]
pub async fn process_service_graph() -> Result<(), anyhow::Error> {
    let cfg = get_o2_config();
    if !cfg.service_graph.enabled {
        return Ok(());
    }
    // Process last hour of traces (configurable window)
    let now = Utc::now().timestamp_micros();
    let window_minutes = get_o2_config().service_graph.query_time_range_minutes;
    let window_micros = window_minutes * 60 * 1_000_000;
    let start_time = now - window_micros;

    log::debug!(
        "[ServiceGraph] Processing traces from {} to {}",
        start_time,
        now
    );

    // Get all trace streams across all orgs
    let streams = get_trace_streams().await?;
    log::info!(
        "[ServiceGraph] Found {} trace streams to process",
        streams.len()
    );

    for (org_id, stream_name) in streams {
        log::info!(
            "[ServiceGraph] Processing stream {}/{}",
            org_id,
            stream_name
        );
        if let Err(e) = process_stream(&org_id, &stream_name, start_time, now).await {
            log::error!(
                "[ServiceGraph] Failed to process stream {}/{}: {}",
                org_id,
                stream_name,
                e
            );
            continue; // Don't fail entire job if one stream fails
        }
    }

    Ok(())
}

/// Get list of all trace streams
#[cfg(feature = "enterprise")]
async fn get_trace_streams() -> Result<Vec<(String, String)>, anyhow::Error> {
    let mut streams = Vec::new();

    // Get all organizations
    let orgs = crate::service::db::organization::list(None).await?;

    for org in orgs {
        // Get trace streams for this org (using identifier, not name)
        let org_streams = crate::service::db::schema::list_streams_from_cache(
            &org.identifier,
            StreamType::Traces,
        )
        .await;

        if org_streams.is_empty() {
            log::warn!(
                "[ServiceGraph] No trace streams found for org '{}' (identifier: {})",
                org.name,
                org.identifier
            );
        }

        for stream_name in org_streams {
            streams.push((org.identifier.clone(), stream_name));
        }
    }

    Ok(streams)
}

/// Process a single trace stream
#[cfg(feature = "enterprise")]
async fn process_stream(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<(), anyhow::Error> {
    // Build SQL to aggregate service graph edges directly in DataFusion
    // Use CTE to compute client/server first, then aggregate
    log::info!(
        "[ServiceGraph] Querying stream {}/{} from {} to {} (window: {}s)",
        org_id,
        stream_name,
        start_time,
        end_time,
        (end_time - start_time) / 1_000_000
    );

    // Build service graph using parent-child span relationships via reference_parent_span_id
    // JOIN approach: match parent CLIENT/INTERNAL spans with child SERVER/INTERNAL spans

    let exclude_internal = get_o2_config().service_graph.exclude_internal_spans;

    let (server_span_kinds, client_span_kinds) = if exclude_internal {
        ("('2')", "('3')")
    } else {
        ("('1', '2')", "('1', '3')")
    };

    let sql = format!(
        r#"SELECT
            client.service_name AS client,
            server.service_name AS server,
            'standard' AS connection_type,
            COUNT(*) AS total_requests,
            COUNT(*) FILTER (WHERE server.span_status = 'ERROR') AS errors,
            CAST(COUNT(*) FILTER (WHERE server.span_status = 'ERROR') * 100.0 / COUNT(*) AS DOUBLE) AS error_rate,
            CAST(approx_median(server.end_time - server.start_time) AS BIGINT) AS p50,
            CAST(approx_percentile_cont(server.end_time - server.start_time, 0.95) AS BIGINT) AS p95,
            CAST(approx_percentile_cont(server.end_time - server.start_time, 0.99) AS BIGINT) AS p99
        FROM "{stream_name}" AS server
        LEFT JOIN "{stream_name}" AS client
            ON server.reference_parent_span_id = client.span_id
            AND server.trace_id = client.trace_id
        WHERE client.service_name IS NOT NULL
            AND server._timestamp >= {start_time} AND server._timestamp < {end_time}
            AND CAST(server.span_kind AS VARCHAR) IN {server_span_kinds}
            AND CAST(client.span_kind AS VARCHAR) IN {client_span_kinds}
            AND client.service_name != server.service_name
        GROUP BY client.service_name, server.service_name"#,
    );
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
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
        timeout: 300, // 5 minute timeout for large queries
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
    };

    let trace_id = config::ider::generate();
    let resp =
        crate::service::search::search(&trace_id, org_id, StreamType::Traces, None, &req).await?;

    log::info!(
        "[ServiceGraph] Query returned {} pre-aggregated edges from {}/{}",
        resp.hits.len(),
        org_id,
        stream_name
    );

    if resp.hits.is_empty() {
        return Ok(());
    }

    // SQL already aggregated everything - just write directly to _o2_service_graph stream
    crate::service::traces::service_graph::write_sql_aggregated_edges(
        org_id,
        stream_name,
        resp.hits,
    )
    .await?;

    Ok(())
}

// Stub implementation for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
pub async fn process_service_graph() -> Result<(), anyhow::Error> {
    Ok(())
}

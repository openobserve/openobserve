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

//! Service Graph Processor
//!
//! Queries trace streams and builds service graph topology.
//! Called by compactor job - zero impact on ingestion performance.

#[cfg(feature = "enterprise")]
use {
    config::{cluster::LOCAL_NODE, meta::stream::StreamType, utils::time::now_micros},
    infra::cluster::get_node_by_uuid,
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

#[cfg(feature = "enterprise")]
#[derive(serde::Deserialize)]
struct RecentIngestedTraceStream {
    org_id: String,
    stream_name: String,
}

/// Main entry point for service graph processing
/// Called by compactor job
#[cfg(feature = "enterprise")]
pub async fn process_service_graph() -> Result<(), anyhow::Error> {
    // get last offset
    let (mut last_updated_at, node) = crate::service::db::service_graph::get_offset().await;
    // other node is processing
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(());
    }

    // before starting, set current node to lock the job
    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        crate::service::db::service_graph::set_offset(
            last_updated_at,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await?;
    }

    let now = now_micros();
    let window_micros = get_o2_config().service_graph.query_time_range_minutes * 60 * 1_000_000;
    let mut next_updated_at = last_updated_at + window_micros;
    // less than window_micros, no need to process
    if next_updated_at > now {
        return Ok(());
    }
    // set last updated at to now if it's 0
    if last_updated_at == 0 {
        last_updated_at = now - window_micros;
        next_updated_at = now;
    }

    log::debug!("[ServiceGraph] Processing traces from {last_updated_at} to {next_updated_at}");

    // Query usage stream to find which streams have recent ingestion activity
    let sql = r#"SELECT org_id, stream_name
        FROM "usage"
        WHERE event = 'Ingestion' AND stream_type = 'traces'
        GROUP BY org_id, stream_name"#
        .to_string();

    let usage_results = match crate::service::self_reporting::search::get_usage(
        sql,
        last_updated_at,
        next_updated_at,
        false,
    )
    .await
    {
        Ok(v) => v
            .into_iter()
            .filter_map(
                |v| match serde_json::from_value::<RecentIngestedTraceStream>(v) {
                    Ok(usage) => Some(usage),
                    Err(e) => {
                        log::warn!("[ServiceGraph] Failed to deserialize usage row: {e}");
                        None
                    }
                },
            )
            .collect::<Vec<_>>(),
        Err(e) => {
            log::error!(
                "[ServiceGraph] Failed to get last ingestion from usage stream, skipping service graph: {e}"
            );
            return Ok(());
        }
    };

    log::info!(
        "[ServiceGraph] Found {} active trace streams in usage data",
        usage_results.len()
    );

    for RecentIngestedTraceStream {
        org_id,
        stream_name,
    } in usage_results
    {
        log::info!("[ServiceGraph] Processing stream {org_id}/{stream_name}");

        if let Err(e) =
            process_stream(&org_id, &stream_name, last_updated_at, next_updated_at).await
        {
            log::error!("[ServiceGraph] Failed to process stream {org_id}/{stream_name}: {e}");
            continue; // Don't fail entire job if one stream fails
        }
    }

    // update last updated at
    crate::service::db::service_graph::set_offset(next_updated_at, Some(&LOCAL_NODE.uuid.clone()))
        .await?;

    Ok(())
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
            AND CAST(client.span_kind AS VARCHAR) IN {client_span_kinds}
        WHERE
            server._timestamp >= {start_time} AND server._timestamp < {end_time}
            AND CAST(server.span_kind AS VARCHAR) IN {server_span_kinds}
            AND (
                client.service_name IS NULL
                OR client.service_name != server.service_name
            )
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

#[cfg(all(test, feature = "enterprise"))]
mod test {

    #[test]
    fn test_usage_deser() {
        let value = serde_json::json!({
            "org_id": "random",
            "stream_name": "random-stream"
        });

        let result = serde_json::from_value::<super::RecentIngestedTraceStream>(value);

        assert!(
            result.is_ok_and(|data| {
                data.org_id == "random" && data.stream_name == "random-stream"
            })
        );
    }
}

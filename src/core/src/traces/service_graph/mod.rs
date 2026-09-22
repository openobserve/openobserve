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

//! Service Graph Module - Enterprise Feature
//!
//! Daemon-based service graph that queries traces periodically.
//! No inline processing during trace ingestion.

// OSS modules
pub mod aggregator;
pub mod api;
pub mod processor;
pub mod v4;

use std::sync::atomic::Ordering;

use config::meta::stream::StreamType;

/// Default window (in minutes) used when no explicit time range is provided.
/// The UI has its own time range picker, so this only applies as the server-side fallback.
pub const DEFAULT_QUERY_WINDOW_MINUTES: i64 = 60;

// Re-export API handler for router
// Re-export aggregator function (used by processor)
pub use aggregator::write_sql_aggregated_edges;
#[cfg(feature = "enterprise")]
pub use api::query_edges_from_stream_internal;
pub use api::{get_current_topology, get_edge_history};
// Re-export enterprise types and functions
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::service_graph::{
    // Data types
    ConnectionType,
    SpanForGraph,
    SpanKind,
    // Processing functions
    span_to_graph_span,
};
// Re-export processor for compactor
pub use processor::process_service_graph;

/// Where the topology API reads from; decided per request by `pick_source`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    V1,
    V4,
}

#[cfg(feature = "enterprise")]
#[derive(serde::Deserialize)]
struct RecentIngestedTraceStream {
    org_id: String,
    stream_name: String,
}

/// An org without a v1 stream (fresh install, collector-only) reads the metrics right away.
pub fn pick_source(stopped: bool, v1_exists: bool) -> Source {
    if stopped || !v1_exists {
        Source::V4
    } else {
        Source::V1
    }
}

/// `v1/stopped` is write-once, so a true reading is cached for the process lifetime.
pub async fn use_v4_source(org: &str) -> bool {
    if v4::V1_STOPPED_SEEN.load(Ordering::Relaxed) {
        return true;
    }
    let stopped = crate::db::service_graph::is_v1_stopped().await;
    if stopped {
        v4::V1_STOPPED_SEEN.store(true, Ordering::Relaxed);
    }
    // the gRPC ServiceGraph arm writes through logs::ingest, so the v1 stream lives as a Logs
    // stream
    let v1_exists =
        !stopped && infra::schema::exists(org, StreamType::Logs, "_o2_service_graph").await;
    pick_source(stopped, v1_exists) == Source::V4
}

/// Runs a pre-aggregated graph query against a trace stream and returns the raw hits.
pub(crate) async fn run_graph_search(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
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
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
            timezone: None,
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
        agent_options: None,
    };

    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Traces, None, &req).await?;
    Ok(resp.hits)
}

/// Usage-active trace streams in `[start, end)` united with the schema cache's, deduped.
#[cfg(feature = "enterprise")]
pub(crate) async fn discover_trace_streams(
    start: i64,
    end: i64,
) -> Result<Vec<(String, String)>, anyhow::Error> {
    let sql = r#"SELECT org_id, stream_name
        FROM "usage"
        WHERE event = 'Ingestion' AND stream_type = 'traces'
        GROUP BY org_id, stream_name"#
        .to_string();
    let mut discovered: Vec<(String, String)> =
        crate::self_reporting::search::get_usage(sql, start, end, false)
            .await?
            .into_iter()
            .filter_map(
                |v| match serde_json::from_value::<RecentIngestedTraceStream>(v) {
                    Ok(usage) => Some((usage.org_id, usage.stream_name)),
                    Err(e) => {
                        log::warn!("[TraceStreams] Failed to deserialize usage row: {e}");
                        None
                    }
                },
            )
            .collect();
    log::info!(
        "[TraceStreams] Found {} active trace streams in usage data",
        discovered.len()
    );

    // paused or sparse streams drop out of usage but still hold spans to roll up
    let mut seen: std::collections::HashSet<(String, String)> =
        discovered.iter().cloned().collect();
    match crate::organization::list_all_orgs(None).await {
        Ok(orgs) => {
            // one pass over the schema cache instead of a full scan per org
            let mut grouped = crate::db::schema::list_all_streams_grouped().await;
            for org in orgs {
                let Some(streams) = grouped
                    .get_mut(&org.identifier)
                    .and_then(|types| types.remove(&StreamType::Traces))
                else {
                    continue;
                };
                for stream_name in streams {
                    let key = (org.identifier.clone(), stream_name);
                    if seen.insert(key.clone()) {
                        discovered.push(key);
                    }
                }
            }
        }
        // non-fatal: busy streams still come from usage, only the stale ones are missed
        Err(e) => log::warn!(
            "[TraceStreams] org list failed; processing usage-discovered streams only: {e}"
        ),
    }
    Ok(discovered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_query_window_minutes_value() {
        assert_eq!(DEFAULT_QUERY_WINDOW_MINUTES, 60);
    }

    #[test]
    fn test_default_query_window_minutes_positive() {
        const { assert!(DEFAULT_QUERY_WINDOW_MINUTES > 0) };
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_usage_deser() {
        let value = serde_json::json!({
            "org_id": "random",
            "stream_name": "random-stream"
        });

        let result = serde_json::from_value::<RecentIngestedTraceStream>(value);

        assert!(
            result.is_ok_and(|data| {
                data.org_id == "random" && data.stream_name == "random-stream"
            })
        );
    }

    #[test]
    fn test_pick_source_four_cases() {
        assert_eq!(pick_source(false, true), Source::V1);
        assert_eq!(pick_source(false, false), Source::V4);
        assert_eq!(pick_source(true, true), Source::V4);
        assert_eq!(pick_source(true, false), Source::V4);
    }
}

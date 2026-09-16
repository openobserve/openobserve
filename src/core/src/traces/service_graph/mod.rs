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
}

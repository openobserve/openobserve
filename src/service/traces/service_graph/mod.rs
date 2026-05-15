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

/// Default window (in minutes) used when no explicit time range is provided.
/// The UI has its own time range picker, so this only applies as the server-side fallback.
pub const DEFAULT_QUERY_WINDOW_MINUTES: i64 = 60;

// OSS modules
pub mod aggregator;
pub mod api;
pub mod processor;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_query_window_minutes_value() {
        assert_eq!(DEFAULT_QUERY_WINDOW_MINUTES, 60);
    }

    #[test]
    fn test_default_query_window_minutes_positive() {
        assert!(DEFAULT_QUERY_WINDOW_MINUTES > 0);
    }
}

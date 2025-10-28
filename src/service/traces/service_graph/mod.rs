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

//! Service Graph Module
//!
//! This module provides API endpoints for the service graph feature.
//! The core logic is implemented in the enterprise repository.

#[cfg(feature = "enterprise")]
pub mod api;

// Re-export API handlers for routing
#[cfg(feature = "enterprise")]
pub use api::{get_service_graph_metrics, get_store_stats};
// Re-export enterprise types and functions for internal use
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::service_graph::{
    ConnectionType, SERVICE_GRAPH_DROPPED_SPANS, SpanForGraph, SpanKind, init_background_workers,
    process_span, shutdown_workers, span_to_graph_span,
};

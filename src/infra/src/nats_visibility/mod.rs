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

//! NATS Visibility Metrics Collector
//!
//! Collects metrics from NATS JetStream via HTTP monitoring API and ingests
//! them as Prometheus metrics into the _meta organization.
//!
//! Key design:
//! - Runs on nodes with "router" or "all" role
//! - Uses Prometheus remote_write format for efficient storage
//! - Collects 9 high-priority metrics for debugging slow nodes

pub mod collector;

use std::time::Duration;

pub use collector::NatsVisibilityCollector;
use config::get_config;
use tokio::time::interval;

/// Check if this node should run the NATS visibility collector
///
/// Design: If node role is "router" or "all", run the collector.
/// This allows metrics collection to work even in single-node deployments
/// or during startup before cluster cache is populated.
///
/// Criteria:
/// 1. ZO_CLUSTER_COORDINATOR must be "nats"
/// 2. Node role must be "router" OR "all"
pub fn should_run_collector() -> bool {
    let cfg = get_config();

    // Must be NATS coordinator
    if cfg.common.cluster_coordinator != "nats" {
        log::debug!(
            "[NATS Visibility] Skipping: cluster_coordinator is '{}', not 'nats'",
            cfg.common.cluster_coordinator
        );
        return false;
    }

    // Check local node role from config
    let node_role = &cfg.common.node_role;
    let is_eligible = node_role == "router" || node_role == "all";

    if !is_eligible {
        log::debug!(
            "[NATS Visibility] Skipping: node role '{}' is not router/all",
            node_role
        );
        return false;
    }

    log::info!(
        "[NATS Visibility] This node is eligible to run collector (role={})",
        node_role
    );
    true
}

/// Initialize and start NATS visibility collector
///
/// This should be called once during application startup (after infra::init).
/// The collector will start if this node has router or all role.
pub fn start_collector() {
    let cfg = get_config();

    // Check if enabled
    if !cfg.nats_visibility.enabled {
        log::info!("[NATS Visibility] Disabled via ZO_NATS_VISIBILITY_ENABLED=false");
        return;
    }

    // Check if this node should run collector
    if !should_run_collector() {
        log::info!("[NATS Visibility] Collector not started on this node (not router/all role)");
        return;
    }

    let collection_interval = cfg.nats_visibility.interval_secs;

    log::info!(
        "[NATS Visibility] Starting collector on this node (interval: {}s)",
        collection_interval
    );

    // Spawn collection task
    tokio::spawn(async move {
        let collector = NatsVisibilityCollector::new();
        let mut tick = interval(Duration::from_secs(collection_interval));

        // Skip first tick (immediate trigger)
        tick.tick().await;

        loop {
            tick.tick().await;

            // Collect and ingest metrics
            if let Err(e) = collector.collect_and_ingest().await {
                log::error!("[NATS Visibility] Collection/ingestion error: {}", e);
            }
        }
    });
}

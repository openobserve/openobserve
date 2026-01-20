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

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};
use infra::cluster::get_cached_online_ingester_nodes;

use crate::service::db;

/// Runs the periodic pipeline error cleanup job.
///
/// This job periodically removes pipeline errors that are older than the configured
/// retention period. This prevents stale errors from persisting after users have
/// fixed their pipelines.
///
/// Only runs on ingester nodes with leader election to ensure a single node in the
/// cluster handles cleanup.
pub fn run() {
    // Only run on ingester nodes to avoid duplicate cleanup by multiple nodes
    if !LOCAL_NODE.is_ingester() {
        log::debug!("[PIPELINE_ERROR_CLEANUP] Not running on ingester node, skipping");
        return;
    }

    log::info!("[PIPELINE_ERROR_CLEANUP] Job initialized on ingester node");

    spawn_pausable_job!(
        "pipeline_error_cleanup",
        get_config().pipeline.error_cleanup_interval,
        {
            log::debug!("[PIPELINE_ERROR_CLEANUP] Job kicked off");

            // Leader election: only the ingester with the smallest UUID runs cleanup
            let is_leader = match get_cached_online_ingester_nodes().await {
                Some(mut nodes) => {
                    if nodes.is_empty() {
                        log::warn!("[PIPELINE_ERROR_CLEANUP] No online ingester nodes found");
                        false
                    } else {
                        // Sort by UUID to get consistent leader
                        nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                        let leader_uuid = &nodes[0].uuid;
                        let is_leader = leader_uuid == &LOCAL_NODE.uuid;
                        log::debug!(
                            "[PIPELINE_ERROR_CLEANUP] Leader election: leader={}, current={}, is_leader={}, total_nodes={}",
                            leader_uuid,
                            LOCAL_NODE.uuid,
                            is_leader,
                            nodes.len()
                        );
                        is_leader
                    }
                }
                None => {
                    log::debug!(
                        "[PIPELINE_ERROR_CLEANUP] Failed to get cached ingester nodes, assuming single node"
                    );
                    // If we can't get cached nodes, assume single node and run cleanup
                    true
                }
            };

            if !is_leader {
                log::debug!("[PIPELINE_ERROR_CLEANUP] Not leader, skipping cleanup");
                continue; // Skip this iteration if not the leader
            }

            let cfg = get_config();
            let retention_micros = cfg.pipeline.error_retention_mins * 60 * 1_000_000;
            let cutoff_timestamp = now_micros() - retention_micros as i64;

            log::debug!(
                "[PIPELINE_ERROR_CLEANUP] Running cleanup for errors older than {} minutes (cutoff timestamp: {})",
                cfg.pipeline.error_retention_mins,
                cutoff_timestamp
            );

            match db::pipeline_errors::delete_older_than(cutoff_timestamp).await {
                Ok(deleted_count) => {
                    if deleted_count > 0 {
                        log::info!(
                            "[PIPELINE_ERROR_CLEANUP] Deleted {} stale pipeline error(s) older than {} minutes",
                            deleted_count,
                            cfg.pipeline.error_retention_mins
                        );
                    } else {
                        log::debug!("[PIPELINE_ERROR_CLEANUP] No stale errors found to cleanup");
                    }
                }
                Err(e) => {
                    log::error!(
                        "[PIPELINE_ERROR_CLEANUP] Failed to cleanup pipeline errors: {}",
                        e
                    );
                }
            }
        }
    );
}

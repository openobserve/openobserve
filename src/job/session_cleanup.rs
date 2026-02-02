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

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job};

/// Runs the periodic session cleanup job.
///
/// This job periodically removes expired sessions from the database to prevent
/// accumulation of stale sessions. Expired sessions are those where the JWT
/// token's expiry time (expires_at) has passed.
///
/// Only runs on ingester nodes with leader election to ensure a single node in the
/// cluster handles cleanup.
///
/// The cleanup interval can be configured via ZO_SESSION_CLEANUP_INTERVAL env var
/// (default: 3600 seconds = 1 hour)
pub fn run() {
    // Only run on ingester nodes to avoid duplicate cleanup by multiple nodes
    if !LOCAL_NODE.is_ingester() {
        log::debug!("[SESSION_CLEANUP] Not running on ingester node, skipping");
        return;
    }

    let cfg = get_config();
    log::info!(
        "[SESSION_CLEANUP] Job initialized on ingester node with interval: {} seconds",
        cfg.auth.session_cleanup_interval
    );

    spawn_pausable_job!("session_cleanup", cfg.auth.session_cleanup_interval, {
        log::debug!("[SESSION_CLEANUP] Job kicked off");

        // Leader election: only the ingester with the smallest UUID runs cleanup
        let is_leader = match infra::cluster::get_cached_online_ingester_nodes().await {
            Some(mut nodes) => {
                if nodes.is_empty() {
                    log::warn!("[SESSION_CLEANUP] No online ingester nodes found");
                    false
                } else {
                    // Sort by UUID to get consistent leader
                    nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                    let leader_uuid = &nodes[0].uuid;
                    let is_leader = leader_uuid == &LOCAL_NODE.uuid;
                    log::debug!(
                        "[SESSION_CLEANUP] Leader election: leader={}, current={}, is_leader={}, total_nodes={}",
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
                    "[SESSION_CLEANUP] Failed to get cached ingester nodes, assuming single node"
                );
                // If we can't get cached nodes, assume single node and run cleanup
                true
            }
        };

        if !is_leader {
            log::debug!("[SESSION_CLEANUP] Not leader, skipping cleanup");
            continue; // Skip this iteration if not the leader
        }

        log::debug!("[SESSION_CLEANUP] Running cleanup for expired sessions");

        match infra::table::sessions::delete_expired().await {
            Ok(deleted_count) => {
                if deleted_count > 0 {
                    log::info!(
                        "[SESSION_CLEANUP] Deleted {} expired session(s)",
                        deleted_count
                    );
                } else {
                    log::info!("[SESSION_CLEANUP] No expired sessions found to cleanup");
                }
            }
            Err(e) => {
                log::error!(
                    "[SESSION_CLEANUP] Failed to cleanup expired sessions: {}",
                    e
                );
            }
        }
    });
}

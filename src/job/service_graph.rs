// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

pub async fn run() -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        // Only alert_manager nodes run the service graph job.
        // (Ingester/querier/compactor/router nodes exit here.)
        if !LOCAL_NODE.is_alert_manager() {
            log::info!(
                "[SERVICE_GRAPH::JOB] Service graph processor disabled on non-alert-manager node (role: {:?})",
                LOCAL_NODE.role
            );
            return Ok(());
        }

        log::info!("[SERVICE_GRAPH::JOB] Service graph processor is enabled");

        spawn_pausable_job!(
            "service_graph_processor",
            get_o2_config().service_graph.processing_interval_secs,
            {
                // Leader election: only the alert_manager with the smallest UUID runs the job.
                // This prevents duplicate writes when multiple alert_manager nodes are running.
                let is_leader = match infra::cluster::get_cached_nodes(|node| {
                    node.status == config::meta::cluster::NodeStatus::Online
                        && node.is_alert_manager()
                })
                .await
                {
                    Some(mut nodes) if !nodes.is_empty() => {
                        nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                        nodes[0].uuid == LOCAL_NODE.uuid
                    }
                    // Cache empty or single-node — fall through and run.
                    _ => true,
                };

                if !is_leader {
                    log::debug!(
                        "[SERVICE_GRAPH::JOB] Not leader alert_manager, skipping this interval"
                    );
                    continue;
                }

                log::debug!("[SERVICE_GRAPH::JOB] Running service graph processing");
                if let Err(e) = crate::service::traces::service_graph::process_service_graph().await
                {
                    log::error!("[SERVICE_GRAPH::JOB] Processing failed: {e}");
                }
            },
            sleep_after
        );
    }

    #[cfg(not(feature = "enterprise"))]
    {
        log::debug!("[SERVICE_GRAPH::JOB] Service graph is an enterprise feature");
    }

    Ok(())
}

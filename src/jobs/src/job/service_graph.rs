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
        // Only scheduler nodes run the service graph job.
        // (Ingester/querier/compactor/router nodes exit here.)
        if !LOCAL_NODE.is_scheduler() {
            log::info!(
                "[SERVICE_GRAPH::JOB] Service graph processor disabled on non-scheduler node (role: {:?})",
                LOCAL_NODE.role
            );
            return Ok(());
        }

        if !get_o2_config().service_graph.enabled {
            log::info!(
                "[SERVICE_GRAPH::JOB] Service graph jobs disabled by O2_SERVICE_GRAPH_ENABLED"
            );
            return Ok(());
        }

        log::info!("[SERVICE_GRAPH::JOB] Service graph processor is enabled");

        spawn_pausable_job!(
            "service_graph_processor",
            get_o2_config().service_graph.processing_interval_secs,
            {
                log::debug!("[SERVICE_GRAPH::JOB] Running service graph processing");
                if let Err(e) =
                    openobserve_core::traces::service_graph::process_service_graph().await
                {
                    log::error!("[SERVICE_GRAPH::JOB] Processing failed: {e}");
                }
            }
        );

        spawn_pausable_job!(
            "service_graph_v4",
            get_o2_config().service_graph.interval_secs,
            {
                use openobserve_core::traces::service_graph::v4;
                v4::run_tick(v4::Settings::from_config()).await;
            }
        );
    }

    #[cfg(not(feature = "enterprise"))]
    {
        log::debug!("[SERVICE_GRAPH::JOB] Service graph is an enterprise feature");
    }

    Ok(())
}

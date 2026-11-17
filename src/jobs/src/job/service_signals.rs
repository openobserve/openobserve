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
use openobserve_core::service_identity::signals::processor;

pub async fn run() -> Result<(), anyhow::Error> {
    if !LOCAL_NODE.is_scheduler() {
        log::info!(
            "[SERVICE_SIGNALS::JOB] Service signals processor disabled on non-scheduler node (role: {:?})",
            LOCAL_NODE.role
        );
        return Ok(());
    }

    log::info!("[SERVICE_SIGNALS::JOB] Service signals processor is enabled");

    spawn_pausable_job!("service_identity_resync", 60, {
        if let Err(error) = db::service_identity_resync::daily().await {
            log::error!("service identity resync failed: {error}");
        }
    });
    spawn_pausable_job!(
        "service_signals",
        get_o2_config().service_signals.interval_secs,
        {
            log::debug!("[SERVICE_SIGNALS::JOB] Running service signals processing");
            if let Err(e) = processor::process_service_signals().await {
                log::error!("[SERVICE_SIGNALS::JOB] Processing failed: {e}");
            }
        },
        pause_if: !config::get_config().service_versions.enabled
    );

    Ok(())
}

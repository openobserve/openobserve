// Copyright 2023 Zinc Labs Inc.
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

use config::{cluster, config::CONFIG};
use infra::scheduler;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::O2_CONFIG;
use tokio::time;

use crate::service;

pub async fn run() -> Result<(), anyhow::Error> {
    if !cluster::is_alert_manager(&cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }
    // check super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.super_cluster.enabled {
        let cluster_name =
            o2_enterprise::enterprise::super_cluster::kv::alert_manager::get_job_cluster().await?;
        if !cluster_name.is_empty() {
            let clusters = o2_enterprise::enterprise::super_cluster::kv::cluster::list().await?;
            if clusters.iter().any(|c| c.name == cluster_name) {
                log::info!("[ALERT MANAGER] is running in cluster: {}", cluster_name);
                return Ok(());
            }
        }
        let cluster_name = config::get_cluster_name();
        // regester to super cluster
        o2_enterprise::enterprise::super_cluster::kv::alert_manager::register_job_cluster(
            &cluster_name,
        )
        .await?;
    }

    scheduler::init_background_jobs(
        CONFIG.limit.scheduler_clean_interval,
        CONFIG.limit.scheduler_watch_interval,
    )
    .await?;

    // should run it every 10 seconds
    let mut interval = time::interval(time::Duration::from_secs(30));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::alerts::alert_manager::run().await;
        if ret.is_err() {
            log::error!("[ALERT MANAGER] run error: {}", ret.err().unwrap());
        }
    }
}

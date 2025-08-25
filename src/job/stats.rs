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
use tokio::time;

use crate::service::{compact::stats::update_stats_from_file_list, db};

pub async fn run() -> Result<(), anyhow::Error> {
    tokio::task::spawn(async move { update_node_memory_usage().await });

    if file_list_update_stats().is_none() {
        log::debug!("[STATS] job not started as not a compactor");
    }

    if cache_stream_stats().is_none() {
        log::debug!("[STATS] job not started as not a compactor");
    }

    Ok(())
}

// get stats from file_list to update stream_stats
fn file_list_update_stats() -> Option<tokio::task::JoinHandle<()>> {
    if !LOCAL_NODE.is_compactor() {
        return None;
    }

    // should run it at least every 10 seconds
    Some(spawn_pausable_job!(
        "file_list_update_stats",
        std::cmp::max(10, get_config().limit.calculate_stats_interval),
        {
            match update_stats_from_file_list().await {
                Err(e) => {
                    log::error!("[STATS] run update stream stats from file list error: {e}");
                }
                Ok(Some((offset, max_pk))) => {
                    log::debug!(
                        "[STATS] run update stream stats success, offset: {offset}, max_pk: {max_pk}"
                    );
                }
                Ok(None) => {}
            }
        }
    ))
}

fn cache_stream_stats() -> Option<tokio::task::JoinHandle<()>> {
    if !LOCAL_NODE.is_ingester() && !LOCAL_NODE.is_querier() && !LOCAL_NODE.is_compactor() {
        return None;
    }

    // should run it at least every minute
    #[cfg(feature = "enterprise")]
    let need_wait_one_around = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    let need_wait_one_around = false;

    Some(spawn_pausable_job!(
        "cache_stream_stats",
        std::cmp::max(60, get_config().limit.calculate_stats_interval),
        {
            // wait one around to make sure the dependent models are ready
            if need_wait_one_around {
                tokio::time::sleep(time::Duration::from_secs(std::cmp::max(
                    60,
                    get_config().limit.calculate_stats_interval,
                )))
                .await;
            }

            if let Err(e) = db::file_list::cache_stats().await {
                log::error!("[STATS] run cached stream stats error: {e}");
            } else {
                log::debug!("[STATS] run cached stream stats success");
            }
        }
    ))
}

// update node memory usage metrics every second
async fn update_node_memory_usage() -> Result<(), anyhow::Error> {
    loop {
        let mem_usage = config::utils::sysinfo::get_memory_usage();
        config::metrics::NODE_MEMORY_USAGE
            .with_label_values(&[])
            .set(mem_usage as i64);
        tokio::time::sleep(time::Duration::from_secs(1)).await;
    }
}

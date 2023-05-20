// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use tokio::time::{self, Duration};

use crate::infra::cluster;
use crate::infra::config::{CONFIG, METRIC_CLUSTER_LEADER};
use crate::service::db;

pub async fn run() -> Result<(), anyhow::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(()); // not an ingester, no need to init job
    }

    if !CONFIG.common.metrics_dedup_enabled {
        return Ok(());
    }

    let mut interval = time::interval(Duration::from_secs(
        CONFIG.limit.metrics_leader_push_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let leaders = METRIC_CLUSTER_LEADER.clone();
        for item in leaders.iter() {
            let result = db::metrics::set_prom_cluster_leader(item.key(), item.value()).await;
            match result {
                Ok(_) => {
                    // log::info!("Successfully updated leader to db ")
                }
                Err(err) => log::error!("error updating leader to db {}", err),
            }
        }
    }
}

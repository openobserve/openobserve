// Copyright 2023 Zinc Labs Inc.
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

use ahash::AHashMap;
use tokio::time::{self, Duration};

use crate::common::infra::{
    cluster,
    config::{CONFIG, METRIC_CLUSTER_LEADER},
};
use crate::common::meta::prom::ClusterLeader;
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

    let mut last_leaders: AHashMap<String, ClusterLeader> = AHashMap::new(); // maintain the last state

    loop {
        interval.tick().await;
        // only update if there's a change
        let map = METRIC_CLUSTER_LEADER.read().await.clone();
        for (key, value) in map.iter() {
            if last_leaders.contains_key(key) {
                let last_leader = last_leaders.get(key).unwrap();
                if value.eq(last_leader) {
                    continue;
                }
            }

            let result = db::metrics::set_prom_cluster_leader(key, value).await;
            match result {
                Ok(_) => {
                    let _ = last_leaders.insert(key.to_string(), value.clone());
                }
                Err(err) => log::error!("error updating leader to db {}", err),
            }
        }
    }
}

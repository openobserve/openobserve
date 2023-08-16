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

use bytes::Bytes;
use std::sync::Arc;

use crate::common::infra::cluster::LOCAL_NODE_UUID;
use crate::common::infra::config::METRIC_CLUSTER_LEADER;
use crate::common::infra::db::Event;
use crate::common::json;
use crate::common::meta::prom::ClusterLeader;

pub async fn set_prom_cluster_info(cluster: &str, members: &[String]) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/metrics_members/{cluster}");
    Ok(db.put(&key, Bytes::from(members.join(","))).await?)
}

pub async fn set_prom_cluster_leader(
    cluster: &str,
    leader: &ClusterLeader,
) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/metrics_leader/{cluster}");
    Ok(db.put(&key, json::to_vec(&leader).unwrap().into()).await?)
}

pub async fn watch_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/metrics_leader/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching prometheus cluster leader");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_prom_cluster_leader: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: ClusterLeader = json::from_slice(&ev.value.unwrap()).unwrap();
                if item_value.updated_by != LOCAL_NODE_UUID.to_string() {
                    METRIC_CLUSTER_LEADER
                        .write()
                        .await
                        .insert(item_key.to_owned(), item_value);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                METRIC_CLUSTER_LEADER.write().await.remove(item_key);
            }
        }
    }
    Ok(())
}

pub async fn cache_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/metrics_leader/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key_str = item_key.strip_prefix(key).unwrap();
        let json_val: ClusterLeader = json::from_slice(&item_value).unwrap();
        METRIC_CLUSTER_LEADER
            .write()
            .await
            .insert(item_key_str.to_string(), json_val);
    }
    log::info!("Prometheus cluster leaders Cached");
    Ok(())
}

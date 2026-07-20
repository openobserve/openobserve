// Copyright 2026 OpenObserve Inc.
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

use std::sync::Arc;

use bytes::Bytes;
use common::infra::config::METRIC_CLUSTER_LEADER;
use config::{cluster::LOCAL_NODE, meta::promql::ClusterLeader, utils::json};

async fn put(key: &str, value: Bytes, need_watch: bool) -> Result<(), anyhow::Error> {
    infra::db::get_db()
        .await
        .put(key, value.clone(), need_watch, None)
        .await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, None).await?;
    }
    Ok(())
}

pub async fn set_prom_cluster_info(cluster: &str, members: &[String]) -> Result<(), anyhow::Error> {
    let key = format!("/metrics_members/{cluster}");
    put(&key, Bytes::from(members.join(",")), false).await
}

pub async fn set_prom_cluster_leader(
    cluster: &str,
    leader: &ClusterLeader,
) -> Result<(), anyhow::Error> {
    let key = format!("/metrics_leader/{cluster}");
    match put(&key, json::to_vec(&leader).unwrap().into(), true).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error updating cluster_leader: {e}");
            return Err(anyhow::anyhow!("Error updating cluster_leader: {}", e));
        }
    }
    Ok(())
}

pub async fn watch_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let key = "/metrics_leader/";
    let cluster_coordinator = infra::coordinator::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
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
            infra::db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: ClusterLeader = match infra::db::get_db().await.get(&ev.key).await {
                    Ok(val) => match json::from_slice(&val) {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("Error getting value: {e}");
                            continue;
                        }
                    },
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                };
                if item_value.updated_by != LOCAL_NODE.uuid {
                    METRIC_CLUSTER_LEADER
                        .write()
                        .await
                        .insert(item_key.to_owned(), item_value);
                }
            }
            infra::db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                METRIC_CLUSTER_LEADER.write().await.remove(item_key);
            }
            infra::db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let key = "/metrics_leader/";
    let ret = infra::db::get_db().await.list(key).await?;
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

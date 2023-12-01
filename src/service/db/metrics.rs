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

use bytes::Bytes;
use memory_stats::memory_stats;
use std::sync::Arc;

use crate::common::infra::metrics;
use crate::common::{
    infra::{cluster::LOCAL_NODE_UUID, config::METRIC_CLUSTER_LEADER, db as infra_db},
    meta::prom::ClusterLeader,
    utils::json,
};

pub async fn set_prom_cluster_info(cluster: &str, members: &[String]) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/metrics_members/{cluster}");
    Ok(db
        .put(
            &key,
            Bytes::from(members.join(",")),
            infra_db::NO_NEED_WATCH,
        )
        .await?)
}

pub async fn set_prom_cluster_leader(
    cluster: &str,
    leader: &ClusterLeader,
) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/metrics_leader/{cluster}");
    match db
        .put(
            &key,
            json::to_vec(&leader).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await
    {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error updating cluster_leader: {}", e);
            return Err(anyhow::anyhow!("Error updating cluster_leader: {}", e));
        }
    }
    Ok(())
}

pub async fn watch_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let key = "/metrics_leader/";
    let cluster_coordinator = infra_db::get_coordinator().await;
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
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: ClusterLeader = json::from_slice(&ev.value.unwrap()).unwrap();
                if item_value.updated_by != LOCAL_NODE_UUID.to_string() {
                    METRIC_CLUSTER_LEADER
                        .write()
                        .await
                        .insert(item_key.to_owned(), item_value);
                }
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                METRIC_CLUSTER_LEADER.write().await.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
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

pub async fn openobserve_info() -> Result<(), anyhow::Error> {
    log::info!("Start openobserve self metrics watcher");
    loop {
        if let Some(cur_memory) = memory_stats() {
            metrics::OO_MEM_USAGE
                .with_label_values(&["default"])
                .set(cur_memory.physical_mem as i64);
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    }
}

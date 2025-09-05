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

use std::sync::Arc;

use bytes::Bytes;
use config::{cluster::LOCAL_NODE, meta::promql::ClusterLeader, utils::json};
use infra::cluster_coordinator::events::{MetaAction, MetaEvent};

use crate::{common::infra::config::METRIC_CLUSTER_LEADER, service::db};

pub const PROM_CLUSTER_LEADER_KEY: &str = "/metrics_leader/";

pub async fn set_prom_cluster_info(cluster: &str, members: &[String]) -> Result<(), anyhow::Error> {
    let key = format!("/metrics_members/{cluster}");
    Ok(db::put(
        &key,
        Bytes::from(members.join(",")),
        db::NO_NEED_WATCH,
        None,
    )
    .await?)
}

pub async fn set_prom_cluster_leader(
    cluster: &str,
    leader: &ClusterLeader,
) -> Result<(), anyhow::Error> {
    let key = format!("/metrics_leader/{cluster}");
    match db::put(
        &key,
        json::to_vec(&leader).unwrap().into(),
        db::NEED_WATCH,
        None,
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
    let key = PROM_CLUSTER_LEADER_KEY;
    let cluster_coordinator = db::get_coordinator().await;
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
            db::Event::Put(ev) => {
                let _ = handle_put(&ev.key).await;
            }
            db::Event::Delete(ev) => {
                let _ = handle_delete(&ev.key).await;
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn handle_prom_cluster_leader_event(event: MetaEvent) -> Result<(), anyhow::Error> {
    match event.action {
        MetaAction::Put => handle_put(&event.key).await,
        MetaAction::Delete => handle_delete(&event.key).await,
    }
}

async fn handle_put(event_key: &str) -> Result<(), anyhow::Error> {
    let item_key = event_key.strip_prefix(PROM_CLUSTER_LEADER_KEY).unwrap();
    let item_value: ClusterLeader = match db::get(&event_key).await {
        Ok(val) => match json::from_slice(&val) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error getting value for key {event_key}: {}", e);
                return Err(anyhow::anyhow!(
                    "Error getting value for key {event_key}: {}",
                    e
                ));
            }
        },
        Err(e) => {
            log::error!("Error getting value for key {event_key}: {}", e);
            return Err(anyhow::anyhow!(
                "Error getting value for key {event_key}: {}",
                e
            ));
        }
    };
    if item_value.updated_by != LOCAL_NODE.uuid {
        METRIC_CLUSTER_LEADER
            .write()
            .await
            .insert(item_key.to_owned(), item_value);
    }
    Ok(())
}

async fn handle_delete(event_key: &str) -> Result<(), anyhow::Error> {
    let item_key = event_key.strip_prefix(PROM_CLUSTER_LEADER_KEY).unwrap();
    METRIC_CLUSTER_LEADER.write().await.remove(item_key);
    Ok(())
}

pub async fn cache_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let key = PROM_CLUSTER_LEADER_KEY;
    let ret = db::list(key).await?;
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

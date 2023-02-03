use bytes::Bytes;
use std::sync::Arc;

use crate::common::json;
use crate::infra::cache::stats;
use crate::infra::config::METRIC_CLUSTER_LEADER;
use crate::infra::db::Event;
use crate::meta::prom::ClusterLeader;
use crate::meta::stream::StreamStats;

pub mod alerts;
pub mod compact;
pub mod dashboard;
pub mod file_list;
pub mod functions;
pub mod schema;
pub mod triggers;
pub mod udf;
pub mod user;

pub async fn get_stream_stats(
    org_id: &str,
    stream_name: &str,
    stream_type: &str,
) -> Result<StreamStats, anyhow::Error> {
    match stats::get_stream_stats(org_id, stream_name, stream_type) {
        Some(stats) => Ok(stats),
        None => {
            let key = format!("/stats/{}/{}/{}", org_id, stream_type, stream_name);
            let db = &crate::infra::db::DEFAULT;
            let value = match db.get(&key).await {
                Ok(val) => serde_json::from_slice(&val).unwrap(),
                Err(_) => StreamStats::default(),
            };
            Ok(value)
        }
    }
}

pub async fn set_prom_cluster_info(
    cluster: &str,
    members: Vec<String>,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/metrics_members/{}", cluster);
    let mem_list = members
        .into_iter()
        .map(|val| format!("{},", val))
        .collect::<String>();
    let members_list = mem_list.strip_suffix(',').unwrap();
    match db.put(&key, Bytes::from(members_list.to_string())).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn set_prom_cluster_leader(
    cluster: &str,
    leader: &ClusterLeader,
) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/metrics_leader/{}", cluster);
    match db.put(&key, json::to_vec(&leader).unwrap().into()).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn watch_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/metrics_leader/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching prometheus cluster leader");
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
                METRIC_CLUSTER_LEADER.insert(item_key.to_owned(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                METRIC_CLUSTER_LEADER.remove(item_key);
            }
        }
    }
    Ok(())
}

pub async fn cache_prom_cluster_leader() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/metrics_leader/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key_str = item_key.strip_prefix(key).unwrap();
        let json_val: ClusterLeader = json::from_slice(&item_value).unwrap();
        METRIC_CLUSTER_LEADER.insert(item_key_str.to_string(), json_val);
    }
    log::info!("[TRACE] Prometheus cluster leaders Cached");
    Ok(())
}

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

use std::{cmp::min, ops::Bound, sync::Arc, time::Duration};

use config::{
    cluster::*,
    meta::{
        cluster::{Node, NodeStatus, Role},
        meta_store::MetaStore,
    },
    utils::{hash::Sum64, json},
    RwAHashMap, RwBTreeMap, CONFIG, INSTANCE_ID,
};
use infra::{
    db::{get_coordinator, Event},
    errors::Result,
};
use once_cell::sync::Lazy;
use tokio::time;

use crate::service::db as db_service;

mod etcd;
mod nats;

const CONSISTENT_HASH_VNODES: usize = 3;
const HEALTH_CHECK_FAILED_TIMES: usize = 3;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(1);

static NODES: Lazy<RwAHashMap<String, Node>> = Lazy::new(Default::default);
static QUERIER_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);
static COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);
static NODES_HEALTH_CHECK: Lazy<RwAHashMap<String, usize>> = Lazy::new(Default::default);

pub async fn add_node_to_consistent_hash(node: &Node, role: &Role) {
    let mut nodes = match role {
        Role::Querier => QUERIER_CONSISTENT_HASH.write().await,
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.write().await,
        _ => return,
    };
    let mut h = config::utils::hash::gxhash::new();
    for i in 0..CONSISTENT_HASH_VNODES {
        let key = format!("{}{}", node.uuid, i);
        let hash = h.sum64(&key);
        nodes.insert(hash, node.uuid.clone());
    }
}

pub async fn remove_node_from_consistent_hash(node: &Node, role: &Role) {
    let mut nodes = match role {
        Role::Querier => QUERIER_CONSISTENT_HASH.write().await,
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.write().await,
        _ => return,
    };
    let mut h = config::utils::hash::gxhash::new();
    for i in 0..CONSISTENT_HASH_VNODES {
        let key = format!("{}{}", node.uuid, i);
        let hash = h.sum64(&key);
        nodes.remove(&hash);
    }
}

pub async fn get_node_from_consistent_hash(key: &str, role: &Role) -> Option<String> {
    let nodes = match role {
        Role::Querier => QUERIER_CONSISTENT_HASH.read().await,
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.read().await,
        _ => return None,
    };
    if nodes.is_empty() {
        return None;
    }
    let hash = config::utils::hash::gxhash::new().sum64(key);
    let mut iter = nodes.lower_bound(Bound::Included(&hash));
    if let Some((_, uuid)) = iter.next() {
        return Some(uuid.clone());
    }
    if let Some((_, uuid)) = nodes.first_key_value() {
        return Some(uuid.clone());
    }
    None
}

#[inline]
pub fn get_internal_grpc_token() -> String {
    if CONFIG.grpc.internal_grpc_token.is_empty() {
        INSTANCE_ID.get("instance_id").unwrap().to_string()
    } else {
        CONFIG.grpc.internal_grpc_token.clone()
    }
}

/// Register and keepalive the node to cluster
pub async fn register_and_keepalive() -> Result<()> {
    if CONFIG.common.local_mode {
        let roles = load_local_node_role();
        if !is_single_node(&roles) {
            panic!("Local mode only support NODE_ROLE=all");
        }
        // cache local node
        let node = load_local_mode_node();
        add_node_to_consistent_hash(&node, &Role::Querier).await;
        add_node_to_consistent_hash(&node, &Role::Compactor).await;
        NODES.write().await.insert(LOCAL_NODE_UUID.clone(), node);
        return Ok(());
    }

    match CONFIG.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::register_and_keepalive().await?,
        _ => etcd::register_and_keepalive().await?,
    };

    // check node heatbeat
    tokio::task::spawn(async move {
        let ttl_keep_alive = min(10, (CONFIG.limit.node_heartbeat_ttl / 2) as u64);
        loop {
            time::sleep(time::Duration::from_secs(ttl_keep_alive)).await;
            if let Err(e) = check_nodes_status().await {
                log::error!("[CLUSTER] check_nodes_status failed: {}", e);
            }
        }
    });

    Ok(())
}

pub async fn set_online(new_lease_id: bool) -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    match CONFIG.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_online().await,
        _ => etcd::set_online(new_lease_id).await,
    }
}

pub async fn set_offline(new_lease_id: bool) -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    match CONFIG.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_offline().await,
        _ => etcd::set_offline(new_lease_id).await,
    }
}

pub async fn update_local_node(node: &Node) -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    match CONFIG.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::update_local_node(node).await,
        _ => etcd::update_local_node(node).await,
    }
}

pub async fn leave() -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    match CONFIG.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::leave().await,
        _ => etcd::leave().await,
    }
}

/// List nodes from cluster or local cache
pub async fn list_nodes() -> Result<Vec<Node>> {
    let mut nodes = Vec::new();
    let client = get_coordinator().await;
    let items = client.list_values("/nodes/").await.map_err(|e| {
        log::error!("[CLUSTER] error getting nodes: {}", e);
        e
    })?;

    for item in items {
        let node: Node = json::from_slice(&item)?;
        nodes.push(node.to_owned());
    }

    Ok(nodes)
}

async fn watch_node_list() -> Result<()> {
    let key = "/nodes/";
    let client = get_coordinator().await;
    let mut events = client.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching node_list");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_node_list: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let mut item_value: Node = json::from_slice(&ev.value.unwrap()).unwrap();
                let (broadcasted, exist) = match NODES.read().await.get(item_key) {
                    Some(v) => (v.broadcasted, item_value.eq(v)),
                    None => (false, false),
                };
                if exist {
                    continue;
                }
                if item_value.status == NodeStatus::Offline {
                    log::info!("[CLUSTER] offline {:?}", item_value);
                    if is_querier(&item_value.role) {
                        remove_node_from_consistent_hash(&item_value, &Role::Querier).await;
                    }
                    if is_compactor(&item_value.role) {
                        remove_node_from_consistent_hash(&item_value, &Role::Compactor).await;
                    }
                    NODES.write().await.remove(item_key);
                    continue;
                }
                log::info!("[CLUSTER] join {:?}", item_value);
                if !CONFIG.common.meta_store_external && !broadcasted {
                    // The ingester need broadcast local file list to the new node
                    if is_ingester(&LOCAL_NODE_ROLE)
                        && (item_value.status.eq(&NodeStatus::Prepare)
                            || item_value.status.eq(&NodeStatus::Online))
                    {
                        let notice_uuid = if item_key.eq(LOCAL_NODE_UUID.as_str()) {
                            log::info!("[CLUSTER] broadcast file_list to other nodes");
                            None
                        } else {
                            log::info!(
                                "[CLUSTER] broadcast file_list to new node: {}",
                                &item_value.grpc_addr
                            );
                            Some(item_key.to_string())
                        };
                        tokio::task::spawn(async move {
                            if let Err(e) =
                                db_service::file_list::local::broadcast_cache(notice_uuid).await
                            {
                                log::error!("[CLUSTER] broadcast file_list error: {}", e);
                            }
                        });
                    }
                }
                item_value.broadcasted = true;
                if is_querier(&item_value.role) {
                    add_node_to_consistent_hash(&item_value, &Role::Querier).await;
                }
                if is_compactor(&item_value.role) {
                    add_node_to_consistent_hash(&item_value, &Role::Compactor).await;
                }
                NODES.write().await.insert(item_key.to_string(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value = match NODES.read().await.get(item_key) {
                    Some(v) => v.clone(),
                    None => {
                        continue;
                    }
                };
                log::info!("[CLUSTER] leave {:?}", item_value);
                if is_querier(&item_value.role) {
                    remove_node_from_consistent_hash(&item_value, &Role::Querier).await;
                }
                if is_compactor(&item_value.role) {
                    remove_node_from_consistent_hash(&item_value, &Role::Compactor).await;
                }
                NODES.write().await.remove(item_key);
            }
            Event::Empty => {}
        }
    }

    Ok(())
}

async fn check_nodes_status() -> Result<()> {
    let nodes = get_cached_online_nodes().await.unwrap_or_default();
    for node in nodes {
        if node.uuid.eq(LOCAL_NODE_UUID.as_str()) {
            continue;
        }
        let url = format!("{}/healthz", node.http_addr);
        let resp = reqwest::Client::new()
            .get(url)
            .timeout(HEALTH_CHECK_TIMEOUT)
            .send()
            .await;
        if resp.is_err() || !resp.unwrap().status().is_success() {
            log::error!("[CLUSTER] node {} health check failed", node.name);
            let mut w = NODES_HEALTH_CHECK.write().await;
            let entry = w.entry(node.uuid.clone()).or_insert(0);
            *entry += 1;
            if *entry >= HEALTH_CHECK_FAILED_TIMES {
                log::error!(
                    "[CLUSTER] node {} health check failed 3 times, remove it",
                    node.name
                );
                if is_querier(&node.role) {
                    remove_node_from_consistent_hash(&node, &Role::Querier).await;
                }
                if is_compactor(&node.role) {
                    remove_node_from_consistent_hash(&node, &Role::Compactor).await;
                }
                NODES.write().await.remove(&node.uuid);
            }
        } else {
            let mut w = NODES_HEALTH_CHECK.write().await;
            if let Some(entry) = w.get_mut(&node.uuid) {
                if *entry > 0 {
                    *entry = 0;
                }
            }
        }
    }

    Ok(())
}

pub async fn get_cached_nodes(cond: fn(&Node) -> bool) -> Option<Vec<Node>> {
    let r = NODES.read().await;
    if r.is_empty() {
        return None;
    }
    Some(
        r.iter()
            .filter(|(_uuid, node)| cond(node))
            .map(|(_uuid, node)| node.clone())
            .collect(),
    )
}

#[inline(always)]
pub fn load_local_mode_node() -> Node {
    Node {
        id: 1,
        uuid: LOCAL_NODE_UUID.clone(),
        name: CONFIG.common.instance_name.clone(),
        http_addr: format!("http://127.0.0.1:{}", CONFIG.http.port),
        grpc_addr: format!("http://127.0.0.1:{}", CONFIG.grpc.port),
        role: [Role::All].to_vec(),
        cpu_num: CONFIG.limit.cpu_num as u64,
        status: NodeStatus::Online,
        scheduled: true,
        broadcasted: false,
    }
}

#[inline(always)]
pub async fn get_node_by_uuid(uuid: &str) -> Option<Node> {
    NODES.read().await.get(uuid).cloned()
}

#[inline]
pub async fn get_cached_online_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| node.status == NodeStatus::Online && node.scheduled).await
}

#[inline]
pub async fn get_cached_online_ingester_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online && node.scheduled && is_ingester(&node.role)
    })
    .await
}

#[inline]
pub async fn get_cached_online_querier_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online && node.scheduled && is_querier(&node.role)
    })
    .await
}

#[inline]
pub async fn get_cached_online_query_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online
            && node.scheduled
            && (is_querier(&node.role) || is_ingester(&node.role))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn test_list_nodes() {
        assert!(list_nodes().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_cluster() {
        register_and_keepalive().await.unwrap();
        set_online(false).await.unwrap();
        leave().await.unwrap();
        assert!(get_cached_online_nodes().await.is_some());
        assert!(get_cached_online_query_nodes().await.is_some());
        assert!(get_cached_online_ingester_nodes().await.is_some());
        assert!(get_cached_online_querier_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_consistent_hashing() {
        let node = load_local_mode_node();
        for i in 0..10 {
            let node_q = Node {
                uuid: format!("node-q-{i}").to_string(),
                role: [Role::Querier].to_vec(),
                ..node.clone()
            };
            let node_c = Node {
                uuid: format!("node-c-{i}").to_string(),
                role: [Role::Compactor].to_vec(),
                ..node.clone()
            };
            add_node_to_consistent_hash(&node_q, &Role::Querier).await;
            add_node_to_consistent_hash(&node_c, &Role::Compactor).await;
        }

        for key in ["test", "test1", "test2", "test3"] {
            println!(
                "{key}-q: {}",
                get_node_from_consistent_hash(key, &Role::Querier)
                    .await
                    .unwrap()
            );
            println!(
                "{key}-c: {}",
                get_node_from_consistent_hash(key, &Role::Compactor)
                    .await
                    .unwrap()
            );
        }

        // fnv hash
        let _data = [
            ["test", "node-q-8", "node-c-8"],
            ["test1", "node-q-8", "node-c-8"],
            ["test2", "node-q-8", "node-c-8"],
            ["test3", "node-q-8", "node-c-8"],
        ];
        // murmur3 hash
        let _data = [
            ["test", "node-q-2", "node-c-3"],
            ["test1", "node-q-5", "node-c-6"],
            ["test2", "node-q-4", "node-c-2"],
            ["test3", "node-q-0", "node-c-3"],
        ];
        // cityhash hash
        let _data = [
            ["test", "node-q-6", "node-c-7"],
            ["test1", "node-q-5", "node-c-2"],
            ["test2", "node-q-2", "node-c-4"],
            ["test3", "node-q-2", "node-c-1"],
        ];
        // gxhash hash
        let data = [
            ["test", "node-q-8", "node-c-0"],
            ["test1", "node-q-9", "node-c-1"],
            ["test2", "node-q-9", "node-c-8"],
            ["test3", "node-q-3", "node-c-7"],
        ];
        for key in data {
            assert_eq!(
                get_node_from_consistent_hash(key.first().unwrap(), &Role::Querier).await,
                Some(key.get(1).unwrap().to_string())
            );
            assert_eq!(
                get_node_from_consistent_hash(key.first().unwrap(), &Role::Compactor).await,
                Some(key.get(2).unwrap().to_string())
            );
        }
    }
}

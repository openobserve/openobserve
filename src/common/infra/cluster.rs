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

use std::{ops::Bound, sync::Arc};

use config::{
    cluster::*,
    meta::cluster::{Node, NodeStatus, Role},
    utils::{hash::Sum64, json},
    RwBTreeMap, RwHashMap, CONFIG, INSTANCE_ID,
};
use etcd_client::PutOptions;
use infra::{
    db::{etcd, get_coordinator, Event},
    errors::{Error, Result},
};
use once_cell::sync::Lazy;

use crate::service::db;

const CONSISTENT_HASH_VNODES: usize = 3;

static NODES: Lazy<RwHashMap<String, Node>> = Lazy::new(Default::default);
static QUERIER_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);
static COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);

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
    for (k, v) in nodes.iter() {
        log::debug!("consistent hash[{}] {} {}", role, k, v);
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
    for (k, v) in nodes.iter() {
        log::debug!("consistent hash[{}] {} {}", role, k, v);
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
    loop {
        if let Some(uuid) = iter.value() {
            return Some(uuid.clone());
        };
        iter.move_next();
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
        NODES.insert(LOCAL_NODE_UUID.clone(), node);
        return Ok(());
    }
    if let Err(e) = register().await {
        log::error!("[CLUSTER] Register to cluster failed: {}", e);
        return Err(e);
    }

    // keep alive
    tokio::task::spawn(async move {
        let mut need_online_again = false;
        loop {
            if is_offline() {
                break;
            }

            if need_online_again {
                if let Err(e) = set_online(true).await {
                    log::error!("[CLUSTER] Set node online failed: {}", e);
                    continue;
                }
            }

            let lease_id = unsafe { LOCAL_NODE_KEY_LEASE_ID };
            let ret =
                etcd::keepalive_lease_id(lease_id, CONFIG.etcd.node_heartbeat_ttl, is_offline)
                    .await;
            if ret.is_ok() {
                break;
            }
            let e = ret.unwrap_err();
            let estr = e.to_string();
            if is_offline()
                || estr
                    != Error::from(etcd_client::Error::LeaseKeepAliveError(
                        "lease expired or revoked".to_string(),
                    ))
                    .to_string()
            {
                break;
            }
            log::error!("[CLUSTER] keepalive lease id expired or revoked, set node online again.");
            // set node online again
            need_online_again = true;
        }
    });

    Ok(())
}

/// Register to cluster
pub async fn register() -> Result<()> {
    // 1. create a cluster lock for node register
    let mut locker = etcd::Locker::new("nodes/register");
    locker.lock(0).await?;

    // 2. get node list
    let node_list = list_nodes().await?;

    // 3. calculate node_id
    let mut node_id = 1;
    let mut node_ids = Vec::new();
    for node in node_list {
        if is_querier(&node.role) {
            add_node_to_consistent_hash(&node, &Role::Querier).await;
        }
        if is_compactor(&node.role) {
            add_node_to_consistent_hash(&node, &Role::Compactor).await;
        }
        node_ids.push(node.id);
        NODES.insert(node.uuid.clone(), node);
    }
    node_ids.sort();
    for id in &node_ids {
        if *id == node_id {
            node_id += 1;
        } else {
            break;
        }
    }
    // update local id
    unsafe {
        LOCAL_NODE_ID = node_id;
    }

    // 4. join the cluster
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, *LOCAL_NODE_UUID);
    let node = Node {
        id: node_id,
        uuid: LOCAL_NODE_UUID.clone(),
        name: CONFIG.common.instance_name.clone(),
        http_addr: format!("http://{}:{}", get_local_http_ip(), CONFIG.http.port),
        grpc_addr: format!("http://{}:{}", get_local_grpc_ip(), CONFIG.grpc.port),
        role: LOCAL_NODE_ROLE.clone(),
        cpu_num: CONFIG.limit.cpu_num as u64,
        status: NodeStatus::Prepare,
        scheduled: true,
        broadcasted: false,
    };
    // cache local node
    if is_querier(&node.role) {
        add_node_to_consistent_hash(&node, &Role::Querier).await;
    }
    if is_compactor(&node.role) {
        add_node_to_consistent_hash(&node, &Role::Compactor).await;
    }
    NODES.insert(LOCAL_NODE_UUID.clone(), node.clone());
    let val = json::to_string(&node).unwrap();
    // register node to cluster
    let mut client = etcd::get_etcd_client().await.clone();
    let resp = client
        .lease_grant(CONFIG.etcd.node_heartbeat_ttl, None)
        .await?;
    let id = resp.id();
    // update local node key lease id
    unsafe {
        LOCAL_NODE_KEY_LEASE_ID = id;
    }
    let opt = PutOptions::new().with_lease(id);
    let _resp = client.put(key, val, Some(opt)).await?;

    // 5. watch node list
    tokio::task::spawn(async move { watch_node_list().await });

    // 7. register ok, release lock
    locker.unlock().await?;

    log::info!("[CLUSTER] Register to cluster ok");
    Ok(())
}

/// set online to cluster
pub async fn set_online(new_lease_id: bool) -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    // set node status to online
    let node = match NODES.get(LOCAL_NODE_UUID.as_str()) {
        Some(node) => {
            let mut val = node.value().clone();
            val.status = NodeStatus::Online;
            val
        }
        None => Node {
            id: unsafe { LOCAL_NODE_ID },
            uuid: LOCAL_NODE_UUID.clone(),
            name: CONFIG.common.instance_name.clone(),
            http_addr: format!("http://{}:{}", get_local_node_ip(), CONFIG.http.port),
            grpc_addr: format!("http://{}:{}", get_local_node_ip(), CONFIG.grpc.port),
            role: LOCAL_NODE_ROLE.clone(),
            cpu_num: CONFIG.limit.cpu_num as u64,
            status: NodeStatus::Online,
            scheduled: true,
            broadcasted: false,
        },
    };

    unsafe {
        LOCAL_NODE_STATUS = NodeStatus::Online;
    }

    // cache local node
    if is_querier(&node.role) {
        add_node_to_consistent_hash(&node, &Role::Querier).await;
    }
    if is_compactor(&node.role) {
        add_node_to_consistent_hash(&node, &Role::Compactor).await;
    }
    NODES.insert(LOCAL_NODE_UUID.clone(), node.clone());
    let val = json::to_string(&node).unwrap();

    if new_lease_id {
        // get new lease id
        let mut client = etcd::get_etcd_client().await.clone();
        let resp = client
            .lease_grant(CONFIG.etcd.node_heartbeat_ttl, None)
            .await?;
        let lease_id = resp.id();
        // update local node key lease id
        unsafe {
            LOCAL_NODE_KEY_LEASE_ID = lease_id;
        }
    }

    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, *LOCAL_NODE_UUID);
    let opt = PutOptions::new().with_lease(unsafe { LOCAL_NODE_KEY_LEASE_ID });
    let _resp = client.put(key, val, Some(opt)).await?;

    Ok(())
}

/// Leave cluster
pub async fn leave() -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }

    unsafe {
        LOCAL_NODE_STATUS = NodeStatus::Offline;
    }

    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, *LOCAL_NODE_UUID);
    let _resp = client.delete(key, None).await?;

    Ok(())
}

pub async fn update_node(uuid: &str, node: &Node) -> Result<()> {
    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, uuid);
    let val = json::to_string(node).unwrap();
    let _resp = client.put(key, val, None).await?;
    Ok(())
}

pub fn get_cached_nodes(cond: fn(&Node) -> bool) -> Option<Vec<Node>> {
    if NODES.is_empty() {
        return None;
    }
    Some(
        NODES
            .clone()
            .iter()
            .filter_map(|node| cond(&node).then(|| node.clone()))
            .collect(),
    )
}

#[inline(always)]
pub fn get_cached_online_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| node.status == NodeStatus::Online && node.scheduled)
}

#[inline]
pub fn get_cached_online_ingester_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online && node.scheduled && is_ingester(&node.role)
    })
}

#[inline]
pub fn get_cached_online_querier_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online && node.scheduled && is_querier(&node.role)
    })
}

#[inline(always)]
pub fn get_cached_online_query_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        node.status == NodeStatus::Online
            && node.scheduled
            && (is_querier(&node.role) || is_ingester(&node.role))
    })
}

#[inline]
pub fn get_internal_grpc_token() -> String {
    if CONFIG.grpc.internal_grpc_token.is_empty() {
        INSTANCE_ID.get("instance_id").unwrap().to_string()
    } else {
        CONFIG.grpc.internal_grpc_token.clone()
    }
}

/// List nodes from cluster or local cache
pub async fn list_nodes() -> Result<Vec<Node>> {
    let mut nodes = Vec::new();
    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/", &CONFIG.etcd.prefix);
    let opt = etcd_client::GetOptions::new().with_prefix();
    let ret = client.get(key.clone(), Some(opt)).await.map_err(|e| {
        log::error!("[CLUSTER] error getting nodes: {}", e);
        e
    })?;

    for item in ret.kvs() {
        let node: Node = json::from_slice(item.value())?;
        nodes.push(node.to_owned());
    }

    Ok(nodes)
}

async fn watch_node_list() -> Result<()> {
    let cluster_coordinator = get_coordinator().await;
    let key = "/nodes/";
    let mut events = cluster_coordinator.watch(key).await?;
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
                log::info!("[CLUSTER] join {:?}", item_value.clone());
                let broadcasted = match NODES.clone().get(item_key) {
                    Some(v) => v.broadcasted,
                    None => false,
                };
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
                            if let Err(e) = db::file_list::local::broadcast_cache(notice_uuid).await
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
                NODES.insert(item_key.to_string(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value = NODES.get(item_key).unwrap().clone();
                log::info!("[CLUSTER] leave {:?}", item_value);
                if is_querier(&item_value.role) {
                    remove_node_from_consistent_hash(&item_value, &Role::Querier).await;
                }
                if is_compactor(&item_value.role) {
                    remove_node_from_consistent_hash(&item_value, &Role::Compactor).await;
                }
                NODES.remove(item_key);
            }
            Event::Empty => {}
        }
    }

    Ok(())
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
pub fn get_node_by_uuid(uuid: &str) -> Option<Node> {
    NODES.get(uuid).map(|node| node.clone())
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
        assert!(get_cached_online_nodes().is_some());
        assert!(get_cached_online_query_nodes().is_some());
        assert!(get_cached_online_ingester_nodes().is_some());
        assert!(get_cached_online_querier_nodes().is_some());
    }

    #[tokio::test]
    #[ignore]
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

        for key in vec!["test", "test1", "test2", "test3"] {
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
        let _data = vec![
            ["test", "node-q-8", "node-c-8"],
            ["test1", "node-q-8", "node-c-8"],
            ["test2", "node-q-8", "node-c-8"],
            ["test3", "node-q-8", "node-c-8"],
        ];
        // murmur3 hash
        let _data = vec![
            ["test", "node-q-2", "node-c-3"],
            ["test1", "node-q-5", "node-c-6"],
            ["test2", "node-q-4", "node-c-2"],
            ["test3", "node-q-0", "node-c-3"],
        ];
        // cityhash hash
        let _data = vec![
            ["test", "node-q-6", "node-c-7"],
            ["test1", "node-q-5", "node-c-2"],
            ["test2", "node-q-2", "node-c-4"],
            ["test3", "node-q-2", "node-c-1"],
        ];
        // gxhash hash
        let data = vec![
            ["test", "node-q-8", "node-c-0"],
            ["test1", "node-q-9", "node-c-1"],
            ["test2", "node-q-9", "node-c-8"],
            ["test3", "node-q-3", "node-c-7"],
        ];
        for key in data {
            assert_eq!(
                get_node_from_consistent_hash(key.get(0).unwrap(), &Role::Querier).await,
                Some(key.get(1).unwrap().to_string())
            );
            assert_eq!(
                get_node_from_consistent_hash(key.get(0).unwrap(), &Role::Compactor).await,
                Some(key.get(2).unwrap().to_string())
            );
        }
    }
}

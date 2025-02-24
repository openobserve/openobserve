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

use std::{
    cmp::min,
    collections::HashMap,
    ops::Bound,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use config::{
    cluster::*,
    get_config,
    meta::{
        cluster::{Node, NodeStatus, Role, RoleGroup},
        meta_store::MetaStore,
    },
    utils::{
        hash::Sum64,
        json,
        sysinfo::{get_node_metrics, NodeMetrics},
    },
    RwAHashMap, RwBTreeMap,
};
use infra::{
    db::{get_coordinator, Event},
    errors::Result,
};
use once_cell::sync::Lazy;

mod etcd;
mod nats;

const CONSISTENT_HASH_PRIME: u32 = 16777619;

static NODES: Lazy<RwAHashMap<String, Node>> = Lazy::new(Default::default);
static QUERIER_INTERACTIVE_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
static QUERIER_BACKGROUND_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
static COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);
static FLATTEN_COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
static NODES_HEALTH_CHECK: Lazy<RwAHashMap<String, usize>> = Lazy::new(Default::default);

pub async fn add_node_to_consistent_hash(node: &Node, role: &Role, group: Option<RoleGroup>) {
    let mut nodes = match role {
        Role::Querier => match group {
            Some(RoleGroup::Interactive) => QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await,
            Some(RoleGroup::Background) => QUERIER_BACKGROUND_CONSISTENT_HASH.write().await,
            _ => QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await,
        },
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.write().await,
        Role::FlattenCompactor => FLATTEN_COMPACTOR_CONSISTENT_HASH.write().await,
        _ => return,
    };
    let mut h = config::utils::hash::gxhash::new();
    for i in 0..get_config().limit.consistent_hash_vnodes {
        let key = format!("{}:{}:{}", CONSISTENT_HASH_PRIME, node.name, i);
        let hash = h.sum64(&key);
        nodes.insert(hash, node.name.clone());
    }
}

pub async fn remove_node_from_consistent_hash(node: &Node, role: &Role, group: Option<RoleGroup>) {
    let mut nodes = match role {
        Role::Querier => match group {
            Some(RoleGroup::Interactive) => QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await,
            Some(RoleGroup::Background) => QUERIER_BACKGROUND_CONSISTENT_HASH.write().await,
            _ => QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await,
        },
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.write().await,
        Role::FlattenCompactor => FLATTEN_COMPACTOR_CONSISTENT_HASH.write().await,
        _ => return,
    };
    let mut h = config::utils::hash::gxhash::new();
    for i in 0..get_config().limit.consistent_hash_vnodes {
        let key = format!("{}:{}{}", CONSISTENT_HASH_PRIME, node.name, i);
        let hash = h.sum64(&key);
        nodes.remove(&hash);
    }
}

pub async fn get_node_from_consistent_hash(
    key: &str,
    role: &Role,
    group: Option<RoleGroup>,
) -> Option<String> {
    let nodes = match role {
        Role::Querier => match group {
            Some(RoleGroup::Interactive) => QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await,
            Some(RoleGroup::Background) => QUERIER_BACKGROUND_CONSISTENT_HASH.read().await,
            _ => QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await,
        },
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.read().await,
        Role::FlattenCompactor => FLATTEN_COMPACTOR_CONSISTENT_HASH.read().await,
        _ => return None,
    };
    if nodes.is_empty() {
        return None;
    }
    let hash = config::utils::hash::gxhash::new().sum64(key);
    let mut iter = nodes.lower_bound(Bound::Included(&hash));
    if let Some((_, name)) = iter.next() {
        return Some(name.clone());
    }
    if let Some((_, name)) = nodes.first_key_value() {
        return Some(name.clone());
    }
    None
}

pub async fn print_consistent_hash() -> HashMap<String, HashMap<String, Vec<u64>>> {
    let mut map = HashMap::new();
    let r = QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await;
    let mut node_map = HashMap::new();
    for (k, v) in r.iter() {
        let entry = node_map.entry(v.clone()).or_insert(Vec::new());
        entry.push(*k);
    }
    drop(r);
    map.insert("querier_interactive".to_string(), node_map);
    let r = QUERIER_BACKGROUND_CONSISTENT_HASH.read().await;
    let mut node_map = HashMap::new();
    for (k, v) in r.iter() {
        let entry = node_map.entry(v.clone()).or_insert(Vec::new());
        entry.push(*k);
    }
    drop(r);
    map.insert("querier_background".to_string(), node_map);
    let r = COMPACTOR_CONSISTENT_HASH.read().await;
    let mut node_map = HashMap::new();
    for (k, v) in r.iter() {
        let entry = node_map.entry(v.clone()).or_insert(Vec::new());
        entry.push(*k);
    }
    drop(r);
    map.insert("compactor".to_string(), node_map);
    let r = FLATTEN_COMPACTOR_CONSISTENT_HASH.read().await;
    let mut node_map = HashMap::new();
    for (k, v) in r.iter() {
        let entry = node_map.entry(v.clone()).or_insert(Vec::new());
        entry.push(*k);
    }
    drop(r);
    map.insert("flatten_compactor".to_string(), node_map);
    map
}

/// Register and keep alive the node to cluster
pub async fn register_and_keep_alive() -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        if !LOCAL_NODE.is_single_node() {
            panic!("Local mode only support NODE_ROLE=all");
        }
        // cache local node
        let node = load_local_node();
        add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Interactive)).await;
        add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Background)).await;
        add_node_to_consistent_hash(&node, &Role::Compactor, None).await;
        add_node_to_consistent_hash(&node, &Role::FlattenCompactor, None).await;
        NODES.write().await.insert(LOCAL_NODE.uuid.clone(), node);
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::register_and_keep_alive().await?,
        _ => etcd::register_and_keep_alive().await?,
    };

    // check node heatbeat
    tokio::task::spawn(async move {
        let cfg = get_config();
        let client = reqwest::ClientBuilder::new()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();
        let ttl_keep_alive = min(10, (cfg.limit.node_heartbeat_ttl / 2) as u64);
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(ttl_keep_alive)).await;
            if let Err(e) = check_nodes_status(&client).await {
                log::error!("[CLUSTER] check_nodes_status failed: {}", e);
            }
        }
    });

    Ok(())
}

pub async fn set_online(new_lease_id: bool) -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_online().await,
        _ => etcd::set_online(new_lease_id).await,
    }
}

pub async fn set_offline(new_lease_id: bool) -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_offline().await,
        _ => etcd::set_offline(new_lease_id).await,
    }
}

pub async fn update_local_node(node: &Node) -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::update_local_node(node).await,
        _ => etcd::update_local_node(node).await,
    }
}

pub async fn set_unschedulable() -> Result<()> {
    let node_id = LOCAL_NODE.uuid.clone();
    if let Some(mut node) = get_node_by_uuid(&node_id).await {
        node.scheduled = false;
        update_local_node(&node).await?;
    };
    Ok(())
}
pub async fn set_schedulable() -> Result<()> {
    let node_id = LOCAL_NODE.uuid.clone();
    if let Some(mut node) = get_node_by_uuid(&node_id).await {
        node.scheduled = true;
        update_local_node(&node).await?;
    };
    Ok(())
}

pub async fn leave() -> Result<()> {
    LOCAL_NODE_STATUS.store(NodeStatus::Offline as _, Ordering::Release);

    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
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
                let (_broadcasted, exist) = match NODES.read().await.get(item_key) {
                    Some(v) => (v.broadcasted, item_value.is_same(v)),
                    None => (false, false),
                };
                if exist {
                    // update the node status metrics in local cache
                    set_node_status_metrics(&item_value).await;
                    continue;
                }
                if item_value.status == NodeStatus::Offline {
                    log::info!("[CLUSTER] offline {:?}", item_value);
                    if item_value.is_interactive_querier() {
                        remove_node_from_consistent_hash(
                            &item_value,
                            &Role::Querier,
                            Some(RoleGroup::Interactive),
                        )
                        .await;
                    }
                    if item_value.is_background_querier() {
                        remove_node_from_consistent_hash(
                            &item_value,
                            &Role::Querier,
                            Some(RoleGroup::Background),
                        )
                        .await;
                    }
                    if item_value.is_compactor() {
                        remove_node_from_consistent_hash(&item_value, &Role::Compactor, None).await;
                    }
                    if item_value.is_flatten_compactor() {
                        remove_node_from_consistent_hash(
                            &item_value,
                            &Role::FlattenCompactor,
                            None,
                        )
                        .await;
                    }
                    NODES.write().await.remove(item_key);
                    continue;
                }
                log::info!("[CLUSTER] join {:?}", item_value);
                item_value.broadcasted = true;
                // check if the same node is already in the cluster
                if let Some(node) = get_cached_node_by_name(&item_value.name).await {
                    if node.uuid.ne(&item_value.uuid) {
                        NODES.write().await.remove(&node.uuid);
                    }
                }
                if item_value.is_interactive_querier() {
                    add_node_to_consistent_hash(
                        &item_value,
                        &Role::Querier,
                        Some(RoleGroup::Interactive),
                    )
                    .await;
                }
                if item_value.is_background_querier() {
                    add_node_to_consistent_hash(
                        &item_value,
                        &Role::Querier,
                        Some(RoleGroup::Background),
                    )
                    .await;
                }
                if item_value.is_compactor() {
                    add_node_to_consistent_hash(&item_value, &Role::Compactor, None).await;
                }
                if item_value.is_flatten_compactor() {
                    add_node_to_consistent_hash(&item_value, &Role::FlattenCompactor, None).await;
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
                if item_value.is_interactive_querier() {
                    remove_node_from_consistent_hash(
                        &item_value,
                        &Role::Querier,
                        Some(RoleGroup::Interactive),
                    )
                    .await;
                }
                if item_value.is_background_querier() {
                    remove_node_from_consistent_hash(
                        &item_value,
                        &Role::Querier,
                        Some(RoleGroup::Background),
                    )
                    .await;
                }
                if item_value.is_compactor() {
                    remove_node_from_consistent_hash(&item_value, &Role::Compactor, None).await;
                }
                if item_value.is_flatten_compactor() {
                    remove_node_from_consistent_hash(&item_value, &Role::FlattenCompactor, None)
                        .await;
                }
                NODES.write().await.remove(item_key);
            }
            Event::Empty => {}
        }
    }

    Ok(())
}

async fn check_nodes_status(client: &reqwest::Client) -> Result<()> {
    let cfg = get_config();
    if !cfg.health_check.enabled {
        return Ok(());
    }
    let nodes = get_cached_online_nodes().await.unwrap_or_default();
    for node in nodes {
        if node.uuid.eq(LOCAL_NODE.uuid.as_str()) {
            continue;
        }
        let url = format!("{}{}/healthz", node.http_addr, cfg.common.base_uri);
        let resp = client
            .get(url)
            .timeout(Duration::from_secs(cfg.health_check.timeout))
            .send()
            .await;
        if resp.is_err() || !resp.unwrap().status().is_success() {
            log::error!(
                "[CLUSTER] node {}[{}] health check failed",
                node.name,
                node.http_addr
            );
            let mut w = NODES_HEALTH_CHECK.write().await;
            let Some(entry) = w.get_mut(&node.uuid) else {
                // node haven't been added to the cluster yet, when the health check first succeed,
                // it will be added to the check map
                continue;
            };
            *entry += 1;
            let times = *entry;
            drop(w);

            if times >= cfg.health_check.failed_times {
                log::error!(
                    "[CLUSTER] node {}[{}] health check failed {} times, remove it",
                    node.name,
                    node.http_addr,
                    times
                );
                if node.is_interactive_querier() {
                    remove_node_from_consistent_hash(
                        &node,
                        &Role::Querier,
                        Some(RoleGroup::Interactive),
                    )
                    .await;
                }
                if node.is_background_querier() {
                    remove_node_from_consistent_hash(
                        &node,
                        &Role::Querier,
                        Some(RoleGroup::Background),
                    )
                    .await;
                }
                if node.is_compactor() {
                    remove_node_from_consistent_hash(&node, &Role::Compactor, None).await;
                }
                if node.is_flatten_compactor() {
                    remove_node_from_consistent_hash(&node, &Role::FlattenCompactor, None).await;
                }
                NODES.write().await.remove(&node.uuid);
                NODES_HEALTH_CHECK.write().await.remove(&node.uuid);
            }
        } else {
            // first time the node is online, add it to the check map, or reset the check count
            let mut w = NODES_HEALTH_CHECK.write().await;
            let entry = w.entry(node.uuid.clone()).or_insert(0);
            if *entry > 0 {
                *entry = 0;
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
pub async fn get_cached_node_by_name(name: &str) -> Option<Node> {
    let r = NODES.read().await;
    if r.is_empty() {
        return None;
    }
    r.iter()
        .find(|(_uuid, node)| node.name == name)
        .map(|(_uuid, node)| node.clone())
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
        node.status == NodeStatus::Online && node.scheduled && node.is_ingester()
    })
    .await
}

#[inline]
pub async fn get_cached_online_querier_nodes(group: Option<RoleGroup>) -> Option<Vec<Node>> {
    let nodes = get_cached_nodes(|node| {
        node.status == NodeStatus::Online && node.scheduled && node.is_querier()
    })
    .await;
    filter_nodes_with_group(nodes, group)
}

#[inline]
pub async fn get_cached_online_query_nodes(group: Option<RoleGroup>) -> Option<Vec<Node>> {
    let nodes = get_cached_nodes(|node| {
        node.status == NodeStatus::Online
            && node.scheduled
            && (node.is_querier() || node.is_ingester())
    })
    .await;
    filter_nodes_with_group(nodes, group)
}

#[inline(always)]
fn filter_nodes_with_group(
    nodes: Option<Vec<Node>>,
    group: Option<RoleGroup>,
) -> Option<Vec<Node>> {
    let mut nodes = nodes?;
    match group {
        Some(RoleGroup::Interactive) => nodes
            .retain(|n| n.role_group == RoleGroup::None || n.role_group == RoleGroup::Interactive),
        Some(RoleGroup::Background) => nodes
            .retain(|n| n.role_group == RoleGroup::None || n.role_group == RoleGroup::Background),
        _ => {}
    };
    Some(nodes)
}

// update the node status metrics in local cache
async fn set_node_status_metrics(node: &Node) {
    let mut w = NODES.write().await;
    if let Some(v) = w.get_mut(node.uuid.as_str()) {
        v.metrics = node.metrics.clone();
    }
}

fn update_node_status_metrics() -> NodeMetrics {
    let node_status = get_node_metrics();

    config::metrics::NODE_CPU_TOTAL
        .with_label_values(&[])
        .set(node_status.cpu_total as i64);
    config::metrics::NODE_CPU_USAGE
        .with_label_values(&[])
        .set(node_status.cpu_usage as i64);
    config::metrics::NODE_MEMORY_TOTAL
        .with_label_values(&[])
        .set(node_status.memory_total as i64);
    config::metrics::NODE_MEMORY_USAGE
        .with_label_values(&[])
        .set(node_status.memory_usage as i64);
    config::metrics::NODE_TCP_CONNECTIONS
        .with_label_values(&["total"])
        .set(node_status.tcp_conns as i64);
    config::metrics::NODE_TCP_CONNECTIONS
        .with_label_values(&["established"])
        .set(node_status.tcp_conns_established as i64);
    config::metrics::NODE_TCP_CONNECTIONS
        .with_label_values(&["close_wait"])
        .set(node_status.tcp_conns_close_wait as i64);
    config::metrics::NODE_TCP_CONNECTIONS
        .with_label_values(&["time_wait"])
        .set(node_status.tcp_conns_time_wait as i64);

    node_status
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
        register_and_keep_alive().await.unwrap();
        set_online(false).await.unwrap();
        leave().await.unwrap();
        assert!(get_cached_online_nodes().await.is_some());
        assert!(get_cached_online_query_nodes(None).await.is_some());
        assert!(get_cached_online_ingester_nodes().await.is_some());
        assert!(get_cached_online_querier_nodes(None).await.is_some());

        // Reset the global state.
        QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await.clear();
        QUERIER_BACKGROUND_CONSISTENT_HASH.write().await.clear();
        COMPACTOR_CONSISTENT_HASH.write().await.clear();
        FLATTEN_COMPACTOR_CONSISTENT_HASH.write().await.clear();

        // Test consistent hash logic.
        let node = load_local_node();
        for i in 0..10 {
            let node_q = Node {
                name: format!("node-q-{i}").to_string(),
                role: [Role::Querier].to_vec(),
                ..node.clone()
            };
            let node_c = Node {
                name: format!("node-c-{i}").to_string(),
                role: [Role::Compactor].to_vec(),
                ..node.clone()
            };
            add_node_to_consistent_hash(&node_q, &Role::Querier, None).await;
            add_node_to_consistent_hash(&node_c, &Role::Compactor, None).await;
            add_node_to_consistent_hash(&node_c, &Role::FlattenCompactor, None).await;
        }

        for key in ["test", "test1", "test2", "test3", "test4", "test5", "test6"] {
            println!(
                "{key}-q: {}",
                get_node_from_consistent_hash(key, &Role::Querier, None)
                    .await
                    .unwrap()
            );
            println!(
                "{key}-c: {}",
                get_node_from_consistent_hash(key, &Role::Compactor, None)
                    .await
                    .unwrap()
            );
        }

        // gxhash hash
        let data = [
            ["test", "node-q-2", "node-c-7"],
            ["test1", "node-q-3", "node-c-0"],
            ["test2", "node-q-6", "node-c-5"],
            ["test3", "node-q-9", "node-c-9"],
            ["test4", "node-q-2", "node-c-0"],
            ["test5", "node-q-5", "node-c-8"],
            ["test6", "node-q-5", "node-c-8"],
        ];

        remove_node_from_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Interactive)).await;
        remove_node_from_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Background)).await;
        remove_node_from_consistent_hash(&node, &Role::Compactor, None).await;
        remove_node_from_consistent_hash(&node, &Role::FlattenCompactor, None).await;
        for key in data {
            assert_eq!(
                get_node_from_consistent_hash(key.first().unwrap(), &Role::Querier, None).await,
                Some(key.get(1).unwrap().to_string())
            );
            assert_eq!(
                get_node_from_consistent_hash(key.first().unwrap(), &Role::Compactor, None).await,
                Some(key.get(2).unwrap().to_string())
            );
        }
    }
}

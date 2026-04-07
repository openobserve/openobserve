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

use std::{
    ops::Bound,
    sync::{Arc, LazyLock as Lazy},
    time::Duration,
};

use config::{
    RwAHashMap, RwBTreeMap,
    cluster::*,
    get_config,
    meta::cluster::{Node, NodeStatus, Role, RoleGroup},
    utils::{
        hash::Sum64,
        json,
        sysinfo::{NodeMetrics, get_node_metrics},
    },
};
use hashbrown::{HashMap, HashSet};

use crate::{
    db::{Event, get_coordinator},
    errors::*,
};

mod scheduler;

pub use scheduler::select_best_node;

const CONSISTENT_HASH_PRIME: u32 = 16777619;

pub const NODES_KEY: &str = "/nodes/";
static NODES: Lazy<RwAHashMap<String, Node>> = Lazy::new(Default::default);
pub static QUERIER_INTERACTIVE_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
pub static QUERIER_BACKGROUND_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
pub static COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> = Lazy::new(Default::default);
pub static FLATTEN_COMPACTOR_CONSISTENT_HASH: Lazy<RwBTreeMap<u64, String>> =
    Lazy::new(Default::default);
pub static NODES_HEALTH_CHECK: Lazy<RwAHashMap<String, usize>> = Lazy::new(Default::default);

pub async fn add_node_to_cache(node: Node) {
    NODES.write().await.insert(node.uuid.clone(), node);
}

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
        let key = format!("{}:{}:{}", CONSISTENT_HASH_PRIME, node.name, i);
        let hash = h.sum64(&key);
        nodes.remove(&hash);
    }
}

pub async fn get_node_from_consistent_hash(
    key: &str,
    role: &Role,
    group: Option<RoleGroup>,
) -> Option<String> {
    let hash = config::utils::hash::gxhash::new().sum64(key);
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
    let mut iter = nodes.lower_bound(Bound::Included(&hash));
    if let Some((_, name)) = iter.next() {
        return Some(name.clone());
    }
    if let Some((_, name)) = nodes.first_key_value() {
        return Some(name.clone());
    }
    None
}

/// Like [`get_node_from_consistent_hash`] but restricts the ring walk to nodes
/// whose names are in `allowed`.
///
/// Use this when a query runs on a subset of all queriers (e.g.
/// `max_nodes_per_query=3` with `strategy=org/stream`).  Walking the global
/// ring but skipping nodes outside the allowed set preserves all consistent-
/// hashing properties (minimal remapping on membership change, even
/// distribution via vnodes) while confining dispatch to the selected subset.
pub async fn get_node_from_consistent_hash_within(
    key: &str,
    role: &Role,
    group: Option<RoleGroup>,
    allowed: &HashSet<String>,
) -> Option<String> {
    let hash = config::utils::hash::gxhash::new().sum64(key);
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

    // Walk clockwise from the hash position, stop at the first node in `allowed`.
    let mut iter = nodes.lower_bound(Bound::Included(&hash));
    while let Some((_, name)) = iter.next() {
        if allowed.contains(name) {
            return Some(name.clone());
        }
    }
    // Wrap around to the beginning of the ring.
    for (_, name) in nodes.iter() {
        if allowed.contains(name) {
            return Some(name.clone());
        }
    }
    None
}

/// Returns up to `n` distinct node names starting from the position of `key`
/// on the consistent hash ring, wrapping around if necessary.
///
/// Useful for selecting a stable subset of nodes for a given key (e.g. org_id
/// or stream_key) without pinning to a single node.
pub async fn get_nodes_from_consistent_hash(
    key: &str,
    role: &Role,
    group: Option<RoleGroup>,
    n: usize,
) -> HashSet<String> {
    if n == 0 {
        return HashSet::new();
    }
    let hash = config::utils::hash::gxhash::new().sum64(key);
    let nodes = match role {
        Role::Querier => match group {
            Some(RoleGroup::Interactive) => QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await,
            Some(RoleGroup::Background) => QUERIER_BACKGROUND_CONSISTENT_HASH.read().await,
            _ => QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await,
        },
        Role::Compactor => COMPACTOR_CONSISTENT_HASH.read().await,
        Role::FlattenCompactor => FLATTEN_COMPACTOR_CONSISTENT_HASH.read().await,
        _ => return HashSet::new(),
    };
    if nodes.is_empty() {
        return HashSet::new();
    }

    // Start from the hash position and walk clockwise until we have `n` distinct nodes.
    let mut result = HashSet::with_capacity(n);
    let mut iter = nodes.lower_bound(Bound::Included(&hash));
    while let Some((_, name)) = iter.next() {
        result.insert(name.to_string());
        if result.len() >= n {
            return result;
        }
    }
    // Wrap around to the beginning of the ring.
    for (_, name) in nodes.iter() {
        result.insert(name.to_string());
        if result.len() >= n {
            break;
        }
    }
    result
}

pub async fn count_consistent_hash() -> HashMap<String, usize> {
    let mut map = HashMap::new();
    let r = QUERIER_INTERACTIVE_CONSISTENT_HASH.read().await;
    map.insert("querier_interactive".to_string(), r.len());
    drop(r);
    let r = QUERIER_BACKGROUND_CONSISTENT_HASH.read().await;
    map.insert("querier_background".to_string(), r.len());
    drop(r);
    let r = COMPACTOR_CONSISTENT_HASH.read().await;
    map.insert("compactor".to_string(), r.len());
    drop(r);
    let r = FLATTEN_COMPACTOR_CONSISTENT_HASH.read().await;
    map.insert("flatten_compactor".to_string(), r.len());
    map
}

pub async fn reset_consistent_hash() {
    QUERIER_INTERACTIVE_CONSISTENT_HASH.write().await.clear();
    QUERIER_BACKGROUND_CONSISTENT_HASH.write().await.clear();
    COMPACTOR_CONSISTENT_HASH.write().await.clear();
    FLATTEN_COMPACTOR_CONSISTENT_HASH.write().await.clear();
}

/// List nodes from cluster or local cache
pub async fn list_nodes() -> Result<Vec<Node>> {
    let mut nodes = Vec::new();
    let client = get_coordinator().await;
    let items = client.list_values(NODES_KEY).await.map_err(|e| {
        log::error!("[CLUSTER] error getting nodes: {e}");
        e
    })?;

    for item in items {
        let node: Node = json::from_slice(&item).map_err(|e| {
            log::error!("[CLUSTER] error parsing node: {e}, payload: {item:#?}");
            e
        })?;
        nodes.push(node.to_owned());
    }

    Ok(nodes)
}

pub async fn watch_node_list() -> Result<()> {
    let key = NODES_KEY;
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
                let mut item_value: Node = match json::from_slice(ev.value.as_ref().unwrap()) {
                    Ok(v) => v,
                    Err(e) => {
                        let value_str = String::from_utf8_lossy(ev.value.as_ref().unwrap());
                        log::error!(
                            "[CLUSTER] watch_node_list: error parsing node: {e}, payload: {value_str}"
                        );
                        continue;
                    }
                };
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
                    log::info!("[CLUSTER] offline {item_value:?}");
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
                log::info!("[CLUSTER] join {item_value:?}");
                item_value.broadcasted = true;
                // check if the same node is already in the cluster
                if let Some(node) = get_cached_node_by_name(&item_value.name).await
                    && node.uuid.ne(&item_value.uuid)
                {
                    NODES.write().await.remove(&node.uuid);
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
                NODES_HEALTH_CHECK
                    .write()
                    .await
                    .insert(item_key.to_string(), 0);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value = match NODES.read().await.get(item_key) {
                    Some(v) => v.clone(),
                    None => {
                        continue;
                    }
                };
                log::info!("[CLUSTER] leave {item_value:?}");
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
                NODES_HEALTH_CHECK.write().await.remove(item_key);
            }
            Event::Empty => {}
        }
    }

    Ok(())
}

pub async fn check_nodes_status(client: &reqwest::Client) -> Result<()> {
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
                // when the node comes online we populate the health check map
                // its expected that when node is marked online, it should be able to respond
                // to health checks. A node is marked online after GRPC init which marks complete
                // setup of the node.
                log::warn!(
                    "[CLUSTER] node {node:?} is marked as online but not present in health check map"
                );
                return Err(Error::Message(format!(
                    "{node:?} node state not in health check map"
                )));
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

pub async fn get_node_by_addr(addr: &str) -> Option<Node> {
    let nodes = get_cached_nodes(|_| true).await.unwrap_or_default();
    nodes.iter().find(|n| n.grpc_addr == addr).cloned()
}

#[inline(always)]
pub async fn get_node_by_uuid(uuid: &str) -> Option<Node> {
    NODES.read().await.get(uuid).cloned()
}

#[inline(always)]
pub async fn get_cached_node_by_name(name: &str) -> Option<Node> {
    let r = NODES.read().await;
    if r.is_empty() {
        drop(r);
        return None;
    }
    let node = r
        .iter()
        .find(|(_uuid, node)| node.name == name)
        .map(|(_uuid, node)| node.clone());
    drop(r);
    node
}

#[inline]
pub async fn get_cached_online_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| node.status == NodeStatus::Online).await
}

#[inline]
pub async fn get_cached_online_router_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| node.status == NodeStatus::Online && node.is_router()).await
}

#[inline]
pub async fn get_cached_online_query_nodes(group: Option<RoleGroup>) -> Option<Vec<Node>> {
    let nodes = get_cached_nodes(|node| {
        node.status == NodeStatus::Online && (node.is_querier() || node.is_ingester())
    })
    .await;
    filter_nodes_with_group(nodes, group)
}

#[inline]
pub async fn get_cached_online_querier_nodes(group: Option<RoleGroup>) -> Option<Vec<Node>> {
    let nodes =
        get_cached_nodes(|node| node.status == NodeStatus::Online && node.is_querier()).await;
    filter_nodes_with_group(nodes, group)
}

#[inline]
pub async fn get_cached_online_ingester_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| node.status == NodeStatus::Online && node.is_ingester()).await
}

#[inline]
pub async fn get_cached_schedulable_ingester_nodes() -> Option<Vec<Node>> {
    get_cached_nodes(|node| {
        // the scheduled used for ingestion, so we need to check it
        node.status == NodeStatus::Online && node.is_ingester() && node.scheduled
    })
    .await
}

#[inline(always)]
fn filter_nodes_with_group(
    nodes: Option<Vec<Node>>,
    group: Option<RoleGroup>,
) -> Option<Vec<Node>> {
    let mut nodes = nodes?;
    match group {
        Some(RoleGroup::Interactive) => nodes.retain(|n| {
            !n.is_querier()
                || n.role_group == RoleGroup::None
                || n.role_group == RoleGroup::Interactive
        }),
        Some(RoleGroup::Background) => nodes.retain(|n| {
            !n.is_querier()
                || n.role_group == RoleGroup::None
                || n.role_group == RoleGroup::Background
        }),
        _ => {}
    };
    Some(nodes)
}

// update the node status metrics in local cache
pub async fn set_node_status_metrics(node: &Node) {
    let mut w = NODES.write().await;
    if let Some(v) = w.get_mut(node.uuid.as_str()) {
        v.metrics = node.metrics.clone();
    }
}

pub fn generate_node_id(mut ids: Vec<i32>) -> i32 {
    ids.sort();
    ids.dedup();
    log::debug!("node_ids: {ids:?}");

    let mut new_node_id = 1;
    for id in ids {
        if id == new_node_id {
            new_node_id += 1;
        } else {
            break;
        }
    }
    log::debug!("new_node_id: {new_node_id:?}");
    new_node_id
}

pub async fn update_node_status_metrics() -> NodeMetrics {
    let node_status = get_node_metrics();

    config::metrics::NODE_UP
        .with_label_values(&[config::VERSION])
        .set(1);
    config::metrics::NODE_CPU_TOTAL
        .with_label_values::<&str>(&[])
        .set(node_status.cpu_total as i64);
    config::metrics::NODE_CPU_USAGE
        .with_label_values::<&str>(&[])
        .set(node_status.cpu_usage as i64);
    config::metrics::NODE_MEMORY_TOTAL
        .with_label_values::<&str>(&[])
        .set(node_status.memory_total as i64);
    config::metrics::NODE_MEMORY_USAGE
        .with_label_values::<&str>(&[])
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
    config::metrics::NODE_TCP_CONNECTIONS
        .with_label_values(&["resets"])
        .set(node_status.tcp_conns_resets as i64);

    // update node consistent hash metrics
    let consistent_hash = count_consistent_hash().await;
    for (k, v) in consistent_hash {
        config::metrics::NODE_CONSISTENT_HASH
            .with_label_values(&[k.as_str()])
            .set(v as i64);
    }

    node_status
}

pub async fn cache_node_list() -> Result<Vec<i32>> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(vec![]);
    }
    let node_list = match list_nodes().await {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };
    let mut node_ids = Vec::new();
    let mut w = NODES.write().await;
    for node in node_list {
        if node.is_interactive_querier() {
            add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Interactive)).await;
        }
        if node.is_background_querier() {
            add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Background)).await;
        }
        if node.is_compactor() {
            add_node_to_consistent_hash(&node, &Role::Compactor, None).await;
        }
        if node.is_flatten_compactor() {
            add_node_to_consistent_hash(&node, &Role::FlattenCompactor, None).await;
        }
        node_ids.push(node.id);
        w.insert(node.uuid.clone(), node);
    }
    drop(w);
    Ok(node_ids)
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
    async fn test_cluster_consistent_hash() {
        // Reset the global state.
        reset_consistent_hash().await;

        // Test consistent hash logic.
        let node = LOCAL_NODE.clone();
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
            add_node_to_consistent_hash(&node_q, &Role::Querier, Some(RoleGroup::Interactive))
                .await;
            add_node_to_consistent_hash(&node_q, &Role::Querier, Some(RoleGroup::Background)).await;
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

    #[tokio::test]
    async fn test_get_nodes_from_consistent_hash() {
        // Reset the global state.
        reset_consistent_hash().await;

        // Test consistent hash logic.
        let node = LOCAL_NODE.clone();
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
            add_node_to_consistent_hash(&node_q, &Role::Querier, Some(RoleGroup::Interactive))
                .await;
            add_node_to_consistent_hash(&node_q, &Role::Querier, Some(RoleGroup::Background)).await;
            add_node_to_consistent_hash(&node_q, &Role::Querier, None).await;
            add_node_to_consistent_hash(&node_c, &Role::Compactor, None).await;
            add_node_to_consistent_hash(&node_c, &Role::FlattenCompactor, None).await;
        }

        let nodes = get_nodes_from_consistent_hash("test", &Role::Querier, None, 3).await;

        // sort the nodes by name
        let mut nodes: Vec<String> = nodes.into_iter().collect();
        nodes.sort();
        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes, vec!["node-q-2", "node-q-5", "node-q-8"]);
    }
}

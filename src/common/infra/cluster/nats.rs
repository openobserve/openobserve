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

use core::cmp::min;

use config::{
    cluster::*,
    meta::cluster::{Node, NodeStatus, Role},
    utils::json,
    CONFIG,
};
use infra::{
    db::{get_coordinator, NEED_WATCH},
    dist_lock,
    errors::{Error, Result},
};
use tokio::{task, time};

/// Register and keepalive the node to cluster
pub(crate) async fn register_and_keepalive() -> Result<()> {
    if let Err(e) = register().await {
        log::error!("[CLUSTER] register failed: {}", e);
        return Err(e);
    }

    // keep alive
    task::spawn(async move {
        // check if the node is already online
        loop {
            time::sleep(time::Duration::from_secs(1)).await;
            let status = unsafe { LOCAL_NODE_STATUS.clone() };
            if status == NodeStatus::Online {
                break;
            }
        }
        // after the node is online, keepalive
        let ttl_keep_alive = min(10, (CONFIG.limit.node_heartbeat_ttl / 2) as u64);
        loop {
            time::sleep(time::Duration::from_secs(ttl_keep_alive)).await;
            loop {
                if is_offline() {
                    break;
                }
                match set_online().await {
                    Ok(_) => {
                        break;
                    }
                    Err(e) => {
                        log::error!("[CLUSTER] keepalive failed: {}", e);
                        time::sleep(time::Duration::from_secs(1)).await;
                        continue;
                    }
                }
            }
        }
    });

    Ok(())
}

/// Register to cluster
async fn register() -> Result<()> {
    // 1. create a cluster lock for node register
    let locker = dist_lock::lock("/nodes/register", CONFIG.limit.node_heartbeat_ttl as u64).await?;

    // 2. watch node list
    task::spawn(async move { super::watch_node_list().await });

    // 3. get node list
    let node_list = match super::list_nodes().await {
        Ok(v) => v,
        Err(e) => {
            dist_lock::unlock(&locker).await?;
            return Err(e);
        }
    };

    // 4. calculate node_id
    let mut node_id = 1;
    let mut node_ids = Vec::new();
    let mut w = super::NODES.write().await;
    for node in node_list {
        if is_querier(&node.role) {
            super::add_node_to_consistent_hash(&node, &Role::Querier).await;
        }
        if is_compactor(&node.role) {
            super::add_node_to_consistent_hash(&node, &Role::Compactor).await;
        }
        node_ids.push(node.id);
        w.insert(node.uuid.clone(), node);
    }
    drop(w);

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

    // 5. join the cluster
    let key = format!("/nodes/{}", *LOCAL_NODE_UUID);
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
    let val = json::to_vec(&node).unwrap();

    // cache local node
    if is_querier(&node.role) {
        super::add_node_to_consistent_hash(&node, &Role::Querier).await;
    }
    if is_compactor(&node.role) {
        super::add_node_to_consistent_hash(&node, &Role::Compactor).await;
    }

    let mut w = super::NODES.write().await;
    w.insert(LOCAL_NODE_UUID.clone(), node);
    drop(w);

    // 6. register node to cluster
    let client = get_coordinator().await;
    if let Err(e) = client.put(&key, val.into(), NEED_WATCH).await {
        dist_lock::unlock(&locker).await?;
        return Err(Error::Message(format!("register node error: {}", e)));
    }

    // 7. register ok, release lock
    dist_lock::unlock(&locker).await?;

    log::info!("[CLUSTER] Register to cluster ok");
    Ok(())
}

pub(crate) async fn set_online() -> Result<()> {
    set_status(NodeStatus::Online).await
}

pub(crate) async fn set_offline() -> Result<()> {
    set_status(NodeStatus::Offline).await
}

/// set online to cluster
pub(crate) async fn set_status(status: NodeStatus) -> Result<()> {
    // set node status to online
    let node = match super::NODES.read().await.get(LOCAL_NODE_UUID.as_str()) {
        Some(node) => {
            let mut val = node.clone();
            val.status = status.clone();
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
            status: status.clone(),
            scheduled: true,
            broadcasted: false,
        },
    };
    let val = json::to_string(&node).unwrap();

    unsafe {
        LOCAL_NODE_STATUS = status;
    }

    let key = format!("/nodes/{}", *LOCAL_NODE_UUID);
    let client = get_coordinator().await;
    if let Err(e) = client.put(&key, val.into(), NEED_WATCH).await {
        return Err(Error::Message(format!("online node error: {}", e)));
    }

    Ok(())
}

/// Leave cluster
pub(crate) async fn leave() -> Result<()> {
    unsafe {
        super::LOCAL_NODE_STATUS = NodeStatus::Offline;
    }

    let key = format!("/nodes/{}", *LOCAL_NODE_UUID);
    let client = get_coordinator().await;
    if let Err(e) = client.delete(&key, false, NEED_WATCH).await {
        return Err(Error::Message(format!("leave node error: {}", e)));
    }

    Ok(())
}

pub(crate) async fn update_local_node(node: &Node) -> Result<()> {
    let key = format!("/nodes/{}", *LOCAL_NODE_UUID);
    let val = json::to_vec(&node).unwrap();
    let client = get_coordinator().await;
    if let Err(e) = client.put(&key, val.into(), NEED_WATCH).await {
        return Err(Error::Message(format!("update node error: {}", e)));
    }
    Ok(())
}

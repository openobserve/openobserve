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

use config::{
    cluster::*,
    meta::cluster::{Node, NodeStatus, Role},
    utils::json,
    CONFIG,
};
use etcd_client::PutOptions;
use infra::{
    db::etcd,
    errors::{Error, Result},
};

/// Register and keepalive the node to cluster
pub(crate) async fn register_and_keepalive() -> Result<()> {
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
async fn register() -> Result<()> {
    // 1. create a cluster lock for node register
    let mut locker = etcd::Locker::new("nodes/register");
    locker.lock(0).await?;

    // 2. get node list
    let node_list = super::list_nodes().await?;

    // 3. calculate node_id
    let mut node_id = 1;
    let mut node_ids = Vec::new();
    for node in node_list {
        if is_querier(&node.role) {
            super::add_node_to_consistent_hash(&node, &Role::Querier).await;
        }
        if is_compactor(&node.role) {
            super::add_node_to_consistent_hash(&node, &Role::Compactor).await;
        }
        node_ids.push(node.id);
        super::NODES.insert(node.uuid.clone(), node);
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
        super::add_node_to_consistent_hash(&node, &Role::Querier).await;
    }
    if is_compactor(&node.role) {
        super::add_node_to_consistent_hash(&node, &Role::Compactor).await;
    }
    super::NODES.insert(LOCAL_NODE_UUID.clone(), node.clone());
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
    tokio::task::spawn(async move { super::watch_node_list().await });

    // 7. register ok, release lock
    locker.unlock().await?;

    log::info!("[CLUSTER] Register to cluster ok");
    Ok(())
}

/// set online to cluster
pub async fn set_online(new_lease_id: bool) -> Result<()> {
    // set node status to online
    let node = match super::NODES.get(LOCAL_NODE_UUID.as_str()) {
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
        super::add_node_to_consistent_hash(&node, &Role::Querier).await;
    }
    if is_compactor(&node.role) {
        super::add_node_to_consistent_hash(&node, &Role::Compactor).await;
    }
    super::NODES.insert(LOCAL_NODE_UUID.clone(), node.clone());
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
    unsafe {
        super::LOCAL_NODE_STATUS = NodeStatus::Offline;
    }

    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, *LOCAL_NODE_UUID);
    let _resp = client.delete(key, None).await?;

    Ok(())
}

pub async fn update_local_node(node: &Node) -> Result<()> {
    let mut client = etcd::get_etcd_client().await.clone();
    let key = format!("{}nodes/{}", &CONFIG.etcd.prefix, *LOCAL_NODE_UUID);
    let opt = PutOptions::new().with_lease(unsafe { LOCAL_NODE_KEY_LEASE_ID });
    let val = json::to_string(&node).unwrap();
    let _resp = client.put(key, val, Some(opt)).await?;
    Ok(())
}

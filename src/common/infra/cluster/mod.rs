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

use std::sync::atomic::Ordering;

use config::{
    cluster::{LOCAL_NODE, LOCAL_NODE_STATUS},
    get_config,
    meta::{
        cluster::{Node, NodeStatus, Role, RoleGroup},
        meta_store::MetaStore,
    },
};
use infra::{cluster::*, errors::*};

mod nats;

/// Register and keep alive the node to cluster
pub async fn register_and_keep_alive() -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        if !LOCAL_NODE.is_single_node() {
            panic!("Local mode only support NODE_ROLE=all");
        }
        // cache local node
        let mut node = LOCAL_NODE.clone();
        node.status = NodeStatus::Online;
        node.scheduled = true;
        add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Interactive)).await;
        add_node_to_consistent_hash(&node, &Role::Querier, Some(RoleGroup::Background)).await;
        add_node_to_consistent_hash(&node, &Role::Compactor, None).await;
        add_node_to_consistent_hash(&node, &Role::FlattenCompactor, None).await;
        add_node_to_cache(node).await;
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::register_and_keep_alive().await?,
        _ => nats::register_and_keep_alive().await?,
    };

    // check node heartbeat
    tokio::task::spawn(async move {
        let client = reqwest::ClientBuilder::new()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();
        loop {
            let cfg = get_config();
            let ttl_keep_alive = std::cmp::max(1, (cfg.limit.node_heartbeat_ttl / 2) as u64);
            tokio::time::sleep(tokio::time::Duration::from_secs(ttl_keep_alive)).await;
            if let Err(e) = check_nodes_status(&client).await {
                log::error!("[CLUSTER] check_nodes_status failed: {e}");
            }
        }
    });

    Ok(())
}

pub async fn set_online() -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_online().await,
        _ => nats::set_online().await,
    }
}

pub async fn set_offline() -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::set_offline().await,
        _ => nats::set_offline().await,
    }
}

pub async fn update_local_node(node: &Node) -> Result<()> {
    let cfg = get_config();
    if cfg.common.local_mode {
        return Ok(());
    }

    match cfg.common.cluster_coordinator.as_str().into() {
        MetaStore::Nats => nats::update_local_node(node).await,
        _ => nats::update_local_node(node).await,
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
        _ => nats::leave().await,
    }
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
    async fn test_set_online() {
        register_and_keep_alive().await.unwrap();
        set_online().await.unwrap();
        assert!(get_cached_online_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_set_offline() {
        register_and_keep_alive().await.unwrap();
        set_offline().await.unwrap();
        // doesn't work for local mode
        assert!(get_cached_online_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_set_unschedulable() {
        register_and_keep_alive().await.unwrap();
        set_unschedulable().await.unwrap();
        // doesn't work for local mode
        assert!(get_cached_online_ingester_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_set_schedulable() {
        register_and_keep_alive().await.unwrap();
        set_schedulable().await.unwrap();
        assert!(get_cached_online_ingester_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_update_local_node() {
        let node = LOCAL_NODE.clone();
        register_and_keep_alive().await.unwrap();
        update_local_node(&node).await.unwrap();
        assert!(get_cached_node_by_name(&node.name).await.is_some());
    }

    #[tokio::test]
    async fn test_get_cached_nodes() {
        let node = LOCAL_NODE.clone();
        register_and_keep_alive().await.unwrap();
        assert!(get_node_by_addr(&node.grpc_addr).await.is_some());
        assert!(get_node_by_uuid(&node.uuid).await.is_some());
        assert!(get_cached_node_by_name(&node.name).await.is_some());
        assert!(get_cached_online_nodes().await.is_some());
        assert!(get_cached_online_query_nodes(None).await.is_some());
    }

    #[tokio::test]
    async fn test_set_node_status_metrics() {
        let node = LOCAL_NODE.clone();
        register_and_keep_alive().await.unwrap();
        update_local_node(&node).await.unwrap();
        set_node_status_metrics(&node).await;
        assert!(get_cached_node_by_name(&node.name).await.is_some());
        assert!(get_cached_online_nodes().await.is_some());
    }

    #[tokio::test]
    async fn test_cluster() {
        register_and_keep_alive().await.unwrap();
        set_online().await.unwrap();
        leave().await.unwrap();
        assert!(get_cached_online_nodes().await.is_some());
        assert!(get_cached_online_query_nodes(None).await.is_some());
        assert!(get_cached_online_ingester_nodes().await.is_some());
        assert!(get_cached_online_querier_nodes(None).await.is_some());

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

        let ret = print_consistent_hash().await;
        assert_eq!(ret.len(), 4);
        assert_eq!(ret["querier_interactive"].len(), 10);
        assert_eq!(ret["querier_background"].len(), 10);
        assert_eq!(ret["compactor"].len(), 10);
        assert_eq!(ret["flatten_compactor"].len(), 10);
    }
}

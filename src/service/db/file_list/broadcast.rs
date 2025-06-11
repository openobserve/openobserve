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

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::{Node, NodeStatus, Role, RoleGroup, get_internal_grpc_token},
        stream::FileKey,
    },
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use proto::cluster_rpc;
use tokio::sync::{RwLock, mpsc};
use tonic::{Request, codec::CompressionEncoding, metadata::MetadataValue};

use crate::{common::infra::cluster, service::grpc::get_cached_channel};

/// use queue to batch send broadcast to other nodes
pub static BROADCAST_QUEUE: Lazy<RwLock<Vec<FileKey>>> =
    Lazy::new(|| RwLock::new(Vec::with_capacity(2048)));

static EVENTS: Lazy<RwLock<HashMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

type EventChannel = Arc<mpsc::UnboundedSender<Vec<FileKey>>>;

/// send an event to broadcast, will create a new channel for each nodes
pub async fn send(items: &[FileKey]) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if cfg.common.local_mode || items.is_empty() {
        return Ok(());
    }
    let nodes = cluster::get_cached_nodes(|node| {
        node.scheduled && node.is_querier() && node.status == NodeStatus::Online
    })
    .await
    .unwrap_or_default();
    let mut events = EVENTS.write().await;
    for node in nodes {
        if node.uuid.eq(&LOCAL_NODE.uuid) {
            continue;
        }
        // filter items by consistent hash
        let mut node_items = Vec::with_capacity(items.len());
        for item in items.iter() {
            if !node.is_querier() {
                node_items.push(item.clone());
                continue;
            }
            // check if the item is for interactive node
            if let Some(node_name) = cluster::get_node_from_consistent_hash(
                &item.id.to_string(),
                &Role::Querier,
                Some(RoleGroup::Interactive),
            )
            .await
            {
                if node_name.eq(&node.name) {
                    node_items.push(item.clone());
                    continue;
                }
            }
            // check if the item is for background node
            if let Some(node_name) = cluster::get_node_from_consistent_hash(
                &item.id.to_string(),
                &Role::Querier,
                Some(RoleGroup::Background),
            )
            .await
            {
                if node_name.eq(&node.name) {
                    node_items.push(item.clone());
                    continue;
                }
            }
        }
        if node_items.is_empty() {
            continue;
        }
        let node_uuid = node.uuid.clone();
        let node_addr = node.grpc_addr.clone();
        if cfg.common.print_key_event {
            node_items.iter().for_each(|item| {
                log::info!(
                    "[broadcast] send event to node[{}]: file: {}, deleted: {}",
                    &node_addr,
                    item.key,
                    item.deleted,
                );
            });
        }
        // retry 5 times
        let mut ok = false;
        for _i in 0..5 {
            let node = node.clone();
            let channel = events.entry(node_uuid.clone()).or_insert_with(|| {
                let (tx, mut rx) = mpsc::unbounded_channel();
                tokio::task::spawn(async move {
                    let node_addr = node.grpc_addr.clone();
                    if let Err(e) = send_to_node(node, &mut rx).await {
                        log::error!(
                            "[broadcast] send event to node[{}] channel failed, channel closed: {}",
                            &node_addr,
                            e
                        );
                    }
                });
                Arc::new(tx)
            });
            tokio::task::yield_now().await;
            if let Err(e) = channel.clone().send(node_items.clone()) {
                events.remove(&node_uuid);
                log::error!(
                    "[broadcast] send event to node[{}] channel failed, {}, retrying...",
                    &node_addr,
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
            ok = true;
            break;
        }
        if !ok {
            log::error!(
                "[broadcast] send event to node[{}] channel failed, dropping events",
                &node_addr
            );
        }
    }

    Ok(())
}

async fn send_to_node(
    node: Node,
    rx: &mut mpsc::UnboundedReceiver<Vec<FileKey>>,
) -> Result<(), anyhow::Error> {
    loop {
        // waiting for the node to be online
        loop {
            match cluster::get_node_by_uuid(&node.uuid).await {
                None => {
                    EVENTS.write().await.remove(&node.uuid);
                    log::error!(
                        "[broadcast] node[{}] leaved cluster, dropping events",
                        &node.grpc_addr,
                    );
                    return Ok(());
                }
                Some(v) => {
                    if v.status == NodeStatus::Online {
                        break;
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            tokio::task::yield_now().await;
        }
        let cfg = get_config();
        // connect to the node
        let token: MetadataValue<_> = get_internal_grpc_token()
            .parse()
            .expect("parse internal grpc token failed");
        let channel = match get_cached_channel(&node.grpc_addr).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[broadcast] connect to node[{}] failed: {}",
                    &node.grpc_addr,
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        let mut client = cluster_rpc::event_client::EventClient::with_interceptor(
            channel,
            move |mut req: Request<()>| {
                req.metadata_mut().insert("authorization", token.clone());
                Ok(req)
            },
        );

        client = client
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip)
            .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
            .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
        loop {
            let items = match rx.recv().await {
                Some(v) => v,
                None => {
                    log::info!("[broadcast] node[{}] channel closed", &node.grpc_addr);
                    EVENTS.write().await.remove(&node.uuid);
                    return Ok(());
                }
            };
            let mut req_query = proto::cluster_rpc::FileList {
                node_addr: LOCAL_NODE.grpc_addr.clone(),
                ..Default::default()
            };
            log::debug!("[broadcast] req_query created: {:?}", req_query);
            for item in items.iter() {
                req_query.items.push(cluster_rpc::FileKey::from(item));
            }
            let mut wait_ttl = 1;
            let mut retry_ttl = 0;
            loop {
                if retry_ttl >= 1800 {
                    log::error!(
                        "[broadcast] to node[{}] timeout, dropping event, already retried for 30 minutes",
                        &node.grpc_addr
                    );
                    break;
                }
                let mut request = tonic::Request::new(req_query.clone());
                request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));
                match client.send_file_list(request).await {
                    Ok(_) => break,
                    Err(e) => {
                        if cluster::get_node_by_uuid(&node.uuid).await.is_none() {
                            EVENTS.write().await.remove(&node.uuid);
                            log::error!(
                                "[broadcast] node[{}] leaved cluster, dropping events",
                                &node.grpc_addr,
                            );
                            return Ok(());
                        }
                        log::error!(
                            "[broadcast] send event to node[{}] failed: {}, retrying...",
                            &node.grpc_addr,
                            e
                        );
                        tokio::time::sleep(tokio::time::Duration::from_secs(wait_ttl)).await;
                        retry_ttl += wait_ttl;
                        if wait_ttl < 60 {
                            wait_ttl *= 2
                        };
                        continue;
                    }
                }
            }
        }
    }
}

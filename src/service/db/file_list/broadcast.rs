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

use std::sync::Arc;

use config::{
    cluster::{is_compactor, is_ingester, is_querier, LOCAL_NODE_UUID},
    meta::{
        cluster::{Node, NodeStatus},
        stream::FileKey,
    },
    CONFIG,
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use proto::cluster_rpc;
use tokio::sync::{mpsc, RwLock};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};

use crate::common::infra::cluster;

static EVENTS: Lazy<RwLock<HashMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

type EventChannel = Arc<mpsc::UnboundedSender<Vec<FileKey>>>;

/// send an event to broadcast, will create a new channel for each nodes
pub async fn send(items: &[FileKey], node_uuid: Option<String>) -> Result<(), anyhow::Error> {
    if CONFIG.common.local_mode || items.is_empty() {
        return Ok(());
    }
    let nodes = if let Some(node_uuid) = node_uuid {
        cluster::get_node_by_uuid(&node_uuid)
            .await
            .map(|node| vec![node])
            .unwrap_or_default()
    } else {
        cluster::get_cached_nodes(|node| {
            node.scheduled
                && (node.status == NodeStatus::Prepare || node.status == NodeStatus::Online)
                && (is_querier(&node.role) || is_compactor(&node.role) || is_ingester(&node.role))
        })
        .await
        .unwrap_or_default()
    };
    let local_node_uuid = LOCAL_NODE_UUID.clone();
    let mut events = EVENTS.write().await;
    for node in nodes {
        if node.uuid.eq(&local_node_uuid) {
            continue;
        }
        // if meta_store_external is true, only send to querier
        if CONFIG.common.meta_store_external && !is_querier(&node.role) {
            continue;
        }
        if !is_querier(&node.role) && !is_compactor(&node.role) && !is_ingester(&node.role) {
            continue;
        }
        let node_uuid = node.uuid.clone();
        let node_addr = node.grpc_addr.clone();
        if CONFIG.common.print_key_event {
            items.iter().for_each(|item| {
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
            if let Err(e) = channel.clone().send(items.to_vec()) {
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
        // connect to the node
        let token: MetadataValue<_> = cluster::get_internal_grpc_token()
            .parse()
            .expect("parse internal grpc token faile");
        let channel = match Channel::from_shared(node.grpc_addr.clone())
            .unwrap()
            .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
            .connect()
            .await
        {
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
            .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
            .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
        loop {
            let items = match rx.recv().await {
                Some(v) => v,
                None => {
                    log::info!("[broadcast] node[{}] channel closed", &node.grpc_addr);
                    EVENTS.write().await.remove(&node.uuid);
                    return Ok(());
                }
            };
            let mut req_query = cluster_rpc::FileList::default();
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
                let request = tonic::Request::new(req_query.clone());
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

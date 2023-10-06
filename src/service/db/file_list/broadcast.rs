// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};

use crate::common::{
    infra::{cluster, config::CONFIG},
    meta::common::FileKey,
};
use crate::handler::grpc::cluster_rpc;

static EVENTS: Lazy<RwLock<ahash::AHashMap<String, EventChannel>>> =
    Lazy::new(|| RwLock::new(ahash::AHashMap::new()));

type EventChannel = Arc<mpsc::UnboundedSender<Vec<FileKey>>>;

/// send an event to broadcast, will create a new channel for each nodes
pub async fn send(items: &[FileKey], node_uuid: Option<String>) -> Result<(), anyhow::Error> {
    if CONFIG.common.local_mode || items.is_empty() {
        return Ok(());
    }
    let nodes = if node_uuid.is_none() {
        cluster::get_cached_nodes(|node| {
            node.scheduled
                && (node.status == cluster::NodeStatus::Prepare
                    || node.status == cluster::NodeStatus::Online)
                && (cluster::is_querier(&node.role) || cluster::is_compactor(&node.role))
        })
        .unwrap()
    } else {
        cluster::get_node_by_uuid(&node_uuid.unwrap())
            .map(|node| vec![node])
            .unwrap_or_default()
    };
    let local_node_uuid = cluster::LOCAL_NODE_UUID.clone();
    let mut events = EVENTS.write().await;
    for node in nodes {
        if node.uuid.eq(&local_node_uuid) {
            continue;
        }
        if !cluster::is_querier(&node.role) && !cluster::is_compactor(&node.role) {
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
    node: cluster::Node,
    rx: &mut mpsc::UnboundedReceiver<Vec<FileKey>>,
) -> Result<(), anyhow::Error> {
    loop {
        // waiting for the node to be online
        loop {
            match cluster::get_node_by_uuid(&node.uuid) {
                None => {
                    EVENTS.write().await.remove(&node.uuid);
                    log::error!(
                        "[broadcast] node[{}] leaved cluster, dropping events",
                        &node.grpc_addr,
                    );
                    return Ok(());
                }
                Some(v) => {
                    if v.status == cluster::NodeStatus::Online {
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
            .accept_compressed(CompressionEncoding::Gzip);
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
                        if cluster::get_node_by_uuid(&node.uuid).is_none() {
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

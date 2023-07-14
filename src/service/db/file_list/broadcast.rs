// Copyright 2022 Zinc Labs Inc. and Contributors
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

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};

use crate::common::infra::cluster::{self, get_cached_nodes, get_internal_grpc_token};
use crate::common::infra::config::{RwHashMap, CONFIG};
use crate::common::meta::common::FileKey;
use crate::handler::grpc::cluster_rpc;

lazy_static! {
    pub static ref EVENTS: RwHashMap<String, Arc<mpsc::Sender<Vec<FileKey>>>> = DashMap::default();
}

/// send an event to broadcast, will create a new channel for each nodes
pub async fn send(items: &[FileKey]) -> Result<(), anyhow::Error> {
    if CONFIG.common.local_mode {
        return Ok(());
    }
    let nodes = get_cached_nodes(|node| {
        node.status == cluster::NodeStatus::Prepare || node.status == cluster::NodeStatus::Online
    })
    .unwrap();
    let local_node_uuid = cluster::LOCAL_NODE_UUID.clone();
    for node in nodes {
        if node.uuid.eq(&local_node_uuid) {
            continue;
        }
        if cluster::is_router(&node.role) {
            continue;
        }
        let node_id = node.uuid.clone();
        // retry 5 times
        let mut ok = false;
        for _i in 0..5 {
            let node = node.clone();
            let events = EVENTS.entry(node_id.clone()).or_insert_with(|| {
                let (tx, mut rx) = mpsc::channel(10000);
                tokio::task::spawn(async move {
                    let node_id = node.uuid.clone();
                    if let Err(e) = send_to_node(node, &mut rx).await {
                        log::error!("send event to node[{}] channel closed: {}", &node_id, e);
                    }
                });
                Arc::new(tx)
            });
            if let Err(e) = events.clone().send(items.to_vec()).await {
                EVENTS.remove(&node_id);
                log::error!("send event to node[{}] failed: {}, retrying...", node_id, e);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                tokio::task::yield_now().await;
                continue;
            }
            ok = true;
            break;
        }
        if !ok {
            log::error!("send event to node[{}] failed, dropping event", node_id);
        }
    }

    Ok(())
}

async fn send_to_node(
    node: cluster::Node,
    rx: &mut mpsc::Receiver<Vec<FileKey>>,
) -> Result<(), anyhow::Error> {
    loop {
        // waiting for the node to be online
        loop {
            match cluster::get_node_by_uuid(&node.uuid) {
                None => return Ok(()),
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
        let token: MetadataValue<_> = get_internal_grpc_token().parse()?;
        let channel = Channel::from_shared(node.grpc_addr)
            .unwrap()
            .connect()
            .await?;

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
            let items = rx.recv().await.unwrap();
            // log::info!("broadcast to node[{}] -> {:?}", &node.uuid, items);
            let mut req_query = cluster_rpc::FileList::default();
            for item in items.iter() {
                req_query.items.push(cluster_rpc::FileKey::from(item));
            }
            for _ in 0..3 {
                let request = tonic::Request::new(req_query.clone());
                match client.send_file_list(request).await {
                    Ok(_) => break,
                    Err(e) => {
                        if cluster::get_node_by_uuid(&node.uuid).is_none() {
                            return Ok(());
                        }
                        log::error!("broadcast to node[{}] error: {}", &node.uuid, e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                        continue;
                    }
                }
            }
        }
    }
}

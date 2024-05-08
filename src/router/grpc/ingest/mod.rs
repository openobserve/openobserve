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

use config::{utils::rand::get_rand_element, RwAHashMap, CONFIG};
use once_cell::sync::Lazy;
use tonic::{transport::Channel, Status};

use crate::common::infra::cluster;

pub mod logs;
pub mod metrics;
pub mod traces;

static CHANNELS: Lazy<RwAHashMap<String, Channel>> = Lazy::new(Default::default);

pub(crate) async fn get_ingester_channel() -> Result<Channel, tonic::Status> {
    let grpc_addr = get_rand_ingester_addr().await?;
    // cache hit
    let r = CHANNELS.read().await;
    if let Some(channel) = r.get(&grpc_addr) {
        return Ok(channel.clone());
    }
    drop(r);

    // cache miss, connect to ingester
    let channel = Channel::from_shared(grpc_addr.clone())
        .unwrap()
        .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
        .connect()
        .await
        .map_err(|err| {
            log::error!(
                "[ROUTER] grpc->ingest: node: {}, connect err: {:?}",
                &grpc_addr,
                err
            );
            Status::internal("connect querier error".to_string())
        })?;
    let mut w = CHANNELS.write().await;
    w.insert(grpc_addr, channel.clone());
    drop(w);

    Ok(channel)
}

async fn get_rand_ingester_addr() -> Result<String, tonic::Status> {
    let nodes = cluster::get_cached_online_ingester_nodes().await;
    if nodes.is_none() || nodes.as_ref().unwrap().is_empty() {
        if !CONFIG.route.ingester_srv_url.is_empty() {
            Ok(format!(
                "http://{}:{}",
                CONFIG.route.ingester_srv_url, CONFIG.grpc.port
            ))
        } else {
            Err(tonic::Status::internal(
                "No online ingester nodes".to_string(),
            ))
        }
    } else {
        let nodes = nodes.unwrap();
        let node = get_rand_element(&nodes);
        Ok(node.grpc_addr.to_string())
    }
}

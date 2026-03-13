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

use config::utils::rand::get_rand_element;
use infra::cluster::get_cached_schedulable_ingester_nodes;
use tonic::transport::Channel;

pub(crate) async fn get_ingester_channel() -> Result<(String, Channel), tonic::Status> {
    let grpc_addr = get_rand_ingester_addr().await?;
    infra::client::grpc::get_cached_channel(&grpc_addr)
        .await
        .map(|channel| (grpc_addr, channel))
}

async fn get_rand_ingester_addr() -> Result<String, tonic::Status> {
    let nodes = get_cached_schedulable_ingester_nodes().await;

    if let Some(nodes) = nodes
        && !nodes.is_empty()
    {
        let node = get_rand_element(&nodes);
        Ok(node.grpc_addr.to_string())
    } else {
        Err(tonic::Status::internal(
            "No online ingester nodes".to_string(),
        ))
    }
}

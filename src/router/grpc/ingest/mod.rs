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

use crate::common::{
    infra::{cluster, config::CONFIG},
    utils::rand::get_rand_element,
};

pub mod logs;
pub mod metrics;
pub mod traces;

pub(crate) fn get_rand_ingester_addr() -> Result<String, tonic::Status> {
    let nodes = cluster::get_cached_online_ingester_nodes();
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

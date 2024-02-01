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

use config::{utils::rand::get_rand_element, CONFIG};

use crate::common::infra::cluster;

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

// Copyright 2024 OpenObserve Inc.
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

use config::meta::cluster::{Node as ConfigNode, NodeInfo, NodeStatus, Role, RoleGroup};
use proto::cluster_rpc::{
    EmptyRequest, GetNodesResponse, NodeDetails, NodeStatus as ProtoNodeStatus, Role as ProtoRole,
    RoleGroup as ProtoRoleGroup,
};
use tonic::{Request, Response, Status};

use crate::common::infra::cluster;

pub struct NodeService;

// Convert from ConfigNode to proto Node
pub fn config_node_to_proto(node: ConfigNode) -> NodeDetails {
    let roles = node
        .role
        .iter()
        .map(|r| match r {
            Role::All => ProtoRole::All as i32,
            Role::Ingester => ProtoRole::Ingester as i32,
            Role::Querier => ProtoRole::Querier as i32,
            Role::Compactor => ProtoRole::Compactor as i32,
            Role::Router => ProtoRole::Router as i32,
            Role::AlertManager => ProtoRole::AlertManager as i32,
            Role::FlattenCompactor => ProtoRole::FlattenCompactor as i32,
        })
        .collect();

    let role_group = match node.role_group {
        RoleGroup::None => ProtoRoleGroup::None as i32,
        RoleGroup::Interactive => ProtoRoleGroup::Interactive as i32,
        RoleGroup::Background => ProtoRoleGroup::Background as i32,
    };

    let status = match node.status {
        NodeStatus::Prepare => ProtoNodeStatus::Prepare as i32,
        NodeStatus::Online => ProtoNodeStatus::Online as i32,
        NodeStatus::Offline => ProtoNodeStatus::Offline as i32,
    };

    NodeDetails {
        id: node.id,
        uuid: node.uuid,
        name: node.name,
        http_addr: node.http_addr,
        grpc_addr: node.grpc_addr,
        roles,
        role_group,
        cpu_num: node.cpu_num,
        status,
        scheduled: node.scheduled,
        broadcasted: node.broadcasted,
        version: node.version,
    }
}

// Convert from proto Node to ConfigNode
pub fn proto_node_to_config(node: NodeDetails) -> ConfigNode {
    let role = node
        .roles
        .iter()
        .filter_map(|&r| match r {
            r if r == ProtoRole::All as i32 => Some(Role::All),
            r if r == ProtoRole::Ingester as i32 => Some(Role::Ingester),
            r if r == ProtoRole::Querier as i32 => Some(Role::Querier),
            r if r == ProtoRole::Compactor as i32 => Some(Role::Compactor),
            r if r == ProtoRole::Router as i32 => Some(Role::Router),
            r if r == ProtoRole::AlertManager as i32 => Some(Role::AlertManager),
            r if r == ProtoRole::FlattenCompactor as i32 => Some(Role::FlattenCompactor),
            _ => None,
        })
        .collect();

    let role_group = match node.role_group {
        r if r == ProtoRoleGroup::None as i32 => RoleGroup::None,
        r if r == ProtoRoleGroup::Interactive as i32 => RoleGroup::Interactive,
        r if r == ProtoRoleGroup::Background as i32 => RoleGroup::Background,
        _ => RoleGroup::None,
    };

    let status = match node.status {
        s if s == ProtoNodeStatus::Prepare as i32 => NodeStatus::Prepare,
        s if s == ProtoNodeStatus::Online as i32 => NodeStatus::Online,
        s if s == ProtoNodeStatus::Offline as i32 => NodeStatus::Offline,
        _ => NodeStatus::Prepare,
    };

    ConfigNode {
        id: node.id,
        uuid: node.uuid,
        name: node.name,
        http_addr: node.http_addr,
        grpc_addr: node.grpc_addr,
        role,
        role_group,
        cpu_num: node.cpu_num,
        status,
        scheduled: node.scheduled,
        broadcasted: node.broadcasted,
        version: node.version,
    }
}

#[tonic::async_trait]
impl proto::cluster_rpc::node_service_server::NodeService for NodeService {
    async fn get_nodes(
        &self,
        _request: Request<EmptyRequest>,
    ) -> Result<Response<GetNodesResponse>, Status> {
        // Get all nodes from cache
        let nodes = cluster::get_cached_nodes(|_| true)
            .await
            .unwrap_or_default();

        // Convert config nodes to proto nodes
        let proto_nodes = nodes.into_iter().map(config_node_to_proto).collect();

        // Create the response
        let response = GetNodesResponse { nodes: proto_nodes };

        Ok(Response::new(response))
    }
}

pub async fn get_node_list(node: Arc<dyn NodeInfo>) -> Result<Vec<ConfigNode>, anyhow::Error> {
    let mut nodes = Vec::new();

    // Create a task to fetch nodes from this cluster node
    let task: tokio::task::JoinHandle<Result<Vec<NodeDetails>, infra::errors::Error>> =
        tokio::task::spawn(async move {
            let mut client =
                super::grpc::make_grpc_node_client(&mut Request::new(EmptyRequest {}), &node)
                    .await?;
            let nodes = match client.get_nodes(Request::new(EmptyRequest {})).await {
                Ok(remote_nodes) => remote_nodes.into_inner().nodes,
                Err(err) => {
                    log::error!(
                        "Failed to get nodes from cluster node {}: {:?}",
                        node.get_grpc_addr(),
                        err
                    );
                    Vec::new()
                }
            };
            Ok(nodes)
        });

    // Wait for the task and handle the result
    match task.await {
        Ok(res) => {
            match res {
                Ok(remote_nodes) => {
                    // Add nodes that don't already exist in our list
                    for remote_node in remote_nodes {
                        if !nodes
                            .iter()
                            .any(|n: &ConfigNode| n.uuid == remote_node.uuid)
                        {
                            nodes.push(proto_node_to_config(remote_node));
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error getting nodes from cluster node: {:?}", e);
                    return Err(anyhow::anyhow!(
                        "Error getting nodes from cluster node: {:?}",
                        e
                    ));
                }
            }
        }
        Err(e) => {
            log::error!("Error awaiting task: {:?}", e);
            return Err(anyhow::anyhow!("Error awaiting task: {:?}", e));
        }
    }

    Ok(nodes)
}

pub fn node_service() -> proto::cluster_rpc::node_service_server::NodeServiceServer<NodeService> {
    proto::cluster_rpc::node_service_server::NodeServiceServer::new(NodeService)
}

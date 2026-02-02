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

use config::meta::cluster::{Node as ConfigNode, NodeInfo, NodeStatus, Role, RoleGroup};
use infra::cluster::get_cached_nodes;
use proto::cluster_rpc::{
    EmptyRequest, GetNodesResponse, NodeDetails, NodeMetrics as ProtoNodeMetrics,
    NodeStatus as ProtoNodeStatus, Role as ProtoRole, RoleGroup as ProtoRoleGroup,
};
use tonic::{Request, Response, Status};

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
            Role::ScriptServer => ProtoRole::ScriptServer as i32,
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

    // Convert the metrics
    let metrics = ProtoNodeMetrics {
        cpu_total: node.metrics.cpu_total as u64,
        cpu_usage: node.metrics.cpu_usage,
        memory_total: node.metrics.memory_total as u64,
        memory_usage: node.metrics.memory_usage as u64,
        tcp_conns: node.metrics.tcp_conns as u64,
        tcp_conns_established: node.metrics.tcp_conns_established as u64,
        tcp_conns_close_wait: node.metrics.tcp_conns_close_wait as u64,
        tcp_conns_time_wait: node.metrics.tcp_conns_time_wait as u64,
        tcp_conns_resets: node.metrics.tcp_conns_resets as u64,
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
        metrics: Some(metrics),
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
            r if r == ProtoRole::ScriptServer as i32 => Some(Role::ScriptServer),
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

    // Convert the metrics or use default if not provided
    let metrics = node
        .metrics
        .map_or_else(config::utils::sysinfo::NodeMetrics::default, |m| {
            config::utils::sysinfo::NodeMetrics {
                cpu_total: m.cpu_total as usize,
                cpu_usage: m.cpu_usage,
                memory_total: m.memory_total as usize,
                memory_usage: m.memory_usage as usize,
                tcp_conns: m.tcp_conns as usize,
                tcp_conns_established: m.tcp_conns_established as usize,
                tcp_conns_close_wait: m.tcp_conns_close_wait as usize,
                tcp_conns_time_wait: m.tcp_conns_time_wait as usize,
                tcp_conns_resets: m.tcp_conns_resets as usize,
            }
        });

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
        metrics,
    }
}

#[tonic::async_trait]
impl proto::cluster_rpc::node_service_server::NodeService for NodeService {
    async fn get_nodes(
        &self,
        _request: Request<EmptyRequest>,
    ) -> Result<Response<GetNodesResponse>, Status> {
        // Get all nodes from cache
        let nodes = get_cached_nodes(|_| true).await.unwrap_or_default();

        // Convert config nodes to proto nodes
        let proto_nodes = nodes.into_iter().map(config_node_to_proto).collect();

        // Create the response
        let response = GetNodesResponse { nodes: proto_nodes };

        Ok(Response::new(response))
    }
}

pub async fn get_node_list(
    trace_id: &str,
    node: Arc<dyn NodeInfo>,
) -> Result<Vec<ConfigNode>, anyhow::Error> {
    let mut nodes = Vec::new();

    // Create a task to fetch nodes from this cluster node
    let trace_id = trace_id.to_string();
    let task: tokio::task::JoinHandle<Result<Vec<NodeDetails>, infra::errors::Error>> =
        tokio::task::spawn(async move {
            let empty_request = EmptyRequest {};
            let mut request = Request::new(empty_request);
            let mut client =
                infra::client::grpc::make_grpc_node_client(&trace_id, &mut request, &node).await?;
            let nodes = match client.get_nodes(Request::new(empty_request)).await {
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
                    log::error!("Error getting nodes from cluster node: {e}");
                    return Err(anyhow::anyhow!(
                        "Error getting nodes from cluster node: {:?}",
                        e
                    ));
                }
            }
        }
        Err(e) => {
            log::error!("Error awaiting task: {e}");
            return Err(anyhow::anyhow!("Error awaiting task: {e}"));
        }
    }

    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use config::utils::sysinfo::NodeMetrics;

    use super::*;

    #[test]
    fn test_config_node_to_proto() {
        let config_node = ConfigNode {
            id: 1,
            uuid: "test_uuid".to_string(),
            name: "Test Node".to_string(),
            http_addr: "127.0.0.1:8080".to_string(),
            grpc_addr: "127.0.0.1:9090".to_string(),
            role: vec![Role::Ingester, Role::Querier],
            role_group: RoleGroup::Interactive,
            cpu_num: 4,
            status: NodeStatus::Online,
            scheduled: true,
            broadcasted: true,
            version: "1.0.0".to_string(),
            metrics: NodeMetrics::default(),
        };

        let proto_node = config_node_to_proto(config_node);
        assert_eq!(proto_node.id, 1);
        assert_eq!(proto_node.uuid, "test_uuid");
        assert_eq!(proto_node.name, "Test Node");
        assert_eq!(proto_node.roles.len(), 2);
        assert_eq!(proto_node.role_group, ProtoRoleGroup::Interactive as i32);
        assert_eq!(proto_node.status, ProtoNodeStatus::Online as i32);
    }

    #[test]
    fn test_proto_node_to_config() {
        let proto_node = NodeDetails {
            id: 1,
            uuid: "test_proto_uuid".to_string(),
            name: "Test Proto Node".to_string(),
            http_addr: "127.0.0.1:8081".to_string(),
            grpc_addr: "127.0.0.1:9091".to_string(),
            roles: vec![ProtoRole::Compactor as i32, ProtoRole::Router as i32],
            role_group: ProtoRoleGroup::Background as i32,
            cpu_num: 8,
            status: ProtoNodeStatus::Offline as i32,
            scheduled: false,
            broadcasted: false,
            version: "2.0.0".to_string(),
            metrics: Some(ProtoNodeMetrics::default()),
        };

        let config_node = proto_node_to_config(proto_node);
        assert_eq!(config_node.id, 1);
        assert_eq!(config_node.uuid, "test_proto_uuid");
        assert_eq!(config_node.name, "Test Proto Node");
        assert_eq!(config_node.role.len(), 2);
        assert_eq!(config_node.role_group, RoleGroup::Background);
        assert_eq!(config_node.status, NodeStatus::Offline);
    }
}

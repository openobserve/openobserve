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

use std::{fmt::Debug, str::FromStr, sync::Arc};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    get_config, get_instance_id, meta::search::SearchEventType, utils::sysinfo::NodeMetrics,
};
pub trait NodeInfo: Debug + Send + Sync {
    fn is_querier(&self) -> bool {
        true
    }
    fn is_ingester(&self) -> bool {
        false
    }
    fn get_grpc_addr(&self) -> String;
    fn get_auth_token(&self) -> String;
    fn get_name(&self) -> String;
    fn get_region(&self) -> String {
        "openobserve".to_string()
    }
    fn get_cluster(&self) -> String {
        crate::config::get_cluster_name()
    }
    fn is_local(&self) -> bool;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Node {
    pub id: i32,
    pub uuid: String,
    pub name: String,
    pub http_addr: String,
    pub grpc_addr: String,
    pub role: Vec<Role>,
    #[serde(default)]
    pub role_group: RoleGroup,
    pub cpu_num: u64,
    #[serde(default)]
    pub scheduled: bool,
    #[serde(default)]
    pub broadcasted: bool,
    pub status: NodeStatus,
    #[serde(default)]
    pub metrics: NodeMetrics,
    #[serde(default)]
    pub version: String,
}

impl Node {
    fn new() -> Self {
        Node {
            id: 0,
            uuid: "".to_string(),
            name: "".to_string(),
            http_addr: "".to_string(),
            grpc_addr: "".to_string(),
            role: vec![],
            role_group: RoleGroup::None,
            cpu_num: 0,
            scheduled: false,
            broadcasted: false,
            status: NodeStatus::Prepare,
            metrics: Default::default(),
            version: crate::VERSION.to_string(),
        }
    }

    pub fn is_same(&self, other: &Node) -> bool {
        self.id == other.id
            && self.uuid == other.uuid
            && self.name == other.name
            && self.http_addr == other.http_addr
            && self.grpc_addr == other.grpc_addr
            && self.role == other.role
            && self.role_group == other.role_group
            && self.scheduled == other.scheduled
            && self.broadcasted == other.broadcasted
            && self.status == other.status
    }

    pub fn is_single_node(&self) -> bool {
        self.role.len() == 1 && self.role.contains(&Role::All)
    }
    pub fn is_single_role(&self) -> bool {
        self.role.len() == 1
    }
    pub fn is_router(&self) -> bool {
        self.role.contains(&Role::Router)
    }
    pub fn is_ingester(&self) -> bool {
        self.role.contains(&Role::Ingester) || self.role.contains(&Role::All)
    }
    pub fn is_querier(&self) -> bool {
        self.role.contains(&Role::Querier) || self.role.contains(&Role::All)
    }
    pub fn is_interactive_querier(&self) -> bool {
        self.is_querier()
            && (self.role_group == RoleGroup::None || self.role_group == RoleGroup::Interactive)
    }
    pub fn is_background_querier(&self) -> bool {
        self.is_querier()
            && (self.role_group == RoleGroup::None || self.role_group == RoleGroup::Background)
    }
    pub fn is_compactor(&self) -> bool {
        self.role.contains(&Role::Compactor) || self.role.contains(&Role::All)
    }
    pub fn is_flatten_compactor(&self) -> bool {
        self.role.contains(&Role::FlattenCompactor)
    }
    pub fn is_alert_manager(&self) -> bool {
        self.role.contains(&Role::AlertManager) || self.role.contains(&Role::All)
    }
    pub fn is_script_server(&self) -> bool {
        self.role.contains(&Role::ScriptServer) || self.role.contains(&Role::All)
    }
    pub fn is_standalone(&self) -> bool {
        // standalone implies there is no external dependency required
        // for this node. All role will always have DB dep.
        // currently only script server has no external dep
        !self.role.contains(&Role::All) && self.role.contains(&Role::ScriptServer)
    }
}

impl Default for Node {
    fn default() -> Self {
        Node::new()
    }
}

impl NodeInfo for Node {
    fn get_name(&self) -> String {
        self.name.clone()
    }

    fn is_querier(&self) -> bool {
        self.is_querier()
    }

    fn is_ingester(&self) -> bool {
        self.is_ingester()
    }

    fn get_auth_token(&self) -> String {
        get_internal_grpc_token()
    }

    fn get_grpc_addr(&self) -> String {
        self.grpc_addr.clone()
    }

    fn is_local(&self) -> bool {
        self.grpc_addr == crate::cluster::get_local_grpc_addr()
    }
}

pub trait IntoArcVec {
    fn into_arc_vec(self) -> Vec<Arc<dyn NodeInfo>>;
}

impl IntoArcVec for Vec<Node> {
    fn into_arc_vec(self) -> Vec<Arc<dyn NodeInfo>> {
        self.into_iter().map(|n| Arc::new(n) as _).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum NodeStatus {
    Prepare = 1,
    Online = 2,
    Offline = 3,
}

impl From<i32> for NodeStatus {
    fn from(value: i32) -> Self {
        match value {
            1 => NodeStatus::Prepare,
            2 => NodeStatus::Online,
            3 => NodeStatus::Offline,
            _ => NodeStatus::Prepare,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum Role {
    All,
    Ingester,
    Querier,
    Compactor,
    Router,
    AlertManager,
    FlattenCompactor,
    ScriptServer,
}

impl FromStr for Role {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        let s = s.to_lowercase();
        match s.as_str() {
            "all" => Ok(Role::All),
            "ingester" => Ok(Role::Ingester),
            "querier" => Ok(Role::Querier),
            "compactor" => Ok(Role::Compactor),
            "router" => Ok(Role::Router),
            "alertmanager" | "alert_manager" => Ok(Role::AlertManager),
            "flatten_compactor" => Ok(Role::FlattenCompactor),
            "script_server" | "scriptserver" => Ok(Role::ScriptServer),
            _ => Err(format!("Invalid cluster role: {s}")),
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::All => write!(f, "all"),
            Role::Ingester => write!(f, "ingester"),
            Role::Querier => write!(f, "querier"),
            Role::Compactor => write!(f, "compactor"),
            Role::Router => write!(f, "router"),
            Role::AlertManager => write!(f, "alert_manager"),
            Role::FlattenCompactor => write!(f, "flatten_compactor"),
            Role::ScriptServer => write!(f, "script_server"),
        }
    }
}

/// Categorizes nodes into different groups.
/// None        -> All tasks
/// Background  -> Low-priority tasks
/// Interactive -> High-priority tasks
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Default, ToSchema)]
pub enum RoleGroup {
    #[default]
    None,
    Interactive,
    Background,
}

impl From<&str> for RoleGroup {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "background" => RoleGroup::Background,
            "interactive" => RoleGroup::Interactive,
            _ => RoleGroup::None,
        }
    }
}

impl From<SearchEventType> for RoleGroup {
    fn from(value: SearchEventType) -> Self {
        match value {
            SearchEventType::Reports
            | SearchEventType::Alerts
            | SearchEventType::DerivedStream
            | SearchEventType::SearchJob => RoleGroup::Background,
            _ => RoleGroup::Interactive,
        }
    }
}

impl std::fmt::Display for RoleGroup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoleGroup::None => write!(f, ""),
            RoleGroup::Interactive => write!(f, "interactive"),
            RoleGroup::Background => write!(f, "background"),
        }
    }
}

#[inline]
pub fn get_internal_grpc_token() -> String {
    let cfg = get_config();
    let token = if cfg.grpc.internal_grpc_token.is_empty() {
        get_instance_id()
    } else {
        cfg.grpc.internal_grpc_token.clone()
    };

    if token.is_empty() {
        panic!("grpc token is empty");
    }
    token
}

// CompactionJobType is used to distinguish between current and historical compaction jobs.
pub enum CompactionJobType {
    Current,
    Historical,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_is_local() {
        let local_node = &*crate::cluster::LOCAL_NODE;
        assert!(local_node.is_local());
    }

    #[test]
    fn test_node_is_ingester() {
        let mut node = Node::default();

        // Test with All role
        node.role = vec![Role::All];
        assert!(node.is_ingester());

        // Test with Ingester role
        node.role = vec![Role::Ingester];
        assert!(node.is_ingester());

        // Test with Querier role (should be false)
        node.role = vec![Role::Querier];
        assert!(!node.is_ingester());
    }

    #[test]
    fn test_node_is_querier() {
        let mut node = Node::default();

        // Test with All role
        node.role = vec![Role::All];
        assert!(node.is_querier());

        // Test with Querier role
        node.role = vec![Role::Querier];
        assert!(node.is_querier());

        // Test with Ingester role (should be false)
        node.role = vec![Role::Ingester];
        assert!(!node.is_querier());
    }

    #[test]
    fn test_node_role_checks() {
        let mut node = Node::default();

        // Test router
        node.role = vec![Role::Router];
        assert!(node.is_router());
        assert!(!node.is_compactor());

        // Test compactor
        node.role = vec![Role::Compactor];
        assert!(node.is_compactor());
        assert!(!node.is_router());

        // Test alert manager
        node.role = vec![Role::AlertManager];
        assert!(node.is_alert_manager());

        // Test script server
        node.role = vec![Role::ScriptServer];
        assert!(node.is_script_server());

        // Test flatten compactor
        node.role = vec![Role::FlattenCompactor];
        assert!(node.is_flatten_compactor());
    }
}

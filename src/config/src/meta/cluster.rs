// Copyright 2024 Zinc Labs Inc.
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

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::{config, meta::search::SearchEventType};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: i32,
    pub uuid: String,
    pub name: String,
    pub http_addr: String,
    pub grpc_addr: String,
    pub role: Vec<Role>,
    pub cpu_num: u64,
    pub status: NodeStatus,
    #[serde(default)]
    pub scheduled: bool,
    #[serde(default)]
    pub broadcasted: bool,
    #[serde(default)]
    pub role_group: RoleGroup,
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
            cpu_num: 0,
            status: NodeStatus::Prepare,
            scheduled: false,
            broadcasted: false,
            role_group: load_role_group(),
        }
    }
}

impl Default for Node {
    fn default() -> Self {
        Node::new()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum NodeStatus {
    Prepare,
    Online,
    Offline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Role {
    All,
    Ingester,
    Querier,
    Compactor,
    Router,
    AlertManager,
    FlattenCompactor,
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
        }
    }
}

/// Categorizes nodes into different groups.
/// None        -> All tasks
/// Background  -> Low-priority tasks
/// Interactive -> High-priority tasks
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Default)]
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
            SearchEventType::Reports | SearchEventType::Alerts => RoleGroup::Background,
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

pub fn load_role_group() -> RoleGroup {
    RoleGroup::from(config::get_config().common.node_role_group.as_str())
}

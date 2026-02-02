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

use std::sync::atomic::{AtomicI32, Ordering};

use once_cell::sync::Lazy;

use crate::{
    get_config, ider,
    meta::cluster::{Node, NodeStatus, Role, RoleGroup},
};

pub static LOCAL_NODE_ID: AtomicI32 = AtomicI32::new(0);
pub static mut LOCAL_NODE_KEY_LEASE_ID: i64 = 0;
pub static LOCAL_NODE_STATUS: AtomicI32 = AtomicI32::new(NodeStatus::Prepare as _);
pub static LOCAL_NODE: Lazy<Node> = Lazy::new(load_local_node);

fn load_local_node() -> Node {
    let cfg = get_config();
    Node {
        id: 1,
        uuid: load_local_node_uuid(),
        role: load_local_node_role(),
        role_group: load_role_group(),
        name: cfg.common.instance_name.clone(),
        http_addr: get_local_http_addr(),
        grpc_addr: get_local_grpc_addr(),
        cpu_num: cfg.limit.cpu_num as u64,
        scheduled: false,
        broadcasted: false,
        status: NodeStatus::Online,
        metrics: Default::default(),
        version: crate::VERSION.to_string(),
    }
}

fn load_local_node_uuid() -> String {
    ider::uuid()
}

fn load_local_node_role() -> Vec<Role> {
    get_config()
        .common
        .node_role
        .clone()
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect()
}

pub fn load_role_group() -> RoleGroup {
    RoleGroup::from(get_config().common.node_role_group.as_str())
}

pub fn get_local_http_addr() -> String {
    format!(
        "{}://{}:{}",
        get_http_schema(),
        get_local_http_ip(),
        get_config().http.port
    )
}

pub fn get_local_grpc_addr() -> String {
    format!(
        "{}://{}:{}",
        get_grpc_schema(),
        get_local_grpc_ip(),
        get_config().grpc.port
    )
}

pub fn get_local_http_ip() -> String {
    let cfg = get_config();
    if !cfg.http.addr.is_empty() {
        cfg.http.addr.clone()
    } else {
        get_local_node_ip()
    }
}

pub fn get_local_grpc_ip() -> String {
    let cfg = get_config();
    if !cfg.grpc.addr.is_empty() {
        cfg.grpc.addr.clone()
    } else {
        get_local_node_ip()
    }
}

pub fn get_local_node_ip() -> String {
    // returns ipv4
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|e| {
            log::warn!(
                "Failed to get local IP address: {}, falling back to 127.0.0.1",
                e
            );
            "127.0.0.1".to_string()
        })
}

pub fn get_grpc_schema() -> String {
    let cfg = get_config();
    if cfg.grpc.tls_enabled {
        "https".to_string()
    } else {
        "http".to_string()
    }
}

pub fn get_http_schema() -> String {
    let cfg = get_config();
    if cfg.http.tls_enabled {
        "https".to_string()
    } else {
        "http".to_string()
    }
}

#[inline(always)]
pub fn is_online() -> bool {
    NodeStatus::from(LOCAL_NODE_STATUS.load(Ordering::Relaxed)) == NodeStatus::Online
}

#[inline(always)]
pub fn is_offline() -> bool {
    NodeStatus::from(LOCAL_NODE_STATUS.load(Ordering::Relaxed)) == NodeStatus::Offline
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::cluster::Role;

    #[test]
    fn test_convert_role() {
        let parse = |s: &str| s.parse::<Role>().unwrap();

        assert_eq!(parse("all"), Role::All);
        assert_eq!(parse("ingester"), Role::Ingester);
        assert_eq!(parse("querier"), Role::Querier);
        assert_eq!(parse("compactor"), Role::Compactor);
        assert_eq!(parse("router"), Role::Router);
        assert_eq!(parse("alertmanager"), Role::AlertManager);
        assert_eq!(parse("alertManager"), Role::AlertManager);
        assert_eq!(parse("AlertManager"), Role::AlertManager);
        assert!("alert_manager".parse::<Role>().is_ok());
    }

    #[test]
    fn test_load_local_node_uuid() {
        assert!(!load_local_node_uuid().is_empty());
    }

    #[test]
    fn test_get_node_ip() {
        assert!(!get_local_node_ip().is_empty());
    }
}

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

use config::{
    meta::cluster::{Node, NodeStatus},
    utils::sysinfo::NodeMetrics,
};

const MAX_EXPECTED_CONNECTIONS: f64 = 2000.0; // Maximum connection factor
const CONNECTION_WEIGHT: f64 = 0.5; // Connections is the most important factor
const CPU_WEIGHT: f64 = 0.3; // CPU is second most important
const MEMORY_WEIGHT: f64 = 0.2; // Memory is third

fn calculate_load_score(stats: &NodeMetrics) -> f64 {
    // Connection load factor - normalize based on reasonable maximum
    let connection_factor = (stats.tcp_conns as f64) / MAX_EXPECTED_CONNECTIONS;
    let connection_factor = connection_factor.min(1.0); // Cap at 1.0

    // Normalize values to 0.0-1.0 range
    let cpu_usage_normalized = stats.cpu_usage as f64 / 100.0;
    let memory_usage_normalized = stats.memory_usage as f64 / stats.memory_total as f64;

    // Assign weights to each factor
    (connection_factor * CONNECTION_WEIGHT)
        + (cpu_usage_normalized * CPU_WEIGHT)
        + (memory_usage_normalized * MEMORY_WEIGHT)
}

pub fn select_best_node(nodes: &[Node]) -> Option<&Node> {
    let trace_id = config::ider::uuid();
    for node in nodes.iter() {
        log::debug!(
            "[ROUTER trace_id: {}] node: {}, score: {:.5}, cpu_usage: {:.2}, mem_usage: {:.2}, conns: {}",
            trace_id,
            node.name,
            calculate_load_score(&node.metrics),
            node.metrics.cpu_usage,
            node.metrics.memory_usage,
            node.metrics.tcp_conns
        );
    }

    let ret = nodes
        .iter()
        .filter(|node| node.status == NodeStatus::Online)
        .min_by(|a, b| {
            let score_a = calculate_load_score(&a.metrics);
            let score_b = calculate_load_score(&b.metrics);
            score_a
                .partial_cmp(&score_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

    log::debug!(
        "[ROUTER trace_id: {}] selected node: {}",
        trace_id,
        ret.map(|node| node.name.clone()).unwrap_or_default()
    );
    ret
}

#[cfg(test)]
mod tests {

    use config::meta::cluster::{Role, RoleGroup};

    use super::*;

    fn create_test_node(
        id: i32,
        cpu_usage: f64,
        memory_usage_pct: f64,
        connections: usize,
    ) -> Node {
        let memory_total = 16 * 1024 * 1024 * 1024; // 16GB
        Node {
            id,
            uuid: id.to_string(),
            name: id.to_string(),
            http_addr: format!("http://node-{id}.example.com"),
            grpc_addr: format!("grpc://node-{id}.example.com"),
            role: vec![Role::Ingester],
            role_group: RoleGroup::None,
            scheduled: false,
            broadcasted: false,
            status: NodeStatus::Online,
            cpu_num: 0,
            metrics: NodeMetrics {
                cpu_total: 8,
                cpu_usage: cpu_usage as f32,
                memory_total,
                memory_usage: (memory_total as f64 * memory_usage_pct / 100.0) as usize,
                tcp_conns: connections + 10, // add some non-established connections
                tcp_conns_established: connections,
                tcp_conns_close_wait: 3,
                tcp_conns_time_wait: 5,
                tcp_conns_resets: 1,
            },
            version: config::VERSION.to_string(),
        }
    }

    #[test]
    fn test_select_best_node_basic_load_balancing() {
        // Arrange
        let nodes = vec![
            create_test_node(1, 80.0, 70.0, 1000),
            create_test_node(2, 30.0, 50.0, 500),
            create_test_node(3, 60.0, 60.0, 800),
        ];

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 2); // Node 2 has lowest load
    }

    #[test]
    fn test_select_best_node_prefers_more_powerful_nodes() {
        // Arrange
        let mut nodes = vec![
            create_test_node(1, 50.0, 50.0, 500),
            create_test_node(2, 50.0, 50.0, 500),
        ];

        // Make node 2 more powerful (16 cores vs 8)
        nodes[1].metrics.cpu_total = 16;

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 1); // we don't care about the cpu_num, we care about the cpu_usage
    }

    #[test]
    fn test_select_best_node_prefers_more_cpu_usage_nodes() {
        // Arrange
        let mut nodes = vec![
            create_test_node(1, 50.0, 50.0, 500),
            create_test_node(2, 50.0, 50.0, 500),
        ];

        // Make node 2 more busy
        nodes[1].metrics.cpu_usage = 100.0;

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 1); // we don't care about the cpu_num, we care about the cpu_usage
    }

    #[test]
    fn test_select_best_node_prioritizes_connections() {
        // Arrange
        let nodes = vec![
            create_test_node(1, 50.0, 30.0, 300), // High CPU, low memory & connections
            create_test_node(2, 40.0, 30.0, 800), // Low CPU, low memory, high connections
            create_test_node(3, 30.0, 30.0, 800), // Low CPU, low memory, high connections
        ];

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 1); // Low connections are prioritized over high cpu
    }

    #[test]
    fn test_select_best_node_prioritizes_cpu() {
        // Arrange
        let nodes = vec![
            create_test_node(1, 80.0, 30.0, 300), // High CPU, low memory & connections
            create_test_node(2, 30.0, 80.0, 300), // Low CPU, high memory, same connections
            create_test_node(3, 30.0, 30.0, 800), // Low CPU, low memory, high connections
        ];

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 2); // Low CPU is prioritized over memory
    }

    #[test]
    fn test_select_best_node_empty_list() {
        // Arrange
        let nodes: Vec<Node> = vec![];

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_none());
    }

    #[test]
    fn test_select_best_node_all_unhealthy() {
        // Arrange
        let mut nodes = vec![
            create_test_node(1, 40.0, 50.0, 400),
            create_test_node(2, 30.0, 40.0, 300),
        ];

        nodes[0].status = NodeStatus::Offline;
        nodes[1].status = NodeStatus::Offline;

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_none()); // No healthy nodes available
    }

    #[test]
    fn test_select_best_node_one_partially_unhealthy() {
        // Arrange
        let mut nodes = vec![
            create_test_node(1, 40.0, 50.0, 400),
            create_test_node(2, 30.0, 40.0, 300),
        ];

        nodes[1].status = NodeStatus::Offline;

        // Act
        let selected = select_best_node(&nodes);

        // Assert
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().id, 1); // Only node still considered available
    }
}

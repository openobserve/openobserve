// Copyright 2026 OpenObserve Inc.
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

//! Which alert-manager node does a whole-deployment sweep this pass.
//!
//! Shared because the bug it fixes was shared. Both maintenance jobs gate on
//! `LOCAL_NODE.is_alert_manager()` and then elected their leader from
//! `get_cached_online_query_nodes`, which is a different set of machines: where
//! `alert_manager` is a role of its own the node running the job is not a
//! querier, so it is never in the list it is comparing itself against, and
//! `is_leader` is **permanently false**. Every sweep silently never ran.
//!
//! It is invisible on a single node with every role — which is a querier, and
//! usually the only one — and that is exactly where it was tested.
//!
//! The election is the same one the rest of the codebase uses: lowest uuid
//! wins. What changed is only the set it is drawn from, and that it is drawn
//! from the same set that decided the job would spawn at all.

use config::{cluster::LOCAL_NODE, meta::cluster::Node};

/// Whether `uuid` leads this set of nodes.
///
/// Pure, and the reason it is pure is that the failure it had was not
/// observable in a test that could not hand it a role-separated cluster.
///
/// An empty set is deliberately led by everyone. With no cluster view at all
/// the safe assumption is a single node, and the sweeps are all idempotent or
/// re-entrant enough that a duplicated pass is cheaper than a skipped one: an
/// abandoned page that nobody re-arms is worse than a re-arm the scheduler's
/// claim lock collapses back to one anyway.
pub fn leads(nodes: &[Node], uuid: &str) -> bool {
    match nodes.iter().min_by(|a, b| a.uuid.cmp(&b.uuid)) {
        Some(first) => first.uuid == uuid,
        None => true,
    }
}

/// Whether this node does the whole-deployment work this pass.
///
/// Elected from the alert-manager set, which is the set the caller has already
/// established it belongs to.
pub async fn is_alert_manager_leader() -> bool {
    let nodes = infra::cluster::get_cached_online_alert_manager_nodes()
        .await
        .unwrap_or_default();
    leads(&nodes, &LOCAL_NODE.uuid)
}

#[cfg(test)]
mod tests {
    use config::meta::cluster::{Node, NodeStatus, Role};

    use super::*;

    fn node(uuid: &str, role: Vec<Role>) -> Node {
        Node {
            uuid: uuid.to_string(),
            name: uuid.to_string(),
            role,
            status: NodeStatus::Online,
            ..Default::default()
        }
    }

    /// The deployment that broke it: three queriers, two ingesters and one
    /// alert manager, none of them the same machine.
    ///
    /// The alert manager is the only node that runs the sweep, so it must lead
    /// its own set — and the assertion underneath is the bug itself, kept as an
    /// assertion because it reads as harmless and is not: elected from the
    /// query nodes, the node that does the work can never win, and coverage
    /// warnings, abandoned-ladder re-arms and timeline retention all stop.
    #[test]
    fn test_the_alert_manager_leads_the_set_it_is_actually_in() {
        let queriers = vec![
            node("aaa", vec![Role::Querier]),
            node("bbb", vec![Role::Querier]),
            node("ccc", vec![Role::Ingester]),
        ];
        let alert_managers = vec![node("zzz", vec![Role::AlertManager])];

        assert!(
            leads(&alert_managers, "zzz"),
            "the only alert manager in the deployment has to sweep"
        );
        assert!(
            !leads(&queriers, "zzz"),
            "and electing from the query nodes is why it never did"
        );
    }

    /// Two alert managers is the case the election exists for: exactly one of
    /// them sweeps, and both agree on which, whatever order the cache hands
    /// them back in.
    #[test]
    fn test_exactly_one_of_two_alert_managers_sweeps() {
        let mut nodes = vec![
            node("m2", vec![Role::AlertManager]),
            node("m1", vec![Role::AlertManager]),
        ];
        assert!(leads(&nodes, "m1"));
        assert!(!leads(&nodes, "m2"));
        nodes.reverse();
        assert!(leads(&nodes, "m1"), "the order the cache returns is not a vote");
        assert!(!leads(&nodes, "m2"));
    }

    /// A single node with every role is both an alert manager and a querier,
    /// which is why nobody noticed. It still sweeps.
    #[test]
    fn test_a_single_all_role_node_still_sweeps() {
        let all = vec![node("solo", vec![Role::All])];
        assert!(all[0].is_alert_manager());
        assert!(leads(&all, "solo"));
    }

    /// No cluster view — the cache is cold, or this is a single node that has
    /// not registered yet. Sweeping is the safe half of the guess.
    #[test]
    fn test_an_empty_cluster_view_sweeps_rather_than_waiting() {
        assert!(leads(&[], "anyone"));
    }
}

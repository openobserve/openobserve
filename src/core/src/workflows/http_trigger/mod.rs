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

//! Runs workflows started by HTTP requests on a per-region worker, apart from the trigger queue.

pub mod sweeper;
pub mod wake;
pub mod worker;

use config::cluster::LOCAL_NODE;
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

pub const HEARTBEAT_KEY: &str = "/workflow_hook_worker/heartbeat";
pub const WORKER_LOCK_KEY: &str = "/workflow-hook-worker";
pub const WAKE_PREFIX: &str = "/workflow_hook_wake/";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeTasks {
    pub wake_coalescer: bool,
    pub workflow_cache_watch: bool,
    pub worker: bool,
}

/// Phase 1 keeps Cloud off until spike S1 sizes its caps.
pub fn hooks_enabled() -> bool {
    let common = &get_o2_config().common;
    hooks_enabled_for(
        cfg!(feature = "cloud"),
        common.workflows_enabled,
        common.workflow_hooks_enabled,
    )
}

/// Router-only nodes return early from `jobs::init`, so they need their own selection.
pub fn node_tasks(
    is_router_only: bool,
    is_scheduler: bool,
    hooks_enabled: bool,
    worker_disabled: bool,
) -> NodeTasks {
    if !hooks_enabled {
        return NodeTasks::default();
    }
    NodeTasks {
        wake_coalescer: true,
        workflow_cache_watch: is_router_only,
        worker: is_scheduler && !worker_disabled,
    }
}

pub fn spawn_node_tasks() {
    let tasks = node_tasks(
        LOCAL_NODE.is_router() && LOCAL_NODE.is_single_role(),
        LOCAL_NODE.is_scheduler(),
        hooks_enabled(),
        config::get_config().limit.workflow_hook_worker_disabled,
    );
    if tasks.wake_coalescer {
        tokio::task::spawn(wake::run_coalescer());
    }
    // Other nodes already run this watch from `jobs::init`, past the router early return.
    if tasks.workflow_cache_watch {
        tokio::task::spawn(db::workflows::watch());
    }
    if tasks.worker {
        tokio::task::spawn(worker::run_supervisor());
    }
}

fn hooks_enabled_for(is_cloud: bool, workflows_enabled: bool, hooks_flag: bool) -> bool {
    !is_cloud && workflows_enabled && hooks_flag
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_are_off_when_workflows_are_off() {
        assert!(!hooks_enabled_for(false, false, true));
        assert!(!hooks_enabled_for(false, true, false));
        assert!(hooks_enabled_for(false, true, true));
    }

    #[test]
    fn hooks_stay_off_in_cloud_builds() {
        assert!(!hooks_enabled_for(true, true, true));
    }

    #[test]
    fn router_only_nodes_get_the_hook_node_tasks() {
        let tasks = node_tasks(true, false, true, false);
        assert_eq!(
            tasks,
            NodeTasks {
                wake_coalescer: true,
                workflow_cache_watch: true,
                worker: false,
            }
        );
    }

    #[test]
    fn schedulers_get_the_worker() {
        let tasks = node_tasks(false, true, true, false);
        assert!(tasks.worker);
        assert!(tasks.wake_coalescer);
        assert!(
            !tasks.workflow_cache_watch,
            "a scheduler already runs the workflow watch from jobs::init"
        );
        assert!(!node_tasks(false, false, true, false).worker);
    }

    #[test]
    fn a_disabled_worker_is_not_spawned() {
        let tasks = node_tasks(false, true, true, true);
        assert!(!tasks.worker);
        assert!(tasks.wake_coalescer);
    }

    #[test]
    fn nothing_spawns_when_hooks_are_off() {
        for (router_only, scheduler) in [(true, false), (false, true), (false, false)] {
            assert_eq!(
                node_tasks(router_only, scheduler, false, false),
                NodeTasks::default()
            );
        }
    }
}

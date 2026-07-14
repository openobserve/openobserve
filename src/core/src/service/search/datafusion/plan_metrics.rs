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

use std::sync::{Arc, atomic::AtomicUsize};

use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::ExecutionPlan,
    prelude::SessionContext,
};
use flight::common::Metrics;
use parking_lot::Mutex;

use super::{distributed_plan::remote_scan_exec::RemoteScanExec, peak_memory_pool::PeakMemoryPool};

pub fn get_cluster_metrics(plan: &Arc<dyn ExecutionPlan>) -> Vec<Arc<Mutex<Vec<Metrics>>>> {
    let mut visitor = MetricsVisitor::default();
    let _ = plan.visit(&mut visitor);
    visitor.metrics
}

#[derive(Default)]
struct MetricsVisitor {
    metrics: Vec<Arc<Mutex<Vec<Metrics>>>>,
}

impl<'n> TreeNodeVisitor<'n> for MetricsVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "RemoteScanExec" {
            let remote_scan_exec = node.downcast_ref::<RemoteScanExec>().unwrap();
            self.metrics.push(remote_scan_exec.cluster_metrics());
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

/// Get the peak memory from the SessionContext's memory pool.
/// This should be called after the query execution to get the peak memory usage.
pub fn get_peak_memory_from_ctx(ctx: &SessionContext) -> Arc<AtomicUsize> {
    ctx.runtime_env()
        .memory_pool
        .clone()
        .downcast_ref::<PeakMemoryPool>()
        .unwrap()
        .peak_memory
        .clone()
}

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

use std::sync::{Arc, atomic::AtomicUsize};

use config::meta::search::ScanStats;
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

use crate::service::search::datafusion::{
    distributed_plan::remote_scan_exec::RemoteScanExec, peak_memory_pool::PeakMemoryPool,
};

pub fn get_scan_stats(plan: &Arc<dyn ExecutionPlan>) -> Option<Arc<Mutex<ScanStats>>> {
    let mut visitor = RemoteScanVisitor::new();
    let _ = plan.visit(&mut visitor);
    visitor.scan_stats
}

struct RemoteScanVisitor {
    scan_stats: Option<Arc<Mutex<ScanStats>>>,
}

impl RemoteScanVisitor {
    pub fn new() -> Self {
        Self { scan_stats: None }
    }
}

impl<'n> TreeNodeVisitor<'n> for RemoteScanVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "RemoteScanExec" {
            let remote_scan_exec = node.as_any().downcast_ref::<RemoteScanExec>().unwrap();
            self.scan_stats = Some(remote_scan_exec.scan_stats());
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

pub fn get_cluster_metrics(plan: &Arc<dyn ExecutionPlan>) -> Vec<Arc<Mutex<Vec<Metrics>>>> {
    let mut visitor = MetricsVisitor::new();
    let _ = plan.visit(&mut visitor);
    visitor.metrics
}

struct MetricsVisitor {
    metrics: Vec<Arc<Mutex<Vec<Metrics>>>>,
}

impl MetricsVisitor {
    pub fn new() -> Self {
        Self {
            metrics: Vec::new(),
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for MetricsVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "RemoteScanExec" {
            let remote_scan_exec = node.as_any().downcast_ref::<RemoteScanExec>().unwrap();
            self.metrics.push(remote_scan_exec.cluster_metrics());
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

pub fn get_peak_memory(plan: &Arc<dyn ExecutionPlan>) -> Option<Arc<AtomicUsize>> {
    let mut visitor = PeakMemoryVisitor::new();
    let _ = plan.visit(&mut visitor);
    visitor.peak_memory
}

struct PeakMemoryVisitor {
    peak_memory: Option<Arc<AtomicUsize>>,
}

impl PeakMemoryVisitor {
    pub fn new() -> Self {
        Self { peak_memory: None }
    }
}

impl<'n> TreeNodeVisitor<'n> for PeakMemoryVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "RemoteScanExec" {
            let remote_scan_exec = node.as_any().downcast_ref::<RemoteScanExec>().unwrap();
            self.peak_memory = Some(remote_scan_exec.peak_memory());
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

/// Get the peak memory from the SessionContext's memory pool.
/// This should be called after the query execution to get the peak memory usage.
///
/// # Safety
/// This function uses unsafe code to downcast Arc<dyn MemoryPool> to Arc<PeakMemoryPool>.
/// This is sound because:
/// 1. The memory pool is always created as PeakMemoryPool in datafusion context creation (see
///    exec.rs)
/// 2. Arc::into_raw/from_raw maintain proper Arc semantics
/// 3. The type name is checked at runtime to verify the cast is valid
pub fn get_peak_memory_from_ctx(ctx: &SessionContext) -> Arc<AtomicUsize> {
    let memory_pool = ctx.runtime_env().memory_pool.clone();

    // Runtime type check: verify this is actually a PeakMemoryPool
    let type_name = format!("{:?}", memory_pool);
    if !type_name.contains("PeakMemoryPool") {
        log::warn!(
            "Memory pool is not PeakMemoryPool (type: {}), returning 0",
            type_name
        );
        return Arc::new(AtomicUsize::new(0));
    }

    // SAFETY: We've verified the concrete type is PeakMemoryPool via runtime check above.
    // The memory pool is created as PeakMemoryPool in datafusion context creation.
    // We use Arc::into_raw and Arc::from_raw to maintain proper reference counting.
    unsafe {
        let raw_ptr = Arc::into_raw(memory_pool);
        let peak_pool_ptr = raw_ptr as *const PeakMemoryPool;
        let peak_memory = (*peak_pool_ptr).peak_memory.clone();

        // Reconstruct the Arc to prevent memory leak
        let _ = Arc::from_raw(raw_ptr);

        peak_memory
    }
}

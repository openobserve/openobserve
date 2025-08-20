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

use config::meta::search::ScanStats;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::ExecutionPlan,
};
use flight::common::Metrics;
use parking_lot::Mutex;

use crate::service::search::datafusion::distributed_plan::remote_scan::RemoteScanExec;

pub fn get_scan_stats(plan: Arc<dyn ExecutionPlan>) -> Option<Arc<Mutex<ScanStats>>> {
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

pub fn get_cluster_metrics(plan: Arc<dyn ExecutionPlan>) -> Vec<Arc<Mutex<Vec<Metrics>>>> {
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
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

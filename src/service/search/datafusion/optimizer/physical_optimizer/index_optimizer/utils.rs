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

use datafusion::{common::tree_node::TreeNode, physical_plan::ExecutionPlan};

// check if the plan contains join, union, interleave, unnest, partial sort(use for streaming
// table), bounded window agg, window agg
pub fn is_complex_plan(node: &Arc<dyn ExecutionPlan>) -> bool {
    node.exists(|plan| {
        Ok(plan.name() == "HashJoinExec"
            || plan.name() == "RecursiveQueryExec"
            || plan.name() == "UnionExec"
            || plan.name() == "InterleaveExec"
            || plan.name() == "UnnestExec"
            || plan.name() == "CrossJoinExec"
            || plan.name() == "NestedLoopJoinExec"
            || plan.name() == "SymmetricHashJoinExec"
            || plan.name() == "SortMergeJoinExec"
            || plan.name() == "PartialSortExec"
            || plan.name() == "BoundedWindowAggExec"
            || plan.name() == "WindowAggExec"
            || plan.children().len() > 1)
    })
    .unwrap_or(true)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Arc;

    use datafusion::{
        common::{
            Result,
            tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
        },
        physical_plan::{
            ExecutionPlan,
            aggregates::{AggregateExec, AggregateMode},
        },
    };

    use crate::service::search::datafusion::distributed_plan::remote_scan_exec::RemoteScanExec;

    // get the first final aggregate plan from bottom to top
    pub(crate) fn get_partial_aggregate_plan(
        plan: Arc<dyn ExecutionPlan>,
    ) -> Option<AggregateExec> {
        let mut visitor = AggregateVisitor::new();
        let _ = plan.visit(&mut visitor);
        let data = visitor.get_data();
        data.map(|v| v.as_any().downcast_ref::<AggregateExec>().unwrap().clone())
    }

    struct AggregateVisitor {
        data: Option<Arc<dyn ExecutionPlan>>,
    }

    impl AggregateVisitor {
        fn new() -> Self {
            Self { data: None }
        }

        fn get_data(&self) -> Option<&Arc<dyn ExecutionPlan>> {
            self.data.as_ref()
        }
    }

    impl Default for AggregateVisitor {
        fn default() -> Self {
            Self::new()
        }
    }

    impl<'n> TreeNodeVisitor<'n> for AggregateVisitor {
        type Node = Arc<dyn ExecutionPlan>;

        fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
            if node.name() == "AggregateExec" {
                let agg = node.as_any().downcast_ref::<AggregateExec>().unwrap();
                if *agg.mode() == AggregateMode::Partial {
                    self.data = Some(node.clone());
                    Ok(TreeNodeRecursion::Stop)
                } else {
                    Ok(TreeNodeRecursion::Continue)
                }
            } else {
                Ok(TreeNodeRecursion::Continue)
            }
        }
    }

    pub(crate) fn get_remote_scan(plan: Arc<dyn ExecutionPlan>) -> Vec<Arc<RemoteScanExec>> {
        let mut visitor = RemoteScanVisitor::new();
        let _ = plan.visit(&mut visitor);
        visitor.get_data()
    }

    struct RemoteScanVisitor {
        data: Vec<Arc<RemoteScanExec>>,
    }

    impl RemoteScanVisitor {
        fn new() -> Self {
            Self { data: Vec::new() }
        }

        fn get_data(&self) -> Vec<Arc<RemoteScanExec>> {
            self.data.clone()
        }
    }

    impl Default for RemoteScanVisitor {
        fn default() -> Self {
            Self::new()
        }
    }

    impl<'n> TreeNodeVisitor<'n> for RemoteScanVisitor {
        type Node = Arc<dyn ExecutionPlan>;

        fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
            if node.name() == "RemoteScanExec" {
                let remote_scan = node.as_any().downcast_ref::<RemoteScanExec>().unwrap();
                self.data.push(Arc::new(remote_scan.clone()));
            }
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

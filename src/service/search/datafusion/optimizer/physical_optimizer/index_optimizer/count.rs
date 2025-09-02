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

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::{ExecutionPlan, aggregates::AggregateExec},
};

// check if the plan is like:
// select count(*) from stream
// or select count(*) as cnt from stream
// plan:
//   ProjectionExec: expr=[count(Int64(1))@0 as count(*)]
//     GlobalLimitExec: skip=0, fetch=100
//       AggregateExec: mode=Final, gby=[], aggr=[count(Int64(1))]
//         CoalescePartitionsExec
//           AggregateExec: mode=Partial, gby=[], aggr=[count(Int64(1))]
//             ProjectionExec: expr=[]
//               CoalesceBatchesExec: target_batch_size=8192
//                 FilterExec: _timestamp@0 >= 175256100000000 AND _timestamp@0 < 17525610000000000
//                   CooperativeExec
//                     NewEmptyExec: name="default"
pub(crate) fn is_simple_count(plan: Arc<dyn ExecutionPlan>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleCountVisitor::new();
    let _ = plan.visit(&mut visitor);
    if visitor.is_simple_count {
        Some(IndexOptimizeMode::SimpleCount)
    } else {
        None
    }
}

struct SimpleCountVisitor {
    pub is_simple_count: bool,
}

impl SimpleCountVisitor {
    pub fn new() -> Self {
        Self {
            is_simple_count: false,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleCountVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            if aggregate.group_expr().is_empty()
                && aggregate.aggr_expr().len() == 1
                && aggregate.aggr_expr()[0].fun().name().to_lowercase() == "count"
            {
                self.is_simple_count = true;
            } else {
                self.is_simple_count = false;
                return Ok(TreeNodeRecursion::Stop);
            }
        // if encounter complex plan, stop visiting
        } else if node.name() == "HashJoinExec"
            || node.name() == "RecursiveQueryExec"
            || node.name() == "UnionExec"
            || node.name() == "InterleaveExec"
            || node.name() == "UnnestExec"
            || node.name() == "CrossJoinExec"
            || node.name() == "NestedLoopJoinExec"
            || node.name() == "SymmetricHashJoinExec"
            || node.name() == "SortMergeJoinExec"
            || node.name() == "PartialSortExec"
            || node.name() == "BoundedWindowAggExec"
            || node.name() == "WindowAggExec"
        {
            self.is_simple_count = false;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

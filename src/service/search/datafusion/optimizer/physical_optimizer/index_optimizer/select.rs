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

use config::{TIMESTAMP_COL_NAME, meta::inverted_index::IndexOptimizeMode};
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::{ExecutionPlan, sorts::sort_preserving_merge::SortPreservingMergeExec},
};

use crate::service::search::datafusion::optimizer::physical_optimizer::utils::{
    get_column_name, is_column,
};

#[rustfmt::skip]
/// SimpleSelect(usize, bool): select * from table where match_all() order by _timestamp desc limit 10; 
/// condition: order by _timestamp asc or desc, have limit
/// example plan:
/// SortPreservingMergeExec: [_timestamp@0 DESC NULLS LAST], fetch=100
///   CoalesceBatchesExec: target_batch_size=8192, fetch=100
///     FilterExec: _timestamp@0 >= 175256100000000 AND _timestamp@0 < 17525610000000000
///       CooperativeExec
///         NewEmptyExec: name="default",
pub(crate) fn is_simple_select(plan: Arc<dyn ExecutionPlan>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleSelectVisitor::new();
    let _ = plan.visit(&mut visitor);
    if let Some((limit, ascend)) = visitor.is_simple_select {
        Some(IndexOptimizeMode::SimpleSelect(limit, ascend))
    } else {
        None
    }
}

struct SimpleSelectVisitor {
    pub is_simple_select: Option<(usize, bool)>,
}

impl SimpleSelectVisitor {
    pub fn new() -> Self {
        Self {
            is_simple_select: None,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleSelectVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(sort_merge) = node.as_any().downcast_ref::<SortPreservingMergeExec>() {
            if let Some(fetch) = sort_merge.fetch()
                && fetch > 0
                && sort_merge.expr().len() == 1
                && sort_merge.expr().iter().collect::<Vec<_>>().len() == 1
                && is_column(&sort_merge.expr().first().expr)
            {
                let column_name = get_column_name(&sort_merge.expr().first().expr);
                if column_name == TIMESTAMP_COL_NAME {
                    self.is_simple_select =
                        Some((fetch, !sort_merge.expr().first().options.descending));
                    return Ok(TreeNodeRecursion::Continue);
                }
            }
            // if not simple distinct, stop visiting
            self.is_simple_select = None;
            return Ok(TreeNodeRecursion::Stop);
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
            || node.name() == "AggregateExec"
        {
            // if encounter complex plan, stop visiting
            self.is_simple_select = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

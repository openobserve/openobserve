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

use std::{collections::HashSet, sync::Arc};

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::{
        ExecutionPlan, aggregates::AggregateExec,
        sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
};

use crate::service::search::datafusion::optimizer::physical_optimizer::utils::{
    get_column_name, is_column,
};

#[rustfmt::skip]
/// SimpleDistinct(String, usize, bool): select name from table where str_match(name, 'a') order by name asc limit 10;
/// condition：name is index field, group by name, order by name asc, have limit, and where only the str_match()(expect _timestamp)
/// RemoteScanExec: input_partitions=output_partitions=1
///   SortPreservingMergeExec: [kubernetes_namespace_name@0 ASC NULLS LAST], fetch=10
///     SortExec: TopK(fetch=10), expr=[kubernetes_namespace_name@0 ASC NULLS LAST], preserve_partitioning=[true]
///       AggregateExec: mode=FinalPartitioned, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[]
///         CoalesceBatchesExec: target_batch_size=8192
///           RepartitionExec: partitioning=Hash([kubernetes_namespace_name@0], 12), input_partitions=12
///             AggregateExec: mode=Partial, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[]
///               CoalesceBatchesExec: target_batch_size=8192
///                 FilterExec: _timestamp@0 >= 17296550822151 AND _timestamp@0 < 172965508891538700, projection=[kubernetes_namespace_name@1]
///                   CooperativeExec
///                     NewEmptyExec: name="default", projection=["_timestamp", "kubernetes_namespace_name"]
pub(crate) fn is_simple_distinct(plan: Arc<dyn ExecutionPlan>, index_fields: HashSet<String>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleDistinctVisitor::new(index_fields);
    let _ = plan.visit(&mut visitor);
    if let Some((field, fetch, ascend)) = visitor.simple_distinct {
        Some(IndexOptimizeMode::SimpleDistinct(
            field,
            fetch,
            ascend,
        ))
    } else {
        None
    }
}

struct SimpleDistinctVisitor {
    pub simple_distinct: Option<(String, usize, bool)>,
    pub index_fields: HashSet<String>,
}

impl SimpleDistinctVisitor {
    pub fn new(index_fields: HashSet<String>) -> Self {
        Self {
            simple_distinct: None,
            index_fields,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleDistinctVisitor {
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
                if self.index_fields.contains(column_name) {
                    self.simple_distinct = Some((
                        column_name.to_string(),
                        fetch,
                        !sort_merge.expr().first().options.descending,
                    ));
                    return Ok(TreeNodeRecursion::Continue);
                }
            }
            println!("\nnot simple distinct, stop visiting\n");
            // if not simple distinct, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // check if the group by is simple distinct,
            // only one group by field, no aggregate function
            if aggregate.group_expr().expr().len() == 1 && aggregate.aggr_expr().is_empty() {
                if let Some((group_expr, _)) = aggregate.group_expr().expr().first() {
                    let column_name = get_column_name(group_expr);
                    println!("\ncolumn_name: {}\n", column_name);
                    if is_column(group_expr)
                        && self.index_fields.contains(column_name)
                        && let Some(simple_distinct) = &self.simple_distinct
                        && simple_distinct.0 == column_name
                    {
                        return Ok(TreeNodeRecursion::Continue);
                    }
                }
            }
            println!("\nnot simple distinct, stop visiting for aggregate\n");
            // if not simple distinct, stop visiting
            self.simple_distinct = None;
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
        {
            // if encounter complex plan, stop visiting
            println!("\nnot simple distinct, stop visiting for complex plan\n");
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

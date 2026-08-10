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

use std::sync::Arc;

use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan,
        aggregates::{AggregateExec, AggregateMode},
        projection::ProjectionExec,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
};

use crate::datafusion::{
    distributed_plan::aggregate_topk_exec::AggregateTopkExec,
    optimizer::physical_optimizer::utils::get_final_aggregate_plan,
};

// add remote scan to physical plan
#[derive(Debug)]
pub struct AggregateTopkRule {
    limit: i64,
}

impl AggregateTopkRule {
    pub fn new(limit: i64) -> Self {
        Self { limit }
    }
}

impl PhysicalOptimizerRule for AggregateTopkRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if self.limit <= 0 || !config::get_config().search.aggregation_topk_enabled {
            return Ok(plan);
        }

        // check if there is no aggregate plan, return the original plan
        let Some(final_agg_plan) = get_final_aggregate_plan(Arc::clone(&plan)) else {
            return Ok(plan);
        };

        // check if the group by only one column
        if final_agg_plan.group_expr().expr().len() != 1 {
            return Ok(plan);
        }

        // check if the agg function is count
        if final_agg_plan.aggr_expr().len() != 1 {
            return Ok(plan);
        }

        if let Some(expr) = final_agg_plan.aggr_expr().first() {
            if !["count", "avg", "min", "max", "sum", "approx_distinct"]
                .contains(&expr.fun().name())
            {
                return Ok(plan);
            }
            let expr_name = expr.name();
            let mut visitor = SortLimitVisitor::new(expr_name);
            let _ = plan.visit(&mut visitor);
            if visitor.is_match {
                let mut rewriter =
                    AggregateTopkRewriter::new(expr_name, visitor.descending, visitor.limit as u64);
                let plan = plan.rewrite(&mut rewriter)?.data;
                return Ok(plan);
            }
        }
        Ok(plan)
    }

    fn name(&self) -> &str {
        "AggregateTopkRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

/// This rewriter is used to add a new node AggregateMergeExec in the middle of the
/// RemoteScanExec->AggregateExec. It will get the topK records from the AggregateExec and return
/// them to the RemoteScanExec.
pub(crate) struct AggregateTopkRewriter {
    field: String,
    descending: bool,
    limit: u64,
}

impl AggregateTopkRewriter {
    pub(crate) fn new(field: &str, descending: bool, limit: u64) -> Self {
        Self {
            field: field.to_string(),
            descending,
            limit,
        }
    }
}

impl TreeNodeRewriter for AggregateTopkRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        // This feature need cluster mode, single node we can skip it
        if node.children().len() == 1 && node.children().first().unwrap().name() == "AggregateExec"
        {
            let agg_node = node.children().first().cloned().unwrap();
            let Some(agg_exec) = agg_node.downcast_ref::<AggregateExec>() else {
                return Ok(Transformed::no(node));
            };
            if agg_exec.mode() != &AggregateMode::Partial {
                return Ok(Transformed::no(node));
            }

            let input_plan = Arc::clone(agg_node);
            let agg_plan =
                AggregateTopkExec::new(input_plan, &self.field, self.descending, self.limit);

            let node =
                node.with_new_children(vec![Arc::new(agg_plan) as Arc<dyn ExecutionPlan>])?;
            return Ok(Transformed::new(node, true, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

#[derive(Default)]
pub(crate) struct SortLimitVisitor {
    field: String,
    pub(crate) limit: usize,
    pub(crate) descending: bool,
    pub(crate) is_match: bool,
}

impl SortLimitVisitor {
    pub(crate) fn new(field: &str) -> Self {
        Self {
            field: field.to_string(),
            ..Default::default()
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SortLimitVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if node.name() == "ProjectionExec" {
            // we need to check if the field is map to any alias
            let Some(expr) = node.downcast_ref::<ProjectionExec>() else {
                return Ok(TreeNodeRecursion::Continue);
            };
            for projection_expr in expr.expr().iter() {
                let expr = &projection_expr.expr;
                let alias = &projection_expr.alias;
                if expr
                    .to_string()
                    .split('@')
                    .next()
                    .is_some_and(|v| v == self.field)
                {
                    self.field = alias.clone();
                    break;
                }
            }
        } else if node.name() == "SortExec" {
            // we need to check if the field is sort by field
            let Some(expr) = node.downcast_ref::<SortExec>() else {
                return Ok(TreeNodeRecursion::Continue);
            };
            for sort_expr in expr.expr().iter() {
                if sort_expr
                    .expr
                    .to_string()
                    .split('@')
                    .next()
                    .is_some_and(|v| v == self.field)
                {
                    self.is_match = true;
                    self.limit = expr.fetch().unwrap_or(0);
                    self.descending = sort_expr.options.descending;
                    return Ok(TreeNodeRecursion::Stop);
                }
            }
        } else if node.name() == "SortPreservingMergeExec" {
            // we need to check if the field is sort by field
            let Some(expr) = node.downcast_ref::<SortPreservingMergeExec>() else {
                return Ok(TreeNodeRecursion::Continue);
            };
            for sort_expr in expr.expr().iter() {
                if sort_expr
                    .expr
                    .to_string()
                    .split('@')
                    .next()
                    .is_some_and(|v| v == self.field)
                {
                    self.is_match = true;
                    self.limit = expr.fetch().unwrap_or(0);
                    self.descending = sort_expr.options.descending;
                    return Ok(TreeNodeRecursion::Stop);
                }
            }
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, aggregates::AggregateExec,
        sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
    sql::TableReference,
};
use parking_lot::Mutex;

mod count;
mod distinct;
mod histogram;
mod select;
mod topn;
mod utils;

use crate::service::search::datafusion::{
    distributed_plan::{empty_exec::NewEmptyExec, remote_scan::RemoteScanExec},
    optimizer::physical_optimizer::index_optimizer::{
        count::is_simple_count, distinct::is_simple_distinct, histogram::is_simple_histogram,
        select::is_simple_select, topn::is_simple_topn,
    },
};

/// this use in query follower to generate [`IndexOptimizeMode`]
/// this is used for optimizer that do not need global information
/// NOTE: use this optimizer in follower only when all filter
/// can be extract to index condition(except _timestamp filter)
#[derive(Default, Debug)]
pub struct FollowerIndexOptimizerRule {
    time_range: (i64, i64),
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl FollowerIndexOptimizerRule {
    pub fn new(
        time_range: (i64, i64),
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_optimizer_mode,
        }
    }
}

impl PhysicalOptimizerRule for FollowerIndexOptimizerRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !config::get_config().common.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter =
            FollowerIndexOptimizer::new(self.time_range, self.index_optimizer_mode.clone());
        let plan = plan.rewrite(&mut rewriter)?.data;
        Ok(plan)
    }

    fn name(&self) -> &str {
        "FollowerIndexOptimizerRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct FollowerIndexOptimizer {
    time_range: (i64, i64),
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl FollowerIndexOptimizer {
    pub fn new(
        time_range: (i64, i64),
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for FollowerIndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, plan: Self::Node) -> Result<Transformed<Self::Node>> {
        if plan
            .as_any()
            .downcast_ref::<SortPreservingMergeExec>()
            .is_some()
        {
            // Check for SimpleSelect
            if let Some(index_optimize_mode) = is_simple_select(Arc::clone(&plan)) {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
        } else if plan.as_any().downcast_ref::<AggregateExec>().is_some() {
            // Check for SimpleCount
            if let Some(index_optimize_mode) = is_simple_count(Arc::clone(&plan)) {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            // Check for SimpleHistogram
            if let Some(index_optimize_mode) =
                is_simple_histogram(Arc::clone(&plan), self.time_range)
            {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
        }
        Ok(Transformed::no(plan))
    }
}

/// this use in query leader to generate [`IndexOptimizeMode`]
/// this is used for optimizer that need global information
/// like order and limit
#[derive(Default, Debug)]
pub struct LeaderIndexOptimizerRule {
    index_fields: HashMap<TableReference, HashSet<String>>,
}

impl LeaderIndexOptimizerRule {
    pub fn new(index_fields: HashMap<TableReference, HashSet<String>>) -> Self {
        Self { index_fields }
    }
}

impl PhysicalOptimizerRule for LeaderIndexOptimizerRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !config::get_config().common.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter = LeaderIndexOptimizer::new(self.index_fields.clone());
        let plan = plan.rewrite(&mut rewriter)?.data;
        Ok(plan)
    }

    fn name(&self) -> &str {
        "LeaderIndexOptimizerRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct LeaderIndexOptimizer {
    index_fields: HashMap<TableReference, HashSet<String>>,
}

impl LeaderIndexOptimizer {
    pub fn new(index_fields: HashMap<TableReference, HashSet<String>>) -> Self {
        Self { index_fields }
    }
}

impl TreeNodeRewriter for LeaderIndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, plan: Self::Node) -> Result<Transformed<Self::Node>> {
        if plan
            .as_any()
            .downcast_ref::<SortPreservingMergeExec>()
            .is_some()
        {
            // Get the index fields of the underlying table
            let mut visitor = TableNameVisitor::new();
            plan.visit(&mut visitor)?;
            let Some(table_name) = visitor.table_name else {
                return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
            };
            let index_fields = self
                .index_fields
                .get(&table_name)
                .cloned()
                .unwrap_or(HashSet::new());

            // check if the query is simple topn or simple distinct
            if let Some(index_optimize_mode) =
                is_simple_topn(Arc::clone(&plan), index_fields.clone())
            {
                // Check for SimpleTopN
                let mut rewriter = IndexOptimizerRewrite::new(index_optimize_mode);
                let plan = plan.rewrite(&mut rewriter)?.data;
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            } else if let Some(index_optimize_mode) =
                is_simple_distinct(Arc::clone(&plan), index_fields.clone())
            {
                // Check for SimpleDistinct
                let mut rewriter = IndexOptimizerRewrite::new(index_optimize_mode);
                let plan = plan.rewrite(&mut rewriter)?.data;
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            } else {
                return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
            }
        }
        Ok(Transformed::no(plan))
    }
}

#[derive(Debug)]
struct IndexOptimizerRewrite {
    index_optimizer_mode: IndexOptimizeMode,
}

impl IndexOptimizerRewrite {
    fn new(index_optimizer_mode: IndexOptimizeMode) -> Self {
        IndexOptimizerRewrite {
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizerRewrite {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if let Some(remote) = node.as_any().downcast_ref::<RemoteScanExec>() {
            let remote = Arc::new(
                remote
                    .clone()
                    .set_index_optimize_mode(self.index_optimizer_mode.clone()),
            ) as Arc<dyn ExecutionPlan>;
            return Ok(Transformed::new(remote, true, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

// visit physical plan to get underlying table name
struct TableNameVisitor {
    table_name: Option<TableReference>,
}

impl TableNameVisitor {
    pub fn new() -> Self {
        Self { table_name: None }
    }
}

impl<'n> TreeNodeVisitor<'n> for TableNameVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "NewEmptyExec" {
            let table = node.as_any().downcast_ref::<NewEmptyExec>().unwrap();
            self.table_name = Some(TableReference::from(table.name()));
            Ok(TreeNodeRecursion::Continue)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

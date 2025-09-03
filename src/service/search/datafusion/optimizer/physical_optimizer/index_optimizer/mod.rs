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
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, aggregates::AggregateExec,
        sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
};
use parking_lot::Mutex;

mod count;
mod distinct;
mod histogram;
mod select;
mod topn;

use crate::service::search::{
    datafusion::optimizer::physical_optimizer::index_optimizer::{
        count::is_simple_count, distinct::is_simple_distinct, histogram::is_simple_histogram,
        select::is_simple_select, topn::is_simple_topn,
    },
    index::IndexCondition,
};

#[derive(Default, Debug)]
pub struct IndexOptimizeRule {
    time_range: (i64, i64),
    index_fields: HashSet<String>,
    index_condition: IndexCondition,
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl IndexOptimizeRule {
    pub fn new(
        time_range: (i64, i64),
        index_fields: HashSet<String>,
        index_condition: IndexCondition,
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_fields,
            index_condition,
            index_optimizer_mode,
        }
    }
}

impl PhysicalOptimizerRule for IndexOptimizeRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let mut rewriter = IndexOptimizer::new(
            self.time_range,
            self.index_fields.clone(),
            self.index_condition.clone(),
            self.index_optimizer_mode.clone(),
        );
        let plan = plan.rewrite(&mut rewriter)?.data;
        Ok(plan)
    }

    fn name(&self) -> &str {
        "index_optimizer"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct IndexOptimizer {
    time_range: (i64, i64),
    index_fields: HashSet<String>,
    index_condition: IndexCondition,
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl IndexOptimizer {
    pub fn new(
        time_range: (i64, i64),
        index_fields: HashSet<String>,
        index_condition: IndexCondition,
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_fields,
            index_condition,
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, plan: Self::Node) -> Result<Transformed<Self::Node>> {
        if plan
            .as_any()
            .downcast_ref::<SortPreservingMergeExec>()
            .is_some()
        {
            // Check for SimpleTopN first
            if let Some(index_optimize_mode) =
                is_simple_topn(Arc::clone(&plan), self.index_fields.clone())
            {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            // Check for SimpleDistinct
            if let Some(index_optimize_mode) = is_simple_distinct(
                Arc::clone(&plan),
                self.index_fields.clone(),
                self.index_condition.clone(),
            ) {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
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

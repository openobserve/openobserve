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
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter}, Result
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        aggregates::{AggregateExec, AggregateMode}, ExecutionPlan
    },
};
use parking_lot::Mutex;

use crate::service::search::index::IndexCondition;

#[derive(Default, Debug)]
pub struct IndexOptimizeRule {
    index_fields: HashSet<String>,
    index_condition: Option<IndexCondition>,
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl IndexOptimizeRule {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Option<IndexCondition>,
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
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
    index_fields: HashSet<String>,
    index_condition: Option<IndexCondition>,
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl IndexOptimizer {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Option<IndexCondition>,
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            index_fields,
            index_condition,
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Self::Node) -> Result<Transformed<Self::Node>> {
        if let Some(agg) = node.as_any().downcast_ref::<AggregateExec>()
            && *agg.mode() == AggregateMode::Partial
        {
            return Ok(Transformed::new(node, false, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

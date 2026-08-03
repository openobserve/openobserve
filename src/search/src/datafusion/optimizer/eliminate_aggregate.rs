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

use datafusion::{
    common::{Result, tree_node::TreeNode},
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{ExecutionPlan, ExecutionPlanProperties, empty::EmptyExec},
};

/// rewrite the plan to eliminate the aggregate plan if the streaming aggregation's output partition
/// is 0
#[derive(Debug, Default)]
pub struct EliminateAggregateRule {}

impl EliminateAggregateRule {
    pub fn new() -> Self {
        Self {}
    }
}

impl PhysicalOptimizerRule for EliminateAggregateRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let is_empty_streaming_agg = plan.exists(|plan| {
            if plan.name() == "StreamingAggsExec"
                && plan.output_partitioning().partition_count() == 0
            {
                return Ok(true);
            }
            Ok(false)
        })?;

        if is_empty_streaming_agg {
            return Ok(Arc::new(EmptyExec::new(plan.schema())) as _);
        }

        Ok(plan)
    }

    fn name(&self) -> &str {
        "EliminateAggregateRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

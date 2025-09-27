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

use async_trait::async_trait;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    execution::SessionState,
    logical_expr::{LogicalPlan, UserDefinedLogicalNode},
    physical_plan::ExecutionPlan,
    physical_planner::{DefaultPhysicalPlanner, ExtensionPlanner, PhysicalPlanner},
};

use crate::service::search::datafusion::{
    distributed_plan::histogram_sort_merge_join_exec::HistogramSortMergeJoinExec,
    optimizer::logical_optimizer::histogram_sort_merge_join1::HistogramJoinNode,
};

/// Extension planner that converts HistogramJoinNode to HistogramSortMergeJoinExec
pub struct HistogramJoinPlanner {
    #[allow(dead_code)]
    default_planner: DefaultPhysicalPlanner,
}

impl HistogramJoinPlanner {
    pub fn new() -> Self {
        Self {
            default_planner: DefaultPhysicalPlanner::default(),
        }
    }

    /// Replace NewEmptyExec in either side with the data-bearing side in distributed histogram
    /// joins
    fn fix_empty_exec_sides(
        &self,
        left: Arc<dyn ExecutionPlan>,
        right: Arc<dyn ExecutionPlan>,
    ) -> Result<(Arc<dyn ExecutionPlan>, Arc<dyn ExecutionPlan>)> {
        let is_left_empty = left.name() == "NewEmptyExec" || left.name() == "EmptyExec";
        let is_right_empty = right.name() == "NewEmptyExec" || right.name() == "EmptyExec";

        // If both are empty, return as is (no data to join)
        if is_left_empty && is_right_empty {
            log::info!("HistogramJoinPlanner: Both sides are empty, no data to join");
            return Ok((left, right));
        }

        // If right side is empty but left has data, use left data for both sides
        if is_right_empty && !is_left_empty {
            log::info!(
                "HistogramJoinPlanner: Right side is empty ({}), using left side data for both sides",
                right.name()
            );
            let data_source = self.find_or_create_data_source(&left)?;
            return Ok((left, data_source));
        }

        // If left side is empty but right has data, use right data for both sides
        if is_left_empty && !is_right_empty {
            log::info!(
                "HistogramJoinPlanner: Left side is empty ({}), using right side data for both sides",
                left.name()
            );
            let data_source = self.find_or_create_data_source(&right)?;
            return Ok((data_source, right));
        }

        // Both sides have data, return as is
        Ok((left, right))
    }

    /// Find or create a data source from the execution plan tree
    fn find_or_create_data_source(
        &self,
        plan: &Arc<dyn ExecutionPlan>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        // If this is already a data source (not NewEmptyExec), return it
        if plan.name() != "NewEmptyExec" && plan.name() != "EmptyExec" {
            return Ok(plan.clone());
        }

        // If this is NewEmptyExec/EmptyExec, we need to find the actual data source
        // by traversing down the plan tree
        let mut visitor = DataSourceFinder::new();
        plan.visit(&mut visitor)?;

        if let Some(data_source) = visitor.data_source {
            log::info!(
                "HistogramJoinPlanner: Found data source: {}",
                data_source.name()
            );
            Ok(data_source)
        } else {
            log::warn!("HistogramJoinPlanner: No data source found, returning original plan");
            Ok(plan.clone())
        }
    }
}

/// Visitor that finds data sources in an execution plan tree
struct DataSourceFinder {
    data_source: Option<Arc<dyn ExecutionPlan>>,
}

impl DataSourceFinder {
    fn new() -> Self {
        Self { data_source: None }
    }
}

impl TreeNodeVisitor<'_> for DataSourceFinder {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &Self::Node) -> Result<TreeNodeRecursion> {
        // Look for data source plans that are not empty
        if node.name().contains("DataSourceExec")
            || node.name().contains("TableScan")
            || (node.name() != "NewEmptyExec"
                && node.name() != "EmptyExec"
                && node.children().is_empty())
        {
            log::debug!(
                "DataSourceFinder: Found potential data source: {}",
                node.name()
            );
            self.data_source = Some(node.clone());
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

#[async_trait]
impl ExtensionPlanner for HistogramJoinPlanner {
    async fn plan_extension(
        &self,
        _planner: &dyn PhysicalPlanner,
        node: &dyn UserDefinedLogicalNode,
        _logical_inputs: &[&LogicalPlan],
        physical_inputs: &[Arc<dyn ExecutionPlan>],
        session_state: &SessionState,
    ) -> Result<Option<Arc<dyn ExecutionPlan>>> {
        log::info!(
            "HistogramJoinPlanner: plan_extension called for node type: {}",
            node.name()
        );

        // Check if this is a HistogramJoinNode
        if let Some(histogram_join) = node.as_any().downcast_ref::<HistogramJoinNode>() {
            log::info!("HistogramJoinPlanner: Successfully matched HistogramJoinNode");
            return self
                .create_histogram_join_exec(histogram_join, physical_inputs, session_state)
                .await;
        }

        log::info!(
            "HistogramJoinPlanner: Node is not a HistogramJoinNode, delegating to default planner"
        );
        // Delegate to default planner for other plans
        Ok(None)
    }
}

impl HistogramJoinPlanner {
    async fn create_histogram_join_exec(
        &self,
        histogram_join: &HistogramJoinNode,
        physical_inputs: &[Arc<dyn ExecutionPlan>],
        _session_state: &SessionState,
    ) -> Result<Option<Arc<dyn ExecutionPlan>>> {
        log::info!(
            "Creating HistogramSortMergeJoinExec for time columns: {:?}, join columns: {:?}",
            (
                histogram_join.left_time_column.clone(),
                histogram_join.right_time_column.clone()
            ),
            histogram_join.join_columns
        );

        if physical_inputs.len() != 2 {
            return Err(datafusion::common::DataFusionError::Internal(
                "HistogramJoinNode requires exactly 2 physical inputs".to_string(),
            ));
        }

        // Fix any empty sides for distributed histogram joins
        let (left_plan, right_plan) =
            self.fix_empty_exec_sides(physical_inputs[0].clone(), physical_inputs[1].clone())?;

        // Use the original join schema which properly represents the join output
        // Each field position corresponds to: [left_fields...] [right_fields...]
        let arrow_schema = Arc::new(histogram_join.schema.as_arrow().clone());
        log::debug!(
            "Using original join schema with {} fields",
            arrow_schema.fields().len()
        );

        // Create the HistogramSortMergeJoinExec with the original join schema
        let config = crate::service::search::datafusion::distributed_plan::histogram_sort_merge_join_exec::HistogramJoinExecConfig {
            left_time_column: histogram_join.left_time_column.clone(),
            right_time_column: histogram_join.right_time_column.clone(),
            join_columns: histogram_join.join_columns.clone(),
            histogram_interval: histogram_join.time_bin_interval.clone(),
            remote_scan_nodes: None, // No remote scan nodes for now
            schema: arrow_schema,
        };
        let histogram_join_exec =
            HistogramSortMergeJoinExec::new_with_schema(left_plan, right_plan, config)?;

        Ok(Some(Arc::new(histogram_join_exec)))
    }
}

impl Default for HistogramJoinPlanner {
    fn default() -> Self {
        Self::new()
    }
}

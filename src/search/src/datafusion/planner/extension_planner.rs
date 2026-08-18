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

use std::{future::ready, sync::Arc};

use async_trait::async_trait;
use datafusion::{
    common::Result as DataFusionResult,
    error::DataFusionError,
    execution::{SessionState, context::QueryPlanner},
    logical_expr::{LogicalPlan, UserDefinedLogicalNode},
    physical_plan::{ExecutionPlan, expressions::Column},
    physical_planner::{DefaultPhysicalPlanner, ExtensionPlanner, PhysicalPlanner},
};
use futures::future::BoxFuture;

use crate::datafusion::plan::{
    deduplication::DeduplicationLogicalNode, deduplication_exec::DeduplicationExec,
};

// A query planner that wrap datafusion's default planner with extension planner
#[derive(Debug)]
pub struct OpenobserveQueryPlanner {}

impl Default for OpenobserveQueryPlanner {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenobserveQueryPlanner {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl QueryPlanner for OpenobserveQueryPlanner {
    fn create_physical_plan<'life0, 'life1, 'life2, 'async_trait>(
        &'life0 self,
        logical_plan: &'life1 LogicalPlan,
        session_state: &'life2 SessionState,
    ) -> BoxFuture<'async_trait, DataFusionResult<Arc<dyn ExecutionPlan>>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        'life2: 'async_trait,
        Self: 'async_trait,
    {
        self.create_physical_plan_boxed(logical_plan, session_state)
    }
}

impl OpenobserveQueryPlanner {
    // Construct the future outside `#[async_trait]` so rustc can globally cache
    // the recursive `LogicalPlan` Send/Sync proofs.
    fn create_physical_plan_boxed<'a>(
        &'a self,
        logical_plan: &'a LogicalPlan,
        session_state: &'a SessionState,
    ) -> BoxFuture<'a, DataFusionResult<Arc<dyn ExecutionPlan>>> {
        Box::pin(self.create_physical_plan_inner(logical_plan, session_state))
    }

    async fn create_physical_plan_inner(
        &self,
        logical_plan: &LogicalPlan,
        session_state: &SessionState,
    ) -> DataFusionResult<Arc<dyn ExecutionPlan>> {
        let planners: Vec<Arc<dyn ExtensionPlanner + Send + Sync>> =
            vec![Arc::new(DeduplicationExecPlanner::new())];

        DefaultPhysicalPlanner::with_extension_planners(planners)
            .create_physical_plan(logical_plan, session_state)
            .await
    }
}

/// A physical planner that convert a `DeduplicationLogicalNode` into `DeduplicationExec`,
#[derive(Debug)]
pub struct DeduplicationExecPlanner {}

impl Default for DeduplicationExecPlanner {
    fn default() -> Self {
        Self::new()
    }
}

impl DeduplicationExecPlanner {
    pub fn new() -> Self {
        Self {}
    }
}

#[async_trait]
impl ExtensionPlanner for DeduplicationExecPlanner {
    fn plan_extension<'life0, 'life1, 'life2, 'life3, 'life4, 'life5, 'life6, 'async_trait>(
        &'life0 self,
        planner: &'life1 dyn PhysicalPlanner,
        node: &'life2 dyn UserDefinedLogicalNode,
        logical_inputs: &'life3 [&'life4 LogicalPlan],
        physical_inputs: &'life5 [Arc<dyn ExecutionPlan>],
        session_state: &'life6 SessionState,
    ) -> BoxFuture<'async_trait, DataFusionResult<Option<Arc<dyn ExecutionPlan>>>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        'life2: 'async_trait,
        'life3: 'async_trait,
        'life4: 'async_trait,
        'life5: 'async_trait,
        'life6: 'async_trait,
        Self: 'async_trait,
    {
        self.plan_extension_boxed(
            planner,
            node,
            logical_inputs,
            physical_inputs,
            session_state,
        )
    }
}

impl DeduplicationExecPlanner {
    // This method is synchronous; `ready` avoids creating a coroutine that
    // forces rustc to re-prove the recursive `LogicalPlan` type graph.
    fn plan_extension_boxed<'a>(
        &'a self,
        planner: &'a dyn PhysicalPlanner,
        node: &'a dyn UserDefinedLogicalNode,
        logical_inputs: &'a [&'a LogicalPlan],
        physical_inputs: &'a [Arc<dyn ExecutionPlan>],
        session_state: &'a SessionState,
    ) -> BoxFuture<'a, DataFusionResult<Option<Arc<dyn ExecutionPlan>>>> {
        Box::pin(ready(self.plan_extension_inner(
            planner,
            node,
            logical_inputs,
            physical_inputs,
            session_state,
        )))
    }

    fn plan_extension_inner(
        &self,
        _planner: &dyn PhysicalPlanner,
        node: &dyn UserDefinedLogicalNode,
        _logical_inputs: &[&LogicalPlan],
        physical_inputs: &[Arc<dyn ExecutionPlan>],
        _session_state: &SessionState,
    ) -> DataFusionResult<Option<Arc<dyn ExecutionPlan>>> {
        let Some(deduplication_node) = node.as_any().downcast_ref::<DeduplicationLogicalNode>()
        else {
            return Ok(None);
        };

        if physical_inputs.len() != 1 {
            return Err(DataFusionError::Plan(
                "DeduplicationExecPlanner expects only one input".to_string(),
            ));
        }

        let input = physical_inputs.first().unwrap();
        let schema = input.schema();

        let deduplication_columns = deduplication_node
            .deduplication_columns
            .iter()
            .map(|c| Column::new_with_schema(c.name(), &schema).unwrap())
            .collect();

        let max_rows = deduplication_node.max_rows;
        let deduplication_exec =
            DeduplicationExec::new(input.clone(), deduplication_columns, max_rows);
        Ok(Some(Arc::new(deduplication_exec)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openobserve_query_planner_new() {
        let planner = OpenobserveQueryPlanner::new();
        let _: &OpenobserveQueryPlanner = &planner;
    }

    #[test]
    fn test_deduplication_exec_planner_new() {
        let planner = DeduplicationExecPlanner::new();
        let _: &DeduplicationExecPlanner = &planner;
    }
}

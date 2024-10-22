// Copyright 2024 OpenObserve Inc.
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
        tree_node::{Transformed, TransformedResult, TreeNode},
        Result,
    },
    config::ConfigOptions,
    physical_optimizer::{join_selection::swap_hash_join, PhysicalOptimizerRule},
    physical_plan::{
        aggregates::AggregateExec, joins::HashJoinExec, visit_execution_plan, ExecutionPlan,
        ExecutionPlanVisitor,
    },
};

#[derive(Default)]
pub struct JoinReorderRule;

impl JoinReorderRule {
    pub fn new() -> Self {
        Self {}
    }
}

impl PhysicalOptimizerRule for JoinReorderRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        plan.transform_down(swap_join_order).data()
    }

    fn name(&self) -> &str {
        "join_reorder"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

fn swap_join_order(plan: Arc<dyn ExecutionPlan>) -> Result<Transformed<Arc<dyn ExecutionPlan>>> {
    if let Some(hash_join) = plan.as_any().downcast_ref::<HashJoinExec>() {
        let left = hash_join.left();
        let right = hash_join.right();
        if !is_agg_exec(left) && is_agg_exec(right) {
            return Ok(Transformed::yes(swap_hash_join(hash_join, hash_join.mode)?));
        }
    }
    Ok(Transformed::no(plan))
}

// check if the plan and it subplan is aggregate execution plan
fn is_agg_exec(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut visitor = PlanVisitor::new();
    let _ = visit_execution_plan(plan.as_ref(), &mut visitor);
    visitor.is_agg
}

// visitor to check if the plan is aggregate execution plan
#[derive(Debug)]
struct PlanVisitor {
    is_agg: bool,
}

impl PlanVisitor {
    pub fn new() -> Self {
        PlanVisitor { is_agg: false }
    }
}

impl ExecutionPlanVisitor for PlanVisitor {
    type Error = datafusion::common::DataFusionError;

    fn pre_visit(&mut self, plan: &dyn ExecutionPlan) -> Result<bool, Self::Error> {
        let mayby_agg_exec = plan.as_any().downcast_ref::<AggregateExec>();
        if mayby_agg_exec.is_some() {
            self.is_agg = true;
            return Ok(false);
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::Result,
        datasource::MemTable,
        execution::{
            runtime_env::{RuntimeConfig, RuntimeEnv},
            SessionStateBuilder,
        },
        physical_plan::get_plan_string,
        prelude::{SessionConfig, SessionContext},
    };

    use crate::service::search::datafusion::optimizer::join_reorder::JoinReorderRule;

    #[tokio::test]
    async fn test_join_reorder() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3, 4, 5])),
                Arc::new(StringArray::from(vec![
                    "openobserve",
                    "observe",
                    "openobserve",
                    "oo",
                    "o2",
                ])),
            ],
        )
        .unwrap();

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new())
            .with_runtime_env(Arc::new(RuntimeEnv::new(RuntimeConfig::default()).unwrap()))
            .with_default_features()
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT count(*) from t where name in (select distinct name from t)";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "AggregateExec: mode=Final, gby=[], aggr=[count(*)]",
            "  CoalescePartitionsExec",
            "    AggregateExec: mode=Partial, gby=[], aggr=[count(*)]",
            "      ProjectionExec: expr=[]",
            "        CoalesceBatchesExec: target_batch_size=8192",
            "          HashJoinExec: mode=Partitioned, join_type=RightSemi, on=[(name@0, name@0)]",
            "            AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "              CoalesceBatchesExec: target_batch_size=8192",
            "                RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "                  RepartitionExec: partitioning=RoundRobinBatch(12), input_partitions=1",
            "                    AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "                      MemoryExec: partitions=1, partition_sizes=[1]",
            "            CoalesceBatchesExec: target_batch_size=8192",
            "              RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=1",
            "                MemoryExec: partitions=1, partition_sizes=[1]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }
}

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
    common::{
        Result,
        tree_node::{Transformed, TransformedResult, TreeNode},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, ExecutionPlanVisitor,
        aggregates::AggregateExec,
        joins::{HashJoinExec, PartitionMode},
        visit_execution_plan,
    },
};

#[derive(Default, Debug)]
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
        if !is_agg_exec(left)
            && is_agg_exec(right)
            && hash_join.join_type().supports_swap()
            && hash_join.mode != PartitionMode::CollectLeft
        {
            return Ok(Transformed::yes(HashJoinExec::swap_inputs(
                hash_join,
                hash_join.mode,
            )?));
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

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::Result,
        execution::{runtime_env::RuntimeEnvBuilder, session_state::SessionStateBuilder},
        physical_plan::get_plan_string,
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::service::search::datafusion::{
        optimizer::limit_join_right_side::LimitJoinRightSide,
        planner::extension_planner::OpenobserveQueryPlanner,
        table_provider::empty_table::NewEmptyTable,
    };

    #[tokio::test]
    async fn test_join_reorder() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT count(*) from t where name in (select distinct name from t)";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "ProjectionExec: expr=[count(Int64(1))@0 as count(*)]",
            "  AggregateExec: mode=Final, gby=[], aggr=[count(Int64(1))]",
            "    CoalescePartitionsExec",
            "      AggregateExec: mode=Partial, gby=[], aggr=[count(Int64(1))]",
            "        ProjectionExec: expr=[]",
            "          CoalesceBatchesExec: target_batch_size=8192",
            "            HashJoinExec: mode=Partitioned, join_type=RightSemi, on=[(name@0, name@0)]",
            "              AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "                CoalesceBatchesExec: target_batch_size=8192",
            "                  RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "                    AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "                      CooperativeExec",
            "                        NewEmptyExec: name=\"t\", projection=[\"name\"], filters=[]",
            "              CoalesceBatchesExec: target_batch_size=8192",
            "                RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "                  CooperativeExec",
            "                    NewEmptyExec: name=\"t\", projection=[\"name\"], filters=[]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_reorder_intersect() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT name FROM t WHERE _timestamp > 1000 INTERSECT SELECT name FROM t WHERE _timestamp < 2000";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "CoalesceBatchesExec: target_batch_size=8192",
            "  HashJoinExec: mode=Partitioned, join_type=LeftSemi, on=[(name@0, name@0)]",
            "    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "      CoalesceBatchesExec: target_batch_size=8192",
            "        RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "          AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "            CoalesceBatchesExec: target_batch_size=8192",
            "              FilterExec: _timestamp@0 > 1000, projection=[name@1]",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp > Int64(1000)\"]",
            "    CoalesceBatchesExec: target_batch_size=8192",
            "      RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "        CoalesceBatchesExec: target_batch_size=8192",
            "          FilterExec: _timestamp@0 < 2000, projection=[name@1]",
            "            CooperativeExec",
            "              NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp < Int64(2000)\"]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_reorder_except() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT name FROM t WHERE _timestamp > 1000 EXCEPT SELECT name FROM t WHERE _timestamp < 2000";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "CoalesceBatchesExec: target_batch_size=8192",
            "  HashJoinExec: mode=Partitioned, join_type=LeftAnti, on=[(name@0, name@0)]",
            "    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "      CoalesceBatchesExec: target_batch_size=8192",
            "        RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "          AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "            CoalesceBatchesExec: target_batch_size=8192",
            "              FilterExec: _timestamp@0 > 1000, projection=[name@1]",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp > Int64(1000)\"]",
            "    CoalesceBatchesExec: target_batch_size=8192",
            "      RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "        CoalesceBatchesExec: target_batch_size=8192",
            "          FilterExec: _timestamp@0 < 2000, projection=[name@1]",
            "            CooperativeExec",
            "              NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp < Int64(2000)\"]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));
        Ok(())
    }

    #[tokio::test]
    async fn test_join_reorder_dedup() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)))
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT count(*) from t where name in (select distinct name from t)";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "ProjectionExec: expr=[count(Int64(1))@0 as count(*)]",
            "  AggregateExec: mode=Final, gby=[], aggr=[count(Int64(1))]",
            "    CoalescePartitionsExec",
            "      AggregateExec: mode=Partial, gby=[], aggr=[count(Int64(1))]",
            "        ProjectionExec: expr=[]",
            "          CoalesceBatchesExec: target_batch_size=8192",
            "            HashJoinExec: mode=CollectLeft, join_type=RightSemi, on=[(name@0, name@0)]",
            "              DeduplicationExec: columns: [name@0]",
            "                SortExec: TopK(fetch=50000), expr=[name@0 DESC NULLS LAST], preserve_partitioning=[false]",
            "                  CoalescePartitionsExec",
            "                    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[], lim=[50000]",
            "                      CoalesceBatchesExec: target_batch_size=8192",
            "                        RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "                          AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[], lim=[50000]",
            "                            CooperativeExec",
            "                              NewEmptyExec: name=\"t\", projection=[\"name\"], filters=[]",
            "              CooperativeExec",
            "                NewEmptyExec: name=\"t\", projection=[\"name\"], filters=[]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_reorder_intersect_dedup() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)))
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT name FROM t WHERE _timestamp > 1000 INTERSECT SELECT name FROM t WHERE _timestamp < 2000";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "CoalesceBatchesExec: target_batch_size=8192",
            "  HashJoinExec: mode=CollectLeft, join_type=RightSemi, on=[(name@0, name@0)]",
            "    ProjectionExec: expr=[name@1 as name]",
            "      DeduplicationExec: columns: [name@1]",
            "        SortExec: expr=[name@1 DESC NULLS LAST, _timestamp@0 DESC NULLS LAST], preserve_partitioning=[false]",
            "          SortPreservingMergeExec: [_timestamp@0 DESC NULLS LAST], fetch=50000",
            "            CoalesceBatchesExec: target_batch_size=8192, fetch=50000",
            "              FilterExec: _timestamp@0 < 2000",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp < Int64(2000)\"], sorted_by_time=true",
            "    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "      CoalesceBatchesExec: target_batch_size=8192",
            "        RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "          AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "            CoalesceBatchesExec: target_batch_size=8192",
            "              FilterExec: _timestamp@0 > 1000, projection=[name@1]",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp > Int64(1000)\"]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_reorder_except_dedup() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)))
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT name FROM t WHERE _timestamp > 1000 EXCEPT SELECT name FROM t WHERE _timestamp < 2000";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "CoalesceBatchesExec: target_batch_size=8192",
            "  HashJoinExec: mode=CollectLeft, join_type=RightAnti, on=[(name@0, name@0)]",
            "    ProjectionExec: expr=[name@1 as name]",
            "      DeduplicationExec: columns: [name@1]",
            "        SortExec: expr=[name@1 DESC NULLS LAST, _timestamp@0 DESC NULLS LAST], preserve_partitioning=[false]",
            "          SortPreservingMergeExec: [_timestamp@0 DESC NULLS LAST], fetch=50000",
            "            CoalesceBatchesExec: target_batch_size=8192, fetch=50000",
            "              FilterExec: _timestamp@0 < 2000",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp < Int64(2000)\"], sorted_by_time=true",
            "    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[]",
            "      CoalesceBatchesExec: target_batch_size=8192",
            "        RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=12",
            "          AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[]",
            "            CoalesceBatchesExec: target_batch_size=8192",
            "              FilterExec: _timestamp@0 > 1000, projection=[name@1]",
            "                CooperativeExec",
            "                  NewEmptyExec: name=\"t\", projection=[\"_timestamp\", \"name\"], filters=[\"_timestamp > Int64(1000)\"]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));
        Ok(())
    }
}

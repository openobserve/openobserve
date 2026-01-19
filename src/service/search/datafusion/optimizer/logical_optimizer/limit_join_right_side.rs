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

use config::TIMESTAMP_COL_NAME;
use datafusion::{
    common::{
        Column, Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    logical_expr::{Extension, LogicalPlan, Sort, SortExpr},
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder},
    prelude::{Expr, col},
};
use itertools::Itertools;

use crate::service::search::datafusion::{
    optimizer::utils::{AddSortAndLimit, is_contain_deduplication_plan},
    plan::deduplication::DeduplicationLogicalNode,
};

#[derive(Default, Debug)]
pub struct LimitJoinRightSide {
    limit: usize,
}

impl LimitJoinRightSide {
    pub fn new(limit: usize) -> Self {
        Self { limit }
    }
}

impl OptimizerRule for LimitJoinRightSide {
    fn name(&self) -> &str {
        "limit_join_right_side"
    }

    fn apply_order(&self) -> Option<ApplyOrder> {
        Some(ApplyOrder::TopDown)
    }

    fn supports_rewrite(&self) -> bool {
        true
    }

    fn rewrite(
        &self,
        plan: LogicalPlan,
        _config: &dyn OptimizerConfig,
    ) -> Result<Transformed<LogicalPlan>> {
        if self.limit == 0 {
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
        }
        match plan {
            LogicalPlan::Join(mut join) => {
                let right_column = join
                    .on
                    .iter()
                    .filter_map(|(_, r)| {
                        if let Expr::Column(col) = r {
                            Some(col.clone())
                        } else {
                            None
                        }
                    })
                    .collect_vec();
                // limit the right side output size
                let mut plan = (*join.right)
                    .clone()
                    .rewrite(&mut AddSortAndLimit::new(self.limit, 0))?
                    .data;
                if !right_column.is_empty() {
                    // deduplication on join key
                    plan = plan
                        .rewrite(&mut DeduplicationRewriter::new(right_column))?
                        .data;
                }
                join.right = Arc::new(plan);
                Ok(Transformed::yes(LogicalPlan::Join(join)))
            }
            _ => Ok(Transformed::no(plan)),
        }
    }
}

struct DeduplicationRewriter {
    pub deduplication_columns: Vec<Column>,
}

impl DeduplicationRewriter {
    pub fn new(deduplication_columns: Vec<Column>) -> Self {
        Self {
            deduplication_columns,
        }
    }
}

impl TreeNodeRewriter for DeduplicationRewriter {
    type Node = LogicalPlan;

    fn f_down(&mut self, node: LogicalPlan) -> Result<Transformed<LogicalPlan>> {
        if is_contain_deduplication_plan(&node) {
            return Ok(Transformed::new(node, false, TreeNodeRecursion::Stop));
        }

        // insert deduplication to first plan that contains deduplication columns
        let plan = match node {
            LogicalPlan::Projection(_) | LogicalPlan::SubqueryAlias(_) => {
                let schema = node.inputs().first().unwrap().schema();
                for column in self.deduplication_columns.iter() {
                    if schema.field_with_name(None, column.name()).is_err() {
                        let plan = generate_deduplication_plan(
                            Arc::new(node),
                            self.deduplication_columns.clone(),
                        );
                        return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
                    }
                }
                Transformed::no(node)
            }
            _ => {
                let plan =
                    generate_deduplication_plan(Arc::new(node), self.deduplication_columns.clone());
                Transformed::new(plan, true, TreeNodeRecursion::Stop)
            }
        };

        Ok(plan)
    }
}

fn generate_deduplication_plan(
    node: Arc<LogicalPlan>,
    deduplication_columns: Vec<Column>,
) -> LogicalPlan {
    let mut sort_columns = Vec::with_capacity(deduplication_columns.len() + 1);
    let schema = node.schema().clone();

    for column in deduplication_columns.iter() {
        sort_columns.push(SortExpr {
            expr: col(column.name()),
            asc: false,
            nulls_first: false,
        });
    }

    if schema.field_with_name(None, TIMESTAMP_COL_NAME).is_ok() {
        sort_columns.push(SortExpr {
            expr: col(TIMESTAMP_COL_NAME.to_string()),
            asc: false,
            nulls_first: false,
        });
    }

    // TODO: if the input already has sort with same columns, we should not add sort again
    let sort = LogicalPlan::Sort(Sort {
        expr: sort_columns,
        input: node,
        fetch: None,
    });
    LogicalPlan::Extension(Extension {
        node: Arc::new(DeduplicationLogicalNode::new(sort, deduplication_columns)),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        arrow::record_batch::RecordBatch,
        common::Result,
        datasource::MemTable,
        execution::{runtime_env::RuntimeEnvBuilder, session_state::SessionStateBuilder},
        physical_plan::get_plan_string,
        prelude::{SessionConfig, SessionContext},
    };

    use super::LimitJoinRightSide;
    use crate::service::search::datafusion::planner::extension_planner::OpenobserveQueryPlanner;

    #[tokio::test]
    async fn test_subquery() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(Int64Array::from(vec![1, 2, 3])),
            ],
        )
        .unwrap();

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .build();
        let ctx = SessionContext::new_with_state(state);
        ctx.add_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)));
        let provider1 = MemTable::try_new(schema.clone(), vec![vec![batch.clone()]]).unwrap();
        ctx.register_table("t1", Arc::new(provider1)).unwrap();

        let sql = "SELECT count(*) from t1 where name in (select distinct name from t1)";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let plan = ctx.state().optimize(&plan)?;

        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "ProjectionExec: expr=[count(Int64(1))@0 as count(*)]",
            "  AggregateExec: mode=Final, gby=[], aggr=[count(Int64(1))]",
            "    CoalescePartitionsExec",
            "      AggregateExec: mode=Partial, gby=[], aggr=[count(Int64(1))]",
            "        ProjectionExec: expr=[]",
            "          HashJoinExec: mode=CollectLeft, join_type=LeftSemi, on=[(name@0, name@0)]",
            "            DataSourceExec: partitions=1, partition_sizes=[1]",
            "            RepartitionExec: partitioning=RoundRobinBatch(12), input_partitions=1",
            "              DeduplicationExec: columns: [name@0]",
            "                SortExec: TopK(fetch=50000), expr=[name@0 DESC NULLS LAST], preserve_partitioning=[false]",
            "                  CoalescePartitionsExec",
            "                    AggregateExec: mode=FinalPartitioned, gby=[name@0 as name], aggr=[], lim=[50000]",
            "                      RepartitionExec: partitioning=Hash([name@0], 12), input_partitions=1",
            "                        AggregateExec: mode=Partial, gby=[name@0 as name], aggr=[], lim=[50000]",
            "                          DataSourceExec: partitions=1, partition_sizes=[1]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_two_table() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(Int64Array::from(vec![1, 2, 3])),
            ],
        )
        .unwrap();

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        ctx.add_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)));
        let provider1 = MemTable::try_new(schema.clone(), vec![vec![batch.clone()]]).unwrap();
        let provider2 = MemTable::try_new(schema, vec![vec![batch.clone()], vec![batch]]).unwrap();
        ctx.register_table("t1", Arc::new(provider1)).unwrap();
        ctx.register_table("t2", Arc::new(provider2)).unwrap();

        let sql = "SELECT t1.id from t1 join t2 on t1.id = t2.id";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let plan = ctx.state().optimize(&plan)?;

        // println!("{}", plan.to_string());

        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        // use datafusion::physical_plan::displayable;
        // println!(
        //     "{}",
        //     displayable(physical_plan.as_ref())
        //         .indent(false)
        //         .to_string()
        // );

        let expected = vec![
            "HashJoinExec: mode=CollectLeft, join_type=Inner, on=[(id@0, id@0)], projection=[id@1]",
            "  ProjectionExec: expr=[id@0 as id]",
            "    DeduplicationExec: columns: [id@0]",
            "      SortExec: expr=[id@0 DESC NULLS LAST, _timestamp@1 DESC NULLS LAST], preserve_partitioning=[false]",
            "        SortPreservingMergeExec: [_timestamp@1 DESC NULLS LAST], fetch=50000",
            "          SortExec: TopK(fetch=50000), expr=[_timestamp@1 DESC NULLS LAST], preserve_partitioning=[true]",
            "            DataSourceExec: partitions=2, partition_sizes=[1, 1]",
            "  DataSourceExec: partitions=1, partition_sizes=[1]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_join_three_table() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("usr_id", DataType::Int64, false),
            Field::new("prod_id", DataType::Int64, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(Int64Array::from(vec![4, 5, 6])),
                Arc::new(Int64Array::from(vec![7, 8, 9])),
            ],
        )
        .unwrap();

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_query_planner(Arc::new(OpenobserveQueryPlanner::new()))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        ctx.add_optimizer_rule(Arc::new(LimitJoinRightSide::new(50_000)));
        let provider1 = MemTable::try_new(schema.clone(), vec![vec![batch.clone()]]).unwrap();
        let provider2 = MemTable::try_new(
            schema.clone(),
            vec![vec![batch.clone()], vec![batch.clone()]],
        )
        .unwrap();
        let provider3 = MemTable::try_new(
            schema,
            vec![vec![batch.clone()], vec![batch.clone()], vec![batch]],
        )
        .unwrap();
        ctx.register_table("t1", Arc::new(provider1)).unwrap();
        ctx.register_table("t2", Arc::new(provider2)).unwrap();
        ctx.register_table("t3", Arc::new(provider3)).unwrap();

        let sql = "SELECT t1.usr_id, t2.prod_id from t1 join t2 on t1.usr_id = t2.usr_id join t3 on t2.prod_id = t3.prod_id";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let plan = ctx.state().optimize(&plan)?;

        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        let expected = vec![
            "HashJoinExec: mode=CollectLeft, join_type=Inner, on=[(prod_id@1, prod_id@0)], projection=[usr_id@0, prod_id@1]",
            "  ProjectionExec: expr=[usr_id@1 as usr_id, prod_id@0 as prod_id]",
            "    HashJoinExec: mode=CollectLeft, join_type=Inner, on=[(usr_id@0, usr_id@0)], projection=[prod_id@1, usr_id@2]",
            "      ProjectionExec: expr=[usr_id@0 as usr_id, prod_id@1 as prod_id]",
            "        DeduplicationExec: columns: [usr_id@0]",
            "          SortExec: expr=[usr_id@0 DESC NULLS LAST, _timestamp@2 DESC NULLS LAST], preserve_partitioning=[false]",
            "            SortPreservingMergeExec: [_timestamp@2 DESC NULLS LAST], fetch=50000",
            "              SortExec: TopK(fetch=50000), expr=[_timestamp@2 DESC NULLS LAST], preserve_partitioning=[true]",
            "                DataSourceExec: partitions=2, partition_sizes=[1, 1]",
            "      DataSourceExec: partitions=1, partition_sizes=[1]",
            "  ProjectionExec: expr=[prod_id@0 as prod_id]",
            "    DeduplicationExec: columns: [prod_id@0]",
            "      SortExec: expr=[prod_id@0 DESC NULLS LAST, _timestamp@1 DESC NULLS LAST], preserve_partitioning=[false]",
            "        SortPreservingMergeExec: [_timestamp@1 DESC NULLS LAST], fetch=50000",
            "          SortExec: TopK(fetch=50000), expr=[_timestamp@1 DESC NULLS LAST], preserve_partitioning=[true]",
            "            DataSourceExec: partitions=3, partition_sizes=[1, 1, 1]",
        ];

        assert_eq!(expected, get_plan_string(&physical_plan));

        Ok(())
    }
}

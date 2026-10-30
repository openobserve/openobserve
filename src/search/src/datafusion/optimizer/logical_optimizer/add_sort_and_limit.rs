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

use config::meta::stream::StreamType;
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion},
    },
    logical_expr::LogicalPlan,
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder},
};

use crate::datafusion::optimizer::utils::{AddSortAndLimit, is_empty_relation};

#[derive(Debug)]
pub struct AddSortAndLimitRule {
    limit: usize,
    offset: usize,
    stream_type: StreamType,
}

impl AddSortAndLimitRule {
    pub fn new(limit: usize, offset: usize, stream_type: StreamType) -> Self {
        Self {
            limit,
            offset,
            stream_type,
        }
    }
}

impl OptimizerRule for AddSortAndLimitRule {
    fn name(&self) -> &str {
        "add_sort_and_limit"
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
        if self.limit == 0 || is_empty_relation(&plan) {
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
        }
        let mut plan = plan.rewrite(&mut AddSortAndLimit::new(
            self.limit,
            self.offset,
            self.stream_type,
        ))?;
        plan.tnr = TreeNodeRecursion::Stop;
        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, StringArray, UInt64Array};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::stream::StreamType;
    use datafusion::{
        arrow::record_batch::RecordBatch,
        assert_batches_eq,
        common::tree_node::TreeNode,
        datasource::{MemTable, TableProvider},
        physical_plan::{collect, displayable},
        prelude::SessionContext,
    };

    use super::AddSortAndLimitRule;
    use crate::datafusion::{
        distributed_plan::ReplaceTableScanExec, table_provider::empty_table::NewEmptyTable,
    };

    #[tokio::test]
    async fn test_real_sql_for_timestamp() {
        let sqls = [
            (
                "select name from t order by _timestamp ASC",
                vec![
                    "+-------------+",
                    "| name        |",
                    "+-------------+",
                    "| openobserve |",
                    "| observe     |",
                    "+-------------+",
                ],
            ),
            (
                "select * from t",
                vec![
                    "+------------+------+",
                    "| _timestamp | name |",
                    "+------------+------+",
                    "| 5          | o2   |",
                    "| 4          | oo   |",
                    "+------------+------+",
                ],
            ),
            (
                "select * from t limit 3",
                vec![
                    "+------------+-------------+",
                    "| _timestamp | name        |",
                    "+------------+-------------+",
                    "| 5          | o2          |",
                    "| 4          | oo          |",
                    "| 3          | openobserve |",
                    "+------------+-------------+",
                ],
            ),
            (
                "select name from t limit 3",
                vec![
                    "+-------------+",
                    "| name        |",
                    "+-------------+",
                    "| o2          |",
                    "| oo          |",
                    "| openobserve |",
                    "+-------------+",
                ],
            ),
            (
                "select name from t where name = 'openobserve' limit 3",
                vec![
                    "+-------------+",
                    "| name        |",
                    "+-------------+",
                    "| openobserve |",
                    "| openobserve |",
                    "+-------------+",
                ],
            ),
            (
                "select * from t where _timestamp > 2 and name != 'oo'",
                vec![
                    "+------------+-------------+",
                    "| _timestamp | name        |",
                    "+------------+-------------+",
                    "| 5          | o2          |",
                    "| 3          | openobserve |",
                    "+------------+-------------+",
                ],
            ),
            (
                "select count(*) from t",
                vec![
                    "+----------+",
                    "| count(*) |",
                    "+----------+",
                    "| 5        |",
                    "+----------+",
                ],
            ),
            (
                "select name, count(*) as cnt from t group by name order by cnt desc, name desc",
                vec![
                    "+-------------+-----+",
                    "| name        | cnt |",
                    "+-------------+-----+",
                    "| openobserve | 2   |",
                    "| oo          | 1   |",
                    "+-------------+-----+",
                ],
            ),
        ];

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        // define data.
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

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.add_optimizer_rule(Arc::new(AddSortAndLimitRule::new(2, 0, StreamType::Logs)));

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_metrics_default_sort_over_hash_ordered_input() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("__hash__", DataType::UInt64, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![10, 30, 20, 40])),
                Arc::new(UInt64Array::from(vec![1, 1, 2, 2])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let placeholder = NewEmptyTable::new("metrics", schema.clone());
        ctx.register_table("metrics", Arc::new(placeholder))
            .unwrap();
        ctx.add_optimizer_rule(Arc::new(AddSortAndLimitRule::new(
            2,
            0,
            StreamType::Metrics,
        )));

        let data = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        let data_scan = data.scan(&ctx.state(), None, &[], None).await.unwrap();
        let expected = [
            "+------------+----------+",
            "| _timestamp | __hash__ |",
            "+------------+----------+",
            "| 40         | 2        |",
            "| 30         | 1        |",
            "+------------+----------+",
        ];

        for sql in [
            "SELECT * FROM metrics",
            "SELECT * FROM metrics ORDER BY _timestamp DESC",
        ] {
            let logical_plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx
                .state()
                .create_physical_plan(&logical_plan)
                .await
                .unwrap();
            let plan = displayable(physical_plan.as_ref()).indent(true).to_string();
            assert!(
                plan.contains("SortExec:"),
                "hash-ordered input still needs a timestamp sort:\n{plan}"
            );

            let mut rewriter = ReplaceTableScanExec::new(data_scan.clone());
            let executable_plan = physical_plan.rewrite(&mut rewriter).unwrap().data;
            let batches = collect(executable_plan, ctx.task_ctx()).await.unwrap();
            assert_batches_eq!(expected, &batches);
        }

        let logical_plan = ctx
            .state()
            .create_logical_plan("SELECT __hash__ FROM metrics")
            .await
            .unwrap();
        let physical_plan = ctx
            .state()
            .create_physical_plan(&logical_plan)
            .await
            .unwrap();
        let plan = displayable(physical_plan.as_ref()).indent(true).to_string();
        assert!(plan.contains("SortExec:"), "{plan}");

        let projection = vec![1, 0];
        let projected_data_scan = data
            .scan(&ctx.state(), Some(&projection), &[], None)
            .await
            .unwrap();
        let mut rewriter = ReplaceTableScanExec::new(projected_data_scan);
        let executable_plan = physical_plan.rewrite(&mut rewriter).unwrap().data;
        let batches = collect(executable_plan, ctx.task_ctx()).await.unwrap();
        assert_batches_eq!(
            [
                "+----------+",
                "| __hash__ |",
                "+----------+",
                "| 2        |",
                "| 1        |",
                "+----------+",
            ],
            &batches
        );
    }

    #[tokio::test]
    async fn test_default_sort_keeps_timestamp_order_optimization_for_logs() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));
        let ctx = SessionContext::new();
        ctx.register_table("logs", Arc::new(NewEmptyTable::new("logs", schema)))
            .unwrap();
        ctx.add_optimizer_rule(Arc::new(AddSortAndLimitRule::new(2, 0, StreamType::Logs)));

        let logical_plan = ctx
            .state()
            .create_logical_plan("SELECT * FROM logs")
            .await
            .unwrap();
        let physical_plan = ctx
            .state()
            .create_physical_plan(&logical_plan)
            .await
            .unwrap();
        let plan = displayable(physical_plan.as_ref()).indent(true).to_string();

        assert!(plan.contains("sort_order=timestamp_desc"), "{plan}");
        assert!(!plan.contains("SortExec:"), "{plan}");
    }

    #[test]
    fn test_add_sort_and_limit_rule_new_metadata() {
        use datafusion::optimizer::OptimizerRule;
        let rule = AddSortAndLimitRule::new(10, 5, StreamType::Logs);
        assert_eq!(rule.name(), "add_sort_and_limit");
        assert_eq!(
            rule.apply_order(),
            Some(datafusion::optimizer::optimizer::ApplyOrder::TopDown)
        );
    }

    #[test]
    fn test_add_sort_and_limit_rule_new_zero_limit() {
        let rule = AddSortAndLimitRule::new(0, 0, StreamType::Logs);
        use datafusion::optimizer::OptimizerRule;
        assert_eq!(rule.name(), "add_sort_and_limit");
    }
}

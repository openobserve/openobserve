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

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_plan::{ExecutionPlan, aggregates::AggregateExec},
};

use crate::service::search::datafusion::optimizer::physical_optimizer::index_optimizer::utils::is_complex_plan;

#[rustfmt::skip]
/// check if the plan is like:
/// select count(*) from stream
/// or select count(*) as cnt from stream
/// example plan:
///   ProjectionExec: expr=[count(Int64(1))@0 as count(*)]
///     GlobalLimitExec: skip=0, fetch=100
///       AggregateExec: mode=Final, gby=[], aggr=[count(Int64(1))]
///         CoalescePartitionsExec
///           AggregateExec: mode=Partial, gby=[], aggr=[count(Int64(1))]
///             ProjectionExec: expr=[]
///               CoalesceBatchesExec: target_batch_size=8192
///                 FilterExec: _timestamp@0 >= 175256100000000 AND _timestamp@0 < 17525610000000000
///                   CooperativeExec
///                     NewEmptyExec: name="default"
pub(crate) fn is_simple_count(plan: Arc<dyn ExecutionPlan>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleCountVisitor::new();
    let _ = plan.visit(&mut visitor);
    if visitor.is_simple_count {
        Some(IndexOptimizeMode::SimpleCount)
    } else {
        None
    }
}

struct SimpleCountVisitor {
    pub is_simple_count: bool,
}

impl SimpleCountVisitor {
    pub fn new() -> Self {
        Self {
            is_simple_count: false,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleCountVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            if aggregate.group_expr().is_empty()
                && aggregate.aggr_expr().len() == 1
                && aggregate.aggr_expr()[0].name() == "count(Int64(1))"
            {
                self.is_simple_count = true;
            } else {
                self.is_simple_count = false;
                return Ok(TreeNodeRecursion::Stop);
            }
        } else if is_complex_plan(node) {
            // if encounter complex plan, stop visiting
            self.is_simple_count = false;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{common::Result, prelude::SessionContext};

    use super::*;
    use crate::service::search::datafusion::table_provider::empty_table::NewEmptyTable;

    #[tokio::test]
    async fn test_is_simple_count() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let ctx = SessionContext::new();
        let provider = NewEmptyTable::new("t", schema);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let cases = vec![
            (
                "SELECT count(*) from t",
                Some(IndexOptimizeMode::SimpleCount),
            ),
            (
                "SELECT count(*) as cnt from t",
                Some(IndexOptimizeMode::SimpleCount),
            ),
            ("SELECT name, count(*) as cnt from t group by name", None),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await?;
            let physical_plan = ctx.state().create_physical_plan(&plan).await?;

            assert_eq!(expected, is_simple_count(physical_plan));
        }

        Ok(())
    }
}

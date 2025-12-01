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
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_expr::{ScalarFunctionExpr, split_conjunction},
    physical_plan::{
        ExecutionPlan, PhysicalExpr, aggregates::AggregateExec, filter::FilterExec,
        projection::ProjectionExec, sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
};

use crate::service::search::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan,
    utils::{get_column_name, is_column, is_only_timestamp_filter},
};

#[rustfmt::skip]
/// SimpleDistinct(String, usize, bool):
/// the sql can like: select name from table where str_match(name, 'a') group by name order by name asc limit 10;
///                   or select name as key from table where str_match(name, 'a') group by key order by key desc limit 10;
/// condition：name is index field, group by name (or alias), order by name (or alias), have limit, and where only the str_match()(expect _timestamp)
/// example plan:
///   SortPreservingMergeExec: [kubernetes_namespace_name@0 ASC NULLS LAST], fetch=10
///     SortExec: TopK(fetch=10), expr=[kubernetes_namespace_name@0 ASC NULLS LAST], preserve_partitioning=[true]
///       AggregateExec: mode=FinalPartitioned, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[]
///         CoalesceBatchesExec: target_batch_size=8192
///           RepartitionExec: partitioning=Hash([kubernetes_namespace_name@0], 12), input_partitions=12
///             AggregateExec: mode=Partial, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[]
///               CoalesceBatchesExec: target_batch_size=8192
///                 FilterExec: _timestamp@0 >= 17296550822151 AND _timestamp@0 < 172965508891538700, projection=[kubernetes_namespace_name@1]
///                   CooperativeExec
///                     NewEmptyExec: name="default", projection=["_timestamp", "kubernetes_namespace_name"]
pub(crate) fn is_simple_distinct(plan: Arc<dyn ExecutionPlan>, index_fields: HashSet<String>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleDistinctVisitor::new(index_fields);
    let _ = plan.visit(&mut visitor);
    if let Some((field, fetch, ascend)) = visitor.simple_distinct {
            Some(IndexOptimizeMode::SimpleDistinct(
                    field,
                    fetch,
                    ascend,
                ))
    } else {
        None
    }
}

struct SimpleDistinctVisitor {
    pub simple_distinct: Option<(String, usize, bool)>,
    pub index_fields: HashSet<String>,
}

impl SimpleDistinctVisitor {
    pub fn new(index_fields: HashSet<String>) -> Self {
        Self {
            simple_distinct: None,
            index_fields,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleDistinctVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(sort_merge) = node.as_any().downcast_ref::<SortPreservingMergeExec>() {
            if let Some(fetch) = sort_merge.fetch()
                && fetch > 0
                && sort_merge.expr().len() == 1
                && sort_merge.expr().iter().collect::<Vec<_>>().len() == 1
                && is_column(&sort_merge.expr().first().expr)
            {
                self.simple_distinct = Some((
                    "".to_string(), // Will be set when we find the group by field
                    fetch,
                    !sort_merge.expr().first().options.descending,
                ));
                return Ok(TreeNodeRecursion::Continue);
            }
            // if not simple distinct, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // check if the group by is simple distinct,
            // only one group by field, no aggregate function
            if aggregate.group_expr().expr().len() == 1
                && aggregate.aggr_expr().is_empty()
                && let Some((group_expr, _)) = aggregate.group_expr().expr().first()
            {
                let column_name = get_column_name(group_expr);
                if is_column(group_expr) && self.index_fields.contains(column_name) {
                    // Update the simple_distinct with the correct field name
                    if let Some(simple_distinct) = &mut self.simple_distinct {
                        self.simple_distinct = Some((
                            column_name.to_string(),
                            simple_distinct.1,
                            simple_distinct.2,
                        ));
                    }
                    return Ok(TreeNodeRecursion::Continue);
                }
            }
            // if not simple distinct, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.as_any().downcast_ref::<ProjectionExec>() {
            // Check ProjectionExec for the structure: [index_field]
            let exprs = projection.expr();
            if exprs.len() == 1 {
                // First expression should be the index field
                // We'll validate this in the AggregateExec
                return Ok(TreeNodeRecursion::Continue);
            }
            // If projection doesn't have exactly 2 expressions, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(filter) = node.as_any().downcast_ref::<FilterExec>() {
            let predicate = filter.predicate();
            let exprs = split_conjunction(predicate);
            if exprs.len() == 2 && is_only_timestamp_filter(&exprs) {
                return Ok(TreeNodeRecursion::Continue);
            }
            if exprs.len() == 3
                && is_only_timestamp_filter(&exprs[1..])
                && let Some(column_name) = is_simple_str_match(exprs[0])
                && self.index_fields.contains(&column_name)
            {
                return Ok(TreeNodeRecursion::Continue);
            }
            // If projection doesn't have exactly 2 expressions, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if is_complex_plan(node) {
            // if encounter complex plan, stop visiting
            self.simple_distinct = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

fn is_simple_str_match(expr: &Arc<dyn PhysicalExpr>) -> Option<String> {
    if let Some(func) = expr.as_any().downcast_ref::<ScalarFunctionExpr>()
        && func.fun().name().to_lowercase() == "str_match"
        && func.args().len() == 2
    {
        Some(get_column_name(&func.args()[0]).to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{catalog::MemTable, prelude::SessionContext};

    use super::*;
    use crate::service::search::datafusion::udf::str_match_udf;

    #[tokio::test]
    async fn test_is_simple_distinct() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["openobserve"])),
                Arc::new(StringArray::from(vec!["1"])),
                Arc::new(StringArray::from(vec!["success"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch.clone()], vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(str_match_udf::STR_MATCH_UDF.clone());

        // sql, can_optimizer, except_condition
        let cases = vec![
            (
                "select name from t where str_match(name, 'a') and _timestamp >= 175256100000000 and _timestamp < 17525610000000000 group by name order by name asc limit 10",
                Some(IndexOptimizeMode::SimpleDistinct(
                    "name".to_string(),
                    10,
                    true,
                )),
            ),
            (
                "select name from t where str_match(name, 'a') and _timestamp >= 175256100000000 and _timestamp < 17525610000000000 group by name order by name desc limit 10",
                Some(IndexOptimizeMode::SimpleDistinct(
                    "name".to_string(),
                    10,
                    false,
                )),
            ),
            (
                "select name as key from t where str_match(name, 'a') and _timestamp >= 175256100000000 and _timestamp < 17525610000000000 group by key order by key desc limit 10",
                Some(IndexOptimizeMode::SimpleDistinct(
                    "name".to_string(),
                    10,
                    false,
                )),
            ),
            (
                "select id from t where _timestamp >= 175256100000000 and _timestamp < 17525610000000000 group by id order by id asc limit 10",
                Some(IndexOptimizeMode::SimpleDistinct(
                    "id".to_string(),
                    10,
                    true,
                )),
            ),
            ("SELECT count(*) from t", None),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
            assert_eq!(expected, is_simple_distinct(physical_plan, index_fields));
        }
    }
}

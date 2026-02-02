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
    physical_plan::{
        ExecutionPlan, aggregates::AggregateExec, projection::ProjectionExec,
        sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
};

use crate::service::search::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan,
    utils::{get_column_name, is_column},
};

#[rustfmt::skip]
/// SimpleTopN(String, usize, bool):
/// the sql can like: select name, count(*) as cnt from table where match_all() group by name order by cnt desc limit 10;
///                   or select name as key, count(*) as cnt from table where match_all() group by key order by cnt desc limit 10;
///                   or select name as key, count(*) as cnt from table where match_all() group by key order by cnt desc, key asc limit 10;
/// condition: only select a index_field, and only have count(*) as aggregate function, group by the index_field in select clause,
/// order by count(*) [, key asc], and have limit (secondary sort on key is optional and must be ASC if present)
/// example plan:
///   SortPreservingMergeExec: [cnt@1 DESC], fetch=10
///     SortExec: TopK(fetch=10), expr=[cnt@1 DESC], preserve_partitioning=[true]
///       ProjectionExec: expr=[kubernetes_namespace_name@0 as kubernetes_namespace_name, count(Int64(1))@1 as cnt]
///         AggregateExec: mode=FinalPartitioned, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[count(Int64(1))]
///           CoalesceBatchesExec: target_batch_size=8192
///             RepartitionExec: partitioning=Hash([kubernetes_namespace_name@0], 12), input_partitions=12
///               AggregateExec: mode=Partial, gby=[kubernetes_namespace_name@0 as kubernetes_namespace_name], aggr=[count(Int64(1))]
///                 CoalesceBatchesExec: target_batch_size=8192
///                   FilterExec: _timestamp@0 >= 175256100000000 AND _timestamp@0 < 17525610000000000, projection=[kubernetes_namespace_name@1]
///                     CooperativeExec
///                       NewEmptyExec: name="default", projection=["_timestamp", "kubernetes_namespace_name"]
pub(crate) fn is_simple_topn(plan: Arc<dyn ExecutionPlan>, index_fields: HashSet<String>) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleTopnVisitor::new(index_fields);
    let _ = plan.visit(&mut visitor);
    if let Some((field, fetch, ascend)) = visitor.simple_topn {
        if field.is_empty() {
            return None;
        }
        Some(IndexOptimizeMode::SimpleTopN(
            field,
            fetch,
            ascend,
        ))
    } else {
        None
    }
}

struct SimpleTopnVisitor {
    pub simple_topn: Option<(String, usize, bool)>,
    index_fields: HashSet<String>,
    secondary_sort_column: Option<String>,
}

impl SimpleTopnVisitor {
    pub fn new(index_fields: HashSet<String>) -> Self {
        Self {
            simple_topn: None,
            index_fields,
            secondary_sort_column: None,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleTopnVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(sort_merge) = node.as_any().downcast_ref::<SortPreservingMergeExec>() {
            // Check if this is a SortPreservingMergeExec with fetch limit
            if let Some(fetch) = sort_merge.fetch()
                && fetch > 0
                && !sort_merge.expr().is_empty()
                && sort_merge.expr().len() <= 2
            {
                // the first sort should be on the count(*) result, not directly on an index field
                // should not sort by index field as primary sort
                let sort_expr = sort_merge.expr().first();
                let column_name = get_column_name(&sort_expr.expr);
                if is_column(&sort_expr.expr) && self.index_fields.contains(column_name) {
                    self.simple_topn = None;
                    return Ok(TreeNodeRecursion::Stop);
                }

                // If there's a secondary sort, it should be ASC (not descending)
                if sort_merge.expr().len() == 2 {
                    let secondary_sort = &sort_merge.expr()[1];
                    // Secondary sort must be ASC (not descending) and should be a column
                    if secondary_sort.options.descending || !is_column(&secondary_sort.expr) {
                        self.simple_topn = None;
                        return Ok(TreeNodeRecursion::Stop);
                    }
                    // Store the secondary sort column name to validate later in AggregateExec
                    self.secondary_sort_column =
                        Some(get_column_name(&secondary_sort.expr).to_string());
                }

                self.simple_topn = Some((
                    "".to_string(), // Will be set when we find the group by field
                    fetch,
                    !sort_merge.expr().first().options.descending,
                ));
                return Ok(TreeNodeRecursion::Continue);
            }
            // If not a valid SortPreservingMergeExec, stop visiting
            self.simple_topn = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.as_any().downcast_ref::<ProjectionExec>() {
            // Check ProjectionExec for the structure: [index_field, count(*)]
            let exprs = projection.expr();
            if exprs.len() == 2 {
                // First expression should be the index field, second should be count(*)
                // If we have a secondary sort column, validate it matches the first projection
                // column alias
                if let Some(secondary_col) = &self.secondary_sort_column {
                    let first_alias = &exprs[0].alias;
                    if secondary_col != first_alias {
                        // Secondary sort doesn't match the grouped field
                        self.simple_topn = None;
                        return Ok(TreeNodeRecursion::Stop);
                    }
                }
                return Ok(TreeNodeRecursion::Continue);
            }
            // If projection doesn't have exactly 2 expressions, stop visiting
            self.simple_topn = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // Check if the AggregateExec matches SimpleTopN pattern
            if aggregate.group_expr().expr().len() == 1 && aggregate.aggr_expr().len() == 1 {
                // Check group by field
                if let Some((group_expr, _)) = aggregate.group_expr().expr().first() {
                    let column_name = get_column_name(group_expr);
                    if is_column(group_expr) && self.index_fields.contains(column_name) {
                        // Check aggregate function is count(*)
                        let aggr_expr = &aggregate.aggr_expr()[0];
                        if aggr_expr.name() == "count(Int64(1))" {
                            // Update the simple_topn with the correct field name
                            if let Some(simple_topn) = &mut self.simple_topn {
                                self.simple_topn =
                                    Some((column_name.to_string(), simple_topn.1, simple_topn.2));
                            }

                            return Ok(TreeNodeRecursion::Continue);
                        }
                    }
                }
            }
            // If AggregateExec doesn't match SimpleTopN pattern, stop visiting
            self.simple_topn = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if is_complex_plan(node) {
            // If encounter complex plan, stop visiting
            self.simple_topn = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{catalog::MemTable, prelude::SessionContext};

    use super::*;
    use crate::service::search::datafusion::udf::match_all_udf;

    #[tokio::test]
    async fn test_is_simple_topn() {
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
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());

        // sql, can_optimizer, except_condition
        let cases = vec![
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN("name".to_string(), 10, false)),
            ),
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by cnt asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN("name".to_string(), 10, true)),
            ),
            (
                "select name as key, count(*) as cnt from t where match_all('error') group by key order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN("name".to_string(), 10, false)),
            ),
            (
                "select name as key, count(*) as cnt from t where match_all('error') group by key order by cnt desc, key asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN("name".to_string(), 10, false)),
            ),
            // Invalid case: secondary sort with DESC should not optimize
            (
                "select name as key, count(*) as cnt from t where match_all('error') group by key order by cnt desc, key desc limit 10",
                None,
            ),
            // Invalid case: sorting by key only (not count) should not optimize
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by name limit 10",
                None,
            ),
            // Valid case: different index field (id instead of name)
            (
                "select id, count(*) as cnt from t where match_all('error') group by id order by cnt desc limit 5",
                Some(IndexOptimizeMode::SimpleTopN("id".to_string(), 5, false)),
            ),
            // Valid case: with alias and secondary sort
            (
                "select id as identifier, count(*) as total from t where match_all('error') group by identifier order by total desc, identifier asc limit 20",
                Some(IndexOptimizeMode::SimpleTopN("id".to_string(), 20, false)),
            ),
            // Invalid case: no limit
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by cnt desc",
                None,
            ),
            // Invalid case: multiple aggregations (selecting more than 2 columns)
            (
                "select name, count(*) as cnt, count(*) as cnt2 from t where match_all('error') group by name order by cnt desc limit 10",
                None,
            ),
            // Invalid case: group by multiple fields
            (
                "select name, id, count(*) as cnt from t where match_all('error') group by name, id order by cnt desc limit 10",
                None,
            ),
            // Invalid case: wrong aggregate function (not count)
            (
                "select name, max(name) as maximum from t where match_all('error') group by name order by maximum desc limit 10",
                None,
            ),
            ("SELECT count(*) from t", None),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
            assert_eq!(
                expected,
                is_simple_topn(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }

    #[tokio::test]
    async fn test_simple_topn_with_different_limits() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("hostname", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(StringArray::from(vec!["server1", "server2", "server3"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("logs", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());

        let cases = vec![
            // Different limit values
            (
                "select hostname, count(*) as cnt from logs where match_all('error') group by hostname order by cnt desc limit 1",
                Some(IndexOptimizeMode::SimpleTopN(
                    "hostname".to_string(),
                    1,
                    false,
                )),
            ),
            (
                "select hostname, count(*) as cnt from logs where match_all('error') group by hostname order by cnt desc limit 100",
                Some(IndexOptimizeMode::SimpleTopN(
                    "hostname".to_string(),
                    100,
                    false,
                )),
            ),
            (
                "select hostname, count(*) as cnt from logs where match_all('error') group by hostname order by cnt desc limit 1000",
                Some(IndexOptimizeMode::SimpleTopN(
                    "hostname".to_string(),
                    1000,
                    false,
                )),
            ),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from(["hostname".to_string()]);
            assert_eq!(
                expected,
                is_simple_topn(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }

    #[tokio::test]
    async fn test_simple_topn_ascending_order() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("category", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["type_a"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("events", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());

        let cases = vec![
            // Ascending order tests
            (
                "select category, count(*) as cnt from events where match_all('error') group by category order by cnt asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    "category".to_string(),
                    10,
                    true,
                )),
            ),
            (
                "select category as cat, count(*) as cnt from events where match_all('error') group by cat order by cnt asc, cat asc limit 15",
                Some(IndexOptimizeMode::SimpleTopN(
                    "category".to_string(),
                    15,
                    true,
                )),
            ),
            // Mixed: ascending primary sort with ascending secondary sort
            (
                "select category, count(*) as cnt from events where match_all('error') group by category order by cnt asc, category asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    "category".to_string(),
                    10,
                    true,
                )),
            ),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from(["category".to_string()]);
            assert_eq!(
                expected,
                is_simple_topn(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }

    #[tokio::test]
    async fn test_simple_topn_edge_cases() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("service", DataType::Utf8, false),
            Field::new("region", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["api"])),
                Arc::new(StringArray::from(vec!["us-west"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("metrics", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());

        let cases = vec![
            // Valid: field not in index_fields should return None
            (
                "select region, count(*) as cnt from metrics where match_all('error') group by region order by cnt desc limit 10",
                None,
            ),
            // Valid: service is in index_fields
            (
                "select service, count(*) as cnt from metrics where match_all('error') group by service order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    "service".to_string(),
                    10,
                    false,
                )),
            ),
            // Invalid: zero limit should fail (though this might be a syntax error)
            // We'll skip this as it's likely a parse error

            // Invalid: negative limit would be a syntax error, skipping
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from(["service".to_string()]);
            assert_eq!(
                expected,
                is_simple_topn(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }
}

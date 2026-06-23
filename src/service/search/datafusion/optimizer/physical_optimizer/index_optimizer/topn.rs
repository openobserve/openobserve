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

use std::sync::Arc;

use config::meta::inverted_index::{IndexOptimizeMode, MAX_SIMPLE_TOPN_FIELDS};
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
use hashbrown::HashSet;

use crate::service::search::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan,
    utils::{get_column_name, is_column, is_count_rows_aggregate},
};

#[rustfmt::skip]
/// SimpleTopN(Vec<String>, usize, bool):
/// the sql can like: select name, count(*) as cnt from table where match_all() group by name order by cnt desc limit 10;
///                   or select userid, searchphrase, count(*) as cnt from table where match_all() group by userid, searchphrase order by cnt desc, userid asc limit 10;
/// condition: group by 1..=MAX_SIMPLE_TOPN_FIELDS index_fields with count(*) as the only aggregate,
/// order by count(*) first (optional secondary sorts must be ASC group by fields), and have limit
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
    match visitor.simple_topn {
        Some((fields, fetch, ascend)) if !fields.is_empty() => {
            Some(IndexOptimizeMode::SimpleTopN(fields, fetch, ascend))
        }
        _ => None,
    }
}

struct SimpleTopnVisitor {
    pub simple_topn: Option<(Vec<String>, usize, bool)>,
    index_fields: HashSet<String>,
    secondary_sort_columns: Vec<String>,
    projection_len: Option<usize>,
}

impl SimpleTopnVisitor {
    pub fn new(index_fields: HashSet<String>) -> Self {
        Self {
            simple_topn: None,
            index_fields,
            secondary_sort_columns: Vec::new(),
            projection_len: None,
        }
    }

    fn reject(&mut self) -> Result<TreeNodeRecursion> {
        self.simple_topn = None;
        Ok(TreeNodeRecursion::Stop)
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleTopnVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(sort_merge) = node.downcast_ref::<SortPreservingMergeExec>() {
            // need a fetch limit, a primary sort plus up to one secondary sort per group field
            let fetch = sort_merge.fetch().unwrap_or(0);
            let sort_exprs = sort_merge.expr();
            if fetch == 0 || sort_exprs.is_empty() || sort_exprs.len() > MAX_SIMPLE_TOPN_FIELDS + 1
            {
                return self.reject();
            }

            // the primary sort must be on the count(*) result, not on an index field
            let first_sort = sort_exprs.first();
            if is_column(&first_sort.expr)
                && self
                    .index_fields
                    .contains(get_column_name(&first_sort.expr))
            {
                return self.reject();
            }

            // secondary sorts must be ASC columns; their names are validated against the
            // group by fields at the ProjectionExec
            for sort in sort_exprs.iter().skip(1) {
                if sort.options.descending || !is_column(&sort.expr) {
                    return self.reject();
                }
                self.secondary_sort_columns
                    .push(get_column_name(&sort.expr).to_string());
            }

            // fields are filled in at the AggregateExec
            self.simple_topn = Some((vec![], fetch, !first_sort.options.descending));
        } else if let Some(projection) = node.downcast_ref::<ProjectionExec>() {
            // expect [field1, .., fieldN, count(*)]; the exact length is validated against
            // the group by at the AggregateExec
            let exprs = projection.expr();
            if !(2..=MAX_SIMPLE_TOPN_FIELDS + 1).contains(&exprs.len()) {
                return self.reject();
            }
            self.projection_len = Some(exprs.len());

            // secondary sorts must reference the group by fields (the leading projection aliases)
            let group_aliases: HashSet<&str> = exprs[..exprs.len() - 1]
                .iter()
                .map(|expr| expr.alias.as_str())
                .collect();
            if self
                .secondary_sort_columns
                .iter()
                .any(|col| !group_aliases.contains(col.as_str()))
            {
                return self.reject();
            }
        } else if let Some(aggregate) = node.downcast_ref::<AggregateExec>() {
            let group_len = aggregate.group_expr().expr().len();
            if !(1..=MAX_SIMPLE_TOPN_FIELDS).contains(&group_len)
                || aggregate.aggr_expr().len() != 1
                || !is_count_rows_aggregate(&aggregate.aggr_expr()[0])
                // the projection (if any) should be exactly the group by fields + count(*)
                || self.projection_len.is_some_and(|len| len != group_len + 1)
            {
                return self.reject();
            }

            // all group by fields must be index fields
            let mut fields = Vec::with_capacity(group_len);
            for (group_expr, _) in aggregate.group_expr().expr().iter() {
                let column_name = get_column_name(group_expr);
                if !is_column(group_expr) || !self.index_fields.contains(column_name) {
                    return self.reject();
                }
                fields.push(column_name.to_string());
            }
            if let Some(simple_topn) = &mut self.simple_topn {
                simple_topn.0 = fields;
            }
        } else if is_complex_plan(node) {
            return self.reject();
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
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string()],
                    10,
                    false,
                )),
            ),
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by cnt asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string()],
                    10,
                    true,
                )),
            ),
            (
                "select name, count(_timestamp) as cnt from t where match_all('error') group by name order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string()],
                    10,
                    false,
                )),
            ),
            (
                "select name as key, count(*) as cnt from t where match_all('error') group by key order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string()],
                    10,
                    false,
                )),
            ),
            (
                "select name as key, count(*) as cnt from t where match_all('error') group by key order by cnt desc, key asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string()],
                    10,
                    false,
                )),
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
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["id".to_string()],
                    5,
                    false,
                )),
            ),
            // Valid case: with alias and secondary sort
            (
                "select id as identifier, count(*) as total from t where match_all('error') group by identifier order by total desc, identifier asc limit 20",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["id".to_string()],
                    20,
                    false,
                )),
            ),
            // Invalid case: no limit
            (
                "select name, count(*) as cnt from t where match_all('error') group by name order by cnt desc",
                None,
            ),
            // Invalid case: multiple aggregations (selecting more than group fields + count)
            (
                "select name, count(*) as cnt, count(*) as cnt2 from t where match_all('error') group by name order by cnt desc limit 10",
                None,
            ),
            // Valid case: group by multiple index fields
            (
                "select name, id, count(*) as cnt from t where match_all('error') group by name, id order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["name".to_string(), "id".to_string()],
                    10,
                    false,
                )),
            ),
            // Invalid case: wrong aggregate function (not count)
            (
                "select name, max(name) as maximum from t where match_all('error') group by name order by maximum desc limit 10",
                None,
            ),
            // Invalid case: count over a nullable/non-timestamp field is not equivalent to
            // count(*)
            (
                "select name, count(id) as cnt from t where match_all('error') group by name order by cnt desc limit 10",
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
    async fn test_is_simple_topn_multi_fields() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("userid", DataType::Utf8, false),
            Field::new("searchphrase", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
            Field::new("region", DataType::Utf8, false),
            Field::new("zone", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["user1"])),
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(StringArray::from(vec!["success"])),
                Arc::new(StringArray::from(vec!["us-west"])),
                Arc::new(StringArray::from(vec!["a"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch.clone()], vec![batch]]).unwrap();
        ctx.register_table("hits", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());

        let cases = vec![
            // Valid: two-field GROUP BY with count(*) ORDER BY cnt DESC LIMIT 10
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["userid".to_string(), "searchphrase".to_string()],
                    10,
                    false,
                )),
            ),
            // Valid: two-field GROUP BY with count(*) ORDER BY cnt ASC LIMIT 5
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt asc limit 5",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["userid".to_string(), "searchphrase".to_string()],
                    5,
                    true,
                )),
            ),
            // Valid: three-field GROUP BY with count(*)
            (
                "select userid, searchphrase, status, count(*) as cnt from hits where match_all('error') group by userid, searchphrase, status order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec![
                        "userid".to_string(),
                        "searchphrase".to_string(),
                        "status".to_string(),
                    ],
                    10,
                    false,
                )),
            ),
            // Valid: four-field GROUP BY with count(*)
            (
                "select userid, searchphrase, status, region, count(*) as cnt from hits where match_all('error') group by userid, searchphrase, status, region order by cnt desc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec![
                        "userid".to_string(),
                        "searchphrase".to_string(),
                        "status".to_string(),
                        "region".to_string(),
                    ],
                    10,
                    false,
                )),
            ),
            // Invalid: five-field GROUP BY exceeds MAX_SIMPLE_TOPN_FIELDS
            (
                "select userid, searchphrase, status, region, zone, count(*) as cnt from hits where match_all('error') group by userid, searchphrase, status, region, zone order by cnt desc limit 10",
                None,
            ),
            // Valid: secondary sorts on group by fields (ASC)
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt desc, userid asc, searchphrase asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["userid".to_string(), "searchphrase".to_string()],
                    10,
                    false,
                )),
            ),
            // Invalid: secondary sort with DESC should not optimize
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt desc, userid desc limit 10",
                None,
            ),
            // Invalid: one field not in index
            (
                "select userid, _timestamp, count(*) as cnt from hits where match_all('error') group by userid, _timestamp order by cnt desc limit 10",
                None,
            ),
            // Invalid: no limit
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt desc",
                None,
            ),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();

            let index_fields = HashSet::from([
                "userid".to_string(),
                "searchphrase".to_string(),
                "status".to_string(),
                "region".to_string(),
                "zone".to_string(),
            ]);
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
                    vec!["hostname".to_string()],
                    1,
                    false,
                )),
            ),
            (
                "select hostname, count(*) as cnt from logs where match_all('error') group by hostname order by cnt desc limit 100",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["hostname".to_string()],
                    100,
                    false,
                )),
            ),
            (
                "select hostname, count(*) as cnt from logs where match_all('error') group by hostname order by cnt desc limit 1000",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["hostname".to_string()],
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
                    vec!["category".to_string()],
                    10,
                    true,
                )),
            ),
            (
                "select category as cat, count(*) as cnt from events where match_all('error') group by cat order by cnt asc, cat asc limit 15",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["category".to_string()],
                    15,
                    true,
                )),
            ),
            // Mixed: ascending primary sort with ascending secondary sort
            (
                "select category, count(*) as cnt from events where match_all('error') group by category order by cnt asc, category asc limit 10",
                Some(IndexOptimizeMode::SimpleTopN(
                    vec!["category".to_string()],
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
                    vec!["service".to_string()],
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

    #[test]
    fn test_simple_topn_visitor_initial_state() {
        let fields = HashSet::from(["service".to_string()]);
        let visitor = SimpleTopnVisitor::new(fields.clone());
        assert!(visitor.simple_topn.is_none());
        assert!(visitor.secondary_sort_columns.is_empty());
        assert!(visitor.projection_len.is_none());
        assert_eq!(visitor.index_fields, fields);
    }

    #[test]
    fn test_simple_topn_visitor_empty_index_fields() {
        let fields: HashSet<String> = HashSet::new();
        let visitor = SimpleTopnVisitor::new(fields.clone());
        assert!(visitor.simple_topn.is_none());
        assert!(visitor.secondary_sort_columns.is_empty());
        assert!(visitor.index_fields.is_empty());
    }

    #[test]
    fn test_simple_topn_visitor_multiple_index_fields() {
        let fields = HashSet::from(["service".to_string(), "host".to_string(), "pod".to_string()]);
        let visitor = SimpleTopnVisitor::new(fields.clone());
        assert_eq!(visitor.index_fields.len(), 3);
        assert!(visitor.index_fields.contains("service"));
        assert!(visitor.index_fields.contains("host"));
        assert!(visitor.index_fields.contains("pod"));
    }
}

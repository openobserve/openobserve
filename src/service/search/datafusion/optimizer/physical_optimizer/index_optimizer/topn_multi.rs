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

use std::{collections::HashSet, sync::Arc};

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

use crate::service::search::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan,
    utils::{get_column_name, is_column},
};

/// SimpleTopN(Vec<String>, usize, bool) for multi-field group by:
/// Supports multi-field (2..=4) GROUP BY queries like:
///   SELECT userid, searchphrase, COUNT(*) as cnt FROM hits GROUP BY userid, searchphrase ORDER BY
/// cnt DESC LIMIT 10;
/// condition: select 2..=4 index_fields and only have count(*) as aggregate function,
/// group by those index_fields in select clause, order by count(*), and have limit
pub(crate) fn is_simple_topn_multi(
    plan: Arc<dyn ExecutionPlan>,
    index_fields: HashSet<String>,
) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleTopnMultiVisitor::new(index_fields);
    let _ = plan.visit(&mut visitor);
    if let Some((fields, fetch, ascend)) = visitor.simple_topn_multi {
        if fields.len() < 2 || fields.len() > MAX_SIMPLE_TOPN_FIELDS {
            return None;
        }
        Some(IndexOptimizeMode::SimpleTopN(fields, fetch, ascend))
    } else {
        None
    }
}

struct SimpleTopnMultiVisitor {
    pub simple_topn_multi: Option<(Vec<String>, usize, bool)>,
    index_fields: HashSet<String>,
}

impl SimpleTopnMultiVisitor {
    pub fn new(index_fields: HashSet<String>) -> Self {
        Self {
            simple_topn_multi: None,
            index_fields,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleTopnMultiVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(sort_merge) = node.as_any().downcast_ref::<SortPreservingMergeExec>() {
            // Check if this is a SortPreservingMergeExec with fetch limit
            if let Some(fetch) = sort_merge.fetch()
                && fetch > 0
                && !sort_merge.expr().is_empty()
                && sort_merge.expr().len() <= MAX_SIMPLE_TOPN_FIELDS + 1
            // primary sort + up to one secondary sort per group field
            {
                // the first sort should be on the count(*) result, not directly on an index field
                let sort_expr = sort_merge.expr().first();
                let column_name = get_column_name(&sort_expr.expr);
                if is_column(&sort_expr.expr) && self.index_fields.contains(column_name) {
                    self.simple_topn_multi = None;
                    return Ok(TreeNodeRecursion::Stop);
                }

                self.simple_topn_multi = Some((
                    vec![], // Will be set when we find the group by fields
                    fetch,
                    !sort_merge.expr().first().options.descending,
                ));
                return Ok(TreeNodeRecursion::Continue);
            }
            self.simple_topn_multi = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.as_any().downcast_ref::<ProjectionExec>() {
            // Check ProjectionExec for the structure: [field1, .., fieldN, count(*)]
            let exprs = projection.expr();
            if exprs.len() >= 3 && exprs.len() <= MAX_SIMPLE_TOPN_FIELDS + 1 {
                return Ok(TreeNodeRecursion::Continue);
            }
            self.simple_topn_multi = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // Check if the AggregateExec matches multi-field TopN pattern
            let group_len = aggregate.group_expr().expr().len();
            if (2..=MAX_SIMPLE_TOPN_FIELDS).contains(&group_len) && aggregate.aggr_expr().len() == 1
            {
                let mut fields = Vec::with_capacity(group_len);

                // Check all group by fields are in index_fields
                for (group_expr, _) in aggregate.group_expr().expr().iter() {
                    let column_name = get_column_name(group_expr);
                    if is_column(group_expr) && self.index_fields.contains(column_name) {
                        fields.push(column_name.to_string());
                    } else {
                        // One of the group by fields is not an index field
                        self.simple_topn_multi = None;
                        return Ok(TreeNodeRecursion::Stop);
                    }
                }

                // Check aggregate function is count(*)
                let aggr_expr = &aggregate.aggr_expr()[0];
                if aggr_expr.name() == "count(Int64(1))" {
                    if let Some(simple_topn_multi) = &self.simple_topn_multi {
                        self.simple_topn_multi =
                            Some((fields, simple_topn_multi.1, simple_topn_multi.2));
                    }
                    return Ok(TreeNodeRecursion::Continue);
                }
            }
            self.simple_topn_multi = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if is_complex_plan(node) {
            self.simple_topn_multi = None;
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
    async fn test_is_simple_topn_multi() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("userid", DataType::Utf8, false),
            Field::new("searchphrase", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["user1"])),
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(StringArray::from(vec!["success"])),
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
            // Valid: three-field GROUP BY with count(*) (status is in index_fields below)
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
            // Invalid: one field not in index
            (
                "select userid, _timestamp, count(*) as cnt from hits where match_all('error') group by userid, _timestamp order by cnt desc limit 10",
                None,
            ),
            // Invalid: single field GROUP BY (should be handled by is_simple_topn)
            (
                "select userid, count(*) as cnt from hits where match_all('error') group by userid order by cnt desc limit 10",
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
            ]);
            assert_eq!(
                expected,
                is_simple_topn_multi(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }
}

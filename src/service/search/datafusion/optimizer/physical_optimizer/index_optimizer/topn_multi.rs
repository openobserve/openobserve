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

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNodeRecursion, TreeNodeVisitor},
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

/// SimpleTopNMulti(Vec<String>, usize, bool):
/// Supports two-field GROUP BY queries like:
///   SELECT userid, searchphrase, COUNT(*) as cnt FROM hits GROUP BY userid, searchphrase ORDER BY
/// cnt DESC LIMIT 10;   SELECT userid, searchphrase, COUNT(*) as cnt FROM hits GROUP BY userid,
/// searchphrase LIMIT 10; condition: select two index_fields and only have count(*) as aggregate
/// function, group by both index_fields in select clause, order by count(*), and have limit
pub(crate) fn is_simple_topn_multi(
    _plan: Arc<dyn ExecutionPlan>,
    _index_fields: HashSet<String>,
) -> Option<IndexOptimizeMode> {
    // https://github.com/openobserve/openobserve/pull/12348#issuecomment-4659231020
    // because of performance issue, we disable this optimizer for now
    //
    // let mut visitor = SimpleTopnMultiVisitor::new(index_fields);
    // let _ = plan.visit(&mut visitor);
    // if let Some((fields, fetch, ascend)) = visitor.simple_topn_multi {
    //     if fields.is_empty() || fields.len() < 2 {
    //         return None;
    //     }
    //     Some(IndexOptimizeMode::SimpleTopNMulti(fields, fetch, ascend))
    // } else {
    //     None
    // }
    None
}

#[allow(dead_code)]
struct SimpleTopnMultiVisitor {
    pub simple_topn_multi: Option<(Vec<String>, usize, bool)>,
    index_fields: HashSet<String>,
}

#[allow(dead_code)]
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
                && sort_merge.expr().len() <= 3
            // primary sort + up to 2 secondary sorts
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
            // Check ProjectionExec for the structure: [field1, field2, count(*)]
            let exprs = projection.expr();
            if exprs.len() == 3 {
                // Three expressions: two fields + count(*)
                return Ok(TreeNodeRecursion::Continue);
            }
            self.simple_topn_multi = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // Check if the AggregateExec matches multi-field TopN pattern
            if aggregate.group_expr().expr().len() == 2 && aggregate.aggr_expr().len() == 1 {
                let mut fields = Vec::with_capacity(2);

                // Check both group by fields are in index_fields
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
                Some(IndexOptimizeMode::SimpleTopNMulti(
                    vec!["userid".to_string(), "searchphrase".to_string()],
                    10,
                    false,
                )),
            ),
            // Valid: two-field GROUP BY with count(*) ORDER BY cnt ASC LIMIT 5
            (
                "select userid, searchphrase, count(*) as cnt from hits where match_all('error') group by userid, searchphrase order by cnt asc limit 5",
                Some(IndexOptimizeMode::SimpleTopNMulti(
                    vec!["userid".to_string(), "searchphrase".to_string()],
                    5,
                    true,
                )),
            ),
            // Invalid: one field not in index
            (
                "select userid, status, count(*) as cnt from hits where match_all('error') group by userid, status order by cnt desc limit 10",
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

            let index_fields = HashSet::from(["userid".to_string(), "searchphrase".to_string()]);
            assert_eq!(
                expected,
                is_simple_topn_multi(physical_plan, index_fields),
                "Failed for SQL: {}",
                sql
            );
        }
    }
}

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

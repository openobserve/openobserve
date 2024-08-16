// Copyright 2024 Zinc Labs Inc.
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

use std::{collections::HashMap, sync::Arc};

use add_sort_and_limit::AddSortAndLimitRule;
use add_timestamp::AddTimestampRule;
use datafusion::optimizer::{
    common_subexpr_eliminate::CommonSubexprEliminate,
    decorrelate_predicate_subquery::DecorrelatePredicateSubquery,
    eliminate_cross_join::EliminateCrossJoin, eliminate_duplicated_expr::EliminateDuplicatedExpr,
    eliminate_filter::EliminateFilter, eliminate_group_by_constant::EliminateGroupByConstant,
    eliminate_join::EliminateJoin, eliminate_limit::EliminateLimit,
    eliminate_nested_union::EliminateNestedUnion, eliminate_one_union::EliminateOneUnion,
    eliminate_outer_join::EliminateOuterJoin, extract_equijoin_predicate::ExtractEquijoinPredicate,
    filter_null_join_keys::FilterNullJoinKeys, optimize_projections::OptimizeProjections,
    propagate_empty_relation::PropagateEmptyRelation, push_down_filter::PushDownFilter,
    push_down_limit::PushDownLimit, replace_distinct_aggregate::ReplaceDistinctWithAggregate,
    rewrite_disjunctive_predicate::RewriteDisjunctivePredicate,
    scalar_subquery_to_join::ScalarSubqueryToJoin, simplify_expressions::SimplifyExpressions,
    single_distinct_to_groupby::SingleDistinctToGroupBy,
    unwrap_cast_in_comparison::UnwrapCastInComparison, OptimizerRule,
};
use infra::schema::get_stream_setting_fts_fields;
use proto::cluster_rpc;
use rewrite_histogram::RewriteHistogram;
use rewrite_match::RewriteMatch;

use crate::service::search::new_sql::NewSql;

pub mod add_sort_and_limit;
pub mod add_timestamp;
pub mod rewrite_histogram;
pub mod rewrite_match;

pub fn generate_optimizer_rules(
    meta: &NewSql,
    req: &cluster_rpc::SearchRequest,
) -> Vec<Arc<dyn OptimizerRule + Send + Sync>> {
    let query = req.query.as_ref().unwrap();
    // TODO: check limit
    let limit = query.size as usize;
    let offest = query.from as usize;
    let start_time = query.start_time;
    let end_time = query.end_time;

    // get full text search fields
    let mut fields = HashMap::new();
    let stream_names = &meta.stream_names;
    for name in stream_names {
        let schema = meta.schemas.get(name).unwrap().schema();
        let stream_settings = infra::schema::unwrap_stream_settings(schema);
        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
        fields.insert(name.clone(), fts_fields);
    }

    vec![
        Arc::new(EliminateNestedUnion::new()),
        Arc::new(SimplifyExpressions::new()),
        Arc::new(UnwrapCastInComparison::new()),
        Arc::new(ReplaceDistinctWithAggregate::new()),
        Arc::new(EliminateJoin::new()),
        Arc::new(DecorrelatePredicateSubquery::new()),
        Arc::new(ScalarSubqueryToJoin::new()),
        Arc::new(ExtractEquijoinPredicate::new()),
        // simplify expressions does not simplify expressions in subqueries, so we
        // run it again after running the optimizations that potentially converted
        // subqueries to joins
        Arc::new(SimplifyExpressions::new()),
        Arc::new(RewriteDisjunctivePredicate::new()),
        Arc::new(EliminateDuplicatedExpr::new()),
        Arc::new(EliminateFilter::new()),
        Arc::new(EliminateCrossJoin::new()),
        Arc::new(CommonSubexprEliminate::new()),
        Arc::new(EliminateLimit::new()),
        Arc::new(PropagateEmptyRelation::new()),
        // Must be after PropagateEmptyRelation
        Arc::new(EliminateOneUnion::new()),
        Arc::new(FilterNullJoinKeys::default()),
        Arc::new(EliminateOuterJoin::new()),
        // *********** custom rules ***********
        Arc::new(RewriteHistogram::new(start_time, end_time)),
        Arc::new(RewriteMatch::new(fields)),
        Arc::new(AddSortAndLimitRule::new(limit, offest)),
        Arc::new(AddTimestampRule::new(start_time, end_time)),
        // ************************************

        // Filters can't be pushed down past Limits, we should do PushDownFilter after
        // PushDownLimit
        Arc::new(PushDownLimit::new()),
        Arc::new(PushDownFilter::new()),
        Arc::new(SingleDistinctToGroupBy::new()),
        // The previous optimizations added expressions and projections,
        // that might benefit from the following rules
        Arc::new(SimplifyExpressions::new()),
        Arc::new(UnwrapCastInComparison::new()),
        Arc::new(CommonSubexprEliminate::new()),
        Arc::new(EliminateGroupByConstant::new()),
        Arc::new(OptimizeProjections::new()),
    ]
}

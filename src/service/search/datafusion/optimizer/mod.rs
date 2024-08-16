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
    let limit = if query.size > config::QUERY_WITH_NO_LIMIT {
        if query.size > 0 {
            Some(query.size as usize)
        } else {
            Some(config::get_config().limit.query_default_limit as usize)
        }
    } else {
        None
    };
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

    let mut rules: Vec<Arc<dyn OptimizerRule + Send + Sync>> = Vec::with_capacity(64);
    rules.push(Arc::new(EliminateNestedUnion::new()));
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(UnwrapCastInComparison::new()));
    rules.push(Arc::new(ReplaceDistinctWithAggregate::new()));
    rules.push(Arc::new(EliminateJoin::new()));
    rules.push(Arc::new(DecorrelatePredicateSubquery::new()));
    rules.push(Arc::new(ScalarSubqueryToJoin::new()));
    rules.push(Arc::new(ExtractEquijoinPredicate::new()));
    // simplify expressions does not simplify expressions in subqueries, so we
    // run it again after running the optimizations that potentially converted
    // subqueries to joins
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(RewriteDisjunctivePredicate::new()));
    rules.push(Arc::new(EliminateDuplicatedExpr::new()));
    rules.push(Arc::new(EliminateFilter::new()));
    rules.push(Arc::new(EliminateCrossJoin::new()));
    rules.push(Arc::new(CommonSubexprEliminate::new()));
    rules.push(Arc::new(EliminateLimit::new()));
    rules.push(Arc::new(PropagateEmptyRelation::new()));
    // Must be after PropagateEmptyRelation
    rules.push(Arc::new(EliminateOneUnion::new()));
    rules.push(Arc::new(FilterNullJoinKeys::default()));
    rules.push(Arc::new(EliminateOuterJoin::new()));

    // *********** custom rules ***********
    rules.push(Arc::new(RewriteHistogram::new(start_time, end_time)));
    rules.push(Arc::new(RewriteMatch::new(fields)));
    if let Some(limit) = limit {
        rules.push(Arc::new(AddSortAndLimitRule::new(limit, offest)));
    };
    rules.push(Arc::new(AddTimestampRule::new(start_time, end_time)));
    // ************************************

    // Filters can't be pushed down past Limits, we should do PushDownFilter after
    // PushDownLimit
    rules.push(Arc::new(PushDownLimit::new()));
    rules.push(Arc::new(PushDownFilter::new()));
    rules.push(Arc::new(SingleDistinctToGroupBy::new()));
    // The previous optimizations added expressions and projections,
    // that might benefit from the following rules
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(UnwrapCastInComparison::new()));
    rules.push(Arc::new(CommonSubexprEliminate::new()));
    rules.push(Arc::new(EliminateGroupByConstant::new()));
    rules.push(Arc::new(OptimizeProjections::new()));

    rules
}

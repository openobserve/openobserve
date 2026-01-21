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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use config::{ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME, datafusion::request::Request};
use datafusion::{
    common::Result,
    optimizer::{
        AnalyzerRule, OptimizerRule, common_subexpr_eliminate::CommonSubexprEliminate,
        decorrelate_predicate_subquery::DecorrelatePredicateSubquery,
        eliminate_cross_join::EliminateCrossJoin,
        eliminate_duplicated_expr::EliminateDuplicatedExpr, eliminate_filter::EliminateFilter,
        eliminate_group_by_constant::EliminateGroupByConstant, eliminate_join::EliminateJoin,
        eliminate_limit::EliminateLimit, eliminate_outer_join::EliminateOuterJoin,
        extract_equijoin_predicate::ExtractEquijoinPredicate,
        filter_null_join_keys::FilterNullJoinKeys, optimize_projections::OptimizeProjections,
        optimize_unions::OptimizeUnions, propagate_empty_relation::PropagateEmptyRelation,
        push_down_filter::PushDownFilter, push_down_limit::PushDownLimit,
        replace_distinct_aggregate::ReplaceDistinctWithAggregate,
        scalar_subquery_to_join::ScalarSubqueryToJoin, simplify_expressions::SimplifyExpressions,
        single_distinct_to_groupby::SingleDistinctToGroupBy,
    },
    physical_optimizer::{PhysicalOptimizerRule, limit_pushdown::LimitPushdown},
    physical_plan::ExecutionPlan,
    prelude::SessionContext,
    sql::TableReference,
};
use infra::schema::get_stream_setting_index_fields;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::datafusion::optimizer::context::generate_streaming_agg_rules,
    crate::service::search::datafusion::optimizer::logical_optimizer::cipher::{
        RewriteCipherCall, RewriteCipherKey,
    },
    o2_enterprise::enterprise::search::datafusion::optimizer::aggregate_topk::AggregateTopkRule,
    o2_enterprise::enterprise::search::datafusion::optimizer::eliminate_aggregate::EliminateAggregateRule,
};

use crate::service::search::{
    datafusion::optimizer::{
        analyze::remove_index_fields::RemoveIndexFieldsRule,
        context::PhysicalOptimizerContext,
        logical_optimizer::{
            add_sort_and_limit::AddSortAndLimitRule, limit_join_right_side::LimitJoinRightSide,
            rewrite_histogram::RewriteHistogram,
        },
        physical_optimizer::{
            distribute_analyze::optimize_distribute_analyze,
            index_optimizer::LeaderIndexOptimizerRule, join_reorder::JoinReorderRule,
            remote_scan::generate_remote_scan_rules,
        },
    },
    sql::Sql,
};

pub mod analyze;
pub mod context;
pub mod logical_optimizer;
pub mod physical_optimizer;
pub mod utils;

pub fn generate_analyzer_rules(sql: &Sql) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
    vec![Arc::new(RemoveIndexFieldsRule::new(
        sql.columns
            .iter()
            .any(|(_, columns)| columns.contains(ORIGINAL_DATA_COL_NAME)),
        sql.columns
            .iter()
            .any(|(_, columns)| columns.contains(ALL_VALUES_COL_NAME)),
    ))]
}

pub fn generate_optimizer_rules(sql: &Sql) -> Vec<Arc<dyn OptimizerRule + Send + Sync>> {
    let cfg = config::get_config();
    let limit = if sql.limit > config::QUERY_WITH_NO_LIMIT {
        if sql.limit > 0 {
            Some(sql.limit as usize)
        } else {
            // Additional 5 rows to check if there is data more than the specified default limit
            Some(cfg.limit.query_default_limit as usize + 5)
        }
    } else {
        None
    };
    let offset = sql.offset as usize;
    let (start_time, end_time) = sql.time_range.unwrap_or_default();

    let mut rules: Vec<Arc<dyn OptimizerRule + Send + Sync>> = Vec::with_capacity(64);

    rules.push(Arc::new(OptimizeUnions::new()));
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(ReplaceDistinctWithAggregate::new()));
    rules.push(Arc::new(EliminateJoin::new()));
    rules.push(Arc::new(DecorrelatePredicateSubquery::new()));
    rules.push(Arc::new(ScalarSubqueryToJoin::new()));
    rules.push(Arc::new(ExtractEquijoinPredicate::new()));
    // simplify expressions does not simplify expressions in subqueries, so we
    // run it again after running the optimizations that potentially converted
    // subqueries to joins
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(EliminateDuplicatedExpr::new()));
    rules.push(Arc::new(EliminateFilter::new()));
    rules.push(Arc::new(EliminateCrossJoin::new()));
    rules.push(Arc::new(CommonSubexprEliminate::new()));
    rules.push(Arc::new(EliminateLimit::new()));
    rules.push(Arc::new(PropagateEmptyRelation::new()));
    // Must be after PropagateEmptyRelation
    rules.push(Arc::new(OptimizeUnions::new()));
    rules.push(Arc::new(FilterNullJoinKeys::default()));
    rules.push(Arc::new(EliminateOuterJoin::new()));

    // *********** custom rules ***********
    rules.push(Arc::new(RewriteHistogram::new(
        start_time,
        end_time,
        sql.histogram_interval.unwrap_or_default(),
    )));
    if let Some(limit) = limit {
        rules.push(Arc::new(AddSortAndLimitRule::new(limit, offset)));
    };
    #[cfg(feature = "enterprise")]
    rules.push(Arc::new(RewriteCipherCall::new()));
    #[cfg(feature = "enterprise")]
    rules.push(Arc::new(RewriteCipherKey::new(&sql.org_id)));
    // ************************************

    // Filters can't be pushed down past Limits, we should do PushDownFilter after
    // PushDownLimit
    rules.push(Arc::new(PushDownLimit::new()));
    rules.push(Arc::new(PushDownFilter::new()));
    rules.push(Arc::new(SingleDistinctToGroupBy::new()));
    // The previous optimizations added expressions and projections,
    // that might benefit from the following rules
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(CommonSubexprEliminate::new()));
    rules.push(Arc::new(EliminateGroupByConstant::new()));
    rules.push(Arc::new(OptimizeProjections::new()));

    // *********** custom rules ***********
    // should after ExtractEquijoinPredicate and PushDownFilter, because LimitJoinRightSide will
    // require the join's on columns, and if filter have join keys, it should be pushed down
    if cfg.common.feature_join_match_one_enabled && cfg.common.feature_join_right_side_max_rows > 0
    {
        rules.push(Arc::new(LimitJoinRightSide::new(
            cfg.common.feature_join_right_side_max_rows,
        )));
    }
    // ************************************

    rules
}

pub fn generate_physical_optimizer_rules(
    req: &Request,
    sql: &Sql,
    contexts: Vec<PhysicalOptimizerContext>,
) -> Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>> {
    let mut rules = vec![Arc::new(JoinReorderRule::new()) as _];

    for context in contexts.into_iter() {
        match context {
            PhysicalOptimizerContext::RemoteScan(context) => {
                rules.push(generate_remote_scan_rules(req, sql, context));
            }
            PhysicalOptimizerContext::AggregateTopk => {
                #[cfg(feature = "enterprise")]
                rules.push(Arc::new(AggregateTopkRule::new(sql.limit)));
                #[cfg(not(feature = "enterprise"))]
                continue;
            }
            PhysicalOptimizerContext::StreamingAggregation(context) => {
                if let Some(_context) = context {
                    #[cfg(feature = "enterprise")]
                    rules.push(generate_streaming_agg_rules(_context));
                    #[cfg(feature = "enterprise")]
                    rules.push(Arc::new(EliminateAggregateRule::new()) as _);
                    #[cfg(not(feature = "enterprise"))]
                    continue;
                }
            }
        }
    }

    // should after remote scan
    let mut index_fields: HashMap<TableReference, HashSet<String>> = HashMap::new();
    for (stream_name, schema) in sql.schemas.iter() {
        let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
        let idx_fields = get_stream_setting_index_fields(&stream_settings);
        let idx_fields = idx_fields
            .into_iter()
            .filter_map(|index_field| {
                if schema.contains_field(&index_field) {
                    Some(index_field)
                } else {
                    None
                }
            })
            .collect::<HashSet<_>>();
        index_fields.insert(stream_name.clone(), idx_fields);
    }
    rules.push(Arc::new(LeaderIndexOptimizerRule::new(index_fields)) as _);

    rules.push(Arc::new(LimitPushdown::new()) as _);

    rules
}

// create physical plan
// NOTE: this function only can rewrite AnalyzeExec
// another rewrite should move to optimize rule
pub async fn create_physical_plan(
    ctx: &SessionContext,
    sql: &str,
) -> Result<Arc<dyn ExecutionPlan>> {
    let plan = ctx.state().create_logical_plan(sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;
    optimize_distribute_analyze(physical_plan)
}

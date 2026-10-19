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

use std::{collections::HashMap, sync::Arc};

use config::{ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME, datafusion::request::Request};
use datafusion::{
    common::{Result, TableReference},
    optimizer::{
        AnalyzerRule, OptimizerRule,
        common_subexpr_eliminate::CommonSubexprEliminate,
        decorrelate_lateral_join::DecorrelateLateralJoin,
        decorrelate_predicate_subquery::DecorrelatePredicateSubquery,
        eliminate_cross_join::EliminateCrossJoin,
        eliminate_duplicated_expr::EliminateDuplicatedExpr,
        eliminate_filter::EliminateFilter,
        eliminate_group_by_constant::EliminateGroupByConstant,
        eliminate_join::EliminateJoin,
        eliminate_limit::EliminateLimit,
        eliminate_outer_join::EliminateOuterJoin,
        extract_equijoin_predicate::ExtractEquijoinPredicate,
        extract_leaf_expressions::{ExtractLeafExpressions, PushDownLeafProjections},
        filter_null_join_keys::FilterNullJoinKeys,
        optimize_projections::OptimizeProjections,
        optimize_unions::OptimizeUnions,
        propagate_empty_relation::PropagateEmptyRelation,
        push_down_filter::PushDownFilter,
        push_down_limit::PushDownLimit,
        replace_distinct_aggregate::ReplaceDistinctWithAggregate,
        rewrite_set_comparison::RewriteSetComparison,
        scalar_subquery_to_join::ScalarSubqueryToJoin,
        simplify_expressions::SimplifyExpressions,
        single_distinct_to_groupby::SingleDistinctToGroupBy,
        unions_to_filter::UnionsToFilter,
    },
    physical_optimizer::{
        PhysicalOptimizerRule, aggregate_statistics::AggregateStatistics,
        combine_partial_final_agg::CombinePartialFinalAggregate, ensure_coop::EnsureCooperative,
        ensure_requirements::EnsureRequirements, filter_pushdown::FilterPushdown,
        hash_join_buffering::HashJoinBuffering, join_selection::JoinSelection,
        limit_pushdown::LimitPushdown, limit_pushdown_past_window::LimitPushPastWindows,
        limited_distinct_aggregation::LimitedDistinctAggregation,
        output_requirements::OutputRequirements, projection_pushdown::ProjectionPushdown,
        pushdown_sort::PushdownSort, sanity_checker::SanityCheckPlan,
        topk_aggregation::TopKAggregation, topk_repartition::TopKRepartition,
        update_aggr_exprs::OptimizeAggregateOrder, window_topn::WindowTopN,
    },
    physical_plan::ExecutionPlan,
    prelude::SessionContext,
};
use hashbrown::HashSet;
use infra::schema::get_stream_setting_index_fields;

#[cfg(feature = "enterprise")]
use crate::datafusion::optimizer::logical_optimizer::cipher::{
    RewriteCipherCall, RewriteCipherKey,
};
use crate::{
    datafusion::optimizer::{
        analyze::{
            remove_index_fields::RemoveIndexFieldsRule, shared_subplan::MarkSharedSubplanRule,
        },
        context::{PhysicalOptimizerContext, generate_streaming_agg_rules},
        eliminate_aggregate::EliminateAggregateRule,
        logical_optimizer::{
            add_sort_and_limit::AddSortAndLimitRule, limit_join_right_side::LimitJoinRightSide,
            rewrite_histogram::RewriteHistogram, shared_subplan::StripDivergedSharedSubplanRule,
        },
        physical_optimizer::{
            aggregate_topk::AggregateTopkRule, distribute_analyze::optimize_distribute_analyze,
            index_optimizer::LeaderIndexOptimizerRule, join_reorder::JoinReorderRule,
            remote_scan::generate_remote_scan_rules, shared_subplan::SharedSubplanRule,
        },
    },
    sql::Sql,
};

pub mod analyze;
pub mod context;
pub mod eliminate_aggregate;
pub mod logical_optimizer;
pub mod physical_optimizer;
pub mod stream_aggregate;
pub mod utils;

pub fn generate_analyzer_rules(sql: &Sql) -> Vec<Arc<dyn AnalyzerRule + Send + Sync>> {
    let mut rules: Vec<Arc<dyn AnalyzerRule + Send + Sync>> =
        vec![Arc::new(RemoveIndexFieldsRule::new(
            sql.columns
                .iter()
                .any(|(_, columns)| columns.contains(ORIGINAL_DATA_COL_NAME)),
            sql.columns
                .iter()
                .any(|(_, columns)| columns.contains(ALL_VALUES_COL_NAME)),
        ))];
    if config::get_config().search.feature_shared_cte_enabled {
        rules.push(Arc::new(MarkSharedSubplanRule::new()));
    }
    rules
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
    let (start_time, end_time) = sql.time_range;

    let mut rules: Vec<Arc<dyn OptimizerRule + Send + Sync>> = Vec::with_capacity(64);

    rules.push(Arc::new(RewriteSetComparison::new()));
    rules.push(Arc::new(OptimizeUnions::new()));
    rules.push(Arc::new(UnionsToFilter::new()));
    rules.push(Arc::new(SimplifyExpressions::new()));
    rules.push(Arc::new(ReplaceDistinctWithAggregate::new()));
    rules.push(Arc::new(EliminateJoin::new()));
    rules.push(Arc::new(DecorrelatePredicateSubquery::new()));
    rules.push(Arc::new(ScalarSubqueryToJoin::new()));
    rules.push(Arc::new(DecorrelateLateralJoin::new()));
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
        sql.timezone.clone(),
    )));
    if let Some(limit) = limit {
        rules.push(Arc::new(AddSortAndLimitRule::new(
            limit,
            offset,
            sql.stream_type,
        )));
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
    rules.push(Arc::new(ExtractLeafExpressions::new()));
    rules.push(Arc::new(PushDownLeafProjections::new()));
    rules.push(Arc::new(OptimizeProjections::new()));

    // *********** custom rules ***********
    // should after ExtractEquijoinPredicate and PushDownFilter, because LimitJoinRightSide will
    // require the join's on columns, and if filter have join keys, it should be pushed down
    if cfg.search.feature_join_match_one_enabled && cfg.search.feature_join_right_side_max_rows > 0
    {
        rules.push(Arc::new(LimitJoinRightSide::new(
            cfg.search.feature_join_right_side_max_rows,
            sql.stream_type,
        )));
    }
    // Must be last so it sees the copies after every pushdown of this pass.
    if cfg.search.feature_shared_cte_enabled {
        rules.push(Arc::new(StripDivergedSharedSubplanRule::new()));
    }
    // ************************************

    rules
}

pub fn generate_physical_optimizer_rules(
    req: &Request,
    sql: &Sql,
    contexts: Vec<PhysicalOptimizerContext>,
) -> Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>> {
    let mut rules: Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>> = Vec::with_capacity(32);

    // DataFusion 55.1 defaults in PhysicalOptimizer::new() order; a test guards drift on upgrade.
    rules.push(Arc::new(OutputRequirements::new_add_mode()));
    rules.push(Arc::new(AggregateStatistics::new()));
    // Must be before EnsureRequirements: the chosen join mode decides the required distribution
    rules.push(Arc::new(JoinSelection::new()));
    rules.push(Arc::new(LimitedDistinctAggregation::new()));
    rules.push(Arc::new(FilterPushdown::new()));
    rules.push(Arc::new(WindowTopN::new()));
    rules.push(Arc::new(EnsureRequirements::new()));
    rules.push(Arc::new(CombinePartialFinalAggregate::new()));
    rules.push(Arc::new(OptimizeAggregateOrder::new()));
    rules.push(Arc::new(ProjectionPushdown::new()));
    rules.push(Arc::new(OutputRequirements::new_remove_mode()));
    rules.push(Arc::new(TopKAggregation::new()));
    rules.push(Arc::new(LimitPushPastWindows::new()));
    rules.push(Arc::new(HashJoinBuffering::new()));
    rules.push(Arc::new(LimitPushdown::new()));
    // Must be after LimitPushdown, which creates the TopK it pushes below the repartition
    rules.push(Arc::new(TopKRepartition::new()));
    rules.push(Arc::new(ProjectionPushdown::new()));
    rules.push(Arc::new(PushdownSort::new()));
    rules.push(Arc::new(EnsureCooperative::new()));
    // Must be near the end: later plan changes break the dynamic filters' source references
    rules.push(Arc::new(FilterPushdown::new_post_optimization()));
    // Only validates the plan as left by the rules above it, not the custom rules below
    rules.push(Arc::new(SanityCheckPlan::new()));

    // *********** custom rules ***********
    rules.push(Arc::new(JoinReorderRule::new()));

    for context in contexts.into_iter() {
        match context {
            PhysicalOptimizerContext::RemoteScan(context) => {
                rules.push(generate_remote_scan_rules(req, sql, context));
            }
            PhysicalOptimizerContext::AggregateTopk => {
                rules.push(Arc::new(AggregateTopkRule::new(sql.limit)));
            }
            PhysicalOptimizerContext::StreamingAggregation(context) => {
                if let Some(context) = context {
                    rules.push(generate_streaming_agg_rules(context));
                    rules.push(Arc::new(EliminateAggregateRule::new()));
                }
            }
        }
    }

    // should after remote scan
    let mut index_fields: HashMap<TableReference, HashSet<String>> = HashMap::new();
    for (stream_name, schema) in sql.schemas.iter() {
        let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
        let idx_fields = get_stream_setting_index_fields(&stream_settings, sql.stream_type);
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
    rules.push(Arc::new(LeaderIndexOptimizerRule::new(index_fields)));

    rules.push(Arc::new(LimitPushdown::new()));

    // Must be last: the shared markers are merged only after every copy is fully rewritten.
    if config::get_config().search.feature_shared_cte_enabled {
        rules.push(Arc::new(SharedSubplanRule::new()));
    }
    // ************************************

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

#[cfg(test)]
mod tests {
    use arrow::{
        array::{ArrayRef, Int64Array, RecordBatch, StringArray, StructArray},
        util::pretty::pretty_format_batches,
    };
    use arrow_schema::{DataType, Field, Fields, Schema};
    use config::meta::stream::StreamType;
    use datafusion::{
        common::tree_node::{TreeNode, TreeNodeRecursion},
        datasource::MemTable,
        execution::{SessionStateBuilder, runtime_env::RuntimeEnvBuilder},
        optimizer::Optimizer,
        physical_optimizer::optimizer::PhysicalOptimizer,
        prelude::SessionConfig,
    };
    use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;

    use super::*;
    use crate::datafusion::{
        context::SearchContextBuilder,
        distributed_plan::{codec::get_physical_extension_codec, remote_scan_exec::RemoteScanExec},
        optimizer::{
            context::RemoteScanContext, logical_optimizer::rewrite_histogram::RewriteHistogram,
            physical_optimizer::remote_scan::RemoteScanRule,
        },
        table_provider::empty_table::NewEmptyTable,
        udf::histogram_udf,
    };

    const MINUTE_MICROS: i64 = 60_000_000;

    // DataFusion 55.1 Optimizer::new() order, as last reviewed against generate_optimizer_rules.
    const DATAFUSION_LOGICAL_RULES: &[&str] = &[
        "rewrite_set_comparison",
        "optimize_unions",
        "unions_to_filter",
        "simplify_expressions",
        "replace_distinct_aggregate",
        "eliminate_join",
        "decorrelate_predicate_subquery",
        "scalar_subquery_to_join",
        "decorrelate_lateral_join",
        "extract_equijoin_predicate",
        "eliminate_duplicated_expr",
        "eliminate_filter",
        "eliminate_cross_join",
        "eliminate_limit",
        "propagate_empty_relation",
        "filter_null_join_keys",
        "eliminate_outer_join",
        "push_down_limit",
        "push_down_filter",
        "single_distinct_aggregation_to_group_by",
        "eliminate_group_by_constant",
        "common_sub_expression_eliminate",
        "extract_leaf_expressions",
        "push_down_leaf_projections",
        "optimize_projections",
    ];

    // Upstream defaults generate_optimizer_rules does not install yet, in upstream order.
    const SKIPPED_DATAFUSION_LOGICAL_RULES: &[&str] = &[];

    fn test_sql() -> Sql {
        Sql {
            sql: "SELECT * FROM t".to_string(),
            is_complex: false,
            org_id: "default".to_string(),
            stream_type: StreamType::Logs,
            stream_names: vec![],
            has_match_all: false,
            equal_items: Default::default(),
            columns: Default::default(),
            aliases: vec![],
            schemas: Default::default(),
            limit: 100,
            offset: 0,
            time_range: (0, 0),
            group_by: vec![],
            order_by: vec![],
            histogram_interval: None,
            timezone: None,
            sorted_by_time: false,
            sampling_config: None,
        }
    }

    fn struct_fields() -> Fields {
        Fields::from(vec![
            Field::new("f", DataType::Int64, false),
            Field::new("g", DataType::Utf8, false),
        ])
    }

    fn t_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("a", DataType::Int64, false),
            Field::new("s", DataType::Struct(struct_fields()), false),
        ]))
    }

    fn register_tables(ctx: &SessionContext) {
        let a = Int64Array::from(vec![1, 2, 3, 4, 5]);
        let ts = Int64Array::from_iter_values(a.values().iter().map(|a| a * MINUTE_MICROS));
        let s = StructArray::new(
            struct_fields(),
            vec![
                Arc::new(Int64Array::from_iter_values(
                    a.values().iter().map(|a| a * 10),
                )) as ArrayRef,
                Arc::new(StringArray::from_iter_values(
                    a.values().iter().map(|a| format!("x{a}")),
                )),
            ],
            None,
        );
        let t =
            RecordBatch::try_new(t_schema(), vec![Arc::new(ts), Arc::new(a), Arc::new(s)]).unwrap();
        let t2_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Int64, false)]));
        let t2 = RecordBatch::try_new(
            t2_schema.clone(),
            vec![Arc::new(Int64Array::from(vec![2, 3, 3, 9]))],
        )
        .unwrap();
        let t = MemTable::try_new(t_schema(), vec![vec![t]]).unwrap();
        let t2 = MemTable::try_new(t2_schema, vec![vec![t2]]).unwrap();
        ctx.register_table("t", Arc::new(t)).unwrap();
        ctx.register_table("t2", Arc::new(t2)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());
    }

    fn histogram_rule(sql: &Sql) -> Arc<RewriteHistogram> {
        Arc::new(RewriteHistogram::new(
            sql.time_range.0,
            sql.time_range.1,
            sql.histogram_interval.unwrap_or_default(),
            sql.timezone.clone(),
        ))
    }

    async fn run(ctx: &SessionContext, query: &str) -> String {
        let batches = ctx.sql(query).await.unwrap().collect().await.expect(query);
        pretty_format_batches(&batches).unwrap().to_string()
    }

    // Each case is (query run with OO rules, query run with DataFusion defaults).
    async fn assert_same_rows_as_datafusion(sql: &Sql, cases: &[(&str, &str)]) {
        let state = SessionStateBuilder::new()
            .with_default_features()
            .with_optimizer_rules(generate_optimizer_rules(sql))
            .build();
        let oo = SessionContext::new_with_state(state);
        register_tables(&oo);
        let reference = SessionContext::new();
        reference.add_optimizer_rule(histogram_rule(sql));
        register_tables(&reference);
        for (oo_query, reference_query) in cases {
            let expected = run(&reference, reference_query).await;
            assert_eq!(run(&oo, oo_query).await, expected, "{oo_query}");
        }
    }

    async fn optimized_plan(sql: &Sql, query: &str) -> String {
        let state = SessionStateBuilder::new()
            .with_default_features()
            .with_optimizer_rules(generate_optimizer_rules(sql))
            .build();
        let ctx = SessionContext::new_with_state(state);
        register_tables(&ctx);
        let plan = ctx.state().create_logical_plan(query).await.unwrap();
        ctx.state()
            .optimize(&plan)
            .unwrap()
            .display_indent()
            .to_string()
    }

    #[test]
    fn test_datafusion_logical_rules_reviewed() {
        let upstream = Optimizer::new()
            .rules
            .iter()
            .map(|rule| rule.name().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            upstream, DATAFUSION_LOGICAL_RULES,
            "DataFusion's default logical rules changed; review generate_optimizer_rules, then update this list"
        );

        let ours = generate_optimizer_rules(&test_sql())
            .iter()
            .map(|rule| rule.name().to_string())
            .collect::<std::collections::HashSet<_>>();
        let missing = upstream
            .iter()
            .filter(|name| !ours.contains(name.as_str()))
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(
            missing, SKIPPED_DATAFUSION_LOGICAL_RULES,
            "generate_optimizer_rules is missing DataFusion default logical rules"
        );
    }

    #[tokio::test]
    async fn test_set_comparison_and_lateral_join_match_datafusion() {
        let mut sql = test_sql();
        sql.limit = config::QUERY_WITH_NO_LIMIT;
        let queries = [
            "SELECT a FROM t WHERE a > ANY (SELECT b FROM t2) ORDER BY a",
            "SELECT a FROM t WHERE a = ALL (SELECT b FROM t2 WHERE b = 3) ORDER BY a",
            "SELECT a FROM t WHERE a < ALL (SELECT b FROM t2) ORDER BY a",
            "SELECT a FROM t WHERE a <> ANY (SELECT b FROM t2 WHERE b > 2) ORDER BY a",
            "SELECT t.a, x.b FROM t, LATERAL (SELECT t2.b FROM t2 WHERE t2.b = t.a) x ORDER BY t.a, x.b",
            "SELECT t.a, x.c FROM t, LATERAL (SELECT count(*) AS c FROM t2 WHERE t2.b = t.a) x ORDER BY t.a",
            "SELECT t.a, x.b FROM t LEFT JOIN LATERAL (SELECT t2.b FROM t2 WHERE t2.b = t.a) x ON true ORDER BY t.a, x.b",
        ];
        let cases = queries.map(|query| (query, query));
        assert_same_rows_as_datafusion(&sql, &cases).await;
    }

    #[tokio::test]
    async fn test_struct_field_access_matches_datafusion() {
        let mut sql = test_sql();
        sql.limit = config::QUERY_WITH_NO_LIMIT;
        let queries = [
            "SELECT a, s['g'] AS g FROM t WHERE s['f'] > 20 ORDER BY s['f'] DESC",
            "SELECT s['g'] AS g, count(*) AS c FROM t WHERE s['f'] > 10 GROUP BY s['g'] ORDER BY g",
            "SELECT item['v'] AS v FROM (SELECT named_struct('v', a, 'c', a % 2) AS item FROM t) WHERE item['c'] = 1 ORDER BY v",
            "SELECT item['f'] AS f FROM (SELECT unnest(make_array(s)) AS item FROM t) WHERE item['g'] <> 'x1' ORDER BY f",
            "SELECT t.a, t2.b FROM t JOIN t2 ON t.s['f'] = t2.b * 10 ORDER BY t.a, t2.b",
        ];
        let cases = queries.map(|query| (query, query));
        assert_same_rows_as_datafusion(&sql, &cases).await;

        let plan = optimized_plan(&sql, queries[0]).await;
        assert!(plan.contains("__datafusion_extracted"), "{plan}");
    }

    #[tokio::test]
    async fn test_search_rules_with_struct_field_access_match_datafusion() {
        let mut sql = test_sql();
        sql.time_range = (0, 10 * MINUTE_MICROS);
        sql.histogram_interval = Some(60);
        let cases = [
            (
                "SELECT _timestamp, s['f'] AS f FROM t WHERE s['f'] > 10",
                "SELECT _timestamp, s['f'] AS f FROM t WHERE s['f'] > 10 ORDER BY _timestamp DESC LIMIT 100",
            ),
            (
                "SELECT histogram(_timestamp) AS h, count(*) AS c FROM t WHERE s['f'] > 10 GROUP BY h ORDER BY h",
                "SELECT histogram(_timestamp) AS h, count(*) AS c FROM t WHERE s['f'] > 10 GROUP BY h ORDER BY h LIMIT 100",
            ),
            (
                "SELECT a FROM t WHERE a > ANY (SELECT b FROM t2) AND s['g'] <> 'x5' ORDER BY a",
                "SELECT a FROM t WHERE a > ANY (SELECT b FROM t2) AND s['g'] <> 'x5' ORDER BY a LIMIT 100",
            ),
        ];
        assert_same_rows_as_datafusion(&sql, &cases).await;

        let plan = optimized_plan(&sql, cases[0].0).await;
        assert!(plan.contains("__datafusion_extracted"), "{plan}");
        assert!(plan.contains("fetch=100"), "{plan}");
    }

    #[tokio::test]
    async fn test_remote_scan_plan_with_extracted_struct_fields_decodes() {
        let sql = test_sql();
        let mut file_id_lists = hashbrown::HashMap::new();
        file_id_lists.insert(TableReference::from("t"), vec![]);
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(4))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_optimizer_rules(generate_optimizer_rules(&sql))
            .with_physical_optimizer_rule(Arc::new(RemoteScanRule::new_test(file_id_lists, false)))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let table = NewEmptyTable::new("t", t_schema()).with_partitions(4);
        ctx.register_table("t", Arc::new(table)).unwrap();

        let codec = get_physical_extension_codec();
        for query in [
            "SELECT _timestamp, s['f'] AS f FROM t WHERE s['f'] > 10",
            "SELECT s['g'] AS g, count(*) AS c FROM t WHERE s['f'] > 10 GROUP BY s['g'] ORDER BY c DESC",
        ] {
            let logical = ctx.state().create_logical_plan(query).await.unwrap();
            let optimized = ctx.state().optimize(&logical).unwrap();
            assert!(
                optimized
                    .display_indent()
                    .to_string()
                    .contains("__datafusion_extracted"),
                "{query}"
            );
            let plan = ctx.state().create_physical_plan(&logical).await.unwrap();
            let mut sent = vec![];
            plan.apply(|node| {
                if let Some(scan) = node.downcast_ref::<RemoteScanExec>() {
                    sent.push((scan.schema(), scan.encoded_plan().to_vec()));
                }
                Ok(TreeNodeRecursion::Continue)
            })
            .unwrap();
            assert!(!sent.is_empty(), "{query}");
            for (schema, bytes) in &sent {
                let follower =
                    physical_plan_from_bytes_with_extension_codec(bytes, &ctx.task_ctx(), &codec)
                        .unwrap();
                assert_eq!(follower.schema().fields(), schema.fields(), "{query}");
            }
        }
    }

    #[test]
    fn test_datafusion_physical_rules_match_upstream_defaults() {
        let upstream = PhysicalOptimizer::new()
            .rules
            .iter()
            .map(|rule| format!("{rule:?}"))
            .collect::<Vec<_>>();
        let rules = generate_physical_optimizer_rules(&Request::default(), &test_sql(), vec![]);
        // Debug, not name(): both OutputRequirements modes share one name.
        let ours = rules[..upstream.len()]
            .iter()
            .map(|rule| format!("{rule:?}"))
            .collect::<Vec<_>>();
        assert_eq!(
            ours, upstream,
            "DataFusion's default physical rules changed; review the order in generate_physical_optimizer_rules"
        );
        assert_eq!(rules[upstream.len()].name(), "JoinReorderRule");
    }

    #[tokio::test]
    async fn test_effective_physical_rule_order() {
        let req = Request::default();
        let sql = Arc::new(test_sql());
        let ctx = SearchContextBuilder::new()
            .target_partitions(2)
            .add_context(PhysicalOptimizerContext::RemoteScan(RemoteScanContext {
                nodes: vec![],
                partitioned_file_lists: Default::default(),
                context: opentelemetry::Context::new(),
                is_leader: false,
            }))
            .add_context(PhysicalOptimizerContext::StreamingAggregation(None))
            .add_context(PhysicalOptimizerContext::AggregateTopk)
            .build(&req, &sql)
            .await
            .unwrap();

        let mut expected = vec![
            "OutputRequirements",
            "aggregate_statistics",
            "join_selection",
            "LimitedDistinctAggregation",
            "FilterPushdown",
            "WindowTopN",
            "EnsureRequirements",
            "CombinePartialFinalAggregate",
            "OptimizeAggregateOrder",
            "ProjectionPushdown",
            "OutputRequirements",
            "LimitAggregation",
            "LimitPushPastWindows",
            "HashJoinBuffering",
            "LimitPushdown",
            "TopKRepartition",
            "ProjectionPushdown",
            "PushdownSort",
            "EnsureCooperative",
            "FilterPushdown(Post)",
            "SanityCheckPlan",
            "JoinReorderRule",
            "RemoteScanRule",
            "AggregateTopkRule",
            "LeaderIndexOptimizerRule",
            "LimitPushdown",
        ];
        if config::get_config().search.feature_shared_cte_enabled {
            expected.push("SharedSubplanRule");
        }
        let actual = ctx
            .state()
            .physical_optimizers()
            .iter()
            .map(|rule| rule.name().to_string())
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
    }
}

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

#[cfg(feature = "enterprise")]
use {
    crate::service::search::partition::sql_context::PartitionSqlContext,
    config::meta::search::SearchPartitionRequest,
    config::utils::sql::is_simple_aggregate_query,
    config::{
        ider,
        meta::{
            search::{CardinalityLevel, generate_aggregation_search_interval},
            sql::resolve_stream_names,
        },
    },
    infra::errors::Error,
    o2_enterprise::enterprise::search::cache_aggs_util,
    o2_enterprise::enterprise::search::{
        cache::streaming_agg::{
            self, StreamingAggsPartitionStrategy, create_aggregation_cache_file_path,
            discover_cache_for_query, generate_optimal_partitions,
            get_aggregation_cache_key_from_request,
        },
        datafusion::distributed_plan::streaming_aggs_exec,
    },
};

/// Determine whether a streaming aggregate query should be used for the given SQL query.
#[cfg(feature = "enterprise")]
pub fn is_streaming_aggregate(sql: &str, ts_column: Option<&str>) -> bool {
    let feature_query_streaming_aggs = config::get_config().common.feature_query_streaming_aggs;
    let mut is_cachable_aggs = is_simple_aggregate_query(sql).unwrap_or(false);

    let res: Result<cache_aggs_util::CacheAggregationAnalysisResult, String> =
        cache_aggs_util::analyze_count_aggregation_pattern(sql);
    if let Ok(result) = res {
        is_cachable_aggs = result.matches_pattern || is_cachable_aggs;
    }

    ts_column.is_none() && is_cachable_aggs && feature_query_streaming_aggs
}

#[cfg(not(feature = "enterprise"))]
pub fn is_streaming_aggregate(_sql: &str, _ts_column: Option<&str>) -> bool {
    false
}

/// Prepare streaming aggregate execution: discover cache, generate partition strategy,
/// and initialize cache for the streaming aggregation pipeline.
///
/// Returns `(streaming_aggs, streaming_id, partition_strategy)`.
#[cfg(feature = "enterprise")]
pub async fn prepare_streaming_aggregate(
    trace_id: &str,
    req: &SearchPartitionRequest,
    ctx: &PartitionSqlContext,
    use_cache: bool,
) -> Result<(bool, Option<String>, Option<StreamingAggsPartitionStrategy>), Error> {
    let org_id = &ctx.sql.org_id;
    let stream_type = ctx.sql.stream_type;
    let streaming_id = if req.streaming_output && ctx.is_streaming_aggregate {
        let (stream_name, _all_streams) = match resolve_stream_names(&req.sql) {
            // TODO: cache don't not support multiple stream names
            Ok(v) => (v[0].clone(), v.join(",")),
            Err(e) => {
                return Err(Error::Message(e.to_string()));
            }
        };

        // check cardinality for group by fields
        let group_by_fields =
            crate::service::search::sql::visitor::group_by::get_group_by_fields(&ctx.sql).await?;
        let cardinality_map = crate::service::search::cardinality::check_cardinality(
            org_id,
            stream_type,
            &stream_name,
            &group_by_fields,
            req.end_time,
        )
        .await?;

        let cardinality_value = cardinality_map.values().product::<f64>();
        let cardinality_level = CardinalityLevel::from(cardinality_value);
        let cache_interval =
            generate_aggregation_search_interval(req.start_time, req.end_time, cardinality_level);

        log::info!(
            "[trace_id {trace_id}] search_partition: using streaming_output, group by fields: {cardinality_map:?}, cardinality level: {cardinality_level:?}, interval: {cache_interval:?}"
        );

        let cache_interval_mins = cache_interval.get_duration_minutes();
        if cache_interval_mins == 0 {
            // this query can't use streaming_agg cache, return None
            None
        } else {
            let streaming_id = ider::uuid();
            let hashed_query = get_aggregation_cache_key_from_request(req);
            let cache_file_path = create_aggregation_cache_file_path(
                org_id,
                &stream_type.to_string(),
                &stream_name,
                hashed_query,
            );

            // Discover existing cache files for this query
            let cache_discovery_result = if !use_cache {
                streaming_agg::CacheDiscoveryResult::empty(req.start_time, req.end_time)
            } else {
                match discover_cache_for_query(
                    &cache_file_path,
                    req.start_time,
                    req.end_time,
                    cache_interval,
                )
                .await
                {
                    Ok(result) => result,
                    Err(e) => {
                        log::warn!(
                            "[trace_id {trace_id}] [streaming_id: {streaming_id}] Failed to discover cache: {e}, proceeding without cache optimization"
                        );
                        // Create empty discovery result to proceed without cache
                        streaming_agg::CacheDiscoveryResult::empty(req.start_time, req.end_time)
                    }
                }
            };

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] Cache discovery: coverage={:.2}%, cached_ranges={}, uncached_ranges={}",
                cache_discovery_result.cache_coverage_ratio * 100.0,
                cache_discovery_result.cached_ranges.len(),
                cache_discovery_result.uncached_ranges.len()
            );

            // Generate optimal partitions based on cache discovery
            let partition_strategy = generate_optimal_partitions(
                cache_discovery_result,
                req.start_time,
                req.end_time,
                cardinality_level,
            );

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] Partition strategy: {}, requires_execution={}, execution_partitions={}",
                partition_strategy.strategy_name(),
                partition_strategy.requires_execution(),
                partition_strategy.execution_partition_count()
            );

            streaming_aggs_exec::init_cache(
                &streaming_id,
                req.start_time,
                req.end_time,
                &cache_file_path,
                cache_interval_mins,
            );

            // Store partition strategy for use in do_partitioned_search
            streaming_aggs_exec::set_partition_strategy(&streaming_id, partition_strategy);

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] init streaming_agg cache: cache_file_path: {cache_file_path}"
            );
            Some(streaming_id)
        }
    } else {
        None
    };

    // Get cache strategy for streaming aggregates
    let streaming_aggs_cache_strategy = if let Some(streaming_id_ref) = streaming_id.as_deref() {
        match streaming_aggs_exec::get_partition_strategy(streaming_id_ref) {
            Some(strategy) => {
                log::info!(
                    "[trace_id {trace_id}] [streaming_id: {streaming_id_ref}] Using cache-aware partition strategy"
                );
                Some(strategy)
            }
            None => {
                log::warn!(
                    "[trace_id {trace_id}] [streaming_id: {streaming_id_ref}] No partition strategy found, using default generation"
                );
                None
            }
        }
    } else {
        None
    };

    Ok((
        streaming_id.is_some(),
        streaming_id,
        streaming_aggs_cache_strategy,
    ))
}

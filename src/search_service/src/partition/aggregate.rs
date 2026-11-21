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

use ::search::{
    datafusion::physical_plan::streaming_aggs_exec::{
        files::{create_aggregation_cache_file_path, get_aggregation_cache_key_from_request},
        partition::{
            discovery::{CacheDiscoveryResult, discover_cache_for_query},
            partition_optimizer::{StreamingAggsPartitionStrategy, generate_optimal_partitions},
        },
        registry,
    },
    sql::visitor::streaming_aggregate,
};
use config::{
    TIMESTAMP_COL_NAME, ider,
    meta::{
        search::{CardinalityLevel, SearchPartitionRequest, generate_aggregation_search_interval},
        sql::resolve_stream_names,
    },
    utils::sql::is_simple_aggregate_query,
};
use infra::errors::Error;

#[cfg(feature = "vectorscan")]
use crate::datafusion::physical_optimizer::sdr_redact::redaction_digest;
use crate::{
    cache::result_utils::{is_ranked_by_non_timestamp, normalize_ts_order_by},
    partition::sql_context::PartitionSqlContext,
    sql::Sql,
};

/// Determine whether a streaming aggregate query should be used for the given SQL query.
pub fn is_streaming_aggregate(
    sql: &str,
    ts_column: Option<&str>,
    is_ranked_histogram: bool,
) -> bool {
    let feature_query_streaming_aggs = config::get_config().search.feature_query_streaming_aggs;
    let mut is_cachable_aggs = is_simple_aggregate_query(sql).unwrap_or(false);

    if let Ok(matches_pattern) = streaming_aggregate::matches_streaming_aggregate_pattern(sql) {
        is_cachable_aggs = matches_pattern || is_cachable_aggs;
    }

    (ts_column.is_none() || is_ranked_histogram) && is_cachable_aggs && feature_query_streaming_aggs
}

/// Whether the leading ORDER BY is not the time column, so time slices cannot be concatenated.
pub fn is_ranked_by_non_ts_column(sql: &Sql, ts_column: Option<&str>) -> bool {
    ts_column.is_some_and(|ts| {
        is_ranked_by_non_timestamp(&normalize_ts_order_by(&sql.order_by, ts, &sql.aliases), ts)
    })
}

/// A histogram whose leading ORDER BY is not its time column: its top-N is only right after
/// every slice is merged, which the aggregation cache does and the result cache cannot.
pub fn is_ranked_histogram(sql: &Sql, ts_column: Option<&str>) -> bool {
    sql.histogram_interval.is_some() && is_ranked_by_non_ts_column(sql, ts_column)
}

/// Prepare streaming aggregate execution: discover cache, generate partition strategy,
/// and initialize cache for the streaming aggregation pipeline.
///
/// Returns `(streaming_aggs, streaming_id, partition_strategy)`.
pub async fn prepare_streaming_aggregate(
    trace_id: &str,
    req: &SearchPartitionRequest,
    ctx: &PartitionSqlContext,
    use_cache: bool,
) -> Result<(bool, Option<String>, Option<StreamingAggsPartitionStrategy>), Error> {
    if ctx.sql.histogram_offset != Some(0) {
        return Ok((false, None, None));
    }

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
        let group_by_fields = cardinality_fields(&ctx.sql).await?;
        let cardinality_map = crate::cardinality::check_cardinality(
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
        if cache_interval_mins > 0 {
            let streaming_id = ider::uuid();
            #[cfg(feature = "vectorscan")]
            let digest = redaction_digest(org_id, stream_type, &ctx.sql.stream_names);
            #[cfg(not(feature = "vectorscan"))]
            let digest: Option<String> = None;
            let hashed_query = get_aggregation_cache_key_from_request(
                req,
                ctx.sql.histogram_interval,
                digest.as_deref(),
            );
            let cache_file_path = create_aggregation_cache_file_path(
                org_id,
                &stream_type.to_string(),
                &stream_name,
                hashed_query,
            );

            // Discover existing cache files for this query
            let cache_discovery_result = if !use_cache {
                CacheDiscoveryResult::empty(req.start_time, req.end_time)
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
                        CacheDiscoveryResult::empty(req.start_time, req.end_time)
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

            registry::init_cache(
                &streaming_id,
                req.start_time,
                req.end_time,
                &cache_file_path,
                cache_interval_mins,
            );

            // Store partition strategy for use in do_partitioned_search
            registry::set_partition_strategy(&streaming_id, partition_strategy);

            log::info!(
                "[trace_id {trace_id}] [streaming_id: {streaming_id}] init streaming_agg cache: cache_file_path: {cache_file_path}"
            );
            Some(streaming_id)
        } else {
            None
        }
    } else {
        None
    };

    // Get cache strategy for streaming aggregates
    let streaming_aggs_cache_strategy = if let Some(streaming_id_ref) = streaming_id.as_deref() {
        match registry::get_partition_strategy(streaming_id_ref) {
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

/// GROUP BY fields whose distinct counts size the aggregation cache chunks.
pub(crate) async fn cardinality_fields(sql: &Sql) -> Result<Vec<String>, Error> {
    let mut fields = crate::sql::visitor::group_by::get_group_by_fields(sql).await?;
    // A chunk holds a bounded number of histogram buckets, not one per distinct _timestamp.
    if sql.histogram_interval.is_some() {
        fields.retain(|field| field != TIMESTAMP_COL_NAME);
    }
    Ok(fields)
}

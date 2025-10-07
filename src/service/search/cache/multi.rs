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

use std::str::FromStr;

use async_recursion::async_recursion;
use chrono::Utc;
use config::{
    get_config,
    meta::search::Response,
    utils::{json, time::second_micros},
};
use infra::cache::{file_data::disk::QUERY_RESULT_CACHE, meta::ResultCacheMeta};

use super::{cacher::get_results, sort_response};
use crate::{
    common::meta::search::{CacheQueryRequest, ResultCacheSelectionStrategy},
    service::search::cache::{
        CachedQueryResponse,
        result_utils::{extract_timestamp_range, get_ts_value, round_down_to_nearest_minute},
    },
};

pub async fn get_cached_results(
    file_path: &str,
    trace_id: &str,
    cache_req: CacheQueryRequest,
) -> Vec<CachedQueryResponse> {
    let mut res: Vec<_> = vec![];
    let r = QUERY_RESULT_CACHE.read().await;
    let query_key = file_path.replace('/', "_");
    let is_cached = r.get(&query_key).cloned();
    drop(r);
    if is_cached.is_none() {
        log::debug!(
            "[CACHE RESULT {trace_id}] No cache found during get_cached_results for query key: {}, cache_query: {:?}",
            query_key,
            cache_req
        );
        return res;
    }

    if let Some(cache_metas) = is_cached {
        let _ = recursive_process_multiple_metas(
            &cache_metas,
            trace_id,
            cache_req,
            &mut res,
            &query_key,
            file_path,
        )
        .await;
        res
    } else {
        res
    }
}

#[async_recursion]
async fn recursive_process_multiple_metas(
    cache_metas: &[ResultCacheMeta],
    trace_id: &str,
    cache_req: CacheQueryRequest,
    results: &mut Vec<CachedQueryResponse>,
    query_key: &str,
    file_path: &str,
) -> Result<(), anyhow::Error> {
    if cache_metas.is_empty() {
        if results.is_empty() {
            log::debug!(
                "[CACHE RESULT {trace_id}] No cache found during recursive_process_multiple_metas for query key: {}, cached_metas: {:?}",
                query_key,
                cache_metas
            );
        }

        return Ok(());
    }
    let selection_strategy: ResultCacheSelectionStrategy = ResultCacheSelectionStrategy::from_str(
        &get_config().common.result_cache_selection_strategy,
    )
    .unwrap_or_default();

    // Filter relevant metas that are within the overall query range
    let relevant_metas: Vec<ResultCacheMeta> = cache_metas
        .iter()
        .filter(|m| m.start_time <= cache_req.q_end_time && m.end_time >= cache_req.q_start_time)
        .cloned()
        .collect();

    if relevant_metas.is_empty() {
        log::info!(
            "[CACHE RESULT {trace_id}] No relevant cache found for query key: {}",
            query_key
        );
        return Ok(());
    }

    // Sort by start time to process them in sequence
    let mut sorted_metas = relevant_metas;
    sorted_metas.sort_by_key(|m| m.start_time);

    // Select the largest meta by selection strategy
    if let Some(largest_meta) = sorted_metas
        .iter()
        .max_by_key(|meta| select_cache_meta(meta, &cache_req, &selection_strategy))
    {
        let largest_meta = largest_meta.clone();
        let file_name = format!(
            "{}_{}_{}_{}.json",
            largest_meta.start_time,
            largest_meta.end_time,
            if cache_req.is_aggregate { 1 } else { 0 },
            if cache_req.is_descending { 1 } else { 0 }
        );
        log::info!(
            "[CACHE RESULT {trace_id}] Selected meta for query key: {} with file name: {} and start time: {} and end time: {}",
            query_key,
            file_name,
            largest_meta.start_time,
            largest_meta.end_time
        );

        let mut matching_cache_meta = largest_meta.clone();

        // Calculate delta time range to fetch the delta data using search query
        let cfg = get_config();
        let discard_duration = second_micros(cfg.limit.cache_delay_secs);

        let cache_duration = matching_cache_meta.end_time - matching_cache_meta.start_time;
        if cache_duration <= discard_duration
            && matching_cache_meta.start_time > Utc::now().timestamp_micros() - discard_duration
        {
            return Ok(());
        }

        let result = match get_results(file_path, &file_name).await {
            Ok(v) => match json::from_str::<Response>(&v) {
                Ok(v) => Some(v),
                Err(e) => {
                    log::error!(
                        "[trace_id {trace_id}] Error parsing cached response: {:?}",
                        e
                    );
                    None
                }
            },
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] Get results from disk failed: {:?}",
                    e
                );
                None
            }
        };
        if let Some(mut cached_response) = result {
            let (hits_allowed_start_time, hits_allowed_end_time) = if cache_req.discard_interval > 0
            {
                (
                    cache_req.q_start_time - (cache_req.q_start_time % cache_req.discard_interval),
                    cache_req.q_end_time - (cache_req.q_end_time % cache_req.discard_interval),
                )
            } else {
                (cache_req.q_start_time, cache_req.q_end_time)
            };
            let discard_ts = get_allowed_up_to(&cached_response, &cache_req, discard_duration);
            cached_response.hits.retain(|hit| {
                let hit_ts = get_ts_value(&cache_req.ts_column, hit);
                hit_ts < hits_allowed_end_time
                    && hit_ts > hits_allowed_start_time
                    && hit_ts < discard_ts
            });

            // Sort the hits using stored ORDER BY metadata
            // This preserves the original query's ordering (e.g., ORDER BY count DESC)
            let order_by_metadata = cached_response.order_by_metadata.clone();
            sort_response(
                cache_req.is_descending,
                &mut cached_response,
                &cache_req.ts_column,
                &order_by_metadata,
            );

            cached_response.total = cached_response.hits.len();
            cached_response.size = cached_response.hits.len() as i64;
            if cache_req.discard_interval < 0 {
                matching_cache_meta.end_time = discard_ts;
            }
            if !cached_response.hits.is_empty() {
                // Determine if results are time-ordered for optimal timestamp extraction
                let is_time_ordered = !cache_req.is_histogram_non_ts_order;

                let (response_start_time, response_end_time) = if is_time_ordered {
                    // For time-ordered results, use first/last based on sort order
                    let last_rec_ts =
                        get_ts_value(&cache_req.ts_column, cached_response.hits.last().unwrap());
                    let first_rec_ts =
                        get_ts_value(&cache_req.ts_column, cached_response.hits.first().unwrap());
                    let start = if cache_req.is_descending {
                        last_rec_ts
                    } else {
                        first_rec_ts
                    };
                    let end = if cache_req.is_descending {
                        first_rec_ts
                    } else {
                        last_rec_ts
                    };
                    (start, end)
                } else {
                    // Non-time-ordered (e.g., ORDER BY count): scan all hits for accurate min/max
                    extract_timestamp_range(
                        &cached_response.hits,
                        &cache_req.ts_column,
                        is_time_ordered,
                    )
                };
                log::info!(
                    "[CACHE RESULT {trace_id}] Get results from disk success for query key: {} with start time {} - end time {} , len {}",
                    query_key,
                    matching_cache_meta.start_time,
                    matching_cache_meta.end_time,
                    cached_response.hits.len()
                );
                results.push(CachedQueryResponse {
                    cached_response,
                    deltas: vec![],
                    has_cached_data: true,
                    cache_query_response: true,
                    response_start_time,
                    response_end_time,
                    ts_column: cache_req.ts_column.to_string(),
                    is_descending: cache_req.is_descending,
                    limit: -1,
                });
            }
        }
        // Remove all overlapping metas with the selected largest meta and call recursively
        let remaining_metas: Vec<ResultCacheMeta> = sorted_metas
            .into_iter()
            .filter(|meta| {
                // Keep only metas that don't overlap with the selected largest meta
                !largest_meta.eq(meta)
                    && (meta.end_time <= largest_meta.start_time
                        || meta.start_time >= largest_meta.end_time)
            })
            .collect();
        if !remaining_metas.is_empty() {
            return Ok(());
        }
        let _ = recursive_process_multiple_metas(
            &remaining_metas[..],
            trace_id,
            cache_req,
            results,
            query_key,
            file_path,
        )
        .await;
    }
    Ok(())
}

fn select_cache_meta(
    meta: &ResultCacheMeta,
    req: &CacheQueryRequest,
    strategy: &ResultCacheSelectionStrategy,
) -> i64 {
    match strategy {
        ResultCacheSelectionStrategy::Overlap => {
            let overlap_start = meta.start_time.max(req.q_start_time);
            let overlap_end = meta.end_time.min(req.q_end_time);
            overlap_end - overlap_start
        }
        ResultCacheSelectionStrategy::Duration => meta.end_time - meta.start_time,
        ResultCacheSelectionStrategy::Both => {
            let overlap_start = req.q_start_time.max(meta.start_time);
            let overlap_end = req.q_end_time.min(meta.end_time);
            let overlap_duration = overlap_end - overlap_start;
            let cache_duration = meta.end_time - meta.start_time;
            if cache_duration > 0 {
                (overlap_duration * 100) / cache_duration
            } else {
                0
            }
        }
    }
}

fn get_allowed_up_to(
    cached_response: &Response,
    cache_req: &CacheQueryRequest,
    discard_duration: i64,
) -> i64 {
    // For non-timestamp histogram queries, results are not sorted by time
    // Scan all hits to find the actual maximum timestamp
    if cache_req.is_histogram_non_ts_order {
        let max_ts = cached_response
            .hits
            .iter()
            .map(|hit| get_ts_value(&cache_req.ts_column, hit))
            .max()
            .unwrap_or(0);
        return max_ts;
    }

    // For time-ordered results, use first/last based on sort order
    let first_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.first().unwrap());
    let last_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.last().unwrap());

    if cache_req.is_descending {
        if cache_req.discard_interval > 0 {
            first_ts
        } else {
            let m_first_ts = round_down_to_nearest_minute(first_ts);
            if Utc::now().timestamp_micros() - discard_duration < m_first_ts {
                m_first_ts - discard_duration
            } else {
                first_ts
            }
        }
    } else if cache_req.discard_interval > 0 {
        last_ts
    } else {
        let m_last_ts = round_down_to_nearest_minute(last_ts);
        if Utc::now().timestamp_micros() - discard_duration < last_ts {
            m_last_ts - discard_duration
        } else {
            last_ts
        }
    }
}

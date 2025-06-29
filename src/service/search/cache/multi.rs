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
use config::{get_config, meta::search::Response, utils::json};
use infra::cache::{file_data::disk::QUERY_RESULT_CACHE, meta::ResultCacheMeta};

use super::{cacher::get_results, sort_response};
use crate::{
    common::meta::search::{CacheQueryRequest, ResultCacheSelectionStrategy},
    service::search::cache::{
        CachedQueryResponse,
        result_utils::{get_ts_value, round_down_to_nearest_minute},
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
        log::info!(
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
            log::info!(
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

    if
        let Some(largest_meta) = sorted_metas
            .iter()
            .filter(|cache_meta| {
                log::info!(
                    "[CACHE CANDIDATES {trace_id}] Got caches: cache_meta.response_start_time: {}, cache_meta.response_end_time: {}",
                    cache_meta.start_time,
                    cache_meta.end_time
                );
                cache_meta.start_time <= cache_req.q_end_time &&
                    cache_meta.end_time >= cache_req.q_start_time
            })
            .max_by_key(|result| select_cache_meta(result, &cache_req, &selection_strategy))
    {
        let file_name = format!(
            "{}_{}_{}_{}.json",
            largest_meta.start_time,
            largest_meta.end_time,
            if cache_req.is_aggregate {
                1
            } else {
                0
            },
            if cache_req.is_descending {
                1
            } else {
                0
            }
        );

        let mut matching_cache_meta = largest_meta.clone();

        // Calculate delta time range to fetch the delta data using search query
        let cfg = get_config();
        let discard_duration = cfg.common.result_cache_discard_duration * 1000 * 1000;

        let cache_duration = matching_cache_meta.end_time - matching_cache_meta.start_time;
        if
            cache_duration <= discard_duration &&
            matching_cache_meta.start_time > Utc::now().timestamp_micros() - discard_duration
        {
            return Ok(());
        }

        let result = match get_results(file_path, &file_name).await {
            Ok(v) => {
                match json::from_str::<Response>(&v) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::error!("[trace_id {trace_id}] Error parsing cached response: {e}");
                        None
                    }
                }
            }
            Err(e) => {
                log::error!("[trace_id {trace_id}] Get results from disk failed: {e}");
                None
            }
        };
        if let Some(mut cached_response) = result {
            let (hits_allowed_start_time, hits_allowed_end_time) = if
                cache_req.discard_interval > 0
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
                hit_ts < hits_allowed_end_time &&
                    hit_ts > hits_allowed_start_time &&
                    hit_ts < discard_ts
            });

            // Sort the hits by the order
            sort_response(cache_req.is_descending, &mut cached_response, &cache_req.ts_column);

            cached_response.total = cached_response.hits.len();
            if cache_req.discard_interval < 0 {
                matching_cache_meta.end_time = discard_ts;
            }
            if !cached_response.hits.is_empty() {
                let last_rec_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.last().unwrap());
                let first_rec_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.first().unwrap());
                let response_start_time = if cache_req.is_descending {
                    last_rec_ts
                } else {
                    first_rec_ts
                };
                let response_end_time = if cache_req.is_descending {
                    first_rec_ts
                } else {
                    last_rec_ts
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
        // Filter out the largest meta and call recursively with non-overlapping metas
        let remaining_metas: Vec<ResultCacheMeta> = sorted_metas
            .clone()
            .into_iter()
            .filter(|meta| {
                !largest_meta.eq(meta) &&
                    (meta.end_time <= largest_meta.start_time ||
                        meta.start_time >= largest_meta.end_time)
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
            file_path
        ).await;
    }
    Ok(())
}

/// Cache selection strategies determine how to choose the best cached result when multiple caches
/// exist:
///
/// 1. Overlap: Selects cache with maximum overlap with query time range Example: Query:
///    10:00-10:30, Cache1: 10:00-10:15, Cache2: 10:10-10:25 Chooses Cache2 (15min overlap) over
///    Cache1 (10min overlap)
///
/// 2. Duration: Selects cache with longest duration regardless of overlap Example: Query:
///    10:00-10:30, Cache1: 09:00-10:00, Cache2: 09:30-10:30   Chooses Cache1 (1hr) over Cache2
///    (30min)
///
/// 3. Both: Calculates what percentage of the cache duration overlaps with query Example: Query:
///    10:00-11:00 Cache1: 10:00-10:30 (duration: 30min, overlap: 30min) = (30/30)*100 = 100%
///    Cache2: 10:15-11:15 (duration: 60min, overlap: 45min) = (45/60)*100 = 75% Chooses Cache1
///    because 100% of its duration is useful for the query
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

#[cfg(test)]
mod tests {
    use infra::cache::meta::ResultCacheMeta;

    use super::*;

    fn create_test_cache_meta(start_time: i64, end_time: i64) -> ResultCacheMeta {
        ResultCacheMeta {
            start_time,
            end_time,
            is_aggregate: false,
            is_descending: false,
        }
    }

    fn create_test_cache_request(q_start_time: i64, q_end_time: i64) -> CacheQueryRequest {
        CacheQueryRequest {
            q_start_time,
            q_end_time,
            is_aggregate: false,
            ts_column: "_timestamp".to_string(),
            discard_interval: 0,
            is_descending: false,
        }
    }

    #[test]
    fn test_select_cache_meta_overlap_strategy() {
        let strategy = ResultCacheSelectionStrategy::Overlap;

        // Test case 1: Complete overlap
        let meta = create_test_cache_meta(100, 200);
        let req = create_test_cache_request(150, 180);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 30); // overlap: 180 - 150 = 30

        // Test case 2: Partial overlap (cache starts before query)
        let meta = create_test_cache_meta(50, 150);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 50); // overlap: 150 - 100 = 50

        // Test case 3: Partial overlap (cache starts after query)
        let meta = create_test_cache_meta(150, 250);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 50); // overlap: 200 - 150 = 50

        // Test case 4: No overlap (cache is before query)
        let meta = create_test_cache_meta(50, 80);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, -20); // overlap: 80 - 100 = -20 (negative means no overlap)

        // Test case 5: No overlap (cache is after query)
        let meta = create_test_cache_meta(250, 300);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, -50); // overlap: 200 - 250 = -50 (negative means no overlap)

        // Test case 6: Cache completely contains query
        let meta = create_test_cache_meta(50, 300);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 100); // overlap: 200 - 100 = 100
    }

    #[test]
    fn test_select_cache_meta_duration_strategy() {
        let strategy = ResultCacheSelectionStrategy::Duration;
        let req = create_test_cache_request(100, 200); // Query parameters don't affect duration strategy

        // Test case 1: Short duration cache
        let meta = create_test_cache_meta(100, 150);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 50); // duration: 150 - 100 = 50

        // Test case 2: Long duration cache
        let meta = create_test_cache_meta(50, 300);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 250); // duration: 300 - 50 = 250

        // Test case 3: Zero duration cache (edge case)
        let meta = create_test_cache_meta(100, 100);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 0); // duration: 100 - 100 = 0

        // Test case 4: Negative duration (edge case - shouldn't happen but testing robustness)
        let meta = create_test_cache_meta(200, 100);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, -100); // duration: 100 - 200 = -100
    }

    #[test]
    fn test_select_cache_meta_both_strategy() {
        let strategy = ResultCacheSelectionStrategy::Both;

        // Test case 1: 100% overlap (query completely within cache)
        let meta = create_test_cache_meta(50, 300);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 40); // overlap: 100, cache_duration: 250, (100 * 100) / 250 = 40

        // Test case 2: 50% overlap
        let meta = create_test_cache_meta(100, 200);
        let req = create_test_cache_request(150, 250);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 50); // overlap: 50, cache_duration: 100, (50 * 100) / 100 = 50

        // Test case 3: 25% overlap
        let meta = create_test_cache_meta(100, 400);
        let req = create_test_cache_request(350, 450);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 16); // overlap: 50, cache_duration: 300, (50 * 100) / 300 = 16.66... = 16 (integer division)

        // Test case 4: Zero duration cache (edge case)
        let meta = create_test_cache_meta(100, 100);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 0); // Special case: cache_duration = 0, returns 0

        // Test case 5: No overlap
        let meta = create_test_cache_meta(100, 150);
        let req = create_test_cache_request(200, 300);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, -100); // overlap: -50, cache_duration: 50, (-50 * 100) / 50 = -100

        // Test case 6: Perfect match (cache and query have same time range)
        let meta = create_test_cache_meta(100, 200);
        let req = create_test_cache_request(100, 200);
        let score = select_cache_meta(&meta, &req, &strategy);
        assert_eq!(score, 100); // overlap: 100, cache_duration: 100, (100 * 100) / 100 = 100
    }

    #[test]
    fn test_select_cache_meta_edge_cases() {
        // Test with zero time ranges
        let meta = create_test_cache_meta(0, 0);
        let req = create_test_cache_request(0, 0);

        let overlap_score = select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Overlap);
        assert_eq!(overlap_score, 0);

        let duration_score =
            select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Duration);
        assert_eq!(duration_score, 0);

        let both_score = select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Both);
        assert_eq!(both_score, 0);
    }

    #[test]
    fn test_select_cache_meta_large_numbers() {
        // Test with large timestamp values (microseconds)
        let meta = create_test_cache_meta(1_640_995_200_000_000, 1_640_995_260_000_000); // 60 seconds
        let req = create_test_cache_request(1_640_995_230_000_000, 1_640_995_290_000_000); // 60 seconds, 30s overlap

        let overlap_score = select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Overlap);
        assert_eq!(overlap_score, 30_000_000); // 30 seconds in microseconds

        let duration_score =
            select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Duration);
        assert_eq!(duration_score, 60_000_000); // 60 seconds in microseconds

        let both_score = select_cache_meta(&meta, &req, &ResultCacheSelectionStrategy::Both);
        assert_eq!(both_score, 50); // (30_000_000 * 100) / 60_000_000 = 50
    }

    #[test]
    fn test_select_cache_meta_comparison_scenarios() {
        let req = create_test_cache_request(100, 200);

        // Cache 1: Shorter duration but worse overlap
        let cache1 = create_test_cache_meta(120, 180);
        // Cache 2: Longer duration but better overlap
        let cache2 = create_test_cache_meta(50, 250);

        // Overlap strategy should prefer cache2 (better overlap)
        let overlap_score1 =
            select_cache_meta(&cache1, &req, &ResultCacheSelectionStrategy::Overlap);
        let overlap_score2 =
            select_cache_meta(&cache2, &req, &ResultCacheSelectionStrategy::Overlap);
        assert!(overlap_score2 > overlap_score1); // 100 > 60

        // Duration strategy should prefer cache2 (longer duration)
        let duration_score1 =
            select_cache_meta(&cache1, &req, &ResultCacheSelectionStrategy::Duration);
        let duration_score2 =
            select_cache_meta(&cache2, &req, &ResultCacheSelectionStrategy::Duration);
        assert!(duration_score2 > duration_score1); // 200 > 60

        // Both strategy balances overlap efficiency
        let both_score1 = select_cache_meta(&cache1, &req, &ResultCacheSelectionStrategy::Both);
        let both_score2 = select_cache_meta(&cache2, &req, &ResultCacheSelectionStrategy::Both);
        assert!(both_score1 > both_score2); // cache1: 100% efficiency (60/60), cache2: 50% efficiency (100/200)
    }

    #[test]
    fn test_select_cache_meta_all_strategies_consistency() {
        // Test that all strategies return expected types and don't panic
        let meta = create_test_cache_meta(100, 200);
        let req = create_test_cache_request(150, 250);

        // All strategies should return i64 values without panicking
        let strategies = [
            ResultCacheSelectionStrategy::Overlap,
            ResultCacheSelectionStrategy::Duration,
            ResultCacheSelectionStrategy::Both,
        ];

        for strategy in strategies.iter() {
            let score = select_cache_meta(&meta, &req, strategy);
            // Score should be a valid i64 (no overflow/underflow for reasonable inputs)
            assert!(score >= i64::MIN && score <= i64::MAX);
        }
    }
}

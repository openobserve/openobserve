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

use infra::cache::file_data::disk::QUERY_RESULT_CACHE;
use itertools::Itertools;

use crate::{
    common::meta::search::{CacheQueryRequest, ResultCacheSelectionStrategy},
    service::search::cache::{CachedQueryResponse, cacher::select_cache_meta},
};

pub async fn get_cached_results(
    trace_id: &str,
    file_path: &str,
    cache_req: CacheQueryRequest,
) -> Vec<CachedQueryResponse> {
    let mut res: Vec<_> = vec![];
    let r = QUERY_RESULT_CACHE.read().await;
    let query_key = file_path.replace('/', "_");
    let cache_metas = r.get(&query_key).cloned();
    drop(r);

    let Some(mut cache_metas) = cache_metas else {
        log::debug!(
            "[CACHE RESULT {trace_id}] No cache found during get_cached_results for query key: {query_key}, cache_query: {cache_req:?}"
        );
        return res;
    };
    cache_metas.sort_by_key(|meta| meta.start_time);

    let selection_strategy = ResultCacheSelectionStrategy::from(
        config::get_config()
            .common
            .result_cache_selection_strategy
            .as_str(),
    );
    loop {
        let Some(idx) = cache_metas.iter().position_max_by_key(|result| {
            select_cache_meta(result, &cache_req, &selection_strategy)
        }) else {
            break;
        };
        let best_cache_meta = cache_metas.remove(idx);
        if let Some(result) = super::cacher::get_cached_results(
            trace_id,
            file_path,
            cache_req.clone(),
            Some(vec![best_cache_meta.clone()]),
        )
        .await
        {
            res.push(result);
        }
        // Remove all overlapping metas with the selected largest meta and call recursively
        cache_metas.retain(|meta| {
            !best_cache_meta.eq(meta)
                && (meta.end_time <= best_cache_meta.start_time
                    || meta.start_time >= best_cache_meta.end_time)
        });
    }

    res
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
            histogram_interval: 0,
            is_descending: false,
            is_histogram_non_ts_order: false,
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
            // TODO: This test should go away because an i64 will always be in range,
            // despite any overflow or underflow.
            assert!((i64::MIN..=i64::MAX).contains(&score));
        }
    }
}

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

use bytes::Bytes;
use config::{
    TIMESTAMP_COL_NAME,
    meta::{search::Response, sql::OrderBy, stream::StreamType},
    utils::{file::scan_files, json},
};
use infra::cache::{
    file_data::disk::{self, QUERY_RESULT_CACHE},
    meta::ResultCacheMeta,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::cache::streaming_agg::STREAMING_AGGS_CACHE_DIR;

use crate::{
    common::meta::search::{
        CacheQueryRequest, CachedQueryResponse, QueryDelta, ResultCacheSelectionStrategy,
    },
    service::search::{
        cache::{
            MultiCachedQueryResponse,
            result_utils::{get_ts_value, has_non_timestamp_ordering, is_timestamp_field},
        },
        sql::{RE_HISTOGRAM, Sql, visitor::histogram_interval::generate_histogram_interval},
    },
};

/// Invalidate cached response by stream min ts
/// This is done to ensure that any stale data which is no longer retained in the stream is not
/// returned as part of the cached response
/// The cache will eventually remove the stale data as part of the cache eviction policy
pub async fn invalidate_cached_response_by_stream_min_ts(
    file_path: &str,
    responses: &[CachedQueryResponse],
) -> Result<Vec<CachedQueryResponse>, String> {
    let components: Vec<&str> = file_path.split('/').collect();
    if components.len() < 3 {
        return Err(format!(
            "File path does not contain sufficient components: {file_path}"
        ));
    }

    let (org_id, stream_type_str, stream_name) = (components[0], components[1], components[2]);
    let stream_type = StreamType::from(stream_type_str);

    let stream_min_ts =
        infra::cache::stats::get_stream_stats(org_id, stream_name, stream_type).doc_time_min;

    let filtered_responses = responses
        .iter()
        .filter(|meta| meta.response_end_time >= stream_min_ts)
        .cloned()
        .map(|mut meta| {
            if meta.response_start_time < stream_min_ts {
                meta.response_start_time = stream_min_ts;
            }
            meta
        })
        .collect();

    Ok(filtered_responses)
}

#[tracing::instrument(
    name = "service:search:cache:cacher:check_cache",
    skip_all,
    fields(org_id = org_id)
)]
#[allow(clippy::too_many_arguments)]
pub async fn check_cache(
    trace_id: &str,
    org_id: &str,
    req: &mut config::meta::search::Request,
    origin_sql: &mut str,
    file_path: &str,
    is_aggregate: bool,
    sql: &Sql,
    result_ts_col: &str,
    is_descending: bool,
    should_exec_query: &mut bool,
) -> MultiCachedQueryResponse {
    let start = std::time::Instant::now();

    let order_by = &sql.order_by;

    // skip the queries with no timestamp column
    if result_ts_col.is_empty() && (is_aggregate || !sql.group_by.is_empty()) {
        return MultiCachedQueryResponse {
            order_by: order_by.clone(),
            ..Default::default()
        };
    }

    // Check if query contains histogram function
    let is_histogram_query = sql.histogram_interval.is_some();

    // skip the count queries & queries first order by is not _timestamp field
    // Exception: Allow histogram queries even if ORDER BY is not on timestamp,
    // because histogram is plotted based on timestamp
    if req.query.track_total_hits
        || (!order_by.is_empty()
            && order_by.first().as_ref().unwrap().0 != TIMESTAMP_COL_NAME
            && !is_histogram_query
            && !result_ts_col.is_empty()
            && result_ts_col != order_by.first().as_ref().unwrap().0)
    {
        return MultiCachedQueryResponse {
            order_by: order_by.clone(),
            ..Default::default()
        };
    }

    // Note: Both result_ts_col refinement and SQL modification (adding _timestamp to SELECT)
    // are now done in prepare_cache_response() before calling this function.
    // just use the refined result_ts_col that was passed in.

    // Check ts_col again, if it is still empty, return default
    if result_ts_col.is_empty() {
        return MultiCachedQueryResponse {
            order_by: order_by.clone(),
            ..Default::default()
        };
    }

    let mut histogram_interval = -1;
    if is_aggregate && let Some(interval) = sql.histogram_interval {
        // Note: handle_histogram is now called in prepare_cache_response() before hash computation
        // to ensure consistent hashing. We just need to update req.query.sql with the normalized
        // SQL.
        req.query.sql = origin_sql.to_owned();
        histogram_interval = interval * 1000 * 1000; // in microseconds
    }

    // Note: is_descending refinement for histogram queries is now done in prepare_cache_response()
    // before calling this function, so we use the pre-refined value directly

    if is_aggregate && order_by.is_empty() && result_ts_col.is_empty() {
        return MultiCachedQueryResponse::default();
    }

    // Determine if this is a histogram query with non-timestamp ORDER BY.
    // These queries need special handling because results may not be time-ordered,
    // requiring us to scan all hits to find the actual time range.
    let is_histogram_non_ts_order = is_histogram_query
        && !order_by.is_empty()
        && has_non_timestamp_ordering(order_by, result_ts_col);

    let mut multi_resp = MultiCachedQueryResponse {
        trace_id: trace_id.to_string(),
        is_aggregate,
        is_descending,
        ..Default::default()
    };
    if histogram_interval > 0 {
        multi_resp.histogram_interval = histogram_interval / 1000 / 1000;
    }
    log::info!(
        "[trace_id {trace_id}] check_cache: result_ts_col: {}, histogram_interval: {}, time range: {} - {}",
        result_ts_col,
        histogram_interval,
        req.query.start_time,
        req.query.end_time
    );

    if config::get_config().common.use_multi_result_cache {
        let mut cached_responses = super::multi::get_cached_results(
            trace_id,
            file_path,
            CacheQueryRequest {
                q_start_time: req.query.start_time,
                q_end_time: req.query.end_time,
                is_aggregate,
                ts_column: result_ts_col.to_string(),
                histogram_interval,
                is_descending,
                is_histogram_non_ts_order,
            },
        )
        .await;
        if is_descending {
            cached_responses.sort_by_key(|meta| meta.response_end_time);
        } else {
            cached_responses.sort_by_key(|meta| meta.response_start_time);
        }

        // remove the cached response older than stream min ts
        match invalidate_cached_response_by_stream_min_ts(file_path, &cached_responses).await {
            Ok(responses) => {
                cached_responses = responses;
            }
            Err(e) => log::error!("Error invalidating cached response by stream min ts: {e}"),
        }

        let total_hits = cached_responses
            .iter()
            .map(|v| v.cached_response.total)
            .sum::<usize>();

        let (deltas, updated_start_time, cache_duration) = calculate_deltas_multi(
            &cached_responses,
            req.query.start_time,
            req.query.end_time,
            histogram_interval,
        );
        multi_resp.total_cache_duration = cache_duration as usize;
        if let Some(start_time) = updated_start_time {
            req.query.start_time = start_time;
        }

        // Only consider it a full cache hit if we have enough records AND no time gaps
        let deltas = if total_hits >= (sql.limit as usize) && deltas.is_empty() {
            *should_exec_query = false;
            vec![]
        } else {
            deltas
        };

        for res in cached_responses {
            if res.has_cached_data {
                multi_resp.has_cached_data = true;
                multi_resp.cached_response.push(res);
            }
        }

        if !deltas.is_empty() {
            let search_delta: Vec<QueryDelta> = deltas.to_vec();
            if search_delta.is_empty() {
                log::debug!("cached response found");
                *should_exec_query = false;
            } else {
                multi_resp.deltas = search_delta;
            }
        }
        multi_resp.cache_query_response = true;
        multi_resp.limit = sql.limit;
        multi_resp.ts_column = result_ts_col.to_string();
        multi_resp.took = start.elapsed().as_millis() as usize;
        multi_resp.file_path = file_path.to_string();
        multi_resp.order_by = order_by.clone();
        multi_resp.is_aggregate = is_aggregate;
        multi_resp
    } else {
        let c_resp = match get_cached_results(
            trace_id,
            file_path,
            CacheQueryRequest {
                q_start_time: req.query.start_time,
                q_end_time: req.query.end_time,
                is_aggregate,
                ts_column: result_ts_col.to_string(),
                histogram_interval,
                is_descending,
                is_histogram_non_ts_order,
            },
            None,
        )
        .await
        {
            Some(mut cached_resp) => {
                // remove the cached response older than stream min ts
                match invalidate_cached_response_by_stream_min_ts(file_path, &[cached_resp.clone()])
                    .await
                {
                    Ok(responses) => {
                        // single cached query response is expected
                        cached_resp = match responses.first() {
                            Some(v) => v.clone(),
                            None => {
                                log::error!("No cached response found after validation");
                                CachedQueryResponse {
                                    is_descending,
                                    ..Default::default()
                                }
                            }
                        };
                    }
                    Err(e) => {
                        log::error!("Error invalidating cached response by stream min ts: {e:?}")
                    }
                }

                let mut deltas = vec![];
                calculate_deltas(
                    &(ResultCacheMeta {
                        start_time: cached_resp.response_start_time,
                        end_time: cached_resp.response_end_time,
                        is_aggregate,
                        is_descending,
                    }),
                    req.query.start_time,
                    req.query.end_time,
                    histogram_interval,
                    &mut deltas,
                );

                let search_delta: Vec<QueryDelta> = deltas.to_vec();
                if search_delta.is_empty() {
                    log::debug!("cached response found");
                    *should_exec_query = false;
                }

                if cached_resp.cached_response.total == (sql.limit as usize)
                    && cached_resp.response_end_time == req.query.end_time
                {
                    *should_exec_query = false;
                    cached_resp.deltas = vec![];
                } else {
                    cached_resp.deltas = search_delta;
                }

                cached_resp.cached_response.took = start.elapsed().as_millis() as usize;
                cached_resp
            }
            None => {
                // since there is no cache & will be cached in the end we should return the response
                log::debug!("cached response not found");
                CachedQueryResponse {
                    is_descending,
                    ..Default::default()
                }
            }
        };
        multi_resp.has_cached_data = c_resp.has_cached_data;
        if !c_resp.deltas.is_empty() {
            multi_resp.deltas = c_resp.deltas.clone();
        };
        if c_resp.has_cached_data {
            multi_resp.cached_response.push(c_resp);
        }
        multi_resp.took = start.elapsed().as_millis() as usize;
        multi_resp.cache_query_response = true;
        multi_resp.limit = sql.limit;
        multi_resp.ts_column = result_ts_col.to_string();
        multi_resp.file_path = file_path.to_string();
        multi_resp.order_by = order_by.clone();
        multi_resp.is_aggregate = is_aggregate;
        multi_resp
    }
}

pub async fn get_cached_results(
    trace_id: &str,
    file_path: &str,
    cache_req: CacheQueryRequest,
    cache_metas: Option<Vec<ResultCacheMeta>>,
) -> Option<CachedQueryResponse> {
    let query_key = file_path.replace('/', "_");
    let cache_metas = match cache_metas {
        Some(v) => v,
        None => QUERY_RESULT_CACHE.read().await.get(&query_key).cloned()?,
    };

    let selection_strategy = ResultCacheSelectionStrategy::from(
        config::get_config()
            .common
            .result_cache_selection_strategy
            .as_str(),
    );

    // get the best matching cache meta
    let mut matching_meta = match cache_metas
        .iter()
        .filter(|m| {
            // to make sure there is overlap between cache time range and query time range
            log::info!(
                "[CACHE CANDIDATES {trace_id}] get_cached_results: cache_meta time_range: {} - {}",
                m.start_time,
                m.end_time
            );
            // check if the data is matching for histogram
            if cache_req.is_aggregate
                && cache_req.histogram_interval > 0
                && (m.start_time % cache_req.histogram_interval != 0
                    || m.end_time % cache_req.histogram_interval != 0)
            {
                return false;
            }
            m.start_time <= cache_req.q_end_time && m.end_time >= cache_req.q_start_time
        })
        .max_by_key(|result| select_cache_meta(result, &cache_req, &selection_strategy))
    {
        Some(v) => v.clone(),
        None => {
            log::debug!("No matching cache found for query key: {query_key}");
            return None;
        }
    };

    // get the cache data from disk
    let file_name = format!(
        "{}_{}_{}_{}.json",
        matching_meta.start_time,
        matching_meta.end_time,
        if cache_req.is_aggregate { 1 } else { 0 },
        if cache_req.is_descending { 1 } else { 0 }
    );
    let data = match get_results(file_path, &file_name).await {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[trace_id {trace_id}] Get results from disk failed: file: {file_path}/{file_name}, error: {e}"
            );
            return None;
        }
    };
    let mut cached_response: Response = match json::from_str::<Response>(&data) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[trace_id {trace_id}] Error parsing cached response: {e:?}");
            return None;
        }
    };

    // filter data based on request time range
    let (hits_allowed_start_time, hits_allowed_end_time) =
        (cache_req.q_start_time, cache_req.q_end_time);
    let first_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.first().unwrap());
    let last_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.last().unwrap());
    let data_start_time = std::cmp::min(first_ts, last_ts);
    let data_end_time = std::cmp::max(first_ts, last_ts);
    // convert histogram interval to microseconds
    let histogram_interval = cached_response.histogram_interval.unwrap_or_default() * 1_000_000;
    // check if need to filter the data
    if data_start_time < cache_req.q_start_time || data_end_time > cache_req.q_end_time {
        cached_response.hits.retain(|hit| {
            let hit_ts = get_ts_value(&cache_req.ts_column, hit);
            hit_ts + histogram_interval < hits_allowed_end_time && hit_ts >= hits_allowed_start_time
        });
        // if the data is empty after filtering, return None
        if cached_response.hits.is_empty() {
            return None;
        }
        // reset the start and end time
        let first_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.first().unwrap());
        let last_ts = get_ts_value(&cache_req.ts_column, cached_response.hits.last().unwrap());
        matching_meta.start_time = std::cmp::min(first_ts, last_ts);
        matching_meta.end_time = std::cmp::max(first_ts, last_ts) + histogram_interval;
    }
    cached_response.total = cached_response.hits.len();

    log::info!(
        "[CACHE RESULT {trace_id}] Get results from disk success for query key: {query_key} with time range {} - {} ",
        matching_meta.start_time,
        matching_meta.end_time
    );

    Some(CachedQueryResponse {
        cached_response,
        deltas: vec![],
        has_cached_data: true,
        cache_query_response: true,
        response_start_time: matching_meta.start_time,
        response_end_time: matching_meta.end_time,
        ts_column: cache_req.ts_column.to_string(),
        is_descending: cache_req.is_descending,
        limit: -1,
    })
}

pub fn calculate_deltas(
    result_meta: &ResultCacheMeta,
    query_start_time: i64,
    query_end_time: i64,
    histogram_interval: i64,
    deltas: &mut Vec<QueryDelta>,
) {
    if query_start_time == result_meta.start_time && query_end_time == result_meta.end_time {
        // If query start time and end time are the same as cache times, return results from cache
        return;
    }

    if query_end_time > result_meta.end_time {
        // q end time : 11:00, r end time : 10:45
        // for delta start time we need to add 1 microsecond to the end time
        // because we will include the start_time, if we don't add 1 microsecond
        // the start_time will be include in the next search, we will get duplicate data
        let delta_start_time = if histogram_interval > 0 {
            result_meta.end_time
        } else {
            result_meta.end_time + 1
        };
        deltas.push(QueryDelta {
            delta_start_time,
            delta_end_time: query_end_time,
        });
    }

    if query_start_time < result_meta.start_time {
        // q start time : 10:00, r start time : 10:15
        deltas.push(QueryDelta {
            delta_start_time: query_start_time,
            delta_end_time: result_meta.start_time,
        });
    }
}

pub async fn cache_results_to_disk(
    trace_id: &str,
    file_path: &str,
    file_name: &str,
    data: String,
    clear_cache: bool,
    clean_start_ts: Option<i64>,
    clean_end_ts: Option<i64>,
) -> std::io::Result<bool> {
    let start = std::time::Instant::now();
    log::info!("[trace_id {trace_id}] Caching results to disk");

    if clear_cache {
        log::info!(
            "[trace_id {trace_id}] Clearing cache for file path as use_cache: false, clear_cache: {clear_cache}, start: {},  {file_path}",
            start.elapsed().as_millis(),
        );
        let _ = delete_cache(file_path, 0, clean_start_ts, clean_end_ts)
            .await
            .map_err(|e| {
                log::error!(
                    "[trace_id {trace_id}] Clearing cache for file path error: {}",
                    e
                );
                e
            });
        log::info!(
            "[trace_id {trace_id}] Clearing cache for file path completed. use_cache: false, clear_cache: {clear_cache}, took: {} ms, {file_path}",
            start.elapsed().as_millis(),
        );
    }

    let file = format!("results/{file_path}/{file_name}");
    if disk::exist(&file).await {
        return Ok(false);
    }
    match disk::set(&file, Bytes::from(data)).await {
        Ok(_) => {
            log::info!(
                "[trace_id {trace_id}] After clearing cache, Cached results to disk completed, took: {} ms",
                start.elapsed().as_millis()
            );
        }
        Err(e) => {
            log::error!("[trace_id {trace_id}] Error caching results to disk: {e}");
            return Err(std::io::Error::other("Error caching results to disk"));
        }
    }

    log::info!(
        "[trace_id {trace_id}] Cached results to disk completed, took: {} ms",
        start.elapsed().as_millis()
    );
    Ok(true)
}

pub async fn get_results(file_path: &str, file_name: &str) -> std::io::Result<String> {
    let file = format!("results/{file_path}/{file_name}");
    match disk::get(&file, None).await {
        Some(v) => Ok(String::from_utf8(v.to_vec()).unwrap()),
        None => Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "File not found",
        )),
    }
}

pub fn get_ts_col_order_by(
    parsed_sql: &Sql,
    _ts_col: &str,
    _is_aggregate: bool,
) -> Option<(String, bool)> {
    let mut is_descending = true;
    let order_by = &parsed_sql.order_by;
    let result_ts_col = {
        #[cfg(not(feature = "enterprise"))]
        {
            let mut ts_col = String::new();
            for (original, alias) in &parsed_sql.aliases {
                if original == _ts_col || original.contains("histogram") {
                    ts_col = alias.clone();
                }
            }
            if !_is_aggregate
                && (parsed_sql
                    .columns
                    .iter()
                    .any(|(_, v)| v.contains(&_ts_col.to_owned()))
                    || parsed_sql.order_by.iter().any(|v| v.0.eq(&_ts_col)))
            {
                ts_col = _ts_col.to_string();
            }
            ts_col
        }

        #[cfg(feature = "enterprise")]
        {
            match o2_enterprise::enterprise::search::cache_ts_util::get_timestamp_column_name(
                &parsed_sql.sql,
            ) {
                Some(result) => result,
                None => "".to_string(),
            }
        }
    };

    if !order_by.is_empty() && !result_ts_col.is_empty() {
        for (field, order) in order_by {
            if is_timestamp_field(field, &result_ts_col) {
                is_descending = order == &OrderBy::Desc;
                break;
            }
        }
    };
    if result_ts_col.is_empty() {
        None
    } else {
        Some((result_ts_col, is_descending))
    }
}

/// Computes the cache file path based on query metadata and histogram information.
/// This function ensures consistent file path generation across different code paths.
///
/// # Arguments
/// * `base_path` - The base path format: "{org_id}/{stream_type}/{stream_name}/{hashed_query}"
/// * `is_aggregate` - Whether the query is an aggregate query
/// * `histogram_interval` - Optional histogram interval from the SQL query
/// * `ts_column` - The timestamp column name
///
/// # Returns
/// The complete file path with histogram information appended if applicable
pub fn compute_cache_file_path(
    base_path: &str,
    is_aggregate: bool,
    histogram_interval: Option<i64>,
    ts_column: &str,
) -> String {
    let mut file_path = base_path.to_string();

    // For histogram queries, append interval and ts_column to file_path
    if is_aggregate && let Some(interval) = histogram_interval {
        file_path = format!("{file_path}_{interval}_{ts_column}");
    }

    file_path
}

/// Refines is_descending for histogram queries with non-timestamp ORDER BY.
///
/// For histogram queries, if ORDER BY is not on the timestamp column,
/// we use ascending as the default for cache operations.
///
/// # Arguments
/// * `sql` - Parsed SQL query
/// * `ts_column` - The timestamp column name
/// * `initial_is_descending` - The initial is_descending value from ORDER BY
///
/// # Returns
/// Refined is_descending value
pub fn refine_is_descending_for_histogram(
    sql: &Sql,
    ts_column: &str,
    initial_is_descending: bool,
) -> bool {
    let is_histogram_query = sql.histogram_interval.is_some();

    if !is_histogram_query || sql.order_by.is_empty() {
        return initial_is_descending;
    }

    // Check if ORDER BY includes the timestamp column
    let mut found_ts_order = false;
    let mut refined_is_descending = initial_is_descending;

    for (field, order) in &sql.order_by {
        if is_timestamp_field(field, ts_column) {
            refined_is_descending = order == &OrderBy::Desc;
            found_ts_order = true;
            break;
        }
    }

    // For histogram queries ordered by non-timestamp columns (e.g., ORDER BY count),
    // use ascending as default
    if !found_ts_order {
        refined_is_descending = false;
    }

    refined_is_descending
}

enum DeletionCriteria {
    TimeRange(i64, i64),
    ThresholdTimestamp(i64),
    DeleteAll,
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
pub(crate) fn select_cache_meta(
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

fn parse_cache_file_timestamps(file_path: &str) -> Option<(i64, i64)> {
    let file_name = file_path.split('/').next_back()?;
    // Remove file extension (e.g., .json, .arrow) before parsing
    let file_name_without_ext = file_name.split('.').next()?;

    let parts: Vec<&str> = file_name_without_ext.split('_').collect();
    if parts.len() >= 2
        && let (Ok(start_ts), Ok(end_ts)) = (parts[0].parse::<i64>(), parts[1].parse::<i64>())
    {
        return Some((start_ts, end_ts));
    }
    None
}

fn time_ranges_overlap(start1: i64, end1: i64, start2: i64, end2: i64) -> bool {
    // Check if file data range overlaps with clean range
    // File overlaps if: file_start < clean_end AND file_end > clean_start
    // NOTE: Partial overlap is considered an overlap
    start1 < end2 && end1 > start2
}

fn should_delete_cache_file(file_path: &str, criteria: &DeletionCriteria) -> bool {
    let Some((file_start_ts, file_end_ts)) = parse_cache_file_timestamps(file_path) else {
        return false;
    };

    match criteria {
        // First check for time range overlapping files
        DeletionCriteria::TimeRange(clean_start, clean_end) => {
            time_ranges_overlap(file_start_ts, file_end_ts, *clean_start, *clean_end)
        }
        // Second check for threshold timestamp
        // Only delete if start_time <= delete_ts (keep cache from delete_ts onwards)
        DeletionCriteria::ThresholdTimestamp(delete_ts) => file_start_ts <= *delete_ts,
        // Last check for delete all
        DeletionCriteria::DeleteAll => true,
    }
}

#[tracing::instrument]
pub async fn delete_cache(
    path: &str,
    delete_ts: i64,
    clean_start_ts: Option<i64>,
    clean_end_ts: Option<i64>,
) -> std::io::Result<bool> {
    let root_dir = disk::get_dir().await;
    // Part 1: delete the results cache
    let pattern = format!("{root_dir}/results/{path}");
    let prefix = format!("{root_dir}/");
    let files = scan_files(&pattern, "json", None).unwrap_or_default();
    let mut remove_files: Vec<String> = vec![];

    let criteria = match (clean_start_ts, clean_end_ts, delete_ts) {
        // First check for time range
        (Some(start), Some(end), _) => DeletionCriteria::TimeRange(start, end),
        // Second check for threshold timestamp
        (_, _, ts) if ts > 0 => DeletionCriteria::ThresholdTimestamp(ts),
        // Last check for delete all
        _ => DeletionCriteria::DeleteAll,
    };

    for file in files {
        if !should_delete_cache_file(&file, &criteria) {
            continue;
        }
        match disk::remove(file.strip_prefix(&prefix).unwrap()).await {
            Ok(_) => remove_files.push(file),
            Err(e) => {
                log::error!("Error deleting cache: {:?}", e);
                return Err(std::io::Error::other("Error deleting cache"));
            }
        }
    }

    // Part 2: delete the aggregation cache
    #[cfg(feature = "enterprise")]
    {
        let aggs_pattern = format!("{root_dir}/{STREAMING_AGGS_CACHE_DIR}/{path}");
        let aggs_files = scan_files(&aggs_pattern, "arrow", None).unwrap_or_default();

        for file in aggs_files {
            if !should_delete_cache_file(&file, &criteria) {
                continue;
            }
            match disk::remove(file.strip_prefix(&prefix).unwrap()).await {
                Ok(_) => remove_files.push(file),
                Err(e) => {
                    log::error!("Error deleting cache: {:?}", e);
                    return Err(std::io::Error::other("Error deleting cache"));
                }
            }
        }
    }

    for file in remove_files {
        let columns = file
            .strip_prefix(&prefix)
            .unwrap()
            .split('/')
            .collect::<Vec<&str>>();

        let query_key = format!(
            "{}_{}_{}_{}",
            columns[1], columns[2], columns[3], columns[4]
        );
        let mut r = QUERY_RESULT_CACHE.write().await;
        r.remove(&query_key);
    }
    Ok(true)
}

pub fn handle_histogram(
    origin_sql: &mut String,
    q_time_range: Option<(i64, i64)>,
    histogram_interval: i64,
) {
    let caps = if let Some(caps) = RE_HISTOGRAM.captures(origin_sql.as_str()) {
        caps
    } else {
        return;
    };

    // 0th capture is the whole histogram(...) ,
    // 1st capture is the comma-delimited list of args
    // ideally there should be at least one arg, otherwise df with anyways complain,
    // so we we return from here if capture[1] is None
    let args = match caps.get(1) {
        Some(v) => v
            .as_str()
            .split(',')
            .map(|v| v.trim().trim_matches(|v| v == '\'' || v == '"'))
            .collect::<Vec<&str>>(),
        None => return,
    };

    let interval = if histogram_interval > 0 {
        format!("{histogram_interval} second")
    } else {
        args.get(1)
            .map_or_else(|| generate_histogram_interval(q_time_range), |v| *v)
            .to_string()
    };

    let field = args.first().unwrap_or(&"_timestamp");

    *origin_sql = origin_sql.replace(
        caps.get(0).unwrap().as_str(),
        &format!("histogram({field},'{interval}')"),
    );
}

fn calculate_deltas_multi(
    results: &[CachedQueryResponse],
    start_time: i64,
    end_time: i64,
    histogram_interval: i64,
) -> (Vec<QueryDelta>, Option<i64>, i64) {
    let mut deltas = Vec::new();
    let mut cache_duration = 0_i64;

    let mut current_end_time = start_time;

    for meta in results {
        cache_duration += meta.response_end_time - meta.response_start_time;
        let delta_end_time = if histogram_interval > 0 && !meta.cached_response.hits.is_empty() {
            // If histogram interval > 0, we need to adjust the end time to the nearest interval
            let mut end_time = meta.response_start_time;
            if end_time % histogram_interval != 0 {
                end_time = end_time - (end_time % histogram_interval);
                if end_time < start_time {
                    end_time = start_time;
                }
            }
            end_time
        } else {
            // Need to subtract 1 microsecond for the delta end time
            // since the cache start time will include the records for that start time
            meta.response_start_time - 1
        };
        if meta.response_start_time > current_end_time {
            // There is a gap (delta) between current coverage and the next meta
            deltas.push(QueryDelta {
                delta_start_time: current_end_time,
                delta_end_time,
            });
        }
        // Update the current end time to the end of the current meta
        current_end_time = meta.response_end_time;
    }

    // Check if there is a gap at the end
    if current_end_time < end_time
        && results
            .last()
            .is_some_and(|last_meta| !last_meta.cached_response.hits.is_empty())
    {
        let mut expected_delta_start_time = current_end_time;
        if expected_delta_start_time > end_time {
            expected_delta_start_time = current_end_time;
        }
        deltas.push(QueryDelta {
            delta_start_time: expected_delta_start_time,
            delta_end_time: end_time,
        });
    }

    deltas.sort(); // Sort the deltas to bring duplicates together
    deltas.dedup(); // Remove consecutive duplicates

    (deltas, None, cache_duration)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{Field, Schema};
    use config::{
        meta::{
            search::{Query, Request, RequestEncoding, Response, ResponseTook, SearchEventType},
            sql::OrderBy,
        },
        utils::time::now_micros,
    };
    use datafusion::common::TableReference;
    use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
    use proto::cluster_rpc::SearchQuery;

    use super::*;
    use crate::{common::meta::search::CachedQueryResponse, service::search::Sql};

    #[test]
    fn test_calculate_deltas_multi_expected_intervals() {
        let hit = serde_json::json!({
            "hits":[{"breakdown_1":"EUR","x_axis_1":"2025-05-23T12:00:00","y_axis_1":106,"y_axis_2":106}]
        });
        let cached_response = CachedQueryResponse {
            cached_response: Response {
                took: 450,
                took_detail: ResponseTook {
                    total: 0,
                    cache_took: 0,
                    file_list_took: 4,
                    wait_in_queue: 3,
                    idx_took: 0,
                    search_took: 37,
                },
                columns: vec![],
                hits: vec![hit],
                total: 101,
                from: 0,
                size: 280,
                scan_files: 0,
                cached_ratio: 100,
                scan_size: 0,
                idx_scan_size: 0,
                scan_records: 34560,
                response_type: "".to_string(),
                trace_id: "".to_string(),
                function_error: vec![],
                is_partial: false,
                histogram_interval: Some(3600),
                new_start_time: None,
                new_end_time: None,
                result_cache_ratio: 33,
                work_group: None,
                order_by: Some(OrderBy::Asc),
                order_by_metadata: vec![(String::from("x_axis_1"), OrderBy::Asc)],
                converted_histogram_query: None,
                is_histogram_eligible: None,
                query_index: None,
                peak_memory_usage: Some(1024000.0),
            },
            deltas: vec![],
            has_cached_data: true,
            cache_query_response: true,
            response_start_time: 1747657200000000,
            response_end_time: 1747659555000000,
            ts_column: "x_axis_1".to_string(),
            is_descending: false,
            limit: -1,
        };
        let query_start_time = 1747657200000000;
        let query_end_time = 1747659600000000;
        let histogram_interval = 3600000000; // 1 hour in microseconds

        let (deltas, ..) = calculate_deltas_multi(
            &[cached_response],
            query_start_time,
            query_end_time,
            histogram_interval,
        );
        println!("Deltas: {deltas:?}");

        // All deltas should have start <= end
        for delta in &deltas {
            assert!(
                delta.delta_start_time <= delta.delta_end_time,
                "delta_start_time > delta_end_time: {delta:?}"
            );
        }

        let expected_deltas = vec![QueryDelta {
            delta_start_time: 1747659555000000,
            delta_end_time: 1747659600000000,
        }];
        assert_eq!(deltas, expected_deltas);
    }

    #[test]
    fn test_handle_histogram() {
        // Test case 1: Basic histogram with numeric interval
        let mut sql = "SELECT histogram(_timestamp, '10 seconds') FROM logs".to_string();
        let time_range = Some((1640995200000000, 1641081600000000)); // 2022-01-01 to 2022-01-02
        handle_histogram(&mut sql, time_range, 10);
        assert!(sql.contains("histogram(_timestamp,"));
        assert!(sql.contains("second"));
    }

    #[test]
    fn test_get_ts_col_order_by() {
        let sql = Sql {
            sql: "SELECT _timestamp, field1 FROM logs ORDER BY _timestamp DESC".to_string(),
            is_complex: false,
            org_id: "test_org".to_string(),
            stream_type: StreamType::Logs,
            stream_names: vec![TableReference::from("logs")],
            has_match_all: false,
            equal_items: hashbrown::HashMap::new(),
            columns: {
                let mut cols = hashbrown::HashMap::new();
                let mut set = hashbrown::HashSet::new();
                set.insert("_timestamp".to_string());
                set.insert("field1".to_string());
                cols.insert(TableReference::from("logs"), set);
                cols
            },
            aliases: vec![("_timestamp".to_string(), "_timestamp".to_string())],
            schemas: {
                let mut schemas = hashbrown::HashMap::new();
                schemas.insert(
                    TableReference::from("logs"),
                    Arc::new(SchemaCache::new(Schema::empty())),
                );
                schemas
            },
            limit: 100,
            offset: 0,
            time_range: None,
            group_by: vec![],
            order_by: vec![("_timestamp".to_string(), OrderBy::Desc)],
            histogram_interval: None,
            sorted_by_time: true,
            sampling_config: None,
        };

        let result = get_ts_col_order_by(&sql, "_timestamp", false);
        assert!(result.is_some());
        let (ts_col, is_descending) = result.unwrap();
        assert_eq!(ts_col, "_timestamp");
        assert!(is_descending);
    }

    #[tokio::test]
    async fn test_invalidate_cached_response_by_stream_min_ts() {
        let mock_stream_min_ts = now_micros() - 3600000000; // 1 hour ago

        let responses = vec![
            CachedQueryResponse {
                cached_response: Response {
                    took: 100,
                    took_detail: ResponseTook::default(),
                    columns: vec![],
                    hits: vec![serde_json::json!({"timestamp":"2025-01-01T10:00:00Z"})],
                    total: 1,
                    from: 0,
                    size: 10,
                    scan_files: 1,
                    cached_ratio: 100,
                    scan_size: 1000,
                    idx_scan_size: 1000,
                    scan_records: 100,
                    response_type: "".to_string(),
                    trace_id: "".to_string(),
                    function_error: vec![],
                    is_partial: false,
                    histogram_interval: None,
                    new_start_time: None,
                    new_end_time: None,
                    result_cache_ratio: 100,
                    work_group: None,
                    order_by: None,
                    order_by_metadata: vec![],
                    converted_histogram_query: None,
                    is_histogram_eligible: None,
                    query_index: None,
                    peak_memory_usage: Some(1024000.0),
                },
                deltas: vec![],
                has_cached_data: true,
                cache_query_response: true,
                response_start_time: mock_stream_min_ts - 7200000000, // 2 hours ago
                response_end_time: mock_stream_min_ts - 3600000000,   // 1 hour ago
                ts_column: "_timestamp".to_string(),
                is_descending: true,
                limit: 10,
            },
            CachedQueryResponse {
                cached_response: Response {
                    took: 100,
                    took_detail: ResponseTook::default(),
                    columns: vec![],
                    hits: vec![serde_json::json!({"timestamp": "2025-01-01T11:00:00Z"})],
                    total: 1,
                    from: 0,
                    size: 10,
                    scan_files: 1,
                    cached_ratio: 100,
                    scan_size: 1000,
                    idx_scan_size: 1000,
                    scan_records: 100,
                    response_type: "".to_string(),
                    trace_id: "".to_string(),
                    function_error: vec![],
                    is_partial: false,
                    histogram_interval: None,
                    new_start_time: None,
                    new_end_time: None,
                    result_cache_ratio: 100,
                    work_group: None,
                    order_by: None,
                    order_by_metadata: vec![],
                    converted_histogram_query: None,
                    is_histogram_eligible: None,
                    query_index: None,
                    peak_memory_usage: Some(1024000.0),
                },
                deltas: vec![],
                has_cached_data: true,
                cache_query_response: true,
                response_start_time: mock_stream_min_ts - 1800000000, // 30 minutes ago
                response_end_time: mock_stream_min_ts + 1800000000,   // 30 minutes from now
                ts_column: "_timestamp".to_string(),
                is_descending: true,
                limit: 10,
            },
        ];

        let file_path = "test_org/logs/test_stream";
        let result = invalidate_cached_response_by_stream_min_ts(file_path, &responses).await;
        assert!(result.is_ok());
        let filtered_responses = result.unwrap();
        assert_eq!(filtered_responses.len(), 2);
    }

    #[tokio::test]
    async fn test_check_cache() {
        // Test case 1: Basic cache check with valid SQL
        let trace_id = "test_trace_123";
        let org_id = "test_org";
        let stream_type = StreamType::Logs;

        // Add the stream to the STREAM_SCHEMA_LATEST cache
        let schema = Schema::new(vec![
            Field::new("_timestamp", arrow_schema::DataType::Int64, false),
            Field::new("message", arrow_schema::DataType::Utf8, true),
        ]);
        {
            let mut w = STREAM_SCHEMAS_LATEST.write().await;
            w.insert(
                format!("{org_id}/{stream_type}/logs"),
                SchemaCache::new(schema),
            );
        } // Lock is dropped here before calling check_cache

        let mut req = Request {
            query: Query {
                sql: "SELECT _timestamp, message FROM logs WHERE _timestamp >= 1640995200000000 AND _timestamp <= 1641081600000000 ORDER BY _timestamp DESC LIMIT 100".to_string(),
                start_time: 1640995200000000,
                end_time: 1641081600000000,
                from: 0,
                size: 100,
                track_total_hits: false,
                query_fn: None,
                quick_mode: false,
                query_type: "sql".to_string(),
                uses_zo_fn: false,
                action_id: None,
                skip_wal: false,
                streaming_output: false,
                streaming_id: None,
                histogram_interval: 0,
                sampling_ratio: None,
                sampling_config: None,
            },
            encoding: RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: 30,
            search_type: Some(SearchEventType::UI),
            search_event_context: None,
            use_cache: true,
            clear_cache: false,
            local_mode: None,
        };
        let mut origin_sql = req.query.sql.clone();
        let file_path = "test_org/logs/test_stream".to_string();
        let is_aggregate = false;
        let mut should_exec_query = true;

        // Parse SQL to get metadata (new signature requires this)
        let query: SearchQuery = req.query.clone().into();
        let sql = Sql::new(&query, org_id, stream_type, req.search_type)
            .await
            .unwrap();
        let (result_ts_col, is_descending) =
            get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_aggregate).unwrap_or_default();

        let result = check_cache(
            trace_id,
            org_id,
            &mut req,
            &mut origin_sql,
            &file_path,
            is_aggregate,
            &sql,
            &result_ts_col,
            is_descending,
            &mut should_exec_query,
        )
        .await;

        assert!(result.cache_query_response);
        assert_eq!(result.ts_column, "_timestamp");
        assert!(result.is_descending);
        assert_eq!(result.limit, 100);
        assert_eq!(result.file_path, "test_org/logs/test_stream");
    }
}

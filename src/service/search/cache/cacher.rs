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
use chrono::Utc;
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{search::Response, sql::OrderBy, stream::StreamType},
    utils::{file::scan_files, json, time::now_micros},
};
use infra::cache::{
    file_data::disk::{self, QUERY_RESULT_CACHE},
    meta::ResultCacheMeta,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::cache::streaming_agg::STREAMING_AGGS_CACHE_DIR;
use proto::cluster_rpc::SearchQuery;

use crate::{
    common::meta::search::{CacheQueryRequest, CachedQueryResponse, QueryDelta},
    service::search::{
        cache::{
            MultiCachedQueryResponse,
            result_utils::{get_ts_value, round_down_to_nearest_minute},
        },
        sql::{
            RE_HISTOGRAM, RE_SELECT_FROM, Sql,
            visitor::histogram_interval::generate_histogram_interval,
        },
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
    stream_type: StreamType,
    req: &mut config::meta::search::Request,
    origin_sql: &mut String,
    file_path: &mut String,
    is_aggregate: bool,
    should_exec_query: &mut bool,
) -> MultiCachedQueryResponse {
    let start = std::time::Instant::now();

    let query: SearchQuery = req.query.clone().into();
    let sql = match Sql::new(&query, org_id, stream_type, req.search_type).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error parsing sql: {e}");
            return MultiCachedQueryResponse::default();
        }
    };

    // skip the queries with no timestamp column
    let ts_result = get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_aggregate);
    let order_by = sql.order_by;
    let mut result_ts_col = ts_result.map(|(ts_col, _)| ts_col);
    if result_ts_col.is_none() && (is_aggregate || !sql.group_by.is_empty()) {
        return MultiCachedQueryResponse {
            order_by,
            ..Default::default()
        };
    }

    // skip the count queries & queries first order by is not _timestamp field
    if req.query.track_total_hits
        || (!order_by.is_empty()
            && order_by.first().as_ref().unwrap().0 != TIMESTAMP_COL_NAME
            && (result_ts_col.is_none()
                || (result_ts_col.is_some()
                    && result_ts_col.as_ref().unwrap() != &order_by.first().as_ref().unwrap().0)))
    {
        return MultiCachedQueryResponse {
            order_by,
            ..Default::default()
        };
    }

    // Hack select for _timestamp
    if !is_aggregate && sql.group_by.is_empty() && order_by.is_empty() && !origin_sql.contains('*')
    {
        let caps = RE_SELECT_FROM.captures(origin_sql.as_str()).unwrap();
        let cap_str = caps.get(1).unwrap().as_str();
        if !cap_str.contains(TIMESTAMP_COL_NAME) {
            *origin_sql =
                origin_sql.replacen(cap_str, &format!("{TIMESTAMP_COL_NAME},{cap_str}"), 1);
        }
        req.query.sql = origin_sql.clone();
        result_ts_col = Some(TIMESTAMP_COL_NAME.to_string());
    }
    if !is_aggregate && origin_sql.contains('*') {
        result_ts_col = Some(TIMESTAMP_COL_NAME.to_string());
    }

    let result_ts_col = result_ts_col.unwrap();
    let mut discard_interval = -1;
    if let Some(interval) = sql.histogram_interval {
        *file_path = format!("{file_path}_{interval}_{result_ts_col}");

        let mut req_time_range = (req.query.start_time, req.query.end_time);
        if req_time_range.1 == 0 {
            req_time_range.1 = now_micros();
        }

        let meta_time_range_is_empty = sql.time_range.is_none() || sql.time_range == Some((0, 0));
        let q_time_range =
            if meta_time_range_is_empty && (req_time_range.0 > 0 || req_time_range.1 > 0) {
                Some(req_time_range)
            } else {
                sql.time_range
            };
        handle_histogram(origin_sql, q_time_range, req.query.histogram_interval);
        req.query.sql = origin_sql.clone();
        discard_interval = interval * 1000 * 1000; // in microseconds
    }
    // if req.query.size >= 0 {
    //     *file_path = format!("{}", file_path, req.query.from, req.query.size);
    // }
    let query_key = file_path.replace('/', "_");

    let mut is_descending = true;

    if !order_by.is_empty() {
        for (field, order) in &order_by {
            if field.eq(&result_ts_col) || field.replace("\"", "").eq(&result_ts_col) {
                is_descending = order == &OrderBy::Desc;
                break;
            }
        }
    }
    if is_aggregate && order_by.is_empty() && result_ts_col.is_empty() {
        return MultiCachedQueryResponse::default();
    }
    let mut multi_resp = MultiCachedQueryResponse::default();
    if discard_interval > -1 {
        multi_resp.histogram_interval = discard_interval / 1000 / 1000;
    }
    if get_config().common.use_multi_result_cache {
        let mut cached_responses =
            crate::service::search::cluster::cache_multi::get_cached_results(
                query_key.to_owned(),
                file_path.to_string(),
                trace_id.to_owned(),
                CacheQueryRequest {
                    q_start_time: req.query.start_time,
                    q_end_time: req.query.end_time,
                    is_aggregate,
                    ts_column: result_ts_col.clone(),
                    discard_interval,
                    is_descending,
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

        let deltas = if total_hits == (sql.limit as usize) {
            *should_exec_query = false;
            vec![]
        } else {
            let (deltas, updated_start_time, cache_duration) = calculate_deltas_multi(
                &cached_responses,
                req.query.start_time,
                req.query.end_time,
                discard_interval,
            );
            multi_resp.total_cache_duration = cache_duration as usize;
            if let Some(start_time) = updated_start_time {
                req.query.start_time = start_time;
            }
            deltas
        };

        for res in cached_responses {
            if res.has_cached_data {
                multi_resp.has_cached_data = true;
                multi_resp.cached_response.push(res);
            }
        }

        if !deltas.is_empty() {
            let search_delta: Vec<QueryDelta> = deltas
                .iter()
                .filter(|d| !d.delta_removed_hits)
                .cloned()
                .collect();
            if search_delta.is_empty() {
                log::debug!("cached response found");
                *should_exec_query = false;
            } else {
                multi_resp.deltas = search_delta;
            }
        }
        multi_resp.cache_query_response = true;
        multi_resp.is_descending = is_descending;
        multi_resp.limit = sql.limit as i64;
        multi_resp.ts_column = result_ts_col;
        multi_resp.took = start.elapsed().as_millis() as usize;
        multi_resp.file_path = file_path.to_string();
        multi_resp.order_by = order_by;
        multi_resp
    } else {
        let c_resp = match crate::service::search::cluster::cacher::get_cached_results(
            query_key.to_owned(),
            file_path.to_string(),
            trace_id.to_owned(),
            CacheQueryRequest {
                q_start_time: req.query.start_time,
                q_end_time: req.query.end_time,
                is_aggregate,
                ts_column: result_ts_col.clone(),
                discard_interval,
                is_descending,
            },
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
                        cached_resp = responses[0].clone();
                    }
                    Err(e) => {
                        log::error!("Error invalidating cached response by stream min ts: {e:?}")
                    }
                }

                let mut deltas = vec![];
                calculate_deltas_v1(
                    &(ResultCacheMeta {
                        start_time: cached_resp.response_start_time,
                        end_time: cached_resp.response_end_time,
                        is_aggregate,
                        is_descending,
                    }),
                    req.query.start_time,
                    req.query.end_time,
                    &mut deltas,
                );

                let search_delta: Vec<QueryDelta> = deltas
                    .iter()
                    .filter(|d| !d.delta_removed_hits)
                    .cloned()
                    .collect();
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
        multi_resp.deltas = c_resp.deltas.clone();
        multi_resp.has_cached_data = c_resp.has_cached_data;
        multi_resp.is_descending = is_descending;
        multi_resp.cached_response.push(c_resp);
        multi_resp.took = start.elapsed().as_millis() as usize;
        multi_resp.cache_query_response = true;
        multi_resp.limit = sql.limit as i64;
        multi_resp.ts_column = result_ts_col;
        multi_resp.file_path = file_path.to_string();
        multi_resp.order_by = order_by;
        multi_resp
    }
}

pub async fn get_cached_results(
    file_path: &str,
    trace_id: &str,
    cache_req: CacheQueryRequest,
) -> Option<CachedQueryResponse> {
    let r = QUERY_RESULT_CACHE.read().await;
    let query_key = file_path.replace('/', "_");
    let is_cached = r.get(&query_key).cloned();
    drop(r);

    if let Some(cache_metas) = is_cached {
        match
            cache_metas
                .iter()
                .filter(|cache_meta| {
                    // to make sure there is overlap between cache time range and query time range
                    log::info!(
                        "[CACHE CANDIDATES {trace_id}] Got caches :get_cached_results: cache_meta.response_start_time: {}, cache_meta.response_end_time: {}",
                        cache_meta.start_time,
                        cache_meta.end_time
                    );
                    cache_meta.start_time <= cache_req.q_end_time &&
                        cache_meta.end_time >= cache_req.q_start_time
                })
                .max_by_key(|result| { result.end_time - result.start_time })
        {
            Some(matching_meta) => {
                let file_name = format!(
                    "{}_{}_{}_{}.json",
                    matching_meta.start_time,
                    matching_meta.end_time,
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
                let mut matching_cache_meta = matching_meta.clone();
                // calculate delta time range to fetch the delta data using search query
                let cfg = get_config();
                let discard_duration = cfg.common.result_cache_discard_duration * 1000 * 1000;

                let cache_duration = matching_cache_meta.end_time - matching_cache_meta.start_time;
                // return None if cache duration is less than 2 * discard_duration
                if
                    cache_duration <= discard_duration &&
                    matching_cache_meta.start_time >
                        Utc::now().timestamp_micros() - discard_duration
                {
                    return None;
                }

                match get_results(file_path, &file_name).await {
                    Ok(v) => {
                        let mut cached_response: Response = match json::from_str::<Response>(&v) {
                            Ok(v) => v,
                            Err(e) => {
                                log::error!(
                                    "[trace_id {trace_id}] Error parsing cached response: {e:?}"
                                );
                                return None;
                            }
                        };
                        let first_ts = get_ts_value(
                            &cache_req.ts_column,
                            cached_response.hits.first().unwrap()
                        );

                        let last_ts = get_ts_value(
                            &cache_req.ts_column,
                            cached_response.hits.last().unwrap()
                        );

                        let (hits_allowed_start_time, hits_allowed_end_time) = if
                            cache_req.discard_interval > 0
                        {
                            // calculation in line with date bin of datafusion
                            (
                                cache_req.q_start_time -
                                    (cache_req.q_start_time % cache_req.discard_interval),
                                cache_req.q_end_time -
                                    (cache_req.q_end_time % cache_req.discard_interval),
                            )
                        } else {
                            (cache_req.q_start_time, cache_req.q_end_time)
                        };
                        let discard_ts = if cache_req.is_descending {
                            if cache_req.discard_interval > 0 {
                                first_ts
                            } else {
                                // non-aggregate query
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
                            // non-aggregate query
                            let m_last_ts = round_down_to_nearest_minute(last_ts);
                            if Utc::now().timestamp_micros() - discard_duration < last_ts {
                                m_last_ts - discard_duration
                            } else {
                                last_ts
                            }
                        };

                        cached_response.hits.retain(|hit| {
                            let hit_ts = get_ts_value(&cache_req.ts_column, hit);
                            hit_ts <= hits_allowed_end_time &&
                                hit_ts >= hits_allowed_start_time &&
                                hit_ts < discard_ts
                        });

                        cached_response.total = cached_response.hits.len();
                        if cache_req.discard_interval < 0 {
                            matching_cache_meta.end_time = discard_ts;
                        }

                        log::info!(
                            "[CACHE RESULT {trace_id}] Get results from disk success for query key: {} with start time {} - end time {} ",
                            query_key,
                            matching_cache_meta.start_time,
                            matching_cache_meta.end_time
                        );
                        Some(CachedQueryResponse {
                            cached_response,
                            deltas: vec![],
                            has_cached_data: true,
                            cache_query_response: true,
                            response_start_time: matching_cache_meta.start_time,
                            response_end_time: matching_cache_meta.end_time,
                            ts_column: cache_req.ts_column.to_string(),
                            is_descending: cache_req.is_descending,
                            limit: -1,
                        })
                    }
                    Err(e) => {
                        log::error!("[trace_id {trace_id}] Get results from disk failed : {e}");
                        None
                    }
                }
            }
            None => {
                log::debug!("No matching cache found for query key: {query_key}");
                None
            }
        }
    } else {
        None
    }
}

pub fn calculate_deltas_v1(
    result_meta: &ResultCacheMeta,
    start_time: i64,
    end_time: i64,
    deltas: &mut Vec<QueryDelta>,
) -> bool {
    let mut has_pre_cache_delta = false;
    if start_time == result_meta.start_time && end_time == result_meta.end_time {
        // If query start time and end time are the same as cache times, return results from cache
        return has_pre_cache_delta;
    }

    // Query Start time < ResultCacheMeta start time & Query End time > ResultCacheMeta End time
    if end_time != result_meta.end_time {
        if end_time > result_meta.end_time {
            // q end time : 11:00, r end time : 10:45
            deltas.push(QueryDelta {
                delta_start_time: result_meta.end_time,
                delta_end_time: end_time,
                delta_removed_hits: false,
            });
        } else {
            deltas.push(QueryDelta {
                delta_start_time: end_time,
                delta_end_time: result_meta.end_time,
                delta_removed_hits: true,
            });
        }
    }
    // Query Start time > ResultCacheMeta start time & Query End time > ResultCacheMeta End time ->
    // typical last x min/hours/days of data
    if start_time != result_meta.start_time {
        if start_time > result_meta.start_time {
            // q start time : 10:00,  r start time : 09:00
            // Fetch data between ResultCacheMeta Start time & Query start time
            deltas.push(QueryDelta {
                delta_start_time: result_meta.start_time,
                delta_end_time: start_time,
                delta_removed_hits: true,
            });
        } else {
            deltas.push(QueryDelta {
                delta_start_time: start_time,
                delta_end_time: result_meta.start_time,
                delta_removed_hits: false,
            });
            has_pre_cache_delta = true;
        }
    }
    has_pre_cache_delta
}

pub async fn cache_results_to_disk(
    file_path: &str,
    file_name: &str,
    data: String,
) -> std::io::Result<()> {
    let file = format!("results/{file_path}/{file_name}");
    match disk::set(&file, Bytes::from(data)).await {
        Ok(_) => (),
        Err(e) => {
            log::error!("Error caching results to disk: {e}");
            return Err(std::io::Error::other("Error caching results to disk"));
        }
    }
    Ok(())
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
            if field.eq(&result_ts_col) || field.replace("\"", "").eq(&result_ts_col) {
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

#[tracing::instrument]
pub async fn delete_cache(path: &str) -> std::io::Result<bool> {
    let root_dir = disk::get_dir().await;
    // Part 1: delete the results cache
    let pattern = format!("{root_dir}/results/{path}");
    let prefix = format!("{root_dir}/");
    let files = scan_files(&pattern, "json", None).unwrap_or_default();
    let mut remove_files: Vec<String> = vec![];

    for file in files {
        match disk::remove(file.strip_prefix(&prefix).unwrap()).await {
            Ok(_) => remove_files.push(file),
            Err(e) => {
                log::error!("Error deleting cache: {e}");
                return Err(std::io::Error::other("Error deleting cache"));
            }
        }
    }

    // Part 2: delete the aggregation cache
    #[cfg(feature = "enterprise")]
    let mut aggs_remove_files: Vec<String> = vec![];
    #[cfg(feature = "enterprise")]
    {
        let aggs_pattern = format!("{root_dir}/{STREAMING_AGGS_CACHE_DIR}/{path}");
        let aggs_files = scan_files(&aggs_pattern, "arrow", None).unwrap_or_default();
        aggs_remove_files.extend(aggs_files);

        for file in aggs_remove_files {
            match disk::remove(file.strip_prefix(&prefix).unwrap()).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!("Error deleting cache: {e:?}");
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

fn handle_histogram(
    origin_sql: &mut String,
    q_time_range: Option<(i64, i64)>,
    histogram_interval: i64,
) {
    let caps = RE_HISTOGRAM.captures(origin_sql.as_str()).unwrap();
    let interval = if histogram_interval > 0 {
        format!("{histogram_interval} second")
    } else {
        let attrs = caps
            .get(1)
            .unwrap()
            .as_str()
            .split(',')
            .map(|v| v.trim().trim_matches(|v| (v == '\'' || v == '"')))
            .collect::<Vec<&str>>();

        attrs
            .get(1)
            .map_or_else(|| generate_histogram_interval(q_time_range), |v| *v)
            .to_string()
    };

    *origin_sql = origin_sql.replace(
        caps.get(0).unwrap().as_str(),
        &format!("histogram(_timestamp,'{interval}')"),
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
        log::info!(
            "meta time {} - {} - records {}",
            meta.response_start_time,
            meta.response_end_time,
            meta.cached_response.hits.len()
        );
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
            meta.response_start_time
        };
        if meta.response_start_time > current_end_time {
            // There is a gap (delta) between current coverage and the next meta
            deltas.push(QueryDelta {
                delta_start_time: current_end_time,
                delta_end_time,
                delta_removed_hits: false,
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
        // Adding histogram interval to the current end time to ensure the next query
        // fetches the data after the last cache result timestamp, thereby avoiding duplicates
        let mut expected_delta_start_time = current_end_time + histogram_interval.abs();
        if expected_delta_start_time > end_time {
            expected_delta_start_time = current_end_time;
        }
        deltas.push(QueryDelta {
            delta_start_time: expected_delta_start_time,
            delta_end_time: end_time,
            delta_removed_hits: false,
        });
    }

    // remove all deltas that are within the cache duration
    // deltas.retain(|d| d.delta_start_time >= new_start_time);

    deltas.sort(); // Sort the deltas to bring duplicates together
    deltas.dedup(); // Remove consecutive duplicates

    (deltas, None, cache_duration)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::Schema;
    use config::meta::{
        search::{Query, Request, RequestEncoding, Response, ResponseTook, SearchEventType},
        sql::OrderBy,
    };
    use datafusion::common::TableReference;
    use infra::schema::SchemaCache;

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
            delta_removed_hits: false,
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
            match_items: None,
            equal_items: hashbrown::HashMap::new(),
            prefix_items: hashbrown::HashMap::new(),
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
            use_inverted_index: false,
            index_condition: None,
            index_optimize_mode: None,
        };

        let result = get_ts_col_order_by(&sql, "_timestamp", false);
        assert!(result.is_some());
        let (ts_col, is_descending) = result.unwrap();
        assert_eq!(ts_col, "_timestamp");
        assert!(is_descending);
    }

    #[tokio::test]
    async fn test_invalidate_cached_response_by_stream_min_ts() {
        let mock_stream_min_ts = Utc::now().timestamp_micros() - 3600000000; // 1 hour ago

        let responses = vec![
            CachedQueryResponse {
                cached_response: Response {
                    took: 100,
                    took_detail: ResponseTook::default(),
                    columns: vec![],
                    hits: vec![serde_json::json!({"timestamp": "2025-01-01T10:00:00Z"})],
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
            },
            encoding: RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: 30,
            search_type: Some(SearchEventType::UI),
            search_event_context: None,
            use_cache: true,
            local_mode: None,
        };
        let mut origin_sql = req.query.sql.clone();
        let mut file_path = "test_org/logs/test_stream".to_string();
        let is_aggregate = false;
        let mut should_exec_query = true;

        let result = check_cache(
            trace_id,
            org_id,
            stream_type,
            &mut req,
            &mut origin_sql,
            &mut file_path,
            is_aggregate,
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

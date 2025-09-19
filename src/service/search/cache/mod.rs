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

use chrono::{TimeZone, Utc};
#[cfg(feature = "enterprise")]
use config::meta::projections::ProjectionColumnMapping;
use config::{
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        dashboards::usage_report::DashboardInfo,
        function::RESULT_ARRAY_SKIP_VRL,
        search::{self, ResponseTook},
        self_reporting::usage::{RequestStats, UsageType},
        sql::{OrderBy, resolve_stream_names},
        stream::StreamType,
    },
    utils::{
        base64,
        hash::Sum64,
        json,
        sql::{is_aggregate_query, is_eligible_for_histogram},
        time::{format_duration, second_micros},
    },
};
use infra::{
    cache::{file_data::disk::QUERY_RESULT_CACHE, meta::ResultCacheMeta},
    errors::Error,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::re_patterns::get_pattern_manager;
use proto::cluster_rpc::SearchQuery;
use result_utils::get_ts_value;
use tracing::Instrument;

use crate::{
    common::{
        meta::search::{CachedQueryResponse, MultiCachedQueryResponse, QueryDelta},
        utils::{functions, http::get_work_group},
    },
    service::{
        search::{
            self as SearchService,
            cache::cacher::check_cache,
            init_vrl_runtime,
            inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
        },
        self_reporting::{http_report_metrics, report_request_usage_stats},
    },
};

pub mod cacher;
pub mod multi;
pub mod result_utils;

// Define cache version
const CACHE_VERSION: &str = "v2";

#[tracing::instrument(name = "service:search:cacher:search", skip_all)]
#[allow(clippy::too_many_arguments)]
pub async fn search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    in_req: &search::Request,
    range_error: String,
    is_http2_streaming: bool,
    dashboard_info: Option<DashboardInfo>,
    is_multi_stream_search: bool,
) -> Result<search::Response, Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();
    let cfg = get_config();
    // result cache can be enable only when its from the start
    let use_cache = if in_req.query.from == 0 {
        in_req.use_cache
    } else {
        false
    };

    // Result caching check start
    let mut origin_sql = in_req.query.sql.clone();
    let is_aggregate = is_aggregate_query(&origin_sql).unwrap_or(true);
    let (stream_name, all_streams) = match resolve_stream_names(&origin_sql) {
        // result cache doesn't support multiple stream names
        Ok(v) => (v[0].clone(), v.join(",")),
        Err(e) => {
            return Err(Error::Message(e.to_string()));
        }
    };

    let mut req = in_req.clone();
    let mut query_fn = req
        .query
        .query_fn
        .as_ref()
        .map(|v| match base64::decode_url(v) {
            Ok(v) => v,
            Err(_) => v.to_string(),
        });
    let backup_query_fn = query_fn.clone();
    let is_result_array_skip_vrl = query_fn
        .as_ref()
        .map(|v| is_result_array_skip_vrl(v))
        .unwrap_or(false);
    if is_result_array_skip_vrl {
        query_fn = None;
    }

    let action = req
        .query
        .action_id
        .as_ref()
        .and_then(|v| svix_ksuid::Ksuid::from_str(v).ok());

    // calculate hash for the query with version
    let mut hash_body = vec![CACHE_VERSION.to_string(), origin_sql.to_string()];
    if let Some(vrl_function) = &query_fn {
        hash_body.push(vrl_function.to_string());
    }
    if let Some(action_id) = action {
        hash_body.push(action_id.to_string());
    }
    if !req.regions.is_empty() {
        hash_body.extend(req.regions.clone());
    }
    if !req.clusters.is_empty() {
        hash_body.extend(req.clusters.clone());
    }
    let mut h = config::utils::hash::gxhash::new();
    let hashed_query = h.sum64(&hash_body.join(","));

    let mut should_exec_query = true;

    let mut file_path = format!("{org_id}/{stream_type}/{stream_name}/{hashed_query}");
    let mut c_resp: MultiCachedQueryResponse = if use_cache {
        // if cache is used, we need to check the cache
        check_cache(
            trace_id,
            org_id,
            stream_type,
            &mut req,
            &mut origin_sql,
            &mut file_path,
            is_aggregate,
            &mut should_exec_query,
        )
        .await
    } else {
        // if cache is not used, we need to parse the sql to get the ts column and is descending
        let query: SearchQuery = req.query.clone().into();
        match crate::service::search::Sql::new(&query, org_id, stream_type, req.search_type).await {
            Ok(v) => {
                let (ts_column, is_descending) =
                    cacher::get_ts_col_order_by(&v, TIMESTAMP_COL_NAME, is_aggregate)
                        .unwrap_or_default();

                let order_by = v.order_by;

                MultiCachedQueryResponse {
                    ts_column,
                    is_descending,
                    order_by,
                    ..Default::default()
                }
            }
            Err(e) => {
                log::error!("Error parsing sql: {e}");
                MultiCachedQueryResponse::default()
            }
        }
    };

    // No cache data present, add delta for full query
    if !c_resp.has_cached_data && c_resp.deltas.is_empty() {
        c_resp.deltas.push(QueryDelta {
            delta_start_time: req.query.start_time,
            delta_end_time: req.query.end_time,
            delta_removed_hits: false,
        });
    } else if use_cache {
        log::info!(
            "[trace_id {trace_id}] Query deltas are: {:?}",
            c_resp.deltas
        );
    }

    let search_role = "cache".to_string();

    // Result caching check ends, start search
    let cache_took = start.elapsed().as_millis() as usize;
    let mut results = Vec::new();
    let mut work_group_set = Vec::new();
    let mut res = if !should_exec_query {
        // no need to search, just merge the cached response
        // TODO: which case we don't need to search?
        merge_response(
            trace_id,
            &mut c_resp
                .cached_response
                .iter()
                .map(|r| r.cached_response.clone())
                .collect(),
            &mut vec![],
            &c_resp.ts_column,
            c_resp.limit,
            c_resp.is_descending,
            c_resp.took,
            c_resp.order_by,
        )
    } else {
        // run the searches
        if let Some(vrl_function) = &query_fn
            && !vrl_function.trim().ends_with('.')
        {
            query_fn = Some(format!("{vrl_function} \n ."));
        }
        req.query.query_fn = query_fn;

        for fn_name in functions::get_all_transform_keys(org_id).await {
            if req.query.sql.contains(&format!("{fn_name}(")) {
                req.query.uses_zo_fn = true;
                break;
            }
        }

        c_resp.deltas.sort();
        c_resp.deltas.dedup();
        let total = (req.query.end_time - req.query.start_time) as usize;
        let deltas_total: usize = c_resp
            .deltas
            .iter()
            .map(|d| (d.delta_end_time - d.delta_start_time) as usize)
            .sum();

        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] deltas are : {:?}", c_resp.deltas),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("cacher:search deltas".to_string())
                    .search_role(search_role.clone())
                    .duration(start.elapsed().as_millis() as usize)
                    .desc(format!(
                        "search cacher search from {} reduce to {}",
                        format_duration(total as u64 / 1000),
                        format_duration(deltas_total as u64 / 1000)
                    ))
                    .build()
            )
        );
        log::info!(
            "[trace_id {trace_id}] Query original start time: {}, end time : {}",
            req.query.start_time,
            req.query.end_time
        );

        let mut tasks = Vec::new();
        let partition_num = c_resp.deltas.len();
        // fire all the deltas search requests in parallel
        for (i, delta) in c_resp.deltas.into_iter().enumerate() {
            let mut req = req.clone();
            let org_id = org_id.to_string();
            let trace_id = if partition_num == 1 {
                trace_id.to_string()
            } else {
                format!("{trace_id}-{i}")
            };
            let user_id = user_id.clone();

            let enter_span = tracing::span::Span::current();
            let task = tokio::task::spawn(
                (async move {
                    let trace_id = trace_id.clone();
                    req.query.start_time = delta.delta_start_time;
                    req.query.end_time = delta.delta_end_time;

                    let cfg = get_config();
                    if cfg.common.result_cache_enabled
                        && cfg.common.print_key_sql
                        && c_resp.has_cached_data
                    {
                        log::info!(
                            "[trace_id {trace_id}] Query new start time: {}, end time : {}",
                            req.query.start_time,
                            req.query.end_time
                        );
                    }

                    SearchService::search(&trace_id, &org_id, stream_type, user_id, &req).await
                })
                .instrument(enter_span),
            );
            tasks.push(task);
        }

        for task in tasks {
            results.push(task.await.map_err(|e| Error::Message(e.to_string()))??);
        }
        for res in &results {
            work_group_set.push(res.work_group.clone());
        }
        // merge the cached response and the search response
        if c_resp.has_cached_data {
            merge_response(
                trace_id,
                &mut c_resp
                    .cached_response
                    .iter()
                    .map(|r| r.cached_response.clone())
                    .collect(),
                &mut results,
                &c_resp.ts_column,
                c_resp.limit,
                c_resp.is_descending,
                c_resp.took,
                c_resp.order_by,
            )
        } else {
            // if there is no cached response, we return the first search response, because there is
            // no delta, we only run a full time range search
            results[0].clone()
        }
    };

    // search is done
    let took_time = start.elapsed().as_secs_f64();
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] cache done"),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("summary".to_string())
                .search_role(search_role)
                .sql(req.query.sql.clone())
                .time_range((
                    req.query.start_time.to_string(),
                    req.query.end_time.to_string()
                ))
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );

    let work_group = get_work_group(work_group_set);

    let search_type = req
        .search_type
        .map(|t| t.to_string())
        .unwrap_or("".to_string());
    let search_group = work_group.clone().unwrap_or("".to_string());
    http_report_metrics(
        start,
        org_id,
        stream_type,
        "200",
        "_search",
        &search_type,
        &search_group,
    );

    res.set_trace_id(trace_id.to_string());
    res.set_took(took_time as usize);
    res.set_cache_took(cache_took);

    if is_aggregate
        && res.histogram_interval.is_none()
        && !c_resp.ts_column.is_empty()
        && c_resp.histogram_interval > -1
    {
        res.histogram_interval = Some(c_resp.histogram_interval);
    }

    let num_fn = req.query.query_fn.is_some() as u16;
    let req_stats = RequestStats {
        records: res.hits.len() as i64,
        response_time: took_time,
        size: res.scan_size as f64,
        scan_files: if res.scan_files > 0 {
            Some(res.scan_files as i64)
        } else {
            None
        },
        request_body: Some(req.query.sql.clone()),
        function: req.query.query_fn.clone(),
        user_email: user_id,
        min_ts: Some(req.query.start_time),
        max_ts: Some(req.query.end_time),
        cached_ratio: Some(res.cached_ratio),
        search_type: req.search_type,
        search_event_context: req.search_event_context.clone(),
        trace_id: Some(trace_id.to_string()),
        took_wait_in_queue: Some(res.took_detail.wait_in_queue),
        work_group,
        result_cache_ratio: Some(res.result_cache_ratio),
        dashboard_info,
        ..Default::default()
    };
    report_request_usage_stats(
        req_stats,
        org_id,
        &all_streams,
        stream_type,
        UsageType::Search,
        num_fn,
        started_at,
    )
    .await;

    if res.is_partial {
        let partial_err = "Please be aware that the response is based on partial data";
        res.function_error = if res.function_error.is_empty() {
            vec![partial_err.to_string()]
        } else {
            // check if the error is about the stream not found
            let mut skip_warning = false;
            for err in &res.function_error {
                if err.starts_with("Stream not found") {
                    skip_warning = true;
                    break;
                }
            }
            if !skip_warning {
                res.function_error.push(partial_err.to_string());
            }
            res.function_error
        }
    }
    if !range_error.is_empty() {
        res.is_partial = true;
        let range_error_str = range_error.clone();
        res.function_error = if res.function_error.is_empty() {
            vec![range_error_str]
        } else {
            res.function_error.push(range_error_str);
            res.function_error
        };
        res.new_start_time = Some(req.query.start_time);
        res.new_end_time = Some(req.query.end_time);
    }

    res.is_histogram_eligible = is_eligible_for_histogram(&req.query.sql, is_multi_stream_search)
        .ok()
        .map(|(is_eligible, _)| is_eligible);

    // There are 3 types of partial responses:
    // 1. VRL error
    // 2. Super cluster error
    // 3. Range error (max_query_limit)

    // result cache save changes start
    let should_cache_results = cfg.common.result_cache_enabled
        && !is_http2_streaming
        && should_exec_query
        && c_resp.cache_query_response
        && res.new_start_time.is_none()
        && res.new_end_time.is_none()
        && res.function_error.is_empty()
        && !res.hits.is_empty();
    if should_cache_results
        && (results.first().is_some_and(|res| !res.hits.is_empty())
            || results.last().is_some_and(|res| !res.hits.is_empty()))
    {
        write_results(
            trace_id,
            &c_resp.ts_column,
            req.query.start_time,
            req.query.end_time,
            deep_copy_response(&res),
            file_path,
            is_aggregate,
            c_resp.is_descending,
        )
        .await;
    }
    // result cache save changes Ends

    #[cfg(feature = "enterprise")]
    crate::service::search::cache::apply_regex_to_response(
        &req,
        org_id,
        &stream_name,
        stream_type,
        &mut res,
    )
    .await?;

    if is_result_array_skip_vrl {
        res.hits = apply_vrl_to_response(backup_query_fn, &mut res, org_id, &stream_name, trace_id);
        return Ok(res);
    }

    Ok(res)
}

// based on _timestamp of first record in config::meta::search::Response either add it in start
// or end to cache response
#[tracing::instrument(name = "service:search:cache:merge_response", skip_all)]
#[allow(clippy::too_many_arguments)]
pub fn merge_response(
    trace_id: &str,
    cache_responses: &mut Vec<config::meta::search::Response>,
    search_response: &mut Vec<config::meta::search::Response>,
    ts_column: &str,
    limit: i64,
    is_descending: bool,
    cache_took: usize,
    order_by: Vec<(String, OrderBy)>,
) -> config::meta::search::Response {
    cache_responses.retain(|res| !res.hits.is_empty());
    search_response.retain(|res| !res.hits.is_empty());

    if cache_responses.is_empty() && search_response.is_empty() {
        return config::meta::search::Response::default();
    }
    let mut fn_error = vec![];

    let mut cache_response = if cache_responses.is_empty() {
        config::meta::search::Response::default()
    } else {
        let mut resp = config::meta::search::Response::default();
        for res in cache_responses {
            resp.total += res.total;
            resp.scan_size += res.scan_size;
            resp.scan_records += res.scan_records;
            if res.hits.is_empty() {
                continue;
            }
            resp.hits.extend(res.hits.clone());
            resp.histogram_interval = res.histogram_interval;
            if !res.function_error.is_empty() {
                fn_error.extend(res.function_error.clone());
            }
        }
        resp.took = cache_took;
        resp
    };

    if cache_response.hits.is_empty()
        && !search_response.is_empty()
        && search_response
            .first()
            .is_none_or(|res| res.hits.is_empty())
        && search_response.last().is_none_or(|res| res.hits.is_empty())
    {
        for res in search_response {
            cache_response.total += res.total;
            cache_response.scan_size += res.scan_size;
            cache_response.took += res.took;
            cache_response.histogram_interval = res.histogram_interval;
            if !res.function_error.is_empty() {
                fn_error.extend(res.function_error.clone());
            }
        }
        cache_response.function_error = fn_error;
        return cache_response;
    }
    let cache_hits_len = cache_response.hits.len();

    cache_response.scan_size = 0;

    let mut files_cache_ratio = 0;
    let mut result_cache_len = 0;

    let mut res_took = ResponseTook::default();

    for res in search_response.clone() {
        cache_response.total += res.total;
        cache_response.scan_size += res.scan_size;
        cache_response.took += res.took;
        files_cache_ratio += res.cached_ratio;
        cache_response.histogram_interval = res.histogram_interval;

        result_cache_len += res.total;

        if res.hits.is_empty() {
            continue;
        }
        // here the searches in paralles, so we use the max value of the took_detail
        res_took.idx_took = std::cmp::max(res_took.idx_took, res.took_detail.idx_took);
        res_took.wait_in_queue =
            std::cmp::max(res_took.wait_in_queue, res.took_detail.wait_in_queue);
        res_took.search_took = std::cmp::max(res_took.search_took, res.took_detail.search_took);
        res_took.file_list_took =
            std::cmp::max(res_took.file_list_took, res.took_detail.file_list_took);
        if !res.function_error.is_empty() {
            fn_error.extend(res.function_error.clone());
        }

        cache_response.hits.extend(res.hits.clone());
    }
    sort_response(is_descending, &mut cache_response, ts_column, &order_by);

    if cache_response.hits.len() > (limit as usize) {
        cache_response.hits.truncate(limit as usize);
    }
    if limit > 0 {
        cache_response.total = cache_response.hits.len();
    }

    if !search_response.is_empty() {
        cache_response.cached_ratio = files_cache_ratio / search_response.len();
    }
    cache_response.size = cache_response.hits.len() as i64;
    log::info!(
        "[trace_id {trace_id}] cache_response.hits.len: {}, Result cache len: {}",
        cache_hits_len,
        result_cache_len
    );
    cache_response.took_detail = res_took;
    cache_response.order_by = search_response
        .first()
        .map(|res| res.order_by)
        .unwrap_or_default();
    cache_response.order_by_metadata = search_response
        .first()
        .map(|res| res.order_by_metadata.clone())
        .unwrap_or_default();
    cache_response.result_cache_ratio = (((cache_hits_len as f64) * 100_f64)
        / ((result_cache_len + cache_hits_len) as f64))
        as usize;
    if !fn_error.is_empty() {
        cache_response.function_error.extend(fn_error);
    }
    cache_response
}

fn sort_response(
    _is_descending: bool,
    cache_response: &mut search::Response,
    ts_column: &str,
    order_by: &Vec<(String, OrderBy)>,
) {
    if order_by.is_empty() {
        return;
    }

    cache_response.hits.sort_by(|a, b| {
        for (field, order) in order_by {
            let cmp = if ts_column == field {
                let a_ts = get_ts_value(ts_column, a);
                let b_ts = get_ts_value(ts_column, b);
                a_ts.partial_cmp(&b_ts).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                let a_val = a.get(field).unwrap_or(&serde_json::Value::Null);
                let b_val = b.get(field).unwrap_or(&serde_json::Value::Null);

                match (a_val, b_val) {
                    (serde_json::Value::String(a_str), serde_json::Value::String(b_str)) => {
                        a_str.cmp(b_str)
                    }
                    (serde_json::Value::Number(a_num), serde_json::Value::Number(b_num)) => {
                        if let (Some(a_f64), Some(b_f64)) = (a_num.as_f64(), b_num.as_f64()) {
                            a_f64
                                .partial_cmp(&b_f64)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        } else {
                            std::cmp::Ordering::Equal
                        }
                    }
                    (serde_json::Value::String(_), serde_json::Value::Number(_)) => {
                        std::cmp::Ordering::Less
                    }
                    (serde_json::Value::Number(_), serde_json::Value::String(_)) => {
                        std::cmp::Ordering::Greater
                    }
                    _ => std::cmp::Ordering::Equal,
                }
            };

            // Apply order direction
            let final_cmp = if order == &OrderBy::Desc {
                cmp.reverse()
            } else {
                cmp
            };

            // If this field comparison is not equal, return the result
            // Otherwise, continue to the next field
            if final_cmp != std::cmp::Ordering::Equal {
                return final_cmp;
            }
        }

        // If all fields are equal, maintain stable sort
        std::cmp::Ordering::Equal
    });
}

/// Caches search results to disk after applying filtering and validation strategies.
///
/// # Caching Strategy
///
/// 1. **Remove incomplete records for histogram**:
///    - Check the histogram interval, if the time range is not a multiple of the histogram
///      interval, we need to remove the incomplete records: first & last record.
///
/// 2. **Remove Records with Discard Duration**:
///    - Removes records that are older than the configured `discard_duration`.
///    - The `discard_duration` is the time difference between the current time and the time when
///      the record was created.
///    - The `discard_duration` is configured by `ZO_CACHE_DELAY_SECS`.
///
/// 3. **Skip Caching for Empty or Insufficient Hits**:
///    - If no hits remain after removing one, caching is skipped.
///    - Logs a message: `"No hits found for caching, skipping caching."`
///
/// 4. **Discard Short Time Ranges**:
///    - Skips caching if the difference between the first and last record timestamps is smaller
///      than the configured `discard_duration`.
///
/// 5. **Adjust Cache Time Range**:
///    - Adjusts the cache start and end times based on the smallest and largest timestamps:
///      - `start_time = max(smallest_ts, req_query_start_time)`
///      - `end_time = min(largest_ts, req_query_end_time)`
///
/// 6. **Cache to Disk**:
///    - Saves the filtered response to a file named:
///      `"<start_time>_<end_time>_<is_aggregate>_<is_descending>.json"`.
#[tracing::instrument(name = "service:search:cache:write_results", skip_all)]
#[allow(clippy::too_many_arguments)]
pub async fn write_results(
    trace_id: &str,
    ts_column: &str,
    req_query_start_time: i64,
    req_query_end_time: i64,
    mut res: config::meta::search::Response,
    file_path: String,
    is_aggregate: bool,
    is_descending: bool,
) {
    if res.hits.is_empty() {
        return;
    }

    // 1. remove incomplete records for histogram
    if let Some(interval) = res.histogram_interval {
        let interval = interval * 1000 * 1000; // convert to microseconds
        if req_query_start_time % interval != 0 || req_query_end_time % interval != 0 {
            res.hits.remove(0); // remove first record
            res.hits.pop(); // remove last record
            res.total = res.hits.len();
            res.size = res.hits.len() as i64;
        }
    }

    // 2. get the latest record, used to check if need to remove records with discard_duration
    let delay_ts = second_micros(get_config().limit.cache_delay_secs);
    let max_ts = Utc::now().timestamp_micros() - delay_ts;
    let remove_item = if is_descending {
        res.hits.first()
    } else {
        res.hits.last()
    };
    if let Some(item) = remove_item
        && let Some(val) = item.get(ts_column)
        && let Some(ts) = convert_ts_value_to_datetime(val)
        && ts.timestamp_micros() > max_ts
    {
        res.hits.retain(|hit| {
            if let Some(hit_ts) = hit.get(ts_column)
                && let Some(hit_ts_datetime) = convert_ts_value_to_datetime(hit_ts)
            {
                hit_ts_datetime.timestamp_micros() <= max_ts
            } else {
                true
            }
        });
        res.total = res.hits.len();
        res.size = res.hits.len() as i64;
    }

    // 3. check if the hits is empty
    if res.hits.is_empty() {
        log::info!("[trace_id {trace_id}] No hits found for caching, skipping caching");
        return;
    }

    // 4. check if the time range is less than discard_duration
    let last_rec_ts = get_ts_value(ts_column, res.hits.last().unwrap());
    let first_rec_ts = get_ts_value(ts_column, res.hits.first().unwrap());
    let cache_start_time = std::cmp::min(first_rec_ts, last_rec_ts);
    let mut cache_end_time = std::cmp::max(first_rec_ts, last_rec_ts);
    if (cache_end_time - cache_start_time) < delay_ts {
        return;
    }

    // 5. adjust the cache time range
    if let Some(interval) = res.histogram_interval {
        cache_end_time += interval * 1000 * 1000;
    }

    // 6. cache to disk
    let file_name = format!(
        "{}_{}_{}_{}.json",
        cache_start_time,
        cache_end_time,
        if is_aggregate { 1 } else { 0 },
        if is_descending { 1 } else { 0 }
    );
    let res_cache = json::to_string(&res).unwrap();
    let query_key = file_path.replace('/', "_");
    tokio::spawn(async move {
        match SearchService::cache::cacher::cache_results_to_disk(&file_path, &file_name, res_cache)
            .await
        {
            Ok(_) => {
                QUERY_RESULT_CACHE
                    .write()
                    .await
                    .entry(query_key)
                    .or_insert_with(Vec::new)
                    .push(ResultCacheMeta {
                        start_time: cache_start_time,
                        end_time: cache_end_time,
                        is_aggregate,
                        is_descending,
                    });
            }
            Err(e) => {
                log::error!("Cache results to disk failed: {e}");
            }
        }
    });
}

pub fn apply_vrl_to_response(
    backup_query_fn: Option<String>,
    res: &mut config::meta::search::Response,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
) -> Vec<serde_json::Value> {
    let query_fn = backup_query_fn.clone();
    let mut local_res = res.clone();

    local_res.hits = if let Some(query_fn) = query_fn
        && !local_res.hits.is_empty()
        && !local_res.is_partial
    {
        // compile vrl function & apply the same before returning the response
        let mut input_fn = query_fn.trim().to_string();

        let apply_over_hits = RESULT_ARRAY_SKIP_VRL.is_match(&input_fn);
        if apply_over_hits {
            input_fn = RESULT_ARRAY_SKIP_VRL.replace(&input_fn, "").to_string();
        }
        let mut runtime = init_vrl_runtime();
        let program = match crate::service::ingestion::compile_vrl_function(&input_fn, org_id) {
            Ok(program) => {
                let registry = program
                    .config
                    .get_custom::<vector_enrichment::TableRegistry>()
                    .unwrap();
                registry.finish_load();
                Some(program)
            }
            Err(err) => {
                log::error!("[trace_id {trace_id}] search->vrl: compile err: {err:?}");
                local_res.function_error.push(err.to_string());
                local_res.is_partial = true;
                None
            }
        };
        match program {
            Some(program) => {
                if apply_over_hits {
                    let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                        &mut runtime,
                        &config::meta::function::VRLResultResolver {
                            program: program.program.clone(),
                            fields: program.fields.clone(),
                        },
                        json::Value::Array(local_res.hits.clone()),
                        org_id,
                        &[stream_name.to_string()],
                    );
                    ret_val
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|v| {
                            (!v.is_null())
                                .then_some(config::utils::flatten::flatten(v.clone()).unwrap())
                        })
                        .collect()
                } else {
                    local_res
                        .hits
                        .into_iter()
                        .filter_map(|hit| {
                            let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                                &mut runtime,
                                &config::meta::function::VRLResultResolver {
                                    program: program.program.clone(),
                                    fields: program.fields.clone(),
                                },
                                hit,
                                org_id,
                                &[stream_name.to_string()],
                            );
                            (!ret_val.is_null())
                                .then_some(config::utils::flatten::flatten(ret_val).unwrap())
                        })
                        .collect()
                }
            }
            None => local_res.hits,
        }
    } else {
        local_res.hits
    };
    local_res.hits
}

#[tracing::instrument(name = "service:search:cacher:check_cache_v2", skip_all)]
pub async fn check_cache_v2(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    in_req: &search::Request,
    use_cache: bool,
) -> Result<MultiCachedQueryResponse, Error> {
    // Result caching check start
    let mut origin_sql = in_req.query.sql.clone();
    origin_sql = origin_sql.replace('\n', " ");
    let is_aggregate = is_aggregate_query(&origin_sql).unwrap_or_default();
    let stream_name = match resolve_stream_names(&origin_sql) {
        // TODO: cache don't not support multiple stream names
        Ok(v) => v[0].clone(),
        Err(e) => {
            return Err(Error::Message(e.to_string()));
        }
    };

    let mut req = in_req.clone();
    let query_fn = req
        .query
        .query_fn
        .as_ref()
        .and_then(|v| base64::decode_url(v).ok());

    // calculate hash for the query
    let mut hash_body = vec![origin_sql.to_string()];
    if let Some(vrl_function) = &query_fn {
        hash_body.push(vrl_function.to_string());
    }
    if !req.regions.is_empty() {
        hash_body.extend(req.regions.clone());
    }
    if !req.clusters.is_empty() {
        hash_body.extend(req.clusters.clone());
    }
    let mut h = config::utils::hash::gxhash::new();
    let hashed_query = h.sum64(&hash_body.join(","));

    let mut should_exec_query = true;

    let mut file_path = format!("{org_id}/{stream_type}/{stream_name}/{hashed_query}");
    Ok(if use_cache {
        let mut resp = check_cache(
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
        resp.is_aggregate = is_aggregate;
        resp.trace_id = trace_id.to_string();
        resp.file_path = file_path;
        resp
    } else {
        let query = req.query.into();
        match crate::service::search::Sql::new(&query, org_id, stream_type, req.search_type).await {
            Ok(v) => {
                let (ts_column, is_descending) =
                    cacher::get_ts_col_order_by(&v, TIMESTAMP_COL_NAME, is_aggregate)
                        .unwrap_or_default();

                MultiCachedQueryResponse {
                    ts_column,
                    is_descending,
                    file_path,
                    ..Default::default()
                }
            }
            Err(e) => {
                log::error!("[trace_id {trace_id}]: Error parsing sql: {e:?}");
                MultiCachedQueryResponse::default()
            }
        }
    })
}

fn convert_ts_value_to_datetime(ts_value: &serde_json::Value) -> Option<chrono::DateTime<Utc>> {
    match ts_value {
        // Handle the case where ts_value is a number (microseconds)
        serde_json::Value::Number(num) => {
            if let Some(micros) = num.as_i64() {
                // Convert microseconds to DateTime<Utc>
                chrono::DateTime::<Utc>::from_timestamp_micros(micros)
            } else {
                None
            }
        }
        // Handle the case where ts_value is a string (ISO 8601 format)
        serde_json::Value::String(ts_str) => {
            // Parse the string timestamp into a NaiveDateTime
            if let Ok(naive_dt) = chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S")
            {
                // Convert NaiveDateTime to DateTime<Utc>
                Some(Utc.from_utc_datetime(&naive_dt))
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn is_result_array_skip_vrl(vrl_fn: &str) -> bool {
    RESULT_ARRAY_SKIP_VRL.is_match(vrl_fn)
}

// Helper function to create a deep copy of a Response
fn deep_copy_response(res: &config::meta::search::Response) -> config::meta::search::Response {
    let serialized = serde_json::to_string(res).expect("Failed to serialize response");
    serde_json::from_str(&serialized).expect("Failed to deserialize response")
}

#[cfg(feature = "enterprise")]
pub async fn apply_regex_to_response(
    req: &config::meta::search::Request,
    org_id: &str,
    all_streams: &str,
    stream_type: StreamType,
    res: &mut config::meta::search::Response,
) -> Result<(), infra::errors::Error> {
    if res.hits.is_empty() {
        return Ok(());
    }

    let pattern_manager = get_pattern_manager().await?;

    let query: proto::cluster_rpc::SearchQuery = req.query.clone().into();
    let sql =
        match crate::service::search::sql::Sql::new(&query, org_id, stream_type, req.search_type)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("Error parsing sql: {e}");
                return Ok(());
            }
        };

    let projections: std::collections::HashMap<String, Vec<ProjectionColumnMapping>> =
        crate::service::search::datafusion::plan::regex_projections::get_columns_from_projections(
            sql,
        )
        .await?;

    match pattern_manager.process_at_search(org_id, StreamType::Logs, &mut res.hits, projections) {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!("error in processing records for patterns for stream {all_streams} : {e}");
            Err(infra::errors::Error::Message(e.to_string()))
        }
    }
}

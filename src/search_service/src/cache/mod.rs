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

use ::search::{CachedQueryResponse, MultiCachedQueryResponse, QueryDelta};
use chrono::{TimeZone, Utc};
use common::utils::http::get_work_group;
use config::{
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        dashboards::usage_report::DashboardInfo,
        function::RESULT_ARRAY_SKIP_VRL,
        histogram_origin::histogram_bucket_offset,
        search::{self, PARTIAL_ERROR_RESPONSE_MESSAGE, ResponseTook},
        self_reporting::usage::{RequestStats, UsageType},
        sql::{OrderBy, resolve_stream_names},
        stream::StreamType,
    },
    utils::{
        base64,
        hash::Sum64,
        json,
        sql::{is_complex_query, is_eligible_for_histogram, is_time_splittable},
        time::{format_duration, now_micros, second_micros},
    },
};
use infra::{
    cache::{
        file_data::disk::{self, QUERY_RESULT_CACHE},
        meta::ResultCacheMeta,
    },
    errors::Error,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use proto::cluster_rpc::SearchQuery;
use result_utils::get_ts_value;
use tracing::Instrument;
use transform::{get_all_transform_keys, init_vrl_runtime};
use usage_reporting::{http_report_metrics, report_request_usage_stats};

#[cfg(feature = "vectorscan")]
use crate::datafusion::physical_optimizer::sdr_redact::redaction_digest;
use crate::{
    self as SearchService,
    cache::{cacher::check_cache, result_utils::extract_timestamp_range},
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    sql::{RE_SELECT_FROM, histogram::pin_histogram_timezone},
};

pub mod cacher;
pub mod multi;
pub mod result_utils;

// Define cache version
// v5 keys the histogram offset into the hash; older entries may carry shifted labels.
const CACHE_VERSION: &str = "v5";

/// How a search may use the result cache; only `ReadWrite` and `Refresh` ever write it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheMode {
    Bypass,
    ReadWrite,
    /// `clear_cache`: skip the read, then replace the entry with this run's results.
    Refresh,
}

impl CacheMode {
    pub fn from_request(req: &search::Request) -> Self {
        if req.use_cache {
            Self::ReadWrite
        } else if req.clear_cache {
            Self::Refresh
        } else {
            Self::Bypass
        }
    }
}

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
    let cache_mode = match CacheMode::from_request(in_req) {
        // a streaming partition is cached as part of the merged page, never on its own
        CacheMode::Refresh if is_http2_streaming => CacheMode::Bypass,
        mode => mode,
    };

    let mut req = in_req.clone();
    pin_histogram_timezone(
        &mut req.query.sql,
        &mut req.query.timezone,
        req.query.end_time,
    )?;

    // check the original query function first
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

    // Result caching check start
    let (mut c_resp, should_exec_query) =
        prepare_cache_response(trace_id, org_id, stream_type, &mut req, cache_mode).await?;
    let file_path = c_resp.file_path.clone();

    // get the modified original sql from req
    let origin_sql = in_req.query.sql.clone();
    let is_complex_query = is_complex_query(&origin_sql).unwrap_or(true);
    let (stream_name, all_streams) = match resolve_stream_names(&origin_sql) {
        // result cache doesn't support multiple stream names
        Ok(v) => (v[0].clone(), v.join(",")),
        Err(e) => {
            return Err(Error::Message(e.to_string()));
        }
    };

    // No cache data present, add delta for full query
    if !c_resp.has_cached_data && c_resp.deltas.is_empty() {
        c_resp.deltas.push(QueryDelta {
            delta_start_time: req.query.start_time,
            delta_end_time: req.query.end_time,
        });
    } else if c_resp.cache_query_response && c_resp.deltas.is_empty() {
        log::info!("[trace_id {trace_id}] Query hit full cache");
    }

    #[allow(unused_mut)]
    let mut search_role = "leader".to_string();
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        search_role = "super".to_string();
    }

    // Result caching check ends, start search
    let cache_took = start.elapsed().as_millis() as usize;
    let mut work_group_set = Vec::new();
    let mut search_results_have_hits = false;
    let mut res = if !should_exec_query {
        // no need to search, just merge the cached response
        // TODO: which case we don't need to search?
        merge_response(
            trace_id,
            c_resp
                .cached_response
                .into_iter()
                .map(|r| r.cached_response)
                .collect(),
            vec![],
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

        for fn_name in get_all_transform_keys(org_id).await {
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
                format!(
                    "[trace_id {trace_id}] Qeury deltas are: {:?}",
                    c_resp.deltas
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
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
            "[trace_id {trace_id}] Query original start time: {}, end time: {}",
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
                            "[trace_id {trace_id}] Query new start time: {}, end time: {}",
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

        // A public dashboard build owns its children: no delta may outlive a failed call.
        let drain = in_req.search_type == Some(search::SearchEventType::PublicDashboard);
        // Deltas run as `{trace_id}-{n}`; the failing parent goes with them.
        let (org, family) = (org_id.to_string(), trace_id.to_string());
        let mut results = join_deltas(tasks, drain, move || async move {
            crate::abort_trace_family(&org, &family).await
        })
        .await?;
        for res in &results {
            work_group_set.push(res.work_group.clone());
        }
        search_results_have_hits = results.first().is_some_and(|res| !res.hits.is_empty())
            || results.last().is_some_and(|res| !res.hits.is_empty());
        // merge the cached response and the search response
        if c_resp.has_cached_data {
            merge_response(
                trace_id,
                c_resp
                    .cached_response
                    .into_iter()
                    .map(|r| r.cached_response)
                    .collect(),
                results,
                &c_resp.ts_column,
                c_resp.limit,
                c_resp.is_descending,
                c_resp.took,
                c_resp.order_by,
            )
        } else {
            let mut reps = results.swap_remove(0);
            sort_response(
                c_resp.is_descending,
                &mut reps,
                &c_resp.ts_column,
                &c_resp.order_by,
            );
            reps
        }
    };

    // search is done
    let took_time = start.elapsed().as_secs_f64();
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] search for cache is done, took: {} ms",
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .org_id(org_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("summary".to_string())
                .search_role(search_role)
                .sql(req.query.sql.clone())
                .time_range((
                    req.query.start_time.to_string(),
                    req.query.end_time.to_string()
                ))
                .scan_size(res.scan_size as usize)
                .scan_records(res.scan_records as usize)
                .data_records(res.hits.len())
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

    if is_complex_query
        && res.histogram_interval.is_none()
        && !c_resp.ts_column.is_empty()
        && c_resp.histogram_interval > 0
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
        peak_memory_usage: res.peak_memory_usage,
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
        let partial_err = PARTIAL_ERROR_RESPONSE_MESSAGE;
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

    res.is_histogram_eligible =
        is_eligible_for_histogram(&req.query.sql, is_multi_stream_search).ok();

    // There are 3 types of partial responses:
    // 1. VRL error
    // 2. Super cluster error
    // 3. Range error (max_query_limit)

    // result cache save changes start
    let should_cache_results = cfg.common.result_cache_enabled
        && !is_http2_streaming
        && should_exec_query
        && !file_path.is_empty()
        && res.new_start_time.is_none()
        && res.new_end_time.is_none()
        && res.function_error.is_empty()
        && !res.hits.is_empty();
    log::info!(
        "[trace_id {trace_id}] should_cache_results: {should_cache_results}, is_http2_streaming: {is_http2_streaming}, hits: {}",
        res.hits.len()
    );
    if should_cache_results && search_results_have_hits {
        write_results(
            trace_id,
            &c_resp.ts_column,
            req.query.start_time,
            req.query.end_time,
            &res,
            file_path,
            is_complex_query,
            c_resp.is_descending,
            req.clear_cache,
        )
        .await;
    }
    // result cache save changes Ends

    if is_result_array_skip_vrl {
        res.hits = apply_vrl_to_response(backup_query_fn, &mut res, org_id, &stream_name, trace_id);
        return Ok(res);
    }

    Ok(res)
}

#[tracing::instrument(name = "service:search:cacher:prepare_cache_response", skip_all)]
pub async fn prepare_cache_response(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &mut search::Request,
    cache_mode: CacheMode,
) -> Result<(MultiCachedQueryResponse, bool), Error> {
    let mut origin_sql = req.query.sql.clone();
    let is_complex_query = is_complex_query(&origin_sql).unwrap_or(true);
    let stream_name = match resolve_stream_names(&origin_sql) {
        // result cache doesn't support multiple stream names
        Ok(v) => {
            if v.is_empty() {
                return Err(Error::Message("Stream name is empty".to_string()));
            } else {
                v[0].clone()
            }
        }
        Err(e) => {
            return Err(Error::Message(e.to_string()));
        }
    };

    let mut query_fn = req
        .query
        .query_fn
        .as_ref()
        .map(|v| match base64::decode_url(v) {
            Ok(v) => v,
            Err(_) => v.to_string(),
        });
    let is_result_array_skip_vrl = query_fn
        .as_ref()
        .map(|v| is_result_array_skip_vrl(v))
        .unwrap_or(false);
    if is_result_array_skip_vrl {
        query_fn = None;
    }

    // Parse SQL first to get metadata needed for normalization
    let query: SearchQuery = req.query.clone().try_into()?;
    let mut sql = match crate::Sql::new(&query, org_id, stream_type, req.search_type).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error parsing sql: {e}");
            return Ok((MultiCachedQueryResponse::default(), true));
        }
    };

    // Normalize histogram interval in SQL before computing hash
    // This ensures the hash is consistent regardless of when handle_histogram is called
    if is_complex_query && sql.histogram_interval.is_some() {
        let mut req_time_range = (req.query.start_time, req.query.end_time);
        // If end_time is 0, it means "now" (current time)
        if req_time_range.1 == 0 {
            req_time_range.1 = now_micros();
        }

        let meta_time_range_is_empty = sql.time_range == (0, 0);
        let q_time_range =
            if meta_time_range_is_empty && (req_time_range.0 > 0 || req_time_range.1 > 0) {
                req_time_range
            } else {
                sql.time_range
            };
        crate::sql::histogram::handle_histogram(
            &mut origin_sql,
            q_time_range,
            req.query.histogram_interval,
        );
    }

    // calculate hash for the query with version (after normalizing histogram interval)
    let mut hash_body = vec![
        CACHE_VERSION.to_string(),
        origin_sql.to_string(),
        req.query.size.to_string(),
    ];
    if let Some(vrl_function) = &query_fn {
        hash_body.push(vrl_function.to_string());
    }
    if !req.regions.is_empty() {
        hash_body.extend(req.regions.clone());
    }
    if !req.clusters.is_empty() {
        hash_body.extend(req.clusters.clone());
    }
    #[cfg(feature = "vectorscan")]
    if let Some(digest) = redaction_digest(org_id, stream_type, &sql.stream_names) {
        hash_body.push(digest);
    }
    let mut h = config::utils::hash::gxhash::new();
    let hashed_query = h.sum64(&hash_body.join(","));

    let (mut ts_column, is_descending) =
        cacher::get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_complex_query).unwrap_or_default();

    // Refine ts_column for non-complex queries with SELECT * or missing _timestamp
    // Also modify the SQL to add _timestamp to SELECT clause if missing
    if !is_complex_query && origin_sql.contains('*') {
        ts_column = TIMESTAMP_COL_NAME.to_string();
    } else if !is_complex_query
        && sql.group_by.is_empty()
        && sql.order_by.is_empty()
        && !origin_sql.contains('*')
        && let Some(caps) = RE_SELECT_FROM.captures(&origin_sql)
        && let Some(cap) = caps.get(1)
    {
        let cap_str = cap.as_str();
        if !cap_str.contains(TIMESTAMP_COL_NAME) {
            // Add _timestamp to SELECT clause
            origin_sql =
                origin_sql.replacen(cap_str, &format!("{TIMESTAMP_COL_NAME},{cap_str}"), 1);
            req.query.sql = origin_sql.clone();
            ts_column = TIMESTAMP_COL_NAME.to_string();
        }
    }

    if cache_mode != CacheMode::ReadWrite && sql.histogram_offset != Some(0) {
        return Ok((
            MultiCachedQueryResponse {
                ts_column,
                is_descending,
                order_by: sql.order_by,
                ..Default::default()
            },
            true,
        ));
    }

    // #16175: sort, trim and cache checks compare ORDER BY with the column the hits carry
    if sql.histogram_offset.is_some() {
        sql.order_by = result_utils::normalize_ts_order_by(&sql.order_by, &ts_column, &sql.aliases);
    }

    let metadata = MultiCachedQueryResponse {
        ts_column,
        is_aggregate: is_complex_query,
        is_descending,
        order_by: sql.order_by.clone(),
        limit: sql.limit,
        ..Default::default()
    };
    if cache_mode == CacheMode::Bypass
        || !is_result_cacheable(req, stream_type, &sql, &metadata.ts_column)
    {
        return Ok((metadata, true));
    }

    let base_file_path = format!("{org_id}/{stream_type}/{stream_name}/{hashed_query}");
    let file_path = cacher::compute_cache_file_path(
        &base_file_path,
        is_complex_query,
        sql.histogram_interval,
        &metadata.ts_column,
    );
    if is_complex_query && sql.histogram_interval.is_some() {
        // the query must run the SQL that was normalized and hashed above
        req.query.sql = origin_sql.clone();
    }

    let mut should_exec_query = true;
    let resp = if cache_mode == CacheMode::ReadWrite {
        check_cache(
            trace_id,
            org_id,
            req,
            &file_path,
            is_complex_query,
            &sql,
            &metadata.ts_column,
            is_descending,
            &mut should_exec_query,
        )
        .await
    } else {
        MultiCachedQueryResponse {
            file_path,
            histogram_interval: sql
                .histogram_interval
                .filter(|_| is_complex_query)
                .unwrap_or(0),
            ..metadata
        }
    };
    Ok((resp, should_exec_query))
}

/// The one eligibility rule for reading, writing and refreshing a result-cache entry.
fn is_result_cacheable(
    req: &search::Request,
    stream_type: StreamType,
    sql: &crate::Sql,
    ts_column: &str,
) -> bool {
    req.query.from == 0
        && !req.query.track_total_hits
        && is_result_cache_allowed(stream_type)
        && !ts_column.is_empty()
        && sql.histogram_offset == Some(0)
        // #16650: a top-N ranked by another field cannot be split or reused across time ranges
        && !result_utils::is_ranked_by_non_timestamp(&sql.order_by, ts_column)
        && is_time_splittable(&req.query.sql).unwrap_or(false)
}

/// Awaits every delta; with `drain` the first error, in any order, aborts the rest and waits.
async fn join_deltas<T, F, Fut>(
    tasks: Vec<tokio::task::JoinHandle<Result<T, Error>>>,
    drain: bool,
    abort: F,
) -> Result<Vec<T>, Error>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    if !drain {
        let mut results = Vec::with_capacity(tasks.len());
        for task in tasks {
            results.push(task.await.map_err(|e| Error::Message(e.to_string()))??);
        }
        return Ok(results);
    }
    let mut slots: Vec<Option<T>> = tasks.iter().map(|_| None).collect();
    let mut pending: futures::stream::FuturesUnordered<_> = tasks
        .into_iter()
        .enumerate()
        .map(|(i, task)| async move { (i, task.await) })
        .collect();
    let mut abort = Some(abort);
    let mut first_err = None;
    while let Some((i, joined)) = futures::StreamExt::next(&mut pending).await {
        match joined.map_err(|e| Error::Message(e.to_string())) {
            Ok(Ok(res)) => slots[i] = Some(res),
            Ok(Err(e)) | Err(e) => {
                if let Some(abort) = abort.take() {
                    abort().await;
                }
                first_err.get_or_insert(e);
            }
        }
    }
    first_err.map_or_else(|| Ok(slots.into_iter().flatten().collect()), Err)
}

// based on _timestamp of first record in config::meta::search::Response either add it in start
// or end to cache response
#[tracing::instrument(name = "service:search:cache:merge_response", skip_all)]
#[allow(clippy::too_many_arguments)]
pub fn merge_response(
    trace_id: &str,
    mut cached_responses: Vec<config::meta::search::Response>,
    mut search_responses: Vec<config::meta::search::Response>,
    ts_column: &str,
    limit: i64,
    is_descending: bool,
    cache_took: usize,
    order_by: Vec<(String, OrderBy)>,
) -> config::meta::search::Response {
    cached_responses.retain(|res| !res.hits.is_empty());
    search_responses.retain(|res| !res.hits.is_empty());

    if cached_responses.is_empty() && search_responses.is_empty() {
        return config::meta::search::Response::default();
    }
    let mut fn_error = vec![];

    let mut cache_response = if cached_responses.is_empty() {
        config::meta::search::Response::default()
    } else {
        let mut resp = config::meta::search::Response::default();
        for res in cached_responses {
            resp.total += res.total;
            resp.scan_size += res.scan_size;
            resp.scan_records += res.scan_records;
            if res.hits.is_empty() {
                continue;
            }
            resp.hits.extend(res.hits);
            resp.histogram_interval = res.histogram_interval;
            fn_error.extend(res.function_error);
        }
        resp.took = cache_took;
        resp
    };

    if cache_response.hits.is_empty()
        && !search_responses.is_empty()
        && search_responses
            .first()
            .is_none_or(|res| res.hits.is_empty())
        && search_responses
            .last()
            .is_none_or(|res| res.hits.is_empty())
    {
        for res in search_responses {
            cache_response.total += res.total;
            cache_response.scan_size += res.scan_size;
            cache_response.took += res.took;
            cache_response.histogram_interval = res.histogram_interval;
            fn_error.extend(res.function_error);
        }
        cache_response.function_error = fn_error;
        return cache_response;
    }
    let cached_hits_len = cache_response.hits.len();

    cache_response.scan_size = 0;

    let mut files_cache_ratio = 0;
    let mut search_hits_len = 0;

    let mut res_took = ResponseTook::default();

    let search_responses_len = search_responses.len();
    let (first_order_by, first_order_by_metadata, first_is_histogram_eligible) = search_responses
        .first()
        .map(|res| {
            (
                res.order_by,
                res.order_by_metadata.clone(),
                res.is_histogram_eligible,
            )
        })
        .unwrap_or_default();
    for res in search_responses {
        cache_response.total += res.total;
        cache_response.scan_size += res.scan_size;
        cache_response.took += res.took;
        files_cache_ratio += res.cached_ratio;
        cache_response.histogram_interval = res.histogram_interval;

        search_hits_len += res.total;

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
        fn_error.extend(res.function_error);

        cache_response.peak_memory_usage = Some(
            cache_response
                .peak_memory_usage
                .unwrap_or(0.0)
                .max(res.peak_memory_usage.unwrap_or(0.0)),
        );

        cache_response.hits.extend(res.hits);
    }
    sort_response(is_descending, &mut cache_response, ts_column, &order_by);

    if cache_response.hits.len() > (limit as usize) {
        cache_response.hits.truncate(limit as usize);
    }
    if limit > 0 {
        cache_response.total = cache_response.hits.len();
    }

    if let Some(ratio) = files_cache_ratio.checked_div(search_responses_len) {
        cache_response.cached_ratio = ratio;
    }
    cache_response.size = cache_response.hits.len() as i64;
    let total = cache_response.size;

    #[allow(unused_mut)]
    let mut search_role = "leader".to_string();
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        search_role = "super".to_string();
    }
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] total: {total}, cached hits: {cached_hits_len}, search hits: {search_hits_len}",
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("merge response".to_string())
                .desc(format!(
                    "total: {total}, cached hits: {cached_hits_len}, search hits: {search_hits_len}"
                ))
                .search_role(search_role)
                .build()
        )
    );

    cache_response.took_detail = res_took;
    cache_response.order_by = first_order_by;
    cache_response.order_by_metadata = first_order_by_metadata;
    cache_response.result_cache_ratio = (((cached_hits_len as f64) * 100_f64)
        / ((search_hits_len + cached_hits_len) as f64))
        as usize;
    if !fn_error.is_empty() {
        cache_response.function_error.extend(fn_error);
        cache_response.is_partial = true;
    }
    cache_response.is_histogram_eligible = first_is_histogram_eligible;
    cache_response
}

fn sort_response(
    is_descending: bool,
    cache_response: &mut search::Response,
    ts_column: &str,
    in_order_by: &Vec<(String, OrderBy)>,
) {
    let order_by = if in_order_by.is_empty() {
        &vec![(
            ts_column.to_string(),
            if is_descending {
                OrderBy::Desc
            } else {
                OrderBy::Asc
            },
        )]
    } else {
        in_order_by
    };

    let compare = |a: &serde_json::Value, b: &serde_json::Value| {
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
    };
    // a single fresh result already arrives in query order; sorting it again is pure cost
    if cache_response
        .hits
        .is_sorted_by(|a, b| compare(a, b) != std::cmp::Ordering::Greater)
    {
        return;
    }
    cache_response.hits.sort_by(compare);
}

/// Caches search results to disk after applying filtering and validation strategies.
///
/// # Caching Strategy
///
/// 1. **Remove incomplete records for histogram**:
///    - Check the histogram interval, if the time range is not a multiple of the histogram
///      interval, we need to remove the incomplete records: first & last record.
///
/// 2. **Discard Recent Data**:
///    - Clamps the cache end time to `now - ZO_CACHE_DELAY_SECS` so records that may still change
///      are not cached.
///
/// 3. **Discard Short Time Ranges**:
///    - Skips caching if the cacheable time range is smaller than `ZO_CACHE_DELAY_SECS`.
///
/// 4. **Skip Covered Ranges** (unless `clear_cache`):
///    - Skips caching when an existing cache entry already fully covers the time range.
///
/// 5. **Skip Caching for Empty Hits**:
///    - If no hits remain after filtering to the cacheable time range, caching is skipped.
///
/// 6. **Cache to Disk**:
///    - Saves the filtered response to a file named:
///      `"<start_time>_<end_time>_<is_aggregate>_<is_descending>.json"`.
///
/// 7. **Per-Key Entry Limit**:
///    - Evicts the entries with the oldest data range beyond the per-key entry limit.
#[tracing::instrument(name = "service:search:cache:write_results", skip_all)]
#[allow(clippy::too_many_arguments)]
pub async fn write_results(
    trace_id: &str,
    ts_column: &str,
    req_query_start_time: i64,
    req_query_end_time: i64,
    res: &config::meta::search::Response,
    file_path: String,
    is_aggregate: bool,
    is_descending: bool,
    clear_cache: bool,
) {
    if res.hits.is_empty() {
        return;
    }

    // 1. alignment time range for incomplete records for histogram
    let (accept_start_time, accept_end_time, need_adjust_end_time) = match res.histogram_interval {
        Some(interval) if is_aggregate && interval > 0 => histogram_cacheable_range(
            req_query_start_time,
            req_query_end_time,
            interval * 1000 * 1000,
        ),
        _ => (req_query_start_time, req_query_end_time, false),
    };

    // 2. check if need to remove records with discard_duration
    let delay_ts = second_micros(get_config().limit.cache_delay_secs);
    let accept_end_time = std::cmp::min(Utc::now().timestamp_micros() - delay_ts, accept_end_time);

    // 3. check if the time range is less than discard_duration
    if (accept_end_time - accept_start_time) < delay_ts {
        log::info!("[trace_id {trace_id}] Time range is too short for caching, skipping caching");
        return;
    }

    // 4. the cached time range, with the end time realigned for histogram
    let mut cache_end_time = accept_end_time;
    if need_adjust_end_time
        && is_aggregate
        && let Some(interval) = res.histogram_interval
        && interval > 0
    {
        cache_end_time += interval * 1000 * 1000;
    }
    let meta = ResultCacheMeta {
        start_time: accept_start_time,
        end_time: cache_end_time,
        is_aggregate,
        is_descending,
    };

    // 5. skip the write when an existing entry already fully covers this range;
    // checked before the deep copy and serialization below so a covered write costs nothing
    let query_key = file_path.replace('/', "_");
    if !clear_cache && is_range_already_cached(&query_key, &file_path, &meta).await {
        log::debug!(
            "[trace_id {trace_id}] Result cache already covers {accept_start_time} - {cache_end_time}, skip caching"
        );
        return;
    }

    // 6. filter the records to the accept time range
    let mut res = deep_copy_response(res);
    let (data_start_time, data_end_time) = extract_timestamp_range(&res.hits, ts_column);
    if data_start_time < accept_start_time || data_end_time > accept_end_time {
        res.hits.retain(|hit| {
            if let Some(hit_ts) = hit.get(ts_column)
                && let Some(hit_ts_datetime) = convert_ts_value_to_datetime(hit_ts)
            {
                let item_ts = hit_ts_datetime.timestamp_micros();
                // only keep the records within the accept time range
                item_ts >= accept_start_time && item_ts <= accept_end_time
            } else {
                true
            }
        });
        res.total = res.hits.len();
        res.size = res.hits.len() as i64;
    }
    if res.hits.is_empty() {
        log::info!("[trace_id {trace_id}] No hits found for caching, skipping caching");
        return;
    }

    // 7. cache to disk
    let file_name = disk::result_cache_file_name(&meta);
    let res_cache = json::to_string(&res).unwrap();
    let trace_id = trace_id.to_string();
    tokio::spawn(async move {
        match SearchService::cache::cacher::cache_results_to_disk(
            &trace_id,
            &file_path,
            &file_name,
            res_cache,
            clear_cache,
            Some(meta.start_time),
            Some(meta.end_time),
        )
        .await
        {
            Ok(success) => {
                // success: false means the file already exists on disk, skip indexing
                if success {
                    disk::add_result_cache_meta(&format!("results/{file_path}/{file_name}")).await;
                }
            }
            Err(e) => {
                log::error!("Cache results to disk failed: {e}");
            }
        }
    });
}

async fn is_range_already_cached(query_key: &str, file_path: &str, meta: &ResultCacheMeta) -> bool {
    let covering = {
        let r = QUERY_RESULT_CACHE.read().await;
        r.get(query_key).map_or(Vec::new(), |metas| {
            metas
                .iter()
                .filter(|m| {
                    m.is_aggregate == meta.is_aggregate
                        && m.is_descending == meta.is_descending
                        && m.start_time <= meta.start_time
                        && m.end_time >= meta.end_time
                })
                .cloned()
                .collect()
        })
    };
    for m in covering {
        let file_name = disk::result_cache_file_name(&m);
        // a covering meta only counts while its file is still indexed on disk
        if disk::indexed_file_guard(&format!("results/{file_path}/{file_name}"))
            .await
            .is_some()
        {
            return true;
        }
        cacher::remove_stale_cache_meta(file_path, &file_name, query_key, &m).await;
    }
    false
}

/// Shrinks `[start, end]` to whole `histogram()` buckets; the flag says whether the end moved.
fn histogram_cacheable_range(start: i64, end: i64, interval: i64) -> (i64, i64, bool) {
    let start_offset = histogram_bucket_offset(start, interval);
    let start = if start_offset == 0 {
        start
    } else {
        start - start_offset + interval
    };
    let end_offset = histogram_bucket_offset(end, interval);
    if end_offset == 0 {
        (start, end, false)
    } else {
        (start, end - end_offset - interval, true)
    }
}

pub fn apply_vrl_to_response(
    query_fn: Option<String>,
    res: &mut config::meta::search::Response,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
) -> Vec<serde_json::Value> {
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
        let program = match transform::compile_vrl_function(&input_fn, org_id) {
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
                res.function_error.push(err.to_string());
                None
            }
        };
        match program {
            Some(program) => {
                let mut vrl_errors = transform::VrlRunErrors::default();
                let out: Vec<serde_json::Value> = if apply_over_hits {
                    let row_count = local_res.hits.len();
                    let (ret_val, err) = transform::apply_vrl_fn_checked(
                        &mut runtime,
                        &config::meta::function::VRLResultResolver {
                            program: program.program.clone(),
                            fields: program.fields.clone(),
                        },
                        json::Value::Array(local_res.hits.clone()),
                        org_id,
                        &[stream_name.to_string()],
                    );
                    vrl_errors.record_rows(row_count, err);
                    ret_val
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|v| super::flatten_vrl_result(v.clone()))
                        .collect()
                } else {
                    local_res
                        .hits
                        .into_iter()
                        .filter_map(|hit| {
                            let (ret_val, err) = transform::apply_vrl_fn_checked(
                                &mut runtime,
                                &config::meta::function::VRLResultResolver {
                                    program: program.program.clone(),
                                    fields: program.fields.clone(),
                                },
                                hit,
                                org_id,
                                &[stream_name.to_string()],
                            );
                            vrl_errors.record(err);
                            super::flatten_vrl_result(ret_val)
                        })
                        .collect()
                };
                if let Some(msg) = vrl_errors.message() {
                    log::error!("[trace_id {trace_id}] Error applying vrl function: {msg}");
                    res.function_error.push(msg);
                }
                out
            }
            None => local_res.hits,
        }
    } else {
        local_res.hits
    };
    local_res.hits
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

pub fn is_result_cache_allowed(stream_type: StreamType) -> bool {
    // Enrichment tables ignore the time range, so a cached result plus its delta repeats rows.
    stream_type != StreamType::EnrichmentTables
}

// Helper function to create a deep copy of a Response
fn deep_copy_response(res: &config::meta::search::Response) -> config::meta::search::Response {
    let serialized = serde_json::to_string(res).expect("Failed to serialize response");
    serde_json::from_str(&serialized).expect("Failed to deserialize response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_prepare_histogram_response_ordering() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};

        let org_id = "histogram_response_ordering";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org_id}/logs/t"),
            SchemaCache::new(Schema::new(vec![Field::new(
                TIMESTAMP_COL_NAME,
                DataType::Int64,
                false,
            )])),
        );
        let cases = [("+08:00", false), ("+00:00", false), ("+08:00", true)];
        let orders = [
            ("", [30, 20, 10]),
            (" ORDER BY ts ASC", [10, 20, 30]),
            (" ORDER BY ts DESC", [30, 20, 10]),
            (" ORDER BY c DESC", [20, 10, 30]),
        ];
        for (offset, mixed_offsets) in cases {
            for (order, expected) in orders {
                for mode in [CacheMode::Bypass, CacheMode::ReadWrite, CacheMode::Refresh] {
                    let filter = if mixed_offsets {
                        " WHERE histogram(_timestamp, '1 hour', '+00:00') IS NOT NULL"
                    } else {
                        ""
                    };
                    let mut req = search::Request {
                        query: search::Query {
                            sql: format!(
                                "SELECT histogram(_timestamp, '1 hour', '{offset}') AS ts, count(*) AS c FROM t{filter} GROUP BY ts{order}"
                            ),
                            start_time: 1_735_689_600_000_000,
                            end_time: 1_735_776_000_000_000,
                            size: 100,
                            ..Default::default()
                        },
                        ..Default::default()
                    };
                    let (prepared, should_exec_query) = prepare_cache_response(
                        "histogram_response_ordering",
                        org_id,
                        StreamType::Logs,
                        &mut req,
                        mode,
                    )
                    .await
                    .unwrap();
                    let mut response = search::Response {
                        hits: vec![
                            json::json!({"ts": 20, "c": 3}),
                            json::json!({"ts": 30, "c": 1}),
                            json::json!({"ts": 10, "c": 2}),
                        ],
                        ..Default::default()
                    };
                    sort_response(
                        prepared.is_descending,
                        &mut response,
                        &prepared.ts_column,
                        &prepared.order_by,
                    );
                    let timestamps: Vec<_> = response
                        .hits
                        .iter()
                        .map(|hit| hit["ts"].as_i64().unwrap())
                        .collect();
                    assert_eq!(
                        timestamps, expected,
                        "offset={offset}, mixed={mixed_offsets}, order={order}, mode={mode:?}"
                    );
                    assert_eq!(prepared.ts_column, "ts");
                    assert!(should_exec_query);
                    assert!(!prepared.has_cached_data);
                    assert!(prepared.cached_response.is_empty());
                    assert!(prepared.deltas.is_empty());
                    if offset != "+00:00" || mixed_offsets {
                        assert!(!prepared.cache_query_response);
                        assert!(prepared.file_path.is_empty());
                    }
                }
            }
        }
        STREAM_SCHEMAS_LATEST
            .write()
            .await
            .remove(&format!("{org_id}/logs/t"));
    }

    #[tokio::test]
    async fn test_prepare_skips_queries_not_ordered_by_time() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};

        let org_id = "ranked_order_eligibility";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org_id}/logs/t"),
            SchemaCache::new(Schema::new(vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new("k", DataType::Utf8, true),
            ])),
        );
        let histogram =
            "SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM t GROUP BY ts";
        let cases = [
            (format!("{histogram} ORDER BY c DESC LIMIT 3"), "ts", false),
            (
                format!("{histogram} ORDER BY count(*) DESC LIMIT 3"),
                "ts",
                false,
            ),
            (format!("{histogram} ORDER BY 2 DESC LIMIT 3"), "ts", false),
            (
                format!("{histogram} ORDER BY count(*) DESC, ts ASC"),
                "ts",
                false,
            ),
            (
                format!("{histogram} ORDER BY ts ASC, count(*) DESC"),
                "ts",
                true,
            ),
            (
                "SELECT * FROM t ORDER BY k".to_string(),
                "_timestamp",
                false,
            ),
            (
                "SELECT * FROM t ORDER BY _timestamp DESC".to_string(),
                "_timestamp",
                true,
            ),
            (format!("{histogram} ORDER BY ts DESC"), "ts", true),
            (format!("{histogram} ORDER BY ts ASC, c DESC"), "ts", true),
            (format!("{histogram} ORDER BY 1 ASC, 2 DESC"), "ts", true),
        ];
        for (sql, ts_column, eligible) in cases {
            for mode in [CacheMode::Bypass, CacheMode::ReadWrite, CacheMode::Refresh] {
                let mut req = search::Request {
                    query: search::Query {
                        sql: sql.clone(),
                        start_time: 1_735_689_600_000_000,
                        end_time: 1_735_776_000_000_000,
                        size: 100,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let (prepared, should_exec_query) = prepare_cache_response(
                    "ranked_order_eligibility",
                    org_id,
                    StreamType::Logs,
                    &mut req,
                    mode,
                )
                .await
                .unwrap();
                let case = format!("sql={sql}, mode={mode:?}");
                assert!(should_exec_query, "{case}");
                assert_eq!(prepared.ts_column, ts_column, "{case}");
                assert_eq!(
                    !prepared.file_path.is_empty(),
                    eligible && mode != CacheMode::Bypass,
                    "{case}"
                );
                assert_eq!(
                    prepared.cache_query_response,
                    eligible && mode == CacheMode::ReadWrite,
                    "{case}"
                );
            }
        }
        STREAM_SCHEMAS_LATEST
            .write()
            .await
            .remove(&format!("{org_id}/logs/t"));
    }

    #[tokio::test]
    async fn test_prepare_needs_time_column_and_time_splittable_sql() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};

        let org_id = "time_split_eligibility";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org_id}/logs/t"),
            SchemaCache::new(Schema::new(vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new("k", DataType::Utf8, true),
            ])),
        );
        // (sql, ts column, eligible)
        let cases = [
            (
                "SELECT k, max(_timestamp) AS _timestamp, count(*) AS c FROM t GROUP BY k",
                "",
                false,
            ),
            (
                "SELECT max(_timestamp) AS _timestamp, count(*) AS c FROM t",
                "",
                false,
            ),
            (
                "SELECT k AS _timestamp, count(*) AS c FROM t GROUP BY k ORDER BY _timestamp DESC",
                "",
                false,
            ),
            (
                "SELECT s._timestamp AS _timestamp, s.c FROM (SELECT max(_timestamp) AS _timestamp, count(*) AS c FROM t) s ORDER BY _timestamp DESC",
                "",
                false,
            ),
            (
                "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 10 OFFSET 5",
                TIMESTAMP_COL_NAME,
                false,
            ),
            (
                "SELECT _timestamp AS ts, k FROM t WHERE k IN (SELECT k FROM t GROUP BY k HAVING count(*) > 1) ORDER BY ts DESC",
                "ts",
                false,
            ),
            (
                "SELECT _timestamp AS ts, row_number() OVER () AS rn FROM t ORDER BY ts DESC",
                "ts",
                false,
            ),
            (
                "SELECT histogram(_timestamp, '1 hour') AS ts, sum(count(*)) OVER (ORDER BY histogram(_timestamp, '1 hour')) AS cum FROM t GROUP BY ts ORDER BY ts",
                "ts",
                false,
            ),
            (
                "SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM t GROUP BY ts",
                "ts",
                true,
            ),
            (
                "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 10 OFFSET 0",
                TIMESTAMP_COL_NAME,
                true,
            ),
        ];
        for (sql, ts_column, eligible) in cases {
            for mode in [CacheMode::Bypass, CacheMode::ReadWrite, CacheMode::Refresh] {
                let mut req = search::Request {
                    query: search::Query {
                        sql: sql.to_string(),
                        start_time: 1_735_689_600_000_000,
                        end_time: 1_735_776_000_000_000,
                        size: 100,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let (prepared, should_exec_query) =
                    prepare_cache_response(org_id, org_id, StreamType::Logs, &mut req, mode)
                        .await
                        .unwrap();
                let case = format!("sql={sql}, mode={mode:?}");
                assert!(should_exec_query, "{case}");
                assert_eq!(prepared.ts_column, ts_column, "{case}");
                assert_eq!(
                    !prepared.file_path.is_empty(),
                    eligible && mode != CacheMode::Bypass,
                    "{case}"
                );
                assert_eq!(
                    prepared.cache_query_response,
                    eligible && mode == CacheMode::ReadWrite,
                    "{case}"
                );
                assert!(prepared.cached_response.is_empty(), "{case}");
            }
        }
        STREAM_SCHEMAS_LATEST
            .write()
            .await
            .remove(&format!("{org_id}/logs/t"));
    }

    #[test]
    fn test_cache_mode_from_request() {
        let cases = [
            (true, false, CacheMode::ReadWrite),
            (true, true, CacheMode::ReadWrite),
            (false, true, CacheMode::Refresh),
            (false, false, CacheMode::Bypass),
        ];
        for (use_cache, clear_cache, expected) in cases {
            let req = search::Request {
                use_cache,
                clear_cache,
                ..Default::default()
            };
            assert_eq!(CacheMode::from_request(&req), expected);
        }
    }

    #[tokio::test]
    async fn test_prepare_writes_only_when_mode_and_query_allow_it() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};

        let org_id = "cache_mode_write_gate";
        let schema = || {
            SchemaCache::new(Schema::new(vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new("k", DataType::Utf8, true),
            ]))
        };
        for stream_type in [StreamType::Logs, StreamType::EnrichmentTables] {
            STREAM_SCHEMAS_LATEST
                .write()
                .await
                .insert(format!("{org_id}/{stream_type}/t"), schema());
        }
        let rows = "SELECT * FROM t ORDER BY _timestamp DESC";
        let histogram =
            "SELECT histogram(_timestamp) AS ts, count(*) AS c FROM t GROUP BY ts ORDER BY ts";
        // (case, sql, stream type, track_total_hits, from, eligible)
        let cases = [
            ("rows", rows, StreamType::Logs, false, 0, true),
            ("histogram", histogram, StreamType::Logs, false, 0, true),
            ("track_total_hits", rows, StreamType::Logs, true, 0, false),
            ("later page", rows, StreamType::Logs, false, 10, false),
            (
                "enrichment",
                rows,
                StreamType::EnrichmentTables,
                false,
                0,
                false,
            ),
            (
                "ranked",
                "SELECT * FROM t ORDER BY k",
                StreamType::Logs,
                false,
                0,
                false,
            ),
        ];
        for (name, sql, stream_type, track_total_hits, from, eligible) in cases {
            let mut prepared_sql = Vec::new();
            for mode in [CacheMode::Bypass, CacheMode::ReadWrite, CacheMode::Refresh] {
                let mut req = search::Request {
                    query: search::Query {
                        sql: sql.to_string(),
                        start_time: 1_735_689_600_000_000,
                        end_time: 1_735_776_000_000_000,
                        size: 100,
                        from,
                        track_total_hits,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let (prepared, should_exec_query) =
                    prepare_cache_response(org_id, org_id, stream_type, &mut req, mode)
                        .await
                        .unwrap();
                let case = format!("{name}, mode={mode:?}");
                assert!(should_exec_query, "{case}");
                assert_eq!(
                    !prepared.file_path.is_empty(),
                    eligible && mode != CacheMode::Bypass,
                    "{case}"
                );
                assert_eq!(
                    prepared.cache_query_response,
                    eligible && mode == CacheMode::ReadWrite,
                    "{case}"
                );
                if name == "histogram" {
                    assert_eq!(
                        prepared.histogram_interval > 0,
                        mode != CacheMode::Bypass,
                        "{case}"
                    );
                }
                prepared_sql.push(req.query.sql);
            }
            // a refresh must store what a read would look up: the same normalized SQL
            assert_eq!(prepared_sql[1], prepared_sql[2], "{name}");
        }
        for stream_type in [StreamType::Logs, StreamType::EnrichmentTables] {
            STREAM_SCHEMAS_LATEST
                .write()
                .await
                .remove(&format!("{org_id}/{stream_type}/t"));
        }
    }

    #[test]
    fn test_histogram_cacheable_range_snaps_to_histogram_grid() {
        const HOUR: i64 = 3_600_000_000;
        const DAY: i64 = 24 * HOUR;
        // 2025-08-23 is a 30-day edge on the 2001 grid; 2025-09-09 is one on the epoch grid
        let thirty_day_edge = 1_755_907_200_000_000;
        let epoch_edge = 1_757_376_000_000_000;
        let cases = [
            (
                epoch_edge,
                epoch_edge + 60 * DAY,
                30 * DAY,
                (thirty_day_edge + 30 * DAY, thirty_day_edge + 30 * DAY, true),
            ),
            (
                thirty_day_edge,
                thirty_day_edge + 60 * DAY,
                30 * DAY,
                (thirty_day_edge, thirty_day_edge + 60 * DAY, false),
            ),
            (
                epoch_edge + HOUR,
                epoch_edge + 3 * DAY,
                DAY,
                (epoch_edge + DAY, epoch_edge + 3 * DAY, false),
            ),
        ];
        for (start, end, interval, expected) in cases {
            assert_eq!(
                histogram_cacheable_range(start, end, interval),
                expected,
                "start={start}, end={end}, interval={interval}"
            );
        }
    }

    #[test]
    fn test_result_cache_skips_enrichment_tables() {
        assert!(!is_result_cache_allowed(StreamType::EnrichmentTables));
        assert!(is_result_cache_allowed(StreamType::Logs));
    }

    #[test]
    fn test_apply_vrl_to_response_preserves_hits_on_compile_failure() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"nested": {"value": 42}})],
            ..Default::default()
        };
        let expected = response.hits.clone();
        let hits = apply_vrl_to_response(
            Some(". = [".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, expected);
    }

    #[test]
    fn test_apply_vrl_to_response_filters_null_per_record() {
        let mut response = config::meta::search::Response {
            hits: vec![
                json::json!({"drop": true}),
                json::json!({"drop": false, "nested": {"value": 42}}),
            ],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some("if .drop == true { . = null } else { del(.drop) }; .".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, vec![json::json!({"nested_value": 42})]);
    }

    #[test]
    fn test_apply_vrl_to_response_reports_runtime_error_in_function_error() {
        let mut response = config::meta::search::Response {
            hits: vec![
                json::json!({"m": "{\"a\":1}"}),
                json::json!({"m": "not json"}),
            ],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some(".x = parse_json!(.m)".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(response.function_error.len(), 1);
        assert!(
            response.function_error[0].starts_with("Query function failed on 1 of 2 rows: "),
            "{:?}",
            response.function_error
        );
    }

    #[test]
    fn test_apply_vrl_to_response_reports_compile_error_to_caller() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"m": "x"})],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some(".x = not_a_function(.m)".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, vec![json::json!({"m": "x"})]);
        assert_eq!(response.function_error.len(), 1);
        assert!(!response.function_error[0].is_empty());
        assert!(!response.is_partial);
    }

    #[test]
    fn test_apply_vrl_to_response_no_function_error_on_success() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"m": "{\"a\":1}"})],
            ..Default::default()
        };
        apply_vrl_to_response(
            Some(".x = parse_json!(.m)".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert!(response.function_error.is_empty());
    }

    #[test]
    fn test_apply_vrl_to_response_result_array_runtime_error_fails_every_row() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"a": 1}), json::json!({"a": 2})],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some("#ResultArray#SkipVRL#\n. = parse_json!(\"not json\")".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, vec![json::json!({"a": 1}), json::json!({"a": 2})]);
        assert_eq!(response.function_error.len(), 1);
        assert!(
            response.function_error[0].starts_with("Query function failed on 2 of 2 rows: "),
            "{:?}",
            response.function_error
        );
    }

    #[test]
    fn test_apply_vrl_to_response_result_array_success_has_no_function_error() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"a": 1}), json::json!({"a": 2})],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some("#ResultArray#SkipVRL#\n. = [{\"x\": 1}]".to_string()),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, vec![json::json!({"x": 1})]);
        assert!(response.function_error.is_empty());
    }

    #[test]
    fn test_apply_vrl_to_response_filters_null_array_items() {
        let mut response = config::meta::search::Response {
            hits: vec![json::json!({"input": true})],
            ..Default::default()
        };
        let hits = apply_vrl_to_response(
            Some(
                "#ResultArray#SkipVRL#\n. = [null, {\"nested\": {\"value\": 42}}, null]"
                    .to_string(),
            ),
            &mut response,
            "default",
            "test",
            "test",
        );
        assert_eq!(hits, vec![json::json!({"nested_value": 42})]);
    }

    #[test]
    fn test_is_result_array_skip_vrl() {
        let query_fn = r#"#ResultArray#SkipVRL#
        arr1_final = []
        for_each(array!(.)) -> |index, value| {
            value.arr = {"a": 4}
            arr1_final = push(arr1_final,value)
        }
        . = arr1_final"#;
        assert!(is_result_array_skip_vrl(query_fn));
    }

    #[test]
    fn test_convert_ts_value_to_datetime_number() {
        // 1_000_000 microseconds = 1 second after epoch
        let val = serde_json::Value::Number(serde_json::Number::from(1_000_000i64));
        let result = convert_ts_value_to_datetime(&val);
        assert!(result.is_some());
        assert_eq!(result.unwrap().timestamp(), 1);
    }

    #[test]
    fn test_convert_ts_value_to_datetime_string() {
        let val = serde_json::Value::String("2024-01-15T10:30:00".to_string());
        let result = convert_ts_value_to_datetime(&val);
        assert!(result.is_some());
        // 2024-01-15 00:00:00 UTC in seconds since epoch
        assert!(result.unwrap().timestamp() > 0);
    }

    #[test]
    fn test_convert_ts_value_to_datetime_invalid_string_returns_none() {
        let val = serde_json::Value::String("not-a-date".to_string());
        let result = convert_ts_value_to_datetime(&val);
        assert!(result.is_none());
    }

    #[test]
    fn test_convert_ts_value_to_datetime_null_returns_none() {
        let result = convert_ts_value_to_datetime(&serde_json::Value::Null);
        assert!(result.is_none());
    }

    #[test]
    fn test_is_result_array_skip_vrl_no_marker() {
        let query_fn = "just a normal query";
        assert!(!is_result_array_skip_vrl(query_fn));
    }

    #[tokio::test]
    async fn test_is_range_already_cached() {
        let file_path = "test_org_covered/logs/test_stream/hash_covered";
        let query_key = file_path.replace('/', "_");
        let cached = ResultCacheMeta {
            start_time: 1000,
            end_time: 5000,
            is_aggregate: false,
            is_descending: true,
        };
        QUERY_RESULT_CACHE
            .write()
            .await
            .insert(query_key.clone(), vec![cached.clone()]);
        let covering_file = format!(
            "results/{file_path}/{}",
            infra::cache::file_data::disk::result_cache_file_name(&cached)
        );
        infra::cache::file_data::disk::set_size(&covering_file, 1)
            .await
            .unwrap();

        let inner = ResultCacheMeta {
            start_time: 2000,
            end_time: 4000,
            ..cached.clone()
        };
        assert!(is_range_already_cached(&query_key, file_path, &inner).await);

        let wider = ResultCacheMeta {
            end_time: 6000,
            ..inner.clone()
        };
        assert!(!is_range_already_cached(&query_key, file_path, &wider).await);

        let ascending = ResultCacheMeta {
            is_descending: false,
            ..inner.clone()
        };
        assert!(!is_range_already_cached(&query_key, file_path, &ascending).await);

        // a covering meta whose file left the disk index no longer counts and is pruned
        infra::cache::file_data::disk::remove(&covering_file)
            .await
            .unwrap();
        assert!(!is_range_already_cached(&query_key, file_path, &inner).await);
        assert!(!QUERY_RESULT_CACHE.read().await.contains_key(&query_key));
    }

    #[tokio::test]
    async fn gate09_a_failed_delta_aborts_and_drains_its_siblings_before_returning() {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };
        let long_done = Arc::new(AtomicBool::new(false));
        let aborted = Arc::new(AtomicBool::new(false));
        let done = long_done.clone();
        let flag = aborted.clone();
        let seen = aborted.clone();
        // The long delta is first: the early failure must abort it while it still runs.
        let tasks = vec![
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                done.store(seen.load(Ordering::SeqCst), Ordering::SeqCst);
                Ok(1)
            }),
            tokio::spawn(async { Err::<u8, Error>(Error::Message("early".into())) }),
        ];
        let err = join_deltas(tasks, true, || async move {
            flag.store(true, Ordering::SeqCst);
        })
        .await
        .unwrap_err();
        assert_eq!(err.to_string(), Error::Message("early".into()).to_string());
        assert!(aborted.load(Ordering::SeqCst), "siblings are aborted");
        assert!(
            long_done.load(Ordering::SeqCst),
            "the abort fired while the long delta ran, and it was drained"
        );

        let tasks = vec![
            tokio::spawn(async { Err::<u8, Error>(Error::Message("early".into())) }),
            tokio::spawn(async { Ok(1) }),
        ];
        assert!(join_deltas(tasks, false, || async {}).await.is_err());
        let tasks = vec![
            tokio::spawn(async { Ok::<u8, Error>(1) }),
            tokio::spawn(async { Ok(2) }),
        ];
        assert_eq!(join_deltas(tasks, true, || async {}).await.unwrap(), [1, 2]);
    }

    fn response_with_ts(ts: &[i64]) -> search::Response {
        let hits = ts
            .iter()
            .map(|t| json::json!({"_timestamp": t, "name": format!("r{t}")}))
            .collect::<Vec<_>>();
        search::Response {
            total: hits.len(),
            scan_size: 1,
            cached_ratio: 50,
            hits,
            ..Default::default()
        }
    }

    fn ts_of(resp: &search::Response) -> Vec<i64> {
        resp.hits
            .iter()
            .map(|h| get_ts_value("_timestamp", h))
            .collect()
    }

    #[test]
    fn test_merge_response_moves_cached_and_search_hits_in_order() {
        let cached = vec![response_with_ts(&[10, 20])];
        let searched = vec![response_with_ts(&[40, 30]), response_with_ts(&[50])];
        let asc = merge_response(
            "t",
            cached.clone(),
            searched.clone(),
            "_timestamp",
            10,
            false,
            7,
            vec![],
        );
        assert_eq!(ts_of(&asc), vec![10, 20, 30, 40, 50]);
        assert_eq!(asc.total, 5);
        assert_eq!(asc.size, 5);
        assert_eq!(asc.scan_size, 2);
        assert_eq!(asc.cached_ratio, 50);
        assert_eq!(asc.result_cache_ratio, 40);

        let desc = merge_response("t", cached, searched, "_timestamp", 10, true, 7, vec![]);
        assert_eq!(ts_of(&desc), vec![50, 40, 30, 20, 10]);
    }

    #[test]
    fn test_merge_response_truncates_to_limit_after_sorting() {
        let merged = merge_response(
            "t",
            vec![response_with_ts(&[10, 20])],
            vec![response_with_ts(&[30, 40])],
            "_timestamp",
            3,
            true,
            0,
            vec![],
        );
        assert_eq!(ts_of(&merged), vec![40, 30, 20]);
        assert_eq!(merged.total, 3);
    }

    #[test]
    fn test_merge_response_without_any_hits_returns_empty_response() {
        let mut empty = response_with_ts(&[]);
        empty.total = 3;
        let merged = merge_response("t", vec![], vec![empty], "_timestamp", 10, true, 0, vec![]);
        assert!(merged.hits.is_empty());
        assert_eq!(merged.total, 0);
    }

    #[test]
    fn test_sort_response_reorders_unsorted_hits() {
        let mut resp = response_with_ts(&[30, 10, 20]);
        sort_response(true, &mut resp, "_timestamp", &vec![]);
        assert_eq!(ts_of(&resp), vec![30, 20, 10]);
        sort_response(false, &mut resp, "_timestamp", &vec![]);
        assert_eq!(ts_of(&resp), vec![10, 20, 30]);
    }

    #[test]
    fn test_sort_response_keeps_already_sorted_hits_untouched() {
        let mut resp = response_with_ts(&[30, 20, 20, 10]);
        let before = resp.hits.clone();
        sort_response(true, &mut resp, "_timestamp", &vec![]);
        assert_eq!(resp.hits, before);
    }

    #[test]
    fn test_sort_response_honours_explicit_order_by_field() {
        let mut resp = response_with_ts(&[10, 30, 20]);
        let order_by = vec![("name".to_string(), OrderBy::Desc)];
        sort_response(false, &mut resp, "_timestamp", &order_by);
        assert_eq!(ts_of(&resp), vec![30, 20, 10]);
    }

    fn response_with_alias_ts(ts: &[i64]) -> search::Response {
        let hits = ts
            .iter()
            .map(|t| json::json!({"ts": t, "status": "passed"}))
            .collect::<Vec<_>>();
        search::Response {
            total: hits.len(),
            hits,
            ..Default::default()
        }
    }

    fn alias_ts_of(resp: &search::Response) -> Vec<i64> {
        resp.hits.iter().map(|h| get_ts_value("ts", h)).collect()
    }

    // #16175: order_by keeps `_timestamp` while the hits carry only the alias `ts`
    fn alias_order_by() -> Vec<(String, OrderBy)> {
        result_utils::normalize_ts_order_by(
            &[(TIMESTAMP_COL_NAME.to_string(), OrderBy::Desc)],
            "ts",
            &[(TIMESTAMP_COL_NAME.to_string(), "ts".to_string())],
        )
    }

    #[test]
    fn test_sort_response_orders_by_aliased_timestamp() {
        let mut resp = response_with_alias_ts(&[10, 30, 20]);
        let order_by = alias_order_by();
        assert_eq!(order_by, vec![("ts".to_string(), OrderBy::Desc)]);
        sort_response(true, &mut resp, "ts", &order_by);
        assert_eq!(alias_ts_of(&resp), vec![30, 20, 10]);
    }

    #[test]
    fn test_merge_response_orders_aliased_timestamp_newest_first() {
        let order_by = alias_order_by();
        let merged = merge_response(
            "t",
            vec![response_with_alias_ts(&[20, 10])],
            vec![response_with_alias_ts(&[40, 30])],
            "ts",
            10,
            true,
            0,
            order_by,
        );
        assert_eq!(alias_ts_of(&merged), vec![40, 30, 20, 10]);
        // write_results() takes the time range from the first and last hit
        let (start, end) = result_utils::extract_timestamp_range(&merged.hits, "ts");
        assert_eq!((start, end), (10, 40));
    }
}

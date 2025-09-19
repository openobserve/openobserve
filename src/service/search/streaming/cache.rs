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

use std::time::Instant;

use config::meta::{
    search::{SearchEventType, StreamResponses, TimeOffset, ValuesEventContext},
    self_reporting::usage::{RequestStats, UsageType},
    sql::OrderBy,
    stream::StreamType,
};
use log;
use tokio::sync::mpsc;

use super::sorting::order_search_results;
use crate::{
    common::meta::search::{
        CachedQueryResponse, MultiCachedQueryResponse, QueryDelta, SearchResultType,
    },
    service::{search::cache, self_reporting::report_request_usage_stats},
};

/// Write accumulated search results to cache
#[tracing::instrument(name = "service:search:stream_cache:write_results_to_cache", skip_all)]
pub async fn write_results_to_cache(
    c_resp: MultiCachedQueryResponse,
    start_time: i64,
    end_time: i64,
    accumulated_results: &mut Vec<SearchResultType>,
) -> Result<(), infra::errors::Error> {
    if accumulated_results.is_empty() {
        return Ok(());
    }

    log::info!(
        "[HTTP2_STREAM]: Writing results to file for trace_id: {}, file_path: {}, accumulated_results len: {}",
        c_resp.trace_id,
        c_resp.file_path,
        accumulated_results.len()
    );

    let cfg = config::get_config();
    let mut cached_responses = Vec::new();
    let mut search_responses = Vec::new();

    for result in accumulated_results {
        match result {
            SearchResultType::Cached(resp) => cached_responses.push(resp.clone()),
            SearchResultType::Search(resp) => search_responses.push(resp.clone()),
        }
    }

    let merged_response = cache::merge_response(
        &c_resp.trace_id,
        &mut cached_responses,
        &mut search_responses,
        &c_resp.ts_column,
        c_resp.limit,
        c_resp.is_descending,
        c_resp.took,
        c_resp.order_by,
    );

    // Update: Don't cache any partial results
    let should_cache_results = merged_response.new_start_time.is_none()
        && merged_response.new_end_time.is_none()
        && merged_response.function_error.is_empty()
        && !merged_response.hits.is_empty();

    if cfg.common.result_cache_enabled && should_cache_results {
        cache::write_results(
            &c_resp.trace_id,
            &c_resp.ts_column,
            start_time,
            end_time,
            merged_response,
            c_resp.file_path.clone(),
            c_resp.is_aggregate,
            c_resp.is_descending,
        )
        .await;
        log::info!(
            "[HTTP2_STREAM]: Results written to file for trace_id: {}, file_path: {}",
            c_resp.trace_id,
            c_resp.file_path,
        );
    }

    Ok(())
}

/// Handle cache responses and deltas in sorted order
#[tracing::instrument(
    name = "service:search:stream_cache:handle_cache_responses_and_deltas",
    skip_all
)]
#[allow(clippy::too_many_arguments)]
pub async fn handle_cache_responses_and_deltas(
    req: &mut config::meta::search::Request,
    req_size: i64,
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    mut cached_resp: Vec<CachedQueryResponse>,
    mut deltas: Vec<QueryDelta>,
    accumulated_results: &mut Vec<SearchResultType>,
    user_id: &str,
    max_query_range: i64,
    remaining_query_range: i64,
    req_order_by: &OrderBy,
    fallback_order_by_col: Option<String>,
    start_timer: &mut Instant,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    all_streams: &str,
    started_at: i64,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
    is_multi_stream_search: bool,
) -> Result<(), infra::errors::Error> {
    // Force set order_by to desc for dashboards & histogram
    // so that deltas are processed in the reverse order
    let search_type = req.search_type.expect("search_type is required");
    let cache_order_by = if search_type == SearchEventType::Dashboards
        || (req.query.size == -1 && search_type != SearchEventType::UI)
    {
        &OrderBy::Desc
    } else {
        req_order_by
    };

    // sort both deltas and cache by order_by
    match cache_order_by {
        OrderBy::Desc => {
            deltas.sort_by(|a, b| b.delta_start_time.cmp(&a.delta_start_time));
            cached_resp.sort_by(|a, b| b.response_start_time.cmp(&a.response_start_time));
        }
        OrderBy::Asc => {
            deltas.sort_by(|a, b| a.delta_start_time.cmp(&b.delta_start_time));
            cached_resp.sort_by(|a, b| a.response_start_time.cmp(&b.response_start_time));
        }
    }

    // Initialize iterators for deltas and cached responses
    let mut delta_iter = deltas.iter().peekable();
    let mut cached_resp_iter = cached_resp.iter().peekable();
    let mut curr_res_size = 0; // number of records

    let mut remaining_query_range = remaining_query_range as f64; // hours
    let cache_start_time = cached_resp
        .first()
        .map(|c| c.response_start_time)
        .unwrap_or_default();
    let cache_end_time = cached_resp
        .last()
        .map(|c| c.response_end_time)
        .unwrap_or_default();
    let cache_duration = cache_end_time - cache_start_time; // microseconds
    let cached_search_duration = cache_duration + (max_query_range * 3600 * 1_000_000); // microseconds

    log::info!(
        "[HTTP2_STREAM trace_id {trace_id}] Handling cache response and deltas, curr_res_size: {curr_res_size}, cached_search_duration: {cached_search_duration}, remaining_query_duration: {remaining_query_range}, deltas_len: {}, cache_start_time: {cache_start_time}, cache_end_time: {cache_end_time}",
        deltas.len(),
    );

    // Process cached responses and deltas in sorted order
    while cached_resp_iter.peek().is_some() || delta_iter.peek().is_some() {
        if let (Some(&delta), Some(cached)) = (delta_iter.peek(), cached_resp_iter.peek()) {
            // If the delta is before the current cached response time, fetch partitions
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] checking delta: {:?} with cached start_time: {:?}, end_time:{}",
                delta,
                cached.response_start_time,
                cached.response_end_time,
            );
            // Compare delta and cached response based on the order
            let process_delta_first = match cache_order_by {
                OrderBy::Asc => delta.delta_end_time <= cached.response_start_time,
                OrderBy::Desc => delta.delta_start_time >= cached.response_end_time,
            };

            if process_delta_first {
                log::info!(
                    "[HTTP2_STREAM trace_id {trace_id}] Processing delta before cached response, order_by: {cache_order_by:#?}"
                );
                super::execution::process_delta(
                    req,
                    trace_id,
                    org_id,
                    stream_type,
                    delta,
                    req_size,
                    accumulated_results,
                    &mut curr_res_size,
                    user_id,
                    &mut remaining_query_range,
                    cached_search_duration,
                    start_timer,
                    cache_order_by,
                    sender.clone(),
                    values_ctx.clone(),
                    is_result_array_skip_vrl,
                    backup_query_fn.clone(),
                    all_streams,
                    is_multi_stream_search,
                )
                .await?;
                delta_iter.next(); // Move to the next delta after processing
            } else {
                // Send cached response
                send_cached_responses(
                    req,
                    trace_id,
                    req_size,
                    cached,
                    &mut curr_res_size,
                    accumulated_results,
                    fallback_order_by_col.clone(),
                    cache_order_by,
                    start_timer,
                    sender.clone(),
                    user_id,
                    org_id,
                    all_streams,
                    stream_type,
                    started_at,
                    is_result_array_skip_vrl,
                    backup_query_fn.clone(),
                )
                .await?;
                cached_resp_iter.next();
            }
        } else if let Some(&delta) = delta_iter.peek() {
            // Process remaining deltas
            log::info!("[HTTP2_STREAM trace_id {trace_id}] Processing remaining delta");
            super::execution::process_delta(
                req,
                trace_id,
                org_id,
                stream_type,
                delta,
                req_size,
                accumulated_results,
                &mut curr_res_size,
                user_id,
                &mut remaining_query_range,
                cached_search_duration,
                start_timer,
                cache_order_by,
                sender.clone(),
                values_ctx.clone(),
                is_result_array_skip_vrl,
                backup_query_fn.clone(),
                all_streams,
                is_multi_stream_search,
            )
            .await?;
            delta_iter.next(); // Move to the next delta after processing
        } else if let Some(cached) = cached_resp_iter.next() {
            // Process remaining cached responses
            send_cached_responses(
                req,
                trace_id,
                req_size,
                cached,
                &mut curr_res_size,
                accumulated_results,
                fallback_order_by_col.clone(),
                cache_order_by,
                start_timer,
                sender.clone(),
                user_id,
                org_id,
                all_streams,
                stream_type,
                started_at,
                is_result_array_skip_vrl,
                backup_query_fn.clone(),
            )
            .await?;
        }

        // Stop if reached the requested result size
        if req_size != -1 && curr_res_size >= req_size {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size: {req_size}, stopping search",
            );
            break;
        }
    }

    Ok(())
}

/// Send cached responses to the client
#[allow(clippy::too_many_arguments)]
async fn send_cached_responses(
    req: &mut config::meta::search::Request,
    trace_id: &str,
    req_size: i64,
    cached: &CachedQueryResponse,
    curr_res_size: &mut i64,
    accumulated_results: &mut Vec<SearchResultType>,
    fallback_order_by_col: Option<String>,
    cache_order_by: &OrderBy,
    start_timer: &mut Instant,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    user_id: &str,
    org_id: &str,
    all_streams: &str,
    stream_type: StreamType,
    started_at: i64,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
) -> Result<(), infra::errors::Error> {
    log::info!("[HTTP2_STREAM]: Processing cached response for trace_id: {trace_id}");

    let mut cached = cached.clone();

    // add cache hits to `curr_res_size`
    *curr_res_size += cached.cached_response.hits.len() as i64;

    // truncate hits if `curr_res_size` is greater than `req_size`
    if req_size != -1 && *curr_res_size >= req_size {
        let excess_hits = *curr_res_size - req_size;
        let total_hits = cached.cached_response.hits.len() as i64;
        if total_hits > excess_hits {
            let cache_hits: usize = (total_hits - excess_hits) as usize;
            cached.cached_response.hits.truncate(cache_hits);
            cached.cached_response.total = cache_hits;
        }
    }

    cached.cached_response = order_search_results(cached.cached_response, fallback_order_by_col);

    accumulated_results.push(SearchResultType::Cached(cached.cached_response.clone()));

    // `result_cache_ratio` for cached response is 100
    cached.cached_response.result_cache_ratio = 100;
    // `scan_size` is 0, as it is not used for cached responses
    cached.cached_response.scan_size = 0;

    // set took
    cached
        .cached_response
        .set_took(start_timer.elapsed().as_millis() as usize);
    // reset start timer
    *start_timer = Instant::now();

    log::info!(
        "[HTTP2_STREAM]: Sending cached search response for trace_id: {}, hits: {}, result_cache_ratio: {}",
        trace_id,
        cached.cached_response.hits.len(),
        cached.cached_response.result_cache_ratio,
    );

    #[cfg(feature = "enterprise")]
    crate::service::search::cache::apply_regex_to_response(
        req,
        org_id,
        all_streams,
        stream_type,
        &mut cached.cached_response,
    )
    .await?;

    if is_result_array_skip_vrl {
        cached.cached_response.hits = crate::service::search::cache::apply_vrl_to_response(
            backup_query_fn.clone(),
            &mut cached.cached_response,
            org_id,
            all_streams,
            trace_id,
        );
    }

    let response = StreamResponses::SearchResponse {
        results: cached.cached_response.clone(),
        streaming_aggs: false,
        streaming_id: None,
        time_offset: TimeOffset {
            start_time: cached.response_start_time,
            end_time: cached.response_end_time,
        },
    };

    if sender.send(Ok(response)).await.is_err() {
        log::warn!("[trace_id {trace_id}] Sender is closed, stop sending cached search response");
        return Ok(());
    }

    {
        let percent = super::utils::calculate_progress_percentage(
            cached.response_start_time,
            cached.response_end_time,
            req.query.start_time,
            req.query.end_time,
            cache_order_by,
        );
        if sender
            .send(Ok(StreamResponses::Progress { percent }))
            .await
            .is_err()
        {
            log::warn!("[trace_id {trace_id}] Sender is closed, stop sending progress");
            return Ok(());
        }
    }

    let num_fn = req.query.query_fn.is_some() as u16;
    let req_stats = RequestStats {
        records: cached.cached_response.hits.len() as i64,
        response_time: cached.cached_response.took as f64,
        size: cached.cached_response.scan_size as f64,
        request_body: Some(req.query.sql.clone()),
        function: req.query.query_fn.clone(),
        user_email: Some(user_id.to_string()),
        min_ts: Some(req.query.start_time),
        max_ts: Some(req.query.end_time),
        cached_ratio: Some(cached.cached_response.cached_ratio),
        search_type: req.search_type,
        search_event_context: req.search_event_context.clone(),
        trace_id: Some(trace_id.to_string()),
        took_wait_in_queue: Some(cached.cached_response.took_detail.wait_in_queue),
        work_group: None, // TODO: add work group
        result_cache_ratio: Some(cached.cached_response.result_cache_ratio),
        ..Default::default()
    };
    report_request_usage_stats(
        req_stats,
        org_id,
        all_streams,
        stream_type,
        UsageType::Search,
        num_fn,
        started_at,
    )
    .await;

    Ok(())
}

/// Write partial results to cache if search is cancelled
#[allow(unused_variables)]
#[cfg(feature = "enterprise")]
pub async fn write_partial_results_to_cache(
    error: &infra::errors::Error,
    trace_id: &str,
    c_resp: MultiCachedQueryResponse,
    start_time: i64,
    end_time: i64,
    accumulated_results: &mut Vec<SearchResultType>,
) {
    // TEMPORARY: disable writing partial cache
    return;
    // write the partial results to cache if search is cancelled
    #[allow(unreachable_code)]
    match error {
        #[cfg(feature = "enterprise")]
        infra::errors::Error::ErrorCode(infra::errors::ErrorCodes::SearchCancelQuery(_)) => {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Search cancelled, writing results to cache",
            );
            // write the result to cache
            match write_results_to_cache(c_resp, start_time, end_time, accumulated_results).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "[HTTP2_STREAM trace_id {trace_id}] Error writing results to cache: {e}",
                    );
                }
            }
        }
        _ => {}
    }
}

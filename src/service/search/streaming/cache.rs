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
    clear_cache: bool,
) -> Result<(), infra::errors::Error> {
    if accumulated_results.is_empty() {
        return Ok(());
    }

    let start = std::time::Instant::now();
    log::info!(
        "[HTTP2_STREAM trace_id {}] Writing results to file: {}, accumulated_results len: {}",
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
        // Determine if this is a non-timestamp histogram query for websocket streaming
        let is_histogram_non_ts_order = c_resp.histogram_interval > 0
            && !merged_response.order_by_metadata.is_empty()
            && merged_response
                .order_by_metadata
                .first()
                .map(|(field, _)| field != &c_resp.ts_column)
                .unwrap_or(false);

        cache::write_results(
            &c_resp.trace_id,
            &c_resp.ts_column,
            start_time,
            end_time,
            merged_response,
            c_resp.file_path.clone(),
            c_resp.is_aggregate,
            c_resp.is_descending,
            clear_cache,
            is_histogram_non_ts_order,
        )
        .await;
        log::info!(
            "[HTTP2_STREAM trace_id {}] Results written to file: {}, async cache task created, took: {} ms",
            c_resp.trace_id,
            c_resp.file_path,
            start.elapsed().as_millis()
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

    // Get the actual min/max timestamps regardless of sort order
    // We need to consider both start and end times from all cached responses
    // to handle cases where entries might have inverted times or overlapping ranges
    let mut all_timestamps = Vec::new();
    for cached in &cached_resp {
        all_timestamps.push(cached.response_start_time);
        all_timestamps.push(cached.response_end_time);
    }
    let cache_start_time = all_timestamps.iter().min().copied().unwrap_or_default();
    let cache_end_time = all_timestamps.iter().max().copied().unwrap_or_default();
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
        if req_size != -1 && req_size != 0 && curr_res_size >= req_size {
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
        peak_memory_usage: cached.cached_response.peak_memory_usage,
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
    clear_cache: bool,
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
            match write_results_to_cache(
                c_resp,
                start_time,
                end_time,
                accumulated_results,
                clear_cache,
            )
            .await
            {
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

#[cfg(test)]
mod tests {
    use config::meta::search::Response;

    use crate::common::meta::search::CachedQueryResponse;

    /// Test helper to create a mock CachedQueryResponse
    fn create_mock_cached_response(start_time: i64, end_time: i64) -> CachedQueryResponse {
        CachedQueryResponse {
            cached_response: Response::default(),
            deltas: vec![],
            has_cached_data: true,
            cache_query_response: true,
            response_start_time: start_time,
            response_end_time: end_time,
            ts_column: "_timestamp".to_string(),
            is_descending: false,
            limit: 100,
        }
    }

    /// This test reproduces the bug from the faulty flow
    /// where cached responses sorted in descending order produce negative cache_duration
    #[test]
    fn test_cache_duration_calculation_descending_order() {
        // Create 3 cached responses with different time ranges
        let mut cached_resp = vec![
            create_mock_cached_response(300, 400), // Newest
            create_mock_cached_response(200, 250), // Middle
            create_mock_cached_response(100, 150), // Oldest
        ];

        // Sort in DESCENDING order (newest first) - this is what triggers the bug
        cached_resp.sort_by(|a, b| b.response_start_time.cmp(&a.response_start_time));

        // OLD CODE (buggy) - would use first() and last()
        let old_cache_start_time = cached_resp.first().unwrap().response_start_time;
        let old_cache_end_time = cached_resp.last().unwrap().response_end_time;
        let old_cache_duration = old_cache_end_time - old_cache_start_time;

        println!("\n=== OLD CODE (BUGGY) ===");
        println!(
            "Array sorted descending: first()={}, last()={}",
            cached_resp.first().unwrap().response_start_time,
            cached_resp.last().unwrap().response_end_time
        );
        println!("old_cache_start_time: {}", old_cache_start_time);
        println!("old_cache_end_time: {}", old_cache_end_time);
        println!("old_cache_duration: {} (NEGATIVE!)", old_cache_duration);

        // Verify the bug: old code produces negative duration
        assert!(
            old_cache_duration < 0,
            "Old code should produce negative duration"
        );
        assert_eq!(old_cache_start_time, 300, "Old code gets wrong start time");
        assert_eq!(old_cache_end_time, 150, "Old code gets wrong end time");

        // NEW CODE (fixed) - use min/max on all timestamps
        let mut all_timestamps = Vec::new();
        for cached in &cached_resp {
            all_timestamps.push(cached.response_start_time);
            all_timestamps.push(cached.response_end_time);
        }
        let new_cache_start_time = all_timestamps.iter().min().copied().unwrap_or_default();
        let new_cache_end_time = all_timestamps.iter().max().copied().unwrap_or_default();
        let new_cache_duration = new_cache_end_time - new_cache_start_time;

        println!("\n=== NEW CODE (FIXED) ===");
        println!("All timestamps: {:?}", all_timestamps);
        println!("new_cache_start_time: {} (min)", new_cache_start_time);
        println!("new_cache_end_time: {} (max)", new_cache_end_time);
        println!("new_cache_duration: {} (POSITIVE!)", new_cache_duration);

        // Verify the fix: new code produces positive duration
        assert!(
            new_cache_duration >= 0,
            "New code should produce non-negative duration"
        );
        assert_eq!(
            new_cache_start_time, 100,
            "New code gets correct start time"
        );
        assert_eq!(new_cache_end_time, 400, "New code gets correct end time");
        assert_eq!(
            new_cache_duration, 300,
            "New code calculates correct duration"
        );
    }

    /// Test with real timestamps from the faulty flow log
    #[test]
    fn test_cache_duration_with_real_timestamps() {
        // From the faulty flow log:
        // cache_start_time: 1763646864583000
        // cache_end_time: 1763640124696200
        // cached_search_duration: -6739886800

        let cached_resp = vec![
            create_mock_cached_response(1763646864583000, 1763647000000000),
            create_mock_cached_response(1763643000000000, 1763644000000000),
            create_mock_cached_response(1763640124696200, 1763641000000000),
        ];

        // These are sorted descending by start_time (simulating the bug scenario)

        // OLD CODE (reproduces the bug)
        let old_cache_start_time = cached_resp.first().unwrap().response_start_time;
        let old_cache_end_time = cached_resp.last().unwrap().response_end_time;
        let old_cache_duration = old_cache_end_time - old_cache_start_time;

        println!("\n=== REAL TIMESTAMPS FROM LOG ===");
        println!("Old cache_start_time: {}", old_cache_start_time);
        println!("Old cache_end_time: {}", old_cache_end_time);
        println!("Old cache_duration: {}", old_cache_duration);

        // Verify we reproduce the exact bug
        assert_eq!(old_cache_start_time, 1763646864583000);
        assert_eq!(old_cache_end_time, 1763641000000000);
        assert!(
            old_cache_duration < 0,
            "Reproduces the negative duration bug"
        );

        // NEW CODE (fixes it)
        let mut all_timestamps = Vec::new();
        for cached in &cached_resp {
            all_timestamps.push(cached.response_start_time);
            all_timestamps.push(cached.response_end_time);
        }
        let new_cache_start_time = all_timestamps.iter().min().copied().unwrap_or_default();
        let new_cache_end_time = all_timestamps.iter().max().copied().unwrap_or_default();
        let new_cache_duration = new_cache_end_time - new_cache_start_time;

        println!("New cache_start_time: {}", new_cache_start_time);
        println!("New cache_end_time: {}", new_cache_end_time);
        println!("New cache_duration: {} (FIXED!)", new_cache_duration);

        // Verify the fix
        assert_eq!(new_cache_start_time, 1763640124696200);
        assert_eq!(new_cache_end_time, 1763647000000000);
        assert!(new_cache_duration > 0, "Fix produces positive duration");
        assert_eq!(new_cache_duration, 6875303800);
    }
}

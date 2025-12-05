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
    search::{
        PARTIAL_ERROR_RESPONSE_MESSAGE, Response, SearchEventType, SearchPartitionRequest,
        SearchPartitionResponse, StreamResponses, TimeOffset, ValuesEventContext,
    },
    sql::OrderBy,
    stream::StreamType,
};
use log;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::datafusion::distributed_plan::streaming_aggs_exec;
use tokio::sync::mpsc;
use tracing::Instrument;

use super::{
    sorting::order_search_results,
    utils::{calculate_progress_percentage, get_top_k_values},
};
#[cfg(feature = "enterprise")]
use crate::service::search::cache::cacher::delete_cache;
use crate::{
    common::meta::search::{QueryDelta, SearchResultType},
    service::search::{self as SearchService},
};

/// Do partitioned search without cache
#[tracing::instrument(
    name = "service:search:stream_execution:do_partitioned_search",
    skip_all
)]
#[allow(clippy::too_many_arguments)]
pub async fn do_partitioned_search(
    req: &mut config::meta::search::Request,
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req_size: i64,
    user_id: &str,
    accumulated_results: &mut Vec<SearchResultType>,
    max_query_range: i64, // hours
    start_timer: &mut Instant,
    req_order_by: &OrderBy,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    fallback_order_by_col: Option<String>,
    hits_to_skip: &mut i64,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
    stream_name: &str,
    is_multi_stream_search: bool,
) -> Result<(), infra::errors::Error> {
    // limit the search by max_query_range
    let mut range_error = String::new();
    if max_query_range > 0
        && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
    {
        req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Query duration is modified due to query range restriction of {max_query_range} hours, new start_time: {}",
            req.query.start_time
        );
        range_error = format!(
            "Query duration is modified due to query range restriction of {max_query_range} hours"
        );
    }
    // for new_start_time & new_end_time
    let modified_start_time = req.query.start_time;
    let modified_end_time = req.query.end_time;

    let partition_resp = get_partitions(trace_id, org_id, stream_type, req, user_id).await?;

    let mut partitions = partition_resp.partitions;

    if partitions.is_empty() {
        return Ok(());
    }

    // check if `streaming_aggs` is supported
    let is_streaming_aggs = partition_resp.streaming_aggs;
    let mut use_cache = false;
    if is_streaming_aggs {
        req.query.streaming_output = true;
        req.query.streaming_id = partition_resp.streaming_id.clone();
        use_cache = req.use_cache;
        log::info!(
            "[HTTP2_STREAM] [trace_id: {}] [streaming_id: {}] is_streaming_aggs: {}, use_cache: {}",
            trace_id,
            partition_resp.streaming_id.clone().unwrap(),
            is_streaming_aggs,
            use_cache
        );
    }

    // The order by for the partitions is the same as the order by in the query
    // unless the query is a dashboard or histogram
    let mut partition_order_by = req_order_by;
    // sort partitions in desc by _timestamp for dashboards & histograms
    // expect if search_type is UI
    let search_type = req.search_type.expect("populate search_type");
    if search_type == SearchEventType::Dashboards
        || (req.query.size == -1 && search_type != SearchEventType::UI)
    {
        partitions.sort_by(|a, b| b[0].cmp(&a[0]));
        partition_order_by = &OrderBy::Desc;
    }

    let mut curr_res_size = 0;

    log::info!(
        "[HTTP2_STREAM] Found {} partitions for trace_id: {}, partitions: {:?}",
        partitions.len(),
        trace_id,
        &partitions
    );

    let partition_num = partitions.len();
    for (idx, &[start_time, end_time]) in partitions.iter().enumerate() {
        let mut req = req.clone();
        req.query.start_time = start_time;
        req.query.end_time = end_time;

        if req_size != -1 && !is_streaming_aggs {
            req.query.size -= curr_res_size;
        }

        // here we increase the size of the query to fetch requested hits in addition to the
        // hits_to_skip we set the from to 0 to fetch the hits from the the beginning of the
        // partition
        req.query.size += *hits_to_skip;
        req.query.from = 0;

        let trace_id = if partition_num == 1 {
            trace_id.to_string()
        } else {
            format!("{trace_id}-{idx}")
        };
        let mut search_res = do_search(
            &trace_id,
            org_id,
            stream_type,
            &req,
            user_id,
            use_cache,
            is_multi_stream_search,
        )
        .await?;

        let mut total_hits = search_res.total as i64;

        let skip_hits = std::cmp::min(*hits_to_skip, total_hits);
        if skip_hits > 0 {
            search_res.hits = search_res.hits[skip_hits as usize..].to_vec();
            search_res.total = search_res.hits.len();
            search_res.size = search_res.total as i64;
            total_hits = search_res.total as i64;
            *hits_to_skip -= skip_hits;
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Skipped {skip_hits} hits, remaining hits to skip: {hits_to_skip}, total hits for partition {idx}: {total_hits}",
            );
        }

        if !is_streaming_aggs {
            curr_res_size += total_hits;
            if req_size > 0 && curr_res_size >= req_size {
                log::info!(
                    "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size ({req_size}), truncating results",
                );
                search_res.hits.truncate(req_size as usize);
                search_res.total = search_res.hits.len();
            }
        }

        search_res = order_search_results(search_res, fallback_order_by_col.clone());

        // set took
        search_res.set_took(start_timer.elapsed().as_millis() as usize);
        // reset start time
        *start_timer = Instant::now();

        // check range error
        if !range_error.is_empty() {
            search_res.is_partial = true;
            search_res.function_error = if search_res.function_error.is_empty() {
                vec![range_error.clone()]
            } else {
                search_res.function_error.push(range_error.clone());
                search_res.function_error
            };
            search_res.new_start_time = Some(modified_start_time);
            search_res.new_end_time = Some(modified_end_time);
        }

        // Accumulate the result
        if is_streaming_aggs {
            // Only accumulate the results of the last partition
            if idx == partitions.len() - 1 {
                accumulated_results.push(SearchResultType::Search(search_res.clone()));
            }
        } else {
            accumulated_results.push(SearchResultType::Search(search_res.clone()));
        }

        // add top k values for values search
        if req.search_type == Some(SearchEventType::Values) && values_ctx.is_some() {
            let search_stream_span = tracing::info_span!(
                "src::service::search::stream_execution::do_partitioned_search::get_top_k_values",
                org_id = %org_id,
            );
            let instant = Instant::now();
            let field = values_ctx.as_ref().unwrap().field.clone();
            let top_k = values_ctx.as_ref().unwrap().top_k.unwrap_or(10);
            let no_count = values_ctx.as_ref().unwrap().no_count;
            let (top_k_values, hit_count) = tokio::task::spawn_blocking(move || {
                get_top_k_values(&search_res.hits, &field, top_k, no_count)
            })
            .instrument(search_stream_span.clone())
            .await
            .unwrap()?;
            search_res.total = hit_count as usize;
            search_res.hits = top_k_values;
            let duration = instant.elapsed();
            log::debug!("Top k values for partition {idx} took {duration:?}");
        }
        #[cfg(feature = "enterprise")]
        crate::service::search::cache::apply_regex_to_response(
            &req,
            org_id,
            stream_name,
            stream_type,
            &mut search_res,
        )
        .await?;

        if is_result_array_skip_vrl {
            search_res.hits = crate::service::search::cache::apply_vrl_to_response(
                backup_query_fn.clone(),
                &mut search_res,
                org_id,
                stream_name,
                &trace_id,
            );
        }

        // Send the cached response
        let response = StreamResponses::SearchResponse {
            results: search_res.clone(),
            streaming_aggs: is_streaming_aggs,
            streaming_id: partition_resp.streaming_id.clone(),
            time_offset: TimeOffset {
                start_time,
                end_time,
            },
        };

        if sender.send(Ok(response)).await.is_err() {
            log::warn!("[trace_id {trace_id}] Sender is closed, stop sending response");
            return Ok(());
        }

        // Send progress update
        {
            let percent = calculate_progress_percentage(
                start_time,
                end_time,
                modified_start_time,
                modified_end_time,
                partition_order_by,
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
        let stop_values_search = req_size != -1
            && req_size != 0
            && req.search_type == Some(SearchEventType::Values)
            && curr_res_size >= req_size;
        if stop_values_search {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size ({req_size}), stopping search",
            );
            break;
        }
        // Stop if reached the requested result size and it is not a streaming aggs query
        if req_size != -1 && req_size != 0 && curr_res_size >= req_size && !is_streaming_aggs {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size ({req_size}), stopping search",
            );
            break;
        }
    }

    // Remove the streaming_aggs cache
    if is_streaming_aggs && partition_resp.streaming_id.is_some() {
        #[cfg(feature = "enterprise")]
        {
            let streaming_id = partition_resp.streaming_id.as_ref().unwrap();
            streaming_aggs_exec::remove_cache(streaming_id)
        }
    }

    Ok(())
}

/// Get partitions for search
pub async fn get_partitions(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &config::meta::search::Request,
    user_id: &str,
) -> Result<SearchPartitionResponse, infra::errors::Error> {
    let search_partition_req = SearchPartitionRequest {
        sql: req.query.sql.clone(),
        start_time: req.query.start_time,
        end_time: req.query.end_time,
        encoding: req.encoding,
        regions: req.regions.clone(),
        clusters: req.clusters.clone(),
        // vrl is not required for _search_partition
        query_fn: Default::default(),
        streaming_output: true,
        histogram_interval: req.query.histogram_interval,
        sampling_ratio: req.query.sampling_ratio,
    };

    let res = SearchService::search_partition(
        trace_id,
        org_id,
        Some(user_id),
        stream_type,
        &search_partition_req,
        false,
        false,
        false,
        req.use_cache,
    )
    .instrument(tracing::info_span!(
        "src::service::search::stream_execution::get_partitions"
    ))
    .await?;

    Ok(res)
}

/// Execute search for a specific partition
#[tracing::instrument(name = "service:search:stream_execution:do_search", skip_all)]
pub async fn do_search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &config::meta::search::Request,
    user_id: &str,
    use_cache: bool,
    is_multi_stream_search: bool,
) -> Result<Response, infra::errors::Error> {
    let mut req = req.clone();

    req.use_cache = use_cache;
    let res = SearchService::cache::search(
        trace_id,
        org_id,
        stream_type,
        Some(user_id.to_string()),
        &req,
        "".to_string(),
        true,
        None,
        is_multi_stream_search,
    )
    .await;

    res.map(handle_partial_response)
}

/// Handle partial response by adding appropriate error messages
pub fn handle_partial_response(mut res: Response) -> Response {
    if res.is_partial {
        res.function_error = if res.function_error.is_empty() {
            vec![PARTIAL_ERROR_RESPONSE_MESSAGE.to_string()]
        } else {
            res.function_error
        };
    }
    res
}

/// Process a single delta (time range not covered by cache)
#[allow(clippy::too_many_arguments)]
pub async fn process_delta(
    req: &mut config::meta::search::Request,
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    delta: &QueryDelta,
    req_size: i64,
    accumulated_results: &mut Vec<SearchResultType>,
    curr_res_size: &mut i64,
    user_id: &str,
    remaining_query_range: &mut f64,
    cache_req_duration: i64,
    start_timer: &mut Instant,
    cache_order_by: &OrderBy,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
    stream_name: &str,
    is_multi_stream_search: bool,
) -> Result<(), infra::errors::Error> {
    log::info!("[HTTP2_STREAM]: Processing delta for trace_id: {trace_id}, delta: {delta:?}");
    let mut req = req.clone();
    let original_req_start_time = req.query.start_time;
    let original_req_end_time = req.query.end_time;
    req.query.start_time = delta.delta_start_time;
    req.query.end_time = delta.delta_end_time;

    let partition_resp = get_partitions(trace_id, org_id, stream_type, &req, user_id).await?;
    let mut partitions = partition_resp.partitions;

    if partitions.is_empty() {
        return Ok(());
    }

    // check if `streaming_aggs` is supported
    let is_streaming_aggs = partition_resp.streaming_aggs;
    if is_streaming_aggs {
        req.query.streaming_output = true;
        req.query.streaming_id = partition_resp.streaming_id.clone();
    }

    log::info!(
        "[HTTP2_STREAM] Found {} partitions for trace_id: {}, partitions: {:?}",
        partitions.len(),
        trace_id,
        &partitions
    );

    // for dashboards & histograms, expect for ui
    let search_type = req.search_type.expect("populate search_type");
    if search_type == SearchEventType::Dashboards
        || (req.query.size == -1 && search_type != SearchEventType::UI)
    {
        // sort partitions by timestamp in desc
        partitions.sort_by(|a, b| b[0].cmp(&a[0]));
    }

    for (idx, &[start_time, end_time]) in partitions.iter().enumerate() {
        let mut req = req.clone();
        req.query.start_time = start_time;
        req.query.end_time = end_time;

        if req_size != -1 {
            req.query.size -= *curr_res_size;
        }

        // use cache for delta search
        let mut search_res = do_search(
            trace_id,
            org_id,
            stream_type,
            &req,
            user_id,
            true,
            is_multi_stream_search,
        )
        .await?;

        let total_hits = search_res.total as i64;

        *curr_res_size += total_hits;
        if req.query.size > 0 && *curr_res_size >= req.query.size {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size ({}), truncating results",
                req.query.size
            );
            let excess_hits = *curr_res_size - req_size;
            if total_hits > excess_hits && excess_hits > 0 {
                search_res
                    .hits
                    .truncate((total_hits - excess_hits) as usize);
                search_res.total = search_res.hits.len();
            }
        }

        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Found {} hits",
            search_res.hits.len(),
        );

        // for every partition, compute the queried range omitting the result cache ratio
        let queried_range = calc_queried_range(start_time, end_time, search_res.result_cache_ratio);
        *remaining_query_range -= queried_range;

        // set took
        search_res.set_took(start_timer.elapsed().as_millis() as usize);
        // reset start timer
        *start_timer = Instant::now();

        // when searching with limit queries
        // the limit in sql takes precedence over the requested size
        // hence, the search result needs to be trimmed when the req limit is reached
        if *curr_res_size > req_size {
            let excess_hits = *curr_res_size - req_size;
            let total_hits = search_res.hits.len() as i64;
            if total_hits > excess_hits {
                let cache_hits: usize = (total_hits - excess_hits) as usize;
                search_res.hits.truncate(cache_hits);
                search_res.total = cache_hits;
            }
        }

        // Accumulate the result
        if is_streaming_aggs {
            // Only accumulate the results of the last partition
            if idx == partitions.len() - 1 {
                accumulated_results.push(SearchResultType::Search(search_res.clone()));
            }
        } else {
            accumulated_results.push(SearchResultType::Search(search_res.clone()));
        }

        // `result_cache_ratio` will be 0 for delta search
        let result_cache_ratio = search_res.result_cache_ratio;

        if let Some(values_ctx) = values_ctx.as_ref()
            && req
                .search_type
                .is_some_and(|search_type| search_type == SearchEventType::Values)
        {
            let search_stream_span = tracing::info_span!(
                "src::service::search::stream_execution::process_delta::get_top_k_values",
                org_id = %org_id,
            );

            log::debug!("Getting top k values for partition {idx}");
            let field = values_ctx.field.clone();
            let top_k = values_ctx.top_k.unwrap_or(10);
            let no_count = values_ctx.no_count;
            let (top_k_values, hit_count) = tokio::task::spawn_blocking(move || {
                get_top_k_values(&search_res.hits, &field, top_k, no_count)
            })
            .instrument(search_stream_span.clone())
            .await
            .unwrap()?;
            search_res.total = hit_count as usize;
            search_res.hits = top_k_values;
        }
        #[cfg(feature = "enterprise")]
        crate::service::search::cache::apply_regex_to_response(
            &req,
            org_id,
            stream_name,
            stream_type,
            &mut search_res,
        )
        .await?;

        if is_result_array_skip_vrl {
            search_res.hits = crate::service::search::cache::apply_vrl_to_response(
                backup_query_fn.clone(),
                &mut search_res,
                org_id,
                stream_name,
                trace_id,
            );
        }

        let response = StreamResponses::SearchResponse {
            results: search_res.clone(),
            streaming_aggs: is_streaming_aggs,
            streaming_id: partition_resp.streaming_id.clone(),
            time_offset: TimeOffset {
                start_time,
                end_time,
            },
        };
        log::debug!(
            "[HTTP2_STREAM]: Sending search response for trace_id: {}, delta: {:?}, hits len: {}, result_cache_ratio: {}",
            trace_id,
            delta,
            search_res.hits.len(),
            result_cache_ratio,
        );

        if sender.send(Ok(response)).await.is_err() {
            log::warn!("[trace_id {trace_id}] Sender is closed, stop sending search response");
            return Ok(());
        }

        // Stop if `remaining_query_range` is less than 0
        if *remaining_query_range <= 0.00 {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Remaining query range is less than 0, stopping search",
            );
            let (new_start_time, new_end_time) = (
                original_req_end_time - cache_req_duration,
                original_req_end_time,
            );
            // pass original start_time and end_time partition end time
            let _ = send_partial_search_resp(
                trace_id,
                "reached max query range limit",
                new_start_time,
                new_end_time,
                search_res.order_by,
                search_res.order_by_metadata.clone(),
                is_streaming_aggs,
                sender,
                is_result_array_skip_vrl,
                backup_query_fn.clone(),
                org_id,
                stream_name,
                stream_type,
                &req,
            )
            .await;
            break;
        }

        // Send progress update
        {
            let percent = calculate_progress_percentage(
                start_time,
                end_time,
                original_req_start_time,
                original_req_end_time,
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

        // Stop if reached the request result size
        if req_size != -1 && *curr_res_size >= req_size {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] Reached requested result size ({req_size}), stopping search",
            );
            break;
        }
    }

    // Remove the streaming_aggs cache
    if is_streaming_aggs && partition_resp.streaming_id.is_some() {
        #[cfg(feature = "enterprise")]
        streaming_aggs_exec::remove_cache(&partition_resp.streaming_id.unwrap())
    }

    Ok(())
}

/// Calculates the actual queried range for a search request, adjusted for the result cache ratio.
///
/// This function computes the effective queried time range in hours by considering the total time
/// range (in microseconds) and reducing it based on the percentage of results cached.
///
/// # Parameters
/// - `start_time` (`i64`): Start time in microseconds since the epoch.
/// - `end_time` (`i64`): End time in microseconds since the epoch.
/// - `result_cache_ratio` (`usize`): Percentage of results cached (0 to 100).
///
/// # Returns
/// - `f64`: The effective queried range in hours, reduced by the cache ratio.
pub fn calc_queried_range(start_time: i64, end_time: i64, result_cache_ratio: usize) -> f64 {
    let result_cache_ratio = result_cache_ratio.min(100); // ensure ratio in between 0 and 100
    let range = (end_time - start_time) as f64 / 3_600_000_000.0; // convert microseconds to hours
    range * (1.0 - result_cache_ratio as f64 / 100.0)
}

/// Send a partial search response
#[allow(clippy::too_many_arguments)]
async fn send_partial_search_resp(
    trace_id: &str,
    error: &str,
    new_start_time: i64,
    new_end_time: i64,
    order_by: Option<OrderBy>,
    order_by_metadata: Vec<(String, OrderBy)>,
    is_streaming_aggs: bool,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    _req: &config::meta::search::Request,
) -> Result<(), infra::errors::Error> {
    let error = if error.is_empty() {
        PARTIAL_ERROR_RESPONSE_MESSAGE.to_string()
    } else {
        format!("{PARTIAL_ERROR_RESPONSE_MESSAGE} \n {error}")
    };
    let mut s_resp = Response {
        is_partial: true,
        function_error: vec![error],
        new_start_time: Some(new_start_time),
        new_end_time: Some(new_end_time),
        order_by,
        order_by_metadata,
        trace_id: trace_id.to_string(),
        ..Default::default()
    };
    #[cfg(feature = "enterprise")]
    crate::service::search::cache::apply_regex_to_response(
        _req,
        org_id,
        stream_name,
        stream_type,
        &mut s_resp,
    )
    .await?;
    if is_result_array_skip_vrl {
        s_resp.hits = crate::service::search::cache::apply_vrl_to_response(
            backup_query_fn.clone(),
            &mut s_resp,
            org_id,
            stream_name,
            trace_id,
        );
    }

    let response = StreamResponses::SearchResponse {
        results: s_resp,
        streaming_aggs: is_streaming_aggs,
        streaming_id: None,
        time_offset: TimeOffset {
            start_time: new_start_time,
            end_time: new_end_time,
        },
    };
    log::info!(
        "[HTTP2_STREAM]: trace_id: {trace_id} Sending partial search response for {stream_name} {stream_type}"
    );

    if sender.send(Ok(response)).await.is_err() {
        log::warn!("[trace_id {trace_id}] Sender is closed, stop sending partial search response");
        return Ok(());
    }

    Ok(())
}

/// Clear streaming aggregation cache files for the given streaming_id
/// This should be called once before processing partitions when clear_cache is true
#[deprecated]
#[allow(dead_code)]
#[cfg(feature = "enterprise")]
async fn clear_streaming_agg_cache(
    trace_id: &str,
    streaming_id: &str,
    start_time: i64,
    end_time: i64,
) -> Result<(), infra::errors::Error> {
    use o2_enterprise::enterprise::search::datafusion::distributed_plan::streaming_aggs_exec::GLOBAL_CACHE;

    log::info!(
        "[HTTP2_STREAM] [trace_id: {}] [streaming_id: {}] clear_cache is set, deleting old cache files",
        trace_id,
        streaming_id
    );

    // Get the cache file path from GLOBAL_CACHE
    let streaming_item = GLOBAL_CACHE.id_cache.get(streaming_id);
    if let Some(item) = streaming_item {
        let cache_file_path = item.get_cache_file_path();

        // Delete cache files in the time range using DeletionCriteria::TimeRange
        if let Err(e) = delete_cache(&cache_file_path, 0, Some(start_time), Some(end_time)).await {
            log::error!(
                "[HTTP2_STREAM] [trace_id: {}] [streaming_id: {}] Error deleting cache files: {}",
                trace_id,
                streaming_id,
                e
            );
            return Err(infra::errors::Error::Message(format!(
                "Failed to delete cache: {e}",
            )));
        }

        log::info!(
            "[HTTP2_STREAM] [trace_id: {}] [streaming_id: {}] Successfully deleted cache files for time range: {} - {}",
            trace_id,
            streaming_id,
            start_time,
            end_time
        );
    } else {
        log::warn!(
            "[HTTP2_STREAM] [trace_id: {}] [streaming_id: {}] No cache file path found in GLOBAL_CACHE",
            trace_id,
            streaming_id
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::sql::OrderBy;
    use tokio::sync::mpsc;

    use super::*;

    #[test]
    fn test_calc_queried_range_basic() {
        let start_time = 1_000_000_000; // 1 second in microseconds
        let end_time = 3_600_000_000; // 1 hour in microseconds

        // 100% cache ratio should result in 0 hours queried
        let result = calc_queried_range(start_time, end_time, 100);
        assert_eq!(result, 0.0);

        // 0% cache ratio should result in full range queried
        let result = calc_queried_range(start_time, end_time, 0);
        let expected = (end_time - start_time) as f64 / 3_600_000_000.0;
        assert_eq!(result, expected);

        // 50% cache ratio should result in half range queried
        let result = calc_queried_range(start_time, end_time, 50);
        let expected = (end_time - start_time) as f64 / 3_600_000_000.0 * 0.5;
        assert_eq!(result, expected);
    }

    #[test]
    fn test_calc_queried_range_edge_cases() {
        // Same start and end time
        let result = calc_queried_range(1_000_000_000, 1_000_000_000, 0);
        assert_eq!(result, 0.0);

        // Very small time range
        let result = calc_queried_range(1_000_000_000, 1_000_001_000, 0);
        let expected = 1_000.0 / 3_600_000_000.0;
        assert_eq!(result, expected);

        // Very large time range
        let result = calc_queried_range(0, 86_400_000_000, 0); // 24 hours
        assert_eq!(result, 24.0);
    }

    #[test]
    fn test_calc_queried_range_cache_ratio_bounds() {
        let start_time = 0;
        let end_time = 3_600_000_000; // 1 hour

        // Cache ratio > 100 should be clamped to 100
        let result = calc_queried_range(start_time, end_time, 150);
        assert_eq!(result, 0.0);

        // Cache ratio < 0 should work (though unusual)
        let result = calc_queried_range(start_time, end_time, 50);
        let expected = 0.5; // 1 hour * 0.5
        assert_eq!(result, expected);
    }

    #[test]
    fn test_handle_partial_response_no_errors() {
        let response = Response {
            is_partial: true,
            function_error: vec![],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = handle_partial_response(response.clone());

        // Should add only the partial error message
        assert_eq!(result.function_error.len(), 1);
        assert_eq!(result.function_error[0], PARTIAL_ERROR_RESPONSE_MESSAGE);
    }

    #[test]
    fn test_handle_partial_response_not_partial() {
        let response = Response {
            is_partial: false,
            function_error: vec!["Custom error".to_string()],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = handle_partial_response(response.clone());

        // Should not change the response
        assert_eq!(result.function_error.len(), 1);
        assert_eq!(result.function_error[0], "Custom error");
    }

    #[tokio::test]
    async fn test_send_partial_search_resp_success() {
        let (tx, mut rx) = mpsc::channel(10);

        let result = send_partial_search_resp(
            "test-123",
            "Test error",
            1000,
            2000,
            Some(OrderBy::Desc),
            vec![("field".to_string(), OrderBy::Asc)],
            false,
            tx,
            false,
            None,
            "test-org",
            "test-stream",
            StreamType::Logs,
            &config::meta::search::Request::default(),
        )
        .await;

        assert!(result.is_ok());

        // Check that response was sent
        let response = rx.recv().await.unwrap().unwrap();
        match response {
            StreamResponses::SearchResponse { results, .. } => {
                assert!(results.is_partial);
                // The error message gets formatted with PARTIAL_ERROR_RESPONSE_MESSAGE
                let expected_error = format!("{PARTIAL_ERROR_RESPONSE_MESSAGE} \n Test error");
                assert!(results.function_error.contains(&expected_error));
                assert_eq!(results.new_start_time, Some(1000));
                assert_eq!(results.new_end_time, Some(2000));
            }
            _ => panic!("Expected SearchResponse"),
        }
    }

    #[tokio::test]
    async fn test_send_partial_search_resp_empty_error() {
        let (tx, mut rx) = mpsc::channel(10);

        let result = send_partial_search_resp(
            "test-123",
            "",
            1000,
            2000,
            Some(OrderBy::Desc),
            vec![],
            false,
            tx,
            false,
            None,
            "test-org",
            "test-stream",
            StreamType::Logs,
            &config::meta::search::Request::default(),
        )
        .await;

        assert!(result.is_ok());

        let response = rx.recv().await.unwrap().unwrap();
        match response {
            StreamResponses::SearchResponse { results, .. } => {
                assert!(
                    results
                        .function_error
                        .contains(&PARTIAL_ERROR_RESPONSE_MESSAGE.to_string())
                );
            }
            _ => panic!("Expected SearchResponse"),
        }
    }

    #[tokio::test]
    async fn test_send_partial_search_resp_sender_closed() {
        let (tx, _rx) = mpsc::channel(1);
        drop(_rx); // Close the receiver

        let result = send_partial_search_resp(
            "test-123",
            "Test error",
            1000,
            2000,
            None,
            vec![],
            false,
            tx,
            false,
            None,
            "test-org",
            "test-stream",
            StreamType::Logs,
            &config::meta::search::Request::default(),
        )
        .await;

        // Should not panic, should return Ok
        assert!(result.is_ok());
    }
}

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

use std::time::Instant;

use ::search::{
    QueryDelta, SearchResultType, datafusion::physical_plan::streaming_aggs_exec,
    sql::rewriter::add_ordering_term::check_or_add_order_by_timestamp,
};
use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        search::{
            PARTIAL_ERROR_RESPONSE_MESSAGE, Response, SearchEventType, SearchPartitionRequest,
            SearchPartitionResponse, StreamResponses, TimeOffset, ValuesEventContext,
        },
        sql::OrderBy,
        stream::StreamType,
    },
    utils::{json, sql::is_explain_query},
};
use futures::StreamExt;
use log;
use tokio::sync::mpsc;
use tracing::Instrument;

use super::{
    sorting::order_search_results,
    utils::{calculate_progress_percentage, get_top_k_values},
};
use crate as SearchService;

/// Time slices the query window is cut into for pattern-extraction sampling.
///
/// Each slice is fetched with its own `LIMIT`, so each contributes an equal share
/// of the sample and the clustering sees the whole window rather than only the
/// newest rows. Measured: 6 slices covered half as many populated time buckets as
/// 12, so 12 is the coverage/round-trip trade-off.
const EXTRACTION_TIME_SLICES: usize = 12;

/// How many extraction slices to fetch at once. Extraction cost is dominated by
/// per-slice round trips (each slice's read is bounded by its own limit), so
/// concurrency turns wall time from the sum of the slices into the max.
const EXTRACTION_FETCH_CONCURRENCY: usize = 4;

/// Oversampling headroom over the requested size. The accumulator down-samples
/// uniformly to its own cap, so fetching a multiple keeps that down-sampling
/// meaningful while bounding memory; it also absorbs slices that hold less data
/// than their share and rows the accumulator discards (too-short text fields).
const EXTRACTION_OVERSAMPLE: i64 = 3;

/// Caps the extra count queries one dense slice costs.
const EXTRACTION_MAX_SUB_SLICES: usize = 8;

/// Caps the ranges one run counts and fetches, so a busy window costs a bounded number of queries.
const EXTRACTION_MAX_RANGES: usize = 24;

/// How one time slice is read for the extraction sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SliceFetch {
    Skip,
    Newest(i64),
    BothEnds { newest: i64, oldest: i64 },
}

/// The caller's identity shared by every slice search of one extraction run.
struct SliceSearch<'a> {
    trace_id: &'a str,
    org_id: &'a str,
    stream_type: StreamType,
    user_id: &'a str,
    is_multi_stream_search: bool,
}

impl SliceSearch<'_> {
    /// Runs `reqs` with a few in flight at once and returns their results in input order.
    async fn run(
        &self,
        label: &str,
        reqs: Vec<config::meta::search::Request>,
    ) -> Vec<Result<Response, infra::errors::Error>> {
        // Each task owns its inputs: borrowing across the spawn breaks the caller's Send bound.
        let tasks = reqs.into_iter().enumerate().map(|(i, req)| {
            let trace_id = format!("{}-{label}{i}", self.trace_id);
            let org_id = self.org_id.to_string();
            let user_id = self.user_id.to_string();
            let (stream_type, multi) = (self.stream_type, self.is_multi_stream_search);
            tokio::spawn(async move {
                do_search(
                    &trace_id,
                    &org_id,
                    stream_type,
                    &req,
                    &user_id,
                    false,
                    multi,
                )
                .await
            })
        });
        futures::stream::iter(tasks)
            .buffered(EXTRACTION_FETCH_CONCURRENCY)
            .map(|joined| {
                joined.unwrap_or_else(|e| {
                    Err(infra::errors::Error::Message(format!(
                        "pattern extraction slice task failed: {e}"
                    )))
                })
            })
            .collect()
            .await
    }
}

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
    req_order_by: &OrderBy,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    fallback_order_by_col: Option<String>,
    hits_to_skip: &mut i64,
    is_result_array_skip_vrl: bool,
    backup_query_fn: Option<String>,
    stream_name: &str,
    is_multi_stream_search: bool,
    // Routes to `fetch_extraction_sample`, which samples across the whole window
    // instead of returning the newest-first page this function otherwise builds.
    extract_patterns: bool,
) -> Result<(), infra::errors::Error> {
    // EXPLAIN hits are plan rows, which the requested result size must not cap.
    let req_size = if is_explain_query(&req.query.sql) {
        -1
    } else {
        req_size
    };
    crate::sql::histogram::pin_histogram_timezone(
        &mut req.query.sql,
        &mut req.query.timezone,
        req.query.end_time,
    )?;
    // limit the search by max_query_range
    // Enrichment tables have no retention and must be searched in full (the request spans
    // [creation_time .. now]); clamping the range would drop older enrichment data, so skip it.
    let mut range_error = String::new();
    if stream_type != StreamType::EnrichmentTables
        && let Some(clamped) = config::utils::query_range::clamp_start_time(
            req.query.start_time,
            req.query.end_time,
            max_query_range,
        )
    {
        req.query.start_time = clamped;
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

    // Pattern extraction takes a dedicated path: it needs a sample spread across
    // the window, not the newest-first page the code below produces.
    if extract_patterns && req_size > 0 {
        return fetch_extraction_sample(
            req,
            trace_id,
            org_id,
            stream_type,
            user_id,
            req_size,
            (modified_start_time, modified_end_time),
            &range_error,
            accumulated_results,
            is_multi_stream_search,
        )
        .await;
    }

    let partition_num = partitions.len();

    for (idx, &[start_time, end_time]) in partitions.iter().enumerate() {
        let mut req = req.clone();
        req.query.start_time = start_time;
        req.query.end_time = end_time;

        if req_size != -1 && !is_streaming_aggs {
            req.query.size -= curr_res_size;
        }
        // increase size to fetch hits_to_skip + requested hits; start from partition beginning
        req.query.size += *hits_to_skip;
        req.query.from = 0;

        let trace_id = if partition_num == 1 {
            trace_id.to_string()
        } else {
            format!("{trace_id}-{idx}")
        };
        let start_timer = Instant::now();
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
                let allowed = (req_size - (curr_res_size - total_hits)) as usize;
                search_res.hits.truncate(allowed);
                search_res.total = search_res.hits.len();
            }
        }

        search_res = order_search_results(search_res, fallback_order_by_col.clone());

        // set took for this partition only (not cumulative)
        search_res.set_took(start_timer.elapsed().as_millis() as usize);

        // check range error
        apply_range_warning(
            &mut search_res,
            &range_error,
            modified_start_time,
            modified_end_time,
        );

        // Accumulate the result
        if is_streaming_aggs {
            // Only accumulate the results of the last partition
            if idx == partitions.len() - 1 {
                accumulated_results.push(SearchResultType::Search(search_res.clone()));
            }
        } else {
            accumulated_results.push(SearchResultType::Search(search_res.clone()));
        }

        // reformat per-partition GROUP BY results into values API response shape
        if req.search_type == Some(SearchEventType::Values)
            && let Some(values_ctx) = values_ctx.as_ref()
        {
            let search_stream_span = tracing::info_span!(
                "src::service::search::stream_execution::do_partitioned_search::get_top_k_values",
                org_id = %org_id,
            );
            let instant = Instant::now();
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
            let duration = instant.elapsed();
            log::debug!("Top k values for partition {idx} took {duration:?}");
        }
        if is_result_array_skip_vrl {
            search_res.hits = crate::cache::apply_vrl_to_response(
                backup_query_fn.clone(),
                &mut search_res,
                org_id,
                stream_name,
                &trace_id,
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
    if is_streaming_aggs && let Some(streaming_id) = &partition_resp.streaming_id {
        streaming_aggs_exec::registry::remove_cache(streaming_id)
    }

    Ok(())
}

/// Fetch the log-pattern sample: one response per time slice, `total` holding its row count.
#[allow(clippy::too_many_arguments)]
async fn fetch_extraction_sample(
    req: &config::meta::search::Request,
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: &str,
    req_size: i64,
    window: (i64, i64),
    range_error: &str,
    accumulated_results: &mut Vec<SearchResultType>,
    is_multi_stream_search: bool,
) -> Result<(), infra::errors::Error> {
    let slices = extraction_slice_ranges(window);
    let ctx = SliceSearch {
        trace_id,
        org_id,
        stream_type,
        user_id,
        is_multi_stream_search,
    };

    let (ranges, rows) = if can_slice_extraction(&req.query.sql) {
        count_and_split(&ctx, req, slices, req_size).await
    } else {
        (vec![[window.0, window.1]], None)
    };
    let slice_size = fetch_share(req_size, rows.as_deref(), ranges.len());
    let oldest_sql = oldest_first_sql(&req.query.sql);

    let mut slots = Vec::new();
    let mut reqs = Vec::new();
    for (i, &range) in ranges.iter().enumerate() {
        let rows_i = rows.as_ref().map(|r| r[i]);
        let (newest, oldest) = match plan_slice_fetch(rows_i, slice_size, oldest_sql.is_some()) {
            SliceFetch::Skip => continue,
            SliceFetch::Newest(n) => (n, 0),
            SliceFetch::BothEnds { newest, oldest } => (newest, oldest),
        };
        slots.push(i);
        reqs.push(slice_request(req, range, newest, None));
        if let Some(sql) = oldest_sql.as_deref().filter(|_| oldest > 0) {
            slots.push(i);
            reqs.push(slice_request(req, range, oldest, Some(sql)));
        }
    }

    let mut slices: Vec<Option<Response>> = vec![None; ranges.len()];
    let mut failed = vec![false; ranges.len()];
    let mut last_error = None;
    // A slice's newest-first result always precedes its oldest-first one.
    for (i, result) in slots.into_iter().zip(ctx.run("f", reqs).await) {
        match result {
            Ok(res) => {
                slices[i] = Some(match slices[i].take() {
                    None => res,
                    Some(newest) => merge_both_ends(newest, res),
                });
            }
            // One slice failing shouldn't sink the whole extraction.
            Err(e) => {
                log::warn!(
                    "[HTTP2_STREAM trace_id {trace_id}] Pattern extraction: slice failed, continuing: {e}"
                );
                failed[i] = true;
                last_error = Some(e);
            }
        }
    }

    // A slice that ran but carries `function_error` (e.g. a failed CAST) is a
    // failure, not an empty window.
    let slice_errors = drop_failed_slices(&mut slices, &mut failed);
    let mut responses = build_sample(&ranges, slices, &failed, rows.as_deref(), req_size as usize);
    if responses.is_empty() && last_error.is_none() && !slice_errors.is_empty() {
        last_error = Some(infra::errors::Error::Message(slice_errors.join("; ")));
    }
    // Every fetched slice failed: surface the error rather than report an empty window.
    if responses.is_empty()
        && let Some(e) = last_error
    {
        return Err(e);
    }

    if let Some(first) = responses.first_mut() {
        first.function_error.extend(slice_errors);
    }

    let fetched: usize = responses.iter().map(|r| r.hits.len()).sum();
    for mut res in responses {
        apply_range_warning(&mut res, range_error, window.0, window.1);
        accumulated_results.push(SearchResultType::Search(res));
    }

    log::info!(
        "[HTTP2_STREAM trace_id {trace_id}] Pattern extraction: fetched {fetched} rows from {} time slices",
        ranges.len()
    );
    Ok(())
}

/// A LIMIT or a subquery/join/window changes meaning per slice, so such SQL runs once over the
/// window.
fn can_slice_extraction(sql: &str) -> bool {
    config::utils::sql::is_time_splittable(sql).unwrap_or(false)
        && !config::utils::sql::has_limit_clause(sql)
}

/// Empties slices that returned no rows and carry `function_error`, marks them failed and
/// returns the distinct messages. A partial slice that still has rows is kept.
fn drop_failed_slices(slices: &mut [Option<Response>], failed: &mut [bool]) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    for (slot, failed) in slices.iter_mut().zip(failed.iter_mut()) {
        if !slot
            .as_ref()
            .is_some_and(|r| !r.function_error.is_empty() && r.hits.is_empty())
        {
            continue;
        }
        *failed = true;
        for e in slot.take().into_iter().flat_map(|r| r.function_error) {
            if !errors.contains(&e) {
                errors.push(e);
            }
        }
    }
    errors
}

/// Marks `res` partial when the stream's max query range shortened the window.
fn apply_range_warning(res: &mut Response, range_error: &str, new_start: i64, new_end: i64) {
    if range_error.is_empty() {
        return;
    }
    res.is_partial = true;
    res.function_error.push(range_error.to_string());
    res.new_start_time = Some(new_start);
    res.new_end_time = Some(new_end);
}

/// Equal time slices covering `window`; a window too narrow to slice stays whole.
fn extraction_slice_ranges((w_start, w_end): (i64, i64)) -> Vec<[i64; 2]> {
    let slices = if w_end - w_start > EXTRACTION_TIME_SLICES as i64 {
        EXTRACTION_TIME_SLICES
    } else {
        1
    };
    even_ranges([w_start, w_end], slices)
}

fn even_ranges([start, end]: [i64; 2], n: usize) -> Vec<[i64; 2]> {
    let step = (end - start) / n as i64;
    (0..n)
        .map(|i| {
            let s = start + (i as i64 * step);
            // Last range takes the remainder so integer division can't drop rows.
            let e = if i == n - 1 { end } else { s + step };
            [s, e]
        })
        .collect()
}

/// The ranges to fetch with their row counts, dense slices split, or the slices uncounted.
async fn count_and_split(
    ctx: &SliceSearch<'_>,
    req: &config::meta::search::Request,
    slices: Vec<[i64; 2]>,
    req_size: i64,
) -> (Vec<[i64; 2]>, Option<Vec<usize>>) {
    if !rows_countable(req) {
        return (slices, None);
    }
    let Some(rows) = count_slices(ctx, req, "c", &slices).await else {
        return (slices, None);
    };
    let split = split_dense_slices(&slices, &rows, fetch_share(req_size, None, slices.len()));
    let to_count: Vec<[i64; 2]> = split
        .iter()
        .filter(|(_, n)| n.is_none())
        .map(|(r, _)| *r)
        .collect();
    if to_count.is_empty() {
        return (slices, Some(rows));
    }
    let Some(sub_rows) = count_slices(ctx, req, "s", &to_count).await else {
        return (slices, None);
    };
    let rows = fill_counts(&split, sub_rows);
    (split.into_iter().map(|(r, _)| r).collect(), Some(rows))
}

/// Whether a slice count matches what its fetch returns: a query function may drop rows [pure].
fn rows_countable(req: &config::meta::search::Request) -> bool {
    req.query.query_fn.is_none()
}

/// Slices holding more than `limit` rows cut into equal sub-slices still to count [pure].
fn split_dense_slices(
    ranges: &[[i64; 2]],
    rows: &[usize],
    limit: i64,
) -> Vec<([i64; 2], Option<usize>)> {
    let pieces = allocate_pieces(rows, limit.max(1) as usize, EXTRACTION_MAX_RANGES);
    let mut out = Vec::with_capacity(ranges.len());
    for ((&range, &n), &pieces) in ranges.iter().zip(rows).zip(&pieces) {
        if pieces < 2 || range[1] - range[0] < pieces as i64 {
            out.push((range, Some(n)));
            continue;
        }
        out.extend(even_ranges(range, pieces).into_iter().map(|r| (r, None)));
    }
    out
}

/// Pieces per slice, densest slices first, `max_ranges` ranges in all [pure].
fn allocate_pieces(rows: &[usize], limit: usize, max_ranges: usize) -> Vec<usize> {
    let wanted: Vec<usize> = rows
        .iter()
        .map(|&n| n.div_ceil(limit).clamp(1, EXTRACTION_MAX_SUB_SLICES))
        .collect();
    let mut pieces = vec![1usize; rows.len()];
    for _ in rows.len()..max_ranges {
        let densest = (0..rows.len())
            .filter(|&i| pieces[i] < wanted[i])
            .max_by(|&a, &b| {
                (rows[a] * pieces[b])
                    .cmp(&(rows[b] * pieces[a]))
                    .then(b.cmp(&a))
            });
        let Some(i) = densest else {
            break;
        };
        pieces[i] += 1;
    }
    pieces
}

/// Counts in range order: known ones kept, the rest taken in turn from `sub_rows` [pure].
fn fill_counts(split: &[([i64; 2], Option<usize>)], sub_rows: Vec<usize>) -> Vec<usize> {
    let mut sub_rows = sub_rows.into_iter();
    split
        .iter()
        .map(|&(_, n)| n.or_else(|| sub_rows.next()).unwrap_or(0))
        .collect()
}

/// Rows to fetch per range: the oversampled budget over the ranges holding rows [pure].
fn fetch_share(req_size: i64, rows: Option<&[usize]>, ranges: usize) -> i64 {
    let non_empty = rows
        .map_or(ranges, |r| r.iter().filter(|&&n| n > 0).count())
        .max(1) as i64;
    // The 100-row floor is per slice; split ranges share it so small sizes don't read 8x more.
    let floor =
        (100 * EXTRACTION_TIME_SLICES as i64 / non_empty.max(EXTRACTION_TIME_SLICES as i64)).max(1);
    ((req_size * EXTRACTION_OVERSAMPLE) / non_empty).max(floor)
}

/// Row count of every slice, or `None` when any count fails.
async fn count_slices(
    ctx: &SliceSearch<'_>,
    req: &config::meta::search::Request,
    label: &str,
    ranges: &[[i64; 2]],
) -> Option<Vec<usize>> {
    let reqs = ranges
        .iter()
        .map(|&range| {
            let mut count_req = slice_request(req, range, 1, None);
            count_req.query.track_total_hits = true;
            // A VRL function runs over the count row and could drop it, reading as zero rows.
            count_req.query.query_fn = None;
            count_req.query.uses_zo_fn = false;
            count_req
        })
        .collect();
    let mut rows = Vec::with_capacity(ranges.len());
    for result in ctx.run(label, reqs).await {
        match result {
            Ok(res) if !res.is_partial => rows.push(res.total),
            Ok(res) => {
                log::warn!(
                    "[HTTP2_STREAM trace_id {}] Pattern extraction: slice count partial, using sample shares: {:?}",
                    ctx.trace_id,
                    res.function_error
                );
                return None;
            }
            Err(e) => {
                log::warn!(
                    "[HTTP2_STREAM trace_id {}] Pattern extraction: slice count failed, using sample shares: {e}",
                    ctx.trace_id
                );
                return None;
            }
        }
    }
    Some(rows)
}

/// How to read a slice of `rows` rows within `limit` [pure].
fn plan_slice_fetch(rows: Option<usize>, limit: i64, can_read_oldest: bool) -> SliceFetch {
    match rows {
        Some(0) => SliceFetch::Skip,
        Some(n) if can_read_oldest && n as i64 > limit => SliceFetch::BothEnds {
            newest: limit / 2,
            oldest: limit - limit / 2,
        },
        _ => SliceFetch::Newest(limit),
    }
}

/// `sql` reading its oldest rows first, or `None` when the SQL already picks its own order [pure].
fn oldest_first_sql(sql: &str) -> Option<String> {
    let asc = check_or_add_order_by_timestamp(sql, true).ok()?;
    let desc = check_or_add_order_by_timestamp(sql, false).ok()?;
    (asc != desc).then_some(asc)
}

/// `req` narrowed to one slice and `size` rows, optionally with replacement SQL [pure].
fn slice_request(
    req: &config::meta::search::Request,
    [start, end]: [i64; 2],
    size: i64,
    sql: Option<&str>,
) -> config::meta::search::Request {
    let mut slice_req = req.clone();
    slice_req.query.start_time = start;
    slice_req.query.end_time = end;
    slice_req.query.size = size;
    slice_req.query.from = 0;
    if let Some(sql) = sql {
        slice_req.query.sql = sql.to_string();
    }
    slice_req
}

/// Slice responses trimmed to `budget`, tagged with why the sample is partial [pure].
fn build_sample(
    ranges: &[[i64; 2]],
    slices: Vec<Option<Response>>,
    failed: &[bool],
    rows: Option<&[usize]>,
    budget: usize,
) -> Vec<Response> {
    let mut kept_ranges = Vec::new();
    let mut fetched = Vec::new();
    let mut responses = Vec::new();
    for (i, slice) in slices.into_iter().enumerate() {
        let Some(mut res) = slice.filter(|_| !failed[i]) else {
            continue;
        };
        if let Some(rows) = rows {
            res.total = rows[i];
        }
        kept_ranges.push(ranges[i]);
        fetched.push(res.hits.len());
        responses.push(res);
    }

    // The accumulator overwrites its earliest rows once over its cap, so trim to it here.
    trim_slices_to_budget(&mut responses, budget);

    let mut reasons = Vec::new();
    if rows.is_none() {
        // Without counts every kept row stands for itself, so shares stay the sample's own.
        for res in &mut responses {
            res.total = res.hits.len();
        }
        if ranges.len() > 1 {
            let reason = "Pattern percentages reflect the sample only: rows per time slice could not be counted";
            reasons.push(reason.to_string());
        }
    }
    let failed_slices = failed.iter().filter(|f| **f).count();
    if failed_slices > 0 {
        reasons.push(format!(
            "Patterns built from {} of {} time ranges",
            ranges.len() - failed_slices,
            ranges.len()
        ));
    }
    let bursts = (0..responses.len())
        .filter(|&i| is_thin_burst(fetched[i], &responses[i], kept_ranges[i]))
        .count();
    if bursts > 0 {
        reasons.push(format!(
            "Patterns sampled only part of a dense burst in {bursts} time slices; patterns from the rest of a burst may be missing"
        ));
    }
    mark_partial(&mut responses, reasons);
    responses
}

/// One slice response from its newest-first then oldest-first reads, no row twice [pure].
fn merge_both_ends(mut newest: Response, oldest: Response) -> Response {
    // Rows tied on the boundary timestamp can come back from both reads.
    let newest_from = newest.hits.iter().filter_map(hit_ts).min();
    let oldest_hits: Vec<json::Value> = oldest
        .hits
        .into_iter()
        .filter(|h| match (newest_from, hit_ts(h)) {
            (Some(from), Some(t)) => t < from,
            _ => true,
        })
        .collect();
    newest.hits.extend(oldest_hits);
    newest.scan_records += oldest.scan_records;
    newest.scan_size += oldest.scan_size;
    newest.is_partial |= oldest.is_partial;
    newest.function_error.extend(oldest.function_error);
    newest
}

/// Whether a slice whose fetch fell short of its rows kept rows spanning under half of it [pure].
fn is_thin_burst(fetched: usize, res: &Response, [start, end]: [i64; 2]) -> bool {
    if res.total <= fetched {
        return false;
    }
    let (lo, hi) = res
        .hits
        .iter()
        .filter_map(hit_ts)
        .fold((i64::MAX, i64::MIN), |(lo, hi), t| (lo.min(t), hi.max(t)));
    lo <= hi && (hi - lo) * 2 < end - start
}

fn hit_ts(hit: &json::Value) -> Option<i64> {
    hit.get(TIMESTAMP_COL_NAME).and_then(|v| v.as_i64())
}

/// Trim slices to `budget` max-min fairly, keeping evenly spaced rows and each slice's `total`.
fn trim_slices_to_budget(responses: &mut [Response], budget: usize) {
    let total: usize = responses.iter().map(|r| r.hits.len()).sum();
    if total <= budget || responses.is_empty() {
        return;
    }

    // Allocate ascending by size: each step hands out an even share of what's
    // left, so any slack from a small slice rolls into the larger ones.
    let mut order: Vec<usize> = (0..responses.len()).collect();
    order.sort_by_key(|&i| responses[i].hits.len());

    let mut allowance = vec![0usize; responses.len()];
    let mut remaining = budget;
    let mut slices_left = responses.len();
    for &i in &order {
        let share = remaining / slices_left.max(1);
        let take = responses[i].hits.len().min(share);
        allowance[i] = take;
        remaining -= take;
        slices_left -= 1;
    }

    for (i, res) in responses.iter_mut().enumerate() {
        res.hits = spread(std::mem::take(&mut res.hits), allowance[i]);
        res.size = res.hits.len() as i64;
    }
}

/// `keep` rows evenly spaced across `hits`, so a slice stays covered end to end [pure].
fn spread(hits: Vec<json::Value>, keep: usize) -> Vec<json::Value> {
    let len = hits.len();
    if keep >= len {
        return hits;
    }
    let mut k = 0;
    hits.into_iter()
        .enumerate()
        .filter(|&(i, _)| {
            let take = k < keep && i == k * len / keep;
            k += usize::from(take);
            take
        })
        .map(|(_, h)| h)
        .collect()
}

fn mark_partial(responses: &mut [Response], reasons: Vec<String>) {
    let Some(first) = responses.first_mut() else {
        return;
    };
    for reason in reasons {
        first.set_partial(true, reason);
    }
}

#[cfg(feature = "enterprise")]
pub(super) fn tag_partial_extraction(
    patterns: &mut config::utils::json::Value,
    results: &[SearchResultType],
) {
    let mut reasons: Vec<String> = Vec::new();
    let mut partial = false;
    for result in results {
        let (SearchResultType::Search(r) | SearchResultType::Cached(r)) = result;
        partial |= r.is_partial;
        for reason in &r.function_error {
            if !reasons.contains(reason) {
                reasons.push(reason.clone());
            }
        }
    }
    if !partial {
        return;
    }
    if let Some(obj) = patterns.as_object_mut() {
        obj.insert("is_partial".to_string(), true.into());
        obj.insert("function_error".to_string(), reasons.into());
    }
}

#[cfg(feature = "enterprise")]
/// An empty Patterns body carrying the partial reasons, so a window cut or failed slice is
/// not lost when the surviving slices returned no rows. None when nothing was partial.
pub(super) fn empty_partial_patterns(
    results: &[SearchResultType],
) -> Option<config::utils::json::Value> {
    let mut body = serde_json::json!({
        "patterns": [],
        "statistics": {
            "total_logs_analyzed": 0,
            "total_patterns_found": 0,
            "coverage_percentage": 0.0,
            "extraction_time_ms": 0
        }
    });
    tag_partial_extraction(&mut body, results);
    body.get("is_partial").is_some().then_some(body)
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
        search_type: req.search_type,
        timezone: req.query.timezone.clone(),
        raw_streams: req.raw_streams.clone(),
    };

    let res = SearchService::search_partition(
        trace_id,
        org_id,
        Some(user_id),
        stream_type,
        &search_partition_req,
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
    req_no: usize,
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
        partitions
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
        let start_timer = Instant::now();
        let trace_id = format!("{trace_id}-{}", req_no + idx);
        let mut search_res = do_search(
            &trace_id,
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
        if is_result_array_skip_vrl {
            search_res.hits = crate::cache::apply_vrl_to_response(
                backup_query_fn.clone(),
                &mut search_res,
                org_id,
                stream_name,
                &trace_id,
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
                &trace_id,
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
    if is_streaming_aggs && let Some(streaming_id) = partition_resp.streaming_id {
        streaming_aggs_exec::registry::remove_cache(&streaming_id)
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
    if is_result_array_skip_vrl {
        s_resp.hits = crate::cache::apply_vrl_to_response(
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

#[cfg(test)]
mod tests {
    use config::meta::sql::OrderBy;
    use tokio::sync::mpsc;

    use super::*;

    fn slice_with(n: usize) -> Response {
        Response {
            hits: (0..n).map(|i| serde_json::json!({ "i": i })).collect(),
            total: n,
            ..Default::default()
        }
    }

    #[test]
    fn test_can_slice_extraction() {
        assert!(can_slice_extraction("SELECT * FROM t WHERE a = 1"));
        assert!(!can_slice_extraction("SELECT * FROM t LIMIT 10"));
        assert!(!can_slice_extraction(
            "SELECT * FROM t WHERE k IN (SELECT k FROM t WHERE b = 1)"
        ));
    }

    #[test]
    fn test_drop_failed_slices_removes_errored_and_dedupes() {
        let mut bad = slice_with(0);
        bad.function_error = vec!["cast error".into()];
        let mut bad2 = slice_with(0);
        bad2.function_error = vec!["cast error".into()];
        let mut slices = vec![Some(slice_with(3)), Some(bad), Some(bad2), None];
        let mut failed = vec![false; 4];
        let errors = drop_failed_slices(&mut slices, &mut failed);
        assert_eq!(slices.iter().filter(|s| s.is_some()).count(), 1);
        assert_eq!(failed, vec![false, true, true, false]);
        assert_eq!(errors, vec!["cast error".to_string()]);
    }

    #[test]
    fn test_drop_failed_slices_keeps_partial_slice_with_rows() {
        let mut partial = slice_with(3);
        partial.function_error = vec!["partial".into()];
        let mut slices = vec![Some(partial)];
        let mut failed = vec![false];
        assert!(drop_failed_slices(&mut slices, &mut failed).is_empty());
        assert!(slices[0].is_some() && !failed[0]);
    }

    #[test]
    fn test_drop_failed_slices_keeps_clean_slices() {
        let mut slices = vec![Some(slice_with(0)), Some(slice_with(2))];
        let mut failed = vec![false; 2];
        assert!(drop_failed_slices(&mut slices, &mut failed).is_empty());
        assert_eq!(failed, vec![false; 2]);
        assert!(slices.iter().all(Option::is_some));
    }

    #[test]
    fn test_apply_range_warning_marks_partial() {
        let mut r = slice_with(1);
        apply_range_warning(&mut r, "clamped", 5, 9);
        assert!(r.is_partial);
        assert_eq!(r.function_error, vec!["clamped".to_string()]);
        assert_eq!((r.new_start_time, r.new_end_time), (Some(5), Some(9)));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_empty_partial_patterns_keeps_warning_without_rows() {
        let mut r = slice_with(0);
        apply_range_warning(&mut r, "clamped", 5, 9);
        let body = empty_partial_patterns(&[SearchResultType::Search(r)]).unwrap();
        assert_eq!(body["is_partial"], true);
        assert_eq!(body["function_error"][0], "clamped");
        assert_eq!(body["patterns"].as_array().unwrap().len(), 0);
        assert!(empty_partial_patterns(&[SearchResultType::Search(slice_with(0))]).is_none());
    }

    #[test]
    fn test_apply_range_warning_noop_without_range_error() {
        let mut r = slice_with(1);
        apply_range_warning(&mut r, "", 5, 9);
        assert!(!r.is_partial && r.function_error.is_empty() && r.new_start_time.is_none());
    }

    #[test]
    fn test_trim_slices_under_budget_is_untouched() {
        let mut slices = vec![slice_with(10), slice_with(20)];
        trim_slices_to_budget(&mut slices, 100);
        assert_eq!(slices[0].hits.len(), 10);
        assert_eq!(slices[1].hits.len(), 20);
    }

    #[test]
    fn test_trim_slices_keeps_every_slice_represented() {
        // The bug this guards: handing the accumulator more than its cap makes
        // it overwrite the earliest slices, so they vanish from the sample.
        // Every slice must survive the trim with a share of the budget.
        let mut slices = vec![
            slice_with(2500),
            slice_with(2500),
            slice_with(2500),
            slice_with(2500),
            slice_with(2500),
            slice_with(2500),
        ];
        trim_slices_to_budget(&mut slices, 10_000);

        let total: usize = slices.iter().map(|s| s.hits.len()).sum();
        assert_eq!(total, 10_000, "must fill the budget exactly");
        for (i, s) in slices.iter().enumerate() {
            assert!(!s.hits.is_empty(), "slice {i} was dropped entirely");
        }
    }

    #[test]
    fn test_trim_slices_redistributes_slack_from_small_slices() {
        // A sparse slice keeps everything it has; its unused share goes to the
        // fuller slices rather than being wasted.
        let mut slices = vec![slice_with(10), slice_with(5000), slice_with(5000)];
        trim_slices_to_budget(&mut slices, 3000);

        let total: usize = slices.iter().map(|s| s.hits.len()).sum();
        assert_eq!(total, 3000);
        assert_eq!(slices[0].hits.len(), 10, "small slice keeps all its rows");
        assert!(slices[1].hits.len() > 1000 && slices[2].hits.len() > 1000);
    }

    #[test]
    fn test_trim_slices_keeps_each_slice_row_count() {
        let mut slices = vec![slice_with(5000), slice_with(5000)];
        slices[0].total = 80_000;
        trim_slices_to_budget(&mut slices, 1000);
        assert_eq!((slices[0].total, slices[1].total), (80_000, 5000));
        for s in &slices {
            assert_eq!(s.size, s.hits.len() as i64);
        }
    }

    #[test]
    fn test_trim_keeps_rows_spread_across_each_slice() {
        // A slice read newest-first in full must not keep only its newest rows.
        let mut slices = vec![slice_with(10)];
        trim_slices_to_budget(&mut slices, 5);
        let kept: Vec<u64> = slices[0]
            .hits
            .iter()
            .filter_map(|h| h["i"].as_u64())
            .collect();
        assert_eq!(kept, vec![0, 2, 4, 6, 8]);
    }

    #[test]
    fn test_rows_countable_only_without_a_query_function() {
        let mut req = config::meta::search::Request::default();
        assert!(rows_countable(&req));
        req.query.query_fn = Some("LmEgPSAx".to_string());
        assert!(!rows_countable(&req));
    }

    #[test]
    fn test_split_dense_slices() {
        // (slice, rows) -> pieces, for a limit of 10 rows; None marks a piece still to count
        type Piece = ([i64; 2], Option<usize>);
        let cases: Vec<([i64; 2], usize, Vec<Piece>)> = vec![
            ([0, 120], 10, vec![([0, 120], Some(10))]),
            (
                [0, 120],
                25,
                vec![([0, 40], None), ([40, 80], None), ([80, 120], None)],
            ),
            (
                [0, 800],
                1000,
                (0..8).map(|i| ([i * 100, i * 100 + 100], None)).collect(),
            ),
            ([0, 2], 30, vec![([0, 2], Some(30))]),
        ];
        for (range, rows, expected) in cases {
            assert_eq!(
                split_dense_slices(&[range], &[rows], 10),
                expected,
                "{range:?} {rows}"
            );
        }
    }

    #[test]
    fn test_allocate_pieces_caps_total_ranges() {
        // (rows per slice, limit, max ranges) -> pieces per slice, densest slices first
        let cases: Vec<(Vec<usize>, usize, usize, Vec<usize>)> = vec![
            (vec![1000; 12], 10, 24, vec![2; 12]),
            (
                [vec![1000], vec![5; 11]].concat(),
                10,
                24,
                [vec![8], vec![1; 11]].concat(),
            ),
            (vec![1000, 500], 10, 4, vec![3, 1]),
            (vec![15, 0], 10, 24, vec![2, 1]),
        ];
        for (rows, limit, max, expected) in cases {
            assert_eq!(allocate_pieces(&rows, limit, max), expected, "{rows:?}");
        }
    }

    #[test]
    fn test_fill_counts_takes_sub_counts_in_order() {
        let split = [
            ([0, 1], Some(5)),
            ([1, 2], None),
            ([2, 3], Some(0)),
            ([3, 4], None),
        ];
        assert_eq!(fill_counts(&split, vec![7, 9]), vec![5, 7, 0, 9]);
    }

    #[test]
    fn test_fetch_share_spreads_over_non_empty_ranges() {
        // (rows per range) -> share of 3 * 1200 rows
        let cases: [(Option<&[usize]>, usize, i64); 5] = [
            (None, 12, 300),
            (Some(&[5, 0, 0, 7]), 4, 1800),
            (Some(&[0, 0]), 2, 3600),
            (Some(&[1; 400]), 400, 9),
            (Some(&[1; 96]), 96, 37),
        ];
        for (rows, ranges, expected) in cases {
            assert_eq!(fetch_share(1200, rows, ranges), expected, "{rows:?}");
        }
    }

    #[test]
    fn test_plan_slice_fetch() {
        // (rows, can read oldest first) -> plan, for a limit of 100
        let both = SliceFetch::BothEnds {
            newest: 50,
            oldest: 50,
        };
        let cases = [
            (Some(0), true, SliceFetch::Skip),
            (Some(100), true, SliceFetch::Newest(100)),
            (Some(101), true, both),
            (Some(101), false, SliceFetch::Newest(100)),
            (None, true, SliceFetch::Newest(100)),
        ];
        for (rows, can_read_oldest, expected) in cases {
            assert_eq!(
                plan_slice_fetch(rows, 100, can_read_oldest),
                expected,
                "{rows:?}"
            );
        }
    }

    #[test]
    fn test_oldest_first_sql_only_when_sql_has_no_order() {
        let cases = [
            (
                "SELECT * FROM \"s\" WHERE a = 1",
                Some("SELECT * FROM \"s\" WHERE a = 1 ORDER BY _timestamp ASC"),
            ),
            ("SELECT * FROM \"s\" ORDER BY code DESC", None),
            ("not sql", None),
        ];
        for (sql, expected) in cases {
            assert_eq!(oldest_first_sql(sql).as_deref(), expected, "{sql}");
        }
    }

    #[test]
    fn test_merge_both_ends_appends_the_oldest_read() {
        let newest = Response {
            hits: vec![json::json!("n0"), json::json!("n1"), json::json!("n2")],
            scan_records: 3,
            ..Default::default()
        };
        let oldest = Response {
            hits: vec![json::json!("o0")],
            scan_records: 1,
            ..Default::default()
        };
        let merged = merge_both_ends(newest, oldest);
        assert_eq!(
            merged.hits,
            vec![
                json::json!("n0"),
                json::json!("n1"),
                json::json!("n2"),
                json::json!("o0")
            ]
        );
        assert_eq!(merged.scan_records, 4);
    }

    #[test]
    fn test_merge_both_ends_drops_rows_both_reads_returned() {
        let at = |ts: &[i64]| Response {
            hits: ts
                .iter()
                .map(|t| json::json!({ "_timestamp": t }))
                .collect(),
            ..Default::default()
        };
        let merged = merge_both_ends(at(&[9, 7, 7]), at(&[1, 7, 7]));
        let ts: Vec<i64> = merged.hits.iter().filter_map(hit_ts).collect();
        assert_eq!(ts, vec![9, 7, 7, 1]);
    }

    #[test]
    fn test_build_sample() {
        let at = |ts: &[i64]| Response {
            hits: ts
                .iter()
                .map(|t| json::json!({ "_timestamp": t }))
                .collect(),
            ..Default::default()
        };
        let ranges = [[0, 100], [100, 200], [200, 300]];
        let slices = || vec![Some(at(&[40, 60])), Some(at(&[100, 199])), Some(at(&[250]))];
        let reasons = |r: &[Response]| r[0].function_error.join(" | ");

        // Counted: slice rows as totals, a narrow truncated slice is a burst, failed drops.
        let counted = build_sample(
            &ranges,
            slices(),
            &[false, false, true],
            Some(&[50, 90, 7]),
            100,
        );
        assert_eq!(
            counted.iter().map(|r| r.total).collect::<Vec<_>>(),
            vec![50, 90]
        );
        assert!(counted[0].is_partial);
        assert!(reasons(&counted).contains("Patterns built from 2 of 3 time ranges"));
        assert!(reasons(&counted).contains("dense burst in 1 time slices"));

        // Not counted: totals are the rows the trim kept.
        let uncounted = build_sample(&ranges, slices(), &[false; 3], None, 3);
        assert_eq!(
            uncounted
                .iter()
                .map(|r| (r.total, r.hits.len()))
                .collect::<Vec<_>>(),
            vec![(1, 1), (1, 1), (1, 1)]
        );
        assert!(reasons(&uncounted).contains("rows per time slice could not be counted"));
        assert!(!reasons(&uncounted).contains("dense burst"));

        let clean = build_sample(&ranges, slices(), &[false; 3], Some(&[2, 2, 1]), 100);
        assert!(!clean[0].is_partial);

        // One uncounted range: its sample shares are already the window's.
        let whole = build_sample(&[[0, 300]], vec![Some(at(&[40]))], &[false], None, 100);
        assert!(!whole[0].is_partial);
    }

    #[test]
    fn test_is_thin_burst() {
        let at = |ts: &[i64], total: usize| Response {
            hits: ts
                .iter()
                .map(|t| json::json!({ "_timestamp": t }))
                .collect(),
            total,
            ..Default::default()
        };
        // (kept timestamps, slice rows, rows fetched) -> thin burst, for a slice [0, 100)
        let cases: [(&[i64], usize, usize, bool); 6] = [
            (&[40, 60], 10, 2, true),
            (&[0, 99], 10, 2, false),
            (&[40, 60], 2, 2, false),
            (&[], 10, 2, false),
            (&[0, 50], 10, 2, false),
            // Read in full, only the budget trim cut it: the whole burst was sampled.
            (&[40, 60], 10, 10, false),
        ];
        for (ts, rows, fetched, expected) in cases {
            assert_eq!(
                is_thin_burst(fetched, &at(ts, rows), [0, 100]),
                expected,
                "{ts:?} {rows}"
            );
        }
    }

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
        )
        .await;

        // Should not panic, should return Ok
        assert!(result.is_ok());
    }
}

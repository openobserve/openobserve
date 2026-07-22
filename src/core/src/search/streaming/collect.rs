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

//! Run the partitioned streaming search pipeline and collect its event stream
//! into one `Response` (agent `mode: partition`). Same executor as the SSE endpoint —
//! per-partition early termination and streaming-aggs caching included — only
//! the transport differs: events are folded here instead of pushed to a
//! client. Dropping the receiver stops the partition loop, so a cancelled
//! request (client disconnect) does not keep scanning.

use config::meta::{
    search::{Request, Response, SearchEventType, StreamResponses},
    sql::OrderBy,
    stream::StreamType,
};
use tokio::sync::mpsc;

use super::process_search_stream_request;

/// Channel depth: the pipeline produces one `SearchResponse` + one `Progress`
/// event per partition; the consumer only folds, so a small buffer suffices.
const EVENT_CHANNEL_SIZE: usize = 100;

/// Entry point for `agent_options.mode = partition`: run the partitioned
/// streaming pipeline and return the folded single response.
#[allow(clippy::too_many_arguments)]
pub async fn search_partition_mode(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    req: &mut Request,
    stream_type: StreamType,
    stream_names: Vec<String>,
    fallback_order_by_col: Option<String>,
    range_error: String,
    http_span: tracing::Span,
    is_multi_stream_search: bool,
) -> Result<Response, infra::errors::Error> {
    // the partition loop requires a populated search_type
    if req.search_type.is_none() {
        req.search_type = Some(SearchEventType::Other);
    }

    // partition scan direction follows the query's ORDER BY
    let sql = crate::service::search::sql::Sql::new(
        &req.query.clone().into(),
        org_id,
        stream_type,
        req.search_type,
    )
    .await?;
    let req_order_by = sql.order_by.first().map(|v| v.1).unwrap_or_default();

    let mut res = search_stream_collect(
        org_id,
        user_id,
        trace_id,
        req.clone(),
        stream_type,
        stream_names,
        req_order_by,
        fallback_order_by_col,
        http_span,
        is_multi_stream_search,
    )
    .await?;

    // attach the range-clamp note the same way the cache path does
    if !range_error.is_empty() {
        res.is_partial = true;
        res.new_start_time = Some(req.query.start_time);
        res.new_end_time = Some(req.query.end_time);
        if !res.function_error.contains(&range_error) {
            res.function_error.push(range_error);
        }
    }
    Ok(res)
}

#[allow(clippy::too_many_arguments)]
async fn search_stream_collect(
    org_id: &str,
    user_id: &str,
    trace_id: &str,
    req: Request,
    stream_type: StreamType,
    stream_names: Vec<String>,
    req_order_by: OrderBy,
    fallback_order_by_col: Option<String>,
    search_span: tracing::Span,
    is_multi_stream_search: bool,
) -> Result<Response, infra::errors::Error> {
    let (tx, mut rx) = mpsc::channel(EVENT_CHANNEL_SIZE);

    tokio::spawn(process_search_stream_request(
        trace_id.to_string(),
        org_id.to_string(),
        user_id.to_string(),
        req,
        stream_type,
        stream_names,
        req_order_by,
        search_span,
        tx,
        None, // values_ctx: only used by the _values endpoint
        fallback_order_by_col,
        None, // audit_ctx: the collecting caller audits at its own layer
        is_multi_stream_search,
        false, // extract_patterns
    ));

    let mut merged: Option<Response> = None;
    while let Some(event) = rx.recv().await {
        match event {
            Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs,
                ..
            }) => {
                fold_response(&mut merged, results, streaming_aggs);
            }
            Ok(StreamResponses::Progress { .. }) => {}
            Ok(StreamResponses::Done) => break,
            Ok(StreamResponses::Cancelled) => {
                if let Some(res) = merged.as_mut() {
                    res.is_partial = true;
                }
                break;
            }
            // Other variants (chunked/promql/pattern events) are never
            // produced by this pipeline configuration.
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }

    Ok(merged.unwrap_or_default())
}

/// Fold one per-partition response into the accumulator.
///
/// Streaming-aggs events carry the progressively merged aggregation state, so
/// each event replaces the previous one. Plain events are one partition's page
/// each: hits append (partitions arrive already in scan order, each page
/// sorted), scan counters add up, and flags/meta widen.
fn fold_response(merged: &mut Option<Response>, mut results: Response, streaming_aggs: bool) {
    let Some(acc) = merged.as_mut() else {
        results.total = results.hits.len();
        *merged = Some(results);
        return;
    };

    if streaming_aggs {
        // keep cumulative scan/took counters, replace the data
        results.scan_size += acc.scan_size;
        results.idx_scan_size += acc.idx_scan_size;
        results.scan_records += acc.scan_records;
        results.took += acc.took;
        results.took_detail.add(&acc.took_detail);
        results.is_partial |= acc.is_partial;
        results.total = results.hits.len();
        *merged = Some(results);
        return;
    }

    acc.hits.append(&mut results.hits);
    acc.total = acc.hits.len();
    acc.scan_size += results.scan_size;
    acc.idx_scan_size += results.idx_scan_size;
    acc.scan_records += results.scan_records;
    acc.took += results.took;
    acc.took_detail.add(&results.took_detail);
    acc.cached_ratio = acc.cached_ratio.max(results.cached_ratio);
    acc.result_cache_ratio = acc.result_cache_ratio.max(results.result_cache_ratio);
    acc.is_partial |= results.is_partial;
    for e in results.function_error {
        if !acc.function_error.contains(&e) {
            acc.function_error.push(e);
        }
    }
    if results.new_start_time.is_some() {
        acc.new_start_time = results.new_start_time;
        acc.new_end_time = results.new_end_time;
    }
    if acc.order_by.is_none() {
        acc.order_by = results.order_by;
    }
    if acc.histogram_interval.is_none() {
        acc.histogram_interval = results.histogram_interval;
    }
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;

    use super::*;

    fn page(hits: Vec<config::utils::json::Value>, scan_size: usize) -> Response {
        Response {
            hits,
            scan_size,
            took: 10,
            ..Default::default()
        }
    }

    #[test]
    fn fold_appends_pages_and_sums_counters() {
        let mut merged = None;
        fold_response(&mut merged, page(vec![json!({"a": 1})], 100), false);
        fold_response(
            &mut merged,
            page(vec![json!({"a": 2}), json!({"a": 3})], 50),
            false,
        );
        let res = merged.unwrap();
        assert_eq!(res.hits.len(), 3);
        assert_eq!(res.total, 3);
        assert_eq!(res.scan_size, 150);
        assert_eq!(res.took, 20);
    }

    #[test]
    fn fold_streaming_aggs_replaces_data_keeps_counters() {
        let mut merged = None;
        fold_response(&mut merged, page(vec![json!({"cnt": 10})], 100), true);
        fold_response(&mut merged, page(vec![json!({"cnt": 25})], 60), true);
        let res = merged.unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0]["cnt"], 25);
        assert_eq!(res.scan_size, 160);
        assert_eq!(res.took, 20);
    }

    #[test]
    fn fold_widens_partial_flag_and_dedups_errors() {
        let mut merged = None;
        let mut first = page(vec![json!({"a": 1})], 0);
        first.function_error = vec!["range clamped".to_string()];
        first.is_partial = true;
        fold_response(&mut merged, first, false);
        let mut second = page(vec![json!({"a": 2})], 0);
        second.function_error = vec!["range clamped".to_string()];
        fold_response(&mut merged, second, false);
        let res = merged.unwrap();
        assert!(res.is_partial);
        assert_eq!(res.function_error.len(), 1);
    }
}

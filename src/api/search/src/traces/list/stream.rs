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

use std::collections::HashSet;

use axum::response::Response;
use config::{
    get_config,
    meta::{
        search::{Request, SearchPartitionRequest, StreamResponses, TimeOffset},
        stream::StreamType,
    },
    utils::json,
};
use futures::stream::StreamExt;
use search_service::{self as SearchService, streaming::sorting::TopKHeap};
use tokio::sync::mpsc;
use tracing::{Instrument, Span};

use super::{
    plan::TraceListPlan,
    query::{TraceSearchContext, build_partition_query},
    response::TraceBatch,
};
use crate::search::error_utils::map_error_to_http_response;

pub fn stream_response(ctx: TraceSearchContext, plan: TraceListPlan, span: Span) -> Response {
    let trace_id = ctx.trace_id.clone();
    let (tx, rx) = mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);
    tokio::spawn(run(ctx, plan, tx).instrument(span));
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!("[TRACES_STREAM trace_id {trace_id}] Error: {err}");
                let err_res = match err {
                    infra::errors::Error::ErrorCode(ref code) => {
                        let message = code.get_message();
                        let error_detail = code.get_error_detail();
                        let http_response = map_error_to_http_response(&err, None);
                        StreamResponses::Error {
                            code: http_response.status().into(),
                            message,
                            error_detail: Some(error_detail),
                        }
                    }
                    _ => StreamResponses::Error {
                        code: 500,
                        message: err.to_string(),
                        error_detail: None,
                    },
                };
                err_res.to_chunks()
            }
        };
        futures::stream::iter(chunks_iter)
    });

    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

async fn run(
    ctx: TraceSearchContext,
    plan: TraceListPlan,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) {
    let org_id = ctx.org_id.clone();
    let stream_name = ctx.stream_name.clone();
    let user_id = ctx.user_id.clone();
    let trace_id = ctx.trace_id.clone();
    let stream_type = StreamType::Traces;
    let (start_time, end_time) = plan.options.range;
    let from = plan.options.from;
    let size = plan.options.size;
    let use_cache = plan.options.use_cache;
    let range_error = plan.options.range_error.clone();
    if sender
        .send(Ok(StreamResponses::Progress { percent: 0 }))
        .await
        .is_err()
    {
        return;
    }

    let base_req = plan.request(&stream_name);

    let partition_req = SearchPartitionRequest {
        sql: build_partition_query(&stream_name),
        start_time,
        end_time,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        query_fn: None,
        streaming_output: false,
        histogram_interval: 0,
        sampling_ratio: None,
        search_type: Some(config::meta::search::SearchEventType::UI),
    };

    let partitions = match SearchService::search_partition(
        &trace_id,
        &org_id,
        Some(user_id.as_str()),
        stream_type,
        &partition_req,
        false,
        use_cache,
    )
    .await
    {
        Ok(resp) => resp.partitions,
        Err(e) => {
            log::error!("[TRACES_STREAM trace_id {trace_id}] Failed to get partitions: {e}");
            let _ = sender.send(Err(e)).await;
            return;
        }
    };

    if partitions.is_empty() {
        let _ = sender.send(Ok(StreamResponses::Done)).await;
        return;
    }

    let total_partitions = partitions.len();
    let is_non_ts_order_by = plan.sort.by_duration;
    let partitions_desc: Vec<[i64; 2]> = if !is_non_ts_order_by && plan.sort.ascending {
        log::info!(
            "[TRACES_STREAM trace_id {trace_id}] using {} time partitions, order=ASC",
            partitions.len()
        );
        partitions.into_iter().rev().collect()
    } else {
        log::info!(
            "[TRACES_STREAM trace_id {trace_id}] using {} time partitions, order={}",
            partitions.len(),
            if is_non_ts_order_by {
                format!("non-ts ({}), TopKHeap", plan.sort.sql())
            } else {
                "DESC".to_string()
            }
        );
        partitions
    };

    let heap_k = if from + size > 0 {
        (from + size) as usize
    } else {
        get_config().limit.query_default_limit as usize
    };
    let non_ts_col = "zo_sql_duration".to_string();
    let non_ts_is_desc = !plan.sort.ascending;
    let mut topk_heap: Option<TopKHeap> = if is_non_ts_order_by {
        Some(TopKHeap::new(heap_k, &[(non_ts_col, non_ts_is_desc)]))
    } else {
        None
    };

    // Partition boundaries follow the querier count, so a global `from` can shift between pages.
    let mut hits_seen: i64 = 0;
    let hits_to_skip = from;
    let hits_to_deliver = size;
    let mut hits_delivered: i64 = 0;
    let mut total_across_partitions: usize = 0;
    let mut range_error_sent = false;
    let mut seen_trace_ids: HashSet<String> = HashSet::new();
    let mut consecutive_empty_partitions: i64 = 0;

    for (idx, partition) in partitions_desc.iter().enumerate() {
        if sender.is_closed() {
            break;
        }
        if hits_delivered >= hits_to_deliver {
            break;
        }

        let p_start = partition[0];
        let p_end = partition[1];

        let remaining_to_skip = (hits_to_skip - hits_seen).max(0);
        let remaining_needed = hits_to_deliver - hits_delivered;
        let fetch_size = if is_non_ts_order_by {
            heap_k as i64
        } else {
            (remaining_to_skip + remaining_needed).min(get_config().limit.query_default_limit)
        };

        let mut req1 = base_req.clone();
        req1.query.start_time = p_start;
        req1.query.end_time = p_end;
        req1.query.from = 0;
        req1.query.size = fetch_size;

        let agg_res = match ctx.search(&req1).await {
            Ok(res) => res,
            Err(e) => {
                log::error!(
                    "[TRACES_STREAM trace_id {trace_id}] Query1 error on partition [{p_start},{p_end}]: {e}"
                );
                let _ = sender.send(Err(e)).await;
                return;
            }
        };

        let raw_hit_count = agg_res.hits.len();
        if !is_non_ts_order_by {
            if raw_hit_count == 0 {
                consecutive_empty_partitions += 1;
                if consecutive_empty_partitions >= 3 {
                    break;
                }
            } else {
                consecutive_empty_partitions = 0;
            }
        }

        let deduped_hits: Vec<_> = agg_res
            .hits
            .into_iter()
            .filter(|item| {
                let tid = item
                    .get("trace_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                !tid.is_empty() && !seen_trace_ids.contains(tid)
            })
            .collect();
        let partition_total = deduped_hits.len() as i64;
        total_across_partitions += deduped_hits.len();
        hits_seen += partition_total;

        if deduped_hits.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        if is_non_ts_order_by {
            for item in &deduped_hits {
                if let Some(tid) = item.get("trace_id").and_then(|v| v.as_str())
                    && !tid.is_empty()
                {
                    seen_trace_ids.insert(tid.to_string());
                }
            }
            if let Some(ref mut heap) = topk_heap {
                heap.push_hits(deduped_hits);
            }
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        let hits_seen_before = hits_seen - partition_total;
        let deliverable_q1 = select_timestamp_page(
            deduped_hits,
            &mut seen_trace_ids,
            hits_to_skip - hits_seen_before,
            (hits_to_deliver - hits_delivered) as usize,
        );

        if deliverable_q1.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        let Some(batch) = load_batch(
            &ctx,
            &plan,
            deliverable_q1,
            (p_start, p_end),
            &base_req,
            &sender,
        )
        .await
        else {
            return;
        };

        let deliverable: Vec<serde_json::Value> = batch
            .into_sorted_items(plan.sort)
            .iter()
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Null))
            .collect();

        hits_delivered += deliverable.len() as i64;

        let mut results = config::meta::search::Response::default();
        for h in deliverable {
            results.add_hit(h);
        }
        results.set_total(total_across_partitions);
        if !range_error.is_empty() && !range_error_sent {
            results.function_error.push(range_error.clone());
            range_error_sent = true;
        }

        let progress = ((idx + 1) * 100) / total_partitions;
        if sender
            .send(Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs: false,
                streaming_id: None,
                time_offset: TimeOffset {
                    start_time: p_start,
                    end_time: p_end,
                },
            }))
            .await
            .is_err()
        {
            return;
        }

        if sender
            .send(Ok(StreamResponses::Progress { percent: progress }))
            .await
            .is_err()
        {
            return;
        }
    }

    if is_non_ts_order_by {
        let deliverable_q1 = topk_heap
            .take()
            .map(|h| h.into_sorted_vec(from as usize))
            .unwrap_or_default();

        if deliverable_q1.is_empty() {
            let _ = sender.send(Ok(StreamResponses::Done)).await;
            return;
        }

        let Some(batch) = load_batch(
            &ctx,
            &plan,
            deliverable_q1,
            (start_time, end_time),
            &base_req,
            &sender,
        )
        .await
        else {
            return;
        };

        let deliverable: Vec<serde_json::Value> = batch
            .into_sorted_items(plan.sort)
            .iter()
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Null))
            .collect();

        let mut results = config::meta::search::Response::default();
        for h in deliverable {
            results.add_hit(h);
        }
        results.set_total(total_across_partitions);
        if !range_error.is_empty() {
            results.function_error.push(range_error.clone());
        }

        let _ = sender
            .send(Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs: false,
                streaming_id: None,
                time_offset: TimeOffset {
                    start_time,
                    end_time,
                },
            }))
            .await;
        let _ = sender.send(Ok(StreamResponses::Done)).await;
        return;
    }

    let _ = sender.send(Ok(StreamResponses::Done)).await;
}

async fn load_batch(
    ctx: &TraceSearchContext,
    plan: &TraceListPlan,
    hits: Vec<json::Value>,
    range: (i64, i64),
    base_request: &Request,
    sender: &mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) -> Option<TraceBatch> {
    let hits = match ctx.summarize_traces(plan, base_request, hits, range).await {
        Ok(hits) => hits,
        Err(error) => {
            log::error!(
                "[TRACES_STREAM trace_id {}] Q2a error ({range:?}): {error}",
                ctx.trace_id
            );
            let _ = sender.send(Err(error)).await;
            return None;
        }
    };
    let mut batch = TraceBatch::from_hits(&hits, range);
    if !batch.multi_service_ids.is_empty() && sender.is_closed() {
        return None;
    }
    let service_range = batch.range;
    if let Err(error) = ctx
        .fill_services(&mut batch, base_request, &plan.columns, service_range)
        .await
    {
        log::error!(
            "[TRACES_STREAM trace_id {}] Q2b error ({range:?}): {error}",
            ctx.trace_id
        );
        let _ = sender.send(Err(error)).await;
        return None;
    }
    Some(batch)
}

fn select_timestamp_page(
    mut hits: Vec<json::Value>,
    seen_trace_ids: &mut HashSet<String>,
    skip: i64,
    need: usize,
) -> Vec<json::Value> {
    hits.sort_by(|a, b| {
        let a_t = json::get_int_value(a.get("trace_start_time").unwrap_or_default());
        let b_t = json::get_int_value(b.get("trace_start_time").unwrap_or_default());
        b_t.cmp(&a_t)
    });
    // Skipped IDs must also be remembered because their spans can appear in later partitions.
    for item in &hits {
        if let Some(tid) = item.get("trace_id").and_then(json::Value::as_str)
            && !tid.is_empty()
        {
            seen_trace_ids.insert(tid.to_string());
        }
    }
    let skip = skip.max(0).min(hits.len() as i64);
    hits.into_iter().skip(skip as usize).take(need).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_pagination_remembers_skipped_and_undelivered_ids() {
        let hits = vec![
            json::json!({"trace_id": "old", "trace_start_time": 1}),
            json::json!({"trace_id": "new", "trace_start_time": 3}),
            json::json!({"trace_id": "middle", "trace_start_time": 2}),
        ];
        let mut seen = HashSet::new();
        let page = select_timestamp_page(hits, &mut seen, 1, 1);
        assert_eq!(
            page,
            [json::json!({"trace_id": "middle", "trace_start_time": 2})]
        );
        assert_eq!(
            seen,
            HashSet::from(["old".to_string(), "new".to_string(), "middle".to_string()])
        );
        let later = select_timestamp_page(
            vec![json::json!({"trace_id": "later", "trace_start_time": 0})],
            &mut seen,
            -1,
            1,
        );
        assert_eq!(later.len(), 1);
        assert!(seen.contains("later"));
    }
}

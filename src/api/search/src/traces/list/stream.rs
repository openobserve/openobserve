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

use std::collections::{HashMap, HashSet};

use axum::response::Response;
use config::{
    QUERY_WITH_NO_LIMIT, get_config,
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
    plan::{PageSize, TraceListPlan},
    query::{TraceSearchContext, build_partition_query},
    response::TraceBatch,
};
use crate::search::error_utils::map_error_to_http_response;

#[cfg_attr(test, derive(Clone))]
struct CandidateMerge {
    // `None` keeps every trace, for a request with no row limit.
    cap: Option<usize>,
    // Largest candidate per trace id, kept for pruned ids too, so a smaller row cannot re-enter.
    candidates: HashMap<String, i64>,
    rows: HashMap<String, json::Value>,
}

impl CandidateMerge {
    fn new(cap: Option<usize>) -> Self {
        Self {
            cap,
            candidates: HashMap::new(),
            rows: HashMap::new(),
        }
    }

    fn push_hits(&mut self, hits: Vec<json::Value>) {
        for hit in hits {
            let Some(trace_id) = trace_id_of(&hit)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
            else {
                continue;
            };
            let candidate = candidate_of(&hit);
            // A map, not the TopKHeap: a later partition can report a larger candidate for an id.
            if self
                .candidates
                .get(&trace_id)
                .is_some_and(|best| *best >= candidate)
            {
                continue;
            }
            self.candidates.insert(trace_id.clone(), candidate);
            self.rows.insert(trace_id, hit);
        }
        self.prune();
    }

    // Dropping past the cap is safe: candidates never shrink, so the cap-th key never falls.
    fn prune(&mut self) {
        let Some(cap) = self.cap.filter(|cap| self.rows.len() > *cap) else {
            return;
        };
        let mut keys: Vec<(i64, String)> = self
            .rows
            .iter()
            .map(|(id, row)| (candidate_of(row), id.clone()))
            .collect();
        keys.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        for (_, id) in keys.drain(cap..) {
            self.rows.remove(&id);
        }
    }

    fn len(&self) -> usize {
        self.candidates.len()
    }

    fn into_page(self, skip: usize, page: PageSize) -> Vec<json::Value> {
        let mut rows: Vec<json::Value> = self.rows.into_values().collect();
        rows.sort_by(|a, b| {
            candidate_of(b)
                .cmp(&candidate_of(a))
                .then_with(|| trace_id_of(a).cmp(&trace_id_of(b)))
        });
        let rows = rows.into_iter().skip(skip);
        match page.remaining(0) {
            Some(size) => rows.take(size).collect(),
            None => rows.collect(),
        }
    }
}

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
    let skip = plan.options.skip();
    let page = plan.options.page_size();
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
    let ranks_by_candidate = plan.sort.ranks_by_candidate(plan.mode);
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
                format!(
                    "non-ts ({}), {}",
                    plan.sort.sql(plan.mode),
                    if ranks_by_candidate {
                        "candidate merge"
                    } else {
                        "TopKHeap"
                    }
                )
            } else {
                "DESC".to_string()
            }
        );
        partitions
    };

    let retain = page.retain(skip);
    let non_ts_col = "zo_sql_duration".to_string();
    let non_ts_is_desc = !plan.sort.ascending;
    let mut candidate_merge = ranks_by_candidate.then(|| CandidateMerge::new(retain));
    let mut topk_heap: Option<TopKHeap> = if is_non_ts_order_by && !ranks_by_candidate {
        Some(TopKHeap::new(
            retain.unwrap_or(usize::MAX),
            &[(non_ts_col, non_ts_is_desc)],
        ))
    } else {
        None
    };

    // Partition boundaries follow the querier count, so a global `from` can shift between pages.
    let mut hits_seen: usize = 0;
    let mut hits_delivered: usize = 0;
    let mut total_across_partitions: usize = 0;
    let mut range_error_sent = false;
    let mut seen_trace_ids: HashSet<String> = HashSet::new();
    let mut consecutive_empty_partitions: i64 = 0;

    for (idx, partition) in partitions_desc.iter().enumerate() {
        if sender.is_closed() {
            break;
        }
        let remaining_needed = page.remaining(hits_delivered);
        if remaining_needed == Some(0) {
            break;
        }

        let p_start = partition[0];
        let p_end = partition[1];

        let fetch_rows = if is_non_ts_order_by {
            retain
        } else {
            remaining_needed.map(|need| need.saturating_add(skip.saturating_sub(hits_seen)))
        };

        let mut req1 = base_req.clone();
        req1.query.start_time = p_start;
        req1.query.end_time = p_end;
        req1.query.from = 0;
        req1.query.size = query_size(fetch_rows);

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
        // An unlimited request must read every partition, so only a bounded page stops at a gap.
        if !is_non_ts_order_by && remaining_needed.is_some() {
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
        let partition_total = deduped_hits.len();
        total_across_partitions += partition_total;
        hits_seen += partition_total;

        if deduped_hits.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        if is_non_ts_order_by {
            if let Some(merge) = candidate_merge.as_mut() {
                // Every partition reports the same trace again; the merge keeps the largest.
                merge.push_hits(deduped_hits);
            } else {
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
            skip.saturating_sub(hits_seen_before),
            remaining_needed.unwrap_or(usize::MAX),
            plan.sort.ascending,
        );

        if deliverable_q1.is_empty() {
            let progress = ((idx + 1) * 100) / total_partitions;
            let _ = sender
                .send(Ok(StreamResponses::Progress { percent: progress }))
                .await;
            continue;
        }

        let Some(deliverable) = load_page(
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

        hits_delivered += deliverable.len();

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
        let (total, deliverable_q1) = match candidate_merge.take() {
            Some(merge) => (merge.len(), merge.into_page(skip, page)),
            None => (
                total_across_partitions,
                topk_heap
                    .take()
                    .map(|h| h.into_sorted_vec(skip))
                    .unwrap_or_default(),
            ),
        };

        if deliverable_q1.is_empty() {
            let _ = sender.send(Ok(StreamResponses::Done)).await;
            return;
        }

        let Some(deliverable) = load_page(
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

        let mut results = config::meta::search::Response::default();
        for h in deliverable {
            results.add_hit(h);
        }
        results.set_total(total);
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

// Chunks bound each `IN` list; together they still enrich every selected trace.
async fn load_page(
    ctx: &TraceSearchContext,
    plan: &TraceListPlan,
    hits: Vec<json::Value>,
    range: (i64, i64),
    base_request: &Request,
    sender: &mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) -> Option<Vec<json::Value>> {
    let chunk_size = usize::try_from(get_config().limit.query_default_limit)
        .unwrap_or(0)
        .max(1);
    let mut items = Vec::with_capacity(hits.len());
    let mut hits = hits.into_iter().peekable();
    while hits.peek().is_some() {
        if sender.is_closed() {
            return None;
        }
        let chunk: Vec<json::Value> = hits.by_ref().take(chunk_size).collect();
        let batch = load_batch(ctx, plan, chunk, range, base_request, sender).await?;
        items.extend(batch.traces.into_values());
    }
    plan.sort.sort(&mut items);
    Some(
        items
            .iter()
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Null))
            .collect(),
    )
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
    skip: usize,
    need: usize,
    ascending: bool,
) -> Vec<json::Value> {
    // The offset is taken in the requested direction, since ascending partitions run oldest first.
    hits.sort_by(|a, b| {
        let a_t = json::get_int_value(a.get("trace_start_time").unwrap_or_default());
        let b_t = json::get_int_value(b.get("trace_start_time").unwrap_or_default());
        if ascending {
            a_t.cmp(&b_t)
        } else {
            b_t.cmp(&a_t)
        }
    });
    // Skipped IDs must also be remembered because their spans can appear in later partitions.
    for item in &hits {
        if let Some(tid) = item.get("trace_id").and_then(json::Value::as_str)
            && !tid.is_empty()
        {
            seen_trace_ids.insert(tid.to_string());
        }
    }
    hits.into_iter().skip(skip).take(need).collect()
}

// The engine reads a non-positive size as ZO_QUERY_DEFAULT_LIMIT, so no limit has its own value.
fn query_size(rows: Option<usize>) -> i64 {
    rows.map_or(QUERY_WITH_NO_LIMIT, |rows| {
        i64::try_from(rows).unwrap_or(i64::MAX)
    })
}

fn trace_id_of(hit: &json::Value) -> Option<&str> {
    hit.get("trace_id").and_then(json::Value::as_str)
}

fn candidate_of(hit: &json::Value) -> i64 {
    json::get_int_value(hit.get("zo_sql_candidate").unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(trace_id: &str, candidate: i64) -> json::Value {
        json::json!({"trace_id": trace_id, "zo_sql_candidate": candidate})
    }

    fn ids(rows: &[json::Value]) -> Vec<&str> {
        rows.iter().filter_map(trace_id_of).collect()
    }

    // The Q1 order `zo_sql_candidate DESC, trace_id ASC` (or ties cut the other way) then LIMIT.
    fn sql_cut(mut hits: Vec<json::Value>, limit: usize, ids_ascending: bool) -> Vec<json::Value> {
        hits.sort_by(|a, b| {
            let by_id = trace_id_of(a).cmp(&trace_id_of(b));
            candidate_of(b).cmp(&candidate_of(a)).then_with(|| {
                if ids_ascending {
                    by_id
                } else {
                    by_id.reverse()
                }
            })
        });
        hits.truncate(limit);
        hits
    }

    fn page(
        partitions: &[Vec<json::Value>],
        from: usize,
        size: usize,
        ids_ascending: bool,
    ) -> Vec<String> {
        let heap_k = from + size;
        let mut merge = CandidateMerge::new(Some(heap_k));
        for hits in partitions {
            merge.push_hits(sql_cut(hits.clone(), heap_k, ids_ascending));
        }
        ids(&merge.into_page(from, PageSize::Bounded(size)))
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn candidate_merge_keeps_the_largest_row_per_trace_and_pages_by_candidate() {
        // Example 3 of the spec: four partitions newest first, page size 2, trace A crosses all.
        let partitions = [
            vec![row("B", 4), row("E", 3)],
            vec![row("A", 5), row("D", 4)],
            vec![row("A", 5), row("C", 2)],
            vec![row("A", 12)],
        ];
        let mut merge = CandidateMerge::new(Some(10));
        for hits in partitions {
            merge.push_hits(hits);
        }
        merge.push_hits(vec![row("A", 1), row("", 99)]);
        assert_eq!(merge.len(), 5);
        assert_eq!(merge.rows["A"], row("A", 12));
        assert_eq!(
            ids(&merge.clone().into_page(0, PageSize::Bounded(2))),
            ["A", "B"]
        );
        assert_eq!(
            ids(&merge.clone().into_page(2, PageSize::Bounded(2))),
            ["D", "E"]
        );
        assert_eq!(
            ids(&merge.into_page(0, PageSize::Bounded(10))),
            ["A", "B", "D", "E", "C"]
        );
    }

    #[test]
    fn candidate_merge_ranks_the_issue_example_by_its_root_span() {
        // Issue 15507: A = 9 s root span in the older partition plus a 1 s span in the newer one.
        let mut merge = CandidateMerge::new(Some(1));
        merge.push_hits(vec![row("B", 2_000_000), row("A", 1_000_000)]);
        merge.push_hits(vec![row("A", 9_000_000)]);
        assert_eq!(merge.len(), 2);
        assert_eq!(ids(&merge.into_page(0, PageSize::Bounded(1))), ["A"]);
    }

    #[test]
    fn candidate_merge_keeps_at_most_cap_rows_and_readmits_a_pruned_id_that_grows() {
        // from=1&size=1 keeps two rows: C is pruned, ignored while smaller, back once larger.
        let mut merge = CandidateMerge::new(Some(2));
        merge.push_hits(vec![row("A", 5), row("B", 4), row("C", 3)]);
        assert_eq!(merge.rows.len(), 2);
        assert!(!merge.rows.contains_key("C"));
        merge.push_hits(vec![row("C", 2)]);
        assert!(!merge.rows.contains_key("C"));
        merge.push_hits(vec![row("C", 10), row("B", 4)]);
        assert_eq!(merge.rows.len(), 2);
        assert_eq!(merge.len(), 3);
        assert_eq!(
            ids(&merge.clone().into_page(0, PageSize::Bounded(2))),
            ["C", "A"]
        );
        assert_eq!(ids(&merge.into_page(1, PageSize::Bounded(1))), ["A"]);
    }

    #[test]
    fn an_unlimited_merge_keeps_every_trace_once_and_skips_only_the_offset() {
        // Two partitions each report 15 traces A..O, the older one with larger candidates.
        let names: Vec<String> = ('A'..='O').map(String::from).collect();
        let mut merge = CandidateMerge::new(None);
        for bump in [0, 100] {
            merge.push_hits(
                names
                    .iter()
                    .enumerate()
                    .map(|(i, id)| row(id, bump + 50 - i as i64))
                    .collect(),
            );
        }
        assert_eq!((merge.len(), merge.rows.len()), (15, 15));
        assert_eq!(merge.rows["A"], row("A", 150));
        assert_eq!(ids(&merge.clone().into_page(0, PageSize::Unlimited)), names);
        assert_eq!(
            ids(&merge.clone().into_page(2, PageSize::Unlimited)),
            names[2..]
        );
        assert!(merge.into_page(15, PageSize::Unlimited).is_empty());
    }

    #[test]
    fn unlimited_fetches_ask_the_engine_for_no_limit_and_bounded_ones_for_their_rows() {
        assert_eq!(query_size(None), QUERY_WITH_NO_LIMIT);
        assert_eq!(query_size(Some(12)), 12);
        assert_eq!(query_size(Some(usize::MAX)), i64::MAX);
    }

    #[test]
    fn the_trace_id_tiebreaker_keeps_tied_candidates_stable_across_pages() {
        // Six traces tie at the cutoff; every page fetches `LIMIT from + size` per partition.
        let partitions = vec![
            vec![row("D", 5), row("C", 5), row("B", 5), row("A", 5)],
            vec![row("F", 5), row("E", 5), row("G", 3)],
        ];
        assert_eq!(page(&partitions, 0, 2, true), ["A", "B"]);
        assert_eq!(page(&partitions, 2, 2, true), ["C", "D"]);
        assert_eq!(page(&partitions, 4, 2, true), ["E", "F"]);
        assert_eq!(page(&partitions, 6, 2, true), ["G"]);
        // Without the tiebreaker a partition can cut the ties the other way: page 2 repeats page 1.
        assert_eq!(page(&partitions, 0, 2, false), ["C", "D"]);
        assert_eq!(page(&partitions, 2, 2, false), ["C", "D"]);
    }

    #[test]
    fn timestamp_pagination_remembers_skipped_and_undelivered_ids() {
        let hits = vec![
            json::json!({"trace_id": "old", "trace_start_time": 1}),
            json::json!({"trace_id": "new", "trace_start_time": 3}),
            json::json!({"trace_id": "middle", "trace_start_time": 2}),
        ];
        let mut seen = HashSet::new();
        let page = select_timestamp_page(hits.clone(), &mut seen, 1, 1, false);
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
            0,
            1,
            false,
        );
        assert_eq!(later.len(), 1);
        assert!(seen.contains("later"));
        let oldest_first = select_timestamp_page(hits, &mut HashSet::new(), 1, usize::MAX, true);
        assert_eq!(
            ids(&oldest_first),
            ["middle", "new"],
            "an ascending offset skips the oldest trace"
        );
    }
}

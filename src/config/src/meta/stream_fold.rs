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

//! Fold a search's streamed events back into one `Response`, for callers that
//! need the one-shot shape: the agent partition mode in-process, and the MCP
//! tools that read the SSE body of `_search_stream` or `traces/latest_stream`.

use serde::{Deserialize, Serialize};

use crate::{meta::search::Response, utils::json};

const STREAM_CANCELLED_MSG: &str =
    "the search was cancelled before it finished; results are partial";
const STREAM_UNFINISHED_MSG: &str =
    "the search stream ended before it finished; results are partial";

/// The `error` event of a search stream, or a stream that could not be read.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StreamError {
    pub code: u16,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    /// The application error code; `code` is the HTTP status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<u16>,
}

#[derive(Deserialize)]
struct MetadataEvent {
    results: Response,
    #[serde(default)]
    streaming_aggs: bool,
}

#[derive(Deserialize)]
struct HitsEvent {
    hits: Vec<json::Value>,
}

/// Fold one per-partition response into the accumulator.
///
/// Streaming-aggs events carry the progressively merged aggregation state, so
/// each event replaces the previous one. Plain events are one partition's page
/// each: hits append (partitions arrive already in scan order, each page
/// sorted), scan counters add up, and flags/meta widen.
pub fn fold_page(merged: &mut Option<Response>, mut results: Response, streaming_aggs: bool) {
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
        for e in std::mem::take(&mut acc.function_error).into_iter().rev() {
            if !results.function_error.contains(&e) {
                results.function_error.insert(0, e);
            }
        }
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

/// Mark `res` partial with `reason`, once.
pub fn mark_partial(res: &mut Response, reason: &str) {
    res.is_partial = true;
    if !res.function_error.iter().any(|e| e == reason) {
        res.function_error.push(reason.to_string());
    }
}

/// Fold the SSE body of a search stream into one `Response`, or its `error` event.
///
/// A metadata event opens a partition's page and the hits events after it fill
/// that page. A cancelled stream, or one cut before `[[DONE]]`, is partial.
pub fn collect_sse(body: &str) -> Result<Response, StreamError> {
    let mut merged: Option<Response> = None;
    let mut page: Option<(Response, bool)> = None;
    let mut end = None;
    for (event, data) in sse_events(body) {
        match (event, data.as_str()) {
            (_, "[[DONE]]") => end = Some(None),
            (_, "[[CANCELLED]]") => end = Some(Some(STREAM_CANCELLED_MSG)),
            (Some("search_response_metadata"), data) => {
                let meta: MetadataEvent = parse_event(data)?;
                if let Some((results, aggs)) = page.take() {
                    fold_page(&mut merged, results, aggs);
                }
                page = Some((meta.results, meta.streaming_aggs));
            }
            (Some("search_response_hits"), data) => {
                let hits: HitsEvent = parse_event(data)?;
                page.get_or_insert_with(Default::default)
                    .0
                    .hits
                    .extend(hits.hits);
            }
            (Some("error"), data) => return Err(parse_event(data)?),
            _ => {}
        }
        if end.is_some() {
            break;
        }
    }
    if let Some((results, aggs)) = page.take() {
        fold_page(&mut merged, results, aggs);
    }
    let mut res = merged.unwrap_or_default();
    match end {
        Some(None) => {}
        Some(Some(reason)) => mark_partial(&mut res, reason),
        None => mark_partial(&mut res, STREAM_UNFINISHED_MSG),
    }
    Ok(res)
}

fn parse_event<T: serde::de::DeserializeOwned>(data: &str) -> Result<T, StreamError> {
    json::from_str(data).map_err(|e| StreamError {
        code: 500,
        message: format!("unreadable search stream event: {e}"),
        ..Default::default()
    })
}

/// `(event name, data)` per SSE event; multi-line data joins with `\n` as the spec says.
fn sse_events(body: &str) -> Vec<(Option<&str>, String)> {
    let mut events = Vec::new();
    let mut name = None;
    let mut data: Vec<&str> = Vec::new();
    for line in body.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if name.is_some() || !data.is_empty() {
                events.push((name.take(), data.join("\n")));
                data.clear();
            }
        } else if let Some(v) = line.strip_prefix("event:") {
            name = Some(v.trim());
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        meta::search::{StreamResponses, TimeOffset},
        utils::json::json,
    };

    fn page(hits: Vec<json::Value>, scan_size: usize) -> Response {
        Response {
            hits,
            scan_size,
            took: 10,
            ..Default::default()
        }
    }

    fn sse(events: &[StreamResponses]) -> String {
        events
            .iter()
            .flat_map(|e| e.to_chunks())
            .map(|chunk| String::from_utf8(chunk.unwrap().to_vec()).unwrap())
            .collect()
    }

    fn partition(hits: Vec<json::Value>, aggs: bool) -> StreamResponses {
        StreamResponses::SearchResponse {
            results: Response {
                trace_id: "t1".to_string(),
                ..page(hits, 100)
            },
            streaming_aggs: aggs,
            streaming_id: None,
            time_offset: TimeOffset {
                start_time: 0,
                end_time: 1,
            },
        }
    }

    #[test]
    fn fold_page_merges_partitions_like_the_one_shot_response() {
        let mut merged = None;
        fold_page(&mut merged, page(vec![json!({"a": 1})], 100), false);
        let mut second = page(vec![json!({"a": 2}), json!({"a": 3})], 50);
        second.function_error = vec!["range clamped".to_string()];
        second.is_partial = true;
        fold_page(&mut merged, second.clone(), false);
        fold_page(&mut merged, second, false);
        let res = merged.unwrap();
        assert_eq!(
            (res.hits.len(), res.total, res.scan_size, res.took),
            (5, 5, 200, 30)
        );
        assert!(res.is_partial);
        assert_eq!(res.function_error, vec!["range clamped"]);

        let mut merged = None;
        let mut partial = page(vec![json!({"cnt": 10})], 100);
        partial.function_error = vec!["partition failed".to_string()];
        partial.is_partial = true;
        fold_page(&mut merged, partial, true);
        fold_page(&mut merged, page(vec![json!({"cnt": 25})], 60), true);
        let res = merged.unwrap();
        assert_eq!(res.hits, vec![json!({"cnt": 25})]);
        assert_eq!((res.scan_size, res.took), (160, 20));
        assert!(res.is_partial);
        assert_eq!(res.function_error, vec!["partition failed"]);
    }

    #[test]
    fn collect_sse_reassembles_what_the_stream_wrote() {
        let rows = |r: std::ops::Range<i64>| r.map(|i| json!({"i": i})).collect::<Vec<_>>();
        let error = StreamResponses::Error {
            code: 400,
            message: "unknown field 'x'".to_string(),
            error_detail: None,
            hint: None,
            suggestions: Some(vec!["xx".to_string()]),
            trace_id: Some("t1".to_string()),
            error_code: Some(20004),
        };
        let hits_only = StreamResponses::SearchResponseHits { hits: rows(9..10) };
        // (case, events on the wire, hits read back, is_partial, error code)
        type Case = (
            &'static str,
            Vec<StreamResponses>,
            Vec<json::Value>,
            bool,
            Option<u16>,
        );
        let cases: Vec<Case> = vec![
            ("empty", vec![StreamResponses::Done], vec![], false, None),
            (
                "pages append in order",
                vec![
                    StreamResponses::Progress { percent: 10 },
                    partition(rows(0..2), false),
                    partition(rows(2..5), false),
                    StreamResponses::Done,
                ],
                rows(0..5),
                false,
                None,
            ),
            (
                "hits split across chunks join their page",
                vec![
                    partition(rows(0..1), false),
                    hits_only,
                    StreamResponses::Done,
                ],
                vec![json!({"i": 0}), json!({"i": 9})],
                false,
                None,
            ),
            (
                "streaming aggs replace",
                vec![
                    partition(vec![json!({"n": 1})], true),
                    partition(vec![json!({"n": 3})], true),
                    StreamResponses::Done,
                ],
                vec![json!({"n": 3})],
                false,
                None,
            ),
            (
                "cancelled",
                vec![partition(rows(0..2), false), StreamResponses::Cancelled],
                rows(0..2),
                true,
                None,
            ),
            (
                "cut before done",
                vec![partition(rows(0..2), false)],
                rows(0..2),
                true,
                None,
            ),
            (
                "error mid-stream",
                vec![partition(rows(0..2), false), error, StreamResponses::Done],
                vec![],
                false,
                Some(400),
            ),
        ];
        for (case, events, hits, partial, code) in cases {
            match collect_sse(&sse(&events)) {
                Ok(res) => {
                    assert_eq!(code, None, "{case}");
                    assert_eq!(res.hits, hits, "{case}");
                    assert_eq!(res.total, hits.len(), "{case}");
                    assert_eq!(res.is_partial, partial, "{case}");
                    assert_eq!(!res.function_error.is_empty(), partial, "{case}");
                    if !hits.is_empty() {
                        assert_eq!(res.trace_id, "t1", "{case}");
                    }
                }
                Err(e) => {
                    assert_eq!(Some(e.code), code, "{case}");
                    assert_eq!(e.suggestions, Some(vec!["xx".to_string()]), "{case}");
                    assert_eq!(e.trace_id.as_deref(), Some("t1"), "{case}");
                    assert_eq!(e.error_code, Some(20004), "{case}");
                }
            }
        }
    }
}

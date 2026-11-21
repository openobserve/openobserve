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
    self_reporting::protected_streams::with_current_reader,
    sql::OrderBy,
    stream::StreamType,
    stream_fold::fold_page,
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
    let sql = crate::sql::Sql::new(
        &req.query.clone().try_into()?,
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

    tokio::spawn(with_current_reader(process_search_stream_request(
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
    )));

    let mut merged: Option<Response> = None;
    while let Some(event) = rx.recv().await {
        match event {
            Ok(StreamResponses::SearchResponse {
                results,
                streaming_aggs,
                ..
            }) => {
                fold_page(&mut merged, results, streaming_aggs);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// No querier runs here, so a read that passes every reader check ends at the node dispatch.
    #[tokio::test]
    async fn only_the_calibration_reader_reads_the_digest_through_the_spawned_searches() {
        use arrow_schema::{DataType, Field, Schema};
        use config::{
            TIMESTAMP_COL_NAME,
            meta::{
                alerts::alert_calibration::DIGEST_STREAM,
                search::Query,
                self_reporting::protected_streams::{ProtectedReader, as_reader},
            },
        };
        use infra::{
            errors::{Error, ErrorCodes},
            schema::{STREAM_SCHEMAS_LATEST, SchemaCache},
        };

        infra::db::create_table().await.unwrap();
        infra::file_list::create_table().await.unwrap();
        let org = "collect_protected_reader";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org}/logs/{DIGEST_STREAM}"),
            SchemaCache::new(Schema::new(vec![Field::new(
                TIMESTAMP_COL_NAME,
                DataType::Int64,
                false,
            )])),
        );
        let req = Request {
            query: Query {
                sql: format!("SELECT * FROM \"{DIGEST_STREAM}\""),
                start_time: 1,
                end_time: 2,
                size: 10,
                ..Default::default()
            },
            use_cache: false,
            ..Default::default()
        };
        let via_collect = || {
            let mut req = req.clone();
            async move {
                search_partition_mode(
                    "collect-protected-reader",
                    org,
                    "",
                    &mut req,
                    StreamType::Logs,
                    vec![DIGEST_STREAM.to_string()],
                    None,
                    String::new(),
                    tracing::Span::none(),
                    false,
                )
                .await
            }
        };
        let via_cache = || {
            let req = req.clone();
            async move {
                crate::cache::search(
                    "collect-protected-reader-delta",
                    org,
                    StreamType::Logs,
                    None,
                    &req,
                    String::new(),
                    true,
                    None,
                    false,
                )
                .await
            }
        };
        let reader = ProtectedReader::AlertCalibration;
        for (path, scoped, unscoped) in [
            (
                "collect",
                as_reader(reader, via_collect()).await,
                via_collect().await,
            ),
            (
                "cache delta",
                as_reader(reader, via_cache()).await,
                via_cache().await,
            ),
        ] {
            assert!(
                matches!(scoped, Err(Error::Message(ref m)) if m == "no querier node online"),
                "{path}: {scoped:?}"
            );
            assert!(
                matches!(unscoped, Err(Error::ErrorCode(ErrorCodes::SearchStreamProtected(ref s))) if s == DIGEST_STREAM),
                "{path}: {unscoped:?}"
            );
        }
    }
}

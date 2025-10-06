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

//! Streaming search functionality
//!
//! This module contains all the components for handling streaming search requests,
//! including caching, execution, sorting, and utility functions.

use std::time::Instant;

use config::{
    meta::{
        dashboards::usage_report::DashboardInfo,
        search::{SearchEventType, StreamResponses, ValuesEventContext},
        sql::OrderBy,
        stream::StreamType,
    },
    utils::time::hour_micros,
};
use log;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::{
    auditor::{AuditMessage, Protocol, ResponseMeta},
    config::get_config as get_o2_config,
};
use tokio::sync::mpsc;
use tracing::Instrument;

use crate::{
    common::{
        meta::search::{AuditContext, SearchResultType},
        utils::stream::get_max_query_range,
    },
    service::search::cache as search_cache,
};
#[cfg(feature = "enterprise")]
use crate::{
    handler::http::request::search::error_utils::map_error_to_http_response,
    service::self_reporting::audit,
};

pub mod cache;
pub mod execution;
pub mod sorting;
pub mod utils;

// Re-export commonly used functions for easier access
#[cfg(feature = "enterprise")]
pub use cache::write_partial_results_to_cache;
pub use cache::{handle_cache_responses_and_deltas, write_results_to_cache};
pub use execution::do_partitioned_search;
pub use sorting::order_search_results;

/// Main function to process search stream requests
#[allow(clippy::too_many_arguments)]
pub async fn process_search_stream_request(
    org_id: String,
    user_id: String,
    trace_id: String,
    mut req: config::meta::search::Request,
    stream_type: StreamType,
    stream_names: Vec<String>,
    req_order_by: OrderBy,
    search_span: tracing::Span,
    sender: mpsc::Sender<Result<config::meta::search::StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    fallback_order_by_col: Option<String>,
    _audit_ctx: Option<AuditContext>,
    is_multi_stream_search: bool,
) {
    log::debug!(
        "[HTTP2_STREAM trace_id {trace_id}] Received HTTP/2 stream request for org_id: {org_id}",
    );

    #[cfg(feature = "enterprise")]
    let audit_enabled = get_o2_config().common.audit_enabled && _audit_ctx.is_some();

    // Send a progress: 0 event as an indicator of search initiation
    if sender
        .send(Ok(StreamResponses::Progress { percent: 0 }))
        .await
        .is_err()
    {
        log::warn!(
            "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending progress event to client",
        );
    }

    if let Ok(sql) = config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql) {
        req.query.sql = sql;
    };

    let started_at = chrono::Utc::now().timestamp_micros();
    let mut start = Instant::now();
    let mut accumulated_results: Vec<SearchResultType> = Vec::new();
    let use_cache = req.use_cache;
    let start_time = req.query.start_time;
    let end_time = req.query.end_time;
    let all_streams = stream_names.join(",");

    // HACK to avoid writing to results of vrl to cache for values search
    let mut query_fn =
        req.query
            .query_fn
            .as_ref()
            .map(|v| match config::utils::base64::decode_url(v) {
                Ok(v) => v,
                Err(_) => v.to_string(),
            });
    let backup_query_fn = query_fn.clone();
    let is_result_array_skip_vrl = query_fn
        .as_ref()
        .map(|v| search_cache::is_result_array_skip_vrl(v))
        .unwrap_or(false);
    if is_result_array_skip_vrl {
        query_fn = None;
    }

    req.query.query_fn = query_fn.clone();

    let max_query_range = get_max_query_range(&stream_names, &org_id, &user_id, stream_type).await; // hours

    // HACK: always search from the first partition, this is because to support pagination in http2
    // streaming we need context of no of hits per partition, which currently is not available.
    // Hence we start from the first partition everytime and skip the hits. The following is a
    // global variable to keep track of how many hits to skip across all partitions.
    // This is a temporary hack and will be removed once we have the context of no of hits per
    // partition.
    let mut hits_to_skip = req.query.from;

    if req.query.from == 0 && !req.query.track_total_hits && req.query.streaming_id.is_none() {
        // check cache for the first page
        let (c_resp, _should_exec_query) = match search_cache::prepare_cache_response(
            &trace_id,
            &org_id,
            stream_type,
            &mut req,
            use_cache,
        )
        .instrument(search_span.clone())
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("[HTTP2_STREAM trace_id {trace_id}] Failed to check cache: {e}");

                // send audit response first
                #[cfg(feature = "enterprise")]
                {
                    let resp = map_error_to_http_response(&e, None).status().into();
                    if audit_enabled {
                        // Using spawn to handle the async call
                        audit(AuditMessage {
                            user_email: user_id,
                            org_id,
                            _timestamp: chrono::Utc::now().timestamp(),
                            protocol: Protocol::Http,
                            response_meta: ResponseMeta {
                                http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                                http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                                http_query_params: _audit_ctx
                                    .as_ref()
                                    .unwrap()
                                    .query_params
                                    .to_string(),
                                http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                                http_response_code: resp,
                                error_msg: Some(e.to_string()),
                                trace_id: Some(trace_id.to_string()),
                            },
                        })
                        .await;
                    }
                }

                // send error message to client
                if sender.send(Err(e)).await.is_err() {
                    log::warn!(
                        "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending message to client",
                    );
                }
                return;
            }
        };

        let local_c_resp = c_resp.clone();
        let cached_resp = local_c_resp.cached_response;
        let mut deltas = local_c_resp.deltas;
        deltas.sort();
        deltas.dedup();

        let cached_hits = cached_resp
            .iter()
            .fold(0, |acc, c| acc + c.cached_response.hits.len());

        let c_start_time = cached_resp
            .first()
            .map(|c| c.response_start_time)
            .unwrap_or_default();

        let c_end_time = cached_resp
            .last()
            .map(|c| c.response_end_time)
            .unwrap_or_default();

        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] found cached files: {}, records: {cached_hits}, cache_time: {c_start_time} - {c_end_time}",
            cached_resp.len(),
        );

        // handle cache responses and deltas
        if !cached_resp.is_empty() && cached_hits > 0 {
            // `max_query_range` is used initialize `remaining_query_range`
            // set max_query_range to `end_time - start_time` as hour if it is 0, to ensure
            // unlimited query range for cache only search
            let remaining_query_range = if max_query_range == 0 {
                std::cmp::max(
                    1,
                    (req.query.end_time - req.query.start_time) / hour_micros(1),
                )
            } else {
                max_query_range
            }; // hours

            let size = req.query.size;
            // Step 1(a): handle cache responses & query the deltas
            if let Err(e) = handle_cache_responses_and_deltas(
                &mut req,
                size,
                &trace_id,
                &org_id,
                stream_type,
                cached_resp,
                deltas,
                &mut accumulated_results,
                &user_id,
                max_query_range,
                remaining_query_range,
                &req_order_by,
                fallback_order_by_col,
                &mut start,
                sender.clone(),
                values_ctx,
                &all_streams,
                started_at,
                is_result_array_skip_vrl,
                backup_query_fn,
                is_multi_stream_search,
            )
            .instrument(search_span.clone())
            .await
            {
                // send audit response first
                #[cfg(feature = "enterprise")]
                {
                    let resp = map_error_to_http_response(&e, None).status().into();
                    if audit_enabled {
                        // Using spawn to handle the async call
                        audit(AuditMessage {
                            user_email: user_id,
                            org_id,
                            _timestamp: chrono::Utc::now().timestamp(),
                            protocol: Protocol::Http,
                            response_meta: ResponseMeta {
                                http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                                http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                                http_query_params: _audit_ctx
                                    .as_ref()
                                    .unwrap()
                                    .query_params
                                    .to_string(),
                                http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                                http_response_code: resp,
                                error_msg: Some(e.to_string()),
                                trace_id: Some(trace_id.to_string()),
                            },
                        })
                        .await;
                    }
                }

                // write the partial results to cache if search is cancelled
                #[cfg(feature = "enterprise")]
                write_partial_results_to_cache(
                    &e,
                    &trace_id,
                    c_resp,
                    start_time,
                    end_time,
                    &mut accumulated_results,
                )
                .await;

                if sender.send(Err(e)).await.is_err() {
                    log::warn!(
                        "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending message to client",
                    );
                }
                return;
            }
        } else {
            // Step 2: Search without cache
            // no caches found process req directly
            log::debug!(
                "[HTTP2_STREAM trace_id {trace_id}] No cache found, processing search request",
            );

            let size = req.query.size;
            if let Err(e) = do_partitioned_search(
                &mut req,
                &trace_id,
                &org_id,
                stream_type,
                size,
                &user_id,
                &mut accumulated_results,
                max_query_range,
                &mut start,
                &req_order_by,
                sender.clone(),
                values_ctx,
                fallback_order_by_col,
                &mut hits_to_skip,
                is_result_array_skip_vrl,
                backup_query_fn,
                &all_streams,
                is_multi_stream_search,
            )
            .instrument(search_span.clone())
            .await
            {
                // send audit response first
                #[cfg(feature = "enterprise")]
                {
                    let resp = map_error_to_http_response(&e, None).status().into();
                    if audit_enabled {
                        // Using spawn to handle the async call
                        audit(AuditMessage {
                            user_email: user_id,
                            org_id,
                            _timestamp: chrono::Utc::now().timestamp(),
                            protocol: Protocol::Http,
                            response_meta: ResponseMeta {
                                http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                                http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                                http_query_params: _audit_ctx
                                    .as_ref()
                                    .unwrap()
                                    .query_params
                                    .to_string(),
                                http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                                http_response_code: resp,
                                error_msg: Some(e.to_string()),
                                trace_id: Some(trace_id.to_string()),
                            },
                        })
                        .await;
                    }
                }

                // write the partial results to cache if search is cancelled
                #[cfg(feature = "enterprise")]
                write_partial_results_to_cache(
                    &e,
                    &trace_id,
                    c_resp,
                    start_time,
                    end_time,
                    &mut accumulated_results,
                )
                .await;

                if sender.send(Err(e)).await.is_err() {
                    log::warn!(
                        "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending message to client",
                    );
                }
                return;
            }
        }
        // Step 3: Write to results cache
        // cache only if from is 0 and is not an aggregate_query
        if req.query.from == 0
            && let Err(e) = write_results_to_cache(
                c_resp,
                start_time,
                end_time,
                &mut accumulated_results,
            )
            .instrument(search_span.clone())
            .await
            .map_err(|e| {
                log::error!(
                    "[HTTP2_STREAM trace_id {trace_id}] Error writing results to cache: {e}",
                );
                e
            })
        {
            // send audit response first
            #[cfg(feature = "enterprise")]
            {
                let resp = map_error_to_http_response(&e, None).status().into();
                if audit_enabled {
                    // Using spawn to handle the async call
                    audit(AuditMessage {
                        user_email: user_id,
                        org_id,
                        _timestamp: chrono::Utc::now().timestamp(),
                        protocol: Protocol::Http,
                        response_meta: ResponseMeta {
                            http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                            http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                            http_query_params: _audit_ctx
                                .as_ref()
                                .unwrap()
                                .query_params
                                .to_string(),
                            http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                            http_response_code: resp,
                            error_msg: Some(e.to_string()),
                            trace_id: Some(trace_id.to_string()),
                        },
                    })
                    .await;
                }
            }

            if sender.send(Err(e)).await.is_err() {
                log::warn!(
                    "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending message to client",
                );
            }
            return;
        }
    } else {
        // Step 4: Search without cache for req with from > 0
        let size = req.query.size;
        if let Err(e) = do_partitioned_search(
            &mut req,
            &trace_id,
            &org_id,
            stream_type,
            size,
            &user_id,
            &mut accumulated_results,
            max_query_range,
            &mut start,
            &req_order_by,
            sender.clone(),
            values_ctx,
            fallback_order_by_col,
            &mut hits_to_skip,
            is_result_array_skip_vrl,
            backup_query_fn,
            &all_streams,
            is_multi_stream_search,
        )
        .instrument(search_span.clone())
        .await
        {
            // send audit response first
            #[cfg(feature = "enterprise")]
            {
                let resp = map_error_to_http_response(&e, None).status().into();
                if audit_enabled {
                    // Using spawn to handle the async call
                    audit(AuditMessage {
                        user_email: user_id,
                        org_id,
                        _timestamp: chrono::Utc::now().timestamp(),
                        protocol: Protocol::Http,
                        response_meta: ResponseMeta {
                            http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                            http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                            http_query_params: _audit_ctx
                                .as_ref()
                                .unwrap()
                                .query_params
                                .to_string(),
                            http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                            http_response_code: resp,
                            error_msg: Some(e.to_string()),
                            trace_id: Some(trace_id.to_string()),
                        },
                    })
                    .await;
                }
            }

            if sender.send(Err(e)).await.is_err() {
                log::warn!(
                    "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending message to client",
                );
            }
            return;
        }
    }

    // Once all searches are complete, write the accumulated results to a file
    log::info!(
        "[HTTP2_STREAM trace_id {trace_id}] stream done, took {:?} ms",
        start.elapsed().as_millis()
    );

    #[cfg(feature = "enterprise")]
    {
        if audit_enabled {
            // Using spawn to handle the async call
            audit(AuditMessage {
                user_email: user_id,
                org_id,
                _timestamp: chrono::Utc::now().timestamp(),
                protocol: Protocol::Http,
                response_meta: ResponseMeta {
                    http_method: _audit_ctx.as_ref().unwrap().method.to_string(),
                    http_path: _audit_ctx.as_ref().unwrap().path.to_string(),
                    http_query_params: _audit_ctx.as_ref().unwrap().query_params.to_string(),
                    http_body: _audit_ctx.as_ref().unwrap().body.to_string(),
                    http_response_code: 200,
                    error_msg: None,
                    trace_id: Some(trace_id.to_string()),
                },
            })
            .await;
        }
    }

    // Send a completion signal
    if sender.send(Ok(StreamResponses::Done)).await.is_err() {
        log::warn!(
            "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending completion message to client",
        );
    }
}

/// Multi-stream search processing function that handles multiple independent queries
/// and streams results as they become available from each query
#[allow(clippy::too_many_arguments)]
pub async fn process_search_stream_request_multi(
    org_id: String,
    user_id: String,
    trace_id: String,
    queries: Vec<config::meta::search::Request>,
    stream_type: StreamType,
    search_span: tracing::Span,
    sender: mpsc::Sender<Result<config::meta::search::StreamResponses, infra::errors::Error>>,
    _fallback_order_by_col: Option<String>,
    _audit_ctx: Option<AuditContext>,
    _dashboard_info: Option<DashboardInfo>,
    search_type: Option<SearchEventType>,
    search_event_context: Option<config::meta::search::SearchEventContext>,
) {
    log::debug!(
        "[HTTP2_STREAM_MULTI trace_id {trace_id}] Processing multi-stream request with {} queries for org_id: {org_id}",
        queries.len()
    );

    // Send initial progress event
    if sender
        .send(Ok(StreamResponses::Progress { percent: 0 }))
        .await
        .is_err()
    {
        log::warn!(
            "[HTTP2_STREAM_MULTI trace_id {trace_id}] Sender is closed, stop sending progress event to client",
        );
        return;
    }

    let total_queries = queries.len() as f32;
    let mut completed_queries = 0;
    let _started_at = chrono::Utc::now().timestamp_micros();

    // Process each query independently
    let mut query_tasks = Vec::new();

    for (query_index, mut req) in queries.into_iter().enumerate() {
        let query_trace_id = format!("{trace_id}-q{query_index}");
        let org_id_clone = org_id.clone();
        let user_id_clone = user_id.clone();
        let sender_clone = sender.clone();
        let search_span_clone = search_span.clone();

        // Clone search context for each query
        let query_search_type = search_type;
        let query_search_event_context = search_event_context.clone();

        let task = tokio::spawn(async move {
            log::debug!(
                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Starting query {query_index}: {}",
                req.query.sql
            );

            // Get stream names for this specific query
            // Note: Permissions are now checked at the handler level using the streams field
            let stream_names = match config::meta::sql::resolve_stream_names(&req.query.sql) {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Failed to resolve stream names: {e}"
                    );
                    let _ = sender_clone.send(Err(e.into())).await;
                    return;
                }
            };

            // Set query metadata
            req.search_type = query_search_type;
            req.search_event_context = query_search_event_context;

            // Create a nested sender for this specific query results
            let (query_sender, mut query_receiver) =
                mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);

            // Launch the individual search stream request
            let search_task = process_search_stream_request(
                org_id_clone.clone(),
                user_id_clone.clone(),
                query_trace_id.clone(),
                req,
                stream_type,
                stream_names,
                OrderBy::default(),
                search_span_clone.clone(),
                query_sender,
                None,  // no values context for multi-stream
                None,  // no fallback order by col
                None,  // no audit context for individual queries
                false, // not multi stream search at individual level
            );

            tokio::spawn(search_task);

            // Forward results from this query to the main sender, prefixed with query info
            while let Some(result) = query_receiver.recv().await {
                match result {
                    Ok(response) => {
                        // Add query index to the response
                        let prefixed_response = match response {
                            StreamResponses::SearchResponse {
                                mut results,
                                streaming_aggs,
                                streaming_id,
                                time_offset,
                            } => {
                                // Add query index to metadata
                                results.query_index = Some(query_index);
                                StreamResponses::SearchResponse {
                                    results,
                                    streaming_aggs,
                                    streaming_id,
                                    time_offset,
                                }
                            }
                            StreamResponses::Progress { percent } => {
                                // Scale progress per query
                                let global_percent =
                                    ((query_index as f32 + (percent as f32 / 100.0))
                                        / total_queries
                                        * 100.0) as usize;
                                StreamResponses::Progress {
                                    percent: global_percent,
                                }
                            }
                            other => other, // Forward other responses as-is
                        };

                        if sender_clone.send(Ok(prefixed_response)).await.is_err() {
                            log::warn!(
                                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Main sender is closed"
                            );
                            break;
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Query error: {e}"
                        );
                        // Send error but continue with other queries
                        let _ = sender_clone.send(Err(e)).await;
                        break;
                    }
                }
            }

            log::debug!(
                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Query {query_index} completed"
            );
        });

        query_tasks.push(task);
    }

    // Wait for all queries to complete
    for task in query_tasks {
        if let Err(e) = task.await {
            log::error!("[HTTP2_STREAM_MULTI trace_id {trace_id}] Task join error: {e}");
        }

        completed_queries += 1;
        let progress = (completed_queries as f32 / total_queries * 100.0) as usize;

        // Send progress update
        if sender
            .send(Ok(StreamResponses::Progress { percent: progress }))
            .await
            .is_err()
        {
            log::warn!(
                "[HTTP2_STREAM_MULTI trace_id {trace_id}] Sender is closed during progress update"
            );
            return;
        }
    }

    log::info!(
        "[HTTP2_STREAM_MULTI trace_id {trace_id}] All {} queries completed",
        total_queries
    );

    #[cfg(feature = "enterprise")]
    if let Some(audit_ctx) = _audit_ctx
        && get_o2_config().common.audit_enabled
    {
        audit(AuditMessage {
            user_email: user_id,
            org_id,
            _timestamp: chrono::Utc::now().timestamp(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method: audit_ctx.method.to_string(),
                http_path: audit_ctx.path.to_string(),
                http_query_params: audit_ctx.query_params.to_string(),
                http_body: audit_ctx.body.to_string(),
                http_response_code: 200,
                error_msg: None,
                trace_id: Some(trace_id.to_string()),
            },
        })
        .await;
    }

    // Send completion signal
    if sender.send(Ok(StreamResponses::Done)).await.is_err() {
        log::warn!(
            "[HTTP2_STREAM_MULTI trace_id {trace_id}] Sender is closed, stop sending completion message to client"
        );
    }
}

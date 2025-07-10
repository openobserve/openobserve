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
        search::{StreamResponses, ValuesEventContext},
        sql::OrderBy,
        stream::StreamType,
    },
};
use log;
use tokio::sync::mpsc;
use tracing::Instrument;
#[cfg(feature = "enterprise")]
use {
    o2_enterprise::enterprise::common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
    o2_enterprise::enterprise::search::datafusion::distributed_plan::streaming_aggs_exec,
};

use crate::common::meta::search::{AuditContext, SearchResultType};
use crate::common::utils::stream::get_max_query_range;
use crate::service::search::cache as search_cache;
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
pub use cache::{handle_cache_responses_and_deltas, write_results_to_cache};
pub use execution::do_partitioned_search;
pub use sorting::order_search_results;

#[cfg(feature = "enterprise")]
pub use cache::write_partial_results_to_cache;

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
) {
    log::debug!(
        "[HTTP2_STREAM trace_id {trace_id}] Received HTTP/2 stream request for org_id: {org_id}",
    );

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
        let c_resp = match search_cache::check_cache_v2(&trace_id, &org_id, stream_type, &req, use_cache)
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
                    if get_o2_config().common.audit_enabled {
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
            "[HTTP2_STREAM trace_id {trace_id}] found cache responses len:{}, with hits: {},
        cache_start_time: {:#?}, cache_end_time: {:#?}",
            cached_resp.len(),
            cached_hits,
            c_start_time,
            c_end_time
        );

        // handle cache responses and deltas
        if !cached_resp.is_empty() && cached_hits > 0 {
            // `max_query_range` is used initialize `remaining_query_range`
            // set max_query_range to i64::MAX if it is 0, to ensure unlimited query range
            // for cache only search
            let remaining_query_range = if max_query_range == 0 {
                i64::MAX
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
            )
            .instrument(search_span.clone())
            .await
            {
                // send audit response first
                #[cfg(feature = "enterprise")]
                {
                    let resp = map_error_to_http_response(&e, None).status().into();
                    if get_o2_config().common.audit_enabled {
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
            )
            .instrument(search_span.clone())
            .await
            {
                // send audit response first
                #[cfg(feature = "enterprise")]
                {
                    let resp = map_error_to_http_response(&e, None).status().into();
                    if get_o2_config().common.audit_enabled {
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
                if get_o2_config().common.audit_enabled {
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
        )
        .instrument(search_span.clone())
        .await
        {
            // send audit response first
            #[cfg(feature = "enterprise")]
            {
                let resp = map_error_to_http_response(&e, None).status().into();
                if get_o2_config().common.audit_enabled {
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
        if get_o2_config().common.audit_enabled {
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
    if sender
        .send(Ok(config::meta::search::StreamResponses::Done))
        .await
        .is_err()
    {
        log::warn!(
            "[HTTP2_STREAM trace_id {trace_id}] Sender is closed, stop sending completion message to client",
        );
    }
} 
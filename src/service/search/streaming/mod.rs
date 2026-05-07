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

//! Streaming search functionality
//!
//! This module contains all the components for handling streaming search requests,
//! including caching, execution, sorting, and utility functions.

use std::{collections::HashMap, time::Instant};

use config::{
    cluster::LOCAL_NODE,
    meta::{
        dashboards::usage_report::DashboardInfo,
        function::{RESULT_ARRAY, VRLResultResolver},
        search::{
            Request, ScanStats, SearchEventType, StreamResponses, TimeOffset, ValuesEventContext,
        },
        sql::OrderBy,
        stream::StreamType,
    },
    utils::{flatten, json, time::hour_micros},
};
use log;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
    log_patterns::{PatternAccumulator, PatternExtractionConfig},
};
use tokio::sync::mpsc;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use vector_enrichment::TableRegistry;

use crate::{
    common::{
        meta::search::{AuditContext, SearchResultType},
        utils::stream::get_max_query_range,
    },
    service::search::{
        cache as search_cache,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    },
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
    mut req: Request,
    stream_type: StreamType,
    stream_names: Vec<String>,
    req_order_by: OrderBy,
    search_span: tracing::Span,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
    fallback_order_by_col: Option<String>,
    _audit_ctx: Option<AuditContext>,
    is_multi_stream_search: bool,
    extract_patterns: bool,
) {
    let root_span = tracing::info_span!("service::search::search_stream_h2");
    let _ = root_span.set_parent(search_span.context());
    let _guard = root_span.enter();

    log::info!(
        "[HTTP2_STREAM trace_id {trace_id}] Received HTTP/2 stream request for org_id: {org_id}",
    );

    #[cfg(feature = "enterprise")]
    let audit_enabled = get_o2_config().common.audit_enabled && _audit_ctx.is_some();
    // Initialize pattern accumulator if pattern extraction is requested
    #[cfg(feature = "enterprise")]
    let (pattern_accumulator, pattern_config) = if extract_patterns {
        log::info!("[HTTP2_STREAM trace_id {trace_id}] Pattern extraction enabled");

        // Get FTS fields from stream settings for all streams being searched
        let mut all_fts_fields = Vec::new();
        for stream_name in &stream_names {
            if let Ok(schema) = infra::schema::get(&org_id, stream_name, stream_type).await {
                let stream_settings = infra::schema::unwrap_stream_settings(&schema);
                let fts_fields = infra::schema::get_stream_setting_fts_fields(&stream_settings);
                all_fts_fields.extend(fts_fields);
            }
        }

        // Deduplicate FTS fields
        all_fts_fields.sort();
        all_fts_fields.dedup();

        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Using FTS fields for pattern extraction: {all_fts_fields:?}",
        );

        // Get configuration from O2 config and OpenObserve config
        let o2_config = get_o2_config();
        let zo_config = config::get_config();

        // Determine max_logs - same logic for both sampling and non-sampling modes
        // Prioritize: 1) user's size, 2) O2 config, 3) OpenObserve default
        let max_logs = if req.query.size > 0 && req.query.size < 10_000_000 {
            req.query.size as usize
        } else if o2_config.log_patterns.max_logs_for_extraction > 0 {
            // Use O2 config value if set (default is 10K for consistent pattern quality)
            o2_config.log_patterns.max_logs_for_extraction
        } else {
            // Fall back to OpenObserve's query_default_limit
            zo_config.limit.query_default_limit as usize
        };

        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Pattern extraction config: max_logs={}, sampling_ratio={:?}, min_cluster={}, threshold={}, min_field_len={}",
            if req.query.sampling_ratio.is_some() {
                format!("{} (sampling mode)", max_logs)
            } else {
                max_logs.to_string()
            },
            req.query.sampling_ratio,
            o2_config.log_patterns.min_cluster_size,
            o2_config.log_patterns.similarity_threshold,
            o2_config.log_patterns.min_field_length
        );

        // Create config with stream-specific FTS fields and O2 config values
        let config = PatternExtractionConfig::default()
            .with_fts_fields(all_fts_fields)
            .with_max_logs(max_logs);

        (Some(PatternAccumulator::new(config.clone())), Some(config))
    } else {
        (None, None)
    };

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
    let start = Instant::now();
    let mut accumulated_results: Vec<SearchResultType> = Vec::new();
    // Disable caching when pattern extraction is requested since patterns are generated
    // dynamically from search results and cannot be cached
    let use_cache = req.use_cache && !extract_patterns;
    if extract_patterns && req.use_cache {
        log::info!("[HTTP2_STREAM trace_id {trace_id}] Disabling cache for pattern extraction");
    }
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
        // TODO(non-ts-order-by): if is_non_ts_order_by && !deltas.is_empty() &&
        // !cached_resp.is_empty(), fall back to full do_partitioned_search() so the global
        // k-way merge produces correct order. Partial hits for non-ts ORDER BY were already
        // broken before this fix (time-based interleave); this would promote them to correct.
        if !cached_resp.is_empty() && cached_hits > 0 {
            // `max_query_range` is used initialize `remaining_query_range`
            // set max_query_range to `end_time - start_time` as hour if it is 0, to ensure
            // unlimited query range for cache only search
            let remaining_query_range = if max_query_range == 0 {
                (req.query.end_time - req.query.start_time) / hour_micros(1) + 1
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
                    req.clear_cache,
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
                    req.clear_cache,
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
        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] search is done, took: {} ms",
            start.elapsed().as_millis()
        );
        // Step 3: Write to results cache
        // cache only if from is 0 and is not an aggregate_query
        if req.query.from == 0
            && let Err(e) = write_results_to_cache(
                c_resp,
                start_time,
                end_time,
                &mut accumulated_results,
                req.clear_cache,
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

    #[allow(unused_mut)]
    let mut search_role = "leader".to_string();

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        search_role = "super".to_string();
    }

    // search is done
    let took_time = start.elapsed().as_millis();
    let mut accumulated_stats = ScanStats::default();
    let mut accumulated_records = 0;
    for result in &accumulated_results {
        let (stats, hits) = result.stats();
        accumulated_stats.add(&stats);
        accumulated_records += hits;
    }
    let trace_id_clone = trace_id.clone();
    async move {
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[HTTP2_STREAM trace_id {trace_id_clone}] search stream is done, took: {} ms",
                    took_time,
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id_clone.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("stream_summary".to_string())
                    .search_role(search_role)
                    .sql(req.query.sql.clone())
                    .time_range((start_time.to_string(), end_time.to_string()))
                    .scan_size(accumulated_stats.original_size as usize)
                    .scan_records(accumulated_stats.records as usize)
                    .data_records(accumulated_records)
                    .duration(took_time as usize)
                    .build()
            )
        );
    }
    .instrument(search_span)
    .await;

    #[cfg(feature = "enterprise")]
    {
        if get_o2_config().common.audit_enabled
            && let Some(audit_ctx) = _audit_ctx.as_ref()
        {
            // Using spawn to handle the async call
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
    }

    // Extract patterns if requested (enterprise feature)
    #[cfg(feature = "enterprise")]
    if let Some(mut accumulator) = pattern_accumulator {
        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Extracting patterns from {} accumulated results",
            accumulated_results.len()
        );

        // Calculate total scan_records from all search results (actual logs scanned with sampling)
        let mut total_scan_records = 0;

        // Convert accumulated_results to hits for pattern extraction
        for result in &accumulated_results {
            let response = match result {
                SearchResultType::Search(r) => r,
                SearchResultType::Cached(r) => r,
            };
            accumulator.add_hits(&response.hits);
            total_scan_records += response.scan_records;
        }

        let stats = accumulator.stats();
        log::info!(
            "[HTTP2_STREAM trace_id {trace_id}] Pattern accumulator stats: {} logs accumulated from {} seen by accumulator, {total_scan_records} total scanned with sampling (sampled: {})",
            stats.accumulated_logs,
            stats.total_logs_seen,
            stats.was_sampled
        );

        // Extract patterns if we have logs
        if stats.accumulated_logs > 0 {
            match o2_enterprise::enterprise::log_patterns::extract_patterns_from_stream(
                &trace_id,
                accumulator,
                all_streams.clone(),
                pattern_config.unwrap(),
                stats.total_logs_seen, // Use actual logs seen, not file metadata
            )
            .await
            {
                Ok(patterns_response) => {
                    // Convert to JSON and send
                    match config::utils::json::to_value(&patterns_response) {
                        Ok(patterns_json) => {
                            log::info!(
                                "[HTTP2_STREAM trace_id {trace_id}] Sending {} patterns",
                                patterns_response.patterns.len()
                            );
                            if sender
                                .send(Ok(config::meta::search::StreamResponses::PatternExtractionResult {
                                    patterns: patterns_json,
                                }))
                                .await
                                .is_err()
                            {
                                log::warn!(
                                    "[HTTP2_STREAM trace_id {trace_id}] Sender closed, could not send pattern results"
                                );
                            }
                        }
                        Err(e) => {
                            log::error!(
                                "[HTTP2_STREAM trace_id {trace_id}] Failed to serialize patterns: {e}",
                            );
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[HTTP2_STREAM trace_id {trace_id}] Pattern extraction failed: {e} (continuing with search results)",
                    );
                }
            }
        } else {
            log::info!(
                "[HTTP2_STREAM trace_id {trace_id}] No logs accumulated for pattern extraction"
            );
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
    queries: Vec<Request>,
    stream_type: StreamType,
    search_span: tracing::Span,
    sender: mpsc::Sender<Result<config::meta::search::StreamResponses, infra::errors::Error>>,
    _fallback_order_by_col: Option<String>,
    _audit_ctx: Option<AuditContext>,
    _dashboard_info: Option<DashboardInfo>,
    search_type: Option<SearchEventType>,
    search_event_context: Option<config::meta::search::SearchEventContext>,
    // When true, all query results are buffered and VRL (query_fn) is applied on the
    // combined 2D array after all queries complete. When false, results stream as they
    // arrive (VRL, if any, is already set on individual requests by the handler).
    needs_post_vrl: bool,
    // Top-level VRL function for post-hoc application. Only used when needs_post_vrl=true.
    query_fn: Option<String>,
) {
    let root_span = tracing::info_span!("service::search::search_multi_stream_h2");
    let _ = root_span.set_parent(search_span.context());
    let _guard = root_span.enter();

    log::debug!(
        "[HTTP2_STREAM_MULTI trace_id {trace_id}] Processing multi-stream request with {} queries for org_id: {org_id}, needs_post_vrl: {needs_post_vrl}",
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

    let total_queries = queries.len();
    let _started_at = chrono::Utc::now().timestamp_micros();

    // Shared progress channel for all queries
    let (progress_tx, mut progress_rx) = mpsc::channel::<(usize, usize)>(100);

    // Process each query independently
    let mut query_tasks = Vec::new();

    for (query_index, mut req) in queries.into_iter().enumerate() {
        let query_trace_id = format!("{trace_id}-q{query_index}");
        let org_id_clone = org_id.clone();
        let user_id_clone = user_id.clone();
        let sender_clone = sender.clone();
        let search_span_clone = search_span.clone();
        let progress_tx_clone = progress_tx.clone();

        // Clone search context for each query
        let query_search_type = search_type;
        let query_search_event_context = search_event_context.clone();

        let needs_post_vrl_clone = needs_post_vrl;

        let task = tokio::spawn(async move {
            log::debug!(
                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Starting query {query_index}: {}",
                req.query.sql
            );

            log::debug!(
                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] query_fn on request: {:?}, needs_post_vrl: {}",
                req.query.query_fn.as_deref().map(|s| &s[..s.len().min(80)]),
                needs_post_vrl_clone,
            );

            // Get stream names for this specific query
            let stream_names = match config::meta::sql::resolve_stream_names(&req.query.sql) {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Failed to resolve stream names: {e}"
                    );
                    let _ = sender_clone.send(Err(e.into())).await;
                    return (query_index, Vec::new(), None);
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
                false, // no pattern extraction for multi-stream
            );

            tokio::spawn(search_task);

            // Buffer for collecting hits when we need post-hoc VRL
            let mut buffered_hits: Vec<json::Value> = Vec::new();
            // Keep the last response metadata for sending VRL results later
            let mut last_response_meta: Option<config::meta::search::Response> = None;

            // Forward results from this query to the main sender, prefixed with query info
            while let Some(result) = query_receiver.recv().await {
                match result {
                    Ok(response) => {
                        match response {
                            StreamResponses::SearchResponse {
                                mut results,
                                streaming_aggs,
                                streaming_id,
                                time_offset,
                            } => {
                                if needs_post_vrl_clone {
                                    // Buffer hits for post-hoc VRL application
                                    let batch_size = results.hits.len();
                                    buffered_hits.extend(std::mem::take(&mut results.hits));
                                    log::debug!(
                                        "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Buffered {batch_size} hits for query {query_index}, total buffered: {}",
                                        buffered_hits.len()
                                    );
                                    last_response_meta = Some(results);
                                } else {
                                    // Stream directly with query_index
                                    results.query_index = Some(query_index);
                                    let prefixed = StreamResponses::SearchResponse {
                                        results,
                                        streaming_aggs,
                                        streaming_id,
                                        time_offset,
                                    };
                                    if sender_clone.send(Ok(prefixed)).await.is_err() {
                                        log::warn!(
                                            "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Main sender is closed"
                                        );
                                        break;
                                    }
                                }
                            }
                            StreamResponses::Progress { percent } => {
                                let _ = progress_tx_clone.send((query_index, percent)).await;
                                continue;
                            }
                            StreamResponses::Done => {
                                continue;
                            }
                            other => {
                                if !needs_post_vrl_clone
                                    && sender_clone.send(Ok(other)).await.is_err()
                                {
                                    break;
                                }
                            }
                        };
                    }
                    Err(e) => {
                        log::error!(
                            "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Query error: {e}"
                        );
                        if !needs_post_vrl_clone {
                            let _ = sender_clone.send(Err(e)).await;
                        }
                        break;
                    }
                }
            }

            log::debug!(
                "[HTTP2_STREAM_MULTI trace_id {query_trace_id}] Query {query_index} completed, buffered {} hits, has_meta: {}",
                buffered_hits.len(),
                last_response_meta.is_some()
            );

            (query_index, buffered_hits, last_response_meta)
        });

        query_tasks.push(task);
    }

    // Drop original sender so channel closes when all tasks complete
    drop(progress_tx);

    // Spawn progress consolidator task
    let sender_for_consolidator = sender.clone();
    let trace_id_for_consolidator = trace_id.clone();
    let consolidator_task = tokio::spawn(async move {
        let mut progress_map: HashMap<usize, usize> = HashMap::new();
        let mut last_sent_percent = 0;

        while let Some((query_index, percent)) = progress_rx.recv().await {
            progress_map.insert(query_index, percent);
            let sum: usize = progress_map.values().sum();
            let avg_percent = sum / total_queries;

            if avg_percent > last_sent_percent {
                if sender_for_consolidator
                    .send(Ok(StreamResponses::Progress {
                        percent: avg_percent,
                    }))
                    .await
                    .is_err()
                {
                    log::warn!(
                        "[HTTP2_STREAM_MULTI trace_id {trace_id_for_consolidator}] \
                         Sender closed while sending progress"
                    );
                    break;
                }
                last_sent_percent = avg_percent;
            }
        }
    });

    // Collect task results. For the buffered VRL path we need the returned hits.
    let mut buffered_results: Vec<(
        usize,
        Vec<json::Value>,
        Option<config::meta::search::Response>,
    )> = Vec::with_capacity(total_queries);

    for task in query_tasks {
        if sender.is_closed() {
            log::warn!("[HTTP2_STREAM_MULTI trace_id {trace_id}] Sender closed, stopping early");
            return;
        }

        match task.await {
            Ok(result) => {
                if needs_post_vrl {
                    buffered_results.push(result);
                }
            }
            Err(e) => {
                log::error!("[HTTP2_STREAM_MULTI trace_id {trace_id}] Task join error: {e}");
                if needs_post_vrl {
                    // Push empty result for this slot
                    buffered_results.push((buffered_results.len(), Vec::new(), None));
                }
            }
        }
    }

    // Wait for consolidator to finish processing all progress updates
    if let Err(e) = consolidator_task.await {
        log::error!("[HTTP2_STREAM_MULTI trace_id {trace_id}] Consolidator task join error: {e}");
    }

    // Apply post-hoc VRL when per_query_response=true and query_fn is set
    if needs_post_vrl {
        log::debug!(
            "[HTTP2_STREAM_MULTI trace_id {trace_id}] All queries done, applying post-hoc VRL on {} buffered query results (hits per query: [{}])",
            buffered_results.len(),
            buffered_results
                .iter()
                .map(|(qi, hits, _)| format!("q{}={}", qi, hits.len()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        if let Some(ref input_fn) = query_fn {
            apply_vrl_to_multi_results(
                &trace_id,
                &org_id,
                input_fn,
                &mut buffered_results,
                total_queries,
                &sender,
            )
            .await;
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

/// Synchronous VRL compilation and execution for multi-stream results.
///
/// This is extracted as a non-async function because `VRLRuntimeConfig` is `!Send` and
/// cannot exist across `.await` points in the async `apply_vrl_to_multi_results`.
fn compute_vrl_responses(
    trace_id: &str,
    org_id: &str,
    input_fn: &str,
    buffered_results: &mut Vec<(
        usize,
        Vec<json::Value>,
        Option<config::meta::search::Response>,
    )>,
    total_queries: usize,
) -> Vec<config::meta::search::Response> {
    let input_fn = input_fn.trim().to_string();
    let apply_over_hits = RESULT_ARRAY.is_match(&input_fn);

    log::debug!(
        "[trace_id {trace_id}] compute_vrl_responses: apply_over_hits={apply_over_hits}, total_queries={total_queries}, vrl_fn_len={}",
        input_fn.len()
    );

    // Sort buffered results by query_index to build the 2D array in order
    buffered_results.sort_by_key(|(idx, ..)| *idx);

    // Build the 2D array: [[query0_hits...], [query1_hits...], ...]
    let multi_hits: Vec<json::Value> = buffered_results
        .iter()
        .map(|(_, hits, _)| json::Value::Array(hits.clone()))
        .collect();

    log::debug!(
        "[trace_id {trace_id}] Built 2D array with {} query arrays (sizes: [{}])",
        multi_hits.len(),
        multi_hits
            .iter()
            .map(|v| v.as_array().map_or(0, |a| a.len()).to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );

    // Resolve stream name for VRL context
    let vrl_stream_name = buffered_results
        .first()
        .and_then(|(_, _, meta)| meta.as_ref())
        .map(|_| "".to_string())
        .unwrap_or_default();

    log::debug!("[trace_id {trace_id}] Compiling VRL function...");
    let mut runtime = crate::common::utils::functions::init_vrl_runtime();
    let program = match crate::service::ingestion::compile_vrl_function(&input_fn, org_id) {
        Ok(program) => {
            let registry = program.config.get_custom::<TableRegistry>().unwrap();
            registry.finish_load();
            program
        }
        Err(err) => {
            log::error!("[trace_id {trace_id}] search_multi_stream->vrl: compile err: {err:?}");
            // Return un-transformed results with function_error
            return buffered_results
                .drain(..)
                .map(|(qi, hits, meta)| {
                    let mut resp =
                        meta.unwrap_or_else(|| config::meta::search::Response::new(0, 0));
                    resp.hits = hits;
                    resp.query_index = Some(qi);
                    resp.function_error = vec![err.to_string()];
                    resp
                })
                .collect();
        }
    };

    log::debug!("[trace_id {trace_id}] VRL compiled successfully, applying to results...");

    let transformed_hits: Vec<json::Value> = if apply_over_hits {
        // Apply VRL on the entire 2D array at once
        let (ret_val, err) = crate::service::ingestion::apply_vrl_fn(
            &mut runtime,
            &VRLResultResolver {
                program: program.program.clone(),
                fields: program.fields.clone(),
            },
            json::Value::Array(multi_hits),
            org_id,
            std::slice::from_ref(&vrl_stream_name),
        );
        if let Some(e) = err {
            log::error!("[trace_id {trace_id}] Error applying vrl function in multi_stream: {e}");
        }

        match ret_val.as_array() {
            None => {
                log::error!(
                    "[trace_id {trace_id}] VRL function did not return an array; returning empty hits"
                );
                vec![json::Value::Array(vec![]); total_queries]
            }
            Some(arr) => arr.clone(),
        }
    } else {
        // Apply VRL per-hit within each query's array
        multi_hits
            .into_iter()
            .map(|query_hits_val| {
                let query_hits = match query_hits_val.as_array() {
                    Some(arr) => arr.clone(),
                    None => vec![],
                };
                let transformed: Vec<json::Value> = query_hits
                    .into_iter()
                    .filter_map(|hit| {
                        let (ret_val, err) = crate::service::ingestion::apply_vrl_fn(
                            &mut runtime,
                            &VRLResultResolver {
                                program: program.program.clone(),
                                fields: program.fields.clone(),
                            },
                            hit,
                            org_id,
                            std::slice::from_ref(&vrl_stream_name),
                        );
                        if let Some(e) = err {
                            log::error!("[trace_id {trace_id}] Error applying vrl function: {e}");
                        }
                        if !ret_val.is_null() && ret_val.is_object() {
                            flatten::flatten(ret_val).ok()
                        } else {
                            None
                        }
                    })
                    .collect();
                json::Value::Array(transformed)
            })
            .collect()
    };

    log::debug!(
        "[trace_id {trace_id}] VRL execution complete, output has {} arrays (sizes: [{}])",
        transformed_hits.len(),
        transformed_hits
            .iter()
            .map(|v| v
                .as_array()
                .map_or_else(|| "non-array".to_string(), |a| a.len().to_string()))
            .collect::<Vec<_>>()
            .join(", ")
    );

    // Build the response objects
    (0..total_queries)
        .map(|qi| {
            let hits_for_query = transformed_hits
                .get(qi)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            // Flatten each hit if needed (for apply_over_hits path)
            let hits_for_query: Vec<json::Value> = if apply_over_hits {
                hits_for_query
                    .into_iter()
                    .filter_map(|v| {
                        if !v.is_null() && v.is_object() {
                            flatten::flatten(v).ok()
                        } else if v.is_array() {
                            Some(v)
                        } else {
                            None
                        }
                    })
                    .collect()
            } else {
                hits_for_query
            };

            let mut resp = buffered_results
                .get(qi)
                .and_then(|(_, _, meta)| meta.clone())
                .unwrap_or_else(|| config::meta::search::Response::new(0, 0));

            resp.hits = hits_for_query;
            resp.query_index = Some(qi);
            resp
        })
        .collect()
}

/// Apply a #ResultArray# VRL function to the combined 2D result array from all queries,
/// then send the transformed results back through the sender with appropriate query_index.
///
/// This is only called when per_query_response=true AND the VRL is a #ResultArray# type.
/// The VRL function receives the full 2D array `[[query0_hits...], [query1_hits...]]` and
/// is expected to return a 2D array of the same structure.
///
/// VRL compilation and execution are delegated to the synchronous `compute_vrl_responses`
/// because `VRLRuntimeConfig` is `!Send` and cannot be held across `.await` points.
async fn apply_vrl_to_multi_results(
    trace_id: &str,
    org_id: &str,
    input_fn: &str,
    buffered_results: &mut Vec<(
        usize,
        Vec<json::Value>,
        Option<config::meta::search::Response>,
    )>,
    total_queries: usize,
    sender: &mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) {
    let responses =
        compute_vrl_responses(trace_id, org_id, input_fn, buffered_results, total_queries);

    // Send the pre-built responses asynchronously (no !Send types in scope)
    for resp in responses {
        log::debug!(
            "[trace_id {trace_id}] Sending VRL-transformed results for query_index={:?}, hits={}",
            resp.query_index,
            resp.hits.len()
        );

        if sender
            .send(Ok(StreamResponses::SearchResponse {
                results: resp,
                streaming_aggs: false,
                streaming_id: None,
                time_offset: TimeOffset {
                    start_time: 0,
                    end_time: 0,
                },
            }))
            .await
            .is_err()
        {
            log::warn!(
                "[HTTP2_STREAM_MULTI trace_id {trace_id}] Sender closed while sending VRL results"
            );
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use config::{
        meta::search::{Response, StreamResponses},
        utils::json,
    };
    use tokio::sync::mpsc;

    use super::apply_vrl_to_multi_results;

    /// Helper: collect all StreamResponses::SearchResponse from the receiver channel.
    async fn collect_responses(
        mut rx: mpsc::Receiver<Result<StreamResponses, infra::errors::Error>>,
    ) -> Vec<Response> {
        let mut responses = Vec::new();
        while let Some(Ok(StreamResponses::SearchResponse { results, .. })) = rx.recv().await {
            responses.push(results);
        }
        responses
    }

    /// Test that a valid #ResultArray# VRL function is applied to the combined 2D array
    /// and the transformed results are sent back with correct query_index values.
    ///
    /// VRL: Takes the 2D input array, builds a new 2D array where each inner array has
    /// a single summary object with a "total" field = length of that query's hits.
    #[tokio::test]
    async fn test_apply_vrl_result_array_transforms_and_splits() {
        let vrl_fn = r#"#ResultArray#
result = array!(.)
output = []
for_each(result) -> |_idx, query_hits| {
    items = array!(query_hits)
    summary = { "total": length(items) }
    output = push(output, [summary])
}
. = output
."#;

        let (tx, rx) = mpsc::channel(100);

        let mut buffered = vec![
            (
                0,
                vec![
                    json::json!({"msg": "a"}),
                    json::json!({"msg": "b"}),
                    json::json!({"msg": "c"}),
                ],
                Some(Response::new(0, 10)),
            ),
            (
                1,
                vec![json::json!({"msg": "x"})],
                Some(Response::new(0, 10)),
            ),
        ];

        apply_vrl_to_multi_results("test-trace", "", vrl_fn, &mut buffered, 2, &tx).await;
        drop(tx);

        let responses = collect_responses(rx).await;
        assert_eq!(responses.len(), 2, "Should send one response per query");

        // Query 0 had 3 hits → summary should have total=3
        assert_eq!(responses[0].query_index, Some(0));
        assert_eq!(responses[0].hits.len(), 1);
        assert_eq!(responses[0].hits[0]["total"], json::json!(3));

        // Query 1 had 1 hit → summary should have total=1
        assert_eq!(responses[1].query_index, Some(1));
        assert_eq!(responses[1].hits.len(), 1);
        assert_eq!(responses[1].hits[0]["total"], json::json!(1));
    }

    /// Test that when VRL compilation fails, the original un-transformed results are
    /// sent back with function_error populated on each response.
    #[tokio::test]
    async fn test_apply_vrl_compile_error_returns_original_hits() {
        let invalid_vrl = "#ResultArray# \nthis_is_not_valid_vrl!!!";

        let (tx, rx) = mpsc::channel(100);

        let mut buffered = vec![
            (
                0,
                vec![json::json!({"msg": "a"})],
                Some(Response::new(0, 10)),
            ),
            (
                1,
                vec![json::json!({"msg": "b"})],
                Some(Response::new(0, 10)),
            ),
        ];

        apply_vrl_to_multi_results("test-trace", "", invalid_vrl, &mut buffered, 2, &tx).await;
        drop(tx);

        let responses = collect_responses(rx).await;
        assert_eq!(
            responses.len(),
            2,
            "Should still send responses on compile error"
        );

        // Original hits should be preserved
        assert_eq!(responses[0].hits, vec![json::json!({"msg": "a"})]);
        assert_eq!(responses[1].hits, vec![json::json!({"msg": "b"})]);

        // function_error should be set
        assert!(!responses[0].function_error.is_empty());
        assert!(!responses[1].function_error.is_empty());

        // query_index should be set correctly
        assert_eq!(responses[0].query_index, Some(0));
        assert_eq!(responses[1].query_index, Some(1));
    }

    /// Test that buffered results arriving out of order (e.g. query 1 finishes before
    /// query 0) are sorted correctly before VRL application and output.
    #[tokio::test]
    async fn test_apply_vrl_sorts_by_query_index() {
        // Simple identity VRL that returns the input as-is
        let vrl_fn = "#ResultArray# \n. = array!(.)\n.";

        let (tx, rx) = mpsc::channel(100);

        // Deliberately out of order: query 2 first, then 0, then 1
        let mut buffered = vec![
            (2, vec![json::json!({"q": 2})], Some(Response::new(0, 10))),
            (0, vec![json::json!({"q": 0})], Some(Response::new(0, 10))),
            (1, vec![json::json!({"q": 1})], Some(Response::new(0, 10))),
        ];

        apply_vrl_to_multi_results("test-trace", "", vrl_fn, &mut buffered, 3, &tx).await;
        drop(tx);

        let responses = collect_responses(rx).await;
        assert_eq!(responses.len(), 3);

        // Results should be sent in query_index order 0, 1, 2
        assert_eq!(responses[0].query_index, Some(0));
        assert_eq!(responses[0].hits[0]["q"], json::json!(0));

        assert_eq!(responses[1].query_index, Some(1));
        assert_eq!(responses[1].hits[0]["q"], json::json!(1));

        assert_eq!(responses[2].query_index, Some(2));
        assert_eq!(responses[2].hits[0]["q"], json::json!(2));
    }

    /// Test with empty hits for some queries — VRL should still process correctly
    /// and return empty arrays for those query slots.
    #[tokio::test]
    async fn test_apply_vrl_handles_empty_query_hits() {
        // VRL that returns the input as-is
        let vrl_fn = "#ResultArray# \n. = array!(.)\n.";

        let (tx, rx) = mpsc::channel(100);

        let mut buffered = vec![
            (
                0,
                vec![json::json!({"msg": "data"})],
                Some(Response::new(0, 10)),
            ),
            (
                1,
                vec![], // empty — e.g. query failed or returned no results
                None,   // no metadata either
            ),
        ];

        apply_vrl_to_multi_results("test-trace", "", vrl_fn, &mut buffered, 2, &tx).await;
        drop(tx);

        let responses = collect_responses(rx).await;
        assert_eq!(responses.len(), 2);

        assert_eq!(responses[0].query_index, Some(0));
        assert_eq!(responses[0].hits.len(), 1);

        assert_eq!(responses[1].query_index, Some(1));
        assert!(
            responses[1].hits.is_empty(),
            "Empty query should produce empty hits"
        );
    }
}

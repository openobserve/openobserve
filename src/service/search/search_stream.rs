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

use std::{cmp::Reverse, collections::BinaryHeap, time::Instant};

use config::{
    meta::{
        search::{
            PARTIAL_ERROR_RESPONSE_MESSAGE, Response, SearchEventType, SearchPartitionRequest,
            SearchPartitionResponse, StreamResponses, TimeOffset, ValuesEventContext,
        },
        sql::OrderBy,
        stream::StreamType,
        websocket::SearchResultType,
    },
    utils::json::{Value, get_string_value},
};
use log;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::{
    auditor::{AuditMessage, Protocol, ResponseMeta},
    infra::config::get_config as get_o2_config,
};
use serde_json::Map;
use tokio::sync::mpsc;
use tracing::Instrument;

use crate::{
    common::{
        meta::search::{CachedQueryResponse, QueryDelta},
        utils::{stream::get_max_query_range, websocket::calc_queried_range},
    },
    service::{
        search::{self as SearchService, cache, datafusion::distributed_plan::streaming_aggs_exec},
        websocket_events::{
            search::write_results_to_cache, sort::order_search_results,
            utils::calculate_progress_percentage,
        },
    },
};
#[cfg(feature = "enterprise")]
use crate::{
    handler::http::request::search::error_utils::map_error_to_http_response,
    service::self_reporting::audit,
};

// #[derive(Debug, Clone)]
// pub struct SearchStreamerBuilder {
//     pub org_id: String,
//     pub user_id: String,
//     pub trace_id: String,
//     pub req: config::meta::search::Request,
//     pub stream_type: StreamType,
//     pub stream_names: Vec<String>,
//     pub req_order_by: OrderBy,
//     pub search_span: tracing::Span,
//     pub sender: mpsc::Sender<Result<config::meta::search::StreamResponses,
// infra::errors::Error>>,
//     pub values_ctx: Option<ValuesEventContext>,
//     pub fallback_order_by_col: Option<String>,
//     pub _audit_ctx: Option<AuditContext>,
// }

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AuditContext {
    pub method: String,
    pub path: String,
    pub query_params: String,
    pub body: String,
}

// New function to encapsulate search task logic
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
    log::info!(
        "[HTTP2_STREAM] trace_id: {} Received test HTTP/2 stream request for org_id: {}",
        trace_id,
        org_id
    );

    // Send a progress: 0 event as an indiciator of search initiation
    if let Err(e) = sender
        .send(Ok(StreamResponses::Progress { percent: 0 }))
        .await
    {
        log::error!("[HTTP2_STREAM] Error sending progress event: {}", e);
    }

    let mut start = Instant::now();
    let mut accumulated_results: Vec<SearchResultType> = Vec::new();
    let use_cache = req.use_cache.unwrap_or(false);
    let start_time = req.query.start_time;
    let end_time = req.query.end_time;

    let max_query_range = get_max_query_range(&stream_names, &org_id, &user_id, stream_type).await; // hours

    // HACK: always search from the first partition, this is becuase to support pagination in http2
    // streaming we need context of no of hits per partition, which currently is not available.
    // Hence we start from the first partition everytime and skip the hits. The following is a
    // global variable to keep track of how many hits to skip across all partitions.
    // This is a temporary hack and will be removed once we have the context of no of hits per
    // partition.
    let mut hits_to_skip = req.query.from;

    if req.query.from == 0 && !req.query.track_total_hits {
        // check cache for the first page
        let c_resp = match cache::check_cache_v2(&trace_id, &org_id, stream_type, &req, use_cache)
            .instrument(search_span.clone())
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[HTTP2_STREAM] trace_id: {}; Failed to check cache: {}",
                    trace_id,
                    e.to_string()
                );

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
                if let Err(e) = sender.send(Err(e)).await {
                    log::error!(
                        "[HTTP2_STREAM] Error sending error message to client: {}",
                        e
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
            "[HTTP2_STREAM] trace_id: {}, found cache responses len:{}, with hits: {},
        cache_start_time: {:#?}, cache_end_time: {:#?}",
            trace_id,
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

                if let Err(e) = sender.send(Err(e)).await {
                    log::error!(
                        "[HTTP2_STREAM] Error sending error message to client: {}",
                        e
                    );
                }
                return;
            }
        } else {
            // Step 2: Search without cache
            // no caches found process req directly
            log::info!(
                "[HTTP2_STREAM] trace_id: {} No cache found, processing search request",
                trace_id
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

                if let Err(e) = sender.send(Err(e)).await {
                    log::error!(
                        "[HTTP2_STREAM] Error sending error message to client: {}",
                        e
                    );
                }
                return;
            }
        }
        // Step 3: Write to results cache
        // cache only if from is 0 and is not an aggregate_query
        if req.query.from == 0 {
            if let Err(e) =
                write_results_to_cache(c_resp, start_time, end_time, &mut accumulated_results)
                    .instrument(search_span.clone())
                    .await
                    .map_err(|e| {
                        log::error!(
                            "[HTTP2_STREAM] trace_id: {}, Error writing results to cache: {:?}",
                            trace_id,
                            e
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

                if let Err(e) = sender.send(Err(e)).await {
                    log::error!(
                        "[HTTP2_STREAM] Error sending error message to client: {}",
                        e
                    );
                }
                return;
            }
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

            if let Err(e) = sender.send(Err(e)).await {
                log::error!(
                    "[HTTP2_STREAM] Error sending error message to client: {}",
                    e
                );
            }
            return;
        }
    }

    // Once all searches are complete, write the accumulated results to a file
    log::info!(
        "[HTTP2_STREAM] trace_id {} stream took {:?}",
        trace_id,
        start.elapsed()
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
    if let Err(e) = sender
        .send(Ok(config::meta::search::StreamResponses::Done))
        .await
    {
        log::error!(
            "[HTTP2_STREAM] Error sending completion message to client: {}",
            e
        );
    }
}

// Do partitioned search without cache
#[tracing::instrument(name = "service:search::http::do_partitioned_search", skip_all)]
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
) -> Result<(), infra::errors::Error> {
    // limit the search by max_query_range
    let mut range_error = String::new();
    if max_query_range > 0
        && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
    {
        req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
        log::info!(
            "[HTTP2_STREAM] Query duration is modified due to query range restriction of {} hours, new start_time: {}",
            max_query_range,
            req.query.start_time
        );
        range_error = format!(
            "Query duration is modified due to query range restriction of {} hours",
            max_query_range
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
    if is_streaming_aggs {
        req.query.streaming_output = true;
        req.query.streaming_id = partition_resp.streaming_id.clone();
    }

    // The order by for the partitions is the same as the order by in the query
    // unless the query is a dashboard or histogram
    let mut partition_order_by = req_order_by;
    // sort partitions in desc by _timestamp for dashboards & histograms
    if req.search_type.expect("populate search_type") == SearchEventType::Dashboards
        || req.query.size == -1
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
        let mut search_res = do_search(trace_id, org_id, stream_type, &req, user_id, false).await?;

        let mut total_hits = search_res.total as i64;

        let skip_hits = std::cmp::min(*hits_to_skip, total_hits);
        if skip_hits > 0 {
            search_res.hits = search_res.hits[skip_hits as usize..].to_vec();
            search_res.total = search_res.hits.len();
            search_res.size = search_res.total as i64;
            total_hits = search_res.total as i64;
            *hits_to_skip -= skip_hits;
            log::info!(
                "[HTTP2_STREAM] trace_id: {}, Skipped {} hits, remaining hits to skip: {}, total hits for partition {}: {}",
                trace_id,
                skip_hits,
                *hits_to_skip,
                idx,
                total_hits
            );
        }

        if req_size > 0 && total_hits > req_size {
            log::info!(
                "[HTTP2_STREAM] trace_id: {}, Reached requested result size ({}), truncating results",
                trace_id,
                req_size
            );
            search_res.hits.truncate(req_size as usize);
            curr_res_size += req_size;
        } else {
            curr_res_size += total_hits;
        }

        if !search_res.hits.is_empty() {
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
                    "src::handler::http::request::search::process_stream::do_partitioned_search::get_top_k_values",
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
                log::debug!("Top k values for partition {idx} took {:?}", duration);
            }

            // Send the cached response
            let response = StreamResponses::SearchResponse {
                results: search_res.clone(),
                streaming_aggs: is_streaming_aggs,
                time_offset: TimeOffset {
                    start_time,
                    end_time,
                },
            };

            if let Err(e) = sender.send(Ok(response)).await {
                log::error!("Error sending response: {}", e);
                return Err(infra::errors::Error::Message(
                    "Error sending response".to_string(),
                ));
            }
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
            if let Err(e) = sender.send(Ok(StreamResponses::Progress { percent })).await {
                log::error!("Error sending progress: {}", e);
                return Err(infra::errors::Error::Message(
                    "Error sending progress".to_string(),
                ));
            }
        }
        // Stop if reached the requested result size and it is not a streaming aggs query
        if req_size != -1 && req_size != 0 && curr_res_size >= req_size && !is_streaming_aggs {
            log::info!(
                "[HTTP2_STREAM]: Reached requested result size ({}), stopping search",
                req_size
            );
            break;
        }
    }

    // Remove the streaming_aggs cache
    if is_streaming_aggs && partition_resp.streaming_id.is_some() {
        streaming_aggs_exec::remove_cache(&partition_resp.streaming_id.unwrap())
    }
    Ok(())
}

async fn get_partitions(
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
    };

    let res = SearchService::search_partition(
        trace_id,
        org_id,
        Some(user_id),
        stream_type,
        &search_partition_req,
        false,
        false,
    )
    .instrument(tracing::info_span!(
        "src::handler::http::request::search::test_stream::get_partitions"
    ))
    .await?;

    Ok(res)
}

#[tracing::instrument(name = "service:search:http::do_search", skip_all)]
async fn do_search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &config::meta::search::Request,
    user_id: &str,
    use_cache: bool,
) -> Result<Response, infra::errors::Error> {
    let mut req = req.clone();

    req.use_cache = Some(use_cache);
    let res = SearchService::cache::search(
        trace_id,
        org_id,
        stream_type,
        Some(user_id.to_string()),
        &req,
        "".to_string(),
    )
    .await;

    res.map(handle_partial_response)
}

fn handle_partial_response(mut res: Response) -> Response {
    if res.is_partial {
        res.function_error = if res.function_error.is_empty() {
            vec![PARTIAL_ERROR_RESPONSE_MESSAGE.to_string()]
        } else {
            res.function_error
                .push(PARTIAL_ERROR_RESPONSE_MESSAGE.to_string());
            res.function_error
        };
    }
    res
}

#[tracing::instrument(
    name = "service:search:http::handle_cache_responses_and_deltas",
    skip_all
)]
#[allow(clippy::too_many_arguments)]
pub async fn handle_cache_responses_and_deltas(
    req: &mut config::meta::search::Request,
    req_size: i64,
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    mut cached_resp: Vec<CachedQueryResponse>,
    mut deltas: Vec<QueryDelta>,
    accumulated_results: &mut Vec<SearchResultType>,
    user_id: &str,
    max_query_range: i64,
    remaining_query_range: i64,
    req_order_by: &OrderBy,
    fallback_order_by_col: Option<String>,
    start_timer: &mut Instant,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
    values_ctx: Option<ValuesEventContext>,
) -> Result<(), infra::errors::Error> {
    // Force set order_by to desc for dashboards & histogram
    // so that deltas are processed in the reverse order
    let cache_order_by = if req.search_type.expect("search_type is required")
        == SearchEventType::Dashboards
        || req.query.size == -1
    {
        &OrderBy::Desc
    } else {
        req_order_by
    };

    // sort both deltas and cache by order_by
    match cache_order_by {
        OrderBy::Desc => {
            deltas.sort_by(|a, b| b.delta_start_time.cmp(&a.delta_start_time));
            cached_resp.sort_by(|a, b| b.response_start_time.cmp(&a.response_start_time));
        }
        OrderBy::Asc => {
            deltas.sort_by(|a, b| a.delta_start_time.cmp(&b.delta_start_time));
            cached_resp.sort_by(|a, b| a.response_start_time.cmp(&b.response_start_time));
        }
    }

    // Initialize iterators for deltas and cached responses
    let mut delta_iter = deltas.iter().peekable();
    let mut cached_resp_iter = cached_resp.iter().peekable();
    let mut curr_res_size = 0; // number of records

    let mut remaining_query_range = remaining_query_range as f64; // hours
    let cache_start_time = cached_resp
        .first()
        .map(|c| c.response_start_time)
        .unwrap_or_default();
    let cache_end_time = cached_resp
        .last()
        .map(|c| c.response_end_time)
        .unwrap_or_default();
    let cache_duration = cache_end_time - cache_start_time; // microseconds
    let cached_search_duration = cache_duration + (max_query_range * 3600 * 1_000_000); // microseconds

    log::info!(
        "[HTTP2_STREAM] trace_id: {}, Handling cache response and deltas, curr_res_size: {}, cached_search_duration: {}, remaining_query_duration: {}, deltas_len: {}, cache_start_time: {}, cache_end_time: {}",
        trace_id,
        curr_res_size,
        cached_search_duration,
        remaining_query_range,
        deltas.len(),
        cache_start_time,
        cache_end_time,
    );

    // Process cached responses and deltas in sorted order
    while cached_resp_iter.peek().is_some() || delta_iter.peek().is_some() {
        if let (Some(&delta), Some(cached)) = (delta_iter.peek(), cached_resp_iter.peek()) {
            // If the delta is before the current cached response time, fetch partitions
            log::info!(
                "[HTTP2_STREAM] checking delta: {:?} with cached start_time: {:?}, end_time:{}",
                delta,
                cached.response_start_time,
                cached.response_end_time,
            );
            // Compare delta and cached response based on the order
            let process_delta_first = match cache_order_by {
                OrderBy::Asc => delta.delta_end_time <= cached.response_start_time,
                OrderBy::Desc => delta.delta_start_time >= cached.response_end_time,
            };

            if process_delta_first {
                log::info!(
                    "[HTTP2_STREAM] trace_id: {} Processing delta before cached response, order_by: {:#?}",
                    trace_id,
                    cache_order_by
                );
                process_delta(
                    req,
                    trace_id,
                    org_id,
                    stream_type,
                    delta,
                    req_size,
                    accumulated_results,
                    &mut curr_res_size,
                    user_id,
                    &mut remaining_query_range,
                    cached_search_duration,
                    start_timer,
                    cache_order_by,
                    sender.clone(),
                    values_ctx.clone(),
                )
                .await?;
                delta_iter.next(); // Move to the next delta after processing
            } else {
                // Send cached response
                send_cached_responses(
                    req,
                    trace_id,
                    req_size,
                    cached,
                    &mut curr_res_size,
                    accumulated_results,
                    fallback_order_by_col.clone(),
                    cache_order_by,
                    start_timer,
                    sender.clone(),
                )
                .await?;
                cached_resp_iter.next();
            }
        } else if let Some(&delta) = delta_iter.peek() {
            // Process remaining deltas
            log::info!(
                "[HTTP2_STREAM] trace_id: {} Processing remaining delta",
                trace_id
            );
            process_delta(
                req,
                trace_id,
                org_id,
                stream_type,
                delta,
                req_size,
                accumulated_results,
                &mut curr_res_size,
                user_id,
                &mut remaining_query_range,
                cached_search_duration,
                start_timer,
                cache_order_by,
                sender.clone(),
                values_ctx.clone(),
            )
            .await?;
            delta_iter.next(); // Move to the next delta after processing
        } else if let Some(cached) = cached_resp_iter.next() {
            // Process remaining cached responses
            send_cached_responses(
                req,
                trace_id,
                req_size,
                cached,
                &mut curr_res_size,
                accumulated_results,
                fallback_order_by_col.clone(),
                cache_order_by,
                start_timer,
                sender.clone(),
            )
            .await?;
        }

        // Stop if reached the requested result size
        if req_size != -1 && curr_res_size >= req_size {
            log::info!(
                "[HTTP2_STREAM] trace_id: {} Reached requested result size: {}, stopping search",
                trace_id,
                req_size
            );
            break;
        }
    }

    Ok(())
}

// Process a single delta (time range not covered by cache)
#[allow(clippy::too_many_arguments)]
async fn process_delta(
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
) -> Result<(), infra::errors::Error> {
    log::info!(
        "[HTTP2_STREAM]: Processing delta for trace_id: {}, delta: {:?}",
        trace_id,
        delta
    );
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
        "[HTTP2_STREAM] Found {} partitions for trace_id: {}",
        partitions.len(),
        trace_id
    );

    // for dashboards & histograms
    if req.search_type.expect("search_type is required") == SearchEventType::Dashboards
        || req.query.size == -1
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
        let mut search_res = do_search(trace_id, org_id, stream_type, &req, user_id, true).await?;

        let total_hits = search_res.total as i64;

        if req.query.size > 0 && total_hits > req.query.size {
            log::info!(
                "[HTTP2_STREAM] trace_id: {}, Reached requested result size ({}), truncating results",
                trace_id,
                req.query.size
            );
            search_res.hits.truncate(req.query.size as usize);
            *curr_res_size += req.query.size;
        } else {
            *curr_res_size += total_hits;
        }

        log::info!(
            "[HTTP2_STREAM]: Found {} hits, for trace_id: {}",
            search_res.hits.len(),
            trace_id
        );

        if !search_res.hits.is_empty() {
            // search_res = order_search_results(search_res, req.fallback_order_by_col.clone());
            // for every partition, compute the queried range omitting the result cache ratio
            let queried_range =
                calc_queried_range(start_time, end_time, search_res.result_cache_ratio);
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

            if req.search_type == Some(SearchEventType::Values) && values_ctx.is_some() {
                let search_stream_span = tracing::info_span!(
                    "src::handler::http::request::search::process_stream::process_delta::get_top_k_values",
                    org_id = %org_id,
                );

                log::debug!("Getting top k values for partition {idx}");
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
            }

            let response = StreamResponses::SearchResponse {
                results: search_res.clone(),
                streaming_aggs: is_streaming_aggs,
                time_offset: TimeOffset {
                    start_time,
                    end_time,
                },
            };
            log::info!(
                "[HTTP2_STREAM]: Processing deltas for trace_id: {}, hits: {:?}",
                trace_id,
                search_res.hits
            );
            log::debug!(
                "[HTTP2_STREAM]: Sending search response for trace_id: {}, delta: {:?}, hits len: {}, result_cache_ratio: {}",
                trace_id,
                delta,
                search_res.hits.len(),
                result_cache_ratio,
            );
            if let Err(e) = sender.send(Ok(response)).await {
                log::error!("Error sending search response: {}", e);
                return Err(infra::errors::Error::Message(
                    "Failed to send search response".to_string(),
                ));
            }
        }

        // Stop if `remaining_query_range` is less than 0
        if *remaining_query_range <= 0.00 {
            log::info!(
                "[HTTP2_STREAM]: trace_id: {} Remaining query range is less than 0, stopping search",
                trace_id
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
                is_streaming_aggs,
                sender,
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
            if let Err(e) = sender.send(Ok(StreamResponses::Progress { percent })).await {
                log::error!("Error sending progress update: {}", e);
                return Err(infra::errors::Error::Message(
                    "Failed to send progress update".to_string(),
                ));
            }
        }

        // Stop if reached the request result size
        if req_size != -1 && *curr_res_size >= req_size {
            log::info!(
                "[HTTP2_STREAM]: Reached requested result size ({}), stopping search",
                req_size
            );
            break;
        }
    }

    // Remove the streaming_aggs cache
    if is_streaming_aggs && partition_resp.streaming_id.is_some() {
        streaming_aggs_exec::remove_cache(&partition_resp.streaming_id.unwrap())
    }

    Ok(())
}

async fn send_partial_search_resp(
    trace_id: &str,
    error: &str,
    new_start_time: i64,
    new_end_time: i64,
    order_by: Option<OrderBy>,
    is_streaming_aggs: bool,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) -> Result<(), infra::errors::Error> {
    let error = if error.is_empty() {
        PARTIAL_ERROR_RESPONSE_MESSAGE.to_string()
    } else {
        format!("{} \n {}", PARTIAL_ERROR_RESPONSE_MESSAGE, error)
    };
    let s_resp = Response {
        is_partial: true,
        function_error: vec![error],
        new_start_time: Some(new_start_time),
        new_end_time: Some(new_end_time),
        order_by,
        trace_id: trace_id.to_string(),
        ..Default::default()
    };

    let response = StreamResponses::SearchResponse {
        results: s_resp,
        streaming_aggs: is_streaming_aggs,
        time_offset: TimeOffset {
            start_time: new_start_time,
            end_time: new_end_time,
        },
    };
    log::info!(
        "[HTTP2_STREAM]: trace_id: {} Sending partial search response",
        trace_id
    );

    if let Err(e) = sender.send(Ok(response)).await {
        log::error!("Error sending partial search response: {}", e);
        return Err(infra::errors::Error::Message(
            "Error sending partial search response".to_string(),
        ));
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn send_cached_responses(
    req: &mut config::meta::search::Request,
    trace_id: &str,
    req_size: i64,
    cached: &CachedQueryResponse,
    curr_res_size: &mut i64,
    accumulated_results: &mut Vec<SearchResultType>,
    fallback_order_by_col: Option<String>,
    cache_order_by: &OrderBy,
    start_timer: &mut Instant,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
) -> Result<(), infra::errors::Error> {
    log::info!(
        "[HTTP2_STREAM]: Processing cached response for trace_id: {}",
        trace_id
    );

    let mut cached = cached.clone();

    // add cache hits to `curr_res_size`
    *curr_res_size += cached.cached_response.hits.len() as i64;

    // truncate hits if `curr_res_size` is greater than `req_size`
    if req_size != -1 && *curr_res_size > req_size {
        let excess_hits = *curr_res_size - req_size;
        let total_hits = cached.cached_response.hits.len() as i64;
        if total_hits > excess_hits {
            let cache_hits: usize = (total_hits - excess_hits) as usize;
            cached.cached_response.hits.truncate(cache_hits);
            cached.cached_response.total = cache_hits;
        }
    }

    cached.cached_response = order_search_results(cached.cached_response, fallback_order_by_col);

    accumulated_results.push(SearchResultType::Cached(cached.cached_response.clone()));

    // `result_cache_ratio` for cached response is 100
    cached.cached_response.result_cache_ratio = 100;
    // `scan_size` is 0, as it is not used for cached responses
    cached.cached_response.scan_size = 0;

    // set took
    cached
        .cached_response
        .set_took(start_timer.elapsed().as_millis() as usize);
    // reset start timer
    *start_timer = Instant::now();

    log::info!(
        "[HTTP2_STREAM]: Sending cached search response for trace_id: {}, hits: {}, result_cache_ratio: {}",
        trace_id,
        cached.cached_response.hits.len(),
        cached.cached_response.result_cache_ratio,
    );
    let response = StreamResponses::SearchResponse {
        results: cached.cached_response,
        streaming_aggs: false,
        time_offset: TimeOffset {
            start_time: cached.response_start_time,
            end_time: cached.response_end_time,
        },
    };
    if let Err(e) = sender.send(Ok(response)).await {
        log::error!("Error sending cached search response: {}", e);
        return Err(infra::errors::Error::Message(
            "Error sending cached search response".to_string(),
        ));
    }

    {
        let percent = calculate_progress_percentage(
            cached.response_start_time,
            cached.response_end_time,
            req.query.start_time,
            req.query.end_time,
            cache_order_by,
        );
        if let Err(e) = sender.send(Ok(StreamResponses::Progress { percent })).await {
            log::error!("Error sending progress update: {}", e);
            return Err(infra::errors::Error::Message(
                "Error sending progress update".to_string(),
            ));
        }
    }

    Ok(())
}

/// This function will compute top k values for values request
#[tracing::instrument(name = "service:search:http::get_top_k_values", skip_all)]
pub fn get_top_k_values(
    hits: &Vec<Value>,
    field: &str,
    top_k: i64,
    no_count: bool,
) -> Result<(Vec<Value>, u64), infra::errors::Error> {
    let mut top_k_values: Vec<Value> = Vec::new();

    if field.is_empty() {
        log::error!("Field is empty for values search");
        return Err(infra::errors::Error::Message("field is empty".to_string()));
    }

    let k_limit = top_k;

    let mut search_result_hits = Vec::new();
    for hit in hits {
        let key: String = hit
            .get("zo_sql_key")
            .map(get_string_value)
            .unwrap_or_default();
        let num = hit
            .get("zo_sql_num")
            .and_then(|v| v.as_i64())
            .unwrap_or_default();
        search_result_hits.push((key, num));
    }

    let result_count;
    if no_count {
        // For alphabetical sorting, collect all entries first
        let mut all_entries: Vec<_> = search_result_hits;
        all_entries.sort_by(|a, b| a.0.cmp(&b.0));
        all_entries.truncate(k_limit as usize);

        let top_hits = all_entries
            .into_iter()
            .map(|(k, v)| {
                let mut item = Map::new();
                item.insert("zo_sql_key".to_string(), Value::String(k));
                item.insert("zo_sql_num".to_string(), Value::Number(v.into()));
                Value::Object(item)
            })
            .collect::<Vec<_>>();

        result_count = top_hits.len();
        let mut field_value: Map<String, Value> = Map::new();
        field_value.insert("field".to_string(), Value::String(field.to_string()));
        field_value.insert("values".to_string(), Value::Array(top_hits));
        top_k_values.push(Value::Object(field_value));
    } else {
        // For value-based sorting, use a min heap to get top k elements
        let mut min_heap: BinaryHeap<Reverse<(i64, String)>> =
            BinaryHeap::with_capacity(k_limit as usize);
        for (k, v) in search_result_hits {
            if min_heap.len() < k_limit as usize {
                // If heap not full, just add
                min_heap.push(Reverse((v, k)));
            } else if !min_heap.is_empty() && v > min_heap.peek().unwrap().0.0 {
                // If current value is larger than smallest in heap, replace it
                min_heap.pop();
                min_heap.push(Reverse((v, k)));
            }
        }

        // Convert heap to vector and sort in descending order
        let mut top_elements: Vec<_> = min_heap.into_iter().map(|Reverse((v, k))| (k, v)).collect();
        top_elements.sort_by(|a, b| b.1.cmp(&a.1));

        let top_hits = top_elements
            .into_iter()
            .map(|(k, v)| {
                let mut item = Map::new();
                item.insert("zo_sql_key".to_string(), Value::String(k));
                item.insert("zo_sql_num".to_string(), Value::Number(v.into()));
                Value::Object(item)
            })
            .collect::<Vec<_>>();

        result_count = top_hits.len();
        let mut field_value: Map<String, Value> = Map::new();
        field_value.insert("field".to_string(), Value::String(field.to_string()));
        field_value.insert("values".to_string(), Value::Array(top_hits));
        top_k_values.push(Value::Object(field_value));
    }

    Ok((top_k_values, result_count as u64))
}

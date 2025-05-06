#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_assignments)]
#![allow(unused_doc_comments)]

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

use std::{
    io::{Error, Write},
    time::Instant,
};

use actix_http::{ContentEncoding, header};
use actix_web::{
    HttpRequest, HttpResponse,
    http::{StatusCode, header::HeaderValue},
    post, web,
};
use bytes::Bytes as BytesImpl;
use config::{
    get_config,
    meta::{
        search::{
            PARTIAL_ERROR_RESPONSE_MESSAGE, Response, SearchEventType, SearchPartitionRequest,
            SearchPartitionResponse,
        },
        sql::{OrderBy, resolve_stream_names},
        stream::StreamType,
        websocket::SearchResultType,
    },
    utils::json,
};
use flate2::{Compression, write::GzEncoder};
use futures::{SinkExt, stream::StreamExt};
use hashbrown::HashMap;
use log;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{Instrument, Span};

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_stream_permissions;
use crate::{
    common::{
        meta::{
            self,
            http::HttpResponse as MetaHttpResponse,
            search::{CachedQueryResponse, QueryDelta},
        },
        utils::{
            http::{
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
                get_use_cache_from_request,
            },
            stream::{get_max_query_range, get_settings_max_query_range},
            websocket::{calc_queried_range, update_histogram_interval_in_query},
        },
    },
    handler::http::request::search::error_utils::map_error_to_http_response,
    service::{
        search::{self as SearchService, cache, datafusion::distributed_plan::streaming_aggs_exec},
        websocket_events::{
            search::write_results_to_cache,
            utils::{TimeOffset, calculate_progress_percentage, setup_tracing_with_trace_id},
        },
    },
};

/// Search HTTP2 streaming endpoint
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "TestSearchStreamHttp2",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Search query", content_type = "application/json", example = json!({
        "sql": "select * from logs LIMIT 10",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_search_stream")]
pub async fn search_http2_stream(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> HttpResponse {
    let mut start = Instant::now();
    let cfg = get_config();
    let org_id = org_id.into_inner();

    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_stream", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);

    let mut accumulated_results: Vec<SearchResultType> = Vec::new();

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Log the request
    log::info!(
        "[trace_id: {}] Received test HTTP/2 stream request for org_id: {}",
        trace_id,
        org_id
    );

    // Get query params
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    // Parse the search request
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    if let Err(e) = req.decode() {
        return MetaHttpResponse::bad_request(e);
    }

    // Set use_cache from query params
    let use_cache = cfg.common.result_cache_enabled && get_use_cache_from_request(&query);
    req.use_cache = Some(use_cache);

    // Set search type if not set
    if req.search_type.is_none() {
        req.search_type = match get_search_type_from_request(&query) {
            Ok(v) => v,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
    }

    // Set search event context if not set
    if req.search_event_context.is_none() {
        req.search_event_context = req
            .search_type
            .as_ref()
            .and_then(|event_type| get_search_event_context_from_request(event_type, &query));
    }

    // get stream name
    let stream_names = match resolve_stream_names(&req.query.sql) {
        Ok(v) => v.clone(),
        Err(e) => {
            return HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                e.to_string(),
            ));
        }
    };

    // Check permissions for each stream
    let mut range_error = String::new();
    #[cfg(feature = "enterprise")]
    for stream_name in stream_names.iter() {
        if let Some(settings) =
            infra::schema::get_settings(&org_id, &stream_name, stream_type).await
        {
            let max_query_range =
                get_settings_max_query_range(settings.max_query_range, &org_id, Some(&user_id))
                    .await;
            if max_query_range > 0
                && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
            {
                req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
                range_error = format!(
                    "Query duration is modified due to query range restriction of {} hours",
                    max_query_range
                );
            }
        }

        // Check permissions on stream
        #[cfg(feature = "enterprise")]
        if let Some(res) =
            check_stream_permissions(&stream_name, &org_id, &user_id, &stream_type).await
        {
            return res;
        }
    }
    // Clone required values for the async task
    let trace_id_clone = trace_id.clone();
    let org_id_clone = org_id.clone();

    // create new sql query with histogram interval
    let sql = match crate::service::search::sql::Sql::new(
        &req.query.clone().into(),
        &org_id,
        stream_type,
        req.search_type,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error parsing sql: {:?}", e);
            return MetaHttpResponse::bad_request(e);
        }
    };

    if let Some(interval) = sql.histogram_interval {
        // modify the sql query statement to include the histogram interval
        if let Ok(updated_query) = update_histogram_interval_in_query(&req.query.sql, interval) {
            req.query.sql = updated_query;
        } else {
            log::error!(
                "[HTTP2_STREAM] trace_id: {}; Failed to update query with histogram interval: {}",
                trace_id,
                interval
            );

            return MetaHttpResponse::bad_request("Failed to update query with histogram interval");
        }
        log::info!(
            "[HTTP2_STREAM] trace_id: {}; Updated query {}; with histogram interval: {}",
            trace_id,
            req.query.sql,
            interval
        );
    }
    let req_order_by = sql.order_by.first().map(|v| v.1).unwrap_or_default();

    let search_span = setup_tracing_with_trace_id(
        &trace_id,
        tracing::info_span!("service::search::search_stream_h2"),
    )
    .await;

    if req.search_type.is_none() {
        req.search_type = Some(SearchEventType::Other);
    }

    let start_time = req.query.start_time;
    let end_time = req.query.end_time;

    // Create a channel for streaming results
    let (tx, rx) = mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);
    let sender = tx.clone();

    // Spawn the test data generation in a separate task
    actix_web::rt::spawn(async move {
        log::info!(
            "[HTTP2_STREAM] trace_id: {} Received test HTTP/2 stream request for org_id: {}",
            trace_id,
            org_id
        );

        let max_query_range =
            get_max_query_range(&stream_names, &org_id, &user_id, stream_type).await; // hours

        if req.query.from == 0 {
            let c_resp =
                match cache::check_cache_v2(&trace_id, &org_id, stream_type, &req, use_cache)
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
                        // send error message to client
                        if let Err(e) = sender.send(Err(e)).await {
                            log::error!("Error sending error message to client: {}", e);
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
                    &mut start,
                    sender.clone(),
                )
                .instrument(search_span.clone())
                .await
                {
                    if let Err(e) = sender.send(Err(e)).await {
                        log::error!("Error sending error message to client: {}", e);
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
                )
                .instrument(search_span.clone())
                .await
                {
                    if let Err(e) = sender.send(Err(e)).await {
                        log::error!("Error sending error message to client: {}", e);
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
                    if let Err(e) = sender.send(Err(e)).await {
                        log::error!("Error sending error message to client: {}", e);
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
            )
            .instrument(search_span.clone())
            .await
            {
                if let Err(e) = sender.send(Err(e)).await {
                    log::error!("Error sending error message to client: {}", e);
                }
                return;
            }
        }

        // Once all searches are complete, write the accumulated results to a file
        log::info!(
            "[HTTP2_STREAM] trace_id {} all searches completed",
            trace_id
        );
    });

    // Return streaming response
    let cfg_clone = cfg.clone();
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(move |result| match result {
        Ok(v) => {
            // TEST: payload size
            let mut v = v;
            {
                if cfg_clone.websocket.streaming_benchmark_enabled {
                    match v {
                        StreamResponses::SearchResponse {
                            results,
                            streaming_aggs,
                            time_offset,
                        } => {
                            let mut results_clone = results.clone();
                            let dummy_data =
                                vec![
                                    "a";
                                    cfg_clone.websocket.streaming_benchmark_dummy_data_size
                                        * 1024
                                        * 1024
                                ];
                            results_clone.columns =
                                dummy_data.iter().map(|v| v.to_string()).collect();
                            let modified_response = StreamResponses::SearchResponse {
                                results: results_clone,
                                streaming_aggs,
                                time_offset,
                            };
                            v = modified_response;
                        }
                        _ => {}
                    }
                }
            }

            let encoded_response = v.to_response().into_bytes();
            Ok(BytesImpl::from(encoded_response))
        }
        Err(e) => {
            log::error!("[HTTP2_STREAM] Error in stream: {}", e);
            // TODO: fix error map
            // let err_res = map_error_to_http_response(&e, trace_id);
            let error_bytes = format!("event: error\ndata: {}\n\n", e);
            Err(std::io::Error::new(std::io::ErrorKind::Other, error_bytes))
        }
    });

    HttpResponse::Ok()
        .content_type("text/event-stream")
        .append_header((header::CONNECTION, HeaderValue::from_static("keep-alive")))
        .append_header((
            header::TRANSFER_ENCODING,
            HeaderValue::from_static("chunked"),
        ))
        // .insert_header(ContentEncoding::Identity) // to disable encoding
        .streaming(stream)
}

// Do partitioned search without cache
#[tracing::instrument(name = "service:search:websocket::do_partitioned_search", skip_all)]
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

        if req_size != -1 {
            req.query.size -= curr_res_size;
        }

        // do not use cache for partitioned search without cache
        let mut search_res = do_search(trace_id, org_id, stream_type, &req, user_id, false).await?;

        curr_res_size += search_res.hits.len() as i64;

        if !search_res.hits.is_empty() {
            // TODO: Streaming aggs we need special order
            // search_res = order_search_results(search_res, req.fallback_order_by_col);

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
            // if req.search_type == SearchEventType::Values && req.values_event_context.is_some() {
            //     let SEARCH_STREAM_span = tracing::info_span!(
            //         "src::handler::http::request::search::test_stream::do_partitioned_search::get_top_k_values",
            //         org_id = %req.org_id,
            //     );
            //     let instant = Instant::now();
            //     let top_k_values = tokio::task::spawn_blocking(move || {
            //         get_top_k_values(&search_res.hits,
            // &req.values_event_context.clone().unwrap())     })
            //     .instrument(SEARCH_STREAM_span.clone())
            //     .await
            //     .unwrap();
            //     search_res.hits = top_k_values?;
            //     let duration = instant.elapsed();
            //     log::debug!("Top k values for partition {idx} took {:?}", duration);
            // }

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StreamResponses {
    SearchResponse {
        results: Response,
        streaming_aggs: bool,
        time_offset: TimeOffset,
    },
    Progress {
        percent: usize,
    },
}

impl StreamResponses {
    pub fn to_string(&self) -> String {
        serde_json::to_string(self).expect("Failed to serialize search response")
    }

    pub fn to_response(&self) -> String {
        format!("data: {}\n\n", self.to_string())
    }
}

#[tracing::instrument(
    name = "service:search:websocket::handle_cache_responses_and_deltas",
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
    start_timer: &mut Instant,
    sender: mpsc::Sender<Result<StreamResponses, infra::errors::Error>>,
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
                    // req.fallback_order_by_col.clone(),
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
                // req.fallback_order_by_col.clone(),
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

    let partition_resp = get_partitions(&trace_id, &org_id, stream_type, &req, user_id).await?;
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
        let mut search_res =
            do_search(&trace_id, &org_id, stream_type, &req, user_id, true).await?;
        *curr_res_size += search_res.hits.len() as i64;

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

            // TODO: add top k values for values search
            // if req.search_type == SearchEventType::Values && req.values_event_context.is_some() {
            //     log::debug!("Getting top k values for partition {idx}");
            //     let values_event_context = req.values_event_context.clone().unwrap();
            //     let top_k_values = tokio::task::spawn_blocking(move || {
            //         get_top_k_values(&search_res.hits, &values_event_context)
            //     })
            //     .await
            //     .unwrap();
            //     search_res.hits = top_k_values?;
            // }

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
            // passs original start_time and end_time partition end time
            let _ = send_partial_search_resp(
                &trace_id,
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
    // fallback_order_by_col: Option<String>,
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

    // TODO: order the cached response
    // cached.cached_response = order_search_results(cached.cached_response, fallback_order_by_col);

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
        sender
            .send(Ok(StreamResponses::Progress { percent }))
            .await
            .unwrap();
    }

    Ok(())
}

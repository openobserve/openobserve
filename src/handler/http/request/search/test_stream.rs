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

use std::io::Error;
use std::time::Instant;
use std::ops::ControlFlow;

use config::{
    get_config,
    meta::{
        search::{SearchEventContext, SearchEventType, SearchPartitionRequest, SearchPartitionResponse, PARTIAL_ERROR_RESPONSE_MESSAGE},
        websocket::SearchResultType, sql::OrderBy,
    },
};
use rand::Rng;
use sqlparser::{
    ast::{Expr, FunctionArguments, Statement, visit_statements_mut},
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use actix_web::{HttpRequest, HttpResponse, post, web, http::StatusCode};
use bytes::Bytes as BytesImpl;
use chrono::Utc;
use config::utils::json;
use config::meta::stream::StreamType;
use config::meta::sql::resolve_stream_names;
use config::meta::search::Response;
use futures::channel::mpsc;
use futures::stream::StreamExt;
use futures::SinkExt;
use log;
use tracing::{Instrument, Span};
use hashbrown::HashMap;

use crate::common::{
        meta::{self, http::HttpResponse as MetaHttpResponse},
        utils::{
            functions,
            http::{
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
                get_use_cache_from_request, get_work_group,
            },
            stream::get_max_query_range,
            websocket::update_histogram_interval_in_query,
        },
    };
use crate::service::{
    search::{
        cache,
        self as SearchService, sql::Sql,
    },
    self_reporting::http_report_metrics,
    setup_tracing_with_trace_id,
    websocket_events::{
        utils::{WsServerEvents, TimeOffset},
        sort::order_search_results,
    },
};

/// Test HTTP2 streaming endpoint
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
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
        (status = 200, description = "Success", content_type = "application/x-ndjson"),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_test_http2_stream")]
pub async fn test_http2_stream(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let mut start = Instant::now();
    let cfg = config::get_config();
    let org_id = org_id.into_inner();
    
    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_stream", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    
    // Log the request
    log::info!("[trace_id: {}] Received test HTTP/2 stream request for org_id: {}", trace_id, org_id);
    
    // Get query params
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    
    // Parse the search request
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };
    if let Err(e) = req.decode() {
        return Ok(MetaHttpResponse::bad_request(e));
    }
    
    // Set use_cache from query params
    let use_cache = cfg.common.result_cache_enabled && get_use_cache_from_request(&query);
    req.use_cache = Some(use_cache);
    
    // Set search type if not set
    if req.search_type.is_none() {
        req.search_type = match get_search_type_from_request(&query) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
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
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            );
        }
    };

    // Check permissions for each stream
    // #[cfg(feature = "enterprise")]
    // for stream_name in stream_names.iter() {
    //     if let Err(e) =
    //         o2_enterprise::enterprise::check::check_permissions(stream_name, stream_type, user_id, org_id).await
    //     {
    //         let err_res = WsServerEvents::error_response(
    //             &Error::Message(e),
    //             Some(req.trace_id.clone()),
    //             Some(trace_id),
    //             Default::default(),
    //         );
    //         send_message(req.trace_id.clone(), err_res.to_json()).await?;
    //         return Ok(());
    //     }
    // }


    // Create a channel for streaming results
    let (tx, rx) = mpsc::channel::<Result<BytesImpl, actix_web::Error>>(100);
    let sender = tx.clone();
    
    // Clone required values for the async task
    let trace_id_clone = trace_id.clone();
    let org_id_clone = org_id.clone();

    // create new sql query with histogram interval
    let sql = match crate::service::search::sql::Sql::new(&req.query.clone().into(), &org_id, stream_type, req.search_type).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error parsing sql: {:?}", e);
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    if let Some(interval) = sql.histogram_interval {
        // modify the sql query statement to include the histogram interval
        if let Ok(updated_query) = update_histogram_interval_in_query(&req.query.sql, interval) {
            req.query.sql = updated_query;
        } else {
            log::error!("[WS_SEARCH] trace_id: {}; Failed to update query with histogram interval: {}",
                trace_id,
                interval
            );
            // send error message to client
            send_message(&sender, WsServerEvents::Error {
                code: 400,
                message: "Failed to update query with histogram interval".to_string(),
                error_detail: None,
                trace_id: None,
                request_id: None,
                should_client_retry: false,
            }).await;

            return Ok(MetaHttpResponse::bad_request(
                "Failed to update query with histogram interval"
            ));
        }
        log::info!(
            "[WS_SEARCH] trace_id: {}; Updated query {}; with histogram interval: {}",
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
    
    // Spawn the test data generation in a separate task
    actix_web::rt::spawn(async move {
        log::info!(
            "[HTTP2_STREAM] trace_id: {} Received test HTTP/2 stream request for org_id: {}",
            trace_id,
            org_id
        );

        // if req.query.from == 0 {
        //     let c_resp = match cache::check_cache_v2(&trace_id, &org_id, stream_type, &req, use_cache)
        //         .instrument(search_span.clone())
        //         .await {
        //             Ok(v) => v,
        //             Err(e) => {
        //                 log::error!("[WS_SEARCH] trace_id: {}; Failed to check cache: {}",
        //                     trace_id,
        //                     e.to_string()
        //                 );
        //                 // send error message to client
        //                 send_message(&sender, "error", json!({
        //                     "message": "Failed to check cache"
        //                 })).await;

        //                 return;
        //             }
        //         };
        //     let local_c_resp = c_resp.clone();
        //     let cached_resp = local_c_resp.cached_response;
        //     let mut deltas = local_c_resp.deltas;
        //     deltas.sort();
        //     deltas.dedup();
            
        //     let cached_hits = cached_resp
        //         .iter()
        //         .fold(0, |acc, c| acc + c.cached_response.hits.len());

        //     let c_start_time = cached_resp
        //         .first()
        //         .map(|c| c.response_start_time)
        //         .unwrap_or_default();

        //     let c_end_time = cached_resp
        //         .last()
        //         .map(|c| c.response_end_time)
        //         .unwrap_or_default();

        //     log::info!(
        //         "[WS_SEARCH] trace_id: {}, found cache responses len:{}, with hits: {}, cache_start_time: {:#?}, cache_end_time: {:#?}",
        //         trace_id,
        //         cached_resp.len(),
        //         cached_hits,
        //         c_start_time,
        //         c_end_time
        //     );

        //     // handle cache responses and deltas
        //     if !cached_resp.is_empty() && cached_hits > 0 {
        //         // `max_query_range` is used initialize `remaining_query_range`
        //         // set max_query_range to i64::MAX if it is 0, to ensure unlimited query range
        //         // for cache only search
        //         let max_query_range = get_max_query_range(&stream_names, &org_id, &user_id, stream_type).await;
        //         let remaining_query_range = if max_query_range == 0 {
        //             i64::MAX
        //         } else {
        //             max_query_range
        //         }; // hours

        //         // Step 1(a): handle cache responses & query the deltas
        //         handle_cache_responses_and_deltas(
        //             &req,
        //             trace_id.clone(),
        //             req_size,
        //             cached_resp,
        //             deltas,
        //             &user_id,
        //             max_query_range,
        //             remaining_query_range,
        //             &req_order_by,
        //             &mut start_timer,
        //         )
        //         .instrument(search_span.clone())
        //         .await?;
        //     } else {}
        // } else {

        // Step 4: Search without cache for req with from > 0
        let max_query_range =
            get_max_query_range(&stream_names, &org_id, &user_id, stream_type).await; // hours

        let size = req.query.size;
        match do_partitioned_search(
            &mut req,
            &trace_id,
            &org_id,
            stream_type,
            size,
            &user_id,
            max_query_range,
            &mut start,
            &req_order_by,
            &sender,
        )
        .instrument(search_span.clone())
        .await {
            Ok(_) => (),
            Err(e) => {
                log::error!("Error in do_partitioned_search: {}", e);
                return;
            }
        };
        // }

        // Once all searches are complete, write the accumulated results to a file
        log::info!("[HTTP2_STREAM] trace_id {} all searches completed", trace_id);
        let end_res = WsServerEvents::End {
            trace_id: Some(trace_id.clone()),
        };
        match send_message(&sender, end_res).await {
            Ok(_) => (),
            Err(e) => {
                log::error!("Error in send_message: {}", e);
                return;
            }
        };
    });
    
    // Return streaming response
    let stream = rx.map(|result| result);
    
    Ok(HttpResponse::Ok()
        .content_type("text/event-stream")
        .append_header(("Content-Type", "text/event-stream"))
        .append_header(("Connection", "keep-alive"))
        .streaming(stream))
}

// Helper function to send a message to the client
async fn send_message(
    sender: &mpsc::Sender<Result<BytesImpl, actix_web::Error>>, 
    event: WsServerEvents
) -> Result<(), Error> {
    let mut sender = sender.clone();
    
    match json::to_vec(&event.to_json()) {
        Ok(json_bytes) => {
            // Add newline to each JSON message for ndjson format
            let mut bytes_with_newline = json_bytes;
            bytes_with_newline.push(b'\n');
            
            sender.send(Ok(BytesImpl::from(bytes_with_newline)))
                .await
                .map_err(|e| {
                    log::error!("Failed to send message: {}", e);
                    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                })?;
            
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to serialize message: {}", e);
            Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        }
    }
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
    max_query_range: i64, // hours
    start_timer: &mut Instant,
    req_order_by: &OrderBy,
    sender: &mpsc::Sender<Result<BytesImpl, actix_web::Error>>,
) -> Result<(), infra::errors::Error> {
    // limit the search by max_query_range
    let mut range_error = String::new();
    if max_query_range > 0
        && (req.query.end_time - req.query.start_time)
            > max_query_range * 3600 * 1_000_000
    {
        req.query.start_time =
            req.query.end_time - max_query_range * 3600 * 1_000_000;
        log::info!(
            "[WS_SEARCH] Query duration is modified due to query range restriction of {} hours, new start_time: {}",
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
    if req.search_type.expect("populate search_type") == SearchEventType::Dashboards || req.query.size == -1 {
        partitions.sort_by(|a, b| b[0].cmp(&a[0]));
        partition_order_by = &OrderBy::Desc;
    }

    let mut curr_res_size = 0;

    log::info!(
        "[WS_SEARCH] Found {} partitions for trace_id: {}, partitions: {:?}",
        partitions.len(),
        trace_id,
        &partitions
    );

    for (idx, &[start_time, end_time]) in partitions.iter().enumerate() {
        if idx == 4 {

            send_message(sender, ws_search_res).await;
        }
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
            /// TODO: Streaming aggs we need special order
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

            // TODO: accumulate the result for caching
            // // Accumulate the result
            // if is_streaming_aggs {
            //     // Only accumulate the results of the last partition
            //     if idx == partitions.len() - 1 {
            //         accumulated_results.push(SearchResultType::Search(search_res.clone()));
            //     }
            // } else {
            //     accumulated_results.push(SearchResultType::Search(search_res.clone()));
            // }

            // TODO: add top k values for values search
            // if req.search_type == SearchEventType::Values && req.values_event_context.is_some() {
            //     let ws_search_span = tracing::info_span!(
            //         "src::service::websocket_events::search::do_partitioned_search::get_top_k_values",
            //         org_id = %req.org_id,
            //     );
            //     let instant = Instant::now();
            //     let top_k_values = tokio::task::spawn_blocking(move || {
            //         get_top_k_values(&search_res.hits, &req.values_event_context.clone().unwrap())
            //     })
            //     .instrument(ws_search_span.clone())
            //     .await
            //     .unwrap();
            //     search_res.hits = top_k_values?;
            //     let duration = instant.elapsed();
            //     log::debug!("Top k values for partition {idx} took {:?}", duration);
            // }

            // Send the cached response
            let ws_search_res = WsServerEvents::SearchResponse {
                trace_id: trace_id.to_string(),
                results: Box::new(search_res.clone()),
                time_offset: TimeOffset {
                    start_time,
                    end_time,
                },
                streaming_aggs: is_streaming_aggs,
            };
            
            if let Err(e) = send_message(sender, ws_search_res).await {
                log::error!("Failed to send search results: {}", e);
            }
            
        }

        // Stop if reached the requested result size and it is not a streaming aggs query
        if req_size != -1 && curr_res_size >= req_size && !is_streaming_aggs {
            log::info!(
                "[WS_SEARCH]: Reached requested result size ({}), stopping search",
                req_size
            );
            break;
        }
    }

    // TODO: Add (Remove the streaming_aggs cache)
    // if is_streaming_aggs && partition_resp.streaming_id.is_some() {
    //     streaming_aggs_exec::remove_cache(&partition_resp.streaming_id.unwrap())
    // }
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
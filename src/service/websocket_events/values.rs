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

use chrono::DateTime;
use config::{
    get_config,
    meta::{
        search::{SearchEventType, ValuesEventContext},
        websocket::{SearchResultType, ValuesEventReq},
    },
};
use tracing::Instrument;

#[cfg(feature = "enterprise")]
use crate::service::websocket_events::enterprise_utils;
use crate::{
    common::utils::stream::get_max_query_range,
    handler::http::request::{search::build_search_request_per_field, ws::session::send_message},
    service::{
        search::{cache, sql::Sql},
        setup_tracing_with_trace_id,
        websocket_events::{
            WsServerEvents,
            search::{
                do_partitioned_search, handle_cache_responses_and_deltas, write_results_to_cache,
            },
        },
    },
};

pub async fn handle_values_request(
    org_id: &str,
    user_id: &str,
    request_id: &str,
    req: ValuesEventReq,
    accumulated_results: &mut Vec<SearchResultType>,
) -> Result<(), infra::errors::Error> {
    let mut start_timer = std::time::Instant::now();

    let cfg = get_config();
    let trace_id = req.trace_id.clone();
    let stream_type = req.stream_type;
    let payload = req.payload;
    let start_time = payload.start_time;
    let end_time = payload.end_time;
    let stream_name = payload.stream_name.clone();
    let no_count = payload.no_count;

    // Setup tracing
    let ws_values_span = setup_tracing_with_trace_id(
        &trace_id,
        tracing::info_span!("service:websocket_events:values:handle_values_request"),
    )
    .await;

    log::info!(
        "[WS_VALUES] trace_id: {} Received values request, start_time: {}, end_time: {}",
        trace_id,
        DateTime::from_timestamp_micros(start_time.unwrap_or(0) / 1_000)
            .map_or("None".to_string(), |dt| dt.to_string()),
        DateTime::from_timestamp_micros(end_time.unwrap_or(0) / 1_000)
            .map_or("None".to_string(), |dt| dt.to_string())
    );

    // Check permissions for each stream
    #[cfg(feature = "enterprise")]
    {
        if let Err(e) =
            enterprise_utils::check_permissions(&stream_name, stream_type, user_id, org_id).await
        {
            let err_res = WsServerEvents::error_response(
                &infra::errors::Error::Message(e),
                Some(request_id.to_string()),
                Some(trace_id),
                Default::default(),
            );
            send_message(request_id, err_res.to_json()).await?;
            return Ok(());
        }
    }

    // handle search result size
    // use this size as K in top K values logic
    let top_k = payload.size.or(Some(cfg.limit.query_default_limit));

    // get values req query
    let reqs = build_search_request_per_field(&payload, org_id, stream_type, &stream_name)
        .instrument(ws_values_span.clone())
        .await?;

    for (search_req, stream_type, field) in reqs {
        // Convert the request query to SearchQuery type if needed
        // Here we're converting from the search_req.query to the expected type
        let search_query = search_req.query.clone().into();

        let sql = Sql::new(&search_query, org_id, stream_type, search_req.search_type).await?;
        let order_by = sql.order_by.first().map(|v| v.1).unwrap_or_default();

        if search_req.query.from == 0 {
            let c_resp = cache::check_cache_v2(
                &trace_id,
                org_id,
                stream_type,
                &search_req,
                search_req.use_cache.unwrap_or(false),
            )
            .instrument(ws_values_span.clone())
            .await?;
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
                "[WS_VALUES] trace_id: {}, found cache responses len:{}, with hits: {}, cache_start_time: {:#?}, cache_end_time: {:#?}",
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
                let max_query_range =
                    get_max_query_range(&[stream_name.clone()], org_id, user_id, stream_type).await; // hours
                let remaining_query_range = if max_query_range == 0 {
                    i64::MAX
                } else {
                    max_query_range
                }; // hours

                // Convert SearchRequest to SearchEventReq for compatibility with search functions
                let search_event_req = config::meta::websocket::SearchEventReq {
                    org_id: org_id.to_string(),
                    stream_type,
                    fallback_order_by_col: None,
                    search_type: search_req.search_type.unwrap_or(SearchEventType::Values),
                    search_event_context: None,
                    trace_id: trace_id.clone(),
                    use_cache: search_req.use_cache.unwrap_or(false),
                    payload: search_req.clone(),
                    user_id: Some(user_id.to_string()),
                    time_offset: None,
                    values_event_context: Some(ValuesEventContext {
                        top_k,
                        no_count,
                        field,
                    }),
                };

                // Step 1(a): handle cache responses & query the deltas
                handle_cache_responses_and_deltas(
                    request_id,
                    &search_event_req,
                    trace_id.clone(),
                    config::meta::sql::MAX_LIMIT,
                    cached_resp,
                    deltas,
                    accumulated_results,
                    user_id,
                    max_query_range,
                    remaining_query_range,
                    &order_by,
                    &mut start_timer,
                )
                .instrument(ws_values_span.clone())
                .await?;
            } else {
                // Step 2: Search without cache
                // no caches found process req directly
                log::info!(
                    "[WS_VALUES] trace_id: {} No cache found, processing search request",
                    trace_id
                );
                let max_query_range =
                    get_max_query_range(&[stream_name.clone()], org_id, user_id, stream_type).await; // hours

                // Convert SearchRequest to SearchEventReq for compatibility with search functions
                let mut search_event_req = config::meta::websocket::SearchEventReq {
                    org_id: org_id.to_string(),
                    stream_type,
                    fallback_order_by_col: None,
                    search_type: search_req.search_type.unwrap_or(SearchEventType::Values),
                    search_event_context: None,
                    trace_id: trace_id.clone(),
                    use_cache: search_req.use_cache.unwrap_or(false),
                    payload: search_req.clone(),
                    user_id: Some(user_id.to_string()),
                    time_offset: None,
                    values_event_context: Some(ValuesEventContext {
                        top_k,
                        no_count,
                        field,
                    }),
                };

                do_partitioned_search(
                    request_id,
                    &mut search_event_req,
                    &trace_id,
                    config::meta::sql::MAX_LIMIT,
                    user_id,
                    accumulated_results,
                    max_query_range,
                    &mut start_timer,
                    &order_by,
                )
                .instrument(ws_values_span.clone())
                .await?;
            }
            // Step 3: Write to results cache
            // cache only if from is 0 and is not an aggregate_query
            if search_req.query.from == 0 {
                // Safely unwrap Option<i64> values with defaults
                let safe_start_time = start_time.unwrap_or(0);
                let safe_end_time = end_time.unwrap_or(0);

                write_results_to_cache(c_resp, safe_start_time, safe_end_time, accumulated_results)
                    .instrument(ws_values_span.clone())
                    .await
                    .map_err(|e| {
                        log::error!(
                            "[WS_VALUES] trace_id: {}, Error writing results to cache: {:?}",
                            trace_id,
                            e
                        );
                        e
                    })?;
            }
        } else {
            // Step 4: Search without cache for req with from > 0
            let max_query_range =
                get_max_query_range(&[stream_name.clone()], org_id, user_id, stream_type).await; // hours

            // Convert SearchRequest to SearchEventReq for compatibility with search functions
            let mut search_event_req = config::meta::websocket::SearchEventReq {
                org_id: org_id.to_string(),
                stream_type,
                fallback_order_by_col: None,
                search_type: search_req.search_type.unwrap_or(SearchEventType::Values),
                search_event_context: None,
                trace_id: trace_id.clone(),
                use_cache: search_req.use_cache.unwrap_or(false),
                payload: search_req.clone(),
                user_id: Some(user_id.to_string()),
                time_offset: None,
                values_event_context: Some(ValuesEventContext {
                    top_k,
                    no_count,
                    field,
                }),
            };

            do_partitioned_search(
                request_id,
                &mut search_event_req,
                &trace_id,
                config::meta::sql::MAX_LIMIT,
                user_id,
                accumulated_results,
                max_query_range,
                &mut start_timer,
                &order_by,
            )
            .instrument(ws_values_span.clone())
            .await?;
        }
    }

    // Once all searches are complete, write the accumulated results to a file
    log::info!("[WS_VALUES] trace_id {} all searches completed", trace_id);
    let end_res = WsServerEvents::End {
        trace_id: Some(trace_id.clone()),
    };
    send_message(request_id, end_res.to_json()).await?;

    Ok(())
}

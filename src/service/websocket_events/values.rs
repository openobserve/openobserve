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

use config::meta::search::ValuesRequest;
use crate::handler::http::request::search::build_search_request_per_field;
use config::get_config;
use chrono::DateTime;
use infra::errors::Error;
use std::collections::{BinaryHeap, HashMap};
use std::cmp::Reverse;

#[cfg(feature = "enterprise")]
use crate::service::websocket_events::enterprise_utils;
use crate::{
    common::utils::stream::get_max_query_range,
    handler::http::request::websocket::session::send_message,
    service::{
        search::{
            self as SearchService, cache, datafusion::distributed_plan::streaming_aggs_exec,
            sql::Sql,
        },
        websocket_events::{WsServerEvents, TimeOffset},
    },
};

pub async fn handle_values_request(
    org_id: &str,
    user_id: &str,
    request_id: &str,
    req: ValuesRequest,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let trace_id = req.trace_id.clone();
    let stream_type = req.stream_type;
    let start_time = req.start_time;
    let end_time = req.end_time;
    let stream_name = req.stream_name.clone();

    log::info!(
        "[WS_SEARCH] trace_id: {} Received values request, start_time: {}, end_time: {}",
        trace_id,
        DateTime::from_timestamp_micros(start_time.unwrap_or(0) / 1_000).map_or("None".to_string(), |dt| dt.to_string()),
        DateTime::from_timestamp_micros(end_time.unwrap_or(0) / 1_000).map_or("None".to_string(), |dt| dt.to_string())
    );

    // Check permissions for each stream
    #[cfg(feature = "enterprise")]
    {
        if let Err(e) =
            enterprise_utils::check_permissions(&stream_name, stream_type, user_id, org_id).await
        {
            let err_res = WsServerEvents::error_response(
                Error::Message(e),
                Some(request_id.to_string()),
                Some(trace_id),
                Default::default(),
            );
            send_message(request_id, err_res.to_json()).await?;
            return Ok(());
        }
    }

    // handle search result size
    let req_size = if req.size.is_none() {
        Some(cfg.limit.query_default_limit)
    } else {
        req.size
    };

    // get values req query
    let reqs = build_search_request_per_field(&req, org_id, stream_type, &stream_name).await?;

    for (req, stream_type) in reqs {
        let mut accumulated_results = Vec::new();
        let start_time = req.query.start_time;
        let end_time = req.query.end_time;
        let time_offset = TimeOffset {
            start_time,
            end_time,
        };
        
        if req.query.from == 0 {
            let c_resp =
                cache::check_cache_v2(&trace_id, org_id, stream_type, &req, req.use_cache.unwrap_or(false))
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
                "[WS_SEARCH] trace_id: {}, found cache responses len:{}, with hits: {}, cache_start_time: {:#?}, cache_end_time: {:#?}",
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
                    get_max_query_range(&stream_name, org_id, user_id, stream_type).await; // hours
                let remaining_query_range = if max_query_range == 0 {
                    i64::MAX
                } else {
                    max_query_range
                }; // hours

                // Process cached responses
                let mut hits_map: HashMap<String, i64> = HashMap::new();
                for cache_resp in cached_resp {
                    for hit in cache_resp.cached_response.hits {
                        if let Some(key) = hit.get("zo_sql_key") {
                            if let Some(key_str) = key.as_str() {
                                let num = hit
                                    .get("zo_sql_num")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(1);
                                *hits_map.entry(key_str.to_string()).or_insert(0) += num;
                            }
                        }
                    }
                }

                // Process hits for delta queries if needed
                if !deltas.is_empty() {
                    for delta in deltas {
                        let delta_req = req.clone();
                        let delta_resp = SearchService::cache::search(
                            &trace_id,
                            org_id,
                            stream_type,
                            Some(user_id.to_string()),
                            &delta_req,
                            "".to_string(),
                        ).await?;
                        
                        for hit in delta_resp.hits {
                            if let Some(key) = hit.get("zo_sql_key") {
                                if let Some(key_str) = key.as_str() {
                                    let num = hit
                                        .get("zo_sql_num")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(1);
                                    *hits_map.entry(key_str.to_string()).or_insert(0) += num;
                                }
                            }
                        }
                    }
                }

                // Create final response with top k items
                send_top_k_values(
                    request_id,
                    &trace_id,
                    time_offset.clone(),
                    hits_map,
                    &fields,
                    req_size.unwrap_or(10),
                    req.query.no_count.unwrap_or(false),
                ).await?;
            } else {
                // No cache, do direct search
                let max_query_range =
                    get_max_query_range(&stream_name, org_id, user_id, stream_type).await; // hours

                let resp = SearchService::cache::search(
                    &trace_id,
                    org_id,
                    stream_type,
                    Some(user_id.to_string()),
                    &req,
                    "".to_string(),
                ).await?;

                let mut hits_map: HashMap<String, i64> = HashMap::new();
                for hit in resp.hits {
                    if let Some(key) = hit.get("zo_sql_key") {
                        if let Some(key_str) = key.as_str() {
                            let num = hit
                                .get("zo_sql_num")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(1);
                            *hits_map.entry(key_str.to_string()).or_insert(0) += num;
                        }
                    }
                }

                // Send the results
                send_top_k_values(
                    request_id,
                    &trace_id,
                    time_offset.clone(),
                    hits_map,
                    &fields,
                    req_size.unwrap_or(10),
                    req.query.no_count.unwrap_or(false),
                ).await?;
            }
        } else {
            // Direct search for from > 0
            let resp = SearchService::cache::search(
                &trace_id,
                org_id,
                stream_type,
                Some(user_id.to_string()),
                &req,
                "".to_string(),
            ).await?;

            let mut hits_map: HashMap<String, i64> = HashMap::new();
            for hit in resp.hits {
                if let Some(key) = hit.get("zo_sql_key") {
                    if let Some(key_str) = key.as_str() {
                        let num = hit
                            .get("zo_sql_num")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(1);
                        *hits_map.entry(key_str.to_string()).or_insert(0) += num;
                    }
                }
            }

            // Send the results
            send_top_k_values(
                request_id,
                &trace_id,
                time_offset.clone(),
                hits_map,
                &fields,
                req_size.unwrap_or(10),
                req.query.no_count.unwrap_or(false),
            ).await?;
        }
    }

    // Once all searches are complete, send the end message
    log::info!("[WS_SEARCH] trace_id {} all values searches completed", trace_id);
    let end_res = WsServerEvents::End {
        trace_id: Some(trace_id.clone()),
    };
    send_message(request_id, end_res.to_json()).await?;

    Ok(())
}

// Helper function to send top-k values as a response
async fn send_top_k_values(
    request_id: &str,
    trace_id: &str,
    time_offset: TimeOffset,
    hits_map: HashMap<String, i64>,
    fields: &[String],
    size: i64,
    no_count: bool,
) -> Result<(), anyhow::Error> {
    let mut resp = config::meta::search::Response::default();
    let mut hit_values = Vec::new();

    for field in fields {
        let mut field_value = serde_json::Map::new();
        field_value.insert("field".to_string(), serde_json::Value::String(field.clone()));
        
        let values = if no_count {
            // For alphabetical sorting, collect all entries first
            let mut all_entries: Vec<_> = hits_map
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect();
            all_entries.sort_by(|a, b| a.0.cmp(&b.0));
            all_entries.truncate(size as usize);

            all_entries
                .into_iter()
                .map(|(k, v)| {
                    let mut item = serde_json::Map::new();
                    item.insert("zo_sql_key".to_string(), serde_json::Value::String(k));
                    item.insert("zo_sql_num".to_string(), serde_json::Value::Number(v.into()));
                    serde_json::Value::Object(item)
                })
                .collect::<Vec<_>>()
        } else {
            // For value-based sorting, use a min heap to get top k elements
            let mut min_heap: BinaryHeap<Reverse<(i64, String)>> = BinaryHeap::with_capacity(size as usize);

            for (k, v) in &hits_map {
                if min_heap.len() < size as usize {
                    // If heap not full, just add
                    min_heap.push(Reverse((*v, k.clone())));
                } else if !min_heap.is_empty() && *v > min_heap.peek().unwrap().0.0 {
                    // If current value is larger than smallest in heap, replace it
                    min_heap.pop();
                    min_heap.push(Reverse((*v, k.clone())));
                }
            }

            // Convert heap to vector and sort in descending order
            let mut top_elements: Vec<_> = min_heap
                .into_iter()
                .map(|Reverse((v, k))| (k, v))
                .collect();
            top_elements.sort_by(|a, b| b.1.cmp(&a.1));

            top_elements
                .into_iter()
                .map(|(k, v)| {
                    let mut item = serde_json::Map::new();
                    item.insert("zo_sql_key".to_string(), serde_json::Value::String(k));
                    item.insert("zo_sql_num".to_string(), serde_json::Value::Number(v.into()));
                    serde_json::Value::Object(item)
                })
                .collect::<Vec<_>>()
        };

        field_value.insert("values".to_string(), serde_json::Value::Array(values));
        hit_values.push(serde_json::Value::Object(field_value));
    }

    resp.total = fields.len();
    resp.hits = hit_values;
    resp.size = size;
    resp.took = 0; // Will be calculated by client

    let response = WsServerEvents::ValuesResponse {
        trace_id: trace_id.to_string(),
        results: Box::new(resp),
        time_offset,
    };

    send_message(request_id, response.to_json()).await?;
    Ok(())
}

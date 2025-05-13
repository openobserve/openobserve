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

use actix_web::{HttpRequest, HttpResponse, http::StatusCode, post, web};
use config::{
    get_config,
    meta::{
        search::{SearchEventType, StreamResponses, ValuesEventContext},
        sql::{OrderBy, resolve_stream_names},
    },
    utils::json,
};
use futures::stream::StreamExt;
use hashbrown::HashMap;
use log;
use tokio::sync::mpsc;
use tracing::Span;

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_stream_permissions;
use crate::{
    common::{
        meta::{self, http::HttpResponse as MetaHttpResponse},
        utils::{
            http::{
                get_fallback_order_by_col_from_request, get_or_create_trace_id,
                get_search_event_context_from_request, get_search_type_from_request,
                get_stream_type_from_request, get_use_cache_from_request,
            },
            websocket::update_histogram_interval_in_query,
        },
    },
    handler::http::request::search::{
        build_search_request_per_field, error_utils::map_error_to_http_response,
    },
    service::{search::search_stream::process_search_stream_request, setup_tracing_with_trace_id},
};

/// Search HTTP2 streaming endpoint
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchStreamHttp2",
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
    let cfg = get_config();
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

    let fallback_order_by_col = get_fallback_order_by_col_from_request(&query);

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
    #[cfg(feature = "enterprise")]
    for stream_name in stream_names.iter() {
        if let Some(res) =
            check_stream_permissions(stream_name, &org_id, &user_id, &stream_type).await
        {
            return res;
        }
    }

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

    // Create a channel for streaming results
    let (tx, rx) = mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);

    // Spawn the search task in a separate task
    actix_web::rt::spawn(process_search_stream_request(
        org_id.clone(),
        user_id,
        trace_id.clone(),
        req,
        stream_type,
        stream_names,
        req_order_by,
        search_span.clone(),
        tx,
        None,
        fallback_order_by_col,
    ));

    // Return streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!(
                    "[HTTP2_STREAM] trace_id: {} Error in stream: {}",
                    trace_id,
                    err
                );
                let err_res = match err {
                    infra::errors::Error::ErrorCode(ref code) => {
                        // if err code is cancelled return cancelled response
                        match code {
                            infra::errors::ErrorCodes::SearchCancelQuery(_) => {
                                StreamResponses::Cancelled
                            }
                            _ => {
                                let message = code.get_message();
                                let error_detail = code.get_error_detail();
                                let http_response =
                                    map_error_to_http_response(&err, None);

                                StreamResponses::Error {
                                    code: http_response.status().into(),
                                    message,
                                    error_detail: Some(error_detail),
                                }
                            }
                        }
                    }
                    _ => StreamResponses::Error {
                        code: 500,
                        message: err.to_string(),
                        error_detail: None,
                    },
                };
                err_res.to_chunks()
            }
        };

        // Convert the iterator to a stream only once
        futures::stream::iter(chunks_iter)
    });

    HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(stream)
}

/// Values  HTTP2 streaming endpoint
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "ValuesStreamHttp2",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Values query", content_type = "application/json", example = json!({
        "sql": "select * from logs LIMIT 10",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/_values_stream")]
pub async fn values_http2_stream(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> HttpResponse {
    let cfg = get_config();
    let org_id = org_id.into_inner();

    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_values_stream", org_id = org_id.clone())
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
    log::info!(
        "[trace_id: {}] Received values HTTP/2 stream request for org_id: {}",
        trace_id,
        org_id
    );

    // Get query params
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    // Parse the values request
    let mut values_req: config::meta::search::ValuesRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    let no_count = values_req.no_count;
    let top_k = values_req.size;

    // Get use_cache from query params
    values_req.use_cache = cfg.common.result_cache_enabled && get_use_cache_from_request(&query);

    // Build search requests per field and use only the first one
    let reqs = match build_search_request_per_field(
        &values_req,
        &org_id,
        stream_type,
        &values_req.stream_name,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    if reqs.is_empty() {
        return MetaHttpResponse::bad_request("No valid fields to process");
    }

    // Take only the first request
    let (req, stream_type, field_name) = reqs.into_iter().next().unwrap();

    // Get stream name directly from the values request
    let stream_names = vec![values_req.stream_name.clone()];

    // Check permissions for each stream
    #[cfg(feature = "enterprise")]
    for stream_name in stream_names.iter() {
        if let Some(res) =
            check_stream_permissions(stream_name, &org_id, &user_id, &stream_type).await
        {
            return res;
        }
    }

    let search_span = setup_tracing_with_trace_id(
        &trace_id,
        tracing::info_span!("service::search::values_stream_h2"),
    )
    .await;

    // Create a channel for streaming results
    let (tx, rx) =
        mpsc::channel::<Result<config::meta::search::StreamResponses, infra::errors::Error>>(100);

    let values_event_context = ValuesEventContext {
        field: field_name,
        top_k,
        no_count,
    };

    // Spawn the search task to process the request
    actix_web::rt::spawn(process_search_stream_request(
        org_id.clone(),
        user_id,
        trace_id.clone(),
        req,
        stream_type,
        stream_names,
        OrderBy::default(),
        search_span.clone(),
        tx,
        Some(values_event_context),
        None,
    ));

    // Return streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!(
                    "[HTTP2_STREAM] trace_id: {} Error in stream: {}",
                    trace_id,
                    err
                );
                let err_res = match err {
                    infra::errors::Error::ErrorCode(ref code) => {
                        let message = code.get_message();
                        let error_detail = code.get_error_detail();
                        let http_response = map_error_to_http_response(&err, None);

                        config::meta::search::StreamResponses::Error {
                            code: http_response.status().into(),
                            message,
                            error_detail: Some(error_detail),
                        }
                    }
                    _ => config::meta::search::StreamResponses::Error {
                        code: 500,
                        message: err.to_string(),
                        error_detail: None,
                    },
                };
                err_res.to_chunks()
            }
        };

        // Convert the iterator to a stream only once
        futures::stream::iter(chunks_iter)
    });

    HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(stream)
}

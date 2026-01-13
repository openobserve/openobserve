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

use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
#[cfg(feature = "enterprise")]
use axum::{http::StatusCode, response::IntoResponse};
use config::{
    get_config,
    meta::{
        search::{SearchEventType, StreamResponses, ValuesEventContext},
        sql::{OrderBy, resolve_stream_names},
        stream::StreamType,
    },
    utils::json,
};
use futures::stream::StreamExt;
use hashbrown::HashMap;
use log;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::{
    auditor::{AuditMessage, Protocol, ResponseMeta},
    config::get_config as get_o2_config,
};
use tokio::sync::mpsc;
use tracing::Span;

#[cfg(feature = "enterprise")]
use crate::common::utils::http::get_extract_patterns_from_request;
#[cfg(feature = "enterprise")]
use crate::{
    common::meta::search::AuditContext, common::utils::auth::check_permissions,
    handler::http::request::search::utils::check_stream_permissions,
    service::self_reporting::audit,
};
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            auth::UserEmail,
            http::{
                get_clear_cache_from_request, get_fallback_order_by_col_from_request,
                get_is_multi_stream_search_from_request, get_is_ui_histogram_from_request,
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
                get_use_cache_from_request,
            },
        },
    },
    handler::http::{
        extractors::Headers,
        request::search::{
            build_search_request_per_field, error_utils::map_error_to_http_response,
        },
    },
    service::{
        search::{streaming::process_search_stream_request, utils::is_permissable_function_error},
        setup_tracing_with_trace_id,
    },
};

/// Search HTTP2 streaming endpoint

#[utoipa::path(
    post,
    path = "/{org_id}/_search_stream",
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchStreamHttp2",
    summary = "Stream search results",
    description = "Executes a search query and streams the results back in real-time using HTTP/2 server-sent events. This is ideal for large result sets or long-running queries where you want to receive data as it becomes available rather than waiting for the complete response. Results are streamed as JSON objects separated by newlines.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("is_ui_histogram" = bool, Query, description = "Whether to return histogram data for UI"),
        ("is_multi_stream_search" = bool, Query, description = "Indicate is search is for multi stream"),
    ),
    request_body(content = String, description = "Search query", content_type = "application/json", example = json!({
        "sql": "select * from logs LIMIT 10",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn search_http2_stream(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let cfg = get_config();

    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_stream", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);

    let user_id = user_email.user_id;

    // Log the request
    log::debug!(
        "[HTTP2_STREAM trace_id {trace_id}] Received HTTP/2 stream request at handler for org_id: {org_id}"
    );

    #[cfg(feature = "enterprise")]
    let body_bytes = String::from_utf8_lossy(&body).to_string();

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let is_ui_histogram = get_is_ui_histogram_from_request(&query);
    let is_multi_stream_search = get_is_multi_stream_search_from_request(&query);
    #[cfg(feature = "enterprise")]
    let extract_patterns = get_extract_patterns_from_request(&query);
    #[cfg(not(feature = "enterprise"))]
    let extract_patterns = false;

    // Parse the search request
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_search_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
            }
            return http_response;
        }
    };

    if let Err(e) = req.decode() {
        #[cfg(feature = "enterprise")]
        let error_message = e.to_string();

        let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

        // Add audit before closing
        #[cfg(feature = "enterprise")]
        {
            report_to_audit(
                user_id,
                org_id.clone(),
                trace_id,
                http_response.status().into(),
                Some(error_message),
                "POST".to_string(),
                format!("/api/{}/streams", org_id),
                query
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&"),
                body_bytes,
            )
            .await;
        }
        return http_response;
    }

    // Sampling is not available for /_search_stream endpoint
    if req.query.sampling_config.is_some() || req.query.sampling_ratio.is_some() {
        log::warn!(
            "[trace_id {}] Sampling is not available for /_search_stream endpoint. Ignoring sampling parameters.",
            trace_id
        );
        req.query.sampling_config = None;
        req.query.sampling_ratio = None;
    }

    // get stream name
    let stream_names = match resolve_stream_names(&req.query.sql) {
        Ok(v) => v.clone(),
        Err(e) => {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_search_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
            }
            return http_response;
        }
    };
    #[cfg(feature = "enterprise")]
    for stream in stream_names.iter() {
        if let Err(e) = crate::service::search::check_search_allowed(&org_id, Some(stream)) {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                axum::Json(MetaHttpResponse::error(
                    StatusCode::TOO_MANY_REQUESTS,
                    e.to_string(),
                )),
            )
                .into_response();
        }
    }

    let mut sql = match get_sql(&req.query, &org_id, stream_type, req.search_type).await {
        Ok(sql) => sql,
        Err(e) => {
            log::error!("[trace_id: {trace_id}] Error getting histogram interval: {e:?}");

            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&e, Some(trace_id.clone()));

            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_search_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
            }
            return http_response;
        }
    };
    // Update histogram interval -- initial interval assignment
    // Need to calculate the histogram interval before converting the query to a histogram query
    // when `is_ui_histogram` is true. This is because if a query is already a histogram query
    // with interval, for http2 streaming at the point of converting the query to a
    // histogram query the interval will be generated again and not honor the original interval
    // mentioned in the query.
    if let Some(interval) = sql.histogram_interval {
        req.query.histogram_interval = interval;
    }

    // Convert the original query to a histogram query
    let mut converted_histogram_query: Option<String> = None;
    if is_ui_histogram {
        // Convert the original query to a histogram query
        match crate::service::search::sql::histogram::convert_to_histogram_query(
            &req.query.sql,
            &stream_names,
            is_multi_stream_search,
        ) {
            Ok(histogram_query) => {
                req.query.sql = histogram_query;
                converted_histogram_query = Some(req.query.sql.clone());
                // Recalculate histogram interval
                // The sql object needs to be updated as well
                // Since the original query is now converted to a histogram query
                // and the histogram interval needs to be recalculated
                // and order by would be also be modified
                sql = match get_sql(&req.query, &org_id, stream_type, req.search_type).await {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("[trace_id: {trace_id}] Error parsing sql: {e:?}");

                        #[cfg(feature = "enterprise")]
                        let error_message = e.to_string();

                        let http_response = map_error_to_http_response(&e, Some(trace_id.clone()));

                        // Add audit before closing
                        #[cfg(feature = "enterprise")]
                        {
                            report_to_audit(
                                user_id,
                                org_id.clone(),
                                trace_id,
                                http_response.status().into(),
                                Some(error_message),
                                "POST".to_string(),
                                format!("/api/{}/_search_stream", org_id),
                                query
                                    .iter()
                                    .map(|(k, v)| format!("{}={}", k, v))
                                    .collect::<Vec<_>>()
                                    .join("&"),
                                body_bytes,
                            )
                            .await;
                        }
                        return http_response;
                    }
                };
                // Update histogram interval -- second occurrence of histogram interval
                if let Some(interval) = sql.histogram_interval {
                    req.query.histogram_interval = interval;
                }
            }
            Err(e) => {
                return map_error_to_http_response(&(e), Some(trace_id));
            }
        }
    }

    // Check if user has edit permissions when clear_cache is requested
    #[cfg(feature = "enterprise")]
    if get_clear_cache_from_request(&query) {
        for stream_name in stream_names.iter() {
            if !check_permissions(
                stream_name,
                &org_id,
                &user_id,
                stream_type.as_str(),
                "PUT",
                None,
            )
            .await
            {
                // Add audit before closing
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    403,
                    Some(
                        "Unauthorized to clear cache - requires stream edit permission".to_string(),
                    ),
                    "POST".to_string(),
                    format!("/api/{}/_search_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
    }

    // Set use_cache from query params
    req.clear_cache = get_clear_cache_from_request(&query);
    req.use_cache = get_use_cache_from_request(&query) && !req.clear_cache;

    // Set search type if not set
    if req.search_type.is_none() {
        req.search_type = match get_search_type_from_request(&query) {
            Ok(v) => v,
            Err(e) => {
                #[cfg(feature = "enterprise")]
                let error_message = e.to_string();

                let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

                // Add audit before closing
                #[cfg(feature = "enterprise")]
                {
                    report_to_audit(
                        user_id,
                        org_id.clone(),
                        trace_id,
                        http_response.status().into(),
                        Some(error_message),
                        "POST".to_string(),
                        format!("/api/{}/_search_stream", org_id),
                        query
                            .iter()
                            .map(|(k, v)| format!("{}={}", k, v))
                            .collect::<Vec<_>>()
                            .join("&"),
                        body_bytes,
                    )
                    .await;
                }
                return http_response;
            }
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

    // Check permissions for each stream
    #[cfg(feature = "enterprise")]
    for stream_name in stream_names.iter() {
        if let Some(res) =
            check_stream_permissions(stream_name, &org_id, &user_id, &stream_type).await
        {
            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    res.status().into(),
                    Some("Unauthorized Access".to_string()),
                    "POST".to_string(),
                    format!("/api/{}/_search_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
            }
            return res;
        }
    }

    // Hack for limit in query
    if sql.limit != 0 {
        req.query.size = sql.limit;
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

    #[cfg(feature = "enterprise")]
    let audit_ctx = Some(AuditContext {
        method: "POST".to_string(),
        path: format!("/api/{}/streams", org_id),
        query_params: query
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&"),
        body: body_bytes,
    });
    #[cfg(not(feature = "enterprise"))]
    let audit_ctx = None;
    let search_type = req.search_type;

    // Spawn the search task in a separate task
    tokio::spawn(process_search_stream_request(
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
        audit_ctx,
        is_multi_stream_search,
        extract_patterns,
    ));

    // Return streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(mut v) => {
                // Check if function error is only - query limit default error and only `ui`
                if let StreamResponses::SearchResponse {
                    ref mut results, ..
                } = v
                    && search_type == Some(SearchEventType::UI)
                    && is_permissable_function_error(&results.function_error)
                {
                    results.function_error.clear();
                    results.is_partial = false;
                }

                if is_ui_histogram
                    && let StreamResponses::SearchResponse {
                        ref mut results, ..
                    } = v
                {
                    results.converted_histogram_query = converted_histogram_query.clone();
                }
                v.to_chunks()
            }
            Err(err) => {
                log::error!("[HTTP2_STREAM trace_id {trace_id}] Error in search stream: {err}");
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
                                let http_response = map_error_to_http_response(&err, None);

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

    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
pub async fn report_to_audit(
    user_id: String,
    org_id: String,
    trace_id: String,
    code: u16,
    error_message: Option<String>,
    http_method: String,
    http_path: String,
    http_query_params: String,
    req_body: String,
) {
    let is_audit_enabled = get_o2_config().common.audit_enabled;
    if is_audit_enabled {
        // Using spawn to handle the async call
        audit(AuditMessage {
            user_email: user_id,
            org_id,
            _timestamp: chrono::Utc::now().timestamp(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method,
                http_path,
                http_query_params,
                http_body: req_body,
                http_response_code: code,
                error_msg: error_message,
                trace_id: Some(trace_id.to_string()),
            },
        })
        .await;
    }
}

/// Values  HTTP2 streaming endpoint

#[utoipa::path(
    post,
    path = "/{org_id}/_values_stream",
    context_path = "/api",
    tag = "Search",
    operation_id = "ValuesStreamHttp2",
    summary = "Get field values with HTTP/2 streaming",
    description = "Retrieves field values from logs using HTTP/2 streaming for real-time results",
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
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn values_http2_stream(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let cfg = get_config();

    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_values_stream", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);

    let user_id = user_email.user_id;

    // Log the request
    log::debug!(
        "[HTTP2_STREAM trace_id {trace_id}] Received values HTTP/2 stream request for org_id: {org_id}"
    );

    let mut stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    #[cfg(feature = "enterprise")]
    let body_bytes = String::from_utf8_lossy(&body).to_string();

    // Parse the values request
    let mut values_req: config::meta::search::ValuesRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_values_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes,
                )
                .await;
            }
            return http_response;
        }
    };
    // check default values limit
    if values_req.size.is_none() {
        values_req.size = Some(config::get_config().limit.query_values_default_num);
    }
    let no_count = values_req.no_count;
    let top_k = values_req.size;

    // check stream type from request
    if values_req.stream_type != stream_type {
        stream_type = values_req.stream_type;
    }

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) =
            crate::service::search::check_search_allowed(&org_id, Some(&values_req.stream_name))
        {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                axum::Json(MetaHttpResponse::error(
                    StatusCode::TOO_MANY_REQUESTS,
                    e.to_string(),
                )),
            )
                .into_response();
        }
    }

    // Get use_cache from query params
    values_req.use_cache = get_use_cache_from_request(&query);

    let keyword = match query.get("keyword") {
        None => "".to_string(),
        Some(v) => v.trim().to_string(),
    };
    // Build search requests per field and use only the first one
    let reqs = match build_search_request_per_field(
        &values_req,
        &org_id,
        stream_type,
        &values_req.stream_name,
        &keyword,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_values_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes.clone(),
                )
                .await;
            }
            return http_response;
        }
    };
    if reqs.is_empty() {
        let http_response = MetaHttpResponse::bad_request("No valid fields to process");
        // Add audit before closing
        #[cfg(feature = "enterprise")]
        {
            report_to_audit(
                user_id,
                org_id.clone(),
                trace_id,
                http_response.status().into(),
                Some("No valid fields to process".to_string()),
                "POST".to_string(),
                format!("/api/{}/_values_stream", org_id),
                query
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&"),
                body_bytes.clone(),
            )
            .await;
        }
        return http_response;
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
            // Add audit before closing
            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    res.status().into(),
                    Some("Unauthorized Access".to_string()),
                    "POST".to_string(),
                    format!("/api/{}/_values_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes.clone(),
                )
                .await;
            }
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

    #[cfg(feature = "enterprise")]
    let audit_ctx = Some(AuditContext {
        method: "POST".to_string(),
        path: format!("/api/{}/streams", org_id),
        query_params: query
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&"),
        body: body_bytes,
    });
    #[cfg(not(feature = "enterprise"))]
    let audit_ctx = None;

    // Pattern extraction is not supported for values endpoint
    let extract_patterns = false;

    // Spawn the search task to process the request
    tokio::spawn(process_search_stream_request(
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
        audit_ctx,
        false,
        extract_patterns,
    ));

    // Return streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!("[HTTP2_STREAM trace_id {trace_id}] Error in values stream: {err}");
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

    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

// Helper function to get histogram interval from sql query
async fn get_sql(
    query: &config::meta::search::Query,
    org_id: &str,
    stream_type: StreamType,
    search_type: Option<SearchEventType>,
) -> Result<crate::service::search::sql::Sql, infra::errors::Error> {
    crate::service::search::sql::Sql::new(&query.clone().into(), org_id, stream_type, search_type)
        .await
}

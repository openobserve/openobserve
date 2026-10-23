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

pub mod dag;
pub mod details;
mod list;
pub(crate) mod schema_compat;
pub mod session;
pub mod time_index;
pub mod user;

use axum::{
    body::Bytes,
    extract::Path,
    http::{self, HeaderMap},
    response::Response,
};
use config::{
    axum::middlewares::{get_process_time, insert_process_time_header},
    get_config,
    meta::{otlp::OtlpRequestType, search::PaginatedResponse, stream::StreamType},
    metrics,
    utils::json,
};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "cloud")]
use openobserve_core::ingestion::check_ingestion_allowed;
pub use openobserve_core::traces::{
    agent_signals::{compare_agent_versions, get_agent_signals},
    service_graph::{self, get_current_topology, get_edge_history},
};
use openobserve_core::{auth::UserEmail, traces};
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::{
            http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, HttpResponse as MetaHttpResponse},
            otlp::{otlp_error_response, otlp_rejection_response},
        },
        utils::http::get_or_create_trace_id,
    },
    search::error_utils::map_error_to_http_response,
};

pub(crate) async fn check_stream_permissions(
    org_id: &str,
    stream_name: &str,
    user_id: &str,
) -> Option<Response> {
    #[cfg(feature = "enterprise")]
    {
        return openobserve_core::authz::check_stream_permissions(
            stream_name,
            org_id,
            user_id,
            &StreamType::Traces,
            openobserve_core::authz::StreamPermissionResourceType::Search,
        )
        .await;
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, stream_name, user_id);
        None
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/v1/traces",
    context_path = "/api",
    tag = "Traces",
    operation_id = "PostTraces",
    summary = "Ingest trace data",
    description = "Accepts and processes distributed tracing data from applications and services. Supports both Protocol Buffers and JSON formats for OTLP (OpenTelemetry Protocol) trace ingestion. Use this endpoint to send trace spans, timing information, and service dependency data for observability and performance monitoring.",
    security(
        ("Authorization"= [])
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(description = "ExportTraceServiceRequest", content(("application/x-protobuf"), (Object = "application/json"))),
    responses(
        (status = 200, description = "ExportTraceServiceResponse", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 206, description = "ExportTraceServiceResponse with a partial success (JSON requests only)", content((Object = "application/json"))),
        (status = 400, description = "google.rpc.Status: invalid body, unsupported Content-Type, or write rejected (e.g. columns limit)", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 429, description = "google.rpc.Status: trial period expired", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 500, description = "google.rpc.Status: internal write error", content(("application/x-protobuf"), (Object = "application/json"))),
        (status = 503, description = "google.rpc.Status: ingester overloaded or unavailable, or ingestion not allowed (cloud)", content(("application/x-protobuf"), (Object = "application/json"))),
    )
)]
pub async fn traces_write(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let process_time = get_process_time();

    let user = ingestion_common::IngestUser::from_user_email(&user_email.user_id);

    let cfg = get_config();
    let content_type = headers
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/json");
    let req_type = if content_type.eq(CONTENT_TYPE_PROTO) {
        OtlpRequestType::HttpProtobuf
    } else {
        OtlpRequestType::HttpJson
    };

    #[cfg(feature = "cloud")]
    if let Err(e) = check_ingestion_allowed(&org_id, StreamType::Traces, None).await {
        let status = if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            http::StatusCode::TOO_MANY_REQUESTS
        } else {
            http::StatusCode::SERVICE_UNAVAILABLE
        };
        return otlp_rejection_response(req_type, status, e.to_string());
    }

    let org_id = if let Some(Some(v)) = headers
        .get(&cfg.grpc.org_header_key)
        .map(|header| header.to_str().ok())
    {
        v.to_string()
    } else {
        org_id
    };
    let in_stream_name = headers
        .get(&cfg.grpc.stream_header_key)
        .and_then(|header| header.to_str().ok());

    let result = if content_type.eq(CONTENT_TYPE_PROTO) {
        traces::otlp_proto(&org_id, body, in_stream_name, user).await
    } else if content_type.starts_with(CONTENT_TYPE_JSON) {
        traces::otlp_json(&org_id, body, in_stream_name, user).await
    } else {
        return otlp_error_response(
            OtlpRequestType::HttpJson,
            http::StatusCode::BAD_REQUEST,
            3, // INVALID_ARGUMENT
            "Bad Request: Content-Type must be application/json or application/x-protobuf",
        );
    };

    match result {
        Ok(mut resp) => {
            insert_process_time_header(process_time, resp.headers_mut());
            resp
        }
        Err(e) => otlp_rejection_response(req_type, http::StatusCode::BAD_REQUEST, e.to_string()),
    }
}

/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/latest",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestTraces",
    summary = "Get recent trace data",
    description = "Retrieves the most recent trace data from a specific stream within a time range. Returns trace summaries including trace IDs, span counts, service names, and timing information. You can filter results and control pagination to analyze distributed system performance and identify bottlenecks or errors in your applications.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("filter" = Option<String>, Query, description = "filter, eg: a=b AND c=d"),
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
        ("sort_by" = Option<String>, Query, description = "sort by field: start_time, duration (default: start_time)"),
        ("sort_order" = Option<String>, Query, description = "sort order: asc, desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "hits": [
                {
                    "trace_id": "12345678",
                    "spans": [1, 2],
                    "service_name": [{"job1": 1, "job2": 0}],
                    "first_event": {
                        "start_time": 1234567890,
                        "operation_name": "operation_name"
                    }
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "List recent traces with summaries (trace_id, span count, service names, duration). Supports filter and sort by start_time/duration.", "category": "traces", "pinned": true}))
    )
)]
pub async fn get_latest_traces(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    {
        // the request's SQL or filter may read streams other than the one it names
        if let Err(e) = search_service::check_search_allowed(&org_id, None) {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, trace_id) = if cfg.common.should_create_span() {
        let uuid_v7_trace_id = config::ider::generate_trace_id();
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/traces/latest",
            org_id = org_id.clone(),
            stream_name = stream_name.clone(),
            trace_id = uuid_v7_trace_id.clone()
        );

        (span, uuid_v7_trace_id)
    } else {
        let trace_id = get_or_create_trace_id(&headers, &Span::none());
        (Span::none(), trace_id)
    };
    let user_id = &user_email.user_id;

    if let Some(response) = check_stream_permissions(&org_id, &stream_name, user_id).await {
        return response;
    }

    let plan = match list::prepare(
        &org_id,
        &stream_name,
        user_id,
        &query,
        list::TraceListMode::Complete,
    )
    .await
    {
        Ok(plan) => plan,
        Err(response) => return response,
    };
    let context = list::TraceSearchContext::new(
        org_id.clone(),
        stream_name,
        user_id.to_string(),
        trace_id.clone(),
    );
    let result = match list::run(&context, &plan).instrument(http_span).await {
        Ok(result) => result,
        Err(err) => {
            record_latest_traces_metrics(&org_id, "500", start.elapsed().as_secs_f64());
            return map_error_to_http_response(&err, Some(trace_id));
        }
    };
    let batch = match result {
        list::TraceListResult::Empty(response) => return MetaHttpResponse::json(response),
        list::TraceListResult::Complete(batch) => batch,
    };
    let traces = batch.into_sorted_items(plan.sort);
    let time = start.elapsed().as_secs_f64();
    record_latest_traces_metrics(&org_id, "200", time);
    MetaHttpResponse::json(PaginatedResponse {
        took: (time * 1000.0) as usize,
        total: traces.len(),
        from: plan.options.from,
        size: plan.options.size,
        hits: traces
            .into_iter()
            .map(|trace| json::to_value(trace).unwrap())
            .collect(),
        trace_id,
        function_error: plan.options.range_error.clone(),
    })
}

/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/latest_stream",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetLatestTracesStream",
    summary = "Stream recent trace data",
    description = "Streams the most recent trace data from a specific stream within a time range using HTTP/2 server-sent events. Results are returned progressively as each time partition is processed, reducing time-to-first-result for large time ranges.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("filter" = Option<String>, Query, description = "filter, eg: a=b AND c=d"),
        ("from" = i64, Query, description = "from"),
        ("size" = i64, Query, description = "size"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
        ("sort_by" = Option<String>, Query, description = "sort by field: start_time, duration (default: start_time)"),
        ("sort_order" = Option<String>, Query, description = "sort order: asc, desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_latest_traces_stream(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    {
        // the request's SQL or filter may read streams other than the one it names
        if let Err(e) = search_service::check_search_allowed(&org_id, None) {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, trace_id) = if cfg.common.should_create_span() {
        let uuid_v7_trace_id = config::ider::generate_trace_id();
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/traces/latest_stream",
            org_id = org_id.clone(),
            stream_name = stream_name.clone(),
            trace_id = uuid_v7_trace_id.clone()
        );
        (span, uuid_v7_trace_id)
    } else {
        let trace_id = get_or_create_trace_id(&headers, &Span::none());
        (Span::none(), trace_id)
    };
    let user_id = &user_email.user_id;

    if let Some(response) = check_stream_permissions(&org_id, &stream_name, user_id).await {
        return response;
    }

    let plan = match list::prepare(
        &org_id,
        &stream_name,
        user_id,
        &query,
        list::TraceListMode::Streaming,
    )
    .await
    {
        Ok(plan) => plan,
        Err(response) => return response,
    };
    let context = list::TraceSearchContext::new(org_id, stream_name, user_id.to_string(), trace_id);
    list::stream_response(context, plan, http_span)
}

fn record_latest_traces_metrics(org_id: &str, status: &str, elapsed: f64) {
    let labels = [
        "/api/org/traces/latest",
        status,
        org_id,
        StreamType::Traces.as_str(),
        "",
        "",
    ];
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(elapsed);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(feature = "cloud"))]
    async fn call_traces_write(
        content_type: &str,
        body: &'static [u8],
    ) -> (http::StatusCode, HeaderMap, json::Value) {
        let mut headers = HeaderMap::new();
        headers.insert(http::header::CONTENT_TYPE, content_type.parse().unwrap());
        let resp = traces_write(
            Path("default".to_string()),
            Headers(UserEmail {
                user_id: "a@a.com".to_string(),
            }),
            headers,
            Bytes::from_static(body),
        )
        .await;
        let status = resp.status();
        let resp_headers = resp.headers().clone();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, resp_headers, json::from_slice(&body).unwrap())
    }

    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn test_traces_write_invalid_json_is_rpc_status() {
        let (status, headers, body) = call_traces_write(CONTENT_TYPE_JSON, b"{not json").await;
        assert_eq!(status, http::StatusCode::BAD_REQUEST);
        assert_eq!(headers[http::header::CONTENT_TYPE], CONTENT_TYPE_JSON);
        assert_eq!(body["code"], 3);
        assert!(
            body["message"]
                .as_str()
                .unwrap()
                .starts_with("Invalid json:")
        );
    }

    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn test_traces_write_unsupported_content_type_is_rpc_status() {
        let (status, headers, body) = call_traces_write("text/plain", b"hello").await;
        assert_eq!(status, http::StatusCode::BAD_REQUEST);
        assert_eq!(headers[http::header::CONTENT_TYPE], CONTENT_TYPE_JSON);
        assert_eq!(body["code"], 3);
        let message = body["message"].as_str().unwrap();
        assert!(message.contains(CONTENT_TYPE_JSON) && message.contains(CONTENT_TYPE_PROTO));
    }
}

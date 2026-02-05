// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use axum::{extract::Path, http::HeaderMap, response::Response};
use config::{get_config, meta::stream::StreamType, metrics, utils::json};
use hashbrown::HashMap;
use serde::Serialize;
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            auth::UserEmail,
            http::{get_or_create_trace_id, get_use_cache_from_request},
        },
    },
    handler::http::{
        extractors::Headers, request::search::error_utils::map_error_to_http_response,
    },
    service::search as SearchService,
};

/// GetTraceDAG
///
/// #{"ratelimit_module":"Traces", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/traces/{trace_id}/dag",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetTraceDAG",
    summary = "Get trace DAG structure",
    description = "Retrieves the DAG (Directed Acyclic Graph) structure of all spans for a specific trace. Returns nodes (spans) and edges (parent-child relationships) that can be visualized as a trace execution graph. Each node contains span details like service name, operation, and status information.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("trace_id" = String, Path, description = "Trace ID"),
        ("start_time" = i64, Query, description = "start time in microseconds"),
        ("end_time" = i64, Query, description = "end time in microseconds"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "trace_id": "12345678",
            "nodes": [
                {
                    "span_id": "span1",
                    "parent_span_id": null,
                    "service_name": "frontend",
                    "operation_name": "GET /api",
                    "span_status": "OK"
                }
            ],
            "edges": [
                {
                    "from": "span1",
                    "to": "span2"
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_trace_dag(
    Path((org_id, stream_name, trace_id)): Path<(String, String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = crate::service::search::check_search_allowed(&org_id, Some(&stream_name)) {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, internal_trace_id) = if cfg.common.tracing_search_enabled {
        let uuid_v7_trace_id = config::ider::generate_trace_id();
        let span = tracing::info_span!(
            "/api/{org_id}/{stream_name}/traces/{trace_id}/dag",
            org_id = org_id.clone(),
            stream_name = stream_name.clone(),
            trace_id = uuid_v7_trace_id.clone()
        );

        (span, uuid_v7_trace_id)
    } else {
        let internal_trace_id = get_or_create_trace_id(&headers, &Span::none());
        (Span::none(), internal_trace_id)
    };
    let user_id = &user_email.user_id;

    // Check permissions on stream
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::users::get_user,
        };
        if !is_root_user(user_id) {
            let user: config::meta::user::User = get_user(Some(&org_id), user_id).await.unwrap();
            let stream_type_str = StreamType::Traces.as_str();

            if !crate::handler::http::auth::validator::check_permissions(
                user_id,
                AuthExtractor {
                    auth: "".to_string(),
                    method: "GET".to_string(),
                    o2_type: format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(stream_type_str)
                            .map_or(stream_type_str, |model| model.key),
                        stream_name
                    ),
                    org_id: org_id.clone(),
                    bypass_check: false,
                    parent_id: "".to_string(),
                },
                user.role,
                user.is_external,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
        // Check permissions on stream ends
    }

    // Parse required start_time and end_time from query parameters
    let start_time = match query.get("start_time") {
        Some(v) => match v.parse::<i64>() {
            Ok(val) => val,
            Err(_) => return MetaHttpResponse::bad_request("Invalid start_time parameter"),
        },
        None => return MetaHttpResponse::bad_request("start_time parameter is required"),
    };

    let end_time = match query.get("end_time") {
        Some(v) => match v.parse::<i64>() {
            Ok(val) => val,
            Err(_) => return MetaHttpResponse::bad_request("Invalid end_time parameter"),
        },
        None => return MetaHttpResponse::bad_request("end_time parameter is required"),
    };

    // Validate time range
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be less than end_time");
    }

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // Query all spans for this trace_id
    let query_sql = format!(
        "SELECT span_id, trace_id, service_name, operation_name, span_status, \
         reference_parent_span_id, start_time, end_time \
         FROM {stream_name} \
         WHERE trace_id = '{trace_id}'"
    );

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.to_string(),
            from: 0,
            size: 10000, // Large enough for most traces
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            action_id: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout,
        search_type: None,
        search_event_context: None,
        use_cache: get_use_cache_from_request(&query),
        clear_cache: false,
        local_mode: None,
    };

    let stream_type = StreamType::Traces;
    let user_id_opt = Some(user_id.to_string());

    let search_res = SearchService::cache::search(
        &internal_trace_id,
        &org_id,
        stream_type,
        user_id_opt,
        &req,
        "".to_string(),
        false,
        None,
        false,
    )
    .instrument(http_span)
    .await;

    let resp_search = match search_res {
        Ok(res) => res,
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/traces/dag",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/traces/dag",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("get trace dag data error: {err:?}");
            return map_error_to_http_response(&err, Some(internal_trace_id));
        }
    };

    if resp_search.hits.is_empty() {
        return MetaHttpResponse::not_found("Trace not found");
    }

    // Build DAG structure
    let mut nodes: Vec<SpanNode> = Vec::with_capacity(resp_search.hits.len());
    let mut edges: Vec<SpanEdge> = Vec::new();

    for item in resp_search.hits {
        let span_id = item
            .get("span_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let parent_span_id = item
            .get("reference_parent_span_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        // Create node
        let node = SpanNode {
            span_id: span_id.clone(),
            parent_span_id: parent_span_id.clone(),
            service_name: item
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            operation_name: item
                .get("operation_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            span_status: item
                .get("span_status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            start_time: item.get("start_time").and_then(|v| v.as_i64()).unwrap_or(0),
            end_time: item.get("end_time").and_then(|v| v.as_i64()).unwrap_or(0),
        };
        nodes.push(node);

        // Create edge if there's a parent
        if let Some(parent_id) = parent_span_id {
            edges.push(SpanEdge {
                from: parent_id,
                to: span_id,
            });
        }
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/traces/dag",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/traces/dag",
            "200",
            &org_id,
            stream_type.as_str(),
            "",
            "",
        ])
        .inc();

    let mut resp: HashMap<&str, json::Value> = HashMap::new();
    resp.insert("took", json::Value::from((time * 1000.0) as usize));
    resp.insert("trace_id", json::Value::from(trace_id));
    resp.insert("nodes", json::to_value(nodes).unwrap());
    resp.insert("edges", json::to_value(edges).unwrap());
    resp.insert("internal_trace_id", json::Value::from(internal_trace_id));

    MetaHttpResponse::json(resp)
}

#[derive(Debug, Serialize)]
struct SpanNode {
    span_id: String,
    parent_span_id: Option<String>,
    service_name: String,
    operation_name: String,
    span_status: String,
    start_time: i64,
    end_time: i64,
}

#[derive(Debug, Serialize)]
struct SpanEdge {
    from: String,
    to: String,
}

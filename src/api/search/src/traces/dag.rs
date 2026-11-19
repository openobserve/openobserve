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
use config::{
    get_config,
    meta::{
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
    metrics,
    utils::json,
};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use serde::Serialize;
use tracing::{Instrument, Span};

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::http::{get_or_create_trace_id, get_use_cache_from_request},
    },
    search::error_utils::map_error_to_http_response,
};

/// Spans a DAG returns when the caller sends no `size`, and the most it may ask for.
const DAG_MAX_SPANS: i64 = 10_000;

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
        ("size" = Option<i64>, Query, description = "Most spans to return (default and maximum 10000); a cut result sets is_partial and has_more"),
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
            ],
            "is_partial": false,
            "has_more": false,
            "new_start_time": 1700000000000000_i64,
            "new_end_time": 1700000600000000_i64
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"description": "Get the span DAG (nodes and parent-child edges) for a specific trace by trace_id.", "category": "traces"})),
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "list"}))
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
        if let Err(e) =
            search_service::check_search_allowed(&org_id, Some((&stream_name, StreamType::Traces)))
        {
            return MetaHttpResponse::too_many_requests(e.to_string());
        }
    }

    let (http_span, internal_trace_id) = if cfg.common.should_create_span() {
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

    if let Some(response) = super::check_stream_permissions(&org_id, &stream_name, user_id).await {
        return response;
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

    let size = match parse_dag_size(query.get("size").map(String::as_str)) {
        Ok(size) => size,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };

    // Check whether reference_parent_span_id exists in the stream schema.
    // If missing, omit it from the SELECT to avoid query errors; the DAG
    // will still show all spans but without parent-child edges.
    let has_ref_parent_id = infra::schema::get_stream_schema_from_cache(
        org_id.as_str(),
        stream_name.as_str(),
        StreamType::Traces,
    )
    .await
    .map(|s| s.field_with_name("reference_parent_span_id").is_ok())
    .unwrap_or(false);

    let query_sql = build_trace_dag_sql(&stream_name, &trace_id, has_ref_parent_id);

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.to_string(),
            // One extra row tells a cut trace from one that fits exactly.
            size: size + 1,
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout,
        search_type: None,
        search_event_context: None,
        use_cache: get_use_cache_from_request(&query),
        use_index: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
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
    let server_partial = resp_search.is_partial;
    let (hits, cut) = cut_hits(resp_search.hits, size);

    // Build DAG structure
    let mut nodes: Vec<SpanNode> = Vec::with_capacity(hits.len());
    let mut edges: Vec<SpanEdge> = Vec::new();

    for item in hits {
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
            gen_ai_operation_name: item
                .get("gen_ai_operation_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
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
    resp.insert("is_partial", json::Value::from(server_partial || cut));
    resp.insert("has_more", json::Value::from(cut));
    resp.insert("new_start_time", json::Value::from(start_time));
    resp.insert("new_end_time", json::Value::from(end_time));

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
    gen_ai_operation_name: Option<String>,
}

#[derive(Debug, Serialize)]
struct SpanEdge {
    from: String,
    to: String,
}

/// `size` must be a positive integer; it is capped at [DAG_MAX_SPANS].
fn parse_dag_size(raw: Option<&str>) -> Result<i64, &'static str> {
    match raw {
        None => Ok(DAG_MAX_SPANS),
        Some(v) => match v.parse::<i64>() {
            Ok(size) if size > 0 => Ok(size.min(DAG_MAX_SPANS)),
            _ => Err("size must be a positive integer"),
        },
    }
}

/// Keeps the first `size` hits in upstream order; `true` when any were dropped.
fn cut_hits(mut hits: Vec<json::Value>, size: i64) -> (Vec<json::Value>, bool) {
    let keep = usize::try_from(size).unwrap_or(usize::MAX);
    let cut = hits.len() > keep;
    hits.truncate(keep);
    (hits, cut)
}

fn build_trace_dag_sql(stream_name: &str, trace_id: &str, has_ref_parent_id: bool) -> String {
    let ref_parent_col = if has_ref_parent_id {
        "reference_parent_span_id, "
    } else {
        ""
    };
    format!(
        "SELECT span_id, trace_id, service_name, operation_name, span_status, \
         {ref_parent_col}start_time, end_time, gen_ai_operation_name \
         FROM {} \
         WHERE trace_id = {}",
        quote_identifier(stream_name),
        quote_sql_string(trace_id),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_trace_dag_sql_quotes_stream_and_trace_id() {
        let sql = build_trace_dag_sql("default", "abc123", true);
        assert_eq!(
            sql,
            "SELECT span_id, trace_id, service_name, operation_name, span_status, \
             reference_parent_span_id, start_time, end_time, gen_ai_operation_name \
             FROM \"default\" WHERE trace_id = 'abc123'"
        );
    }

    #[test]
    fn test_build_trace_dag_sql_omits_missing_ref_parent_column() {
        let sql = build_trace_dag_sql("default", "abc123", false);
        assert!(!sql.contains("reference_parent_span_id"));
        assert!(sql.contains("span_status, start_time"));
    }

    #[test]
    fn test_build_trace_dag_sql_escapes_quote_in_trace_id() {
        let sql = build_trace_dag_sql("default", "abc' OR '1'='1", false);
        assert!(sql.ends_with("WHERE trace_id = 'abc'' OR ''1''=''1'"));
    }

    #[test]
    fn test_build_trace_dag_sql_escapes_quote_in_stream_name() {
        let sql = build_trace_dag_sql("evil\" x", "abc123", false);
        assert!(sql.contains("FROM \"evil\"\" x\" WHERE"));
    }

    #[test]
    fn test_span_node_serializes() {
        let node = SpanNode {
            span_id: "span1".to_string(),
            parent_span_id: None,
            service_name: "svc".to_string(),
            operation_name: "GET /api".to_string(),
            span_status: "OK".to_string(),
            start_time: 100,
            end_time: 200,
            gen_ai_operation_name: None,
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("span1"));
        assert!(json.contains("svc"));
    }

    #[test]
    fn test_span_node_with_parent_serializes() {
        let node = SpanNode {
            span_id: "child".to_string(),
            parent_span_id: Some("parent".to_string()),
            service_name: "svc".to_string(),
            operation_name: "op".to_string(),
            span_status: "OK".to_string(),
            start_time: 0,
            end_time: 1,
            gen_ai_operation_name: None,
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("parent"));
    }

    #[test]
    fn dag_size_defaults_caps_and_rejects() {
        assert_eq!(parse_dag_size(None), Ok(DAG_MAX_SPANS));
        assert_eq!(parse_dag_size(Some("200")), Ok(200));
        assert_eq!(parse_dag_size(Some("50000")), Ok(DAG_MAX_SPANS));
        assert!(parse_dag_size(Some("0")).is_err());
        assert!(parse_dag_size(Some("-1")).is_err());
        assert!(parse_dag_size(Some("ten")).is_err());
    }

    #[test]
    fn a_dag_over_size_is_cut_and_one_that_fits_is_not() {
        let hits: Vec<json::Value> = (0..3).map(|i| json::json!({ "span_id": i })).collect();
        let (kept, cut) = cut_hits(hits.clone(), 2);
        assert!(cut);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0]["span_id"], 0);
        let (kept, cut) = cut_hits(hits, 3);
        assert!(!cut);
        assert_eq!(kept.len(), 3);
    }

    #[test]
    fn test_span_edge_serializes() {
        let edge = SpanEdge {
            from: "a".to_string(),
            to: "b".to_string(),
        };
        let json = serde_json::to_string(&edge).unwrap();
        assert!(json.contains("\"from\":\"a\""));
        assert!(json.contains("\"to\":\"b\""));
    }
}

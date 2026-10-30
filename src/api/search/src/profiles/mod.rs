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

//! Profiles query HTTP APIs (meta / tag_values / series / merge / diff).

pub mod diff;
pub mod merge;
pub mod meta;
pub mod series;
pub mod tag_values;

use axum::{Json, extract::rejection::JsonRejection, http::Method, response::Response};
use config::{
    get_config,
    meta::{
        search::{Query, Request, RequestEncoding, Response as SearchResponse, SearchEventType},
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
    utils::json,
};
pub use diff::diff_profiles;
use hashbrown::HashMap;
pub use merge::{merge_profiles, merge_profiles_get};
pub use meta::get_profiles_meta;
use openobserve_core::profiles::query::{
    INSTANCE_KEY_COLUMNS, is_filterable_column, is_safe_filter_key, normalize_tag_key,
};
use search_service as SearchService;
use serde::{Deserialize, Serialize};
pub use series::{profiles_series, profiles_series_get};
pub use tag_values::get_profiles_tag_values;
use tracing::{Instrument, Span, warn};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    search::error_utils::map_error_to_http_response,
};

const DEFAULT_RESULT_SIZE: i64 = 99_999;

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct ProfileFilter {
    pub key: String,
    #[serde(default = "default_eq_op")]
    pub op: String,
    pub value: String,
}

fn default_eq_op() -> String {
    "=".to_string()
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct ProfilesQueryBody {
    /// Missing reads as 0 so `parse_required_time_range` reports it, not the JSON parser.
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub end_time: i64,
    #[serde(default)]
    pub data_source: Option<String>,
    #[serde(default)]
    pub service_name: Option<String>,
    #[serde(default)]
    pub profile_type: Option<String>,
    #[serde(default)]
    pub profile_unit: Option<String>,
    #[serde(default)]
    pub filters: Vec<ProfileFilter>,
    #[serde(default)]
    pub step: Option<String>,
    #[serde(default)]
    pub max_nodes: Option<usize>,
    #[serde(default)]
    pub timeout: Option<i64>,
    /// Label column that splits `series` into `groups` (series endpoint only).
    #[serde(default)]
    pub group_by: Option<String>,
    /// Groups returned before the rest fold into one `others` group: 1..=50, default 10.
    #[serde(default)]
    pub group_limit: Option<usize>,
}

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
            &StreamType::Profiles,
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

pub(crate) async fn check_stream_permission(
    org_id: &str,
    stream_name: &str,
    user_id: &str,
) -> Result<(), Response> {
    #[cfg(feature = "enterprise")]
    if let Err(e) = search_service::check_search_allowed(org_id, Some(stream_name)) {
        return Err(MetaHttpResponse::too_many_requests(e.to_string()));
    }
    if let Some(response) = check_stream_permissions(org_id, stream_name, user_id).await {
        return Err(response);
    }
    Ok(())
}

pub(crate) fn parse_required_time_range(
    start_time: i64,
    end_time: i64,
) -> Result<(i64, i64), Response> {
    if start_time <= 0 || end_time <= 0 {
        return Err(MetaHttpResponse::bad_request(
            "start_time and end_time are required (microseconds)",
        ));
    }
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be less than end_time",
        ));
    }
    Ok((start_time, end_time))
}

pub(crate) fn parse_time_range_from_params(
    params: &HashMap<String, String>,
) -> Result<(i64, i64), Response> {
    let start_time = params
        .get("start_time")
        .ok_or_else(|| MetaHttpResponse::bad_request("start_time is required"))?
        .parse::<i64>()
        .map_err(|_| MetaHttpResponse::bad_request("Invalid start_time parameter"))?;
    let end_time = params
        .get("end_time")
        .ok_or_else(|| MetaHttpResponse::bad_request("end_time is required"))?
        .parse::<i64>()
        .map_err(|_| MetaHttpResponse::bad_request("Invalid end_time parameter"))?;
    parse_required_time_range(start_time, end_time)
}

pub(crate) fn query_body_from_params(params: &HashMap<String, String>) -> ProfilesQueryBody {
    ProfilesQueryBody {
        start_time: params
            .get("start_time")
            .and_then(|v| v.parse().ok())
            .unwrap_or_default(),
        end_time: params
            .get("end_time")
            .and_then(|v| v.parse().ok())
            .unwrap_or_default(),
        data_source: params.get("data_source").cloned().filter(|s| !s.is_empty()),
        service_name: params
            .get("service_name")
            .cloned()
            .filter(|s| !s.is_empty()),
        profile_type: params
            .get("profile_type")
            .cloned()
            .filter(|s| !s.is_empty()),
        profile_unit: params
            .get("profile_unit")
            .cloned()
            .filter(|s| !s.is_empty()),
        filters: parse_filters_param(params.get("filters").map(|s| s.as_str())),
        step: params.get("step").cloned().filter(|s| !s.is_empty()),
        max_nodes: params.get("max_nodes").and_then(|v| v.parse().ok()),
        timeout: params.get("timeout").and_then(|v| v.parse().ok()),
        group_by: params.get("group_by").cloned().filter(|s| !s.is_empty()),
        group_limit: params.get("group_limit").and_then(|v| v.parse().ok()),
    }
}

/// `filters` query param: `key=value,key2=value2`. Each side is percent-encoded.
fn parse_filters_param(raw: Option<&str>) -> Vec<ProfileFilter> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    raw.split(',')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            let key = decode_filter_component(key);
            let value = decode_filter_component(value);
            if key.is_empty() {
                return None;
            }
            Some(ProfileFilter {
                key,
                op: "=".to_string(),
                value,
            })
        })
        .collect()
}

fn decode_filter_component(raw: &str) -> String {
    let trimmed = raw.trim();
    urlencoding::decode(trimmed)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| trimmed.to_string())
}

pub(crate) fn build_where_clause(body: &ProfilesQueryBody) -> Result<String, Response> {
    let mut parts = Vec::new();

    if let Some(ds) = body.data_source.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!(
            "{} = {}",
            quote_identifier("otel_scope_name"),
            quote_sql_string(ds)
        ));
    }
    if let Some(svc) = body.service_name.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!(
            "{} = {}",
            quote_identifier("service_name"),
            quote_sql_string(svc)
        ));
    }
    if let Some(pt) = body.profile_type.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!(
            "{} = {}",
            quote_identifier("profile_type"),
            quote_sql_string(pt)
        ));
    }
    if let Some(pu) = body.profile_unit.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!(
            "{} = {}",
            quote_identifier("profile_unit"),
            quote_sql_string(pu)
        ));
    }

    for filter in &body.filters {
        if filter.op != "=" {
            return Err(MetaHttpResponse::bad_request(
                "only filter op '=' is supported",
            ));
        }
        let Some(col) = label_column(&filter.key) else {
            return Err(MetaHttpResponse::bad_request(format!(
                "invalid filter key: {}",
                filter.key
            )));
        };
        parts.push(format!(
            "{} = {}",
            quote_identifier(&col),
            quote_sql_string(&filter.value)
        ));
    }

    Ok(parts.join(" AND "))
}

/// Column behind a user-supplied label key (dotted keys map to snake_case), if filterable.
pub(crate) fn label_column(key: &str) -> Option<String> {
    // Check the normalized name so a dotted alias cannot reach a reserved column.
    let column = normalize_tag_key(key);
    (is_safe_filter_key(key) && is_filterable_column(&column)).then_some(column)
}

/// SQL naming one process from the stream's identity columns; `concat` reads NULL as "".
pub(crate) fn instance_key_expr(schema_fields: &[String]) -> String {
    let parts: Vec<String> = INSTANCE_KEY_COLUMNS
        .iter()
        .filter(|col| schema_fields.iter().any(|f| f == *col))
        .map(|col| quote_identifier(col))
        .collect();
    if parts.is_empty() {
        "''".to_string()
    } else {
        format!("concat({})", parts.join(", '|', "))
    }
}

pub(crate) fn require_profile_type(body: &ProfilesQueryBody) -> Result<String, Response> {
    body.profile_type
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| MetaHttpResponse::bad_request("profile_type is required"))
}

pub(crate) fn require_profile_unit(body: &ProfilesQueryBody) -> Result<String, Response> {
    body.profile_unit
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| MetaHttpResponse::bad_request("profile_unit is required"))
}

/// Series/merge identity is `(profile_type, profile_unit)` so values are never
/// summed across incompatible units.
pub(crate) fn require_profile_type_and_unit(
    body: &ProfilesQueryBody,
) -> Result<(String, String), Response> {
    Ok((require_profile_type(body)?, require_profile_unit(body)?))
}

pub(crate) fn resolve_query_body(
    method: &Method,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
    params: &HashMap<String, String>,
) -> Result<ProfilesQueryBody, Response> {
    match body {
        Ok(Json(mut body)) => {
            merge_params_into_body(&mut body, params);
            Ok(body)
        }
        Err(rejection) => {
            // GET (and HEAD) may omit a JSON body; fall back to query params.
            if matches!(*method, Method::GET | Method::HEAD) {
                Ok(query_body_from_params(params))
            } else {
                Err(MetaHttpResponse::bad_request(rejection.body_text()))
            }
        }
    }
}

pub(crate) fn merge_params_into_body(
    body: &mut ProfilesQueryBody,
    params: &HashMap<String, String>,
) {
    if body.start_time == 0
        && let Some(v) = params.get("start_time").and_then(|s| s.parse().ok())
    {
        body.start_time = v;
    }
    if body.end_time == 0
        && let Some(v) = params.get("end_time").and_then(|s| s.parse().ok())
    {
        body.end_time = v;
    }
    if body.data_source.is_none() {
        body.data_source = params.get("data_source").cloned().filter(|s| !s.is_empty());
    }
    if body.service_name.is_none() {
        body.service_name = params
            .get("service_name")
            .cloned()
            .filter(|s| !s.is_empty());
    }
    if body.profile_type.is_none() {
        body.profile_type = params
            .get("profile_type")
            .cloned()
            .filter(|s| !s.is_empty());
    }
    if body.profile_unit.is_none() {
        body.profile_unit = params
            .get("profile_unit")
            .cloned()
            .filter(|s| !s.is_empty());
    }
    if body.step.is_none() {
        body.step = params.get("step").cloned().filter(|s| !s.is_empty());
    }
    if body.max_nodes.is_none() {
        body.max_nodes = params.get("max_nodes").and_then(|s| s.parse().ok());
    }
    if body.filters.is_empty() {
        body.filters = parse_filters_param(params.get("filters").map(|s| s.as_str()));
    }
    if body.group_by.is_none() {
        body.group_by = params.get("group_by").cloned().filter(|s| !s.is_empty());
    }
    if body.group_limit.is_none() {
        body.group_limit = params.get("group_limit").and_then(|s| s.parse().ok());
    }
}

pub(crate) fn resolve_timeout(timeout: Option<i64>) -> Result<i64, Response> {
    match timeout {
        Some(v) if v > 0 => Ok(v),
        Some(_) => Err(MetaHttpResponse::bad_request("Invalid timeout parameter")),
        None => Ok(get_config().limit.query_timeout as i64),
    }
}

pub(crate) struct ProfilesSqlParams<'a> {
    pub request_trace_id: &'a str,
    pub org_id: &'a str,
    pub user_id: &'a str,
    pub start_time: i64,
    pub end_time: i64,
    pub timeout: i64,
}

pub(crate) async fn run_profiles_sql(
    params: &ProfilesSqlParams<'_>,
    sql: String,
    size: i64,
    http_span: Span,
) -> Result<SearchResponse, Response> {
    let request = Request {
        query: Query {
            sql,
            from: 0,
            size,
            start_time: params.start_time,
            end_time: params.end_time,
            quick_mode: false,
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
            timezone: None,
        },
        encoding: RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: params.timeout,
        search_type: Some(SearchEventType::UI),
        search_event_context: None,
        use_cache: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };

    match SearchService::cache::search(
        params.request_trace_id,
        params.org_id,
        StreamType::Profiles,
        Some(params.user_id.to_string()),
        &request,
        String::new(),
        false,
        None,
        false,
    )
    .instrument(http_span)
    .await
    {
        Ok(response) => reject_partial_search_response(response),
        Err(error) => Err(map_error_to_http_response(
            &error,
            Some(params.request_trace_id.to_string()),
        )),
    }
}

/// Profiles totals must not silently under-count when a shard fails.
pub(crate) fn reject_partial_search_response(
    response: SearchResponse,
) -> Result<SearchResponse, Response> {
    if !response.is_partial && response.function_error.is_empty() {
        return Ok(response);
    }
    let detail = if response.function_error.is_empty() {
        "partial search results".to_string()
    } else {
        response.function_error.join("; ")
    };
    Err(MetaHttpResponse::internal_error(format!(
        "profiles query returned incomplete results: {detail}"
    )))
}

pub(crate) fn hit_string(hit: &json::Value, key: &str) -> Option<String> {
    hit.get(key).and_then(|v| match v {
        json::Value::String(s) => Some(s.clone()),
        json::Value::Number(n) => Some(n.to_string()),
        json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

pub(crate) fn hit_i64(hit: &json::Value, key: &str) -> Option<i64> {
    hit.get(key).and_then(|v| match v {
        json::Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        json::Value::String(s) => s.parse().ok(),
        _ => None,
    })
}

pub(crate) fn default_result_size() -> i64 {
    DEFAULT_RESULT_SIZE
}

pub(crate) async fn load_schema_field_names(org_id: &str, stream_name: &str) -> Vec<String> {
    match infra::schema::get(org_id, stream_name, StreamType::Profiles).await {
        Ok(schema) => schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect(),
        Err(e) => {
            warn!("profiles schema lookup failed: {e}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_filters_param_keeps_a_comma_inside_a_value() {
        let filters = parse_filters_param(Some("k8s_pod_name=a%2Cb,env=prod"));
        assert_eq!(filters.len(), 2);
        assert_eq!(filters[0].key, "k8s_pod_name");
        assert_eq!(filters[0].value, "a,b");
        assert_eq!(filters[1].key, "env");
        assert_eq!(filters[1].value, "prod");
    }

    #[test]
    fn parse_filters_param_reads_plain_pairs() {
        let filters = parse_filters_param(Some("env=prod,region=us"));
        assert_eq!(filters[0].value, "prod");
        assert_eq!(filters[1].value, "us");
    }

    #[test]
    fn tag_filter_uses_column_equality() {
        let body = ProfilesQueryBody {
            filters: vec![ProfileFilter {
                key: "env".to_string(),
                op: "=".to_string(),
                value: "prod".to_string(),
            }],
            ..Default::default()
        };
        let where_clause = build_where_clause(&body).unwrap();
        assert_eq!(where_clause, r#""env" = 'prod'"#);
    }

    #[test]
    fn dotted_tag_key_normalized_to_snake_case() {
        let body = ProfilesQueryBody {
            filters: vec![ProfileFilter {
                key: "k8s.pod.name".to_string(),
                op: "=".to_string(),
                value: "pod-a".to_string(),
            }],
            ..Default::default()
        };
        let where_clause = build_where_clause(&body).unwrap();
        assert_eq!(where_clause, r#""k8s_pod_name" = 'pod-a'"#);
    }

    #[test]
    fn label_column_normalizes_dots_and_rejects_reserved_or_unsafe_keys() {
        assert_eq!(
            label_column("k8s.pod.name").as_deref(),
            Some("k8s_pod_name")
        );
        assert_eq!(label_column("host_name").as_deref(), Some("host_name"));
        assert_eq!(label_column("stack"), None);
        assert_eq!(label_column("value"), None);
        assert_eq!(label_column("event.id"), None);
        assert_eq!(label_column("profile.duration.nanos"), None);
        assert_eq!(label_column(r#"a" OR 1=1"#), None);
        assert_eq!(label_column(""), None);
    }

    #[test]
    fn instance_key_expr_uses_only_present_identity_columns() {
        let fields = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(instance_key_expr(&fields(&["value", "stack"])), "''");
        assert_eq!(
            instance_key_expr(&fields(&["process_pid", "value", "host_name"])),
            r#"concat("host_name", '|', "process_pid")"#
        );
    }

    #[test]
    fn require_profile_type_rejects_missing() {
        let body = ProfilesQueryBody::default();
        assert!(require_profile_type(&body).is_err());
        let body = ProfilesQueryBody {
            profile_type: Some("cpu".to_string()),
            ..Default::default()
        };
        assert_eq!(require_profile_type(&body).unwrap(), "cpu");
    }

    #[test]
    fn require_profile_type_and_unit_requires_both() {
        let body = ProfilesQueryBody {
            profile_type: Some("cpu".to_string()),
            ..Default::default()
        };
        assert!(require_profile_type_and_unit(&body).is_err());
        let body = ProfilesQueryBody {
            profile_type: Some("cpu".to_string()),
            profile_unit: Some("nanoseconds".to_string()),
            ..Default::default()
        };
        let (pt, pu) = require_profile_type_and_unit(&body).unwrap();
        assert_eq!(pt, "cpu");
        assert_eq!(pu, "nanoseconds");
    }

    #[test]
    fn where_clause_includes_profile_type_and_unit() {
        let body = ProfilesQueryBody {
            profile_type: Some("cpu".to_string()),
            profile_unit: Some("nanoseconds".to_string()),
            ..Default::default()
        };
        let where_clause = build_where_clause(&body).unwrap();
        assert!(where_clause.contains(r#""profile_type" = 'cpu'"#));
        assert!(where_clause.contains(r#""profile_unit" = 'nanoseconds'"#));
    }

    #[test]
    fn reject_partial_search_response_errors() {
        let response = SearchResponse {
            is_partial: true,
            function_error: vec!["shard failed".to_string()],
            ..Default::default()
        };
        assert!(reject_partial_search_response(response).is_err());

        let response = SearchResponse::default();
        assert!(reject_partial_search_response(response).is_ok());
    }

    #[tokio::test]
    async fn post_body_without_time_range_gets_the_required_time_range_message() {
        let body: ProfilesQueryBody =
            json::from_str(r#"{"profile_type":"cpu","profile_unit":"nanoseconds"}"#).unwrap();
        let body = resolve_query_body(&Method::POST, Ok(Json(body)), &HashMap::new()).unwrap();
        let resp = parse_required_time_range(body.start_time, body.end_time).unwrap_err();
        assert_eq!(resp.status(), axum::http::StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(
            text.contains("start_time and end_time are required (microseconds)"),
            "{text}"
        );
    }
}

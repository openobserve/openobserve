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
    Json,
    extract::{Path, rejection::JsonRejection},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::meta::traces::session::quote_identifier;
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    profiles::query::{MergeResult, build_merge_result, resolve_max_nodes},
};
use serde::Serialize;
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesQueryBody, ProfilesSqlParams, build_where_clause, check_stream_permission,
    default_result_size, hit_i64, hit_string, parse_required_time_range,
    require_profile_type_and_unit, resolve_query_body, resolve_timeout, run_profiles_sql,
};
use crate::common::utils::http::get_or_create_trace_id;

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesMergeResponse {
    pub unit: String,
    pub profile_type: String,
    /// Full sample weight in scope (from `sum(value)` when stacks were capped).
    pub total: i64,
    /// Sample weight represented in `root` / `top` after the unique-stack cap.
    pub merged_total: i64,
    /// True when unique stacks exceeded the query size limit.
    pub truncated: bool,
    /// Call tree root (`name` / `self` / `total` / `children`).
    #[schema(value_type = Object)]
    pub root: openobserve_core::profiles::query::TreeNode,
    /// Flattened top functions by exclusive (`self`) value (pre-truncation).
    #[schema(value_type = Vec<Object>)]
    pub top: Vec<openobserve_core::profiles::query::TopFunction>,
    pub took: u64,
}

/// ProfilesMerge
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/profiles/merge",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "ProfilesMerge",
    summary = "Merge profile stacks into a call tree",
    description = "Aggregates matching profile samples by stack and returns a call tree suitable for Flame Graph, Call Tree, and Top Table views. `profile_type` and `profile_unit` are required.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
    ),
    request_body(content = ProfilesQueryBody, description = "Merge query", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = ProfilesMergeResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn merge_profiles(
    Path((org_id, stream_name)): Path<(String, String)>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
) -> Response {
    merge_profiles_impl(
        axum::http::Method::POST,
        org_id,
        stream_name,
        headers,
        user_email,
        params,
        body,
    )
    .await
}

/// ProfilesMergeGet
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/profiles/merge",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "ProfilesMergeGet",
    summary = "Merge profile stacks into a call tree (GET)",
    description = "GET variant of ProfilesMerge. Supports query parameters and optional JSON body. `profile_type` and `profile_unit` are required.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
        ("start_time" = i64, Query, description = "Start time in microseconds"),
        ("end_time" = i64, Query, description = "End time in microseconds"),
        ("data_source" = Option<String>, Query, description = "Filter by otel_scope_name"),
        ("service_name" = Option<String>, Query, description = "Filter by service_name"),
        ("profile_type" = Option<String>, Query, description = "Filter by profile_type (required)"),
        ("profile_unit" = Option<String>, Query, description = "Filter by profile_unit (required)"),
        ("filters" = Option<String>, Query, description = "Comma-separated key=value pairs"),
        ("max_nodes" = Option<usize>, Query, description = "Maximum tree node count"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds")
    ),
    responses(
        (status = 200, description = "Success", body = ProfilesMergeResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn merge_profiles_get(
    Path((org_id, stream_name)): Path<(String, String)>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
) -> Response {
    merge_profiles_impl(
        axum::http::Method::GET,
        org_id,
        stream_name,
        headers,
        user_email,
        params,
        body,
    )
    .await
}

async fn merge_profiles_impl(
    method: axum::http::Method,
    org_id: String,
    stream_name: String,
    headers: HeaderMap,
    user_email: UserEmail,
    params: HashMap<String, String>,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }

    let body = match resolve_query_body(&method, body, &params) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let (profile_type, unit) = match require_profile_type_and_unit(&body) {
        Ok(v) => v,
        Err(response) => return response,
    };
    let (start_time, end_time) = match parse_required_time_range(body.start_time, body.end_time) {
        Ok(range) => range,
        Err(response) => return response,
    };
    let where_clause = match build_where_clause(&body) {
        Ok(w) => w,
        Err(response) => return response,
    };
    let timeout = match resolve_timeout(body.timeout) {
        Ok(v) => v,
        Err(response) => return response,
    };
    let max_nodes = resolve_max_nodes(body.max_nodes);
    let result_size = default_result_size();

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let stream = quote_identifier(&stream_name);
    let stack_q = quote_identifier("stack");
    let value_q = quote_identifier("value");
    let sql_params = ProfilesSqlParams {
        request_trace_id: &request_trace_id,
        org_id: &org_id,
        user_id: &user_email.user_id,
        start_time,
        end_time,
        timeout,
    };
    let sql = if where_clause.is_empty() {
        format!(
            "SELECT {stack_q} AS stack, sum({value_q}) AS value FROM {stream} \
             WHERE {stack_q} IS NOT NULL GROUP BY stack ORDER BY value DESC"
        )
    } else {
        format!(
            "SELECT {stack_q} AS stack, sum({value_q}) AS value FROM {stream} \
             WHERE {stack_q} IS NOT NULL AND ({where_clause}) \
             GROUP BY stack ORDER BY value DESC"
        )
    };

    let response = match run_profiles_sql(
        &sql_params,
        sql,
        // Fetch one extra row so we can distinguish "exactly N stacks" from truncation.
        result_size + 1,
        http_span.clone(),
    )
    .await
    {
        Ok(r) => r,
        Err(response) => return response,
    };

    let truncated = response.hits.len() as i64 > result_size;
    let stacks: Vec<(String, i64)> = response
        .hits
        .iter()
        .take(result_size as usize)
        .filter_map(|hit| {
            // Keep empty stacks: fold_stacks attributes them to root.self so
            // merged_total stays aligned with series / load_full_total.
            let stack = hit_string(hit, "stack")?;
            let value = hit_i64(hit, "value").unwrap_or(0);
            if value == 0 {
                return None;
            }
            Some((stack, value))
        })
        .collect();

    let MergeResult {
        total: merged_total,
        root,
        top,
    } = build_merge_result(&stacks, max_nodes);

    let total = if truncated {
        match load_full_total(&sql_params, &stream, &where_clause, http_span).await {
            Ok(v) => v,
            Err(response) => return response,
        }
    } else {
        merged_total
    };

    Json(ProfilesMergeResponse {
        unit,
        profile_type,
        total,
        merged_total,
        truncated,
        root,
        top,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}

async fn load_full_total(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    where_clause: &str,
    http_span: Span,
) -> Result<i64, Response> {
    let value_q = quote_identifier("value");
    let stack_q = quote_identifier("stack");
    let sql = if where_clause.is_empty() {
        format!("SELECT sum({value_q}) AS total FROM {stream} WHERE {stack_q} IS NOT NULL")
    } else {
        format!(
            "SELECT sum({value_q}) AS total FROM {stream} \
             WHERE {stack_q} IS NOT NULL AND ({where_clause})"
        )
    };
    let response = run_profiles_sql(params, sql, 1, http_span).await?;
    Ok(response
        .hits
        .first()
        .and_then(|h| hit_i64(h, "total"))
        .unwrap_or(0))
}

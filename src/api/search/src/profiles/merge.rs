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
    profiles::query::{
        MergeResult, build_merge_result, is_snapshot_profile_type, resolve_max_nodes,
    },
};
use search::datafusion::udf::fold_native_frames_udf::FOLD_NATIVE_FRAMES_UDF_NAME;
use serde::Serialize;
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesQueryBody, ProfilesSqlParams, build_where_clause, check_stream_permission,
    default_result_size, hit_i64, hit_string, instance_key_expr, load_schema_field_names,
    parse_required_time_range, require_profile_type_and_unit, resolve_query_body, resolve_timeout,
    run_profiles_sql,
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
    /// True when the call tree was cut to `max_nodes` and light nodes folded into `other`.
    pub tree_truncated: bool,
    /// Call tree root (`name` / `self` / `total` / `children`).
    #[schema(value_type = Object)]
    pub root: openobserve_core::profiles::query::TreeNode,
    /// Flattened top functions by exclusive (`self`) value (pre-truncation).
    #[schema(value_type = Vec<Object>)]
    pub top: Vec<openobserve_core::profiles::query::TopFunction>,
    pub took: u64,
}

/// Unique stacks of one query, with snapshot types already averaged per snapshot.
pub(crate) struct StackSet {
    pub stacks: Vec<(String, i64)>,
    /// True when unique stacks exceeded the result size.
    pub truncated: bool,
    /// Divisor applied to every value: average snapshots per instance for in-use types, else 1.
    pub snapshots: f64,
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
    ),
    extensions(
        ("x-o2-mcp" = json!({"readOnlyHint": true}))
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

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let stream = quote_identifier(&stream_name);
    let sql_params = ProfilesSqlParams {
        request_trace_id: &request_trace_id,
        org_id: &org_id,
        user_id: &user_email.user_id,
        start_time,
        end_time,
        timeout,
    };
    let snapshot_key = snapshot_instance_key(&org_id, &stream_name, &profile_type).await;
    let StackSet {
        stacks,
        truncated,
        snapshots,
    } = match load_stacks(
        &sql_params,
        &stream,
        &where_clause,
        snapshot_key.as_deref(),
        http_span.clone(),
    )
    .await
    {
        Ok(v) => v,
        Err(response) => return response,
    };

    let MergeResult {
        total: merged_total,
        root,
        top,
        tree_truncated,
    } = build_merge_result(&stacks, max_nodes);

    let total = if truncated {
        match load_total(&sql_params, &stream, &where_clause, snapshots, http_span).await {
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
        tree_truncated,
        root,
        top,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}

/// Instance key for snapshot averaging; None for types whose values add up over time.
pub(crate) async fn snapshot_instance_key(
    org_id: &str,
    stream_name: &str,
    profile_type: &str,
) -> Option<String> {
    if !is_snapshot_profile_type(profile_type) {
        return None;
    }
    Some(instance_key_expr(
        &load_schema_field_names(org_id, stream_name).await,
    ))
}

/// Unique stacks with summed values, capped at the result size.
pub(crate) async fn load_stacks(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    where_clause: &str,
    snapshot_key: Option<&str>,
    http_span: Span,
) -> Result<StackSet, Response> {
    let result_size = default_result_size();
    let stack_q = quote_identifier("stack");
    let value_q = quote_identifier("value");
    // Grouping on folded stacks keeps one binary's raw addresses from splitting into many stacks.
    let folded = format!("{FOLD_NATIVE_FRAMES_UDF_NAME}({stack_q})");
    let sql = if where_clause.is_empty() {
        format!(
            "SELECT {folded} AS stack, sum({value_q}) AS value FROM {stream} \
             WHERE {stack_q} IS NOT NULL GROUP BY {folded} ORDER BY value DESC"
        )
    } else {
        format!(
            "SELECT {folded} AS stack, sum({value_q}) AS value FROM {stream} \
             WHERE {stack_q} IS NOT NULL AND ({where_clause}) \
             GROUP BY {folded} ORDER BY value DESC"
        )
    };
    // Concurrent searches need their own ids: the query manager keys running searches by trace_id.
    let snapshot_trace_id = format!("{}-snapshots", params.request_trace_id);
    let snapshot_params = ProfilesSqlParams {
        request_trace_id: &snapshot_trace_id,
        ..*params
    };
    let snapshots_fut = async {
        match snapshot_key {
            Some(key) => {
                load_avg_snapshots(
                    &snapshot_params,
                    stream,
                    where_clause,
                    key,
                    http_span.clone(),
                )
                .await
            }
            None => Ok(1.0),
        }
    };
    // Fetch one extra row so we can distinguish "exactly N stacks" from truncation.
    let (response, snapshots) = tokio::join!(
        run_profiles_sql(params, sql, result_size + 1, http_span.clone()),
        snapshots_fut
    );
    let (response, snapshots) = (response?, snapshots?);
    let truncated = response.hits.len() as i64 > result_size;
    let stacks = response
        .hits
        .iter()
        .take(result_size as usize)
        .filter_map(|hit| {
            // Keep empty stacks: fold_stacks puts them in root.self so merged_total matches series.
            let stack = hit_string(hit, "stack")?;
            let value = per_snapshot(hit_i64(hit, "value").unwrap_or(0), snapshots);
            if value == 0 {
                return None;
            }
            Some((stack, value))
        })
        .collect();
    Ok(StackSet {
        stacks,
        truncated,
        snapshots,
    })
}

/// Full value of a query, on the same per-snapshot scale as its `StackSet`.
pub(crate) async fn load_total(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    where_clause: &str,
    snapshots: f64,
    http_span: Span,
) -> Result<i64, Response> {
    let total = load_full_total(params, stream, where_clause, http_span).await?;
    Ok(per_snapshot(total, snapshots))
}

/// Average distinct snapshot timestamps per instance, at least 1.
async fn load_avg_snapshots(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    where_clause: &str,
    instance_key: &str,
    http_span: Span,
) -> Result<f64, Response> {
    let filter = if where_clause.is_empty() {
        String::new()
    } else {
        format!(" WHERE {where_clause}")
    };
    let sql = format!(
        "SELECT count(DISTINCT concat({instance_key}, '|', _timestamp)) AS zo_snapshots, \
         count(DISTINCT {instance_key}) AS zo_instances FROM {stream}{filter}"
    );
    let response = run_profiles_sql(params, sql, 1, http_span).await?;
    let hit = response.hits.first();
    Ok(average_snapshots(
        hit.and_then(|h| hit_i64(h, "zo_snapshots")).unwrap_or(0),
        hit.and_then(|h| hit_i64(h, "zo_instances")).unwrap_or(0),
    ))
}

fn average_snapshots(snapshots: i64, instances: i64) -> f64 {
    if instances <= 0 {
        return 1.0;
    }
    (snapshots as f64 / instances as f64).max(1.0)
}

fn per_snapshot(value: i64, snapshots: f64) -> i64 {
    if snapshots <= 1.0 {
        value
    } else {
        // Rounding a small stack to 0 would drop it from the tree; keep it visible.
        ((value as f64 / snapshots).round() as i64).max(i64::from(value > 0))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_divisor_is_the_average_per_instance_and_never_below_one() {
        assert_eq!(average_snapshots(236, 2), 118.0);
        assert_eq!(average_snapshots(0, 0), 1.0);
        assert_eq!(average_snapshots(1, 3), 1.0);
        assert_eq!(per_snapshot(1_000, 4.0), 250);
        assert_eq!(per_snapshot(1_000, 1.0), 1_000);
        assert_eq!(per_snapshot(1, 120.0), 1);
        assert_eq!(per_snapshot(0, 120.0), 0);
    }
}

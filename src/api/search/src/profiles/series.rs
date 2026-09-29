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
use config::meta::traces::session::{quote_identifier, quote_sql_string};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search::sql::visitor::histogram_interval::{
    convert_histogram_interval_to_seconds, generate_histogram_interval,
};
use serde::Serialize;
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesQueryBody, ProfilesSqlParams, build_where_clause, check_stream_permission,
    default_result_size, hit_i64, hit_string, parse_required_time_range,
    require_profile_type_and_unit, resolve_query_body, resolve_timeout, run_profiles_sql,
};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesSeriesPoint {
    pub timestamp: i64,
    pub value: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesSeriesResponse {
    pub unit: String,
    pub profile_type: String,
    pub step_secs: i64,
    pub series: Vec<ProfilesSeriesPoint>,
    pub took: u64,
}

/// ProfilesSeries
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/profiles/series",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "ProfilesSeries",
    summary = "Aggregate profile sample values over time",
    description = "Returns a time series of sum(value) for the selected profile filters. `profile_type` and `profile_unit` are required.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
    ),
    request_body(content = ProfilesQueryBody, description = "Series query", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = ProfilesSeriesResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn profiles_series(
    Path((org_id, stream_name)): Path<(String, String)>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
) -> Response {
    profiles_series_impl(
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

/// ProfilesSeriesGet
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/profiles/series",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "ProfilesSeriesGet",
    summary = "Aggregate profile sample values over time (GET)",
    description = "GET variant of ProfilesSeries. Supports query parameters and optional JSON body. `profile_type` and `profile_unit` are required.",
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
        ("step" = Option<String>, Query, description = "Histogram step (e.g. 30, 30 second, auto)"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds")
    ),
    responses(
        (status = 200, description = "Success", body = ProfilesSeriesResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn profiles_series_get(
    Path((org_id, stream_name)): Path<(String, String)>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    body: Result<Json<ProfilesQueryBody>, JsonRejection>,
) -> Response {
    profiles_series_impl(
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

async fn profiles_series_impl(
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

    let interval = match resolve_step(body.step.as_deref(), start_time, end_time) {
        Ok(v) => v,
        Err(response) => return response,
    };
    let step_secs = match convert_histogram_interval_to_seconds(&interval) {
        Ok(v) => v,
        Err(_) => {
            return MetaHttpResponse::bad_request(format!("Invalid step interval: {interval}"));
        }
    };
    let max_buckets = default_result_size();
    if let Err(response) =
        validate_series_bucket_count(start_time, end_time, step_secs, max_buckets)
    {
        return response;
    }

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let stream = quote_identifier(&stream_name);
    let interval_lit = quote_sql_string(&interval);
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
            "SELECT histogram(_timestamp, {interval_lit}) AS zo_sql_key, \
             sum(value) AS zo_sql_num FROM {stream} \
             GROUP BY zo_sql_key ORDER BY zo_sql_key ASC"
        )
    } else {
        format!(
            "SELECT histogram(_timestamp, {interval_lit}) AS zo_sql_key, \
             sum(value) AS zo_sql_num FROM {stream} \
             WHERE {where_clause} GROUP BY zo_sql_key ORDER BY zo_sql_key ASC"
        )
    };

    let response = match run_profiles_sql(&sql_params, sql, max_buckets, http_span).await {
        Ok(r) => r,
        Err(response) => return response,
    };

    let series: Vec<ProfilesSeriesPoint> = response
        .hits
        .iter()
        .filter_map(|hit| {
            let timestamp = parse_histogram_timestamp(hit)?;
            let value = hit_i64(hit, "zo_sql_num").unwrap_or(0) as f64;
            Some(ProfilesSeriesPoint { timestamp, value })
        })
        .collect();

    Json(ProfilesSeriesResponse {
        unit,
        profile_type,
        step_secs,
        series,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}

/// Reject steps that would produce more histogram buckets than the search size
/// limit; oversized requests fail fast instead of returning a partial series.
pub(crate) fn validate_series_bucket_count(
    start_time: i64,
    end_time: i64,
    step_secs: i64,
    max_buckets: i64,
) -> Result<(), Response> {
    if step_secs <= 0 {
        return Err(MetaHttpResponse::bad_request("step must be positive"));
    }
    let range_micros = end_time.saturating_sub(start_time);
    let range_secs = ((range_micros + 1_000_000 - 1) / 1_000_000).max(1);
    let estimated = ((range_secs + step_secs - 1) / step_secs).max(1);
    if estimated > max_buckets {
        return Err(MetaHttpResponse::bad_request(format!(
            "step too fine for time range: estimated {estimated} histogram buckets exceeds max {max_buckets}; increase step or narrow the time range"
        )));
    }
    Ok(())
}

fn resolve_step(step: Option<&str>, start_time: i64, end_time: i64) -> Result<String, Response> {
    match step {
        None | Some("") | Some("auto") => {
            Ok(generate_histogram_interval((start_time, end_time)).to_string())
        }
        Some(raw) => {
            if raw.chars().all(|c| c.is_ascii_digit()) {
                Ok(format!("{raw} second"))
            } else if convert_histogram_interval_to_seconds(raw).is_ok() {
                Ok(raw.to_string())
            } else {
                Err(MetaHttpResponse::bad_request(format!(
                    "Invalid step: {raw}"
                )))
            }
        }
    }
}

fn parse_histogram_timestamp(hit: &config::utils::json::Value) -> Option<i64> {
    // Prefer RFC3339 / numeric micros from the histogram UDF; avoid aggressive
    // seconds/millis heuristics that can mis-scale edge values.
    if let Some(v) = hit_i64(hit, "zo_sql_key") {
        return Some(v);
    }
    let s = hit_string(hit, "zo_sql_key")?;
    if let Ok(v) = s.parse::<i64>() {
        return Some(v);
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s) {
        return Some(dt.timestamp_micros());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.and_utc().timestamp_micros());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S") {
        return Some(dt.and_utc().timestamp_micros());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_series_bucket_count_rejects_too_fine_step() {
        // 24h range with 1s step → 86400 buckets > 50000
        let start = 1_000_000i64;
        let end = start + 24 * 60 * 60 * 1_000_000;
        assert!(validate_series_bucket_count(start, end, 1, 50_000).is_err());
    }

    #[test]
    fn validate_series_bucket_count_allows_coarse_step() {
        let start = 1_000_000i64;
        let end = start + 30 * 60 * 1_000_000; // 30 minutes
        assert!(validate_series_bucket_count(start, end, 30, 50_000).is_ok());
    }
}

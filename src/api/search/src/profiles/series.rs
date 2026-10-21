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

use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, rejection::JsonRejection},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::{
    meta::traces::session::{quote_identifier, quote_sql_string},
    utils::json,
};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    profiles::query::{PROFILE_DURATION_COLUMN, is_snapshot_profile_type},
};
use search::sql::visitor::histogram_interval::{
    convert_histogram_interval_to_seconds, generate_histogram_interval,
};
use serde::Serialize;
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesQueryBody, ProfilesSqlParams, build_where_clause, check_stream_permission,
    default_result_size, hit_i64, hit_string, instance_key_expr, label_column,
    load_schema_field_names, parse_required_time_range, require_profile_type_and_unit,
    resolve_query_body, resolve_timeout, run_profiles_sql,
};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

const DEFAULT_GROUP_LIMIT: usize = 10;
const MAX_GROUP_LIMIT: usize = 50;

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesSeriesPoint {
    pub timestamp: i64,
    pub value: f64,
    /// Value per second of profiled time, summed over instances; CPU ns / 1e9 = cores.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
}

impl ProfilesSeriesPoint {
    fn empty(timestamp: i64) -> Self {
        Self {
            timestamp,
            value: 0.0,
            rate: None,
        }
    }

    fn add(&mut self, value: f64, rate: Option<f64>) {
        self.value += value;
        self.rate = add_rates(self.rate, rate);
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesSeriesGroup {
    /// Label value; "" when rows lack the label, and for the `others` group.
    pub value: String,
    pub total: f64,
    /// True for the single group that sums every value past `group_limit`.
    pub others: bool,
    pub series: Vec<ProfilesSeriesPoint>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesSeriesResponse {
    pub unit: String,
    pub profile_type: String,
    pub step_secs: i64,
    /// Sum over all groups per bucket.
    pub series: Vec<ProfilesSeriesPoint>,
    /// Only when `group_by` is set: top `group_limit` values by total, then one `others` group.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<ProfilesSeriesGroup>>,
    pub took: u64,
}

/// Per-instance split of the series query, needed for rates and snapshot averaging.
struct InstanceSplit {
    key_expr: String,
    covered: bool,
    snapshots: bool,
}

/// One row of the series query; instance and group are "" when the query does not split by them.
struct SeriesRow {
    timestamp: i64,
    group: String,
    instance: String,
    value: f64,
    covered_nanos: i64,
    /// Distinct snapshot timestamps of this instance in the bucket; 0 when not averaged.
    snapshots: i64,
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
    description = "Returns a time series of sum(value) for the selected profile filters, with `rate` (value per second of profiled time) when the stream records profile duration. In-use (`inuse_*`) types average each instance's snapshots per bucket instead of summing them. Set `group_by` to a label column to also get the top `group_limit` groups. `profile_type` and `profile_unit` are required.",
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
        ("group_by" = Option<String>, Query, description = "Label column to split the series by (e.g. k8s_pod_name)"),
        ("group_limit" = Option<usize>, Query, description = "Top groups to return before the rest fold into `others` (1-50, default 10)"),
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
    let group_col = match body.group_by.as_deref().filter(|s| !s.is_empty()) {
        None => None,
        Some(key) => match label_column(key) {
            Some(col) => Some(col),
            None => return MetaHttpResponse::bad_request(format!("invalid group_by: {key}")),
        },
    };
    let group_limit = body
        .group_limit
        .unwrap_or(DEFAULT_GROUP_LIMIT)
        .clamp(1, MAX_GROUP_LIMIT);

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
    let max_rows = default_result_size();
    if let Err(response) = validate_series_bucket_count(start_time, end_time, step_secs, max_rows) {
        return response;
    }

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
    let schema_fields = load_schema_field_names(&org_id, &stream_name).await;
    if let Some(col) = group_col.as_deref()
        && !schema_fields.is_empty()
        && !schema_fields.iter().any(|f| f == col)
    {
        return MetaHttpResponse::bad_request(format!("unknown group_by column: {col}"));
    }
    let split = instance_split(&schema_fields, is_snapshot_profile_type(&profile_type));
    let snapshots = split.as_ref().is_some_and(|s| s.snapshots);
    let group_col_ref = group_col.as_deref();
    let sql = series_sql(
        &stream,
        &interval,
        &where_clause,
        group_col_ref,
        split.as_ref(),
    );
    let mut response =
        match run_profiles_sql(&sql_params, sql, max_rows + 1, http_span.clone()).await {
            Ok(r) => r,
            Err(response) => return response,
        };
    // Only a rate-only split may fall back; summed snapshots would be N times too high.
    if split.is_some() && !snapshots && response.hits.len() as i64 > max_rows {
        let sql = series_sql(&stream, &interval, &where_clause, group_col_ref, None);
        response = match run_profiles_sql(&sql_params, sql, max_rows + 1, http_span.clone()).await {
            Ok(r) => r,
            Err(response) => return response,
        };
    }
    if response.hits.len() as i64 > max_rows {
        return MetaHttpResponse::bad_request(format!(
            "series has more than {max_rows} bucket and group rows; increase step, narrow the time range, or group by a label with fewer values"
        ));
    }

    let mut rows = parse_series_rows(&response.hits);
    // A label can split one snapshot across groups, so count each instance's snapshots ungrouped.
    if snapshots && group_col.is_some() {
        let sql = series_sql(&stream, &interval, &where_clause, None, split.as_ref());
        let counts = match run_profiles_sql(&sql_params, sql, max_rows + 1, http_span).await {
            Ok(r) => r,
            Err(response) => return response,
        };
        apply_instance_snapshots(&mut rows, &parse_series_rows(&counts.hits));
    }
    let by_group = fold_series_rows(&rows);
    let series = sum_series(by_group.values());
    let groups = group_col.map(|_| rank_groups(by_group, group_limit));

    Json(ProfilesSeriesResponse {
        unit,
        profile_type,
        step_secs,
        series,
        groups,
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

/// Rates need the duration column (absent on old data); snapshot types average per instance.
fn instance_split(schema_fields: &[String], snapshot_type: bool) -> Option<InstanceSplit> {
    let covered = !snapshot_type && schema_fields.iter().any(|f| f == PROFILE_DURATION_COLUMN);
    (covered || snapshot_type).then(|| InstanceSplit {
        key_expr: instance_key_expr(schema_fields),
        covered,
        snapshots: snapshot_type,
    })
}

fn series_sql(
    stream: &str,
    interval: &str,
    where_clause: &str,
    group_col: Option<&str>,
    split: Option<&InstanceSplit>,
) -> String {
    let mut select = vec![format!(
        "histogram(_timestamp, {}) AS zo_sql_key",
        quote_sql_string(interval)
    )];
    let mut group_by = vec!["zo_sql_key"];
    if let Some(col) = group_col {
        select.push(format!("{} AS zo_group", quote_identifier(col)));
        group_by.push("zo_group");
    }
    if let Some(split) = split {
        select.push(format!("{} AS zo_instance", split.key_expr));
        group_by.push("zo_instance");
    }
    select.push("sum(value) AS zo_sql_num".to_string());
    if split.is_some_and(|s| s.covered) {
        select.push(format!(
            "sum({}) AS zo_covered",
            quote_identifier(PROFILE_DURATION_COLUMN)
        ));
    }
    if split.is_some_and(|s| s.snapshots) {
        select.push("count(DISTINCT _timestamp) AS zo_snapshots".to_string());
    }
    let filter = if where_clause.is_empty() {
        String::new()
    } else {
        format!(" WHERE {where_clause}")
    };
    format!(
        "SELECT {} FROM {stream}{filter} GROUP BY {} ORDER BY zo_sql_key ASC",
        select.join(", "),
        group_by.join(", ")
    )
}

fn parse_series_rows(hits: &[json::Value]) -> Vec<SeriesRow> {
    hits.iter()
        .filter_map(|hit| {
            Some(SeriesRow {
                timestamp: parse_histogram_timestamp(hit)?,
                group: hit_string(hit, "zo_group").unwrap_or_default(),
                instance: hit_string(hit, "zo_instance").unwrap_or_default(),
                value: hit_i64(hit, "zo_sql_num").unwrap_or(0) as f64,
                covered_nanos: hit_i64(hit, "zo_covered").unwrap_or(0),
                snapshots: hit_i64(hit, "zo_snapshots").unwrap_or(0),
            })
        })
        .collect()
}

/// One point per (group, bucket), dividing by each instance's coverage taken across all groups.
fn fold_series_rows(rows: &[SeriesRow]) -> HashMap<&str, BTreeMap<i64, ProfilesSeriesPoint>> {
    let mut instances: HashMap<(i64, &str), (i64, i64)> = HashMap::new();
    for row in rows {
        let (covered, snapshots) = instances
            .entry((row.timestamp, row.instance.as_str()))
            .or_default();
        *covered = covered.saturating_add(row.covered_nanos);
        *snapshots = (*snapshots).max(row.snapshots);
    }
    let mut groups: HashMap<&str, BTreeMap<i64, ProfilesSeriesPoint>> = HashMap::new();
    for row in rows {
        let (covered, snapshots) = instances[&(row.timestamp, row.instance.as_str())];
        groups
            .entry(row.group.as_str())
            .or_default()
            .entry(row.timestamp)
            .or_insert_with(|| ProfilesSeriesPoint::empty(row.timestamp))
            .add(
                row.value / snapshots.max(1) as f64,
                instance_rate(row.value, covered),
            );
    }
    groups
}

fn apply_instance_snapshots(rows: &mut [SeriesRow], ungrouped: &[SeriesRow]) {
    let counts: HashMap<(i64, &str), i64> = ungrouped
        .iter()
        .map(|r| ((r.timestamp, r.instance.as_str()), r.snapshots))
        .collect();
    for row in rows {
        if let Some(count) = counts.get(&(row.timestamp, row.instance.as_str())) {
            row.snapshots = *count;
        }
    }
}

/// Value per second of profiled time for one instance; None when it has no covered time.
fn instance_rate(value: f64, covered_nanos: i64) -> Option<f64> {
    (covered_nanos > 0).then(|| value / (covered_nanos as f64 / 1e9))
}

fn add_rates(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x + y),
        (x, y) => x.or(y),
    }
}

fn sum_series<'a>(
    series: impl IntoIterator<Item = &'a BTreeMap<i64, ProfilesSeriesPoint>>,
) -> Vec<ProfilesSeriesPoint> {
    let mut out: BTreeMap<i64, ProfilesSeriesPoint> = BTreeMap::new();
    for point in series.into_iter().flat_map(|points| points.values()) {
        out.entry(point.timestamp)
            .or_insert_with(|| ProfilesSeriesPoint::empty(point.timestamp))
            .add(point.value, point.rate);
    }
    out.into_values().collect()
}

fn rank_groups(
    groups: HashMap<&str, BTreeMap<i64, ProfilesSeriesPoint>>,
    limit: usize,
) -> Vec<ProfilesSeriesGroup> {
    let mut ranked: Vec<(&str, f64, BTreeMap<i64, ProfilesSeriesPoint>)> = groups
        .into_iter()
        .map(|(value, points)| (value, points.values().map(|p| p.value).sum(), points))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let rest = ranked.split_off(limit.min(ranked.len()));
    let mut out: Vec<ProfilesSeriesGroup> = ranked
        .into_iter()
        .map(|(value, total, points)| ProfilesSeriesGroup {
            value: value.to_string(),
            total,
            others: false,
            series: points.into_values().collect(),
        })
        .collect();
    if !rest.is_empty() {
        out.push(ProfilesSeriesGroup {
            value: String::new(),
            total: rest.iter().map(|(_, total, _)| total).sum(),
            others: true,
            series: sum_series(rest.iter().map(|(_, _, points)| points)),
        });
    }
    out
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

    fn row(ts: i64, group: &str, instance: &str, value: f64, covered_nanos: i64) -> SeriesRow {
        SeriesRow {
            timestamp: ts,
            group: group.to_string(),
            instance: instance.to_string(),
            value,
            covered_nanos,
            snapshots: 0,
        }
    }

    #[test]
    fn snapshot_values_average_per_instance_then_sum_across_instances() {
        // Instance a: 4 snapshots of 100 each; instance b: 2 snapshots of 50 each.
        let rows = vec![
            SeriesRow {
                snapshots: 4,
                ..row(10, "", "a", 400.0, 0)
            },
            SeriesRow {
                snapshots: 2,
                ..row(10, "", "b", 100.0, 0)
            },
        ];
        let series = sum_series(fold_series_rows(&rows).values());
        assert_eq!(series[0].value, 150.0);
        assert_eq!(series[0].rate, None);
    }

    #[test]
    fn grouped_snapshot_values_divide_by_the_instance_snapshot_count() {
        // Thread t1 is in snapshots {1,2}, t2 in {3,4}: the instance has 4 snapshots, not 2.
        let mut rows = vec![
            SeriesRow {
                snapshots: 2,
                ..row(10, "t1", "a", 80.0, 0)
            },
            SeriesRow {
                snapshots: 2,
                ..row(10, "t2", "a", 40.0, 0)
            },
        ];
        let ungrouped = vec![SeriesRow {
            snapshots: 4,
            ..row(10, "", "a", 120.0, 0)
        }];
        apply_instance_snapshots(&mut rows, &ungrouped);
        let by_group = fold_series_rows(&rows);
        assert_eq!(by_group["t1"][&10].value, 20.0);
        assert_eq!(by_group["t2"][&10].value, 10.0);
        assert_eq!(sum_series(by_group.values())[0].value, 30.0);
    }

    #[test]
    fn instance_rate_divides_by_covered_seconds() {
        // 5 s of CPU recorded in 5 s of profiling = 1 core.
        assert_eq!(instance_rate(5e9, 5_000_000_000), Some(1e9));
        assert_eq!(instance_rate(5e9, 0), None);
        assert_eq!(add_rates(Some(1.0), None), Some(1.0));
        assert_eq!(add_rates(None, None), None);
        assert_eq!(add_rates(Some(1.0), Some(2.5)), Some(3.5));
    }

    #[test]
    fn rate_sums_instances_with_covered_time_and_skips_the_rest() {
        let rows = vec![
            row(10, "", "a", 10e9, 5_000_000_000),
            row(10, "", "b", 3e9, 0),
            row(20, "", "a", 1e9, 0),
        ];
        let series = sum_series(fold_series_rows(&rows).values());
        assert_eq!(series.len(), 2);
        assert_eq!(series[0].value, 13e9);
        assert_eq!(series[0].rate, Some(2e9));
        assert_eq!(series[1].rate, None);
    }

    #[test]
    fn rate_uses_instance_coverage_across_groups() {
        // One process split by a sample label; only one row carries the profiled time.
        let rows = vec![
            row(10, "t1", "a", 4e9, 2_000_000_000),
            row(10, "t2", "a", 6e9, 0),
        ];
        let by_group = fold_series_rows(&rows);
        assert_eq!(by_group["t1"][&10].rate, Some(2e9));
        assert_eq!(by_group["t2"][&10].rate, Some(3e9));
        let series = sum_series(by_group.values());
        assert_eq!(series[0].rate, Some(5e9));
        assert_eq!(series[0].value, 10e9);
    }

    #[test]
    fn rank_groups_keeps_top_values_and_sums_the_rest_into_others() {
        let rows = vec![
            row(10, "big", "", 100.0, 0),
            row(10, "mid", "", 50.0, 0),
            row(20, "mid", "", 5.0, 0),
            row(10, "small", "", 1.0, 0),
            row(20, "", "", 2.0, 0),
        ];
        let groups = rank_groups(fold_series_rows(&rows), 2);
        let summary: Vec<(&str, f64, bool)> = groups
            .iter()
            .map(|g| (g.value.as_str(), g.total, g.others))
            .collect();
        assert_eq!(
            summary,
            vec![("big", 100.0, false), ("mid", 55.0, false), ("", 3.0, true)]
        );
        let others: Vec<(i64, f64)> = groups[2]
            .series
            .iter()
            .map(|p| (p.timestamp, p.value))
            .collect();
        assert_eq!(others, vec![(10, 1.0), (20, 2.0)]);

        let all = rank_groups(fold_series_rows(&rows), 50);
        assert_eq!(all.len(), 4);
        assert!(all.iter().all(|g| !g.others));
    }

    #[test]
    fn series_sql_without_group_or_split_matches_the_plain_query() {
        let sql = series_sql(r#""default""#, "30 second", "", None, None);
        assert_eq!(
            sql,
            r#"SELECT histogram(_timestamp, '30 second') AS zo_sql_key, sum(value) AS zo_sql_num FROM "default" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC"#
        );
    }

    #[test]
    fn series_sql_splits_by_group_and_instance() {
        let split = InstanceSplit {
            key_expr: r#"concat("host_name", '|', "process_pid")"#.to_string(),
            covered: true,
            snapshots: false,
        };
        let sql = series_sql(
            r#""default""#,
            "1 minute",
            r#""service_name" = 'api'"#,
            Some("k8s_pod_name"),
            Some(&split),
        );
        assert!(
            sql.contains(r#""k8s_pod_name" AS zo_group, concat("host_name", '|', "process_pid") AS zo_instance"#),
            "{sql}"
        );
        assert!(
            sql.contains(r#"sum("profile_duration_nanos") AS zo_covered"#),
            "{sql}"
        );
        assert!(
            sql.contains(
                r#"WHERE "service_name" = 'api' GROUP BY zo_sql_key, zo_group, zo_instance"#
            ),
            "{sql}"
        );
    }

    #[test]
    fn instance_split_needs_the_duration_column_or_a_snapshot_type() {
        let old: Vec<String> = ["value", "host_name"].map(String::from).to_vec();
        assert!(instance_split(&old, false).is_none());
        let inuse = instance_split(&old, true).unwrap();
        assert!(inuse.snapshots && !inuse.covered);
        assert_eq!(inuse.key_expr, r#"concat("host_name")"#);

        let new: Vec<String> = ["value", PROFILE_DURATION_COLUMN]
            .map(String::from)
            .to_vec();
        let cpu = instance_split(&new, false).unwrap();
        assert!(cpu.covered && !cpu.snapshots);
        assert_eq!(cpu.key_expr, "''");
        let inuse_sql = series_sql(
            r#""default""#,
            "1 minute",
            "",
            None,
            instance_split(&new, true).as_ref(),
        );
        assert!(
            inuse_sql.contains("count(DISTINCT _timestamp) AS zo_snapshots"),
            "{inuse_sql}"
        );
        assert!(!inuse_sql.contains("zo_covered"), "{inuse_sql}");
    }
}

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
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::meta::traces::session::quote_identifier;
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    profiles::query::{
        is_filterable_column, is_meta_dimension_column, is_safe_filter_key, normalize_tag_key,
    },
};
use serde::Serialize;
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesSqlParams, build_where_clause, check_stream_permission, hit_string,
    parse_time_range_from_params, query_body_from_params, resolve_timeout, run_profiles_sql,
};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesTagValuesResponse {
    pub tag: String,
    pub values: Vec<String>,
    pub took: u64,
}

/// GetProfilesTagValues
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/profiles/tag_values",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "GetProfilesTagValues",
    summary = "List distinct values for a profile tag key",
    description = "After meta.label_names, call with one selected tag (e.g. k8s_pod_name) for the Tags Filter value list.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
        ("tag" = String, Query, description = "Tag column from meta.label_names, e.g. k8s_pod_name"),
        ("start_time" = i64, Query, description = "Start time in microseconds"),
        ("end_time" = i64, Query, description = "End time in microseconds"),
        ("data_source" = Option<String>, Query, description = "Narrow by otel_scope_name"),
        ("service_name" = Option<String>, Query, description = "Narrow by service_name"),
        ("profile_type" = Option<String>, Query, description = "Narrow by profile_type"),
        ("profile_unit" = Option<String>, Query, description = "Narrow by profile_unit"),
        ("filters" = Option<String>, Query, description = "Extra tag filters as key=value,key2=value2"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds"),
    ),
    responses(
        (status = 200, description = "Success", body = ProfilesTagValuesResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn get_profiles_tag_values(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let tag = match params
        .get("tag")
        .or_else(|| params.get("field"))
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
    {
        Some(tag) => openobserve_core::profiles::query::normalize_tag_key(tag),
        None => return MetaHttpResponse::bad_request("tag is required"),
    };
    if !is_safe_filter_key(&tag) || !is_filterable_column(&tag) {
        return MetaHttpResponse::bad_request(format!(
            "tag must be a filterable profile tag column, got: {tag}"
        ));
    }
    if is_meta_dimension_column(&tag) {
        return MetaHttpResponse::bad_request(format!(
            "tag {tag} is provided by /profiles/meta; use tag_values only for Tags Filter keys"
        ));
    }

    let (start_time, end_time) = match parse_time_range_from_params(&params) {
        Ok(range) => range,
        Err(response) => return response,
    };
    let mut body = query_body_from_params(&params);
    body.start_time = start_time;
    body.end_time = end_time;
    // Drop filters that target the tag whose values we are listing.
    body.filters.retain(|f| normalize_tag_key(&f.key) != tag);

    let where_clause = match build_where_clause(&body) {
        Ok(w) => w,
        Err(response) => return response,
    };
    let timeout = match resolve_timeout(body.timeout) {
        Ok(v) => v,
        Err(response) => return response,
    };

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let tag_q = quote_identifier(&tag);
    let stream = quote_identifier(&stream_name);
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
            "SELECT DISTINCT {tag_q} AS value FROM {stream} \
             WHERE {tag_q} IS NOT NULL ORDER BY value"
        )
    } else {
        format!(
            "SELECT DISTINCT {tag_q} AS value FROM {stream} \
             WHERE {tag_q} IS NOT NULL AND ({where_clause}) ORDER BY value"
        )
    };

    let response = match run_profiles_sql(&sql_params, sql, 10_000, http_span).await {
        Ok(r) => r,
        Err(response) => return response,
    };

    let mut values: Vec<String> = response
        .hits
        .iter()
        .filter_map(|hit| hit_string(hit, "value"))
        .filter(|s| !s.is_empty())
        .collect();
    values.sort();
    values.dedup();

    Json(ProfilesTagValuesResponse {
        tag,
        values,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}

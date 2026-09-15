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
use config::meta::{stream::StreamType, traces::session::quote_identifier};
use hashbrown::HashMap;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, profiles::query::label_names_from_schema_fields};
use serde::Serialize;
use tracing::{Span, warn};
use utoipa::ToSchema;

use super::{
    ProfilesSqlParams, check_stream_permission, hit_string, parse_time_range_from_params,
    resolve_timeout, run_profiles_sql,
};
use crate::common::utils::http::get_or_create_trace_id;

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfileTypeMeta {
    #[serde(rename = "type")]
    pub profile_type: String,
    pub unit: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesMetaResponse {
    pub data_sources: Vec<String>,
    pub services: Vec<String>,
    pub profile_types: Vec<ProfileTypeMeta>,
    pub label_names: Vec<String>,
    pub took: u64,
}

/// GetProfilesMeta
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/{stream_name}/profiles/meta",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "GetProfilesMeta",
    summary = "Discover profile data sources, services, and types",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
        ("start_time" = i64, Query, description = "Start time in microseconds"),
        ("end_time" = i64, Query, description = "End time in microseconds"),
        ("timeout" = Option<i64>, Query, description = "Query timeout in seconds"),
    ),
    responses(
        (status = 200, description = "Success", body = ProfilesMetaResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn get_profiles_meta(
    Path((org_id, stream_name)): Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let (start_time, end_time) = match parse_time_range_from_params(&params) {
        Ok(range) => range,
        Err(response) => return response,
    };
    let timeout = match resolve_timeout(params.get("timeout").and_then(|v| v.parse().ok())) {
        Ok(v) => v,
        Err(response) => return response,
    };

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let stream = quote_identifier(&stream_name);
    // Flattened tags are columns: label_names come from the stream schema.
    let label_names = discover_label_names(&org_id, &stream_name).await;
    let sql_params = ProfilesSqlParams {
        request_trace_id: &request_trace_id,
        org_id: &org_id,
        user_id: &user_email.user_id,
        start_time,
        end_time,
        timeout,
    };

    let (data_sources_res, services_res, profile_types_res) = tokio::join!(
        distinct_values(&sql_params, &stream, "otel_scope_name", http_span.clone()),
        distinct_values(&sql_params, &stream, "service_name", http_span.clone()),
        load_profile_types(&sql_params, &stream, http_span),
    );

    let data_sources = match data_sources_res {
        Ok(v) => v,
        Err(response) => return response,
    };
    let services = match services_res {
        Ok(v) => v,
        Err(response) => return response,
    };
    let profile_types = match profile_types_res {
        Ok(v) => v,
        Err(response) => return response,
    };

    Json(ProfilesMetaResponse {
        data_sources,
        services,
        profile_types,
        label_names,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}

async fn distinct_values(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    field: &str,
    http_span: Span,
) -> Result<Vec<String>, Response> {
    let field_q = quote_identifier(field);
    let sql = format!(
        "SELECT DISTINCT {field_q} AS value FROM {stream} WHERE {field_q} IS NOT NULL ORDER BY value"
    );
    let response = run_profiles_sql(params, sql, 10_000, http_span).await?;
    let mut values: Vec<String> = response
        .hits
        .iter()
        .filter_map(|hit| hit_string(hit, "value"))
        .filter(|s| !s.is_empty())
        .collect();
    values.sort();
    values.dedup();
    Ok(values)
}

async fn discover_label_names(org_id: &str, stream_name: &str) -> Vec<String> {
    match infra::schema::get(org_id, stream_name, StreamType::Profiles).await {
        Ok(schema) => {
            label_names_from_schema_fields(schema.fields().iter().map(|f| f.name().as_str()))
        }
        Err(e) => {
            warn!("profiles meta schema lookup failed, returning empty label_names: {e}");
            Vec::new()
        }
    }
}

async fn load_profile_types(
    params: &ProfilesSqlParams<'_>,
    stream: &str,
    http_span: Span,
) -> Result<Vec<ProfileTypeMeta>, Response> {
    let type_q = quote_identifier("profile_type");
    let unit_q = quote_identifier("profile_unit");
    let sql = format!(
        "SELECT {type_q} AS profile_type, {unit_q} AS profile_unit \
         FROM {stream} WHERE {type_q} IS NOT NULL \
         GROUP BY profile_type, profile_unit ORDER BY profile_type"
    );
    let response = run_profiles_sql(params, sql, 10_000, http_span).await?;
    let mut out = Vec::new();
    let mut seen = hashbrown::HashSet::new();
    for hit in &response.hits {
        let profile_type = hit_string(hit, "profile_type").unwrap_or_default();
        if profile_type.is_empty() {
            continue;
        }
        let unit = hit_string(hit, "profile_unit").unwrap_or_default();
        let key = format!("{profile_type}\0{unit}");
        if seen.insert(key) {
            out.push(ProfileTypeMeta { profile_type, unit });
        }
    }
    Ok(out)
}

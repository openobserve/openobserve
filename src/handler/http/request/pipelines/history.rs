// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpRequest, HttpResponse, get, web};
use chrono::{Duration, Utc};
use config::{
    META_ORG_ID,
    meta::{
        search::{Query, Request as SearchRequest},
        self_reporting::usage::TRIGGERS_STREAM,
        stream::StreamType,
    },
    utils::time::now_micros,
};
use serde::{Deserialize, Serialize};
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{auth::UserEmail, http::get_or_create_trace_id},
    },
    handler::http::extractors::Headers,
    service::{
        db::pipeline::list_by_org as list_pipelines,
        search::{self as SearchService},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineHistoryQuery {
    /// Filter by specific pipeline name
    pub pipeline_name: Option<String>,
    /// Start time in Unix timestamp microseconds
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds
    pub end_time: Option<i64>,
    /// Pagination offset
    pub from: Option<i64>,
    /// Number of results to return
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PipelineHistoryEntry {
    pub timestamp: i64,
    pub pipeline_name: String,
    pub org: String,
    pub status: String,
    pub is_realtime: bool,
    pub is_silenced: bool,
    pub start_time: i64,
    pub end_time: i64,
    pub retries: i32,
    pub error: Option<String>,
    pub success_response: Option<String>,
    pub is_partial: Option<bool>,
    pub delay_in_secs: Option<i64>,
    pub evaluation_took_in_secs: Option<f64>,
    pub source_node: Option<String>,
    pub query_took: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PipelineHistoryResponse {
    pub total: usize,
    pub from: i64,
    pub size: i64,
    pub hits: Vec<PipelineHistoryEntry>,
}

/// GetPipelineHistory
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "GetPipelineHistory",
    summary = "Get pipeline execution history",
    description = "Retrieves the execution history of pipelines for the organization. This endpoint queries the _meta organization's triggers stream to provide details about when pipelines were triggered, their status, and execution details.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("pipeline_name" = Option<String>, Query, description = "Filter by specific pipeline name"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds"),
        ("from" = Option<i64>, Query, description = "Pagination offset (default: 0)"),
        ("size" = Option<i64>, Query, description = "Number of results to return (default: 100, max: 1000)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PipelineHistoryResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
)]
#[get("/{org_id}/pipelines/history")]
pub async fn get_pipeline_history(
    path: web::Path<String>,
    query: web::Query<PipelineHistoryQuery>,
    Headers(user_email): Headers<UserEmail>,
    req: HttpRequest,
) -> HttpResponse {
    let org_id = path.into_inner();
    let query = query.into_inner();

    // Set default pagination values
    let from = query.from.unwrap_or(0).max(0);
    let size = query.size.unwrap_or(100).clamp(1, 1000);

    // Set default time range (last 7 days if not specified)
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::try_days(7).unwrap()).timestamp_micros());

    // Validate time range
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }

    // Get all pipeline names for the organization to validate the filter
    let pipeline_names = match get_organization_pipeline_names(&org_id).await {
        Ok(names) => names,
        Err(e) => {
            log::error!("Failed to get pipeline names for org {}: {}", org_id, e);
            return MetaHttpResponse::internal_error(format!("Failed to get pipeline names: {e}"));
        }
    };

    // If pipeline_name filter is provided, validate it exists
    if let Some(ref pipeline_name) = query.pipeline_name
        && !pipeline_names.contains(pipeline_name)
    {
        return MetaHttpResponse::not_found(format!(
            "Pipeline '{pipeline_name}' not found in organization"
        ));
    }

    // Helper function to escape pipeline names for SQL LIKE patterns
    fn escape_like(input: &str) -> String {
        let mut escaped = String::with_capacity(input.len());
        for c in input.chars() {
            match c {
                '\\' => escaped.push_str(r"\\"),
                '%' => escaped.push_str(r"\%"),
                '_' => escaped.push_str(r"\_"),
                '\'' => escaped.push_str("''"),
                _ => escaped.push(c),
            }
        }
        escaped
    }

    // Build base SQL WHERE clause
    let mut where_clause = format!(
        "(module in ('derived_stream', 'pipeline')) AND org = '{org_id}' AND _timestamp >= {start_time} AND _timestamp <= {end_time}"
    );

    // Add pipeline name filter if provided
    // The key field contains the pipeline name in the format "pipeline_name/pipeline_id"
    if let Some(ref pipeline_name) = query.pipeline_name {
        // We need to filter where key starts with the pipeline name
        let escaped_name = escape_like(pipeline_name);
        where_clause.push_str(&format!(" AND key LIKE '{escaped_name}\\/%' ESCAPE '\\'"));
    } else if !pipeline_names.is_empty() {
        // Filter by all pipelines in the organization
        let pipeline_filter = pipeline_names
            .iter()
            .map(|name| format!("key LIKE '%{}%'", name.replace("'", "''")))
            .collect::<Vec<_>>()
            .join(" OR ");
        where_clause.push_str(&format!(" AND ({pipeline_filter})"));
    } else {
        // No pipelines in the organization, return empty result
        return MetaHttpResponse::json(PipelineHistoryResponse {
            total: 0,
            from,
            size,
            hits: vec![],
        });
    }

    // Get trace ID for the request
    let trace_id = get_or_create_trace_id(req.headers(), &Span::current());

    // Step 1: Get the total count of matching records
    // Build count query (no LIMIT/OFFSET, will be rewritten to COUNT(*) by track_total_hits)
    let count_sql = format!("SELECT _timestamp FROM \"{TRIGGERS_STREAM}\" WHERE {where_clause}");

    let count_req = SearchRequest {
        query: Query {
            sql: count_sql,
            start_time,
            end_time,
            from: 0,
            size: 1,                // We only need the count, not the actual records
            track_total_hits: true, // This triggers the COUNT(*) rewrite
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };

    let total_count = match SearchService::search(
        &trace_id,
        META_ORG_ID,
        StreamType::Logs,
        Some(user_email.user_id.clone()),
        &count_req,
    )
    .instrument(Span::current())
    .await
    {
        Ok(result) => result.total,
        Err(e) => {
            log::error!("Failed to get pipeline history count: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to get pipeline history count: {e}"
            ));
        }
    };

    // If no results or offset is beyond total, return empty
    if total_count == 0 || from >= total_count as i64 {
        return MetaHttpResponse::json(PipelineHistoryResponse {
            total: total_count,
            from,
            size,
            hits: vec![],
        });
    }

    // Step 2: Get the actual paginated results
    // Build data query with LIMIT/OFFSET for pagination
    let data_sql = format!(
        "SELECT _timestamp, org, key, status, is_realtime, is_silenced, \
         start_time, end_time, retries, \
         delay_in_secs, evaluation_took_in_secs, \
         source_node, query_took \
         FROM \"{TRIGGERS_STREAM}\" \
         WHERE {where_clause} \
         ORDER BY _timestamp DESC LIMIT {size} OFFSET {from}"
    );

    let data_req = SearchRequest {
        query: Query {
            sql: data_sql,
            start_time,
            end_time,
            from: 0,
            size,
            track_total_hits: false, // We already have the total, just get the data
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };

    // Execute search against _meta organization's triggers stream
    let search_result = match SearchService::search(
        &trace_id,
        META_ORG_ID,
        StreamType::Logs,
        Some(user_email.user_id.clone()),
        &data_req,
    )
    .instrument(Span::current())
    .await
    {
        Ok(result) => result,
        Err(e) => {
            log::error!("Failed to search pipeline history: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to search pipeline history: {e}"
            ));
        }
    };

    // Parse the search results into PipelineHistoryEntry objects
    let mut entries = Vec::new();
    for hit in search_result.hits {
        // Extract pipeline name from key field (format: "pipeline_name/pipeline_id")
        let key = hit.get("key").and_then(|v| v.as_str()).unwrap_or("");

        let mut pipeline_name = key.split('/').nth(2).unwrap_or("").to_string();

        // Skip if pipeline_name is empty
        if pipeline_name.is_empty() {
            pipeline_name = key.to_string();
        }

        entries.push(PipelineHistoryEntry {
            timestamp: hit.get("_timestamp").and_then(|v| v.as_i64()).unwrap_or(0),
            pipeline_name,
            org: hit
                .get("org")
                .and_then(|v| v.as_str())
                .unwrap_or(&org_id)
                .to_string(),
            status: hit
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            is_realtime: hit
                .get("is_realtime")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            is_silenced: hit
                .get("is_silenced")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            start_time: hit.get("start_time").and_then(|v| v.as_i64()).unwrap_or(0),
            end_time: hit.get("end_time").and_then(|v| v.as_i64()).unwrap_or(0),
            retries: hit.get("retries").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            error: hit.get("error").and_then(|v| v.as_str()).map(String::from),
            success_response: hit
                .get("success_response")
                .and_then(|v| v.as_str())
                .map(String::from),
            is_partial: hit.get("is_partial").and_then(|v| v.as_bool()),
            delay_in_secs: hit.get("delay_in_secs").and_then(|v| v.as_i64()),
            evaluation_took_in_secs: hit.get("evaluation_took_in_secs").and_then(|v| v.as_f64()),
            source_node: hit
                .get("source_node")
                .and_then(|v| v.as_str())
                .map(String::from),
            query_took: hit.get("query_took").and_then(|v| v.as_i64()),
        });
    }

    // Build response with the accurate total count
    let response = PipelineHistoryResponse {
        total: total_count, // Use the count from the first query, not search_result.total
        from,
        size,
        hits: entries,
    };

    MetaHttpResponse::json(response)
}

/// Helper function to get all pipeline names for an organization
async fn get_organization_pipeline_names(org_id: &str) -> Result<Vec<String>, anyhow::Error> {
    // Get all pipelines for the organization
    let pipelines = list_pipelines(org_id).await?;

    // Extract pipeline names
    let names: Vec<String> = pipelines
        .into_iter()
        .map(|pipeline| pipeline.name)
        .collect();

    Ok(names)
}

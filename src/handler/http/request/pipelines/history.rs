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
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
use chrono::{Duration, Utc};
use config::{
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        self_reporting::usage::TRIGGERS_STREAM,
        stream::StreamType,
    },
    utils::time::now_micros,
};
#[cfg(feature = "enterprise")]
use o2_openfga::{config::get_config as get_openfga_config, meta::mapping::OFGA_MODELS};
use serde::{Deserialize, Serialize};
use tracing::{Instrument, Span};
use utoipa::ToSchema;

#[cfg(feature = "enterprise")]
use crate::handler::http::auth::validator::list_objects_for_user;
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{auth::UserEmail, http::get_or_create_trace_id},
    },
    handler::http::{extractors::Headers, request::alerts::history::escape_like},
    service::{
        db::pipeline::list_by_org as list_pipelines,
        search::{self as SearchService},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineHistoryQuery {
    /// Filter by specific pipeline name
    pub pipeline_id: Option<String>,
    /// Start time in Unix timestamp microseconds
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds
    pub end_time: Option<i64>,
    /// Pagination offset
    pub from: Option<i64>,
    /// Number of results to return
    pub size: Option<i64>,
    /// Field to sort by (timestamp, pipeline_name, status, is_realtime, is_silenced, start_time,
    /// end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node,
    /// query_took, is_partial)
    pub sort_by: Option<String>,
    /// Sort order (asc or desc, default: desc)
    pub sort_order: Option<String>,
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
///
/// # Security Note
/// The `user_id` header used by the `UserEmail` extractor is set by the authentication
/// middleware after validating the user's credentials (token/session/basic auth).
/// See `src/handler/http/auth/validator.rs::validator()` for the middleware implementation.
/// This prevents header forgery attacks as the header is populated server-side after
/// authentication.
#[utoipa::path(
    get,
    path = "/{org_id}/pipelines/history",
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
        ("pipeline_id" = Option<String>, Query, description = "Filter by specific pipeline id"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds"),
        ("from" = Option<i64>, Query, description = "Pagination offset (default: 0)"),
        ("size" = Option<i64>, Query, description = "Number of results to return (default: 100, max: 1000)"),
        ("sort_by" = Option<String>, Query, description = "Field to sort by: timestamp, pipeline_name, status, is_realtime, is_silenced, start_time, end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node, query_took, is_partial (default: timestamp)"),
        ("sort_order" = Option<String>, Query, description = "Sort order: asc or desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PipelineHistoryResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
)]
pub async fn get_pipeline_history(
    Path(org_id): Path<String>,
    Query(query): Query<PipelineHistoryQuery>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
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

    // Validate and map sort_by field to SQL column name or expression
    let sort_column = if let Some(ref sort_by) = query.sort_by {
        match sort_by.to_lowercase().as_str() {
            "timestamp" => "_timestamp",
            "pipeline_name" => "key", // pipeline_name is extracted from key field
            "status" => "status",
            "is_realtime" => "is_realtime",
            "is_silenced" => "is_silenced",
            "start_time" => "start_time",
            "end_time" => "end_time",
            "duration" => "(end_time - start_time)", // Calculated field
            "retries" => "retries",
            "delay_in_secs" => "delay_in_secs",
            "evaluation_took_in_secs" => "evaluation_took_in_secs",
            "source_node" => "source_node",
            "query_took" => "query_took",
            _ => {
                return MetaHttpResponse::bad_request(format!(
                    "Invalid sort_by field: '{sort_by}'. Valid fields are: timestamp, pipeline_name, status, is_realtime, is_silenced, start_time, end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node, query_took"
                ));
            }
        }
    } else {
        "_timestamp" // Default sort by timestamp
    };

    // Validate sort_order
    let sort_order = if let Some(ref order) = query.sort_order {
        match order.to_lowercase().as_str() {
            "asc" => "ASC",
            "desc" => "DESC",
            _ => {
                return MetaHttpResponse::bad_request(format!(
                    "Invalid sort_order: '{order}'. Valid values are: asc, desc"
                ));
            }
        }
    } else {
        "DESC" // Default sort order
    };

    // Get all pipeline IDs for the organization to validate the filter
    let pipeline_ids = match get_organization_pipeline_ids(&org_id).await {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("Failed to get pipeline IDs for org {}: {}", org_id, e);
            return MetaHttpResponse::internal_error(format!("Failed to get pipeline IDs: {e}"));
        }
    };

    // If pipeline_name filter is provided, validate it exists
    if let Some(ref pipeline_id) = query.pipeline_id
        && !pipeline_ids.contains(pipeline_id)
    {
        return MetaHttpResponse::not_found(format!(
            "Pipeline '{pipeline_id}' not found in organization"
        ));
    }

    // RBAC: Check permissions and filter by accessible pipelines
    #[cfg(not(feature = "enterprise"))]
    let permitted_pipeline_ids: Option<Vec<String>> = None;

    // RBAC: Check permissions for the requested pipeline(s)
    #[cfg(feature = "enterprise")]
    let permitted_pipeline_ids = {
        use crate::common::utils::auth::is_root_user;

        let user_id = &user_email.user_id;
        if is_root_user(user_id) {
            None
        }
        // If RBAC is enabled, check permissions
        else if get_openfga_config().enabled {
            let user = match crate::service::users::get_user(Some(&org_id), user_id).await {
                Some(user) => user,
                None => {
                    return MetaHttpResponse::forbidden("User not found");
                }
            };

            let role = user.role.to_string();

            // If specific pipeline_name is requested, check access to it
            if let Some(ref pipeline_name) = query.pipeline_id {
                let pipeline_obj = format!(
                    "{}:{}",
                    OFGA_MODELS.get("pipelines").unwrap().key,
                    pipeline_name
                );

                let has_permission = o2_openfga::authorizer::authz::is_allowed(
                    &org_id,
                    user_id,
                    "GET",
                    &pipeline_obj,
                    "",
                    &role,
                )
                .await;

                if !has_permission {
                    return MetaHttpResponse::forbidden(format!(
                        "Access denied to pipeline '{pipeline_name}'"
                    ));
                }

                // Means the user has the permission
                None
            } else {
                // List all history - filter by accessible pipelines
                let pipeline_object_type = OFGA_MODELS
                    .get("pipelines")
                    .map_or("pipelines", |model| model.key);

                match list_objects_for_user(&org_id, user_id, "GET", pipeline_object_type).await {
                    Ok(Some(permitted)) => {
                        // Check if user has access to all pipelines
                        let all_pipelines_key = format!("{pipeline_object_type}:_all_{org_id}");
                        if permitted.contains(&all_pipelines_key) {
                            // User has access to all pipelines
                            None
                        } else if permitted.is_empty() {
                            // User has no access to any pipelines, return empty result
                            return MetaHttpResponse::json(PipelineHistoryResponse {
                                total: 0,
                                from,
                                size,
                                hits: vec![],
                            });
                        } else {
                            // Extract pipeline IDs from permitted list
                            // Format: "{pipeline_object_type}:{pipeline_id}"
                            let permitted_pipeline_ids: Vec<String> = permitted
                                .iter()
                                .filter_map(|perm| {
                                    // Skip the _all_ entry if it somehow made it here
                                    if perm.contains("_all_") {
                                        return None;
                                    }
                                    // Extract the part after the colon
                                    perm.split(':').nth(1).map(|s| s.to_string())
                                })
                                .collect();

                            // Filter pipeline_ids to only include permitted ones
                            let filtered_pipelines: Vec<String> = pipeline_ids
                                .iter()
                                .filter(|id| permitted_pipeline_ids.contains(id))
                                .cloned()
                                .collect();

                            if filtered_pipelines.is_empty() {
                                // After filtering, user has no access to any existing pipelines
                                return MetaHttpResponse::json(PipelineHistoryResponse {
                                    total: 0,
                                    from,
                                    size,
                                    hits: vec![],
                                });
                            }

                            Some(filtered_pipelines)
                        }
                    }
                    Ok(None) => {
                        // RBAC is disabled or user is root - allow access to all pipelines
                        None
                    }
                    Err(e) => {
                        return MetaHttpResponse::forbidden(e.to_string());
                    }
                }
            }
        } else {
            // RBAC disabled, allow all pipelines
            None
        }
    };

    // Build SQL WHERE clause for the _meta organization's triggers stream
    let mut where_clause = format!(
        "(module in ('derived_stream', 'pipeline')) AND org = '{org_id}' AND _timestamp >= {start_time} AND _timestamp <= {end_time}"
    );

    // Add pipeline ID filter if provided
    // The key field contains the pipeline ID in the format "pipeline_name/pipeline_id"
    if let Some(ref pipeline_id) = query.pipeline_id {
        // We need to filter where key starts with the pipeline ID
        let escaped_name = escape_like(pipeline_id);
        where_clause.push_str(&format!(" AND key LIKE '%/{escaped_name}%'"));
    } else if let Some(permitted_ids) = permitted_pipeline_ids {
        // Filter by permitted pipelines only
        if permitted_ids.is_empty() {
            // No accessible pipelines, return empty result
            return MetaHttpResponse::json(PipelineHistoryResponse {
                total: 0,
                from,
                size,
                hits: vec![],
            });
        }

        let pipeline_filter = permitted_ids
            .iter()
            .map(|id| {
                let escaped_id = escape_like(id);
                format!("key LIKE '%{}%'", escaped_id.replace("'", "''"))
            })
            .collect::<Vec<_>>()
            .join(" OR ");
        where_clause.push_str(&format!(" AND ({pipeline_filter})"));
    }
    // If permitted_pipeline_ids is Ok(None), user has access to all pipelines
    // No additional filter needed in WHERE clause

    // Get trace ID for the request
    let trace_id = get_or_create_trace_id(&headers, &Span::current());

    // Step 1: Get the total count of matching records
    // Build count query (no LIMIT/OFFSET, will be rewritten to COUNT(*) by track_total_hits)
    let count_sql = format!("SELECT _timestamp FROM \"{TRIGGERS_STREAM}\" WHERE {where_clause}");
    log::info!("Pipeline history sql {count_sql}");

    let count_req = SearchRequest {
        query: SearchQuery {
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
        &org_id,
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
         ORDER BY {sort_column} {sort_order} LIMIT {size} OFFSET {from}"
    );
    log::info!("Pipeline history data_sql: {data_sql}");

    let data_req = SearchRequest {
        query: SearchQuery {
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
        &org_id,
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

/// Helper function to get all pipeline IDs for an organization
async fn get_organization_pipeline_ids(org_id: &str) -> Result<Vec<String>, anyhow::Error> {
    // Get all pipelines for the organization
    let pipelines = list_pipelines(org_id).await?;

    // Extract pipeline IDs
    let ids: Vec<String> = pipelines.into_iter().map(|pipeline| pipeline.id).collect();

    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_history_query_defaults() {
        let query = PipelineHistoryQuery {
            pipeline_id: None,
            start_time: None,
            end_time: None,
            from: None,
            size: None,
            sort_by: None,
            sort_order: None,
        };

        assert!(query.pipeline_id.is_none());
        assert!(query.start_time.is_none());
        assert!(query.end_time.is_none());
        assert!(query.from.is_none());
        assert!(query.size.is_none());
        assert!(query.sort_by.is_none());
        assert!(query.sort_order.is_none());
    }

    #[test]
    fn test_pipeline_history_query_with_values() {
        let query = PipelineHistoryQuery {
            pipeline_id: Some("test_pipeline".to_string()),
            start_time: Some(1234567890000000),
            end_time: Some(1234567990000000),
            from: Some(0),
            size: Some(50),
            sort_by: Some("status".to_string()),
            sort_order: Some("asc".to_string()),
        };

        assert_eq!(query.pipeline_id, Some("test_pipeline".to_string()));
        assert_eq!(query.start_time, Some(1234567890000000));
        assert_eq!(query.end_time, Some(1234567990000000));
        assert_eq!(query.from, Some(0));
        assert_eq!(query.size, Some(50));
        assert_eq!(query.sort_by, Some("status".to_string()));
        assert_eq!(query.sort_order, Some("asc".to_string()));
    }

    #[test]
    fn test_pipeline_history_query_with_sorting() {
        // Test sorting parameters for different fields
        let sort_fields = vec![
            "timestamp",
            "pipeline_name",
            "status",
            "is_realtime",
            "is_silenced",
            "start_time",
            "end_time",
            "duration",
            "retries",
            "delay_in_secs",
            "evaluation_took_in_secs",
            "source_node",
            "query_took",
            "is_partial",
        ];

        for field in sort_fields {
            let query = PipelineHistoryQuery {
                pipeline_id: None,
                start_time: None,
                end_time: None,
                from: None,
                size: None,
                sort_by: Some(field.to_string()),
                sort_order: Some("asc".to_string()),
            };

            assert_eq!(query.sort_by, Some(field.to_string()));
            assert_eq!(query.sort_order, Some("asc".to_string()));
        }
    }

    #[test]
    fn test_pipeline_history_query_sort_order_options() {
        // Test ascending order
        let query_asc = PipelineHistoryQuery {
            pipeline_id: None,
            start_time: None,
            end_time: None,
            from: None,
            size: None,
            sort_by: Some("timestamp".to_string()),
            sort_order: Some("asc".to_string()),
        };
        assert_eq!(query_asc.sort_order, Some("asc".to_string()));

        // Test descending order
        let query_desc = PipelineHistoryQuery {
            pipeline_id: None,
            start_time: None,
            end_time: None,
            from: None,
            size: None,
            sort_by: Some("timestamp".to_string()),
            sort_order: Some("desc".to_string()),
        };
        assert_eq!(query_desc.sort_order, Some("desc".to_string()));
    }

    #[test]
    fn test_pipeline_history_entry_serialization() {
        let entry = PipelineHistoryEntry {
            timestamp: 1640995200000000,
            pipeline_name: "test_pipeline".to_string(),
            org: "test_org".to_string(),
            status: "success".to_string(),
            is_realtime: true,
            is_silenced: false,
            start_time: 1640995100000000,
            end_time: 1640995200000000,
            retries: 0,
            error: None,
            success_response: Some("OK".to_string()),
            is_partial: Some(false),
            delay_in_secs: Some(10),
            evaluation_took_in_secs: Some(1.5),
            source_node: Some("node1".to_string()),
            query_took: Some(500),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: PipelineHistoryEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.timestamp, entry.timestamp);
        assert_eq!(deserialized.pipeline_name, entry.pipeline_name);
        assert_eq!(deserialized.org, entry.org);
        assert_eq!(deserialized.status, entry.status);
        assert_eq!(deserialized.is_realtime, entry.is_realtime);
        assert_eq!(deserialized.is_silenced, entry.is_silenced);
    }

    #[test]
    fn test_pipeline_history_response_serialization() {
        let entry = PipelineHistoryEntry {
            timestamp: 1640995200000000,
            pipeline_name: "test_pipeline".to_string(),
            org: "test_org".to_string(),
            status: "success".to_string(),
            is_realtime: true,
            is_silenced: false,
            start_time: 1640995100000000,
            end_time: 1640995200000000,
            retries: 0,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
        };

        let response = PipelineHistoryResponse {
            total: 1,
            from: 0,
            size: 10,
            hits: vec![entry],
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: PipelineHistoryResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total, 1);
        assert_eq!(deserialized.from, 0);
        assert_eq!(deserialized.size, 10);
        assert_eq!(deserialized.hits.len(), 1);
    }

    #[test]
    fn test_pipeline_history_entry_with_error() {
        let entry = PipelineHistoryEntry {
            timestamp: 1640995200000000,
            pipeline_name: "failed_pipeline".to_string(),
            org: "test_org".to_string(),
            status: "error".to_string(),
            is_realtime: false,
            is_silenced: false,
            start_time: 1640995100000000,
            end_time: 1640995200000000,
            retries: 3,
            error: Some("Connection timeout".to_string()),
            success_response: None,
            is_partial: Some(true),
            delay_in_secs: Some(5),
            evaluation_took_in_secs: Some(2.5),
            source_node: Some("node2".to_string()),
            query_took: Some(1000),
        };

        assert_eq!(entry.status, "error");
        assert!(entry.error.is_some());
        assert_eq!(entry.error.unwrap(), "Connection timeout");
        assert_eq!(entry.retries, 3);
    }

    #[test]
    fn test_pipeline_history_response_empty() {
        let response = PipelineHistoryResponse {
            total: 0,
            from: 0,
            size: 10,
            hits: vec![],
        };

        assert_eq!(response.total, 0);
        assert_eq!(response.hits.len(), 0);
    }

    #[test]
    fn test_pipeline_history_response_pagination() {
        let entry = PipelineHistoryEntry {
            timestamp: 1640995200000000,
            pipeline_name: "test_pipeline".to_string(),
            org: "test_org".to_string(),
            status: "success".to_string(),
            is_realtime: true,
            is_silenced: false,
            start_time: 1640995100000000,
            end_time: 1640995200000000,
            retries: 0,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
        };

        let response = PipelineHistoryResponse {
            total: 100,
            from: 50,
            size: 10,
            hits: vec![entry],
        };

        assert_eq!(response.total, 100);
        assert_eq!(response.from, 50);
        assert_eq!(response.size, 10);
        assert_eq!(response.hits.len(), 1);
    }
}

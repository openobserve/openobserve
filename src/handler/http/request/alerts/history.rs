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
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{auth::UserEmail, http::get_or_create_trace_id},
    },
    handler::http::extractors::Headers,
    service::{
        alerts::alert::get_by_id,
        search::{self as SearchService},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistoryQuery {
    /// Filter by specific alert name
    pub alert_id: Option<Ksuid>,
    /// Start time in Unix timestamp microseconds
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds
    pub end_time: Option<i64>,
    /// Pagination offset
    pub from: Option<i64>,
    /// Number of results to return
    pub size: Option<i64>,
    /// Field to sort by (timestamp, alert_name, status, is_realtime, is_silenced, start_time,
    /// end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node,
    /// query_took)
    pub sort_by: Option<String>,
    /// Sort order (asc or desc, default: desc)
    pub sort_order: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AlertHistoryEntry {
    pub timestamp: i64,
    pub alert_name: String,
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
    // Deduplication information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dedup_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dedup_suppressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dedup_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_size: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AlertHistoryResponse {
    pub total: usize,
    pub from: i64,
    pub size: i64,
    pub hits: Vec<AlertHistoryEntry>,
}

// Helper function to escape alert names for SQL LIKE patterns
pub fn escape_like(input: impl AsRef<str>) -> String {
    let input = input.as_ref();
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

/// GetAlertHistory
///
/// # Security Note
/// The `user_id` header used by the `UserEmail` extractor is set by the authentication
/// middleware after validating the user's credentials (token/session/basic auth).
/// See `src/handler/http/auth/validator.rs::validator()` for the middleware implementation.
/// This prevents header forgery attacks as the header is populated server-side after
/// authentication.
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/history",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertHistory",
    summary = "Get alert execution history",
    description = "Retrieves the execution history of alerts for the organization. This endpoint queries the organization's own triggers stream to provide details about when alerts were triggered, their status, and execution details.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = Option<String>, Query, description = "Filter by specific alert id"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds"),
        ("from" = Option<i64>, Query, description = "Pagination offset (default: 0)"),
        ("size" = Option<i64>, Query, description = "Number of results to return (default: 100, max: 1000)"),
        ("sort_by" = Option<String>, Query, description = "Field to sort by: timestamp, alert_name, status, is_realtime, is_silenced, start_time, end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node, query_took (default: timestamp)"),
        ("sort_order" = Option<String>, Query, description = "Sort order: asc or desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertHistoryResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
)]
pub async fn get_alert_history(
    Path(org_id): Path<String>,
    Query(query): Query<AlertHistoryQuery>,
    Headers(user_email): Headers<UserEmail>,
    req: axum::http::Request<axum::body::Body>,
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
            "alert_name" => "key", // alert_name is extracted from key field
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
                    "Invalid sort_by field: '{sort_by}'. Valid fields are: timestamp, alert_name, status, is_realtime, is_silenced, start_time, end_time, duration, retries, delay_in_secs, evaluation_took_in_secs, source_node, query_took"
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

    // If alert_id filter is provided, validate it exists
    let _folder_id = if let Some(alert_id) = query.alert_id {
        // Verify the alert exists in the organization
        let conn = infra::db::ORM_CLIENT
            .get_or_init(infra::db::connect_to_orm)
            .await;
        match get_by_id(conn, &org_id, alert_id).await {
            Ok((f, _)) => Some(f.folder_id),
            Err(_) => {
                return MetaHttpResponse::not_found(format!(
                    "Alert '{alert_id}' not found in organization"
                ));
            }
        }
    } else {
        None
    };

    // RBAC: Check permissions and filter by accessible alerts
    #[cfg(not(feature = "enterprise"))]
    let permitted_alert_ids: Option<Vec<String>> = None;

    // RBAC: Check permissions for the requested alert(s)
    #[cfg(feature = "enterprise")]
    let permitted_alert_ids = {
        let user_id = &user_email.user_id;
        use crate::common::utils::auth::is_root_user;
        if is_root_user(user_id) {
            None
        }
        // If RBAC is enabled, check permissions
        else if o2_openfga::config::get_config().enabled {
            let user = match crate::service::users::get_user(Some(&org_id), user_id).await {
                Some(user) => user,
                None => {
                    return MetaHttpResponse::forbidden("User not found");
                }
            };

            let role = user.role.to_string();

            // If specific alert_id is requested, check access to it
            if let Some(ref alert_id) = query.alert_id {
                let folder_id = _folder_id.clone().unwrap_or_default();
                let alert_obj = format!(
                    "{}:{}",
                    o2_openfga::meta::mapping::OFGA_MODELS
                        .get("alerts")
                        .unwrap()
                        .key,
                    alert_id
                );

                let has_permission = o2_openfga::authorizer::authz::is_allowed(
                    &org_id, user_id, "GET", &alert_obj, &folder_id, &role,
                )
                .await;

                if !has_permission {
                    return MetaHttpResponse::forbidden(format!(
                        "Access denied to alert '{alert_id}'"
                    ));
                }

                // User has permission to this specific alert
                None
            } else {
                // List all history - filter by accessible alerts
                let alert_object_type = o2_openfga::meta::mapping::OFGA_MODELS
                    .get("alerts")
                    .map_or("alerts", |model| model.key);

                match crate::handler::http::auth::validator::list_objects_for_user(
                    &org_id,
                    user_id,
                    "GET",
                    alert_object_type,
                )
                .await
                {
                    Ok(Some(permitted)) => {
                        // Check if user has access to all alerts
                        let all_alerts_key = format!("{alert_object_type}:_all_{org_id}");
                        if permitted.contains(&all_alerts_key) {
                            // User has access to all alerts
                            None
                        } else if permitted.is_empty() {
                            // User has no access to any alerts, return empty result
                            return MetaHttpResponse::json(AlertHistoryResponse {
                                total: 0,
                                from,
                                size,
                                hits: vec![],
                            });
                        } else {
                            // Extract alert IDs from permitted list
                            // Format: "{alert_object_type}:{alert_id}"
                            let permitted_alert_ids: Vec<String> = permitted
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

                            Some(permitted_alert_ids)
                        }
                    }
                    Ok(None) => {
                        // RBAC is disabled or user is root - allow access to all alerts
                        None
                    }
                    Err(e) => {
                        return MetaHttpResponse::forbidden(e.to_string());
                    }
                }
            }
        } else {
            // RBAC disabled, allow all alerts
            None
        }
    };

    // Build SQL WHERE clause for the _meta organization's triggers stream
    let mut where_clause = format!(
        "module = 'alert' AND org = '{org_id}' AND _timestamp >= {start_time} AND _timestamp <= {end_time}"
    );

    // Add alert ID filter if provided
    // The key field contains the alert ID in the format "alert_name/alert_id"
    if let Some(ref alert_id) = query.alert_id {
        // We need to filter where key ends with the alert ID
        where_clause.push_str(&format!(" AND key LIKE '%{alert_id}'"))
    } else if let Some(permitted_ids) = permitted_alert_ids {
        // Filter by permitted alerts only
        if permitted_ids.is_empty() {
            // No accessible alerts, return empty result
            return MetaHttpResponse::json(AlertHistoryResponse {
                total: 0,
                from,
                size,
                hits: vec![],
            });
        }

        let alert_filter = permitted_ids
            .iter()
            .map(|id| {
                let escaped_id = escape_like(id);
                format!("key LIKE '%{}%'", escaped_id.replace("'", "''"))
            })
            .collect::<Vec<_>>()
            .join(" OR ");
        where_clause.push_str(&format!(" AND ({alert_filter})"));
    }
    // If permitted_alert_ids is None, user has access to all alerts
    // No additional filter needed in WHERE clause

    // Get trace ID for the request
    let trace_id = get_or_create_trace_id(req.headers(), &Span::current());

    // Step 1: Get the total count of matching records
    // Build count query (no LIMIT/OFFSET, will be rewritten to COUNT(*) by track_total_hits)
    let count_sql = format!("SELECT _timestamp FROM \"{TRIGGERS_STREAM}\" WHERE {where_clause}");

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
            log::error!("Failed to get alert history count: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to get alert history count: {e}"
            ));
        }
    };

    // If no results or offset is beyond total, return empty
    if total_count == 0 || from >= total_count as i64 {
        return MetaHttpResponse::json(AlertHistoryResponse {
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

    // Execute search against organization's own triggers stream
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
            log::error!("Failed to search alert history: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to search alert history: {e}"
            ));
        }
    };

    // Parse the search results into AlertHistoryEntry objects
    let mut entries = Vec::new();
    for hit in search_result.hits {
        // Extract alert name from key field (format: "alert_name/alert_id")
        let key = hit.get("key").and_then(|v| v.as_str()).unwrap_or("");

        let alert_name = key.split('/').next().unwrap_or("").to_string();

        // Skip if alert_name is empty
        if alert_name.is_empty() {
            continue;
        }

        entries.push(AlertHistoryEntry {
            timestamp: hit.get("_timestamp").and_then(|v| v.as_i64()).unwrap_or(0),
            alert_name,
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
            // Deduplication fields - populated from trigger data if available
            dedup_enabled: hit.get("dedup_enabled").and_then(|v| v.as_bool()),
            dedup_suppressed: hit.get("dedup_suppressed").and_then(|v| v.as_bool()),
            dedup_count: hit
                .get("dedup_count")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32),
            grouped: hit.get("grouped").and_then(|v| v.as_bool()),
            group_size: hit
                .get("group_size")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32),
        });
    }

    // Build response with the accurate total count
    let response = AlertHistoryResponse {
        total: total_count, // Use the count from the first query, not search_result.total
        from,
        size,
        hits: entries,
    };

    MetaHttpResponse::json(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_history_query_defaults() {
        let query = AlertHistoryQuery {
            alert_id: None,
            start_time: None,
            end_time: None,
            from: None,
            size: None,
            sort_by: None,
            sort_order: None,
        };

        assert!(query.alert_id.is_none());
        assert!(query.start_time.is_none());
        assert!(query.end_time.is_none());
        assert!(query.from.is_none());
        assert!(query.size.is_none());
        assert!(query.sort_by.is_none());
        assert!(query.sort_order.is_none());
    }

    #[test]
    fn test_alert_history_entry_creation() {
        let entry = AlertHistoryEntry {
            timestamp: 1234567890000000,
            alert_name: "test_alert".to_string(),
            org: "test_org".to_string(),
            status: "firing".to_string(),
            is_realtime: true,
            is_silenced: false,
            start_time: 1234567800000000,
            end_time: 1234567900000000,
            retries: 0,
            error: None,
            success_response: Some("Alert sent successfully".to_string()),
            is_partial: Some(false),
            delay_in_secs: Some(5),
            evaluation_took_in_secs: Some(1.5),
            source_node: Some("node1".to_string()),
            query_took: Some(100),
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        };

        assert_eq!(entry.alert_name, "test_alert");
        assert_eq!(entry.status, "firing");
        assert!(entry.is_realtime);
        assert!(!entry.is_silenced);
        assert_eq!(entry.retries, 0);
        assert!(entry.error.is_none());
        assert!(entry.success_response.is_some());
    }

    #[test]
    fn test_alert_history_response_creation() {
        let response = AlertHistoryResponse {
            total: 100,
            from: 0,
            size: 50,
            hits: vec![],
        };

        assert_eq!(response.total, 100);
        assert_eq!(response.from, 0);
        assert_eq!(response.size, 50);
        assert_eq!(response.hits.len(), 0);
    }

    #[test]
    fn test_alert_history_response_with_entries() {
        let entry = AlertHistoryEntry {
            timestamp: 1234567890000000,
            alert_name: "test_alert".to_string(),
            org: "test_org".to_string(),
            status: "ok".to_string(),
            is_realtime: false,
            is_silenced: false,
            start_time: 1234567800000000,
            end_time: 1234567900000000,
            retries: 0,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        };

        let response = AlertHistoryResponse {
            total: 1,
            from: 0,
            size: 50,
            hits: vec![entry],
        };

        assert_eq!(response.total, 1);
        assert_eq!(response.hits.len(), 1);
        assert_eq!(response.hits[0].alert_name, "test_alert");
        assert_eq!(response.hits[0].status, "ok");
    }

    #[test]
    fn test_alert_history_entry_with_error() {
        let entry = AlertHistoryEntry {
            timestamp: 1234567890000000,
            alert_name: "failing_alert".to_string(),
            org: "test_org".to_string(),
            status: "error".to_string(),
            is_realtime: true,
            is_silenced: false,
            start_time: 1234567800000000,
            end_time: 1234567900000000,
            retries: 3,
            error: Some("Connection timeout".to_string()),
            success_response: None,
            is_partial: Some(true),
            delay_in_secs: Some(10),
            evaluation_took_in_secs: Some(5.5),
            source_node: Some("node2".to_string()),
            query_took: Some(500),
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        };

        assert_eq!(entry.status, "error");
        assert_eq!(entry.retries, 3);
        assert!(entry.error.is_some());
        assert_eq!(entry.error.unwrap(), "Connection timeout");
        assert!(entry.is_partial.unwrap());
    }

    #[test]
    fn test_alert_history_pagination() {
        // Test pagination parameters
        let query = AlertHistoryQuery {
            alert_id: None,
            start_time: None,
            end_time: None,
            from: Some(100),
            size: Some(25),
            sort_by: None,
            sort_order: None,
        };

        assert_eq!(query.from.unwrap(), 100);
        assert_eq!(query.size.unwrap(), 25);
    }

    #[test]
    fn test_alert_history_query_with_sorting() {
        // Test sorting parameters for different fields
        let sort_fields = vec![
            "timestamp",
            "alert_name",
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
        ];

        for field in sort_fields {
            let query = AlertHistoryQuery {
                alert_id: None,
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
    fn test_alert_history_query_sort_order_options() {
        // Test ascending order
        let query_asc = AlertHistoryQuery {
            alert_id: None,
            start_time: None,
            end_time: None,
            from: None,
            size: None,
            sort_by: Some("timestamp".to_string()),
            sort_order: Some("asc".to_string()),
        };
        assert_eq!(query_asc.sort_order, Some("asc".to_string()));

        // Test descending order
        let query_desc = AlertHistoryQuery {
            alert_id: None,
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
    fn test_escape_like_basic() {
        // Test with normal string (no SQL special characters except underscore)
        assert_eq!(escape_like("normalstring"), "normalstring");
        assert_eq!(escape_like("alert123"), "alert123");
        assert_eq!(escape_like(""), "");
        assert_eq!(escape_like("simple-text"), "simple-text");
    }

    #[test]
    fn test_escape_like_backslash() {
        // Test escaping backslash
        assert_eq!(escape_like("path\\to\\file"), r"path\\to\\file");
        assert_eq!(escape_like("\\"), r"\\");
        assert_eq!(escape_like("\\\\"), r"\\\\");
    }

    #[test]
    fn test_escape_like_percent() {
        // Test escaping percent sign (SQL wildcard)
        assert_eq!(escape_like("50%"), r"50\%");
        assert_eq!(escape_like("%wildcard%"), r"\%wildcard\%");
        assert_eq!(escape_like("100% success"), r"100\% success");
    }

    #[test]
    fn test_escape_like_underscore() {
        // Test escaping underscore (SQL wildcard)
        assert_eq!(escape_like("alert_name"), r"alert\_name");
        assert_eq!(escape_like("_prefix"), r"\_prefix");
        assert_eq!(escape_like("suffix_"), r"suffix\_");
    }

    #[test]
    fn test_escape_like_single_quote() {
        // Test escaping single quote (SQL string delimiter)
        assert_eq!(escape_like("it's"), "it''s");
        assert_eq!(escape_like("'quoted'"), "''quoted''");
        assert_eq!(escape_like("O'Brien"), "O''Brien");
    }

    #[test]
    fn test_escape_like_multiple_special_chars() {
        // Test multiple special characters in one string
        assert_eq!(escape_like("100%_test"), r"100\%\_test");
        assert_eq!(escape_like("path\\with_50%"), r"path\\with\_50\%");
        assert_eq!(escape_like("It's 100%!"), r"It''s 100\%!");
    }

    #[test]
    fn test_escape_like_all_special_chars() {
        // Test all special characters together
        assert_eq!(escape_like(r"\%_'combined"), r"\\\%\_''combined");
    }

    #[test]
    fn test_escape_like_unicode() {
        // Test with unicode characters (should pass through unchanged)
        assert_eq!(escape_like("alert_テスト"), r"alert\_テスト");
        assert_eq!(escape_like("🔔_notification"), r"🔔\_notification");
        assert_eq!(escape_like("алерт_name"), r"алерт\_name");
    }

    #[test]
    fn test_escape_like_sql_injection_patterns() {
        // Test common SQL injection patterns
        assert_eq!(escape_like("' OR '1'='1"), "'' OR ''1''=''1");
        assert_eq!(escape_like("admin'--"), "admin''--");
        assert_eq!(escape_like("'; DROP TABLE--"), "''; DROP TABLE--");
    }

    #[test]
    fn test_escape_like_consecutive_special_chars() {
        // Test consecutive special characters
        assert_eq!(escape_like("%%"), r"\%\%");
        assert_eq!(escape_like("__"), r"\_\_");
        assert_eq!(escape_like("''"), "''''");
        assert_eq!(escape_like(r"\\"), r"\\\\");
    }

    #[test]
    fn test_escape_like_whitespace() {
        // Test that whitespace is preserved
        assert_eq!(escape_like("alert name"), "alert name");
        assert_eq!(escape_like("  spaces  "), "  spaces  ");
        assert_eq!(escape_like("new\nline"), "new\nline");
        assert_eq!(escape_like("tab\there"), "tab\there");
    }

    #[test]
    fn test_escape_like_real_world_alert_names() {
        // Test with realistic alert name patterns
        assert_eq!(escape_like("cpu_usage_>_80%"), r"cpu\_usage\_>\_80\%");
        assert_eq!(escape_like("disk_full_/var/log"), r"disk\_full\_/var/log");
        assert_eq!(escape_like("error_rate_'high'"), r"error\_rate\_''high''");
    }

    #[test]
    fn test_alert_history_entry_serialization() {
        let entry = AlertHistoryEntry {
            timestamp: 1640995200000000,
            alert_name: "test_alert".to_string(),
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
            dedup_enabled: Some(true),
            dedup_suppressed: Some(false),
            dedup_count: Some(1),
            grouped: Some(false),
            group_size: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: AlertHistoryEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.timestamp, entry.timestamp);
        assert_eq!(deserialized.alert_name, entry.alert_name);
        assert_eq!(deserialized.org, entry.org);
        assert_eq!(deserialized.status, entry.status);
        assert_eq!(deserialized.dedup_enabled, entry.dedup_enabled);
    }

    #[test]
    fn test_alert_history_response_serialization() {
        let entry = AlertHistoryEntry {
            timestamp: 1640995200000000,
            alert_name: "test_alert".to_string(),
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
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        };

        let response = AlertHistoryResponse {
            total: 1,
            from: 0,
            size: 10,
            hits: vec![entry],
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: AlertHistoryResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total, 1);
        assert_eq!(deserialized.from, 0);
        assert_eq!(deserialized.size, 10);
        assert_eq!(deserialized.hits.len(), 1);
    }
}

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

use std::str::FromStr;

use actix_web::{HttpRequest, HttpResponse, get, web};
use chrono::{Duration, Utc};
use config::{
    meta::{
        search::{Query, Request as SearchRequest},
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
    handler::http::extractors::Headers,
    service::{
        alerts::alert::get_by_id,
        search::{self as SearchService},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistoryQuery {
    /// Filter by specific alert name
    pub alert_id: Option<String>,
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
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertHistoryResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
)]
#[get("/{org_id}/alerts/history")]
pub async fn get_alert_history(
    path: web::Path<String>,
    query: web::Query<AlertHistoryQuery>,
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

    // If alert_id filter is provided, validate it exists
    let folder_id = if let Some(ref alert_id) = query.alert_id {
        // Try to parse the alert_id as Ksuid
        match svix_ksuid::Ksuid::from_str(alert_id) {
            Ok(ksuid) => {
                // Verify the alert exists in the organization
                let conn = infra::db::ORM_CLIENT
                    .get_or_init(infra::db::connect_to_orm)
                    .await;
                match get_by_id(conn, &org_id, ksuid).await {
                    Ok((f, _)) => Some(f.folder_id),
                    Err(_) => {
                        return MetaHttpResponse::not_found(format!(
                            "Alert '{alert_id}' not found in organization"
                        ));
                    }
                }
            }
            Err(_) => {
                return MetaHttpResponse::bad_request(format!(
                    "Invalid alert_id format: '{alert_id}'"
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
        else if get_openfga_config().enabled {
            let user = match crate::service::users::get_user(Some(&org_id), user_id).await {
                Some(user) => user,
                None => {
                    return MetaHttpResponse::forbidden("User not found");
                }
            };

            let role = user.role.to_string();

            // If specific alert_name is requested, check access to it
            if let Some(ref alert_id) = query.alert_id {
                let folder_id = folder_id.unwrap_or_default();
                let alert_obj = format!("{}:{}", OFGA_MODELS.get("alerts").unwrap().key, alert_id);

                let has_permission = o2_openfga::authorizer::authz::is_allowed(
                    &org_id, user_id, "GET", &alert_obj, &folder_id, &role,
                )
                .await;

                if !has_permission {
                    return MetaHttpResponse::forbidden(format!(
                        "Access denied to alert '{alert_id}'"
                    ));
                }

                // Means the user has the permission
                None
            } else {
                // List all history - filter by accessible alerts
                let alert_object_type = OFGA_MODELS
                    .get("alerts")
                    .map_or("alerts", |model| model.key);

                match list_objects_for_user(&org_id, user_id, "GET", alert_object_type).await {
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
    if let Some(ref alert_name) = query.alert_id {
        // We need to filter where key starts with the alert ID
        let escaped_name = escape_like(alert_name);
        where_clause.push_str(&format!(" AND key LIKE '{escaped_name}\\/%' ESCAPE '\\'"));
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
    // If permitted_alert_ids is Ok(None), user has access to all alerts
    // No additional filter needed in WHERE clause

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
        };

        assert!(query.alert_id.is_none());
        assert!(query.start_time.is_none());
        assert!(query.end_time.is_none());
        assert!(query.from.is_none());
        assert!(query.size.is_none());
    }

    #[test]
    fn test_alert_history_query_with_values() {
        let query = AlertHistoryQuery {
            alert_id: Some("test_alert".to_string()),
            start_time: Some(1234567890000000),
            end_time: Some(1234567990000000),
            from: Some(0),
            size: Some(50),
        };

        assert_eq!(query.alert_id, Some("test_alert".to_string()));
        assert_eq!(query.start_time, Some(1234567890000000));
        assert_eq!(query.end_time, Some(1234567990000000));
        assert_eq!(query.from, Some(0));
        assert_eq!(query.size, Some(50));
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
        };

        assert_eq!(query.from.unwrap(), 100);
        assert_eq!(query.size.unwrap(), 25);
    }
}

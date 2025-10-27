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
        self_reporting::usage::TRIGGERS_USAGE_STREAM,
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::scheduler::TRIGGERS_KEY;
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
        db::alerts::alert::list as list_alerts,
        search::{self as SearchService},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertHistoryQuery {
    /// Filter by specific alert name
    pub alert_name: Option<String>,
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

/// GetAlertHistory
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertHistory",
    summary = "Get alert execution history",
    description = "Retrieves the execution history of alerts for the organization. This endpoint queries the _meta organization's triggers stream to provide details about when alerts were triggered, their status, and execution details.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_name" = Option<String>, Query, description = "Filter by specific alert name"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds"),
        ("from" = Option<i64>, Query, description = "Pagination offset (default: 0)"),
        ("size" = Option<i64>, Query, description = "Number of results to return (default: 100, max: 1000)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AlertHistoryResponse),
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
    let size = query.size.unwrap_or(100).min(1000).max(1);

    // Set default time range (last 7 days if not specified)
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::try_days(7).unwrap()).timestamp_micros());

    // Validate time range
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }

    // Get all alert names for the organization to validate the filter
    let alert_names = match get_organization_alert_names(&org_id).await {
        Ok(names) => names,
        Err(e) => {
            log::error!("Failed to get alert names for org {}: {}", org_id, e);
            return MetaHttpResponse::internal_error(format!("Failed to get alert names: {}", e));
        }
    };

    // If alert_name filter is provided, validate it exists
    if let Some(ref alert_name) = query.alert_name {
        if !alert_names.contains(alert_name) {
            return MetaHttpResponse::not_found(format!(
                "Alert '{}' not found in organization",
                alert_name
            ));
        }
    }

    // Build SQL query for the _meta organization's triggers stream
    let mut sql = format!(
        "SELECT _timestamp, org, key, status, is_realtime, is_silenced, \
         start_time, end_time, retries, \
         delay_in_secs, evaluation_took_in_secs, \
         source_node, query_took \
         FROM \"{}\" \
         WHERE module = 'alert' AND org = '{}' AND _timestamp >= {} AND _timestamp <= {}",
        TRIGGERS_USAGE_STREAM, org_id, start_time, end_time
    );

    // Add alert name filter if provided
    // The key field contains the alert name in the format "alert_name/alert_id"
    if let Some(ref alert_name) = query.alert_name {
        // We need to filter where key starts with the alert name
        sql.push_str(&format!(" AND key LIKE '{}/%'", alert_name));
    } else if !alert_names.is_empty() {
        // Filter by all alerts in the organization
        let alert_filter = alert_names
            .iter()
            .map(|name| format!("key LIKE '{}/%'", name))
            .collect::<Vec<_>>()
            .join(" OR ");
        sql.push_str(&format!(" AND ({})", alert_filter));
    } else {
        // No alerts in the organization, return empty result
        return MetaHttpResponse::json(AlertHistoryResponse {
            total: 0,
            from,
            size,
            hits: vec![],
        });
    }

    // Add ordering and pagination
    sql.push_str(&format!(
        " ORDER BY _timestamp DESC LIMIT {} OFFSET {}",
        size, from
    ));

    // Create search request for _meta organization
    let search_req = SearchRequest {
        query: Query {
            sql: sql.clone(),
            start_time,
            end_time,
            from: 0,
            size,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };

    // Get trace ID for the request
    let trace_id = get_or_create_trace_id(req.headers(), &Span::current());

    // Execute search against _meta organization's triggers stream
    let search_result = match SearchService::search(
        &trace_id,
        META_ORG_ID,
        StreamType::Logs,
        Some(user_email.user_id.clone()),
        &search_req,
    )
    .instrument(Span::current())
    .await
    {
        Ok(result) => result,
        Err(e) => {
            log::error!("Failed to search alert history: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to search alert history: {}",
                e
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

    // Build response
    let response = AlertHistoryResponse {
        total: search_result.total,
        from,
        size,
        hits: entries,
    };

    MetaHttpResponse::json(response)
}

/// Helper function to get all alert names for an organization
async fn get_organization_alert_names(org_id: &str) -> Result<Vec<String>, anyhow::Error> {
    // Get all alerts for the organization
    let alerts = list_alerts(org_id, None, None).await?;

    // Extract alert names
    let names: Vec<String> = alerts.into_iter().map(|alert| alert.name).collect();

    Ok(names)
}

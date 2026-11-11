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
    META_ORG_ID,
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        stream::StreamType,
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::{
    common::{auditor::AUDIT_STREAM, config::get_config},
    security::audit::{SecurityAuditEvent, audit_sql, event},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::alerts::history::validate_history_range,
};

const DEFAULT_SIZE: i64 = 100;
const MAX_SIZE: i64 = 500;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SecurityAuditQuery {
    /// Start time in Unix timestamp microseconds (default: 7 days ago).
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds (default: now).
    pub end_time: Option<i64>,
    pub from: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SecurityAuditResponse {
    /// False when the deployment does not record an audit trail.
    pub audit_enabled: bool,
    pub start_time: i64,
    pub end_time: i64,
    pub events: Vec<SecurityAuditEvent>,
}

/// ListSecurityAudit
#[utoipa::path(
    get,
    path = "/{org_id}/security/audit",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecurityAudit",
    summary = "Changes to the org's Security configuration",
    description = "Who changed SIEM detections, Security source streams and cases, and when, read from the audit trail so the org's own SOC can review it; newest first",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds (default: 7 days ago)"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds (default: now)"),
        ("from" = Option<i64>, Query, description = "Offset of the first event"),
        ("size" = Option<i64>, Query, description = "Events per page (default 100, at most 500)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SecurityAuditResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_security_audit(
    Path(org_id): Path<String>,
    Query(query): Query<SecurityAuditQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !super::security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Security audit needs the Security permission");
    }
    let (start_time, end_time, from, size) = match page(&query) {
        Ok(page) => page,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let response = SecurityAuditResponse {
        start_time,
        end_time,
        ..Default::default()
    };
    match search_audit(&org_id, response, from, size).await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => {
            log::error!("Failed to read the Security audit trail: {e}");
            MetaHttpResponse::internal_error(format!(
                "Failed to read the Security audit trail: {e}"
            ))
        }
    }
}

async fn search_audit(
    org_id: &str,
    mut response: SecurityAuditResponse,
    from: i64,
    size: i64,
) -> Result<SecurityAuditResponse, anyhow::Error> {
    if !get_config().common.audit_enabled {
        return Ok(response);
    }
    response.audit_enabled = true;
    // The stream exists only once the first audit row is written, and a search of it errors.
    let schema = infra::schema::get(META_ORG_ID, AUDIT_STREAM, StreamType::Logs).await?;
    if schema.fields().is_empty() {
        return Ok(response);
    }
    let sql = audit_sql(
        AUDIT_STREAM,
        org_id,
        schema.field_with_name("target").is_ok(),
    );
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time: response.start_time,
            end_time: response.end_time,
            from,
            size,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    let result = search_service::search(&trace_id, META_ORG_ID, StreamType::Logs, None, &req)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    response.events = result.hits.iter().map(event).collect();
    Ok(response)
}

/// The defaulted, validated window and page of a request.
fn page(query: &SecurityAuditQuery) -> Result<(i64, i64, i64, i64), &'static str> {
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::try_days(7).unwrap()).timestamp_micros());
    validate_history_range(start_time, end_time)?;
    let from = query.from.unwrap_or(0);
    if from < 0 {
        return Err("from must not be negative");
    }
    let size = query.size.unwrap_or(DEFAULT_SIZE).clamp(1, MAX_SIZE);
    Ok((start_time, end_time, from, size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_page_validates_the_window_and_bounds_the_size() {
        let query = |start: i64, end: i64, size: Option<i64>| SecurityAuditQuery {
            start_time: Some(start),
            end_time: Some(end),
            from: None,
            size,
        };
        assert_eq!(page(&query(1, 2, None)), Ok((1, 2, 0, DEFAULT_SIZE)));
        assert_eq!(page(&query(1, 2, Some(9_999))).unwrap().3, MAX_SIZE);
        assert_eq!(page(&query(1, 2, Some(-3))).unwrap().3, 1);
        assert!(page(&query(i64::MIN, 2, None)).is_err());
        assert!(page(&query(1, i64::MAX, None)).is_err());
        assert!(page(&query(2, 1, None)).is_err());
        let negative = SecurityAuditQuery {
            from: Some(-1),
            ..query(1, 2, None)
        };
        assert!(page(&negative).is_err());
    }

    #[tokio::test]
    async fn test_a_caller_without_the_security_grant_is_refused() {
        let resp = list_security_audit(
            Path("org".to_string()),
            Query(SecurityAuditQuery::default()),
            Headers(UserEmail {
                user_id: format!("{}@example.com", config::ider::uuid()),
            }),
        )
        .await;
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
    }
}

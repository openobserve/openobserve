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
use o2_enterprise::enterprise::security::history_summary as summary;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use search_service::query_range::get_settings_max_query_range;
use serde::{Deserialize, Serialize};
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use super::history::{
    alert_ids_predicate, parse_alert_ids, restrict_to_permitted, validate_history_range,
};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

/// Grouped rows fetched at most; reaching it marks the response partial.
const MAX_ROWS: i64 = 50_000;

#[derive(Debug, Clone, Deserialize)]
pub struct AlertHistorySummaryQuery {
    /// Start time in Unix timestamp microseconds (default: 7 days ago).
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds (default: now).
    pub end_time: Option<i64>,
    /// Requested bucket width in seconds; raised when the window needs fewer buckets.
    pub interval: Option<i64>,
    /// Comma-separated alert ids to include (default: every readable alert).
    pub alert_ids: Option<String>,
    /// Only the org's SIEM detections, resolved server-side (ignored when ids are given).
    pub siem: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AlertHistorySummaryResponse {
    pub start_time: i64,
    pub end_time: i64,
    /// Bucket width actually used, in seconds.
    pub interval: i64,
    /// Sum of `n` over all rows.
    pub total: i64,
    /// True when the grouped row cap was reached and counts are incomplete.
    pub is_partial: bool,
    pub rows: Vec<summary::AlertHistorySummaryRow>,
}

/// GetAlertHistorySummary
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/history/summary",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertHistorySummary",
    summary = "Count alert evaluations",
    description = "Counts alert evaluations per time bucket, alert and run outcome from the organization's triggers stream, so callers can chart and total history without paging raw rows.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix timestamp microseconds"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix timestamp microseconds"),
        ("interval" = Option<i64>, Query, description = "Bucket width in seconds, positive (default: 300; raised to keep at most 500 buckets)"),
        ("alert_ids" = Option<String>, Query, description = "Comma-separated alert ids to include, at most 500 (default: every readable alert)"),
        ("siem" = Option<bool>, Query, description = "Only SIEM detections, resolved by the server; ignored when alert_ids is set"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertHistorySummaryResponse)),
        (status = 400, description = "Bad Request: an invalid or over-limit alert_ids list, a non-positive interval, or an invalid time range", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"}))
    )
)]
pub async fn get_alert_history_summary(
    Path(org_id): Path<String>,
    Query(query): Query<AlertHistorySummaryQuery>,
    Headers(user_email): Headers<UserEmail>,
    req: axum::http::Request<axum::body::Body>,
) -> Response {
    let (start_time, end_time) = match clamped_range(&org_id, &user_email.user_id, &query).await {
        Ok(range) => range,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    if let Err(msg) = validate_interval(query.interval) {
        return MetaHttpResponse::bad_request(msg);
    }
    let interval =
        summary::bucket_interval_secs(query.interval, end_time.saturating_sub(start_time));
    let empty = || {
        MetaHttpResponse::json(AlertHistorySummaryResponse {
            start_time,
            end_time,
            interval,
            total: 0,
            is_partial: false,
            rows: vec![],
        })
    };

    let permitted = match permitted_alert_ids(&org_id, &user_email.user_id).await {
        Ok(permitted) => permitted,
        Err(resp) => return resp,
    };
    let ids = match query.alert_ids.as_deref().map(parse_alert_ids).transpose() {
        Ok(Some(ids)) => Some(restrict_to_permitted(ids, permitted.as_deref())),
        Ok(None) => permitted,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    if ids.as_ref().is_some_and(|ids| ids.is_empty()) {
        return empty();
    }

    let siem_rows = infra::schema::get(&org_id, TRIGGERS_STREAM, StreamType::Logs)
        .await
        .ok()
        .and_then(|schema| summary::siem_rows_predicate(&schema));
    let mut predicates = Vec::new();
    if query.siem == Some(true) && query.alert_ids.is_none() {
        let Some(siem_rows) = siem_rows.as_deref() else {
            return empty();
        };
        predicates.push(siem_rows.to_string());
    }
    if let Some(siem_rows) = siem_rows.as_deref()
        && !crate::request::security::security_allowed(&org_id, &user_email.user_id, "GET").await
    {
        predicates.push(format!("NOT {siem_rows}"));
    }

    let id_predicate = ids.as_deref().map(alert_ids_predicate);
    let sql = summary::summary_sql(
        &org_id,
        start_time,
        end_time,
        interval,
        id_predicate.as_deref(),
        &predicates,
    );
    let search_req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size: MAX_ROWS,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    let trace_id = get_or_create_trace_id(req.headers(), &Span::current());
    let result = match SearchService::search(
        &trace_id,
        &org_id,
        StreamType::Logs,
        Some(user_email.user_id.clone()),
        &search_req,
    )
    .instrument(Span::current())
    .await
    {
        Ok(result) => result,
        Err(e) => {
            // Triggers stream doesn't exist yet (no alert has ever run in this org).
            if e.to_string().to_lowercase().contains("not found") {
                return empty();
            }
            log::error!("Failed to summarize alert history: {e}");
            return MetaHttpResponse::internal_error(format!(
                "Failed to summarize alert history: {e}"
            ));
        }
    };

    let is_partial = result.is_partial || result.hits.len() as i64 >= MAX_ROWS;
    let rows = summary::summarize_hits(&result.hits);
    MetaHttpResponse::json(AlertHistorySummaryResponse {
        start_time,
        end_time,
        interval,
        total: rows.iter().map(|row| row.n).sum(),
        is_partial,
        rows,
    })
}

/// The request window with the same defaults and max-query-range clamp as raw history.
async fn clamped_range(
    org_id: &str,
    user_id: &str,
    query: &AlertHistorySummaryQuery,
) -> Result<(i64, i64), String> {
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::try_days(7).unwrap()).timestamp_micros());
    let max_hours =
        match infra::schema::get_settings(org_id, TRIGGERS_STREAM, StreamType::Logs).await {
            Some(settings) => {
                get_settings_max_query_range(settings.max_query_range, org_id, Some(user_id)).await
            }
            None => 0,
        };
    clamp_window(start_time, end_time, max_hours).map_err(str::to_string)
}

/// Raw history's max-range clamp and time validation, both overflow-safe for any `i64` input.
fn clamp_window(
    start_time: i64,
    end_time: i64,
    max_hours: i64,
) -> Result<(i64, i64), &'static str> {
    let start_time = config::utils::query_range::clamp_start_time(start_time, end_time, max_hours)
        .unwrap_or(start_time);
    validate_history_range(start_time, end_time)?;
    Ok((start_time, end_time))
}

/// A requested bucket width must be positive and fit in microseconds.
fn validate_interval(interval: Option<i64>) -> Result<(), &'static str> {
    match interval {
        Some(secs) if secs <= 0 || secs.checked_mul(1_000_000).is_none() => {
            Err("interval must be a positive number of seconds")
        }
        _ => Ok(()),
    }
}

/// Alert ids the user may read; `None` means all of them.
async fn permitted_alert_ids(org_id: &str, user_id: &str) -> Result<Option<Vec<String>>, Response> {
    if db::user::is_root_user(user_id) || !o2_openfga::config::get_config().enabled {
        return Ok(None);
    }
    if openobserve_core::users::get_user(Some(org_id), user_id)
        .await
        .is_none()
    {
        return Err(MetaHttpResponse::forbidden("User not found"));
    }
    let object_type = o2_openfga::meta::mapping::OFGA_MODELS
        .get("alerts")
        .map_or("alerts", |model| model.key);
    let permitted = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id,
        user_id,
        "GET",
        object_type,
    )
    .await
    .map_err(|e| MetaHttpResponse::forbidden(e.to_string()))?;
    let Some(permitted) = permitted else {
        return Ok(None);
    };
    if permitted.contains(&format!("{object_type}:_all_{org_id}")) {
        return Ok(None);
    }
    Ok(Some(
        permitted
            .iter()
            .filter(|perm| !perm.contains("_all_"))
            .filter_map(|perm| perm.split(':').nth(1).map(str::to_string))
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clamp_window_survives_extreme_bounds() {
        let hour = 3600 * 1_000_000;
        let now = 1_793_524_776_430_732;
        assert_eq!(clamp_window(i64::MIN, now, 24), Ok((now - 24 * hour, now)));
        assert!(clamp_window(i64::MIN, i64::MAX, 24).is_err());
        assert!(clamp_window(i64::MIN, i64::MAX, 0).is_err());
        assert!(clamp_window(5, 5, 0).is_err());
        assert_eq!(clamp_window(1, 10, 0), Ok((1, 10)));
        assert!(clamp_window(1, i64::MAX, 0).is_err());
    }

    #[test]
    fn test_validate_interval_rejects_intervals_that_overflow_or_are_not_positive() {
        for bad in [1 << 58, i64::MAX, 0, -5, i64::MIN] {
            assert!(validate_interval(Some(bad)).is_err(), "{bad}");
        }
        assert!(validate_interval(None).is_ok());
        assert!(validate_interval(Some(60)).is_ok());
    }
}

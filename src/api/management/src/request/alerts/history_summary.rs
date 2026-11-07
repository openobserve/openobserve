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
    extract::{Path, Query},
    response::Response,
};
use chrono::{Duration, Utc};
use config::{
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        self_reporting::usage::{TRIGGERS_STREAM, TriggerDataType, normalize_outcome},
        stream::StreamType,
    },
    utils::time::now_micros,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use search_service as SearchService;
use search_service::query_range::get_settings_max_query_range;
use serde::{Deserialize, Serialize};
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use super::history::{alert_ids_predicate, parse_alert_ids, restrict_to_permitted};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

/// Upper bound on buckets; a wider window gets a coarser interval instead.
const MAX_BUCKETS: i64 = 500;
const MIN_INTERVAL_SECS: i64 = 60;
const DEFAULT_INTERVAL_SECS: i64 = 300;
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

/// Evaluations of one alert with one outcome inside one time bucket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertHistorySummaryRow {
    /// Bucket start in Unix timestamp microseconds.
    pub bucket: i64,
    pub alert_id: String,
    /// Normalized run outcome, legacy values mapped; `unknown` when unrecognised.
    pub outcome: String,
    pub n: i64,
    /// How many of the `n` evaluations ran while the alert was silenced.
    pub silenced: i64,
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
    pub rows: Vec<AlertHistorySummaryRow>,
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
        ("interval" = Option<i64>, Query, description = "Bucket width in seconds (default: 300; raised to keep at most 500 buckets)"),
        ("alert_ids" = Option<String>, Query, description = "Comma-separated alert ids to include"),
        ("siem" = Option<bool>, Query, description = "Only SIEM detections, resolved by the server"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertHistorySummaryResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
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
    let interval = bucket_interval_secs(query.interval, end_time - start_time);
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
        Ok(None) if query.siem == Some(true) => Some(restrict_to_permitted(
            db::alerts::alert::resolve_siem_alert_ids(&org_id).await,
            permitted.as_deref(),
        )),
        Ok(None) => permitted,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    if ids.as_ref().is_some_and(|ids| ids.is_empty()) {
        return empty();
    }

    let sql = summary_sql(&org_id, start_time, end_time, interval, ids.as_deref());
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

    let is_partial = result.hits.len() as i64 >= MAX_ROWS;
    let rows = summarize_hits(&result.hits);
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
    let mut start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::try_days(7).unwrap()).timestamp_micros());
    if let Some(settings) =
        infra::schema::get_settings(org_id, TRIGGERS_STREAM, StreamType::Logs).await
    {
        let max_hours =
            get_settings_max_query_range(settings.max_query_range, org_id, Some(user_id)).await;
        if max_hours > 0 && (end_time - start_time) > max_hours * 3600 * 1_000_000 {
            start_time = end_time - max_hours * 3600 * 1_000_000;
        }
    }
    if start_time >= end_time {
        return Err("start_time must be before end_time".to_string());
    }
    Ok((start_time, end_time))
}

/// Alert ids the user may read; `None` means all of them.
#[cfg(not(feature = "enterprise"))]
async fn permitted_alert_ids(
    _org_id: &str,
    _user_id: &str,
) -> Result<Option<Vec<String>>, Response> {
    Ok(None)
}

/// Alert ids the user may read; `None` means all of them.
#[cfg(feature = "enterprise")]
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

fn bucket_interval_secs(requested: Option<i64>, range_micros: i64) -> i64 {
    let range_secs = (range_micros.max(0) + 999_999) / 1_000_000;
    let needed = (range_secs + MAX_BUCKETS - 1) / MAX_BUCKETS;
    requested
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .max(MIN_INTERVAL_SECS)
        .max(needed)
}

fn summary_sql(
    org_id: &str,
    start_time: i64,
    end_time: i64,
    interval_secs: i64,
    ids: Option<&[String]>,
) -> String {
    let interval_us = interval_secs * 1_000_000;
    let org = org_id.replace('\'', "''");
    // ids are validated KSUIDs, so they need no escaping.
    let mut where_clause = format!(
        "module = 'alert' AND org = '{org}' AND _timestamp >= {start_time} AND _timestamp <= {end_time}"
    );
    if let Some(ids) = ids {
        where_clause.push_str(&format!(" AND ({})", alert_ids_predicate(ids)));
    }
    format!(
        "SELECT (_timestamp / {interval_us}) * {interval_us} AS zo_bucket, key AS zo_key, \
         status AS zo_status, COUNT(*) AS zo_n, \
         SUM(CASE WHEN is_silenced THEN 1 ELSE 0 END) AS zo_silenced \
         FROM \"{TRIGGERS_STREAM}\" WHERE {where_clause} \
         GROUP BY zo_bucket, zo_key, zo_status"
    )
}

/// Turns grouped trigger rows into per-alert outcome counts, merging legacy statuses.
fn summarize_hits(hits: &[serde_json::Value]) -> Vec<AlertHistorySummaryRow> {
    let mut merged: BTreeMap<(i64, String, String), (i64, i64)> = BTreeMap::new();
    for hit in hits {
        let key = hit.get("zo_key").and_then(|v| v.as_str()).unwrap_or("");
        let (name, alert_id) = key.rsplit_once('/').unwrap_or(("", ""));
        // Raw history drops rows without an alert name (scheduler error rows keyed "/{id}").
        if name.is_empty() || alert_id.is_empty() {
            continue;
        }
        let outcome = hit
            .get("zo_status")
            .and_then(|v| v.as_str())
            .and_then(|raw| normalize_outcome(raw, &TriggerDataType::Alert, None))
            .map_or_else(|| "unknown".to_string(), |o| o.to_string());
        let bucket = hit.get("zo_bucket").and_then(|v| v.as_i64()).unwrap_or(0);
        let n = hit.get("zo_n").and_then(|v| v.as_i64()).unwrap_or(0);
        let silenced = hit.get("zo_silenced").and_then(|v| v.as_i64()).unwrap_or(0);
        let entry = merged
            .entry((bucket, alert_id.to_string(), outcome))
            .or_default();
        entry.0 += n;
        entry.1 += silenced;
    }
    merged
        .into_iter()
        .map(
            |((bucket, alert_id, outcome), (n, silenced))| AlertHistorySummaryRow {
                bucket,
                alert_id,
                outcome,
                n,
                silenced,
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_bucket_interval_keeps_bucket_count_bounded() {
        let day = 24 * 3600 * 1_000_000;
        assert_eq!(bucket_interval_secs(None, day), DEFAULT_INTERVAL_SECS);
        assert_eq!(bucket_interval_secs(Some(10), day), 173);
        assert_eq!(
            bucket_interval_secs(Some(10), 3600 * 1_000_000),
            MIN_INTERVAL_SECS
        );
        assert_eq!(bucket_interval_secs(Some(3600), day), 3600);
    }

    #[test]
    fn test_summary_sql_filters_requested_ids() {
        let ids = vec!["2xyz".to_string()];
        let sql = summary_sql("org1", 1, 2, 60, Some(&ids));
        assert!(sql.contains("(_timestamp / 60000000) * 60000000 AS zo_bucket"));
        assert!(sql.contains("AND (key LIKE '%/2xyz')"));
        assert!(!summary_sql("org1", 1, 2, 60, None).contains("key LIKE"));
        assert!(summary_sql("o'1", 1, 2, 60, None).contains("org = 'o''1'"));
    }

    #[test]
    fn test_summarize_hits_merges_legacy_statuses_and_drops_unnamed_rows() {
        let hits = vec![
            json!({"zo_bucket": 0, "zo_key": "rule_a/2abc", "zo_status": "firing", "zo_n": 2, "zo_silenced": 1}),
            json!({"zo_bucket": 0, "zo_key": "rule_a/2abc", "zo_status": "completed", "zo_n": 3}),
            json!({"zo_bucket": 0, "zo_key": "rule_a/2abc", "zo_status": "condition_not_satisfied", "zo_n": 4}),
            json!({"zo_bucket": 0, "zo_key": "/2abc", "zo_status": "error", "zo_n": 9}),
            json!({"zo_bucket": 60, "zo_key": "rule/with/slash/2def", "zo_status": "weird", "zo_n": 1}),
        ];
        let rows = summarize_hits(&hits);
        assert_eq!(
            rows,
            vec![
                AlertHistorySummaryRow {
                    bucket: 0,
                    alert_id: "2abc".into(),
                    outcome: "firing".into(),
                    n: 5,
                    silenced: 1
                },
                AlertHistorySummaryRow {
                    bucket: 0,
                    alert_id: "2abc".into(),
                    outcome: "normal".into(),
                    n: 4,
                    silenced: 0
                },
                AlertHistorySummaryRow {
                    bucket: 60,
                    alert_id: "2def".into(),
                    outcome: "unknown".into(),
                    n: 1,
                    silenced: 0
                },
            ]
        );
    }
}

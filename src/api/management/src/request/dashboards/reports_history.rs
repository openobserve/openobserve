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

use axum::{extract::Path, response::Response};
use axum_extra::extract::Query as ExtraQuery;
use chrono::{Duration, Utc};
use config::{
    get_config,
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        self_reporting::usage::{TRIGGERS_STREAM, TriggerData, TriggerDataType, normalize_outcome},
        stream::StreamType,
    },
    utils::{json, sql::escape_sql_string, time::now_micros},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    dashboards::reports::{TRIGGER_SOURCE_MANUAL, TRIGGER_SOURCE_SCHEDULED},
};
use search_service as SearchService;
use search_service::query_range::get_settings_max_query_range;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use tracing::{Instrument, Span};
use utoipa::ToSchema;

use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

pub const DISABLED_OWN_ORG_OFF: &str = "usage_report_to_own_org_off";
pub const DISABLED_REMOTE: &str = "usage_reporting_remote";
pub const DISABLED_TRIAL_EXPIRED: &str = "trial_expired";
const MODULE_REPORT: &str = "report";
const MODULE_CACHED_REPORT: &str = "cached_report";

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ReportHistoryQuery {
    /// Report KSUID; omitted for every report in the org.
    pub report_id: Option<String>,
    /// Start time in Unix timestamp microseconds
    pub start_time: Option<i64>,
    /// End time in Unix timestamp microseconds
    pub end_time: Option<i64>,
    /// Repeatable: succeeded, error, skipped.
    #[serde(default)]
    pub status: Vec<String>,
    /// scheduled or manual.
    pub trigger_source: Option<String>,
    /// true for cache-warming runs only, false for emailed runs only.
    pub is_cached: Option<bool>,
    pub from: Option<i64>,
    pub size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

/// One report run as the history API returns it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ReportRunHit {
    /// `_timestamp` of the row: when the run was picked up.
    pub timestamp: i64,
    pub report_id: String,
    /// Empty when the report was deleted.
    pub report_name: String,
    pub status: String,
    pub is_cached: bool,
    pub trigger_source: String,
    pub triggered_by: Option<String>,
    /// The run's due time; null on rows written before it was recorded.
    pub scheduled_for: Option<i64>,
    pub finished_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub is_partial: bool,
    pub delay_in_secs: Option<i64>,
    pub time_in_queue_ms: Option<i64>,
    pub retries: i32,
    pub recipient_count: Option<i32>,
    pub attachment_type: Option<String>,
    pub dashboard_count: Option<i32>,
    pub error: Option<String>,
    pub source_node: Option<String>,
    pub scheduler_trace_id: Option<String>,
    /// The run after this one; provisional on a failed row.
    pub next_run_at: Option<i64>,
}

impl ReportRunHit {
    /// Maps one triggers-stream row.
    pub fn from_row(row: &json::Value) -> Self {
        let str_of = |k: &str| row.get(k).and_then(|v| v.as_str()).map(String::from);
        let int_of = |k: &str| row.get(k).and_then(|v| v.as_i64());
        let key = str_of("key").unwrap_or_default();
        let (report_name, report_id) = key
            .rsplit_once('/')
            .map(|(name, id)| (name.to_string(), id.to_string()))
            .unwrap_or_else(|| (String::new(), key.clone()));
        let is_cached = row.get("module").and_then(|v| v.as_str()) == Some(MODULE_CACHED_REPORT);
        let module = if is_cached {
            TriggerDataType::CachedReport
        } else {
            TriggerDataType::Report
        };
        let success_response = str_of("success_response");
        let status = str_of("status")
            .and_then(|raw| normalize_outcome(&raw, &module, success_response.as_deref()))
            .map(|o| o.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let start = int_of("start_time").filter(|t| *t > 0);
        let finished_at = int_of("end_time").filter(|t| *t > 0);
        let duration_ms = start.zip(finished_at).map(|(s, e)| (e - s).max(0) / 1000);
        Self {
            timestamp: int_of("_timestamp").unwrap_or_default(),
            report_id,
            report_name,
            status,
            is_cached,
            trigger_source: str_of("trigger_source")
                .filter(|s| s == TRIGGER_SOURCE_MANUAL)
                .unwrap_or_else(|| TRIGGER_SOURCE_SCHEDULED.to_string()),
            triggered_by: str_of("triggered_by").filter(|s| !s.is_empty()),
            scheduled_for: int_of("scheduled_for").filter(|t| *t > 0),
            finished_at,
            duration_ms,
            is_partial: row
                .get("is_partial")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            delay_in_secs: int_of("delay_in_secs"),
            time_in_queue_ms: int_of("time_in_queue_ms"),
            retries: int_of("retries")
                .and_then(|r| i32::try_from(r).ok())
                .unwrap_or_default(),
            recipient_count: int_of("recipient_count").and_then(|r| i32::try_from(r).ok()),
            attachment_type: str_of("attachment_type").filter(|s| !s.is_empty()),
            dashboard_count: int_of("dashboard_count").and_then(|r| i32::try_from(r).ok()),
            error: str_of("error").filter(|s| !s.is_empty()),
            source_node: str_of("source_node").filter(|s| !s.is_empty()),
            scheduler_trace_id: str_of("scheduler_trace_id").filter(|s| !s.is_empty()),
            next_run_at: int_of("next_run_at").filter(|t| *t > 0),
        }
    }

    /// Maps a row this node just wrote, before the stream copy is searchable.
    pub fn from_trigger(row: &TriggerData) -> Self {
        Self::from_row(&json::to_value(row).unwrap_or_default())
    }
}

/// Run counts over the filtered range, ignoring the status and cached filters.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ReportRunCounts {
    /// Emailed runs that succeeded.
    pub succeeded: i64,
    /// Cache-warming runs that succeeded.
    pub cached: i64,
    pub error: i64,
    pub skipped: i64,
    pub total: i64,
}

impl ReportRunCounts {
    fn add(&mut self, raw_status: &str, module: &str, count: i64) {
        let is_cached = module == MODULE_CACHED_REPORT;
        let module = if is_cached {
            TriggerDataType::CachedReport
        } else {
            TriggerDataType::Report
        };
        match normalize_outcome(raw_status, &module, None).map(|o| o.to_string()) {
            Some(s) if s == "succeeded" && is_cached => self.cached += count,
            Some(s) if s == "succeeded" => self.succeeded += count,
            Some(s) if s == "error" => self.error += count,
            Some(s) if s == "skipped" => self.skipped += count,
            _ => {}
        }
        self.total += count;
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct ReportHistoryResponse {
    pub total: usize,
    pub from: i64,
    pub size: i64,
    /// Why the org records no run rows: own-org reporting off, remote mode or an expired trial.
    pub disabled_reason: Option<String>,
    pub counts: ReportRunCounts,
    pub hits: Vec<ReportRunHit>,
}

/// Validated filters; every value here is safe to format into SQL.
#[derive(Debug, Default)]
struct HistoryFilter {
    org_id: String,
    start_time: i64,
    end_time: i64,
    report_id: Option<Ksuid>,
    /// None means every report; Some holds the report ids the user may read.
    permitted: Option<Vec<Ksuid>>,
    trigger_source: Option<&'static str>,
    statuses: Vec<&'static str>,
    is_cached: Option<bool>,
}

impl HistoryFilter {
    /// The WHERE shared by the page and the counts: range, report and trigger source.
    fn base_where(&self) -> String {
        let mut sql = format!(
            "module IN ('{MODULE_REPORT}', '{MODULE_CACHED_REPORT}') AND org = '{}' \
             AND _timestamp >= {} AND _timestamp <= {}",
            escape_sql_string(&self.org_id),
            self.start_time,
            self.end_time
        );
        if let Some(id) = &self.report_id {
            sql.push_str(&format!(" AND key LIKE '%/{id}'"));
        } else if let Some(ids) = &self.permitted {
            let any = ids
                .iter()
                .map(|id| format!("key LIKE '%/{id}'"))
                .collect::<Vec<_>>()
                .join(" OR ");
            sql.push_str(&format!(" AND ({any})"));
        }
        match self.trigger_source {
            Some(TRIGGER_SOURCE_MANUAL) => {
                sql.push_str(&format!(" AND trigger_source = '{TRIGGER_SOURCE_MANUAL}'"));
            }
            // Rows written before trigger_source existed are scheduled runs.
            Some(_) => sql.push_str(&format!(
                " AND (trigger_source IS NULL OR trigger_source = '{TRIGGER_SOURCE_SCHEDULED}')"
            )),
            None => {}
        }
        sql
    }

    /// Whether a facet row of `raw_status` and `module` falls inside the page filter.
    fn page_includes(&self, raw_status: &str, module: &str) -> bool {
        let status_ok = self.statuses.is_empty()
            || self
                .statuses
                .iter()
                .any(|s| stored_statuses(s).contains(&raw_status));
        let module_ok = match self.is_cached {
            Some(true) => module == MODULE_CACHED_REPORT,
            Some(false) => module == MODULE_REPORT,
            None => true,
        };
        status_ok && module_ok
    }

    fn page_where(&self) -> String {
        let mut sql = self.base_where();
        if !self.statuses.is_empty() {
            let raw = self
                .statuses
                .iter()
                .flat_map(|s| stored_statuses(s))
                .map(|s| format!("'{s}'"))
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(" AND status IN ({raw})"));
        }
        match self.is_cached {
            Some(true) => sql.push_str(&format!(" AND module = '{MODULE_CACHED_REPORT}'")),
            Some(false) => sql.push_str(&format!(" AND module = '{MODULE_REPORT}'")),
            None => {}
        }
        sql
    }
}

/// GetReportHistory
#[utoipa::path(
    get,
    path = "/v2/{org_id}/reports/history",
    context_path = "/api",
    tag = "Reports",
    operation_id = "GetReportHistory",
    summary = "Get report run history",
    description = "Lists the runs of scheduled reports from the organization's triggers stream: scheduled \
                   and manual runs, their outcome, recipients and timing. The full path is \
                   /api/v2/{org_id}/reports/history.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("report_id" = Option<String>, Query, description = "Report ID (KSUID); omit for every report"),
        ("start_time" = Option<i64>, Query, description = "Start time in Unix microseconds (default: 7 days ago)"),
        ("end_time" = Option<i64>, Query, description = "End time in Unix microseconds (default: now)"),
        ("status" = Option<Vec<String>>, Query, description = "Repeatable: succeeded, error, skipped"),
        ("trigger_source" = Option<String>, Query, description = "scheduled or manual"),
        ("is_cached" = Option<bool>, Query, description = "true for cache-warming runs, false for emailed runs"),
        ("from" = Option<i64>, Query, description = "Pagination offset (default: 0)"),
        ("size" = Option<i64>, Query, description = "Page size (default: 100, max: 1000)"),
        ("sort_by" = Option<String>, Query, description = "_timestamp, status, end_time or retries (default: _timestamp)"),
        ("sort_order" = Option<String>, Query, description = "asc or desc (default: desc)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ReportHistoryResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 500, description = "Internal Server Error", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_report_history(
    Path(org_id): Path<String>,
    ExtraQuery(query): ExtraQuery<ReportHistoryQuery>,
    Headers(user_email): Headers<UserEmail>,
    req: axum::http::Request<axum::body::Body>,
) -> Response {
    let from = query.from.unwrap_or(0).max(0);
    let size = query.size.unwrap_or(100).clamp(1, 1000);
    let mut filter = match parse_filter(&org_id, &query) {
        Ok(f) => f,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let (sort_column, sort_order) = match parse_sort(&query) {
        Ok(s) => s,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    filter.start_time = clamp_to_max_query_range(
        &org_id,
        &user_email.user_id,
        filter.start_time,
        filter.end_time,
    )
    .await;

    match permitted_report_ids(&org_id, &user_email.user_id).await {
        Ok(None) => {}
        Ok(Some(ids)) => {
            if filter.report_id.is_some_and(|id| !ids.contains(&id)) {
                return MetaHttpResponse::forbidden("Access denied to this report");
            }
            filter.permitted = Some(ids);
        }
        Err(resp) => return resp,
    }

    let mut response = ReportHistoryResponse {
        from,
        size,
        disabled_reason: disabled_reason(&org_id).await.map(String::from),
        ..Default::default()
    };
    if filter.permitted.as_ref().is_some_and(|ids| ids.is_empty()) {
        return MetaHttpResponse::json(response);
    }

    let trace_id = get_or_create_trace_id(req.headers(), &Span::current());
    let search = |sql: String, size: i64, track_total_hits: bool| {
        run_search(
            &trace_id,
            &org_id,
            &user_email.user_id,
            sql,
            (filter.start_time, filter.end_time),
            size,
            track_total_hits,
        )
    };
    // The page total is summed from the facet rows, which saves a count search per request.
    let facet_sql = format!(
        "SELECT status, module, count(*) AS cnt FROM \"{TRIGGERS_STREAM}\" WHERE {} \
         GROUP BY status, module",
        filter.base_where()
    );
    let mut total = 0usize;
    match search(facet_sql, 100, false).await {
        Ok(Some(r)) => {
            for row in &r.hits {
                let status = row
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let module = row
                    .get("module")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let count = row.get("cnt").and_then(|v| v.as_i64()).unwrap_or_default();
                response.counts.add(status, module, count);
                if filter.page_includes(status, module) {
                    total += usize::try_from(count).unwrap_or_default();
                }
            }
        }
        Ok(None) => return MetaHttpResponse::json(response),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }
    response.total = total;

    if total == 0 || from >= total as i64 {
        return MetaHttpResponse::json(response);
    }
    let page_sql = format!(
        "SELECT * FROM \"{TRIGGERS_STREAM}\" WHERE {} \
         ORDER BY {sort_column} {sort_order} LIMIT {size} OFFSET {from}",
        filter.page_where()
    );
    match search(page_sql, size, false).await {
        Ok(Some(r)) => response.hits = r.hits.iter().map(ReportRunHit::from_row).collect(),
        Ok(None) => {}
        Err(e) => return MetaHttpResponse::internal_error(e),
    }
    MetaHttpResponse::json(response)
}

/// Statuses as stored, including the legacy names older rows carry.
fn stored_statuses(status: &str) -> &'static [&'static str] {
    match status {
        "succeeded" => &["succeeded", "completed"],
        "error" => &["error", "failed"],
        "skipped" => &["skipped"],
        _ => &[],
    }
}

fn parse_filter(org_id: &str, query: &ReportHistoryQuery) -> Result<HistoryFilter, String> {
    let end_time = query.end_time.unwrap_or_else(now_micros);
    let start_time = query
        .start_time
        .unwrap_or_else(|| (Utc::now() - Duration::days(7)).timestamp_micros());
    if start_time >= end_time {
        return Err("start_time must be before end_time".to_string());
    }
    let report_id = match query.report_id.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => Some(
            raw.parse::<Ksuid>()
                .map_err(|_| format!("Invalid report_id: '{raw}'"))?,
        ),
        None => None,
    };
    let statuses = query
        .status
        .iter()
        .flat_map(|s| s.split(','))
        .map(|s| match s.trim() {
            "succeeded" => Ok("succeeded"),
            "error" => Ok("error"),
            "skipped" => Ok("skipped"),
            other => Err(format!(
                "Invalid status: '{other}'. Valid values are: succeeded, error, skipped"
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let trigger_source = match query.trigger_source.as_deref() {
        None | Some("") => None,
        Some(TRIGGER_SOURCE_MANUAL) => Some(TRIGGER_SOURCE_MANUAL),
        Some(TRIGGER_SOURCE_SCHEDULED) => Some(TRIGGER_SOURCE_SCHEDULED),
        Some(other) => {
            return Err(format!(
                "Invalid trigger_source: '{other}'. Valid values are: scheduled, manual"
            ));
        }
    };
    Ok(HistoryFilter {
        org_id: org_id.to_string(),
        start_time,
        end_time,
        report_id,
        permitted: None,
        trigger_source,
        statuses,
        is_cached: query.is_cached,
    })
}

fn parse_sort(query: &ReportHistoryQuery) -> Result<(&'static str, &'static str), String> {
    let column = match query.sort_by.as_deref().map(str::to_lowercase).as_deref() {
        None | Some("_timestamp") | Some("timestamp") => "_timestamp",
        Some("status") => "status",
        Some("end_time") => "end_time",
        Some("retries") => "retries",
        Some(other) => {
            return Err(format!(
                "Invalid sort_by field: '{other}'. Valid fields are: _timestamp, status, end_time, retries"
            ));
        }
    };
    let order = match query
        .sort_order
        .as_deref()
        .map(str::to_lowercase)
        .as_deref()
    {
        None | Some("desc") => "DESC",
        Some("asc") => "ASC",
        Some(other) => {
            return Err(format!(
                "Invalid sort_order: '{other}'. Valid values are: asc, desc"
            ));
        }
    };
    Ok((column, order))
}

async fn clamp_to_max_query_range(org_id: &str, user_id: &str, start: i64, end: i64) -> i64 {
    let Some(settings) =
        infra::schema::get_settings(org_id, TRIGGERS_STREAM, StreamType::Logs).await
    else {
        return start;
    };
    let max_hours =
        get_settings_max_query_range(settings.max_query_range, org_id, Some(user_id)).await;
    if max_hours > 0 && (end - start) > max_hours * 3600 * 1_000_000 {
        end - max_hours * 3600 * 1_000_000
    } else {
        start
    }
}

/// The ids of the reports the user may read, with the same rule the report list applies.
#[cfg(feature = "enterprise")]
async fn permitted_report_ids(org_id: &str, user_id: &str) -> Result<Option<Vec<Ksuid>>, Response> {
    let permitted = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id, user_id, "GET", "report",
    )
    .await
    .map_err(|e| MetaHttpResponse::forbidden(e.to_string()))?;
    let Some(permitted) = permitted else {
        return Ok(None);
    };
    if permitted.contains(&format!("report:_all_{org_id}")) {
        return Ok(None);
    }
    let reports = openobserve_core::dashboards::reports::list(
        org_id,
        config::meta::dashboards::reports::ReportListFilters {
            dashboard: None,
            folder: None,
            destination_less: None,
            name_substring: None,
        },
        Some(permitted),
    )
    .await
    .map_err(MetaHttpResponse::internal_error)?;
    Ok(Some(
        reports
            .iter()
            .filter_map(|r| r.report_id.parse::<Ksuid>().ok())
            .collect(),
    ))
}

#[cfg(not(feature = "enterprise"))]
async fn permitted_report_ids(
    _org_id: &str,
    _user_id: &str,
) -> Result<Option<Vec<Ksuid>>, Response> {
    Ok(None)
}

async fn disabled_reason(_org_id: &str) -> Option<&'static str> {
    let cfg = get_config();
    #[cfg(feature = "cloud")]
    let trial_over = !openobserve_core::organization::is_org_in_free_trial_period(_org_id)
        .await
        .unwrap_or(true);
    #[cfg(not(feature = "cloud"))]
    let trial_over = false;
    disabled_reason_for(
        cfg.common.usage_report_to_own_org,
        &cfg.common.usage_reporting_mode,
        cfg!(feature = "enterprise"),
        trial_over,
    )
}

/// Mirrors the own-org write rules in self_reporting::persistence.
fn disabled_reason_for(
    usage_report_to_own_org: bool,
    usage_reporting_mode: &str,
    enterprise: bool,
    trial_over: bool,
) -> Option<&'static str> {
    if !usage_report_to_own_org {
        Some(DISABLED_OWN_ORG_OFF)
    } else if !enterprise && usage_reporting_mode == "remote" {
        Some(DISABLED_REMOTE)
    } else if trial_over {
        Some(DISABLED_TRIAL_EXPIRED)
    } else {
        None
    }
}

/// Ok(None) when the triggers stream does not exist yet.
async fn run_search(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    sql: String,
    (start_time, end_time): (i64, i64),
    size: i64,
    track_total_hits: bool,
) -> Result<Option<config::meta::search::Response>, String> {
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size,
            track_total_hits,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    match SearchService::search(
        trace_id,
        org_id,
        StreamType::Logs,
        Some(user_id.to_string()),
        &req,
    )
    .instrument(Span::current())
    .await
    {
        Ok(r) => Ok(Some(r)),
        Err(e) if e.to_string().to_lowercase().contains("not found") => Ok(None),
        Err(e) => {
            log::error!("Failed to search report history: {e}");
            Err(format!("Failed to search report history: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike;

    use super::*;

    fn ksuid() -> Ksuid {
        Ksuid::new(None, None)
    }

    fn filter() -> HistoryFilter {
        HistoryFilter {
            org_id: "org_a".to_string(),
            start_time: 1,
            end_time: 2,
            ..Default::default()
        }
    }

    #[test]
    fn from_row_maps_a_full_row() {
        let row = json::json!({
            "_timestamp": 100, "key": "Exec KPI/abc", "module": "report", "status": "error",
            "start_time": 1_000_000, "end_time": 42_000_000, "retries": 2,
            "trigger_source": "manual", "triggered_by": "lin@acme.io", "scheduled_for": 900_000,
            "recipient_count": 4, "attachment_type": "png", "dashboard_count": 2,
            "error": "report server 500: SMTP 550", "is_partial": true, "next_run_at": 5,
            "delay_in_secs": 3, "time_in_queue_ms": 120, "source_node": "n1",
            "scheduler_trace_id": "t1"
        });
        let hit = ReportRunHit::from_row(&row);
        assert_eq!(hit.report_name, "Exec KPI");
        assert_eq!(hit.report_id, "abc");
        assert_eq!(hit.status, "error");
        assert!(!hit.is_cached);
        assert_eq!(hit.trigger_source, "manual");
        assert_eq!(hit.triggered_by.as_deref(), Some("lin@acme.io"));
        assert_eq!(hit.duration_ms, Some(41_000));
        assert_eq!(hit.finished_at, Some(42_000_000));
        assert_eq!(hit.recipient_count, Some(4));
        assert!(hit.is_partial);
        assert_eq!(hit.scheduled_for, Some(900_000));
    }

    #[test]
    fn from_row_keeps_deleted_report_with_empty_name() {
        let hit = ReportRunHit::from_row(&json::json!({"key": "/abc", "status": "error"}));
        assert_eq!(hit.report_name, "");
        assert_eq!(hit.report_id, "abc");
    }

    #[test]
    fn from_row_reads_old_rows_as_scheduled_and_normalizes_legacy_status() {
        let hit = ReportRunHit::from_row(
            &json::json!({"key": "r/abc", "module": "cached_report", "status": "completed"}),
        );
        assert_eq!(hit.trigger_source, "scheduled");
        assert_eq!(hit.status, "succeeded");
        assert!(hit.is_cached);
        assert_eq!(hit.duration_ms, None);
        assert_eq!(hit.scheduled_for, None);
    }

    #[test]
    fn from_trigger_matches_the_stream_mapping() {
        let row = TriggerData {
            _timestamp: 7,
            key: "r/abc".to_string(),
            module: TriggerDataType::Report,
            start_time: 1_000,
            end_time: 3_000,
            trigger_source: Some(TRIGGER_SOURCE_MANUAL.to_string()),
            triggered_by: Some("a@b.c".to_string()),
            ..Default::default()
        };
        let hit = ReportRunHit::from_trigger(&row);
        assert_eq!(hit.timestamp, 7);
        assert_eq!(hit.status, "succeeded");
        assert_eq!(hit.trigger_source, "manual");
        assert_eq!(hit.duration_ms, Some(2));
    }

    #[test]
    fn counts_split_sent_from_cached_and_fold_legacy_names() {
        let mut c = ReportRunCounts::default();
        c.add("succeeded", "report", 41);
        c.add("completed", "cached_report", 5);
        c.add("failed", "report", 3);
        c.add("skipped", "report", 2);
        assert_eq!(
            c,
            ReportRunCounts {
                succeeded: 41,
                cached: 5,
                error: 3,
                skipped: 2,
                total: 51
            }
        );
    }

    #[test]
    fn base_where_escapes_org_and_scopes_to_reports() {
        let f = HistoryFilter {
            org_id: "o'rg".to_string(),
            ..filter()
        };
        let sql = f.base_where();
        assert!(sql.contains("org = 'o''rg'"));
        assert!(sql.starts_with("module IN ('report', 'cached_report')"));
        assert!(sql.contains("_timestamp >= 1 AND _timestamp <= 2"));
    }

    #[test]
    fn scheduled_filter_matches_rows_without_trigger_source() {
        let f = HistoryFilter {
            trigger_source: Some(TRIGGER_SOURCE_SCHEDULED),
            ..filter()
        };
        assert!(
            f.base_where()
                .contains("(trigger_source IS NULL OR trigger_source = 'scheduled')")
        );
        let f = HistoryFilter {
            trigger_source: Some(TRIGGER_SOURCE_MANUAL),
            ..filter()
        };
        assert!(f.base_where().contains("AND trigger_source = 'manual'"));
    }

    #[test]
    fn report_filter_wins_over_permitted_list() {
        let id = ksuid();
        let f = HistoryFilter {
            report_id: Some(id),
            permitted: Some(vec![ksuid(), ksuid()]),
            ..filter()
        };
        let sql = f.base_where();
        assert!(sql.contains(&format!("key LIKE '%/{id}'")));
        assert_eq!(sql.matches("key LIKE").count(), 1);
    }

    #[test]
    fn page_where_adds_status_and_module_but_counts_do_not() {
        let f = HistoryFilter {
            statuses: vec!["succeeded", "error"],
            is_cached: Some(true),
            ..filter()
        };
        let page = f.page_where();
        assert!(page.contains("status IN ('succeeded', 'completed', 'error', 'failed')"));
        assert!(page.contains("AND module = 'cached_report'"));
        assert!(!f.base_where().contains("status IN"));
    }

    #[test]
    fn page_includes_matches_the_page_where_clause() {
        let f = HistoryFilter {
            statuses: vec!["succeeded"],
            is_cached: Some(false),
            ..filter()
        };
        assert!(f.page_includes("succeeded", "report"));
        assert!(f.page_includes("completed", "report"));
        assert!(!f.page_includes("succeeded", "cached_report"));
        assert!(!f.page_includes("error", "report"));
        assert!(filter().page_includes("skipped", "cached_report"));
    }

    #[test]
    fn parse_filter_rejects_a_report_id_that_is_not_a_ksuid() {
        let q = ReportHistoryQuery {
            report_id: Some("x' OR 1=1 --".to_string()),
            ..Default::default()
        };
        assert!(parse_filter("org", &q).is_err());
    }

    #[test]
    fn parse_filter_accepts_repeated_and_comma_separated_status() {
        let q = ReportHistoryQuery {
            status: vec!["error".to_string(), "skipped,succeeded".to_string()],
            ..Default::default()
        };
        let f = parse_filter("org", &q).unwrap();
        assert_eq!(f.statuses, vec!["error", "skipped", "succeeded"]);
        let bad = ReportHistoryQuery {
            status: vec!["firing".to_string()],
            ..Default::default()
        };
        assert!(parse_filter("org", &bad).is_err());
    }

    #[test]
    fn parse_filter_checks_range_and_trigger_source() {
        let q = ReportHistoryQuery {
            start_time: Some(5),
            end_time: Some(5),
            ..Default::default()
        };
        assert!(parse_filter("org", &q).is_err());
        let q = ReportHistoryQuery {
            trigger_source: Some("cron".to_string()),
            ..Default::default()
        };
        assert!(parse_filter("org", &q).is_err());
        let q = ReportHistoryQuery {
            report_id: Some(ksuid().to_string()),
            ..Default::default()
        };
        assert!(parse_filter("org", &q).is_ok());
    }

    #[test]
    fn parse_sort_allows_only_the_listed_columns() {
        let q = ReportHistoryQuery::default();
        assert_eq!(parse_sort(&q).unwrap(), ("_timestamp", "DESC"));
        let q = ReportHistoryQuery {
            sort_by: Some("retries".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        assert_eq!(parse_sort(&q).unwrap(), ("retries", "ASC"));
        let q = ReportHistoryQuery {
            sort_by: Some("key; DROP".to_string()),
            ..Default::default()
        };
        assert!(parse_sort(&q).is_err());
    }

    #[test]
    fn disabled_reason_names_each_cause() {
        assert_eq!(
            disabled_reason_for(false, "local", false, false),
            Some(DISABLED_OWN_ORG_OFF)
        );
        assert_eq!(
            disabled_reason_for(true, "remote", false, false),
            Some(DISABLED_REMOTE)
        );
        assert_eq!(disabled_reason_for(true, "remote", true, false), None);
        assert_eq!(
            disabled_reason_for(true, "local", false, true),
            Some(DISABLED_TRIAL_EXPIRED)
        );
        assert_eq!(disabled_reason_for(true, "both", false, false), None);
    }
}

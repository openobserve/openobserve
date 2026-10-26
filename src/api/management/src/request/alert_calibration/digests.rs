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

//! The digests calibration passes write, read back through the module's own permission.

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{
    ider,
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        stream::StreamType,
    },
    utils::{
        sql::quote_sql_string,
        time::{now_micros, validate_time_range},
    },
};
use infra::errors::{Error as InfraError, ErrorCodes};
use o2_enterprise::enterprise::alert_calibration_service;
use openobserve_core::alerts::{
    alert_calibration::sink::DIGEST_STREAM,
    scheduler::{LastRun, last_run},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

use super::{deployment_disabled, error_response};

const RUN_COLUMNS: &str = "window_start, window_end, finding_count, skip_count, alerts_in_scope, \
     coverage_gap, coverage_unreadable_definitions, coverage_facts_without_definition, \
     coverage_definitions_without_facts, coverage_transitions_truncated, \
     coverage_counters_truncated, coverage_error_clusters_truncated, \
     coverage_error_clusters_unattributed, coverage_stream_substrate_empty";
const DEFAULT_SIZE: i64 = 100;
const MAX_SIZE: i64 = 1000;

/// A time range in microseconds, and how many rows to return.
#[derive(Deserialize, IntoParams)]
pub struct DigestRange {
    start_time: i64,
    end_time: i64,
    size: Option<i64>,
}

/// Runs that flagged an alert whose name matches, case-insensitively.
#[derive(Deserialize, IntoParams)]
pub struct AlertRuns {
    alert_name: String,
    start_time: i64,
    end_time: i64,
    size: Option<i64>,
}

/// One run, which is identified by its window.
#[derive(Deserialize, IntoParams)]
pub struct RunWindow {
    window_start: i64,
    window_end: i64,
    size: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct CalibrationStatus {
    #[schema(value_type = Option<Object>)]
    last_run: Option<LastRun>,
}

/// Which digest columns a read names, which decides what a search error can mean.
#[derive(Clone, Copy)]
enum Columns {
    /// Stamped on every record, so a missing one is a bug once the stream exists.
    Run,
    /// Written only by findings, so they stay absent until some run flags something.
    Finding,
}

impl Columns {
    fn not_written_yet(self, code: &ErrorCodes) -> bool {
        match code {
            ErrorCodes::SearchStreamNotFound(_) => true,
            ErrorCodes::SearchFieldNotFound(_) => matches!(self, Self::Finding),
            _ => false,
        }
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ListAlertCalibrationRuns",
    summary = "List alert calibration runs",
    description = "One row per digest emission in the range, newest first. A run pulled again emits a second time, so readers keep the newest emission of each window.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), DigestRange),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn list_runs(Path(org_id): Path<String>, Query(range): Query<DigestRange>) -> Response {
    let sql = format!(
        "SELECT DISTINCT {RUN_COLUMNS}, _timestamp AS emitted_at FROM \"{DIGEST_STREAM}\" \
         ORDER BY emitted_at DESC"
    );
    read(
        &org_id,
        sql,
        range.start_time,
        range.end_time,
        range.size,
        Columns::Run,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/alerts",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ListAlertCalibrationRunsForAlert",
    summary = "List the runs that flagged an alert",
    description = "The windows of the runs in the range with a finding on an alert whose name matches, case-insensitively.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), AlertRuns),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn list_runs_for_alert(
    Path(org_id): Path<String>,
    Query(query): Query<AlertRuns>,
) -> Response {
    let sql = format!(
        "SELECT DISTINCT window_start, window_end FROM \"{DIGEST_STREAM}\" \
         WHERE rule_id IS NOT NULL AND str_match_ignore_case(alert_name, {})",
        quote_sql_string(&query.alert_name)
    );
    read(
        &org_id,
        sql,
        query.start_time,
        query.end_time,
        query.size,
        Columns::Finding,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/records",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "GetAlertCalibrationRunRecords",
    summary = "Get the records of one alert calibration run",
    description = "Every record the run with this window wrote, newest emission first.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), RunWindow),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn get_run_records(Path(org_id): Path<String>, Query(run): Query<RunWindow>) -> Response {
    let sql = format!(
        "SELECT * FROM \"{DIGEST_STREAM}\" WHERE window_start = {} AND window_end = {} \
         ORDER BY _timestamp DESC",
        run.window_start, run.window_end
    );
    // A run's records are stamped when it finishes, at or after the end of its window.
    read(
        &org_id,
        sql,
        run.window_end,
        now_micros(),
        run.size,
        Columns::Run,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/rules",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "CountAlertCalibrationFindingsByRule",
    summary = "Count alert calibration findings by rule",
    description = "Per rule, how many distinct alerts and runs in the range it flagged.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), DigestRange),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn count_findings_by_rule(
    Path(org_id): Path<String>,
    Query(range): Query<DigestRange>,
) -> Response {
    let sql = format!(
        "SELECT rule_id, COUNT(DISTINCT alert_id) AS alerts_flagged, \
         COUNT(DISTINCT window_end) AS runs_flagging FROM \"{DIGEST_STREAM}\" \
         WHERE rule_id IS NOT NULL GROUP BY rule_id"
    );
    read(
        &org_id,
        sql,
        range.start_time,
        range.end_time,
        range.size,
        Columns::Finding,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/status",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "GetAlertCalibrationStatus",
    summary = "Get how the latest alert calibration run ended",
    description = "A run that fails writes no digest, so this is where its error is reported. `last_run` is null until a run has been attempted.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CalibrationStatus),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment, or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn get_status(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let config = match alert_calibration_service::get_config(&org_id).await {
        Ok(config) => config,
        Err(error) => return error_response(&error),
    };
    match last_run(&org_id, &config.id).await {
        Ok(last_run) => MetaHttpResponse::json(CalibrationStatus { last_run }),
        Err(e) => {
            log::error!("[alert_calibration] could not read the last run for org={org_id}: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

/// 202, not 200: the run is only queued here, and the scheduler writes the digest.
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alert_calibration/digests/run",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "RunAlertCalibration",
    summary = "Request an alert calibration run now",
    description = "Brings the org's scheduled run forward to now. An org has one scheduled run, so a request while one is due or running is accepted without queuing another.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 202, description = "Run accepted"),
        (status = 400, description = "The org's alert calibration config is disabled", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment, or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn run_alert_calibration(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match alert_calibration_service::request_run(&org_id).await {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(error) => error_response(&error),
    }
}

/// Searched as the server, so reading digests needs this module's permission and not the stream's.
async fn read(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: Option<i64>,
    columns: Columns,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    if let Err(msg) = validate_time_range(start_time, end_time) {
        return MetaHttpResponse::bad_request(msg);
    }
    let request = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size: size.unwrap_or(DEFAULT_SIZE).clamp(1, MAX_SIZE),
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };
    let trace_id = ider::generate();
    match search_service::search(&trace_id, org_id, StreamType::Logs, None, &request).await {
        Ok(response) => MetaHttpResponse::json(response.hits),
        Err(InfraError::ErrorCode(code)) if columns.not_written_yet(&code) => {
            MetaHttpResponse::json(Vec::<Value>::new())
        }
        Err(e) => {
            log::error!("[alert_calibration] digest read failed for org={org_id}: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_finding_read_treats_a_missing_column_as_nothing_written() {
        let stream = ErrorCodes::SearchStreamNotFound(DIGEST_STREAM.to_string());
        let field = ErrorCodes::SearchFieldNotFound("coverage_gap".to_string());
        let timeout = ErrorCodes::SearchTimeout("slow".to_string());
        assert!(Columns::Run.not_written_yet(&stream));
        assert!(!Columns::Run.not_written_yet(&field));
        assert!(Columns::Finding.not_written_yet(&stream));
        assert!(Columns::Finding.not_written_yet(&field));
        assert!(!Columns::Finding.not_written_yet(&timeout));
    }
}

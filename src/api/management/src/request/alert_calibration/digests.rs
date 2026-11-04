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

use arrow_schema::Schema;
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{
    ider,
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest, Response as SearchResponse},
        stream::StreamType,
    },
    utils::{
        sql::quote_sql_string,
        time::{now_micros, validate_time_range},
    },
};
use infra::errors::{Error as InfraError, ErrorCodes};
use o2_enterprise::enterprise::alert_calibration_service;
use openobserve_api_common::extractors::Headers;
use openobserve_core::alerts::{
    alert_calibration::sink::DIGEST_STREAM,
    scheduler::{LastRun, last_run},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

use super::{
    deployment_disabled, error_response,
    suggestions::offer_destination_suggestions,
    visibility::{
        PROBE_CAP, SumColumns, on_settled_columns, probe, scoped_records, scoped_runs,
        visible_search,
    },
};
use crate::{
    request::alert_grants::{AlertVisibility, live_visibility},
    service::auth::UserEmail,
};

pub(super) const RUN_COLUMNS: &str = "window_start, window_end, finding_count, skip_count, alerts_in_scope, \
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

/// One run, which is identified by its window, and the filters on its records.
#[derive(Deserialize, IntoParams)]
pub struct RunWindow {
    pub(super) window_start: i64,
    pub(super) window_end: i64,
    pub(super) size: Option<i64>,
    /// `run`, `finding` or `skip`, each matched on a column version 1 also wrote.
    pub(super) kind: Option<String>,
    pub(super) rule_id: Option<String>,
    /// `A`, `B` or `C`; a version-1 record has no tier.
    pub(super) tier: Option<String>,
    pub(super) pattern: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct CalibrationStatus {
    #[schema(value_type = Option<Object>)]
    last_run: Option<LastRun>,
}

/// Which digest columns a read names, which decides what a search error can mean.
#[derive(Clone, Copy)]
pub(super) enum Columns {
    /// Stamped on every record, so a missing one is a bug once the stream exists.
    Run,
    /// Written only by findings, so they stay absent until some run flags something.
    Finding,
}

impl Columns {
    pub(super) fn not_written_yet(self, code: &ErrorCodes) -> bool {
        match code {
            ErrorCodes::SearchStreamNotFound(_) => true,
            ErrorCodes::SearchFieldNotFound(_) => matches!(self, Self::Finding),
            _ => false,
        }
    }
}

/// Which of the columns that tell a run marker from a finding or skip a read's schema holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct MarkerColumns {
    rule_id: bool,
    pub(super) kind: bool,
}

impl MarkerColumns {
    pub(super) fn of(schema: &Schema) -> Self {
        Self {
            rule_id: schema.field_with_name("rule_id").is_ok(),
            kind: schema.field_with_name("kind").is_ok(),
        }
    }

    pub(super) fn both(self) -> bool {
        self.rule_id && self.kind
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ListAlertCalibrationRuns",
    summary = "List alert calibration runs",
    description = "One row per digest emission in the range, newest first. A run pulled again emits a second time, so readers keep the newest emission of each window. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, with counts over those alerts and org totals null.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), DigestRange),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
    )
)]
pub async fn list_runs(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(range): Query<DigestRange>,
) -> Response {
    let (org_id, user_id) = (org_id.as_str(), user.user_id.as_str());
    let (start_time, end_time, size) = (range.start_time, range.end_time, range.size);
    if let Err(refused) = admissible(start_time, end_time) {
        return refused;
    }
    // Read ahead of the probe, so a column the probe found missing shows as grown after the read.
    let planned = digest_columns(org_id).await;
    let resolve = || visibility_of(org_id, user_id, None, start_time, end_time);
    let visibility = match resolve().await {
        Ok(visibility) => visibility,
        Err(refused) => return refused,
    };
    if visibility == AlertVisibility::Org {
        let hits = search_hits(org_id, list_runs_sql(), start_time, end_time, size).await;
        return respond(org_id, hits, Columns::Run);
    }
    let planned = match planned {
        Ok(planned) => planned,
        Err(failed) => return failed,
    };
    let search = |sql| search_page(org_id, sql, start_time, end_time, size);
    let read = |visibility: AlertVisibility, written| async move {
        rows(
            org_id,
            scoped_runs(&visibility, written, search).await,
            Columns::Run,
        )
    };
    let columns = || digest_columns(org_id);
    settled(on_settled_columns(planned, visibility, columns, resolve, read).await)
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/alerts",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "ListAlertCalibrationRunsForAlert",
    summary = "List the runs that flagged an alert",
    description = "The windows of the runs in the range with a finding on an alert whose name matches, case-insensitively. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, with counts over those alerts and org totals null.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), AlertRuns),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
    )
)]
pub async fn list_runs_for_alert(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(query): Query<AlertRuns>,
) -> Response {
    let sql = |clause: Option<&str>| runs_for_alert_sql(&query.alert_name, clause);
    let range = (query.start_time, query.end_time, query.size);
    read(&org_id, &user.user_id, sql, range, Columns::Finding).await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/records",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "GetAlertCalibrationRunRecords",
    summary = "Get the records of one alert calibration run",
    description = "Every record the run with this window wrote, newest emission first. `kind`, `rule_id`, `tier` and `pattern` narrow the records; a filter on a column no record has written yet returns nothing. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, with counts over those alerts and org totals null. Such a caller also gets one run row per emission, ahead of its records, and that is all a `kind=run` read returns it.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), RunWindow),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
    )
)]
pub async fn get_run_records(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(run): Query<RunWindow>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let (org_id, user_id) = (org_id.as_str(), user.user_id.as_str());
    let schema = match digest_schema(org_id).await {
        Ok(schema) => schema,
        Err(failed) => return failed,
    };
    let (sql, recheck, columns) = match record_queries(&run, &schema) {
        Ok(queries) => queries,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    // A run's records are stamped when it finishes, at or after the end of its window.
    let (start_time, end_time) = (run.window_end, now_micros());
    if let Err(msg) = validate_time_range(start_time, end_time) {
        return MetaHttpResponse::bad_request(msg);
    }
    let window = Some((run.window_start, run.window_end));
    let resolve = || visibility_of(org_id, user_id, window, start_time, end_time);
    let visibility = match resolve().await {
        Ok(visibility) => visibility,
        Err(failed) => return failed,
    };
    if visibility == AlertVisibility::Org {
        let search = |sql| search_hits(org_id, sql, start_time, end_time, run.size);
        let hits = rows(
            org_id,
            records_rechecked(sql, recheck, search).await,
            columns,
        );
        return settled(with_suggestions(org_id, user_id, &visibility, hits).await);
    }
    let run = &run;
    let search = |sql| search_page(org_id, sql, start_time, end_time, run.size);
    let read = |visibility: AlertVisibility, written: SumColumns| async move {
        let filters =
            record_filters(run, written.markers()).map_err(MetaHttpResponse::bad_request)?;
        let hits = scoped_records(run, &visibility, written, filters, search).await;
        with_suggestions(
            org_id,
            user_id,
            &visibility,
            rows(org_id, hits, Columns::Run),
        )
        .await
    };
    let columns = || digest_columns(org_id);
    let planned = match checked_columns(org_id, &schema).await {
        Ok(planned) => planned,
        Err(failed) => return failed,
    };
    settled(on_settled_columns(planned, visibility, columns, resolve, read).await)
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alert_calibration/digests/rules",
    context_path = "/api",
    tag = "Alert Calibration",
    operation_id = "CountAlertCalibrationFindingsByRule",
    summary = "Count alert calibration findings by rule",
    description = "Per rule, how many distinct alerts and runs in the range it flagged. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, with counts over those alerts and org totals null.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), DigestRange),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Invalid time range", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Alert calibration is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
    )
)]
pub async fn count_findings_by_rule(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(range): Query<DigestRange>,
) -> Response {
    let range = (range.start_time, range.end_time, range.size);
    read(
        &org_id,
        &user.user_id,
        findings_by_rule_sql,
        range,
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
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "list"}))
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
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Alert Calibration", "operation": "create"}))
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

pub(super) fn list_runs_sql() -> String {
    format!(
        "SELECT DISTINCT {RUN_COLUMNS}, _timestamp AS emitted_at FROM \"{DIGEST_STREAM}\" \
         ORDER BY emitted_at DESC"
    )
}

/// A skip record names its rule and alert too, so a finding is told by its severity.
pub(super) fn runs_for_alert_sql(alert_name: &str, clause: Option<&str>) -> String {
    format!(
        "SELECT DISTINCT window_start, window_end FROM \"{DIGEST_STREAM}\" \
         WHERE severity IS NOT NULL AND str_match_ignore_case(alert_name, {}){}",
        quote_sql_string(alert_name),
        and_clause(clause)
    )
}

/// A skip record names its rule too, so a finding is told by its severity.
pub(super) fn findings_by_rule_sql(clause: Option<&str>) -> String {
    format!(
        "SELECT rule_id, COUNT(DISTINCT alert_id) AS alerts_flagged, \
         COUNT(DISTINCT window_end) AS runs_flagging FROM \"{DIGEST_STREAM}\" \
         WHERE severity IS NOT NULL{} GROUP BY rule_id",
        and_clause(clause)
    )
}

/// A record read's SQL, the SQL to redo a run read with once kind is planned, and its columns.
pub(super) fn record_queries(
    run: &RunWindow,
    schema: &Schema,
) -> Result<(String, Option<String>, Columns), String> {
    let written = MarkerColumns::of(schema);
    let filters = record_filters(run, written)?;
    let recheck = if run.kind.as_deref() == Some("run") && !written.kind {
        let planned = MarkerColumns {
            kind: true,
            ..written
        };
        Some(records_sql(run, &record_filters(run, planned)?))
    } else {
        None
    };
    // A filter names a column only some records write, so a stream without it matches nothing.
    let columns = if filters.is_empty() && recheck.is_none() {
        Columns::Run
    } else {
        Columns::Finding
    };
    Ok((records_sql(run, &filters), recheck, columns))
}

pub(super) fn records_sql(run: &RunWindow, filters: &[String]) -> String {
    let mut sql = format!(
        "SELECT * FROM \"{DIGEST_STREAM}\" WHERE window_start = {} AND window_end = {}",
        run.window_start, run.window_end
    );
    for filter in filters {
        sql.push_str(" AND ");
        sql.push_str(filter);
    }
    sql.push_str(" ORDER BY _timestamp DESC");
    sql
}

/// The extra WHERE clauses of a filtered record read.
pub(super) fn record_filters(
    run: &RunWindow,
    written: MarkerColumns,
) -> Result<Vec<String>, String> {
    let mut filters = Vec::new();
    if let Some(kind) = &run.kind {
        // Version 1 has no `kind`: a finding has a severity, a run marker counts no finding.
        match kind.as_str() {
            "run" => filters.extend(run_filters(written)),
            "finding" => filters.push("severity IS NOT NULL".to_string()),
            "skip" => filters.push("kind = 'skip'".to_string()),
            other => return Err(format!("kind must be run, finding or skip, not {other}")),
        }
    }
    if let Some(tier) = &run.tier {
        if !matches!(tier.as_str(), "A" | "B" | "C") {
            return Err(format!("tier must be A, B or C, not {tier}"));
        }
        filters.push(format!("tier = '{tier}'"));
    }
    if let Some(rule_id) = &run.rule_id {
        filters.push(format!("rule_id = {}", quote_sql_string(rule_id)));
    }
    if let Some(pattern) = &run.pattern {
        filters.push(format!("pattern = {}", quote_sql_string(pattern)));
    }
    Ok(filters)
}

/// The switch, then the range, then the caller's visibility, so a refused read searches nothing.
async fn admit(
    org_id: &str,
    user_id: &str,
    start_time: i64,
    end_time: i64,
) -> Result<AlertVisibility, Response> {
    admissible(start_time, end_time)?;
    visibility_of(org_id, user_id, None, start_time, end_time).await
}

fn admissible(start_time: i64, end_time: i64) -> Result<(), Response> {
    if let Some(disabled) = deployment_disabled() {
        return Err(disabled);
    }
    validate_time_range(start_time, end_time).map_err(MetaHttpResponse::bad_request)
}

/// The probe reads the range the read itself searches, so it names every alert the read could.
async fn visibility_of(
    org_id: &str,
    user_id: &str,
    window: Option<(i64, i64)>,
    start_time: i64,
    end_time: i64,
) -> Result<AlertVisibility, Response> {
    let search = |sql| search_response(org_id, sql, start_time, end_time, PROBE_CAP as i64);
    live_visibility(org_id, user_id, || probe(window, search))
        .await
        .map_err(|e| {
            log::error!(
                "[alert_calibration] could not resolve alert visibility for org={org_id}: {e}"
            );
            MetaHttpResponse::internal_error(e)
        })
}

async fn digest_columns(org_id: &str) -> Result<SumColumns, Response> {
    checked_columns(org_id, &digest_schema(org_id).await?).await
}

/// The planner reads this node's cached schema, so a column only stored yet is not counted.
async fn checked_columns(org_id: &str, cached: &Schema) -> Result<SumColumns, Response> {
    let cached = SumColumns::of(cached);
    if cached.holds_every_column() {
        return Ok(cached);
    }
    let stored = infra::schema::get_from_db(org_id, DIGEST_STREAM, StreamType::Logs)
        .await
        .map_err(|e| {
            log::error!(
                "[alert_calibration] could not read the stored digest schema for org={org_id}: {e}"
            );
            MetaHttpResponse::internal_error(e)
        })?;
    Ok(cached.against(SumColumns::of(&stored)))
}

async fn digest_schema(org_id: &str) -> Result<Schema, Response> {
    infra::schema::get(org_id, DIGEST_STREAM, StreamType::Logs)
        .await
        .map_err(|e| {
            log::error!(
                "[alert_calibration] could not read the digest schema for org={org_id}: {e}"
            );
            MetaHttpResponse::internal_error(e)
        })
}

async fn read<Q>(
    org_id: &str,
    user_id: &str,
    sql: Q,
    (start_time, end_time, size): (i64, i64, Option<i64>),
    columns: Columns,
) -> Response
where
    Q: FnOnce(Option<&str>) -> String,
{
    let visibility = match admit(org_id, user_id, start_time, end_time).await {
        Ok(visibility) => visibility,
        Err(refused) => return refused,
    };
    let search = |sql| search_page(org_id, sql, start_time, end_time, size);
    let hits = visible_search(sql, &visibility, search).await;
    respond(org_id, hits, columns)
}

/// Searched as the server, so reading digests needs this module's permission and not the stream's.
async fn search_hits(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: Option<i64>,
) -> Result<Vec<Value>, InfraError> {
    search_page(org_id, sql, start_time, end_time, size)
        .await
        .map(|response| response.hits)
}

/// The whole response, so a scoped read can refuse a partial one.
async fn search_page(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: Option<i64>,
) -> Result<SearchResponse, InfraError> {
    let size = size.unwrap_or(DEFAULT_SIZE).clamp(1, MAX_SIZE);
    search_response(org_id, sql, start_time, end_time, size).await
}

async fn search_response(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> Result<SearchResponse, InfraError> {
    let request = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };
    let trace_id = ider::generate();
    // Only these reads apply visibility, so search refuses the digest stream to any other caller.
    config::meta::self_reporting::protected_streams::as_reader(
        config::meta::self_reporting::protected_streams::ProtectedReader::AlertCalibration,
        search_service::search(&trace_id, org_id, StreamType::Logs, None, &request),
    )
    .await
}

fn respond(org_id: &str, hits: Result<Vec<Value>, InfraError>, columns: Columns) -> Response {
    settled(rows(org_id, hits, columns))
}

fn settled(hits: Result<Vec<Value>, Response>) -> Response {
    match hits {
        Ok(hits) => MetaHttpResponse::json(hits),
        Err(failed) => failed,
    }
}

fn rows(
    org_id: &str,
    hits: Result<Vec<Value>, InfraError>,
    columns: Columns,
) -> Result<Vec<Value>, Response> {
    match hits {
        Ok(hits) => Ok(hits),
        Err(InfraError::ErrorCode(code)) if columns.not_written_yet(&code) => Ok(Vec::new()),
        Err(e) => {
            log::error!("[alert_calibration] digest read failed for org={org_id}: {e}");
            Err(MetaHttpResponse::internal_error(e))
        }
    }
}

/// The stream stores no destination name, so a suggestion is found here, per reader (P8a-R2a).
async fn with_suggestions(
    org_id: &str,
    user_id: &str,
    visibility: &AlertVisibility,
    hits: Result<Vec<Value>, Response>,
) -> Result<Vec<Value>, Response> {
    let mut hits = hits?;
    offer_destination_suggestions(org_id, user_id, visibility, &mut hits).await;
    Ok(hits)
}

/// The planner reads the schema again, so a run read seen without kind re-checks its rows.
async fn records_rechecked<S, F>(
    sql: String,
    recheck: Option<String>,
    search: S,
) -> Result<Vec<Value>, InfraError>
where
    S: Fn(String) -> F,
    F: Future<Output = Result<Vec<Value>, InfraError>>,
{
    let hits = search(sql).await?;
    match recheck {
        // A non-marker row shows kind is planned; the predicated read keeps the page full.
        Some(sql) if hits.iter().any(not_a_marker) => search(sql).await,
        _ => Ok(hits),
    }
}

/// A row naming a rule, or a kind other than run, is a finding or a skip.
fn not_a_marker(hit: &Value) -> bool {
    let rule = hit.get("rule_id").is_some_and(|rule| !rule.is_null());
    let kind = hit
        .get("kind")
        .is_some_and(|kind| !kind.is_null() && kind != "run");
    rule || kind
}

/// A run marker counts no finding, and names no rule and a run kind wherever those columns exist.
fn run_filters(written: MarkerColumns) -> Vec<String> {
    // Every record stamps its run's finding_count, so a projected finding still has it.
    let mut filters = vec!["finding_count = 0".to_string()];
    if written.rule_id {
        filters.push("rule_id IS NULL".to_string());
    }
    if written.kind {
        filters.push("(kind IS NULL OR kind = 'run')".to_string());
    }
    filters
}

fn and_clause(clause: Option<&str>) -> String {
    clause.map(|c| format!(" AND {c}")).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The run-read clauses and the column each one names.
    const CLAUSES: [(&str, &str); 3] = [
        ("finding_count = 0", "finding_count"),
        ("rule_id IS NULL", "rule_id"),
        ("(kind IS NULL OR kind = 'run')", "kind"),
    ];
    const V1_MARKERS: [&str; 5] = [
        "_timestamp",
        "window_start",
        "window_end",
        "finding_count",
        "skip_count",
    ];
    const V2_MARKERS: [&str; 8] = [
        "_timestamp",
        "window_start",
        "window_end",
        "finding_count",
        "skip_count",
        "schema_version",
        "kind",
        "written_skip_count",
    ];
    /// A version-1 marker stream after the digest writer registered its two columns.
    const REGISTERED: [&str; 7] = [
        "_timestamp",
        "window_start",
        "window_end",
        "finding_count",
        "skip_count",
        "kind",
        "rule_id",
    ];

    /// The digest stream as a search reads it: every row projected onto the schema it planned on.
    struct Projected {
        planned: Vec<&'static str>,
        records: Vec<Value>,
        searches: std::sync::Mutex<Vec<String>>,
    }

    impl Projected {
        fn new(planned: &[&'static str], records: Vec<Value>) -> Self {
            Self {
                planned: planned.to_vec(),
                records,
                searches: Default::default(),
            }
        }

        async fn search(&self, sql: String) -> Result<Vec<Value>, InfraError> {
            self.searches.lock().unwrap().push(sql.clone());
            let applied: Vec<&str> = CLAUSES
                .iter()
                .filter(|(clause, _)| sql.contains(clause))
                .map(|(_, column)| *column)
                .collect();
            if let Some(missing) = applied.iter().find(|c| !self.planned.contains(c)) {
                return Err(InfraError::ErrorCode(ErrorCodes::SearchFieldNotFound(
                    missing.to_string(),
                )));
            }
            Ok(self
                .records
                .iter()
                .map(|record| self.project(record))
                .filter(|row| applied.iter().all(|column| holds(column, row)))
                .collect())
        }

        /// What the WAL read keeps of a record: only the planned columns.
        fn project(&self, record: &Value) -> Value {
            let fields = record.as_object().unwrap();
            Value::Object(
                fields
                    .iter()
                    .filter(|(name, _)| self.planned.contains(&name.as_str()))
                    .map(|(name, value)| (name.clone(), value.clone()))
                    .collect(),
            )
        }
    }

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

    #[test]
    fn digests_stay_gated_while_search_is_blocked() {
        // OTLP ingest accepts customer writes here, so it must never join the allowlist
        assert!(!search_service::is_operational_stream(DIGEST_STREAM));
    }

    fn schema(columns: &[&str]) -> Schema {
        Schema::new(
            columns
                .iter()
                .map(|name| arrow_schema::Field::new(*name, arrow_schema::DataType::Utf8, true))
                .collect::<Vec<_>>(),
        )
    }

    fn mixed_schema() -> Schema {
        schema(&[
            "window_start",
            "window_end",
            "finding_count",
            "kind",
            "rule_id",
            "severity",
            "tier",
            "pattern",
        ])
    }

    fn window(kind: Option<&str>, tier: Option<&str>) -> RunWindow {
        RunWindow {
            window_start: 1,
            window_end: 2,
            size: None,
            kind: kind.map(str::to_string),
            rule_id: None,
            tier: tier.map(str::to_string),
            pattern: None,
        }
    }

    fn record_filters_mixed(run: &RunWindow) -> Result<Vec<String>, String> {
        record_filters(run, MarkerColumns::of(&mixed_schema()))
    }

    // A version-1 record has no `kind`, so each kind maps to a column every version writes.
    #[test]
    fn a_kind_filter_matches_on_columns_the_version_one_shape_also_wrote() {
        assert_eq!(
            record_filters_mixed(&window(Some("finding"), None)).unwrap(),
            ["severity IS NOT NULL"]
        );
        assert_eq!(
            record_filters_mixed(&window(Some("run"), None)).unwrap(),
            [CLAUSES[0].0, CLAUSES[1].0, CLAUSES[2].0]
        );
        assert_eq!(
            record_filters_mixed(&window(Some("skip"), Some("B"))).unwrap(),
            ["kind = 'skip'", "tier = 'B'"]
        );
        assert!(
            record_filters_mixed(&window(None, None))
                .unwrap()
                .is_empty()
        );
        assert!(record_filters_mixed(&window(Some("other"), None)).is_err());
        assert!(record_filters_mixed(&window(None, Some("D"))).is_err());
        let quoted = record_filters_mixed(&RunWindow {
            rule_id: Some("noise".to_string()),
            pattern: Some("it's".to_string()),
            ..window(None, None)
        })
        .unwrap();
        assert_eq!(quoted, ["rule_id = 'noise'", "pattern = 'it''s'"]);
    }

    // A clean or routine-skip run writes neither rule_id nor, in version 1, kind.
    #[test]
    fn a_run_read_plans_only_on_columns_its_schema_holds() {
        let run = window(Some("run"), None);
        let sql_with = |clauses: &[&str]| {
            let clauses: Vec<String> = clauses.iter().map(|c| c.to_string()).collect();
            records_sql(&run, &clauses)
        };
        let (count, rule, kind) = (CLAUSES[0].0, CLAUSES[1].0, CLAUSES[2].0);
        let (sql, recheck, _) = record_queries(&run, &schema(&V1_MARKERS)).unwrap();
        assert_eq!(
            (sql, recheck),
            (sql_with(&[count]), Some(sql_with(&[count, kind])))
        );
        let (sql, recheck, _) = record_queries(&run, &schema(&V2_MARKERS)).unwrap();
        assert_eq!((sql, recheck), (sql_with(&[count, kind]), None));
        let (sql, recheck, _) = record_queries(&run, &mixed_schema()).unwrap();
        assert_eq!((sql, recheck), (sql_with(&[count, rule, kind]), None));
        let finding = window(Some("finding"), None);
        let (sql, recheck, _) = record_queries(&finding, &schema(&V2_MARKERS)).unwrap();
        assert!(sql.contains("severity IS NOT NULL") && recheck.is_none());
    }

    fn holds(column: &str, row: &Value) -> bool {
        let value = row.get(column).unwrap_or(&Value::Null);
        match column {
            "finding_count" => value.as_i64() == Some(0),
            "rule_id" => value.is_null(),
            _ => value.is_null() || value == "run",
        }
    }

    fn v1_marker() -> Value {
        serde_json::json!({"_timestamp": 3, "window_start": 1, "window_end": 2, "finding_count": 0, "skip_count": 2})
    }

    fn v2_marker() -> Value {
        serde_json::json!({"_timestamp": 4, "window_start": 1, "window_end": 2, "finding_count": 0, "skip_count": 1, "schema_version": 2, "kind": "run", "written_skip_count": 0})
    }

    fn v2_finding() -> Value {
        serde_json::json!({"_timestamp": 5, "window_start": 1, "window_end": 2, "finding_count": 1, "skip_count": 0, "schema_version": 2, "kind": "finding", "written_skip_count": 0, "rule_id": "noise", "severity": "High"})
    }

    /// A skip-only emission: its run found nothing, so it stamps finding_count 0 like a marker.
    fn v2_skip() -> Value {
        serde_json::json!({"_timestamp": 6, "window_start": 1, "window_end": 2, "finding_count": 0, "skip_count": 1, "schema_version": 2, "kind": "skip", "written_skip_count": 1, "rule_id": "noise", "skip_reason": "evidence_timeout"})
    }

    /// A kind=run read whose handler saw `seen`, searched on `stream`.
    async fn read_runs(seen: &[&str], stream: &Projected) -> Vec<Value> {
        let (sql, recheck, _) = record_queries(&window(Some("run"), None), &schema(seen)).unwrap();
        records_rechecked(sql, recheck, |sql| stream.search(sql))
            .await
            .unwrap()
    }

    // Planned on marker columns, the WAL read drops the finding's rule_id and kind.
    #[tokio::test]
    async fn a_finding_projected_onto_a_marker_only_schema_is_never_a_run() {
        for (planned, marker) in [
            (&V1_MARKERS[..], v1_marker()),
            (&V2_MARKERS[..], v2_marker()),
        ] {
            let stream = Projected::new(planned, vec![marker.clone(), v2_finding()]);
            let hits = read_runs(planned, &stream).await;
            assert_eq!(hits, [stream.project(&marker)], "planned on {planned:?}");
        }
    }

    // Planned on v2 marker columns, the WAL read drops the skip's rule_id but keeps kind.
    #[tokio::test]
    async fn a_skip_projected_onto_a_marker_only_schema_is_never_a_run() {
        let stream = Projected::new(&V2_MARKERS, vec![v2_marker(), v2_skip()]);
        let hits = read_runs(&V2_MARKERS, &stream).await;
        assert_eq!(hits, [stream.project(&v2_marker())]);
    }

    // The writer registered kind and rule_id before its first write, so the read plans on both.
    #[tokio::test]
    async fn a_skip_only_first_emission_after_registration_is_never_a_run() {
        let stream = Projected::new(&REGISTERED, vec![v1_marker(), v2_skip()]);
        let hits = read_runs(&REGISTERED, &stream).await;
        assert_eq!(hits, [stream.project(&v1_marker())]);
    }

    // The handler saw no kind; a skip-only emission landed before the search planned.
    #[tokio::test]
    async fn a_run_read_redoes_its_search_once_a_skip_appears_after_the_schema_check() {
        let mut planned = V1_MARKERS.to_vec();
        planned.extend([
            "schema_version",
            "kind",
            "written_skip_count",
            "rule_id",
            "skip_reason",
        ]);
        let stream = Projected::new(&planned, vec![v1_marker(), v2_skip()]);
        let run = window(Some("run"), None);
        let (sql, recheck, _) = record_queries(&run, &schema(&V1_MARKERS)).unwrap();
        let hits = records_rechecked(sql.clone(), recheck.clone(), |sql| stream.search(sql))
            .await
            .unwrap();
        assert_eq!(hits, [stream.project(&v1_marker())]);
        assert_eq!(*stream.searches.lock().unwrap(), [sql, recheck.unwrap()]);
    }

    #[tokio::test]
    async fn a_run_read_searches_once_when_every_row_is_a_marker() {
        let stream = Projected::new(&V1_MARKERS, vec![v1_marker(), v1_marker()]);
        let hits = read_runs(&V1_MARKERS, &stream).await;
        assert_eq!(hits, [v1_marker(), v1_marker()]);
        assert_eq!(stream.searches.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn every_digest_read_runs_as_the_calibration_reader() {
        let read = search_response("ops", list_runs_sql(), 0, now_micros(), 10).await;
        assert!(
            matches!(
                read,
                Err(InfraError::ErrorCode(ErrorCodes::SearchStreamNotFound(ref s))) if s == DIGEST_STREAM
            ),
            "{read:?}"
        );
        let hits = rows("ops", read.map(|response| response.hits), Columns::Run);
        assert!(hits.is_ok_and(|hits| hits.is_empty()));
    }
}

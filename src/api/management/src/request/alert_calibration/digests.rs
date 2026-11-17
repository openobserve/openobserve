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

use std::{collections::BTreeSet, future::ready};

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
use o2_enterprise::enterprise::{
    alert_calibration_service::{
        self,
        applied::{SuggestedChange, change_of, remember_offer},
        dismissals::{SCOPE_ALERT, Target},
    },
    autoobserve::{
        alert_findings::{DigestRun, LISTED_RULES, NO_DESTINATION_RULE, RUN_LOOKBACK_US},
        marks::TableKvReader,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::alerts::{
    alert_calibration::{dismissals::DismissalKv, sink::DIGEST_STREAM},
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
    request::alert_grants::{AlertVisibility, Probe, live_visibility},
    service::auth::UserEmail,
};

pub(super) const RUN_COLUMNS: &str = "window_start, window_end, finding_count, skip_count, alerts_in_scope, \
     coverage_gap, coverage_unreadable_definitions, coverage_facts_without_definition, \
     coverage_definitions_without_facts, coverage_transitions_truncated, \
     coverage_counters_truncated, coverage_error_clusters_truncated, \
     coverage_error_clusters_unattributed, coverage_stream_substrate_empty";
const DEFAULT_SIZE: i64 = 100;
const MAX_SIZE: i64 = 1000;
/// Stamped on every version-2 record (ENT `run_identity`); they decide whether a run owns alerts.
const OWNER_COLUMNS: [&str; 3] = [
    "schema_version",
    "coverage_definition_checks",
    "coverage_definition_checks_truncated",
];
/// Only version 2 writes these, so a stream without one holds no record the alert read names.
const FINDING_COLUMNS: [&str; 4] = ["kind", "rule_id", "scope_kind", "finding_id"];
/// Set on AutoObserve's read only; ENT `alert_findings::evidence` copies it as `folder`.
const FOLDER_COLUMN: &str = "alert_folder";

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
    /// One alert's records; ASCII alphanumeric, and it never widens visibility.
    pub(super) alert_id: Option<String>,
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
    description = "Every record the run with this window wrote, newest emission first. `kind`, `rule_id`, `tier`, `pattern` and `alert_id` narrow the records, and `alert_id` must be ASCII alphanumeric; a filter on a column no record has written yet returns nothing. A caller without org-wide alert read sees only the alerts its folder and alert grants cover, with counts over those alerts and org totals null. Such a caller also gets one run row per emission, ahead of its records, and that is all a `kind=run` read returns it.",
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
    if let Some(alert_id) = &run.alert_id {
        if alert_id.is_empty() || !alert_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("alert_id must be an alert id".to_string());
        }
        filters.push(format!("alert_id = {}", quote_sql_string(alert_id)));
    }
    Ok(filters)
}

/// The newest run since `since`, its alert failure findings and the ids the page lists to `reader`.
pub(crate) async fn latest_alert_findings(
    org_id: &str,
    reader: Option<&str>,
    since: i64,
    now: i64,
) -> Result<Option<DigestRun>, InfraError> {
    let schema = alert_schema(org_id).await?;
    let search = |sql, from, size| search_at(org_id, sql, (since, now + 1), from, size);
    let Some((mut run, every)) = alert_findings_with(&schema, search).await? else {
        return Ok(None);
    };
    drop_unlisted_findings(org_id, &mut run.records).await;
    stamp_folders(org_id, &mut run.records).await;
    let visibility = match reader {
        Some(user_id) => live_visibility(org_id, user_id, || ready(Ok(probe_of(&every)))).await?,
        None => AlertVisibility::Org,
    };
    run.finding_ids = listed_finding_ids(org_id, &visibility, every).await;
    Ok(Some(run))
}

/// The reader's destination change on each no-destination finding, as the dashboard offers it.
pub(crate) async fn offer_reader_changes(org_id: &str, user_id: &str, records: &mut [Value]) {
    let ids: Vec<String> = records
        .iter()
        .filter(|hit| hit.get("rule_id").and_then(Value::as_str) == Some(NO_DESTINATION_RULE))
        .filter_map(finding_alert)
        .map(str::to_string)
        .collect();
    if ids.is_empty() {
        return;
    }
    let probe = Probe { ids, full: false };
    match live_visibility(org_id, user_id, || ready(Ok(probe))).await {
        Ok(visibility) => {
            offer_destination_suggestions(org_id, user_id, &visibility, records).await
        }
        Err(e) => log::warn!(
            "[alert_calibration] could not read alert grants for org={org_id}, so no change is \
             offered on AutoObserve: {e}"
        ),
    }
}

pub(crate) async fn finding_target(
    org_id: &str,
    finding_id: &str,
    now: i64,
) -> Result<Option<Target>, InfraError> {
    let hit = finding_hit(org_id, finding_id, now).await?;
    let listed = match &hit {
        Some(hit) => !unlisted(org_id, hit).await,
        None => false,
    };
    Ok(hit.as_ref().filter(|_| listed).and_then(target_of))
}

/// The finding's stored change as the alert read offers it to this reader, destination included.
pub(crate) async fn finding_change(
    org_id: &str,
    user_id: &str,
    finding_id: &str,
    now: i64,
) -> Result<Option<SuggestedChange>, InfraError> {
    let Some(hit) = finding_hit(org_id, finding_id, now).await? else {
        return Ok(None);
    };
    if unlisted(org_id, &hit).await {
        return Ok(None);
    }
    let Some(alert_id) = hit
        .get("scope_key")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Ok(None);
    };
    let probe = Probe {
        ids: vec![alert_id.clone()],
        full: false,
    };
    let visibility = live_visibility(org_id, user_id, || ready(Ok(probe))).await?;
    let mut rows = [hit];
    offer_destination_suggestions(org_id, user_id, &visibility, &mut rows).await;
    Ok(change_of(&rows[0]))
}

/// Findings whose cause is gone since the run are unlisted until the next run decides again.
async fn drop_unlisted_findings(org_id: &str, hits: &mut Vec<Value>) {
    let mut kept = Vec::with_capacity(hits.len());
    for hit in std::mem::take(hits) {
        if !unlisted(org_id, &hit).await {
            kept.push(hit);
        }
    }
    *hits = kept;
}

/// Runs leave a detection to the Security module, and a fixed no-destination alert notifies now.
async fn unlisted(org_id: &str, hit: &Value) -> bool {
    on_detection(org_id, hit).await || notifies_now(org_id, hit).await
}

async fn notifies_now(org_id: &str, hit: &Value) -> bool {
    if hit.get("rule_id").and_then(Value::as_str) != Some(NO_DESTINATION_RULE) {
        return false;
    }
    let Some(alert_id) = finding_alert(hit) else {
        return false;
    };
    let incidents_page = o2_enterprise::enterprise::oncall::incidents_page_oncall_for(org_id)
        .await
        .unwrap_or_else(|e| {
            log::warn!("[alert_calibration] org {org_id}: could not read on-call teams: {e}");
            false
        });
    common::infra::config::ALERTS
        .read()
        .await
        .get(&db::alerts::alert::cache_alert_key(org_id, alert_id))
        .is_some_and(|(_, alert)| notifies(alert, incidents_page))
}

/// The calibration rule's own test: a destination, or an incident that pages someone in this org.
fn notifies(alert: &config::meta::alerts::alert::Alert, incidents_page: bool) -> bool {
    !alert.destinations.is_empty() || (alert.creates_incident && incidents_page)
}

/// Records store no folder, so AutoObserve's Where column reads it from the alert as it is now.
async fn stamp_folders(org_id: &str, hits: &mut [Value]) {
    let cache = common::infra::config::ALERTS.read().await;
    for hit in hits.iter_mut() {
        let folder = finding_alert(hit)
            .and_then(|id| cache.get(&db::alerts::alert::cache_alert_key(org_id, id)))
            .map(|(folder, _)| folder.name.clone())
            .filter(|name| !name.is_empty());
        if let (Some(folder), Some(row)) = (folder, hit.as_object_mut()) {
            row.insert(FOLDER_COLUMN.to_string(), folder.into());
        }
    }
}

async fn on_detection(org_id: &str, hit: &Value) -> bool {
    match finding_alert(hit) {
        Some(alert_id) => crate::request::security::is_siem_alert(org_id, alert_id).await,
        None => false,
    }
}

/// The alert a finding row is about; runs, skips and markers name none.
fn finding_alert(hit: &Value) -> Option<&str> {
    if hit.get("kind").and_then(Value::as_str) != Some("finding") {
        return None;
    }
    hit.get("alert_id")
        .or_else(|| hit.get("scope_key"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
}

/// Every rule's findings of the run the page lists to a reader who sees `visibility`.
async fn listed_finding_ids(
    org_id: &str,
    visibility: &AlertVisibility,
    mut every: Vec<Value>,
) -> Vec<String> {
    drop_unlisted_findings(org_id, &mut every).await;
    every
        .iter()
        .filter(|hit| sees_row(visibility, hit))
        .filter_map(|hit| hit.get("finding_id").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

/// `alert_clause` in memory: a row without an alert is cluster-scoped, so only org-wide sees it.
fn sees_row(visibility: &AlertVisibility, hit: &Value) -> bool {
    let alert = hit.get("alert_id").and_then(Value::as_str);
    match visibility {
        AlertVisibility::Org => true,
        AlertVisibility::AnyAlert => alert.is_some(),
        AlertVisibility::Only(ids) => alert.is_some_and(|id| ids.contains(id)),
    }
}

/// The distinct alerts the findings name, so the grants check reads only their folders.
fn probe_of(every: &[Value]) -> Probe {
    let ids: BTreeSet<&str> = every
        .iter()
        .filter_map(|hit| hit.get("alert_id").and_then(Value::as_str))
        .collect();
    Probe {
        ids: ids.into_iter().map(str::to_string).collect(),
        full: false,
    }
}

async fn finding_hit(
    org_id: &str,
    finding_id: &str,
    now: i64,
) -> Result<Option<Value>, InfraError> {
    let schema = alert_schema(org_id).await?;
    if !FINDING_COLUMNS
        .iter()
        .all(|column| schema.field_with_name(column).is_ok())
    {
        return Ok(None);
    }
    let range = (now.saturating_sub(RUN_LOOKBACK_US), now + 1);
    match search_at(org_id, finding_sql(finding_id), range, 0, 1).await {
        Ok(found) => Ok(found.hits.into_iter().next()),
        Err(InfraError::ErrorCode(code)) if Columns::Finding.not_written_yet(&code) => Ok(None),
        Err(e) => Err(e),
    }
}

/// This node's cache can lag a column another node added, so a miss re-reads the stored schema.
async fn alert_schema(org_id: &str) -> Result<Schema, InfraError> {
    let cached = infra::schema::get(org_id, DIGEST_STREAM, StreamType::Logs).await?;
    let held = |column: &&str| cached.field_with_name(column).is_ok();
    if OWNER_COLUMNS.iter().chain(&FINDING_COLUMNS).all(held) {
        return Ok(cached);
    }
    infra::schema::get_from_db(org_id, DIGEST_STREAM, StreamType::Logs).await
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
    search_at(org_id, sql, (start_time, end_time), 0, size).await
}

async fn search_at(
    org_id: &str,
    sql: String,
    (start_time, end_time): (i64, i64),
    from: i64,
    size: i64,
) -> Result<SearchResponse, InfraError> {
    let request = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from,
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

/// Not `visible_search`: the rail masks items by AutoObserve's own alert grants (P5b-S7).
async fn alert_findings_with<S, F>(
    schema: &Schema,
    search: S,
) -> Result<Option<(DigestRun, Vec<Value>)>, InfraError>
where
    S: Fn(String, i64, i64) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
{
    let held = |column: &str| schema.field_with_name(column).is_ok();
    let runs = match search(alert_run_sql(&held), 0, 1).await {
        // A failed partition may hold the newest run, so an older or missing one proves nothing.
        Ok(response) if response.is_partial => {
            return Err(InfraError::Message(
                "the newest alert calibration run read came back partial".to_string(),
            ));
        }
        Ok(response) => response.hits,
        Err(InfraError::ErrorCode(code)) if Columns::Run.not_written_yet(&code) => Vec::new(),
        Err(e) => return Err(e),
    };
    let Some(mut run) = runs.first().and_then(run_of) else {
        return Ok(None);
    };
    let mut every = Vec::new();
    if FINDING_COLUMNS.iter().all(|column| held(column)) {
        let listed = |after: &str| alert_records_sql(&run, after);
        run.records = run_pages(&run, &search, listed).await?;
        let all = |after: &str| finding_ids_sql(&run, after, &held);
        every = run_pages(&run, &search, all).await?;
    }
    Ok(Some((run, every)))
}

/// Every page of the run's records; a partial page would hide findings, so it fails the read.
async fn run_pages<S, F, Q>(run: &DigestRun, search: &S, sql: Q) -> Result<Vec<Value>, InfraError>
where
    S: Fn(String, i64, i64) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
    Q: Fn(&str) -> String,
{
    let mut records = Vec::new();
    let mut after = String::new();
    loop {
        let page = match search(sql(&after), 0, MAX_SIZE).await {
            Ok(page) => page,
            Err(InfraError::ErrorCode(code)) if Columns::Finding.not_written_yet(&code) => break,
            Err(e) => return Err(e),
        };
        if page.is_partial {
            return Err(InfraError::Message(format!(
                "the alert findings read of run {}..{} came back partial",
                run.window_start, run.window_end
            )));
        }
        let full = page.hits.len() >= MAX_SIZE as usize;
        let last = page
            .hits
            .last()
            .and_then(|hit| hit.get("finding_id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        records.extend(page.hits);
        match last {
            Some(last) if full => after = last,
            _ => break,
        }
    }
    Ok(records)
}

/// Each emission of a window has its own `_timestamp`, so newest first finds the newest emission.
fn alert_run_sql(held: &dyn Fn(&str) -> bool) -> String {
    let owner: Vec<&str> = OWNER_COLUMNS
        .into_iter()
        .filter(|column| held(column))
        .collect();
    let mut columns = vec!["window_start", "window_end"];
    columns.extend(owner);
    format!(
        "SELECT DISTINCT {}, _timestamp AS emitted_at FROM \"{DIGEST_STREAM}\" \
         ORDER BY emitted_at DESC",
        columns.join(", ")
    )
}

/// One emission's records share `_timestamp`, so pages follow `finding_id`, the one unique order.
fn alert_records_sql(run: &DigestRun, after: &str) -> String {
    format!(
        "SELECT * FROM \"{DIGEST_STREAM}\" WHERE window_start = {} AND window_end = {} \
         AND kind = 'finding' AND rule_id IN ({}) AND scope_kind = {} AND _timestamp = {} \
         AND finding_id > {} ORDER BY finding_id ASC",
        run.window_start,
        run.window_end,
        LISTED_RULES.map(quote_sql_string).join(", "),
        quote_sql_string(SCOPE_ALERT),
        run.emitted_at,
        quote_sql_string(after)
    )
}

/// Every rule's findings of one emission, with what decides whether the page lists them.
fn finding_ids_sql(run: &DigestRun, after: &str, held: &dyn Fn(&str) -> bool) -> String {
    let columns: Vec<&str> = ["finding_id", "kind", "rule_id", "alert_id", "scope_key"]
        .into_iter()
        .filter(|column| held(column))
        .collect();
    format!(
        "SELECT {} FROM \"{DIGEST_STREAM}\" WHERE window_start = {} AND window_end = {} \
         AND kind = 'finding' AND _timestamp = {} AND finding_id > {} ORDER BY finding_id ASC",
        columns.join(", "),
        run.window_start,
        run.window_end,
        run.emitted_at,
        quote_sql_string(after)
    )
}

fn finding_sql(finding_id: &str) -> String {
    format!(
        "SELECT * FROM \"{DIGEST_STREAM}\" WHERE kind = 'finding' AND scope_kind = {} \
         AND finding_id = {} ORDER BY _timestamp DESC",
        quote_sql_string(SCOPE_ALERT),
        quote_sql_string(finding_id)
    )
}

/// An empty pattern column is no pattern, as `rule_family` reads it.
fn target_of(hit: &Value) -> Option<Target> {
    let text = |key: &str| {
        hit.get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    Some(Target {
        rule_id: text("rule_id")?,
        pattern: text("pattern"),
        alert_id: text("scope_key")?,
    })
}

/// A run row whose window or emission time is unreadable names no run, so nothing is owned.
fn run_of(row: &Value) -> Option<DigestRun> {
    let int = |key: &str| {
        let value = row.get(key)?;
        value.as_i64().or_else(|| value.as_f64().map(|n| n as i64))
    };
    let truncated = match row.get("coverage_definition_checks_truncated") {
        Some(Value::Bool(truncated)) => *truncated,
        Some(Value::String(text)) => text == "true",
        _ => false,
    };
    Some(DigestRun {
        emitted_at: int("emitted_at")?,
        window_start: int("window_start")?,
        window_end: int("window_end")?,
        schema_version: int("schema_version").and_then(|v| u64::try_from(v).ok()),
        definition_checks: row
            .get("coverage_definition_checks")
            .and_then(Value::as_str)
            .map(str::to_string),
        definition_checks_truncated: truncated,
        records: Vec::new(),
        finding_ids: Vec::new(),
    })
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
    drop_unlisted_findings(org_id, &mut hits).await;
    if let Err(e) = restamp_finding_counts(org_id, visibility, &mut hits).await {
        log::warn!("[alert_calibration] org={org_id}: run counts keep their hidden findings: {e}");
    }
    offer_destination_suggestions(org_id, user_id, visibility, &mut hits).await;
    if let Err(e) = keep_offers(org_id, user_id, &hits).await {
        log::error!("[alert_calibration] keeping the offers for org={org_id} failed: {e}");
        return Err(MetaHttpResponse::internal_error(e));
    }
    Ok(hits)
}

/// Each emission's `finding_count` as the page lists it, so the tile counts the rows it shows.
async fn restamp_finding_counts(
    org_id: &str,
    visibility: &AlertVisibility,
    hits: &mut [Value],
) -> Result<(), InfraError> {
    let schema = alert_schema(org_id).await?;
    let held = |column: &str| schema.field_with_name(column).is_ok();
    if !FINDING_COLUMNS.iter().all(|column| held(column)) {
        return Ok(());
    }
    let now = now_micros();
    let every_of = |run: DigestRun| async move {
        let range = (run.window_end, now + 1);
        let search = |sql, from, size| search_at(org_id, sql, range, from, size);
        run_pages(&run, &search, |after: &str| {
            finding_ids_sql(&run, after, &held)
        })
        .await
    };
    restamp_with(org_id, visibility, hits, every_of).await
}

async fn restamp_with<E, F>(
    org_id: &str,
    visibility: &AlertVisibility,
    hits: &mut [Value],
    every_of: E,
) -> Result<(), InfraError>
where
    E: Fn(DigestRun) -> F,
    F: Future<Output = Result<Vec<Value>, InfraError>>,
{
    let emissions: BTreeSet<(i64, i64, i64)> = hits.iter().filter_map(emission_of).collect();
    for key @ (emitted_at, window_start, window_end) in emissions {
        let run = DigestRun {
            emitted_at,
            window_start,
            window_end,
            ..DigestRun::default()
        };
        let every = every_of(run).await?;
        let seen = every.iter().filter(|hit| sees_row(visibility, hit)).count();
        let listed = listed_finding_ids(org_id, visibility, every).await.len();
        let hidden = i64::try_from(seen.saturating_sub(listed)).unwrap_or(i64::MAX);
        if hidden == 0 {
            continue;
        }
        for row in hits.iter_mut().filter(|row| emission_of(row) == Some(key)) {
            if let Some(count) = int_of(row, "finding_count") {
                row["finding_count"] = (count - hidden).max(0).into();
            }
        }
    }
    Ok(())
}

/// The emission a row with a run count belongs to: its `_timestamp` and window.
fn emission_of(row: &Value) -> Option<(i64, i64, i64)> {
    int_of(row, "finding_count")?;
    Some((
        int_of(row, "_timestamp")?,
        int_of(row, "window_start")?,
        int_of(row, "window_end")?,
    ))
}

fn int_of(row: &Value, key: &str) -> Option<i64> {
    let value = row.get(key)?;
    value.as_i64().or_else(|| value.as_f64().map(|n| n as i64))
}

/// What the alert page offers is kept for its reader, so their Save records exactly that change.
async fn keep_offers(org_id: &str, user_id: &str, hits: &[Value]) -> anyhow::Result<()> {
    for hit in hits {
        let Some(id) = hit.get("finding_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(change) = change_of(hit) else {
            continue;
        };
        let who = (org_id, user_id);
        remember_offer(&DismissalKv, &TableKvReader, who, id, &change, now_micros()).await?;
    }
    Ok(())
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
            alert_id: None,
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

    // P7c test 21: an alert id is base62, so anything else is refused rather than quoted.
    #[test]
    fn records_filter_on_one_alert_id() {
        let by_id = |id: &str| RunWindow {
            alert_id: Some(id.to_string()),
            ..window(Some("skip"), None)
        };
        assert_eq!(
            record_filters_mixed(&by_id("Ab1")).unwrap(),
            ["kind = 'skip'", "alert_id = 'Ab1'"]
        );
        for bad in ["a'1", "", "a 1", "a%1", "a_1", "\u{e9}1"] {
            assert_eq!(
                record_filters_mixed(&by_id(bad)),
                Err("alert_id must be an alert id".to_string()),
                "{bad}"
            );
            assert!(
                record_queries(&by_id(bad), &mixed_schema()).is_err(),
                "{bad}"
            );
        }
        let plain = window(Some("skip"), None);
        let (sql, ..) = record_queries(&plain, &mixed_schema()).unwrap();
        assert_eq!(sql, records_sql(&plain, &["kind = 'skip'".to_string()]));
        let (sql, ..) = record_queries(&by_id("Ab1"), &mixed_schema()).unwrap();
        assert_eq!(
            sql,
            records_sql(
                &plain,
                &["kind = 'skip'".to_string(), "alert_id = 'Ab1'".to_string()]
            )
        );
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

    #[test]
    fn the_alert_findings_read_names_only_alert_failure_findings() {
        let all = |_: &str| true;
        assert_eq!(
            alert_run_sql(&all),
            format!(
                "SELECT DISTINCT window_start, window_end, schema_version, \
                 coverage_definition_checks, coverage_definition_checks_truncated, \
                 _timestamp AS emitted_at FROM \"{DIGEST_STREAM}\" ORDER BY emitted_at DESC"
            )
        );
        let v1 = |column: &str| !OWNER_COLUMNS.contains(&column);
        assert_eq!(
            alert_run_sql(&v1),
            format!(
                "SELECT DISTINCT window_start, window_end, _timestamp AS emitted_at \
                 FROM \"{DIGEST_STREAM}\" ORDER BY emitted_at DESC"
            )
        );
        let run = DigestRun {
            emitted_at: 30,
            window_start: 10,
            window_end: 20,
            ..DigestRun::default()
        };
        assert_eq!(
            alert_records_sql(&run, "ab'c"),
            format!(
                "SELECT * FROM \"{DIGEST_STREAM}\" WHERE window_start = 10 AND window_end = 20 \
                 AND kind = 'finding' AND rule_id IN ('failure', 'no_destination', 'notify_failed') \
                 AND scope_kind = 'alert' \
                 AND _timestamp = 30 AND finding_id > 'ab''c' ORDER BY finding_id ASC"
            )
        );
    }

    fn page(hits: Vec<Value>, is_partial: bool) -> SearchResponse {
        SearchResponse {
            hits,
            is_partial,
            ..SearchResponse::default()
        }
    }

    fn run_row() -> Value {
        serde_json::json!({
            "window_start": 10, "window_end": 20, "emitted_at": 30.0, "schema_version": 2,
            "coverage_definition_checks": "checked", "coverage_definition_checks_truncated": true,
        })
    }

    fn every_column() -> Schema {
        schema(&[
            "window_start",
            "window_end",
            "schema_version",
            "coverage_definition_checks",
            "coverage_definition_checks_truncated",
            "kind",
            "rule_id",
            "scope_kind",
            "finding_id",
        ])
    }

    fn finding_ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("{i:064x}")).collect()
    }

    /// Answers the run read with `run_row`, and record pages from `records` finding ids.
    struct Paged {
        records: usize,
        partial: bool,
        reads: std::sync::Mutex<Vec<(String, i64, i64)>>,
    }

    impl Paged {
        fn new(records: usize, partial: bool) -> Self {
            Self {
                records,
                partial,
                reads: Default::default(),
            }
        }

        /// Rows tied on the SQL's order come back in another order on each read, as shards may.
        async fn search(
            &self,
            sql: String,
            from: i64,
            size: i64,
        ) -> Result<SearchResponse, InfraError> {
            let reads = {
                let mut reads = self.reads.lock().unwrap();
                reads.push((sql.clone(), from, size));
                reads.len()
            };
            if sql.contains("DISTINCT") {
                return Ok(page(vec![run_row()], false));
            }
            let after = sql
                .split("finding_id > '")
                .nth(1)
                .and_then(|rest| rest.split('\'').next())
                .unwrap_or_default()
                .to_string();
            let mut ids: Vec<String> = finding_ids(self.records)
                .into_iter()
                .filter(|id| *id > after)
                .collect();
            if sql.ends_with("ORDER BY finding_id ASC") {
                ids.sort();
            } else if !ids.is_empty() {
                let turn = (reads * 7) % ids.len();
                ids.rotate_left(turn);
            }
            let hits = ids
                .into_iter()
                .skip(from as usize)
                .take(size as usize)
                .map(|id| serde_json::json!({ "finding_id": id }))
                .collect();
            Ok(page(hits, self.partial))
        }
    }

    #[tokio::test]
    async fn finding_pages_that_share_one_emission_time_list_each_finding_once() {
        let records = 2 * MAX_SIZE as usize + 3;
        let stream = Paged::new(records, false);
        let (run, _) = alert_findings_with(&every_column(), |sql, from, size| {
            stream.search(sql, from, size)
        })
        .await
        .unwrap()
        .unwrap();
        let listed: Vec<&str> = run
            .records
            .iter()
            .filter_map(|r| r["finding_id"].as_str())
            .collect();
        let unique: std::collections::BTreeSet<&str> = listed.iter().copied().collect();
        assert_eq!((listed.len(), unique.len()), (records, records));
    }

    #[tokio::test]
    async fn a_partial_run_read_fails_the_read() {
        for hits in [Vec::new(), vec![run_row()]] {
            let partial = |sql: String, _: i64, _: i64| {
                let run_hits = hits.clone();
                async move {
                    if sql.contains("DISTINCT") {
                        Ok(page(run_hits, true))
                    } else {
                        Ok(page(Vec::new(), false))
                    }
                }
            };
            let read = alert_findings_with(&every_column(), partial).await;
            assert!(read.is_err(), "{} run rows: {read:?}", hits.len());
        }
    }

    #[tokio::test]
    async fn the_alert_findings_read_takes_every_page_and_refuses_a_partial_one() {
        let every = every_column();
        let stream = Paged::new(2 * MAX_SIZE as usize + 3, false);
        let (run, all) =
            alert_findings_with(&every, |sql, from, size| stream.search(sql, from, size))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(run.records.len(), 2 * MAX_SIZE as usize + 3);
        assert_eq!(
            (
                run.emitted_at,
                run.window_start,
                run.window_end,
                run.schema_version
            ),
            (30, 10, 20, Some(2))
        );
        assert_eq!(run.definition_checks.as_deref(), Some("checked"));
        assert!(run.definition_checks_truncated);
        let ids = finding_ids(2 * MAX_SIZE as usize);
        let afters = [
            "",
            &ids[MAX_SIZE as usize - 1],
            &ids[2 * MAX_SIZE as usize - 1],
        ];
        let reads = stream.reads.lock().unwrap().clone();
        assert_eq!(
            reads.len(),
            7,
            "the run, three record pages, three id pages"
        );
        assert_eq!((reads[0].1, reads[0].2), (0, 1));
        for ((sql, from, size), after) in reads[1..].iter().zip(afters.iter().chain(&afters)) {
            assert_eq!((*from, *size), (0, MAX_SIZE));
            assert!(sql.contains(&format!("finding_id > '{after}'")), "{sql}");
        }
        assert!(
            reads[4..]
                .iter()
                .all(|(sql, ..)| sql.starts_with("SELECT finding_id, kind, rule_id FROM"))
        );
        assert_eq!(all.len(), 2 * MAX_SIZE as usize + 3);
        let partial = Paged::new(3, true);
        let read =
            alert_findings_with(&every, |sql, from, size| partial.search(sql, from, size)).await;
        assert!(read.is_err(), "{read:?}");
        let markers_only = schema(&["window_start", "window_end", "kind"]);
        let old = Paged::new(3, false);
        let (run, _) =
            alert_findings_with(&markers_only, |sql, from, size| old.search(sql, from, size))
                .await
                .unwrap()
                .unwrap();
        assert!(
            run.records.is_empty(),
            "no finding column, so no read that would fail on one"
        );
        assert_eq!(old.reads.lock().unwrap().len(), 1);
        let missing = |_: String, _: i64, _: i64| async {
            Err(InfraError::ErrorCode(ErrorCodes::SearchStreamNotFound(
                DIGEST_STREAM.to_string(),
            )))
        };
        assert_eq!(alert_findings_with(&every, missing).await.unwrap(), None);
    }

    #[tokio::test]
    async fn the_alert_findings_read_runs_as_the_calibration_reader() {
        infra::db::create_table().await.unwrap();
        let now = now_micros();
        let read = latest_alert_findings("ops", None, 0, now).await;
        assert!(matches!(read, Ok(None)), "{read:?}");
        let all = |_: &str| true;
        let request = SearchRequest {
            query: SearchQuery {
                sql: alert_run_sql(&all),
                start_time: 0,
                end_time: now,
                size: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        let outside =
            search_service::search("p5b-probe", "ops", StreamType::Logs, None, &request).await;
        assert!(
            matches!(
                outside,
                Err(InfraError::ErrorCode(ErrorCodes::SearchStreamProtected(ref s))) if s == DIGEST_STREAM
            ),
            "{outside:?}"
        );
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

    #[test]
    fn a_finding_is_read_by_its_id_and_names_its_rule_pattern_and_alert() {
        let sql = finding_sql("ab'c");
        assert!(sql.contains("finding_id = 'ab''c'"), "{sql}");
        assert!(sql.contains("scope_kind = 'alert'"), "{sql}");
        let hit = serde_json::json!({"rule_id": "noise", "pattern": "", "scope_key": "a1"});
        let target = target_of(&hit).unwrap();
        assert_eq!(
            (
                target.rule_id.as_str(),
                target.pattern,
                target.alert_id.as_str()
            ),
            ("noise", None, "a1")
        );
        assert!(target_of(&serde_json::json!({"rule_id": "noise"})).is_none());
    }

    #[tokio::test]
    async fn a_finding_on_an_alert_that_became_a_detection_is_no_longer_listed() {
        use config::meta::{
            alerts::alert::{Alert, SIEM_ATTRIBUTE},
            folder::Folder,
        };
        use svix_ksuid::KsuidLike;

        let org = format!("cal_det_{}", config::ider::uuid());
        let (detection, plain) = (
            svix_ksuid::Ksuid::new(None, None).to_string(),
            svix_ksuid::Ksuid::new(None, None).to_string(),
        );
        for (id, siem) in [(&detection, true), (&plain, false)] {
            let mut alert = Alert::default();
            alert.org_id = org.clone();
            alert.context_attributes = siem.then(|| {
                [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                    .into_iter()
                    .collect()
            });
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, id),
                (Folder::default(), alert),
            );
        }
        let finding = |id: &str| serde_json::json!({"kind": "finding", "alert_id": id});
        let mut hits = vec![
            finding(&detection),
            finding(&plain),
            serde_json::json!({"kind": "run"}),
            serde_json::json!({"kind": "finding", "scope_key": detection}),
        ];
        drop_unlisted_findings(&org, &mut hits).await;
        assert_eq!(
            hits,
            vec![finding(&plain), serde_json::json!({"kind": "run"})]
        );
    }

    #[tokio::test]
    async fn a_no_destination_finding_is_unlisted_once_its_alert_notifies() {
        use config::meta::{alerts::alert::Alert, folder::Folder};
        use svix_ksuid::KsuidLike;

        crate::request::security::tests::meta_store().await;
        let org = format!("cal_fixed_{}", config::ider::uuid());
        let id = || svix_ksuid::Ksuid::new(None, None).to_string();
        let (silent, wired, incident) = (id(), id(), id());
        for (alert_id, destinations, creates_incident) in [
            (&silent, vec![], false),
            (&wired, vec!["pager".to_string()], false),
            (&incident, vec![], true),
        ] {
            let mut alert = Alert::default();
            alert.org_id = org.clone();
            alert.destinations = destinations;
            alert.creates_incident = creates_incident;
            let folder = Folder {
                name: "ops".into(),
                ..Folder::default()
            };
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, alert_id),
                (folder, alert),
            );
        }
        let finding = |id: &str, rule: &str| serde_json::json!({"kind": "finding", "rule_id": rule, "alert_id": id});
        let mut hits = vec![
            finding(&silent, NO_DESTINATION_RULE),
            finding(&wired, NO_DESTINATION_RULE),
            finding(&wired, "failure"),
            finding(&incident, NO_DESTINATION_RULE),
        ];
        let before = hits.clone();
        drop_unlisted_findings(&org, &mut hits).await;
        let mut kept = vec![
            finding(&silent, NO_DESTINATION_RULE),
            finding(&wired, "failure"),
            finding(&incident, NO_DESTINATION_RULE),
        ];
        assert_eq!(
            hits, kept,
            "an org without an on-call team: the incident pages no one"
        );
        infra::table::oncall_teams::create(&org, "platform", "UTC", None)
            .await
            .unwrap();
        let mut staffed = before;
        drop_unlisted_findings(&org, &mut staffed).await;
        if o2_enterprise::enterprise::oncall::incidents_page_oncall() {
            kept.pop();
        }
        assert_eq!(
            staffed, kept,
            "a team pages the incident wherever incidents page on-call"
        );
        stamp_folders(&org, &mut hits).await;
        assert!(
            hits.iter().all(|hit| hit[FOLDER_COLUMN] == "ops"),
            "{hits:?}"
        );
        let mut paging = Alert::default();
        paging.creates_incident = true;
        assert!(notifies(&paging, true) && !notifies(&paging, false));
    }

    #[tokio::test]
    async fn slacks_calibration_count_is_what_the_page_lists_to_its_reader() {
        use config::meta::{
            alerts::alert::{Alert, SIEM_ATTRIBUTE},
            folder::Folder,
        };
        use svix_ksuid::KsuidLike;

        let org = format!("cal_count_{}", config::ider::uuid());
        let id = || svix_ksuid::Ksuid::new(None, None).to_string();
        let (detection, wired, mine, theirs) = (id(), id(), id(), id());
        for (alert_id, siem, destinations) in [
            (&detection, true, vec![]),
            (&wired, false, vec!["pager".to_string()]),
            (&mine, false, vec![]),
            (&theirs, false, vec![]),
        ] {
            let mut alert = Alert::default();
            alert.org_id = org.clone();
            alert.destinations = destinations;
            alert.context_attributes = siem.then(|| {
                [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                    .into_iter()
                    .collect()
            });
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, alert_id),
                (Folder::default(), alert),
            );
        }
        let finding = |fid: &str, rule: &str, alert: &str| serde_json::json!({"finding_id": fid, "kind": "finding", "rule_id": rule, "alert_id": alert});
        let every = vec![
            finding("f-detection", "noise", &detection),
            finding("f-fixed", NO_DESTINATION_RULE, &wired),
            finding("f-mine", "silent", &mine),
            finding("f-theirs", NO_DESTINATION_RULE, &theirs),
            serde_json::json!({"finding_id": "f-cluster", "kind": "finding", "rule_id": "scheduler_health"}),
        ];
        let org_wide = listed_finding_ids(&org, &AlertVisibility::Org, every.clone()).await;
        assert_eq!(
            org_wide,
            ["f-mine", "f-theirs", "f-cluster"],
            "the page hides detections and fixed no-destination findings"
        );
        let any_alert = listed_finding_ids(&org, &AlertVisibility::AnyAlert, every.clone()).await;
        assert_eq!(
            any_alert,
            ["f-mine", "f-theirs"],
            "a cluster row is org-wide only"
        );
        let scoped = AlertVisibility::Only(BTreeSet::from([mine.clone(), detection.clone()]));
        let folder = listed_finding_ids(&org, &scoped, every.clone()).await;
        assert_eq!(folder, ["f-mine"], "a scoped reader counts only its alerts");
        let probed = probe_of(&every);
        assert_eq!(probed.ids.len(), 4);
        assert!(!probed.full);
    }

    #[tokio::test]
    async fn the_run_count_the_tile_reads_leaves_out_the_findings_the_page_hides() {
        use config::meta::{
            alerts::alert::{Alert, SIEM_ATTRIBUTE},
            folder::Folder,
        };
        use svix_ksuid::KsuidLike;

        let org = format!("cal_tile_{}", config::ider::uuid());
        let id = || svix_ksuid::Ksuid::new(None, None).to_string();
        let (detection, wired, plain) = (id(), id(), id());
        for (alert_id, siem, destinations) in [
            (&detection, true, vec![]),
            (&wired, false, vec!["pager".to_string()]),
            (&plain, false, vec![]),
        ] {
            let mut alert = Alert::default();
            alert.org_id = org.clone();
            alert.destinations = destinations;
            alert.context_attributes = siem.then(|| {
                [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                    .into_iter()
                    .collect()
            });
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, alert_id),
                (Folder::default(), alert),
            );
        }
        let finding = |fid: &str, rule: &str, alert: &str| serde_json::json!({"finding_id": fid, "kind": "finding", "rule_id": rule, "alert_id": alert});
        let newest = vec![
            finding("f-detection", "noise", &detection),
            finding("f-fixed", NO_DESTINATION_RULE, &wired),
            finding("f-plain", "silent", &plain),
        ];
        let older = vec![finding("f-old", "silent", &plain)];
        let row = |at: i64, count: i64, kind: &str| serde_json::json!({"_timestamp": at, "window_start": 10, "window_end": 20, "finding_count": count, "kind": kind});
        let mut hits = vec![row(30, 3, "run"), row(30, 3, "finding"), row(25, 1, "run")];
        let read = |run: DigestRun| {
            let every = match run.emitted_at {
                30 => newest.clone(),
                _ => older.clone(),
            };
            ready(Ok(every))
        };
        restamp_with(&org, &AlertVisibility::Org, &mut hits, read)
            .await
            .unwrap();
        let counts: Vec<&Value> = hits.iter().map(|hit| &hit["finding_count"]).collect();
        assert_eq!(
            counts,
            [1, 1, 1],
            "each emission counts only what the page lists"
        );
        let mut scoped = vec![row(30, 2, "run")];
        let only = AlertVisibility::Only(BTreeSet::from([plain.clone(), wired.clone()]));
        restamp_with(&org, &only, &mut scoped, read).await.unwrap();
        assert_eq!(
            scoped[0]["finding_count"], 1,
            "a scoped count drops its hidden ones too"
        );
    }
}

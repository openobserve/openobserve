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

//! The org's analysis runs across its incidents, newest first.

use axum::{
    extract::{Path, Query},
    response::Response,
};
use config::meta::alerts::rca_runs::{RunState, RunTrigger, is_refusal_code};
use infra::table::rca_runs::{self as runs_table, OrgRun, OrgRunsFilter};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::incidents::{RCA_RUNS_DEFAULT_LIMIT, RCA_RUNS_MAX_LIMIT};
use crate::{common::meta::http::HttpResponse as MetaHttpResponse, request::security};

const STATE_FAILED: &str = "failed";
const STATE_REFUSED: &str = "refused";
const STATE_RUNNING: &str = "running";
const TRIGGER_AUTO: &str = "auto";
const TRIGGER_MANUAL: &str = "manual";
const AUTO_TRIGGERS: [RunTrigger; 4] = [
    RunTrigger::AutoNewIncident,
    RunTrigger::AutoNewAlertType,
    RunTrigger::AutoReopen,
    RunTrigger::OncallPage,
];
const MANUAL_TRIGGERS: [RunTrigger; 3] = [
    RunTrigger::Manual,
    RunTrigger::Reanalyze,
    RunTrigger::Resume,
];

/// Query parameters for listing the org's analysis runs
#[derive(Debug, Default, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct OrgRcaRunsQuery {
    /// `failed` (failed analysing), `refused` (never started) or `running` (or waiting for input)
    #[serde(default)]
    pub state: Option<String>,
    /// `auto` (started by the system) or `manual` (started by a user)
    #[serde(default)]
    pub trigger: Option<String>,
    /// Only runs started at or after this time, in microseconds
    #[serde(default)]
    pub since: Option<i64>,
    /// Page size (default 25, max 100)
    #[serde(default)]
    pub limit: Option<u64>,
    /// Return runs older than this run id (the last run of the previous page)
    #[serde(default)]
    pub before: Option<String>,
}

/// One analysis run of an incident of the org
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct OrgRcaRun {
    pub run_id: String,
    pub incident_id: String,
    /// Null while the incident is untitled
    pub incident_title: Option<String>,
    /// Null when the incident no longer exists
    pub severity: Option<String>,
    /// `running` | `waiting_input` | `completed` | `failed` | `refused` | `cancelled`
    pub state: String,
    /// `auto` | `manual`
    pub trigger: String,
    /// Microseconds
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// `error.code` of a failed or refused run
    pub error_code: Option<String>,
}

/// A page of the org's analysis runs
#[derive(Debug, Serialize, ToSchema)]
pub struct OrgRcaRunsResponse {
    pub runs: Vec<OrgRcaRun>,
    pub has_more: bool,
    /// The `before` of the next page; set whenever `has_more` is, even on a page with no runs
    pub next_before: Option<String>,
}

/// Which of a failed run's outcomes the `state` filter keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    Any,
    Only,
    Never,
}

/// ListOrgRcaRuns
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/rca_runs",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListOrgRcaRuns",
    summary = "List the analysis runs of the org's incidents",
    description = "Returns the analysis runs of every incident in the org, newest first, without report text. Filter by `state`, `trigger` and `since`; page with `before` set to the previous page's `next_before`. Runs of security cases list only for members with Security read access. A run refused before it started (run limit, missing credentials, agent unavailable) lists as `refused`, not `failed`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        OrgRcaRunsQuery,
    ),
    responses(
        (status = 200, description = "Analysis runs", content_type = "application/json", body = OrgRcaRunsResponse),
        (status = 400, description = "Unknown state or trigger", content_type = "application/json", body = ()),
        (status = 403, description = "Not allowed to read incidents", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_org_rca_runs(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<OrgRcaRunsQuery>,
) -> Response {
    if !can_list_incidents(&org_id, &user_email.user_id).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let (mut filter, refusal) = match filter_of(&query) {
        Ok(found) => found,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    filter.cases = security::visible_cases(&org_id, &user_email.user_id).await;
    let keep = |run: &runs_table::Model| match refusal {
        Refusal::Any => true,
        Refusal::Only => refused(run),
        Refusal::Never => !refused(run),
    };
    match runs_table::list_for_org(&org_id, &filter, keep).await {
        Ok((runs, next_before)) => MetaHttpResponse::json(OrgRcaRunsResponse {
            runs: runs.into_iter().map(row_of).collect(),
            has_more: next_before.is_some(),
            next_before,
        }),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// The list reads incidents of the whole org, so it needs what listing incidents does.
#[cfg(feature = "enterprise")]
async fn can_list_incidents(org_id: &str, user_id: &str) -> bool {
    crate::service::auth::check_permissions(
        org_id,
        org_id,
        user_id,
        "incidents",
        "LIST",
        None,
        true,
        false,
        false,
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
async fn can_list_incidents(_org_id: &str, _user_id: &str) -> bool {
    true
}

/// The SQL filter and the refusal split of `query`.
fn filter_of(query: &OrgRcaRunsQuery) -> Result<(OrgRunsFilter<'_>, Refusal), String> {
    let (states, refusal) = match query.state.as_deref() {
        None => (Vec::new(), Refusal::Any),
        Some(STATE_FAILED) => (vec![RunState::Failed.as_str()], Refusal::Never),
        Some(STATE_REFUSED) => (vec![RunState::Failed.as_str()], Refusal::Only),
        Some(STATE_RUNNING) => (
            vec![RunState::Running.as_str(), RunState::WaitingInput.as_str()],
            Refusal::Any,
        ),
        Some(other) => {
            return Err(format!(
                "Unknown state {other:?}: expected failed, refused or running"
            ));
        }
    };
    let triggers = match query.trigger.as_deref() {
        None => Vec::new(),
        Some(TRIGGER_AUTO) => AUTO_TRIGGERS.iter().map(RunTrigger::as_str).collect(),
        Some(TRIGGER_MANUAL) => MANUAL_TRIGGERS.iter().map(RunTrigger::as_str).collect(),
        Some(other) => {
            return Err(format!(
                "Unknown trigger {other:?}: expected auto or manual"
            ));
        }
    };
    let filter = OrgRunsFilter {
        states,
        triggers,
        since: query.since,
        before: query.before.as_deref(),
        limit: query
            .limit
            .unwrap_or(RCA_RUNS_DEFAULT_LIMIT)
            .clamp(1, RCA_RUNS_MAX_LIMIT),
        cases: Default::default(),
    };
    Ok((filter, refusal))
}

fn refused(run: &runs_table::Model) -> bool {
    run.state == RunState::Failed.as_str()
        && runs_table::error_of(run).is_some_and(|e| is_refusal_code(&e.code))
}

fn row_of(found: OrgRun) -> OrgRcaRun {
    let run = found.run;
    let state = if refused(&run) {
        STATE_REFUSED.to_string()
    } else {
        run.state.clone()
    };
    let trigger = if AUTO_TRIGGERS.iter().any(|t| t.as_str() == run.trigger) {
        TRIGGER_AUTO
    } else {
        TRIGGER_MANUAL
    };
    OrgRcaRun {
        error_code: runs_table::error_of(&run).map(|e| e.code),
        incident_id: run.incident_id.unwrap_or_default(),
        incident_title: found.incident_title,
        severity: found.severity,
        state,
        trigger: trigger.to_string(),
        started_at: run.started_at,
        ended_at: run.ended_at,
        run_id: run.run_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(state: Option<&str>, trigger: Option<&str>) -> OrgRcaRunsQuery {
        OrgRcaRunsQuery {
            state: state.map(str::to_string),
            trigger: trigger.map(str::to_string),
            ..Default::default()
        }
    }

    fn run(state: &str, trigger: &str, code: Option<&str>) -> runs_table::Model {
        runs_table::Model {
            run_id: "r1".into(),
            org_id: "o".into(),
            subject_type: "incident".into(),
            subject_id: "i1".into(),
            incident_id: Some("i1".into()),
            trigger: trigger.into(),
            mode: "fresh".into(),
            started_by: "system".into(),
            guidance: None,
            state: state.into(),
            started_at: 10,
            updated_at: 10,
            ended_at: Some(20),
            cancelled_by: None,
            outcome: None,
            confidence: None,
            report: None,
            result: None,
            error: code.map(|c| serde_json::json!({"code": c, "reason": "r"}).to_string()),
            session_id: None,
            stats: None,
            stage: None,
            stage_index: None,
            context_used: None,
            continuations: 0,
            oncall_subjects: None,
            input_deadline_at: None,
            pending_question_id: None,
            questions_asked: 0,
            deadline_closed_at: None,
        }
    }

    #[test]
    fn filters_map_to_stored_states_and_triggers() {
        let q = query(Some("failed"), Some("auto"));
        let (filter, refusal) = filter_of(&q).unwrap();
        assert_eq!(filter.states, ["failed"]);
        assert_eq!(
            filter.triggers,
            [
                "auto_new_incident",
                "auto_new_alert_type",
                "auto_reopen",
                "oncall_page"
            ]
        );
        assert_eq!(refusal, Refusal::Never);
        let q = query(Some("refused"), Some("manual"));
        let (filter, refusal) = filter_of(&q).unwrap();
        assert_eq!(filter.states, ["failed"]);
        assert_eq!(filter.triggers, ["manual", "reanalyze", "resume"]);
        assert_eq!(refusal, Refusal::Only);
        let q = query(Some("running"), None);
        let (filter, _) = filter_of(&q).unwrap();
        assert_eq!(filter.states, ["running", "waiting_input"]);
        assert!(filter.triggers.is_empty());
        assert_eq!(filter.limit, RCA_RUNS_DEFAULT_LIMIT);
    }

    #[test]
    fn unknown_filters_and_oversized_pages_are_handled() {
        assert!(filter_of(&query(Some("done"), None)).is_err());
        assert!(filter_of(&query(None, Some("cron"))).is_err());
        let q = OrgRcaRunsQuery {
            limit: Some(1_000),
            ..Default::default()
        };
        assert_eq!(filter_of(&q).unwrap().0.limit, RCA_RUNS_MAX_LIMIT);
    }

    #[test]
    fn a_run_that_never_started_lists_as_refused() {
        let found = |model| OrgRun {
            run: model,
            incident_title: Some("Checkout errors".into()),
            severity: Some("P1".into()),
        };
        let row = row_of(found(run(
            "failed",
            "auto_new_incident",
            Some("turn_limit"),
        )));
        assert_eq!(row.state, "refused");
        assert_eq!(row.trigger, "auto");
        assert_eq!(row.error_code.as_deref(), Some("turn_limit"));
        assert_eq!(row.incident_title.as_deref(), Some("Checkout errors"));
        let row = row_of(found(run("failed", "reanalyze", Some("agent_error"))));
        assert_eq!(row.state, "failed");
        assert_eq!(row.trigger, "manual");
        let row = row_of(found(run("waiting_input", "auto_reopen", None)));
        assert_eq!(row.state, "waiting_input");
        assert_eq!(row.error_code, None);
    }

    #[test]
    fn the_row_serializes_as_the_contract_shape() {
        let row = row_of(OrgRun {
            run: run("completed", "manual", None),
            incident_title: None,
            severity: Some("P2".into()),
        });
        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            serde_json::json!({
                "run_id": "r1", "incident_id": "i1", "incident_title": null, "severity": "P2",
                "state": "completed", "trigger": "manual", "started_at": 10, "ended_at": 20,
                "error_code": null
            })
        );
    }
}

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

//! RCA run lifecycle: the one writer of `rca_runs` and the incident run summary.
//!
//! `infra::table::rca_runs` owns the transactions and the SQL. This module maps
//! requests onto them, redacts what a reader sees, fires `IncidentEvent`
//! workflows after a commit, and hands completed results to the on-call path.

use std::sync::LazyLock;

use config::{
    meta::{
        alerts::{
            incidents::{IncidentEvent, IncidentEventType},
            rca_runs::{
                RcaDetailFields, RcaStreamEnd, RcaSummary, RunError, RunMode, RunState, RunStats,
                RunSubjectType, RunTrigger, stale_threshold_us,
            },
        },
        oncall::SubjectRef,
    },
    utils::time::now_micros,
};
use dashmap::DashMap;
use infra::table::{
    entity::alert_incidents,
    rca_runs::{self as runs_table, NewRun, RunSummaryPatch, RunUpdate, StartGuards, StartResult},
};
use o2_enterprise::enterprise::{alerts::rca_service, common::config::get_config as get_o2_config};
use regex::{NoExpand, Regex};
use tokio::task::AbortHandle;

use crate::redact::redact_internal_details;

// One `error.reason` per `error.code` (RR-14); every `fail_run` caller passes the pair.
// The stale pair lives in `infra::table::rca_runs`, next to the sweep that writes it.

/// `error.code` of a run whose RCA feature is turned off.
pub const ERROR_RCA_DISABLED: &str = "rca_disabled";
/// `error.reason` of an `rca_disabled` run.
pub const RCA_DISABLED_REASON: &str = "RCA is disabled";
/// `error.code` of a run with no agent URL or agent client.
pub const ERROR_AGENT_NOT_CONFIGURED: &str = "agent_not_configured";
/// `error.reason` of an `agent_not_configured` run.
pub const AGENT_NOT_CONFIGURED_REASON: &str = "Agent not configured";
/// `error.code` of an automatic run whose team has L0 off at the incident's priority.
pub const ERROR_L0_OFF: &str = "l0_off";
/// `error.reason` of an `l0_off` run.
pub const L0_OFF_REASON: &str = "AI SRE is off for this priority";
/// `error.code` of a run whose agent credentials could not be read.
pub const ERROR_CREDENTIALS: &str = "credentials";
/// `error.reason` of a `credentials` run.
pub const CREDENTIALS_REASON: &str = "Credentials failed";
/// `error.code` of a run whose agent failed its health check.
pub const ERROR_AGENT_UNAVAILABLE: &str = "agent_unavailable";
/// `error.reason` of an `agent_unavailable` run.
pub const AGENT_UNAVAILABLE_REASON: &str = "Agent unavailable";
/// `error.code` of a run whose agent call failed.
pub const ERROR_SERVICE_CALL_FAILED: &str = "service_call_failed";
/// `error.reason` of a `service_call_failed` run.
pub const SERVICE_CALL_FAILED_REASON: &str = "RCA service call failed";
/// `error.code` of a streaming run whose stream could not be opened.
pub const ERROR_STREAM_START_FAILED: &str = "stream_start_failed";
/// `error.reason` of a `stream_start_failed` run.
pub const STREAM_START_FAILED_REASON: &str = "Stream start failed";
/// `error.code` of a run whose agent answered with nothing (RR-18).
pub const ERROR_NO_REPORT: &str = "no_report";
/// `error.reason` of a `no_report` run.
pub const NO_REPORT_REASON: &str = "The analysis returned no report";
/// `error.code` of a streaming run whose stream broke (RR-46).
pub const ERROR_STREAM: &str = "stream_error";
/// `error.reason` of a `stream_error` run.
pub const STREAM_ERROR_REASON: &str = "The analysis stream failed";
/// `error.code` of a run whose result could not be saved (RR-13).
pub const ERROR_SAVE_FAILED: &str = "save_failed";
/// `error.reason` of a `save_failed` run.
pub const SAVE_FAILED_REASON: &str = "The analysis result could not be saved";
/// `error.code` of a Cloud run whose AI usage was refused after it started.
pub const ERROR_USAGE_DENIED: &str = "usage_denied";
/// `error.reason` of a `usage_denied` run.
pub const USAGE_DENIED_REASON: &str = "AI usage was not authorized";

/// Longest `error.details` a run stores after redaction, as the failure event always has.
const ERROR_DETAILS_MAX_CHARS: usize = 500;
/// What a redacted internal URL reads as.
const INTERNAL_ENDPOINT: &str = "[internal endpoint]";
/// Stale runs one sweep ends; the next pass picks up the rest.
const SWEEP_BATCH: u64 = 500;

/// Abort handles of the runs this node executes, keyed by run id (RR-20).
static RCA_TASKS: LazyLock<DashMap<String, AbortHandle>> = LazyLock::new(DashMap::new);
/// Any `http(s)://host[:port]` authority left after the named patterns (RR-47).
static URL_AUTHORITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bhttps?://[^\s/?#'"<>(),;]+"#).expect("valid pattern"));

/// What a run analyzes.
#[derive(Debug, Clone, PartialEq)]
pub enum RunSubject {
    Incident(String),
    Alert {
        alert_id: String,
        incident_id: Option<String>,
    },
}

/// A request to start one run.
#[derive(Debug, Clone)]
pub struct StartRun {
    pub org_id: String,
    pub subject: RunSubject,
    pub trigger: RunTrigger,
    pub mode: RunMode,
    pub started_by: String,
    pub guidance: Option<String>,
    /// User-started runs skip the reanalysis cooldown (RR-8).
    pub skip_cooldown: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StartOutcome {
    Started {
        run_id: String,
    },
    /// A live run already holds the subject (RR-5, RR-9).
    InFlight,
    /// A run completed within the reanalysis cooldown (RR-8).
    CoolingDown,
}

/// One write to a run. Mirrors `infra::table::rca_runs::RunUpdate`; the write time is set here.
#[derive(Default)]
pub struct RunPatch {
    pub state: Option<RunState>,
    pub report: Option<String>,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    pub result: Option<serde_json::Value>,
    pub error: Option<RunError>,
    pub cancelled_by: Option<String>,
    pub stats: Option<RunStats>,
    pub summary: Option<RunSummaryPatch>,
    pub steered_by_add: Option<String>,
    pub session_id: Option<String>,
    /// Timeline event committed with the write. Incident runs only; dropped for alert runs.
    pub event: Option<IncidentEvent>,
}

/// Start a run when no live run holds the subject.
///
/// An incident run commits its `AIAnalysisBegin` event with the run, and its
/// workflows fire only after that commit (RR-23).
pub async fn start_run(req: StartRun) -> anyhow::Result<StartOutcome> {
    let StartRun {
        org_id,
        subject,
        trigger,
        mode,
        started_by,
        guidance,
        skip_cooldown,
    } = req;
    let cfg = get_o2_config();

    let (subject_type, subject_id, incident_id) = match subject {
        RunSubject::Incident(id) => (RunSubjectType::Incident, id.clone(), Some(id)),
        RunSubject::Alert {
            alert_id,
            incident_id,
        } => (RunSubjectType::Alert, alert_id, incident_id),
    };
    // Only an incident subject has a timeline.
    let notify_incident = incident_subject(&subject_type, &subject_id);
    let begin_event = notify_incident
        .as_ref()
        .map(|_| IncidentEvent::ai_analysis_begin());

    let new = NewRun {
        run_id: runs_table::new_run_id(),
        org_id: org_id.clone(),
        subject_type,
        subject_id,
        incident_id,
        trigger,
        mode,
        started_by,
        guidance,
    };
    let guards = StartGuards {
        now_us: now_micros(),
        rca_timeout_secs: cfg.incidents.rca_timeout_secs,
        cooldown_us: (!skip_cooldown)
            .then(|| minutes_to_us(cfg.incidents.reanalysis_cooldown_minutes)),
        history_limit: cfg.incidents.rca_history_limit,
    };

    match runs_table::start_run(new, guards, begin_event.clone()).await? {
        StartResult::Started { run_id } => {
            if let (Some(incident_id), Some(event)) = (notify_incident, begin_event) {
                fire_workflows(&org_id, &incident_id, event).await;
            }
            Ok(StartOutcome::Started { run_id })
        }
        StartResult::InFlight => Ok(StartOutcome::InFlight),
        StartResult::CoolingDown => Ok(StartOutcome::CoolingDown),
    }
}

/// Apply one write to a run.
///
/// Returns `false` when the run is gone or no longer in a state that allows the
/// write; the caller then stops and writes nothing else (RR-12). Workflows fire
/// after the commit, except for a cancel (RR-23).
pub async fn update_run(org_id: &str, run_id: &str, patch: RunPatch) -> anyhow::Result<bool> {
    let incident_id = if patch.event.is_some() {
        match runs_table::get_rw(org_id, run_id).await? {
            Some(run) => incident_subject(&runs_table::to_item(&run).subject_type, &run.subject_id),
            None => {
                log::info!("[RCA_RUNS] run {run_id} not updated: it no longer exists");
                return Ok(false);
            }
        }
    } else {
        None
    };
    write_run(org_id, run_id, patch, incident_id.as_deref()).await
}

/// End a run as `failed`.
///
/// An incident run appends `AIAnalysisFailed` with the reason, the trigger type
/// and the details; the list cell shows the reason (D7).
pub async fn fail_run(
    org_id: &str,
    run_id: &str,
    trigger: RunTrigger,
    code: &str,
    reason: &str,
    details: Option<String>,
) -> anyhow::Result<bool> {
    update_run(org_id, run_id, failed_patch(trigger, code, reason, details)).await
}

/// Save an incident run's report, then deliver it to the on-call path.
///
/// Empty content ends the run `failed`/`no_report` (RR-18). On-call reports and
/// the verdict go out only when the completion committed (RR-12). A write that
/// errors ends the run `failed`/`save_failed` before the error returns, and
/// either failure frees the page the run held (RR-13).
pub async fn complete_incident_run(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    content: &str,
) -> anyhow::Result<bool> {
    let result = if content.trim().is_empty() {
        end_without_report(org_id, incident_id, run_id).await
    } else {
        save_incident_report(org_id, incident_id, run_id, content).await
    };
    if let Err(e) = &result {
        end_unsaved_run(org_id, incident_id, run_id, None, e).await;
    }
    result
}

/// Blank content: the run ends `failed`/`no_report`; nothing was saved, so `Ok(false)`.
async fn end_without_report(org_id: &str, incident_id: &str, run_id: &str) -> anyhow::Result<bool> {
    let Some(run) = runs_table::get_rw(org_id, run_id).await? else {
        log::info!("[RCA_RUNS] run {run_id} not updated: it no longer exists");
        return Ok(false);
    };
    let trigger = runs_table::to_item(&run).trigger;
    let patch = failed_patch(trigger, ERROR_NO_REPORT, NO_REPORT_REASON, None);
    end_incident_failed(org_id, incident_id, run_id, patch).await?;
    Ok(false)
}

/// Save an alert run's report, then deliver it to its on-call records (RR-38).
pub async fn complete_alert_run(
    org_id: &str,
    run_id: &str,
    subjects: &[SubjectRef],
    content: &str,
    model: Option<&str>,
) -> anyhow::Result<bool> {
    let patch = RunPatch {
        state: Some(RunState::Completed),
        report: Some(content.to_string()),
        ..Default::default()
    };
    if !write_run(org_id, run_id, patch, None).await? {
        return Ok(false);
    }
    rca_service::save_rca_result_for_records(org_id, subjects, content, model).await;
    Ok(true)
}

/// End a streaming incident run from how its stream ended; returns whether a report was saved.
///
/// A stream error saves nothing, even when text arrived (RR-46); an empty
/// stream ends `no_report` (RR-18). A run that ends without a report frees the
/// page it held; a write that errors ends it `save_failed` (RR-13).
pub async fn finish_incident_stream(
    org_id: String,
    incident_id: String,
    run_id: String,
    trigger: RunTrigger,
    end: RcaStreamEnd,
) -> bool {
    let failure = match end {
        RcaStreamEnd::Completed(content) if !content.trim().is_empty() => {
            return match save_incident_report(&org_id, &incident_id, &run_id, &content).await {
                Ok(saved) => saved,
                Err(e) => {
                    end_unsaved_run(&org_id, &incident_id, &run_id, Some(trigger), &e).await;
                    false
                }
            };
        }
        RcaStreamEnd::Completed(_) | RcaStreamEnd::Empty => {
            failed_patch(trigger, ERROR_NO_REPORT, NO_REPORT_REASON, None)
        }
        RcaStreamEnd::Errored(message) => {
            failed_patch(trigger, ERROR_STREAM, STREAM_ERROR_REASON, Some(message))
        }
    };
    if let Err(e) = end_incident_failed(&org_id, &incident_id, &run_id, failure).await {
        end_unsaved_run(&org_id, &incident_id, &run_id, Some(trigger), &e).await;
    }
    false
}

/// The report of the incident's newest completed run, the input of "Build on previous" (RR-27).
pub async fn newest_completed_report(
    org_id: &str,
    incident_id: &str,
) -> anyhow::Result<Option<String>> {
    Ok(
        runs_table::newest_completed_for_incident(org_id, incident_id)
            .await?
            .and_then(|run| runs_table::to_run(run).report)
            .filter(|report| !report.trim().is_empty()),
    )
}

/// The incident detail's `rca`: the summary plus the current run, the run whose
/// report the Report tab shows, and the history. No report text (RR-29).
pub async fn rca_detail(
    org_id: &str,
    incident: &alert_incidents::Model,
) -> anyhow::Result<Option<RcaSummary>> {
    let cfg = get_o2_config();
    let Some(mut summary) =
        runs_table::summary_from_incident(incident, now_micros(), cfg.incidents.rca_timeout_secs)
    else {
        return Ok(None);
    };

    // Pruning keeps the newest `limit + 1` runs and the newest completed one (RR-25).
    let limit = (cfg.incidents.rca_history_limit as u64).saturating_add(2);
    let (runs, _) = runs_table::list_for_incident(org_id, &incident.id, limit, None).await?;
    let history: Vec<_> = runs.iter().map(runs_table::to_item).collect();
    let report_run = match history.iter().find(|run| run.state == RunState::Completed) {
        Some(run) => Some(run.clone()),
        None => runs_table::newest_completed_for_incident(org_id, &incident.id)
            .await?
            .map(|run| runs_table::to_item(&run)),
    };
    let current_run = runs.into_iter().next().map(|run| {
        let mut run = runs_table::to_run(run);
        run.report = None;
        run
    });

    summary.detail = Some(RcaDetailFields {
        current_run,
        report_run,
        history,
    });
    Ok(Some(summary))
}

/// End every stale run as `failed`/`stale`; returns how many this pass ended (RR-40).
///
/// An incident run appends `AIAnalysisFailed` and releases its held pages. An
/// alert run is only marked failed: its triage budget already released the hold
/// (D9). The compare-and-set in `update_run` makes concurrent sweeps safe.
pub async fn sweep_stale_runs() -> anyhow::Result<usize> {
    let cfg = get_o2_config();
    let stale = runs_table::list_stale_running(
        now_micros(),
        stale_threshold_us(cfg.incidents.rca_timeout_secs),
        SWEEP_BATCH,
    )
    .await?;

    let mut ended = 0;
    for run in stale {
        let item = runs_table::to_item(&run);
        let incident_id = incident_subject(&item.subject_type, &run.subject_id);
        let patch = failed_patch(
            item.trigger,
            runs_table::STALE_ERROR_CODE,
            runs_table::STALE_ERROR_REASON,
            None,
        );
        match write_run(&run.org_id, &item.run_id, patch, incident_id.as_deref()).await {
            Ok(true) => {
                ended += 1;
                if let Some(incident_id) = incident_id {
                    rca_service::skip_analysis_for_incident(&run.org_id, &incident_id).await;
                }
            }
            Ok(false) => {}
            Err(e) => log::warn!("[RCA_RUNS] could not end stale run {}: {e}", item.run_id),
        }
    }
    Ok(ended)
}

/// Track the task that executes a run on this node, so a cancel can abort it.
pub fn register_rca_task(run_id: &str, h: AbortHandle) {
    RCA_TASKS.insert(run_id.to_string(), h);
}

/// Stop tracking a run's task once it has settled. Safe when nothing is registered.
pub fn unregister_rca_task(run_id: &str) {
    RCA_TASKS.remove(run_id);
}

/// Abort the run's task when this node executes it; returns whether one was aborted.
pub fn abort_local_rca_task(run_id: &str) -> bool {
    RCA_TASKS
        .remove(run_id)
        .map(|(_, handle)| handle.abort())
        .is_some()
}

/// Commit a completed incident run, then hand its result to the on-call path.
async fn save_incident_report(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    content: &str,
) -> anyhow::Result<bool> {
    let parsed = config::meta::oncall::parse_report(content);
    let patch = RunPatch {
        state: Some(RunState::Completed),
        report: Some(parsed.report.to_string()),
        event: Some(IncidentEvent::ai_analysis_complete()),
        ..Default::default()
    };
    if !write_run(org_id, run_id, patch, Some(incident_id)).await? {
        return Ok(false);
    }
    rca_service::deliver_incident_result(
        org_id,
        incident_id,
        parsed.report,
        parsed.verdict.as_ref(),
    )
    .await;
    Ok(true)
}

/// End an incident run `failed`; only the write that won frees the page it held (RR-13).
async fn end_incident_failed(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    patch: RunPatch,
) -> anyhow::Result<bool> {
    let ended = write_run(org_id, run_id, patch, Some(incident_id)).await?;
    if ended {
        // §6: no verdict is coming, so nothing may go on holding a page for one.
        rca_service::skip_analysis_for_incident(org_id, incident_id).await;
    }
    Ok(ended)
}

/// A terminal write that errored: try `failed`/`save_failed`, then free the page,
/// since this run delivers no verdict (RR-13, RR-17).
async fn end_unsaved_run(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    trigger: Option<RunTrigger>,
    error: &anyhow::Error,
) {
    log::error!("[RCA_RUNS] could not save the result of run {run_id}: {error:#}");
    let trigger = match trigger {
        Some(trigger) => Some(trigger),
        None => match runs_table::get_rw(org_id, run_id).await {
            Ok(run) => run.map(|run| runs_table::to_item(&run).trigger),
            Err(e) => {
                log::error!("[RCA_RUNS] could not read run {run_id}: {e}");
                None
            }
        },
    };
    if let Some(trigger) = trigger {
        let patch = failed_patch(
            trigger,
            ERROR_SAVE_FAILED,
            SAVE_FAILED_REASON,
            Some(format!("{error:#}")),
        );
        if let Err(e) = write_run(org_id, run_id, patch, Some(incident_id)).await {
            log::error!("[RCA_RUNS] could not end run {run_id} as failed: {e}");
        }
    }
    rca_service::skip_analysis_for_incident(org_id, incident_id).await;
}

/// The write behind every run change. `incident_id` is the run's incident subject,
/// `None` for an alert run, whose event is dropped.
async fn write_run(
    org_id: &str,
    run_id: &str,
    mut patch: RunPatch,
    incident_id: Option<&str>,
) -> anyhow::Result<bool> {
    // RR-47: no internal host, path or agent URL reaches a reader.
    if let Some(details) = patch.error.as_mut().and_then(|e| e.details.as_mut()) {
        *details = redact_details(details);
    }
    if incident_id.is_none() {
        patch.event = None;
    }
    if let Some(IncidentEvent {
        event_type:
            IncidentEventType::AIAnalysisFailed {
                error_details: Some(details),
                ..
            },
        ..
    }) = patch.event.as_mut()
    {
        *details = redact_details(details);
    }
    // RR-23: a cancel keeps today's behavior and starts no workflow.
    let notify = patch
        .event
        .as_ref()
        .filter(|event| {
            !matches!(
                event.event_type,
                IncidentEventType::AIAnalysisCancelled { .. }
            )
        })
        .cloned();

    let RunPatch {
        state,
        report,
        outcome,
        confidence,
        result,
        error,
        cancelled_by,
        stats,
        summary,
        steered_by_add,
        session_id,
        event,
    } = patch;
    let update = RunUpdate {
        state,
        report,
        outcome,
        confidence,
        result,
        error,
        cancelled_by,
        stats,
        summary,
        steered_by_add,
        session_id,
        event,
        now_us: now_micros(),
    };

    if !runs_table::update_run(org_id, run_id, update).await? {
        log::info!("[RCA_RUNS] run {run_id} not updated: its state no longer allows this write");
        return Ok(false);
    }
    if let (Some(incident_id), Some(event)) = (incident_id, notify) {
        fire_workflows(org_id, incident_id, event).await;
    }
    Ok(true)
}

fn failed_patch(
    trigger: RunTrigger,
    code: &str,
    reason: &str,
    details: Option<String>,
) -> RunPatch {
    let trigger_type = trigger.analysis_trigger_type();
    RunPatch {
        state: Some(RunState::Failed),
        error: Some(RunError {
            code: code.to_string(),
            reason: reason.to_string(),
            details: details.clone(),
            trigger_type: Some(trigger_type.to_string()),
        }),
        event: Some(IncidentEvent::ai_analysis_failed(
            reason,
            trigger_type,
            details,
        )),
        ..Default::default()
    }
}

/// The incident a run analyzes, `None` for an alert run.
fn incident_subject(subject_type: &RunSubjectType, subject_id: &str) -> Option<String> {
    matches!(subject_type, RunSubjectType::Incident).then(|| subject_id.to_string())
}

/// RR-47: `redact_internal_details`, then the configured agent URL, then every
/// other `http(s)://` authority (an HA replica has no configured URL). The cap
/// comes last, so no replacement pushes the text past it and no URL is cut
/// before it is matched.
fn redact_details(text: &str) -> String {
    let mut text = redact_internal_details(text);
    let cfg = get_o2_config();
    let agent_url = cfg.ai.agent_url.trim_end_matches('/');
    if !agent_url.is_empty() {
        text = text.replace(agent_url, INTERNAL_ENDPOINT);
    }
    URL_AUTHORITY
        .replace_all(&text, NoExpand(INTERNAL_ENDPOINT))
        .chars()
        .take(ERROR_DETAILS_MAX_CHARS)
        .collect()
}

/// Fire the `IncidentEvent` workflows of an event that has committed.
async fn fire_workflows(org_id: &str, incident_id: &str, event: IncidentEvent) {
    if let Err(e) = crate::incidents::send_incident_event_trigger(org_id, incident_id, event).await
    {
        log::error!("[RCA_RUNS] could not fire workflows for {org_id}/{incident_id}: {e}");
    }
}

fn minutes_to_us(minutes: u64) -> i64 {
    i64::try_from(minutes.saturating_mul(60_000_000)).unwrap_or(i64::MAX)
}

#[cfg(test)]
pub(crate) mod tests {
    use config::meta::{
        alerts::{incidents::IncidentEventType, rca_runs::RcaRun},
        oncall::{AnalysisStatus, ResponderRole, SubjectType},
        triggers::{Trigger, TriggerModule, TriggerStatus},
    };
    use infra::table::entity::{
        alert_incident_alerts, incident_events, oncall_responses, rca_runs as run_rows,
    };
    use o2_enterprise::enterprise::oncall::escalation::EscalationTriggerData;
    use sea_orm::{
        ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Schema,
        sea_query::Expr,
    };
    use tokio::sync::{Mutex, MutexGuard, OnceCell};

    use super::*;

    /// A report whose completed write the database refuses (see [db]).
    const FAIL_THE_WRITE: &str = "FAIL-THE-COMPLETED-WRITE";

    /// The process-wide SQLite meta store with the run tables, held for the whole test.
    ///
    /// The run functions write through the global client, and the sweeper reads every
    /// org's stale runs, so the tests that use it run one at a time. They refuse any
    /// other meta store, so a developer `.env` can never point them at a real database.
    pub(crate) async fn db() -> MutexGuard<'static, ()> {
        static TABLES: OnceCell<()> = OnceCell::const_new();
        static LOCK: Mutex<()> = Mutex::const_new(());
        TABLES
            .get_or_init(|| async {
                let cfg = config::get_config();
                assert!(
                    cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite",
                    "the run tests need the default SQLite meta store, found {:?}; run them \
                     where no .env sets ZO_META_STORE",
                    cfg.common.meta_store
                );
                std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
                let conn = infra::db::get_orm_client_rw().await;
                let backend = conn.get_database_backend();
                let schema = Schema::new(backend);
                for mut table in [
                    schema.create_table_from_entity(alert_incidents::Entity),
                    schema.create_table_from_entity(alert_incident_alerts::Entity),
                    schema.create_table_from_entity(incident_events::Entity),
                    schema.create_table_from_entity(run_rows::Entity),
                    schema.create_table_from_entity(oncall_responses::Entity),
                ] {
                    conn.execute(backend.build(table.if_not_exists()))
                        .await
                        .unwrap();
                }
                // The ladder's triage hold lives on `scheduled_jobs`.
                infra::scheduler::init().await.unwrap();
                // The one way to make a completed write error: only this report is refused.
                conn.execute_unprepared(&format!(
                    "CREATE TRIGGER IF NOT EXISTS rca_runs_test_failed_write \
                     BEFORE UPDATE OF report ON rca_runs WHEN NEW.report = '{FAIL_THE_WRITE}' \
                     BEGIN SELECT RAISE(ABORT, 'the test refused this write'); END"
                ))
                .await
                .unwrap();
            })
            .await;
        LOCK.lock().await
    }

    /// A fresh org with one open incident that was never analyzed.
    pub(crate) async fn new_incident(topology: Option<serde_json::Value>) -> (String, String) {
        let org_id = format!("rca_{}", runs_table::new_run_id().to_lowercase());
        let incident_id = add_incident(&org_id, topology).await;
        (org_id, incident_id)
    }

    /// One more open, never-analyzed incident in the org.
    pub(crate) async fn add_incident(org_id: &str, topology: Option<serde_json::Value>) -> String {
        let incident_id = runs_table::new_run_id();
        let now = now_micros();
        let row: alert_incidents::ActiveModel = alert_incidents::Model {
            id: incident_id.clone(),
            org_id: org_id.to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({}),
            key_type: "alert_id".to_string(),
            topology_context: topology,
            first_alert_at: now,
            last_alert_at: now,
            resolved_at: None,
            alert_count: 1,
            title: Some("checkout errors".to_string()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: now,
            updated_at: now,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
        }
        .into();
        alert_incidents::Entity::insert(row.reset_all())
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        incident_id
    }

    pub(crate) fn incident_start(org_id: &str, incident_id: &str, trigger: RunTrigger) -> StartRun {
        StartRun {
            org_id: org_id.to_string(),
            subject: RunSubject::Incident(incident_id.to_string()),
            trigger,
            mode: RunMode::Fresh,
            started_by: "a.rao@acme.io".to_string(),
            guidance: None,
            skip_cooldown: trigger.is_user_started(),
        }
    }

    /// Starts an incident run that must start.
    pub(crate) async fn start(org_id: &str, incident_id: &str, trigger: RunTrigger) -> String {
        match start_run(incident_start(org_id, incident_id, trigger))
            .await
            .unwrap()
        {
            StartOutcome::Started { run_id } => run_id,
            other => panic!("the run did not start: {other:?}"),
        }
    }

    pub(crate) async fn stored(org_id: &str, run_id: &str) -> RcaRun {
        runs_table::to_run(runs_table::get(org_id, run_id).await.unwrap().unwrap())
    }

    pub(crate) async fn incident_row(org_id: &str, incident_id: &str) -> alert_incidents::Model {
        infra::table::alert_incidents::get(org_id, incident_id)
            .await
            .unwrap()
            .unwrap()
    }

    pub(crate) async fn timeline(org_id: &str, incident_id: &str) -> Vec<IncidentEventType> {
        infra::table::incident_events::get(org_id, incident_id)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.event_type)
            .collect()
    }

    pub(crate) fn completes(events: &[IncidentEventType]) -> usize {
        events
            .iter()
            .filter(|e| matches!(e, IncidentEventType::AIAnalysisComplete))
            .count()
    }

    pub(crate) fn failures(events: &[IncidentEventType]) -> Vec<&IncidentEventType> {
        events
            .iter()
            .filter(|e| matches!(e, IncidentEventType::AIAnalysisFailed { .. }))
            .collect()
    }

    /// Makes the run's last write `secs` old, on the run and on the incident summary.
    pub(crate) async fn age(org_id: &str, incident_id: &str, run_id: &str, secs: i64) {
        let at = now_micros() - secs * 1_000_000;
        let conn = infra::db::get_orm_client_rw().await;
        run_rows::Entity::update_many()
            .col_expr(run_rows::Column::UpdatedAt, Expr::value(at))
            .filter(run_rows::Column::OrgId.eq(org_id))
            .filter(run_rows::Column::RunId.eq(run_id))
            .exec(conn)
            .await
            .unwrap();
        alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::RcaUpdatedAt, Expr::value(at))
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::Id.eq(incident_id))
            .exec(conn)
            .await
            .unwrap();
    }

    /// RR-12: a write the run's state no longer allows changes nothing and appends nothing.
    #[tokio::test]
    async fn a_write_the_run_no_longer_allows_returns_false_and_appends_nothing() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            fail_run(
                &org,
                &run_id,
                RunTrigger::Manual,
                "agent_unavailable",
                "down",
                None
            )
            .await
            .unwrap()
        );
        let before = timeline(&org, &inc).await;

        let late = RunPatch {
            state: Some(RunState::Completed),
            report: Some("late report".to_string()),
            event: Some(IncidentEvent::ai_analysis_complete()),
            ..Default::default()
        };
        assert!(!update_run(&org, &run_id, late).await.unwrap());
        let gone = RunPatch {
            event: Some(IncidentEvent::ai_analysis_complete()),
            ..Default::default()
        };
        assert!(!update_run(&org, "no-such-run", gone).await.unwrap());

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.report, None);
        assert_eq!(timeline(&org, &inc).await.len(), before.len());
        assert_eq!(completes(&timeline(&org, &inc).await), 0);
    }

    /// RR-14: the failure keeps the event's reason, details and trigger type and adds a code.
    #[tokio::test]
    async fn a_failure_stores_its_error_and_appends_one_failed_event() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let details = format!("opencode failed at /home/appuser/work: {}", "x".repeat(600));

        assert!(
            fail_run(
                &org,
                &run_id,
                RunTrigger::Manual,
                "service_call_failed",
                "RCA service call failed",
                Some(details),
            )
            .await
            .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert!(run.ended_at.is_some());
        let error = run.error.expect("a failed run stores its error");
        assert_eq!(error.code, "service_call_failed");
        assert_eq!(error.reason, "RCA service call failed");
        assert_eq!(error.trigger_type.as_deref(), Some("manual"));
        let stored_details = error.details.expect("details are kept");
        assert!(!stored_details.contains("opencode"), "{stored_details}");
        assert!(
            !stored_details.contains("/home/appuser"),
            "{stored_details}"
        );
        assert!(
            stored_details.chars().count() <= 500,
            "details are capped at 500 chars, got {}",
            stored_details.chars().count()
        );

        let events = timeline(&org, &inc).await;
        let failed = failures(&events);
        assert_eq!(failed.len(), 1);
        let IncidentEventType::AIAnalysisFailed {
            reason,
            trigger_type,
            error_details,
        } = failed[0]
        else {
            unreachable!()
        };
        assert_eq!(reason, "RCA service call failed");
        assert!(matches!(
            trigger_type,
            config::meta::alerts::incidents::AnalysisTriggerType::Manual
        ));
        assert_eq!(error_details.as_deref(), Some(stored_details.as_str()));
        assert_eq!(
            incident_row(&org, &inc).await.rca_state.as_deref(),
            Some("failed")
        );
    }

    /// RR-15: the spawned task and its wrapper both fail the run; only the first counts.
    #[tokio::test]
    async fn a_second_failure_of_the_same_run_is_a_no_op() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::AutoNewIncident).await;
        let fail = || {
            fail_run(
                &org,
                &run_id,
                RunTrigger::AutoNewIncident,
                "service_call_failed",
                "RCA service call failed",
                Some("timeout".to_string()),
            )
        };
        assert!(fail().await.unwrap());
        assert!(!fail().await.unwrap());
        assert_eq!(failures(&timeline(&org, &inc).await).len(), 1);
    }

    /// RR-16, RR-17: the report, the state and the Complete event land together;
    /// `topology_context` is not touched.
    #[tokio::test]
    async fn a_report_completes_the_run_with_one_complete_event_and_keeps_the_topology() {
        let _db = db().await;
        let topology = serde_json::json!({
            "nodes": [{"service": "checkout", "alerts": 3}],
            "rca_analysis": "an old report that stays where it was"
        });
        let (org, inc) = new_incident(Some(topology.clone())).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;

        assert!(
            complete_incident_run(&org, &inc, &run_id, "## Root cause\nThe DB pool ran dry.")
                .await
                .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Completed);
        assert!(run.ended_at.is_some());
        assert_eq!(
            run.report.as_deref(),
            Some("## Root cause\nThe DB pool ran dry.")
        );
        let row = incident_row(&org, &inc).await;
        assert_eq!(row.rca_state.as_deref(), Some("completed"));
        assert_eq!(row.rca_run_id.as_deref(), Some(run_id.as_str()));
        assert_eq!(completes(&timeline(&org, &inc).await), 1);
        assert_eq!(
            serde_json::to_vec(&row.topology_context).unwrap(),
            serde_json::to_vec(&Some(topology)).unwrap()
        );
    }

    /// RR-18: an empty agent answer is a failure, not a completed run.
    #[tokio::test]
    async fn a_blank_report_ends_the_run_no_report() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;

        assert!(
            !complete_incident_run(&org, &inc, &run_id, " \n\t")
                .await
                .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_NO_REPORT);
        assert_eq!(run.report, None);
        let events = timeline(&org, &inc).await;
        assert_eq!(completes(&events), 0);
        assert_eq!(failures(&events).len(), 1);
    }

    /// RR-46: a broken stream saves nothing; the earlier completed run stays the report run.
    #[tokio::test]
    async fn a_stream_error_saves_nothing_and_keeps_the_earlier_report_run() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let first = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_incident_run(&org, &inc, &first, "first report")
                .await
                .unwrap()
        );
        let second = start(&org, &inc, RunTrigger::Reanalyze).await;

        let saved = finish_incident_stream(
            org.clone(),
            inc.clone(),
            second.clone(),
            RunTrigger::Reanalyze,
            RcaStreamEnd::Errored("connection reset after partial text".to_string()),
        )
        .await;

        assert!(!saved);
        let run = stored(&org, &second).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_STREAM);
        assert_eq!(run.report, None);
        let detail = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .unwrap()
            .detail
            .unwrap();
        assert_eq!(detail.report_run.unwrap().run_id, first);
        assert_eq!(
            completes(&timeline(&org, &inc).await),
            1,
            "only the first run's"
        );
    }

    /// RR-46, RR-18: an empty stream ends `no_report`; a stream with text completes the run.
    #[tokio::test]
    async fn an_empty_stream_ends_no_report_and_a_finished_stream_completes() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let empty = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            !finish_incident_stream(
                org.clone(),
                inc.clone(),
                empty.clone(),
                RunTrigger::Manual,
                RcaStreamEnd::Empty,
            )
            .await
        );
        let run = stored(&org, &empty).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_NO_REPORT);
        assert_eq!(completes(&timeline(&org, &inc).await), 0);

        let done = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            finish_incident_stream(
                org.clone(),
                inc.clone(),
                done.clone(),
                RunTrigger::Manual,
                RcaStreamEnd::Completed("streamed report".to_string()),
            )
            .await
        );
        let run = stored(&org, &done).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.report.as_deref(), Some("streamed report"));
        assert_eq!(completes(&timeline(&org, &inc).await), 1);
    }

    /// RR-27: "Build on previous" reads the newest completed report.
    #[tokio::test]
    async fn build_on_previous_reads_the_newest_completed_report() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        assert_eq!(newest_completed_report(&org, &inc).await.unwrap(), None);
        for report in ["older report", "newer report"] {
            let run_id = start(&org, &inc, RunTrigger::Manual).await;
            assert!(
                complete_incident_run(&org, &inc, &run_id, report)
                    .await
                    .unwrap()
            );
        }
        let failed = start(&org, &inc, RunTrigger::Manual).await;
        fail_run(&org, &failed, RunTrigger::Manual, "x", "x", None)
            .await
            .unwrap();

        assert_eq!(
            newest_completed_report(&org, &inc)
                .await
                .unwrap()
                .as_deref(),
            Some("newer report")
        );
    }

    /// RR-29: the detail names the runs and carries no report text; never analyzed is `None`.
    #[tokio::test]
    async fn the_detail_carries_the_runs_but_no_report_text() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        assert!(
            rca_detail(&org, &incident_row(&org, &inc).await)
                .await
                .unwrap()
                .is_none()
        );

        let done = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_incident_run(&org, &inc, &done, "REPORT-TEXT-MUST-NOT-LEAK")
                .await
                .unwrap()
        );
        let live = start(&org, &inc, RunTrigger::Reanalyze).await;

        let summary = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(summary.run_id, live);
        assert_eq!(summary.state, RunState::Running);
        let detail = summary.detail.as_ref().unwrap();
        let current = detail.current_run.as_ref().unwrap();
        assert_eq!(current.run_id, live);
        assert_eq!(current.report, None);
        assert_eq!(detail.report_run.as_ref().unwrap().run_id, done);
        let history: Vec<_> = detail.history.iter().map(|r| r.run_id.as_str()).collect();
        assert_eq!(history, [live.as_str(), done.as_str()]);

        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains("REPORT-TEXT-MUST-NOT-LEAK"), "{json}");
        let value = serde_json::to_value(&summary).unwrap();
        assert!(value["current_run"].is_object());
        assert!(value["report_run"].is_object());
        assert!(value["history"].is_array());
    }

    /// RR-40: the sweep ends a run 721 s past its last write once and leaves a fresh run.
    #[tokio::test]
    async fn the_sweep_ends_a_stale_run_once_and_leaves_a_fresh_one() {
        let _db = db().await;
        let timeout = get_o2_config().incidents.rca_timeout_secs;
        let (org, stale_inc) = new_incident(None).await;
        let stale = start(&org, &stale_inc, RunTrigger::AutoNewIncident).await;
        age(&org, &stale_inc, &stale, timeout as i64 + 121).await;
        let fresh_inc = add_incident(&org, None).await;
        let fresh = start(&org, &fresh_inc, RunTrigger::AutoNewIncident).await;

        assert!(sweep_stale_runs().await.unwrap() >= 1);
        sweep_stale_runs().await.unwrap();

        let run = stored(&org, &stale).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, runs_table::STALE_ERROR_CODE);
        assert_eq!(
            incident_row(&org, &stale_inc).await.rca_state.as_deref(),
            Some("failed")
        );
        assert_eq!(failures(&timeline(&org, &stale_inc).await).len(), 1);
        assert_eq!(stored(&org, &fresh).await.state, RunState::Running);
        assert!(failures(&timeline(&org, &fresh_inc).await).is_empty());
    }

    /// RR-47: no agent URL or internal host name reaches a reader through the details.
    #[tokio::test]
    async fn an_agent_url_in_the_details_is_stored_redacted() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        fail_run(
            &org,
            &run_id,
            RunTrigger::Manual,
            "agent_unavailable",
            "The AI SRE agent is not available",
            Some("error sending request for url (http://o2-ai.svc:8080/api/v1/health)".to_string()),
        )
        .await
        .unwrap();

        let details = stored(&org, &run_id).await.error.unwrap().details.unwrap();
        assert!(!details.contains("o2-ai.svc"), "stored: {details}");
        let events = timeline(&org, &inc).await;
        let IncidentEventType::AIAnalysisFailed { error_details, .. } = failures(&events)[0] else {
            unreachable!()
        };
        assert!(
            !error_details
                .as_deref()
                .unwrap_or_default()
                .contains("o2-ai.svc"),
            "event: {error_details:?}"
        );
    }

    /// RR-38: an alert run saves first and keeps no incident and no timeline.
    #[tokio::test]
    async fn an_alert_run_completes_or_fails_without_an_incident() {
        let _db = db().await;
        let org = format!("rca_{}", runs_table::new_run_id().to_lowercase());
        let start_alert = |alert_id: &str| StartRun {
            org_id: org.clone(),
            subject: RunSubject::Alert {
                alert_id: alert_id.to_string(),
                incident_id: None,
            },
            trigger: RunTrigger::OncallPage,
            mode: RunMode::Fresh,
            started_by: "system".to_string(),
            guidance: None,
            skip_cooldown: true,
        };
        let StartOutcome::Started { run_id: done } = start_run(start_alert("al_1")).await.unwrap()
        else {
            panic!("the alert run did not start")
        };
        assert!(
            complete_alert_run(&org, &done, &[], "alert report", None)
                .await
                .unwrap()
        );
        let run = stored(&org, &done).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.subject_type, RunSubjectType::Alert);
        assert_eq!(run.incident_id, None);
        assert_eq!(run.report.as_deref(), Some("alert report"));
        assert!(
            !complete_alert_run(&org, &done, &[], "again", None)
                .await
                .unwrap()
        );

        let StartOutcome::Started { run_id: empty } = start_run(start_alert("al_2")).await.unwrap()
        else {
            panic!("the alert run did not start")
        };
        assert!(
            fail_run(
                &org,
                &empty,
                RunTrigger::OncallPage,
                ERROR_NO_REPORT,
                "The analysis returned no report",
                None,
            )
            .await
            .unwrap()
        );
        let run = stored(&org, &empty).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_NO_REPORT);
        assert_eq!(run.incident_id, None);
    }

    /// RR-8: automatic runs wait out the cooldown after a completed run; user runs do not.
    #[tokio::test]
    async fn an_automatic_start_in_the_cooldown_starts_nothing_and_a_user_start_does() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let done = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_incident_run(&org, &inc, &done, "report")
                .await
                .unwrap()
        );

        assert_eq!(
            start_run(incident_start(&org, &inc, RunTrigger::AutoNewAlertType))
                .await
                .unwrap(),
            StartOutcome::CoolingDown
        );
        assert_eq!(
            incident_row(&org, &inc).await.rca_run_id.as_deref(),
            Some(done.as_str())
        );
        start(&org, &inc, RunTrigger::Reanalyze).await;
    }

    /// RR-5, RR-9: a live run holds the incident against every new start.
    #[tokio::test]
    async fn a_live_run_holds_the_incident() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let live = start(&org, &inc, RunTrigger::AutoNewIncident).await;
        assert_eq!(
            start_run(incident_start(&org, &inc, RunTrigger::Manual))
                .await
                .unwrap(),
            StartOutcome::InFlight
        );
        assert_eq!(
            incident_row(&org, &inc).await.rca_run_id.as_deref(),
            Some(live.as_str())
        );
    }

    /// D2, RR-45: a user-started run never consults `rca_off_reason`.
    #[tokio::test]
    async fn a_user_start_ignores_l0_off() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        infra::table::alert_incidents::set_rca_off_reason(&org, &inc, Some("l0_off"))
            .await
            .unwrap();
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        assert_eq!(stored(&org, &run_id).await.state, RunState::Running);
    }

    /// RR-20: only the node that holds a run's task aborts it.
    #[tokio::test]
    async fn a_registered_task_is_aborted_once_and_an_unknown_run_aborts_nothing() {
        let task = tokio::spawn(std::future::pending::<()>());
        let run_id = runs_table::new_run_id();
        register_rca_task(&run_id, task.abort_handle());
        assert!(abort_local_rca_task(&run_id));
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(!abort_local_rca_task(&run_id));
        assert!(!abort_local_rca_task("run-on-another-node"));
        unregister_rca_task("run-on-another-node");
    }

    /// An open on-call record of the incident whose ladder waits for this analysis.
    async fn hold_page(org_id: &str, incident_id: &str) -> String {
        let subject = config::meta::oncall::SubjectRef::new(SubjectType::Incident, incident_id, 1);
        let record = infra::table::oncall_responses::open(
            org_id,
            &subject,
            None,
            2,
            None,
            ResponderRole::Owner,
            None,
        )
        .await
        .unwrap();
        let mut data = EscalationTriggerData::none();
        data.analysis.status = AnalysisStatus::Pending;
        infra::scheduler::push(Trigger {
            org: org_id.to_string(),
            module: TriggerModule::OncallEscalation,
            module_key: record.id.clone(),
            next_run_at: now_micros() + 3_600_000_000,
            status: TriggerStatus::Waiting,
            data: data.write(),
            ..Default::default()
        })
        .await
        .unwrap();
        record.id
    }

    /// What the record's ladder holds for: `Pending` while it still waits for a verdict.
    async fn hold_status(org_id: &str, record_id: &str) -> AnalysisStatus {
        let trigger = infra::scheduler::get(org_id, TriggerModule::OncallEscalation, record_id)
            .await
            .unwrap();
        EscalationTriggerData::read(&trigger.data).analysis.status
    }

    /// Ends the run the way a cancel's write does, without the cancel's own release.
    async fn cancel_write(org_id: &str, run_id: &str) {
        let cancel = RunPatch {
            state: Some(RunState::Cancelled),
            cancelled_by: Some("a.rao@acme.io".to_string()),
            event: Some(IncidentEvent::ai_analysis_cancelled(Some(
                "a.rao@acme.io".to_string(),
            ))),
            ..Default::default()
        };
        assert!(update_run(org_id, run_id, cancel).await.unwrap());
    }

    /// RR-13, RR-18: a blank answer that ends its run frees the held page.
    #[tokio::test]
    async fn a_blank_report_that_ends_the_run_releases_the_hold() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::AutoNewIncident).await;
        let record = hold_page(&org, &inc).await;

        assert!(
            !complete_incident_run(&org, &inc, &run_id, "")
                .await
                .unwrap()
        );

        assert_eq!(stored(&org, &run_id).await.state, RunState::Failed);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Skipped);
    }

    /// RR-12: a blank answer for a run that already ended writes nothing and releases nothing.
    #[tokio::test]
    async fn a_blank_report_for_an_ended_run_releases_nothing() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::AutoNewIncident).await;
        cancel_write(&org, &run_id).await;
        let record = hold_page(&org, &inc).await;
        let before = timeline(&org, &inc).await.len();

        assert!(
            !complete_incident_run(&org, &inc, &run_id, "  ")
                .await
                .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.error, None);
        assert_eq!(timeline(&org, &inc).await.len(), before);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Pending);
    }

    /// RR-13, RR-46: a broken stream that ends its run frees the held page.
    #[tokio::test]
    async fn a_stream_error_that_ends_the_run_releases_the_hold() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let record = hold_page(&org, &inc).await;

        let saved = finish_incident_stream(
            org.clone(),
            inc.clone(),
            run_id.clone(),
            RunTrigger::Manual,
            RcaStreamEnd::Errored("reset".to_string()),
        )
        .await;

        assert!(!saved);
        assert_eq!(
            stored(&org, &run_id).await.error.unwrap().code,
            ERROR_STREAM
        );
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Skipped);
    }

    /// RR-12, RR-46: a broken stream for a run that already ended writes and releases nothing.
    #[tokio::test]
    async fn a_stream_error_for_an_ended_run_releases_nothing() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        cancel_write(&org, &run_id).await;
        let record = hold_page(&org, &inc).await;
        let before = timeline(&org, &inc).await.len();

        let saved = finish_incident_stream(
            org.clone(),
            inc.clone(),
            run_id.clone(),
            RunTrigger::Manual,
            RcaStreamEnd::Errored("reset".to_string()),
        )
        .await;

        assert!(!saved);
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.error, None);
        assert_eq!(timeline(&org, &inc).await.len(), before);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Pending);
    }

    /// RR-13, RR-17: a completed write that errors ends the run `save_failed`, appends no
    /// Complete event and frees the held page.
    #[tokio::test]
    async fn a_completed_write_that_errors_ends_the_run_save_failed() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let record = hold_page(&org, &inc).await;

        assert!(
            complete_incident_run(&org, &inc, &run_id, FAIL_THE_WRITE)
                .await
                .is_err()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        let error = run.error.unwrap();
        assert_eq!(error.code, ERROR_SAVE_FAILED);
        assert_eq!(error.reason, SAVE_FAILED_REASON);
        assert_eq!(run.report, None);
        let events = timeline(&org, &inc).await;
        assert_eq!(completes(&events), 0);
        assert_eq!(failures(&events).len(), 1);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Skipped);
    }

    /// RR-46, RR-13: the streaming path ends the same way when its completed write errors.
    #[tokio::test]
    async fn a_finished_stream_whose_write_errors_ends_the_run_save_failed() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Reanalyze).await;
        let record = hold_page(&org, &inc).await;

        let saved = finish_incident_stream(
            org.clone(),
            inc.clone(),
            run_id.clone(),
            RunTrigger::Reanalyze,
            RcaStreamEnd::Completed(FAIL_THE_WRITE.to_string()),
        )
        .await;

        assert!(!saved);
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_SAVE_FAILED);
        assert_eq!(completes(&timeline(&org, &inc).await), 0);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Skipped);
    }

    /// RR-47: a URL that straddles the 500-char cap is redacted before the cut, so no
    /// fragment of the host survives.
    #[tokio::test]
    async fn an_internal_url_at_the_cap_is_redacted_before_the_cut() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        // The URL starts at char 472 and ends past 500: the cap alone would cut its host.
        let details = format!(
            "{} https://rca-worker-3.o2-ai.svc.cluster.local:8443/api/v1/analyze",
            "x".repeat(470)
        );

        fail_run(
            &org,
            &run_id,
            RunTrigger::Manual,
            "service_call_failed",
            "RCA service call failed",
            Some(details),
        )
        .await
        .unwrap();

        let stored_details = stored(&org, &run_id).await.error.unwrap().details.unwrap();
        assert!(stored_details.chars().count() <= 500);
        for fragment in ["https://", "rca-worker", "o2-ai", "svc"] {
            assert!(
                !stored_details.contains(fragment),
                "stored: {stored_details}"
            );
        }
        assert!(
            stored_details.contains("[internal endpoint]"),
            "stored: {stored_details}"
        );
        let events = timeline(&org, &inc).await;
        let IncidentEventType::AIAnalysisFailed { error_details, .. } = failures(&events)[0] else {
            unreachable!()
        };
        assert_eq!(error_details.as_deref(), Some(stored_details.as_str()));
    }
}

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

use config::{
    meta::alerts::{
        incidents::{IncidentEvent, IncidentEventType},
        rca_runs::{
            RcaDetailFields, RcaRun, RcaSummary, ReportFormat, RunError, RunMode, RunState,
            RunSubjectType, RunTrigger, V1Report, has_v1_reports, v1_reports,
        },
    },
    utils::{redact::redact_rca_details, time::now_micros},
};
use infra::table::{
    entity::alert_incidents,
    rca_runs::{self as runs_table, NewRun, RunUpdate, StartGuards, StartResult},
};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

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
/// `error.code` of a run whose agent failed or answered with an error.
pub const ERROR_AGENT_ERROR: &str = "agent_error";
/// `error.reason` of an `agent_error` run.
pub const AGENT_ERROR_REASON: &str = "The agent failed";
/// `error.code` of a run whose agent ended without submitting a report.
pub const ERROR_NO_REPORT: &str = "no_report";
/// `error.reason` of a `no_report` run.
pub const NO_REPORT_REASON: &str = "The analysis returned no report";
/// `error.code` of a run whose turn reached the RCA deadline.
pub const ERROR_TIMEOUT: &str = "timeout";
/// `error.reason` of a `timeout` run.
pub const TIMEOUT_REASON: &str = "The analysis timed out";
/// `error.code` of a run whose turn stopped again after its continuation.
pub const ERROR_INTERRUPTED: &str = "interrupted";
/// `error.reason` of an `interrupted` run.
pub const INTERRUPTED_REASON: &str = "The analysis was interrupted";
/// `error.code` of a run whose transcript could not be stored.
pub const ERROR_PERSISTENCE_FAILED: &str = "persistence_failed";
/// `error.reason` of a `persistence_failed` run.
pub const PERSISTENCE_FAILED_REASON: &str = "The analysis transcript could not be saved";
/// `error.code` of a run whose chat session was deleted under its turn.
pub const ERROR_TRANSCRIPT_DELETED: &str = "transcript_deleted";
/// `error.reason` of a `transcript_deleted` run.
pub const TRANSCRIPT_DELETED_REASON: &str = "The analysis transcript was deleted";
/// `error.code` of a run whose result could not be saved.
pub const ERROR_SAVE_FAILED: &str = "save_failed";
/// `error.reason` of a `save_failed` run.
pub const SAVE_FAILED_REASON: &str = "The analysis result could not be saved";
/// `error.code` of a Cloud run whose AI usage was refused after it started.
pub const ERROR_USAGE_DENIED: &str = "usage_denied";
/// `error.reason` of a `usage_denied` run.
pub const USAGE_DENIED_REASON: &str = "AI usage was not authorized";
/// `error.code` of a resumed run whose source session could not be copied.
pub const ERROR_RESUME_FAILED: &str = "resume_failed";
/// `error.reason` of a `resume_failed` run.
pub const RESUME_FAILED_REASON: &str = "The earlier steps could not be reused";

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
    /// User-started runs skip the reanalysis cooldown.
    pub skip_cooldown: bool,
    /// Serialized `Vec<SubjectRef>`: the pending on-call records of an alert run.
    pub oncall_subjects: Option<serde_json::Value>,
    /// `context_used` stored with the row: a resumed run's `{resumed_from}`.
    pub context_used: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StartOutcome {
    Started {
        run_id: String,
    },
    /// A live run already holds the subject.
    InFlight,
    /// A run completed within the reanalysis cooldown.
    CoolingDown,
}

/// Commit the run and Begin event atomically; dispatch workflows only after commit.
pub async fn start_run(req: StartRun) -> anyhow::Result<StartOutcome> {
    start_run_after(req, None).await
}

/// [start_run] for a decision made on the incident's latest run: any start since then wins.
pub async fn start_run_if_latest(
    req: StartRun,
    latest_run_id: &str,
) -> anyhow::Result<StartOutcome> {
    start_run_after(req, Some(latest_run_id)).await
}

async fn start_run_after(
    req: StartRun,
    latest_run_id: Option<&str>,
) -> anyhow::Result<StartOutcome> {
    let StartRun {
        org_id,
        subject,
        trigger,
        mode,
        started_by,
        guidance,
        skip_cooldown,
        oncall_subjects,
        context_used,
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

    let run_id = runs_table::new_run_id();
    let now_us = now_micros();
    // A run started with guidance commits its `guidance` row with the start.
    let guidance_row = match (incident_id.as_deref(), guidance.as_deref()) {
        (Some(incident_id), Some(text)) if subject_type == RunSubjectType::Incident => {
            Some(super::rca_steering::guidance_row(
                &org_id,
                &run_id,
                incident_id,
                &started_by,
                text,
                now_us,
            ))
        }
        _ => None,
    };
    let new = NewRun {
        run_id,
        org_id: org_id.clone(),
        subject_type,
        subject_id,
        incident_id,
        trigger,
        mode,
        started_by,
        guidance,
        oncall_subjects,
        context_used,
    };
    let guards = StartGuards {
        now_us,
        rca_timeout_secs: cfg.incidents.rca_timeout_secs,
        cooldown_us: (!skip_cooldown)
            .then(|| minutes_to_us(cfg.incidents.reanalysis_cooldown_minutes)),
        history_limit: cfg.incidents.rca_history_limit,
        latest_run_id,
    };

    match runs_table::start_run(new, guards, begin_event.clone(), guidance_row).await? {
        StartResult::Started {
            run_id,
            replaced_stale,
            replaced_run_id,
        } => {
            // The stale run this start replaced ended `failed`/`stale` here.
            if let Some(stale_trigger) = replaced_stale {
                count_run_end(
                    &org_id,
                    stale_trigger,
                    RunState::Failed,
                    runs_table::STALE_ERROR_CODE,
                );
            }
            // Its unread steering rows end with it.
            if let Some(stale_run_id) = replaced_run_id {
                super::rca_steering::close_unread(&org_id, &stale_run_id, RunState::Failed).await;
            }
            if let (Some(incident_id), Some(event)) = (notify_incident, begin_event) {
                fire_workflows(&org_id, &incident_id, event).await;
            }
            Ok(StartOutcome::Started { run_id })
        }
        StartResult::InFlight => Ok(StartOutcome::InFlight),
        StartResult::CoolingDown => Ok(StartOutcome::CoolingDown),
    }
}

/// Return false on a lost state guard; dispatch non-cancel workflows after commit.
pub async fn update_run(org_id: &str, run_id: &str, patch: RunUpdate) -> anyhow::Result<bool> {
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

/// End as failed with one failure event; count only a winning write.
pub async fn fail_run(
    org_id: &str,
    run_id: &str,
    trigger: RunTrigger,
    code: &str,
    reason: &str,
    details: Option<String>,
) -> anyhow::Result<bool> {
    fail_run_with(
        org_id,
        run_id,
        trigger,
        code,
        reason,
        details,
        RunUpdate::default(),
    )
    .await
}

/// Fail atomically with final counts; failure owns the state, error and event.
pub(crate) async fn fail_run_with(
    org_id: &str,
    run_id: &str,
    trigger: RunTrigger,
    code: &str,
    reason: &str,
    details: Option<String>,
    extra: RunUpdate,
) -> anyhow::Result<bool> {
    let failed = failed_patch(trigger, code, reason, details);
    let patch = RunUpdate {
        state: failed.state,
        error: failed.error,
        event: failed.event,
        ..extra
    };
    let ended = update_run(org_id, run_id, patch).await?;
    if ended {
        count_run_end(org_id, trigger, RunState::Failed, code);
    }
    Ok(ended)
}

/// Commit report and Complete event atomically; only the winning finalizer delivers the verdict.
pub async fn complete_run(
    org_id: &str,
    run_id: &str,
    report: &str,
    patch: RunUpdate,
) -> anyhow::Result<bool> {
    let patch = RunUpdate {
        state: Some(RunState::Completed),
        report: Some(report.to_string()),
        event: Some(IncidentEvent::ai_analysis_complete()),
        ..patch
    };
    update_run(org_id, run_id, patch).await
}

/// `rca_runs_total`, once for each run that reaches a terminal state.
pub(crate) fn count_run_end(org_id: &str, trigger: RunTrigger, state: RunState, error_code: &str) {
    config::metrics::RCA_RUNS_TOTAL
        .with_label_values(&[org_id, trigger.as_str(), state.as_str(), error_code])
        .inc();
}

/// Input of "Build on previous": the newest completed report, else the newest pre-run one.
pub async fn newest_completed_report(
    org_id: &str,
    incident_id: &str,
) -> anyhow::Result<Option<String>> {
    let stored = runs_table::newest_completed_for_incident(org_id, incident_id)
        .await?
        .and_then(|run| runs_table::to_run(run).report)
        .filter(|report| !report.trim().is_empty());
    if stored.is_some() {
        return Ok(stored);
    }
    let incident = infra::table::alert_incidents::get(org_id, incident_id).await?;
    Ok(incident
        .and_then(|incident| incident.topology_context)
        .and_then(|topology| v1_reports(&topology, &[], 0).into_iter().next())
        .map(|report| report.report))
}

/// Metadata and history without report text; pre-run reports follow the stored runs.
pub async fn rca_detail(
    org_id: &str,
    incident: &alert_incidents::Model,
) -> anyhow::Result<Option<RcaSummary>> {
    rca_detail_at(org_id, incident, now_micros()).await
}

/// [rca_detail] with `stale` judged at `now_us`.
pub async fn rca_detail_at(
    org_id: &str,
    incident: &alert_incidents::Model,
    now_us: i64,
) -> anyhow::Result<Option<RcaSummary>> {
    let cfg = get_o2_config();
    let v1 = v1_reports_of(org_id, incident).await?;
    let stored =
        runs_table::summary_from_incident(incident, now_us, cfg.incidents.rca_timeout_secs);
    let Some(mut summary) = stored.or_else(|| v1.first().map(V1Report::summary)) else {
        return Ok(None);
    };

    let mut detail = match summary.report_format {
        ReportFormat::V2 => stored_detail(org_id, &incident.id, &summary.run_id).await?,
        ReportFormat::V1 => RcaDetailFields {
            current_run: None,
            report_run: None,
            history: Vec::new(),
            resume_run_id: None,
        },
    };
    if let Some(newest) = v1.first() {
        detail
            .current_run
            .get_or_insert_with(|| newest.run(&incident.id));
        detail.report_run.get_or_insert_with(|| newest.item());
    }
    detail.history.extend(v1.iter().map(V1Report::item));
    summary.detail = Some(detail);
    Ok(Some(summary))
}

/// The incident's pre-run reports, newest first; no database read when it has none.
pub async fn v1_reports_of(
    org_id: &str,
    incident: &alert_incidents::Model,
) -> anyhow::Result<Vec<V1Report>> {
    let Some(topology) = incident
        .topology_context
        .as_ref()
        .filter(|topology| has_v1_reports(topology))
    else {
        return Ok(Vec::new());
    };
    // Runs write `AIAnalysisComplete` too; only the ones before the first run are pre-run.
    let first_run = runs_table::first_started_at_for_incident(org_id, &incident.id).await?;
    let mut completed_at: Vec<i64> = infra::table::incident_events::get(org_id, &incident.id)
        .await?
        .into_iter()
        .filter(|event| {
            matches!(event.event_type, IncidentEventType::AIAnalysisComplete)
                && first_run.is_none_or(|first| event.timestamp < first)
        })
        .map(|event| event.timestamp)
        .collect();
    completed_at.sort_unstable_by(|a, b| b.cmp(a));
    Ok(v1_reports(topology, &completed_at, incident.created_at))
}

/// A pre-run report of the incident as a run, with its report text.
pub async fn v1_run(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
) -> anyhow::Result<Option<RcaRun>> {
    let Some(incident) = infra::table::alert_incidents::get(org_id, incident_id).await? else {
        return Ok(None);
    };
    Ok(v1_reports_of(org_id, &incident)
        .await?
        .into_iter()
        .find(|report| report.run_id == run_id)
        .map(|report| {
            let run = report.run(incident_id);
            RcaRun {
                report: Some(report.report),
                ..run
            }
        }))
}

/// The detail fields of an incident whose latest run is an `rca_runs` row.
async fn stored_detail(
    org_id: &str,
    incident_id: &str,
    latest_run_id: &str,
) -> anyhow::Result<RcaDetailFields> {
    let cfg = get_o2_config();
    // Pruning keeps the newest `limit + 1` runs and the newest completed one.
    let limit = (cfg.incidents.rca_history_limit as u64).saturating_add(2);
    let (runs, _) = runs_table::list_for_incident(org_id, incident_id, limit, None).await?;
    let history: Vec<_> = runs.iter().map(runs_table::to_item).collect();
    let report_run = match history.iter().find(|run| run.state == RunState::Completed) {
        Some(run) => Some(run.clone()),
        None => runs_table::newest_completed_for_incident(org_id, incident_id)
            .await?
            .map(|run| runs_table::to_item(&run)),
    };
    let resume_run_id =
        super::rca_resume::resumable_run_id(org_id, incident_id, latest_run_id, &runs).await;
    let current_run = runs.into_iter().next().map(|run| {
        let mut run = runs_table::to_run(run);
        run.report = None;
        run.result = None;
        run
    });
    Ok(RcaDetailFields {
        current_run,
        report_run,
        history,
        resume_run_id,
    })
}

/// Alert runs have no incident event; core retains redaction and post-commit side effects.
async fn write_run(
    org_id: &str,
    run_id: &str,
    mut patch: RunUpdate,
    incident_id: Option<&str>,
) -> anyhow::Result<bool> {
    // No internal host, path or agent URL reaches a reader.
    if let Some(details) = patch.error.as_mut().and_then(|e| e.details.as_mut()) {
        *details = redact_details(details);
    }
    // A stats-only write never touches the timeline.
    if incident_id.is_none() || patch.final_stats_only {
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
    // A cancel starts no workflow.
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

    patch.now_us = now_micros();

    if !runs_table::update_run(org_id, run_id, patch).await? {
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
) -> RunUpdate {
    let trigger_type = trigger.analysis_trigger_type();
    RunUpdate {
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

/// Redact credentials and internal authorities before truncating details.
fn redact_details(text: &str) -> String {
    redact_rca_details(text, &get_o2_config().ai.agent_url)
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
        alerts::{
            incidents::IncidentEventType,
            rca_runs::{RcaRun, RunStats},
        },
        oncall::{AnalysisStatus, ResponderRole, SubjectType},
        triggers::{Trigger, TriggerModule, TriggerStatus},
    };
    use infra::table::{
        entity::{
            ai_chat_sessions, ai_chat_turns, alert_incident_alerts, incident_events,
            oncall_responses, rca_runs as run_rows,
        },
        rca_runs::RunSummaryPatch,
    };
    use o2_enterprise::enterprise::oncall::escalation::EscalationTriggerData;
    use sea_orm::{
        ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Schema,
        sea_query::Expr,
    };
    use tokio::sync::{Mutex, MutexGuard, OnceCell};

    use super::*;

    /// A report whose completed write the database refuses (see [db]).
    pub(crate) const FAIL_THE_WRITE: &str = "FAIL-THE-COMPLETED-WRITE";

    /// Serialize shared-store tests; refuse non-SQLite stores to protect developer databases.
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
                    schema.create_table_from_entity(infra::table::entity::rca_steering::Entity),
                    schema.create_table_from_entity(oncall_responses::Entity),
                    schema.create_table_from_entity(ai_chat_sessions::Entity),
                    schema.create_table_from_entity(ai_chat_turns::Entity),
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
            oncall_subjects: None,
            context_used: None,
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

    /// An open on-call record of the incident whose ladder waits for this analysis.
    pub(crate) async fn hold_page(org_id: &str, incident_id: &str) -> String {
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
    pub(crate) async fn hold_status(org_id: &str, record_id: &str) -> AnalysisStatus {
        let trigger = infra::scheduler::get(org_id, TriggerModule::OncallEscalation, record_id)
            .await
            .unwrap();
        EscalationTriggerData::read(&trigger.data).analysis.status
    }

    /// Ends the run the way a cancel's write does, without the cancel's own release.
    pub(crate) async fn cancel_write(org_id: &str, run_id: &str) {
        let cancel = RunUpdate {
            state: Some(RunState::Cancelled),
            cancelled_by: Some("a.rao@acme.io".to_string()),
            event: Some(IncidentEvent::ai_analysis_cancelled(Some(
                "a.rao@acme.io".to_string(),
            ))),
            ..Default::default()
        };
        assert!(update_run(org_id, run_id, cancel).await.unwrap());
    }

    /// The final counts of a run, as the finalizer writes them.
    pub(crate) fn counts(steps: u32, tool_calls: u32) -> RunUpdate {
        RunUpdate {
            stats: Some(RunStats {
                steps: Some(steps),
                tool_calls: Some(tool_calls),
                ..Default::default()
            }),
            summary: Some(RunSummaryPatch {
                steps: Some(steps),
                tool_calls: Some(tool_calls),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// A write the run's state no longer allows changes nothing and appends nothing.
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
                ERROR_AGENT_UNAVAILABLE,
                AGENT_UNAVAILABLE_REASON,
                None
            )
            .await
            .unwrap()
        );
        let before = timeline(&org, &inc).await;

        assert!(
            !complete_run(&org, &run_id, "late report", RunUpdate::default())
                .await
                .unwrap()
        );
        let gone = RunUpdate {
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

    /// The failure keeps the event's reason, details and trigger type and adds a code.
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
                ERROR_AGENT_ERROR,
                AGENT_ERROR_REASON,
                Some(details),
            )
            .await
            .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert!(run.ended_at.is_some());
        let error = run.error.expect("a failed run stores its error");
        assert_eq!(error.code, ERROR_AGENT_ERROR);
        assert_eq!(error.reason, AGENT_ERROR_REASON);
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
        assert_eq!(reason, AGENT_ERROR_REASON);
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

    /// Two writers fail the same run; only the first counts.
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
                ERROR_TIMEOUT,
                TIMEOUT_REASON,
                None,
            )
        };
        assert!(fail().await.unwrap());
        assert!(!fail().await.unwrap());
        assert_eq!(failures(&timeline(&org, &inc).await).len(), 1);
    }

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
            complete_run(
                &org,
                &run_id,
                "## Root cause\nThe DB pool ran dry.",
                counts(3, 4)
            )
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
        let stats = run.stats.unwrap();
        assert_eq!((stats.steps, stats.tool_calls), (Some(3), Some(4)));
        assert!(stats.duration_ms.is_some(), "the end writes the duration");
        assert_eq!(run.outcome, None, "RR-16: Phase 2 grades nothing");
        let row = incident_row(&org, &inc).await;
        assert_eq!(row.rca_state.as_deref(), Some("completed"));
        assert_eq!(row.rca_run_id.as_deref(), Some(run_id.as_str()));
        let summary =
            infra::table::rca_runs::decode::<serde_json::Value>(row.rca_summary.as_deref())
                .unwrap();
        assert_eq!(summary["steps"], 3);
        assert_eq!(summary["tool_calls"], 4);
        assert_eq!(completes(&timeline(&org, &inc).await), 1);
        assert_eq!(
            serde_json::to_vec(&row.topology_context).unwrap(),
            serde_json::to_vec(&Some(topology)).unwrap()
        );
    }

    /// A failed later run keeps the earlier completed run as the report run.
    #[tokio::test]
    async fn a_failed_run_keeps_the_earlier_report_run() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let first = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_run(&org, &first, "first report", RunUpdate::default())
                .await
                .unwrap()
        );
        let second = start(&org, &inc, RunTrigger::Reanalyze).await;

        assert!(
            fail_run(
                &org,
                &second,
                RunTrigger::Reanalyze,
                ERROR_INTERRUPTED,
                INTERRUPTED_REASON,
                None,
            )
            .await
            .unwrap()
        );

        let run = stored(&org, &second).await;
        assert_eq!(run.state, RunState::Failed);
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

    /// "Build on previous" reads the newest completed report.
    #[tokio::test]
    async fn build_on_previous_reads_the_newest_completed_report() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        assert_eq!(newest_completed_report(&org, &inc).await.unwrap(), None);
        for report in ["older report", "newer report"] {
            let run_id = start(&org, &inc, RunTrigger::Manual).await;
            assert!(
                complete_run(&org, &run_id, report, RunUpdate::default())
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

    fn pre_run_topology() -> serde_json::Value {
        serde_json::json!({
            "nodes": [],
            "edges": [],
            "related_incident_ids": [],
            "suggested_root_cause": "current report",
            "previous_analyses": [{"content": "older report", "archived_at": 200}],
        })
    }

    async fn completed_at(org_id: &str, incident_id: &str, timestamp: i64) {
        let mut event = IncidentEvent::ai_analysis_complete();
        event.timestamp = timestamp;
        infra::table::incident_events::append(org_id, incident_id, event)
            .await
            .unwrap();
    }

    fn ids(detail: &RcaDetailFields) -> Vec<&str> {
        detail
            .history
            .iter()
            .map(|run| run.run_id.as_str())
            .collect()
    }

    /// Reports from before runs existed show as v1 runs, after every stored run.
    #[tokio::test]
    async fn pre_run_reports_show_as_v1_runs_after_the_stored_runs() {
        let _db = db().await;
        let (org, inc) = new_incident(Some(pre_run_topology())).await;
        completed_at(&org, &inc, 150).await;
        completed_at(&org, &inc, 100).await;

        let summary = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .expect("a v1-only incident still has a detail");
        assert_eq!(
            (
                summary.run_id.as_str(),
                summary.report_format,
                summary.state
            ),
            ("v1-0", ReportFormat::V1, RunState::Completed)
        );
        let detail = summary.detail.unwrap();
        assert_eq!(ids(&detail), ["v1-0", "v1-1"]);
        // The oldest report pairs with the second-newest pre-run `AIAnalysisComplete`.
        let times: Vec<_> = detail.history.iter().map(|run| run.started_at).collect();
        assert_eq!(times, [200, 100]);
        assert_eq!(detail.report_run.unwrap().run_id, "v1-0");
        let current = detail.current_run.unwrap();
        assert_eq!((current.run_id.as_str(), current.report), ("v1-0", None));
        assert_eq!(detail.resume_run_id, None);

        let run = v1_run(&org, &inc, "v1-1").await.unwrap().unwrap();
        assert_eq!(run.report.as_deref(), Some("older report"));
        assert_eq!(run.report_format, ReportFormat::V1);
        assert_eq!(v1_run(&org, &inc, "v1-2").await.unwrap(), None);
        assert_eq!(
            newest_completed_report(&org, &inc)
                .await
                .unwrap()
                .as_deref(),
            Some("current report")
        );

        // A failed run leads; the newest v1 report stays the report run.
        let failed = start(&org, &inc, RunTrigger::Manual).await;
        fail_run(&org, &failed, RunTrigger::Manual, "x", "x", None)
            .await
            .unwrap();
        let detail = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(detail.report_format, ReportFormat::V2);
        let detail = detail.detail.unwrap();
        assert_eq!(ids(&detail), [failed.as_str(), "v1-0", "v1-1"]);
        assert_eq!(detail.report_run.unwrap().run_id, "v1-0");
        assert_eq!(detail.current_run.unwrap().run_id, failed);

        // A completed run takes over as the report run, and its Complete event moves no v1 time.
        let done = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_run(&org, &done, "new report", RunUpdate::default())
                .await
                .unwrap()
        );
        let detail = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .unwrap()
            .detail
            .unwrap();
        assert_eq!(detail.report_run.unwrap().run_id, done);
        let v1_times: Vec<_> = detail
            .history
            .iter()
            .filter(|run| run.report_format == ReportFormat::V1)
            .map(|run| run.started_at)
            .collect();
        assert_eq!(v1_times, [200, 100]);
        assert_eq!(
            newest_completed_report(&org, &inc)
                .await
                .unwrap()
                .as_deref(),
            Some("new report")
        );
    }

    /// Enrichment rewrites the topology without dropping the pre-run reports.
    #[tokio::test]
    async fn a_topology_rewrite_keeps_the_pre_run_reports() {
        let _db = db().await;
        let (org, inc) = new_incident(Some(pre_run_topology())).await;

        infra::table::alert_incidents::update_topology(
            &org,
            &inc,
            &config::meta::alerts::incidents::IncidentTopology {
                related_incident_ids: vec!["inc-2".to_string()],
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let row = incident_row(&org, &inc).await;
        let topology = row.topology_context.as_ref().unwrap();
        assert_eq!(
            topology["related_incident_ids"],
            serde_json::json!(["inc-2"])
        );
        assert_eq!(topology["suggested_root_cause"], "current report");
        let v1: Vec<_> = v1_reports_of(&org, &row)
            .await
            .unwrap()
            .into_iter()
            .map(|report| report.report)
            .collect();
        assert_eq!(v1, ["current report", "older report"]);
    }

    /// The detail names the runs and carries no report text; never analyzed is `None`.
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
            complete_run(
                &org,
                &done,
                "REPORT-TEXT-MUST-NOT-LEAK",
                RunUpdate {
                    result: Some(serde_json::json!({"verdict": {"probable_cause": "PREVIOUS-VERDICT-MUST-NOT-LEAK"}})),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
        );
        let completed_detail = rca_detail(&org, &incident_row(&org, &inc).await)
            .await
            .unwrap()
            .unwrap();
        let serialized = serde_json::to_string(&completed_detail).unwrap();
        assert!(
            !serialized.contains("PREVIOUS-VERDICT-MUST-NOT-LEAK"),
            "{serialized}"
        );
        assert!(
            !serialized.contains("REPORT-TEXT-MUST-NOT-LEAK"),
            "{serialized}"
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

    /// No agent URL or internal host name reaches a reader through the details.
    #[tokio::test]
    async fn an_agent_url_in_the_details_is_stored_redacted() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        fail_run(
            &org,
            &run_id,
            RunTrigger::Manual,
            ERROR_AGENT_UNAVAILABLE,
            AGENT_UNAVAILABLE_REASON,
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

    /// An alert run completes or fails without an incident and without a timeline.
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
            oncall_subjects: None,
            context_used: None,
        };
        let StartOutcome::Started { run_id: done } = start_run(start_alert("al_1")).await.unwrap()
        else {
            panic!("the alert run did not start")
        };
        assert!(
            complete_run(&org, &done, "alert report", RunUpdate::default())
                .await
                .unwrap()
        );
        let run = stored(&org, &done).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.subject_type, RunSubjectType::Alert);
        assert_eq!(run.incident_id, None);
        assert_eq!(run.report.as_deref(), Some("alert report"));
        assert!(
            !complete_run(&org, &done, "again", RunUpdate::default())
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
                NO_REPORT_REASON,
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

    /// Automatic runs wait out the cooldown after a completed run; user runs do not.
    #[tokio::test]
    async fn an_automatic_start_in_the_cooldown_starts_nothing_and_a_user_start_does() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let done = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_run(&org, &done, "report", RunUpdate::default())
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

    /// A live run holds the incident against every new start.
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

    /// A user-started run never consults `rca_off_reason`.
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

    #[tokio::test]
    async fn a_start_that_replaces_a_stale_run_counts_its_end() {
        let _db = db().await;
        let timeout = get_o2_config().incidents.rca_timeout_secs;
        let (org, inc) = new_incident(None).await;
        let stale = start(&org, &inc, RunTrigger::AutoNewIncident).await;
        age(&org, &inc, &stale, timeout as i64 + 121).await;
        let total = |trigger: &str| {
            config::metrics::RCA_RUNS_TOTAL
                .with_label_values(&[
                    org.as_str(),
                    trigger,
                    "failed",
                    runs_table::STALE_ERROR_CODE,
                ])
                .get()
        };
        assert_eq!(total("auto_new_incident"), 0);

        let replacing = start(&org, &inc, RunTrigger::Manual).await;

        assert_ne!(replacing, stale);
        let ended = stored(&org, &stale).await;
        assert_eq!(ended.state, RunState::Failed);
        assert_eq!(ended.error.unwrap().code, runs_table::STALE_ERROR_CODE);
        assert_eq!(total("auto_new_incident"), 1);
        assert_eq!(
            total("manual"),
            0,
            "the replacing run's trigger is not the label"
        );

        // A start that replaces nothing counts nothing.
        cancel_write(&org, &replacing).await;
        start(&org, &inc, RunTrigger::Manual).await;
        assert_eq!(total("auto_new_incident"), 1);
        assert_eq!(total("manual"), 0);
    }

    #[tokio::test]
    async fn a_completed_write_that_errors_writes_nothing() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;

        assert!(
            complete_run(&org, &run_id, FAIL_THE_WRITE, RunUpdate::default())
                .await
                .is_err()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Running);
        assert_eq!(run.report, None);
        assert_eq!(completes(&timeline(&org, &inc).await), 0);
    }

    #[tokio::test]
    async fn a_stats_only_write_on_an_ended_run_changes_only_its_counts() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        cancel_write(&org, &run_id).await;
        let before = stored(&org, &run_id).await;
        let events = timeline(&org, &inc).await.len();

        let stats_only = RunUpdate {
            final_stats_only: true,
            // Ignored by a stats-only write.
            state: Some(RunState::Completed),
            report: Some("never stored".to_string()),
            event: Some(IncidentEvent::ai_analysis_complete()),
            ..counts(2, 7)
        };
        assert!(update_run(&org, &run_id, stats_only).await.unwrap());

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.report, None);
        assert_eq!(run.cancelled_by, before.cancelled_by);
        assert_eq!(run.ended_at, before.ended_at);
        let stats = run.stats.unwrap();
        assert_eq!((stats.steps, stats.tool_calls), (Some(2), Some(7)));
        assert_eq!(
            stats.duration_ms,
            before.stats.unwrap().duration_ms,
            "the cancel's duration stays"
        );
        let row = incident_row(&org, &inc).await;
        assert_eq!(row.rca_state.as_deref(), Some("cancelled"));
        let summary =
            infra::table::rca_runs::decode::<serde_json::Value>(row.rca_summary.as_deref())
                .unwrap();
        assert_eq!(
            (summary["steps"].as_u64(), summary["tool_calls"].as_u64()),
            (Some(2), Some(7))
        );
        assert_eq!(timeline(&org, &inc).await.len(), events);
    }

    /// A failure writes the run's final counts in the same write.
    #[tokio::test]
    async fn a_failure_with_counts_stores_them() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;

        assert!(
            fail_run_with(
                &org,
                &run_id,
                RunTrigger::Manual,
                ERROR_NO_REPORT,
                NO_REPORT_REASON,
                None,
                counts(4, 9),
            )
            .await
            .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_NO_REPORT);
        let stats = run.stats.unwrap();
        assert_eq!((stats.steps, stats.tool_calls), (Some(4), Some(9)));
        assert_eq!(failures(&timeline(&org, &inc).await).len(), 1);
    }

    #[tokio::test]
    async fn a_progress_write_stores_the_new_run_columns() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let fresh = stored(&org, &run_id).await;
        assert_eq!(
            (
                fresh.stage.as_deref(),
                fresh.stage_index,
                fresh.continuations
            ),
            (None, None, 0)
        );
        let context = serde_json::json!({
            "past_causes": [{"id": "past:deploy", "summary": "a bad deploy"}],
            "skills": [],
            "toolsets": ["o2"]
        });

        let progress = RunUpdate {
            session_id: Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".to_string()),
            stage: Some("metrics".to_string()),
            stage_index: Some(6),
            context_used: Some(context.clone()),
            continuations_inc: true,
            ..counts(3, 5)
        };
        assert!(update_run(&org, &run_id, progress).await.unwrap());
        assert!(
            update_run(
                &org,
                &run_id,
                RunUpdate {
                    continuations_inc: true,
                    ..Default::default()
                }
            )
            .await
            .unwrap()
        );

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Running);
        assert_eq!(
            run.session_id.as_deref(),
            Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
        );
        assert_eq!(
            (run.stage.as_deref(), run.stage_index, run.continuations),
            (Some("metrics"), Some(6), 2)
        );
        assert_eq!(run.context_used, Some(context));
        let summary = infra::table::rca_runs::decode::<serde_json::Value>(
            incident_row(&org, &inc).await.rca_summary.as_deref(),
        )
        .unwrap();
        assert_eq!(summary["stage"], "metrics");
        assert_eq!(summary["stage_index"], 6);
        assert_eq!(summary["steps"], 3);
        assert_eq!(summary["tool_calls"], 5);
    }

    /// The sweep reads `running` runs only, least recently written first.
    #[tokio::test]
    async fn list_running_returns_running_runs_oldest_write_first() {
        let _db = db().await;
        let (org, older_inc) = new_incident(None).await;
        let older = start(&org, &older_inc, RunTrigger::Manual).await;
        age(&org, &older_inc, &older, 50_000).await;
        let newer_inc = add_incident(&org, None).await;
        let newer = start(&org, &newer_inc, RunTrigger::Manual).await;
        age(&org, &newer_inc, &newer, 40_000).await;
        let ended_inc = add_incident(&org, None).await;
        let ended = start(&org, &ended_inc, RunTrigger::Manual).await;
        cancel_write(&org, &ended).await;
        age(&org, &ended_inc, &ended, 60_000).await;

        let ids: Vec<String> = runs_table::list_running(10_000)
            .await
            .unwrap()
            .into_iter()
            .filter(|run| run.org_id == org)
            .map(|run| run.run_id)
            .collect();
        assert_eq!(ids, [older, newer]);
    }

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
            ERROR_AGENT_ERROR,
            AGENT_ERROR_REASON,
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

    #[tokio::test]
    async fn completed_runs_with_a_record_list_by_end_time_in_a_half_open_window() {
        let _db = db().await;
        let org = format!("rca_{}", runs_table::new_run_id().to_lowercase());
        let other_org = format!("{org}_other");
        let from = 1_700_000_000_000_000_i64;
        let to = from + 30;
        let row = |org: &str, run_id: &str, state: &str, ended: i64, result: bool| {
            run_rows::ActiveModel::from(run_rows::Model {
                run_id: run_id.to_string(),
                org_id: org.to_string(),
                subject_type: "incident".to_string(),
                subject_id: "inc_1".to_string(),
                incident_id: Some("inc_1".to_string()),
                trigger: "manual".to_string(),
                mode: "fresh".to_string(),
                started_by: "a.rao@acme.io".to_string(),
                guidance: None,
                state: state.to_string(),
                started_at: ended - 10,
                updated_at: ended,
                ended_at: Some(ended),
                cancelled_by: None,
                outcome: None,
                confidence: None,
                report: None,
                result: result.then(|| r#"{"schema_version":1}"#.to_string()),
                error: None,
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
            })
            .reset_all()
        };
        let conn = infra::db::get_orm_client_rw().await;
        for model in [
            row(&org, &format!("{org}_a"), "completed", from + 10, true),
            row(&org, &format!("{org}_h"), "completed", from + 10, true),
            row(&org, &format!("{org}_b"), "completed", from + 20, true),
            row(&org, &format!("{org}_d"), "completed", from, true),
            row(&org, &format!("{org}_to"), "completed", to, true),
            row(&org, &format!("{org}_before"), "completed", from - 1, true),
            row(&org, &format!("{org}_bare"), "completed", from + 15, false),
            row(&org, &format!("{org}_failed"), "failed", from + 12, true),
            row(
                &org,
                &format!("{org}_cancelled"),
                "cancelled",
                from + 13,
                true,
            ),
            row(
                &other_org,
                &format!("{other_org}_x"),
                "completed",
                from + 11,
                true,
            ),
        ] {
            run_rows::Entity::insert(model).exec(conn).await.unwrap();
        }
        let ids = |runs: Vec<run_rows::Model>| -> Vec<String> {
            runs.into_iter()
                .map(|r| r.run_id.trim_start_matches(&format!("{org}_")).to_string())
                .collect()
        };

        let all = runs_table::list_completed_between(&org, from, to, 100)
            .await
            .unwrap();
        assert_eq!(ids(all), ["b", "h", "a", "d"]);
        let two = runs_table::list_completed_between(&org, from, to, 2)
            .await
            .unwrap();
        assert_eq!(ids(two), ["b", "h"]);
        let narrow = runs_table::list_completed_between(&org, from + 11, from + 20, 100)
            .await
            .unwrap();
        assert!(narrow.is_empty(), "the window is half-open at its end");
    }
}

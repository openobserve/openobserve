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

//! The investigation turns of an RCA run (02 TH1–TH28, TH41–TH44).
//!
//! Every run is a persisted chat session that SysRcaAgent owns. [start_rca_turn] admits
//! and spawns a turn, [observer] mirrors its progress onto the run, and the turn's end
//! runs the finalizer, the only writer of `completed` and the only caller of the on-call
//! delivery and no-verdict release for a run that ran a turn. [sweep_rca_runs] finalizes
//! the runs whose node was lost, and [cancel_rca_run] stops a run wherever its turn runs.

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use config::{
    meta::{
        alerts::{
            incidents::IncidentEvent,
            rca_runs::{
                RcaRunItem, RunMode, RunState, RunStats, RunSubjectType, RunTrigger,
                STALE_GRACE_SECS, is_stale, stale_threshold_us,
            },
        },
        oncall::{
            SubjectRef,
            rca_run::{
                EndedBy, RcaRunRecord, RcaSubmit, RunEndInput, RunEndResult, record_run_end,
            },
        },
    },
    metrics::{
        RCA_CONFIDENCE_GRADE_TOTAL, RCA_HYPOTHESIS_LEFT_TESTING_TOTAL,
        RCA_LEDGER_INVALID_CALL_TOTAL, RCA_LEDGER_TRUNCATED_TOTAL, RCA_OUTCOME_CLAIM_TOTAL,
        RCA_OUTCOME_TOTAL, RCA_RUN_CONTINUATIONS_TOTAL, RCA_RUN_DURATION_SECONDS, RCA_RUN_STEPS,
        RCA_RUN_TOOL_CALLS, RCA_RUNS_WITHOUT_REPORT_TOTAL, RCA_TIMELINE_UNVERIFIED_TOTAL,
        RCA_UNVERIFIED_CITATIONS_TOTAL, RCA_VERDICT_REVISED_TOTAL,
    },
    utils::time::now_micros,
};
use infra::table::{
    ai_chat_sessions, ai_chat_turns,
    rca_runs::{self as runs_table, Model as RunRow, RunSummaryPatch},
};
use o2_enterprise::enterprise::{
    ai::{
        chat::{
            CHAT_DELETED, OnCommit, PersistSettings, STREAM_INTERRUPTED, TurnCaps, TurnEnd,
            TurnIdentity, TurnResult, TurnSpec, batcher::DurableEvent, spawn_headless_turn,
        },
        client::{QueryRequest, RCA_AGENT_TYPE, SESSION_ID_HEADER, get_agent_client},
        toolsets::{CliEntry, McpEntry, SkillEntry, push::load_agent_tools},
    },
    alerts::rca_service,
    common::config::get_config as get_o2_config,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::{sync::mpsc, time::Instant};

use super::rca_runs::{
    self, AGENT_ERROR_REASON, ERROR_AGENT_ERROR, ERROR_AGENT_UNAVAILABLE, ERROR_CREDENTIALS,
    ERROR_INTERRUPTED, ERROR_NO_REPORT, ERROR_PERSISTENCE_FAILED, ERROR_SAVE_FAILED, ERROR_TIMEOUT,
    ERROR_TRANSCRIPT_DELETED, INTERRUPTED_REASON, NO_REPORT_REASON, PERSISTENCE_FAILED_REASON,
    RunPatch, RunSubject, SAVE_FAILED_REASON, TIMEOUT_REASON, TRANSCRIPT_DELETED_REASON,
    count_run_end,
};
use crate::ai_chat::{
    StreamChatStore,
    admission::{self, AdmitError, AdmittedTurn},
    cancel::cancel_chat_turn,
    rca_ledger::{RunTranscript, decode_run},
    rca_thread::{
        RCA_STAGES, SUBMIT_REPORT, ThreadPart, ThreadStats, ToolPart, project_rca_thread,
        updated_part,
    },
    read_committed_events,
};

/// TH25: the user text of the one continuation turn.
const CONTINUE_PROMPT: &str = "The previous turn stopped. Continue from the last finished step. \
                               Do not repeat finished steps. Call submit_report when the \
                               investigation is complete.";
/// `error.code` of a run whose session already had a turn running.
const ERROR_BUSY: &str = "busy";
/// The turn record's error code of a turn that reached its deadline (ENT `turn.rs`).
const TURN_TIMEOUT_CODE: &str = "turn_timeout";
/// TH27: progress writes without a stage change are at least this far apart.
const PROGRESS_INTERVAL: Duration = Duration::from_secs(5);
/// TH14: the agent health probe's own deadline; the shared client's read timeout is minutes.
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
/// TH25: waits before each retry of a continuation whose agent is not reachable (a replica
/// restarting), about a minute in all.
const CONTINUATION_RETRY_BACKOFF: [Duration; 4] = [
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(15),
    Duration::from_secs(30),
];
/// Running runs one sweep looks at; the next pass picks up the rest.
const SWEEP_BATCH: u64 = 500;

/// The user text of an RCA turn (TH6).
#[derive(Debug, Clone, PartialEq)]
pub enum RcaPrompt {
    Initial {
        trigger: RunTrigger,
        subject: RcaPromptSubject,
    },
    /// The one continuation after an interrupted turn (TH25).
    Continue,
}

/// What the first turn of a run names.
#[derive(Debug, Clone, PartialEq)]
pub enum RcaPromptSubject {
    Incident {
        id: String,
        title: String,
        alerts: u32,
        severity: String,
    },
    Alert {
        name: String,
        stream: String,
    },
}

impl RcaPrompt {
    /// The turn's user text and the session title; never blank (TH6).
    pub fn render(&self) -> String {
        let (trigger, subject) = match self {
            Self::Continue => return CONTINUE_PROMPT.to_string(),
            Self::Initial { trigger, subject } => (trigger_label(*trigger), subject),
        };
        match subject {
            RcaPromptSubject::Incident {
                id,
                title,
                alerts,
                severity,
            } => {
                let title = match title.trim() {
                    "" => id.as_str(),
                    title => title,
                };
                let noun = if *alerts == 1 { "alert" } else { "alerts" };
                match severity.trim() {
                    "" => format!(
                        "Analyze incident {id} \"{title}\" ({alerts} {noun}). Trigger: {trigger}."
                    ),
                    severity => format!(
                        "Analyze incident {id} \"{title}\" ({alerts} {noun}, {severity}). \
                         Trigger: {trigger}."
                    ),
                }
            }
            RcaPromptSubject::Alert { name, stream } => {
                format!("Analyze alert \"{name}\" on stream \"{stream}\". Trigger: {trigger}.")
            }
        }
    }
}

/// How the prompt names what started the run.
fn trigger_label(trigger: RunTrigger) -> &'static str {
    match trigger {
        RunTrigger::AutoNewIncident => "new incident",
        RunTrigger::AutoNewAlertType => "new alert type",
        RunTrigger::AutoReopen => "reopen",
        RunTrigger::Manual | RunTrigger::Legacy => "manual",
        RunTrigger::Reanalyze => "re-analyze",
        RunTrigger::OncallPage => "on-call page",
        RunTrigger::Resume => "resume",
    }
}

/// The run a turn belongs to.
#[derive(Debug, Clone)]
pub struct RcaTurnRun {
    pub org_id: String,
    pub run_id: String,
    pub subject: RunSubject,
    pub trigger: RunTrigger,
    pub mode: RunMode,
    /// The `RcaContext` JSON the agent receives in `QueryRequest.context`.
    pub context: Value,
    /// `None` for a run's first turn: [start_rca_turn] creates the session.
    pub session_id: Option<String>,
}

/// A spawned turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStarted {
    pub session_id: String,
    pub turn_id: String,
}

/// Why a turn did not start; the caller fails the run with [RcaTurnError::error_code] (TH24).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RcaTurnError {
    /// The RCA active-turn cap is reached (TH10).
    TurnLimit,
    Credentials(String),
    AgentUnavailable(String),
    /// Another turn of the run's session is running.
    Busy,
    Other(String),
}

impl RcaTurnError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::TurnLimit => admission::TURN_LIMIT,
            Self::Credentials(_) => ERROR_CREDENTIALS,
            Self::AgentUnavailable(_) => ERROR_AGENT_UNAVAILABLE,
            Self::Busy => ERROR_BUSY,
            Self::Other(_) => ERROR_AGENT_ERROR,
        }
    }

    /// Whether a run's `error.code` says its turn never started, so its session may have
    /// no row: the thread has no transcript rather than an expired one (TH30).
    pub fn is_start_code(code: &str) -> bool {
        [
            admission::TURN_LIMIT,
            ERROR_CREDENTIALS,
            ERROR_AGENT_UNAVAILABLE,
            ERROR_BUSY,
        ]
        .contains(&code)
    }
}

impl From<AdmitError> for RcaTurnError {
    fn from(e: AdmitError) -> Self {
        match e {
            AdmitError::TurnLimit(_) => Self::TurnLimit,
            AdmitError::Busy => Self::Busy,
            AdmitError::NotRegistered => {
                Self::Credentials("SysRcaAgent has no user record".to_string())
            }
            other => Self::Other(format!("turn admission failed: {other:?}")),
        }
    }
}

/// Start one turn of a run as SysRcaAgent (TH1, TH2, TH5–TH8, TH10, TH11).
///
/// A first turn gets a new session id and the run's `context_used`, written before
/// admission creates the session. The turn runs without a reader; its end runs the
/// finalizer. Never reads the chat persistence flag (TH43).
pub async fn start_rca_turn(
    run: RcaTurnRun,
    prompt: RcaPrompt,
) -> Result<TurnStarted, RcaTurnError> {
    let prompt = prompt.render();
    let (mcps, clis, skills) = load_agent_tools(&run.org_id).await;

    let session_id = match run.session_id.clone() {
        Some(session_id) => session_id,
        None => {
            let session_id = sea_orm::prelude::Uuid::new_v4().to_string();
            let patch = RunPatch {
                session_id: Some(session_id.clone()),
                context_used: Some(context_used(&run.context, &mcps, &clis, &skills)),
                ..Default::default()
            };
            match rca_runs::update_run(&run.org_id, &run.run_id, patch).await {
                Ok(true) => session_id,
                Ok(false) => {
                    return Err(RcaTurnError::Other(format!(
                        "run {} is no longer running",
                        run.run_id
                    )));
                }
                Err(e) => return Err(RcaTurnError::Other(format!("{e:#}"))),
            }
        }
    };

    // TH7: the run reads as SysRcaAgent; this is `sre_agent_email(org)` and its token.
    let (email, token) = crate::organization::get_sre_agent_credentials(&run.org_id)
        .await
        .map_err(|e| RcaTurnError::Credentials(format!("{e:#}")))?;
    let auth_header = crate::auth::build_basic_auth_header(&email, &token);
    let client = get_agent_client().ok_or_else(|| {
        RcaTurnError::AgentUnavailable("the agent client is not initialized".to_string())
    })?;
    // TH14: a refused or slow health check fails the run `agent_unavailable` before admission.
    probe_health(client.health(&auth_header)).await?;

    // TH10: all RCA turns of an org are SysRcaAgent's, so `per_user` caps the org's runs.
    let caps = TurnCaps {
        per_user: get_o2_config().incidents.rca_max_active_runs,
        ..TurnCaps::from_config()
    };
    let trace_id = config::ider::generate_trace_id();
    let admitted = admission::admit_turn(
        &run.org_id,
        Some(&session_id),
        None,
        &email,
        RCA_AGENT_TYPE,
        &prompt,
        &trace_id,
        caps,
    )
    .await?;

    let mut request = QueryRequest::new(prompt, run.context.clone());
    request.mcps = (!mcps.is_empty()).then_some(mcps);
    request.clis = (!clis.is_empty()).then_some(clis);
    request.skills = (!skills.is_empty()).then_some(skills);
    admission::apply_admission(&mut request, &admitted);
    let AdmittedTurn {
        row,
        owner,
        turn_id,
        lease,
        registration,
    } = admitted;

    let started = TurnStarted {
        session_id: row.session_id.clone(),
        turn_id: turn_id.clone(),
    };
    let settings = PersistSettings::for_rca();
    let store = Arc::new(StreamChatStore::new(settings.retention_days));
    // TH7: o2-ai binds one opencode session to the run and HA routes to its replica.
    let forward_headers = HashMap::from([(SESSION_ID_HEADER.to_string(), row.session_id.clone())]);
    let on_commit = observer(
        run.org_id.clone(),
        run.run_id.clone(),
        row.session_id.clone(),
    );
    let identity = TurnIdentity {
        org_id: run.org_id.clone(),
        session_id: row.session_id.clone(),
        user_id: owner,
        agent_type: RCA_AGENT_TYPE,
        turn_id: turn_id.clone(),
        trace_id,
        epoch: row.session_epoch,
        last_committed_seq: row.last_committed_seq,
        opencode_session_id: row.opencode_session_id,
    };
    // The finalizer's continuation (TH25) reuses the run and its session.
    let resume = RcaTurnRun {
        session_id: Some(row.session_id),
        ..run
    };
    let spec = TurnSpec {
        identity,
        request,
        auth_header,
        forward_headers: Some(forward_headers),
        client,
        store,
        lease,
        registration,
        on_end: Some(Box::new(move |end: TurnEnd| {
            spawn_finalize(resume, turn_id, end)
        })),
        on_commit: Some(on_commit),
    };
    // TH8: no reader; the turn forwards no frames and goes on to its end.
    spawn_headless_turn(spec, settings);
    Ok(started)
}

/// TH14: the agent's health probe under its own [HEALTH_CHECK_TIMEOUT]; a refusal or no
/// answer in time is `AgentUnavailable`.
async fn probe_health<T, E: std::fmt::Display>(
    probe: impl Future<Output = Result<T, E>>,
) -> Result<(), RcaTurnError> {
    match tokio::time::timeout(HEALTH_CHECK_TIMEOUT, probe).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(RcaTurnError::AgentUnavailable(format!("{e:#}"))),
        Err(_) => Err(RcaTurnError::AgentUnavailable(
            "health check timed out".to_string(),
        )),
    }
}

/// TH7.1: what the run was given, `{past_causes: [{id, summary}], skills, toolsets}`.
fn context_used(
    context: &Value,
    mcps: &[McpEntry],
    clis: &[CliEntry],
    skills: &[SkillEntry],
) -> Value {
    let past_causes: Vec<Value> = context
        .get("past_causes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(past_cause)
        .collect();
    let skills: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
    let toolsets: Vec<&str> = mcps
        .iter()
        .map(|m| m.name.as_str())
        .chain(clis.iter().map(|c| c.name.as_str()))
        .collect();
    json!({ "past_causes": past_causes, "skills": skills, "toolsets": toolsets })
}

/// One `[past:<cause>] <summary>` context line (TH46) as `{id: "past:<cause>", summary}`.
fn past_cause(line: &str) -> Option<Value> {
    let (cause, summary) = line.trim_start().strip_prefix("[past:")?.split_once(']')?;
    Some(json!({ "id": format!("past:{cause}"), "summary": summary.trim() }))
}

/// Runs the finalizer of a turn that ended on this node, with the run to continue (TH9).
fn spawn_finalize(run: RcaTurnRun, turn_id: String, end: TurnEnd) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        log::error!(
            "[RCA_TURN] no runtime to finalize run {} on; the sweeper ends it",
            run.run_id
        );
        return;
    };
    let (org_id, run_id) = (run.org_id.clone(), run.run_id.clone());
    // Boxed: the finalizer may start a turn whose end spawns the finalizer again.
    let task: Pin<Box<dyn Future<Output = bool> + Send>> =
        Box::pin(finalize(org_id, run_id, turn_id, end, Some(run)));
    runtime.spawn(task);
}

/// End a run from the stored transcript of its session (TH22–TH25, TH42).
///
/// The last committed `submit_report` completes the run and delivers its result; no
/// report fails it, after one continuation of an interrupted turn. A run already ended
/// only gets its final stats, so a second call for the same turn changes nothing else.
/// Without a turn to continue (the sweeper's call) an interrupted turn fails the run.
pub async fn finalize_rca_run(org_id: String, run_id: String, turn_id: String, end: TurnEnd) {
    finalize(org_id, run_id, turn_id, end, None).await;
}

/// [finalize_rca_run]; `true` when this call ended the run.
async fn finalize(
    org_id: String,
    run_id: String,
    turn_id: String,
    end: TurnEnd,
    resume: Option<RcaTurnRun>,
) -> bool {
    let run = match runs_table::get_rw(&org_id, &run_id).await {
        Ok(Some(run)) => run,
        Ok(None) => {
            log::info!("[RCA_TURN] run {run_id} is gone; nothing to finalize");
            return false;
        }
        Err(e) => {
            log::error!("[RCA_TURN] cannot read run {run_id}: {e}; the sweeper retries");
            return false;
        }
    };
    let item = runs_table::to_item(&run);

    let (events, turns) = match read_session(&org_id, run.session_id.as_deref()).await {
        Ok((events, turns)) => (Some(events), turns),
        Err(e) => {
            let timeout = get_o2_config().incidents.rca_timeout_secs;
            if item.state.is_terminal()
                || !is_stale(item.state, run.updated_at, now_micros(), timeout)
            {
                log::warn!(
                    "[RCA_TURN] cannot read the transcript of run {run_id}: {e:#}; the sweeper retries"
                );
                return false;
            }
            log::warn!("[RCA_TURN] ending stale run {run_id} without its transcript: {e:#}");
            (None, Vec::new())
        }
    };
    // A later turn of the session (a continuation) owns the run now.
    if turns.last().is_some_and(|turn| turn.turn_id != turn_id) {
        log::info!("[RCA_TURN] turn {turn_id} of run {run_id} was followed by another one");
        return false;
    }

    let ending = RunEnd {
        thread: events
            .as_deref()
            .map(|events| project_rca_thread(events, &turns, false, false).stats),
        transcript: events.as_deref().map(decode_run),
        turn_error: turns
            .iter()
            .rev()
            .find(|turn| turn.turn_id == turn_id)
            .and_then(|turn| turn.error_code.clone()),
        org_id,
        run,
        item,
    };
    ending.end(end.result, &turn_id, resume).await
}

/// The events and turn records of a run's session, read on the primary so the last
/// commit of the turn that just ended is seen; none for a run without a session or
/// whose session is gone.
async fn read_session(
    org_id: &str,
    session_id: Option<&str>,
) -> anyhow::Result<(Vec<DurableEvent>, Vec<ai_chat_turns::Model>)> {
    let Some(session_id) = session_id else {
        return Ok((Vec::new(), Vec::new()));
    };
    let primary = infra::db::get_orm_client_rw().await;
    let turns = ai_chat_turns::list_for_session_with(primary, org_id, session_id).await?;
    let events = match ai_chat_sessions::get_with(primary, org_id, session_id).await? {
        Some(row) => read_committed_events(&row, -1).await?,
        None => Vec::new(),
    };
    Ok((events, turns))
}

/// TH24: the `error.code` of a run whose turns ended without a report.
fn no_report_error(result: TurnResult) -> (&'static str, &'static str) {
    match result {
        TurnResult::Persisted => (ERROR_NO_REPORT, NO_REPORT_REASON),
        TurnResult::Timeout => (ERROR_TIMEOUT, TIMEOUT_REASON),
        TurnResult::Error => (ERROR_AGENT_ERROR, AGENT_ERROR_REASON),
        // A turn stopped on its node while the run was not cancelled ended early too.
        TurnResult::Interrupted | TurnResult::Cancelled => (ERROR_INTERRUPTED, INTERRUPTED_REASON),
        TurnResult::PersistenceFailed => (ERROR_PERSISTENCE_FAILED, PERSISTENCE_FAILED_REASON),
        TurnResult::Deleted => (ERROR_TRANSCRIPT_DELETED, TRANSCRIPT_DELETED_REASON),
    }
}

/// A run being ended, with its counts and its decoded transcript (both `None`: it could
/// not be read) and the error code its ended turn's record holds.
struct RunEnd {
    org_id: String,
    run: RunRow,
    item: RcaRunItem,
    thread: Option<ThreadStats>,
    transcript: Option<RunTranscript>,
    turn_error: Option<String>,
}

impl RunEnd {
    /// How the transcript ends the run: an ended run (a cancel) keeps its state and gets
    /// its counts (TH22, TH42); a committed report completes it whatever ended the turn
    /// (TH23); an interrupted turn continues once (TH25); else it fails (TH24).
    async fn end(&self, result: TurnResult, turn_id: &str, resume: Option<RcaTurnRun>) -> bool {
        if self.item.state.is_terminal() {
            // TH22, TH42: counts only. The run's end was counted and observed by the write
            // that ended it (a cancel observes its last progress counts), so a repeat
            // finalize observes nothing more (TH44).
            self.write_final_stats().await;
            return false;
        }
        if let Some(transcript) = self.transcript.as_ref()
            && let Some(submit) = transcript.submit.as_ref()
        {
            return self.complete(transcript, submit).await;
        }
        if result == TurnResult::Interrupted
            && self.run.continuations == 0
            && self.thread.is_some()
            && let Some(resume) = resume
            && let Some(ended) = self.resume(resume, turn_id).await
        {
            return ended;
        }
        let (code, reason) = no_report_error(result);
        self.fail_without_report(code, reason, self.turn_details(result))
            .await
    }

    /// The ended turn's own error code (`restore_failed`, …) as the run error's details,
    /// for the results whose code says only that the turn broke. `write_run` redacts it
    /// with every other detail (RR-47).
    fn turn_details(&self, result: TurnResult) -> Option<String> {
        let broke = matches!(
            result,
            TurnResult::Error
                | TurnResult::Timeout
                | TurnResult::Interrupted
                | TurnResult::PersistenceFailed
        );
        broke
            .then_some(self.turn_error.as_deref())
            .flatten()
            .map(|code| format!("turn: {code}"))
    }

    /// The final stats and summary counts, written with the run's end (TH27).
    fn counts(&self) -> RunPatch {
        let Some(thread) = self.thread.as_ref() else {
            return RunPatch::default();
        };
        RunPatch {
            stats: Some(RunStats {
                steps: Some(thread.steps),
                tool_calls: Some(thread.tool_calls),
                tokens: serde_json::to_value(&thread.tokens).ok(),
                ..Default::default()
            }),
            summary: Some(RunSummaryPatch {
                steps: Some(thread.steps),
                tool_calls: Some(thread.tool_calls),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// The counts of a run that has already ended (TH22, TH42), and the partial record of
    /// a run another write ended (a cancel) once, while the run has none (VE34).
    async fn write_final_stats(&self) {
        let Some(transcript) = self.transcript.as_ref() else {
            return;
        };
        let result = if self.run.result.is_none() {
            record_json(&self.run.run_id, &partial_end(transcript).record)
        } else {
            None
        };
        let patch = RunPatch {
            final_stats_only: true,
            result,
            ..self.counts()
        };
        if let Err(e) = rca_runs::update_run(&self.org_id, &self.run.run_id, patch).await {
            log::warn!(
                "[RCA_TURN] could not write the final stats of run {}: {e}",
                self.run.run_id
            );
        }
    }

    /// TH23: grade the submitted verdict, derive the outcome and complete the run with its
    /// report and record (VE14–VE16, VE34, VE44, F6), then deliver the graded verdict
    /// and its grade (VE38, F3).
    async fn complete(&self, transcript: &RunTranscript, submit: &RcaSubmit) -> bool {
        let submit = &self.with_report_ref(submit);
        let end = record_run_end(&RunEndInput {
            submit: Some(submit),
            calls: &transcript.calls,
            tool_log: &transcript.tool_log,
            stages_run: &transcript.stages_run,
            ended_by: EndedBy::Agent,
            completed: true,
        });
        let record = &end.record;
        let mut patch = RunPatch {
            outcome: record.outcome.as_ref().map(|o| o.as_str().to_string()),
            confidence: record.grade.as_ref().map(|g| g.band.as_str().to_string()),
            result: record_json(&self.run.run_id, record),
            ..self.counts()
        };
        // VE44: a blocked run's list cell names what it needs.
        if let Some(detail) = end.summary_detail.clone() {
            let summary = patch.summary.get_or_insert_with(RunSummaryPatch::default);
            summary.detail = Some(Some(detail));
        }
        match rca_runs::complete_run(&self.org_id, &self.run.run_id, &submit.markdown, patch).await
        {
            Ok(true) => {
                count_run_end(&self.org_id, self.item.trigger, RunState::Completed, "");
                count_record(&self.org_id, self.item.trigger, &end);
                self.report_defects(submit);
                self.observe(RunState::Completed);
                let verdict = end.verdict.as_ref();
                let grade = record.grade.as_ref();
                match self.item.subject_type {
                    RunSubjectType::Incident => {
                        rca_service::deliver_incident_result(
                            &self.org_id,
                            &self.run.subject_id,
                            &submit.markdown,
                            verdict,
                            grade,
                        )
                        .await;
                    }
                    RunSubjectType::Alert => {
                        rca_service::deliver_alert_result(
                            &self.org_id,
                            &self.subjects(),
                            &submit.markdown,
                            verdict,
                            grade,
                            None,
                        )
                        .await;
                    }
                }
                true
            }
            // Ended meanwhile (a cancel wins over a report): it keeps its counts.
            Ok(false) => {
                self.write_final_stats().await;
                false
            }
            Err(e) => {
                log::error!(
                    "[RCA_TURN] could not save the report of run {}: {e:#}",
                    self.run.run_id
                );
                self.fail(
                    ERROR_SAVE_FAILED,
                    SAVE_FAILED_REASON,
                    Some(format!("{e:#}")),
                )
                .await
            }
        }
    }

    /// The submit with an empty verdict `report_ref` filled with the run's own reference,
    /// which the on-call statement names.
    fn with_report_ref(&self, submit: &RcaSubmit) -> RcaSubmit {
        let mut submit = submit.clone();
        if let Some(verdict) = submit.verdict.as_mut()
            && verdict.report_ref.trim().is_empty()
        {
            verdict.report_ref = format!("{}/rca/{}", self.run.subject_id, self.run.run_id);
        }
        submit
    }

    /// What `parse_submit` defaulted, hoisted or dropped in the completed run's submit:
    /// logged once and counted as invalid `submit_report` input.
    fn report_defects(&self, submit: &RcaSubmit) {
        if submit.defects.is_empty() {
            return;
        }
        log::warn!(
            "[RCA_TURN] org {} run {}: the submitted report needed repair: {}",
            self.org_id,
            self.run.run_id,
            submit.defects.join("; ")
        );
        RCA_LEDGER_INVALID_CALL_TOTAL
            .with_label_values(&[self.org_id.as_str(), SUBMIT_REPORT])
            .inc_by(submit.defects.len() as u64);
    }

    /// TH25: count the continuation, then start it; `None` when it could not be recorded,
    /// so the run fails as interrupted. Runs in the spawned finalize task, never on the
    /// ended turn's `on_end`.
    async fn resume(&self, run: RcaTurnRun, turn_id: &str) -> Option<bool> {
        self.resume_with(
            run,
            turn_id,
            |run| start_rca_turn(run, RcaPrompt::Continue),
            || get_agent_client().is_some(),
        )
        .await
    }

    /// [Self::resume] with the turn start and the "an agent client exists" check given.
    async fn resume_with<S, F>(
        &self,
        run: RcaTurnRun,
        turn_id: &str,
        start: S,
        can_retry: impl Fn() -> bool,
    ) -> Option<bool>
    where
        S: FnMut(RcaTurnRun) -> F,
        F: Future<Output = Result<TurnStarted, RcaTurnError>>,
    {
        let patch = RunPatch {
            continuations_inc: true,
            ..self.counts()
        };
        match rca_runs::update_run(&self.org_id, &self.run.run_id, patch).await {
            Ok(true) => {}
            Ok(false) => {
                self.write_final_stats().await;
                return Some(false);
            }
            Err(e) => {
                log::warn!(
                    "[RCA_TURN] could not record the continuation of run {}: {e}",
                    self.run.run_id
                );
                return None;
            }
        }
        RCA_RUN_CONTINUATIONS_TOTAL
            .with_label_values(&[self.org_id.as_str()])
            .inc();
        match self.start_continuation(run, start, can_retry).await {
            Ok(Some(started)) => {
                log::info!(
                    "[RCA_TURN] run {} continues turn {turn_id} with turn {}",
                    self.run.run_id,
                    started.turn_id
                );
                Some(false)
            }
            // Ended meanwhile (a cancel): it keeps its state and counts.
            Ok(None) => {
                self.write_final_stats().await;
                Some(false)
            }
            Err(e) => {
                log::error!(
                    "[RCA_TURN] run {} could not start its continuation of turn {turn_id} \
                     ({}): {e:?}",
                    self.run.run_id,
                    e.error_code()
                );
                // TH24: a start error keeps its start code.
                let (reason, details) = super::incidents::rca_turn_failure(&e);
                Some(
                    self.fail_without_report(e.error_code(), reason, details)
                        .await,
                )
            }
        }
    }

    /// Start the continuation turn. An unreachable agent (a replica restarting, §11) is
    /// retried after each [CONTINUATION_RETRY_BACKOFF] wait while the run is still
    /// `running`; any other start error, or a node without an agent client (`can_retry`
    /// false), ends at once. `Ok(None)`: the run ended meanwhile.
    async fn start_continuation<S, F>(
        &self,
        run: RcaTurnRun,
        mut start: S,
        can_retry: impl Fn() -> bool,
    ) -> Result<Option<TurnStarted>, RcaTurnError>
    where
        S: FnMut(RcaTurnRun) -> F,
        F: Future<Output = Result<TurnStarted, RcaTurnError>>,
    {
        let run_id = self.run.run_id.as_str();
        let mut waits = CONTINUATION_RETRY_BACKOFF.iter();
        loop {
            let error = match start(run.clone()).await {
                Ok(started) => return Ok(Some(started)),
                // A node without an agent client never gets one; nothing to wait for.
                Err(e @ RcaTurnError::AgentUnavailable(_)) if can_retry() => e,
                Err(e) => return Err(e),
            };
            let Some(wait) = waits.next() else {
                return Err(error);
            };
            log::warn!(
                "[RCA_TURN] run {run_id}: the agent refused its continuation ({error:?}); \
                 retrying in {}s",
                wait.as_secs()
            );
            tokio::time::sleep(*wait).await;
            match runs_table::get_rw(&self.org_id, run_id).await {
                Ok(Some(row)) if runs_table::to_item(&row).state == RunState::Running => {}
                Ok(_) => {
                    log::info!("[RCA_TURN] run {run_id} ended while its continuation waited");
                    return Ok(None);
                }
                // The next start still checks the run; a cancel stops that turn (TH41).
                Err(e) => log::warn!(
                    "[RCA_TURN] cannot re-read run {run_id} before its continuation: {e}"
                ),
            }
        }
    }

    /// A run that ends with no submitted report (TH24, TH44).
    async fn fail_without_report(&self, code: &str, reason: &str, details: Option<String>) -> bool {
        let ended = self.fail(code, reason, details).await;
        if ended {
            RCA_RUNS_WITHOUT_REPORT_TOTAL
                .with_label_values(&[self.org_id.as_str()])
                .inc();
        }
        ended
    }

    /// Fail the run with its counts and, when the transcript was read, its partial record
    /// (VE16, VE34); only the write that won releases the on-call holds.
    async fn fail(&self, code: &str, reason: &str, details: Option<String>) -> bool {
        let end = self.transcript.as_ref().map(partial_end);
        let extra = RunPatch {
            result: end
                .as_ref()
                .and_then(|end| record_json(&self.run.run_id, &end.record)),
            ..self.counts()
        };
        match rca_runs::fail_run_with(
            &self.org_id,
            &self.run.run_id,
            self.item.trigger,
            code,
            reason,
            details,
            extra,
        )
        .await
        {
            Ok(true) => {
                if let Some(end) = end.as_ref() {
                    count_record(&self.org_id, self.item.trigger, end);
                }
                self.observe(RunState::Failed);
                self.release_without_verdict().await;
                true
            }
            Ok(false) => {
                self.write_final_stats().await;
                false
            }
            Err(e) => {
                log::error!(
                    "[RCA_TURN] could not end run {} as failed: {e}",
                    self.run.run_id
                );
                false
            }
        }
    }

    /// TH15, TH24: no verdict is coming, so no triage hold waits out its budget for one.
    async fn release_without_verdict(&self) {
        match self.item.subject_type {
            RunSubjectType::Incident => {
                rca_service::no_verdict_for_incident(&self.org_id, &self.run.subject_id).await
            }
            RunSubjectType::Alert => {
                rca_service::no_verdict_for_subjects(&self.org_id, &self.subjects()).await
            }
        }
    }

    /// The pending on-call records an alert run was started for.
    fn subjects(&self) -> Vec<SubjectRef> {
        let Some(raw) = self.run.oncall_subjects.as_ref() else {
            return Vec::new();
        };
        Vec::<SubjectRef>::deserialize(raw).unwrap_or_else(|e| {
            log::warn!(
                "[RCA_TURN] run {} has unreadable on-call subjects: {e}",
                self.run.run_id
            );
            Vec::new()
        })
    }

    /// TH44: the end histograms of a run this call ended.
    fn observe(&self, state: RunState) {
        observe_end(
            &self.org_id,
            state,
            self.run.started_at,
            self.thread.as_ref(),
        );
    }
}

fn observe_end(org_id: &str, state: RunState, started_at_us: i64, thread: Option<&ThreadStats>) {
    let seconds = now_micros().saturating_sub(started_at_us).max(0) as f64 / 1_000_000.0;
    RCA_RUN_DURATION_SECONDS
        .with_label_values(&[org_id, state.as_str()])
        .observe(seconds);
    if let Some(thread) = thread {
        observe_counts(org_id, thread);
    }
}

fn observe_counts(org_id: &str, thread: &ThreadStats) {
    RCA_RUN_STEPS
        .with_label_values(&[org_id])
        .observe(f64::from(thread.steps));
    RCA_RUN_TOOL_CALLS
        .with_label_values(&[org_id])
        .observe(f64::from(thread.tool_calls));
}

/// The partial record of a run that ended without completing: no verdict, grade or
/// outcome, the ledger with `testing` left as `untested`, and the stages that did not run
/// as a blind spot (VE7, VE16, VE34).
fn partial_end(transcript: &RunTranscript) -> RunEndResult {
    record_run_end(&RunEndInput {
        submit: None,
        calls: &transcript.calls,
        tool_log: &transcript.tool_log,
        stages_run: &transcript.stages_run,
        ended_by: EndedBy::Agent,
        completed: false,
    })
}

/// `rca_runs.result`; `None` (logged) when the record does not serialize.
fn record_json(run_id: &str, record: &RcaRunRecord) -> Option<Value> {
    match serde_json::to_value(record) {
        Ok(value) => Some(value),
        Err(e) => {
            log::error!("[RCA_TURN] cannot serialize the record of run {run_id}: {e}");
            None
        }
    }
}

/// F11: the verdict and ledger counts of a run whose end this finalizer wrote, once per
/// run. A failed run's record has no outcome, grade or timeline, so it counts only its
/// ledger and citations.
fn count_record(org_id: &str, trigger: RunTrigger, end: &RunEndResult) {
    let record = &end.record;
    if let Some(outcome) = record.outcome.as_ref() {
        RCA_OUTCOME_TOTAL
            .with_label_values(&[org_id, outcome.as_str(), trigger.as_str()])
            .inc();
        if let Some(claimed) = record.claimed_outcome.as_ref() {
            RCA_OUTCOME_CLAIM_TOTAL
                .with_label_values(&[org_id, claimed.as_str(), outcome.as_str()])
                .inc();
        }
    }
    if let Some(grade) = record.grade.as_ref() {
        RCA_CONFIDENCE_GRADE_TOTAL
            .with_label_values(&[org_id, grade.claimed.as_str(), grade.graded.as_str()])
            .inc();
    }
    if end.counts.left_testing > 0 {
        RCA_HYPOTHESIS_LEFT_TESTING_TOTAL
            .with_label_values(&[org_id])
            .inc_by(u64::from(end.counts.left_testing));
    }
    for &(field, count) in &end.counts.truncated {
        RCA_LEDGER_TRUNCATED_TOTAL
            .with_label_values(&[org_id, field])
            .inc_by(u64::from(count));
    }
    for (tool, count) in &end.counts.invalid_calls {
        RCA_LEDGER_INVALID_CALL_TOTAL
            .with_label_values(&[org_id, tool.as_str()])
            .inc_by(u64::from(*count));
    }
    if end.timeline_unverified > 0 {
        RCA_TIMELINE_UNVERIFIED_TOTAL
            .with_label_values(&[org_id])
            .inc_by(u64::from(end.timeline_unverified));
    }
    if record.leading_history.len() > 1 {
        RCA_VERDICT_REVISED_TOTAL.with_label_values(&[org_id]).inc();
    }
    for citation in &record.unverified {
        RCA_UNVERIFIED_CITATIONS_TOTAL
            .with_label_values(&[org_id, citation.reason.as_str()])
            .inc();
    }
}

fn stage_index(stage: &str) -> Option<i16> {
    RCA_STAGES
        .iter()
        .position(|s| *s == stage)
        .and_then(|i| i16::try_from(i + 1).ok())
}

/// Token counts of `step-finish` parts, as `stats.tokens` stores them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
struct Tokens {
    input: u64,
    output: u64,
    reasoning: u64,
    cache_read: u64,
}

impl Tokens {
    fn of(part: &Map<String, Value>) -> Option<Self> {
        let tokens = part.get("tokens")?;
        let count = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
        Some(Self {
            input: count(tokens.get("input")),
            output: count(tokens.get("output")),
            reasoning: count(tokens.get("reasoning")),
            cache_read: count(tokens.get("cache").and_then(|c| c.get("read"))),
        })
    }

    fn plus(self, other: Self) -> Self {
        Self {
            input: self.input + other.input,
            output: self.output + other.output,
            reasoning: self.reasoning + other.reasoning,
            cache_read: self.cache_read + other.cache_read,
        }
    }
}

/// What one committed batch adds, keyed by part id: parts are updated many times. Tool
/// parts keep their commit order, which decides the implicit step (TH29).
#[derive(Default)]
struct Progress {
    parts: Vec<(String, ThreadPart)>,
    tokens: Vec<(String, Tokens)>,
}

impl Progress {
    fn of(events: &[DurableEvent]) -> Self {
        let mut progress = Self::default();
        for part in events.iter().filter_map(updated_part) {
            let Some(id) = part.get("id").and_then(Value::as_str) else {
                continue;
            };
            if part.get("type").and_then(Value::as_str) == Some("step-finish") {
                if let Some(tokens) = Tokens::of(part) {
                    progress.tokens.push((id.to_string(), tokens));
                }
                continue;
            }
            if let Some(call) = ToolPart::of(part) {
                let kind = call.kind();
                if kind != ThreadPart::Hidden {
                    progress.parts.push((id.to_string(), kind));
                }
            }
        }
        progress
    }

    fn is_empty(&self) -> bool {
        self.parts.is_empty() && self.tokens.is_empty()
    }
}

/// The run's counts as its committed events show them, on top of what earlier turns stored.
#[derive(Default)]
struct Tally {
    base_steps: u32,
    base_tool_calls: u32,
    base_tokens: Tokens,
    steps: HashSet<String>,
    latest_step: Option<String>,
    /// Rows came before any step: the implicit "Investigation" step (TH29).
    implicit_step: bool,
    tool_calls: HashSet<String>,
    tokens: HashMap<String, Tokens>,
    stage: Option<&'static str>,
}

impl Tally {
    /// A continuation counts on from the stats the run already has.
    fn resumed(run: &RunRow) -> Self {
        let stats: RunStats = run
            .stats
            .as_ref()
            .and_then(|v| RunStats::deserialize(v).ok())
            .unwrap_or_default();
        Self {
            base_steps: stats.steps.unwrap_or(0),
            base_tool_calls: stats.tool_calls.unwrap_or(0),
            base_tokens: stats
                .tokens
                .as_ref()
                .and_then(|v| Tokens::deserialize(v).ok())
                .unwrap_or_default(),
            stage: run
                .stage
                .as_deref()
                .and_then(|stage| RCA_STAGES.iter().copied().find(|s| *s == stage)),
            ..Default::default()
        }
    }

    fn step_count(&self) -> usize {
        self.base_steps as usize + self.steps.len() + usize::from(self.implicit_step)
    }

    /// Adds a batch; returns whether any count changed and whether the stage changed.
    /// Steps are counted by the projection's rule ([ThreadPart]), so the live count is the
    /// one the run ends with.
    fn apply(&mut self, progress: Progress) -> (bool, bool) {
        let (mut changed, mut stage_changed) = (false, false);
        for (id, kind) in progress.parts {
            match kind {
                ThreadPart::Step(stage) => {
                    let latest = if self.steps.insert(id.clone()) {
                        self.latest_step = Some(id);
                        changed = true;
                        true
                    } else {
                        self.latest_step.as_ref() == Some(&id)
                    };
                    // The stage is the one of the last `record_step`.
                    if latest
                        && let Some(stage) = stage
                        && self.stage != Some(stage)
                    {
                        self.stage = Some(stage);
                        stage_changed = true;
                    }
                }
                // A rejected `record_step` opens no step, even if an earlier update did.
                ThreadPart::FailedStep => {
                    if self.steps.remove(&id) {
                        changed = true;
                        if self.latest_step.as_ref() == Some(&id) {
                            self.latest_step = None;
                        }
                    }
                }
                ThreadPart::Row => {
                    if kind.opens_step(self.step_count()) {
                        self.implicit_step = true;
                        changed = true;
                    }
                    changed |= self.tool_calls.insert(id);
                }
                ThreadPart::Hidden => {}
            }
        }
        for (id, tokens) in progress.tokens {
            changed |= self.tokens.insert(id, tokens) != Some(tokens);
        }
        (changed, stage_changed)
    }

    fn patch(&self) -> RunPatch {
        let steps = self.step_count() as u32;
        let tool_calls = self.base_tool_calls + self.tool_calls.len() as u32;
        let tokens = self
            .tokens
            .values()
            .fold(self.base_tokens, |sum, t| sum.plus(*t));
        RunPatch {
            stage: self.stage.map(str::to_string),
            stage_index: self.stage.and_then(stage_index),
            stats: Some(RunStats {
                steps: Some(steps),
                tool_calls: Some(tool_calls),
                tokens: serde_json::to_value(tokens).ok(),
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
}

/// TH27: the turn's commit hook. Each committed batch goes to one task per run, which
/// writes the stage at once when it changes and the counts at most every 5 s, and stops
/// at the first write the run refuses. That refusal stops the session's turn once
/// (TH41, TH42): a cancel that ended the run before this turn registered found no turn
/// to stop, here or on a continuation.
pub fn observer(org_id: String, run_id: String, session_id: String) -> OnCommit {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(watch_progress(org_id, run_id, session_id, rx));
    Arc::new(move |events: &[DurableEvent]| {
        let progress = Progress::of(events);
        if !progress.is_empty() {
            // A closed task stopped writing on purpose.
            let _ = tx.send(progress);
        }
    })
}

async fn watch_progress(
    org_id: String,
    run_id: String,
    session_id: String,
    rx: mpsc::UnboundedReceiver<Progress>,
) {
    let tally = match runs_table::get_rw(&org_id, &run_id).await {
        Ok(Some(run)) => Tally::resumed(&run),
        Ok(None) => return,
        Err(e) => {
            log::warn!("[RCA_TURN] cannot read run {run_id} for its progress: {e}");
            Tally::default()
        }
    };
    let refused = write_progress(tally, rx, &run_id, |patch| {
        rca_runs::update_run(&org_id, &run_id, patch)
    })
    .await;
    if refused {
        stop_turn(&org_id, &session_id).await;
    }
}

/// The loop of [watch_progress]; `write` is the run's progress write. Returns whether
/// the run refused a write (it has ended); `false` when the turn ended first.
async fn write_progress<W, F>(
    mut tally: Tally,
    mut rx: mpsc::UnboundedReceiver<Progress>,
    run_id: &str,
    mut write: W,
) -> bool
where
    W: FnMut(RunPatch) -> F,
    F: Future<Output = anyhow::Result<bool>>,
{
    let mut last_write = Instant::now();
    let mut dirty = false;
    loop {
        let due = last_write + PROGRESS_INTERVAL;
        let stage_changed = tokio::select! {
            progress = rx.recv() => {
                // The turn ended; the finalizer writes the final counts.
                let Some(progress) = progress else { return false };
                let (changed, stage_changed) = tally.apply(progress);
                dirty |= changed || stage_changed;
                stage_changed
            }
            () = tokio::time::sleep_until(due), if dirty => false,
        };
        if !dirty || !(stage_changed || Instant::now() >= due) {
            continue;
        }
        match write(tally.patch()).await {
            Ok(true) => {}
            Ok(false) => return true,
            Err(e) => log::warn!("[RCA_TURN] could not write the progress of run {run_id}: {e}"),
        }
        last_write = Instant::now();
        dirty = false;
    }
}

/// Cancel the incident's live run (TH41, TH42).
///
/// The run ends `cancelled` first; only the winner of that write stops its turn, through
/// o2-ai, so the turn ends on whichever node runs it. `Ok(None)` when no live run holds
/// the incident or another write ended it first.
pub async fn cancel_rca_run(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<String>> {
    // The primary: a cancel right after a start must see that run (RR-19).
    let Some(incident) = infra::table::alert_incidents::get_rw(org_id, incident_id).await? else {
        return Ok(None);
    };
    let Some(run_id) = incident.rca_run_id else {
        return Ok(None);
    };
    let Some(run) = runs_table::get_rw(org_id, &run_id).await? else {
        return Ok(None);
    };
    let item = runs_table::to_item(&run);
    if !item.state.is_live() {
        return Ok(None);
    }

    let cancel = RunPatch {
        state: Some(RunState::Cancelled),
        cancelled_by: Some(user_id.to_string()),
        event: Some(IncidentEvent::ai_analysis_cancelled(Some(
            user_id.to_string(),
        ))),
        ..Default::default()
    };
    if !rca_runs::update_run(org_id, &run_id, cancel).await? {
        return Ok(None);
    }
    count_run_end(org_id, item.trigger, RunState::Cancelled, "");
    // TH44: the cancel is this run's one end; its counts are the observer's last
    // progress write (at most 5 s behind the transcript).
    let progress = run
        .stats
        .as_ref()
        .and_then(|v| RunStats::deserialize(v).ok())
        .map(|stats| ThreadStats {
            steps: stats.steps.unwrap_or(0),
            tool_calls: stats.tool_calls.unwrap_or(0),
            ..Default::default()
        });
    observe_end(
        org_id,
        RunState::Cancelled,
        run.started_at,
        progress.as_ref(),
    );

    // A `waiting_input` run has no running turn (TH42).
    if item.state == RunState::Running
        && let Some(session_id) = run.session_id.as_deref()
    {
        stop_turn(org_id, session_id).await;
    }
    // §6: no verdict is coming, so nothing may go on holding a page for one.
    rca_service::skip_analysis_for_incident(org_id, incident_id).await;
    log::info!("[RCA_TURN] cancelled run {run_id} of incident {incident_id}");
    Ok(Some(run_id))
}

/// Ask o2-ai to end the run's turn; a failure only leaves the turn to its deadline.
async fn stop_turn(org_id: &str, session_id: &str) {
    let auth = match crate::organization::get_sre_agent_credentials(org_id).await {
        Ok((email, token)) => crate::auth::build_basic_auth_header(&email, &token),
        Err(e) => {
            // o2-ai still accepts the internal secret the client attaches.
            log::warn!(
                "[RCA_TURN] no SysRcaAgent credentials to cancel {org_id}/{session_id}: {e}"
            );
            String::new()
        }
    };
    match cancel_chat_turn(org_id, session_id, &auth).await {
        Ok(outcome) => log::info!(
            "[RCA_TURN] cancel of {org_id}/{session_id}: cancelled={}, active={}",
            outcome.cancelled,
            outcome.active
        ),
        Err(e) => {
            log::warn!("[RCA_TURN] could not cancel the turn of {org_id}/{session_id}: {e:?}")
        }
    }
}

/// TH28: finalize the runs whose turn ended without its node finalizing it, and end the
/// runs that never got a turn and stopped writing (RR-40). Returns how many runs it ended.
pub async fn sweep_rca_runs() -> anyhow::Result<usize> {
    let timeout = get_o2_config().incidents.rca_timeout_secs;
    let now = now_micros();
    let mut ended = 0;
    for run in runs_table::list_running(SWEEP_BATCH).await? {
        let run_id = run.run_id.clone();
        match sweep_run(run, now, timeout).await {
            Ok(true) => ended += 1,
            Ok(false) => {}
            Err(e) => log::warn!("[RCA_TURN] could not sweep run {run_id}: {e:#}"),
        }
    }
    Ok(ended)
}

async fn sweep_run(run: RunRow, now: i64, timeout_secs: u64) -> anyhow::Result<bool> {
    if let Some(session_id) = run.session_id.clone() {
        let turns = ai_chat_turns::list_for_session(&run.org_id, &session_id).await?;
        if let Some(turn) = turns.last() {
            let Some(result) = lost_turn_result(turn, now, timeout_secs) else {
                return Ok(false);
            };
            // A dead `running` row is closed as its turn task closes an interruption, so
            // the session admits its next turn and the row reads as ended.
            if turn.status == ai_chat_turns::TURN_RUNNING
                && let Err(e) = ai_chat_turns::finish(
                    &run.org_id,
                    &session_id,
                    &turn.turn_id,
                    ai_chat_turns::TURN_INTERRUPTED,
                    Some(STREAM_INTERRUPTED),
                    None,
                    turn.end_seq,
                    now,
                )
                .await
            {
                log::warn!(
                    "[RCA_TURN] could not close the dead turn {} of run {}: {e}",
                    turn.turn_id,
                    run.run_id
                );
            }
            let end = TurnEnd {
                result,
                committed_seq: turn.end_seq.unwrap_or(ai_chat_sessions::NO_SEQ),
            };
            return Ok(finalize(run.org_id, run.run_id, turn.turn_id.clone(), end, None).await);
        }
    }
    // No turn row: admission never finished, so the Phase 1 stale rule applies.
    let item = runs_table::to_item(&run);
    if !is_stale(item.state, run.updated_at, now, timeout_secs) {
        return Ok(false);
    }
    let ending = RunEnd {
        org_id: run.org_id.clone(),
        run,
        item,
        thread: None,
        transcript: None,
        turn_error: None,
    };
    Ok(ending
        .fail(
            runs_table::STALE_ERROR_CODE,
            runs_table::STALE_ERROR_REASON,
            None,
        )
        .await)
}

/// How a turn whose node never finalized it ended; `None` while its node may still do so.
/// A `running` turn past the RCA deadline plus 120 s died (`Interrupted`); an ended turn
/// is left to its node's finalizer for 120 s.
fn lost_turn_result(
    turn: &ai_chat_turns::Model,
    now: i64,
    timeout_secs: u64,
) -> Option<TurnResult> {
    if turn.status == ai_chat_turns::TURN_RUNNING {
        return (now.saturating_sub(turn.started_at) > stale_threshold_us(timeout_secs))
            .then_some(TurnResult::Interrupted);
    }
    let grace_us = i64::try_from(STALE_GRACE_SECS)
        .unwrap_or(i64::MAX)
        .saturating_mul(1_000_000);
    if now.saturating_sub(turn.ended_at.unwrap_or(turn.started_at)) <= grace_us {
        return None;
    }
    Some(match (turn.status.as_str(), turn.error_code.as_deref()) {
        (ai_chat_turns::TURN_COMPLETED, _) => TurnResult::Persisted,
        (ai_chat_turns::TURN_CANCELLED, Some(CHAT_DELETED)) => TurnResult::Deleted,
        (ai_chat_turns::TURN_CANCELLED, _) => TurnResult::Cancelled,
        (ai_chat_turns::TURN_INTERRUPTED, _) => TurnResult::Interrupted,
        (_, Some(TURN_TIMEOUT_CODE)) => TurnResult::Timeout,
        _ => TurnResult::Error,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::AnalysisStatus;
    use infra::table::entity::ai_chat_turns as turn_rows;
    use parking_lot::Mutex;
    use sea_orm::{ActiveModelTrait, EntityTrait};

    use super::*;
    use crate::{
        ai_chat::{
            rca_ledger::tests::{H1, H2, hypothesis, ledger_session, submit, verdict},
            rca_thread::tests::{
                SECOND_REPORT, Session, T, VISIBLE_TOOL_CALLS, hits, rca_session, search_sql,
                without_report,
            },
        },
        alerts::rca_runs::tests::{
            FAIL_THE_WRITE, cancel_write, completes, db, failures, hold_page, hold_status,
            incident_row, new_incident, start, stored, timeline,
        },
    };

    // ---- TH6: the prompt ----

    const TRIGGERS: [(RunTrigger, &str); 8] = [
        (RunTrigger::AutoNewIncident, "new incident"),
        (RunTrigger::AutoNewAlertType, "new alert type"),
        (RunTrigger::AutoReopen, "reopen"),
        (RunTrigger::Manual, "manual"),
        (RunTrigger::Reanalyze, "re-analyze"),
        (RunTrigger::OncallPage, "on-call page"),
        (RunTrigger::Resume, "resume"),
        (RunTrigger::Legacy, "manual"),
    ];

    fn incident(id: &str, title: &str, alerts: u32, severity: &str) -> RcaPromptSubject {
        RcaPromptSubject::Incident {
            id: id.to_string(),
            title: title.to_string(),
            alerts,
            severity: severity.to_string(),
        }
    }

    /// TH6: the design's samples, word for word.
    #[test]
    fn the_prompt_reads_as_the_design_samples() {
        let render = |trigger, subject| RcaPrompt::Initial { trigger, subject }.render();
        assert_eq!(
            render(
                RunTrigger::AutoNewIncident,
                incident("2nV", "checkout-api 5xx", 6, "P2")
            ),
            "Analyze incident 2nV \"checkout-api 5xx\" (6 alerts, P2). Trigger: new incident."
        );
        assert_eq!(
            render(
                RunTrigger::OncallPage,
                RcaPromptSubject::Alert {
                    name: "High 5xx".to_string(),
                    stream: "k8s_logs".to_string(),
                }
            ),
            "Analyze alert \"High 5xx\" on stream \"k8s_logs\". Trigger: on-call page."
        );
        assert_eq!(
            render(RunTrigger::Manual, incident("inc_1", "  ", 1, "")),
            "Analyze incident inc_1 \"inc_1\" (1 alert). Trigger: manual.",
            "a blank title names the id; one alert is singular; no severity is left out"
        );
        assert_eq!(
            RcaPrompt::Continue.render(),
            "The previous turn stopped. Continue from the last finished step. Do not repeat \
             finished steps. Call submit_report when the investigation is complete."
        );
    }

    /// TH6: every trigger and every subject renders a non-blank text naming both.
    #[test]
    fn every_trigger_and_subject_renders_a_prompt() {
        let subjects = [
            incident("inc_1", "checkout errors", 3, "P1"),
            incident("inc_2", "", 0, ""),
            RcaPromptSubject::Alert {
                name: "".to_string(),
                stream: "".to_string(),
            },
            RcaPromptSubject::Alert {
                name: "Disk full".to_string(),
                stream: "node_metrics".to_string(),
            },
        ];
        for (trigger, label) in TRIGGERS {
            for subject in &subjects {
                let text = RcaPrompt::Initial {
                    trigger,
                    subject: subject.clone(),
                }
                .render();
                assert!(!text.trim().is_empty());
                assert!(text.ends_with(&format!("Trigger: {label}.")), "{text}");
                let named = match subject {
                    RcaPromptSubject::Incident { id, .. } => format!("Analyze incident {id} "),
                    RcaPromptSubject::Alert { name, stream } => {
                        format!("Analyze alert \"{name}\" on stream \"{stream}\"")
                    }
                };
                assert!(text.starts_with(&named), "{text}");
            }
        }
    }

    // ---- TH19, TH22–TH25, TH42: the finalizer ----

    /// The finalizer's view of the run: its row, the counts of `events` and their decoding.
    async fn ending(org_id: &str, run_id: &str, events: &[DurableEvent]) -> RunEnd {
        let run = runs_table::get_rw(org_id, run_id).await.unwrap().unwrap();
        RunEnd {
            org_id: org_id.to_string(),
            item: runs_table::to_item(&run),
            run,
            thread: Some(project_rca_thread(events, &[], false, false).stats),
            transcript: Some(decode_run(events)),
            turn_error: None,
        }
    }

    /// [finalize] after its transcript read, with no turn to continue (the sweeper's call).
    async fn end(org_id: &str, run_id: &str, events: &[DurableEvent], result: TurnResult) -> bool {
        ending(org_id, run_id, events)
            .await
            .end(result, "turn-1", None)
            .await
    }

    /// A session whose only report is `markdown`.
    fn one_report(markdown: &str) -> Vec<DurableEvent> {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT 1"),
            hits(1),
            100,
            110,
        );
        s.tool(
            "msg_a1",
            "prt_p1",
            "submit_report",
            "completed",
            json!({"markdown": markdown}),
            json!({}),
            200,
            201,
        );
        s.events
    }

    fn released(status: AnalysisStatus) -> bool {
        !status.may_still_answer()
    }

    /// TH19, TH22, TH23: the last committed `submit_report` is the report; a second finalize
    /// of the same turn changes nothing.
    #[tokio::test]
    async fn the_last_submitted_report_completes_the_run_once() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let record = hold_page(&org, &inc).await;
        let events = rca_session();

        assert!(end(&org, &run_id, &events, TurnResult::Persisted).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.report.as_deref(), Some(SECOND_REPORT));
        let stats = run.stats.clone().unwrap();
        assert_eq!(
            (stats.steps, stats.tool_calls),
            (Some(3), Some(VISIBLE_TOOL_CALLS))
        );
        assert_eq!(
            stats.tokens,
            Some(json!({"input": 3_000, "output": 600, "reasoning": 50, "cache_read": 400}))
        );
        assert_eq!(completes(&timeline(&org, &inc).await), 1);
        assert!(
            released(hold_status(&org, &record).await),
            "a report without a verdict is told to the ladder"
        );
        let steps_observed = || {
            RCA_RUN_STEPS
                .with_label_values(&[org.as_str()])
                .get_sample_count()
        };
        assert_eq!(
            steps_observed(),
            1,
            "TH44: the completing finalize observes once"
        );
        let completed_total = || {
            config::metrics::RCA_RUNS_TOTAL
                .with_label_values(&[org.as_str(), "manual", "completed", ""])
                .get()
        };
        assert_eq!(completed_total(), 1);

        for result in [
            TurnResult::Persisted,
            TurnResult::Timeout,
            TurnResult::Error,
        ] {
            assert!(!end(&org, &run_id, &events, result).await);
        }
        assert_eq!(
            steps_observed(),
            1,
            "a second finalize observes nothing more"
        );
        assert_eq!(completed_total(), 1);
        let again = stored(&org, &run_id).await;
        assert_eq!(again.state, RunState::Completed);
        assert_eq!(again.report.as_deref(), Some(SECOND_REPORT));
        assert_eq!(again.ended_at, run.ended_at);
        assert_eq!(completes(&timeline(&org, &inc).await), 1);
        assert!(failures(&timeline(&org, &inc).await).is_empty());
    }

    /// TH23: a committed report completes the run whatever ended the turn.
    #[tokio::test]
    async fn a_committed_report_completes_the_run_after_any_turn_end() {
        let _db = db().await;
        for result in [
            TurnResult::Timeout,
            TurnResult::Error,
            TurnResult::Interrupted,
            TurnResult::PersistenceFailed,
        ] {
            let (org, inc) = new_incident(None).await;
            let run_id = start(&org, &inc, RunTrigger::AutoNewIncident).await;
            assert!(
                end(&org, &run_id, &rca_session(), result).await,
                "{result:?}"
            );
            let run = stored(&org, &run_id).await;
            assert_eq!(run.state, RunState::Completed, "{result:?}");
            assert_eq!(run.report.as_deref(), Some(SECOND_REPORT), "{result:?}");
        }
    }

    /// TH24: no committed report fails the run with the turn's code, keeps the counts and
    /// tells each linked on-call record that no verdict is coming.
    #[tokio::test]
    async fn no_report_fails_the_run_with_the_turns_code() {
        let _db = db().await;
        for (result, code) in [
            (TurnResult::Persisted, ERROR_NO_REPORT),
            (TurnResult::Timeout, ERROR_TIMEOUT),
            (TurnResult::Error, ERROR_AGENT_ERROR),
            (TurnResult::PersistenceFailed, ERROR_PERSISTENCE_FAILED),
            (TurnResult::Deleted, ERROR_TRANSCRIPT_DELETED),
            (TurnResult::Interrupted, ERROR_INTERRUPTED),
        ] {
            let (org, inc) = new_incident(None).await;
            let run_id = start(&org, &inc, RunTrigger::Manual).await;
            let record = hold_page(&org, &inc).await;

            assert!(
                end(&org, &run_id, &without_report(rca_session()), result).await,
                "{result:?}"
            );

            let run = stored(&org, &run_id).await;
            assert_eq!(run.state, RunState::Failed, "{result:?}");
            assert_eq!(run.error.unwrap().code, code, "{result:?}");
            assert_eq!(run.report, None);
            assert_eq!(
                run.stats.unwrap().tool_calls,
                Some(VISIBLE_TOOL_CALLS),
                "{result:?}"
            );
            let events = timeline(&org, &inc).await;
            assert_eq!(failures(&events).len(), 1, "{result:?}");
            assert_eq!(completes(&events), 0);
            assert!(released(hold_status(&org, &record).await), "{result:?}");
        }
    }

    /// TH24, 02 §9.1: a submit with a blank report is no report.
    #[tokio::test]
    async fn a_blank_submitted_report_is_no_report() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let events = one_report(" \n\t");
        assert!(decode_run(&events).submit.is_none());

        assert!(end(&org, &run_id, &events, TurnResult::Persisted).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_NO_REPORT);
        assert_eq!(completes(&timeline(&org, &inc).await), 0);
    }

    /// The org's `rca_run_steps` and `rca_run_tool_calls` sample counts.
    fn samples(org: &str) -> (u64, u64) {
        (
            RCA_RUN_STEPS.with_label_values(&[org]).get_sample_count(),
            RCA_RUN_TOOL_CALLS
                .with_label_values(&[org])
                .get_sample_count(),
        )
    }

    /// TH22, TH42, TH44: finalizing a cancelled run, once or twice, writes its final counts
    /// and nothing else: no report, no Complete event, no histogram (the cancel observed
    /// them), and the hold is left to the cancel.
    #[tokio::test]
    async fn a_cancelled_run_gets_only_its_final_counts() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        cancel_write(&org, &run_id).await;
        let record = hold_page(&org, &inc).await;
        let before = timeline(&org, &inc).await.len();

        assert!(!end(&org, &run_id, &rca_session(), TurnResult::Cancelled).await);
        assert_eq!(
            samples(&org),
            (0, 0),
            "the finalizer observes no cancelled run"
        );
        let run = stored(&org, &run_id).await;
        let stats = run.stats.unwrap();
        assert_eq!(
            (stats.steps, stats.tool_calls),
            (Some(3), Some(VISIBLE_TOOL_CALLS))
        );

        assert!(!end(&org, &run_id, &rca_session(), TurnResult::Persisted).await);
        assert_eq!(samples(&org), (0, 0), "nor a second time");

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.report, None);
        assert_eq!(run.error, None);
        let stats = run.stats.unwrap();
        assert_eq!(
            (stats.steps, stats.tool_calls),
            (Some(3), Some(VISIBLE_TOOL_CALLS))
        );
        assert_eq!(timeline(&org, &inc).await.len(), before);
        assert_eq!(hold_status(&org, &record).await, AnalysisStatus::Pending);
    }

    /// TH44: the cancel that ends a run observes its last progress counts once; a second
    /// cancel finds no live run and observes nothing.
    #[tokio::test]
    async fn a_cancel_observes_the_runs_progress_counts_once() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        // The observer's last progress write. No session: no turn to stop here.
        let progress = RunPatch {
            stats: Some(RunStats {
                steps: Some(2),
                tool_calls: Some(5),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(rca_runs::update_run(&org, &run_id, progress).await.unwrap());
        let cancelled_total = || {
            config::metrics::RCA_RUNS_TOTAL
                .with_label_values(&[org.as_str(), "manual", "cancelled", ""])
                .get()
        };
        assert_eq!(samples(&org), (0, 0));

        assert_eq!(
            cancel_rca_run(&org, &inc, "a.rao@acme.io").await.unwrap(),
            Some(run_id.clone())
        );
        assert_eq!(samples(&org), (1, 1));
        assert_eq!(
            RCA_RUN_STEPS
                .with_label_values(&[org.as_str()])
                .get_sample_sum(),
            2.0
        );
        assert_eq!(
            RCA_RUN_TOOL_CALLS
                .with_label_values(&[org.as_str()])
                .get_sample_sum(),
            5.0
        );
        assert_eq!(cancelled_total(), 1);

        assert_eq!(
            cancel_rca_run(&org, &inc, "a.rao@acme.io").await.unwrap(),
            None
        );
        assert_eq!(samples(&org), (1, 1), "a second cancel observes nothing");
        assert_eq!(cancelled_total(), 1);
        assert_eq!(stored(&org, &run_id).await.state, RunState::Cancelled);
    }

    /// RR-13: a report whose completed write errors ends the run `save_failed`, appends no
    /// Complete event and frees the held page.
    #[tokio::test]
    async fn a_report_whose_write_errors_ends_the_run_save_failed() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let record = hold_page(&org, &inc).await;

        assert!(
            end(
                &org,
                &run_id,
                &one_report(FAIL_THE_WRITE),
                TurnResult::Persisted
            )
            .await
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
        assert!(released(hold_status(&org, &record).await));
    }

    // ---- VE16, VE34, VE41, VE44, F6, F11: the run record ----

    const ALL_STAGES: [&str; 7] = [
        "context",
        "topology",
        "changes",
        "traces",
        "log_patterns",
        "metrics",
        "converge",
    ];

    /// [ledger_session] over `stages`, with one report carrying `verdict`.
    fn reported(stages: &[&str], verdict: Value) -> Vec<DurableEvent> {
        let mut s = ledger_session(stages);
        submit(
            &mut s,
            "prt_p1",
            "completed",
            json!({
                "markdown": SECOND_REPORT,
                "verdict": verdict,
                "timeline": [{"at": 1, "text": "Errors began", "status": "confirmed", "evidence_ids": ["e1"]}],
            }),
            4_000,
        );
        s.events
    }

    /// What the finalizer computes from `events` for a run that ends `completed`.
    fn expected_end(events: &[DurableEvent], completed: bool) -> RunEndResult {
        let transcript = decode_run(events);
        record_run_end(&RunEndInput {
            submit: transcript.submit.as_ref(),
            calls: &transcript.calls,
            tool_log: &transcript.tool_log,
            stages_run: &transcript.stages_run,
            ended_by: EndedBy::Agent,
            completed,
        })
    }

    fn record_of(run: &config::meta::alerts::rca_runs::RcaRun) -> RcaRunRecord {
        serde_json::from_value(run.result.clone().expect("a stored result")).unwrap()
    }

    /// `rca_summary.detail` of the incident.
    async fn list_detail(org: &str, inc: &str) -> Value {
        let summary = incident_row(org, inc).await.rca_summary.unwrap_or_default();
        summary.get("detail").cloned().unwrap_or(Value::Null)
    }

    /// F11 counters of one org: outcome, claim, grade, failed citations.
    fn record_counts(org: &str) -> (u64, u64, u64, u64) {
        (
            RCA_OUTCOME_TOTAL
                .with_label_values(&[org, "root_cause_identified", "manual"])
                .get(),
            RCA_OUTCOME_CLAIM_TOTAL
                .with_label_values(&[org, "root_cause_identified", "root_cause_identified"])
                .get(),
            RCA_CONFIDENCE_GRADE_TOTAL
                .with_label_values(&[org, "high", "high"])
                .get(),
            RCA_UNVERIFIED_CITATIONS_TOTAL
                .with_label_values(&[org, "failed"])
                .get(),
        )
    }

    /// VE41, F6, F11, VE44: a completed run stores its record in `result`, the outcome and
    /// the graded band in `outcome`/`confidence`, mirrors both to the incident, leaves the
    /// list detail empty, and counts the record once; a repeat finalize changes nothing.
    #[tokio::test]
    async fn a_completed_run_stores_its_record_outcome_and_band_once() {
        use config::meta::oncall::{
            agent::Confidence,
            confidence::{GradeReason, SignalClass, UnverifiedReason},
            rca_run::{HypothesisStatus, OutcomeReason, RcaOutcome},
        };

        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let events = reported(&ALL_STAGES, verdict(H1, "high", "root_cause_identified"));
        let expected = expected_end(&events, true);

        assert!(end(&org, &run_id, &events, TurnResult::Persisted).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.report.as_deref(), Some(SECOND_REPORT));
        let record = record_of(&run);
        assert_eq!(record, expected.record);
        assert_eq!(record.schema_version, 1);
        assert_eq!(record.outcome, Some(RcaOutcome::RootCauseIdentified));
        assert_eq!(record.outcome_reason, Some(OutcomeReason::RootCauseGraded));
        assert!(record.has_ledger);
        let statuses: Vec<(&str, HypothesisStatus)> = record
            .ledger
            .hypotheses
            .iter()
            .map(|h| (h.id.as_str(), h.status))
            .collect();
        assert_eq!(
            statuses,
            [
                ("h1", HypothesisStatus::RootCause),
                ("h2", HypothesisStatus::RuledOut)
            ]
        );
        let grade = record.grade.as_ref().expect("a graded run");
        assert_eq!(
            (grade.claimed, grade.graded, grade.band),
            (Confidence::High, Confidence::High, Confidence::High)
        );
        assert_eq!(
            grade.decisive_classes,
            [SignalClass::Logs, SignalClass::Metrics]
        );
        assert_eq!(grade.ruled_out, [H2]);
        assert!(
            grade
                .reasons
                .contains(&GradeReason::TwoDecisiveClassesAndRuledOut)
        );
        let unverified: Vec<(&str, UnverifiedReason)> = record
            .unverified
            .iter()
            .map(|u| (u.evidence_id.as_str(), u.reason))
            .collect();
        assert_eq!(unverified, [("e4", UnverifiedReason::Failed)]);
        assert_eq!(
            record.verdict.as_ref().map(|v| v.confidence),
            Some(Confidence::High),
            "VE38: the verdict carries the graded band"
        );
        assert!(
            record.blind_spots.iter().all(|b| b.id != "run_end"),
            "VE34: a completed run gets no run_end blind spot"
        );

        // VE41: the columns copy the record; the incident mirrors them.
        assert_eq!(run.outcome.as_deref(), Some("root_cause_identified"));
        assert_eq!(run.confidence.as_deref(), Some("high"));
        let incident = incident_row(&org, &inc).await;
        assert_eq!(incident.rca_outcome, run.outcome);
        assert_eq!(incident.rca_confidence, run.confidence);
        assert_eq!(
            list_detail(&org, &inc).await,
            Value::Null,
            "VE44: not blocked"
        );

        assert_eq!(record_counts(&org), (1, 1, 1, 1), "F11: counted once");

        for result in [TurnResult::Persisted, TurnResult::Timeout] {
            assert!(!end(&org, &run_id, &events, result).await);
        }
        let again = stored(&org, &run_id).await;
        assert_eq!(again.result, run.result);
        assert_eq!(
            (again.outcome, again.confidence),
            (run.outcome, run.confidence)
        );
        assert_eq!(
            record_counts(&org),
            (1, 1, 1, 1),
            "F11: a repeat finalize counts nothing"
        );
    }

    /// VE44, VE15: a run whose leading hypothesis is blocked completes `blocked` with a low
    /// band, and the same write sets the list detail to the first fixable blind spot.
    #[tokio::test]
    async fn a_blocked_run_writes_what_it_needs_to_the_list_detail() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        s.tool(
            "msg_a1",
            "prt_h1",
            "record_hypothesis",
            "completed",
            hypothesis("h1", "The 10:02 deploy broke checkout", "blocked", vec![]),
            json!({"output": "{}"}),
            100,
            101,
        );
        s.tool(
            "msg_a1",
            "prt_l1",
            "record_blind_spot",
            "completed",
            json!({"id": "b1", "axis": "other", "title": "Optional note", "why": "w", "fix": "none"}),
            json!({"output": "{}"}),
            200,
            201,
        );
        s.tool(
            "msg_a1",
            "prt_l2",
            "record_blind_spot",
            "completed",
            json!({"id": "b2", "axis": "change", "title": "Change history", "why": "No deploy tool", "fix": "connect_toolset"}),
            json!({"output": "{}"}),
            300,
            301,
        );
        submit(
            &mut s,
            "prt_p1",
            "completed",
            json!({"markdown": SECOND_REPORT, "verdict": verdict("The 10:02 deploy broke checkout", "medium", "blocked")}),
            400,
        );

        assert!(end(&org, &run_id, &s.events, TurnResult::Persisted).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.outcome.as_deref(), Some("blocked"));
        assert_eq!(run.confidence.as_deref(), Some("low"), "VE15");
        let incident = incident_row(&org, &inc).await;
        assert_eq!(incident.rca_outcome.as_deref(), Some("blocked"));
        assert_eq!(incident.rca_confidence.as_deref(), Some("low"));
        assert_eq!(
            list_detail(&org, &inc).await,
            json!("Needs: Change history")
        );
        assert_eq!(
            record_of(&run).outcome_reason,
            Some(config::meta::oncall::rca_run::OutcomeReason::LeadingBlocked)
        );
    }

    /// VE16, VE34: a cancelled run gets its partial record once, through the stats-only
    /// write: the ledger, its blind spots plus "3 stages did not run", and no verdict,
    /// grade, outcome or band; a later finalize keeps the first record. A cancel is not
    /// the finalizer's end, so nothing is counted (F11).
    #[tokio::test]
    async fn a_cancelled_run_gets_its_partial_record_once_and_no_outcome() {
        use config::meta::oncall::rca_run::BlindSpotFix;

        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        cancel_write(&org, &run_id).await;
        let events = ledger_session(&ALL_STAGES[..4]).events;

        assert!(!end(&org, &run_id, &events, TurnResult::Cancelled).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(
            (run.outcome.as_deref(), run.confidence.as_deref()),
            (None, None)
        );
        let record = record_of(&run);
        assert_eq!(record, expected_end(&events, false).record);
        assert_eq!(record.ledger.hypotheses.len(), 2);
        assert_eq!(
            (&record.verdict, &record.grade, &record.outcome),
            (&None, &None, &None)
        );
        let run_end = record
            .blind_spots
            .iter()
            .find(|b| b.id == "run_end")
            .expect("the run_end blind spot");
        assert_eq!(run_end.title, "3 stages did not run");
        assert_eq!(run_end.why, "Log patterns, Metrics, Converge");
        assert_eq!(run_end.fix, BlindSpotFix::ResumeRun);
        assert!(record.blind_spots.iter().any(|b| b.id == "b1"));
        let incident = incident_row(&org, &inc).await;
        assert_eq!(
            (incident.rca_outcome, incident.rca_confidence),
            (None, None)
        );

        // A later finalize with more of the transcript keeps the first record.
        let more = reported(&ALL_STAGES, verdict(H1, "high", "root_cause_identified"));
        assert!(!end(&org, &run_id, &more, TurnResult::Persisted).await);
        let again = stored(&org, &run_id).await;
        assert_eq!(again.result, run.result);
        assert_eq!(again.state, RunState::Cancelled);
        assert_eq!((again.outcome, again.confidence), (None, None));
        assert_eq!(record_counts(&org), (0, 0, 0, 0));
    }

    /// VE16, VE34, F11: a run that ends with no report is failed with its partial record
    /// (no run_end blind spot when all seven stages ran), counted once.
    #[tokio::test]
    async fn a_failed_run_gets_its_partial_record() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let events = ledger_session(&ALL_STAGES).events;

        assert!(end(&org, &run_id, &events, TurnResult::Persisted).await);

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.as_ref().unwrap().code, ERROR_NO_REPORT);
        assert_eq!(
            (run.outcome.as_deref(), run.confidence.as_deref()),
            (None, None)
        );
        let record = record_of(&run);
        assert_eq!(record, expected_end(&events, false).record);
        assert_eq!(record.ledger.hypotheses.len(), 2);
        assert_eq!(
            (&record.verdict, &record.grade, &record.outcome),
            (&None, &None, &None)
        );
        assert!(record.blind_spots.iter().all(|b| b.id != "run_end"));
        assert_eq!(record_counts(&org), (0, 0, 0, 1));

        assert!(!end(&org, &run_id, &events, TurnResult::Persisted).await);
        assert_eq!(stored(&org, &run_id).await.result, run.result);
        assert_eq!(record_counts(&org), (0, 0, 0, 1), "counted once");
    }

    /// `rca_ledger_invalid_call_total{tool="submit_report"}` of one org.
    fn submit_defects(org: &str) -> u64 {
        RCA_LEDGER_INVALID_CALL_TOTAL
            .with_label_values(&[org, SUBMIT_REPORT])
            .get()
    }

    /// Completes a run of `inc` whose report is `input`; returns the stored record's verdict
    /// `report_ref` and the one the finalizer delivers (its graded verdict).
    async fn complete_with(org: &str, run_id: &str, input: Value) -> (String, String) {
        let mut s = ledger_session(&ALL_STAGES);
        submit(&mut s, "prt_p1", "completed", input, 4_000);
        let ending = ending(org, run_id, &s.events).await;
        let transcript = decode_run(&s.events);
        let submitted = ending.with_report_ref(transcript.submit.as_ref().unwrap());
        let delivered = record_run_end(&RunEndInput {
            submit: Some(&submitted),
            calls: &transcript.calls,
            tool_log: &transcript.tool_log,
            stages_run: &transcript.stages_run,
            ended_by: EndedBy::Agent,
            completed: true,
        })
        .verdict
        .expect("a graded verdict");

        assert!(end(org, run_id, &s.events, TurnResult::Persisted).await);
        let record = record_of(&stored(org, run_id).await);
        assert_eq!(
            record.verdict.as_ref(),
            Some(&delivered),
            "the stored verdict is the delivered one"
        );
        (record.verdict.unwrap().report_ref, delivered.report_ref)
    }

    /// VE1, VE38: a `report_ref` sent at the top level of the submit is taken into the
    /// verdict, stored and delivered; the repair is one `submit_report` defect, counted once
    /// on the winning write and never again on a repeat finalize.
    #[tokio::test]
    async fn a_top_level_report_ref_is_hoisted_and_counted_once() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let mut v = verdict(H1, "high", "root_cause_identified");
        v.as_object_mut().unwrap().remove("report_ref");
        let input = json!({"markdown": SECOND_REPORT, "verdict": v, "report_ref": "inc_x/rca/top"});
        let parsed = config::meta::oncall::rca_run::parse_submit(&input).unwrap();
        assert_eq!(parsed.defects, ["verdict.report_ref: taken from top level"]);
        assert_eq!(submit_defects(&org), 0);

        let (stored_ref, delivered_ref) = complete_with(&org, &run_id, input.clone()).await;
        assert_eq!(stored_ref, "inc_x/rca/top");
        assert_eq!(delivered_ref, "inc_x/rca/top");
        assert_eq!(submit_defects(&org), 1);

        let mut s = ledger_session(&ALL_STAGES);
        submit(&mut s, "prt_p1", "completed", input, 4_000);
        assert!(!end(&org, &run_id, &s.events, TurnResult::Persisted).await);
        assert_eq!(submit_defects(&org), 1, "a repeat finalize counts nothing");
    }

    /// A submit with no `report_ref` anywhere gets the run's own reference
    /// `<subject_id>/rca/<run_id>`, stored and delivered; the default is one defect.
    #[tokio::test]
    async fn a_missing_report_ref_defaults_to_the_runs_reference() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let mut v = verdict(H1, "high", "root_cause_identified");
        v.as_object_mut().unwrap().remove("report_ref");

        let (stored_ref, delivered_ref) = complete_with(
            &org,
            &run_id,
            json!({"markdown": SECOND_REPORT, "verdict": v}),
        )
        .await;
        let default_ref = format!("{inc}/rca/{run_id}");
        assert_eq!(stored_ref, default_ref);
        assert_eq!(delivered_ref, default_ref);
        assert_eq!(submit_defects(&org), 1);
    }

    fn continuation(org_id: &str, run_id: &str, incident_id: &str) -> RcaTurnRun {
        RcaTurnRun {
            org_id: org_id.to_string(),
            run_id: run_id.to_string(),
            subject: RunSubject::Incident(incident_id.to_string()),
            trigger: RunTrigger::Manual,
            mode: RunMode::Fresh,
            context: json!({}),
            session_id: Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".to_string()),
        }
    }

    /// TH25: the first interruption records one continuation instead of failing the run.
    #[tokio::test]
    async fn a_first_interruption_records_one_continuation() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let events = without_report(rca_session());
        let ending = ending(&org, &run_id, &events).await;

        // The continuation's turn cannot start without an agent here; what is under test is
        // that the run counts it and does not fail `interrupted`.
        tokio::time::timeout(
            Duration::from_secs(60),
            ending.end(
                TurnResult::Interrupted,
                "turn-1",
                Some(continuation(&org, &run_id, &inc)),
            ),
        )
        .await
        .expect("the continuation attempt ends");

        let run = stored(&org, &run_id).await;
        assert_eq!(run.continuations, 1);
        assert_ne!(
            run.error.map(|e| e.code).as_deref(),
            Some(ERROR_INTERRUPTED)
        );
    }

    /// TH25: a second interruption fails the run `interrupted` and starts nothing.
    #[tokio::test]
    async fn a_second_interruption_fails_the_run_interrupted() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let counted = RunPatch {
            continuations_inc: true,
            ..Default::default()
        };
        assert!(rca_runs::update_run(&org, &run_id, counted).await.unwrap());
        let events = without_report(rca_session());

        let ended = ending(&org, &run_id, &events)
            .await
            .end(
                TurnResult::Interrupted,
                "turn-2",
                Some(continuation(&org, &run_id, &inc)),
            )
            .await;

        assert!(ended);
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_INTERRUPTED);
        assert_eq!(run.continuations, 1);
    }

    // ---- TH14, D1: the health probe ----

    /// TH14, D1: a probe that never answers gives up after [HEALTH_CHECK_TIMEOUT].
    #[tokio::test(start_paused = true)]
    async fn a_health_probe_that_never_answers_is_agent_unavailable() {
        let began = Instant::now();
        let result = probe_health(std::future::pending::<anyhow::Result<()>>()).await;
        assert_eq!(began.elapsed(), HEALTH_CHECK_TIMEOUT);
        assert_eq!(
            result,
            Err(RcaTurnError::AgentUnavailable(
                "health check timed out".to_string()
            ))
        );
    }

    /// TH14, D1: a refusal is `AgentUnavailable` at once; an answer just inside the deadline
    /// passes.
    #[tokio::test(start_paused = true)]
    async fn a_health_probe_answer_decides_before_the_deadline() {
        let refused =
            probe_health(async { Err::<(), _>(anyhow::anyhow!("503 Service Unavailable")) });
        assert_eq!(
            refused.await,
            Err(RcaTurnError::AgentUnavailable(
                "503 Service Unavailable".to_string()
            ))
        );
        let began = Instant::now();
        let late_ok = probe_health(async {
            tokio::time::sleep(HEALTH_CHECK_TIMEOUT - Duration::from_millis(1)).await;
            Ok::<_, anyhow::Error>(())
        });
        assert_eq!(late_ok.await, Ok(()));
        assert!(began.elapsed() < HEALTH_CHECK_TIMEOUT);
    }

    // ---- TH25, D2: the continuation's start retries ----

    fn started() -> TurnStarted {
        TurnStarted {
            session_id: "0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".to_string(),
            turn_id: "turn-2".to_string(),
        }
    }

    fn unreachable() -> RcaTurnError {
        RcaTurnError::AgentUnavailable("connection refused".to_string())
    }

    /// The gaps between the start attempts, as the paused clock saw them.
    fn gaps(attempts: &[Instant]) -> Vec<Duration> {
        attempts.windows(2).map(|w| w[1] - w[0]).collect()
    }

    /// Each gap is its backoff wait plus at most the time the run re-read took.
    fn assert_waits(gaps: &[Duration], waits: &[Duration]) {
        assert_eq!(gaps.len(), waits.len(), "{gaps:?}");
        for (gap, wait) in gaps.iter().zip(waits) {
            assert!(
                *gap >= *wait && *gap < *wait + Duration::from_secs(3),
                "{gaps:?}"
            );
        }
    }

    /// Paused time that moves 100x faster than the wall clock. The database answers on its
    /// own thread; a runtime that idled meanwhile would jump the paused clock past the
    /// pool's acquire timeout. This task keeps the runtime busy, so time moves only here.
    fn fast_clock() -> tokio::task::JoinHandle<()> {
        tokio::spawn(async {
            loop {
                std::thread::sleep(Duration::from_millis(1));
                tokio::time::advance(Duration::from_millis(100)).await;
            }
        })
    }

    /// TH25, D2: an unreachable agent is retried after each backoff wait; the first start
    /// that succeeds is the continuation.
    #[tokio::test(start_paused = true)]
    async fn an_unreachable_agent_is_retried_after_each_backoff_wait() {
        let clock = fast_clock();
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let attempts: Arc<Mutex<Vec<Instant>>> = Arc::default();
        let log = attempts.clone();
        let ending = ending(&org, &run_id, &without_report(rca_session())).await;

        let result = ending
            .start_continuation(
                continuation(&org, &run_id, &inc),
                move |_run| {
                    let mut log = log.lock();
                    log.push(Instant::now());
                    std::future::ready(if log.len() < 3 {
                        Err(unreachable())
                    } else {
                        Ok(started())
                    })
                },
                || true,
            )
            .await;

        assert_eq!(result, Ok(Some(started())));
        assert_waits(&gaps(&attempts.lock()), &CONTINUATION_RETRY_BACKOFF[..2]);
        assert_eq!(stored(&org, &run_id).await.state, RunState::Running);
        clock.abort();
    }

    /// TH24, TH25, D2: when every wait is spent, the run fails with the start's code.
    #[tokio::test(start_paused = true)]
    async fn a_continuation_that_never_reaches_the_agent_fails_agent_unavailable() {
        let clock = fast_clock();
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let attempts: Arc<Mutex<Vec<Instant>>> = Arc::default();
        let log = attempts.clone();
        let ending = ending(&org, &run_id, &without_report(rca_session())).await;

        let ended = ending
            .resume_with(
                continuation(&org, &run_id, &inc),
                "turn-1",
                move |_run| {
                    log.lock().push(Instant::now());
                    std::future::ready(Err(unreachable()))
                },
                || true,
            )
            .await;

        assert_eq!(ended, Some(true));
        assert_eq!(attempts.lock().len(), CONTINUATION_RETRY_BACKOFF.len() + 1);
        assert_waits(&gaps(&attempts.lock()), &CONTINUATION_RETRY_BACKOFF);
        let run = stored(&org, &run_id).await;
        clock.abort();
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_AGENT_UNAVAILABLE);
        assert_eq!(run.continuations, 1);
    }

    /// TH25, TH42, D2: a run cancelled while its continuation waits keeps its state and
    /// gets only its final counts; nothing more is started and nothing fails it.
    #[tokio::test(start_paused = true)]
    async fn a_cancel_during_the_wait_stops_the_retries() {
        let clock = fast_clock();
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let attempts = Arc::new(Mutex::new(0));
        let count = attempts.clone();
        let ending = ending(&org, &run_id, &without_report(rca_session())).await;
        let (cancel_org, cancel_run) = (org.clone(), run_id.clone());

        let ended = ending
            .resume_with(
                continuation(&org, &run_id, &inc),
                "turn-1",
                move |_run| {
                    *count.lock() += 1;
                    let (org, run_id) = (cancel_org.clone(), cancel_run.clone());
                    // The user cancels while the agent is unreachable.
                    async move {
                        cancel_write(&org, &run_id).await;
                        Err(unreachable())
                    }
                },
                || true,
            )
            .await;

        assert_eq!(ended, Some(false));
        assert_eq!(*attempts.lock(), 1, "no start after the run ended");
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.error, None);
        let stats = run.stats.unwrap();
        assert_eq!(
            (stats.steps, stats.tool_calls),
            (Some(3), Some(VISIBLE_TOOL_CALLS)),
            "the final counts are written"
        );
        assert!(failures(&timeline(&org, &inc).await).is_empty());
        clock.abort();
    }

    /// TH24, D2: any other start error, or no agent client on the node, fails the run at
    /// once with its own code.
    #[tokio::test(start_paused = true)]
    async fn other_start_errors_fail_the_continuation_at_once() {
        let clock = fast_clock();
        let _db = db().await;
        for (error, can_retry, code) in [
            (RcaTurnError::Busy, true, "busy"),
            (RcaTurnError::TurnLimit, true, "turn_limit"),
            (
                RcaTurnError::Credentials("no SA".to_string()),
                true,
                ERROR_CREDENTIALS,
            ),
            (unreachable(), false, ERROR_AGENT_UNAVAILABLE),
        ] {
            let (org, inc) = new_incident(None).await;
            let run_id = start(&org, &inc, RunTrigger::Manual).await;
            let attempts = Arc::new(Mutex::new(0));
            let count = attempts.clone();
            let ending = ending(&org, &run_id, &without_report(rca_session())).await;
            let began = Instant::now();

            let ended = ending
                .resume_with(
                    continuation(&org, &run_id, &inc),
                    "turn-1",
                    |_run| {
                        *count.lock() += 1;
                        std::future::ready(Err(error.clone()))
                    },
                    || can_retry,
                )
                .await;

            assert_eq!(ended, Some(true), "{error:?}");
            assert_eq!(*attempts.lock(), 1, "{error:?}");
            assert!(
                began.elapsed() < CONTINUATION_RETRY_BACKOFF[0],
                "{error:?}: no wait, took {:?}",
                began.elapsed()
            );
            let run = stored(&org, &run_id).await;
            assert_eq!(run.state, RunState::Failed, "{error:?}");
            assert_eq!(run.error.unwrap().code, code, "{error:?}");
        }
        clock.abort();
    }

    // ---- TH3, TH27: the observer ----

    /// TH3, TH27: the observer counts the tool parts the thread shows, each part once
    /// however often it is updated, and keeps the stage of the last `record_step`.
    #[test]
    fn the_observer_counts_the_visible_tool_parts_once() {
        let events = rca_session();
        let thread = project_rca_thread(&events, &[], false, false);

        let mut whole = Tally::default();
        whole.apply(Progress::of(&events));
        let mut batched = Tally::default();
        for event in &events {
            batched.apply(Progress::of(std::slice::from_ref(event)));
        }

        for tally in [whole, batched] {
            let patch = tally.patch();
            let stats = patch.stats.unwrap();
            assert_eq!(stats.tool_calls, Some(thread.stats.tool_calls));
            assert_eq!(stats.tool_calls, Some(VISIBLE_TOOL_CALLS));
            assert_eq!(
                stats.tokens,
                Some(json!({"input": 3_000, "output": 600, "reasoning": 50, "cache_read": 400}))
            );
            assert_eq!(patch.stage.as_deref(), Some("metrics"));
            assert_eq!(patch.stage_index, Some(6));
            let summary = patch.summary.unwrap();
            assert_eq!(summary.tool_calls, Some(VISIBLE_TOOL_CALLS));
        }
    }

    /// The steps the observer counts for `events`, whole and one event at a time, and the
    /// steps the finalizer stores (the projection's).
    fn step_counts(events: &[DurableEvent]) -> (Option<u32>, Option<u32>, u32) {
        let mut whole = Tally::default();
        whole.apply(Progress::of(events));
        let mut batched = Tally::default();
        for event in events {
            batched.apply(Progress::of(std::slice::from_ref(event)));
        }
        (
            whole.patch().stats.unwrap().steps,
            batched.patch().stats.unwrap().steps,
            project_rca_thread(events, &[], false, false).stats.steps,
        )
    }

    /// TH27, TH22: the live step count is the count the run ends with.
    #[test]
    fn the_observer_and_the_finalizer_count_the_same_steps() {
        let (whole, batched, ended) = step_counts(&rca_session());
        assert_eq!(ended, 3, "Investigation, context, metrics");
        assert_eq!(
            whole,
            Some(ended),
            "the observer counts steps by the projection's rule"
        );
        assert_eq!(batched, Some(ended), "batches do not change the count");
    }

    /// TH27, TH29: a `record_step` that ends `error` opens no step, in the projection and in
    /// the observer, even when an earlier update of the part was counted.
    #[test]
    fn a_failed_record_step_opens_no_step() {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        let step = |s: &mut Session, id: &str, status: &str, stage: &str| {
            s.tool(
                "msg_a1",
                id,
                "record_step",
                status,
                json!({"stage": stage, "title": stage}),
                json!({}),
                100,
                110,
            )
        };
        step(&mut s, "prt_s1", "completed", "context");
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT 1"),
            hits(1),
            200,
            210,
        );
        step(&mut s, "prt_s2", "running", "metrics");
        step(&mut s, "prt_s2", "error", "metrics");
        step(&mut s, "prt_s3", "error", "traces");

        let thread = project_rca_thread(&s.events, &[], false, false);
        let stages: Vec<Option<&str>> = thread.steps.iter().map(|st| st.stage.as_deref()).collect();
        assert_eq!(stages, [Some("context")]);
        let (whole, batched, ended) = step_counts(&s.events);
        assert_eq!(ended, 1);
        assert_eq!(whole, Some(1));
        assert_eq!(
            batched,
            Some(1),
            "the error update removes the counted step"
        );
    }

    /// TH27, TH29: tool calls before the first `record_step` make the implicit
    /// "Investigation" step, which both count once.
    #[test]
    fn rows_before_the_first_step_count_one_implicit_step() {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        for i in 0..3 {
            s.tool(
                "msg_a1",
                &format!("prt_t{i}"),
                "o2_SearchSQL",
                "completed",
                search_sql("SELECT 1"),
                hits(2),
                100,
                110,
            );
        }
        s.tool(
            "msg_a1",
            "prt_b1",
            "bash",
            "completed",
            json!({"command": "ls"}),
            json!({}),
            120,
            121,
        );
        s.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "changes", "title": "Look for deploys"}),
            json!({}),
            200,
            201,
        );
        s.tool(
            "msg_a1",
            "prt_t9",
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT 2"),
            hits(1),
            300,
            310,
        );

        let thread = project_rca_thread(&s.events, &[], false, false);
        let titles: Vec<&str> = thread.steps.iter().map(|st| st.title.as_str()).collect();
        assert_eq!(titles, ["Investigation", "Look for deploys"]);
        assert_eq!(thread.steps[0].tool_calls.len(), 3);
        let (whole, batched, ended) = step_counts(&s.events);
        assert_eq!(ended, 2);
        assert_eq!((whole, batched), (Some(2), Some(2)));

        // A hidden tool alone before the first step makes no implicit step.
        let mut hidden = Session::new();
        hidden.message("msg_a1", "assistant", json!({"created": T}));
        hidden.tool(
            "msg_a1",
            "prt_b1",
            "bash",
            "completed",
            json!({"command": "ls"}),
            json!({}),
            1,
            2,
        );
        assert_eq!(step_counts(&hidden.events), (Some(0), Some(0), 0));
    }

    /// TH18, TH29: a stage outside the seven names is no stage, live or in the thread.
    #[test]
    fn an_unknown_stage_is_never_the_runs_stage() {
        let mut tally = Tally::default();
        tally.apply(Progress::of(&step_batch("prt_s1", "gather")));
        let patch = tally.patch();
        assert_eq!((patch.stage, patch.stage_index), (None, None));
        assert_eq!(patch.stats.unwrap().steps, Some(1), "it is still a step");

        tally.apply(Progress::of(&step_batch("prt_s2", "converge")));
        let patch = tally.patch();
        assert_eq!(
            (patch.stage.as_deref(), patch.stage_index),
            (Some("converge"), Some(7))
        );
    }

    fn tool_batch(i: usize) -> Vec<DurableEvent> {
        let mut s = Session::new();
        s.tool(
            "msg_a1",
            &format!("prt_t{i}"),
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT 1"),
            hits(1),
            0,
            1,
        );
        s.events
    }

    fn step_batch(id: &str, stage: &str) -> Vec<DurableEvent> {
        let mut s = Session::new();
        s.tool(
            "msg_a1",
            id,
            "record_step",
            "completed",
            json!({"stage": stage, "title": stage}),
            json!({}),
            0,
            1,
        );
        s.events
    }

    /// One progress write as the test sees it.
    #[derive(Debug, Clone)]
    struct Write {
        at: Duration,
        stage: Option<String>,
        tool_calls: Option<u32>,
    }

    /// TH27: 30 tool calls in 20 s write the stats at most 4 times, plus once at each stage
    /// change, which writes at once.
    #[tokio::test(start_paused = true)]
    async fn progress_writes_at_most_every_five_seconds_plus_each_stage_change() {
        let writes: Arc<Mutex<Vec<Write>>> = Arc::default();
        let log = writes.clone();
        let began = Instant::now();
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(write_progress(
            Tally::default(),
            rx,
            "run_1",
            move |patch: RunPatch| {
                log.lock().push(Write {
                    at: began.elapsed(),
                    stage: patch.stage.clone(),
                    tool_calls: patch.stats.and_then(|s| s.tool_calls),
                });
                std::future::ready(Ok(true))
            },
        ));

        let mut stage_sent_at = Vec::new();
        for i in 0..30u64 {
            tokio::time::sleep_until(began + Duration::from_millis(i * 20_000 / 30)).await;
            tx.send(Progress::of(&tool_batch(i as usize))).unwrap();
            if i == 10 || i == 20 {
                let stage = if i == 10 { "context" } else { "metrics" };
                tx.send(Progress::of(&step_batch(&format!("prt_s{i}"), stage)))
                    .unwrap();
                stage_sent_at.push(began.elapsed());
            }
        }
        // Past the last interval, so the last counts are written.
        tokio::time::sleep_until(began + Duration::from_secs(30)).await;
        drop(tx);
        assert!(!task.await.unwrap(), "the turn ended first: no refusal");

        let writes = writes.lock().clone();
        let mut stage_writes = Vec::new();
        let mut timed_writes = 0;
        let mut previous: Option<&Write> = None;
        for write in &writes {
            let stage_changed = previous.map_or(write.stage.is_some(), |p| p.stage != write.stage);
            if stage_changed {
                stage_writes.push(write.at);
            } else {
                timed_writes += 1;
                if let Some(p) = previous {
                    assert!(
                        write.at - p.at >= PROGRESS_INTERVAL,
                        "a stats write {:?} after the last one: {writes:?}",
                        write.at - p.at
                    );
                }
            }
            previous = Some(write);
        }
        assert_eq!(
            stage_writes, stage_sent_at,
            "a stage change writes at once: {writes:?}"
        );
        assert!(timed_writes <= 4, "{timed_writes} stats writes: {writes:?}");
        assert!(writes.len() <= 4 + 2, "{writes:?}");
        let last = writes.last().unwrap();
        assert_eq!(last.tool_calls, Some(30));
        assert_eq!(last.stage.as_deref(), Some("metrics"));
    }

    /// TH27, TH41: the first write the run refuses stops the observer and reports the
    /// refusal once, so its caller stops the turn once.
    #[tokio::test(start_paused = true)]
    async fn the_observer_stops_at_the_first_refused_write() {
        let calls = Arc::new(Mutex::new(0));
        let counter = calls.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(write_progress(
            Tally::default(),
            rx,
            "run_1",
            move |_patch: RunPatch| {
                *counter.lock() += 1;
                std::future::ready(Ok(false))
            },
        ));

        tx.send(Progress::of(&step_batch("prt_s1", "context")))
            .unwrap();
        assert!(task.await.unwrap(), "a refused write is reported");

        assert_eq!(*calls.lock(), 1);
        assert!(
            tx.send(Progress::of(&tool_batch(1))).is_err(),
            "nothing listens"
        );
    }

    /// TH27: a write that errors is retried at the next interval, not taken as a refusal;
    /// the turn's end then returns `false`.
    #[tokio::test(start_paused = true)]
    async fn a_failed_progress_write_is_no_refusal() {
        let calls = Arc::new(Mutex::new(0));
        let counter = calls.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(write_progress(
            Tally::default(),
            rx,
            "run_1",
            move |_patch: RunPatch| {
                *counter.lock() += 1;
                std::future::ready(Err(anyhow::anyhow!("the database is down")))
            },
        ));

        tx.send(Progress::of(&step_batch("prt_s1", "context")))
            .unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
        tx.send(Progress::of(&step_batch("prt_s2", "metrics")))
            .unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
        drop(tx);
        assert!(!task.await.unwrap());
        assert_eq!(*calls.lock(), 2, "each stage change tried its write");
    }

    // ---- TH28: the sweeper ----

    fn turn(
        session_id: &str,
        turn_id: &str,
        status: &str,
        started_at: i64,
        ended_at: Option<i64>,
        error_code: Option<&str>,
    ) -> ai_chat_turns::Model {
        ai_chat_turns::Model {
            org_id: String::new(),
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            status: status.to_string(),
            error_code: error_code.map(str::to_string),
            start_seq: None,
            end_seq: None,
            started_at,
            ended_at,
        }
    }

    /// TH28: a `running` turn past the deadline plus 120 s died; an ended turn gets 120 s
    /// for its own node's finalizer, then ends as its row says.
    #[test]
    fn a_lost_turn_ends_as_its_row_says() {
        let timeout = 600;
        let now = 10_000_000_000_000;
        let sec = 1_000_000;
        let deadline = stale_threshold_us(timeout);
        let running = |age: i64| turn("s", "t", ai_chat_turns::TURN_RUNNING, now - age, None, None);
        assert_eq!(
            lost_turn_result(&running(deadline + sec), now, timeout),
            Some(TurnResult::Interrupted)
        );
        assert_eq!(
            lost_turn_result(&running(deadline - sec), now, timeout),
            None
        );

        let ended = |status: &str, code: Option<&str>, age: i64| {
            turn("s", "t", status, now - age - sec, Some(now - age), code)
        };
        assert_eq!(
            lost_turn_result(
                &ended(ai_chat_turns::TURN_COMPLETED, None, 60 * sec),
                now,
                timeout
            ),
            None
        );
        let late = 121 * sec;
        for (status, code, result) in [
            (ai_chat_turns::TURN_COMPLETED, None, TurnResult::Persisted),
            (
                ai_chat_turns::TURN_CANCELLED,
                Some(CHAT_DELETED),
                TurnResult::Deleted,
            ),
            (ai_chat_turns::TURN_CANCELLED, None, TurnResult::Cancelled),
            (
                ai_chat_turns::TURN_INTERRUPTED,
                None,
                TurnResult::Interrupted,
            ),
            (
                ai_chat_turns::TURN_FAILED,
                Some(TURN_TIMEOUT_CODE),
                TurnResult::Timeout,
            ),
            (
                ai_chat_turns::TURN_FAILED,
                Some("persistence_failed"),
                TurnResult::Error,
            ),
        ] {
            assert_eq!(
                lost_turn_result(&ended(status, code, late), now, timeout),
                Some(result),
                "{status} {code:?}"
            );
        }
    }

    async fn with_session(org_id: &str, run_id: &str, session_id: &str) {
        let patch = RunPatch {
            session_id: Some(session_id.to_string()),
            ..Default::default()
        };
        assert!(rca_runs::update_run(org_id, run_id, patch).await.unwrap());
    }

    async fn add_turn(org_id: &str, mut row: ai_chat_turns::Model) {
        row.org_id = org_id.to_string();
        turn_rows::Entity::insert(turn_rows::ActiveModel::from(row).reset_all())
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    /// TH28: the sweep finalizes a dead `running` turn as interrupted and an ended turn its
    /// node never finalized as its row says; a run with no turn row keeps the Phase 1 stale
    /// rule; live turns and fresh runs are left alone.
    #[tokio::test]
    async fn the_sweep_finalizes_lost_turns_and_stale_runs() {
        let _db = db().await;
        let timeout = get_o2_config().incidents.rca_timeout_secs;
        let now = now_micros();
        let sec = 1_000_000;
        let dead = now - stale_threshold_us(timeout) - sec;

        let (org, dead_inc) = new_incident(None).await;
        let dead_run = start(&org, &dead_inc, RunTrigger::Manual).await;
        with_session(&org, &dead_run, "ses-dead").await;
        add_turn(
            &org,
            turn(
                "ses-dead",
                "t1",
                ai_chat_turns::TURN_RUNNING,
                dead,
                None,
                None,
            ),
        )
        .await;

        let ended_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let ended_run = start(&org, &ended_inc, RunTrigger::Manual).await;
        with_session(&org, &ended_run, "ses-ended").await;
        add_turn(
            &org,
            turn(
                "ses-ended",
                "t1",
                ai_chat_turns::TURN_COMPLETED,
                now - 200 * sec,
                Some(now - 121 * sec),
                None,
            ),
        )
        .await;

        let live_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let live_run = start(&org, &live_inc, RunTrigger::Manual).await;
        with_session(&org, &live_run, "ses-live").await;
        add_turn(
            &org,
            turn(
                "ses-live",
                "t1",
                ai_chat_turns::TURN_RUNNING,
                now - 10 * sec,
                None,
                None,
            ),
        )
        .await;

        let just_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let just_run = start(&org, &just_inc, RunTrigger::Manual).await;
        with_session(&org, &just_run, "ses-just").await;
        add_turn(
            &org,
            turn(
                "ses-just",
                "t1",
                ai_chat_turns::TURN_COMPLETED,
                now - 20 * sec,
                Some(now - 10 * sec),
                None,
            ),
        )
        .await;

        let stale_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let stale_run = start(&org, &stale_inc, RunTrigger::AutoNewIncident).await;
        crate::alerts::rca_runs::tests::age(&org, &stale_inc, &stale_run, timeout as i64 + 121)
            .await;
        let fresh_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let fresh_run = start(&org, &fresh_inc, RunTrigger::AutoNewIncident).await;

        assert!(sweep_rca_runs().await.unwrap() >= 3);
        sweep_rca_runs().await.unwrap();

        let code = |run: config::meta::alerts::rca_runs::RcaRun| run.error.map(|e| e.code);
        let dead = stored(&org, &dead_run).await;
        assert_eq!(dead.state, RunState::Failed);
        assert_eq!(code(dead).as_deref(), Some(ERROR_INTERRUPTED));
        let ended = stored(&org, &ended_run).await;
        assert_eq!(ended.state, RunState::Failed);
        assert_eq!(code(ended).as_deref(), Some(ERROR_NO_REPORT));
        let stale = stored(&org, &stale_run).await;
        assert_eq!(stale.state, RunState::Failed);
        assert_eq!(code(stale).as_deref(), Some(runs_table::STALE_ERROR_CODE));
        assert_eq!(
            failures(&timeline(&org, &stale_inc).await).len(),
            1,
            "swept once"
        );
        for run_id in [&live_run, &just_run, &fresh_run] {
            assert_eq!(stored(&org, run_id).await.state, RunState::Running);
        }
    }

    async fn turn_row(org_id: &str, session_id: &str, turn_id: &str) -> ai_chat_turns::Model {
        turn_rows::Entity::find_by_id((
            org_id.to_string(),
            session_id.to_string(),
            turn_id.to_string(),
        ))
        .one(infra::db::get_orm_client_rw().await)
        .await
        .unwrap()
        .expect("the turn row exists")
    }

    /// TH28, D4: the sweep closes a dead `running` turn row as `interrupted` /
    /// `stream_interrupted` with the row's own end seq before it finalizes the run; a row
    /// that already ended is left as it is.
    #[tokio::test]
    async fn the_sweep_closes_a_dead_running_turn_row_only() {
        let _db = db().await;
        let timeout = get_o2_config().incidents.rca_timeout_secs;
        let now = now_micros();
        let sec = 1_000_000;

        let (org, dead_inc) = new_incident(None).await;
        let dead_run = start(&org, &dead_inc, RunTrigger::Manual).await;
        with_session(&org, &dead_run, "ses-d4-dead").await;
        let mut dead = turn(
            "ses-d4-dead",
            "t1",
            ai_chat_turns::TURN_RUNNING,
            now - stale_threshold_us(timeout) - sec,
            None,
            None,
        );
        (dead.start_seq, dead.end_seq) = (Some(3), Some(7));
        add_turn(&org, dead).await;

        let ended_inc = crate::alerts::rca_runs::tests::add_incident(&org, None).await;
        let ended_run = start(&org, &ended_inc, RunTrigger::Manual).await;
        with_session(&org, &ended_run, "ses-d4-ended").await;
        let mut ended = turn(
            "ses-d4-ended",
            "t1",
            ai_chat_turns::TURN_FAILED,
            now - 300 * sec,
            Some(now - 200 * sec),
            Some(TURN_TIMEOUT_CODE),
        );
        (ended.start_seq, ended.end_seq) = (Some(0), Some(4));
        add_turn(&org, ended).await;
        let ended_before = turn_row(&org, "ses-d4-ended", "t1").await;

        sweep_rca_runs().await.unwrap();

        let closed = turn_row(&org, "ses-d4-dead", "t1").await;
        assert_eq!(closed.status, ai_chat_turns::TURN_INTERRUPTED);
        assert_eq!(closed.error_code.as_deref(), Some(STREAM_INTERRUPTED));
        assert_eq!((closed.start_seq, closed.end_seq), (Some(3), Some(7)));
        assert!(closed.ended_at.is_some_and(|at| at >= now));
        let run = stored(&org, &dead_run).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_INTERRUPTED);

        assert_eq!(turn_row(&org, "ses-d4-ended", "t1").await, ended_before);
        let run = stored(&org, &ended_run).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, ERROR_TIMEOUT);
    }

    /// The superseded-turn guard: a turn followed by a continuation no longer ends the run.
    #[tokio::test]
    async fn a_turn_followed_by_another_does_not_end_the_run() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let now = now_micros();
        with_session(&org, &run_id, "ses-cont").await;
        add_turn(
            &org,
            turn(
                "ses-cont",
                "t1",
                ai_chat_turns::TURN_INTERRUPTED,
                now - 60_000_000,
                Some(now - 30_000_000),
                None,
            ),
        )
        .await;
        add_turn(
            &org,
            turn(
                "ses-cont",
                "t2",
                ai_chat_turns::TURN_RUNNING,
                now - 20_000_000,
                None,
                None,
            ),
        )
        .await;

        finalize_rca_run(
            org.clone(),
            run_id.clone(),
            "t1".to_string(),
            TurnEnd {
                result: TurnResult::Interrupted,
                committed_seq: 10,
            },
        )
        .await;

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Running);
        assert_eq!(run.error, None);
    }

    /// TH24: a run that fails without a report because its turn broke names the turn
    /// record's own error code in `error.details`; a turn that ended normally (`Persisted`)
    /// or a deleted chat adds no details. Code and reason stay the result's.
    #[tokio::test]
    async fn a_broken_turn_names_its_error_code_in_the_details() {
        let _db = db().await;
        let now = now_micros();
        for (result, turn_code, code, details) in [
            (
                TurnResult::Error,
                Some("restore_failed"),
                ERROR_AGENT_ERROR,
                Some("turn: restore_failed"),
            ),
            (
                TurnResult::Timeout,
                Some(TURN_TIMEOUT_CODE),
                ERROR_TIMEOUT,
                Some("turn: turn_timeout"),
            ),
            (
                TurnResult::Interrupted,
                Some(STREAM_INTERRUPTED),
                ERROR_INTERRUPTED,
                Some("turn: stream_interrupted"),
            ),
            (
                TurnResult::PersistenceFailed,
                Some("persistence_failed"),
                ERROR_PERSISTENCE_FAILED,
                Some("turn: persistence_failed"),
            ),
            (TurnResult::Error, None, ERROR_AGENT_ERROR, None),
            (
                TurnResult::Persisted,
                Some("restore_failed"),
                ERROR_NO_REPORT,
                None,
            ),
            (
                TurnResult::Deleted,
                Some(CHAT_DELETED),
                ERROR_TRANSCRIPT_DELETED,
                None,
            ),
        ] {
            let (org, inc) = new_incident(None).await;
            let run_id = start(&org, &inc, RunTrigger::Manual).await;
            // A session whose index row is gone: no events, only the turn record.
            let session = format!("ses-{run_id}");
            with_session(&org, &run_id, &session).await;
            add_turn(
                &org,
                turn(
                    &session,
                    "t1",
                    ai_chat_turns::TURN_FAILED,
                    now - 60_000_000,
                    Some(now),
                    turn_code,
                ),
            )
            .await;

            finalize_rca_run(
                org.clone(),
                run_id.clone(),
                "t1".to_string(),
                TurnEnd {
                    result,
                    committed_seq: ai_chat_sessions::NO_SEQ,
                },
            )
            .await;

            let label = format!("{result:?} {turn_code:?}");
            let run = stored(&org, &run_id).await;
            assert_eq!(run.state, RunState::Failed, "{label}");
            let error = run.error.unwrap();
            assert_eq!(error.code, code, "{label}");
            assert_eq!(error.details.as_deref(), details, "{label}");
            let events = timeline(&org, &inc).await;
            let config::meta::alerts::incidents::IncidentEventType::AIAnalysisFailed {
                error_details,
                ..
            } = failures(&events)[0]
            else {
                unreachable!()
            };
            assert_eq!(
                error_details.as_deref(),
                details,
                "{label}: the event carries them too"
            );
        }
    }
}

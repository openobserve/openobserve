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

//! Slack auto-investigate: the gate's inputs from the state log, and the alert RCA run.

use config::meta::{
    alerts::{
        auto_investigate::{
            AUTO_INVESTIGATE_GATE_SETTING_KEY, BudgetCheck, GATE_WINDOW_SECS, GateSettings,
            WindowStats, window_stats,
        },
        incidents::{IncidentEvent, IncidentEventType},
    },
    oncall::{AnalysisState, AnalysisStatus, agent::AnalysisVerdict},
};
use infra::table::alert_states;
use sea_orm::ConnectionTrait;

const MICROS_PER_SEC: i64 = 1_000_000;
/// An alert with more transitions than this in 7 days is flapping many times over.
const TRANSITIONS_LIMIT: u64 = 5_000;
const DEFAULT_FREQUENCY_SECS: i64 = 60;
/// The `error_code` of a refused turn (chats.rs `turn_limit_response`).
const TURN_LIMIT_CODE: &str = "turn_limit";
/// A `running` row still without a session after this never started its turn.
#[cfg(feature = "enterprise")]
const TURN_START_GRACE_SECS: i64 = 60;
const UNSTATED_CONFIDENCE: &str = "unstated";

/// What the gate reads from OpenObserve for one alert + group, besides the message row.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GateFacts {
    pub stats: WindowStats,
    /// An RCA already holds this firing: incident, page, or another destination's auto run.
    pub rca_running: bool,
    pub settings: GateSettings,
    /// `updated_at` of the settings row in force; `None` = code defaults.
    pub settings_version: Option<i64>,
}

/// The verdict of an agent report, as the alert thread shows it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RcaVerdictView {
    pub probable_cause: String,
    pub confidence: String,
    pub evidence: Vec<(String, Option<String>)>,
}

/// Onsets, evaluations, fire share, settings and the RCA state of one alert + group.
pub async fn gate_facts(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    now: i64,
) -> anyhow::Result<GateFacts> {
    let conn = infra::db::get_orm_client_ro().await;
    let frequency_secs = alert_frequency_secs(conn, org_id, alert_id).await;
    let stats = window_stats_for(conn, alert_id, group_key, frequency_secs, now).await?;
    let (settings, settings_version) = gate_settings(org_id).await;
    Ok(GateFacts {
        stats,
        rca_running: rca_running(org_id, alert_id, firing_started_at).await,
        settings,
        settings_version,
    })
}

/// The trailing 7-day figures from the real transition log and the current state row.
pub async fn window_stats_for<C: ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    group_key: &str,
    frequency_secs: i64,
    now: i64,
) -> anyhow::Result<WindowStats> {
    let window_start = now - GATE_WINDOW_SECS * MICROS_PER_SEC;
    let transitions = alert_states::list_transitions_between_with(
        conn,
        alert_id,
        Some(group_key),
        window_start,
        now,
        TRANSITIONS_LIMIT,
    )
    .await?;
    let current = alert_states::get_with(conn, alert_id, group_key)
        .await?
        .and_then(|s| s.last_outcome);
    Ok(window_stats(
        &transitions,
        current,
        window_start,
        now,
        frequency_secs,
    ))
}

/// The org's gate settings and the version the row logs; a bad stored value counts as unset.
pub async fn gate_settings(org_id: &str) -> (GateSettings, Option<i64>) {
    let found =
        db::system_settings::get_resolved(Some(org_id), None, AUTO_INVESTIGATE_GATE_SETTING_KEY)
            .await;
    match found {
        Ok(Some(row)) => match GateSettings::parse(&row.setting_value) {
            Ok(settings) => (settings, Some(row.updated_at)),
            Err(e) => {
                log::warn!("[SLACK] auto_investigate_gate of {org_id} ignored: {e}");
                (GateSettings::default(), None)
            }
        },
        Ok(None) => (GateSettings::default(), None),
        Err(e) => {
            log::warn!("[SLACK] auto_investigate_gate of {org_id} not read: {e}");
            (GateSettings::default(), None)
        }
    }
}

/// The budget check an agent refusal stands for; a 429 `turn_limit` is the org's run cap.
pub fn budget_check_for(status: u16, body: &str) -> Option<BudgetCheck> {
    let code = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error_code")
                .and_then(|c| c.as_str())
                .map(str::to_string)
        });
    (status == 429 && code.as_deref() == Some(TURN_LIMIT_CODE)).then_some(BudgetCheck::TurnLimit)
}

/// The thread's view of a report: its verdict block, else its first line with no confidence.
pub fn verdict_view(report: &str) -> RcaVerdictView {
    if let Some(v) = verdict_block(report) {
        return RcaVerdictView {
            probable_cause: v.probable_cause,
            confidence: v.confidence.as_str().to_string(),
            evidence: v.evidence.into_iter().map(|e| (e.label, None)).collect(),
        };
    }
    let first = report
        .lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    RcaVerdictView {
        probable_cause: first.to_string(),
        confidence: UNSTATED_CONFIDENCE.to_string(),
        evidence: Vec::new(),
    }
}

/// The incident's last analysis event is a completion at or after the firing began.
pub fn incident_rca_done_since(events: &[IncidentEvent], firing_started_at: i64) -> bool {
    events
        .iter()
        .rev()
        .find(|e| {
            matches!(
                e.event_type,
                IncidentEventType::AIAnalysisBegin
                    | IncidentEventType::AIAnalysisComplete
                    | IncidentEventType::AIAnalysisFailed { .. }
                    | IncidentEventType::AIAnalysisCancelled { .. }
            )
        })
        .is_some_and(|e| {
            matches!(e.event_type, IncidentEventType::AIAnalysisComplete)
                && e.timestamp >= firing_started_at
        })
}

/// A paging analysis completed at or after the firing began; an undated one ties to no firing.
pub fn paging_rca_done_since(analysis: &AnalysisState, firing_started_at: i64) -> bool {
    analysis.status == AnalysisStatus::Complete
        && analysis
            .completed_at
            .is_some_and(|at| at >= firing_started_at)
}

/// `trigger_condition.frequency` of the alert; the default cadence when it cannot be read.
async fn alert_frequency_secs<C: ConnectionTrait>(conn: &C, org_id: &str, alert_id: &str) -> i64 {
    use std::str::FromStr;
    let Ok(id) = svix_ksuid::Ksuid::from_str(alert_id) else {
        return DEFAULT_FREQUENCY_SECS;
    };
    match db::alerts::alert::get_by_id(conn, org_id, id).await {
        Ok(Some((_, alert))) if alert.trigger_condition.frequency > 0 => {
            alert.trigger_condition.frequency
        }
        _ => DEFAULT_FREQUENCY_SECS,
    }
}

#[cfg(not(feature = "enterprise"))]
async fn rca_running(_org_id: &str, _alert_id: &str, _firing_started_at: i64) -> bool {
    false
}

/// A live RCA for the alert or its incident, or one that completed during this firing.
#[cfg(feature = "enterprise")]
async fn rca_running(org_id: &str, alert_id: &str, firing_started_at: i64) -> bool {
    use o2_enterprise::enterprise::oncall::escalation;
    let incident_id = crate::alerts::ack::firing_incident(org_id, alert_id).await;
    if running_run(org_id, alert_id, incident_id.as_deref()).await {
        return true;
    }
    if enterprise::alert_verdict_since(org_id, alert_id, firing_started_at)
        .await
        .is_some()
    {
        return true;
    }
    if let Some(incident_id) = incident_id.as_deref() {
        let events = infra::table::incident_events::get(org_id, incident_id)
            .await
            .unwrap_or_default();
        if incident_rca_done_since(&events, firing_started_at) {
            return true;
        }
    }
    for response in crate::alerts::ack::open_responses(org_id, alert_id).await {
        if escalation::analysis_may_run(org_id, &response.subject).await {
            return true;
        }
        if let Some(analysis) = paging_analysis(org_id, &response.id).await
            && paging_rca_done_since(&analysis, firing_started_at)
        {
            return true;
        }
    }
    false
}

/// A live run on the alert or its incident, by the store's own liveness rule.
#[cfg(feature = "enterprise")]
async fn running_run(org_id: &str, alert_id: &str, incident_id: Option<&str>) -> bool {
    infra::table::rca_runs::list_live_for_alert(org_id, alert_id, incident_id)
        .await
        .unwrap_or_default()
        .iter()
        .any(is_live)
}

/// `waiting_input` is live however old; `running` only until the store calls it stale.
#[cfg(feature = "enterprise")]
fn is_live(row: &infra::table::rca_runs::Model) -> bool {
    use config::meta::alerts::rca_runs::is_live_blocking;
    let timeout = o2_enterprise::enterprise::common::config::get_config()
        .incidents
        .rca_timeout_secs;
    let state = infra::table::rca_runs::to_item(row).state;
    let now = config::utils::time::now_micros();
    if never_started_turn(state, row.session_id.is_some(), row.updated_at, now) {
        return false;
    }
    is_live_blocking(state, row.updated_at, now, timeout)
}

/// A `running` row with no session past the start grace: a withdraw that failed, not a run.
#[cfg(feature = "enterprise")]
fn never_started_turn(
    state: config::meta::alerts::rca_runs::RunState,
    has_session: bool,
    updated_at: i64,
    now: i64,
) -> bool {
    state == config::meta::alerts::rca_runs::RunState::Running
        && !has_session
        && now - updated_at > TURN_START_GRACE_SECS * MICROS_PER_SEC
}

/// The analysis block of a paging record's escalation trigger; `None` before anything ran.
#[cfg(feature = "enterprise")]
async fn paging_analysis(org_id: &str, response_id: &str) -> Option<AnalysisState> {
    use o2_enterprise::enterprise::oncall::escalation::EscalationTriggerData;
    let trigger = infra::scheduler::get(
        org_id,
        config::meta::triggers::TriggerModule::OncallEscalation,
        response_id,
    )
    .await
    .ok()?;
    Some(EscalationTriggerData::read(&trigger.data).analysis)
}

#[cfg(feature = "enterprise")]
pub use enterprise::{running_rca_verdict, start_alert_rca};

#[cfg(feature = "enterprise")]
mod enterprise {
    use std::{future::Future, time::Duration};

    use config::meta::{
        alerts::{
            alert::Alert,
            rca_runs::{RcaRun, RunMode, RunState, RunTrigger},
        },
        oncall::rca_run::RcaRunRecord,
    };
    use o2_enterprise::enterprise::{
        alerts::rca_service,
        common::config::get_config as get_o2_config,
        slack::hooks::{AlertRcaRefusal, AlertRcaRequest, AlertRcaStart, AlertRcaVerdict},
    };

    use super::verdict_view;
    use crate::alerts::{
        rca_runs::{
            self, ERROR_INTERRUPTED, INTERRUPTED_REASON, RunSubject, StartOutcome, StartRun,
        },
        rca_turn::{RcaPrompt, RcaPromptSubject, RcaTurnError, RcaTurnRun, start_rca_turn},
    };

    const POLL: Duration = Duration::from_secs(10);
    /// Past this the thread hears "failed"; the run keeps its own deadline, it is not cancelled.
    const WAIT_LIMIT: Duration = Duration::from_secs(45 * 60);
    /// A row read right after its insert may be missing for this long before it is "gone".
    const GONE_GRACE: Duration = Duration::from_secs(60);
    /// That many failed reads end the wait; fewer wait for the next poll.
    const FAILED_READS_BEFORE_GIVING_UP: u32 = 3;
    const STARTED_BY: &str = "system@openobserve.ai";

    /// The poll's clocks, so a test can run the wait in milliseconds.
    pub(super) struct Clocks {
        pub poll: Duration,
        pub limit: Duration,
        pub grace: Duration,
    }

    /// Admits the run (config, AI usage, credentials, the org's active-run cap) and records it.
    pub async fn start_alert_rca(req: AlertRcaRequest) -> Result<AlertRcaStart, AlertRcaRefusal> {
        let cfg = get_o2_config();
        if !cfg.incidents.rca_enabled || !cfg.ai.enabled || !cfg.ai.has_agent_target() {
            return Err(AlertRcaRefusal::NotConfigured(
                "RCA or the AI agent is not enabled".into(),
            ));
        }
        let (email, _token) = crate::organization::get_sre_agent_credentials(&req.org_id)
            .await
            .map_err(|e| AlertRcaRefusal::Failed(format!("no RCA credentials: {e}")))?;
        authorize(&req.org_id, &email).await?;
        let subject = || RunSubject::Alert {
            alert_id: req.alert_id.clone(),
            incident_id: None,
        };
        let run_id = match rca_runs::start_run(StartRun {
            org_id: req.org_id.clone(),
            subject: subject(),
            trigger: RunTrigger::Manual,
            mode: RunMode::Fresh,
            started_by: STARTED_BY.to_string(),
            guidance: None,
            // The store applies its cooldown to incident subjects only; the gate has its own.
            skip_cooldown: true,
            oncall_subjects: None,
            context_used: None,
        })
        .await
        {
            Ok(StartOutcome::Started { run_id, .. }) => run_id,
            // The store guards incident subjects only; an alert run is admitted below instead.
            Ok(outcome) => {
                return Err(AlertRcaRefusal::Failed(format!(
                    "the run store refused the alert run: {outcome:?}"
                )));
            }
            Err(e) => {
                return Err(AlertRcaRefusal::Failed(format!(
                    "could not record the run: {e}"
                )));
            }
        };
        if let Some(winner) = outranking_live_run(&req.org_id, &req.alert_id, &run_id).await {
            withdraw(&req.org_id, &run_id, &winner).await;
            return Err(AlertRcaRefusal::InFlight);
        }
        let (context, name, stream) = rca_context(&req).await;
        let run = RcaTurnRun {
            org_id: req.org_id.clone(),
            run_id: run_id.clone(),
            subject: subject(),
            trigger: RunTrigger::Manual,
            mode: RunMode::Fresh,
            context: rca_service::rca_context_json(&context),
            session_id: None,
        };
        let prompt = RcaPrompt::Initial {
            trigger: RunTrigger::Manual,
            subject: RcaPromptSubject::Alert { name, stream },
            guidance: None,
        };
        if let Err(e) = start_rca_turn(run, prompt).await {
            let (reason, details) = crate::alerts::incidents::rca_turn_failure(&e);
            if let Err(err) = rca_runs::fail_run(
                &req.org_id,
                &run_id,
                RunTrigger::Manual,
                e.error_code(),
                reason,
                details,
            )
            .await
            {
                log::error!("[ALERTS:SLACK] could not fail alert RCA run {run_id}: {err}");
            }
            return Err(match e {
                RcaTurnError::TurnLimit => AlertRcaRefusal::TurnLimit,
                other => AlertRcaRefusal::Failed(other.error_code().to_string()),
            });
        }
        let (org_id, rid) = (req.org_id.clone(), run_id.clone());
        let verdict = Box::pin(async move { await_run_verdict(&org_id, &rid).await });
        Ok(AlertRcaStart { run_id, verdict })
    }

    /// The verdict of the incident, alert or paging RCA that ran for this firing, once it has one.
    pub async fn running_rca_verdict(
        org_id: &str,
        alert_id: &str,
        firing_started_at: i64,
    ) -> Option<AlertRcaVerdict> {
        if let Some(incident_id) = crate::alerts::ack::firing_incident(org_id, alert_id).await {
            let events = infra::table::incident_events::get(org_id, &incident_id)
                .await
                .unwrap_or_default();
            if super::incident_rca_done_since(&events, firing_started_at)
                && let Ok(Some(report)) =
                    rca_runs::newest_completed_report(org_id, &incident_id).await
            {
                return Some(convert(verdict_view(&report)));
            }
        }
        if let Some(verdict) = alert_verdict_since(org_id, alert_id, firing_started_at).await {
            return Some(verdict);
        }
        for response in crate::alerts::ack::open_responses(org_id, alert_id).await {
            let Some(analysis) = super::paging_analysis(org_id, &response.id).await else {
                continue;
            };
            if !super::paging_rca_done_since(&analysis, firing_started_at) {
                continue;
            }
            if let Some(v) = analysis.verdict {
                return Some(AlertRcaVerdict {
                    probable_cause: v.probable_cause,
                    confidence: v.confidence.as_str().to_string(),
                    evidence: v.evidence.into_iter().map(|e| (e.label, None)).collect(),
                });
            }
        }
        None
    }

    /// The live run ours yields to: any non-automatic run, else the automatic run started first.
    pub(super) async fn outranking_live_run(
        org_id: &str,
        alert_id: &str,
        run_id: &str,
    ) -> Option<String> {
        let incident_id = crate::alerts::ack::firing_incident(org_id, alert_id).await;
        let rows = match infra::table::rca_runs::list_live_for_alert(
            org_id,
            alert_id,
            incident_id.as_deref(),
        )
        .await
        {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[ALERTS:SLACK] run {run_id} starts unchecked: live runs not read: {e}");
                return None;
            }
        };
        let Some(ours) = rows.iter().find(|r| r.run_id == run_id) else {
            log::warn!("[ALERTS:SLACK] run {run_id} starts unchecked: its own row was not read");
            return None;
        };
        rows.iter()
            .filter(|r| r.run_id != run_id && super::is_live(r))
            .find(|r| {
                r.started_by != STARTED_BY
                    || (r.started_at, &r.run_id) < (ours.started_at, &ours.run_id)
            })
            .map(|r| r.run_id.clone())
    }

    /// Ends a run that lost the race before its turn starts; the winner answers the thread.
    pub(super) async fn withdraw(org_id: &str, run_id: &str, winner: &str) -> bool {
        withdraw_with(run_id, || {
            rca_runs::fail_run(
                org_id,
                run_id,
                RunTrigger::Manual,
                ERROR_INTERRUPTED,
                INTERRUPTED_REASON,
                Some(format!("superseded by run {winner}")),
            )
        })
        .await
    }

    /// One retry: a row left `running` would hold the gate until the start grace passes.
    pub(super) async fn withdraw_with<F, Fut>(run_id: &str, mut attempt: F) -> bool
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = anyhow::Result<bool>>,
    {
        for retry in [true, false] {
            match attempt().await {
                Ok(_) => return true,
                Err(e) if retry => {
                    log::warn!("[ALERTS:SLACK] withdrawing run {run_id} failed: {e}; retrying");
                }
                Err(e) => {
                    log::error!("[ALERTS:SLACK] run {run_id} lost its race but stays running: {e}");
                }
            }
        }
        false
    }

    /// The verdict of the alert's newest completed run when it ended during this firing.
    pub(super) async fn alert_verdict_since(
        org_id: &str,
        alert_id: &str,
        firing_started_at: i64,
    ) -> Option<AlertRcaVerdict> {
        let row = infra::table::rca_runs::newest_completed_for_alert(org_id, alert_id)
            .await
            .ok()
            .flatten()?;
        let run = infra::table::rca_runs::to_run(row);
        if run.ended_at? < firing_started_at {
            return None;
        }
        // A finished run with nothing to show is no answer; the gate then runs its own.
        verdict_of_run(run)
    }

    /// Polls the run's row until it ends: the leader wants one answer per run, not the stream.
    pub(super) async fn await_run_verdict(
        org_id: &str,
        run_id: &str,
    ) -> Result<AlertRcaVerdict, String> {
        // Read on the primary: the row was just inserted there and a replica may lag.
        let lookup = || async move {
            infra::table::rca_runs::get_rw(org_id, run_id)
                .await
                .map(|row| row.map(infra::table::rca_runs::to_run))
                .map_err(|e| format!("run {run_id} lookup failed: {e}"))
        };
        let clocks = Clocks {
            poll: POLL,
            limit: WAIT_LIMIT,
            grace: GONE_GRACE,
        };
        await_verdict_with(lookup, clocks).await
    }

    /// A missing row inside `grace` and a few failed reads in a row wait for the next poll.
    pub(super) async fn await_verdict_with<F, Fut>(
        mut lookup: F,
        clocks: Clocks,
    ) -> Result<AlertRcaVerdict, String>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<Option<RcaRun>, String>>,
    {
        let started = tokio::time::Instant::now();
        let mut failed_reads = 0u32;
        loop {
            match lookup().await {
                Ok(Some(run)) => {
                    failed_reads = 0;
                    if let Some(ended) = run_outcome(run) {
                        return ended;
                    }
                }
                Ok(None) if started.elapsed() < clocks.grace => {}
                Ok(None) => return Err("the run is gone".to_string()),
                Err(e) => {
                    failed_reads += 1;
                    if failed_reads >= FAILED_READS_BEFORE_GIVING_UP {
                        return Err(e);
                    }
                    log::warn!("[ALERTS:SLACK] {e}; polling again");
                }
            }
            if started.elapsed() > clocks.limit {
                return Err(format!(
                    "the run did not finish within {} min",
                    clocks.limit.as_secs() / 60
                ));
            }
            tokio::time::sleep(clocks.poll).await;
        }
    }

    /// `Some` once the run is over: its verdict, or why there is none.
    fn run_outcome(run: RcaRun) -> Option<Result<AlertRcaVerdict, String>> {
        let now = config::utils::time::now_micros();
        if super::never_started_turn(run.state, run.session_id.is_some(), run.updated_at, now) {
            return Some(Err("the run never started its turn".to_string()));
        }
        Some(match run.state {
            RunState::Completed => {
                verdict_of_run(run).ok_or_else(|| "the run completed without a report".to_string())
            }
            RunState::Failed => Err(run
                .error
                .map(|e| e.reason)
                .unwrap_or_else(|| "the run failed".to_string())),
            RunState::Cancelled => Err("the run was cancelled".to_string()),
            RunState::Running | RunState::WaitingInput => return None,
        })
    }

    /// The run's graded verdict when it recorded one, else what its report says.
    fn verdict_of_run(run: RcaRun) -> Option<AlertRcaVerdict> {
        let record: Option<RcaRunRecord> = run.result.and_then(|v| serde_json::from_value(v).ok());
        if let Some(v) = record.as_ref().and_then(|r| r.verdict.as_ref()) {
            let confidence = run
                .confidence
                .clone()
                .unwrap_or_else(|| v.confidence.as_str().to_string());
            return Some(AlertRcaVerdict {
                probable_cause: v.probable_cause.clone(),
                confidence,
                evidence: v.evidence.iter().map(|e| (e.label.clone(), None)).collect(),
            });
        }
        let report = run.report.filter(|r| !r.trim().is_empty())?;
        Some(convert(verdict_view(&report)))
    }

    /// The same context the paging RCA builds, for an alert subject with no incident.
    async fn rca_context(
        req: &AlertRcaRequest,
    ) -> (config::meta::oncall::RcaContext, String, String) {
        use std::str::FromStr;
        let alert = match svix_ksuid::Ksuid::from_str(&req.alert_id) {
            Ok(id) => {
                db::alerts::alert::get_by_id(infra::db::get_orm_client_ro().await, &req.org_id, id)
                    .await
                    .ok()
                    .flatten()
                    .map(|(_, a)| a)
            }
            Err(_) => None,
        };
        context_of(req, alert.as_ref())
    }

    /// [rca_context] without the lookup; the prompt names the id when the alert row is gone.
    pub(super) fn context_of(
        req: &AlertRcaRequest,
        alert: Option<&Alert>,
    ) -> (config::meta::oncall::RcaContext, String, String) {
        let dimensions: serde_json::Map<String, serde_json::Value> = req
            .group_labels
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        let name = alert.map(|a| a.name.clone());
        let stream = alert.map(|a| a.stream_name.clone());
        let context = config::meta::oncall::RcaContext {
            subject_type: config::meta::oncall::SubjectType::Alert,
            subject_id: req.alert_id.clone(),
            incident_id: None,
            org_id: req.org_id.clone(),
            previous_analysis: None,
            severity: alert.and_then(|a| a.priority),
            past_causes: Vec::new(),
            alert_name: name.clone(),
            stream: stream.clone(),
            dimensions: (!dimensions.is_empty()).then_some(serde_json::Value::Object(dimensions)),
        };
        (
            context,
            name.unwrap_or_else(|| req.alert_id.clone()),
            stream.unwrap_or_default(),
        )
    }

    fn convert(v: super::RcaVerdictView) -> AlertRcaVerdict {
        AlertRcaVerdict {
            probable_cause: v.probable_cause,
            confidence: v.confidence,
            evidence: v.evidence,
        }
    }

    /// Cloud meters the run like a web AI chat turn; self-hosted has no AI budget to check.
    #[cfg(feature = "cloud")]
    async fn authorize(org_id: &str, email: &str) -> Result<(), AlertRcaRefusal> {
        let ctx = crate::trial_quota::AiUsageContext {
            user_email: email.to_string(),
            ..Default::default()
        };
        crate::trial_quota::authorize_ai_usage(
            org_id,
            crate::trial_quota::TrialQuotaFeature::AiChat,
            &ctx,
        )
        .await
        .map(|_| ())
        .map_err(|e| AlertRcaRefusal::AiUsageRefused(e.to_string()))
    }

    #[cfg(not(feature = "cloud"))]
    async fn authorize(_org_id: &str, _email: &str) -> Result<(), AlertRcaRefusal> {
        Ok(())
    }
}

/// The report's last ```json verdict``` fence when it parses; a bad block is no verdict.
fn verdict_block(report: &str) -> Option<AnalysisVerdict> {
    let body = last_verdict_block(report)?;
    serde_json::from_str(&body)
        .inspect_err(|e| log::warn!("[ALERTS:SLACK] report verdict block did not parse: {e}"))
        .ok()
}

/// The last fence wins: an agent that re-ran and emitted a second block leaves one answer.
fn last_verdict_block(report: &str) -> Option<String> {
    let mut found: Option<String> = None;
    let mut open: Option<Vec<&str>> = None;
    for line in report.lines() {
        match &mut open {
            None => {
                if let Some(info) = line.trim().strip_prefix("```")
                    && info.split_whitespace().collect::<Vec<_>>() == ["json", "verdict"]
                {
                    open = Some(Vec::new());
                }
            }
            Some(body) => {
                if line.trim_start().starts_with("```") {
                    found = Some(body.join("\n"));
                    open = None;
                } else {
                    body.push(line);
                }
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{
            auto_investigate::{
                BudgetCheck, Decision, GateInputs, MarkLookup, ReasonCode, decide_auto_investigate,
            },
            level::AlertLevel,
            state::{AlertState, StateTransition, StateUpdate},
        },
        self_reporting::usage::RunOutcome,
    };
    use infra::table::{alert_states, entity};
    use sea_orm::{Database, DatabaseConnection, Schema};

    use super::*;

    const HOUR: i64 = 3600 * MICROS_PER_SEC;
    const NOW: i64 = 1_761_000_000_000_000;

    /// A firing evaluation `at`, written the way the scheduler persists a changed outcome.
    fn update(alert_id: &str, at: i64, to: RunOutcome, from: Option<RunOutcome>) -> StateUpdate {
        StateUpdate {
            state: Some(AlertState {
                alert_id: alert_id.into(),
                group_key: "cluster=prod-eu".into(),
                last_outcome: Some(to.clone()),
                last_outcome_at: Some(at),
                since: Some(at),
                level: Some(AlertLevel::Critical),
                level_since: Some(at),
                level_at: Some(at),
                last_seen: Some(at),
                group_labels: None,
                groups_observed: None,
                groups_firing: None,
                groups_observed_is_lower_bound: None,
                groups_firing_is_lower_bound: None,
                silenced_until: None,
                last_notified_level: None,
                episode_id: None,
                episode_opened_at: None,
                episode_incident_id: None,
                recovering_since: None,
                firing_started_at: to.is_firing().then_some(at),
            }),
            transition: Some(StateTransition {
                alert_id: alert_id.into(),
                group_key: "cluster=prod-eu".into(),
                from_outcome: from,
                to_outcome: to,
                from_level: None,
                to_level: Some(AlertLevel::Critical),
                at,
                value: None,
                rule_value: None,
                group_labels: None,
            }),
        }
    }

    /// The state tables as the entities declare them; no fixture helper of infra is public.
    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(entity::alert_states::Entity),
            schema.create_table_from_entity(entity::alert_state_transitions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn inputs(stats: WindowStats, last_run: Option<i64>) -> GateInputs {
        GateInputs {
            is_new_fire: true,
            level: Some(AlertLevel::Critical),
            rca_running: false,
            last_auto_investigated_at: last_run,
            protected: false,
            mark_lookup: MarkLookup::NotChecked,
            onsets_7d: stats.onsets,
            evaluations_7d: stats.evaluations,
            fire_share_7d: stats.fire_share,
            budget: BudgetCheck::Allowed,
            now: NOW,
            settings: GateSettings::default(),
            settings_version: None,
        }
    }

    #[tokio::test]
    async fn real_transitions_of_a_flapping_alert_give_the_flapping_reason() {
        let db = db().await;
        let mut from = None;
        for i in 0..15 {
            let at = NOW - (6 * 24 - 2 * i) * HOUR;
            let fire = update("a-flap", at, RunOutcome::Firing, from.clone());
            alert_states::persist_with(&db, &fire, None).await.unwrap();
            let clear = update(
                "a-flap",
                at + HOUR / 2,
                RunOutcome::Normal,
                Some(RunOutcome::Firing),
            );
            alert_states::persist_with(&db, &clear, None).await.unwrap();
            from = Some(RunOutcome::Normal);
        }
        let stats = window_stats_for(&db, "a-flap", "cluster=prod-eu", 60, NOW)
            .await
            .unwrap();
        assert_eq!(stats.onsets, 15, "{stats:?}");
        assert!(stats.fire_share < 0.2, "{stats:?}");
        let d: Decision = decide_auto_investigate(&inputs(stats, Some(NOW - 5 * HOUR)));
        assert_eq!(d.reason, ReasonCode::Flapping);
        assert!(!d.run);
        assert_eq!(d.cooldown_applied_secs, Some(86_400));
        let quiet = window_stats_for(&db, "a-quiet", "cluster=prod-eu", 60, NOW)
            .await
            .unwrap();
        assert_eq!(quiet, WindowStats::default());
        let fresh = decide_auto_investigate(&inputs(quiet, Some(NOW - 5 * HOUR)));
        assert_eq!(
            fresh.reason,
            ReasonCode::Eligible,
            "no onsets: the 4 h cooldown has passed"
        );
    }

    #[test]
    fn only_a_429_turn_limit_is_the_run_cap() {
        assert_eq!(
            budget_check_for(429, r#"{"error_code":"turn_limit","message":"busy"}"#),
            Some(BudgetCheck::TurnLimit)
        );
        assert_eq!(budget_check_for(429, r#"{"detail":"rate limited"}"#), None);
        assert_eq!(
            budget_check_for(503, r#"{"error_code":"turn_limit"}"#),
            None
        );
        assert_eq!(budget_check_for(429, "not json"), None);
    }

    #[test]
    fn a_report_shows_its_verdict_block_else_its_first_line() {
        let report = "# RCA\n\nFDs climbing.\n\n```json verdict\n{\"probable_cause\": \"fd leak in querier v0.14.2\", \"confidence\": \"high\", \"evidence\": [{\"number\": 1, \"label\": \"restarts\"}, {\"number\": 2, \"label\": \"no link\"}], \"page_recommendation\": {\"action\": \"page\", \"reason\": \"r\"}, \"report_ref\": \"a/1\"}\n```\n";
        let v = verdict_view(report);
        assert_eq!(v.probable_cause, "fd leak in querier v0.14.2");
        assert_eq!(v.confidence, "high");
        assert_eq!(
            v.evidence,
            vec![
                ("restarts".to_string(), None),
                ("no link".to_string(), None)
            ]
        );
        let plain = verdict_view("\n## Checkout errors\nThe deploy at 02:11 broke it.\n");
        assert_eq!(plain.probable_cause, "Checkout errors");
        assert_eq!(plain.confidence, UNSTATED_CONFIDENCE);
        assert!(plain.evidence.is_empty());
    }

    #[test]
    fn an_incident_rca_counts_for_the_firing_only_when_its_last_run_completed_after_it_began() {
        use config::meta::alerts::incidents::{AnalysisTriggerType, IncidentEvent};
        let at = |mut e: IncidentEvent, t: i64| {
            e.timestamp = t;
            e
        };
        let done = vec![
            at(IncidentEvent::ai_analysis_begin(), NOW - 3 * HOUR),
            at(IncidentEvent::ai_analysis_complete(), NOW - 2 * HOUR),
        ];
        assert!(incident_rca_done_since(&done, NOW - 4 * HOUR));
        assert!(
            !incident_rca_done_since(&done, NOW - HOUR),
            "finished before this firing began"
        );
        let mut rerun = done.clone();
        rerun.push(at(IncidentEvent::ai_analysis_begin(), NOW - HOUR / 2));
        assert!(
            !incident_rca_done_since(&rerun, NOW - 4 * HOUR),
            "a newer run is in flight"
        );
        let mut failed = done.clone();
        failed.push(at(
            IncidentEvent::ai_analysis_failed("timeout", AnalysisTriggerType::Manual, None),
            NOW - HOUR / 2,
        ));
        assert!(!incident_rca_done_since(&failed, NOW - 4 * HOUR));
        assert!(!incident_rca_done_since(&[], NOW - HOUR));
    }

    #[test]
    fn a_paging_rca_counts_for_the_firing_only_when_complete_at_or_after_it_began() {
        use config::meta::oncall::{AnalysisState, AnalysisStatus};
        let done = AnalysisState {
            status: AnalysisStatus::Complete,
            verdict: None,
            grade: None,
            requested_at: Some(NOW - HOUR),
            completed_at: Some(NOW - HOUR / 2),
        };
        assert!(paging_rca_done_since(&done, NOW - HOUR / 2));
        assert!(!paging_rca_done_since(&done, NOW));
        let pending = AnalysisState {
            status: AnalysisStatus::Pending,
            completed_at: None,
            ..done.clone()
        };
        assert!(!paging_rca_done_since(&pending, NOW - HOUR));
        let undated = AnalysisState {
            completed_at: None,
            ..done
        };
        assert!(
            !paging_rca_done_since(&undated, NOW - HOUR),
            "no completion time ties it to no firing"
        );
    }

    #[cfg(feature = "enterprise")]
    mod runs {
        use std::{
            sync::{
                Arc,
                atomic::{AtomicUsize, Ordering},
            },
            time::Duration,
        };

        use config::meta::alerts::rca_runs::{
            RcaRun, RunMode, RunState, RunTrigger, stale_threshold_us,
        };
        use infra::table::rca_runs::RunUpdate;
        use o2_enterprise::enterprise::slack::hooks::AlertRcaRequest;

        use super::super::{
            enterprise::{
                Clocks, alert_verdict_since, await_run_verdict, await_verdict_with, context_of,
                outranking_live_run, withdraw, withdraw_with,
            },
            *,
        };
        use crate::alerts::rca_runs::{
            self, ERROR_INTERRUPTED, RunSubject, StartOutcome, StartRun,
            tests::{add_incident, age, db, start as start_incident_run},
        };

        const AUTO: &str = "system@openobserve.ai";
        const MS: Duration = Duration::from_millis(1);

        const REPORT: &str = "# RCA\n\nFDs climbing.\n\n```json verdict\n{\"probable_cause\": \"fd leak in querier v0.14.2\", \"confidence\": \"high\", \"evidence\": [{\"number\": 1, \"label\": \"restarts\"}], \"page_recommendation\": {\"action\": \"page\", \"reason\": \"r\"}, \"report_ref\": \"a/1\"}\n```\n";

        fn org() -> String {
            format!(
                "gate_{}",
                infra::table::rca_runs::new_run_id().to_lowercase()
            )
        }

        async fn started(org: &str, alert_id: &str, trigger: RunTrigger) -> String {
            started_by(org, alert_id, trigger, "system").await
        }

        async fn started_by(org: &str, alert_id: &str, trigger: RunTrigger, who: &str) -> String {
            let outcome = rca_runs::start_run(StartRun {
                org_id: org.to_string(),
                subject: RunSubject::Alert {
                    alert_id: alert_id.to_string(),
                    incident_id: None,
                },
                trigger,
                mode: RunMode::Fresh,
                started_by: who.to_string(),
                guidance: None,
                skip_cooldown: true,
                oncall_subjects: None,
                context_used: None,
            })
            .await
            .unwrap();
            match outcome {
                StartOutcome::Started { run_id } => run_id,
                other => panic!("the alert run did not start: {other:?}"),
            }
        }

        async fn stored(org: &str, run_id: &str) -> RcaRun {
            infra::table::rca_runs::to_run(
                infra::table::rca_runs::get_rw(org, run_id)
                    .await
                    .unwrap()
                    .unwrap(),
            )
        }

        fn clocks(grace: Duration) -> Clocks {
            Clocks {
                poll: MS,
                limit: Duration::from_secs(5),
                grace,
            }
        }

        fn past_stale_secs() -> i64 {
            let timeout = o2_enterprise::enterprise::common::config::get_config()
                .incidents
                .rca_timeout_secs;
            stale_threshold_us(timeout) / MICROS_PER_SEC + 1
        }

        #[tokio::test]
        async fn a_live_run_holds_the_gate_until_it_goes_stale_but_a_waiting_run_holds_it_on() {
            let _db = db().await;
            let org = org();
            let run_id = started(&org, "al_live", RunTrigger::OncallPage).await;
            assert!(running_run(&org, "al_live", None).await);
            assert!(!running_run(&org, "al_other", None).await);
            age(&org, "no-incident", &run_id, past_stale_secs()).await;
            assert!(
                !running_run(&org, "al_live", None).await,
                "a row its node abandoned holds nothing once the store calls it stale"
            );
            let waiting = started(&org, "al_wait", RunTrigger::Manual).await;
            let patch = RunUpdate {
                state: Some(RunState::WaitingInput),
                ..Default::default()
            };
            assert!(rca_runs::update_run(&org, &waiting, patch).await.unwrap());
            age(&org, "no-incident", &waiting, past_stale_secs()).await;
            assert!(
                running_run(&org, "al_wait", None).await,
                "a run waiting on responders is live however long it waits"
            );
        }

        #[tokio::test]
        async fn a_run_that_ended_during_the_firing_holds_the_gate_and_lends_its_verdict() {
            let _db = db().await;
            let org = org();
            let run_id = started(&org, "al_done", RunTrigger::Manual).await;
            assert!(
                rca_runs::complete_run(&org, &run_id, REPORT, RunUpdate::default())
                    .await
                    .unwrap()
            );
            let ended = infra::table::rca_runs::get(&org, &run_id)
                .await
                .unwrap()
                .unwrap()
                .ended_at
                .unwrap();
            assert!(rca_running(&org, "al_done", ended - 1).await);
            assert!(
                !rca_running(&org, "al_done", ended + 1).await,
                "finished before this firing began"
            );
            let verdict = running_rca_verdict(&org, "al_done", ended - 1)
                .await
                .expect("the finished run's verdict");
            assert_eq!(verdict.probable_cause, "fd leak in querier v0.14.2");
            assert_eq!(verdict.evidence, vec![("restarts".to_string(), None)]);
            assert!(
                running_rca_verdict(&org, "al_done", ended + 1)
                    .await
                    .is_none()
            );
        }

        #[tokio::test]
        async fn a_completed_run_without_a_report_is_no_answer_so_the_gate_runs_its_own() {
            let _db = db().await;
            let org = org();
            let run_id = started(&org, "al_empty", RunTrigger::OncallPage).await;
            assert!(
                rca_runs::complete_run(&org, &run_id, " \n", RunUpdate::default())
                    .await
                    .unwrap()
            );
            let ended = stored(&org, &run_id).await.ended_at.unwrap();
            assert!(
                alert_verdict_since(&org, "al_empty", ended - 1)
                    .await
                    .is_none()
            );
            assert!(!rca_running(&org, "al_empty", ended - 1).await);
            assert!(
                running_rca_verdict(&org, "al_empty", ended - 1)
                    .await
                    .is_none()
            );
        }

        #[tokio::test]
        async fn an_automatic_run_yields_to_any_other_live_run_and_to_an_earlier_automatic_one() {
            let _db = db().await;
            let org = org();
            let paging = started(&org, "al_race", RunTrigger::OncallPage).await;
            let auto = started_by(&org, "al_race", RunTrigger::Manual, AUTO).await;
            assert_eq!(
                outranking_live_run(&org, "al_race", &auto).await.as_deref(),
                Some(paging.as_str()),
                "a paging run that landed first wins however it is ordered"
            );
            let first = started_by(&org, "al_twice", RunTrigger::Manual, AUTO).await;
            let second = started_by(&org, "al_twice", RunTrigger::Manual, AUTO).await;
            assert_eq!(outranking_live_run(&org, "al_twice", &first).await, None);
            assert_eq!(
                outranking_live_run(&org, "al_twice", &second)
                    .await
                    .as_deref(),
                Some(first.as_str()),
                "of two automatic runs the later one yields"
            );
            age(&org, "no-incident", &first, past_stale_secs()).await;
            assert_eq!(
                outranking_live_run(&org, "al_twice", &second).await,
                None,
                "a stale winner no longer counts"
            );
            withdraw(&org, &second, &first).await;
            let run = stored(&org, &second).await;
            assert_eq!(run.state, RunState::Failed);
            let error = run.error.unwrap();
            assert_eq!(error.code, ERROR_INTERRUPTED);
            assert_eq!(
                error.details.as_deref(),
                Some(format!("superseded by run {first}").as_str())
            );
            assert_eq!(
                outranking_live_run(&org, "al_twice", &second).await,
                None,
                "a withdrawn run is not live and asks nothing"
            );
        }

        #[tokio::test]
        async fn the_verdict_wait_outlasts_a_missing_row_and_a_failed_read_but_not_for_ever() {
            let _db = db().await;
            let org = org();
            let run_id = started_by(&org, "al_wait", RunTrigger::Manual, AUTO).await;
            assert!(
                rca_runs::complete_run(&org, &run_id, REPORT, RunUpdate::default())
                    .await
                    .unwrap()
            );
            let calls = Arc::new(AtomicUsize::new(0));
            let lookup = || {
                let (org, run_id, calls) = (org.clone(), run_id.clone(), calls.clone());
                async move {
                    match calls.fetch_add(1, Ordering::SeqCst) {
                        0 => Err("a blip".to_string()),
                        1 => Ok(None),
                        _ => Ok(Some(stored(&org, &run_id).await)),
                    }
                }
            };
            let verdict = await_verdict_with(lookup, clocks(Duration::from_secs(5)))
                .await
                .expect("the verdict after a blip and a lagging read");
            assert_eq!(verdict.probable_cause, "fd leak in querier v0.14.2");
            assert_eq!(calls.load(Ordering::SeqCst), 3);

            let gone = await_verdict_with(|| async { Ok(None) }, clocks(Duration::ZERO)).await;
            assert_eq!(gone, Err("the run is gone".to_string()));

            let reads = Arc::new(AtomicUsize::new(0));
            let failing = || {
                let reads = reads.clone();
                async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    Err("down".to_string())
                }
            };
            let down = await_verdict_with(failing, clocks(Duration::from_secs(5))).await;
            assert_eq!(down, Err("down".to_string()));
            assert_eq!(
                reads.load(Ordering::SeqCst),
                3,
                "three reads in a row, then give up"
            );
        }

        #[tokio::test]
        async fn an_automatic_run_yields_to_a_live_run_of_the_alerts_incident() {
            use infra::table::entity::alert_incident_alerts;
            use sea_orm::{EntityTrait as _, Set};
            let _db = db().await;
            let org = org();
            let incident = add_incident(&org, None).await;
            let link = alert_incident_alerts::ActiveModel {
                incident_id: Set(incident.clone()),
                alert_id: Set("al_inc".to_string()),
                alert_fired_at: Set(1),
                alert_name: Set("checkout errors".to_string()),
                alert_kind: Set("alert".to_string()),
                correlation_reason: Set(None),
                created_at: Set(1),
                resolved_at: Set(None),
            };
            alert_incident_alerts::Entity::insert(link)
                .exec(infra::db::get_orm_client_rw().await)
                .await
                .unwrap();
            let incident_run =
                start_incident_run(&org, &incident, RunTrigger::AutoNewIncident).await;
            assert!(running_run(&org, "al_inc", Some(&incident)).await);
            let auto = started_by(&org, "al_inc", RunTrigger::Manual, AUTO).await;
            assert_eq!(
                outranking_live_run(&org, "al_inc", &auto).await.as_deref(),
                Some(incident_run.as_str()),
                "the gate and the yield see the same live incident run"
            );
        }

        #[tokio::test]
        async fn a_withdraw_is_retried_once_and_then_given_up() {
            let tries = Arc::new(AtomicUsize::new(0));
            let flaky = || {
                let tries = tries.clone();
                async move {
                    match tries.fetch_add(1, Ordering::SeqCst) {
                        0 => Err(anyhow::anyhow!("deadlock")),
                        _ => Ok(true),
                    }
                }
            };
            assert!(withdraw_with("run-1", flaky).await);
            assert_eq!(tries.load(Ordering::SeqCst), 2);
            let down = Arc::new(AtomicUsize::new(0));
            let failing = || {
                let down = down.clone();
                async move {
                    down.fetch_add(1, Ordering::SeqCst);
                    Err(anyhow::anyhow!("down"))
                }
            };
            assert!(!withdraw_with("run-2", failing).await);
            assert_eq!(down.load(Ordering::SeqCst), 2, "one retry, then give up");
        }

        #[tokio::test]
        async fn the_leaders_verdict_wait_returns_a_completed_run_on_its_first_read() {
            let _db = db().await;
            let org = org();
            let run_id = started_by(&org, "al_done", RunTrigger::Manual, AUTO).await;
            assert!(
                rca_runs::complete_run(&org, &run_id, REPORT, RunUpdate::default())
                    .await
                    .unwrap()
            );
            let began = std::time::Instant::now();
            let verdict = await_run_verdict(&org, &run_id)
                .await
                .expect("the completed run's verdict");
            assert_eq!(verdict.probable_cause, "fd leak in querier v0.14.2");
            assert!(
                began.elapsed() < Duration::from_secs(5),
                "no poll before the first read"
            );
        }

        #[tokio::test]
        async fn a_running_row_that_never_got_its_turn_holds_neither_the_gate_nor_the_wait() {
            let _db = db().await;
            let org = org();
            let stuck = started_by(&org, "al_stuck", RunTrigger::Manual, AUTO).await;
            assert!(
                running_run(&org, "al_stuck", None).await,
                "fresh: within the start grace"
            );
            age(&org, "no-incident", &stuck, TURN_START_GRACE_SECS + 1).await;
            assert!(!running_run(&org, "al_stuck", None).await);
            let next = started_by(&org, "al_stuck", RunTrigger::Manual, AUTO).await;
            assert_eq!(outranking_live_run(&org, "al_stuck", &next).await, None);
            let (org_, stuck_) = (org.clone(), stuck.clone());
            let lookup = move || {
                let (org, run_id) = (org_.clone(), stuck_.clone());
                async move { Ok(Some(stored(&org, &run_id).await)) }
            };
            let began = std::time::Instant::now();
            let ended = await_verdict_with(lookup, clocks(Duration::from_secs(5))).await;
            assert_eq!(ended, Err("the run never started its turn".to_string()));
            assert!(
                began.elapsed() < Duration::from_secs(1),
                "ends at once, not after the limit"
            );
        }

        #[test]
        fn the_prompt_names_the_alert_id_when_its_row_is_gone_but_the_context_does_not() {
            let req = AlertRcaRequest {
                org_id: "default".into(),
                alert_id: "3L5gone".into(),
                group_key: "cluster=prod".into(),
                firing_started_at: 1,
                group_labels: vec![("cluster".into(), "prod".into())],
            };
            let (context, name, stream) = context_of(&req, None);
            assert_eq!((context.alert_name, context.stream), (None, None));
            assert_eq!((name.as_str(), stream.as_str()), ("3L5gone", ""));
            assert_eq!(context.dimensions.unwrap()["cluster"], "prod");
        }
    }
}

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

//! An AutoResolve run's agent turns: planning, executing, the one retry of a check, and settling
//! the run when a turn ends without moving it on.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::Duration,
};

use config::{
    meta::autoresolve::{RunState, StepState, TriggerKind, redact_secrets, result_text},
    utils::redact::redact_internal_details,
};
use infra::table::{
    autoresolve_corrections,
    autoresolve_runs::{self as runs_table, RunPatch},
    autoresolve_steps,
    entity::{
        autoresolve_corrections::Model as CorrectionRow, autoresolve_runs::Model as RunRow,
        autoresolve_steps::Model as StepRow,
    },
    org_ai_toolsets::{self, OrgToolset},
};
use o2_enterprise::enterprise::{
    ai::{
        chat::{
            OnCommit, PersistSettings, TurnCaps, TurnEnd, TurnIdentity, TurnResult, TurnSpec,
            batcher::DurableEvent, spawn_headless_turn,
        },
        client::{AUTORESOLVE_AGENT_TYPE, QueryRequest, SESSION_ID_HEADER, get_agent_client},
        toolsets::{
            McpEntry,
            push::{autoresolve_entries, normalize_tool_name},
        },
    },
    autoresolve::token::mint,
    common::config::get_config as get_o2_config,
};
use regex::Regex;
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::{Value, json};
use tokio::{sync::mpsc, time::Instant};

use super::{
    AutoResolveError, after_transition, approve, chosen_steps, json_or_text, live::MCP_KIND,
    mark_not_run, run_connection_ids, token_ttl_secs, transition_with, trigger_label,
    turn_deadline_us,
};
use crate::ai_chat::{
    StreamChatStore,
    admission::{self, AdmitError, AdmittedTurn},
    cancel::cancel_chat_turn,
};

/// How often a running turn re-reads its run to notice that the run ended under it.
const CHECK_INTERVAL: Duration = Duration::from_secs(5);
const CANCEL_TOKEN_TTL_SECS: i64 = 60;
/// Longest part of the turn's own error a failure sentence quotes.
const MAX_TURN_ERROR_CHARS: usize = 160;
/// Nobody can retry a triggered run from Slack, so its refusal names what does start one.
const TRIGGERED_RETRY: &str = "It runs again the next time its trigger fires, or use Run now.";
/// The cancelled turn holds the run's session through its cancel grace and final flush; the
/// check retry waits that long and this much more.
const CHECK_ADMIT_MARGIN: Duration = Duration::from_secs(5);
const CHECK_ADMIT_PAUSE: Duration = Duration::from_secs(1);
/// Why a check ended unfinished, when its turn gave no error of its own.
const CHECK_NO_REPORT: &str = "the AI model ended the check without reporting an outcome";
pub(super) const CHECK_TIMED_OUT: &str = "the AI model did not answer in time";
/// A turn past its deadline, whether the sweep or the turn's own timeout ended it.
pub(super) const TURN_TIMED_OUT: &str = "The AI model did not answer in time.";
/// Our own and o2-ai's failure sentences open with it, so they need no lead-in.
const MODEL_SUBJECT: &str = "The AI model";
const CHECK_NOT_STARTED: &str = "the AI service could not start the check";
/// How many earlier corrections a planning turn reads.
const CONTEXT_CORRECTIONS: usize = 5;
/// How far back a run no alert started looks from its start.
const RUN_LOOK_BACK_MINUTES: i64 = 30;
/// An alert run looks back twice the alert's period, within these bounds.
const ALERT_LOOK_BACK_MINUTES: (i64, i64) = (15, 120);
/// A redacted path or endpoint, with the word that leads into it; its placeholder reads like an
/// unfilled template.
static REDACTED_FRAGMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\s+(?:at|via|from|to|in|on))?\s*\[internal (?:path|endpoint)\]")
        .expect("valid pattern")
});

/// Which turn of a run: the one that plans, the one that runs the approved steps, or the one
/// retry of a check that did not finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Phase {
    Plan,
    Execute,
    Check,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Execute => "execute",
            Self::Check => "check",
        }
    }
}

/// The run as its turn launched. Every launch sets a fresh `turn_deadline_us`, so any change
/// means a later turn, a hold or a replan owns the run now.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TurnClaim {
    revision: i32,
    plan_fingerprint: Option<String>,
    turn_deadline_us: Option<i64>,
}

impl TurnClaim {
    fn of(run: &RunRow) -> Self {
        Self {
            revision: run.revision,
            plan_fingerprint: run.plan_fingerprint.clone(),
            turn_deadline_us: run.turn_deadline_us,
        }
    }

    fn still_owns(&self, run: &RunRow) -> bool {
        *self == Self::of(run)
    }
}

/// An org toolset as listed: id, name and description.
pub(super) type Listed = (String, String, Option<String>);

/// What a turn's context carries beyond the run row: the org's connections the run lacks, by
/// key and description, and the corrections it should heed.
#[derive(Debug, Default)]
struct TurnExtras {
    not_connected: Vec<(String, Option<String>)>,
    corrections: Vec<CorrectionRow>,
    /// After approval: other runs' changes to the run's MCPs since its plan.
    changed: Vec<StepRow>,
}

/// Launches and cancels a run's turns; tests pass a recording fake.
#[async_trait::async_trait]
pub(crate) trait TurnLauncher: Send + Sync {
    async fn planning(&self, run: &RunRow, note: Option<&str>) -> Result<(), AutoResolveError>;
    async fn execute(&self, run: &RunRow, steps: &[StepRow]) -> Result<(), AutoResolveError>;
    async fn check(&self, run: &RunRow, steps: &[StepRow]) -> Result<(), AutoResolveError>;
    async fn cancel(&self, run: &RunRow);
}

/// The production [TurnLauncher]: real agent turns.
pub(crate) struct LiveTurns;

#[async_trait::async_trait]
impl TurnLauncher for LiveTurns {
    async fn planning(&self, run: &RunRow, note: Option<&str>) -> Result<(), AutoResolveError> {
        spawn_planning_turn(run, note, false).await
    }

    async fn execute(&self, run: &RunRow, steps: &[StepRow]) -> Result<(), AutoResolveError> {
        spawn_execute_turn(run, steps).await
    }

    async fn check(&self, run: &RunRow, steps: &[StepRow]) -> Result<(), AutoResolveError> {
        spawn_check_turn(run, steps).await
    }

    async fn cancel(&self, run: &RunRow) {
        cancel_turn(run).await;
    }
}

/// The turn that proposes a plan; `note` is the person's replan request, and `first_start`
/// is true only for the run's first turn, which a person can still retry.
pub(crate) async fn spawn_planning_turn(
    run: &RunRow,
    note: Option<&str>,
    first_start: bool,
) -> Result<(), AutoResolveError> {
    spawn_turn(run, Phase::Plan, note, &[], first_start).await
}

/// The turn that makes the approved calls, in order, through the consume check.
pub(crate) async fn spawn_execute_turn(
    run: &RunRow,
    steps: &[StepRow],
) -> Result<(), AutoResolveError> {
    spawn_turn(run, Phase::Execute, None, steps, false).await
}

/// The retried check: it reads what the approved steps did and reports the outcome.
pub(crate) async fn spawn_check_turn(
    run: &RunRow,
    steps: &[StepRow],
) -> Result<(), AutoResolveError> {
    spawn_turn(run, Phase::Check, None, steps, false).await
}

/// The MCP tools of the run's chosen connections that still exist;
/// [AutoResolveError::NoConnections] when none does. Only the chosen ones are read and decrypted.
pub(crate) async fn load_tools(
    org: &str,
    ids: &[String],
) -> Result<Vec<McpEntry>, AutoResolveError> {
    let listed = org_ai_toolsets::list_described(org, MCP_KIND).await?;
    load_listed(org, &listed, ids).await
}

/// The org's MCP connections the run does not have, each with its key, sorted by key, at most
/// `cap`; a key that several toolsets share is left out, as no run could load it.
pub(super) fn not_connected<'a>(
    listed: &'a [Listed],
    run_ids: &[String],
    cap: usize,
) -> Vec<(String, &'a Listed)> {
    let mut per_key: HashMap<String, usize> = HashMap::new();
    for (_, name, _) in listed {
        *per_key.entry(normalize_tool_name(name)).or_default() += 1;
    }
    let mut out: Vec<(String, &Listed)> = listed
        .iter()
        .filter(|(id, ..)| !run_ids.contains(id))
        .map(|entry| (normalize_tool_name(&entry.1), entry))
        .filter(|(key, _)| per_key.get(key) == Some(&1))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.truncate(cap);
    out
}

/// Asks the AI service to stop the run's turn; a failure leaves the turn to its deadline.
pub(crate) async fn cancel_turn(run: &RunRow) {
    let auth = match mint(&run.turn_identity, &run.org, &run.id, CANCEL_TOKEN_TTL_SECS) {
        Ok(token) => token.authorization(),
        Err(e) => {
            // o2-ai still accepts the internal secret the client attaches.
            log::warn!("[autoresolve] no run token to cancel run {}: {e}", run.id);
            String::new()
        }
    };
    match cancel_chat_turn(&run.org, &run.session_id, &auth).await {
        Ok(outcome) => log::info!(
            "[autoresolve] cancel of run {}: cancelled={}, active={}",
            run.id,
            outcome.cancelled,
            outcome.active
        ),
        Err(e) => log::warn!(
            "[autoresolve] could not cancel the turn of run {}: {e:?}",
            run.id
        ),
    }
}

/// The failure text a person reads: a refusal the AI service could not relay wins over the
/// turn's own error, which wins over the generic text; the step the run stopped at is named.
pub(super) fn end_message(
    state: RunState,
    text: &str,
    refusal: Option<&str>,
    turn_error: Option<&str>,
    running: Option<i32>,
    first_unrun: Option<i32>,
) -> String {
    match (state, refusal, running, first_unrun) {
        (RunState::Proceeding, _, Some(seq), _) => unknown_result(seq),
        (RunState::Proceeding, _, None, Some(seq)) => {
            format!("The run ended before step {seq} ran")
        }
        (RunState::Checking, ..) => check_unfinished(&check_reason(text, refusal, turn_error)),
        // Investigating takes plans and outcomes alike, so the prefix names neither.
        (RunState::Investigating, Some(refusal), ..) => {
            format!("The run's report was refused: {refusal}")
        }
        _ => turn_error
            .and_then(turn_failure)
            .unwrap_or_else(|| text.to_string()),
    }
}

/// Why a run ended `outcome_unknown`, wherever that is decided.
pub(super) fn unknown_result(seq: i32) -> String {
    format!("Step {seq} may have run; its result is unknown.")
}

/// Why a run whose approved steps all ran ended without a verdict, wherever that is decided.
pub(super) fn check_unfinished(reason: &str) -> String {
    let stop = if reason.ends_with('…') { "" } else { "." };
    format!("The steps ran. The check could not finish: {reason}{stop}")
}

/// The state a run moves to when a turn of `phase` ended in `state`, with the failure text;
/// `Checking` retries the check. `None` when the turn moved the run on or another turn owns it.
pub(super) fn settle_on_end(
    state: RunState,
    phase: Phase,
    has_running_step: bool,
    has_unrun_steps: bool,
    has_outcome: bool,
    check_retried: bool,
) -> Option<(RunState, &'static str)> {
    match (phase, state) {
        (Phase::Plan, RunState::Investigating) => {
            Some((RunState::Failed, "The run ended without a plan"))
        }
        // A consumed call may have reached the connection, so its effect is unknown, not failed.
        (Phase::Execute, RunState::Proceeding) if has_running_step => Some((
            RunState::OutcomeUnknown,
            "A step may have run; its result is unknown.",
        )),
        (Phase::Execute, RunState::Proceeding) if has_unrun_steps => Some((
            RunState::StepFailed,
            "The run ended before every approved step ran",
        )),
        // The approved steps ran, so a check that cannot finish leaves the outcome unknown.
        (Phase::Execute | Phase::Check, RunState::Checking) if !has_outcome && !check_retried => {
            Some((RunState::Checking, ""))
        }
        (Phase::Execute | Phase::Check, RunState::Checking) if !has_outcome => {
            Some((RunState::OutcomeUnknown, CHECK_NO_REPORT))
        }
        _ => None,
    }
}

/// The check retry's write: a fresh deadline, so the earlier turn's claim and its late end lapse.
pub(super) fn check_retry_patch(now_us: i64) -> RunPatch {
    RunPatch {
        turn_deadline_us: Some(Some(turn_deadline_us(now_us))),
        turn_started_at_us: Some(Some(now_us)),
        check_retried_at_us: Some(Some(now_us)),
        error: Some(None),
        updated_at_us: now_us,
        ..Default::default()
    }
}

/// Launches the retried check after its write committed, on the node whose write won; a launch
/// that fails ends the run `outcome_unknown`.
pub(super) async fn launch_check(
    db: &DatabaseConnection,
    turns: &dyn TurnLauncher,
    org: &str,
    run_id: &str,
) {
    let run = match runs_table::get_with(db, org, run_id).await {
        Ok(Some(run)) if run.state == RunState::Checking.as_str() => run,
        Ok(_) => return,
        Err(e) => {
            log::error!(
                "[autoresolve] run {run_id} check retry not read: {e}; the sweeper ends it"
            );
            return;
        }
    };
    // A stalled or timed-out turn may still run in the AI service and hold the session.
    turns.cancel(&run).await;
    let launched = match autoresolve_steps::list_for_run_with(db, org, run_id).await {
        Ok(steps) => {
            let chosen: Vec<StepRow> = chosen_steps(&run, &steps).into_iter().cloned().collect();
            turns.check(&run, &chosen).await
        }
        Err(e) => Err(e.into()),
    };
    if let Err(e) = launched {
        log::error!("[autoresolve] run {run_id} check turn could not start: {e}");
        end_unlaunched_check(db, &run).await;
    }
}

/// This run's corrections and its saved AutoResolve's active ones, newest first, at most
/// [CONTEXT_CORRECTIONS].
fn newest_corrections(
    this_run: Vec<CorrectionRow>,
    active: Vec<CorrectionRow>,
) -> Vec<CorrectionRow> {
    let mut all = this_run;
    for row in active {
        if !all.iter().any(|a| a.id == row.id) {
            all.push(row);
        }
    }
    all.sort_by(|a, b| {
        b.created_at_us
            .cmp(&a.created_at_us)
            .then_with(|| b.id.cmp(&a.id))
    });
    all.truncate(CONTEXT_CORRECTIONS);
    all
}

/// [not_connected] as the turn reads it: by key, with a description only when there is one.
fn not_connected_context(
    org: &str,
    listed: &[Listed],
    permitted: Option<&[String]>,
    run_ids: &[String],
    cap: usize,
) -> Vec<(String, Option<String>)> {
    not_connected(listed, run_ids, usize::MAX)
        .into_iter()
        .filter(|(_, (id, ..))| approve::is_permitted(org, id, permitted))
        .take(cap)
        .map(|(key, (_, _, description))| {
            (key, description.clone().filter(|d| !d.trim().is_empty()))
        })
        .collect()
}

async fn load_listed(
    org: &str,
    listed: &[Listed],
    ids: &[String],
) -> Result<Vec<McpEntry>, AutoResolveError> {
    let mut chosen = Vec::with_capacity(ids.len());
    for id in ids
        .iter()
        .filter(|id| listed.iter().any(|(listed, ..)| listed == *id))
    {
        if let Some(toolset) = org_ai_toolsets::get(org, id).await? {
            chosen.push(toolset);
        }
    }
    let names: Vec<String> = listed.iter().map(|(_, name, _)| name.clone()).collect();
    tools_of(org, &names, chosen)
}

/// The run's tools and the context extras, read once per turn; a planning turn also records
/// which corrections it read, for the run page.
async fn turn_inputs(
    run: &RunRow,
    phase: Phase,
) -> Result<(Vec<McpEntry>, TurnExtras), AutoResolveError> {
    let run_ids = run_connection_ids(run)?;
    let listed = org_ai_toolsets::list_described(&run.org, MCP_KIND).await?;
    let mcps = load_listed(&run.org, &listed, &run_ids).await?;
    let permitted = planner_listable(run).await;
    let this_run = autoresolve_corrections::for_run(&run.org, &run.id).await?;
    let active = match &run.autoresolve_id {
        Some(flow) => {
            let limit = CONTEXT_CORRECTIONS as u64;
            autoresolve_corrections::active_for_autoresolve(&run.org, flow, limit).await?
        }
        None => Vec::new(),
    };
    let extras = TurnExtras {
        not_connected: not_connected_context(
            &run.org,
            &listed,
            permitted.as_deref(),
            &run_ids,
            get_o2_config().autoresolve.max_connections,
        ),
        corrections: newest_corrections(this_run, active),
        changed: Vec::new(),
    };
    if phase == Phase::Plan {
        let ids: Vec<&str> = extras.corrections.iter().map(|c| c.id.as_str()).collect();
        let ids = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
        if let Err(e) = runs_table::set_plan_corrections(&run.org, &run.id, &ids).await {
            log::warn!(
                "[autoresolve] run {} plan corrections not recorded: {e}",
                run.id
            );
        }
    }
    Ok((mcps, extras))
}

/// A person's own run names to its planner only the MCPs that person may list; a saved or
/// triggered run names every one.
async fn planner_listable(run: &RunRow) -> Option<Vec<String>> {
    if run.trigger_kind != TriggerKind::Person.as_str() || run.autoresolve_id.is_some() {
        return None;
    }
    approve::permitted_connections(&run.org, &run.requester, "LIST")
        .await
        .unwrap_or_else(|e| {
            log::error!(
                "[autoresolve] run {} names no other MCP to its planner: {e}",
                run.id
            );
            Some(Vec::new())
        })
}

async fn spawn_turn(
    run: &RunRow,
    phase: Phase,
    note: Option<&str>,
    steps: &[StepRow],
    first_start: bool,
) -> Result<(), AutoResolveError> {
    let (mcps, mut extras) = turn_inputs(run, phase).await?;
    if let Some(since) = steps.iter().map(|s| s.created_at_us).min() {
        extras.changed = super::changed_since(run, since).await.unwrap_or_else(|e| {
            log::warn!(
                "[autoresolve] run {} other runs' changes unread: {e}",
                run.id
            );
            Vec::new()
        });
    }
    let context = turn_context(run, phase, note, &mcps, steps, &extras);
    let (failure, retry) = start_failure(first_start);
    let token = mint(&run.turn_identity, &run.org, &run.id, token_ttl_secs()).map_err(|e| {
        log::error!("[autoresolve] no run token for run {}: {e:#}", run.id);
        AutoResolveError::Turn(failure.to_string())
    })?;
    let client = get_agent_client()
        .ok_or_else(|| AutoResolveError::Turn("The AI service is not configured.".to_string()))?;
    let trace_id = config::ider::generate_trace_id();
    let admitted = admit(run, phase, &trace_id)
        .await
        .map_err(|e| admission_error(run, e, failure, retry))?;

    let mut request = QueryRequest::new(run.goal.clone(), context);
    request.mcps = Some(mcps);
    admission::apply_admission(&mut request, &admitted);
    let AdmittedTurn {
        row,
        owner,
        turn_id,
        lease,
        registration,
    } = admitted;
    let settings = PersistSettings::for_autoresolve();
    let store = Arc::new(StreamChatStore::new(settings.retention_days));
    // o2-ai binds one opencode session to the run and HA routes to its replica.
    let forward_headers = HashMap::from([(SESSION_ID_HEADER.to_string(), row.session_id.clone())]);
    let identity = TurnIdentity {
        org_id: run.org.clone(),
        session_id: row.session_id.clone(),
        user_id: owner,
        agent_type: AUTORESOLVE_AGENT_TYPE,
        turn_id,
        trace_id,
        epoch: row.session_epoch,
        last_committed_seq: row.last_committed_seq,
        opencode_session_id: row.opencode_session_id,
    };
    let (org, run_id, claim) = (run.org.clone(), run.id.clone(), TurnClaim::of(run));
    let spec = TurnSpec {
        identity,
        request,
        auth_header: token.authorization(),
        forward_headers: Some(forward_headers),
        client,
        store,
        lease,
        registration,
        on_end: Some(Box::new(move |end: TurnEnd| {
            spawn_on_end(
                org,
                run_id,
                phase,
                claim,
                end_error(end.result, end.error_message),
            )
        })),
        on_commit: Some(observer(run.clone())),
    };
    // No reader; the turn forwards no frames and goes on to its end.
    spawn_headless_turn(spec, settings);
    Ok(())
}

async fn admit(run: &RunRow, phase: Phase, trace_id: &str) -> Result<AdmittedTurn, AdmitError> {
    let patience = match phase {
        Phase::Check => {
            let settings = PersistSettings::for_autoresolve();
            // The old turn's end can wait out the final flush three times before it lets go.
            settings.cancel_grace + settings.final_timeout * 3 + CHECK_ADMIT_MARGIN
        }
        _ => Duration::ZERO,
    };
    let give_up = Instant::now() + patience;
    loop {
        let admitted = admission::admit_turn(
            &run.org,
            Some(&run.session_id),
            None,
            &run.turn_identity,
            AUTORESOLVE_AGENT_TYPE,
            &run.goal,
            trace_id,
            TurnCaps::from_config(),
        )
        .await;
        match admitted {
            Err(AdmitError::Busy) if Instant::now() < give_up => {
                tokio::time::sleep(CHECK_ADMIT_PAUSE).await;
            }
            admitted => return admitted,
        }
    }
}

fn tools_of(
    org: &str,
    mcp_names: &[String],
    chosen: Vec<OrgToolset>,
) -> Result<Vec<McpEntry>, AutoResolveError> {
    let mcps = autoresolve_entries(org, mcp_names, chosen);
    if mcps.is_empty() {
        return Err(AutoResolveError::NoConnections);
    }
    Ok(mcps)
}

fn turn_context(
    run: &RunRow,
    phase: Phase,
    note: Option<&str>,
    mcps: &[McpEntry],
    steps: &[StepRow],
    extras: &TurnExtras,
) -> Value {
    // o2-ai checks the run token and posts back in this org; without it, it uses "default".
    json!({
        "org_id": run.org,
        "autoresolve": autoresolve_context(run, phase, note, mcps, steps, extras),
    })
}

/// `context.autoresolve`: connections and steps name a connection by its normalised key, the name
/// o2-ai and the model see.
fn autoresolve_context(
    run: &RunRow,
    phase: Phase,
    note: Option<&str>,
    mcps: &[McpEntry],
    steps: &[StepRow],
    extras: &TurnExtras,
) -> Value {
    let connections: Vec<Value> = mcps
        .iter()
        .map(|m| json!({ "name": m.name, "description": m.description }))
        .collect();
    let not_connected: Vec<Value> = extras
        .not_connected
        .iter()
        .map(|(name, description)| json!({ "name": name, "description": description }))
        .collect();
    let corrections: Vec<Value> = extras
        .corrections
        .iter()
        .map(|c| {
            json!({
                "kind": c.kind,
                "note": c.note,
                "option_title": c.option_title,
                "this_run": c.run_id == run.id,
                "created_at_us": c.created_at_us,
            })
        })
        .collect();
    let mut context = json!({
        "run_id": run.id,
        "phase": phase.as_str(),
        "trigger": {
            "kind": run.trigger_kind,
            "label": trigger_label(run),
            "context": run.trigger_context.as_deref().map(json_or_text),
        },
        "note": note,
        "connections": connections,
        "not_connected": not_connected,
        "corrections": corrections,
        "window": turn_window(run),
    });
    match phase {
        Phase::Plan => {}
        Phase::Execute => context["steps"] = steps.iter().map(step_context).collect(),
        Phase::Check => {
            context["steps"] = steps.iter().map(ran_step_context).collect();
            context["check_retry"] = true.into();
        }
    }
    if phase != Phase::Plan {
        context["changed_since_plan"] = extras.changed.iter().map(changed_context).collect();
    }
    context
}

/// Where the turn looks for evidence: back from the alert's fire time, else from the run's start.
fn turn_window(run: &RunRow) -> Value {
    let context = run.trigger_context.as_deref().map(json_or_text);
    let alert = context
        .as_ref()
        .filter(|_| run.trigger_kind == TriggerKind::Alert.as_str());
    let look_back = match alert {
        Some(c) => {
            let period = c["condition"]["period_minutes"].as_i64().unwrap_or(0);
            let (min, max) = ALERT_LOOK_BACK_MINUTES;
            period.saturating_mul(2).clamp(min, max)
        }
        None => RUN_LOOK_BACK_MINUTES,
    };
    let fired = alert
        .and_then(|c| c["fired_at_us"].as_i64())
        .filter(|at| *at > 0);
    let (anchor, anchor_us) = match fired {
        Some(at) => ("alert_fired", at),
        None => ("run_started", run.created_at_us),
    };
    json!({ "anchor": anchor, "anchor_us": anchor_us, "look_back_minutes": look_back })
}

fn step_context(step: &StepRow) -> Value {
    json!({
        "seq": step.seq,
        "kind": step.kind,
        "connection": normalize_tool_name(&step.connection_name),
        "tool": step.tool,
        "arguments": json_or_text(&step.arguments),
        "refs": json_or_text(&step.refs),
    })
}

fn changed_context(step: &StepRow) -> Value {
    json!({
        "connection": normalize_tool_name(&step.connection_name),
        "tool": step.tool,
        "run_id": step.run_id,
        "at_us": step.consumed_at_us,
    })
}

/// A step the check reads: what it was asked to do, and how it ended in OpenObserve's words.
fn ran_step_context(step: &StepRow) -> Value {
    let mut context = step_context(step);
    context["state"] = step.state.clone().into();
    context["result"] = step.result.as_deref().map(result_text).into();
    context["error"] = step.error.clone().into();
    context
}

/// The failure text, and whether a person can still retry: every later turn fails on a run
/// whose decision is already committed, and the run fails with it.
fn start_failure(first_start: bool) -> (&'static str, bool) {
    if first_start {
        ("The run could not start.", true)
    } else {
        ("The AI turn could not start.", false)
    }
}

fn admission_error(run: &RunRow, e: AdmitError, failure: &str, retry: bool) -> AutoResolveError {
    let run_id = &run.id;
    let triggered = run.trigger_kind != TriggerKind::Person.as_str();
    let later = |cause: &str, hint: &str| match triggered {
        true => format!("{cause}. {TRIGGERED_RETRY}"),
        false => format!("{cause}; {hint}."),
    };
    let message = match e {
        AdmitError::TurnLimit(_) => later(
            "Too many AI turns are running",
            "try again in a few minutes",
        ),
        AdmitError::Busy if retry => later(
            "The run's previous turn is still finishing",
            "try again shortly",
        ),
        AdmitError::NotRegistered => "The run's identity has no user record.".to_string(),
        AdmitError::AlreadySubmitted => "This turn already ran.".to_string(),
        AdmitError::Busy => failure.to_string(),
        AdmitError::Unavailable(detail) => {
            log::error!("[autoresolve] turn of run {run_id} not admitted: {detail}");
            if retry {
                later(
                    failure.strip_suffix('.').unwrap_or(failure),
                    "try again shortly",
                )
            } else {
                failure.to_string()
            }
        }
        AdmitError::InvalidSession(detail) | AdmitError::NotFound(detail) => {
            log::error!("[autoresolve] turn of run {run_id} not admitted: {detail}");
            failure.to_string()
        }
    };
    AutoResolveError::Admission(message)
}

fn observer(run: RunRow) -> OnCommit {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(watch_run(run, rx));
    Arc::new(move |events: &[DurableEvent]| {
        if !events.is_empty() {
            // A closed watcher stopped on purpose.
            let _ = tx.send(());
        }
    })
}

/// Stops the turn of a run that ended under it, such as one the sweeper failed. The cancel
/// reaches the session's current turn, so a run another turn owns is left alone.
async fn watch_run(run: RunRow, mut rx: mpsc::UnboundedReceiver<()>) {
    let claim = TurnClaim::of(&run);
    let mut checked: Option<Instant> = None;
    while rx.recv().await.is_some() {
        if checked.is_some_and(|at| at.elapsed() < CHECK_INTERVAL) {
            continue;
        }
        checked = Some(Instant::now());
        let stop = match runs_table::get(&run.org, &run.id).await {
            Ok(Some(fresh)) if !claim.still_owns(&fresh) => return,
            Ok(fresh) => fresh.as_ref().is_none_or(ended_under_turn),
            Err(e) => {
                log::warn!(
                    "[autoresolve] cannot read run {} under its turn: {e}",
                    run.id
                );
                false
            }
        };
        if stop {
            cancel_turn(&run).await;
            return;
        }
    }
}

/// Only the turn's own outcome reaches these states, so its closing text is not cut off;
/// `outcome_verdict` survives a replan and cannot tell.
fn ended_under_turn(run: &RunRow) -> bool {
    RunState::parse(&run.state).is_none_or(|s| {
        s.is_terminal() && !matches!(s, RunState::Worked | RunState::NoChange | RunState::Worse)
    })
}

fn spawn_on_end(
    org: String,
    run_id: String,
    phase: Phase,
    claim: TurnClaim,
    turn_error: Option<String>,
) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        log::error!("[autoresolve] no runtime to settle run {run_id} on; the sweeper ends it");
        return;
    };
    runtime.spawn(on_end(org, run_id, phase, claim, turn_error));
}

/// Settles the run; a run another turn owns now is that turn's to settle.
async fn on_end(
    org: String,
    run_id: String,
    phase: Phase,
    claim: TurnClaim,
    turn_error: Option<String>,
) {
    match settle(&org, &run_id, phase, &claim, turn_error.as_deref()).await {
        Ok(Some(RunState::Checking)) => {
            let db = infra::db::get_orm_client_rw().await;
            launch_check(db, &LiveTurns, &org, &run_id).await;
        }
        Ok(Some(to)) => after_transition(&org, &run_id, to).await,
        Ok(None) => {}
        Err(e) => {
            log::error!("[autoresolve] could not settle run {run_id}: {e}; the sweeper ends it")
        }
    }
}

/// Checks the claim and moves the run under its row lock, so a hold, approval or replan
/// cannot land between the check and the move. Returns the state it moved to.
async fn settle(
    org: &str,
    run_id: &str,
    phase: Phase,
    claim: &TurnClaim,
    turn_error: Option<&str>,
) -> Result<Option<RunState>, AutoResolveError> {
    let txn = infra::db::get_orm_client_rw().await.begin().await?;
    let Some(run) = runs_table::locked(&txn, org, run_id).await? else {
        return Ok(None);
    };
    let Some(state) = RunState::parse(&run.state).filter(|_| claim.still_owns(&run)) else {
        return Ok(None);
    };
    let steps = autoresolve_steps::list_for_run_with(&txn, org, run_id).await?;
    let chosen = chosen_steps(&run, &steps);
    let in_state = |state: StepState| -> Vec<&StepRow> {
        let rows = chosen.iter().filter(|s| s.state == state.as_str());
        rows.copied().collect()
    };
    let (running, unrun) = (in_state(StepState::Running), in_state(StepState::Approved));
    let first = |rows: &[&StepRow]| rows.iter().map(|s| s.seq).min();
    let ids: Vec<String> = running.iter().map(|s| s.id.clone()).collect();
    let has_outcome = run.outcome_verdict.is_some();
    let Some((to, text)) = settle_on_end(
        state,
        phase,
        !running.is_empty(),
        !unrun.is_empty(),
        has_outcome,
        run.check_retried_at_us.is_some(),
    ) else {
        return Ok(None);
    };
    if to == RunState::Checking {
        let patch = check_retry_patch(config::utils::time::now_micros());
        let moved = runs_table::set_state_with(&txn, org, run_id, &[state], to, patch).await?;
        txn.commit().await?;
        return Ok(moved.then_some(to));
    }
    let message = end_message(
        state,
        text,
        run.error.as_deref(),
        turn_error,
        first(&running),
        first(&unrun),
    );
    let patch = RunPatch {
        error: Some(Some(message)),
        ..Default::default()
    };
    let moved = transition_with(&txn, org, run_id, &[state], to, patch).await?;
    if moved {
        let (from, to) = ([StepState::Running], StepState::OutcomeUnknown);
        autoresolve_steps::set_many(&txn, org, &ids, &from, to).await?;
        mark_not_run(&txn, org, &chosen).await?;
    }
    txn.commit().await?;
    Ok(moved.then_some(to))
}

/// Ends a run whose check retry could not launch, unless something else moved it first.
async fn end_unlaunched_check(db: &DatabaseConnection, run: &RunRow) {
    let ended = async {
        let txn = db.begin().await?;
        let fresh = runs_table::locked(&txn, &run.org, &run.id).await?;
        if !fresh.is_some_and(|f| TurnClaim::of(run).still_owns(&f)) {
            return Ok(false);
        }
        let patch = RunPatch {
            error: Some(Some(check_unfinished(CHECK_NOT_STARTED))),
            ..Default::default()
        };
        let (from, to) = ([RunState::Checking], RunState::OutcomeUnknown);
        let moved = transition_with(&txn, &run.org, &run.id, &from, to, patch).await?;
        txn.commit().await?;
        Ok::<bool, AutoResolveError>(moved)
    };
    match ended.await {
        Ok(true) => after_transition(&run.org, &run.id, RunState::OutcomeUnknown).await,
        Ok(false) => {}
        Err(e) => log::error!("[autoresolve] run {} could not be ended: {e}", run.id),
    }
}

/// The reason clause of [check_unfinished]: a refusal, else the turn's own failure with a
/// provider's words kept as written, else `fallback`.
fn check_reason(fallback: &str, refusal: Option<&str>, turn_error: Option<&str>) -> String {
    if let Some(refusal) = refusal {
        return format!("its report was refused ({})", clause(refusal));
    }
    match turn_error.and_then(turn_failure_detail) {
        Some(own) if own.starts_with(MODEL_SUBJECT) => clause(&own),
        Some(said) => format!("the AI model did not answer ({})", unpunctuated(&said)),
        None => fallback.to_string(),
    }
}

/// One of our own sentences as a clause after a colon, lower-cased unless it opens with an
/// acronym.
fn clause(sentence: &str) -> String {
    let text = unpunctuated(sentence);
    let mut chars = text.chars();
    match (chars.next(), chars.next()) {
        (Some(first), second) if !second.is_some_and(char::is_uppercase) => first
            .to_lowercase()
            .chain(text[first.len_utf8()..].chars())
            .collect(),
        _ => text,
    }
}

/// A sentence without a closing period or a colon of its own.
fn unpunctuated(sentence: &str) -> String {
    sentence.trim().trim_end_matches('.').replace(": ", ", ")
}

/// What a turn's end says went wrong; a timeout reads like the sweep's deadline, not like the
/// chat layer's own timeout text.
fn end_error(result: TurnResult, message: Option<String>) -> Option<String> {
    match result {
        TurnResult::Timeout => Some(TURN_TIMED_OUT.to_string()),
        _ => message,
    }
}

/// The turn's own error as one sentence a person reads: its first sentence without URLs, internal
/// names, a request id or secrets; `None` for a JSON payload or when nothing is left.
fn turn_failure(error: &str) -> Option<String> {
    let sentence = turn_failure_detail(error)?;
    if sentence.starts_with(MODEL_SUBJECT) {
        return Some(sentence);
    }
    Some(format!("{MODEL_SUBJECT} did not answer: {sentence}"))
}

/// [turn_failure]'s sentence without its lead-in.
fn turn_failure_detail(error: &str) -> Option<String> {
    let line = error.lines().map(str::trim).find(|l| !l.is_empty())?;
    if line.starts_with('{') || line.starts_with('[') {
        return None;
    }
    let line = line.split(". ").next().unwrap_or(line);
    let line = line.split("(request_id").next().unwrap_or(line);
    let line = redact_internal_details(line);
    let line = REDACTED_FRAGMENT.replace_all(&line, "");
    let mut words = Vec::new();
    let mut hide_next = false;
    for word in line.split_whitespace().filter(|w| !w.contains("://")) {
        let scheme = word.eq_ignore_ascii_case("bearer") || word.eq_ignore_ascii_case("basic");
        if hide_next && !scheme {
            words.push("***".to_string());
            hide_next = false;
            continue;
        }
        let (shown, value_follows) = redact_word(word);
        hide_next = value_follows || scheme;
        words.push(shown);
    }
    let detail = words.join(" ");
    let detail = detail.trim_end_matches(['.', ' ']);
    if detail.is_empty() {
        return None;
    }
    Some(match detail.char_indices().nth(MAX_TURN_ERROR_CHARS) {
        Some((cut, _)) => format!("{}…", detail[..cut].trim_end()),
        None => format!("{detail}."),
    })
}

/// A `name=value` or `name:value` word whose name holds a secret keeps only its name; `true`
/// when the value is the next word (`token: abc`).
fn redact_word(word: &str) -> (String, bool) {
    let Some(at) = word.find(['=', ':']) else {
        return (word.to_string(), false);
    };
    let mut probe = json!({ &word[..at]: "x" });
    redact_secrets(&mut probe);
    if probe[&word[..at]] == "x" {
        return (word.to_string(), false);
    }
    if word[at + 1..].is_empty() {
        (word.to_string(), true)
    } else {
        (format!("{}***", &word[..=at]), false)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::autoresolve::RunState::*;
    use infra::table::autoresolve_runs::NewRun;

    use super::*;
    use crate::autoresolve::test_support::{ORG, memory_db, new_run};

    #[test]
    fn turn_end_settles_the_run() {
        let (plan, exec, check) = (Phase::Plan, Phase::Execute, Phase::Check);
        let provider = Some("Insufficient Balance (request_id: [redacted])");
        let leaky = Some(
            "upstream http://10.0.0.5:8080/v1 refused token=abc123. Retry later\n  at agent.py:12",
        );
        let internal = Some("the opencode server at /home/appuser/ws failed");
        let backstop = Some("Turn exceeded 930s and was abandoned");
        let stalled = Some("The AI model stopped responding and did not recover on a retry");
        let (ended, timed_out) = (TurnResult::Error, TurnResult::Timeout);
        let long = "word ".repeat(80);
        #[rustfmt::skip]
        let cases = [
            ("no_plan", Investigating, plan, None, None, false, false, None, None, Some(Failed), "without a plan", ended),
            ("plan_refused", Investigating, plan, None, None, false, false, Some("bad"), None, Some(Failed), "report was refused: bad", ended),
            ("provider_failed", Investigating, plan, None, None, false, false, None, provider, Some(Failed), "The AI model did not answer: Insufficient Balance.", ended),
            ("secrets_hidden", Investigating, plan, None, None, false, false, None, leaky, Some(Failed), "The AI model did not answer: upstream refused token=***.", ended),
            ("internal_hidden", Investigating, plan, None, None, false, false, None, internal, Some(Failed), "did not answer: the agent runtime failed.", ended),
            ("long_capped", Investigating, plan, None, None, false, false, None, Some(long.as_str()), Some(Failed), "word word…", ended),
            ("json_not_echoed", Investigating, plan, None, None, false, false, None, Some("{\"error\":\"x\"}"), Some(Failed), "without a plan", ended),
            ("refusal_wins", Investigating, plan, None, None, false, false, Some("bad"), provider, Some(Failed), "report was refused: bad", ended),
            ("plan_submitted", WaitingApproval, plan, None, None, false, false, None, provider, None, "", ended),
            ("unrun", Proceeding, exec, None, Some(2), false, false, None, None, Some(StepFailed), "step 2", ended),
            ("running_step", Proceeding, exec, Some(1), None, false, false, None, provider, Some(OutcomeUnknown), "Step 1 may have run", ended),
            ("running_then_unrun", Proceeding, exec, Some(1), Some(2), false, false, None, None, Some(OutcomeUnknown), "Step 1 may have run", ended),
            ("no_outcome_retried", Checking, exec, None, None, false, false, None, None, Some(Checking), "", ended),
            ("check_failed_retried", Checking, exec, None, None, false, false, None, provider, Some(Checking), "", ended),
            ("outcome_refused_retried", Checking, exec, None, None, false, false, Some("odd"), None, Some(Checking), "", ended),
            ("retry_no_outcome", Checking, check, None, None, false, true, None, None, Some(OutcomeUnknown), "The steps ran. The check could not finish: the AI model ended the check without reporting an outcome.", ended),
            ("retry_failed", Checking, check, None, None, false, true, None, provider, Some(OutcomeUnknown), "The steps ran. The check could not finish: the AI model did not answer (Insufficient Balance).", ended),
            ("retry_provider_words_kept", Checking, check, None, None, false, true, None, Some("TLS handshake failed: peer closed"), Some(OutcomeUnknown), "could not finish: the AI model did not answer (TLS handshake failed, peer closed).", ended),
            ("retry_refused", Checking, check, None, None, false, true, Some("This run is not waiting for an outcome."), None, Some(OutcomeUnknown), "could not finish: its report was refused (this run is not waiting for an outcome).", ended),
            ("plan_timed_out", Investigating, plan, None, None, false, false, None, backstop, Some(Failed), "The AI model did not answer in time.", timed_out),
            ("plan_stalled", Investigating, plan, None, None, false, false, None, stalled, Some(Failed), "The AI model stopped responding and did not recover on a retry.", ended),
            ("retry_timed_out", Checking, check, None, None, false, true, None, backstop, Some(OutcomeUnknown), "The steps ran. The check could not finish: the AI model did not answer in time.", timed_out),
            ("retry_stalled", Checking, check, None, None, false, true, None, stalled, Some(OutcomeUnknown), "could not finish: the AI model stopped responding and did not recover on a retry.", ended),
            ("outcome_reported", Checking, exec, None, None, true, false, None, None, None, "", ended),
            ("replan_owns", Investigating, exec, None, None, false, false, None, None, None, "", ended),
        ];
        for (
            name,
            state,
            phase,
            running,
            first_unrun,
            outcome,
            retried,
            refusal,
            turn_error,
            want,
            shows,
            ended_as,
        ) in cases
        {
            let turn_error = end_error(ended_as, turn_error.map(str::to_string));
            let got = settle_on_end(
                state,
                phase,
                running.is_some(),
                first_unrun.is_some(),
                outcome,
                retried,
            )
            .map(|(to, text)| {
                let error = turn_error.as_deref();
                let message = end_message(state, text, refusal, error, running, first_unrun);
                (to, message)
            });
            assert_eq!(got.as_ref().map(|(to, _)| *to), want, "{name}");
            let message = got.map(|(_, message)| message).unwrap_or_default();
            assert!(message.contains(shows), "{name}: {message}");
            assert!(!message.contains("…."), "{name}: {message}");
            assert!(!message.contains("[internal"), "{name}: {message}");
            assert!(message.matches("AI model").count() < 2, "{name}: {message}");
        }
    }

    #[test]
    fn a_turn_loads_only_the_run_connections_that_still_exist() {
        let mcp = |id: &str, name: &str| OrgToolset {
            id: id.into(),
            org: ORG.into(),
            name: name.into(),
            kind: "mcp".into(),
            description: None,
            data: Some(json!({"url": format!("https://{name}.example")}).to_string()),
            created_by: "rita@example.com".into(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
        };
        let org = [mcp("c1", "code-host"), mcp("c2", "k8s")];
        let names: Vec<String> = org.iter().map(|t| t.name.clone()).collect();
        type Case = (
            &'static str,
            &'static [&'static str],
            Option<&'static [&'static str]>,
        );
        let cases: [Case; 2] = [
            ("one of two", &["c1"], Some(&["code-host"])),
            ("all removed", &["gone"], None),
        ];
        for (case, ids, want) in cases {
            let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
            let chosen = org
                .iter()
                .filter(|t| ids.contains(&t.id))
                .cloned()
                .collect();
            let got = tools_of(ORG, &names, chosen);
            let names = got
                .as_ref()
                .ok()
                .map(|m| m.iter().map(|m| m.name.as_str()).collect::<Vec<_>>());
            assert_eq!(names, want.map(<[&str]>::to_vec), "{case}");
            if want.is_none() {
                assert!(
                    matches!(got, Err(AutoResolveError::NoConnections)),
                    "{case}"
                );
            }
        }
    }

    #[tokio::test]
    async fn a_turn_looks_back_from_the_alert_fire_or_the_run_start() {
        use TriggerKind::{Alert as A, Incident, Person};
        let alert = |period: i64, fired: Option<i64>| {
            let mut c = json!({"condition": {"period_minutes": period}});
            if let Some(at) = fired {
                c["fired_at_us"] = at.into();
            }
            Some(c)
        };
        let (started, fired) = (9_000_000, Some(7_000));
        type Case = (&'static str, TriggerKind, Option<Value>, Option<i64>, i64);
        #[rustfmt::skip]
        let cases: [Case; 6] = [
            ("short period", A, alert(5, fired), fired, 15),
            ("twice the period", A, alert(30, fired), fired, 60),
            ("long period", A, alert(90, fired), fired, 120),
            ("missing fired_at", A, alert(10, None), None, 20),
            ("person run", Person, None, None, 30),
            ("incident run", Incident, Some(json!({"subject_type": "incident"})), None, 30),
        ];
        let db = memory_db().await;
        for (name, kind, trigger, fired_at, look_back) in cases {
            let new = NewRun {
                trigger_kind: kind,
                trigger_context: trigger.map(|c| c.to_string()),
                now_us: started,
                ..new_run(name)
            };
            let run = runs_table::insert_with(&db, new).await.unwrap();
            let af = autoresolve_context(&run, Phase::Plan, None, &[], &[], &TurnExtras::default());
            let (anchor, anchor_us) =
                fired_at.map_or(("run_started", started), |at| ("alert_fired", at));
            let window =
                json!({"anchor": anchor, "anchor_us": anchor_us, "look_back_minutes": look_back});
            assert_eq!(af["window"], window, "{name}");
        }
    }

    #[tokio::test]
    async fn turn_context_lists_what_the_run_lacks_and_the_corrections() {
        let db = memory_db().await;
        let run = runs_table::insert_with(&db, new_run("r1")).await.unwrap();
        let cap = get_o2_config().autoresolve.max_connections;
        let listed = |names: &[String]| -> Vec<Listed> {
            let mut out = vec![("c1".to_string(), "code-host".to_string(), None)];
            out.extend(
                names
                    .iter()
                    .enumerate()
                    .map(|(i, n)| (format!("o{i}"), n.clone(), Some(format!("about {n}")))),
            );
            out
        };
        let correction = |i: i64, run_id: &str| CorrectionRow {
            id: format!("k{i}"),
            org: ORG.into(),
            autoresolve_id: Some("f1".into()),
            run_id: run_id.into(),
            revision: 1,
            kind: "wrong_fix".into(),
            note: format!("n{i}"),
            option_title: None,
            created_by: "rita@example.com".into(),
            created_at_us: i,
            active: true,
        };
        let many: Vec<String> = (0..cap + 5).map(|i| format!("pg{i:02}")).rev().collect();
        let mut sorted = many.clone();
        sorted.sort();
        sorted.truncate(cap);
        let shared = [
            "Postgres".to_string(),
            "postgres".to_string(),
            "slack".to_string(),
        ];
        let this_run = (1..=3).map(|i| correction(i * 2, "r1")).collect::<Vec<_>>();
        let earlier = (0..4)
            .map(|i| correction(i * 2 + 1, "r0"))
            .collect::<Vec<_>>();
        type Case = (
            &'static str,
            Vec<Listed>,
            Vec<CorrectionRow>,
            Vec<CorrectionRow>,
            Option<Vec<String>>,
            Vec<String>,
            Vec<(&'static str, bool)>,
        );
        let cases: [Case; 5] = [
            (
                "nothing else",
                listed(&[]),
                vec![],
                vec![],
                None,
                vec![],
                vec![],
            ),
            (
                "more than the cap",
                listed(&many),
                vec![],
                vec![],
                None,
                sorted,
                vec![],
            ),
            (
                "shared key dropped",
                listed(&shared),
                vec![],
                vec![],
                None,
                vec!["slack".into()],
                vec![],
            ),
            (
                "only what the requester may list",
                listed(&["postgres".to_string(), "slack".to_string()]),
                vec![],
                vec![],
                Some(vec!["ai_toolsets:o1".to_string()]),
                vec!["slack".into()],
                vec![],
            ),
            (
                "seven corrections",
                listed(&[]),
                this_run.clone(),
                earlier
                    .into_iter()
                    .chain(this_run.into_iter().take(1))
                    .collect(),
                None,
                vec![],
                vec![
                    ("n7", false),
                    ("n6", true),
                    ("n5", false),
                    ("n4", true),
                    ("n3", false),
                ],
            ),
        ];
        for (name, listed, this_run, active, permitted, want_names, want_notes) in cases {
            let run_ids = ["c1".to_string()];
            let extras = TurnExtras {
                not_connected: not_connected_context(
                    ORG,
                    &listed,
                    permitted.as_deref(),
                    &run_ids,
                    cap,
                ),
                corrections: newest_corrections(this_run, active),
                changed: Vec::new(),
            };
            let context = turn_context(&run, Phase::Plan, None, &[], &[], &extras);
            assert_eq!(context["org_id"], ORG, "{name}");
            let af = &context["autoresolve"];
            let names: Vec<&str> = af["not_connected"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["name"].as_str().unwrap())
                .collect();
            assert_eq!(names, want_names, "{name}");
            if let Some(first) = af["not_connected"].get(0) {
                assert!(
                    first["description"].as_str().unwrap().starts_with("about"),
                    "{name}"
                );
            }
            let notes: Vec<(&str, bool)> = af["corrections"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| {
                    (
                        c["note"].as_str().unwrap(),
                        c["this_run"].as_bool().unwrap(),
                    )
                })
                .collect();
            assert_eq!(notes, want_notes, "{name}");
        }
    }
}

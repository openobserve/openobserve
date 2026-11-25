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

//! Running an approved plan: each call is consumed once as the next approved step or held for a
//! new approval, and each step's result is recorded.

use std::collections::{BTreeMap, HashMap};

use config::{
    meta::autoresolve::{
        ConsumeRequest, ConsumeResponse, OptionInput, PlanInput, RESULT_CAP_BYTES, RefError,
        RunState, StepInput, StepKind, StepRef, StepResultInput, StepState, args_hash, capitalized,
        named_mcp, plan_fingerprint, redacted_text, resolve_refs, shown_result,
    },
    utils::time::now_micros,
};
use infra::table::{
    autoresolve_runs::{self, RunPatch},
    autoresolve_steps::{self, ConsumePins, NewStep},
    entity::{autoresolve_runs::Model as RunRow, autoresolve_steps::Model as StepRow},
};
use o2_enterprise::enterprise::ai::toolsets::{AutoResolveConnection, push::normalize_tool_name};
use sea_orm::{DatabaseTransaction, TransactionTrait};
use serde_json::Value;

use super::{
    AutoResolveError, after_transition, approval_deadline_us, approve::Seams, chosen_steps,
    evidence, mark_not_run, plan::OPTION_IDS, run_connection_ids, transition_with,
    turn::unknown_result,
};

/// `result_raw` only fills later steps' references; a larger result is not kept for them.
const MAX_RAW_BYTES: usize = 1_048_576;
const MAX_ERROR_CHARS: usize = 2000;
const HELD_REASON: &str = "Not in the approved plan";
const HELD_TRADEOFFS: &str = "A call outside the approved plan was added as the last step.";
const NOT_PROCEEDING: &str = "This run is not running approved steps.";
const STILL_RUNNING: &str = "The previous step is still running.";
const ALREADY_RAN: &str = "This step already ran.";
const PIN_MOVED: &str = "The MCP or tool changed since approval.";
const NOT_AVAILABLE: &str = "That MCP is not available to this run.";
const HELD: &str = "Not run: this call was not approved. The run is waiting for a new approval.";

/// What a consume decided under the run's lock; its side effects follow the commit.
enum Decision {
    Answer(ConsumeResponse),
    Failed { step_id: String, message: String },
    Held { step_id: String },
}

/// The connections a consume may need, read before the run is locked because the live source
/// reads the meta store through the global client.
struct Lookups {
    caller: Option<AutoResolveConnection>,
    caller_allowed: bool,
    by_id: HashMap<String, Option<AutoResolveConnection>>,
}

impl Lookups {
    async fn fetch(
        seams: &Seams<'_>,
        run: &RunRow,
        steps: &[StepRow],
        key: &str,
    ) -> Result<Self, AutoResolveError> {
        let source = seams.connections;
        let mut by_id = HashMap::new();
        for step in chosen_steps(run, steps) {
            if !by_id.contains_key(&step.connection_id) {
                let conn = source
                    .get(&run.org, &step.connection_id)
                    .await?
                    .filter(|c| c.id == step.connection_id);
                by_id.insert(step.connection_id.clone(), conn);
            }
        }
        // A key several connections share cannot name the caller; the call is refused, not a 500.
        let caller = source
            .get(&run.org, key)
            .await
            .unwrap_or_else(|e| {
                log::warn!(
                    "[autoresolve] run {} called an unresolvable connection: {e}",
                    run.id
                );
                None
            })
            .filter(|c| normalize_tool_name(&c.name) == key);
        let caller_allowed = match &caller {
            Some(c) => run_connection_ids(run)?.contains(&c.id),
            None => false,
        };
        Ok(Self {
            caller,
            caller_allowed,
            by_id,
        })
    }

    fn caller_id(&self) -> Option<&str> {
        self.caller.as_ref().map(|c| c.id.as_str())
    }
}

/// Decides one call of the execute turn: run the next approved step, refuse, or hold the call and
/// ask for a new approval.
pub async fn consume(
    org: &str,
    run_id: &str,
    req: ConsumeRequest,
) -> Result<ConsumeResponse, AutoResolveError> {
    consume_with(&Seams::live().await, org, run_id, req).await
}

/// Ends a consumed step with what its call returned, and moves the run on.
pub async fn record_result(
    org: &str,
    run_id: &str,
    step_id: &str,
    input: StepResultInput,
) -> Result<(), AutoResolveError> {
    record_result_with(&Seams::live().await, org, run_id, step_id, input).await
}

pub(crate) async fn consume_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    req: ConsumeRequest,
) -> Result<ConsumeResponse, AutoResolveError> {
    let Some(seen) = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .filter(is_proceeding)
    else {
        return Ok(refuse(NOT_PROCEEDING));
    };
    let steps = autoresolve_steps::list_for_run_with(seams.db, org, run_id).await?;
    let lookups = Lookups::fetch(seams, &seen, &steps, &req.connection).await?;

    let txn = seams.db.begin().await?;
    // A hold or a sweep between the reads above and the lock would leave `lookups` stale.
    let Some(run) = autoresolve_runs::locked(&txn, org, run_id)
        .await?
        .filter(|r| {
            is_proceeding(r)
                && r.revision == seen.revision
                && r.chosen_option_id == seen.chosen_option_id
        })
    else {
        return Ok(refuse(NOT_PROCEEDING));
    };
    let steps = autoresolve_steps::list_for_run_with(&txn, org, run_id).await?;
    let decision = decide(&txn, &run, &steps, &lookups, &req).await?;
    txn.commit().await?;

    match decision {
        Decision::Answer(answer) => Ok(answer),
        Decision::Failed { step_id, message } => {
            after_transition(org, run_id, RunState::StepFailed).await;
            seams.turns.cancel(&run).await;
            write_evidence(seams, org, run_id, &step_id).await;
            Ok(refuse(&message))
        }
        Decision::Held { step_id } => {
            after_transition(org, run_id, RunState::WaitingApproval).await;
            seams.turns.cancel(&run).await;
            write_evidence(seams, org, run_id, &step_id).await;
            Ok(ConsumeResponse::Hold {
                message: HELD.to_string(),
            })
        }
    }
}

pub(crate) async fn record_result_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    step_id: &str,
    input: StepResultInput,
) -> Result<(), AutoResolveError> {
    let now = now_micros();
    let txn = seams.db.begin().await?;
    let run = autoresolve_runs::locked(&txn, org, run_id)
        .await?
        .filter(is_proceeding)
        .ok_or(AutoResolveError::StepNotRunning)?;
    let steps = autoresolve_steps::list_for_run_with(&txn, org, run_id).await?;
    let chosen = chosen_steps(&run, &steps);
    let Some(step) = chosen
        .iter()
        .find(|s| s.id == step_id && s.state == StepState::Running.as_str())
    else {
        return Err(AutoResolveError::StepNotRunning);
    };
    let last = !chosen
        .iter()
        .any(|s| s.state == StepState::Approved.as_str());
    let (step_to, run_to) = step_outcome(&input, last);
    let run_error = (step_to == StepState::OutcomeUnknown).then(|| unknown_result(step.seq));
    let (result, result_raw) = stored_result(step_id, input.result.as_ref());
    let error = input
        .error
        .map(|e| redacted_text(&e).chars().take(MAX_ERROR_CHARS).collect());
    let finished =
        autoresolve_steps::finish(&txn, org, step_id, step_to, result, result_raw, error, now)
            .await?;
    if !finished {
        return Err(AutoResolveError::StepNotRunning);
    }
    let mut moved = false;
    if let Some(to) = run_to {
        let patch = RunPatch {
            error: run_error.map(Some),
            updated_at_us: now,
            ..Default::default()
        };
        moved = transition_with(&txn, org, run_id, &[RunState::Proceeding], to, patch).await?;
        if !moved {
            return Err(AutoResolveError::StepNotRunning);
        }
        mark_not_run(&txn, org, &chosen).await?;
    }
    txn.commit().await?;

    if let Some(to) = run_to.filter(|_| moved) {
        after_transition(org, run_id, to).await;
        if to != RunState::Checking {
            seams.turns.cancel(&run).await;
        }
    }
    write_evidence(seams, org, run_id, step_id).await;
    Ok(())
}

async fn decide(
    txn: &DatabaseTransaction,
    run: &RunRow,
    steps: &[StepRow],
    lookups: &Lookups,
    req: &ConsumeRequest,
) -> Result<Decision, AutoResolveError> {
    let chosen = chosen_steps(run, steps);
    let caller_id = lookups.caller_id();
    let in_state = |s: &StepRow, state: StepState| s.state == state.as_str();
    if let Some(running) = chosen.iter().find(|s| in_state(s, StepState::Running)) {
        let replay = same_call(running, caller_id, req);
        return Ok(answer(if replay { ALREADY_RAN } else { STILL_RUNNING }));
    }
    let Some(next) = chosen.iter().find(|s| in_state(s, StepState::Approved)) else {
        return Ok(answer(NOT_PROCEEDING));
    };
    let Some(conn) = lookups.by_id.get(&next.connection_id).cloned().flatten() else {
        let removed = format!(
            "{} was removed after approval.",
            capitalized(&named_mcp(&next.connection_name))
        );
        return fail_step(txn, run, &chosen, next, removed).await;
    };
    // The model still calls the key it was given, which a rename moved off the approved connection.
    if req.connection == next.connection_name
        && normalize_tool_name(&conn.name) != next.connection_name
    {
        return fail_step(txn, run, &chosen, next, PIN_MOVED.to_string()).await;
    }
    if same_call(next, caller_id, req) {
        return run_next(txn, run, &chosen, next, &conn, req).await;
    }
    // Steps that differ only at reference paths share a hash, so a replay is matched after next.
    let replay = chosen.iter().any(|s| {
        s.consumed_at_us.is_some() && in_state(s, StepState::Done) && same_call(s, caller_id, req)
    });
    if replay {
        return Ok(answer(ALREADY_RAN));
    }
    let later = chosen.iter().any(|s| {
        s.seq > next.seq && in_state(s, StepState::Approved) && same_call(s, caller_id, req)
    });
    if later {
        return Ok(answer(&format!("Run step {} first.", next.seq)));
    }
    match lookups.caller.as_ref().filter(|_| lookups.caller_allowed) {
        Some(caller) => hold(txn, run, &chosen, caller, req).await,
        None => Ok(answer(NOT_AVAILABLE)),
    }
}

/// Consumes `next` when the call still goes to the connection and tool definition it was
/// approved for, with its references filled from the recorded results.
async fn run_next(
    txn: &DatabaseTransaction,
    run: &RunRow,
    chosen: &[&StepRow],
    next: &StepRow,
    conn: &AutoResolveConnection,
    req: &ConsumeRequest,
) -> Result<Decision, AutoResolveError> {
    let pinned = req.upstream_url == conn.url
        && next.connection_fingerprint.as_deref() == Some(conn.fingerprint.as_str());
    // The AI service sends no definition hash when it could not list the MCP's tools.
    if pinned && req.tool_def_hash.is_empty() {
        let unreachable = format!(
            "{} could not be reached.",
            capitalized(&named_mcp(&next.connection_name))
        );
        return fail_step(txn, run, chosen, next, unreachable).await;
    }
    if !pinned || req.tool_def_hash != next.tool_def_hash {
        return fail_step(txn, run, chosen, next, PIN_MOVED.to_string()).await;
    }
    let arguments: Value = serde_json::from_str(&next.arguments).map_err(anyhow::Error::from)?;
    let resolved = match resolve_refs(&arguments, &refs_of(next), &recorded_results(chosen)) {
        Ok(resolved) => resolved,
        Err(e) => {
            let step = match e {
                RefError::MissingStep(step) | RefError::MissingPath { step, .. } => step,
            };
            let message = format!("A value from step {step} was not found.");
            return fail_step(txn, run, chosen, next, message).await;
        }
    };
    let pins = ConsumePins {
        args_hash: next.args_hash.clone(),
        tool: next.tool.clone(),
        connection_id: next.connection_id.clone(),
        tool_def_hash: next.tool_def_hash.clone(),
        connection_fingerprint: conn.fingerprint.clone(),
    };
    if !autoresolve_steps::consume_with(txn, &run.org, &next.id, &pins, now_micros()).await? {
        return Ok(answer(ALREADY_RAN));
    }
    Ok(Decision::Answer(ConsumeResponse::Run {
        step_id: next.id.clone(),
        arguments: resolved,
        headers: conn.write_headers.clone(),
    }))
}

/// Fails `step` before it is sent, and the run with it; the steps after it never run.
async fn fail_step(
    txn: &DatabaseTransaction,
    run: &RunRow,
    chosen: &[&StepRow],
    step: &StepRow,
    message: String,
) -> Result<Decision, AutoResolveError> {
    let now = now_micros();
    let patch = RunPatch {
        error: Some(Some(message.clone())),
        updated_at_us: now,
        ..Default::default()
    };
    let (from, to) = ([RunState::Proceeding], RunState::StepFailed);
    if !transition_with(txn, &run.org, &run.id, &from, to, patch).await? {
        return Ok(answer(NOT_PROCEEDING));
    }
    autoresolve_steps::fail_unsent(txn, &run.org, &step.id, &message, now).await?;
    // `step` is no longer approved in the store, so only the steps after it move.
    mark_not_run(txn, &run.org, chosen).await?;
    Ok(Decision::Failed {
        step_id: step.id.clone(),
        message,
    })
}

/// Records the call as held and asks again for revision n+1: the done steps as they ran, the
/// remaining steps proposed again without their pins, and the held call last.
async fn hold(
    txn: &DatabaseTransaction,
    run: &RunRow,
    chosen: &[&StepRow],
    caller: &AutoResolveConnection,
    req: &ConsumeRequest,
) -> Result<Decision, AutoResolveError> {
    let now = now_micros();
    let revision = run.revision + 1;
    let seq = chosen.iter().map(|s| s.seq).max().unwrap_or(0) + 1;
    let held = held_step(run, caller, req, seq, now);
    let mut next_rows: Vec<NewStep> = chosen
        .iter()
        .filter(|s| s.state == StepState::Done.as_str() || s.state == StepState::Approved.as_str())
        .map(|s| copy_step(s, revision, now))
        .collect();
    next_rows.push(NewStep {
        id: autoresolve_runs::new_run_id(),
        revision,
        option_id: Some(OPTION_IDS[0].to_string()),
        state: StepState::Proposed,
        ..held.clone()
    });
    let plan = revised_plan(run, &next_rows)?;
    let fingerprint = plan_fingerprint(&plan, u32::try_from(revision).unwrap_or_default());
    let patch = RunPatch {
        revision: Some(revision),
        plan: Some(serde_json::to_string(&plan).map_err(anyhow::Error::from)?),
        plan_fingerprint: Some(fingerprint),
        chosen_option_id: Some(None),
        approved_by: Some(None),
        approved_at_us: Some(None),
        approval_deadline_us: Some(Some(approval_deadline_us(now))),
        updated_at_us: now,
        ..Default::default()
    };
    let (from, to) = ([RunState::Proceeding], RunState::WaitingApproval);
    if !transition_with(txn, &run.org, &run.id, &from, to, patch).await? {
        return Ok(answer(NOT_PROCEEDING));
    }
    let remaining: Vec<String> = chosen
        .iter()
        .filter(|s| s.state == StepState::Approved.as_str())
        .map(|s| s.id.clone())
        .collect();
    autoresolve_steps::set_many(
        txn,
        &run.org,
        &remaining,
        &[StepState::Approved],
        StepState::Superseded,
    )
    .await?;
    let step_id = held.id.clone();
    let mut rows = vec![held];
    rows.extend(next_rows);
    autoresolve_steps::insert_many(txn, rows).await?;
    Ok(Decision::Held { step_id })
}

fn held_step(
    run: &RunRow,
    caller: &AutoResolveConnection,
    req: &ConsumeRequest,
    seq: i32,
    now: i64,
) -> NewStep {
    NewStep {
        id: autoresolve_runs::new_run_id(),
        org: run.org.clone(),
        run_id: run.id.clone(),
        revision: run.revision,
        option_id: None,
        seq,
        kind: StepKind::Change.as_str().to_string(),
        connection_id: caller.id.clone(),
        connection_name: normalize_tool_name(&caller.name),
        tool: req.tool.clone(),
        arguments: req.arguments.to_string(),
        refs: "[]".to_string(),
        args_hash: args_hash(&req.arguments, &[]),
        reason: HELD_REASON.to_string(),
        preview: None,
        tool_def_hash: req.tool_def_hash.clone(),
        connection_fingerprint: None,
        state: StepState::Held,
        result: None,
        result_raw: None,
        consumed_at_us: None,
        finished_at_us: None,
        created_at_us: now,
    }
}

/// A done step keeps its pin and result so the summary and later references still find it; an
/// unrun step waits for a new approval to be pinned again.
fn copy_step(step: &StepRow, revision: i32, now: i64) -> NewStep {
    let done = step.state == StepState::Done.as_str();
    let kept = |v: &Option<String>| if done { v.clone() } else { None };
    NewStep {
        id: autoresolve_runs::new_run_id(),
        org: step.org.clone(),
        run_id: step.run_id.clone(),
        revision,
        option_id: Some(OPTION_IDS[0].to_string()),
        seq: step.seq,
        kind: step.kind.clone(),
        connection_id: step.connection_id.clone(),
        connection_name: step.connection_name.clone(),
        tool: step.tool.clone(),
        arguments: step.arguments.clone(),
        refs: step.refs.clone(),
        args_hash: step.args_hash.clone(),
        reason: step.reason.clone(),
        preview: step.preview.clone(),
        tool_def_hash: step.tool_def_hash.clone(),
        connection_fingerprint: kept(&step.connection_fingerprint),
        state: if done {
            StepState::Done
        } else {
            StepState::Proposed
        },
        result: kept(&step.result),
        result_raw: kept(&step.result_raw),
        consumed_at_us: step.consumed_at_us.filter(|_| done),
        finished_at_us: step.finished_at_us.filter(|_| done),
        created_at_us: now,
    }
}

fn revised_plan(run: &RunRow, rows: &[NewStep]) -> Result<PlanInput, AutoResolveError> {
    let stored: PlanInput = serde_json::from_str(run.plan.as_deref().unwrap_or_default())
        .map_err(anyhow::Error::from)?;
    let chosen = OPTION_IDS
        .iter()
        .position(|id| Some(*id) == run.chosen_option_id.as_deref())
        .and_then(|i| stored.options.into_iter().nth(i))
        .ok_or_else(|| anyhow::anyhow!("run {} has no chosen option in its plan", run.id))?;
    let steps = rows
        .iter()
        .map(step_input)
        .collect::<Result<Vec<_>, serde_json::Error>>()
        .map_err(anyhow::Error::from)?;
    Ok(PlanInput {
        // The held call was never classified, so the option is shown as changing production.
        options: vec![OptionInput {
            recommended: true,
            changes_production_directly: true,
            tradeoffs: HELD_TRADEOFFS.to_string(),
            steps,
            ..chosen
        }],
        omitted_count: 0,
        omitted_reason: None,
        missing_capability: None,
    })
}

fn step_input(row: &NewStep) -> Result<StepInput, serde_json::Error> {
    Ok(StepInput {
        connection: row.connection_name.clone(),
        tool: row.tool.clone(),
        kind: serde_json::from_value::<StepKind>(Value::String(row.kind.clone()))?,
        arguments: serde_json::from_str(&row.arguments)?,
        refs: serde_json::from_str(&row.refs)?,
        reason: row.reason.clone(),
        tool_def_hash: row.tool_def_hash.clone(),
        preview: row
            .preview
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
    })
}

/// The call is this step: same connection and tool, and the same arguments outside the paths
/// the system fills.
fn same_call(step: &StepRow, caller_id: Option<&str>, req: &ConsumeRequest) -> bool {
    caller_id == Some(step.connection_id.as_str())
        && step.tool == req.tool
        && args_hash(&req.arguments, &refs_of(step)) == step.args_hash
}

fn refs_of(step: &StepRow) -> Vec<StepRef> {
    serde_json::from_str(&step.refs).unwrap_or_else(|e| {
        log::error!("[autoresolve] step {} has unreadable refs: {e}", step.id);
        Vec::new()
    })
}

/// The unredacted results of the done steps, by seq.
fn recorded_results(chosen: &[&StepRow]) -> BTreeMap<u32, Value> {
    chosen
        .iter()
        .filter(|s| s.state == StepState::Done.as_str())
        .filter_map(|s| {
            let seq = u32::try_from(s.seq).ok()?;
            let raw = serde_json::from_str(s.result_raw.as_deref()?).ok()?;
            Some((seq, raw))
        })
        .collect()
}

fn step_outcome(input: &StepResultInput, last: bool) -> (StepState, Option<RunState>) {
    if input.unknown {
        (StepState::OutcomeUnknown, Some(RunState::OutcomeUnknown))
    } else if !input.ok {
        (StepState::Failed, Some(RunState::StepFailed))
    } else if last {
        (StepState::Done, Some(RunState::Checking))
    } else {
        (StepState::Done, None)
    }
}

/// The result as shown (its text items, else the JSON; redacted, then capped) and as later
/// references read it (exact, or nothing when too large).
fn stored_result(step_id: &str, result: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(result) = result else {
        return (None, None);
    };
    let raw = result.to_string();
    let raw = if raw.len() <= MAX_RAW_BYTES {
        Some(raw)
    } else {
        log::warn!(
            "[autoresolve] step {step_id} returned {} bytes; later steps cannot use its values",
            raw.len()
        );
        None
    };
    (Some(capped(shown_result(result))), raw)
}

fn capped(text: String) -> String {
    if text.len() <= RESULT_CAP_BYTES {
        return text;
    }
    let note = format!("\n… Truncated: the full result is {} bytes.", text.len());
    let mut cut = RESULT_CAP_BYTES.saturating_sub(note.len());
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}{note}", &text[..cut])
}

async fn write_evidence(seams: &Seams<'_>, org: &str, run_id: &str, step_id: &str) {
    let run = autoresolve_runs::get_with(seams.db, org, run_id).await;
    let steps = autoresolve_steps::list_for_run_with(seams.db, org, run_id).await;
    let (run, steps) = match (run, steps) {
        (Ok(Some(run)), Ok(steps)) => (run, steps),
        (Ok(None), _) => {
            log::warn!("[autoresolve] run {run_id} is gone; no step evidence");
            return;
        }
        (Err(e), _) | (_, Err(e)) => {
            log::error!("[autoresolve] step evidence for run {run_id}: {e}");
            return;
        }
    };
    match steps.iter().find(|s| s.id == step_id) {
        Some(step) => evidence::write_step(org, &run, step).await,
        None => log::warn!("[autoresolve] step {step_id} of run {run_id} is gone; no evidence"),
    }
}

fn is_proceeding(run: &RunRow) -> bool {
    run.state == RunState::Proceeding.as_str()
}

fn answer(message: &str) -> Decision {
    Decision::Answer(refuse(message))
}

fn refuse(message: &str) -> ConsumeResponse {
    ConsumeResponse::Refuse {
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use infra::table::entity::autoresolve_steps::Entity as Steps;
    use sea_orm::{DatabaseConnection, EntityTrait};
    use serde_json::json;

    use super::*;
    use crate::autoresolve::{
        ConnectionSource,
        approve::{ApproverFacts, Holders, approve_with},
        test_support::{ORG, RecordingTurns, memory_db, new_run},
    };

    const RUN: &str = "run1";
    const URL: &str = "https://github.example/mcp";
    const FP: &str = "conn-fp-c1";
    const DEF: &str = "d1";

    /// The registered connection `github` (id c1) as it is now; `None` once deleted.
    struct Github(Option<AutoResolveConnection>);

    #[async_trait::async_trait]
    impl ConnectionSource for Github {
        async fn get(
            &self,
            _org: &str,
            key: &str,
        ) -> anyhow::Result<Option<AutoResolveConnection>> {
            Ok(self.0.clone().filter(|c| c.id == key || c.name == key))
        }
    }

    /// Everyone is an org admin.
    struct Admins;

    #[async_trait::async_trait]
    impl ApproverFacts for Admins {
        async fn is_root(&self, _email: &str) -> bool {
            false
        }

        async fn is_org_admin(&self, _org: &str, _email: &str) -> bool {
            true
        }

        fn openfga_on(&self) -> bool {
            true
        }

        fn checks_bypassed(&self) -> bool {
            false
        }

        async fn holds(&self, _org: &str, _email: &str, _conn: &str) -> anyhow::Result<bool> {
            Ok(false)
        }

        async fn has_module_access(&self, _org: &str, _email: &str) -> anyhow::Result<bool> {
            Ok(true)
        }

        async fn may_edit_module(&self, _org: &str, _email: &str) -> anyhow::Result<bool> {
            Ok(true)
        }

        async fn holders(&self, _org: &str, _ids: &[String]) -> anyhow::Result<Holders> {
            Ok(Holders::default())
        }
    }

    struct Harness {
        db: DatabaseConnection,
        turns: RecordingTurns,
        connections: Github,
    }

    impl Harness {
        /// A run proceeding on revision 1, option A, every step approved on `github`.
        async fn new(steps: Vec<StepInput>, connections: Github) -> Self {
            let db = memory_db().await;
            autoresolve_runs::insert_with(&db, new_run(RUN))
                .await
                .unwrap();
            let rows: Vec<NewStep> = (1..).zip(&steps).map(|(seq, s)| row(seq, s)).collect();
            let plan = PlanInput {
                options: vec![OptionInput {
                    title: "Tag the fix".into(),
                    recommended: true,
                    changes_production_directly: false,
                    tradeoffs: String::new(),
                    reason: "asked".into(),
                    steps,
                    partial_fix: None,
                }],
                omitted_count: 0,
                omitted_reason: None,
                missing_capability: None,
            };
            let patch = RunPatch {
                plan: Some(serde_json::to_string(&plan).unwrap()),
                plan_fingerprint: Some(plan_fingerprint(&plan, 1)),
                chosen_option_id: Some(Some("A".into())),
                approved_by: Some(Some("ada@example.com".into())),
                approved_at_us: Some(Some(2)),
                updated_at_us: 2,
                ..Default::default()
            };
            let (from, to) = ([RunState::Investigating], RunState::Proceeding);
            assert!(
                autoresolve_runs::set_state_with(&db, ORG, RUN, &from, to, patch)
                    .await
                    .unwrap()
            );
            autoresolve_steps::insert_many(&db, rows).await.unwrap();
            Self {
                db,
                turns: RecordingTurns::default(),
                connections,
            }
        }

        fn seams(&self) -> Seams<'_> {
            Seams {
                db: &self.db,
                turns: &self.turns,
                connections: &self.connections,
                facts: &Admins,
            }
        }

        async fn consume(&self, req: ConsumeRequest) -> ConsumeResponse {
            consume_with(&self.seams(), ORG, RUN, req).await.unwrap()
        }

        async fn record_ok(&self, step_id: &str, result: Value) {
            let input = StepResultInput {
                ok: true,
                unknown: false,
                result: Some(result),
                error: None,
            };
            record_result_with(&self.seams(), ORG, RUN, step_id, input)
                .await
                .unwrap();
        }

        async fn run(&self) -> RunRow {
            autoresolve_runs::get_with(&self.db, ORG, RUN)
                .await
                .unwrap()
                .unwrap()
        }

        async fn steps(&self) -> Vec<StepRow> {
            Steps::find().all(&self.db).await.unwrap()
        }

        /// (state, error) of each step of `revision`, by seq, leaving out held rows.
        async fn states(&self, revision: i32) -> Vec<(String, Option<String>)> {
            let mut rows: Vec<StepRow> = self
                .steps()
                .await
                .into_iter()
                .filter(|s| s.revision == revision && s.option_id.is_some())
                .collect();
            rows.sort_by_key(|s| s.seq);
            rows.into_iter().map(|s| (s.state, s.error)).collect()
        }

        fn cancels(&self) -> usize {
            self.turns.cancelled.lock().unwrap().len()
        }
    }

    fn github(fingerprint: &str) -> Github {
        Github(Some(AutoResolveConnection {
            id: "c1".into(),
            name: "github".into(),
            url: URL.into(),
            read_headers: HashMap::from([("Authorization".into(), "R".into())]),
            write_headers: HashMap::from([("Authorization".into(), "W".into())]),
            fingerprint: fingerprint.into(),
        }))
    }

    fn step(tool: &str, arguments: Value, refs: Vec<StepRef>) -> StepInput {
        StepInput {
            connection: "github".into(),
            tool: tool.into(),
            kind: StepKind::Change,
            arguments,
            refs,
            reason: "needed".into(),
            tool_def_hash: DEF.into(),
            preview: None,
        }
    }

    /// Step 1 reads the head commit; step 2 tags the sha step 1 returned.
    fn head_then_tag() -> Vec<StepInput> {
        let sha = StepRef {
            arg_path: "/sha".into(),
            from_step: 1,
            result_path: "/head/sha".into(),
        };
        vec![
            step("get_head", json!({"repo": "x"}), vec![]),
            step("create_tag", json!({"sha": null}), vec![sha]),
        ]
    }

    fn row(seq: i32, s: &StepInput) -> NewStep {
        NewStep {
            id: format!("s{seq}"),
            org: ORG.into(),
            run_id: RUN.into(),
            revision: 1,
            option_id: Some("A".into()),
            seq,
            kind: s.kind.as_str().into(),
            connection_id: "c1".into(),
            connection_name: s.connection.clone(),
            tool: s.tool.clone(),
            arguments: s.arguments.to_string(),
            refs: serde_json::to_string(&s.refs).unwrap(),
            args_hash: args_hash(&s.arguments, &s.refs),
            reason: s.reason.clone(),
            preview: None,
            tool_def_hash: s.tool_def_hash.clone(),
            connection_fingerprint: Some(FP.into()),
            state: StepState::Approved,
            result: None,
            result_raw: None,
            consumed_at_us: None,
            finished_at_us: None,
            created_at_us: 1,
        }
    }

    fn call(tool: &str, arguments: Value) -> ConsumeRequest {
        ConsumeRequest {
            connection: "github".into(),
            tool: tool.into(),
            arguments,
            upstream_url: URL.into(),
            tool_def_hash: DEF.into(),
        }
    }

    fn run_with(step_id: &str, arguments: Value) -> ConsumeResponse {
        ConsumeResponse::Run {
            step_id: step_id.into(),
            arguments,
            headers: HashMap::from([("Authorization".into(), "W".into())]),
        }
    }

    fn state(name: &str, error: Option<&str>) -> (String, Option<String>) {
        (name.to_string(), error.map(str::to_string))
    }

    #[tokio::test]
    async fn consume_runs_steps_in_order_once() {
        enum Act {
            Call(ConsumeRequest, ConsumeResponse),
            Record(&'static str, StepResultInput),
        }
        use Act::{Call, Record};
        let ended = |ok: bool, unknown: bool, error: Option<&str>| StepResultInput {
            ok,
            unknown,
            result: Some(
                json!({"structuredContent": {"head": {"sha": "abc"}, "base": {"sha": "def"}}}),
            ),
            error: error.map(str::to_string),
        };
        let branch = || call("create_branch", json!({"name": "fix"}));
        let pr = || call("open_pr", json!({"title": "Fix"}));
        let head = || call("get_head", json!({"repo": "x"}));
        let tag = || call("create_tag", json!({"sha": "zzz"}));
        let tag_from = |path: &str| {
            let sha = StepRef {
                arg_path: "/sha".into(),
                from_step: 1,
                result_path: path.into(),
            };
            step("create_tag", json!({"sha": null}), vec![sha])
        };
        let branch_then_pr = vec![
            step("create_branch", json!({"name": "fix"}), vec![]),
            step("open_pr", json!({"title": "Fix"}), vec![]),
        ];
        let two_tags = vec![
            step("get_head", json!({"repo": "x"}), vec![]),
            tag_from("/head/sha"),
            tag_from("/base/sha"),
        ];
        let leak = "https://bot:secret@github.example/x.git";
        let done = || state("done", None);
        let cases = [
            (
                "in_order",
                branch_then_pr,
                vec![
                    Call(pr(), refuse("Run step 1 first.")),
                    Call(branch(), run_with("s1", json!({"name": "fix"}))),
                    Call(branch(), refuse(ALREADY_RAN)),
                    Call(pr(), refuse(STILL_RUNNING)),
                    Record("s1", ended(true, false, None)),
                    Call(pr(), run_with("s2", json!({"title": "Fix"}))),
                    Record("s2", ended(true, false, None)),
                ],
                vec![done(), done()],
                "checking",
                0,
                None,
            ),
            (
                "same_hash",
                two_tags,
                vec![
                    Call(head(), run_with("s1", json!({"repo": "x"}))),
                    Record("s1", ended(true, false, None)),
                    Call(tag(), run_with("s2", json!({"sha": "abc"}))),
                    Call(tag(), refuse(ALREADY_RAN)),
                    Record("s2", ended(true, false, None)),
                    Call(tag(), run_with("s3", json!({"sha": "def"}))),
                    Record("s3", ended(true, false, None)),
                ],
                vec![done(), done(), done()],
                "checking",
                0,
                None,
            ),
            (
                "outcome_unknown",
                head_then_tag(),
                vec![
                    Call(head(), run_with("s1", json!({"repo": "x"}))),
                    Record("s1", ended(false, true, None)),
                ],
                vec![state("outcome_unknown", None), state("not_run", None)],
                "outcome_unknown",
                1,
                Some("Step 1 may have run; its result is unknown."),
            ),
            (
                "failed",
                head_then_tag(),
                vec![
                    Call(head(), run_with("s1", json!({"repo": "x"}))),
                    Record("s1", ended(false, false, Some(leak))),
                ],
                vec![state("failed", Some("***")), state("not_run", None)],
                "step_failed",
                1,
                None,
            ),
        ];
        for (case, steps, acts, states, run_state, cancels, run_error) in cases {
            let h = Harness::new(steps, github(FP)).await;
            for (i, act) in acts.into_iter().enumerate() {
                match act {
                    Call(req, expected) => assert_eq!(h.consume(req).await, expected, "{case} {i}"),
                    Record(step_id, input) => {
                        record_result_with(&h.seams(), ORG, RUN, step_id, input)
                            .await
                            .unwrap()
                    }
                }
            }
            assert_eq!(h.states(1).await, states, "{case}");
            let run = h.run().await;
            assert_eq!(run.state, run_state, "{case}");
            assert_eq!(run.error.as_deref(), run_error, "{case}");
            assert_eq!((run.revision, run.turn_deadline_us), (1, None), "{case}");
            assert_eq!(h.cancels(), cancels, "{case}");
        }
    }

    #[tokio::test]
    async fn consume_refuses_when_a_pin_moved() {
        let moved = "The MCP or tool changed since approval.";
        let removed = "The github MCP was removed after approval.";
        let unreachable = "The github MCP could not be reached.";
        let get_head = || call("get_head", json!({"repo": "x"}));
        let renamed = Github(github(FP).0.map(|c| AutoResolveConnection {
            name: "github-prod".into(),
            ..c
        }));
        let cases = [
            (
                "connection_edited",
                github("conn-fp-c1-edited"),
                get_head(),
                moved,
            ),
            ("connection_deleted", Github(None), get_head(), removed),
            ("connection_renamed", renamed, get_head(), moved),
            (
                "url_differs",
                github(FP),
                ConsumeRequest {
                    upstream_url: "https://elsewhere.example/mcp".into(),
                    ..get_head()
                },
                moved,
            ),
            (
                "tool_def_hash_differs",
                github(FP),
                ConsumeRequest {
                    tool_def_hash: "d2".into(),
                    ..get_head()
                },
                moved,
            ),
            (
                "mcp_unreachable",
                github(FP),
                ConsumeRequest {
                    tool_def_hash: String::new(),
                    ..get_head()
                },
                unreachable,
            ),
        ];
        for (case, connections, req, message) in cases {
            let h = Harness::new(head_then_tag(), connections).await;
            let refused = h.consume(req).await;
            assert_eq!(
                serde_json::to_value(&refused).unwrap(),
                json!({"decision": "refuse", "message": message}),
                "{case}"
            );
            assert_eq!(
                h.states(1).await,
                vec![state("failed", Some(message)), state("not_run", None)],
                "{case}"
            );
            let run = h.run().await;
            assert_eq!(run.state, "step_failed", "{case}");
            assert!(run.ended_at_us.is_some(), "{case}");
            assert_eq!(h.cancels(), 1, "{case}");
        }
    }

    #[tokio::test]
    async fn unapproved_call_holds_and_asks_again() {
        let unapproved = ConsumeRequest {
            tool_def_hash: "d9".into(),
            ..call("delete_repo", json!({"repo": "x"}))
        };
        let elsewhere = ConsumeRequest {
            connection: "jira".into(),
            ..unapproved.clone()
        };
        let not_available = refuse("That MCP is not available to this run.");
        let cases = [
            ("unapproved_tool", unapproved, None),
            ("unregistered_connection", elsewhere, Some(not_available)),
        ];
        for (case, req, refused) in cases {
            let h = Harness::new(head_then_tag(), github(FP)).await;
            let answer = h.consume(req).await;
            if let Some(refused) = refused {
                assert_eq!(answer, refused, "{case}");
                let approved = vec![state("approved", None), state("approved", None)];
                assert_eq!(h.states(1).await, approved, "{case}");
                assert_eq!(h.steps().await.len(), 2, "{case}");
                assert_eq!(h.run().await.state, "proceeding", "{case}");
                assert_eq!(h.cancels(), 0, "{case}");
                continue;
            }
            let message =
                "Not run: this call was not approved. The run is waiting for a new approval.";
            assert_eq!(
                serde_json::to_value(&answer).unwrap(),
                json!({"decision": "hold", "message": message}),
                "{case}"
            );
            let steps = h.steps().await;
            let held: Vec<&StepRow> = steps.iter().filter(|s| s.option_id.is_none()).collect();
            assert_eq!(held.len(), 1, "{case}");
            assert_eq!(
                (
                    held[0].state.as_str(),
                    held[0].revision,
                    held[0].tool.as_str()
                ),
                ("held", 1, "delete_repo"),
                "{case}"
            );
            let originals = vec![state("superseded", None), state("superseded", None)];
            assert_eq!(h.states(1).await, originals, "{case}");
            assert!(
                steps
                    .iter()
                    .filter(|s| s.revision == 1 && s.option_id.is_some())
                    .all(|s| s.connection_fingerprint.as_deref() == Some(FP)),
                "{case}: superseded rows keep their pin"
            );
            let mut next: Vec<&StepRow> = steps.iter().filter(|s| s.revision == 2).collect();
            next.sort_by_key(|s| s.seq);
            let shape: Vec<(i32, &str, &str, &str, bool)> = next
                .iter()
                .map(|s| {
                    let opt = s.option_id.as_deref().unwrap_or_default();
                    (
                        s.seq,
                        s.tool.as_str(),
                        s.state.as_str(),
                        opt,
                        s.connection_fingerprint.is_some(),
                    )
                })
                .collect();
            assert_eq!(
                shape,
                vec![
                    (1, "get_head", "proposed", "A", false),
                    (2, "create_tag", "proposed", "A", false),
                    (3, "delete_repo", "proposed", "A", false),
                ],
                "{case}"
            );
            assert_eq!(
                (next[2].reason.as_str(), next[2].tool_def_hash.as_str()),
                ("Not in the approved plan", "d9"),
                "{case}"
            );
            let run = h.run().await;
            assert_eq!(run.state, "waiting_approval", "{case}");
            assert_eq!(
                (run.revision, run.chosen_option_id.as_deref()),
                (2, None),
                "{case}"
            );
            assert_eq!(
                (run.approved_by.as_deref(), run.approved_at_us),
                (None, None),
                "{case}"
            );
            assert!(
                run.approval_deadline_us.is_some_and(|d| d > now_micros()),
                "{case}"
            );
            let plan: PlanInput = serde_json::from_str(run.plan.as_deref().unwrap()).unwrap();
            let tools: Vec<&str> = plan
                .options
                .iter()
                .flat_map(|o| &o.steps)
                .map(|s| s.tool.as_str())
                .collect();
            assert_eq!(tools, ["get_head", "create_tag", "delete_repo"], "{case}");
            assert!(plan.options[0].changes_production_directly, "{case}");
            assert_eq!(
                run.plan_fingerprint,
                Some(plan_fingerprint(&plan, 2)),
                "{case}"
            );
            assert_eq!(h.cancels(), 1, "{case}");
        }
    }

    #[tokio::test]
    async fn consume_fills_references_from_step_one() {
        let missing = "A value from step 1 was not found.";
        let big = "x".repeat(RESULT_CAP_BYTES);
        let log = format!("pod log\n{big}");
        let inner = json!({"api_token": "inn3rs3cret", "log": big}).to_string();
        let cases = [
            (
                "found",
                json!({"sha": "abc"}),
                log.as_str(),
                "pod log",
                run_with("s2", json!({"sha": "abc"})),
                state("running", None),
                "proceeding",
            ),
            (
                "missing",
                json!({}),
                log.as_str(),
                "pod log",
                refuse(missing),
                state("failed", Some(missing)),
                "step_failed",
            ),
            (
                "secret inside a JSON text item",
                json!({"sha": "abc"}),
                inner.as_str(),
                r#"{"api_token":"***""#,
                run_with("s2", json!({"sha": "abc"})),
                state("running", None),
                "proceeding",
            ),
        ];
        for (case, head, text, starts, expected, step_two, run_state) in cases {
            let h = Harness::new(head_then_tag(), github(FP)).await;
            h.consume(call("get_head", json!({"repo": "x"}))).await;
            let result = json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": {"head": head, "api_token": "t0ps3cret", "log": big},
            });
            h.record_ok("s1", result).await;

            let tag = h.consume(call("create_tag", json!({"sha": "zzz"}))).await;
            assert_eq!(tag, expected, "{case}");
            assert_eq!(
                h.states(1).await,
                vec![state("done", None), step_two],
                "{case}"
            );
            assert_eq!(h.run().await.state, run_state, "{case}");
            let steps = h.steps().await;
            let s1 = steps.iter().find(|s| s.id == "s1").unwrap();
            let shown = s1.result.as_deref().unwrap();
            assert!(shown.len() <= RESULT_CAP_BYTES, "{case} {}", shown.len());
            assert!(shown.contains("Truncated"), "{case}");
            assert!(!shown.contains("s3cret"), "{case}: {}", &shown[..80]);
            assert!(shown.starts_with(starts), "{case}: the text, not the JSON");
            assert!(s1.result_raw.as_deref().unwrap().contains("t0ps3cret"));
        }
    }

    #[tokio::test]
    async fn a_hold_keeps_references_to_finished_steps() {
        let h = Harness::new(head_then_tag(), github(FP)).await;
        h.consume(call("get_head", json!({"repo": "x"}))).await;
        h.record_ok("s1", json!({"structuredContent": {"head": {"sha": "abc"}}}))
            .await;
        let held = h.consume(call("delete_repo", json!({"repo": "x"}))).await;
        assert!(matches!(held, ConsumeResponse::Hold { .. }), "{held:?}");

        let done: Vec<(String, Option<String>)> = h.states(2).await;
        assert_eq!(done[0], state("done", None));
        let fingerprint = h.run().await.plan_fingerprint.unwrap();
        approve_with(&h.seams(), ORG, RUN, "ada@example.com", "A", &fingerprint)
            .await
            .unwrap();
        let steps = h.steps().await;
        let id_of = |seq: i32| {
            let s = steps
                .iter()
                .find(|s| s.revision == 2 && s.seq == seq)
                .unwrap();
            s.id.clone()
        };
        let executed = h.turns.executed.lock().unwrap().clone();
        assert_eq!(
            executed,
            vec![vec![id_of(2), id_of(3)]],
            "step 1 is not run again"
        );

        let again = h.consume(call("get_head", json!({"repo": "x"}))).await;
        assert_eq!(again, refuse("This step already ran."));
        let tag = h.consume(call("create_tag", json!({"sha": "zzz"}))).await;
        assert_eq!(tag, run_with(&id_of(2), json!({"sha": "abc"})));
    }
}

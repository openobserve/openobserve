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

//! Plan and outcome intake: the model's `submit_plan` and `report_outcome`, checked and stored.

use std::collections::HashMap;

use config::{
    meta::autoresolve::{
        MAX_OPTIONS, OptionInput, OutcomeInput, PlanInput, RunState, StepKind, StepState, Verdict,
        args_hash, capitalized, named_mcp, plan_fingerprint,
    },
    utils::time::now_micros,
};
use infra::table::{
    autoresolve_runs::{self, RunPatch},
    autoresolve_steps::{self, NewStep},
    entity::autoresolve_runs::Model as RunRow,
};
use o2_enterprise::enterprise::ai::toolsets::push::normalize_tool_name;
use sea_orm::{DatabaseConnection, TransactionTrait};

use super::{
    AutoResolveError, ConnectionSource, LiveConnections, after_transition, approval_deadline_us,
    chosen_steps, mark_not_run, run_connection_ids, transition, transition_with,
};

/// The id of the option at each position of a normalised plan; a recommended one is `A`.
pub(crate) const OPTION_IDS: [&str; MAX_OPTIONS] = ["A", "B", "C", "D"];
const MAX_TITLE_CHARS: usize = 60;
const MAX_PARTIAL_FIX_CHARS: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct PlanAccepted {
    pub fingerprint: String,
    pub option_ids: Vec<String>,
}

/// Why a plan or outcome was refused; every message but `Db` is one sentence the model can act on.
#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("This run is not waiting for a plan.")]
    NotInvestigating,
    #[error("A newer plan replaced this one; do not submit it again.")]
    PlanChanged,
    #[error("This run is not waiting for an outcome.")]
    NotWaitingForOutcome,
    #[error("Before any step ran, the only outcome you can report is no_change.")]
    VerdictBeforeSteps,
    #[error("A plan needs at least one option or a missing capability.")]
    NoOptions,
    #[error("Option \"{option}\" has no steps; give it at least one step or leave it out.")]
    EmptyOption { option: String },
    #[error(
        "The plan uses {}, which this AutoResolve doesn't have. If the fix needs it, describe it in missing_capability instead of an option.",
        named_mcp(.0)
    )]
    UnknownConnection(String),
    #[error("{} has no tool named \"{tool}\".", capitalized(&named_mcp(connection)))]
    UnknownTool { connection: String, tool: String },
    #[error(
        "Step {seq} of option \"{option}\" refers to step {from_step}, but a step can only use the results of steps before it."
    )]
    BadRef {
        option: String,
        seq: u32,
        from_step: u32,
    },
    #[error(
        "In option \"{option}\", the dry run of \"{tool}\" on {} must come before its change step.",
        named_mcp(connection)
    )]
    BadOrder {
        option: String,
        connection: String,
        tool: String,
    },
    #[error(transparent)]
    Db(#[from] anyhow::Error),
}

impl PlanError {
    /// The HTTP status the internal route answers with.
    pub fn status(&self) -> u16 {
        match self {
            Self::NotInvestigating | Self::PlanChanged | Self::NotWaitingForOutcome => 409,
            Self::Db(_) => 500,
            _ => 422,
        }
    }
}

impl From<AutoResolveError> for PlanError {
    fn from(e: AutoResolveError) -> Self {
        match e {
            AutoResolveError::Db(e) => Self::Db(e),
            e => Self::Db(anyhow::anyhow!(e.to_string())),
        }
    }
}

impl From<infra::errors::Error> for PlanError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Db(e.into())
    }
}

impl From<sea_orm::DbErr> for PlanError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Db(e.into())
    }
}

/// Stores the plan as revision steps and asks for approval, or ends the run `no_change` when no
/// registered tool can do the job. A refusal is kept on the run for its turn's end message.
pub async fn accept_plan(
    org: &str,
    run_id: &str,
    plan: PlanInput,
) -> Result<PlanAccepted, PlanError> {
    let db = infra::db::get_orm_client_rw().await;
    match intake_plan(db, &LiveConnections, org, run_id, plan).await {
        Ok((accepted, to)) => {
            after_transition(org, run_id, to).await;
            Ok(accepted)
        }
        Err(e) => {
            remember_refusal(db, org, run_id, &[RunState::Investigating], &e).await;
            Err(e)
        }
    }
}

/// Ends the run with the model's verdict: before any step ran (`investigating`, or `proceeding`
/// with nothing sent) only `no_change`, from `checking` any verdict.
pub async fn accept_outcome(
    org: &str,
    run_id: &str,
    outcome: OutcomeInput,
) -> Result<(), PlanError> {
    let db = infra::db::get_orm_client_rw().await;
    let result = record_outcome(org, run_id, outcome).await;
    if let Err(e) = &result {
        let states = [RunState::Investigating, RunState::Checking];
        remember_refusal(db, org, run_id, &states, e).await;
    }
    result
}

/// The connection and action of a `missing_capability` written as `needs <name>: <action>`,
/// with the name normalised; `None` for any other text.
pub(crate) fn parse_missing_connection(text: &str) -> Option<(String, String)> {
    let text = text.trim();
    let head = text.get(..6)?;
    if !head.eq_ignore_ascii_case("needs ") {
        return None;
    }
    let (name, action) = text[6..].split_once(':')?;
    let (name, action) = (name.trim(), action.trim());
    if name.is_empty() || action.is_empty() {
        return None;
    }
    Some((normalize_tool_name(name), action.to_string()))
}

async fn intake_plan(
    db: &DatabaseConnection,
    source: &dyn ConnectionSource,
    org: &str,
    run_id: &str,
    plan: PlanInput,
) -> Result<(PlanAccepted, RunState), PlanError> {
    let run = autoresolve_runs::get_with(db, org, run_id)
        .await?
        .filter(|r| r.state == RunState::Investigating.as_str())
        .ok_or(PlanError::NotInvestigating)?;
    let plan = normalise(plan)?;
    let allowed = run_connection_ids(&run)?;
    let connection_ids = resolve_connections(source, org, &plan, &allowed).await?;
    let revision = next_revision(&run);
    let fingerprint = plan_fingerprint(&plan, u32::try_from(revision).unwrap_or_default());
    let now = now_micros();
    let steps = new_steps(&run, revision, &plan, &connection_ids, now)?;
    let option_ids = option_ids(&plan);
    let (to, patch) = plan_patch(plan, revision, &fingerprint, now)?;

    let txn = db.begin().await?;
    // A plan accepted between the read above and here would make `revision` stale.
    let locked = autoresolve_runs::locked(&txn, org, run_id).await?;
    let still_same = locked.as_ref().is_some_and(|r| {
        r.state == run.state
            && r.revision == run.revision
            && r.plan_fingerprint == run.plan_fingerprint
    });
    if !still_same {
        let investigating = locked.is_some_and(|r| r.state == run.state);
        return Err(if investigating {
            PlanError::PlanChanged
        } else {
            PlanError::NotInvestigating
        });
    }
    if !transition_with(&txn, org, run_id, &[RunState::Investigating], to, patch).await? {
        return Err(PlanError::NotInvestigating);
    }
    autoresolve_steps::insert_many(&txn, steps).await?;
    txn.commit().await?;
    let accepted = PlanAccepted {
        fingerprint,
        option_ids,
    };
    Ok((accepted, to))
}

async fn record_outcome(org: &str, run_id: &str, outcome: OutcomeInput) -> Result<(), PlanError> {
    let state = autoresolve_runs::get(org, run_id)
        .await?
        .and_then(|r| RunState::parse(&r.state))
        .ok_or(PlanError::NotWaitingForOutcome)?;
    let to = outcome_target(state, outcome.verdict)?;
    let patch = RunPatch {
        outcome_verdict: Some(Some(outcome.verdict.as_str().to_string())),
        outcome_explanation: Some(Some(outcome.explanation)),
        error: Some(None),
        ..Default::default()
    };
    if state == RunState::Proceeding {
        let db = infra::db::get_orm_client_rw().await;
        end_before_steps_with(db, org, run_id, patch).await?;
        after_transition(org, run_id, to).await;
        return Ok(());
    }
    if !transition(org, run_id, &[state], to, patch).await? {
        return Err(PlanError::NotWaitingForOutcome);
    }
    Ok(())
}

/// Ends a run whose execute turn found the change no longer needed: `no_change`, its approved
/// steps not run, and only while none of them was sent.
async fn end_before_steps_with(
    db: &DatabaseConnection,
    org: &str,
    run_id: &str,
    patch: RunPatch,
) -> Result<(), PlanError> {
    let txn = db.begin().await?;
    let run = autoresolve_runs::locked(&txn, org, run_id)
        .await?
        .filter(|r| r.state == RunState::Proceeding.as_str())
        .ok_or(PlanError::NotWaitingForOutcome)?;
    let steps = autoresolve_steps::list_for_run_with(&txn, org, run_id).await?;
    let chosen = chosen_steps(&run, &steps);
    if chosen.iter().any(|s| s.consumed_at_us.is_some()) {
        return Err(PlanError::NotWaitingForOutcome);
    }
    let approved = chosen
        .iter()
        .filter(|s| s.state == StepState::Approved.as_str())
        .count();
    // A step sent after the read above would not move; the rollback keeps its run proceeding.
    if mark_not_run(&txn, org, &chosen).await? != approved as u64 {
        return Err(PlanError::NotWaitingForOutcome);
    }
    let (from, to) = ([RunState::Proceeding], RunState::NoChange);
    if !transition_with(&txn, org, run_id, &from, to, patch).await? {
        return Err(PlanError::NotWaitingForOutcome);
    }
    txn.commit().await?;
    Ok(())
}

/// Keeps the refusal on the run for its turn's end message, only in states whose end reads it.
async fn remember_refusal(
    db: &DatabaseConnection,
    org: &str,
    run_id: &str,
    states: &[RunState],
    e: &PlanError,
) {
    if matches!(e, PlanError::Db(_)) {
        log::error!("[autoresolve] run {run_id} intake failed: {e}");
        return;
    }
    // A newer plan owns the run, so this refusal must not become its failure text.
    if matches!(e, PlanError::PlanChanged) {
        return;
    }
    let stored =
        autoresolve_runs::set_error_if_state_with(db, org, run_id, states, Some(e.to_string()))
            .await;
    if let Err(err) = stored {
        log::error!("[autoresolve] run {run_id} could not keep its refusal: {err}");
    }
}

/// Maps every connection key the plan names to its id, refusing one outside the run's set.
async fn resolve_connections(
    source: &dyn ConnectionSource,
    org: &str,
    plan: &PlanInput,
    allowed: &[String],
) -> Result<HashMap<String, String>, PlanError> {
    let mut ids = HashMap::new();
    for key in plan
        .options
        .iter()
        .flat_map(|o| &o.steps)
        .map(|s| &s.connection)
    {
        if ids.contains_key(key) {
            continue;
        }
        let id = source
            .get(org, key)
            .await?
            .filter(|c| normalize_tool_name(&c.name) == *key)
            .filter(|c| allowed.contains(&c.id))
            .map(|c| c.id)
            .ok_or_else(|| PlanError::UnknownConnection(short(key)))?;
        ids.insert(key.clone(), id);
    }
    Ok(ids)
}

/// The first plan keeps the run's starting revision; a replan takes the next one.
fn next_revision(run: &RunRow) -> i32 {
    if run.plan.is_some() {
        run.revision + 1
    } else {
        run.revision
    }
}

fn new_steps(
    run: &RunRow,
    revision: i32,
    plan: &PlanInput,
    connection_ids: &HashMap<String, String>,
    now: i64,
) -> Result<Vec<NewStep>, PlanError> {
    let mut steps = Vec::new();
    for (option, option_id) in plan.options.iter().zip(OPTION_IDS) {
        for (seq, step) in (1..).zip(&option.steps) {
            steps.push(NewStep {
                id: autoresolve_runs::new_run_id(),
                org: run.org.clone(),
                run_id: run.id.clone(),
                revision,
                option_id: Some(option_id.to_string()),
                seq,
                kind: step.kind.as_str().to_string(),
                connection_id: connection_ids
                    .get(&step.connection)
                    .cloned()
                    .unwrap_or_default(),
                connection_name: step.connection.clone(),
                tool: step.tool.clone(),
                arguments: step.arguments.to_string(),
                refs: serde_json::to_string(&step.refs).map_err(anyhow::Error::from)?,
                args_hash: args_hash(&step.arguments, &step.refs),
                reason: step.reason.clone(),
                preview: step.preview.as_ref().map(|p| p.to_string()),
                tool_def_hash: step.tool_def_hash.clone(),
                connection_fingerprint: None,
                state: StepState::Proposed,
                result: None,
                result_raw: None,
                consumed_at_us: None,
                finished_at_us: None,
                created_at_us: now,
            });
        }
    }
    Ok(steps)
}

/// What the run becomes: `no_change` with the missing capability as its explanation when the
/// plan has no option, else `waiting_approval` until the approval deadline.
fn plan_patch(
    plan: PlanInput,
    revision: i32,
    fingerprint: &str,
    now: i64,
) -> Result<(RunState, RunPatch), PlanError> {
    let missing = plan
        .options
        .is_empty()
        .then(|| plan.missing_capability.clone())
        .flatten();
    let mut patch = RunPatch {
        revision: Some(revision),
        plan: Some(serde_json::to_string(&plan).map_err(anyhow::Error::from)?),
        plan_fingerprint: Some(fingerprint.to_string()),
        error: Some(None),
        updated_at_us: now,
        ..Default::default()
    };
    let Some(missing) = missing else {
        patch.approval_deadline_us = Some(Some(approval_deadline_us(now)));
        return Ok((RunState::WaitingApproval, patch));
    };
    patch.outcome_verdict = Some(Some(Verdict::NoChange.as_str().to_string()));
    patch.outcome_explanation = Some(Some(missing));
    Ok((RunState::NoChange, patch))
}

/// Clamps to [MAX_OPTIONS] options with the recommended one first, keys every step by its
/// connection key, and refuses a plan whose steps cannot run as written.
fn normalise(mut plan: PlanInput) -> Result<PlanInput, PlanError> {
    plan.missing_capability = plan.missing_capability.filter(|c| !c.trim().is_empty());
    if plan.options.is_empty() {
        return match plan.missing_capability {
            Some(_) => Ok(plan),
            None => Err(PlanError::NoOptions),
        };
    }
    for option in &mut plan.options {
        option.partial_fix = option
            .partial_fix
            .as_deref()
            .map(|p| cut(p, MAX_PARTIAL_FIX_CHARS))
            .filter(|p| !p.is_empty());
    }
    // Moved first before clamping, so the model's pick is never the one left out; a partial
    // fix is never the pick while a full one exists.
    let full = |o: &OptionInput| o.partial_fix.is_none();
    let pick = plan
        .options
        .iter()
        .position(|o| o.recommended && full(o))
        .or_else(|| plan.options.iter().position(full))
        .or_else(|| plan.options.iter().position(|o| o.recommended))
        .unwrap_or(0);
    let recommended = plan.options.remove(pick);
    plan.options.insert(0, recommended);
    let recommend_first = plan.missing_capability.is_none() && full(&plan.options[0]);
    for (i, option) in plan.options.iter_mut().enumerate() {
        option.recommended = i == 0 && recommend_first;
    }
    let dropped = plan.options.len().saturating_sub(MAX_OPTIONS);
    plan.options.truncate(MAX_OPTIONS);
    plan.omitted_count = plan
        .omitted_count
        .saturating_add(u32::try_from(dropped).unwrap_or(u32::MAX));
    for option in &mut plan.options {
        for step in &mut option.steps {
            step.connection = normalize_tool_name(&step.connection);
        }
        check_option(option)?;
    }
    Ok(plan)
}

fn check_option(option: &OptionInput) -> Result<(), PlanError> {
    let title = short(&option.title);
    if option.steps.is_empty() {
        return Err(PlanError::EmptyOption { option: title });
    }
    for (i, step) in option.steps.iter().enumerate() {
        let seq = u32::try_from(i + 1).unwrap_or(u32::MAX);
        if step.tool_def_hash.is_empty() {
            return Err(PlanError::UnknownTool {
                connection: short(&step.connection),
                tool: short(&step.tool),
            });
        }
        if let Some(r) = step
            .refs
            .iter()
            .find(|r| r.from_step == 0 || r.from_step >= seq)
        {
            return Err(PlanError::BadRef {
                option: title,
                seq,
                from_step: r.from_step,
            });
        }
        let changed_before = option.steps[..i].iter().any(|s| {
            s.kind == StepKind::Change && s.connection == step.connection && s.tool == step.tool
        });
        if step.kind == StepKind::DryRun && changed_before {
            return Err(PlanError::BadOrder {
                option: title,
                connection: short(&step.connection),
                tool: short(&step.tool),
            });
        }
    }
    Ok(())
}

fn option_ids(plan: &PlanInput) -> Vec<String> {
    OPTION_IDS
        .iter()
        .take(plan.options.len())
        .map(|id| id.to_string())
        .collect()
}

/// The state an outcome ends the run in, or why it is refused in `state`.
fn outcome_target(state: RunState, verdict: Verdict) -> Result<RunState, PlanError> {
    match (state, verdict) {
        (RunState::Investigating | RunState::Proceeding, Verdict::NoChange) => {
            Ok(RunState::NoChange)
        }
        (RunState::Investigating | RunState::Proceeding, _) => Err(PlanError::VerdictBeforeSteps),
        (RunState::Checking, Verdict::Worked) => Ok(RunState::Worked),
        (RunState::Checking, Verdict::NoChange) => Ok(RunState::NoChange),
        (RunState::Checking, Verdict::Worse) => Ok(RunState::Worse),
        _ => Err(PlanError::NotWaitingForOutcome),
    }
}

fn short(text: &str) -> String {
    cut(text, MAX_TITLE_CHARS)
}

/// At most `max_chars` characters, the ellipsis that marks a cut included.
fn cut(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().nth(max_chars).is_none() {
        return text.to_string();
    }
    let at = text
        .char_indices()
        .nth(max_chars.saturating_sub(1))
        .map_or(0, |(at, _)| at);
    format!("{}…", &text[..at])
}

#[cfg(test)]
mod tests {
    use config::meta::autoresolve::{OptionInput, StepInput, StepRef};
    use o2_enterprise::enterprise::ai::toolsets::AutoResolveConnection;
    use serde_json::json;

    use super::*;

    /// Titles in order, omitted count, and whether the first option is recommended.
    type Expect = Result<(&'static [&'static str], u32, bool), fn(&PlanError) -> bool>;

    fn step(connection: &str, tool: &str, kind: StepKind, from: &[u32]) -> StepInput {
        StepInput {
            connection: connection.into(),
            tool: tool.into(),
            kind,
            arguments: json!({}),
            refs: from
                .iter()
                .map(|&from_step| StepRef {
                    arg_path: "/sha".into(),
                    from_step,
                    result_path: "/sha".into(),
                })
                .collect(),
            reason: String::new(),
            tool_def_hash: "h".into(),
            preview: None,
        }
    }

    fn option(title: &str, recommended: bool, steps: Vec<StepInput>) -> OptionInput {
        OptionInput {
            title: title.into(),
            recommended,
            changes_production_directly: false,
            tradeoffs: String::new(),
            reason: String::new(),
            steps,
            partial_fix: None,
        }
    }

    fn plain(title: &str, recommended: bool) -> OptionInput {
        option(
            title,
            recommended,
            vec![step("gh", "merge", StepKind::Change, &[])],
        )
    }

    fn partial(title: &str, recommended: bool, fix: &str) -> OptionInput {
        OptionInput {
            partial_fix: Some(fix.into()),
            ..plain(title, recommended)
        }
    }

    fn plan(options: Vec<OptionInput>, missing: Option<&str>) -> PlanInput {
        PlanInput {
            options,
            omitted_count: 1,
            omitted_reason: None,
            missing_capability: missing.map(String::from),
        }
    }

    #[test]
    fn normalise_plan_clamps_orders_and_assigns_ids() {
        use StepKind::{Change, DryRun};
        let six: Vec<_> = (1..=6).map(|i| plain(&format!("o{i}"), i == 5)).collect();
        let unhashed = |tool: &str| {
            let mut s = step("gh", tool, Change, &[]);
            s.tool_def_hash.clear();
            s
        };
        let no_hash = unhashed("restart");
        let dry_after_change = vec![
            step("GitHub", "deploy", Change, &[]),
            step("github", "deploy", DryRun, &[]),
        ];
        let dry_first = vec![
            step("gh", "deploy", DryRun, &[]),
            step("gh", "deploy", Change, &[1]),
        ];
        let dry_other_tool = vec![
            step("gh", "deploy", Change, &[]),
            step("gh", "rollback", DryRun, &[]),
        ];
        let long_no_hash = unhashed(&"t".repeat(500));
        #[rustfmt::skip]
        let cases: [(&str, PlanInput, Expect); 18] = [
            ("six_options", plan(six, None), Ok((&["o5", "o1", "o2", "o3"], 3, true))),
            ("none_recommended", plan(vec![plain("o1", false), plain("o2", false)], None), Ok((&["o1", "o2"], 1, true))),
            ("two_recommended", plan(vec![plain("o1", false), plain("o2", true), plain("o3", true)], None), Ok((&["o2", "o1", "o3"], 1, true))),
            ("dry_run_first", plan(vec![option("o1", true, dry_first)], None), Ok((&["o1"], 1, true))),
            ("dry_run_of_other_tool_after_change", plan(vec![option("o1", true, dry_other_tool)], None), Ok((&["o1"], 1, true))),
            ("only_missing_capability", plan(vec![], Some("restart pods")), Ok((&[], 1, true))),
            ("no_options", plan(vec![], Some(" ")), Err(|e| matches!(e, PlanError::NoOptions))),
            ("empty_option", plan(vec![plain("o1", true), option("o2", false, vec![])], None),
                Err(|e| matches!(e, PlanError::EmptyOption { .. }) && e.to_string().contains("o2"))),
            ("ref_to_later_step", plan(vec![option("o1", true, vec![step("gh", "a", Change, &[2]), step("gh", "b", Change, &[])])], None),
                Err(|e| matches!(e, PlanError::BadRef { seq: 1, from_step: 2, .. }))),
            ("ref_to_itself", plan(vec![option("o1", true, vec![step("gh", "a", Change, &[]), step("gh", "b", Change, &[2])])], None),
                Err(|e| matches!(e, PlanError::BadRef { seq: 2, from_step: 2, .. }))),
            ("ref_to_step_zero", plan(vec![option("o1", true, vec![step("gh", "a", Change, &[]), step("gh", "b", Change, &[0])])], None),
                Err(|e| matches!(e, PlanError::BadRef { seq: 2, from_step: 0, .. }))),
            ("dry_run_after_change", plan(vec![option("o1", true, dry_after_change)], None),
                Err(|e| matches!(e, PlanError::BadOrder { .. }) && e.to_string().contains("deploy"))),
            ("empty_tool_def_hash", plan(vec![option("o1", true, vec![no_hash])], None),
                Err(|e| matches!(e, PlanError::UnknownTool { .. }) && e.to_string().contains("restart"))),
            ("long_tool_name_is_cut", plan(vec![option("o1", true, vec![long_no_hash])], None),
                Err(|e| matches!(e, PlanError::UnknownTool { .. }) && e.to_string().len() < 200)),
            ("missing_with_partial_options", plan(vec![partial("o1", true, "restarts the database"), partial("o2", false, "slow")], Some("needs postgres: end session 4211")),
                Ok((&["o1", "o2"], 1, false))),
            ("partial_not_recommended", plan(vec![plain("o1", false), partial("o2", true, "restarts the database")], None), Ok((&["o1", "o2"], 1, true))),
            ("blank_partial_fix", plan(vec![plain("o1", false), partial("o2", true, "  ")], None), Ok((&["o2", "o1"], 1, true))),
            ("long_partial_fix_is_cut", plan(vec![plain("o1", false), partial("o2", true, &"é".repeat(200))], None), Ok((&["o1", "o2"], 1, true))),
        ];
        for (name, input, expect) in cases {
            match (normalise(input), expect) {
                (Ok(got), Ok((titles, omitted, recommend_first))) => {
                    let got_titles: Vec<&str> =
                        got.options.iter().map(|o| o.title.as_str()).collect();
                    assert_eq!(got_titles, titles, "{name}");
                    assert_eq!(got.omitted_count, omitted, "{name}");
                    let partial_len =
                        |o: &OptionInput| o.partial_fix.as_ref().map(|p| p.chars().count());
                    assert!(
                        got.options
                            .iter()
                            .filter_map(partial_len)
                            .all(|n| n <= MAX_PARTIAL_FIX_CHARS),
                        "{name}: a partial fix is stored within its limit"
                    );
                    let flags: Vec<bool> = got.options.iter().map(|o| o.recommended).collect();
                    let first_only: Vec<bool> = (0..titles.len())
                        .map(|i| i == 0 && recommend_first)
                        .collect();
                    assert_eq!(flags, first_only, "{name}");
                    assert_eq!(
                        option_ids(&got),
                        ["A", "B", "C", "D"][..titles.len()],
                        "{name}"
                    );
                }
                (Err(e), Err(is_expected)) => assert!(is_expected(&e), "{name}: {e:?}"),
                (got, _) => panic!("{name}: unexpected {got:?}"),
            }
        }
    }

    #[test]
    fn outcome_from_investigating_is_only_no_change() {
        use RunState::*;
        #[rustfmt::skip]
        let cases = [
            (Investigating, Verdict::NoChange, Ok(NoChange)),
            (Investigating, Verdict::Worked, Err(422)),
            (Investigating, Verdict::Worse, Err(422)),
            (Checking, Verdict::Worked, Ok(Worked)),
            (Checking, Verdict::NoChange, Ok(NoChange)),
            (Checking, Verdict::Worse, Ok(Worse)),
            (WaitingApproval, Verdict::NoChange, Err(409)),
            // The execute turn's re-read found the change no longer needed.
            (Proceeding, Verdict::NoChange, Ok(NoChange)),
            (Proceeding, Verdict::Worked, Err(422)),
            (Worked, Verdict::Worked, Err(409)),
        ];
        for (state, verdict, expect) in cases {
            let got = outcome_target(state, verdict).map_err(|e| e.status());
            assert_eq!(got, expect, "{state:?} {verdict:?}");
        }
    }

    #[tokio::test]
    async fn an_outcome_before_any_step_was_sent_ends_the_run_with_its_steps_not_run() {
        use crate::autoresolve::test_support::{ORG, memory_db, new_run, new_step};
        for (case, sent, want) in [
            ("none sent", false, Ok("not_run")),
            ("one sent", true, Err(409)),
        ] {
            let db = memory_db().await;
            autoresolve_runs::insert_with(&db, new_run("r1"))
                .await
                .unwrap();
            let approved = |id: &str, seq: i32| NewStep {
                state: StepState::Approved,
                ..new_step("r1", id, "A", seq, "c1", "code-host")
            };
            let mut first = approved("s1", 1);
            if sent {
                (first.state, first.consumed_at_us) = (StepState::Running, Some(3));
            }
            autoresolve_steps::insert_many(&db, vec![first, approved("s2", 2)])
                .await
                .unwrap();
            let approval = RunPatch {
                chosen_option_id: Some(Some("A".into())),
                updated_at_us: 2,
                ..Default::default()
            };
            let from = [RunState::Investigating];
            autoresolve_runs::set_state_with(&db, ORG, "r1", &from, RunState::Proceeding, approval)
                .await
                .unwrap();

            let got = end_before_steps_with(&db, ORG, "r1", RunPatch::default()).await;

            let run = autoresolve_runs::get_with(&db, ORG, "r1")
                .await
                .unwrap()
                .unwrap();
            let steps = autoresolve_steps::list_for_run_with(&db, ORG, "r1")
                .await
                .unwrap();
            let second = steps.iter().find(|s| s.id == "s2").unwrap();
            match want {
                Ok(step_state) => {
                    assert!(got.is_ok(), "{case}: {got:?}");
                    assert_eq!(
                        (run.state.as_str(), second.state.as_str()),
                        ("no_change", step_state)
                    );
                }
                Err(status) => {
                    assert_eq!(got.map_err(|e| e.status()), Err(status), "{case}");
                    assert_eq!(
                        (run.state.as_str(), second.state.as_str()),
                        ("proceeding", "approved")
                    );
                }
            }
        }
    }

    #[test]
    fn missing_connection_parses_needs_name_action() {
        let some = |name: &str, action: &str| Some((name.to_string(), action.to_string()));
        let cases = [
            (
                "needs postgres: end session 4211 (pg_terminate_backend)",
                some("postgres", "end session 4211 (pg_terminate_backend)"),
            ),
            (
                "  Needs   Postgres :  end session 4211 ",
                some("postgres", "end session 4211"),
            ),
            ("needs postgres end session 4211", None),
            ("needs : end session", None),
            ("no connected tool can end a database session", None),
        ];
        for (text, want) in cases {
            assert_eq!(parse_missing_connection(text), want, "{text}");
        }
    }

    struct OrgConnections;

    #[async_trait::async_trait]
    impl ConnectionSource for OrgConnections {
        async fn get(
            &self,
            _org: &str,
            key: &str,
        ) -> anyhow::Result<Option<AutoResolveConnection>> {
            let id = match key {
                "github" => "c1",
                "postgres" => "c9",
                _ => return Ok(None),
            };
            Ok(Some(AutoResolveConnection {
                id: id.into(),
                name: key.into(),
                url: format!("https://{key}.example"),
                read_headers: HashMap::new(),
                write_headers: HashMap::new(),
                fingerprint: format!("fp-{id}"),
            }))
        }
    }

    #[tokio::test]
    async fn resolve_connections_refuses_off_run_connections() {
        let cases = [
            ("on the run", "github", None),
            (
                "in the org, not on the run",
                "postgres",
                Some("The plan uses the postgres MCP, which this AutoResolve doesn't have."),
            ),
            (
                "not in the org",
                "nope",
                Some("The plan uses the nope MCP, which this AutoResolve doesn't have."),
            ),
        ];
        for (name, key, refused) in cases {
            let input = plan(
                vec![option(
                    "o1",
                    true,
                    vec![step(key, "restart", StepKind::Change, &[])],
                )],
                None,
            );
            let got =
                resolve_connections(&OrgConnections, "acme", &input, &["c1".to_string()]).await;
            match (got, refused) {
                (Ok(ids), None) => {
                    assert_eq!(ids.get(key).map(String::as_str), Some("c1"), "{name}")
                }
                (Err(e), Some(text)) => {
                    let e = e.to_string();
                    assert!(
                        e.starts_with(text) && e.contains("missing_capability"),
                        "{name}: {e}"
                    );
                }
                (got, _) => panic!("{name}: unexpected {got:?}"),
            }
        }
    }
}

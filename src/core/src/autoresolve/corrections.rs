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

//! What a person tells a run after its plan or its outcome: a correction kept for the saved
//! AutoResolve, a "yes, it fixed it" verdict, and a connection added so the run can plan again.

use std::collections::HashMap;

use config::{
    meta::autoresolve::{
        PersonVerdict, PlanInput, RunState, StepState, TriggerKind, mcp_count, named_mcp,
    },
    utils::time::now_micros,
};
use infra::table::{
    autoresolve as flows_table, autoresolve_corrections,
    autoresolve_runs::{self, AddedConnection},
    autoresolve_steps,
    entity::{
        autoresolve_corrections::Model as CorrectionRow, autoresolve_runs::Model as RunRow,
        autoresolve_steps::Model as StepRow,
    },
};
use o2_enterprise::enterprise::{
    ai::toolsets::push::normalize_tool_name, common::config::get_config as get_o2_config,
};
use sea_orm::TransactionTrait;
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::{
    approve::{
        self, ApproveError, Seams, VERDICT_STATE, authorize_decision, edit_refusal_with,
        locked_unchanged, person_verdict_json, relaunch_planning, replan_patch, waiting_in_time,
    },
    distinct_ids, evidence,
    live::AutoResolveConnectionRef,
    plan::parse_missing_connection,
    run_connection_ids,
    saved::{self, SavedError, SavedInput, SavedSeams},
    saved_connections,
};

/// The most corrections one list shows; `total` still counts them all.
const LIST_LIMIT: u64 = 100;
const REMOVE_ACTION: &str = "remove this AutoResolve's corrections";
const ADD_STATE: &str = "An MCP can be added only while the plan waits for approval, or after a plan that found no option.";
const NOT_NEEDED: &str =
    "This run ended without an option, so it takes only the MCP its plan said it needs.";
const ADD_ACTION: &str = "add an MCP to this AutoResolve";
const RUN_MOVED: &str = "This run changed while you answered; reload it.";

/// One active correction of a saved AutoResolve, as its page lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AutoResolveCorrection {
    pub id: String,
    /// `wrong_cause`, `wrong_fix`, `out_of_scope` or `not_fixed`.
    pub kind: String,
    pub note: String,
    pub option_title: Option<String>,
    pub run_id: String,
    pub revision: i32,
    pub created_by: String,
    pub created_at_us: i64,
    /// When the run it was sent on started; null once that run is gone.
    pub run_started_at_us: Option<i64>,
}

impl AutoResolveCorrection {
    fn new(row: CorrectionRow, run_started_at_us: Option<i64>) -> Self {
        Self {
            id: row.id,
            kind: row.kind,
            note: row.note,
            option_title: row.option_title,
            run_id: row.run_id,
            revision: row.revision,
            created_by: row.created_by,
            created_at_us: row.created_at_us,
            run_started_at_us,
        }
    }
}

/// `GET …/saved/{autoresolve_id}/corrections`: active ones, newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct CorrectionList {
    pub corrections: Vec<AutoResolveCorrection>,
    pub total: u64,
    /// The caller may edit the AutoResolve, so may remove its corrections.
    pub can_remove: bool,
}

/// Records "Yes, it fixed it" on an ended run that made its change; no new plan.
pub async fn record_verdict(org: &str, run_id: &str, email: &str) -> Result<(), ApproveError> {
    record_verdict_with(&Seams::live().await, org, run_id, email).await
}

/// The saved AutoResolve's active corrections, and whether the caller may remove them.
pub async fn list(
    org: &str,
    autoresolve_id: &str,
    email: &str,
) -> Result<CorrectionList, ApproveError> {
    let seams = Seams::live().await;
    let flow = flows_table::get_with(seams.db, org, autoresolve_id)
        .await?
        .ok_or_else(not_found)?;
    let db = seams.db;
    let rows =
        autoresolve_corrections::active_for_autoresolve_with(db, org, autoresolve_id, LIST_LIMIT)
            .await?;
    let total = autoresolve_corrections::count_active_with(db, org, autoresolve_id).await?;
    let run_ids = distinct_ids(rows.iter().map(|r| r.run_id.as_str()));
    let started = autoresolve_runs::created_at_by_ids_with(db, org, &run_ids).await?;
    let connections = saved_connections(&flow)?;
    // The list is readable without the remove right, so a failed check only hides Remove.
    let can_remove = match edit_refusal_with(&seams, org, email, &connections, REMOVE_ACTION).await
    {
        Ok(refusal) => refusal.is_none(),
        Err(e) => {
            log::warn!("[autoresolve] remove right on AutoResolve {autoresolve_id} unknown: {e}");
            false
        }
    };
    let corrections = rows
        .into_iter()
        .map(|row| {
            let started_at = started.get(&row.run_id).copied();
            AutoResolveCorrection::new(row, started_at)
        })
        .collect();
    Ok(CorrectionList {
        corrections,
        total,
        can_remove,
    })
}

/// Stops a correction feeding the AutoResolve's later runs; past runs keep their record.
pub async fn remove(
    org: &str,
    autoresolve_id: &str,
    correction_id: &str,
    email: &str,
) -> Result<(), ApproveError> {
    remove_with(
        &Seams::live().await,
        org,
        autoresolve_id,
        correction_id,
        email,
    )
    .await
}

/// Adds the connection the plan was missing to the run, and to its saved AutoResolve, then plans
/// the run again.
pub async fn add_connection(
    org: &str,
    run_id: &str,
    email: &str,
    connection_id: &str,
) -> Result<(), ApproveError> {
    let seams = SavedSeams::live().await;
    let added = add_connection_with(&seams, org, run_id, email, connection_id).await?;
    evidence::write_connection_added(org, run_id, &added.name, email).await;
    Ok(())
}

/// Why the caller may not add `connection` to the run, or `None`: a saved AutoResolve's run needs
/// an editor of it who may approve `connection`, an ad-hoc run someone who may decide on it.
pub(crate) async fn add_refusal_with(
    seams: &Seams<'_>,
    run: &RunRow,
    email: &str,
    connection: &AutoResolveConnectionRef,
) -> Result<Option<ApproveError>, ApproveError> {
    let Some(flow_id) = &run.autoresolve_id else {
        let ids = std::slice::from_ref(&connection.id);
        if approve::first_unapproved_with(seams, &run.org, email, ids)
            .await?
            .is_some()
        {
            return Ok(Some(ApproveError::CannotChange {
                reason: format!(
                    "Only someone who may approve changes through {} can add it to this run.",
                    named_mcp(&connection.name)
                ),
                approvers: approve::approvers_for_with(seams, &run.org, ids).await?,
            }));
        }
        return Ok(authorize_decision(seams, run, email).await.err());
    };
    let Some(flow) = flows_table::get_with(seams.db, &run.org, flow_id).await? else {
        return Ok(Some(not_found()));
    };
    let mut connections = vec![connection.clone()];
    connections.extend(saved_connections(&flow)?);
    let action = ADD_ACTION;
    edit_refusal_with(seams, &run.org, email, &connections, action).await
}

/// The state a connection may be added from: a plan still waiting in time, or a run that ended
/// `no_change` before any step of its current plan ran, which is a plan without an option.
pub(crate) fn add_from(run: &RunRow, steps: &[StepRow], now: i64) -> Option<RunState> {
    if waiting_in_time(run, now) {
        return Some(RunState::WaitingApproval);
    }
    let ran = steps.iter().any(|s| {
        s.revision == run.revision
            && matches!(
                StepState::parse(&s.state),
                Some(
                    StepState::Approved
                        | StepState::Running
                        | StepState::Done
                        | StepState::Failed
                        | StepState::OutcomeUnknown
                )
            )
    });
    (run.state == RunState::NoChange.as_str() && !ran).then_some(RunState::NoChange)
}

/// Why `name` cannot be added while [add_from] gives no state.
pub(crate) fn add_closed_reason(name: &str) -> String {
    format!("This plan is no longer waiting for approval, so {name} can't be added to this run.")
}

pub(crate) async fn record_verdict_with(
    seams: &Seams<'_>,
    org: &str,
    run_id: &str,
    email: &str,
) -> Result<(), ApproveError> {
    let run = autoresolve_runs::get_with(seams.db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    let wrong_state = || ApproveError::WrongState(VERDICT_STATE.to_string());
    let state = RunState::parse(&run.state)
        .filter(|s| {
            matches!(
                s,
                RunState::Worked | RunState::OutcomeUnknown | RunState::Worse
            )
        })
        .ok_or_else(wrong_state)?;
    let steps = autoresolve_steps::list_for_run_with(seams.db, org, run_id).await?;
    let ran = steps.iter().any(|s| {
        s.revision == run.revision
            && s.option_id.is_some()
            && s.option_id == run.chosen_option_id
            && matches!(
                StepState::parse(&s.state),
                Some(StepState::Done | StepState::OutcomeUnknown)
            )
    });
    if !ran {
        return Err(wrong_state());
    }
    authorize_decision(seams, &run, email).await?;
    write_verdict(seams, &run, state, email).await
}

/// Lands only while the run is still in `state` at the revision read.
async fn write_verdict(
    seams: &Seams<'_>,
    run: &RunRow,
    state: RunState,
    email: &str,
) -> Result<(), ApproveError> {
    let now = now_micros();
    let verdict = person_verdict_json(run, PersonVerdict::Fixed, None, email, now);
    let (states, revision) = ([state], run.revision);
    if !autoresolve_runs::set_person_verdict_if_with(
        seams.db, &run.org, &run.id, &states, revision, &verdict, now,
    )
    .await?
    {
        return Err(ApproveError::WrongState(RUN_MOVED.to_string()));
    }
    Ok(())
}

pub(crate) async fn remove_with(
    seams: &Seams<'_>,
    org: &str,
    autoresolve_id: &str,
    correction_id: &str,
    email: &str,
) -> Result<(), ApproveError> {
    let flow = flows_table::get_with(seams.db, org, autoresolve_id)
        .await?
        .ok_or_else(not_found)?;
    let connections = saved_connections(&flow)?;
    if let Some(refused) = edit_refusal_with(seams, org, email, &connections, REMOVE_ACTION).await?
    {
        return Err(refused);
    }
    if !autoresolve_corrections::deactivate_with(seams.db, org, autoresolve_id, correction_id)
        .await?
    {
        return Err(ApproveError::NotFound(
            "That correction is not on this AutoResolve.".to_string(),
        ));
    }
    Ok(())
}

/// Checks everything before the first write; the saved AutoResolve is changed before the run, so a
/// run that moved on meanwhile leaves the connection on the AutoResolve with its trigger off.
pub(crate) async fn add_connection_with(
    seams: &SavedSeams<'_>,
    org: &str,
    run_id: &str,
    email: &str,
    connection_id: &str,
) -> Result<AutoResolveConnectionRef, ApproveError> {
    let db = seams.approve.db;
    let run = autoresolve_runs::get_with(db, org, run_id)
        .await?
        .ok_or(ApproveError::NotWaiting)?;
    let now = now_micros();
    let steps = autoresolve_steps::list_for_run_with(db, org, run_id).await?;
    let from = add_from(&run, &steps, now)
        .ok_or_else(|| ApproveError::WrongState(ADD_STATE.to_string()))?;
    let connection = new_connection(seams, &run, connection_id.trim()).await?;
    let needed = needed_action(&run, &connection.name);
    if from == RunState::NoChange && needed.is_none() {
        return Err(ApproveError::Refused(NOT_NEEDED.to_string()));
    }
    if let Some(refused) = add_refusal_with(&seams.approve, &run, email, &connection).await? {
        return Err(refused);
    }
    let trigger_off = match &run.autoresolve_id {
        Some(flow_id) => add_to_saved(seams, &run, email, flow_id, &connection.id).await?,
        None => false,
    };
    let txn = db.begin().await?;
    let current = locked_unchanged(&txn, &run).await?;
    let (ids, names, added) = with_connection(&current, &connection, email, now, trigger_off)?;
    let row = AddedConnection {
        connection_id: &connection.id,
        connection_ids: &ids,
        connection_names: &names,
        added_connections: &added,
    };
    if !autoresolve_runs::add_connection_with(&txn, org, run_id, row).await? {
        return Err(ApproveError::NotWaiting);
    }
    let key = normalize_tool_name(&connection.name);
    let note = match needed {
        Some(action) => format!("{key} is now part of this run; the fix it needed: {action}"),
        None => format!("{key} is now part of this run."),
    };
    let patch = replan_patch(from, now);
    relaunch_planning(&seams.approve, txn, &current, from, patch, Some(&note)).await?;
    Ok(connection)
}

fn not_found() -> ApproveError {
    ApproveError::NotFound("Saved AutoResolve not found.".to_string())
}

/// The org MCP connection to add, refused when the run has it, cannot take one more, or it is
/// not an MCP connection of the org.
async fn new_connection(
    seams: &SavedSeams<'_>,
    run: &RunRow,
    connection_id: &str,
) -> Result<AutoResolveConnectionRef, ApproveError> {
    let ids = run_connection_ids(run)?;
    if ids.iter().any(|id| id == connection_id) {
        return Err(ApproveError::Refused(
            "That MCP is already part of this run.".to_string(),
        ));
    }
    let cap = get_o2_config().autoresolve.max_connections;
    if ids.len() >= cap {
        return Err(ApproveError::Refused(format!(
            "A run can use at most {}, and this one has {cap}.",
            mcp_count(cap)
        )));
    }
    let found = seams
        .approve
        .connections
        .toolset(&run.org, connection_id)
        .await?;
    match found {
        Some((name, true)) => Ok(AutoResolveConnectionRef {
            id: connection_id.to_string(),
            name,
            removed: false,
        }),
        Some((name, false)) => {
            let connection = AutoResolveConnectionRef {
                id: connection_id.to_string(),
                name,
                removed: false,
            };
            let refusal = super::ConnectionRefusal::NotMcp { connection };
            Err(ApproveError::Refused(refusal.to_string()))
        }
        None => Err(ApproveError::Refused(
            "That MCP no longer exists.".to_string(),
        )),
    }
}

/// The action the current plan said it needs `name` for, from `needs <name>: <action>`.
fn needed_action(run: &RunRow, name: &str) -> Option<String> {
    let plan: PlanInput = serde_json::from_str(run.plan.as_deref()?).ok()?;
    let (needed, action) = parse_missing_connection(plan.missing_capability.as_deref()?)?;
    (needed == normalize_tool_name(name)).then_some(action)
}

/// The saved AutoResolve takes the connection through the save path, which checks the cap and the
/// approvers and turns its trigger off until someone approves it again; true when it is off.
async fn add_to_saved(
    seams: &SavedSeams<'_>,
    run: &RunRow,
    email: &str,
    flow_id: &str,
    connection_id: &str,
) -> Result<bool, ApproveError> {
    let db = seams.approve.db;
    if autoresolve_runs::live_for_autoresolve_with(db, &run.org, flow_id)
        .await?
        .is_some_and(|live| live.id != run.id)
    {
        return Err(ApproveError::AnotherRunLive);
    }
    let flow = flows_table::get_with(db, &run.org, flow_id)
        .await?
        .ok_or_else(not_found)?;
    let mut connection_ids: Vec<String> =
        serde_json::from_str(&flow.connection_ids).map_err(anyhow::Error::from)?;
    // Edited in since this run started, or a retry after this run's write failed: leave the
    // AutoResolve as it is, and still report a trigger that is off.
    if connection_ids.iter().any(|id| id == connection_id) {
        return Ok(!flow.trigger_enabled && flow.trigger_kind != TriggerKind::Person.as_str());
    }
    connection_ids.push(connection_id.to_string());
    let was_on = flow.trigger_enabled;
    let trigger_kind: TriggerKind =
        serde_json::from_value(Value::String(flow.trigger_kind)).map_err(anyhow::Error::from)?;
    let input = SavedInput {
        name: flow.name,
        goal: flow.goal,
        connection_ids,
        trigger_kind,
        trigger_alert_id: flow.trigger_alert_id,
        from_run_id: None,
    };
    saved::update_with(seams, &run.org, email, flow_id, input)
        .await
        .map(|row| was_on && !row.trigger_enabled)
        .map_err(from_saved)
}

/// The run's connection ids, names and added-connection log with `connection` in them, as JSON.
fn with_connection(
    run: &RunRow,
    connection: &AutoResolveConnectionRef,
    email: &str,
    now: i64,
    trigger_off: bool,
) -> Result<(String, String, String), ApproveError> {
    let mut ids = run_connection_ids(run)?;
    ids.push(connection.id.clone());
    let mut names: HashMap<String, String> =
        serde_json::from_str(&run.connection_names).map_err(anyhow::Error::from)?;
    names.insert(connection.id.clone(), connection.name.clone());
    let mut added: Vec<Value> = match run.added_connections.as_deref() {
        Some(text) => serde_json::from_str(text).map_err(anyhow::Error::from)?,
        None => Vec::new(),
    };
    added.push(json!({
        "id": connection.id,
        "name": connection.name,
        "by": email.trim().to_lowercase(),
        "at_us": now,
        "trigger_off": trigger_off,
    }));
    Ok((
        serde_json::to_string(&ids).map_err(anyhow::Error::from)?,
        serde_json::to_string(&names).map_err(anyhow::Error::from)?,
        serde_json::to_string(&added).map_err(anyhow::Error::from)?,
    ))
}

fn from_saved(e: SavedError) -> ApproveError {
    let message = e.to_string();
    match e {
        SavedError::Db(e) => ApproveError::Db(e),
        SavedError::Run(e) => e.into(),
        SavedError::NotFound => not_found(),
        SavedError::RunInProgress => ApproveError::AnotherRunLive,
        SavedError::NoPermission {
            connection,
            approvers,
        } => ApproveError::CannotChange {
            reason: format!(
                "Only someone who may approve changes through {} can {ADD_ACTION}.",
                named_mcp(&connection.name)
            ),
            approvers,
        },
        _ => ApproveError::Refused(message),
    }
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::ai::toolsets::AutoResolveConnection;

    use super::*;
    use crate::autoresolve::{
        ConnectionSource,
        approve::{ApproverFacts, Holders, RoleHolder},
        saved::SavedFacts,
        test_support::{ORG, RecordingTurns, memory_db, new_run, new_step},
    };

    const ADA: &str = "ada@example.com";
    const GUS: &str = "gus@example.com";
    const BOB: &str = "bob@example.com";
    const RITA: &str = "rita@example.com";
    const ALERT: &str = "2qJ0Rk1Xh5vBqT2Jd9eM8nV4cWz";
    const RUN: &str = "run1";
    const TWO: &[&str] = &["c1", "c2"];
    const THREE: &[&str] = &["c1", "c2", "c3"];
    const NEEDS_POSTGRES: &str = "needs postgres: end session 4211";

    /// `c1` "github", `c2` "k8s" and `c3` "postgres"; Ada is an org admin, Gus may edit
    /// AutoResolve and approve all three, Bob may edit and approve `c1` only, Rita neither.
    struct Org;

    #[async_trait::async_trait]
    impl ConnectionSource for Org {
        async fn get(&self, _org: &str, id: &str) -> anyhow::Result<Option<AutoResolveConnection>> {
            let name = match id {
                "c1" => "github",
                "c2" => "k8s",
                "c3" => "postgres",
                _ => return Ok(None),
            };
            Ok(Some(AutoResolveConnection {
                id: id.to_string(),
                name: name.to_string(),
                url: format!("https://{name}.example"),
                read_headers: HashMap::new(),
                write_headers: HashMap::new(),
                fingerprint: format!("fp-{id}"),
            }))
        }
    }

    #[async_trait::async_trait]
    impl ApproverFacts for Org {
        async fn is_root(&self, _email: &str) -> bool {
            false
        }

        async fn is_org_admin(&self, _org: &str, email: &str) -> bool {
            email == ADA
        }

        fn openfga_on(&self) -> bool {
            true
        }

        fn checks_bypassed(&self) -> bool {
            false
        }

        async fn holds(&self, _org: &str, email: &str, connection: &str) -> anyhow::Result<bool> {
            Ok(email == GUS || (email == BOB && connection == "c1"))
        }

        async fn has_module_access(&self, _org: &str, email: &str) -> anyhow::Result<bool> {
            Ok(email != RITA)
        }

        async fn may_edit_module(&self, _org: &str, email: &str) -> anyhow::Result<bool> {
            Ok(email == GUS || email == BOB)
        }

        async fn holders(&self, _org: &str, _ids: &[String]) -> anyhow::Result<Holders> {
            let roles = vec![RoleHolder {
                name: "sre".to_string(),
                module_access: true,
            }];
            Ok(Holders {
                roles,
                groups: Vec::new(),
            })
        }
    }

    #[async_trait::async_trait]
    impl SavedFacts for Org {
        fn slack_on(&self, _org: &str) -> bool {
            true
        }

        async fn has_slack_channel(&self, _org: &str) -> anyhow::Result<bool> {
            Ok(true)
        }

        async fn alert_name(&self, _org: &str, alert_id: &str) -> Option<String> {
            (alert_id == ALERT).then(|| "Checkout errors".to_string())
        }
    }

    /// Who adds `add` to RUN, and how the run and its saved AutoResolve look before.
    struct AddCase {
        case: &'static str,
        who: &'static str,
        state: RunState,
        ids: Vec<String>,
        add: &'static str,
        /// The saved AutoResolve's connections; `None` for an ad-hoc run.
        flow: Option<&'static [&'static str]>,
        missing: &'static str,
        /// A step of the current plan ran before the run ended.
        ran: bool,
        /// The saved AutoResolve's trigger is already off.
        trigger_was_off: bool,
        refused: Option<fn(&ApproveError) -> bool>,
        /// The saved AutoResolve's connections after, and whether its trigger went off.
        saved_after: (&'static [&'static str], bool),
    }

    /// A saved AutoResolve over `ids` with its alert trigger on, approved by Ada.
    async fn saved_flow(seams: &SavedSeams<'_>, name: &str, ids: &[&str]) -> String {
        let input = SavedInput {
            name: name.into(),
            goal: "end stuck sessions".into(),
            connection_ids: ids.iter().map(|id| id.to_string()).collect(),
            trigger_kind: TriggerKind::Alert,
            trigger_alert_id: Some(ALERT.into()),
            from_run_id: None,
        };
        saved::save_with(seams, ORG, ADA, input).await.unwrap().id
    }

    /// RUN of `flow`, ad-hoc when `None`, in `state` over `ids` with option A chosen; its plan
    /// has no option and gives `missing` as the missing capability.
    async fn run_of(
        seams: &SavedSeams<'_>,
        flow: Option<&str>,
        state: RunState,
        ids: &[String],
        missing: &str,
    ) {
        let names: HashMap<&String, &str> = ids.iter().map(|id| (id, "github")).collect();
        let run = autoresolve_runs::NewRun {
            autoresolve_id: flow.map(String::from),
            connection_ids: serde_json::to_string(ids).unwrap(),
            connection_names: serde_json::to_string(&names).unwrap(),
            ..new_run(RUN)
        };
        autoresolve_runs::insert_with(seams.approve.db, run)
            .await
            .unwrap();
        let plan = json!({"options": [], "omitted_count": 0, "omitted_reason": null,
            "missing_capability": missing});
        let patch = autoresolve_runs::RunPatch {
            plan: Some(plan.to_string()),
            plan_fingerprint: Some("fp".into()),
            approval_deadline_us: Some(Some(i64::MAX)),
            chosen_option_id: Some(Some("A".into())),
            updated_at_us: 2,
            ..Default::default()
        };
        let from = [RunState::Investigating];
        let db = seams.approve.db;
        assert!(
            autoresolve_runs::set_state_with(db, ORG, RUN, &from, state, patch)
                .await
                .unwrap()
        );
    }

    fn add_case(
        case: &'static str,
        who: &'static str,
        state: RunState,
        add: &'static str,
    ) -> AddCase {
        AddCase {
            case,
            who,
            state,
            ids: vec!["c1".into(), "c2".into()],
            add,
            flow: Some(TWO),
            missing: NEEDS_POSTGRES,
            ran: false,
            trigger_was_off: false,
            refused: None,
            saved_after: (THREE, true),
        }
    }

    #[tokio::test]
    async fn corrections_are_removed_only_by_editors() {
        type Expect = Result<(), fn(&ApproveError) -> bool>;
        #[rustfmt::skip]
        let cases: [(&str, &str, bool, Option<&str>, Expect); 5] = [
            ("editor", GUS, true, None, Ok(())),
            ("approver of one connection only", BOB, true, None, Err(|e| matches!(e, ApproveError::CannotChange { .. }) && e.to_string().contains("the k8s MCP"))),
            ("requester without edit rights", RITA, true, None, Err(|e| matches!(e, ApproveError::CannotChange { .. }) && e.to_string().contains("edit AutoResolve"))),
            ("unknown id", ADA, true, Some("nope"), Err(|e| matches!(e, ApproveError::NotFound(_)))),
            ("another AutoResolve's correction", ADA, false, None, Err(|e| matches!(e, ApproveError::NotFound(_)))),
        ];
        for (case, who, same_flow, id, expect) in cases {
            let db = memory_db().await;
            let turns = RecordingTurns::default();
            let seams = SavedSeams {
                approve: Seams {
                    db: &db,
                    turns: &turns,
                    connections: &Org,
                    facts: &Org,
                },
                facts: &Org,
            };
            let flow = saved_flow(&seams, "Sessions", TWO).await;
            let other = saved_flow(&seams, "Other", TWO).await;
            let row = autoresolve_corrections::NewCorrection {
                org: ORG.into(),
                autoresolve_id: Some(flow.clone()),
                run_id: RUN.into(),
                revision: 1,
                kind: config::meta::autoresolve::CorrectionKind::WrongFix,
                note: "use the replica".into(),
                option_title: None,
                created_by: RITA.into(),
                created_at_us: 1,
                active: true,
            };
            let row = autoresolve_corrections::insert_with(&db, row)
                .await
                .unwrap();
            let target = if same_flow { &flow } else { &other };
            let got = remove_with(&seams.approve, ORG, target, id.unwrap_or(&row.id), who).await;
            match (&got, expect) {
                (Ok(()), Ok(())) => {}
                (Err(e), Err(is_expected)) => assert!(is_expected(e), "{case}: {e}"),
                _ => panic!("{case}: unexpected {got:?}"),
            }
            let active = autoresolve_corrections::count_active_with(&db, ORG, &flow)
                .await
                .unwrap();
            assert_eq!(active, u64::from(got.is_err()), "{case}");
        }
    }

    #[tokio::test]
    async fn add_connection_adds_turns_trigger_off_and_replans() {
        use RunState::{NoChange, WaitingApproval as Waiting, Worked};
        let cap = get_o2_config().autoresolve.max_connections;
        let full: Vec<String> = (0..cap).map(|i| format!("x{i}")).collect();
        let wrong_state: fn(&ApproveError) -> bool =
            |e| matches!(e, ApproveError::WrongState(m) if m.contains("waits for approval"));
        #[rustfmt::skip]
        let cases = [
            add_case("editor adds it", GUS, Waiting, "c3"),
            add_case("after a plan with no option", ADA, NoChange, "c3"),
            AddCase { flow: None, saved_after: (TWO, false), ..add_case("ad-hoc run", GUS, Waiting, "c3") },
            AddCase { flow: Some(THREE), saved_after: (THREE, false), ..add_case("the AutoResolve has it already", GUS, Waiting, "c3") },
            AddCase { flow: Some(THREE), trigger_was_off: true, ..add_case("retry after the run write failed", GUS, Waiting, "c3") },
            AddCase { refused: Some(|e| matches!(e, ApproveError::CannotChange { .. }) && e.to_string().contains("the postgres MCP")),
                ..add_case("not an approver of the new one", BOB, Waiting, "c3") },
            AddCase { ids: full, refused: Some(|e| matches!(e, ApproveError::Refused(m) if m.contains("at most"))),
                ..add_case("run at the cap", ADA, Waiting, "c3") },
            AddCase { refused: Some(|e| matches!(e, ApproveError::Refused(m) if m.contains("already"))),
                ..add_case("already on the run", ADA, Waiting, "c1") },
            AddCase { refused: Some(wrong_state), ..add_case("run not waiting", ADA, Worked, "c3") },
            AddCase { ran: true, refused: Some(wrong_state), ..add_case("ended after its plan ran", ADA, NoChange, "c3") },
            AddCase { missing: "needs redis: flush the session cache",
                refused: Some(|e| matches!(e, ApproveError::Refused(m) if m.contains("plan said it needs"))),
                ..add_case("no option, another connection needed", ADA, NoChange, "c3") },
        ];
        for c in cases {
            let case = c.case;
            let db = memory_db().await;
            let turns = RecordingTurns::default();
            let seams = SavedSeams {
                approve: Seams {
                    db: &db,
                    turns: &turns,
                    connections: &Org,
                    facts: &Org,
                },
                facts: &Org,
            };
            let flow = match c.flow {
                Some(ids) => Some(saved_flow(&seams, "Sessions", ids).await),
                None => None,
            };
            if let (Some(id), true) = (&flow, c.trigger_was_off) {
                let off = flows_table::AutoResolvePatch {
                    trigger_enabled: Some(false),
                    updated_at_us: 3,
                    ..Default::default()
                };
                assert!(flows_table::update_with(&db, ORG, id, off).await.unwrap());
            }
            run_of(&seams, flow.as_deref(), c.state, &c.ids, c.missing).await;
            if c.ran {
                let done = autoresolve_steps::NewStep {
                    state: StepState::Done,
                    ..new_step(RUN, "a1", "A", 1, "c1", "github")
                };
                autoresolve_steps::insert_many(&db, vec![done])
                    .await
                    .unwrap();
            }
            let got = add_connection_with(&seams, ORG, RUN, c.who, c.add).await;
            let saved = match &flow {
                Some(id) => flows_table::get_with(&db, ORG, id).await.unwrap(),
                None => None,
            };
            let run = autoresolve_runs::get_with(&db, ORG, RUN)
                .await
                .unwrap()
                .unwrap();
            let run_ids: Vec<String> = serde_json::from_str(&run.connection_ids).unwrap();
            if let Some(is_expected) = c.refused {
                assert!(got.as_ref().is_err_and(is_expected), "{case}: {got:?}");
                assert_eq!(run_ids, c.ids, "{case}: the run is unchanged");
                assert!(
                    saved.is_none_or(|s| s.trigger_enabled),
                    "{case}: trigger stays on"
                );
                continue;
            }
            assert_eq!(got.unwrap().name, "postgres", "{case}");
            let (saved_ids, trigger_off) = c.saved_after;
            if let Some(saved) = saved {
                let ids: Vec<String> = serde_json::from_str(&saved.connection_ids).unwrap();
                assert_eq!(ids, saved_ids, "{case}");
                assert_eq!(
                    saved.trigger_enabled, !trigger_off,
                    "{case}: off until approved again"
                );
            }
            assert_eq!(run_ids, ["c1", "c2", "c3"], "{case}");
            assert_eq!(run.state, "investigating", "{case}");
            let added: Vec<Value> =
                serde_json::from_str(run.added_connections.as_deref().unwrap()).unwrap();
            assert_eq!(
                (&added[0]["name"], &added[0]["trigger_off"]),
                (&json!("postgres"), &json!(trigger_off)),
                "{case}"
            );
            assert_eq!(*turns.planned.lock().unwrap(), 1, "{case}");
        }
    }

    #[tokio::test]
    async fn a_verdict_needs_a_run_that_made_its_change() {
        use RunState::{WaitingApproval as Waiting, Worked};
        use StepState::{Done, Proposed};
        let wrong_state: fn(&ApproveError) -> bool = |e| matches!(e, ApproveError::WrongState(m) if m.contains("ended after making its change"));
        let moved: fn(&ApproveError) -> bool =
            |e| matches!(e, ApproveError::WrongState(m) if m == RUN_MOVED);
        // (case, run state, state and revision of its chosen step on c2, who, replanned before
        // the write, refused)
        type Case = (
            &'static str,
            RunState,
            StepState,
            i32,
            &'static str,
            bool,
            Option<fn(&ApproveError) -> bool>,
        );
        #[rustfmt::skip]
        let cases: [Case; 6] = [
            ("it worked", Worked, Done, 1, GUS, false, None),
            ("still waiting", Waiting, Proposed, 1, GUS, false, Some(wrong_state)),
            ("no step done", Worked, Proposed, 1, GUS, false, Some(wrong_state)),
            ("not an approver of its connection", Worked, Done, 1, BOB, false, Some(|e| matches!(e, ApproveError::NoPermission { .. }))),
            ("its plan moved on since the step ran", Worked, Done, 0, GUS, false, Some(wrong_state)),
            ("the run moved on while answering", Worked, Done, 1, GUS, true, Some(moved)),
        ];
        for (case, state, step_state, revision, who, replanned, refused) in cases {
            let db = memory_db().await;
            let turns = RecordingTurns::default();
            let seams = SavedSeams {
                approve: Seams {
                    db: &db,
                    turns: &turns,
                    connections: &Org,
                    facts: &Org,
                },
                facts: &Org,
            };
            let two: Vec<String> = vec!["c1".into(), "c2".into()];
            run_of(&seams, None, state, &two, NEEDS_POSTGRES).await;
            let step = autoresolve_steps::NewStep {
                state: step_state,
                revision,
                ..new_step(RUN, "a1", "A", 1, "c2", "k8s")
            };
            autoresolve_steps::insert_many(&db, vec![step])
                .await
                .unwrap();
            let got = if replanned {
                let read = autoresolve_runs::get_with(&db, ORG, RUN)
                    .await
                    .unwrap()
                    .unwrap();
                let patch = autoresolve_runs::RunPatch::default();
                let to = RunState::Investigating;
                autoresolve_runs::set_state_with(&db, ORG, RUN, &[state], to, patch)
                    .await
                    .unwrap();
                write_verdict(&seams.approve, &read, state, who).await
            } else {
                record_verdict_with(&seams.approve, ORG, RUN, who).await
            };
            let run = autoresolve_runs::get_with(&db, ORG, RUN)
                .await
                .unwrap()
                .unwrap();
            if let Some(is_expected) = refused {
                assert!(got.as_ref().is_err_and(is_expected), "{case}: {got:?}");
                assert_eq!(run.person_verdict, None, "{case}: nothing stored");
                continue;
            }
            got.unwrap();
            let verdict: Value =
                serde_json::from_str(run.person_verdict.as_deref().unwrap()).unwrap();
            assert_eq!(
                (
                    &verdict["verdict"],
                    &verdict["by"],
                    &verdict["agent_verdict"]
                ),
                (&json!("fixed"), &json!(GUS), &json!("worked")),
                "{case}"
            );
            assert_eq!(run.state, "worked", "{case}: no new plan");
            assert_eq!(*turns.planned.lock().unwrap(), 0, "{case}");
        }
    }
}

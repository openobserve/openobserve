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

//! Run evidence: a stream copy of each step and of the run's end, and the outcome summary the
//! system builds from the step rows.

use std::collections::BTreeMap;

use config::meta::autoresolve::{
    AUTORESOLVE_RUNS_STREAM, RunState, StepState, Verdict, name_list, redacted_text,
};
use infra::table::entity::{autoresolve_runs, autoresolve_steps};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};

use crate::ingestion::feature_writer::{self, FeatureWriter, GrpcTransport};

/// One long tool name must not crowd the other steps out of a Slack line.
const MAX_NAME_CHARS: usize = 60;

/// The step rows are the record, so a failed write is only logged. `result_raw` and the
/// connection fingerprint never leave the row.
pub(crate) async fn write_step(
    org: &str,
    run: &autoresolve_runs::Model,
    step: &autoresolve_steps::Model,
) {
    write_record(org, step_record(run, step)).await;
}

/// "2 of 3 approved steps ran: a and b. Failed: c.", naming failed, held and not-run steps.
pub(crate) fn system_summary(
    steps: &[autoresolve_steps::Model],
    prior_verdict: Option<&str>,
) -> String {
    let approved = approved_steps(steps);
    let named: Vec<_> = counted_names(&approved)
        .into_iter()
        .zip(approved.iter().map(|s| outcome_label(s)))
        .collect();
    let names = |label: Option<&str>| -> Vec<String> {
        named
            .iter()
            .filter(|(_, l)| *l == label)
            .map(|(name, _)| name.clone())
            .collect()
    };
    let held: Vec<String> = steps
        .iter()
        .filter(|s| step_state(s) == Some(StepState::Held))
        .filter(|s| {
            !approved
                .iter()
                .any(|a| a.tool == s.tool && a.args_hash == s.args_hash)
        })
        .map(step_name)
        .collect();
    let groups = [
        ("Failed", names(Some("Failed"))),
        ("Result unknown", names(Some("Result unknown"))),
        ("Did not run", names(Some("Did not run"))),
        ("Held, not in the approved plan", held),
    ];
    let mut parts = vec![headline(&names(None), approved.len())];
    for (label, group) in groups {
        if !group.is_empty() {
            parts.push(format!("{label}: {}.", name_list(&group)));
        }
    }
    if prior_verdict == Some(Verdict::Worse.as_str()) {
        parts.push("An earlier attempt in this run made things worse.".to_string());
    }
    parts.join(" ")
}

pub(crate) async fn finish_run(org: &str, run_id: &str) {
    finish_run_with(infra::db::get_orm_client_rw().await, org, run_id).await;
}

/// The run-end record of a run in a terminal state; it changes no state.
pub(crate) async fn finish_run_with<C: ConnectionTrait>(conn: &C, org: &str, run_id: &str) {
    let run = match infra::table::autoresolve_runs::get_with(conn, org, run_id).await {
        Ok(Some(run)) => run,
        Ok(None) => {
            log::warn!("[autoresolve] run {run_id} of org {org} is gone; no run-end evidence");
            return;
        }
        Err(e) => {
            log::error!("[autoresolve] run-end evidence for run {run_id} of org {org}: {e}");
            return;
        }
    };
    if !RunState::parse(&run.state).is_some_and(|s| s.is_terminal()) {
        log::warn!(
            "[autoresolve] run {run_id} of org {org} is {}, not ended; no run-end evidence",
            run.state
        );
        return;
    }
    let steps = match infra::table::autoresolve_steps::list_for_run_with(conn, org, run_id).await {
        Ok(steps) => steps,
        Err(e) => {
            log::error!("[autoresolve] run-end evidence for run {run_id} of org {org}: {e}");
            return;
        }
    };
    let summary = system_summary(&steps, run.prior_verdict.as_deref());
    write_record(org, run_end_record(&run, &summary)).await;
}

/// The audit line for a connection a person added to a run so it could plan again.
pub(crate) async fn write_connection_added(org: &str, run_id: &str, name: &str, by: &str) {
    let record = json!({
        "record": "connection_added",
        "run_id": run_id,
        "connection_name": name,
        "added_by": by.trim().to_lowercase(),
    });
    write_record(org, record).await;
}

// Nested JSON would add a stream column per model-chosen key, so values are stored as text.
fn step_record(run: &autoresolve_runs::Model, step: &autoresolve_steps::Model) -> Value {
    json!({
        "record": "step",
        "run_id": step.run_id,
        "step_id": step.id,
        "revision": step.revision,
        "seq": step.seq,
        "connection_name": step.connection_name,
        "tool": step.tool,
        "state": step.state,
        "args_hash": step.args_hash,
        "arguments": redacted_text(&step.arguments),
        "result": step.result.as_deref().map(redacted_text),
        "approved_by": run.approved_by,
    })
}

fn run_end_record(run: &autoresolve_runs::Model, summary: &str) -> Value {
    json!({
        "record": "run_end",
        "run_id": run.id,
        "autoresolve_id": run.autoresolve_id,
        "state": run.state,
        "revision": run.revision,
        "trigger_kind": run.trigger_kind,
        "requester": run.requester,
        "approved_by": run.approved_by,
        "approval_channel": run.approval_channel,
        "outcome_verdict": run.outcome_verdict,
        "prior_verdict": run.prior_verdict,
        "summary": summary,
        "error": run.error.as_deref().map(redacted_text),
        "created_at_us": run.created_at_us,
        "ended_at_us": run.ended_at_us,
    })
}

async fn write_record(org: &str, record: Value) {
    let token = match feature_writer::token(FeatureWriter::AutoResolve, org).await {
        Ok(token) => token,
        Err(e) => {
            log::error!("[autoresolve] evidence for org {org} was not written: {e}");
            return;
        }
    };
    let data = match serde_json::to_vec(&[record]) {
        Ok(data) => data,
        Err(e) => {
            log::error!("[autoresolve] evidence for org {org} was not encoded: {e}");
            return;
        }
    };
    if let Err(e) =
        feature_writer::write(&GrpcTransport, &token, AUTORESOLVE_RUNS_STREAM, data).await
    {
        log::error!("[autoresolve] evidence for org {org} was not written: {e}");
    }
}

// A hold keeps the approval fingerprint and (seq, tool, args_hash) on the rows it supersedes or
// copies, but a replan after `worse` restarts seqs, so that triple, not seq, names a step.
fn approved_steps(steps: &[autoresolve_steps::Model]) -> Vec<&autoresolve_steps::Model> {
    let mut by_call: BTreeMap<(i32, &str, &str), (i32, &autoresolve_steps::Model)> =
        BTreeMap::new();
    for step in steps
        .iter()
        .filter(|s| s.option_id.is_some() && s.connection_fingerprint.is_some())
    {
        let key = (step.seq, step.tool.as_str(), step.args_hash.as_str());
        let (first, kept) = by_call.entry(key).or_insert((step.revision, step));
        *first = (*first).min(step.revision);
        if step.revision > kept.revision {
            *kept = step;
        }
    }
    let mut kept: Vec<_> = by_call.into_values().collect();
    kept.sort_by_key(|(first, step)| (*first, step.seq));
    kept.into_iter().map(|(_, step)| step).collect()
}

/// `None` for a step that ran to done, else the group the summary lists it under.
fn outcome_label(step: &autoresolve_steps::Model) -> Option<&'static str> {
    match step_state(step) {
        Some(StepState::Done) => None,
        Some(StepState::Failed) => Some("Failed"),
        Some(StepState::OutcomeUnknown | StepState::Running) => Some("Result unknown"),
        _ => Some("Did not run"),
    }
}

fn counted_names(approved: &[&autoresolve_steps::Model]) -> Vec<String> {
    let names: Vec<String> = approved.iter().map(|s| step_name(s)).collect();
    names
        .iter()
        .zip(approved)
        .map(|(name, step)| {
            if names.iter().filter(|n| *n == name).count() > 1 {
                format!("{name} (step {})", step.seq)
            } else {
                name.clone()
            }
        })
        .collect()
}

fn step_state(step: &autoresolve_steps::Model) -> Option<StepState> {
    StepState::parse(&step.state)
}

fn step_name(step: &autoresolve_steps::Model) -> String {
    let name = step
        .tool
        .split(['_', '-'])
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if name.chars().count() <= MAX_NAME_CHARS {
        return name;
    }
    let cut: String = name.chars().take(MAX_NAME_CHARS - 1).collect();
    format!("{cut}…")
}

fn headline(done: &[String], approved: usize) -> String {
    if approved == 0 {
        return "No approved steps ran.".to_string();
    }
    let noun = if approved == 1 { "step" } else { "steps" };
    if done.is_empty() {
        return format!("0 of {approved} approved {noun} ran.");
    }
    format!(
        "{} of {approved} approved {noun} ran: {}.",
        done.len(),
        name_list(done)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(
        revision: i32,
        option: Option<&str>,
        seq: i32,
        tool: &str,
        state: StepState,
    ) -> autoresolve_steps::Model {
        let approved = !matches!(state, StepState::Proposed | StepState::Held);
        autoresolve_steps::Model {
            id: format!("s{revision}{seq}{tool}"),
            org: "demo-org".to_string(),
            run_id: "r1".to_string(),
            revision,
            option_id: option.map(str::to_string),
            seq,
            kind: "change".to_string(),
            connection_id: "c1".to_string(),
            connection_name: "github".to_string(),
            tool: tool.to_string(),
            arguments: "{}".to_string(),
            refs: "[]".to_string(),
            args_hash: String::new(),
            reason: String::new(),
            preview: None,
            tool_def_hash: String::new(),
            connection_fingerprint: approved.then(|| "fp".to_string()),
            state: state.as_str().to_string(),
            result: None,
            result_raw: None,
            error: None,
            consumed_at_us: None,
            finished_at_us: None,
            created_at_us: 0,
        }
    }

    fn unapproved(mut step: autoresolve_steps::Model) -> autoresolve_steps::Model {
        step.connection_fingerprint = None;
        step
    }

    #[test]
    fn system_summary_comes_from_step_rows() {
        use StepState::*;
        let a = Some("A");
        let held_rev1 = || {
            vec![
                step(1, a, 1, "create_branch", Done),
                step(1, a, 2, "open_pull_request", Superseded),
                step(1, a, 3, "merge", Superseded),
                step(1, None, 4, "force_push", Held),
            ]
        };
        let cases = [
            (
                "all done",
                None,
                vec![
                    step(1, a, 1, "create_branch", Done),
                    step(1, a, 2, "open_pull_request", Done),
                    step(1, a, 3, "merge", Done),
                ],
                vec!["3 of 3", "create branch", "open pull request", "merge"],
                vec!["Failed", "Did not run", "Held", "earlier attempt"],
            ),
            (
                "step 2 failed",
                None,
                vec![
                    step(1, a, 1, "create_branch", Done),
                    step(1, a, 2, "open_pull_request", Failed),
                    step(1, a, 3, "merge", NotRun),
                    unapproved(step(1, Some("B"), 1, "restart_pods", Superseded)),
                ],
                vec![
                    "1 of 3",
                    "create branch",
                    "Failed: open pull request",
                    "Did not run: merge",
                ],
                vec!["restart pods", "Held"],
            ),
            (
                "one held",
                None,
                vec![
                    step(1, a, 1, "create_branch", Done),
                    step(1, a, 2, "open_pull_request", Superseded),
                    step(1, None, 3, "force_push", Held),
                    step(2, a, 1, "create_branch", Done),
                    step(2, a, 2, "open_pull_request", Proposed),
                    step(2, a, 3, "force_push", Proposed),
                ],
                vec![
                    "1 of 2",
                    "Did not run: open pull request",
                    "Held",
                    "force push",
                ],
                vec!["Failed"],
            ),
            (
                "hold then declined",
                None,
                [
                    held_rev1(),
                    vec![
                        step(2, a, 1, "create_branch", Done),
                        unapproved(step(2, a, 2, "open_pull_request", NotRun)),
                        unapproved(step(2, a, 3, "merge", NotRun)),
                        unapproved(step(2, a, 4, "force_push", NotRun)),
                    ],
                ]
                .concat(),
                vec![
                    "1 of 3",
                    "create branch",
                    "Did not run: open pull request and merge",
                ],
                vec!["Failed"],
            ),
            (
                "hold then re-approved",
                None,
                [
                    held_rev1(),
                    vec![
                        step(2, a, 1, "create_branch", Done),
                        step(2, a, 2, "open_pull_request", Done),
                        step(2, a, 3, "merge", Done),
                        step(2, a, 4, "force_push", Done),
                    ],
                ]
                .concat(),
                vec!["4 of 4", "force push"],
                vec!["Failed", "Did not run", "Held"],
            ),
            (
                "revert after worse",
                Some("worse"),
                vec![
                    step(1, a, 1, "create_branch", Done),
                    step(1, a, 2, "open_pull_request", Done),
                    step(1, a, 3, "merge", Done),
                    step(2, a, 1, "revert_merge", Done),
                ],
                vec![
                    "4 of 4",
                    "merge and revert merge",
                    "An earlier attempt in this run made things worse.",
                ],
                vec!["Failed", "Did not run"],
            ),
            (
                "declined unapproved",
                None,
                vec![
                    unapproved(step(1, a, 1, "create_branch", NotRun)),
                    unapproved(step(1, a, 2, "merge", NotRun)),
                ],
                vec!["No approved steps ran"],
                vec!["Did not run", "create branch"],
            ),
            (
                "same tool twice",
                None,
                vec![
                    step(1, a, 1, "restart_pod", Done),
                    step(1, a, 2, "restart_pod", Done),
                ],
                vec!["2 of 2", "restart pod (step 1)", "restart pod (step 2)"],
                vec![],
            ),
            (
                "zero steps",
                None,
                vec![],
                vec!["No", "steps"],
                vec![" of ", ":"],
            ),
        ];
        for (label, prior, rows, present, absent) in cases {
            let summary = system_summary(&rows, prior);
            for word in present {
                assert!(
                    summary.contains(word),
                    "{label}: {word:?} missing from {summary:?}"
                );
            }
            for word in absent {
                assert!(!summary.contains(word), "{label}: {word:?} in {summary:?}");
            }
        }
    }
}

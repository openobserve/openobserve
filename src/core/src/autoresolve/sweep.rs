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

//! Ends the runs nobody will move on: plans no one decided on lapse, and runs whose turn or
//! step went silent end. Only a check that did not finish is retried, once.

use std::sync::Arc;

use config::meta::autoresolve::{RunState, STEP_RESULT_GRACE_US, StepState};
use infra::table::{
    autoresolve_runs::{self, RunPatch},
    autoresolve_steps,
    entity::{autoresolve_runs::Model as RunRow, autoresolve_steps::Model as StepRow},
};
use sea_orm::{DatabaseConnection, TransactionTrait};
use tokio::task::JoinHandle;

use super::{
    AutoResolveError, LiveTurns, TurnLauncher, after_transition, chosen_steps, mark_not_run,
    transition_with,
    turn::{self, Phase},
};

// Rows per rule per tick, so a backlog drains over several ticks instead of one unbounded one.
const SWEEP_BATCH: u64 = 500;
const RULES: [Rule; 3] = [Rule::Lapse, Rule::SilentStep, Rule::TurnDeadline];

/// A stuck step closed in a run that had already ended is not counted: no run moved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepCounts {
    pub lapsed: u64,
    pub failed: u64,
    pub outcome_unknown: u64,
    pub check_retried: u64,
}

impl SweepCounts {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    fn add(&mut self, to: RunState) {
        match to {
            RunState::Lapsed => self.lapsed += 1,
            RunState::OutcomeUnknown => self.outcome_unknown += 1,
            RunState::Checking => self.check_retried += 1,
            _ => self.failed += 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Rule {
    Lapse,
    SilentStep,
    TurnDeadline,
}

/// What one run's sweep writes: the run's move (none when it already ended) and its steps'.
struct Ending {
    to: Option<RunState>,
    error: Option<String>,
    silent: Vec<String>,
    proposed: Vec<String>,
    approved_not_run: bool,
}

pub async fn sweep(now_us: i64) -> SweepCounts {
    let db = infra::db::get_orm_client_rw().await;
    let region = crate::downtimes::notify::this_region();
    sweep_with(db, Arc::new(LiveTurns), &region, now_us).await.0
}

/// Each move is conditional on the state read under the row lock, so a second scheduler node
/// or a racing decision moves nothing and runs no side effects. Returns the launched checks.
pub(crate) async fn sweep_with(
    db: &'static DatabaseConnection,
    turns: Arc<dyn TurnLauncher>,
    region: &str,
    now_us: i64,
) -> (SweepCounts, Vec<JoinHandle<()>>) {
    let mut counts = SweepCounts::default();
    let mut launched = Vec::new();
    for rule in RULES {
        let listed = candidates(db, rule, region, now_us).await;
        launched.extend(end_listed(db, &turns, rule, listed, now_us, &mut counts).await);
    }
    (counts, launched)
}

async fn end_listed(
    db: &'static DatabaseConnection,
    turns: &Arc<dyn TurnLauncher>,
    rule: Rule,
    listed: Vec<(String, String)>,
    now_us: i64,
    counts: &mut SweepCounts,
) -> Vec<JoinHandle<()>> {
    let mut launched = Vec::new();
    for (org, run_id) in listed {
        match end_run(db, rule, &org, &run_id, now_us).await {
            Ok(Some((_, _, RunState::Checking))) => {
                // Admission may wait out the stalled turn's cancel; the tick must not.
                let turns = turns.clone();
                launched.push(tokio::spawn(async move {
                    turn::launch_check(db, turns.as_ref(), &org, &run_id).await;
                }));
                counts.add(RunState::Checking);
            }
            Ok(Some((run, from, to))) => {
                after_transition(&org, &run_id, to).await;
                if from.is_live() {
                    turns.cancel(&run).await;
                }
                counts.add(to);
            }
            Ok(None) => {}
            Err(e) => log::error!("[autoresolve] sweep could not end run {run_id}: {e}"),
        }
    }
    launched
}

/// The `(org, run id)` pairs a rule may end; a failed read skips the rule for this tick.
async fn candidates(
    db: &DatabaseConnection,
    rule: Rule,
    region: &str,
    now_us: i64,
) -> Vec<(String, String)> {
    let listed = match rule {
        Rule::Lapse => {
            autoresolve_runs::list_waiting_past_deadline_with(db, region, now_us, SWEEP_BATCH)
                .await
                .map(|runs| runs.into_iter().map(|r| (r.org, r.id)).collect())
        }
        Rule::SilentStep => {
            let cutoff = now_us.saturating_sub(STEP_RESULT_GRACE_US);
            autoresolve_steps::list_running_since_before_with(db, region, cutoff, SWEEP_BATCH)
                .await
                .map(|steps| steps.into_iter().map(|s| (s.org, s.run_id)).collect())
        }
        Rule::TurnDeadline => {
            autoresolve_runs::list_live_past_turn_deadline_with(db, region, now_us, SWEEP_BATCH)
                .await
                .map(|runs| runs.into_iter().map(|r| (r.org, r.id)).collect())
        }
    };
    let mut pairs: Vec<(String, String)> = listed.unwrap_or_else(|e| {
        log::error!("[autoresolve] sweep could not list runs for {rule:?}: {e}");
        Vec::new()
    });
    pairs.sort();
    pairs.dedup();
    pairs
}

/// Re-checks the rule under the run's row lock and writes the run and its steps in one txn;
/// returns the moved row with its old and new state.
async fn end_run(
    db: &DatabaseConnection,
    rule: Rule,
    org: &str,
    run_id: &str,
    now_us: i64,
) -> Result<Option<(RunRow, RunState, RunState)>, AutoResolveError> {
    let txn = db.begin().await?;
    let Some(run) = autoresolve_runs::locked(&txn, org, run_id).await? else {
        return Ok(None);
    };
    let Some(from) = RunState::parse(&run.state) else {
        return Ok(None);
    };
    let steps = autoresolve_steps::list_for_run_with(&txn, org, run_id).await?;
    let Some(ending) = ending(rule, from, &run, &steps, now_us) else {
        return Ok(None);
    };
    let moved = match ending.to {
        Some(RunState::Checking) => {
            let patch = turn::check_retry_patch(now_us);
            let to = RunState::Checking;
            autoresolve_runs::set_state_with(&txn, org, run_id, &[from], to, patch).await?
        }
        Some(to) => {
            let patch = RunPatch {
                error: ending.error.map(Some),
                ..Default::default()
            };
            transition_with(&txn, org, run_id, &[from], to, patch).await?
        }
        None => false,
    };
    if ending.to.is_some() && !moved {
        return Ok(None);
    }
    let running = [StepState::Running];
    autoresolve_steps::set_many(
        &txn,
        org,
        &ending.silent,
        &running,
        StepState::OutcomeUnknown,
    )
    .await?;
    let proposed = [StepState::Proposed];
    autoresolve_steps::set_many(&txn, org, &ending.proposed, &proposed, StepState::NotRun).await?;
    if ending.approved_not_run {
        mark_not_run(&txn, org, &chosen_steps(&run, &steps)).await?;
    }
    txn.commit().await?;
    Ok(ending.to.map(|to| (run, from, to)))
}

/// Re-run under the row lock, so `None` when a racing node or decision already moved the run.
fn ending(
    rule: Rule,
    from: RunState,
    run: &RunRow,
    steps: &[StepRow],
    now_us: i64,
) -> Option<Ending> {
    let chosen = chosen_steps(run, steps);
    let running = |cutoff: i64| -> Vec<&StepRow> {
        steps
            .iter()
            .filter(|s| s.state == StepState::Running.as_str())
            .filter(|s| s.consumed_at_us.is_some_and(|at| at < cutoff))
            .collect()
    };
    let first = |rows: &[&StepRow]| rows.iter().map(|s| s.seq).min();
    let ids = |rows: &[&StepRow]| -> Vec<String> { rows.iter().map(|s| s.id.clone()).collect() };
    let unrun: Vec<&StepRow> = chosen
        .iter()
        .filter(|s| s.state == StepState::Approved.as_str())
        .copied()
        .collect();
    let past = |deadline: Option<i64>| deadline.is_some_and(|d| d < now_us);
    match rule {
        Rule::Lapse => {
            let proposed = steps
                .iter()
                .filter(|s| s.revision == run.revision && s.state == StepState::Proposed.as_str())
                .map(|s| s.id.clone())
                .collect();
            (from == RunState::WaitingApproval && past(run.approval_deadline_us)).then(|| Ending {
                to: Some(RunState::Lapsed),
                error: None,
                silent: Vec::new(),
                proposed,
                approved_not_run: false,
            })
        }
        Rule::SilentStep => {
            let silent = running(now_us.saturating_sub(STEP_RESULT_GRACE_US));
            let proceeding = from == RunState::Proceeding;
            (!silent.is_empty()).then(|| Ending {
                // A run that already ended only needs its stuck step closed.
                to: proceeding.then_some(RunState::OutcomeUnknown),
                error: proceeding.then(|| turn::unknown_result(first(&silent).unwrap_or_default())),
                silent: ids(&silent),
                proposed: Vec::new(),
                approved_not_run: proceeding,
            })
        }
        Rule::TurnDeadline => (from.is_live() && past(run.turn_deadline_us)).then(|| {
            let silent = running(i64::MAX);
            // The turn's own end and this deadline must agree on how a run ends.
            let retried = run.check_retried_at_us.is_some();
            let phase = match from {
                RunState::Investigating => Phase::Plan,
                RunState::Checking if retried => Phase::Check,
                _ => Phase::Execute,
            };
            let has_outcome = run.outcome_verdict.is_some();
            let to = turn::settle_on_end(
                from,
                phase,
                !silent.is_empty(),
                !unrun.is_empty(),
                has_outcome,
                retried,
            )
            .map_or(RunState::Failed, |(to, _)| to);
            let text = match from {
                RunState::Checking => turn::CHECK_TIMED_OUT,
                _ => turn::TURN_TIMED_OUT,
            };
            let refusal = run.error.as_deref();
            let ends = to != RunState::Checking;
            let error = ends.then(|| {
                turn::end_message(from, text, refusal, None, first(&silent), first(&unrun))
            });
            Ending {
                to: Some(to),
                error,
                silent: ids(&silent),
                proposed: Vec::new(),
                approved_not_run: ends,
            }
        }),
    }
}

#[cfg(test)]
mod tests {
    use infra::table::{autoresolve_runs::NewRun, autoresolve_steps::NewStep};

    use super::*;
    use crate::autoresolve::test_support::{ORG, RecordingTurns, memory_db, new_run};

    const REGION: &str = "r1";
    const NOW: i64 = 10_000_000_000_000;
    const LATER: i64 = NOW + 3_600_000_000;

    struct Seed {
        name: &'static str,
        region: &'static str,
        state: RunState,
        approval_deadline_us: Option<i64>,
        turn_deadline_us: Option<i64>,
        check_retried: bool,
        steps: &'static [(StepState, Option<i64>)],
        want: RunState,
        want_steps: &'static [StepState],
        shows: &'static str,
    }

    async fn seed(db: &DatabaseConnection, s: &Seed) {
        let run = NewRun {
            region: s.region.into(),
            turn_deadline_us: s.turn_deadline_us,
            ..new_run(s.name)
        };
        autoresolve_runs::insert_with(db, run).await.unwrap();
        let patch = RunPatch {
            chosen_option_id: Some(Some("A".into())),
            approval_deadline_us: Some(s.approval_deadline_us),
            check_retried_at_us: Some(s.check_retried.then_some(NOW - 2)),
            updated_at_us: 2,
            ..Default::default()
        };
        let from = [RunState::Investigating];
        autoresolve_runs::set_state_with(db, ORG, s.name, &from, s.state, patch)
            .await
            .unwrap();
        let steps = s
            .steps
            .iter()
            .enumerate()
            .map(|(i, (state, consumed))| NewStep {
                id: format!("{}-{}", s.name, i + 1),
                org: ORG.into(),
                run_id: s.name.into(),
                revision: 1,
                option_id: Some("A".into()),
                seq: i as i32 + 1,
                kind: "change".into(),
                connection_id: "c1".into(),
                connection_name: "github".into(),
                tool: "restart".into(),
                arguments: "{}".into(),
                refs: "[]".into(),
                args_hash: format!("h{i}"),
                reason: "stuck".into(),
                preview: None,
                tool_def_hash: "d1".into(),
                connection_fingerprint: None,
                state: *state,
                result: None,
                result_raw: None,
                consumed_at_us: *consumed,
                finished_at_us: None,
                created_at_us: 1,
            });
        autoresolve_steps::insert_many(db, steps.collect())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn sweep_ends_stuck_runs() {
        use RunState::*;
        use StepState::{Approved, Done, NotRun, Proposed, Running};
        const GRACE: i64 = STEP_RESULT_GRACE_US;
        #[rustfmt::skip]
        let seeds = [
            Seed { name: "waiting_past_deadline", region: REGION, state: WaitingApproval,
                approval_deadline_us: Some(NOW - 1), turn_deadline_us: None, check_retried: false,
                steps: &[(Proposed, None), (Proposed, None)], want: Lapsed,
                want_steps: &[NotRun, NotRun], shows: "" },
            Seed { name: "consumed_without_result", region: REGION, state: Proceeding,
                approval_deadline_us: None, turn_deadline_us: Some(LATER), check_retried: false,
                steps: &[(Running, Some(NOW - GRACE - 1)), (Approved, None)],
                want: OutcomeUnknown, want_steps: &[StepState::OutcomeUnknown, NotRun],
                shows: "Step 1 may have run; its result is unknown." },
            Seed { name: "investigating_past_turn_deadline", region: REGION, state: Investigating,
                approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: false, steps: &[],
                want: Failed, want_steps: &[], shows: "The AI model did not answer in time." },
            Seed { name: "proceeding_past_deadline_with_running_step", region: REGION,
                state: Proceeding, approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: false,
                steps: &[(Running, Some(NOW - 1)), (Approved, None)], want: OutcomeUnknown,
                want_steps: &[StepState::OutcomeUnknown, NotRun],
                shows: "Step 1 may have run; its result is unknown." },
            Seed { name: "proceeding_past_deadline_with_unrun_step", region: REGION,
                state: Proceeding, approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: false,
                steps: &[(Done, Some(NOW - 1)), (Approved, None)], want: StepFailed,
                want_steps: &[Done, NotRun], shows: "before step 2 ran" },
            Seed { name: "stuck_step_in_ended_run", region: REGION, state: StepFailed,
                approval_deadline_us: None, turn_deadline_us: None, check_retried: false,
                steps: &[(Running, Some(NOW - GRACE - 1))], want: StepFailed,
                want_steps: &[StepState::OutcomeUnknown], shows: "" },
            Seed { name: "not_yet_due", region: REGION, state: Proceeding,
                approval_deadline_us: None, turn_deadline_us: Some(NOW), check_retried: false,
                steps: &[(Running, Some(NOW - GRACE))], want: Proceeding,
                want_steps: &[Running], shows: "" },
            Seed { name: "other_region", region: "r2", state: Proceeding,
                approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: false,
                steps: &[(Running, Some(NOW - GRACE - 1))], want: Proceeding,
                want_steps: &[Running], shows: "" },
            Seed { name: "checking_past_deadline", region: REGION, state: Checking,
                approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: false,
                steps: &[(Done, Some(NOW - 1))], want: Checking, want_steps: &[Done], shows: "" },
            Seed { name: "check_retry_past_deadline", region: REGION, state: Checking,
                approval_deadline_us: None, turn_deadline_us: Some(NOW - 1), check_retried: true,
                steps: &[(Done, Some(NOW - 1))], want: OutcomeUnknown, want_steps: &[Done],
                shows: "The steps ran. The check could not finish: the AI model did not answer in time." },
        ];
        let db: &'static DatabaseConnection = Box::leak(Box::new(memory_db().await));
        for s in &seeds {
            seed(db, s).await;
        }
        let turns = Arc::new(RecordingTurns::default());
        let launcher: Arc<dyn TurnLauncher> = turns.clone();
        let mut second_node = Vec::new();
        for rule in RULES {
            second_node.push((rule, candidates(db, rule, REGION, NOW).await));
        }
        let listed: usize = second_node.iter().map(|(_, l)| l.len()).sum();
        assert_eq!(listed, 8, "the second node lists the same due runs");

        let (counts, launched) = sweep_with(db, launcher.clone(), REGION, NOW).await;
        for launch in launched {
            launch.await.unwrap();
        }
        let want = SweepCounts {
            lapsed: 1,
            failed: 2,
            outcome_unknown: 3,
            check_retried: 1,
        };
        assert_eq!(counts, want);
        for s in &seeds {
            let run = autoresolve_runs::get_with(db, ORG, s.name)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(run.state, s.want.as_str(), "{}", s.name);
            let error = run.error.unwrap_or_default();
            assert!(error.contains(s.shows), "{}: {error}", s.name);
            if s.want == Checking {
                let fresh = run.turn_deadline_us.is_some_and(|d| d > NOW);
                assert!(fresh && run.check_retried_at_us.is_some(), "{}", s.name);
            }
            let steps = autoresolve_steps::list_for_run_with(db, ORG, s.name)
                .await
                .unwrap();
            let states: Vec<&str> = steps.iter().map(|st| st.state.as_str()).collect();
            let want: Vec<&str> = s.want_steps.iter().map(StepState::as_str).collect();
            assert_eq!(states, want, "{}", s.name);
        }
        let mut cancelled = turns.cancelled.lock().unwrap().clone();
        cancelled.sort();
        assert_eq!(
            cancelled,
            [
                "check_retry_past_deadline",
                "checking_past_deadline",
                "consumed_without_result",
                "investigating_past_turn_deadline",
                "proceeding_past_deadline_with_running_step",
                "proceeding_past_deadline_with_unrun_step",
            ],
            "only runs that left a live state or retry their check are cancelled"
        );
        let started = (
            *turns.planned.lock().unwrap(),
            turns.executed.lock().unwrap().len(),
            turns.checked.lock().unwrap().clone(),
        );
        let check = vec!["checking_past_deadline".to_string()];
        assert_eq!(
            started,
            (0, 0, check),
            "the sweeper starts only the check's one retry"
        );

        let mut again = SweepCounts::default();
        for (rule, listed) in second_node {
            let launched = end_listed(db, &launcher, rule, listed, NOW, &mut again).await;
            assert!(launched.is_empty(), "second_node_sweeps_same_rows");
        }
        assert_eq!(
            again,
            SweepCounts::default(),
            "second_node_sweeps_same_rows"
        );
        assert_eq!(
            turns.cancelled.lock().unwrap().len(),
            6,
            "second_node_sweeps_same_rows"
        );
    }
}

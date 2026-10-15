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

//! Incident analysis runs (`rca_runs`) and the run summary columns of `alert_incidents`.
//!
//! [start_run] and [update_run] are the only writers of both (RR-3). Each is one
//! transaction that holds the run change, the incident's run summary and the timeline
//! event, so a failed part leaves nothing written (RR-4). Both lock the incident row before
//! any run row, so concurrent starts, updates and sweeps never wait on each other in a cycle.

use std::str::FromStr;

use config::meta::alerts::{
    incidents::IncidentEvent,
    rca_runs::{
        RcaRun, RcaRunItem, RcaSummary, RunError, RunMode, RunState, RunStats, RunSubjectType,
        RunSummaryFields, RunTrigger, is_live_blocking, is_stale, next_previous,
    },
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseTransaction, DbErr,
    EntityTrait, FromQueryResult, QueryFilter, QueryOrder, QuerySelect, Select, Set,
    TransactionTrait,
    sea_query::{Expr, LockType},
};
use svix_ksuid::KsuidLike;

pub use super::entity::rca_runs::Model;
use super::{
    entity::{alert_incidents, rca_runs},
    incident_events,
};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

/// `error.code` of a run that stopped writing (RR-6, RR-40).
pub const STALE_ERROR_CODE: &str = "stale";
/// `error.reason` of a stale run.
pub const STALE_ERROR_REASON: &str = "The analysis stopped responding";

/// Steering users kept in the run summary, newest first.
const STEERED_BY_MAX: usize = 3;

/// A new run id: a KSUID, so ids sort by time.
pub fn new_run_id() -> String {
    svix_ksuid::Ksuid::new(None, None).to_string()
}

/// The row [start_run] inserts.
#[derive(Debug, Clone)]
pub struct NewRun {
    pub run_id: String,
    pub org_id: String,
    pub subject_type: RunSubjectType,
    pub subject_id: String,
    pub incident_id: Option<String>,
    pub trigger: RunTrigger,
    pub mode: RunMode,
    pub started_by: String,
    pub guidance: Option<String>,
}

/// The values [start_run] decides with.
#[derive(Debug, Clone, Copy)]
pub struct StartGuards {
    pub now_us: i64,
    pub rca_timeout_secs: u64,
    /// `None` skips the cooldown (user-started runs).
    pub cooldown_us: Option<i64>,
    /// `O2_INCIDENTS_RCA_HISTORY_LIMIT` (RR-25).
    pub history_limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartResult {
    Started {
        run_id: String,
    },
    /// The latest run is live and not stale (RR-9), or a concurrent start won (RR-5).
    InFlight,
    /// The newest completed run ended within the cooldown (RR-8).
    CoolingDown,
}

/// One [update_run] write. `state: None` is a progress write.
#[derive(Debug, Clone, Default)]
pub struct RunUpdate {
    pub state: Option<RunState>,
    pub report: Option<String>,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    pub result: Option<serde_json::Value>,
    pub error: Option<RunError>,
    pub cancelled_by: Option<String>,
    /// Merged key by key into the stored stats.
    pub stats: Option<RunStats>,
    pub summary: Option<RunSummaryPatch>,
    pub steered_by_add: Option<String>,
    pub session_id: Option<String>,
    /// Appended to the incident's timeline in the same transaction (incident subjects).
    pub event: Option<IncidentEvent>,
    pub now_us: i64,
}

/// Changes to the incident's `rca_summary`. `None` keeps the stored value; `previous`
/// never changes after the start (RR-41).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunSummaryPatch {
    pub stage: Option<String>,
    pub stage_index: Option<u8>,
    pub steps: Option<u32>,
    pub tool_calls: Option<u32>,
    pub detail: Option<Option<String>>,
    pub cancelled_by: Option<String>,
    pub unblocked_by: Option<String>,
    pub deadline_at: Option<Option<i64>>,
}

/// The run summary columns that [start_run] reads.
#[derive(Debug, FromQueryResult)]
struct SeenSummary {
    rca_run_id: Option<String>,
    rca_state: Option<String>,
    rca_updated_at: Option<i64>,
    rca_outcome: Option<String>,
    rca_confidence: Option<String>,
    rca_summary: Option<serde_json::Value>,
}

/// `SELECT ... FOR UPDATE`, except on SQLite, which serializes writers and has no row lock.
fn locked<E: EntityTrait>(txn: &DatabaseTransaction, query: Select<E>) -> Select<E> {
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Sqlite {
        query
    } else {
        query.lock(LockType::Update)
    }
}

fn decode_summary(raw: Option<&serde_json::Value>) -> RunSummaryFields {
    raw.and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn encode<T: serde::Serialize>(value: &T, what: &str) -> Result<serde_json::Value, DbErr> {
    serde_json::to_value(value).map_err(|e| DbErr::Custom(format!("serialize {what}: {e}")))
}

/// Starts a run (RR-5 to RR-8, RR-25, RR-41) in one transaction.
///
/// Incident subject: lock the incident's run summary, return `InFlight` while the latest run
/// blocks (RR-9) and `CoolingDown` when the newest completed run ended within the cooldown,
/// compare-and-set the summary on the `rca_run_id` and `rca_state` that were read, fail the
/// replaced run when it was stale, insert the run, append `begin_event`, prune. Alert subject:
/// insert and prune only.
pub async fn start_run(
    new: NewRun,
    guards: StartGuards,
    begin_event: Option<IncidentEvent>,
) -> Result<StartResult, DbErr> {
    start_run_with(get_orm_client_rw().await, new, guards, begin_event).await
}

/// [start_run] on a given connection.
pub async fn start_run_with<C: TransactionTrait>(
    db: &C,
    new: NewRun,
    guards: StartGuards,
    begin_event: Option<IncidentEvent>,
) -> Result<StartResult, DbErr> {
    let txn = db.begin().await?;
    let now = guards.now_us;

    if new.subject_type == RunSubjectType::Incident {
        let query = alert_incidents::Entity::find_by_id(new.subject_id.as_str())
            .filter(alert_incidents::Column::OrgId.eq(new.org_id.as_str()))
            .select_only()
            .columns([
                alert_incidents::Column::RcaRunId,
                alert_incidents::Column::RcaState,
                alert_incidents::Column::RcaUpdatedAt,
                alert_incidents::Column::RcaOutcome,
                alert_incidents::Column::RcaConfidence,
                alert_incidents::Column::RcaSummary,
            ]);
        let Some(seen) = locked(&txn, query)
            .into_model::<SeenSummary>()
            .one(&txn)
            .await?
        else {
            txn.rollback().await?;
            return Err(DbErr::RecordNotFound(format!(
                "incident {}/{}",
                new.org_id, new.subject_id
            )));
        };

        let seen_state = seen
            .rca_state
            .as_deref()
            .and_then(|s| RunState::from_str(s).ok());
        let seen_updated_at = seen.rca_updated_at.unwrap_or_default();
        if seen_state.is_some_and(|state| {
            is_live_blocking(state, seen_updated_at, now, guards.rca_timeout_secs)
        }) {
            txn.rollback().await?;
            return Ok(StartResult::InFlight);
        }

        if let Some(cooldown) = guards.cooldown_us {
            let newest = newest_completed_with(
                &txn,
                &new.org_id,
                Condition::all()
                    .add(rca_runs::Column::SubjectType.eq(RunSubjectType::Incident.as_str()))
                    .add(rca_runs::Column::SubjectId.eq(new.subject_id.as_str())),
            )
            .await?;
            if newest
                .and_then(|run| run.ended_at)
                .is_some_and(|ended_at| now.saturating_sub(ended_at) < cooldown)
            {
                txn.rollback().await?;
                return Ok(StartResult::CoolingDown);
            }
        }

        let seen_summary = seen.rca_summary.as_ref().map(|v| decode_summary(Some(v)));
        let summary = RunSummaryFields {
            previous: next_previous(
                seen.rca_run_id.as_deref(),
                seen_state,
                seen.rca_updated_at,
                seen.rca_outcome.as_deref(),
                seen.rca_confidence.as_deref(),
                seen_summary.as_ref(),
            ),
            ..Default::default()
        };

        // NULL-safe compare-and-set: `IS NULL` when the read saw NULL, `=` otherwise.
        let cas = alert_incidents::Entity::update_many()
            .col_expr(
                alert_incidents::Column::RcaRunId,
                Expr::value(new.run_id.clone()),
            )
            .col_expr(
                alert_incidents::Column::RcaState,
                Expr::value(RunState::Running.as_str()),
            )
            .col_expr(alert_incidents::Column::RcaStartedAt, Expr::value(now))
            .col_expr(alert_incidents::Column::RcaUpdatedAt, Expr::value(now))
            .col_expr(
                alert_incidents::Column::RcaOutcome,
                Expr::value(Option::<String>::None),
            )
            .col_expr(
                alert_incidents::Column::RcaConfidence,
                Expr::value(Option::<String>::None),
            )
            .col_expr(
                alert_incidents::Column::RcaSummary,
                Expr::value(encode(&summary, "rca_summary")?),
            )
            .filter(alert_incidents::Column::Id.eq(new.subject_id.as_str()))
            .filter(alert_incidents::Column::OrgId.eq(new.org_id.as_str()))
            .filter(match seen.rca_run_id.as_deref() {
                Some(id) => alert_incidents::Column::RcaRunId.eq(id),
                None => alert_incidents::Column::RcaRunId.is_null(),
            })
            .filter(match seen.rca_state.as_deref() {
                Some(state) => alert_incidents::Column::RcaState.eq(state),
                None => alert_incidents::Column::RcaState.is_null(),
            })
            .exec(&txn)
            .await?;
        if cas.rows_affected == 0 {
            txn.rollback().await?;
            return Ok(StartResult::InFlight);
        }

        // RR-6: the replaced run stopped writing; end it in this transaction.
        if let Some(seen_run_id) = seen.rca_run_id.as_deref()
            && seen_state
                .is_some_and(|state| is_stale(state, seen_updated_at, now, guards.rca_timeout_secs))
        {
            fail_stale_with(&txn, &new.org_id, seen_run_id, now).await?;
        }
    }

    rca_runs::ActiveModel {
        run_id: Set(new.run_id.clone()),
        org_id: Set(new.org_id.clone()),
        subject_type: Set(new.subject_type.as_str().to_string()),
        subject_id: Set(new.subject_id.clone()),
        incident_id: Set(new.incident_id.clone()),
        trigger: Set(new.trigger.as_str().to_string()),
        mode: Set(new.mode.as_str().to_string()),
        started_by: Set(new.started_by.clone()),
        guidance: Set(new.guidance.clone()),
        state: Set(RunState::Running.as_str().to_string()),
        started_at: Set(now),
        updated_at: Set(now),
        ended_at: Set(None),
        cancelled_by: Set(None),
        outcome: Set(None),
        confidence: Set(None),
        report: Set(None),
        result: Set(None),
        error: Set(None),
        session_id: Set(None),
        stats: Set(None),
    }
    .insert(&txn)
    .await?;

    if new.subject_type == RunSubjectType::Incident
        && let Some(event) = begin_event
    {
        incident_events::append_in(&txn, &new.org_id, &new.subject_id, event).await?;
    }

    prune_with(
        &txn,
        &new.org_id,
        new.subject_type,
        &new.subject_id,
        guards.history_limit,
    )
    .await?;

    txn.commit().await?;
    Ok(StartResult::Started { run_id: new.run_id })
}

/// Ends a `running` run as `failed`/`stale` (RR-6). No timeline event (D9).
async fn fail_stale_with(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_id: &str,
    now: i64,
) -> Result<(), DbErr> {
    let Some(run) = locked(
        txn,
        rca_runs::Entity::find_by_id(run_id).filter(rca_runs::Column::OrgId.eq(org_id)),
    )
    .one(txn)
    .await?
    else {
        return Ok(());
    };
    let error = RunError {
        code: STALE_ERROR_CODE.to_string(),
        reason: STALE_ERROR_REASON.to_string(),
        details: None,
        trigger_type: None,
    };
    let stats = merge_stats(
        run.stats.as_ref(),
        None,
        Some(duration_ms(run.started_at, now)),
    );
    rca_runs::Entity::update_many()
        .col_expr(
            rca_runs::Column::State,
            Expr::value(RunState::Failed.as_str()),
        )
        .col_expr(
            rca_runs::Column::Error,
            Expr::value(encode(&error, "error")?),
        )
        .col_expr(
            rca_runs::Column::Stats,
            Expr::value(encode(&stats, "stats")?),
        )
        .col_expr(rca_runs::Column::EndedAt, Expr::value(now))
        .col_expr(rca_runs::Column::UpdatedAt, Expr::value(now))
        .filter(rca_runs::Column::RunId.eq(run_id))
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::State.eq(RunState::Running.as_str()))
        .exec(txn)
        .await?;
    Ok(())
}

/// RR-25: keep the subject's newest `history_limit + 1` runs and its newest `completed` run;
/// delete only terminal runs.
async fn prune_with(
    txn: &DatabaseTransaction,
    org_id: &str,
    subject_type: RunSubjectType,
    subject_id: &str,
    history_limit: usize,
) -> Result<(), DbErr> {
    let runs: Vec<(String, String)> = rca_runs::Entity::find()
        .select_only()
        .columns([rca_runs::Column::RunId, rca_runs::Column::State])
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::SubjectType.eq(subject_type.as_str()))
        .filter(rca_runs::Column::SubjectId.eq(subject_id))
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .into_tuple()
        .all(txn)
        .await?;

    let keep = history_limit.saturating_add(1);
    if runs.len() <= keep {
        return Ok(());
    }
    let newest_completed = runs
        .iter()
        .find(|(_, state)| state == RunState::Completed.as_str())
        .map(|(id, _)| id.clone());
    let doomed: Vec<String> = runs
        .into_iter()
        .skip(keep)
        .filter(|(id, state)| {
            Some(id) != newest_completed.as_ref()
                && RunState::from_str(state).is_ok_and(|s| s.is_terminal())
        })
        .map(|(id, _)| id)
        .collect();
    if doomed.is_empty() {
        return Ok(());
    }
    rca_runs::Entity::delete_many()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::RunId.is_in(doomed))
        .filter(rca_runs::Column::State.is_in([
            RunState::Completed.as_str(),
            RunState::Failed.as_str(),
            RunState::Cancelled.as_str(),
        ]))
        .exec(txn)
        .await?;
    Ok(())
}

/// The states a run may move from to reach `target` (01 §7). `None` is a progress write,
/// allowed only while the run is `running`.
fn allowed_from(target: Option<RunState>) -> &'static [RunState] {
    match target {
        None | Some(RunState::Completed) | Some(RunState::Failed) => &[RunState::Running],
        Some(RunState::WaitingInput) => &[RunState::Running],
        Some(RunState::Running) => &[RunState::Running, RunState::WaitingInput],
        Some(RunState::Cancelled) => &[RunState::Running, RunState::WaitingInput],
    }
}

fn duration_ms(started_at_us: i64, ended_at_us: i64) -> u64 {
    u64::try_from(ended_at_us.saturating_sub(started_at_us) / 1000).unwrap_or(0)
}

/// Stored stats with every field of `patch` that is set, then `duration_ms` when given.
fn merge_stats(
    stored: Option<&serde_json::Value>,
    patch: Option<&RunStats>,
    duration_ms: Option<u64>,
) -> RunStats {
    let mut stats: RunStats = stored
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    if let Some(p) = patch {
        if p.steps.is_some() {
            stats.steps = p.steps;
        }
        if p.tool_calls.is_some() {
            stats.tool_calls = p.tool_calls;
        }
        if p.duration_ms.is_some() {
            stats.duration_ms = p.duration_ms;
        }
        if p.tokens.is_some() {
            stats.tokens = p.tokens.clone();
        }
        if p.credits.is_some() {
            stats.credits = p.credits;
        }
        if p.steered.is_some() {
            stats.steered = p.steered;
        }
    }
    if duration_ms.is_some() {
        stats.duration_ms = duration_ms;
    }
    stats
}

/// The incident's `rca_summary` after `upd`. `previous` is never touched (RR-41).
fn merge_summary(mut summary: RunSummaryFields, upd: &RunUpdate) -> RunSummaryFields {
    // The summary mirrors the run: a cancel names its user and a failure its reason,
    // unless the patch says otherwise (D7).
    if let Some(user) = upd.cancelled_by.as_ref() {
        summary.cancelled_by = Some(user.clone());
    }
    if let Some(error) = upd.error.as_ref() {
        summary.detail = Some(error.reason.clone());
    }
    if let Some(p) = upd.summary.as_ref() {
        if p.stage.is_some() {
            summary.stage = p.stage.clone();
        }
        if p.stage_index.is_some() {
            summary.stage_index = p.stage_index;
        }
        if let Some(steps) = p.steps {
            summary.steps = steps;
        }
        if let Some(tool_calls) = p.tool_calls {
            summary.tool_calls = tool_calls;
        }
        if let Some(detail) = p.detail.as_ref() {
            summary.detail = detail.clone();
        }
        if p.cancelled_by.is_some() {
            summary.cancelled_by = p.cancelled_by.clone();
        }
        if p.unblocked_by.is_some() {
            summary.unblocked_by = p.unblocked_by.clone();
        }
        if let Some(deadline_at) = p.deadline_at {
            summary.deadline_at = deadline_at;
        }
    }
    if let Some(user) = upd.steered_by_add.as_ref() {
        summary.steered_by.retain(|u| u != user);
        summary.steered_by.insert(0, user.clone());
        summary.steered_by.truncate(STEERED_BY_MAX);
    }
    summary
}

/// Changes a run from an allowed state (01 §7, RR-11) and, for an incident subject, its run
/// summary while the incident still names this run, plus the event, in one transaction.
/// `Ok(false)`: the run is gone, not in an allowed state, or no longer the incident's latest
/// run; nothing was written.
pub async fn update_run(org_id: &str, run_id: &str, upd: RunUpdate) -> Result<bool, DbErr> {
    update_run_with(get_orm_client_rw().await, org_id, run_id, upd).await
}

/// [update_run] on a given connection.
///
/// Locks the incident row before the run row, as [start_run_with] does: the run's subject
/// never changes, so it is read without a lock first; an incident subject then locks the
/// incident while it names this run; last the run row is locked and its state checked again.
pub async fn update_run_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    let now = upd.now_us;
    let from = allowed_from(upd.state);
    let allowed = |state: &str| RunState::from_str(state).is_ok_and(|s| from.contains(&s));

    let Some((subject_type, subject_id, _)) = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .select_only()
        .columns([
            rca_runs::Column::SubjectType,
            rca_runs::Column::SubjectId,
            rca_runs::Column::State,
        ])
        .into_tuple::<(String, String, String)>()
        .one(&txn)
        .await?
        .filter(|(_, _, state)| allowed(state.as_str()))
    else {
        txn.rollback().await?;
        return Ok(false);
    };

    // The incident and its summary after `upd`, while the incident still names this run.
    let incident = if subject_type == RunSubjectType::Incident.as_str() {
        let Some(stored) = locked(
            &txn,
            alert_incidents::Entity::find_by_id(subject_id.as_str())
                .filter(alert_incidents::Column::OrgId.eq(org_id))
                .filter(alert_incidents::Column::RcaRunId.eq(run_id))
                .select_only()
                .column(alert_incidents::Column::RcaSummary),
        )
        .into_tuple::<Option<serde_json::Value>>()
        .one(&txn)
        .await?
        else {
            txn.rollback().await?;
            return Ok(false);
        };
        Some((
            subject_id,
            merge_summary(decode_summary(stored.as_ref()), &upd),
        ))
    } else {
        None
    };

    let Some((_, started_at, stored_stats)) = locked(
        &txn,
        rca_runs::Entity::find_by_id(run_id)
            .filter(rca_runs::Column::OrgId.eq(org_id))
            .select_only()
            .columns([
                rca_runs::Column::State,
                rca_runs::Column::StartedAt,
                rca_runs::Column::Stats,
            ]),
    )
    .into_tuple::<(String, i64, Option<serde_json::Value>)>()
    .one(&txn)
    .await?
    .filter(|(state, ..)| allowed(state.as_str())) else {
        txn.rollback().await?;
        return Ok(false);
    };

    let terminal = upd.state.is_some_and(|s| s.is_terminal());
    let mut update = rca_runs::Entity::update_many()
        .col_expr(rca_runs::Column::UpdatedAt, Expr::value(now))
        .filter(rca_runs::Column::RunId.eq(run_id))
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::State.is_in(from.iter().map(|s| s.as_str())));
    if let Some(state) = upd.state {
        update = update.col_expr(rca_runs::Column::State, Expr::value(state.as_str()));
    }
    if terminal {
        update = update.col_expr(rca_runs::Column::EndedAt, Expr::value(now));
    }
    if upd.stats.is_some() || terminal {
        let duration = terminal.then(|| duration_ms(started_at, now));
        let stats = merge_stats(stored_stats.as_ref(), upd.stats.as_ref(), duration);
        update = update.col_expr(
            rca_runs::Column::Stats,
            Expr::value(encode(&stats, "stats")?),
        );
    }
    if let Some(report) = upd.report.as_ref() {
        update = update.col_expr(rca_runs::Column::Report, Expr::value(report.clone()));
    }
    if let Some(outcome) = upd.outcome.as_ref() {
        update = update.col_expr(rca_runs::Column::Outcome, Expr::value(outcome.clone()));
    }
    if let Some(confidence) = upd.confidence.as_ref() {
        update = update.col_expr(
            rca_runs::Column::Confidence,
            Expr::value(confidence.clone()),
        );
    }
    if let Some(result) = upd.result.as_ref() {
        update = update.col_expr(rca_runs::Column::Result, Expr::value(result.clone()));
    }
    if let Some(error) = upd.error.as_ref() {
        update = update.col_expr(
            rca_runs::Column::Error,
            Expr::value(encode(error, "error")?),
        );
    }
    if let Some(user) = upd.cancelled_by.as_ref() {
        update = update.col_expr(rca_runs::Column::CancelledBy, Expr::value(user.clone()));
    }
    if let Some(session_id) = upd.session_id.as_ref() {
        update = update.col_expr(rca_runs::Column::SessionId, Expr::value(session_id.clone()));
    }
    if update.exec(&txn).await?.rows_affected == 0 {
        txn.rollback().await?;
        return Ok(false);
    }

    if let Some((incident_id, summary)) = incident {
        let mut write = alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::RcaUpdatedAt, Expr::value(now))
            .col_expr(
                alert_incidents::Column::RcaSummary,
                Expr::value(encode(&summary, "rca_summary")?),
            )
            .filter(alert_incidents::Column::Id.eq(incident_id.as_str()))
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::RcaRunId.eq(run_id));
        if let Some(state) = upd.state {
            write = write.col_expr(
                alert_incidents::Column::RcaState,
                Expr::value(state.as_str()),
            );
        }
        if let Some(outcome) = upd.outcome.as_ref() {
            write = write.col_expr(
                alert_incidents::Column::RcaOutcome,
                Expr::value(outcome.clone()),
            );
        }
        if let Some(confidence) = upd.confidence.as_ref() {
            write = write.col_expr(
                alert_incidents::Column::RcaConfidence,
                Expr::value(confidence.clone()),
            );
        }
        if write.exec(&txn).await?.rows_affected == 0 {
            txn.rollback().await?;
            return Ok(false);
        }

        if let Some(event) = upd.event {
            incident_events::append_in(&txn, org_id, &incident_id, event).await?;
        }
    }

    txn.commit().await?;
    Ok(true)
}

/// One run.
pub async fn get(org_id: &str, run_id: &str) -> Result<Option<Model>, DbErr> {
    get_with(get_orm_client_ro().await, org_id, run_id).await
}

/// [get] on the primary, for a write path that must see a run committed just before.
pub async fn get_rw(org_id: &str, run_id: &str) -> Result<Option<Model>, DbErr> {
    get_with(get_orm_client_rw().await, org_id, run_id).await
}

async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
) -> Result<Option<Model>, DbErr> {
    rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .one(conn)
        .await
}

/// Runs whose `incident_id` is the incident (its own runs and the page runs linked to it),
/// newest first, `limit` at most, strictly older than the run `before` when given. The flag
/// says whether older runs remain.
pub async fn list_for_incident(
    org_id: &str,
    incident_id: &str,
    limit: u64,
    before: Option<&str>,
) -> Result<(Vec<Model>, bool), DbErr> {
    let client = get_orm_client_ro().await;
    let mut query = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::IncidentId.eq(incident_id));
    if let Some(before) = before {
        let Some(cursor) = rca_runs::Entity::find_by_id(before)
            .filter(rca_runs::Column::OrgId.eq(org_id))
            .one(client)
            .await?
        else {
            return Ok((Vec::new(), false));
        };
        // Same order as the sort below: (started_at, run_id) descending.
        query = query.filter(
            Condition::any()
                .add(rca_runs::Column::StartedAt.lt(cursor.started_at))
                .add(
                    Condition::all()
                        .add(rca_runs::Column::StartedAt.eq(cursor.started_at))
                        .add(rca_runs::Column::RunId.lt(cursor.run_id)),
                ),
        );
    }
    let limit = limit.max(1);
    let mut runs = query
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .limit(limit + 1)
        .all(client)
        .await?;
    let has_more = runs.len() as u64 > limit;
    runs.truncate(limit as usize);
    Ok((runs, has_more))
}

/// The newest `completed` run whose `incident_id` is the incident (RR-27, RR-29, RR-31).
pub async fn newest_completed_for_incident(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<Model>, DbErr> {
    newest_completed_with(
        get_orm_client_ro().await,
        org_id,
        Condition::all().add(rca_runs::Column::IncidentId.eq(incident_id)),
    )
    .await
}

async fn newest_completed_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    which: Condition,
) -> Result<Option<Model>, DbErr> {
    rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(which)
        .filter(rca_runs::Column::State.eq(RunState::Completed.as_str()))
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .one(conn)
        .await
}

/// `running` runs with no write for longer than `stale_threshold_us` (RR-40), oldest first.
pub async fn list_stale_running(
    now_us: i64,
    stale_threshold_us: i64,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    rca_runs::Entity::find()
        .filter(rca_runs::Column::State.eq(RunState::Running.as_str()))
        .filter(rca_runs::Column::UpdatedAt.lt(now_us.saturating_sub(stale_threshold_us)))
        .order_by_asc(rca_runs::Column::UpdatedAt)
        .limit(limit)
        .all(get_orm_client_rw().await)
        .await
}

/// Deletes every run of the org (RR-26).
pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    rca_runs::Entity::delete_many()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

/// Parses a stored enum column; an unknown value (a newer node's) reads as `fallback`.
fn parse_or<T: FromStr>(raw: &str, fallback: T, run_id: &str, column: &str) -> T {
    T::from_str(raw).unwrap_or_else(|_| {
        log::warn!("[RCA_RUNS] run {run_id} has unknown {column} {raw:?}");
        fallback
    })
}

fn state_of(m: &Model) -> RunState {
    parse_or(&m.state, RunState::Failed, &m.run_id, "state")
}

fn error_of(m: &Model) -> Option<RunError> {
    m.error
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// The API form of a run.
pub fn to_run(m: Model) -> RcaRun {
    let state = state_of(&m);
    let error = error_of(&m);
    let stats = m
        .stats
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    RcaRun {
        subject_type: parse_or(
            &m.subject_type,
            RunSubjectType::Incident,
            &m.run_id,
            "subject_type",
        ),
        trigger: parse_or(&m.trigger, RunTrigger::Legacy, &m.run_id, "trigger"),
        mode: parse_or(&m.mode, RunMode::Fresh, &m.run_id, "mode"),
        state,
        error,
        stats,
        run_id: m.run_id,
        subject_id: m.subject_id,
        incident_id: m.incident_id,
        started_by: m.started_by,
        guidance: m.guidance,
        started_at: m.started_at,
        updated_at: m.updated_at,
        ended_at: m.ended_at,
        cancelled_by: m.cancelled_by,
        outcome: m.outcome,
        confidence: m.confidence,
        report: m.report,
        result: m.result,
        session_id: m.session_id,
    }
}

/// The history-list form of a run.
pub fn to_item(m: &Model) -> RcaRunItem {
    RcaRunItem {
        run_id: m.run_id.clone(),
        subject_type: parse_or(
            &m.subject_type,
            RunSubjectType::Incident,
            &m.run_id,
            "subject_type",
        ),
        trigger: parse_or(&m.trigger, RunTrigger::Legacy, &m.run_id, "trigger"),
        mode: parse_or(&m.mode, RunMode::Fresh, &m.run_id, "mode"),
        started_by: m.started_by.clone(),
        state: state_of(m),
        started_at: m.started_at,
        ended_at: m.ended_at,
        outcome: m.outcome.clone(),
        confidence: m.confidence.clone(),
        cancelled_by: m.cancelled_by.clone(),
        error_reason: error_of(m).map(|e| e.reason),
    }
}

/// The incident's run summary (01 §11.1) with `stale` computed (RR-9); `None` when the
/// incident was never analyzed. Detail fields stay empty.
pub fn summary_from_incident(
    inc: &alert_incidents::Model,
    now_us: i64,
    rca_timeout_secs: u64,
) -> Option<RcaSummary> {
    let run_id = inc.rca_run_id.clone()?;
    let state = parse_or(
        inc.rca_state.as_deref()?,
        RunState::Failed,
        &run_id,
        "rca_state",
    );
    let started_at = inc.rca_started_at.unwrap_or_default();
    let updated_at = inc.rca_updated_at.unwrap_or(started_at);
    Some(RcaSummary {
        run_id,
        state,
        stale: is_stale(state, updated_at, now_us, rca_timeout_secs),
        started_at,
        updated_at,
        outcome: inc.rca_outcome.clone(),
        confidence: inc.rca_confidence.clone(),
        summary: decode_summary(inc.rca_summary.as_ref()),
        detail: None,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::{
        incidents::{AnalysisTriggerType, IncidentEventType},
        rca_runs::PreviousResult,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::entity::incident_events as events_entity;

    const ORG: &str = "acme";
    const SEC: i64 = 1_000_000;
    const T0: i64 = 1_700_000_000 * SEC;
    const TIMEOUT: u64 = 600;

    async fn create_tables(db: &DatabaseConnection) {
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(rca_runs::Entity),
            schema.create_table_from_entity(alert_incidents::Entity),
            schema.create_table_from_entity(events_entity::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
    }

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables(&db).await;
        db
    }

    /// A never-analyzed incident with an empty timeline.
    async fn incident<C: ConnectionTrait>(db: &C, id: &str) {
        alert_incidents::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set(ORG.to_string()),
            status: Set("open".to_string()),
            severity: Set("P2".to_string()),
            group_values: Set(serde_json::json!({"service": "payments"})),
            key_type: Set("service".to_string()),
            topology_context: Set(None),
            first_alert_at: Set(T0),
            last_alert_at: Set(T0),
            resolved_at: Set(None),
            alert_count: Set(1),
            title: Set(None),
            assigned_to: Set(None),
            acknowledged_by: Set(None),
            acknowledged_at: Set(None),
            created_at: Set(T0),
            updated_at: Set(T0),
            muted_by_downtime_id: Set(None),
            rca_run_id: Set(None),
            rca_state: Set(None),
            rca_started_at: Set(None),
            rca_updated_at: Set(None),
            rca_outcome: Set(None),
            rca_confidence: Set(None),
            rca_summary: Set(None),
            rca_off_reason: Set(None),
        }
        .insert(db)
        .await
        .unwrap();
        events_entity::ActiveModel {
            org_id: Set(ORG.to_string()),
            incident_id: Set(id.to_string()),
            events: Set(serde_json::json!([])),
        }
        .insert(db)
        .await
        .unwrap();
    }

    fn new_run(subject_type: RunSubjectType, subject_id: &str) -> NewRun {
        NewRun {
            run_id: new_run_id(),
            org_id: ORG.to_string(),
            subject_type,
            subject_id: subject_id.to_string(),
            incident_id: (subject_type == RunSubjectType::Incident).then(|| subject_id.to_string()),
            trigger: RunTrigger::Manual,
            mode: RunMode::Fresh,
            started_by: "a.rao@acme.io".to_string(),
            guidance: None,
        }
    }

    fn guards(now_us: i64) -> StartGuards {
        StartGuards {
            now_us,
            rca_timeout_secs: TIMEOUT,
            cooldown_us: None,
            history_limit: 25,
        }
    }

    /// Starts an incident run with a Begin event; panics unless it started.
    async fn start(db: &DatabaseConnection, incident_id: &str, now: i64) -> String {
        match start_run_with(
            db,
            new_run(RunSubjectType::Incident, incident_id),
            guards(now),
            Some(IncidentEvent::ai_analysis_begin()),
        )
        .await
        .unwrap()
        {
            StartResult::Started { run_id } => run_id,
            other => panic!("expected Started, got {other:?}"),
        }
    }

    fn update(state: Option<RunState>, now_us: i64) -> RunUpdate {
        RunUpdate {
            state,
            now_us,
            ..Default::default()
        }
    }

    /// The update a run's finish writes, with its timeline event.
    fn finish_update(state: RunState, now_us: i64) -> RunUpdate {
        let mut upd = update(Some(state), now_us);
        match state {
            RunState::Completed => {
                upd.report = Some("# RCA\n\nPool exhausted".to_string());
                upd.outcome = Some("root_cause".to_string());
                upd.confidence = Some("high".to_string());
                upd.event = Some(IncidentEvent::ai_analysis_complete());
            }
            RunState::Failed => {
                upd.error = Some(RunError {
                    code: "service_call_failed".to_string(),
                    reason: "The agent did not answer".to_string(),
                    details: None,
                    trigger_type: Some("manual".to_string()),
                });
                upd.event = Some(IncidentEvent::ai_analysis_failed(
                    "The agent did not answer",
                    AnalysisTriggerType::Manual,
                    None,
                ));
            }
            RunState::Cancelled => {
                upd.cancelled_by = Some("a.rao".to_string());
                upd.event = Some(IncidentEvent::ai_analysis_cancelled(Some(
                    "a.rao".to_string(),
                )));
            }
            RunState::Running | RunState::WaitingInput => {}
        }
        upd
    }

    async fn finish(db: &DatabaseConnection, run_id: &str, state: RunState, now: i64) {
        assert!(
            update_run_with(db, ORG, run_id, finish_update(state, now))
                .await
                .unwrap(),
            "{state} write of {run_id} was refused"
        );
    }

    async fn run(db: &DatabaseConnection, run_id: &str) -> Option<Model> {
        rca_runs::Entity::find_by_id(run_id).one(db).await.unwrap()
    }

    async fn runs_of(db: &DatabaseConnection, subject_id: &str) -> Vec<Model> {
        rca_runs::Entity::find()
            .filter(rca_runs::Column::SubjectId.eq(subject_id))
            .order_by_desc(rca_runs::Column::StartedAt)
            .all(db)
            .await
            .unwrap()
    }

    async fn inc(db: &DatabaseConnection, id: &str) -> alert_incidents::Model {
        alert_incidents::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    async fn events(db: &DatabaseConnection, incident_id: &str) -> serde_json::Value {
        events_entity::Entity::find()
            .filter(events_entity::Column::OrgId.eq(ORG))
            .filter(events_entity::Column::IncidentId.eq(incident_id))
            .one(db)
            .await
            .unwrap()
            .map(|row| row.events)
            .unwrap_or(serde_json::Value::Null)
    }

    async fn event_types(db: &DatabaseConnection, incident_id: &str) -> Vec<IncidentEventType> {
        serde_json::from_value::<Vec<IncidentEvent>>(events(db, incident_id).await)
            .unwrap()
            .into_iter()
            .map(|e| e.event_type)
            .collect()
    }

    fn summary_of(m: &alert_incidents::Model) -> RunSummaryFields {
        decode_summary(m.rca_summary.as_ref())
    }

    /// RR-2: the seven summary columns equal the run that `rca_run_id` names.
    async fn assert_summary_mirrors_run(db: &DatabaseConnection, incident_id: &str) -> Model {
        let incident = inc(db, incident_id).await;
        let run_id = incident.rca_run_id.clone().expect("rca_run_id set");
        let run = run(db, &run_id).await.expect("named run exists");
        assert_eq!(incident.rca_state.as_deref(), Some(run.state.as_str()));
        assert_eq!(incident.rca_started_at, Some(run.started_at));
        assert_eq!(incident.rca_updated_at, Some(run.updated_at));
        assert_eq!(incident.rca_outcome, run.outcome);
        assert_eq!(incident.rca_confidence, run.confidence);
        let summary = summary_of(&incident);
        assert_eq!(summary.cancelled_by, run.cancelled_by);
        if let Some(error) = error_of(&run) {
            assert_eq!(summary.detail.as_deref(), Some(error.reason.as_str()));
        }
        run
    }

    /// RR-1, RR-2: a started run has one row; after each lifecycle write the summary
    /// columns equal the run row.
    #[tokio::test]
    async fn rr1_rr2_each_lifecycle_write_keeps_the_summary_equal_to_the_run() {
        let db = db().await;
        incident(&db, "inc-1").await;

        let r1 = start(&db, "inc-1", T0).await;
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.run_id, r1);
        assert_eq!(row.state, "running");
        assert_eq!(
            (row.started_at, row.updated_at, row.ended_at),
            (T0, T0, None)
        );

        // Progress write.
        let mut progress = update(None, T0 + SEC);
        progress.summary = Some(RunSummaryPatch {
            stage: Some("gather".to_string()),
            stage_index: Some(2),
            steps: Some(4),
            tool_calls: Some(9),
            ..Default::default()
        });
        assert!(update_run_with(&db, ORG, &r1, progress).await.unwrap());
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.updated_at, T0 + SEC);
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(summary.stage.as_deref(), Some("gather"));
        assert_eq!((summary.steps, summary.tool_calls), (4, 9));

        finish(&db, &r1, RunState::Completed, T0 + 90 * SEC).await;
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.state, "completed");
        assert_eq!(row.ended_at, Some(T0 + 90 * SEC));
        assert!(row.report.is_some());
        let stats: RunStats = serde_json::from_value(row.stats.unwrap()).unwrap();
        assert_eq!(stats.duration_ms, Some(90_000));

        let r2 = start(&db, "inc-1", T0 + 100 * SEC).await;
        finish(&db, &r2, RunState::Failed, T0 + 110 * SEC).await;
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(
            (row.run_id.as_str(), row.state.as_str()),
            (r2.as_str(), "failed")
        );

        let r3 = start(&db, "inc-1", T0 + 200 * SEC).await;
        assert_eq!(
            inc(&db, "inc-1").await.rca_outcome,
            None,
            "a new run clears the outcome"
        );
        finish(&db, &r3, RunState::Cancelled, T0 + 210 * SEC).await;
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.cancelled_by.as_deref(), Some("a.rao"));

        assert_eq!(runs_of(&db, "inc-1").await.len(), 3);
        let types = event_types(&db, "inc-1").await;
        assert_eq!(
            types
                .iter()
                .filter(|t| matches!(t, IncidentEventType::AIAnalysisBegin))
                .count(),
            3
        );
    }

    /// RR-5 (sequential form): a second start while the latest run is live returns
    /// `InFlight` and writes no row and no event; `waiting_input` blocks too.
    #[tokio::test]
    async fn rr5_a_start_while_a_run_is_live_is_in_flight_and_writes_nothing() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;
        let before = (inc(&db, "inc-1").await, events(&db, "inc-1").await);

        let second = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(T0 + 60 * SEC),
            Some(IncidentEvent::ai_analysis_begin()),
        )
        .await
        .unwrap();
        assert_eq!(second, StartResult::InFlight);
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        assert_eq!(
            (inc(&db, "inc-1").await, events(&db, "inc-1").await),
            before
        );

        assert!(
            update_run_with(&db, ORG, &r1, update(Some(RunState::WaitingInput), T0))
                .await
                .unwrap()
        );
        let third = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(T0 + 9_999 * SEC),
            Some(IncidentEvent::ai_analysis_begin()),
        )
        .await
        .unwrap();
        assert_eq!(
            third,
            StartResult::InFlight,
            "waiting_input never goes stale"
        );
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
    }

    /// RR-5 on SQLite: two starts issued together serialize; one starts, one is in flight.
    #[tokio::test]
    async fn rr5_two_starts_together_start_one_run() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let (a, b) = tokio::join!(
            start_run_with(
                &db,
                new_run(RunSubjectType::Incident, "inc-1"),
                guards(T0),
                Some(IncidentEvent::ai_analysis_begin()),
            ),
            start_run_with(
                &db,
                new_run(RunSubjectType::Incident, "inc-1"),
                guards(T0),
                Some(IncidentEvent::ai_analysis_begin()),
            ),
        );
        let results = [a.unwrap(), b.unwrap()];
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, StartResult::Started { .. }))
                .count(),
            1
        );
        assert!(results.contains(&StartResult::InFlight));
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        assert_eq!(event_types(&db, "inc-1").await.len(), 1);
    }

    /// RR-6 / RR-9: a `running` run past the stale threshold is ended `failed`/`stale` by
    /// the next start, which becomes the latest run; before the threshold it still blocks.
    #[tokio::test]
    async fn rr6_a_start_replaces_a_stale_run_and_fails_it() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;

        let early = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(T0 + 719 * SEC),
            None,
        )
        .await
        .unwrap();
        assert_eq!(early, StartResult::InFlight);

        let now = T0 + 721 * SEC;
        let r2 = start(&db, "inc-1", now).await;
        let stale = run(&db, &r1).await.unwrap();
        assert_eq!(stale.state, "failed");
        assert_eq!(stale.ended_at, Some(now));
        let error = error_of(&stale).unwrap();
        assert_eq!(error.code, STALE_ERROR_CODE);
        assert_eq!(error.reason, STALE_ERROR_REASON);

        let incident = inc(&db, "inc-1").await;
        assert_eq!(incident.rca_run_id.as_deref(), Some(r2.as_str()));
        assert_eq!(incident.rca_state.as_deref(), Some("running"));
        assert_eq!(runs_of(&db, "inc-1").await[0].run_id, r2);
        // D9: the stale replacement appends no event of its own.
        assert_eq!(event_types(&db, "inc-1").await.len(), 2);
    }

    /// RR-8: a run completed 10 minutes ago blocks an automatic start under a 30-minute
    /// cooldown and does not block a start that skips the cooldown.
    #[tokio::test]
    async fn rr8_cooldown_blocks_automatic_starts_only() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;
        finish(&db, &r1, RunState::Completed, T0 + 60 * SEC).await;

        let now = T0 + 60 * SEC + 10 * 60 * SEC;
        let mut automatic = new_run(RunSubjectType::Incident, "inc-1");
        automatic.trigger = RunTrigger::AutoNewAlertType;
        let cooling = start_run_with(
            &db,
            automatic,
            StartGuards {
                cooldown_us: Some(30 * 60 * SEC),
                ..guards(now)
            },
            Some(IncidentEvent::ai_analysis_begin()),
        )
        .await
        .unwrap();
        assert_eq!(cooling, StartResult::CoolingDown);
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        assert_eq!(
            inc(&db, "inc-1").await.rca_run_id.as_deref(),
            Some(r1.as_str())
        );

        let r2 = start(&db, "inc-1", now).await;
        assert_eq!(
            inc(&db, "inc-1").await.rca_run_id.as_deref(),
            Some(r2.as_str())
        );

        // Past the cooldown an automatic start goes ahead.
        finish(&db, &r2, RunState::Failed, now + SEC).await;
        let later = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            StartGuards {
                cooldown_us: Some(30 * 60 * SEC),
                ..guards(T0 + 60 * SEC + 31 * 60 * SEC)
            },
            None,
        )
        .await
        .unwrap();
        assert!(matches!(later, StartResult::Started { .. }));
    }

    /// Puts a fresh incident's only run into `from`; returns its id.
    async fn run_in_state(db: &DatabaseConnection, incident_id: &str, from: RunState) -> String {
        incident(db, incident_id).await;
        let run_id = start(db, incident_id, T0).await;
        match from {
            RunState::Running => {}
            RunState::WaitingInput => {
                assert!(
                    update_run_with(db, ORG, &run_id, update(Some(from), T0 + SEC))
                        .await
                        .unwrap()
                );
            }
            terminal => finish(db, &run_id, terminal, T0 + SEC).await,
        }
        run_id
    }

    /// RR-11 / 01 §7: every (from, to) pair; a refused write changes no run, summary or
    /// event.
    #[tokio::test]
    async fn rr11_update_run_follows_the_transition_table() {
        use RunState::*;
        let db = db().await;
        let states = [Running, WaitingInput, Completed, Failed, Cancelled];
        let targets = [
            None,
            Some(Running),
            Some(WaitingInput),
            Some(Completed),
            Some(Failed),
            Some(Cancelled),
        ];
        let allowed = |from: RunState, to: Option<RunState>| {
            matches!(
                (from, to),
                (Running, _) | (WaitingInput, Some(Running) | Some(Cancelled))
            )
        };

        for (i, from) in states.into_iter().enumerate() {
            for (j, to) in targets.into_iter().enumerate() {
                let incident_id = format!("inc-{i}-{j}");
                let run_id = run_in_state(&db, &incident_id, from).await;
                let before = (
                    run(&db, &run_id).await,
                    inc(&db, &incident_id).await,
                    events(&db, &incident_id).await,
                );

                let mut upd = match to {
                    Some(state) => finish_update(state, T0 + 5 * SEC),
                    None => update(None, T0 + 5 * SEC),
                };
                upd.event
                    .get_or_insert_with(IncidentEvent::ai_analysis_complete);
                let written = update_run_with(&db, ORG, &run_id, upd).await.unwrap();
                assert_eq!(written, allowed(from, to), "{from} -> {to:?}");

                if written {
                    let row = assert_summary_mirrors_run(&db, &incident_id).await;
                    assert_eq!(row.state, to.unwrap_or(from).as_str(), "{from} -> {to:?}");
                    assert_eq!(row.updated_at, T0 + 5 * SEC);
                    assert_eq!(row.ended_at.is_some(), to.is_some_and(|s| s.is_terminal()));
                } else {
                    let after = (
                        run(&db, &run_id).await,
                        inc(&db, &incident_id).await,
                        events(&db, &incident_id).await,
                    );
                    assert_eq!(after, before, "{from} -> {to:?} wrote something");
                }
            }
        }
    }

    /// RR-11: completing a cancelled run is refused and writes no report, summary or event.
    #[tokio::test]
    async fn rr11_completing_a_cancelled_run_writes_nothing() {
        let db = db().await;
        let run_id = run_in_state(&db, "inc-1", RunState::Cancelled).await;
        let incident = inc(&db, "inc-1").await;
        let timeline = events(&db, "inc-1").await;

        let written = update_run_with(
            &db,
            ORG,
            &run_id,
            finish_update(RunState::Completed, T0 + 9 * SEC),
        )
        .await
        .unwrap();
        assert!(!written);
        let row = run(&db, &run_id).await.unwrap();
        assert_eq!(row.state, "cancelled");
        assert_eq!(row.report, None);
        assert_eq!(inc(&db, "inc-1").await, incident);
        assert_eq!(events(&db, "inc-1").await, timeline);
    }

    /// RR-11: a run that is no longer the incident's latest is refused, and its own row
    /// change rolls back with the refused summary write.
    #[tokio::test]
    async fn rr11_a_run_that_lost_the_incident_writes_nothing() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;
        alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::RcaRunId, Expr::value("other-run"))
            .filter(alert_incidents::Column::Id.eq("inc-1"))
            .exec(&db)
            .await
            .unwrap();
        let before = run(&db, &r1).await;

        let written = update_run_with(&db, ORG, &r1, finish_update(RunState::Completed, T0 + SEC))
            .await
            .unwrap();
        assert!(!written);
        assert_eq!(run(&db, &r1).await, before);
        assert_eq!(event_types(&db, "inc-1").await.len(), 1);
    }

    /// RR-4: a failing `incident_events` append rolls back the run and summary writes of
    /// both `start_run` and `update_run`.
    #[tokio::test]
    async fn rr4_a_failed_event_append_writes_nothing() {
        let db = db().await;
        incident(&db, "inc-1").await;
        incident(&db, "inc-2").await;
        let r1 = start(&db, "inc-1", T0).await;
        let run_before = run(&db, &r1).await;
        let inc1_before = inc(&db, "inc-1").await;
        let inc2_before = inc(&db, "inc-2").await;

        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();

        let finished =
            update_run_with(&db, ORG, &r1, finish_update(RunState::Completed, T0 + SEC)).await;
        assert!(finished.is_err());
        assert_eq!(run(&db, &r1).await, run_before);
        assert_eq!(inc(&db, "inc-1").await, inc1_before);

        let started = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-2"),
            guards(T0),
            Some(IncidentEvent::ai_analysis_begin()),
        )
        .await;
        assert!(started.is_err());
        assert!(runs_of(&db, "inc-2").await.is_empty());
        assert_eq!(inc(&db, "inc-2").await, inc2_before);
    }

    /// RR-41: R1 completed, R2 failed, R3 running gives R3 `previous = R1`, ended at R1's
    /// end; a first run has none and a later write never changes it.
    #[tokio::test]
    async fn rr41_previous_is_the_newest_completed_run() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;
        assert_eq!(summary_of(&inc(&db, "inc-1").await).previous, None);
        finish(&db, &r1, RunState::Completed, T0 + 60 * SEC).await;

        let r1_previous = Some(PreviousResult {
            run_id: r1.clone(),
            outcome: Some("root_cause".to_string()),
            confidence: Some("high".to_string()),
            ended_at: T0 + 60 * SEC,
        });
        let r2 = start(&db, "inc-1", T0 + 100 * SEC).await;
        assert_eq!(summary_of(&inc(&db, "inc-1").await).previous, r1_previous);
        finish(&db, &r2, RunState::Failed, T0 + 110 * SEC).await;
        assert_eq!(summary_of(&inc(&db, "inc-1").await).previous, r1_previous);

        let r3 = start(&db, "inc-1", T0 + 200 * SEC).await;
        assert_eq!(summary_of(&inc(&db, "inc-1").await).previous, r1_previous);
        let mut progress = update(None, T0 + 201 * SEC);
        progress.summary = Some(RunSummaryPatch {
            stage: Some("verify".to_string()),
            ..Default::default()
        });
        progress.steered_by_add = Some("b.lee".to_string());
        assert!(update_run_with(&db, ORG, &r3, progress).await.unwrap());
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(summary.previous, r1_previous);
        assert_eq!(summary.steered_by, vec!["b.lee".to_string()]);
    }

    /// Starts and ends one incident run per state, one second apart; returns ids oldest
    /// first.
    async fn history(
        db: &DatabaseConnection,
        incident_id: &str,
        states: &[RunState],
    ) -> Vec<String> {
        let mut ids = Vec::new();
        for (i, state) in states.iter().enumerate() {
            let at = T0 + (i as i64) * 10 * SEC;
            let run_id = start(db, incident_id, at).await;
            finish(db, &run_id, *state, at + SEC).await;
            ids.push(run_id);
        }
        ids
    }

    async fn ids_of(db: &DatabaseConnection, subject_id: &str) -> Vec<String> {
        let mut ids: Vec<String> = runs_of(db, subject_id)
            .await
            .into_iter()
            .map(|r| r.run_id)
            .collect();
        ids.sort();
        ids
    }

    async fn start_with_limit(db: &DatabaseConnection, incident_id: &str, limit: usize) -> String {
        match start_run_with(
            db,
            new_run(RunSubjectType::Incident, incident_id),
            StartGuards {
                history_limit: limit,
                ..guards(T0 + 1_000 * SEC)
            },
            None,
        )
        .await
        .unwrap()
        {
            StartResult::Started { run_id } => run_id,
            other => panic!("expected Started, got {other:?}"),
        }
    }

    /// RR-25: limit 3 keeps the newest 4 runs plus the newest completed run when it is
    /// older; limit 0 keeps the newest run and the newest completed run.
    #[tokio::test]
    async fn rr25_prune_keeps_limit_plus_one_and_the_newest_completed_run() {
        use RunState::*;
        let db = db().await;

        incident(&db, "inc-a").await;
        let old = history(
            &db,
            "inc-a",
            &[Failed, Completed, Failed, Cancelled, Failed, Failed],
        )
        .await;
        let new = start_with_limit(&db, "inc-a", 3).await;
        let mut expected = vec![
            new,
            old[1].clone(),
            old[3].clone(),
            old[4].clone(),
            old[5].clone(),
        ];
        expected.sort();
        assert_eq!(ids_of(&db, "inc-a").await, expected);

        incident(&db, "inc-b").await;
        let old = history(
            &db,
            "inc-b",
            &[Completed, Failed, Failed, Completed, Failed, Failed],
        )
        .await;
        let new = start_with_limit(&db, "inc-b", 3).await;
        let mut expected = vec![new, old[3].clone(), old[4].clone(), old[5].clone()];
        expected.sort();
        assert_eq!(ids_of(&db, "inc-b").await, expected);

        incident(&db, "inc-c").await;
        let old = history(&db, "inc-c", &[Failed, Completed, Failed, Cancelled]).await;
        let new = start_with_limit(&db, "inc-c", 0).await;
        let mut expected = vec![new, old[1].clone()];
        expected.sort();
        assert_eq!(ids_of(&db, "inc-c").await, expected);
    }

    /// RR-25 / RR-1: live runs are never pruned. Alert runs take no compare-and-set, so a
    /// subject can hold several live runs.
    #[tokio::test]
    async fn rr25_prune_never_deletes_a_live_run() {
        let db = db().await;
        let mut live = Vec::new();
        for i in 0..3 {
            let new = new_run(RunSubjectType::Alert, "alert-1");
            live.push(new.run_id.clone());
            let started = start_run_with(&db, new, guards(T0 + i * SEC), None)
                .await
                .unwrap();
            assert!(matches!(started, StartResult::Started { .. }));
        }
        let last = new_run(RunSubjectType::Alert, "alert-1");
        live.push(last.run_id.clone());
        let started = start_run_with(
            &db,
            last,
            StartGuards {
                history_limit: 0,
                ..guards(T0 + 10 * SEC)
            },
            None,
        )
        .await
        .unwrap();
        assert!(matches!(started, StartResult::Started { .. }));
        live.sort();
        assert_eq!(ids_of(&db, "alert-1").await, live);
        assert!(
            runs_of(&db, "alert-1")
                .await
                .iter()
                .all(|r| r.incident_id.is_none() && r.state == "running")
        );
    }

    /// The detail/list summary computes `stale` from `rca_updated_at` (RR-9).
    #[tokio::test]
    async fn summary_from_incident_reports_stale() {
        let db = db().await;
        incident(&db, "inc-1").await;
        assert_eq!(
            summary_from_incident(&inc(&db, "inc-1").await, T0, TIMEOUT),
            None
        );
        let r1 = start(&db, "inc-1", T0).await;
        let model = inc(&db, "inc-1").await;
        let fresh = summary_from_incident(&model, T0 + 719 * SEC, TIMEOUT).unwrap();
        assert_eq!((fresh.run_id.as_str(), fresh.stale), (r1.as_str(), false));
        assert_eq!(fresh.state, RunState::Running);
        assert!(
            summary_from_incident(&model, T0 + 721 * SEC, TIMEOUT)
                .unwrap()
                .stale
        );
    }

    /// `get_rw` reads through `get_with` on the write connection: a run written by the same
    /// connection is returned at once, scoped to its org.
    #[tokio::test]
    async fn get_rw_reads_a_run_written_on_the_same_connection() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = start(&db, "inc-1", T0).await;
        finish(&db, &r1, RunState::Completed, T0 + SEC).await;

        let read = get_with(&db, ORG, &r1)
            .await
            .unwrap()
            .expect("run is visible");
        assert_eq!(read, run(&db, &r1).await.unwrap());
        assert_eq!(read.state, "completed");
        assert!(read.report.is_some());
        assert_eq!(get_with(&db, "other-org", &r1).await.unwrap(), None);
        assert_eq!(get_with(&db, ORG, "missing").await.unwrap(), None);
    }

    /// The PostgreSQL lane (`ZO_META_POSTGRES_DSN` set) runs this against a throwaway
    /// database; the SQLite lane skips it.
    async fn throwaway_postgres() -> Option<(DatabaseConnection, String, String)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        if dsn.trim().is_empty() {
            return None;
        }
        let name = format!("rca_runs_test_{}", new_run_id().to_ascii_lowercase());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE DATABASE "{name}""#))
            .await
            .unwrap();
        admin.close().await.unwrap();
        let base = dsn.split('?').next().unwrap();
        let (server, _) = base.rsplit_once('/').unwrap();
        let mut opts = ConnectOptions::new(format!("{server}/{name}"));
        opts.max_connections(24);
        let db = Database::connect(opts).await.unwrap();
        create_tables(&db).await;
        Some((db, dsn, name))
    }

    async fn drop_postgres(db: DatabaseConnection, dsn: &str, name: &str) {
        db.close().await.unwrap();
        let admin = Database::connect(dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP DATABASE IF EXISTS "{name}""#))
            .await
            .unwrap();
    }

    /// RR-5 and RR-22 on PostgreSQL: two concurrent starts give one run, one Begin event
    /// and one `InFlight`; 20 concurrent appends leave 20 events.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn rr5_rr22_postgres_concurrent_starts_and_appends() {
        let Some((db, dsn, name)) = throwaway_postgres().await else {
            return;
        };
        let shared = std::sync::Arc::new(db);
        let db: &DatabaseConnection = &shared;
        incident(db, "inc-1").await;

        let starts: Vec<_> = (0..2)
            .map(|_| {
                let db = shared.clone();
                tokio::spawn(async move {
                    start_run_with(
                        &*db,
                        new_run(RunSubjectType::Incident, "inc-1"),
                        guards(T0),
                        Some(IncidentEvent::ai_analysis_begin()),
                    )
                    .await
                })
            })
            .collect();
        let mut results = Vec::new();
        for handle in starts {
            results.push(handle.await.unwrap().unwrap());
        }
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, StartResult::Started { .. }))
                .count(),
            1,
            "{results:?}"
        );
        assert!(results.contains(&StartResult::InFlight), "{results:?}");
        assert_eq!(runs_of(db, "inc-1").await.len(), 1);
        assert_eq!(event_types(db, "inc-1").await.len(), 1);

        incident(db, "inc-2").await;
        let appends: Vec<_> = (0..20)
            .map(|i| {
                let db = shared.clone();
                tokio::spawn(async move {
                    incident_events::append_with(
                        &*db,
                        ORG,
                        "inc-2",
                        IncidentEvent::comment(format!("u{i}"), format!("note {i}")),
                    )
                    .await
                })
            })
            .collect();
        for handle in appends {
            handle.await.unwrap().unwrap();
        }
        assert_eq!(event_types(db, "inc-2").await.len(), 20);

        let db = std::sync::Arc::try_unwrap(shared)
            .unwrap_or_else(|_| panic!("every spawned task has finished"));
        drop_postgres(db, &dsn, &name).await;
    }
}

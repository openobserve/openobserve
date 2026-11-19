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

//! Transactional run storage and incident summary updates; lock incident before run.

use std::str::FromStr;

use config::meta::{
    alerts::{
        incidents::IncidentEvent,
        rca_runs::{
            RcaRun, RcaRunItem, RcaSummary, ReportFormat, RunError, RunMode, RunState, RunStats,
            RunSubjectType, RunSummaryFields, RunTrigger, SkipReason, is_live_blocking, is_stale,
            is_v1_run_id, next_previous,
        },
        rca_steering::SteerRecord,
    },
    oncall::SubjectRef,
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
    entity::{alert_incidents, alerts, rca_runs},
    incident_events,
    rca_delivery_obligations::{self, ObligationKind, Recipient},
    rca_skipped_pages::{self, NewSkippedPage},
    rca_steering,
};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

/// `error.code` of a run that stopped writing.
pub const STALE_ERROR_CODE: &str = "stale";
/// `error.reason` of a stale run.
pub const STALE_ERROR_REASON: &str = "The analysis stopped responding";
/// `error.code` of a run whose subject became a security case while it ran (D'3, D'9).
pub const RECLASSIFIED_ERROR_CODE: &str = "security_case_reclassified";
/// `error.reason` of a reclassified run.
pub const RECLASSIFIED_ERROR_REASON: &str =
    "The incident became a security case; start a new analysis";
/// `started_by` of an automatic page; only its starts take the paging cooldown.
const PAGING_STARTED_BY: &str = "system";
/// Skipped pages a subject keeps per run of its history limit (re-review D'22).
const SKIPPED_PAGES_PER_HISTORY_RUN: usize = 4;

/// Steering users kept in the run summary, newest first.
const STEERED_BY_MAX: usize = 3;

/// A new run id: a KSUID, so ids sort by time.
pub fn new_run_id() -> String {
    svix_ksuid::Ksuid::new(None, None).to_string()
}

/// The P16 key of a firing: hex SHA-256 of its sorted subject ids; empty for no subjects.
pub fn firing_scope(subjects: &[SubjectRef]) -> String {
    use sha2::{Digest, Sha256};

    if subjects.is_empty() {
        return String::new();
    }
    let mut ids: Vec<String> = subjects.iter().map(SubjectRef::subject_id).collect();
    ids.sort();
    ids.dedup();
    hex::encode(Sha256::digest(ids.join("\n").as_bytes()))
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
    /// Serialized `Vec<SubjectRef>`: the pending on-call records of an alert run.
    pub oncall_subjects: Option<serde_json::Value>,
    pub context_used: Option<serde_json::Value>,
    /// One delivery obligation is armed per recipient when the run starts.
    pub recipients: Vec<Recipient>,
}

/// The values [start_run] decides with.
#[derive(Debug, Clone, Copy)]
pub struct StartGuards<'a> {
    pub now_us: i64,
    pub rca_timeout_secs: u64,
    /// `None` skips the cooldown (user-started runs).
    pub cooldown_us: Option<i64>,
    /// `O2_INCIDENTS_RCA_HISTORY_LIMIT`.
    pub history_limit: usize,
    /// The incident's latest run the caller decided on (a Resume); any other start since wins.
    pub latest_run_id: Option<&'a str>,
    /// An automatic start: a refusal records one skipped page per recipient, in its transaction.
    pub records_skips: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartResult {
    Started {
        run_id: String,
        replaced_stale: Option<RunTrigger>,
        /// The id of that stale run, so the caller closes its steering rows.
        replaced_run_id: Option<String>,
    },
    /// The latest run is live and not stale, or a concurrent start won; ids come from the guard.
    InFlight { covering_run_id: String },
    /// A recent run is within the cooldown.
    CoolingDown {
        covering_run_id: String,
        retry_after_us: i64,
    },
}

/// What the alert-subject guard decided inside the start transaction.
enum AlertAdmission {
    Admit {
        replaced_stale: Option<RunTrigger>,
        replaced_run_id: Option<String>,
    },
    Refuse(StartResult),
}

/// One [update_run] write. `state: None` is a progress write.
#[derive(Debug, Clone, Default)]
pub struct RunUpdate {
    pub state: Option<RunState>,
    /// Additional source-state precondition, intersected with the legal transition.
    pub expected_state: Option<RunState>,
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
    /// Current stage of the seven-stage protocol; mirrored into `rca_summary.stage`.
    pub stage: Option<String>,
    /// 1-based stage index; mirrored into `rca_summary.stage_index`.
    pub stage_index: Option<i16>,
    /// `{past_causes: [{id, summary}], skills: [name], toolsets: [name]}`.
    pub context_used: Option<serde_json::Value>,
    /// Adds one to `continuations` in SQL.
    pub continuations_inc: bool,
    /// Final stats cannot change lifecycle state; partial result is filled only if absent.
    pub final_stats_only: bool,
    /// Appended to the incident's timeline in the same transaction (incident subjects).
    pub event: Option<IncidentEvent>,
    /// Answer deadline of a `waiting_input` run; `Some(None)` clears it.
    pub input_deadline_at: Option<Option<i64>>,
    /// The open question; `Some(None)` clears it.
    pub pending_question_id: Option<Option<String>>,
    /// Adds one to `questions_asked` in SQL.
    pub questions_asked_inc: bool,
    /// When the answer deadline closed; the write loses once it closed.
    pub deadline_closed_at: Option<i64>,
    /// D'9: a completing run that read history ends `failed` if its subject is now a case.
    pub withhold_if_case: bool,
    pub now_us: i64,
    /// The incident's status episode the write belongs to; it loses once the incident left it.
    pub episode: Option<crate::table::alert_incidents::Episode>,
}

/// Changes to the incident's `rca_summary`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunSummaryPatch {
    pub steps: Option<u32>,
    pub tool_calls: Option<u32>,
    pub reusable_steps: Option<u32>,
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
    rca_summary: Option<String>,
}

/// `SELECT ... FOR UPDATE`, except on SQLite, which serializes writers and has no row lock.
pub(crate) fn locked<E: EntityTrait>(txn: &DatabaseTransaction, query: Select<E>) -> Select<E> {
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Sqlite {
        query
    } else {
        query.lock(LockType::Update)
    }
}

/// JSON columns are stored as text; an unreadable value reads as `None`.
pub fn decode<T: serde::de::DeserializeOwned>(raw: Option<&str>) -> Option<T> {
    raw.and_then(|v| serde_json::from_str(v).ok())
}

fn decode_summary(raw: Option<&str>) -> RunSummaryFields {
    decode(raw).unwrap_or_default()
}

fn encode<T: serde::Serialize>(value: &T, what: &str) -> Result<String, DbErr> {
    serde_json::to_string(value).map_err(|e| DbErr::Custom(format!("serialize {what}: {e}")))
}

fn encode_opt<T: serde::Serialize>(value: Option<&T>, what: &str) -> Result<Option<String>, DbErr> {
    value.map(|v| encode(v, what)).transpose()
}

/// Atomically admit one run per incident and append its Begin event before pruning history.
pub async fn start_run(
    new: NewRun,
    guards: StartGuards<'_>,
    begin_event: Option<IncidentEvent>,
    guidance_row: Option<SteerRecord>,
) -> Result<StartResult, DbErr> {
    start_run_with(
        get_orm_client_rw().await,
        new,
        guards,
        begin_event,
        guidance_row,
    )
    .await
}

/// [start_run] on a given connection.
pub async fn start_run_with<C: TransactionTrait>(
    db: &C,
    new: NewRun,
    guards: StartGuards<'_>,
    begin_event: Option<IncidentEvent>,
    guidance_row: Option<SteerRecord>,
) -> Result<StartResult, DbErr> {
    let txn = db.begin().await?;
    let now = guards.now_us;

    let mut replaced_stale = None;
    let mut replaced_run_id = None;
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
        let seen_run_id = seen.rca_run_id.clone().unwrap_or_default();
        // A start since the caller's decision is the concurrent start that won.
        if guards
            .latest_run_id
            .is_some_and(|latest| seen.rca_run_id.as_deref() != Some(latest))
        {
            let refusal = StartResult::InFlight {
                covering_run_id: seen_run_id,
            };
            return refuse(txn, &new, &guards, refusal).await;
        }
        if seen_state.is_some_and(|state| {
            is_live_blocking(state, seen_updated_at, now, guards.rca_timeout_secs)
        }) {
            let refusal = StartResult::InFlight {
                covering_run_id: seen_run_id,
            };
            return refuse(txn, &new, &guards, refusal).await;
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
            if let Some(run) = newest
                && let Some(ended_at) = run.ended_at
                && now.saturating_sub(ended_at) < cooldown
            {
                let refusal = StartResult::CoolingDown {
                    covering_run_id: run.run_id,
                    retry_after_us: ended_at.saturating_add(cooldown),
                };
                return refuse(txn, &new, &guards, refusal).await;
            }
        }

        let seen_summary = seen.rca_summary.as_deref().map(|v| decode_summary(Some(v)));
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
            return Ok(StartResult::InFlight {
                covering_run_id: seen.rca_run_id.unwrap_or_default(),
            });
        }

        // The replaced run stopped writing; end it in this transaction.
        if let Some(seen_run_id) = seen.rca_run_id.as_deref()
            && seen_state
                .is_some_and(|state| is_stale(state, seen_updated_at, now, guards.rca_timeout_secs))
        {
            replaced_stale = fail_stale_with(&txn, &new.org_id, seen_run_id, now).await?;
            replaced_run_id = replaced_stale.is_some().then(|| seen_run_id.to_string());
        }
    } else {
        match guard_alert(&txn, &new, &guards).await? {
            AlertAdmission::Admit {
                replaced_stale: stale,
                replaced_run_id: stale_id,
            } => {
                replaced_stale = stale;
                replaced_run_id = stale_id;
            }
            AlertAdmission::Refuse(refusal) => return refuse(txn, &new, &guards, refusal).await,
        }
    }

    let run_number = next_run_number(&txn, &new.org_id, new.subject_type, &new.subject_id).await?;
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
        stage: Set(None),
        stage_index: Set(None),
        context_used: Set(encode_opt(new.context_used.as_ref(), "context_used")?),
        continuations: Set(0),
        oncall_subjects: Set(encode_opt(new.oncall_subjects.as_ref(), "oncall_subjects")?),
        input_deadline_at: Set(None),
        pending_question_id: Set(None),
        questions_asked: Set(0),
        deadline_closed_at: Set(None),
        run_number: Set(Some(run_number)),
        fenced: Set(false),
    }
    .insert(&txn)
    .await?;
    rca_delivery_obligations::arm_in(&txn, &new.org_id, &new.run_id, &new.recipients, now).await?;

    if let Some(row) = guidance_row.as_ref() {
        rca_steering::insert_in(&txn, row).await?;
    }

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
    Ok(StartResult::Started {
        run_id: new.run_id,
        replaced_stale,
        replaced_run_id,
    })
}

/// Ends a `running` run as `failed`/`stale`.
async fn fail_stale_with(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_id: &str,
    now: i64,
) -> Result<Option<RunTrigger>, DbErr> {
    let Some(run) = locked(
        txn,
        rca_runs::Entity::find_by_id(run_id).filter(rca_runs::Column::OrgId.eq(org_id)),
    )
    .one(txn)
    .await?
    else {
        return Ok(None);
    };
    let error = RunError {
        code: STALE_ERROR_CODE.to_string(),
        reason: STALE_ERROR_REASON.to_string(),
        details: None,
        trigger_type: None,
    };
    let stats = merge_stats(
        run.stats.as_deref(),
        None,
        Some(duration_ms(run.started_at, now)),
    );
    let ended = rca_runs::Entity::update_many()
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
    if ended.rows_affected == 0 {
        return Ok(None);
    }
    rca_delivery_obligations::settle_in(txn, org_id, run_id, ObligationKind::NoVerdict, now)
        .await?;
    Ok(Some(parse_or(
        &run.trigger,
        RunTrigger::Legacy,
        &run.run_id,
        "trigger",
    )))
}

/// A refused start: its skipped pages commit with the refusal, else nothing is written.
async fn refuse(
    txn: DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
    refusal: StartResult,
) -> Result<StartResult, DbErr> {
    let pages = skipped_pages(&txn, new, guards, &refusal).await?;
    if pages.is_empty() {
        txn.rollback().await?;
        return Ok(refusal);
    }
    rca_skipped_pages::insert_in(&txn, &pages).await?;
    // `prune_with` runs only on a start, so sustained refusals keep the cap here.
    rca_skipped_pages::retain_newest_in(
        &txn,
        &new.org_id,
        new.subject_type,
        &new.subject_id,
        skipped_page_cap(guards.history_limit),
    )
    .await?;
    txn.commit().await?;
    Ok(refusal)
}

/// One skipped page per recipient of an automatic start; none for manual, Slack or resume.
async fn skipped_pages(
    txn: &DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
    refusal: &StartResult,
) -> Result<Vec<NewSkippedPage>, DbErr> {
    let (reason, covering_run_id, retry_after_us) = match refusal {
        StartResult::InFlight { covering_run_id } => (SkipReason::InFlight, covering_run_id, None),
        StartResult::CoolingDown {
            covering_run_id,
            retry_after_us,
        } => (
            SkipReason::CoolingDown,
            covering_run_id,
            Some(*retry_after_us),
        ),
        StartResult::Started { .. } => return Ok(Vec::new()),
    };
    if !guards.records_skips || new.recipients.is_empty() || covering_run_id.is_empty() {
        return Ok(Vec::new());
    }
    let covering_run_number = run_number_of(txn, &new.org_id, covering_run_id).await?;
    let firing_key = match new.subject_type {
        RunSubjectType::Alert => firing_scope_of(&new.recipients),
        RunSubjectType::Incident => new.trigger.as_str().to_string(),
    };
    Ok(new
        .recipients
        .iter()
        .map(|recipient| NewSkippedPage {
            org_id: new.org_id.clone(),
            subject_type: new.subject_type,
            subject_id: new.subject_id.clone(),
            incident_id: new.incident_id.clone(),
            response_id: Some(recipient.response_id.clone()),
            firing_key: firing_key.clone(),
            reason,
            covering_run_id: covering_run_id.clone(),
            covering_run_number,
            retry_after_us,
            cooldown_us: guards.cooldown_us,
            at_us: guards.now_us,
        })
        .collect())
}

fn skipped_page_cap(history_limit: usize) -> usize {
    history_limit
        .max(1)
        .saturating_mul(SKIPPED_PAGES_PER_HISTORY_RUN)
}

/// P16 for an alert subject, keyed `(org, alert, firing scope)` and serialized on the alert row.
async fn guard_alert(
    txn: &DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
) -> Result<AlertAdmission, DbErr> {
    let paging = new.trigger == RunTrigger::OncallPage && new.started_by == PAGING_STARTED_BY;
    if !lock_alert(txn, &new.org_id, &new.subject_id).await? && paging {
        // A firing id is not lockable, so an unknown alert would admit concurrent runs.
        return Err(DbErr::RecordNotFound(format!(
            "alert {}/{}",
            new.org_id, new.subject_id
        )));
    }
    let scope = firing_scope_of(&new.recipients);
    let runs = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(new.org_id.as_str()))
        .filter(rca_runs::Column::SubjectType.eq(RunSubjectType::Alert.as_str()))
        .filter(rca_runs::Column::SubjectId.eq(new.subject_id.as_str()))
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .all(txn)
        .await?;

    let now = guards.now_us;
    let mut replaced_stale = None;
    let mut replaced_run_id = None;
    let mut stale_ended = Vec::new();
    for run in &runs {
        let state = state_of(run);
        if !state.is_live() {
            continue;
        }
        if is_stale(state, run.updated_at, now, guards.rca_timeout_secs) {
            if let Some(trigger) = fail_stale_with(txn, &new.org_id, &run.run_id, now).await? {
                replaced_stale = Some(trigger);
                replaced_run_id = Some(run.run_id.clone());
            }
            stale_ended.push(run.run_id.as_str());
            continue;
        }
        // A start without a scope (human, Slack) and a run without one cover the whole alert.
        let run_scope = firing_scope(&owned_subjects_of(run));
        if scope.is_empty() || run_scope.is_empty() || run_scope == scope {
            return Ok(AlertAdmission::Refuse(StartResult::InFlight {
                covering_run_id: run.run_id.clone(),
            }));
        }
    }

    if let Some(cooldown) = guards.cooldown_us.filter(|_| paging && !scope.is_empty()) {
        let newest = runs.iter().find(|run| {
            run.trigger == RunTrigger::OncallPage.as_str()
                && firing_scope(&owned_subjects_of(run)) == scope
        });
        if let Some(run) = newest {
            // A run this start just ended stale stopped at its last write, not now.
            let ended_at = if stale_ended.contains(&run.run_id.as_str()) {
                run.updated_at
            } else {
                run.ended_at.unwrap_or(run.started_at)
            };
            if now.saturating_sub(ended_at) < cooldown {
                return Ok(AlertAdmission::Refuse(StartResult::CoolingDown {
                    covering_run_id: run.run_id.clone(),
                    retry_after_us: ended_at.saturating_add(cooldown),
                }));
            }
        }
    }
    Ok(AlertAdmission::Admit {
        replaced_stale,
        replaced_run_id,
    })
}

/// Row lock on the source alert; SQLite takes its writer lock with a no-op write instead.
async fn lock_alert(
    txn: &DatabaseTransaction,
    org_id: &str,
    alert_id: &str,
) -> Result<bool, DbErr> {
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Sqlite {
        let touched = alerts::Entity::update_many()
            .col_expr(alerts::Column::Org, Expr::col(alerts::Column::Org).into())
            .filter(alerts::Column::Id.eq(alert_id))
            .filter(alerts::Column::Org.eq(org_id))
            .exec(txn)
            .await?;
        return Ok(touched.rows_affected > 0);
    }
    let found = alerts::Entity::find_by_id(alert_id)
        .filter(alerts::Column::Org.eq(org_id))
        .select_only()
        .column(alerts::Column::Id)
        .lock(LockType::Update)
        .into_tuple::<String>()
        .one(txn)
        .await?;
    Ok(found.is_some())
}

/// `max + 1` of the subject's numbered runs, read under the start's lock.
async fn next_run_number(
    txn: &DatabaseTransaction,
    org_id: &str,
    subject_type: RunSubjectType,
    subject_id: &str,
) -> Result<i32, DbErr> {
    let max = rca_runs::Entity::find()
        .select_only()
        .column_as(rca_runs::Column::RunNumber.max(), "max_run_number")
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::SubjectType.eq(subject_type.as_str()))
        .filter(rca_runs::Column::SubjectId.eq(subject_id))
        .into_tuple::<Option<i32>>()
        .one(txn)
        .await?
        .flatten();
    Ok(max.unwrap_or(0).saturating_add(1))
}

async fn run_number_of(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_id: &str,
) -> Result<Option<u32>, DbErr> {
    let number = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .select_only()
        .column(rca_runs::Column::RunNumber)
        .into_tuple::<Option<i32>>()
        .one(txn)
        .await?
        .flatten();
    Ok(number.and_then(|n| u32::try_from(n).ok()))
}

fn firing_scope_of(recipients: &[Recipient]) -> String {
    let subjects: Vec<SubjectRef> = recipients.iter().map(|r| r.subject.clone()).collect();
    firing_scope(&subjects)
}

/// The `oncall_subjects` a row stored; a row without them owns none.
fn owned_subjects_of(run: &Model) -> Vec<SubjectRef> {
    decode(run.oncall_subjects.as_deref()).unwrap_or_default()
}

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
    rca_skipped_pages::retain_newest_in(
        txn,
        org_id,
        subject_type,
        subject_id,
        skipped_page_cap(history_limit),
    )
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
    // A pruned run's steering rows and settled deliveries go with it.
    rca_steering::delete_for_runs_in(txn, org_id, &doomed).await?;
    rca_delivery_obligations::delete_for_runs_in(txn, org_id, &doomed).await?;
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

/// The states a run may move from to reach `target`.
fn allowed_from(target: Option<RunState>) -> &'static [RunState] {
    match target {
        None | Some(RunState::Completed) | Some(RunState::Failed) => &[RunState::Running],
        Some(RunState::WaitingInput) | Some(RunState::Running) => &[RunState::Running],
        Some(RunState::Cancelled) => &[RunState::Running, RunState::WaitingInput],
    }
}

fn duration_ms(started_at_us: i64, ended_at_us: i64) -> u64 {
    u64::try_from(ended_at_us.saturating_sub(started_at_us) / 1000).unwrap_or(0)
}

/// Stored stats with every field of `patch` that is set, then `duration_ms` when given.
fn merge_stats(
    stored: Option<&str>,
    patch: Option<&RunStats>,
    duration_ms: Option<u64>,
) -> RunStats {
    let mut stats: RunStats = decode(stored).unwrap_or_default();
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
        if p.ignored_acks.is_some() {
            stats.ignored_acks = p.ignored_acks;
        }
    }
    if duration_ms.is_some() {
        stats.duration_ms = duration_ms;
    }
    stats
}

fn run_stage(upd: &RunUpdate) -> (Option<String>, Option<i16>) {
    (upd.stage.clone(), upd.stage_index)
}

fn merge_summary(mut summary: RunSummaryFields, upd: &RunUpdate) -> RunSummaryFields {
    if let Some(user) = upd.cancelled_by.as_ref() {
        summary.cancelled_by = Some(user.clone());
    }
    if let Some(error) = upd.error.as_ref() {
        summary.detail = Some(error.reason.clone());
    }
    // The run's stage columns and the summary carry the same stage.
    let (stage, stage_index) = run_stage(upd);
    if stage.is_some() {
        summary.stage = stage;
    }
    if let Some(index) = stage_index.and_then(|i| u8::try_from(i).ok()) {
        summary.stage_index = Some(index);
    }
    if let Some(p) = upd.summary.as_ref() {
        if let Some(steps) = p.steps {
            summary.steps = steps;
        }
        if let Some(tool_calls) = p.tool_calls {
            summary.tool_calls = tool_calls;
        }
        if p.reusable_steps.is_some() {
            summary.reusable_steps = p.reusable_steps;
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
        add_steered_by(&mut summary, user);
    }
    summary
}

fn add_steered_by(summary: &mut RunSummaryFields, user: &str) {
    summary.steered_by.retain(|u| u != user);
    summary.steered_by.insert(0, user.to_string());
    summary.steered_by.truncate(STEERED_BY_MAX);
}

pub async fn update_run(org_id: &str, run_id: &str, upd: RunUpdate) -> Result<bool, DbErr> {
    update_run_with(get_orm_client_rw().await, org_id, run_id, upd).await
}

/// Lock incident before run; recheck state guards inside the transaction.
pub async fn update_run_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<bool, DbErr> {
    if upd.final_stats_only {
        return final_stats_with(db, org_id, run_id, &upd).await;
    }
    let txn = db.begin().await?;
    let (upd, withheld) = withhold_if_reclassified(&txn, org_id, run_id, upd).await?;
    let now = upd.now_us;
    let from: Vec<_> = allowed_from(upd.state)
        .iter()
        .copied()
        .filter(|state| upd.expected_state.is_none_or(|expected| expected == *state))
        .collect();
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
        let named = alert_incidents::Entity::find_by_id(subject_id.as_str())
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::RcaRunId.eq(run_id));
        let held = match upd.episode.as_ref() {
            Some(episode) => episode.held(named),
            None => named,
        };
        let Some(stored) = locked(
            &txn,
            held.select_only()
                .column(alert_incidents::Column::RcaSummary),
        )
        .into_tuple::<Option<String>>()
        .one(&txn)
        .await?
        else {
            txn.rollback().await?;
            return Ok(false);
        };
        Some((
            subject_id,
            merge_summary(decode_summary(stored.as_deref()), &upd),
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
    .into_tuple::<(String, i64, Option<String>)>()
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
        let stats = merge_stats(stored_stats.as_deref(), upd.stats.as_ref(), duration);
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
        update = update.col_expr(
            rca_runs::Column::Result,
            Expr::value(encode(result, "result")?),
        );
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
    let (stage, stage_index) = run_stage(&upd);
    if let Some(stage) = stage {
        update = update.col_expr(rca_runs::Column::Stage, Expr::value(stage));
    }
    if let Some(stage_index) = stage_index {
        update = update.col_expr(rca_runs::Column::StageIndex, Expr::value(stage_index));
    }
    if let Some(context_used) = upd.context_used.as_ref() {
        update = update.col_expr(
            rca_runs::Column::ContextUsed,
            Expr::value(encode(context_used, "context_used")?),
        );
    }
    // A withheld run keeps no report or record, including one an earlier write stored.
    if withheld {
        for column in [
            rca_runs::Column::Report,
            rca_runs::Column::Result,
            rca_runs::Column::Outcome,
            rca_runs::Column::Confidence,
        ] {
            update = update.col_expr(column, Expr::value(Option::<String>::None));
        }
    }
    if upd.continuations_inc {
        update = update.col_expr(
            rca_runs::Column::Continuations,
            Expr::col(rca_runs::Column::Continuations).add(1),
        );
    }
    if let Some(deadline) = upd.input_deadline_at {
        update = update.col_expr(rca_runs::Column::InputDeadlineAt, Expr::value(deadline));
    }
    if let Some(question_id) = upd.pending_question_id.as_ref() {
        update = update.col_expr(
            rca_runs::Column::PendingQuestionId,
            Expr::value(question_id.clone()),
        );
    }
    if upd.questions_asked_inc {
        update = update.col_expr(
            rca_runs::Column::QuestionsAsked,
            Expr::col(rca_runs::Column::QuestionsAsked).add(1),
        );
    }
    if let Some(closed_at) = upd.deadline_closed_at {
        update = update
            .col_expr(rca_runs::Column::DeadlineClosedAt, Expr::value(closed_at))
            .filter(rca_runs::Column::DeadlineClosedAt.is_null());
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

    // D'2: the deliveries this run owes become due in the transaction that ends it.
    if let Some(state) = upd.state.filter(|s| s.is_terminal()) {
        let kind = if state == RunState::Completed {
            ObligationKind::Verdict
        } else {
            ObligationKind::NoVerdict
        };
        rca_delivery_obligations::settle_in(&txn, org_id, run_id, kind, now).await?;
    }

    txn.commit().await?;
    Ok(true)
}

/// D'9: a completing run that read history, whose subject is fenced or now a case (or can no
/// longer be classified), ends `failed` with no report and owes only a release.
async fn withhold_if_reclassified(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<(RunUpdate, bool), DbErr> {
    if upd.state != Some(RunState::Completed) || !upd.withhold_if_case {
        return Ok((upd, false));
    }
    let Some((fenced, incident_id)) = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .select_only()
        .columns([rca_runs::Column::Fenced, rca_runs::Column::IncidentId])
        .into_tuple::<(bool, Option<String>)>()
        .one(txn)
        .await?
    else {
        return Ok((upd, false));
    };
    let case = match incident_id.as_deref() {
        Some(incident_id) => alert_incidents::Entity::find_by_id(incident_id)
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .select_only()
            .column(alert_incidents::Column::SecurityCase)
            .into_tuple::<bool>()
            .one(txn)
            .await?
            .unwrap_or(true),
        None => false,
    };
    if !fenced && !case {
        return Ok((upd, false));
    }
    log::warn!("[RCA_RUNS] run {run_id} of {org_id} read history and its subject is now a case");
    let withheld = RunUpdate {
        state: Some(RunState::Failed),
        report: None,
        outcome: None,
        confidence: None,
        result: None,
        error: Some(RunError {
            code: RECLASSIFIED_ERROR_CODE.to_string(),
            reason: RECLASSIFIED_ERROR_REASON.to_string(),
            details: None,
            trigger_type: None,
        }),
        event: None,
        ..upd
    };
    Ok((withheld, true))
}

/// Stats-only writes preserve terminal state and never overwrite a stored result.
async fn final_stats_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: &RunUpdate,
) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    let Some((subject_type, subject_id)) = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .select_only()
        .columns([rca_runs::Column::SubjectType, rca_runs::Column::SubjectId])
        .into_tuple::<(String, String)>()
        .one(&txn)
        .await?
    else {
        txn.rollback().await?;
        return Ok(false);
    };

    if subject_type == RunSubjectType::Incident.as_str()
        && let Some(stored) = locked(
            &txn,
            alert_incidents::Entity::find_by_id(subject_id.as_str())
                .filter(alert_incidents::Column::OrgId.eq(org_id))
                .filter(alert_incidents::Column::RcaRunId.eq(run_id))
                .select_only()
                .column(alert_incidents::Column::RcaSummary),
        )
        .into_tuple::<Option<String>>()
        .one(&txn)
        .await?
    {
        let mut summary = decode_summary(stored.as_deref());
        if let Some(p) = upd.summary.as_ref() {
            if let Some(steps) = p.steps {
                summary.steps = steps;
            }
            if let Some(tool_calls) = p.tool_calls {
                summary.tool_calls = tool_calls;
            }
            if p.reusable_steps.is_some() {
                summary.reusable_steps = p.reusable_steps;
            }
            if p.unblocked_by.is_some() {
                summary.unblocked_by = p.unblocked_by.clone();
            }
        }
        if let Some(user) = upd.steered_by_add.as_ref() {
            add_steered_by(&mut summary, user);
        }
        alert_incidents::Entity::update_many()
            .col_expr(
                alert_incidents::Column::RcaSummary,
                Expr::value(encode(&summary, "rca_summary")?),
            )
            .filter(alert_incidents::Column::Id.eq(subject_id.as_str()))
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::RcaRunId.eq(run_id))
            .exec(&txn)
            .await?;
    }

    let Some((stored_stats, stored_result, state)) = locked(
        &txn,
        rca_runs::Entity::find_by_id(run_id)
            .filter(rca_runs::Column::OrgId.eq(org_id))
            .select_only()
            .columns([
                rca_runs::Column::Stats,
                rca_runs::Column::Result,
                rca_runs::Column::State,
            ]),
    )
    .into_tuple::<(Option<String>, Option<String>, String)>()
    .one(&txn)
    .await?
    else {
        txn.rollback().await?;
        return Ok(false);
    };
    let stats = merge_stats(stored_stats.as_deref(), upd.stats.as_ref(), None);
    let mut update = rca_runs::Entity::update_many()
        .col_expr(
            rca_runs::Column::Stats,
            Expr::value(encode(&stats, "stats")?),
        )
        .col_expr(rca_runs::Column::UpdatedAt, Expr::value(upd.now_us));
    if stored_result.is_none()
        && state != RunState::Completed.as_str()
        && let Some(result) = upd.result.as_ref()
    {
        update = update.col_expr(
            rca_runs::Column::Result,
            Expr::value(encode(result, "result")?),
        );
    }
    update
        .filter(rca_runs::Column::RunId.eq(run_id))
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
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

/// The newest `completed` run whose `incident_id` is the incident.
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

/// The newest completed run on the alert itself, whatever started it; read on the primary.
pub async fn newest_completed_for_alert(
    org_id: &str,
    alert_id: &str,
) -> Result<Option<Model>, DbErr> {
    newest_completed_with(
        get_orm_client_rw().await,
        org_id,
        Condition::all()
            .add(rca_runs::Column::SubjectType.eq(RunSubjectType::Alert.as_str()))
            .add(rca_runs::Column::SubjectId.eq(alert_id)),
    )
    .await
}

/// `started_at` of the incident's oldest run; pre-run reports are older than it.
pub async fn first_started_at_for_incident(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<i64>, DbErr> {
    rca_runs::Entity::find()
        .select_only()
        .column(rca_runs::Column::StartedAt)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::IncidentId.eq(incident_id))
        .order_by_asc(rca_runs::Column::StartedAt)
        .into_tuple::<i64>()
        .one(get_orm_client_ro().await)
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

pub async fn list_completed_between(
    org_id: &str,
    from_us: i64,
    to_us: i64,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::State.eq(RunState::Completed.as_str()))
        .filter(rca_runs::Column::EndedAt.gte(from_us))
        .filter(rca_runs::Column::EndedAt.lt(to_us))
        .filter(rca_runs::Column::Result.is_not_null())
        .order_by_desc(rca_runs::Column::EndedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .limit(limit.max(1))
        .all(get_orm_client_ro().await)
        .await
}

/// `running` runs, least recently written first, `limit` at most.
pub async fn list_running(limit: u64) -> Result<Vec<Model>, DbErr> {
    rca_runs::Entity::find()
        .filter(rca_runs::Column::State.eq(RunState::Running.as_str()))
        .order_by_asc(rca_runs::Column::UpdatedAt)
        .limit(limit)
        .all(get_orm_client_rw().await)
        .await
}

/// Live rows (`running`, `waiting_input`) on an alert or its incident; staleness is the caller's.
pub async fn list_live_for_alert(
    org_id: &str,
    alert_id: &str,
    incident_id: Option<&str>,
) -> Result<Vec<Model>, DbErr> {
    let mut subject = Condition::any().add(rca_runs::Column::SubjectId.eq(alert_id));
    if let Some(incident_id) = incident_id {
        subject = subject.add(rca_runs::Column::IncidentId.eq(incident_id));
    }
    rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(subject)
        .filter(
            rca_runs::Column::State
                .is_in([RunState::Running.as_str(), RunState::WaitingInput.as_str()]),
        )
        .all(get_orm_client_rw().await)
        .await
}

/// The subjects a run owns: its `oncall_subjects` and the records its deliveries owe (D'2).
pub async fn owned_subjects(org_id: &str, run_id: &str) -> Result<Vec<SubjectRef>, DbErr> {
    let mut owned = match get_rw(org_id, run_id).await? {
        Some(run) => owned_subjects_of(&run),
        None => Vec::new(),
    };
    for obligation in rca_delivery_obligations::for_run(org_id, run_id).await? {
        if !owned.contains(&obligation.subject) {
            owned.push(obligation.subject);
        }
    }
    Ok(owned)
}

/// The one live run bound to an assistant session; `None` for zero, several or another org's.
pub async fn live_run_for_session(org_id: &str, session_id: &str) -> Result<Option<Model>, DbErr> {
    let mut runs = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::SessionId.eq(session_id))
        .filter(
            rca_runs::Column::State
                .is_in([RunState::Running.as_str(), RunState::WaitingInput.as_str()]),
        )
        .limit(2)
        .all(get_orm_client_rw().await)
        .await?;
    if runs.len() != 1 {
        return Ok(None);
    }
    Ok(runs.pop())
}

pub async fn list_waiting_past_deadline(now_us: i64, limit: u64) -> Result<Vec<Model>, DbErr> {
    list_waiting_past_deadline_with(get_orm_client_rw().await, now_us, limit).await
}

/// [list_waiting_past_deadline] on a given connection.
pub async fn list_waiting_past_deadline_with<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    rca_runs::Entity::find()
        .filter(rca_runs::Column::State.eq(RunState::WaitingInput.as_str()))
        .filter(rca_runs::Column::InputDeadlineAt.lt(now_us))
        .filter(rca_runs::Column::DeadlineClosedAt.is_null())
        .order_by_asc(rca_runs::Column::InputDeadlineAt)
        .limit(limit)
        .all(conn)
        .await
}

/// A steering message reopens a `waiting_input` run whose deadline is still open.
pub async fn resume_waiting(org_id: &str, run_id: &str) -> Result<bool, DbErr> {
    reopen_waiting_with(
        get_orm_client_rw().await,
        org_id,
        run_id,
        Reopen::Answer,
        config::utils::time::now_micros(),
    )
    .await
}

/// The sweeper closes the answer deadline the run was listed with.
pub async fn close_deadline(
    org_id: &str,
    run_id: &str,
    input_deadline_at: i64,
) -> Result<bool, DbErr> {
    reopen_waiting_with(
        get_orm_client_rw().await,
        org_id,
        run_id,
        Reopen::Deadline(input_deadline_at),
        config::utils::time::now_micros(),
    )
    .await
}

/// What moves a `waiting_input` run back to `running`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reopen {
    /// A responder's message ([resume_waiting]).
    Answer,
    /// The sweeper, for the deadline the run was listed with ([close_deadline]).
    Deadline(i64),
}

/// [resume_waiting] and [close_deadline] on a given connection.
pub async fn reopen_waiting_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    reopen: Reopen,
    now_us: i64,
) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    let Some((subject_type, subject_id)) = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .select_only()
        .columns([rca_runs::Column::SubjectType, rca_runs::Column::SubjectId])
        .into_tuple::<(String, String)>()
        .one(&txn)
        .await?
    else {
        txn.rollback().await?;
        return Ok(false);
    };

    // Lock order as in every other write: the incident row before the run row.
    let incident_summary = if subject_type == RunSubjectType::Incident.as_str() {
        locked(
            &txn,
            alert_incidents::Entity::find_by_id(subject_id.as_str())
                .filter(alert_incidents::Column::OrgId.eq(org_id))
                .filter(alert_incidents::Column::RcaRunId.eq(run_id))
                .select_only()
                .column(alert_incidents::Column::RcaSummary),
        )
        .into_tuple::<Option<String>>()
        .one(&txn)
        .await?
    } else {
        None
    };

    let mut cas = rca_runs::Entity::update_many()
        .col_expr(
            rca_runs::Column::State,
            Expr::value(RunState::Running.as_str()),
        )
        .col_expr(
            rca_runs::Column::InputDeadlineAt,
            Expr::value(Option::<i64>::None),
        )
        .col_expr(
            rca_runs::Column::PendingQuestionId,
            Expr::value(Option::<String>::None),
        )
        .col_expr(rca_runs::Column::UpdatedAt, Expr::value(now_us))
        .filter(rca_runs::Column::RunId.eq(run_id))
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::State.eq(RunState::WaitingInput.as_str()))
        .filter(rca_runs::Column::DeadlineClosedAt.is_null());
    if let Reopen::Deadline(deadline) = reopen {
        cas = cas
            .col_expr(rca_runs::Column::DeadlineClosedAt, Expr::value(now_us))
            .filter(rca_runs::Column::InputDeadlineAt.eq(deadline));
    }
    if cas.exec(&txn).await?.rows_affected == 0 {
        txn.rollback().await?;
        return Ok(false);
    }

    if let Some(stored) = incident_summary {
        let mut summary = decode_summary(stored.as_deref());
        summary.deadline_at = None;
        summary.detail = None;
        alert_incidents::Entity::update_many()
            .col_expr(
                alert_incidents::Column::RcaState,
                Expr::value(RunState::Running.as_str()),
            )
            .col_expr(alert_incidents::Column::RcaUpdatedAt, Expr::value(now_us))
            .col_expr(
                alert_incidents::Column::RcaSummary,
                Expr::value(encode(&summary, "rca_summary")?),
            )
            .filter(alert_incidents::Column::Id.eq(subject_id.as_str()))
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::RcaRunId.eq(run_id))
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(true)
}

/// Deletes every run of the org, with its skipped pages and delivery obligations.
pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    rca_skipped_pages::delete_by_org(org_id).await?;
    rca_delivery_obligations::delete_by_org(org_id).await?;
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

pub fn error_of(m: &Model) -> Option<RunError> {
    decode(m.error.as_deref())
}

/// The API form of a run.
pub fn to_run(m: Model) -> RcaRun {
    let state = state_of(&m);
    let error = error_of(&m);
    let stats = decode(m.stats.as_deref());
    RcaRun {
        report_format: ReportFormat::V2,
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
        result: decode(m.result.as_deref()),
        session_id: m.session_id,
        stage: m.stage,
        stage_index: m.stage_index,
        context_used: decode(m.context_used.as_deref()),
        continuations: m.continuations,
        oncall_subjects: decode(m.oncall_subjects.as_deref()),
        input_deadline_at: m.input_deadline_at,
        pending_question_id: m.pending_question_id,
        questions_asked: m.questions_asked,
        deadline_closed_at: m.deadline_closed_at,
    }
}

/// The history-list form of a run.
pub fn to_item(m: &Model) -> RcaRunItem {
    RcaRunItem {
        run_id: m.run_id.clone(),
        report_format: ReportFormat::V2,
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
        has_record: m.result.is_some(),
        serving_region: decode::<serde_json::Value>(m.context_used.as_deref()).and_then(|used| {
            used.get("serving_region")
                .and_then(serde_json::Value::as_str)
                .filter(|region| !region.is_empty())
                .map(str::to_string)
        }),
        run_number: m.run_number.and_then(|n| u32::try_from(n).ok()),
    }
}

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
    let report_format = if is_v1_run_id(&run_id) {
        ReportFormat::V1
    } else {
        ReportFormat::V2
    };
    Some(RcaSummary {
        run_id,
        report_format,
        state,
        stale: is_stale(state, updated_at, now_us, rca_timeout_secs),
        started_at,
        updated_at,
        outcome: inc.rca_outcome.clone(),
        confidence: inc.rca_confidence.clone(),
        summary: decode_summary(inc.rca_summary.as_deref()),
        detail: None,
    })
}

/// Runs the v1 run-pointer backfill migration over the current rows; for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub async fn backfill_v1_pointers_for_tests() -> Result<(), DbErr> {
    super::migration::backfill_v1_rca_pointer(get_orm_client_rw().await).await
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{
            incidents::{AnalysisTriggerType, IncidentEventType},
            rca_runs::PreviousResult,
        },
        oncall::SubjectType,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::entity::{
        incident_events as events_entity, rca_delivery_obligations as obligations_entity,
        rca_skipped_pages as skipped_entity,
    };

    const ORG: &str = "acme";
    const SEC: i64 = 1_000_000;
    const T0: i64 = 1_700_000_000 * SEC;
    const TIMEOUT: u64 = 600;
    const COOLDOWN: i64 = 30 * 60 * SEC;

    async fn create_tables(db: &DatabaseConnection) {
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(crate::table::entity::folders::Entity),
            schema.create_table_from_entity(crate::table::entity::alerts::Entity),
            schema.create_table_from_entity(rca_runs::Entity),
            schema.create_table_from_entity(alert_incidents::Entity),
            schema.create_table_from_entity(events_entity::Entity),
            schema.create_table_from_entity(crate::table::entity::rca_steering::Entity),
            schema.create_table_from_entity(obligations_entity::Entity),
            schema.create_table_from_entity(skipped_entity::Entity),
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
            security_case: Set(false),
            historical: Set(false),
            last_detection_at: Set(None),
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

    async fn alert_row(db: &DatabaseConnection, id: &str) {
        let folder_id = format!("folder-{id}");
        crate::table::entity::folders::ActiveModel {
            id: Set(folder_id.clone()),
            org: Set(ORG.to_string()),
            folder_id: Set(folder_id.clone()),
            name: Set(folder_id.clone()),
            description: Set(None),
            icon: Set(None),
            r#type: Set(0),
        }
        .insert(db)
        .await
        .unwrap();
        crate::table::entity::alerts::ActiveModel {
            id: Set(id.to_string()),
            org: Set(ORG.to_string()),
            folder_id: Set(folder_id),
            name: Set(id.to_string()),
            stream_type: Set("logs".to_string()),
            stream_name: Set("default".to_string()),
            is_real_time: Set(false),
            destinations: Set(serde_json::json!([])),
            row_template_type: Set(0),
            enabled: Set(true),
            tz_offset: Set(0),
            query_type: Set(0),
            trigger_threshold_operator: Set(">".to_string()),
            trigger_period_seconds: Set(60),
            trigger_threshold_count: Set(1),
            trigger_frequency_type: Set(0),
            trigger_frequency_seconds: Set(60),
            trigger_silence_seconds: Set(0),
            align_time: Set(false),
            dedup_enabled: Set(false),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            pending_period_sec: Set(0),
            ..Default::default()
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
            oncall_subjects: None,
            context_used: None,
            recipients: Vec::new(),
        }
    }

    fn recipient(response_id: &str, alert_id: &str, firing: u32) -> Recipient {
        Recipient {
            response_id: response_id.to_string(),
            subject: SubjectRef::new(SubjectType::Alert, alert_id, firing),
            ladder_run: 1,
        }
    }

    fn with_recipients(mut new: NewRun, recipients: Vec<Recipient>) -> NewRun {
        let subjects: Vec<_> = recipients.iter().map(|r| &r.subject).collect();
        new.oncall_subjects = Some(serde_json::to_value(subjects).unwrap());
        new.recipients = recipients;
        new
    }

    fn paging_run(alert_id: &str, recipients: Vec<Recipient>) -> NewRun {
        let mut new = with_recipients(new_run(RunSubjectType::Alert, alert_id), recipients);
        new.trigger = RunTrigger::OncallPage;
        new.started_by = "system".to_string();
        new
    }

    fn guards(now_us: i64) -> StartGuards<'static> {
        StartGuards {
            now_us,
            rca_timeout_secs: TIMEOUT,
            cooldown_us: None,
            history_limit: 25,
            latest_run_id: None,
            records_skips: false,
        }
    }

    fn paging_guards(now_us: i64) -> StartGuards<'static> {
        StartGuards {
            cooldown_us: Some(COOLDOWN),
            ..guards(now_us)
        }
    }

    fn started_id(result: StartResult) -> String {
        match result {
            StartResult::Started { run_id, .. } => run_id,
            other => panic!("expected Started, got {other:?}"),
        }
    }

    /// Starts an incident run with a Begin event; panics unless it started.
    async fn start(db: &DatabaseConnection, incident_id: &str, now: i64) -> String {
        match start_run_with(
            db,
            new_run(RunSubjectType::Incident, incident_id),
            guards(now),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await
        .unwrap()
        {
            StartResult::Started { run_id, .. } => run_id,
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

    async fn obligations(db: &DatabaseConnection, run_id: &str) -> Vec<obligations_entity::Model> {
        obligations_entity::Entity::find()
            .filter(obligations_entity::Column::OrgId.eq(ORG))
            .filter(obligations_entity::Column::RunId.eq(run_id))
            .order_by_asc(obligations_entity::Column::ResponseId)
            .all(db)
            .await
            .unwrap()
    }

    async fn skipped(db: &DatabaseConnection) -> Vec<skipped_entity::Model> {
        skipped_entity::Entity::find()
            .filter(skipped_entity::Column::OrgId.eq(ORG))
            .order_by_asc(skipped_entity::Column::ResponseId)
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
        decode_summary(m.rca_summary.as_deref())
    }

    /// The seven summary columns equal the run that `rca_run_id` names.
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
        progress.stage = Some("context".to_string());
        progress.stage_index = Some(2);
        progress.summary = Some(RunSummaryPatch {
            steps: Some(4),
            tool_calls: Some(9),
            ..Default::default()
        });
        assert!(update_run_with(&db, ORG, &r1, progress).await.unwrap());
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.updated_at, T0 + SEC);
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(summary.stage.as_deref(), Some("context"));
        assert_eq!((summary.steps, summary.tool_calls), (4, 9));

        finish(&db, &r1, RunState::Completed, T0 + 90 * SEC).await;
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.state, "completed");
        assert_eq!(row.ended_at, Some(T0 + 90 * SEC));
        assert!(row.report.is_some());
        let stats: RunStats = decode(row.stats.as_deref()).unwrap();
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
            None,
        )
        .await
        .unwrap();
        assert!(matches!(second, StartResult::InFlight { .. }));
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
            None,
        )
        .await
        .unwrap();
        assert!(
            matches!(third, StartResult::InFlight { .. }),
            "waiting_input never goes stale"
        );
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
    }

    /// On SQLite two starts issued together serialize; one starts, one is in flight.
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
                None,
            ),
            start_run_with(
                &db,
                new_run(RunSubjectType::Incident, "inc-1"),
                guards(T0),
                Some(IncidentEvent::ai_analysis_begin()),
                None,
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
        assert!(
            results
                .iter()
                .any(|r| matches!(r, StartResult::InFlight { .. }))
        );
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        assert_eq!(event_types(&db, "inc-1").await.len(), 1);
    }

    #[tokio::test]
    async fn rr6_a_start_replaces_a_stale_run_and_fails_it() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let r1 = started_id(
            start_run_with(
                &db,
                with_recipients(
                    new_run(RunSubjectType::Incident, "inc-1"),
                    vec![recipient("response-1", "alert-1", 1)],
                ),
                guards(T0),
                Some(IncidentEvent::ai_analysis_begin()),
                None,
            )
            .await
            .unwrap(),
        );

        let early = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(T0 + 719 * SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(early, StartResult::InFlight { .. }));

        let now = T0 + 721 * SEC;
        let replacing = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(now),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await
        .unwrap();
        // The start names the trigger of the run it ended, so the caller counts it.
        let StartResult::Started {
            run_id: r2,
            replaced_stale,
            ..
        } = replacing.clone()
        else {
            panic!("expected Started, got {replacing:?}");
        };
        assert_eq!(replaced_stale, Some(RunTrigger::Manual));
        let stale = run(&db, &r1).await.unwrap();
        assert_eq!(stale.state, "failed");
        assert_eq!(stale.ended_at, Some(now));
        let error = error_of(&stale).unwrap();
        assert_eq!(error.code, STALE_ERROR_CODE);
        assert_eq!(error.reason, STALE_ERROR_REASON);
        let due = obligations(&db, &r1).await;
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].state, "pending");
        assert_eq!(due[0].kind.as_deref(), Some("no_verdict"));
        assert_eq!(due[0].next_attempt_at, now);

        let incident = inc(&db, "inc-1").await;
        assert_eq!(incident.rca_run_id.as_deref(), Some(r2.as_str()));
        assert_eq!(incident.rca_state.as_deref(), Some("running"));
        assert_eq!(runs_of(&db, "inc-1").await[0].run_id, r2);
        // The stale replacement appends no event of its own.
        assert_eq!(event_types(&db, "inc-1").await.len(), 2);
    }

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
            None,
        )
        .await
        .unwrap();
        assert!(matches!(cooling, StartResult::CoolingDown { .. }));
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

    /// Every (from, to) pair; a refused write changes no run, summary or event.
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
            matches!((from, to), (Running, _) | (WaitingInput, Some(Cancelled)))
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

    /// Completing a cancelled run is refused and writes no report, summary or event.
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

    #[tokio::test]
    async fn rr4_a_failed_event_append_writes_nothing() {
        let db = db().await;
        incident(&db, "inc-1").await;
        incident(&db, "inc-2").await;
        let r1 = started_id(
            start_run_with(
                &db,
                with_recipients(
                    new_run(RunSubjectType::Incident, "inc-1"),
                    vec![recipient("response-1", "alert-1", 1)],
                ),
                guards(T0),
                Some(IncidentEvent::ai_analysis_begin()),
                None,
            )
            .await
            .unwrap(),
        );
        let run_before = run(&db, &r1).await;
        let inc1_before = inc(&db, "inc-1").await;
        let inc2_before = inc(&db, "inc-2").await;
        let obligations_before = obligations(&db, &r1).await;

        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();

        let finished =
            update_run_with(&db, ORG, &r1, finish_update(RunState::Completed, T0 + SEC)).await;
        assert!(finished.is_err());
        assert_eq!(run(&db, &r1).await, run_before);
        assert_eq!(inc(&db, "inc-1").await, inc1_before);
        assert_eq!(obligations(&db, &r1).await, obligations_before);

        let new = with_recipients(
            new_run(RunSubjectType::Incident, "inc-2"),
            vec![recipient("response-2", "alert-2", 1)],
        );
        let attempted_id = new.run_id.clone();
        let started = start_run_with(
            &db,
            new,
            guards(T0),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await;
        assert!(started.is_err());
        assert!(runs_of(&db, "inc-2").await.is_empty());
        assert!(obligations(&db, &attempted_id).await.is_empty());
        assert_eq!(inc(&db, "inc-2").await, inc2_before);
    }

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
        progress.stage = Some("converge".to_string());
        progress.steered_by_add = Some("b.lee".to_string());
        assert!(update_run_with(&db, ORG, &r3, progress).await.unwrap());
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(summary.previous, r1_previous);
        assert_eq!(summary.steered_by, vec!["b.lee".to_string()]);
    }

    /// Starts and ends one incident run per state, one second apart; returns ids oldest first.
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
            None,
        )
        .await
        .unwrap()
        {
            StartResult::Started { run_id, .. } => run_id,
            other => panic!("expected Started, got {other:?}"),
        }
    }

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

    /// Live runs are never pruned.
    #[tokio::test]
    async fn rr25_prune_never_deletes_a_live_run() {
        let db = db().await;
        alert_row(&db, "alert-1").await;
        let mut live = Vec::new();
        for i in 0..3 {
            let new = with_recipients(
                new_run(RunSubjectType::Alert, "alert-1"),
                vec![recipient(&format!("response-{i}"), "alert-1", i)],
            );
            live.push(new.run_id.clone());
            let started = start_run_with(&db, new, guards(T0 + i64::from(i) * SEC), None, None)
                .await
                .unwrap();
            assert!(matches!(started, StartResult::Started { .. }));
        }
        let last = with_recipients(
            new_run(RunSubjectType::Alert, "alert-1"),
            vec![recipient("response-3", "alert-1", 3)],
        );
        live.push(last.run_id.clone());
        let started = start_run_with(
            &db,
            last,
            StartGuards {
                history_limit: 0,
                ..guards(T0 + 10 * SEC)
            },
            None,
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

    /// The detail/list summary computes `stale` from `rca_updated_at`.
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

    fn stats_of(m: &Model) -> RunStats {
        decode(m.stats.as_deref()).unwrap_or_default()
    }

    #[tokio::test]
    async fn a_stats_only_write_changes_only_the_counts_in_any_state() {
        use RunState::*;
        for state in [Running, WaitingInput, Completed, Failed, Cancelled] {
            let db = db().await;
            let run_id = run_in_state(&db, "inc-1", state).await;
            let before = run(&db, &run_id).await.unwrap();
            let events_before = event_types(&db, "inc-1").await.len();

            let mut upd = finish_update(Completed, T0 + 5 * SEC);
            upd.report = Some("never stored".to_string());
            upd.state = Some(Failed);
            upd.final_stats_only = true;
            upd.stage = Some("converge".to_string());
            upd.continuations_inc = true;
            upd.stats = Some(RunStats {
                steps: Some(5),
                tool_calls: Some(11),
                tokens: Some(serde_json::json!({"input": 10})),
                ..Default::default()
            });
            upd.summary = Some(RunSummaryPatch {
                steps: Some(5),
                tool_calls: Some(11),
                ..Default::default()
            });
            assert!(
                update_run_with(&db, ORG, &run_id, upd).await.unwrap(),
                "{state}"
            );

            let after = run(&db, &run_id).await.unwrap();
            assert_eq!(after.state, before.state, "{state}");
            assert_eq!(after.report, before.report, "{state}");
            assert_eq!(after.error, before.error, "{state}");
            assert_eq!(after.ended_at, before.ended_at, "{state}");
            assert_eq!(after.stage, before.stage, "{state}");
            assert_eq!(after.continuations, before.continuations, "{state}");
            assert_eq!(after.updated_at, T0 + 5 * SEC, "{state}");
            let stats = stats_of(&after);
            assert_eq!(
                (stats.steps, stats.tool_calls),
                (Some(5), Some(11)),
                "{state}"
            );
            assert_eq!(stats.duration_ms, stats_of(&before).duration_ms, "{state}");
            let incident = inc(&db, "inc-1").await;
            assert_eq!(incident.rca_state, Some(before.state.clone()), "{state}");
            let summary = summary_of(&incident);
            assert_eq!((summary.steps, summary.tool_calls), (5, 11), "{state}");
            assert_eq!(
                event_types(&db, "inc-1").await.len(),
                events_before,
                "{state}"
            );
        }
    }

    #[tokio::test]
    async fn a_stats_only_write_for_a_replaced_run_leaves_the_summary() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let old = start(&db, "inc-1", T0).await;
        finish(&db, &old, RunState::Cancelled, T0 + SEC).await;
        let new = start(&db, "inc-1", T0 + 2 * SEC).await;

        let mut upd = update(None, T0 + 3 * SEC);
        upd.final_stats_only = true;
        upd.stats = Some(RunStats {
            tool_calls: Some(7),
            ..Default::default()
        });
        upd.summary = Some(RunSummaryPatch {
            tool_calls: Some(7),
            ..Default::default()
        });
        assert!(update_run_with(&db, ORG, &old, upd.clone()).await.unwrap());

        assert_eq!(stats_of(&run(&db, &old).await.unwrap()).tool_calls, Some(7));
        let incident = inc(&db, "inc-1").await;
        assert_eq!(incident.rca_run_id.as_deref(), Some(new.as_str()));
        assert_eq!(summary_of(&incident).tool_calls, 0);
        assert!(!update_run_with(&db, ORG, "missing", upd).await.unwrap());
    }

    #[tokio::test]
    async fn a_stats_only_write_sets_the_result_only_when_null_and_not_completed() {
        use RunState::*;
        let stats_only = |result: serde_json::Value| {
            let mut upd = update(None, T0 + 5 * SEC);
            upd.final_stats_only = true;
            upd.result = Some(result);
            upd
        };
        let first = serde_json::json!({"schema_version": 1, "ledger": {"hypotheses": []}});
        let second = serde_json::json!({"schema_version": 1, "ledger": {"truncations": 9}});
        for state in [Running, WaitingInput, Completed, Failed, Cancelled] {
            let db = db().await;
            let run_id = run_in_state(&db, "inc-1", state).await;
            assert_eq!(run(&db, &run_id).await.unwrap().result, None, "{state}");

            assert!(
                update_run_with(&db, ORG, &run_id, stats_only(first.clone()))
                    .await
                    .unwrap(),
                "{state}"
            );
            let after = run(&db, &run_id).await.unwrap();
            let expected = (state != Completed).then(|| first.clone());
            assert_eq!(decode(after.result.as_deref()), expected, "{state}");
            assert_eq!(after.state, state.as_str(), "{state}");

            assert!(
                update_run_with(&db, ORG, &run_id, stats_only(second.clone()))
                    .await
                    .unwrap(),
                "{state}"
            );
            assert_eq!(
                decode(run(&db, &run_id).await.unwrap().result.as_deref()),
                expected,
                "{state}: a stored result is never replaced"
            );
        }
    }

    #[tokio::test]
    async fn the_history_item_says_whether_a_cancelled_run_stored_a_record() {
        let db = db().await;
        let run_id = run_in_state(&db, "inc-1", RunState::Cancelled).await;
        assert!(!to_item(&run(&db, &run_id).await.unwrap()).has_record);

        let mut upd = update(None, T0 + 5 * SEC);
        upd.final_stats_only = true;
        upd.result = Some(serde_json::json!({"schema_version": 1, "ledger": {"hypotheses": []}}));
        assert!(update_run_with(&db, ORG, &run_id, upd).await.unwrap());
        assert!(to_item(&run(&db, &run_id).await.unwrap()).has_record);
    }

    #[tokio::test]
    async fn a_progress_write_stores_the_run_progress_columns() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let run_id = start(&db, "inc-1", T0).await;
        let fresh = run(&db, &run_id).await.unwrap();
        assert_eq!(
            (
                fresh.stage.clone(),
                fresh.stage_index,
                fresh.continuations,
                fresh.context_used.clone()
            ),
            (None, None, 0, None)
        );

        let context = serde_json::json!({"past_causes": [], "skills": ["k8s"], "toolsets": ["o2"]});
        let mut upd = update(None, T0 + SEC);
        upd.session_id = Some("ses-1".to_string());
        upd.stage = Some("traces".to_string());
        upd.stage_index = Some(4);
        upd.context_used = Some(context.clone());
        upd.continuations_inc = true;
        assert!(update_run_with(&db, ORG, &run_id, upd).await.unwrap());
        let mut again = update(None, T0 + 2 * SEC);
        again.continuations_inc = true;
        assert!(update_run_with(&db, ORG, &run_id, again).await.unwrap());

        let row = run(&db, &run_id).await.unwrap();
        assert_eq!(row.session_id.as_deref(), Some("ses-1"));
        assert_eq!(
            (row.stage.as_deref(), row.stage_index),
            (Some("traces"), Some(4))
        );
        assert_eq!(decode(row.context_used.as_deref()), Some(context));
        assert_eq!(row.continuations, 2);
        let item = to_run(row);
        assert_eq!(item.continuations, 2);
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(
            (summary.stage.as_deref(), summary.stage_index),
            (Some("traces"), Some(4))
        );
    }

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
                        None,
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
        assert!(
            results
                .iter()
                .any(|r| matches!(r, StartResult::InFlight { .. })),
            "{results:?}"
        );
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

    // ---- Questions and steering ----

    const DEADLINE: i64 = T0 + 600 * SEC;

    /// The finalizer's `waiting_input` write, with its event.
    fn waiting_update(now_us: i64, deadline: i64, question_id: &str) -> RunUpdate {
        let mut upd = update(Some(RunState::WaitingInput), now_us);
        upd.input_deadline_at = Some(Some(deadline));
        upd.pending_question_id = Some(Some(question_id.to_string()));
        upd.questions_asked_inc = true;
        upd.summary = Some(RunSummaryPatch {
            detail: Some(Some("orders pool size".to_string())),
            deadline_at: Some(Some(deadline)),
            ..Default::default()
        });
        upd.event = Some(IncidentEvent::ai_analysis_needs_input(
            "run",
            question_id,
            "orders pool size",
            "What is the pool size?",
            deadline,
        ));
        upd
    }

    fn needs_input_count(types: &[IncidentEventType]) -> usize {
        types
            .iter()
            .filter(|t| matches!(t, IncidentEventType::AiAnalysisNeedsInput { .. }))
            .count()
    }

    /// A fresh incident whose only run waits for an answer until `deadline`.
    async fn waiting_run(db: &DatabaseConnection, incident_id: &str, deadline: i64) -> String {
        incident(db, incident_id).await;
        let run_id = start(db, incident_id, T0).await;
        assert!(
            update_run_with(
                db,
                ORG,
                &run_id,
                waiting_update(T0 + SEC, deadline, "call_1")
            )
            .await
            .unwrap()
        );
        run_id
    }

    #[tokio::test]
    async fn sg26_sg42_waiting_input_write_carries_its_event_iff_it_wins() {
        let db = db().await;
        let run_id = waiting_run(&db, "inc-1", DEADLINE).await;
        let r = run(&db, &run_id).await.unwrap();
        assert_eq!(r.state, "waiting_input");
        assert_eq!(r.input_deadline_at, Some(DEADLINE));
        assert_eq!(r.pending_question_id.as_deref(), Some("call_1"));
        assert_eq!(r.questions_asked, 1);
        assert_eq!(r.deadline_closed_at, None);
        let row = assert_summary_mirrors_run(&db, "inc-1").await;
        assert_eq!(row.state, "waiting_input");
        let summary = summary_of(&inc(&db, "inc-1").await);
        assert_eq!(summary.detail.as_deref(), Some("orders pool size"));
        assert_eq!(summary.deadline_at, Some(DEADLINE));
        assert_eq!(needs_input_count(&event_types(&db, "inc-1").await), 1);

        // A second waiting write on a waiting run loses and appends nothing.
        let before = (
            run(&db, &run_id).await,
            inc(&db, "inc-1").await,
            events(&db, "inc-1").await,
        );
        assert!(
            !update_run_with(
                &db,
                ORG,
                &run_id,
                waiting_update(T0 + 2 * SEC, DEADLINE, "call_2")
            )
            .await
            .unwrap()
        );
        assert_eq!(
            (
                run(&db, &run_id).await,
                inc(&db, "inc-1").await,
                events(&db, "inc-1").await
            ),
            before
        );

        // A terminal run refuses it too.
        let done = run_in_state(&db, "inc-2", RunState::Completed).await;
        let before = events(&db, "inc-2").await;
        assert!(
            !update_run_with(
                &db,
                ORG,
                &done,
                waiting_update(T0 + 2 * SEC, DEADLINE, "call_1")
            )
            .await
            .unwrap()
        );
        assert_eq!(events(&db, "inc-2").await, before);
        assert_eq!(needs_input_count(&event_types(&db, "inc-2").await), 0);

        // A failing event append rolls the state write back.
        incident(&db, "inc-3").await;
        let r3 = start(&db, "inc-3", T0).await;
        let run_before = run(&db, &r3).await;
        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();
        assert!(
            update_run_with(&db, ORG, &r3, waiting_update(T0 + SEC, DEADLINE, "call_1"))
                .await
                .is_err()
        );
        assert_eq!(run(&db, &r3).await, run_before);
    }

    #[tokio::test]
    async fn sg18_resume_waiting_is_a_compare_and_set() {
        let db = db().await;
        let run_id = waiting_run(&db, "inc-1", DEADLINE).await;
        assert!(
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, T0 + 5 * SEC)
                .await
                .unwrap()
        );
        assert!(
            !reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, T0 + 6 * SEC)
                .await
                .unwrap(),
            "the second caller loses"
        );
        let r = run(&db, &run_id).await.unwrap();
        assert_eq!(r.state, "running");
        assert_eq!(r.input_deadline_at, None);
        assert_eq!(r.pending_question_id, None);
        assert_eq!(r.deadline_closed_at, None);
        assert_eq!(r.questions_asked, 1, "the count stays");
        assert_eq!(r.updated_at, T0 + 5 * SEC);
        let i = inc(&db, "inc-1").await;
        assert_eq!(i.rca_state.as_deref(), Some("running"));
        assert_eq!(i.rca_updated_at, Some(T0 + 5 * SEC));
        let summary = summary_of(&i);
        assert_eq!((summary.detail, summary.deadline_at), (None, None));

        // Other orgs, unknown runs and running runs lose.
        assert!(
            !reopen_waiting_with(&db, "other", &run_id, Reopen::Answer, T0)
                .await
                .unwrap()
        );
        assert!(
            !reopen_waiting_with(&db, ORG, "nope", Reopen::Answer, T0)
                .await
                .unwrap()
        );

        // Concurrent answers: exactly one wins.
        let db = self::db().await;
        let run_id = waiting_run(&db, "inc-1", DEADLINE).await;
        let (a, b) = tokio::join!(
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, T0 + 5 * SEC),
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, T0 + 5 * SEC),
        );
        assert_eq!([a.unwrap(), b.unwrap()].iter().filter(|w| **w).count(), 1);
    }

    #[tokio::test]
    async fn sg27_close_deadline_is_a_compare_and_set() {
        let db = db().await;
        let run_id = waiting_run(&db, "inc-1", DEADLINE).await;
        let now = DEADLINE + SEC;
        assert!(
            !reopen_waiting_with(&db, ORG, &run_id, Reopen::Deadline(DEADLINE - 1), now)
                .await
                .unwrap(),
            "a different deadline loses"
        );
        assert!(
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Deadline(DEADLINE), now)
                .await
                .unwrap()
        );
        assert!(
            !reopen_waiting_with(&db, ORG, &run_id, Reopen::Deadline(DEADLINE), now)
                .await
                .unwrap(),
            "the second sweeper loses"
        );
        assert!(
            !reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, now)
                .await
                .unwrap(),
            "an answer after the close loses"
        );
        let r = run(&db, &run_id).await.unwrap();
        assert_eq!(r.state, "running");
        assert_eq!(r.deadline_closed_at, Some(now));
        assert_eq!((r.input_deadline_at, r.pending_question_id), (None, None));
        let i = inc(&db, "inc-1").await;
        assert_eq!(i.rca_state.as_deref(), Some("running"));
        let summary = summary_of(&i);
        assert_eq!((summary.detail, summary.deadline_at), (None, None));

        // Even if the run waits again, a closed deadline refuses both reopenings.
        assert!(
            update_run_with(
                &db,
                ORG,
                &run_id,
                waiting_update(now + SEC, now + 600 * SEC, "c2")
            )
            .await
            .unwrap()
        );
        assert!(
            !reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, now + 2 * SEC)
                .await
                .unwrap()
        );
        assert!(
            !reopen_waiting_with(
                &db,
                ORG,
                &run_id,
                Reopen::Deadline(now + 600 * SEC),
                now + 2 * SEC
            )
            .await
            .unwrap()
        );

        // A sweeper racing an answer: exactly one wins.
        let db = self::db().await;
        let run_id = waiting_run(&db, "inc-1", DEADLINE).await;
        let (a, b) = tokio::join!(
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Answer, now),
            reopen_waiting_with(&db, ORG, &run_id, Reopen::Deadline(DEADLINE), now),
        );
        assert_eq!([a.unwrap(), b.unwrap()].iter().filter(|w| **w).count(), 1);
    }

    #[tokio::test]
    async fn sg25_the_finalizers_deadline_close_is_a_compare_and_set() {
        let db = db().await;
        let run_id = run_in_state(&db, "inc-1", RunState::Running).await;
        let close = |now_us| RunUpdate {
            deadline_closed_at: Some(now_us),
            ..update(None, now_us)
        };
        assert!(
            update_run_with(&db, ORG, &run_id, close(T0 + SEC))
                .await
                .unwrap()
        );
        assert!(
            !update_run_with(&db, ORG, &run_id, close(T0 + 2 * SEC))
                .await
                .unwrap(),
            "the second finalizer loses"
        );
        let r = run(&db, &run_id).await.unwrap();
        assert_eq!(r.deadline_closed_at, Some(T0 + SEC));
        assert_eq!(r.updated_at, T0 + SEC);
    }

    #[tokio::test]
    async fn a_resume_start_loses_to_any_start_since_its_decision() {
        let db = db().await;
        let source = run_in_state(&db, "inc-1", RunState::Failed).await;
        fn resume_of(latest: &str) -> StartGuards<'_> {
            StartGuards {
                latest_run_id: Some(latest),
                ..guards(T0 + 10 * SEC)
            }
        }
        let other = start(&db, "inc-1", T0 + 5 * SEC).await;
        finish(&db, &other, RunState::Failed, T0 + 6 * SEC).await;
        let refused = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            resume_of(&source),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await
        .unwrap();
        assert!(matches!(refused, StartResult::InFlight { .. }));
        assert_eq!(inc(&db, "inc-1").await.rca_run_id, Some(other.clone()));

        let started = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            resume_of(&other),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await
        .unwrap();
        assert!(
            matches!(started, StartResult::Started { .. }),
            "{started:?}"
        );
    }

    #[tokio::test]
    async fn sg23_a_steering_author_reaches_the_summary_of_an_ended_run() {
        let db = db().await;
        let run_id = run_in_state(&db, "inc-1", RunState::Completed).await;
        let mut steered = update(None, T0 + 2 * SEC);
        steered.final_stats_only = true;
        steered.steered_by_add = Some("b.lee".to_string());
        assert!(update_run_with(&db, ORG, &run_id, steered).await.unwrap());
        let i = inc(&db, "inc-1").await;
        assert_eq!(summary_of(&i).steered_by, vec!["b.lee".to_string()]);
        assert_eq!(i.rca_state.as_deref(), Some("completed"));
    }

    #[tokio::test]
    async fn sg27_list_waiting_past_deadline() {
        let db = db().await;
        let late = waiting_run(&db, "inc-1", T0 + 100 * SEC).await;
        let later = waiting_run(&db, "inc-2", T0 + 200 * SEC).await;
        waiting_run(&db, "inc-3", T0 + 900 * SEC).await;
        let closed = waiting_run(&db, "inc-4", T0 + 50 * SEC).await;
        assert!(
            reopen_waiting_with(
                &db,
                ORG,
                &closed,
                Reopen::Deadline(T0 + 50 * SEC),
                T0 + 60 * SEC
            )
            .await
            .unwrap()
        );
        assert!(
            update_run_with(
                &db,
                ORG,
                &closed,
                waiting_update(T0 + 61 * SEC, T0 + 70 * SEC, "c2")
            )
            .await
            .unwrap()
        );
        run_in_state(&db, "inc-5", RunState::Running).await;

        let ids = |rows: Vec<Model>| rows.into_iter().map(|r| r.run_id).collect::<Vec<_>>();
        let now = T0 + 300 * SEC;
        assert_eq!(
            ids(list_waiting_past_deadline_with(&db, now, 10).await.unwrap()),
            [late.clone(), later.clone()]
        );
        assert_eq!(
            ids(list_waiting_past_deadline_with(&db, now, 1).await.unwrap()),
            std::slice::from_ref(&late)
        );
        assert!(
            list_waiting_past_deadline_with(&db, T0 + 100 * SEC, 10)
                .await
                .unwrap()
                .is_empty(),
            "strictly past the deadline"
        );
    }

    fn steer_row(steer_id: &str, run_id: &str) -> config::meta::alerts::rca_steering::SteerRecord {
        use config::meta::alerts::rca_steering::*;
        SteerRecord {
            org_id: ORG.to_string(),
            steer_id: steer_id.to_string(),
            run_id: run_id.to_string(),
            incident_id: "inc-a".to_string(),
            author_email: "a.rao@acme.io".to_string(),
            kind: SteerKind::Message,
            action: None,
            hypothesis_id: None,
            question_id: None,
            text: "t".to_string(),
            status: SteerStatus::NotRead,
            status_reason: Some(SteerStatusReason::RunCompleted),
            created_at: T0,
            delivered_at: None,
            read_at: None,
            acted_at: None,
            agent_note: None,
            opencode_message_id: None,
        }
    }

    #[tokio::test]
    async fn prune_deletes_the_steering_rows_of_pruned_runs() {
        use RunState::*;
        let db = db().await;
        incident(&db, "inc-a").await;
        let old = history(
            &db,
            "inc-a",
            &[Failed, Completed, Failed, Cancelled, Failed, Failed],
        )
        .await;
        for (i, run_id) in old.iter().enumerate() {
            rca_steering::insert_with(&db, &steer_row(&format!("stg_{i}"), run_id))
                .await
                .unwrap();
        }
        let mut foreign = steer_row("stg_other_org", &old[0]);
        foreign.org_id = "other".into();
        rca_steering::insert_with(&db, &foreign).await.unwrap();

        start_with_limit(&db, "inc-a", 3).await;
        // Kept: old[1] (newest completed), old[3..6]; pruned: old[0], old[2].
        let mut kept: Vec<String> = crate::table::entity::rca_steering::Entity::find()
            .filter(crate::table::entity::rca_steering::Column::OrgId.eq(ORG))
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.run_id)
            .collect();
        kept.sort();
        let mut want = vec![
            old[1].clone(),
            old[3].clone(),
            old[4].clone(),
            old[5].clone(),
        ];
        want.sort();
        assert_eq!(kept, want);
        assert!(
            rca_steering::get_with(&db, "other", "stg_other_org")
                .await
                .unwrap()
                .is_some(),
            "another org's rows stay"
        );

        // A prune whose transaction fails deletes no steering row.
        incident(&db, "inc-b").await;
        let old = history(&db, "inc-b", &[Failed, Failed, Failed]).await;
        rca_steering::insert_with(&db, &steer_row("stg_b0", &old[0]))
            .await
            .unwrap();
        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();
        assert!(
            start_run_with(
                &db,
                new_run(RunSubjectType::Incident, "inc-b"),
                StartGuards {
                    history_limit: 0,
                    ..guards(T0 + 1_000 * SEC)
                },
                Some(IncidentEvent::ai_analysis_begin()),
                None,
            )
            .await
            .is_err()
        );
        assert!(
            rca_steering::get_with(&db, ORG, "stg_b0")
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn sg23_replaced_run_id_is_set_only_on_stale_replacement() {
        use RunState::*;
        let db = db().await;
        let replaced = |r: &StartResult| match r {
            StartResult::Started {
                replaced_run_id, ..
            } => replaced_run_id.clone(),
            other => panic!("expected Started, got {other:?}"),
        };
        let start_at = |subject_type, subject: &'static str, now| {
            let db = &db;
            async move {
                start_run_with(db, new_run(subject_type, subject), guards(now), None, None)
                    .await
                    .unwrap()
            }
        };

        incident(&db, "inc-1").await;
        let first = start_at(RunSubjectType::Incident, "inc-1", T0).await;
        assert_eq!(replaced(&first), None, "first run");
        let StartResult::Started { run_id: r1, .. } = first else {
            unreachable!()
        };

        // Live and not stale: in flight, nothing replaced.
        assert!(matches!(
            start_at(RunSubjectType::Incident, "inc-1", T0 + 60 * SEC).await,
            StartResult::InFlight { .. }
        ));

        // Stale: replaced, and the id is the stale run's.
        let r = start_at(RunSubjectType::Incident, "inc-1", T0 + 721 * SEC).await;
        assert_eq!(replaced(&r), Some(r1.clone()));
        assert_eq!(run(&db, &r1).await.unwrap().state, "failed");

        // After a terminal run of each kind: nothing replaced.
        for (i, state) in [Completed, Failed, Cancelled].into_iter().enumerate() {
            let subject: &'static str = ["inc-c", "inc-f", "inc-x"][i];
            incident(&db, subject).await;
            let prev = start(&db, subject, T0).await;
            finish(&db, &prev, state, T0 + SEC).await;
            let r = start_at(RunSubjectType::Incident, subject, T0 + 10_000 * SEC).await;
            assert_eq!(replaced(&r), None, "{state}");
        }

        // A waiting run never goes stale, so it is never replaced.
        let waiting = waiting_run(&db, "inc-w", DEADLINE).await;
        assert!(matches!(
            start_at(RunSubjectType::Incident, "inc-w", T0 + 99_999 * SEC).await,
            StartResult::InFlight { .. }
        ));
        assert_eq!(run(&db, &waiting).await.unwrap().state, "waiting_input");

        // A stale alert run must not keep blocking future starts.
        alert_row(&db, "alert-1").await;
        let a1 = start_at(RunSubjectType::Alert, "alert-1", T0).await;
        assert_eq!(replaced(&a1), None);
        let a1_id = started_id(a1);
        let a2 = start_at(RunSubjectType::Alert, "alert-1", T0 + 99_999 * SEC).await;
        assert_eq!(replaced(&a2), Some(a1_id.clone()));
        assert_eq!(run(&db, &a1_id).await.unwrap().state, "failed");
    }

    /// SQLite, and a fresh Postgres schema when `ZO_META_POSTGRES_DSN` is set.
    async fn stores() -> Vec<(DatabaseConnection, Option<String>)> {
        let mut out = vec![(db().await, None)];
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            return out;
        }
        let schema = format!("rca_test_{}", config::ider::generate().to_ascii_lowercase());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut options = ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .set_schema_search_path(schema.clone());
        let pg = Database::connect(options).await.unwrap();
        create_tables(&pg).await;
        out.push((pg, Some(schema)));
        out
    }

    #[tokio::test]
    async fn a_write_for_an_incident_episode_that_ended_is_refused() {
        use crate::table::alert_incidents::{Episode, update_status_with};

        for (db, schema) in stores().await {
            incident(&db, "inc-episode").await;
            let run_id = start(&db, "inc-episode", T0).await;
            let resolved = update_status_with(&db, ORG, "inc-episode", "resolved").await;
            let resolved = Episode::of(&resolved.unwrap());
            update_status_with(&db, ORG, "inc-episode", "open")
                .await
                .unwrap();
            let cancel = |episode| RunUpdate {
                episode: Some(episode),
                ..finish_update(RunState::Cancelled, T0 + SEC)
            };
            let late = update_run_with(&db, ORG, &run_id, cancel(resolved)).await;
            assert!(!late.unwrap(), "the resolution it names ended");
            let still = run(&db, &run_id).await.unwrap().state;
            assert_eq!(still, RunState::Running.as_str());
            assert!(
                !event_types(&db, "inc-episode")
                    .await
                    .iter()
                    .any(|t| matches!(t, IncidentEventType::AIAnalysisCancelled { .. }))
            );

            let reopened = Episode::of(&inc(&db, "inc-episode").await);
            let now = update_run_with(&db, ORG, &run_id, cancel(reopened)).await;
            assert!(now.unwrap(), "the episode it names still holds");
            if let Some(schema) = schema {
                let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap();
                Database::connect(&dsn)
                    .await
                    .unwrap()
                    .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
                    .await
                    .unwrap();
                println!("postgres arm ran");
            }
        }
    }

    #[tokio::test]
    async fn the_covering_run_id_comes_from_the_guard() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let first = start(&db, "inc-1", T0).await;
        let refused = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            guards(T0 + SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(
            refused,
            StartResult::InFlight { covering_run_id } if covering_run_id == first
        ));

        let ended_at = T0 + 60 * SEC;
        finish(&db, &first, RunState::Completed, ended_at).await;
        let refused = start_run_with(
            &db,
            new_run(RunSubjectType::Incident, "inc-1"),
            paging_guards(ended_at + COOLDOWN - 1),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(
            refused,
            StartResult::CoolingDown { covering_run_id, retry_after_us }
                if covering_run_id == first && retry_after_us == ended_at + COOLDOWN
        ));
    }

    #[tokio::test]
    async fn run_numbers_are_stable_per_subject_and_survive_pruning() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let mut ids = Vec::new();
        for number in 1..=3 {
            let at = T0 + i64::from(number) * 10 * SEC;
            let new = with_recipients(
                new_run(RunSubjectType::Incident, "inc-1"),
                vec![recipient("response-1", "alert-1", 1)],
            );
            let id = started_id(
                start_run_with(&db, new, guards(at), None, None)
                    .await
                    .unwrap(),
            );
            let row = run(&db, &id).await.unwrap();
            assert_eq!(to_item(&row).run_number, Some(number));
            finish(&db, &id, RunState::Completed, at + SEC).await;
            ids.push(id);
        }

        let txn = db.begin().await.unwrap();
        prune_with(&txn, ORG, RunSubjectType::Incident, "inc-1", 1)
            .await
            .unwrap();
        txn.commit().await.unwrap();
        assert!(run(&db, &ids[0]).await.is_none());
        assert!(obligations(&db, &ids[0]).await.is_empty());
        assert_eq!(runs_of(&db, "inc-1").await.len(), 2);
        for (id, number) in [(&ids[1], 2), (&ids[2], 3)] {
            assert_eq!(
                to_item(&run(&db, id).await.unwrap()).run_number,
                Some(number)
            );
            assert_eq!(obligations(&db, id).await.len(), 1);
        }
        let fourth = start(&db, "inc-1", T0 + 40 * SEC).await;
        assert_eq!(
            to_item(&run(&db, &fourth).await.unwrap()).run_number,
            Some(4)
        );

        incident(&db, "inc-2").await;
        let other = start(&db, "inc-2", T0 + 40 * SEC).await;
        assert_eq!(
            to_item(&run(&db, &other).await.unwrap()).run_number,
            Some(1)
        );

        alert_row(&db, "inc-1").await;
        for org in [ORG, "other-org"] {
            let mut new = new_run(RunSubjectType::Alert, "inc-1");
            new.org_id = org.to_string();
            let id = started_id(
                start_run_with(&db, new, guards(T0 + 50 * SEC), None, None)
                    .await
                    .unwrap(),
            );
            assert_eq!(to_item(&run(&db, &id).await.unwrap()).run_number, Some(1));
        }
    }

    #[tokio::test]
    async fn a_repeat_page_of_one_firing_is_in_flight_and_a_distinct_firing_gets_its_own_run() {
        let db = db().await;
        alert_row(&db, "alert-1").await;
        let recipients = vec![recipient("response-1", "alert-1", 1)];
        let first = started_id(
            start_run_with(
                &db,
                paging_run("alert-1", recipients.clone()),
                paging_guards(T0),
                None,
                None,
            )
            .await
            .unwrap(),
        );
        let repeated = start_run_with(
            &db,
            paging_run("alert-1", recipients),
            paging_guards(T0 + SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(
            repeated,
            StartResult::InFlight { covering_run_id } if covering_run_id == first
        ));

        let distinct = start_run_with(
            &db,
            paging_run("alert-1", vec![recipient("response-2", "alert-1", 2)]),
            paging_guards(T0 + 2 * SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(distinct, StartResult::Started { .. }));
        assert_eq!(runs_of(&db, "alert-1").await.len(), 2);
    }

    #[tokio::test]
    async fn a_failed_or_cancelled_paging_attempt_cools_down_its_scope_and_expiry_admits() {
        let db = db().await;
        for (alert_id, state) in [
            ("alert-failed", RunState::Failed),
            ("alert-cancelled", RunState::Cancelled),
        ] {
            alert_row(&db, alert_id).await;
            let mut page = paging_run(alert_id, vec![recipient(alert_id, alert_id, 1)]);
            let first = started_id(
                start_run_with(&db, page.clone(), paging_guards(T0), None, None)
                    .await
                    .unwrap(),
            );
            let ended_at = T0 + 100 * SEC;
            finish(&db, &first, state, ended_at).await;
            page.run_id = new_run_id();
            let refused = start_run_with(
                &db,
                page.clone(),
                paging_guards(ended_at + COOLDOWN - 1),
                None,
                None,
            )
            .await
            .unwrap();
            assert!(matches!(
                refused,
                StartResult::CoolingDown { covering_run_id, retry_after_us }
                    if covering_run_id == first && retry_after_us == ended_at + COOLDOWN
            ));
            let admitted =
                start_run_with(&db, page, paging_guards(ended_at + COOLDOWN), None, None)
                    .await
                    .unwrap();
            assert!(matches!(admitted, StartResult::Started { .. }));
        }
    }

    #[tokio::test]
    async fn a_human_start_skips_the_paging_cooldown_but_not_a_live_run() {
        let db = db().await;
        alert_row(&db, "alert-1").await;
        let first = started_id(
            start_run_with(
                &db,
                paging_run("alert-1", vec![recipient("response-1", "alert-1", 1)]),
                paging_guards(T0),
                None,
                None,
            )
            .await
            .unwrap(),
        );
        finish(&db, &first, RunState::Completed, T0 + SEC).await;
        let human = started_id(
            start_run_with(
                &db,
                new_run(RunSubjectType::Alert, "alert-1"),
                paging_guards(T0 + 2 * SEC),
                None,
                None,
            )
            .await
            .unwrap(),
        );
        finish(&db, &human, RunState::Completed, T0 + 3 * SEC).await;

        let live = started_id(
            start_run_with(
                &db,
                paging_run("alert-1", vec![recipient("response-2", "alert-1", 2)]),
                paging_guards(T0 + 4 * SEC),
                None,
                None,
            )
            .await
            .unwrap(),
        );
        let refused = start_run_with(
            &db,
            new_run(RunSubjectType::Alert, "alert-1"),
            paging_guards(T0 + 5 * SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(
            refused,
            StartResult::InFlight { covering_run_id } if covering_run_id == live
        ));
    }

    #[tokio::test]
    async fn paging_an_alert_with_no_alert_row_is_an_error() {
        let db = db().await;
        let refused = start_run_with(
            &db,
            paging_run("missing", vec![recipient("response-1", "missing", 1)]),
            paging_guards(T0),
            None,
            None,
        )
        .await;
        assert!(matches!(refused, Err(DbErr::RecordNotFound(_))));
        assert!(runs_of(&db, "missing").await.is_empty());
        assert!(
            obligations_entity::Entity::find()
                .all(&db)
                .await
                .unwrap()
                .is_empty()
        );

        let manual = start_run_with(
            &db,
            new_run(RunSubjectType::Alert, "missing"),
            guards(T0 + SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(manual, StartResult::Started { .. }));
    }

    #[tokio::test]
    async fn a_refused_automatic_page_writes_one_skipped_row_per_recipient_once() {
        for state in [RunState::Running, RunState::Completed] {
            let db = db().await;
            alert_row(&db, "alert-1").await;
            let mut page = paging_run(
                "alert-1",
                vec![
                    recipient("response-1", "alert-1", 1),
                    recipient("response-2", "alert-1", 2),
                ],
            );
            let first = started_id(
                start_run_with(&db, page.clone(), paging_guards(T0), None, None)
                    .await
                    .unwrap(),
            );
            if state == RunState::Completed {
                finish(&db, &first, state, T0 + SEC).await;
            }
            page.run_id = new_run_id();
            let now = T0 + 2 * SEC;
            let unrecorded = start_run_with(&db, page.clone(), paging_guards(now), None, None)
                .await
                .unwrap();
            assert!(!matches!(unrecorded, StartResult::Started { .. }));
            assert!(skipped(&db).await.is_empty());

            let refusal = start_run_with(
                &db,
                page.clone(),
                StartGuards {
                    records_skips: true,
                    ..paging_guards(now)
                },
                None,
                None,
            )
            .await
            .unwrap();
            let (reason, retry_after_us) = match &refusal {
                StartResult::InFlight { covering_run_id } => {
                    assert_eq!(covering_run_id, &first);
                    ("in_flight", None)
                }
                StartResult::CoolingDown {
                    covering_run_id,
                    retry_after_us,
                } => {
                    assert_eq!(covering_run_id, &first);
                    assert_eq!(*retry_after_us, T0 + SEC + COOLDOWN);
                    ("cooling_down", Some(*retry_after_us))
                }
                other => panic!("expected refusal, got {other:?}"),
            };
            assert_eq!(
                reason,
                if state == RunState::Running {
                    "in_flight"
                } else {
                    "cooling_down"
                }
            );
            let rows = skipped(&db).await;
            assert_eq!(rows.len(), 2);
            for (row, recipient) in rows.iter().zip(&page.recipients) {
                assert_eq!(row.org_id, ORG);
                assert_eq!(row.subject_type, "alert");
                assert_eq!(row.subject_id, "alert-1");
                assert_eq!(row.incident_id, None);
                assert_eq!(
                    row.response_id.as_deref(),
                    Some(recipient.response_id.as_str())
                );
                assert_eq!(row.covering_run_id, first);
                assert_eq!(row.covering_run_number, Some(1));
                assert_eq!(row.reason, reason);
                assert_eq!(row.retry_after_us, retry_after_us);
                assert_eq!(row.cooldown_us, Some(COOLDOWN));
                assert_eq!(row.at_us, now);
            }

            page.run_id = new_run_id();
            let repeated = start_run_with(
                &db,
                page,
                StartGuards {
                    records_skips: true,
                    ..paging_guards(now + SEC)
                },
                None,
                None,
            )
            .await
            .unwrap();
            assert_eq!(repeated, refusal);
            assert_eq!(skipped(&db).await, rows);
            assert_eq!(runs_of(&db, "alert-1").await.len(), 1);
        }
    }

    #[tokio::test]
    async fn skipped_pages_stay_within_four_times_the_history_limit() {
        let db = db().await;
        alert_row(&db, "alert-1").await;
        let first = started_id(
            start_run_with(
                &db,
                paging_run("alert-1", vec![recipient("initial", "alert-1", 1)]),
                paging_guards(T0),
                None,
                None,
            )
            .await
            .unwrap(),
        );
        for i in 1..=12 {
            let refused = start_run_with(
                &db,
                paging_run(
                    "alert-1",
                    vec![recipient(&format!("response-{i}"), "alert-1", 1)],
                ),
                StartGuards {
                    records_skips: true,
                    history_limit: 1,
                    ..paging_guards(T0 + i * SEC)
                },
                None,
                None,
            )
            .await
            .unwrap();
            assert!(matches!(
                refused,
                StartResult::InFlight { covering_run_id } if covering_run_id == first
            ));
            assert!(skipped(&db).await.len() <= 4);
        }
        let rows = skipped(&db).await;
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| row.at_us >= T0 + 9 * SEC));
    }

    #[tokio::test]
    async fn obligations_are_armed_at_start_and_due_with_the_terminal_write() {
        let db = db().await;
        incident(&db, "inc-1").await;
        for (at, state, kind) in [
            (T0, RunState::Completed, "verdict"),
            (T0 + 10 * SEC, RunState::Failed, "no_verdict"),
            (T0 + 20 * SEC, RunState::Cancelled, "no_verdict"),
        ] {
            let recipients = vec![
                recipient("response-1", "alert-1", 1),
                Recipient {
                    ladder_run: 2,
                    ..recipient("response-2", "alert-1", 2)
                },
            ];
            let new = with_recipients(
                new_run(RunSubjectType::Incident, "inc-1"),
                recipients.clone(),
            );
            let id = started_id(
                start_run_with(&db, new, guards(at), None, None)
                    .await
                    .unwrap(),
            );
            let armed = obligations(&db, &id).await;
            assert_eq!(armed.len(), 2);
            for (row, recipient) in armed.iter().zip(&recipients) {
                assert_eq!(row.org_id, ORG);
                assert_eq!(row.run_id, id);
                assert_eq!(row.response_id, recipient.response_id);
                assert_eq!(
                    serde_json::from_str::<SubjectRef>(&row.subject).unwrap(),
                    recipient.subject
                );
                assert_eq!(row.ladder_run, recipient.ladder_run);
                assert_eq!(row.state, "armed");
                assert_eq!(row.kind, None);
                assert_eq!(row.created_at, at);
            }

            let mut progress = update(None, at + SEC);
            progress.stage = Some("converge".to_string());
            assert!(update_run_with(&db, ORG, &id, progress).await.unwrap());
            assert_eq!(obligations(&db, &id).await, armed);

            let ended_at = at + 2 * SEC;
            let run_before = run(&db, &id).await;
            let incident_before = inc(&db, "inc-1").await;
            db.execute_unprepared(
                "CREATE TRIGGER reject_settlement BEFORE UPDATE ON rca_delivery_obligations \
                 BEGIN SELECT RAISE(ABORT, 'settlement rejected'); END",
            )
            .await
            .unwrap();
            assert!(
                update_run_with(&db, ORG, &id, finish_update(state, ended_at))
                    .await
                    .is_err()
            );
            assert_eq!(run(&db, &id).await, run_before);
            assert_eq!(inc(&db, "inc-1").await, incident_before);
            assert_eq!(obligations(&db, &id).await, armed);
            db.execute_unprepared("DROP TRIGGER reject_settlement")
                .await
                .unwrap();

            finish(&db, &id, state, ended_at).await;
            let due = obligations(&db, &id).await;
            assert_eq!(due.len(), 2);
            for row in due {
                assert_eq!(row.state, "pending");
                assert_eq!(row.kind.as_deref(), Some(kind));
                assert_eq!(row.next_attempt_at, ended_at);
                assert_eq!(row.updated_at, ended_at);
                assert_eq!(row.created_at, at);
                assert_eq!(row.attempts, 0);
            }
        }
    }

    #[tokio::test]
    async fn a_completing_run_that_read_history_is_withheld_once_its_incident_is_a_case() {
        let db = db().await;
        for (id, security_case, fenced, withhold_if_case, partial_result, expected) in [
            ("case", true, false, true, false, RunState::Failed),
            ("fenced-case", true, true, true, false, RunState::Failed),
            ("fenced", false, true, true, false, RunState::Failed),
            (
                "case-without-history",
                true,
                false,
                false,
                false,
                RunState::Completed,
            ),
            (
                "fenced-without-history",
                true,
                true,
                false,
                false,
                RunState::Completed,
            ),
            ("ordinary", false, false, true, false, RunState::Completed),
            (
                "case-with-partial-result",
                true,
                false,
                true,
                true,
                RunState::Failed,
            ),
        ] {
            incident(&db, id).await;
            let new = with_recipients(
                new_run(RunSubjectType::Incident, id),
                vec![recipient(id, "alert-1", 1)],
            );
            let run_id = started_id(
                start_run_with(&db, new, guards(T0), None, None)
                    .await
                    .unwrap(),
            );
            let result = serde_json::json!({"schema_version": 1, "ledger": {}});
            if partial_result {
                let upd = RunUpdate {
                    final_stats_only: true,
                    result: Some(result.clone()),
                    ..update(None, T0 + SEC / 2)
                };
                assert!(update_run_with(&db, ORG, &run_id, upd).await.unwrap());
            }
            alert_incidents::Entity::update_many()
                .col_expr(
                    alert_incidents::Column::SecurityCase,
                    Expr::value(security_case),
                )
                .filter(alert_incidents::Column::Id.eq(id))
                .exec(&db)
                .await
                .unwrap();
            rca_runs::Entity::update_many()
                .col_expr(rca_runs::Column::Fenced, Expr::value(fenced))
                .filter(rca_runs::Column::RunId.eq(run_id.as_str()))
                .exec(&db)
                .await
                .unwrap();
            let upd = RunUpdate {
                withhold_if_case,
                result: Some(result.clone()),
                ..finish_update(RunState::Completed, T0 + SEC)
            };
            assert!(
                update_run_with(&db, ORG, &run_id, upd).await.unwrap(),
                "{id}"
            );
            let stored = assert_summary_mirrors_run(&db, id).await;
            assert_eq!(stored.state, expected.as_str(), "{id}");
            assert_eq!(stored.ended_at, Some(T0 + SEC));
            let kind = if expected == RunState::Failed {
                assert_eq!(
                    error_of(&stored).unwrap().code,
                    "security_case_reclassified"
                );
                assert_eq!(stored.report, None);
                assert_eq!(stored.outcome, None);
                assert_eq!(stored.confidence, None);
                assert_eq!(stored.result, None);
                "no_verdict"
            } else {
                assert!(stored.report.is_some());
                assert_eq!(stored.outcome.as_deref(), Some("root_cause"));
                assert_eq!(
                    decode::<serde_json::Value>(stored.result.as_deref()),
                    Some(result)
                );
                assert_eq!(stored.error, None);
                "verdict"
            };
            let rows = obligations(&db, &run_id).await;
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].state, "pending");
            assert_eq!(rows[0].kind.as_deref(), Some(kind));
        }
    }

    #[test]
    fn firing_scope_ignores_order_and_duplicates() {
        let first = SubjectRef::new(SubjectType::Alert, "alert-1", 1);
        let second = SubjectRef::new(SubjectType::Alert, "alert-1", 2);
        let scope = firing_scope(&[first.clone(), second.clone(), first.clone()]);
        assert!(!scope.is_empty());
        assert_eq!(
            scope,
            firing_scope(&[second.clone(), first.clone(), second.clone()])
        );
        assert_eq!(firing_scope(&[]), "");
        assert_ne!(scope, firing_scope(std::slice::from_ref(&first)));
        assert_ne!(
            firing_scope(std::slice::from_ref(&first)),
            firing_scope(std::slice::from_ref(&second))
        );
    }

    #[tokio::test]
    async fn to_item_reads_the_stored_region_and_run_number() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let mut new = new_run(RunSubjectType::Incident, "inc-1");
        new.context_used = Some(serde_json::json!({"serving_region": "us-east-1"}));
        let id = started_id(
            start_run_with(&db, new, guards(T0), None, None)
                .await
                .unwrap(),
        );
        let mut row = run(&db, &id).await.unwrap();
        row.run_number = Some(7);
        let item = to_item(&row);
        assert_eq!(item.serving_region.as_deref(), Some("us-east-1"));
        assert_eq!(item.run_number, Some(7));

        for context in [
            Some(serde_json::json!({"serving_region": ""})),
            Some(serde_json::json!({"serving_region": 42})),
            Some(serde_json::json!({})),
            None,
        ] {
            row.context_used = context.map(|value| value.to_string());
            let item = to_item(&row);
            assert_eq!(item.serving_region, None);
            assert_eq!(item.run_number, Some(7));
        }
        row.run_number = None;
        assert_eq!(to_item(&row).run_number, None);
    }

    #[tokio::test]
    async fn a_new_writer_refuses_against_a_row_an_old_writer_inserted() {
        let db = db().await;
        for (alert_id, state, ended_at) in [
            ("alert-live", RunState::Running, None),
            ("alert-completed", RunState::Completed, Some(T0 + SEC)),
            ("alert-no-end", RunState::Failed, None),
        ] {
            alert_row(&db, alert_id).await;
            let recipient = recipient(alert_id, alert_id, 1);
            let old_id = new_run_id();
            let old = rca_runs::ActiveModel {
                run_id: Set(old_id.clone()),
                org_id: Set(ORG.to_string()),
                subject_type: Set(RunSubjectType::Alert.as_str().to_string()),
                subject_id: Set(alert_id.to_string()),
                incident_id: Set(None),
                trigger: Set(RunTrigger::OncallPage.as_str().to_string()),
                mode: Set(RunMode::Fresh.as_str().to_string()),
                started_by: Set("system".to_string()),
                guidance: Set(None),
                state: Set(state.as_str().to_string()),
                started_at: Set(T0),
                updated_at: Set(ended_at.unwrap_or(T0)),
                ended_at: Set(ended_at),
                cancelled_by: Set(None),
                outcome: Set(None),
                confidence: Set(None),
                report: Set(None),
                result: Set(None),
                error: Set(None),
                session_id: Set(None),
                stats: Set(None),
                stage: Set(None),
                stage_index: Set(None),
                context_used: Set(None),
                continuations: Set(0),
                oncall_subjects: Set(Some(
                    serde_json::to_string(std::slice::from_ref(&recipient.subject)).unwrap(),
                )),
                input_deadline_at: Set(None),
                pending_question_id: Set(None),
                questions_asked: Set(0),
                deadline_closed_at: Set(None),
                run_number: Set(None),
                fenced: Set(false),
            }
            .insert(&db)
            .await
            .unwrap();
            assert_eq!(to_item(&old).run_number, None);

            let refused = start_run_with(
                &db,
                paging_run(alert_id, vec![recipient]),
                paging_guards(T0 + 2 * SEC),
                None,
                None,
            )
            .await
            .unwrap();
            if state == RunState::Running {
                assert!(matches!(
                    refused,
                    StartResult::InFlight { covering_run_id } if covering_run_id == old_id
                ));
            } else {
                assert!(matches!(
                    refused,
                    StartResult::CoolingDown { covering_run_id, retry_after_us }
                        if covering_run_id == old_id
                            && retry_after_us == ended_at.unwrap_or(T0) + COOLDOWN
                ));
            }
            assert_eq!(runs_of(&db, alert_id).await.len(), 1);
        }
    }
}

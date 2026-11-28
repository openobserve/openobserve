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

use config::meta::alerts::{
    incidents::{IncidentEvent, IncidentEventType},
    rca_runs::{
        RcaRun, RcaRunItem, RcaSummary, ReportFormat, RunError, RunMode, RunState, RunStats,
        RunSubjectType, RunSummaryFields, RunTrigger, SkipReason, is_live_blocking, is_stale,
        is_v1_run_id, next_previous,
    },
    rca_steering::SteerRecord,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseTransaction, DbErr,
    EntityTrait, FromQueryResult, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select, Set,
    TransactionTrait,
    sea_query::{Expr, LockType},
};
use svix_ksuid::KsuidLike;

use super::{
    alert_incidents::CaseFilter,
    entity::{alert_incident_alerts, alert_incidents, rca_runs},
    incident_events,
    rca_delivery_obligations::{self, Obligation, ObligationKind, Recipient},
    rca_skipped_pages::{self, NewSkippedPage},
    rca_steering,
};
pub use super::{
    entity::rca_runs::Model,
    rca_fence::{RECLASSIFIED_ERROR_CODE, RECLASSIFIED_ERROR_REASON},
};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

/// `error.code` of a run that stopped writing.
pub const STALE_ERROR_CODE: &str = "stale";
/// `error.reason` of a stale run.
pub const STALE_ERROR_REASON: &str = "The analysis stopped responding";

/// Steering users kept in the run summary, newest first.
const STEERED_BY_MAX: usize = 3;
/// Rows [list_for_org] reads per query.
const ORG_SCAN_BATCH: u64 = 200;
/// Rows [list_for_org] reads per page at most, however few `keep` admits.
const ORG_SCAN_MAX: usize = 5_000;
/// Skipped pages a subject keeps per run of its history limit.
const SKIPPED_PAGES_PER_HISTORY_RUN: usize = 4;

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
    /// One delivery obligation is armed per recipient in the start transaction (I6).
    pub recipients: Vec<Recipient>,
    /// The page that asked for the run; a refused page without one is keyed by its refusal time.
    pub page_key: Option<String>,
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
    /// Refused once the incident has any run: a decision made on an incident never analysed.
    pub first_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartResult {
    Started {
        run_id: String,
        replaced_stale: Option<RunTrigger>,
        /// The id of that stale run, so the caller closes its steering rows.
        replaced_run_id: Option<String>,
    },
    /// The latest run is live and not stale, or a concurrent start won.
    InFlight,
    /// The newest completed run ended within the cooldown.
    CoolingDown,
}

/// Why a start was refused, and the run that covers it.
struct Refusal {
    reason: SkipReason,
    covering_run_id: Option<String>,
    retry_after_us: Option<i64>,
}

impl Refusal {
    fn in_flight(covering_run_id: Option<String>) -> Self {
        Self {
            reason: SkipReason::InFlight,
            covering_run_id,
            retry_after_us: None,
        }
    }

    fn result(&self) -> StartResult {
        match self.reason {
            SkipReason::InFlight => StartResult::InFlight,
            SkipReason::CoolingDown => StartResult::CoolingDown,
        }
    }
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
    pub withhold_if_case: bool,
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
    pub now_us: i64,
    /// The incident's status episode the write belongs to; it loses once the incident left it.
    pub episode: Option<crate::table::alert_incidents::Episode>,
}

pub struct RunApplied {
    pub obligations: Vec<Obligation>,
    pub event: Option<IncidentEvent>,
    pub fenced: bool,
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

/// Narrows [list_for_org]; an empty list admits every state or trigger.
#[derive(Debug, Clone, Default)]
pub struct OrgRunsFilter<'a> {
    pub states: Vec<&'static str>,
    pub triggers: Vec<&'static str>,
    /// Only runs started at or after this time (µs).
    pub since: Option<i64>,
    /// Only runs older than this one: the previous page's `next_before`.
    pub before: Option<&'a str>,
    pub limit: u64,
    /// Which incidents' runs the caller may see; anything but `All` drops runs of deleted
    /// incidents.
    pub cases: CaseFilter,
}

/// A run of [list_for_org] with its incident's title and severity, when the incident exists.
#[derive(Debug, Clone)]
pub struct OrgRun {
    pub run: Model,
    pub incident_title: Option<String>,
    pub severity: Option<String>,
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

/// A new run id: a KSUID, so ids sort by time.
pub fn new_run_id() -> String {
    svix_ksuid::Ksuid::new(None, None).to_string()
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
        // A start since the caller's decision is the concurrent start that won.
        let started_since = match guards.latest_run_id {
            Some(latest) => seen.rca_run_id.as_deref() != Some(latest),
            None => guards.first_run && seen.rca_run_id.is_some(),
        };
        if started_since {
            return refuse(txn, &new, &guards, Refusal::in_flight(seen.rca_run_id)).await;
        }
        if seen_state.is_some_and(|state| {
            is_live_blocking(state, seen_updated_at, now, guards.rca_timeout_secs)
        }) {
            return refuse(txn, &new, &guards, Refusal::in_flight(seen.rca_run_id)).await;
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
                let refusal = Refusal {
                    reason: SkipReason::CoolingDown,
                    covering_run_id: Some(run.run_id),
                    retry_after_us: Some(ended_at.saturating_add(cooldown)),
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
            return Ok(StartResult::InFlight);
        }

        // The replaced run stopped writing; end it in this transaction.
        if let Some(seen_run_id) = seen.rca_run_id.as_deref()
            && seen_state
                .is_some_and(|state| is_stale(state, seen_updated_at, now, guards.rca_timeout_secs))
        {
            replaced_stale = fail_stale_with(&txn, &new.org_id, seen_run_id, now).await?;
            replaced_run_id = replaced_stale.is_some().then(|| seen_run_id.to_string());
        }
    }

    let run_number = next_run_number(&txn, &new.org_id, new.subject_type, &new.subject_id).await?;
    let mut used = new
        .context_used
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    if used.get("history_read").is_none() {
        used["history_read"] = serde_json::Value::Bool(false);
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
        stage: Set(None),
        stage_index: Set(None),
        context_used: Set(Some(encode(&used, "context_used")?)),
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

/// A refused start: its skipped pages and their events commit together, or none do; a failed
/// record never changes the refusal, so the caller keeps the page's hold for the covering run.
async fn refuse(
    txn: DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
    refusal: Refusal,
) -> Result<StartResult, DbErr> {
    let recorded = match record_skipped_pages(&txn, new, guards, &refusal).await {
        Ok(true) => txn.commit().await,
        Ok(false) => {
            if let Err(error) = txn.rollback().await {
                log::warn!(
                    "[RCA_RUNS] rollback with no skipped pages to record for {}/{}: {error}",
                    new.org_id,
                    new.subject_id
                );
            }
            return Ok(refusal.result());
        }
        Err(error) => {
            if let Err(rollback) = txn.rollback().await {
                log::warn!(
                    "[RCA_RUNS] rollback after a failed skipped-page record for {}/{}: {rollback}",
                    new.org_id,
                    new.subject_id
                );
            }
            Err(error)
        }
    };
    if let Err(error) = recorded {
        log::warn!(
            "[RCA_RUNS] refused {} start for {}/{} recorded no skipped page: {error}",
            new.trigger.as_str(),
            new.org_id,
            new.subject_id
        );
        config::metrics::oncall::skipped_page_unrecorded(&new.org_id);
    }
    Ok(refusal.result())
}

/// Writes the refusal's skipped pages and their events; `false` when there is nothing to record.
async fn record_skipped_pages(
    txn: &DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
    refusal: &Refusal,
) -> Result<bool, DbErr> {
    let pages = skipped_pages(txn, new, guards, refusal).await?;
    if pages.is_empty() {
        return Ok(false);
    }
    let stored = rca_skipped_pages::insert_in(txn, &pages).await?;
    // `prune_with` runs only on a start, so sustained refusals keep the cap here.
    rca_skipped_pages::retain_newest_in(
        txn,
        &new.org_id,
        new.subject_type,
        &new.subject_id,
        skipped_page_cap(guards.history_limit),
    )
    .await?;
    if new.subject_type == RunSubjectType::Incident {
        for page in stored {
            let event = IncidentEvent {
                timestamp: page.at_us,
                seq: 0,
                event_type: IncidentEventType::AnalysisSkipped {
                    response_id: page.response_id.clone(),
                    reason: page.reason,
                    covering_run_id: page.covering_run_id.clone(),
                    covering_run_number: page.covering_run_number,
                    retry_after_us: page.retry_after_us,
                },
            };
            incident_events::append_in(txn, &new.org_id, &new.subject_id, event).await?;
        }
    }
    Ok(true)
}

/// One skipped page per recipient of a page that asked for a run; manual, Slack, resume and
/// new-incident starts write none.
async fn skipped_pages(
    txn: &DatabaseTransaction,
    new: &NewRun,
    guards: &StartGuards<'_>,
    refusal: &Refusal,
) -> Result<Vec<NewSkippedPage>, DbErr> {
    let pages_reach_admission = matches!(
        new.trigger,
        RunTrigger::AutoNewAlertType | RunTrigger::AutoReopen
    );
    let Some(covering_run_id) = refusal
        .covering_run_id
        .as_deref()
        .filter(|id| !id.is_empty())
    else {
        return Ok(Vec::new());
    };
    if !pages_reach_admission || new.recipients.is_empty() {
        return Ok(Vec::new());
    }
    let covering_run_number = run_number_of(txn, &new.org_id, covering_run_id).await?;
    // A page with no key (a Reopen) is keyed by its refusal time, so two refusals never collapse.
    let firing_key = match new.page_key.as_deref() {
        Some(key) => format!("{}|{key}", new.trigger.as_str()),
        None => format!("{}|{}", new.trigger.as_str(), guards.now_us),
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
            reason: refusal.reason,
            covering_run_id: covering_run_id.to_string(),
            covering_run_number,
            retry_after_us: refusal.retry_after_us,
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

/// `max + 1` of the subject's numbered runs. An incident start already holds the incident row;
/// an alert start has no row to lock, so Postgres serializes the subject with an advisory lock.
async fn next_run_number(
    txn: &DatabaseTransaction,
    org_id: &str,
    subject_type: RunSubjectType,
    subject_id: &str,
) -> Result<i32, DbErr> {
    crate::race_point!("rca_runs.before_run_number");
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Postgres {
        let key = format!(
            "rca_run_number|{org_id}|{}|{subject_id}",
            subject_type.as_str()
        );
        txn.execute(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [key.into()],
        ))
        .await?;
    }
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
    // A pruned run's steering rows and settled obligations go with it; a pending one still owes
    // its record a release, which ENT delivers as no verdict once the run is gone.
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
        // The cost prices the calls the tokens count, so new tokens without a cost leave it
        // unknown.
        if p.tokens.is_some() {
            stats.tokens = p.tokens.clone();
            stats.credits = p.credits;
        } else if p.credits.is_some() {
            stats.credits = p.credits;
        }
        if p.model.is_some() {
            stats.model = p.model.clone();
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

/// [`update_run`] returning `None` on a lost guard, else the obligations a terminal write settled.
pub async fn update_run_owing(
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<Option<Vec<Obligation>>, DbErr> {
    update_run_owing_with(get_orm_client_rw().await, org_id, run_id, upd).await
}

/// Lock incident before run; recheck state guards inside the transaction.
pub async fn update_run_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<bool, DbErr> {
    Ok(update_run_owing_with(db, org_id, run_id, upd)
        .await?
        .is_some())
}

/// [`update_run_with`]; the owed set is read in the ending transaction, so no later read decides
/// it.
pub async fn update_run_owing_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<Option<Vec<Obligation>>, DbErr> {
    Ok(update_run_applied_with(db, org_id, run_id, upd)
        .await?
        .map(|applied| applied.obligations))
}

pub async fn update_run_applied_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: RunUpdate,
) -> Result<Option<RunApplied>, DbErr> {
    if upd.final_stats_only {
        return Ok(final_stats_with(db, org_id, run_id, &upd)
            .await?
            .then(|| RunApplied {
                obligations: Vec::new(),
                event: None,
                fenced: false,
            }));
    }
    crate::race_point!("rca_fence.before_begin");
    let txn = db.begin().await?;
    let now = upd.now_us;
    let from: Vec<_> = allowed_from(upd.state)
        .iter()
        .copied()
        .filter(|state| upd.expected_state.is_none_or(|expected| expected == *state))
        .collect();
    let allowed = |state: &str| RunState::from_str(state).is_ok_and(|s| from.contains(&s));

    let Some(held) = super::rca_fence::lock_run(&txn, org_id, run_id).await? else {
        txn.rollback().await?;
        return Ok(None);
    };
    if !allowed(&held.run.state) {
        txn.rollback().await?;
        return Ok(None);
    }
    let (upd, fenced) = super::rca_fence::apply(&held, upd);
    let incident = if held.run.subject_type == RunSubjectType::Incident.as_str() {
        let Some(stored) = held.incident.as_ref().filter(|incident| {
            incident.rca_run_id.as_deref() == Some(run_id)
                && upd.episode.as_ref().is_none_or(|episode| {
                    episode.status == incident.status && episode.resolved_at == incident.resolved_at
                })
        }) else {
            txn.rollback().await?;
            return Ok(None);
        };
        // PostgreSQL pads the `char(27)` id; the run's own copy matches the bound filter.
        Some((
            held.run.subject_id.clone(),
            merge_summary(decode_summary(stored.rca_summary.as_deref()), &upd),
        ))
    } else {
        None
    };
    let started_at = held.run.started_at;
    let stored_stats = held.run.stats.clone();

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
        return Ok(None);
    }

    let mut stored_event = None;
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
            return Ok(None);
        }

        if let Some(event) = upd.event {
            incident_events::append_in(&txn, org_id, &incident_id, event.clone()).await?;
            stored_event = Some(event);
        }
    }

    // The deliveries this run owes become due in the transaction that ends it.
    let mut owed = Vec::new();
    if let Some(state) = upd.state.filter(|s| s.is_terminal()) {
        let kind = if state == RunState::Completed {
            ObligationKind::Verdict
        } else {
            ObligationKind::NoVerdict
        };
        if rca_delivery_obligations::settle_in(&txn, org_id, run_id, kind, now).await? > 0 {
            owed = rca_delivery_obligations::for_run_in(&txn, org_id, run_id).await?;
        }
    }

    txn.commit().await?;
    Ok(Some(RunApplied {
        obligations: owed,
        event: stored_event,
        fenced,
    }))
}

/// Stats-only writes preserve terminal state and never overwrite a stored result.
async fn final_stats_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    run_id: &str,
    upd: &RunUpdate,
) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    let Some(held) = super::rca_fence::lock_run(&txn, org_id, run_id).await? else {
        txn.rollback().await?;
        return Ok(false);
    };
    let (upd, _) = super::rca_fence::apply(&held, upd.clone());
    let stored_stats = held.run.stats.clone();
    let stored_result = held.run.result.clone();
    let state = held.run.state.clone();
    if held.run.subject_type == RunSubjectType::Incident.as_str()
        && let Some(incident) = held
            .incident
            .as_ref()
            .filter(|row| row.rca_run_id.as_deref() == Some(run_id))
    {
        let mut counts = upd.clone();
        counts.state = None;
        counts.error = None;
        if let Some(summary) = counts.summary.as_mut() {
            summary.detail = None;
            summary.deadline_at = None;
        }
        let summary = merge_summary(decode_summary(incident.rca_summary.as_deref()), &counts);
        alert_incidents::Entity::update_many()
            .col_expr(
                alert_incidents::Column::RcaSummary,
                Expr::value(encode(&summary, "rca_summary")?),
            )
            .filter(alert_incidents::Column::Id.eq(held.run.subject_id.as_str()))
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::RcaRunId.eq(run_id))
            .exec(&txn)
            .await?;
    }
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
    if let Some(used) = upd.context_used.as_ref() {
        update = update.col_expr(
            rca_runs::Column::ContextUsed,
            Expr::value(encode(used, "context_used")?),
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

pub async fn live_run_for_session(org_id: &str, session_id: &str) -> Result<Option<Model>, DbErr> {
    let mut runs = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::SessionId.eq(session_id))
        .filter(rca_runs::Column::State.is_in(["running", "waiting_input"]))
        .limit(2)
        .all(get_orm_client_rw().await)
        .await?;
    Ok(if runs.len() == 1 { runs.pop() } else { None })
}

/// One run.
pub async fn get(org_id: &str, run_id: &str) -> Result<Option<Model>, DbErr> {
    get_with(get_orm_client_ro().await, org_id, run_id).await
}

/// [get] on the primary, for a write path that must see a run committed just before.
pub async fn get_rw(org_id: &str, run_id: &str) -> Result<Option<Model>, DbErr> {
    get_with(get_orm_client_rw().await, org_id, run_id).await
}

pub async fn get_with<C: ConnectionTrait>(
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

/// The org's incident runs, newest first, that `filter` and then `keep` admit, with the cursor
/// to read on from while more may.
pub async fn list_for_org(
    org_id: &str,
    filter: &OrgRunsFilter<'_>,
    keep: impl Fn(&Model) -> bool,
) -> Result<(Vec<OrgRun>, Option<String>), DbErr> {
    list_for_org_with(get_orm_client_ro().await, org_id, filter, keep).await
}

/// [list_for_org] on a given connection.
pub async fn list_for_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    filter: &OrgRunsFilter<'_>,
    keep: impl Fn(&Model) -> bool,
) -> Result<(Vec<OrgRun>, Option<String>), DbErr> {
    let mut cursor = match filter.before {
        Some(before) => match get_with(conn, org_id, before).await? {
            Some(run) => Some((run.started_at, run.run_id)),
            None => return Ok((Vec::new(), None)),
        },
        None => None,
    };
    let limit = usize::try_from(filter.limit.max(1)).unwrap_or(usize::MAX);
    let mut kept: Vec<Model> = Vec::new();
    let mut scanned = 0;
    let next_before = loop {
        let batch = org_runs_query(org_id, filter, cursor.as_ref())
            .limit(ORG_SCAN_BATCH)
            .all(conn)
            .await?;
        let exhausted = (batch.len() as u64) < ORG_SCAN_BATCH;
        scanned += batch.len();
        cursor = batch.last().map(|run| (run.started_at, run.run_id.clone()));
        let mut admitted = batch.into_iter().filter(|run| keep(run));
        kept.extend(admitted.by_ref().take(limit - kept.len()));
        if admitted.next().is_some() {
            break kept.last().map(|run| run.run_id.clone());
        }
        if exhausted {
            break None;
        }
        if scanned >= ORG_SCAN_MAX {
            // Resuming past the last scanned row, not the last kept one, reaches older matches.
            log::warn!("[RCA_RUNS] org {org_id}: run list page stopped after {scanned} rows");
            break cursor.as_ref().map(|(_, run_id)| run_id.clone());
        }
    };
    let details = incident_details(conn, org_id, &kept).await?;
    let runs = kept
        .into_iter()
        .map(|run| {
            let (incident_title, severity) = run
                .incident_id
                .as_ref()
                .and_then(|id| details.get(id).cloned())
                .unwrap_or_default();
            OrgRun {
                run,
                incident_title,
                severity,
            }
        })
        .collect();
    Ok((runs, next_before))
}

/// [list_for_org]'s SQL part, ordered (started_at, run_id) descending, past `cursor`.
fn org_runs_query(
    org_id: &str,
    filter: &OrgRunsFilter<'_>,
    cursor: Option<&(i64, String)>,
) -> Select<rca_runs::Entity> {
    let mut query = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::IncidentId.is_not_null());
    if !filter.states.is_empty() {
        query = query.filter(rca_runs::Column::State.is_in(filter.states.iter().copied()));
    }
    if !filter.triggers.is_empty() {
        query = query.filter(rca_runs::Column::Trigger.is_in(filter.triggers.iter().copied()));
    }
    if let Some(since) = filter.since {
        query = query.filter(rca_runs::Column::StartedAt.gte(since));
    }
    let is_case = match filter.cases {
        CaseFilter::All => None,
        CaseFilter::OnlyCases => Some(true),
        CaseFilter::NoCases => Some(false),
    };
    if let Some(is_case) = is_case {
        let incidents = alert_incidents::Entity::find()
            .select_only()
            .column(alert_incidents::Column::Id)
            .filter(alert_incidents::Column::OrgId.eq(org_id))
            .filter(alert_incidents::Column::SecurityCase.eq(is_case))
            .into_query();
        query = query.filter(rca_runs::Column::IncidentId.in_subquery(incidents));
    }
    if let Some((started_at, run_id)) = cursor {
        query = query.filter(
            Condition::any()
                .add(rca_runs::Column::StartedAt.lt(*started_at))
                .add(
                    Condition::all()
                        .add(rca_runs::Column::StartedAt.eq(*started_at))
                        .add(rca_runs::Column::RunId.lt(run_id.as_str())),
                ),
        );
    }
    query
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
}

/// `(title, severity)` per incident of `runs`, in one read.
async fn incident_details<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    runs: &[Model],
) -> Result<std::collections::HashMap<String, (Option<String>, Option<String>)>, DbErr> {
    let mut ids: Vec<String> = runs.iter().filter_map(|r| r.incident_id.clone()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let rows = alert_incidents::Entity::find()
        .select_only()
        .column(alert_incidents::Column::Id)
        .column(alert_incidents::Column::Title)
        .column(alert_incidents::Column::Severity)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Id.is_in(ids))
        .into_tuple::<(String, Option<String>, String)>()
        .all(conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, severity)| (id, (title, Some(severity))))
        .collect())
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

/// The newest completed incident runs, re-checks left out, of the incidents the alert fired into;
/// read on the primary, so a run that just completed is never skipped.
pub async fn full_runs_for_alert(
    org_id: &str,
    alert_id: &str,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    let holding = sea_orm::sea_query::Query::select()
        .column(alert_incident_alerts::Column::IncidentId)
        .from(alert_incident_alerts::Entity)
        .and_where(alert_incident_alerts::Column::AlertId.eq(alert_id))
        .to_owned();
    rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .filter(rca_runs::Column::SubjectType.eq(RunSubjectType::Incident.as_str()))
        .filter(rca_runs::Column::State.eq(RunState::Completed.as_str()))
        .filter(rca_runs::Column::Mode.ne(RunMode::Recheck.as_str()))
        .filter(rca_runs::Column::IncidentId.in_subquery(holding))
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .limit(limit.max(1))
        .all(get_orm_client_rw().await)
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
pub fn to_run(mut m: Model) -> RcaRun {
    let fenced = super::rca_fence::row_fenced(&m);
    if fenced {
        m.report = None;
        m.outcome = None;
        m.confidence = None;
        m.result = None;
        m.pending_question_id = None;
    }
    let state = state_of(&m);
    let mut error = error_of(&m);
    if fenced && let Some(error) = error.as_mut() {
        error.details = None;
    }
    let stats = decode(m.stats.as_deref());
    let mut context_used = decode::<serde_json::Value>(m.context_used.as_deref());
    if let Some(used) = context_used
        .as_mut()
        .and_then(serde_json::Value::as_object_mut)
    {
        used.remove("history_read");
        used.remove("history_injected");
        if fenced {
            used.remove("past_causes");
        }
        if used.is_empty() {
            context_used = None;
        }
    }
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
        context_used,
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
    use config::meta::alerts::{
        incidents::{AnalysisTriggerType, IncidentEventType},
        rca_runs::PreviousResult,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::entity::{
        incident_events as events_entity, rca_skipped_pages as rca_skipped_entity,
    };

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
            schema.create_table_from_entity(crate::table::entity::rca_steering::Entity),
            schema.create_table_from_entity(crate::table::entity::rca_delivery_obligations::Entity),
            schema.create_table_from_entity(crate::table::entity::rca_skipped_pages::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        crate::table::migration::create_incident_recovery_checks_for_test(db)
            .await
            .unwrap();
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
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        events_entity::ActiveModel {
            org_id: Set(ORG.to_string()),
            incident_id: Set(id.to_string()),
            events: Set(serde_json::json!([])),
            seq: Set(0),
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
            page_key: None,
        }
    }

    fn guards(now_us: i64) -> StartGuards<'static> {
        StartGuards {
            now_us,
            rca_timeout_secs: TIMEOUT,
            cooldown_us: None,
            history_limit: 25,
            latest_run_id: None,
            first_run: false,
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
            None,
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
        assert!(results.contains(&StartResult::InFlight));
        assert_eq!(runs_of(&db, "inc-1").await.len(), 1);
        assert_eq!(event_types(&db, "inc-1").await.len(), 1);
    }

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
            None,
        )
        .await
        .unwrap();
        assert_eq!(early, StartResult::InFlight);

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
            None,
        )
        .await;
        assert!(started.is_err());
        assert!(runs_of(&db, "inc-2").await.is_empty());
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
        let mut live = Vec::new();
        for i in 0..3 {
            let new = new_run(RunSubjectType::Alert, "alert-1");
            live.push(new.run_id.clone());
            let started = start_run_with(&db, new, guards(T0 + i * SEC), None, None)
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

    #[test]
    fn new_tokens_replace_the_cost_and_a_cost_alone_sets_it() {
        let priced = r#"{"tokens": {"input": 1}, "credits": 0.5, "model": "a/m"}"#;
        let tokens = |credits| RunStats {
            tokens: Some(serde_json::json!({"input": 2})),
            credits,
            ..Default::default()
        };
        let cost_only = RunStats {
            credits: Some(0.0),
            ..Default::default()
        };
        let cases = [
            ("a later unpriced step", tokens(None), None),
            ("a later priced step", tokens(Some(0.75)), Some(0.75)),
            ("a write with no tokens", cost_only, Some(0.0)),
        ];
        for (name, patch, credits) in cases {
            let merged = merge_stats(Some(priced), Some(&patch), None);
            assert_eq!(merged.credits, credits, "{name}");
            assert_eq!(merged.model.as_deref(), Some("a/m"), "{name}");
        }
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
                decode::<serde_json::Value>(fresh.context_used.as_deref())
            ),
            (
                None,
                None,
                0,
                Some(serde_json::json!({"history_read": false}))
            )
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
        let mut kept = context.clone();
        kept["history_read"] = serde_json::Value::Bool(false);
        assert_eq!(decode(row.context_used.as_deref()), Some(kept));
        assert_eq!(row.continuations, 2);
        let item = to_run(row);
        assert_eq!(item.context_used, Some(context));
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
        assert_eq!(refused, StartResult::InFlight);
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
        assert_eq!(
            start_at(RunSubjectType::Incident, "inc-1", T0 + 60 * SEC).await,
            StartResult::InFlight
        );

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
        assert_eq!(
            start_at(RunSubjectType::Incident, "inc-w", T0 + 99_999 * SEC).await,
            StartResult::InFlight
        );
        assert_eq!(run(&db, &waiting).await.unwrap().state, "waiting_input");

        // Alert subjects take no compare-and-set: never a replacement.
        let a1 = start_at(RunSubjectType::Alert, "alert-1", T0).await;
        assert_eq!(replaced(&a1), None);
        let a2 = start_at(RunSubjectType::Alert, "alert-1", T0 + 99_999 * SEC).await;
        assert_eq!(replaced(&a2), None);
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

    /// A finished or live run row exactly as given, for the org-wide list.
    async fn org_row(
        db: &DatabaseConnection,
        run_id: &str,
        incident_id: Option<&str>,
        (state, trigger, code): (RunState, RunTrigger, Option<&str>),
        started_at: i64,
    ) {
        let error = code.map(|code| {
            serde_json::json!({"code": code, "reason": "r", "details": null, "trigger_type": null})
                .to_string()
        });
        rca_runs::ActiveModel::from(Model {
            run_id: run_id.to_string(),
            org_id: ORG.to_string(),
            subject_type: if incident_id.is_some() {
                "incident"
            } else {
                "alert"
            }
            .to_string(),
            subject_id: incident_id.unwrap_or("alert-1").to_string(),
            incident_id: incident_id.map(str::to_string),
            trigger: trigger.as_str().to_string(),
            mode: RunMode::Fresh.as_str().to_string(),
            started_by: "system".to_string(),
            guidance: None,
            state: state.as_str().to_string(),
            started_at,
            updated_at: started_at,
            ended_at: state.is_terminal().then_some(started_at + SEC),
            cancelled_by: None,
            outcome: None,
            confidence: None,
            report: None,
            result: None,
            error,
            session_id: None,
            stats: None,
            stage: None,
            stage_index: None,
            context_used: None,
            continuations: 0,
            oncall_subjects: None,
            input_deadline_at: None,
            pending_question_id: None,
            questions_asked: 0,
            deadline_closed_at: None,
            run_number: None,
            fenced: false,
        })
        .insert(db)
        .await
        .unwrap();
    }

    fn ids(runs: &[OrgRun]) -> Vec<&str> {
        runs.iter().map(|r| r.run.run_id.as_str()).collect()
    }

    #[tokio::test]
    async fn list_for_org_filters_by_state_trigger_and_since_newest_first() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let failed = (
            RunState::Failed,
            RunTrigger::AutoNewIncident,
            Some("agent_error"),
        );
        org_row(&db, "r1", Some("inc-1"), failed, T0).await;
        org_row(
            &db,
            "r2",
            Some("inc-1"),
            (RunState::Running, RunTrigger::AutoReopen, None),
            T0 + SEC,
        )
        .await;
        org_row(
            &db,
            "r3",
            Some("inc-1"),
            (RunState::Failed, RunTrigger::Manual, Some("x")),
            T0 + 2 * SEC,
        )
        .await;
        org_row(&db, "r4", Some("gone"), failed, T0 + 3 * SEC).await;
        org_row(&db, "r5", None, failed, T0 + 4 * SEC).await;
        let all = OrgRunsFilter {
            limit: 10,
            ..Default::default()
        };
        let (runs, more) = list_for_org_with(&db, ORG, &all, |_| true).await.unwrap();
        assert_eq!(
            ids(&runs),
            ["r4", "r3", "r2", "r1"],
            "alert runs have no incident to open"
        );
        assert_eq!(more, None);
        assert_eq!(runs[1].incident_title, None);
        assert_eq!(runs[1].severity.as_deref(), Some("P2"));
        assert_eq!(runs[0].severity, None, "a deleted incident has no details");

        let auto_failed = OrgRunsFilter {
            states: vec!["failed"],
            triggers: vec!["auto_new_incident", "auto_reopen"],
            since: Some(T0),
            limit: 10,
            ..Default::default()
        };
        let (runs, _) = list_for_org_with(&db, ORG, &auto_failed, |_| true)
            .await
            .unwrap();
        assert_eq!(ids(&runs), ["r4", "r1"]);
        let recent = OrgRunsFilter {
            since: Some(T0 + SEC),
            ..auto_failed.clone()
        };
        let (runs, _) = list_for_org_with(&db, ORG, &recent, |_| true)
            .await
            .unwrap();
        assert_eq!(ids(&runs), ["r4"]);
        let (runs, _) = list_for_org_with(&db, "other", &all, |_| true)
            .await
            .unwrap();
        assert!(runs.is_empty());
    }

    #[tokio::test]
    async fn list_for_org_pages_by_run_cursor_after_keep() {
        let db = db().await;
        let row = (RunState::Failed, RunTrigger::Manual, Some("x"));
        for i in 0..5 {
            org_row(&db, &format!("r{i}"), Some("inc-1"), row, T0 + i * SEC).await;
        }
        let odd = |run: &Model| run.run_id != "r2";
        let mut page = OrgRunsFilter {
            limit: 2,
            ..Default::default()
        };
        let (runs, more) = list_for_org_with(&db, ORG, &page, odd).await.unwrap();
        assert_eq!(ids(&runs), ["r4", "r3"]);
        assert_eq!(more.as_deref(), Some("r3"));
        page.before = more.as_deref();
        let (runs, more) = list_for_org_with(&db, ORG, &page, odd).await.unwrap();
        assert_eq!(
            ids(&runs),
            ["r1", "r0"],
            "keep skips r2 without ending the page"
        );
        assert_eq!(more, None);
        page.before = Some("unknown");
        let (runs, more) = list_for_org_with(&db, ORG, &page, odd).await.unwrap();
        assert!(runs.is_empty() && more.is_none());
    }

    #[tokio::test]
    async fn list_for_org_keeps_reading_past_a_batch_keep_rejects() {
        let db = db().await;
        let row = (RunState::Failed, RunTrigger::Manual, Some("x"));
        let total = ORG_SCAN_BATCH as i64 + 5;
        for i in 0..total {
            org_row(&db, &format!("r{i:04}"), Some("inc-1"), row, T0 + i * SEC).await;
        }
        let page = OrgRunsFilter {
            limit: 10,
            ..Default::default()
        };
        let oldest = |run: &Model| run.run_id == "r0000";
        let (runs, more) = list_for_org_with(&db, ORG, &page, oldest).await.unwrap();
        assert_eq!(ids(&runs), ["r0000"]);
        assert_eq!(more, None);
    }

    #[tokio::test]
    async fn list_for_org_resumes_past_a_scan_cap_that_kept_nothing() {
        let db = db().await;
        let row = (RunState::Failed, RunTrigger::Manual, Some("x"));
        let total = ORG_SCAN_MAX as i64 + 3;
        for i in 0..total {
            org_row(&db, &format!("r{i:05}"), Some("inc-1"), row, T0 + i * SEC).await;
        }
        let mut page = OrgRunsFilter {
            limit: 10,
            ..Default::default()
        };
        let oldest = |run: &Model| run.run_id == "r00000";
        let (runs, more) = list_for_org_with(&db, ORG, &page, oldest).await.unwrap();
        assert!(runs.is_empty());
        let cursor = more.expect("an older match remains, so the page says so");
        page.before = Some(&cursor);
        let (runs, more) = list_for_org_with(&db, ORG, &page, oldest).await.unwrap();
        assert_eq!(ids(&runs), ["r00000"]);
        assert_eq!(more, None);
    }

    #[tokio::test]
    async fn list_for_org_hides_security_case_runs_from_a_member_without_the_grant() {
        let db = db().await;
        incident(&db, "inc-ops").await;
        incident(&db, "inc-case").await;
        alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::SecurityCase, Expr::value(true))
            .filter(alert_incidents::Column::Id.eq("inc-case"))
            .exec(&db)
            .await
            .unwrap();
        let row = (RunState::Completed, RunTrigger::Manual, None);
        org_row(&db, "r-ops", Some("inc-ops"), row, T0).await;
        org_row(&db, "r-case", Some("inc-case"), row, T0 + SEC).await;
        org_row(&db, "r-gone", Some("gone"), row, T0 + 2 * SEC).await;
        let page = |cases| OrgRunsFilter {
            limit: 10,
            cases,
            ..Default::default()
        };
        let list = |cases| {
            let filter = page(cases);
            let db = &db;
            async move {
                let (runs, _) = list_for_org_with(db, ORG, &filter, |_| true).await.unwrap();
                runs.iter()
                    .map(|r| r.run.run_id.clone())
                    .collect::<Vec<_>>()
            }
        };
        assert_eq!(list(CaseFilter::All).await, ["r-gone", "r-case", "r-ops"]);
        assert_eq!(
            list(CaseFilter::NoCases).await,
            ["r-ops"],
            "a case's run, and a run whose incident is gone, stay hidden"
        );
        assert_eq!(list(CaseFilter::OnlyCases).await, ["r-case"]);
    }

    /// I6: the start arms one obligation per recipient with the run row, the terminal write
    /// settles and returns them, and a prune deletes a run's settled rows but keeps pending ones.
    #[tokio::test]
    async fn obligations_arm_with_the_start_settle_with_the_end_and_go_with_a_prune() {
        use config::meta::oncall::{SubjectRef, SubjectType};

        use crate::table::entity::rca_delivery_obligations as obligations;

        async fn rows(db: &DatabaseConnection, run_id: &str) -> Vec<(String, Option<String>)> {
            obligations::Entity::find()
                .filter(obligations::Column::RunId.eq(run_id))
                .order_by_asc(obligations::Column::ResponseId)
                .all(db)
                .await
                .unwrap()
                .into_iter()
                .map(|row| (row.state, row.kind))
                .collect()
        }
        async fn start_owing(db: &DatabaseConnection, responses: &[&str], now: i64) -> String {
            let mut new = new_run(RunSubjectType::Incident, "inc-1");
            new.recipients = responses
                .iter()
                .map(|id| Recipient {
                    response_id: id.to_string(),
                    subject: SubjectRef::new(SubjectType::Incident, "inc-1", 1),
                    ladder_run: 1,
                })
                .collect();
            match start_run_with(db, new, guards(now), None, None)
                .await
                .unwrap()
            {
                StartResult::Started { run_id, .. } => run_id,
                other => panic!("expected Started, got {other:?}"),
            }
        }
        let armed = ("armed".to_string(), None);
        let pending = |kind: &str| ("pending".to_string(), Some(kind.to_string()));

        let db = db().await;
        incident(&db, "inc-1").await;
        let completed = start_owing(&db, &["resp_1", "resp_2"], T0).await;
        assert_eq!(rows(&db, &completed).await, [armed.clone(), armed.clone()]);
        let owed = update_run_owing_with(
            &db,
            ORG,
            &completed,
            finish_update(RunState::Completed, T0 + SEC),
        )
        .await
        .unwrap()
        .expect("the completion wins");
        let mut owed: Vec<_> = owed.into_iter().map(|o| o.response_id).collect();
        owed.sort();
        assert_eq!(owed, ["resp_1", "resp_2"]);
        assert_eq!(
            rows(&db, &completed).await,
            [pending("verdict"), pending("verdict")]
        );
        let again = update_run_owing_with(
            &db,
            ORG,
            &completed,
            finish_update(RunState::Completed, T0 + SEC),
        )
        .await
        .unwrap();
        assert!(again.is_none(), "a lost guard owes nothing");

        let failed = start_owing(&db, &["resp_3", "resp_4"], T0 + 2 * SEC).await;
        finish(&db, &failed, RunState::Failed, T0 + 3 * SEC).await;
        assert_eq!(
            rows(&db, &failed).await,
            [pending("no_verdict"), pending("no_verdict")]
        );
        obligations::Entity::update_many()
            .col_expr(obligations::Column::State, Expr::value("done"))
            .filter(obligations::Column::ResponseId.eq("resp_4"))
            .exec(&db)
            .await
            .unwrap();

        // Limit 0 keeps the new run and the newest completed one; the failed run is pruned.
        start_with_limit(&db, "inc-1", 0).await;
        assert!(run(&db, &failed).await.is_none());
        assert_eq!(rows(&db, &failed).await, [pending("no_verdict")]);
        assert_eq!(rows(&db, &completed).await.len(), 2);
    }

    fn keyed_page(trigger: RunTrigger, page_key: &str, responses: &[&str]) -> NewRun {
        NewRun {
            page_key: Some(page_key.to_string()),
            ..page_start(trigger, responses)
        }
    }

    /// An automatic page for `inc-1` with one recipient per response id.
    fn page_start(trigger: RunTrigger, responses: &[&str]) -> NewRun {
        use config::meta::oncall::{SubjectRef, SubjectType};

        let mut new = new_run(RunSubjectType::Incident, "inc-1");
        new.trigger = trigger;
        new.started_by = "system".to_string();
        new.recipients = responses
            .iter()
            .map(|id| Recipient {
                response_id: id.to_string(),
                subject: SubjectRef::new(SubjectType::Incident, "inc-1", 1),
                ladder_run: 1,
            })
            .collect();
        new
    }

    async fn skipped_rows(db: &DatabaseConnection) -> Vec<rca_skipped_entity::Model> {
        rca_skipped_entity::Entity::find()
            .order_by_asc(rca_skipped_entity::Column::ResponseId)
            .all(db)
            .await
            .unwrap()
    }

    fn skipped_events(events: Vec<IncidentEventType>) -> Vec<IncidentEventType> {
        events
            .into_iter()
            .filter(|e| matches!(e, IncidentEventType::AnalysisSkipped { .. }))
            .collect()
    }

    /// X07: an `in_flight` refusal of a new alert type's page writes its row and its event.
    #[tokio::test]
    async fn a_refused_page_writes_one_row_and_one_event_in_one_transaction() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let live = start(&db, "inc-1", T0).await;
        let refused = start_run_with(
            &db,
            keyed_page(RunTrigger::AutoNewAlertType, "alert_a", &["resp_1"]),
            guards(T0 + SEC),
            Some(IncidentEvent::ai_analysis_begin()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(refused, StartResult::InFlight);
        let rows = skipped_rows(&db).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].reason.as_str(), rows[0].covering_run_id.as_str()),
            ("in_flight", live.as_str())
        );
        assert_eq!(rows[0].covering_run_number, Some(1));
        assert_eq!(rows[0].response_id.as_deref(), Some("resp_1"));
        let events = skipped_events(event_types(&db, "inc-1").await);
        assert!(
            matches!(
                events.as_slice(),
                [IncidentEventType::AnalysisSkipped {
                    response_id: Some(response),
                    reason: SkipReason::InFlight,
                    covering_run_id,
                    covering_run_number: Some(1),
                    retry_after_us: None,
                }] if response == "resp_1" && *covering_run_id == live
            ),
            "{events:?}"
        );

        // The same page refused again by the same run stores nothing new.
        start_run_with(
            &db,
            keyed_page(RunTrigger::AutoNewAlertType, "alert_a", &["resp_1"]),
            guards(T0 + 2 * SEC),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(skipped_rows(&db).await.len(), 1);
        assert_eq!(skipped_events(event_types(&db, "inc-1").await).len(), 1);

        // A failed event append rolls the skipped row back, and the page stays refused.
        let unrecorded = || {
            config::metrics::oncall::ONCALL_SKIPPED_PAGES_UNRECORDED
                .with_label_values(&[ORG])
                .get()
        };
        let before = unrecorded();
        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();
        let failed = start_run_with(
            &db,
            page_start(RunTrigger::AutoReopen, &["resp_2"]),
            guards(T0 + 3 * SEC),
            None,
            None,
        )
        .await;
        assert!(matches!(failed, Ok(StartResult::InFlight)), "{failed:?}");
        assert_eq!(skipped_rows(&db).await.len(), 1);
        assert_eq!(unrecorded(), before + 1);
    }

    /// Two alert types and two Reopens refused by one live run are four pages, four rows and
    /// four events.
    #[tokio::test]
    async fn distinct_pages_refused_by_one_run_keep_their_own_rows_and_events() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let live = start(&db, "inc-1", T0).await;
        let pages = [
            keyed_page(RunTrigger::AutoNewAlertType, "alert_a", &["resp_1"]),
            keyed_page(RunTrigger::AutoNewAlertType, "alert_b", &["resp_1"]),
            page_start(RunTrigger::AutoReopen, &["resp_1"]),
            page_start(RunTrigger::AutoReopen, &["resp_1"]),
        ];
        for (at, page) in (1..).zip(pages) {
            let refused = start_run_with(&db, page, guards(T0 + at * SEC), None, None)
                .await
                .unwrap();
            assert_eq!(refused, StartResult::InFlight);
        }
        let rows = skipped_rows(&db).await;
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| row.covering_run_id == live));
        let mut times: Vec<i64> = rows.iter().map(|row| row.at_us).collect();
        times.sort_unstable();
        assert_eq!(times, [T0 + SEC, T0 + 2 * SEC, T0 + 3 * SEC, T0 + 4 * SEC]);
        assert_eq!(skipped_events(event_types(&db, "inc-1").await).len(), 4);
    }

    /// A `cooling_down` refusal names when the page may run: the covering run's end plus the
    /// cooldown.
    #[tokio::test]
    async fn a_cooling_down_page_carries_its_retry_time() {
        let db = db().await;
        incident(&db, "inc-1").await;
        let done = start(&db, "inc-1", T0).await;
        finish(&db, &done, RunState::Completed, T0 + 60 * SEC).await;
        let cooldown = 30 * 60 * SEC;
        let refused = start_run_with(
            &db,
            page_start(RunTrigger::AutoReopen, &["resp_1", "resp_2"]),
            StartGuards {
                cooldown_us: Some(cooldown),
                ..guards(T0 + 120 * SEC)
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(refused, StartResult::CoolingDown);
        let rows = skipped_rows(&db).await;
        assert_eq!(rows.len(), 2);
        for row in &rows {
            assert_eq!(row.reason, "cooling_down");
            assert_eq!(row.covering_run_id, done);
            assert_eq!(row.retry_after_us, Some(T0 + 60 * SEC + cooldown));
            assert_eq!(row.cooldown_us, Some(cooldown));
        }
        let events = skipped_events(event_types(&db, "inc-1").await);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| matches!(
            e,
            IncidentEventType::AnalysisSkipped { retry_after_us: Some(at), .. }
                if *at == T0 + 60 * SEC + cooldown
        )));
    }

    /// User, Slack (`manual`) and new-incident starts never reach page admission: none written.
    #[tokio::test]
    async fn starts_that_are_not_pages_write_no_skipped_page() {
        let db = db().await;
        incident(&db, "inc-1").await;
        start(&db, "inc-1", T0).await;
        for trigger in [
            RunTrigger::Manual,
            RunTrigger::Reanalyze,
            RunTrigger::AutoNewIncident,
            RunTrigger::EvidenceSettled,
        ] {
            let refused = start_run_with(
                &db,
                page_start(trigger, &["resp_1"]),
                guards(T0 + SEC),
                None,
                None,
            )
            .await
            .unwrap();
            assert_eq!(refused, StartResult::InFlight, "{trigger}");
        }
        assert!(skipped_rows(&db).await.is_empty());
        assert!(skipped_events(event_types(&db, "inc-1").await).is_empty());
    }

    /// X09: each subject numbers its own runs from 1, and a number never changes.
    #[tokio::test]
    async fn runs_are_numbered_per_subject_and_keep_their_number() {
        let db = db().await;
        incident(&db, "inc-1").await;
        incident(&db, "inc-2").await;
        let mut numbered = Vec::new();
        for at in 0..3 {
            let run_id = start(&db, "inc-1", T0 + at * 60 * SEC).await;
            finish(&db, &run_id, RunState::Completed, T0 + at * 60 * SEC + SEC).await;
            numbered.push(run_id);
        }
        let other = start(&db, "inc-2", T0).await;
        let mut numbers = Vec::new();
        for id in &numbered {
            numbers.push(run(&db, id).await.unwrap().run_number);
        }
        assert_eq!(numbers, [Some(1), Some(2), Some(3)]);
        assert_eq!(run(&db, &other).await.unwrap().run_number, Some(1));
        let item = to_item(&run(&db, &numbered[1]).await.unwrap());
        assert_eq!(item.run_number, Some(2));
    }

    /// X09 race: two alert starts at once get distinct, gap-free numbers on either store.
    #[tokio::test]
    async fn concurrent_starts_get_distinct_gap_free_run_numbers() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let side = |alert: String, race: Option<crate::race::Barriers>| async move {
            let new = new_run(RunSubjectType::Alert, &alert);
            let start = start_run_with(get_orm_client_rw().await, new, guards(T0), None, None);
            let result = match race {
                Some(race) => race.run(start).await,
                None => start.await,
            };
            match result.unwrap() {
                StartResult::Started { run_id, .. } => run_id,
                other => panic!("expected Started, got {other:?}"),
            }
        };
        let numbers_of = |alert: String| async move {
            let mut numbers: Vec<Option<i32>> = rca_runs::Entity::find()
                .filter(rca_runs::Column::OrgId.eq(ORG))
                .filter(rca_runs::Column::SubjectId.eq(alert.as_str()))
                .all(get_orm_client_rw().await)
                .await
                .unwrap()
                .into_iter()
                .map(|run| run.run_number)
                .collect();
            numbers.sort();
            numbers
        };
        let store: config::meta::meta_store::MetaStore =
            config::get_config().common.meta_store.as_str().into();
        if store == config::meta::meta_store::MetaStore::PostgreSQL {
            let alert = crate::table::testing::unique("run_number_alert");
            let race = crate::race::Barriers::new();
            race.arm("rca_runs.before_run_number", 2);
            let a = tokio::spawn(side(alert.clone(), Some(race.clone())));
            let b = tokio::spawn(side(alert.clone(), Some(race.clone())));
            let (a, b) = (a.await.unwrap(), b.await.unwrap());
            race.assert_all_met();
            assert_ne!(a, b);
            side(alert.clone(), None).await;
            assert_eq!(numbers_of(alert).await, [Some(1), Some(2), Some(3)]);
            return;
        }
        let runs = crate::race::in_both_orders(|_| {
            let alert = crate::table::testing::unique("run_number_alert");
            let pair = (side(alert.clone(), None), side(alert, None));
            async move { pair }
        })
        .await;
        for run in runs {
            let alert = rca_runs::Entity::find_by_id(run.a.as_str())
                .one(get_orm_client_rw().await)
                .await
                .unwrap()
                .unwrap()
                .subject_id;
            side(alert.clone(), None).await;
            assert_eq!(
                numbers_of(alert).await,
                [Some(1), Some(2), Some(3)],
                "{:?}",
                run.order
            );
        }
    }
    async fn fence_fixture(db: &DatabaseConnection, read_history: bool) -> (String, String) {
        use config::meta::oncall::{SubjectRef, SubjectType};
        // Real ids fill PostgreSQL's `char(27)`; a shorter one comes back padded.
        let incident_id = format!("{:_<27}", crate::table::testing::unique("fence"));
        incident(db, &incident_id).await;
        let mut new = new_run(RunSubjectType::Incident, &incident_id);
        new.context_used = Some(serde_json::json!({"history_read": read_history}));
        new.recipients = vec![Recipient {
            response_id: format!("page_{incident_id}"),
            subject: SubjectRef::new(SubjectType::Incident, &incident_id, 1),
            ladder_run: 1,
        }];
        let StartResult::Started { run_id, .. } = start_run_with(db, new, guards(T0), None, None)
            .await
            .unwrap()
        else {
            panic!("run refused");
        };
        (incident_id, run_id)
    }

    fn fence_patch(state: RunState) -> RunUpdate {
        let mut patch = finish_update(state, T0 + SEC);
        patch.withhold_if_case = true;
        patch.result = Some(serde_json::json!({"private": "partial record"}));
        patch.summary = Some(RunSummaryPatch {
            detail: Some(Some("private blind spot".into())),
            ..Default::default()
        });
        if state == RunState::Failed {
            patch.error = Some(RunError {
                code: "timeout".into(),
                reason: "Timed out".into(),
                details: Some("private failure".into()),
                trigger_type: Some("manual".into()),
            });
            patch.event = Some(IncidentEvent::ai_analysis_failed(
                "Timed out",
                RunTrigger::Manual.analysis_trigger_type(),
                Some("private failure".into()),
            ));
        }
        if state == RunState::WaitingInput {
            patch.pending_question_id = Some(Some("private question".into()));
            patch.event = Some(IncidentEvent::ai_analysis_needs_input(
                "r",
                "q",
                "private need",
                "private question",
                T0 + 10 * SEC,
            ));
        }
        patch
    }

    async fn assert_fence(db: &DatabaseConnection, id: &str, run_id: &str, code: &str) {
        let row = run(db, run_id).await.unwrap();
        assert_eq!(row.state, "failed");
        assert!(
            row.report.is_none()
                && row.outcome.is_none()
                && row.confidence.is_none()
                && row.result.is_none()
        );
        let error = error_of(&row).unwrap();
        assert_eq!(error.code, code);
        assert_eq!(error.details, None);
        let summary = decode_summary(inc(db, id).await.rca_summary.as_deref());
        assert_eq!(summary.detail.as_deref(), Some(error.reason.as_str()));
        let owed = rca_delivery_obligations::for_run_in(db, ORG, run_id)
            .await
            .unwrap();
        assert_eq!(owed.len(), 1);
        assert_eq!(owed[0].kind, Some(ObligationKind::NoVerdict));
    }

    async fn wait_at(race: &crate::race::Barriers, point: &'static str) {
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while race.arrived(point) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn wait_for_pg_incident_lock(db: &DatabaseConnection) {
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            loop {
                let row = db.query_one(sea_orm::Statement::from_string(
                    sea_orm::DatabaseBackend::Postgres,
                    "SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%alert_incidents%'".to_string(),
                )).await.unwrap().unwrap();
                if row.try_get::<i64>("", "count").unwrap() > 0 { break; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
    }

    async fn fence_order(db: &DatabaseConnection, state: RunState, first: bool) {
        let (id, run_id) = fence_fixture(db, true).await;
        if first {
            crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
                .await
                .unwrap();
            update_run_with(db, ORG, &run_id, fence_patch(state))
                .await
                .unwrap();
            let code = if state == RunState::Failed {
                "timeout"
            } else {
                crate::table::rca_fence::RECLASSIFIED_ERROR_CODE
            };
            assert_fence(db, &id, &run_id, code).await;
        } else {
            update_run_with(db, ORG, &run_id, fence_patch(state))
                .await
                .unwrap();
            crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
                .await
                .unwrap();
            let row = run(db, &run_id).await.unwrap();
            assert_eq!(row.state, state.as_str());
            assert!(!row.fenced);
            assert!(row.result.is_some());
            if state == RunState::Failed {
                assert_eq!(
                    error_of(&row).unwrap().details.as_deref(),
                    Some("private failure")
                );
            }
        }
    }

    #[tokio::test]
    async fn fenced_completion_vs_reclassify_a_b_e_h_serial_orders() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let db = get_orm_client_rw().await;
        for state in [
            RunState::Completed,
            RunState::Failed,
            RunState::WaitingInput,
        ] {
            for first in [true, false] {
                if !first && state == RunState::WaitingInput {
                    let (id, run_id) = fence_fixture(db, true).await;
                    update_run_with(db, ORG, &run_id, fence_patch(state))
                        .await
                        .unwrap();
                    crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
                        .await
                        .unwrap();
                    assert_eq!(run(db, &run_id).await.unwrap().state, "waiting_input");
                } else {
                    fence_order(db, state, first).await;
                }
            }
        }
    }

    #[tokio::test]
    async fn fenced_completion_vs_reclassify_a_before_first_wait() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let db = get_orm_client_rw().await;
        let (id, run_id) = fence_fixture(db, true).await;
        let race = crate::race::Barriers::new();
        race.arm("rca_fence.before_begin", 2);
        let task = {
            let (race, run_id) = (race.clone(), run_id.clone());
            tokio::spawn(async move {
                race.run(update_run_with(
                    get_orm_client_rw().await,
                    ORG,
                    &run_id,
                    fence_patch(RunState::Completed),
                ))
                .await
            })
        };
        wait_at(&race, "rca_fence.before_begin").await;
        crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
            .await
            .unwrap();
        race.wait("rca_fence.before_begin").await;
        assert!(task.await.unwrap().unwrap());
        race.assert_all_met();
        assert_fence(
            db,
            &id,
            &run_id,
            crate::table::rca_fence::RECLASSIFIED_ERROR_CODE,
        )
        .await;
    }

    #[tokio::test]
    async fn fenced_completion_vs_reclassify_b_e_postgres_lock_overlap() {
        if !crate::table::testing::meta_store().await
            || get_orm_client_rw().await.get_database_backend()
                != sea_orm::DatabaseBackend::Postgres
        {
            return;
        }
        for state in [RunState::Completed, RunState::Failed] {
            let db = get_orm_client_rw().await;
            let (id, run_id) = fence_fixture(db, true).await;
            let race = crate::race::Barriers::new();
            race.arm("rca_fence.after_run_lock", 2)
                .arm("rca_fence.before_reclassify_lock", 2);
            let writer = {
                let (race, run_id) = (race.clone(), run_id.clone());
                tokio::spawn(async move {
                    race.run(update_run_with(
                        get_orm_client_rw().await,
                        ORG,
                        &run_id,
                        fence_patch(state),
                    ))
                    .await
                })
            };
            wait_at(&race, "rca_fence.after_run_lock").await;
            let marker = {
                let (race, id) = (race.clone(), id.clone());
                tokio::spawn(async move {
                    race.run(crate::table::alert_incidents::mark_security_case_with(
                        get_orm_client_rw().await,
                        ORG,
                        &id,
                    ))
                    .await
                })
            };
            wait_at(&race, "rca_fence.before_reclassify_lock").await;
            race.wait("rca_fence.before_reclassify_lock").await;
            wait_for_pg_incident_lock(db).await;
            race.wait("rca_fence.after_run_lock").await;
            assert!(writer.await.unwrap().unwrap());
            marker.await.unwrap().unwrap();
            race.assert_all_met();
            let row = run(db, &run_id).await.unwrap();
            assert_eq!(row.state, state.as_str());
            assert!(!row.fenced);
            assert!(row.result.is_some());
        }
    }

    #[tokio::test]
    async fn fenced_completion_vs_reclassify_c_d_f_j_stats_and_deadline() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let db = get_orm_client_rw().await;
        for state in [RunState::Cancelled, RunState::Completed] {
            let (id, run_id) = fence_fixture(db, true).await;
            crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
                .await
                .unwrap();
            update_run_with(db, ORG, &run_id, fence_patch(state))
                .await
                .unwrap();
            let mut stats = fence_patch(RunState::Failed);
            stats.final_stats_only = true;
            stats.stats = Some(RunStats {
                steps: Some(7),
                ..Default::default()
            });
            update_run_with(db, ORG, &run_id, stats).await.unwrap();
            let row = run(db, &run_id).await.unwrap();
            assert!(row.result.is_none());
            assert_eq!(
                decode::<RunStats>(row.stats.as_deref()).unwrap().steps,
                Some(7)
            );
            if state == RunState::Completed {
                assert_fence(
                    db,
                    &id,
                    &run_id,
                    crate::table::rca_fence::RECLASSIFIED_ERROR_CODE,
                )
                .await;
            }
        }
        let (id, run_id) = fence_fixture(db, false).await;
        crate::table::alert_incidents::mark_security_case_with(db, ORG, &id)
            .await
            .unwrap();
        let mut patch = fence_patch(RunState::Completed);
        patch.withhold_if_case = false;
        update_run_with(db, ORG, &run_id, patch).await.unwrap();
        let row = run(db, &run_id).await.unwrap();
        assert_eq!(row.state, "completed");
        assert!(row.report.is_some() && row.result.is_some());
        assert!(
            !crate::table::rca_fence::is_fenced_with(db, &row)
                .await
                .unwrap()
        );
    }
}

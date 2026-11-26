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

use config::meta::alerts::{
    incidents::IncidentEvent,
    rca_runs::{RunError, RunState, RunSubjectType, RunTrigger},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter,
    TransactionTrait,
};
use serde_json::{Value, json};

use super::{
    entity::{alert_incidents, rca_runs},
    rca_runs::{RunUpdate, decode, locked},
};

pub const RECLASSIFIED_ERROR_CODE: &str = "security_case_reclassified";
pub const RECLASSIFIED_ERROR_REASON: &str =
    "The incident became a security case; start a new analysis";

pub(crate) struct LockedRun {
    pub run: rca_runs::Model,
    pub incident: Option<alert_incidents::Model>,
}

pub fn predicate(read_history: bool, fenced: bool, security_case: bool) -> bool {
    read_history && (fenced || security_case)
}

pub fn read_history(run: &rca_runs::Model) -> bool {
    let used = decode::<Value>(run.context_used.as_deref()).unwrap_or(Value::Null);
    context_history(&used).unwrap_or(true)
}

pub fn row_fenced(run: &rca_runs::Model) -> bool {
    predicate(read_history(run), run.fenced, false)
        || super::rca_runs::error_of(run).is_some_and(|error| error.code == RECLASSIFIED_ERROR_CODE)
}

pub async fn is_fenced(run: &rca_runs::Model) -> Result<bool, DbErr> {
    is_fenced_with(crate::db::get_orm_client_rw().await, run).await
}

pub async fn is_fenced_with<C: ConnectionTrait>(
    db: &C,
    run: &rca_runs::Model,
) -> Result<bool, DbErr> {
    if row_fenced(run) {
        return Ok(true);
    }
    if !read_history(run) {
        return Ok(false);
    }
    let case = match run.incident_id.as_deref() {
        Some(id) => alert_incidents::Entity::find_by_id(id)
            .filter(alert_incidents::Column::OrgId.eq(&run.org_id))
            .one(db)
            .await?
            .is_none_or(|incident| incident.security_case),
        None => false,
    };
    Ok(predicate(true, run.fenced, case))
}

pub async fn incident_history_allowed(org_id: &str, incident_id: &str) -> bool {
    match super::alert_incidents::get_rw(org_id, incident_id).await {
        Ok(Some(incident)) => !incident.security_case,
        Ok(None) => false,
        Err(error) => {
            log::warn!("[RCA] cannot classify {org_id}/{incident_id}: {error}; history blocked");
            false
        }
    }
}

pub async fn record_history_read(org_id: &str, run_id: &str) -> Result<bool, DbErr> {
    let txn = crate::db::get_orm_client_rw().await.begin().await?;
    let Some(held) = lock_run(&txn, org_id, run_id).await? else {
        return Ok(false);
    };
    let case = held.run.incident_id.is_some()
        && held
            .incident
            .as_ref()
            .is_none_or(|incident| incident.security_case);
    if held.run.fenced || case || !matches!(held.run.state.as_str(), "running" | "waiting_input") {
        return Ok(false);
    }
    write_history_read(&txn, &held.run).await?;
    txn.commit().await?;
    Ok(true)
}

pub async fn record_incident_history_read(
    org_id: &str,
    run_id: &str,
    session_id: &str,
    target: &str,
) -> Result<bool, DbErr> {
    let txn = crate::db::get_orm_client_rw().await.begin().await?;
    let query = rca_runs::Entity::find_by_id(run_id).filter(rca_runs::Column::OrgId.eq(org_id));
    let Some(seen) = query.clone().one(&txn).await? else {
        return Ok(false);
    };
    let origin = history_origin(&seen);
    let mut incidents = [Some(target), origin];
    incidents.sort_unstable();
    // Lock both incidents in ID order before the run, including reciprocal history reads.
    for id in incidents.into_iter().flatten() {
        let incident = locked(
            &txn,
            alert_incidents::Entity::find_by_id(id)
                .filter(alert_incidents::Column::OrgId.eq(org_id)),
        )
        .one(&txn)
        .await?;
        if incident.is_none_or(|row| row.security_case) {
            return Ok(false);
        }
    }
    let Some(run) = locked(&txn, query).one(&txn).await? else {
        return Ok(false);
    };
    if history_origin(&run) != origin
        || run.session_id.as_deref() != Some(session_id)
        || run.fenced
        || !matches!(run.state.as_str(), "running" | "waiting_input")
    {
        return Ok(false);
    }
    write_history_read(&txn, &run).await?;
    txn.commit().await?;
    Ok(true)
}

pub(crate) async fn lock_run(
    txn: &DatabaseTransaction,
    org_id: &str,
    run_id: &str,
) -> Result<Option<LockedRun>, DbErr> {
    let Some(seen) = rca_runs::Entity::find_by_id(run_id)
        .filter(rca_runs::Column::OrgId.eq(org_id))
        .one(txn)
        .await?
    else {
        return Ok(None);
    };
    crate::race_point!("rca_fence.before_incident_lock");
    let incident = match seen.incident_id.as_deref() {
        Some(id) => {
            locked(
                txn,
                alert_incidents::Entity::find_by_id(id)
                    .filter(alert_incidents::Column::OrgId.eq(org_id)),
            )
            .one(txn)
            .await?
        }
        None => None,
    };
    let Some(run) = locked(
        txn,
        rca_runs::Entity::find_by_id(run_id).filter(rca_runs::Column::OrgId.eq(org_id)),
    )
    .one(txn)
    .await?
    else {
        return Ok(None);
    };
    crate::race_point!("rca_fence.after_run_lock");
    Ok(Some(LockedRun { run, incident }))
}

pub(crate) fn apply(held: &LockedRun, mut upd: RunUpdate) -> (RunUpdate, bool) {
    let read = upd.withhold_if_case
        || read_history(&held.run)
        || upd
            .context_used
            .as_ref()
            .is_some_and(|used| context_history(used) == Some(true));
    if read {
        // Readers need consumption provenance without opening the transcript being withheld.
        let used = upd.context_used.get_or_insert_with(|| {
            decode(held.run.context_used.as_deref()).unwrap_or_else(|| json!({}))
        });
        used["history_read"] = Value::Bool(true);
    } else if let Some(used) = upd.context_used.as_mut() {
        // A replaced context keeps the flag; an absent one reads as "read history".
        used["history_read"] = Value::Bool(false);
    }
    let case = held.run.incident_id.is_some()
        && held
            .incident
            .as_ref()
            .is_none_or(|incident| incident.security_case);
    if !predicate(read, held.run.fenced, case) {
        return (upd, false);
    }
    upd.report = None;
    upd.outcome = None;
    upd.confidence = None;
    upd.result = None;
    if matches!(
        upd.state,
        Some(RunState::Completed | RunState::WaitingInput)
    ) {
        upd.state = Some(RunState::Failed);
        upd.error = Some(RunError {
            code: RECLASSIFIED_ERROR_CODE.to_string(),
            reason: RECLASSIFIED_ERROR_REASON.to_string(),
            details: None,
            trigger_type: Some(held.run.trigger.clone()),
        });
        upd.input_deadline_at = Some(None);
        upd.pending_question_id = Some(None);
        upd.questions_asked_inc = false;
    }
    if let Some(error) = upd.error.as_mut() {
        error.details = None;
        if upd.state == Some(RunState::Failed) {
            upd.event = Some(IncidentEvent::ai_analysis_failed(
                &error.reason,
                held.run
                    .trigger
                    .parse::<RunTrigger>()
                    .unwrap_or(RunTrigger::Manual)
                    .analysis_trigger_type(),
                None,
            ));
            if let Some(IncidentEvent {
                event_type:
                    config::meta::alerts::incidents::IncidentEventType::AIAnalysisFailed {
                        error_code,
                        ..
                    },
                ..
            }) = upd.event.as_mut()
            {
                *error_code = Some(error.code.clone());
            }
        }
    }
    if let Some(summary) = upd.summary.as_mut() {
        summary.detail = Some(upd.error.as_ref().map(|error| error.reason.clone()));
        summary.deadline_at = Some(None);
    }
    if let Some(used) = upd.context_used.as_mut().and_then(Value::as_object_mut) {
        used.remove("past_causes");
    }
    (upd, true)
}

fn history_origin(run: &rca_runs::Model) -> Option<&str> {
    if run.subject_type == RunSubjectType::Incident.as_str() {
        Some(&run.subject_id)
    } else {
        run.incident_id.as_deref()
    }
}

async fn write_history_read(txn: &DatabaseTransaction, run: &rca_runs::Model) -> Result<(), DbErr> {
    let mut used = decode::<Value>(run.context_used.as_deref()).unwrap_or_else(|| json!({}));
    used["history_read"] = Value::Bool(true);
    rca_runs::Entity::update_many()
        .col_expr(
            rca_runs::Column::ContextUsed,
            sea_orm::sea_query::Expr::value(used.to_string()),
        )
        .filter(rca_runs::Column::RunId.eq(&run.run_id))
        .filter(rca_runs::Column::OrgId.eq(&run.org_id))
        .exec(txn)
        .await?;
    Ok(())
}

fn context_history(used: &Value) -> Option<bool> {
    if used["history_injected"] == true
        || used["past_causes"]
            .as_array()
            .is_some_and(|causes| !causes.is_empty())
    {
        return Some(true);
    }
    used["history_read"]
        .as_bool()
        .or_else(|| (used["history_reads_allowed"] == false).then_some(false))
}

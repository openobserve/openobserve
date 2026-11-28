// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::meta::{
    alerts::recovery::transitions::{self, CheckState, GuardFacts, Phase, RecoveryEvent},
    triggers::{Trigger, TriggerModule},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait, FromQueryResult,
    JoinType, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, RelationDef, Select,
    sea_query::{Expr, IntoCondition, Query},
};

use super::entity::{
    alert_incidents,
    incident_recovery_checks::{ActiveModel, Column, Entity, Model},
};

pub const LIVE: [&str; 2] = [CheckState::Checking.as_str(), CheckState::Soaking.as_str()];
pub const HELD_TRIGGER_SUFFIX: &str = ":held";

#[derive(Debug, thiserror::Error)]
#[error("Incident is {0}")]
pub struct ClosedIncident(pub &'static str);

#[derive(FromQueryResult)]
pub struct CheckListIncident {
    pub security_case: bool,
    pub recovery_due_at: Option<i64>,
}

pub fn phase(row: &alert_incidents::Model) -> Phase {
    Phase::of(&row.status, row.mitigated_at, row.merged_into_id.is_some())
}

pub async fn insert_in(txn: &DatabaseTransaction, mut row: Model, now: i64) -> Result<(), DbErr> {
    row.updated_at = now;
    Entity::insert(ActiveModel::from(row)).exec(txn).await?;
    Ok(())
}

pub async fn list(
    conn: &impl ConnectionTrait,
    org: &str,
    incident: &str,
) -> Result<Vec<Model>, DbErr> {
    for_incident(org, incident)
        .order_by_asc(Column::Id)
        .all(conn)
        .await
}

pub async fn list_with_incident(
    conn: &impl ConnectionTrait,
    org: &str,
    incident: &str,
) -> Result<Option<(CheckListIncident, Vec<Model>)>, DbErr> {
    use alert_incidents::{Column as IncidentColumn, Entity as Incident};

    let check_org = org.to_owned();
    let relation: RelationDef = Entity::belongs_to(Incident)
        .from(Column::IncidentId)
        .to(IncidentColumn::Id)
        .into();
    let relation = relation.rev().on_condition(move |_, check| {
        Expr::col((check.clone(), Column::OrgId))
            .eq(check_org.clone())
            .and(Expr::col((check, Column::DeletedAt)).is_null())
            .into_condition()
    });
    let mut rows = Incident::find_by_id(incident)
        .filter(IncidentColumn::OrgId.eq(org))
        .select_only()
        .column(IncidentColumn::SecurityCase)
        .column(IncidentColumn::RecoveryDueAt)
        .join(JoinType::LeftJoin, relation)
        .select_also(Entity)
        .order_by_asc(Column::Id)
        .into_model::<CheckListIncident, Model>()
        .all(conn)
        .await?
        .into_iter();
    let Some((incident, first)) = rows.next() else {
        return Ok(None);
    };
    let checks = first
        .into_iter()
        .chain(rows.filter_map(|(_, check)| check))
        .collect();
    Ok(Some((incident, checks)))
}

pub async fn get(conn: &impl ConnectionTrait, org: &str, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id)
        .filter(Column::OrgId.eq(org))
        .filter(Column::DeletedAt.is_null())
        .one(conn)
        .await
}

pub async fn lock_budget(txn: &DatabaseTransaction, org: &str) -> crate::errors::Result<()> {
    super::alert_incidents::lock_correlation(txn, &format!("incident_recovery_budget/{org}")).await
}

pub async fn count_held_watches(conn: &impl ConnectionTrait, org: &str) -> Result<u64, DbErr> {
    use alert_incidents::Column as IncidentColumn;

    let watched = Query::select()
        .column(IncidentColumn::FixAttemptId)
        .from(alert_incidents::Entity)
        .and_where(IncidentColumn::OrgId.eq(org))
        .and_where(IncidentColumn::SecurityCase.eq(false))
        .and_where(IncidentColumn::Status.ne("resolved"))
        .and_where(IncidentColumn::MergedIntoId.is_null())
        .and_where(IncidentColumn::FixAttemptId.is_not_null())
        .to_owned();
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::State.eq(CheckState::Held.as_str()))
        .filter(Column::DeletedAt.is_null())
        .filter(Column::AttemptId.in_subquery(watched))
        .count(conn)
        .await
}

pub async fn count_live_org(conn: &impl ConnectionTrait, org: &str) -> Result<u64, DbErr> {
    live(org).count(conn).await
}

pub async fn count_live_attempt(
    conn: &impl ConnectionTrait,
    org: &str,
    incident: &str,
    attempt: &str,
) -> Result<u64, DbErr> {
    live(org)
        .filter(Column::IncidentId.eq(incident))
        .filter(Column::AttemptId.eq(attempt))
        .count(conn)
        .await
}

pub async fn supersede_in(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    attempt: &str,
    now: i64,
) -> Result<(), DbErr> {
    for state in [CheckState::Checking, CheckState::Soaking, CheckState::Held] {
        let effect = transitions::apply(
            (phase(row), Some(state)),
            RecoveryEvent::Record,
            GuardFacts {
                record_allowed: true,
                ..Default::default()
            },
        )
        .map_err(|_| DbErr::Custom("Cannot supersede a closed incident".to_owned()))?;
        update_checks(txn, row, Some(attempt), state, effect.state, now).await?;
    }
    Ok(())
}

pub async fn cancel_in(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    attempt: &str,
    now: i64,
) -> Result<(), DbErr> {
    Entity::update_many()
        .col_expr(Column::State, Expr::value(CheckState::Cancelled.as_str()))
        .col_expr(Column::Generation, Expr::col(Column::Generation).add(1))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::IncidentId.eq(&row.id))
        .filter(Column::AttemptId.eq(attempt))
        .filter(Column::DeletedAt.is_null())
        .exec(txn)
        .await?;
    Ok(())
}

pub async fn status_in(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    event: RecoveryEvent,
    now: i64,
) -> Result<Vec<String>, DbErr> {
    let mut stopped = Vec::new();
    for state in [
        CheckState::Cancelled,
        CheckState::Held,
        CheckState::Denied,
        CheckState::Expired,
        CheckState::Superseded,
        CheckState::Unverified,
        CheckState::Checking,
        CheckState::Soaking,
    ] {
        let effect = transitions::apply(
            (phase(row), Some(state)),
            event,
            GuardFacts {
                reopen_allowed: true,
                ..Default::default()
            },
        )
        .map_err(|_| DbErr::Custom("Cannot change recovery state".to_owned()))?;
        if let Some(attempt) = &row.fix_attempt_id
            && (effect.end_held_watch
                || (state.is_live() && !effect.state.is_some_and(CheckState::is_live)))
        {
            let ids = for_incident(&row.org_id, &row.id)
                .filter(Column::AttemptId.eq(attempt))
                .filter(Column::State.eq(state.as_str()))
                .select_only()
                .column(Column::Id)
                .into_tuple::<String>()
                .all(txn)
                .await?;
            stopped.extend(ids);
        }
        if effect.bump_generation {
            update_checks(txn, row, None, state, effect.state, now).await?;
        }
    }
    Ok(stopped)
}

pub(super) async fn retire_stopped_triggers(
    conn: &impl ConnectionTrait,
    org: &str,
    ids: Vec<String>,
) {
    // A status transition can end a check's watch, but reopening cannot revive its ID.
    for id in ids {
        for key in [format!("{id}{HELD_TRIGGER_SUFFIX}"), id] {
            let trigger = Trigger {
                org: org.to_owned(),
                module: TriggerModule::IncidentRecovery,
                module_key: key,
                ..Default::default()
            };
            if let Err(error) = crate::scheduler::delete_with(conn, &trigger).await {
                log::warn!(
                    "[INCIDENT RECOVERY] Could not retire trigger {org}/{}: {error}",
                    trigger.module_key
                );
            }
        }
    }
}

pub async fn delete_by_org(conn: &impl ConnectionTrait, org: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .exec(conn)
        .await?;
    Ok(())
}

fn for_incident(org: &str, incident: &str) -> Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident))
        .filter(Column::DeletedAt.is_null())
}

fn live(org: &str) -> Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::State.is_in(LIVE))
        .filter(Column::DeletedAt.is_null())
}

async fn update_checks(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    attempt: Option<&str>,
    prior: CheckState,
    next: Option<CheckState>,
    now: i64,
) -> Result<(), DbErr> {
    let mut update = Entity::update_many()
        .col_expr(Column::Generation, Expr::col(Column::Generation).add(1))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::IncidentId.eq(&row.id))
        .filter(Column::State.eq(prior.as_str()));
    if let Some(attempt) = attempt {
        update = update
            .filter(Column::AttemptId.eq(attempt))
            .filter(Column::DeletedAt.is_null());
    }
    if let Some(next) = next {
        update = update.col_expr(Column::State, Expr::value(next.as_str()));
    }
    update.exec(txn).await?;
    Ok(())
}

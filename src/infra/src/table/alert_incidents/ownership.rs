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

use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, LockType, SimpleExpr},
};

use super::v2_fields::Edited;
use crate::{
    db::get_orm_client_rw,
    errors,
    table::{
        entity::{alert_incidents, oncall_responses},
        incident_events,
    },
};

#[derive(Clone, Copy, Debug)]
pub enum LeadAck<'a> {
    Incident {
        acknowledged_at: i64,
    },
    Page {
        response_id: &'a str,
        updated_at: i64,
    },
}

#[derive(Clone, Debug)]
pub struct OwnershipRequest<'a> {
    pub caller: &'a str,
    pub take_over_of: Option<&'a str>,
    pub assign_self: bool,
    pub ops_only: bool,
    pub expected_holder: Option<&'a str>,
    pub expected_lead: Option<&'a str>,
}

#[derive(Clone, Debug)]
pub enum OwnershipResult {
    Committed(alert_incidents::Model, Option<Box<IncidentEvent>>),
    Unchanged(alert_incidents::Model),
    Conflict(alert_incidents::Model),
    Missing,
}

pub async fn take_ownership(
    org_id: &str,
    id: &str,
    request: &OwnershipRequest<'_>,
) -> Result<OwnershipResult, errors::Error> {
    take_ownership_with(get_orm_client_rw().await, org_id, id, request).await
}

pub async fn take_ownership_with(
    db: &DatabaseConnection,
    org_id: &str,
    id: &str,
    request: &OwnershipRequest<'_>,
) -> Result<OwnershipResult, errors::Error> {
    // Both readers may observe the same values before either locks the row.
    crate::race_point!("alert_incidents.ownership_before_lock");
    let txn = db.begin().await?;
    let Some(row) = locked(&txn, org_id, id).await? else {
        txn.rollback().await?;
        return Ok(OwnershipResult::Missing);
    };
    if row.acknowledged_by.as_deref() != request.expected_holder
        || row.assigned_to.as_deref() != request.expected_lead
        || row.status == "resolved"
        || (request.ops_only && row.security_case)
    {
        txn.rollback().await?;
        return Ok(OwnershipResult::Conflict(row));
    }
    if let Some(holder) = row.acknowledged_by.as_deref()
        && !holder.eq_ignore_ascii_case(request.caller)
    {
        match request.take_over_of {
            None => {
                txn.rollback().await?;
                return Ok(OwnershipResult::Unchanged(row));
            }
            Some(expected) if expected == holder => {}
            Some(_) => {
                txn.rollback().await?;
                return Ok(OwnershipResult::Conflict(row));
            }
        }
    }
    let ack_changed =
        row.status != "acknowledged" || row.acknowledged_by.as_deref() != Some(request.caller);
    let lead_changed = request.assign_self && row.assigned_to.as_deref() != Some(request.caller);
    if !ack_changed && !lead_changed {
        txn.rollback().await?;
        return Ok(OwnershipResult::Unchanged(row));
    }
    let now = chrono::Utc::now().timestamp_micros();
    let mut update = alert_incidents::Entity::update_many()
        .col_expr(alert_incidents::Column::Status, Expr::value("acknowledged"))
        .col_expr(
            alert_incidents::Column::AcknowledgedBy,
            Expr::value(request.caller),
        )
        .col_expr(alert_incidents::Column::AcknowledgedAt, Expr::value(now))
        .col_expr(alert_incidents::Column::UpdatedAt, Expr::value(now));
    if request.assign_self {
        update = update.col_expr(
            alert_incidents::Column::AssignedTo,
            Expr::value(request.caller),
        );
    }
    let changed = update
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Id.eq(id))
        .filter(null_safe_eq(
            alert_incidents::Column::AcknowledgedBy,
            request.expected_holder,
        ))
        .filter(null_safe_eq(
            alert_incidents::Column::AssignedTo,
            request.expected_lead,
        ))
        .exec(&txn)
        .await?;
    if changed.rows_affected == 0 {
        let current = locked(&txn, org_id, id).await?;
        txn.rollback().await?;
        return Ok(current.map_or(OwnershipResult::Missing, OwnershipResult::Conflict));
    }
    let assignment = if lead_changed {
        let event = IncidentEvent::assignment_changed_via_ack(
            row.assigned_to,
            Some(request.caller.to_string()),
            request.caller,
        );
        let event = append_assignment_in(&txn, org_id, id, event).await?;
        Some(event)
    } else {
        None
    };
    let row = locked(&txn, org_id, id).await?.ok_or_else(|| {
        sea_orm::DbErr::Custom("Incident disappeared while taking ownership".to_string())
    })?;
    txn.commit().await?;
    Ok(OwnershipResult::Committed(row, assignment.map(Box::new)))
}

pub async fn ensure_lead_for_human(
    org_id: &str,
    id: &str,
    acker: &str,
    source: LeadAck<'_>,
) -> Result<Option<Edited>, errors::Error> {
    ensure_lead_for_human_with(get_orm_client_rw().await, org_id, id, acker, source).await
}

pub async fn ensure_lead_for_human_with(
    db: &DatabaseConnection,
    org_id: &str,
    id: &str,
    acker: &str,
    source: LeadAck<'_>,
) -> Result<Option<Edited>, errors::Error> {
    crate::race_point!("alert_incidents.ensure_lead_before_lock");
    crate::race_point!("alert_incidents.ensure_lead_continue");
    let txn = db.begin().await?;
    let Some(row) = locked(&txn, org_id, id).await? else {
        txn.rollback().await?;
        return Ok(None);
    };
    if row.assigned_to.is_some() || !ack_source_matches(&txn, &row, acker, source).await? {
        txn.rollback().await?;
        return Ok(None);
    }
    let mut active: alert_incidents::ActiveModel = row.into();
    active.assigned_to = Set(Some(acker.to_string()));
    active.updated_at = Set(chrono::Utc::now().timestamp_micros());
    let row = active.update(&txn).await?;
    let event = IncidentEvent::assignment_changed_via_ack(None, Some(acker.to_string()), acker);
    let event = append_assignment_in(&txn, org_id, id, event).await?;
    txn.commit().await?;
    Ok(Some(Edited {
        row,
        event: Some(event),
    }))
}

pub async fn assign_lead(
    org_id: &str,
    id: &str,
    assignee: Option<&str>,
    actor: &str,
) -> Result<Option<Edited>, errors::Error> {
    assign_lead_with(get_orm_client_rw().await, org_id, id, assignee, actor).await
}

pub async fn assign_lead_with(
    db: &DatabaseConnection,
    org_id: &str,
    id: &str,
    assignee: Option<&str>,
    actor: &str,
) -> Result<Option<Edited>, errors::Error> {
    let txn = db.begin().await?;
    let Some(row) = locked(&txn, org_id, id).await? else {
        txn.rollback().await?;
        return Ok(None);
    };
    if row.assigned_to.as_deref() == assignee {
        txn.rollback().await?;
        return Ok(Some(Edited { row, event: None }));
    }
    let event = IncidentEvent::assignment_changed(
        row.assigned_to.clone(),
        assignee.map(str::to_string),
        actor,
    );
    let mut active: alert_incidents::ActiveModel = row.into();
    active.assigned_to = Set(assignee.map(str::to_string));
    active.updated_at = Set(chrono::Utc::now().timestamp_micros());
    let row = active.update(&txn).await?;
    let event = append_assignment_in(&txn, org_id, id, event).await?;
    txn.commit().await?;
    Ok(Some(Edited {
        row,
        event: Some(event),
    }))
}

pub async fn clear_ack_lead_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, errors::Error> {
    let Some(row) = locked(txn, org_id, id).await? else {
        return Ok(false);
    };
    if !row
        .assigned_to
        .as_deref()
        .is_some_and(|lead| lead.eq_ignore_ascii_case(actor))
        || !lead_was_set_by_ack(txn, org_id, id, row.assigned_to.as_deref()).await?
    {
        return Ok(false);
    }
    let mut active: alert_incidents::ActiveModel = row.clone().into();
    active.assigned_to = Set(None);
    active.updated_at = Set(chrono::Utc::now().timestamp_micros());
    active.update(txn).await?;
    let event = IncidentEvent::assignment_changed_via_ack(row.assigned_to, None, actor);
    append_assignment_in(txn, org_id, id, event).await?;
    Ok(true)
}

pub(super) async fn release_ack_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    holder: &str,
    actor: &str,
) -> Result<Option<Edited>, errors::Error> {
    let Some(row) = locked(txn, org_id, id).await? else {
        return Ok(None);
    };
    if row.status != "acknowledged" || row.acknowledged_by.as_deref() != Some(holder) {
        return Ok(None);
    }
    if let Some(fence) = super::relapse_repage::current(org_id)
        && fence.incident_id == id
        && !fence.allows(txn, &row).await?
    {
        return Ok(None);
    }
    let clear_lead = row
        .assigned_to
        .as_deref()
        .is_some_and(|lead| lead.eq_ignore_ascii_case(actor))
        && lead_was_set_by_ack(txn, org_id, id, row.assigned_to.as_deref()).await?;
    let mut active: alert_incidents::ActiveModel = row.clone().into();
    active.status = Set("open".to_string());
    active.acknowledged_by = Set(None);
    active.acknowledged_at = Set(None);
    active.updated_at = Set(chrono::Utc::now().timestamp_micros());
    if clear_lead {
        active.assigned_to = Set(None);
    }
    let row_after = active.update(txn).await?;
    let event = if clear_lead {
        let event = IncidentEvent::assignment_changed_via_ack(row.assigned_to, None, actor);
        let event = append_assignment_in(txn, org_id, id, event).await?;
        Some(event)
    } else {
        None
    };
    Ok(Some(Edited {
        row: row_after,
        event,
    }))
}

async fn ack_source_matches(
    txn: &DatabaseTransaction,
    row: &alert_incidents::Model,
    acker: &str,
    source: LeadAck<'_>,
) -> Result<bool, errors::Error> {
    let held_by_acker =
        |holder: Option<&str>| holder.is_some_and(|holder| holder.eq_ignore_ascii_case(acker));
    match source {
        LeadAck::Incident { acknowledged_at } => Ok(row.status == "acknowledged"
            && held_by_acker(row.acknowledged_by.as_deref())
            && row.acknowledged_at == Some(acknowledged_at)),
        LeadAck::Page {
            response_id,
            updated_at,
        } => {
            let page = oncall_responses::Entity::find_by_id(response_id)
                .filter(oncall_responses::Column::OrgId.eq(&row.org_id))
                .filter(oncall_responses::Column::IncidentId.eq(&row.id))
                .lock(LockType::Update)
                .one(txn)
                .await?;
            Ok(page.is_some_and(|page| {
                page.state == config::meta::oncall::ResponseState::Acknowledged.to_i32()
                    && page.closed_at.is_none()
                    && page.updated_at == updated_at
                    && held_by_acker(page.acked_by.as_deref())
                    && (row.acknowledged_by.is_none()
                        || held_by_acker(row.acknowledged_by.as_deref()))
            }))
        }
    }
}

async fn append_assignment_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    mut event: IncidentEvent,
) -> Result<IncidentEvent, errors::Error> {
    incident_events::append_in(txn, org_id, id, event.clone()).await?;
    event.seq = incident_events::seq_with(txn, org_id, id).await?;
    Ok(event)
}

async fn locked(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
) -> Result<Option<alert_incidents::Model>, errors::Error> {
    Ok(alert_incidents::Entity::find_by_id(id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .lock(LockType::Update)
        .one(txn)
        .await?)
}

fn null_safe_eq(column: alert_incidents::Column, value: Option<&str>) -> SimpleExpr {
    match value {
        Some(value) => column.eq(value),
        None => column.is_null(),
    }
}

async fn lead_was_set_by_ack(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    lead: Option<&str>,
) -> Result<bool, errors::Error> {
    let events = incident_events::get_with(txn, org_id, id).await?;
    let latest = events
        .iter()
        .filter(|event| {
            matches!(
                &event.event_type,
                IncidentEventType::AssignmentChanged { role: None, .. }
            )
        })
        .max_by_key(|event| (event.seq, event.timestamp));
    Ok(latest.is_some_and(|event| {
        matches!(
            &event.event_type,
            IncidentEventType::AssignmentChanged { to, via: Some(via), .. }
                if via == "ack" && to.as_deref() == lead
        )
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use sea_orm::{ConnectionTrait, DatabaseBackend, Schema};

    use super::*;
    use crate::race::{Barriers, Order, in_both_orders};

    async fn backends() -> Vec<DatabaseConnection> {
        let dbs = crate::table::migration::sqlite_and_postgres_for_test("ownership").await;
        for db in &dbs {
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            for stmt in [
                schema.create_table_from_entity(alert_incidents::Entity),
                schema.create_table_from_entity(crate::table::entity::incident_events::Entity),
                schema.create_table_from_entity(oncall_responses::Entity),
            ] {
                db.execute(backend.build(&stmt)).await.unwrap();
            }
        }
        dbs
    }

    async fn incident(db: &DatabaseConnection, id: &str) {
        let mut model = super::super::new_incident(
            "acme",
            "P2",
            serde_json::json!({}),
            "service",
            (100, 100),
            None,
            None,
            None,
        );
        model.id = Set(id.to_string());
        model.insert(db).await.unwrap();
        incident_events::open_empty_in(db, "acme", id)
            .await
            .unwrap();
    }

    async fn stored(db: &DatabaseConnection, id: &str) -> alert_incidents::Model {
        alert_incidents::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    fn own(caller: &str) -> OwnershipRequest<'_> {
        OwnershipRequest {
            caller,
            take_over_of: None,
            assign_self: true,
            ops_only: false,
            expected_holder: None,
            expected_lead: None,
        }
    }

    #[tokio::test]
    async fn stale_holder_or_lead_changes_nothing_and_returns_both_actual_values() {
        for db in backends().await {
            incident(&db, "conflict").await;
            take_ownership_with(&db, "acme", "conflict", &own("ana"))
                .await
                .unwrap();
            let before = stored(&db, "conflict").await;
            let events = incident_events::get_with(&db, "acme", "conflict")
                .await
                .unwrap();
            for (holder, lead) in [(Some("ana"), None), (None, Some("ana"))] {
                let request = OwnershipRequest {
                    caller: "bo",
                    take_over_of: Some("ana"),
                    assign_self: true,
                    ops_only: false,
                    expected_holder: holder,
                    expected_lead: lead,
                };
                let result = take_ownership_with(&db, "acme", "conflict", &request)
                    .await
                    .unwrap();
                let OwnershipResult::Conflict(actual) = result else {
                    panic!("stale expected values must conflict");
                };
                assert_eq!(actual, before);
                assert_eq!(stored(&db, "conflict").await, before);
                assert_eq!(
                    serde_json::to_value(
                        incident_events::get_with(&db, "acme", "conflict")
                            .await
                            .unwrap()
                    )
                    .unwrap(),
                    serde_json::to_value(&events).unwrap(),
                );
            }
        }
    }

    #[tokio::test]
    async fn acknowledgement_and_assignment_commit_with_the_ack_assignment_event() {
        for db in backends().await {
            incident(&db, "own").await;
            let OwnershipResult::Committed(row, _) =
                take_ownership_with(&db, "acme", "own", &own("ana"))
                    .await
                    .unwrap()
            else {
                panic!("first acknowledgement must win");
            };
            assert_eq!(row.acknowledged_by.as_deref(), Some("ana"));
            assert_eq!(row.assigned_to.as_deref(), Some("ana"));
            assert!(row.acknowledged_at.is_some());
            assert!(matches!(
                &incident_events::get_with(&db, "acme", "own").await.unwrap()[0].event_type,
                IncidentEventType::AssignmentChanged { to: Some(to), via: Some(via), .. }
                    if to == "ana" && via == "ack"
            ));
            let request = OwnershipRequest {
                caller: "bo",
                expected_holder: Some("ana"),
                expected_lead: Some("ana"),
                ..own("bo")
            };
            let OwnershipResult::Unchanged(actual) =
                take_ownership_with(&db, "acme", "own", &request)
                    .await
                    .unwrap()
            else {
                panic!("another person's hold must stay");
            };
            assert_eq!(actual, row);
        }
    }

    #[tokio::test]
    async fn missing_assignment_event_table_rolls_back_the_ack_and_lead() {
        for db in backends().await {
            incident(&db, "rollback").await;
            let before = stored(&db, "rollback").await;
            db.execute_unprepared("DROP TABLE incident_events")
                .await
                .unwrap();
            assert!(
                take_ownership_with(&db, "acme", "rollback", &own("ana"))
                    .await
                    .is_err()
            );
            assert_eq!(stored(&db, "rollback").await, before);
        }
    }

    #[tokio::test]
    async fn ensure_lead_fills_empty_lead_once_and_preserves_existing_lead() {
        for db in backends().await {
            incident(&db, "ensure").await;
            ack_without_lead(&db, "ensure", "ana", 500).await;
            assert!(
                ensure_lead_for_human_with(
                    &db,
                    "acme",
                    "ensure",
                    "ana",
                    LeadAck::Incident {
                        acknowledged_at: 500
                    }
                )
                .await
                .unwrap()
                .is_some()
            );
            assert!(
                ensure_lead_for_human_with(
                    &db,
                    "acme",
                    "ensure",
                    "bo",
                    LeadAck::Incident {
                        acknowledged_at: 500
                    }
                )
                .await
                .unwrap()
                .is_none()
            );
            assert_eq!(
                stored(&db, "ensure").await.assigned_to.as_deref(),
                Some("ana")
            );
            let events = incident_events::get_with(&db, "acme", "ensure")
                .await
                .unwrap();
            assert_eq!(events.len(), 1);
            assert!(matches!(&events[0].event_type,
                IncidentEventType::AssignmentChanged { via: Some(via), .. } if via == "ack"));
        }
    }

    #[tokio::test]
    async fn only_the_lead_releasing_an_ack_set_lead_clears_it() {
        for db in backends().await {
            for (id, assigned, actor, clears) in [
                ("ack", false, "ana", true),
                ("assign", true, "ana", false),
                ("other", false, "bo", false),
            ] {
                incident(&db, id).await;
                take_ownership_with(&db, "acme", id, &own("ana"))
                    .await
                    .unwrap();
                if assigned {
                    assign_lead_with(&db, "acme", id, Some("bo"), "ana")
                        .await
                        .unwrap();
                    assign_lead_with(&db, "acme", id, Some("ana"), "ana")
                        .await
                        .unwrap();
                }
                let txn = db.begin().await.unwrap();
                assert!(
                    release_ack_in(&txn, "acme", id, "ana", actor)
                        .await
                        .unwrap()
                        .is_some()
                );
                txn.commit().await.unwrap();
                let row = stored(&db, id).await;
                assert!(row.acknowledged_by.is_none());
                assert_eq!(row.assigned_to.is_none(), clears);
            }
        }
    }

    #[tokio::test]
    async fn a_legacy_assignment_and_a_stale_holder_keep_the_lead() {
        for db in backends().await {
            incident(&db, "legacy").await;
            take_ownership_with(&db, "acme", "legacy", &own("ana"))
                .await
                .unwrap();
            let mut legacy = IncidentEvent::assignment_changed(None, Some("ana".into()), "ana");
            if let IncidentEventType::AssignmentChanged { via, .. } = &mut legacy.event_type {
                *via = None;
            }
            incident_events::append_with(&db, "acme", "legacy", legacy)
                .await
                .unwrap();
            let txn = db.begin().await.unwrap();
            assert!(
                release_ack_in(&txn, "acme", "legacy", "bo", "ana")
                    .await
                    .unwrap()
                    .is_none()
            );
            assert!(
                release_ack_in(&txn, "acme", "legacy", "ana", "ana")
                    .await
                    .unwrap()
                    .is_some()
            );
            txn.commit().await.unwrap();
            assert_eq!(
                stored(&db, "legacy").await.assigned_to.as_deref(),
                Some("ana")
            );
        }
    }

    #[tokio::test]
    async fn concurrent_ownership_has_one_winner_after_both_read_the_empty_values() {
        for db in backends().await {
            incident(&db, "race").await;
            let db = Arc::new(db);
            let race = Barriers::new();
            race.arm("alert_incidents.ownership_before_lock", 2);
            let task = |caller: &'static str| {
                let (db, race) = (db.clone(), race.clone());
                tokio::spawn(async move {
                    let before = stored(&db, "race").await;
                    assert!(before.acknowledged_by.is_none() && before.assigned_to.is_none());
                    race.run(take_ownership_with(&db, "acme", "race", &own(caller)))
                        .await
                        .unwrap()
                })
            };
            let (a, b) = (task("ana"), task("bo"));
            let (a, b) = (a.await.unwrap(), b.await.unwrap());
            race.assert_all_met();
            let (winner, loser) = match (a, b) {
                (OwnershipResult::Committed(a, _), OwnershipResult::Conflict(b)) => (a, b),
                (OwnershipResult::Conflict(a), OwnershipResult::Committed(b, _)) => (b, a),
                other => panic!("expected one winner and one conflict: {other:?}"),
            };
            assert_eq!(winner, loser);
            assert_eq!(winner.assigned_to, winner.acknowledged_by);
            assert_eq!(
                incident_events::get_with(db.as_ref(), "acme", "race")
                    .await
                    .unwrap()
                    .len(),
                1
            );
        }
    }

    #[tokio::test]
    async fn sqlite_ownership_obeys_both_serial_orders() {
        let runs = in_both_orders(|order| async move {
            let db = Arc::new(
                backends()
                    .await
                    .into_iter()
                    .find(|db| db.get_database_backend() == DatabaseBackend::Sqlite)
                    .unwrap(),
            );
            incident(&db, "serial").await;
            let a = db.clone();
            let b = db.clone();
            (
                async move {
                    (
                        order,
                        take_ownership_with(&a, "acme", "serial", &own("ana"))
                            .await
                            .unwrap(),
                    )
                },
                async move {
                    take_ownership_with(&b, "acme", "serial", &own("bo"))
                        .await
                        .unwrap()
                },
            )
        })
        .await;
        for run in runs {
            match run.order {
                Order::AThenB => assert!(matches!(
                    (run.a.1, run.b),
                    (
                        OwnershipResult::Committed(_, _),
                        OwnershipResult::Conflict(_)
                    )
                )),
                Order::BThenA => assert!(matches!(
                    (run.a.1, run.b),
                    (
                        OwnershipResult::Conflict(_),
                        OwnershipResult::Committed(_, _)
                    )
                )),
            }
        }
    }
    async fn ack_without_lead(db: &DatabaseConnection, id: &str, holder: &str, at: i64) {
        alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::Status, Expr::value("acknowledged"))
            .col_expr(alert_incidents::Column::AcknowledgedBy, Expr::value(holder))
            .col_expr(alert_incidents::Column::AcknowledgedAt, Expr::value(at))
            .col_expr(alert_incidents::Column::UpdatedAt, Expr::value(at))
            .filter(alert_incidents::Column::Id.eq(id))
            .exec(db)
            .await
            .unwrap();
    }

    async fn page_ack_without_incident_ack(db: &DatabaseConnection, id: &str) {
        oncall_responses::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("acme".to_string()),
            subject_type: Set(config::meta::oncall::SubjectType::Alert.to_i32()),
            subject_id: Set(format!("{id}#1")),
            state: Set(config::meta::oncall::ResponseState::Acknowledged.to_i32()),
            responder_role: Set(config::meta::oncall::ResponderRole::Owner.to_i32()),
            priority: Set(2),
            opened_at: Set(100),
            acked_by: Set(Some("ana".to_string())),
            acked_at: Set(Some(500)),
            incident_id: Set(Some(id.to_string())),
            updated_at: Set(500),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn delayed_incident_lead_callback_cannot_restore_a_released_or_replaced_ack() {
        for db in backends().await {
            let db = Arc::new(db);
            for change in ["unack", "takeover", "same_holder_new_epoch"] {
                incident(&db, change).await;
                ack_without_lead(&db, change, "ana", 500).await;
                let race = Barriers::new();
                race.arm("alert_incidents.ensure_lead_before_lock", 2);
                race.arm("alert_incidents.ensure_lead_continue", 2);
                let pending = {
                    let (db, race) = (db.clone(), race.clone());
                    tokio::spawn(async move {
                        race.run(ensure_lead_for_human_with(
                            &db,
                            "acme",
                            change,
                            "ana",
                            LeadAck::Incident {
                                acknowledged_at: 500,
                            },
                        ))
                        .await
                        .unwrap()
                    })
                };
                race.wait("alert_incidents.ensure_lead_before_lock").await;
                if change == "takeover" {
                    super::super::take_over_acknowledgement_row_with(
                        db.as_ref(),
                        "acme",
                        change,
                        "ana",
                        "bo",
                    )
                    .await
                    .unwrap()
                    .unwrap();
                } else {
                    super::super::unacknowledge_by_with(db.as_ref(), "acme", change, "ana", "ana")
                        .await
                        .unwrap()
                        .unwrap();
                    if change == "same_holder_new_epoch" {
                        ack_without_lead(&db, change, "ana", 700).await;
                    }
                }
                let current = stored(&db, change).await;
                let seq = incident_events::seq_with(db.as_ref(), "acme", change)
                    .await
                    .unwrap();
                race.wait("alert_incidents.ensure_lead_continue").await;
                assert!(pending.await.unwrap().is_none());
                race.assert_all_met();
                assert_eq!(stored(&db, change).await, current);
                assert_eq!(
                    incident_events::seq_with(db.as_ref(), "acme", change)
                        .await
                        .unwrap(),
                    seq
                );
                if let Some(at) = current.acknowledged_at {
                    let holder = current.acknowledged_by.as_deref().unwrap();
                    assert!(
                        ensure_lead_for_human_with(
                            &db,
                            "acme",
                            change,
                            holder,
                            LeadAck::Incident {
                                acknowledged_at: at
                            }
                        )
                        .await
                        .unwrap()
                        .is_some()
                    );
                    assert_eq!(
                        stored(&db, change).await.assigned_to.as_deref(),
                        Some(holder)
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn page_ack_source_fills_an_empty_lead_without_an_incident_ack() {
        for db in backends().await {
            incident(&db, "orphan").await;
            page_ack_without_incident_ack(&db, "orphan").await;
            let edited = ensure_lead_for_human_with(
                &db,
                "acme",
                "orphan",
                "ana",
                LeadAck::Page {
                    response_id: "orphan",
                    updated_at: 500,
                },
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(edited.row.assigned_to.as_deref(), Some("ana"));
            assert!(edited.row.acknowledged_by.is_none());
            assert_eq!(edited.event.unwrap().seq, 2);
        }
    }

    #[tokio::test]
    async fn delayed_page_lead_callback_requires_the_same_live_page_ack() {
        for db in backends().await {
            let db = Arc::new(db);
            for change in [
                "page_unack",
                "page_takeover",
                "page_new_epoch",
                "page_relink",
                "page_resolve",
                "incident_takeover",
            ] {
                incident(&db, change).await;
                page_ack_without_incident_ack(&db, change).await;
                let race = Barriers::new();
                race.arm("alert_incidents.ensure_lead_before_lock", 2);
                race.arm("alert_incidents.ensure_lead_continue", 2);
                let pending = {
                    let (db, race) = (db.clone(), race.clone());
                    tokio::spawn(async move {
                        race.run(ensure_lead_for_human_with(
                            &db,
                            "acme",
                            change,
                            "ana",
                            LeadAck::Page {
                                response_id: change,
                                updated_at: 500,
                            },
                        ))
                        .await
                        .unwrap()
                    })
                };
                race.wait("alert_incidents.ensure_lead_before_lock").await;
                if change == "incident_takeover" {
                    ack_without_lead(&db, change, "bo", 700).await;
                } else {
                    let mut update = oncall_responses::Entity::update_many()
                        .col_expr(oncall_responses::Column::UpdatedAt, Expr::value(700));
                    update = match change {
                        "page_unack" => update
                            .col_expr(
                                oncall_responses::Column::State,
                                Expr::value(
                                    config::meta::oncall::ResponseState::Triggered.to_i32(),
                                ),
                            )
                            .col_expr(
                                oncall_responses::Column::AckedBy,
                                Expr::value(Option::<String>::None),
                            ),
                        "page_takeover" => {
                            update.col_expr(oncall_responses::Column::AckedBy, Expr::value("bo"))
                        }
                        "page_new_epoch" => {
                            update.col_expr(oncall_responses::Column::AckedAt, Expr::value(700))
                        }
                        "page_relink" => update
                            .col_expr(oncall_responses::Column::IncidentId, Expr::value("another")),
                        "page_resolve" => update
                            .col_expr(
                                oncall_responses::Column::State,
                                Expr::value(config::meta::oncall::ResponseState::Resolved.to_i32()),
                            )
                            .col_expr(oncall_responses::Column::ClosedAt, Expr::value(700)),
                        _ => panic!("unexpected page change"),
                    };
                    update
                        .filter(oncall_responses::Column::Id.eq(change))
                        .exec(db.as_ref())
                        .await
                        .unwrap();
                }
                let current = stored(&db, change).await;
                let seq = incident_events::seq_with(db.as_ref(), "acme", change)
                    .await
                    .unwrap();
                race.wait("alert_incidents.ensure_lead_continue").await;
                assert!(pending.await.unwrap().is_none(), "{change}");
                race.assert_all_met();
                assert_eq!(stored(&db, change).await, current);
                assert_eq!(
                    incident_events::seq_with(db.as_ref(), "acme", change)
                        .await
                        .unwrap(),
                    seq
                );
            }
        }
    }
}

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

//! Writers of the Incidents v2 columns a person edits or the system stamps once.

use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, QueryFilter,
    QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, LockType},
};

use crate::{db::get_orm_client_rw, errors, table::entity::alert_incidents};

/// One person's edit of an owner-block or impact field.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FieldEdit {
    OwnerTeam(Option<String>),
    CommsOwner(Option<String>),
    ImpactWindow { start: i64, end: Option<i64> },
    CustomerImpact(String),
}

impl FieldEdit {
    /// Writes the edit into `row`; the event it owes, `None` when nothing changed or none is owed.
    fn apply(
        self,
        row: &alert_incidents::Model,
        active: &mut alert_incidents::ActiveModel,
        user_id: &str,
    ) -> Option<Option<IncidentEvent>> {
        match self {
            Self::OwnerTeam(to) if to != row.owner_team_id => {
                active.owner_team_id = Set(to.clone());
                let from = row.owner_team_id.clone();
                Some(Some(IncidentEvent::owner_team_changed(from, to, user_id)))
            }
            Self::CommsOwner(to) if to != row.comms_owner => {
                active.comms_owner = Set(to.clone());
                let from = row.comms_owner.clone();
                Some(Some(IncidentEvent::comms_owner_changed(from, to, user_id)))
            }
            Self::ImpactWindow { start, end }
                if (Some(start), end) != (row.impact_start_at, row.impact_end_at) =>
            {
                active.impact_start_at = Set(Some(start));
                active.impact_end_at = Set(end);
                let from = (row.impact_start_at, row.impact_end_at);
                Some(Some(IncidentEvent::impact_window_changed(
                    from,
                    (Some(start), end),
                    user_id,
                )))
            }
            Self::CustomerImpact(to) if Some(&to) != row.customer_impact.as_ref() => {
                active.customer_impact = Set(Some(to));
                Some(None)
            }
            _ => None,
        }
    }
}

/// The row after an edit and the event it appended, which the caller still owes to workflows.
#[derive(Clone, Debug)]
pub struct Edited {
    pub row: alert_incidents::Model,
    pub event: Option<IncidentEvent>,
}

/// Applies `edit` and appends its event in one transaction under the incident's row lock.
pub async fn edit_fields(
    org_id: &str,
    id: &str,
    edit: FieldEdit,
    user_id: &str,
) -> Result<Option<Edited>, errors::Error> {
    let txn = get_orm_client_rw().await.begin().await?;
    let edited = edit_fields_in(&txn, org_id, id, edit, user_id).await?;
    txn.commit().await?;
    Ok(edited)
}

/// [edit_fields] in the caller's transaction; `None` when the incident does not exist.
pub async fn edit_fields_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    edit: FieldEdit,
    user_id: &str,
) -> Result<Option<Edited>, errors::Error> {
    let Some(row) = alert_incidents::Entity::find_by_id(id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .lock(LockType::Update)
        .one(txn)
        .await?
    else {
        return Ok(None);
    };
    let mut active: alert_incidents::ActiveModel = row.clone().into();
    let Some(event) = edit.apply(&row, &mut active, user_id) else {
        return Ok(Some(Edited { row, event: None }));
    };
    active.updated_at = Set(chrono::Utc::now().timestamp_micros());
    let row = active.update(txn).await?;
    if let Some(event) = &event {
        crate::table::incident_events::append_in(txn, org_id, id, event.clone()).await?;
    }
    Ok(Some(Edited { row, event }))
}

/// Stamps the first qualifying open once; returns the stored value, `None` for no incident.
pub async fn mark_first_opened(
    org_id: &str,
    id: &str,
    at: i64,
) -> Result<Option<Option<i64>>, errors::Error> {
    mark_first_opened_with(get_orm_client_rw().await, org_id, id, at).await
}

/// [mark_first_opened] on a given connection.
pub async fn mark_first_opened_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    at: i64,
) -> Result<Option<Option<i64>>, errors::Error> {
    alert_incidents::Entity::update_many()
        .col_expr(alert_incidents::Column::FirstOpenedAt, Expr::value(at))
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Id.eq(id))
        .filter(alert_incidents::Column::FirstOpenedAt.is_null())
        .exec(conn)
        .await?;
    first_opened_at_with(conn, org_id, id).await
}

/// The stored `first_opened_at`; `None` when the incident does not exist.
pub async fn first_opened_at_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Option<i64>>, errors::Error> {
    Ok(alert_incidents::Entity::find_by_id(id)
        .select_only()
        .column(alert_incidents::Column::FirstOpenedAt)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .into_tuple::<Option<i64>>()
        .one(conn)
        .await?)
}

/// Routing's owner at creation, written only while no person ever chose one: a team they set or
/// cleared wins. `true` when written.
pub async fn set_owner_team_if_unset(
    org_id: &str,
    id: &str,
    team_id: &str,
) -> Result<bool, errors::Error> {
    set_owner_team_if_unset_with(get_orm_client_rw().await, org_id, id, team_id).await
}

/// [set_owner_team_if_unset] on a given connection; the row lock orders it with a person's edit.
pub async fn set_owner_team_if_unset_with<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    team_id: &str,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    let Some(row) = alert_incidents::Entity::find_by_id(id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .lock(LockType::Update)
        .one(&txn)
        .await?
    else {
        txn.rollback().await?;
        return Ok(false);
    };
    let chosen = crate::table::incident_events::get_with(&txn, org_id, id)
        .await?
        .iter()
        .any(|e| matches!(e.event_type, IncidentEventType::OwnerTeamChanged { .. }));
    if row.owner_team_id.is_some() || chosen {
        txn.rollback().await?;
        return Ok(false);
    }
    alert_incidents::Entity::update_many()
        .col_expr(alert_incidents::Column::OwnerTeamId, Expr::value(team_id))
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Id.eq(id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(true)
}

/// Moves the stored fallback to the detected onset, never over a person's edit.
pub async fn move_impact_start_to_onset(
    org_id: &str,
    id: &str,
    first_alert_at: i64,
    onset: i64,
) -> Result<bool, errors::Error> {
    move_impact_start_to_onset_with(get_orm_client_rw().await, org_id, id, first_alert_at, onset)
        .await
}

/// [move_impact_start_to_onset] on a given connection.
pub async fn move_impact_start_to_onset_with<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    first_alert_at: i64,
    onset: i64,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    let Some(row) = super::get_locked(&txn, org_id, id).await? else {
        txn.rollback().await?;
        return Ok(false);
    };
    if row.impact_start_at != Some(first_alert_at)
        || crate::table::incident_events::get_with(&txn, org_id, id)
            .await?
            .iter()
            .any(|event| {
                matches!(
                    event.event_type,
                    IncidentEventType::ImpactWindowChanged { .. }
                )
            })
    {
        txn.rollback().await?;
        return Ok(false);
    }
    let mut active: alert_incidents::ActiveModel = row.into();
    active.impact_start_at = Set(Some(onset));
    active.update(&txn).await?;
    txn.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseConnection, Schema};

    use super::*;
    use crate::table::{entity::incident_events, incident_events as events};

    async fn backends() -> Vec<DatabaseConnection> {
        let mut dbs = Vec::new();
        for db in crate::table::migration::sqlite_and_postgres_for_test("v2_fields").await {
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            for stmt in [
                schema.create_table_from_entity(alert_incidents::Entity),
                schema.create_table_from_entity(incident_events::Entity),
            ] {
                db.execute(backend.build(&stmt)).await.unwrap();
            }
            dbs.push(db);
        }
        dbs
    }

    async fn incident(db: &DatabaseConnection, id: &str) {
        alert_incidents::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("acme".to_string()),
            status: Set("open".to_string()),
            severity: Set("P2".to_string()),
            group_values: Set(serde_json::json!({})),
            key_type: Set("service".to_string()),
            first_alert_at: Set(100),
            last_alert_at: Set(100),
            alert_count: Set(1),
            created_at: Set(100),
            updated_at: Set(100),
            impact_start_at: Set(Some(100)),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        events::open_empty_in(db, "acme", id).await.unwrap();
    }

    async fn edit(db: &DatabaseConnection, id: &str, edit: FieldEdit) -> Edited {
        let txn = db.begin().await.unwrap();
        let edited = edit_fields_in(&txn, "acme", id, edit, "ana@acme.io")
            .await
            .unwrap()
            .unwrap();
        txn.commit().await.unwrap();
        edited
    }

    async fn stored(db: &DatabaseConnection, id: &str) -> alert_incidents::Model {
        alert_incidents::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    async fn timeline(db: &DatabaseConnection, id: &str) -> Vec<IncidentEventType> {
        events::get_with(db, "acme", id)
            .await
            .unwrap()
            .into_iter()
            .map(|e| e.event_type)
            .collect()
    }

    #[tokio::test]
    async fn each_edit_writes_its_column_and_its_event_together() {
        for db in backends().await {
            incident(&db, "i1").await;
            let owner = edit(&db, "i1", FieldEdit::OwnerTeam(Some("t1".into()))).await;
            assert_eq!(owner.row.owner_team_id.as_deref(), Some("t1"));
            assert!(matches!(
                owner.event.map(|e| e.event_type),
                Some(IncidentEventType::OwnerTeamChanged { .. })
            ));
            let comms = edit(&db, "i1", FieldEdit::CommsOwner(Some("c@acme.io".into()))).await;
            assert_eq!(comms.row.comms_owner.as_deref(), Some("c@acme.io"));
            let window = FieldEdit::ImpactWindow {
                start: 50,
                end: Some(900),
            };
            let row = edit(&db, "i1", window.clone()).await.row;
            assert_eq!(
                (row.impact_start_at, row.impact_end_at),
                (Some(50), Some(900))
            );
            let impact = edit(&db, "i1", FieldEdit::CustomerImpact("confirmed".into())).await;
            assert_eq!(impact.row.customer_impact.as_deref(), Some("confirmed"));
            assert!(impact.event.is_none());
            assert!(edit(&db, "i1", window).await.event.is_none());

            let events = timeline(&db, "i1").await;
            assert_eq!(events.len(), 3, "no event for customer impact or a no-op");
            assert!(matches!(
                &events[0],
                IncidentEventType::OwnerTeamChanged { from: None, to: Some(t), user_id: Some(_) }
                    if t == "t1"
            ));
            assert!(matches!(
                &events[1],
                IncidentEventType::AssignmentChanged { role: Some(r), .. } if r == "comms"
            ));
            assert!(matches!(
                &events[2],
                IncidentEventType::ImpactWindowChanged {
                    from_start: Some(100),
                    from_end: None,
                    to_start: Some(50),
                    to_end: Some(900),
                    ..
                }
            ));
            let txn = db.begin().await.unwrap();
            let missing = edit_fields_in(&txn, "acme", "nope", FieldEdit::OwnerTeam(None), "u");
            assert!(missing.await.unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn first_open_is_stamped_once_and_later_calls_read_it_back() {
        for db in backends().await {
            incident(&db, "i1").await;
            assert_eq!(
                mark_first_opened_with(&db, "acme", "i1", 500)
                    .await
                    .unwrap(),
                Some(Some(500))
            );
            assert_eq!(
                mark_first_opened_with(&db, "acme", "i1", 900)
                    .await
                    .unwrap(),
                Some(Some(500))
            );
            assert_eq!(
                first_opened_at_with(&db, "acme", "nope").await.unwrap(),
                None
            );
        }
    }

    #[tokio::test]
    async fn onset_does_not_move_the_start_of_a_manually_edited_window() {
        for db in backends().await {
            incident(&db, "edited").await;
            edit(
                &db,
                "edited",
                FieldEdit::ImpactWindow {
                    start: 100,
                    end: Some(200),
                },
            )
            .await;

            move_impact_start_to_onset_with(&db, "acme", "edited", 100, 40)
                .await
                .unwrap();

            let row = stored(&db, "edited").await;
            assert_eq!(
                (row.impact_start_at, row.impact_end_at),
                (Some(100), Some(200))
            );
        }
    }

    #[tokio::test]
    async fn the_system_never_overwrites_what_a_person_set() {
        for db in backends().await {
            incident(&db, "edited").await;
            incident(&db, "untouched").await;
            incident(&db, "cleared").await;
            edit(&db, "cleared", FieldEdit::OwnerTeam(Some("mine".into()))).await;
            edit(&db, "cleared", FieldEdit::OwnerTeam(None)).await;
            edit(&db, "edited", FieldEdit::OwnerTeam(Some("mine".into()))).await;
            edit(
                &db,
                "edited",
                FieldEdit::ImpactWindow {
                    start: 70,
                    end: None,
                },
            )
            .await;
            for id in ["edited", "untouched", "cleared"] {
                set_owner_team_if_unset_with(&db, "acme", id, "routed")
                    .await
                    .unwrap();
                move_impact_start_to_onset_with(&db, "acme", id, 100, 40)
                    .await
                    .unwrap();
            }
            let edited = stored(&db, "edited").await;
            assert_eq!(edited.owner_team_id.as_deref(), Some("mine"));
            assert_eq!(edited.impact_start_at, Some(70));
            let untouched = stored(&db, "untouched").await;
            assert_eq!(untouched.owner_team_id.as_deref(), Some("routed"));
            let cleared = stored(&db, "cleared").await;
            assert_eq!(
                cleared.owner_team_id, None,
                "a team a person cleared stays cleared"
            );
            assert_eq!(untouched.impact_start_at, Some(40));
        }
    }
}

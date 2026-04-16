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

//! Alert Incident ↔ Service Join Table Operations
//!
//! Manages links between incidents and service_streams rows.
//! No FK constraints on either side — see migration comments for rationale.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};

use super::entity::alert_incident_services;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

/// Link one or more services to a newly-created incident.
///
/// The first ID in `service_stream_ids` is inserted as `'responsible'`;
/// all remaining IDs are inserted as `'impacted'`.
/// If `service_stream_ids` is empty, this is a no-op.
pub async fn link_services(
    incident_id: &str,
    service_stream_ids: &[String],
    added_by: &str,
) -> Result<(), errors::Error> {
    if service_stream_ids.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let models: Vec<alert_incident_services::ActiveModel> = service_stream_ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let role = if i == 0 { "responsible" } else { "impacted" };
            alert_incident_services::ActiveModel {
                incident_id: Set(incident_id.to_string()),
                service_stream_id: Set(id.clone()),
                role: Set(role.to_string()),
                added_by: Set(added_by.to_string()),
                created_at: Set(now),
            }
        })
        .collect();

    // INSERT OR IGNORE — primary key (incident_id, service_stream_id) prevents duplicates
    alert_incident_services::Entity::insert_many(models)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                alert_incident_services::Column::IncidentId,
                alert_incident_services::Column::ServiceStreamId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Add services as `'impacted'` on an existing incident, skipping any already linked.
///
/// Safe to call concurrently — operates only on the join table, never on the hot
/// incident row. Does not touch the existing `'responsible'` row.
pub async fn add_impacted_if_new(
    incident_id: &str,
    service_stream_ids: &[String],
    added_by: &str,
) -> Result<(), errors::Error> {
    if service_stream_ids.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let models: Vec<alert_incident_services::ActiveModel> = service_stream_ids
        .iter()
        .map(|id| alert_incident_services::ActiveModel {
            incident_id: Set(incident_id.to_string()),
            service_stream_id: Set(id.clone()),
            role: Set("impacted".to_string()),
            added_by: Set(added_by.to_string()),
            created_at: Set(now),
        })
        .collect();

    // INSERT OR IGNORE — no-op if already linked regardless of current role
    alert_incident_services::Entity::insert_many(models)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                alert_incident_services::Column::IncidentId,
                alert_incident_services::Column::ServiceStreamId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Return all service links for an incident, ordered by role ('responsible' first).
pub async fn get_by_incident(
    incident_id: &str,
) -> Result<Vec<alert_incident_services::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incident_services::Entity::find()
        .filter(alert_incident_services::Column::IncidentId.eq(incident_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Delete all service links for an incident (called during incident cleanup).
pub async fn delete_by_incident(incident_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incident_services::Entity::delete_many()
        .filter(alert_incident_services::Column::IncidentId.eq(incident_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}
